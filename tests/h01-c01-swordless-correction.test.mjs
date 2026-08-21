import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = path.join(ROOT, "projects", "harrowing_of_hell");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const MEDIA_DIRECTORY = path.join(PROJECT_ROOT, "media", "storyboard");
const CORRECTION_SCRIPT = path.join(ROOT, "scripts", "update-h01-c01-swordless-descent.mjs");
const IMPORT_SCRIPT = path.join(ROOT, "scripts", "import-h01-i2v-reference-corrected-v2.mjs");
const CORRECTION_ID = "h01_s01_c01_swordless_descent_v1";
const PACKAGE_ID = "h01_ltx25_i2v_reference_corrected_v2";
const SWORD_ASSET_ID = "artifact-sword-of-light-christs-weapon-close-up";

const EXPECTED = [
  {
    segmentId: "segment-h01-s01-c01-01",
    frameId: "frame-h01-s01-c01-first",
    version: 3,
    filename: "H01-S01-C01_first.v3.swordless.png",
    width: 1935,
    height: 813,
    bytes: 1853310,
    sha256: "635d277bdde525b0ca5896d81c72e1dc9b01850db5caf91178433e64252e1489"
  },
  {
    segmentId: "segment-h01-s01-c01-02",
    frameId: "frame-segment-h01-s01-c01-02",
    version: 4,
    filename: "H01-S01-C01_seg02.v4.swordless.png",
    width: 1935,
    height: 813,
    bytes: 1805045,
    sha256: "a9211e625ba9441f51e08ea812379daabf85a9886e7983c7c91dba79aaaf58bd"
  },
  {
    segmentId: "segment-h01-s01-c01-03",
    frameId: "frame-segment-h01-s01-c01-03",
    version: 2,
    filename: "H01-S01-C01_seg03.v2.swordless.png",
    width: 1933,
    height: 813,
    bytes: 1642108,
    sha256: "961084130d203e497962352e0579baba5be6000a9e8e59974932d27240caf769"
  },
  {
    segmentId: "segment-h01-s01-c01-04",
    frameId: "frame-segment-h01-s01-c01-04",
    version: 2,
    filename: "H01-S01-C01_seg04.v2.swordless.png",
    width: 1931,
    height: 814,
    bytes: 1571079,
    sha256: "3aa142eea170f232ce002b87f4f0a0d4df3dc7acc57de9cea95531276b887646"
  }
];

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadStoryboard() {
  return JSON.parse(fs.readFileSync(STORYBOARD_FILE, "utf8"));
}

function pngDimensions(file) {
  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(file, "r");
  try {
    assert.equal(fs.readSync(descriptor, header, 0, header.length, 0), header.length);
  } finally {
    fs.closeSync(descriptor);
  }
  assert.deepEqual([...header.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(header.toString("ascii", 12, 16), "IHDR");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function assertContained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative), `${child} escaped ${parent}`);
}

function fileSnapshot(file) {
  const stat = fs.statSync(file);
  return { bytes: stat.size, modifiedMs: stat.mtimeMs, sha256: sha256File(file) };
}

test("H01 C01 swordless verify-only refuses to mutate the 2m24s 18-segment master", () => {
  const beforeStoryboard = fileSnapshot(STORYBOARD_FILE);
  const beforeMedia = Object.fromEntries(EXPECTED.map((item) => [item.filename, fileSnapshot(path.join(MEDIA_DIRECTORY, item.filename))]));

  const result = spawnSync(process.execPath, [CORRECTION_SCRIPT, "--verify-only"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /C01 no longer contains four authored segments/);

  assert.deepEqual(fileSnapshot(STORYBOARD_FILE), beforeStoryboard);
  for (const item of EXPECTED) {
    assert.deepEqual(fileSnapshot(path.join(MEDIA_DIRECTORY, item.filename)), beforeMedia[item.filename]);
  }
});

test("H01 C01 correction receipt pins active files, prompts, references, and immutable source history", () => {
  const storyboard = loadStoryboard();
  const receipt = storyboard.imports?.[CORRECTION_ID];
  const packageReceipt = storyboard.imports?.[PACKAGE_ID];
  assert.ok(receipt, `Missing correction receipt ${CORRECTION_ID}`);
  assert.ok(packageReceipt, `Missing package receipt ${PACKAGE_ID}`);
  assert.equal(receipt.editId, CORRECTION_ID);
  assert.equal(receipt.clipId, "H01-S01-C01");
  assert.deepEqual(receipt.frameIds, EXPECTED.map((item) => item.frameId));
  assert.equal(receipt.frames.length, EXPECTED.length);

  const backup = path.resolve(PROJECT_ROOT, receipt.backup);
  assertContained(PROJECT_ROOT, backup);
  assert.equal(sha256File(backup), receipt.sourceStoryboardSha256);

  const clip = storyboard.clips[receipt.clipId];
  const plan = storyboard.videoPlans[clip.videoPlanId];
  assert.equal(clip.generationMode, "i2v_segmented_first_frames");
  assert.equal(clip.referenceMode, "segment_first_frames");
  assert.equal(plan.generationMode, "i2v_segmented_first_frames");
  assert.equal(plan.referenceMode, "segment_first_frames");
  assert.equal(plan.workflowProfileId, "ltx-2.5-i2v-segmented-first-frame");
  assert.ok(EXPECTED.every((item) => plan.segmentIds.includes(item.segmentId)));
  assert.equal(plan.segmentIds.length, 18);
  assert.equal(plan.firstFramePackage?.packageId, "h01_s01_c01_2m24s_ltx25_i2v_master");
  assert.equal(plan.globalPrompt, plan.timelineData.global_prompt);
  assert.equal(plan.localPrompts, plan.segmentIds.map((id) => storyboard.segments[id].prompt).join(" | "));
  assert.match(plan.globalPrompt, /Empty hands throughout/i);
  assert.match(plan.globalPrompt, /No crown of thorns, halo disc, levitation, angels, sword, weapon, or duplicate Jesus/i);
  assert.doesNotMatch(`${plan.globalPrompt}\n${plan.localPrompts}`, /carries exactly one luminous golden sword|single golden sword|single right-hand sword|body and sword shape/i);

  const timelineById = new Map(plan.timelineData.segments.map((segment) => [segment.id, segment]));
  const receiptByFrame = new Map(receipt.frames.map((item) => [item.frameId, item]));
  const packageByFrame = new Map(packageReceipt.frames.map((item) => [item.frameId, item]));

  for (const expected of EXPECTED) {
    const correction = receiptByFrame.get(expected.frameId);
    assert.ok(correction, `Missing correction frame ${expected.frameId}`);
    for (const key of ["segmentId", "frameId", "version", "filename", "width", "height", "bytes", "sha256"]) {
      assert.equal(correction[key], expected[key], `${expected.frameId} receipt ${key}`);
    }
    assert.equal(correction.activeReferenceCount, 5);

    const mediaFile = path.resolve(MEDIA_DIRECTORY, correction.filename);
    assertContained(MEDIA_DIRECTORY, mediaFile);
    assert.equal(path.basename(mediaFile), correction.filename);
    assert.equal(fs.statSync(mediaFile).size, correction.bytes);
    assert.equal(sha256File(mediaFile), correction.sha256);
    assert.deepEqual(pngDimensions(mediaFile), { width: correction.width, height: correction.height });

    const segment = storyboard.segments[correction.segmentId];
    const frame = storyboard.frames[correction.frameId];
    const timeline = timelineById.get(correction.segmentId);
    assert.equal(segment.frameId, frame.id);
    assert.equal(segment.type, "image");
    assert.ok(segment.prompt);
    assert.equal(frame.prompt, segment.prompt);
    assert.equal(timeline.prompt, segment.prompt);
    assert.match(String(timeline.fileName || ""), /2m24s-i2v-master\.png$/);
    assert.equal(timeline.imageFile, frame.expectedInputPath);

    const swordlessVersion = frame.generatedVersions.find((item) => Number(item.v) === correction.version && item.file === correction.filename);
    assert.ok(swordlessVersion, `Missing immutable swordless version for ${frame.id}`);
    assert.notEqual(frame.activeGeneratedVersion, correction.version);
    assert.match(String(frame.generatedFile || ""), /2m24s-i2v-master\.png$/);
    assert.equal(frame.generatedInputPath, `media/storyboard/${frame.generatedFile}`);
    assert.equal(frame.status, "generated");

    const version = frame.generatedVersions.find((item) => Number(item.v) === correction.version && item.file === correction.filename);
    assert.ok(version, `Missing active generated version for ${frame.id}`);
    assert.equal(version.source, "codex_builtin_image_edit_sword_removal");
    assert.equal(version.provenanceType, "built_in_image_editor_revision");
    assert.equal(version.prompt, correction.prompt);
    assert.equal(version.promptHash, correction.promptHash);
    assert.equal(version.width, correction.width);
    assert.equal(version.height, correction.height);
    assert.deepEqual(version.fileHashes, [{ file: correction.filename, sha256: correction.sha256, bytes: correction.bytes, extension: ".png" }]);

    const original = packageByFrame.get(frame.id);
    assert.ok(original, `Missing immutable package receipt for ${frame.id}`);
    const originalVersion = frame.generatedVersions.find((item) => Number(item.v) === Number(original.version) && item.file === original.filename);
    assert.ok(originalVersion, `Missing immutable package version for ${frame.id}`);
    assert.equal(version.sourceFrameFile, original.filename);
    const originalDisk = path.join(MEDIA_DIRECTORY, original.filename);
    assert.equal(fs.statSync(originalDisk).size, original.bytes);
    assert.equal(sha256File(originalDisk), original.sha256);

    assert.equal(frame.references.length, correction.activeReferenceCount);
    assert.deepEqual(frame.references.map((reference) => reference.order), [1, 2, 3, 4, 5]);
    assert.ok(frame.references.every((reference) => reference.assetId !== SWORD_ASSET_ID));
    assert.ok((version.sourceReferenceAssets || []).every((reference) => reference.assetId !== SWORD_ASSET_ID));
    for (const reference of frame.references) {
      assert.equal(reference.assetVersionId, `${reference.assetId}:v${reference.assetVersion}`);
      assert.deepEqual(storyboard.referenceBindings[reference.id], reference);
    }
    assert.ok(!Object.values(storyboard.referenceBindings).some((binding) => binding.targetKind === "frame" && binding.targetId === frame.id && binding.assetId === SWORD_ASSET_ID));
    for (const forbidden of ["sword", "weapon", "luminous blade"]) {
      assert.ok(frame.negativePrompt.toLowerCase().includes(forbidden), `${frame.id} negative prompt omitted ${forbidden}`);
    }
  }
});

test("H01 package importer retains an explicit later-correction compatibility boundary", () => {
  const source = fs.readFileSync(IMPORT_SCRIPT, "utf8");
  assert.match(source, /h01_s01_c01_swordless_descent_v1/);
  assert.match(source, /Original package version history is missing/);
  assert.match(source, /H01-S01-C01 swordless correction is no longer active/);
  assert.match(source, /H01-S01-C01 swordless correction contains a stale positive sword direction/);
});
