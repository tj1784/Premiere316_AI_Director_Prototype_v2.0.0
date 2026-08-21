import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  projectCatalog,
  projectJobs,
  projectOverview,
  resolveProjectMedia,
  resolveProjectReferenceMedia,
  sceneReferenceMedia,
  workspaceForProjectClip,
  boundStoryboardWorkspaceIsStale,
  refreshBoundWorkspaceFromStoryboard,
  listSegmentTakes,
  storyboardPlanFingerprintValue
} from "./premiere-projects.mjs";
import { buildSegmentJobs, workspaceFromWorkflow } from "./workflow-compiler.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const authoritativeStoryboardFile = path.join(repoRoot, "projects", "harrowing_of_hell", "production", "storyboard.json");
const authoritativeStoryboard = JSON.parse(fs.readFileSync(authoritativeStoryboardFile, "utf8"));
const hasH06H09Import = Boolean(authoritativeStoryboard.imports?.h06_h09_ltx25_i2v_complete_v1);
const hasH10Import = Boolean(authoritativeStoryboard.imports?.h10_ltx25_i2v_complete_v1);
const expectedProductionCounts = hasH10Import
  ? { frames: 372, references: 0, segmentedClips: 119, semanticClips: 34, imageSegments: 372, textSegments: 34 }
  : hasH06H09Import
    ? { frames: 325, references: 0, segmentedClips: 108, semanticClips: 45, imageSegments: 325, textSegments: 67 }
    : { frames: 190, references: 0, segmentedClips: 63, semanticClips: 90, imageSegments: 190, textSegments: 202 };
const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceGraph = JSON.parse(sourceText);

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function semanticReferenceFixture(clipId) {
  const storyboard = structuredClone(authoritativeStoryboard);
  const clip = storyboard.clips[clipId];
  const plan = storyboard.videoPlans[clip?.videoPlanId];
  assert.ok(clip && plan, `Missing semantic fixture ${clipId}`);
  clip.generationMode = "t2v_with_semantic_references";
  delete clip.firstFrameId;
  delete clip.referenceMode;
  plan.generationMode = "t2v_with_semantic_references";
  plan.referenceMode = "semantic_reference_resolver";
  plan.workflowProfileId = "ltx-2.5-t2v-semantic-reference-resolver";
  delete plan.firstFramePackage;
  delete plan.guideStrength;
  for (const segmentId of plan.segmentIds) {
    const segment = storyboard.segments[segmentId];
    segment.type = "text";
    delete segment.frameId;
    const timeline = plan.timelineData.segments.find((entry) => entry.id === segmentId);
    timeline.type = "text";
    for (const key of ["storyboardFrameId", "imageFile", "fileName", "projectMediaPath", "projectMediaBytes", "projectMediaSha256", "missingGuide"]) {
      delete timeline[key];
    }
  }
  return { storyboard, clip, plan };
}

test("lists Premiere projects and exposes the production storyboard", () => {
  const projects = projectCatalog();
  assert.equal(projects.length, 7);
  const harrowing = projects.find((project) => project.slug === "harrowing_of_hell");
  assert.ok(harrowing);
  assert.equal(harrowing.hasStoryboard, true);
  assert.equal(harrowing.storyboardClipCount, 153);
  assert.equal(harrowing.storyboardFrameCount, expectedProductionCounts.frames);
  const overview = projectOverview("harrowing_of_hell");
  assert.deepEqual(
    {
      chapters: overview.storyboard.summary.chapters,
      scenes: overview.storyboard.summary.scenes,
      clips: overview.storyboard.summary.clips,
      frames: overview.storyboard.summary.frames,
      segments: overview.storyboard.summary.segments,
      references: overview.storyboard.summary.referenceBindings,
      runtimeFrames: overview.storyboard.summary.runtimeFrames
    },
    {
      chapters: 11,
      scenes: 38,
      clips: 153,
      frames: expectedProductionCounts.frames,
      segments: 406,
      references: expectedProductionCounts.references,
      runtimeFrames: 57_888
    }
  );
});

test("keeps imported H01-H10 chapters on segmented I2V while preserving MV as semantic T2V", () => {
  const storyboard = JSON.parse(fs.readFileSync(authoritativeStoryboardFile, "utf8"));
  const clips = Object.values(storyboard.clips || {});
  const plans = Object.values(storyboard.videoPlans || {});
  const segments = Object.values(storyboard.segments || {});
  const h01Clips = clips.filter((clip) => clip.id.startsWith("H01-"));
  const h01Plans = plans.filter((plan) => plan.clipId.startsWith("H01-"));
  const isSegmentedChapter = (clipId) => (
    hasH10Import ? /^(?:H0[1-9]|H10)-/ : hasH06H09Import ? /^H0[1-9]-/ : /^H0[1-5]-/
  ).test(clipId);
  const segmentedClips = clips.filter((clip) => isSegmentedChapter(clip.id));
  const segmentedPlans = plans.filter((plan) => isSegmentedChapter(plan.clipId));
  const otherClips = clips.filter((clip) => !isSegmentedChapter(clip.id));
  const otherPlans = plans.filter((plan) => !isSegmentedChapter(plan.clipId));
  const imageSegments = segments.filter((segment) => segment.type === "image");
  const textSegments = segments.filter((segment) => segment.type === "text");

  assert.equal(clips.length, 153);
  assert.equal(plans.length, 153);
  assert.equal(Object.keys(storyboard.frames || {}).length, expectedProductionCounts.frames);
  assert.equal(storyboard.defaults.firstFrameGeneration, false);
  assert.equal(storyboard.defaults.lastFrameGeneration, false);
  assert.equal(storyboard.defaults.timedImageSegments, false);
  assert.deepEqual(h01Clips.map((clip) => clip.id), ["H01-S01-C01", "H01-S01-C02", "H01-S02-C01", "H01-S02-C02"]);
  assert.ok(h01Clips.every((clip) => clip.generationMode === "i2v_segmented_first_frames"));
  assert.ok(h01Plans.every((plan) => plan.generationMode === "i2v_segmented_first_frames"));
  assert.ok(h01Plans.every((plan) => plan.referenceMode === "segment_first_frames"));
  assert.deepEqual(h01Plans.map((plan) => plan.segmentIds.length), [18, 3, 3, 3]);
  assert.equal(segmentedClips.length, expectedProductionCounts.segmentedClips);
  assert.equal(segmentedPlans.length, expectedProductionCounts.segmentedClips);
  assert.ok(segmentedClips.every((clip) => clip.generationMode === "i2v_segmented_first_frames"));
  assert.ok(segmentedPlans.every((plan) => plan.generationMode === "i2v_segmented_first_frames"));
  assert.ok(segmentedPlans.every((plan) => plan.referenceMode === "segment_first_frames"));
  assert.ok(otherClips.every((clip) => clip.generationMode === "t2v_with_semantic_references"));
  assert.ok(otherPlans.every((plan) => plan.generationMode === "t2v_with_semantic_references"));
  assert.ok(otherPlans.every((plan) => plan.referenceMode === "semantic_reference_resolver"));
  assert.equal(otherClips.length, expectedProductionCounts.semanticClips);
  assert.equal(otherPlans.length, expectedProductionCounts.semanticClips);
  assert.ok(plans.every((plan) => plan.referenceCount === plan.referenceFiles.length));
  assert.ok(plans.every((plan) => plan.referenceFiles.length <= storyboard.defaults.maxReferences));
  assert.equal(otherPlans.filter((plan) => plan.referenceFiles.length === 0).length, 34);
  assert.ok(plans.every((plan) => plan.droppedReferenceFiles.length === 0));
  assert.equal(imageSegments.length, expectedProductionCounts.imageSegments);
  assert.equal(textSegments.length, expectedProductionCounts.textSegments);
  assert.ok(segmentedPlans.flatMap((plan) => plan.timelineData.segments).every((segment) =>
    segment.type === "image"
    && segment.imageFile
    && segment.fileName
    && segment.missingGuide !== true
  ));
  assert.ok(otherPlans.flatMap((plan) => plan.timelineData.segments).every((segment) =>
    segment.type === "text"
    && !segment.imageFile
    && !segment.videoFile
    && !segment.projectMediaPath
    && segment.missingGuide !== true
  ));
});

test("returns approved media and marks segmented I2V ready with every generated guide", () => {
  const overview = projectOverview("harrowing_of_hell");
  assert.equal(overview.storyboard.clips.length, 153);
  assert.ok(overview.approvedMedia.length > 0);
  assert.equal(overview.storyboard.generatedFrames.length, expectedProductionCounts.frames);
  const first = overview.storyboard.clips.find((clip) => clip.id === "H01-S01-C01");
  assert.equal(first.ready, true);
  assert.equal(first.frameCount, 18);
  assert.equal(first.generatedFrameCount, 18);
  assert.equal(first.durationFrames, 3456);
  assert.equal(first.generationMode, "i2v_segmented_first_frames");
  assert.equal(first.referenceMode, "segment_first_frames");
  assert.equal(first.referenceCount, 0);
});

test("loads H01-S01-C01 as eighteen 8-second 2m24s I2V jobs without rewriting the source storyboard", () => {
  const projectFile = path.join(repoRoot, "projects", "harrowing_of_hell", "project.json");
  const projectBefore = sha(projectFile);
  const before = sha(authoritativeStoryboardFile);
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C01");
  assert.equal(workspace.premiere.projectSlug, "harrowing_of_hell");
  assert.equal(workspace.premiere.clipId, "H01-S01-C01");
  assert.equal(workspace.settings.frameRate, 24);
  assert.equal(workspace.settings.customWidth, 1152);
  assert.equal(workspace.settings.customHeight, 480);
  assert.equal(workspace.settings.queueMode, "segments");
  assert.equal(workspace.settings.generationProfile, "LTX2.5_Premiere316");
  assert.equal(workspace.settings.lengthModel, "auto_ltx_8n_plus_1");
  assert.equal(workspace.premiere.workflowProfileId, "LTX2.5_Premiere316");
  assert.equal(workspace.premiere.semanticReferencesReady, true);
  assert.equal(workspace.premiere.expectedReferenceCount, 0);
  assert.deepEqual(workspace.premiere.semanticReferences, []);
  assert.deepEqual(workspace.stats, { durationFrames: 3456, durationSeconds: 144 });
  assert.equal(workspace.timeline.normalDurationFrames, 3456);
  assert.equal(workspace.timeline.segments.length, 18);
  assert.ok(workspace.timeline.segments.every((segment) => segment.type === "image"));
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.start), Array.from({ length: 18 }, (_, index) => index * 192));
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.length), Array.from({ length: 18 }, () => 192));
  assert.equal(workspace.timeline.segments.reduce((sum, segment) => sum + segment.length, 0), 3456);
  assert.match(workspace.timeline.global_prompt, /144 seconds \(2:24\) across 18 authored segments/);
  assert.match(String(workspace.premiere.planFingerprint || ""), /^[a-f0-9]{64}$/);
  const storyboard = JSON.parse(fs.readFileSync(authoritativeStoryboardFile, "utf8"));
  const plan = storyboard.videoPlans[workspace.premiere.videoPlanId];
  const expectedPrompts = plan.segmentIds.map((id) => storyboard.segments[id].prompt);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.prompt), expectedPrompts);
  assert.equal(new Set(expectedPrompts).size, 18, "each H01-S01-C01 segment must keep its own action prompt");
  const isolatedWorkspace = structuredClone(workspace);
  for (const segment of isolatedWorkspace.timeline.segments) {
    segment.usePreviousAsFirstFrame = false;
    segment.useNextAsLastFrame = false;
  }
  const jobs = buildSegmentJobs(isolatedWorkspace);
  assert.equal(jobs.length, 18);
  assert.equal(new Set(jobs.map((job) => job.sourceSegmentId)).size, 18);
  assert.ok(jobs.every((job) => job.timeline.segments.length === 1), "with optional neighbor controls disabled, each H01-S01-C01 job owns exactly its selected temporal guide");
  assert.deepEqual(jobs.map((job) => [job.sourceSegmentId, job.requestedFrames, job.generationFrames]), [
    ["segment-h01-s01-c01-01", 192, 193],
    ["segment-h01-s01-c01-02", 192, 193],
    ["segment-h01-s01-c01-03", 192, 193],
    ["segment-h01-s01-c01-04", 192, 193],
    ["segment-h01-s01-c01-05", 192, 193],
    ["segment-h01-s01-c01-06", 192, 193],
    ["segment-h01-s01-c01-07", 192, 193],
    ["segment-h01-s01-c01-08", 192, 193],
    ["segment-h01-s01-c01-09", 192, 193],
    ["segment-h01-s01-c01-10", 192, 193],
    ["segment-h01-s01-c01-11", 192, 193],
    ["segment-h01-s01-c01-12", 192, 193],
    ["segment-h01-s01-c01-13", 192, 193],
    ["segment-h01-s01-c01-14", 192, 193],
    ["segment-h01-s01-c01-15", 192, 193],
    ["segment-h01-s01-c01-16", 192, 193],
    ["segment-h01-s01-c01-17", 192, 193],
    ["segment-h01-s01-c01-18", 192, 193]
  ]);
  assert.deepEqual(jobs.map((job) => job.timeline.segments[0].fileName), [
    "H01-S01-C01_first.v4.2m24s-i2v-master.png",
    "H01-S01-C01_seg02.v5.2m24s-i2v-master.png",
    "H01-S01-C01_seg03.v3.2m24s-i2v-master.png",
    "H01-S01-C01_seg04.v3.2m24s-i2v-master.png",
    "H01-S01-C01_seg05.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg06.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg07.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg08.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg09.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg10.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg11.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg12.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg13.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg14.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg15.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg16.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg17.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg18.v1.2m24s-i2v-master.png"
  ]);
  assert.deepEqual(jobs.map((job) => job.timeline.segments[0].projectMediaPath), [
    "media/storyboard/H01-S01-C01_first.v4.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg02.v5.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg03.v3.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg04.v3.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg05.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg06.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg07.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg08.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg09.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg10.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg11.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg12.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg13.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg14.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg15.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg16.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg17.v1.2m24s-i2v-master.png",
    "media/storyboard/H01-S01-C01_seg18.v1.2m24s-i2v-master.png"
  ]);
  assert.deepEqual(jobs.map((job) => job.localPrompts), expectedPrompts);
  assert.deepEqual(jobs.map((job) => job.timeline.segments[0].prompt), expectedPrompts);
  assert.equal(new Set(jobs.map((job) => job.localPrompts)).size, 18);
  assert.equal(workspace.premiere.generationMode, "i2v_segmented_first_frames");
  assert.equal(sha(projectFile), projectBefore);
  assert.equal(sha(authoritativeStoryboardFile), before);
});

test("H03+ workspaces scope dialogue turns to one segment without changing H02 behavior", () => {
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const h02 = workspaceForProjectClip(base, "harrowing_of_hell", "H02-S03-C01");
  assert.match(h02.timeline.global_prompt, /Silent picture pass\. Torturer: Say the promise was a lie\. Adam: No\./);
  assert.ok(h02.timeline.segments.every((segment) => !segment.dialogueDirection));

  const h03 = workspaceForProjectClip(base, "harrowing_of_hell", "H03-S06-C03");
  assert.match(h03.timeline.global_prompt, /AUDIO \/ DIALOGUE CONTRACT/);
  assert.doesNotMatch(h03.timeline.global_prompt, /Silent picture pass|Jesus: Adam|Adam: I remember Your voice/);
  assert.deepEqual(h03.timeline.segments.map((segment) => segment.dialogueDirection || null), [
    null,
    "Jesus said, \"Adam.\"",
    "Then Adam replied, \"I remember Your voice.\""
  ]);

  const noDialogue = workspaceForProjectClip(base, "harrowing_of_hell", "H03-S06-C02");
  assert.ok(noDialogue.timeline.segments.every((segment) => !segment.dialogueDirection));
});


test("rebuilds a bound H01-S01-C01 workspace when the storyboard plan fingerprint changes", () => {
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const current = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C01");
  assert.equal(boundStoryboardWorkspaceIsStale(current), false);
  const stale = structuredClone(current);
  stale.stats = { durationFrames: 360, durationSeconds: 15 };
  stale.timeline.normalDurationFrames = 360;
  stale.timeline.segments = stale.timeline.segments.slice(0, 4);
  stale.premiere.planFingerprint = "0".repeat(64);
  assert.equal(boundStoryboardWorkspaceIsStale(stale), true);
  const refreshed = refreshBoundWorkspaceFromStoryboard(stale);
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.workspace.stats.durationFrames, 3456);
  assert.equal(refreshed.workspace.timeline.segments.length, 18);
  assert.equal(refreshed.workspace.timeline.segments[0].fileName, "H01-S01-C01_first.v4.2m24s-i2v-master.png");
  assert.equal(boundStoryboardWorkspaceIsStale(refreshed.workspace), false);
});

test("reference-only storyboard changes invalidate the bound Director workspace fingerprint", () => {
  const storyboard = structuredClone(authoritativeStoryboard);
  const clip = Object.values(storyboard.clips).find((candidate) => {
    const candidatePlan = storyboard.videoPlans[candidate.videoPlanId];
    return candidatePlan?.segmentIds?.some((id) => storyboard.segments[id]?.frameId);
  });
  assert.ok(clip, "the storyboard must retain at least one temporal segment frame for this regression");
  const plan = storyboard.videoPlans[clip.videoPlanId];
  const frameId = plan.segmentIds.map((id) => storyboard.segments[id]?.frameId).find(Boolean);
  assert.ok(frameId);
  const frameReferencesBefore = structuredClone(storyboard.frames[frameId].references || []);
  const before = storyboardPlanFingerprintValue(storyboard, clip.id);
  const reference = {
    id: "ref-fingerprint-only-change",
    assetId: "asset-fingerprint-only-change",
    targetKind: "frame",
    targetId: frameId,
    canonicalFile: "characters/fingerprint-only-change.png",
    role: "identity",
    persistenceOrigin: "user",
    order: 1
  };
  storyboard.referenceBindings[reference.id] = reference;
  storyboard.frames[frameId].references = [reference];
  const after = storyboardPlanFingerprintValue(storyboard, clip.id);
  assert.notEqual(after, before);
  delete storyboard.referenceBindings[reference.id];
  storyboard.frames[frameId].references = frameReferencesBefore;
  assert.equal(storyboardPlanFingerprintValue(storyboard, clip.id), before);
});
test("keeps H01-S01-C02 reference-free after imported semantic references are cleared", () => {
  const state = sceneReferenceMedia("harrowing_of_hell", "H01-S01-C02");
  assert.equal(state.generationMode, "i2v_segmented_first_frames");
  assert.equal(state.expectedReferenceCount, 0);
  assert.equal(state.resolvedReferenceCount, 0);
  assert.equal(state.maxReferences, 9);
  assert.equal(state.semanticReferencesReady, true);
  assert.equal(state.referencesReady, true);
  assert.deepEqual(state.semanticReferences, []);
  assert.deepEqual(state.references, []);
  assert.deepEqual(state.invalidReferences, []);
});

test("keeps a remaining MV semantic T2V plan text-only and out of segmented I2V jobs", () => {
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "MV01-S01-C02");
  assert.ok(workspace.timeline.segments.length > 0);
  assert.ok(workspace.timeline.segments.every((segment) => segment.type === "text"));
  assert.ok(workspace.timeline.segments.every((segment) => segment.missingGuide === false));
  assert.ok(workspace.timeline.segments.every((segment) => !segment.projectMediaPath));
  assert.equal(buildSegmentJobs(workspace).length, 0);
  assert.equal(workspace.premiere.generationMode, "t2v_with_semantic_references");
  assert.equal(workspace.premiere.referenceCount, 0);
});

test("changing generation mode does not resurrect cleared H10 semantic references", () => {
  const { storyboard, clip, plan } = semanticReferenceFixture("H10-S33-C01");
  const references = Object.values(storyboard.referenceBindings)
    .filter((item) => item.targetKind === "video_plan" && item.targetId === plan.id)
    .sort((left, right) => left.order - right.order);
  assert.equal(clip.generationMode, "t2v_with_semantic_references");
  assert.equal(plan.generationMode, "t2v_with_semantic_references");
  assert.equal(plan.referenceMode, "semantic_reference_resolver");
  assert.equal(plan.referenceRoot, "reference_assets");
  assert.equal(plan.referenceCount, 0);
  assert.deepEqual(plan.referenceFiles, []);
  assert.deepEqual(references, []);
});

test("keeps temporal first-frame guides while cleared semantic references stay absent", () => {
  const clip = authoritativeStoryboard.clips["H01-S01-C02"];
  const plan = authoritativeStoryboard.videoPlans[clip.videoPlanId];
  const expectedFrameIds = plan.segmentIds.map((id) => authoritativeStoryboard.segments[id]?.frameId).filter(Boolean);
  assert.ok(expectedFrameIds.length > 0);
  const result = sceneReferenceMedia("harrowing_of_hell", clip.id);
  assert.equal(result.clipId, clip.id);
  assert.deepEqual(result.frameIds, expectedFrameIds);
  assert.equal(result.referencesReady, true);
  assert.deepEqual(result.invalidReferences, []);
  assert.equal(result.expectedReferenceCount, 0);
  assert.equal(result.resolvedReferenceCount, 0);
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.semanticReferences, []);
});

test("serves canonical semantic reference files through a separate contained resolver", () => {
  const canonical = resolveProjectReferenceMedia("harrowing_of_hell", "characters/jesus.png");
  const prefixed = resolveProjectReferenceMedia("harrowing_of_hell", "reference_assets/characters/jesus.png");
  assert.equal(fs.realpathSync.native(canonical), fs.realpathSync.native(prefixed));
  assert.equal(path.basename(canonical), "jesus.png");
  assert.throws(() => resolveProjectReferenceMedia("harrowing_of_hell", "../project.json"), /escaped the reference root/);
  assert.throws(() => resolveProjectReferenceMedia("harrowing_of_hell", "reference_assets\/..\/project.json"), /escaped the reference root/);
  assert.throws(() => resolveProjectReferenceMedia("harrowing_of_hell", "C:\\Windows\\win.ini"), /must be relative/);
});

test("keeps an authoritative zero-reference semantic plan ready without temporal guides", () => {
  const overview = projectOverview("harrowing_of_hell");
  const clip = overview.storyboard.clips.find((item) => item.id === "MV01-S01-C01");
  assert.ok(clip);
  assert.equal(clip.generationMode, "t2v_with_semantic_references");
  assert.equal(clip.referenceCount, 0);
  assert.equal(clip.frameCount, 0);
  assert.equal(clip.ready, true);

  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", clip.id);
  assert.equal(workspace.premiere.referenceCount, 0);
  assert.equal(workspace.premiere.expectedReferenceCount, 0);
  assert.deepEqual(workspace.premiere.referenceFiles, []);
  assert.ok(workspace.timeline.segments.length > 0);
  assert.ok(workspace.timeline.segments.every((segment) => segment.type === "text" && !segment.missingGuide));
  assert.equal(buildSegmentJobs(workspace).length, 0);

  const references = sceneReferenceMedia("harrowing_of_hell", clip.id);
  assert.equal(references.referenceCount, 0);
  assert.equal(references.expectedReferenceCount, 0);
  assert.equal(references.resolvedReferenceCount, 0);
  assert.equal(references.referencesReady, true);
  assert.deepEqual(references.referenceFiles, []);
  assert.deepEqual(references.references, []);
  assert.deepEqual(references.invalidReferences, []);
});

test("exposes the Jesus voice in the project library and keeps Director jobs in a separate ledger", () => {
  const overview = projectOverview("harrowing_of_hell");
  assert.ok(overview.projectLibrary.some((item) => item.file === "media/assets/voice-jesus.v1.wav" && item.mediaType === "audio"));
  assert.ok(overview.projectLibrary.some((item) => item.file === "media/assets/char-jesus-main.v4.png" && item.mediaType === "image"));
  assert.equal(overview.projectLibrary.filter((item) => item.mediaType === "audio").length, 8);
  const directorLedger = path.join(repoRoot, "projects", "harrowing_of_hell", "director-generation-jobs.json");
  const premiereLedger = path.join(repoRoot, "projects", "harrowing_of_hell", "generation-jobs.json");
  assert.notEqual(directorLedger, premiereLedger);
  assert.doesNotThrow(() => projectJobs("harrowing_of_hell"));
});

test("rejects project media path traversal", () => {
  assert.throws(() => resolveProjectMedia("..", "media/storyboard/a.png"), /Invalid project slug/);
  assert.throws(() => resolveProjectMedia("harrowing_of_hell", "../project.json"), /under media/);
  assert.throws(() => resolveProjectMedia("harrowing_of_hell", "media/../project.json"), /escaped the media root/);
  assert.throws(() => resolveProjectMedia("harrowing_of_hell", "media/storyboard/../../production/storyboard.json"), /escaped the media root/);
});

test("attaches existing H01-S01-C01 director mp4s as generated takes without rewriting the storyboard", () => {
  const before = sha(authoritativeStoryboardFile);
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C01");
  const byId = Object.fromEntries(workspace.timeline.segments.map((segment) => [segment.id, segment]));
  const first = byId["segment-h01-s01-c01-01"];
  const second = byId["segment-h01-s01-c01-02"];
  const last = byId["segment-h01-s01-c01-18"];
  assert.ok((first.generatedTakes || []).length >= 1, "H01 first segment should list at least the recorded take");
  assert.ok(first.generatedTakes.some((take) => String(take.file || take.previewFile).includes("segment-h01-s01-c01-01")), "first segment takes must point at its director mp4s");
  assert.ok((second.generatedTakes || []).length >= 1, "old H01 second-segment mp4s on disk should appear as takes");
  assert.ok(second.generatedTakes.some((take) => String(take.file || take.previewFile).includes("segment-h01-s01-c01-02")));
  assert.equal((last.generatedTakes || []).length, 0, "later 8s segments without mp4s stay empty");
  const listed = listSegmentTakes("harrowing_of_hell", "H01-S01-C01", "segment-h01-s01-c01-02");
  assert.ok(listed.takes.length >= 1);
  assert.ok(listed.takes.every((take) => String(take.file || take.previewFile).includes("segment-h01-s01-c01-02")));
  assert.equal(sha(authoritativeStoryboardFile), before);
});
