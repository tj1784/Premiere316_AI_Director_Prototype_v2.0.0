import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const COMFY_URL = "http://127.0.0.1:8188";
const DIAGNOSTICS = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");
const OUTPUT_LABEL = "identity_tests/garden-character-sheet-t2v-r25";
const SHEET = "whatdreamscost/jesus-character-sheet-1536x1024.v1.png";
const SEED = 488441818004763;

const POSITIVE = `ref_t2v: A photorealistic olive-brown-skinned Middle Eastern adult man with a long angular oval face, deep-set hazel-brown eyes, a strong narrow slightly convex nose, thick dark eyebrows, shoulder-length dense black corkscrew curls, and a dense tapered full black beard, with a lean build, wearing an off-white draped linen robe tied with a narrow brown rope belt, stands alone at night in the Garden of Gethsemane. Preserve his exact facial proportions, hairline, curl pattern, beard shape, eye color, skin tone, robe construction, and identity in every frame. Ancient gnarled olive trees, exposed silver-gray roots, dark earth, scattered limestone, sparse grass, cool blue-silver moonlight, and a faint warm glow from distant Jerusalem surround him. Medium close shot, front-left three-quarter view, his face large and clearly visible. He takes two slow burdened steps, stops, tightens his fingers around the robe, lowers his gaze, closes his eyes, and begins to kneel. Slow restrained lateral camera movement, realistic breathing, subtle wind moving individual curls and robe folds, cinematic live-action biblical drama, natural skin texture, physically realistic motion, no cut and no transition.`;

const NEGATIVE = "different person, different actor, identity drift, face morphing, changing facial proportions, changing eye color, changing skin tone, changing age, short hair, straight hair, light hair, sparse beard, shaved face, duplicate person, extra person, multiple men, character sheet, collage, split screen, multiple panels, tiled image, panel border, distorted face, deformed eyes, warped mouth, blurry face, obscured face, costume change, modern clothing, armor, crown, halo, abrupt cut, dissolve, scene transition, flicker, jitter, text, subtitle, logo, watermark, worst quality, low quality";

const prompt = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "ltx2\\ltx-2.3-22b-distilled-1.1-fp8.safetensors", weight_dtype: "default" } },
  "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "LTX\\LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors", strength_model: 1 } },
  "3": { class_type: "LoraLoaderModelOnly", inputs: { model: ["2", 0], lora_name: "faceID\\Best_FaceID_v1.0_LoRA.safetensors", strength_model: 0.2 } },
  "4": { class_type: "LoraLoaderModelOnly", inputs: { model: ["3", 0], lora_name: "faceID\\Best_FaceID_CharacterSheet_v1.0_LoRA.safetensors", strength_model: 1 } },
  "5": { class_type: "DualCLIPLoader", inputs: { clip_name1: "gemma_3_12B_it_fp8_e4m3fn.safetensors", clip_name2: "ltx-2.3_text_projection_bf16.safetensors", type: "ltxv", device: "default" } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["5", 0], text: POSITIVE } },
  "7": { class_type: "CLIPTextEncode", inputs: { clip: ["5", 0], text: NEGATIVE } },
  "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: 24 } },
  "9": { class_type: "VAELoaderKJ", inputs: { vae_name: "LTX23_video_vae_bf16.safetensors", device: "main_device", weight_dtype: "bf16" } },
  "10": { class_type: "VAELoaderKJ", inputs: { vae_name: "LTX23_audio_vae_bf16.safetensors", device: "main_device", weight_dtype: "bf16" } },
  "11": { class_type: "EmptyLTXVLatentVideo", inputs: { width: 512, height: 512, length: 49, batch_size: 1 } },
  "12": { class_type: "LTXVEmptyLatentAudio", inputs: { frames_number: 49, frame_rate: 24, batch_size: 1, audio_vae: ["10", 0] } },
  "13": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["11", 0], audio_latent: ["12", 0] } },
  "14": { class_type: "LoadImage", inputs: { image: SHEET } },
  "15": { class_type: "LTXIdentityOverlapConditioning", inputs: { model: ["4", 0], positive: ["8", 0], negative: ["8", 1], vae: ["9", 0], latent: ["13", 0], reference_image: ["14", 0], source_id: 2, phase_scale: 1, ref_resize_mode: "native_resolution", debug_log: true, crop_anchor: "center", layout: "overlap", reference_guidance_scale: 1 } },
  "16": { class_type: "CFGGuider", inputs: { model: ["15", 0], positive: ["15", 1], negative: ["15", 2], cfg: 1 } },
  "17": { class_type: "BasicScheduler", inputs: { model: ["15", 0], scheduler: "linear_quadratic", steps: 8, denoise: 1 } },
  "18": { class_type: "RandomNoise", inputs: { noise_seed: SEED } },
  "19": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  "20": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["18", 0], guider: ["16", 0], sampler: ["19", 0], sigmas: ["17", 0], latent_image: ["15", 3] } },
  "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["20", 0] } },
  "22": { class_type: "VAEDecode", inputs: { samples: ["21", 0], vae: ["9", 0] } },
  "23": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["10", 0] } },
  "24": { class_type: "VHS_VideoCombine", inputs: { images: ["22", 0], audio: ["23", 0], frame_rate: 24, loop_count: 0, filename_prefix: OUTPUT_LABEL, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  "25": { class_type: "PreviewImage", inputs: { images: ["15", 5] } },
};

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${route}: ${response.status} ${text}`);
  return body;
}

async function prepare() {
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  const apiPath = path.join(DIAGNOSTICS, "garden-character-sheet-t2v-r25.api.json");
  const manifestPath = path.join(DIAGNOSTICS, "garden-character-sheet-t2v-r25.manifest.json");
  const manifest = {
    created_at: new Date().toISOString(),
    comfy_url: COMFY_URL,
    mode: "reference-to-video identity benchmark; no I2V scene guide",
    requested: { width: 512, height: 512, frames: 49, fps: 24, steps: 8, cfg: 1, sampler: "euler", scheduler: "linear_quadratic" },
    base_model: prompt["1"].inputs.unet_name,
    loras: [
      { selector: prompt["2"].inputs.lora_name, strength: 1 },
      { selector: prompt["3"].inputs.lora_name, strength: 0.2 },
      { selector: prompt["4"].inputs.lora_name, strength: 1 },
    ],
    reference: SHEET,
    reference_mode: "native_resolution",
    seed: SEED,
    output_prefix: OUTPUT_LABEL,
    api_prompt: apiPath,
  };
  await Promise.all([
    fs.writeFile(apiPath, `${JSON.stringify(prompt, null, 2)}\n`, "utf8"),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ]);
  return { apiPath, manifestPath, manifest };
}

async function main() {
  const command = process.argv[2] ?? "prepare";
  const prepared = await prepare();
  if (command === "prepare") {
    console.log(JSON.stringify(prepared, null, 2));
    return;
  }
  if (command === "status") {
    const promptId = process.argv[3];
    if (!promptId) throw new Error("status requires a prompt id");
    const [history, queue] = await Promise.all([requestJson(`/history/${promptId}`), requestJson("/queue")]);
    console.log(JSON.stringify({ prompt_id: promptId, entry: history[promptId] ?? null, queue }, null, 2));
    return;
  }
  if (command !== "submit") throw new Error(`unknown command: ${command}`);
  const queue = await requestJson("/queue");
  if ((queue.queue_running?.length ?? 0) || (queue.queue_pending?.length ?? 0)) throw new Error("ComfyUI 8188 is busy");
  const clientId = crypto.randomUUID();
  const result = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId, extra_data: { comfy_usage_source: "premiere316_character_sheet_identity_benchmark" } }),
  });
  const run = { ...prepared.manifest, submitted_at: new Date().toISOString(), prompt_id: result.prompt_id, queue_number: result.number, client_id: clientId, node_errors: result.node_errors ?? {} };
  const runPath = path.join(DIAGNOSTICS, "garden-character-sheet-t2v-r25.run.json");
  await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...run, run_manifest: runPath }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
