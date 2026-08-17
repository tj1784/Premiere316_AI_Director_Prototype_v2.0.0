import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const API_PATH = path.join(
  REPO_ROOT,
  "diagnostics",
  "ltx-identity-tuning",
  "garden-character-sheet-omninft-512-r25.api.json",
);
const REFERENCE_PATH = path.join(
  REPO_ROOT,
  "BlokeyUI",
  "ComfyUI",
  "input",
  "whatdreamscost",
  "jesus-character-sheet-1536x1024.v1.png",
);
const COMFY_URL = "http://127.0.0.1:8188";

const EXPECTED = {
  unet: "LTX\\2.3\\Director\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
  clips: [
    "gemma_3_12B_it_fp8_e4m3fn.safetensors",
    "ltx-2.3_text_projection_bf16.safetensors",
  ],
  vaes: ["LTX23_video_vae_bf16.safetensors", "LTX23_audio_vae_bf16.safetensors"],
  loras: [
    "LTX\\LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors",
    "faceID\\Best_FaceID_v1.0_LoRA.safetensors",
    "faceID\\Best_FaceID_CharacterSheet_v1.0_LoRA.safetensors",
  ],
  classes: [
    "UNETLoader",
    "LoraLoaderModelOnly",
    "DualCLIPLoader",
    "CLIPTextEncode",
    "LTXVConditioning",
    "EmptyLTXVLatentVideo",
    "VAELoaderKJ",
    "LTXVEmptyLatentAudio",
    "LTXVConcatAVLatent",
    "LoadImage",
    "LTXIdentityOverlapConditioning",
    "CFGGuider",
    "BasicScheduler",
    "RandomNoise",
    "KSamplerSelect",
    "SamplerCustomAdvanced",
    "LTXVSeparateAVLatent",
    "LTXVCropGuides",
    "VAEDecode",
    "VHS_VideoCombine",
  ],
};

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${route} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function choiceValues(objectInfo, classType, inputName) {
  const definition = objectInfo[classType]?.input?.required?.[inputName];
  if (Array.isArray(definition?.[0])) return definition[0];
  if (Array.isArray(definition?.[1]?.options)) return definition[1].options;
  return [];
}

function validateTopology(prompt) {
  const expectedClasses = {
    1: "UNETLoader",
    2: "LoraLoaderModelOnly",
    3: "LoraLoaderModelOnly",
    4: "LoraLoaderModelOnly",
    15: "LTXIdentityOverlapConditioning",
    20: "SamplerCustomAdvanced",
    22: "LTXVCropGuides",
    24: "VHS_VideoCombine",
  };
  for (const [id, classType] of Object.entries(expectedClasses)) {
    if (prompt[id]?.class_type !== classType) throw new Error(`API node ${id} must be ${classType}`);
  }
  const expectedChain = [["1", 0], ["2", 0], ["3", 0]];
  for (const [index, id] of ["2", "3", "4"].entries()) {
    if (JSON.stringify(prompt[id].inputs.model) !== JSON.stringify(expectedChain[index])) {
      throw new Error(`Model chain is broken at API node ${id}`);
    }
  }
  const identity = prompt["15"].inputs;
  if (JSON.stringify(identity.model) !== JSON.stringify(["4", 0])) throw new Error("Identity node does not use the full LoRA chain");
  if (JSON.stringify(identity.latent) !== JSON.stringify(["13", 0])) throw new Error("Identity node does not receive concatenated AV latent");
  if (identity.source_id !== 2 || identity.phase_scale !== 1 || identity.ref_resize_mode !== "native_resolution" || identity.layout !== "overlap" || identity.reference_guidance_scale !== 1) {
    throw new Error("CharacterSheet identity settings differ from the official recipe");
  }
  const target = prompt["9"].inputs;
  if (target.width !== 512 || target.height !== 512 || target.length !== 49 || target.batch_size !== 1) {
    throw new Error("Low-resolution target must be exactly 512x512x49 batch 1");
  }
  if (prompt["8"].inputs.frame_rate !== 24 || prompt["12"].inputs.frame_rate !== 24 || prompt["24"].inputs.frame_rate !== 24) {
    throw new Error("All frame-rate inputs must be exactly 24 fps");
  }
  if (prompt["16"].inputs.cfg !== 1 || prompt["17"].inputs.scheduler !== "linear_quadratic" || prompt["17"].inputs.steps !== 8 || prompt["19"].inputs.sampler_name !== "euler") {
    throw new Error("Sampler settings differ from CFG 1, Euler, linear_quadratic, 8 steps");
  }
}

async function preflight() {
  const [promptText, referenceStat, objectInfo, queue] = await Promise.all([
    fs.readFile(API_PATH, "utf8"),
    fs.stat(REFERENCE_PATH),
    requestJson("/object_info"),
    requestJson("/queue"),
  ]);
  const prompt = JSON.parse(promptText);
  validateTopology(prompt);
  for (const classType of EXPECTED.classes) {
    if (!objectInfo[classType]) throw new Error(`Live ComfyUI is missing ${classType}`);
  }
  const unets = choiceValues(objectInfo, "UNETLoader", "unet_name");
  if (!unets.includes(EXPECTED.unet)) throw new Error(`Live UNET selector is missing ${EXPECTED.unet}`);
  const loras = choiceValues(objectInfo, "LoraLoaderModelOnly", "lora_name");
  for (const lora of EXPECTED.loras) {
    if (!loras.includes(lora)) throw new Error(`Live LoRA selector is missing ${lora}`);
  }
  const clip1 = choiceValues(objectInfo, "DualCLIPLoader", "clip_name1");
  const clip2 = choiceValues(objectInfo, "DualCLIPLoader", "clip_name2");
  if (!clip1.includes(EXPECTED.clips[0]) || !clip2.includes(EXPECTED.clips[1])) {
    throw new Error("Live CLIP selectors do not expose the requested LTX 2.3 encoder pair");
  }
  const vaes = choiceValues(objectInfo, "VAELoaderKJ", "vae_name");
  for (const vae of EXPECTED.vaes) {
    if (!vaes.includes(vae)) throw new Error(`Live VAE selector is missing ${vae}`);
  }
  const referenceModes = choiceValues(objectInfo, "LTXIdentityOverlapConditioning", "ref_resize_mode");
  const layouts = objectInfo.LTXIdentityOverlapConditioning.input.optional.layout[0];
  const schedulers = choiceValues(objectInfo, "BasicScheduler", "scheduler");
  const samplers = choiceValues(objectInfo, "KSamplerSelect", "sampler_name");
  if (!referenceModes.includes("native_resolution") || !layouts.includes("overlap") || !schedulers.includes("linear_quadratic") || !samplers.includes("euler")) {
    throw new Error("Live identity/sampling dropdown values do not match the prepared API");
  }
  return {
    prompt,
    report: {
      status: "validated_not_queued",
      comfy_url: COMFY_URL,
      api_path: API_PATH,
      reference_path: REFERENCE_PATH,
      reference_bytes: referenceStat.size,
      node_count: Object.keys(prompt).length,
      live_classes_verified: EXPECTED.classes.length,
      selectors_verified: [EXPECTED.unet, ...EXPECTED.loras, ...EXPECTED.clips, ...EXPECTED.vaes],
      queue_running: queue.queue_running?.length ?? 0,
      queue_pending: queue.queue_pending?.length ?? 0,
    },
  };
}

async function submit() {
  const prepared = await preflight();
  if (prepared.report.queue_running || prepared.report.queue_pending) {
    throw new Error("ComfyUI 8188 is busy; refusing to mix this test into its queue");
  }
  const clientId = crypto.randomUUID();
  const response = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: prepared.prompt,
      client_id: clientId,
      extra_data: { comfy_usage_source: "premiere316_character_sheet_omninft_lowres_test" },
    }),
  });
  if (!response.prompt_id) throw new Error(`ComfyUI returned no prompt_id: ${JSON.stringify(response)}`);
  return { ...prepared.report, status: "submitted", prompt_id: response.prompt_id, client_id: clientId, node_errors: response.node_errors ?? {} };
}

async function status(promptId) {
  if (!promptId) throw new Error("status requires a prompt id");
  const [history, queue] = await Promise.all([
    requestJson(`/history/${encodeURIComponent(promptId)}`),
    requestJson("/queue"),
  ]);
  const entry = history[promptId];
  return {
    prompt_id: promptId,
    found: Boolean(entry),
    running: queue.queue_running?.some((item) => item?.[1] === promptId) ?? false,
    pending: queue.queue_pending?.some((item) => item?.[1] === promptId) ?? false,
    status: entry?.status ?? null,
    outputs: entry?.outputs ?? {},
  };
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  if (command === "preflight") {
    console.log(JSON.stringify((await preflight()).report, null, 2));
    return;
  }
  if (command === "submit") {
    console.log(JSON.stringify(await submit(), null, 2));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(await status(process.argv[3]), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
