import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { graphToApi } from "../server/comfy.js";
import {
  buildSegmentJobs,
  flattenWorkflow,
  ltxFrameCount,
  mergeWorkspace,
  patchPrompt,
  validatePrompt,
  workspaceForClient,
  workspaceFromWorkflow
} from "./workflow-compiler.mjs";
import {
  buildMusicVideoSequencePlan,
  buildMusicVideoShotJob,
  createMusicVideoSequenceRecord,
  markMusicVideoShotAccepted,
  markMusicVideoShotSaved,
  musicVideoOutputPrefixes,
  patchMusicVideoSequencePrompt,
  sequenceHistoryOutputs,
  workspaceFromMusicVideoManifest
} from "./music-video-sequence.mjs";
import {
  findDirectorRenderByPrompt,
  markDirectorRender,
  mediaKind,
  nextStoryboardRenderVersion,
  projectCatalog,
  projectJobs,
  projectOverview,
  resolveProjectMedia,
  sceneReferenceMedia,
  storyboardPlanFingerprint,
  syncWorkspaceToPremiere,
  upsertProjectJob,
  workspaceForProjectClip
} from "./premiere-projects.mjs";
import { findClip, loadProject, mediaDir, saveProject } from "../server/projects.js";
import { projectDir } from "../server/paths.js";
import { registerStoryboardHandoffFrame } from "../server/storyboard-generation.js";
import { concatPreparedVideosWithSoundtrack, probeMediaExact, trimVideoToFrames } from "../server/ffmpeg.js";
import { ensureDirectoryMiddleware } from "./upload-dir.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const STATE_DIR = path.join(HERE, "state");
const STATE_FILE = path.join(STATE_DIR, "workspace.local.json");
const DEFAULT_SOURCE = path.join(os.homedir(), "Downloads", "LTX2.5_DIRECTOR.json");
const SOURCE_WORKFLOW = path.resolve(process.env.DIRECTOR_WORKFLOW_PATH || DEFAULT_SOURCE);
const MUSIC_VIDEO_WORKFLOW = path.resolve(process.env.DIRECTOR_MUSIC_VIDEO_WORKFLOW_PATH || path.join(
  HERE,
  "..",
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "LTX 2.5 Music Video",
  "LTX25_MUSIC_VIDEO_24GB_60s_BLOCK_6x10s_DIRECTOR.json"
));
const HOST = "127.0.0.1";
const PORT = Number(process.env.DIRECTOR_PORT || 8791);
const UPLOAD_DIR = path.join(os.tmpdir(), "premiere316-director-uploads");
const COMFY_AUDIO_OUTPUT_ROOT = path.resolve(HERE, "..", "BlokeyUI", "ComfyUI", "output", "audio");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
const ensureUploadDir = ensureDirectoryMiddleware(UPLOAD_DIR);

let sourceGraph = null;
let sourceText = "";
let workspace = null;
let objectInfoCache = { url: "", at: 0, value: null };
const directorJobs = new Map();
const musicVideoRuns = new Map();
let directorMonitor = null;
let directorMonitorBusy = false;
let musicVideoMonitor = null;
let musicVideoMonitorBusy = false;

function readSource() {
  if (!fs.existsSync(SOURCE_WORKFLOW)) throw new Error(`Director workflow not found: ${SOURCE_WORKFLOW}`);
  sourceText = fs.readFileSync(SOURCE_WORKFLOW, "utf8");
  sourceGraph = JSON.parse(sourceText);
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function readJsonMaybe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function quarantinePath(root, stem) {
  return path.join(root, `${stem}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.orphan.mp4`);
}

function loadWorkspace() {
  readSource();
  if (fs.existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      const fresh = workspaceFromWorkflow(sourceGraph, sourceText);
      if (saved?.source?.sha256 === fresh.source.sha256) return mergeWorkspace(fresh, saved);
    } catch (error) {
      console.warn(`[Director] Ignoring invalid local state: ${error.message}`);
    }
  }
  return workspaceFromWorkflow(sourceGraph, sourceText);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `${response.status} ${response.statusText}`);
  return body;
}

function comfyUrl() {
  return String(workspace.settings.comfyUrl || "http://127.0.0.1:8188").replace(/\/$/, "");
}

async function getObjectInfo(force = false) {
  const url = comfyUrl();
  if (!force && objectInfoCache.value && objectInfoCache.url === url && Date.now() - objectInfoCache.at < 300_000) {
    return objectInfoCache.value;
  }
  const value = await fetchJson(`${url}/object_info`);
  objectInfoCache = { url, at: Date.now(), value };
  return value;
}

async function compile(workspaceValue = workspace, job = null, forceObjectInfo = false) {
  const objectInfo = await getObjectInfo(forceObjectInfo);
  const flat = flattenWorkflow(sourceGraph);
  const converted = graphToApi(flat, objectInfo);
  if (converted.warnings.length) throw new Error(converted.warnings.join("; "));
  const patched = patchPrompt(converted.prompt, workspaceValue, job);
  const errors = validatePrompt(patched.prompt, objectInfo);
  if (errors.length) throw new Error(errors.join("; "));
  return { ...patched, nodeCount: Object.keys(patched.prompt).length, flatNodeCount: flat.nodes.length, flatLinkCount: flat.links.length };
}

function readMusicVideoWorkflow() {
  if (!fs.existsSync(MUSIC_VIDEO_WORKFLOW)) throw new Error(`Music-video workflow not found: ${MUSIC_VIDEO_WORKFLOW}`);
  const text = fs.readFileSync(MUSIC_VIDEO_WORKFLOW, "utf8");
  return {
    text,
    graph: JSON.parse(text),
    sha256: crypto.createHash("sha256").update(text).digest("hex")
  };
}

async function compileMusicVideo(workspaceValue, job, expectedWorkflowSha256 = null) {
  const source = readMusicVideoWorkflow();
  if (expectedWorkflowSha256 && source.sha256 !== expectedWorkflowSha256) {
    throw staleRenderError("The LTX 2.5 music-video workflow changed while this durable sequence was running");
  }
  const objectInfo = await getObjectInfo();
  const flat = flattenWorkflow(source.graph);
  const converted = graphToApi(flat, objectInfo);
  if (converted.warnings.length) throw new Error(converted.warnings.join("; "));
  const patched = patchPrompt(converted.prompt, workspaceValue, job);
  const errors = validatePrompt(patched.prompt, objectInfo);
  if (errors.length) throw new Error(errors.join("; "));
  return { ...patched, workflowSha256: source.sha256 };
}

function mediaParts(file) {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return { filename: path.posix.basename(normalized), subfolder: path.posix.dirname(normalized) === "." ? "" : path.posix.dirname(normalized) };
}

async function uploadSmall(filePath, originalName, subfolder = "whatdreamscost") {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(filePath)]), originalName);
  form.append("subfolder", subfolder);
  form.append("type", "input");
  form.append("overwrite", "true");
  const result = await fetchJson(`${comfyUrl()}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(10 * 60_000) });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

async function uploadLargeVideo(filePath, originalName, size) {
  const safeName = `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const chunkSize = 50 * 1024 * 1024;
  const totalChunks = Math.ceil(size / chunkSize);
  const handle = fs.openSync(filePath, "r");
  let finalResult = null;
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const bytes = Math.min(chunkSize, size - index * chunkSize);
      const buffer = Buffer.allocUnsafe(bytes);
      fs.readSync(handle, buffer, 0, bytes, index * chunkSize);
      const form = new FormData();
      form.append("file", new Blob([buffer]), safeName);
      form.append("filename", safeName);
      form.append("chunk_index", String(index));
      form.append("total_chunks", String(totalChunks));
      finalResult = await fetchJson(`${comfyUrl()}/ltx_director_upload_chunk`, { method: "POST", body: form, signal: AbortSignal.timeout(10 * 60_000) });
    }
  } finally {
    fs.closeSync(handle);
  }
  return finalResult?.name || finalResult?.file || safeName;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

const projectUploadCache = new Map();

async function prepareProjectMedia(workspaceValue) {
  const prepared = structuredClone(workspaceValue);
  const slug = prepared.premiere?.projectSlug;
  if (!slug) return prepared;
  const prepareOne = async (segment, targetField) => {
    if (!segment?.projectMediaPath) return;
    const disk = resolveProjectMedia(slug, segment.projectMediaPath);
    const stat = fs.statSync(disk);
    const digest = await hashFile(disk);
    if (segment.projectMediaBytes && Number(segment.projectMediaBytes) !== stat.size) {
      throw new Error(`Premiere guide changed on disk: ${segment.projectMediaPath} has ${stat.size} bytes; expected ${segment.projectMediaBytes}`);
    }
    if (segment.projectMediaSha256 && String(segment.projectMediaSha256).toLowerCase() !== digest.toLowerCase()) {
      throw new Error(`Premiere guide changed on disk: ${segment.projectMediaPath} no longer matches its approved generated version`);
    }
    const key = `${comfyUrl()}|${disk}|${stat.size}|${digest}`;
    let comfyFile = projectUploadCache.get(key);
    if (!comfyFile) {
      const safeName = `${slug}_${path.basename(disk)}`.replace(/[^a-zA-Z0-9 ._()-]/g, "_");
      const kind = mediaKind(segment.projectMediaPath);
      comfyFile = kind === "video" && stat.size > 50 * 1024 * 1024
        ? await uploadLargeVideo(disk, safeName, stat.size)
        : await uploadSmall(disk, safeName, `Premiere316/${slug}/${String(segment.projectMediaPath).split("/")[1] || "assets"}`);
      projectUploadCache.set(key, comfyFile);
    }
    segment[targetField] = comfyFile;
    segment.fileName ||= path.basename(disk);
    segment.projectMediaBytes = stat.size;
    segment.projectMediaSha256 = digest;
  };
  for (const segment of prepared.timeline?.segments || []) {
    if (segment.type === "image") await prepareOne(segment, "imageFile");
    else if (segment.type === "video") await prepareOne(segment, "videoFile");
  }
  for (const segment of prepared.timeline?.audioSegments || []) {
    await prepareOne(segment, "audioFile");
  }
  for (const segment of prepared.timeline?.motionSegments || []) {
    await prepareOne(segment, "videoFile");
  }
  return prepared;
}

function collectOutputRefs(outputs) {
  const refs = [];
  for (const node of Object.values(outputs || {})) {
    for (const key of ["videos", "video", "gifs", "images", "audio"]) {
      for (const ref of Array.isArray(node?.[key]) ? node[key] : []) {
        if (ref?.filename) refs.push(ref);
      }
    }
  }
  return refs;
}

async function downloadComfyOutput(ref, destination) {
  const url = new URL(`${comfyUrl()}/view`);
  url.searchParams.set("filename", ref.filename);
  url.searchParams.set("subfolder", ref.subfolder || "");
  url.searchParams.set("type", ref.type || "output");
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) throw new Error(`Could not download ComfyUI output (${response.status})`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    if (!response.body) throw new Error("ComfyUI output response had no body");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: "wx" }));
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeOutputStem(value) {
  return String(value || "scene").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "scene";
}

function relativeProjectMedia(file, slug) {
  const root = path.resolve(mediaDir(slug, ""));
  const resolved = path.resolve(file);
  if (!resolved.toLowerCase().startsWith(`${root}${path.sep}`.toLowerCase())) {
    throw new Error("Music-video media escaped the selected Premiere project's media directory");
  }
  return `media/${path.relative(root, resolved).replace(/\\/g, "/")}`;
}

function assertContainedRealFile(file, root, label) {
  const resolved = path.resolve(String(file || ""));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`${label} not found: ${resolved}`);
  const realRoot = fs.realpathSync.native(path.resolve(root));
  const realFile = fs.realpathSync.native(resolved);
  if (!realFile.toLowerCase().startsWith(`${realRoot}${path.sep}`.toLowerCase())) {
    throw new Error(`${label} must stay under ${realRoot}`);
  }
  return realFile;
}

async function pinMusicVideoSoundtrack(slug, input = {}) {
  let source;
  let existingRelative = null;
  if (input.projectMediaPath) {
    existingRelative = String(input.projectMediaPath);
    source = resolveProjectMedia(slug, existingRelative);
  } else {
    source = assertContainedRealFile(input.sourceAudioFile, COMFY_AUDIO_OUTPUT_ROOT, "Source soundtrack");
  }
  if (!/\.(flac|wav|aif|aiff|mp3|m4a|ogg)$/i.test(source)) {
    throw new Error("Music-video soundtrack must be a supported audio file");
  }
  const sourceStat = fs.statSync(source);
  const sha256 = await hashFile(source);
  if (existingRelative) {
    return {
      projectMediaPath: existingRelative.replace(/\\/g, "/"),
      fileName: path.basename(source),
      bytes: sourceStat.size,
      sha256,
      importedFrom: null
    };
  }
  const extension = path.extname(source).toLowerCase();
  const destinationName = `${safeOutputStem(path.parse(source).name)}.${sha256.slice(0, 12)}${extension}`;
  const destination = path.join(mediaDir(slug, "audio"), destinationName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    const destinationStat = fs.statSync(destination);
    const destinationHash = await hashFile(destination);
    if (destinationStat.size !== sourceStat.size || destinationHash.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`Pinned soundtrack destination already exists with different bytes: ${destinationName}`);
    }
  } else {
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      const copiedHash = await hashFile(temporary);
      if (copiedHash.toLowerCase() !== sha256.toLowerCase()) throw new Error("Pinned soundtrack copy failed SHA-256 verification");
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
  }
  return {
    projectMediaPath: relativeProjectMedia(destination, slug),
    fileName: destinationName,
    bytes: sourceStat.size,
    sha256,
    importedFrom: source
  };
}

function frameRateNumber(value) {
  const text = String(value || "0");
  const [numerator, denominator = "1"] = text.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function staleRenderError(message) {
  const error = new Error(message);
  error.code = "STALE_RENDER";
  return error;
}

function assertFinalDirectorMedia(info, { frames, fps, width, height, expectAudio }) {
  const finalFrames = Number(info.video?.nb_frames || 0);
  if (!info.video || !Number.isFinite(finalFrames) || finalFrames !== frames) {
    throw new Error(`Conformed output has ${finalFrames || "unknown"} frames; expected ${frames}`);
  }
  const finalRate = frameRateNumber(info.video.avg_frame_rate || info.video.r_frame_rate);
  if (!Number.isFinite(finalRate) || Math.abs(finalRate - fps) > 0.001) {
    throw new Error(`Conformed output is ${finalRate || "unknown"} fps; expected ${fps}`);
  }
  const expectedDuration = frames / fps;
  const tolerance = Math.max(0.15, 3 / fps);
  const finalDuration = Number(info.video.duration || info.durationSec || 0);
  if (!finalDuration || Math.abs(finalDuration - expectedDuration) > tolerance) {
    throw new Error(`Conformed output duration is ${finalDuration || "unknown"}s; expected approximately ${expectedDuration.toFixed(4)}s`);
  }
  if (Number(info.video.width) !== Number(width) || Number(info.video.height) !== Number(height)) {
    throw new Error(`Generated video is ${info.video.width}x${info.video.height}; expected ${width}x${height}`);
  }
  if (expectAudio) {
    if (!info.audio) throw new Error("The Director workflow requires audio, but the generated video has no audio stream");
    const sampleRate = Number(info.audio.sample_rate || 0);
    const channels = Number(info.audio.channels || 0);
    if (sampleRate !== 48000 || channels !== 2) {
      throw new Error(`Generated audio is ${sampleRate || "unknown"} Hz/${channels || "unknown"} channels; expected 48000 Hz stereo`);
    }
    const audioDuration = Number(info.audio.duration || info.durationSec || 0);
    if (!audioDuration || Math.abs(audioDuration - expectedDuration) > tolerance) {
      throw new Error(`Generated audio duration is ${audioDuration || "unknown"}s; expected approximately ${expectedDuration.toFixed(4)}s`);
    }
  }
}

function registerSequenceOutput(binding, fileName, promptId, mode, segmentId, expectedVersion = null, provenance = {}) {
  const project = loadProject(binding.projectSlug);
  const clip = findClip(project, binding.clipId);
  if (!clip) throw new Error("Premiere sequence clip disappeared before output registration");
  clip.versions = Array.isArray(clip.versions) ? clip.versions : [];
  const version = Math.max(0, ...clip.versions.map((item) => Number(item.v) || 0)) + 1;
  if (expectedVersion && version !== Number(expectedVersion)) throw new Error(`Sequence render version changed from v${expectedVersion} to v${version} before registration`);
  clip.versions.push({
    ...provenance,
    v: version,
    file: fileName,
    name: path.parse(fileName).name,
    source: "ltx25-director-webapp",
    promptId,
    mode,
    segmentId: segmentId || null,
    createdAt: new Date().toISOString()
  });
  clip.activeVersion = version;
  clip.status = "done";
  saveProject(project);
  return version;
}

function persistMusicVideoRun(run) {
  musicVideoRuns.set(run.id, run);
  upsertProjectJob(run.projectSlug, run);
  return run;
}

function failMusicVideoRun(run, error) {
  const message = String(error?.message || error || "Music-video sequence failed");
  run.status = "error";
  run.stage = "Failed";
  run.error = message;
  run.finishedAt = new Date().toISOString();
  if (run.refs?.binding?.source === "storyboard" && run.refs.binding.clipId) {
    const status = error?.code === "STALE_RENDER" ? "stale" : "error";
    try { markDirectorRender(run.projectSlug, run.refs.binding, { status, error: message, promptId: run.id }); } catch {}
  }
  try { upsertProjectJob(run.projectSlug, run); } catch {}
  musicVideoRuns.delete(run.id);
}

function musicVideoTempRoot(run) {
  return path.join(mediaDir(run.projectSlug, "temp"), "director-music-video", safeOutputStem(run.id));
}

async function verifyPinnedFile(file, pinned, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is missing: ${file}`);
  const stat = fs.statSync(file);
  if (pinned?.bytes && Number(pinned.bytes) !== stat.size) throw new Error(`${label} byte count changed from ${pinned.bytes} to ${stat.size}`);
  const sha256 = await hashFile(file);
  if (pinned?.sha256 && String(pinned.sha256).toLowerCase() !== sha256.toLowerCase()) throw new Error(`${label} SHA-256 no longer matches its run ledger`);
  return { file, bytes: stat.size, sha256 };
}

async function materializeMusicVideoOutput(ref, destination, pinned = null) {
  if (!fs.existsSync(destination)) await downloadComfyOutput(ref, destination);
  return await verifyPinnedFile(destination, pinned, "Music-video shot output");
}

function sequencePromptStatus(entry) {
  const status = entry?.status || {};
  if (status.status_str === "error" || status.status_str === "interrupted") {
    const messages = (status.messages || [])
      .flatMap((item) => Array.isArray(item) ? item.slice(1) : [])
      .map((item) => item?.exception_message || item?.message)
      .filter(Boolean);
    return { state: "error", error: messages.join("; ") || `ComfyUI ${status.status_str}` };
  }
  return { state: status.completed ? "done" : "running", error: null };
}

async function queueMusicVideoShot(runValue, shotIndex, guideFile = null) {
  let run = runValue;
  if (run.refs?.binding?.source === "storyboard-sequence") validateManifestFingerprints(run);
  const shot = run.refs.shots[shotIndex];
  if (!shot) throw new Error(`Music-video shot ${shotIndex + 1} does not exist`);
  const job = buildMusicVideoShotJob(run.refs.workspace, run.refs.plan, shotIndex, guideFile);
  const built = await compileMusicVideo(run.refs.workspace, job, run.refs.musicVideoWorkflowSha256);
  const patched = patchMusicVideoSequencePrompt(built.prompt, run.id, shot);
  const validation = validatePrompt(patched.prompt, await getObjectInfo());
  if (validation.length) throw new Error(validation.join("; "));

  shot.status = "submitting";
  shot.outputPrefixes = patched.prefixes;
  shot.submissionStartedAt = new Date().toISOString();
  run.refs.currentShotIndex = shotIndex;
  run.status = "queued";
  run.stage = `Submitting shot ${shotIndex + 1} of ${run.refs.shots.length}`;
  persistMusicVideoRun(run);

  const result = await fetchJson(`${comfyUrl()}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: patched.prompt, client_id: crypto.randomUUID() }),
    signal: AbortSignal.timeout(60_000)
  });
  run = markMusicVideoShotAccepted(run, shotIndex, result.prompt_id, patched.prefixes);
  persistMusicVideoRun(run);
  beginMusicVideoMonitor();
  return run;
}

async function processMusicVideoShot(runValue, historyEntry) {
  let run = runValue;
  if (run.refs?.binding?.source === "storyboard-sequence") validateManifestFingerprints(run);
  const shotIndex = Number(run.refs.currentShotIndex) || 0;
  const shot = run.refs.shots[shotIndex];
  const refs = sequenceHistoryOutputs(historyEntry);
  const tempRoot = musicVideoTempRoot(run);
  fs.mkdirSync(tempRoot, { recursive: true });
  const stem = `shot_${String(shotIndex + 1).padStart(3, "0")}`;
  const videoDisk = path.join(tempRoot, `${stem}.mp4`);
  const handoffExtension = path.extname(refs.handoff.filename).toLowerCase() || ".png";
  const handoffDisk = path.join(tempRoot, `${stem}_boundary${handoffExtension}`);
  const videoPinned = await materializeMusicVideoOutput(refs.video, videoDisk, shot.video);
  const videoInfo = await probeMediaExact(videoDisk);
  assertFinalDirectorMedia(videoInfo, {
    frames: shot.requestedFrames,
    fps: run.refs.plan.fps,
    width: run.refs.plan.width,
    height: run.refs.plan.height,
    expectAudio: false
  });
  const handoffPinned = await materializeMusicVideoOutput(refs.handoff, handoffDisk, shot.handoff);
  if (!handoffPinned.bytes) throw new Error("Music-video boundary frame is empty");

  run = markMusicVideoShotSaved(run, shotIndex, {
    video: {
      file: relativeProjectMedia(videoDisk, run.projectSlug),
      bytes: videoPinned.bytes,
      sha256: videoPinned.sha256,
      mediaInfo: videoInfo,
      comfyRef: refs.video
    },
    handoff: {
      file: relativeProjectMedia(handoffDisk, run.projectSlug),
      bytes: handoffPinned.bytes,
      sha256: handoffPinned.sha256,
      comfyRef: refs.handoff
    }
  });
  persistMusicVideoRun(run);

  if (shotIndex + 1 < run.refs.shots.length) {
    let handoffUploadDisk = handoffDisk;
    const nextShot = run.refs.shots[shotIndex + 1];
    if (run.refs.binding.source === "storyboard-sequence") {
      if (!nextShot.manifestClipId) throw new Error(`Music-video manifest shot ${nextShot.id} has no storyboard clip id for its handoff frame`);
      const registered = registerStoryboardHandoffFrame(run.projectSlug, nextShot.manifestClipId, {
        buffer: fs.readFileSync(handoffDisk),
        extension: handoffExtension,
        sourceClipId: shot.manifestClipId || null,
        sourcePromptId: shot.promptId,
        sourceOutputNodeId: "201",
        sourceFrameIndex: shot.requestedFrames,
        sourceRunId: run.id,
        sourceShotId: shot.id,
        workflowHash: run.refs.musicVideoWorkflowSha256
      });
      run.refs.shots[shotIndex].handoffStoryboard = {
        targetClipId: nextShot.manifestClipId,
        frameId: registered.frame.id,
        file: registered.projectMediaPath,
        version: registered.version,
        sha256: registered.sha256,
        idempotent: Boolean(registered.idempotent)
      };
      run.refs.clipFingerprints[nextShot.manifestClipId] = storyboardPlanFingerprint(run.projectSlug, nextShot.manifestClipId);
      handoffUploadDisk = resolveProjectMedia(run.projectSlug, registered.projectMediaPath);
      persistMusicVideoRun(run);
    }
    const comfyFile = await uploadSmall(
      handoffUploadDisk,
      `${safeOutputStem(run.id)}_${stem}_boundary${handoffExtension}`,
      `Premiere316/${run.projectSlug}/director-music-video/${safeOutputStem(run.id)}`
    );
    run.refs.shots[shotIndex].handoffComfyFile = comfyFile;
    persistMusicVideoRun(run);
    return await queueMusicVideoShot(run, shotIndex + 1, comfyFile);
  }
  return await finalizeMusicVideoRun(run);
}

function validateManifestFingerprints(run) {
  const fingerprints = run.refs?.clipFingerprints || {};
  for (const [clipId, expected] of Object.entries(fingerprints)) {
    if (storyboardPlanFingerprint(run.projectSlug, clipId) !== expected) {
      throw staleRenderError(`Storyboard music-video clip ${clipId} changed while this sequence was rendering`);
    }
  }
}

function registerMusicVideoMaster(run, fileName, version, provenance) {
  const project = loadProject(run.projectSlug);
  project.masters = Array.isArray(project.masters) ? project.masters : [];
  const existing = project.masters.find((item) => item.runId === run.id);
  if (existing) {
    if (existing.file !== fileName || Number(existing.v) !== Number(version)) {
      throw new Error(`Music-video run ${run.id} is already registered as a different project master`);
    }
    return existing.v;
  }
  if (project.masters.some((item) => Number(item.v) === Number(version))) throw new Error(`Project master version v${version} already exists`);
  project.masters.push({
    ...provenance,
    v: version,
    file: fileName,
    name: path.parse(fileName).name,
    source: "ltx25-director-music-video",
    createdAt: new Date().toISOString()
  });
  project.activeMasterVersion = version;
  saveProject(project);
}

async function finalizeMusicVideoRun(run) {
  validateManifestFingerprints(run);
  const binding = run.refs.binding;
  const isManifest = binding.source === "storyboard-sequence";
  if (!run.refs.finalization) {
    let version;
    if (isManifest) {
      const project = loadProject(run.projectSlug);
      version = Math.max(0, ...(project.masters || []).map((item) => Number(item.v) || 0)) + 1;
    } else if (binding.source === "storyboard") {
      version = nextStoryboardRenderVersion(run.projectSlug, binding.clipId);
    } else {
      const project = loadProject(run.projectSlug);
      const clip = findClip(project, binding.clipId);
      version = Math.max(0, ...(clip?.versions || []).map((item) => Number(item.v) || 0)) + 1;
    }
    const stem = isManifest ? `${safeOutputStem(run.projectSlug)}_music_video` : `${safeOutputStem(binding.clipId)}_music_video`;
    run.refs.finalization = {
      version,
      destinationKind: isManifest ? "masters" : "clips",
      fileName: `${stem}_v${String(version).padStart(2, "0")}.mp4`,
      startedAt: new Date().toISOString()
    };
  }
  run.status = "finalizing";
  run.stage = "Concatenating shot pictures and applying the original soundtrack";
  persistMusicVideoRun(run);

  const finalization = run.refs.finalization;
  const soundtrackDisk = resolveProjectMedia(run.projectSlug, run.refs.soundtrack.projectMediaPath);
  await verifyPinnedFile(soundtrackDisk, run.refs.soundtrack, "Original music-video soundtrack");
  const shotDisks = [];
  for (const shot of run.refs.shots) {
    if (shot.status !== "done" || !shot.video?.file) throw new Error(`Music-video shot ${shot.index + 1} is not safely materialized`);
    const disk = resolveProjectMedia(run.projectSlug, shot.video.file);
    await verifyPinnedFile(disk, shot.video, `Music-video shot ${shot.index + 1}`);
    shotDisks.push(disk);
  }
  const totalFrames = run.refs.plan.requestedFrames;
  const destination = path.join(mediaDir(run.projectSlug, finalization.destinationKind), finalization.fileName);
  const staged = path.join(musicVideoTempRoot(run), `${path.parse(finalization.fileName).name}.ready.mp4`);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  if (fs.existsSync(destination) && (!run.refs.finalization.sha256 || !run.refs.finalization.bytes)) {
    throw new Error(`Music-video destination already exists without this run's validated finalization record: ${finalization.fileName}`);
  }
  if (!fs.existsSync(destination)) {
    if (!fs.existsSync(staged)) {
      await concatPreparedVideosWithSoundtrack(shotDisks, soundtrackDisk, staged, {
        frames: totalFrames,
        fps: run.refs.plan.fps,
        audioStartFrame: run.refs.plan.startFrame
      });
    }
    const stagedInfo = await probeMediaExact(staged);
    assertFinalDirectorMedia(stagedInfo, {
      frames: totalFrames,
      fps: run.refs.plan.fps,
      width: run.refs.plan.width,
      height: run.refs.plan.height,
      expectAudio: true
    });
    const pinned = await verifyPinnedFile(staged, null, "Final music-video staging file");
    run.refs.finalization = { ...finalization, bytes: pinned.bytes, sha256: pinned.sha256, mediaInfo: stagedInfo, readyAt: new Date().toISOString() };
    persistMusicVideoRun(run);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(staged, destination);
  }
  const finalPinned = await verifyPinnedFile(destination, run.refs.finalization, "Final music-video master");
  const mediaInfo = await probeMediaExact(destination);
  assertFinalDirectorMedia(mediaInfo, {
    frames: totalFrames,
    fps: run.refs.plan.fps,
    width: run.refs.plan.width,
    height: run.refs.plan.height,
    expectAudio: true
  });
  validateManifestFingerprints(run);
  const provenance = {
    mediaType: "video",
    runId: run.id,
    fps: run.refs.plan.fps,
    width: run.refs.plan.width,
    height: run.refs.plan.height,
    durationFrames: totalFrames,
    durationSec: totalFrames / run.refs.plan.fps,
    soundtrack: { ...run.refs.soundtrack },
    manifest: run.refs.manifest ? { ...run.refs.manifest } : null,
    storyboardClipIds: binding.clipIds || (binding.clipId ? [binding.clipId] : []),
    shotPromptIds: run.refs.shots.map((shot) => shot.promptId),
    shotFiles: run.refs.shots.map((shot) => ({ id: shot.id, file: shot.video.file, sha256: shot.video.sha256, bytes: shot.video.bytes })),
    mediaInfo,
    fileHashes: [{ file: finalization.fileName, sha256: finalPinned.sha256, bytes: finalPinned.bytes, extension: ".mp4" }]
  };
  const existingClipRender = isManifest ? null : await findDirectorRenderByPrompt(run.projectSlug, binding, run.id);
  if (existingClipRender && !existingClipRender.valid) {
    throw new Error(`This music-video run is already registered with invalid Premiere media: ${existingClipRender.error}`);
  }
  if (isManifest) {
    registerMusicVideoMaster(run, finalization.fileName, finalization.version, provenance);
  } else if (existingClipRender) {
    if (path.basename(existingClipRender.file) !== finalization.fileName) {
      throw new Error(`Music-video run ${run.id} is already registered as ${existingClipRender.file}`);
    }
  } else if (binding.source === "storyboard") {
    markDirectorRender(run.projectSlug, binding, {
      status: "done",
      version: {
        ...provenance,
        v: finalization.version,
        file: `media/clips/${finalization.fileName}`,
        outputFile: finalization.fileName,
        source: "ltx25-director-music-video",
        workflowId: "ltx25-director-music-video",
        comfyPromptId: run.id,
        generationFingerprint: run.refs.generationFingerprint,
        createdAt: new Date().toISOString()
      },
      expectedFingerprint: run.refs.generationFingerprint,
      promptId: run.id
    });
  } else {
    registerSequenceOutput(binding, finalization.fileName, run.id, "music-video-sequence", null, finalization.version, provenance);
  }
  run.status = "done";
  run.stage = "Registered music video in Premiere project";
  run.progress = 1;
  run.error = null;
  run.finishedAt = new Date().toISOString();
  run.result = {
    file: `media/${finalization.destinationKind}/${finalization.fileName}`,
    version: finalization.version,
    frames: totalFrames,
    soundtrackSha256: run.refs.soundtrack.sha256
  };
  upsertProjectJob(run.projectSlug, run);
  musicVideoRuns.delete(run.id);
  return run;
}

function promptIdFromQueue(queue, prefix) {
  for (const group of [queue?.queue_running || [], queue?.queue_pending || []]) {
    for (const entry of group) {
      if (JSON.stringify(entry).includes(prefix)) return String(Array.isArray(entry) ? entry[1] : entry.prompt_id || entry.promptId || "") || null;
    }
  }
  return null;
}

async function recoverSubmittingMusicVideoShot(run) {
  const index = Number(run.refs.currentShotIndex) || 0;
  const shot = run.refs.shots[index];
  const prefix = shot.outputPrefixes?.video || musicVideoOutputPrefixes(run.id, index).video;
  const [history, queue] = await Promise.all([
    fetchJson(`${comfyUrl()}/history?max_items=200`),
    fetchJson(`${comfyUrl()}/queue`)
  ]);
  const historyMatch = Object.entries(history || {}).find(([, entry]) => JSON.stringify(entry?.prompt || entry).includes(prefix));
  const promptId = historyMatch?.[0] || promptIdFromQueue(queue, prefix);
  if (promptId) {
    const recovered = markMusicVideoShotAccepted(run, index, promptId, shot.outputPrefixes || musicVideoOutputPrefixes(run.id, index));
    recovered.refs.shots[index].recoveredAt = new Date().toISOString();
    return persistMusicVideoRun(recovered);
  }
  if (Date.now() - new Date(shot.submissionStartedAt || run.createdAt).getTime() >= 60_000) {
    throw new Error("Could not recover the ComfyUI prompt accepted during a Director restart; no duplicate shot was submitted")
  }
  return run;
}

async function monitorMusicVideoRuns() {
  if (musicVideoMonitorBusy) return;
  musicVideoMonitorBusy = true;
  try {
    let queueSnapshot = null;
    for (let run of [...musicVideoRuns.values()]) {
      try {
        if (run.status === "finalizing") {
          await finalizeMusicVideoRun(run);
          continue;
        }
        const index = Number(run.refs.currentShotIndex) || 0;
        let shot = run.refs.shots[index];
        if (shot.status === "submitting" && !shot.promptId) {
          run = await recoverSubmittingMusicVideoShot(run);
          shot = run.refs.shots[index];
          if (!shot.promptId) continue;
        }
        if (!shot.promptId) throw new Error(`Music-video shot ${index + 1} has no tracked ComfyUI prompt`);
        const history = await fetchJson(`${comfyUrl()}/history/${encodeURIComponent(shot.promptId)}`);
        const entry = history?.[shot.promptId];
        if (!entry) {
          queueSnapshot ||= await fetchJson(`${comfyUrl()}/queue`);
          const stillQueued = JSON.stringify(queueSnapshot).includes(String(shot.promptId));
          if (stillQueued) {
            if (shot.historyMissingSince) {
              delete shot.historyMissingSince;
              persistMusicVideoRun(run);
            }
            continue;
          }
          if (!shot.historyMissingSince) {
            shot.historyMissingSince = new Date().toISOString();
            run.stage = `Waiting for ComfyUI history recovery for shot ${index + 1}`;
            persistMusicVideoRun(run);
            continue;
          }
          if (Date.now() - new Date(shot.historyMissingSince).getTime() >= 60_000) {
            throw staleRenderError(`ComfyUI no longer has music-video shot ${index + 1} in its queue or history`);
          }
          continue;
        }
        const status = sequencePromptStatus(entry);
        if (status.state === "error") throw new Error(status.error);
        if (status.state === "done") {
          await processMusicVideoShot(run, entry);
          continue;
        }
        if (run.status !== "running" || shot.status !== "running") {
          run.status = "running";
          shot.status = "running";
          run.stage = `Generating shot ${index + 1} of ${run.refs.shots.length} in ComfyUI`;
          run.progress = index / run.refs.shots.length;
          persistMusicVideoRun(run);
        }
      } catch (error) {
        failMusicVideoRun(run, error);
      }
    }
  } finally {
    musicVideoMonitorBusy = false;
  }
}

function beginMusicVideoMonitor() {
  if (musicVideoMonitor) return;
  musicVideoMonitor = setInterval(() => { monitorMusicVideoRuns().catch((error) => console.warn(`[Director] music-video monitor: ${error.message}`)); }, 2500);
  musicVideoMonitor.unref?.();
}

async function completeDirectorJob(job, historyEntry) {
  const binding = job.refs.binding;
  const expectedFrames = Math.max(1, Number(job.refs.requestedFrames) || 1);
  const expectedFps = Math.max(1, Number(job.refs.fps) || 24);
  const recordedGenerationFrames = Math.max(0, Number(job.refs.generationFrames) || 0);
  const alignedGenerationFrames = ltxFrameCount(expectedFrames);
  if (recordedGenerationFrames > 0 && recordedGenerationFrames !== alignedGenerationFrames) {
    throw new Error(`Director job ledger says ${recordedGenerationFrames} generation frames, but ${expectedFrames} requested frames require ${alignedGenerationFrames} on the LTX 8n+1 grid`);
  }
  const expectedGenerationFrames = recordedGenerationFrames || alignedGenerationFrames;
  const expectedMedia = {
    frames: expectedFrames,
    fps: expectedFps,
    width: Number(job.refs.width),
    height: Number(job.refs.height),
    expectAudio: Boolean(job.refs.expectAudio)
  };
  const promptStem = safeOutputStem(job.refs.promptId).slice(0, 64);
  const tempRoot = mediaDir(binding.projectSlug, "temp");
  const journalPath = path.join(tempRoot, `${promptStem}.director-finalizing.json`);
  const existing = await findDirectorRenderByPrompt(binding.projectSlug, binding, job.refs.promptId);
  if (existing) {
    if (!existing.valid) throw new Error(`Premiere has a render record for this prompt, but its media is invalid: ${existing.error}`);
    const existingInfo = await probeMediaExact(existing.disk);
    assertFinalDirectorMedia(existingInfo, expectedMedia);
    const journalData = readJsonMaybe(journalPath);
    if (journalData?.promptId === job.refs.promptId) {
      try { fs.rmSync(journalPath, { force: true }); } catch {}
    }
    const finishedAt = new Date().toISOString();
    job.status = "done";
    job.progress = 1;
    job.stage = "Already registered in Premiere project";
    job.finishedAt = finishedAt;
    job.result = { file: existing.file, clipId: binding.clipId, version: existing.version, idempotent: true };
    upsertProjectJob(binding.projectSlug, job);
    directorJobs.delete(job.id);
    return;
  }
  if (!historyEntry.outputs?.["94"]) throw new Error("Expected final ComfyUI output node 94 is missing; preview outputs will not be registered");
  const refs = collectOutputRefs({ "94": historyEntry.outputs["94"] });
  const videoRef = refs.find((ref) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(ref.filename));
  if (!videoRef) throw new Error("ComfyUI completed without a video output");
  if (binding.source === "storyboard" && storyboardPlanFingerprint(binding.projectSlug, binding.clipId) !== job.refs.generationFingerprint) {
    throw staleRenderError("The Premiere scene plan changed while this render was running. The ComfyUI output was not attached to the newer scene version.");
  }
  const recoveryJournal = readJsonMaybe(journalPath);
  if (fs.existsSync(journalPath) && (
    !recoveryJournal
    || recoveryJournal.promptId !== job.refs.promptId
    || recoveryJournal.projectSlug !== binding.projectSlug
    || recoveryJournal.clipId !== binding.clipId
    || recoveryJournal.generationFingerprint !== job.refs.generationFingerprint
  )) {
    throw new Error("A mismatched or corrupt Director finalization journal blocks safe recovery for this prompt");
  }
  let version = 1;
  if (binding.source === "storyboard") version = nextStoryboardRenderVersion(binding.projectSlug, binding.clipId);
  else {
    const project = loadProject(binding.projectSlug);
    const clip = findClip(project, binding.clipId);
    version = Math.max(0, ...(clip?.versions || []).map((item) => Number(item.v) || 0)) + 1;
  }
  const suffix = job.refs.segmentId ? `_${safeOutputStem(job.refs.segmentId)}` : "";
  const sourceExtension = path.extname(videoRef.filename) || ".mp4";
  const extension = ".mp4";
  const fileName = `${safeOutputStem(binding.clipId)}${suffix}_director_v${String(version).padStart(2, "0")}${extension}`;
  const destinationKind = "clips";
  const destination = path.join(mediaDir(binding.projectSlug, destinationKind), fileName);
  const raw = path.join(tempRoot, `${path.parse(fileName).name}.${promptStem}.raw${sourceExtension}`);
  const staged = path.join(tempRoot, `${path.parse(fileName).name}.${promptStem}.ready.mp4`);
  const recoveryCandidates = recoveryJournal ? [
    recoveryJournal.targetFileName ? path.join(mediaDir(binding.projectSlug, destinationKind), path.basename(recoveryJournal.targetFileName)) : null,
    recoveryJournal.fileName ? path.join(mediaDir(binding.projectSlug, destinationKind), path.basename(recoveryJournal.fileName)) : null,
    recoveryJournal.previousFileName ? path.join(mediaDir(binding.projectSlug, destinationKind), path.basename(recoveryJournal.previousFileName)) : null,
    recoveryJournal.stagedFile ? path.join(tempRoot, path.basename(recoveryJournal.stagedFile)) : null,
    recoveryJournal.previousStagedFile ? path.join(tempRoot, path.basename(recoveryJournal.previousStagedFile)) : null
  ].filter(Boolean) : [];
  let rawFrames = 0;
  let mediaInfo;
  let fileStat;
  let fileSha256;
  let promoted = false;
  try {
    const recoverySource = recoveryCandidates.find((candidate) => fs.existsSync(candidate)) || null;
    if (recoverySource) {
      fileStat = fs.statSync(recoverySource);
      fileSha256 = await hashFile(recoverySource);
      if (!fileStat.size || Number(recoveryJournal.bytes) !== fileStat.size || String(recoveryJournal.sha256 || "").toLowerCase() !== fileSha256.toLowerCase()) {
        throw new Error(`The recoverable Director output for ${job.refs.promptId} no longer matches its finalization journal`);
      }
      mediaInfo = await probeMediaExact(recoverySource);
      assertFinalDirectorMedia(mediaInfo, expectedMedia);
      rawFrames = Number(recoveryJournal.generationFrames) || expectedGenerationFrames;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (path.resolve(recoverySource).toLowerCase() !== path.resolve(destination).toLowerCase()) {
        if (fs.existsSync(destination)) throw new Error(`Output destination already exists: ${fileName}`);
        atomicWrite(journalPath, {
          ...recoveryJournal,
          previousFileName: recoveryJournal.fileName || null,
          previousStagedFile: recoveryJournal.stagedFile || null,
          targetFileName: fileName,
          targetVersion: version,
          movePreparedAt: new Date().toISOString()
        });
        fs.renameSync(recoverySource, destination);
      }
      atomicWrite(journalPath, {
        ...recoveryJournal,
        version,
        fileName,
        stagedFile: null,
        previousFileName: null,
        previousStagedFile: null,
        targetFileName: null,
        targetVersion: null,
        bytes: fileStat.size,
        sha256: fileSha256,
        recoveredAt: new Date().toISOString()
      });
      promoted = true;
    } else {
      if (recoveryJournal) {
        try { fs.rmSync(journalPath, { force: true }); } catch {}
      }
      if (fs.existsSync(destination)) throw new Error(`Output destination already exists without a matching Director finalization journal: ${fileName}`);
      try { fs.rmSync(raw, { force: true }); } catch {}
      try { fs.rmSync(staged, { force: true }); } catch {}
      await downloadComfyOutput(videoRef, raw);
      const rawInfo = await probeMediaExact(raw);
      if (!rawInfo.video) throw new Error("ComfyUI output does not contain a video stream");
      if (job.refs.expectAudio && !rawInfo.audio) throw new Error("ComfyUI output does not contain the audio stream required by output node 94");
      rawFrames = Number(rawInfo.video.nb_frames || 0);
      if (!Number.isFinite(rawFrames) || rawFrames !== expectedGenerationFrames) {
        throw new Error(`Generated output has ${rawFrames || "unknown"} frames; expected the LTX-aligned ${expectedGenerationFrames} frames for a ${expectedFrames}-frame Premiere scene`);
      }
      const rawRate = frameRateNumber(rawInfo.video.avg_frame_rate || rawInfo.video.r_frame_rate);
      const rawAudioMismatch = Boolean(job.refs.expectAudio) && (
        Number(rawInfo.audio?.sample_rate || 0) !== 48000
        || Number(rawInfo.audio?.channels || 0) !== 2
        || Math.abs(Number(rawInfo.audio?.duration || rawInfo.durationSec || 0) - (expectedFrames / expectedFps)) > Math.max(0.15, 3 / expectedFps)
      );
      const needsConform = rawFrames !== expectedFrames || Math.abs(rawRate - expectedFps) > 0.001 || sourceExtension.toLowerCase() !== ".mp4" || rawAudioMismatch;
      if (needsConform) await trimVideoToFrames(raw, staged, expectedFrames, expectedFps);
      else fs.renameSync(raw, staged);
      try { fs.rmSync(raw, { force: true }); } catch {}
      mediaInfo = await probeMediaExact(staged);
      assertFinalDirectorMedia(mediaInfo, expectedMedia);
      fileStat = fs.statSync(staged);
      if (!fileStat.size) throw new Error("Conformed output is empty");
      fileSha256 = await hashFile(staged);
      if (binding.source === "storyboard" && storyboardPlanFingerprint(binding.projectSlug, binding.clipId) !== job.refs.generationFingerprint) {
        const quarantine = quarantinePath(tempRoot, `${path.parse(fileName).name}.${promptStem}`);
        try { fs.renameSync(staged, quarantine); } catch {}
        throw staleRenderError("The Premiere scene plan changed while this render was being conformed. The validated output was retained in staging but was not attached to the newer scene version.");
      }
      atomicWrite(journalPath, {
        schema: "premiere316.director-finalization/v1",
        projectSlug: binding.projectSlug,
        clipId: binding.clipId,
        promptId: job.refs.promptId,
        generationFingerprint: job.refs.generationFingerprint,
        version,
        fileName,
        stagedFile: path.basename(staged),
        bytes: fileStat.size,
        sha256: fileSha256,
        requestedFrames: expectedFrames,
        generationFrames: rawFrames,
        fps: expectedFps,
        createdAt: new Date().toISOString()
      });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(staged, destination);
      promoted = true;
    }
  const createdAt = new Date().toISOString();
    try {
      if (binding.source === "storyboard") {
    markDirectorRender(binding.projectSlug, binding, {
      status: job.refs.mode === "timeline" ? "done" : "partial",
      version: {
        v: version,
        files: [fileName],
        file: `media/clips/${fileName}`,
        outputFile: fileName,
        mediaType: "video",
        source: "ltx25-director-webapp",
        workflowId: "ltx25-director-webapp",
        workflowHash: job.refs.sourceHash,
        sourceWorkflowHash: job.refs.sourceHash,
        comfyPromptId: job.refs.promptId,
        outputNodeId: "94",
        generationFingerprint: job.refs.generationFingerprint,
        timelineHash: job.refs.timelineHash,
        promptHash: job.refs.promptHash,
        mode: job.refs.mode,
        segmentId: job.refs.segmentId || null,
        fps: job.refs.fps,
        width: job.refs.width,
        height: job.refs.height,
        durationFrames: expectedFrames,
        requestedFrames: expectedFrames,
        generationFrames: rawFrames,
        generationRequestedFrames: expectedGenerationFrames,
        segmentIds: job.refs.segmentIds,
        mediaInfo,
        fileHashes: [{ file: fileName, sha256: fileSha256, bytes: fileStat.size, extension }],
        createdAt
      },
      expectedFingerprint: job.refs.generationFingerprint,
      promptId: job.refs.promptId
        });
      } else {
        registerSequenceOutput(binding, fileName, job.refs.promptId, job.refs.mode, job.refs.segmentId, version, {
          mediaType: "video",
          outputNodeId: "94",
          fps: expectedFps,
          width: Number(job.refs.width),
          height: Number(job.refs.height),
          durationFrames: expectedFrames,
          requestedFrames: expectedFrames,
          generationFrames: rawFrames,
          mediaInfo,
          fileHashes: [{ file: fileName, sha256: fileSha256, bytes: fileStat.size, extension }]
        });
      }
      try { fs.rmSync(journalPath, { force: true }); } catch {}
    } catch (error) {
      if (promoted && fs.existsSync(destination)) {
        const quarantine = quarantinePath(tempRoot, `${path.parse(fileName).name}.${promptStem}`);
        try { fs.renameSync(destination, quarantine); promoted = false; } catch {}
      }
      try { fs.rmSync(journalPath, { force: true }); } catch {}
      throw error;
    }
  job.status = "done";
  job.progress = 1;
  job.stage = "Registered in Premiere project";
  job.finishedAt = createdAt;
  job.result = { file: `media/${destinationKind}/${fileName}`, clipId: binding.clipId, version };
  upsertProjectJob(binding.projectSlug, job);
  directorJobs.delete(job.id);
  } finally {
    try { fs.rmSync(raw, { force: true }); } catch {}
    try { fs.rmSync(staged, { force: true }); } catch {}
  }
}

function failDirectorJob(job, error) {
  const message = String(error?.message || error || "Director generation failed");
  job.status = "error";
  job.stage = "Failed";
  job.error = message;
  job.finishedAt = new Date().toISOString();
  const binding = job.refs.binding;
  if (binding?.source === "storyboard" && job.refs.mode === "timeline") {
    const status = error?.code === "STALE_RENDER" ? "stale" : "error";
    try { markDirectorRender(binding.projectSlug, binding, { status, error: message, promptId: job.refs.promptId }); } catch {}
  }
  if (binding?.projectSlug) {
    try { upsertProjectJob(binding.projectSlug, job); } catch {}
  }
  directorJobs.delete(job.id);
}

async function monitorDirectorJobs() {
  if (directorMonitorBusy) return;
  directorMonitorBusy = true;
  try {
    let queueSnapshot = null;
    for (const job of [...directorJobs.values()]) {
      try {
      const history = await fetchJson(`${comfyUrl()}/history/${encodeURIComponent(job.refs.promptId)}`);
      const entry = history?.[job.refs.promptId];
      if (!entry) {
        queueSnapshot ||= await fetchJson(`${comfyUrl()}/queue`);
        const stillQueued = JSON.stringify(queueSnapshot).includes(String(job.refs.promptId));
        if (stillQueued) {
          if (job.refs.historyMissingSince) {
            delete job.refs.historyMissingSince;
            upsertProjectJob(job.projectSlug, job);
          }
          continue;
        }
        const now = Date.now();
        if (!job.refs.historyMissingSince) {
          job.refs.historyMissingSince = new Date(now).toISOString();
          job.stage = "Waiting for ComfyUI history recovery";
          upsertProjectJob(job.projectSlug, job);
          continue;
        }
        if (now - new Date(job.refs.historyMissingSince).getTime() >= 60_000) {
          failDirectorJob(job, staleRenderError("ComfyUI no longer has this render in its queue or history. The lost attempt was released so the Premiere scene can be generated again."));
        }
        continue;
      }
      if (job.refs.historyMissingSince) delete job.refs.historyMissingSince;
      const status = entry.status || {};
      if (status.status_str === "error" || status.status_str === "interrupted") {
        const messages = (status.messages || []).flatMap((item) => Array.isArray(item) ? item.slice(1) : []).map((item) => item?.exception_message || item?.message).filter(Boolean);
        failDirectorJob(job, messages.join("; ") || `ComfyUI ${status.status_str}`);
        continue;
      }
      if (status.completed) {
        try { await completeDirectorJob(job, entry); }
        catch (error) { failDirectorJob(job, error); }
        continue;
      }
      if (job.status !== "running") {
        job.status = "running";
        job.stage = "Generating in ComfyUI";
        job.progress = 0.1;
        upsertProjectJob(job.projectSlug, job);
      }
      } catch (error) {
        console.warn(`[Director] Could not inspect ${job.refs.promptId}: ${error.message}`);
      }
    }
  } finally {
    directorMonitorBusy = false;
  }
}

function beginDirectorMonitor() {
  if (directorMonitor) return;
  directorMonitor = setInterval(() => { monitorDirectorJobs().catch((error) => console.warn(`[Director] monitor: ${error.message}`)); }, 2500);
  directorMonitor.unref?.();
}

function musicVideoManifestPaths(slug, manifestId = null) {
  // loadProject validates the slug and ensures this path cannot escape the
  // repository-owned project directory.
  const project = loadProject(slug);
  if (manifestId) {
    const safeId = String(manifestId);
    if (!/^[a-zA-Z0-9_-]+$/.test(safeId)) throw new Error("Invalid music-video manifest id");
    return [
      path.join(projectDir(project.slug), "production", "music-video", safeId, "manifest.json"),
      path.join(projectDir(project.slug), "production", "music-video", safeId, "music-video-manifest.json"),
      path.join(projectDir(project.slug), "production", "music-videos", `${safeId}.music-video.json`)
    ];
  }
  return [path.join(projectDir(project.slug), "production", "music-video-manifest.json")];
}

function readMusicVideoManifest(slug, manifestId = null) {
  const candidates = musicVideoManifestPaths(slug, manifestId);
  const file = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  const manifest = readJsonMaybe(file);
  if (!manifest) throw new Error(`Music-video manifest not found or invalid: ${file}`);
  if (manifest.projectSlug && String(manifest.projectSlug) !== String(slug)) {
    throw new Error(`Music-video manifest belongs to ${manifest.projectSlug}, not ${slug}`);
  }
  const source = fs.readFileSync(file);
  return {
    file,
    manifest,
    bytes: source.byteLength,
    sha256: crypto.createHash("sha256").update(source).digest("hex")
  };
}

function assertManifestStoryboardClips(slug, clipIds) {
  const available = new Set((projectOverview(slug).storyboard?.clips || []).map((clip) => String(clip.id)));
  const missing = (clipIds || []).filter((clipId) => !available.has(String(clipId)));
  if (missing.length) throw new Error(`Music-video manifest references missing storyboard clips: ${missing.join(", ")}`);
}

async function startMusicVideoSequence(input = {}) {
  let sequenceWorkspace;
  let binding;
  let manifestFile = null;
  let manifestDefinition = null;
  const useManifest = Boolean(input.useProjectManifest || input.manifest);
  if (useManifest) {
    const slug = String(input.projectSlug || input.manifest?.projectSlug || "");
    if (!slug) throw new Error("projectSlug is required for a project music-video manifest");
    const loaded = input.manifest
      ? {
          file: null,
          manifest: input.manifest,
          bytes: Buffer.byteLength(JSON.stringify(input.manifest)),
          sha256: crypto.createHash("sha256").update(JSON.stringify(input.manifest)).digest("hex")
        }
      : readMusicVideoManifest(slug, input.manifestId || null);
    if (loaded.manifest.projectSlug && String(loaded.manifest.projectSlug) !== slug) {
      throw new Error(`Music-video manifest belongs to ${loaded.manifest.projectSlug}, not ${slug}`);
    }
    manifestFile = loaded.file;
    manifestDefinition = loaded.manifest;
    sequenceWorkspace = workspaceFromMusicVideoManifest(workspace, loaded.manifest);
    const clipIds = sequenceWorkspace.manifest.clipIds;
    assertManifestStoryboardClips(slug, clipIds);
    binding = {
      source: "storyboard-sequence",
      projectSlug: slug,
      clipIds,
      manifestId: sequenceWorkspace.manifest.id
    };
    binding.manifestSha256 = loaded.sha256;
    binding.manifestBytes = loaded.bytes;
  } else {
    if (!workspace.premiere?.projectSlug || !workspace.premiere?.clipId) {
      throw new Error("Load a Premiere scene before starting a music-video sequence");
    }
    sequenceWorkspace = structuredClone(workspace);
    binding = structuredClone(workspace.premiere);
  }

  const bindingClipIds = binding.clipIds || [binding.clipId];
  const activeDirector = [...directorJobs.values()].find((job) =>
    ["queued", "running"].includes(job.status)
    && job.refs?.binding?.projectSlug === binding.projectSlug
    && bindingClipIds.includes(job.refs?.binding?.clipId)
  );
  if (activeDirector) throw new Error(`A Director render is already active for ${activeDirector.refs.binding.clipId} (${activeDirector.refs.promptId})`);
  const activeMusic = [...musicVideoRuns.values()].find((run) => {
    if (!["queued", "running", "finalizing"].includes(run.status) || run.projectSlug !== binding.projectSlug) return false;
    const activeIds = run.refs?.binding?.clipIds || [run.refs?.binding?.clipId];
    return activeIds.some((clipId) => bindingClipIds.includes(clipId));
  });
  if (activeMusic) throw new Error(`Music-video sequence ${activeMusic.id} is already active for this storyboard range`);

  const initialPlan = buildMusicVideoSequencePlan(sequenceWorkspace, input);
  if (sequenceWorkspace.manifest && Number(sequenceWorkspace.manifest.totalFrames) !== Number(initialPlan.endFrame)) {
    throw new Error(`Music-video manifest declares ${sequenceWorkspace.manifest.totalFrames} frames, but its contiguous shots end at ${initialPlan.endFrame}`);
  }
  const soundtrackInput = {
    ...(manifestDefinition?.audioSource || manifestDefinition?.soundtrack || {}),
    ...input
  };
  if (!soundtrackInput.sourceAudioFile && soundtrackInput.sourceFile) soundtrackInput.sourceAudioFile = soundtrackInput.sourceFile;
  const soundtrack = await pinMusicVideoSoundtrack(binding.projectSlug, soundtrackInput);
  const soundtrackDisk = resolveProjectMedia(binding.projectSlug, soundtrack.projectMediaPath);
  const audioInfo = await probeMediaExact(soundtrackDisk);
  if (!audioInfo.audio) throw new Error("Pinned music-video soundtrack does not contain an audio stream");
  const sourceDurationSec = Number(audioInfo.audio.duration || audioInfo.durationSec || 0);
  const requiredEndSec = initialPlan.endFrame / initialPlan.fps;
  if (!sourceDurationSec || requiredEndSec - sourceDurationSec > 1) {
    throw new Error(`Music-video timeline ends at ${requiredEndSec.toFixed(3)}s, but the source soundtrack is only ${sourceDurationSec.toFixed(3)}s`);
  }
  soundtrack.durationSec = sourceDurationSec;
  soundtrack.sampleRate = Number(audioInfo.audio.sample_rate || 0);
  soundtrack.channels = Number(audioInfo.audio.channels || 0);
  soundtrack.padEndSec = Math.max(0, requiredEndSec - sourceDurationSec);

  sequenceWorkspace.timeline.audioTrackEnabled = true;
  sequenceWorkspace.timeline.inpaint_audio = false;
  sequenceWorkspace.timeline.audioSegments = [{
    id: `music-audio-${soundtrack.sha256.slice(0, 12)}`,
    type: "audio",
    start: 0,
    // The final LTX shot also needs its 8n+1 lookahead sample window. The
    // Director audio builder returns a fixed-duration zero-padded waveform,
    // so a soundtrack that ends fractionally before this boundary remains
    // deterministic and the final master can still use the untouched FLAC.
    length: Math.max(initialPlan.endFrame + 1, Math.round(sourceDurationSec * initialPlan.fps)),
    trimStart: 0,
    audioFile: soundtrack.fileName,
    fileName: soundtrack.fileName,
    projectMediaPath: soundtrack.projectMediaPath,
    projectMediaBytes: soundtrack.bytes,
    projectMediaSha256: soundtrack.sha256
  }];
  sequenceWorkspace.settings.useCustomAudio = true;
  sequenceWorkspace.settings.inpaintAudio = false;
  sequenceWorkspace.settings.overrideAudio = false;
  sequenceWorkspace.settings.queueMode = "music-video-sequence";

  const prepared = await prepareProjectMedia(sequenceWorkspace);
  const plan = buildMusicVideoSequencePlan(prepared, input);
  const id = newId("director_music");
  let run = createMusicVideoSequenceRecord({
    id,
    binding,
    plan,
    workspace: workspaceForClient(prepared),
    soundtrack
  });
  run.refs.musicVideoWorkflow = MUSIC_VIDEO_WORKFLOW;
  run.refs.musicVideoWorkflowSha256 = readMusicVideoWorkflow().sha256;
  run.refs.manifest = sequenceWorkspace.manifest ? {
    id: sequenceWorkspace.manifest.id,
    title: sequenceWorkspace.manifest.title,
    file: manifestFile,
    bytes: binding.manifestBytes,
    sha256: binding.manifestSha256
  } : null;
  run.refs.clipFingerprints = Object.fromEntries(
    (binding.clipIds || []).map((clipId) => [clipId, storyboardPlanFingerprint(binding.projectSlug, clipId)])
  );
  if (binding.source === "storyboard") {
    run.refs.generationFingerprint = storyboardPlanFingerprint(binding.projectSlug, binding.clipId);
    markDirectorRender(binding.projectSlug, binding, {
      status: "queued",
      error: null,
      promptId: run.id,
      expectedFingerprint: run.refs.generationFingerprint
    });
  }
  persistMusicVideoRun(run);
  try {
    run = await queueMusicVideoShot(run, 0, plan.firstGuide.imageFile);
    return run;
  } catch (error) {
    failMusicVideoRun(run, error);
    throw error;
  }
}

async function resumeMusicVideoSequence(slug, runId) {
  const stored = projectJobs(slug).find((job) => job.type === "director_music_video" && job.id === runId);
  if (!stored) throw new Error("Music-video sequence not found");
  if (stored.status === "done") return stored;
  const storedClipIds = stored.refs?.binding?.clipIds || [stored.refs?.binding?.clipId];
  const conflicting = [...musicVideoRuns.values()].find((run) => {
    if (run.id === stored.id || run.projectSlug !== stored.projectSlug || !["queued", "running", "finalizing"].includes(run.status)) return false;
    const activeClipIds = run.refs?.binding?.clipIds || [run.refs?.binding?.clipId];
    return activeClipIds.some((clipId) => storedClipIds.includes(clipId));
  });
  if (conflicting) throw new Error(`Another music-video sequence is active (${conflicting.id})`);
  const directorConflict = [...directorJobs.values()].find((job) =>
    ["queued", "running"].includes(job.status)
    && job.refs?.binding?.projectSlug === stored.projectSlug
    && storedClipIds.includes(job.refs?.binding?.clipId)
  );
  if (directorConflict) throw new Error(`A Director render is active for ${directorConflict.refs.binding.clipId}`);
  stored.error = null;
  stored.finishedAt = null;
  const allDone = stored.refs.shots.every((shot) => shot.status === "done");
  stored.status = allDone ? "finalizing" : "queued";
  stored.stage = allDone ? "Resuming final master assembly" : "Resuming durable music-video sequence";
  persistMusicVideoRun(stored);
  if (allDone) {
    beginMusicVideoMonitor();
    return stored;
  }
  const index = Number(stored.refs.currentShotIndex) || 0;
  const shot = stored.refs.shots[index];
  if (shot.promptId || shot.status === "submitting" || shot.status === "done") {
    beginMusicVideoMonitor();
    return stored;
  }
  const guide = index === 0 ? stored.refs.plan.firstGuide.imageFile : stored.refs.shots[index - 1]?.handoffComfyFile;
  return await queueMusicVideoShot(stored, index, guide);
}

function trackDirectorPrompt(accepted, binding, mode, preparedWorkspace) {
  if (!binding?.projectSlug || !binding?.clipId) return;
  const id = `director_${accepted.promptId}`;
  const timelineText = JSON.stringify(preparedWorkspace.timeline || {});
  const promptText = `${preparedWorkspace.timeline?.global_prompt || ""}\n${(preparedWorkspace.timeline?.segments || []).map((segment) => segment.prompt || "").join("\n")}`;
  const job = {
    id,
    type: "director_render",
    projectSlug: binding.projectSlug,
    label: `LTX 2.5 Director · ${binding.clipId}${accepted.segmentId ? ` · ${accepted.segmentId}` : ""}`,
    status: "queued",
    progress: 0,
    stage: "Queued on ComfyUI 8188",
    error: null,
    refs: {
      binding: structuredClone(binding),
      promptId: accepted.promptId,
      mode,
      segmentId: accepted.segmentId || null,
      fps: preparedWorkspace.settings.frameRate,
      width: preparedWorkspace.settings.customWidth,
      height: preparedWorkspace.settings.customHeight,
      durationFrames: accepted.requestedFrames ?? preparedWorkspace.timeline?.normalDurationFrames ?? preparedWorkspace.stats?.durationFrames ?? null,
          requestedFrames: accepted.requestedFrames ?? preparedWorkspace.timeline?.normalDurationFrames ?? preparedWorkspace.stats?.durationFrames ?? null,
      generationFrames: accepted.generationFrames ?? accepted.durationFrames ?? null,
      expectAudio: Boolean(accepted.expectAudio),
      segmentIds: accepted.segmentId ? [accepted.segmentId] : (preparedWorkspace.timeline?.segments || []).map((segment) => segment.id),
      sourceHash: preparedWorkspace.source?.sha256 || null,
      timelineHash: crypto.createHash("sha256").update(timelineText).digest("hex"),
      promptHash: crypto.createHash("sha256").update(promptText).digest("hex"),
      generationFingerprint: accepted.generationFingerprint || null
    },
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null
  };
  directorJobs.set(id, job);
  beginDirectorMonitor();
  upsertProjectJob(binding.projectSlug, job);
  if (binding.source === "storyboard" && mode === "timeline") {
    markDirectorRender(binding.projectSlug, binding, { status: "queued", error: null, promptId: accepted.promptId, expectedFingerprint: accepted.generationFingerprint });
  }
}

workspace = loadWorkspace();
for (const project of projectCatalog()) {
  for (const job of projectJobs(project.slug)) {
    if (job.type === "director_render" && ["queued", "running"].includes(job.status) && job.refs?.promptId) {
      directorJobs.set(job.id, { ...job, projectSlug: project.slug });
    }
    if (job.type === "director_music_video" && ["queued", "running", "finalizing"].includes(job.status)) {
      musicVideoRuns.set(job.id, { ...job, projectSlug: project.slug });
    }
  }
}
if (directorJobs.size) beginDirectorMonitor();
if (musicVideoRuns.size) beginMusicVideoMonitor();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32mb" }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0,
  extensions: ["html"],
  setHeaders(response, filePath) {
    response.setHeader("Cache-Control", filePath.endsWith(".html") ? "no-store" : "no-cache");
  }
}));

app.get("/api/workspace", (_req, res) => {
  res.json({ workspace: workspaceForClient(workspace), sourceWorkflow: SOURCE_WORKFLOW });
});

app.put("/api/workspace", (req, res) => {
  try {
    const serverOwnedPremiereBinding = workspace.premiere ? structuredClone(workspace.premiere) : null;
    workspace = mergeWorkspace(workspace, req.body?.workspace || req.body);
    workspace.premiere = serverOwnedPremiereBinding;
    atomicWrite(STATE_FILE, workspace);
    res.json({ ok: true, workspace: workspaceForClient(workspace) });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/api/reset", (_req, res) => {
  try {
    workspace = workspaceFromWorkflow(sourceGraph, sourceText, comfyUrl());
    atomicWrite(STATE_FILE, workspace);
    res.json({ ok: true, workspace: workspaceForClient(workspace) });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.get("/api/premiere/projects", (_req, res) => {
  try { res.json({ projects: projectCatalog() }); }
  catch (error) { res.status(500).json({ error: String(error.message || error) }); }
});

app.get("/api/premiere/projects/:slug", (req, res) => {
  try { res.json(projectOverview(req.params.slug)); }
  catch (error) { res.status(404).json({ error: String(error.message || error) }); }
});

app.get("/api/premiere/projects/:slug/scenes/:clipId/references", (req, res) => {
  try { res.json(sceneReferenceMedia(req.params.slug, req.params.clipId)); }
  catch (error) { res.status(404).json({ error: String(error.message || error) }); }
});

app.post("/api/premiere/projects/:slug/load", (req, res) => {
  try {
    const clipId = String(req.body?.clipId || "");
    if (!clipId) return res.status(400).json({ error: "clipId required" });
    workspace = workspaceForProjectClip(workspace, req.params.slug, clipId);
    atomicWrite(STATE_FILE, workspace);
    res.json({ ok: true, workspace: workspaceForClient(workspace), overview: projectOverview(req.params.slug) });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/api/premiere/sync", (_req, res) => {
  try {
    const result = syncWorkspaceToPremiere(workspace);
    if (workspace.premiere && result.planFingerprint) {
      workspace.premiere.planFingerprint = result.planFingerprint;
      workspace.premiere.storyboardUpdatedAt = result.updatedAt;
      atomicWrite(STATE_FILE, workspace);
    }
    res.json({ ok: true, result, overview: projectOverview(result.projectSlug) });
  } catch (error) {
    res.status(error.code === "STALE_STORYBOARD" ? 409 : 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/premiere/projects/:slug/import-media", async (req, res) => {
  try {
    const relative = String(req.body?.file || "");
    const disk = resolveProjectMedia(req.params.slug, relative);
    const type = mediaKind(relative);
    if (!["image", "video", "audio"].includes(type)) {
      return res.status(415).json({ error: "This project item is a document, not importable image, video, or audio media" });
    }
    const kind = String(relative.split("/")[1] || "assets").replace(/[^a-z0-9_-]/gi, "") || "assets";
    const stat = fs.statSync(disk);
    const stored = type === "video" && stat.size > 50 * 1024 * 1024
      ? await uploadLargeVideo(disk, `${req.params.slug}_${path.basename(disk)}`, stat.size)
      : await uploadSmall(disk, `${req.params.slug}_${path.basename(disk)}`, `Premiere316/${req.params.slug}/${kind}`);
    const sha256 = await hashFile(disk);
    res.json({
      ok: true,
      file: stored,
      fileName: path.basename(disk),
      mediaType: type,
      projectMediaPath: relative,
      projectMediaBytes: stat.size,
      projectMediaSha256: sha256,
      id: newId("project")
    });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.get("/api/premiere/media/:slug", (req, res) => {
  try {
    const file = resolveProjectMedia(req.params.slug, req.query.file);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(file);
  } catch (error) {
    res.status(404).send(String(error.message || error));
  }
});

function sendMusicVideoManifest(req, res) {
  try {
    const loaded = readMusicVideoManifest(req.params.slug, req.params.manifestId || req.query.manifestId || null);
    const manifestWorkspace = workspaceFromMusicVideoManifest(workspace, loaded.manifest);
    assertManifestStoryboardClips(req.params.slug, manifestWorkspace.manifest.clipIds);
    const plan = buildMusicVideoSequencePlan(manifestWorkspace);
    res.json({
      manifest: loaded.manifest,
      manifestFile: loaded.file,
      manifestBytes: loaded.bytes,
      manifestSha256: loaded.sha256,
      plan: {
        shots: plan.shots.length,
        startFrame: plan.startFrame,
        endFrame: plan.endFrame,
        requestedFrames: plan.requestedFrames,
        fps: plan.fps,
        width: plan.width,
        height: plan.height,
        clipIds: manifestWorkspace.manifest.clipIds
      }
    });
  } catch (error) {
    res.status(404).json({ error: String(error.message || error) });
  }
}

app.get("/api/music-video/manifests/:slug/:manifestId", sendMusicVideoManifest);
app.get("/api/music-video/manifests/:slug", sendMusicVideoManifest);

app.get("/api/music-video/sequences", (req, res) => {
  try {
    const slug = String(req.query.projectSlug || workspace.premiere?.projectSlug || "");
    if (!slug) return res.status(400).json({ error: "projectSlug is required" });
    const jobs = projectJobs(slug).filter((job) => job.type === "director_music_video");
    res.json({ jobs });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.get("/api/music-video/sequences/:id", (req, res) => {
  try {
    const slug = String(req.query.projectSlug || workspace.premiere?.projectSlug || "");
    if (!slug) return res.status(400).json({ error: "projectSlug is required" });
    const job = projectJobs(slug).find((candidate) => candidate.type === "director_music_video" && candidate.id === req.params.id);
    if (!job) return res.status(404).json({ error: "Music-video sequence not found" });
    res.json({ job });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/api/music-video/sequences", async (req, res) => {
  try {
    const job = await startMusicVideoSequence(req.body || {});
    res.status(202).json({ ok: true, job });
  } catch (error) {
    res.status(error?.code === "STALE_RENDER" ? 409 : 400).json({ error: String(error.message || error) });
  }
});

app.post("/api/music-video/sequences/:id/resume", async (req, res) => {
  try {
    const slug = String(req.body?.projectSlug || req.query.projectSlug || workspace.premiere?.projectSlug || "");
    if (!slug) return res.status(400).json({ error: "projectSlug is required" });
    const job = await resumeMusicVideoSequence(slug, req.params.id);
    res.status(202).json({ ok: true, job });
  } catch (error) {
    res.status(409).json({ error: String(error.message || error) });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const [stats, queue] = await Promise.all([
      fetchJson(`${comfyUrl()}/system_stats`),
      fetchJson(`${comfyUrl()}/queue`)
    ]);
    res.json({
      connected: true,
      comfyUrl: comfyUrl(),
      comfyVersion: stats?.system?.comfyui_version || "unknown",
      device: stats?.devices?.[0]?.name || "unknown",
      queue: {
        running: queue?.queue_running?.length || 0,
        pending: queue?.queue_pending?.length || 0
      }
    });
  } catch (error) {
    res.status(503).json({ connected: false, comfyUrl: comfyUrl(), error: String(error.message || error) });
  }
});

app.get("/api/preflight", async (_req, res) => {
  try {
    const built = await compile(workspace, null, true);
    res.json({
      ok: true,
      nodeCount: built.nodeCount,
      flatNodeCount: built.flatNodeCount,
      flatLinkCount: built.flatLinkCount,
      outputNodes: Object.entries(built.prompt).filter(([, node]) => ["VHS_VideoCombine", "SaveVideo"].includes(node.class_type)).map(([id, node]) => ({ id, type: node.class_type })),
      warnings: ["The source IC-LoRA track is visible but its motion_guide_data/model sockets are not wired, so it is currently display-only."]
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error.message || error) });
  }
});

app.get("/api/media", async (req, res) => {
  try {
    const { filename, subfolder } = mediaParts(req.query.file);
    if (!filename) return res.status(400).send("file required");
    const url = new URL(`${comfyUrl()}/view`);
    url.searchParams.set("filename", filename);
    url.searchParams.set("type", String(req.query.type || "input"));
    if (subfolder) url.searchParams.set("subfolder", subfolder);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return res.status(response.status).send(await response.text());
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const data = Buffer.from(await response.arrayBuffer());
    res.send(data);
  } catch (error) {
    res.status(502).send(String(error.message || error));
  }
});

app.post("/api/upload", ensureUploadDir, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });
  try {
    const type = String(req.body?.track || "main");
    const original = req.file.originalname.replace(/[^a-zA-Z0-9 ._()-]/g, "_");
    const isVideo = /^video\//.test(req.file.mimetype) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(original);
    const stored = isVideo && req.file.size > 50 * 1024 * 1024
      ? await uploadLargeVideo(req.file.path, original, req.file.size)
      : await uploadSmall(req.file.path, original);
    res.json({ ok: true, file: stored, fileName: original, track: type, id: newId(type) });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

app.post("/api/queue", async (req, res) => {
  try {
    const mode = String(req.body?.mode || workspace.settings.queueMode || "segments");
    if (workspace.premiere?.projectSlug && workspace.premiere?.clipId) {
      const activeMusic = [...musicVideoRuns.values()].find((run) => {
        if (!["queued", "running", "finalizing"].includes(run.status)) return false;
        if (run.projectSlug !== workspace.premiere.projectSlug) return false;
        const clipIds = run.refs?.binding?.clipIds || [run.refs?.binding?.clipId];
        return clipIds.includes(workspace.premiere.clipId);
      });
      if (activeMusic) return res.status(409).json({ error: `This Premiere scene belongs to active music-video sequence ${activeMusic.id}` });
      const active = [...directorJobs.values()].find((job) =>
        ["queued", "running"].includes(job.status)
        && job.refs?.mode === "timeline"
        && job.refs?.binding?.projectSlug === workspace.premiere.projectSlug
        && job.refs?.binding?.clipId === workspace.premiere.clipId
      );
      if (active) return res.status(409).json({ error: `This Premiere scene already has an active Director render (${active.refs.promptId})` });
    }
    if (workspace.premiere?.source === "storyboard") {
      const referenceState = sceneReferenceMedia(workspace.premiere.projectSlug, workspace.premiere.clipId);
      if (!referenceState.referencesReady) {
        const missing = referenceState.invalidReferences.filter((item) => item.required).map((item) => item.assetId || item.sourceAssetKey || item.reason || "reference");
        return res.status(400).json({ error: `This Premiere scene has unavailable required approved references: ${missing.join(", ")}` });
      }
    }
    if (workspace.premiere?.source === "storyboard") {
      const synced = syncWorkspaceToPremiere(workspace);
      workspace.premiere.planFingerprint = synced.planFingerprint;
      workspace.premiere.storyboardUpdatedAt = synced.updatedAt;
      atomicWrite(STATE_FILE, workspace);
    }
    const preparedWorkspace = await prepareProjectMedia(workspace);
    const generationFingerprint = preparedWorkspace.premiere?.source === "storyboard"
      ? storyboardPlanFingerprint(preparedWorkspace.premiere.projectSlug, preparedWorkspace.premiere.clipId)
      : null;
    let jobs = [];
    if (mode === "selected") jobs = buildSegmentJobs(preparedWorkspace, req.body?.segmentId || preparedWorkspace.selectedSegmentId);
    else if (mode === "segments") jobs = buildSegmentJobs(preparedWorkspace);
    else jobs = [null];
    const hasVisualGuide = (preparedWorkspace.timeline?.segments || []).some((segment) => ["image", "video"].includes(segment.type) && (segment.imageFile || segment.videoFile));
    const missingGuides = (preparedWorkspace.timeline?.segments || []).filter((segment) => segment.missingGuide).map((segment) => segment.storyboardFrameId || segment.id);
    if (!jobs.length || (mode === "timeline" && (!hasVisualGuide || missingGuides.length))) {
      const detail = missingGuides.length ? ` Missing: ${missingGuides.join(", ")}.` : "";
      return res.status(400).json({ error: `This scene is not ready for a full render. Generate or approve every required storyboard guide first.${detail}` });
    }
    const compiledJobs = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      compiledJobs.push({ job, built: await compile(preparedWorkspace, job, index === 0) });
    }
    const accepted = [];
    for (const { job, built } of compiledJobs) {
      try {
        if (generationFingerprint && storyboardPlanFingerprint(preparedWorkspace.premiere.projectSlug, preparedWorkspace.premiere.clipId) !== generationFingerprint) {
          throw staleRenderError("The Premiere scene changed before it could be submitted. Reload the scene and try again.");
        }
        const result = await fetchJson(`${comfyUrl()}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: built.prompt, client_id: crypto.randomUUID() }),
          signal: AbortSignal.timeout(60_000)
        });
        const requestedFrames = Math.max(1, Number(job?.requestedFrames ?? preparedWorkspace.timeline?.normalDurationFrames ?? preparedWorkspace.stats?.durationFrames) || 1);
        const item = {
          promptId: result.prompt_id,
          number: result.number,
          segmentId: job?.sourceSegmentId || null,
          requestedFrames,
          generationFrames: ltxFrameCount(requestedFrames),
          expectAudio: Boolean(built.prompt?.["94"]?.inputs?.audio),
          generationFingerprint
        };
        accepted.push(item);
        trackDirectorPrompt(item, preparedWorkspace.premiere, mode, preparedWorkspace);
      } catch (error) {
        if (accepted.length) return res.status(207).json({ ok: false, partial: true, accepted, error: String(error.message || error) });
        throw error;
      }
    }
    res.status(202).json({ ok: true, accepted });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.get("/api/queue", async (_req, res) => {
  try { res.json(await fetchJson(`${comfyUrl()}/queue`)); }
  catch (error) { res.status(503).json({ error: String(error.message || error) }); }
});

app.get("/api/history/:promptId", async (req, res) => {
  try { res.json(await fetchJson(`${comfyUrl()}/history/${encodeURIComponent(req.params.promptId)}`)); }
  catch (error) { res.status(503).json({ error: String(error.message || error) }); }
});

app.post("/api/interrupt", async (_req, res) => {
  try { res.json(await fetchJson(`${comfyUrl()}/interrupt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })); }
  catch (error) { res.status(503).json({ error: String(error.message || error) }); }
});

app.get("/api/export", (_req, res) => {
  res.type("application/json").attachment("LTX2.5_DIRECTOR.workspace.json").send(`${JSON.stringify(workspaceForClient(workspace), null, 2)}\n`);
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Director API route not found" }));

app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const server = app.listen(PORT, HOST, () => {
  console.log(`[Director] LTX 2.5 Director Webapp: http://${HOST}:${PORT}`);
  console.log(`[Director] ComfyUI: ${comfyUrl()}`);
  console.log(`[Director] Source workflow: ${SOURCE_WORKFLOW}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
