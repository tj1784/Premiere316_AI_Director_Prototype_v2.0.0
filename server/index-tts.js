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
import { loadProject, mediaDir, saveProject } from "./projects.js";
import { PACKAGE_ROOT, projectDir } from "./paths.js";

export const INDEX_TTS_ENGINE = "IndexTTS-2.5";
export const INDEX_TTS_MODEL = "IndexTeam/IndexTTS-2.5";
export const INDEX_TTS_EMOTION_LABELS = Object.freeze([
  "happy",
  "angry",
  "sad",
  "afraid",
  "disgusted",
  "melancholic",
  "surprised",
  "calm"
]);

const ACTIVE_GENERATION_STATUSES = new Set(["queued", "generating"]);
const INDEX_TTS_LANGUAGES = new Set(["EN", "ZH", "JA", "ES", "AR"]);
const AUDIO_MIME_EXTENSIONS = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/flac", ".flac"],
  ["audio/x-flac", ".flac"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/ogg", ".ogg"],
  ["application/ogg", ".ogg"]
]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);
const REQUIRED_RUNTIME_FILES = Object.freeze([
  ["source", "indextts", "infer_v2_5.py"],
  ["config", "checkpoints", "config.yaml"],
  ["gpt", "checkpoints", "gpt.pth"],
  ["codec", "checkpoints", "codec.pth"],
  ["s2mel", "checkpoints", "s2mel.pth"],
  ["speaker-matrix", "checkpoints", "feat1.pt"],
  ["emotion-matrix", "checkpoints", "feat2.pt"],
  ["wav2vec-stats", "checkpoints", "wav2vec2bert_stats.pt"],
  ["multilingual tokenizer", "checkpoints", "multilingual_zh_ja_yue_char_del.tiktoken"],
  ["Wav2Vec-BERT config", "checkpoints", "hf_cache", "w2v-bert-2.0", "config.json"],
  ["Wav2Vec-BERT weights", "checkpoints", "hf_cache", "w2v-bert-2.0", "model.safetensors"],
  ["Wav2Vec-BERT preprocessor", "checkpoints", "hf_cache", "w2v-bert-2.0", "preprocessor_config.json"],
  ["semantic codec auxiliary weights", "checkpoints", "hf_cache", "semantic_codec_model.safetensors"],
  ["CAMPPlus weights", "checkpoints", "hf_cache", "campplus_cn_common.bin"],
  ["BigVGAN config", "checkpoints", "hf_cache", "bigvgan", "config.json"],
  ["BigVGAN weights", "checkpoints", "hf_cache", "bigvgan", "bigvgan_generator.pt"]
]);

function envFlag(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

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

const PROJECT_SAVE_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const PROJECT_SAVE_WAIT = new Int32Array(new SharedArrayBuffer(4));

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

function referenceMediaUrl(projectSlug, voiceId) {
  return `/api/projects/${encodeURIComponent(projectSlug)}/sound/index-tts/voices/${encodeURIComponent(voiceId)}/reference`;
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
    throw new Error("IndexTTS project file path is invalid");
  }
  if (!normalized.startsWith(requiredPrefix)) throw new Error("IndexTTS project file is outside its assigned directory");
  const root = path.resolve(projectDir(projectSlug));
  const disk = path.resolve(root, ...normalized.split("/"));
  if (!isInside(root, disk)) throw new Error("IndexTTS project file escaped the project root");
  return disk;
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

function readModelRevision(paths, env) {
  const explicit = String(env.INDEXTTS_MODEL_REVISION || "").trim();
  if (explicit) return explicit;
  for (const manifestFile of [
    path.join(paths.root, "premiere316-install.json"),
    path.join(paths.root, "install-manifest.json"),
    path.join(paths.modelDir, "index-tts-install.json")
  ]) {
    const manifest = readJsonMaybe(manifestFile);
    const revision = manifest?.modelRevision || manifest?.model_revision || manifest?.revision;
    if (revision) return String(revision);
  }
  try {
    const metadata = path.join(paths.modelDir, ".cache", "huggingface", "download", "config.yaml.metadata");
    const revision = fs.readFileSync(metadata, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^[a-f\d]{40}$/i.test(line));
    if (revision) return revision.toLowerCase();
  } catch {}
  return null;
}

export function resolveIndexTtsPaths(env = process.env, platform = process.platform) {
  const localAppData = String(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"));
  const root = path.resolve(String(env.INDEXTTS_ROOT || path.join(localAppData, "Premiere316", "IndexTTS-2.5")));
  const modelDir = path.resolve(String(env.INDEXTTS_MODEL_DIR || path.join(root, "checkpoints")));
  const defaultPython = platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  return {
    root,
    modelDir,
    configFile: path.join(modelDir, "config.yaml"),
    python: path.resolve(String(env.INDEXTTS_PYTHON || defaultPython)),
    worker: path.join(PACKAGE_ROOT, "scripts", "index_tts_worker.py"),
    qwenEmotionEnabled: envFlag(env.INDEXTTS_QWEN_EMOTION),
    idleMs: Math.max(10_000, finite(env.INDEXTTS_WORKER_IDLE_MS, 120_000))
  };
}

let activeWorker = null;

export function indexTtsHealth(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveIndexTtsPaths(env, options.platform || process.platform);
  const required = [
    { label: "python", file: paths.python },
    { label: "worker", file: paths.worker },
    ...REQUIRED_RUNTIME_FILES.map(([label, ...parts]) => ({ label, file: path.join(paths.root, ...parts) }))
  ];
  if (paths.qwenEmotionEnabled) {
    required.push({ label: "Qwen emotion model", file: path.join(paths.modelDir, "qwen0.6bemo4-merge") });
  }
  const missing = required.filter((entry) => !fs.existsSync(entry.file)).map((entry) => ({
    label: entry.label,
    file: entry.file
  }));
  const codeRevision = String(env.INDEXTTS_CODE_REVISION || "").trim() || readGitRevision(paths.root);
  const modelRevision = readModelRevision(paths, env);
  const ready = missing.length === 0;
  return {
    installed: fs.existsSync(paths.root),
    ready,
    available: ready,
    engine: INDEX_TTS_ENGINE,
    model: INDEX_TTS_MODEL,
    root: paths.root,
    modelDir: paths.modelDir,
    python: paths.python,
    codeRevision,
    modelRevision,
    qwenEmotionEnabled: paths.qwenEmotionEnabled,
    workerRunning: Boolean(activeWorker?.isAlive()),
    workerBusy: Boolean(activeWorker?.pending?.size),
    workerStopping: Boolean(activeWorker?.stopping),
    workerPid: activeWorker?.child?.pid || null,
    missing,
    reason: ready ? null : `Missing IndexTTS runtime files: ${missing.map((entry) => entry.label).join(", ")}`
  };
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function parseEmotionVector(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try { value = JSON.parse(text); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length < 8) return null;
  const vector = value.slice(0, 8).map((item) => {
    const number = Number(item);
    return Number.isFinite(number) ? Math.max(0, Math.min(1.15, number)) : 0;
  });
  return vector.some((item) => item > 0) || value.length >= 8 ? vector : null;
}

export function emotionVectorFromStyle(style) {
  const text = String(style || "").toLowerCase();
  const vector = [0.015, 0.01, 0.015, 0.01, 0, 0.015, 0.01, 0.22];
  if (includesAny(text, ["happy", "joy", "joyful", "eager", "grateful", "thankful", "hopeful", "bright"])) vector[0] += 0.28;
  if (includesAny(text, ["angry", "anger", "annoyed", "sharp", "stern", "defiant", "unyielding", "commanding", "critical"])) vector[1] += 0.3;
  if (includesAny(text, ["sad", "sorrow", "sorrowful", "pleading", "grief", "tear", "hurt"])) vector[2] += 0.28;
  if (includesAny(text, ["afraid", "fear", "fearful", "hesitant", "nervous", "anxious", "uncertain"])) vector[3] += 0.24;
  if (includesAny(text, ["disgust", "disgusted", "repulsed", "contempt"])) vector[4] += 0.25;
  if (includesAny(text, ["melancholy", "melancholic", "resigned", "heavy", "dark", "weary", "somber", "solemn"])) vector[5] += 0.28;
  if (includesAny(text, ["surprised", "surprise", "shocked", "astonished", "startled", "interrupting"])) vector[6] += 0.28;
  if (includesAny(text, ["calm", "quiet", "steady", "thoughtful", "observant", "mature", "measured", "slow", "controlled"])) vector[7] += 0.3;
  if (includesAny(text, ["bold", "firm", "determined", "unwavering", "absolute", "confident"])) {
    vector[1] += 0.08;
    vector[7] += 0.12;
  }
  const sum = vector.reduce((total, value) => total + value, 0);
  const scale = sum > 0.8 ? 0.8 / sum : 1;
  return vector.map((value) => rounded(Math.max(0, Math.min(1, value * scale))));
}

export function normalizeIndexTtsLanguage(value) {
  const language = String(value || "EN").trim().toUpperCase();
  const normalized = language === "AUTO" ? "EN" : language;
  if (!INDEX_TTS_LANGUAGES.has(normalized)) {
    throw Object.assign(new Error("IndexTTS language must be EN, ZH, JA, ES, AR, or AUTO"), { statusCode: 400 });
  }
  return normalized;
}

export function ensureProjectSound(project) {
  if (!project.sound || typeof project.sound !== "object") {
    project.sound = { schemaVersion: 2, voices: [], generations: [] };
  }
  project.sound.schemaVersion = Math.max(2, Number(project.sound.schemaVersion) || 1);
  project.sound.voices = Array.isArray(project.sound.voices) ? project.sound.voices : [];
  project.sound.generations = Array.isArray(project.sound.generations) ? project.sound.generations : [];
  return project.sound;
}

function audioExtension(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const fromMime = AUDIO_MIME_EXTENSIONS.get(mime);
  if (fromMime) return fromMime;
  const fromName = path.extname(String(file?.originalname || "")).toLowerCase();
  return AUDIO_EXTENSIONS.has(fromName) ? fromName : null;
}

function mediaFacts(info) {
  return {
    durationSec: finite(info?.durationSec ?? info?.audio?.duration, null),
    sampleRate: finite(info?.audio?.sample_rate ?? info?.audio?.sampleRate, null),
    channels: finite(info?.audio?.channels, null)
  };
}

function validateReferenceDuration(durationSec) {
  if (!(durationSec > 0)) throw new Error("The uploaded reference audio has no measurable duration");
  if (durationSec < 7.95 || durationSec > 15.05) {
    throw new Error(`Reference audio must be 8–15 seconds long; this file is ${durationSec.toFixed(2)} seconds`);
  }
  return durationSec;
}

function assertImmutableBufferCompatible(file, expectedHash) {
  if (fs.existsSync(file)) {
    if (!fs.statSync(file).isFile()) throw new Error("Immutable IndexTTS reference path is not a file");
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== expectedHash) throw new Error("Immutable IndexTTS reference hash collision");
  }
}

function immutableBufferWrite(file, buffer, expectedHash) {
  assertImmutableBufferCompatible(file, expectedHash);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

async function storeVoiceReference(project, file, speaker, name) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length < 64) {
    throw Object.assign(new Error("A non-empty reference audio file is required"), { statusCode: 400 });
  }
  const extension = audioExtension(file);
  if (!extension) {
    throw Object.assign(new Error("Use a WAV, FLAC, MP3, M4A, AAC, or OGG reference audio file."), { statusCode: 415 });
  }
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const relativeFile = `production/index-tts/references/${sha256}${extension}`;
  const disk = safeProjectFile(project.slug, relativeFile, "production/index-tts/references/");
  const temporary = `${disk}.${process.pid}.${crypto.randomUUID()}.probe${extension}`;
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  try {
    fs.writeFileSync(temporary, file.buffer, { flag: "wx" });
    const info = await probeMedia(temporary);
    if (!info?.audio) throw new Error("The uploaded reference does not contain a readable audio stream");
    const facts = mediaFacts(info);
    validateReferenceDuration(facts.durationSec);
    immutableBufferWrite(disk, file.buffer, sha256);
    const id = `voice_${sha256.slice(0, 16)}`;
    return {
      id,
      speaker,
      name,
      referenceFile: relativeFile,
      referenceMediaUrl: referenceMediaUrl(project.slug, id),
      referenceSha256: sha256,
      sourceFileName: path.basename(String(file.originalname || `reference${extension}`)),
      contentType: file.mimetype || null,
      bytes: file.buffer.length,
      ...facts
    };
  } catch (error) {
    throw Object.assign(new Error(`Reference audio validation failed: ${String(error.message || error)}`), { statusCode: 400 });
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function validateStoredVoice(project, voice) {
  if (!voice?.referenceFile || !voice?.referenceSha256) throw new Error("Saved IndexTTS voice reference is incomplete");
  const disk = safeProjectFile(project.slug, voice.referenceFile, "production/index-tts/references/");
  if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) throw new Error("Saved IndexTTS voice reference is missing");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(disk)).digest("hex");
  if (actual !== voice.referenceSha256) throw new Error("Saved IndexTTS voice reference failed its SHA-256 check");
  return disk;
}

function assertImmutableTextCompatible(file, text) {
  const contents = String(text || "");
  if (fs.existsSync(file)) {
    if (!fs.statSync(file).isFile()) throw new Error("Immutable IndexTTS transcript path is not a file");
    if (fs.readFileSync(file, "utf8") !== contents) throw new Error("Immutable IndexTTS transcript collision");
  }
}

function immutableTextWrite(file, text) {
  const contents = String(text || "");
  assertImmutableTextCompatible(file, contents);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

async function inspectIndexTtsVoiceReferenceFromFile(projectSlug, input = {}) {
  const project = loadProject(projectSlug);
  const sourceFile = path.resolve(String(input.sourceFile || ""));
  const projectRoot = path.resolve(projectDir(project.slug));
  if (!sourceFile || !isInside(projectRoot, sourceFile)) {
    throw Object.assign(new Error("IndexTTS handoff source must be an immutable file inside this project"), { statusCode: 400 });
  }
  if (path.extname(sourceFile).toLowerCase() !== ".wav" || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw Object.assign(new Error("IndexTTS handoff requires a valid project WAV"), { statusCode: 400 });
  }
  const transcript = String(input.transcript || "").replace(/\r\n/g, "\n").trim();
  if (!transcript) throw Object.assign(new Error("The exact reference transcript is required for IndexTTS handoff"), { statusCode: 400 });
  const validation = input.validation || {};
  if (validation.valid === false || validation.clipping === true || validation.excessiveSilence === true) {
    throw Object.assign(new Error("The selected audition failed clean-speaker reference validation"), { statusCode: 422 });
  }
  if (validation.singleSpeaker !== true || validation.musicDetected !== false) {
    throw Object.assign(new Error("IndexTTS handoff requires a verified single-speaker, music-free Qwen audition"), { statusCode: 422 });
  }

  const buffer = fs.readFileSync(sourceFile);
  if (buffer.length < 64) throw Object.assign(new Error("The selected Qwen audition is empty"), { statusCode: 400 });
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (input.sha256 && String(input.sha256).toLowerCase() !== sha256) {
    throw Object.assign(new Error("The selected Qwen audition changed before IndexTTS handoff"), { statusCode: 409 });
  }
  const info = await probeMedia(sourceFile);
  if (!info?.audio) throw Object.assign(new Error("The selected Qwen audition has no readable audio stream"), { statusCode: 400 });
  const facts = mediaFacts(info);
  validateReferenceDuration(facts.durationSec);

  const relativeFile = `production/index-tts/references/${sha256}.wav`;
  const destination = safeProjectFile(project.slug, relativeFile, "production/index-tts/references/");
  const transcriptRelativeFile = `production/index-tts/references/${sha256}.transcript.txt`;
  const transcriptFile = safeProjectFile(project.slug, transcriptRelativeFile, "production/index-tts/references/");
  assertImmutableBufferCompatible(destination, sha256);
  assertImmutableTextCompatible(transcriptFile, `${transcript}\n`);
  const id = `voice_${sha256.slice(0, 16)}`;
  return {
    project,
    sourceFile,
    transcript,
    buffer,
    sha256,
    facts,
    relativeFile,
    destination,
    transcriptRelativeFile,
    transcriptFile,
    id
  };
}

export async function validateIndexTtsVoiceReferenceFromFile(projectSlug, input = {}) {
  const inspected = await inspectIndexTtsVoiceReferenceFromFile(projectSlug, input);
  return {
    valid: true,
    projectSlug: inspected.project.slug,
    id: inspected.id,
    sourceFile: inspected.sourceFile,
    sourceFileName: path.basename(inspected.sourceFile),
    contentType: "audio/wav",
    transcript: inspected.transcript,
    sha256: inspected.sha256,
    bytes: inspected.buffer.length,
    referenceFile: inspected.relativeFile,
    referenceTranscriptFile: inspected.transcriptRelativeFile,
    ...inspected.facts
  };
}

export async function registerIndexTtsVoiceReferenceFromFile(projectSlug, input = {}) {
  const inspected = await inspectIndexTtsVoiceReferenceFromFile(projectSlug, input);
  const {
    project,
    sourceFile,
    transcript,
    buffer,
    sha256,
    facts,
    relativeFile,
    destination,
    transcriptRelativeFile,
    transcriptFile,
    id
  } = inspected;
  const sound = ensureProjectSound(project);
  immutableBufferWrite(destination, buffer, sha256);
  immutableTextWrite(transcriptFile, `${transcript}\n`);

  const now = new Date().toISOString();
  const candidate = {
    id,
    speaker: cleanText(input.speaker, input.name || "Designed voice", 80),
    name: cleanText(input.name, input.speaker || "Designed voice", 120),
    characterId: cleanText(input.characterId, "", 160) || null,
    assetId: cleanText(input.assetId, "", 180) || null,
    sourceAuditionId: cleanText(input.sourceAuditionId, "", 180) || null,
    sourceEngine: cleanText(input.sourceEngine, "Qwen3-TTS VoiceDesign", 120),
    referenceFile: relativeFile,
    referenceMediaUrl: referenceMediaUrl(project.slug, id),
    referenceSha256: sha256,
    referenceTranscript: transcript,
    referenceTranscriptFile: transcriptRelativeFile,
    sourceFileName: path.basename(sourceFile),
    contentType: "audio/wav",
    bytes: buffer.length,
    ...facts,
    indexTtsReady: true,
    provenance: input.provenance && typeof input.provenance === "object" ? structuredClone(input.provenance) : null,
    updatedAt: now
  };
  const existing = sound.voices.find((entry) => entry.id === id);
  let voice;
  if (existing) {
    Object.assign(existing, candidate);
    voice = existing;
  } else {
    voice = { ...candidate, createdAt: now };
    sound.voices.push(voice);
  }
  saveProject(project);
  return { project, sound, voice };
}

export function resolveIndexTtsVoiceReference(projectSlug, voiceId) {
  const project = loadProject(projectSlug);
  const voice = ensureProjectSound(project).voices.find((entry) => entry.id === String(voiceId || ""));
  if (!voice) throw Object.assign(new Error("IndexTTS voice reference not found"), { statusCode: 404 });
  const file = validateStoredVoice(project, voice);
  return { project, voice, file };
}

function generationById(project, generationId) {
  return ensureProjectSound(project).generations.find((entry) => entry.id === generationId) || null;
}

export async function createIndexTtsGeneration(projectSlug, input = {}) {
  const health = indexTtsHealth();
  if (!health.ready) throw Object.assign(new Error(health.reason), { statusCode: 503 });
  const project = loadProject(projectSlug);
  const sound = ensureProjectSound(project);
  const text = String(input.text || "").replace(/\r\n/g, "\n").trim();
  if (!text) throw Object.assign(new Error("Speech text is required"), { statusCode: 400 });
  if (text.length > 12_000) throw Object.assign(new Error("Speech text must be 12,000 characters or fewer"), { statusCode: 400 });
  const speaker = cleanText(input.speaker, "Voice", 80);
  const name = cleanText(input.name, `${speaker} speech`, 120);
  const voiceName = cleanText(input.voiceName, speaker, 120);
  const style = String(input.style || "").replace(/\r\n/g, "\n").trim().slice(0, 2_000);
  const emotionWeight = rounded(Math.max(0, Math.min(1, finite(input.emotionWeight, 0.8))));
  const language = normalizeIndexTtsLanguage(input.language);
  const durationFactor = finite(input.durationFactor, 1);
  if (durationFactor < 0.5 || durationFactor > 2) {
    throw Object.assign(new Error("IndexTTS durationFactor must be between 0.5 and 2.0"), { statusCode: 400 });
  }

  let voice = null;
  if (input.referenceAudio?.buffer) {
    const candidate = await storeVoiceReference(project, input.referenceAudio, speaker, voiceName);
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
    voice = sound.voices.find((entry) => entry.id === voiceId) || null;
    if (!voice) throw Object.assign(new Error("Upload referenceAudio or select a saved voiceId"), { statusCode: 404 });
  }
  validateStoredVoice(project, voice);

  const id = `sound_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const outputFile = `${fileSlug(name)}_${id.slice(-12)}.wav`;
  const requestedSeed = finite(input.seed, null);
  const seed = requestedSeed == null
    ? Number.parseInt(crypto.createHash("sha256").update(id).digest("hex").slice(0, 8), 16)
    : Math.max(0, Math.min(0x7fffffff, Math.trunc(requestedSeed)));
  const generation = {
    id,
    jobId: null,
    engine: INDEX_TTS_ENGINE,
    model: INDEX_TTS_MODEL,
    status: "queued",
    speaker,
    name,
    text,
    style,
    language,
    durationFactor: rounded(durationFactor),
    seed,
    emotionWeight,
    emotionLabels: [...INDEX_TTS_EMOTION_LABELS],
    emotionVector: parseEmotionVector(input.emotionVector) || emotionVectorFromStyle(style),
    emotionVectorSource: parseEmotionVector(input.emotionVector) ? "emotion-preset" : "premiere316-style-heuristic",
    voiceId: voice.id,
    reference: {
      file: voice.referenceFile,
      sha256: voice.referenceSha256,
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

export function bindIndexTtsGenerationJob(projectSlug, generationId, jobId) {
  const project = loadProject(projectSlug);
  const generation = generationById(project, generationId);
  if (!generation) throw new Error("IndexTTS generation disappeared before its job was registered");
  generation.jobId = jobId;
  generation.updatedAt = new Date().toISOString();
  saveProjectWithRetry(project);
  return generation;
}

export function cancelIndexTtsGeneration(projectSlug, generationId) {
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

export function getProjectSound(projectSlug, activeGenerationIds = null) {
  const project = loadProject(projectSlug);
  const hadSoundState = Boolean(project.sound && typeof project.sound === "object");
  const sound = ensureProjectSound(project);
  let changed = false;
  for (const voice of sound.voices) {
    if (voice.provider && voice.provider !== "indexTts") continue;
    const expectedUrl = referenceMediaUrl(project.slug, voice.id);
    if (voice.referenceMediaUrl !== expectedUrl) {
      voice.referenceMediaUrl = expectedUrl;
      changed = true;
    }
  }
  if (activeGenerationIds) {
    const active = activeGenerationIds instanceof Set ? activeGenerationIds : new Set(activeGenerationIds);
    for (const generation of sound.generations) {
      if (generation.provider && generation.provider !== "indexTts") continue;
      if (!ACTIVE_GENERATION_STATUSES.has(generation.status) || active.has(generation.id)) continue;
      generation.status = "interrupted";
      generation.error = "Generation was interrupted before Premiere316 could register its output.";
      generation.updatedAt = new Date().toISOString();
      generation.finishedAt = generation.updatedAt;
      changed = true;
    }
  }
  if (changed || !hadSoundState) saveProjectWithRetry(project);
  return { project, sound, health: indexTtsHealth() };
}

class PersistentIndexTtsWorker {
  constructor(paths) {
    this.paths = paths;
    this.child = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.pending = new Map();
    this.stderrTail = "";
    this.idleTimer = null;
    this.stopping = false;
  }

  isRunningFor(paths) {
    return Boolean(!this.stopping && this.child && this.child.exitCode == null && this.paths.root === paths.root && this.paths.python === paths.python);
  }

  isAlive() {
    return Boolean(this.child && this.child.exitCode == null);
  }

  start() {
    if (this.child && this.child.exitCode == null) return this.readyPromise;
    acquireGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, {
      label: INDEX_TTS_ENGINE,
      state: "loading"
    });
    this.stopping = false;
    this.stderrTail = "";
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const args = [
      this.paths.worker,
      "--root", this.paths.root,
      "--model-dir", this.paths.modelDir,
      "--config", this.paths.configFile,
      ...(this.paths.qwenEmotionEnabled ? ["--use-qwen-emo"] : [])
    ];
    const child = spawn(this.paths.python, args, {
      cwd: this.paths.root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        TOKENIZERS_PARALLELISM: "false",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1"
      }
    });
    this.child = child;
    updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, { workerPid: child.pid || null });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      this.stderrTail = `${this.stderrTail}${text}`.slice(-32_000);
      process.stderr.write(`[IndexTTS] ${text}`);
    });
    child.once("error", (error) => {
      releaseGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS);
      this.failAll(error);
    });
    child.once("exit", (code, signal) => {
      lines.close();
      this.child = null;
      clearTimeout(this.idleTimer);
      const suffix = this.stderrTail.trim().split(/\r?\n/).slice(-6).join("\n");
      const error = new Error(`IndexTTS worker exited (${signal || code})${suffix ? `: ${suffix}` : ""}`);
      if (!this.stopping) this.failAll(error);
      releaseGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS);
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
      updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, {
        workerPid: this.child?.pid || null,
        state: "loaded"
      });
      this.resolveReady?.(message);
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.type === "fatal") {
      this.failAll(new Error(message.error || "IndexTTS worker failed during startup"));
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
    if (message.ok === false) pending.reject(new Error(message.error || "IndexTTS generation failed"));
    else pending.resolve(message.result || message);
    updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, { state: "loaded" });
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
      if (!this.pending.size) this.stop();
    }, this.paths.idleMs);
    this.idleTimer.unref?.();
  }

  async request(payload, { signal, onProgress } = {}) {
    if (signal?.aborted) throw cancellationError();
    await this.start();
    if (signal?.aborted) throw cancellationError();
    clearTimeout(this.idleTimer);
    updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, { state: "generating" });
    const id = `request_${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const error = cancellationError();
        this.pending.delete(id);
        reject(error);
        this.stop();
      };
      this.pending.set(id, { resolve, reject, signal, onAbort, onProgress });
      signal?.addEventListener?.("abort", onAbort, { once: true });
      this.child.stdin.write(`${JSON.stringify({ ...payload, id, command: "generate" })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        signal?.removeEventListener?.("abort", onAbort);
        reject(error);
      });
    });
  }

  stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child || child.exitCode != null) return;
    this.stopping = true;
    updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, { state: "unloading" });
    try { child.stdin.end(); } catch {}
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 2_000);
    timer.unref?.();
  }

  async waitForExit(timeoutMs = 5_000) {
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

export async function unloadIndexTtsModel(options = {}) {
  const worker = activeWorker;
  if (!worker?.isAlive()) return { unloaded: true, wasRunning: false, pid: null };
  if (worker.pending.size && options.force !== true) {
    throw Object.assign(new Error("IndexTTS is generating. Cancel its active job before unloading."), { statusCode: 409 });
  }
  const pid = worker.child?.pid || null;
  worker.stop();
  const exited = await worker.waitForExit(Math.max(1_000, finite(options.timeoutMs, 8_000)));
  if (activeWorker === worker && !worker.isAlive()) activeWorker = null;
  if (!exited && worker.isAlive()) {
    throw Object.assign(new Error("IndexTTS worker did not release GPU memory before the unload timeout"), { statusCode: 503 });
  }
  return { unloaded: true, wasRunning: true, pid };
}

function cancellationError() {
  const error = new Error("IndexTTS generation stopped by director");
  error.code = "GENERATION_CANCELLED";
  return error;
}

function getWorker(paths) {
  if (!activeWorker?.isRunningFor(paths)) {
    activeWorker?.stop();
    activeWorker = new PersistentIndexTtsWorker(paths);
  }
  return activeWorker;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function updateFailedGeneration(projectSlug, generationId, error, cancelled) {
  try {
    const project = loadProject(projectSlug);
    const generation = generationById(project, generationId);
    if (!generation) return;
    generation.status = cancelled ? "cancelled" : "error";
    generation.error = cancelled ? null : String(error?.message || error);
    generation.updatedAt = new Date().toISOString();
    generation.finishedAt = generation.updatedAt;
    saveProjectWithRetry(project);
  } catch {}
}

export async function generateIndexTtsJob(job) {
  const paths = resolveIndexTtsPaths();
  const health = indexTtsHealth({ paths });
  if (!health.ready) throw new Error(health.reason);
  const project = loadProject(job.projectSlug);
  const generation = generationById(project, job.refs?.generationId);
  if (!generation) throw new Error("IndexTTS generation not found");
  if (generation.status === "cancelled") throw cancellationError();
  const voice = ensureProjectSound(project).voices.find((entry) => entry.id === generation.voiceId);
  if (!voice) throw new Error("IndexTTS voice reference not found");
  const referenceFile = validateStoredVoice(project, voice);
  const outputRoot = mediaDir(project, "audio");
  const tempRoot = mediaDir(project, "temp");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  const outputFile = path.basename(String(generation.outputFile || ""));
  if (!outputFile || !outputFile.toLowerCase().endsWith(".wav")) throw new Error("IndexTTS output filename is invalid");
  const destination = path.join(outputRoot, outputFile);
  const partial = path.join(tempRoot, `${generation.id}.partial.wav`);
  if (fs.existsSync(destination)) throw new Error("IndexTTS output filename already exists");
  try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch {}

  generation.status = "generating";
  generation.error = null;
  generation.updatedAt = new Date().toISOString();
  saveProjectWithRetry(project);
  job.label = `Create sound · ${generation.name}`;
  job.stage = "Loading standalone IndexTTS-2.5";
  job.progress = 0.04;

  try {
    const result = await getWorker(paths).request({
      referenceAudio: referenceFile,
      text: generation.text,
      outputPath: partial,
      language: generation.language || "en",
      style: generation.style || "",
      emotionWeight: generation.emotionWeight,
      emotionVector: generation.emotionVector,
      durationFactor: generation.durationFactor,
      seed: generation.seed
    }, {
      signal: job.signal,
      onProgress: (message) => {
        job.stage = String(message.stage || "Generating cloned speech with IndexTTS-2.5");
        if (Number.isFinite(Number(message.progress))) job.progress = Math.max(0.05, Math.min(0.84, Number(message.progress)));
      }
    });
    if (job.signal?.aborted) throw cancellationError();
    if (!fs.existsSync(partial) || fs.statSync(partial).size < 64) throw new Error("IndexTTS worker completed without a usable WAV file");
    job.stage = "Validating generated speech";
    job.progress = 0.88;
    const info = await probeMedia(partial, { signal: job.signal });
    if (!info?.audio) throw new Error("IndexTTS output does not contain an audio stream");
    const facts = mediaFacts(info);
    if (!(facts.durationSec > 0)) throw new Error("IndexTTS output has no measurable duration");
    if (job.signal?.aborted) throw cancellationError();
    fs.renameSync(partial, destination);
    const outputSha256 = sha256File(destination);
    const stat = fs.statSync(destination);

    const fresh = loadProject(project.slug);
    const target = generationById(fresh, generation.id);
    if (!target) throw new Error("IndexTTS output was retained but its project generation record disappeared");
    if (target.status === "cancelled" || job.signal?.aborted) throw cancellationError();
    target.status = "done";
    target.file = outputFile;
    target.outputFile = outputFile;
    target.mediaUrl = `/media/${encodeURIComponent(fresh.slug)}/audio/${encodeURIComponent(outputFile)}`;
    target.sha256 = outputSha256;
    target.bytes = stat.size;
    Object.assign(target, facts);
    target.emotionVector = Array.isArray(result?.emotionVector) ? result.emotionVector.map((value) => rounded(value)) : target.emotionVector;
    target.emotionVectorSource = result?.emotionVectorSource || target.emotionVectorSource;
    target.provenance = {
      engine: INDEX_TTS_ENGINE,
      model: INDEX_TTS_MODEL,
      codeRevision: health.codeRevision,
      modelRevision: health.modelRevision,
      runtimeRoot: paths.root,
      referenceSha256: voice.referenceSha256,
      outputSha256,
      precision: "bf16",
      device: result?.device || "auto",
      useCudaKernel: false,
      useDeepSpeed: false,
      useAccel: false,
      useTorchCompile: false,
      useQwenEmotion: paths.qwenEmotionEnabled,
      durationFactor: target.durationFactor,
      seed: target.seed,
      emotionVector: target.emotionVector,
      emotionVectorSource: target.emotionVectorSource
    };
    target.error = null;
    target.updatedAt = new Date().toISOString();
    target.finishedAt = target.updatedAt;
    saveProjectWithRetry(fresh);
    job.result = {
      generationId: target.id,
      file: outputFile,
      mediaUrl: target.mediaUrl,
      durationSec: target.durationSec,
      sampleRate: target.sampleRate,
      channels: target.channels,
      bytes: target.bytes,
      sha256: target.sha256,
      emotionVector: target.emotionVector
    };
    job.progress = 0.98;
  } catch (error) {
    try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch {}
    const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted || job.status === "cancelling";
    updateFailedGeneration(project.slug, generation.id, error, cancelled);
    throw cancelled && error?.code !== "GENERATION_CANCELLED" ? cancellationError() : error;
  }
}

export const __indexTtsTest = Object.freeze({
  audioExtension,
  mediaFacts,
  validateReferenceDuration,
  safeProjectFile,
  PersistentIndexTtsWorker
});
