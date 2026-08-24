import assert from "node:assert/strict";
import test from "node:test";
import { buildUpscaleManifest } from "../client/src/upscale-manifest.js";

test("upscale manifest routes degraded restoration to SUPIR with safe 4x cap", () => {
  const manifest = buildUpscaleManifest("Take this blurry old 480p movie clip, clean up the heavy compression blockiness, blow it up to 4K, and make the character faces look incredibly sharp and real.");
  assert.equal(manifest.pipeline_routing.primary_engine, "SUPIR");
  assert.equal(manifest.pipeline_routing.motion_engine, "None");
  assert.deepEqual(manifest.pipeline_routing.preprocess_filters, ["Denoise_Deartifact"]);
  assert.equal(manifest.parameters.upscale_factor, 4);
  assert.equal(manifest.parameters.denoise_strength, 0.85);
  assert.equal(manifest.parameters.target_fps, null);
  assert.equal(manifest.parameters.generative_fidelity, 0.75);
  assert.equal(manifest.director_metadata.hardware_safety_tier, "Extreme_VRAM");
});

test("upscale manifest routes gameplay fps conversion to Real_ESRGAN plus interpolation", () => {
  const manifest = buildUpscaleManifest("Convert this 1080p gameplay footage to a smooth 60fps and sharpen up the text overlays quickly without changing the art style.");
  assert.equal(manifest.pipeline_routing.primary_engine, "Real_ESRGAN");
  assert.equal(manifest.pipeline_routing.motion_engine, "Frame_Interpolation");
  assert.deepEqual(manifest.pipeline_routing.preprocess_filters, []);
  assert.equal(manifest.parameters.upscale_factor, 2);
  assert.equal(manifest.parameters.denoise_strength, 0);
  assert.equal(manifest.parameters.target_fps, 60);
  assert.equal(manifest.parameters.generative_fidelity, 0.1);
  assert.equal(manifest.director_metadata.hardware_safety_tier, "Performance");
});

test("upscale manifest supports preprocess-only directives", () => {
  const manifest = buildUpscaleManifest("Denoise the low-light grain and color correct the washed out contrast.");
  assert.equal(manifest.pipeline_routing.primary_engine, "None");
  assert.equal(manifest.pipeline_routing.motion_engine, "None");
  assert.deepEqual(manifest.pipeline_routing.preprocess_filters, ["Denoise_Deartifact", "Color_Correction"]);
  assert.equal(manifest.parameters.upscale_factor, 1);
  assert.equal(manifest.parameters.denoise_strength, 0.55);
  assert.equal(manifest.parameters.generative_fidelity, 0);
  assert.equal(manifest.director_metadata.hardware_safety_tier, "Standard");
});
