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
