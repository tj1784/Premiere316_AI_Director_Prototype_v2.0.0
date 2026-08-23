import fs from "fs";
import { graphToApi, getObjectInfo } from "./server/comfy.js";
const g = JSON.parse(fs.readFileSync("BlokeyUI/ComfyUI/user/default/workflows/ltx25INT8AllinoneSpeed_v10INT8Stage2Speed.json", "utf8"));
const info = await getObjectInfo(true);
const p = graphToApi(g, info);
const keys = Object.keys(p);
console.log("n", keys.length, "sample", keys.slice(0, 12));
const types = {};
for (const [id, n] of Object.entries(p)) {
  const t = n && n.class_type;
  types[String(t)] = (types[String(t)] || 0) + 1;
  if (!t) console.log("NO CLASS", id, JSON.stringify(n).slice(0, 240));
}
console.log(JSON.stringify(types, null, 2));
