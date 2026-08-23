import fs from "fs";
import { graphToApi, getObjectInfo } from "./server/comfy.js";
const g = JSON.parse(fs.readFileSync("BlokeyUI/ComfyUI/user/default/workflows/ltx25INT8AllinoneSpeed_v10INT8Stage2Speed.json", "utf8"));
const info = await getObjectInfo(true);
const prompt = graphToApi(g, info).prompt;
for (const id of ["356","366","377","344","412","365","408","409","376","364","373","385","386"]) {
  console.log(id, JSON.stringify(prompt[id]));
}
