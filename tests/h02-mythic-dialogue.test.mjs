import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { workspaceForProjectClip } from "../director-webapp/premiere-projects.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = path.join(ROOT, "projects", "harrowing_of_hell");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const PROJECT_FILE = path.join(PROJECT_ROOT, "project.json");
const PACKAGE_ROOT = path.join(PROJECT_ROOT, "production", "h02-mythic-dialogue-v1", "authoritative");
const PATCH_ID = "h02_qwen_mythic_dialogue_v1";
const FPS = 24;
const SOURCE_ARCHIVE_NAME = "H02_INDEXTTS25_MYTHIC_DIALOGUE_V1.zip";
const SOURCE_ARCHIVE_SHA256 = "1c2e31b4485e3982bdf0adcbfa0f29a37c72b530157cdced4248f2903bef622f";
const PACKAGE_FINGERPRINT = "eb54d72b717a0b701ec71886cf03b8afb59c67f6785a578f927f53e5f17bd93e";
const EXPECTED_FILE_HASHES = Object.freeze({
  "H02_COPY_PASTE_INDEXTTS_CUES.md": "dbf8e91366cb75460e5bf453f1299eee66b521f6bf31acbd14f3b63426a400a9",
  "H02_DIALOGUE_MASTER.md": "37f75cc940ec700d01a009628787f753ab0d7ea544c6251619611e749009286c",
  "H02_I2V_FRAME_BINDINGS.csv": "1ea10e2c189cb292ff79e8daa70430e96c6e3d2cba893ca553c2877d93d932ad",
  "H02_I2V_RENDER_ORDER.csv": "b2b3a525085a28b1c674c902ab3328094d029af6a569c2d032db79b211e3f799",
  "H02_INDEXTTS25_CUE_SHEET.csv": "29e032a4dd82d3c557ee2ec0b8119a8c0184b493ea860fa51f907256da1c1479",
  "H02_INDEXTTS25_ENGINE_MAPPING.md": "4e3217e2f13f1ed6859ddbf2ffd4f9bf6afb618af23055f6c0219f0cc5cf1d08",
  "H02_PRONUNCIATION_AND_AUDIO_SPEC.md": "612f088d2bc02e7b19af7b33362016ec3c1a8aae3fec526cca3762e276fed1b0",
  "H02_QWEN_CUE_MANIFEST.json": "ecaf03c1b05d7292c283d9ef6451d59893a7a8da9b01e89b51513361c0db1e45",
  "H02_SPEECH_I2V_SEGMENT_PLAN.md": "4bce8dc7b41e0df3d955e169a2684a3488f01f1fefabbabb80f8c63dbbae89ce",
  "H02_VOICE_BIBLE.md": "0f17fef06d9e91f4a5374a8c3d29159681fd6ca0c7952e901764b7d472fe5626",
  "QA_REPORT.md": "b18f55dd1b992c6a95df4aeb6a19e2ea2eb216ecc7e669e409f684c34e0d94fb",
  "README.md": "6019b93406516b843fe561d08208eb551c6f7141252d670c86628f40dfd3fa63",
  "SHA256SUMS": "597f2a06b6ab49e0f4e27be17aa2111cfb9a09d0a93e2db9378594da7e4cfec0"
});
const PICTURE_ONLY_WRAPPER = "This is a picture-only pass. Keep it completely free of intelligible speech. Breaths, a restrained pain cry, a psalm vowel sustain, chain movement, footsteps, and physical reactions are allowed only where explicitly specified; they are not additional dialogue. Do not invent words, subtitles, captions, whisper beds, or background voices. Preserve actor identity, wardrobe, chains, props, wounds, light, lens, camera axis, and set geometry from the supplied input. Complete all motion before the final 0.5 seconds and hold the final 0.5 seconds visually settled for the next handoff.";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  while (records.length && records.at(-1).every((value) => value === "")) records.pop();
  const header = records.shift();
  return records.map((values) => Object.fromEntries(header.map((key, column) => [key, values[column]])));
}

function markdownCodeBlocks(text) {
  return [...text.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1].trim());
}

function parseVisualBeats(text) {
  const result = new Map();
  let clipId = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(H02-S\d+-C\d+)\s+—/);
    if (heading) {
      clipId = heading[1];
      continue;
    }
    if (!clipId || !/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((value) => value.trim());
    assert.equal(cells.length, 6, `Unexpected visual-beat row: ${line}`);
    result.set(`${clipId}-${cells[1]}`, cells[5]);
  }
  return result;
}

function segmentId(row) {
  return `segment-${row.clip_id.toLowerCase()}-${row.render_segment.toLowerCase()}`;
}

function renderId(row) {
  return `${row.clip_id}-${row.render_segment}`;
}

function expectedPrompt(row, cue, beat, speechWrapper, offscreenReplacement) {
  if (row.audio_mode !== "SPEECH") return `${beat}\n\n${PICTURE_ONLY_WRAPPER}`;
  if (!cue?.offScreen) return `${beat}\n\n${speechWrapper}`;
  const lipSentence = "The listed speaker alone articulates the supplied dialogue audio with precise natural lip, jaw, breath and facial timing.";
  assert.ok(speechWrapper.includes(lipSentence), "Authoritative speech wrapper lost its lip-sync sentence");
  return `${beat}\n\n${speechWrapper.replace(lipSentence, offscreenReplacement)}`;
}

const storyboard = readJson(STORYBOARD_FILE);
const project = readJson(PROJECT_FILE);
const receipt = storyboard.imports?.[PATCH_ID];
const renderRows = parseCsv(fs.readFileSync(path.join(PACKAGE_ROOT, "H02_I2V_RENDER_ORDER.csv"), "utf8"));
const frameRows = parseCsv(fs.readFileSync(path.join(PACKAGE_ROOT, "H02_I2V_FRAME_BINDINGS.csv"), "utf8"));
const frameByRenderId = new Map(frameRows.map((row) => [row.render_id, row]));
const qwenManifest = readJson(path.join(PACKAGE_ROOT, "H02_QWEN_CUE_MANIFEST.json"));
const cueBySegment = new Map(qwenManifest.cues.map((cue) => [cue.segmentId, cue]));
const segmentPlanText = fs.readFileSync(path.join(PACKAGE_ROOT, "H02_SPEECH_I2V_SEGMENT_PLAN.md"), "utf8");
const [speechWrapper, offscreenReplacement] = markdownCodeBlocks(segmentPlanText);
const visualBeats = parseVisualBeats(segmentPlanText);
const rowsByClip = Map.groupBy(renderRows, (row) => row.clip_id);

test("H02 authoritative package copy and import receipt retain every exact SHA-256", () => {
  assert.ok(receipt, `Missing ${PATCH_ID} receipt`);
  assert.equal(receipt.packageFingerprint, PACKAGE_FINGERPRINT);
  assert.equal(receipt.sourceArchive, SOURCE_ARCHIVE_NAME);
  assert.equal(receipt.sourceArchiveSha256, SOURCE_ARCHIVE_SHA256);
  assert.deepEqual(receipt.packageFileHashes, EXPECTED_FILE_HASHES);
  for (const [name, expected] of Object.entries(EXPECTED_FILE_HASHES)) {
    const file = path.join(PACKAGE_ROOT, name);
    assert.ok(fs.statSync(file).isFile(), `Missing authoritative package member ${name}`);
    assert.equal(sha256File(file), expected, `${name} SHA-256`);
  }
  assert.equal(sha256File(path.join(PACKAGE_ROOT, SOURCE_ARCHIVE_NAME)), SOURCE_ARCHIVE_SHA256, "Preserved source ZIP SHA-256");
});

test("H02 active topology matches all 49 authoritative render passes, durations, prompts, and frame handoffs", () => {
  assert.equal(renderRows.length, 49);
  assert.equal(frameRows.length, 49);
  assert.equal(visualBeats.size, 49);
  assert.equal(rowsByClip.size, 13);
  assert.deepEqual(renderRows.map((row) => Number(row.global_order)), Array.from({ length: 49 }, (_, index) => index + 1));
  assert.equal(renderRows.filter((row) => row.audio_mode === "SPEECH").length, 34);
  assert.equal(renderRows.filter((row) => row.audio_mode === "PICTURE_ONLY").length, 15);
  assert.equal(renderRows.reduce((sum, row) => sum + Number(row.duration_seconds) * FPS, 0), 10_884);

  let canonicalReady = 0;
  let pendingTails = 0;
  for (const [clipId, rows] of rowsByClip) {
    const clip = storyboard.clips[clipId];
    const plan = storyboard.videoPlans[clip?.videoPlanId];
    assert.ok(clip && plan, `Missing active H02 clip/plan ${clipId}`);
    assert.deepEqual(plan.segmentIds, rows.map(segmentId), `${clipId} active pass order`);
    assert.equal(clip.durationFrames, rows.reduce((sum, row) => sum + Number(row.duration_seconds) * FPS, 0), `${clipId} duration`);
    assert.equal(plan.timelineData.normalDurationFrames, clip.durationFrames, `${clipId} plan duration`);
    assert.deepEqual(plan.timelineData.segments.map((segment) => segment.id), plan.segmentIds, `${clipId} timeline pass order`);

    let startFrame = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const fullRenderId = renderId(row);
      const binding = frameByRenderId.get(fullRenderId);
      const cue = cueBySegment.get(fullRenderId) || null;
      const id = segmentId(row);
      const segment = storyboard.segments[id];
      const frame = storyboard.frames[segment?.frameId];
      const timeline = plan.timelineData.segments[index];
      const frames = Number(binding?.assembled_frame_count);
      const prompt = expectedPrompt(row, cue, visualBeats.get(fullRenderId), speechWrapper, offscreenReplacement);

      assert.ok(segment && frame && binding, `Missing imported state for ${fullRenderId}`);
      assert.equal(frames, Number(row.duration_seconds) * FPS, `${fullRenderId} duration/frame conversion`);
      assert.equal(binding.assembled_range, `0-${frames - 1}`, `${fullRenderId} assembled range`);
      assert.equal(Number(binding.handoff_frame_index), frames, `${fullRenderId} decoded N+1 handoff index`);
      assert.equal(segment.startFrame, startFrame, `${fullRenderId} start frame`);
      assert.equal(segment.lengthFrames, frames, `${fullRenderId} length`);
      assert.equal(segment.prompt, prompt, `${fullRenderId} exact local prompt`);
      assert.equal(segment.mythicDialoguePass.renderId, fullRenderId, `${fullRenderId} pass identity`);
      assert.equal(segment.mythicDialoguePass.inputImage, binding.input_image, `${fullRenderId} input binding`);
      assert.equal(segment.mythicDialoguePass.outputHandoff, binding.output_handoff, `${fullRenderId} output handoff`);
      assert.equal(segment.mythicDialoguePass.assembledFrameCount, frames, `${fullRenderId} assembled frame count`);
      assert.equal(segment.mythicDialoguePass.audioMode, row.audio_mode, `${fullRenderId} audio mode`);
      assert.equal(segment.mythicDialoguePass.cueId, row.cue_id || null, `${fullRenderId} cue binding`);
      assert.equal(segment.mythicDialoguePass.speaker, row.speaker, `${fullRenderId} speaker binding`);
      assert.equal(timeline.start, startFrame, `${fullRenderId} timeline start`);
      assert.equal(timeline.length, frames, `${fullRenderId} timeline length`);
      assert.equal(timeline.prompt, prompt, `${fullRenderId} timeline prompt`);
      assert.equal(timeline.storyboardFrameId, segment.frameId, `${fullRenderId} timeline frame ID`);
      assert.equal(timeline.expectedInputPath, binding.input_image, `${fullRenderId} timeline input path`);
      assert.equal(timeline.expectedOutputHandoff, binding.output_handoff, `${fullRenderId} timeline handoff path`);

      if (row.input_mode === "canonical") {
        canonicalReady += 1;
        const evidence = receipt.canonicalFrames.find((item) => item.clipId === clipId);
        assert.equal(segment.frameId, clip.firstFrameId, `${fullRenderId} canonical frame pointer`);
        assert.equal(frame.status, "generated", `${fullRenderId} canonical status`);
        assert.equal(frame.generatedFile, evidence.filename, `${fullRenderId} canonical filename`);
        assert.equal(frame.inputHash, evidence.sha256, `${fullRenderId} canonical hash`);
      } else {
        pendingTails += 1;
        const previous = rows[index - 1];
        const previousBinding = frameByRenderId.get(renderId(previous));
        assert.equal(segment.frameId, `frame-${clipId.toLowerCase()}-${row.render_segment.toLowerCase()}-input`, `${fullRenderId} pending frame pointer`);
        assert.equal(frame.status, "pending_accepted_decoded_tail", `${fullRenderId} pending status`);
        assert.equal(frame.generatedFile, null, `${fullRenderId} must not substitute a stale frame`);
        assert.equal(frame.continuityInput.previousRenderId, renderId(previous), `${fullRenderId} predecessor`);
        assert.equal(frame.continuityInput.expectedSource, binding.input_image, `${fullRenderId} accepted-tail source`);
        assert.equal(frame.continuityInput.decodedFrameIndex, Number(previousBinding.handoff_frame_index), `${fullRenderId} decoded handoff index`);
        assert.equal(binding.input_image, previousBinding.output_handoff, `${fullRenderId} chained handoff filename`);
      }
      startFrame += frames;
    }
    assert.equal(startFrame, clip.durationFrames, `${clipId} contiguous edit duration`);
  }
  assert.equal(canonicalReady, 13);
  assert.equal(pendingTails, 36);
});

test("Director exposes the same 49 H02 passes with 13 ready canonical guides and 36 pending tails", () => {
  const baseWorkspace = {
    schema: "premiere316.director-webapp/v1",
    timeline: { segments: [], motionSegments: [], audioSegments: [] },
    settings: { customWidth: 1088, customHeight: 448 },
    stats: {}
  };
  let ready = 0;
  let pending = 0;
  for (const [clipId, rows] of rowsByClip) {
    const workspace = workspaceForProjectClip(baseWorkspace, "harrowing_of_hell", clipId);
    assert.deepEqual(workspace.timeline.segments.map((segment) => segment.id), rows.map(segmentId), `${clipId} Director pass order`);
    assert.equal(workspace.timeline.normalDurationFrames, rows.reduce((sum, row) => sum + Number(row.duration_seconds) * FPS, 0), `${clipId} Director duration`);
    for (const [index, segment] of workspace.timeline.segments.entries()) {
      assert.equal(segment.prompt, storyboard.segments[segment.id].prompt, `${segment.id} Director prompt`);
      assert.equal(segment.mythicDialoguePass.renderId, renderId(rows[index]), `${segment.id} Director pass metadata`);
      if (rows[index].input_mode === "canonical") {
        assert.equal(segment.missingGuide, false, `${segment.id} canonical guide readiness`);
        assert.match(segment.projectMediaSha256, /^[a-f0-9]{64}$/, `${segment.id} canonical media hash`);
        ready += 1;
      } else {
        assert.equal(segment.missingGuide, true, `${segment.id} pending accepted-tail readiness`);
        assert.equal(segment.projectMediaPath, undefined, `${segment.id} must not expose substitute media`);
        pending += 1;
      }
    }
  }
  assert.equal(ready, 13);
  assert.equal(pending, 36);
});

test("all 34 Qwen dialogue cues remain exact and are bound only to the 34 speech passes", () => {
  const cues = project.sound?.dialogueCues || [];
  assert.equal(qwenManifest.cues.length, 34);
  assert.equal(cues.length, 34);
  assert.equal(new Set(cues.map((cue) => cue.cueId)).size, 34);
  assert.equal(renderRows.filter((row) => row.cue_id).length, 34);
  const importedById = new Map(cues.map((cue) => [cue.cueId, cue]));
  for (const authoritative of qwenManifest.cues) {
    const cue = importedById.get(authoritative.cueId);
    const row = renderRows.find((item) => renderId(item) === authoritative.segmentId);
    assert.ok(cue && row, `Missing imported cue ${authoritative.cueId}`);
    assert.equal(row.audio_mode, "SPEECH", `${authoritative.cueId} pass type`);
    assert.equal(row.cue_id, authoritative.cueId, `${authoritative.cueId} render binding`);
    assert.equal(cue.segmentId, authoritative.segmentId, `${authoritative.cueId} segment ID`);
    assert.equal(cue.speaker, authoritative.speaker, `${authoritative.cueId} speaker`);
    assert.equal(cue.voiceLock, authoritative.voiceLock, `${authoritative.cueId} immutable voice lock`);
    assert.equal(cue.exactDialogue, authoritative.exactDialogue, `${authoritative.cueId} exact dialogue`);
    assert.equal(cue.text, authoritative.exactDialogue, `${authoritative.cueId} visible dialogue`);
    assert.equal(cue.performanceDirection, authoritative.performanceDirection, `${authoritative.cueId} performance direction`);
    assert.equal(cue.targetVoiceDurationSec, authoritative.targetVoiceDurationSec, `${authoritative.cueId} voice target`);
    assert.equal(cue.targetVideoDurationSec, authoritative.targetVideoDurationSec, `${authoritative.cueId} video target`);
    assert.deepEqual(cue.wrapperSeeds, [42, 43, 44], `${authoritative.cueId} wrapper seeds`);
    assert.equal(cue.expectedMasterFilename, authoritative.outputs.masterFilename, `${authoritative.cueId} master filename`);
    assert.equal(cue.provider, "qwenTts", `${authoritative.cueId} provider`);
    assert.equal(cue.batchJobId, "external_h02_qwen_dialogue", `${authoritative.cueId} batch`);
  }
  assert.equal(cues.some((cue) => /JESUS/i.test(`${cue.speaker} ${cue.character} ${cue.voiceLock}`)), false, "Jesus must remain unheard throughout H02");
});

test("the legacy 39 H02 render records are byte-for-byte preserved but excluded from active H02 plans", () => {
  assert.equal(receipt.legacyActiveSegmentIdsPreserved.length, 39);
  assert.equal(new Set(receipt.legacyActiveSegmentIdsPreserved).size, 39);
  const backupFile = path.join(PROJECT_ROOT, receipt.backupRoot, "storyboard.before.json");
  const before = readJson(backupFile);
  const activeIds = new Set([...rowsByClip.values()].flatMap((rows) => rows.map(segmentId)));
  for (const id of receipt.legacyActiveSegmentIdsPreserved) {
    assert.ok(storyboard.segments[id], `Legacy segment record was deleted: ${id}`);
    assert.deepEqual(storyboard.segments[id], before.segments[id], `Legacy segment record changed: ${id}`);
    assert.equal(activeIds.has(id), false, `Legacy segment remains active: ${id}`);
  }
  const selectedH02Ids = new Set([...rowsByClip.keys()].flatMap((clipId) => {
    const clip = storyboard.clips[clipId];
    return storyboard.videoPlans[clip.videoPlanId].segmentIds;
  }));
  assert.deepEqual(selectedH02Ids, activeIds, "Only authoritative 49-pass IDs may be selected by H02 plans");
});
