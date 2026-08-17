import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const COMFY_URL = "http://127.0.0.1:8188";
const VIDEO = path.join(
  REPO_ROOT,
  "BlokeyUI", "ComfyUI", "output", "identity_tests",
  "garden-first-segment-best-face-bfs-r23_00001-audio.mp4",
);
const REFERENCE = "whatdreamscost/jesus-face-primary-3q.v1.png";
const OUTPUT_LABEL = "identity_tests/garden-first-segment-reactor-r24";
const DIAGNOSTICS = path.join(REPO_ROOT, "diagnostics", "ltx-identity-tuning");

const prompt = {
  "1": {
    class_type: "VHS_LoadVideoPath",
    inputs: {
      video: VIDEO,
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
      filename_prefix: OUTPUT_LABEL,
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
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  const apiPath = path.join(DIAGNOSTICS, "garden-first-segment-reactor-r24.api.json");
  await fs.writeFile(apiPath, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  if ((process.argv[2] ?? "prepare") === "prepare") {
    console.log(JSON.stringify({ api: apiPath, video: VIDEO, reference: REFERENCE }, null, 2));
    return;
  }
  const queue = await requestJson("/queue");
  if ((queue.queue_running?.length ?? 0) || (queue.queue_pending?.length ?? 0)) {
    throw new Error("ComfyUI 8188 is busy");
  }
  const clientId = crypto.randomUUID();
  const result = await requestJson("/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      client_id: clientId,
      extra_data: { comfy_usage_source: "premiere316_garden_face_correction" },
    }),
  });
  const run = {
    submitted_at: new Date().toISOString(),
    comfy_url: COMFY_URL,
    prompt_id: result.prompt_id,
    queue_number: result.number,
    node_errors: result.node_errors ?? {},
    source_video: VIDEO,
    identity_reference: REFERENCE,
    swap_model: "inswapper_128.onnx",
    output_prefix: OUTPUT_LABEL,
    api: apiPath,
  };
  await fs.writeFile(path.join(DIAGNOSTICS, "garden-first-segment-reactor-r24.run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(run, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
