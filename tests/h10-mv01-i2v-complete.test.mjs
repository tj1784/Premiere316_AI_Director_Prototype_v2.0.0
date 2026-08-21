import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { workspaceForProjectClip } from "../director-webapp/premiere-projects.mjs";
import {
  PACKAGE_ID as H10_IMPORT_ID,
  importH10Ltx25I2vComplete,
  inspectH10Package
} from "../scripts/import-h10-ltx25-i2v-complete.mjs";
import {
  PACKAGE_ID as MV01_IMPORT_ID,
  importMV01Ltx25I2vComplete,
  inspectMV01Package
} from "../scripts/import-mv01-ltx25-i2v-complete.mjs";
import { buildSegmentJobs, ltxFrameCount, workspaceFromWorkflow } from "../director-webapp/workflow-compiler.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = path.join(ROOT, "projects", "harrowing_of_hell");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const MEDIA_DIRECTORY = path.join(PROJECT_ROOT, "media", "storyboard");
const REFERENCE_DIRECTORY = path.join(PROJECT_ROOT, "reference_assets");
const H10_ARCHIVE = path.join(process.env.USERPROFILE || "C:/Users/Blokey", "Downloads", "H10_LTX25_I2V_COMPLETE.zip");
const MV01_ARCHIVE = path.join(process.env.USERPROFILE || "C:/Users/Blokey", "Downloads", "MV01_LTX25_I2V_COMPLETE.zip");

const H10_ARCHIVE_SHA256 = "739a1228124b1654e3387acb21f595d08f6f334fefdf0091c5b95c5f6135da51";
const H10_ARCHIVE_BYTES = 114_976_804;
const MV01_ARCHIVE_SHA256 = "ce46d11738a1b123328bbc106bf1e14f12f4188d7e129d1bcdddfa52d4dc311b";
const MV01_ARCHIVE_BYTES = 72_705_113;

const H10_TIMING = Object.freeze({
  "H10-S31-C01": [109, 44_304, 432, [144, 144, 144]],
  "H10-S31-C02": [110, 44_736, 408, [144, 120, 144]],
  "H10-S32-C01": [111, 45_144, 432, [144, 144, 144]],
  "H10-S32-C02": [112, 45_576, 432, [144, 144, 144]],
  "H10-S32-C03": [113, 46_008, 408, [144, 120, 144]],
  "H10-S32-C04": [114, 46_416, 432, [144, 144, 144]],
  "H10-S33-C01": [115, 46_848, 432, [144, 144, 144]],
  "H10-S33-C02": [116, 47_280, 408, [144, 120, 144]],
  "H10-S33-C03": [117, 47_688, 432, [144, 144, 144]],
  "H10-S34-C01": [118, 48_120, 432, [144, 144, 144]],
  "H10-S34-C02": [119, 48_552, 432, [144, 144, 144]]
});

const H10_CLIPS = Object.keys(H10_TIMING);
const H10_CLIP_SET = new Set(H10_CLIPS);
const H10_S34_C02_PROMPT_HASHES = Object.freeze([
  "35d64c2fe83da66828411a242aa69ca9e88902faa263fcab3718490e3399926e",
  "d65c2a4971446b026d1d120cd9f0125ad5c3a3e9c9f67c441413e62137f28c4a",
  "5e145604df45074b8359abfdc79d1816503537e3cdafd4ee3ac4b68268e98ed5"
]);
const H10_INACTIVE_TITLE_CARD_FRAMES = new Set([
  "frame-h10-s34-c01-first",
  "frame-segment-h10-s34-c01-02",
  "frame-segment-h10-s34-c01-03",
  "frame-h10-s34-c02-first",
  "frame-segment-h10-s34-c02-02",
  "frame-segment-h10-s34-c02-03"
]);
const H10_S33_C02_PROP_PRECEDENCE = "SPECIFIC PROP PRECEDENCE: The supplied guide and the specific golden-keys lock permit the golden keys when visible. Treat the generic empty-hands illumination lock as a no-sword/no-weapon constraint; never erase the authored keys or turn them into a blade.";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function expectedSegmentIds(clipId) {
  return [1, 2, 3].map((number) => `segment-${clipId.toLowerCase()}-${String(number).padStart(2, "0")}`);
}

function expectedFrameId(clipId, number) {
  return number === 1
    ? `frame-${clipId.toLowerCase()}-first`
    : `frame-segment-${clipId.toLowerCase()}-${String(number).padStart(2, "0")}`;
}

function parseCsv(text) {
  const matrix = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let index = 0; index <= source.length; index += 1) {
    const character = index === source.length ? "\n" : source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") {
      row.push(cell);
      if (row.some((value) => value !== "")) matrix.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  assert.equal(quoted, false, "CSV contains an unterminated quote");
  const headers = matrix.shift();
  assert.ok(headers?.length && new Set(headers).size === headers.length);
  return matrix.map((cells) => {
    assert.equal(cells.length, headers.length);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

// Read the fixed archive in memory. This intentionally duplicates the safety boundary
// at the regression layer so a permissive importer cannot silently weaken it later.
function readSafeZip(file) {
  const archive = fs.readFileSync(file);
  const minimum = Math.max(0, archive.length - 0xffff - 22);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  assert.ok(eocd >= 0, "ZIP end-of-central-directory record is missing");
  const disk = archive.readUInt16LE(eocd + 4);
  const directoryDisk = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const directoryBytes = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  assert.equal(disk, 0);
  assert.equal(directoryDisk, 0);
  assert.equal(diskEntries, totalEntries);
  assert.notEqual(totalEntries, 0xffff, "ZIP64 is outside the fixed package contract");
  assert.ok(directoryOffset + directoryBytes <= eocd);

  const entries = new Map();
  let cursor = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedBytes = archive.readUInt32LE(cursor + 20);
    const uncompressedBytes = archive.readUInt32LE(cursor + 24);
    const nameBytes = archive.readUInt16LE(cursor + 28);
    const extraBytes = archive.readUInt16LE(cursor + 30);
    const commentBytes = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameBytes).toString("utf8");
    const directory = rawName.endsWith("/");
    const name = directory ? rawName.slice(0, -1) : rawName;
    assert.ok(name && !name.includes("\\") && !name.includes("\0") && !name.startsWith("/") && !/^[A-Za-z]:/.test(name));
    assert.ok(name.split("/").every((part) => part && part !== "." && part !== ".."));
    assert.equal(entries.has(name.toLowerCase()), false, `Duplicate/case-colliding ZIP entry: ${name}`);
    assert.equal(flags & 1, 0, `Encrypted ZIP entry: ${name}`);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    assert.ok(!unixType || unixType === 0x8000 || unixType === 0x4000, `Link/special ZIP entry: ${name}`);
    if (!directory) assert.ok(method === 0 || method === 8, `Unsupported ZIP method ${method}: ${name}`);

    let content = null;
    if (!directory) {
      assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
      const localNameBytes = archive.readUInt16LE(localOffset + 26);
      const localExtraBytes = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedBytes);
      assert.equal(compressed.length, compressedBytes);
      content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
      assert.equal(content.length, uncompressedBytes);
    }
    entries.set(name.toLowerCase(), { name, directory, content });
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  assert.equal(cursor, directoryOffset + directoryBytes);
  return { archive, entries };
}

function zipFile(zip, relative) {
  const entry = zip.entries.get(`mv01_ltx25_i2v_complete/${relative}`.toLowerCase());
  assert.ok(entry && !entry.directory, `MV01 package file is missing: ${relative}`);
  return entry.content;
}

function pngInfo(buffer) {
  assert.ok(buffer.length >= 26 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bitDepth: buffer[24], colorType: buffer[25] };
}

function collectReceiptFrames(value, result = []) {
  if (Array.isArray(value)) value.forEach((entry) => collectReceiptFrames(entry, result));
  else if (value && typeof value === "object") {
    if (value.frameId && value.segmentId && value.sha256 && (value.filename || value.file)) result.push(value);
    Object.values(value).forEach((entry) => collectReceiptFrames(entry, result));
  }
  return result;
}

const storyboard = readJson(STORYBOARD_FILE);
const h10Receipt = storyboard.imports?.[H10_IMPORT_ID] || null;
const H10_PRE_IMPORT = h10Receipt ? { skip: `${H10_IMPORT_ID} is already installed` } : { timeout: 120_000 };
const H10_POST_IMPORT = h10Receipt ? {} : { skip: `waiting for ${H10_IMPORT_ID}` };

test("MV01 fixed package is authentic but deliberately landscape and remains receipt-gated from the portrait project", () => {
  assert.equal(fs.statSync(MV01_ARCHIVE).size, MV01_ARCHIVE_BYTES);
  assert.equal(sha256File(MV01_ARCHIVE), MV01_ARCHIVE_SHA256);
  const zip = readSafeZip(MV01_ARCHIVE);
  assert.equal(zip.entries.size, 47);
  assert.deepEqual(new Set([...zip.entries.values()].map((entry) => entry.name.split("/")[0])), new Set(["MV01_LTX25_I2V_COMPLETE"]));

  const shaManifest = JSON.parse(zipFile(zip, "SHA256_MANIFEST.json").toString("utf8"));
  assert.equal(shaManifest.algorithm, "SHA-256");
  assert.equal(shaManifest.files.length, 43);
  const listed = new Map();
  for (const item of shaManifest.files) {
    assert.equal(listed.has(item.path.toLowerCase()), false, `Duplicate MV01 manifest path ${item.path}`);
    const content = zipFile(zip, item.path);
    assert.equal(content.length, item.bytes, `${item.path} bytes`);
    assert.equal(sha256Buffer(content), item.sha256, `${item.path} SHA-256`);
    listed.set(item.path.toLowerCase(), item);
  }
  const actualFiles = [...zip.entries.values()]
    .filter((entry) => !entry.directory && !entry.name.endsWith("/SHA256_MANIFEST.json"))
    .map((entry) => entry.name.slice("MV01_LTX25_I2V_COMPLETE/".length).toLowerCase())
    .sort();
  assert.deepEqual([...listed.keys()].sort(), actualFiles, "MV01 manifest must cover every non-self file exactly");

  const rows = parseCsv(zipFile(zip, "MV01_FIRST_FRAME_BINDINGS.csv").toString("utf8"));
  const packageManifest = JSON.parse(zipFile(zip, "MV01_MANIFEST.json").toString("utf8"));
  const packagePlans = JSON.parse(zipFile(zip, "MV01_VIDEO_PLANS_I2V.json").toString("utf8"));
  const promptMarkdown = zipFile(zip, "MV01_I2V_PROMPTS.md").toString("utf8").replace(/\r\n/g, "\n");
  const promptSections = [...promptMarkdown.matchAll(/^##\s+(MV01-S\d{2}-C\d{2})\b[^\n]*(segment-mv01-s\d{2}-c\d{2}-\d{2})[^\n]*$/gmi)];
  const canonicalClipIds = storyboard.chapters.MV01.sceneIds.flatMap((sceneId) => storyboard.scenes[sceneId].clipIds);
  assert.equal(rows.length, 34);
  assert.equal(packageManifest.clipCount, 34);
  assert.equal(packageManifest.timedSegmentCount, 34);
  assert.equal(packageManifest.segments.length, 34);
  assert.equal(packagePlans.length, 34);
  assert.equal(promptSections.length, 34);
  assert.deepEqual(rows.map((row) => row.clip), canonicalClipIds);
  assert.deepEqual(packagePlans.map((plan) => plan.clipId), canonicalClipIds);

  const frameHashes = new Set();
  const prompts = new Set();
  let referenceCount = 0;
  for (const row of rows) {
    const segmentId = `segment-${row.clip.toLowerCase()}-01`;
    const frameId = `frame-${row.clip.toLowerCase()}-first`;
    const firstFrame = `first_frames/${row.clip}_SEG01_FIRST.png`;
    assert.equal(row.chapter, "MV01");
    assert.equal(row.segment_id, segmentId);
    assert.equal(row.source_frame_id, frameId);
    assert.equal(row.source_video_plan_id, `video-${row.clip.toLowerCase()}`);
    assert.equal(row.first_frame, firstFrame);
    assert.equal(Number(row.start_frame), 0);
    const canonicalClip = storyboard.clips[row.clip];
    const canonicalPlan = storyboard.videoPlans[canonicalClip.videoPlanId];
    const canonicalSegment = storyboard.segments[segmentId];
    assert.equal(Number(row.length_frames), canonicalClip.durationFrames);
    assert.equal(Number(row.length_frames), canonicalSegment.lengthFrames);
    assert.equal(canonicalPlan.width, 576);
    assert.equal(canonicalPlan.height, 1024);
    assert.equal(canonicalClip.generationMode, "t2v_with_semantic_references");
    assert.equal(canonicalSegment.type, "text");

    const image = zipFile(zip, firstFrame);
    assert.deepEqual(pngInfo(image), { width: 1920, height: 804, bitDepth: 8, colorType: 2 });
    frameHashes.add(sha256Buffer(image));
    referenceCount += row.references ? row.references.split(";").filter(Boolean).length : 0;

    const packagePlan = packagePlans.find((plan) => plan.clipId === row.clip);
    assert.ok(packagePlan);
    assert.equal(packagePlan.width, 1920);
    assert.equal(packagePlan.height, 804);
    assert.deepEqual(packagePlan.sourceDelivery, { width: 576, height: 1024, aspect: "9:16 portrait" });
    assert.equal(packagePlan.deliveryAspect, "2.39:1");
    assert.match(packagePlan.packageAdaptation, /adapted to 1920x804 widescreen/i);
    assert.match(packagePlan.globalPrompt, /native portrait 9:16 at 576x1024/i);
    assert.equal(packagePlan.globalPrompt, packagePlan.localPrompts);
    assert.equal(packagePlan.timelineData.global_prompt, packagePlan.globalPrompt);
    assert.equal(packagePlan.timelineData.segments[0].prompt, packagePlan.globalPrompt);
    prompts.add(packagePlan.globalPrompt);
  }
  assert.equal(frameHashes.size, 34);
  assert.equal(prompts.size, 34);
  assert.equal(referenceCount, 25);
  assert.deepEqual(
    rows.filter((row) => !row.references).map((row) => row.clip),
    [
      "MV01-S03-C01",
      "MV01-S03-C06", "MV01-S03-C07", "MV01-S03-C08", "MV01-S03-C09",
      "MV01-S04-C01", "MV01-S04-C02", "MV01-S04-C03", "MV01-S04-C10"
    ],
    "Only the nine no-Jesus shots may omit the close-up identity provenance pin"
  );
  assert.ok(rows.filter((row) => row.references).every((row) => row.references === "char-jesus-close.v3.png"));
  const sourceReference = zipFile(zip, "source_references/char-jesus-close.v3.png");
  assert.equal(sha256Buffer(sourceReference), "0c44bbdf2ebced2b76011c1fa59a7edcff75ef184b42e079da796bd7d8d109be");
  const assetIndex = readJson(path.join(REFERENCE_DIRECTORY, "asset_index.json"));
  const indexedCloseup = assetIndex.assets.find((asset) => asset.source === "char-jesus-close.v3.png");
  assert.ok(indexedCloseup);
  assert.equal(indexedCloseup.canonical, "characters/jesus_closeup.png");
  assert.equal(indexedCloseup.sha256, sha256Buffer(sourceReference));
  assert.equal(indexedCloseup.bytes, sourceReference.length);
  assert.equal(sha256File(path.join(REFERENCE_DIRECTORY, indexedCloseup.canonical)), indexedCloseup.sha256);
  assert.equal(storyboard.imports?.[MV01_IMPORT_ID], undefined, "Landscape MV01 package must not acquire an import receipt without explicit approval");
  assert.equal(Object.keys(storyboard.frames).some((frameId) => frameId.startsWith("frame-mv01-")), false);

  const portraitOpening = pngInfo(fs.readFileSync(path.join(MEDIA_DIRECTORY, "MV-Into-Your-Hands-opening.v3-9x16-crown-passion.png")));
  assert.equal(portraitOpening.width < portraitOpening.height, true, "User-approved MV opening is portrait");
  const portraitCropWidth = 804 * (576 / 1024);
  assert.ok(Math.abs(portraitCropWidth - 452.25) < 0.001);
  assert.ok(portraitCropWidth / 1920 < 0.24, "A portrait crop discards more than three quarters of each landscape guide");
  assert.equal(Math.round(804 * (576 / 1920)), 241, "Fit/pad would reduce the guide to about 241 portrait-canvas pixels high");
});

test("MV01 importer reports the delivery conflict and fails closed without an explicit landscape override", () => {
  const inspected = inspectMV01Package({ archivePath: MV01_ARCHIVE });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.packageId, MV01_IMPORT_ID);
  assert.equal(inspected.archiveSha256, MV01_ARCHIVE_SHA256);
  assert.equal(inspected.archiveBytes, MV01_ARCHIVE_BYTES);
  assert.equal(inspected.clips, 34);
  assert.equal(inspected.frames, 34);
  assert.equal(inspected.uniquePrompts, 34);
  assert.equal(inspected.referenceBindings, 25);
  assert.equal(inspected.exactCoverFileCount, 43);
  assert.deepEqual(inspected.packageDelivery, { width: 1920, height: 804, aspect: "2.39:1" });
  assert.deepEqual(inspected.canonicalDelivery, { width: 576, height: 1024, aspect: "9:16 portrait" });
  assert.equal(inspected.deliveryConflict, true);
  assert.equal(inspected.landscapeOverrideRequired, true);
  assert.equal(inspected.hashes.fullShaManifestSha256, "526750e5dfad0d11c1ecabf12bc3b766e00c724c52e1b5ae31fefba688579cd3");
  assert.equal(inspected.hashes.packagedSourceReferenceSha256, "0c44bbdf2ebced2b76011c1fa59a7edcff75ef184b42e079da796bd7d8d109be");

  const watchedFiles = [
    STORYBOARD_FILE,
    path.join(PROJECT_ROOT, "project.json"),
    path.join(PROJECT_ROOT, "generation-jobs.json"),
    path.join(PROJECT_ROOT, "director-generation-jobs.json")
  ];
  const beforeHashes = Object.fromEntries(watchedFiles.map((file) => [file, sha256File(file)]));
  const mediaBefore = fs.readdirSync(MEDIA_DIRECTORY).sort();
  const backupDirectory = path.join(PROJECT_ROOT, "production", "backups");
  const backupsBefore = fs.readdirSync(backupDirectory).sort();
  assert.throws(
    () => importMV01Ltx25I2vComplete({ archivePath: MV01_ARCHIVE, dryRun: true, allowLandscape: false }),
    /MV01 package is 1920x804 landscape while the canonical plans are 576x1024 portrait\. Verification\/apply is blocked unless --allow-landscape \(allowLandscape: true\) is explicit\./
  );
  for (const [file, hash] of Object.entries(beforeHashes)) assert.equal(sha256File(file), hash, `${file} changed during blocked MV01 verification`);
  assert.deepEqual(fs.readdirSync(MEDIA_DIRECTORY).sort(), mediaBefore);
  assert.deepEqual(fs.readdirSync(backupDirectory).sort(), backupsBefore);
  assert.equal(readJson(STORYBOARD_FILE).imports?.[MV01_IMPORT_ID], undefined);
});

test("MV01 authorized projection consistently converts the effective runtime contract to 1920x804 landscape", { timeout: 120_000 }, (t) => {
  const before = readJson(STORYBOARD_FILE);
  const clipIds = before.chapters.MV01.sceneIds.flatMap((sceneId) => before.scenes[sceneId].clipIds);
  const watchedFiles = [
    STORYBOARD_FILE,
    path.join(PROJECT_ROOT, "project.json"),
    path.join(PROJECT_ROOT, "generation-jobs.json"),
    path.join(PROJECT_ROOT, "director-generation-jobs.json")
  ];
  const beforeHashes = Object.fromEntries(watchedFiles.map((file) => [file, sha256File(file)]));
  const mediaBefore = fs.readdirSync(MEDIA_DIRECTORY).sort();
  const backupDirectory = path.join(PROJECT_ROOT, "production", "backups");
  const backupsBefore = fs.readdirSync(backupDirectory).sort();
  let projected;
  let preflightError;
  for (let attempt = 1; attempt <= 3 && !projected; attempt += 1) {
    try {
      projected = importMV01Ltx25I2vComplete({
        archivePath: MV01_ARCHIVE,
        dryRun: true,
        allowLandscape: true,
        now: new Date("2026-08-18T05:00:00.000Z")
      });
    } catch (error) {
      preflightError = error;
      if (!/Live queue preflight failed closed/i.test(String(error?.message || error))) throw error;
    }
  }
  if (!projected && /(?:failed to connect|couldn'?t connect|connection refused|ECONNREFUSED)/i.test(String(preflightError?.message || preflightError))) {
    t.skip("MV01 pure projection requires the three local queue endpoints for its fail-closed preflight");
    return;
  }
  if (!projected) throw preflightError;
  assert.equal(projected.dryRun, true);
  assert.equal(projected.projected, true);
  assert.equal(projected.idempotent, false);
  assert.equal(projected.receipt.landscapeOverrideAccepted, true);
  assert.equal(projected.receipt.clipIds.length, 34);
  assert.equal(projected.receipt.frames.length, 34);
  assert.equal(Object.keys(projected.storyboard.frames).length, 392);
  assert.equal(Object.keys(projected.storyboard.referenceBindings).length, 2_853);
  assert.deepEqual(projected.storyboard.imports[MV01_IMPORT_ID], projected.receipt);

  const aspectInstruction = /(?:portrait|9:16|576\s*x\s*1024)/i;
  const landscapeInstruction = /(?:landscape|widescreen|2\.39:1)/i;
  const isAspectLock = (lock) => aspectInstruction.test(String(lock)) || /(?:landscape|widescreen|2\.39:1|1920\s*x\s*804)/i.test(String(lock));
  for (const clipId of clipIds) {
    const clipBefore = before.clips[clipId];
    const clipAfter = projected.storyboard.clips[clipId];
    const plan = projected.storyboard.videoPlans[clipAfter.videoPlanId];
    const segment = projected.storyboard.segments[plan.segmentIds[0]];
    const timelineSegment = plan.timelineData.segments[0];
    assert.equal(clipAfter.generationMode, "i2v_segmented_first_frames");
    assert.equal(plan.generationMode, "i2v_segmented_first_frames");
    assert.equal(plan.width, 1920);
    assert.equal(plan.height, 804);
    assert.match(clipAfter.shotSizeLens, landscapeInstruction, `${clipId} landscape shot/lens contract`);
    assert.doesNotMatch(clipAfter.shotSizeLens, aspectInstruction, `${clipId} stale portrait shot/lens contract`);
    assert.deepEqual(
      clipAfter.continuityLocks.filter((lock) => !isAspectLock(lock)),
      clipBefore.continuityLocks.filter((lock) => !isAspectLock(lock)),
      `${clipId} non-aspect continuity locks changed`
    );
    const aspectLocks = clipAfter.continuityLocks.filter(isAspectLock);
    assert.equal(aspectLocks.length, 1, `${clipId} must have one authoritative canvas continuity lock`);
    assert.match(aspectLocks[0], /1920\s*x\s*804/i);
    assert.match(aspectLocks[0], landscapeInstruction);
    const effectivePrompts = [
      plan.globalPrompt,
      plan.localPrompts,
      segment.prompt,
      plan.timelineData.global_prompt,
      timelineSegment.prompt
    ];
    assert.ok(effectivePrompts.every((prompt) => !aspectInstruction.test(prompt)), `${clipId} effective prompt retained a portrait-canvas instruction`);
    assert.ok(effectivePrompts.every((prompt) => /1920\s*x\s*804/i.test(prompt)), `${clipId} effective prompt omitted the authorized 1920x804 canvas`);
    assert.equal(segment.prompt, plan.localPrompts);
    assert.equal(timelineSegment.prompt, segment.prompt);
  }
  for (const [file, hash] of Object.entries(beforeHashes)) assert.equal(sha256File(file), hash, `${file} changed during MV01 projection`);
  assert.deepEqual(fs.readdirSync(MEDIA_DIRECTORY).sort(), mediaBefore);
  assert.deepEqual(fs.readdirSync(backupDirectory).sort(), backupsBefore);
  assert.equal(readJson(STORYBOARD_FILE).imports?.[MV01_IMPORT_ID], undefined);
});

test("H10 fixed package inspector authenticates 11 clips, 33 guides and 189 provenance pins", () => {
  assert.equal(fs.statSync(H10_ARCHIVE).size, H10_ARCHIVE_BYTES);
  assert.equal(sha256File(H10_ARCHIVE), H10_ARCHIVE_SHA256);
  const inspected = inspectH10Package({ archivePath: H10_ARCHIVE });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.clips, 11);
  assert.equal(inspected.frames, 33);
  assert.equal(inspected.referenceBindings, 189);
  assert.equal(inspected.packages.length, 1);
  assert.equal(inspected.packages[0].archiveSha256, H10_ARCHIVE_SHA256);
  assert.equal(inspected.packages[0].sourceReferences, 16);
});

test("H10 read-only projection is exact and writes no project artifact", H10_PRE_IMPORT, () => {
  const watchedFiles = [
    STORYBOARD_FILE,
    path.join(PROJECT_ROOT, "project.json"),
    path.join(PROJECT_ROOT, "generation-jobs.json"),
    path.join(PROJECT_ROOT, "director-generation-jobs.json")
  ];
  const beforeHashes = Object.fromEntries(watchedFiles.map((file) => [file, sha256File(file)]));
  const mediaBefore = fs.readdirSync(MEDIA_DIRECTORY).sort();
  const backupsBefore = fs.readdirSync(path.join(PROJECT_ROOT, "production", "backups")).sort();
  const result = importH10Ltx25I2vComplete({ archivePath: H10_ARCHIVE, dryRun: true, now: new Date("2026-08-18T04:30:00.000Z") });
  assert.equal(result.dryRun, true);
  assert.equal(result.projected, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.receipt.clipIds.length, 11);
  assert.equal(result.receipt.frames.length, 33);
  assert.equal(Object.keys(result.storyboard.frames).length, 358);
  assert.equal(Object.keys(result.storyboard.referenceBindings).length, 2_828);
  assert.deepEqual(result.storyboard.imports[H10_IMPORT_ID], result.receipt);
  for (const [file, hash] of Object.entries(beforeHashes)) assert.equal(sha256File(file), hash, `${file} changed during projection`);
  assert.deepEqual(fs.readdirSync(MEDIA_DIRECTORY).sort(), mediaBefore);
  assert.deepEqual(fs.readdirSync(path.join(PROJECT_ROOT, "production", "backups")).sort(), backupsBefore);
});

test("H10 imported state preserves canonical timing and binds all 33 exact segment guides", H10_POST_IMPORT, () => {
  assert.ok(h10Receipt);
  assert.equal(h10Receipt.archiveHashes.H10, H10_ARCHIVE_SHA256);
  const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const baseWorkspace = workspaceFromWorkflow(JSON.parse(sourceText), sourceText);
  const receiptFrames = new Map();
  for (const record of collectReceiptFrames(h10Receipt)) {
    if (!H10_CLIP_SET.has(record.clipId)) continue;
    assert.equal(receiptFrames.has(record.frameId), false, `Duplicate H10 receipt frame ${record.frameId}`);
    receiptFrames.set(record.frameId, record);
  }
  assert.equal(receiptFrames.size, 33);

  let jobs = 0;
  let provenanceBindings = 0;
  let inactiveProvenancePins = 0;
  for (const clipId of H10_CLIPS) {
    const [order, timelineStartFrame, durationFrames, lengths] = H10_TIMING[clipId];
    const clip = storyboard.clips[clipId];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    const segmentIds = expectedSegmentIds(clipId);
    assert.equal(clip.order, order);
    assert.equal(clip.timelineStartFrame, timelineStartFrame);
    assert.equal(clip.durationFrames, durationFrames);
    assert.equal(clip.generationMode, "i2v_segmented_first_frames");
    assert.equal(clip.referenceMode, "segment_first_frames");
    assert.equal(plan.generationMode, "i2v_segmented_first_frames");
    assert.equal(plan.referenceMode, "segment_first_frames");
    assert.equal(plan.workflowProfileId, "ltx-2.5-i2v-segmented-first-frame");
    assert.equal(plan.status, "needs_render");
    assert.deepEqual(plan.segmentIds, segmentIds);
    assert.equal(plan.timelineData.normalDurationFrames, durationFrames);
    assert.equal(plan.timelineData.global_prompt, plan.globalPrompt);
    assert.match(plan.globalPrompt, /selected segment/i);
    assert.doesNotMatch(plan.globalPrompt, /Generate directly from text/i);
    if (clipId === "H10-S33-C02") {
      assert.ok(plan.globalPrompt.includes(H10_S33_C02_PROP_PRECEDENCE));
    }

    let start = 0;
    for (let index = 0; index < segmentIds.length; index += 1) {
      const number = index + 1;
      const segmentId = segmentIds[index];
      const frameId = expectedFrameId(clipId, number);
      const segment = storyboard.segments[segmentId];
      const frame = storyboard.frames[frameId];
      const receiptFrame = receiptFrames.get(frameId);
      const timeline = plan.timelineData.segments.find((entry) => entry.id === segmentId);
      assert.ok(segment && frame && receiptFrame && timeline);
      assert.equal(segment.startFrame, start);
      assert.equal(segment.lengthFrames, lengths[index]);
      assert.equal(segment.type, "image");
      assert.equal(segment.frameId, frameId);
      assert.equal(segment.prompt, frame.prompt);
      assert.equal(segment.prompt, timeline.prompt);
      assert.equal(receiptFrame.segmentId, segmentId);
      assert.equal(receiptFrame.sourceEntry, `frames/${clipId}_seg${String(number).padStart(2, "0")}.png`);
      assert.equal(receiptFrame.width, 1920);
      assert.equal(receiptFrame.height, 804);
      assert.match(receiptFrame.sha256, /^[a-f0-9]{64}$/);
      assert.equal(sha256File(path.join(MEDIA_DIRECTORY, receiptFrame.filename)), receiptFrame.sha256);
      assert.equal(frame.generatedFile, receiptFrame.filename);
      assert.equal(frame.importProvenance.packageId, H10_IMPORT_ID);
      for (const reference of receiptFrame.sourceReferences || []) {
        assert.equal(reference.sourceRelation, "loaded_for_generated_frame");
        assert.equal(reference.storyboardDeclared, false);
        assert.equal(reference.loadedForGeneratedFrame, true);
        if (reference.pinnedActiveAtImport === false) {
          assert.equal(reference.sourceAssetFile, "title-card.v1.svg");
          assert.equal(reference.assetVersion, 1);
          assert.equal(reference.assetVersionId, "graphic-jesus-the-harrowing-of-hell-title-card:v1");
          assert.equal(H10_INACTIVE_TITLE_CARD_FRAMES.has(frameId), true, `${frameId} must be one of the six inactive title-card provenance frames`);
          inactiveProvenancePins += 1;
        }
        provenanceBindings += 1;
      }
      start += lengths[index];
    }

    const workspace = workspaceForProjectClip(baseWorkspace, "harrowing_of_hell", clipId);
    assert.equal(workspace.settings.queueMode, "segments");
    assert.equal(workspace.timeline.segments.length, 3);
    assert.ok(workspace.timeline.segments.every((segment) => segment.type === "image" && segment.missingGuide === false));
    const clipJobs = buildSegmentJobs(workspace);
    assert.equal(clipJobs.length, 3);
    assert.ok(clipJobs.every((job) => job.generationFrames === ltxFrameCount(job.requestedFrames)));
    jobs += clipJobs.length;
  }
  assert.equal(jobs, 33);
  assert.equal(provenanceBindings, 189);
  assert.equal(inactiveProvenancePins, 6, "Both title-card clips must retain three exact inactive-v1 provenance pins");
  assert.equal(H10_INACTIVE_TITLE_CARD_FRAMES.size, inactiveProvenancePins);
  assert.equal(Object.keys(storyboard.frames).length, 358);
  assert.equal(Object.keys(storyboard.referenceBindings).length, 2_828);
  assert.equal(Object.values(storyboard.referenceBindings).filter((binding) => binding.targetKind === "video_plan").length, 678);
  assert.equal(Object.values(storyboard.referenceBindings).filter((binding) => binding.targetKind === "frame").length, 2_150);
  assert.equal(Object.values(storyboard.clips).filter((clip) => clip.generationMode === "i2v_segmented_first_frames").length, 119);
  assert.equal(Object.values(storyboard.clips).filter((clip) => clip.generationMode === "t2v_with_semantic_references").length, 34);
});

test("H10-S34-C02 retains the corrected clean-black ending and never imports the package title-card action", H10_POST_IMPORT, () => {
  const clip = storyboard.clips["H10-S34-C02"];
  const plan = storyboard.videoPlans[clip.videoPlanId];
  assert.match(clip.beat, /uniform clean black/i);
  assert.match(clip.transition, /uniform clean black/i);
  assert.doesNotMatch(`${clip.beat}\n${clip.transition}\n${plan.localPrompts}`, /title card|show the title|display title/i);
  assert.deepEqual(plan.segmentIds.map((segmentId) => sha256Buffer(Buffer.from(storyboard.segments[segmentId].prompt, "utf8"))), H10_S34_C02_PROMPT_HASHES);
  assert.equal(sha256Buffer(Buffer.from(plan.localPrompts, "utf8")), "b509af1c326f27f77447b3fd5a6c6493ff33214f2f5837ff2bd6ff34642043f4");
  assert.deepEqual(clip.continuityLocks, [
    "The stone remains sealed and motionless throughout.",
    "Only the sleeping guards, sealed tomb, dust, and authored light change appear on camera.",
    "The final picture is uniform clean black, free of visible marks."
  ]);
});
