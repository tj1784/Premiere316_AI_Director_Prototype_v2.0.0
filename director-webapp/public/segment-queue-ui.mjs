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

function orderedTimelineVisualSegments(workspace) {
  return (workspace?.timeline?.segments || [])
    .filter(isTimelineVisualSegment)
    .slice()
    .sort((left, right) => {
      const startDifference = (Number(left.start) || 0) - (Number(right.start) || 0);
      return startDifference || String(left.id || "").localeCompare(String(right.id || ""));
    });
}

export function orderedVisualSegments(workspace) {
  return (workspace?.timeline?.segments || [])
    .filter(isVisualGenerationSegment)
    .slice()
    .sort((left, right) => {
      const startDifference = (Number(left.start) || 0) - (Number(right.start) || 0);
      return startDifference || String(left.id || "").localeCompare(String(right.id || ""));
    });
}

export function selectTimelineSegment(workspace, segmentId) {
  const segment = [
    ...(workspace?.timeline?.segments || []),
    ...(workspace?.timeline?.audioSegments || []),
    ...(workspace?.timeline?.motionSegments || [])
  ].find((candidate) => String(candidate.id) === String(segmentId));
  if (!segment || !workspace) return null;
  workspace.selectedSegmentId = segment.id;
  workspace.playheadFrame = Number(segment.start) || 0;
  return segment;
}

export function segmentPromptPreview(segment) {
  const prompt = String(segment?.prompt || "").replace(/\s+/g, " ").trim();
  if (!prompt || !/^Begin exactly\b/i.test(prompt)) return prompt;
  const firstSentenceEnd = prompt.search(/[.!?](?:\s+|$)/);
  if (firstSentenceEnd < 0) return prompt;
  const action = prompt.slice(firstSentenceEnd + 1).trim();
  return action || prompt;
}

export function shouldCommitSegmentDrag(deltaFrame, canceled = false) {
  return !canceled && Number.isFinite(Number(deltaFrame)) && Number(deltaFrame) !== 0;
}

export function segmentNeighborState(workspace, segmentId) {
  const segments = orderedTimelineVisualSegments(workspace);
  const index = segments.findIndex((segment) => String(segment.id) === String(segmentId));
  const segment = index >= 0 ? segments[index] : null;
  const previous = index > 0 ? segments[index - 1] : null;
  const next = index >= 0 && index < segments.length - 1 ? segments[index + 1] : null;
  const canUsePreviousAsFirstFrame = hasApprovedImageGuide(previous);
  const canUseNextAsLastFrame = hasApprovedImageGuide(next);
  return {
    segment,
    previous,
    next,
    index,
    total: segments.length,
    canUsePreviousAsFirstFrame,
    canUseNextAsLastFrame,
    usePreviousAsFirstFrame: Boolean(canUsePreviousAsFirstFrame && segment?.usePreviousAsFirstFrame),
    useNextAsLastFrame: Boolean(canUseNextAsLastFrame && segment?.useNextAsLastFrame)
  };
}

export function queueRequestBody(mode, workspace, segmentId = null) {
  const normalizedMode = mode === "selected" ? "selected" : mode === "segments" ? "segments" : "timeline";
  if (normalizedMode !== "selected") return { mode: normalizedMode };
  const selectedSegmentId = segmentId ?? workspace?.selectedSegmentId;
  return { mode: normalizedMode, segmentId: selectedSegmentId == null ? null : String(selectedSegmentId) };
}
