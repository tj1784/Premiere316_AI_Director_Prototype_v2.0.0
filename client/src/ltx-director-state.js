export const I2V_SEGMENTED_FIRST_FRAMES = "i2v_segmented_first_frames";
export const SEMANTIC_T2V_GENERATION_MODE = "t2v_with_semantic_references";
export const HARROWING_PROJECT_SLUG = "harrowing_of_hell";

export const LTX25_PREMIERE316_PROFILE = "LTX2.5_Premiere316";

export function isVisualGenerationSegment(segment) {
  if (!segment || ![undefined, "image", "video"].includes(segment.type)) return false;
  if (segment.missingGuide || (Number(segment.length) || 0) <= 0) return false;
  return Boolean(segment.imageFile || segment.videoFile || segment.imageB64 || segment.projectMediaPath);
}

function isTimelineVisualSegment(segment) {
  return Boolean(segment)
    && [undefined, "image", "video"].includes(segment.type)
    && (Number(segment.length) || 0) > 0;
}

function hasApprovedImageGuide(segment) {
  if (!segment || segment.type === "video" || segment.missingGuide) return false;
  return Boolean(segment.imageFile || segment.imageB64 || segment.projectMediaPath);
}

function hasApprovedVisualGuide(segment) {
  return Boolean(segment)
    && !segment.missingGuide
    && Boolean(segment.imageFile || segment.videoFile || segment.imageB64 || segment.projectMediaPath);
}

function orderedVisualSegments(workspace) {
  return (workspace?.timeline?.segments || [])
    .filter(isTimelineVisualSegment)
    .slice()
    .sort((left, right) => {
      const startDifference = (Number(left.start) || 0) - (Number(right.start) || 0);
      return startDifference || String(left.id || "").localeCompare(String(right.id || ""));
    });
}

/**
 * LTX-2.5 generates on an 8n+1 temporal grid. Premiere316 keeps the authored
 * duration authoritative and trims only the grid padding after decode.
 */
export function ltx25FramePlan(requestedFrames, fps = 24) {
  const requested = Math.max(1, Math.round(Number(requestedFrames) || 1));
  const rate = Math.max(1, Number(fps) || 24);
  const generation = Math.ceil((requested - 1) / 8) * 8 + 1;
  return {
    profile: LTX25_PREMIERE316_PROFILE,
    grid: "8n+1",
    requestedFrames: requested,
    generationFrames: generation,
    editFrames: requested,
    trimFrames: generation - requested,
    requestedSeconds: requested / rate,
    generationSeconds: generation / rate,
    editSeconds: requested / rate
  };
}

function guideDescriptor(segment, role, origin) {
  if (!segment) return null;
  return {
    role,
    origin,
    sourceSegmentId: segment.id || null,
    fileName: segment.fileName || segment.imageFile || segment.videoFile || segment.projectMediaPath || null,
    type: segment.type || (segment.videoFile ? "video" : "image"),
    imageFile: segment.imageFile || null,
    videoFile: segment.videoFile || null,
    imageB64: segment.imageB64 || null,
    projectMediaPath: segment.projectMediaPath || null,
    missingGuide: Boolean(segment.missingGuide)
  };
}

export function temporalGuideState(workspace, segmentId) {
  const segments = orderedVisualSegments(workspace);
  const index = segments.findIndex((segment) => String(segment.id) === String(segmentId));
  const segment = index >= 0 ? segments[index] : null;
  if (!segment) return { first: null, last: null, firstRequested: false, lastRequested: false };

  const previous = index > 0 ? segments[index - 1] : null;
  const next = index < segments.length - 1 ? segments[index + 1] : null;
  const firstRequested = segment.usePreviousAsFirstFrame === true;
  const lastRequested = segment.useNextAsLastFrame === true;
  const usesPrevious = firstRequested && hasApprovedImageGuide(previous);
  const firstSource = usesPrevious
    ? previous
    : hasApprovedVisualGuide(segment) ? segment : null;
  const lastSource = lastRequested && hasApprovedImageGuide(next) ? next : null;

  return {
    first: guideDescriptor(firstSource, "first", usesPrevious ? "previous segment" : "selected segment"),
    last: guideDescriptor(lastSource, "last", "next segment"),
    firstRequested,
    lastRequested
  };
}

function referenceIdentity(reference) {
  const media = reference.canonicalFile
    || reference.file
    || reference.sourceAssetFile
    || reference.assetVersionId
    || reference.assetId
    || reference.id;
  return `${String(reference.role || "semantic_reference").toLowerCase()}|${String(media || "")}`;
}

export function semanticReferenceState(referenceState, frameId = null) {
  const planReferences = Array.isArray(referenceState?.semanticReferences)
    ? referenceState.semanticReferences.filter(Boolean)
    : [];
  const usesPlanReferences = planReferences.length > 0;
  const all = usesPlanReferences
    ? planReferences
    : Array.isArray(referenceState?.references) ? referenceState.references.filter(Boolean) : [];
  const frameReferences = frameId
    ? all.filter((reference) => String(reference.frameId || "") === String(frameId))
    : [];
  // A selected segment owns only its own explicit frame bindings. Never make a
  // reference-free segment inherit references from another frame in the scene.
  const scoped = usesPlanReferences ? planReferences : frameId ? frameReferences : all;
  const references = [...new Map(scoped.map((reference) => [referenceIdentity(reference), reference])).values()]
    .sort((left, right) => {
      const roleDifference = String(left.role || "").localeCompare(String(right.role || ""));
      return roleDifference || (Number(left.order) || 0) - (Number(right.order) || 0);
    });
  const roleMap = new Map();
  for (const reference of references) {
    const role = String(reference.role || "semantic_reference").toLowerCase();
    roleMap.set(role, (roleMap.get(role) || 0) + 1);
  }
  const invalidReferences = Array.isArray(referenceState?.invalidReferences)
    ? referenceState.invalidReferences
    : [];
  const reportedCount = Number(referenceState?.expectedReferenceCount ?? referenceState?.referenceCount ?? references.length);
  return {
    references,
    roleCounts: [...roleMap.entries()].map(([role, count]) => ({ role, count })),
    invalidReferences,
    ready: (usesPlanReferences
      ? referenceState?.semanticReferencesReady !== false
      : referenceState?.referencesReady !== false)
      && !invalidReferences.some((reference) => reference.required),
    scope: !usesPlanReferences && frameId ? "selected-frame" : "scene",
    source: usesPlanReferences ? "video-plan" : "frame-bindings",
    declaredCount: !usesPlanReferences && frameId
      ? references.length
      : Number.isFinite(reportedCount) && reportedCount >= 0 ? reportedCount : references.length
  };
}

function numericEvidence(block) {
  if (!block || typeof block !== "object") return 0;
  if (Array.isArray(block)) return block.length;
  const direct = [
    block.injected,
    block.injectedCount,
    block.injectedReferenceCount,
    block.conditionedCount,
    block.appliedReferenceCount,
    block.referenceCount,
    block.resolved,
    block.resolvedCount,
    block.count
  ]
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0);
  if (direct) return direct;
  for (const value of [block.references, block.files, block.images, block.roles]) {
    if (Array.isArray(value) && value.length) return value.length;
    if (value && typeof value === "object" && Object.keys(value).length) return Object.keys(value).length;
  }
  return 0;
}

/** Keeps the UI honest: resolved bindings are not called "injected" unless a
 * compiler preflight explicitly reports conditioning evidence. */
export function semanticConditioningState(preflight, references) {
  if (!references?.references?.length) {
    return { status: "none", label: "No semantic references", count: 0 };
  }
  if (!references.ready || preflight?.ok === false) {
    return { status: "blocked", label: "Reference preflight blocked", count: 0 };
  }
  const block = preflight?.semanticReferences
    || preflight?.referenceConditioning
    || preflight?.ingredients
    || null;
  const count = numericEvidence(block);
  const explicit = Boolean(
    block?.injected === true
    || Number(block?.injected) > 0
    || Number(block?.injectedCount) > 0
    || Number(block?.injectedReferenceCount) > 0
    || block?.conditioningApplied === true
    || block?.enabled === true
    || block?.active === true
    || ["injected", "conditioned", "ready"].includes(String(block?.status || "").toLowerCase())
    || Array.isArray(block)
  );
  if (explicit && count > 0) {
    return { status: "injected", label: `${count} compiler-conditioned`, count };
  }
  return {
    status: "resolved",
    label: `${references.references.length} bindings resolved`,
    count: references.references.length
  };
}

export function segmentNeighborState(workspace, segmentId) {
  const segments = orderedVisualSegments(workspace);
  const index = segments.findIndex((segment) => String(segment.id) === String(segmentId));
  const segment = index >= 0 ? segments[index] : null;
  const previous = index > 0 ? segments[index - 1] : null;
  const next = index >= 0 && index < segments.length - 1 ? segments[index + 1] : null;
  return {
    canUsePreviousAsFirstFrame: hasApprovedImageGuide(previous),
    canUseNextAsLastFrame: hasApprovedImageGuide(next)
  };
}

export function isSegmentedI2vWorkspace(workspace) {
  return String(workspace?.premiere?.generationMode || "") === I2V_SEGMENTED_FIRST_FRAMES
    || workspace?.premiere?.generateOption?.queueMode === "segments"
    || workspace?.premiere?.generateOption?.id === "harrowing_aaa_i2v_segmented";
}

export function segmentedI2vQueueReady(workspace) {
  return (workspace?.timeline?.segments || []).filter(isVisualGenerationSegment).length > 0;
}

export function semanticT2vLockedForWorkspace(workspace, projectSlug = "") {
  return String(projectSlug || workspace?.premiere?.projectSlug || "") === HARROWING_PROJECT_SLUG
    && isSegmentedI2vWorkspace(workspace);
}

export function visibleGenerateOptions(options, workspace, projectSlug = "") {
  const locked = semanticT2vLockedForWorkspace(workspace, projectSlug);
  return (options || []).filter((option) => {
    if (String(option?.generationMode || option?.id || "") !== SEMANTIC_T2V_GENERATION_MODE) return true;
    return !locked;
  });
}

export function activeTakeOf(segment) {
  const takes = Array.isArray(segment?.generatedTakes) ? segment.generatedTakes.filter(Boolean) : [];
  return takes.find((take) => String(take.id) === String(segment?.activeTakeId))
    || takes.find((take) => Number(take.v) === Number(segment?.activeGeneratedVersion))
    || takes.find((take) => take.previewFile || take.file || take.generatedInputPath)
    || takes[0]
    || null;
}

export function firstPlayablePreviewIndex(playlist) {
  const index = (playlist || []).findIndex((item) => item?.url);
  return index >= 0 ? index : 0;
}
