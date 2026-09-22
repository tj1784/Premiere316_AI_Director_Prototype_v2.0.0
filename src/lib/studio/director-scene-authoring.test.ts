import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { hydrateProdigalSonDirector } from "./prodigal-director.ts";
import { hydrateProdigalSceneReplacements } from "./prodigal-scene-replacement.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import {
  buildDirectorPlanEditor,
  createDirectorScene,
  directorPlanForScene,
  directorPlanImages,
  extractDirectorPlanFromEditor,
  listDirectorImageOptions,
  saveDirectorPlan,
  scopeDirectorPlanEditor,
} from "./director-scene-authoring.ts";
import { normalizeDirectorEditorJson } from "./director-workflow-editor.ts";
import { emptyVideoWorkspace } from "../production/video-types.ts";
import { recordImportedVideoTake, reviewVideoTake } from "../production/video-iterations.ts";

test("dependent Director inputs require the exact canonical predecessor and a pixel-bound inspection", () => {
  const p = picture(),
    plan = directorPlanForScene(p, scene.sceneId),
    segment = plan.segments[0];
  p.video = recordImportedVideoTake(emptyVideoWorkspace(), {
    pictureId: p.id,
    shotId: segment.shotId,
    filename: "fixture.mp4",
    mediaUri: "fixture.mp4",
    mediaSha256: "a".repeat(64),
    byteLength: 2048,
    durationSec: 5,
    width: 160,
    height: 96,
    fps: 24,
    hasAudio: false,
    codec: "h264",
  });
  const take = p.video.takes[0];
  p.video = reviewVideoTake(p.video, take.id, "canonical", "Controlled fixture");
  segment.imageBinding = {
    mediaUri: "media://assemblies/fixture/continuation.png",
    sha256: "b".repeat(64),
    predecessorTakeId: take.id,
    predecessorShotId: take.shotId,
    predecessorSha256: take.mediaSha256!,
  };
  assert.match(directorPlanImages(p, plan).issues.join("\n"), /inspect the extracted predecessor/);
  p.shotContinuity = {
    [segment.shotId]: {
      id: "state",
      shotId: segment.shotId,
      revision: 1,
      predecessorId: null,
      source: "fixture",
      cameraPosition: { x: 0, y: 1, z: 5 },
      cameraTarget: { x: 0, y: 1, z: 0 },
      participants: [],
      completedEvents: [],
      newEvents: [],
      restartReason: "",
      imageDisposition: "consistent",
      imageHash: "b".repeat(64),
      inspectionReason: "Fixture",
      imageInspection: {
        id: "inspection",
        referenceId: "frame",
        mediaUri: segment.imageBinding.mediaUri,
        sha256: "b".repeat(64),
        reviewedAt: 1,
        reason: "Fixture",
        disposition: "consistent",
      },
    },
  };
  const valid = directorPlanImages(p, plan);
  assert.ok(!valid.issues.some((issue) => issue.startsWith(segment.segmentId)));
  p.video.takes[0].mediaSha256 = "c".repeat(64);
  const invalid = directorPlanImages(p, plan);
  assert.match(invalid.issues.join("\n"), /predecessor .*changed/);
  assert.notEqual(invalid.key, valid.key);
});

const picture = () =>
  hydrateProdigalSonDirector(
    hydrateProdigalSceneReplacements(hydrateProdigalSonFrames(makeProdigalSonPicture())),
  );
const scene = PRODIGAL_SON_DIRECTOR.scenes[0];
const source = () =>
  JSON.parse(
    readFileSync(new URL(`../../../public${scene.workflow.mediaUri}`, import.meta.url), "utf8"),
  );
const { compileDirectorWorkflow } = await import(
  new URL("../../../desktop/director-compiler.mjs", import.meta.url).href
);
const fixtureText = readFileSync(
  new URL("../../../desktop/director-compiler.test.mjs", import.meta.url),
  "utf8",
);
const info = JSON.parse(fixtureText.match(/const objectInfo = (.+);\r?\n/)![1]);
const director = (graph: any) => graph.nodes.find((node: any) => node.type === "LTXDirector");

test("all22 existing scenes compile with their supplied or explicitly selected settings", () => {
  const p = picture();
  for (const scene of PRODIGAL_SON_DIRECTOR.scenes) {
    const plan = directorPlanForScene(p, scene.sceneId),
      images = directorPlanImages(p, plan);
    assert.deepEqual(images.issues, []);
    const raw = JSON.parse(
      readFileSync(new URL(`../../../public${plan.template.mediaUri}`, import.meta.url), "utf8"),
    );
    const graph = JSON.parse(buildDirectorPlanEditor(raw, plan, { guides: images.guides }));
    const compiled = compileDirectorWorkflow(graph, info);
    assert.deepEqual(compiled.issues, [], scene.sceneId);
    assert.equal(
      compiled.prompt[135].inputs.custom_width,
      scene.replacement?.settings.width ?? 1120,
    );
    assert.equal(
      compiled.prompt[135].inputs.custom_height,
      scene.replacement?.settings.height ?? 480,
    );
    assert.equal(compiled.prompt[33].inputs.steps, 30);
    assert.equal(compiled.prompt[21].inputs.steps, 8);
  }
});

test("creating and authoring another picture scene adds real scene and shots without duplicating assets", () => {
  const before = picture();
  before.id = "another-picture";
  const next = createDirectorScene(before, { sceneId: "MY-S01", title: "A new scene" }, 123);
  const plan = directorPlanForScene(next, "MY-S01");
  assert.equal(plan.globalPrompt, "");
  assert.equal(plan.segments.length, 0);
  plan.segments.push({
    segmentId: "text-1",
    shotId: "MY-S01-SH001",
    type: "text",
    durationFrames: 120,
    prompt: "An empty courtyard in morning light.",
  });
  const saved = saveDirectorPlan(next, plan);
  assert.equal(saved.scenes.at(-1)?.durationSec, 5);
  assert.equal(saved.shots.at(-1)?.i2vPrompt, plan.segments[0].prompt);
  assert.equal(saved.shots.length, before.shots.length + 1);
  assert.deepEqual(saved.generateGates, before.generateGates);
  assert.deepEqual(saved.production, before.production);
  assert.equal(
    before.scenes.some((scene) => scene.id === "MY-S01"),
    false,
  );
  assert.deepEqual(directorPlanForScene(saved, "MY-S01"), plan);
  const editor = buildDirectorPlanEditor(source(), plan);
  const graph = JSON.parse(scopeDirectorPlanEditor(editor, "text-1"));
  assert.deepEqual(compileDirectorWorkflow(graph, info).issues, []);
  const timeline = JSON.parse(director(graph).properties.timeline_data);
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.segments[0].type, "text");
  assert.equal(timeline.segments[0].start, 0);
  assert.ok(!JSON.stringify(graph).includes("Prodigal_Son/Scene_01"));
});

test("explicit existing image binding wins and changed or rejected media cannot silently fall back", () => {
  const p = picture(),
    plan = directorPlanForScene(p, scene.sceneId);
  const option = listDirectorImageOptions(p).find(
    (option) => option.sha256 && option.shotId !== plan.segments[0].shotId,
  )!;
  plan.segments[0].imageBinding = {
    mediaUri: option.mediaUri,
    sha256: option.sha256!,
    iterationId: option.iterationId,
  };
  assert.equal(
    directorPlanImages(p, plan).guides[plan.segments[0].segmentId].sha256,
    option.sha256,
  );
  const first = plan.segments[0];
  p.shotContinuity = {
    [first.shotId]: {
      id: "continuity-fixture",
      shotId: first.shotId,
      revision: 1,
      predecessorId: null,
      source: "fixture",
      cameraPosition: { x: 0, y: 1, z: 5 },
      cameraTarget: { x: 0, y: 1, z: 0 },
      participants: [],
      completedEvents: [],
      newEvents: [],
      restartReason: "",
      imageDisposition: "uninspected",
      imageHash: "",
      inspectionReason: "",
    },
  };
  assert.match(directorPlanImages(p, plan).issues.join("\n"), /Inspect and resolve/);
  const state = p.shotContinuity[first.shotId];
  state.imageDisposition = "consistent";
  state.imageHash = option.sha256!;
  state.inspectionReason = "Controlled fixture";
  state.imageInspection = {
    id: "inspect-fixture",
    referenceId: option.id,
    mediaUri: option.mediaUri,
    sha256: option.sha256!,
    reviewedAt: 1,
    reason: "Controlled fixture",
    disposition: "consistent",
  };
  assert.ok(!directorPlanImages(p, plan).issues.some((issue) => issue.startsWith(first.segmentId)));
  state.imageInspection.sha256 = "f".repeat(64);
  assert.match(directorPlanImages(p, plan).issues.join("\n"), /differs from its byte-bound/);
  delete p.shotContinuity;
  const iteration = p.generateGates!.iterations.find((item) => item.id === option.iterationId)!;
  iteration.status = "REJECTED";
  const invalid = directorPlanImages(p, plan);
  assert.equal(invalid.guides[plan.segments[0].segmentId], undefined);
  assert.match(invalid.issues.join("\n"), /unavailable or changed/);
});

test("missing images stay authorable while image resolution reports why generation is blocked", () => {
  const p = createDirectorScene(picture(), { sceneId: "empty", title: "New" });
  const plan = directorPlanForScene(p, "empty");
  plan.segments.push({
    segmentId: "new-image",
    shotId: "new-shot",
    type: "image",
    durationFrames: 120,
    prompt: "New action",
  });
  assert.equal(directorPlanImages(p, plan).issues.length, 1);
  const graph = JSON.parse(buildDirectorPlanEditor(source(), plan));
  assert.equal(JSON.parse(director(graph).properties.timeline_data).segments[0].imageB64, "");
});

test("multiple executable segments retain one editorial shot and exact per-clip prompts", () => {
  const p = createDirectorScene(picture(), {
    sceneId: "multi",
    title: "One continuous editorial shot",
  });
  const plan = directorPlanForScene(p, "multi");
  plan.segments = [
    {
      segmentId: "clip-a",
      shotId: "editorial-one",
      type: "text",
      durationFrames: 120,
      prompt: "The hand approaches the rail.",
    },
    {
      segmentId: "clip-b",
      shotId: "editorial-one",
      type: "text",
      durationFrames: 168,
      prompt: "The hand remains on the rail; do not replay the approach.",
    },
  ];
  const saved = saveDirectorPlan(p, plan);
  assert.equal(saved.shots.filter((s) => s.sceneId === "multi").length, 1);
  assert.equal(saved.shots.find((s) => s.id === "editorial-one")!.durationSec, 12);
  const graph = JSON.parse(buildDirectorPlanEditor(source(), plan));
  const timeline = JSON.parse(director(graph).properties.timeline_data);
  assert.equal(timeline.segments.length, 2);
  assert.equal(timeline.segments[1].start, 120);
  assert.equal(timeline.segments[1].prompt, plan.segments[1].prompt);
  assert.equal(saveDirectorPlan(saved, plan).shots.length, saved.shots.length);
});

test("selected segment rebases timing and preserves raw JSON sampling, model and output edits", () => {
  const p = picture(),
    plan = directorPlanForScene(p, scene.sceneId),
    images = directorPlanImages(p, plan);
  const baseline = buildDirectorPlanEditor(source(), plan, { guides: images.guides });
  const edited = JSON.parse(baseline);
  edited.nodes.find((node: any) => node.id === 131).widgets_values_named.steps = 11;
  edited.nodes.find((node: any) => node.id === 163).widgets_values.filename_prefix =
    "MyCustomProject/Output";
  const normalized = normalizeDirectorEditorJson(JSON.stringify(edited), baseline);
  const extracted = extractDirectorPlanFromEditor(plan, normalized);
  assert.equal(extracted.refineSteps, 11);
  const scoped = JSON.parse(scopeDirectorPlanEditor(normalized, plan.segments[2].segmentId));
  const result = compileDirectorWorkflow(scoped, info);
  assert.deepEqual(result.issues, []);
  assert.equal(result.prompt[135].inputs.duration_frames, plan.segments[2].durationFrames);
  assert.equal(result.prompt[21].inputs.steps, 11);
  assert.ok(
    result.prompt[163].inputs.filename_prefix.startsWith("MyCustomProject/Output/segment-"),
  );
  const rebuilt = JSON.parse(
    buildDirectorPlanEditor(JSON.parse(normalized), extracted, { guides: images.guides }),
  );
  assert.equal(
    rebuilt.nodes.find((node: any) => node.id === 163).widgets_values.filename_prefix,
    "MyCustomProject/Output",
  );
});

test("reordering and saving keeps stable IDs and leaves removed story shots and user assets intact", () => {
  const p = picture(),
    plan = directorPlanForScene(p, scene.sceneId),
    original = JSON.stringify(p);
  plan.segments.reverse();
  plan.segments.pop();
  plan.segments[0].prompt = "A new performance direction";
  const saved = saveDirectorPlan(p, plan);
  assert.equal(saved.shots.length, p.shots.length);
  assert.equal(JSON.stringify(p), original);
  const editor = JSON.parse(
    buildDirectorPlanEditor(source(), plan, { guides: directorPlanImages(saved, plan).guides }),
  );
  const segments = JSON.parse(director(editor).properties.timeline_data).segments;
  assert.equal(segments[0].id, plan.segments[0].segmentId);
  assert.equal(segments[1].start, plan.segments[0].durationFrames);
  assert.deepEqual(saved.production, p.production);
});

test("duplicate scene IDs, cross-scene shot takeover, and unsupported video durations are rejected", () => {
  const p = picture();
  assert.throws(
    () => createDirectorScene(p, { sceneId: scene.sceneId, title: "Duplicate" }),
    /already exists/,
  );
  const plan = directorPlanForScene(p, scene.sceneId);
  plan.segments[0].shotId = p.shots.find((shot) => shot.sceneId !== plan.sceneId)!.id;
  assert.throws(() => saveDirectorPlan(p, plan), /another scene/);
  plan.segments[0].shotId = scene.segments[0].shotId;
  plan.segments[0].durationFrames = 1;
  assert.throws(() => saveDirectorPlan(p, plan), /0.1 seconds/);
});
