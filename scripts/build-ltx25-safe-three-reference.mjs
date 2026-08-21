import fs from "node:fs";
import path from "node:path";

const projectRoot =
  "C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0";
const workflowDir = path.join(
  projectRoot,
  "BlokeyUI/ComfyUI/user/default/workflows/Premiere316",
);
const sourcePath = path.join(
  workflowDir,
  "LTX-2.5 - Reference Five Images.json",
);
const workflowName = "LTX-2.5 - SAFE Three References.json";
const destinations = [
  path.join(workflowDir, workflowName),
  path.join("C:/Users/Blokey/Downloads", workflowName),
];

const referenceImages = [
  "CI_REF_02_FACE.png",
  "CI_REF_03_COSTUME_BODY.png",
  "CI_REF_01_LAYOUT.png",
];

function nodeById(workflow, id) {
  const node = workflow.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

const workflow = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
workflow.id = "18e84164-2d67-4b35-b8d4-1216cc5fb3cb";
workflow.revision = 0;
workflow.extra ??= {};
workflow.extra.frontendVersion = "1.48.7";

nodeById(workflow, 5036).title = "SAFE Duration — 2 seconds / 49 frames";
nodeById(workflow, 5036).widgets_values = [2];

const loader = nodeById(workflow, 5713);
loader.title = "THREE REFERENCES — Face / Body / Environment";
loader.widgets_values[0] = referenceImages.join("\n");

const referenceResize = nodeById(workflow, 5715);
referenceResize.title = "SAFE Reference Resize — 384px Long Edge";
referenceResize.widgets_values = ["scale longer dimension", 384, "bicubic"];

const guideWidgets = [
  3,
  "frames",
  24,
  true,
  false,
  0,
  0,
  1,
  24,
  0,
  1,
  48,
  0,
  1,
];

const firstPassGuides = nodeById(workflow, 5722);
firstPassGuides.title = "Three Reference Guides — Frames 0 / 24 / 48";
firstPassGuides.widgets_values = [...guideWidgets];

const secondPassGuides = nodeById(workflow, 5727);
secondPassGuides.title = "Second Pass — Reuse Cropped Conditioning (No Re-encode)";
secondPassGuides.widgets_values = [...guideWidgets];
secondPassGuides.widgets_values[4] = true;

const intermediatePreview = nodeById(workflow, 5725);
intermediatePreview.title = "DISABLED — Intermediate Preview";
intermediatePreview.mode = 2;

for (const node of workflow.nodes) {
  if (node.type === "SaveVideo" && Array.isArray(node.widgets_values)) {
    node.widgets_values[0] = "video/LTX_2.5_SAFE_3REF";
  }
}
for (const graph of workflow.definitions?.subgraphs ?? []) {
  for (const node of graph.nodes ?? []) {
    if (node.type === "SaveVideo" && Array.isArray(node.widgets_values)) {
      node.widgets_values[0] = "video/LTX_2.5_SAFE_3REF";
    }
  }
}

const note = workflow.nodes.find(
  (node) => node.type === "MarkdownNote" && node.id === 5836,
);
if (!note) throw new Error("Missing safety note node 5836");
note.title = "LTX-2.5 — SAFE Three References";
note.widgets_values = [
  "# LTX-2.5 SAFE Three-Reference Workflow",
  "",
  "This copy uses only the installed LTX-2.5 model family.",
  "",
  "References:",
  "1. Face / primary identity — frame 0",
  "2. Costume / body — frame 24",
  "3. Environment / composition — frame 48",
  "",
  "The intermediate preview is disabled to avoid a mid-run VAE decode and model reload.",
  "The second pass reuses the first-pass conditioning instead of encoding all references again.",
  "The conservative default is 2 seconds at 24 fps, with the final 720x480 delivery path intact.",
  "",
  "These are temporal guide images. LTX-2.5 does not provide MiniMax-style independent semantic reference slots.",
].join("\n");

const text = `${JSON.stringify(workflow, null, 2)}\n`;
for (const destination of destinations) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text, "utf8");
  console.log(`${destination}\t${Buffer.byteLength(text)} bytes`);
}
