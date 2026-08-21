import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createProject,
  deleteProject,
  loadProject,
  mediaDir,
  saveProject
} from "../server/projects.js";
import {
  buildEditMasterJob,
  loadEditDocument,
  saveEditSequence
} from "../server/sequence-editor.js";
import { probeMedia } from "../server/ffmpeg.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function ffmpegAvailable() {
  const result = spawnSync(FFMPEG, ["-version"], { windowsHide: true, timeout: 10_000 });
  return !result.error && result.status === 0;
}

function makeClip(file, color, frequency) {
  const result = spawnSync(FFMPEG, [
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=96x64:r=24:d=0.5`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=0.5`,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    file
  ], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (result.error || result.status !== 0) {
    assert.fail(`Could not create editor export fixture: ${(result.stderr || result.error?.message || "").slice(-2000)}`);
  }
}

test("full editor export uses the queued revision snapshot and appends a verified master", async (t) => {
  if (!ffmpegAvailable()) return t.skip("ffmpeg is unavailable");
  const project = createProject(`Sequence Export Test ${randomUUID()}`);
  t.after(() => {
    if (/^sequence_export_test_/.test(project.slug)) deleteProject(project.slug);
  });
  assert.match(project.slug, /^sequence_export_test_/);

  project.settings = { ...project.settings, fps: 24, width: 96, height: 64 };
  saveProject(project);
  const clipsDir = mediaDir(project, "clips");
  const chapterDir = path.join(clipsDir, "H01");
  fs.mkdirSync(chapterDir, { recursive: true });
  const firstFile = path.join(chapterDir, "first.mp4");
  const secondFile = path.join(clipsDir, "second.mp4");
  makeClip(firstFile, "red", 440);
  makeClip(secondFile, "blue", 660);
  const firstStat = fs.statSync(firstFile);
  const secondStat = fs.statSync(secondFile);

  const initial = loadEditDocument(project.slug);
  const firstClip = {
    id: "v-first",
    mediaId: "first",
    name: "First",
    sourceFile: "media/clips/H01/first.mp4",
    sourceBytes: firstStat.size,
    sourceMtimeMs: Math.round(firstStat.mtimeMs),
    sourceDurationSec: 0.5,
    sourceInSec: 0,
    sourceOutSec: 0.5,
    durationSec: 0.5
  };
  const revisionOne = saveEditSequence(project.slug, {
    ...initial.sequence,
    width: 96,
    height: 64,
    videoClips: [firstClip]
  }, 0);
  const queuedSnapshot = structuredClone(revisionOne.sequence);

  saveEditSequence(project.slug, {
    ...revisionOne.sequence,
    videoClips: [firstClip, {
      ...firstClip,
      id: "v-second",
      mediaId: "second",
      name: "Second",
      sourceFile: "media/clips/second.mp4",
      sourceBytes: secondStat.size,
      sourceMtimeMs: Math.round(secondStat.mtimeMs)
    }]
  }, 1);

  const controller = new AbortController();
  const job = {
    projectSlug: project.slug,
    refs: { revision: 1 },
    sequenceSnapshot: queuedSnapshot,
    signal: controller.signal,
    progress: 0,
    stage: "Queued"
  };
  await buildEditMasterJob(job);

  const completedDocument = loadEditDocument(project.slug);
  const completedProject = loadProject(project.slug);
  assert.equal(completedDocument.revision, 2, "newer edit content must remain current");
  assert.equal(completedDocument.sequence.videoClips.length, 2);
  assert.equal(completedDocument.exports.length, 1);
  assert.equal(completedDocument.exports[0].sequenceRevision, 1);
  assert.equal(completedProject.masters.length, 1);
  assert.equal(job.result.sequenceRevision, 1);
  const master = path.join(mediaDir(completedProject, "masters"), job.result.file);
  assert.ok(fs.existsSync(master));
  const info = await probeMedia(master);
  assert.ok(info.video);
  assert.ok(info.audio);
  assert.ok(info.durationSec > 0.4 && info.durationSec < 0.7, `queued one-clip snapshot should export about 0.5s, got ${info.durationSec}`);

  const badHashDocument = saveEditSequence(project.slug, {
    ...completedDocument.sequence,
    videoClips: [{ ...completedDocument.sequence.videoClips[0], sourceSha256: "0".repeat(64) }]
  }, 2);
  await assert.rejects(
    () => buildEditMasterJob({
      projectSlug: project.slug,
      refs: { revision: 3 },
      sequenceSnapshot: badHashDocument.sequence,
      signal: new AbortController().signal,
      progress: 0,
      stage: "Queued"
    }),
    /Source fingerprint changed/
  );

  const badRangeDocument = saveEditSequence(project.slug, {
    ...badHashDocument.sequence,
    videoClips: [{
      ...badHashDocument.sequence.videoClips[0],
      sourceSha256: null,
      sourceDurationSec: 2,
      sourceOutSec: 2,
      durationSec: 2
    }]
  }, 3);
  await assert.rejects(
    () => buildEditMasterJob({
      projectSlug: project.slug,
      refs: { revision: 4 },
      sequenceSnapshot: badRangeDocument.sequence,
      signal: new AbortController().signal,
      progress: 0,
      stage: "Queued"
    }),
    /edit requests media through 2\.000s/
  );
  assert.equal(loadProject(project.slug).masters.length, 1, "failed deterministic preflight must not publish another master");
});
