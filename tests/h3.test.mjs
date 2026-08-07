import test from "node:test";
import assert from "node:assert/strict";
import {
  H3_FPS,
  H3_MODE_FIRST_LAST,
  H3_MODE_REFERENCE,
  H3_PROVIDER_ID,
  buildH3Workflow,
  compileH3Prompt,
  h3Dimensions,
  h3ResolvedFrames,
  h3Timing,
  splitH3Ranges,
  validateH3ReferenceManifest
} from "../server/h3.js";

function fakeCombo(values) {
  return [values, { options: values }];
}

function fakeObjectInfo() {
  const widgetInt = ["INT", { default: 1, min: 0, max: 999999 }];
  const widgetFloat = ["FLOAT", { default: 1, min: 0, max: 1, step: 0.01 }];
  const widgetString = ["STRING", { default: "", multiline: true }];
  return {
    MiniMaxH3ImageToVideo: {
      input: {
        required: {
          clip: ["CLIP", {}],
          vae: ["VAE", {}],
          prompt: widgetString,
          width: widgetInt,
          height: widgetInt,
          length: widgetInt
        },
        optional: {
          first_frame: ["IMAGE", {}],
          last_frame: ["IMAGE", {}]
        }
      }
    },
    MiniMaxH3ReferenceToVideo: {
      input: {
        required: {
          clip: ["CLIP", {}],
          vae: ["VAE", {}],
          audio_vae: ["VAE", {}],
          prompt: widgetString,
          width: widgetInt,
          height: widgetInt,
          length: widgetInt,
          ref_image_size: fakeCombo(["match", "max"])
        },
        optional: {
          "ref_images.ref_image_0": ["IMAGE", {}],
          "ref_videos.ref_video_0": ["IMAGE", {}],
          "ref_video_audios.ref_video_audio_0": ["AUDIO", {}],
          "ref_audios.ref_audio_0": ["AUDIO", {}]
        }
      }
    },
    UNETLoader: { input: { required: { unet_name: fakeCombo(["minimax_h3_fl2va_pruned_int8_convrot.safetensors", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"]), weight_dtype: fakeCombo(["default"]) } } },
    CLIPLoader: { input: { required: { clip_name: fakeCombo(["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]), type: fakeCombo(["minimax"]) }, optional: { device: fakeCombo(["default", "cpu"]) } } },
    VAELoader: { input: { required: { vae_name: fakeCombo(["minimax_h3_video_vae_fp16.safetensors", "minimax_h3_audio_vae_fp32.safetensors"]) } } },
    VAEDecodeAudio: { input: { required: { samples: ["LATENT", {}], vae: ["VAE", {}] } } },
    VAEDecode: { input: { required: { samples: ["LATENT", {}], vae: ["VAE", {}] } } },
    KSamplerSelect: { input: { required: { sampler_name: fakeCombo(["res_multistep"]) } } },
    BasicScheduler: { input: { required: { model: ["MODEL", {}], scheduler: fakeCombo(["simple"]), steps: widgetInt, denoise: widgetFloat } } },
    SamplerCustomAdvanced: { input: { required: { noise: ["NOISE", {}], guider: ["GUIDER", {}], sampler: ["SAMPLER", {}], sigmas: ["SIGMAS", {}], latent_image: ["LATENT", {}] } } },
    BasicGuider: { input: { required: { model: ["MODEL", {}], conditioning: ["CONDITIONING", {}] } } },
    RandomNoise: { input: { required: { noise_seed: ["INT", { default: 1, control_after_generate: true }] } } },
    CreateVideo: { input: { required: { images: ["IMAGE", {}], fps: widgetFloat }, optional: { audio: ["AUDIO", {}], bit_depth: widgetInt } } },
    SaveVideo: { input: { required: { video: ["VIDEO", {}], filename_prefix: widgetString, format: fakeCombo(["auto", "mp4"]), codec: fakeCombo(["auto", "h264"]) } } },
    LoadImage: { input: { required: { image: fakeCombo(["first.png", "last.png"]) } } },
    LoadAudio: { input: { required: { audio: fakeCombo(["voice.wav"]) } } },
    VHS_LoadVideo: { input: { required: { video: fakeCombo(["ref.mp4"]), force_rate: widgetFloat, custom_width: widgetInt, custom_height: widgetInt, frame_load_cap: widgetInt, skip_first_frames: widgetInt, select_every_nth: widgetInt } } },
    ComfyMathExpression: { input: { required: { expression: widgetString }, optional: { "values.a": widgetFloat, "values.b": widgetFloat } } },
    PrimitiveFloat: { input: { required: { value: widgetFloat } } }
  };
}

const project = {
  slug: "h3-test",
  name: "H3 Test",
  settings: { fps: 24, width: 1280, height: 720 },
  score: { enabled: true, prompt: "low reverent choir", instrumentalOnly: true }
};

const clip = {
  id: "clip_1",
  name: "Shot_01",
  durationSec: 6,
  globalPrompt: "Photorealistic biblical mountain prayer scene with wind, golden light, and emotional continuity.",
  seed: 123,
  guides: [
    { id: "g_first", role: "first", frame: 0, file: "first.png", prompt: "Jesus in frontal three-quarter prayer pose." },
    { id: "g_last", role: "last", frame: 143, file: "last.png", prompt: "Twilight ending frame, same Jesus identity." }
  ],
  segments: [
    { id: "s1", startFrame: 0, endFrame: 72, prompt: "Jesus slowly kneels on rocky ground." },
    { id: "s2", startFrame: 72, endFrame: 144, prompt: "Jesus lifts his head toward heaven." }
  ]
};

test("provider identity is stable", () => {
  assert.equal(H3_PROVIDER_ID, "minimax_h3_local");
  assert.equal(H3_FPS, 24);
});

test("H3 17k+5 frame conversion follows the official formula", () => {
  assert.equal(h3ResolvedFrames(4), 107);
  assert.equal(h3ResolvedFrames(6), 158);
  assert.equal(h3ResolvedFrames(15), 362);
  const timing = h3Timing(2);
  assert.equal(timing.generationSeconds, 4);
  assert.equal(timing.wasClampedForMinimum, true);
  assert.equal(timing.conformedFrames, 48);
});

test("H3 dimensions stay multiple-of-32 and include a cinema 2.39 preset", () => {
  const wide = h3Dimensions({ aspect: "2.39:1", quality: "full" });
  assert.equal(wide.width % 32, 0);
  assert.equal(wide.height % 32, 0);
  assert.ok(wide.width * wide.height <= 1344 * 768);
  assert.ok(Math.abs((wide.width / wide.height) - 2.39) < 0.08);
});

test("range splitting keeps H3 jobs at 15 seconds or less", () => {
  const ranges = splitH3Ranges([{ startFrame: 0, endFrame: 900, segmentIds: ["a"] }], 24);
  assert.deepEqual(ranges.map((range) => [range.startFrame, range.endFrame]), [[0, 360], [360, 720], [720, 900]]);
});

test("Ref2VA reference validation enforces limits and stable tags", () => {
  const valid = validateH3ReferenceManifest([
    { type: "image", role: "character identity", file: "jesus.png" },
    { type: "video", role: "camera motion", file: "move.mp4", durationSec: 4 },
    { type: "audio", role: "voice tone", file: "voice.wav", durationSec: 3 }
  ]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.references.map((ref) => ref.tag), ["<Picture 1>", "<Video 1>", "<Audio 1>"]);
  const invalid = validateH3ReferenceManifest([{ type: "audio", file: "voice.wav", durationSec: 3 }]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /Audio cannot be the only/);
});

test("deterministic H3 prompt compiler preserves timeline, guides, and audio intent", () => {
  const compiled = compileH3Prompt({ project, clip, mode: H3_MODE_FIRST_LAST, rangeStartFrame: 0, rangeEndFrame: 144 });
  assert.match(compiled.prompt, /PREMIERE316 LOCAL MINIMAX H3 DIRECTOR PROMPT/);
  assert.match(compiled.prompt, /Jesus slowly kneels/);
  assert.match(compiled.prompt, /Jesus lifts his head/);
  assert.match(compiled.prompt, /low reverent choir/);
  assert.equal(compiled.timing.requestedFrames, 144);
});

test("official FL2VA template can be converted and patched by semantic slots", () => {
  const workflow = buildH3Workflow({
    objectInfo: fakeObjectInfo(),
    mode: H3_MODE_FIRST_LAST,
    promptText: "A clean test prompt.",
    width: 1344,
    height: 768,
    frames: 158,
    seed: 999,
    filenamePrefix: "premiere316/test/h3",
    firstFrameComfyFile: "first.png",
    lastFrameComfyFile: "last.png"
  });
  const h3 = workflow.prompt["104"];
  assert.equal(h3.class_type, "MiniMaxH3ImageToVideo");
  assert.equal(h3.inputs.prompt, "A clean test prompt.");
  assert.equal(h3.inputs.width, 1344);
  assert.equal(h3.inputs.height, 768);
  assert.equal(h3.inputs.length, 158);
  assert.deepEqual(h3.inputs.first_frame, ["p316_h3_first_frame", 0]);
  assert.deepEqual(h3.inputs.last_frame, ["p316_h3_last_frame", 0]);
  assert.equal(workflow.prompt.p316_h3_save.inputs.filename_prefix, "premiere316/test/h3");
});

test("official Ref2VA template can be patched with ordered reference tags", () => {
  const workflow = buildH3Workflow({
    objectInfo: fakeObjectInfo(),
    mode: H3_MODE_REFERENCE,
    promptText: "Use <Picture 1> for identity.",
    width: 1344,
    height: 768,
    frames: 158,
    seed: 222,
    filenamePrefix: "premiere316/test/h3-r2v",
    references: [{ type: "image", role: "identity", comfyFile: "first.png" }]
  });
  const h3 = workflow.prompt["136"];
  assert.equal(h3.class_type, "MiniMaxH3ReferenceToVideo");
  assert.deepEqual(h3.inputs["ref_images.ref_image_0"], ["p316_h3_ref_image_1", 0]);
  assert.equal(workflow.prompt["92"].inputs.filename_prefix, "premiere316/test/h3-r2v");
});
