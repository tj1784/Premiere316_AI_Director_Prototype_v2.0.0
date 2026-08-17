import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const COMFY_URL = "http://127.0.0.1:8188";
const SOURCE = path.join(REPO_ROOT, "BlokeyUI", "ComfyUI", "output", "identity_tests", "garden-first-segment-voice-r31_00001-audio.mp4");
const REFERENCE = "whatdreamscost/jesus-face-primary-3q.v1.png";
const OUTPUT_PREFIX = "identity_tests/garden-first-segment-voice-reactor-r32";
const DIAGNOSTICS = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");
const API_PATH = path.join(DIAGNOSTICS, "garden-first-segment-voice-reactor-r32.api.json");
const RUN_PATH = path.join(DIAGNOSTICS, "garden-first-segment-voice-reactor-r32.run.json");

const prompt = {
  "1": {
    class_type: "VHS_LoadVideoPath",
    inputs: {
      video: SOURCE,
      force_rate: 25,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: 169,
      skip_first_frames: 0,
      select_every_nth: 1,
      format: "None",
    },
  },
  "2": { class_type: "LoadImage", inputs: { image: REFERENCE } },
  "3": {
    class_type: "ReActorFaceSwap",
    inputs: {
      enabled: true,
      input_image: ["1", 0],
      swap_model: "inswapper_128.onnx",
      facedetection: "retinaface_resnet50",
      face_restore_model: "none",
      face_restore_visibility: 1,
      codeformer_weight: 0.5,
      detect_gender_input: "no",
      detect_gender_source: "no",
      input_faces_index: "0",
      source_faces_index: "0",
      console_log_level: 1,
      source_image: ["2", 0],
    },
  },
  "4": {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["3", 0],
      frame_rate: 25,
      loop_count: 0,
      filename_prefix: OUTPUT_PREFIX,
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 16,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      audio: ["1", 2],
    },
  },
};

async function requestJson(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${route}: ${response.status} ${text}`);
  return body;
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  if (!(await fs.stat(SOURCE)).isFile()) throw new Error(`Missing R31 source: ${SOURCE}`);
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  await fs.writeFile(API_PATH, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  const [queue, objectInfo] = await Promise.all([requestJson("/queue"), requestJson("/object_info")]);
  if ((queue.queue_running?.length ?? 0) || (queue.queue_pending?.length ?? 0)) throw new Error("ComfyUI 8188 is busy");
  for (const node of Object.values(prompt)) if (!objectInfo[node.class_type]) throw new Error(`Missing live class ${node.class_type}`);
  if (command === "preflight") {
    console.log(JSON.stringify({ status: "validated_not_queued", api: API_PATH, source: SOURCE }, null, 2));
    return;
  }
  if (command !== "submit") throw new Error(`Unknown command: ${command}`);
  const clientId = crypto.randomUUID();
  const result = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId, extra_data: { comfy_usage_source: "premiere316_garden_r31_face_correction_r32" } }),
  });
  if (!result.prompt_id || Object.keys(result.node_errors ?? {}).length) throw new Error(`Submission failed: ${JSON.stringify(result)}`);
  const run = {
    submitted_at: new Date().toISOString(),
    prompt_id: result.prompt_id,
    queue_number: result.number,
    client_id: clientId,
    node_errors: result.node_errors ?? {},
    source_video: SOURCE,
    identity_reference: REFERENCE,
    output_prefix: OUTPUT_PREFIX,
    api: API_PATH,
  };
  await fs.writeFile(RUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(run, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
