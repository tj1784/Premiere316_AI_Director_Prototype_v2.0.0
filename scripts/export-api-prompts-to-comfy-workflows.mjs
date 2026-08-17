import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const diagnosticsDir = path.join(repoRoot, "diagnostics", "ltx-identity-tuning");
const workflowRoot = path.join(repoRoot, "BlokeyUI", "ComfyUI", "user", "default", "workflows");
const outputDir = path.join(workflowRoot, "Premiere316", "Garden of Gethsemane");
const comfyUrl = "http://127.0.0.1:8188";
const baseWorkflowPath = path.join(workflowRoot, "GARDEN_identity_test_garden-face-best-r10-final.json");
const reactorTemplatePath = path.join(repoRoot, "diagnostics", "rejected-reactor-experiment", "workflows", "GARDEN_identity_test_garden-face-reactor-r13.json");
const vhsTemplatePath = path.join(repoRoot, "BlokeyUI", "ComfyUI", "custom_nodes", "comfyui-videohelpersuite", "tests", "audio.json");

const exportsToBuild = [
  {
    source: path.join(diagnosticsDir, "garden-first-segment-voice-r31.api.json"),
    output: path.join(outputDir, "GARDEN_first_segment_R31_voice_identity_8plus3_1128x480_25fps.json"),
    title: "GARDEN R31 · Voice + identity · 8+3 · 1128×480 · 25 fps",
    kind: "r31",
  },
  {
    source: path.join(diagnosticsDir, "garden-first-segment-voice-reactor-r32.api.json"),
    output: path.join(outputDir, "GARDEN_first_segment_R32_face_correction.json"),
    title: "GARDEN R32 · Face correction + original audio",
    kind: "r32",
  },
];

const clone = (value) => structuredClone(value);
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

async function getLiveObjectInfo() {
  const response = await fetch(`${comfyUrl}/object_info`);
  if (!response.ok) throw new Error(`Live ComfyUI object_info failed: HTTP ${response.status}`);
  return response.json();
}

function schemaType(def) {
  if (!Array.isArray(def)) return "*";
  const type = def[0];
  if (Array.isArray(type)) return "COMBO";
  return String(type);
}

function isWidget(def) {
  if (!Array.isArray(def)) return false;
  const [type, config] = def;
  if (Array.isArray(type)) return true;
  if (config?.forceInput) return false;
  return ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "FLOAT,INT"].includes(type);
}

function inputOrder(info) {
  return [
    ...Object.keys(info.input?.required ?? {}),
    ...Object.keys(info.input?.optional ?? {}),
  ];
}

function inputDefinitions(info) {
  return { ...(info.input?.required ?? {}), ...(info.input?.optional ?? {}) };
}

function linkValue(value, prompt) {
  return Array.isArray(value)
    && value.length === 2
    && Number.isInteger(Number(value[1]))
    && Object.prototype.hasOwnProperty.call(prompt, String(value[0]));
}

function defaultSize(type) {
  const sizes = {
    LTXDirector: [1120, 1308],
    LTXDirectorGuide: [420, 430],
    LTXIdentityOverlapConditioning: [390, 420],
    LTXVReferenceAudio: [390, 270],
    LoadImage: [360, 430],
    LoadAudio: [420, 150],
    VHS_LoadVideoPath: [430, 520],
    VHS_VideoCombine: [475, 525],
    ReActorFaceSwap: [470, 420],
    CLIPTextEncode: [430, 300],
  };
  return sizes[type] ?? [300, 150];
}

function nodeProperties(type, info) {
  return {
    "Node name for S&R": type,
    ...(info.python_module ? { python_module: info.python_module } : {}),
  };
}

function genericNode(id, apiNode, info, prompt, order, position) {
  const defs = inputDefinitions(info);
  const inputs = [];
  const widgetsValues = [];
  for (const name of inputOrder(info)) {
    const def = defs[name];
    const type = schemaType(def);
    const value = apiNode.inputs?.[name];
    const widget = isWidget(def);
    const input = { name, type };
    if (widget) input.widget = { name };
    else if (info.input?.optional?.[name]) input.shape = 7;
    input.link = null;
    inputs.push(input);
    if (widget) {
      const fallback = Array.isArray(def?.[0]) ? def[1]?.default ?? def[0][0] : def?.[1]?.default;
      widgetsValues.push(value !== undefined && !linkValue(value, prompt) ? value : fallback);
      const cfg = Array.isArray(def) ? def[1] : null;
      if (cfg?.control_after_generate || name === "seed" || name === "noise_seed") {
        widgetsValues.push("fixed");
      }
    }
  }
  const outputs = (info.output ?? []).map((type, index) => ({
    name: info.output_name?.[index] ?? type,
    type,
    links: null,
  }));
  return {
    id: Number(id),
    type: apiNode.class_type,
    pos: position,
    size: defaultSize(apiNode.class_type),
    flags: {},
    order,
    mode: 0,
    inputs,
    outputs,
    properties: nodeProperties(apiNode.class_type, info),
    widgets_values: widgetsValues,
  };
}

function patchDirectorNode(node, apiNode) {
  const inputValues = apiNode.inputs;
  node.id = 46;
  node.title = "Garden timeline · R31 first segment";
  node.widgets_values = [
    inputValues.start_second,
    inputValues.end_second,
    inputValues.duration_seconds,
    inputValues.start_frame,
    inputValues.end_frame,
    inputValues.duration_frames,
    inputValues.timeline_data,
    inputValues.local_prompts,
    inputValues.segment_lengths,
    inputValues.epsilon,
    inputValues.guide_strength,
    inputValues.use_custom_audio,
    inputValues.use_custom_motion,
    inputValues.inpaint_audio,
    inputValues.frame_rate,
    inputValues.display_mode,
    inputValues.custom_width,
    inputValues.custom_height,
    inputValues.resize_method,
    inputValues.divisible_by,
    inputValues.img_compression,
    inputValues.override_audio,
    null,
    inputValues.timeline_ui ?? "",
  ];
  node.properties = {
    ...(node.properties ?? {}),
    queue_i2v_segments: Boolean(inputValues.queue_i2v_segments),
    global_prompt: inputValues.local_prompts,
    "Node name for S&R": "LTXDirector",
  };
  for (const input of node.inputs ?? []) input.link = null;
  for (const output of node.outputs ?? []) output.links = null;
  return node;
}

function patchVhsCombine(node, apiNode) {
  const v = apiNode.inputs;
  node.widgets_values = {
    frame_rate: v.frame_rate,
    loop_count: v.loop_count,
    filename_prefix: v.filename_prefix,
    format: v.format,
    pix_fmt: v.pix_fmt,
    crf: v.crf,
    save_metadata: v.save_metadata,
    trim_to_audio: v.trim_to_audio,
    pingpong: v.pingpong,
    save_output: v.save_output,
    videopreview: { hidden: false, paused: false, params: {} },
  };
  for (const input of node.inputs ?? []) input.link = null;
  for (const output of node.outputs ?? []) output.links = null;
  return node;
}

function patchVhsLoad(node, apiNode) {
  const v = apiNode.inputs;
  node.widgets_values = {
    video: v.video,
    force_rate: v.force_rate,
    custom_width: v.custom_width,
    custom_height: v.custom_height,
    frame_load_cap: v.frame_load_cap,
    skip_first_frames: v.skip_first_frames,
    select_every_nth: v.select_every_nth,
    format: v.format,
    videopreview: {
      hidden: false,
      paused: false,
      params: {
        filename: v.video,
        type: "path",
        force_rate: v.force_rate,
        custom_width: v.custom_width,
        custom_height: v.custom_height,
        frame_load_cap: v.frame_load_cap,
        skip_first_frames: v.skip_first_frames,
        select_every_nth: v.select_every_nth,
      },
    },
  };
  for (const input of node.inputs ?? []) input.link = null;
  for (const output of node.outputs ?? []) output.links = null;
  return node;
}

function computeDepths(prompt) {
  const cache = new Map();
  const visiting = new Set();
  function depth(id) {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let max = 0;
    for (const value of Object.values(prompt[id]?.inputs ?? {})) {
      if (linkValue(value, prompt)) max = Math.max(max, depth(String(value[0])) + 1);
    }
    visiting.delete(id);
    cache.set(id, max);
    return max;
  }
  for (const id of Object.keys(prompt)) depth(id);
  return cache;
}

function layoutPositions(prompt) {
  const depths = computeDepths(prompt);
  const perDepth = new Map();
  const positions = new Map();
  for (const id of Object.keys(prompt).sort((a, b) => Number(a) - Number(b))) {
    const d = depths.get(id) ?? 0;
    const rank = perDepth.get(d) ?? 0;
    perDepth.set(d, rank + 1);
    positions.set(id, [100 + d * 390, 100 + rank * 230]);
  }
  return positions;
}

function cloneSpecialNode(kind, id, type, templates) {
  if (kind === "r31" && type === "LTXDirector") {
    return clone(templates.base.nodes.find((node) => Number(node.id) === 46));
  }
  if (kind === "r32" && type === "ReActorFaceSwap") {
    return clone(templates.reactor.nodes.find((node) => node.type === "ReActorFaceSwap"));
  }
  if (kind === "r32" && type === "VHS_LoadVideoPath") {
    return clone(templates.vhs.nodes.find((node) => node.type === "VHS_LoadVideoPath"));
  }
  if (type === "VHS_VideoCombine") {
    return clone(templates.vhs.nodes.find((node) => node.type === "VHS_VideoCombine"));
  }
  return null;
}

function buildWorkflow(prompt, objectInfo, templates, spec) {
  const positions = layoutPositions(prompt);
  const nodes = [];
  const nodeById = new Map();
  for (const [index, id] of Object.keys(prompt).sort((a, b) => Number(a) - Number(b)).entries()) {
    const apiNode = prompt[id];
    const info = objectInfo[apiNode.class_type];
    if (!info) throw new Error(`Live object_info is missing ${apiNode.class_type}`);
    let node = cloneSpecialNode(spec.kind, id, apiNode.class_type, templates);
    if (node) {
      node.id = Number(id);
      node.order = index;
      node.pos = positions.get(id);
      if (apiNode.class_type === "LTXDirector") node = patchDirectorNode(node, apiNode);
      else if (apiNode.class_type === "VHS_LoadVideoPath") node = patchVhsLoad(node, apiNode);
      else if (apiNode.class_type === "VHS_VideoCombine") node = patchVhsCombine(node, apiNode);
      else {
        const generic = genericNode(id, apiNode, info, prompt, index, positions.get(id));
        node.inputs = generic.inputs;
        node.outputs = generic.outputs;
        node.widgets_values = generic.widgets_values;
        node.size = defaultSize(apiNode.class_type);
        for (const input of node.inputs ?? []) input.link = null;
        for (const output of node.outputs ?? []) output.links = null;
      }
    } else {
      node = genericNode(id, apiNode, info, prompt, index, positions.get(id));
    }
    if (apiNode._meta?.title) node.title = apiNode._meta.title;
    nodes.push(node);
    nodeById.set(String(id), node);
  }

  const links = [];
  let linkId = 1;
  for (const [dstId, apiNode] of Object.entries(prompt)) {
    const dstNode = nodeById.get(dstId);
    for (const [name, value] of Object.entries(apiNode.inputs ?? {})) {
      if (!linkValue(value, prompt)) continue;
      const srcId = String(value[0]);
      const srcSlot = Number(value[1]);
      const srcNode = nodeById.get(srcId);
      let dstSlot = (dstNode.inputs ?? []).findIndex((input) => input.name === name);
      if (dstSlot < 0) {
        const info = objectInfo[apiNode.class_type];
        const type = schemaType(inputDefinitions(info)[name]);
        dstNode.inputs ??= [];
        dstNode.inputs.push({ name, type, link: null });
        dstSlot = dstNode.inputs.length - 1;
      }
      const type = srcNode.outputs?.[srcSlot]?.type ?? dstNode.inputs[dstSlot].type ?? "*";
      const record = [linkId, Number(srcId), srcSlot, Number(dstId), dstSlot, type];
      links.push(record);
      dstNode.inputs[dstSlot].link = linkId;
      srcNode.outputs[srcSlot].links ??= [];
      srcNode.outputs[srcSlot].links.push(linkId);
      linkId += 1;
    }
  }

  return {
    id: crypto.randomUUID(),
    revision: 0,
    last_node_id: Math.max(...nodes.map((node) => Number(node.id))),
    last_link_id: linkId - 1,
    nodes,
    links,
    groups: [],
    config: {},
    extra: {
      info: {
        name: spec.title,
        source_api: path.relative(repoRoot, spec.source).replaceAll("\\", "/"),
        exported_by: "scripts/export-api-prompts-to-comfy-workflows.mjs",
      },
      ds: { scale: 0.6, offset: [0, 0] },
    },
    version: 0.4,
    seed_widgets: prompt["28"] ? { "28": 0 } : {},
  };
}

function validateStructure(workflow) {
  if (workflow.version !== 0.4) throw new Error("Workflow version is not 0.4");
  const nodes = new Map(workflow.nodes.map((node) => [Number(node.id), node]));
  const links = new Map(workflow.links.map((link) => [Number(link[0]), link]));
  if (nodes.size !== workflow.nodes.length) throw new Error("Duplicate node IDs");
  if (links.size !== workflow.links.length) throw new Error("Duplicate link IDs");
  for (const [id, link] of links) {
    const [, src, srcSlot, dst, dstSlot] = link;
    if (!nodes.has(src) || !nodes.has(dst)) throw new Error(`Link ${id} has a missing endpoint`);
    if (nodes.get(dst).inputs?.[dstSlot]?.link !== id) throw new Error(`Link ${id} target socket mismatch`);
    if (!(nodes.get(src).outputs?.[srcSlot]?.links ?? []).includes(id)) throw new Error(`Link ${id} source socket mismatch`);
  }
  for (const node of nodes.values()) {
    for (const input of node.inputs ?? []) {
      if (input.link != null && !links.has(Number(input.link))) throw new Error(`Node ${node.id} has dangling input link`);
    }
    for (const output of node.outputs ?? []) {
      for (const id of output.links ?? []) if (!links.has(Number(id))) throw new Error(`Node ${node.id} has dangling output link`);
    }
  }
}

async function main() {
  const [objectInfo, base, reactor, vhs] = await Promise.all([
    getLiveObjectInfo(),
    readJson(baseWorkflowPath),
    readJson(reactorTemplatePath),
    readJson(vhsTemplatePath),
  ]);
  const templates = { base, reactor, vhs };
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];
  for (const spec of exportsToBuild) {
    const prompt = await readJson(spec.source);
    const workflow = buildWorkflow(prompt, objectInfo, templates, spec);
    validateStructure(workflow);
    await fs.writeFile(spec.output, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    results.push({
      kind: spec.kind,
      output: spec.output,
      source: spec.source,
      nodes: workflow.nodes.length,
      links: workflow.links.length,
      node_classes: [...new Set(workflow.nodes.map((node) => node.type))].length,
    });
  }
  console.log(JSON.stringify({ status: "exported", results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
