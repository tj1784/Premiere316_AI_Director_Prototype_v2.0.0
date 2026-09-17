import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inspectVideoAdapter } from "./video-runtime.server.ts";
import { videoRuntimeBlock } from "./video-runtime.ts";
import { videoEngineFromSelection } from "./generation-config.ts";
import { inspectDirectorRuntime } from "./director-runtime.server.ts";
import { prepareDirectorWorkflow } from "./director-workflow.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";

describe("Wave 5 video runtime honesty", () => {
  it("fail-closes MiniMax H3 and LTX 2.5 instead of claiming Comfy or stills as video", () => {
    const h3 = inspectVideoAdapter("minimax-h3");
    const ltx = inspectVideoAdapter("ltx-2");
    assert.equal(h3.status, "ADAPTER_UNAVAILABLE");
    assert.equal(ltx.status, "ADAPTER_UNAVAILABLE");
    assert.equal(h3.officialRuntime, false);
    assert.match(h3.disabledReason, /fail-closed/i);
    assert.match(ltx.disabledReason, /non-Comfy|fail-closed/i);
    assert.doesNotMatch(h3.disabledReason, /8188 is ready/i);
    assert.match(videoRuntimeBlock("ltx-2"), /LTX 2.5/);
    assert.equal(existsSync("desktop/workers/minimax_h3_jsonl_worker.py"), true);
    assert.equal(existsSync("desktop/workers/ltx25_jsonl_worker.py"), true);
  });
  it("keeps Director routing separate from the unsupported native LTX adapter", () => {
    for (const selected of ["ltx-director", "LTX Director", "LTC director"]) assert.equal(videoEngineFromSelection(selected), "ltx-director");
    assert.equal(videoEngineFromSelection("ltx-2.5"), "ltx-2");
    const director = inspectVideoAdapter("ltx-director");
    assert.equal(director.displayName, "LTX Director");
    assert.equal(director.status, "ADAPTER_UNAVAILABLE");
    assert.match(director.disabledReason, /API generation/);
    assert.doesNotMatch(director.disabledReason, /open LTX Director/);
    assert.doesNotMatch(director.disabledReason, /no official non-Comfy/);
  });
  it("distinguishes available ComfyUI nodes from an in-app render adapter or verified models", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert.equal(init?.method, undefined);
      assert.equal(init?.redirect, "error");
      return new Response(JSON.stringify({ [url.split("/").at(-1)!]: {} }));
    };
    const result = await inspectDirectorRuntime({ endpoint: "http://127.0.0.1:8190", fetchImpl, now: 10 });
    assert.equal(result.status, "AVAILABLE_IN_COMFYUI");
    assert.equal(result.appRenderingConnected, false);
    assert.equal(result.workflowModelsVerified, false);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((url) => url.startsWith("http://127.0.0.1:8190/object_info/")));
  });
  it("reports missing nodes/offline and refuses nonlocal discovery endpoints", async () => {
    const missing = await inspectDirectorRuntime({ endpoint: "http://127.0.0.1:8190", fetchImpl: async () => new Response("{}") });
    assert.equal(missing.status, "NODE_MISSING");
    assert.ok(missing.missingNodes.includes("LTXDirector"));
    const offline = await inspectDirectorRuntime({ endpoint: "http://127.0.0.1:8190", fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(offline.status, "OFFLINE");
    const invalid = await inspectDirectorRuntime({ endpoint: "https://example.com", fetchImpl: async () => { throw new Error("Must not be called"); } });
    assert.equal(invalid.endpoint, null);
    assert.equal(invalid.status, "OFFLINE");
  });
  it("exports all 22 supplied graphs with portable guides, edited text and unchanged timing/model wiring", () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    for (const scene of PRODIGAL_SON_DIRECTOR.scenes) {
      const source = JSON.parse(readFileSync(`public${scene.workflow.mediaUri}`, "utf8"));
      const originalJson = JSON.stringify(source);
      const edits = scene.segments.map((segment) => ({ segmentId: segment.segmentId, prompt: `Edited ${segment.shotId}`, imageDataUrl }));
      const graph = prepareDirectorWorkflow(source, [...edits].reverse(), "Edited global direction");
      const nodes = graph.nodes as typeof source.nodes;
      assert.equal(JSON.stringify(source), originalJson, "Export must not mutate the bundled source graph.");
      assert.deepEqual(graph.definitions, source.definitions);
      assert.deepEqual(graph.links, source.links);
      for (const node of nodes) {
        const before = source.nodes.find((item: { id: number }) => item.id === node.id);
        if (node.type !== "LTXDirector") { assert.deepEqual(node, before); continue; }
        assert.deepEqual(node.inputs, before.inputs);
        const timeline = JSON.parse(node.properties.timeline_data);
        assert.equal(timeline.global_prompt, "Edited global direction");
        assert.equal(timeline.normalDurationFrames, JSON.parse(before.properties.timeline_data).normalDurationFrames);
        assert.equal(node.widgets_values_named.timeline_data, node.properties.timeline_data);
        assert.equal(node.widgets_values_named.local_prompts, node.properties.local_prompts);
        assert.ok(node.widgets_values.includes(node.properties.timeline_data));
        assert.ok(node.widgets_values.includes(node.properties.local_prompts));
        assert.equal(node.properties.local_prompts, edits.map((edit) => edit.prompt).join(" | "));
        timeline.segments.forEach((segment: { id: string; imageFile: string; imageB64: string; start: number; length: number; prompt: string }, index: number) => {
          assert.equal(segment.id, scene.segments[index].segmentId);
          assert.equal(segment.prompt, edits[index].prompt);
          assert.equal(segment.start, scene.segments[index].startFrame);
          assert.equal(segment.length, scene.segments[index].durationFrames);
          assert.equal(segment.imageFile, "");
          assert.equal(segment.imageB64, imageDataUrl);
        });
      }
    }
  });
  it("rejects malformed workflows, missing guides and mismatched scene segments", () => {
    const scene = PRODIGAL_SON_DIRECTOR.scenes[0];
    const source = JSON.parse(readFileSync(`public${scene.workflow.mediaUri}`, "utf8"));
    const edits = scene.segments.map((segment) => ({ segmentId: segment.segmentId, prompt: segment.prompt, imageDataUrl: "data:image/png;base64,aW1hZ2U=" }));
    assert.throws(() => prepareDirectorWorkflow({}, edits), /not a ComfyUI workflow/);
    assert.throws(() => prepareDirectorWorkflow(source, edits.slice(1)), /does not match/);
    assert.throws(() => prepareDirectorWorkflow(source, edits.map((edit) => ({ ...edit, imageDataUrl: "/view?image=missing" }))), /embedded/);
    assert.throws(() => prepareDirectorWorkflow(source, edits.map((edit) => ({ ...edit, prompt: "" }))), /video prompt/);
  });
});
