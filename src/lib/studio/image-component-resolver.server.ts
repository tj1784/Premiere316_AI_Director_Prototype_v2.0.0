import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync, readSync, readdirSync, statSync, closeSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeAdapterCapabilities, type NativeAdapterCapabilities } from "./engine-controls.ts";
import { planPlacement, type PipelineComponent, type PlacementPlan } from "./residency.ts";

const MODEL_ROOT = "D:\\AI\\Models";
const HF_HUB = "D:\\_Cache\\HuggingFace\\hub";
const PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
const FLUX_ROOT = "D:\\Projects\\flux";
const FLUX2_ROOT = "D:\\Projects\\Flux2";
const T5_SNAPSHOT_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2";

export type ComponentManifestStatus = "READY" | "MISSING_COMPONENT" | "ADAPTER_UNAVAILABLE" | "MEMORY_RISK" | "BLOCKED_LICENSE";

export type ImageComponentManifest = {
  schemaVersion: 1;
  adapterId: "flux" | "flux2" | "klein-demo" | "krea-2";
  modelVariant: "flux1-dev" | "flux2-dev" | "flux2-klein-4b" | "flux2-klein-9b" | "krea2";
  status: ComponentManifestStatus;
  disabledReason: string | null;
  runtimeImplementation: "black-forest-labs/flux" | "black-forest-labs/flux2" | "unavailable";
  components: ImageRuntimeComponent[];
  placementPlan: PlacementPlan;
  controls: NativeAdapterCapabilities | null;
  licenseNote: string;
  resolvedAt: number;
};

export type ImageRuntimeComponent = {
  role: string;
  stableId: string;
  rendererPath: string;
  opaqueId: string;
  sizeBytes: number;
  mtimeMs: number;
  fingerprint: string | null;
  fingerprintKind: "full" | "sampled" | null;
  required: boolean;
  present: boolean;
};

export function resolveImageComponentManifests(now = Date.now()): ImageComponentManifest[] {
  return [
    manifest("flux", "flux1-dev", now),
    manifest("flux2", "flux2-dev", now),
    manifest("klein-demo", "flux2-klein-4b", now),
    manifest("klein-demo", "flux2-klein-9b", now),
    kreaManifest(now),
  ];
}

export function resolveImageComponentManifest(adapterId: string, selectedBasePath = "", now = Date.now()): ImageComponentManifest {
  const normalized = normalize(selectedBasePath);
  if (adapterId === "flux") return manifest("flux", "flux1-dev", now);
  if (adapterId === "flux2") return manifest("flux2", "flux2-dev", now);
  if (adapterId === "klein-demo") return manifest("klein-demo", /4b/.test(normalized) ? "flux2-klein-4b" : "flux2-klein-9b", now);
  return kreaManifest(now);
}

function manifest(adapterId: "flux" | "flux2" | "klein-demo", variant: ImageComponentManifest["modelVariant"], now: number): ImageComponentManifest {
  const capabilities = nativeAdapterCapabilities(adapterId, variant);
  const components = componentSpecs(variant).map(toComponent);
  const missing = components.filter((component) => component.required && !component.present);
  const implementation = variant === "flux1-dev" ? "black-forest-labs/flux" : "black-forest-labs/flux2";
  const disabledUnsupported = variant === "flux1-dev" ? null : "FLUX.2/Klein adapters remain disabled for Wave 4; Labs-only until a later gate.";
  const memoryRisk = missing.length || disabledUnsupported ? null : memoryRiskReason(components);
  const runtimeMissing = disabledUnsupported ?? runtimeMissingReason(variant);
  const disabledReason = missing.length
    ? `Missing exact native component: ${missing.map((item) => item.stableId).join(", ")}`
    : runtimeMissing ?? memoryRisk;
  return {
    schemaVersion: 1,
    adapterId,
    modelVariant: variant as Exclude<ImageComponentManifest["modelVariant"], "krea2">,
    status: disabledReason ? (memoryRisk ? "MEMORY_RISK" : disabledUnsupported ? "ADAPTER_UNAVAILABLE" : "MISSING_COMPONENT") : "READY",
    disabledReason,
    runtimeImplementation: implementation,
    components,
    placementPlan: placementFor(components),
    controls: capabilities,
    licenseNote: variant === "flux1-dev" ? "App-owned Premiere316 worker with local operator-installed FLUX.1 components; no ComfyUI, cloud, or HF weight lookup." : "Disabled Labs adapter; no packaged Generate route is available in Wave 4.",
    resolvedAt: now,
  };
}

function kreaManifest(now: number): ImageComponentManifest {
  return {
    schemaVersion: 1,
    adapterId: "krea-2",
    modelVariant: "krea2",
    status: "ADAPTER_UNAVAILABLE",
    disabledReason: "Krea 2 weights are not a complete app-supported native adapter; no local official runtime is wired.",
    runtimeImplementation: "unavailable",
    components: ["diffusion_models\\krea2_raw_bf16.safetensors", "diffusion_models\\Krea 2\\krea2_turbo_bf16.safetensors", "diffusion_models\\krea2_turbo_nvfp4.safetensors"].map((path) => toComponent({ role: "transformer", stableId: path, path: join(MODEL_ROOT, path), required: false })),
    placementPlan: planPlacement([], { vramBytes: gpuTotalBytes() ?? 72 * 1024 ** 3 }),
    controls: null,
    licenseNote: "Disabled until an exact local official Krea 2 runtime and license posture are proven.",
    resolvedAt: now,
  };
}

type ComponentSpec = { role: string; stableId: string; path: string; required: boolean };

function componentSpecs(variant: ImageComponentManifest["modelVariant"]): ComponentSpec[] {
  if (variant === "flux1-dev") return [
    { role: "runtime", stableId: "black-forest-labs/flux@802fb4713906133fcbd0d8dc5351620ca4773036", path: FLUX_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "worker", stableId: "Premiere316:desktop/workers/flux1_jsonl_worker.py", path: process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", "flux1_jsonl_worker.py") : join(process.cwd(), "desktop", "workers", "flux1_jsonl_worker.py"), required: true },
    { role: "transformer", stableId: "flux1-dev.safetensors@4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7", path: join(MODEL_ROOT, "diffusion_models", "flux1-dev.safetensors"), required: true },
    { role: "text_encoder", stableId: "t5xxl_fp16.safetensors@6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635", path: join(MODEL_ROOT, "text_encoders", "t5xxl_fp16.safetensors"), required: true },
    { role: "tokenizer", stableId: `google/t5-v1_1-xxl-config-tokenizer@${T5_SNAPSHOT_REVISION}:config@a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8:spiece@d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86`, path: join(HF_HUB, "models--google--t5-v1_1-xxl", "snapshots", T5_SNAPSHOT_REVISION), required: true },
    { role: "text_encoder", stableId: "clip_l.safetensors@660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", path: join(MODEL_ROOT, "text_encoders", "clip_l.safetensors"), required: true },
    { role: "tokenizer", stableId: "open_clip:bpe_simple_vocab_16e6@924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\bpe_simple_vocab_16e6.txt.gz", required: true },
    { role: "tokenizer_source", stableId: "open_clip:tokenizer.py@90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\tokenizer.py", required: true },
    { role: "vae", stableId: "ae.safetensors@afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", path: join(MODEL_ROOT, "vae", "ae.safetensors"), required: true },
  ];
  if (variant === "flux2-dev") return [
    { role: "runtime", stableId: "black-forest-labs/flux2", path: FLUX2_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "transformer", stableId: "diffusion_models/flux2_dev.safetensors", path: join(MODEL_ROOT, "diffusion_models", "flux2_dev.safetensors"), required: true },
    { role: "text_encoder", stableId: "mistralai/Mistral-Small-3.2-24B-Instruct-2506", path: hfSnapshot("mistralai/Mistral-Small-3.2-24B-Instruct-2506"), required: true },
    { role: "processor", stableId: "mistralai/Mistral-Small-3.1-24B-Instruct-2503", path: hfSnapshot("mistralai/Mistral-Small-3.1-24B-Instruct-2503"), required: true },
    { role: "support", stableId: "Falconsai/nsfw_image_detection", path: hfSnapshot("Falconsai/nsfw_image_detection"), required: true },
    { role: "vae", stableId: "vae/flux2-vae.safetensors", path: join(MODEL_ROOT, "vae", "flux2-vae.safetensors"), required: true },
  ];
  const four = variant === "flux2-klein-4b";
  return [
    { role: "runtime", stableId: "black-forest-labs/flux2", path: FLUX2_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "transformer", stableId: four ? "diffusion_models/flux2/flux-2-klein-4b-fp8.safetensors" : "diffusion_models/flux2/flux-2-klein-9b-fp8mixed.safetensors", path: join(MODEL_ROOT, "diffusion_models", "flux2", four ? "flux-2-klein-4b-fp8.safetensors" : "flux-2-klein-9b-fp8mixed.safetensors"), required: true },
    { role: "text_encoder", stableId: four ? "Qwen/Qwen3-4B-FP8" : "Qwen/Qwen3-8B-FP8", path: hfSnapshot(four ? "Qwen/Qwen3-4B-FP8" : "Qwen/Qwen3-8B-FP8"), required: true },
    { role: "vae", stableId: "vae/flux2-vae.safetensors", path: join(MODEL_ROOT, "vae", "flux2-vae.safetensors"), required: true },
  ];
}

function toComponent(spec: ComponentSpec): ImageRuntimeComponent {
  const present = Boolean(spec.path && existsSync(spec.path) && componentHasRequiredPayload(spec));
  const stats = present ? statSync(spec.path) : null;
  const fingerprint = present ? sampledFingerprint(spec.path) : null;
  return {
    role: spec.role,
    stableId: spec.stableId,
    rendererPath: rendererSafePath(spec.path || spec.stableId),
    opaqueId: createHash("sha256").update(`${spec.role}:${spec.stableId}:${spec.path}`).digest("hex").slice(0, 16),
    sizeBytes: stats ? pathFootprintBytes(spec.path) : 0,
    mtimeMs: stats ? stats.mtimeMs : 0,
    fingerprint,
    fingerprintKind: fingerprint ? (stats?.isFile() && (stats.size < 64 * 1024 * 1024) ? "full" : "sampled") : null,
    required: spec.required,
    present,
  };
}

export function componentHasRequiredPayload(spec: ComponentSpec): boolean {
  if (!existsSync(spec.path)) return false;
  if (spec.stableId.includes("google/t5-v1_1-xxl-config-tokenizer")) return ["config.json", "tokenizer_config.json", "special_tokens_map.json", "spiece.model"].every((file) => existsSync(join(spec.path, file))) && !directoryHasWeightFile(spec.path) && exactFileHash(join(spec.path, "config.json"), "a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8") && exactFileHash(join(spec.path, "tokenizer_config.json"), "b971dce1d2805c2a66da8657156e7114a30501c6ba602fc947c8bf607a3ead2d") && exactFileHash(join(spec.path, "special_tokens_map.json"), "4720c0fddbe4c5991334f85ad7073d9bd0a294a8ba4641a2f8dab614ca825949") && exactFileHash(join(spec.path, "spiece.model"), "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86");
  if (spec.stableId.includes("t5xxl_fp16.safetensors@")) return exactSizedFileHash(spec.path, 9_787_841_024, "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635");
  if (spec.stableId.includes("clip_l.safetensors@")) return exactSizedFileHash(spec.path, 246_144_152, "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd");
  if (spec.stableId.includes("flux1-dev.safetensors@")) return exactSizedFileHash(spec.path, 23_802_932_552, "4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7");
  if (spec.stableId.includes("ae.safetensors@")) return exactSizedFileHash(spec.path, 335_304_388, "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38");
  if (spec.stableId.includes("open_clip:tokenizer.py@")) return exactSizedFileHash(spec.path, 22_680, "90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734");
  return true;
}

function exactSizedFileHash(path: string, expectedSize: number, expectedHash: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size === expectedSize && exactFileHash(path, expectedHash);
  } catch { return false; }
}

function exactFileHash(path: string, expected: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      hash.update(bytesRead === buffer.byteLength ? buffer : buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex") === expected;
  } catch { return false; }
  finally { if (fd !== null) closeSync(fd); }
}

function directoryHasWeightFile(path: string): boolean {
  try {
    return walkFiles(path).some((file) => /(?:model|pytorch_model|tf_model).*(?:\.safetensors|\.bin)$/i.test(file));
  } catch {
    return false;
  }
}

function hfSnapshot(stableId: string): string {
  const repoDir = join(HF_HUB, `models--${stableId.replace("/", "--")}`);
  try {
    const revision = readFileSync(join(repoDir, "refs", "main"), "utf8").trim();
    return join(repoDir, "snapshots", revision);
  } catch {
    try {
      const first = readdirSync(join(repoDir, "snapshots"), { withFileTypes: true }).find((entry) => entry.isDirectory())?.name ?? "";
      return first ? join(repoDir, "snapshots", first) : "";
    } catch {
      return "";
    }
  }
}

function runtimeMissingReason(variant: ImageComponentManifest["modelVariant"]): string | null {
  if (variant === "krea2") return "Krea 2 has no complete app-supported native runtime adapter.";
  const runtimeRoot = variant === "flux1-dev" ? FLUX_ROOT : FLUX2_ROOT;
  if (!existsSync(runtimeRoot)) return `Native runtime repository is not installed: ${runtimeRoot}`;
  if (variant === "flux1-dev" && !existsSync(join(runtimeRoot, "src", "flux"))) return "Official black-forest-labs/flux runtime package is incomplete.";
  if (variant !== "flux1-dev" && !existsSync(join(runtimeRoot, "src", "flux2"))) return "Official black-forest-labs/flux2 runtime package is incomplete.";
  return null;
}

function placementFor(components: ImageRuntimeComponent[]): PlacementPlan {
  const pipeline: PipelineComponent[] = components.filter((item) => ["transformer", "text_encoder", "vae", "processor"].includes(item.role)).map((item) => ({
    id: item.opaqueId,
    kind: item.role === "text_encoder" ? "textEncoder" : item.role === "processor" ? "processor" : item.role === "vae" ? "vae" : "transformer",
    sizeBytes: item.sizeBytes,
  }));
  return planPlacement(pipeline, { vramBytes: gpuTotalBytes() ?? 72 * 1024 ** 3 });
}

function memoryRiskReason(components: ImageRuntimeComponent[]): string | null {
  const total = gpuTotalBytes();
  if (!total) return null;
  const requiredCuda = components.filter((item) => item.required && ["transformer", "text_encoder", "vae"].includes(item.role)).reduce((sum, item) => sum + item.sizeBytes, 0);
  return requiredCuda + 2 * 1024 ** 3 > total ? `MEMORY RISK: native CUDA lower-bound ${formatGib(requiredCuda)} GiB exceeds installed GPU budget with activation headroom.` : null;
}

function gpuTotalBytes(): number | null {
  try {
    const out = spawnSync("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 4000, windowsHide: true });
    if (out.status !== 0) return null;
    const values = out.stdout.trim().split(/\r?\n/).map((line) => Number(line.trim())).filter((n) => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) * 1024 ** 2 : null;
  } catch {
    return null;
  }
}

function sampledFingerprint(path: string): string | null {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const files = walkFiles(path).slice(0, 128);
      if (!files.length) return null;
      const hash = createHash("sha256");
      for (const file of files) {
        const fileStats = statSync(file);
        hash.update(file.slice(path.length));
        hash.update(String(fileStats.size));
        hash.update(sampleFile(file, Math.min(128 * 1024, fileStats.size)));
      }
      return hash.digest("hex");
    }
    return createHash("sha256").update(sampleFile(path, Math.min(4 * 1024 * 1024, stats.size))).update(String(stats.size)).digest("hex");
  } catch {
    return null;
  }
}

function sampleFile(path: string, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    readSync(fd, bytes, 0, length, 0);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function pathFootprintBytes(path: string): number {
  try {
    const stats = statSync(path);
    return stats.isDirectory() ? walkFiles(path).reduce((sum, file) => sum + statSync(file).size, 0) : stats.size;
  } catch {
    return 0;
  }
}

function rendererSafePath(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  for (const [root, label] of [[MODEL_ROOT, "model-vault"], [HF_HUB, "hf-cache"], [FLUX_ROOT, "runtime:flux"], [FLUX2_ROOT, "runtime:flux2"]] as const) {
    const prefix = `${root}\\`;
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) return `${label}\\${normalized.slice(prefix.length)}`;
    if (normalized.toLowerCase() === root.toLowerCase()) return label;
  }
  if (normalized.toLowerCase() === PYTHON.toLowerCase()) return "runtime:python\\python.exe";
  return normalized.split(/[\\/]/).pop() || "local-component";
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function formatGib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
