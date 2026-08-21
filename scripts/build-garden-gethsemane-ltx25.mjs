import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const repo = String.raw`C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0`;
const workflowRoot = path.join(repo, "BlokeyUI", "ComfyUI", "user", "default", "workflows");
const gardenRoot = path.join(workflowRoot, "Premiere316", "Garden of Gethsemane");
const outputRoot = path.join(gardenRoot, "LTX 2.5");
const diagnosticsRoot = path.join(repo, "diagnostics", "ltx25-workflow-backups");
const inputRoot = path.join(repo, "BlokeyUI", "ComfyUI", "input");

const sourceGenerator = path.join(gardenRoot, "GARDEN_first_segment_R31_voice_identity_8plus3_1128x480_25fps.json");
const sourceFaceCorrection = path.join(gardenRoot, "GARDEN_first_segment_R32_face_correction.json");
const nativeTemplate = path.join(workflowRoot, "Premiere316", "LTX_LTX25_SMART_RESOLUTION_40s.json");

const generatorOutput = path.join(outputRoot, "GARDEN_first_segment_R31_LTX25_native_AV_1128x480_25fps.json");
const faceOutput = path.join(outputRoot, "GARDEN_first_segment_R32_LTX25_face_correction.json");
const manifestOutput = path.join(outputRoot, "GARDEN_LTX25_conversion_manifest.json");

const startGuide = "whatdreamscost/ChatGPT Image Aug 11, 2026, 12_36_25 AM (1).png";
const endGuide = "whatdreamscost/ChatGPT Image Aug 11, 2026, 12_36_25 AM (2).png";
const faceReference = "whatdreamscost/jesus-face-primary-3q.v1.png";
const sourceCharacterSheet = "whatdreamscost/jesus-character-sheet-1536x1024.v1.png";
const sourceVoiceReference = "whatdreamscost/voice-jesus-reference-5s.v1.wav";
const finalWidth = 1128;
const finalHeight = 480;
const fps = 25;
const seconds = 6.76;
const frameCount = 169;
const outputPrefix = "identity_tests/garden-first-segment-r31-ltx25-native";
const expectedVideo = path.join(repo, "BlokeyUI", "ComfyUI", "output", "identity_tests", "garden-first-segment-r31-ltx25-native_00001-audio.mp4");

const prompt = `Photorealistic live-action biblical drama at night in the Garden of Gethsemane on the Mount of Olives, in one uninterrupted 6.76-second 35 mm anamorphic wide-medium master shot. Begin exactly from the supplied opening guide: the camera peers past a softly blurred ancient olive trunk while Jesus stands alone on the right third, facing front-left. He is the same olive-brown-skinned Middle Eastern adult man in both supplied guide frames, with a long angular oval face, deep-set hazel-brown eyes, a strong narrow slightly convex nose, thick dark eyebrows, shoulder-length dense black corkscrew curls, and a dense tapered full black beard. He wears an off-white linen tunic and a dark earth-brown wool mantle and is barefoot. Preserve that face, hairline, curls, beard, eyes, skin, robe, hands, feet, screen direction, and identity throughout.

Jesus takes exactly two slow, heavy, grounded steps while the camera slides gently three feet to the right without changing its axis or subject scale. His shoulders are burdened; his breathing is labored but controlled; his mantle and curls move naturally in the cool night wind. He stops, tightens his fingers once around the mantle, looks toward the earth, and quietly says exactly once, “My Father, if it is possible, let this cup pass from me.” His lips move naturally with the single sentence. He then closes his mouth and says nothing else. He closes his eyes, bends both knees, lowers himself, and reaches the supplied kneeling end-guide pose by the final second. Hold the kneeling pose through the last frames with his face still visible from the front-left. Ancient olive trees, exposed silver-gray roots, dark earth, scattered limestone, sparse grass, faint Jerusalem glow, cool blue-silver moonlight, subtle warm rim light, and restrained haze remain continuous. Native audio contains the single warm resonant male prayer, two footsteps, breath, cloth, olive leaves, and night wind; no music, no repeated words, no second speaker, no cut, no dissolve, no duplicate Jesus, no transformation, and no text.`;

const negative = "worst quality, inconsistent motion, blurry, jittery, distorted";

function clone(value) {
  return structuredClone(value);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").toUpperCase();
}

function findNode(workflow, id, type) {
  const node = workflow.nodes.find((candidate) => Number(candidate.id) === Number(id));
  if (!node || (type && node.type !== type)) {
    throw new Error(`Missing node ${id}${type ? ` (${type})` : ""}`);
  }
  return node;
}

function removeUnlinkedNodes(workflow, ids) {
  const idSet = new Set(ids.map(Number));
  for (const link of workflow.links) {
    if (idSet.has(Number(link[1])) || idSet.has(Number(link[3]))) {
      throw new Error(`Cannot remove linked node referenced by link ${link[0]}`);
    }
  }
  workflow.nodes = workflow.nodes.filter((node) => !idSet.has(Number(node.id)));
}

function addLink(workflow, sourceNodeId, sourceSlot, destinationNodeId, destinationSlot, type) {
  const id = ++workflow.last_link_id;
  const source = findNode(workflow, sourceNodeId);
  const destination = findNode(workflow, destinationNodeId);
  source.outputs[sourceSlot].links ??= [];
  source.outputs[sourceSlot].links.push(id);
  destination.inputs[destinationSlot].link = id;
  workflow.links.push([id, sourceNodeId, sourceSlot, destinationNodeId, destinationSlot, type]);
  return id;
}

function patchSequencer(node) {
  node.widgets_values = [2, "frames", fps, true, false, 0, 0, 1, -1, 0, 1];
  node.properties = {
    ...(node.properties ?? {}),
    num_images: 2,
    frame_rate: fps,
    bypass: false,
    insert_frame_1: 0,
    insert_second_1: 0,
    strength_1: 1,
    insert_frame_2: -1,
    insert_second_2: 0,
    strength_2: 1,
  };
}

function validateGraph(workflow) {
  if (workflow.version !== 0.4) throw new Error("Workflow version is not 0.4");
  const nodes = new Map(workflow.nodes.map((node) => [Number(node.id), node]));
  const links = new Map(workflow.links.map((link) => [Number(link[0]), link]));
  if (nodes.size !== workflow.nodes.length) throw new Error("Duplicate root node IDs");
  if (links.size !== workflow.links.length) throw new Error("Duplicate root link IDs");
  for (const [id, link] of links) {
    const [, sourceId, sourceSlot, destinationId, destinationSlot] = link;
    const source = nodes.get(Number(sourceId));
    const destination = nodes.get(Number(destinationId));
    if (!source || !destination) throw new Error(`Link ${id} has a missing endpoint`);
    if (!source.outputs?.[sourceSlot]) throw new Error(`Link ${id} has an invalid source slot`);
    if (!destination.inputs?.[destinationSlot]) throw new Error(`Link ${id} has an invalid destination slot`);
    if (destination.inputs[destinationSlot].link !== id) throw new Error(`Link ${id} destination back-reference mismatch`);
    if (!(source.outputs[sourceSlot].links ?? []).includes(id)) throw new Error(`Link ${id} source back-reference mismatch`);
  }
}

async function backUpInputs() {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(diagnosticsRoot, `Garden-of-Gethsemane-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });
  for (const source of [sourceGenerator, sourceFaceCorrection]) {
    await fs.copyFile(source, path.join(backupDir, path.basename(source)));
  }
  return backupDir;
}

function buildGenerator(template, source) {
  const workflow = clone(template);
  workflow.id = crypto.randomUUID();
  workflow.revision = 0;

  removeUnlinkedNodes(workflow, [5483, 5797]);

  // The source template serialized a pathological 4096-frame temporal overlap.
  // Keep every final decoder tiled, but use a bounded 64-frame window / 8-frame overlap.
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    for (const node of subgraph.nodes ?? []) {
      if (node.type === "VAEDecodeTiled") node.widgets_values = [512, 64, 64, 8];
    }
  }

  const workflowNote = findNode(workflow, 5045, "MarkdownNote");
  workflowNote.widgets_values = [
    "Enter the exact delivered width and height in the blue FINAL SIZE node. Any even output size is accepted. The workflow calculates a safe 32-aligned stage-one canvas, preserves native x2 latent refinement, then Lanczos-resizes the decoded result to the exact requested pixels. Current Garden default: 1128 x 480, 6.76 s, 169 frames at 25 fps. The optional partial-preview branch is bypassed to avoid a wasteful full-duration preview decode.",
  ];

  const duration = findNode(workflow, 5036, "INTConstant");
  duration.type = "PrimitiveFloat";
  duration.title = "Seconds · 169 frames at 25 fps";
  duration.outputs[0].name = "FLOAT";
  duration.outputs[0].type = "FLOAT";
  duration.widgets_values = [seconds];
  duration.properties = {
    cnr_id: "comfy-core",
    ver: "0.31.0",
    "Node name for S&R": "PrimitiveFloat",
  };
  const durationLink = workflow.links.find((link) => Number(link[0]) === 14345);
  if (!durationLink) throw new Error("Duration calculator link 14345 is missing");
  durationLink[5] = "FLOAT";

  findNode(workflow, 5329, "PrimitiveFloat").widgets_values = [fps];

  const promptNode = findNode(workflow, 5317, "DenoLTXPromptGuide");
  promptNode.title = "Garden first segment · LTX 2.5 prompt";
  promptNode.widgets_values = [prompt, "English", fps, true, negative];

  const loader = findNode(workflow, 5713, "DenoMultiImageLoader");
  loader.title = "Garden opening + kneeling end guides";
  loader.widgets_values = [
    `${startGuide}\n${endGuide}`,
    "Manual Input",
    "21:9",
    0.147456,
    576,
    256,
    "32",
    "lanczos",
    "Center Crop (Fill)",
    "",
  ];
  loader.inputs = [
    { name: "width", type: "INT", widget: { name: "width" }, link: null },
    { name: "height", type: "INT", widget: { name: "height" }, link: null },
  ];
  loader.properties = {
    ...(loader.properties ?? {}),
    __denoOutputImageSize: { width: 576, height: 256 },
  };

  const resolutionSetup = findNode(workflow, 5714, "DenoResolutionSetup");
  resolutionSetup.widgets_values = [
    "Manual Input",
    "21:9",
    0.147456,
    576,
    256,
    "32",
    "Center Crop (Fill)",
    "lanczos",
    0.5,
    0.5,
    1,
  ];

  const emptyLatent = findNode(workflow, 5720, "EmptyLTXVLatentVideo");
  emptyLatent.widgets_values = [576, 256, frameCount, 1];

  patchSequencer(findNode(workflow, 5722, "DenoLTXSequencer"));
  patchSequencer(findNode(workflow, 5727, "DenoLTXSequencer"));

  const resolutionPlan = findNode(workflow, 5836, "LTX25ResolutionPlan");
  resolutionPlan.title = "FINAL SIZE · enter any even LTX 2.5 delivery resolution";
  resolutionPlan.widgets_values = [finalWidth, finalHeight];
  addLink(workflow, 5836, 2, 5713, 0, "INT");
  addLink(workflow, 5836, 3, 5713, 1, "INT");

  const final = findNode(workflow, 5729, "VHS_VideoCombine");
  final.title = "GARDEN R31 · LTX 2.5 native AV · exact final resolution";
  final.widgets_values = {
    ...(final.widgets_values ?? {}),
    frame_rate: fps,
    filename_prefix: outputPrefix,
    format: "video/h264-mp4",
    pix_fmt: "yuv420p",
    crf: 18,
    save_metadata: true,
    trim_to_audio: false,
    save_output: true,
  };

  const sourceDirector = findNode(source, 46, "LTXDirector");
  const sourceNegative = findNode(source, 26, "CLIPTextEncode").widgets_values;
  const sourceTimeline = sourceDirector.widgets_values[6];
  const sourcePrompt = sourceDirector.widgets_values[7];

  workflow.extra ??= {};
  workflow.extra.info = {
    name: "GARDEN R31 · Native LTX 2.5 AV · 1128x480 · 25 fps",
    conversion: "Native LTX 2.5 distilled INT8 two-stage conversion",
    source_workflow: path.relative(repo, sourceGenerator).replaceAll("\\", "/"),
    model: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    text_encoder: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
    video_vae: "LTX/2.5/ltx-2.5-video-vae-bf16.safetensors",
    audio_vae: "LTX/2.5/ltx-2.5-audio-vae-bf16.safetensors",
    spatial_upscaler: "LTX/2.5/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    identity_finish: path.basename(faceOutput),
    note: "Deleted legacy identity, pose, detail, and TalkVid LoRAs are intentionally not referenced. R32 performs the face-identity finishing pass and preserves this workflow's native audio.",
    feature_parity: {
      scene_and_motion_guides: "ported to native LTX 2.5 I2V guides",
      face_identity: "handled by the paired R32 ReActor finishing workflow",
      voice_identity: "not ported; the deleted legacy TalkVid adapter is not claimed compatible with LTX 2.5",
      audio: "native LTX 2.5 generated audio is preserved into R32",
    },
    source_semantics: {
      positive_prompt: sourcePrompt,
      positive_prompt_sha256: sha256Text(sourcePrompt),
      negative_prompt: sourceNegative,
      negative_prompt_sha256: sha256Text(sourceNegative),
      director_timeline_json: sourceTimeline,
      director_timeline_sha256: sha256Text(sourceTimeline),
      character_sheet: sourceCharacterSheet,
      voice_reference: sourceVoiceReference,
      note: "Preserved for provenance only; the executable LTX 2.5 graph uses the rewritten prompt and does not claim legacy voice-adapter compatibility.",
    },
  };
  workflow.last_node_id = Math.max(...workflow.nodes.map((node) => Number(node.id)));
  validateGraph(workflow);

  const serialized = JSON.stringify(workflow);
  if (/LTX.?2\.3|LTX23|ltx.?23|gemma_3_12B|ltx-2\.3/i.test(serialized)) {
    throw new Error("Converted generator still contains an LTX 2.3 model reference");
  }
  if (!serialized.includes("ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors")) {
    throw new Error("Converted generator is missing the LTX 2.5 distilled model");
  }
  if (!serialized.includes("LTX25ResolutionPlan")) throw new Error("Exact-resolution control is missing");
  if (workflow.nodes.some((node) => node.type === "LTX2_NAG")) throw new Error("Unsafe NAG node remains");
  return workflow;
}

function buildFaceCorrection(source) {
  const workflow = clone(source);
  workflow.id = crypto.randomUUID();
  workflow.revision = 0;
  const load = findNode(workflow, 1, "VHS_LoadVideoPath");
  load.title = "Load LTX 2.5 Garden R31 output";
  load.widgets_values.video = expectedVideo;
  load.widgets_values.force_rate = fps;
  load.widgets_values.frame_load_cap = frameCount;
  load.widgets_values.videopreview ??= { hidden: false, paused: false, params: {} };
  load.widgets_values.videopreview.params = {
    filename: expectedVideo,
    type: "path",
    force_rate: fps,
    custom_width: 0,
    custom_height: 0,
    frame_load_cap: frameCount,
    skip_first_frames: 0,
    select_every_nth: 1,
  };

  const reference = findNode(workflow, 2, "LoadImage");
  reference.title = "Canonical Jesus face reference";
  reference.widgets_values = [faceReference];

  const reactor = findNode(workflow, 3, "ReActorFaceSwap");
  reactor.title = "R32 · Canonical face correction after LTX 2.5 decode";

  const output = findNode(workflow, 4, "VHS_VideoCombine");
  output.title = "GARDEN R32 · LTX 2.5 face-corrected · original audio";
  output.widgets_values = {
    ...(output.widgets_values ?? {}),
    frame_rate: fps,
    filename_prefix: "identity_tests/garden-first-segment-r32-ltx25-face-correction",
    format: "video/h264-mp4",
    pix_fmt: "yuv420p",
    crf: 16,
    save_metadata: true,
    trim_to_audio: false,
    save_output: true,
  };

  workflow.extra ??= {};
  workflow.extra.info = {
    name: "GARDEN R32 · LTX 2.5 face correction",
    source_workflow: path.relative(repo, sourceFaceCorrection).replaceAll("\\", "/"),
    generator_workflow: path.basename(generatorOutput),
    input_video: expectedVideo,
    face_reference: faceReference,
    audio: "Passed through unchanged from the native LTX 2.5 R31 output",
  };
  validateGraph(workflow);
  return workflow;
}

async function main() {
  for (const relative of [startGuide, endGuide, faceReference, sourceCharacterSheet, sourceVoiceReference]) {
    const filePath = path.join(inputRoot, ...relative.split("/"));
    await fs.access(filePath);
  }
  const originalHashesBefore = {
    r31: await sha256(sourceGenerator),
    r32: await sha256(sourceFaceCorrection),
  };
  const [template, generatorSource, faceSource] = await Promise.all([
    readJson(nativeTemplate),
    readJson(sourceGenerator),
    readJson(sourceFaceCorrection),
  ]);
  const backupDir = await backUpInputs();
  await fs.mkdir(outputRoot, { recursive: true });

  for (const existing of [generatorOutput, faceOutput, manifestOutput]) {
    try {
      await fs.access(existing);
      await fs.copyFile(existing, path.join(backupDir, path.basename(existing)));
    } catch {
      // No prior converted artifact to preserve.
    }
  }

  const generator = buildGenerator(template, generatorSource);
  const face = buildFaceCorrection(faceSource);
  await fs.writeFile(generatorOutput, `${JSON.stringify(generator, null, 2)}\n`, "utf8");
  await fs.writeFile(faceOutput, `${JSON.stringify(face, null, 2)}\n`, "utf8");

  const originalHashesAfter = {
    r31: await sha256(sourceGenerator),
    r32: await sha256(sourceFaceCorrection),
  };
  if (JSON.stringify(originalHashesBefore) !== JSON.stringify(originalHashesAfter)) {
    throw new Error("An original Garden workflow changed during conversion");
  }

  const manifest = {
    status: "converted_not_rendered",
    created_at: new Date().toISOString(),
    originals_preserved: true,
    backup_dir: backupDir,
    source_hashes: originalHashesAfter,
    outputs: {
      generator: {
        path: generatorOutput,
        sha256: await sha256(generatorOutput),
        nodes: generator.nodes.length,
        links: generator.links.length,
        final_resolution: [finalWidth, finalHeight],
        stage1_resolution: [576, 256],
        native_x2_resolution: [1152, 512],
        fps,
        frames: frameCount,
        seconds: frameCount / fps,
        guide_images: [startGuide, endGuide],
        output_prefix: outputPrefix,
        source_semantics: {
          positive_prompt_sha256: generator.extra.info.source_semantics.positive_prompt_sha256,
          negative_prompt_sha256: generator.extra.info.source_semantics.negative_prompt_sha256,
          director_timeline_sha256: generator.extra.info.source_semantics.director_timeline_sha256,
          character_sheet: sourceCharacterSheet,
          voice_reference: sourceVoiceReference,
          executable_prompt_sha256: sha256Text(prompt),
          executable_negative_sha256: sha256Text(negative),
        },
      },
      face_correction: {
        path: faceOutput,
        sha256: await sha256(faceOutput),
        nodes: face.nodes.length,
        links: face.links.length,
        expected_input_video: expectedVideo,
        face_reference: faceReference,
      },
    },
    validation: {
      json_parse: "passed",
      graph_links: "passed",
      no_ltx23_model_references: true,
      no_nag: true,
      exact_resolution_control: true,
      tiled_decode: { tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
      legacy_identity_and_voice_loras: "intentionally omitted as unvalidated on LTX 2.5",
      render: "not submitted",
    },
  };
  await fs.writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
