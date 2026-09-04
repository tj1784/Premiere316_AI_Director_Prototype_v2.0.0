import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { nativeAdapterCapabilities, runtimeDefaults, type NativeGenerationValues } from "./engine-controls.ts";
import { createGenerationProvenance, provenanceSidecarName, serializeGenerationProvenance, telemetryFromWorker, type GenerationProvenance } from "./generation-provenance.ts";
import { executedNativeStillSettings, toNativeStillWorkerRequest } from "./native-still-contract.ts";

const PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
const FLUX_ROOT = "D:\\Projects\\flux";
const APP_VERSION = "3.0.2";
const T5_SNAPSHOT_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2";
const EXACT_COMPONENTS = {
  flux: { role: "transformer", id: "flux1-dev.safetensors@4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7", path: "D:\\AI\\Models\\diffusion_models\\flux1-dev.safetensors" },
  ae: { role: "vae", id: "ae.safetensors@afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", path: "D:\\AI\\Models\\vae\\ae.safetensors" },
  t5: { role: "text_encoder", id: "t5xxl_fp16.safetensors@6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635", path: "D:\\AI\\Models\\text_encoders\\t5xxl_fp16.safetensors" },
  t5Config: { role: "tokenizer", id: `google/t5-v1_1-xxl-config-tokenizer@${T5_SNAPSHOT_REVISION}`, path: `D:\\_Cache\\HuggingFace\\hub\\models--google--t5-v1_1-xxl\\snapshots\\${T5_SNAPSHOT_REVISION}` },
  clip: { role: "text_encoder", id: "clip_l.safetensors@660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", path: "D:\\AI\\Models\\text_encoders\\clip_l.safetensors" },
  bpe: { role: "tokenizer", id: "open_clip:bpe_simple_vocab_16e6@924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\bpe_simple_vocab_16e6.txt.gz" },
  openclipTokenizer: { role: "tokenizer_source", id: "open_clip:tokenizer.py@90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\tokenizer.py" },
  runtime: { role: "runtime", id: "black-forest-labs/flux@802fb4713906133fcbd0d8dc5351620ca4773036", path: FLUX_ROOT },
} as const;

let durableMediaRoot = join(process.cwd(), "media", "stills");
let worker: ChildProcess | null = null;
let workerLogFd: number | undefined;
let seq = 0;
const pending = new Map<string, (msg: WorkerMsg) => void>();

export type LocalStillInput = { prompt: string; engineId: string; engineName: string; references: string[]; selectedBasePath?: string; values?: NativeGenerationValues; assetId?: string; pictureId?: string; preparedAssetId?: string };
export type LocalStillOutputProof = { mediaUri: string; mediaSha256: string; sidecarSha256: string; width: number; height: number; byteLength: number; mediaBytes: number[]; sidecarBytes: number[] };
export type LocalStillResult = { ok: true; url: string; provenance: GenerationProvenance; output: LocalStillOutputProof; workerIdentityDigest?: string; componentDigest?: string } | { ok: false; error: string };
export type LocalEngineCheck = { ok: true; modelName: string } | { ok: false; error: string };

type WorkerMsg = { id?: string; ok?: boolean; error?: string; code?: string; loaded?: boolean; model?: string; engine?: string; seed?: number; workerIdentity?: unknown; componentDigest?: string; telemetry?: Record<string, unknown> };

export function setLocalStillMediaRoot(root: string): void {
  if (!root || /\0/.test(root)) throw new Error("Invalid durable media root.");
  durableMediaRoot = resolve(root, "stills");
}

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

function pngInfo(bytes: Uint8Array): { ok: true; width: number; height: number } | { ok: false; error: string } {
  if (bytes.byteLength < 33) return { ok: false, error: "Generated PNG is too small." };
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((value, index) => bytes[index] === value)) return { ok: false, error: "Generated media is not a PNG." };
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return { ok: false, error: "Generated PNG IHDR is missing." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (width !== 512 || height !== 512) return { ok: false, error: "Generated PNG must be exactly 512x512 for Wave 4." };
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
function workerRoot(): string { return join(profileRoot(), "native", "flux1-worker"); }
function cacheRoot(): string { return join(profileRoot(), "native", "flux1-cache"); }
function logPath(): string { return join(profileRoot(), "native", "flux1-worker.log"); }

function workerSourcePath(): string {
  const packaged = process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", "flux1_jsonl_worker.py") : "";
  if (packaged && existsSync(packaged)) return packaged;
  return join(process.cwd(), "desktop", "workers", "flux1_jsonl_worker.py");
}

function closeEngineLog() { if (workerLogFd !== undefined) { try { closeSync(workerLogFd); } catch { /* closed */ } workerLogFd = undefined; } }
function cleanupPendingOutput(path: string | null) { if (!path) return; for (const candidate of [path, path.replace(/\.png$/, ".tmp.png")]) { try { if (existsSync(candidate)) unlinkSync(candidate); } catch { /* bounded best-effort cleanup; generation remains failed */ } } }
function killWorker() { const child = worker; worker = null; pending.forEach((resolve) => resolve({ ok: false, error: "App-owned FLUX.1 worker stopped." })); pending.clear(); if (child?.pid) child.kill(); closeEngineLog(); }
function attachWorker(child: ChildProcess) {
  worker = child;
  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => { if (!line.trim()) return; try { const msg = JSON.parse(line) as WorkerMsg; if (msg.id && pending.has(msg.id)) { const resolve = pending.get(msg.id); pending.delete(msg.id); resolve?.(msg); } } catch { /* stdout is JSONL-only; malformed records are ignored and timeout */ } });
  child.stderr?.on("data", (chunk) => { if (workerLogFd !== undefined) try { writeSync(workerLogFd, chunk); } catch { /* log closed */ } });
  child.on("exit", () => { if (worker === child) { worker = null; pending.forEach((resolve) => resolve({ ok: false, error: "App-owned FLUX.1 worker exited." })); pending.clear(); closeEngineLog(); } });
}
function callWorker(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerMsg> {
  const child = worker; if (!child?.stdin) return Promise.resolve({ ok: false, error: "App-owned FLUX.1 worker is not running." });
  const id = String(++seq);
  return new Promise((resolve) => { const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "App-owned FLUX.1 worker timed out." }); }, timeoutMs); pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); }); child.stdin!.write(`${JSON.stringify({ ...payload, id })}\n`); });
}

export async function stopLocalEngine(): Promise<{ ok: true; stopped: boolean }> { const running = Boolean(worker?.pid); killWorker(); return { ok: true, stopped: running }; }

export async function ensureLocalEngine(): Promise<{ ok: true; hello: WorkerMsg } | { ok: false; error: string }> {
  if (worker?.pid) { const ping = await callWorker({ method: "ping" }, 8_000); if (ping.ok) return { ok: true, hello: ping }; killWorker(); }
  if (process.env.P316_PACKAGED_APP !== "1") return { ok: false, error: "Native FLUX.1 generation is packaged-app only and never auto-loads from the dev renderer." };
  const workerFile = workerSourcePath();
  if (!existsSync(PYTHON)) return { ok: false, error: "Local Python runtime is not installed." };
  if (!existsSync(workerFile)) return { ok: false, error: "Packaged Premiere316 FLUX.1 worker is missing." };
  mkdirSync(workerRoot(), { recursive: true }); mkdirSync(cacheRoot(), { recursive: true }); mkdirSync(durableMediaRoot, { recursive: true }); mkdirSync(dirname(logPath()), { recursive: true });
  workerLogFd = openSync(logPath(), "a");
  const env = workerEnv(workerFile);
  const child = spawn(PYTHON, ["-u", workerFile], { cwd: workerRoot(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
  attachWorker(child);
  const hello = await callWorker({ method: "ping" }, 20_000);
  if (!hello.ok) { killWorker(); return { ok: false, error: hello.error || "App-owned FLUX.1 worker did not start." }; }
  return { ok: true, hello };
}

function workerEnv(workerFile: string): NodeJS.ProcessEnv {
  const keep = ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  const cache = cacheRoot();
  return { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONPYCACHEPREFIX: join(cache, "pycache"), HF_HOME: join(cache, "hf"), TRANSFORMERS_CACHE: join(cache, "transformers"), TORCH_HOME: join(cache, "torch"), TMP: join(cache, "tmp"), TEMP: join(cache, "tmp"), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", NO_PROXY: "*", P316_WORKER_ROOT: workerRoot(), P316_OUTPUT_ROOT: durableMediaRoot, P316_CACHE_ROOT: cache, P316_PYCACHE_ROOT: join(cache, "pycache"), P316_BFL_FLUX_SOURCE_ROOT: join(FLUX_ROOT, "src"), P316_MODEL_FLUX: EXACT_COMPONENTS.flux.path, P316_MODEL_AE: EXACT_COMPONENTS.ae.path, FLUX_MODEL: EXACT_COMPONENTS.flux.path, FLUX_AE: EXACT_COMPONENTS.ae.path, P316_MODEL_T5: EXACT_COMPONENTS.t5.path, P316_T5_CONFIG_DIR: EXACT_COMPONENTS.t5Config.path, P316_MODEL_CLIP: EXACT_COMPONENTS.clip.path, P316_OPENCLIP_BPE: EXACT_COMPONENTS.bpe.path, P316_OPENCLIP_TOKENIZER: EXACT_COMPONENTS.openclipTokenizer.path, P316_WORKER_FILE: workerFile };
}

export async function exposeLocalStill(input: LocalStillInput): Promise<LocalStillResult> {
  let pendingPath: string | null = null;
  try {
    const capabilities = nativeAdapterCapabilities(input.engineId, input.selectedBasePath || input.engineName);
    if (!capabilities || capabilities.adapterId !== "flux" || capabilities.modelVariant !== "flux1-dev") return { ok: false, error: "Only packaged FLUX.1 prepared-asset generation is enabled in Wave 4." };
    if (input.references.length) return { ok: false, error: "FLUX.1 references are unsupported in the Wave 4 worker." };
    const identity = runtimeIdentity(); requireIdentityFiles(identity); requirePlausibleGpuMemory(identity);
    const selectedBasePath = input.selectedBasePath || identity.relativeBasePath;
    if (normalizeRelative(selectedBasePath) !== normalizeRelative(identity.relativeBasePath)) return { ok: false, error: "Selected checkpoint is not bound to this native runtime adapter." };
    const wake = await ensureLocalEngine(); if (!wake.ok) return wake;
    const id = randomUUID();
    const temporaryName = `${id}.pending.png`; pendingPath = safeDurablePath(temporaryName);
    const workerRequest = toNativeStillWorkerRequest({ capabilities, values: { ...runtimeDefaults(capabilities), ...(input.values ?? {}), prompt: input.prompt, width: 512, height: 512 }, prompt: input.prompt, engineId: input.engineId, engineName: input.engineName, out: pendingPath, referencePaths: [] });
    const started = performance.now();
    const before = await callWorker({ method: "ping" }, 8_000);
    const result = await callWorker(workerRequest, 30 * 60_000);
    const totalMs = performance.now() - started;
    if (!result.ok) { cleanupPendingOutput(pendingPath); pendingPath = null; return { ok: false, error: result.error || "App-owned FLUX.1 generation failed." }; }
    if (!existsSync(pendingPath)) { pendingPath = null; return { ok: false, error: "App-owned FLUX.1 worker finished without a plate." }; }
    const bytes = readFileSync(pendingPath); const parsed = pngInfo(bytes); if (!parsed.ok) { cleanupPendingOutput(pendingPath); pendingPath = null; return parsed; }
    const mediaSha = sha256(bytes); const outName = `${id}.${mediaSha.slice(0, 24)}.png`; const finalPath = safeDurablePath(outName);
    if (existsSync(finalPath)) throw new Error("Content-addressed generated media already exists.");
    renameSync(pendingPath, finalPath);
    pendingPath = null;
    const executed = executedNativeStillSettings(capabilities, workerRequest, { ...result, ok: true });
    const after = await callWorker({ method: "ping" }, 8_000);
    const telemetry = telemetryFromWorker({ ...(result.telemetry ?? {}), totalMs, residentBeforeJob: Boolean(before.loaded), residentAfterJob: Boolean(after.loaded) }, totalMs);
    const provenance = createGenerationProvenance({ assetId: input.assetId ?? id, engineId: input.engineId, engineName: input.engineName, runtimeAdapter: capabilities.adapterId, runtimeImplementation: capabilities.runtimeImplementation, baseCheckpoint: { id: identity.relativeBasePath, path: rendererSafeRuntimePath(identity.basePath), fingerprint: fullOrSampleFingerprint(identity.basePath), fingerprintKind: "sampled" }, components: identity.components.map((component) => ({ ...component, path: rendererSafeRuntimePath(component.path), fingerprint: fullOrSampleFingerprint(component.path) })), loras: [], prompt: workerRequest.prompt, enhancedPrompt: null, references: [], ...executed, timestepData: null, placementPlan: null, generatedAt: new Date().toISOString(), applicationVersion: APP_VERSION, telemetry });
    const sidecarPath = safeDurablePath(provenanceSidecarName(outName), "sidecar");
    writeFileSync(sidecarPath, serializeGenerationProvenance(provenance), { encoding: "utf8", flag: "wx" });
    const sidecarBytes = readFileSync(sidecarPath);
    const output = { mediaUri: `media://stills/${outName}`, mediaSha256: mediaSha, sidecarSha256: sha256(sidecarBytes), width: 512, height: 512, byteLength: bytes.byteLength, mediaBytes: [...bytes], sidecarBytes: [...sidecarBytes] };
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
function requirePlausibleGpuMemory(identity: ReturnType<typeof runtimeIdentity>): void { const memory = installedGpuMemory(); if (memory === null) return; const cudaPaths = [identity.basePath, ...identity.components.filter((component) => component.role === "text_encoder" || component.role === "vae").map((component) => component.path)]; const minimumCudaWeightBytes = [...new Set(cudaPaths)].reduce((total, path) => total + pathFootprintBytes(path), 0); const activationHeadroomBytes = 2 * 1024 ** 3; const budget = worker?.pid ? memory.totalBytes : memory.freeBytes; if (minimumCudaWeightBytes + activationHeadroomBytes > budget) throw new Error(`MEMORY RISK: audited FLUX.1 CUDA lower-bound ${formatGib(minimumCudaWeightBytes)} GiB plus activation headroom exceeds current free VRAM ${formatGib(budget)} GiB.`); }
function installedGpuMemory(): { totalBytes: number; freeBytes: number } | null { try { const result = spawnSync("nvidia-smi", ["--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"], { windowsHide: true, encoding: "utf8", timeout: 5_000 }); if (result.status !== 0) return null; const rows = String(result.stdout).trim().split(/\r?\n/).map((line) => line.split(",").map((value) => Number(value.trim()))).filter(([total, free]) => Number.isFinite(total) && Number.isFinite(free) && total > 0 && free > 0); if (!rows.length) return null; const [total, free] = rows.sort((a, b) => b[1] - a[1])[0]; return { totalBytes: total * 1024 ** 2, freeBytes: free * 1024 ** 2 }; } catch { return null; } }
const footprintCache = new Map<string, number>();
function pathFootprintBytes(path: string): number { if (footprintCache.has(path)) return footprintCache.get(path) ?? 0; try { const stats = statSync(path); const value = stats.isDirectory() ? walkFingerprintFiles(path).reduce((total, file) => total + statSync(file).size, 0) : stats.size; footprintCache.set(path, value); return value; } catch { return 0; } }
function formatGib(bytes: number): string { return (bytes / 1024 ** 3).toFixed(1); }
function runtimeIdentity() { return { modelName: "flux-dev", relativeBasePath: "diffusion_models\\flux1-dev.safetensors", basePath: EXACT_COMPONENTS.flux.path, components: [EXACT_COMPONENTS.runtime, EXACT_COMPONENTS.t5, EXACT_COMPONENTS.t5Config, EXACT_COMPONENTS.clip, EXACT_COMPONENTS.bpe, EXACT_COMPONENTS.openclipTokenizer, EXACT_COMPONENTS.ae] }; }
