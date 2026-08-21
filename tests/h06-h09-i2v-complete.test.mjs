import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { workspaceForProjectClip } from "../director-webapp/premiere-projects.mjs";
import { importH06H09Ltx25I2vComplete } from "../scripts/import-h06-h09-ltx25-i2v-complete.mjs";
import {
  buildSegmentJobs,
  ltxFrameCount,
  workspaceFromWorkflow
} from "../director-webapp/workflow-compiler.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = path.join(ROOT, "projects", "harrowing_of_hell");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const MEDIA_DIRECTORY = path.join(PROJECT_ROOT, "media", "storyboard");
const IMPORT_ID = "h06_h09_ltx25_i2v_complete_v1";
const H10_IMPORT_ID = "h10_ltx25_i2v_complete_v1";
const WORKFLOW_PROFILE = "ltx-2.5-i2v-segmented-first-frame";
const GENERATION_MODE = "i2v_segmented_first_frames";
const REFERENCE_MODE = "segment_first_frames";

const PACKAGE_ARCHIVES = Object.freeze({
  H06: Object.freeze({
    sha256: "40dbdcb5d49d118bdaa10bcceb94eed15af6a332e0ca6241333ffcb50e2e6c5a",
    bytes: 90_741_200,
    frameCount: 36,
    referenceCount: 213
  }),
  H07: Object.freeze({
    sha256: "1c0ef349ec435b76dee32c4ba70a0e0825bedc3ee19dadde3daf3d49f1e456ed",
    bytes: 108_894_489,
    frameCount: 45,
    referenceCount: 267
  }),
  H08: Object.freeze({
    sha256: "f4e21661a0bafcf01720363681d9415827204cfcf6c49373c854ce8946005e3b",
    bytes: 78_524_858,
    frameCount: 36,
    referenceCount: 189
  }),
  H09: Object.freeze({
    sha256: "00dcc939f70612154f58aebd5e9e0683a675b056f09750ca3ee719c56b65ef99",
    bytes: 38_950_695,
    frameCount: 18,
    referenceCount: 99
  })
});

const TARGET_TIMING = Object.freeze({
  "H06-S19-C01": [64, 25_584, 432, [144, 144, 144]],
  "H06-S19-C02": [65, 26_016, 408, [144, 120, 144]],
  "H06-S19-C03": [66, 26_424, 432, [144, 144, 144]],
  "H06-S20-C01": [67, 26_856, 408, [144, 120, 144]],
  "H06-S20-C02": [68, 27_264, 432, [144, 144, 144]],
  "H06-S20-C03": [69, 27_696, 408, [144, 120, 144]],
  "H06-S21-C01": [70, 28_104, 432, [144, 144, 144]],
  "H06-S21-C02": [71, 28_536, 408, [144, 120, 144]],
  "H06-S21-C03": [72, 28_944, 432, [144, 144, 144]],
  "H06-S21-C04": [73, 29_376, 408, [144, 120, 144]],
  "H06-S21-C05": [74, 29_784, 432, [144, 144, 144]],
  "H06-S22-C01": [75, 30_216, 408, [144, 120, 144]],
  "H07-S23-C01": [76, 30_624, 408, [144, 120, 144]],
  "H07-S23-C02": [77, 31_032, 408, [144, 120, 144]],
  "H07-S23-C03": [78, 31_440, 408, [144, 120, 144]],
  "H07-S24-C01": [79, 31_848, 408, [144, 120, 144]],
  "H07-S24-C02": [80, 32_256, 408, [144, 120, 144]],
  "H07-S24-C03": [81, 32_664, 408, [144, 120, 144]],
  "H07-S24-C04": [82, 33_072, 408, [144, 120, 144]],
  "H07-S24-C05": [83, 33_480, 408, [144, 120, 144]],
  "H07-S24-C06": [84, 33_888, 408, [144, 120, 144]],
  "H07-S24-C07": [85, 34_296, 408, [144, 120, 144]],
  "H07-S25-C01": [86, 34_704, 408, [144, 120, 144]],
  "H07-S25-C02": [87, 35_112, 408, [144, 120, 144]],
  "H07-S25-C03": [88, 35_520, 408, [144, 120, 144]],
  "H07-S25-C04": [89, 35_928, 408, [144, 120, 144]],
  "H07-S25-C05": [90, 36_336, 408, [144, 120, 144]],
  "H08-S26-C01": [91, 36_744, 432, [144, 144, 144]],
  "H08-S26-C02": [92, 37_176, 408, [144, 120, 144]],
  "H08-S26-C03": [93, 37_584, 432, [144, 144, 144]],
  "H08-S26-C04": [94, 38_016, 408, [144, 120, 144]],
  "H08-S27-C01": [95, 38_424, 432, [144, 144, 144]],
  "H08-S27-C02": [96, 38_856, 408, [144, 120, 144]],
  "H08-S27-C03": [97, 39_264, 432, [144, 144, 144]],
  "H08-S27-C04": [98, 39_696, 408, [144, 120, 144]],
  "H08-S27-C05": [99, 40_104, 432, [144, 144, 144]],
  "H08-S28-C01": [100, 40_536, 408, [144, 120, 144]],
  "H08-S28-C02": [101, 40_944, 432, [144, 144, 144]],
  "H08-S28-C03": [102, 41_376, 408, [144, 120, 144]],
  "H09-S29-C01": [103, 41_784, 432, [144, 144, 144]],
  "H09-S29-C02": [104, 42_216, 408, [144, 120, 144]],
  "H09-S29-C03": [105, 42_624, 432, [144, 144, 144]],
  "H09-S30-C01": [106, 43_056, 408, [144, 120, 144]],
  "H09-S30-C02": [107, 43_464, 432, [144, 144, 144]],
  "H09-S30-C03": [108, 43_896, 408, [144, 120, 144]]
});

const TARGET_CLIPS = Object.keys(TARGET_TIMING);
const TARGET_CLIP_SET = new Set(TARGET_CLIPS);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function allStrings(value, destination = []) {
  if (typeof value === "string" || typeof value === "number") destination.push(String(value).toLowerCase());
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, destination));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, destination));
  return destination;
}

function findReceipt(storyboard) {
  if (storyboard.imports?.[IMPORT_ID]) return storyboard.imports[IMPORT_ID];
  const hashes = Object.values(PACKAGE_ARCHIVES).map((item) => item.sha256);
  return Object.values(storyboard.imports || {}).find((candidate) => {
    const strings = new Set(allStrings(candidate));
    return hashes.every((hash) => strings.has(hash));
  }) || null;
}

function collectReceiptFrames(value, destination = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReceiptFrames(item, destination));
    return destination;
  }
  if (!value || typeof value !== "object") return destination;
  if (value.frameId && value.segmentId && (value.filename || value.file) && value.sha256) destination.push(value);
  Object.values(value).forEach((item) => collectReceiptFrames(item, destination));
  return destination;
}

function receiptFramesById(receipt) {
  const result = new Map();
  for (const frame of collectReceiptFrames(receipt)) {
    if (!TARGET_CLIP_SET.has(frame.clipId)) continue;
    const normalized = {
      ...frame,
      filename: frame.filename || frame.file,
      sha256: String(frame.sha256).toLowerCase()
    };
    const previous = result.get(normalized.frameId);
    if (previous) {
      assert.equal(normalized.segmentId, previous.segmentId, `${normalized.frameId} conflicting receipt segment`);
      assert.equal(normalized.filename, previous.filename, `${normalized.frameId} conflicting receipt filename`);
      assert.equal(normalized.sha256, previous.sha256, `${normalized.frameId} conflicting receipt hash`);
    } else {
      result.set(normalized.frameId, normalized);
    }
  }
  return result;
}

function expectedSegmentIds(clipId) {
  return [1, 2, 3].map((number) => `segment-${clipId.toLowerCase()}-${String(number).padStart(2, "0")}`);
}

function expectedFrameId(clipId, segmentNumber) {
  return segmentNumber === 1
    ? `frame-${clipId.toLowerCase()}-first`
    : `frame-segment-${clipId.toLowerCase()}-${String(segmentNumber).padStart(2, "0")}`;
}

function expectedSourceEntry(clipId, segmentNumber) {
  return `first_frames/${clipId}_SEG${String(segmentNumber).padStart(2, "0")}_FIRST.png`;
}

function expectedFilenamePattern(clipId, segmentNumber) {
  const escapedClip = clipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stem = segmentNumber === 1 ? "first" : `seg${String(segmentNumber).padStart(2, "0")}`;
  const chapter = clipId.slice(0, 3).toLowerCase();
  return new RegExp(`^${escapedClip}_${stem}\\.v([1-9]\\d*)\\.${chapter}-i2v-complete\\.png$`);
}

function assertContained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${child} escaped ${parent}`);
}

function versionFileHash(version, filename) {
  return (version?.fileHashes || []).find((item) => path.basename(item.file || "").toLowerCase() === filename.toLowerCase());
}

function directoryState(root) {
  if (!fs.existsSync(root)) return [];
  const state = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        state.push([relative, "directory"]);
        visit(absolute);
      } else {
        const stat = fs.statSync(absolute);
        state.push([relative, "file", stat.size, stat.mtimeMs]);
      }
    }
  };
  visit(root);
  return state;
}

function watchedFileState(files) {
  return Object.fromEntries(files.map((file) => [file, fs.existsSync(file) ? sha256File(file) : null]));
}

function clipWithoutMutableRenderState(value) {
  const result = structuredClone(value);
  delete result.renderStatus;
  delete result.renderError;
  return result;
}

function planWithoutMutableRenderState(value) {
  const result = structuredClone(value);
  for (const key of [
    "status",
    "inputHash",
    "activeGeneratedVersion",
    "generatedFile",
    "generatedInputPath",
    "generatedVersions",
    "lastError",
    "activeRenderPromptId",
    "renderQueuedAt",
    "renderStaleAt",
    "generationStartedAt",
    "generationCompletedAt"
  ]) delete result[key];
  for (const segment of result.timelineData?.segments || []) {
    delete segment.usePreviousAsFirstFrame;
    delete segment.useNextAsLastFrame;
  }
  return result;
}

const storyboard = readJson(STORYBOARD_FILE);
const receipt = findReceipt(storyboard);
const hasH10Import = Boolean(storyboard.imports?.[H10_IMPORT_ID]);
const laterImportedClipIds = new Set(storyboard.imports?.[H10_IMPORT_ID]?.clipIds || []);
const POST_IMPORT = receipt ? {} : { skip: `waiting for ${IMPORT_ID}` };
const PRE_IMPORT = receipt ? { skip: `${IMPORT_ID} is already installed` } : { timeout: 120_000 };

test("H06-H09 read-only projection executes the exact mutation and preserves every protected production record", PRE_IMPORT, () => {
  const watchedFiles = [
    STORYBOARD_FILE,
    path.join(PROJECT_ROOT, "project.json"),
    path.join(PROJECT_ROOT, "generation-jobs.json"),
    path.join(PROJECT_ROOT, "director-generation-jobs.json")
  ];
  const backupDirectory = path.join(PROJECT_ROOT, "production", "backups");
  const filesBefore = watchedFileState(watchedFiles);
  const mediaBefore = directoryState(MEDIA_DIRECTORY);
  const backupsBefore = directoryState(backupDirectory);
  const current = readJson(STORYBOARD_FILE);

  const result = importH06H09Ltx25I2vComplete({ dryRun: true, now: new Date("2026-08-17T12:34:56.000Z") });
  assert.equal(result.dryRun, true);
  assert.equal(result.projected, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.receipt.clipIds.length, 45);
  assert.equal(result.receipt.frames.length, 135);
  assert.match(result.receipt.nonTargetSnapshotSha256, /^[a-f0-9]{64}$/);
  assert.match(result.receipt.targetInvariantSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.storyboard.imports[IMPORT_ID], result.receipt);
  assert.equal(Object.keys(result.storyboard.frames).length, 325);
  assert.equal(Object.keys(result.storyboard.referenceBindings).length, 2_639);

  for (const [clipId, value] of Object.entries(current.clips)) {
    if (!TARGET_CLIP_SET.has(clipId)) assert.deepEqual(result.storyboard.clips[clipId], value, `${clipId} projection changed a non-target clip`);
    else for (const key of ["id", "sceneId", "videoPlanId", "order", "timelineStartFrame", "durationFrames", "continuityLocks", "audioPlan", "referenceFiles", "voiceReferences"]) {
      assert.deepEqual(result.storyboard.clips[clipId][key], value[key], `${clipId} projection changed protected ${key}`);
    }
  }
  const targetPlanIds = new Set(TARGET_CLIPS.map((clipId) => current.clips[clipId].videoPlanId));
  const targetSegmentIds = new Set(TARGET_CLIPS.flatMap(expectedSegmentIds));
  for (const [planId, value] of Object.entries(current.videoPlans)) {
    if (!targetPlanIds.has(planId)) assert.deepEqual(result.storyboard.videoPlans[planId], value, `${planId} projection changed a non-target plan`);
    else {
      assert.equal(Object.hasOwn(value, "negativePrompt"), false, `${planId} current negativePrompt key must remain absent`);
      assert.equal(Object.hasOwn(result.storyboard.videoPlans[planId], "negativePrompt"), false, `${planId} projection introduced an empty negativePrompt key`);
      for (const key of ["referenceRoot", "referenceFiles", "referenceCount", "droppedReferenceFiles", "voiceReferences", "audioMode", "audioPlan"]) {
        assert.deepEqual(result.storyboard.videoPlans[planId][key], value[key], `${planId} projection changed protected ${key}`);
      }
    }
  }
  for (const [segmentId, value] of Object.entries(current.segments)) {
    if (!targetSegmentIds.has(segmentId)) assert.deepEqual(result.storyboard.segments[segmentId], value, `${segmentId} projection changed a non-target segment`);
    else for (const key of ["startFrame", "lengthFrames", "order", "videoPlanId", "isEndFrame"]) {
      assert.deepEqual(result.storyboard.segments[segmentId][key], value[key], `${segmentId} projection changed protected ${key}`);
    }
  }
  for (const [frameId, value] of Object.entries(current.frames || {})) assert.deepEqual(result.storyboard.frames[frameId], value, `${frameId} projection changed existing frame history`);
  for (const [bindingId, value] of Object.entries(current.referenceBindings || {})) assert.deepEqual(result.storyboard.referenceBindings[bindingId], value, `${bindingId} projection changed existing binding`);

  assert.deepEqual(watchedFileState(watchedFiles), filesBefore, "Read-only projection changed a production JSON file");
  assert.deepEqual(directoryState(MEDIA_DIRECTORY), mediaBefore, "Read-only projection changed production media");
  assert.deepEqual(directoryState(backupDirectory), backupsBefore, "Read-only projection changed production backups");
});

test("H06-H09 receipt authenticates 135 exact 1920x804 guides and 768 source-reference pins", POST_IMPORT, () => {
  const receiptStrings = new Set(allStrings(receipt));
  for (const [chapter, archive] of Object.entries(PACKAGE_ARCHIVES)) {
    assert.ok(receiptStrings.has(archive.sha256), `${chapter} archive hash missing from receipt`);
    assert.ok(allStrings(receipt).includes(String(archive.bytes)), `${chapter} archive byte count missing from receipt`);
  }

  const frames = receiptFramesById(receipt);
  assert.equal(frames.size, 135);
  const prompts = new Set();
  const files = new Set();
  const chapterFrames = { H06: 0, H07: 0, H08: 0, H09: 0 };
  const chapterReferences = { H06: 0, H07: 0, H08: 0, H09: 0 };
  const sourceRelations = new Map();
  let sawInactiveFortressV1 = false;

  for (const clipId of TARGET_CLIPS) {
    const chapter = clipId.slice(0, 3);
    const archive = PACKAGE_ARCHIVES[chapter];
    for (let segmentNumber = 1; segmentNumber <= 3; segmentNumber += 1) {
      const frameId = expectedFrameId(clipId, segmentNumber);
      const segmentId = expectedSegmentIds(clipId)[segmentNumber - 1];
      const frame = frames.get(frameId);
      assert.ok(frame, `Receipt omitted ${frameId}`);
      assert.equal(frame.clipId, clipId);
      assert.equal(frame.segmentId, segmentId);
      assert.equal(frame.segmentNumber, segmentNumber);
      assert.equal(frame.sourceEntry, expectedSourceEntry(clipId, segmentNumber));
      assert.equal(frame.archiveSha256, archive.sha256);
      assert.equal(frame.width, 1920);
      assert.equal(frame.height, 804);
      assert.ok(Number(frame.bytes) > 1_700_000, `${frameId} implausible byte count`);
      assert.match(frame.sha256, /^[a-f0-9]{64}$/);
      assert.match(frame.filename, expectedFilenamePattern(clipId, segmentNumber));
      assert.ok(String(frame.prompt || "").trim(), `${frameId} missing prompt`);
      assert.equal(sha256Text(frame.prompt), String(frame.promptHash).toLowerCase());
      assert.equal(files.has(frame.filename), false, `Duplicate active filename ${frame.filename}`);
      assert.equal(prompts.has(frame.prompt), false, `Duplicate local prompt at ${frameId}`);
      files.add(frame.filename);
      prompts.add(frame.prompt);
      chapterFrames[chapter] += 1;

      assert.ok(Array.isArray(frame.sourceReferences) && frame.sourceReferences.length > 0, `${frameId} receipt source references`);
      assert.equal(frame.sourceReferenceCount, frame.sourceReferences.length, `${frameId} receipt source count`);
      chapterReferences[chapter] += frame.sourceReferences.length;
      for (const source of frame.sourceReferences) {
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
        assert.ok(Number(source.bytes) > 0);
        assert.equal(source.assetVersionId, `${source.assetId}:v${source.assetVersion}`);
        assert.match(source.sourceAssetFile, /\.v\d+(?:-\d+)?\.[a-z0-9]+$/i);
        assert.equal(typeof source.storyboardDeclared, "boolean");
        assert.equal(typeof source.loadedForGeneratedFrame, "boolean");
        assert.ok(source.storyboardDeclared || source.loadedForGeneratedFrame, `${frameId} ${source.sourceAssetFile} has no provenance relation`);
        sourceRelations.set(source.sourceRelation, (sourceRelations.get(source.sourceRelation) || 0) + 1);
        if (source.sourceAssetFile === "loc-fortress.v1.png") {
          assert.equal(source.assetVersion, 1);
          assert.equal(source.pinnedActiveAtImport, false, "loc-fortress.v1 must remain an exact non-active pin");
          sawInactiveFortressV1 = true;
        }
      }
    }
  }

  assert.deepEqual(chapterFrames, { H06: 36, H07: 45, H08: 36, H09: 18 });
  assert.deepEqual(chapterReferences, { H06: 213, H07: 267, H08: 189, H09: 99 });
  assert.deepEqual(Object.fromEntries([...sourceRelations].sort()), {
    loaded_for_generated_frame: 510,
    storyboard_declared: 63,
    storyboard_declared_and_loaded_for_generated_frame: 195
  });
  assert.equal(prompts.size, 135);
  assert.equal(files.size, 135);
  assert.equal(sawInactiveFortressV1, true);
});

test("H06-H09 imported plans preserve canonical timing, unique prompts, active files and continuity corrections", POST_IMPORT, () => {
  const frames = receiptFramesById(receipt);
  const referenceTotals = { H06: 0, H07: 0, H08: 0, H09: 0 };

  for (const clipId of TARGET_CLIPS) {
    const [order, timelineStartFrame, durationFrames, lengths] = TARGET_TIMING[clipId];
    const clip = storyboard.clips[clipId];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    const segmentIds = expectedSegmentIds(clipId);
    assert.equal(clip.order, order, `${clipId} canonical order`);
    assert.equal(clip.timelineStartFrame, timelineStartFrame, `${clipId} canonical absolute start`);
    assert.equal(clip.durationFrames, durationFrames, `${clipId} canonical duration`);
    assert.equal(clip.generationMode, GENERATION_MODE);
    assert.equal(clip.referenceMode, REFERENCE_MODE);
    assert.equal(plan.generationMode, GENERATION_MODE);
    assert.equal(plan.referenceMode, REFERENCE_MODE);
    assert.equal(plan.workflowProfileId, WORKFLOW_PROFILE);
    assert.deepEqual(plan.segmentIds, segmentIds);
    assert.equal(plan.timelineData?.normalDurationFrames, durationFrames);
    assert.equal(plan.timelineData?.global_prompt, plan.globalPrompt);
    assert.match(plan.globalPrompt, /image-to-video/i);
    assert.match(plan.globalPrompt, /(?:supplied|approved) first[- ]frame/i);
    assert.match(plan.globalPrompt, /independent(?:ly)?/i, `${clipId} selected segment must render independently`);
    assert.match(plan.globalPrompt, /(?:5\s*(?:-|–|to)\s*6|5 or 6)[- ]second/i, `${clipId} selected-segment duration contract`);
    assert.match(plan.globalPrompt, /selected segment/i, `${clipId} selected-segment authority`);
    assert.doesNotMatch(plan.globalPrompt, /TEXT-TO-VIDEO WITH SEMANTIC REFERENCES/i);
    assert.doesNotMatch(plan.globalPrompt, /Generate directly from text/i);
    assert.doesNotMatch(plan.globalPrompt, /Create one \d+-second/i, `${clipId} stale whole-plan duration`);
    assert.doesNotMatch(plan.globalPrompt, /prompt influence blends across boundaries/i, `${clipId} stale cross-boundary blending`);
    assert.doesNotMatch(plan.globalPrompt.replace(/never the whole clip/ig, ""), /whole clip/i, `${clipId} stale whole-clip contract`);
    if (clipId.startsWith("H07-")) {
      assert.doesNotMatch(plan.globalPrompt, /Animate each timed interval/i, `${clipId} stale interval contract`);
      assert.doesNotMatch(plan.globalPrompt, /(?:^|[\n.])\s*Full beat:/i, `${clipId} stale full-beat contract`);
    }
    for (const lock of clip.continuityLocks || []) {
      assert.ok(plan.globalPrompt.includes(lock), `${clipId} omitted current continuity lock: ${lock}`);
    }

    const authoredPrompts = [];
    const timelineById = new Map(plan.timelineData.segments.map((segment) => [segment.id, segment]));
    let startFrame = 0;
    for (let index = 0; index < 3; index += 1) {
      const segmentNumber = index + 1;
      const segmentId = segmentIds[index];
      const frameId = expectedFrameId(clipId, segmentNumber);
      const segment = storyboard.segments[segmentId];
      const frame = storyboard.frames[frameId];
      const timeline = timelineById.get(segmentId);
      const receiptFrame = frames.get(frameId);
      assert.ok(segment && frame && timeline && receiptFrame);
      assert.equal(segment.videoPlanId, plan.id);
      assert.equal(segment.order, segmentNumber);
      assert.equal(segment.startFrame, startFrame);
      assert.equal(segment.lengthFrames, lengths[index]);
      assert.equal(segment.type, "image");
      assert.equal(segment.isEndFrame, false);
      assert.equal(segment.frameId, frameId);
      assert.equal(segment.prompt, receiptFrame.prompt);
      assert.equal(frame.prompt, segment.prompt);
      assert.equal(timeline.prompt, segment.prompt);
      assert.equal(timeline.start, segment.startFrame);
      assert.equal(timeline.length, segment.lengthFrames);
      assert.equal(timeline.type, "image");
      assert.equal(timeline.storyboardFrameId, frameId);
      assert.equal(timeline.missingGuide === true, false);
      assert.equal(frame.status, "generated");
      assert.equal(frame.generatedFile, receiptFrame.filename);
      assert.equal(frame.generatedInputPath, `media/storyboard/${frame.generatedFile}`);
      assert.equal(String(frame.inputHash).toLowerCase(), receiptFrame.sha256);
      assert.equal(timeline.fileName, frame.generatedFile);
      assert.equal(timeline.imageFile, frame.expectedInputPath);

      const versionMatch = frame.generatedFile.match(expectedFilenamePattern(clipId, segmentNumber));
      const versionNumber = Number(versionMatch[1]);
      assert.equal(frame.activeGeneratedVersion, versionNumber);
      const version = (frame.generatedVersions || []).find((item) => Number(item.v) === versionNumber && item.file === frame.generatedFile);
      const fileHash = versionFileHash(version, frame.generatedFile);
      assert.ok(fileHash);
      assert.equal(String(fileHash.sha256).toLowerCase(), receiptFrame.sha256);
      const diskFile = path.resolve(MEDIA_DIRECTORY, frame.generatedFile);
      assertContained(MEDIA_DIRECTORY, diskFile);
      assert.equal(fs.statSync(diskFile).size, receiptFrame.bytes);
      assert.equal(sha256File(diskFile), receiptFrame.sha256);

      assert.equal(frame.references.length, receiptFrame.sourceReferences.length);
      assert.deepEqual(frame.references.map((reference) => reference.order), frame.references.map((_, orderIndex) => orderIndex + 1));
      for (const reference of frame.references) {
        assert.equal(reference.targetKind, "frame");
        assert.equal(reference.targetId, frameId);
        assert.equal(
          reference.useMode,
          reference.sourceRelation === "storyboard_declared"
            ? "storyboard_declared_context_provenance"
            : "first_frame_source_provenance"
        );
        assert.equal(reference.assetVersionId, `${reference.assetId}:v${reference.assetVersion}`);
        assert.equal(reference.resolutionStatus, "resolved_exact_version");
        assert.equal(typeof reference.storyboardDeclared, "boolean");
        assert.equal(typeof reference.loadedForGeneratedFrame, "boolean");
        assert.deepEqual(storyboard.referenceBindings[reference.id], reference);
      }
      referenceTotals[clipId.slice(0, 3)] += frame.references.length;
      authoredPrompts.push(segment.prompt);
      startFrame += lengths[index];
    }
    assert.equal(startFrame, durationFrames);
    assert.equal(plan.localPrompts, authoredPrompts.join(" | "));
  }

  assert.deepEqual(referenceTotals, { H06: 213, H07: 267, H08: 189, H09: 99 });

  for (const clipId of TARGET_CLIPS.filter((id) => /^H0[67]-/.test(id))) {
    const prompt = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId].globalPrompt;
    assert.match(prompt, /both wounded hands visibly empty/i);
    assert.match(prompt, /soft, diffuse, and non-linear/i);
    assert.match(prompt, /(?:Sword state:\s*ABSENT|Jesus is completely unarmed; no sword, blade, hilt, sword-shaped light or weapon reflection)/i);
  }
  assert.match(storyboard.videoPlans[storyboard.clips["H06-S22-C01"].videoPlanId].globalPrompt, /Last Gate intact/i);

  for (const clipId of ["H08-S26-C01", "H08-S26-C02", "H08-S26-C03", "H08-S26-C04"]) {
    const prompt = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId].globalPrompt;
    assert.match(prompt, /both wounded hands visibly empty/i);
    assert.match(prompt, /soft, diffuse, and non-linear/i);
    assert.match(prompt, /Sword state:\s*ABSENT/i);
  }
  const pointPrompt = storyboard.videoPlans[storyboard.clips["H08-S27-C01"].videoPlanId].globalPrompt;
  assert.match(pointPrompt, /one compact point of light/i);
  assert.match(pointPrompt, /round and does not elongate/i);
  assert.match(pointPrompt, /Sword state:\s*ABSENT/i);
  const bladePrompt = storyboard.videoPlans[storyboard.clips["H08-S28-C02"].videoPlanId].globalPrompt;
  assert.match(bladePrompt, /complete luminous blade remains held motionless/i);
  assert.match(bladePrompt, /strike begins only in its authored later interval/i);
  for (const clipId of ["H09-S29-C03", "H09-S30-C01", "H09-S30-C02"]) {
    const prompt = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId].globalPrompt;
    assert.match(prompt, /(?:single|exactly one) (?:physical )?(?:sword )?(?:blow|strike|stroke)|one uninterrupted sword stroke|same single blow/i);
    assert.match(prompt, /No (?:second|additional) strike|ONE PHYSICAL STRIKE/i);
  }
});

test("H07 preserves declared-versus-loaded provenance and the nine generation-only Adam, Eve and Moses relations", POST_IMPORT, () => {
  const frames = receiptFramesById(receipt);
  const h07Sources = TARGET_CLIPS.filter((clipId) => clipId.startsWith("H07-"))
    .flatMap((clipId) => [1, 2, 3].flatMap((number) => frames.get(expectedFrameId(clipId, number)).sourceReferences));
  const relationCounts = h07Sources.reduce((counts, source) => {
    counts[source.sourceRelation] = (counts[source.sourceRelation] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(relationCounts, {
    storyboard_declared_and_loaded_for_generated_frame: 195,
    storyboard_declared: 63,
    loaded_for_generated_frame: 9
  });

  for (let segmentNumber = 1; segmentNumber <= 3; segmentNumber += 1) {
    const frameId = expectedFrameId("H07-S25-C04", segmentNumber);
    const receiptFrame = frames.get(frameId);
    const generationOnly = receiptFrame.sourceReferences.filter((source) =>
      source.sourceRelation === "loaded_for_generated_frame"
      && source.storyboardDeclared === false
      && source.loadedForGeneratedFrame === true
    );
    assert.equal(generationOnly.length, 3, `${frameId} generation-only identity count`);
    assert.ok(generationOnly.every((source) => source.role === "identity" && source.required === true));
    const labels = generationOnly.map((source) => `${source.assetId} ${source.sourceAssetFile}`.toLowerCase()).join(" ");
    for (const identity of ["adam", "eve", "moses"]) assert.match(labels, new RegExp(identity), `${frameId} ${identity} relation`);
  }
  assert.ok(h07Sources.every((source) => !/satan/i.test(`${source.assetId} ${source.sourceAssetFile}`)), "H07 must not invent a dedicated Satan identity plate");
});

test("Director builds all 135 H06-H09 segment jobs with exact clip/segment guides and no missingGuide", POST_IMPORT, () => {
  const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const base = workspaceFromWorkflow(JSON.parse(sourceText), sourceText);
  let jobCount = 0;
  for (const clipId of TARGET_CLIPS) {
    const workspace = workspaceForProjectClip(base, "harrowing_of_hell", clipId);
    assert.equal(workspace.premiere.clipId, clipId);
    assert.equal(workspace.premiere.generationMode, GENERATION_MODE);
    assert.equal(workspace.settings.queueMode, "segments");
    assert.equal(workspace.settings.frameRate, 24);
    assert.equal(workspace.timeline.segments.length, 3);
    assert.ok(workspace.timeline.segments.every((segment) => segment.type === "image"));
    assert.ok(workspace.timeline.segments.every((segment) => segment.missingGuide === false));
    assert.ok(workspace.timeline.segments.every((segment) => segment.projectMediaPath && /^[a-f0-9]{64}$/.test(segment.projectMediaSha256)));
    const jobs = buildSegmentJobs(workspace);
    assert.equal(jobs.length, 3);
    assert.deepEqual(jobs.map((job) => job.sourceSegmentId), expectedSegmentIds(clipId));
    for (const job of jobs) {
      assert.equal(job.generationFrames, ltxFrameCount(job.requestedFrames));
      assert.equal((job.generationFrames - 1) % 8, 0);
      assert.match(job.timeline.segments[0].fileName, expectedFilenamePattern(clipId, Number(job.sourceSegmentId.slice(-2))));
    }
    jobCount += jobs.length;
  }
  assert.equal(jobCount, 135);
});

test("H06-H09 import preserves canonical target timing, continuity, semantic-plan bindings and records not targeted by later imports", POST_IMPORT, () => {
  const backupRelative = receipt.backup || receipt.sourceBackup || receipt.storyboardBackup;
  assert.ok(backupRelative, "Combined receipt must name its pre-import backup");
  const backupFile = path.resolve(PROJECT_ROOT, backupRelative);
  assertContained(PROJECT_ROOT, backupFile);
  assert.ok(fs.existsSync(backupFile));
  if (receipt.sourceStoryboardSha256) assert.equal(sha256File(backupFile), String(receipt.sourceStoryboardSha256).toLowerCase());
  const before = readJson(backupFile);
  const targetPlanIds = new Set(TARGET_CLIPS.map((clipId) => before.clips[clipId].videoPlanId));
  const targetSegmentIds = new Set(TARGET_CLIPS.flatMap(expectedSegmentIds));

  assert.deepEqual(storyboard.defaults, before.defaults, "Storyboard defaults changed outside import scope");
  assert.deepEqual(storyboard.chapterOrder, before.chapterOrder, "Chapter order changed outside import scope");
  assert.deepEqual(storyboard.chapters, before.chapters, "Chapter metadata changed outside import scope");
  assert.deepEqual(storyboard.scenes, before.scenes, "Scene metadata changed outside import scope");

  for (const [clipId, clipBefore] of Object.entries(before.clips)) {
    if (!TARGET_CLIP_SET.has(clipId)) {
      if (laterImportedClipIds.has(clipId)) continue;
      assert.deepEqual(
        clipWithoutMutableRenderState(storyboard.clips[clipId]),
        clipWithoutMutableRenderState(clipBefore),
        `${clipId} non-target clip structure changed`
      );
      continue;
    }
    const clipAfter = storyboard.clips[clipId];
    for (const key of ["id", "sceneId", "videoPlanId", "order", "timelineStartFrame", "durationFrames", "continuityLocks", "audioPlan", "referenceFiles", "voiceReferences"]) {
      assert.deepEqual(clipAfter[key], clipBefore[key], `${clipId} stable ${key}`);
    }
  }
  for (const [segmentId, segmentBefore] of Object.entries(before.segments)) {
    if (!targetSegmentIds.has(segmentId)) {
      const segmentClipId = before.videoPlans[segmentBefore.videoPlanId]?.clipId || "";
      if (laterImportedClipIds.has(segmentClipId)) continue;
      assert.deepEqual(storyboard.segments[segmentId], segmentBefore, `${segmentId} non-target segment changed`);
      continue;
    }
    const segmentAfter = storyboard.segments[segmentId];
    for (const key of ["startFrame", "lengthFrames", "order", "videoPlanId", "isEndFrame"]) {
      assert.deepEqual(segmentAfter[key], segmentBefore[key], `${segmentId} stable ${key}`);
    }
  }
  for (const [bindingId, bindingBefore] of Object.entries(before.referenceBindings)) {
    assert.deepEqual(storyboard.referenceBindings[bindingId], bindingBefore, `${bindingId} pre-existing binding changed`);
  }
  for (const [planId, planBefore] of Object.entries(before.videoPlans)) {
    if (targetPlanIds.has(planId) || laterImportedClipIds.has(planBefore.clipId)) continue;
    assert.deepEqual(
      planWithoutMutableRenderState(storyboard.videoPlans[planId]),
      planWithoutMutableRenderState(planBefore),
      `${planId} non-target plan structure changed`
    );
  }
  for (const planId of targetPlanIds) {
    const planBefore = before.videoPlans[planId];
    const planAfter = storyboard.videoPlans[planId];
    for (const key of ["referenceRoot", "referenceFiles", "referenceCount", "droppedReferenceFiles", "voiceReferences", "audioMode", "audioPlan"]) {
      assert.deepEqual(planAfter[key], planBefore[key], `${planId} preserved ${key}`);
    }
  }
  for (const [frameId, frameBefore] of Object.entries(before.frames || {})) {
    assert.deepEqual(storyboard.frames[frameId], frameBefore, `${frameId} pre-existing frame history changed`);
  }

  const clips = Object.values(storyboard.clips);
  const segments = Object.values(storyboard.segments);
  const bindings = Object.values(storyboard.referenceBindings);
  assert.equal(Object.keys(storyboard.frames).length, hasH10Import ? 358 : 325);
  assert.equal(clips.filter((clip) => clip.generationMode === GENERATION_MODE).length, hasH10Import ? 119 : 108);
  assert.equal(clips.filter((clip) => clip.generationMode === "t2v_with_semantic_references").length, hasH10Import ? 34 : 45);
  assert.equal(segments.filter((segment) => segment.type === "image").length, hasH10Import ? 358 : 325);
  assert.equal(segments.filter((segment) => segment.type === "text").length, hasH10Import ? 34 : 67);
  assert.equal(bindings.filter((binding) => binding.targetKind === "video_plan").length, 678);
  assert.equal(bindings.filter((binding) => binding.targetKind === "frame").length, hasH10Import ? 2_150 : 1_961);
  assert.equal(bindings.length, hasH10Import ? 2_828 : 2_639);
});
