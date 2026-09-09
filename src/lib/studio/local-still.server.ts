import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { nativeAdapterCapabilities, runtimeDefaults, type NativeGenerationValues } from "./engine-controls.ts";
import { createGenerationProvenance, provenanceSidecarName, serializeGenerationProvenance, telemetryFromWorker, type GenerationProvenance, type ExecutedTextEncoding } from "./generation-provenance.ts";
import { executedNativeStillSettings, toNativeStillWorkerRequest } from "./native-still-contract.ts";
import { NATIVE_STILL_MODEL_PATHS } from "./native-model-paths.server.ts";
import { KREA2_COMPONENTS, KREA2_ROOT } from "./krea2-runtime.server.ts";
import type { EncodeAssetDraftPromptsResult } from "../desktop/protocol.ts";

const PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
const FLUX_ROOT = "D:\\Projects\\flux";
const FLUX2_ROOT = "D:\\Projects\\Flux2";
const APP_VERSION = "3.0.2";
const T5_SNAPSHOT_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2";
const MISTRAL_REVISION = "95a6d26c4bfb886c58daf9d3f7332c857cb27b43";
const PROCESSOR_REVISION = "68faf511d618ef198fef186659617cfd2eb8e33a";
type NativeWorkerKind = "flux" | "flux2" | "krea-2";
const EXACT_COMPONENTS = {
  flux: { role: "transformer", id: "flux1-dev.safetensors@4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7", path: NATIVE_STILL_MODEL_PATHS.flux1 },
  ae: { role: "vae", id: "ae.safetensors@afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", path: NATIVE_STILL_MODEL_PATHS.flux1Vae },
  t5: { role: "text_encoder", id: "t5xxl_fp16.safetensors@6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635", path: "D:\\AI\\Models\\text_encoders\\t5xxl_fp16.safetensors" },
  t5Config: { role: "tokenizer", id: `google/t5-v1_1-xxl-config-tokenizer@${T5_SNAPSHOT_REVISION}`, path: `D:\\_Cache\\HuggingFace\\hub\\models--google--t5-v1_1-xxl\\snapshots\\${T5_SNAPSHOT_REVISION}` },
  clip: { role: "text_encoder", id: "clip_l.safetensors@660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", path: "D:\\AI\\Models\\text_encoders\\clip_l.safetensors" },
  bpe: { role: "tokenizer", id: "open_clip:bpe_simple_vocab_16e6@924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\bpe_simple_vocab_16e6.txt.gz" },
  openclipTokenizer: { role: "tokenizer_source", id: "open_clip:tokenizer.py@90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\tokenizer.py" },
  runtime: { role: "runtime", id: "black-forest-labs/flux@802fb4713906133fcbd0d8dc5351620ca4773036", path: FLUX_ROOT },
} as const;
const EXACT_FLUX2_COMPONENTS = {
  flux2: { role: "transformer", id: "flux2_dev.safetensors@6159a3f19f829c8e84ba6e9996b7afaf7c0a5f3428677f5b37445778a320d275", path: NATIVE_STILL_MODEL_PATHS.flux2 },
  ae: { role: "vae", id: "flux2-vae.safetensors@d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", path: NATIVE_STILL_MODEL_PATHS.flux2Vae },
  mistral: { role: "text_encoder", id: `mistralai/Mistral-Small-3.2-24B-Instruct-2506@${MISTRAL_REVISION}`, path: `D:\\_Cache\\HuggingFace\\hub\\models--mistralai--Mistral-Small-3.2-24B-Instruct-2506\\snapshots\\${MISTRAL_REVISION}` },
  processor: { role: "processor", id: `mistralai/Mistral-Small-3.1-24B-Instruct-2503@${PROCESSOR_REVISION}`, path: `D:\\_Cache\\HuggingFace\\hub\\models--mistralai--Mistral-Small-3.1-24B-Instruct-2503\\snapshots\\${PROCESSOR_REVISION}` },
  runtime: { role: "runtime", id: "black-forest-labs/flux2@50fe5162777813d869182b139e83b10743caef15", path: FLUX2_ROOT },
} as const;

let durableMediaRoot = join(process.cwd(), "media", "stills");
let worker: ChildProcess | null = null;
let workerKind: NativeWorkerKind | null = null;
let workerLogFd: number | undefined;
let seq = 0;
const pending = new Map<string, (msg: WorkerMsg) => void>();
let activeProgress: { id: string; child: ChildProcess; onProgress?: (message: string) => void } | null = null;

/** Forward only bounded, explicit worker phase records; never arbitrary stderr or traceback text. */
export function parseNativeStillProgress(line: string): string | null {
  const match = /^\[(?:FLUX\.2|KREA\.2) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] (.{1,500})$/.exec(line);
  if (!match) return null;
  const message = match[1];
  const fixed = [
    "Reusing loaded FLUX.2 models; text encoder remains in system RAM.",
    "Verifying local component files and checkpoint hashes.",
    "Validating transformer and VAE keys/shapes on CPU/meta before loading GPU weights.",
    "Transformer and converted VAE passed strict key/shape validation.",
    "Loading the Mistral text encoder into CPU/system RAM.", "CPU text encoder loaded.",
    "Loading FLUX.2 transformer weights into GPU VRAM.", "Loading the image VAE into GPU VRAM.",
    "FLUX.2 models loaded; ready to encode the prompt.",
    "Sampling finished. Decoding and saving the generated image.",
    "Loading Qwen3-VL-4B text encoder into GPU VRAM.",
    "Verifying local KREA.2 component files and checkpoint hashes.",
    "Unloading the GPU text encoder before image generation.",
    "Text encoder unload confirmed. All saved prompt encodings are ready.",
    "Reusing the loaded KREA.2 RAW image model.",
    "Loading KREA.2 RAW image model and VAE into GPU VRAM.",
    "Sampling finished. Decoding the generated image.",
  ];
  return fixed.includes(message) || /^(?:Encoding prompt \d+\/\d+ on GPU; no truncation\.|Prompt \d+\/\d+ encoded in \d+(?:\.\d+)? seconds\.|Sampling step \d+\/\d+ completed\.|Sampling KREA\.2 RAW at (?:512x512|1024x1024): 52 steps, CFG 3\.5\.|Encoding the complete \d+-character prompt on CPU; no truncation\.|CPU prompt encoding completed in \d+(?:\.\d+)? seconds\.|Encoding \d+ attached reference image\(s\) for conditioning\.|Sampling the image on GPU: \d+ denoising steps, guidance \d+(?:\.\d+)?\.|Image saved\. Total generation time: \d+(?:\.\d+)? seconds\.)$/.test(message) ? message : null;
}

export type LocalStillInput = { prompt: string; engineId: string; engineName: string; references: string[]; promptReferences?: string[]; selectedBasePath?: string; values?: NativeGenerationValues; assetId?: string; pictureId?: string; preparedAssetId?: string };
export type LocalStillOutputProof = { mediaUri: string; mediaSha256: string; sidecarSha256: string; width: number; height: number; byteLength: number; mediaBytes: number[]; sidecarBytes: number[] };
export type LocalStillResult = { ok: true; url: string; provenance: GenerationProvenance; output: LocalStillOutputProof; workerIdentityDigest?: string; componentDigest?: string } | { ok: false; error: string };
export type LocalEngineCheck = { ok: true; modelName: string } | { ok: false; error: string };

type WorkerMsg = { id?: string; ok?: boolean; error?: string; code?: string; loaded?: boolean; model?: string; engine?: string; seed?: number; referencesUsed?: Array<{ pathName: string; sha256: string }>; workerIdentity?: unknown; componentDigest?: string; telemetry?: Record<string, unknown>; promptCount?: number; cachedPromptCount?: number; encoderReleased?: boolean; textEncoderDevice?: string; encodeMs?: number; textEncoding?: unknown };

export function setLocalStillMediaRoot(root: string): void {
  if (!root || /\0/.test(root)) throw new Error("Invalid durable media root.");
  durableMediaRoot = resolve(root, "stills");
}

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

export function verifiedTextEncoding(value: unknown): ExecutedTextEncoding {
  if (!value || typeof value !== "object") throw new Error("KREA worker did not return its GPU prompt encoding proof.");
  const item = value as Record<string, unknown>;
  if (item.device !== "cuda" || item.cached !== true || typeof item.cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(item.cacheKey) || typeof item.cacheSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.cacheSha256) || typeof item.contextLength !== "number" || !Number.isInteger(item.contextLength) || item.contextLength < 1 || item.contextLength > 8192 || typeof item.encodeMs !== "number" || !Number.isFinite(item.encodeMs) || item.encodeMs < 0) throw new Error("KREA worker GPU prompt encoding proof is invalid.");
  return { device: "cuda", cached: true, cacheKey: item.cacheKey, cacheSha256: item.cacheSha256, contextLength: item.contextLength, encodeMs: item.encodeMs };
}

function pngInfo(bytes: Uint8Array): { ok: true; width: number; height: number } | { ok: false; error: string } {
  if (bytes.byteLength < 33) return { ok: false, error: "Generated PNG is too small." };
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((value, index) => bytes[index] === value)) return { ok: false, error: "Generated media is not a PNG." };
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return { ok: false, error: "Generated PNG IHDR is missing." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (!(width === height && [512, 1024].includes(width)) && !(width === 1536 && height === 1024)) return { ok: false, error: "Generated PNG must be 512×512, 1024×1024 or 1536×1024." };
  return { ok: true, width, height };
}

function assertSafeMediaBasename(name: string, kind: "png" | "sidecar" = "png"): void {
  const pattern = kind === "png" ? /^[a-zA-Z0-9._-]+\.png$/ : /^[a-zA-Z0-9._-]+\.provenance\.json$/;
  if (!pattern.test(name) || name.includes("%") || name.includes(":") || name.startsWith(".")) throw new Error("Generated media URI is invalid.");
}

function safeDurablePath(name: string, kind: "png" | "sidecar" = "png"): string {
  assertSafeMediaBasename(name, kind);
  mkdirSync(durableMediaRoot, { recursive: true });
  const rootReal = realpathSync(durableMediaRoot);
  const file = resolve(rootReal, name);
  const rel = relative(rootReal, file);
  if (rel.startsWith("..") || rel === "" || /[/\\]/.test(rel)) throw new Error("Media path escapes the durable media root.");
  return file;
}

export function verifyLocalStillOutput(output: LocalStillOutputProof): { ok: true; output: LocalStillOutputProof } | { ok: false; error: string } {
  try {
    const fileName = output.mediaUri.replace(/^media:\/\/stills\//, "");
    const mediaPath = safeDurablePath(fileName);
    const sidecarPath = safeDurablePath(provenanceSidecarName(fileName), "sidecar");
    const mediaReal = realpathSync(mediaPath); const sidecarReal = realpathSync(sidecarPath);
    if (relative(realpathSync(durableMediaRoot), mediaReal).startsWith("..") || relative(realpathSync(durableMediaRoot), sidecarReal).startsWith("..")) throw new Error("Durable media symlink escape rejected.");
    const mediaBytes = readFileSync(mediaReal); const sidecarBytes = readFileSync(sidecarReal);
    const parsed = pngInfo(mediaBytes); if (!parsed.ok) return parsed;
    const mediaSha256 = sha256(mediaBytes); const sidecarSha256 = sha256(sidecarBytes);
    if (mediaSha256 !== output.mediaSha256 || sidecarSha256 !== output.sidecarSha256) return { ok: false, error: "Generated media or sidecar hash changed on disk." };
    if (parsed.width !== output.width || parsed.height !== output.height || mediaBytes.byteLength !== output.byteLength) return { ok: false, error: "Generated media dimensions or size changed on disk." };
    return { ok: true, output: { ...output, mediaBytes: [...mediaBytes], sidecarBytes: [...sidecarBytes] } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Generated media verification failed." };
  }
}

function profileRoot(): string { return resolve(durableMediaRoot, "..", ".."); }
function workerLabel(kind: NativeWorkerKind): string { return kind === "krea-2" ? "krea2" : kind === "flux2" ? "flux2" : "flux1"; }
function workerRoot(kind: NativeWorkerKind): string { return join(profileRoot(), "native", `${workerLabel(kind)}-worker`); }
function cacheRoot(kind: NativeWorkerKind): string { return join(profileRoot(), "native", `${workerLabel(kind)}-cache`); }
function logPath(kind: NativeWorkerKind): string { return join(profileRoot(), "native", `${workerLabel(kind)}-worker.log`); }

function workerSourcePath(kind: NativeWorkerKind): string {
  const file = `${workerLabel(kind)}_jsonl_worker.py`;
  const packaged = process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", file) : "";
  if (packaged && existsSync(packaged)) return packaged;
  return join(process.cwd(), "desktop", "workers", file);
}

function closeEngineLog() { if (workerLogFd !== undefined) { try { closeSync(workerLogFd); } catch { /* closed */ } workerLogFd = undefined; } }
function cleanupPendingOutput(path: string | null) { if (!path) return; for (const candidate of [path, path.replace(/\.png$/, ".tmp.png")]) { try { if (existsSync(candidate)) unlinkSync(candidate); } catch { /* bounded best-effort cleanup; generation remains failed */ } } }
function killWorker() { const child = worker; worker = null; workerKind = null; pending.forEach((resolve) => resolve({ ok: false, error: "App-owned image worker stopped." })); pending.clear(); if (child?.pid) child.kill(); closeEngineLog(); }
function attachWorker(child: ChildProcess) {
  worker = child;
  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => { if (!line.trim()) return; try { const msg = JSON.parse(line) as WorkerMsg; if (msg.id && pending.has(msg.id)) { const resolve = pending.get(msg.id); pending.delete(msg.id); resolve?.(msg); } } catch { /* stdout is JSONL-only; malformed records are ignored and timeout */ } });
  child.stderr?.on("data", (chunk) => { if (workerLogFd !== undefined) try { writeSync(workerLogFd, chunk); } catch { /* log closed */ } });
  if (child.stderr) createInterface({ input: child.stderr }).on("line", (line) => {
    const active = activeProgress;
    if (worker !== child || active?.child !== child) return;
    const message = parseNativeStillProgress(line);
    if (message) try { active.onProgress?.(message); } catch { /* A progress observer cannot fail generation. */ }
  });
  child.on("exit", () => { if (worker === child) { worker = null; workerKind = null; pending.forEach((resolve) => resolve({ ok: false, error: "App-owned image worker exited." })); pending.clear(); closeEngineLog(); } });
}
function callWorker(payload: Record<string, unknown>, timeoutMs: number, onProgress?: (message: string) => void): Promise<WorkerMsg> {
  const child = worker; if (!child?.stdin) return Promise.resolve({ ok: false, error: "App-owned image worker is not running." });
  const exclusive = payload.method === "generate" || payload.method === "encode_prompts";
  if (exclusive && activeProgress) return Promise.resolve({ ok: false, error: "An app-owned image operation is already running." });
  const id = String(++seq);
  if (exclusive) activeProgress = { id, child, onProgress };
  return new Promise((resolve) => {
    const clearProgress = () => { if (activeProgress?.id === id) activeProgress = null; };
    const timer = setTimeout(() => {
      pending.delete(id); clearProgress();
      if (exclusive) killWorker();
      resolve({ ok: false, error: "App-owned image worker timed out." });
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); clearProgress(); resolve(msg); });
    child.stdin!.write(`${JSON.stringify({ ...payload, id })}\n`);
  });
}

export async function stopLocalEngine(): Promise<{ ok: true; stopped: boolean }> { const running = Boolean(worker?.pid); killWorker(); return { ok: true, stopped: running }; }

export async function encodeLocalStillPrompts(input: { engineId: string; prompts: string[] }, onProgress?: (message: string) => void): Promise<EncodeAssetDraftPromptsResult> {
  try {
    if (input.engineId !== "krea-2") throw new Error("Selected worker does not support staged GPU prompt encoding.");
    if (!input.prompts.length || input.prompts.length > 100 || input.prompts.some((prompt) => !prompt.trim() || prompt.length > 20_000)) throw new Error("Invalid native prompt batch.");
    requireIdentityFiles(runtimeIdentity("krea-2"));
    const ready = await ensureLocalEngine("krea-2");
    if (!ready.ok) return ready;
    const result = await callWorker({ method: "encode_prompts", prompts: input.prompts }, 34 * 60_000, onProgress);
    if (!result.ok) throw new Error(result.error || "Native GPU prompt encoding failed.");
    if (result.promptCount !== input.prompts.length || result.encoderReleased !== true || result.textEncoderDevice !== "cuda" || result.cachedPromptCount !== input.prompts.length || typeof result.encodeMs !== "number") throw new Error("Worker did not confirm complete GPU prompt encoding and text encoder release.");
    return { ok: true, promptCount: result.promptCount, cachedPromptCount: result.cachedPromptCount, encoderReleased: true, textEncoderDevice: "cuda", encodeMs: result.encodeMs };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Native prompt encoding failed." }; }
}

export async function ensureLocalEngine(kind: NativeWorkerKind = "flux2"): Promise<{ ok: true; hello: WorkerMsg } | { ok: false; error: string }> {
  if (worker?.pid && workerKind === kind) { const ping = await callWorker({ method: "ping" }, 8_000); if (ping.ok) return { ok: true, hello: ping }; killWorker(); }
  if (worker?.pid && workerKind !== kind) killWorker();
  if (process.env.P316_PACKAGED_APP !== "1") return { ok: false, error: "Native image generation is packaged-app only and never auto-loads from the dev renderer." };
  const workerFile = workerSourcePath(kind);
  if (!existsSync(PYTHON)) return { ok: false, error: "Local Python runtime is not installed." };
  if (!existsSync(workerFile)) return { ok: false, error: `Packaged Premiere316 ${workerLabel(kind)} worker is missing.` };
  mkdirSync(workerRoot(kind), { recursive: true }); mkdirSync(cacheRoot(kind), { recursive: true }); mkdirSync(durableMediaRoot, { recursive: true }); mkdirSync(dirname(logPath(kind)), { recursive: true });
  workerLogFd = openSync(logPath(kind), "a");
  const env = workerEnv(kind, workerFile);
  const child = spawn(PYTHON, ["-u", workerFile], { cwd: workerRoot(kind), windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
  attachWorker(child);
  workerKind = kind;
  const hello = await callWorker({ method: "ping" }, 20_000);
  if (!hello.ok) { killWorker(); return { ok: false, error: hello.error || "App-owned image worker did not start." }; }
  return { ok: true, hello };
}

function workerEnv(kind: NativeWorkerKind, workerFile: string): NodeJS.ProcessEnv {
  const keep = ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  const cache = cacheRoot(kind);
  const shared = { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONPYCACHEPREFIX: join(cache, "pycache"), HF_HOME: join(cache, "hf"), TRANSFORMERS_CACHE: join(cache, "transformers"), TORCH_HOME: join(cache, "torch"), TMP: join(cache, "tmp"), TEMP: join(cache, "tmp"), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", NO_PROXY: "*", P316_WORKER_ROOT: workerRoot(kind), P316_OUTPUT_ROOT: durableMediaRoot, P316_CACHE_ROOT: cache, P316_PYCACHE_ROOT: join(cache, "pycache"), P316_WORKER_FILE: workerFile };
  if (kind === "krea-2") return { ...shared, P316_KREA_SOURCE_ROOT: KREA2_ROOT, P316_MODEL_KREA2: KREA2_COMPONENTS.transformer.path, P316_MODEL_KREA2_QWEN: KREA2_COMPONENTS.encoder.path, P316_MODEL_KREA2_VAE: KREA2_COMPONENTS.vae.path, P316_KREA_QWEN_CONFIG: KREA2_COMPONENTS.encoderConfig.path, P316_KREA_VAE_CONFIG: KREA2_COMPONENTS.vaeConfig.path };
  if (kind === "flux2") {
    return { ...shared, P316_BFL_FLUX2_SOURCE_ROOT: join(FLUX2_ROOT, "src"), P316_MODEL_FLUX2: EXACT_FLUX2_COMPONENTS.flux2.path, P316_MODEL_FLUX2_AE: EXACT_FLUX2_COMPONENTS.ae.path, FLUX2_MODEL_PATH: EXACT_FLUX2_COMPONENTS.flux2.path, AE_MODEL_PATH: EXACT_FLUX2_COMPONENTS.ae.path, P316_MISTRAL_MODEL: EXACT_FLUX2_COMPONENTS.mistral.path, P316_MISTRAL_PROCESSOR: EXACT_FLUX2_COMPONENTS.processor.path };
  }
  return { ...shared, P316_BFL_FLUX_SOURCE_ROOT: join(FLUX_ROOT, "src"), P316_MODEL_FLUX: EXACT_COMPONENTS.flux.path, P316_MODEL_AE: EXACT_COMPONENTS.ae.path, FLUX_MODEL: EXACT_COMPONENTS.flux.path, FLUX_AE: EXACT_COMPONENTS.ae.path, P316_MODEL_T5: EXACT_COMPONENTS.t5.path, P316_T5_CONFIG_DIR: EXACT_COMPONENTS.t5Config.path, P316_MODEL_CLIP: EXACT_COMPONENTS.clip.path, P316_OPENCLIP_BPE: EXACT_COMPONENTS.bpe.path, P316_OPENCLIP_TOKENIZER: EXACT_COMPONENTS.openclipTokenizer.path };
}

export async function exposeLocalStill(input: LocalStillInput, onProgress?: (message: string) => void): Promise<LocalStillResult> {
  let pendingPath: string | null = null;
  try {
    const capabilities = nativeAdapterCapabilities(input.engineId, input.selectedBasePath || input.engineName);
    const kind: NativeWorkerKind | null = capabilities?.adapterId === "krea-2" && capabilities.modelVariant === "krea2-raw" ? "krea-2" : capabilities?.adapterId === "flux2" && capabilities.modelVariant === "flux2-dev" ? "flux2" : capabilities?.adapterId === "flux" && capabilities.modelVariant === "flux1-dev" ? "flux" : null;
    if (!capabilities || !kind) return { ok: false, error: "Selected image model has no packaged prepared-asset worker." };
    if (input.references.length && kind !== "flux2") return { ok: false, error: "This text-only worker does not support image conditioning." };
    const referencePaths = input.references.map((uri) => {
      if (!uri.startsWith("media://stills/")) throw new Error("Reference image must be attached to this app's media library.");
      const path = safeDurablePath(uri.slice("media://stills/".length));
      if (!existsSync(path)) throw new Error("Attached reference image is missing.");
      return path;
    });
    const identity = runtimeIdentity(kind); requireIdentityFiles(identity);
    const selectedBasePath = input.selectedBasePath || identity.relativeBasePath;
    if (normalizeRelative(selectedBasePath) !== normalizeRelative(identity.relativeBasePath)) return { ok: false, error: "Selected checkpoint is not bound to this native runtime adapter." };
    const wake = await ensureLocalEngine(kind); if (!wake.ok) return wake;
    requirePlausibleGpuMemory(identity, kind === "flux" ? ["transformer", "text_encoder", "vae"] : ["transformer", "vae"], wake.hello.loaded === true);
    const id = randomUUID();
    const temporaryName = `${id}.pending.png`; pendingPath = safeDurablePath(temporaryName);
    const workerRequest = toNativeStillWorkerRequest({ capabilities, values: { ...runtimeDefaults(capabilities), ...(input.values ?? {}), prompt: input.prompt }, prompt: input.prompt, engineId: input.engineId, engineName: input.engineName, out: pendingPath, referencePaths });
    const started = performance.now();
    const before = await callWorker({ method: "ping" }, 8_000);
    const result = await callWorker(workerRequest, 30 * 60_000, onProgress);
    const totalMs = performance.now() - started;
    if (!result.ok) { cleanupPendingOutput(pendingPath); pendingPath = null; return { ok: false, error: result.error || "App-owned image generation failed." }; }
    const textEncoding = kind === "krea-2" ? verifiedTextEncoding(result.textEncoding) : undefined;
    const executedReferences = referencePaths.map((path, index) => ({ id: input.references[index], fingerprint: sha256(readFileSync(path)) }));
    const promptReferences = (input.promptReferences ?? []).map((uri) => {
      if (!uri.startsWith("media://stills/")) throw new Error("Prompt reference is not attached to the app media library.");
      const path = safeDurablePath(uri.slice("media://stills/".length));
      const real = realpathSync(path);
      if (relative(realpathSync(durableMediaRoot), real).startsWith("..")) throw new Error("Prompt reference escapes the app media library.");
      return { id: uri, fingerprint: sha256(readFileSync(real)) };
    });
    if (referencePaths.length && (result.referencesUsed?.length !== referencePaths.length || executedReferences.some((reference, index) => result.referencesUsed?.[index]?.sha256 !== reference.fingerprint))) throw new Error("Worker did not confirm the attached reference images were used.");
    if (!existsSync(pendingPath)) { pendingPath = null; return { ok: false, error: "App-owned image worker finished without a plate." }; }
    const bytes = readFileSync(pendingPath); const parsed = pngInfo(bytes); if (!parsed.ok) { cleanupPendingOutput(pendingPath); pendingPath = null; return parsed; }
    if (parsed.width !== workerRequest.width || parsed.height !== workerRequest.height) throw new Error("Generated PNG dimensions do not match the authorized request.");
    const mediaSha = sha256(bytes); const outName = `${id}.${mediaSha.slice(0, 24)}.png`; const finalPath = safeDurablePath(outName);
    if (existsSync(finalPath)) throw new Error("Content-addressed generated media already exists.");
    renameSync(pendingPath, finalPath);
    pendingPath = null;
    const executed = executedNativeStillSettings(capabilities, workerRequest, { ...result, ok: true });
    const after = await callWorker({ method: "ping" }, 8_000);
    const telemetry = telemetryFromWorker({ ...(result.telemetry ?? {}), totalMs, residentBeforeJob: Boolean(before.loaded), residentAfterJob: Boolean(after.loaded) }, totalMs);
    const provenance = createGenerationProvenance({ assetId: input.assetId ?? id, engineId: input.engineId, engineName: input.engineName, runtimeAdapter: capabilities.adapterId, runtimeImplementation: capabilities.runtimeImplementation, baseCheckpoint: { id: identity.relativeBasePath, path: rendererSafeRuntimePath(identity.basePath), fingerprint: fullOrSampleFingerprint(identity.basePath), fingerprintKind: "sampled" }, components: identity.components.map((component) => ({ ...component, path: rendererSafeRuntimePath(component.path), fingerprint: fullOrSampleFingerprint(component.path) })), loras: [], prompt: workerRequest.prompt, enhancedPrompt: null, references: executedReferences, ...(kind === "krea-2" ? { promptReferences, conditioningMode: "text-only" as const, textEncoding } : { conditioningMode: referencePaths.length ? "text-and-image" as const : "text-only" as const }), ...executed, timestepData: null, placementPlan: null, generatedAt: new Date().toISOString(), applicationVersion: APP_VERSION, telemetry });
    const sidecarPath = safeDurablePath(provenanceSidecarName(outName), "sidecar");
    writeFileSync(sidecarPath, serializeGenerationProvenance(provenance), { encoding: "utf8", flag: "wx" });
    const sidecarBytes = readFileSync(sidecarPath);
    const output = { mediaUri: `media://stills/${outName}`, mediaSha256: mediaSha, sidecarSha256: sha256(sidecarBytes), width: parsed.width, height: parsed.height, byteLength: bytes.byteLength, mediaBytes: [...bytes], sidecarBytes: [...sidecarBytes] };
    return { ok: true, url: output.mediaUri, provenance, output, workerIdentityDigest: sha256(JSON.stringify(result.workerIdentity ?? wake.hello.workerIdentity ?? null)), componentDigest: result.componentDigest ?? after.componentDigest };
  } catch (e) { cleanupPendingOutput(pendingPath); return { ok: false, error: e instanceof Error ? e.message : "Local still failed." }; }
}

export function inspectLocalEngine(_input: Pick<LocalStillInput, "engineId" | "engineName" | "selectedBasePath">): LocalEngineCheck {
  return { ok: false, error: "Free runtime inspect/wake is disabled; packaged Generate performs its own prepared authorization checks." };
}

const fingerprintCache = new Map<string, string | null>();
function fullOrSampleFingerprint(path: string): string | null { if (fingerprintCache.has(path)) return fingerprintCache.get(path) ?? null; try { const stats = statSync(path); const v = stats.size < 64 * 1024 * 1024 ? sha256(readFileSync(path)) : sampledFingerprint(path); fingerprintCache.set(path, v); return v; } catch { fingerprintCache.set(path, null); return null; } }
function sampledFingerprint(path: string): string | null { let fd: number | undefined; try { const stats = statSync(path); if (stats.isDirectory()) { const hash = createHash("sha256"); const files = walkFingerprintFiles(path); for (const file of files.slice(0, 256)) { const s = statSync(file); hash.update(relative(path, file).replace(/\\/g, "/")); hash.update(String(s.size)); const f = openSync(file, "r"); try { const sample = Buffer.alloc(Math.min(256 * 1024, s.size)); readSync(f, sample, 0, sample.length, 0); hash.update(sample); } finally { closeSync(f); } } return hash.digest("hex"); } fd = openSync(path, "r"); const bytes = Buffer.alloc(Math.min(4 * 1024 * 1024, stats.size)); readSync(fd, bytes, 0, bytes.length, 0); return sha256(Buffer.concat([bytes, Buffer.from(String(stats.size))])); } catch { return null; } finally { if (fd !== undefined) closeSync(fd); } }
function walkFingerprintFiles(root: string): string[] { const files: string[] = []; const visit = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) visit(path); else if (entry.isFile()) files.push(path); } }; visit(root); return files.sort(); }
function normalizeRelative(path: string): string { return path.replace(/\\/g, "/").replace(/^d:\/ai\/models\//i, "").replace(/^model-vault\//i, "").toLowerCase(); }
function rendererSafeRuntimePath(path: string): string { const normalized = path.replace(/\//g, "\\"); const modelRoot = "D:\\AI\\Models\\"; if (normalized.toLowerCase().startsWith(modelRoot.toLowerCase())) return normalized.slice(modelRoot.length); return normalized.split(/[/\\]/).pop() || "local-component"; }
function requireIdentityFiles(identity: ReturnType<typeof runtimeIdentity>): void { for (const path of [identity.basePath, ...identity.components.map((component) => component.path)]) if (!existsSync(path)) throw new Error(`Native runtime component is not installed: ${path.split(/[\\/]/).pop() || "component"}`); }
export function requiredFreeGpuMemoryBytes(cudaWeightBytes: number, confirmedResident: boolean): number { return (confirmedResident ? 0 : cudaWeightBytes) + 2 * 1024 ** 3; }
function requirePlausibleGpuMemory(identity: ReturnType<typeof runtimeIdentity>, cudaRoles: string[] = ["transformer", "text_encoder", "vae"], confirmedResident = false): void {
  const memory = installedGpuMemory(); if (memory === null) return;
  const cudaPaths = [identity.basePath, ...identity.components.filter((component) => cudaRoles.includes(component.role)).map((component) => component.path)];
  const cudaWeightBytes = [...new Set(cudaPaths)].reduce((total, path) => total + pathFootprintBytes(path), 0);
  const required = requiredFreeGpuMemoryBytes(cudaWeightBytes, confirmedResident);
  if (required > memory.freeBytes) throw new Error(`MEMORY RISK: ${confirmedResident ? "Loaded model working reserve" : "Audited CUDA weights plus working reserve"} requires ${formatGib(required)} GiB, but current free VRAM is ${formatGib(memory.freeBytes)} GiB.`);
}
function installedGpuMemory(): { totalBytes: number; freeBytes: number } | null { try { const result = spawnSync("nvidia-smi", ["--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"], { windowsHide: true, encoding: "utf8", timeout: 5_000 }); if (result.status !== 0) return null; const rows = String(result.stdout).trim().split(/\r?\n/).map((line) => line.split(",").map((value) => Number(value.trim()))).filter(([total, free]) => Number.isFinite(total) && Number.isFinite(free) && total > 0 && free > 0); if (!rows.length) return null; const [total, free] = rows.sort((a, b) => b[1] - a[1])[0]; return { totalBytes: total * 1024 ** 2, freeBytes: free * 1024 ** 2 }; } catch { return null; } }
const footprintCache = new Map<string, number>();
function pathFootprintBytes(path: string): number { if (footprintCache.has(path)) return footprintCache.get(path) ?? 0; try { const stats = statSync(path); const value = stats.isDirectory() ? walkFingerprintFiles(path).reduce((total, file) => total + statSync(file).size, 0) : stats.size; footprintCache.set(path, value); return value; } catch { return 0; } }
function formatGib(bytes: number): string { return (bytes / 1024 ** 3).toFixed(1); }
function runtimeIdentity(kind: NativeWorkerKind = "flux") {
  if (kind === "krea-2") return { modelName: "krea2-raw", relativeBasePath: "diffusion_models\\Krea 2\\krea2_raw_bf16.safetensors", basePath: KREA2_COMPONENTS.transformer.path, components: [KREA2_COMPONENTS.runtime, KREA2_COMPONENTS.encoder, KREA2_COMPONENTS.encoderConfig, KREA2_COMPONENTS.vae, KREA2_COMPONENTS.vaeConfig] };
  if (kind === "flux2") return { modelName: "flux2-dev", relativeBasePath: "diffusion_models\\flux2_dev.safetensors", basePath: EXACT_FLUX2_COMPONENTS.flux2.path, components: [EXACT_FLUX2_COMPONENTS.runtime, EXACT_FLUX2_COMPONENTS.mistral, EXACT_FLUX2_COMPONENTS.processor, EXACT_FLUX2_COMPONENTS.ae] };
  return { modelName: "flux-dev", relativeBasePath: "diffusion_models\\flux1-dev.safetensors", basePath: EXACT_COMPONENTS.flux.path, components: [EXACT_COMPONENTS.runtime, EXACT_COMPONENTS.t5, EXACT_COMPONENTS.t5Config, EXACT_COMPONENTS.clip, EXACT_COMPONENTS.bpe, EXACT_COMPONENTS.openclipTokenizer, EXACT_COMPONENTS.ae] };
}
