import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { nativeAdapterCapabilities, runtimeDefaults, type NativeGenerationValues } from "./engine-controls.ts";
import { createGenerationProvenance, provenanceSidecarName, serializeGenerationProvenance, telemetryFromWorker, type GenerationProvenance } from "./generation-provenance.ts";
import { executedNativeStillSettings, toNativeStillWorkerRequest } from "./native-still-contract.ts";
import { createCalibrationRequest } from "./engine-calibration.ts";
import type { AdapterBenchmark } from "./engine-adapter.ts";

const PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
const FLUX2_ROOT = "D:\\Projects\\Flux2";
const WORKER = join(FLUX2_ROOT, "blokey-studio", "stills_worker.py");
const OUT_DIR = "D:\\_Temp\\Premiere316\\stills-out";
const REF_DIR = "D:\\_Temp\\Premiere316\\refs";
const PUBLIC_STILLS = join(process.cwd(), "artifacts", "stills");
const ENGINE_LOG = "D:\\_Temp\\Premiere316\\flux2-engine.log";
const HF_HUB = "D:\\_Cache\\HuggingFace\\hub";
const APP_VERSION = "3.0.2";

export type LocalStillInput = {
  prompt: string;
  engineId: string;
  engineName: string;
  references: string[];
  selectedBasePath?: string;
  values?: NativeGenerationValues;
};

export type LocalStillResult = { ok: true; url: string; provenance: GenerationProvenance } | { ok: false; error: string };
export type LocalEngineCheck = { ok: true; modelName: string } | { ok: false; error: string };

type WorkerMsg = {
  id?: string;
  ok?: boolean;
  ready?: boolean;
  error?: string;
  url?: string;
  engine?: string;
  model?: string;
  seed?: number;
  loaded?: string | null;
};

let worker: ChildProcess | null = null;
let workerLogFd: number | undefined;
let seq = 0;
const pending = new Map<string, (msg: WorkerMsg) => void>();

function closeEngineLog() {
  if (workerLogFd === undefined) return;
  try {
    closeSync(workerLogFd);
  } catch {
    /* already closed */
  }
  workerLogFd = undefined;
}

function killWorker() {
  const child = worker;
  worker = null;
  pending.forEach((resolve) => resolve({ ok: false, error: "Official flux2 worker stopped." }));
  pending.clear();
  if (!child?.pid) {
    closeEngineLog();
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  closeEngineLog();
}

function attachWorker(child: ChildProcess) {
  worker = child;
  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: WorkerMsg;
    try {
      msg = JSON.parse(line) as WorkerMsg;
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve?.(msg);
      return;
    }
    if (msg.ready) {
      const resolve = pending.get("ready");
      if (resolve) {
        pending.delete("ready");
        resolve(msg);
      }
    }
  });
  child.stderr?.on("data", (chunk) => {
    if (workerLogFd === undefined) return;
    try {
      writeSync(workerLogFd, chunk);
    } catch {
      /* log closed */
    }
  });
  child.on("exit", () => {
    if (worker === child) {
      worker = null;
      pending.forEach((resolve) => resolve({ ok: false, error: "Official flux2 worker exited." }));
      pending.clear();
      closeEngineLog();
    }
  });
}

function callWorker(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerMsg> {
  const child = worker;
  if (!child?.stdin) return Promise.resolve({ ok: false, error: "Official flux2 worker is not running." });
  const id = String(++seq);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: "Official flux2 still timed out." });
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin!.write(`${JSON.stringify({ ...payload, id })}\n`);
  });
}

export async function stopLocalEngine(): Promise<{ ok: true; stopped: boolean }> {
  const running = Boolean(worker?.pid);
  killWorker();
  return { ok: true, stopped: running };
}

export async function ensureLocalEngine(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (worker?.pid) {
    const ping = await callWorker({ method: "ping" }, 8_000);
    if (ping.ok) return { ok: true };
    killWorker();
  }
  if (!existsSync(PYTHON)) return { ok: false, error: `Local Python not found: ${PYTHON}` };
  if (!existsSync(WORKER)) return { ok: false, error: `Official flux2 worker not found: ${WORKER}` };
  mkdirSync("D:\\_Temp\\Premiere316", { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  workerLogFd = openSync(ENGINE_LOG, "a");
  const child = spawn(PYTHON, ["-u", WORKER], {
    cwd: FLUX2_ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
      PYTHONPATH: join(FLUX2_ROOT, "src"),
      HF_HOME: "D:\\_Cache\\HuggingFace",
      AE_MODEL_PATH: "D:\\AI\\Models\\vae\\flux2-vae.safetensors",
      KLEIN_4B_MODEL_PATH: "D:\\AI\\Models\\diffusion_models\\flux2\\flux-2-klein-4b-fp8.safetensors",
      KLEIN_9B_MODEL_PATH: "D:\\AI\\Models\\diffusion_models\\flux2\\flux-2-klein-9b-fp8mixed.safetensors",
      FLUX2_MODEL_PATH: "D:\\AI\\Models\\diffusion_models\\flux2_dev.safetensors",
      FLUX_MODEL: "D:\\AI\\Models\\diffusion_models\\flux1-dev.safetensors",
      FLUX_AE: "D:\\AI\\Models\\vae\\ae.safetensors",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  });
  attachWorker(child);
  const ready = await new Promise<WorkerMsg>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: "Official flux2 worker did not start." }), 120_000);
    pending.set("ready", (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
  if (!ready.ok && !ready.ready) {
    killWorker();
    return { ok: false, error: ready.error || "Official flux2 worker did not start. Check D:\\_Temp\\Premiere316\\flux2-engine.log." };
  }
  return { ok: true };
}

function writeRef(dataUrl: string, name: string): { path: string; id: string; fingerprint: string } {
  mkdirSync(REF_DIR, { recursive: true });
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m) throw new Error("Bad reference image");
  const ext = m[1].includes("png") ? "png" : "jpg";
  const file = join(REF_DIR, `${name}.${ext}`);
  const bytes = Buffer.from(m[2], "base64");
  writeFileSync(file, bytes);
  return { path: file, id: name, fingerprint: createHash("sha256").update(bytes).digest("hex") };
}

export async function exposeLocalStill(input: LocalStillInput): Promise<LocalStillResult> {
  try {
    const capabilities = nativeAdapterCapabilities(input.engineId, input.selectedBasePath || input.engineName);
    if (!capabilities) return { ok: false, error: "Runtime adapter not yet implemented." };
    const identity = runtimeIdentity(capabilities.modelVariant);
    requireIdentityFiles(identity);
    requirePlausibleGpuMemory(identity);
    const selectedBasePath = input.selectedBasePath || identity.relativeBasePath;
    if (normalizeRelative(selectedBasePath) !== normalizeRelative(identity.relativeBasePath)) {
      return { ok: false, error: "Selected checkpoint is mapped but is not the checkpoint bound to this native runtime adapter." };
    }
    const wake = await ensureLocalEngine();
    if (!wake.ok) return wake;
    mkdirSync(PUBLIC_STILLS, { recursive: true });
    mkdirSync(OUT_DIR, { recursive: true });
    const id = randomUUID();
    const outName = `${id}.png`;
    const dest = join(PUBLIC_STILLS, outName);
    const refs = input.references.map((ref, i) => writeRef(ref, `p316-ref-${id.slice(0, 8)}-${i}`));
    const before = await callWorker({ method: "ping" }, 8_000);
    const started = performance.now();
    const workerRequest = toNativeStillWorkerRequest({
      capabilities,
      values: { ...runtimeDefaults(capabilities), ...(input.values ?? {}), prompt: input.prompt },
      prompt: input.prompt,
      engineId: input.engineId,
      engineName: input.engineName,
      out: dest,
      referencePaths: refs.map((ref) => ref.path),
    });
    const result = await callWorker(
      workerRequest,
      10 * 60_000,
    );
    const totalMs = performance.now() - started;
    if (!result.ok) return { ok: false, error: result.error || "Official flux2 still failed." };
    if (!existsSync(dest)) return { ok: false, error: "Official flux2 finished without a plate." };
    if (result.model !== identity.modelName || result.engine !== capabilities.runtimeImplementation) {
      return { ok: false, error: "Native worker executed a different model identity than the selected configuration." };
    }
    const executed = executedNativeStillSettings(capabilities, workerRequest, { ...result, ok: true });
    const residentBeforeJob = before.loaded === identity.modelName;
    const after = await callWorker({ method: "ping" }, 8_000);
    const residentAfterJob = after.ok === true && after.loaded === identity.modelName;
    const telemetry = telemetryFromWorker({ totalMs, residentBeforeJob, residentAfterJob }, totalMs);
    const baseFingerprint = sampledFingerprint(identity.basePath);
    const provenance = createGenerationProvenance({
      assetId: id,
      engineId: input.engineId,
      engineName: input.engineName,
      runtimeAdapter: capabilities.adapterId,
      runtimeImplementation: capabilities.runtimeImplementation,
      baseCheckpoint: {
        id: identity.relativeBasePath,
        path: rendererSafeRuntimePath(identity.basePath),
        fingerprint: baseFingerprint,
        fingerprintKind: baseFingerprint ? "sampled" : null,
      },
      components: identity.components.map((component) => ({
        ...component,
        path: rendererSafeRuntimePath(component.path),
        fingerprint: sampledFingerprint(component.path),
      })),
      loras: [],
      prompt: workerRequest.prompt,
      enhancedPrompt: null,
      references: refs.map((ref) => ({ id: ref.id, fingerprint: ref.fingerprint })),
      ...executed,
      timestepData: null,
      placementPlan: null,
      generatedAt: new Date().toISOString(),
      applicationVersion: APP_VERSION,
      telemetry,
    });
    writeFileSync(join(PUBLIC_STILLS, provenanceSidecarName(outName)), serializeGenerationProvenance(provenance), "utf8");
    try {
      copyFileSync(dest, join(OUT_DIR, outName));
      copyFileSync(join(PUBLIC_STILLS, provenanceSidecarName(outName)), join(OUT_DIR, provenanceSidecarName(outName)));
    } catch {
      /* temp copy is optional */
    }
    return { ok: true, url: `/stills/${outName}`, provenance };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Local still failed." };
  }
}

export function inspectLocalEngine(input: Pick<LocalStillInput, "engineId" | "engineName" | "selectedBasePath">): LocalEngineCheck {
  try {
    const capabilities = nativeAdapterCapabilities(input.engineId, input.selectedBasePath || input.engineName);
    if (!capabilities) return { ok: false, error: "Runtime adapter not yet implemented." };
    const identity = runtimeIdentity(capabilities.modelVariant);
    requireIdentityFiles(identity);
    requirePlausibleGpuMemory(identity);
    if (input.selectedBasePath && normalizeRelative(input.selectedBasePath) !== normalizeRelative(identity.relativeBasePath)) {
      return { ok: false, error: "Selected checkpoint is not bound to this native runtime adapter." };
    }
    return { ok: true, modelName: identity.modelName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Native runtime is unavailable." };
  }
}

export async function benchmarkLocalEngine(input: Omit<LocalStillInput, "references" | "values" | "prompt"> & { values?: NativeGenerationValues }): Promise<AdapterBenchmark> {
  const capabilities = nativeAdapterCapabilities(input.engineId, input.selectedBasePath || input.engineName);
  if (!capabilities) throw new Error("Runtime adapter not yet implemented.");
  const fingerprint = input.selectedBasePath ?? input.engineName;
  const calibration = createCalibrationRequest(input.engineId, fingerprint, { ...runtimeDefaults(capabilities), ...(input.values ?? {}) });
  await stopLocalEngine();
  const first = await exposeLocalStill({ ...input, prompt: calibration.prompt, references: [], values: calibration.values });
  const warm = first.ok
    ? await exposeLocalStill({ ...input, prompt: calibration.prompt, references: [], values: calibration.values })
    : first;
  return {
    adapterId: input.engineId,
    configurationFingerprint: fingerprint,
    modelLoadMs: null,
    firstGenerationMs: first.ok ? first.provenance.telemetry.totalMs : null,
    warmGenerationMs: warm.ok ? warm.provenance.telemetry.totalMs : null,
    peakVramBytes: warm.ok ? warm.provenance.telemetry.peakVramBytes : null,
    peakSystemRamBytes: warm.ok ? warm.provenance.telemetry.peakSystemRamBytes : null,
    outputDescription: `${calibration.width} × ${calibration.height} · ${String(capabilities.controls.steps.runtimeDefault)} steps`,
    errors: [first, warm].filter((result) => !result.ok).map((result) => result.ok ? "" : result.error),
    warnings: ["Model-load and peak-memory breakdown are unavailable from the current native worker; total cold/warm timings are preserved."],
    measuredAt: new Date().toISOString(),
  };
}

const fingerprintCache = new Map<string, string | null>();

function sampledFingerprint(path: string): string | null {
  if (fingerprintCache.has(path)) return fingerprintCache.get(path) ?? null;
  let fd: number | undefined;
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const hash = createHash("sha256");
      const files = walkFingerprintFiles(path);
      if (files.length === 0) throw new Error("Empty runtime component directory.");
      for (const file of files.slice(0, 256)) {
        const fileStats = statSync(file);
        hash.update(relative(path, file).replace(/\\/g, "/"));
        hash.update(String(fileStats.size));
        const fileFd = openSync(file, "r");
        try {
          const sample = Buffer.alloc(Math.min(256 * 1024, fileStats.size));
          readSync(fileFd, sample, 0, sample.length, 0);
          hash.update(sample);
        } finally {
          closeSync(fileFd);
        }
      }
      const value = hash.digest("hex");
      fingerprintCache.set(path, value);
      return value;
    }
    const size = stats.size;
    fd = openSync(path, "r");
    const bytes = Buffer.alloc(Math.min(4 * 1024 * 1024, size));
    readSync(fd, bytes, 0, bytes.length, 0);
    const value = createHash("sha256").update(bytes).update(String(size)).digest("hex");
    fingerprintCache.set(path, value);
    return value;
  } catch {
    fingerprintCache.set(path, null);
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function walkFingerprintFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        try {
          if (statSync(path).isFile()) files.push(path);
        } catch {
          /* Broken local cache links are not part of the executed component. */
        }
      }
    }
  };
  visit(root);
  return files.sort();
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, "/").replace(/^d:\/ai\/models\//i, "").toLowerCase();
}

/** Preserve the exact installed locator in provenance without disclosing a host absolute path. */
function rendererSafeRuntimePath(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  const modelRoot = "D:\\AI\\Models\\";
  if (normalized.toLowerCase().startsWith(modelRoot.toLowerCase())) {
    return normalized.slice(modelRoot.length);
  }
  const hubRoot = `${HF_HUB}\\`;
  if (normalized.toLowerCase().startsWith(hubRoot.toLowerCase())) {
    return `hf-cache\\${normalized.slice(hubRoot.length)}`;
  }
  return normalized.split(/[/\\]/).pop() || "local-component";
}

function requireIdentityFiles(identity: ReturnType<typeof runtimeIdentity>): void {
  for (const path of [identity.basePath, ...identity.components.map((component) => component.path)]) {
    if (!existsSync(path)) throw new Error(`Native runtime component is not installed: ${path.split(/[\\/]/).pop() || "component"}`);
  }
}

const footprintCache = new Map<string, number>();

/**
 * The audited worker moves the base model, text encoder(s), and VAE to CUDA.
 * Their on-disk payload is only a conservative lower-bound—not a measured VRAM
 * peak—but it is enough to reject configurations whose weights alone exceed the
 * installed GPU before starting Python and risking a machine-wide OOM.
 */
function requirePlausibleGpuMemory(identity: ReturnType<typeof runtimeIdentity>): void {
  const gpuTotalBytes = installedGpuMemoryBytes();
  if (gpuTotalBytes === null) return;
  const cudaPaths = [
    identity.basePath,
    ...identity.components
      .filter((component) => component.role === "text_encoder" || component.role === "vae")
      .map((component) => component.path),
  ];
  const minimumCudaWeightBytes = [...new Set(cudaPaths)].reduce((total, path) => total + pathFootprintBytes(path), 0);
  const activationHeadroomBytes = 2 * 1024 ** 3;
  if (minimumCudaWeightBytes + activationHeadroomBytes > gpuTotalBytes) {
    throw new Error(
      `MEMORY RISK: the native worker places at least ${formatGib(minimumCudaWeightBytes)} GiB of audited weight files on CUDA, before activation headroom; the installed GPU reports ${formatGib(gpuTotalBytes)} GiB.`,
    );
  }
}

function installedGpuMemoryBytes(): number | null {
  try {
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { windowsHide: true, encoding: "utf8", timeout: 5_000 },
    );
    if (result.status !== 0) return null;
    const totals = String(result.stdout)
      .trim()
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (totals.length === 0) return null;
    return Math.max(...totals) * 1024 ** 2;
  } catch {
    return null;
  }
}

function pathFootprintBytes(path: string): number {
  if (footprintCache.has(path)) return footprintCache.get(path) ?? 0;
  try {
    const stats = statSync(path);
    const value = stats.isDirectory()
      ? walkFingerprintFiles(path).reduce((total, file) => total + statSync(file).size, 0)
      : stats.size;
    footprintCache.set(path, value);
    return value;
  } catch {
    return 0;
  }
}

function formatGib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function runtimeIdentity(variant: "flux1-dev" | "flux2-dev" | "flux2-klein-4b" | "flux2-klein-9b") {
  if (variant === "flux1-dev") {
    return {
      modelName: "flux-dev",
      relativeBasePath: "diffusion_models\\flux1-dev.safetensors",
      basePath: "D:\\AI\\Models\\diffusion_models\\flux1-dev.safetensors",
      components: [
        localCacheComponent("text_encoder", "google/t5-v1_1-xxl"),
        localCacheComponent("text_encoder", "openai/clip-vit-large-patch14"),
        { role: "vae", id: "ae.safetensors", path: "D:\\AI\\Models\\vae\\ae.safetensors" },
      ],
    };
  }
  if (variant === "flux2-dev") {
    return {
      modelName: "flux.2-dev",
      relativeBasePath: "diffusion_models\\flux2_dev.safetensors",
      basePath: "D:\\AI\\Models\\diffusion_models\\flux2_dev.safetensors",
      components: [
        localCacheComponent("text_encoder", "mistralai/Mistral-Small-3.2-24B-Instruct-2506"),
        localCacheComponent("processor", "mistralai/Mistral-Small-3.1-24B-Instruct-2503"),
        localCacheComponent("support", "Falconsai/nsfw_image_detection"),
        { role: "vae", id: "flux2-vae.safetensors", path: "D:\\AI\\Models\\vae\\flux2-vae.safetensors" },
      ],
    };
  }
  const four = variant === "flux2-klein-4b";
  const file = four ? "flux-2-klein-4b-fp8.safetensors" : "flux-2-klein-9b-fp8mixed.safetensors";
  const encoder = four ? "Qwen/Qwen3-4B-FP8" : "Qwen/Qwen3-8B-FP8";
  return {
    modelName: four ? "flux.2-klein-4b" : "flux.2-klein-9b",
    relativeBasePath: `diffusion_models\\flux2\\${file}`,
    basePath: `D:\\AI\\Models\\diffusion_models\\flux2\\${file}`,
    components: [
      localCacheComponent("text_encoder", encoder),
      { role: "vae", id: "flux2-vae.safetensors", path: "D:\\AI\\Models\\vae\\flux2-vae.safetensors" },
    ],
  };
}

function localCacheComponent(role: string, stableId: string): { role: string; id: string; path: string } {
  const repoDir = join(HF_HUB, `models--${stableId.replace("/", "--")}`);
  const refPath = join(repoDir, "refs", "main");
  let revision = "";
  try {
    revision = readFileSync(refPath, "utf8").trim();
  } catch {
    try {
      revision = readdirSync(join(repoDir, "snapshots"), { withFileTypes: true })
        .find((entry) => entry.isDirectory())?.name ?? "";
    } catch {
      revision = "";
    }
  }
  const path = revision ? join(repoDir, "snapshots", revision) : "";
  if (!path || !existsSync(path)) {
    throw new Error(`Native ${stableId} runtime component is not installed in the offline model cache.`);
  }
  return { role, id: `${stableId}@${revision}`, path };
}
