import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIAGNOSTICS = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");
const WORKFLOW_DIR = path.join(REPO_ROOT, "BlokeyUI", "ComfyUI", "user", "default", "workflows");
const BASE_API = path.join(DIAGNOSTICS, "garden-face-best-r10-final.api.json");
const SOURCE_UI = path.join(WORKFLOW_DIR, "GARDEN_identity_repaired (2).json");
const API_PATH = path.join(DIAGNOSTICS, "garden-first-segment-voice-r31.api.json");
const RUN_PATH = path.join(DIAGNOSTICS, "garden-first-segment-voice-r31.run.json");
const COMFY_URL = "http://127.0.0.1:8188";

const REQUESTED_WIDTH = 1128;
const REQUESTED_HEIGHT = 480;
const FPS = 25;
const REQUESTED_FRAMES = 164;
const REQUESTED_SECONDS = 6.54;
const SEED = 488441818004763;
const OUTPUT_PREFIX = "identity_tests/garden-first-segment-voice-r31";
const CHARACTER_SHEET = "whatdreamscost/jesus-character-sheet-1536x1024.v1.png";
const VOICE_REFERENCE = "whatdreamscost/voice-jesus-reference-5s.v1.wav";
const LIVE_DIRECTOR_MODEL = "LTX\\2.3\\Director\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors";

const VISUAL = `ref_t2v: d3m0p0s3.
[VISUAL]: Photorealistic live-action biblical drama at night in the Garden of Gethsemane on the Mount of Olives. This is the actual Garden scene, not an animated portrait or character sheet. Ancient gnarled olive trees, exposed silver-gray roots, dark earth, scattered limestone, sparse grass moving in a cool night wind, faint distant Jerusalem glow, cool blue-silver moonlight, subtle warm rim light, and restrained volumetric haze.

The exact same olive-brown-skinned Middle Eastern adult man shown in the hidden identity reference is Jesus: long angular oval face, deep-set hazel-brown eyes, strong narrow slightly convex nose, thick dark eyebrows, shoulder-length dense black corkscrew curls, and a dense tapered full black beard. He wears an off-white linen tunic and a dark earth-brown wool mantle and is barefoot. Preserve his exact face, hairline, curls, beard, eyes, skin, robe, hands, feet, and identity in every visible frame.

One continuous 6.54-second 35mm anamorphic wide-medium master shot, no cut, dissolve, close-up, reframing, or camera orbit. Begin exactly from the supplied Garden first-frame composition: the camera peers past a softly blurred ancient olive trunk; Jesus stands alone on the right third, facing front-left about 35 degrees. The camera makes one very slow three-foot lateral slide to the right while keeping the same visual axis and natural scale.

([0.0-1.6 sec]) Jesus takes exactly two heavy measured forward steps with grounded bare-foot contact, then stops walking. Both anatomically correct hands have five fingers and both anatomically correct feet have five toes. His shoulders are burdened, his breathing labored but controlled, and his mantle and curls move naturally in the wind.

([1.6-4.4 sec]) His fingers tighten once around the edge of his mantle and release. He looks toward the dark earth and speaks quietly in prayer with natural synchronized mouth motion and the supplied Jesus voice.

([4.4-6.54 sec]) He finishes speaking, closes his mouth, and says nothing else. He closes his eyes, bends both knees clearly, lowers his body toward the earth, and settles onto one knee. The FINAL FRAME clearly shows Jesus on one knee on the ground, face still visible from the front-left axis. Hold that kneeling end pose through the last twelve frames.

[SPEECH]: Jesus says exactly once: "My Father, if it is possible, let this cup pass from me." After the word "me," he stops speaking completely. Do not repeat "My Father" or any other word. His mouth remains closed for the rest of the shot.

[SOUNDS]: Preserve the supplied Jesus reference voice: warm, resonant adult male timbre. Clear quiet prayer with natural outdoor space, two audible footsteps on dark earth, labored breathing, cloth movement, olive leaves, and cool night wind. After the one sentence, only breath, cloth, leaves, and wind remain; no repeated speech. No music.`;

const NEGATIVE = `character sheet, collage, split screen, reference background, merely animating the reference image, United States Senate, podium, crowd, duplicate Jesus, multiple Jesuses, clone, different actor, identity drift, face morphing, short hair, straight hair, light hair, sparse beard, shaved face, costume change, armor, crown, halo, pendant, sandals, malformed hands, fused fingers, extra fingers, missing fingers, malformed feet, fused toes, extra toes, missing toes, floating feet, backwards feet, broken limbs, extra limbs, sliding feet, walking backward, remaining standing, never kneeling, close-up, camera orbit, reverse dolly, abrupt cut, dissolve, scene transition, exaggerated crying, sudden head motion, wrong words, repeated speech, repeating My Father, second sentence, robotic voice, wrong voice, silent speech, subtitles, captions, text overlay, logo, watermark, blurry face, warped mouth, bad lip sync, flicker, jitter, worst quality, low quality`;

function clone(value) {
  return structuredClone(value);
}

function findDirectorNode(workflow) {
  const node = workflow.nodes.find((candidate) => Number(candidate.id) === 46 && candidate.type === "LTXDirector");
  if (!node) throw new Error("Source Garden LTXDirector node 46 is missing");
  return node;
}

function buildTimeline(sourceUi) {
  const director = findDirectorNode(sourceUi);
  const timeline = JSON.parse(director.widgets_values[6]);
  const first = clone(timeline.segments?.[0]);
  const kneelingEnd = clone(timeline.segments?.[1]);
  if (!first?.imageFile?.endsWith("12_36_25 AM (1).png")) {
    throw new Error("The approved Garden opening guide image is missing");
  }
  return {
    ...timeline,
    mainTrackEnabled: true,
    audioTrackEnabled: true,
    motionTrackEnabled: false,
    overrideAudio: false,
    inpaint_audio: false,
    global_prompt: VISUAL,
    retake_global_prompt: "",
    retakeMode: false,
    retakeStart: 0,
    retakeLength: REQUESTED_FRAMES,
    retakePrompt: "",
    retakeVideo: null,
    normalStartFrame: 0,
    normalDurationFrames: REQUESTED_FRAMES,
    segments: [
      {
        ...first,
        start: 0,
        length: REQUESTED_FRAMES,
        prompt: VISUAL,
        isEndFrame: false,
      },
      {
        ...kneelingEnd,
        id: `${kneelingEnd?.id ?? "garden-kneel"}-endframe-r31`,
        start: 0,
        length: REQUESTED_FRAMES,
        prompt: VISUAL,
        isEndFrame: true,
      },
    ],
    motionSegments: [],
    audioSegments: [],
  };
}

function modelLoader(model, loraName, strength, title) {
  return {
    class_type: "LoraLoaderModelOnly",
    inputs: { model, lora_name: loraName, strength_model: strength },
    _meta: { title },
  };
}

function identityNode(model, positive, negative, latent) {
  return {
    class_type: "LTXIdentityOverlapConditioning",
    inputs: {
      model,
      positive,
      negative,
      vae: ["3", 0],
      latent,
      reference_image: ["120", 0],
      source_id: 2,
      phase_scale: 1,
      ref_resize_mode: "native_resolution",
      debug_log: true,
      crop_anchor: "center",
      layout: "overlap",
      reference_guidance_scale: 1,
    },
    _meta: { title: "Best Face CharacterSheet identity conditioning" },
  };
}

function voiceNode(model, positive, negative, title) {
  return {
    class_type: "LTXVReferenceAudio",
    inputs: {
      model,
      positive,
      negative,
      reference_audio: ["129", 0],
      audio_vae: ["4", 0],
      identity_guidance_scale: 3,
      start_percent: 0,
      end_percent: 1,
    },
    _meta: { title },
  };
}

function buildApi(baseApi, sourceUi) {
  const prompt = clone(baseApi);
  const timeline = buildTimeline(sourceUi);

  for (const id of ["98", "99", "100", "101", "102", "104", "105", "106"]) delete prompt[id];

  prompt["95"].inputs.unet_name = LIVE_DIRECTOR_MODEL;

  Object.assign(prompt["46"].inputs, {
    start_second: 0,
    end_second: REQUESTED_SECONDS,
    duration_seconds: REQUESTED_SECONDS,
    start_frame: 0,
    end_frame: REQUESTED_FRAMES,
    duration_frames: REQUESTED_FRAMES,
    timeline_data: JSON.stringify(timeline),
    local_prompts: VISUAL,
    segment_lengths: String(REQUESTED_FRAMES),
    epsilon: 0.99,
    guide_strength: "0.72",
    use_custom_audio: false,
    use_custom_motion: false,
    inpaint_audio: false,
    frame_rate: FPS,
    display_mode: "seconds",
    custom_width: REQUESTED_WIDTH,
    custom_height: REQUESTED_HEIGHT,
    resize_method: "maintain aspect ratio",
    divisible_by: 32,
    override_audio: false,
    queue_i2v_segments: false,
  });

  prompt["26"] = {
    class_type: "CLIPTextEncode",
    inputs: { clip: ["84", 0], text: NEGATIVE },
    _meta: { title: "Garden negative prompt" },
  };
  Object.assign(prompt["8"].inputs, {
    scale_by: 0.5,
    image_attention_strength: 0.75,
    crop: "center",
    ic_lora_name: "None",
    ic_lora_strength: 0,
  });
  delete prompt["8"].inputs.model;
  delete prompt["8"].inputs.motion_guide_data;
  Object.assign(prompt["58"].inputs, {
    scale_by: 1,
    image_attention_strength: 0.75,
    crop: "center",
    ic_lora_name: "None",
    ic_lora_strength: 0,
  });
  delete prompt["58"].inputs.model;
  delete prompt["58"].inputs.motion_guide_data;

  prompt["120"] = {
    class_type: "LoadImage",
    inputs: { image: CHARACTER_SHEET },
    _meta: { title: "Jesus CharacterSheet identity reference" },
  };
  prompt["121"] = modelLoader(["46", 0], "LTX\\LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors", 1, "OmniNFT coherence");
  prompt["122"] = modelLoader(["121", 0], "faceID\\Best_FaceID_v1.0_LoRA.safetensors", 0.2, "Best Face support");
  prompt["123"] = modelLoader(["122", 0], "faceID\\Best_FaceID_CharacterSheet_v1.0_LoRA.safetensors", 1, "Best Face CharacterSheet");
  prompt["124"] = modelLoader(["123", 0], "LTX\\2.3\\Pose\\ltx23__demopose_d3m0p0s3.safetensors", 0.75, "Pose helper for walking, hands, and feet");
  prompt["125"] = modelLoader(["124", 0], "LTX\\2.3\\LTX2.3_Crisp_Enhance.safetensors", 0.3, "Conservative anatomy detail enhancement");
  prompt["126"] = modelLoader(["125", 0], "LTX\\2.3\\ID-LoRA\\id-lora-talkvid-ltx2.3.safetensors", 1, "TalkVid Jesus voice identity");

  prompt["128"] = identityNode(["126", 0], ["8", 0], ["8", 1], ["8", 2]);
  prompt["129"] = {
    class_type: "LoadAudio",
    inputs: { audio: VOICE_REFERENCE },
    _meta: { title: "Exact supplied Jesus voice reference" },
  };
  prompt["130"] = voiceNode(["128", 0], ["128", 1], ["128", 2], "Generate Garden prayer in Jesus voice · pass 1");

  prompt["131"] = identityNode(["125", 0], ["58", 0], ["58", 1], ["58", 2]);
  delete prompt["132"];

  prompt["7"].inputs.video_latent = ["128", 3];
  prompt["9"].inputs.model = ["130", 0];
  prompt["9"].inputs.positive = ["130", 1];
  prompt["9"].inputs.negative = ["130", 2];
  prompt["9"].inputs.cfg = 1;
  prompt["11"].inputs.model = ["130", 0];
  prompt["11"].inputs.steps = 8;
  prompt["11"].inputs.denoise = 1;
  prompt["55"].inputs.positive = ["130", 1];
  prompt["55"].inputs.negative = ["130", 2];

  prompt["50"].inputs.video_latent = ["131", 3];
  prompt["49"].inputs.model = ["131", 0];
  prompt["49"].inputs.positive = ["131", 1];
  prompt["49"].inputs.negative = ["131", 2];
  prompt["49"].inputs.cfg = 1;
  prompt["14"].inputs.positive = ["131", 1];
  prompt["14"].inputs.negative = ["131", 2];
  prompt["14"].inputs.latent = ["48", 0];

  prompt["28"].inputs.noise_seed = SEED;
  prompt["29"].inputs.sampler_name = "euler";
  prompt["53"].inputs.sampler_name = "euler";
  prompt["96"].inputs.sigmas = "0.85, 0.7250, 0.4219, 0.0";
  prompt["16"].inputs.samples = ["13", 1];
  prompt["94"].inputs.filename_prefix = OUTPUT_PREFIX;
  prompt["94"].inputs.audio = ["16", 0];
  prompt["94"].inputs.save_metadata = true;
  return prompt;
}

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${route}: ${response.status} ${text}`);
  return body;
}

function assertLink(prompt, id, input, expected) {
  if (JSON.stringify(prompt[id]?.inputs?.[input]) !== JSON.stringify(expected)) {
    throw new Error(`Node ${id}.${input} is not ${JSON.stringify(expected)}`);
  }
}

function validateGraph(prompt) {
  for (const id of ["46", "8", "10", "13", "52", "58", "47", "48", "14", "15", "16", "94", "120", "126", "128", "130", "131"]) {
    if (!prompt[id]) throw new Error(`Required node ${id} is missing`);
  }
  const timeline = JSON.parse(prompt["46"].inputs.timeline_data);
  if (timeline.segments?.length !== 2 || timeline.segments[0].length !== REQUESTED_FRAMES) throw new Error("Timeline is not the first segment plus its approved end-frame anchor");
  if (!timeline.segments[0].imageFile.endsWith("12_36_25 AM (1).png")) throw new Error("Approved Garden opening image is not active");
  if (!timeline.segments[1].isEndFrame || !timeline.segments[1].imageFile.endsWith("12_36_25 AM (2).png")) throw new Error("Approved kneeling end frame is not active");
  if (timeline.motionTrackEnabled || timeline.motionSegments.length) throw new Error("Character sheet leaked into the visible motion track");
  if (!prompt["46"].inputs.local_prompts.includes("Garden of Gethsemane")) throw new Error("Garden scene prompt is missing");
  if (!prompt["46"].inputs.local_prompts.includes("My Father, if it is possible")) throw new Error("Garden prayer is missing");
  if (prompt["46"].inputs.custom_width !== REQUESTED_WIDTH || prompt["46"].inputs.custom_height !== REQUESTED_HEIGHT || prompt["46"].inputs.frame_rate !== FPS) throw new Error("Requested dimensions/FPS were not applied");
  if (prompt["11"].inputs.steps !== 8 || prompt["96"].inputs.sigmas.split(",").length !== 4) throw new Error("8+3 sampling was not applied");
  assertLink(prompt, "9", "model", ["130", 0]);
  assertLink(prompt, "49", "model", ["131", 0]);
  assertLink(prompt, "14", "latent", ["48", 0]);
  assertLink(prompt, "16", "samples", ["13", 1]);
  assertLink(prompt, "94", "audio", ["16", 0]);
}

async function preflight(prompt) {
  const [queue, objectInfo] = await Promise.all([requestJson("/queue"), requestJson("/object_info")]);
  const running = queue.queue_running?.length ?? 0;
  const pending = queue.queue_pending?.length ?? 0;
  if (running || pending) throw new Error(`ComfyUI 8188 is busy (${running} running, ${pending} pending)`);
  for (const node of Object.values(prompt)) {
    if (!objectInfo[node.class_type]) throw new Error(`Live ComfyUI is missing ${node.class_type}`);
  }
  const serialized = JSON.stringify(objectInfo);
  for (const selector of [
    "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
    "Best_FaceID_v1.0_LoRA.safetensors",
    "Best_FaceID_CharacterSheet_v1.0_LoRA.safetensors",
    "ltx23__demopose_d3m0p0s3.safetensors",
    "LTX2.3_Crisp_Enhance.safetensors",
    "id-lora-talkvid-ltx2.3.safetensors",
  ]) {
    if (!serialized.includes(selector)) throw new Error(`Live ComfyUI is missing selector ${selector}`);
  }
  return { running, pending };
}

async function prepare() {
  const [baseText, sourceText] = await Promise.all([
    fs.readFile(BASE_API, "utf8"),
    fs.readFile(SOURCE_UI, "utf8"),
  ]);
  const prompt = buildApi(JSON.parse(baseText), JSON.parse(sourceText));
  validateGraph(prompt);
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  await fs.writeFile(API_PATH, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  return prompt;
}

async function status(promptId) {
  const [history, queue] = await Promise.all([requestJson(`/history/${encodeURIComponent(promptId)}`), requestJson("/queue")]);
  const entry = history[promptId];
  const outputs = [];
  for (const [nodeId, output] of Object.entries(entry?.outputs ?? {})) {
    for (const kind of ["gifs", "videos", "images", "audio"]) {
      for (const item of output?.[kind] ?? []) outputs.push({ node_id: nodeId, kind, ...item });
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
  const command = process.argv[2] ?? "preflight";
  if (command === "status") {
    if (!process.argv[3]) throw new Error("status requires a prompt id");
    console.log(JSON.stringify(await status(process.argv[3]), null, 2));
    return;
  }
  const prompt = await prepare();
  const ready = await preflight(prompt);
  if (command === "preflight") {
    console.log(JSON.stringify({ status: "validated_not_queued", api: API_PATH, ...ready }, null, 2));
    return;
  }
  if (command !== "submit") throw new Error(`Unknown command: ${command}`);
  const clientId = crypto.randomUUID();
  const response = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      client_id: clientId,
      extra_data: { comfy_usage_source: "premiere316_garden_first_segment_voice_r31" },
    }),
  });
  if (!response.prompt_id) throw new Error(`ComfyUI returned no prompt id: ${JSON.stringify(response)}`);
  if (Object.keys(response.node_errors ?? {}).length) throw new Error(`ComfyUI validation errors: ${JSON.stringify(response.node_errors)}`);
  const run = {
    submitted_at: new Date().toISOString(),
    prompt_id: response.prompt_id,
    queue_number: response.number,
    client_id: clientId,
    node_errors: response.node_errors ?? {},
    comfy_url: COMFY_URL,
    requested: { width: REQUESTED_WIDTH, height: REQUESTED_HEIGHT, frames: REQUESTED_FRAMES, fps: FPS, seconds: REQUESTED_SECONDS, sampling: "8+3" },
    scope: "Garden of Gethsemane first segment only; full 60 seconds intentionally not queued",
    scene_image: JSON.parse(prompt["46"].inputs.timeline_data).segments[0].imageFile,
    identity_reference: CHARACTER_SHEET,
    voice_reference: VOICE_REFERENCE,
    api: API_PATH,
    output_prefix: OUTPUT_PREFIX,
  };
  await fs.writeFile(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...run, run_manifest: RUN_PATH }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
