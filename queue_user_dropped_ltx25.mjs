import fs from "fs";
import { graphToApi, getObjectInfo } from "./server/comfy.js";

const graph = JSON.parse(fs.readFileSync("user_dropped_ltx25.json", "utf8"));
const converted = graphToApi(graph, await getObjectInfo(true));
const prompt = converted.prompt || converted;

// graphToApi leftover-widget bug: audio empty latent widgets are
// [frames, fps, batch]=[97,25,1] with frames+fps linked, leftover is batch=1.
for (const node of Object.values(prompt)) {
  if (node.class_type === "LTXVEmptyLatentAudio" && node.inputs?.batch_size === 25) {
    node.inputs.batch_size = 1;
  }
}

const r = await fetch("http://127.0.0.1:8188/prompt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, client_id: "randall-stairs" }),
});
const txt = await r.text();
console.log("status", r.status);
console.log(txt.slice(0, 3000));
if (r.ok) {
  const j = JSON.parse(txt);
  fs.writeFileSync("harrowing_stairs_prompt_id.txt", j.prompt_id || "");
}
