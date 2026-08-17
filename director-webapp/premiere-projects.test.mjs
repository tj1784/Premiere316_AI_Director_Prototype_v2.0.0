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
  workspaceForProjectClip
} from "./premiere-projects.mjs";
import { buildSegmentJobs, workspaceFromWorkflow } from "./workflow-compiler.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const authoritativeStoryboardFile = path.join(repoRoot, "projects", "harrowing_of_hell", "production", "storyboard.json");
const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceGraph = JSON.parse(sourceText);

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("lists Premiere projects and exposes the production storyboard", () => {
  const projects = projectCatalog();
  assert.equal(projects.length, 7);
  const harrowing = projects.find((project) => project.slug === "harrowing_of_hell");
  assert.ok(harrowing);
  assert.equal(harrowing.hasStoryboard, true);
  assert.equal(harrowing.storyboardClipCount, 153);
  assert.equal(harrowing.storyboardFrameCount, 0);
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
    { chapters: 11, scenes: 38, clips: 153, frames: 0, segments: 392, references: 678, runtimeFrames: 54_792 }
  );
});

test("keeps the complete Harrowing storyboard on direct semantic T2V without temporal guides", () => {
  const storyboard = JSON.parse(fs.readFileSync(authoritativeStoryboardFile, "utf8"));
  const clips = Object.values(storyboard.clips || {});
  const plans = Object.values(storyboard.videoPlans || {});
  const segments = Object.values(storyboard.segments || {});

  assert.equal(clips.length, 153);
  assert.equal(plans.length, 153);
  assert.equal(Object.keys(storyboard.frames || {}).length, 0);
  assert.equal(storyboard.defaults.firstFrameGeneration, false);
  assert.equal(storyboard.defaults.lastFrameGeneration, false);
  assert.equal(storyboard.defaults.timedImageSegments, false);
  assert.ok(clips.every((clip) => clip.generationMode === "t2v_with_semantic_references"));
  assert.ok(plans.every((plan) => plan.generationMode === "t2v_with_semantic_references"));
  assert.ok(plans.every((plan) => plan.referenceMode === "semantic_reference_resolver"));
  assert.ok(plans.every((plan) => plan.referenceCount === plan.referenceFiles.length));
  assert.ok(plans.every((plan) => plan.referenceFiles.length <= storyboard.defaults.maxReferences));
  assert.equal(plans.filter((plan) => plan.referenceFiles.length === 0).length, 34);
  assert.ok(plans.every((plan) => plan.droppedReferenceFiles.length === 0));
  assert.ok(segments.every((segment) => segment.type === "text"));
  assert.ok(plans.flatMap((plan) => plan.timelineData.segments).every((segment) =>
    segment.type === "text"
    && !segment.imageFile
    && !segment.videoFile
    && !segment.projectMediaPath
    && segment.missingGuide !== true
  ));
});

test("returns approved media and marks explicit semantic T2V scenes ready without frame guides", () => {
  const overview = projectOverview("harrowing_of_hell");
  assert.equal(overview.storyboard.clips.length, 153);
  assert.ok(overview.approvedMedia.length > 0);
  assert.equal(overview.storyboard.generatedFrames.length, 0);
  const first = overview.storyboard.clips.find((clip) => clip.id === "H01-S01-C01");
  assert.equal(first.ready, true);
  assert.equal(first.frameCount, 0);
  assert.equal(first.generatedFrameCount, 0);
  assert.equal(first.generationMode, "t2v_with_semantic_references");
  assert.equal(first.referenceMode, "semantic_reference_resolver");
  assert.equal(first.referenceCount, 4);
});

test("loads one semantic T2V Premiere clip without rewriting the source storyboard", () => {
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
  assert.equal(workspace.settings.queueMode, "timeline");
  assert.deepEqual(workspace.stats, { durationFrames: 360, durationSeconds: 15 });
  assert.equal(workspace.timeline.normalDurationFrames, 360);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.type), ["text", "text", "text", "text"]);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.start), [0, 72, 144, 192]);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.length), [72, 72, 48, 168]);
  assert.equal(workspace.timeline.segments.reduce((sum, segment) => sum + segment.length, 0), 360);
  assert.equal(buildSegmentJobs(workspace).length, 0);
  assert.equal(workspace.premiere.generationMode, "t2v_with_semantic_references");
  assert.equal(workspace.premiere.referenceMode, "semantic_reference_resolver");
  assert.equal(workspace.premiere.referenceRoot, "reference_assets");
  assert.equal(workspace.premiere.referenceCount, 4);
  assert.equal(workspace.premiere.expectedReferenceCount, 4);
  assert.deepEqual(workspace.premiere.referenceFiles, [
    "characters/jesus.png",
    "locations/abyss.png",
    "locations/descent_shaft.png",
    "vfx/smoke_ash_atmosphere.png"
  ]);
  assert.equal(sha(projectFile), projectBefore);
  assert.equal(sha(authoritativeStoryboardFile), before);
});

test("keeps a second explicit semantic T2V plan text-only and out of legacy segment jobs", () => {
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C02");
  assert.ok(workspace.timeline.segments.length > 0);
  assert.ok(workspace.timeline.segments.every((segment) => segment.type === "text"));
  assert.ok(workspace.timeline.segments.every((segment) => segment.missingGuide === false));
  assert.ok(workspace.timeline.segments.every((segment) => !segment.projectMediaPath));
  assert.equal(buildSegmentJobs(workspace).length, 0);
  assert.equal(workspace.premiere.generationMode, "t2v_with_semantic_references");
  assert.equal(workspace.premiere.referenceCount, 7);
});

test("exposes exact canonical semantic references for a T2V video plan", () => {
  const result = sceneReferenceMedia("harrowing_of_hell", "H01-S01-C01");
  assert.equal(result.clipId, "H01-S01-C01");
  assert.equal(result.videoPlanId, "video-h01-s01-c01");
  assert.equal(result.generationMode, "t2v_with_semantic_references");
  assert.equal(result.referenceMode, "semantic_reference_resolver");
  assert.equal(result.referenceRoot, "reference_assets");
  assert.equal(result.referenceCount, 4);
  assert.equal(result.expectedReferenceCount, 4);
  assert.equal(result.resolvedReferenceCount, 4);
  assert.equal(result.references.length, 4);
  assert.equal(result.references.filter((item) => item.required).length, 3);
  assert.equal(result.referencesReady, true);
  assert.deepEqual(result.invalidReferences, []);
  assert.deepEqual(result.frameIds, []);
  assert.deepEqual(result.references.map((item) => [item.role, item.canonicalFile]), [
    ["identity", "characters/jesus.png"],
    ["location", "locations/abyss.png"],
    ["location", "locations/descent_shaft.png"],
    ["atmosphere_vfx", "vfx/smoke_ash_atmosphere.png"]
  ]);
  assert.ok(result.references.every((item) => item.targetKind === "video_plan"));
  assert.ok(result.references.every((item) => item.useMode === "semantic_reference"));
  assert.ok(result.references.every((item) => item.frameId === null));
  assert.ok(result.references.every((item) => item.file.startsWith("reference_assets/")));
  assert.ok(result.references.every((item) => item.previewUrl.startsWith("/api/premiere/references/harrowing_of_hell?file=")));
  assert.ok(result.references.every((item) => item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.equal(result.references[0].sha256, "71afa83d8f2e8bc988a89f8fd9bdde31979f662509f4d0d61337e6e2a270e5e2");
  assert.equal(result.references[0].bytes, 2_698_083);
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
