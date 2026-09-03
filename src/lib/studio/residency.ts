/** Media generation residency / memory policy (overrides per-job unload). */

export const FULL_VRAM_WEIGHT_BUDGET_BYTES = 70 * 1024 ** 3;
export const DEFAULT_IDLE_UNLOAD_MS = 30 * 60 * 1000;
export const BF16_PEAK_FACTOR = 1.35;
export const SAFETY_MARGIN_BYTES = 2 * 1024 ** 3;

export const DEFAULT_MEDIA_POLICY = {
  residencyMode: "sticky" as const,
  keepLoadedAfterBatch: true,
  idleUnloadMinutes: 30,
  allowUserPin: true,
  preferRamTextEncoder: true,
  allowWarmCpuCache: true,
  avoidSwapDuringActiveStage: true,
};

export type PlacementDevice = "gpu" | "cpu";
export type ResidencyState =
  | "DISK_ONLY"
  | "RAM_WARM"
  | "LOADING_TO_VRAM"
  | "VRAM_RESIDENT"
  | "ACTIVE"
  | "IDLE_RESIDENT"
  | "EVICTION_PENDING"
  | "UNLOADING"
  | "ERROR";

export type IdleUnloadOption = "never" | 30 | 15 | 5 | "immediate";

export type PipelineComponent = {
  id: string;
  kind: "transformer" | "textEncoder" | "tokenizer" | "vae" | "audioVae" | "lora" | "visionEncoder" | "processor";
  sizeBytes: number;
  precision?: string;
};

export type PlacementPlan = {
  keepEverythingInVram: boolean;
  reason: string;
  placements: Record<string, PlacementDevice>;
  gpuWeightBytes: number;
  ramWeightBytes: number;
  estimatedPeakBytes: number;
  fitsSafely: boolean;
  nextFallback: string | null;
};

export type MediaJob = {
  id: string;
  modelId: string;
  loraId?: string;
  prompt: string;
  dependsOn?: string[];
  pinnedOrder?: boolean;
};

export type ComponentState = {
  id: string;
  state: ResidencyState;
  device: PlacementDevice | "disk";
  pinned: boolean;
  lastUsedAt: number;
};

export function totalWeightBytes(components: PipelineComponent[]): number {
  return components.reduce((n, c) => n + Math.max(0, c.sizeBytes), 0);
}

export function estimatedPeakBytes(gpuWeightBytes: number): number {
  return Math.ceil(gpuWeightBytes * BF16_PEAK_FACTOR);
}

export function bf16FitsSafely(gpuWeightBytes: number, vramBytes: number): boolean {
  return estimatedPeakBytes(gpuWeightBytes) + SAFETY_MARGIN_BYTES <= vramBytes;
}

export function planPlacement(
  components: PipelineComponent[],
  opts: { vramBytes: number; ramBytes?: number; pinAllInVram?: boolean } = { vramBytes: 72 * 1024 ** 3 },
): PlacementPlan {
  const total = totalWeightBytes(components);
  const keepEverythingInVram = Boolean(opts.pinAllInVram) || total > 0 && total <= FULL_VRAM_WEIGHT_BUDGET_BYTES;
  const placements: Record<string, PlacementDevice> = {};

  if (keepEverythingInVram) {
    for (const c of components) placements[c.id] = "gpu";
    const gpuWeightBytes = total;
    const peak = estimatedPeakBytes(gpuWeightBytes);
    return {
      keepEverythingInVram: true,
      reason: total <= FULL_VRAM_WEIGHT_BUDGET_BYTES
        ? `Pipeline weights ${total} bytes ≤ 70 GiB budget — keep every component in VRAM.`
        : "User pinned the full pipeline in VRAM.",
      placements,
      gpuWeightBytes,
      ramWeightBytes: 0,
      estimatedPeakBytes: peak,
      fitsSafely: bf16FitsSafely(gpuWeightBytes, opts.vramBytes),
      nextFallback: bf16FitsSafely(gpuWeightBytes, opts.vramBytes) ? null : "offload text encoder to RAM",
    };
  }

  const ramKinds = new Set(["textEncoder", "tokenizer", "processor", "visionEncoder"]);
  let gpu = 0;
  let ram = 0;
  for (const c of components) {
    const device: PlacementDevice = ramKinds.has(c.kind) ? "cpu" : "gpu";
    placements[c.id] = device;
    if (device === "gpu") gpu += c.sizeBytes;
    else ram += c.sizeBytes;
  }

  let nextFallback: string | null = null;
  const peak = estimatedPeakBytes(gpu);
  if (!bf16FitsSafely(gpu, opts.vramBytes)) {
    nextFallback = "validated quantized core weights";
    const vae = components.find((c) => c.kind === "vae" && placements[c.id] === "gpu");
    if (vae) {
      placements[vae.id] = "cpu";
      gpu -= vae.sizeBytes;
      ram += vae.sizeBytes;
      nextFallback = "VAE on CPU / tiled decode";
    }
  }

  return {
    keepEverythingInVram: false,
    reason: "Pipeline exceeds 70 GiB — text encoders and tokenizers stay in system RAM; core generator stays in VRAM.",
    placements,
    gpuWeightBytes: gpu,
    ramWeightBytes: ram,
    estimatedPeakBytes: estimatedPeakBytes(gpu),
    fitsSafely: bf16FitsSafely(gpu, opts.vramBytes),
    nextFallback: bf16FitsSafely(gpu, opts.vramBytes) ? nextFallback : nextFallback ?? "reduce batch / route to worker",
  };
}

export function clipDeviceForPlan(plan: PlacementPlan, textEncoderId = "textEncoder"): "cpu" | "default" {
  return plan.placements[textEncoderId] === "cpu" ? "cpu" : "default";
}

export function shouldUnloadAfterJob(_policy = DEFAULT_MEDIA_POLICY): boolean {
  return false;
}

export function shouldUnloadAfterBatch(policy = DEFAULT_MEDIA_POLICY): boolean {
  return !policy.keepLoadedAfterBatch;
}

export function crewUnloadWouldEvictMedia(crewUnload: boolean, media: ComponentState): boolean {
  if (!crewUnload) return false;
  if (media.pinned) return false;
  if (media.state === "ACTIVE" || media.state === "VRAM_RESIDENT" || media.state === "IDLE_RESIDENT" || media.state === "LOADING_TO_VRAM") {
    return false;
  }
  return false;
}

export function mayEvict(model: ComponentState, now: number, opts: {
  userUnload?: boolean;
  incompatibleJob?: boolean;
  idleMs?: number;
  pressure?: boolean;
  shutdown?: boolean;
  runtimeReset?: boolean;
}): { evict: boolean; reason: string | null } {
  if (opts.userUnload) return { evict: true, reason: "user unload" };
  if (opts.shutdown) return { evict: true, reason: "shutdown" };
  if (opts.runtimeReset) return { evict: true, reason: "runtime recovery" };
  if (opts.incompatibleJob && !model.pinned) return { evict: true, reason: "incompatible workload" };
  if (opts.pressure && !model.pinned) return { evict: true, reason: "VRAM pressure" };
  if (opts.pressure && model.pinned) return { evict: true, reason: "VRAM pressure (pinned; safety)" };
  const idle = opts.idleMs ?? DEFAULT_IDLE_UNLOAD_MS;
  if (idle > 0 && now - model.lastUsedAt >= idle && !model.pinned && model.state !== "ACTIVE") {
    return { evict: true, reason: "idle timeout" };
  }
  return { evict: false, reason: null };
}

export function idleMsFor(option: IdleUnloadOption): number {
  if (option === "never") return Number.POSITIVE_INFINITY;
  if (option === "immediate") return 0;
  return option * 60 * 1000;
}

export function groupJobsByModel(jobs: MediaJob[]): MediaJob[] {
  const pinned = jobs.filter((j) => j.pinnedOrder);
  if (pinned.length) return [...jobs];
  const ids = new Map(jobs.map((j) => [j.id, j]));
  const blocked = new Set<string>();
  for (const j of jobs) {
    for (const d of j.dependsOn ?? []) {
      if (ids.has(d)) blocked.add(j.id);
    }
  }
  const independent = jobs.filter((j) => !blocked.has(j.id) && !(j.dependsOn && j.dependsOn.length));
  const dependent = jobs.filter((j) => !independent.includes(j));
  const groups = new Map<string, MediaJob[]>();
  for (const j of independent) {
    const list = groups.get(j.modelId) ?? [];
    list.push(j);
    groups.set(j.modelId, list);
  }
  const ordered: MediaJob[] = [];
  for (const group of groups.values()) ordered.push(...group);
  ordered.push(...dependent);
  return ordered;
}

export function sameModelSwapCount(jobs: MediaJob[]): number {
  let swaps = 0;
  for (let i = 1; i < jobs.length; i++) {
    if (jobs[i].modelId !== jobs[i - 1].modelId) swaps += 1;
  }
  return swaps;
}

export function loraSwitchKeepsBase(from: MediaJob, to: MediaJob, engineSupportsHotSwap = true): boolean {
  return engineSupportsHotSwap && from.modelId === to.modelId && from.loraId !== to.loraId;
}

export type EmbeddingCacheKey = {
  encoderHash: string;
  tokenizerHash: string;
  rawPrompt: string;
  compiledPrompt: string;
  negativePrompt: string;
  referenceText: string;
  encoderSettings: string;
  compilerVersion: string;
};

export function embeddingKey(k: EmbeddingCacheKey): string {
  return [k.encoderHash, k.tokenizerHash, k.rawPrompt, k.compiledPrompt, k.negativePrompt, k.referenceText, k.encoderSettings, k.compilerVersion].join("\u001f");
}

export function createEmbeddingCache() {
  const map = new Map<string, Float32Array>();
  return {
    get(k: EmbeddingCacheKey) {
      return map.get(embeddingKey(k));
    },
    set(k: EmbeddingCacheKey, value: Float32Array) {
      map.set(embeddingKey(k), value);
    },
    size() {
      return map.size;
    },
  };
}

export type ReferenceCacheKey = {
  sha256: string;
  encoderFingerprint: string;
};

export function createReferenceCache() {
  const map = new Map<string, ArrayBuffer>();
  return {
    get(k: ReferenceCacheKey) {
      return map.get(`${k.sha256}:${k.encoderFingerprint}`);
    },
    set(k: ReferenceCacheKey, value: ArrayBuffer) {
      map.set(`${k.sha256}:${k.encoderFingerprint}`, value);
    },
    invalidate(sha256: string) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${sha256}:`)) map.delete(key);
      }
    },
  };
}

export function warmRamAllowed(modelBytes: number, ramFreeBytes: number): boolean {
  if (modelBytes >= 60 * 1024 ** 3) return false;
  return ramFreeBytes - modelBytes >= 8 * 1024 ** 3;
}

export function pipelineForRecipe(recipe: "krea2" | "flux2-klein" | "flux1" | "flux2-dev"): PipelineComponent[] {
  const GiB = 1024 ** 3;
  if (recipe === "krea2") {
    return [
      { id: "transformer", kind: "transformer", sizeBytes: 24.48 * GiB, precision: "BF16" },
      { id: "textEncoder", kind: "textEncoder", sizeBytes: 8.27 * GiB, precision: "BF16" },
      { id: "vae", kind: "vae", sizeBytes: 0.24 * GiB },
    ];
  }
  if (recipe === "flux1") {
    return [
      { id: "transformer", kind: "transformer", sizeBytes: 22.17 * GiB, precision: "BF16" },
      { id: "textEncoder", kind: "textEncoder", sizeBytes: 9.35 * GiB, precision: "FP16" },
      { id: "vae", kind: "vae", sizeBytes: 0.31 * GiB },
    ];
  }
  if (recipe === "flux2-dev") {
    return [
      { id: "transformer", kind: "transformer", sizeBytes: 60.02 * GiB, precision: "BF16" },
      { id: "textEncoder", kind: "textEncoder", sizeBytes: 33.14 * GiB, precision: "BF16" },
      { id: "vae", kind: "vae", sizeBytes: 0.31 * GiB },
    ];
  }
  return [
    { id: "transformer", kind: "transformer", sizeBytes: 8.79 * GiB, precision: "FP8" },
    { id: "textEncoder", kind: "textEncoder", sizeBytes: 8.07 * GiB, precision: "FP8" },
    { id: "vae", kind: "vae", sizeBytes: 0.31 * GiB },
  ];
}
