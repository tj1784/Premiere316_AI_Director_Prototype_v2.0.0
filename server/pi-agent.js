import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./paths.js";

const PROFILE_DIR = "C:/Users/Blokey/.pi/profiles/comfyui-workflow-expert";
const CONTEXT_FILE = path.join(PROFILE_DIR, "premiere316-context.json");
const SESSION_DIR = path.join(PROFILE_DIR, "sessions", "premiere316");
const PI_CLI = "C:/Users/Blokey/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
const MODEL = "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive";
const WORKER = "premiere-worker";
const WORKER_MODEL = `lmstudio/${MODEL}`;
const WORKER_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SESSION_ID = "premiere316-comfyui-orchestrator-v3";

function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("");
}

class PremierePiAgent {
  constructor() {
    this.child = null;
    this.stdoutBuffer = "";
    this.sequence = 0;
    this.pending = new Map();
    this.subscribers = new Set();
    this.conversation = [];
    this.currentAssistant = null;
    this.taskQueue = [];
    this.currentTask = null;
    this.runtimeVerification = null;
    this.workerWaiter = null;
    this.state = {
      running: false,
      starting: false,
      streaming: false,
      phase: "stopped",
      activeTool: null,
      workerActive: false,
      model: MODEL,
      provider: "lmstudio",
      orchestratorThinking: "low",
      workerThinking: "high",
      orchestrator: true,
      workerModelMatches: true,
      forcedDelegation: true,
      workerCommandReady: false,
      delegationCount: 0,
      queuedTasks: 0,
      latestWorkerValidation: null,
      lastDelegatedAt: null,
      lastWorkerCompletedAt: null,
      lastError: null,
      pid: null
    };
    this.pageContext = { connected: false, page: "startup", updatedAt: null };
  }

  publicState() {
    return {
      ...this.state,
      conversation: this.conversation.slice(-80),
      pageContext: this.pageContext
    };
  }

  broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of this.subscribers) {
      try { response.write(data); } catch { this.subscribers.delete(response); }
    }
  }

  broadcastState() {
    this.broadcast({ type: "premiere_pi_state", state: this.publicState() });
  }

  subscribe(response) {
    this.subscribers.add(response);
    response.write(`data: ${JSON.stringify({ type: "premiere_pi_state", state: this.publicState() })}\n\n`);
    return () => this.subscribers.delete(response);
  }

  updateContext(context = {}) {
    const safe = JSON.parse(JSON.stringify(context || {}));
    this.pageContext = {
      ...safe,
      connected: true,
      serverReceivedAt: new Date().toISOString()
    };
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const temp = `${CONTEXT_FILE}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.pageContext, null, 2)}\n`, "utf8");
    fs.rmSync(CONTEXT_FILE, { force: true });
    fs.renameSync(temp, CONTEXT_FILE);
    this.broadcast({ type: "premiere_pi_context", context: this.pageContext });
    return this.pageContext;
  }

  start() {
    if (this.child && !this.child.killed) return;
    if (!fs.existsSync(PI_CLI)) throw new Error(`Pi CLI was not found: ${PI_CLI}`);
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    this.state = { ...this.state, starting: true, phase: "starting", lastError: null };
    const args = [
      PI_CLI,
      "--mode", "rpc",
      "--provider", "lmstudio",
      "--model", MODEL,
      "--thinking", "low",
      "--name", "Premiere316 ComfyUI Orchestrator",
      "--session-id", SESSION_ID,
      "--session-dir", SESSION_DIR,
      "--approve",
      "--no-builtin-tools"
    ];
    this.child = spawn(process.execPath, args, {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, PI_CODING_AGENT_DIR: PROFILE_DIR },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.state = { ...this.state, running: true, starting: false, phase: "ready", pid: this.child.pid };
    this.broadcastState();

    this.child.stdout.on("data", (chunk) => this.consumeStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text && /error|failed|exception/i.test(text)) {
        this.state.lastError = text.slice(-1200);
        this.broadcast({ type: "premiere_pi_log", level: "error", message: this.state.lastError });
      }
    });
    this.child.on("error", (error) => {
      this.state = { ...this.state, running: false, streaming: false, phase: "error", lastError: error.message, pid: null };
      this.rejectPending(error);
      this.broadcastState();
    });
    this.child.on("exit", (code, signal) => {
      const expected = code === 0 || signal === "SIGTERM";
      const error = new Error(`Pi exited (${signal || (code ?? "unknown")}).`);
      this.child = null;
      this.currentAssistant = null;
      this.state = {
        ...this.state,
        running: false,
        starting: false,
        streaming: false,
        workerActive: false,
        activeTool: null,
        queuedTasks: this.taskQueue.length,
        phase: expected ? "stopped" : "error",
        lastError: expected ? null : error.message,
        pid: null
      };
      this.rejectPending(error);
      this.broadcastState();
    });
  }

  rejectPending(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.rejectWorkerWaiter(error);
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk || "");
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      try { this.handleEvent(JSON.parse(line)); } catch {
        this.broadcast({ type: "premiere_pi_log", level: "warning", message: line.slice(0, 1000) });
      }
    }
  }

  handleEvent(event) {
    if (event.type === "response" && event.id && this.pending.has(event.id)) {
      const item = this.pending.get(event.id);
      this.pending.delete(event.id);
      clearTimeout(item.timer);
      if (event.success === false) item.reject(new Error(event.error || `${event.command} failed`));
      else item.resolve(event.data ?? event);
    }

    if (event.type === "message_end" && event.message?.role === "custom" && event.message?.customType === "subagent-slash-result") {
      const message = event.message;
      const requestId = message?.details?.requestId || null;
      const result = message?.details?.result?.details?.results?.[0];
      const status = result?.progress?.status || null;
      const terminal = Boolean(
        (status && status !== "pending" && status !== "running")
        || result?.finalOutput
        || result?.error
        || message?.details?.result?.details?.runId
      );
      const waiter = this.workerWaiter;
      if (waiter && (!waiter.requestId || !requestId || waiter.requestId === requestId)) {
        if (requestId) waiter.requestId = requestId;
        clearTimeout(waiter.startTimer);
        if (terminal) {
          clearTimeout(waiter.finishTimer);
          this.workerWaiter = null;
          waiter.resolve(message);
        }
      }
    }

    if (event.type === "extension_ui_request" && event.method === "notify" && /unknown agent|subagent.*unavailable|worker bridge/i.test(String(event.message || ""))) {
      const waiter = this.workerWaiter;
      if (waiter) {
        clearTimeout(waiter.startTimer);
        clearTimeout(waiter.finishTimer);
        this.workerWaiter = null;
        waiter.reject(new Error(String(event.message)));
      }
    }

    if (event.type === "agent_start") {
      this.state = { ...this.state, streaming: true, phase: this.state.workerActive ? "worker active" : "supervising", lastError: null };
      this.currentAssistant = null;
      this.broadcastState();
    } else if (event.type === "message_update" && event.message?.role === "assistant") {
      const deltaEvent = event.assistantMessageEvent || {};
      if (deltaEvent.type === "text_delta" && deltaEvent.delta) {
        if (!this.currentAssistant) {
          this.currentAssistant = { id: `assistant-${Date.now()}-${this.sequence++}`, role: "assistant", content: "", createdAt: new Date().toISOString() };
          this.conversation.push(this.currentAssistant);
        }
        this.currentAssistant.content += deltaEvent.delta;
        this.state.phase = this.state.workerActive ? "worker active" : "responding";
      } else if (deltaEvent.type === "thinking_start" || deltaEvent.type === "thinking_delta") {
        this.state.phase = this.state.workerActive ? "worker active" : "thinking";
      }
    } else if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = messageText(event.message);
      if (text && !this.currentAssistant) {
        this.conversation.push({ id: `assistant-${Date.now()}-${this.sequence++}`, role: "assistant", content: text, createdAt: new Date().toISOString() });
      } else if (text && this.currentAssistant && text.length >= this.currentAssistant.content.length) {
        this.currentAssistant.content = text;
      }
      this.currentAssistant = null;
    } else if (event.type === "tool_execution_start") {
      const isWorker = event.toolName === "subagent";
      this.state = {
        ...this.state,
        activeTool: event.toolName || null,
        workerActive: isWorker || this.state.workerActive,
        phase: isWorker ? "worker active" : `using ${event.toolName || "tool"}`,
        ...(isWorker ? { delegationCount: this.state.delegationCount + 1, lastDelegatedAt: new Date().toISOString() } : {})
      };
      this.broadcastState();
    } else if (event.type === "tool_execution_end") {
      if (event.toolName === "subagent") {
        this.state.workerActive = false;
        this.state.lastWorkerCompletedAt = new Date().toISOString();
      }
      this.state.activeTool = null;
      this.state.phase = "responding";
      this.broadcastState();
    } else if (event.type === "agent_settled") {
      this.state = { ...this.state, streaming: false, workerActive: false, activeTool: null, phase: "ready" };
      this.currentAssistant = null;
      this.currentTask = null;
      this.broadcastState();
      setImmediate(() => this.dispatchNextTask());
    } else if (event.type === "extension_error") {
      this.state.lastError = event.error || event.message || "Pi extension error";
    }
    this.broadcast(event);
  }

  command(payload, timeoutMs = 15000) {
    this.start();
    if (!this.child?.stdin?.writable) return Promise.reject(new Error("Pi RPC input is not available."));
    const id = payload.id || `premiere-${Date.now()}-${this.sequence++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi command timed out: ${payload.type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });
  }

  async verifyRuntime() {
    if (this.state.workerCommandReady) return true;
    if (this.runtimeVerification) return this.runtimeVerification;
    this.runtimeVerification = this.command({ type: "get_commands" }).then((data) => {
      const commands = Array.isArray(data?.commands) ? data.commands : [];
      const run = commands.find((item) => item?.name === "run" && item?.source === "extension");
      if (!run) throw new Error("pi-subagents did not expose the required /run extension command.");
      this.state.workerCommandReady = true;
      this.broadcastState();
      return true;
    }).finally(() => {
      this.runtimeVerification = null;
    });
    return this.runtimeVerification;
  }

  buildWorkerTask(task, context) {
    return [
      "Execute this request for the permanent Premiere316 parent orchestrator.",
      "You are the sole execution worker for this run. Perform all required inspection, web research, filesystem work, edits, commands, and validation yourself. Never spawn another agent.",
      "Treat the supplied live page context as authoritative at dispatch time, re-check changing local state when necessary, preserve unrelated user work, and report evidence rather than plans.",
      "",
      "USER REQUEST",
      task,
      "",
      "LIVE PREMIERE316 PAGE CONTEXT",
      JSON.stringify(context, null, 2),
      "",
      "Return: outcome, exact changes, validation evidence, preserved state, and any genuine remaining limitation.",
      "[END HOST-DELEGATED TASK]"
    ].join("\n");
  }

  waitForWorkerResult() {
    if (this.workerWaiter) throw new Error("A Premiere316 worker result is already pending.");
    return new Promise((resolve, reject) => {
      const waiter = { requestId: null, resolve, reject, startTimer: null, finishTimer: null };
      waiter.startTimer = setTimeout(() => {
        if (this.workerWaiter !== waiter) return;
        this.workerWaiter = null;
        clearTimeout(waiter.finishTimer);
        reject(new Error("The required premiere-worker did not start within 15 seconds."));
      }, 15_000);
      waiter.finishTimer = setTimeout(() => {
        if (this.workerWaiter !== waiter) return;
        this.workerWaiter = null;
        clearTimeout(waiter.startTimer);
        reject(new Error("The required premiere-worker exceeded the two-hour execution limit."));
      }, WORKER_TIMEOUT_MS);
      this.workerWaiter = waiter;
    });
  }

  rejectWorkerWaiter(error) {
    const waiter = this.workerWaiter;
    if (!waiter) return;
    clearTimeout(waiter.startTimer);
    clearTimeout(waiter.finishTimer);
    this.workerWaiter = null;
    waiter.reject(error instanceof Error ? error : new Error(String(error)));
  }

  validateLatestWorker(custom) {
    const result = custom?.details?.result?.details?.results?.[0];
    const attemptedModels = Array.isArray(result?.attemptedModels) ? result.attemptedModels : [];
    const modelAttempts = Array.isArray(result?.modelAttempts) ? result.modelAttempts : [];
    const isExpectedModel = (model) => model === MODEL || model === WORKER_MODEL || model === `${WORKER_MODEL}:high`;
    const unexpectedModels = [
      result?.model,
      ...attemptedModels,
      ...modelAttempts.map((attempt) => attempt?.model)
    ].filter((model) => model && !isExpectedModel(model));
    const status = result?.progress?.status
      || (result?.exitCode === 0 && result?.finalOutput ? "completed" : null)
      || (result?.error ? "failed" : null);
    const checks = {
      terminalResultPresent: Boolean(result),
      workerMatches: result?.agent === WORKER,
      exitCodeZero: result?.exitCode === 0,
      statusCompleted: status === "completed",
      modelMatches: isExpectedModel(result?.model) && unexpectedModels.length === 0,
      noWorkerError: !result?.error,
      outputPresent: Boolean(String(result?.finalOutput || custom?.content || "").trim())
    };
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      worker: result?.agent || null,
      model: result?.model || null,
      expectedModel: WORKER_MODEL,
      attemptedModels,
      status,
      exitCode: result?.exitCode ?? null,
      error: result?.error || null
    };
  }

  async runForcedDelegation(task) {
    await this.verifyRuntime();
    const slashMessage = `/run ${WORKER}[model=${WORKER_MODEL}] ${this.buildWorkerTask(task.text, task.context)} --fork`;
    const terminalResult = this.waitForWorkerResult();
    await this.command({ type: "prompt", message: slashMessage }, WORKER_TIMEOUT_MS).catch((error) => this.rejectWorkerWaiter(error));
    const workerMessage = await terminalResult;
    if (task.cancelled) {
      const cancelled = new Error("The Premiere316 Pi task was stopped by the user.");
      cancelled.code = "PI_TASK_CANCELLED";
      throw cancelled;
    }
    const validation = this.validateLatestWorker(workerMessage);

    this.state = {
      ...this.state,
      workerActive: false,
      activeTool: null,
      phase: "supervising",
      latestWorkerValidation: validation,
      lastWorkerCompletedAt: new Date().toISOString()
    };
    this.broadcastState();

    const supervisorPrompt = [
      "SUPERVISOR SYNTHESIS PHASE.",
      `The mandatory ${WORKER} delegation has completed. Its exact result is in the immediately preceding subagent result message in this session.`,
      "Act only as the permanent parent orchestrator: review the worker evidence, identify any unsupported claim or failure, and give the user a clear result-first answer.",
      "Do not perform implementation work and do not delegate this synthesis again; the required worker execution for this request is already complete.",
      "Never claim success unless the worker's validation supports it.",
      `Host worker validation: ${JSON.stringify(validation)}`,
      "",
      "Original user request:",
      task.text
    ].join("\n");
    await this.command({ type: "prompt", message: supervisorPrompt });
  }

  dispatchNextTask() {
    if (this.currentTask || this.state.streaming || this.state.workerActive) return;
    const next = this.taskQueue.shift();
    this.state.queuedTasks = this.taskQueue.length;
    if (!next) {
      this.broadcastState();
      return;
    }

    this.currentTask = next;
    this.state = {
      ...this.state,
      streaming: true,
      workerActive: true,
      activeTool: "subagent",
      phase: "worker active",
      delegationCount: this.state.delegationCount + 1,
      queuedTasks: this.taskQueue.length,
      lastDelegatedAt: new Date().toISOString(),
      lastError: null
    };
    this.broadcastState();

    this.runForcedDelegation(next).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = error?.code === "PI_TASK_CANCELLED";
      if (!cancelled) {
        this.conversation.push({
          id: `assistant-${Date.now()}-${this.sequence++}`,
          role: "assistant",
          content: `The required worker run could not be completed: ${message}`,
          createdAt: new Date().toISOString()
        });
      }
      this.currentTask = null;
      this.state = {
        ...this.state,
        streaming: false,
        workerActive: false,
        activeTool: null,
        phase: cancelled ? "ready" : "error",
        lastError: cancelled ? null : message
      };
      this.broadcastState();
      setImmediate(() => this.dispatchNextTask());
    });
  }

  async prompt(message, context) {
    const text = String(message || "").trim();
    if (!text) throw new Error("A message is required.");
    if (context) this.updateContext(context);
    this.start();

    const queued = Boolean(this.currentTask || this.state.streaming || this.state.workerActive || this.taskQueue.length);
    const userMessage = {
      id: `user-${Date.now()}-${this.sequence++}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      steered: queued,
      queued
    };
    this.conversation.push(userMessage);
    this.taskQueue.push({
      id: userMessage.id,
      text,
      createdAt: userMessage.createdAt,
      context: JSON.parse(JSON.stringify(this.pageContext))
    });
    this.state.queuedTasks = this.taskQueue.length;
    this.broadcast({ type: "premiere_pi_user", message: userMessage });
    this.dispatchNextTask();
    return { accepted: true, queued, forcedDelegation: true, worker: WORKER, model: MODEL };
  }

  async abort() {
    if (!this.child || (!this.state.streaming && !this.state.workerActive)) return { aborted: false };
    this.taskQueue = [];
    this.state.queuedTasks = 0;
    if (this.currentTask) this.currentTask.cancelled = true;
    if (this.state.workerActive) {
      await this.command({ type: "prompt", message: "/premiere-cancel" }).catch(() => {});
    }
    await this.command({ type: "abort" }).catch(() => {});
    this.currentTask = null;
    this.state = { ...this.state, streaming: false, workerActive: false, activeTool: null, phase: "ready" };
    this.broadcastState();
    return { aborted: true };
  }

  async status() {
    try {
      await this.verifyRuntime();
      const rpc = await this.command({ type: "get_state" });
      return { ...this.publicState(), rpc };
    } catch (error) {
      return { ...this.publicState(), lastError: error.message };
    }
  }
}

export const premierePiAgent = new PremierePiAgent();
export const PREMIERE_PI_MODEL = MODEL;
