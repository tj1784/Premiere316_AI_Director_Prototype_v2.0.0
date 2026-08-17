import crypto from "crypto";
import fs from "fs";
import path from "path";
import { findClip, listProjects, loadProject, mediaDir, saveProject, skipApproval } from "../server/projects.js";
import { assetApprovalCurrent } from "../server/assets.js";
import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, storyboardSummary } from "../server/storyboard.js";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const VIDEO_RE = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const AUDIO_RE = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;

function assertProjectSlug(slug) {
  const value = String(slug || "");
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(value)) throw new Error("Invalid project slug");
  if (!fs.existsSync(path.join(projectDir(value), "project.json"))) throw new Error(`Project not found: ${value}`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function safeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function resolveProjectMedia(slug, relativeFile) {
  slug = assertProjectSlug(slug);
  const relative = safeRelative(relativeFile);
  if (!relative.startsWith("media/")) throw new Error("Project media path must be under media/");
  const root = path.resolve(projectDir(slug));
  if (!fs.existsSync(path.join(root, "project.json"))) throw new Error(`Project not found: ${slug}`);
  const mediaRoot = path.resolve(root, "media");
  const resolved = path.resolve(root, relative);
  const rootPrefix = `${mediaRoot}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(rootPrefix)) throw new Error("Project media path escaped the media root");
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`Project media not found: ${relative}`);
  const realRoot = fs.realpathSync.native(mediaRoot).toLowerCase();
  const realResolved = fs.realpathSync.native(resolved).toLowerCase();
  if (!realResolved.startsWith(`${realRoot}${path.sep}`.toLowerCase())) throw new Error("Project media path escaped through a filesystem link");
  return resolved;
}

function versionFiles(version) {
  const values = [version?.file, ...(Array.isArray(version?.files) ? version.files : [])].filter(Boolean);
  return [...new Set(values.map(String))];
}

function activeVersion(asset) {
  const versions = Array.isArray(asset?.versions) ? asset.versions : [];
  const selected = Number(asset?.activeVersion);
  if (!Number.isFinite(selected) || selected <= 0) return null;
  return versions.find((version) => Number(version.v) === selected) || null;
}

function projectMediaExists(slug, relative) {
  try { return Boolean(resolveProjectMedia(slug, relative)); } catch { return false; }
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const fileHashCache = new Map();

function cachedFileSha256(file, stat = fs.statSync(file)) {
  const key = `${fs.realpathSync.native(file)}|${stat.size}|${stat.mtimeMs}`;
  if (!fileHashCache.has(key)) fileHashCache.set(key, fileSha256(file));
  return fileHashCache.get(key);
}

function resolvedFrameMedia(slug, frame) {
  const versions = Array.isArray(frame?.generatedVersions) ? frame.generatedVersions : [];
  const active = versions.find((version) => Number(version.v) === Number(frame?.activeGeneratedVersion));
  if (!active) return null;
  const sourceFile = active.file || versionFiles(active)[0];
  if (!sourceFile) return null;
  const relative = safeRelative(sourceFile).startsWith("media/") ? safeRelative(sourceFile) : `media/storyboard/${safeRelative(sourceFile)}`;
  let disk;
  try { disk = resolveProjectMedia(slug, relative); } catch { return null; }
  const stat = fs.statSync(disk);
  const expectedHash = (active.fileHashes || []).find((item) => path.basename(item.file || "") === path.basename(sourceFile)) || active.fileHashes?.[0];
  if (expectedHash?.bytes && Number(expectedHash.bytes) !== stat.size) return null;
  if (expectedHash?.sha256 && String(expectedHash.sha256).toLowerCase() !== cachedFileSha256(disk, stat).toLowerCase()) return null;
  return {
    relative,
    disk,
    version: active,
    bytes: stat.size,
    sha256: expectedHash?.sha256 || cachedFileSha256(disk, stat)
  };
}

function approvedMedia(project) {
  const results = [];
  const allowAll = skipApproval(project);
  for (const asset of project.assets?.items || []) {
    const approvalCurrent = assetApprovalCurrent(project, asset);
    const approvedVersionNumber = approvalCurrent || allowAll
      ? Number(asset.activeVersion)
      : asset?.approval?.status === "approved"
        ? Number(asset.approval.activeVersion)
        : 0;
    if (!approvedVersionNumber) continue;
    const version = (asset.versions || []).find((item) => Number(item.v) === approvedVersionNumber);
    if (!version) continue;
    for (const file of versionFiles(version)) {
      const relative = safeRelative(file).startsWith("media/") ? safeRelative(file) : `media/assets/${safeRelative(file)}`;
      if (!projectMediaExists(project.slug, relative)) continue;
      results.push({
        id: `${asset.id}:v${version?.v || asset.activeVersion || 1}:${path.basename(file)}`,
        assetId: asset.id,
        name: asset.name || asset.id,
        category: asset.categoryLabel || asset.category || "Asset",
        mediaType: asset.mediaType || (VIDEO_RE.test(file) ? "video" : AUDIO_RE.test(file) ? "audio" : "image"),
        version: Number(version?.v || asset.activeVersion || 1),
        file: relative,
        prompt: String(asset.prompt || ""),
        approved: true,
        current: Boolean(approvalCurrent && Number(version.v) === Number(asset.activeVersion))
      });
    }
  }
  for (const frame of project.frames || []) {
    const sourceAsset = (project.assets?.items || []).find((asset) => asset.id === frame.assetId);
    const promotedApprovalCurrent = Boolean(
      frame.source === "asset-foundry-approved"
      && sourceAsset
      && assetApprovalCurrent(project, sourceAsset)
      && Number(frame.assetVersion) === Number(sourceAsset.activeVersion)
      && String(frame.assetApprovalFingerprint || "") === String(sourceAsset.approval?.versionFingerprint || "")
    );
    const approved = allowAll || promotedApprovalCurrent || frame.approval?.status === "approved";
    if (!approved || !frame.file) continue;
    const relative = safeRelative(frame.file).startsWith("media/") ? safeRelative(frame.file) : `media/frames/${safeRelative(frame.file)}`;
    if (!projectMediaExists(project.slug, relative)) continue;
    results.push({
      id: `frame:${frame.id || path.basename(frame.file)}`,
      assetId: frame.id || null,
      name: frame.name || path.basename(frame.file),
      category: "Project frame",
      mediaType: "image",
      version: Number(frame.activeVersion || 1),
      file: relative,
      prompt: String(frame.prompt || ""),
      approved: true,
      current: true
    });
  }
  return results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function projectLibraryMedia(project) {
  const results = [];
  for (const asset of project.assets?.items || []) {
    const version = activeVersion(asset);
    for (const file of versionFiles(version)) {
      const relative = safeRelative(file).startsWith("media/") ? safeRelative(file) : `media/assets/${safeRelative(file)}`;
      if (!projectMediaExists(project.slug, relative)) continue;
      results.push({
        id: `library:${asset.id}:v${version?.v || asset.activeVersion || 1}:${path.basename(file)}`,
        assetId: asset.id,
        name: asset.name || asset.id,
        category: asset.categoryLabel || asset.category || "Asset",
        mediaType: asset.mediaType || mediaKind(relative),
        version: Number(version?.v || asset.activeVersion || 1),
        file: relative,
        prompt: String(asset.prompt || ""),
        approved: asset.approval?.status === "approved",
        current: asset.activeVersionCurrent !== false,
        status: asset.status || "unknown"
      });
    }
  }
  return results.sort((a, b) => Number(b.approved) - Number(a.approved) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function readStoryboardMaybe(slug) {
  return fs.existsSync(storyboardPath(slug)) ? loadStoryboard(slug) : null;
}

function orderedStoryboardClips(storyboard) {
  if (!storyboard) return [];
  const results = [];
  for (const chapterId of storyboard.chapterOrder || []) {
    const chapter = storyboard.chapters?.[chapterId];
    if (!chapter) continue;
    for (const sceneId of chapter.sceneIds || []) {
      const scene = storyboard.scenes?.[sceneId];
      if (!scene) continue;
      for (const clipId of scene.clipIds || []) {
        const clip = storyboard.clips?.[clipId];
        if (!clip) continue;
        const plan = storyboard.videoPlans?.[clip.videoPlanId];
        const segments = (plan?.segmentIds || []).map((id) => storyboard.segments?.[id]).filter(Boolean);
        const frameIds = [clip.firstFrameId, ...segments.map((segment) => segment.frameId)].filter(Boolean);
        const uniqueFrameIds = [...new Set(frameIds)];
        const frames = uniqueFrameIds.map((id) => storyboard.frames?.[id]).filter(Boolean);
        const generatedFrames = frames.filter((frame) => resolvedFrameMedia(storyboard.projectId, frame));
        results.push({
          id: clip.id,
          sceneId,
          videoPlanId: clip.videoPlanId,
          chapter: chapter.title,
          chapterNumber: chapter.number,
          scene: scene.title,
          sceneNumber: scene.number,
          order: clip.order,
          beat: clip.beat,
          durationFrames: clip.durationFrames,
          durationSeconds: clip.durationFrames / Math.max(1, Number(storyboard.defaults?.fps) || 24),
          renderStatus: clip.renderStatus || "not_started",
          renderVersions: Array.isArray(plan?.generatedVersions) ? plan.generatedVersions.length : 0,
          frameCount: frames.length,
          generatedFrameCount: generatedFrames.length,
          ready: uniqueFrameIds.length > 0 && frames.length === uniqueFrameIds.length && generatedFrames.length === uniqueFrameIds.length
        });
      }
    }
  }
  return results;
}

function scanGeneratedVideos(project, storyboard) {
  const metadata = new Map();
  for (const clip of project.sequence?.clips || []) {
    for (const version of clip.versions || []) {
      if (!version.file) continue;
      metadata.set(`media/clips/${version.file}`, { clipId: clip.id, clipName: clip.name, source: version.source || "clip", version: version.v });
    }
    for (const version of clip.rangeVersions || []) {
      if (!version.file) continue;
      metadata.set(`media/clips/${version.file}`, { clipId: clip.id, clipName: clip.name, source: "range", version: version.v });
    }
  }
  for (const plan of Object.values(storyboard?.videoPlans || {})) {
    for (const version of plan.generatedVersions || []) {
      const file = safeRelative(version.file || version.outputPath);
      if (!file) continue;
      const relative = file.startsWith("media/") ? file : `media/storyboard/${file}`;
      const clip = storyboard.clips?.[plan.clipId];
      metadata.set(relative, { clipId: plan.clipId, clipName: clip?.beat || plan.clipId, source: version.source || "director", version: version.v });
    }
  }
  const found = [];
  for (const [relative, details] of metadata.entries()) {
    if (!VIDEO_RE.test(relative)) continue;
    let disk;
    try { disk = resolveProjectMedia(project.slug, relative); } catch { continue; }
    const stat = fs.statSync(disk);
    found.push({ id: relative, file: relative, name: path.basename(relative), bytes: stat.size, updatedAt: stat.mtime.toISOString(), ...details });
  }
  return found
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readJobFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value.jobs) ? value.jobs : [];
  } catch {
    return [];
  }
}

function directorJobFile(slug) {
  return path.join(projectDir(slug), "director-generation-jobs.json");
}

function readProjectJobs(slug) {
  const combined = [
    ...readJobFile(path.join(projectDir(slug), "generation-jobs.json")),
    ...readJobFile(directorJobFile(slug))
  ];
  const byId = new Map(combined.map((job) => [job.id, job]));
  return [...byId.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 250);
}

export function projectJobs(slug) {
  return readProjectJobs(assertProjectSlug(slug));
}

export function upsertProjectJob(slug, job) {
  slug = assertProjectSlug(slug);
  loadProject(slug);
  const file = directorJobFile(slug);
  let ledger = { updatedAt: null, jobs: [] };
  if (fs.existsSync(file)) {
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  ledger.jobs = Array.isArray(ledger.jobs) ? ledger.jobs : [];
  const index = ledger.jobs.findIndex((candidate) => candidate.id === job.id);
  const serializable = clone(job);
  if (index >= 0) ledger.jobs[index] = { ...ledger.jobs[index], ...serializable };
  else ledger.jobs.push(serializable);
  ledger.jobs = ledger.jobs.slice(-250);
  ledger.updatedAt = new Date().toISOString();
  atomicJson(file, ledger);
  return serializable;
}

export function projectCatalog() {
  return listProjects().map((entry) => {
    const storyboard = readStoryboardMaybe(entry.slug);
    return {
      ...entry,
      hasStoryboard: Boolean(storyboard),
      storyboardClipCount: storyboard ? Object.keys(storyboard.clips || {}).length : 0,
      storyboardFrameCount: storyboard ? Object.keys(storyboard.frames || {}).length : 0
    };
  });
}

export function projectOverview(slug) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  const scenes = orderedStoryboardClips(storyboard);
  return {
    project: {
      slug: project.slug,
      name: project.name,
      category: project.category || "feature",
      updatedAt: project.updatedAt,
      settings: clone(project.settings || {}),
      sequenceClipCount: project.sequence?.clips?.length || 0
    },
    storyboard: storyboard ? {
      title: storyboard.title,
      updatedAt: storyboard.updatedAt,
      summary: storyboardSummary(storyboard),
      defaults: clone(storyboard.defaults || {}),
      clips: scenes,
      generatedFrames: Object.values(storyboard.frames || {})
        .map((frame) => ({ frame, resolved: resolvedFrameMedia(slug, frame) }))
        .filter((item) => item.resolved)
        .map(({ frame, resolved }) => ({ id: frame.id, ownerId: frame.ownerId, purpose: frame.purpose, status: frame.status, file: resolved.relative, prompt: frame.prompt, activeGeneratedVersion: frame.activeGeneratedVersion }))
    } : null,
    approvedMedia: approvedMedia(project),
    projectLibrary: projectLibraryMedia(project),
    generatedVideos: scanGeneratedVideos(project, storyboard),
    jobs: readProjectJobs(slug)
  };
}

export function sceneReferenceMedia(slug, clipId) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  const clip = storyboard?.clips?.[clipId];
  const plan = clip ? storyboard.videoPlans?.[clip.videoPlanId] : null;
  if (!clip || !plan) throw new Error(`Storyboard clip not found: ${clipId}`);
  const frameIds = [...new Set([clip.firstFrameId, ...(plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId)].filter(Boolean))];
  const assets = new Map((project.assets?.items || []).map((asset) => [asset.id, asset]));
  const references = [];
  const invalidReferences = [];
  const seen = new Set();
  for (const frameId of frameIds) {
    const frame = storyboard.frames?.[frameId];
    const bindings = Array.isArray(frame?.references)
      ? frame.references
      : Object.values(storyboard.referenceBindings || {}).filter((reference) => reference.targetId === frameId);
    for (const reference of bindings) {
      if (!reference?.id || seen.has(reference.id)) continue;
      seen.add(reference.id);
      const asset = assets.get(reference.assetId);
      const versionNumber = Number(reference.assetVersion || String(reference.assetVersionId || "").split(":v").at(-1) || 0);
      const version = (asset?.versions || []).find((item) => Number(item.v) === versionNumber);
      const invalidBase = { id: reference.id, assetId: reference.assetId, frameId, role: reference.role || "reference", required: Boolean(reference.required), version: versionNumber || null };
      if (!asset || !version) {
        invalidReferences.push({ ...invalidBase, reason: !asset ? "asset_missing" : "pinned_version_missing" });
        continue;
      }
      const exactVersionFiles = versionFiles(version);
      const sourceFile = reference.sourceAssetFile || version?.file || versionFiles(version)[0];
      if (!sourceFile) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_missing" });
        continue;
      }
      if (reference.sourceAssetFile && !exactVersionFiles.some((file) => path.basename(file).toLowerCase() === path.basename(sourceFile).toLowerCase())) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_not_in_version", file: reference.sourceAssetFile });
        continue;
      }
      const relative = safeRelative(sourceFile).startsWith("media/") ? safeRelative(sourceFile) : `media/assets/${safeRelative(sourceFile)}`;
      let disk;
      try { disk = resolveProjectMedia(slug, relative); }
      catch { invalidReferences.push({ ...invalidBase, reason: "pinned_file_unavailable", file: relative }); continue; }
      const stat = fs.statSync(disk);
      const expectedFile = (version.fileHashes || []).find((item) => path.basename(item.file || "").toLowerCase() === path.basename(sourceFile).toLowerCase()) || version.fileHashes?.[0];
      if (expectedFile?.bytes && Number(expectedFile.bytes) !== stat.size) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_size_mismatch", file: relative });
        continue;
      }
      if (expectedFile?.sha256 && String(expectedFile.sha256).toLowerCase() !== cachedFileSha256(disk, stat).toLowerCase()) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_hash_mismatch", file: relative });
        continue;
      }
      references.push({
        id: reference.id,
        assetId: reference.assetId,
        frameId,
        name: asset?.name || reference.sourceAssetKey || path.basename(sourceFile),
        category: asset?.categoryLabel || asset?.category || reference.role || "Reference",
        role: reference.role || "reference",
        required: Boolean(reference.required),
        useMode: reference.useMode || "reference",
        order: Number(reference.order) || 0,
        version: versionNumber || Number(version?.v) || 1,
        current: Number(asset?.activeVersion) === (versionNumber || Number(version?.v)),
        approved: asset?.approval?.status === "approved" && Number(asset.approval?.activeVersion || asset.activeVersion) === (versionNumber || Number(version?.v)),
        mediaType: asset?.mediaType || mediaKind(relative),
        file: relative,
        notes: reference.notes || "",
        cropRegion: reference.cropRegion || ""
      });
    }
  }
  references.sort((a, b) => a.frameId.localeCompare(b.frameId) || a.order - b.order || a.name.localeCompare(b.name));
  return {
    projectSlug: slug,
    clipId,
    frameIds,
    references,
    invalidReferences,
    referencesReady: !invalidReferences.some((reference) => reference.required)
  };
}

function storyboardWorkspace(baseWorkspace, project, storyboard, clipId) {
  const clip = storyboard.clips?.[clipId];
  if (!clip) throw new Error(`Storyboard clip not found: ${clipId}`);
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) throw new Error(`Storyboard video plan not found: ${clip.videoPlanId}`);
  const fps = Math.max(1, Number(storyboard.defaults?.fps) || Number(project.settings?.fps) || 24);
  const timeline = clone(plan.timelineData || {});
  timeline.global_prompt = String(plan.globalPrompt || timeline.global_prompt || "");
  timeline.segments = (plan.segmentIds || []).map((segmentId) => {
    const planned = storyboard.segments?.[segmentId];
    if (!planned) return null;
    const current = (timeline.segments || []).find((segment) => segment.id === segmentId) || {};
    const frame = planned.frameId ? storyboard.frames?.[planned.frameId] : null;
    const generated = resolvedFrameMedia(project.slug, frame);
    const segment = {
      ...current,
      id: planned.id,
      start: Number(planned.startFrame) || 0,
      length: Math.max(1, Number(planned.lengthFrames) || 1),
      prompt: String(planned.prompt || current.prompt || ""),
      type: String(planned.type || current.type || (planned.frameId ? "image" : "text")),
      isEndFrame: Boolean(planned.isEndFrame),
      storyboardFrameId: planned.frameId || null,
      missingGuide: Boolean(planned.frameId && !generated)
    };
    if (generated) {
      segment.projectMediaPath = generated.relative;
      segment.projectMediaBytes = generated.bytes;
      segment.projectMediaSha256 = generated.sha256;
      segment.fileName = path.basename(generated.relative);
      segment.imageFile = current.imageFile || frame.expectedInputPath || null;
      segment.guideStrength = Number(current.guideStrength ?? plan.guideStrength ?? 1);
    } else {
      delete segment.imageFile;
      delete segment.imageB64;
    }
    return segment;
  }).filter(Boolean);
  timeline.motionSegments = Array.isArray(timeline.motionSegments) ? timeline.motionSegments : [];
  timeline.audioSegments = Array.isArray(timeline.audioSegments) ? timeline.audioSegments : [];
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = Number(clip.durationFrames) || timeline.segments.reduce((max, segment) => Math.max(max, segment.start + segment.length), 1);
  const selected = timeline.segments.find((segment) => segment.type === "image") || timeline.segments[0] || null;
  const next = clone(baseWorkspace);
  next.timeline = timeline;
  next.selectedSegmentId = selected?.id || null;
  next.playheadFrame = Number(selected?.start) || 0;
  next.settings.frameRate = fps;
  next.settings.customWidth = Math.max(32, Number(storyboard.defaults?.workingWidth) || Number(project.settings?.width) || next.settings.customWidth);
  next.settings.customHeight = Math.max(32, Number(storyboard.defaults?.workingHeight) || Number(project.settings?.height) || next.settings.customHeight);
  next.settings.queueMode = "timeline";
  next.settings.outputPrefix = `Premiere316/${project.slug}/director/${clip.id}`;
  next.stats = {
    durationFrames: timeline.normalDurationFrames,
    durationSeconds: timeline.normalDurationFrames / fps
  };
  const firstNegative = (plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId).filter(Boolean).map((id) => storyboard.frames?.[id]?.negativePrompt).find(Boolean);
  if (firstNegative) next.settings.negativePrompt = firstNegative;
  next.premiere = {
    projectSlug: project.slug,
    projectName: project.name,
    source: "storyboard",
    clipId: clip.id,
    sceneId: clip.sceneId,
    videoPlanId: clip.videoPlanId,
    storyboardUpdatedAt: storyboard.updatedAt,
    planFingerprint: storyboardPlanFingerprintValue(storyboard, clip.id),
    loadedAt: new Date().toISOString()
  };
  return next;
}

function sequenceWorkspace(baseWorkspace, project, clipId) {
  const clip = findClip(project, clipId);
  if (!clip) throw new Error(`Project sequence clip not found: ${clipId}`);
  const fps = Math.max(1, Number(project.settings?.fps) || 24);
  const total = Math.max(1, Math.round(Number(clip.durationSec || 1) * fps));
  const guides = [...(clip.guides || [])].sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0));
  const mediaSegments = guides.map((guide, index) => {
    const start = Math.max(0, Number(guide.frame) || 0);
    const nextStart = index + 1 < guides.length ? Math.max(start + 1, Number(guides[index + 1].frame) || total) : total;
    const relative = safeRelative(guide.file).startsWith("media/") ? safeRelative(guide.file) : `media/frames/${safeRelative(guide.file)}`;
    const exists = projectMediaExists(project.slug, relative);
    return {
      id: guide.id,
      start,
      length: Math.max(1, nextStart - start),
      prompt: String(guide.prompt || ""),
      type: exists ? "image" : "text",
      projectMediaPath: exists ? relative : undefined,
      fileName: path.basename(guide.file || "Guide"),
      guideStrength: Number(guide.strength ?? 1),
      missingGuide: !exists
    };
  });
  const promptSegments = (clip.segments || []).map((segment) => ({
    id: segment.id,
    start: Number(segment.startFrame) || 0,
    length: Math.max(1, Number(segment.endFrame) - Number(segment.startFrame)),
    prompt: String(segment.prompt || ""),
    type: "text"
  }));
  const next = clone(baseWorkspace);
  next.timeline = {
    ...next.timeline,
    global_prompt: String(clip.globalPrompt || ""),
    segments: [...mediaSegments, ...promptSegments].sort((a, b) => a.start - b.start),
    motionSegments: [],
    audioSegments: [],
    normalStartFrame: 0,
    normalDurationFrames: total
  };
  next.selectedSegmentId = mediaSegments[0]?.id || promptSegments[0]?.id || null;
  next.playheadFrame = 0;
  next.settings.frameRate = fps;
  next.settings.customWidth = Number(project.settings?.width) || next.settings.customWidth;
  next.settings.customHeight = Number(project.settings?.height) || next.settings.customHeight;
  next.settings.outputPrefix = `Premiere316/${project.slug}/director/${clip.id}`;
  next.stats = { durationFrames: total, durationSeconds: total / fps };
  next.premiere = { projectSlug: project.slug, projectName: project.name, source: "sequence", clipId: clip.id, loadedAt: new Date().toISOString() };
  return next;
}

export function workspaceForProjectClip(baseWorkspace, slug, clipId) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  if (storyboard?.clips?.[clipId]) return storyboardWorkspace(baseWorkspace, project, storyboard, clipId);
  return sequenceWorkspace(baseWorkspace, project, clipId);
}

export function syncWorkspaceToPremiere(workspace) {
  const binding = workspace?.premiere;
  if (!binding?.projectSlug || !binding?.clipId) throw new Error("Load a Premiere project scene before saving to Premiere");
  if (binding.source === "storyboard") {
    assertProjectSlug(binding.projectSlug);
    const storyboard = loadStoryboard(binding.projectSlug);
    if (binding.planFingerprint && storyboardPlanFingerprintValue(storyboard, binding.clipId) !== binding.planFingerprint) {
      const error = new Error("This storyboard changed in Premiere after it was loaded. Reload the scene before publishing Director edits.");
      error.code = "STALE_STORYBOARD";
      throw error;
    }
    const clip = storyboard.clips?.[binding.clipId];
    const plan = clip ? storyboard.videoPlans?.[clip.videoPlanId] : null;
    if (!clip || !plan) throw new Error("The bound Premiere storyboard scene no longer exists");
    const previousPlanFingerprint = storyboardPlanFingerprintValue(storyboard, clip.id);
    const owned = new Set(plan.segmentIds || []);
    const timelineById = new Map((workspace.timeline?.segments || []).map((segment) => [segment.id, segment]));
    for (const segmentId of owned) {
      const target = storyboard.segments?.[segmentId];
      const incoming = timelineById.get(segmentId);
      if (!target || !incoming) continue;
      target.prompt = String(incoming.prompt || "");
      target.startFrame = Math.max(0, Math.round(Number(incoming.start) || 0));
      target.lengthFrames = Math.max(1, Math.round(Number(incoming.length) || 1));
    }
    const ordered = Array.from(owned).map((id) => storyboard.segments?.[id]).filter(Boolean).sort((a, b) => a.startFrame - b.startFrame);
    let cursor = 0;
    for (const segment of ordered) {
      if (segment.startFrame !== cursor) throw new Error(`Storyboard timing must remain contiguous: ${segment.id} starts at ${segment.startFrame}, expected ${cursor}`);
      cursor += segment.lengthFrames;
    }
    if (cursor !== Number(clip.durationFrames)) throw new Error(`Storyboard duration is locked to ${clip.durationFrames} frames; Director segments currently total ${cursor}. Keep the scene duration unchanged.`);
    plan.globalPrompt = String(workspace.timeline?.global_prompt || "");
    plan.guideStrength = String(workspace.settings?.guideStrength || plan.guideStrength || "1.00");
    plan.resizeMethod = String(workspace.settings?.resizeMethod || plan.resizeMethod || "maintain aspect ratio");
    plan.localPrompts = (plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.prompt || "").join(" | ");
    plan.segmentLengths = (plan.segmentIds || []).map((id) => Math.max(1, Number(storyboard.segments?.[id]?.lengthFrames) || 1)).join(",");
    plan.timelineData = clone(workspace.timeline);
    plan.timelineData.segments = (plan.timelineData.segments || []).filter((segment) => owned.has(segment.id));
    for (const segment of plan.timelineData.segments || []) {
      delete segment.projectMediaPath;
      delete segment.projectMediaBytes;
      delete segment.projectMediaSha256;
      delete segment.missingGuide;
      delete segment.storyboardFrameId;
    }
    const nextPlanFingerprint = storyboardPlanFingerprintValue(storyboard, clip.id);
    if (nextPlanFingerprint !== previousPlanFingerprint) {
      clip.renderStatus = "not_started";
      clip.renderError = null;
      plan.status = "needs_render";
      plan.activeGeneratedVersion = null;
      plan.generatedFile = null;
      plan.generatedInputPath = null;
      plan.lastError = null;
      plan.renderStaleAt = new Date().toISOString();
    }
    plan.inputHash = nextPlanFingerprint;
    storyboard.updatedAt = new Date().toISOString();
    saveStoryboard(binding.projectSlug, storyboard);
    return { projectSlug: binding.projectSlug, clipId: clip.id, videoPlanId: plan.id, updatedAt: storyboard.updatedAt, changed: nextPlanFingerprint !== previousPlanFingerprint, planFingerprint: nextPlanFingerprint };
  }
  assertProjectSlug(binding.projectSlug);
  const project = loadProject(binding.projectSlug);
  const clip = findClip(project, binding.clipId);
  if (!clip) throw new Error("The bound Premiere sequence clip no longer exists");
  clip.globalPrompt = String(workspace.timeline?.global_prompt || "");
  const incoming = new Map((workspace.timeline?.segments || []).map((segment) => [segment.id, segment]));
  for (const segment of clip.segments || []) {
    const value = incoming.get(segment.id);
    if (!value) continue;
    segment.prompt = String(value.prompt || "");
    segment.startFrame = Math.max(0, Math.round(Number(value.start) || 0));
    segment.endFrame = segment.startFrame + Math.max(1, Math.round(Number(value.length) || 1));
  }
  saveProject(project);
  return { projectSlug: binding.projectSlug, clipId: clip.id, updatedAt: project.updatedAt };
}

export function markDirectorRender(slug, binding, update) {
  if (binding?.source !== "storyboard") return null;
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[binding.clipId];
  if (!clip) return null;
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) return null;
  if (update.expectedFingerprint && storyboardPlanFingerprintValue(storyboard, clip.id) !== update.expectedFingerprint) {
    const error = new Error("The Premiere scene changed before render registration");
    error.code = "STALE_RENDER";
    throw error;
  }
  const promptDoesNotOwnAttempt = update.promptId && plan.activeRenderPromptId !== update.promptId;
  if (update.status === "done" && update.version && promptDoesNotOwnAttempt) {
    const error = new Error("A newer Director render owns this Premiere scene; this completed output was not registered");
    error.code = "STALE_RENDER";
    throw error;
  }
  if (["error", "stale"].includes(update.status) && promptDoesNotOwnAttempt) return clip;
  if (update.status === "queued") {
    plan.activeRenderPromptId = update.promptId || null;
    plan.status = "queued";
  }
  if (update.status === "stale") {
    clip.renderStatus = "not_started";
    plan.status = "needs_render";
    plan.activeRenderPromptId = null;
  } else {
    if (!(update.status === "partial" && plan.activeRenderPromptId)) {
      clip.renderStatus = update.status === "done" ? "completed" : update.status === "error" ? "failed" : update.status;
    }
    if (update.status === "error") plan.activeRenderPromptId = null;
  }
  if (update.error !== undefined) {
    clip.renderError = update.error;
    plan.lastError = update.error;
  }
  if (update.version) {
    clip.renderError = null;
    plan.generatedVersions = Array.isArray(plan.generatedVersions) ? plan.generatedVersions : [];
    const duplicate = plan.generatedVersions.find((version) => String(version.comfyPromptId || version.promptId || "") === String(update.version.comfyPromptId || update.version.promptId || ""));
    const committedVersion = duplicate || update.version;
    if (!duplicate) {
      if (plan.generatedVersions.some((version) => Number(version.v) === Number(update.version.v))) throw new Error(`Storyboard render version v${update.version.v} already exists`);
      plan.generatedVersions.push(update.version);
    }
    if (update.status === "done") {
      plan.activeGeneratedVersion = committedVersion.v;
      plan.generatedFile = path.basename(committedVersion.file);
      plan.generatedInputPath = committedVersion.file;
      plan.status = "rendered";
    }
    if (update.status === "done" && (!update.promptId || plan.activeRenderPromptId === update.promptId)) {
      plan.activeRenderPromptId = null;
    }
    plan.lastError = null;
    plan.generationCompletedAt = committedVersion.createdAt;
  }
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return clip;
}

export function nextStoryboardRenderVersion(slug, clipId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[clipId];
  const versions = storyboard.videoPlans?.[clip?.videoPlanId]?.generatedVersions || [];
  return Math.max(0, ...versions.map((version) => Number(version.v) || 0)) + 1;
}

async function streamedFileSha256(file) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function registeredRenderResult(slug, record, relativeFile, versionNumber) {
  const relative = safeRelative(relativeFile).startsWith("media/")
    ? safeRelative(relativeFile)
    : `media/clips/${path.basename(String(relativeFile || ""))}`;
  try {
    const disk = resolveProjectMedia(slug, relative);
    const stat = fs.statSync(disk);
    if (!stat.isFile() || !stat.size) throw new Error("registered file is empty");
    const expected = (record?.fileHashes || []).find((item) =>
      path.basename(String(item.file || "")).toLowerCase() === path.basename(disk).toLowerCase()
    ) || record?.fileHashes?.[0] || null;
    if (expected?.bytes && Number(expected.bytes) !== stat.size) {
      throw new Error(`registered file has ${stat.size} bytes; expected ${expected.bytes}`);
    }
    const sha256 = await streamedFileSha256(disk);
    if (expected?.sha256 && String(expected.sha256).toLowerCase() !== sha256.toLowerCase()) {
      throw new Error("registered file checksum does not match its Premiere provenance record");
    }
    return { version: versionNumber, file: relative, disk, bytes: stat.size, sha256, valid: true, record };
  } catch (error) {
    return { version: versionNumber, file: relative, disk: null, valid: false, error: String(error.message || error), record };
  }
}

export async function findDirectorRenderByPrompt(slug, binding, promptId) {
  slug = assertProjectSlug(slug);
  const expected = String(promptId || "");
  if (!expected || !binding?.clipId) return null;
  if (binding.source === "storyboard") {
    const storyboard = loadStoryboard(slug);
    const clip = storyboard.clips?.[binding.clipId];
    const plan = storyboard.videoPlans?.[clip?.videoPlanId];
    const version = (plan?.generatedVersions || []).find((item) => String(item.comfyPromptId || item.promptId || "") === expected);
    return version
      ? await registeredRenderResult(slug, version, version.file || version.generatedInputPath || version.outputFile, Number(version.v) || 1)
      : null;
  }
  const project = loadProject(slug);
  const clip = findClip(project, binding.clipId);
  const version = (clip?.versions || []).find((item) => String(item.promptId || item.comfyPromptId || "") === expected);
  return version
    ? await registeredRenderResult(slug, version, version.file ? `media/clips/${version.file}` : "", Number(version.v) || 1)
    : null;
}

function storyboardPlanFingerprintValue(storyboard, clipId) {
  const clip = storyboard.clips?.[clipId];
  const plan = storyboard.videoPlans?.[clip?.videoPlanId];
  if (!clip || !plan) throw new Error(`Storyboard clip not found: ${clipId}`);
  const frameIds = [...new Set([
    clip.firstFrameId,
    ...(plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId)
  ].filter(Boolean))];
  const payload = {
    clip: { id: clip.id, durationFrames: clip.durationFrames, firstFrameId: clip.firstFrameId, videoPlanId: clip.videoPlanId },
    plan: {
      id: plan.id,
      globalPrompt: plan.globalPrompt,
      guideStrength: plan.guideStrength,
      resizeMethod: plan.resizeMethod,
      segmentIds: plan.segmentIds,
      localPrompts: plan.localPrompts,
      segmentLengths: plan.segmentLengths,
      timelineData: plan.timelineData
    },
    segments: (plan.segmentIds || []).map((id) => storyboard.segments?.[id]),
    frames: frameIds.map((id) => {
      const frame = storyboard.frames?.[id];
      const active = frame ? (frame.generatedVersions || []).find((version) => Number(version.v) === Number(frame.activeGeneratedVersion)) : null;
      return frame ? {
        id,
        activeGeneratedVersion: frame.activeGeneratedVersion,
        generatedFile: frame.generatedFile,
        inputHash: frame.inputHash,
        generationFingerprint: frame.generationFingerprint,
        activeFileHashes: active?.fileHashes || []
      } : null;
    })
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function storyboardPlanFingerprint(slug, clipId) {
  slug = assertProjectSlug(slug);
  return storyboardPlanFingerprintValue(loadStoryboard(slug), clipId);
}

export function mediaKind(relative) {
  if (IMAGE_RE.test(relative)) return "image";
  if (VIDEO_RE.test(relative)) return "video";
  if (AUDIO_RE.test(relative)) return "audio";
  return "file";
}
