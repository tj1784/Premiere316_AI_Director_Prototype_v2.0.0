import crypto from "crypto";
import {
  canonicalSemanticReferenceRole,
  generateOptionsForContext,
  LTX25_PREMIERE316_PROFILE,
  premiere316ProfileForWorkspace
} from "./premiere-api-delegation.mjs";

const DIRECTOR_TYPES = new Set(["LTXDirector", "BlokeyLtxDirector"]);
const DIRECTOR_GUIDE_TYPES = new Set(["LTXDirectorGuide", "BlokeyLtxDirectorGuide"]);
const PREMIERE316_NODE_IDS = Object.freeze({
  resolver: "200",
  sheet: "201",
  repeat: "202",
  loader: "203",
  addGuide: "204",
  length: "2000"
});

function clone(value) {
  return structuredClone(value);
}

function asLink(link) {
  if (Array.isArray(link)) {
    return {
      id: link[0],
      origin_id: link[1],
      origin_slot: link[2],
      target_id: link[3],
      target_slot: link[4],
      type: link[5]
    };
  }
  return link;
}

function workflowDefinitions(graph) {
  return new Map((graph?.definitions?.subgraphs || []).map((definition) => [definition.id, definition]));
}

function workflowContainers(graph) {
  return [graph, ...(graph?.definitions?.subgraphs || [])];
}

function normalizedLinks(container) {
  return (container?.links || []).map(asLink);
}

function nodeMap(container) {
  return new Map((container?.nodes || []).map((node) => [String(node.id), node]));
}

function connect(graph, sourceId, sourceSlot, targetId, targetSlot, type = "*") {
  const source = graph.nodes.find((node) => String(node.id) === String(sourceId));
  const target = graph.nodes.find((node) => String(node.id) === String(targetId));
  if (!source || !target) throw new Error(`Cannot connect ${sourceId}:${sourceSlot} to ${targetId}:${targetSlot}`);
  const input = target.inputs?.[targetSlot];
  const output = source.outputs?.[sourceSlot];
  if (!input || !output) throw new Error(`Invalid connection slot ${sourceId}:${sourceSlot} to ${targetId}:${targetSlot}`);
  const id = ++graph.last_link_id;
  graph.links.push([id, source.id, sourceSlot, target.id, targetSlot, type || output.type || input.type || "*"]);
  input.link = id;
  output.links = Array.isArray(output.links) ? output.links : [];
  output.links.push(id);
}

/**
 * Expand ComfyUI frontend subgraph wrappers into ordinary backend nodes.
 * The supplied Director workflow uses one wrapper, but this also supports
 * nested non-recursive subgraphs.
 */
export function flattenWorkflow(graph) {
  const definitions = workflowDefinitions(graph);
  const containers = workflowContainers(graph);
  const instanceTypes = new Set(definitions.keys());
  const nodes = [];
  const seen = new Set();

  for (const container of containers) {
    for (const sourceNode of container.nodes || []) {
      if (instanceTypes.has(sourceNode.type)) continue;
      const key = String(sourceNode.id);
      if (seen.has(key)) throw new Error(`Workflow reuses executable node id ${key}`);
      seen.add(key);
      const node = clone(sourceNode);
      for (const input of node.inputs || []) input.link = null;
      for (const output of node.outputs || []) output.links = null;
      nodes.push(node);
    }
  }

  const maps = new Map(containers.map((container) => [container, nodeMap(container)]));
  const links = new Map(containers.map((container) => [container, normalizedLinks(container)]));

  function resolveSource(container, nodeId, slot, stack = []) {
    const node = maps.get(container)?.get(String(nodeId));
    if (!node) return null;
    const definition = definitions.get(node.type);
    if (!definition) return { nodeId: node.id, slot };
    if (stack.includes(node.type)) throw new Error(`Recursive subgraph: ${[...stack, node.type].join(" -> ")}`);
    const boundary = links.get(definition)?.find((link) =>
      Number(link.target_id) === -20 && Number(link.target_slot) === Number(slot)
    );
    return boundary ? resolveSource(definition, boundary.origin_id, boundary.origin_slot, [...stack, node.type]) : null;
  }

  function resolveTargets(container, nodeId, slot, stack = []) {
    const node = maps.get(container)?.get(String(nodeId));
    if (!node) return [];
    const definition = definitions.get(node.type);
    if (!definition) return [{ nodeId: node.id, slot }];
    if (stack.includes(node.type)) throw new Error(`Recursive subgraph: ${[...stack, node.type].join(" -> ")}`);
    return (links.get(definition) || [])
      .filter((link) => Number(link.origin_id) === -10 && Number(link.origin_slot) === Number(slot))
      .flatMap((link) => resolveTargets(definition, link.target_id, link.target_slot, [...stack, node.type]));
  }

  const edgeMap = new Map();
  for (const container of containers) {
    for (const link of links.get(container) || []) {
      if (Number(link.origin_id) === -10 || Number(link.target_id) === -20) continue;
      const source = resolveSource(container, link.origin_id, link.origin_slot);
      if (!source) continue;
      for (const target of resolveTargets(container, link.target_id, link.target_slot)) {
        const key = `${source.nodeId}:${source.slot}>${target.nodeId}:${target.slot}`;
        edgeMap.set(key, { ...source, targetNodeId: target.nodeId, targetSlot: target.slot, type: link.type || "*" });
      }
    }
  }

  const flat = {
    nodes,
    links: [],
    last_node_id: Math.max(0, ...nodes.map((node) => Number(node.id) || 0)),
    last_link_id: 0,
    extra: clone(graph.extra || {})
  };
  for (const edge of edgeMap.values()) {
    connect(flat, edge.nodeId, edge.slot, edge.targetNodeId, edge.targetSlot, edge.type);
  }
  return flat;
}

function parseTimeline(value) {
  if (typeof value === "string") return JSON.parse(value || "{}");
  return clone(value || {});
}

function timelineEnd(timeline) {
  return Math.max(
    1,
    ...[...(timeline.segments || []), ...(timeline.motionSegments || []), ...(timeline.audioSegments || [])]
      .map((segment) => Math.max(0, Number(segment.start) || 0) + Math.max(1, Number(segment.length) || 1))
  );
}

function sourceHash(sourceText) {
  return crypto.createHash("sha256").update(sourceText).digest("hex");
}

export function workspaceFromWorkflow(graph, sourceText, comfyUrl = "http://127.0.0.1:8188") {
  const director = (graph.nodes || []).find((node) => DIRECTOR_TYPES.has(node.type));
  if (!director) throw new Error("The supplied workflow does not contain an LTX Director node.");
  const resolutionPlan = (graph.nodes || []).find((node) => node.type === "LTX25ResolutionPlan");
  const wrapperTypes = new Set((graph?.definitions?.subgraphs || []).map((definition) => definition.id));
  const wrapper = (graph.nodes || []).find((node) => wrapperTypes.has(node.type));
  const properties = director.properties || {};
  const timeline = parseTimeline(properties.timeline_data || director.widgets_values?.[6] || "{}");
  timeline.segments ||= [];
  timeline.motionSegments ||= [];
  timeline.audioSegments ||= [];
  const fps = Math.max(1, Number(properties.frame_rate) || 24);
  const first = timeline.segments.find((segment) => segment.type !== "text") || timeline.segments[0] || null;

  return {
    schema: "premiere316.director-webapp/v1",
    source: {
      workflowId: graph.id || graph.extra?.workflow_id || null,
      sha256: sourceHash(sourceText),
      directorNodeId: String(director.id),
      resolutionNodeId: resolutionPlan ? String(resolutionPlan.id) : null,
      loadedAt: new Date().toISOString()
    },
    selectedSegmentId: first?.id || null,
    playheadFrame: Number(first?.start) || 0,
    timeline,
    settings: {
      comfyUrl,
      frameRate: fps,
      customWidth: Math.max(32, Number(resolutionPlan?.widgets_values?.[0] ?? properties.custom_width) || 1128),
      customHeight: Math.max(32, Number(resolutionPlan?.widgets_values?.[1] ?? properties.custom_height) || 480),
      resizeMethod: properties.resize_method || "maintain aspect ratio",
      divisibleBy: Math.max(8, Number(properties.divisible_by) || 32),
      imageCompression: Number(properties.img_compression) || 18,
      guideStrength: String(properties.guide_strength || "1.00"),
      useCustomAudio: properties.use_custom_audio !== false,
      useCustomMotion: properties.use_custom_motion !== false,
      inpaintAudio: properties.inpaint_audio !== false,
      overrideAudio: Boolean(properties.override_audio || properties.overrideAudio),
      negativePrompt: String(wrapper?.widgets_values?.[1] || "worst quality, inconsistent motion, blurry, jittery, distorted"),
      outputPrefix: "director_webapp/ltx25_director",
      queueMode: "segments"
    },
    stats: {
      durationFrames: timelineEnd(timeline),
      durationSeconds: timelineEnd(timeline) / fps
    }
  };
}

function cleanSegment(segment) {
  const copy = clone(segment);
  delete copy.imageB64;
  delete copy.waveformPeaks;
  delete copy.thumbnails;
  delete copy._blobUrl;
  delete copy._audioBuffer;
  return copy;
}

export function workspaceForClient(workspace) {
  const copy = clone(workspace);
  copy.timeline.segments = (copy.timeline.segments || []).map(cleanSegment);
  copy.timeline.motionSegments = (copy.timeline.motionSegments || []).map(cleanSegment);
  copy.timeline.audioSegments = (copy.timeline.audioSegments || []).map(cleanSegment);
  normalizeAdjacentFrameOptions(copy);
  applyHarrowingGenLock(copy);
  if (copy.premiere) {
    copy.premiere.generateOptions = generateOptionsForContext({
      projectSlug: copy.premiere.projectSlug,
      generationMode: copy.premiere.generateOption?.generationMode || copy.premiere.generationMode
    });
  }
  copy.stats = {
    durationFrames: timelineEnd(copy.timeline),
    durationSeconds: timelineEnd(copy.timeline) / Math.max(1, Number(copy.settings.frameRate) || 24)
  };
  return copy;
}

export function mergeWorkspace(previous, incoming) {
  const next = clone(incoming);
  const previousSegments = [
    ...(previous.timeline?.segments || []),
    ...(previous.timeline?.motionSegments || []),
    ...(previous.timeline?.audioSegments || [])
  ];
  const byId = new Map(previousSegments.map((segment) => [String(segment.id), segment]));
  for (const key of ["segments", "motionSegments", "audioSegments"]) {
    next.timeline[key] = (next.timeline?.[key] || []).map((segment) => {
      const prior = byId.get(String(segment.id));
      return {
        ...(prior?.imageB64 ? { imageB64: prior.imageB64 } : {}),
        ...(prior?.waveformPeaks ? { waveformPeaks: prior.waveformPeaks } : {}),
        ...segment
      };
    });
  }
  next.schema = "premiere316.director-webapp/v1";
  next.source = clone(previous.source);
  normalizeAdjacentFrameOptions(next);
  next.settings.frameRate = Math.max(1, Math.min(120, Number(next.settings.frameRate) || 24));
  next.settings.customWidth = Math.max(32, Math.min(8192, Math.round(Number(next.settings.customWidth) || 1128)));
  next.settings.customHeight = Math.max(32, Math.min(8192, Math.round(Number(next.settings.customHeight) || 480)));
  applyHarrowingGenLock(next);
  next.stats = {
    durationFrames: timelineEnd(next.timeline),
    durationSeconds: timelineEnd(next.timeline) / next.settings.frameRate
  };
  return next;
}

function clipTrack(segments, start, end) {
  return (segments || []).flatMap((source) => {
    const sourceStart = Number(source.start) || 0;
    const sourceLength = Math.max(1, Number(source.length) || 1);
    const overlapStart = Math.max(sourceStart, start);
    const overlapEnd = Math.min(sourceStart + sourceLength, end);
    if (overlapEnd <= overlapStart) return [];
    const segment = clone(source);
    segment.start = overlapStart - start;
    segment.length = overlapEnd - overlapStart;
    if (overlapStart > sourceStart && segment.trimStart !== undefined) {
      segment.trimStart = (Number(segment.trimStart) || 0) + overlapStart - sourceStart;
    }
    return [segment];
  });
}


export const HARROWING_GEN_LOCK = Object.freeze({
  width: 1792,
  height: 768,
  fps: 30,
  seconds: 13,
  pass1Sigmas: "1.0, 0.996875, 0.99375, 0.990625, 0.9875, 0.984375, 0.98125, 0.978125, 0.975, 0.9421875, 0.909375, 0.8171875, 0.725"
});

export function isHarrowingGenerate(workspace) {
  const id = String(workspace?.premiere?.generateOptionId || workspace?.premiere?.generateOption?.id || "");
  return id === "harrowing_aaa_i2v_segmented";
}

export function applyHarrowingGenLock(workspace) {
  return workspace;
}

export function ltxFrameCount(requestedFrames) {
  const requested = Math.max(1, Math.round(Number(requestedFrames) || 1));
  return Math.ceil((requested - 1) / 8) * 8 + 1;
}

const VISUAL_SEGMENT_TYPES = new Set([undefined, "image", "video"]);
const GUIDE_MEDIA_FIELDS = [
  "type",
  "imageFile",
  "videoFile",
  "imageB64",
  "fileName",
  "projectMediaPath",
  "projectMediaBytes",
  "projectMediaSha256",
  "storyboardFrameId",
  "missingGuide"
];

function isVisualSegment(segment) {
  return Boolean(segment) && VISUAL_SEGMENT_TYPES.has(segment.type);
}

function hasVisualGuide(segment) {
  return isVisualSegment(segment)
    && !segment.missingGuide
    && Boolean(segment.imageFile || segment.videoFile || segment.imageB64 || segment.projectMediaPath);
}

function hasImageGuide(segment) {
  return hasVisualGuide(segment)
    && segment.type !== "video"
    && Boolean(segment.imageFile || segment.imageB64 || segment.projectMediaPath);
}

function orderedVisualSegments(timeline) {
  return (timeline.segments || [])
    .filter(isVisualSegment)
    .filter((segment) => (Number(segment.length) || 0) > 0)
    .slice()
    .sort((a, b) => {
      const startDifference = (Number(a.start) || 0) - (Number(b.start) || 0);
      return startDifference || String(a.id || "").localeCompare(String(b.id || ""));
    });
}

export function normalizeAdjacentFrameOptions(workspace) {
  const visualSources = orderedVisualSegments(workspace?.timeline || {});
  for (let index = 0; index < visualSources.length; index += 1) {
    const segment = visualSources[index];
    if (segment.usePreviousAsFirstFrame === true && !hasImageGuide(visualSources[index - 1])) {
      segment.usePreviousAsFirstFrame = false;
    }
    if (segment.useNextAsLastFrame === true && !hasImageGuide(visualSources[index + 1])) {
      segment.useNextAsLastFrame = false;
    }
  }
  return workspace;
}

function copyGuideMedia(target, guideSource) {
  for (const field of GUIDE_MEDIA_FIELDS) delete target[field];
  for (const field of GUIDE_MEDIA_FIELDS) {
    if (guideSource[field] !== undefined) target[field] = clone(guideSource[field]);
  }
  return target;
}

function adjacentImageGuide(source, adjacent, role) {
  if (!adjacent) {
    throw new Error(`Segment ${source.id} cannot use the ${role} segment as a frame because it is at the ${role === "previous" ? "start" : "end"} of the timeline`);
  }
  if (!hasImageGuide(adjacent)) {
    throw new Error(`Segment ${source.id} cannot use ${adjacent.id} as its ${role === "previous" ? "first" : "last"} frame because that adjacent segment has no approved image guide`);
  }
  return adjacent;
}

function segmentSpecificGlobalPrompt(source, workspace, index, total) {
  const authored = String(source?.global_prompt || "").trim();
  if (authored) return authored;
  const fps = Math.max(1, Number(workspace.settings.frameRate) || 24);
  const length = Math.max(1, Math.round(Number(source.length) || 1));
  const seconds = (length / fps).toFixed(3);
  const width = Math.max(32, Number(workspace.settings.customWidth) || 1920);
  const height = Math.max(32, Number(workspace.settings.customHeight) || 800);
  const clipId = String(workspace?.premiere?.clipId || "").trim();
  const segId = String(source?.id || `segment-${index}`);
  return [
    "PREMIERE316 LTX-2.5 — SINGLE SEGMENT I2V JOB",
    `THIS JOB IS ONLY ${segId} (${index} of ${total}${clipId ? `, ${clipId}` : ""}).`,
    `Duration ${seconds} seconds / ${length} frames. Framing 2.35:1 at ${width}×${height}.`,
    "ComfyUI does not receive the rest of the scene. Do not generate any other segment. Do not continue a longer clip. Do not invent off-screen story.",
    "The supplied first frame is the entire world for this job. Begin exactly from it. Animate only this segment's local prompt.",
    String(source?.prompt || "").trim()
  ].filter(Boolean).join("\n");
}

export function buildSegmentJobs(workspace, selectedId = null) {
  applyHarrowingGenLock(workspace);
  const timeline = workspace.timeline;
  const fps = Math.max(1, Number(workspace.settings.frameRate) || 24);
  const visualSources = orderedVisualSegments(timeline);
  let sources = visualSources.filter(hasVisualGuide);
  if (selectedId !== null && selectedId !== undefined && String(selectedId)) {
    const selected = (timeline.segments || []).find((segment) => String(segment.id) === String(selectedId));
    if (!selected) throw new Error(`Timeline segment not found: ${selectedId}`);
    if (!isVisualSegment(selected)) throw new Error(`Timeline segment ${selectedId} is not an image or video generation segment`);
    if (!hasVisualGuide(selected)) throw new Error(`Timeline segment ${selectedId} has no approved visual guide`);
    sources = [selected];
  }
  return sources.map((source, queueIndex) => {
    const sourceIndex = visualSources.findIndex((segment) => String(segment.id) === String(source.id));
    if (sourceIndex < 0) throw new Error(`Timeline segment not found while building its job: ${source.id}`);
    const sourceStart = Number(source.start) || 0;
    const sourceLength = Math.max(1, Math.round(Number(source.length) || 1));
    const declaredTailIndex = Math.round(Number(
      source.mythicDialoguePass?.handoffFrameIndex
      ?? source.correctedPass?.tailExportDecodedIndex
      ?? sourceLength
    ));
    const declaresContinuationTail = Boolean(
      source.expectedOutputHandoff
      || source.acceptedTailDestination
      || source.mythicDialoguePass?.outputHandoff
      || source.correctedPass?.acceptedTailDestination
    ) && sourceIndex + 1 < visualSources.length;
    const declaredDecodedFrames = Math.max(0, Math.round(Number(
      source.correctedPass?.ltxRequiredDecodedFrames
      ?? source.mythicDialoguePass?.ltxRequiredDecodedFrames
      ?? 0
    )));
    const durationFrames = Math.max(
      ltxFrameCount(sourceLength),
      declaredDecodedFrames,
      declaresContinuationTail ? ltxFrameCount(declaredTailIndex + 1) : 0
    );
    const sourceEnd = sourceStart + sourceLength;
    const usePreviousAsFirstFrame = source.usePreviousAsFirstFrame === true;
    const useNextAsLastFrame = source.useNextAsLastFrame === true;
    const firstGuideSource = usePreviousAsFirstFrame
      ? adjacentImageGuide(source, visualSources[sourceIndex - 1], "previous")
      : source;
    const lastGuideSource = useNextAsLastFrame
      ? adjacentImageGuide(source, visualSources[sourceIndex + 1], "next")
      : null;
    const firstSegment = copyGuideMedia(clone(source), firstGuideSource);
    firstSegment.id = source.id;
    firstSegment.start = 0;
    firstSegment.length = durationFrames;
    firstSegment.prompt = String(source.prompt || "");
    firstSegment.isEndFrame = false;
    firstSegment.guideRole = "first";
    firstSegment.guideSourceSegmentId = firstGuideSource.id;
    const lastSegment = lastGuideSource ? {
      ...clone(lastGuideSource),
      id: `${source.id}__next_as_last_frame`,
      start: 0,
      length: durationFrames,
      prompt: "",
      isEndFrame: true,
      boundaryGuideOnly: true,
      guideRole: "last",
      guideSourceSegmentId: lastGuideSource.id,
      sourceSegmentId: source.id
    } : null;
    const textSegments = clipTrack((timeline.segments || []).filter((item) => item.type === "text"), sourceStart, sourceEnd);
    const perSegGlobal = segmentSpecificGlobalPrompt(source, workspace, sourceIndex + 1, visualSources.length);
    const childTimeline = clone(timeline);
    childTimeline.global_prompt = perSegGlobal;
    childTimeline.retakeMode = false;
    childTimeline.normalStartFrame = 0;
    childTimeline.normalDurationFrames = durationFrames;
    childTimeline.segments = [
      firstSegment,
      ...(lastSegment ? [lastSegment] : []),
      ...textSegments
    ];
    childTimeline.motionSegments = clipTrack(timeline.motionSegments, sourceStart, sourceEnd);
    childTimeline.audioSegments = clipTrack(timeline.audioSegments, sourceStart, sourceEnd);
    const promptSegments = [firstSegment, ...textSegments]
      .slice()
      .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    const guideSegments = [firstSegment, ...(lastSegment ? [lastSegment] : [])];
    return {
      index: sourceIndex + 1,
      total: visualSources.length,
      queueIndex: queueIndex + 1,
      queueTotal: sources.length,
      sourceSegmentId: source.id,
      semanticReferenceFrameId: source.storyboardFrameId || null,
      sourceSegmentIndex: sourceIndex + 1,
      sourceSegmentTotal: visualSources.length,
      usePreviousAsFirstFrame,
      useNextAsLastFrame,
      firstFrameSourceSegmentId: firstGuideSource.id,
      lastFrameSourceSegmentId: lastGuideSource?.id || null,
      requestedFrames: sourceLength,
      generationFrames: durationFrames,
      lengthModel: LTX25_PREMIERE316_PROFILE.lengthModel,
      durationFrames,
      durationSeconds: durationFrames / fps,
      timeline: childTimeline,
      global_prompt: perSegGlobal,
      localPrompts: promptSegments.map((segment) => String(segment.prompt || "")).join(" | "),
      segmentLengths: promptSegments.map((segment) => String(Math.max(1, Math.round(Number(segment.length) || 1)))).join(","),
      guideStrength: guideSegments.map((segment) => Number.isFinite(Number(segment.guideStrength))
        ? Number(segment.guideStrength).toFixed(2)
        : String(workspace.settings.guideStrength || "1.00")).join(",")
    };
  });
}

function normalizeStagedSemanticReference(reference, index) {
  const declaredRole = String(reference?.declaredRole || reference?.role || "");
  const role = canonicalSemanticReferenceRole(reference?.role || declaredRole);
  const imageFile = String(reference?.imageFile || reference?.comfyFile || "").trim().replace(/\\/g, "/");
  const resolverReference = String(reference?.resolverReference || "").trim().replace(/\\/g, "/");
  if (!role) {
    throw new Error(
      `${LTX25_PREMIERE316_PROFILE.id} semantic reference ${reference?.id || index + 1} `
      + `has unsupported role ${declaredRole || "missing"}`
    );
  }
  if (!imageFile) {
    throw new Error(
      `${LTX25_PREMIERE316_PROFILE.id} semantic reference ${reference?.id || index + 1} `
      + `(${role}) was resolved but not staged into ComfyUI input`
    );
  }
  if (!resolverReference) {
    throw new Error(
      `${LTX25_PREMIERE316_PROFILE.id} semantic reference ${reference?.id || index + 1} `
      + `(${role}) has no staged resolver path`
    );
  }
  return {
    id: String(reference?.id || `semantic-reference-${index + 1}`),
    role,
    declaredRole: declaredRole || role,
    imageFile,
    resolverReference,
    required: reference?.required !== false,
    assetId: reference?.assetId || null,
    frameId: reference?.frameId || null,
    version: reference?.version ?? null,
    canonicalFile: reference?.canonicalFile || null,
    sha256: reference?.sha256 || null,
    bytes: Number(reference?.bytes) || null,
    order: Number(reference?.order) || index + 1
  };
}

export function premiere316SemanticReferencePayload(workspace, job = null) {
  const profile = premiere316ProfileForWorkspace(workspace);
  if (!profile) return null;
  const optionId = String(workspace?.premiere?.generateOptionId || workspace?.premiere?.generateOption?.id || "");
  const firstFrameI2v = optionId === "harrowing_aaa_i2v_segmented"
    || String(workspace?.premiere?.generationMode || "") === "i2v_segmented_first_frames";
  const selectedFrameId = job?.semanticReferenceFrameId || (firstFrameI2v
    ? workspace?.timeline?.segments?.find((segment) => segment?.id === workspace?.selectedSegmentId)?.storyboardFrameId || null
    : null);
  const candidates = Array.isArray(workspace?.premiere?.semanticReferences)
    ? workspace.premiere.semanticReferences
    : [];
  const scoped = firstFrameI2v
    ? (selectedFrameId ? candidates.filter((reference) => String(reference?.frameId || "") === String(selectedFrameId)) : [])
    : candidates.filter((reference) => !reference?.frameId || !selectedFrameId || String(reference.frameId) === String(selectedFrameId));
  const expectedCount = firstFrameI2v
    ? scoped.length
    : Number(workspace?.premiere?.expectedReferenceCount ?? workspace?.premiere?.referenceCount ?? 0);
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`${profile.id} has invalid expected semantic reference count ${String(expectedCount)}`);
  }
  const seen = new Set();
  const references = scoped
    .slice()
    .sort((left, right) => (Number(left?.order) || 0) - (Number(right?.order) || 0) || String(left?.id || "").localeCompare(String(right?.id || "")))
    .map(normalizeStagedSemanticReference)
    .filter((reference) => {
      const key = `${reference.id}|${reference.imageFile}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (expectedCount > profile.maxSemanticReferences) {
    throw new Error(`${profile.id} expects ${expectedCount} semantic references but supports ${profile.maxSemanticReferences}`);
  }
  if (references.length !== expectedCount) {
    throw new Error(
      `${profile.id} semantic reference injection is incomplete: expected ${expectedCount}, `
      + `staged ${references.length}${selectedFrameId ? ` for ${selectedFrameId}` : ""}`
    );
  }
  if (references.some((reference) => reference.required && !reference.imageFile)) {
    throw new Error(`${profile.id} has an unstaged required semantic reference`);
  }
  const assetRoot = String(workspace?.premiere?.semanticAssetRoot || "").trim().replace(/\\/g, "/");
  if (expectedCount > 0 && !assetRoot) {
    throw new Error(`${profile.id} has no staged semantic asset root`);
  }
  return {
    profile,
    expectedCount,
    references,
    assetRoot,
    roles: references.map((reference) => reference.role),
    selectedFrameId
  };
}

function profileTimeline(workspace, fields, job) {
  const semantic = premiere316SemanticReferencePayload(workspace, job);
  if (!semantic) return { timeline: fields.timeline, semantic: null };
  const requestedFrames = Math.max(1, Math.round(Number(job?.requestedFrames ?? fields.durationFrames) || 1));
  const generationFrames = ltxFrameCount(job?.generationFrames ?? requestedFrames);
  const fps = Math.max(1, Number(workspace.settings.frameRate) || 24);
  const layout = "adaptive";
  const timeline = clone(fields.timeline);
  timeline.generationProfile = {
    id: semantic.profile.id,
    lengthModel: semantic.profile.lengthModel,
    requestedFrames,
    generationFrames,
    editorialTrimFrames: Math.max(0, generationFrames - requestedFrames),
    fps
  };
  timeline.semanticReferences = semantic.references;
  timeline.semanticReferenceContract = {
    expectedCount: semantic.expectedCount,
    injectedCount: semantic.references.length,
    roles: semantic.roles,
    layout,
    conditioning: semantic.profile.semanticConditioning,
    adapter: semantic.profile.ingredientsAdapter,
    temporalGuidesRemainIndependent: true
  };
  return {
    timeline,
    semantic: {
      ...semantic,
      requestedFrames,
      generationFrames,
      fps,
      layout,
      prompt: [workspace.timeline?.global_prompt, fields.localPrompts]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("\n\n") || "Premiere316 storyboard semantic reference conditioning"
    }
  };
}

function isPromptLink(value, nodeId, outputSlot = null) {
  return Array.isArray(value)
    && value.length === 2
    && String(value[0]) === String(nodeId)
    && (outputSlot === null || Number(value[1]) === Number(outputSlot));
}

function nextPromptNodeId(prompt) {
  let candidate = Math.max(2000, ...Object.keys(prompt).map((id) => Number(id)).filter(Number.isFinite)) + 1;
  return () => {
    while (prompt[String(candidate)]) candidate += 1;
    return String(candidate++);
  };
}

function ensurePremiere316Node(prompt, preferredId, classType, allocate) {
  const preferred = prompt[String(preferredId)];
  const id = !preferred || preferred.class_type === classType ? String(preferredId) : allocate();
  const existing = prompt[id];
  if (!existing) {
    prompt[id] = {
      inputs: {},
      class_type: classType,
      _meta: { title: `${LTX25_PREMIERE316_PROFILE.id} · ${classType}`, premiere316Profile: true }
    };
  } else if (existing.class_type !== classType) {
    throw new Error(`${LTX25_PREMIERE316_PROFILE.id} node ${id} is ${existing.class_type}; expected ${classType}`);
  }
  prompt[id].inputs ||= {};
  return [id, prompt[id]];
}

function directorGuideEntries(prompt) {
  return Object.entries(prompt).filter(([, node]) => DIRECTOR_GUIDE_TYPES.has(node.class_type));
}

function lowDirectorGuideEntry(prompt, directorId) {
  return directorGuideEntries(prompt).find(([, node]) => (
    isPromptLink(node.inputs?.latent, directorId, 2)
    && isPromptLink(node.inputs?.guide_data, directorId, 4)
  )) || null;
}

function linkedConsumers(prompt, sourceId, outputSlots = null, excludedIds = new Set()) {
  const allowedSlots = outputSlots ? new Set(outputSlots.map(Number)) : null;
  const consumers = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    if (excludedIds.has(String(nodeId))) continue;
    for (const [inputName, value] of Object.entries(node.inputs || {})) {
      if (!isPromptLink(value, sourceId)) continue;
      const slot = Number(value[1]);
      if (!allowedSlots || allowedSlots.has(slot)) consumers.push({ nodeId, inputName, outputSlot: slot });
    }
  }
  return consumers;
}

function replacePromptLinks(prompt, sourceId, replacementId, outputSlots, excludedIds = new Set()) {
  const allowedSlots = new Set(outputSlots.map(Number));
  const replacements = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    if (excludedIds.has(String(nodeId))) continue;
    for (const [inputName, value] of Object.entries(node.inputs || {})) {
      if (!isPromptLink(value, sourceId) || !allowedSlots.has(Number(value[1]))) continue;
      node.inputs[inputName] = [String(replacementId), Number(value[1])];
      replacements.push({ nodeId, inputName, outputSlot: Number(value[1]) });
    }
  }
  return replacements;
}

function linkDependsOn(prompt, value, sourceId, outputSlot = null, visited = new Set()) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  if (isPromptLink(value, sourceId, outputSlot)) return true;
  const currentId = String(value[0]);
  const visitKey = `${currentId}:${Number(value[1])}`;
  if (visited.has(visitKey)) return false;
  visited.add(visitKey);
  const node = prompt[currentId];
  if (!node) return false;
  return Object.values(node.inputs || {}).some((input) => linkDependsOn(prompt, input, sourceId, outputSlot, visited));
}

function computedReferenceGrid(referenceCount) {
  if (!referenceCount) return "0x0";
  const columns = Math.max(1, Math.min(referenceCount, Math.ceil(Math.sqrt(referenceCount))));
  return `${columns}x${Math.ceil(referenceCount / columns)}`;
}

function temporalGuideState(prompt, directorId) {
  return directorGuideEntries(prompt).map(([nodeId, node]) => ({
    nodeId,
    classType: node.class_type,
    guideDataLink: clone(node.inputs?.guide_data),
    temporalGuideConnected: isPromptLink(node.inputs?.guide_data, directorId, 4),
    adapter: String(node.inputs?.ic_lora_name || "None"),
    adapterStrength: Number(node.inputs?.ic_lora_strength || 0),
    vanilla: String(node.inputs?.ic_lora_name || "None") === "None"
  }));
}

function bypassPremiere316IngredientsBranch(prompt, lowGuideId) {
  for (const [addId, addNode] of Object.entries(prompt)) {
    if (addNode.class_type !== "LTXAddVideoICLoRAGuide") continue;
    if (!isPromptLink(addNode.inputs?.positive, lowGuideId, 0)
      || !isPromptLink(addNode.inputs?.negative, lowGuideId, 1)
      || !isPromptLink(addNode.inputs?.latent, lowGuideId, 2)) continue;
    replacePromptLinks(prompt, addId, lowGuideId, [0, 1, 2], new Set([String(addId)]));
  }
  const ingredientsLoaders = Object.entries(prompt).filter(([, node]) => (
    node.class_type === "LTXICLoRALoaderModelOnly"
    && node.inputs?.lora_name === LTX25_PREMIERE316_PROFILE.ingredientsAdapter
  ));
  for (const [loaderId, loader] of ingredientsLoaders) {
    const baseModel = loader.inputs?.model;
    if (!Array.isArray(baseModel) || baseModel.length !== 2 || isPromptLink(baseModel, loaderId)) {
      throw new Error(`${LTX25_PREMIERE316_PROFILE.id} cannot bypass Ingredients loader ${loaderId}: its base model link is invalid`);
    }
    for (const [nodeId, node] of Object.entries(prompt)) {
      if (String(nodeId) === String(loaderId)) continue;
      for (const [inputName, value] of Object.entries(node.inputs || {})) {
        if (isPromptLink(value, loaderId, 0)) node.inputs[inputName] = clone(baseModel);
      }
    }
  }
}

export function applyPremiere316ReferenceConditioning(prompt, directorId, semantic) {
  if (!semantic) return null;
  const director = prompt[String(directorId)];
  if (!director) throw new Error(`${semantic.profile.id} Director node ${directorId} is missing`);
  const lowGuideEntry = lowDirectorGuideEntry(prompt, directorId);
  if (!lowGuideEntry) {
    throw new Error(
      `${semantic.profile.id} cannot preserve temporal guides: no Director Guide consumes `
      + `${directorId}.video_latent and ${directorId}.guide_data`
    );
  }
  const [lowGuideId, lowGuide] = lowGuideEntry;
  for (const [, guide] of directorGuideEntries(prompt)) {
    guide.inputs.ic_lora_name = "None";
    guide.inputs.ic_lora_strength = 0;
  }
  const allocate = nextPromptNodeId(prompt);
  const [lengthId, lengthNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.length,
    "LTX2.5_Premiere316",
    allocate
  );
  lengthNode.inputs = {
    length_source: "frames",
    requested_frames: semantic.requestedFrames,
    requested_duration_seconds: semantic.requestedFrames / semantic.fps,
    frame_rate: semantic.fps
  };
  director.inputs.end_frame = [lengthId, 0];
  director.inputs.duration_frames = [lengthId, 0];
  director.inputs.end_second = [lengthId, 3];
  director.inputs.duration_seconds = [lengthId, 3];
  if (semantic.expectedCount === 0) {
    bypassPremiere316IngredientsBranch(prompt, lowGuideId);
    return premiere316ReferenceDiagnostics(prompt, directorId, semantic);
  }

  const [resolverId, resolverNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.resolver,
    "Premiere316AssetResolver",
    allocate
  );
  const [sheetId, sheetNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.sheet,
    "Premiere316ReferenceSheetBuilder",
    allocate
  );
  const [repeatId, repeatNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.repeat,
    "RepeatImageBatch",
    allocate
  );
  const [loaderId, loaderNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.loader,
    "LTXICLoRALoaderModelOnly",
    allocate
  );
  const [addGuideId, addGuideNode] = ensurePremiere316Node(
    prompt,
    PREMIERE316_NODE_IDS.addGuide,
    "LTXAddVideoICLoRAGuide",
    allocate
  );

  let baseModel = director.inputs?.model;
  if (isPromptLink(baseModel, loaderId, 0)) baseModel = loaderNode.inputs?.model;
  if (!Array.isArray(baseModel) || baseModel.length !== 2 || isPromptLink(baseModel, loaderId)) {
    throw new Error(`${semantic.profile.id} cannot patch Ingredients IC-LoRA because the Director base model link is invalid`);
  }
  const selectors = semantic.references.map((reference) => reference.resolverReference);
  resolverNode.inputs = {
    prompt: "",
    asset_root: semantic.assetRoot,
    max_references: semantic.profile.maxSemanticReferences,
    strict_mode: true,
    refresh_index: false,
    index_filename: "asset_index.json",
    explicit_references: selectors.join("\n")
  };
  sheetNode.inputs = {
    reference_set: [resolverId, 1],
    width: 768,
    height: 768,
    frame_count: [lengthId, 1]
  };
  repeatNode.inputs = {
    image: [sheetId, 0],
    amount: [lengthId, 1]
  };
  loaderNode.inputs = {
    model: clone(baseModel),
    lora_name: semantic.profile.ingredientsAdapter,
    strength_model: 1
  };
  addGuideNode.inputs = {
    positive: [lowGuideId, 0],
    negative: [lowGuideId, 1],
    vae: clone(lowGuide.inputs?.vae),
    latent: [lowGuideId, 2],
    image: [repeatId, 0],
    frame_idx: 0,
    strength: 1,
    latent_downscale_factor: [loaderId, 1],
    crop: "center",
    use_tiled_encode: semantic.generationFrames > 121,
    tile_size: 256,
    tile_overlap: 64
  };

  director.inputs.model = [loaderId, 0];
  replacePromptLinks(prompt, lowGuideId, addGuideId, [0, 1, 2], new Set([addGuideId]));
  return premiere316ReferenceDiagnostics(prompt, directorId, semantic);
}

export function premiere316ReferenceDiagnostics(prompt, directorId, semantic) {
  if (!semantic) return null;
  const issues = [];
  const director = prompt[String(directorId)];
  if (!director) issues.push(`Director node ${directorId} is missing`);
  if (director?.class_type !== "BlokeyLtxDirector") {
    issues.push(`Director node ${directorId} must be BlokeyLtxDirector for ${semantic.profile.id}`);
  }
  const temporalGuides = temporalGuideState(prompt, directorId);
  if (!temporalGuides.length) issues.push("no temporal Director Guide nodes are present");
  for (const guide of temporalGuides) {
    if (!guide.temporalGuideConnected) issues.push(`temporal guide ${guide.nodeId} is disconnected from Director guide_data`);
    if (!guide.vanilla || guide.adapterStrength !== 0) {
      issues.push(`temporal guide ${guide.nodeId} must keep IC-LoRA disabled so temporal and semantic references remain separate`);
    }
  }
  const lowGuideEntry = lowDirectorGuideEntry(prompt, directorId);
  if (!lowGuideEntry) issues.push("low-stage temporal Director Guide is missing");
  const lowGuideId = lowGuideEntry?.[0] || null;
  const profileLengthId = Array.isArray(director?.inputs?.duration_frames)
    ? String(director.inputs.duration_frames[0])
    : null;
  const profileLength = profileLengthId ? prompt[profileLengthId] : null;
  if (profileLength?.class_type !== "LTX2.5_Premiere316"
    || !isPromptLink(director?.inputs?.duration_frames, profileLengthId, 0)
    || !isPromptLink(director?.inputs?.end_frame, profileLengthId, 0)
    || !isPromptLink(director?.inputs?.duration_seconds, profileLengthId, 3)) {
    issues.push("Director editorial duration is not driven by LTX2.5_Premiere316 editorial outputs");
  }
  if (Number(profileLength?.inputs?.requested_frames) !== semantic.requestedFrames
    || Number(profileLength?.inputs?.frame_rate) !== semantic.fps) {
    issues.push("LTX2.5_Premiere316 requested frame or frame-rate inputs disagree with the compiled profile");
  }

  const base = {
    profileId: semantic.profile.id,
    lengthModel: semantic.profile.lengthModel,
    requestedFrames: semantic.requestedFrames,
    generationFrames: semantic.generationFrames,
    editorialTrimFrames: Math.max(0, semantic.generationFrames - semantic.requestedFrames),
    trimOwner: "server-finalizer",
    temporalGuidesPreserved: temporalGuides.length > 0 && temporalGuides.every((guide) => guide.temporalGuideConnected && guide.vanilla),
    temporalGuides
  };
  if (semantic.expectedCount === 0) {
    const ingredientsLoaderIds = Object.entries(prompt)
      .filter(([, node]) => (
        node.class_type === "LTXICLoRALoaderModelOnly"
        && node.inputs?.lora_name === semantic.profile.ingredientsAdapter
      ))
      .map(([nodeId]) => nodeId);
    const ingredientsGuideIds = Object.entries(prompt)
      .filter(([, node]) => node.class_type === "LTXAddVideoICLoRAGuide")
      .map(([nodeId]) => nodeId);
    const activeStages = Object.entries(prompt)
      .filter(([, node]) => node.class_type === "CFGGuider" || /Sampler/i.test(node.class_type || ""));
    const guideModelDependencies = temporalGuides.map((guide) => ({
      nodeId: guide.nodeId,
      loaderNodeIds: ingredientsLoaderIds.filter((loaderId) => (
        linkDependsOn(prompt, prompt[guide.nodeId]?.inputs?.model, loaderId, 0)
      ))
    }));
    for (const guide of guideModelDependencies) {
      if (guide.loaderNodeIds.length) {
        issues.push(`zero-reference temporal guide ${guide.nodeId} still depends on Ingredients loader ${guide.loaderNodeIds.join(", ")}`);
      }
    }
    const activeDependencies = activeStages.map(([nodeId, node]) => ({
      nodeId,
      classType: node.class_type,
      loaderNodeIds: ingredientsLoaderIds.filter((loaderId) => (
        Object.values(node.inputs || {}).some((input) => linkDependsOn(prompt, input, loaderId))
      )),
      addGuideNodeIds: ingredientsGuideIds.filter((addGuideId) => (
        Object.values(node.inputs || {}).some((input) => linkDependsOn(prompt, input, addGuideId))
      ))
    }));
    for (const stage of activeDependencies) {
      if (stage.loaderNodeIds.length || stage.addGuideNodeIds.length) {
        issues.push(
          `zero-reference ${stage.classType} ${stage.nodeId} still depends on Ingredients nodes `
          + [...stage.loaderNodeIds, ...stage.addGuideNodeIds].join(", ")
        );
      }
    }
    const diagnostics = {
      ...base,
      semantic: {
        expectedCount: 0,
        stagedCount: 0,
        injectedCount: 0,
        roles: [],
        references: [],
        adapter: null,
        layout: "adaptive",
        computedLayout: "0x0",
        branchActive: false,
        consumed: issues.length === 0,
        injected: false,
        active: false,
        status: issues.length ? "invalid" : "not-required",
        bypassedIngredients: {
          loaderNodeIds: ingredientsLoaderIds,
          addGuideNodeIds: ingredientsGuideIds,
          guideModelDependencies,
          activeDependencies
        },
        issues
      },
      nodeIds: { length: profileLengthId, lowGuide: lowGuideId }
    };
    if (issues.length) throw new Error(`${semantic.profile.id} preflight failed: ${issues.join("; ")}`);
    return diagnostics;
  }

  if (semantic.expectedCount !== semantic.references.length) {
    issues.push(`expected ${semantic.expectedCount} semantic references but staged ${semantic.references.length}`);
  }
  const addEntry = lowGuideId ? Object.entries(prompt).find(([, node]) => (
    node.class_type === "LTXAddVideoICLoRAGuide"
    && isPromptLink(node.inputs?.positive, lowGuideId, 0)
    && isPromptLink(node.inputs?.negative, lowGuideId, 1)
    && isPromptLink(node.inputs?.latent, lowGuideId, 2)
  )) : null;
  if (!addEntry) issues.push("dedicated LTXAddVideoICLoRAGuide does not consume the low-stage temporal conditioning and latent");
  const [addGuideId, addGuide] = addEntry || [null, null];
  const repeatId = Array.isArray(addGuide?.inputs?.image) ? String(addGuide.inputs.image[0]) : null;
  const repeat = repeatId ? prompt[repeatId] : null;
  if (repeat?.class_type !== "RepeatImageBatch" || !isPromptLink(addGuide?.inputs?.image, repeatId, 0)) {
    issues.push("Ingredients guide image is not supplied by RepeatImageBatch");
  }
  const sheetId = Array.isArray(repeat?.inputs?.image) ? String(repeat.inputs.image[0]) : null;
  const sheet = sheetId ? prompt[sheetId] : null;
  if (sheet?.class_type !== "Premiere316ReferenceSheetBuilder" || !isPromptLink(repeat?.inputs?.image, sheetId, 0)) {
    issues.push("RepeatImageBatch is not supplied by Premiere316ReferenceSheetBuilder.reference_sheet");
  }
  const resolverId = Array.isArray(sheet?.inputs?.reference_set) ? String(sheet.inputs.reference_set[0]) : null;
  const resolver = resolverId ? prompt[resolverId] : null;
  if (resolver?.class_type !== "Premiere316AssetResolver" || !isPromptLink(sheet?.inputs?.reference_set, resolverId, 1)) {
    issues.push("reference sheet is not supplied by Premiere316AssetResolver.reference_set");
  }
  const lengthId = Array.isArray(repeat?.inputs?.amount) ? String(repeat.inputs.amount[0]) : null;
  const length = lengthId ? prompt[lengthId] : null;
  if (length?.class_type !== "LTX2.5_Premiere316" || !isPromptLink(repeat?.inputs?.amount, lengthId, 1)) {
    issues.push("RepeatImageBatch amount is not driven by LTX2.5_Premiere316.generation_frames");
  }
  if (lengthId !== profileLengthId) issues.push("reference branch generation length and Director editorial length use different profile nodes");
  if (!isPromptLink(sheet?.inputs?.frame_count, lengthId, 1)) {
    issues.push("reference sheet frame_count is not driven by generation_frames");
  }
  if (Number(sheet?.inputs?.width) !== 768 || Number(sheet?.inputs?.height) !== 768) {
    issues.push("reference sheet must use the 768x768 adaptive composite canvas");
  }

  const loaderId = Array.isArray(addGuide?.inputs?.latent_downscale_factor)
    ? String(addGuide.inputs.latent_downscale_factor[0])
    : null;
  const loader = loaderId ? prompt[loaderId] : null;
  if (loader?.class_type !== "LTXICLoRALoaderModelOnly"
    || !isPromptLink(addGuide?.inputs?.latent_downscale_factor, loaderId, 1)) {
    issues.push("Ingredients guide does not consume LTXICLoRALoaderModelOnly.latent_downscale_factor");
  }
  if (!isPromptLink(director?.inputs?.model, loaderId, 0)) {
    issues.push("Director model is not patched by LTXICLoRALoaderModelOnly");
  }
  if (loader && (loader.inputs?.lora_name !== semantic.profile.ingredientsAdapter || Number(loader.inputs?.strength_model) !== 1)) {
    issues.push("Ingredients loader adapter or strength does not match the declared profile");
  }
  if (!addGuide || Number(addGuide.inputs?.strength) !== 1 || Number(addGuide.inputs?.frame_idx) !== 0) {
    issues.push("Ingredients composite guide is not active at full strength from frame zero");
  }

  const expectedSelectors = semantic.references.map((reference) => reference.resolverReference);
  const actualSelectors = String(resolver?.inputs?.explicit_references || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (resolver?.inputs?.prompt !== "") issues.push("AssetResolver.prompt must be empty so only declared explicit references can resolve");
  if (resolver?.inputs?.asset_root !== semantic.assetRoot) issues.push("AssetResolver.asset_root does not match the staged semantic root");
  if (Number(resolver?.inputs?.max_references) !== semantic.profile.maxSemanticReferences) {
    issues.push(`AssetResolver.max_references must be ${semantic.profile.maxSemanticReferences}`);
  }
  if (resolver?.inputs?.strict_mode !== true) issues.push("AssetResolver.strict_mode must be true");
  if (actualSelectors.length !== expectedSelectors.length
    || actualSelectors.some((selector, index) => selector !== expectedSelectors[index])) {
    issues.push("AssetResolver explicit reference selectors do not exactly match staged role/order declarations");
  }

  const bypasses = lowGuideId && addGuideId
    ? linkedConsumers(prompt, lowGuideId, [0, 1, 2], new Set([String(addGuideId)]))
    : [];
  if (bypasses.length) {
    issues.push(`low-stage conditioning bypasses the Ingredients branch at ${bypasses.map((item) => `${item.nodeId}.${item.inputName}`).join(", ")}`);
  }
  const addConsumers = addGuideId ? linkedConsumers(prompt, addGuideId, [0, 1, 2]) : [];
  for (const slot of [0, 1, 2]) {
    if (!addConsumers.some((consumer) => consumer.outputSlot === slot)) {
      issues.push(`Ingredients output slot ${slot} has no downstream consumer`);
    }
  }
  const cfgStages = Object.entries(prompt)
    .filter(([, node]) => node.class_type === "CFGGuider")
    .filter(([, node]) => (
      isPromptLink(node.inputs?.positive, addGuideId, 0)
      || isPromptLink(node.inputs?.negative, addGuideId, 1)
    ))
    .map(([nodeId, node]) => {
      const patchedModel = Boolean(loaderId) && linkDependsOn(prompt, node.inputs?.model, loaderId, 0);
      const samplerConsumers = linkedConsumers(prompt, nodeId).filter((consumer) => /Sampler/i.test(prompt[consumer.nodeId]?.class_type || ""));
      if (!patchedModel) issues.push(`CFGGuider ${nodeId} does not consume the IC-LoRA-patched model`);
      if (!samplerConsumers.length) issues.push(`CFGGuider ${nodeId} has no downstream sampler consumer`);
      return { nodeId, patchedModel, samplerNodeIds: samplerConsumers.map((consumer) => consumer.nodeId) };
    });
  if (!cfgStages.length) issues.push("no downstream CFGGuider consumes the Ingredients conditioning");

  const highGuides = temporalGuides.filter((guide) => guide.nodeId !== lowGuideId).map((guide) => {
    const node = prompt[guide.nodeId];
    const cfgConsumers = Object.entries(prompt)
      .filter(([, candidate]) => candidate.class_type === "CFGGuider")
      .filter(([, candidate]) => (
        linkDependsOn(prompt, candidate.inputs?.positive, guide.nodeId)
        || linkDependsOn(prompt, candidate.inputs?.negative, guide.nodeId)
      ))
      .map(([nodeId, candidate]) => ({
        nodeId,
        patchedModel: Boolean(loaderId) && linkDependsOn(prompt, candidate.inputs?.model, loaderId, 0),
        samplerNodeIds: linkedConsumers(prompt, nodeId)
          .filter((consumer) => /Sampler/i.test(prompt[consumer.nodeId]?.class_type || ""))
          .map((consumer) => consumer.nodeId)
      }));
    return {
      nodeId: guide.nodeId,
      latentRefinesConditionedLowStage: linkDependsOn(prompt, node.inputs?.latent, addGuideId, 2),
      conditioningMetadataMode: "cropped-temporal-conditioning; Ingredients influence is retained through the sampled low-stage latent",
      cfgConsumers
    };
  });
  for (const stage of highGuides) {
    if (!stage.latentRefinesConditionedLowStage) issues.push(`high-stage temporal guide ${stage.nodeId} does not refine the conditioned low-stage latent`);
    if (!stage.cfgConsumers.length) issues.push(`high-stage temporal guide ${stage.nodeId} has no CFGGuider consumer`);
    for (const cfg of stage.cfgConsumers) {
      if (!cfg.patchedModel) issues.push(`high-stage CFGGuider ${cfg.nodeId} does not consume the IC-LoRA-patched model`);
      if (!cfg.samplerNodeIds.length) issues.push(`high-stage CFGGuider ${cfg.nodeId} has no sampler consumer`);
    }
  }

  const consumed = issues.length === 0;
  const diagnostics = {
    ...base,
    nodeIds: { length: lengthId, resolver: resolverId, sheet: sheetId, repeat: repeatId, loader: loaderId, addGuide: addGuideId, lowGuide: lowGuideId },
    semantic: {
      expectedCount: semantic.expectedCount,
      stagedCount: semantic.references.length,
      injectedCount: consumed ? semantic.references.length : 0,
      roles: semantic.roles,
      references: semantic.references.map((reference) => ({
        id: reference.id,
        role: reference.role,
        declaredRole: reference.declaredRole,
        imageFile: reference.imageFile,
        resolverReference: reference.resolverReference,
        required: reference.required,
        canonicalFile: reference.canonicalFile,
        sha256: reference.sha256,
        bytes: reference.bytes,
        order: reference.order
      })),
      adapter: semantic.profile.ingredientsAdapter,
      layout: "adaptive",
      computedLayout: computedReferenceGrid(semantic.references.length),
      assetRoot: semantic.assetRoot,
      explicitReferences: actualSelectors,
      branchActive: consumed,
      consumed,
      injected: consumed,
      active: consumed,
      status: consumed ? "compiler-conditioned" : "invalid",
      cfgStages,
      highStageMode: highGuides.length ? "latent-refinement-from-conditioned-low-stage" : "single-stage",
      highGuides,
      issues
    }
  };
  if (!consumed) {
    throw new Error(
      `${semantic.profile.id} semantic reference preflight failed `
      + `(expected ${semantic.expectedCount}, staged ${semantic.references.length}, injected 0): ${issues.join("; ")}`
    );
  }
  return diagnostics;
}

function deriveFullPromptFields(workspace) {
  const segments = (workspace.timeline.segments || []).slice()
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  const media = segments.filter((segment) => segment.type !== "text");
  return {
    localPrompts: segments.map((segment) => String(segment.prompt || "")).join(" | "),
    segmentLengths: segments.map((segment) => Math.max(1, Math.round(Number(segment.length) || 1))).join(","),
    guideStrength: media.map((segment) => Number.isFinite(Number(segment.guideStrength))
      ? Number(segment.guideStrength).toFixed(2)
      : String(workspace.settings.guideStrength || "1.00")).join(",")
  };
}

export function patchPrompt(apiPrompt, workspace, job = null) {
  applyHarrowingGenLock(workspace);
  const prompt = clone(apiPrompt);
  const directorEntry = Object.entries(prompt).find(([, node]) => DIRECTOR_TYPES.has(node.class_type));
  if (!directorEntry) throw new Error("Compiled prompt is missing LTX Director.");
  const [directorId, director] = directorEntry;
  const resolutionEntry = Object.entries(prompt).find(([, node]) => node.class_type === "LTX25ResolutionPlan");
  const finalWidth = Math.max(32, Math.round(Number(workspace.settings.customWidth) || 1128));
  const finalHeight = Math.max(32, Math.round(Number(workspace.settings.customHeight) || 480));
  const fps = Math.max(1, Number(workspace.settings.frameRate) || 24);
  const fullDuration = timelineEnd(workspace.timeline);
  const fields = job || { ...deriveFullPromptFields(workspace), durationFrames: fullDuration, durationSeconds: fullDuration / fps, timeline: workspace.timeline };
  const profiled = profileTimeline(workspace, fields, job);
  director.inputs = {
    ...director.inputs,
    start_second: 0,
    end_second: fields.durationSeconds,
    duration_seconds: fields.durationSeconds,
    start_frame: 0,
    end_frame: fields.durationFrames,
    duration_frames: fields.durationFrames,
    timeline_data: JSON.stringify(profiled.timeline),
    global_prompt: String(fields.global_prompt || workspace.timeline.global_prompt || ""),
    local_prompts: fields.localPrompts,
    segment_lengths: fields.segmentLengths,
    guide_strength: fields.guideStrength,
    use_custom_audio: Boolean(workspace.settings.useCustomAudio),
    use_custom_motion: Boolean(workspace.settings.useCustomMotion),
    inpaint_audio: Boolean(workspace.settings.inpaintAudio),
    frame_rate: fps,
    custom_width: resolutionEntry ? [String(resolutionEntry[0]), 2] : finalWidth,
    custom_height: resolutionEntry ? [String(resolutionEntry[0]), 3] : finalHeight,
    resize_method: workspace.settings.resizeMethod,
    divisible_by: Number(workspace.settings.divisibleBy) || 32,
    img_compression: Number(workspace.settings.imageCompression) || 18,
    override_audio: Boolean(workspace.settings.overrideAudio)
  };

  if (resolutionEntry) {
    const [resolutionId, resolution] = resolutionEntry;
    resolution.inputs.final_width = finalWidth;
    resolution.inputs.final_height = finalHeight;
    director.inputs.custom_width = [String(resolutionId), 2];
    director.inputs.custom_height = [String(resolutionId), 3];
  }

  for (const node of Object.values(prompt)) {
    if (node.class_type === "CLIPTextEncode" && !node.inputs?.text?.trim()) {
      node.inputs.text = workspace.settings.negativePrompt;
    }
    if (node.class_type === "VHS_VideoCombine" || node.class_type === "SaveVideo") {
      const suffix = job ? `/segment_${String(job.index).padStart(3, "0")}` : "/timeline";
      node.inputs.filename_prefix = `${String(workspace.settings.outputPrefix || "director_webapp/ltx25_director").replace(/[\\/]+$/, "")}${suffix}`;
      const imageLink = node.inputs?.images;
      const finalScale = Array.isArray(imageLink) ? prompt[String(imageLink[0])] : null;
      if (finalScale?.class_type === "ImageScale") {
        finalScale.inputs.width = resolutionEntry ? [String(resolutionEntry[0]), 0] : finalWidth;
        finalScale.inputs.height = resolutionEntry ? [String(resolutionEntry[0]), 1] : finalHeight;
      }
    }
  }
  if (prompt["26"]?.class_type === "CLIPTextEncode") prompt["26"].inputs.text = workspace.settings.negativePrompt;

  const referenceConditioning = applyPremiere316ReferenceConditioning(prompt, directorId, profiled.semantic);
  return { prompt, directorId, referenceConditioning };
}

export function validatePrompt(prompt, objectInfo) {
  const errors = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    const info = objectInfo[node.class_type];
    if (!info) {
      errors.push(`Missing node class ${node.class_type} (${nodeId})`);
      continue;
    }
    for (const name of Object.keys(info.input?.required || {})) {
      if (node.inputs?.[name] === undefined || node.inputs?.[name] === null) {
        errors.push(`${nodeId} ${node.class_type}.${name} is required`);
      }
    }
    for (const [name, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && !prompt[String(value[0])]) {
        errors.push(`${nodeId} ${node.class_type}.${name} references missing node ${value[0]}`);
        continue;
      }
      const schema = info.input?.required?.[name] || info.input?.optional?.[name];
      const options = Array.isArray(schema?.[0]) ? schema[0] : null;
      if (options && !Array.isArray(value) && !options.includes(value)) {
        errors.push(`${nodeId} ${node.class_type}.${name} selects unavailable value ${String(value)}`);
      }
    }
  }
  return errors;
}

export function timelineDuration(timeline) {
  return timelineEnd(timeline);
}
