#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PATCH_ID = "h02_qwen_mythic_dialogue_v1";
const PROJECT_SLUG = "harrowing_of_hell";
const SOURCE_ARCHIVE_NAME = "H02_INDEXTTS25_MYTHIC_DIALOGUE_V1.zip";
const SOURCE_ARCHIVE_SHA256 = "1c2e31b4485e3982bdf0adcbfa0f29a37c72b530157cdced4248f2903bef622f";
const EXTERNAL_BATCH_ID = "external_h02_qwen_dialogue";
const FPS = 24;
const EXPECTED = Object.freeze({ clips: 13, passes: 49, speech: 34, picture: 15, durationFrames: 10884, cues: 34 });
const REQUIRED_PACKAGE_FILES = Object.freeze([
  "H02_COPY_PASTE_INDEXTTS_CUES.md",
  "H02_DIALOGUE_MASTER.md",
  "H02_I2V_FRAME_BINDINGS.csv",
  "H02_I2V_RENDER_ORDER.csv",
  "H02_INDEXTTS25_CUE_SHEET.csv",
  "H02_INDEXTTS25_ENGINE_MAPPING.md",
  "H02_PRONUNCIATION_AND_AUDIO_SPEC.md",
  "H02_QWEN_CUE_MANIFEST.json",
  "H02_SPEECH_I2V_SEGMENT_PLAN.md",
  "H02_VOICE_BIBLE.md",
  "QA_REPORT.md",
  "README.md",
  "SHA256SUMS"
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const defaults = Object.freeze({
  packageRoot: "C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_package_audit\\H02_INDEXTTS25_MYTHIC_DIALOGUE_V1",
  projectRoot: path.join(repoRoot, "projects", PROJECT_SLUG),
  archive: "C:\\Users\\Blokey\\Downloads\\H02_INDEXTTS25_MYTHIC_DIALOGUE_V1.zip",
  externalOutputRoot: "C:\\Users\\Blokey\\Documents\\Audacity\\Harrowing_H02_Cloned_Dialogue"
});

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = { apply: false, verifyOnly: false, expectedStoryboardSha256: "", ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--audit") result.apply = false;
    else if (value === "--verify-only") result.verifyOnly = true;
    else if (value === "--package-root") result.packageRoot = path.resolve(argv[++index]);
    else if (value === "--project-root") result.projectRoot = path.resolve(argv[++index]);
    else if (value === "--archive") result.archive = path.resolve(argv[++index]);
    else if (value === "--external-output-root") result.externalOutputRoot = path.resolve(argv[++index]);
    else if (value === "--expected-storyboard-sha256") result.expectedStoryboardSha256 = String(argv[++index] || "").toLowerCase();
    else if (value === "--help") {
      process.stdout.write("Usage: node scripts/import-h02-mythic-dialogue.mjs [--audit|--apply|--verify-only] [--expected-storyboard-sha256 HASH] [--package-root DIR] [--project-root DIR]\n");
      process.exit(0);
    } else fail(`Unknown argument: ${value}`);
  }
  if (result.apply && result.verifyOnly) fail("Choose either --apply or --verify-only");
  return result;
}

function clone(value) {
  return structuredClone(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableHash(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function normalizeRelative(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function writeBufferAtomic(file, buffer) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, buffer, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function writeJsonAtomic(file, value) {
  writeBufferAtomic(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
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
      continue;
    }
    if (char === '"') quoted = true;
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
  if (quoted) fail("CSV ended inside a quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  while (records.length && records.at(-1).every((value) => value === "")) records.pop();
  if (!records.length) return [];
  const header = records.shift();
  if (new Set(header).size !== header.length) fail("CSV contains duplicate column names");
  return records.map((values, index) => {
    if (values.length !== header.length) fail(`CSV row ${index + 2} has ${values.length} fields; expected ${header.length}`);
    return Object.fromEntries(header.map((key, column) => [key, values[column]]));
  });
}

function parseChecksumManifest(text) {
  const result = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) fail(`Invalid SHA256SUMS line: ${raw}`);
    const name = normalizeRelative(match[2]);
    if (result.has(name)) fail(`SHA256SUMS repeats ${name}`);
    result.set(name, match[1].toLowerCase());
  }
  return result;
}

function markdownCodeBlocks(text) {
  return [...text.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1].trim());
}

function parseVisualBeats(text) {
  const result = new Map();
  let currentClip = null;
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^###\s+(H02-S\d+-C\d+)\s+—/);
    if (heading) {
      currentClip = heading[1];
      continue;
    }
    if (!currentClip || !/^\|\s*\d+\s*\|/.test(raw)) continue;
    const cells = raw.split("|").slice(1, -1).map((value) => value.trim());
    if (cells.length !== 6) fail(`Unexpected H02 segment-plan table row: ${raw}`);
    const [order, renderSegment, duration, audio, input, visualBeat] = cells;
    const id = `${currentClip}-${renderSegment}`;
    if (result.has(id)) fail(`Duplicate visual beat ${id}`);
    result.set(id, {
      order: Number(order),
      clipId: currentClip,
      renderSegment,
      durationSec: Number(duration.replace(/s$/i, "")),
      audio,
      input,
      visualBeat
    });
  }
  return result;
}

function readPackage(packageRoot, archive) {
  const files = Object.fromEntries(REQUIRED_PACKAGE_FILES.map((name) => [name, path.join(packageRoot, name)]));
  for (const [name, file] of Object.entries(files)) if (!fs.existsSync(file)) fail(`Required package file is missing (${name}): ${file}`);
  const checksums = parseChecksumManifest(fs.readFileSync(files.SHA256SUMS, "utf8"));
  for (const [name, expected] of checksums) {
    const file = path.join(packageRoot, name);
    if (!fs.existsSync(file)) fail(`SHA256SUMS member is missing: ${name}`);
    const actual = sha256File(file);
    if (actual !== expected) fail(`Package member hash mismatch for ${name}: ${actual}`);
  }
  const fileHashes = Object.fromEntries(REQUIRED_PACKAGE_FILES.map((name) => [name, sha256File(files[name])]));
  if (archive && fs.existsSync(archive)) {
    const actualArchiveHash = sha256File(archive);
    if (actualArchiveHash !== SOURCE_ARCHIVE_SHA256) fail(`Source ZIP hash changed: ${actualArchiveHash}`);
  }
  const segmentPlanText = fs.readFileSync(files["H02_SPEECH_I2V_SEGMENT_PLAN.md"], "utf8");
  const codeBlocks = markdownCodeBlocks(segmentPlanText);
  if (codeBlocks.length < 2) fail("H02 segment plan is missing its speech and off-screen prompt wrappers");
  const qwenManifest = readJson(files["H02_QWEN_CUE_MANIFEST.json"]);
  const data = {
    packageRoot,
    files,
    fileHashes,
    packageFingerprint: stableHash(fileHashes),
    renderRows: parseCsv(fs.readFileSync(files["H02_I2V_RENDER_ORDER.csv"], "utf8")),
    frameBindings: parseCsv(fs.readFileSync(files["H02_I2V_FRAME_BINDINGS.csv"], "utf8")),
    cueSheet: parseCsv(fs.readFileSync(files["H02_INDEXTTS25_CUE_SHEET.csv"], "utf8")),
    qwenManifest,
    cues: qwenManifest.cues || [],
    visualBeats: parseVisualBeats(segmentPlanText),
    sharedSpeechWrapper: codeBlocks[0],
    offscreenReplacement: codeBlocks[1]
  };
  return data;
}

function renderId(row) {
  return `${row.clip_id}-${row.render_segment}`;
}

function promptForPass(row, beat, cue, packageData) {
  if (row.audio_mode === "SPEECH") {
    let wrapper = packageData.sharedSpeechWrapper;
    if (cue?.offScreen) {
      const lipSentence = "The listed speaker alone articulates the supplied dialogue audio with precise natural lip, jaw, breath and facial timing.";
      if (!wrapper.includes(lipSentence)) fail("Shared speech wrapper no longer contains the expected lip-sync sentence");
      wrapper = wrapper.replace(lipSentence, packageData.offscreenReplacement);
    }
    return `${beat.visualBeat}\n\n${wrapper}`;
  }
  return `${beat.visualBeat}\n\nThis is a picture-only pass. Keep it completely free of intelligible speech. Breaths, a restrained pain cry, a psalm vowel sustain, chain movement, footsteps, and physical reactions are allowed only where explicitly specified; they are not additional dialogue. Do not invent words, subtitles, captions, whisper beds, or background voices. Preserve actor identity, wardrobe, chains, props, wounds, light, lens, camera axis, and set geometry from the supplied input. Complete all motion before the final 0.5 seconds and hold the final 0.5 seconds visually settled for the next handoff.`;
}

function validatePackage(data) {
  const { renderRows, frameBindings, cues, visualBeats } = data;
  if (renderRows.length !== EXPECTED.passes) fail(`Expected ${EXPECTED.passes} render passes; received ${renderRows.length}`);
  if (frameBindings.length !== EXPECTED.passes) fail(`Expected ${EXPECTED.passes} frame bindings; received ${frameBindings.length}`);
  if (visualBeats.size !== EXPECTED.passes) fail(`Expected ${EXPECTED.passes} visual beats; received ${visualBeats.size}`);
  if (cues.length !== EXPECTED.cues) fail(`Expected ${EXPECTED.cues} Qwen cues; received ${cues.length}`);
  if (new Set(renderRows.map(renderId)).size !== EXPECTED.passes) fail("H02 render IDs are not unique");
  if (new Set(cues.map((cue) => cue.cueId)).size !== EXPECTED.cues) fail("H02 cue IDs are not unique");
  if (new Set(cues.map((cue) => cue.segmentId)).size !== EXPECTED.cues) fail("H02 cue segment IDs are not unique");
  const bindingById = new Map(frameBindings.map((row) => [row.render_id, row]));
  const cueBySegment = new Map(cues.map((cue) => [cue.segmentId, cue]));
  const rowsByClip = new Map();
  let speech = 0;
  let picture = 0;
  let totalFrames = 0;
  for (let index = 0; index < renderRows.length; index += 1) {
    const row = renderRows[index];
    const id = renderId(row);
    if (Number(row.global_order) !== index + 1) fail(`Non-contiguous global order at ${id}`);
    const beat = visualBeats.get(id);
    const binding = bindingById.get(id);
    if (!beat || !binding) fail(`Missing visual beat or frame binding for ${id}`);
    const durationSec = Number(row.duration_seconds);
    const frames = Number(binding.assembled_frame_count);
    if (!Number.isFinite(durationSec) || durationSec <= 0 || frames !== Math.round(durationSec * FPS)) fail(`Duration/frame mismatch for ${id}`);
    if (Number(binding.global_order) !== index + 1 || Number(binding.handoff_frame_index) !== frames || binding.assembled_range !== `0-${frames - 1}`) fail(`N+1 handoff contract mismatch for ${id}`);
    if (Math.abs(beat.durationSec - durationSec) > 0.0001) fail(`Visual plan duration differs for ${id}`);
    const cue = cueBySegment.get(id) || null;
    if (row.audio_mode === "SPEECH") {
      speech += 1;
      if (!cue || cue.cueId !== row.cue_id || cue.speaker !== row.speaker) fail(`Cue mapping mismatch for ${id}`);
      if (cue.qwenRender?.targetText !== cue.exactDialogue) fail(`Qwen target text differs from exact dialogue for ${cue.cueId}`);
      if (Math.abs(Number(cue.targetVideoDurationSec) - durationSec) > 0.0001) fail(`Cue video target differs for ${cue.cueId}`);
    } else if (row.audio_mode === "PICTURE_ONLY") {
      picture += 1;
      if (cue || row.cue_id) fail(`Picture-only pass unexpectedly has dialogue: ${id}`);
    } else fail(`Unknown audio mode ${row.audio_mode} for ${id}`);
    if (!rowsByClip.has(row.clip_id)) rowsByClip.set(row.clip_id, []);
    rowsByClip.get(row.clip_id).push(row);
    totalFrames += frames;
  }
  if (speech !== EXPECTED.speech || picture !== EXPECTED.picture) fail(`Expected ${EXPECTED.speech}/${EXPECTED.picture} speech/picture passes; received ${speech}/${picture}`);
  if (rowsByClip.size !== EXPECTED.clips) fail(`Expected ${EXPECTED.clips} clips; received ${rowsByClip.size}`);
  if (totalFrames !== EXPECTED.durationFrames) fail(`Expected ${EXPECTED.durationFrames} edit frames; received ${totalFrames}`);
  if (cues.some((cue) => /JESUS/i.test(`${cue.speaker} ${cue.character} ${cue.voiceLock}`))) fail("Jesus must remain unheard throughout H02");
  const prompts = new Map(renderRows.map((row) => {
    const id = renderId(row);
    return [id, promptForPass(row, visualBeats.get(id), cueBySegment.get(id) || null, data)];
  }));
  return { rowsByClip, bindingById, cueBySegment, prompts, speech, picture, totalFrames };
}

function chapterForClip(storyboard, clip) {
  return storyboard.scenes?.[clip.sceneId]?.chapterId || String(clip.id || "").split("-")[0];
}

function activeFrameVersion(frame) {
  return (frame?.generatedVersions || []).find((version) => Number(version.v) === Number(frame?.activeGeneratedVersion)) || null;
}

function versionFile(version) {
  return String(version?.file || version?.files?.[0] || "");
}

function canonicalFrameEvidence(projectRoot, clip, frame) {
  const version = activeFrameVersion(frame);
  if (!version) fail(`Canonical start frame has no active generated version: ${clip.id}`);
  const filename = versionFile(version);
  if (!filename) fail(`Canonical start frame has no file: ${clip.id}`);
  const relative = normalizeRelative(filename).startsWith("media/") ? normalizeRelative(filename) : `media/storyboard/${normalizeRelative(filename)}`;
  const disk = path.join(projectRoot, ...relative.split("/"));
  if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) fail(`Canonical start frame file is missing: ${disk}`);
  const sha256 = sha256File(disk);
  const pinned = String(version.fileHashes?.find((item) => path.basename(String(item.file || "")) === path.basename(filename))?.sha256 || version.fileHashes?.[0]?.sha256 || "").toLowerCase();
  if (pinned && pinned !== sha256) fail(`Canonical start frame hash changed for ${clip.id}`);
  return { frameId: frame.id, file: relative, filename: path.basename(filename), sha256, bytes: fs.statSync(disk).size, version: Number(version.v) };
}

function cleanGlobalPrompt(existing, clip) {
  const source = String(existing || "").trim();
  const visualPrefix = source.split(/\n\nSilent picture pass\./i)[0]
    .replace(/\n\nGENERATION CONTRACT:[\s\S]*$/i, "")
    .trim();
  const locks = (clip.continuityLocks || []).map((value) => `- ${value}`).join("\n");
  const base = visualPrefix || [
    `PREMIERE316 LTX-2.5 SPEECH + IMAGE-TO-VIDEO — ${clip.id}`,
    "",
    "PACKAGE GLOBAL VISUAL / CHRONOLOGY LOCK",
    "Maximum-photorealistic live-action biblical epic; real actors, real anatomy, tactile practical ancient linen, physically photographed basalt and iron, real smoke and ash, natural anamorphic lens behavior, restrained motion blur, high dynamic range and delicate film grain. No cartoon, illustration, painting, glossy CGI, fantasy game render, plastic skin, text, captions, logos, watermarks, duplicated people or malformed anatomy. Chapter H02 sword state is ABSENT. Jesus remains entirely unseen."
  ].join("\n");
  const hasLocks = /CURRENT CONTINUITY LOCKS/i.test(base);
  return [
    base,
    !hasLocks && locks ? `CURRENT CONTINUITY LOCKS\n${locks}` : "",
    "SPEECH + I2V EXTENDED CUT CONTRACT",
    "Use the authoritative H02 mythic-dialogue replacement topology. Generate only the selected pass from its declared canonical start or the accepted decoded tail of the immediately previous pass. Do not reload an obsolete V3 intermediate after an A/B expansion. The selected pass duration is authoritative. Bind only the matching approved Qwen master WAV when the pass declares speech; picture-only passes contain no intelligible dialogue. Jesus remains unseen and unheard throughout H02."
  ].filter(Boolean).join("\n\n");
}

function preservationSnapshot(storyboard, targetClipIds, existingTargetSegmentIds, existingFrameIds) {
  const targetSet = new Set(targetClipIds);
  const existingSegmentSet = new Set(existingTargetSegmentIds);
  const existingFrameSet = new Set(existingFrameIds);
  const downstream = new Set(storyboard.chapterOrder.slice(storyboard.chapterOrder.indexOf("H02") + 1));
  const clips = {};
  for (const [id, clip] of Object.entries(storyboard.clips || {})) {
    if (targetSet.has(id)) continue;
    const value = clone(clip);
    if (downstream.has(chapterForClip(storyboard, clip))) delete value.timelineStartFrame;
    clips[id] = value;
  }
  return {
    root: stableHash(Object.fromEntries(Object.entries(storyboard).filter(([key]) => !["updatedAt", "runtimeFrames", "imports", "clips", "videoPlans", "segments", "frames"].includes(key)))),
    clips: stableHash(clips),
    plans: stableHash(Object.fromEntries(Object.entries(storyboard.videoPlans || {}).filter(([, plan]) => !targetSet.has(plan.clipId)))),
    oldSegments: stableHash(Object.fromEntries(Object.entries(storyboard.segments || {}).filter(([id]) => existingSegmentSet.has(id)))),
    oldFrames: stableHash(Object.fromEntries(Object.entries(storyboard.frames || {}).filter(([id]) => existingFrameSet.has(id)))),
    referenceBindings: stableHash(storyboard.referenceBindings || {})
  };
}

function assertPreserved(before, storyboard, targetClipIds, existingTargetSegmentIds, existingFrameIds) {
  const after = preservationSnapshot(storyboard, targetClipIds, existingTargetSegmentIds, existingFrameIds);
  for (const key of Object.keys(before)) if (before[key] !== after[key]) fail(`Out-of-scope storyboard data changed: ${key}`);
}

function makeDialogueCue(cue, packageData, now) {
  const clipId = cue.segmentId.replace(/-SEG.*$/, "");
  return {
    id: `h02_${String(cue.cueId).toLowerCase()}`,
    cueId: cue.cueId,
    segmentId: cue.segmentId,
    clipId,
    speaker: cue.speaker,
    character: cue.character,
    offScreen: Boolean(cue.offScreen),
    voiceLock: cue.voiceLock,
    text: cue.exactDialogue,
    exactDialogue: cue.exactDialogue,
    performanceDirection: cue.performanceDirection,
    pronunciationLocks: clone(cue.pronunciationLocks || []),
    targetVoiceDurationSec: Number(cue.targetVoiceDurationSec),
    targetVideoDurationSec: Number(cue.targetVideoDurationSec),
    pairId: cue.pairId || null,
    continuityGroupId: cue.continuityGroupId || null,
    seedLockTo: cue.seedLockTo || null,
    wrapperSeeds: clone(cue.qwenRender?.wrapperSeeds || [42, 43, 44]),
    expectedMasterFilename: cue.outputs?.masterFilename || null,
    auditionTakeFilenamePattern: cue.outputs?.auditionTakeFilenamePattern || null,
    status: "queued",
    progress: 0,
    provider: "qwenTts",
    engine: "Qwen3-TTS Base",
    batchJobId: EXTERNAL_BATCH_ID,
    sourcePackageId: PATCH_ID,
    sourceManifestSha256: packageData.fileHashes["H02_QWEN_CUE_MANIFEST.json"],
    createdAt: now,
    updatedAt: now
  };
}

function buildPatch(storyboard, project, projectRoot, packageData, validation, externalOutputRoot, now) {
  if (storyboard.schemaVersion !== "premiere316.storyboard.v1") fail(`Unexpected storyboard schema: ${storyboard.schemaVersion}`);
  if (storyboard.projectId !== PROJECT_SLUG || project.slug !== PROJECT_SLUG) fail("H02 import is restricted to harrowing_of_hell");
  if (storyboard.chapterOrder.indexOf("H02") < 0) fail("Storyboard chapter order does not contain H02");
  const next = clone(storyboard);
  const nextProject = clone(project);
  const targetClipIds = [...validation.rowsByClip.keys()];
  const clips = targetClipIds.map((id) => next.clips?.[id]).filter(Boolean).sort((left, right) => left.order - right.order);
  if (clips.length !== EXPECTED.clips || clips.map((clip) => clip.id).join("|") !== targetClipIds.join("|")) fail("Live H02 clip set/order differs from the authoritative package");
  const existingTargetSegmentIds = clips.flatMap((clip) => next.videoPlans?.[clip.videoPlanId]?.segmentIds || []);
  const existingFrameIds = Object.keys(next.frames || {});
  const before = preservationSnapshot(storyboard, targetClipIds, existingTargetSegmentIds, existingFrameIds);
  const h02StartFrame = Math.min(...clips.map((clip) => Number(clip.timelineStartFrame)));
  const downstreamChapters = new Set(next.chapterOrder.slice(next.chapterOrder.indexOf("H02") + 1));
  const downstreamClips = Object.values(next.clips).filter((clip) => downstreamChapters.has(chapterForClip(next, clip)));
  const downstreamStartBefore = Math.min(...downstreamClips.map((clip) => Number(clip.timelineStartFrame)));
  const oldH02End = Math.max(...clips.map((clip) => Number(clip.timelineStartFrame) + Number(clip.durationFrames)));
  if (oldH02End !== downstreamStartBefore) fail(`H02/downstream boundary is not contiguous before import: ${oldH02End} vs ${downstreamStartBefore}`);
  const oldH02DurationFrames = downstreamStartBefore - h02StartFrame;
  const deltaFrames = validation.totalFrames - oldH02DurationFrames;
  for (const clip of downstreamClips) clip.timelineStartFrame = Number(clip.timelineStartFrame) + deltaFrames;
  next.runtimeFrames = Number(next.runtimeFrames) + deltaFrames;
  const canonicalFrames = [];
  let chapterCursor = 0;
  for (const clip of clips) {
    const rows = validation.rowsByClip.get(clip.id);
    const plan = next.videoPlans?.[clip.videoPlanId];
    const firstFrame = next.frames?.[clip.firstFrameId];
    if (!plan || !firstFrame) fail(`Live H02 plan/canonical frame is missing for ${clip.id}`);
    const canonical = canonicalFrameEvidence(projectRoot, clip, firstFrame);
    canonicalFrames.push({ clipId: clip.id, ...canonical });
    const globalPrompt = cleanGlobalPrompt(plan.globalPrompt || plan.timelineData?.global_prompt, clip);
    const segmentIds = [];
    const timelineSegments = [];
    const passBindings = [];
    const dialogueLines = [];
    let clipCursor = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const fullId = renderId(row);
      const segmentId = `segment-${fullId.toLowerCase()}`;
      const frameId = index === 0 ? firstFrame.id : `frame-${fullId.toLowerCase()}-input`;
      const cue = validation.cueBySegment.get(fullId) || null;
      const binding = validation.bindingById.get(fullId);
      const prompt = validation.prompts.get(fullId);
      const lengthFrames = Number(binding.assembled_frame_count);
      const existing = next.segments?.[segmentId] || {};
      const audioCue = cue ? {
        cueId: cue.cueId,
        speaker: cue.speaker,
        character: cue.character,
        offScreen: Boolean(cue.offScreen),
        voiceLock: cue.voiceLock,
        exactDialogue: cue.exactDialogue,
        performanceDirection: cue.performanceDirection,
        targetVoiceDurationSec: Number(cue.targetVoiceDurationSec),
        targetVideoDurationSec: Number(cue.targetVideoDurationSec),
        expectedMasterFilename: cue.outputs?.masterFilename || null,
        authoritativeFile: null,
        qaStatus: "queued_qwen_three_takes"
      } : null;
      if (audioCue) dialogueLines.push(`${audioCue.speaker}: ${audioCue.exactDialogue}`);
      const segment = {
        ...existing,
        id: segmentId,
        videoPlanId: plan.id,
        order: index + 1,
        startFrame: clipCursor,
        lengthFrames,
        prompt,
        type: "image",
        isEndFrame: false,
        status: index === 0 ? "ready" : "blocked_missing_accepted_tail",
        referenceFiles: [],
        frameId,
        generatedVersions: clone(existing.generatedVersions || []),
        activeTakeId: existing.activeTakeId || null,
        activeGeneratedVersion: existing.activeGeneratedVersion || null,
        activeTakeFile: existing.activeTakeFile || null,
        activeTakeLocked: Boolean(existing.activeTakeLocked),
        global_prompt: globalPrompt,
        globalPrompt,
        mythicDialoguePass: {
          packageId: PATCH_ID,
          renderId: fullId,
          globalOrder: Number(row.global_order),
          renderSegment: row.render_segment,
          audioMode: row.audio_mode,
          cueId: row.cue_id || null,
          speaker: row.speaker,
          inputMode: row.input_mode,
          inputImage: normalizeRelative(binding.input_image),
          assembledFrameCount: lengthFrames,
          assembledRange: binding.assembled_range,
          handoffFrameIndex: Number(binding.handoff_frame_index),
          outputHandoff: normalizeRelative(binding.output_handoff),
          visualBeat: packageData.visualBeats.get(fullId).visualBeat,
          audioCue
        }
      };
      next.segments[segmentId] = segment;
      segmentIds.push(segmentId);
      if (index > 0) {
        const pending = next.frames?.[frameId] || {};
        const generatedVersions = clone(pending.generatedVersions || []);
        const hasTail = Boolean(pending.activeGeneratedVersion && generatedVersions.length);
        next.frames[frameId] = {
          ...pending,
          id: frameId,
          purpose: "segment_frame",
          ownerKind: "segment",
          ownerId: segmentId,
          prompt,
          negativePrompt: plan.negativePrompt || firstFrame.negativePrompt || "",
          status: hasTail ? pending.status || "generated" : "pending_accepted_decoded_tail",
          expectedInputPath: `Premiere316/${PROJECT_SLUG}/storyboard/${path.basename(binding.input_image)}`,
          generatedAssetId: pending.generatedAssetId || frameId,
          generatedAssetVersionId: pending.generatedAssetVersionId || null,
          inputHash: pending.inputHash || null,
          references: [],
          generatedVersions,
          activeGeneratedVersion: pending.activeGeneratedVersion || null,
          generatedFile: pending.generatedFile || null,
          generatedInputPath: pending.generatedInputPath || null,
          lastError: pending.lastError || null,
          continuityInput: {
            required: true,
            status: hasTail ? "generated_pending_acceptance_check" : "pending_accepted_decoded_tail",
            previousRenderId: renderId(rows[index - 1]),
            expectedSource: normalizeRelative(binding.input_image),
            decodedFrameIndex: Number(validation.bindingById.get(renderId(rows[index - 1])).handoff_frame_index)
          }
        };
      }
      const timelineSegment = {
        id: segmentId,
        start: clipCursor,
        length: lengthFrames,
        prompt,
        type: "image",
        isEndFrame: false,
        storyboardFrameId: frameId,
        guideStrength: Number(plan.guideStrength ?? 1),
        referenceFiles: [],
        expectedInputPath: normalizeRelative(binding.input_image),
        expectedOutputHandoff: normalizeRelative(binding.output_handoff),
        passType: row.audio_mode,
        speaker: row.speaker,
        audioCue
      };
      if (index === 0) {
        timelineSegment.imageFile = firstFrame.expectedInputPath || `Premiere316/${PROJECT_SLUG}/storyboard/${canonical.filename}`;
        timelineSegment.fileName = canonical.filename;
      }
      timelineSegments.push(timelineSegment);
      passBindings.push({
        renderId: fullId,
        segmentId,
        audioMode: row.audio_mode,
        cueId: row.cue_id || null,
        speaker: row.speaker,
        startFrame: clipCursor,
        lengthFrames,
        expectedMasterFilename: cue?.outputs?.masterFilename || null,
        authoritativeTrack: null,
        status: cue ? "queued_qwen_three_takes" : "picture_only"
      });
      clipCursor += lengthFrames;
    }
    clip.timelineStartFrame = h02StartFrame + chapterCursor;
    clip.durationFrames = clipCursor;
    clip.decodedFrames = clipCursor + 1;
    clip.trimDecodedFrames = 1;
    clip.dialogueAnchor = dialogueLines.join(" ");
    clip.renderStatus = "not_started";
    clip.renderError = null;
    clip.generationMode = "i2v_segmented_first_frames";
    clip.referenceMode = "segment_first_frames";
    clip.correctedPassCount = rows.length;
    clip.correctedPackageId = PATCH_ID;
    clip.audioPlan = {
      mode: dialogueLines.length ? "custom_dialogue_required" : "generated_ambience",
      status: dialogueLines.length ? "qwen_batch_running" : "needs_ambience_no_dialogue",
      dialogueText: dialogueLines.join(" "),
      voiceIdentityReferences: [],
      authoritativeTrack: null,
      authoritativeTracks: [],
      startFrame: 0,
      lengthFrames: clipCursor,
      instruction: "Bind only the exact selected H02 Qwen master WAV to its matching cue/pass. Jesus remains unheard. No extra voices, narration, or overlapping dialogue.",
      passBindings
    };
    plan.segmentIds = segmentIds;
    plan.globalPrompt = globalPrompt;
    plan.localPrompts = rows.map((row) => validation.prompts.get(renderId(row))).join(" | ");
    plan.segmentLengths = rows.map((row) => validation.bindingById.get(renderId(row)).assembled_frame_count).join(",");
    plan.timelineData = {
      ...(plan.timelineData || {}),
      mainTrackEnabled: true,
      audioTrackEnabled: true,
      motionTrackEnabled: true,
      overrideAudio: true,
      inpaint_audio: false,
      global_prompt: globalPrompt,
      normalStartFrame: 0,
      normalDurationFrames: clipCursor,
      segments: timelineSegments,
      motionSegments: [],
      audioSegments: []
    };
    plan.status = "needs_render";
    plan.inputHash = null;
    plan.generationMode = "i2v_segmented_first_frames";
    plan.workflowProfileId = "ltx-2.5-i2v-segmented-first-frame";
    plan.referenceMode = "segment_first_frames";
    plan.activeGeneratedVersion = null;
    plan.generatedFile = null;
    plan.generatedInputPath = null;
    plan.lastError = null;
    plan.audioMode = dialogueLines.length ? "custom_dialogue_required" : "generated_ambience";
    plan.audioPlan = clone(clip.audioPlan);
    plan.mythicDialoguePackage = {
      packageId: PATCH_ID,
      packageFingerprint: packageData.packageFingerprint,
      sourceArchive: SOURCE_ARCHIVE_NAME,
      sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
      passCount: rows.length,
      canonicalFrameId: firstFrame.id,
      canonicalFrameSha256: canonical.sha256,
      pendingAcceptedDecodedTails: rows.length - 1,
      importedAt: now
    };
    chapterCursor += clipCursor;
  }
  if (chapterCursor !== validation.totalFrames) fail(`Patched H02 duration differs from package: ${chapterCursor}`);
  next.updatedAt = now;
  next.imports = next.imports || {};
  next.imports[PATCH_ID] = {
    id: PATCH_ID,
    importedAt: now,
    packageRoot: packageData.packageRoot,
    packageFingerprint: packageData.packageFingerprint,
    packageFileHashes: packageData.fileHashes,
    sourceArchive: SOURCE_ARCHIVE_NAME,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    chapterId: "H02",
    clipCount: EXPECTED.clips,
    activePassCount: EXPECTED.passes,
    speechPassCount: EXPECTED.speech,
    picturePassCount: EXPECTED.picture,
    cueCount: EXPECTED.cues,
    chapterStartFrame: h02StartFrame,
    oldChapterDurationFrames: oldH02DurationFrames,
    correctedChapterDurationFrames: validation.totalFrames,
    correctedChapterDurationSec: validation.totalFrames / FPS,
    downstreamOffsetDeltaFrames: deltaFrames,
    legacyActiveSegmentIdsPreserved: existingTargetSegmentIds,
    canonicalFrames,
    audioStatus: "qwen_batch_running",
    acceptedTailStatus: "unresolved_not_generated",
    queueJobId: EXTERNAL_BATCH_ID,
    servicesRestarted: false
  };
  assertPreserved(before, next, targetClipIds, existingTargetSegmentIds, existingFrameIds);

  nextProject.sound = nextProject.sound && typeof nextProject.sound === "object" ? nextProject.sound : { schemaVersion: 2, voices: [], generations: [] };
  nextProject.sound.voices = Array.isArray(nextProject.sound.voices) ? nextProject.sound.voices : [];
  nextProject.sound.generations = Array.isArray(nextProject.sound.generations) ? nextProject.sound.generations : [];
  const unrelatedCues = Array.isArray(nextProject.sound.dialogueCues)
    ? nextProject.sound.dialogueCues.filter((cue) => cue.sourcePackageId !== PATCH_ID)
    : [];
  nextProject.sound.dialogueCues = [...packageData.cues.map((cue) => makeDialogueCue(cue, packageData, now)), ...unrelatedCues];
  nextProject.sound.dialogueBatches = Array.isArray(nextProject.sound.dialogueBatches)
    ? nextProject.sound.dialogueBatches.filter((batch) => batch.id !== EXTERNAL_BATCH_ID)
    : [];
  nextProject.sound.dialogueBatches.unshift({
    id: EXTERNAL_BATCH_ID,
    label: "H02 Qwen mythic dialogue",
    projectSlug: PROJECT_SLUG,
    provider: "qwenTts",
    engine: "Qwen3-TTS Base",
    status: "running",
    cueCount: EXPECTED.cues,
    selectedMasterCount: 0,
    wrapperSeeds: [42, 43, 44],
    auditionTakeCount: EXPECTED.cues * 3,
    inferenceUnitCount: 72,
    topologyPassCount: EXPECTED.passes,
    sourcePackageId: PATCH_ID,
    sourceManifestSha256: packageData.fileHashes["H02_QWEN_CUE_MANIFEST.json"],
    outputRoot: externalOutputRoot,
    statusFile: path.join(externalOutputRoot, "QA", "H02_BACKGROUND_QUEUE_STATUS.json"),
    usesComfyUi: false,
    createdAt: now,
    updatedAt: now
  });
  nextProject.sound.primaryProvider = "qwenTts";
  nextProject.updatedAt = now;
  return {
    storyboard: next,
    project: nextProject,
    summary: {
      patchId: PATCH_ID,
      h02StartFrame,
      oldH02DurationFrames,
      correctedH02DurationFrames: validation.totalFrames,
      correctedH02DurationSec: validation.totalFrames / FPS,
      downstreamStartBefore,
      downstreamStartAfter: downstreamStartBefore + deltaFrames,
      downstreamOffsetDeltaFrames: deltaFrames,
      activeClips: clips.length,
      activePasses: EXPECTED.passes,
      speechPasses: EXPECTED.speech,
      picturePasses: EXPECTED.picture,
      plannedDialogueCues: EXPECTED.cues,
      canonicalInputsReady: EXPECTED.clips,
      pendingAcceptedTailInputs: EXPECTED.passes - EXPECTED.clips,
      oldRenderedSegmentRecordsPreserved: existingTargetSegmentIds.length
    }
  };
}

function verifyImported(storyboard, project, packageData, validation) {
  const receipt = storyboard.imports?.[PATCH_ID];
  if (!receipt || receipt.packageFingerprint !== packageData.packageFingerprint) fail("H02 storyboard import receipt is missing or differs from the authoritative package");
  const clips = [...validation.rowsByClip.keys()].map((id) => storyboard.clips[id]);
  const segments = [];
  let ready = 0;
  let pending = 0;
  for (const clip of clips) {
    const plan = storyboard.videoPlans?.[clip.videoPlanId];
    const rows = validation.rowsByClip.get(clip.id);
    if (!plan || plan.segmentIds.length !== rows.length) fail(`H02 active plan is incomplete for ${clip.id}`);
    let cursor = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const expectedId = `segment-${renderId(row).toLowerCase()}`;
      const segment = storyboard.segments?.[plan.segmentIds[index]];
      if (!segment || segment.id !== expectedId) fail(`H02 segment order differs for ${renderId(row)}`);
      if (segment.startFrame !== cursor || segment.lengthFrames !== Number(validation.bindingById.get(renderId(row)).assembled_frame_count)) fail(`H02 segment timing differs for ${renderId(row)}`);
      if (sha256Text(segment.prompt) !== sha256Text(validation.prompts.get(renderId(row)))) fail(`H02 prompt differs for ${renderId(row)}`);
      if (/Silent picture pass\./i.test(segment.global_prompt || "")) fail(`H02 segment retains stale placeholder global prompt: ${segment.id}`);
      cursor += segment.lengthFrames;
      segments.push(segment);
      if (index === 0 && segment.status === "ready") ready += 1;
      if (index > 0 && segment.status === "blocked_missing_accepted_tail") pending += 1;
    }
    if (cursor !== clip.durationFrames || plan.timelineData?.normalDurationFrames !== cursor) fail(`H02 clip duration differs for ${clip.id}`);
  }
  if (segments.length !== EXPECTED.passes || ready !== EXPECTED.clips || pending !== EXPECTED.passes - EXPECTED.clips) fail("H02 ready/pending pass counts differ");
  const cues = (project.sound?.dialogueCues || []).filter((cue) => cue.sourcePackageId === PATCH_ID);
  if (cues.length !== EXPECTED.cues) fail(`Expected ${EXPECTED.cues} visible H02 dialogue cues; received ${cues.length}`);
  for (const source of packageData.cues) {
    const saved = cues.find((cue) => cue.cueId === source.cueId);
    if (!saved || saved.segmentId !== source.segmentId || saved.exactDialogue !== source.exactDialogue || saved.performanceDirection !== source.performanceDirection) fail(`Visible H02 cue differs for ${source.cueId}`);
  }
  const h02Start = Math.min(...clips.map((clip) => clip.timelineStartFrame));
  const h02End = Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames));
  if (h02End - h02Start !== EXPECTED.durationFrames) fail("Imported H02 runtime differs from the package");
  const downstream = new Set(storyboard.chapterOrder.slice(storyboard.chapterOrder.indexOf("H02") + 1));
  const downstreamStart = Math.min(...Object.values(storyboard.clips).filter((clip) => downstream.has(chapterForClip(storyboard, clip))).map((clip) => clip.timelineStartFrame));
  if (downstreamStart !== h02End) fail("Imported H02/downstream boundary is not contiguous");
  return {
    clips: clips.length,
    passes: segments.length,
    speechPasses: segments.filter((segment) => segment.mythicDialoguePass?.audioMode === "SPEECH").length,
    picturePasses: segments.filter((segment) => segment.mythicDialoguePass?.audioMode === "PICTURE_ONLY").length,
    visibleDialogueCues: cues.length,
    canonicalInputsReady: ready,
    pendingAcceptedTailInputs: pending,
    durationFrames: h02End - h02Start,
    durationSec: (h02End - h02Start) / FPS,
    downstreamStartFrame: downstreamStart,
    packageFingerprint: packageData.packageFingerprint
  };
}

function copyAuthoritativePackage(args, packageData, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const copied = [];
  for (const name of REQUIRED_PACKAGE_FILES) {
    const source = packageData.files[name];
    const destination = path.join(destinationRoot, name);
    const expected = packageData.fileHashes[name];
    if (fs.existsSync(destination)) {
      if (sha256File(destination) !== expected) fail(`Refusing to overwrite a different authoritative package member: ${destination}`);
    } else fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (sha256File(destination) !== expected) fail(`Copied authoritative package member failed verification: ${name}`);
    copied.push({ name, sha256: expected, bytes: fs.statSync(destination).size });
  }
  if (args.archive && fs.existsSync(args.archive)) {
    const destination = path.join(destinationRoot, SOURCE_ARCHIVE_NAME);
    if (fs.existsSync(destination)) {
      if (sha256File(destination) !== SOURCE_ARCHIVE_SHA256) fail(`Refusing to overwrite a different source ZIP: ${destination}`);
    } else fs.copyFileSync(args.archive, destination, fs.constants.COPYFILE_EXCL);
    copied.push({ name: SOURCE_ARCHIVE_NAME, sha256: SOURCE_ARCHIVE_SHA256, bytes: fs.statSync(destination).size });
  }
  return copied;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const storyboardFile = path.join(args.projectRoot, "production", "storyboard.json");
  const projectFile = path.join(args.projectRoot, "project.json");
  if (!fs.existsSync(storyboardFile) || !fs.existsSync(projectFile)) fail(`Live Harrowing project files are missing under ${args.projectRoot}`);
  const packageData = readPackage(args.packageRoot, args.archive);
  const validation = validatePackage(packageData);
  const storyboardBytes = fs.readFileSync(storyboardFile);
  const projectBytes = fs.readFileSync(projectFile);
  const storyboardSha256 = sha256Buffer(storyboardBytes);
  const projectSha256 = sha256Buffer(projectBytes);
  const storyboard = JSON.parse(storyboardBytes.toString("utf8"));
  const project = JSON.parse(projectBytes.toString("utf8"));
  if (args.expectedStoryboardSha256 && storyboardSha256 !== args.expectedStoryboardSha256) fail(`Live storyboard changed after audit: expected ${args.expectedStoryboardSha256}, received ${storyboardSha256}`);
  if (args.verifyOnly || storyboard.imports?.[PATCH_ID]) {
    const verification = verifyImported(storyboard, project, packageData, validation);
    process.stdout.write(`${JSON.stringify({ mode: "verify", storyboardSha256, projectSha256, verification }, null, 2)}\n`);
    return;
  }
  const now = new Date().toISOString();
  const built = buildPatch(storyboard, project, args.projectRoot, packageData, validation, args.externalOutputRoot, now);
  const audit = {
    mode: args.apply ? "apply" : "audit",
    storyboardFile,
    projectFile,
    currentStoryboardSha256: storyboardSha256,
    currentProjectSha256: projectSha256,
    packageRoot: args.packageRoot,
    packageFingerprint: packageData.packageFingerprint,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    packageValidation: {
      clips: validation.rowsByClip.size,
      passes: packageData.renderRows.length,
      frameBindings: packageData.frameBindings.length,
      visualPrompts: validation.prompts.size,
      cues: packageData.cues.length,
      speechPasses: validation.speech,
      picturePasses: validation.picture,
      durationFrames: validation.totalFrames,
      durationSec: validation.totalFrames / FPS
    },
    proposed: built.summary
  };
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    return;
  }
  if (!args.expectedStoryboardSha256) fail("--apply requires --expected-storyboard-sha256 from a fresh --audit run");
  if (sha256File(storyboardFile) !== storyboardSha256 || sha256File(projectFile) !== projectSha256) fail("Live project changed before backup; import aborted");
  const backupRoot = path.join(args.projectRoot, "production", "backups", "h02-mythic-dialogue", timestampForPath());
  const authoritativeRoot = path.join(args.projectRoot, "production", "h02-mythic-dialogue-v1", "authoritative");
  if (fs.existsSync(backupRoot)) fail(`Backup directory already exists: ${backupRoot}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  const storyboardBackup = path.join(backupRoot, "storyboard.before.json");
  const projectBackup = path.join(backupRoot, "project.before.json");
  fs.copyFileSync(storyboardFile, storyboardBackup, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(projectFile, projectBackup, fs.constants.COPYFILE_EXCL);
  if (sha256File(storyboardBackup) !== storyboardSha256 || sha256File(projectBackup) !== projectSha256) fail("Live project backup hash verification failed");
  const copiedPackage = copyAuthoritativePackage(args, packageData, authoritativeRoot);
  built.storyboard.imports[PATCH_ID].backupRoot = normalizeRelative(path.relative(args.projectRoot, backupRoot));
  built.storyboard.imports[PATCH_ID].authoritativePackageRoot = normalizeRelative(path.relative(args.projectRoot, authoritativeRoot));
  built.project.sound.dialogueBatches[0].authoritativePackageRoot = normalizeRelative(path.relative(args.projectRoot, authoritativeRoot));
  let wrote = false;
  try {
    if (sha256File(storyboardFile) !== storyboardSha256 || sha256File(projectFile) !== projectSha256) fail("Live project changed after backup; import aborted");
    writeJsonAtomic(storyboardFile, built.storyboard);
    writeJsonAtomic(projectFile, built.project);
    wrote = true;
    const savedStoryboard = readJson(storyboardFile);
    const savedProject = readJson(projectFile);
    const verification = verifyImported(savedStoryboard, savedProject, packageData, validation);
    const report = {
      ...audit,
      backupRoot,
      authoritativeRoot,
      copiedPackage,
      savedStoryboardSha256: sha256File(storyboardFile),
      savedProjectSha256: sha256File(projectFile),
      verification
    };
    writeJsonAtomic(path.join(backupRoot, "apply-report.json"), report);
    writeJsonAtomic(path.join(backupRoot, "backup-manifest.json"), {
      schemaVersion: 1,
      patchId: PATCH_ID,
      createdAt: now,
      files: [
        { liveFile: storyboardFile, backupFile: storyboardBackup, sha256: storyboardSha256, bytes: storyboardBytes.length },
        { liveFile: projectFile, backupFile: projectBackup, sha256: projectSha256, bytes: projectBytes.length }
      ],
      recovery: "Restore storyboard.before.json and project.before.json atomically to their live paths. Authoritative package copies may remain because they are immutable and hash-verified."
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (wrote) {
      const restoreErrors = [];
      try { writeBufferAtomic(storyboardFile, fs.readFileSync(storyboardBackup)); } catch (restoreError) { restoreErrors.push(restoreError); }
      try { writeBufferAtomic(projectFile, fs.readFileSync(projectBackup)); } catch (restoreError) { restoreErrors.push(restoreError); }
      if (restoreErrors.length) throw new AggregateError([error, ...restoreErrors], "H02 import failed and rollback was not completely clean");
    }
    throw error;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}

