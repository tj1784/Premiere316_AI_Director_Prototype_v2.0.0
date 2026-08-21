#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const PROJECT_SLUG = "harrowing_of_hell";
const PROJECT_ROOT = path.join(REPO, "projects", PROJECT_SLUG);
const PROJECT_FILE = path.join(PROJECT_ROOT, "project.json");
const STORYBOARD_FILE = path.join(PROJECT_ROOT, "production", "storyboard.json");
const SOURCE_ROOT = String(process.env.H02_QWEN_OUTPUT_ROOT || "C:\\Users\\Blokey\\Documents\\Audacity\\Harrowing_H02_Cloned_Dialogue");
const MASTER_ROOT = path.join(SOURCE_ROOT, "MASTER_WAV");
const RENDER_MANIFEST = path.join(SOURCE_ROOT, "MANIFESTS", "DIALOGUE_RENDER_MANIFEST.csv");
const FINAL_VALIDATION = path.join(SOURCE_ROOT, "QA", "H02_FINAL_VALIDATION.json");
const ZIP_TEST = path.join(SOURCE_ROOT, "QA", "FINAL_ZIP_EXTRACTION_TEST.json");
const FINAL_ZIP = path.join(SOURCE_ROOT, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip");
const MEDIA_ROOT = path.join(PROJECT_ROOT, "media", "audio");
const PACKAGE_ID = "h02_qwen_mythic_dialogue_v1";
const BATCH_ID = "external_h02_qwen_dialogue";
const FPS = 24;

// H02 timing handles live on the picture timeline, never inside the immutable
// master WAV. At 24 fps the package's approximate 0.45 s lead and 0.55 s tail
// resolve deterministically to 11 frames (0.458333 s) and 13 frames
// (0.541667 s). D032 keeps its authored 2.0 s voice window inside a 5.0 s
// picture pass, so its minimum true-silence tail is 61 frames (2.541667 s).
export const H02_SPEECH_HANDLE_POLICY = Object.freeze({
  fps: FPS,
  leadFrames: 11,
  normalTailFrames: 13,
  d032TailFrames: 61,
  handlesArePictureTimelineOnly: true,
  masterWavContainsHandles: false
});

function fail(message) { throw new Error(message); }
function slash(value) { return String(value || "").replaceAll("\\", "/"); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function stableId(cueId) { return `h02_qwen_${String(cueId).toLowerCase()}`; }
function expectedCueIds() { return Array.from({ length: 34 }, (_, index) => `D${String(index + 1).padStart(3, "0")}`); }

function exactFrames(seconds, label) {
  const value = Number(seconds);
  const frames = value * FPS;
  const rounded = Math.round(frames);
  if (!(value > 0) || !Number.isFinite(frames) || Math.abs(frames - rounded) > 1e-9) {
    fail(`${label} must resolve to an exact frame count at ${FPS} fps; got ${seconds}`);
  }
  return rounded;
}

function exactSamples(seconds, sampleRate, label) {
  const value = Number(seconds);
  const samples = value * sampleRate;
  const rounded = Math.round(samples);
  if (!(value > 0) || !Number.isFinite(samples) || Math.abs(samples - rounded) > 1e-6) {
    fail(`${label} must resolve to an exact sample count at ${sampleRate} Hz; got ${seconds}`);
  }
  return rounded;
}

export function resolveH02SpeechTiming({
  cueId,
  cueTargetVoiceDurationSec,
  cueTargetVideoDurationSec,
  manifestTargetVoiceDurationSec,
  segmentStartFrame,
  segmentLengthFrames,
  timelineLengthFrames,
  wavSampleFrames,
  wavSampleRate
}) {
  const normalizedCueId = String(cueId || "");
  const startFrame = Number(segmentStartFrame);
  const segmentFrames = Number(segmentLengthFrames);
  const timelineFrames = Number(timelineLengthFrames);
  const sampleFrames = Number(wavSampleFrames);
  const sampleRate = Number(wavSampleRate);
  if (!/^D\d{3}$/.test(normalizedCueId)) fail(`Invalid H02 cue ID for speech timing: ${cueId}`);
  if (!Number.isInteger(startFrame) || startFrame < 0) fail(`${normalizedCueId} segment start must be a non-negative integer frame`);
  if (!Number.isInteger(segmentFrames) || segmentFrames <= 0) fail(`${normalizedCueId} segment length must be a positive integer frame count`);
  if (!Number.isInteger(timelineFrames) || timelineFrames <= 0 || startFrame + segmentFrames > timelineFrames) {
    fail(`${normalizedCueId} authored segment exceeds its timeline bounds`);
  }
  if (!Number.isInteger(sampleFrames) || sampleFrames <= 0 || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    fail(`${normalizedCueId} decoded master must expose a positive integer sample count and sample rate`);
  }

  const voiceTargetSec = Number(cueTargetVoiceDurationSec);
  const videoTargetSec = Number(cueTargetVideoDurationSec);
  const manifestVoiceTargetSec = Number(manifestTargetVoiceDurationSec);
  if (!Number.isFinite(manifestVoiceTargetSec) || Math.abs(manifestVoiceTargetSec - voiceTargetSec) > 1e-9) {
    fail(`${normalizedCueId} render-manifest voice target differs from the authoritative cue target`);
  }
  const voiceTargetFrames = exactFrames(voiceTargetSec, `${normalizedCueId} voice target`);
  const videoTargetFrames = exactFrames(videoTargetSec, `${normalizedCueId} video target`);
  if (videoTargetFrames !== segmentFrames) {
    fail(`${normalizedCueId} video target (${videoTargetFrames} frames) differs from its authored segment (${segmentFrames} frames)`);
  }

  const minimumTailFrames = normalizedCueId === "D032"
    ? H02_SPEECH_HANDLE_POLICY.d032TailFrames
    : H02_SPEECH_HANDLE_POLICY.normalTailFrames;
  const authoredTailFrames = videoTargetFrames - H02_SPEECH_HANDLE_POLICY.leadFrames - voiceTargetFrames;
  if (authoredTailFrames !== minimumTailFrames) {
    const policy = normalizedCueId === "D032" ? "D032 true-silence" : "normal speech";
    fail(`${normalizedCueId} violates the ${policy} handle topology: expected ${minimumTailFrames} tail frames, got ${authoredTailFrames}`);
  }

  const voiceTargetSamples = exactSamples(voiceTargetSec, sampleRate, `${normalizedCueId} voice target`);
  if (sampleFrames > voiceTargetSamples) {
    fail(`${normalizedCueId} master voice is longer than its ${voiceTargetSec.toFixed(3)} s authoritative voice target`);
  }
  const audioFrames = Math.ceil((sampleFrames * FPS) / sampleRate);
  const audioStartFrame = startFrame + H02_SPEECH_HANDLE_POLICY.leadFrames;
  const segmentEndFrame = startFrame + segmentFrames;
  const audioEndFrame = audioStartFrame + audioFrames;
  const actualTailFrames = segmentEndFrame - audioEndFrame;
  if (audioEndFrame > segmentEndFrame || actualTailFrames < minimumTailFrames) {
    fail(`${normalizedCueId} master does not clear its ${minimumTailFrames}-frame speech-free tail handle`);
  }

  return {
    fps: FPS,
    audioStartFrame,
    audioFrames,
    audioEndFrame,
    segmentEndFrame,
    leadFrames: H02_SPEECH_HANDLE_POLICY.leadFrames,
    leadDurationSec: H02_SPEECH_HANDLE_POLICY.leadFrames / FPS,
    minimumTailFrames,
    minimumTailDurationSec: minimumTailFrames / FPS,
    actualTailFrames,
    actualTailDurationSec: actualTailFrames / FPS,
    voiceTargetFrames,
    videoTargetFrames,
    masterVoiceSampleFrames: sampleFrames,
    masterVoiceDurationSec: sampleFrames / sampleRate,
    handlesArePictureTimelineOnly: true,
    masterWavContainsHandles: false
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some((value) => value !== "")).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function inspectPcmWav(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    fail(`${path.basename(file)} is not a RIFF/WAVE file`);
  }
  let offset = 12, format = null, dataBytes = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) fail(`${path.basename(file)} contains a truncated ${id} chunk`);
    if (id === "fmt ") {
      format = {
        codec: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitDepth: buffer.readUInt16LE(start + 14)
      };
    }
    if (id === "data") dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || dataBytes == null) fail(`${path.basename(file)} is missing PCM format or data`);
  if (format.codec !== 1 || format.channels !== 1 || format.sampleRate !== 48000 || format.bitDepth !== 24 || format.blockAlign !== 3) {
    fail(`${path.basename(file)} must be PCM mono 48 kHz 24-bit; got codec=${format.codec}, channels=${format.channels}, rate=${format.sampleRate}, bits=${format.bitDepth}`);
  }
  if (dataBytes % format.blockAlign !== 0) fail(`${path.basename(file)} PCM data is not aligned to complete samples`);
  const sampleFrames = dataBytes / format.blockAlign;
  return { ...format, sampleFrames, durationSec: sampleFrames / format.sampleRate };
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function loadValidatedInputs() {
  for (const file of [PROJECT_FILE, STORYBOARD_FILE, RENDER_MANIFEST, FINAL_VALIDATION, ZIP_TEST, FINAL_ZIP]) {
    if (!fs.existsSync(file)) fail(`Required validated input is missing: ${file}`);
  }
  const validation = readJson(FINAL_VALIDATION);
  const zipTest = readJson(ZIP_TEST);
  if (validation.status !== "PASS" || Number(validation.masterCount) !== 34 || Number(validation.alternateCount) !== 102) {
    fail("H02 final validation has not passed the exact 34-master/102-alternate gate");
  }
  if (zipTest.status !== "PASS" || Number(zipTest.masterCount) !== 34 || Number(zipTest.alternateCount) !== 102) {
    fail("H02 final ZIP has not passed its full extraction test");
  }
  if (path.resolve(String(zipTest.zipFile || "")) !== path.resolve(FINAL_ZIP) || sha256(FINAL_ZIP) !== String(zipTest.zipSha256 || "").toLowerCase()) {
    fail("H02 final ZIP no longer matches its extraction-test hash");
  }
  const rows = parseCsv(fs.readFileSync(RENDER_MANIFEST, "utf8").replace(/^\uFEFF/, ""));
  if (rows.length !== 34 || JSON.stringify(rows.map((row) => row.cue_id)) !== JSON.stringify(expectedCueIds())) {
    fail("Dialogue render manifest must contain ordered D001-D034 exactly once");
  }
  const project = readJson(PROJECT_FILE);
  const storyboard = readJson(STORYBOARD_FILE);
  const planned = (project.sound?.dialogueCues || []).filter((cue) => cue.sourcePackageId === PACKAGE_ID);
  if (planned.length !== 34) fail("Premiere316 does not contain the authoritative 34-cue H02 plan");
  const cues = new Map(planned.map((cue) => [cue.cueId, cue]));
  const masters = rows.map((row) => {
    if (row.qa_result !== "PASS" || row.exact_asr_qa !== "PASS" || row.artifact_qa !== "PASS") fail(`${row.cue_id} is not all-PASS in the render manifest`);
    const cue = cues.get(row.cue_id);
    if (!cue || cue.segmentId !== row.segment_id || cue.exactDialogue !== row.exact_dialogue || cue.speaker !== row.speaker) {
      fail(`${row.cue_id} no longer matches the imported authoritative cue`);
    }
    if (cue.expectedMasterFilename !== row.output_filename) fail(`${row.cue_id} output filename differs from the authoritative plan`);
    const source = path.join(MASTER_ROOT, row.output_filename);
    if (!fs.existsSync(source)) fail(`${row.cue_id} master is missing: ${source}`);
    const digest = sha256(source);
    if (digest !== String(row.output_sha256 || "").toLowerCase()) fail(`${row.cue_id} master SHA-256 mismatch`);
    const wav = inspectPcmWav(source);
    const measured = Number(row.measured_duration_sec);
    if (!(measured > 0) || Math.abs(wav.durationSec - measured) > 0.002) fail(`${row.cue_id} measured duration does not match the decoded WAV`);
    return { row, cue, source, digest, wav, bytes: fs.statSync(source).size };
  });
  return { project, storyboard, validation, zipTest, masters };
}

function resolveAuthoredSpeechPass(storyboard, master) {
  const { row, cue, wav } = master;
  const clipId = String(row.segment_id).match(/^H02-S\d{2}-C\d{2}/)?.[0];
  const clip = storyboard.clips?.[clipId];
  const plan = clip && storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) fail(`${row.cue_id} cannot resolve its H02 video plan`);
  const expectedSegmentId = `segment-${String(row.segment_id).toLowerCase()}`;
  const segment = (plan.timelineData?.segments || []).find((item) => item.id === expectedSegmentId);
  const record = storyboard.segments?.[expectedSegmentId];
  if (!segment || !record || segment.audioCue?.cueId !== row.cue_id || record.mythicDialoguePass?.cueId !== row.cue_id) {
    fail(`${row.cue_id} cannot resolve its exact authored speech pass`);
  }
  if (segment.passType !== "SPEECH" || record.mythicDialoguePass.audioMode !== "SPEECH"
      || record.mythicDialoguePass.renderId !== row.segment_id || record.videoPlanId !== plan.id) {
    fail(`${row.cue_id} authored pass identity or speech mode changed`);
  }
  if (Number(record.startFrame) !== Number(segment.start)
      || Number(record.lengthFrames) !== Number(segment.length)
      || Number(record.mythicDialoguePass.assembledFrameCount) !== Number(segment.length)) {
    fail(`${row.cue_id} record and timeline segment bounds differ`);
  }
  for (const [label, audioCue] of [["timeline", segment.audioCue], ["record", record.mythicDialoguePass.audioCue]]) {
    if (audioCue?.exactDialogue !== cue.exactDialogue
        || audioCue?.speaker !== cue.speaker
        || audioCue?.expectedMasterFilename !== cue.expectedMasterFilename
        || Number(audioCue?.targetVoiceDurationSec) !== Number(cue.targetVoiceDurationSec)
        || Number(audioCue?.targetVideoDurationSec) !== Number(cue.targetVideoDurationSec)) {
      fail(`${row.cue_id} ${label} audio cue differs from the authoritative project cue`);
    }
  }
  const timing = resolveH02SpeechTiming({
    cueId: row.cue_id,
    cueTargetVoiceDurationSec: cue.targetVoiceDurationSec,
    cueTargetVideoDurationSec: cue.targetVideoDurationSec,
    manifestTargetVoiceDurationSec: row.target_duration_sec,
    segmentStartFrame: segment.start,
    segmentLengthFrames: segment.length,
    timelineLengthFrames: plan.timelineData?.normalDurationFrames,
    wavSampleFrames: wav.sampleFrames,
    wavSampleRate: wav.sampleRate
  });
  return { clipId, plan, segment, record, timing };
}

function serializedHandlePolicy(timing) {
  return {
    mode: "picture_timeline_only",
    fps: timing.fps,
    leadFrames: timing.leadFrames,
    leadDurationSec: timing.leadDurationSec,
    minimumTailFrames: timing.minimumTailFrames,
    minimumTailDurationSec: timing.minimumTailDurationSec,
    actualTailFrames: timing.actualTailFrames,
    actualTailDurationSec: timing.actualTailDurationSec,
    voiceTargetFrames: timing.voiceTargetFrames,
    videoTargetFrames: timing.videoTargetFrames,
    masterWavContainsHandles: false
  };
}

function prepare(data) {
  const now = new Date().toISOString();
  const project = structuredClone(data.project);
  const storyboard = structuredClone(data.storyboard);
  project.sound ||= { schemaVersion: 2, primaryProvider: "qwenTts", voices: [], generations: [] };
  project.sound.generations ||= [];
  const packageGenerationIds = new Set(data.masters.map(({ row }) => stableId(row.cue_id)));
  project.sound.generations = project.sound.generations.filter((generation) => !packageGenerationIds.has(generation.id));
  const cueById = new Map((project.sound.dialogueCues || []).map((cue) => [cue.cueId, cue]));

  for (const master of data.masters) {
    const { row, digest, wav, bytes } = master;
    const cue = cueById.get(row.cue_id);
    const { plan, segment, record, timing } = resolveAuthoredSpeechPass(storyboard, { ...master, cue });
    const speechHandlePolicy = serializedHandlePolicy(timing);
    const relative = `media/audio/${row.output_filename}`;
    const mediaUrl = `/media/${PROJECT_SLUG}/audio/${encodeURIComponent(row.output_filename)}`;
    Object.assign(cue, {
      status: "done", progress: 1, masterReady: true, selectedSeed: Number(row.selected_seed),
      measuredDurationSec: wav.durationSec, file: row.output_filename, mediaUrl, sha256: digest, bytes,
      qaResult: "PASS", speechHandlePolicy, updatedAt: now,
      output: { masterFilename: row.output_filename, masterExists: true, projectMediaPath: relative, mediaUrl, sha256: digest, bytes }
    });
    project.sound.generations.push({
      id: stableId(row.cue_id), jobId: BATCH_ID, provider: "qwenTts", engine: "Qwen3-TTS Base",
      model: "Qwen/Qwen3-TTS-12Hz-1.7B-Base", status: "done", oneContinuousGeneration: true,
      speaker: row.speaker, name: `${row.cue_id} · ${row.speaker}`, text: row.exact_dialogue,
      style: cue.performanceDirection, styleMode: "reference-prosody", language: "EN", seed: Number(row.selected_seed),
      voiceLock: row.voice_lock, sourceVoiceFile: row.source_voice_file, outputFile: row.output_filename,
      file: row.output_filename, mediaUrl, sha256: digest, bytes, durationSec: wav.durationSec,
      sampleRate: wav.sampleRate, channels: wav.channels, bitDepth: wav.bitDepth,
      cueId: row.cue_id, segmentId: row.segment_id, targetDurationSec: Number(row.target_duration_sec),
      targetVideoDurationSec: Number(cue.targetVideoDurationSec), speechHandlePolicy,
      qaResult: "PASS", immutable: true, sourceBatchId: BATCH_ID, sourcePackageId: PACKAGE_ID,
      provenance: { provider: "qwenTts", engine: "Qwen3-TTS Base", renderer: "standalone", usesComfyUi: false,
        selectedSeed: Number(row.selected_seed), outputSha256: digest, finalZipSha256: data.zipTest.zipSha256,
        exactDialogueQa: row.exact_asr_qa, pronunciationQa: row.pronunciation_qa, artifactQa: row.artifact_qa,
        speechHandlePolicy },
      createdAt: data.validation.validatedAt || now, updatedAt: now, finishedAt: data.validation.validatedAt || now, error: null
    });
    plan.timelineData.audioSegments ||= [];
    plan.timelineData.audioSegments = plan.timelineData.audioSegments.filter((item) => item.cueId !== row.cue_id && item.id !== `audio-h02-${row.cue_id.toLowerCase()}`);
    plan.timelineData.audioSegments.push({
      id: `audio-h02-${row.cue_id.toLowerCase()}`, type: "audio", start: timing.audioStartFrame, length: timing.audioFrames,
      trimStart: 0, audioDurationFrames: timing.audioFrames, fileName: row.output_filename, audioFile: row.output_filename,
      projectMediaPath: relative, projectMediaBytes: bytes, projectMediaSha256: digest,
      cueId: row.cue_id, speaker: row.speaker, exactDialogue: row.exact_dialogue, qaResult: "PASS", immutable: true,
      speechHandlePolicy
    });
    segment.audioCue = { ...segment.audioCue, authoritativeFile: relative, sha256: digest, measuredDurationSec: wav.durationSec, selectedSeed: Number(row.selected_seed), speechHandlePolicy, qaStatus: "PASS" };
    record.mythicDialoguePass.audioCue = { ...record.mythicDialoguePass.audioCue, authoritativeFile: relative, sha256: digest, measuredDurationSec: wav.durationSec, selectedSeed: Number(row.selected_seed), speechHandlePolicy, qaStatus: "PASS" };
  }
  for (const plan of Object.values(storyboard.videoPlans || {})) {
    if (!String(plan.id || "").startsWith("video-h02-")) continue;
    if (Array.isArray(plan.timelineData?.audioSegments)) plan.timelineData.audioSegments.sort((a, b) => Number(a.start) - Number(b.start));
  }
  const batch = (project.sound.dialogueBatches || []).find((item) => item.id === BATCH_ID);
  if (batch) Object.assign(batch, { status: "done", selectedMasterCount: 34, completedAt: now, updatedAt: now, finalZipSha256: data.zipTest.zipSha256 });
  project.updatedAt = now;
  storyboard.updatedAt = now;
  return { project, storyboard };
}

function applyPrepared(data, prepared) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  const backupRoot = path.join(PROJECT_ROOT, "production", "backups", "h02-qwen-master-import", stamp);
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.copyFileSync(PROJECT_FILE, path.join(backupRoot, "project.before.json"), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(STORYBOARD_FILE, path.join(backupRoot, "storyboard.before.json"), fs.constants.COPYFILE_EXCL);
  const created = [];
  try {
    for (const master of data.masters) {
      const destination = path.join(MEDIA_ROOT, master.row.output_filename);
      if (fs.existsSync(destination)) {
        if (sha256(destination) !== master.digest) fail(`Refusing to overwrite different project audio: ${destination}`);
      } else {
        const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
        fs.copyFileSync(master.source, temporary, fs.constants.COPYFILE_EXCL);
        if (sha256(temporary) !== master.digest) fail(`Staged copy changed for ${master.row.cue_id}`);
        fs.renameSync(temporary, destination);
        created.push(destination);
      }
    }
    atomicJson(STORYBOARD_FILE, prepared.storyboard);
    atomicJson(PROJECT_FILE, prepared.project);
  } catch (error) {
    fs.copyFileSync(path.join(backupRoot, "storyboard.before.json"), STORYBOARD_FILE);
    fs.copyFileSync(path.join(backupRoot, "project.before.json"), PROJECT_FILE);
    for (const file of created) { try { fs.unlinkSync(file); } catch {} }
    throw error;
  }
  fs.writeFileSync(path.join(backupRoot, "import-manifest.json"), `${JSON.stringify({
    appliedAt: new Date().toISOString(), sourceRoot: SOURCE_ROOT, finalZipSha256: data.zipTest.zipSha256,
    speechHandlePolicy: {
      fps: FPS,
      leadFrames: H02_SPEECH_HANDLE_POLICY.leadFrames,
      leadDurationSec: H02_SPEECH_HANDLE_POLICY.leadFrames / FPS,
      normalTailFrames: H02_SPEECH_HANDLE_POLICY.normalTailFrames,
      normalTailDurationSec: H02_SPEECH_HANDLE_POLICY.normalTailFrames / FPS,
      d032TailFrames: H02_SPEECH_HANDLE_POLICY.d032TailFrames,
      d032TailDurationSec: H02_SPEECH_HANDLE_POLICY.d032TailFrames / FPS,
      handlesArePictureTimelineOnly: true,
      masterWavContainsHandles: false
    },
    masters: data.masters.map(({ row, digest, bytes, wav }) => ({ cueId: row.cue_id, file: row.output_filename, sha256: digest, bytes, voiceDurationSec: wav.durationSec }))
  }, null, 2)}\n`, { flag: "wx" });
  return backupRoot;
}

function verifySaved(data) {
  const project = readJson(PROJECT_FILE);
  const storyboard = readJson(STORYBOARD_FILE);
  const generations = (project.sound?.generations || []).filter((item) => item.sourceBatchId === BATCH_ID && item.status === "done");
  const cues = (project.sound?.dialogueCues || []).filter((item) => item.sourcePackageId === PACKAGE_ID && item.status === "done" && item.masterReady);
  const audio = Object.values(storyboard.videoPlans || {}).flatMap((plan) => plan.timelineData?.audioSegments || []).filter((item) => item.cueId && String(item.id).startsWith("audio-h02-"));
  if (generations.length !== 34 || cues.length !== 34 || audio.length !== 34) fail(`Saved promotion count mismatch: generations=${generations.length}, cues=${cues.length}, audio=${audio.length}`);
  const cueById = new Map(cues.map((cue) => [cue.cueId, cue]));
  const generationByCueId = new Map(generations.map((generation) => [generation.cueId, generation]));
  for (const master of data.masters) {
    const destination = path.join(MEDIA_ROOT, master.row.output_filename);
    if (!fs.existsSync(destination) || sha256(destination) !== master.digest) fail(`${master.row.cue_id} project media verification failed`);
    const savedCue = cueById.get(master.row.cue_id);
    const savedGeneration = generationByCueId.get(master.row.cue_id);
    const { plan, timing } = resolveAuthoredSpeechPass(storyboard, { ...master, cue: savedCue });
    const binding = (plan.timelineData?.audioSegments || []).find((item) => item.id === `audio-h02-${master.row.cue_id.toLowerCase()}`);
    if (!binding || Number(binding.start) !== timing.audioStartFrame || Number(binding.length) !== timing.audioFrames
        || Number(binding.audioDurationFrames) !== timing.audioFrames || Number(binding.trimStart) !== 0
        || binding.speechHandlePolicy?.masterWavContainsHandles !== false
        || Number(binding.speechHandlePolicy?.leadFrames) !== timing.leadFrames
        || Number(binding.speechHandlePolicy?.minimumTailFrames) !== timing.minimumTailFrames) {
      fail(`${master.row.cue_id} saved audio binding does not preserve the authoritative picture-only handles`);
    }
    if (!savedGeneration || savedCue?.speechHandlePolicy?.masterWavContainsHandles !== false
        || savedGeneration.speechHandlePolicy?.masterWavContainsHandles !== false
        || Number(savedGeneration.durationSec) !== master.wav.durationSec) {
      fail(`${master.row.cue_id} saved cue or generation counts picture handles as master voice duration`);
    }
  }
  return { generations: generations.length, cues: cues.length, audioSegments: audio.length, mediaFiles: data.masters.length, timingHandlesVerified: data.masters.length };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const apply = process.argv.includes("--apply");
  try {
    const data = loadValidatedInputs();
    const prepared = prepare(data);
    if (!apply) {
      console.log(JSON.stringify({ mode: "audit", sourceRoot: SOURCE_ROOT, masters: data.masters.length, finalZipSha256: data.zipTest.zipSha256, projectFile: PROJECT_FILE, storyboardFile: STORYBOARD_FILE }, null, 2));
    } else {
      const backupRoot = applyPrepared(data, prepared);
      console.log(JSON.stringify({ mode: "apply", backupRoot, verification: verifySaved(data) }, null, 2));
    }
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  }
}
