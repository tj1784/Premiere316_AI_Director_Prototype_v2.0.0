const COMPLETE_STATUSES = new Set(["done", "completed", "complete", "succeeded", "ready", "passed", "validated"]);

function collection(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function numericCueOrder(cue, fallback) {
  const explicit = finite(cue?.globalOrder ?? cue?.order, Number.NaN);
  if (Number.isFinite(explicit)) return explicit;
  const match = clean(cue?.cueId ?? cue?.cue_id).match(/(\d+)/);
  return match ? Number(match[1]) : fallback;
}

export function dialogueCueStatus(cue) {
  const supplied = clean(cue?.status ?? cue?.queueStatus ?? cue?.qaStatus ?? cue?.qaResult).toLowerCase();
  if (supplied) return supplied;
  if (cue?.masterReady || cue?.output?.masterFilename && cue?.output?.exists) return "ready";
  return "planned";
}

export function dialogueCueProgress(cue) {
  const status = dialogueCueStatus(cue);
  if (COMPLETE_STATUSES.has(status)) return 1;
  const supplied = finite(cue?.progress ?? cue?.queueProgress ?? cue?.renderProgress, Number.NaN);
  if (Number.isFinite(supplied)) return clamp(supplied > 1 ? supplied / 100 : supplied);
  const completed = finite(cue?.completedTakes ?? cue?.takesCompleted, Number.NaN);
  const expected = finite(cue?.expectedTakes ?? cue?.takeCount, Number.NaN);
  if (Number.isFinite(completed) && Number.isFinite(expected) && expected > 0) return clamp(completed / expected);
  return 0;
}

export function dialogueCueComplete(cue) {
  return COMPLETE_STATUSES.has(dialogueCueStatus(cue));
}

export function normalizeDialogueCue(cue, index = 0) {
  const cueId = clean(cue?.cueId ?? cue?.cue_id ?? cue?.id) || `CUE-${index + 1}`;
  const segmentId = clean(cue?.segmentId ?? cue?.renderSegmentId ?? cue?.render_segment_id ?? cue?.segment_id);
  const exactDialogue = clean(cue?.exactDialogue ?? cue?.dialogue ?? cue?.text);
  const performanceDirection = clean(cue?.performanceDirection ?? cue?.performance_direction ?? cue?.direction ?? cue?.style);
  const targetVoiceDurationSec = finite(cue?.targetVoiceDurationSec ?? cue?.dialogueTargetSeconds ?? cue?.dialogue_target_seconds, 0);
  const targetVideoDurationSec = finite(cue?.targetVideoDurationSec ?? cue?.videoTargetSeconds ?? cue?.video_target_seconds, 0);
  return {
    ...cue,
    cueId,
    segmentId,
    speaker: clean(cue?.speaker ?? cue?.character) || "UNKNOWN",
    exactDialogue,
    performanceDirection,
    targetVoiceDurationSec,
    targetVideoDurationSec,
    status: dialogueCueStatus(cue),
    progress: dialogueCueProgress(cue),
    _order: numericCueOrder(cue, index + 1)
  };
}

export function dialogueCuesFromSound(sound) {
  const values = collection(
    sound?.dialogueCues
    ?? sound?.dialogueCuePlan?.cues
    ?? sound?.authoritativeDialogue?.cues
  );
  return values
    .map((cue, index) => normalizeDialogueCue(cue, index))
    .sort((left, right) => left._order - right._order || left.cueId.localeCompare(right.cueId));
}

export function dialogueClipId(value) {
  return clean(value).toUpperCase().match(/H\d{2}-S\d{2}-C\d{2}/)?.[0] || "";
}

function normalizedSegmentIdentity(value) {
  const text = clean(value).toUpperCase().replace(/^SEGMENT-/, "");
  const clipId = dialogueClipId(text);
  if (!clipId) return { clipId: "", number: "", suffix: "", exact: "" };
  const tail = text.slice(text.indexOf(clipId) + clipId.length);
  const match = tail.match(/(?:^|-)(?:SEG)?(\d{1,2})([A-Z]?)(?:$|-)/);
  const number = match ? String(Number(match[1])) : "";
  const suffix = match?.[2] || "";
  return { clipId, number, suffix, exact: `${clipId}:${number}:${suffix}` };
}

function selectedCueIds(segment) {
  return collection(segment?.dialogueCueIds ?? segment?.cueIds)
    .concat(segment?.dialogueCueId ?? segment?.cueId ?? [])
    .map(clean)
    .filter(Boolean);
}

export function dialogueCuesForClip(cues, clipId) {
  const wanted = dialogueClipId(clipId);
  if (!wanted) return [];
  return collection(cues).filter((cue) => dialogueClipId(cue?.segmentId) === wanted);
}

export function dialogueCuesForSegment(cues, segment, clipId = "") {
  if (!segment) return [];
  const explicitIds = new Set(selectedCueIds(segment));
  if (explicitIds.size) return collection(cues).filter((cue) => explicitIds.has(clean(cue?.cueId)));

  const selectedIdentity = normalizedSegmentIdentity(segment?.id ?? segment?.segmentId);
  const selectedClip = selectedIdentity.clipId || dialogueClipId(clipId);
  return collection(cues).filter((cue) => {
    const cueIdentity = normalizedSegmentIdentity(cue?.segmentId);
    if (!selectedClip || cueIdentity.clipId !== selectedClip) return false;
    if (!selectedIdentity.number) return false;
    if (cueIdentity.number !== selectedIdentity.number) return false;
    // An authored A/B segment selects only its exact cue. A legacy unsuffixed
    // placeholder intentionally exposes both authored continuations.
    return !selectedIdentity.suffix || cueIdentity.suffix === selectedIdentity.suffix;
  });
}

export const __dialogueCueTest = Object.freeze({ normalizedSegmentIdentity });
