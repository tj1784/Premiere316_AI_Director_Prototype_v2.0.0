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
  sceneReferenceMedia,
  workspaceForProjectClip
} from "./premiere-projects.mjs";
import { buildSegmentJobs, workspaceFromWorkflow } from "./workflow-compiler.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
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
  assert.equal(harrowing.storyboardClipCount, 119);
  assert.equal(harrowing.storyboardFrameCount, 161);
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
    { chapters: 10, scenes: 34, clips: 119, frames: 161, segments: 357, references: 734, runtimeFrames: 48_960 }
  );
});

test("returns approved media, scene readiness, and generated storyboard frames", () => {
  const overview = projectOverview("harrowing_of_hell");
  assert.equal(overview.storyboard.clips.length, 119);
  assert.ok(overview.approvedMedia.length > 0);
  assert.equal(overview.storyboard.generatedFrames.length, 2);
  const first = overview.storyboard.clips.find((clip) => clip.id === "H01-S01-C01");
  assert.equal(first.ready, true);
  assert.equal(first.generatedFrameCount, 2);
});

test("loads one Premiere storyboard clip without rewriting the source storyboard", () => {
  const projectFile = path.join(repoRoot, "projects", "harrowing_of_hell", "project.json");
  const storyboardFile = path.join(repoRoot, "projects", "harrowing_of_hell", "production", "storyboard.json");
  const projectBefore = sha(projectFile);
  const before = sha(storyboardFile);
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C01");
  assert.equal(workspace.premiere.projectSlug, "harrowing_of_hell");
  assert.equal(workspace.premiere.clipId, "H01-S01-C01");
  assert.equal(workspace.settings.frameRate, 24);
  assert.equal(workspace.settings.customWidth, 1152);
  assert.equal(workspace.settings.customHeight, 480);
  assert.equal(workspace.settings.queueMode, "timeline");
  assert.deepEqual(workspace.stats, { durationFrames: 336, durationSeconds: 14 });
  assert.equal(workspace.timeline.normalDurationFrames, 336);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.type), ["image", "image", "text"]);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.start), [0, 120, 216]);
  assert.deepEqual(workspace.timeline.segments.map((segment) => segment.length), [120, 96, 120]);
  assert.equal(workspace.timeline.segments.reduce((sum, segment) => sum + segment.length, 0), 336);
  assert.equal(workspace.timeline.segments[0].projectMediaPath, "media/storyboard/H01-S01-C01_first.v1.png");
  const jobs = buildSegmentJobs(workspace);
  assert.deepEqual(jobs.map((job) => [job.requestedFrames, job.generationFrames]), [[120, 121], [96, 97]]);
  assert.equal(sha(projectFile), projectBefore);
  assert.equal(sha(storyboardFile), before);
});

test("keeps unresolved authored image guides and refuses to turn them into render jobs", () => {
  const base = workspaceFromWorkflow(sourceGraph, sourceText);
  const workspace = workspaceForProjectClip(base, "harrowing_of_hell", "H01-S01-C02");
  assert.ok(workspace.timeline.segments.length > 0);
  assert.ok(workspace.timeline.segments.every((segment) => segment.type === "image"));
  assert.ok(workspace.timeline.segments.every((segment) => segment.missingGuide === true));
  assert.ok(workspace.timeline.segments.every((segment) => !segment.projectMediaPath));
  assert.equal(buildSegmentJobs(workspace).length, 0);
});

test("exposes the exact pinned media references for a storyboard scene", () => {
  const result = sceneReferenceMedia("harrowing_of_hell", "H01-S01-C01");
  assert.equal(result.clipId, "H01-S01-C01");
  assert.equal(result.references.length, 14);
  assert.equal(result.references.filter((item) => item.required).length, 9);
  assert.equal(result.referencesReady, true);
  assert.deepEqual(result.invalidReferences, []);
  assert.deepEqual([...new Set(result.references.map((item) => item.frameId))].sort(), ["frame-h01-s01-c01-first", "frame-segment-h01-s01-c01-02"]);
  assert.ok(result.references.every((item) => item.file.startsWith("media/assets/")));
  assert.ok(result.references.some((item) => item.required));
  assert.ok(result.references.some((item) => item.assetId === "loc-inner-chamber-dark" && item.version === 1 && item.current === false && item.file === "media/assets/loc-chamber-dark.v1.png"));
  assert.ok(result.references.every((item) => fs.existsSync(resolveProjectMedia("harrowing_of_hell", item.file))));
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
