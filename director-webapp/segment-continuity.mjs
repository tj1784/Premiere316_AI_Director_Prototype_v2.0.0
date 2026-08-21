function normalizedPath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function passContract(segment) {
  if (segment?.mythicDialoguePass) {
    const pass = segment.mythicDialoguePass;
    return {
      packageId: pass.packageId || null,
      passId: pass.renderId || null,
      decodedFrameIndex: Number(pass.handoffFrameIndex),
      outputHandoff: normalizedPath(pass.outputHandoff),
      kind: "mythic_dialogue"
    };
  }
  if (segment?.correctedPass) {
    const pass = segment.correctedPass;
    return {
      packageId: pass.packageId || null,
      passId: pass.passId || null,
      decodedFrameIndex: Number(pass.tailExportDecodedIndex),
      outputHandoff: normalizedPath(pass.acceptedTailDestination),
      kind: "corrected_pass"
    };
  }
  return null;
}

export function segmentQueueReadiness(timeline, jobs, mode) {
  const visualSegments = (timeline?.segments || []).filter((segment) => [undefined, "image", "video"].includes(segment?.type));
  const hasVisualGuide = visualSegments.some((segment) => !segment.missingGuide && Boolean(
    segment.imageFile || segment.videoFile || segment.imageB64 || segment.projectMediaPath
  ));
  const missingGuides = visualSegments
    .filter((segment) => segment.missingGuide)
    .map((segment) => segment.storyboardFrameId || segment.id)
    .filter(Boolean);
  const queuedJobs = Array.isArray(jobs) ? jobs : [];
  if (!queuedJobs.length) {
    return {
      ready: false,
      hasVisualGuide,
      missingGuides,
      reason: "no_renderable_segments"
    };
  }
  if (mode === "timeline" && (!hasVisualGuide || missingGuides.length)) {
    return {
      ready: false,
      hasVisualGuide,
      missingGuides,
      reason: missingGuides.length ? "timeline_missing_guides" : "timeline_missing_visual_guide"
    };
  }
  // Selected and segmented I2V requests operate only on the jobs that
  // buildSegmentJobs proved have an approved guide. Later continuation passes
  // are intentionally pending until the preceding N+1 tail is accepted.
  return {
    ready: true,
    hasVisualGuide,
    missingGuides,
    reason: null
  };
}

export function continuationTargetForSegment(storyboard, clipId, sourceSegmentId) {
  const clip = storyboard?.clips?.[clipId];
  const plan = storyboard?.videoPlans?.[clip?.videoPlanId];
  if (!clip || !plan) return null;
  const segmentIds = Array.isArray(plan.segmentIds) ? plan.segmentIds : [];
  const sourceIndex = segmentIds.findIndex((id) => String(id) === String(sourceSegmentId));
  if (sourceIndex < 0 || sourceIndex + 1 >= segmentIds.length) return null;
  const source = storyboard.segments?.[segmentIds[sourceIndex]];
  const targetSegment = storyboard.segments?.[segmentIds[sourceIndex + 1]];
  const targetFrame = storyboard.frames?.[targetSegment?.frameId];
  const continuity = targetFrame?.continuityInput;
  if (!source || !targetSegment || !targetFrame || continuity?.required !== true) return null;

  const contract = passContract(source);
  if (!contract?.passId) return null;
  const expectedPrevious = String(continuity.previousRenderId || continuity.previousPassId || "");
  if (!expectedPrevious) throw new Error(`Continuation frame ${targetFrame.id} does not declare its previous pass`);
  if (String(contract.passId) !== expectedPrevious) {
    throw new Error(`Continuation frame ${targetFrame.id} expects ${expectedPrevious}, not ${contract.passId}`);
  }
  const decodedFrameIndex = Math.round(Number(continuity.decodedFrameIndex));
  if (!Number.isInteger(decodedFrameIndex) || decodedFrameIndex < 1) {
    throw new Error(`Continuation frame ${targetFrame.id} has an invalid decoded frame index`);
  }
  const sourceLength = Math.max(1, Math.round(Number(source.lengthFrames) || 1));
  if (decodedFrameIndex !== sourceLength) {
    throw new Error(`Continuation frame ${targetFrame.id} requires decoded frame ${decodedFrameIndex}, but ${source.id} has ${sourceLength} editorial frames`);
  }
  if (Number.isFinite(contract.decodedFrameIndex) && contract.decodedFrameIndex !== decodedFrameIndex) {
    throw new Error(`Continuation contract ${contract.passId} declares decoded frame ${contract.decodedFrameIndex}, not ${decodedFrameIndex}`);
  }
  const expectedSource = normalizedPath(continuity.expectedSource);
  if (contract.outputHandoff && expectedSource && contract.outputHandoff !== expectedSource) {
    throw new Error(`Continuation contract ${contract.passId} outputs ${contract.outputHandoff}, not ${expectedSource}`);
  }
  const generatedVersions = Array.isArray(targetFrame.generatedVersions) ? targetFrame.generatedVersions : [];
  const pending = targetFrame.status === "pending_accepted_decoded_tail"
    && !targetFrame.generatedFile
    && !targetFrame.activeGeneratedVersion
    && generatedVersions.length === 0;
  return {
    clipId: clip.id,
    videoPlanId: plan.id,
    sourceSegmentId: source.id,
    targetSegmentId: targetSegment.id,
    targetFrameId: targetFrame.id,
    passId: contract.passId,
    packageId: contract.packageId,
    contractKind: contract.kind,
    decodedFrameIndex,
    expectedSource: expectedSource || contract.outputHandoff,
    outputHandoff: contract.outputHandoff || expectedSource,
    pending
  };
}

export function applyContinuationHandoff(storyboard, {
  clipId,
  sourceSegmentId,
  sourcePromptId,
  sourceTakeId,
  handoff
}) {
  const target = continuationTargetForSegment(storyboard, clipId, sourceSegmentId);
  if (!target) return { applied: false, reason: "no_continuation_target" };
  const source = storyboard.segments?.[sourceSegmentId];
  const targetSegment = storyboard.segments?.[target.targetSegmentId];
  const frame = storyboard.frames?.[target.targetFrameId];
  const promptId = String(sourcePromptId || "");
  if (!promptId || String(handoff?.sourcePromptId || "") !== promptId) {
    throw new Error("Continuation handoff prompt provenance does not match the completed Director render");
  }
  const activeSourceTake = (source?.generatedVersions || []).find((take) => (
    String(take.id || "") === String(source?.activeTakeId || "")
    || Number(take.v) === Number(source?.activeGeneratedVersion)
  ));
  if (!activeSourceTake
    || String(activeSourceTake.id || "") !== String(sourceTakeId || "")
    || String(activeSourceTake.comfyPromptId || activeSourceTake.promptId || "") !== promptId) {
    return { applied: false, reason: "source_take_not_active", target };
  }
  const duplicate = (frame.generatedVersions || []).find((version) => (
    version.source === "ltx25_director_segment_handoff"
    && String(version.sourcePromptId || "") === promptId
  ));
  if (duplicate) {
    if (String(duplicate.fileHashes?.[0]?.sha256 || "").toLowerCase() !== String(handoff.sha256 || "").toLowerCase()) {
      throw new Error(`Existing continuation handoff for ${promptId} has different bytes`);
    }
    return { applied: true, idempotent: true, target, version: duplicate };
  }
  if (!target.pending) return { applied: false, reason: "target_frame_already_selected", target };
  if (!handoff?.file || !handoff?.sha256 || !(Number(handoff?.bytes) > 0)) {
    throw new Error("Continuation handoff media ledger is incomplete");
  }
  if (Math.round(Number(handoff.sourceFrameIndex)) !== target.decodedFrameIndex) {
    throw new Error(`Continuation handoff extracted frame ${handoff.sourceFrameIndex}, expected ${target.decodedFrameIndex}`);
  }
  const versionNumber = Math.max(0, ...(frame.generatedVersions || []).map((version) => Number(version.v) || 0)) + 1;
  const version = {
    v: versionNumber,
    files: [handoff.file],
    file: handoff.file,
    mediaType: "image",
    source: "ltx25_director_segment_handoff",
    sourceClipId: clipId,
    sourceSegmentId,
    sourceTakeId,
    sourcePromptId: promptId,
    sourceOutputNodeId: String(handoff.sourceOutputNodeId || "94"),
    sourceFrameIndex: target.decodedFrameIndex,
    sourcePassId: target.passId,
    packageId: target.packageId,
    workflowId: "ltx25-director-webapp",
    workflowHash: handoff.workflowHash || null,
    fileHashes: [{
      file: handoff.file,
      sha256: String(handoff.sha256).toLowerCase(),
      bytes: Number(handoff.bytes),
      extension: ".png"
    }],
    createdAt: handoff.createdAt || new Date().toISOString()
  };
  frame.generatedVersions = Array.isArray(frame.generatedVersions) ? frame.generatedVersions : [];
  frame.generatedVersions.push(version);
  frame.activeGeneratedVersion = versionNumber;
  frame.generatedFile = handoff.file;
  frame.generatedInputPath = `media/storyboard/${handoff.file}`;
  frame.generatedAssetId = frame.id;
  frame.generatedAssetVersionId = `${frame.id}:v${versionNumber}`;
  frame.status = "generated";
  frame.lastError = null;
  frame.handoffRegisteredAt = version.createdAt;
  frame.continuityInput = {
    ...frame.continuityInput,
    status: "accepted_decoded_tail",
    acceptedSourceTakeId: sourceTakeId,
    sourcePromptId: promptId,
    sourceSha256: String(handoff.sha256).toLowerCase(),
    registeredAt: version.createdAt
  };
  if (targetSegment) targetSegment.status = "ready";
  return { applied: true, idempotent: false, target, version };
}
