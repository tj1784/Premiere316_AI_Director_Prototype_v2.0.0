import crypto from "crypto";
import fs from "fs";
import path from "path";
import { projectDir } from "./paths.js";

const STORYBOARD_SCHEMA = "premiere316.storyboard.v1";
const STORYBOARD_FILE = "storyboard.json";
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const FRAME_ID_RE = /^frame-[a-z0-9][a-z0-9-]{1,127}$/;
const SEGMENT_ID_RE = /^segment-[a-z0-9][a-z0-9-]{1,127}$/;
const VIDEO_PLAN_ID_RE = /^video-[a-z0-9][a-z0-9-]{1,127}$/;

function cleanId(value) {
  return String(value || "reference")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "reference";
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function storyboardPath(slug) {
  return path.join(projectDir(slug), "production", STORYBOARD_FILE);
}

export function validateStoryboard(storyboard, projectSlug = null, { allowLegacyBindingTargets = false } = {}) {
  if (!storyboard || typeof storyboard !== "object" || Array.isArray(storyboard)) {
    throw new Error("Storyboard package must be a JSON object");
  }
  if (storyboard.schemaVersion !== STORYBOARD_SCHEMA) {
    throw new Error(`Unsupported storyboard schema: ${storyboard.schemaVersion || "missing"}`);
  }
  if (projectSlug && storyboard.projectId !== projectSlug) {
    throw new Error(`Storyboard project mismatch: expected ${projectSlug}, received ${storyboard.projectId || "missing"}`);
  }
  for (const key of ["chapters", "scenes", "clips", "frames", "videoPlans", "segments", "referenceBindings"]) {
    if (!storyboard[key] || typeof storyboard[key] !== "object" || Array.isArray(storyboard[key])) {
      throw new Error(`Storyboard ${key} map is missing or invalid`);
    }
  }
  if (!Array.isArray(storyboard.chapterOrder)) throw new Error("Storyboard chapterOrder must be an array");
  for (const binding of Object.values(storyboard.referenceBindings)) {
    if (!binding || typeof binding !== "object") throw new Error("Storyboard reference binding is invalid");
    const targetId = String(binding.targetId || "");
    if (binding.targetKind === "frame" && FRAME_ID_RE.test(targetId) && Object.hasOwn(storyboard.frames, targetId)) continue;
    if (binding.targetKind === "segment" && SEGMENT_ID_RE.test(targetId) && Object.hasOwn(storyboard.segments, targetId)) continue;
    if (binding.targetKind === "video_plan" && VIDEO_PLAN_ID_RE.test(targetId) && Object.hasOwn(storyboard.videoPlans, targetId)) continue;
    if (allowLegacyBindingTargets && binding.targetKind === "frame") {
      const legacySegmentId = targetId.replace(/^frame-segment-/, "segment-");
      if (SEGMENT_ID_RE.test(legacySegmentId) && Object.hasOwn(storyboard.segments, legacySegmentId)) continue;
    }
    throw new Error(`Storyboard reference binding target not found: ${binding.id || "missing id"} → ${binding.targetKind || "missing kind"}/${targetId || "missing id"}`);
  }
  return storyboard;
}

export function loadStoryboard(slug) {
  const file = storyboardPath(slug);
  if (!fs.existsSync(file)) throw new Error(`Storyboard not found for project: ${slug}`);
  return validateStoryboard(JSON.parse(fs.readFileSync(file, "utf8")), slug);
}

export function saveStoryboard(slug, storyboard) {
  const validated = validateStoryboard(storyboard, slug);
  writeJsonAtomic(storyboardPath(slug), validated);
  return validated;
}

function targetExists(storyboard, targetKind, targetId) {
  if (targetKind === "frame") return FRAME_ID_RE.test(targetId) && Object.hasOwn(storyboard.frames, targetId);
  if (targetKind === "segment") return SEGMENT_ID_RE.test(targetId) && Object.hasOwn(storyboard.segments, targetId);
  if (targetKind === "video_plan") return VIDEO_PLAN_ID_RE.test(targetId) && Object.hasOwn(storyboard.videoPlans, targetId);
  return false;
}

function versionFile(version) {
  return version?.file || version?.files?.find((file) => IMAGE_FILE_RE.test(String(file || ""))) || version?.files?.[0] || null;
}

function resolveReference(project, reference, targetKind, targetId, order, preservedId = null) {
  const asset = project.assets?.items?.find((item) => item.id === reference.assetId);
  if (!asset) throw new Error(`Reference asset not found: ${reference.assetId || "missing"}`);
  const requestedVersion = reference.assetVersion == null ? Number(asset.activeVersion) : Number(reference.assetVersion);
  const version = (asset.versions || []).find((item) => Number(item.v) === requestedVersion);
  if (!version) throw new Error(`Asset ${asset.id} does not contain version ${requestedVersion}`);
  const file = versionFile(version);
  if (!file || !IMAGE_FILE_RE.test(file)) throw new Error(`Asset ${asset.id} v${requestedVersion} is not a visual reference`);
  const role = String(reference.role || "reference").trim().slice(0, 64) || "reference";
  return {
    id: preservedId || `ref-${cleanId(targetId)}-${cleanId(asset.id)}-${order}`,
    assetId: asset.id,
    assetVersionId: `${asset.id}:v${requestedVersion}`,
    assetVersion: requestedVersion,
    sourceAssetFile: file,
    canonicalFile: String(reference.canonicalFile || file).replace(/\\/g, "/"),
    sourceAssetKey: String(file).replace(/\.[^.]+$/, ""),
    resolutionStatus: "resolved_exact_version",
    role,
    targetKind,
    targetId,
    useMode: String(reference.useMode || (targetKind === "video_plan" ? "semantic_reference" : "direct_conditioning")),
    required: reference.required !== false,
    order,
    cropRegion: String(reference.cropRegion || "Use relevant subject/design region only"),
    notes: String(reference.notes || "Pinned to an exact Asset Foundry version for reproducible generation."),
    pinnedActiveAtImport: typeof reference.pinnedActiveAtImport === "boolean"
      ? reference.pinnedActiveAtImport
      : Number(asset.activeVersion) === requestedVersion
  };
}

export function replaceStoryboardTargetReferences(storyboard, project, { targetKind, targetId, references }) {
  validateStoryboard(storyboard, project.slug);
  if (!targetExists(storyboard, targetKind, targetId)) {
    throw new Error(`Storyboard ${targetKind} target not found: ${targetId}`);
  }
  if (!Array.isArray(references)) throw new Error("references must be an array");
  const seenAssets = new Set();
  const resolved = [];
  for (const reference of references) {
    if (!reference?.assetId || seenAssets.has(reference.assetId)) continue;
    seenAssets.add(reference.assetId);
    const requestedId = String(reference.id || "");
    const existing = requestedId ? storyboard.referenceBindings?.[requestedId] : null;
    const preservedId = existing?.targetKind === targetKind && existing?.targetId === targetId && existing?.assetId === reference.assetId
      ? requestedId
      : null;
    const bindingOrder = preservedId && Number.isFinite(Number(existing.order)) ? Number(existing.order) : resolved.length + 1;
    resolved.push(resolveReference(project, reference, targetKind, targetId, bindingOrder, preservedId));
  }
  const next = structuredClone(storyboard);
  for (const [id, binding] of Object.entries(next.referenceBindings)) {
    if (binding?.targetKind === targetKind && binding?.targetId === targetId) delete next.referenceBindings[id];
  }
  for (const binding of resolved) next.referenceBindings[binding.id] = binding;
  if (targetKind === "frame") {
    next.frames[targetId].references = resolved.map((binding, index) => ({ ...binding, order: index + 1 }));
  } else if (targetKind === "video_plan") {
    const referenceFiles = resolved.map((binding) => binding.canonicalFile || binding.sourceAssetFile);
    next.videoPlans[targetId].referenceFiles = referenceFiles;
    next.videoPlans[targetId].referenceCount = referenceFiles.length;
    const clipId = next.videoPlans[targetId].clipId;
    if (clipId && Object.hasOwn(next.clips, clipId)) next.clips[clipId].referenceFiles = [...referenceFiles];
  }
  next.updatedAt = new Date().toISOString();
  return {
    storyboard: next,
    references: targetKind === "frame"
      ? next.frames[targetId].references
      : resolved.map((binding, index) => ({ ...binding, order: index + 1 }))
  };
}

export function saveStoryboardTargetReferences(slug, project, body) {
  const current = loadStoryboard(slug);
  const result = replaceStoryboardTargetReferences(current, project, body);
  saveStoryboard(slug, result.storyboard);
  return result;
}

export function storyboardSummary(storyboard) {
  return {
    id: storyboard.storyboardId,
    title: storyboard.title,
    schemaVersion: storyboard.schemaVersion,
    chapters: Object.keys(storyboard.chapters || {}).length,
    scenes: Object.keys(storyboard.scenes || {}).length,
    clips: Object.keys(storyboard.clips || {}).length,
    frames: Object.keys(storyboard.frames || {}).length,
    segments: Object.keys(storyboard.segments || {}).length,
    referenceBindings: Object.keys(storyboard.referenceBindings || {}).length,
    effectiveReferences:
      Object.values(storyboard.frames || {}).reduce((total, frame) => total + (frame?.references?.length || 0), 0)
      + Object.values(storyboard.referenceBindings || {}).filter((binding) => binding?.targetKind === "video_plan").length,
    runtimeFrames: Number(storyboard.runtimeFrames) || 0,
    updatedAt: storyboard.updatedAt || storyboard.source?.generatedAt || null
  };
}
