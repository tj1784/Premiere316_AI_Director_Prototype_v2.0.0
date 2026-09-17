import test from "node:test";
import assert from "node:assert/strict";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { hydrateProdigalSceneReplacements } from "./prodigal-scene-replacement.ts";
import { hydrateProdigalSonDirector } from "./prodigal-director.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { directorPlanForScene, directorPlanImages } from "./director-scene-authoring.ts";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";

const sceneId = "PS-S01";
const sourceScene = PRODIGAL_SON_DIRECTOR.scenes.find((scene) => scene.sceneId === sceneId)!;
const baseline = () => hydrateProdigalSonFrames(makeProdigalSonPicture());
const outside = <T extends { sceneId: string }>(items: T[]) => items.filter((item) => item.sceneId !== sceneId);
const suffix = (fountain: string) => fountain.slice(parseScreenplayHierarchy(fountain).nodes.find((node) => node.id === "PS-S02" && node.kind === "scene")!.sourceStart);

test("rebuilt opening replaces 4 old shots with all 22 exact segments and source images", () => {
  const original = baseline();
  const snapshot = structuredClone(original);
  const updated = hydrateProdigalSceneReplacements(original);
  assert.equal(updated.shots.length, 152);
  const shots = updated.shots.filter((shot) => shot.sceneId === sceneId);
  assert.equal(shots.length, 22);
  assert.equal(shots.reduce((sum, shot) => sum + shot.durationSec, 0), 280);
  assert.equal(new Set(sourceScene.segments.map((segment) => segment.startImage.sha256)).size, 9);
  assert.deepEqual(shots.map((shot) => shot.index), Array.from({ length: 22 }, (_, index) => index + 1));
  assert.deepEqual(shots.map((shot) => [shot.id, shot.durationSec, shot.i2vPrompt, shot.stillUrl]), sourceScene.segments.map((segment) => [segment.shotId, segment.durationSeconds, segment.prompt, segment.startImage.mediaUri]));
  assert.equal(updated.scenes[0].durationSec, 280);
  assert.equal(updated.scenes[0].emotionalBeat, sourceScene.title);
  assert.match(updated.scenes[0].slugline, /TEMPLE COURTYARD/);
  assert.equal(updated.performance!.scenes[0].slugline, updated.scenes[0].slugline);
  assert.equal(updated.performance!.shots.filter((shot) => shot.sceneId === sceneId).length, 22);
  assert.equal(updated.performance!.beats.filter((beat) => beat.sceneId === sceneId).length, 22);
  for (const shot of updated.performance!.shots.filter((shot) => shot.sceneId === sceneId)) {
    assert.equal(shot.durationSec, shots.find((item) => item.id === shot.shotId)!.durationSec);
    assert.equal(updated.performance!.shotVersions[shot.canonicalShotId].version, shot.version);
    assert.equal(updated.performance!.queue[shot.canonicalShotId].compileState, "PLANNED");
    assert.ok(updated.frameBundle!.importedShotIds.includes(shot.shotId));
  }
  const plan = directorPlanForScene(updated, sceneId);
  assert.equal(plan.segments.length, 22);
  assert.equal(plan.width, 0); assert.equal(plan.height, 0);
  assert.equal(plan.baseSteps, 30); assert.equal(plan.refineSteps, 8);
  assert.equal(plan.outputPrefix, sourceScene.replacement!.settings.outputPrefix);
  const images = directorPlanImages(updated, plan);
  assert.deepEqual(images.issues, []);
  assert.deepEqual(Object.values(images.guides).map((image) => image.sha256), sourceScene.segments.map((segment) => segment.startImage.sha256));
  assert.deepEqual(original, snapshot, "input is immutable");
});

test("other scenes and user data survive exactly except necessary global shot/beat index offsets", () => {
  const original = baseline();
  original.shots.find((shot) => shot.sceneId === "PS-S02")!.i2vPrompt = "User's later-scene performance";
  original.directorNotes = "Unrelated user direction";
  original.directorWorkflowDrafts = { "PS-S01": { sourceRevision: "old", draftJson: "old-opening", updatedAt: 1 }, "PS-S02": { sourceRevision: "user", draftJson: "later-user-draft", updatedAt: 2 } };
  original.directorScenes = { "PS-S02": directorPlanForScene(original, "PS-S02") };
  original.performance!.dependencyGraph.nodes.push({ kind: "asset", id: "user-dependency" });
  original.performance!.dependencyGraph.edges.push({ from: { kind: "asset", id: "user-dependency" }, to: { kind: "scene", id: "PS-S02" }, reason: "User requirement" });
  const updated = hydrateProdigalSceneReplacements(original);
  assert.deepEqual(outside(updated.shots).map((shot) => ({ ...shot, index: shot.index - 18 })), outside(original.shots));
  assert.deepEqual(outside(updated.performance!.shots).map((shot) => ({ ...shot, sequenceOrder: shot.sequenceOrder - 18 })), outside(original.performance!.shots));
  assert.deepEqual(outside(updated.performance!.beats).map((beat) => ({ ...beat, sequence: beat.sequence - 18 })), outside(original.performance!.beats));
  assert.deepEqual(updated.scenes.slice(1), original.scenes.slice(1));
  assert.equal(updated.production, original.production);
  assert.equal(updated.importedPackage, original.importedPackage);
  assert.equal(updated.research, original.research);
  assert.equal(updated.directorNotes, original.directorNotes);
  assert.equal(updated.directorScenes!["PS-S02"], original.directorScenes!["PS-S02"]);
  assert.equal(updated.directorWorkflowDrafts!["PS-S02"], original.directorWorkflowDrafts!["PS-S02"]);
  assert.equal(updated.directorWorkflowDrafts!["PS-S01"], undefined);
  const ids = new Set(original.shots.filter((shot) => shot.sceneId === sceneId).map((shot) => shot.id));
  assert.deepEqual(updated.generateGates!.pairs.filter((pair) => !pair.shotId.startsWith("PS-S01-")), original.generateGates!.pairs.filter((pair) => !ids.has(pair.shotId)));
  assert.deepEqual(updated.generateGates!.iterations.filter((iteration) => !iteration.shotId.startsWith("PS-S01-")), original.generateGates!.iterations.filter((iteration) => !ids.has(iteration.shotId)));
  assert.ok(updated.performance!.dependencyGraph.edges.some((edge) => edge.reason === "User requirement"));
});

test("reused shot IDs lose former approvals and never inherit old media or queue readiness", () => {
  const original = baseline();
  const oldImageUris = original.generateGates!.iterations.filter((iteration) => iteration.shotId.startsWith("PS-S01-")).map((iteration) => iteration.mediaUri);
  const updated = hydrateProdigalSceneReplacements(original);
  for (const pair of updated.generateGates!.pairs.filter((pair) => pair.shotId.startsWith("PS-S01-"))) {
    assert.equal(pair.firstApprovedId, null); assert.equal(pair.lastApprovedId, null); assert.equal(pair.waived, false);
  }
  for (const iteration of updated.generateGates!.iterations.filter((iteration) => iteration.shotId.startsWith("PS-S01-"))) {
    assert.equal(iteration.canonical, false); assert.equal(iteration.status, "NEEDS_REVIEW");
    assert.ok(!oldImageUris.includes(iteration.mediaUri));
  }
  const oldBeat = original.performance!.shots[0].beatId;
  assert.ok(!updated.performance!.dependencyGraph.nodes.some((node) => node.kind === "beat" && node.id === oldBeat));
  assert.ok(updated.performance!.shots[0].version > original.performance!.shots[0].version);
});

test("screenplay update is a new manual version; source wording and later scenes are preserved", () => {
  const original = baseline();
  original.screenplay.workingFountain = original.screenplay.workingFountain.replace("Barley stubble", "User-edited barley stubble");
  const updated = hydrateProdigalSceneReplacements(original);
  assert.equal(updated.screenplay.approvedVersionId, original.screenplay.approvedVersionId);
  assert.deepEqual(updated.screenplay.versions.slice(0, -1), original.screenplay.versions);
  assert.equal(updated.screenplay.versions.at(-1)!.kind, "manual");
  assert.equal(updated.screenplay.currentVersionId, updated.screenplay.versions.at(-1)!.id);
  assert.equal(suffix(updated.screenplay.workingFountain), suffix(original.screenplay.workingFountain));
  assert.equal(suffix(updated.screenplayFountain), suffix(original.screenplayFountain));
  assert.match(updated.screenplay.workingFountain, /A certain man had two sons\./);
  assert.match(updated.screenplay.workingFountain, /The Temple opening is an imagined earlier experience/);
  assert.equal(parseScreenplayHierarchy(updated.screenplay.workingFountain).nodes.filter((node) => node.kind === "scene").length, original.scenes.length);
});

test("one-time revision preserves later user edits, removed shots and rejected images on reload", () => {
  const updated = hydrateProdigalSceneReplacements(baseline());
  updated.shots[0].i2vPrompt = "User's new opening performance";
  updated.shots = updated.shots.filter((shot) => shot.id !== "PS-S01-SH022");
  updated.performance!.shots = updated.performance!.shots.filter((shot) => shot.shotId !== "PS-S01-SH022");
  updated.generateGates!.iterations.find((iteration) => iteration.shotId === "PS-S01-SH001")!.status = "REJECTED";
  assert.equal(hydrateProdigalSceneReplacements(updated), updated);
  const saved = JSON.parse(JSON.stringify(updated));
  const reload = hydrateProdigalSceneReplacements(hydrateProdigalSonFrames(saved));
  assert.equal(reload.shots[0].i2vPrompt, "User's new opening performance");
  assert.ok(!reload.shots.some((shot) => shot.id === "PS-S01-SH022"));
  assert.ok(!reload.generateGates!.iterations.some((iteration) => iteration.shotId.startsWith("PS-S01-") && iteration.status === "APPROVED"));
  assert.deepEqual(reload.generateGates!.pairs.filter((pair) => pair.shotId.startsWith("PS-S01-")), saved.generateGates!.pairs.filter((pair: { shotId: string }) => pair.shotId.startsWith("PS-S01-") && pair.shotId !== "PS-S01-SH022"));
  assert.ok(reload.generateGates!.pairs.filter((pair) => pair.shotId.startsWith("PS-S01-")).every((pair) => pair.lastPromptVersionId === null && pair.lastPrompt === ""));
  assert.deepEqual(reload.generateGates!.prompts.filter((prompt) => prompt.shotId?.startsWith("PS-S01-")), saved.generateGates!.prompts.filter((prompt: { shotId: string | null }) => prompt.shotId?.startsWith("PS-S01-")));
});

test("fresh and saved import pipelines keep all 149 Director segments without changing other scenes", () => {
  const updated = hydrateProdigalSonDirector(hydrateProdigalSceneReplacements(baseline()));
  assert.equal(updated.shots.length, 152);
  assert.equal(updated.directorBundle!.importedShotIds.length, 149);
  assert.equal(updated.directorBundle!.skippedShotIds.length, 0);
  assert.equal(hydrateProdigalSceneReplacements(updated), updated);
});
