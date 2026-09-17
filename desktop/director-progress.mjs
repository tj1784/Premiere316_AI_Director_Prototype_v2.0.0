const ENDPOINT = "http://127.0.0.1:8190";
const SOCKET_ENDPOINT = "ws://127.0.0.1:8190/ws";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = { pending: "queued", in_progress: "running", completed: "completed", failed: "failed", cancelled: "cancelled" };
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const STAGES = {
  VAEDecode: "Decoding video frames", VAEDecodeTiled: "Decoding video frames",
  LTXVAudioVAEDecode: "Decoding audio", VHS_VideoCombine: "Encoding video",
  SaveVideo: "Saving video", SamplerCustomAdvanced: "Sampling", KSampler: "Sampling",
  KSamplerAdvanced: "Sampling", LTXVLatentUpsampler: "Upscaling latent frames",
};
const message = (error) => error instanceof Error ? error.message : String(error);
const finiteTime = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Read-only job state and its initiating client's event stream. No jobs or files are created. */
export function createDirectorProgress({
  fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, now = Date.now,
  requestTimeoutMs = 5000, connectionTimeoutMs = 5000, retryDelayMs = 1000,
} = {}) {
  const entries = new Map();
  let stopped = false;

  function entryFor(promptId) {
    if (!entries.has(promptId)) entries.set(promptId, {
      promptId, status: "unknown", nodeId: null, nodeType: null, stage: null,
      value: null, max: null, lastUpdated: null, observedAt: null,
      executionStartTime: null, executionEndTime: null,
      connection: "unavailable", error: undefined, clientId: null, nodes: {},
      socket: null, connectTimer: null, retryAt: 0, pending: null,
    });
    return entries.get(promptId);
  }
  function snapshot(entry) {
    const { promptId, status, nodeId, nodeType, stage, value, max, lastUpdated,
      observedAt, executionStartTime, executionEndTime, connection, error } = entry;
    return { promptId, status, nodeId, nodeType, stage, value, max, lastUpdated,
      observedAt, executionStartTime, executionEndTime, connection, ...(error ? { error } : {}) };
  }
  function clearNode(entry) {
    Object.assign(entry, { nodeId: null, nodeType: null, stage: null, value: null, max: null });
  }
  function node(entry, id, realId) {
    if (typeof id !== "string" && typeof id !== "number") return false;
    const nodeId = String(id);
    if (!nodeId) return false;
    if (entry.nodeId !== nodeId) Object.assign(entry, { value: null, max: null });
    const definition = entry.nodes[nodeId] ?? entry.nodes[String(realId)] ?? {};
    const nodeType = typeof definition.class_type === "string" ? definition.class_type : null;
    const title = typeof definition._meta?.title === "string" ? definition._meta.title.slice(0, 200) : null;
    Object.assign(entry, { nodeId, nodeType, stage: STAGES[nodeType] ?? title ?? nodeType ?? `Node ${nodeId}`, lastUpdated: now() });
    return true;
  }
  function counters(entry, value, max, initialState = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      typeof max !== "number" || !Number.isFinite(max) || max <= 0 || value > max) return;
    // Comfy initializes every node at 0/1 before it has emitted measured work.
    if (initialState && value === 0 && max === 1) return;
    Object.assign(entry, { value, max, lastUpdated: now() });
  }
  function closeSocket(entry, connection = "unavailable") {
    const socket = entry.socket;
    entry.socket = null;
    clearTimeout(entry.connectTimer);
    entry.connectTimer = null;
    entry.connection = connection;
    if (socket) { try { socket.close(); } catch { /* Already closed. */ } }
  }
  function receive(entry, event) {
    // Binary image previews are not progress messages and never leave this module.
    if (typeof event.data !== "string") return;
    let envelope;
    try { envelope = JSON.parse(event.data); } catch { return; }
    const data = envelope?.data;
    if (!data || typeof data !== "object") return;
    if (data.prompt_id !== undefined && data.prompt_id !== entry.promptId) return;
    // The reconnect-only executing event omits prompt_id. It is scoped to this
    // known job's unique premiere316 client. A queued job can start between
    // the HTTP snapshot and websocket handshake.
    if (data.prompt_id === undefined && !(envelope.type === "executing" && ["queued", "running"].includes(entry.status))) return;
    if (envelope.type === "execution_start") {
      clearNode(entry); entry.status = "running";
      entry.executionStartTime = finiteTime(data.timestamp) ?? entry.executionStartTime;
      entry.lastUpdated = now();
    } else if (envelope.type === "executing") {
      if (data.node === null) { clearNode(entry); entry.lastUpdated = now(); }
      else if (node(entry, data.node, data.display_node)) entry.status = "running";
    } else if (envelope.type === "progress") {
      if (node(entry, data.node)) { entry.status = "running"; counters(entry, data.value, data.max); }
    } else if (envelope.type === "progress_state") {
      const active = Object.entries(data.nodes ?? {}).filter(([, state]) => state?.state === "running" &&
        (state.prompt_id === undefined || state.prompt_id === entry.promptId));
      const current = active.find(([id]) => id === entry.nodeId) ?? active.at(-1);
      if (current) {
        const [id, state] = current;
        if (node(entry, state.node_id ?? id, state.real_node_id ?? state.display_node_id)) { entry.status = "running"; counters(entry, state.value, state.max, true); }
      } else { clearNode(entry); entry.lastUpdated = now(); }
    } else if (envelope.type === "executed" && String(data.node) === entry.nodeId) {
      clearNode(entry); entry.lastUpdated = now();
    } else if (["execution_success", "execution_error", "execution_interrupted"].includes(envelope.type)) {
      entry.status = envelope.type === "execution_success" ? "completed" : envelope.type === "execution_interrupted" ? "cancelled" : "failed";
      entry.executionEndTime = finiteTime(data.timestamp);
      clearNode(entry); entry.lastUpdated = entry.executionEndTime ?? now();
      closeSocket(entry);
    }
  }
  function connect(entry) {
    if (stopped || entry.socket || TERMINAL.has(entry.status) || now() < entry.retryAt) return;
    // Reconnecting with an unrelated browser's clientId would replace its socket.
    if (!entry.clientId?.startsWith("premiere316-") || typeof WebSocketImpl !== "function") {
      entry.connection = "unavailable";
      return;
    }
    let socket;
    try { socket = new WebSocketImpl(`${SOCKET_ENDPOINT}?${new URLSearchParams({ clientId: entry.clientId })}`); }
    catch (error) { entry.connection = "disconnected"; entry.retryAt = now() + retryDelayMs; entry.error = message(error); return; }
    entry.socket = socket;
    entry.connection = "connecting";
    socket.binaryType = "arraybuffer";
    const disconnected = () => {
      if (entry.socket !== socket) return;
      closeSocket(entry, "disconnected");
      entry.retryAt = now() + retryDelayMs;
    };
    socket.addEventListener("open", () => {
      if (entry.socket !== socket) return;
      clearTimeout(entry.connectTimer); entry.connectTimer = null;
      entry.connection = "connected";
      entry.error = undefined;
      // A reconnect identifies the current node; old counters are stale until
      // a new measured progress event arrives.
      clearNode(entry);
    });
    socket.addEventListener("message", event => { if (entry.socket === socket && !stopped) receive(entry, event); });
    socket.addEventListener("error", disconnected);
    socket.addEventListener("close", disconnected);
    entry.connectTimer = setTimeout(disconnected, connectionTimeoutMs);
    entry.connectTimer.unref?.();
  }
  async function json(path) {
    const response = await fetchImpl(`${ENDPOINT}${path}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) { const error = new Error(`LTX Director progress returned HTTP ${response.status}.`); error.httpStatus = response.status; throw error; }
    return response.json();
  }
  async function refresh(entry) {
    try {
      const job = await json(`/api/jobs/${entry.promptId}`);
      if (stopped) return snapshot(entry);
      if (job?.id !== entry.promptId || !Object.hasOwn(STATES, job.status)) throw new Error("LTX Director returned invalid job progress.");
      entry.status = STATES[job.status];
      entry.observedAt = now();
      entry.error = undefined;
      entry.executionStartTime = finiteTime(job.execution_start_time) ?? entry.executionStartTime;
      entry.executionEndTime = finiteTime(job.execution_end_time) ?? entry.executionEndTime;
      if (TERMINAL.has(entry.status)) {
        clearNode(entry);
        entry.lastUpdated = entry.executionEndTime ?? entry.lastUpdated;
        closeSocket(entry);
      } else {
        if (!entry.clientId) {
          const queue = await json("/queue");
          if (stopped) return snapshot(entry);
          const item = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].find(item => item?.[1] === entry.promptId);
          if (item) {
            const clientId = item[3]?.client_id;
            entry.clientId = typeof clientId === "string" && clientId.length <= 200 ? clientId : null;
            entry.nodes = item[2] && typeof item[2] === "object" ? item[2] : {};
          }
        }
        connect(entry);
      }
    } catch (error) {
      if (error.httpStatus === 404) {
        entry.status = "unknown"; clearNode(entry); closeSocket(entry);
      }
      entry.error = message(error);
    }
    return snapshot(entry);
  }
  async function getProgress(promptId) {
    if (typeof promptId !== "string" || !UUID.test(promptId)) return { promptId, status: "unknown", connection: "unavailable", error: "Invalid Director job ID." };
    const entry = entryFor(promptId);
    if (stopped) return snapshot(entry);
    entry.pending ??= refresh(entry).finally(() => { entry.pending = null; });
    return entry.pending;
  }
  function stop() {
    stopped = true;
    for (const entry of entries.values()) closeSocket(entry, "disconnected");
  }
  return { getProgress, stop };
}
