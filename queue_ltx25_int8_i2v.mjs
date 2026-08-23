import fs from "fs";
import path from "path";
import { graphToApi, getObjectInfo } from "./server/comfy.js";

const WF = path.join(
  "BlokeyUI", "ComfyUI", "user", "default", "workflows",
  "ltx25INT8AllinoneSpeed_v10INT8Stage2Speed.json"
);
const IMAGE = "harrowing_shorts/loc-descent.v1.png";
const PROMPT =
  "Cinematic dark-fantasy, Harrowing of Hell look. Camera descends obsidian stone stairs into thick red volumetric haze, dying embers, smoke and ash, gold light fading. No people, no new faces. One continuous 9:16 shot.";
const UNET = "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors";
const LORA = "LTX\\2.5\\ltx-2.5-22b-distilled-lora-450-bf16.safetensors";

const graph = JSON.parse(fs.readFileSync(WF, "utf8"));
const info = await getObjectInfo(true);
const converted = graphToApi(graph, info);
const prompt = converted.prompt || converted;
if (converted.warnings?.length) console.log("warnings", converted.warnings);

for (const [id, node] of Object.entries(prompt)) {
  const t = node.class_type;
  const i = node.inputs || {};
  if (t === "LTX25AllModesControlsV2") {
    i.mode = "I2V (first frame)";
    i.final_width = 704;
    i.final_height = 1280;
    i.timing_mode = "Duration drives frames";
    i.fps = 24;
    i.duration_seconds = 5;
    i.seed = 316016;
    i.control_after_generate = "fixed";
    console.log("patched controls", id, i.mode, i.final_width, "x", i.final_height, i.duration_seconds + "s");
  }
  if (t === "LTX25ModeImageLoader") {
    if (i.image && String(i.image).trim()) {
      i.image = IMAGE;
      console.log("patched first frame", id, i.image);
    }
  }
  if (t === "PrimitiveStringMultiline" || t === "PrimitiveString") {
    for (const k of Object.keys(i)) {
      if (typeof i[k] === "string") i[k] = PROMPT;
    }
    console.log("patched primitive", id, t, Object.keys(i));
  }
  if (t === "CLIPTextEncode") {
    if (typeof i.text === "string" && (i.text === "" || /harrowing|hell|jesus/i.test(i.text))) {
      i.text = PROMPT;
      console.log("patched clip encode", id);
    }
  }
  if (t === "UNETLoader") {
    i.unet_name = UNET;
    console.log("patched unet", id);
  }
  if (t === "LTX25OptionalBypassLoRA") {
    i.lora_name = LORA;
    i.strength_model = 1;
    console.log("patched lora", id);
  }
  if (t === "SaveVideo") {
    i.filename_prefix = "harrowing_shorts/stairs_red_haze";
    console.log("patched save", id);
  }
}

const r = await fetch("http://127.0.0.1:8188/prompt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, client_id: "randall-stairs" }),
});
const txt = await r.text();
console.log("status", r.status);
console.log(txt.slice(0, 5000));
if (r.ok) {
  const j = JSON.parse(txt);
  fs.writeFileSync("harrowing_stairs_prompt_id.txt", j.prompt_id || "");
}
