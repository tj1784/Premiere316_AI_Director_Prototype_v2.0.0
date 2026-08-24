import fs from "fs";
import path from "path";
import crypto from "crypto";

import { extractVideoFrameExact, probeMediaExact } from "./ffmpeg.js";
import { mediaDir } from "./paths.js";
import { canonicalStoryboardReferenceRole } from "./storyboard.js";

const VIDEO_TAKE_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

function framesOf(sec, fps = 24) {
  const seconds = Number(sec);
  const rate = Number(fps || 24);
  if (!Number.isFinite(seconds) || !Number.isFinite(rate)) return 0;
  return Math.max(0, Math.round(seconds * rate));
}

function findClip(project, clipId) {
  return project.sequence?.clips?.find((clip) => clip.id === clipId) || null;
}

function registerFrame(project, filename, displayName, extra = {}) {
  const existing = (project.frames || []).find((frame) => frame.file === filename);
  if (existing) return existing;
  const entry = {
    id: crypto.randomUUID(),
    file: filename,
    name: displayName || filename,
    importedAt: new Date().toISOString(),
    ...extra
  };
  project.frames = project.frames || [];
  project.frames.push(entry);
  return entry;
}

function syncGuideAliases(clip, fps = 24) {
  const total = framesOf(clip.durationSec, fps);
  clip.guides = (clip.guides || []).sort((a, b) => a.frame - b.frame);
  const first = clip.guides.find((guide) => guide.role === "first") || clip.guides.find((guide) => guide.frame === 0);
  const last = [...clip.guides].reverse().find((guide) => guide.role === "last");
  if (first) {
    first.frame = 0;
    first.role = "first";
    clip.firstFrame = { file: first.file };
  }
  if (last) {
    last.frame = Math.max(0, total - 1);
    last.role = "last";
    clip.endFrame = { file: last.file };
  } else {
    clip.endFrame = null;
  }
}

export const CONTINUITY_SOURCE = "take-continuity";
export const CONTINUITY_GENERATOR = "extracted-take-frame";
export const CARRY_FORWARD_ROLES = Object.freeze(["identity", "wardrobe"]);
const CARRY_FORWARD_ROLE_SET = new Set(CARRY_FORWARD_ROLES);
const DROPPED_ROLES = new Set(["location", "prop", "crowd", "atmosphere"]);

export class ContinuityError extends Error {
  constructor(message, { code = "CONTINUITY_ERROR", status = 400 } = {}) {
    super(message);
    this.name = "ContinuityError";
    this.code = code;
    this.status = status;
  }
}

function continuityError(message, code, status = 400) {
  throw new ContinuityError(message, { code, status });
}

function textBlob(value) {
  return String(value || "").trim().toLowerCase();
}

export function takeIsMiniMaxGenerator(take) {
  if (!take || typeof take !== "object") return false;
  const fields = [
    take.generator,
    take.source,
    take.provider,
    take.workflowId,
    take.model,
    take.engine,
    take.family,
    take.h3Mode
  ];
  const hay = fields.map(textBlob).join(" ");
  return hay.includes("minimax")
    || hay.includes("hailuo")
    || textBlob(take.provider) === "minimax_h3_local"
    || Boolean(take.h3Mode);
}

function positiveDecodedFrameCount(value) {
  if (value == null || value === "" || String(value).toUpperCase() === "N/A") return null;
  const counted = Number(value);
  return Number.isInteger(counted) && counted > 0 ? counted : null;
}

export function lastDecodedFrameIndex(probe) {
  const video = probe?.video || {};
  const counted = positiveDecodedFrameCount(video.nb_frames) ?? positiveDecodedFrameCount(video.nb_read_frames);
  if (counted) return counted - 1;
  continuityError(
    "Cannot determine the last decoded frame; ffprobe did not report nb_frames",
    "DECODED_FRAME_INDEX_UNKNOWN"
  );
}

export function canonicalContinuityRole(value) {
  return canonicalStoryboardReferenceRole(value) || textBlob(value).replace(/[\s-]+/g, "_") || null;
}

function exactAssetVersion(reference) {
  const direct = Number(reference?.assetVersion);
  if (Number.isInteger(direct) && direct >= 1) return direct;
  const match = String(reference?.assetVersionId || "").match(/:v(\d+)$/i);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isInteger(version) && version >= 1 ? version : null;
}

export function carryForwardReferences(references) {
  const seen = new Set();
  const carried = [];
  for (const reference of Array.isArray(references) ? references : []) {
    const role = canonicalContinuityRole(reference?.role);
    if (!CARRY_FORWARD_ROLE_SET.has(role)) continue;
    const assetId = String(reference.assetId || "").trim();
    const assetVersion = exactAssetVersion(reference);
    if (!assetId || assetVersion == null) continue;
    const key = `${assetId}:${assetVersion}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    carried.push({
      assetId,
      assetVersion,
      role
    });
  }
  return carried;
}

function collectReferences(...lists) {
  const merged = [];
  for (const list of lists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return merged;
}

export function orderedStoryboardClipIds(storyboard) {
  const ids = [];
  for (const chapterId of storyboard?.chapterOrder || []) {
    const chapter = storyboard.chapters?.[chapterId];
    for (const sceneId of chapter?.sceneIds || []) {
      const scene = storyboard.scenes?.[sceneId];
      for (const clipId of scene?.clipIds || []) {
        if (clipId && storyboard.clips?.[clipId]) ids.push(clipId);
      }
    }
  }
  return ids;
}

function orderedSequenceClipIds(project) {
  return (project?.sequence?.clips || []).map((clip) => clip.id).filter(Boolean);
}

export function findSequenceClip(project, clipId) {
  if (!clipId) return null;
  const wanted = String(clipId);
  return findClip(project, wanted)
    || project.sequence?.clips?.find((clip) => String(clip.name) === wanted)
    || project.sequence?.clips?.find((clip) => String(clip.storyboardClipId) === wanted)
    || project.sequence?.clips?.find((clip) => String(clip.screenplayShot?.sourceShotId) === wanted)
    || null;
}

function takeVersionNumber(take) {
  const version = Number(take?.v ?? take?.version ?? take?.takeVersion);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function takeMatchesVersion(take, takeVersion) {
  if (takeVersion == null || takeVersion === "") return true;
  const wanted = String(takeVersion);
  if (String(take?.id || "") === wanted) return true;
  const version = takeVersionNumber(take);
  return version != null && String(version) === wanted;
}

function idsMatch(left, right) {
  return left != null && right != null && String(left) !== "" && String(left) === String(right);
}

function storyboardTakeOwner(take, storyboardClip, storyboard) {
  const plan = storyboard?.videoPlans?.[storyboardClip?.videoPlanId];
  if (take?.origin === "storyboard-video-plan") return plan || null;
  const segment = storyboardLastSegment(storyboard, storyboardClip);
  if (take?.origin === "storyboard-timeline") {
    return plan?.timelineData?.segments?.find((entry) => String(entry?.id) === String(segment?.id)) || null;
  }
  return segment;
}

function storyboardTakeIsSelected(take, storyboardClip, storyboard) {
  const owner = storyboardTakeOwner(take, storyboardClip, storyboard);
  if (!owner) return false;
  if (idsMatch(owner.activeTakeId, take?.id)) return true;
  const version = takeVersionNumber(take);
  if (version != null && Number(owner.activeGeneratedVersion) === version) return true;
  if (take?.origin === "storyboard-video-plan") {
    return version != null
      && Number(owner.activeGeneratedVersion) === version
      && (owner.status === "generated" || storyboardClip?.renderStatus === "completed");
  }
  return false;
}

function takeIsApproved(take, { sequenceClip, storyboardClip, storyboard } = {}) {
  if (take?.approved === true) return true;
  if (textBlob(take?.approvalStatus) === "approved") return true;
  if (textBlob(take?.approval?.status) === "approved") return true;
  const version = takeVersionNumber(take);
  if (sequenceClip?.approvedTakeVersion != null && Number(sequenceClip.approvedTakeVersion) === version) return true;
  if (take.kind === "version" && Number(sequenceClip?.activeVersion) === version && (sequenceClip.status === "done" || sequenceClip.approved === true)) {
    return true;
  }
  if (take.kind === "rangeVersion" && take?.active !== false && (sequenceClip?.status === "done" || sequenceClip?.status === "ranges-ready" || sequenceClip?.approved === true)) {
    return true;
  }
  if (take.kind === "storyboard") return storyboardTakeIsSelected(take, storyboardClip, storyboard);
  return false;
}

function describeTake(take, kind, origin) {
  return {
    ...take,
    kind,
    origin,
    v: takeVersionNumber(take) || 1
  };
}

function storyboardLastSegment(storyboard, clip) {
  if (!storyboard || !clip) return null;
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  const segmentIds = Array.isArray(plan?.segmentIds) ? plan.segmentIds : [];
  const lastId = segmentIds.at(-1);
  return lastId ? storyboard.segments?.[lastId] || null : null;
}

function takeVideoFile(take) {
  if (VIDEO_TAKE_RE.test(String(take?.file || ""))) return take.file;
  if (VIDEO_TAKE_RE.test(String(take?.generatedInputPath || ""))) return take.generatedInputPath;
  const listed = Array.isArray(take?.files)
    ? take.files.find((file) => VIDEO_TAKE_RE.test(String(file?.file || file?.filename || file || "")))
    : null;
  if (listed) return listed.file || listed.filename || listed;
  if (VIDEO_TAKE_RE.test(String(take?.outputFile || ""))) return take.outputFile;
  if (VIDEO_TAKE_RE.test(String(take?.previewFile || ""))) return take.previewFile;
  return take?.file || take?.generatedInputPath || take?.outputFile || take?.previewFile || null;
}

export function listCandidateTakes(project, { sequenceClip, storyboard, storyboardClip } = {}) {
  const takes = [];
  if (sequenceClip) {
    for (const take of sequenceClip.rangeVersions || []) {
      takes.push(describeTake(take, "rangeVersion", "sequence"));
    }
    for (const take of sequenceClip.versions || []) {
      takes.push(describeTake(take, "version", "sequence"));
    }
  }
  const plan = storyboard?.videoPlans?.[storyboardClip?.videoPlanId];
  if (plan) {
    for (const take of plan.generatedVersions || []) {
      takes.push(describeTake({ ...take, file: takeVideoFile(take) }, "storyboard", "storyboard-video-plan"));
    }
  }
  const segment = storyboardLastSegment(storyboard, storyboardClip);
  if (segment) {
    for (const take of segment.generatedVersions || []) {
      takes.push(describeTake({ ...take, file: takeVideoFile(take) }, "storyboard", "storyboard-segment"));
    }
    const timelineSegment = plan?.timelineData?.segments?.find((entry) => String(entry?.id) === String(segment.id));
    for (const take of timelineSegment?.generatedTakes || []) {
      takes.push(describeTake({ ...take, file: takeVideoFile(take) }, "storyboard", "storyboard-timeline"));
    }
  }
  return takes;
}

function preferredApprovedTake(approved, sequenceClip) {
  const activeFull = approved.find((take) => take.kind === "version" && Number(sequenceClip?.activeVersion) === Number(take.v));
  if (activeFull) return activeFull;
  const anyFull = approved.filter((take) => take.kind === "version").at(-1);
  if (anyFull) return anyFull;

  const ranges = approved.filter((take) => take.kind === "rangeVersion" && take.active !== false);
  if (ranges.length) {
    return [...ranges].sort((left, right) => {
      const byEnd = (Number(left.endFrame) || 0) - (Number(right.endFrame) || 0);
      if (byEnd) return byEnd;
      return (Number(left.v) || 0) - (Number(right.v) || 0);
    }).at(-1);
  }

  const videoPlan = approved.filter((take) => take.origin === "storyboard-video-plan").at(-1);
  if (videoPlan) return videoPlan;
  const segmentTake = approved.filter((take) => take.origin === "storyboard-segment").at(-1);
  if (segmentTake) return segmentTake;
  return approved.filter((take) => take.kind === "storyboard").at(-1) || approved.at(-1);
}

export function resolveApprovedTake(project, { sequenceClip, storyboard, storyboardClip, takeVersion } = {}) {
  const takes = listCandidateTakes(project, { sequenceClip, storyboard, storyboardClip });
  if (!takes.length) {
    continuityError("No take exists on this clip to extract a continuity frame from", "TAKE_NOT_FOUND", 409);
  }

  const requested = takes.filter((take) => takeMatchesVersion(take, takeVersion));
  if (takeVersion != null && takeVersion !== "" && !requested.length) {
    continuityError(`Take version ${takeVersion} was not found on this clip`, "TAKE_NOT_FOUND", 404);
  }

  const pool = requested.length ? requested : takes;
  const minimax = pool.filter(takeIsMiniMaxGenerator);
  const usable = pool.filter((take) => !takeIsMiniMaxGenerator(take));

  if (!usable.length && minimax.length) {
    continuityError(
      "Continuity frames are extracted evidence from an approved take. MiniMax is never the frame generator.",
      "MINIMAX_NOT_FRAME_GENERATOR",
      409
    );
  }

  const approved = usable.filter((take) => takeIsApproved(take, { sequenceClip, storyboardClip, storyboard }));
  if (!approved.length) {
    continuityError(
      "Promote last frame requires an already-approved take (clip rangeVersion or full version)",
      "TAKE_NOT_APPROVED",
      409
    );
  }

  return preferredApprovedTake(approved, sequenceClip);
}

function resolveNextClip({ project, storyboard, sourceSequenceClip, sourceStoryboardClip, nextClipId }) {
  if (nextClipId) {
    const sequence = findSequenceClip(project, nextClipId);
    const board = storyboard?.clips?.[nextClipId] || null;
    if (!sequence && !board) continuityError(`Next clip not found: ${nextClipId}`, "NEXT_CLIP_NOT_FOUND", 404);
    return { sequenceClip: sequence, storyboardClip: board, id: sequence?.id || board?.id || nextClipId };
  }

  if (sourceStoryboardClip && storyboard) {
    const ids = orderedStoryboardClipIds(storyboard);
    const index = ids.indexOf(sourceStoryboardClip.id);
    if (index >= 0 && index + 1 < ids.length) {
      const id = ids[index + 1];
      return {
        sequenceClip: findSequenceClip(project, id),
        storyboardClip: storyboard.clips[id],
        id
      };
    }
  }

  if (sourceSequenceClip) {
    const ids = orderedSequenceClipIds(project);
    const index = ids.indexOf(sourceSequenceClip.id);
    if (index >= 0 && index + 1 < ids.length) {
      const id = ids[index + 1];
      return {
        sequenceClip: findSequenceClip(project, id),
        storyboardClip: storyboard?.clips?.[id] || null,
        id
      };
    }
  }

  continuityError("There is no next shot in sequence to receive the first continuity guide", "NEXT_CLIP_NOT_FOUND", 409);
}

function relativeMediaPath(value) {
  const relative = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return relative;
}

function chapterFolderFromClip(clip) {
  for (const value of [clip?.id, clip?.name, clip?.chapterId, clip?.sceneId, clip?.storyboardClipId]) {
    const match = String(value || "").match(/(?:^|[^a-z0-9])((?:H|MV)\d{2})(?=$|[^a-z0-9])/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function takeFileHints(take) {
  const hints = [];
  const push = (value) => {
    const text = String(value || "").trim();
    if (text && !hints.includes(text)) hints.push(text);
  };
  push(take?.file);
  push(take?.generatedInputPath);
  push(take?.outputFile);
  push(take?.previewFile);
  for (const file of Array.isArray(take?.files) ? take.files : []) {
    if (typeof file === "string") push(file);
    else if (file && typeof file === "object") push(file.file || file.filename);
  }
  return hints.filter((value) => VIDEO_TAKE_RE.test(value) || !/\.[a-z0-9]+$/i.test(path.posix.basename(value.replaceAll("\\", "/"))));
}

function pathInside(root, disk) {
  const resolvedRoot = path.resolve(root);
  const resolvedDisk = path.resolve(disk);
  return resolvedDisk === resolvedRoot || resolvedDisk.startsWith(`${resolvedRoot}${path.sep}`);
}

function takeDiskPath(project, take, resolveMediaDir, { sequenceClip, storyboardClip } = {}) {
  const clipsRoot = path.resolve(resolveMediaDir(project, "clips"));
  const storyboardRoot = path.resolve(resolveMediaDir(project, "storyboard"));
  const chapter = chapterFolderFromClip(sequenceClip) || chapterFolderFromClip(storyboardClip);
  const candidates = [];
  const add = (root, relative) => {
    const rel = relativeMediaPath(relative);
    if (!rel) return;
    const disk = path.resolve(root, ...rel.split("/"));
    if (pathInside(root, disk) && !candidates.includes(disk)) candidates.push(disk);
  };

  for (const hint of takeFileHints(take)) {
    const rel = relativeMediaPath(hint);
    if (!rel) continue;
    if (/^media\/clips\//i.test(rel)) add(clipsRoot, rel.replace(/^media\/clips\//i, ""));
    else if (/^media\/storyboard\//i.test(rel)) add(storyboardRoot, rel.replace(/^media\/storyboard\//i, ""));
    else if (/^clips\//i.test(rel)) add(clipsRoot, rel.replace(/^clips\//i, ""));
    else if (/^storyboard\//i.test(rel)) add(storyboardRoot, rel.replace(/^storyboard\//i, ""));
    else {
      add(clipsRoot, rel);
      if (chapter && !rel.includes("/")) add(clipsRoot, `${chapter}/${rel}`);
      add(storyboardRoot, path.posix.basename(rel));
    }
  }

  for (const disk of candidates) {
    if (fs.existsSync(disk) && fs.statSync(disk).isFile()) return disk;
  }
  continuityError(`Approved take file is missing: ${takeFileHints(take)[0] || "missing"}`, "TAKE_FILE_MISSING", 409);
}

function safeToken(value, fallback = "clip") {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || fallback;
}

function attachFirstGuide(project, clip, filename, { source, decodedFrameIndex, sourceClipId, sourceTakeVersion }) {
  const fps = project.settings?.fps || 24;
  clip.guides = (clip.guides || []).filter((guide) => guide.role !== "first");
  const guide = {
    id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: "first",
    frame: 0,
    file: filename,
    prompt: "",
    strength: 1,
    seed: null,
    source,
    decodedFrameIndex,
    sourceClipId,
    sourceTakeVersion,
    versions: [{ v: 1, file: filename, createdAt: new Date().toISOString() }],
    activeVersion: 1,
    createdAt: new Date().toISOString()
  };
  clip.guides.push(guide);
  syncGuideAliases(clip, fps);
  if (clip.versions?.length) clip.status = "dirty";
  else if (!clip.status || clip.status === "ready") clip.status = "ready";
  return guide;
}

function mergeCarriedReferences(existing, carried) {
  // Next shot keeps its own non-identity/wardrobe refs; identity/wardrobe come from the source take only.
  const nonCarry = (existing || []).filter((reference) => {
    const role = canonicalContinuityRole(reference?.role);
    return role && !CARRY_FORWARD_ROLE_SET.has(role);
  });
  return [...carried, ...nonCarry];
}

function storyboardSourceReferences(storyboard, clip) {
  if (!storyboard || !clip) return [];
  const frame = storyboard.frames?.[clip.firstFrameId];
  const planBindings = Object.values(storyboard.referenceBindings || {})
    .filter((binding) => binding?.targetKind === "video_plan" && binding?.targetId === clip.videoPlanId);
  return collectReferences(frame?.references, clip.references, planBindings);
}

function attachStoryboardFirstGuide(storyboard, nextClip, {
  filename,
  decodedFrameIndex,
  sourceClipId,
  sourceTakeVersion,
  bindings,
  sha256,
  bytes
}) {
  const firstFrameId = nextClip.firstFrameId;
  if (!firstFrameId || !storyboard.frames?.[firstFrameId]) {
    continuityError(`Next storyboard clip has no first-frame target: ${nextClip.id}`, "NEXT_CLIP_NOT_FOUND", 409);
  }
  const frame = storyboard.frames[firstFrameId];
  const versionNumber = Math.max(0, ...(frame.generatedVersions || []).map((version) => Number(version.v) || 0)) + 1;
  const record = {
    v: versionNumber,
    files: [filename],
    file: filename,
    mediaType: "image",
    source: CONTINUITY_SOURCE,
    generator: CONTINUITY_GENERATOR,
    sourceClipId,
    sourceTakeVersion,
    sourceFrameIndex: decodedFrameIndex,
    fileHashes: [{ file: filename, sha256, bytes, extension: ".png" }],
    createdAt: new Date().toISOString()
  };
  frame.generatedVersions = Array.isArray(frame.generatedVersions) ? frame.generatedVersions : [];
  frame.generatedVersions.push(record);
  frame.activeGeneratedVersion = versionNumber;
  frame.generatedFile = filename;
  frame.generatedInputPath = `media/storyboard/${filename}`;
  frame.generatedAssetId = frame.id;
  frame.generatedAssetVersionId = `${frame.id}:v${versionNumber}`;
  frame.status = "generated";
  frame.lastError = null;
  frame.purpose = frame.purpose || "first_frame";
  frame.continuityInput = {
    required: true,
    status: "accepted_decoded_tail",
    source: CONTINUITY_SOURCE,
    generator: CONTINUITY_GENERATOR,
    previousClipId: sourceClipId,
    sourceTakeVersion,
    decodedFrameIndex,
    acceptedSourceTakeId: `v${sourceTakeVersion}`
  };

  const nextBindings = bindings.map((binding, index) => ({
    id: `ref-${safeToken(firstFrameId)}-${safeToken(binding.assetId)}-${index + 1}`,
    assetId: binding.assetId,
    assetVersionId: `${binding.assetId}:v${binding.assetVersion}`,
    assetVersion: binding.assetVersion,
    role: binding.role,
    targetKind: "frame",
    targetId: firstFrameId,
    order: index + 1,
    required: true,
    persistenceOrigin: "user",
    useMode: "direct_conditioning"
  }));
  const kept = (frame.references || []).filter((reference) => {
    const role = canonicalContinuityRole(reference?.role);
    return role && !CARRY_FORWARD_ROLE_SET.has(role);
  });
  frame.references = [...nextBindings, ...kept].map((binding, index) => ({ ...binding, order: index + 1 }));

  storyboard.referenceBindings = storyboard.referenceBindings || {};
  for (const [id, binding] of Object.entries(storyboard.referenceBindings)) {
    if (binding?.targetKind === "frame" && binding?.targetId === firstFrameId && CARRY_FORWARD_ROLE_SET.has(canonicalContinuityRole(binding.role))) {
      delete storyboard.referenceBindings[id];
    }
  }
  for (const binding of nextBindings) storyboard.referenceBindings[binding.id] = binding;
  storyboard.updatedAt = new Date().toISOString();
  return { frame, bindings: nextBindings };
}

function copyToStoryboardLibrary(project, sourcePath, filename, resolveMediaDir) {
  const destinationDir = resolveMediaDir(project, "storyboard");
  fs.mkdirSync(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, filename);
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

/**
 * Extract the last decoded frame of an already-approved take and attach it as
 * the next shot's first continuity guide. MiniMax is never the frame generator.
 */
export async function promoteLastFrame(project, body = {}, deps = {}) {
  const clipId = String(body.clipId || "").trim();
  if (!clipId) continuityError("clipId is required", "CLIP_ID_REQUIRED");

  const storyboard = body.storyboard || deps.storyboard || null;
  const sequenceClip = findSequenceClip(project, clipId);
  const storyboardClip = storyboard?.clips?.[clipId] || null;
  if (!sequenceClip && !storyboardClip) {
    continuityError(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND", 404);
  }

  const take = resolveApprovedTake(project, {
    sequenceClip,
    storyboard,
    storyboardClip,
    takeVersion: body.takeVersion
  });
  if (takeIsMiniMaxGenerator(take)) {
    continuityError(
      "Continuity frames are extracted evidence from an approved take. MiniMax is never the frame generator.",
      "MINIMAX_NOT_FRAME_GENERATOR",
      409
    );
  }

  const next = resolveNextClip({
    project,
    storyboard,
    sourceSequenceClip: sequenceClip,
    sourceStoryboardClip: storyboardClip,
    nextClipId: body.nextClipId ? String(body.nextClipId).trim() : ""
  });

  const resolveMediaDir = deps.mediaDir || mediaDir;
  const probe = deps.probeMediaExact || probeMediaExact;
  const extract = deps.extractVideoFrameExact || extractVideoFrameExact;
  const takePath = takeDiskPath(project, take, resolveMediaDir, { sequenceClip, storyboardClip });
  const probeInfo = await probe(takePath);
  const decodedFrameIndex = lastDecodedFrameIndex(probeInfo);

  const sourceId = sequenceClip?.id || storyboardClip?.id || clipId;
  const filename = `continuity_${safeToken(sourceId)}_v${take.v}_last.png`;
  const framesDirectory = resolveMediaDir(project, "frames");
  fs.mkdirSync(framesDirectory, { recursive: true });
  const outputPath = path.join(framesDirectory, filename);
  await extract(takePath, outputPath, decodedFrameIndex);
  if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).size) {
    continuityError(`Decoded frame ${decodedFrameIndex} is not present in the generated video`, "DECODED_FRAME_MISSING", 409);
  }

  const buffer = fs.readFileSync(outputPath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const register = deps.registerFrame || registerFrame;
  const frame = register(project, filename, `${sourceId} last-frame continuity v${take.v}`, {
    source: CONTINUITY_SOURCE,
    generator: CONTINUITY_GENERATOR,
    category: "guide-frame",
    role: "first",
    sourceClipId: sourceId,
    sourceTakeKind: take.kind,
    sourceTakeVersion: take.v,
    decodedFrameIndex,
    nextClipId: next.id,
    sha256,
    bytes: buffer.length
  });
  if (textBlob(frame.source).includes("minimax") || textBlob(frame.generator).includes("minimax")) {
    continuityError(
      "Continuity frames are extracted evidence from an approved take. MiniMax is never the frame generator.",
      "MINIMAX_NOT_FRAME_GENERATOR",
      409
    );
  }

  const sourceReferences = collectReferences(
    sequenceClip?.references,
    storyboardSourceReferences(storyboard, storyboardClip)
  );
  const bindings = carryForwardReferences(sourceReferences);

  let guide = null;
  if (next.sequenceClip) {
    guide = attachFirstGuide(project, next.sequenceClip, filename, {
      source: CONTINUITY_SOURCE,
      decodedFrameIndex,
      sourceClipId: sourceId,
      sourceTakeVersion: take.v
    });
    next.sequenceClip.references = mergeCarriedReferences(next.sequenceClip.references, bindings);
  }

  let storyboardFrame = null;
  let storyboardBindings = bindings;
  if (next.storyboardClip && storyboard) {
    const storyboardName = filename;
    copyToStoryboardLibrary(project, outputPath, storyboardName, resolveMediaDir);
    const attached = attachStoryboardFirstGuide(storyboard, next.storyboardClip, {
      filename: storyboardName,
      decodedFrameIndex,
      sourceClipId: sourceId,
      sourceTakeVersion: take.v,
      bindings,
      sha256,
      bytes: buffer.length
    });
    storyboardFrame = attached.frame;
    storyboardBindings = attached.bindings;
  }

  const save = deps.saveProject || null;
  if (save) save(project);
  if (storyboard && deps.saveStoryboard) deps.saveStoryboard(project.slug, storyboard);

  return {
    frame,
    bindings: storyboardBindings.length ? storyboardBindings : bindings,
    guide,
    storyboardFrame,
    nextClipId: next.id,
    sourceClipId: sourceId,
    take: {
      kind: take.kind,
      v: take.v,
      file: take.file,
      source: take.source || CONTINUITY_SOURCE,
      generator: CONTINUITY_GENERATOR,
      decodedFrameIndex
    },
    storyboard
  };
}

export async function promoteLastFrameForSlug(slug, body = {}, deps = {}) {
  const loadProject = deps.loadProject;
  if (!loadProject) continuityError("loadProject is required", "PROJECT_LOAD_REQUIRED");
  const project = loadProject(slug);
  let storyboard = body.storyboard || null;
  if (!storyboard && deps.loadStoryboard) {
    try { storyboard = deps.loadStoryboard(slug); } catch { storyboard = null; }
  }
  return promoteLastFrame(project, { ...body, storyboard }, deps);
}

export { DROPPED_ROLES };
