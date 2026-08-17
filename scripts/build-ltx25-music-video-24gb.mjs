import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
  repoRoot,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "Garden of Gethsemane",
  "LTX 2.5",
  "GARDEN_first_segment_R31_LTX25_native_AV_1128x480_25fps.json",
);
const outputDir = path.join(
  repoRoot,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "LTX 2.5 Music Video",
);
const outputPath = path.join(
  outputDir,
  "LTX25_MUSIC_VIDEO_24GB_60s_BLOCK_6x10s_DIRECTOR.json",
);

const workflow = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
const linkById = new Map(workflow.links.map((link) => [link[0], link]));

const fps = 24;
const shotFrames = 240;
const blockFrames = 1440;
const shotSeconds = shotFrames / fps;

const globalPrompt = `Photorealistic live-action biblical epic for a theatrical Passion of Christ music video. The same historically grounded Jesus remains recognizable across every shot: olive-brown Middle Eastern skin, long angular oval face, deep-set dark brown eyes, thick dark eyebrows, strong narrow slightly convex nose, shoulder-length dense dark wavy curls, and a full tapered dark beard. He wears weathered off-white linen and a dark earth-brown mantle. Preserve face, hair, beard, anatomy, wardrobe, screen direction, lighting logic, and emotional continuity. Cinematic 35 mm anamorphic photography, restrained natural camera movement, realistic skin and cloth physics, deep blacks with readable facial detail, no generated text, no logo, no duplicate Jesus, no identity drift, and no abrupt transformation. The supplied soundtrack is the temporal source of truth: motion intensity, cuts, gesture energy, and camera acceleration follow its phrasing without changing the audio.`;

const shotPrompts = [
  `Shot 1, 00:00-00:10 — Gethsemane prelude. Begin from the supplied approved first-frame image. Jesus stands alone among ancient olive trees at night while leaves and linen move in a cold wind. The camera makes a slow chest-height lateral move; he takes two burdened steps and stops. Keep his face readable and his motion restrained as the music establishes grief. One continuous shot, no cut inside this segment.`,
  `Shot 2, 00:10-00:20 — Betrayal approaches. Continue exactly from the prior accepted final frame. Torchlight grows between the trees and distant figures approach while Jesus turns toward the sound without changing identity or wardrobe. The camera eases backward on the established axis as the soundtrack gains pressure. One continuous shot, no teleportation or duplicate subject.`,
  `Shot 3, 00:20-00:30 — Arrest and resolve. Continue from the prior final frame. Jesus remains calm as guards enter the deep background; chains, torch smoke, and wind react to the musical accents. Use a controlled medium-wide tracking move and preserve the same facial geometry, hair, beard, costume, and night palette. One continuous shot.`,
  `Shot 4, 00:30-00:40 — Procession toward Calvary. Continue from the prior final frame with coherent geography. Jesus advances under increasing physical burden while the camera tracks beside him at waist height. Dust, cloth, breath, and crowd motion rise with the soundtrack, but his body remains anatomically stable and his identity unchanged. One continuous shot.`,
  `Shot 5, 00:40-00:50 — The cross and gathering darkness. Continue from the prior final frame. The camera widens gradually as storm clouds close over the hill and the surrounding world darkens. Keep the visual treatment solemn and historically grounded; no fantasy halo, no text, and no discontinuous costume or face change. One continuous shot.`,
  `Shot 6, 00:50-01:00 — Sacrifice into promised victory. Continue from the prior final frame. The soundtrack reaches its first-block climax as darkness, wind, and distant light build around Jesus. The camera performs one deliberate rising pullback, preserving his exact face and silhouette, then settles on a strong handoff composition for the next block. One continuous shot with a stable final frame.`,
];

const segments = shotPrompts.map((prompt, index) => ({
  id: `music-block01-shot${String(index + 1).padStart(2, "0")}`,
  start: index * shotFrames,
  length: shotFrames,
  prompt,
  type: index === 0 ? "image" : "text",
  ...(index === 0
    ? {
        imageFile: "char-jesus-main.v4.png",
        imageB64: "/api/view?filename=char-jesus-main.v4.png&type=input",
        isEndFrame: false,
        guideStrength: 1,
      }
    : {}),
}));

const timeline = {
  mainTrackEnabled: true,
  audioTrackEnabled: true,
  motionTrackEnabled: false,
  propHeight: 96,
  globalPropHeight: 330,
  showFilenames: true,
  overrideAudio: false,
  inpaint_audio: false,
  global_prompt: globalPrompt,
  retake_global_prompt: "",
  retakeMode: false,
  retakeStart: 0,
  retakeLength: shotFrames,
  retakePrompt: "",
  retakeStrength: 1,
  retakeVideo: null,
  normalStartFrame: 0,
  normalDurationFrames: shotFrames,
  segments,
  motionSegments: [],
  audioSegments: [],
};

workflow.id = "4c85eff7-a8da-48e6-9c61-24d9fe7ac6cf";
workflow.revision = 0;

const director = byId.get(46);
director.title = "LTX Director · 24GB music-video shot worker · 60s block / 6 x 10s";
director.size = [1120, 1320];
director.widgets_values = [
  0,
  shotSeconds,
  shotSeconds,
  0,
  shotFrames,
  shotFrames,
  JSON.stringify(timeline),
  shotPrompts[0],
  String(shotFrames),
  0.99,
  "1.00",
  false,
  false,
  false,
  fps,
  "seconds",
  512,
  288,
  "crop",
  32,
  22,
  false,
  null,
  "",
];
Object.assign(director.properties, {
  queue_i2v_segments: false,
  global_prompt: globalPrompt,
  mainTrackEnabled: true,
  audioTrackEnabled: true,
  motionTrackEnabled: false,
  audioTrackWasEnabledBeforeOverride: false,
  inpaint_audio: false,
  override_audio: false,
  overrideAudio: false,
  showFilenames: true,
  use_custom_audio: false,
  use_custom_motion: false,
  frame_rate: fps,
  display_mode: "seconds",
  custom_width: 512,
  custom_height: 288,
  resize_method: "crop",
  divisible_by: 32,
  img_compression: 22,
  guide_strength: "1.00",
  local_prompts: shotPrompts[0],
  segment_lengths: String(shotFrames),
  timeline_data: JSON.stringify(timeline),
  epsilon: 0.99,
  start_second: 0,
  end_second: shotSeconds,
  duration_seconds: shotSeconds,
  start_frame: 0,
  end_frame: shotFrames,
  duration_frames: shotFrames,
  propHeight: timeline.propHeight,
  globalPropHeight: timeline.globalPropHeight,
  retakeMode: false,
});

const negative = byId.get(26);
negative.title = "Short safety negative · CFG 1 has limited negative leverage";
negative.widgets_values = [
  "worst quality, inconsistent motion, blurry, jittery, distorted, duplicate Jesus, identity drift, face morphing, extra limbs, malformed hands, malformed feet, costume change, text, subtitles, logo, watermark",
];

byId.get(3).title = "LTX 2.5 Video VAE BF16";
byId.get(4).title = "LTX 2.5 Audio VAE BF16 · soundtrack encode";
byId.get(11).title = "Distilled stage 1 · official 8-step sigmas";
byId.get(15).title = "Tiled video decode · 24GB-safe temporal chunks";
byId.get(16).title = "Optional sampled-audio monitor · not used as music master";
byId.get(57).title = "Native latent x2 · size follows blue resolution control";
byId.get(84).title = "Gemma 4 12B projected INT8 · unloads before diffusion";
byId.get(95).title = "CURRENT GPU · LTX 2.5 Distilled INT8 ConvRot";
byId.get(96).title = "Distilled stage 2 · official refinement sigmas";
byId.get(96).widgets_values = ["0.909375, 0.725, 0.421875, 0.0"];

const finalScale = byId.get(132);
finalScale.title = "Exact delivery size · driven by blue resolution control";
finalScale.widgets_values = ["lanczos", 1024, 576, "center"];
finalScale.pos = [8680, 100];

const resolutionPlan = {
  id: 205,
  type: "LTX25ResolutionPlan",
  pos: [1680, -500],
  size: [430, 190],
  flags: {},
  order: 35,
  mode: 0,
  inputs: [],
  outputs: [
    { localized_name: "final_width", name: "final_width", type: "INT", links: [99] },
    { localized_name: "final_height", name: "final_height", type: "INT", links: [100] },
    { localized_name: "stage1_width", name: "stage1_width", type: "INT", links: [97] },
    { localized_name: "stage1_height", name: "stage1_height", type: "INT", links: [98] },
    { localized_name: "native_x2_width", name: "native_x2_width", type: "INT", links: null },
    { localized_name: "native_x2_height", name: "native_x2_height", type: "INT", links: null },
    { localized_name: "resolution_summary", name: "resolution_summary", type: "STRING", links: null },
  ],
  title: "FINAL RESOLUTION · enter any width/height (default 1024x576)",
  properties: {
    "Node name for S&R": "LTX25ResolutionPlan",
    bundle_path: "custom_nodes/ltx25_smart_controls/__init__.py",
  },
  widgets_values: [1024, 576],
  color: "#173c50",
  bgcolor: "#245e7b",
};

// The custom resolution planner chooses the smallest 32-aligned stage-one
// canvas whose native x2 result covers the requested delivery dimensions.
// The final decoded ImageScale then produces the exact requested pixels.
director.inputs[6].link = 97;
director.inputs[7].link = 98;
finalScale.inputs = [
  finalScale.inputs[0],
  { localized_name: "width", name: "width", type: "INT", widget: { name: "width" }, link: 99 },
  { localized_name: "height", name: "height", type: "INT", widget: { name: "height" }, link: 100 },
];

const videoSave = byId.get(94);
videoSave.title = "Save exact 240-frame shot · Director soundtrack must be loaded";
videoSave.pos = [9410, 100];
videoSave.widgets_values = {
  frame_rate: ["46", 6],
  loop_count: 0,
  filename_prefix: "music_video/ltx25_24gb/block01_shot01",
  format: "video/h264-mp4",
  pix_fmt: "yuv420p",
  crf: 18,
  save_metadata: true,
  trim_to_audio: true,
  pingpong: false,
  save_output: true,
  videopreview: { hidden: false, paused: false, params: {} },
};

const imageFromBatch = {
  id: 200,
  type: "ImageFromBatch",
  pos: [9050, 500],
  size: [250, 150],
  flags: {},
  order: 30,
  mode: 0,
  inputs: [
    { localized_name: "image", name: "image", type: "IMAGE", link: 94 },
    { localized_name: "batch_index", name: "batch_index", type: "INT", widget: { name: "batch_index" }, link: null },
    { localized_name: "length", name: "length", type: "INT", widget: { name: "length" }, link: null },
  ],
  outputs: [{ localized_name: "IMAGE", name: "IMAGE", type: "IMAGE", links: [95] }],
  title: "Get absolute last frame for next shot",
  properties: {
    cnr_id: "comfy-core",
    ver: "0.33.1",
    "Node name for S&R": "ImageFromBatch",
  },
  widgets_values: [-1, 1],
};

const cropEditorialFrames = {
  id: 206,
  type: "ImageFromBatch",
  pos: [8990, 80],
  size: [290, 150],
  flags: {},
  order: 30,
  mode: 0,
  inputs: [
    { localized_name: "image", name: "image", type: "IMAGE", link: 93 },
    { localized_name: "batch_index", name: "batch_index", type: "INT", widget: { name: "batch_index" }, link: null },
    { localized_name: "length", name: "length", type: "INT", widget: { name: "length" }, link: null },
  ],
  outputs: [{ localized_name: "IMAGE", name: "IMAGE", type: "IMAGE", links: [101] }],
  title: "Conform LTX 241 frames to exact 240-frame editorial shot",
  properties: {
    cnr_id: "comfy-core",
    ver: "0.33.1",
    "Node name for S&R": "ImageFromBatch",
  },
  widgets_values: [0, shotFrames],
};

const saveHandoff = {
  id: 201,
  type: "SaveImage",
  pos: [9410, 500],
  size: [330, 310],
  flags: {},
  order: 31,
  mode: 0,
  inputs: [
    { localized_name: "images", name: "images", type: "IMAGE", link: 95 },
    { localized_name: "filename_prefix", name: "filename_prefix", type: "STRING", widget: { name: "filename_prefix" }, link: null },
  ],
  outputs: [{ localized_name: "images", name: "images", type: "IMAGE", links: null }],
  title: "Save handoff frame · orchestrator uploads into next shot",
  properties: {
    cnr_id: "comfy-core",
    ver: "0.33.1",
    "Node name for S&R": "SaveImage",
  },
  widgets_values: ["music_video/ltx25_24gb/handoff/block01_shot01_last"],
};

const cleanGpu = {
  id: 202,
  type: "easy cleanGpuUsed",
  pos: [9790, 100],
  size: [270, 60],
  flags: {},
  order: 32,
  mode: 0,
  inputs: [{ localized_name: "anything", name: "anything", type: "*", link: 103 }],
  outputs: [{ localized_name: "output", name: "output", type: "*", links: null }],
  title: "After save · release cached VRAM",
  properties: {
    cnr_id: "comfyui-easy-use",
    "Node name for S&R": "easy cleanGpuUsed",
  },
  widgets_values: [],
  color: "#332922",
  bgcolor: "#593930",
};

const saveBarrier = {
  id: 207,
  type: "easy batchAnything",
  pos: [9790, 250],
  size: [270, 90],
  flags: {},
  order: 36,
  mode: 0,
  inputs: [
    { localized_name: "any_1", name: "any_1", type: "*", link: 96 },
    { localized_name: "any_2", name: "any_2", type: "*", link: 102 },
  ],
  outputs: [{ localized_name: "batch", name: "batch", type: "*", links: [103] }],
  title: "Wait for MP4 + boundary-frame PNG",
  properties: {
    cnr_id: "comfyui-easy-use",
    "Node name for S&R": "easy batchAnything",
  },
  widgets_values: [],
};

const notes = [
  {
    id: 203,
    type: "MarkdownNote",
    pos: [100, -520],
    size: [690, 390],
    flags: {},
    order: 33,
    mode: 0,
    inputs: [],
    outputs: [],
    title: "CURRENT HARDWARE PROFILE · READ FIRST",
    properties: {},
    widgets_values: [
      "# CURRENT GPU: RTX 5090 Laptop · 24 GB\n\n- Uses LTX 2.5 **Distilled INT8 ConvRot** and projected Gemma 4 INT8.\n- Enter any delivery size in the blue **FINAL RESOLUTION** node; it automatically chooses a safe 32-aligned stage-one canvas and preserves native x2 refinement.\n- Default is **1024x576**. Weight quantization does not reduce pixel resolution.\n- Render one 5-10 second shot at a time. A 60-90 second block is assembled from 6-9 shots.\n- Do not switch this file to the 42 GB BF16 Dev transformer on a 24 GB card.",
    ],
    color: "#432",
    bgcolor: "#653",
  },
  {
    id: 204,
    type: "MarkdownNote",
    pos: [830, -520],
    size: [760, 390],
    flags: {},
    order: 34,
    mode: 0,
    inputs: [],
    outputs: [],
    title: "AUDIO + BLOCK WORKFLOW",
    properties: {},
    widgets_values: [
      "# 4-minute soundtrack workflow\n\n**Do not queue until the soundtrack is loaded.**\n\n1. Open the LTX Director node or the 8791 Director UI.\n2. Add the full soundtrack once on the AUDIO track at frame 0.\n3. Keep **Inpaint Audio OFF** so the encoded soundtrack slice is frozen, not regenerated.\n4. Select one 10-second main-track shot and queue it. The node slices audio by the selected start frame automatically.\n5. The saved 241st-frame PNG is the exact next-boundary I2V anchor; the MP4 is cropped to 240 frames. The 8791 sequential runner should upload and patch it automatically; in raw ComfyUI select it manually.\n6. Concatenate requested frames and remux the original soundtrack when the 60-90 second block is complete.",
    ],
    color: "#243b4a",
    bgcolor: "#31576b",
  },
];

workflow.nodes.push(
  imageFromBatch,
  saveHandoff,
  cleanGpu,
  ...notes,
  resolutionPlan,
  cropEditorialFrames,
  saveBarrier,
);

// The exact Director waveform slice is the MP4 audio master. The sampled audio
// latent remains in the A/V transformer as temporal conditioning only.
const exactAudioLink = linkById.get(56);
exactAudioLink[1] = 46;
exactAudioLink[2] = 7;
byId.get(16).outputs[0].links = null;
director.outputs[7].links = [56];

// LTX generates 241 frames for a requested 240-frame shot. Deliver frames
// 0..239 and retain generated frame 240 as the next exact timeline boundary.
const finalVideoLink = linkById.get(93);
finalVideoLink[3] = 206;
finalVideoLink[4] = 0;
finalScale.outputs[0].links = [93, 94];
videoSave.inputs[0].link = 101;
videoSave.outputs[0].links = [96];
saveHandoff.outputs[0].links = [102];
workflow.links.push(
  [94, 132, 0, 200, 0, "IMAGE"],
  [95, 200, 0, 201, 0, "IMAGE"],
  [96, 94, 0, 207, 0, "VHS_FILENAMES"],
  [97, 205, 2, 46, 6, "INT"],
  [98, 205, 3, 46, 7, "INT"],
  [99, 205, 0, 132, 1, "INT"],
  [100, 205, 1, 132, 2, "INT"],
  [101, 206, 0, 94, 0, "IMAGE"],
  [102, 201, 0, 207, 1, "IMAGE"],
  [103, 207, 0, 202, 0, "*"],
);

workflow.last_node_id = 207;
workflow.last_link_id = 103;
workflow.groups = [
  { id: 1, title: "01 · LOADERS / CURRENT 24GB INT8", bounding: [40, 20, 410, 1880], color: "#3f789e", flags: {} },
  { id: 2, title: "02 · RESOLUTION + GEMMA 4 + LTX DIRECTOR TIMELINE / AUDIO SLICER", bounding: [455, -540, 1660, 2220], color: "#6f4a8e", flags: {} },
  { id: 3, title: "03 · DISTILLED STAGE 1 / JOINT A-V", bounding: [3560, 20, 1550, 580], color: "#3f789e", flags: {} },
  { id: 4, title: "04 · NATIVE LATENT X2 + STAGE 2", bounding: [5120, 20, 2790, 580], color: "#477a4a", flags: {} },
  { id: 5, title: "05 · TILED DECODE / EXACT 240-FRAME OUTPUT / BOUNDARY HANDOFF", bounding: [7860, 20, 2240, 840], color: "#8a653a", flags: {} },
];
workflow.extra = {
  ...(workflow.extra || {}),
  info: {
    name: "LTX 2.5 Music Video · current 24GB GPU · 60s block / 6 x 10s shots",
    hardware: "NVIDIA GeForce RTX 5090 Laptop GPU, 23.89 GiB",
    execution_unit: "One 240-frame editorial shot; LTX generates 241 frames (8n+1), then block assembly conforms to 240.",
    block_plan: "Six 10-second shots = 60 seconds; nine 10-second shots = 90 seconds. Keep 720p-class jobs at 10 seconds or less on the current GPU.",
    final_resolution: "Adjustable from the LTX25ResolutionPlan node; default 1024x576",
    stage1_resolution: "Automatically selected on a 32-pixel grid; default 512x288",
    model: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    clip: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
    video_vae: "LTX\\2.5\\ltx-2.5-video-vae-bf16.safetensors",
    audio_vae: "LTX\\2.5\\ltx-2.5-audio-vae-bf16.safetensors",
    upscaler: "LTX\\2.5\\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    audio_contract: "Required before queue: add the full soundtrack to the Director AUDIO track, set use_custom_audio=true and inpaint_audio=false. The Director combined_audio output is the MP4 audio master.",
    handoff_contract: "The 241st generated frame is saved as the exact next-boundary guide; the MP4 contains frames 0..239. Cross-job injection is orchestrator-owned.",
  },
  ds: { scale: 0.55, offset: [40, 560] },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(outputPath);
