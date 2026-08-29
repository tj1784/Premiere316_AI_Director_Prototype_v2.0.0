import fs from "fs";
import path from "path";
import crypto from "crypto";

import { extractVideoFrameExact, probeMediaExact } from "./ffmpeg.js";
import { mediaDir } from "./paths.js";
import { canonicalStoryboardReferenceRole } from "./storyboard.js";

const VIDEO_TAKE_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const CONTINUITY_EVIDENCE_SCHEMA = "premiere316.continuity-evidence.v1";

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
  // probeMediaExact asks ffprobe to count decoded frames. Prefer that observed
  // count over the container's declared frame count when both are present.
  const counted = positiveDecodedFrameCount(video.nb_read_frames) ?? positiveDecodedFrameCount(video.nb_frames);
  if (counted) return counted - 1;
  continuityError(
    "Cannot determine the last decoded frame; ffprobe did not report a decoded frame count",
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
  if (!owner || owner.activeTakeLocked !== true) return false;
  if (idsMatch(owner.activeTakeId, take?.id)) return true;
  const version = takeVersionNumber(take);
  return !take?.id && version != null && Number(owner.activeGeneratedVersion) === version;
}

function normalizedTakeKind(value) {
  const kind = textBlob(value);
  if (kind === "version" || kind === "full" || kind === "full-version") return "version";
  if (kind === "range" || kind === "rangeversion" || kind === "range-version") return "rangeVersion";
  if (kind === "storyboard") return "storyboard";
  return kind || null;
}

function approvedTakeEvidence(take, { sequenceClip, storyboardClip, storyboard } = {}) {
  const takeId = String(take?.id || "").trim() || null;
  const version = takeVersionNumber(take);
  const takeKind = normalizedTakeKind(take?.kind);
  const exact = (scope, field) => ({
    status: "approved",
    scope,
    field,
    takeId: takeId || `${takeKind || "take"}:v${version || 1}`,
    takeKind,
    takeVersion: version
  });

  if (take?.approved === true) return exact("source-take", "approved");
  if (textBlob(take?.approvalStatus) === "approved") return exact("source-take", "approvalStatus");
  if (textBlob(take?.approval?.status) === "approved") return exact("source-take", "approval.status");

  const approvedTake = sequenceClip?.approvedTake;
  if (approvedTake && textBlob(approvedTake.status || "approved") === "approved") {
    const idMatches = takeId && idsMatch(approvedTake.id || approvedTake.takeId, takeId);
    const versionMatches = Number(approvedTake.v ?? approvedTake.version) === version
      && normalizedTakeKind(approvedTake.kind) === takeKind;
    if (idMatches || versionMatches) return exact("sequence-clip", "approvedTake");
  }

  if (takeId && idsMatch(sequenceClip?.approvedTakeId, takeId)) {
    return exact("sequence-clip", "approvedTakeId");
  }
  if (
    version != null
    && Number(sequenceClip?.approvedTakeVersion) === version
    && normalizedTakeKind(sequenceClip?.approvedTakeKind) === takeKind
  ) {
    return exact("sequence-clip", "approvedTakeVersion+approvedTakeKind");
  }

  if (take.kind === "storyboard" && storyboardTakeIsSelected(take, storyboardClip, storyboard)) {
    return exact("storyboard-locked-take", "activeTakeLocked");
  }
  return null;
}

function takeIsApproved(take, context = {}) {
  return Boolean(approvedTakeEvidence(take, context));
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

function pathInside(root, disk) {
  const resolvedRoot = path.resolve(root);
  const resolvedDisk = path.resolve(disk);
  return resolvedDisk === resolvedRoot || resolvedDisk.startsWith(`${resolvedRoot}${path.sep}`);
}

function normalizedManifestFile(value) {
  const relative = relativeMediaPath(value);
  if (!relative) return null;
  return relative
    .replace(/^media\/(?:clips|storyboard)\//i, "")
    .replace(/^(?:clips|storyboard)\//i, "")
    .toLowerCase();
}

function exactTakeHashRecord(take, logicalFile) {
  const wanted = normalizedManifestFile(logicalFile);
  if (!wanted) return null;
  const matches = (Array.isArray(take?.fileHashes) ? take.fileHashes : [])
    .filter((entry) => normalizedManifestFile(entry?.file) === wanted);
  if (matches.length !== 1) return null;
  const record = matches[0];
  const sha256 = String(record?.sha256 || "").trim().toLowerCase();
  const bytes = Number(record?.bytes);
  if (!SHA256_RE.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
  return { file: String(record.file), sha256, bytes };
}

function takeDiskCandidates(project, take, resolveMediaDir, { sequenceClip, storyboardClip } = {}) {
  const clipsRoot = path.resolve(resolveMediaDir(project, "clips"));
  const storyboardRoot = path.resolve(resolveMediaDir(project, "storyboard"));
  const chapter = chapterFolderFromClip(sequenceClip) || chapterFolderFromClip(storyboardClip);
  const logicalFile = takeVideoFile(take);
  const relative = relativeMediaPath(logicalFile);
  if (!relative || !VIDEO_TAKE_RE.test(relative)) {
    continuityError(`Approved take has no exact video file: ${logicalFile || "missing"}`, "TAKE_FILE_MISSING", 409);
  }
  const candidates = [];
  const add = (root, relative) => {
    const rel = relativeMediaPath(relative);
    if (!rel) return;
    const disk = path.resolve(root, ...rel.split("/"));
    if (pathInside(root, disk) && !candidates.includes(disk)) candidates.push(disk);
  };

  if (/^media\/clips\//i.test(relative)) add(clipsRoot, relative.replace(/^media\/clips\//i, ""));
  else if (/^media\/storyboard\//i.test(relative)) add(storyboardRoot, relative.replace(/^media\/storyboard\//i, ""));
  else if (/^clips\//i.test(relative)) add(clipsRoot, relative.replace(/^clips\//i, ""));
  else if (/^storyboard\//i.test(relative)) add(storyboardRoot, relative.replace(/^storyboard\//i, ""));
  else {
    const storyboardFirst = String(take?.origin || "").startsWith("storyboard-");
    if (storyboardFirst) add(storyboardRoot, relative);
    add(clipsRoot, relative);
    if (chapter && !relative.includes("/")) add(clipsRoot, `${chapter}/${relative}`);
    if (!storyboardFirst) add(storyboardRoot, relative);
  }

  const existing = candidates.filter((disk) => fs.existsSync(disk) && fs.statSync(disk).isFile());
  if (!existing.length) {
    continuityError(`Approved take file is missing: ${logicalFile}`, "TAKE_FILE_MISSING", 409);
  }
  return { logicalFile: String(logicalFile), candidates: existing };
}

async function hashFile(diskPath) {
  const digest = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(diskPath)) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: digest.digest("hex"), bytes };
}

async function resolveTakeFileEvidence(project, take, resolveMediaDir, context = {}) {
  const { logicalFile, candidates } = takeDiskCandidates(project, take, resolveMediaDir, context);
  const manifest = exactTakeHashRecord(take, logicalFile);
  if (!manifest) {
    continuityError(
      `Approved take lacks one exact SHA-256/byte manifest for ${logicalFile}`,
      "TAKE_PROVENANCE_MISSING",
      409
    );
  }

  for (const diskPath of candidates) {
    const actual = await hashFile(diskPath);
    if (actual.sha256 === manifest.sha256 && actual.bytes === manifest.bytes) {
      return { diskPath, logicalFile, sha256: actual.sha256, bytes: actual.bytes };
    }
  }
  continuityError(
    `Approved take file no longer matches its SHA-256/byte manifest: ${logicalFile}`,
    "TAKE_FILE_HASH_MISMATCH",
    409
  );
}

function safeToken(value, fallback = "clip") {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || fallback;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function continuityFilename(sourceClipId, sourceTakeVersion, sourceSha256, frameSha256) {
  return `continuity_${safeToken(sourceClipId).slice(0, 48)}_v${sourceTakeVersion}_s${sourceSha256.slice(0, 16)}_${frameSha256}.png`;
}

function evidenceSourceKey(evidence) {
  const source = evidence?.sourceTake || {};
  return [
    source.clipId,
    source.kind,
    source.id,
    source.version,
    normalizedManifestFile(source.file),
    String(source.sha256 || "").toLowerCase(),
    Number(source.bytes),
    Number(evidence?.output?.decodedFrameIndex)
  ].join("|");
}

function continuityEvidenceMetadataIsVerified(frame) {
  const evidence = frame?.continuityEvidence;
  const source = evidence?.sourceTake;
  const output = evidence?.output;
  if (frame?.source !== CONTINUITY_SOURCE || frame?.generator !== CONTINUITY_GENERATOR) return false;
  if (evidence?.schemaVersion !== CONTINUITY_EVIDENCE_SCHEMA || evidence?.status !== "verified") return false;
  if (source?.approval?.status !== "approved" || !source?.clipId || !source?.kind || !source?.id) return false;
  if (!Number.isInteger(Number(source?.version)) || Number(source.version) <= 0) return false;
  if (
    source.approval.takeId !== source.id
    || source.approval.takeKind !== source.kind
    || Number(source.approval.takeVersion) !== Number(source.version)
  ) return false;
  if (!normalizedManifestFile(source?.file) || !SHA256_RE.test(String(source?.sha256 || ""))) return false;
  if (!Number.isSafeInteger(Number(source?.bytes)) || Number(source.bytes) <= 0) return false;
  if (!Number.isInteger(Number(output?.decodedFrameIndex)) || Number(output.decodedFrameIndex) < 0) return false;
  if (!SHA256_RE.test(String(output?.sha256 || "")) || !Number.isSafeInteger(Number(output?.bytes)) || Number(output.bytes) <= 0) return false;
  if (output?.file !== frame?.file || output.sha256 !== frame?.sha256 || Number(output.bytes) !== Number(frame?.bytes)) return false;
  return path.basename(String(frame.file || "")) === frame.file
    && String(frame.file).endsWith(`_${String(output.sha256).toLowerCase()}.png`);
}

export function continuityEvidenceIsVerified(project, frame, resolveMediaDir = mediaDir) {
  if (!project || !continuityEvidenceMetadataIsVerified(frame)) return false;
  try {
    const root = path.resolve(resolveMediaDir(project, "frames"));
    const diskPath = path.resolve(root, frame.file);
    if (!pathInside(root, diskPath) || !fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) return false;
    const buffer = fs.readFileSync(diskPath);
    if (buffer.length !== Number(frame.bytes)) return false;
    return crypto.createHash("sha256").update(buffer).digest("hex") === String(frame.sha256).toLowerCase();
  } catch {
    return false;
  }
}

function attachFirstGuide(project, clip, filename, continuityEvidence) {
  const fps = project.settings?.fps || 24;
  const before = JSON.stringify({ guides: clip.guides || [], firstFrame: clip.firstFrame, endFrame: clip.endFrame, status: clip.status });
  const existing = (clip.guides || []).find((guide) => guide.role === "first" || Number(guide.frame) === 0);
  if (
    existing?.source === CONTINUITY_SOURCE
    && existing.file === filename
    && evidenceSourceKey(existing.continuityEvidence) === evidenceSourceKey(continuityEvidence)
  ) {
    syncGuideAliases(clip, fps);
    const after = JSON.stringify({ guides: clip.guides || [], firstFrame: clip.firstFrame, endFrame: clip.endFrame, status: clip.status });
    return { guide: existing, changed: before !== after };
  }

  clip.guides = (clip.guides || []).filter((guide) => guide.role !== "first");
  const sourceTake = continuityEvidence.sourceTake;
  const output = continuityEvidence.output;
  const guide = {
    id: `guide-continuity-${safeToken(clip.id).slice(0, 36)}-${output.sha256.slice(0, 20)}`,
    role: "first",
    frame: 0,
    file: filename,
    prompt: "",
    strength: 1,
    seed: null,
    source: CONTINUITY_SOURCE,
    generator: CONTINUITY_GENERATOR,
    decodedFrameIndex: output.decodedFrameIndex,
    sourceClipId: sourceTake.clipId,
    sourceTakeId: sourceTake.id,
    sourceTakeKind: sourceTake.kind,
    sourceTakeVersion: sourceTake.version,
    sourceTakeSha256: sourceTake.sha256,
    continuityEvidence,
    versions: [{ v: 1, file: filename, sha256: output.sha256, bytes: output.bytes, createdAt: continuityEvidence.verifiedAt }],
    activeVersion: 1,
    createdAt: continuityEvidence.verifiedAt
  };
  clip.guides.push(guide);
  syncGuideAliases(clip, fps);
  if (clip.versions?.length) clip.status = "dirty";
  else if (!clip.status || clip.status === "ready") clip.status = "ready";
  const after = JSON.stringify({ guides: clip.guides || [], firstFrame: clip.firstFrame, endFrame: clip.endFrame, status: clip.status });
  return { guide, changed: before !== after };
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
  bindings,
  continuityEvidence
}) {
  const firstFrameId = nextClip.firstFrameId;
  if (!firstFrameId || !storyboard.frames?.[firstFrameId]) {
    continuityError(`Next storyboard clip has no first-frame target: ${nextClip.id}`, "NEXT_CLIP_NOT_FOUND", 409);
  }
  const frame = storyboard.frames[firstFrameId];
  const beforeFrame = JSON.stringify(frame);
  const beforeBindings = JSON.stringify(storyboard.referenceBindings || {});
  const sourceTake = continuityEvidence.sourceTake;
  const output = continuityEvidence.output;
  frame.generatedVersions = Array.isArray(frame.generatedVersions) ? frame.generatedVersions : [];
  let record = frame.generatedVersions.find((version) => (
    version?.source === CONTINUITY_SOURCE
    && version?.file === filename
    && evidenceSourceKey(version?.continuityEvidence) === evidenceSourceKey(continuityEvidence)
    && version?.fileHashes?.some((entry) => entry?.file === filename && entry?.sha256 === output.sha256 && Number(entry?.bytes) === output.bytes)
  ));
  if (!record) {
    const versionNumber = Math.max(0, ...frame.generatedVersions.map((version) => Number(version.v) || 0)) + 1;
    record = {
      v: versionNumber,
      files: [filename],
      file: filename,
      mediaType: "image",
      source: CONTINUITY_SOURCE,
      generator: CONTINUITY_GENERATOR,
      sourceClipId: sourceTake.clipId,
      sourceTakeId: sourceTake.id,
      sourceTakeKind: sourceTake.kind,
      sourceTakeVersion: sourceTake.version,
      sourceTakeSha256: sourceTake.sha256,
      sourceFrameIndex: output.decodedFrameIndex,
      continuityEvidence,
      fileHashes: [{ file: filename, sha256: output.sha256, bytes: output.bytes, extension: ".png" }],
      createdAt: continuityEvidence.verifiedAt
    };
    frame.generatedVersions.push(record);
  }
  frame.activeGeneratedVersion = record.v;
  frame.generatedFile = filename;
  frame.generatedInputPath = `media/storyboard/${filename}`;
  frame.generatedAssetId = frame.id;
  frame.generatedAssetVersionId = `${frame.id}:v${record.v}`;
  frame.status = "generated";
  frame.lastError = null;
  frame.purpose = frame.purpose || "first_frame";
  frame.continuityInput = {
    required: true,
    status: "accepted_decoded_tail",
    source: CONTINUITY_SOURCE,
    generator: CONTINUITY_GENERATOR,
    previousClipId: sourceTake.clipId,
    sourceTakeId: sourceTake.id,
    sourceTakeKind: sourceTake.kind,
    sourceTakeVersion: sourceTake.version,
    sourceTakeSha256: sourceTake.sha256,
    decodedFrameIndex: output.decodedFrameIndex,
    acceptedSourceTakeId: sourceTake.id,
    continuityEvidence
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

  const nextReferenceBindings = { ...(storyboard.referenceBindings || {}) };
  for (const [id, binding] of Object.entries(nextReferenceBindings)) {
    if (binding?.targetKind === "frame" && binding?.targetId === firstFrameId && CARRY_FORWARD_ROLE_SET.has(canonicalContinuityRole(binding.role))) {
      delete nextReferenceBindings[id];
    }
  }
  for (const binding of nextBindings) nextReferenceBindings[binding.id] = binding;
  storyboard.referenceBindings = nextReferenceBindings;

  const changed = beforeFrame !== JSON.stringify(frame) || beforeBindings !== JSON.stringify(storyboard.referenceBindings);
  if (changed) storyboard.updatedAt = new Date().toISOString();
  return { frame, bindings: nextBindings, changed };
}

function ensureImmutableFile(destination, buffer, { sha256, bytes }, collisionCode = "CONTINUITY_CONTENT_COLLISION") {
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination);
    const existingSha256 = crypto.createHash("sha256").update(existing).digest("hex");
    if (existing.length !== bytes || existingSha256 !== sha256) {
      continuityError(`Immutable continuity content collision: ${path.basename(destination)}`, collisionCode, 409);
    }
    return false;
  }
  try {
    fs.writeFileSync(destination, buffer, { flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = fs.readFileSync(destination);
    const existingSha256 = crypto.createHash("sha256").update(existing).digest("hex");
    if (existing.length !== bytes || existingSha256 !== sha256) {
      continuityError(`Immutable continuity content collision: ${path.basename(destination)}`, collisionCode, 409);
    }
    return false;
  }
}

function copyToStoryboardLibrary(project, sourcePath, filename, resolveMediaDir, outputEvidence) {
  const destinationDir = resolveMediaDir(project, "storyboard");
  fs.mkdirSync(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, filename);
  const buffer = fs.readFileSync(sourcePath);
  const created = ensureImmutableFile(destination, buffer, outputEvidence, "STORYBOARD_CONTENT_COLLISION");
  return { destination, created };
}

async function existingContinuityFrame(project, framesDirectory, sourceTake, decodedFrameIndex) {
  const wantedKey = evidenceSourceKey({ sourceTake, output: { decodedFrameIndex } });
  const matches = (project.frames || []).filter((frame) => (
    continuityEvidenceMetadataIsVerified(frame)
    && evidenceSourceKey(frame.continuityEvidence) === wantedKey
  ));
  if (!matches.length) return null;
  const outputHashes = new Set(matches.map((frame) => frame.continuityEvidence.output.sha256));
  if (outputHashes.size !== 1) {
    continuityError("Conflicting immutable continuity evidence exists for this exact source take frame", "CONTINUITY_EVIDENCE_CONFLICT", 409);
  }
  const frame = matches[0];
  const outputPath = path.resolve(framesDirectory, frame.file);
  if (!pathInside(framesDirectory, outputPath) || !fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
    continuityError(`Registered continuity evidence is missing: ${frame.file}`, "CONTINUITY_EVIDENCE_MISSING", 409);
  }
  const actual = await hashFile(outputPath);
  const output = frame.continuityEvidence.output;
  if (actual.sha256 !== output.sha256 || actual.bytes !== Number(output.bytes)) {
    continuityError(`Registered continuity evidence failed SHA-256 validation: ${frame.file}`, "CONTINUITY_EVIDENCE_CORRUPT", 409);
  }
  return { frame, outputPath, continuityEvidence: frame.continuityEvidence };
}

function assertSourceTakeUnchanged(before, after) {
  if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) {
    continuityError("The approved source take changed while its continuity frame was being verified", "TAKE_FILE_HASH_MISMATCH", 409);
  }
}

/**
 * Read-only preflight for the UI. This deliberately reuses the same approval,
 * exact logical-file manifest, on-disk SHA-256/byte, and next-shot resolution
 * gates as promotion without probing or extracting media.
 */
export async function preflightContinuityPromotion(project, body = {}, deps = {}) {
  try {
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
    const approval = approvedTakeEvidence(take, { sequenceClip, storyboardClip, storyboard });
    if (!approval) {
      continuityError("Promote last frame requires an exact, explicitly approved source take", "TAKE_NOT_APPROVED", 409);
    }

    const next = resolveNextClip({
      project,
      storyboard,
      sourceSequenceClip: sequenceClip,
      sourceStoryboardClip: storyboardClip,
      nextClipId: body.nextClipId ? String(body.nextClipId).trim() : ""
    });
    const takeEvidence = await resolveTakeFileEvidence(
      project,
      take,
      deps.mediaDir || mediaDir,
      { sequenceClip, storyboardClip }
    );
    const sourceId = sequenceClip?.id || storyboardClip?.id || clipId;
    const sourceTakeId = String(take.id || "").trim()
      || `${normalizedTakeKind(take.kind) || "take"}:v${take.v}:${takeEvidence.sha256.slice(0, 16)}`;

    return {
      eligible: true,
      code: null,
      reason: null,
      sourceClipId: sourceId,
      nextClipId: next.id,
      candidate: {
        selector: String(take.id || take.v),
        kind: normalizedTakeKind(take.kind),
        origin: take.origin || null,
        id: sourceTakeId,
        v: take.v,
        file: takeEvidence.logicalFile,
        sha256: takeEvidence.sha256,
        bytes: takeEvidence.bytes,
        approval: { ...approval, takeId: sourceTakeId }
      }
    };
  } catch (error) {
    if (!(error instanceof ContinuityError)) throw error;
    return {
      eligible: false,
      code: error.code,
      reason: error.message,
      sourceClipId: String(body.clipId || "").trim() || null,
      nextClipId: null,
      candidate: null
    };
  }
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
  const approval = approvedTakeEvidence(take, { sequenceClip, storyboardClip, storyboard });
  if (!approval) {
    continuityError("Promote last frame requires an exact, explicitly approved source take", "TAKE_NOT_APPROVED", 409);
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
  const takeEvidence = await resolveTakeFileEvidence(project, take, resolveMediaDir, { sequenceClip, storyboardClip });
  const probeInfo = await probe(takeEvidence.diskPath);
  const decodedFrameIndex = lastDecodedFrameIndex(probeInfo);

  const sourceId = sequenceClip?.id || storyboardClip?.id || clipId;
  const sourceTakeId = String(take.id || "").trim()
    || `${normalizedTakeKind(take.kind) || "take"}:v${take.v}:${takeEvidence.sha256.slice(0, 16)}`;
  const sourceTake = {
    clipId: sourceId,
    kind: normalizedTakeKind(take.kind),
    origin: take.origin || null,
    id: sourceTakeId,
    version: take.v,
    file: takeEvidence.logicalFile,
    sha256: takeEvidence.sha256,
    bytes: takeEvidence.bytes,
    approval: { ...approval, takeId: sourceTakeId }
  };
  const framesDirectory = resolveMediaDir(project, "frames");
  fs.mkdirSync(framesDirectory, { recursive: true });
  let projectChanged = false;
  let outputPath;
  let frame;
  let continuityEvidence;
  const existing = await existingContinuityFrame(project, framesDirectory, sourceTake, decodedFrameIndex);
  if (existing) {
    ({ frame, outputPath, continuityEvidence } = existing);
    const sourceAfterReuse = await hashFile(takeEvidence.diskPath);
    assertSourceTakeUnchanged(takeEvidence, sourceAfterReuse);
  } else {
    const temporaryPath = path.join(framesDirectory, `.continuity-${crypto.randomUUID()}.tmp.png`);
    let buffer;
    try {
      await extract(takeEvidence.diskPath, temporaryPath, decodedFrameIndex);
      if (!fs.existsSync(temporaryPath) || !fs.statSync(temporaryPath).size) {
        continuityError(`Decoded frame ${decodedFrameIndex} is not present in the generated video`, "DECODED_FRAME_MISSING", 409);
      }
      const sourceAfterExtraction = await hashFile(takeEvidence.diskPath);
      assertSourceTakeUnchanged(takeEvidence, sourceAfterExtraction);
      buffer = fs.readFileSync(temporaryPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }

    const frameSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const filename = continuityFilename(sourceId, take.v, takeEvidence.sha256, frameSha256);
    outputPath = path.join(framesDirectory, filename);
    const output = { file: filename, sha256: frameSha256, bytes: buffer.length, decodedFrameIndex };
    ensureImmutableFile(outputPath, buffer, output);
    continuityEvidence = {
      schemaVersion: CONTINUITY_EVIDENCE_SCHEMA,
      status: "verified",
      verifiedAt: new Date().toISOString(),
      sourceTake,
      output
    };

    const register = deps.registerFrame || registerFrame;
    frame = register(project, filename, `${sourceId} last-frame continuity v${take.v}`, {
      source: CONTINUITY_SOURCE,
      generator: CONTINUITY_GENERATOR,
      category: "guide-frame",
      role: "first",
      sourceClipId: sourceId,
      sourceTakeId,
      sourceTakeKind: sourceTake.kind,
      sourceTakeVersion: take.v,
      sourceTakeFile: takeEvidence.logicalFile,
      sourceTakeSha256: takeEvidence.sha256,
      sourceTakeBytes: takeEvidence.bytes,
      sourceTakeApproval: sourceTake.approval,
      decodedFrameIndex,
      sha256: frameSha256,
      bytes: buffer.length,
      continuityEvidence
    });
    if (!continuityEvidenceIsVerified(project, frame, resolveMediaDir) || evidenceSourceKey(frame.continuityEvidence) !== evidenceSourceKey(continuityEvidence)) {
      continuityError(`Project frame identity collision: ${filename}`, "CONTINUITY_FRAME_COLLISION", 409);
    }
    projectChanged = true;
  }

  const filename = frame.file;
  const { output } = continuityEvidence;

  const sourceReferences = collectReferences(
    take.references,
    take.semanticReferences,
    sequenceClip?.references,
    storyboardSourceReferences(storyboard, storyboardClip)
  );
  const bindings = carryForwardReferences(sourceReferences);

  let guide = null;
  if (next.sequenceClip) {
    const attached = attachFirstGuide(project, next.sequenceClip, filename, continuityEvidence);
    guide = attached.guide;
    projectChanged ||= attached.changed;
    const merged = mergeCarriedReferences(next.sequenceClip.references, bindings);
    if (!sameJson(next.sequenceClip.references || [], merged)) {
      next.sequenceClip.references = merged;
      projectChanged = true;
    }
  }

  let storyboardFrame = null;
  let storyboardBindings = bindings;
  let storyboardChanged = false;
  if (next.storyboardClip && storyboard) {
    const storyboardName = filename;
    copyToStoryboardLibrary(project, outputPath, storyboardName, resolveMediaDir, output);
    const attached = attachStoryboardFirstGuide(storyboard, next.storyboardClip, {
      filename: storyboardName,
      bindings,
      continuityEvidence
    });
    storyboardFrame = attached.frame;
    storyboardBindings = attached.bindings;
    storyboardChanged = attached.changed;
  }

  const save = deps.saveProject || null;
  if (save && projectChanged) save(project);
  if (storyboard && storyboardChanged && deps.saveStoryboard) deps.saveStoryboard(project.slug, storyboard);

  return {
    frame,
    bindings: storyboardBindings.length ? storyboardBindings : bindings,
    guide,
    storyboardFrame,
    nextClipId: next.id,
    sourceClipId: sourceId,
    take: {
      kind: take.kind,
      id: sourceTakeId,
      v: take.v,
      file: take.file,
      source: take.source || CONTINUITY_SOURCE,
      generator: CONTINUITY_GENERATOR,
      decodedFrameIndex,
      sha256: takeEvidence.sha256,
      bytes: takeEvidence.bytes,
      approval: sourceTake.approval
    },
    storyboard,
    changed: projectChanged || storyboardChanged
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
