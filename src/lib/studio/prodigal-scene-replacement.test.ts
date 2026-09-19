import test from "node:test";
import assert from "node:assert/strict";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { applyExplicitProdigalSceneReplacement, hydrateProdigalSceneReplacements } from "./prodigal-scene-replacement.ts";
import { hydrateProdigalSonDirector } from "./prodigal-director.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { directorPlanForScene, directorPlanImages } from "./director-scene-authoring.ts";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";
import { isPerformanceDraftStale, performanceSourceKey, type PerformanceDraft } from "../emotion/integration.ts";
import { seedCinematographyFromPicture } from "../cinematography.ts";
import type { VideoTake } from "../production/video-types.ts";

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

test("reused shot IDs lose former approvals while earlier media stays in review history", () => {
  const original = baseline();
  const oldIterations = original.generateGates!.iterations.filter((iteration) => iteration.shotId.startsWith("PS-S01-"));
  const oldIds = new Set(oldIterations.map((iteration) => iteration.id));
  const updated = hydrateProdigalSceneReplacements(original);
  for (const pair of updated.generateGates!.pairs.filter((pair) => pair.shotId.startsWith("PS-S01-"))) {
    assert.equal(pair.firstApprovedId, null); assert.equal(pair.lastApprovedId, null); assert.equal(pair.waived, false);
  }
  for (const iteration of updated.generateGates!.iterations.filter((iteration) => iteration.shotId.startsWith("PS-S01-"))) {
    assert.equal(iteration.canonical, false);
    if (oldIds.has(iteration.id)) {
      const previous = oldIterations.find((item) => item.id === iteration.id)!;
      assert.equal(iteration.mediaUri, previous.mediaUri);
      assert.equal(iteration.mediaSha256, previous.mediaSha256);
      assert.equal(iteration.status, previous.canonical || previous.status === "APPROVED" ? "STALE" : previous.status);
    } else assert.equal(iteration.status, "NEEDS_REVIEW");
  }
  assert.ok(oldIterations.every((iteration) => updated.generateGates!.iterations.some((item) => item.id === iteration.id)));
  assert.deepEqual(updated.generateGates!.prompts.slice(0, original.generateGates!.prompts.length), original.generateGates!.prompts);
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

function replacement210() {
  const source = structuredClone(sourceScene);
  source.replacement!.revision = "explicit-210-second-replacement";
  source.replacement!.shotTitles = source.replacement!.shotTitles.slice(0, 16);
  source.replacement!.screenplayMarkdown = "# Replacement opening\n\n## EXT. TEMPLE COURTYARD - DAY\n\nJesus sees the young listener.\n\nJESUS\n\nA certain man had two sons.\n";
  source.storyDurationSeconds = source.generationDurationSeconds = 210;
  let start = 0;
  source.segments = source.segments.slice(0, 16).map((segment, index) => {
    const durationFrames = index === 15 ? 360 : 312;
    const next = { ...segment, startFrame: start, durationFrames, durationSeconds: durationFrames / 24 };
    start += durationFrames;
    return next;
  });
  return source;
}

test("explicit Scene 01 import updates the active version without weakening automatic hydration", () => {
  const original = baseline(), source = replacement210();
  const approved = original.screenplay.versions.find((version) => version.id === original.screenplay.approvedVersionId)!;
  original.screenplay.versions.push({ ...approved, id: "active-approved-version" });
  original.screenplay.approvedVersionId = "active-approved-version";
  const snapshot = structuredClone(original);
  assert.equal(hydrateProdigalSceneReplacements(original), original, "automatic version guard remains intact");
  const updated = applyExplicitProdigalSceneReplacement(original, source, PRODIGAL_SON_DIRECTOR);
  assert.deepEqual(original, snapshot);
  assert.equal(updated.shots.filter((shot) => shot.sceneId === sceneId).length, 16);
  assert.equal(updated.scenes[0].durationSec, 210);
  assert.equal(updated.directorScenes![sceneId].segments.reduce((total, segment) => total + segment.durationFrames, 0), 5040);
  assert.equal(updated.performance!.beats.filter((beat) => beat.sceneId === sceneId).length, 16);
  assert.deepEqual(outside(updated.shots).map((shot) => ({ ...shot, index: shot.index - 12 })), outside(original.shots));
  assert.deepEqual(updated.scenes.slice(1), original.scenes.slice(1));
  assert.equal(suffix(updated.screenplay.workingFountain), suffix(original.screenplay.workingFountain));
  assert.equal(updated.screenplay.approvedVersionId, "active-approved-version");
  assert.equal(updated.screenplay.status, "READY_FOR_REVIEW");
  assert.deepEqual(updated.screenplay.versions.slice(0, -1), original.screenplay.versions);
  assert.equal(updated.characters, original.characters);
  assert.equal(updated.characterVoiceDesigns, original.characterVoiceDesigns);
  assert.equal(updated.production, original.production);
  assert.equal(hydrateProdigalSceneReplacements(updated), updated);
  updated.shots[0].i2vPrompt = "User edit after importing";
  assert.equal(applyExplicitProdigalSceneReplacement(updated, source, PRODIGAL_SON_DIRECTOR), updated);
});

test("explicit replacement un-applies old Cueboard and preserves takes, frame history and camera approvals for review", () => {
  const original = hydrateProdigalSceneReplacements(baseline()), source = replacement210();
  const oldSource = performanceSourceKey(original, sceneId);
  const draft = { id: "old-cueboard", sceneId, source: oldSource } as PerformanceDraft;
  original.emotionPerformance = { schemaVersion: 1, drafts: [draft], applied: { [sceneId]: draft.id, "PS-S02": "later-cueboard" }, history: [{ sceneId, draftId: draft.id, at: 1 }] };
  original.cinematography = seedCinematographyFromPicture(original, 1);
  original.cinematography.shotPlans[0].status = "APPROVED";
  original.cinematography.shotPlans[0].approvedVersionId = "old-camera-approval";
  const oldTake = { id: "old-take", shotId: original.shots[0].id, canonical: true, status: "CANONICAL", mediaUri: "/earlier-scene1.mp4" } as VideoTake;
  const laterTake = { ...oldTake, id: "later-take", shotId: original.shots.find((shot) => shot.sceneId === "PS-S02")!.id };
  original.video = { schemaVersion: 1, takes: [oldTake, laterTake], jobs: [], schedulerSnapshot: null };
  const updated = applyExplicitProdigalSceneReplacement(original, source, PRODIGAL_SON_DIRECTOR);
  assert.equal(updated.emotionPerformance!.applied[sceneId], undefined);
  assert.equal(updated.emotionPerformance!.applied["PS-S02"], "later-cueboard");
  assert.equal(updated.emotionPerformance!.drafts, original.emotionPerformance.drafts);
  assert.deepEqual(updated.emotionPerformance!.history, [...original.emotionPerformance.history, { sceneId, draftId: null, at: PRODIGAL_SON_DIRECTOR.createdAt }]);
  assert.equal(isPerformanceDraftStale(updated, draft), true, "changed scene shots/beats invalidate its source hash without falsifying screenplay approval");
  assert.equal(updated.video!.takes[0].mediaUri, oldTake.mediaUri);
  assert.equal(updated.video!.takes[0].canonical, false);
  assert.equal(updated.video!.takes[0].status, "NEEDS_REVIEW");
  assert.equal(updated.video!.takes[1], laterTake);
  assert.equal(updated.cinematography!.shotPlans[0].status, "STALE");
  assert.equal(updated.cinematography!.shotPlans[0].approvedVersionId, null);
  assert.deepEqual(outside(updated.cinematography!.shotPlans), outside(original.cinematography.shotPlans));
  assert.equal(updated.cinematography!.approvals, original.cinematography.approvals);
  assert.equal(new Set(updated.generateGates!.iterations.map((item) => item.id)).size, updated.generateGates!.iterations.length, "reused media does not collide with the earlier iteration ID");
  assert.deepEqual(updated.generateGates!.prompts.slice(0, original.generateGates!.prompts.length), original.generateGates!.prompts);
  assert.equal(updated.generateGates!.iterations.length, original.generateGates!.iterations.length + 16);
  const activeIds = new Set(source.segments.map((segment) => segment.shotId));
  assert.ok(updated.generateGates!.pairs.filter((pair) => pair.shotId.startsWith("PS-S01-")).every((pair) => activeIds.has(pair.shotId) && pair.firstApprovedId === null));
  assert.ok(!updated.shots.some((shot) => shot.id === "PS-S01-SH022"));
  assert.ok(updated.generateGates!.iterations.some((item) => item.shotId === "PS-S01-SH022"), "removed shot's earlier frame survives as history");
});

test("explicit replacement fails closed on wrong targets, conflicting IDs and invalid source structure", () => {
  const original = baseline();
  assert.throws(() => applyExplicitProdigalSceneReplacement({ ...original, id: "another-picture" }, replacement210(), PRODIGAL_SON_DIRECTOR), /matching active/);
  assert.throws(() => applyExplicitProdigalSceneReplacement(original, { ...replacement210(), sceneId: "PS-S02" }, PRODIGAL_SON_DIRECTOR), /Scene 01/);
  const bad = replacement210();
  bad.segments[1].startFrame += 1;
  assert.throws(() => applyExplicitProdigalSceneReplacement(original, bad, PRODIGAL_SON_DIRECTOR), /invalid/);
  const collision = replacement210();
  collision.segments[0].shotId = original.shots.find((shot) => shot.sceneId === "PS-S02")!.id;
  assert.throws(() => applyExplicitProdigalSceneReplacement(original, collision, PRODIGAL_SON_DIRECTOR), /conflicting/);
  const duplicates = replacement210();
  duplicates.segments[1].segmentId = duplicates.segments[0].segmentId;
  assert.throws(() => applyExplicitProdigalSceneReplacement(original, duplicates, PRODIGAL_SON_DIRECTOR), /invalid/);
  assert.throws(() => applyExplicitProdigalSceneReplacement({ ...original, screenplay: { ...original.screenplay, workingFountain: "Scene removed" } }, replacement210(), PRODIGAL_SON_DIRECTOR), /exactly once/);
});
