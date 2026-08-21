import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadProject, saveProject } from "./projects.js";
import { projectDir } from "./paths.js";
import {
  acquireGpuLease,
  releaseGpuLease,
  updateGpuLease,
  GPU_RESOURCE_OWNERS
} from "./gpu-resource-manager.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const QWEN_VOICE_DESIGN_ENGINE = "Qwen3-TTS VoiceDesign";
export const QWEN_VOICE_DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";
export const QWEN_VOICE_DESIGN_MODEL_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3";
export const QWEN_VOICE_DESIGN_CODE_REVISION = "022e286b98fbec7e1e916cb940cdf532cd9f488e";
export const QWEN_VOICE_DESIGN_NATIVE_SAMPLE_RATE = 24_000;
export const QWEN_VOICE_DESIGN_PRODUCTION_SAMPLE_RATE = 48_000;

const AUDIBLE_METADATA = /\[(?:character|style|voice\s*id|pause)\b[^\]]*\]/i;
const ACTIVE_SESSION_STATUSES = new Set(["queued", "loading", "generating", "cancelling"]);
const PROJECT_SAVE_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const PROJECT_SAVE_WAIT = new Int32Array(new SharedArrayBuffer(4));
const DESCRIPTION_FIELDS = Object.freeze([
  "apparentAge",
  "genderPresentation",
  "vocalRegister",
  "vocalWeight",
  "timbre",
  "texture",
  "resonance",
  "accentCadence",
  "diction",
  "baselinePace",
  "emotionalTemperament",
  "performanceStyle",
  "intensity",
  "historicalCinematicDirection",
  "exclusions"
]);

const LANGUAGE_ALIASES = Object.freeze({
  auto: "Auto",
  en: "English",
  english: "English",
  zh: "Chinese",
  chinese: "Chinese",
  de: "German",
  german: "German",
  it: "Italian",
  italian: "Italian",
  pt: "Portuguese",
  portuguese: "Portuguese",
  es: "Spanish",
  spanish: "Spanish",
  ja: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  korean: "Korean",
  fr: "French",
  french: "French",
  ru: "Russian",
  russian: "Russian"
});

let activeWorker = null;
let activeInstall = null;
let latestInstallState = {
  status: "idle",
  stage: "Not installing",
  progress: 0,
  bytesDownloaded: 0,
  totalBytes: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  pid: null
};

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value, fallback)));
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Math.round(boundedNumber(value, fallback, minimum, maximum));
}

function cleanText(value, fallback = "", maxLength = 4_000) {
  const cleaned = String(value ?? "").replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function readJsonMaybe(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : null;
  } catch {
    return null;
  }
}

function resolveManifestPath(root, value, fallback) {
  const candidate = cleanText(value, fallback, 2_048);
  return path.resolve(path.isAbsolute(candidate) ? candidate : path.join(root, candidate));
}

function directoryBytes(root) {
  if (!root || !fs.existsSync(root)) return 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) {
        try { total += fs.statSync(absolute).size; } catch {}
      }
    }
  }
  return total;
}

function revisionFromManifest(manifest, kind) {
  if (!manifest || typeof manifest !== "object") return null;
  const value = kind === "model"
    ? manifest.model?.modelRevision || manifest.model?.revision || manifest.modelRevision
    : manifest.source?.codeRevision || manifest.source?.revision || manifest.codeRevision;
  return cleanText(value, "", 128) || null;
}

function readGitRevision(root) {
  try {
    const gitEntry = path.join(root, ".git");
    let gitDir = gitEntry;
    if (fs.statSync(gitEntry).isFile()) {
      const link = fs.readFileSync(gitEntry, "utf8").match(/^gitdir:\s*(.+)$/mi)?.[1]?.trim();
      if (!link) return null;
      gitDir = path.resolve(root, link);
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[a-f\d]{40}$/i.test(head)) return head.toLowerCase();
    const ref = head.match(/^ref:\s*(.+)$/)?.[1];
    if (!ref) return null;
    const loose = path.join(gitDir, ...ref.split("/"));
    if (fs.existsSync(loose)) {
      const value = fs.readFileSync(loose, "utf8").trim();
      if (/^[a-f\d]{40}$/i.test(value)) return value.toLowerCase();
    }
    const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8")
      .split(/\r?\n/)
      .find((line) => line.endsWith(` ${ref}`));
    return packed?.match(/^([a-f\d]{40})\s/)?.[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isCompleteQwenVoiceDesignModelDirectory(modelDir) {
  return requiredModelFiles({ modelDir }).every(([, file]) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

function manifestWeightHashes(manifest) {
  return [
    ["main model weights", "model.safetensors", manifest?.model?.mainWeightsSha256],
    ["speech tokenizer weights", "speech_tokenizer/model.safetensors", manifest?.model?.speechTokenizerWeightsSha256]
  ].map(([label, relativeFile, expected]) => ({
    label,
    relativeFile,
    expected: cleanText(expected, "", 128).toLowerCase()
  }));
}

function huggingFaceWeightMetadata(modelDir, relativeFile) {
  const metadataFile = path.join(modelDir, ".cache", "huggingface", "download", `${relativeFile}.metadata`);
  try {
    const [revision, etag] = fs.readFileSync(metadataFile, "utf8").split(/\r?\n/, 2);
    return {
      revision: cleanText(revision, "", 128).toLowerCase() || null,
      sha256: cleanText(etag, "", 128).toLowerCase() || null
    };
  } catch {
    return { revision: null, sha256: null };
  }
}

const ROOT_LOCAL_WEIGHT_HASH_CACHE = new Map();

function cachedLargeFileSha256(file, expectedSha256) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return null;
  const absolute = path.resolve(file);
  const key = `${absolute}\u0000${stat.size}\u0000${stat.mtimeMs}\u0000${expectedSha256}`;
  if (ROOT_LOCAL_WEIGHT_HASH_CACHE.has(key)) return ROOT_LOCAL_WEIGHT_HASH_CACHE.get(key);

  // model.safetensors is larger than Node's single-Buffer limit. Hash it in
  // bounded chunks, then cache the proof for this exact path/size/mtime.
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  const descriptor = fs.openSync(absolute, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const actual = hash.digest("hex");
  for (const cachedKey of ROOT_LOCAL_WEIGHT_HASH_CACHE.keys()) {
    if (cachedKey.startsWith(`${absolute}\u0000`)) ROOT_LOCAL_WEIGHT_HASH_CACHE.delete(cachedKey);
  }
  ROOT_LOCAL_WEIGHT_HASH_CACHE.set(key, actual);
  return actual;
}

function validateRootLocalQwenVoiceDesignFallback(modelDir, manifest) {
  const errors = [];
  const expectedRevision = revisionFromManifest(manifest, "model")?.toLowerCase() || null;
  if (expectedRevision !== QWEN_VOICE_DESIGN_MODEL_REVISION) {
    errors.push({
      label: "root-local fallback manifest model revision",
      expected: QWEN_VOICE_DESIGN_MODEL_REVISION,
      actual: expectedRevision
    });
  }
  for (const weight of manifestWeightHashes(manifest)) {
    if (!/^[a-f\d]{64}$/.test(weight.expected)) {
      errors.push({
        label: `root-local fallback ${weight.label} manifest SHA-256`,
        expected: "64-character SHA-256",
        actual: weight.expected || null
      });
      continue;
    }
    const metadata = huggingFaceWeightMetadata(modelDir, weight.relativeFile);
    if (metadata.revision !== expectedRevision) {
      errors.push({
        label: `root-local fallback ${weight.label} Hugging Face metadata revision`,
        expected: expectedRevision,
        actual: metadata.revision
      });
    }
    if (metadata.sha256 !== weight.expected) {
      errors.push({
        label: `root-local fallback ${weight.label} Hugging Face metadata SHA-256`,
        expected: weight.expected,
        actual: metadata.sha256
      });
    }
    const weightFile = path.join(modelDir, ...weight.relativeFile.split("/"));
    let actualHash = null;
    try { actualHash = cachedLargeFileSha256(weightFile, weight.expected); } catch {}
    if (actualHash !== weight.expected) {
      errors.push({
        label: `root-local fallback ${weight.label} SHA-256`,
        expected: weight.expected,
        actual: actualHash
      });
    }
  }
  return { trusted: errors.length === 0, errors };
}

export function resolveQwenVoiceDesignPaths(env = process.env, platform = process.platform) {
  const localAppData = cleanText(env.LOCALAPPDATA, path.join(os.homedir(), "AppData", "Local"), 2_048);
  const root = path.resolve(cleanText(
    env.QWEN3_TTS_VOICE_DESIGN_ROOT || env.QWEN_VOICE_DESIGN_ROOT,
    path.join(localAppData, "Premiere316", "Qwen3-TTS-VoiceDesign"),
    2_048
  ));
  const manifestFile = path.join(root, "premiere316-install.json");
  const manifest = readJsonMaybe(manifestFile);
  const manifestModelDir = manifest?.model?.localDirectory || manifest?.modelDir || "models/Qwen3-TTS-12Hz-1.7B-VoiceDesign";
  const resolvedManifestModelDir = resolveManifestPath(root, manifestModelDir, "models/Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  const rootLocalModelDir = path.resolve(root, "models", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  const explicitModelDir = cleanText(
    env.QWEN3_TTS_VOICE_DESIGN_MODEL_DIR || env.QWEN_VOICE_DESIGN_MODEL_DIR,
    "",
    2_048
  );
  const shouldConsiderRootLocalFallback = !explicitModelDir
    && resolvedManifestModelDir !== rootLocalModelDir
    && !isCompleteQwenVoiceDesignModelDirectory(resolvedManifestModelDir)
    && isCompleteQwenVoiceDesignModelDirectory(rootLocalModelDir);
  const rootLocalFallback = shouldConsiderRootLocalFallback
    ? validateRootLocalQwenVoiceDesignFallback(rootLocalModelDir, manifest)
    : null;
  const modelDir = path.resolve(explicitModelDir || (
    rootLocalFallback?.trusted ? rootLocalModelDir : resolvedManifestModelDir
  ));
  const defaultPython = platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  return {
    root,
    manifestFile,
    manifest,
    modelDir,
    rootLocalFallback,
    sourceDir: resolveManifestPath(root, manifest?.source?.localDirectory, "source"),
    python: path.resolve(cleanText(env.QWEN3_TTS_VOICE_DESIGN_PYTHON, manifest?.runtime?.pythonExecutable || defaultPython, 2_048)),
    worker: path.join(PACKAGE_ROOT, "scripts", "qwen_voice_design_worker.py"),
    installer: path.join(PACKAGE_ROOT, "scripts", "install_qwen_voice_design.ps1"),
    progressFile: path.join(root, "download-progress.json"),
    idleMs: Math.max(10_000, finite(env.QWEN3_TTS_VOICE_DESIGN_IDLE_MS, 180_000)),
    attentionImplementation: cleanText(env.QWEN3_TTS_VOICE_DESIGN_ATTENTION, "sdpa", 32) === "flash_attention_2"
      ? "flash_attention_2"
      : "sdpa"
  };
}

function requiredModelFiles(paths) {
  return [
    ["model config", path.join(paths.modelDir, "config.json")],
    ["model weights", path.join(paths.modelDir, "model.safetensors")],
    ["text tokenizer config", path.join(paths.modelDir, "tokenizer_config.json")],
    ["text tokenizer vocabulary", path.join(paths.modelDir, "vocab.json")],
    ["text tokenizer merges", path.join(paths.modelDir, "merges.txt")],
    ["speech tokenizer config", path.join(paths.modelDir, "speech_tokenizer", "config.json")],
    ["speech tokenizer weights", path.join(paths.modelDir, "speech_tokenizer", "model.safetensors")]
  ];
}

export function qwenVoiceDesignInstallStatus() {
  return { ...latestInstallState };
}

export function qwenVoiceDesignHealth(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveQwenVoiceDesignPaths(env, options.platform || process.platform);
  const manifest = options.manifest === undefined ? readJsonMaybe(paths.manifestFile) : options.manifest;
  const progress = readJsonMaybe(paths.progressFile) || {};
  const declaredCodeRevision = cleanText(env.QWEN3_TTS_VOICE_DESIGN_CODE_REVISION, "", 128)
    || revisionFromManifest(manifest, "code");
  const sourceDir = paths.sourceDir || resolveManifestPath(paths.root, manifest?.source?.localDirectory, "source");
  const actualCodeRevision = manifest?.source?.localDirectory ? readGitRevision(sourceDir) : null;
  const codeRevision = actualCodeRevision || declaredCodeRevision;
  const modelRevision = cleanText(env.QWEN3_TTS_VOICE_DESIGN_MODEL_REVISION, "", 128)
    || revisionFromManifest(manifest, "model");
  const required = [
    ["install manifest", paths.manifestFile],
    ["standalone Python", paths.python],
    ["Premiere316 worker", paths.worker],
    ...requiredModelFiles(paths)
  ];
  if (manifest?.source?.localDirectory) required.push(["official source checkout", path.join(sourceDir, ".git", "HEAD")]);
  const missing = required
    .filter(([, file]) => !fs.existsSync(file) || !fs.statSync(file).isFile())
    .map(([label, file]) => ({ label, file }));
  const revisionErrors = [];
  if (codeRevision !== QWEN_VOICE_DESIGN_CODE_REVISION) {
    revisionErrors.push({
      label: "official code revision",
      expected: QWEN_VOICE_DESIGN_CODE_REVISION,
      actual: codeRevision
    });
  }
  if (actualCodeRevision && declaredCodeRevision && actualCodeRevision !== declaredCodeRevision) {
    revisionErrors.push({
      label: "source checkout versus install manifest",
      expected: declaredCodeRevision,
      actual: actualCodeRevision
    });
  }
  if (modelRevision !== QWEN_VOICE_DESIGN_MODEL_REVISION) {
    revisionErrors.push({
      label: "official model revision",
      expected: QWEN_VOICE_DESIGN_MODEL_REVISION,
      actual: modelRevision
    });
  }
  const fallbackErrors = paths.rootLocalFallback?.errors || [];
  const workerMatches = Boolean(activeWorker?.isRunningFor(paths));
  const bytesDownloaded = finite(
    activeInstall ? latestInstallState.bytesDownloaded : progress.bytesDownloaded ?? manifest?.download?.bytesDownloaded,
    directoryBytes(paths.modelDir)
  );
  const totalBytes = finite(
    activeInstall ? latestInstallState.totalBytes : progress.totalBytes ?? manifest?.download?.totalBytes,
    null
  );
  const ready = missing.length === 0 && revisionErrors.length === 0 && fallbackErrors.length === 0;
  const reasonParts = [];
  if (missing.length) reasonParts.push(`missing ${missing.map((entry) => entry.label).join(", ")}`);
  if (revisionErrors.length) reasonParts.push(`revision mismatch: ${revisionErrors.map((entry) => entry.label).join(", ")}`);
  if (fallbackErrors.length) reasonParts.push(`root-local fallback rejected: ${fallbackErrors.map((entry) => entry.label).join(", ")}`);
  return {
    installed: fs.existsSync(paths.root),
    ready,
    available: ready,
    loaded: workerMatches && activeWorker.loaded,
    busy: workerMatches && activeWorker.busy,
    workerPid: workerMatches ? activeWorker.pid : null,
    engine: QWEN_VOICE_DESIGN_ENGINE,
    model: QWEN_VOICE_DESIGN_MODEL,
    root: paths.root,
    sourceDir,
    modelDir: paths.modelDir,
    python: paths.python,
    manifestFile: paths.manifestFile,
    precision: "bf16",
    attentionImplementation: workerMatches && activeWorker.attentionImplementation
      ? activeWorker.attentionImplementation
      : paths.attentionImplementation,
    codeRevision,
    declaredCodeRevision,
    actualCodeRevision,
    modelRevision,
    expectedCodeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    expectedModelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    missing,
    revisionErrors,
    rootLocalFallback: paths.rootLocalFallback
      ? { trusted: paths.rootLocalFallback.trusted, errors: fallbackErrors }
      : null,
    download: {
      status: activeInstall ? latestInstallState.status : cleanText(progress.status, ready ? "complete" : "idle", 64),
      stage: activeInstall ? latestInstallState.stage : cleanText(progress.stage, "", 300) || null,
      bytesDownloaded,
      totalBytes,
      progress: totalBytes > 0 ? Math.max(0, Math.min(1, bytesDownloaded / totalBytes)) : finite(progress.progress, 0),
      pid: activeInstall ? latestInstallState.pid : null,
      error: activeInstall ? latestInstallState.error : progress.error || null
    },
    reason: ready ? null : `Qwen VoiceDesign is not ready: ${reasonParts.join("; ")}`
  };
}

function cancellationError(message = "Qwen VoiceDesign operation stopped by director") {
  return Object.assign(new Error(message), { code: "GENERATION_CANCELLED" });
}

function terminateOwnedProcess(child) {
  if (!child || child.exitCode != null) return;
  const pid = child.pid;
  if (process.platform === "win32" && Number.isInteger(pid)) {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.unref?.();
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try { child.kill("SIGTERM"); } catch {}
  }
}

function waitForOwnedProcessExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once("close", finish);
    timer = setTimeout(() => {
      terminateOwnedProcess(child);
      const forceTimer = setTimeout(finish, 2_000);
      forceTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();
  });
}

function installerCommand(paths) {
  if (process.platform === "win32") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", paths.installer,
        "-RuntimeRoot", paths.root,
        "-SourceDir", paths.sourceDir,
        "-ModelDir", paths.modelDir,
        "-CodeRevision", QWEN_VOICE_DESIGN_CODE_REVISION,
        "-ModelRevision", QWEN_VOICE_DESIGN_MODEL_REVISION
      ]
    };
  }
  return {
    executable: "pwsh",
    args: [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", paths.installer,
      "-RuntimeRoot", paths.root, "-SourceDir", paths.sourceDir,
      "-ModelDir", paths.modelDir,
      "-CodeRevision", QWEN_VOICE_DESIGN_CODE_REVISION,
      "-ModelRevision", QWEN_VOICE_DESIGN_MODEL_REVISION
    ]
  };
}

export async function installQwenVoiceDesignJob(job, options = {}) {
  const paths = options.paths || resolveQwenVoiceDesignPaths(options.env || process.env, options.platform || process.platform);
  const before = qwenVoiceDesignHealth({ paths, env: options.env || process.env });
  if (before.ready && options.force !== true) {
    job.stage = "Pinned Qwen VoiceDesign installation is already ready";
    job.progress = 1;
    job.result = { repaired: false, health: before };
    return job.result;
  }
  if (activeInstall) {
    throw Object.assign(new Error(`Qwen VoiceDesign installation is already ${latestInstallState.status}`), {
      code: "QWEN_INSTALL_IN_PROGRESS",
      statusCode: 409
    });
  }
  if (activeWorker?.busy) {
    throw Object.assign(new Error("Cancel the active Qwen VoiceDesign generation before repairing its runtime"), {
      code: "QWEN_WORKER_BUSY",
      statusCode: 409
    });
  }
  if (activeWorker?.child) {
    job.stage = "Unloading Qwen VoiceDesign before runtime repair";
    job.progress = 0.01;
    await unloadQwenVoiceDesign();
  }
  if (!fs.existsSync(paths.installer)) throw new Error(`Pinned Qwen VoiceDesign installer is missing: ${paths.installer}`);
  fs.mkdirSync(paths.root, { recursive: true });
  const command = installerCommand(paths);
  const child = spawn(command.executable, command.args, {
    cwd: PACKAGE_ROOT,
    windowsHide: true,
    env: { ...process.env, PYTHONNOUSERSITE: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  latestInstallState = {
    status: "running",
    stage: "Starting pinned Qwen VoiceDesign installer",
    progress: 0.01,
    bytesDownloaded: before.download.bytesDownloaded || 0,
    totalBytes: before.download.totalBytes,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pid: child.pid || null
  };
  activeInstall = { child, jobId: job.id || null };
  job.stage = latestInstallState.stage;
  job.progress = latestInstallState.progress;
  let stderrTail = "";
  const onAbort = () => terminateOwnedProcess(child);
  job.signal?.addEventListener?.("abort", onAbort, { once: true });
  child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-8_000); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type !== "progress") return;
    latestInstallState.stage = cleanText(message.stage, latestInstallState.stage, 500);
    latestInstallState.progress = boundedNumber(message.progress, latestInstallState.progress, 0, 1);
    latestInstallState.bytesDownloaded = Math.max(0, finite(message.bytesDownloaded, latestInstallState.bytesDownloaded));
    latestInstallState.totalBytes = finite(message.totalBytes, latestInstallState.totalBytes);
    job.stage = latestInstallState.stage;
    job.progress = latestInstallState.progress;
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (job.signal?.aborted) throw cancellationError("Qwen VoiceDesign installation cancelled");
    if (code !== 0) throw new Error(`Pinned Qwen VoiceDesign installer exited ${code}: ${stderrTail.slice(-3_000)}`);
    const health = qwenVoiceDesignHealth({ paths, env: options.env || process.env });
    if (!health.ready) throw new Error(health.reason);
    latestInstallState.status = "complete";
    latestInstallState.stage = "Pinned Qwen VoiceDesign installation ready";
    latestInstallState.progress = 1;
    latestInstallState.bytesDownloaded = health.download.bytesDownloaded;
    latestInstallState.totalBytes = health.download.totalBytes;
    latestInstallState.finishedAt = new Date().toISOString();
    job.stage = latestInstallState.stage;
    job.progress = 1;
    job.result = { repaired: true, health };
    return job.result;
  } catch (error) {
    const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted;
    latestInstallState.status = cancelled ? "cancelled" : "error";
    latestInstallState.stage = cancelled ? "Installation cancelled" : "Installation failed";
    latestInstallState.error = cancelled ? null : String(error.message || error);
    latestInstallState.finishedAt = new Date().toISOString();
    throw cancelled && error?.code !== "GENERATION_CANCELLED" ? cancellationError("Qwen VoiceDesign installation cancelled") : error;
  } finally {
    job.signal?.removeEventListener?.("abort", onAbort);
    lines.close();
    latestInstallState.pid = null;
    activeInstall = null;
  }
}

export function cancelQwenVoiceDesignInstall() {
  if (!activeInstall?.child) return false;
  terminateOwnedProcess(activeInstall.child);
  return true;
}

export class PersistentQwenVoiceDesignWorker {
  constructor(paths) {
    this.paths = paths;
    this.child = null;
    this.pending = new Map();
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.stderrTail = "";
    this.loaded = false;
    this.busy = false;
    this.attentionImplementation = paths.attentionImplementation || "sdpa";
    this.idleTimer = null;
    this.stopping = false;
  }

  get pid() {
    return this.child?.exitCode == null ? this.child?.pid || null : null;
  }

  isRunningFor(paths) {
    return Boolean(
      this.child && this.child.exitCode == null
      && path.resolve(this.paths.root) === path.resolve(paths.root)
      && path.resolve(this.paths.modelDir) === path.resolve(paths.modelDir)
    );
  }

  start() {
    if (this.child && this.child.exitCode == null) return this.readyPromise;
    acquireGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      label: QWEN_VOICE_DESIGN_ENGINE,
      state: "starting-worker"
    });
    this.stopping = false;
    this.loaded = false;
    this.busy = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const child = spawn(this.paths.python, [
      this.paths.worker,
      "--model-dir", this.paths.modelDir,
      "--model-id", QWEN_VOICE_DESIGN_MODEL,
      "--model-revision", QWEN_VOICE_DESIGN_MODEL_REVISION,
      "--code-revision", QWEN_VOICE_DESIGN_CODE_REVISION,
      "--device", "cuda:0",
      "--attention", this.paths.attentionImplementation || "sdpa"
    ], {
      cwd: this.paths.root,
      windowsHide: true,
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        PYTHONNOUSERSITE: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      workerPid: child.pid || null,
      state: "worker-ready"
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderrTail = `${this.stderrTail}${text}`.slice(-12_000);
      if (text.trim()) process.stderr.write(`[Qwen VoiceDesign] ${text}`);
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.once("error", (error) => this.handleExit(error));
    child.once("close", (code) => {
      lines.close();
      if (!this.stopping) this.handleExit(new Error(`Qwen VoiceDesign worker exited ${code}: ${this.stderrTail.slice(-3_000)}`));
      else this.handleExit(cancellationError());
    });
    const timer = setTimeout(() => {
      if (this.resolveReady) {
        this.rejectReady?.(new Error("Qwen VoiceDesign worker did not start its JSON protocol in time"));
        this.resolveReady = null;
        this.rejectReady = null;
        this.terminate();
      }
    }, 30_000);
    timer.unref?.();
    this.readyPromise.finally(() => clearTimeout(timer)).catch(() => {});
    return this.readyPromise;
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch {
      this.handleExit(new Error(`Qwen VoiceDesign wrote non-JSON protocol output: ${String(line).slice(0, 300)}`));
      this.terminate();
      return;
    }
    if (message.type === "ready") {
      this.loaded = Boolean(message.loaded);
      this.attentionImplementation = message.attentionImplementation || this.attentionImplementation;
      updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
        workerPid: this.pid,
        state: this.loaded ? "loaded" : "worker-ready"
      });
      const resolve = this.resolveReady;
      this.resolveReady = null;
      this.rejectReady = null;
      resolve?.(message);
      return;
    }
    const pending = this.pending.get(String(message.id || ""));
    if (!pending) return;
    if (message.type === "progress") {
      updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
        workerPid: this.pid,
        state: pending.command === "load" ? "loading" : pending.command === "generate" ? "generating" : "busy"
      });
      pending.onProgress?.(message);
      return;
    }
    if (message.type !== "response") return;
    this.pending.delete(String(message.id));
    pending.cleanup();
    this.busy = this.pending.size > 0;
    if (message.ok) {
      if (message.result?.loaded != null) this.loaded = Boolean(message.result.loaded);
      if (message.result?.attentionImplementation) this.attentionImplementation = message.result.attentionImplementation;
      pending.resolve(message.result || {});
    } else {
      pending.reject(new Error(cleanText(message.error, "Qwen VoiceDesign worker request failed", 4_000)));
      // A failed first load leaves no useful resident model and may retain
      // partially allocated CUDA state. Terminating the owned subprocess is
      // the reliable Windows memory boundary and releases the GPU lease in
      // handleExit. Generation failures after a successful load can keep the
      // healthy model resident for a retry.
      if (!this.loaded) this.terminate();
    }
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      workerPid: this.pid,
      state: this.loaded ? "loaded" : "worker-ready"
    });
    this.armIdleTimer();
  }

  handleExit(error) {
    const rejectReady = this.rejectReady;
    this.resolveReady = null;
    this.rejectReady = null;
    rejectReady?.(error);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error?.code === "GENERATION_CANCELLED" ? error : new Error(String(error?.message || error)));
    }
    this.pending.clear();
    this.child = null;
    this.readyPromise = null;
    this.loaded = false;
    this.busy = false;
    clearTimeout(this.idleTimer);
    releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN);
  }

  async request(command, payload = {}, { signal = null, onProgress = null } = {}) {
    if (signal?.aborted) throw cancellationError();
    await this.start();
    if (!this.child || this.child.exitCode != null) throw new Error("Qwen VoiceDesign worker is not running");
    if (this.busy) {
      throw Object.assign(new Error("Qwen VoiceDesign worker is already busy"), {
        code: "QWEN_WORKER_BUSY",
        statusCode: 409
      });
    }
    clearTimeout(this.idleTimer);
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      workerPid: this.pid,
      state: command === "load" ? "loading" : command === "generate" ? "generating" : command === "shutdown" ? "unloading" : "busy"
    });
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        this.busy = this.pending.size > 0;
        this.terminate();
        reject(cancellationError());
      };
      const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      this.pending.set(id, { resolve, reject, cleanup, onProgress, command });
      this.busy = true;
      try {
        this.child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`);
      } catch (error) {
        this.pending.delete(id);
        this.busy = this.pending.size > 0;
        cleanup();
        reject(error);
      }
    });
  }

  async load(options = {}) {
    return this.request("load", {}, options);
  }

  armIdleTimer() {
    clearTimeout(this.idleTimer);
    if (!this.loaded || this.busy) return;
    this.idleTimer = setTimeout(() => { void this.shutdown().catch(() => this.terminate()); }, this.paths.idleMs);
    this.idleTimer.unref?.();
  }

  async shutdown() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child || child.exitCode != null) return;
    if (this.busy) {
      updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
        workerPid: child.pid || null,
        state: "terminating"
      });
      this.terminate();
      await waitForOwnedProcessExit(child);
      return;
    }
    this.stopping = true;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      workerPid: child.pid || null,
      state: "unloading"
    });
    try { await this.request("shutdown"); } catch {}
    try { child.stdin.end(); } catch {}
    await waitForOwnedProcessExit(child);
  }

  terminate() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child || child.exitCode != null) return;
    this.stopping = true;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
      workerPid: child.pid || null,
      state: "terminating"
    });
    terminateOwnedProcess(child);
  }
}

function getWorker(paths) {
  if (!activeWorker?.isRunningFor(paths)) {
    activeWorker?.terminate();
    activeWorker = new PersistentQwenVoiceDesignWorker(paths);
  }
  return activeWorker;
}

export async function loadQwenVoiceDesign(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveQwenVoiceDesignPaths(env, options.platform || process.platform);
  const health = qwenVoiceDesignHealth({ paths, env });
  if (!health.ready) throw Object.assign(new Error(health.reason), { statusCode: 503 });
  const result = await getWorker(paths).load({ signal: options.signal, onProgress: options.onProgress });
  return { ...qwenVoiceDesignHealth({ paths, env }), loadResult: result };
}

export async function unloadQwenVoiceDesign(options = {}) {
  const worker = activeWorker;
  if (!worker) return { released: true, wasLoaded: false };
  const wasLoaded = worker.loaded;
  await worker.shutdown();
  activeWorker = null;
  return { released: true, wasLoaded };
}

export function cancelQwenVoiceDesignWorker() {
  if (!activeWorker?.child) return false;
  activeWorker.terminate();
  activeWorker = null;
  return true;
}

export function normalizeVoiceDesignLanguage(value) {
  const key = cleanText(value, "English", 64).toLowerCase();
  const language = LANGUAGE_ALIASES[key];
  if (!language) {
    throw Object.assign(new Error(`Unsupported Qwen VoiceDesign language: ${value}`), { statusCode: 400 });
  }
  return language;
}

export function normalizeVoiceDesignSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    temperature: boundedNumber(source.temperature, 0.9, 0.1, 2),
    topP: boundedNumber(source.topP, 0.8, 0.05, 1),
    topK: boundedInteger(source.topK, 50, 1, 200),
    repetitionPenalty: boundedNumber(source.repetitionPenalty, 1.05, 0.5, 2),
    maxNewTokens: boundedInteger(source.maxNewTokens, 2048, 128, 4096),
    create48kCopy: source.create48kCopy !== false
  };
}

export function normalizeVoiceDescriptionFields(fields = {}) {
  const source = fields && typeof fields === "object" ? fields : {};
  const normalized = {};
  for (const field of DESCRIPTION_FIELDS) {
    const value = field === "exclusions" && Array.isArray(source[field])
      ? source[field].map((entry) => cleanText(entry, "", 200)).filter(Boolean).join(", ")
      : cleanText(source[field], "", 400);
    normalized[field] = value;
  }
  return normalized;
}

export function compileVoiceDescription(fields = {}) {
  const value = normalizeVoiceDescriptionFields(fields);
  const identity = [value.apparentAge, value.genderPresentation].filter(Boolean).join(" ");
  const voice = [value.vocalRegister, value.vocalWeight, value.timbre, value.texture, value.resonance].filter(Boolean).join(", ");
  const delivery = [value.accentCadence, value.diction, value.baselinePace].filter(Boolean).join(", ");
  const performance = [value.emotionalTemperament, value.performanceStyle, value.intensity].filter(Boolean).join(", ");
  const sentences = [];
  if (identity || voice) sentences.push(`${[identity, voice].filter(Boolean).join(", ")} voice.`);
  if (delivery) sentences.push(`Speak with ${delivery}.`);
  if (performance) sentences.push(`Give a ${performance} performance.`);
  if (value.historicalCinematicDirection) sentences.push(`${value.historicalCinematicDirection}.`);
  if (value.exclusions) sentences.push(`Avoid ${value.exclusions}.`);
  return cleanText(sentences.join(" ").replace(/\.\./g, "."), "", 4_000);
}

export function validateAuditionText(value) {
  const text = cleanText(value, "", 2_000);
  if (!text) throw Object.assign(new Error("Audition text is required"), { statusCode: 400 });
  if (AUDIBLE_METADATA.test(text)) {
    throw Object.assign(new Error("Audition text may contain only audible dialogue, not [Character], [Style], [Voice ID], or [pause] metadata"), { statusCode: 400 });
  }
  return text;
}

export function ensureVoiceDesignState(project) {
  if (!project || typeof project !== "object") throw new Error("Project object is required");
  if (!project.sound || typeof project.sound !== "object") project.sound = {};
  project.sound.schemaVersion = Math.max(2, boundedInteger(project.sound.schemaVersion, 2, 1, 1_000));
  project.sound.voices = Array.isArray(project.sound.voices) ? project.sound.voices : [];
  project.sound.generations = Array.isArray(project.sound.generations) ? project.sound.generations : [];
  if (!project.sound.voiceDesign || typeof project.sound.voiceDesign !== "object") {
    project.sound.voiceDesign = { schemaVersion: 1, sessions: [], savedVoices: [], defaultByCharacter: {} };
  }
  const state = project.sound.voiceDesign;
  state.schemaVersion = 1;
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.savedVoices = Array.isArray(state.savedVoices) ? state.savedVoices : [];
  state.defaultByCharacter = state.defaultByCharacter && typeof state.defaultByCharacter === "object"
    ? state.defaultByCharacter
    : {};
  return state;
}

function stableId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function fileSlug(value, fallback = "voice") {
  return cleanText(value, fallback, 100)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || fallback;
}

function normalizeRelativeFile(value) {
  return cleanText(value, "", 2_048).replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export function safeVoiceDesignProjectFile(projectSlug, relativeFile, allowedPrefix = null) {
  const slug = cleanText(projectSlug, "", 200);
  if (!slug || path.basename(slug) !== slug || slug === "." || slug === "..") throw new Error("Invalid project slug");
  const relative = normalizeRelativeFile(relativeFile);
  if (!relative || relative.includes("\0") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid Qwen VoiceDesign project-relative file");
  }
  const normalizedPrefix = allowedPrefix ? `${normalizeRelativeFile(allowedPrefix).replace(/\/+$/, "")}/` : null;
  if (normalizedPrefix && !relative.startsWith(normalizedPrefix)) throw new Error("Qwen VoiceDesign file is outside its allowed project directory");
  const root = path.resolve(projectDir(slug));
  const candidate = path.resolve(root, ...relative.split("/"));
  if (!isInside(root, candidate)) throw new Error("Qwen VoiceDesign file escaped the project directory");
  return candidate;
}

export function voiceDesignMediaUrl(projectSlug, relativeFile) {
  const relative = normalizeRelativeFile(relativeFile);
  const match = relative.match(/^media\/(audio|assets)\/(.+)$/);
  if (!match || match[2].split("/").some((part) => !part || part === "." || part === "..")) return null;
  return `/media/${encodeURIComponent(projectSlug)}/${match[1]}/${match[2].split("/").map(encodeURIComponent).join("/")}`;
}

function saveProjectWithRetry(project) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return saveProject(project);
    } catch (error) {
      lastError = error;
      if (!PROJECT_SAVE_RETRY_CODES.has(String(error?.code || "")) || attempt === 5) throw error;
      Atomics.wait(PROJECT_SAVE_WAIT, 0, 0, 25 * (2 ** attempt));
    }
  }
  throw lastError;
}

function saveIfRequested(project, options = {}) {
  if (options.persist === false) return project;
  return saveProjectWithRetry(project);
}

function projectFrom(projectOrSlug) {
  return typeof projectOrSlug === "string" ? loadProject(projectOrSlug) : projectOrSlug;
}

function sessionById(project, sessionId) {
  return ensureVoiceDesignState(project).sessions.find((entry) => entry.id === String(sessionId || "")) || null;
}

function auditionById(session, auditionId) {
  return session?.auditions?.find((entry) => entry.id === String(auditionId || "")) || null;
}

function makeAudition(session, index, seed, settings, regeneratedFromAuditionId = null) {
  const id = stableId("qvd_audition");
  const stem = `${String(index).padStart(2, "0")}-${fileSlug(session.voiceName)}-${id.slice(-10)}`;
  const nativeFile = `production/qwen3-tts/voice-design/${session.id}/${stem}.native-24k-f32.wav`;
  const production48kFile = settings.create48kCopy
    ? `media/audio/voice-design/${session.id}/${stem}.48k-pcm24.wav`
    : null;
  const now = new Date().toISOString();
  return {
    id,
    index,
    name: `${session.voiceName} - Audition ${index}`,
    seed,
    generationSettings: structuredClone(settings),
    status: "queued",
    selected: false,
    deletedAt: null,
    regeneratedFromAuditionId,
    nativeFile,
    nativeMediaUrl: null,
    production48kFile,
    productionMediaUrl: production48kFile ? voiceDesignMediaUrl(session.projectSlug, production48kFile) : null,
    nativeSampleRate: null,
    productionSampleRate: production48kFile ? QWEN_VOICE_DESIGN_PRODUCTION_SAMPLE_RATE : null,
    durationSec: null,
    bytes: null,
    sha256: null,
    productionBytes: null,
    productionSha256: null,
    quality: null,
    provenance: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null
  };
}

export function createVoiceDesignSession(project, input = {}, options = {}) {
  const state = ensureVoiceDesignState(project);
  const projectSlug = cleanText(project.slug, "", 200);
  if (!projectSlug) throw new Error("Project slug is required for Qwen VoiceDesign persistence");
  const voiceName = cleanText(input.voiceName, "", 120);
  if (!voiceName) throw Object.assign(new Error("Voice name is required"), { statusCode: 400 });
  const descriptionFields = normalizeVoiceDescriptionFields(input.descriptionFields);
  const compiledFromFields = compileVoiceDescription(descriptionFields);
  const compiledInstruct = cleanText(input.instruct, compiledFromFields, 4_000);
  if (!compiledInstruct) throw Object.assign(new Error("A voice description is required"), { statusCode: 400 });
  const auditionText = validateAuditionText(input.auditionText);
  const auditionCount = boundedInteger(input.auditionCount, 3, 1, 3);
  const settings = normalizeVoiceDesignSettings(input.settings);
  const baseSeed = input.seed == null || input.seed === ""
    ? crypto.randomInt(0, 2_147_000_000)
    : boundedInteger(input.seed, 42, 0, 2_147_483_640);
  const now = new Date().toISOString();
  const session = {
    id: stableId("qvd_session"),
    schemaVersion: 1,
    projectId: cleanText(input.projectId, project.id || projectSlug, 200),
    projectSlug,
    characterId: cleanText(input.characterId, "", 200) || null,
    voiceName,
    engine: QWEN_VOICE_DESIGN_ENGINE,
    modelId: QWEN_VOICE_DESIGN_MODEL,
    codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    language: normalizeVoiceDesignLanguage(input.language),
    descriptionFields,
    compiledInstruct,
    auditionText,
    auditionCount,
    baseSeed,
    settings,
    status: "queued",
    jobId: null,
    selectedAuditionId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    auditions: []
  };
  for (let index = 1; index <= auditionCount; index += 1) {
    session.auditions.push(makeAudition(session, index, baseSeed + index - 1, settings));
  }
  state.sessions.push(session);
  saveIfRequested(project, options);
  return session;
}

export function bindVoiceDesignSessionJob(projectOrSlug, sessionId, jobId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const session = sessionById(project, sessionId);
  if (!session) throw Object.assign(new Error("Qwen VoiceDesign session not found"), { statusCode: 404 });
  session.jobId = cleanText(jobId, "", 200) || null;
  session.updatedAt = new Date().toISOString();
  saveIfRequested(project, options);
  return session;
}

export function getProjectVoiceDesign(projectOrSlug, options = {}) {
  const project = projectFrom(projectOrSlug);
  const state = ensureVoiceDesignState(project);
  if (options.persistMigration !== false && typeof projectOrSlug === "string") saveProjectWithRetry(project);
  return { project, voiceDesign: state, health: qwenVoiceDesignHealth(options) };
}

function readWave(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Audio is not a valid RIFF/WAVE file");
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw new Error("WAV chunk exceeds the file length");
    if (id === "fmt ") {
      if (size < 16) throw new Error("WAV format chunk is incomplete");
      let formatTag = buffer.readUInt16LE(start);
      if (formatTag === 0xfffe && size >= 40) formatTag = buffer.readUInt16LE(start + 24);
      format = {
        formatTag,
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (id === "data") {
      data = { start, size };
    }
    offset = end + (size % 2);
  }
  if (!format || !data) throw new Error("WAV is missing a format or data chunk");
  if (![1, 3].includes(format.formatTag)) throw new Error(`Unsupported WAV sample format ${format.formatTag}`);
  if (!(format.channels >= 1 && format.channels <= 2)) throw new Error("VoiceDesign output must be mono or stereo");
  if (!(format.blockAlign > 0) || data.size < format.blockAlign) throw new Error("WAV contains no complete audio frames");
  return { buffer, ...format, dataStart: data.start, dataBytes: data.size, frames: Math.floor(data.size / format.blockAlign) };
}

function waveSample(wave, offset) {
  const { buffer, formatTag, bitsPerSample } = wave;
  if (formatTag === 3 && bitsPerSample === 32) return buffer.readFloatLE(offset);
  if (formatTag === 1 && bitsPerSample === 16) return buffer.readInt16LE(offset) / 32_768;
  if (formatTag === 1 && bitsPerSample === 24) {
    let value = buffer.readUIntLE(offset, 3);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8_388_608;
  }
  if (formatTag === 1 && bitsPerSample === 32) return buffer.readInt32LE(offset) / 2_147_483_648;
  throw new Error(`Unsupported ${formatTag === 3 ? "float" : "PCM"} ${bitsPerSample}-bit WAV`);
}

export function analyzeVoiceDesignWave(file, options = {}) {
  const wave = readWave(file);
  const bytesPerSample = wave.bitsPerSample / 8;
  const silenceThreshold = boundedNumber(options.silenceThreshold, 0.00316227766, 0.00001, 0.1);
  const clippingThreshold = boundedNumber(options.clippingThreshold, 0.999, 0.8, 1);
  let peak = 0;
  let squareSum = 0;
  let sampleCount = 0;
  let clippingSamples = 0;
  let silentFrames = 0;
  let firstAudibleFrame = null;
  let lastAudibleFrame = null;
  for (let frame = 0; frame < wave.frames; frame += 1) {
    let framePeak = 0;
    const frameOffset = wave.dataStart + frame * wave.blockAlign;
    for (let channel = 0; channel < wave.channels; channel += 1) {
      const sample = waveSample(wave, frameOffset + channel * bytesPerSample);
      if (!Number.isFinite(sample)) throw new Error("WAV contains NaN or infinite samples");
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      framePeak = Math.max(framePeak, absolute);
      squareSum += sample * sample;
      sampleCount += 1;
      if (absolute >= clippingThreshold) clippingSamples += 1;
    }
    if (framePeak < silenceThreshold) silentFrames += 1;
    else {
      if (firstAudibleFrame == null) firstAudibleFrame = frame;
      lastAudibleFrame = frame;
    }
  }
  const durationSec = wave.frames / wave.sampleRate;
  return {
    format: wave.formatTag === 3 ? "IEEE_FLOAT" : "PCM",
    bitsPerSample: wave.bitsPerSample,
    channels: wave.channels,
    sampleRate: wave.sampleRate,
    frames: wave.frames,
    durationSec,
    peak,
    rms: Math.sqrt(squareSum / Math.max(1, sampleCount)),
    clippingRatio: clippingSamples / Math.max(1, sampleCount),
    silenceRatio: silentFrames / Math.max(1, wave.frames),
    leadingSilenceSec: firstAudibleFrame == null ? durationSec : firstAudibleFrame / wave.sampleRate,
    trailingSilenceSec: lastAudibleFrame == null ? durationSec : (wave.frames - lastAudibleFrame - 1) / wave.sampleRate,
    finite: true,
    bytes: wave.buffer.length
  };
}

function trustedGeneratorProvenance(provenance = {}) {
  return provenance.engine === QWEN_VOICE_DESIGN_ENGINE
    && provenance.modelId === QWEN_VOICE_DESIGN_MODEL
    && provenance.codeRevision === QWEN_VOICE_DESIGN_CODE_REVISION
    && provenance.modelRevision === QWEN_VOICE_DESIGN_MODEL_REVISION;
}

export function validateVoiceDesignSignal(file, provenance = {}, options = {}) {
  const metrics = analyzeVoiceDesignWave(file, options);
  const failures = [];
  if (metrics.sampleRate !== QWEN_VOICE_DESIGN_NATIVE_SAMPLE_RATE) failures.push(`native sample rate is ${metrics.sampleRate} Hz`);
  if (metrics.format !== "IEEE_FLOAT" || metrics.bitsPerSample !== 32) failures.push("native master is not 32-bit float WAV");
  if (!(metrics.durationSec >= boundedNumber(options.minimumDurationSec, 0.5, 0.1, 30))) failures.push("audio is empty or too short");
  if (metrics.peak < boundedNumber(options.minimumPeak, 0.01, 0.0001, 0.5)) failures.push("audio is effectively silent");
  if (metrics.rms < boundedNumber(options.minimumRms, 0.001, 0.00001, 0.25)) failures.push("audio energy is too low");
  if (metrics.peak > 1.0001 || metrics.clippingRatio > boundedNumber(options.maximumClippingRatio, 0.005, 0, 0.1)) failures.push("audio contains excessive clipping");
  if (metrics.silenceRatio > boundedNumber(options.maximumSilenceRatio, 0.8, 0.1, 0.99)) failures.push("audio contains excessive total silence");
  const edgeSilenceLimit = Math.min(2, metrics.durationSec * 0.5);
  if (metrics.leadingSilenceSec > edgeSilenceLimit) failures.push("audio contains excessive leading silence");
  if (metrics.trailingSilenceSec > edgeSilenceLimit) failures.push("audio contains excessive trailing silence");
  const trusted = trustedGeneratorProvenance(provenance);
  if (options.requireKnownGenerator !== false && !trusted) failures.push("single-speaker/no-music trust requires exact official Qwen generator provenance");
  return {
    passed: failures.length === 0,
    failures,
    signal: metrics,
    singleSpeaker: {
      status: trusted ? "trusted-generator-contract" : "unverified",
      basis: trusted ? "Direct output from the pinned official VoiceDesign method; no mixed/imported audio was accepted." : null
    },
    noMusic: {
      status: trusted ? "trusted-generator-contract" : "unverified",
      basis: trusted ? "The pinned official VoiceDesign call received audible dialogue and voice instruction only." : null
    }
  };
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function cleanupAuditionOutputs(projectSlug, audition) {
  for (const [relative, prefix] of [
    [audition?.nativeFile, "production/qwen3-tts/voice-design/"],
    [audition?.production48kFile, "media/audio/voice-design/"]
  ]) {
    if (!relative) continue;
    try {
      const file = safeVoiceDesignProjectFile(projectSlug, relative, prefix);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      const partial = `${file}.partial`;
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    } catch {}
  }
}

function generationProvenance(session, audition, workerResult) {
  return {
    kind: "synthetic-designed-voice",
    engine: QWEN_VOICE_DESIGN_ENGINE,
    modelId: QWEN_VOICE_DESIGN_MODEL,
    codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    precision: "bf16",
    attentionImplementation: workerResult?.attentionImplementation || "sdpa",
    method: "generate_voice_design",
    textContract: "audible-dialogue-only",
    instructionContract: "compiled-natural-language-instruct",
    sessionId: session.id,
    auditionId: audition.id,
    seed: audition.seed
  };
}

export async function generateVoiceDesignJob(job, options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveQwenVoiceDesignPaths(env, options.platform || process.platform);
  const health = qwenVoiceDesignHealth({ paths, env });
  if (!health.ready) throw Object.assign(new Error(health.reason), { statusCode: 503 });
  const project = loadProject(job.projectSlug);
  const session = sessionById(project, job.refs?.sessionId);
  if (!session) throw new Error("Qwen VoiceDesign session not found");
  if (session.status === "cancelled") throw cancellationError();
  const pendingAuditions = session.auditions.filter((entry) => entry.status === "queued" && !entry.deletedAt);
  if (!pendingAuditions.length) throw new Error("Qwen VoiceDesign session has no queued auditions");
  const worker = getWorker(paths);
  session.status = "loading";
  session.error = null;
  session.updatedAt = new Date().toISOString();
  saveProjectWithRetry(project);
  job.label = `Voice Design - ${session.voiceName}`;
  job.stage = "Loading standalone Qwen3-TTS VoiceDesign";
  job.progress = 0.02;

  let current = null;
  try {
    await worker.load({
      signal: job.signal,
      onProgress: (message) => {
        job.stage = cleanText(message.stage, job.stage, 500);
        job.progress = Math.max(0.02, Math.min(0.12, finite(message.progress, 0) * 0.12));
      }
    });
    for (let index = 0; index < pendingAuditions.length; index += 1) {
      if (job.signal?.aborted) throw cancellationError();
      const fresh = loadProject(project.slug);
      const freshSession = sessionById(fresh, session.id);
      current = auditionById(freshSession, pendingAuditions[index].id);
      if (!freshSession || !current) throw new Error("Qwen VoiceDesign audition disappeared before generation");
      if (current.deletedAt || current.status === "cancelled") continue;
      freshSession.status = "generating";
      current.status = "generating";
      current.error = null;
      current.updatedAt = new Date().toISOString();
      freshSession.updatedAt = current.updatedAt;
      saveProjectWithRetry(fresh);

      const nativePath = safeVoiceDesignProjectFile(fresh.slug, current.nativeFile, "production/qwen3-tts/voice-design/");
      const productionPath = current.production48kFile
        ? safeVoiceDesignProjectFile(fresh.slug, current.production48kFile, "media/audio/voice-design/")
        : null;
      fs.mkdirSync(path.dirname(nativePath), { recursive: true });
      if (productionPath) fs.mkdirSync(path.dirname(productionPath), { recursive: true });
      if (fs.existsSync(nativePath) || (productionPath && fs.existsSync(productionPath))) {
        throw new Error("Qwen VoiceDesign output filename already exists; refusing to overwrite an audition");
      }
      const result = await worker.request("generate", {
        text: freshSession.auditionText,
        language: freshSession.language,
        instruct: freshSession.compiledInstruct,
        seed: current.seed,
        settings: current.generationSettings || freshSession.settings,
        nativePath,
        production48kPath: productionPath
      }, {
        signal: job.signal,
        onProgress: (message) => {
          const within = boundedNumber(message.progress, 0, 0, 1);
          const completed = index / pendingAuditions.length;
          job.progress = Math.min(0.94, 0.12 + 0.8 * (completed + within / pendingAuditions.length));
          job.stage = `Audition ${index + 1}/${pendingAuditions.length} - ${cleanText(message.stage, "Generating", 300)}`;
        }
      });
      if (job.signal?.aborted) throw cancellationError();
      if (!fs.existsSync(nativePath) || fs.statSync(nativePath).size < 64) throw new Error("Qwen VoiceDesign worker did not create a native WAV");
      if (productionPath && (!fs.existsSync(productionPath) || fs.statSync(productionPath).size < 64)) {
        throw new Error("Qwen VoiceDesign worker did not create the requested 48 kHz production WAV");
      }
      const provenance = generationProvenance(freshSession, current, result);
      const quality = validateVoiceDesignSignal(nativePath, provenance);
      if (!quality.passed) throw new Error(`Qwen VoiceDesign audition failed validation: ${quality.failures.join("; ")}`);
      if (productionPath) {
        const production = analyzeVoiceDesignWave(productionPath);
        if (production.sampleRate !== QWEN_VOICE_DESIGN_PRODUCTION_SAMPLE_RATE || production.format !== "PCM" || production.bitsPerSample !== 24) {
          throw new Error("Qwen VoiceDesign production copy is not a 48 kHz PCM24 WAV");
        }
      }
      const completedProject = loadProject(fresh.slug);
      const completedSession = sessionById(completedProject, freshSession.id);
      const completedAudition = auditionById(completedSession, current.id);
      if (!completedSession || !completedAudition) throw new Error("Qwen VoiceDesign audition record disappeared after generation");
      if (completedAudition.deletedAt || completedAudition.status === "cancelled" || job.signal?.aborted) throw cancellationError();
      const now = new Date().toISOString();
      completedAudition.status = "done";
      completedAudition.nativeSampleRate = quality.signal.sampleRate;
      completedAudition.productionSampleRate = productionPath ? QWEN_VOICE_DESIGN_PRODUCTION_SAMPLE_RATE : null;
      completedAudition.durationSec = quality.signal.durationSec;
      completedAudition.bytes = fs.statSync(nativePath).size;
      completedAudition.sha256 = sha256File(nativePath);
      completedAudition.productionBytes = productionPath ? fs.statSync(productionPath).size : null;
      completedAudition.productionSha256 = productionPath ? sha256File(productionPath) : null;
      completedAudition.quality = quality;
      completedAudition.provenance = { ...provenance, outputSha256: completedAudition.sha256, productionSha256: completedAudition.productionSha256 };
      completedAudition.error = null;
      completedAudition.updatedAt = now;
      completedAudition.finishedAt = now;
      completedSession.updatedAt = now;
      completedSession.status = "generating";
      saveProjectWithRetry(completedProject);
      current = null;
    }
    const completedProject = loadProject(project.slug);
    const completedSession = sessionById(completedProject, session.id);
    const visible = completedSession.auditions.filter((entry) => !entry.deletedAt);
    completedSession.status = visible.some((entry) => entry.status === "error") ? "partial" : "done";
    completedSession.error = null;
    completedSession.updatedAt = new Date().toISOString();
    completedSession.finishedAt = completedSession.updatedAt;
    saveProjectWithRetry(completedProject);
    job.progress = 0.98;
    job.result = {
      sessionId: completedSession.id,
      status: completedSession.status,
      auditions: completedSession.auditions.filter((entry) => entry.status === "done").map((entry) => ({
        id: entry.id,
        seed: entry.seed,
        mediaUrl: entry.productionMediaUrl,
        durationSec: entry.durationSec,
        sha256: entry.sha256
      }))
    };
    return job.result;
  } catch (error) {
    const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted || job.status === "cancelling";
    const failedProject = loadProject(project.slug);
    const failedSession = sessionById(failedProject, session.id);
    const failedAudition = current ? auditionById(failedSession, current.id) : null;
    if (failedAudition && failedAudition.status !== "done") {
      cleanupAuditionOutputs(failedProject.slug, failedAudition);
      failedAudition.status = cancelled ? "cancelled" : "error";
      failedAudition.error = cancelled ? null : String(error.message || error);
      failedAudition.updatedAt = new Date().toISOString();
      failedAudition.finishedAt = failedAudition.updatedAt;
    }
    if (failedSession) {
      failedSession.status = cancelled ? "cancelled" : "error";
      failedSession.error = cancelled ? null : String(error.message || error);
      failedSession.updatedAt = new Date().toISOString();
      failedSession.finishedAt = failedSession.updatedAt;
      for (const audition of failedSession.auditions) {
        if (audition.status !== "queued") continue;
        audition.status = cancelled ? "cancelled" : "error";
        audition.error = cancelled
          ? null
          : `Not generated because this audition session stopped: ${String(error.message || error)}`;
        audition.updatedAt = failedSession.updatedAt;
        audition.finishedAt = failedSession.updatedAt;
      }
      saveProjectWithRetry(failedProject);
    }
    if (cancelled) cancelQwenVoiceDesignWorker();
    throw cancelled && error?.code !== "GENERATION_CANCELLED" ? cancellationError() : error;
  }
}

export function cancelVoiceDesignSession(projectOrSlug, sessionId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const session = sessionById(project, sessionId);
  if (!session) return null;
  if (!ACTIVE_SESSION_STATUSES.has(session.status)) return session;
  const now = new Date().toISOString();
  session.status = "cancelled";
  session.error = null;
  session.updatedAt = now;
  session.finishedAt = now;
  for (const audition of session.auditions) {
    if (["queued", "generating"].includes(audition.status)) {
      audition.status = "cancelled";
      audition.error = null;
      audition.updatedAt = now;
      audition.finishedAt = now;
    }
  }
  saveIfRequested(project, options);
  if (options.terminateWorker) cancelQwenVoiceDesignWorker();
  return session;
}

export function queueVoiceDesignRegeneration(projectOrSlug, sessionId, auditionId, input = {}, options = {}) {
  const project = projectFrom(projectOrSlug);
  const session = sessionById(project, sessionId);
  const source = auditionById(session, auditionId);
  if (!session || !source) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  const nextIndex = Math.max(0, ...session.auditions.map((entry) => finite(entry.index, 0))) + 1;
  const settings = normalizeVoiceDesignSettings({ ...session.settings, ...(input.settings || {}) });
  const seed = input.seed == null || input.seed === ""
    ? ((boundedInteger(source.seed, 42, 0, 2_147_000_000) + 1_009) % 2_147_483_640)
    : boundedInteger(input.seed, source.seed, 0, 2_147_483_640);
  const audition = makeAudition(session, nextIndex, seed, settings, source.id);
  session.settings = settings;
  session.auditions.push(audition);
  session.status = "queued";
  session.jobId = null;
  session.error = null;
  session.updatedAt = new Date().toISOString();
  session.finishedAt = null;
  saveIfRequested(project, options);
  return { session, audition };
}

export function renameVoiceDesignAudition(projectOrSlug, sessionId, auditionId, name, options = {}) {
  const project = projectFrom(projectOrSlug);
  const session = sessionById(project, sessionId);
  const audition = auditionById(session, auditionId);
  if (!session || !audition) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  const nextName = cleanText(name, "", 120);
  if (!nextName) throw Object.assign(new Error("Audition name is required"), { statusCode: 400 });
  audition.name = nextName;
  audition.updatedAt = new Date().toISOString();
  session.updatedAt = audition.updatedAt;
  saveIfRequested(project, options);
  return { session, audition };
}

export function softDeleteVoiceDesignAudition(projectOrSlug, sessionId, auditionId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const state = ensureVoiceDesignState(project);
  const session = sessionById(project, sessionId);
  const audition = auditionById(session, auditionId);
  if (!session || !audition) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  const now = new Date().toISOString();
  audition.deletedAt = now;
  audition.selected = false;
  audition.updatedAt = now;
  if (session.selectedAuditionId === audition.id) session.selectedAuditionId = null;
  if (session.characterId && state.defaultByCharacter[session.characterId] === audition.id) delete state.defaultByCharacter[session.characterId];
  session.updatedAt = now;
  saveIfRequested(project, options);
  return { session, audition };
}

export function selectVoiceDesignAudition(projectOrSlug, sessionId, auditionId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const state = ensureVoiceDesignState(project);
  const session = sessionById(project, sessionId);
  const audition = auditionById(session, auditionId);
  if (!session || !audition || audition.deletedAt) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  if (audition.status !== "done" || !audition.quality?.passed) {
    throw Object.assign(new Error("Only a completed, validated audition can be selected"), { statusCode: 409 });
  }
  const now = new Date().toISOString();
  for (const candidateSession of state.sessions) {
    if ((candidateSession.characterId || null) !== (session.characterId || null)) continue;
    for (const entry of candidateSession.auditions || []) entry.selected = entry.id === audition.id;
    if (candidateSession.id !== session.id && candidateSession.selectedAuditionId) candidateSession.selectedAuditionId = null;
  }
  session.selectedAuditionId = audition.id;
  session.updatedAt = now;
  audition.updatedAt = now;
  if (session.characterId) state.defaultByCharacter[session.characterId] = audition.id;
  for (const voice of state.savedVoices) {
    if ((voice.characterId || null) === (session.characterId || null)) voice.selected = voice.sourceAuditionId === audition.id;
  }
  saveIfRequested(project, options);
  return { session, audition };
}

function savedVoiceRecord(project, session, audition, existing = null) {
  const now = new Date().toISOString();
  return {
    id: existing?.id || `qvd_voice_${audition.id.replace(/^qvd_audition_/, "")}`,
    voiceName: audition.name || session.voiceName,
    characterId: session.characterId,
    projectId: session.projectId || project.id || project.slug,
    projectSlug: project.slug,
    engine: QWEN_VOICE_DESIGN_ENGINE,
    modelId: QWEN_VOICE_DESIGN_MODEL,
    codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    descriptionFields: session.descriptionFields,
    completeVoiceDescription: session.compiledInstruct,
    auditionTranscript: session.auditionText,
    language: session.language,
    seed: audition.seed,
    generationSettings: audition.generationSettings || session.settings,
    nativeSampleRate: audition.nativeSampleRate,
    nativeFile: audition.nativeFile,
    nativeMediaUrl: audition.nativeMediaUrl,
    production48kFile: audition.production48kFile,
    productionMediaUrl: audition.productionMediaUrl,
    durationSec: audition.durationSec,
    sha256: audition.sha256,
    productionSha256: audition.productionSha256,
    provenance: audition.provenance,
    quality: audition.quality,
    sourceSessionId: session.id,
    sourceAuditionId: audition.id,
    assetId: existing?.assetId || null,
    indexTtsVoiceId: existing?.indexTtsVoiceId || null,
    selected: session.selectedAuditionId === audition.id,
    default: Boolean(session.characterId && ensureVoiceDesignState(project).defaultByCharacter[session.characterId] === audition.id),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

export function saveVoiceDesignVoice(projectOrSlug, sessionId, auditionId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const state = ensureVoiceDesignState(project);
  const session = sessionById(project, sessionId);
  const audition = auditionById(session, auditionId);
  if (!session || !audition || audition.deletedAt) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  if (audition.status !== "done" || !audition.quality?.passed) {
    throw Object.assign(new Error("Only a completed, validated audition can be saved"), { statusCode: 409 });
  }
  const existingIndex = state.savedVoices.findIndex((entry) => entry.sourceAuditionId === audition.id);
  const existing = existingIndex >= 0 ? state.savedVoices[existingIndex] : null;
  const voice = savedVoiceRecord(project, session, audition, existing);
  if (existingIndex >= 0) state.savedVoices[existingIndex] = voice;
  else state.savedVoices.push(voice);
  saveIfRequested(project, options);
  return { session, audition, voice };
}

export function attachVoiceDesignAssetId(projectOrSlug, savedVoiceId, assetId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const voice = ensureVoiceDesignState(project).savedVoices.find((entry) => entry.id === savedVoiceId);
  if (!voice) throw Object.assign(new Error("Saved Qwen VoiceDesign voice not found"), { statusCode: 404 });
  voice.assetId = cleanText(assetId, "", 200) || null;
  voice.updatedAt = new Date().toISOString();
  saveIfRequested(project, options);
  return voice;
}

export function attachVoiceDesignIndexTtsVoiceId(projectOrSlug, savedVoiceId, indexTtsVoiceId, options = {}) {
  const project = projectFrom(projectOrSlug);
  const voice = ensureVoiceDesignState(project).savedVoices.find((entry) => entry.id === savedVoiceId);
  if (!voice) throw Object.assign(new Error("Saved Qwen VoiceDesign voice not found"), { statusCode: 404 });
  voice.indexTtsVoiceId = cleanText(indexTtsVoiceId, "", 200) || null;
  voice.updatedAt = new Date().toISOString();
  saveIfRequested(project, options);
  return voice;
}

function completedAudition(projectOrSlug, sessionId, auditionId) {
  const project = projectFrom(projectOrSlug);
  const session = sessionById(project, sessionId);
  const audition = auditionById(session, auditionId);
  if (!session || !audition || audition.deletedAt) throw Object.assign(new Error("Qwen VoiceDesign audition not found"), { statusCode: 404 });
  if (audition.status !== "done" || !audition.quality?.passed) throw Object.assign(new Error("Qwen VoiceDesign audition is not handoff-ready"), { statusCode: 409 });
  return { project, session, audition };
}

export function buildVoiceDesignAssetHook(projectOrSlug, sessionId, auditionId) {
  const { project, session, audition } = completedAudition(projectOrSlug, sessionId, auditionId);
  const preferredFile = audition.production48kFile || audition.nativeFile;
  return {
    sourceFile: safeVoiceDesignProjectFile(project.slug, preferredFile, audition.production48kFile ? "media/audio/voice-design/" : "production/qwen3-tts/voice-design/"),
    sourceFileName: path.basename(preferredFile),
    contentType: "audio/wav",
    category: "voice",
    characterId: session.characterId,
    projectId: session.projectId,
    voiceName: audition.name || session.voiceName,
    sampleText: session.auditionText,
    prompt: session.compiledInstruct,
    metadata: savedVoiceRecord(project, session, audition)
  };
}

export function buildVoiceDesignIndexTtsHook(projectOrSlug, sessionId, auditionId) {
  const { project, session, audition } = completedAudition(projectOrSlug, sessionId, auditionId);
  const sourceFile = safeVoiceDesignProjectFile(project.slug, audition.nativeFile, "production/qwen3-tts/voice-design/");
  return {
    sourceFile,
    referenceFile: sourceFile,
    sourceFileName: path.basename(audition.nativeFile),
    transcript: session.auditionText,
    speaker: session.voiceName,
    voiceName: audition.name || session.voiceName,
    characterId: session.characterId,
    projectId: session.projectId,
    sourceSessionId: session.id,
    sourceAuditionId: audition.id,
    referenceSha256: audition.sha256,
    durationSec: audition.durationSec,
    sampleRate: audition.nativeSampleRate,
    quality: audition.quality,
    signalValidation: audition.quality?.signal || null,
    singleSpeakerValidation: audition.quality?.singleSpeaker?.status || "unverified",
    noMusicValidation: audition.quality?.noMusic?.status || "unverified",
    provenance: audition.provenance,
    copyRequired: true,
    overwriteSource: false
  };
}

export function voiceDesignContainingFolder(projectOrSlug, sessionId, auditionId) {
  const { project, audition } = completedAudition(projectOrSlug, sessionId, auditionId);
  const relative = audition.production48kFile || audition.nativeFile;
  const prefix = audition.production48kFile ? "media/audio/voice-design/" : "production/qwen3-tts/voice-design/";
  return path.dirname(safeVoiceDesignProjectFile(project.slug, relative, prefix));
}

export const __qwenVoiceDesignTest = Object.freeze({
  DESCRIPTION_FIELDS,
  PersistentQwenVoiceDesignWorker,
  readWave,
  trustedGeneratorProvenance,
  requiredModelFiles,
  savedVoiceRecord,
  cleanupAuditionOutputs
});
