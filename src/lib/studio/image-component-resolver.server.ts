import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync, readSync, readdirSync, statSync, closeSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeAdapterCapabilities, type NativeAdapterCapabilities } from "./engine-controls.ts";
import { planPlacement, type PipelineComponent, type PlacementPlan } from "./residency.ts";
import { NATIVE_STILL_MODEL_PATHS } from "./native-model-paths.server.ts";
import { KREA2_COMPONENTS, KREA2_ROOT } from "./krea2-runtime.server.ts";

const MODEL_ROOT = "D:\\AI\\Models";
const HF_HUB = "D:\\_Cache\\HuggingFace\\hub";
const PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
const FLUX_ROOT = "D:\\Projects\\flux";
const FLUX2_ROOT = "D:\\Projects\\Flux2";
const T5_SNAPSHOT_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2";
const FLUX2_SOURCE_HEAD = "50fe5162777813d869182b139e83b10743caef15";
const MISTRAL_REVISION = "95a6d26c4bfb886c58daf9d3f7332c857cb27b43";
const PROCESSOR_REVISION = "68faf511d618ef198fef186659617cfd2eb8e33a";

export type ComponentManifestStatus = "READY" | "MISSING_COMPONENT" | "ADAPTER_UNAVAILABLE" | "MEMORY_RISK" | "BLOCKED_LICENSE";

export type ImageComponentManifest = {
  schemaVersion: 1;
  adapterId: "flux" | "flux2" | "klein-demo" | "krea-2";
  modelVariant: "flux1-dev" | "flux2-dev" | "flux2-klein-4b" | "flux2-klein-9b" | "krea2-raw";
  status: ComponentManifestStatus;
  disabledReason: string | null;
  runtimeImplementation: "black-forest-labs/flux" | "black-forest-labs/flux2" | "krea-ai/krea-2" | "unavailable";
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

export function preferredImageManifest(manifests: ImageComponentManifest[]): ImageComponentManifest | undefined {
  return manifests.find((item) => item.status === "READY" && item.adapterId === "flux2")
    ?? manifests.find((item) => item.adapterId === "flux2")
    ?? manifests.find((item) => item.status === "READY" && item.adapterId === "flux")
    ?? manifests.find((item) => item.adapterId === "flux")
    ?? manifests[0];
}

function manifest(adapterId: "flux" | "flux2" | "klein-demo", variant: ImageComponentManifest["modelVariant"], now: number): ImageComponentManifest {
  const capabilities = nativeAdapterCapabilities(adapterId, variant);
  const components = componentSpecs(variant).map(toComponent);
  const missing = components.filter((component) => component.required && !component.present);
  const implementation = variant === "flux1-dev" ? "black-forest-labs/flux" : "black-forest-labs/flux2";
  const disabledUnsupported = variant === "flux1-dev" || variant === "flux2-dev" ? null : "Klein adapters remain disabled/Labs-only until a later independently gated runtime.";
  const memoryRisk = missing.length || disabledUnsupported ? null : memoryRiskReason(components, variant);
  const runtimeMissing = disabledUnsupported ?? runtimeMissingReason(variant);
  const disabledReason = missing.length
    ? `Missing exact native component: ${missing.map((item) => item.stableId).join(", ")}`
    : runtimeMissing ?? memoryRisk;
  return {
    schemaVersion: 1,
    adapterId,
    modelVariant: variant as Exclude<ImageComponentManifest["modelVariant"], "krea2-raw">,
    status: disabledReason ? (memoryRisk ? "MEMORY_RISK" : disabledUnsupported ? "ADAPTER_UNAVAILABLE" : "MISSING_COMPONENT") : "READY",
    disabledReason,
    runtimeImplementation: implementation,
    components,
    placementPlan: placementFor(components),
    controls: capabilities,
    licenseNote: variant === "flux1-dev"
      ? "App-owned Premiere316 worker with local operator-installed FLUX.1 components; no ComfyUI, cloud, or HF weight lookup."
      : variant === "flux2-dev"
        ? "App-owned Premiere316 worker with local operator-installed FLUX.2 Dev components; default T2I adapter; no ComfyUI, cloud, or HF weight lookup."
        : "Disabled Labs adapter; no packaged Generate route is available.",
    resolvedAt: now,
  };
}

function kreaManifest(now: number): ImageComponentManifest {
  const components = [
    ...Object.values(KREA2_COMPONENTS).map((component) => ({ role: component.role, stableId: component.id, path: component.path, required: true })),
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "worker", stableId: "Premiere316:desktop/workers/krea2_jsonl_worker.py", path: process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", "krea2_jsonl_worker.py") : join(process.cwd(), "desktop", "workers", "krea2_jsonl_worker.py"), required: true },
  ].map(toComponent);
  const missing = components.filter((component) => component.required && !component.present);
  const memoryRisk = missing.length ? null : memoryRiskReason(components, "krea2-raw");
  const disabledReason = missing.length ? `Missing exact KREA 2 RAW component: ${missing.map((component) => component.stableId).join(", ")}` : memoryRisk;
  return {
    schemaVersion: 1,
    adapterId: "krea-2",
    modelVariant: "krea2-raw",
    status: missing.length ? "MISSING_COMPONENT" : memoryRisk ? "MEMORY_RISK" : "READY",
    disabledReason,
    runtimeImplementation: "krea-ai/krea-2",
    components,
    placementPlan: placementFor(components),
    controls: nativeAdapterCapabilities("krea-2"),
    licenseNote: "Local official KREA 2 RAW. Text-only: attached research images guide prompt writing; they are not image conditioning. Qwen3-VL-4B encodes the queue on GPU and unloads before the image model loads.",
    resolvedAt: now,
  };
}

type ComponentSpec = { role: string; stableId: string; path: string; required: boolean };

function componentSpecs(variant: ImageComponentManifest["modelVariant"]): ComponentSpec[] {
  if (variant === "flux1-dev") return [
    { role: "runtime", stableId: "black-forest-labs/flux@802fb4713906133fcbd0d8dc5351620ca4773036", path: FLUX_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "worker", stableId: "Premiere316:desktop/workers/flux1_jsonl_worker.py", path: process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", "flux1_jsonl_worker.py") : join(process.cwd(), "desktop", "workers", "flux1_jsonl_worker.py"), required: true },
    { role: "transformer", stableId: "flux1-dev.safetensors@4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7", path: NATIVE_STILL_MODEL_PATHS.flux1, required: true },
    { role: "text_encoder", stableId: "t5xxl_fp16.safetensors@6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635", path: join(MODEL_ROOT, "text_encoders", "t5xxl_fp16.safetensors"), required: true },
    { role: "tokenizer", stableId: `google/t5-v1_1-xxl-config-tokenizer@${T5_SNAPSHOT_REVISION}:config@a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8:spiece@d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86`, path: join(HF_HUB, "models--google--t5-v1_1-xxl", "snapshots", T5_SNAPSHOT_REVISION), required: true },
    { role: "text_encoder", stableId: "clip_l.safetensors@660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", path: join(MODEL_ROOT, "text_encoders", "clip_l.safetensors"), required: true },
    { role: "tokenizer", stableId: "open_clip:bpe_simple_vocab_16e6@924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\bpe_simple_vocab_16e6.txt.gz", required: true },
    { role: "tokenizer_source", stableId: "open_clip:tokenizer.py@90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", path: "D:\\Dev\\Tools\\Python312\\Lib\\site-packages\\open_clip\\tokenizer.py", required: true },
    { role: "vae", stableId: "ae.safetensors@afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", path: NATIVE_STILL_MODEL_PATHS.flux1Vae, required: true },
  ];
  if (variant === "flux2-dev") return [
    { role: "runtime", stableId: `black-forest-labs/flux2@${FLUX2_SOURCE_HEAD}`, path: FLUX2_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "worker", stableId: "Premiere316:desktop/workers/flux2_jsonl_worker.py", path: process.env.P316_RESOURCES_PATH ? join(process.env.P316_RESOURCES_PATH, "workers", "flux2_jsonl_worker.py") : join(process.cwd(), "desktop", "workers", "flux2_jsonl_worker.py"), required: true },
    { role: "transformer", stableId: "flux2_dev.safetensors@6159a3f19f829c8e84ba6e9996b7afaf7c0a5f3428677f5b37445778a320d275", path: NATIVE_STILL_MODEL_PATHS.flux2, required: true },
    { role: "text_encoder", stableId: `mistralai/Mistral-Small-3.2-24B-Instruct-2506@${MISTRAL_REVISION}:config@01ab910a5dda7995709cc355d094eabb8094b78d49240cd167188606c3ff5edb:index@664a049408e8694e5867312145b74b1971ad5472061a1f176e0806dec9b3d21c`, path: join(HF_HUB, "models--mistralai--Mistral-Small-3.2-24B-Instruct-2506", "snapshots", MISTRAL_REVISION), required: true },
    { role: "processor", stableId: `mistralai/Mistral-Small-3.1-24B-Instruct-2503@${PROCESSOR_REVISION}:config@ce3ec410cac74da358f786c574b73b6624c50c8bb876bcb628f06500fe07adcc:tokenizer@b76085f9923309d873994d444989f7eb6ec074b06f25b58f1e8d7b7741070949`, path: join(HF_HUB, "models--mistralai--Mistral-Small-3.1-24B-Instruct-2503", "snapshots", PROCESSOR_REVISION), required: true },
    { role: "vae", stableId: "flux2-vae.safetensors@d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", path: NATIVE_STILL_MODEL_PATHS.flux2Vae, required: true },
  ];
  const four = variant === "flux2-klein-4b";
  return [
    { role: "runtime", stableId: "black-forest-labs/flux2", path: FLUX2_ROOT, required: true },
    { role: "python", stableId: "Python312", path: PYTHON, required: true },
    { role: "transformer", stableId: four ? "diffusion_models/flux2/flux-2-klein-4b-fp8.safetensors" : "diffusion_models/flux2/flux-2-klein-9b-fp8mixed.safetensors", path: join(MODEL_ROOT, "diffusion_models", "flux2", four ? "flux-2-klein-4b-fp8.safetensors" : "flux-2-klein-9b-fp8mixed.safetensors"), required: true },
    { role: "text_encoder", stableId: four ? "Qwen/Qwen3-4B-FP8" : "Qwen/Qwen3-8B-FP8", path: hfSnapshot(four ? "Qwen/Qwen3-4B-FP8" : "Qwen/Qwen3-8B-FP8"), required: true },
    { role: "vae", stableId: "vae/flux2-vae.safetensors", path: NATIVE_STILL_MODEL_PATHS.flux2Vae, required: true },
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
  for (const component of [KREA2_COMPONENTS.transformer, KREA2_COMPONENTS.encoder, KREA2_COMPONENTS.vae]) if (spec.stableId === component.id) return exactSizedFileHash(spec.path, component.sizeBytes, component.id.split("@")[1]);
  if (spec.stableId === KREA2_COMPONENTS.encoderConfig.id) return exactFileHash(join(spec.path, "config.json"), "edac7703329133edfc53e46ac0081835144c99d7eebf28b71c732694d435224d") && exactFileHash(join(spec.path, "tokenizer.json"), "a5d85b6dcc535e6b93115a9ef287e6132fdbf30270da6218194ba742261173c7") && exactFileHash(join(spec.path, "tokenizer_config.json"), "c2da771801886ad9ae98181793ffd3dfb7f1af30f6f7c6a4e15d7dbba52e2399");
  if (spec.stableId === KREA2_COMPONENTS.vaeConfig.id) return exactFileHash(join(spec.path, "config.json"), "e4e61b7553f930e9eabf8935f0a77e6d004cc3ee67a601a56ef03cc41ccada68");
  if (spec.stableId === KREA2_COMPONENTS.runtime.id) return exactFileHash(join(spec.path, "mmdit.py"), "6fabe02508a495027710456a1a480690cfab6d998dcd0307686eada81b00a6b9") && exactFileHash(join(spec.path, "sampling.py"), "57c86a7cf4bc8e31e0a5d22c740136461523cfeda0686237b301077c3adfac3b");
  if (spec.stableId.includes("google/t5-v1_1-xxl-config-tokenizer")) return ["config.json", "tokenizer_config.json", "special_tokens_map.json", "spiece.model"].every((file) => existsSync(join(spec.path, file))) && !directoryHasWeightFile(spec.path) && exactFileHash(join(spec.path, "config.json"), "a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8") && exactFileHash(join(spec.path, "tokenizer_config.json"), "b971dce1d2805c2a66da8657156e7114a30501c6ba602fc947c8bf607a3ead2d") && exactFileHash(join(spec.path, "special_tokens_map.json"), "4720c0fddbe4c5991334f85ad7073d9bd0a294a8ba4641a2f8dab614ca825949") && exactFileHash(join(spec.path, "spiece.model"), "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86");
  if (spec.stableId.includes("t5xxl_fp16.safetensors@")) return exactSizedFileHash(spec.path, 9_787_841_024, "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635");
  if (spec.stableId.includes("clip_l.safetensors@")) return exactSizedFileHash(spec.path, 246_144_152, "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd");
  if (spec.stableId.includes("flux1-dev.safetensors@")) return exactSizedFileHash(spec.path, 23_802_932_552, "4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7");
  if (spec.stableId.startsWith("ae.safetensors@")) return exactSizedFileHash(spec.path, 335_304_388, "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38");
  if (spec.stableId.includes("open_clip:tokenizer.py@")) return exactSizedFileHash(spec.path, 22_680, "90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734");
  if (spec.stableId.includes("flux2_dev.safetensors@")) return exactSizedFileHash(spec.path, 64_446_596_128, "6159a3f19f829c8e84ba6e9996b7afaf7c0a5f3428677f5b37445778a320d275");
  if (spec.stableId.includes("flux2-vae.safetensors@")) return exactSizedFileHash(spec.path, 336_213_556, "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5");
  if (spec.stableId.includes("Mistral-Small-3.2-24B-Instruct-2506@")) return mistralSnapshotPresent(spec.path);
  if (spec.stableId.includes("Mistral-Small-3.1-24B-Instruct-2503@")) return processorSnapshotPresent(spec.path);
  return true;
}

function mistralSnapshotPresent(path: string): boolean {
  const shards: Array<[string, number]> = [
    ["model-00001-of-00010.safetensors", 4_883_550_696],
    ["model-00002-of-00010.safetensors", 4_781_593_336],
    ["model-00003-of-00010.safetensors", 4_886_472_224],
    ["model-00004-of-00010.safetensors", 4_781_593_376],
    ["model-00005-of-00010.safetensors", 4_781_593_368],
    ["model-00006-of-00010.safetensors", 4_886_472_248],
    ["model-00007-of-00010.safetensors", 4_781_593_376],
    ["model-00008-of-00010.safetensors", 4_781_593_368],
    ["model-00009-of-00010.safetensors", 4_886_472_248],
    ["model-00010-of-00010.safetensors", 4_571_866_320],
  ];
  return exactFileHash(join(path, "config.json"), "01ab910a5dda7995709cc355d094eabb8094b78d49240cd167188606c3ff5edb")
    && exactFileHash(join(path, "model.safetensors.index.json"), "664a049408e8694e5867312145b74b1971ad5472061a1f176e0806dec9b3d21c")
    && shards.every(([name, size]) => exactSizedFilePresent(join(path, name), size));
}

function processorSnapshotPresent(path: string): boolean {
  return exactFileHash(join(path, "config.json"), "ce3ec410cac74da358f786c574b73b6624c50c8bb876bcb628f06500fe07adcc")
    && exactSizedFileHash(join(path, "tokenizer.json"), 17_078_037, "b76085f9923309d873994d444989f7eb6ec074b06f25b58f1e8d7b7741070949");
}

function exactSizedFilePresent(path: string, expectedSize: number): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size === expectedSize;
  } catch { return false; }
}

const exactHashCache = new Map<string, { size: number; mtimeMs: number; hash: string; ok: boolean }>();
function exactSizedFileHash(path: string, expectedSize: number, expectedHash: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size !== expectedSize) return false;
    const cached = exactHashCache.get(path);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs && cached.hash === expectedHash) return cached.ok;
    const ok = exactFileHash(path, expectedHash);
    exactHashCache.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, hash: expectedHash, ok });
    return ok;
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
  if (variant === "krea2-raw") return existsSync(KREA2_ROOT) ? null : "Official KREA 2 runtime is missing.";
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

export function nativeCudaWeightBytes(components: Pick<ImageRuntimeComponent, "required" | "role" | "sizeBytes">[], variant: ImageComponentManifest["modelVariant"]): number {
  if (variant === "krea2-raw") return Math.max(
    components.filter((item) => item.required && ["transformer", "vae"].includes(item.role)).reduce((sum, item) => sum + item.sizeBytes, 0),
    components.filter((item) => item.required && item.role === "text_encoder").reduce((sum, item) => sum + item.sizeBytes, 0),
  );
  // Matches flux2_jsonl_worker.py: Mistral and its inputs stay on CPU;
  // only the encoded conditioning tensor is transferred to CUDA.
  const cudaRoles = variant === "flux2-dev" ? ["transformer", "vae"] : ["transformer", "text_encoder", "vae"];
  return components.filter((item) => item.required && cudaRoles.includes(item.role)).reduce((sum, item) => sum + item.sizeBytes, 0);
}

function memoryRiskReason(components: ImageRuntimeComponent[], variant: ImageComponentManifest["modelVariant"]): string | null {
  const total = gpuTotalBytes();
  if (!total) return null;
  const requiredCuda = nativeCudaWeightBytes(components, variant);
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
