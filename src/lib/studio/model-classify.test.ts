import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, UNKNOWN } from "./model-catalog.ts";
import {
  classifyWeight,
  familyFromPath,
  groupLogicalModels,
  shardGroupKey,
  shouldSkipDirName,
  type IndexedWeight,
} from "./model-classify.ts";

function weight(partial: Partial<IndexedWeight> & Pick<IndexedWeight, "path" | "relativePath" | "name" | "topFolder">): IndexedWeight {
  return {
    dir: "D:\\AI\\Models\\" + partial.topFolder,
    size: 1_000_000,
    mtimeMs: 1,
    ext: ".safetensors",
    ...partial,
  };
}

describe("formatBytes", () => {
  it("formats gigabytes to one decimal", () => {
    assert.equal(formatBytes(46.2 * 1024 ** 3), "46.2 GB");
  });
});

describe("skip dirs", () => {
  it("skips cache quarantine and duplicates", () => {
    assert.equal(shouldSkipDirName(".cache"), true);
    assert.equal(shouldSkipDirName("duplicates"), true);
    assert.equal(shouldSkipDirName("_Quarantine"), true);
    assert.equal(shouldSkipDirName("diffusion_models"), false);
  });
});

describe("shard grouping", () => {
  it("collapses split GGUF names", () => {
    assert.equal(shardGroupKey("model-00001-of-00008.gguf"), shardGroupKey("model-00008-of-00008.gguf"));
  });
});

describe("family from path", () => {
  it("maps MiniMax H3 from directory structure", () => {
    const r = familyFromPath("diffusion_models\\MiniMax-H3\\minimax_h3_fl2va_bf16.safetensors", "minimax_h3_fl2va_bf16.safetensors", "diffusion_models");
    assert.equal(r.family, "MiniMax H3");
    assert.equal(r.source, "filename");
  });
  it("maps LTX 2.3 from nested directory separators", () => {
    const r = familyFromPath("diffusion_models\\LTX\\2.3\\FineTunes\\10Eros_v1-Q5_K_M.gguf", "10Eros_v1-Q5_K_M.gguf", "diffusion_models");
    assert.equal(r.family, "LTX 2.3");
  });
  it("keeps a diffusion transformer named sulphur as transformer", () => {
    const c = classifyWeight(
      weight({
        path: "D:\\AI\\Models\\diffusion_models\\sulphur_dev_bf16.safetensors",
        relativePath: "diffusion_models\\sulphur_dev_bf16.safetensors",
        name: "sulphur_dev_bf16.safetensors",
        topFolder: "diffusion_models",
        header: { tensorKeys: ["audio_vae.encoder.weight", "video.blocks.0"] },
      }),
    );
    assert.equal(c.family, "LTX 2.3");
    assert.equal(c.role, "transformer");
  });
  it("maps LTX 2.5 text encoder", () => {
    const r = familyFromPath("text_encoders\\gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", "text_encoders");
    assert.equal(r.family, "LTX 2.5");
  });
  it("does not call FLUX.2 Klein FLUX.2", () => {
    const r = familyFromPath("loras\\Flux Klein 2\\foo.safetensors", "MaleClimax_FluxKlein9B.safetensors", "loras");
    assert.equal(r.family, "FLUX.2 Klein");
  });
});

describe("groupLogicalModels", () => {
  it("recognizes nested tokenizer and VAE support weights as components", () => {
    const tokenizer = classifyWeight(weight({
      path: "D:\\AI\\Models\\TTS\\qwen3_tts\\Base\\speech_tokenizer\\model.safetensors",
      relativePath: "TTS\\qwen3_tts\\Base\\speech_tokenizer\\model.safetensors",
      name: "model.safetensors",
      topFolder: "TTS",
    }));
    const vae = classifyWeight(weight({
      path: "D:\\AI\\Models\\SEEDVR2\\ema_vae_fp16.safetensors",
      relativePath: "SEEDVR2\\ema_vae_fp16.safetensors",
      name: "ema_vae_fp16.safetensors",
      topFolder: "SEEDVR2",
    }));
    assert.equal(tokenizer.role, "tokenizer");
    assert.equal(vae.role, "vae");
    assert.equal(tokenizer.independentlyUsable, false);
    assert.equal(vae.independentlyUsable, false);
  });

  it("nests LTX 2.5 components under one logical model", () => {
    const files = [
      weight({
        path: "D:\\AI\\Models\\diffusion_models\\ltx-2.5-22b-dev.safetensors",
        relativePath: "diffusion_models\\ltx-2.5-22b-dev.safetensors",
        name: "ltx-2.5-22b-dev.safetensors",
        topFolder: "diffusion_models",
        size: 20e9,
      }),
      weight({
        path: "D:\\AI\\Models\\text_encoders\\gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
        relativePath: "text_encoders\\gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
        name: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
        topFolder: "text_encoders",
        size: 24e9,
      }),
      weight({
        path: "D:\\AI\\Models\\vae\\ltx-2.5-video-vae-bf16.safetensors",
        relativePath: "vae\\ltx-2.5-video-vae-bf16.safetensors",
        name: "ltx-2.5-video-vae-bf16.safetensors",
        topFolder: "vae",
        size: 1e9,
      }),
      weight({
        path: "D:\\AI\\Models\\vae\\ltx-2.5-audio-vae-bf16.safetensors",
        relativePath: "vae\\ltx-2.5-audio-vae-bf16.safetensors",
        name: "ltx-2.5-audio-vae-bf16.safetensors",
        topFolder: "vae",
        size: 3e8,
      }),
      weight({
        path: "D:\\AI\\Models\\latent_upscale_models\\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        relativePath: "latent_upscale_models\\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        name: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        topFolder: "latent_upscale_models",
        size: 9e8,
      }),
    ].map(classifyWeight);

    const { models, unmapped } = groupLogicalModels(files);
    assert.equal(unmapped.length, 0);
    assert.equal(models.length, 1);
    assert.equal(models[0].displayName, "LTX 2.5");
    assert.equal(models[0].independentlyUsable, true);
    assert.equal(models[0].status, "Ready");
    assert.ok(models[0].textEncoder);
    assert.ok(models[0].vae);
    assert.ok(models[0].audioVae);
    assert.ok(models[0].components.some((c) => c.role === "upscaler"));
  });

  it("does not mark a LoRA as independently usable", () => {
    const files = [
      classifyWeight(
        weight({
          path: "D:\\AI\\Models\\loras\\krea2_darkbrush.safetensors",
          relativePath: "loras\\krea2_darkbrush.safetensors",
          name: "krea2_darkbrush.safetensors",
          topFolder: "loras",
          size: 4e8,
        }),
      ),
    ];
    const { models, unmapped } = groupLogicalModels(files);
    assert.equal(models.length, 0);
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0].role, "lora");
  });

  it("keeps unknown family transformers from looking Ready without evidence", () => {
    const files = [
      classifyWeight(
        weight({
          path: "D:\\AI\\Models\\diffusion_models\\mystery.safetensors",
          relativePath: "diffusion_models\\mystery.safetensors",
          name: "mystery.safetensors",
          topFolder: "diffusion_models",
          size: 2e9,
        }),
      ),
    ];
    const { models } = groupLogicalModels(files);
    assert.equal(models.length, 1);
    assert.equal(models[0].family, UNKNOWN);
    assert.equal(models[0].status, "Needs mapping");
  });

  it("treats split GGUF as one logical model", () => {
    const a = classifyWeight(
      weight({
        path: "D:\\AI\\Models\\LMStudio\\pub\\m\\model-00001-of-00002.gguf",
        relativePath: "LMStudio\\pub\\m\\model-00001-of-00002.gguf",
        name: "model-00001-of-00002.gguf",
        topFolder: "LMStudio",
        dir: "D:\\AI\\Models\\LMStudio\\pub\\m",
        ext: ".gguf",
        size: 10e9,
      }),
    );
    const b = classifyWeight(
      weight({
        path: "D:\\AI\\Models\\LMStudio\\pub\\m\\model-00002-of-00002.gguf",
        relativePath: "LMStudio\\pub\\m\\model-00002-of-00002.gguf",
        name: "model-00002-of-00002.gguf",
        topFolder: "LMStudio",
        dir: "D:\\AI\\Models\\LMStudio\\pub\\m",
        ext: ".gguf",
        size: 8e9,
      }),
    );
    assert.equal(a.shardKey, b.shardKey);
    const { models } = groupLogicalModels([a, b]);
    const llm = models.filter((m) => m.components.some((c) => c.path.includes("model-00001")));
    assert.ok(llm.length >= 1);
    const one = llm[0];
    assert.equal(one.components.length, 1);
    assert.equal(one.sizeBytes, 18e9);
  });
});
