import fs from "node:fs";
import path from "node:path";

const projectRoot = "C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0";
const comfyRoot = path.join(projectRoot, "BlokeyUI/ComfyUI");
const workflowDir = path.join(comfyRoot, "user/default/workflows/Premiere316");
const downloadsDir = "C:/Users/Blokey/Downloads";

const ltx23Source = path.join(
  comfyRoot,
  "custom_nodes/ComfyUI-Licon-MSR/LTX-2.3_MSR_sample_workflow_V2.json",
);
const ltx25Source = path.join(
  workflowDir,
  "RIMJOBLTX_LTX25_720x480_5s.json",
);

const referenceImages = [
  "CI_REF_02_FACE.png",
  "CI_REF_03_COSTUME_BODY.png",
  "Jesus.png",
  "character-guardian-leader-hells-champion-appearance.v2.png",
  "CI_REF_01_LAYOUT.png",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nodeById(workflow, id) {
  const node = workflow.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

function nextNodeId(workflow) {
  const ids = [];
  for (const node of workflow.nodes ?? []) {
    if (Number.isInteger(node.id)) ids.push(node.id);
  }
  for (const graph of workflow.definitions?.subgraphs ?? []) {
    for (const node of graph.nodes ?? []) {
      if (Number.isInteger(node.id)) ids.push(node.id);
    }
  }
  return Math.max(workflow.last_node_id ?? 0, ...ids) + 1;
}

function addNote(workflow, title, text, pos) {
  const source = workflow.nodes.find((node) => node.type === "MarkdownNote");
  const id = nextNodeId(workflow);
  const note = source
    ? structuredClone(source)
    : {
        type: "MarkdownNote",
        size: [700, 320],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [],
        properties: {
          cnr_id: "comfy-core",
          ver: "0.33.1",
          "Node name for S&R": "MarkdownNote",
        },
      };
  note.id = id;
  note.pos = pos;
  note.size = [760, 360];
  note.title = title;
  note.mode = 0;
  note.inputs = [];
  note.outputs = [];
  note.widgets_values = text;
  workflow.nodes.push(note);
  workflow.last_node_id = id;
}

function setFrontendVersion(workflow) {
  workflow.extra ??= {};
  workflow.extra.frontendVersion = "1.48.7";
}

function buildLtx23() {
  const workflow = readJson(ltx23Source);
  workflow.id = "e64187d2-2e25-46ee-8fb7-472c2246e823";
  workflow.revision = 0;
  setFrontendVersion(workflow);

  nodeById(workflow, 3).widgets_values = ["ltx2\\ltx2310eros_v14.safetensors"];
  nodeById(workflow, 21).widgets_values = ["ltx2\\ltx2310eros_v14.safetensors"];
  nodeById(workflow, 26).widgets_values = [
    "LTX 2.3\\gemma_3_12B_it_fp8_e4m3fn.safetensors",
    "ltx2\\ltx2310eros_v14.safetensors",
    "default",
  ];
  nodeById(workflow, 10).widgets_values = [
    "LTX\\2.3\\Licon\\MSR\\LTX-2.3-Licon-MSR-V2.safetensors",
    1,
  ];

  const imageNodes = [29, 33, 40, 95, 30];
  const titles = [
    "1. Subject Reference — Primary Identity",
    "2. Subject Reference — Secondary Identity",
    "3. Subject Reference — Third Character / Angle",
    "4. Subject Reference — Fourth Character / Angle",
    "5. Background / Environment Reference",
  ];
  imageNodes.forEach((id, index) => {
    const node = nodeById(workflow, id);
    node.mode = 0;
    node.title = titles[index];
    node.widgets_values = [referenceImages[index], "image"];
  });

  nodeById(workflow, 43).widgets_values = [768];
  nodeById(workflow, 43).title = "Output Width";
  nodeById(workflow, 44).widgets_values = [512];
  nodeById(workflow, 44).title = "Output Height";
  nodeById(workflow, 129).widgets_values = [24];
  nodeById(workflow, 129).title = "Frame Rate";
  const frameRateConverter = nodeById(workflow, 128);
  frameRateConverter.type = "LTXFloatToInt";
  frameRateConverter.title = "Frame Rate — Float to Integer";
  frameRateConverter.inputs = [{ name: "a", type: "FLOAT", link: 455 }];
  frameRateConverter.outputs = [
    { name: "INT", type: "INT", links: [454] },
  ];
  frameRateConverter.properties = {
    cnr_id: "ComfyUI-LTXVideo",
    "Node name for S&R": "LTXFloatToInt",
  };
  frameRateConverter.widgets_values = [];
  nodeById(workflow, 178).widgets_values = [5];
  nodeById(workflow, 178).title = "Duration (seconds)";
  nodeById(workflow, 50).widgets_values = [121];
  nodeById(workflow, 8).widgets_values = [768, 512, 121, 1];
  nodeById(workflow, 22).widgets_values = [121, 24, 1];
  nodeById(workflow, 172).widgets_values = [24, 8];
  nodeById(workflow, 173).widgets_values = ["video/LTX_2.3_MSR_5REF", "auto", "auto"];
  nodeById(workflow, 190).title = "Licon MSR — 4 Subjects + Background";

  nodeById(workflow, 180).widgets_values = [
    [
      "Reference 1 defines the primary subject's identity and face.",
      "Reference 2 defines the secondary subject or an alternate identity.",
      "Reference 3 defines a third character, angle, or wardrobe detail.",
      "Reference 4 defines a fourth character, angle, or prop detail.",
      "Reference 5 defines the environment, lighting, and overall setting.",
      "Preserve each referenced subject's distinct appearance across the complete video.",
    ].join("\n"),
    [
      "A cinematic scene using the supplied subject and environment references.",
      "Keep the primary subject recognizable in every shot, preserve the secondary subjects when visible, and match the referenced wardrobe and environment.",
      "Natural motion, stable anatomy, coherent lighting, realistic camera movement, synchronized environmental audio.",
    ].join(" "),
    "",
    0.0011,
  ];
  nodeById(workflow, 185).widgets_values = [
    "subtitles, watermark, blurry, jittery, distorted anatomy, duplicate people, merged identities, inconsistent appearance, face drift, costume drift, background drift",
  ];

  addNote(
    workflow,
    "LTX-2.3 — Five Reference Images",
    [
      "# LTX-2.3 Multi-Subject Reference",
      "",
      "This workflow uses the Licon MSR V2 layout and its matching LoRA.",
      "",
      "1. Pick up to four subject/angle images.",
      "2. Pick one background/environment image.",
      "3. Describe each reference's role in Prompt Relay.",
      "4. Generate at 768×512, 5 seconds, 24 fps by default.",
      "",
      "The installed Eros v14 checkpoint is used because the official Licon sample checkpoint is not present locally. The graph is selector-validated, but this checkpoint/LoRA pairing still needs a render-quality test.",
    ].join("\n"),
    [-1100, -2050],
  );

  return workflow;
}

function buildLtx25() {
  const workflow = readJson(ltx25Source);
  workflow.id = "6d6a3975-496a-4b31-928f-233782efd425";
  workflow.revision = 0;
  setFrontendVersion(workflow);

  // The source graph carries standalone downloader/checker panels. All model
  // files used here are already installed, and those panels can queue the
  // entire graph when their refresh control is clicked. Keep this delivery
  // focused on generation and remove both the active and bypassed copies.
  workflow.nodes = workflow.nodes.filter(
    (node) => node.type !== "DenoLTXModelDownloader",
  );

  const loader = nodeById(workflow, 5713);
  loader.title = "1–5. Reference Images — Identity / Wardrobe / Environment";
  loader.widgets_values[0] = referenceImages.join("\n");

  const duration = nodeById(workflow, 5036);
  duration.title = "Duration (seconds) — 5";
  duration.widgets_values = [5];

  const referenceResize = nodeById(workflow, 5715);
  referenceResize.title = "Reference Resize — 768px Long Edge";
  referenceResize.widgets_values = ["scale longer dimension", 768, "bicubic"];

  for (const id of [5722, 5727]) {
    const sequencer = nodeById(workflow, id);
    sequencer.title = "Five Reference Guides — 0 / 30 / 60 / 90 / 120";
    sequencer.widgets_values = [
      5,
      "frames",
      24,
      true,
      false,
      0,
      0,
      1,
      30,
      0,
      1,
      60,
      0,
      1,
      90,
      0,
      1,
      120,
      0,
      1,
    ];
  }

  for (const node of workflow.nodes) {
    if (node.type === "SaveVideo" && Array.isArray(node.widgets_values)) {
      node.widgets_values[0] = "video/LTX_2.5_5REF";
    }
  }
  for (const graph of workflow.definitions?.subgraphs ?? []) {
    for (const node of graph.nodes ?? []) {
      if (node.type === "SaveVideo" && Array.isArray(node.widgets_values)) {
        node.widgets_values[0] = "video/LTX_2.5_5REF";
      }
    }
  }

  addNote(
    workflow,
    "LTX-2.5 — Five Reference Images",
    [
      "# LTX-2.5 Five-Reference Guide Workflow",
      "",
      "The reference loader accepts one image path per line and is configured for five images.",
      "The two LTX sequencers apply the same five guide images in both sampling passes.",
      "",
      "Suggested roles:",
      "1. Primary identity / face",
      "2. Wardrobe / body",
      "3. Alternate angle or secondary subject",
      "4. Prop / lighting / style",
      "5. Environment / final composition",
      "",
      "The five guides are distributed across frames 0, 30, 60, 90, and 120 in both sampling passes of the default 5-second / 121-frame clip.",
      "",
      "These are temporal/keyframe guides, not MiniMax-style semantic reference slots. The current graph supports up to 50 guide images if you increase the loader list and sequencer count.",
    ].join("\n"),
    [-4780, 3220],
  );

  return workflow;
}

function writeWorkflow(workflow, name) {
  const text = `${JSON.stringify(workflow, null, 2)}\n`;
  fs.mkdirSync(workflowDir, { recursive: true });
  const destinations = [
    path.join(workflowDir, name),
    path.join(downloadsDir, name),
  ];
  for (const destination of destinations) {
    fs.writeFileSync(destination, text, "utf8");
    console.log(`${destination}\t${Buffer.byteLength(text)} bytes`);
  }
}

writeWorkflow(buildLtx23(), "LTX-2.3 - Reference Five Images.json");
writeWorkflow(buildLtx25(), "LTX-2.5 - Reference Five Images.json");
