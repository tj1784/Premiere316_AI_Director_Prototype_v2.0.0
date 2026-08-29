import crypto from "crypto";
import fs from "fs";
import path from "path";
import { projectDir } from "./paths.js";
import { resolveStillsReferences } from "./asset-reference-resolver.js";

const STORYBOARD_SCHEMA = "premiere316.storyboard.v1";
const STORYBOARD_FILE = "storyboard.json";
const PROJECT_FILE = "project.json";
export const EXPLICIT_USER_REFERENCES_ONLY = "explicit_user_only";
export const MAX_STORYBOARD_SEMANTIC_REFERENCES = 9;
const FRAME_ID_RE = /^frame-[a-z0-9][a-z0-9-]{1,127}$/;
const SEGMENT_ID_RE = /^segment-[a-z0-9][a-z0-9-]{1,127}$/;
const VIDEO_PLAN_ID_RE = /^video-[a-z0-9][a-z0-9-]{1,127}$/;
// Keep this boundary aligned with director-webapp/premiere-api-delegation.mjs.
// Storyboard bindings store the compiler's canonical role, while accepting its
// documented aliases from API clients for backwards compatibility.
const SEMANTIC_REFERENCE_ROLE_ALIASES = Object.freeze({
  identity: "identity",
  character: "identity",
  face: "identity",
  actor: "identity",
  wardrobe: "wardrobe",
  costume: "wardrobe",
  clothing: "wardrobe",
  location: "location",
  environment: "location",
  set: "location",
  composition: "location",
  prop: "prop",
  artifact: "prop",
  vehicle: "prop",
  crowd: "crowd",
  crowds: "crowd",
  extra: "crowd",
  extras: "crowd",
  creature: "crowd",
  atmosphere: "atmosphere",
  atmosphere_vfx: "atmosphere",
  vfx: "atmosphere",
  lighting: "atmosphere",
  style: "atmosphere"
});

export function canonicalStoryboardReferenceRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return SEMANTIC_REFERENCE_ROLE_ALIASES[normalized] || null;
}

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

function projectReferencePolicy(slug) {
  if (!slug) return null;
  const file = path.join(projectDir(slug), PROJECT_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))?.settings?.visualReferencePersistence || null;
  } catch {
    return null;
  }
}

export function storyboardUsesExplicitUserReferences(storyboard, project = null) {
  return storyboard?.defaults?.visualReferencePersistence === EXPLICIT_USER_REFERENCES_ONLY
    || project?.settings?.visualReferencePersistence === EXPLICIT_USER_REFERENCES_ONLY
    || (typeof project === "string" && projectReferencePolicy(project) === EXPLICIT_USER_REFERENCES_ONLY);
}

function bindingReferenceFile(binding) {
  return String(binding?.canonicalFile || binding?.sourceAssetFile || "").replace(/\\/g, "/");
}

function bindingSort(left, right) {
  return (Number(left?.order) || 0) - (Number(right?.order) || 0)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

/**
 * Remove imported/derived visual bindings while retaining only references that
 * were explicitly saved through the user reference editor. Temporal I2V guide
 * media, prompts, voice references, and immutable generation provenance are
 * intentionally outside this policy.
 */
export function enforceExplicitUserReferencePolicy(storyboard) {
  const next = structuredClone(storyboard);
  next.defaults = {
    ...(next.defaults || {}),
    visualReferencePersistence: EXPLICIT_USER_REFERENCES_ONLY
  };
  const userBindings = Object.values(next.referenceBindings || {})
    .filter((binding) => binding?.persistenceOrigin === "user")
    .sort(bindingSort);
  next.referenceBindings = Object.fromEntries(userBindings.map((binding) => [binding.id, binding]));

  for (const frame of Object.values(next.frames || {})) frame.references = [];
  for (const clip of Object.values(next.clips || {})) {
    clip.referenceFiles = [];
    if (Object.hasOwn(clip, "referenceCount")) clip.referenceCount = 0;
  }
  for (const segment of Object.values(next.segments || {})) {
    segment.referenceFiles = [];
    if (Object.hasOwn(segment, "referenceCount")) segment.referenceCount = 0;
  }
  for (const plan of Object.values(next.videoPlans || {})) {
    plan.referenceFiles = [];
    plan.referenceCount = 0;
    if (Array.isArray(plan.droppedReferenceFiles)) plan.droppedReferenceFiles = [];
    for (const segment of plan.timelineData?.segments || []) {
      segment.referenceFiles = [];
      if (Object.hasOwn(segment, "referenceCount")) segment.referenceCount = 0;
    }
  }

  const byTarget = new Map();
  for (const binding of userBindings) {
    const key = `${binding.targetKind}:${binding.targetId}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(binding);
  }
  for (const bindings of byTarget.values()) bindings.sort(bindingSort);

  for (const frame of Object.values(next.frames || {})) {
    frame.references = (byTarget.get(`frame:${frame.id}`) || []).map((binding, index) => ({
      ...binding,
      order: index + 1
    }));
  }
  for (const plan of Object.values(next.videoPlans || {})) {
    const files = (byTarget.get(`video_plan:${plan.id}`) || []).map(bindingReferenceFile).filter(Boolean);
    plan.referenceFiles = files;
    plan.referenceCount = files.length;
    const clip = next.clips?.[plan.clipId];
    if (clip) {
      clip.referenceFiles = [...files];
      if (Object.hasOwn(clip, "referenceCount")) clip.referenceCount = files.length;
    }
  }
  for (const segment of Object.values(next.segments || {})) {
    const files = (byTarget.get(`segment:${segment.id}`) || []).map(bindingReferenceFile).filter(Boolean);
    segment.referenceFiles = files;
    if (Object.hasOwn(segment, "referenceCount")) segment.referenceCount = files.length;
  }
  return next;
}

function applyProjectReferencePolicy(slug, storyboard, project = null) {
  return storyboardUsesExplicitUserReferences(storyboard, project || slug)
    ? enforceExplicitUserReferencePolicy(storyboard)
    : storyboard;
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

export function createEmptyStoryboard(slug, extras = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: STORYBOARD_SCHEMA,
    storyboardId: `storyboard-${slug}`,
    projectId: slug,
    title: extras.title || slug,
    source: { generatedAt: now, kind: extras.source || "ensure" },
    defaults: {
      fps: Number(extras.fps) > 0 ? Number(extras.fps) : 24,
      frameGrid: 8,
      pixelGrid: 32,
      aspectRatio: extras.aspectRatio || "2.39:1",
      workingWidth: 1920,
      workingHeight: 816,
      decodedFrameTrim: 1,
      generationMode: "t2v_with_semantic_references",
      referenceMode: "canonical_filename_resolver",
      maxReferences: 9,
      firstFrameGeneration: true,
      lastFrameGeneration: true,
      visualReferencePersistence: EXPLICIT_USER_REFERENCES_ONLY
    },
    workflowProfile: extras.workflowProfile || "premiere316-storyboard-ltx25-t2v-semantic-reference",
    runtimeFrames: 0,
    chapterOrder: [],
    chapters: {},
    scenes: {},
    clips: {},
    frames: {},
    videoPlans: {},
    segments: {},
    referenceBindings: {},
    imports: {},
    updatedAt: now
  };
}

export function ensureStoryboard(slug, extras = {}) {
  const file = storyboardPath(slug);
  if (fs.existsSync(file)) return loadStoryboard(slug);
  return saveStoryboard(slug, createEmptyStoryboard(slug, extras));
}

export function seedStoryboardFromShotPlan(slug, shotPlan = {}, extras = {}) {
  const storyboard = ensureStoryboard(slug, extras);
  const shots = Array.isArray(shotPlan.shots) ? shotPlan.shots : [];
  if (!shots.length) return { storyboard, summary: storyboardSummary(storyboard), seeded: 0 };
  const fps = Number(storyboard.defaults?.fps) || 24;
  const now = new Date().toISOString();
  let cursor = 0;
  let seeded = 0;
  for (const [index, shot] of shots.entries()) {
    const sceneSlug = String(shot.scene || shot.name || `scene-${index + 1}`)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || `SCENE-${index + 1}`;
    const chapterId = extras.chapterId || "H01";
    const sceneId = extras.sceneId || `${chapterId}-S01`;
    const clipId = `${sceneId}-C${String(index + 1).padStart(2, "0")}`;
    if (storyboard.clips[clipId]) continue;
    if (!storyboard.chapters[chapterId]) {
      storyboard.chapters[chapterId] = { id: chapterId, number: 1, title: extras.chapterTitle || "Opening", sceneIds: [] };
      if (!storyboard.chapterOrder.includes(chapterId)) storyboard.chapterOrder.push(chapterId);
    }
    if (!storyboard.scenes[sceneId]) {
      storyboard.scenes[sceneId] = { id: sceneId, chapterId, number: 1, title: extras.sceneTitle || sceneSlug, clipIds: [] };
    }
    if (!storyboard.chapters[chapterId].sceneIds.includes(sceneId)) storyboard.chapters[chapterId].sceneIds.push(sceneId);
    if (!storyboard.scenes[sceneId].clipIds.includes(clipId)) storyboard.scenes[sceneId].clipIds.push(clipId);
    const durationSec = Math.max(6, Math.min(30, Number(shot.durationSec) || 12));
    const durationFrames = Math.round(durationSec * fps);
    const videoPlanId = `video-${clipId.toLowerCase()}`;
    const segmentId = `segment-${clipId.toLowerCase()}-01`;
    const firstFrameId = `frame-${clipId.toLowerCase()}-first`;
    const lastFrameId = `frame-${clipId.toLowerCase()}-last`;
    storyboard.clips[clipId] = {
      id: clipId,
      sceneId,
      order: storyboard.scenes[sceneId].clipIds.length,
      timelineStartFrame: cursor,
      durationFrames,
      beat: shot.name || clipId,
      dialogueAnchor: shot.dialogue || "",
      shotSizeLens: shot.shotSize || "",
      cameraMovement: shot.camera || "",
      transition: index === 0 ? "fade_in" : "cut",
      continuityLocks: [],
      videoPlanId,
      renderStatus: "not_started",
      generationMode: "t2v_with_semantic_references",
      referenceFiles: [],
      voiceReferences: [],
      firstFrameId,
      lastFrameId,
      updatedAt: now
    };
    storyboard.videoPlans[videoPlanId] = {
      id: videoPlanId,
      clipId,
      workflowProfileId: storyboard.workflowProfile,
      globalPrompt: shot.globalPrompt || shot.name || "",
      segmentIds: [segmentId],
      status: "needs_render",
      generationMode: "t2v_with_semantic_references",
      referenceFiles: [],
      referenceCount: 0,
      audioPlan: { mode: "dialogue", dialogueText: shot.dialogue || "", instruction: shot.audioDirection || "" }
    };
    storyboard.segments[segmentId] = {
      id: segmentId,
      order: 1,
      prompt: (shot.motionPrompts && shot.motionPrompts[0]) || shot.globalPrompt || "",
      dialogueAnchor: shot.dialogue || "",
      startFrame: 0,
      lengthFrames: durationFrames,
      continuityLocks: [],
      updatedAt: now
    };
    storyboard.frames[firstFrameId] = {
      id: firstFrameId,
      purpose: "first_frame",
      ownerKind: "clip",
      ownerId: clipId,
      prompt: shot.firstFramePrompt || shot.globalPrompt || "",
      negativePrompt: "text, captions, logos, watermarks, modern objects",
      status: "ready_to_generate",
      references: []
    };
    storyboard.frames[lastFrameId] = {
      id: lastFrameId,
      purpose: "last_frame",
      ownerKind: "clip",
      ownerId: clipId,
      prompt: shot.lastFramePrompt || shot.globalPrompt || "",
      negativePrompt: "text, captions, logos, watermarks, modern objects",
      status: "ready_to_generate",
      references: []
    };
    cursor += durationFrames;
    seeded += 1;
  }
  storyboard.runtimeFrames = cursor;
  storyboard.updatedAt = now;
  const saved = saveStoryboard(slug, storyboard);
  return { storyboard: saved, summary: storyboardSummary(saved), seeded };
}

export function loadStoryboard(slug) {
  const file = storyboardPath(slug);
  if (!fs.existsSync(file)) throw new Error(`Storyboard not found for project: ${slug}`);
  const storyboard = applyProjectReferencePolicy(slug, JSON.parse(fs.readFileSync(file, "utf8")));
  return validateStoryboard(storyboard, slug);
}

export function saveStoryboard(slug, storyboard) {
  const governed = applyProjectReferencePolicy(slug, storyboard);
  const validated = validateStoryboard(governed, slug);
  writeJsonAtomic(storyboardPath(slug), validated);
  return validated;
}

export function chapterKeyFromClipId(clipId) {
  const match = String(clipId || "").toUpperCase().match(/^(H\d+|MV\d+)/);
  return match ? match[1] : "";
}

export function clipMatchesGlobalScope(clip, boundClip, scope) {
  if (!clip || !boundClip) return false;
  if (scope === "project") return true;
  if (scope === "clip") return String(clip.id) === String(boundClip.id);
  if (scope === "scene") return Boolean(boundClip.sceneId) && String(clip.sceneId || "") === String(boundClip.sceneId);
  if (scope === "chapter") {
    const a = chapterKeyFromClipId(clip.id);
    const b = chapterKeyFromClipId(boundClip.id);
    return Boolean(a && b && a === b);
  }
  return String(clip.id) === String(boundClip.id);
}

export function applyGlobalPromptToScope(slug, clipId, text, scope = "clip") {
  const storyboard = loadStoryboard(slug);
  const bound = storyboard.clips?.[clipId];
  if (!bound) throw new Error("Unknown clip " + clipId);
  const normalized = String(text || "");
  const scopeKey = ["clip", "scene", "chapter", "project"].includes(String(scope)) ? String(scope) : "clip";
  let clips = 0;
  let plans = 0;
  let segments = 0;
  for (const clip of Object.values(storyboard.clips || {})) {
    if (!clipMatchesGlobalScope(clip, bound, scopeKey)) continue;
    clips += 1;
    const plan = storyboard.videoPlans?.[clip.videoPlanId];
    if (!plan) continue;
    plan.globalPrompt = normalized;
    plan.global_prompt = normalized;
    if (plan.timelineData && typeof plan.timelineData === "object") {
      plan.timelineData.global_prompt = normalized;
    }
    plans += 1;
    for (const segmentId of plan.segmentIds || []) {
      const segment = storyboard.segments?.[segmentId];
      if (!segment) continue;
      segment.global_prompt = normalized;
      segment.globalPrompt = normalized;
      segments += 1;
    }
  }
  if (scopeKey === "project") {
    storyboard.defaults = storyboard.defaults || {};
    storyboard.defaults.globalPrompt = normalized;
    storyboard.defaults.global_prompt = normalized;
  }
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return {
    projectSlug: slug,
    clipId,
    scope: scopeKey,
    textChars: normalized.length,
    clips,
    plans,
    segments,
    updatedAt: storyboard.updatedAt
  };
}


function targetExists(storyboard, targetKind, targetId) {
  if (targetKind === "frame") return FRAME_ID_RE.test(targetId) && Object.hasOwn(storyboard.frames, targetId);
  if (targetKind === "segment") return SEGMENT_ID_RE.test(targetId) && Object.hasOwn(storyboard.segments, targetId);
  if (targetKind === "video_plan") return VIDEO_PLAN_ID_RE.test(targetId) && Object.hasOwn(storyboard.videoPlans, targetId);
  return false;
}

function resolveReference(snapshot, reference, existing, targetKind, targetId, order) {
  const existingMatchesExactSource = Number(existing?.assetVersion) === snapshot.assetVersion
    && String(existing?.sourceAssetFile || "").replace(/\\/g, "/") === snapshot.sourceFile
    && (!existing?.sourceAssetSha256 || String(existing.sourceAssetSha256).toLowerCase() === snapshot.fileSha256);
  const canonicalFile = targetKind === "video_plan" && existingMatchesExactSource && existing?.canonicalFile
    ? String(existing.canonicalFile).replace(/\\/g, "/")
    : snapshot.sourceFile;
  return {
    id: existing?.id || `ref-${cleanId(targetId)}-${cleanId(snapshot.assetId)}-${order}`,
    assetId: snapshot.assetId,
    assetVersionId: `${snapshot.assetId}:v${snapshot.assetVersion}`,
    assetVersion: snapshot.assetVersion,
    sourceAssetFile: snapshot.sourceFile,
    sourceAssetSha256: snapshot.fileSha256,
    sourceAssetBytes: snapshot.fileBytes,
    sourceGenerationFingerprint: snapshot.generationFingerprint,
    sourceVersionFingerprint: snapshot.versionFingerprint,
    sourceApprovalFingerprint: snapshot.approvalFingerprint,
    canonicalFile,
    sourceAssetKey: String(snapshot.sourceFile).replace(/\.[^.]+$/, ""),
    resolutionStatus: "resolved_exact_version",
    role: snapshot.role,
    targetKind,
    targetId,
    useMode: String(reference.useMode || (targetKind === "video_plan" ? "semantic_reference" : "direct_conditioning")),
    required: reference.required !== false,
    order,
    cropRegion: String(reference.cropRegion || "Use relevant subject/design region only"),
    notes: String(reference.notes || "Pinned to an exact Asset Foundry version for reproducible generation."),
    pinnedActiveAtImport: snapshot.activeAtResolve,
    persistenceOrigin: "user"
  };
}

export function replaceStoryboardTargetReferences(storyboard, project, { targetKind, targetId, references }) {
  const governed = applyProjectReferencePolicy(project.slug, storyboard, project);
  validateStoryboard(governed, project.slug);
  if (!targetExists(governed, targetKind, targetId)) {
    throw new Error(`Storyboard ${targetKind} target not found: ${targetId}`);
  }
  if (!Array.isArray(references)) throw new Error("references must be an array");
  if (references.length > MAX_STORYBOARD_SEMANTIC_REFERENCES) {
    throw new Error(
      `Storyboard ${targetKind} target supports at most ${MAX_STORYBOARD_SEMANTIC_REFERENCES} visual references; received ${references.length}`
    );
  }
  const seenAssets = new Set();
  const accepted = [];
  for (const reference of references) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw new Error("Each storyboard reference must be an object");
    }
    const assetId = typeof reference.assetId === "string" ? reference.assetId.trim() : "";
    if (!assetId) throw new Error("Each storyboard reference requires assetId");
    if (seenAssets.has(assetId)) continue;
    seenAssets.add(assetId);
    const declaredRole = String(reference.role || "").trim();
    const role = canonicalStoryboardReferenceRole(declaredRole);
    if (!role) throw new Error(`Reference asset ${assetId} has unsupported role ${declaredRole || "missing"}`);
    const requestedId = String(reference.id || "").trim();
    const existing = requestedId ? governed.referenceBindings?.[requestedId] : null;
    const preserved = existing?.targetKind === targetKind && existing?.targetId === targetId && existing?.assetId === assetId
      ? existing
      : null;
    accepted.push({
      reference: { ...reference, assetId, role },
      existing: preserved,
      pin: {
        ...reference,
        assetId,
        assetVersion: reference.assetVersion,
        role,
        order: accepted.length + 1,
        type: "image"
      }
    });
  }
  const snapshots = resolveStillsReferences(project, accepted.map((entry) => entry.pin));
  const resolved = snapshots.map((snapshot, index) => resolveReference(
    snapshot,
    accepted[index].reference,
    accepted[index].existing,
    targetKind,
    targetId,
    index + 1
  ));
  const next = structuredClone(governed);
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

export function patchStoryboardDirectionInMemory(storyboard, body = {}, fps = 24) {
  const rate = Number(fps) > 0 ? Number(fps) : 24;
  const now = new Date().toISOString();
  let touched = { clip: false, segment: false };

  if (body.segmentId) {
    const segment = storyboard.segments?.[body.segmentId];
    if (!segment) throw new Error("Unknown segment " + body.segmentId);
    if (body.prompt != null) segment.prompt = String(body.prompt);
    if (body.dialogueAnchor != null) segment.dialogueAnchor = String(body.dialogueAnchor);
    if (body.startSec != null && body.startSec !== "") {
      segment.startFrame = Math.max(0, Math.round(Number(body.startSec) * rate));
    }
    if (body.durationSec != null && body.durationSec !== "") {
      segment.lengthFrames = Math.max(1, Math.round(Number(body.durationSec) * rate));
    }
    if (Array.isArray(body.continuityLocks)) {
      segment.continuityLocks = body.continuityLocks.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (body.volume != null && body.volume !== "") {
      segment.volume = Math.min(2, Math.max(0, Number(body.volume)));
    }
    if (body.ambience != null) segment.ambience = String(body.ambience);
    if (body.dialogueAssetId != null) segment.dialogueAssetId = String(body.dialogueAssetId);
    if (body.muted != null) segment.muted = Boolean(body.muted);
    segment.updatedAt = now;
    touched.segment = true;
  }

  if (body.clipId) {
    const clip = storyboard.clips?.[body.clipId];
    if (!clip) throw new Error("Unknown clip " + body.clipId);
    if (body.dialogueAnchor != null) clip.dialogueAnchor = String(body.dialogueAnchor);
    if (body.durationSec != null && body.durationSec !== "" && !body.segmentId) {
      clip.durationFrames = Math.max(1, Math.round(Number(body.durationSec) * rate));
    }
    if (Array.isArray(body.continuityLocks)) {
      clip.continuityLocks = body.continuityLocks.map((item) => String(item || "").trim()).filter(Boolean);
    }
    clip.updatedAt = now;
    touched.clip = true;
  }

  if (!touched.clip && !touched.segment) throw new Error("clipId or segmentId is required");
  storyboard.updatedAt = now;
  return storyboard;
}

export function applyStoryboardDirection(slug, body = {}) {
  const storyboard = loadStoryboard(slug);
  const fps = Number(storyboard.defaults?.fps || 24);
  patchStoryboardDirectionInMemory(storyboard, body, fps);
  saveStoryboard(slug, storyboard);
  return { storyboard, summary: storyboardSummary(storyboard) };
}



function nextSegmentId(storyboard) {
  for (let i = 1; i < 10000; i += 1) {
    const id = `segment-added-${String(i).padStart(3, "0")}`;
    if (!storyboard.segments?.[id]) return id;
  }
  throw new Error("Could not allocate a segment id");
}

function planForClip(storyboard, clipId) {
  const clip = storyboard.clips?.[clipId];
  if (!clip) throw new Error("Unknown clip " + clipId);
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) throw new Error("Clip has no video plan");
  if (!Array.isArray(plan.segmentIds)) plan.segmentIds = [];
  return { clip, plan };
}

export function mutateStoryboardStructureInMemory(storyboard, body = {}) {
  const action = String(body.action || "");
  const clipId = String(body.clipId || "");
  if (!clipId) throw new Error("clipId is required");
  const { clip, plan } = planForClip(storyboard, clipId);
  const now = new Date().toISOString();

  if (action === "add" || action === "duplicate") {
    const sourceId = body.segmentId || plan.segmentIds[plan.segmentIds.length - 1];
    const source = sourceId ? storyboard.segments?.[sourceId] : null;
    const id = nextSegmentId(storyboard);
    const clone = source
      ? { ...JSON.parse(JSON.stringify(source)), id, frameId: undefined, generatedFile: undefined, updatedAt: now }
      : { id, prompt: "", dialogueAnchor: "", startFrame: 0, lengthFrames: 24, continuityLocks: [], updatedAt: now };
    delete clone.frameId;
    storyboard.segments[id] = clone;
    const after = sourceId ? plan.segmentIds.indexOf(sourceId) : plan.segmentIds.length - 1;
    plan.segmentIds.splice(after + 1, 0, id);
    plan.segmentIds.forEach((sid, index) => {
      if (storyboard.segments[sid]) storyboard.segments[sid].order = index + 1;
    });
    storyboard.updatedAt = now;
    return storyboard;
  }

  if (action === "delete") {
    const segmentId = String(body.segmentId || "");
    if (!segmentId) throw new Error("segmentId is required");
    if (plan.segmentIds.length <= 1) throw new Error("A clip must keep at least one segment");
    plan.segmentIds = plan.segmentIds.filter((id) => id !== segmentId);
    delete storyboard.segments[segmentId];
    for (const [bindingId, binding] of Object.entries(storyboard.referenceBindings || {})) {
      if (binding?.targetKind === "segment" && binding.targetId === segmentId) delete storyboard.referenceBindings[bindingId];
    }
    plan.segmentIds.forEach((sid, index) => {
      if (storyboard.segments[sid]) storyboard.segments[sid].order = index + 1;
    });
    storyboard.updatedAt = now;
    return storyboard;
  }

  if (action === "move") {
    const segmentId = String(body.segmentId || "");
    const toIndex = Number(body.toIndex);
    const from = plan.segmentIds.indexOf(segmentId);
    if (from < 0) throw new Error("Segment is not on this clip");
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= plan.segmentIds.length) throw new Error("Invalid toIndex");
    plan.segmentIds.splice(from, 1);
    plan.segmentIds.splice(toIndex, 0, segmentId);
    plan.segmentIds.forEach((sid, index) => {
      if (storyboard.segments[sid]) storyboard.segments[sid].order = index + 1;
    });
    storyboard.updatedAt = now;
    return storyboard;
  }

  throw new Error("Unknown structure action " + action);
}

export function applyStoryboardStructure(slug, body = {}) {
  const storyboard = loadStoryboard(slug);
  mutateStoryboardStructureInMemory(storyboard, body);
  saveStoryboard(slug, storyboard);
  return { storyboard, summary: storyboardSummary(storyboard) };
}
