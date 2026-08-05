// Compile the Premiere316 timeline into the fixed LTX Director workflow.
import crypto from "crypto";
import { loadWorkflowTemplate, graphToApi, getObjectInfo } from "./comfy.js";

export const WORKFLOW_UI = "ltx-director-i2v.ui.json";
export const LTX_DIRECTOR_ID = "46";
export const DEFAULT_FPS = 24;
export const DURATION_MIN = 2;
export const DURATION_MAX = 30;
export const DEFAULT_DURATION = 6;
export const DEFAULT_SEGMENT_SEC = 2;
export const INGREDIENTS_LORA = "LTX\\2.3\\Official\\IC-LoRA\\Ingredients\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";
export const DEFAULT_INGREDIENTS = Object.freeze({
  enabled: true,
  modelStrength: 0.8,
  guideStrength: 0.75,
  attentionStrength: 0.7,
  maxImages: 3
});

export function clampDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n)) return DEFAULT_DURATION;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(n * 1000) / 1000));
}

export function framesOf(sec, fps = DEFAULT_FPS) {
  const seconds = Number(sec);
  const rate = Number(fps || DEFAULT_FPS);
  if (!Number.isFinite(seconds) || !Number.isFinite(rate)) return 0;
  return Math.max(0, Math.round(seconds * rate));
}

export function secondsOf(frames, fps = DEFAULT_FPS) {
  const count = Number(frames);
  const rate = Number(fps || DEFAULT_FPS);
  if (!Number.isFinite(count) || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, count / rate);
}

export function ltxFrameCount(requestedFrames) {
  const n = Math.max(1, Math.round(Number(requestedFrames) || 1));
  if (n <= 1) return 1;
  return Math.ceil((n - 1) / 8) * 8 + 1;
}

export function normalizeSegments(
  segments,
  durationSec,
  segmentSec = DEFAULT_SEGMENT_SEC,
  fps = DEFAULT_FPS
) {
  const dur = clampDuration(durationSec);
  const totalFrames = Math.max(1, framesOf(dur, fps));
  let list = (segments || [])
    .filter((s) => s && (s.prompt != null || s.startSec != null || s.startFrame != null))
    .map((s) => {
      const startFrame = s.startFrame != null
        ? Math.round(+s.startFrame)
        : Math.round((+s.startSec || 0) * fps);
      const endFrame = s.endFrame != null
        ? Math.round(+s.endFrame)
        : Math.round((+s.endSec || 0) * fps);
      return {
        id: s.id || crypto.randomUUID(),
        startFrame: Math.max(0, startFrame),
        endFrame: Math.min(totalFrames, endFrame),
        prompt: String(s.prompt || ""),
        dirty: s.dirty !== false
      };
    })
    .filter((s) => s.endFrame > s.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);

  if (!list.length) {
    const step = Math.max(1, framesOf(segmentSec, fps));
    for (let start = 0; start < totalFrames; start += step) {
      list.push({
        id: crypto.randomUUID(),
        startFrame: start,
        endFrame: Math.min(totalFrames, start + step),
        prompt: "",
        dirty: true
      });
    }
  } else {
    list[0].startFrame = 0;
    for (let i = 1; i < list.length; i++) {
      list[i].startFrame = list[i - 1].endFrame;
      if (list[i].endFrame <= list[i].startFrame) list[i].endFrame = list[i].startFrame + 1;
    }
    list[list.length - 1].endFrame = totalFrames;
  }

  return list.map((s) => ({
    ...s,
    startSec: s.startFrame / fps,
    endSec: s.endFrame / fps
  }));
}

export function groupContiguousSegments(allSegments, selectedIds) {
  const selected = new Set(selectedIds || []);
  const indexed = (allSegments || [])
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => selected.has(segment.id));
  if (!indexed.length) return [];
  const groups = [];
  let current = [indexed[0]];
  for (let i = 1; i < indexed.length; i++) {
    if (indexed[i].index === indexed[i - 1].index + 1) current.push(indexed[i]);
    else {
      groups.push(current);
      current = [indexed[i]];
    }
  }
  groups.push(current);
  return groups.map((group) => ({
    segmentIds: group.map((x) => x.segment.id),
    startFrame: group[0].segment.startFrame,
    endFrame: group[group.length - 1].segment.endFrame
  }));
}

function viewUrl(file) {
  const base = file.split("/").pop();
  const sub = file.includes("/") ? file.split("/").slice(0, -1).join("/") : "";
  return `/api/view?filename=${encodeURIComponent(base)}&type=input&subfolder=${encodeURIComponent(sub)}`;
}

export function compileRange({
  segments = [],
  guides = [],
  rangeStartFrame = 0,
  rangeEndFrame,
  fps = DEFAULT_FPS,
  globalPrompt = "",
  firstFrameFile = null,
  endFrameFile = null
}) {
  const inferredTotalFrames = Math.max(
    Number(rangeEndFrame) || 0,
    ...(segments || []).map((s) =>
      s.endFrame != null ? Number(s.endFrame) || 0 : Math.round((Number(s.endSec) || 0) * fps)
    ),
    framesOf(DEFAULT_DURATION, fps)
  );
  const normalized = normalizeSegments(
    segments,
    inferredTotalFrames / fps,
    DEFAULT_SEGMENT_SEC,
    fps
  );
  const total = normalized[normalized.length - 1]?.endFrame || framesOf(DEFAULT_DURATION, fps);
  const start = Math.max(0, Math.min(total - 1, Math.round(rangeStartFrame || 0)));
  const end = Math.max(start + 1, Math.min(total, Math.round(rangeEndFrame || total)));
  const requestedFrames = end - start;
  const generationFrames = ltxFrameCount(requestedFrames);

  const localSegments = normalized
    .filter((s) => s.endFrame > start && s.startFrame < end)
    .map((s) => ({
      ...s,
      startFrame: Math.max(s.startFrame, start) - start,
      endFrame: Math.min(s.endFrame, end) - start,
      startSec: (Math.max(s.startFrame, start) - start) / fps,
      endSec: (Math.min(s.endFrame, end) - start) / fps
    }));

  if (!localSegments.length) {
    localSegments.push({
      id: crypto.randomUUID(),
      startFrame: 0,
      endFrame: requestedFrames,
      startSec: 0,
      endSec: requestedFrames / fps,
      prompt: globalPrompt || "",
      dirty: true
    });
  }
  localSegments[0].startFrame = 0;
  localSegments[0].startSec = 0;
  localSegments[localSegments.length - 1].endFrame = generationFrames;
  localSegments[localSegments.length - 1].endSec = generationFrames / fps;

  const sourceGuides = [...(guides || [])];
  if (firstFrameFile && !sourceGuides.some((g) => g.role === "first" || Number(g.frame) === 0)) {
    sourceGuides.push({ role: "first", frame: 0, file: firstFrameFile, comfyFile: firstFrameFile, strength: 1 });
  }
  if (endFrameFile && !sourceGuides.some((g) => g.role === "last")) {
    sourceGuides.push({ role: "last", frame: total - 1, file: endFrameFile, comfyFile: endFrameFile, strength: 1 });
  }

  const before = sourceGuides
    .filter((g) => Number(g.frame) <= start)
    .sort((a, b) => Number(b.frame) - Number(a.frame))[0];
  const inRange = sourceGuides.filter((g) => Number(g.frame) >= start && Number(g.frame) < end);
  const selectedGuides = [...inRange];
  if (before && !selectedGuides.some((g) => g.id === before.id)) {
    selectedGuides.unshift({ ...before, role: "first", _continuityFallback: Number(before.frame) < start });
  }

  const localGuides = selectedGuides
    .map((g) => {
      let localFrame = Math.max(0, Math.min(requestedFrames - 1, Math.round(Number(g.frame) - start)));
      if (g === before || g._continuityFallback) localFrame = 0;
      if (g.role === "last" && end === total) localFrame = requestedFrames - 1;
      return {
        ...g,
        localFrame,
        strength: Math.min(1, Math.max(0, Number(g.strength ?? 1))),
        comfyFile: g.comfyFile || g.file
      };
    })
    .filter((g, idx, arr) =>
      idx === arr.findIndex((x) => x.localFrame === g.localFrame && x.comfyFile === g.comfyFile && x.role === g.role)
    )
    .sort((a, b) => a.localFrame - b.localFrame);

  return { start, end, requestedFrames, generationFrames, localSegments, localGuides };
}

export function buildTimelineData({
  globalPrompt = "",
  localSegments = [],
  localGuides = [],
  durationFrames,
  fps = DEFAULT_FPS
}) {
  const promptEntries = localSegments.map((s, i) => ({
    id: `p316-prompt-${s.id || i}`,
    start: Math.max(0, Math.round(s.startFrame)),
    length: Math.max(1, Math.round(s.endFrame - s.startFrame)),
    prompt: String(s.prompt || ""),
    type: "text",
    label: `${(s.startFrame / fps).toFixed(2)}–${(s.endFrame / fps).toFixed(2)}s`,
    isEndFrame: false
  }));

  const guideEntries = [];
  for (const g of localGuides) {
    const file = g.comfyFile || g.file;
    if (!file) continue;
    const endGuide = g.role === "last";
    const matching = !endGuide
      ? promptEntries.find((entry) => entry.start === g.localFrame && entry.type === "text")
      : null;
    if (matching) {
      matching.type = "image";
      matching.imageFile = file;
      matching.imageB64 = viewUrl(file);
      matching.isEndFrame = false;
      matching.guideId = g.id;
      continue;
    }
    guideEntries.push({
      id: `p316-guide-${g.id || crypto.randomUUID()}`,
      start: Math.max(0, Math.min(durationFrames - 1, Math.round(g.localFrame))),
      length: 1,
      prompt: String(g.prompt || ""),
      type: "image",
      imageFile: file,
      imageB64: viewUrl(file),
      isEndFrame: endGuide,
      guideId: g.id
    });
  }

  const timelineSegments = [...promptEntries, ...guideEntries].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.type === "image" ? -1 : 1;
  });

  return {
    mainTrackEnabled: true,
    audioTrackEnabled: true,
    motionTrackEnabled: false,
    propHeight: 90,
    globalPropHeight: 60,
    showFilenames: true,
    overrideAudio: false,
    inpaint_audio: true,
    global_prompt: globalPrompt || "",
    retake_global_prompt: "",
    retakeMode: false,
    retakeStart: 0,
    retakeLength: 0,
    retakePrompt: "",
    retakeStrength: 1,
    retakeVideo: null,
    normalStartFrame: 0,
    normalDurationFrames: durationFrames,
    segments: timelineSegments,
    motionSegments: [],
    audioSegments: []
  };
}

function nextPromptNodeId(prompt, start = 9000) {
  let id = Math.max(start, ...Object.keys(prompt).map((key) => (Number(key) || 0) + 1));
  while (prompt[String(id)]) id += 1;
  return () => String(id++);
}

function replaceDirectLinks(prompt, sourceId, replacements) {
  for (const node of Object.values(prompt)) {
    if (!node?.inputs) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || String(value[0]) !== String(sourceId)) continue;
      const replacement = replacements[Number(value[1])];
      if (replacement) node.inputs[key] = replacement;
    }
  }
}

/**
 * Add the official LTX 2.3 Ingredients IC-LoRA branch to an API prompt.
 * Guide images already uploaded for the Director timeline are reused as the
 * Ingredients reference sheet, so the UI needs no duplicate upload step.
 */
export function applyIngredientsICLoRA(prompt, ingredientFiles, objectInfo, options = {}) {
  const config = { ...DEFAULT_INGREDIENTS, ...(options || {}) };
  const files = [...new Set((ingredientFiles || []).filter(Boolean))]
    .slice(0, Math.max(1, Math.min(3, Number(config.maxImages) || 3)));
  if (!config.enabled || !files.length) return { applied: false, imageCount: 0 };

  const requiredNodes = [
    "LoadImage",
    "VRGDG_LTXICIngredientsGrid",
    "LTXICLoRALoaderModelOnly",
    "LTXAddVideoICLoRAGuideAdvanced"
  ];
  const missing = requiredNodes.filter((name) => !objectInfo?.[name]);
  if (missing.length) {
    throw new Error(`Ingredients IC-LoRA nodes are unavailable in ComfyUI: ${missing.join(", ")}`);
  }

  const directorId = Object.keys(prompt).find((id) => prompt[id]?.class_type === "LTXDirector");
  const guideId = Object.keys(prompt).find((id) => {
    const node = prompt[id];
    return node?.class_type === "LTXDirectorGuide" && String(node.inputs?.latent?.[0]) === String(directorId);
  });
  if (!directorId || !guideId) {
    throw new Error("Cannot attach Ingredients IC-LoRA: the Director or first-stage Director Guide node is missing.");
  }

  const director = prompt[directorId];
  const guide = prompt[guideId];
  const originalModel = director.inputs.model;
  const originalPositive = [guideId, 0];
  const originalNegative = [guideId, 1];
  const originalLatent = [guideId, 2];
  const vae = guide.inputs.vae;
  if (!Array.isArray(originalModel) || !Array.isArray(vae)) {
    throw new Error("Cannot attach Ingredients IC-LoRA: Director model or VAE connection is invalid.");
  }

  const allocateId = nextPromptNodeId(prompt);
  const imageNodeIds = files.map((file, index) => {
    const id = allocateId();
    prompt[id] = {
      inputs: { image: file },
      class_type: "LoadImage",
      _meta: { title: `Ingredients reference ${index + 1}` }
    };
    return id;
  });

  const gridId = allocateId();
  const gridInputs = {
    image_count: imageNodeIds.length,
    layout: imageNodeIds.length === 3 ? "three_row_reference" : "auto_ltx",
    output_width: 768,
    output_height: 448,
    columns: 0,
    gutter: 4,
    outer_padding: 4,
    corner_radius: 3,
    fit_mode: "contain_pad",
    batch_mode: "first_image_only",
    background_color: "#000000",
    cell_background_color: "#b8b8b8"
  };
  imageNodeIds.forEach((id, index) => { gridInputs[`image${index + 1}`] = [id, 0]; });
  prompt[gridId] = {
    inputs: gridInputs,
    class_type: "VRGDG_LTXICIngredientsGrid",
    _meta: { title: "Ingredients reference sheet" }
  };

  const loaderId = allocateId();
  prompt[loaderId] = {
    inputs: {
      model: originalModel,
      lora_name: INGREDIENTS_LORA,
      strength_model: Math.min(1, Math.max(0, Number(config.modelStrength) || 0))
    },
    class_type: "LTXICLoRALoaderModelOnly",
    _meta: { title: "Official LTX 2.3 Ingredients IC-LoRA" }
  };
  director.inputs.model = [loaderId, 0];

  const ingredientsGuideId = allocateId();
  // Redirect every downstream consumer of the first Director Guide so both
  // the initial and spatial-upscale passes retain the Ingredients metadata.
  replaceDirectLinks(prompt, guideId, {
    0: [ingredientsGuideId, 0],
    1: [ingredientsGuideId, 1],
    2: [ingredientsGuideId, 2]
  });
  prompt[ingredientsGuideId] = {
    inputs: {
      positive: originalPositive,
      negative: originalNegative,
      vae,
      latent: originalLatent,
      image: [gridId, 0],
      frame_idx: 0,
      strength: Math.min(1, Math.max(0, Number(config.guideStrength) || 0)),
      latent_downscale_factor: [loaderId, 1],
      crop: "center",
      use_tiled_encode: false,
      tile_size: 256,
      tile_overlap: 64,
      attention_strength: Math.min(1, Math.max(0, Number(config.attentionStrength) || 0))
    },
    class_type: "LTXAddVideoICLoRAGuideAdvanced",
    _meta: { title: "Ingredients identity conditioning" }
  };

  return {
    applied: true,
    imageCount: imageNodeIds.length,
    loaderId,
    gridId,
    guideId: ingredientsGuideId
  };
}

export async function fillI2vPrompt({
  globalPrompt = "",
  segments = [],
  guides = [],
  rangeStartFrame = 0,
  rangeEndFrame = null,
  durationSec = DEFAULT_DURATION,
  fps = DEFAULT_FPS,
  width = 1280,
  height = 720,
  seed = null,
  filenamePrefix = "premiere316/clip",
  firstFrameFile = null,
  endFrameFile = null,
  ingredients = DEFAULT_INGREDIENTS,
  objectInfo = null
} = {}) {
  const info = objectInfo || (await getObjectInfo());
  const graph = loadWorkflowTemplate(WORKFLOW_UI);
  const { prompt, warnings } = graphToApi(graph, info);
  const totalFrames = Math.max(1, framesOf(clampDuration(durationSec), fps));

  const compiled = compileRange({
    segments,
    guides,
    rangeStartFrame,
    rangeEndFrame: rangeEndFrame == null ? totalFrames : rangeEndFrame,
    fps,
    globalPrompt,
    firstFrameFile,
    endFrameFile
  });
  const td = buildTimelineData({
    globalPrompt,
    localSegments: compiled.localSegments,
    localGuides: compiled.localGuides,
    durationFrames: compiled.generationFrames,
    fps
  });

  const frameLens = compiled.localSegments.map((s) => Math.max(1, Math.round(s.endFrame - s.startFrame)));
  const localPrompts = compiled.localSegments
    .map((s) => String(s.prompt || globalPrompt || "").trim())
    .join(" | ");
  const guideStrength = compiled.localGuides.length
    ? compiled.localGuides.map((g) => Number(g.strength ?? 1).toFixed(2)).join(",")
    : "1.00";

  let dirId = LTX_DIRECTOR_ID;
  if (!prompt[dirId] || prompt[dirId].class_type !== "LTXDirector") {
    dirId = Object.keys(prompt).find((k) => prompt[k].class_type === "LTXDirector");
  }
  if (!dirId || !prompt[dirId]?.inputs) {
    throw new Error("LTXDirector node missing after graph conversion. Confirm the WhatDreamsCost custom nodes are installed.");
  }

  const di = prompt[dirId].inputs;
  const set = (key, value) => { di[key] = value; };
  const generationSec = compiled.generationFrames / fps;
  set("start_second", 0);
  set("end_second", generationSec);
  set("duration_seconds", generationSec);
  set("start_frame", 0);
  set("end_frame", compiled.generationFrames);
  set("duration_frames", compiled.generationFrames);
  set("frame_rate", fps);
  set("display_mode", "frames");
  set("custom_width", width);
  set("custom_height", height);
  set("resize_method", di.resize_method ?? "maintain aspect ratio");
  set("divisible_by", di.divisible_by ?? 32);
  set("img_compression", di.img_compression ?? 18);
  set("timeline_data", JSON.stringify(td));
  set("local_prompts", localPrompts || globalPrompt || "");
  set("segment_lengths", frameLens.join(","));
  set("guide_strength", guideStrength);
  set("use_custom_audio", false);
  set("use_custom_motion", false);
  set("inpaint_audio", true);
  if ("override_audio" in di) set("override_audio", false);
  set("epsilon", di.epsilon ?? 0.99);
  if ("timeline_ui" in di) set("timeline_ui", "");
  if ("global_prompt" in di) set("global_prompt", globalPrompt || "");

  const noiseId = Object.keys(prompt).find((k) => prompt[k].class_type === "RandomNoise") || "28";
  if (prompt[noiseId]?.inputs) {
    const n = seed != null && Number.isFinite(+seed)
      ? Math.floor(+seed)
      : Math.floor(Math.random() * 2 ** 32);
    if ("noise_seed" in prompt[noiseId].inputs) prompt[noiseId].inputs.noise_seed = n;
    else if ("seed" in prompt[noiseId].inputs) prompt[noiseId].inputs.seed = n;
  }

  const vhsId = Object.keys(prompt).find((k) => prompt[k].class_type === "VHS_VideoCombine") || "94";
  if (prompt[vhsId]?.inputs) {
    prompt[vhsId].inputs.filename_prefix = filenamePrefix || "premiere316/clip";
    prompt[vhsId].inputs.frame_rate = fps;
  }

  const ingredientFiles = (guides || [])
    .map((guide) => guide?.comfyFile || guide?.file)
    .filter(Boolean);
  const ingredientsResult = applyIngredientsICLoRA(prompt, ingredientFiles, info, ingredients);

  return {
    prompt,
    warnings,
    timelineData: td,
    rangeStartFrame: compiled.start,
    rangeEndFrame: compiled.end,
    requestedFrames: compiled.requestedFrames,
    generationFrames: compiled.generationFrames,
    localSegments: compiled.localSegments,
    localGuides: compiled.localGuides,
    ingredients: ingredientsResult
  };
}
