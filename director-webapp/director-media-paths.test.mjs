import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  chapterFolderForClipId,
  clipMediaCandidates,
  directorOutputDiskCandidates,
  directorOutputDiskPath,
  directorOutputRelativePath,
  discoverDirectorTakeFiles,
  preferredClipMediaPath,
  projectMediaDiskPath
} from "./director-media-paths.mjs";

test("chapter outputs route under their chapter while legacy flat paths remain candidates", () => {
  assert.equal(chapterFolderForClipId("H01-S01-C01"), "H01");
  assert.equal(chapterFolderForClipId("h03-s06-c03"), "H03");
  assert.equal(chapterFolderForClipId("MV01-S01-C01"), "MV01");
  assert.equal(chapterFolderForClipId("sequence-01"), null);

  assert.deepEqual(clipMediaCandidates("take.mp4", "H02-S03-C01"), [
    "media/clips/H02/take.mp4",
    "media/clips/take.mp4"
  ]);
  assert.deepEqual(clipMediaCandidates("H01/take.mp4", "H01-S01-C01"), ["media/clips/H01/take.mp4"]);
  assert.deepEqual(clipMediaCandidates("media/clips/H03/take.mp4", "H03-S06-C01"), ["media/clips/H03/take.mp4"]);
  assert.deepEqual(clipMediaCandidates("media/clips/take.mp4", "H03-S06-C01"), [
    "media/clips/take.mp4",
    "media/clips/H03/take.mp4"
  ]);
  assert.equal(directorOutputRelativePath("H03-S06-C01", "nested/ignored/take.mp4"), "media/clips/H03/take.mp4");
  assert.equal(directorOutputRelativePath("sequence-01", "take.mp4"), "media/clips/take.mp4");
  assert.throws(() => directorOutputRelativePath("H01-S01-C01", "../take.mp4"), /unsafe/);
});

test("preferred paths discover nested files first and retain a legacy flat fallback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-chapter-media-"));
  try {
    const flat = projectMediaDiskPath(root, "media/clips/take.mp4");
    const nested = directorOutputDiskPath(root, "H01-S01-C01", "take.mp4");
    fs.mkdirSync(path.dirname(flat), { recursive: true });
    fs.writeFileSync(flat, "legacy");
    assert.equal(preferredClipMediaPath("take.mp4", "H01-S01-C01", root), "media/clips/take.mp4");

    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, "chapter");
    assert.equal(preferredClipMediaPath("take.mp4", "H01-S01-C01", root), "media/clips/H01/take.mp4");
    assert.deepEqual(directorOutputDiskCandidates(root, "H01-S01-C01", "take.mp4"), [nested, flat]);
    assert.throws(() => projectMediaDiskPath(root, "media/clips/../../project.json"), /under media/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disk take discovery scopes nested files to the requested chapter and still sees flat legacy takes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-take-discovery-"));
  const clipId = "H01-S01-C01";
  const segmentId = "segment-h01-s01-c01-01";
  const name1 = `${clipId}_${segmentId}_director_v01.mp4`;
  const name2 = `${clipId}_${segmentId}_director_v02.mp4`;
  try {
    fs.mkdirSync(path.join(root, "H01"), { recursive: true });
    fs.mkdirSync(path.join(root, "H02"), { recursive: true });
    fs.writeFileSync(path.join(root, "H01", name2), "nested");
    fs.writeFileSync(path.join(root, name1), "legacy");
    fs.writeFileSync(path.join(root, "H02", name1), "wrong chapter");
    fs.writeFileSync(path.join(root, "H01", "unrelated.mp4"), "other");

    assert.deepEqual(discoverDirectorTakeFiles(root, clipId, segmentId).map((item) => item.file).sort(), [
      `media/clips/H01/${name2}`,
      `media/clips/${name1}`
    ].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
