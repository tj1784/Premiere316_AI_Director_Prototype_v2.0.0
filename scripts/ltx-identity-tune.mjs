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
const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
const DEFAULT_SOURCE_HISTORY = "9030d9b9-7823-47cc-b7dd-36f717c2f44b";
const CACHED_SOURCE_API = path.join(DIAGNOSTICS_DIR, "garden-face-p075-p055.api.json");
const CACHED_FULL_UI = path.join(WORKFLOW_DIR, "GARDEN_identity_repaired.json");
const IDENTITY_IMAGE = "whatdreamscost/char-jesus-close.v3.png";
const INGREDIENTS_LORA =
  "LTX\\2.3\\Official\\IC-LoRA\\Ingredients\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";
const IDENTITY_IMAGE_VIEW =
  "/api/view?filename=char-jesus-close.v3.png&type=input&subfolder=whatdreamscost";
const IDENTITY_VALIDATION_PROMPT = `Intimate 85mm close-up of the exact same man in the supplied identity portrait, from the same front-left three-quarter angle. Preserve his exact facial geometry, deep brown eyes, eyebrow shape, nose, lips, cheekbones, jaw, hairline, long dark curly hair, and dense black beard. Preserve the portrait's natural skin detail and distinguishing marks.

He remains almost still, breathing naturally, with one subtle blink and minute eye movement. Static camera, no cut, no reframing, no speech, and no mouth opening. Warm amber rim light and cool moonlit garden bokeh may change the lighting, but never the actor's identity.

No other person, duplicate face, morph, age change, hairstyle change, beard change, identity drift, text, caption, subtitle, logo, or camera transition.`;
const NEGATIVE_PROMPT = `worst quality, low quality, inconsistent identity, different actor, face drift, facial morphing, changing facial structure, changing eye color, changing skin tone, changing age, changing hairline, short hair, straight hair, blond hair, brown hair, changing hairstyle, changing beard shape, shaved face, duplicate character, multiple men, extra people, clone, contact sheet, reference board, multi-panel grid, split screen, collage, tiled image, panel border, duplicated subject, distorted face, deformed face, asymmetrical eyes, warped mouth, blurry face, obscured face, poorly detailed face, costume change, modern clothing, armor, crown, glowing halo, extra limbs, malformed hands, flickering, jittery motion, inconsistent motion, abrupt camera movement, jump cut, scene transition, text, subtitles, logo, watermark`;
const INGREDIENTS_SHEET_IMAGE =
  "whatdreamscost/ChatGPT Image Aug 11, 2026, 02_33_01 AM.png";
const INGREDIENTS_SHEET_VIEW =
  "/api/view?filename=ChatGPT%20Image%20Aug%2011%2C%202026%2C%2002_33_01%20AM.png&type=input&subfolder=whatdreamscost";
const INGREDIENTS_VALIDATION_PROMPT = `Reference sheet: One consistent adult Middle Eastern man portraying Jesus is shown in the supplied character sheet. He has olive-brown skin, deep brown eyes, a long straight nose, strong cheekbones, an angular jaw, thick dark eyebrows, shoulder-length wet black curls, and a dense black beard with the exact same hairline, beard outline, facial proportions, and white linen robe in every view. Treat every panel as reference material only; never reproduce the collage layout, panel boundaries, or multiple copies of the man.

Generated video: A photorealistic live-action 85mm medium close-up of that exact same man alone in the moonlit Garden of Gethsemane, framed from upper chest to the top of his hair. He faces front-left at a gentle three-quarter angle, matching the dominant close-up in the reference sheet. He remains almost still, breathes naturally, makes one subtle blink, and shifts his eyes slightly without turning away. Preserve the exact face, eyes, nose, lips, cheekbones, jaw, hairline, long dark curls, dense black beard, olive-brown skin, and white linen robe throughout every frame. Cool blue moonlight, restrained warm rim light, softly blurred olive trees, realistic pores and beard detail, static camera, no cut, no reframing, no speech, one person only. Exclude identity drift, face morphing, changing age, changing hair or beard, duplicate people, collage panels, split screen, text, logo, halo, crown, wounds, armor, modern clothing, abrupt motion, and camera transitions.`;

function parseArgs(argv) {
  const [command = "prepare", ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return { command, values };
}

function numberArg(values, key, fallback) {
  if (values[key] === undefined) return fallback;
  const value = Number(values[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be numeric`);
  return value;
}

function boolArg(values, key, fallback) {
  if (values[key] === undefined) return fallback;
  if (values[key] === true) return true;
  if (["1", "true", "yes", "on"].includes(String(values[key]).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(values[key]).toLowerCase())) return false;
  throw new Error(`--${key} must be true or false`);
}

function sanitizeLabel(value) {
  const label = String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!label) throw new Error("The run label cannot be empty");
  return label;
}

function clone(value) {
  return structuredClone(value);
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = { raw: body };
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${route} returned ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function loadSource(baseUrl, promptId) {
  const history = await requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`);
  const entry = history[promptId];
  if (!entry) {
    try {
      const [apiText, workflowText] = await Promise.all([
        fs.readFile(CACHED_SOURCE_API, "utf8"),
        fs.readFile(CACHED_FULL_UI, "utf8"),
      ]);
      return {
        apiPrompt: JSON.parse(apiText),
        uiWorkflow: JSON.parse(workflowText),
        entry: null,
        recoveredFrom: "local-cache-after-comfy-restart",
      };
    } catch (fallbackError) {
      throw new Error(
        `History prompt ${promptId} was not found on ${baseUrl}, and the local source cache could not be read: ${fallbackError.message}`,
      );
    }
  }
  if (!entry.prompt?.[2]) throw new Error(`History prompt ${promptId} does not contain an API graph`);
  const workflow = entry.prompt?.[3]?.extra_pnginfo?.workflow;
  if (!workflow) throw new Error(`History prompt ${promptId} does not contain its UI workflow`);
  return { apiPrompt: clone(entry.prompt[2]), uiWorkflow: clone(workflow), entry };
}

function getNode(workflow, id) {
  const node = workflow.nodes.find((candidate) => Number(candidate.id) === Number(id));
  if (!node) throw new Error(`UI workflow node ${id} is missing`);
  return node;
}

function asOutputs(node) {
  return Array.isArray(node.outputs) ? node.outputs : [node.outputs];
}

function asInputs(node) {
  return Array.isArray(node.inputs) ? node.inputs : [node.inputs];
}

function outputAt(workflow, nodeId, outputIndex) {
  const output = asOutputs(getNode(workflow, nodeId))[outputIndex];
  if (!output) throw new Error(`UI workflow node ${nodeId} output ${outputIndex} is missing`);
  return output;
}

function inputNamed(workflow, nodeId, name) {
  const input = asInputs(getNode(workflow, nodeId)).find((candidate) => candidate.name === name);
  if (!input) throw new Error(`UI workflow node ${nodeId} input ${name} is missing`);
  return input;
}

function removeOutputLinks(output, ids) {
  const existing = Array.isArray(output.links) ? output.links : [];
  output.links = existing.filter((id) => !ids.includes(Number(id)));
  if (output.links.length === 0) output.links = null;
}

function appendOutputLinks(output, ids) {
  const existing = Array.isArray(output.links) ? output.links : [];
  output.links = [...new Set([...existing, ...ids])];
}

function addNegativePromptToUi(workflow) {
  const negativeNode = getNode(workflow, 26);
  const clipLinkIndex = workflow.links.findIndex((link) => Number(link?.[0]) === 117);
  if (clipLinkIndex < 0) throw new Error("UI workflow link 117 for negative conditioning is missing");

  removeOutputLinks(outputAt(workflow, 46, 1), [117]);
  appendOutputLinks(outputAt(workflow, 84, 0), [117]);
  workflow.links[clipLinkIndex] = [117, 84, 0, 26, 0, "CLIP"];
  Object.assign(negativeNode, {
    type: "CLIPTextEncode",
    inputs: [
      { localized_name: "clip", name: "clip", type: "CLIP", link: 117 },
      { localized_name: "text", name: "text", type: "STRING", widget: { name: "text" }, link: null },
    ],
    outputs: [
      {
        localized_name: "CONDITIONING",
        name: "CONDITIONING",
        type: "CONDITIONING",
        slot_index: 0,
        links: [50],
      },
    ],
    title: "CLIP Text Encode (Negative Prompt)",
    properties: { cnr_id: "comfy-core", ver: "0.3.75", "Node name for S&R": "CLIPTextEncode" },
    widgets_values: [NEGATIVE_PROMPT],
  });
  return workflow;
}

function addNegativePromptToApi(prompt) {
  prompt["26"] = {
    inputs: { text: NEGATIVE_PROMPT, clip: ["84", 0] },
    class_type: "CLIPTextEncode",
    _meta: { title: "CLIP Text Encode (Negative Prompt)" },
  };
  prompt["5"].inputs.negative = ["26", 0];
  return prompt;
}

function makeIngredientsTimeline(originalTimeline, frames) {
  const timeline = clone(originalTimeline);
  const sourceShot = timeline.segments.find(
    (segment) => String(segment.imageFile ?? "").endsWith("12_36_25 AM (3).png") || String(segment.prompt ?? "").includes("Shot 3"),
  ) ?? timeline.segments[0] ?? {};
  const textSegment = {
    ...sourceShot,
    id: `ingredients-${crypto.randomUUID()}`,
    start: 0,
    length: frames,
    type: "text",
    prompt: INGREDIENTS_VALIDATION_PROMPT,
    isEndFrame: false,
  };
  for (const key of ["imageFile", "imageB64", "videoFile", "fileName", "fileSize"]) delete textSegment[key];
  timeline.mainTrackEnabled = true;
  timeline.audioTrackEnabled = false;
  timeline.motionTrackEnabled = true;
  timeline.overrideAudio = false;
  timeline.inpaint_audio = false;
  timeline.global_prompt = "";
  timeline.retake_global_prompt = "";
  timeline.retakeMode = false;
  timeline.retakeVideo = null;
  timeline.retakeStart = 0;
  timeline.retakeLength = frames;
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = frames;
  timeline.segments = [textSegment];
  timeline.motionSegments = [{
    id: `ingredients-sheet-${crypto.randomUUID()}`,
    type: "motion_video",
    isStaticImage: true,
    start: 0,
    length: frames,
    trimStart: 0,
    videoDurationFrames: frames,
    videoFile: INGREDIENTS_SHEET_IMAGE,
    fileName: path.basename(INGREDIENTS_SHEET_IMAGE),
    videoStrength: 1.0,
    videoAttentionStrength: 1.0,
    resampleMode: "nearest",
    imageB64: INGREDIENTS_SHEET_VIEW,
    imageFile: INGREDIENTS_SHEET_IMAGE,
  }];
  timeline.audioSegments = [];
  return timeline;
}

function rebuildUiConnectivity(workflow) {
  const nodes = new Map(workflow.nodes.map((node) => [Number(node.id), node]));
  const validLinks = [];
  for (const link of workflow.links) {
    if (!Array.isArray(link) || link.length < 6) continue;
    const source = nodes.get(Number(link[1]));
    const target = nodes.get(Number(link[3]));
    if (!source || !target) continue;
    if (!asOutputs(source)[Number(link[2])] || !asInputs(target)[Number(link[4])]) continue;
    validLinks.push(link);
  }
  workflow.links = validLinks;
  for (const node of workflow.nodes) {
    for (const input of asInputs(node)) {
      if (Object.hasOwn(input, "link")) input.link = null;
    }
    for (const output of asOutputs(node)) {
      if (Object.hasOwn(output, "links")) output.links = null;
    }
  }
  for (const link of workflow.links) {
    const [linkId, sourceId, sourceSlot, targetId, targetSlot] = link;
    const sourceOutput = asOutputs(nodes.get(Number(sourceId)))[Number(sourceSlot)];
    const targetInput = asInputs(nodes.get(Number(targetId)))[Number(targetSlot)];
    appendOutputLinks(sourceOutput, [Number(linkId)]);
    targetInput.link = Number(linkId);
  }
  workflow.last_link_id = workflow.links.reduce((maximum, link) => Math.max(maximum, Number(link[0]) || 0), 0);
  return workflow;
}

function applyDirectorIngredientsToApi(apiPrompt, options) {
  const prompt = clone(apiPrompt);
  addNegativePromptToApi(prompt);
  for (const id of ["98", "99", "100", "101", "102"]) delete prompt[id];

  const timeline = makeIngredientsTimeline(JSON.parse(prompt["46"].inputs.timeline_data), options.frames);
  const seconds = options.frames / options.fps;
  Object.assign(prompt["46"].inputs, {
    start_second: 0,
    end_second: seconds,
    duration_seconds: seconds,
    start_frame: 0,
    end_frame: options.frames,
    duration_frames: options.frames,
    timeline_data: JSON.stringify(timeline),
    local_prompts: INGREDIENTS_VALIDATION_PROMPT,
    segment_lengths: String(options.frames),
    guide_strength: "0.00",
    use_custom_audio: false,
    use_custom_motion: true,
    inpaint_audio: false,
    frame_rate: options.fps,
    custom_width: options.width,
    custom_height: options.height,
    resize_method: "pad",
    divisible_by: 32,
  });

  for (const id of ["8", "58"]) {
    Object.assign(prompt[id].inputs, {
      motion_guide_data: ["46", 5],
      model: ["46", 0],
      ic_lora_name: INGREDIENTS_LORA,
      ic_lora_strength: options.ingredientsStrength,
      image_attention_strength: 1.0,
      crop: "disabled",
      auto_snap_ic_grid: true,
    });
  }
  prompt["9"].inputs.model = ["8", 3];
  prompt["9"].inputs.cfg = options.cfg;
  prompt["11"].inputs.model = ["8", 3];
  prompt["11"].inputs.steps = options.steps;
  prompt["49"].inputs.model = ["58", 3];
  prompt["49"].inputs.cfg = options.cfg;
  prompt["14"].inputs.positive = ["58", 0];
  prompt["14"].inputs.negative = ["58", 1];
  prompt["28"].inputs.noise_seed = options.seed;
  prompt["94"].inputs.filename_prefix = `identity_tests/${options.label}`;
  prompt["94"].inputs.save_metadata = true;
  if (options.singleStage) {
    prompt["8"].inputs.scale_by = 1.0;
    prompt["15"].inputs.samples = ["55", 2];
    prompt["16"].inputs.samples = ["13", 1];
    for (const id of ["14", "47", "48", "49", "50", "52", "53", "57", "58", "96"]) delete prompt[id];
  }
  return prompt;
}

function applyDirectorIngredientsToUi(uiWorkflow, options) {
  const workflow = clone(uiWorkflow);
  workflow.id = crypto.randomUUID();
  workflow.revision = 0;
  const removedNodes = new Set([
    98, 99, 100, 101, 102,
    ...(options.singleStage ? [14, 47, 48, 49, 50, 52, 53, 57, 58, 96] : []),
  ]);
  workflow.nodes = workflow.nodes.filter((node) => !removedNodes.has(Number(node.id)));
  workflow.links = workflow.links.filter((link) => {
    if (!Array.isArray(link)) return false;
    const sourceId = Number(link[1]);
    const targetId = Number(link[3]);
    const targetSlot = Number(link[4]);
    if (removedNodes.has(sourceId) || removedNodes.has(targetId)) return false;
    if ((targetId === 9 || targetId === 11 || targetId === 49) && targetSlot === 0) return false;
    if ((targetId === 8 || targetId === 58) && (targetSlot === 5 || targetSlot === 6)) return false;
    return true;
  });

  addNegativePromptToUi(workflow);
  const timeline = makeIngredientsTimeline(JSON.parse(getNode(workflow, 46).widgets_values[6]), options.frames);
  const directorValues = getNode(workflow, 46).widgets_values;
  const seconds = options.frames / options.fps;
  directorValues[0] = 0;
  directorValues[1] = seconds;
  directorValues[2] = seconds;
  directorValues[3] = 0;
  directorValues[4] = options.frames;
  directorValues[5] = options.frames;
  directorValues[6] = JSON.stringify(timeline);
  directorValues[7] = INGREDIENTS_VALIDATION_PROMPT;
  directorValues[8] = String(options.frames);
  directorValues[10] = "0.00";
  directorValues[11] = false;
  directorValues[12] = true;
  directorValues[13] = false;
  directorValues[14] = options.fps;
  directorValues[16] = options.width;
  directorValues[17] = options.height;
  directorValues[18] = "pad";
  directorValues[19] = 32;

  for (const id of [8, 58]) {
    if (!workflow.nodes.some((candidate) => Number(candidate.id) === id)) continue;
    const node = getNode(workflow, id);
    if (!asInputs(node).some((input) => input.name === "motion_guide_data")) {
      node.inputs.push({ name: "motion_guide_data", shape: 7, type: "MOTION_GUIDE_DATA", link: null });
    }
    if (!asInputs(node).some((input) => input.name === "model")) {
      node.inputs.push({ name: "model", shape: 7, type: "MODEL", link: null });
    }
    node.widgets_values[0] = INGREDIENTS_LORA;
    node.widgets_values[1] = options.ingredientsStrength;
    node.widgets_values[4] = 1.0;
    node.widgets_values[5] = "disabled";
    node.title = `${node.title ?? "LTX Director Guide"} · Ingredients active`;
  }
  getNode(workflow, 8).widgets_values[2] = options.singleStage ? 1.0 : getNode(workflow, 8).widgets_values[2];
  getNode(workflow, 9).widgets_values[0] = options.cfg;
  getNode(workflow, 11).widgets_values[1] = options.steps;
  if (!options.singleStage) getNode(workflow, 49).widgets_values[0] = options.cfg;

  const nextLinkId = workflow.links.reduce((maximum, link) => Math.max(maximum, Number(link[0]) || 0), 0) + 1;
  const ingredientLinks = [
    [nextLinkId, 46, 5, 8, 5, "MOTION_GUIDE_DATA"],
    [nextLinkId + 1, 46, 0, 8, 6, "MODEL"],
    [nextLinkId + 2, 8, 3, 9, 0, "MODEL"],
    [nextLinkId + 3, 8, 3, 11, 0, "MODEL"],
  ];
  if (options.singleStage) {
    ingredientLinks.push(
      [nextLinkId + 4, 55, 2, 15, 0, "LATENT"],
      [nextLinkId + 5, 13, 1, 16, 0, "LATENT"],
    );
  } else {
    ingredientLinks.push(
      [nextLinkId + 4, 46, 5, 58, 5, "MOTION_GUIDE_DATA"],
      [nextLinkId + 5, 46, 0, 58, 6, "MODEL"],
      [nextLinkId + 6, 58, 3, 49, 0, "MODEL"],
    );
  }
  workflow.links.push(...ingredientLinks);
  rebuildUiConnectivity(workflow);
  const videoNode = getNode(workflow, 94);
  if (videoNode.widgets_values && !Array.isArray(videoNode.widgets_values)) {
    videoNode.widgets_values.filename_prefix = `identity_tests/${options.label}`;
    videoNode.widgets_values.save_metadata = true;
  }
  workflow.last_node_id = workflow.nodes.reduce((maximum, node) => Math.max(maximum, Number(node.id) || 0), 0);
  workflow.extra = {
    ...(workflow.extra ?? {}),
    premiere316_identity_repair: {
      mode: "director-native-ingredients",
      reference_sheet: INGREDIENTS_SHEET_IMAGE,
      ingredients_lora: INGREDIENTS_LORA,
      ingredients_strength: options.ingredientsStrength,
      cfg: options.cfg,
      steps: options.steps,
      single_stage: options.singleStage,
      width: options.width,
      height: options.height,
      frames: options.frames,
      fps: options.fps,
      source: "Recovered from live 8188 history; generic reference path removed",
    },
  };
  return workflow;
}

function makeUiNodes(pass1Strength, pass2Strength, pass2Mode, useIngredients, verbose) {
  const sharedColor = { color: "#123a30", bgcolor: "#0d2b24" };
  return [
    {
      id: 98,
      type: "LoadImage",
      pos: [1810, 5360],
      size: [360, 430],
      flags: {},
      order: 30,
      mode: 0,
      inputs: [
        { name: "image", type: "COMBO", widget: { name: "image" }, link: null },
        { name: "upload", type: "IMAGEUPLOAD", widget: { name: "upload" }, link: null },
      ],
      outputs: [
        { name: "IMAGE", type: "IMAGE", links: pass2Mode === "bypass" ? [222] : [222, 228] },
        { name: "MASK", type: "MASK", links: null },
      ],
      title: "Jesus identity portrait (global reference)",
      properties: { cnr_id: "comfy-core", ver: "0.5.1", "Node name for S&R": "LoadImage" },
      widgets_values: [IDENTITY_IMAGE, "image"],
      color: "#17304a",
      bgcolor: "#102238",
    },
    useIngredients ? {
      id: 99,
      type: "LTXICLoRALoaderModelOnly",
      pos: [3050, 5120],
      size: [500, 140],
      flags: {},
      order: 31,
      mode: 0,
      inputs: [{ name: "model", type: "MODEL", link: 218 }],
      outputs: [
        { name: "model", type: "MODEL", links: [219] },
        { name: "latent_downscale_factor", type: "FLOAT", links: null },
      ],
      title: "Identity · Official Ingredients IC-LoRA",
      properties: {
        cnr_id: "ComfyUI-LTXVideo",
        ver: "local",
        "Node name for S&R": "LTXICLoRALoaderModelOnly",
      },
      widgets_values: [INGREDIENTS_LORA, 1.0],
      ...sharedColor,
    } : {
      id: 99,
      type: "LTXReferenceBypass",
      pos: [3050, 5120],
      size: [430, 100],
      flags: {},
      order: 31,
      mode: 0,
      inputs: [{ name: "model", type: "MODEL", link: 218 }],
      outputs: [{ name: "model", type: "MODEL", links: [219] }],
      title: "Identity · Base model (no mismatched IC-LoRA)",
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXReferenceBypass" },
      widgets_values: [],
      ...sharedColor,
    },
    {
      id: 100,
      type: "LTXReferenceEnable",
      pos: [3600, 5120],
      size: [390, 130],
      flags: {},
      order: 32,
      mode: 0,
      inputs: [{ name: "model", type: "MODEL", link: 219 }],
      outputs: [{ name: "model", type: "MODEL", links: [220, 226] }],
      title: "Identity · Enable reference tokens",
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXReferenceEnable" },
      widgets_values: [false, false],
      ...sharedColor,
    },
    {
      id: 101,
      type: "LTXReferenceConditioning",
      pos: [4050, 4940],
      size: [470, 300],
      flags: {},
      order: 33,
      mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: 220 },
        { name: "vae", type: "VAE", link: 221 },
        { name: "image", type: "IMAGE", link: 222 },
        { name: "target_latent", type: "LATENT", shape: 7, link: 223 },
        { name: "strength", type: "FLOAT", widget: { name: "strength" }, link: null },
        { name: "position_mode", type: "COMBO", widget: { name: "position_mode" }, link: null },
        { name: "verbose", type: "BOOLEAN", widget: { name: "verbose" }, link: null },
      ],
      outputs: [{ name: "model", type: "MODEL", links: [224, 225] }],
      title: "Identity · Pass 1 exact latent",
      properties: {
        cnr_id: "10s-comfy-nodes",
        ver: "local",
        "Node name for S&R": "LTXReferenceConditioning",
      },
      widgets_values: [pass1Strength, "reference", verbose],
      ...sharedColor,
    },
    pass2Mode === "bypass" ? {
      id: 102,
      type: "LTXReferenceBypass",
      pos: [4050, 5320],
      size: [390, 100],
      flags: {},
      order: 34,
      mode: 0,
      inputs: [{ name: "model", type: "MODEL", link: 226 }],
      outputs: [{ name: "model", type: "MODEL", links: [230] }],
      title: "Identity · Pass 2 reference bypass",
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXReferenceBypass" },
      widgets_values: [],
      ...sharedColor,
    } : {
      id: 102,
      type: "LTXReferenceConditioning",
      pos: [4050, 5320],
      size: [470, 300],
      flags: {},
      order: 34,
      mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: 226 },
        { name: "vae", type: "VAE", link: 227 },
        { name: "image", type: "IMAGE", link: 228 },
        { name: "target_latent", type: "LATENT", shape: 7, link: 229 },
        { name: "strength", type: "FLOAT", widget: { name: "strength" }, link: null },
        { name: "position_mode", type: "COMBO", widget: { name: "position_mode" }, link: null },
        { name: "verbose", type: "BOOLEAN", widget: { name: "verbose" }, link: null },
      ],
      outputs: [{ name: "model", type: "MODEL", links: [230] }],
      title: "Identity · Pass 2 exact latent",
      properties: {
        cnr_id: "10s-comfy-nodes",
        ver: "local",
        "Node name for S&R": "LTXReferenceConditioning",
      },
      widgets_values: [pass2Strength, "reference", verbose],
      ...sharedColor,
    },
  ];
}

function applyIdentityToUi(uiWorkflow, { pass1Strength, pass2Strength, pass2Mode, useIngredients, verbose }) {
  const workflow = clone(uiWorkflow);
  workflow.id = crypto.randomUUID();
  workflow.revision = 0;
  workflow.nodes = workflow.nodes.filter((node) => ![98, 99, 100, 101, 102].includes(Number(node.id)));
  workflow.links = workflow.links.filter(
    (link) => Array.isArray(link) && ![114, 115, 158].includes(Number(link[0])) && Number(link[0]) < 218,
  );
  addNegativePromptToUi(workflow);

  removeOutputLinks(outputAt(workflow, 46, 0), [114, 115, 158, 218]);
  removeOutputLinks(outputAt(workflow, 3, 0), [221, 227]);
  removeOutputLinks(outputAt(workflow, 8, 2), [223]);
  removeOutputLinks(outputAt(workflow, 58, 2), [229]);
  removeOutputLinks(outputAt(workflow, 8, 0), [54]);
  removeOutputLinks(outputAt(workflow, 8, 1), [55]);
  appendOutputLinks(outputAt(workflow, 58, 0), [54]);
  appendOutputLinks(outputAt(workflow, 58, 1), [55]);
  const cropPositive = inputNamed(workflow, 14, "positive");
  const cropNegative = inputNamed(workflow, 14, "negative");
  cropPositive.link = 54;
  cropNegative.link = 55;
  const cropPosLink = workflow.links.find((link) => Number(link[0]) === 54);
  const cropNegLink = workflow.links.find((link) => Number(link[0]) === 55);
  if (!cropPosLink || !cropNegLink) throw new Error("UI workflow crop-guide links 54/55 are missing");
  cropPosLink[1] = 58;
  cropNegLink[1] = 58;
  appendOutputLinks(outputAt(workflow, 46, 0), [218]);
  appendOutputLinks(outputAt(workflow, 3, 0), pass2Mode === "bypass" ? [221] : [221, 227]);
  appendOutputLinks(outputAt(workflow, 8, 2), [223]);
  if (pass2Mode !== "bypass") appendOutputLinks(outputAt(workflow, 58, 2), [229]);
  inputNamed(workflow, 9, "model").link = 224;
  inputNamed(workflow, 11, "model").link = 225;
  inputNamed(workflow, 49, "model").link = 230;

  workflow.nodes.push(...makeUiNodes(pass1Strength, pass2Strength, pass2Mode, useIngredients, verbose));
  const identityLinks = [
    [218, 46, 0, 99, 0, "MODEL"],
    [219, 99, 0, 100, 0, "MODEL"],
    [220, 100, 0, 101, 0, "MODEL"],
    [221, 3, 0, 101, 1, "VAE"],
    [222, 98, 0, 101, 2, "IMAGE"],
    [223, 8, 2, 101, 3, "LATENT"],
    [224, 101, 0, 9, 0, "MODEL"],
    [225, 101, 0, 11, 0, "MODEL"],
    [226, 100, 0, 102, 0, "MODEL"],
    [230, 102, 0, 49, 0, "MODEL"],
  ];
  if (pass2Mode !== "bypass") {
    identityLinks.push(
      [227, 3, 0, 102, 1, "VAE"],
      [228, 98, 0, 102, 2, "IMAGE"],
      [229, 58, 2, 102, 3, "LATENT"],
    );
  }
  workflow.links.push(...identityLinks);
  workflow.last_node_id = 102;
  workflow.last_link_id = 230;
  workflow.extra = {
    ...(workflow.extra ?? {}),
    premiere316_identity_repair: {
      reference_image: IDENTITY_IMAGE,
      ingredients_lora: INGREDIENTS_LORA,
      use_ingredients_lora: useIngredients,
      pass1_strength: pass1Strength,
      pass2_strength: pass2Strength,
      pass2_mode: pass2Mode,
      source: "Recovered from live 8188 history; original GARDEN preserved",
    },
  };
  return workflow;
}

function applyIdentityToApi(apiPrompt, { pass1Strength, pass2Strength, pass2Mode, useIngredients, verbose }) {
  const prompt = clone(apiPrompt);
  addNegativePromptToApi(prompt);
  prompt["98"] = {
    inputs: { image: IDENTITY_IMAGE },
    class_type: "LoadImage",
    _meta: { title: "Jesus identity portrait (global reference)" },
  };
  prompt["99"] = useIngredients ? {
    inputs: { model: ["46", 0], lora_name: INGREDIENTS_LORA, strength_model: 1.0 },
    class_type: "LTXICLoRALoaderModelOnly",
    _meta: { title: "Identity · Official Ingredients IC-LoRA" },
  } : {
    inputs: { model: ["46", 0] },
    class_type: "LTXReferenceBypass",
    _meta: { title: "Identity · Base model (no mismatched IC-LoRA)" },
  };
  prompt["100"] = {
    inputs: { model: ["99", 0], zero_ref_timesteps: false, verbose: false },
    class_type: "LTXReferenceEnable",
    _meta: { title: "Identity · Enable reference tokens" },
  };
  prompt["101"] = {
    inputs: {
      model: ["100", 0],
      vae: ["3", 0],
      image: ["98", 0],
      target_latent: ["8", 2],
      strength: pass1Strength,
      position_mode: "reference",
      verbose,
    },
    class_type: "LTXReferenceConditioning",
    _meta: { title: "Identity · Pass 1 exact latent" },
  };
  prompt["102"] = pass2Mode === "bypass" ? {
    inputs: { model: ["100", 0] },
    class_type: "LTXReferenceBypass",
    _meta: { title: "Identity · Pass 2 reference bypass" },
  } : {
    inputs: {
      model: ["100", 0],
      vae: ["3", 0],
      image: ["98", 0],
      target_latent: ["58", 2],
      strength: pass2Strength,
      position_mode: "reference",
      verbose,
    },
    class_type: "LTXReferenceConditioning",
    _meta: { title: "Identity · Pass 2 exact latent" },
  };
  prompt["9"].inputs.model = ["101", 0];
  prompt["11"].inputs.model = ["101", 0];
  prompt["49"].inputs.model = ["102", 0];
  prompt["14"].inputs.positive = ["58", 0];
  prompt["14"].inputs.negative = ["58", 1];
  return prompt;
}

function makeCloseupTimeline(originalTimeline, frames, { identityKeyframe, keyframeMode, validationPrompt }) {
  const timeline = clone(originalTimeline);
  const shot = timeline.segments.find(
    (segment) => String(segment.imageFile ?? "").endsWith("12_36_25 AM (3).png") || String(segment.prompt ?? "").includes("Shot 3"),
  );
  if (!shot) throw new Error("The close-up Shot 3 timeline segment was not found");
  const closeup = { ...shot, start: 0, length: frames };
  if (identityKeyframe) {
    if (keyframeMode === "inplace") {
      delete closeup.imageFile;
      delete closeup.imageB64;
    } else {
      closeup.imageFile = IDENTITY_IMAGE;
      closeup.imageB64 = IDENTITY_IMAGE_VIEW;
    }
  }
  if (validationPrompt) {
    closeup.prompt = IDENTITY_VALIDATION_PROMPT;
    timeline.global_prompt = IDENTITY_VALIDATION_PROMPT;
    timeline.retake_global_prompt = "";
  }
  timeline.segments = [closeup];
  // The portrait is conditioned explicitly. Repeating it as a motion clip would
  // control composition and allocate a large full-frame tensor unnecessarily.
  timeline.motionSegments = [];
  timeline.audioSegments = [];
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = frames;
  timeline.retakeMode = false;
  timeline.retakeVideo = null;
  timeline.retakeStart = 0;
  timeline.retakeLength = frames;
  return { timeline, shot: closeup };
}

function updateApiForCloseup(apiPrompt, { width, height, frames, fps, seed, label, identityKeyframe, keyframeMode, validationPrompt }) {
  const prompt = clone(apiPrompt);
  const node = prompt["46"];
  const originalTimeline = JSON.parse(node.inputs.timeline_data);
  const { timeline, shot } = makeCloseupTimeline(originalTimeline, frames, { identityKeyframe, keyframeMode, validationPrompt });
  const seconds = frames / fps;
  Object.assign(node.inputs, {
    start_second: 0,
    end_second: seconds,
    duration_seconds: seconds,
    start_frame: 0,
    end_frame: frames,
    duration_frames: frames,
    timeline_data: JSON.stringify(timeline),
    local_prompts: shot.prompt,
    segment_lengths: String(frames),
    guide_strength: "1.00",
    use_custom_audio: false,
    use_custom_motion: false,
    inpaint_audio: false,
    frame_rate: fps,
    custom_width: width,
    custom_height: height,
    resize_method: "maintain aspect ratio",
    divisible_by: 32,
  });
  prompt["28"].inputs.noise_seed = seed;
  prompt["94"].inputs.filename_prefix = `identity_tests/${label}`;
  prompt["94"].inputs.save_metadata = true;
  return prompt;
}

function updateUiForCloseup(uiWorkflow, { width, height, frames, fps, identityKeyframe, keyframeMode, validationPrompt }) {
  const workflow = clone(uiWorkflow);
  const node = getNode(workflow, 46);
  const values = node.widgets_values;
  const { timeline, shot } = makeCloseupTimeline(JSON.parse(values[6]), frames, { identityKeyframe, keyframeMode, validationPrompt });
  const seconds = frames / fps;
  values[0] = 0;
  values[1] = seconds;
  values[2] = seconds;
  values[3] = 0;
  values[4] = frames;
  values[5] = frames;
  values[6] = JSON.stringify(timeline);
  values[7] = shot.prompt;
  values[8] = String(frames);
  values[10] = "1.00";
  values[11] = false;
  values[12] = false;
  values[13] = false;
  values[14] = fps;
  values[16] = width;
  values[17] = height;
  values[18] = "maintain aspect ratio";
  values[19] = 32;
  return workflow;
}

function applyInplaceConditioningToApi(apiPrompt) {
  const prompt = clone(apiPrompt);
  prompt["103"] = {
    inputs: {
      vae: ["3", 0],
      image: ["98", 0],
      latent: ["8", 2],
      strength: 1.0,
      bypass: false,
    },
    class_type: "LTXVImgToVideoConditionOnly",
    _meta: { title: "Identity · Frame 0 in-place conditioning" },
  };
  prompt["7"].inputs.video_latent = ["103", 0];
  return prompt;
}

function applyInplaceConditioningToUi(uiWorkflow) {
  const workflow = clone(uiWorkflow);
  workflow.nodes = workflow.nodes.filter((node) => Number(node.id) !== 103);
  workflow.links = workflow.links.filter((link) => ![231, 232, 233].includes(Number(link[0])));
  removeOutputLinks(outputAt(workflow, 8, 2), [108, 231]);
  removeOutputLinks(outputAt(workflow, 3, 0), [232]);
  removeOutputLinks(outputAt(workflow, 98, 0), [233]);
  appendOutputLinks(outputAt(workflow, 8, 2), [231]);
  appendOutputLinks(outputAt(workflow, 3, 0), [232]);
  appendOutputLinks(outputAt(workflow, 98, 0), [233]);
  const concatLink = workflow.links.find((link) => Number(link[0]) === 108);
  if (!concatLink) throw new Error("UI workflow video concat link 108 is missing");
  concatLink[1] = 103;
  workflow.nodes.push({
    id: 103,
    type: "LTXVImgToVideoConditionOnly",
    pos: [2920, 4660],
    size: [420, 190],
    flags: {},
    order: 35,
    mode: 0,
    inputs: [
      { name: "vae", type: "VAE", link: 232 },
      { name: "image", type: "IMAGE", link: 233 },
      { name: "latent", type: "LATENT", link: 231 },
      { name: "strength", type: "FLOAT", widget: { name: "strength" }, link: null },
      { name: "bypass", type: "BOOLEAN", widget: { name: "bypass" }, link: null },
    ],
    outputs: [{ name: "latent", type: "LATENT", links: [108] }],
    title: "Identity · Frame 0 in-place conditioning",
    properties: { cnr_id: "ComfyUI-LTXVideo", ver: "local", "Node name for S&R": "LTXVImgToVideoConditionOnly" },
    widgets_values: [1.0, false],
    color: "#17304a",
    bgcolor: "#102238",
  });
  workflow.links.push(
    [231, 8, 2, 103, 2, "LATENT"],
    [232, 3, 0, 103, 0, "VAE"],
    [233, 98, 0, 103, 1, "IMAGE"],
  );
  workflow.last_node_id = Math.max(Number(workflow.last_node_id ?? 0), 103);
  workflow.last_link_id = Math.max(Number(workflow.last_link_id ?? 0), 233);
  return workflow;
}

function applyLikenessToApi(apiPrompt, strength, similarityThreshold) {
  const prompt = clone(apiPrompt);
  prompt["104"] = {
    inputs: {
      positive: ["58", 0],
      negative: ["58", 1],
      vae: ["3", 0],
      latent: ["58", 2],
      image: ["98", 0],
      strength: 1.0,
      placement_mode: "silent_reference",
      face_detect: "auto",
      reference_mask_mode: "bbox_softfade",
      face_padding: 0.15,
      crf: 29,
      blur_radius: 0,
      interpolation: "lanczos",
      crop: "center",
      attention_strength: 1.0,
      face_bbox_within_reference: "",
      emit_latent: "extended",
      debug: true,
    },
    class_type: "LTXLikenessGuide",
    _meta: { title: "Identity · Pass 2 likeness guide (extended)" },
  };
  prompt["105"] = {
    inputs: {
      model: ["46", 0],
      strength,
      reference_info: ["104", 3],
      reference_source: "guide",
      frame_0_bbox: "",
      similarity_threshold: similarityThreshold,
      decay_with_distance: 0.0,
      bypass: false,
      debug: true,
      advanced_mode: true,
      depth_curve: "flat",
      block_index_filter: "",
      similarity_sharpness: 8.0,
      override_face_bbox: "",
      skip_when_sigma_above: 0.0,
      pull_mode: "directional",
      late_block_falloff: 0.4,
    },
    class_type: "LTXLikenessAnchor",
    _meta: { title: `Identity · Pass 2 likeness anchor ${strength}` },
  };
  prompt["106"] = {
    inputs: { latent: ["48", 0], reference_info: ["104", 3], debug: true },
    class_type: "LTXLikenessCrop",
    _meta: { title: "Identity · Remove likeness reference frame" },
  };
  prompt["49"].inputs.model = ["105", 0];
  prompt["49"].inputs.positive = ["104", 0];
  prompt["49"].inputs.negative = ["104", 1];
  prompt["50"].inputs.video_latent = ["104", 2];
  prompt["14"].inputs.latent = ["106", 0];
  return prompt;
}

function applyLikenessToUi(uiWorkflow, strength, similarityThreshold) {
  const workflow = clone(uiWorkflow);
  workflow.nodes = workflow.nodes.filter((node) => ![104, 105, 106].includes(Number(node.id)));
  workflow.links = workflow.links.filter((link) => Number(link[0]) < 234);

  removeOutputLinks(outputAt(workflow, 58, 0), [152, 234]);
  removeOutputLinks(outputAt(workflow, 58, 1), [153, 235]);
  removeOutputLinks(outputAt(workflow, 58, 2), [154, 238]);
  removeOutputLinks(outputAt(workflow, 3, 0), [236]);
  removeOutputLinks(outputAt(workflow, 98, 0), [237]);
  removeOutputLinks(outputAt(workflow, 46, 0), [239]);
  removeOutputLinks(outputAt(workflow, 102, 0), [230]);
  removeOutputLinks(outputAt(workflow, 48, 0), [136, 241]);
  appendOutputLinks(outputAt(workflow, 58, 0), [234]);
  appendOutputLinks(outputAt(workflow, 58, 1), [235]);
  appendOutputLinks(outputAt(workflow, 58, 2), [238]);
  appendOutputLinks(outputAt(workflow, 3, 0), [236]);
  appendOutputLinks(outputAt(workflow, 98, 0), [237]);
  appendOutputLinks(outputAt(workflow, 46, 0), [239]);
  appendOutputLinks(outputAt(workflow, 48, 0), [241]);

  const positiveLink = workflow.links.find((link) => Number(link[0]) === 152);
  const negativeLink = workflow.links.find((link) => Number(link[0]) === 153);
  const latentLink = workflow.links.find((link) => Number(link[0]) === 154);
  const modelLink = workflow.links.find((link) => Number(link[0]) === 230);
  const cropLink = workflow.links.find((link) => Number(link[0]) === 136);
  if (!positiveLink || !negativeLink || !latentLink || !modelLink || !cropLink) {
    throw new Error("The pass-2 UI links required for likeness conditioning are missing");
  }
  positiveLink[1] = 104;
  negativeLink[1] = 104;
  latentLink[1] = 104;
  modelLink[1] = 105;
  cropLink[1] = 106;

  workflow.nodes.push(
    {
      id: 104,
      type: "LTXLikenessGuide",
      pos: [4450, 4300],
      size: [520, 470],
      flags: {}, order: 36, mode: 0,
      inputs: [
        { name: "positive", type: "CONDITIONING", link: 234 },
        { name: "negative", type: "CONDITIONING", link: 235 },
        { name: "vae", type: "VAE", link: 236 },
        { name: "latent", type: "LATENT", link: 238 },
        { name: "image", type: "IMAGE", link: 237 },
      ],
      outputs: [
        { name: "positive", type: "CONDITIONING", links: [152] },
        { name: "negative", type: "CONDITIONING", links: [153] },
        { name: "latent", type: "LATENT", links: [154] },
        { name: "reference_info", type: "REFERENCE_INFO", links: [240, 242] },
      ],
      title: "Identity · Pass 2 likeness guide (extended)",
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXLikenessGuide" },
      widgets_values: [1.0, "silent_reference", "auto", "bbox_softfade", 0.15, 29, 0, "lanczos", "center", 1.0, "", "extended", true],
      color: "#3a203e", bgcolor: "#29162d",
    },
    {
      id: 105,
      type: "LTXLikenessAnchor",
      pos: [5030, 4300],
      size: [500, 430],
      flags: {}, order: 37, mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: 239 },
        { name: "reference_info", type: "REFERENCE_INFO", link: 240 },
      ],
      outputs: [{ name: "MODEL", type: "MODEL", links: [230] }],
      title: `Identity · Pass 2 likeness anchor ${strength}`,
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXLikenessAnchor" },
      widgets_values: [strength, "guide", "", similarityThreshold, 0.0, false, true, true, "flat", "", 8.0, "", 0.0, "directional", 0.4],
      color: "#3a203e", bgcolor: "#29162d",
    },
    {
      id: 106,
      type: "LTXLikenessCrop",
      pos: [4200, 3830],
      size: [360, 140],
      flags: {}, order: 38, mode: 0,
      inputs: [
        { name: "latent", type: "LATENT", link: 241 },
        { name: "reference_info", type: "REFERENCE_INFO", link: 242 },
      ],
      outputs: [{ name: "LATENT", type: "LATENT", links: [136] }],
      title: "Identity · Remove likeness reference frame",
      properties: { cnr_id: "10s-comfy-nodes", ver: "local", "Node name for S&R": "LTXLikenessCrop" },
      widgets_values: [true],
      color: "#3a203e", bgcolor: "#29162d",
    },
  );
  workflow.links.push(
    [234, 58, 0, 104, 0, "CONDITIONING"],
    [235, 58, 1, 104, 1, "CONDITIONING"],
    [236, 3, 0, 104, 2, "VAE"],
    [237, 98, 0, 104, 4, "IMAGE"],
    [238, 58, 2, 104, 3, "LATENT"],
    [239, 46, 0, 105, 0, "MODEL"],
    [240, 104, 3, 105, 1, "REFERENCE_INFO"],
    [241, 48, 0, 106, 0, "LATENT"],
    [242, 104, 3, 106, 1, "REFERENCE_INFO"],
  );
  workflow.last_node_id = Math.max(Number(workflow.last_node_id ?? 0), 106);
  workflow.last_link_id = Math.max(Number(workflow.last_link_id ?? 0), 242);
  return workflow;
}

function validateApi(prompt, options) {
  const required = ["3", "5", "8", "9", "11", "26", "46", "49", "58", "84", "94", "95", "98", "99", "100", "101", "102"];
  for (const id of required) {
    if (!prompt[id]) throw new Error(`Prepared API graph is missing node ${id}`);
  }
  const checks = [
    [prompt["9"].inputs.model, ["101", 0], "node 9 model"],
    [prompt["11"].inputs.model, ["101", 0], "node 11 model"],
    [prompt["49"].inputs.model, options.likenessAnchor > 0 ? ["105", 0] : ["102", 0], "node 49 model"],
    [prompt["101"].inputs.target_latent, ["8", 2], "pass 1 target"],
    [prompt["14"].inputs.positive, ["58", 0], "final crop positive"],
    [prompt["14"].inputs.negative, ["58", 1], "final crop negative"],
    [prompt["5"].inputs.negative, ["26", 0], "negative prompt conditioning"],
  ];
  if (options.pass2Mode !== "bypass") checks.push([prompt["102"].inputs.target_latent, ["58", 2], "pass 2 target"]);
  if (options.likenessAnchor > 0) {
    checks.push(
      [prompt["49"].inputs.positive, ["104", 0], "likeness positive"],
      [prompt["49"].inputs.negative, ["104", 1], "likeness negative"],
      [prompt["50"].inputs.video_latent, ["104", 2], "likeness extended latent"],
      [prompt["14"].inputs.latent, ["106", 0], "likeness final crop"],
    );
  }
  if (prompt["26"].class_type !== "CLIPTextEncode" || prompt["26"].inputs.text !== NEGATIVE_PROMPT) {
    throw new Error("The explicit negative-prompt encoder is missing or contains the wrong text");
  }
  for (const [actual, expected, label] of checks) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (prompt["46"].inputs.custom_width !== options.width || prompt["46"].inputs.custom_height !== options.height) {
    throw new Error("The low-resolution dimensions were not applied");
  }
  if (options.keyframeMode === "inplace") {
    if (prompt["103"]?.class_type !== "LTXVImgToVideoConditionOnly") throw new Error("In-place conditioning node 103 is missing");
    if (JSON.stringify(prompt["7"].inputs.video_latent) !== JSON.stringify(["103", 0])) {
      throw new Error("The first-pass video latent is not routed through in-place conditioning");
    }
  }
  if (options.likenessAnchor > 0) {
    if (prompt["104"]?.class_type !== "LTXLikenessGuide" || prompt["106"]?.class_type !== "LTXLikenessCrop") {
      throw new Error("The extended likeness guide/crop chain is missing");
    }
  }
}

function validateDirectorIngredientsApi(prompt, options) {
  const required = [
    "3", "5", "8", "9", "10", "11", "13", "15", "16", "26", "46", "55", "84", "94", "95",
    ...(options.singleStage ? [] : ["14", "47", "48", "49", "50", "58"]),
  ];
  for (const id of required) {
    if (!prompt[id]) throw new Error(`Prepared Director Ingredients graph is missing node ${id}`);
  }
  for (const id of ["98", "99", "100", "101", "102"]) {
    if (prompt[id]) throw new Error(`Generic reference node ${id} must not remain in the Director Ingredients graph`);
  }
  const checks = [
    [prompt["8"].inputs.motion_guide_data, ["46", 5], "stage 1 motion guide"],
    [prompt["8"].inputs.model, ["46", 0], "stage 1 base model"],
    [prompt["9"].inputs.model, ["8", 3], "stage 1 CFG model"],
    [prompt["11"].inputs.model, ["8", 3], "stage 1 scheduler model"],
    [prompt["5"].inputs.negative, ["26", 0], "negative prompt conditioning"],
  ];
  if (options.singleStage) {
    checks.push(
      [prompt["15"].inputs.samples, ["55", 2], "single-stage video decode"],
      [prompt["16"].inputs.samples, ["13", 1], "single-stage audio decode"],
    );
  } else {
    checks.push(
      [prompt["58"].inputs.motion_guide_data, ["46", 5], "stage 2 motion guide"],
      [prompt["58"].inputs.model, ["46", 0], "stage 2 base model"],
      [prompt["49"].inputs.model, ["58", 3], "stage 2 CFG model"],
    );
  }
  for (const [actual, expected, label] of checks) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (prompt["8"].inputs.ic_lora_name !== INGREDIENTS_LORA || (!options.singleStage && prompt["58"].inputs.ic_lora_name !== INGREDIENTS_LORA)) {
    throw new Error("The exact Ingredients IC-LoRA selector is not active in every executed Director guide");
  }
  if (prompt["9"].inputs.cfg !== options.cfg || (!options.singleStage && prompt["49"].inputs.cfg !== options.cfg)) {
    throw new Error("The requested CFG value was not applied to every executed stage");
  }
  if (prompt["11"].inputs.steps !== options.steps) throw new Error("The requested sampler step count was not applied");
  if (prompt["46"].inputs.custom_width !== options.width || prompt["46"].inputs.custom_height !== options.height) {
    throw new Error("The requested Ingredients validation dimensions were not applied");
  }
  const timeline = JSON.parse(prompt["46"].inputs.timeline_data);
  if (timeline.segments.some((segment) => segment.imageFile || segment.imageB64)) {
    throw new Error("A competing main-track image guide remains in the Ingredients validation timeline");
  }
  if (timeline.motionSegments.length !== 1 || timeline.motionSegments[0].videoFile !== INGREDIENTS_SHEET_IMAGE) {
    throw new Error("The character sheet is not the sole active Ingredients motion guide");
  }
  if (!String(prompt["46"].inputs.local_prompts).startsWith("Reference sheet:")) {
    throw new Error("The Ingredients two-part prompt is missing");
  }
}

async function prepare(values) {
  const options = {
    comfyUrl: String(values["comfy-url"] ?? process.env.COMFY_URL ?? DEFAULT_COMFY_URL).replace(/\/$/, ""),
    sourceHistory: String(values["source-history"] ?? DEFAULT_SOURCE_HISTORY),
    pass1Strength: numberArg(values, "pass1", 0.75),
    pass2Strength: numberArg(values, "pass2", 0.55),
    pass2Mode: String(values["pass2-mode"] ?? "reference").toLowerCase(),
    useIngredients: boolArg(values, "ingredients-lora", true),
    width: Math.trunc(numberArg(values, "width", 768)),
    height: Math.trunc(numberArg(values, "height", 320)),
    frames: Math.trunc(numberArg(values, "frames", 49)),
    fps: numberArg(values, "fps", 24),
    seed: Math.trunc(numberArg(values, "seed", 488441818004763)),
    verbose: boolArg(values, "verbose", true),
    identityKeyframe: boolArg(values, "identity-keyframe", false),
    keyframeMode: String(values["keyframe-mode"] ?? "appended").toLowerCase(),
    validationPrompt: boolArg(values, "validation-prompt", false),
    likenessAnchor: numberArg(values, "likeness-anchor", 0),
    likenessThreshold: numberArg(values, "likeness-threshold", 0.5),
    directorIngredients: boolArg(values, "director-ingredients", false),
    ingredientsStrength: numberArg(values, "ingredients-strength", 1.4),
    cfg: numberArg(values, "cfg", 1.0),
    steps: Math.trunc(numberArg(values, "steps", 8)),
    singleStage: boolArg(values, "single-stage", true),
    label: sanitizeLabel(values.label ?? `garden-face-p${values.pass1 ?? "075"}-p${values.pass2 ?? "055"}`),
  };
  if (options.width % 32 !== 0 || options.height % 32 !== 0) {
    throw new Error("--width and --height must both be divisible by 32");
  }
  if (options.frames < 9 || options.frames > 327) throw new Error("--frames must be between 9 and 327");
  if (options.pass1Strength < 0 || options.pass1Strength > 2 || options.pass2Strength < 0 || options.pass2Strength > 2) {
    throw new Error("Reference strengths must be between 0 and 2");
  }
  if (!['reference', 'bypass'].includes(options.pass2Mode)) throw new Error("--pass2-mode must be reference or bypass");
  if (!['appended', 'inplace'].includes(options.keyframeMode)) throw new Error("--keyframe-mode must be appended or inplace");
  if (options.likenessAnchor < 0 || options.likenessAnchor > 0.8) throw new Error("--likeness-anchor must be between 0 and 0.8");
  if (options.likenessThreshold < 0 || options.likenessThreshold > 1) throw new Error("--likeness-threshold must be between 0 and 1");
  if (options.ingredientsStrength < 0 || options.ingredientsStrength > 2) throw new Error("--ingredients-strength must be between 0 and 2");
  if (options.cfg < 0 || options.cfg > 20) throw new Error("--cfg must be between 0 and 20");
  if (options.steps < 1 || options.steps > 100) throw new Error("--steps must be between 1 and 100");

  const source = await loadSource(options.comfyUrl, options.sourceHistory);
  let fullUi;
  let closeupUi;
  let closeupApi;
  if (options.directorIngredients) {
    fullUi = applyDirectorIngredientsToUi(source.uiWorkflow, options);
    closeupUi = fullUi;
    closeupApi = applyDirectorIngredientsToApi(source.apiPrompt, options);
    validateDirectorIngredientsApi(closeupApi, options);
  } else {
    fullUi = applyIdentityToUi(source.uiWorkflow, options);
    closeupUi = updateUiForCloseup(fullUi, options);
    const identityApi = applyIdentityToApi(source.apiPrompt, options);
    closeupApi = updateApiForCloseup(identityApi, options);
    if (options.keyframeMode === "inplace") {
      closeupUi = applyInplaceConditioningToUi(closeupUi);
      closeupApi = applyInplaceConditioningToApi(closeupApi);
    }
    if (options.likenessAnchor > 0) {
      closeupUi = applyLikenessToUi(closeupUi, options.likenessAnchor, options.likenessThreshold);
      closeupApi = applyLikenessToApi(closeupApi, options.likenessAnchor, options.likenessThreshold);
    }
    validateApi(closeupApi, options);
  }

  await fs.mkdir(WORKFLOW_DIR, { recursive: true });
  await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
  const fullWorkflowPath = path.join(
    WORKFLOW_DIR,
    options.directorIngredients ? "GARDEN_identity_ingredients_fixed.json" : "GARDEN_identity_repaired.json",
  );
  const testWorkflowPath = path.join(WORKFLOW_DIR, `GARDEN_identity_test_${options.label}.json`);
  const apiPath = path.join(DIAGNOSTICS_DIR, `${options.label}.api.json`);
  const manifestPath = path.join(DIAGNOSTICS_DIR, `${options.label}.manifest.json`);
  const manifest = {
    created_at: new Date().toISOString(),
    source_history: options.sourceHistory,
    comfy_url: options.comfyUrl,
    identity_image: options.directorIngredients ? INGREDIENTS_SHEET_IMAGE : IDENTITY_IMAGE,
    ingredients_lora: INGREDIENTS_LORA,
    pass1_strength: options.pass1Strength,
    pass2_strength: options.pass2Strength,
    pass2_mode: options.pass2Mode,
    use_ingredients_lora: options.useIngredients,
    director_native_ingredients: options.directorIngredients,
    ingredients_strength: options.ingredientsStrength,
    cfg: options.cfg,
    steps: options.steps,
    single_stage: options.singleStage,
    identity_keyframe: options.identityKeyframe,
    keyframe_mode: options.keyframeMode,
    validation_prompt: options.validationPrompt,
    likeness_anchor: options.likenessAnchor,
    likeness_threshold: options.likenessThreshold,
    width: options.width,
    height: options.height,
    frames: options.frames,
    fps: options.fps,
    seed: options.seed,
    output_prefix: `identity_tests/${options.label}`,
    full_workflow: fullWorkflowPath,
    test_workflow: testWorkflowPath,
    api_prompt: apiPath,
  };
  await Promise.all([
    fs.writeFile(fullWorkflowPath, `${JSON.stringify(fullUi, null, 2)}\n`, "utf8"),
    fs.writeFile(testWorkflowPath, `${JSON.stringify(closeupUi, null, 2)}\n`, "utf8"),
    fs.writeFile(apiPath, `${JSON.stringify(closeupApi, null, 2)}\n`, "utf8"),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ]);
  return { options, source, closeupApi, closeupUi, manifest, manifestPath };
}

async function submit(prepared) {
  const queue = await requestJson(prepared.options.comfyUrl, "/queue");
  if ((queue.queue_running?.length ?? 0) > 0 || (queue.queue_pending?.length ?? 0) > 0) {
    throw new Error("ComfyUI 8188 is busy; refusing to mix an identity test into the active queue");
  }
  const clientId = crypto.randomUUID();
  const body = {
    prompt: prepared.closeupApi,
    client_id: clientId,
    extra_data: {
      comfy_usage_source: "premiere316_identity_tune",
      extra_pnginfo: { workflow: prepared.closeupUi },
    },
  };
  const response = await requestJson(prepared.options.comfyUrl, "/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.prompt_id) throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(response)}`);
  const runPath = path.join(DIAGNOSTICS_DIR, `${prepared.options.label}.run.json`);
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

async function status(values) {
  const baseUrl = String(values["comfy-url"] ?? process.env.COMFY_URL ?? DEFAULT_COMFY_URL).replace(/\/$/, "");
  const promptId = String(values["prompt-id"] ?? "");
  if (!promptId) throw new Error("status requires --prompt-id");
  const [history, queue] = await Promise.all([
    requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`),
    requestJson(baseUrl, "/queue"),
  ]);
  const entry = history[promptId];
  const running = queue.queue_running?.some((item) => item?.[1] === promptId) ?? false;
  const pending = queue.queue_pending?.some((item) => item?.[1] === promptId) ?? false;
  const outputs = [];
  if (entry?.outputs) {
    for (const [nodeId, nodeOutput] of Object.entries(entry.outputs)) {
      for (const key of ["gifs", "videos", "images", "audio"]) {
        for (const item of nodeOutput?.[key] ?? []) outputs.push({ node_id: nodeId, kind: key, ...item });
      }
    }
  }
  return {
    prompt_id: promptId,
    found: Boolean(entry),
    running,
    pending,
    status: entry?.status ?? null,
    outputs,
  };
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === "status") {
    console.log(JSON.stringify(await status(values), null, 2));
    return;
  }
  const prepared = await prepare(values);
  if (command === "prepare") {
    console.log(JSON.stringify({ ...prepared.manifest, manifest: prepared.manifestPath }, null, 2));
    return;
  }
  if (command === "submit") {
    console.log(JSON.stringify(await submit(prepared), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
