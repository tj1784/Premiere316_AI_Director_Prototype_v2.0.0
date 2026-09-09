import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { componentHasRequiredPayload, nativeCudaWeightBytes, resolveImageComponentManifest, resolveImageComponentManifests } from "./image-component-resolver.server.ts";
import { nativeModelPath } from "./native-model-paths.server.ts";

describe("Wave 4 image component resolver", () => {
  it("counts FLUX.2's CPU Mistral encoder against RAM, never against CUDA", () => {
    const components = [
      { required: true, role: "transformer", sizeBytes: 64_446_596_128 },
      { required: true, role: "vae", sizeBytes: 336_213_556 },
      { required: true, role: "text_encoder", sizeBytes: 48_376_375_728 },
    ];
    assert.equal(nativeCudaWeightBytes(components, "flux2-dev"), 64_782_809_684);
    assert.equal(nativeCudaWeightBytes(components, "flux1-dev"), 113_159_185_412);
  });
  it("finds organized model files while preserving an existing flat vault path", async () => {
    const root = await mkdtemp(join(tmpdir(), "p316-model-path-"));
    const family = join(root, "vae", "Flux.1");
    mkdirSync(family, { recursive: true });
    writeFileSync(join(family, "ae.safetensors"), "location fixture only");
    assert.equal(nativeModelPath(root, "vae", "Flux.1", "ae.safetensors"), join(family, "ae.safetensors"));
    writeFileSync(join(root, "vae", "ae.safetensors"), "old vault fixture");
    assert.equal(nativeModelPath(root, "vae", "Flux.1", "ae.safetensors"), join(root, "vae", "ae.safetensors"));
  });
  it("returns renderer-safe manifests without raw model-root paths", () => {
    const manifests = resolveImageComponentManifests(1700);
    assert.ok(manifests.length >= 5);
    for (const manifest of manifests) {
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.resolvedAt, 1700);
      assert.doesNotMatch(JSON.stringify(manifest.components.map((component) => component.rendererPath)), /D:\\AI\\Models/i);
      assert.doesNotMatch(JSON.stringify(manifest.components.map((component) => component.rendererPath)), /D:\\_Cache\\HuggingFace/i);
      assert.ok(["READY", "MISSING_COMPONENT", "ADAPTER_UNAVAILABLE", "MEMORY_RISK", "BLOCKED_LICENSE"].includes(manifest.status));
    }
  });

  it("models FLUX.2 Dev as the default T2I adapter and keeps FLUX.1 as a secondary packaged path", () => {
    const flux = resolveImageComponentManifest("flux", "diffusion_models/flux1-dev.safetensors", 1800);
    assert.equal(flux.adapterId, "flux");
    assert.ok(flux.components.some((component) => component.stableId.includes("t5xxl_fp16.safetensors@6e480b09")));
    assert.ok(flux.components.some((component) => component.stableId.includes("google/t5-v1_1-xxl-config-tokenizer@3db67")));
    assert.ok(flux.components.some((component) => component.stableId.includes("clip_l.safetensors@660c6f5b1abae9dc")));
    assert.ok(flux.components.some((component) => component.stableId.includes("open_clip:bpe_simple_vocab_16e6@924691")));
    assert.equal(flux.components.some((component) => component.stableId === "openai/clip-vit-large-patch14"), false);
    if (flux.status !== "READY") assert.match(flux.disabledReason ?? "", /Missing exact|runtime|MEMORY RISK/i);
    assert.doesNotMatch(flux.disabledReason ?? "", /source-disabled|cannot prove sticky residency/i);

    const flux2 = resolveImageComponentManifest("flux2", "diffusion_models/flux2_dev.safetensors", 1800);
    assert.equal(flux2.adapterId, "flux2");
    assert.equal(flux2.modelVariant, "flux2-dev");
    assert.ok(flux2.components.some((component) => component.stableId.includes("flux2_dev.safetensors@6159a3f1")));
    assert.ok(flux2.components.some((component) => component.stableId.includes("flux2-vae.safetensors@d64f3a68")));
    assert.ok(flux2.components.some((component) => component.stableId.includes("Mistral-Small-3.2-24B-Instruct-2506@95a6d26")));
    assert.doesNotMatch(flux2.disabledReason ?? "", /disabled for Wave 4/i);
    if (flux2.status !== "READY") assert.match(flux2.disabledReason ?? "", /Missing exact|runtime|MEMORY RISK/i);
    const klein = resolveImageComponentManifest("klein-demo", "", 1800);
    assert.notEqual(klein.status, "READY");
    assert.match(klein.disabledReason ?? "", /Missing exact|disabled|Labs/i);
    const krea = resolveImageComponentManifest("krea-2", "", 1800);
    assert.equal(krea.modelVariant, "krea2-raw");
    assert.equal(krea.runtimeImplementation, "krea-ai/krea-2");
    assert.equal(krea.controls?.controls.references.supported, false);
    assert.ok(krea.components.some((component) => component.stableId.includes("qwen3vl_4b_bf16.safetensors@36f3ff44")));
    assert.ok(krea.components.some((component) => component.stableId.includes("krea2_raw_bf16.safetensors@f99bb0ff")));
    if (krea.status !== "READY") assert.match(krea.disabledReason ?? "", /Missing exact|MEMORY RISK/);
  });

  it("distinguishes sampled fingerprints from full SHA identity", () => {
    const manifest = resolveImageComponentManifest("flux", "", 1900);
    for (const component of manifest.components) {
      if (component.fingerprint) assert.ok(component.fingerprintKind === "sampled" || component.fingerprintKind === "full");
      if (component.fingerprintKind === "sampled") assert.notEqual(component.fingerprint, "sha256");
    }
  });

  it("does not accept same-size substituted exact tokenizer source files", async () => {
    const root = await mkdtemp(join(tmpdir(), "p316-component-"));
    const tokenizerPath = join(root, "tokenizer.py");
    writeFileSync(tokenizerPath, "x".repeat(22_680), "utf8");
    assert.equal(componentHasRequiredPayload({ role: "tokenizer_source", stableId: "open_clip:tokenizer.py@90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", path: tokenizerPath, required: true }), false);
  });

  it("requires exact T5 config.json and spiece.model hashes before readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "p316-t5-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "config.json"), "{}", "utf8");
    writeFileSync(join(root, "tokenizer_config.json"), "{}", "utf8");
    writeFileSync(join(root, "special_tokens_map.json"), "{}", "utf8");
    writeFileSync(join(root, "spiece.model"), "not-the-pinned-spiece", "utf8");
    assert.equal(componentHasRequiredPayload({ role: "tokenizer", stableId: "google/t5-v1_1-xxl-config-tokenizer@3db67ab1af984cf10548a73467f0e5bca2aaaeb2:config@a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8:spiece@d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86", path: root, required: true }), false);
  });
});
