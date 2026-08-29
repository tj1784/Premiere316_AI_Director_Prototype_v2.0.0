import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { graphToApi } from "../server/comfy.js";
import {
  buildMusicVideoSequencePlan,
  buildMusicVideoShotJob,
  patchMusicVideoSequencePrompt
} from "./music-video-sequence.mjs";
import {
  flattenWorkflow,
  patchPrompt,
  validatePrompt,
  workspaceFromWorkflow
} from "./workflow-compiler.mjs";

const workflowFile = path.join(
  path.resolve(import.meta.dirname, ".."),
  "workflows",
  "director-presets",
  "ltx25-music-video-24gb-60s-director.ui.json"
);

test("the 24 GB music-video workflow satisfies the sequential node contract", async (context) => {
  assert.equal(fs.existsSync(workflowFile), true, `Workflow missing: ${workflowFile}`);
  let objectInfo;
  try {
    const response = await fetch("http://127.0.0.1:8188/object_info", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(String(response.status));
    objectInfo = await response.json();
  } catch {
    context.skip("ComfyUI 8188 is not available");
    return;
  }
  const sourceText = fs.readFileSync(workflowFile, "utf8");
  const sourceGraph = JSON.parse(sourceText);
  const workspace = workspaceFromWorkflow(sourceGraph, sourceText);
  const plan = buildMusicVideoSequencePlan(workspace);
  const converted = graphToApi(flattenWorkflow(sourceGraph), objectInfo);
  assert.deepEqual(converted.warnings, []);
  const shotJob = buildMusicVideoShotJob(workspace, plan, 0, plan.firstGuide.imageFile);
  const compiled = patchPrompt(converted.prompt, workspace, shotJob);
  const sequence = patchMusicVideoSequencePrompt(compiled.prompt, "contract-test", plan.shots[0]);
  assert.deepEqual(validatePrompt(sequence.prompt, objectInfo), []);
  assert.equal(sequence.prompt["94"].class_type, "VHS_VideoCombine");
  assert.equal(sequence.prompt["201"].class_type, "SaveImage");
  assert.equal(sequence.prompt["206"].inputs.length, plan.shots[0].requestedFrames);
  assert.equal(sequence.prompt["200"].inputs.batch_index, -1);
});
