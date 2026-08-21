import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import { probeMedia } from "./ffmpeg.js";
import {
  acquireGpuLease,
  GPU_RESOURCE_OWNERS,
  releaseGpuLease,
  updateGpuLease
} from "./gpu-resource-manager.js";
import { ensureProjectSound } from "./index-tts.js";
import { loadProject, mediaDir, saveProject } from "./projects.js";
import { PACKAGE_ROOT, projectDir } from "./paths.js";

export const QWEN_TTS_PROVIDER = "qwenTts";
export const QWEN_TTS_ENGINE = "Qwen3-TTS Base";
export const QWEN_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base";

const ACTIVE_GENERATION_STATUSES = new Set(["queued", "generating"]);
const LANGUAGE_ALIASES = new Map([
  ["auto", "Auto"],
  ["en", "English"],
  ["english", "English"],
  ["zh", "Chinese"],
  ["chinese", "Chinese"],
  ["ja", "Japanese"],
  ["japanese", "Japanese"],
  ["ko", "Korean"],
  ["korean", "Korean"],
  ["de", "German"],
  ["german", "German"],
  ["fr", "French"],
  ["french", "French"],
  ["ru", "Russian"],
  ["russian", "Russian"],
  ["pt", "Portuguese"],
  ["portuguese", "Portuguese"],
  ["es", "Spanish"],
  ["spanish", "Spanish"],
  ["it", "Italian"],
  ["italian", "Italian"]
]);
const REQUIRED_MODEL_FILES = Object.freeze([
  { label: "Base model config", parts: ["config.json"], minBytes: 1_000 },
  { label: "generation config", parts: ["generation_config.json"], minBytes: 50 },
  { label: "audio preprocessor config", parts: ["preprocessor_config.json"], minBytes: 50 },
  { label: "Base model weights", parts: ["model.safetensors"], minBytes: 3_800_000_000 },
  { label: "text tokenizer", parts: ["tokenizer_config.json"], minBytes: 1_000 },
  { label: "text merges", parts: ["merges.txt"], minBytes: 1_000_000 },
  { label: "text vocabulary", parts: ["vocab.json"], minBytes: 2_000_000 },
  { label: "speech tokenizer config", parts: ["speech_tokenizer", "config.json"], minBytes: 1_000 },
  { label: "speech tokenizer registration", parts: ["speech_tokenizer", "configuration.json"], minBytes: 50 },
  { label: "speech tokenizer weights", parts: ["speech_tokenizer", "model.safetensors"], minBytes: 650_000_000 },
  { label: "speech preprocessor", parts: ["speech_tokenizer", "preprocessor_config.json"], minBytes: 50 }
]);
const PROJECT_SAVE_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const PROJECT_SAVE_WAIT = new Int32Array(new SharedArrayBuffer(4));

let activeWorker = null;

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function cleanText(value, fallback, maxLength) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function transcriptText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function fileSlug(value) {
  return String(value || "sound")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "sound";
}

function slashPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ""
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`);
}

function safeProjectFile(projectSlug, relativeFile, requiredPrefix) {
  const normalized = slashPath(relativeFile).replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Qwen3-TTS project file path is invalid");
  }
  if (!normalized.startsWith(requiredPrefix)) throw new Error("Qwen3-TTS project file is outside its assigned directory");
  const root = path.resolve(projectDir(projectSlug));
  const disk = path.resolve(root, ...normalized.split("/"));
  if (!isInside(root, disk)) throw new Error("Qwen3-TTS project file escaped the project root");
  return disk;
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

function readJsonMaybe(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function readGitRevision(root) {
  try {
    const git = path.join(root, ".git");
    const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
    if (/^[a-f\d]{40}$/i.test(head)) return head.toLowerCase();
    const ref = head.match(/^ref:\s*(.+)$/)?.[1];
    if (!ref) return null;
    const value = fs.readFileSync(path.join(git, ...ref.split("/")), "utf8").trim();
    return /^[a-f\d]{40}$/i.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

function readModelRevision(modelDir, env) {
  const explicit = String(env.QWEN_TTS_MODEL_REVISION || "").trim();
  if (explicit) return explicit;
  for (const metadata of [
    path.join(modelDir, ".cache", "huggingface", "download", "config.json.metadata"),
    path.join(modelDir, ".cache", "huggingface", "download", "model.safetensors.metadata")
  ]) {
    try {
      const revision = fs.readFileSync(metadata, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^[a-f\d]{40}$/i.test(line));
      if (revision) return revision.toLowerCase();
    } catch {}
  }
  return null;
}

function forbiddenComfyPath(value) {
  return /(?:^|[\\/])comfyui(?:[\\/]|$)/i.test(path.resolve(String(value || ".")));
}

export function resolveQwenTtsPaths(env = process.env, platform = process.platform) {
  const localAppData = String(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"));
  const runtimeRoot = path.resolve(String(env.QWEN_TTS_RUNTIME_ROOT || path.join(localAppData, "Premiere316", "Qwen3-TTS-VoiceDesign")));
  const installRoot = path.resolve(String(env.QWEN_TTS_ROOT || path.join(localAppData, "Premiere316", "Qwen3-TTS")));
  const defaultPython = platform === "win32"
    ? path.join(runtimeRoot, ".venv", "Scripts", "python.exe")
    : path.join(runtimeRoot, ".venv", "bin", "python");
  const python = path.resolve(String(env.QWEN_TTS_PYTHON || defaultPython));
  const venvRoot = path.dirname(path.dirname(python));
  return {
    runtimeRoot,
    installRoot,
    sourceRoot: path.join(runtimeRoot, "src", "Qwen3-TTS"),
    modelDir: path.resolve(String(env.QWEN_TTS_MODEL_DIR || path.join(installRoot, "models", "Qwen3-TTS-12Hz-1.7B-Base"))),
    python,
    packageMarker: platform === "win32"
      ? path.join(venvRoot, "Lib", "site-packages", "qwen_tts", "__init__.py")
      : null,
    worker: path.join(PACKAGE_ROOT, "scripts", "qwen_tts_worker.py"),
    device: String(env.QWEN_TTS_DEVICE || "cuda:0").trim() || "cuda:0",
    attentionImplementation: String(env.QWEN_TTS_ATTENTION || "sdpa").trim() === "flash_attention_2" ? "flash_attention_2" : "sdpa",
    idleMs: Math.max(10_000, finite(env.QWEN_TTS_WORKER_IDLE_MS, 120_000))
  };
}

export function qwenTtsHealth(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveQwenTtsPaths(env, options.platform || process.platform);
  const fileSize = typeof options.fileSize === "function"
    ? options.fileSize
    : (file) => fs.statSync(file).size;
  const required = [
    { label: "standalone Python", file: paths.python, minBytes: 1 },
    ...(paths.packageMarker ? [{ label: "qwen-tts package", file: paths.packageMarker, minBytes: 1 }] : []),
    { label: "Premiere316 Qwen worker", file: paths.worker, minBytes: 1 },
    ...REQUIRED_MODEL_FILES.map((entry) => ({
      label: entry.label,
      file: path.join(paths.modelDir, ...entry.parts),
      minBytes: entry.minBytes
    }))
  ];
  const missing = [];
  for (const entry of required) {
    if (!fs.existsSync(entry.file)) {
      missing.push({ ...entry, issue: "missing", actualBytes: 0 });
      continue;
    }
    let actualBytes = 0;
    try { actualBytes = Number(fileSize(entry.file)) || 0; } catch {}
    if (actualBytes < entry.minBytes) {
      missing.push({ ...entry, issue: "incomplete", actualBytes });
    }
  }
  const modelConfig = readJsonMaybe(path.join(paths.modelDir, "config.json"));
  if (modelConfig && String(modelConfig.tts_model_type || "").toLowerCase() !== "base") {
    missing.push({ label: "Qwen3-TTS Base model type", file: path.join(paths.modelDir, "config.json") });
  }
  const isolated = !forbiddenComfyPath(paths.runtimeRoot) && !forbiddenComfyPath(paths.modelDir) && !forbiddenComfyPath(paths.python);
  if (!isolated) missing.push({ label: "standalone non-ComfyUI runtime", file: paths.runtimeRoot });
  const ready = missing.length === 0;
  const workerMatches = Boolean(activeWorker?.isRunningFor(paths));
  return {
    installed: fs.existsSync(paths.runtimeRoot) && fs.existsSync(paths.modelDir),
    ready,
    available: ready,
    provider: QWEN_TTS_PROVIDER,
    primary: true,
    engine: QWEN_TTS_ENGINE,
    model: QWEN_TTS_MODEL,
    runtimeKind: "standalone",
    usesComfyUi: false,
    oneContinuousGeneration: true,
    exactReferenceTranscriptRequired: true,
    runtimeRoot: paths.runtimeRoot,
    installRoot: paths.installRoot,
    modelDir: paths.modelDir,
    python: paths.python,
    codeRevision: String(env.QWEN_TTS_CODE_REVISION || "").trim() || readGitRevision(paths.sourceRoot),
    modelRevision: readModelRevision(paths.modelDir, env),
    attentionImplementation: workerMatches && activeWorker.attentionImplementation
      ? activeWorker.attentionImplementation
      : paths.attentionImplementation,
    workerRunning: workerMatches,
    loaded: workerMatches && activeWorker.loaded,
    busy: workerMatches && activeWorker.pending.size > 0,
    workerPid: workerMatches ? activeWorker.child?.pid || null : null,
    missing,
    reason: ready ? null : `Missing or incomplete standalone Qwen3-TTS Base runtime files: ${missing.map((entry) => entry.label).join(", ")}`
  };
}

export function normalizeQwenTtsLanguage(value) {
  const key = String(value || "English").trim().toLowerCase();
  const language = LANGUAGE_ALIASES.get(key);
  if (!language) {
    throw Object.assign(new Error(`Unsupported Qwen3-TTS language: ${value || "missing"}`), { statusCode: 400 });
  }
  return language;
}

function mediaFacts(info) {
  return {
    durationSec: finite(info?.durationSec ?? info?.audio?.duration, null),
    sampleRate: finite(info?.audio?.sample_rate ?? info?.audio?.sampleRate, null),
    channels: finite(info?.audio?.channels, null)
  };
}

function validateReferenceDuration(durationSec) {
  if (!(durationSec > 0)) throw new Error("The reference WAV has no measurable duration");
  if (durationSec < 7.95 || durationSec > 15.05) {
    throw new Error(`Qwen3-TTS reference audio must be 8–15 seconds long; this file is ${durationSec.toFixed(2)} seconds`);
  }
  return durationSec;
}

function immutableBufferWrite(file, buffer, expectedHash) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== expectedHash) throw new Error("Immutable Qwen3-TTS reference hash collision");
    return;
  }
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function immutableTextWrite(file, text) {
  const contents = String(text || "");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") !== contents) throw new Error("Immutable Qwen3-TTS transcript collision");
    return;
  }
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function referenceMediaUrl(projectSlug, voiceId) {
  return `/api/projects/${encodeURIComponent(projectSlug)}/sound/qwen-tts/voices/${encodeURIComponent(voiceId)}/reference`;
}

async function storeVoiceReference(project, file, transcript, speaker, name) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length < 64) {
    throw Object.assign(new Error("A non-empty reference WAV is required"), { statusCode: 400 });
  }
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  if (extension !== ".wav" && !["audio/wav", "audio/x-wav"].includes(mime)) {
    throw Object.assign(new Error("Qwen3-TTS voice cloning requires a WAV reference."), { statusCode: 415 });
  }
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const relativeFile = `production/qwen3-tts/references/${sha256}.wav`;
  const disk = safeProjectFile(project.slug, relativeFile, "production/qwen3-tts/references/");
  const probeFile = `${disk}.${process.pid}.${crypto.randomUUID()}.probe.wav`;
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  try {
    fs.writeFileSync(probeFile, file.buffer, { flag: "wx" });
    const info = await probeMedia(probeFile);
    if (!info?.audio) throw new Error("The reference WAV has no readable audio stream");
    const facts = mediaFacts(info);
    validateReferenceDuration(facts.durationSec);
    immutableBufferWrite(disk, file.buffer, sha256);
    const transcriptHash = crypto.createHash("sha256").update(transcript).digest("hex");
    const transcriptRelativeFile = `production/qwen3-tts/references/${sha256}.${transcriptHash.slice(0, 16)}.transcript.txt`;
    immutableTextWrite(safeProjectFile(project.slug, transcriptRelativeFile, "production/qwen3-tts/references/"), `${transcript}\n`);
    const id = `qwen_voice_${sha256.slice(0, 16)}_${transcriptHash.slice(0, 8)}`;
    return {
      id,
      provider: QWEN_TTS_PROVIDER,
      engine: QWEN_TTS_ENGINE,
      speaker,
      name,
      referenceFile: relativeFile,
      referenceMediaUrl: referenceMediaUrl(project.slug, id),
      referenceSha256: sha256,
      referenceTranscript: transcript,
      referenceTranscriptSha256: transcriptHash,
      referenceTranscriptFile: transcriptRelativeFile,
      sourceFileName: path.basename(String(file.originalname || "reference.wav")),
      contentType: "audio/wav",
      bytes: file.buffer.length,
      ...facts,
      qwenTtsReady: true
    };
  } catch (error) {
    throw Object.assign(new Error(`Qwen3-TTS reference validation failed: ${String(error.message || error)}`), { statusCode: 400 });
  } finally {
    try { if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile); } catch {}
  }
}

async function promoteExistingVoice(project, voice, transcript, speaker, name) {
  if (!voice?.referenceFile) throw Object.assign(new Error("Saved voice reference is incomplete"), { statusCode: 400 });
  const normalized = slashPath(voice.referenceFile).replace(/^\/+/, "");
  if (!normalized.startsWith("production/") || normalized.split("/").some((part) => part === "..")) {
    throw Object.assign(new Error("Saved voice reference path is invalid"), { statusCode: 400 });
  }
  const source = path.resolve(projectDir(project.slug), ...normalized.split("/"));
  if (!isInside(projectDir(project.slug), source) || !fs.existsSync(source) || path.extname(source).toLowerCase() !== ".wav") {
    throw Object.assign(new Error("Saved Qwen3-TTS voice reference is missing or is not WAV"), { statusCode: 400 });
  }
  return storeVoiceReference(project, {
    buffer: fs.readFileSync(source),
    originalname: voice.sourceFileName || path.basename(source),
    mimetype: "audio/wav"
  }, transcript, speaker, name);
}

function validateStoredVoice(project, voice) {
  if (voice?.provider !== QWEN_TTS_PROVIDER || !voice.referenceFile || !voice.referenceSha256 || !voice.referenceTranscript) {
    throw new Error("Saved Qwen3-TTS voice reference or exact transcript is incomplete");
  }
  const disk = safeProjectFile(project.slug, voice.referenceFile, "production/qwen3-tts/references/");
  if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) throw new Error("Saved Qwen3-TTS voice reference is missing");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(disk)).digest("hex");
  if (actual !== voice.referenceSha256) throw new Error("Saved Qwen3-TTS voice reference failed its SHA-256 check");
  const actualTranscriptHash = crypto.createHash("sha256").update(voice.referenceTranscript).digest("hex");
  if (actualTranscriptHash !== voice.referenceTranscriptSha256) throw new Error("Saved Qwen3-TTS exact transcript failed its SHA-256 check");
  return disk;
}

function generationById(project, generationId) {
  return ensureProjectSound(project).generations.find((entry) => entry.id === generationId && entry.provider === QWEN_TTS_PROVIDER) || null;
}

export async function createQwenTtsGeneration(projectSlug, input = {}) {
  const health = qwenTtsHealth();
  if (!health.ready) throw Object.assign(new Error(health.reason), { statusCode: 503 });
  const project = loadProject(projectSlug);
  const sound = ensureProjectSound(project);
  sound.primaryProvider = QWEN_TTS_PROVIDER;
  const text = transcriptText(input.text);
  if (!text) throw Object.assign(new Error("Speech text is required"), { statusCode: 400 });
  if (text.length > 12_000) throw Object.assign(new Error("Speech text must be 12,000 characters or fewer"), { statusCode: 400 });
  const suppliedTranscript = transcriptText(input.referenceTranscript || input.refText);
  const speaker = cleanText(input.speaker, "Voice", 80);
  const name = cleanText(input.name, `${speaker} speech`, 120);
  const voiceName = cleanText(input.voiceName, speaker, 120);
  const style = transcriptText(input.style).slice(0, 2_000);
  const language = normalizeQwenTtsLanguage(input.language);

  let voice = null;
  if (input.referenceAudio?.buffer) {
    if (!suppliedTranscript) {
      throw Object.assign(new Error("The exact reference transcript is required with referenceAudio"), { statusCode: 400 });
    }
    const candidate = await storeVoiceReference(project, input.referenceAudio, suppliedTranscript, speaker, voiceName);
    const existing = sound.voices.find((entry) => entry.id === candidate.id);
    if (existing) {
      Object.assign(existing, candidate, { updatedAt: new Date().toISOString() });
      voice = existing;
    } else {
      voice = { ...candidate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      sound.voices.push(voice);
    }
  } else {
    const voiceId = String(input.voiceId || "").trim();
    const selected = sound.voices.find((entry) => entry.id === voiceId) || null;
    if (!selected) throw Object.assign(new Error("Upload referenceAudio or select a saved voiceId"), { statusCode: 404 });
    if (selected.provider === QWEN_TTS_PROVIDER) {
      voice = selected;
      if (suppliedTranscript && suppliedTranscript !== selected.referenceTranscript) {
        throw Object.assign(new Error("The supplied transcript does not match this immutable saved Qwen voice"), { statusCode: 409 });
      }
    } else {
      if (!suppliedTranscript) {
        throw Object.assign(new Error("The exact reference transcript is required to use this saved voice with Qwen3-TTS"), { statusCode: 400 });
      }
      const candidate = await promoteExistingVoice(project, selected, suppliedTranscript, speaker, voiceName);
      const existing = sound.voices.find((entry) => entry.id === candidate.id);
      if (existing) {
        Object.assign(existing, candidate, { updatedAt: new Date().toISOString() });
        voice = existing;
      } else {
        voice = { ...candidate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        sound.voices.push(voice);
      }
    }
  }
  validateStoredVoice(project, voice);

  const id = `qwen_sound_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const requestedSeed = finite(input.seed, null);
  const seed = requestedSeed == null
    ? Number.parseInt(crypto.createHash("sha256").update(id).digest("hex").slice(0, 8), 16) & 0x7fffffff
    : Math.max(0, Math.min(0x7fffffff, Math.trunc(requestedSeed)));
  const sampling = {
    topK: Math.max(1, Math.min(200, Math.trunc(finite(input.topK, 20)))),
    topP: rounded(Math.max(0.05, Math.min(1, finite(input.topP, 0.8)))),
    temperature: rounded(Math.max(0.1, Math.min(2, finite(input.temperature, 0.9)))),
    repetitionPenalty: rounded(Math.max(0.5, Math.min(2, finite(input.repetitionPenalty, 1.05)))),
    maxNewTokens: Math.max(128, Math.min(8192, Math.trunc(finite(input.maxNewTokens, 4096))))
  };
  const outputFile = `${fileSlug(name)}_${id.slice(-12)}.wav`;
  const generation = {
    id,
    jobId: null,
    provider: QWEN_TTS_PROVIDER,
    engine: QWEN_TTS_ENGINE,
    model: QWEN_TTS_MODEL,
    status: "queued",
    oneContinuousGeneration: true,
    speaker,
    name,
    text,
    style,
    styleMode: "reference-prosody",
    language,
    seed,
    sampling,
    voiceId: voice.id,
    reference: {
      file: voice.referenceFile,
      sha256: voice.referenceSha256,
      transcriptSha256: voice.referenceTranscriptSha256,
      sourceFileName: voice.sourceFileName,
      bytes: voice.bytes,
      durationSec: voice.durationSec,
      sampleRate: voice.sampleRate,
      channels: voice.channels
    },
    outputFile,
    file: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
    finishedAt: null
  };
  sound.generations.push(generation);
  saveProjectWithRetry(project);
  return { project, sound, voice, generation };
}

export function bindQwenTtsGenerationJob(projectSlug, generationId, jobId) {
  const project = loadProject(projectSlug);
  const generation = generationById(project, generationId);
  if (!generation) throw new Error("Qwen3-TTS generation disappeared before its job was registered");
  generation.jobId = jobId;
  generation.updatedAt = new Date().toISOString();
  saveProjectWithRetry(project);
  return generation;
}

export function cancelQwenTtsGeneration(projectSlug, generationId) {
  if (!projectSlug || !generationId) return null;
  const project = loadProject(projectSlug);
  const generation = generationById(project, generationId);
  if (!generation || !ACTIVE_GENERATION_STATUSES.has(generation.status)) return generation;
  generation.status = "cancelled";
  generation.error = null;
  generation.updatedAt = new Date().toISOString();
  generation.finishedAt = generation.updatedAt;
  saveProjectWithRetry(project);
  return generation;
}

export function resolveQwenTtsVoiceReference(projectSlug, voiceId) {
  const project = loadProject(projectSlug);
  const voice = ensureProjectSound(project).voices.find((entry) => entry.id === String(voiceId || "") && entry.provider === QWEN_TTS_PROVIDER);
  if (!voice) throw Object.assign(new Error("Qwen3-TTS voice reference not found"), { statusCode: 404 });
  const file = validateStoredVoice(project, voice);
  return { project, voice, file };
}

export function getProjectQwenSound(projectSlug, activeGenerationIds = null) {
  const project = loadProject(projectSlug);
  const sound = ensureProjectSound(project);
  let changed = false;
  if (sound.primaryProvider !== QWEN_TTS_PROVIDER) {
    sound.primaryProvider = QWEN_TTS_PROVIDER;
    changed = true;
  }
  for (const voice of sound.voices) {
    if (voice.provider !== QWEN_TTS_PROVIDER) continue;
    const expectedUrl = referenceMediaUrl(project.slug, voice.id);
    if (voice.referenceMediaUrl !== expectedUrl) {
      voice.referenceMediaUrl = expectedUrl;
      changed = true;
    }
  }
  if (activeGenerationIds) {
    const active = activeGenerationIds instanceof Set ? activeGenerationIds : new Set(activeGenerationIds);
    for (const generation of sound.generations) {
      if (generation.provider !== QWEN_TTS_PROVIDER || !ACTIVE_GENERATION_STATUSES.has(generation.status) || active.has(generation.id)) continue;
      generation.status = "interrupted";
      generation.error = "Generation was interrupted before Premiere316 could register its output.";
      generation.updatedAt = new Date().toISOString();
      generation.finishedAt = generation.updatedAt;
      changed = true;
    }
  }
  if (changed) saveProjectWithRetry(project);
  return { project, sound, health: qwenTtsHealth() };
}

function cancellationError() {
  const error = new Error("Qwen3-TTS generation stopped by director");
  error.code = "GENERATION_CANCELLED";
  return error;
}

export class PersistentQwenTtsWorker {
  constructor(paths) {
    this.paths = paths;
    this.child = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.pending = new Map();
    this.stderrTail = "";
    this.idleTimer = null;
    this.loaded = false;
    this.attentionImplementation = null;
    this.stopping = false;
    this.stopError = null;
  }

  isRunningFor(paths) {
    return Boolean(!this.stopping && this.child && this.child.exitCode == null
      && this.paths.python === paths.python
      && this.paths.modelDir === paths.modelDir
      && this.paths.attentionImplementation === paths.attentionImplementation);
  }

  start() {
    if (this.child && this.child.exitCode == null) return this.readyPromise;
    acquireGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { label: QWEN_TTS_ENGINE, state: "worker-starting" });
    this.stopping = false;
    this.stopError = null;
    this.stderrTail = "";
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const child = spawn(this.paths.python, [
      this.paths.worker,
      "--model-dir", this.paths.modelDir,
      "--device", this.paths.device,
      "--attention", this.paths.attentionImplementation
    ], {
      cwd: this.paths.runtimeRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        TOKENIZERS_PARALLELISM: "false",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1"
      }
    });
    this.child = child;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { workerPid: child.pid || null, state: "worker-starting" });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      this.stderrTail = `${this.stderrTail}${text}`.slice(-32_000);
      process.stderr.write(`[Qwen3-TTS] ${text}`);
    });
    child.once("error", (error) => {
      releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS);
      this.failAll(error);
    });
    child.once("exit", (code, signal) => {
      lines.close();
      this.child = null;
      this.loaded = false;
      clearTimeout(this.idleTimer);
      const suffix = this.stderrTail.trim().split(/\r?\n/).slice(-6).join("\n");
      const error = this.stopping
        ? this.stopError || cancellationError()
        : new Error(`Qwen3-TTS worker exited (${signal || code})${suffix ? `: ${suffix}` : ""}`);
      this.failAll(error);
      this.stopError = null;
      releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS);
    });
    return this.readyPromise;
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.stderrTail = `${this.stderrTail}\nUnexpected worker stdout: ${line}`.slice(-32_000);
      return;
    }
    if (message.type === "ready") {
      this.attentionImplementation = message.attentionImplementation || this.paths.attentionImplementation;
      updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { workerPid: this.child?.pid || null, state: "worker-ready" });
      this.resolveReady?.(message);
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.type === "progress") {
      this.pending.get(message.id)?.onProgress?.(message);
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.signal?.removeEventListener?.("abort", pending.onAbort);
    if (message.ok === false) pending.reject(new Error(message.error || "Qwen3-TTS request failed"));
    else {
      if (typeof message.result?.loaded === "boolean") this.loaded = message.result.loaded;
      this.attentionImplementation = message.result?.attentionImplementation || this.attentionImplementation;
      pending.resolve(message.result || message);
    }
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { state: this.loaded ? "loaded" : "worker-ready" });
    this.armIdleShutdown();
  }

  failAll(error) {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    for (const pending of this.pending.values()) {
      pending.signal?.removeEventListener?.("abort", pending.onAbort);
      pending.reject(error);
    }
    this.pending.clear();
  }

  armIdleShutdown() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.terminate();
    }, this.paths.idleMs);
    this.idleTimer.unref?.();
  }

  async request(command, payload = {}, { signal = null, onProgress = null } = {}) {
    if (signal?.aborted) throw cancellationError();
    await this.start();
    if (signal?.aborted) throw cancellationError();
    clearTimeout(this.idleTimer);
    const id = `request_${crypto.randomUUID()}`;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { state: command === "generate" ? "generating" : command });
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        reject(cancellationError());
        this.terminate(cancellationError());
      };
      this.pending.set(id, { resolve, reject, signal, onAbort, onProgress });
      signal?.addEventListener?.("abort", onAbort, { once: true });
      this.child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        signal?.removeEventListener?.("abort", onAbort);
        reject(error);
      });
    });
  }

  terminate(error = cancellationError()) {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child || child.exitCode != null) return;
    this.stopping = true;
    this.stopError = error;
    updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_TTS, { state: "unloading" });
    try { child.stdin.end(); } catch {}
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 3_000);
    timer.unref?.();
  }

  async shutdown(timeoutMs = 10_000) {
    if (!this.child || this.child.exitCode != null) return true;
    if (!this.pending.size) {
      try { await this.request("shutdown"); } catch {}
    }
    this.terminate();
    const child = this.child;
    if (!child || child.exitCode != null) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(value);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      child.once("exit", onExit);
    });
  }
}

function getWorker(paths) {
  if (!activeWorker?.isRunningFor(paths)) {
    activeWorker?.terminate();
    activeWorker = new PersistentQwenTtsWorker(paths);
  }
  return activeWorker;
}

export async function loadQwenTtsModel(options = {}) {
  const paths = options.paths || resolveQwenTtsPaths(options.env || process.env, options.platform || process.platform);
  const health = qwenTtsHealth({ paths, env: options.env || process.env });
  if (!health.ready) throw Object.assign(new Error(health.reason), { statusCode: 503 });
  return getWorker(paths).request("load", {}, { signal: options.signal, onProgress: options.onProgress });
}

export async function unloadQwenTtsModel(options = {}) {
  const worker = activeWorker;
  if (!worker?.child || worker.child.exitCode != null) return { unloaded: true, wasRunning: false, pid: null };
  if (worker.pending.size && options.force !== true) {
    throw Object.assign(new Error("Qwen3-TTS is generating. Cancel its active job before unloading."), { statusCode: 409 });
  }
  const pid = worker.child.pid || null;
  const exited = await worker.shutdown(Math.max(1_000, finite(options.timeoutMs, 12_000)));
  if (activeWorker === worker) activeWorker = null;
  if (!exited && worker.child && worker.child.exitCode == null) {
    throw Object.assign(new Error("Qwen3-TTS worker did not release GPU memory before the unload timeout"), { statusCode: 503 });
  }
  return { unloaded: true, wasRunning: true, pid };
}

export function cancelQwenTtsWorker() {
  if (!activeWorker?.child) return false;
  activeWorker.terminate();
  activeWorker = null;
  return true;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function unlinkWithRetry(file) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    } catch (error) {
      lastError = error;
      if (!PROJECT_SAVE_RETRY_CODES.has(String(error?.code || "")) || attempt === 5) throw error;
      Atomics.wait(PROJECT_SAVE_WAIT, 0, 0, 25 * (2 ** attempt));
    }
  }
  throw lastError;
}

function rollbackFinalizedOutput(options = {}) {
  const outputRoot = path.resolve(String(options.outputRoot || ""));
  const destination = path.resolve(String(options.destination || ""));
  const nativeRoot = path.resolve(String(options.nativeRoot || ""));
  const nativeFile = path.resolve(String(options.nativeFile || ""));
  const recoveryRoot = path.resolve(String(options.recoveryRoot || ""));
  let recoveryFile = path.resolve(String(options.recoveryFile || ""));
  if (!isInside(outputRoot, destination)) throw new Error("Refusing to roll back a Qwen output outside media/audio");
  if (!isInside(nativeRoot, nativeFile)) throw new Error("Refusing to recover a Qwen native master outside its provenance directory");
  if (!isInside(recoveryRoot, recoveryFile)) throw new Error("Refusing to recover a Qwen native master outside its recovery directory");

  const result = { removedDestination: false, recoveredNativeFile: null };
  if (fs.existsSync(destination)) {
    unlinkWithRetry(destination);
    result.removedDestination = true;
  }
  if (!fs.existsSync(nativeFile)) return result;
  fs.mkdirSync(recoveryRoot, { recursive: true });
  if (fs.existsSync(recoveryFile)) {
    if (sha256File(recoveryFile) === sha256File(nativeFile)) {
      unlinkWithRetry(nativeFile);
      result.recoveredNativeFile = recoveryFile;
      return result;
    }
    const parsed = path.parse(recoveryFile);
    recoveryFile = path.join(parsed.dir, `${parsed.name}.${crypto.randomUUID()}${parsed.ext}`);
    if (!isInside(recoveryRoot, recoveryFile)) throw new Error("Qwen native recovery collision escaped its recovery directory");
  }
  fs.renameSync(nativeFile, recoveryFile);
  result.recoveredNativeFile = recoveryFile;
  return result;
}

function updateFailedGeneration(projectSlug, generationId, error, cancelled, rollback = null) {
  try {
    const project = loadProject(projectSlug);
    const generation = generationById(project, generationId);
    if (!generation) return;
    generation.status = cancelled ? "cancelled" : "error";
    generation.error = cancelled ? null : String(error?.message || error);
    if (rollback?.recoveredNativeFile) {
      generation.recovery = {
        nativeFile: slashPath(path.relative(projectDir(projectSlug), rollback.recoveredNativeFile)),
        reason: "Final media registration rolled back",
        recoveredAt: new Date().toISOString()
      };
    }
    generation.updatedAt = new Date().toISOString();
    generation.finishedAt = generation.updatedAt;
    saveProjectWithRetry(project);
  } catch {}
}

export async function generateQwenTtsJob(job) {
  const paths = resolveQwenTtsPaths();
  const health = qwenTtsHealth({ paths });
  if (!health.ready) throw new Error(health.reason);
  const project = loadProject(job.projectSlug);
  const generation = generationById(project, job.refs?.generationId);
  if (!generation) throw new Error("Qwen3-TTS generation not found");
  if (generation.status === "cancelled") throw cancellationError();
  const voice = ensureProjectSound(project).voices.find((entry) => entry.id === generation.voiceId && entry.provider === QWEN_TTS_PROVIDER);
  if (!voice) throw new Error("Qwen3-TTS voice reference not found");
  const referenceFile = validateStoredVoice(project, voice);
  const outputRoot = mediaDir(project, "audio");
  const tempRoot = mediaDir(project, "temp");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  const outputFile = path.basename(String(generation.outputFile || ""));
  if (!outputFile || !outputFile.toLowerCase().endsWith(".wav")) throw new Error("Qwen3-TTS output filename is invalid");
  const destination = path.join(outputRoot, outputFile);
  const partial = path.join(tempRoot, `${generation.id}.production-48k-pcm24.partial.wav`);
  const nativeRelativeFile = `production/qwen3-tts/voice-clone/${generation.id}.native-24k-f32.wav`;
  const nativeFile = safeProjectFile(project.slug, nativeRelativeFile, "production/qwen3-tts/voice-clone/");
  const nativeRoot = path.dirname(nativeFile);
  const recoveryRelativeFile = `production/qwen3-tts/recovered/${generation.id}.native-24k-f32.wav`;
  const recoveryFile = safeProjectFile(project.slug, recoveryRelativeFile, "production/qwen3-tts/recovered/");
  const recoveryRoot = path.dirname(recoveryFile);
  if (fs.existsSync(destination)) throw new Error("Qwen3-TTS output filename already exists");
  for (const file of [partial, nativeFile]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }

  generation.status = "generating";
  generation.error = null;
  generation.updatedAt = new Date().toISOString();
  saveProjectWithRetry(project);
  job.label = `Create sound · ${generation.name}`;
  job.stage = "Loading standalone Qwen3-TTS Base";
  job.progress = 0.03;
  let destinationCommitted = false;
  let projectRecordCommitted = false;

  try {
    const result = await getWorker(paths).request("generate", {
      referenceAudio: referenceFile,
      referenceTranscript: voice.referenceTranscript,
      text: generation.text,
      language: generation.language,
      seed: generation.seed,
      settings: generation.sampling,
      nativePath: nativeFile,
      productionPath: partial
    }, {
      signal: job.signal,
      onProgress: (message) => {
        job.stage = String(message.stage || "Generating one continuous Qwen3-TTS voice clone");
        if (Number.isFinite(Number(message.progress))) job.progress = Math.max(0.03, Math.min(0.86, Number(message.progress)));
      }
    });
    if (job.signal?.aborted) throw cancellationError();
    if (!fs.existsSync(partial) || fs.statSync(partial).size < 64) throw new Error("Qwen3-TTS worker completed without a usable production WAV");
    if (!fs.existsSync(nativeFile) || fs.statSync(nativeFile).size < 64) throw new Error("Qwen3-TTS worker completed without its native WAV provenance master");
    job.stage = "Validating continuous Qwen speech master";
    job.progress = 0.9;
    const info = await probeMedia(partial, { signal: job.signal });
    if (!info?.audio) throw new Error("Qwen3-TTS output does not contain an audio stream");
    const facts = mediaFacts(info);
    if (!(facts.durationSec > 0)) throw new Error("Qwen3-TTS output has no measurable duration");
    if (job.signal?.aborted) throw cancellationError();
    fs.renameSync(partial, destination);
    destinationCommitted = true;
    const outputSha256 = sha256File(destination);
    const nativeSha256 = sha256File(nativeFile);
    const stat = fs.statSync(destination);

    const fresh = loadProject(project.slug);
    const target = generationById(fresh, generation.id);
    if (!target) throw new Error("Qwen3-TTS output was retained but its project generation record disappeared");
    if (target.status === "cancelled" || job.signal?.aborted) throw cancellationError();
    target.status = "done";
    target.file = outputFile;
    target.outputFile = outputFile;
    target.mediaUrl = `/media/${encodeURIComponent(fresh.slug)}/audio/${encodeURIComponent(outputFile)}`;
    target.nativeFile = nativeRelativeFile;
    target.sha256 = outputSha256;
    target.bytes = stat.size;
    Object.assign(target, facts);
    target.provenance = {
      provider: QWEN_TTS_PROVIDER,
      engine: QWEN_TTS_ENGINE,
      model: QWEN_TTS_MODEL,
      codeRevision: health.codeRevision,
      modelRevision: health.modelRevision,
      runtimeRoot: paths.runtimeRoot,
      modelDir: paths.modelDir,
      referenceSha256: voice.referenceSha256,
      referenceTranscriptSha256: voice.referenceTranscriptSha256,
      outputSha256,
      nativeSha256,
      nativeFile: nativeRelativeFile,
      precision: "bf16",
      device: result?.device || paths.device,
      attentionImplementation: result?.attentionImplementation || paths.attentionImplementation,
      nativeSampleRate: result?.nativeSampleRate || null,
      outputSampleRate: 48000,
      oneContinuousGeneration: result?.oneContinuousGeneration === true,
      xVectorOnlyMode: false,
      nonStreamingMode: true,
      seed: target.seed,
      sampling: target.sampling
    };
    target.error = null;
    target.updatedAt = new Date().toISOString();
    target.finishedAt = target.updatedAt;
    saveProjectWithRetry(fresh);
    projectRecordCommitted = true;
    job.result = {
      provider: QWEN_TTS_PROVIDER,
      generationId: target.id,
      file: outputFile,
      mediaUrl: target.mediaUrl,
      durationSec: target.durationSec,
      sampleRate: target.sampleRate,
      channels: target.channels,
      bytes: target.bytes,
      sha256: target.sha256,
      oneContinuousGeneration: true
    };
    job.progress = 0.98;
  } catch (error) {
    let rollback = null;
    if (destinationCommitted && !projectRecordCommitted) {
      try {
        rollback = rollbackFinalizedOutput({
          outputRoot,
          destination,
          nativeRoot,
          nativeFile,
          recoveryRoot,
          recoveryFile
        });
      } catch (rollbackError) {
        if (error && typeof error === "object") error.rollbackError = String(rollbackError?.message || rollbackError);
      }
    } else if (!projectRecordCommitted) {
      for (const file of [partial, nativeFile]) {
        try { if (fs.existsSync(file)) unlinkWithRetry(file); } catch {}
      }
    }
    const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted || job.status === "cancelling";
    updateFailedGeneration(project.slug, generation.id, error, cancelled, rollback);
    throw cancelled && error?.code !== "GENERATION_CANCELLED" ? cancellationError() : error;
  }
}

export const __qwenTtsTest = Object.freeze({
  forbiddenComfyPath,
  mediaFacts,
  rollbackFinalizedOutput,
  validateReferenceDuration,
  safeProjectFile,
  PersistentQwenTtsWorker
});
