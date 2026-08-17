import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const COMFY_URL = "http://127.0.0.1:8188";
const DIAGNOSTICS = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");
const BASE_API = path.join(DIAGNOSTICS, "garden-character-sheet-omninft-512-r25.api.json");
const API_PATH = path.join(DIAGNOSTICS, "senate-character-sheet-scene-r28.api.json");
const RUN_PATH = path.join(DIAGNOSTICS, "senate-character-sheet-scene-r28.run.json");

const POSITIVE = `ref_t2v: d3m0p0s3.
[VISUAL]: Photorealistic live-action scene inside the authentic United States Senate chamber. The exact same olive-brown-skinned Middle Eastern adult man shown in the hidden identity reference is Jesus: long angular oval face, deep-set hazel-brown eyes, strong narrow slightly convex nose, thick dark eyebrows, shoulder-length dense black corkscrew curls, and dense tapered full black beard. He wears the identical off-white draped linen robe tied with a narrow brown rope belt. Preserve his exact face, hairline, curls, beard, eyes, skin, robe, hands, feet, and identity.

One continuous five-second medium-wide 35mm master shot, no cut and no close-up. FRAME ZERO AND THE ENTIRE FIRST FRAME show an EMPTY center aisle and the central wooden Senate podium, with rows of seated senators on both sides. Jesus is completely absent and off-screen in the first frame: no Jesus, no robe, no body part, no reflection, and no silhouette.

([0-1.5 sec]) After the empty establishing first frame, Jesus enters the scene from off-screen left into the center aisle. His full body appears head-to-toe. He walks naturally into the chamber and takes three clear forward steps toward the podium. Both anatomically correct hands with five fingers and both anatomically correct bare feet with five toes remain coherent; his feet contact the floor naturally beneath the robe. The podium stays visibly ahead of him. The camera holds the medium-wide master framing.

([1.5-4.6 sec]) Jesus arrives behind the podium, stops, places one anatomically correct hand on it, looks across the chamber, and speaks briskly with natural synchronized mouth movement.

([4.0-5.0 sec]) During his final words, senators across both sides visibly rise from their seats together. Applause begins immediately and grows through the last frame. Jesus remains behind the podium, visibly the same man.

[SPEECH]: Jesus says exactly once: "Praise the Lord, the kingdom of heaven is at hand."

[SOUNDS]: The supplied Jesus reference voice is preserved: warm, resonant adult male timbre. Clear close speech with natural Senate chamber reverberation, three audible footsteps, chair movement, and enthusiastic crowd applause. No music.`;

const NEGATIVE = `Jesus visible in first frame, robed man in first frame, person entering before frame one ends, opening close-up, starting at podium, static portrait animation, merely animating the reference image, reference background, Garden of Gethsemane, forest, character sheet, collage, split screen, duplicate Jesus, multiple Jesuses, clone, different actor, identity drift, face morphing, short hair, straight hair, light hair, sparse beard, shaved face, costume change, suit on Jesus, armor, crown, halo, pendant, malformed hands, fused fingers, extra fingers, missing fingers, malformed feet, fused toes, extra toes, missing toes, floating feet, backwards feet, broken limbs, extra limbs, walking backward, sliding, reverse dolly reveal, no visible footsteps, seated audience after speech, no applause, silent speech, wrong words, robotic voice, wrong voice, subtitles, captions, text overlay, abrupt cut, dissolve, scene transition, camera orbit, blurry face, warped mouth, bad lip sync, flicker, jitter, logo, watermark, worst quality, low quality`;

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${route}: ${response.status} ${text}`);
  return body;
}

async function build() {
  const prompt = JSON.parse(await fs.readFile(BASE_API, "utf8"));
  prompt["6"].inputs.text = POSITIVE;
  prompt["7"].inputs.text = NEGATIVE;
  prompt["8"].inputs.frame_rate = 24;
  Object.assign(prompt["9"].inputs, { width: 768, height: 448, length: 121, batch_size: 1 });
  Object.assign(prompt["12"].inputs, { frames_number: 121, frame_rate: 24, batch_size: 1 });
  prompt["18"].inputs.noise_seed = 488441818004763;
  prompt["24"].inputs.frame_rate = 24;
  prompt["24"].inputs.filename_prefix = "identity_tests/senate-character-sheet-scene-r28";
  prompt["25"] = {
    class_type: "LTXVAudioVAEDecode",
    inputs: { samples: ["21", 1], audio_vae: ["11", 0] },
    _meta: { title: "Decode generated Senate speech and applause" },
  };
  prompt["24"].inputs.audio = ["25", 0];
  prompt["26"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: { model: ["4", 0], lora_name: "LTX\\2.3\\Pose\\ltx23__demopose_d3m0p0s3.safetensors", strength_model: 0.75 },
    _meta: { title: "LTX 2.3 Pose Helper for coherent walking, hands, and feet" },
  };
  prompt["27"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: { model: ["26", 0], lora_name: "LTX\\2.3\\LTX2.3_Crisp_Enhance.safetensors", strength_model: 0.3 },
    _meta: { title: "LTX 2.3 conservative anatomical detail enhancement" },
  };
  prompt["28"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: { model: ["27", 0], lora_name: "LTX\\2.3\\ID-LoRA\\id-lora-talkvid-ltx2.3.safetensors", strength_model: 1.0 },
    _meta: { title: "Official TalkVid ID-LoRA for Jesus voice identity" },
  };
  prompt["15"].inputs.model = ["28", 0];
  prompt["29"] = {
    class_type: "LoadAudio",
    inputs: { audio: "whatdreamscost/voice-jesus-reference-5s.v1.wav" },
    _meta: { title: "Exact supplied Jesus voice, clean five-second reference" },
  };
  prompt["30"] = {
    class_type: "LTXVReferenceAudio",
    inputs: {
      model: ["15", 0],
      positive: ["15", 1],
      negative: ["15", 2],
      reference_audio: ["29", 0],
      audio_vae: ["11", 0],
      identity_guidance_scale: 3.0,
      start_percent: 0.0,
      end_percent: 1.0,
    },
    _meta: { title: "Generate new Senate line in supplied Jesus voice" },
  };
  prompt["16"].inputs.model = ["30", 0];
  prompt["16"].inputs.positive = ["30", 1];
  prompt["16"].inputs.negative = ["30", 2];
  prompt["17"].inputs.model = ["30", 0];
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  await fs.writeFile(API_PATH, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  return prompt;
}

function validate(prompt) {
  if (!prompt["6"].inputs.text.includes("United States Senate chamber")) throw new Error("Senate scene prompt is missing");
  if (!prompt["6"].inputs.text.includes("ENTIRE FIRST FRAME show an EMPTY center aisle")) throw new Error("Empty-first-frame requirement is missing");
  if (!prompt["6"].inputs.text.includes("enters the scene from off-screen left")) throw new Error("Walk-in entrance requirement is missing");
  if (!prompt["6"].inputs.text.includes("Praise the Lord, the kingdom of heaven is at hand")) throw new Error("Exact spoken line is missing");
  if (!prompt["6"].inputs.text.includes("rise from their seats together")) throw new Error("Standing applause action is missing");
  if (prompt["9"].inputs.width !== 768 || prompt["9"].inputs.height !== 448 || prompt["9"].inputs.length !== 121) throw new Error("Target must be 768x448x121");
  if (prompt["15"].inputs.reference_image[0] !== "14" || prompt["15"].inputs.ref_resize_mode !== "native_resolution") throw new Error("CharacterSheet must remain hidden native-resolution conditioning");
  if (prompt["24"].inputs.audio?.[0] !== "25") throw new Error("Generated audio is not connected to the MP4");
  if (prompt["15"].inputs.model?.[0] !== "28" || prompt["30"].inputs.reference_audio?.[0] !== "29") throw new Error("Pose/detail/voice identity chain is incomplete");
  if (Object.values(prompt).some((node) => /Director|ImageToVideo/i.test(node.class_type ?? ""))) throw new Error("Scene-image/I2V node leaked into the T2V graph");
}

async function preflight(prompt) {
  const [queue, objectInfo] = await Promise.all([requestJson("/queue"), requestJson("/object_info")]);
  for (const node of Object.values(prompt)) if (!objectInfo[node.class_type]) throw new Error(`Missing live node class ${node.class_type}`);
  const running = queue.queue_running?.length ?? 0;
  const pending = queue.queue_pending?.length ?? 0;
  if (running || pending) throw new Error(`ComfyUI 8188 is busy (${running} running, ${pending} pending)`);
  return { running, pending };
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  const prompt = await build();
  validate(prompt);
  if (command === "preflight") {
    console.log(JSON.stringify({ status: "validated_not_queued", api: API_PATH, ...(await preflight(prompt)) }, null, 2));
    return;
  }
  if (command === "status") {
    const id = process.argv[3];
    const [history, queue] = await Promise.all([requestJson(`/history/${id}`), requestJson("/queue")]);
    console.log(JSON.stringify({ prompt_id: id, entry: history[id] ?? null, queue }, null, 2));
    return;
  }
  if (command !== "submit") throw new Error(`Unknown command: ${command}`);
  await preflight(prompt);
  const clientId = crypto.randomUUID();
  const result = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId, extra_data: { comfy_usage_source: "premiere316_senate_character_sheet_scene_r28" } }),
  });
  const run = {
    submitted_at: new Date().toISOString(),
    prompt_id: result.prompt_id,
    queue_number: result.number,
    client_id: clientId,
    node_errors: result.node_errors ?? {},
    comfy_url: COMFY_URL,
    requested: { width: 768, height: 448, frames: 121, fps: 24, seconds: 5.04 },
    identity_reference: prompt["14"].inputs.image,
    scene_conditioning: "Five-second U.S. Senate T2V; empty first frame, Jesus enters from off-screen; no source scene image or I2V latent",
    voice_reference: prompt["29"].inputs.audio,
    pose_lora: prompt["26"].inputs.lora_name,
    api: API_PATH,
    output_prefix: prompt["24"].inputs.filename_prefix,
  };
  await fs.writeFile(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(run, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
