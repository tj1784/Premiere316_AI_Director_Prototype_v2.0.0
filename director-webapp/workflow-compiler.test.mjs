import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { graphToApi } from "../server/comfy.js";
import {
  buildSegmentJobs,
  flattenWorkflow,
  ltxFrameCount,
  patchPrompt,
  validatePrompt,
  workspaceFromWorkflow
} from "./workflow-compiler.mjs";

const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceGraph = JSON.parse(sourceText);

test("flattens the supplied Director subgraph without UUID execution nodes", () => {
  const flat = flattenWorkflow(sourceGraph);
  assert.equal(flat.nodes.length, 30);
  assert.equal(flat.links.length, 56);
  assert.equal(flat.nodes.some((node) => node.type === "034a1968-3257-4d14-b129-4f2156c94742"), false);
  assert.equal(flat.nodes.some((node) => node.type === "LTXDirector"), true);
});

test("preserves the supplied timeline truth and builds six segment jobs", () => {
  const workspace = workspaceFromWorkflow(sourceGraph, sourceText);
  assert.equal(workspace.settings.frameRate, 50);
  assert.equal(workspace.timeline.segments.length, 6);
  assert.equal(buildSegmentJobs(workspace).length, 6);
  assert.equal(workspace.stats.durationFrames, 2723);
});

test("aligns requested Premiere frames to the LTX 8n+1 generation grid", () => {
  assert.deepEqual(
    [1, 96, 120, 336].map((frames) => [frames, ltxFrameCount(frames)]),
    [[1, 1], [96, 97], [120, 121], [336, 337]]
  );
});

test("compiles and validates against live ComfyUI when 8188 is available", async (context) => {
  let objectInfo;
  try {
    const response = await fetch("http://127.0.0.1:8188/object_info", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(String(response.status));
    objectInfo = await response.json();
  } catch {
    context.skip("ComfyUI 8188 is not available");
    return;
  }

  const workspace = workspaceFromWorkflow(sourceGraph, sourceText);
  const converted = graphToApi(flattenWorkflow(sourceGraph), objectInfo);
  assert.deepEqual(converted.warnings, []);
  const { prompt } = patchPrompt(converted.prompt, workspace, buildSegmentJobs(workspace)[0]);
  assert.equal(Object.keys(prompt).length, 30);
  assert.deepEqual(validatePrompt(prompt, objectInfo), []);
  assert.equal(prompt["46"].inputs.frame_rate, 50);
  assert.equal(prompt["46"].inputs.global_prompt, workspace.timeline.global_prompt);
  assert.equal(prompt["94"].class_type, "VHS_VideoCombine");
  assert.equal(prompt["132"].inputs.width, workspace.settings.customWidth);
  assert.equal(prompt["132"].inputs.height, workspace.settings.customHeight);
});
