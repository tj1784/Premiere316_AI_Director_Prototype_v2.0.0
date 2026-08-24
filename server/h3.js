import fs from "fs";
import path from "path";
import crypto from "crypto";
import { COMFY_URL, getObjectInfo, graphToApi, loadWorkflowTemplate, uploadImage } from "./comfy.js";
import { ffmpegAvailable } from "./ffmpeg.js";
import { PACKAGE_ROOT } from "./paths.js";
import { compileRange, framesOf } from "./timeline.js";

export const H3_PROVIDER_ID = "minimax_h3_local";
export const H3_DISPLAY_NAME = "MiniMax H3";
export const H3_FPS = 24;
export const H3_MIN_SECONDS = 4;
export const H3_MAX_SECONDS = 15;
export const H3_MAX_REFERENCE_FILES = 12;
export const H3_MAX_IMAGE_REFERENCES = 12;

export const H3_MODE_T2V = "t2v";
export const H3_MODE_FIRST = "first_frame";
export const H3_MODE_LAST = "last_frame";
export const H3_MODE_FIRST_LAST = "first_last";
export const H3_MODE_REFERENCE = "reference";

export const H3_MODES = Object.freeze({
  [H3_MODE_T2V]: { id: H3_MODE_T2V, label: "Text to Video", family: "fl2va", needsFirst: false, needsLast: false },
  [H3_MODE_FIRST]: { id: H3_MODE_FIRST, label: "First Frame to Video", family: "fl2va", needsFirst: true, needsLast: false },
  [H3_MODE_LAST]: { id: H3_MODE_LAST, label: "Last Frame to Video", family: "fl2va", needsFirst: false, needsLast: true },
  [H3_MODE_FIRST_LAST]: { id: H3_MODE_FIRST_LAST, label: "First + Last Frame", family: "fl2va", needsFirst: true, needsLast: true },
  [H3_MODE_REFERENCE]: { id: H3_MODE_REFERENCE, label: "Reference to Video", family: "ref2va", needsFirst: false, needsLast: false }
});

export const H3_MODEL_FILES = Object.freeze({
  fl2va: {
    purpose: "T2V/I2V/first-last",
    filename: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    category: "diffusion_models"
  },
  ref2va: {
    purpose: "Reference-to-video",
    filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    category: "diffusion_models"
  },
  textEncoder: {
    purpose: "Shared Qwen3-VL encoder",
    filename: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    category: "text_encoders"
  },
  videoVae: {
    purpose: "Video VAE",
    filename: "minimax_h3_video_vae_fp16.safetensors",
    category: "vae"
  },
  audioVae: {
    purpose: "Audio VAE",
    filename: "minimax_h3_audio_vae_fp32.safetensors",
    category: "vae"
  }
});

const H3_NODE_CLASSES = Object.freeze({
  fl2va: "MiniMaxH3ImageToVideo",
  ref2va: "MiniMaxH3ReferenceToVideo",
  latent: "EmptyMiniMaxH3LatentAV",
  sigmaShift: "MiniMaxH3SigmaShift",
  audioDecode: "VAEDecodeAudio",
  createVideo: "CreateVideo",
  saveVideo: "SaveVideo",
  unet: "UNETLoader",
  clip: "CLIPLoader",
  vae: "VAELoader",
  loadImage: "LoadImage",
  loadAudio: "LoadAudio",
  loadVideoFrames: "VHS_LoadVideo"
});

export const H3_WORKFLOW_SLOTS = Object.freeze({
  fl2va: {
    template: "minimax-h3/video_minimax_h3_i2v.json",
    t2vTemplate: "minimax-h3/video_minimax_h3_t2v.json",
    subgraph: "Image to Video (MiniMax H3)",
    nodes: {
      unet: "6",
      videoVae: "11",
      clip: "13",
      noise: "15",
      sampler: "17",
      audioVae: "24",
      videoDecode: "10",
      audioDecode: "23",
      scheduler: "9",
      guider: "16",
      samplerAdvanced: "14",
      h3: "104",
      durationPrimitive: "111",
      frameMath: "107",
      createVideo: "91",
      saveVideo: "p316_h3_save"
    }
  },
  ref2va: {
    template: "minimax-h3/video_minimax_h3_r2v.json",
    nodes: {
      saveVideo: "92",
      videoVae: "119",
      audioVae: "120",
      audioDecode: "121",
      videoDecode: "122",
      sampler: "123",
      scheduler: "124",
      samplerAdvanced: "125",
      guider: "126",
      unet: "127",
      clip: "128",
      noise: "129",
      createVideo: "130",
      frameMath: "131",
      durationPrimitive: "132",
      h3: "136"
    }
  }
});

const DIAGNOSTICS_CACHE_MS = 15_000;
let h3DiagnosticsCache = null;
let h3DiagnosticsAt = 0;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanForPrompt(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function compareVersions(a, b) {
  const left = String(a || "0").split(/[^\d]+/).filter(Boolean).map(Number);
  const right = String(b || "0").split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function comfySystemStats() {
  const response = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ComfyUI system_stats failed: HTTP ${response.status}`);
  return response.json();
}

function comboOptions(objectInfo, classType, inputName) {
  const def = objectInfo?.[classType]?.input?.required?.[inputName] || objectInfo?.[classType]?.input?.optional?.[inputName];
  if (!Array.isArray(def)) return [];
  const [typeOrOptions, config] = def;
  if (Array.isArray(typeOrOptions)) return typeOrOptions.map(String);
  if (Array.isArray(config?.options)) return config.options.map(String);
  return [];
}

function inputNames(objectInfo, classType) {
  const input = objectInfo?.[classType]?.input || {};
  return new Set([...Object.keys(input.required || {}), ...Object.keys(input.optional || {})]);
}

function hasInput(objectInfo, classType, inputName) {
  return inputNames(objectInfo, classType).has(inputName);
}

function detectClipType(objectInfo) {
  const options = comboOptions(objectInfo, H3_NODE_CLASSES.clip, "type");
  if (options.includes("minimax")) return "minimax";
  return null;
}

function statFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { path: filePath, bytes: stat.size, gb: Math.round((stat.size / (1024 ** 3)) * 100) / 100 };
  } catch {
    return null;
  }
}

function safeResolve(base, relative) {
  return path.resolve(String(base || "").replaceAll("/", path.sep), String(relative || "").replaceAll("/", path.sep));
}

function parseSimpleModelPathYaml(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  let blockKey = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const withoutComment = raw.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;
    const top = withoutComment.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (top) {
      current = { name: top[1], file: filePath, basePath: null, categories: {} };
      entries.push(current);
      blockKey = null;
      continue;
    }
    if (!current) continue;
    const kv = withoutComment.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, rest] = kv;
      const value = rest.trim();
      blockKey = null;
      if (key === "base_path") current.basePath = value.replace(/^['"]|['"]$/g, "");
      else if (value === "|") blockKey = key;
      else current.categories[key] = [value.replace(/^['"]|['"]$/g, "")];
      continue;
    }
    if (blockKey) {
      const blockValue = withoutComment.match(/^\s{4}(.+)$/);
      if (blockValue) {
        current.categories[blockKey] = current.categories[blockKey] || [];
        current.categories[blockKey].push(blockValue[1].trim().replace(/^['"]|['"]$/g, ""));
      } else {
        blockKey = null;
      }
    }
  }
  return entries.filter((entry) => entry.basePath);
}

function configuredModelDirs(category) {
  const yamlFiles = [
    path.join(PACKAGE_ROOT, "BlokeyUI", "premiere316_model_paths.yaml"),
    path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "extra_model_paths.yaml"),
    path.join(process.env.USERPROFILE || "C:\\Users\\Blokey", "Documents", "Sineforge", "BlokeyUI", "ComfyUI", "extra_model_paths.yaml")
  ];
  const aliases = {
    diffusion_models: ["diffusion_models", "unet", "checkpoints"],
    text_encoders: ["text_encoders", "clip"],
    vae: ["vae"]
  }[category] || [category];
  const dirs = [];
  for (const yaml of yamlFiles) {
    for (const entry of parseSimpleModelPathYaml(yaml)) {
      for (const alias of aliases) {
        for (const rel of entry.categories?.[alias] || []) dirs.push(safeResolve(entry.basePath, rel));
      }
    }
  }
  dirs.push(
    path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "models", category),
    path.join(process.env.USERPROFILE || "C:\\Users\\Blokey", "Documents", "Sineforge", "BlokeyUI", "ComfyUI", "models", category),
    path.join("C:\\", "ComfyUI", "ComfyUI_Shared_Folders", "models", category)
  );
  if (category === "diffusion_models") {
    dirs.push(
      path.join("C:\\", "ComfyUI", "ComfyUI_Shared_Folders", "models", "unet"),
      path.join("C:\\", "ComfyUI", "ComfyUI_Shared_Folders", "models", "checkpoints")
    );
  }
  if (category === "text_encoders") dirs.push(path.join("C:\\", "ComfyUI", "ComfyUI_Shared_Folders", "models", "clip"));
  return uniq(dirs.map((dir) => path.resolve(dir)));
}

function discoverDiskModel(model) {
  for (const dir of configuredModelDirs(model.category)) {
    const direct = path.join(dir, model.filename);
    const found = statFile(direct);
    if (found) return found;
  }
  return null;
}

function discoverH3Models(objectInfo = {}) {
  const unetOptions = comboOptions(objectInfo, H3_NODE_CLASSES.unet, "unet_name");
  const clipOptions = comboOptions(objectInfo, H3_NODE_CLASSES.clip, "clip_name");
  const vaeOptions = comboOptions(objectInfo, H3_NODE_CLASSES.vae, "vae_name");
  const optionMap = {
    diffusion_models: unetOptions,
    text_encoders: clipOptions,
    vae: vaeOptions
  };
  const out = {};
  for (const [key, model] of Object.entries(H3_MODEL_FILES)) {
    const listedByComfy = (optionMap[model.category] || []).includes(model.filename);
    const disk = discoverDiskModel(model);
    out[key] = {
      ...model,
      listedByComfy,
      disk,
      found: listedByComfy || Boolean(disk)
    };
  }
  return out;
}

function normalizeTemplateLinks(links = []) {
  return links.map((link) => Array.isArray(link)
    ? link
    : [link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type]);
}

function loadH3Template(name) {
  return loadWorkflowTemplate(`minimax-h3/${name}`);
}

function validateOfficialTemplates() {
  const checks = [];
  const errors = [];
  const flTemplates = [
    ["video_minimax_h3_t2v.json", H3_WORKFLOW_SLOTS.fl2va.t2vTemplate],
    ["video_minimax_h3_i2v.json", H3_WORKFLOW_SLOTS.fl2va.template]
  ];
  for (const [fileName] of flTemplates) {
    try {
      const template = loadH3Template(fileName);
      const subgraph = (template.definitions?.subgraphs || []).find((item) => item.name === H3_WORKFLOW_SLOTS.fl2va.subgraph);
      const h3 = subgraph?.nodes?.find((node) => String(node.id) === H3_WORKFLOW_SLOTS.fl2va.nodes.h3);
      if (!subgraph || h3?.type !== H3_NODE_CLASSES.fl2va) throw new Error(`missing ${H3_NODE_CLASSES.fl2va} slot ${H3_WORKFLOW_SLOTS.fl2va.nodes.h3}`);
      checks.push({ template: fileName, ok: true, h3Node: H3_WORKFLOW_SLOTS.fl2va.nodes.h3 });
    } catch (error) {
      errors.push(`${fileName}: ${String(error.message || error)}`);
      checks.push({ template: fileName, ok: false, error: String(error.message || error) });
    }
  }
  try {
    const template = loadH3Template("video_minimax_h3_r2v.json");
    const h3 = template.nodes?.find((node) => String(node.id) === H3_WORKFLOW_SLOTS.ref2va.nodes.h3);
    if (h3?.type !== H3_NODE_CLASSES.ref2va) throw new Error(`missing ${H3_NODE_CLASSES.ref2va} slot ${H3_WORKFLOW_SLOTS.ref2va.nodes.h3}`);
    checks.push({ template: "video_minimax_h3_r2v.json", ok: true, h3Node: H3_WORKFLOW_SLOTS.ref2va.nodes.h3 });
  } catch (error) {
    errors.push(`video_minimax_h3_r2v.json: ${String(error.message || error)}`);
    checks.push({ template: "video_minimax_h3_r2v.json", ok: false, error: String(error.message || error) });
  }
  return { ok: !errors.length, checks, errors };
}

export function h3ResolvedFrames(requestedSeconds) {
  const rounded = Math.max(5, Math.round(Number(requestedSeconds || 0) * H3_FPS));
  return rounded + ((5 - (rounded % 17) + 17) % 17);
}

export function h3Timing(requestedSeconds) {
  const requested = Math.max(1 / H3_FPS, Number(requestedSeconds) || 0);
  const generationSeconds = Math.min(H3_MAX_SECONDS, Math.max(H3_MIN_SECONDS, requested));
  const resolvedFrames = h3ResolvedFrames(generationSeconds);
  const requestedFrames = Math.max(1, Math.round(requested * H3_FPS));
  return {
    fps: H3_FPS,
    requestedSeconds: requested,
    requestedFrames,
    generationSeconds,
    resolvedFrames,
    rawDurationSec: resolvedFrames / H3_FPS,
    conformedFrames: requestedFrames,
    conformedDurationSec: requestedFrames / H3_FPS,
    wasClampedForMinimum: requested < H3_MIN_SECONDS,
    exceedsSingleRenderLimit: requested > H3_MAX_SECONDS
  };
}

function parseAspectRatio(value, fallbackWidth = 1344, fallbackHeight = 768) {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)/);
  if (match) return Number(match[1]) / Number(match[2]);
  if (text.includes("2.39")) return 2.39;
  if (text.includes("16:9") || text.includes("widescreen")) return 16 / 9;
  if (text.includes("9:16") || text.includes("vertical")) return 9 / 16;
  if (text.includes("1:1") || text.includes("square")) return 1;
  const w = Number(fallbackWidth);
  const h = Number(fallbackHeight);
  return Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 16 / 9;
}

export function h3Dimensions({ aspect = "16:9", width = 1344, height = 768, quality = "full" } = {}) {
  const target = parseAspectRatio(aspect, width, height);
  if (quality !== "preview" && Math.abs(target - (16 / 9)) < 0.06) {
    return { width: 1344, height: 768, ratio: 1.75, quality, targetRatio: Math.round(target * 1000) / 1000, officialPreset: true };
  }
  if (quality !== "preview" && Math.abs(target - 2.39) < 0.08) {
    return { width: 1536, height: 640, ratio: 2.4, quality, targetRatio: Math.round(target * 1000) / 1000, officialPreset: true };
  }
  if (quality === "preview" && Math.abs(target - (16 / 9)) < 0.06) {
    return { width: 768, height: 432, ratio: 1.778, quality, targetRatio: Math.round(target * 1000) / 1000, officialPreset: true };
  }
  const fullArea = 1344 * 768;
  const previewArea = 768 * 432;
  const maxArea = quality === "preview" ? previewArea : fullArea;
  let best = null;
  for (let h = 320; h <= 1024; h += 32) {
    for (let w = 320; w <= 1792; w += 32) {
      const area = w * h;
      if (area > maxArea) continue;
      const ratio = w / h;
      const aspectError = Math.abs(ratio - target);
      const areaPenalty = Math.abs(maxArea - area) / maxArea * 0.025;
      const score = aspectError + areaPenalty;
      if (!best || score < best.score) best = { width: w, height: h, ratio, score };
    }
  }
  if (!best) return { width: 1344, height: 768, ratio: 1344 / 768, quality };
  return {
    width: best.width,
    height: best.height,
    ratio: Math.round(best.ratio * 1000) / 1000,
    quality,
    targetRatio: Math.round(target * 1000) / 1000
  };
}

export function splitH3Ranges(ranges = [], fps = H3_FPS) {
  const maxFrames = Math.floor(H3_MAX_SECONDS * Number(fps || H3_FPS));
  const out = [];
  for (const range of ranges) {
    let cursor = Math.round(Number(range.startFrame) || 0);
    const end = Math.max(cursor + 1, Math.round(Number(range.endFrame) || cursor + 1));
    while (cursor < end) {
      const sliceEnd = Math.min(end, cursor + maxFrames);
      out.push({
        ...range,
        startFrame: cursor,
        endFrame: sliceEnd,
        h3Split: end - cursor > maxFrames || cursor > Number(range.startFrame),
        sourceRangeStartFrame: Number(range.startFrame),
        sourceRangeEndFrame: Number(range.endFrame)
      });
      cursor = sliceEnd;
    }
  }
  return out;
}

function h3AnchorImageCount(modeInfo) {
  return (modeInfo?.needsFirst ? 1 : 0) + (modeInfo?.needsLast ? 1 : 0);
}

export function validateH3ReferenceManifest(references = [], { imageTagOffset = 0 } = {}) {
  const refs = (Array.isArray(references) ? references : []).map((ref, index) => ({
    id: ref.id || `ref_${index + 1}`,
    type: String(ref.type || "image").toLowerCase(),
    role: String(ref.role || "custom"),
    file: ref.file || ref.comfyFile || null,
    comfyFile: ref.comfyFile || ref.file || null,
    durationSec: Number(ref.durationSec) || 0,
    includeAudio: ref.includeAudio !== false
  }));
  const images = refs.filter((ref) => ref.type === "image");
  const videos = refs.filter((ref) => ref.type === "video");
  const audios = refs.filter((ref) => ref.type === "audio");
  const errors = [];
  if (refs.length > H3_MAX_REFERENCE_FILES) errors.push(`MiniMax H3 accepts at most ${H3_MAX_REFERENCE_FILES} logical reference files across images, videos, and standalone audio.`);
  if (images.length > H3_MAX_IMAGE_REFERENCES) errors.push(`MiniMax H3 accepts at most ${H3_MAX_IMAGE_REFERENCES} image references.`);
  if (videos.length > 3) errors.push("Ref2VA accepts at most 3 videos.");
  if (audios.length > 3) errors.push("Ref2VA accepts at most 3 standalone audio clips.");
  if (audios.length && !images.length && !videos.length) errors.push("Audio cannot be the only Ref2VA reference modality; add an image or video reference.");
  const totalVideoSec = videos.reduce((sum, ref) => sum + Math.max(0, ref.durationSec), 0);
  const totalAudioSec = audios.reduce((sum, ref) => sum + Math.max(0, ref.durationSec), 0);
  for (const video of videos) {
    if (video.durationSec && (video.durationSec < 2 || video.durationSec > 15)) errors.push(`${video.id || "Video reference"} must be 2–15 seconds.`);
  }
  for (const audio of audios) {
    if (audio.durationSec && (audio.durationSec < 2 || audio.durationSec > 15)) errors.push(`${audio.id || "Audio reference"} must be 2–15 seconds.`);
  }
  if (totalVideoSec > 15) errors.push("Total referenced video duration must be no more than 15 seconds.");
  if (totalAudioSec > 15) errors.push("Total standalone audio duration must be no more than 15 seconds.");
  let imageIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;
  const tagged = refs.map((ref) => {
    if (ref.type === "image") return { ...ref, tag: `<Picture ${imageTagOffset + ++imageIndex}>`, ordinal: imageIndex };
    if (ref.type === "video") return { ...ref, tag: `<Video ${++videoIndex}>`, ordinal: videoIndex };
    if (ref.type === "audio") return { ...ref, tag: `<Audio ${++audioIndex}>`, ordinal: audioIndex };
    errors.push(`Unsupported Ref2VA reference type: ${ref.type}`);
    return { ...ref, tag: `<Reference ${refs.indexOf(ref) + 1}>`, ordinal: refs.indexOf(ref) + 1 };
  });
  return { ok: !errors.length, errors, references: tagged, counts: { images: images.length, videos: videos.length, audios: audios.length, total: refs.length } };
}

export function compileH3Prompt({
  project,
  clip,
  mode = H3_MODE_FIRST,
  rangeStartFrame = 0,
  rangeEndFrame,
  referenceManifest = [],
  audioMode = "mixed"
} = {}) {
  if (!clip) throw new Error("Clip is required to compile a MiniMax H3 prompt");
  const projectFps = Number(project?.settings?.fps) || H3_FPS;
  const range = compileRange({
    globalPrompt: clip.globalPrompt || "",
    segments: clip.segments || [],
    guides: clip.guides || [],
    rangeStartFrame,
    rangeEndFrame: rangeEndFrame ?? framesOf(clip.durationSec || project?.settings?.defaultDurationSec || 6, projectFps),
    fps: projectFps
  });
  const requestedSeconds = range.requestedFrames / projectFps;
  const timing = h3Timing(requestedSeconds);
  if (timing.exceedsSingleRenderLimit) {
    throw new Error(`MiniMax H3 single renders are limited to ${H3_MAX_SECONDS}s. Split this range before compiling.`);
  }

  const localSegments = range.localSegments || [];
  const scene = cleanForPrompt(clip.globalPrompt || project?.screenplay?.settings?.storyBrief || project?.name || "Cinematic biblical scene");
  const score = project?.score || {};
  const modeInfo = H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
  const imageTagOffset = mode === H3_MODE_REFERENCE ? 0 : h3AnchorImageCount(modeInfo);
  const refValidation = validateH3ReferenceManifest(referenceManifest, { imageTagOffset });
  if (referenceManifest?.length && !refValidation.ok) throw new Error(refValidation.errors.join(" "));
  if (mode !== H3_MODE_REFERENCE && refValidation.references.some((ref) => ref.type !== "image")) {
    throw new Error(`${modeInfo.label} accepts image references only. Use Reference to Video for video or audio references.`);
  }

  const lines = [];
  lines.push("PREMIERE316 LOCAL MINIMAX H3 DIRECTOR PROMPT");
  lines.push(`Scene: ${scene}`);
  lines.push(`Render mode: ${modeInfo.label}.`);
  lines.push("Continuity: preserve character identity, anatomy, wardrobe, props, terrain, lighting direction, scale, and camera geography from start to finish. Do not add captions, subtitles, written labels, UI overlays, watermarks, or extra faces on the rear of any head.");
  lines.push("Camera and style: photorealistic cinematic realism, controlled motion, rich texture, volumetric light, atmospheric dust, natural cloth and hair movement, realistic motion blur, high dynamic range, delicate film grain.");
  if (mode === H3_MODE_REFERENCE && refValidation.references.length) {
    lines.push("Reference binding:");
    for (const ref of refValidation.references) {
      lines.push(`${ref.tag} = ${ref.role || "reference"}; use it only for its assigned purpose and preserve the requested identity/style/order.`);
    }
  } else if (modeInfo.needsFirst && modeInfo.needsLast) {
    lines.push("Frame anchors: the first image is a hard opening frame and the last image is a hard ending frame; move naturally between them without morphing identity.");
  } else if (modeInfo.needsFirst) {
    lines.push("Frame anchor: the first image is the hard opening frame; continue motion naturally from it without identity drift.");
  } else if (modeInfo.needsLast) {
    lines.push("Frame anchor: the last image is the hard ending frame; approach it naturally without identity drift.");
  }
  if (mode !== H3_MODE_REFERENCE && refValidation.references.length) {
    lines.push("Additional image reference binding:");
    for (const ref of refValidation.references) {
      lines.push(`${ref.tag} = ${ref.role || "reference"}; use it as visual reference conditioning only. Keep the hard frame anchor authoritative.`);
    }
  }
  lines.push(`Timeline: requested ${timing.requestedSeconds.toFixed(3)} seconds; H3 raw generation ${timing.rawDurationSec.toFixed(3)} seconds at ${H3_FPS} fps (${timing.resolvedFrames} frames).`);
  for (const [index, segment] of localSegments.entries()) {
    const startSec = Number(segment.startSec || 0);
    const endSec = Math.min(timing.conformedDurationSec, Number(segment.endSec || 0));
    const prompt = cleanForPrompt(segment.prompt || scene);
    lines.push(`[Shot ${index + 1}: ${startSec.toFixed(2)}s-${Math.max(startSec, endSec).toFixed(2)}s] ${prompt}`);
  }
  const guideNotes = (range.localGuides || [])
    .filter((guide) => cleanForPrompt(guide.prompt))
    .map((guide) => `${guide.role || "guide"} frame at ${(Number(guide.localFrame || 0) / projectFps).toFixed(2)}s: ${cleanForPrompt(guide.prompt)}`);
  if (guideNotes.length) {
    lines.push("Guide image notes:");
    lines.push(...guideNotes.slice(0, 5));
  }
  const audioLines = [];
  if (audioMode === "mute") audioLines.push("Audio: generate natural ambience only; final edit may discard this mixed soundtrack.");
  else if (audioMode === "diegetic_only") audioLines.push("Audio: generate dialogue, breathing, cloth, footsteps, impacts, and diegetic ambience only; no non-diegetic music.");
  else audioLines.push("Audio: generate one coherent mixed stereo soundtrack with dialogue/wordless vocalization, diegetic SFX, ambience, and restrained non-diegetic score together.");
  if (score.enabled !== false && score.prompt) audioLines.push(`Music intent: ${cleanForPrompt(score.prompt)}`);
  if (score.instrumentalOnly !== false) audioLines.push("If music is present, keep it reverent and mostly instrumental/wordless.");
  lines.push(audioLines.join(" "));
  lines.push("Negative visual constraints: no text cards, no subtitles, no duplicate face, no rear-head face, no bald scalp unless explicitly described, no extra limbs, no rubber morphing, no modern objects, no logo, no UI.");

  return {
    provider: H3_PROVIDER_ID,
    mode,
    prompt: lines.filter(Boolean).join("\n\n"),
    timing,
    rangeStartFrame: range.start,
    rangeEndFrame: range.end,
    requestedFrames: range.requestedFrames,
    localSegments,
    localGuides: range.localGuides || [],
    referenceManifest: refValidation.references,
    audioMode
  };
}

function requireClass(objectInfo, classType) {
  if (!objectInfo?.[classType]) throw new Error(`ComfyUI is missing required node class ${classType}`);
}

function requireInput(objectInfo, classType, inputName) {
  if (!hasInput(objectInfo, classType, inputName)) throw new Error(`${classType} does not expose required input ${inputName}`);
}

function requireNode(prompt, id, classType) {
  const node = prompt[String(id)];
  if (!node) throw new Error(`Official H3 template is missing node ${id}`);
  if (node.class_type !== classType) throw new Error(`Official H3 template node ${id} is ${node.class_type}, expected ${classType}`);
  return node;
}

function setInputIfPresent(objectInfo, node, inputName, value) {
  if (hasInput(objectInfo, node.class_type, inputName)) node.inputs[inputName] = value;
}

function removeH3ExternalInputs(h3Node) {
  for (const name of ["first_frame", "last_frame"]) delete h3Node.inputs[name];
}

function addLoadImage(prompt, id, comfyFile) {
  prompt[id] = { class_type: H3_NODE_CLASSES.loadImage, inputs: { image: comfyFile } };
  return [id, 0];
}

function addImageReferencesToH3Node(prompt, h3, references, {
  startId = 1,
  maxImages = H3_MAX_IMAGE_REFERENCES
} = {}) {
  const imageRefs = references.filter((ref) => ref.type === "image");
  if (imageRefs.length > maxImages) throw new Error(`MiniMax H3 accepts at most ${maxImages} image references.`);
  for (const ref of imageRefs) {
    if (!ref.comfyFile) throw new Error(`${ref.tag} has no staged ComfyUI file`);
    const id = `p316_h3_ref_image_${startId + ref.ordinal - 1}`;
    h3.inputs[`ref_images.ref_image_${ref.ordinal - 1}`] = addLoadImage(prompt, id, ref.comfyFile);
  }
}

function validateApiPrompt(prompt, objectInfo) {
  for (const [id, node] of Object.entries(prompt)) {
    if (!objectInfo?.[node.class_type]) throw new Error(`Generated H3 API prompt contains unavailable node ${node.class_type} (${id})`);
    const names = inputNames(objectInfo, node.class_type);
    for (const [inputName, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) && value.length === 2) {
        const upstream = prompt[String(value[0])];
        if (!upstream) throw new Error(`${node.class_type}.${inputName} points at missing node ${value[0]}`);
      } else if (!names.has(inputName) && !String(inputName).startsWith("ref_images.") && !String(inputName).startsWith("ref_videos.") && !String(inputName).startsWith("ref_video_audios.") && !String(inputName).startsWith("ref_audios.")) {
        throw new Error(`${node.class_type} does not expose input ${inputName}`);
      }
    }
  }
}

function patchCommonH3Nodes(prompt, objectInfo, {
  family,
  promptText,
  width,
  height,
  frames,
  seed,
  filenamePrefix,
  refImageSize = "match"
}) {
  const slots = H3_WORKFLOW_SLOTS[family].nodes;
  const h3Class = family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va;
  const h3 = requireNode(prompt, slots.h3, h3Class);
  const unet = requireNode(prompt, slots.unet, H3_NODE_CLASSES.unet);
  const clip = requireNode(prompt, slots.clip, H3_NODE_CLASSES.clip);
  const videoVae = requireNode(prompt, slots.videoVae, H3_NODE_CLASSES.vae);
  const audioVae = requireNode(prompt, slots.audioVae, H3_NODE_CLASSES.vae);
  const noise = requireNode(prompt, slots.noise, "RandomNoise");
  const createVideo = requireNode(prompt, slots.createVideo, H3_NODE_CLASSES.createVideo);

  h3.inputs.prompt = promptText;
  h3.inputs.width = width;
  h3.inputs.height = height;
  h3.inputs.length = frames;
  setInputIfPresent(objectInfo, h3, "ref_image_size", refImageSize);

  unet.inputs.unet_name = H3_MODEL_FILES[family].filename;
  setInputIfPresent(objectInfo, unet, "weight_dtype", "default");
  clip.inputs.clip_name = H3_MODEL_FILES.textEncoder.filename;
  const clipType = detectClipType(objectInfo);
  if (!clipType) throw new Error("CLIPLoader does not expose the MiniMax clip type. Update ComfyUI to 0.30.0+ with native MiniMax H3 support.");
  clip.inputs.type = clipType;
  setInputIfPresent(objectInfo, clip, "device", "default");
  videoVae.inputs.vae_name = H3_MODEL_FILES.videoVae.filename;
  audioVae.inputs.vae_name = H3_MODEL_FILES.audioVae.filename;
  noise.inputs.noise_seed = seed;
  createVideo.inputs.fps = H3_FPS;
  setInputIfPresent(objectInfo, createVideo, "bit_depth", 8);

  if (prompt[slots.sampler]) prompt[slots.sampler].inputs.sampler_name = "res_multistep";
  if (prompt[slots.scheduler]) {
    setInputIfPresent(objectInfo, prompt[slots.scheduler], "scheduler", "simple");
    setInputIfPresent(objectInfo, prompt[slots.scheduler], "steps", 20);
    setInputIfPresent(objectInfo, prompt[slots.scheduler], "denoise", 1);
  }

  const saveId = slots.saveVideo;
  if (!prompt[saveId]) {
    prompt[saveId] = {
      class_type: H3_NODE_CLASSES.saveVideo,
      inputs: {
        video: [slots.createVideo, 0],
        filename_prefix: filenamePrefix,
        format: "mp4",
        codec: "h264"
      }
    };
  } else {
    prompt[saveId].inputs.video = [slots.createVideo, 0];
    prompt[saveId].inputs.filename_prefix = filenamePrefix;
    prompt[saveId].inputs.format = "mp4";
    prompt[saveId].inputs.codec = "h264";
  }
}

function assertH3ReadyForBuild(objectInfo, family) {
  const required = [
    H3_NODE_CLASSES.audioDecode,
    H3_NODE_CLASSES.createVideo,
    H3_NODE_CLASSES.saveVideo,
    H3_NODE_CLASSES.unet,
    H3_NODE_CLASSES.clip,
    H3_NODE_CLASSES.vae,
    family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va
  ];
  for (const classType of required) requireClass(objectInfo, classType);
  if (!detectClipType(objectInfo)) {
    throw new Error("Native MiniMax H3 is not ready: CLIPLoader is missing the MiniMax type option.");
  }
  requireInput(objectInfo, family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va, "prompt");
  requireInput(objectInfo, family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va, "width");
  requireInput(objectInfo, family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va, "height");
  requireInput(objectInfo, family === "ref2va" ? H3_NODE_CLASSES.ref2va : H3_NODE_CLASSES.fl2va, "length");
}

export function buildH3Workflow({
  objectInfo,
  mode = H3_MODE_FIRST,
  promptText,
  width,
  height,
  frames,
  seed = 1,
  filenamePrefix,
  firstFrameComfyFile = null,
  lastFrameComfyFile = null,
  references = [],
  refImageSize = "match"
}) {
  const modeInfo = H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
  const family = modeInfo.family;
  assertH3ReadyForBuild(objectInfo, family);
  if (family === "fl2va") {
    const refValidation = validateH3ReferenceManifest(references, { imageTagOffset: h3AnchorImageCount(modeInfo) });
    if (!refValidation.ok) throw new Error(refValidation.errors.join(" "));
    if (refValidation.references.some((ref) => ref.type !== "image")) {
      throw new Error(`${modeInfo.label} accepts image references only. Use Reference to Video for video or audio references.`);
    }
    if (refValidation.references.length && !hasInput(objectInfo, H3_NODE_CLASSES.fl2va, "ref_images")) {
      throw new Error(`${H3_NODE_CLASSES.fl2va} does not expose ref_images yet. Restart or update the MiniMax H3 ComfyUI node before using image references with ${modeInfo.label}.`);
    }
    const templateName = mode === H3_MODE_T2V ? "video_minimax_h3_t2v.json" : "video_minimax_h3_i2v.json";
    const template = loadH3Template(templateName);
    const subgraph = (template.definitions?.subgraphs || []).find((item) => item.name === H3_WORKFLOW_SLOTS.fl2va.subgraph);
    if (!subgraph) throw new Error(`Official MiniMax H3 template is missing subgraph ${H3_WORKFLOW_SLOTS.fl2va.subgraph}`);
    const { prompt, warnings } = graphToApi({ nodes: subgraph.nodes, links: normalizeTemplateLinks(subgraph.links || []) }, objectInfo);
    const h3 = requireNode(prompt, H3_WORKFLOW_SLOTS.fl2va.nodes.h3, H3_NODE_CLASSES.fl2va);
    removeH3ExternalInputs(h3);
    if (modeInfo.needsFirst) {
      if (!firstFrameComfyFile) throw new Error(`${modeInfo.label} needs an approved first-frame guide.`);
      h3.inputs.first_frame = addLoadImage(prompt, "p316_h3_first_frame", firstFrameComfyFile);
    }
    if (modeInfo.needsLast) {
      if (!lastFrameComfyFile) throw new Error(`${modeInfo.label} needs an approved last-frame guide.`);
      h3.inputs.last_frame = addLoadImage(prompt, "p316_h3_last_frame", lastFrameComfyFile);
    }
    addImageReferencesToH3Node(prompt, h3, refValidation.references, { startId: h3AnchorImageCount(modeInfo) + 1 });
    patchCommonH3Nodes(prompt, objectInfo, {
      family,
      promptText,
      width,
      height,
      frames,
      seed,
      filenamePrefix,
      refImageSize
    });
    validateApiPrompt(prompt, objectInfo);
    return { prompt, warnings, sourceTemplate: templateName, family, semanticSlots: H3_WORKFLOW_SLOTS.fl2va };
  }

  const refValidation = validateH3ReferenceManifest(references);
  if (!refValidation.ok) throw new Error(refValidation.errors.join(" "));
  const template = loadH3Template("video_minimax_h3_r2v.json");
  const { prompt, warnings } = graphToApi({ nodes: template.nodes || [], links: normalizeTemplateLinks(template.links || []) }, objectInfo);
  const h3 = requireNode(prompt, H3_WORKFLOW_SLOTS.ref2va.nodes.h3, H3_NODE_CLASSES.ref2va);
  for (const inputName of Object.keys(h3.inputs)) {
    if (/^ref_(images|videos|video_audios|audios)\./.test(inputName)) delete h3.inputs[inputName];
  }
  let extraId = 9000;
  addImageReferencesToH3Node(prompt, h3, refValidation.references);
  for (const ref of refValidation.references) {
    if (ref.type === "image") {
      continue;
    }
    if (!ref.comfyFile) throw new Error(`${ref.tag} has no staged ComfyUI file`);
    if (ref.type === "audio") {
      const id = String(extraId++);
      prompt[id] = { class_type: H3_NODE_CLASSES.loadAudio, inputs: { audio: ref.comfyFile } };
      h3.inputs[`ref_audios.ref_audio_${ref.ordinal - 1}`] = [id, 0];
    } else if (ref.type === "video") {
      const id = String(extraId++);
      prompt[id] = {
        class_type: H3_NODE_CLASSES.loadVideoFrames,
        inputs: {
          video: ref.comfyFile,
          force_rate: H3_FPS,
          custom_width: 0,
          custom_height: 0,
          frame_load_cap: Math.max(1, Math.round((ref.durationSec || H3_MIN_SECONDS) * H3_FPS)),
          skip_first_frames: 0,
          select_every_nth: 1
        }
      };
      h3.inputs[`ref_videos.ref_video_${ref.ordinal - 1}`] = [id, 0];
      if (ref.includeAudio) h3.inputs[`ref_video_audios.ref_video_audio_${ref.ordinal - 1}`] = [id, 2];
    }
  }
  patchCommonH3Nodes(prompt, objectInfo, {
    family,
    promptText,
    width,
    height,
    frames,
    seed,
    filenamePrefix,
    refImageSize
  });
  validateApiPrompt(prompt, objectInfo);
  return { prompt, warnings, sourceTemplate: "video_minimax_h3_r2v.json", family, semanticSlots: H3_WORKFLOW_SLOTS.ref2va };
}

export async function uploadH3ClipGuides(project, clip) {
  const subfolder = `premiere316/${project.slug}/h3`;
  const uploaded = new Map();
  const guides = [];
  for (const guide of clip.guides || []) {
    if (!guide.file) continue;
    const disk = path.join(project.paths?.frames || path.join(PACKAGE_ROOT, "projects", project.slug, "media", "frames"), path.basename(guide.file));
    if (!fs.existsSync(disk)) continue;
    let comfyFile = uploaded.get(guide.file);
    if (!comfyFile) {
      comfyFile = await uploadImage(disk, subfolder);
      uploaded.set(guide.file, comfyFile);
    }
    guides.push({ ...guide, comfyFile });
  }
  return guides;
}

export function h3GuideForMode(guides = [], mode = H3_MODE_FIRST, totalFrames = 1) {
  const first = guides.find((guide) => guide.role === "first" || Number(guide.frame) === 0) || guides.slice().sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0))[0] || null;
  const last = guides.find((guide) => guide.role === "last" || Number(guide.frame) >= totalFrames - 1) || guides.slice().sort((a, b) => Number(b.frame || 0) - Number(a.frame || 0))[0] || null;
  const modeInfo = H3_MODES[mode] || H3_MODES[H3_MODE_FIRST];
  if (modeInfo.needsFirst && !first?.comfyFile) throw new Error(`${modeInfo.label} needs an approved first-frame guide.`);
  if (modeInfo.needsLast && !last?.comfyFile) throw new Error(`${modeInfo.label} needs an approved last-frame guide.`);
  return { first, last };
}

export function randomH3Seed(seed) {
  if (seed != null && seed !== "" && Number.isFinite(Number(seed))) return Math.max(0, Math.floor(Number(seed)));
  return crypto.randomInt(1, 2 ** 31 - 1);
}

export async function h3Diagnostics({ force = false } = {}) {
  if (!force && h3DiagnosticsCache && Date.now() - h3DiagnosticsAt < DIAGNOSTICS_CACHE_MS) return h3DiagnosticsCache;
  const result = {
    provider: H3_PROVIDER_ID,
    displayName: H3_DISPLAY_NAME,
    comfyUrl: COMFY_URL,
    reachable: false,
    comfyVersion: null,
    versionOk: false,
    ffmpeg: false,
    nativeNodes: {},
    models: {},
    templates: validateOfficialTemplates(),
    dimensions: {
      full16x9: h3Dimensions({ aspect: "16:9", quality: "full" }),
      full239: h3Dimensions({ aspect: "2.39:1", quality: "full" }),
      preview16x9: h3Dimensions({ aspect: "16:9", quality: "preview" })
    },
    modes: [],
    fl2vaReady: false,
    ref2vaReady: false,
    ready: false,
    actionableErrors: [],
    warnings: []
  };
  try {
    const [stats, ffmpeg, objectInfo] = await Promise.all([
      comfySystemStats(),
      ffmpegAvailable(),
      getObjectInfo(force)
    ]);
    result.reachable = true;
    result.comfyVersion = stats?.system?.comfyui_version || null;
    result.versionOk = compareVersions(result.comfyVersion, "0.30.0") >= 0;
    result.ffmpeg = Boolean(ffmpeg);
    for (const classType of Object.values(H3_NODE_CLASSES)) result.nativeNodes[classType] = Boolean(objectInfo?.[classType]);
    result.nativeNodes[H3_NODE_CLASSES.sigmaShift] = Boolean(objectInfo?.[H3_NODE_CLASSES.sigmaShift]);
    result.models = discoverH3Models(objectInfo);

    if (!result.versionOk) result.actionableErrors.push(`Update ComfyUI to 0.30.0 or newer; the running backend is ${result.comfyVersion || "unknown"}.`);
    const flMissing = [
      H3_NODE_CLASSES.fl2va,
      H3_NODE_CLASSES.latent,
      H3_NODE_CLASSES.audioDecode,
      H3_NODE_CLASSES.createVideo,
      H3_NODE_CLASSES.saveVideo,
      H3_NODE_CLASSES.unet,
      H3_NODE_CLASSES.clip,
      H3_NODE_CLASSES.vae
    ].filter((classType) => !result.nativeNodes[classType]);
    const refMissing = [H3_NODE_CLASSES.ref2va].filter((classType) => !result.nativeNodes[classType]);
    if (flMissing.length) result.actionableErrors.push(`Native FL2VA H3 nodes missing: ${flMissing.join(", ")}.`);
    if (!detectClipType(objectInfo)) result.actionableErrors.push("CLIPLoader does not expose the MiniMax type option yet; this arrives with native H3 support.");
    const flModelsMissing = ["fl2va", "textEncoder", "videoVae", "audioVae"].filter((key) => !result.models[key]?.found);
    if (flModelsMissing.length) result.actionableErrors.push(`FL2VA model files missing from scanned model paths: ${flModelsMissing.map((key) => result.models[key]?.filename || key).join(", ")}.`);
    if (!result.models.ref2va?.found) result.warnings.push(`Ref2VA model is not installed yet: ${H3_MODEL_FILES.ref2va.filename}.`);
    if (refMissing.length) result.warnings.push(`Native Ref2VA H3 node missing: ${refMissing.join(", ")}.`);
    if (!result.ffmpeg) result.actionableErrors.push("FFmpeg is unavailable; H3 output cannot be conformed/stored reliably.");
    if (!result.templates.ok) result.actionableErrors.push(`Official MiniMax H3 templates are invalid or missing: ${result.templates.errors.join("; ")}`);

    result.fl2vaReady = Boolean(result.reachable && result.versionOk && !flMissing.length && detectClipType(objectInfo) && !flModelsMissing.length && result.templates.ok && result.ffmpeg);
    result.ref2vaReady = Boolean(result.fl2vaReady && !refMissing.length && result.models.ref2va?.found);
    result.ready = result.fl2vaReady || result.ref2vaReady;
    result.modes = Object.values(H3_MODES).map((mode) => {
      const enabled = mode.family === "ref2va" ? result.ref2vaReady : result.fl2vaReady;
      const reason = enabled ? null : mode.family === "ref2va"
        ? "Requires ComfyUI 0.30+ native Ref2VA node and minimax_h3_ref2va_pruned_int8_convrot.safetensors."
        : "Requires ComfyUI 0.30+ native FL2VA H3 nodes plus the FL2VA/Qwen/VAE files.";
      return { ...mode, enabled, disabledReason: reason };
    });
  } catch (error) {
    result.actionableErrors.push(`ComfyUI diagnostics failed: ${String(error.message || error)}`);
    try { result.ffmpeg = await ffmpegAvailable(); } catch {}
  }
  h3DiagnosticsCache = result;
  h3DiagnosticsAt = Date.now();
  return result;
}
