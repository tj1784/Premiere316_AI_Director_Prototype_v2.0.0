import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEngineConfigs } from "./engine-config.ts";
import { sanitizeModelCatalog, UNKNOWN, type LogicalModel, type ModelCatalog, type ModelComponent, type ModelRole, type Precision } from "./model-catalog.ts";

function component(name: string, role: ModelRole, sizeBytes: number, precision: Precision = "BF16"): ModelComponent {
  const path = `${role === "transformer" ? "diffusion_models" : role === "text_encoder" ? "text_encoders" : "vae"}\\${name}.safetensors`;
  return {
    id: path,
    displayName: name,
    role,
    modality: role === "transformer" ? "image" : role === "text_encoder" ? "text encoder" : "VAE",
    path,
    paths: [path],
    sizeBytes,
    precision,
    quantization: precision,
    parameterCount: UNKNOWN,
    modifiedAt: 1,
    evidence: ["filename"],
    confidence: "medium",
  };
}

function logical(components: ModelComponent[]): LogicalModel {
  return {
    id: "family:FLUX.2",
    displayName: "FLUX.2",
    family: "FLUX.2",
    modality: "image",
    role: "transformer",
    status: "Ready",
    independentlyUsable: true,
    baseModel: "FLUX.2",
    parameterCount: UNKNOWN,
    activeParameterCount: UNKNOWN,
    precision: "BF16",
    quantization: "BF16",
    sizeBytes: components.reduce((sum, item) => sum + item.sizeBytes, 0),
    folderSizeBytes: components.reduce((sum, item) => sum + item.sizeBytes, 0),
    modifiedAt: 1,
    path: components[0].path,
    requiredComponents: ["transformer"],
    discoveredSiblings: [],
    compatibleLoraFamily: "FLUX.2",
    runtimeBackend: "diffusion (local)",
    contextLength: UNKNOWN,
    license: UNKNOWN,
    sourceMetadata: UNKNOWN,
    confidence: "medium",
    components,
  };
}

function catalog(models: LogicalModel[]): ModelCatalog {
  return {
    stats: {
      foldersScanned: 1,
      filesInspected: 1,
      logicalModels: models.length,
      standaloneModels: models.length,
      componentModels: 0,
      loras: 0,
      unknownUnmapped: 0,
      totalBytes: 0,
      scanDurationMs: 1,
      cacheHits: 0,
      cacheMisses: 0,
      root: "D:\\AI\\Models",
      scannedAt: 1,
    },
    models,
    unmapped: [],
  };
}

describe("engine configurations", () => {
  it("exposes each base separately instead of summing a whole family", () => {
    const bf16 = component("flux2_dev", "transformer", 60);
    const gguf = { ...component("flux2-dev-BF16", "transformer", 60), path: "diffusion_models\\flux2-dev-BF16.gguf", precision: "GGUF variant" as const };
    const encoder = component("mistral_3_small_flux2_bf16", "text_encoder", 33);
    const vae = component("flux2-vae", "vae", 1);
    const configs = buildEngineConfigs(catalog([logical([bf16, gguf, encoder, vae])]));

    assert.equal(configs.length, 2);
    assert.equal(configs.find((item) => item.base.path === bf16.path)?.runtimeSizeBytes, 94);
    assert.equal(configs.find((item) => item.base.path === bf16.path)?.status, "Ready");
    assert.equal(configs.find((item) => item.base.path === gguf.path)?.status, "Adapter unavailable");
    assert.equal(configs[0].familyFootprintBytes, 154);
  });

  it("reports required components that are not installed", () => {
    const base = component("flux2_dev", "transformer", 60);
    const config = buildEngineConfigs(catalog([logical([base])]))[0];
    assert.equal(config.status, "Missing components");
    assert.deepEqual(config.missing, ["Text encoder", "VAE"]);
  });

  it("does not silently bind a similarly named checkpoint to the fixed native worker path", () => {
    const base = component("flux2-dev-copy", "transformer", 60);
    const encoder = component("mistral_3_small_flux2_bf16", "text_encoder", 33);
    const vae = component("flux2-vae", "vae", 1);
    const config = buildEngineConfigs(catalog([logical([base, encoder, vae])]))[0];
    assert.equal(config.status, "Adapter unavailable");
    assert.equal(config.adapterId, undefined);
  });

  it("strips the absolute model root from every renderer-facing path", () => {
    const base = component("flux2_dev", "transformer", 60);
    base.path = "D:\\AI\\Models\\diffusion_models\\flux2_dev.safetensors";
    base.paths = [base.path];
    const model = logical([base]);
    model.path = base.path;
    model.textEncoder = "D:\\AI\\Models\\text_encoders\\encoder.safetensors";
    const clean = sanitizeModelCatalog(catalog([model]));
    assert.equal(clean.models[0].path, "diffusion_models\\flux2_dev.safetensors");
    assert.equal(clean.models[0].components[0].path, "diffusion_models\\flux2_dev.safetensors");
    assert.equal(clean.models[0].textEncoder, "text_encoders\\encoder.safetensors");
  });
});
