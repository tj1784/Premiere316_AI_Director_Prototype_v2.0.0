import fs from "node:fs";
import path from "node:path";
import { graphToApi } from "../server/comfy.js";
import {
  buildSegmentJobs,
  patchPrompt,
  workspaceFromWorkflow,
} from "../director-webapp/workflow-compiler.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(
  repoRoot,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "LTX 2.5 Music Video",
  "LTX25_MUSIC_VIDEO_24GB_60s_BLOCK_6x10s_DIRECTOR.json",
);
const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(route) {
  const response = await fetch(`${comfyUrl}${route}`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `${route} failed with HTTP ${response.status}`);
  return response.json();
}

const graph = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const nodeIds = graph.nodes.map((node) => node.id);
const linkIds = graph.links.map((link) => link[0]);
assert(new Set(nodeIds).size === nodeIds.length, "Duplicate visual node ID");
assert(new Set(linkIds).size === linkIds.length, "Duplicate visual link ID");

for (const link of graph.links) {
  const [id, sourceId, sourceSlot, targetId, targetSlot, type] = link;
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  assert(source, `Link ${id} has missing source node ${sourceId}`);
  assert(target, `Link ${id} has missing target node ${targetId}`);
  assert(source.outputs?.[sourceSlot], `Link ${id} has invalid source slot ${sourceSlot}`);
  assert(target.inputs?.[targetSlot], `Link ${id} has invalid target slot ${targetSlot}`);
  assert(target.inputs[targetSlot].link === id, `Link ${id} is not recorded on its target input`);
  assert(
    (source.outputs[sourceSlot].links || []).includes(id),
    `Link ${id} is not recorded on its source output`,
  );
  assert(
    source.outputs[sourceSlot].type === type || source.outputs[sourceSlot].type === "*",
    `Link ${id} source type mismatch`,
  );
}

const objectInfo = await fetchJson("/object_info");
const virtualTypes = new Set(["MarkdownNote"]);
const missingTypes = [
  ...new Set(
    graph.nodes
      .filter((node) => !objectInfo[node.type] && !virtualTypes.has(node.type))
      .map((node) => node.type),
  ),
];
assert(missingTypes.length === 0, `Missing live node types: ${missingTypes.join(", ")}`);

const converted = graphToApi(graph, objectInfo);
assert(converted.warnings.length === 0, `graphToApi warnings: ${converted.warnings.join(" | ")}`);
const prompt = converted.prompt;

assert(
  prompt["95"].inputs.unet_name ===
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  "The current-24GB workflow must use the distilled INT8 ConvRot transformer",
);
assert(
  prompt["84"].inputs.clip_name ===
    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
  "The current-24GB workflow must use projected Gemma 4 INT8",
);
assert(prompt["29"].inputs.sampler_name === "euler_ancestral", "Stage one sampler mismatch");
assert(prompt["53"].inputs.sampler_name === "euler", "Stage two sampler mismatch");
assert(prompt["9"].inputs.cfg === 1, "Stage one CFG must be 1");
assert(prompt["49"].inputs.cfg === 1, "Stage two CFG must be 1");
assert(
  prompt["11"].inputs.sigmas ===
    "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
  "Stage one sigma schedule mismatch",
);
assert(
  prompt["96"].inputs.sigmas === "0.909375, 0.725, 0.421875, 0.0",
  "Stage two sigma schedule mismatch",
);

assert(prompt["46"].inputs.custom_width[0] === "205", "Director width is not driven by resolution plan");
assert(prompt["46"].inputs.custom_height[0] === "205", "Director height is not driven by resolution plan");
assert(prompt["132"].inputs.width[0] === "205", "Final width is not driven by resolution plan");
assert(prompt["132"].inputs.height[0] === "205", "Final height is not driven by resolution plan");
assert(prompt["205"].inputs.final_width === 1024, "Default final width mismatch");
assert(prompt["205"].inputs.final_height === 576, "Default final height mismatch");

assert(prompt["46"].inputs.duration_frames === 240, "Editorial shot must request 240 frames");
assert(prompt["46"].inputs.frame_rate === 24, "Editorial frame rate must be 24 fps");
const timeline = JSON.parse(prompt["46"].inputs.timeline_data);
assert(timeline.segments.length === 6, "The block template must contain six shots");
assert(
  timeline.segments.every(
    (segment, index) => segment.start === index * 240 && segment.length === 240,
  ),
  "The six block shots must be contiguous 240-frame ranges",
);
assert(timeline.segments.at(-1).start + timeline.segments.at(-1).length === 1440, "Block must total 1,440 frames");
assert(prompt["46"].inputs.inpaint_audio === false, "Custom soundtrack must not be regenerated");
const directorProperties = nodes.get(46).properties;
const propertyTimeline = JSON.parse(directorProperties.timeline_data);
assert(directorProperties.frame_rate === 24, "Director properties contain stale FPS");
assert(directorProperties.duration_frames === 240, "Director properties contain stale active duration");
assert(directorProperties.custom_width === 512, "Director properties contain stale stage-one width");
assert(directorProperties.custom_height === 288, "Director properties contain stale stage-one height");
assert(propertyTimeline.segments.length === 6, "Director properties contain a stale timeline");
assert(propertyTimeline.segments.at(-1).start + propertyTimeline.segments.at(-1).length === 1440, "Property timeline is not 60 seconds");

assert(prompt["94"].inputs.images[0] === "206", "MP4 must use the exact 240-frame crop");
assert(prompt["206"].inputs.batch_index === 0, "Editorial crop must begin at frame zero");
assert(prompt["206"].inputs.length === 240, "Editorial crop must output exactly 240 frames");
assert(prompt["200"].inputs.image[0] === "132", "Boundary handoff must use the uncropped 241-frame sequence");
assert(prompt["200"].inputs.batch_index === -1, "Boundary handoff must select the generated endpoint frame");
assert(prompt["94"].inputs.audio[0] === "46" && prompt["94"].inputs.audio[1] === 7, "MP4 must use the Director source-audio slice");
assert(prompt["202"].inputs.anything[0] === "207", "GPU cleanup must wait on the dual-save barrier");
assert(prompt["207"].inputs.any_1[0] === "94", "Save barrier is missing the MP4 dependency");
assert(prompt["207"].inputs.any_2[0] === "201", "Save barrier is missing the handoff PNG dependency");

const sourceText = fs.readFileSync(workflowPath, "utf8");
const workspace = workspaceFromWorkflow(graph, sourceText, comfyUrl);
assert(workspace.settings.frameRate === 24, "Director webapp imports the wrong FPS");
assert(workspace.settings.customWidth === 1024, "Director webapp imports the wrong final width");
assert(workspace.settings.customHeight === 576, "Director webapp imports the wrong final height");
assert(workspace.stats.durationFrames === 1440, "Director webapp imports the wrong block duration");
const selectedJobs = buildSegmentJobs(workspace, timeline.segments[0].id);
assert(selectedJobs.length === 1, "The selected first shot must compile to one job");
assert(selectedJobs[0].requestedFrames === 240, "Selected job requested-frame contract mismatch");
assert(selectedJobs[0].generationFrames === 241, "Selected job generation-frame contract mismatch");
const patched = patchPrompt(prompt, workspace, selectedJobs[0]).prompt;
assert(patched["205"].inputs.final_width === 1024, "Webapp patch bypassed resolution-plan width");
assert(patched["205"].inputs.final_height === 576, "Webapp patch bypassed resolution-plan height");
assert(patched["46"].inputs.custom_width[0] === "205" && patched["46"].inputs.custom_width[1] === 2, "Webapp patch broke stage-one width link");
assert(patched["46"].inputs.custom_height[0] === "205" && patched["46"].inputs.custom_height[1] === 3, "Webapp patch broke stage-one height link");
assert(patched["206"].inputs.length === 240, "Webapp patch broke exact editorial crop");

const outputNodes = Object.entries(prompt)
  .filter(([, node]) => objectInfo[node.class_type]?.output_node)
  .map(([id, node]) => `${id}:${node.class_type}`)
  .sort();
assert(outputNodes.includes("94:VHS_VideoCombine"), "Final MP4 output node is missing");
assert(outputNodes.includes("201:SaveImage"), "Last-frame output node is missing");
assert(outputNodes.includes("202:easy cleanGpuUsed"), "Post-save VRAM cleanup node is missing");

const queue = await fetchJson("/queue");
const report = {
  workflowPath,
  comfyUrl,
  visualNodes: graph.nodes.length,
  visualLinks: graph.links.length,
  apiNodes: Object.keys(prompt).length,
  missingTypes,
  graphWarnings: converted.warnings,
  outputNodes,
  currentProfile: {
    model: prompt["95"].inputs.unet_name,
    clip: prompt["84"].inputs.clip_name,
    finalResolution: [prompt["205"].inputs.final_width, prompt["205"].inputs.final_height],
    fps: prompt["46"].inputs.frame_rate,
    requestedFramesPerShot: prompt["46"].inputs.duration_frames,
    generatedFramesPerShot: 241,
    shotsPerBlock: timeline.segments.length,
    audioConfigured: timeline.audioSegments.length > 0 && workspace.settings.useCustomAudio,
    queueBlocker: timeline.audioSegments.length > 0
      ? null
      : "Add the full soundtrack to the Director AUDIO track before queueing.",
  },
  queueObservedReadOnly: {
    running: queue.queue_running?.length || 0,
    pending: queue.queue_pending?.length || 0,
  },
};

console.log(JSON.stringify(report, null, 2));
