import crypto from "crypto";

const DIRECTOR_TYPES = new Set(["LTXDirector", "BlokeyLtxDirector"]);

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
  next.settings.frameRate = Math.max(1, Math.min(120, Number(next.settings.frameRate) || 24));
  next.settings.customWidth = Math.max(32, Math.min(8192, Math.round(Number(next.settings.customWidth) || 1128)));
  next.settings.customHeight = Math.max(32, Math.min(8192, Math.round(Number(next.settings.customHeight) || 480)));
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

export function ltxFrameCount(requestedFrames) {
  const requested = Math.max(1, Math.round(Number(requestedFrames) || 1));
  return Math.ceil((requested - 1) / 8) * 8 + 1;
}

export function buildSegmentJobs(workspace, selectedId = null) {
  const timeline = workspace.timeline;
  const fps = Math.max(1, Number(workspace.settings.frameRate) || 24);
  let sources = (timeline.segments || [])
    .filter((segment) => [undefined, "image", "video"].includes(segment.type))
    .filter((segment) => !segment.missingGuide)
    .filter((segment) => segment.imageFile || segment.videoFile || segment.imageB64)
    .filter((segment) => (Number(segment.length) || 0) > 0)
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  if (selectedId) sources = sources.filter((segment) => String(segment.id) === String(selectedId));
  return sources.map((source, index) => {
    const sourceStart = Number(source.start) || 0;
    const sourceLength = Math.max(1, Math.round(Number(source.length) || 1));
    const durationFrames = ltxFrameCount(sourceLength);
    const sourceEnd = sourceStart + sourceLength;
    const segment = clone(source);
    segment.start = 0;
    segment.length = durationFrames;
    const childTimeline = clone(timeline);
    childTimeline.retakeMode = false;
    childTimeline.normalStartFrame = 0;
    childTimeline.normalDurationFrames = durationFrames;
    childTimeline.segments = [
      segment,
      ...clipTrack((timeline.segments || []).filter((item) => item.type === "text"), sourceStart, sourceEnd)
    ];
    childTimeline.motionSegments = clipTrack(timeline.motionSegments, sourceStart, sourceEnd);
    childTimeline.audioSegments = clipTrack(timeline.audioSegments, sourceStart, sourceEnd);
    const promptSegments = childTimeline.segments.slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    return {
      index: index + 1,
      total: sources.length,
      sourceSegmentId: source.id,
      requestedFrames: sourceLength,
      generationFrames: durationFrames,
      durationFrames,
      durationSeconds: durationFrames / fps,
      timeline: childTimeline,
      localPrompts: promptSegments.map((segment) => String(segment.prompt || "")).join(" | "),
      segmentLengths: promptSegments.map((segment) => String(Math.max(1, Math.round(Number(segment.length) || 1)))).join(","),
      guideStrength: Number.isFinite(Number(source.guideStrength))
        ? Number(source.guideStrength).toFixed(2)
        : String(workspace.settings.guideStrength || "1.00")
    };
  });
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
  director.inputs = {
    ...director.inputs,
    start_second: 0,
    end_second: fields.durationSeconds,
    duration_seconds: fields.durationSeconds,
    start_frame: 0,
    end_frame: fields.durationFrames,
    duration_frames: fields.durationFrames,
    timeline_data: JSON.stringify(fields.timeline),
    global_prompt: String(workspace.timeline.global_prompt || ""),
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
  return { prompt, directorId };
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
