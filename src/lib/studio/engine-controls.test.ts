import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  changedReloadEffect,
  nativeAdapterCapabilities,
  runtimeDefaults,
  visibleControls,
} from "./engine-controls.ts";
import {
  applyQualityPreset,
  diffGenerationValues,
  markCustomWhenPresetValueChanges,
  resetToEngineDefault,
  resetToProject,
  resolveGenerationConfig,
  saveAsProjectDefault,
  setLayerValue,
} from "./generation-config.ts";
import { createGenerationProvenance, provenanceSidecarName, serializeGenerationProvenance, telemetryFromWorker } from "./generation-provenance.ts";
import { CALIBRATION_SEED, createCalibrationRequest, upsertCalibration } from "./engine-calibration.ts";
import { MEMORY_LABELS, engineMemoryMetrics } from "./memory-metrics.ts";
import { validateGenerationConfig } from "./generation-validation.ts";
import { executedNativeStillSettings, toNativeStillWorkerRequest } from "./native-still-contract.ts";
import type { EngineConfig } from "./engine-config.ts";
import { configureEngine } from "./configured-engine.ts";

const flux1 = nativeAdapterCapabilities("flux", "flux1-dev.safetensors")!;
const flux2 = nativeAdapterCapabilities("flux2", "flux2-dev.safetensors")!;
const klein4 = nativeAdapterCapabilities("klein-demo", "flux-2-klein-4b-fp8.safetensors")!;
const klein9 = nativeAdapterCapabilities("klein-demo", "flux-2-klein-9b-fp8mixed.safetensors")!;

function engine(adapterId: EngineConfig["adapterId"] = "flux2"): EngineConfig {
  return {
    id: "engine:flux2",
    displayName: "FLUX.2 Dev",
    family: "FLUX.2",
    modality: "image",
    base: {
      id: "base", displayName: "flux2-dev", role: "transformer", modality: "image",
      path: "diffusion_models\\flux2-dev.safetensors", paths: ["diffusion_models\\flux2-dev.safetensors"],
      sizeBytes: 60, precision: "BF16", quantization: "BF16", parameterCount: "UNKNOWN",
      modifiedAt: 1, evidence: ["filename"], confidence: "medium", sha256: "abc", sha256Kind: "full",
    },
    slots: [], runtimeSizeBytes: 60, familyFootprintBytes: 94, runtimeBackend: "native", adapterId,
    status: adapterId ? "Ready" : "Adapter unavailable", missing: [],
  };
}

describe("native engine capability schemas", () => {
  it("exposes only worker-backed controls in the normal visible set", () => {
    assert.ok(visibleControls(flux2, "basic").some((control) => control.id === "references"));
    assert.ok(!visibleControls(flux1, "basic").some((control) => control.id === "references"));
    assert.equal(flux1.controls.references.supported, false);
    assert.match(flux1.controls.references.disabledReason!, /current native adapter/);
    assert.equal(flux2.controls.loras.supported, false);
    assert.equal(flux2.controls.negativePrompt.supported, false);
  });

  it("keeps timestep-distilled Klein variants fixed at native 4-step guidance-1 settings", () => {
    for (const capabilities of [klein4, klein9]) {
      assert.equal(capabilities.controls.steps.fixed, true);
      assert.equal(capabilities.controls.steps.runtimeDefault, 4);
      assert.equal(capabilities.controls.steps.perGenerationOverride, false);
      assert.equal(capabilities.controls.guidance.runtimeDefault, 1);
      assert.match(capabilities.controls.guidance.help, /distilled/i);
    }
    assert.equal(flux2.controls.steps.runtimeDefault, 50);
    assert.equal(flux1.controls.steps.runtimeDefault, 20);
  });

  it("uses model-aware presets instead of a universal step and guidance recipe", () => {
    assert.equal(klein4.presets.find((preset) => preset.id === "production")?.values.steps, 4);
    assert.equal(flux2.presets.find((preset) => preset.id === "production")?.values.steps, 50);
    assert.equal(flux1.presets.find((preset) => preset.id === "production")?.values.guidance, 3.5);
  });

  it("marks prompt/seed changes no-reload and prompt changes cache-invalidating", () => {
    assert.equal(changedReloadEffect(flux2, { seed: 1 }, { seed: 2 }), "NO_RELOAD");
    assert.equal(changedReloadEffect(flux2, { prompt: "a" }, { prompt: "b" }), "CACHE_INVALIDATION");
    assert.equal(changedReloadEffect(flux2, { precision: "BF16" }, { precision: "FP16" }), "FULL_RELOAD");
  });
});

describe("native still worker boundary", () => {
  it("serializes only worker-backed settings and strips FLUX.1 references", () => {
    const request = toNativeStillWorkerRequest({
      capabilities: flux1,
      values: { width: 1024, height: 576, seed: 42, negativePrompt: "ignored", loras: ["ignored"] },
      prompt: " frame ", engineId: "flux", engineName: "FLUX.1 Dev", out: "plate.png", referencePaths: ["ref.png"],
    });
    assert.deepEqual(request, {
      method: "generate", prompt: "frame", out: "plate.png",
      width: 512, height: 512, seed: 42,
    });
    assert.ok(!("negativePrompt" in request));
    assert.ok(!("loras" in request));
  });

  it("records the worker-returned seed and audited fixed sampling values", () => {
    const request = toNativeStillWorkerRequest({
      capabilities: klein4, values: { width: 896, height: 512, seed: 1 }, prompt: "frame",
      engineId: "klein-demo", engineName: "FLUX.2 Klein 4B", out: "plate.png", referencePaths: ["ref.png"],
    });
    const actual = executedNativeStillSettings(klein4, request, { ok: true, seed: 99 });
    assert.deepEqual(actual, {
      width: 896, height: 512, steps: 4, guidance: 1, seed: 99,
      scheduler: "flux2-empirical-snr", precision: "BF16", outputFormat: "PNG", outputBitDepth: 8,
    });
  });
});

describe("generation configuration inheritance", () => {
  it("resolves engine → project → scene → shot → generation and stores differences only", () => {
    const defaults = { width: 1280, height: 720, seed: 7 } as const;
    const layers = [
      { scope: "project" as const, scopeId: "p", values: { width: 1536 } },
      { scope: "scene" as const, scopeId: "s", values: { height: 864 } },
      { scope: "shot" as const, scopeId: "h", values: { seed: 9 } },
      { scope: "generation" as const, scopeId: "g", values: { width: 1024 } },
    ];
    const resolved = resolveGenerationConfig(defaults, layers);
    assert.deepEqual(resolved.values, { width: 1024, height: 864, seed: 9 });
    assert.deepEqual(resolved.sources, { width: "generation", height: "scene", seed: "shot" });
    assert.deepEqual(diffGenerationValues(defaults, resolved.values), { width: 1024, height: 864, seed: 9 });
    assert.deepEqual(setLayerValue(defaults, { width: 1536 }, "width", 1280), {});
  });

  it("resets to project or engine defaults without copying inherited values", () => {
    const layers = [
      { scope: "project" as const, scopeId: "p", values: { width: 1536 } },
      { scope: "shot" as const, scopeId: "h", values: { seed: 9 } },
    ];
    assert.deepEqual(resetToProject(layers), [layers[0]]);
    assert.deepEqual(resetToEngineDefault(), []);
    assert.deepEqual(saveAsProjectDefault({ width: 1280, seed: 7 }, { width: 1280, seed: 9 }, "p").values, { seed: 9 });
  });

  it("preserves a locked seed and changes presets to Custom after manual edits", () => {
    const production = applyQualityPreset(flux2, runtimeDefaults(flux2), "production");
    const seeded = { ...production, randomizeSeed: false, lockSeed: true, seed: 847192031 };
    const next = markCustomWhenPresetValueChanges(flux2, seeded, "width", 1024);
    assert.equal(next.qualityPreset, "custom");
    assert.equal(next.seed, 847192031);
    assert.equal(next.lockSeed, true);
  });
});

describe("configuration validation", () => {
  it("rejects unsupported controls and fixed distilled overrides", () => {
    const unsupported = validateGenerationConfig(engine("flux"), flux1, { ...runtimeDefaults(flux1), references: ["ref"] });
    assert.equal(unsupported.state, "INVALID CONFIGURATION");
    assert.match(unsupported.errors.join(" "), /Reference images/);

    const wrongKlein = validateGenerationConfig(engine("klein-demo"), klein4, { ...runtimeDefaults(klein4), steps: 20 });
    assert.equal(wrongKlein.state, "INVALID CONFIGURATION");
    assert.match(wrongKlein.errors.join(" "), /fixed at 4/);
  });

  it("does not call an unsupported engine ready merely because files exist", () => {
    const result = validateGenerationConfig(engine(undefined), null, {});
    assert.equal(result.state, "UNSUPPORTED");
    assert.deepEqual(result.errors, ["Runtime adapter not yet implemented."]);
  });

  it("distinguishes memory risk from an otherwise valid configuration", () => {
    const result = validateGenerationConfig(engine(), flux2, runtimeDefaults(flux2), {
      estimatedPeakVramBytes: 80,
      availableVramBytes: 72,
    });
    assert.equal(result.state, "MEMORY RISK");
  });
});

describe("actual execution provenance and telemetry", () => {
  it("freezes actual adapter results and keeps them independent of later UI changes", () => {
    const actual = {
      assetId: "asset-1", engineId: "engine:flux2", engineName: "FLUX.2 Dev",
      runtimeAdapter: "flux2", runtimeImplementation: "black-forest-labs/flux2",
      baseCheckpoint: { id: "base", path: "flux2-dev.safetensors", fingerprint: "abc", fingerprintKind: "full" as const },
      components: [{ role: "text_encoder", id: "te", path: "mistral.safetensors", fingerprint: "def" }],
      loras: [], prompt: "hero still", enhancedPrompt: null, references: [], width: 1280, height: 720,
      steps: 50, guidance: 4, seed: 847192031, scheduler: "flux2-empirical-snr", timestepData: null,
      precision: "BF16", outputFormat: "PNG", outputBitDepth: 8, placementPlan: null,
      generatedAt: "2026-09-02T00:00:00.000Z", applicationVersion: "3.0.2",
      telemetry: telemetryFromWorker({ totalMs: 2510, residentBeforeJob: true, residentAfterJob: true }, 9999),
    };
    const provenance = createGenerationProvenance(actual);
    actual.prompt = "changed UI prompt";
    assert.equal(provenance.prompt, "hero still");
    assert.equal(provenance.telemetry.totalMs, 2510);
    assert.equal(provenance.telemetry.modelLoadMs, null);
    assert.ok(Object.isFrozen(provenance));
  });

  it("does not fabricate unavailable worker measurements", () => {
    const telemetry = telemetryFromWorker({}, 1200);
    assert.deepEqual(telemetry, {
      modelLoadMs: null, inferenceMs: null, totalMs: 1200,
      peakVramBytes: null, peakSystemRamBytes: null,
      residentBeforeJob: false, residentAfterJob: false,
    });
  });

  it("uses a stable sidecar name so provenance survives application restart", () => {
    assert.equal(provenanceSidecarName("847192031.png"), "847192031.provenance.json");
    const provenance = createGenerationProvenance({
      assetId: "asset-1", engineId: "engine:flux2", engineName: "FLUX.2 Dev",
      runtimeAdapter: "flux2", runtimeImplementation: "black-forest-labs/flux2",
      baseCheckpoint: { id: "base", path: "flux2.safetensors", fingerprint: null, fingerprintKind: null },
      components: [], loras: [], prompt: "p", enhancedPrompt: null, references: [], width: 512, height: 512,
      steps: 50, guidance: 4, seed: 1, scheduler: "flux2-empirical-snr", timestepData: null,
      precision: "BF16", outputFormat: "PNG", outputBitDepth: 8, placementPlan: null,
      generatedAt: "2026-09-02T00:00:00.000Z", applicationVersion: "3.0.2", telemetry: telemetryFromWorker({}, 1),
    });
    assert.equal(JSON.parse(serializeGenerationProvenance(provenance)).seed, 1);
  });
});

describe("local calibration", () => {
  it("creates a deterministic small request and replaces measurements for the same configuration", () => {
    const request = createCalibrationRequest("flux2", "hash", runtimeDefaults(flux2));
    assert.equal(request.seed, CALIBRATION_SEED);
    assert.equal(request.width, 512);
    assert.equal(request.values.lockSeed, true);
    const first = {
      adapterId: "flux2", configurationFingerprint: "hash", modelLoadMs: 100,
      firstGenerationMs: 200, warmGenerationMs: 150, peakVramBytes: null, peakSystemRamBytes: null,
      outputDescription: "512 × 512 · 50 steps", errors: [], warnings: [], measuredAt: "one",
    };
    const second = { ...first, warmGenerationMs: 120, measuredAt: "two" };
    assert.deepEqual(upsertCalibration(upsertCalibration([], first), second), [second]);
  });
});

describe("memory terminology", () => {
  it("keeps installed, selected, estimated, and measured metrics distinct", () => {
    const metrics = engineMemoryMetrics({
      installedFamilyFootprintBytes: 94, selectedConfigurationFootprintBytes: 60,
      estimatedVramBytes: null, measuredPeakVramBytes: null,
      estimatedSystemRamBytes: null, measuredPeakSystemRamBytes: null,
    });
    assert.equal(metrics.selectedConfigurationFootprintBytes, 60);
    assert.equal(MEMORY_LABELS.selectedConfigurationFootprintBytes, "Selected configuration footprint");
    assert.equal(MEMORY_LABELS.measuredPeakVramBytes, "Measured peak VRAM");
    assert.notEqual(MEMORY_LABELS.selectedConfigurationFootprintBytes, "VRAM required");
  });

  it("joins adapter truth without relabelling selected file footprint as VRAM", () => {
    const configured = configureEngine(engine());
    assert.equal(configured.capabilities?.modelVariant, "flux2-dev");
    assert.equal(configured.memory.selectedConfigurationFootprintBytes, 60);
    assert.equal(configured.memory.estimatedVramBytes, null);
    assert.equal(configured.validation.state, "READY");
  });
});

describe("runtime inspection boundary", () => {
  it("does not expose free inspect/wake through the typed desktop client", async () => {
    const client = await import("../desktop/client.ts");
    assert.equal("desktopInspectEngine" in client, false);
  });
});
