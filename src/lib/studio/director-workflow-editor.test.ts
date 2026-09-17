import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { createDirectorEditorJson, decodeDirectorDraft, directorEditorPrompts, encodeDirectorDraft, normalizeDirectorEditorJson, restoreDirectorEditorImages, updateDirectorEditorPrompt } from "./director-workflow-editor.ts";

const scene = PRODIGAL_SON_DIRECTOR.scenes[0];
const source = JSON.parse(readFileSync(new URL(`../../../public${scene.workflow.mediaUri}`, import.meta.url), "utf8"));
const baseline = createDirectorEditorJson(source, scene, {});
const director = (graph: any) => graph.nodes.find((node: any) => node.type === "LTXDirector");

test("all 22 scene editors keep model and timing values, normalize stale snapshots and contain no image payload", () => {
  for (const scene of PRODIGAL_SON_DIRECTOR.scenes) {
    const source = JSON.parse(readFileSync(new URL(`../../../public${scene.workflow.mediaUri}`, import.meta.url), "utf8"));
    const text = createDirectorEditorJson(source, scene, {});
    const graph = JSON.parse(text);
    assert.ok(!text.includes("data:image/"));
    assert.ok(text.includes(`premiere316-image://${scene.segments[0].startImage.sha256}`));
    const timeline = JSON.parse(director(graph).properties.timeline_data);
    assert.deepEqual(timeline.segments.map(({ start, length }: any) => [start, length]), scene.segments.map((segment) => [segment.startFrame, segment.durationFrames]));
    for (const node of source.nodes.filter((node: any) => node.type !== "LTXDirector")) assert.deepEqual(graph.nodes.find((item: any) => item.id === node.id).widgets_values, node.widgets_values);
    const video = graph.nodes.find((node: any) => node.type === "VHS_VideoCombine");
    assert.equal(video.widgets_values_named.filename_prefix, video.widgets_values.filename_prefix);
    assert.equal(normalizeDirectorEditorJson(text, text), text);
  }
});

test("editing one named or positional setting updates corresponding copies; competing changes fail", () => {
  const edited = JSON.parse(baseline);
  const node = edited.nodes.find((node: any) => node.type === "VHS_VideoCombine");
  node.widgets_values_named.crf = 19;
  const restored = JSON.parse(normalizeDirectorEditorJson(JSON.stringify(edited), baseline));
  assert.equal(restored.nodes.find((item: any) => item.id === node.id).widgets_values.crf, 19);
  node.widgets_values.crf = 21;
  assert.throws(() => normalizeDirectorEditorJson(JSON.stringify(edited), baseline), /conflicting copies/);
});

test("global and segment prompt controls preserve timing and synchronize serialized timeline copies", () => {
  const edited = updateDirectorEditorPrompt(updateDirectorEditorPrompt(baseline, baseline, null, "My global direction"), baseline, scene.segments[0].segmentId, "My edited performance");
  const graph = JSON.parse(edited), node = director(graph), timeline = JSON.parse(node.properties.timeline_data);
  assert.equal(timeline.global_prompt, "My global direction");
  assert.equal(timeline.segments[0].prompt, "My edited performance");
  assert.equal(node.widgets_values_named.timeline_data, node.properties.timeline_data);
  assert.ok(node.widgets_values.includes(node.properties.timeline_data));
  assert.equal(node.properties.local_prompts, timeline.segments.map((segment: any) => segment.prompt).join(" | "));
  assert.equal(directorEditorPrompts(edited).segments[scene.segments[0].segmentId], "My edited performance");
  assert.deepEqual(timeline.segments.map(({ start, length }: any) => [start, length]), scene.segments.map((segment) => [segment.startFrame, segment.durationFrames]));
});

test("a global property edit and a timeline-only prompt edit synchronize their derived copies", () => {
  const graph = JSON.parse(baseline);
  director(graph).properties.global_prompt = "A user-edited global prompt";
  const normalized = normalizeDirectorEditorJson(JSON.stringify(graph), baseline);
  assert.equal(directorEditorPrompts(normalized).globalPrompt, "A user-edited global prompt");
  const changed = JSON.parse(baseline), node = director(changed);
  const timeline = JSON.parse(node.properties.timeline_data);
  timeline.segments[0].prompt = "New camera action in the JSON editor";
  node.properties.timeline_data = JSON.stringify(timeline);
  const result = director(JSON.parse(normalizeDirectorEditorJson(JSON.stringify(changed), baseline)));
  assert.ok(result.properties.local_prompts.startsWith("New camera action in the JSON editor"));
  assert.equal(result.properties.timeline_data, result.widgets_values_named.timeline_data);
});

test("image restoration uses exact bytes outside editable text and rejects unknown references", () => {
  const images = Object.fromEntries(scene.segments.map((segment) => [segment.startImage.sha256, "data:image/png;base64," + Buffer.from(segment.shotId).toString("base64")]));
  const graph = JSON.parse(restoreDirectorEditorImages(baseline, baseline, images));
  const timeline = JSON.parse(director(graph).properties.timeline_data);
  for (const [index, segment] of timeline.segments.entries()) {
    assert.equal(segment.imageFile, "");
    assert.equal(segment.imageB64, images[scene.segments[index].startImage.sha256]);
  }
  assert.equal(director(graph).widgets_values_named.timeline_data, director(graph).properties.timeline_data);
  assert.throws(() => restoreDirectorEditorImages(baseline, baseline, {}), /reference is missing/);
  const unknown = baseline.replaceAll(scene.segments[0].startImage.sha256, "f".repeat(64));
  assert.throws(() => restoreDirectorEditorImages(unknown, baseline, images), /reference is missing/);
});

test("compact drafts round-trip workflow edits without storing images or whole graphs", () => {
  const edited = JSON.parse(baseline);
  edited.nodes.find((node: any) => node.type === "VHS_VideoCombine").widgets_values.crf = 19;
  const normalized = normalizeDirectorEditorJson(JSON.stringify(edited), baseline);
  const encoded = encodeDirectorDraft(baseline, normalized);
  assert.ok(encoded.length < 500, encoded);
  assert.deepEqual(JSON.parse(decodeDirectorDraft(baseline, encoded)), JSON.parse(normalized));
  assert.throws(() => decodeDirectorDraft(baseline, JSON.stringify({ schemaVersion: 1, patches: [{ path: ["__proto__", "polluted"], value: true }] })), /invalid path/);
  assert.equal(({} as any).polluted, undefined);
});

test("invalid JSON cannot replace a saved draft or be submitted", () => {
  assert.throws(() => encodeDirectorDraft(baseline, "{"), /incomplete or invalid/);
  assert.throws(() => restoreDirectorEditorImages("[]", baseline, {}), /nodes array/);
});
