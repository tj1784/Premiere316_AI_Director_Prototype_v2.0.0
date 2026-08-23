import fs from "fs";
import { workspaceFromWorkflow, buildSegmentJobs } from "../director-webapp/workflow-compiler.mjs";
import { workspaceForProjectClip } from "../director-webapp/premiere-projects.mjs";
const sourcePath = "C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json";
const sourceText = fs.readFileSync(sourcePath, "utf8");
const base = workspaceFromWorkflow(JSON.parse(sourceText), sourceText);
const ws = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C01");
const jobs = buildSegmentJobs(ws);
console.log(JSON.stringify({
  clip: ws.premiere.clipId,
  generateOptionId: ws.premiere.generateOptionId,
  generateOption: ws.premiere.generateOption?.label,
  queueMode: ws.settings.queueMode,
  generationMode: ws.premiere.generationMode,
  segments: ws.timeline.segments.length,
  jobs: jobs.length,
  requested: jobs.map((job) => job.requestedFrames),
  generation: jobs.map((job) => job.generationFrames)
}, null, 2));
