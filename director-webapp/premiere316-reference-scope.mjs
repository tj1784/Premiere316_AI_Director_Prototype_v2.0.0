function list(value) {
  return Array.isArray(value) ? value : [];
}

function isFirstFrameI2v(workspace) {
  const optionId = String(workspace?.premiere?.generateOptionId || workspace?.premiere?.generateOption?.id || "");
  return optionId === "harrowing_aaa_i2v_segmented"
    || String(workspace?.premiere?.generationMode || "") === "i2v_segmented_first_frames";
}

/**
 * Select the semantic-reference state that is relevant to one Director request.
 * A selected segmented-I2V request is deliberately isolated to its own
 * storyboard frame. Full-segment requests retain the complete scene state.
 */
export function scopePremiere316ReferenceState(workspace, state, options = {}) {
  const firstFrameI2v = isFirstFrameI2v(workspace);
  const requestedSegmentId = String(options.segmentId || "").trim();
  const selectedScope = firstFrameI2v && (options.mode === "selected" || Boolean(requestedSegmentId));

  if (!firstFrameI2v) {
    const semanticReferences = list(state?.semanticReferences);
    const invalidReferences = list(state?.invalidReferences);
    return {
      firstFrameI2v,
      selectedScope: false,
      segmentId: null,
      frameId: null,
      semanticReferences,
      invalidReferences,
      expectedCount: Number(state?.expectedReferenceCount ?? workspace?.premiere?.expectedReferenceCount ?? 0),
      referencesReady: state?.semanticReferencesReady === true
    };
  }

  if (!selectedScope) {
    const semanticReferences = list(state?.references);
    const invalidReferences = list(state?.invalidReferences);
    return {
      firstFrameI2v,
      selectedScope: false,
      segmentId: null,
      frameId: null,
      semanticReferences,
      invalidReferences,
      expectedCount: semanticReferences.length,
      referencesReady: state?.referencesReady === true
    };
  }

  const segmentId = requestedSegmentId || String(workspace?.selectedSegmentId || "").trim();
  if (!segmentId) {
    throw new Error("Selected Premiere316 reference preparation requires a segmentId");
  }
  const segment = list(workspace?.timeline?.segments).find((item) => String(item?.id || "") === segmentId);
  if (!segment) {
    throw new Error(`Selected Premiere316 segment was not found: ${segmentId}`);
  }
  const frameId = String(segment.storyboardFrameId || "").trim();
  if (!frameId) {
    throw new Error(`Selected Premiere316 segment ${segmentId} has no storyboard reference frame`);
  }

  const semanticReferences = list(state?.references)
    .filter((reference) => String(reference?.frameId || "") === frameId);
  const invalidReferences = list(state?.invalidReferences)
    .filter((reference) => String(reference?.frameId || "") === frameId);
  const requiredFailures = invalidReferences.filter((reference) => reference?.required === true);
  return {
    firstFrameI2v,
    selectedScope: true,
    segmentId,
    frameId,
    semanticReferences,
    invalidReferences,
    expectedCount: semanticReferences.length,
    referencesReady: requiredFailures.length === 0
  };
}
