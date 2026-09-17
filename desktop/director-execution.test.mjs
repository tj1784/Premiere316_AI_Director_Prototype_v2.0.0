import assert from "node:assert/strict";
import { test } from "node:test";
import { createDirectorExecutionService } from "./director-execution.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const workflow = { nodes: [{ id: 1, type: "LTXDirector", widgets_values: ["reviewed prompt"] }] };
const input = () => ({ pictureId: "picture-one", sceneId: "scene-one", workflowJson: JSON.stringify(workflow) });
function fixture(overrides = {}) {
  const events = [];
  let sequence = 0;
  const service = createDirectorExecutionService({
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ensureHost: async () => { events.push("ensure"); },
    openWorkflow: async (graph) => { events.push({ opened: graph }); return true; },
    compile: (graph) => ({ prompt: { 1: { class_type: "LTXDirector", inputs: { text: graph.nodes[0].widgets_values[0] } } }, issues: [], nodeCount: 1 }),
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/object_info")) return Response.json({ LTXDirector: {} });
      if (url.endsWith("/prompt")) { const body = JSON.parse(options.body); events.push({ submitted: body }); return Response.json({ prompt_id: body.prompt_id }); }
      if (url.includes("/history/")) return Response.json({});
      if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
      throw new Error(`Unexpected URL ${url}`);
    },
    ...overrides,
  });
  return { service, events };
}

test("review is read-only and run requires the exact review ID", async () => {
  const { service, events } = fixture();
  assert.equal((await service.run("unreviewed")).ok, false);
  const reviewed = await service.review(input());
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.workflowSha256.length, 64);
  assert.deepEqual(events, []);
});

test("opening selected scenes forwards each exact graph and context without rendering or creating approval", async () => {
  const opened = [];
  const { service, events } = fixture({ openWorkflow: async (graph, context) => { opened.push({ graph, context }); return true; } });
  for (const sceneId of ["scene-two", "scene-five"]) {
    const graph = { nodes: [{ id: 1, type: "LTXDirector", widgets_values: [sceneId] }] };
    const result = await service.open({ pictureId: "picture-one", sceneId, workflowJson: JSON.stringify(graph) });
    assert.deepEqual(result, { ok: true, workflowOpened: true, sceneId });
    assert.deepEqual(opened.at(-1), { graph, context: { pictureId: "picture-one", sceneId } });
  }
  assert.deepEqual(events, ["ensure", "ensure"]);
  assert.equal((await service.run("scene-two")).ok, false);
});

test("invalid open requests never start a host; failed opening never submits a render", async () => {
  const { service, events } = fixture({ openWorkflow: async () => false });
  assert.equal((await service.open({ ...input(), sceneId: "" })).ok, false);
  assert.deepEqual(events, []);
  assert.equal((await service.open(input())).ok, false);
  assert.deepEqual(events, ["ensure"]);
});

test("approval submits the reviewed graph through the API without opening an editor, even on duplicate clicks", async () => {
  const { service, events } = fixture();
  const payload = input();
  const review = await service.review(payload);
  payload.workflowJson = JSON.stringify({ nodes: [] });
  const [first, second] = await Promise.all([service.run(review.reviewId), service.run(review.reviewId)]);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  assert.equal(events.length, 2);
  assert.equal(events[0], "ensure");
  assert.equal(events.some(event => event.opened), false);
  assert.deepEqual(events[1].submitted.extra_data.extra_pnginfo.workflow, workflow);
  assert.equal(events[1].submitted.prompt[1].inputs.text, "reviewed prompt");
  assert.equal(events[1].submitted.prompt_id, first.promptId);
  assert.deepEqual(await service.run(review.reviewId), first);
  assert.equal(events.length, 2);
});

test("new scene revision invalidates an earlier unconsumed approval", async () => {
  const { service, events } = fixture();
  const original = await service.review(input());
  const next = await service.review({ ...input(), workflowJson: JSON.stringify({ nodes: [{ ...workflow.nodes[0], widgets_values: ["edited"] }] }) });
  assert.equal((await service.run(original.reviewId)).ok, false);
  assert.equal((await service.run(next.reviewId)).ok, true);
  assert.equal(events[1].submitted.prompt[1].inputs.text, "edited");
});

test("validation issues and stale runtime choices never submit", async () => {
  for (const mode of ["review", "run"]) {
    let compileCalls = 0;
    const { service, events } = fixture({
      compile: () => ({ prompt: {}, nodeCount: 1, issues: mode === "review" || mode === "run" && ++compileCalls > 1 ? ["Required model is missing"] : [] }),
    });
    const reviewed = await service.review(input());
    assert.equal((await service.run(reviewed.reviewId)).ok, false, mode);
    assert.equal(events.some((event) => event.submitted), false, mode);
  }
});

test("offline review starts nothing and approval waits for a host before preflight", async () => {
  let started = false;
  const { service } = fixture({
    ensureHost: async () => { started = true; },
    fetchImpl: async (url, options) => {
      if (!started) throw new Error("offline");
      if (url.endsWith("/object_info")) return Response.json({});
      return Response.json({ prompt_id: JSON.parse(options.body).prompt_id });
    },
  });
  const reviewed = await service.review(input());
  assert.equal(reviewed.runtimeAvailable, false);
  assert.equal(started, false);
  assert.equal((await service.run(reviewed.reviewId)).ok, true);
});

test("definite server rejection surfaces node details without claiming submission", async () => {
  const { service } = fixture({ fetchImpl: async (url) => url.endsWith("/object_info") ? Response.json({}) : Response.json({ node_errors: { 1: { errors: [{ message: "Invalid model", details: "missing.safetensors" }] } } }, { status: 400 }) });
  const reviewed = await service.review(input());
  const result = await service.run(reviewed.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.match(result.error, /Invalid model.*missing.safetensors/);
});

test("ambiguous submission keeps the planned ID and cannot submit twice", async () => {
  let posts = 0;
  const { service } = fixture({ fetchImpl: async (url) => {
    if (url.endsWith("/object_info")) return Response.json({});
    if (url.endsWith("/prompt")) { posts++; throw new Error("Connection lost"); }
    if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    return Response.json({});
  } });
  const review = await service.review(input());
  const result = await service.run(review.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.ok(result.promptId);
  assert.deepEqual(await service.run(review.reviewId), result);
  assert.equal(posts, 1);
});

test("status distinguishes actual video output from image previews", async () => {
  let promptId;
  const { service } = fixture({ fetchImpl: async (url, options) => {
    if (url.endsWith("/object_info")) return Response.json({});
    if (url.endsWith("/prompt")) { promptId = JSON.parse(options.body).prompt_id; return Response.json({ prompt_id: promptId }); }
    return Response.json({ [promptId]: { status: { completed: true, status_str: "success" }, outputs: { 3: { gifs: [{ filename: "scene.mp4", subfolder: "Prodigal Son", type: "output" }], images: [{ filename: "preview.png" }] } } } });
  } });
  const review = await service.review(input());
  await service.run(review.reviewId);
  const result = await service.status(promptId);
  assert.equal(result.status, "completed");
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].filename, "scene.mp4");
  assert.match(result.outputs[0].url, /^http:\/\/127\.0\.0\.1:8190\/view\?/);
  assert.equal((await service.status("../foreign")).ok, false);
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=", "base64");
const imageData = `data:image/png;base64,${png.toString("base64")}`;
const imageHash = createHash("sha256").update(png).digest("hex");
const imageName = `p316_${imageHash}.png`;
function imageInput() {
  const timeline = JSON.stringify({ segments: [1, 2].map(id => ({ id, start: id - 1, length: 1, prompt: "Keep the approved image", type: "image", imageFile: "old/missing.png", imageB64: imageData })) });
  return { ...input(), workflowJson: JSON.stringify({ nodes: [{ id: 1, type: "LTXDirector", properties: { timeline_data: timeline }, widgets_values: [timeline], widgets_values_named: { timeline_data: timeline } }] }) };
}
function imageFixture({ exists = false, wrongBytes = false, badPath = false, directory, journalImpl } = {}) {
  const events = [];
  let uploaded = false;
  let sequence = 0;
  const service = createDirectorExecutionService({
    directory, journalImpl,
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ensureHost: async () => { events.push("ensure"); },
    compile: graph => ({ prompt: { 1: { class_type: "LTXDirector", inputs: { timeline_data: graph.nodes[0].widgets_values[0] } } }, issues: [], nodeCount: 1 }),
    openWorkflow: async graph => { events.push({ opened: graph }); return true; },
    fetchImpl: async (url, options = {}) => {
      assert.ok(url.startsWith("http://127.0.0.1:8190/"));
      if (url.endsWith("/object_info")) return Response.json({});
      if (url.includes("/view?")) {
        events.push({ view: url });
        if (!exists && !uploaded) return new Response("Not Found", { status: 404 });
        return new Response(wrongBytes ? Buffer.from("different asset") : png);
      }
      if (url.endsWith("/upload/image")) {
        events.push({ upload: options.body }); uploaded = true;
        return Response.json({ name: imageName, subfolder: badPath ? "../outside" : "premiere316/director", type: "input" });
      }
      if (url.endsWith("/prompt")) {
        const body = JSON.parse(options.body); events.push({ submitted: body });
        return Response.json({ prompt_id: body.prompt_id });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  return { service, events };
}

test("approved images upload once per hash, verify bytes and populate every native timeline copy", async () => {
  const { service, events } = imageFixture();
  const payload = imageInput();
  const original = payload.workflowJson;
  const review = await service.review(payload);
  assert.deepEqual(events, []);
  const result = await service.run(review.reviewId);
  assert.equal(result.ok, true);
  assert.deepEqual(events.map(event => typeof event === "string" ? event : Object.keys(event)[0]), ["ensure", "view", "upload", "view", "submitted"]);
  const form = events.find(event => event.upload).upload;
  assert.equal(form.get("image").name, imageName);
  assert.deepEqual(Buffer.from(await form.get("image").arrayBuffer()), png);
  assert.equal(form.get("overwrite"), null);
  const opened = events.find(event => event.submitted).submitted.extra_data.extra_pnginfo.workflow;
  const node = opened.nodes[0];
  assert.equal(node.widgets_values[0], node.properties.timeline_data);
  assert.equal(node.widgets_values[0], node.widgets_values_named.timeline_data);
  const segments = JSON.parse(node.properties.timeline_data).segments;
  for (const segment of segments) {
    assert.equal(segment.imageFile, `premiere316/director/${imageName}`);
    assert.ok(segment.imageB64.startsWith("/view?"));
    assert.equal(segment.prompt, "Keep the approved image");
  }
  const submitted = events.find(event => event.submitted).submitted;
  assert.deepEqual(submitted.extra_data.extra_pnginfo.workflow, opened);
  assert.equal(submitted.prompt[1].inputs.timeline_data, node.properties.timeline_data);
  assert.equal(JSON.stringify(submitted).includes("data:image"), false);
  assert.equal(payload.workflowJson, original);
});

test("the existing content-addressed input is verified and reused without uploading", async () => {
  const { service, events } = imageFixture({ exists: true });
  const review = await service.review(imageInput());
  assert.equal((await service.run(review.reviewId)).ok, true);
  assert.equal(events.filter(event => event.view).length, 1);
  assert.equal(events.some(event => event.upload), false);
});

test("mismatched existing or uploaded bytes and unsafe server paths stop before opening or rendering", async () => {
  for (const mode of [{ exists: true, wrongBytes: true }, { wrongBytes: true }, { badPath: true }]) {
    const { service, events } = imageFixture(mode);
    const review = await service.review(imageInput());
    const result = await service.run(review.reviewId);
    assert.equal(result.ok, false);
    assert.equal(result.uncertain, undefined);
    assert.match(result.error, mode.badPath ? /unsafe uploaded image path/ : /differs from the reviewed asset/);
    assert.equal(events.some(event => event.opened || event.submitted), false);
    if (mode.exists) assert.equal(events.some(event => event.upload), false);
  }
});

test("nonembedded or malformed starting images cannot fall back to stale native files", async () => {
  for (const value of ["/view?filename=missing.png", "data:image/png;base64,AAAA", imageData.slice(0, -1)]) {
    const { service, events } = imageFixture();
    const payload = imageInput();
    const graph = JSON.parse(payload.workflowJson);
    const timeline = JSON.parse(graph.nodes[0].widgets_values[0]);
    timeline.segments[0].imageB64 = value;
    graph.nodes[0].widgets_values[0] = JSON.stringify(timeline);
    payload.workflowJson = JSON.stringify(graph);
    const review = await service.review(payload);
    assert.equal((await service.run(review.reviewId)).ok, false);
    assert.equal(events.some(event => event.view || event.upload || event.opened || event.submitted), false);
  }
});

test("plain-text HTTP 400 is a definite rejection even when the body is not JSON", async () => {
  let recoveries = 0;
  const { service } = fixture({ fetchImpl: async url => {
    if (url.endsWith("/object_info")) return Response.json({});
    if (url.endsWith("/prompt")) return new Response("Invalid request: bad widget", { status: 400 });
    recoveries++; throw new Error("Recovery should not be attempted");
  } });
  const reviewed = await service.review(input());
  const result = await service.run(reviewed.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.match(result.error, /rejected.*bad widget/);
  assert.equal(recoveries, 0);
});

test("a journal error before POST is certain and never initiates a render", async () => {
  const { service, events } = fixture({ journalImpl: () => { throw new Error("disk unavailable"); } });
  const reviewed = await service.review(input());
  const result = await service.run(reviewed.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.match(result.error, /disk unavailable/);
  assert.equal(events.some(event => event.submitted), false);
});

test("a journal failure after acceptance retains the known job ID and cannot render twice", async () => {
  let records = 0;
  const { service, events } = fixture({ journalImpl: () => { if (++records > 1) throw new Error("disk full"); } });
  const reviewed = await service.review(input());
  const first = await service.run(reviewed.reviewId);
  assert.equal(first.ok, true);
  assert.match(first.warning, /local record could not be saved/);
  assert.equal(events.find(event => event.submitted).submitted.prompt_id, first.promptId);
  assert.deepEqual(await service.run(reviewed.reviewId), first);
  assert.equal(events.filter(event => event.submitted).length, 1);
});

test("ambiguous submissions deduplicate across fresh reviews even when the post-attempt journal fails", async () => {
  let posts = 0;
  let records = 0;
  const { service } = fixture({
    journalImpl: () => { if (++records > 1) throw new Error("disk full"); },
    fetchImpl: async url => {
      if (url.endsWith("/object_info")) return Response.json({});
      if (url.endsWith("/prompt")) { posts++; throw new Error("Connection lost"); }
      if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
      return Response.json({});
    },
  });
  const firstReview = await service.review(input());
  const first = await service.run(firstReview.reviewId);
  const nextReview = await service.review(input());
  const next = await service.run(nextReview.reviewId);
  assert.equal(first.uncertain, true);
  assert.equal(next.uncertain, true);
  assert.equal(next.promptId, first.promptId);
  assert.equal(posts, 1);
});

test("the exact approved embedded workflow is saved separately from the compact submitted graph", async context => {
  const directory = mkdtempSync(join(tmpdir(), "p316-director-test-"));
  context.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true }); });
  const { service, events } = imageFixture({ directory });
  const payload = imageInput();
  const review = await service.review(payload);
  const result = await service.run(review.reviewId);
  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(directory, `${result.promptId}.workflow.json`), "utf8"), payload.workflowJson);
  assert.equal(events.find(event => event.submitted).submitted.extra_data.premiere316.workflowSha256, createHash("sha256").update(payload.workflowJson).digest("hex"));
});

test("actual serialized API payloads including arbitrary custom data stay below ComfyUI's 100 MiB limit", async () => {
  const customData = "x".repeat(51 * 1024 * 1024);
  const { service, events } = fixture({ compile: graph => ({ prompt: { 1: { class_type: "Custom", inputs: { customData: graph.customData } } }, issues: [], nodeCount: 1 }) });
  const reviewed = await service.review({ ...input(), workflowJson: JSON.stringify({ ...workflow, customData }) });
  assert.equal(reviewed.ok, true);
  const result = await service.run(reviewed.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.match(result.error, /100 MiB request limit/);
  assert.equal(events.some(event => event.opened || event.submitted), false);
});

test("persisted uncertain submissions retain their planned ID after restarting the service", async context => {
  const directory = mkdtempSync(join(tmpdir(), "p316-director-test-"));
  context.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true }); });
  let posts = 0;
  const overrides = { directory, fetchImpl: async url => {
    if (url.endsWith("/object_info")) return Response.json({});
    if (url.endsWith("/prompt")) { posts++; throw new Error("Connection lost"); }
    if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
    return Response.json({});
  } };
  const firstService = fixture(overrides).service;
  const review = await firstService.review(input());
  const first = await firstService.run(review.reviewId);
  assert.equal(first.uncertain, true);
  const restarted = fixture(overrides).service;
  const nextReview = await restarted.review(input());
  const next = await restarted.run(nextReview.reviewId);
  assert.equal(next.uncertain, true);
  assert.equal(next.promptId, first.promptId);
  assert.equal(posts, 1);
});

test("a definite rejection remains definite even if recording the rejection fails", async () => {
  let records = 0;
  const { service } = fixture({ journalImpl: () => { if (++records > 1) throw new Error("disk full"); }, fetchImpl: async url =>
    url.endsWith("/object_info") ? Response.json({}) : new Response("Rejected", { status: 400 }) });
  const reviewed = await service.review(input());
  const result = await service.run(reviewed.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.match(result.error, /rejected/i);
  assert.match(result.warning, /local record could not be saved/);
});

test("failed existing-image probes do not create duplicate uploads", async () => {
  let uploads = 0;
  const { service } = fixture({
    compile: graph => ({ prompt: { 1: { class_type: "LTXDirector", inputs: { timeline_data: graph.nodes[0].widgets_values[0] } } }, issues: [], nodeCount: 1 }),
    fetchImpl: async url => {
      if (url.endsWith("/object_info")) return Response.json({});
      if (url.includes("/view?")) return new Response("Unavailable", { status: 503 });
      if (url.endsWith("/upload/image")) uploads++;
      throw new Error("Unexpected mutation");
    },
  });
  const review = await service.review(imageInput());
  const result = await service.run(review.reviewId);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, undefined);
  assert.equal(uploads, 0);
});

test("fresh concurrent reviews share the in-flight preparation before any job is recorded", async () => {
  let releaseHost;
  let hostStarted;
  const started = new Promise(resolve => { hostStarted = resolve; });
  const ready = new Promise(resolve => { releaseHost = resolve; });
  let starts = 0;
  const { service, events } = fixture({ ensureHost: async () => { starts++; hostStarted(); await ready; } });
  const firstReview = await service.review(input());
  const firstRun = service.run(firstReview.reviewId);
  await started;
  const secondReview = await service.review(input());
  assert.notEqual(secondReview.reviewId, firstReview.reviewId);
  const secondRun = service.run(secondReview.reviewId);
  releaseHost();
  const [first, second] = await Promise.all([firstRun, secondRun]);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(starts, 1);
  assert.equal(events.filter(event => event.submitted).length, 1);
  assert.equal(events.filter(event => event.opened).length, 0);
});

test("a reviewed segment batch keeps independent approvals and submits without any editor", async () => {
  const { service, events } = fixture({ openWorkflow: async () => { throw new Error("A browser must never be opened"); } });
  const reviews = [];
  for (let index = 0; index < 4; index++) reviews.push(await service.review({ ...input(), renderSlot: `segment-${index}`, workflowJson: JSON.stringify({ nodes: [{ ...workflow.nodes[0], widgets_values: [`Segment ${index}`] }] }) }));
  const revised = await service.review({ ...input(), renderSlot: "segment-1", workflowJson: JSON.stringify({ nodes: [{ ...workflow.nodes[0], widgets_values: ["Revised segment"] }] }) });
  assert.equal((await service.run(reviews[1].reviewId)).ok, false);
  for (const review of [reviews[0], revised, reviews[2], reviews[3]]) {
    const result = await service.run(review.reviewId);
    assert.equal(result.ok, true);
    assert.equal(result.workflowOpened, false);
  }
  assert.deepEqual(events.filter(event => event.submitted).map(event => event.submitted.prompt[1].inputs.text), ["Segment 0", "Revised segment", "Segment 2", "Segment 3"]);
  assert.equal(events.some(event => event.opened), false);
});

test("status reports real current-node progress and identifies a cancelled generation", async () => {
  let promptId, cancelled = false, connection = "connected";
  const { service } = fixture({
    getProgress: async () => ({ status: "running", nodeId: "31", nodeType: "SamplerCustomAdvanced", stage: "Sampling", value: 7, max: 30, lastUpdated: 1000, connection }),
    fetchImpl: async (url, options) => {
      if (url.endsWith("/object_info")) return Response.json({});
      if (url.endsWith("/prompt")) { promptId = JSON.parse(options.body).prompt_id; return Response.json({ prompt_id: promptId }); }
      if (url.includes("/history/")) return Response.json(cancelled ? { [promptId]: { status: { status_str: "error", completed: false, messages: [["execution_interrupted", { prompt_id: promptId }]] } } } : {});
      if (url.endsWith("/queue")) return Response.json({ queue_running: [[0, promptId]], queue_pending: [] });
      throw new Error(url);
    },
  });
  await service.run((await service.review(input())).reviewId);
  const running = await service.status(promptId);
  assert.equal(running.status, "running");
  assert.equal(running.message, "Sampling · 7/30");
  assert.equal(running.progress.max, 30);
  connection = "disconnected";
  assert.match((await service.status(promptId)).message, /Last reported: Sampling.*Reconnecting/);
  cancelled = true;
  const stopped = await service.status(promptId);
  assert.equal(stopped.status, "cancelled");
  assert.match(stopped.message, /cancelled/);
  assert.deepEqual(stopped.outputs, []);
});
