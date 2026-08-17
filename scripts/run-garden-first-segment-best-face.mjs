import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const COMFY_ROOT = path.join(REPO_ROOT, "BlokeyUI", "ComfyUI");
const WORKFLOW_DIR = path.join(COMFY_ROOT, "user", "default", "workflows");
const DIAGNOSTICS_DIR = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");
const BASE_API = path.join(DIAGNOSTICS_DIR, "garden-ingredients-director-best-r18.api.json");
const BASE_UI = path.join(WORKFLOW_DIR, "GARDEN_identity_ingredients_fixed.json");
const ORIGINAL_UI = path.join(WORKFLOW_DIR, "GARDEN_identity_repaired (2).json");
const EXAMPLE_UI = path.join(
  COMFY_ROOT,
  "custom_nodes",
  "10S_Nodes",
  "workflows",
  "10Eros_10SNodes_I2V_FaceID_v2.json",
);
const COMFY_URL = "http://127.0.0.1:8188";
const FRAMES = 164;
const FPS = 25;
const DURATION_SECONDS = 6.54;
const WIDTH = 720;
const HEIGHT = 480;
const SEED = 488441818004763;
const PRIMARY_REFERENCE = "whatdreamscost/jesus-face-primary-trained-wide.v1.png";
const FACE_LORA = "faceID\\Best_FaceID_v1.0_LoRA.safetensors";
const OUTPUT_LABEL = "garden-first-segment-best-face-bfs-r23";
const WORKFLOW_NAME = "GARDEN_first_segment_best_face_fixed.json";
const IDENTITY_DESCRIPTOR = "The generated man is exactly the same olive-brown-skinned Middle Eastern man shown in the face reference: long angular oval face, deep-set hazel-brown eyes, strong narrow slightly convex nose, thick dark eyebrows, shoulder-length dense black corkscrew curls, and a dense tapered full black beard. Preserve those exact facial proportions, hairline, curl pattern, beard shape, eye color, and identity in every frame. ";

function clone(value) {
  return structuredClone(value);
}

function asInputs(node) {
  return Array.isArray(node.inputs) ? node.inputs : [];
}

function asOutputs(node) {
  return Array.isArray(node.outputs) ? node.outputs : [];
}

function getNode(workflow, id) {
  const node = workflow.nodes.find((candidate) => Number(candidate.id) === Number(id));
  if (!node) throw new Error(`UI node ${id} is missing`);
  return node;
}

function inputIndex(node, name) {
  const index = asInputs(node).findIndex((candidate) => candidate.name === name);
  if (index < 0) throw new Error(`UI node ${node.id} input ${name} is missing`);
  return index;
}

function rebuildConnectivity(workflow) {
  const nodes = new Map(workflow.nodes.map((node) => [Number(node.id), node]));
  workflow.links = workflow.links.filter((link) => {
    if (!Array.isArray(link) || link.length < 6) return false;
    const source = nodes.get(Number(link[1]));
    const target = nodes.get(Number(link[3]));
    return Boolean(source && target && asOutputs(source)[Number(link[2])] && asInputs(target)[Number(link[4])]);
  });
  for (const node of workflow.nodes) {
    for (const input of asInputs(node)) if (Object.hasOwn(input, "link")) input.link = null;
    for (const output of asOutputs(node)) if (Object.hasOwn(output, "links")) output.links = null;
  }
  for (const [linkId, sourceId, sourceSlot, targetId, targetSlot] of workflow.links) {
    const source = nodes.get(Number(sourceId));
    const target = nodes.get(Number(targetId));
    const output = asOutputs(source)[Number(sourceSlot)];
    const input = asInputs(target)[Number(targetSlot)];
    output.links = [...new Set([...(Array.isArray(output.links) ? output.links : []), Number(linkId)])];
    input.link = Number(linkId);
  }
  workflow.last_link_id = workflow.links.reduce((maximum, link) => Math.max(maximum, Number(link[0]) || 0), 0);
  workflow.last_node_id = workflow.nodes.reduce((maximum, node) => Math.max(maximum, Number(node.id) || 0), 0);
  return workflow;
}

function makeFirstSegmentTimeline(originalNode) {
  const timeline = JSON.parse(originalNode.widgets_values[6]);
  const sourceSegment = clone(timeline.segments[0]);
  if (!sourceSegment?.imageFile) throw new Error("The original first image segment is missing");
  const globalPrompt = String(timeline.global_prompt ?? originalNode.properties?.global_prompt ?? "").trim();
  timeline.mainTrackEnabled = true;
  timeline.audioTrackEnabled = true;
  timeline.motionTrackEnabled = false;
  timeline.overrideAudio = false;
  timeline.inpaint_audio = true;
  const cleanGlobalPrompt = globalPrompt.replace(/^ref_t2v:\s*/i, "");
  timeline.global_prompt = `ref_t2v: ${IDENTITY_DESCRIPTOR}${cleanGlobalPrompt}`;
  timeline.retake_global_prompt = "";
  timeline.retakeMode = false;
  timeline.retakeStart = 0;
  timeline.retakeLength = FRAMES;
  timeline.retakePrompt = "";
  timeline.retakeVideo = null;
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = FRAMES;
  timeline.segments = [{ ...sourceSegment, start: 0, length: FRAMES, isEndFrame: false }];
  timeline.motionSegments = [];
  timeline.audioSegments = [];
  return timeline;
}

function patchApi(baseApi, originalUi) {
  const prompt = clone(baseApi);
  const originalDirector = getNode(originalUi, 46);
  const timeline = makeFirstSegmentTimeline(originalDirector);
  const localPrompt = timeline.segments[0].prompt;

  Object.assign(prompt["46"].inputs, {
    start_second: 0,
    end_second: DURATION_SECONDS,
    duration_seconds: DURATION_SECONDS,
    start_frame: 0,
    end_frame: FRAMES,
    duration_frames: FRAMES,
    timeline_data: JSON.stringify(timeline),
    local_prompts: localPrompt,
    segment_lengths: String(FRAMES),
    epsilon: 0.99,
    guide_strength: "1.00",
    use_custom_audio: true,
    use_custom_motion: false,
    inpaint_audio: true,
    frame_rate: FPS,
    custom_width: WIDTH,
    custom_height: HEIGHT,
    resize_method: "maintain aspect ratio",
    divisible_by: 32,
    override_audio: false,
    queue_i2v_segments: false,
  });

  delete prompt["8"].inputs.motion_guide_data;
  delete prompt["8"].inputs.model;
  Object.assign(prompt["8"].inputs, {
    ic_lora_name: "None",
    ic_lora_strength: 0,
    scale_by: 1,
    image_attention_strength: 1,
    crop: "disabled",
  });
  prompt["9"].inputs.model = ["110", 0];
  prompt["9"].inputs.positive = ["110", 1];
  prompt["9"].inputs.negative = ["110", 2];
  prompt["9"].inputs.cfg = 1;
  prompt["11"].inputs.model = ["110", 0];
  prompt["11"].inputs.steps = 8;
  prompt["11"].inputs.denoise = 1;
  prompt["7"].inputs.video_latent = ["110", 3];
  prompt["28"].inputs.noise_seed = SEED;
  prompt["94"].inputs.filename_prefix = `identity_tests/${OUTPUT_LABEL}`;
  prompt["94"].inputs.save_metadata = true;

  prompt["107"] = {
    inputs: { image: PRIMARY_REFERENCE },
    class_type: "LoadImage",
    _meta: { title: "Best Face ID · Jesus primary 3/4 portrait" },
  };
  prompt["109"] = {
    inputs: { model: ["46", 0], lora_name: FACE_LORA, strength_model: 1 },
    class_type: "LoraLoaderModelOnly",
    _meta: { title: "Best Face ID · Load trained face LoRA" },
  };
  prompt["110"] = {
    inputs: {
      model: ["109", 0],
      positive: ["8", 0],
      negative: ["8", 1],
      vae: ["3", 0],
      latent: ["8", 2],
      reference_image: ["107", 0],
      source_id: 2,
      phase_scale: 1,
      ref_resize_mode: "match_target",
      debug_log: true,
      crop_anchor: "center",
      layout: "overlap",
      reference_guidance_scale: 2.5,
    },
    class_type: "LTXIdentityOverlapConditioning",
    _meta: { title: "Official BFS · LTX Identity Transfer" },
  };
  return prompt;
}

function patchUi(baseUi, originalUi, exampleUi, timeline) {
  const workflow = clone(baseUi);
  workflow.id = crypto.randomUUID();
  workflow.revision = 0;

  const originalDirector = clone(getNode(originalUi, 46));
  const originalGuide = clone(getNode(originalUi, 8));
  workflow.nodes = workflow.nodes.filter((node) => ![8, 46, 107, 108, 109, 110].includes(Number(node.id)));
  workflow.nodes.push(originalGuide, originalDirector);

  const director = getNode(workflow, 46);
  director.widgets_values = clone(getNode(originalUi, 46).widgets_values);
  Object.assign(director.widgets_values, {
    0: 0,
    1: DURATION_SECONDS,
    2: DURATION_SECONDS,
    3: 0,
    4: FRAMES,
    5: FRAMES,
    6: JSON.stringify(timeline),
    7: timeline.segments[0].prompt,
    8: String(FRAMES),
    9: 0.99,
    10: "1.00",
    11: true,
    12: false,
    13: true,
    14: FPS,
    15: "seconds",
    16: WIDTH,
    17: HEIGHT,
    18: "maintain aspect ratio",
    19: 32,
    20: 18,
    21: false,
    22: null,
    23: "",
  });
  Object.assign(director.properties, {
    global_prompt: timeline.global_prompt,
    mainTrackEnabled: true,
    audioTrackEnabled: true,
    motionTrackEnabled: false,
    inpaint_audio: true,
    use_custom_audio: true,
    use_custom_motion: false,
    frame_rate: FPS,
    custom_width: WIDTH,
    custom_height: HEIGHT,
    resize_method: "maintain aspect ratio",
    divisible_by: 32,
    guide_strength: "1.00",
    local_prompts: timeline.segments[0].prompt,
    segment_lengths: String(FRAMES),
    timeline_data: JSON.stringify(timeline),
  });
  director.title = "LTX Director · Garden first segment 0:00–0:06.54";

  const guide = getNode(workflow, 8);
  const motionInput = asInputs(guide).find((input) => input.name === "motion_guide_data");
  const modelInput = asInputs(guide).find((input) => input.name === "model");
  if (motionInput) motionInput.link = null;
  if (modelInput) modelInput.link = null;
  guide.widgets_values = ["None", 0, 1, "bicubic", 1, "disabled", true, false, 256, 64, false];
  guide.title = "LTX Director Guide · scene image only";

  const exampleLoad = clone(getNode(exampleUi, 837));
  const exampleLora = clone(getNode(exampleUi, 927));
  const exampleReinforcer = clone(getNode(exampleUi, 934));
  Object.assign(exampleLoad, {
    id: 107,
    pos: [3050, 3475],
    order: 17,
    title: "Best Face ID · Jesus primary 3/4 portrait",
    widgets_values: [PRIMARY_REFERENCE, "image"],
  });
  Object.assign(exampleLora, {
    id: 109,
    pos: [3290, 3475],
    order: 18,
    title: "Best Face ID · trained face LoRA",
    widgets_values: [FACE_LORA, 1],
  });
  Object.assign(exampleReinforcer, {
    id: 110,
    type: "LTXIdentityOverlapConditioning",
    pos: [3590, 3475],
    order: 19,
    title: "Official BFS · LTX Identity Transfer",
    inputs: [
      { name: "model", type: "MODEL", link: null },
      { name: "positive", type: "CONDITIONING", link: null },
      { name: "negative", type: "CONDITIONING", link: null },
      { name: "vae", type: "VAE", link: null },
      { name: "latent", type: "LATENT", link: null },
      { name: "reference_image", type: "IMAGE", link: null },
      { name: "source_id", type: "FLOAT", widget: { name: "source_id" }, link: null },
      { name: "phase_scale", type: "FLOAT", widget: { name: "phase_scale" }, link: null },
      { name: "ref_resize_mode", type: "COMBO", widget: { name: "ref_resize_mode" }, link: null },
      { name: "debug_log", type: "BOOLEAN", widget: { name: "debug_log" }, link: null },
      { name: "crop_anchor", type: "COMBO", widget: { name: "crop_anchor" }, link: null },
      { name: "layout", type: "COMBO", widget: { name: "layout" }, link: null },
      { name: "reference_guidance_scale", type: "FLOAT", widget: { name: "reference_guidance_scale" }, link: null },
    ],
    outputs: [
      { name: "model", type: "MODEL", links: null },
      { name: "positive", type: "CONDITIONING", links: null },
      { name: "negative", type: "CONDITIONING", links: null },
      { name: "latent", type: "LATENT", links: null },
      { name: "debug", type: "STRING", links: null },
      { name: "ref_preview", type: "IMAGE", links: null },
      { name: "crop_overlay", type: "IMAGE", links: null },
    ],
    properties: {
      cnr_id: "bfsnodes",
      ver: "1.15.0",
      "Node name for S&R": "LTXIdentityOverlapConditioning",
    },
    widgets_values: [2, 1, "match_target", true, "center", "overlap", 2.5],
  });
  workflow.nodes.push(exampleLoad, exampleLora, exampleReinforcer);

  const removedTargets = new Set([7, 8, 9, 11]);
  workflow.links = workflow.links.filter((link) => {
    const targetId = Number(link[3]);
    if (!removedTargets.has(targetId)) return true;
    const target = getNode(workflow, targetId);
    const input = asInputs(target)[Number(link[4])];
    return !["motion_guide_data", "model", "positive", "negative", "video_latent"].includes(input?.name);
  });

  let nextLink = workflow.links.reduce((maximum, link) => Math.max(maximum, Number(link[0]) || 0), 0) + 1;
  const addLink = (sourceId, sourceSlot, targetId, targetName, type) => {
    const target = getNode(workflow, targetId);
    workflow.links.push([nextLink++, sourceId, sourceSlot, targetId, inputIndex(target, targetName), type]);
  };
  addLink(46, 0, 109, "model", "MODEL");
  addLink(109, 0, 110, "model", "MODEL");
  addLink(8, 0, 110, "positive", "CONDITIONING");
  addLink(8, 1, 110, "negative", "CONDITIONING");
  addLink(3, 0, 110, "vae", "VAE");
  addLink(8, 2, 110, "latent", "LATENT");
  addLink(107, 0, 110, "reference_image", "IMAGE");
  addLink(110, 0, 9, "model", "MODEL");
  addLink(110, 1, 9, "positive", "CONDITIONING");
  addLink(110, 2, 9, "negative", "CONDITIONING");
  addLink(110, 0, 11, "model", "MODEL");
  addLink(110, 3, 7, "video_latent", "LATENT");

  getNode(workflow, 9).widgets_values = [1];
  getNode(workflow, 11).widgets_values = ["linear_quadratic", 8, 1];
  getNode(workflow, 28).widgets_values = [SEED, "fixed"];
  const output = getNode(workflow, 94);
  output.widgets_values.filename_prefix = `identity_tests/${OUTPUT_LABEL}`;
  delete output.widgets_values.videopreview;
  return rebuildConnectivity(workflow);
}

function validateApi(prompt) {
  const required = ["3", "8", "9", "10", "11", "46", "94", "95", "107", "109", "110"];
  for (const id of required) if (!prompt[id]) throw new Error(`API node ${id} is missing`);
  if (prompt["8"].inputs.model || prompt["8"].inputs.motion_guide_data) {
    throw new Error("Node 8 still contains the obsolete Ingredients model/motion path");
  }
  if (prompt["110"].class_type !== "LTXIdentityOverlapConditioning") {
    throw new Error("The official BFS identity-transfer node is not present");
  }
  if (JSON.stringify(prompt["9"].inputs.model) !== JSON.stringify(["110", 0])) {
    throw new Error("CFGGuider does not use the reinforced model");
  }
  if (JSON.stringify(prompt["11"].inputs.model) !== JSON.stringify(["110", 0])) {
    throw new Error("Scheduler does not use the reinforced model");
  }
  if (JSON.stringify(prompt["9"].inputs.positive) !== JSON.stringify(["110", 1]) ||
      JSON.stringify(prompt["9"].inputs.negative) !== JSON.stringify(["110", 2])) {
    throw new Error("Sampler conditioning does not pass through the official BFS node");
  }
  if (JSON.stringify(prompt["7"].inputs.video_latent) !== JSON.stringify(["110", 3])) {
    throw new Error("Sampler latent does not pass through the official BFS node");
  }
  const timeline = JSON.parse(prompt["46"].inputs.timeline_data);
  if (timeline.segments.length !== 1 || timeline.segments[0].start !== 0 || timeline.segments[0].length !== FRAMES) {
    throw new Error("The first-segment timeline was not trimmed correctly");
  }
  if (!timeline.segments[0].imageFile?.endsWith("12_36_25 AM (1).png")) {
    throw new Error("The real Garden first-frame image is not present");
  }
  if (timeline.motionSegments.length !== 0 || timeline.motionTrackEnabled) {
    throw new Error("The obsolete Ingredients motion sheet is still active");
  }
}

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${route} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function prepare() {
  const [apiText, baseUiText, originalUiText, exampleUiText] = await Promise.all([
    fs.readFile(BASE_API, "utf8"),
    fs.readFile(BASE_UI, "utf8"),
    fs.readFile(ORIGINAL_UI, "utf8"),
    fs.readFile(EXAMPLE_UI, "utf8"),
  ]);
  const baseApi = JSON.parse(apiText);
  const baseUi = JSON.parse(baseUiText);
  const originalUi = JSON.parse(originalUiText);
  const exampleUi = JSON.parse(exampleUiText);
  const timeline = makeFirstSegmentTimeline(getNode(originalUi, 46));
  const api = patchApi(baseApi, originalUi);
  const ui = patchUi(baseUi, originalUi, exampleUi, timeline);
  validateApi(api);
  const apiPath = path.join(DIAGNOSTICS_DIR, `${OUTPUT_LABEL}.api.json`);
  const workflowPath = path.join(WORKFLOW_DIR, WORKFLOW_NAME);
  const manifestPath = path.join(DIAGNOSTICS_DIR, `${OUTPUT_LABEL}.manifest.json`);
  const manifest = {
    created_at: new Date().toISOString(),
    comfy_url: COMFY_URL,
    segment: { start_seconds: 0, end_seconds: DURATION_SECONDS, frames: FRAMES, fps: FPS },
    requested_resolution: { width: WIDTH, height: HEIGHT, resize_method: "maintain aspect ratio" },
    scene_image: timeline.segments[0].imageFile,
    identity_reference: PRIMARY_REFERENCE,
    identity_lora: FACE_LORA,
    identity_node: "LTXIdentityOverlapConditioning",
    reference_resize_mode: "match_target",
    reference_guidance_scale: 2.5,
    reference_preparation: "950px square face-and-hair crop, Lanczos-fit to 288px, centered without distortion on an exact 704x288 bucket",
    lora_strength: 1,
    cfg: 1,
    steps: 8,
    seed: SEED,
    output_prefix: `identity_tests/${OUTPUT_LABEL}`,
    api_prompt: apiPath,
    workflow: workflowPath,
  };
  await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(apiPath, `${JSON.stringify(api, null, 2)}\n`, "utf8"),
    fs.writeFile(workflowPath, `${JSON.stringify(ui, null, 2)}\n`, "utf8"),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ]);
  return { api, ui, manifest, manifestPath };
}

async function submit(prepared) {
  const queue = await requestJson("/queue");
  if ((queue.queue_running?.length ?? 0) || (queue.queue_pending?.length ?? 0)) {
    throw new Error("ComfyUI 8188 is busy; refusing to mix this render into its queue");
  }
  const clientId = crypto.randomUUID();
  const response = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: prepared.api,
      client_id: clientId,
      extra_data: {
        comfy_usage_source: "premiere316_garden_first_segment_best_face",
        extra_pnginfo: { workflow: prepared.ui },
      },
    }),
  });
  if (!response.prompt_id) throw new Error(`ComfyUI returned no prompt_id: ${JSON.stringify(response)}`);
  const runPath = path.join(DIAGNOSTICS_DIR, `${OUTPUT_LABEL}.run.json`);
  const run = {
    ...prepared.manifest,
    submitted_at: new Date().toISOString(),
    prompt_id: response.prompt_id,
    queue_number: response.number,
    client_id: clientId,
    node_errors: response.node_errors ?? {},
  };
  await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return { ...run, run_manifest: runPath };
}

async function status(promptId) {
  const [history, queue] = await Promise.all([
    requestJson(`/history/${encodeURIComponent(promptId)}`),
    requestJson("/queue"),
  ]);
  const entry = history[promptId];
  const outputs = [];
  for (const [nodeId, nodeOutput] of Object.entries(entry?.outputs ?? {})) {
    for (const kind of ["gifs", "videos", "images", "audio"]) {
      for (const item of nodeOutput?.[kind] ?? []) outputs.push({ node_id: nodeId, kind, ...item });
    }
  }
  return {
    prompt_id: promptId,
    found: Boolean(entry),
    running: queue.queue_running?.some((item) => item?.[1] === promptId) ?? false,
    pending: queue.queue_pending?.some((item) => item?.[1] === promptId) ?? false,
    status: entry?.status ?? null,
    outputs,
  };
}

async function main() {
  const command = process.argv[2] ?? "prepare";
  if (command === "status") {
    const promptId = process.argv[3];
    if (!promptId) throw new Error("status requires a prompt id");
    console.log(JSON.stringify(await status(promptId), null, 2));
    return;
  }
  const prepared = await prepare();
  if (command === "prepare") {
    console.log(JSON.stringify(prepared.manifest, null, 2));
    return;
  }
  if (command !== "submit") throw new Error(`Unknown command: ${command}`);
  console.log(JSON.stringify(await submit(prepared), null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
