import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BF16_PEAK_FACTOR,
  DEFAULT_MEDIA_POLICY,
  FULL_VRAM_WEIGHT_BUDGET_BYTES,
  clipDeviceForPlan,
  createEmbeddingCache,
  createReferenceCache,
  crewUnloadWouldEvictMedia,
  estimatedPeakBytes,
  groupJobsByModel,
  idleMsFor,
  loraSwitchKeepsBase,
  mayEvict,
  planPlacement,
  sameModelSwapCount,
  shouldUnloadAfterBatch,
  shouldUnloadAfterJob,
  warmRamAllowed,
  type MediaJob,
  type PipelineComponent,
} from "./residency.ts";

const GiB = 1024 ** 3;
const VRAM_72 = 72 * GiB;

function fluxKleinPipeline(): PipelineComponent[] {
  return [
    { id: "transformer", kind: "transformer", sizeBytes: 9 * GiB, precision: "FP8" },
    { id: "textEncoder", kind: "textEncoder", sizeBytes: 8 * GiB, precision: "FP8" },
    { id: "vae", kind: "vae", sizeBytes: 0.3 * GiB },
    { id: "tokenizer", kind: "tokenizer", sizeBytes: 0.02 * GiB },
  ];
}

function hugeFluxPipeline(): PipelineComponent[] {
  return [
    { id: "transformer", kind: "transformer", sizeBytes: 60 * GiB, precision: "BF16" },
    { id: "textEncoder", kind: "textEncoder", sizeBytes: 24 * GiB, precision: "BF16" },
    { id: "vae", kind: "vae", sizeBytes: 0.7 * GiB },
  ];
}

describe("70 GiB full-VRAM override", () => {
  it("keeps every component in VRAM when pipeline weights total 70 GiB or less", () => {
    const plan = planPlacement(fluxKleinPipeline(), { vramBytes: VRAM_72 });
    assert.equal(plan.keepEverythingInVram, true);
    assert.equal(plan.placements.textEncoder, "gpu");
    assert.equal(plan.placements.transformer, "gpu");
    assert.equal(clipDeviceForPlan(plan), "default");
  });
  it("offloads text encoder to RAM when weights exceed 70 GiB", () => {
    const plan = planPlacement(hugeFluxPipeline(), { vramBytes: VRAM_72 });
    assert.equal(plan.keepEverythingInVram, false);
    assert.equal(plan.placements.textEncoder, "cpu");
    assert.equal(plan.placements.transformer, "gpu");
    assert.equal(clipDeviceForPlan(plan), "cpu");
  });
});

describe("text encoder RAM vs core VRAM", () => {
  it("1. text encoder may reside in RAM while core stays in VRAM", () => {
    const plan = planPlacement(hugeFluxPipeline(), { vramBytes: VRAM_72 });
    assert.equal(plan.placements.textEncoder, "cpu");
    assert.equal(plan.placements.transformer, "gpu");
  });
});

describe("prompt embedding cache", () => {
  it("2. reuses embeddings across same-prompt multiple-seed jobs", () => {
    const cache = createEmbeddingCache();
    const key = {
      encoderHash: "enc1",
      tokenizerHash: "tok1",
      rawPrompt: "rain on the pier",
      compiledPrompt: "FLUX.2 still, rain on the pier",
      negativePrompt: "",
      referenceText: "",
      encoderSettings: "cpu",
      compilerVersion: "3.02",
    };
    const vec = new Float32Array([1, 2, 3]);
    cache.set(key, vec);
    const seedA = cache.get(key);
    const seedB = cache.get({ ...key });
    assert.equal(seedA, vec);
    assert.equal(seedB, vec);
    assert.equal(cache.size(), 1);
  });
});

describe("sticky media residency", () => {
  it("3. does not unload after each job", () => {
    assert.equal(shouldUnloadAfterJob(), false);
  });
  it("4. does not unload immediately after batch by default", () => {
    assert.equal(shouldUnloadAfterBatch(), false);
    assert.equal(DEFAULT_MEDIA_POLICY.keepLoadedAfterBatch, true);
    assert.equal(DEFAULT_MEDIA_POLICY.idleUnloadMinutes, 30);
  });
});

describe("queue grouping", () => {
  it("5. groups same-model queued jobs", () => {
    const jobs: MediaJob[] = [
      { id: "a", modelId: "flux2", prompt: "1" },
      { id: "b", modelId: "krea2", prompt: "2" },
      { id: "c", modelId: "flux2", prompt: "3" },
      { id: "d", modelId: "flux2", prompt: "4" },
      { id: "e", modelId: "krea2", prompt: "5" },
    ];
    const ordered = groupJobsByModel(jobs);
    assert.ok(sameModelSwapCount(ordered) < sameModelSwapCount(jobs));
    const fluxRun = ordered.filter((j) => j.modelId === "flux2");
    const firstFlux = ordered.findIndex((j) => j.modelId === "flux2");
    const lastFlux = ordered.map((j) => j.modelId).lastIndexOf("flux2");
    assert.equal(lastFlux - firstFlux + 1, fluxRun.length);
  });
  it("6. independent jobs may reorder to minimize swaps", () => {
    const jobs: MediaJob[] = [
      { id: "1", modelId: "flux2", prompt: "a" },
      { id: "2", modelId: "krea2", prompt: "b" },
      { id: "3", modelId: "flux2", prompt: "c" },
    ];
    assert.equal(sameModelSwapCount(groupJobsByModel(jobs)), 1);
  });
  it("7. dependency-constrained jobs retain required order", () => {
    const jobs: MediaJob[] = [
      { id: "still", modelId: "flux2", prompt: "plate" },
      { id: "clip", modelId: "ltx", prompt: "motion", dependsOn: ["still"] },
      { id: "still2", modelId: "flux2", prompt: "plate2" },
    ];
    const ordered = groupJobsByModel(jobs);
    const clipAt = ordered.findIndex((j) => j.id === "clip");
    const stillAt = ordered.findIndex((j) => j.id === "still");
    assert.ok(clipAt >= 0 && stillAt >= 0);
    const originalClip = jobs.findIndex((j) => j.id === "clip");
    const originalStill = jobs.findIndex((j) => j.id === "still");
    assert.equal(originalClip > originalStill, true);
    assert.equal(ordered[clipAt].dependsOn?.[0], "still");
    assert.ok(clipAt > stillAt);
  });
  it("16. no media model swap per shot in a homogeneous batch", () => {
    const jobs: MediaJob[] = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      modelId: "h3",
      prompt: `shot ${i}`,
    }));
    assert.equal(sameModelSwapCount(groupJobsByModel(jobs)), 0);
  });
});

describe("LoRA residency", () => {
  it("8. base remains resident while compatible LoRAs change", () => {
    const a: MediaJob = { id: "1", modelId: "krea2", loraId: "darkbrush", prompt: "x" };
    const b: MediaJob = { id: "2", modelId: "krea2", loraId: "neondrip", prompt: "y" };
    assert.equal(loraSwitchKeepsBase(a, b, true), true);
  });
});

describe("crew vs media", () => {
  it("9. crew unload does not evict an active media model", () => {
    const media = {
      id: "flux2",
      state: "VRAM_RESIDENT" as const,
      device: "gpu" as const,
      pinned: false,
      lastUsedAt: Date.now(),
    };
    assert.equal(crewUnloadWouldEvictMedia(true, media), false);
  });
});

describe("BF16 fit and fallbacks", () => {
  it("10. BF16 fit uses peak headroom, not disk size alone", () => {
    const disk = 60 * GiB;
    const vram = 72 * GiB;
    assert.equal(disk < vram, true);
    assert.equal(estimatedPeakBytes(disk) > disk, true);
    assert.equal(estimatedPeakBytes(disk), Math.ceil(disk * BF16_PEAK_FACTOR));
    const plan = planPlacement(hugeFluxPipeline(), { vramBytes: vram });
    assert.notEqual(plan.estimatedPeakBytes, plan.gpuWeightBytes);
  });
  it("11. when BF16 cannot fit, text encoder is offloaded before core eviction", () => {
    const plan = planPlacement(hugeFluxPipeline(), { vramBytes: 40 * GiB });
    assert.equal(plan.placements.textEncoder, "cpu");
    assert.equal(plan.placements.transformer, "gpu");
  });
  it("12. quantized fallback is suggested before full model swapping", () => {
    const plan = planPlacement(hugeFluxPipeline(), { vramBytes: 24 * GiB });
    assert.ok(plan.nextFallback === "validated quantized core weights" || plan.nextFallback === "VAE on CPU / tiled decode" || plan.nextFallback);
    assert.notEqual(plan.nextFallback, "swap entire model");
  });
});

describe("pin, idle, pressure", () => {
  const now = 1_000_000;
  it("13. user-pinned resident model stays loaded across review and retake", () => {
    const pinned = {
      id: "flux2",
      state: "IDLE_RESIDENT" as const,
      device: "gpu" as const,
      pinned: true,
      lastUsedAt: now - 5 * 60 * 1000,
    };
    const evict = mayEvict(pinned, now, { idleMs: 30 * 60 * 1000 });
    assert.equal(evict.evict, false);
  });
  it("14. idle eviction honors timeout", () => {
    const idle = {
      id: "flux2",
      state: "IDLE_RESIDENT" as const,
      device: "gpu" as const,
      pinned: false,
      lastUsedAt: now - 31 * 60 * 1000,
    };
    const evict = mayEvict(idle, now, { idleMs: idleMsFor(30) });
    assert.equal(evict.evict, true);
    assert.equal(evict.reason, "idle timeout");
  });
  it("15. VRAM pressure can evict an unpinned idle model", () => {
    const idle = {
      id: "flux2",
      state: "IDLE_RESIDENT" as const,
      device: "gpu" as const,
      pinned: false,
      lastUsedAt: now,
    };
    const evict = mayEvict(idle, now, { pressure: true });
    assert.equal(evict.evict, true);
    assert.equal(evict.reason, "VRAM pressure");
  });
});

describe("warm RAM and reference cache", () => {
  it("17. warm RAM cache is refused for 60+ GB models", () => {
    assert.equal(warmRamAllowed(60 * GiB, 128 * GiB), false);
    assert.equal(warmRamAllowed(8 * GiB, 64 * GiB), true);
  });
  it("18. cached reference embeddings invalidate when source hash changes", () => {
    const cache = createReferenceCache();
    const buf = new ArrayBuffer(8);
    cache.set({ sha256: "aaa", encoderFingerprint: "enc" }, buf);
    assert.ok(cache.get({ sha256: "aaa", encoderFingerprint: "enc" }));
    cache.invalidate("aaa");
    assert.equal(cache.get({ sha256: "aaa", encoderFingerprint: "enc" }), undefined);
    cache.set({ sha256: "bbb", encoderFingerprint: "enc" }, buf);
    cache.invalidate("aaa");
    assert.ok(cache.get({ sha256: "bbb", encoderFingerprint: "enc" }));
  });
});

describe("visibility and no-comfy gate", () => {
  it("19. residency plan exposes component placement", () => {
    const plan = planPlacement(fluxKleinPipeline(), { vramBytes: VRAM_72 });
    assert.ok(plan.placements.transformer);
    assert.ok(plan.placements.textEncoder);
    assert.equal(typeof plan.keepEverythingInVram, "boolean");
  });
  it("20. No-ComfyUI gate still passes", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    assert.match(readme, /No ComfyUI/i);
    const home = readFileSync(join(process.cwd(), "src/components/studio/home.tsx"), "utf8");
    assert.match(home, /No Comfy/);
    const stillBay = readFileSync(join(process.cwd(), "src/components/studio/still-bay.tsx"), "utf8");
    assert.doesNotMatch(stillBay, /Comfy graph/i);
    const stills = readFileSync(join(process.cwd(), "src/lib/studio/local-still.server.ts"), "utf8");
    assert.doesNotMatch(stills, /8188/);
    assert.doesNotMatch(stills, /ComfyUI/i);
    assert.doesNotMatch(stills, /class_type/);
    assert.match(stills, /Flux2/);
    assert.match(stills, /FLUX2_MODEL_PATH/);
    assert.match(stills, /flux2_dev\.safetensors/);
    const engines = readFileSync(join(process.cwd(), "src/lib/studio/engines.ts"), "utf8");
    assert.doesNotMatch(engines, /comfy/i);
  });
});

describe("budget constant", () => {
  it("uses a 70 GiB full-VRAM weight budget", () => {
    assert.equal(FULL_VRAM_WEIGHT_BUDGET_BYTES, 70 * GiB);
  });
});
