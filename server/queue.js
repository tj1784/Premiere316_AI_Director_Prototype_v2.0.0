import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import {
  uploadImage,
  runPrompt,
  downloadOutput,
  collectOutputFiles,
  getObjectInfo
} from "./comfy.js";
import { fillI2vPrompt, clampDuration, framesOf } from "./timeline.js";
import {
  loadProject,
  saveProject,
  findClip,
  mediaDir
} from "./projects.js";
import {
  trimVideoToFrames,
  concatVideos,
  concatPreparedVideos,
  finalizeMasterMedia,
  concatVideoSegments,
  generatePrototypeScore,
  mixScore,
  probeMedia,
  renderMasterBookend
} from "./ffmpeg.js";
import { assetApprovalCurrent, generateAssetJob } from "./assets.js";
import { projectDir } from "./paths.js";
import {
  BOOKEND_DURATION_SEC,
  BOOKEND_OPENING_TITLE,
  bookendDurationSec,
  normalizeBookends
} from "./bookends.js";

const jobs = [];
let running = false;

function persistJobLedger(projectSlug) {
  if (!projectSlug) return;
  try {
    const root = projectDir(projectSlug);
    fs.mkdirSync(root, { recursive: true });
    const entries = jobs.filter((job) => job.projectSlug === projectSlug).slice(-250).map((job) => ({
      id: job.id,
      type: job.type,
      label: job.label,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error,
      refs: job.refs,
      result: job.result,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt
    }));
    fs.writeFileSync(path.join(root, "generation-jobs.json"), JSON.stringify({ updatedAt: new Date().toISOString(), jobs: entries }, null, 2));
  } catch (error) {
    console.warn("[queue] could not persist project job ledger:", error.message);
  }
}

export function listJobs() {
  return jobs.slice(-120).map((j) => ({
    id: j.id,
    projectSlug: j.projectSlug,
    type: j.type,
    label: j.label,
    status: j.status,
    progress: j.progress,
    stage: j.stage,
    error: j.error,
    refs: j.refs,
    result: j.result,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt
  }));
}

export function enqueue(job) {
  const j = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: "queued",
    progress: 0,
    stage: "Queued",
    error: null,
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    ...job
  };
  jobs.push(j);
  persistJobLedger(j.projectSlug);
  pump();
  return j;
}

export function cancelJob(id) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return false;
  if (j.status === "queued") {
    j.status = "cancelled";
    j.finishedAt = new Date().toISOString();
    persistJobLedger(j.projectSlug);
    return true;
  }
  return false;
}

async function pump() {
  if (running) return;
  const next = jobs.find((j) => j.status === "queued");
  if (!next) return;
  running = true;
  next.status = "running";
  next.progress = 0;
  persistJobLedger(next.projectSlug);
  try {
    if (next.type === "render_range") await renderRange(next);
    else if (next.type === "assemble_clip") await assembleClipJob(next);
    else if (next.type === "generate_score") await generateScore(next);
    else if (next.type === "generate_asset") await generateAssetJob(next);
    else if (next.type === "build_master") await buildMaster(next);
    else throw new Error(`Unknown job type: ${next.type}`);
    next.status = "done";
    next.stage = "Complete";
    next.progress = 1;
  } catch (e) {
    next.status = "error";
    next.stage = "Failed";
    next.error = String(e.message || e);
    console.error("[queue]", next.label, e);
  } finally {
    next.finishedAt = new Date().toISOString();
    persistJobLedger(next.projectSlug);
    running = false;
    setImmediate(pump);
  }
}

async function runAndFetch(job, prompt, destDir, destName) {
  const outputs = await runPrompt(prompt, {
    onProgress: ({ value, max }) => {
      if (max) job.progress = Math.min(0.86, 0.08 + (value / max) * 0.78);
    }
  });
  const refs = collectOutputFiles(outputs);
  if (!refs.length) throw new Error("ComfyUI finished with no output files");
  fs.mkdirSync(destDir, { recursive: true });
  const saved = [];
  for (const ref of refs) {
    const name = await downloadOutput(ref, destDir, destName && refs.length === 1 ? destName : null);
    saved.push(name);
  }
  return saved;
}

function clipTotalFrames(project, clip) {
  return framesOf(clip.durationSec || project.settings.defaultDurationSec || 6, project.settings.fps || 24);
}

function nextVersion(items = []) {
  return Math.max(0, ...items.map((x) => Number(x.v) || 0)) + 1;
}

function currentGuideBindings(project, clip) {
  const firstGuide = (clip.guides || []).find((guide) => guide.role === "first" || Number(guide.frame) === 0);
  if (!firstGuide?.file) throw new Error("Clip has no approved first-frame guide");
  const files = [...new Set([
    ...(clip.guides || []).map((guide) => guide.file),
    clip.firstFrame?.file,
    clip.endFrame?.file
  ].filter(Boolean))].sort();
  return files.map((file) => {
    const frame = (project.frames || []).find((item) => item.file === file);
    const asset = project.assets?.items?.find((item) => item.id === frame?.assetId);
    if (
      !frame ||
      frame.source !== "asset-foundry-approved" ||
      !asset ||
      !assetApprovalCurrent(project, asset) ||
      Number(frame.assetVersion) !== Number(asset.activeVersion) ||
      frame.assetApprovalFingerprint !== asset.approval?.versionFingerprint ||
      frame.screenplayRevision !== asset.approval?.screenplayRevision
    ) throw new Error(`Render cancelled because guide media is missing, stale, or no longer approved: ${frame?.name || file}`);
    return {
      file,
      frameId: frame.id,
      assetId: frame.assetId,
      assetVersion: Number(frame.assetVersion),
      approvalFingerprint: frame.assetApprovalFingerprint,
      screenplayRevision: frame.screenplayRevision
    };
  });
}

function renderFingerprint(project, clip) {
  return crypto.createHash("sha256").update(JSON.stringify({
    clipId: clip.id,
    name: clip.name,
    durationSec: clip.durationSec,
    globalPrompt: clip.globalPrompt || "",
    seed: clip.seed ?? null,
    segments: (clip.segments || []).map((segment) => ({
      id: segment.id,
      startFrame: segment.startFrame,
      endFrame: segment.endFrame,
      prompt: segment.prompt || ""
    })),
    settings: {
      fps: project.settings?.fps,
      width: project.settings?.width,
      height: project.settings?.height,
      ingredients: project.settings?.ingredients || null
    }
  })).digest("hex");
}

function validateQueuedRender(project, clip, refs) {
  if (!refs?.clipFingerprint || refs.clipFingerprint !== renderFingerprint(project, clip)) {
    throw new Error("Render cancelled because the clip direction or generation settings changed after it was queued");
  }
  const current = currentGuideBindings(project, clip);
  if (JSON.stringify(current) !== JSON.stringify(refs.guideBindings || [])) {
    throw new Error("Render cancelled because its approved guide versions changed after it was queued");
  }
}

async function uploadClipGuides(project, clip) {
  const subfolder = `premiere316/${project.slug}`;
  const uploaded = new Map();
  const out = [];
  for (const guide of clip.guides || []) {
    const disk = path.join(mediaDir(project, "frames"), guide.file);
    if (!fs.existsSync(disk)) continue;
    let comfyFile = uploaded.get(guide.file);
    if (!comfyFile) {
      comfyFile = await uploadImage(disk, subfolder);
      uploaded.set(guide.file, comfyFile);
    }
    out.push({ ...guide, comfyFile });
  }
  return out;
}

async function renderRange(job) {
  const project = loadProject(job.projectSlug);
  const clip = findClip(project, job.refs.clipId);
  if (!clip) throw new Error("Clip not found");
  validateQueuedRender(project, clip, job.refs);

  const fps = project.settings.fps || 24;
  const totalFrames = clipTotalFrames(project, clip);
  const rangeStartFrame = Math.max(0, Math.min(totalFrames - 1, Number(job.refs.startFrame) || 0));
  const rangeEndFrame = Math.max(
    rangeStartFrame + 1,
    Math.min(totalFrames, Number(job.refs.endFrame) || totalFrames)
  );
  const version = nextVersion(clip.rangeVersions || []);
  const baseName = `${clip.name}_r${String(rangeStartFrame).padStart(5, "0")}-${String(rangeEndFrame).padStart(5, "0")}_v${String(version).padStart(2, "0")}`;
  job.label = `Render ${clip.name} · ${rangeStartFrame}–${rangeEndFrame}f`;
  job.stage = "Uploading guides";
  job.progress = 0.04;

  const guides = await uploadClipGuides(project, clip);
  const durationSec = clampDuration(clip.durationSec || project.settings.defaultDurationSec || 6);
  job.stage = "Compiling LTX Director prompt";
  const compiled = await fillI2vPrompt({
    globalPrompt: clip.globalPrompt || "",
    segments: clip.segments || [],
    guides,
    rangeStartFrame,
    rangeEndFrame,
    durationSec,
    fps,
    width: project.settings.width || 1280,
    height: project.settings.height || 720,
    seed: clip.seed,
    ingredients: project.settings.ingredients,
    filenamePrefix: `premiere316/${project.slug}/${baseName}`,
    objectInfo: await getObjectInfo()
  });
  if (compiled.warnings?.length) console.warn("[render_range] conversion warnings:", compiled.warnings);

  job.stage = "Generating in ComfyUI";
  const files = await runAndFetch(job, compiled.prompt, mediaDir(project, "clips"), baseName);
  const videoName = files.find((f) => /\.(mp4|webm|mov|mkv)$/i.test(f));
  if (!videoName) throw new Error("ComfyUI returned files, but none was a video");

  job.stage = "Trimming to selected range";
  job.progress = 0.9;
  const inputPath = path.join(mediaDir(project, "clips"), videoName);
  const trimmedName = `${baseName}_exact.mp4`;
  const trimmedPath = path.join(mediaDir(project, "clips"), trimmedName);
  await trimVideoToFrames(inputPath, trimmedPath, compiled.requestedFrames, fps);
  if (path.resolve(inputPath) !== path.resolve(trimmedPath)) {
    try { fs.unlinkSync(inputPath); } catch {}
  }

  const fresh = loadProject(project.slug);
  const freshClip = findClip(fresh, clip.id);
  if (!freshClip) throw new Error("Clip disappeared while rendering");
  validateQueuedRender(fresh, freshClip, job.refs);
  if (nextVersion(freshClip.rangeVersions || []) !== version) {
    throw new Error("Render output was retained but not registered because another clip version completed during generation");
  }

  const rangeVersion = {
    v: version,
    file: trimmedName,
    name: baseName,
    startFrame: compiled.rangeStartFrame,
    endFrame: compiled.rangeEndFrame,
    requestedFrames: compiled.requestedFrames,
    generationFrames: compiled.generationFrames,
    segmentIds: job.refs.segmentIds || [],
    active: true,
    createdAt: new Date().toISOString()
  };
  freshClip.rangeVersions = freshClip.rangeVersions || [];
  for (const old of freshClip.rangeVersions) {
    if (old.startFrame === rangeVersion.startFrame && old.endFrame === rangeVersion.endFrame) old.active = false;
  }
  freshClip.rangeVersions.push(rangeVersion);

  const selected = new Set(job.refs.segmentIds || []);
  for (const segment of freshClip.segments || []) {
    if (selected.has(segment.id) || (segment.startFrame >= rangeStartFrame && segment.endFrame <= rangeEndFrame)) {
      segment.dirty = false;
    }
  }

  if (rangeStartFrame === 0 && rangeEndFrame === totalFrames) {
    const fullVersion = nextVersion(freshClip.versions || []);
    freshClip.versions = freshClip.versions || [];
    freshClip.versions.push({
      v: fullVersion,
      file: trimmedName,
      name: `${freshClip.name}_v${String(fullVersion).padStart(2, "0")}`,
      createdAt: new Date().toISOString(),
      source: "full-range-render",
      requestedFrames: compiled.requestedFrames,
      generationFrames: compiled.generationFrames
    });
    freshClip.activeVersion = fullVersion;
    freshClip.status = "done";
  } else {
    freshClip.status = (freshClip.segments || []).every((s) => s.dirty === false) ? "ranges-ready" : "partial";
  }
  saveProject(fresh);
  job.result = { clipId: freshClip.id, rangeVersion, file: trimmedName };
  job.progress = 0.98;
}

function activeClipFile(project, clip) {
  const active = (clip.versions || []).find((v) => Number(v.v) === Number(clip.activeVersion));
  if (!active?.file) return null;
  const disk = path.join(mediaDir(project, "clips"), active.file);
  return fs.existsSync(disk) ? disk : null;
}

function timeOf(item) {
  const value = Date.parse(item?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function activeFullVersion(project, clip) {
  const versions = clip.versions || [];
  const active = versions.find((v) => Number(v.v) === Number(clip.activeVersion)) || versions.at(-1);
  if (!active?.file) return null;
  const file = path.join(mediaDir(project, "clips"), active.file);
  return fs.existsSync(file) ? { ...active, file } : null;
}

function sourcePlanForClip(project, clip) {
  const total = clipTotalFrames(project, clip);
  const full = activeFullVersion(project, clip);
  const fullCreatedAt = timeOf(full);
  const ranges = (clip.rangeVersions || [])
    .filter((r) => r.active !== false && r.file)
    .map((r) => ({
      ...r,
      startFrame: Math.max(0, Math.min(total - 1, Math.round(Number(r.startFrame) || 0))),
      endFrame: Math.max(1, Math.min(total, Math.round(Number(r.endFrame) || total))),
      diskFile: path.join(mediaDir(project, "clips"), r.file)
    }))
    .filter((r) => r.endFrame > r.startFrame && fs.existsSync(r.diskFile))
    // An accepted/assembled full version is the new baseline. Only range renders
    // created after it should override it.
    .filter((r) => !full || timeOf(r) > fullCreatedAt)
    .sort((a, b) => timeOf(b) - timeOf(a) || Number(b.v) - Number(a.v));

  if (!ranges.length) {
    if (full) return [{
      file: full.file,
      startFrame: 0,
      endFrame: total,
      offsetFrame: 0,
      source: "full",
      sourceVersion: full.v
    }];
    throw new Error(`Cannot assemble ${clip.name}: no accepted full render or complete selected-range coverage exists`);
  }

  const boundaries = new Set([0, total]);
  for (const range of ranges) {
    boundaries.add(range.startFrame);
    boundaries.add(range.endFrame);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const startFrame = sorted[i];
    const endFrame = sorted[i + 1];
    if (endFrame <= startFrame) continue;
    const range = ranges.find((r) => r.startFrame <= startFrame && r.endFrame >= endFrame);
    if (range) {
      pieces.push({
        file: range.diskFile,
        startFrame,
        endFrame,
        offsetFrame: startFrame - range.startFrame,
        source: "range",
        sourceVersion: range.v
      });
    } else if (full) {
      pieces.push({
        file: full.file,
        startFrame,
        endFrame,
        offsetFrame: startFrame,
        source: "full",
        sourceVersion: full.v
      });
    } else {
      throw new Error(`Cannot assemble ${clip.name}: selected renders leave a gap at frames ${startFrame}–${endFrame}`);
    }
  }

  // Merge adjacent intervals that read continuously from the same source file.
  return pieces.reduce((merged, piece) => {
    const previous = merged.at(-1);
    const previousLength = previous ? previous.endFrame - previous.startFrame : 0;
    if (
      previous &&
      previous.file === piece.file &&
      previous.endFrame === piece.startFrame &&
      previous.offsetFrame + previousLength === piece.offsetFrame
    ) {
      previous.endFrame = piece.endFrame;
      return merged;
    }
    merged.push({ ...piece });
    return merged;
  }, []);
}

async function assembleClipFile(project, clip, job = null) {
  const fps = project.settings.fps || 24;
  const totalFrames = clipTotalFrames(project, clip);
  const plan = sourcePlanForClip(project, clip);
  const existing = activeClipFile(project, clip);
  if (
    plan.length === 1 &&
    plan[0].startFrame === 0 &&
    plan[0].endFrame === totalFrames &&
    plan[0].offsetFrame === 0 &&
    existing &&
    path.resolve(plan[0].file) === path.resolve(existing)
  ) {
    return existing;
  }

  const version = nextVersion(clip.versions || []);
  const name = `${clip.name}_v${String(version).padStart(2, "0")}.mp4`;
  const output = path.join(mediaDir(project, "clips"), name);
  if (job) {
    job.stage = `Assembling ${clip.name}`;
    job.progress = 0.08;
  }
  if (
    plan.length === 1 &&
    plan[0].startFrame === 0 &&
    plan[0].endFrame === totalFrames &&
    plan[0].offsetFrame === 0
  ) {
    fs.copyFileSync(plan[0].file, output);
  } else {
    await concatVideoSegments(plan.map((piece) => ({
      file: piece.file,
      startSec: piece.offsetFrame / fps,
      durationSec: (piece.endFrame - piece.startFrame) / fps
    })), output, {
      width: project.settings.width || 1280,
      height: project.settings.height || 720,
      fps
    }, (p) => {
      if (job) job.progress = 0.1 + p * 0.78;
    });
  }
  clip.versions = clip.versions || [];
  clip.versions.push({
    v: version,
    file: name,
    name: path.parse(name).name,
    createdAt: new Date().toISOString(),
    source: "assembled-ranges",
    sourcePlan: plan.map((piece) => ({
      startFrame: piece.startFrame,
      endFrame: piece.endFrame,
      source: piece.source,
      sourceVersion: piece.sourceVersion
    }))
  });
  clip.activeVersion = version;
  clip.status = "done";
  saveProject(project);
  return output;
}

async function assembleClipJob(job) {
  const project = loadProject(job.projectSlug);
  const clip = findClip(project, job.refs.clipId);
  if (!clip) throw new Error("Clip not found");
  job.label = `Assemble ${clip.name}`;
  const file = await assembleClipFile(project, clip, job);
  job.result = { clipId: clip.id, file: path.basename(file) };
}

async function generateScoreFile(project, job = null) {
  const score = project.score;
  const durationSec = Math.max(1, Number(project.sequence.durationSec) || 1);
  const version = nextVersion(score.versions || []);
  const name = `${project.slug}_score_v${String(version).padStart(2, "0")}.wav`;
  const output = path.join(mediaDir(project, "audio"), name);
  if (job) {
    job.stage = "Generating project score";
    job.progress = 0.2;
  }
  await generatePrototypeScore({
    output,
    durationSec,
    mood: score.mood,
    tempo: score.tempo,
    fadeInSec: score.fadeInSec,
    fadeOutSec: score.fadeOutSec
  });
  score.versions = score.versions || [];
  score.versions.push({
    v: version,
    file: name,
    name: path.parse(name).name,
    createdAt: new Date().toISOString(),
    durationSec,
    source: "prototype-score-generator",
    prompt: score.prompt
  });
  score.activeVersion = version;
  saveProject(project);
  return output;
}

async function generateScore(job) {
  const project = loadProject(job.projectSlug);
  job.label = `Generate score · ${project.name}`;
  const output = await generateScoreFile(project, job);
  job.result = { file: path.basename(output), version: project.score.activeVersion };
}

function activeScoreFile(project) {
  const score = project.score || {};
  const active = (score.versions || []).find((v) => Number(v.v) === Number(score.activeVersion));
  if (!active?.file) return null;
  const disk = path.join(mediaDir(project, "audio"), active.file);
  return fs.existsSync(disk) ? disk : null;
}

async function buildMaster(job) {
  const project = loadProject(job.projectSlug);
  if (!project.sequence.clips.length) throw new Error("Add at least one clip before building a master");
  const bookends = normalizeBookends(job.refs?.bookends || project.settings?.bookends, project.name);
  project.settings.bookends = bookends;
  job.label = `Build final master · ${project.name}`;
  job.stage = "Resolving active clip versions";
  const clipFiles = [];
  for (let i = 0; i < project.sequence.clips.length; i++) {
    const clip = project.sequence.clips[i];
    const file = await assembleClipFile(project, clip, null);
    clipFiles.push(file);
    job.progress = 0.05 + ((i + 1) / project.sequence.clips.length) * 0.15;
  }

  const masterVersion = nextVersion(project.masters || []);
  const base = `${project.slug}_master_v${String(masterVersion).padStart(2, "0")}`;
  const pictureName = `${base}_picture.mp4`;
  const picture = path.join(mediaDir(project, "masters"), pictureName);
  job.stage = "Stitching core sequence";
  await concatVideos(clipFiles, picture, {
    width: project.settings.width || 1280,
    height: project.settings.height || 720,
    fps: project.settings.fps || 24
  }, (p) => { job.progress = 0.2 + p * 0.36; });
  const coreInfo = await probeMedia(picture);
  const coreDurationSec = Number(coreInfo.video?.duration) || Number(coreInfo.durationSec) || 0;
  const expectedMasterDurationSec = coreDurationSec + bookendDurationSec(bookends, project.name);

  let coreFile = picture;
  let scoreVersion = 0;
  if (project.score?.enabled) {
    job.stage = "Preparing musical score";
    let scoreFile = activeScoreFile(project);
    if (!scoreFile && project.score.mode !== "none") {
      scoreFile = await generateScoreFile(project, null);
    }
    if (scoreFile) {
      scoreVersion = project.score.activeVersion;
      const mixedName = `${base}_scored.mp4`;
      const mixed = path.join(mediaDir(project, "masters"), mixedName);
      job.stage = "Mixing score into the core film";
      job.progress = 0.64;
      await mixScore(picture, scoreFile, mixed, project.score);
      coreFile = mixed;
    }
  }

  const finalName = `${base}.mp4`;
  const finalPath = path.join(mediaDir(project, "masters"), finalName);
  const hasBookends = bookends.opening.enabled || bookends.credits.enabled;
  let bookendTemp = null;
  let finalReady = false;
  try {
    if (hasBookends) {
      bookendTemp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-master-bookends-"));
      const finalPieces = [];
      if (bookends.opening.enabled) {
        job.stage = `Typesetting ${BOOKEND_OPENING_TITLE}`;
        job.progress = 0.76;
        const openingFile = path.join(bookendTemp, "opening.mp4");
        await renderMasterBookend({
          kind: "opening",
          output: openingFile,
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps
        });
        finalPieces.push(openingFile);
      }
      finalPieces.push(coreFile);
      if (bookends.credits.enabled) {
        job.stage = "Typesetting 30-second end credits";
        job.progress = bookends.opening.enabled ? 0.84 : 0.79;
        const creditsFile = path.join(bookendTemp, "credits.mp4");
        await renderMasterBookend({
          kind: "credits",
          output: creditsFile,
          text: bookends.credits.text,
          width: project.settings.width,
          height: project.settings.height,
          fps: project.settings.fps
        });
        finalPieces.push(creditsFile);
      }
      job.stage = "Appending deterministic master bookends";
      job.progress = 0.9;
      try {
        await concatPreparedVideos(finalPieces, finalPath, expectedMasterDurationSec);
      } catch (copyError) {
        console.warn("[queue] prepared master concat needed compatibility normalization:", copyError.message);
        job.stage = "Normalizing final master compatibility";
        const compatibilityFile = path.join(bookendTemp, "compatibility-joined.mp4");
        await concatVideos(finalPieces, compatibilityFile, {
          width: project.settings.width || 1280,
          height: project.settings.height || 720,
          fps: project.settings.fps || 24
        }, (p) => { job.progress = 0.9 + p * 0.06; });
        await finalizeMasterMedia(compatibilityFile, finalPath, expectedMasterDurationSec);
      }
    } else {
      fs.copyFileSync(coreFile, finalPath);
    }
    finalReady = true;
  } finally {
    if (bookendTemp) fs.rmSync(bookendTemp, { recursive: true, force: true });
    for (const intermediate of new Set([picture, coreFile])) {
      if (path.resolve(intermediate) === path.resolve(finalPath)) continue;
      try { if (fs.existsSync(intermediate)) fs.unlinkSync(intermediate); } catch {}
    }
    if (!finalReady) {
      try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    }
  }
  const info = await probeMedia(finalPath);
  const creditsHash = crypto.createHash("sha256").update(bookends.credits.text).digest("hex");
  project.masters = project.masters || [];
  project.masters.push({
    v: masterVersion,
    file: path.basename(finalPath),
    name: base,
    createdAt: new Date().toISOString(),
    durationSec: info.durationSec,
    coreDurationSec,
    expectedDurationSec: expectedMasterDurationSec,
    scoreVersion,
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    bookends: {
      opening: {
        enabled: bookends.opening.enabled,
        durationSec: BOOKEND_DURATION_SEC,
        title: BOOKEND_OPENING_TITLE
      },
      credits: {
        enabled: bookends.credits.enabled,
        durationSec: BOOKEND_DURATION_SEC,
        text: bookends.credits.text,
        textSha256: creditsHash
      }
    }
  });
  project.activeMasterVersion = masterVersion;
  saveProject(project);
  job.result = {
    file: path.basename(finalPath),
    version: masterVersion,
    bookendDurationSec: bookendDurationSec(bookends, project.name)
  };
  job.progress = 0.98;
}
