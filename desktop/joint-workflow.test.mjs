import test from "node:test";
import assert from "node:assert/strict";
import { compileJointWorkflow } from "./joint-workflow.mjs";
import { createDirectorExecutionService } from "./director-execution.mjs";
const node = (class_type, inputs) => ({ class_type, inputs });
function fixture() {
  const prompt = {
    model: node("UNETLoader", { unet_name: "minimax_h3_ref2va_bf16.safetensors" }),
    clip: node("CLIPLoader", { clip_name: "clip" }),
    vae: node("VAELoader", { vae_name: "vae" }),
    audioVae: node("VAELoader", { vae_name: "audio" }),
    image: node("LoadImage", { image: "approved.png" }),
    voice: node("LoadAudio", { audio: "approved.wav" }),
    ref: node("MiniMaxH3ReferenceToVideo", {
      clip: ["clip", 0],
      vae: ["vae", 0],
      audio_vae: ["audioVae", 0],
      prompt: "Exact dialogue",
      length: 124,
      "ref_images.ref_image_0": ["image", 0],
      "ref_audios.ref_audio_0": ["voice", 0],
    }),
    sample: node("KSampler", {
      model: ["model", 0],
      positive: ["ref", 0],
      latent_image: ["ref", 1],
      seed: 42,
    }),
    decode: node("DecodeAV", { samples: ["sample", 0] }),
    video: node("CreateVideo", { images: ["decode", 0], audio: ["decode", 1] }),
    save: node("SaveVideo", { video: ["video", 0] }),
  };
  const schema = (required, output) => ({ input: { required }, output });
  const grow = (prefix, type, max) => [
    "COMFY_AUTOGROW_V3",
    { template: { prefix, max, input: { required: { ref: [type, {}] } } } },
  ];
  const info = {
    UNETLoader: schema(
      { unet_name: [["minimax_h3_ref2va_bf16.safetensors", "minimax_h3_fl2va_bf16.safetensors"]] },
      ["MODEL"],
    ),
    CLIPLoader: schema({ clip_name: [["clip"]] }, ["CLIP"]),
    VAELoader: schema({ vae_name: [["vae", "audio"]] }, ["VAE"]),
    LoadImage: schema({ image: [["approved.png"]] }, ["IMAGE"]),
    LoadAudio: schema({ audio: [["approved.wav"]] }, ["AUDIO"]),
    MiniMaxH3ReferenceToVideo: {
      ...schema(
        {
          clip: ["CLIP"],
          vae: ["VAE"],
          audio_vae: ["VAE"],
          prompt: ["STRING"],
          length: ["INT", { min: 5, max: 3600 }],
        },
        ["CONDITIONING", "LATENT"],
      ),
      input: {
        required: {
          clip: ["CLIP"],
          vae: ["VAE"],
          audio_vae: ["VAE"],
          prompt: ["STRING"],
          length: ["INT"],
        },
        optional: {
          ref_images: grow("ref_image_", "IMAGE", 9),
          ref_audios: grow("ref_audio_", "AUDIO", 3),
        },
      },
    },
    KSampler: schema(
      { model: ["MODEL"], positive: ["CONDITIONING"], latent_image: ["LATENT"], seed: ["INT"] },
      ["LATENT"],
    ),
    DecodeAV: schema({ samples: ["LATENT"] }, ["IMAGE", "AUDIO"]),
    CreateVideo: schema({ images: ["IMAGE"], audio: ["AUDIO"] }, ["VIDEO"]),
    SaveVideo: schema({ video: ["VIDEO"] }, []),
  };
  return {
    workflow: { nodes: Object.keys(prompt).map((id) => ({ id })), joint: { prompt } },
    info,
  };
}
test("live-schema validator requires Ref2VA, valid sockets and joint audio/video from the same sampler", () => {
  const { workflow, info } = fixture();
  assert.deepEqual(compileJointWorkflow(workflow, info).issues, []);
  const wrong = structuredClone(workflow);
  wrong.joint.prompt.model.inputs.unet_name = "minimax_h3_fl2va_bf16.safetensors";
  assert.match(compileJointWorkflow(wrong, info).issues.join(" "), /Ref2VA model/);
  const soundtrack = structuredClone(workflow);
  soundtrack.joint.prompt.video.inputs.audio = ["voice", 0];
  assert.match(compileJointWorkflow(soundtrack, info).issues.join(" "), /same Ref2VA sampler/);
  const broken = structuredClone(workflow);
  broken.joint.prompt.ref.inputs["ref_audios.ref_audio_0"] = ["image", 0];
  assert.match(compileJointWorkflow(broken, info).issues.join(" "), /Wrong socket/);
  const tts = structuredClone(workflow);
  tts.joint.prompt.tts = node("Qwen3TTS", {});
  assert.throws(() => compileJointWorkflow(tts, info), /Separate TTS/);
});
test("joint path reuses immutable review and idempotent job infrastructure, using the explicit H3 endpoint", async () => {
  const { workflow, info } = fixture();
  let posted = 0;
  const requests = [];
  let preparation = 0;
  const service = createDirectorExecutionService({
    endpoint: "http://127.0.0.1:8191",
    ensureHost: async () => {},
    openWorkflow: async () => false,
    compile: compileJointWorkflow,
    prepareWorkflow: async (w) => {
      preparation++;
      return w;
    },
    fetchImpl: async (url, options) => {
      requests.push(url);
      if (url.endsWith("/object_info")) return Response.json(info);
      if (url.endsWith("/prompt")) {
        posted++;
        const body = JSON.parse(options.body);
        assert.deepEqual(body.prompt, workflow.joint.prompt);
        return Response.json({ prompt_id: body.prompt_id });
      }
      throw new Error("Unexpected request");
    },
  });
  const review = await service.review({
    pictureId: "p",
    sceneId: "s",
    workflowJson: JSON.stringify(workflow),
  });
  assert.equal(review.ok, true);
  assert.equal(posted, 0);
  const a = await service.run(review.reviewId),
    b = await service.run(review.reviewId);
  assert.equal(a.ok, true);
  assert.equal(a.promptId, b.promptId);
  assert.equal(posted, 1);
  assert.equal(preparation, 1);
  assert.ok(requests.every((url) => url.startsWith("http://127.0.0.1:8191/")));
});

test("latent-only Ref2VA ancestry never proves positive conditioning", () => {
  const { workflow, info } = fixture(),
    p = workflow.joint.prompt;
  info.OtherConditioning = { input: { required: {} }, output: ["CONDITIONING"] };
  p.other = node("OtherConditioning", {});
  p.sample.inputs.positive = ["other", 0];
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /positive conditioning/);
  p.sample.inputs.positive = ["ref", 1];
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /positive conditioning/);
});
test("custom sampling validates the guider positive path, not negative or latent ancestry", () => {
  const { workflow, info } = fixture(),
    p = workflow.joint.prompt;
  info.CFGGuider = {
    input: {
      required: { model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"] },
    },
    output: ["GUIDER"],
  };
  info.SamplerCustomAdvanced = {
    input: { required: { guider: ["GUIDER"], latent_image: ["LATENT"] } },
    output: ["LATENT"],
  };
  info.OtherConditioning = { input: { required: {} }, output: ["CONDITIONING"] };
  p.other = node("OtherConditioning", {});
  p.guider = node("CFGGuider", {
    model: ["model", 0],
    positive: ["ref", 0],
    negative: ["other", 0],
  });
  p.sample = node("SamplerCustomAdvanced", { guider: ["guider", 0], latent_image: ["ref", 1] });
  assert.deepEqual(compileJointWorkflow(workflow, info).issues, []);
  p.guider.inputs.positive = ["other", 0];
  p.guider.inputs.negative = ["ref", 0];
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /positive conditioning/);
});
test("VHS encoder widgets belong only to the selected advertised format", () => {
  const { workflow, info } = fixture(),
    p = workflow.joint.prompt;
  delete p.video;
  delete p.save;
  info.VHS_VideoCombine = {
    input: {
      required: {
        images: ["IMAGE"],
        audio: ["AUDIO"],
        save_output: ["BOOLEAN"],
        format: [
          ["video/h264-mp4", "video/other"],
          {
            formats: {
              "video/h264-mp4": [
                ["crf", "INT", { min: 0, max: 100 }],
                ["pix_fmt", ["yuv420p", "yuv420p10le"]],
                ["save_metadata", "BOOLEAN", {}],
              ],
            },
          },
        ],
      },
    },
    output: [],
  };
  p.save = node("VHS_VideoCombine", {
    images: ["decode", 0],
    audio: ["decode", 1],
    save_output: true,
    format: "video/h264-mp4",
    crf: 19,
    pix_fmt: "yuv420p",
    save_metadata: true,
  });
  assert.deepEqual(compileJointWorkflow(workflow, info).issues, []);
  p.save.inputs.crf = 101;
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /Invalid number/);
  p.save.inputs.crf = 19;
  p.save.inputs.format = "video/other";
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /Unsupported input/);
});

test("every saved branch must validate, regardless of an earlier valid output", async () => {
  for (const invalidFirst of [false, true]) {
    const { workflow, info } = fixture(),
      p = workflow.joint.prompt;
    info.OtherConditioning = { input: { required: {} }, output: ["CONDITIONING"] };
    p.other = node("OtherConditioning", {});
    p.badSampler = node("KSampler", { ...p.sample.inputs, positive: ["other", 0] });
    p.badDecode = node("DecodeAV", { samples: ["badSampler", 0] });
    p.badVideo = node("CreateVideo", { images: ["badDecode", 0], audio: ["badDecode", 1] });
    p.badSave = node("SaveVideo", { video: ["badVideo", 0] });
    if (invalidFirst) workflow.joint.prompt = Object.fromEntries(Object.entries(p).reverse());
    assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /Video output badSave/);
    let submitted = 0;
    const service = createDirectorExecutionService({
      compile: compileJointWorkflow,
      ensureHost: async () => {},
      openWorkflow: async () => false,
      fetchImpl: async (url) => {
        if (url.endsWith("/object_info")) return Response.json(info);
        submitted++;
        throw new Error("Must not submit");
      },
    });
    const review = await service.review({
      pictureId: "p",
      sceneId: "s",
      workflowJson: JSON.stringify(workflow),
    });
    assert.equal(review.ok, true);
    assert.ok(review.issues.length);
    assert.equal((await service.run(review.reviewId)).ok, false);
    assert.equal(submitted, 0);
  }
  const { workflow, info } = fixture();
  workflow.joint.prompt.secondSave = node("SaveVideo", { video: ["video", 0] });
  assert.deepEqual(compileJointWorkflow(workflow, info).issues, []);
});

test("valid SaveVideo cannot mask invalid VHS or unknown executable outputs", () => {
  const { workflow, info } = fixture(),
    p = workflow.joint.prompt;
  info.VHS_VideoCombine = {
    input: { required: { images: ["IMAGE"], audio: ["AUDIO"], save_output: ["BOOLEAN"] } },
    output: [],
    output_node: true,
  };
  p.vhs = node("VHS_VideoCombine", {
    images: ["decode", 0],
    audio: ["voice", 0],
    save_output: true,
  });
  assert.match(compileJointWorkflow(workflow, info).issues.join(" "), /Video output vhs/);
  p.vhs.inputs.audio = ["decode", 1];
  assert.deepEqual(compileJointWorkflow(workflow, info).issues, []);
  info.CustomSaveVideo = {
    input: { required: { video: ["VIDEO"] } },
    output: [],
    output_node: true,
  };
  p.unknown = node("CustomSaveVideo", { video: ["video", 0] });
  assert.match(
    compileJointWorkflow(workflow, info).issues.join(" "),
    /Unsupported submitted output unknown/,
  );
});
