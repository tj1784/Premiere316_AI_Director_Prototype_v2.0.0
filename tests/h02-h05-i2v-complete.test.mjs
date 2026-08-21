import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  sceneReferenceMedia,
  workspaceForProjectClip
} from "../director-webapp/premiere-projects.mjs";
import {
  buildSegmentJobs,
  ltxFrameCount,
  workspaceFromWorkflow
} from "../director-webapp/workflow-compiler.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = path.join(ROOT, "projects", "harrowing_of_hell");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const PROJECT_FILE = path.join(PROJECT_ROOT, "project.json");
const MEDIA_DIRECTORY = path.join(PROJECT_ROOT, "media", "storyboard");
const IMPORT_ID = "h02_h05_ltx25_i2v_complete_v1";
const LATER_IMPORT_ID = "h06_h09_ltx25_i2v_complete_v1";
const H10_IMPORT_ID = "h10_ltx25_i2v_complete_v1";
const WORKFLOW_PROFILE = "ltx-2.5-i2v-segmented-first-frame";
const GENERATION_MODE = "i2v_segmented_first_frames";
const REFERENCE_MODE = "segment_first_frames";

const PACKAGE_ARCHIVE_HASHES = Object.freeze({
  H02: "cbc6f5916827eedf05535a02ad6976410bcf8e120e9af78d97bfe2d63649851c",
  H03: "9a42cb0f1919c7a1fddbf4bd0c70252d7044840b86988b16896f7afefd796468",
  H04: "b18e82c2c303cd1e638da4882e0fddb76e7c41a1a53b6db161d0f44f87d89d9b",
  H05: "0da5938dd2a43c73f3e0aa27bf9302a43e28751c8ac38aa4e8574d7da8adedc8"
});

const LEGACY_RECEIPT_CLIPS = Object.freeze({
  H02: [
    "H02-S03-C01", "H02-S03-C02", "H02-S03-C03",
    "H02-S04-C01", "H02-S04-C02", "H02-S04-C03", "H02-S04-C04", "H02-S04-C05",
    "H02-S05-C01", "H02-S05-C02", "H02-S05-C03", "H02-S05-C04", "H02-S05-C05"
  ],
  H03: [
    "H03-S06-C01", "H03-S06-C02", "H03-S06-C03", "H03-S06-C04", "H03-S06-C05",
    "H03-S07-C01", "H03-S07-C02", "H03-S07-C03",
    "H03-S08-C01", "H03-S08-C02", "H03-S08-C03", "H03-S08-C04",
    "H03-S09-C01", "H03-S09-C02", "H03-S09-C03", "H03-S09-C04"
  ],
  H04: [
    "H04-S10-C01", "H04-S10-C02", "H04-S10-C03", "H04-S10-C04", "H04-S10-C05", "H04-S10-C06",
    "H04-S11-C01", "H04-S11-C02", "H04-S11-C03",
    "H04-S12-C01", "H04-S12-C02",
    "H04-S13-C01", "H04-S13-C02", "H04-S13-C03",
    "H04-S14-C01", "H04-S14-C02",
    "H04-S15-C01", "H04-S15-C02", "H04-S15-C03", "H04-S15-C04"
  ],
  H05: [
    "H05-S16-C01", "H05-S16-C02", "H05-S16-C03", "H05-S16-C04", "H05-S16-C05", "H05-S16-C06",
    "H05-S17-C01", "H05-S17-C02", "H05-S17-C03",
    "H05-S18-C01"
  ]
});

const LEGACY_RECEIPT_COUNTS = Object.freeze({ H02: 39, H03: 48, H04: 60, H05: 30 });
const ACTIVE_RECEIPT_CLIPS = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_RECEIPT_CLIPS).filter(([chapter]) => chapter !== "H02")
));
const ACTIVE_RECEIPT_COUNTS = Object.freeze({ H03: 48, H04: 60, H05: 30 });
const ACTIVE_RECEIPT_REFERENCE_COUNTS = Object.freeze({ H03: 270, H04: 339, H05: 192 });
const ALL_LEGACY_RECEIPT_CLIPS = Object.values(LEGACY_RECEIPT_CLIPS).flat();
const ALL_ACTIVE_RECEIPT_CLIPS = Object.values(ACTIVE_RECEIPT_CLIPS).flat();
const ACTIVE_RECEIPT_CLIP_SET = new Set(ALL_ACTIVE_RECEIPT_CLIPS);
const SUPERSEDED_H02_CLIP_SET = new Set(LEGACY_RECEIPT_CLIPS.H02);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function assertContained(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${child} escaped ${parent}`);
}

function expectedSegmentIds(clipId) {
  const base = clipId.toLowerCase();
  return [1, 2, 3].map((number) => `segment-${base}-${String(number).padStart(2, "0")}`);
}

function expectedFrameId(clipId, segmentNumber) {
  const base = clipId.toLowerCase();
  return segmentNumber === 1
    ? `frame-${base}-first`
    : `frame-segment-${base}-${String(segmentNumber).padStart(2, "0")}`;
}

function expectedFilenamePattern(clipId, segmentNumber) {
  const escapedClip = clipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stem = segmentNumber === 1 ? "first" : `seg${String(segmentNumber).padStart(2, "0")}`;
  const chapter = clipId.slice(0, 3).toLowerCase();
  return new RegExp(`^${escapedClip}_${stem}\\.v([1-9]\\d*)\\.${chapter}-i2v-complete\\.png$`);
}

function allStrings(value, destination = []) {
  if (typeof value === "string") destination.push(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, destination));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, destination));
  return destination;
}

function findImportReceipt(storyboard) {
  const direct = storyboard.imports?.[IMPORT_ID];
  if (direct) return direct;
  const hashes = Object.values(PACKAGE_ARCHIVE_HASHES);
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

function uniqueReceiptFrames(receipt) {
  const byFrameId = new Map();
  for (const record of collectReceiptFrames(receipt)) {
    const normalized = {
      ...record,
      filename: record.filename || record.file,
      sha256: String(record.sha256).toLowerCase()
    };
    const previous = byFrameId.get(normalized.frameId);
    if (previous) {
      assert.equal(normalized.segmentId, previous.segmentId, `${normalized.frameId} has conflicting receipt segment IDs`);
      assert.equal(normalized.filename, previous.filename, `${normalized.frameId} has conflicting receipt filenames`);
      assert.equal(normalized.sha256, previous.sha256, `${normalized.frameId} has conflicting receipt hashes`);
    } else {
      byFrameId.set(normalized.frameId, normalized);
    }
  }
  return byFrameId;
}

function versionFileHash(version, filename) {
  return (version?.fileHashes || []).find((item) => path.basename(item.file || "").toLowerCase() === filename.toLowerCase());
}

function clipWithoutMutableRenderState(value) {
  const result = structuredClone(value);
  delete result.renderStatus;
  delete result.renderError;
  delete result.timelineStartFrame;
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
const project = readJson(PROJECT_FILE);
const receipt = findImportReceipt(storyboard);
const hasH06H09Import = Boolean(storyboard.imports?.[LATER_IMPORT_ID]);
const hasH10Import = Boolean(storyboard.imports?.[H10_IMPORT_ID]);
const laterImportedClipIds = new Set([
  ...(storyboard.imports?.[LATER_IMPORT_ID]?.clipIds || []),
  ...(storyboard.imports?.[H10_IMPORT_ID]?.clipIds || []),
  "H01-S01-C01"
]);
const expectedPostState = hasH10Import
  ? { frames: 372, bindings: 2_828, frameBindings: 2_150, i2vClips: 119, semanticClips: 34, imageSegments: 372, textSegments: 34, segmentedChapterPattern: /^(?:H0[1-9]|H10)-/ }
  : hasH06H09Import
    ? { frames: 325, bindings: 2_639, frameBindings: 1_961, i2vClips: 108, semanticClips: 45, imageSegments: 325, textSegments: 67, segmentedChapterPattern: /^H0[1-9]-/ }
    : { frames: 190, bindings: 1_871, frameBindings: 1_193, i2vClips: 63, semanticClips: 90, imageSegments: 190, textSegments: 202, segmentedChapterPattern: /^H0[1-5]-/ };

test("H02-H05 combined import receipt authenticates all four packages and all 177 exact segment guides", () => {
  assert.ok(receipt, `Missing combined H02-H05 import receipt ${IMPORT_ID}`);
  assert.ok(storyboard.imports?.[IMPORT_ID] || receipt, "Combined receipt must remain discoverable by its package hashes");

  const receiptStrings = new Set(allStrings(receipt));
  for (const [chapter, archiveHash] of Object.entries(PACKAGE_ARCHIVE_HASHES)) {
    assert.ok(receiptStrings.has(archiveHash), `${chapter} archive SHA-256 is missing from the combined receipt`);
  }

  assert.equal(ALL_LEGACY_RECEIPT_CLIPS.length, 59);
  assert.deepEqual(
    Object.fromEntries(Object.entries(LEGACY_RECEIPT_CLIPS).map(([chapter, clips]) => [chapter, clips.length * 3])),
    LEGACY_RECEIPT_COUNTS
  );

  const receiptFrames = uniqueReceiptFrames(receipt);
  assert.equal(receiptFrames.size, 177, "Combined receipt must retain one unique hash record per imported guide");
  const expectedFrameIds = [];
  for (const clipId of ALL_LEGACY_RECEIPT_CLIPS) {
    for (let segmentNumber = 1; segmentNumber <= 3; segmentNumber += 1) {
      const segmentId = expectedSegmentIds(clipId)[segmentNumber - 1];
      const frameId = expectedFrameId(clipId, segmentNumber);
      expectedFrameIds.push(frameId);
      const record = receiptFrames.get(frameId);
      assert.ok(record, `Receipt omitted ${frameId}`);
      assert.equal(record.clipId, clipId, `${frameId} receipt clip mapping`);
      assert.equal(record.segmentId, segmentId, `${frameId} receipt segment mapping`);
      assert.match(record.sha256, /^[a-f0-9]{64}$/, `${frameId} receipt SHA-256`);
      assert.match(record.filename, expectedFilenamePattern(clipId, segmentNumber), `${frameId} receipt filename`);
    }
  }
  assert.deepEqual([...receiptFrames.keys()].sort(), expectedFrameIds.sort());
});

test("active H03-H05 plans remain governed by the combined receipt after H02 is superseded", () => {
  const receiptFrames = uniqueReceiptFrames(receipt);
  const seenFiles = new Set();
  const seenFrameIds = new Set();
  const seenPrompts = new Set();
  let referenceBindingCount = 0;

  for (const [chapter, clipIds] of Object.entries(ACTIVE_RECEIPT_CLIPS)) {
    let chapterReferenceBindingCount = 0;
    for (const clipId of clipIds) {
      const clip = storyboard.clips[clipId];
      assert.ok(clip, `Missing storyboard clip ${clipId}`);
      const plan = storyboard.videoPlans[clip.videoPlanId];
      assert.ok(plan, `Missing video plan for ${clipId}`);
      const segmentIds = expectedSegmentIds(clipId);

      assert.equal(clip.generationMode, GENERATION_MODE, `${clipId} clip generation mode`);
      assert.equal(clip.referenceMode, REFERENCE_MODE, `${clipId} clip reference mode`);
      assert.equal(plan.generationMode, GENERATION_MODE, `${clipId} plan generation mode`);
      assert.equal(plan.referenceMode, REFERENCE_MODE, `${clipId} plan reference mode`);
      assert.equal(plan.workflowProfileId, WORKFLOW_PROFILE, `${clipId} workflow profile`);
      assert.deepEqual(plan.segmentIds, segmentIds, `${clipId} segment ID mapping`);
      assert.equal(clip.firstFrameId, expectedFrameId(clipId, 1), `${clipId} first-frame pointer`);
      assert.equal(plan.timelineData?.global_prompt, plan.globalPrompt, `${clipId} timeline global prompt`);
      assert.match(plan.globalPrompt, /(?:segmented\s+image-to-video|image-to-video)/i, `${clipId} I2V global contract`);
      assert.match(plan.globalPrompt, /(?:approved|supplied) first[- ]frame/i, `${clipId} first-frame authority`);
      assert.doesNotMatch(plan.globalPrompt, /TEXT-TO-VIDEO WITH SEMANTIC REFERENCES/i, `${clipId} stale T2V header`);
      assert.doesNotMatch(plan.globalPrompt, /Generate directly from text/i, `${clipId} stale T2V mode`);
      assert.doesNotMatch(plan.globalPrompt, /Do not load temporal opening\/ending guides, prior-shot images, or timed storyboard images/i, `${clipId} stale temporal-guide prohibition`);

      const timelineById = new Map((plan.timelineData?.segments || []).map((segment) => [segment.id, segment]));
      assert.equal(timelineById.size, 3, `${clipId} timeline segment count`);
      const authoredPrompts = [];

      for (let index = 0; index < segmentIds.length; index += 1) {
        const segmentNumber = index + 1;
        const segmentId = segmentIds[index];
        const frameId = expectedFrameId(clipId, segmentNumber);
        const segment = storyboard.segments[segmentId];
        const frame = storyboard.frames[frameId];
        const timeline = timelineById.get(segmentId);
        const receiptFrame = receiptFrames.get(frameId);

        assert.ok(segment, `Missing ${segmentId}`);
        assert.ok(frame, `Missing ${frameId}`);
        assert.ok(timeline, `Missing ${segmentId} from ${plan.id} timelineData`);
        assert.ok(receiptFrame, `Missing ${frameId} from import receipt`);
        assert.equal(segment.frameId, frameId, `${segmentId} frame mapping`);
        assert.equal(segment.type, "image", `${segmentId} type`);
        assert.equal(receiptFrame.startFrame, segment.startFrame, `${segmentId} receipt start frame`);
        assert.equal(receiptFrame.lengthFrames, segment.lengthFrames, `${segmentId} receipt length`);
        assert.ok(String(segment.prompt || "").trim(), `${segmentId} prompt must not be empty`);
        assert.equal(segment.prompt, receiptFrame.prompt, `${segmentId} receipt prompt`);
        assert.match(String(receiptFrame.promptHash || ""), /^[a-f0-9]{64}$/, `${segmentId} receipt prompt hash`);
        assert.equal(sha256Text(segment.prompt), String(receiptFrame.promptHash).toLowerCase(), `${segmentId} prompt SHA-256`);
        assert.equal(frame.prompt, segment.prompt, `${frameId} prompt relay`);
        assert.equal(timeline.prompt, segment.prompt, `${segmentId} timeline prompt relay`);
        assert.equal(timeline.type, "image", `${segmentId} timeline type`);
        assert.equal(timeline.storyboardFrameId ?? segment.frameId, frameId, `${segmentId} timeline frame mapping`);
        assert.equal(timeline.missingGuide === true, false, `${segmentId} must not be missing its guide`);
        authoredPrompts.push(segment.prompt);
        seenPrompts.add(segment.prompt);

        assert.equal(frame.status, "generated", `${frameId} status`);
        assert.match(frame.generatedFile, expectedFilenamePattern(clipId, segmentNumber), `${frameId} active filename`);
        assert.equal(frame.generatedFile, receiptFrame.filename, `${frameId} receipt filename`);
        assert.equal(frame.generatedInputPath, `media/storyboard/${frame.generatedFile}`, `${frameId} project media path`);
        assert.equal(timeline.fileName, frame.generatedFile, `${segmentId} timeline filename`);
        assert.equal(timeline.imageFile, frame.expectedInputPath, `${segmentId} ComfyUI input path`);
        assert.equal(String(frame.inputHash).toLowerCase(), receiptFrame.sha256, `${frameId} active hash`);
        assert.equal(seenFiles.has(frame.generatedFile), false, `Duplicate imported filename ${frame.generatedFile}`);
        assert.equal(seenFrameIds.has(frameId), false, `Duplicate imported frame ${frameId}`);
        seenFiles.add(frame.generatedFile);
        seenFrameIds.add(frameId);

        const versionMatch = frame.generatedFile.match(expectedFilenamePattern(clipId, segmentNumber));
        const versionNumber = Number(versionMatch[1]);
        assert.equal(Number(frame.activeGeneratedVersion), versionNumber, `${frameId} active version`);
        assert.equal(frame.generatedAssetVersionId, `${frameId}:v${versionNumber}`, `${frameId} asset version ID`);
        const version = (frame.generatedVersions || []).find((item) => Number(item.v) === versionNumber && item.file === frame.generatedFile);
        assert.ok(version, `Missing active generated version for ${frameId}`);
        const fileHash = versionFileHash(version, frame.generatedFile);
        assert.ok(fileHash, `Missing active file hash for ${frameId}`);
        assert.equal(String(fileHash.sha256).toLowerCase(), receiptFrame.sha256, `${frameId} generated-version hash`);

        const diskFile = path.resolve(MEDIA_DIRECTORY, frame.generatedFile);
        assertContained(MEDIA_DIRECTORY, diskFile);
        assert.ok(fs.existsSync(diskFile), `${frameId} media file does not exist`);
        assert.equal(fs.statSync(diskFile).size, Number(fileHash.bytes), `${frameId} media bytes`);
        assert.equal(sha256File(diskFile), receiptFrame.sha256, `${frameId} media SHA-256`);

        assert.ok(Array.isArray(frame.references) && frame.references.length > 0, `${frameId} must retain source-reference provenance`);
        assert.deepEqual(frame.references.map((reference) => reference.order), frame.references.map((_, order) => order + 1), `${frameId} reference order`);
        for (const reference of frame.references) {
          assert.equal(reference.targetKind, "frame", `${reference.id} target kind`);
          assert.equal(reference.targetId, frameId, `${reference.id} target ID`);
          assert.equal(reference.useMode, "first_frame_source_provenance", `${reference.id} use mode`);
          assert.equal(reference.assetVersionId, `${reference.assetId}:v${reference.assetVersion}`, `${reference.id} pinned version`);
          assert.deepEqual(storyboard.referenceBindings[reference.id], reference, `${reference.id} binding mirror`);
          referenceBindingCount += 1;
          chapterReferenceBindingCount += 1;
        }
      }

      assert.equal(plan.localPrompts, authoredPrompts.join(" | "), `${clipId} local prompt relay`);
    }
    assert.equal(chapterReferenceBindingCount, ACTIVE_RECEIPT_REFERENCE_COUNTS[chapter], `${chapter} exact imported frame-reference count`);
    assert.equal(seenFrameIds.size, Object.keys(ACTIVE_RECEIPT_COUNTS).slice(0, Object.keys(ACTIVE_RECEIPT_COUNTS).indexOf(chapter) + 1).reduce((sum, key) => sum + ACTIVE_RECEIPT_COUNTS[key], 0));
  }

  assert.equal(seenFrameIds.size, 138);
  assert.equal(seenFiles.size, 138);
  assert.equal(seenPrompts.size, 138, "Every active H03-H05 segment must retain its own distinct local prompt");
  assert.equal(referenceBindingCount, 801, "Combined H03-H05 frame-reference count");
  const bindingKindCounts = Object.values(storyboard.referenceBindings).reduce((counts, binding) => {
    counts[binding.targetKind] = (counts[binding.targetKind] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(bindingKindCounts, { video_plan: 678, frame: expectedPostState.frameBindings });
  assert.equal(Object.keys(storyboard.referenceBindings).length, expectedPostState.bindings);
});

test("Director loads all 46 H03-H05 clips as 138 ready segment jobs on the LTX 8n+1 grid", () => {
  const sourcePath = process.env.DIRECTOR_WORKFLOW_PATH || path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const base = workspaceFromWorkflow(JSON.parse(sourceText), sourceText);
  let jobCount = 0;

  for (const clipId of ALL_ACTIVE_RECEIPT_CLIPS) {
    const workspace = workspaceForProjectClip(base, "harrowing_of_hell", clipId);
    assert.equal(workspace.premiere.clipId, clipId);
    assert.equal(workspace.premiere.generationMode, GENERATION_MODE, `${clipId} Director generation mode`);
    assert.equal(workspace.settings.queueMode, "segments", `${clipId} Director queue mode`);
    assert.equal(workspace.settings.frameRate, 24, `${clipId} frame rate`);
    assert.equal(workspace.timeline.segments.length, 3, `${clipId} Director segment count`);
    assert.ok(workspace.timeline.segments.every((segment) => segment.type === "image"), `${clipId} Director image segment types`);
    assert.ok(workspace.timeline.segments.every((segment) => segment.missingGuide === false), `${clipId} Director guides ready`);
    assert.ok(workspace.timeline.segments.every((segment) => segment.projectMediaPath && /^[a-f0-9]{64}$/.test(segment.projectMediaSha256)), `${clipId} Director media hashes`);

    const jobs = buildSegmentJobs(workspace);
    assert.equal(jobs.length, 3, `${clipId} job count`);
    assert.deepEqual(jobs.map((job) => job.sourceSegmentId), expectedSegmentIds(clipId), `${clipId} job segment mapping`);
    for (const job of jobs) {
      assert.equal(job.generationFrames, ltxFrameCount(job.requestedFrames), `${job.sourceSegmentId} LTX frame alignment`);
      assert.equal((job.generationFrames - 1) % 8, 0, `${job.sourceSegmentId} must be 8n+1`);
      assert.equal(job.timeline.segments[0].length, job.generationFrames, `${job.sourceSegmentId} child timeline length`);
      assert.match(job.timeline.segments[0].fileName, expectedFilenamePattern(clipId, Number(job.sourceSegmentId.slice(-2))), `${job.sourceSegmentId} job guide`);
    }
    jobCount += jobs.length;
  }

  assert.equal(jobCount, 138);
});

test("Director resolves every H03-H05 first-frame reference set with no missing required assets", () => {
  let resolvedReferences = 0;
  for (const clipId of ALL_ACTIVE_RECEIPT_CLIPS) {
    const result = sceneReferenceMedia("harrowing_of_hell", clipId);
    const expectedFrameIds = [1, 2, 3].map((number) => expectedFrameId(clipId, number));
    const directReferenceCount = expectedFrameIds.reduce((sum, frameId) => {
      const frame = storyboard.frames[frameId];
      assert.ok(frame, `Missing imported reference frame ${frameId}`);
      assert.ok(Array.isArray(frame.references), `${frameId} references are missing`);
      return sum + frame.references.length;
    }, 0);
    assert.deepEqual(result.frameIds, expectedFrameIds, `${clipId} reference frame IDs`);
    assert.equal(result.referencesReady, true, `${clipId} references ready`);
    assert.deepEqual(result.invalidReferences, [], `${clipId} invalid references`);
    assert.equal(result.references.length, directReferenceCount, `${clipId} resolved reference count`);
    assert.ok(result.references.every((reference) => expectedFrameIds.includes(reference.frameId)), `${clipId} reference ownership`);
    assert.ok(result.references.every((reference) => reference.useMode === "first_frame_source_provenance"), `${clipId} reference use mode`);
    assert.ok(result.references.every((reference) => reference.file.startsWith("media/assets/")), `${clipId} contained reference media`);
    resolvedReferences += result.references.length;
  }
  assert.ok(resolvedReferences >= 138, "All active H03-H05 guides must resolve at least one source reference");
});

test("H05-S18-C01 keeps Satan's face withheld and removes the contradictory visible-face state", () => {
  const clipId = "H05-S18-C01";
  const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
  const exactPackagePromptHashes = [
    "7c4bd508e9e4f3052dd48cbdab09cb5e78117c774b6123b5d8b2584979534fcf",
    "f1c79b494b77b4a9b13a88c5cbb1ff4c00e7ef710351da050eafbd288c4ffcf1",
    "2611152c66b464de43852e3a977c447a9b39a5430016ce3218a858dd62f473c4"
  ];
  assert.ok(plan, `Missing video plan for ${clipId}`);
  assert.match(plan.globalPrompt, /Satan(?:'s)? face (?:remains )?withheld/i);
  assert.match(plan.globalPrompt, /Face state:\s*WITHHELD/i);
  assert.doesNotMatch(plan.globalPrompt, /Face state:\s*VISIBLE/i);
  assert.match(plan.globalPrompt, /Jesus is absent/i);
  assert.match(plan.globalPrompt, /do not introduce (?:Jesus|Him)/i);
  assert.match(plan.globalPrompt, /Gate intact/i);
  assert.match(plan.globalPrompt, /Sword state:\s*ABSENT/i);
  assert.equal(plan.timelineData?.global_prompt, plan.globalPrompt);
  assert.doesNotMatch(plan.localPrompts, /Face state:\s*VISIBLE/i);
  assert.equal(sha256Text(plan.localPrompts), "f7e60cb4902b207f264d45f252994aedf953532eebff2c8ad3a2b923727fc577", "H05-S18-C01 local prompt relay must remain package-exact");
  for (const [index, segmentId] of expectedSegmentIds(clipId).entries()) {
    const segment = storyboard.segments[segmentId];
    const frame = storyboard.frames[segment.frameId];
    const timeline = plan.timelineData.segments.find((item) => item.id === segmentId);
    assert.equal(sha256Text(segment.prompt), exactPackagePromptHashes[index], `${segmentId} package-exact prompt`);
    assert.equal(frame.prompt, segment.prompt, `${frame.id} package-exact frame prompt`);
    assert.equal(timeline.prompt, segment.prompt, `${segmentId} package-exact timeline prompt`);
    assert.doesNotMatch(segment.prompt, /Face state:\s*VISIBLE/i, `${segmentId} segment prompt`);
    assert.doesNotMatch(frame.prompt, /Face state:\s*VISIBLE/i, `${frame.id} frame prompt`);
    assert.doesNotMatch(timeline.prompt, /Face state:\s*VISIBLE/i, `${segmentId} timeline prompt`);
  }
});

test("combined import preserves H01 and unaffected semantic-T2V data byte-for-byte in the recorded backup", () => {
  assert.ok(receipt, `Missing combined H02-H05 import receipt ${IMPORT_ID}`);
  const backupRelative = receipt.backup || receipt.sourceBackup || receipt.storyboardBackup;
  assert.ok(backupRelative, "Combined receipt must name its pre-import storyboard backup");
  const backupFile = path.resolve(PROJECT_ROOT, backupRelative);
  assertContained(PROJECT_ROOT, backupFile);
  assert.ok(fs.existsSync(backupFile), "Combined pre-import storyboard backup is missing");
  if (receipt.sourceStoryboardSha256) assert.equal(sha256File(backupFile), String(receipt.sourceStoryboardSha256).toLowerCase());
  const before = readJson(backupFile);

  assert.deepEqual(storyboard.defaults, before.defaults, "Storyboard defaults changed outside import scope");
  assert.deepEqual(storyboard.chapterOrder, before.chapterOrder, "Chapter order changed outside import scope");
  assert.deepEqual(storyboard.chapters, before.chapters, "Chapter metadata changed outside import scope");
  assert.deepEqual(storyboard.scenes, before.scenes, "Scene metadata changed outside import scope");

  for (const [clipId, clipBefore] of Object.entries(before.clips)) {
    if (SUPERSEDED_H02_CLIP_SET.has(clipId)) {
      continue;
    }
    if (ACTIVE_RECEIPT_CLIP_SET.has(clipId)) {
      for (const key of ["id", "sceneId", "videoPlanId", "order", "durationFrames"]) {
        assert.deepEqual(storyboard.clips[clipId][key], clipBefore[key], `${clipId} stable ${key}`);
      }
      assert.deepEqual(storyboard.clips[clipId].continuityLocks, clipBefore.continuityLocks, `${clipId} continuity locks changed`);
      const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
      for (const lock of clipBefore.continuityLocks || []) {
        if (!String(lock).trim()) continue;
        assert.ok(plan.globalPrompt.includes(lock), `${clipId} global prompt omitted continuity lock: ${lock}`);
        assert.ok(plan.timelineData?.global_prompt?.includes(lock), `${clipId} timeline global prompt omitted continuity lock: ${lock}`);
      }
    } else if (!laterImportedClipIds.has(clipId)) {
      assert.deepEqual(
        clipWithoutMutableRenderState(storyboard.clips[clipId]),
        clipWithoutMutableRenderState(clipBefore),
        `${clipId} non-target clip structure changed`
      );
    }
  }

  const targetPlanIds = new Set(ALL_ACTIVE_RECEIPT_CLIPS.map((clipId) => storyboard.clips[clipId].videoPlanId));
  const supersededH02PlanIds = new Set([...SUPERSEDED_H02_CLIP_SET].map((clipId) => storyboard.clips[clipId].videoPlanId));
  const targetSegmentIds = new Set(ALL_ACTIVE_RECEIPT_CLIPS.flatMap(expectedSegmentIds));
  for (const [planId, planBefore] of Object.entries(before.videoPlans)) {
    const isLaterImportPlan = laterImportedClipIds.has(planBefore.clipId);
    if (supersededH02PlanIds.has(planId)) continue;
    if (!targetPlanIds.has(planId) && !isLaterImportPlan) {
      assert.deepEqual(
        planWithoutMutableRenderState(storyboard.videoPlans[planId]),
        planWithoutMutableRenderState(planBefore),
        `${planId} non-target plan structure changed`
      );
    } else if (Object.hasOwn(planBefore, "durationFrames")) {
      assert.deepEqual(storyboard.videoPlans[planId].durationFrames, planBefore.durationFrames, `${planId} duration changed`);
    }
  }
  for (const [segmentId, segmentBefore] of Object.entries(before.segments)) {
    const segmentClipId = before.videoPlans[segmentBefore.videoPlanId]?.clipId || "";
    const isLaterImportSegment = laterImportedClipIds.has(segmentClipId);
    if (!targetSegmentIds.has(segmentId) && !isLaterImportSegment) {
      assert.deepEqual(storyboard.segments[segmentId], segmentBefore, `${segmentId} non-target segment changed`);
      continue;
    } else if (isLaterImportSegment) {
      continue;
    }
    const segment = storyboard.segments[segmentId];
    for (const key of ["startFrame", "lengthFrames", "order", "videoPlanId", "isEndFrame"]) {
      assert.deepEqual(segment[key], segmentBefore[key], `${segmentId} stable ${key}`);
    }
    const plan = storyboard.videoPlans[segment.videoPlanId];
    const timeline = plan.timelineData?.segments?.find((item) => item.id === segmentId);
    assert.ok(timeline, `${segmentId} missing from imported timeline`);
    assert.equal(timeline.start, segment.startFrame, `${segmentId} timeline start drift`);
    assert.equal(timeline.length, segment.lengthFrames, `${segmentId} timeline length drift`);
  }
  for (const [frameId, frameBefore] of Object.entries(before.frames || {})) {
    if (/^frame-(?:segment-)?h01-s01-c01/.test(frameId)) continue;
    assert.deepEqual(storyboard.frames[frameId], frameBefore, `${frameId} pre-existing frame history changed`);
  }

  const clips = Object.values(storyboard.clips);
  const plans = Object.values(storyboard.videoPlans);
  const segments = Object.values(storyboard.segments);
  const i2vClips = clips.filter((clip) => clip.generationMode === GENERATION_MODE);
  const semanticClips = clips.filter((clip) => clip.generationMode === "t2v_with_semantic_references");
  assert.equal(clips.length, 153);
  assert.equal(plans.length, 153);
  assert.equal(Object.keys(storyboard.frames).length, expectedPostState.frames);
  assert.equal(i2vClips.length, expectedPostState.i2vClips, "Imported segmented-I2V clip count");
  assert.equal(semanticClips.length, expectedPostState.semanticClips, "Remaining semantic-T2V clip count");
  assert.equal(segments.filter((segment) => segment.type === "image").length, expectedPostState.imageSegments);
  assert.equal(segments.filter((segment) => segment.type === "text").length, expectedPostState.textSegments);
  assert.ok(semanticClips.every((clip) => !expectedPostState.segmentedChapterPattern.test(clip.id)), "No imported chapter may remain semantic T2V");
  assert.ok(plans.filter((plan) => !expectedPostState.segmentedChapterPattern.test(plan.clipId)).every((plan) =>
    plan.generationMode === "t2v_with_semantic_references"
    && plan.referenceMode === "semantic_reference_resolver"
    && plan.segmentIds.every((segmentId) => storyboard.segments[segmentId].type === "text")
  ));

  assert.ok(storyboard.imports?.h01_ltx25_i2v_reference_corrected_v2, "H01 package history was lost");
  assert.ok(storyboard.imports?.h01_s01_c01_swordless_descent_v1, "H01 swordless correction history was lost");
  assert.deepEqual(
    [
      "frame-h01-s01-c01-first",
      "frame-segment-h01-s01-c01-02",
      "frame-segment-h01-s01-c01-03",
      "frame-segment-h01-s01-c01-04"
    ].map((frameId) => storyboard.frames[frameId].generatedFile),
    [
      "H01-S01-C01_first.v4.2m24s-i2v-master.png",
      "H01-S01-C01_seg02.v5.2m24s-i2v-master.png",
      "H01-S01-C01_seg03.v3.2m24s-i2v-master.png",
      "H01-S01-C01_seg04.v3.2m24s-i2v-master.png"
    ]
  );
});
