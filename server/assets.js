import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  collectOutputFiles,
  downloadOutput,
  getObjectInfo,
  runPrompt,
  uploadImage
} from "./comfy.js";
import { resolveStillsReferences } from "./asset-reference-resolver.js";
import { probeMedia } from "./ffmpeg.js";
import { resolveProjectMediaFile } from "./media-path.js";
import { loadProject, mediaDir, registerFrame, saveProject, skipApproval } from "./projects.js";
import { PROJECTS_DIR, projectDir } from "./paths.js";
import {
  STYLE_FLUX_CLIP,
  STYLE_FLUX_MODEL,
  STYLE_FLUX_VAE,
  STYLE_LOCK_PROMPT,
  STYLE_LOCK_WORKFLOWS,
  STYLE_UPSCALER,
  applyStyleLockToAsset,
  compileStyleLockWorkflow,
  isAuthoritativeStyleLockAsset,
  isStyleLockWorkflow
} from "./style-lock.js";

// Keep the stable workflow IDs, but compile and validate against the models
// selected by the current reference-conditioned Storyboard graph and exposed
// by the active shared ComfyUI runtime.
const KREA_MODEL = "KREA 2\\krea2_turbo_bf16.safetensors";
const KREA_CLIP = "qwen3vl_4b_bf16.safetensors";
const KREA_VAE = "qwen_image_vae.safetensors";
const KREA_IDENTITY_EDIT_LORA = "krea2\\krea2_identity_edit_v1_2.safetensors";
export const KREA2_IDENTITY_EDIT_WORKFLOW_ID = "krea2-identity-edit-v1-2";
const KREA2_IDENTITY_EDIT_MAX_PIXELS = 1024 * 1024;
// The live EmptySD3LatentImage schema uses min=16 and step=16.
const KREA2_IDENTITY_EDIT_DIMENSION_STEP = 16;
const FLUX_MODEL = "flux2\\flux-2-klein-9b-fp8mixed.safetensors";
const FLUX_CLIP = "qwen_3_8b_fp8mixed.safetensors";
const FLUX_VAE = "flux2-vae.safetensors";
const ACE_MODEL = "acestep\\acestep_v1.5_xl_turbo_bf16.safetensors";
const ACE_CLIP_SMALL = "qwen_0.6b_ace15.safetensors";
const ACE_CLIP_LARGE = "qwen_4b_ace15.safetensors";
const ACE_VAE = "ace_1.5_vae.safetensors";

export const ASSET_WORKFLOWS = [
  ...STYLE_LOCK_WORKFLOWS,
  {
    id: "krea2-character-ingredients-fp8",
    label: "Krea 2 Character Ingredients · BF16",
    mediaType: "image",
    model: "Krea 2 Turbo BF16 + Qwen3-VL 4B BF16",
    purpose: "Identity-locked character reference sheets with face, profile, full-body, costume, hair, and rear-head coverage.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [KREA_MODEL, KREA_CLIP, KREA_VAE]
  },
  {
    id: "krea2-cinematic-still-fp8",
    label: "Krea 2 Cinematic Still · BF16",
    mediaType: "image",
    model: "Krea 2 Turbo BF16 + Qwen3-VL 4B BF16",
    purpose: "Locations, props, VFX references, continuity states, and first/middle/last guide images.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [KREA_MODEL, KREA_CLIP, KREA_VAE]
  },
  {
    id: "flux2-klein-9b-prop-fp8",
    label: "Flux 2 Klein 9B · Prop Studio",
    mediaType: "image",
    model: "Flux 2 Klein 9B FP8 Distilled + Qwen 3 8B FP8",
    purpose: "Clean artifact, weapon, prop, and material reference plates with precise construction details.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "EmptyFlux2LatentImage", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [FLUX_MODEL, FLUX_CLIP, FLUX_VAE]
  },
  {
    id: KREA2_IDENTITY_EDIT_WORKFLOW_ID,
    label: "Krea 2 Identity Edit v1.2",
    mediaType: "image",
    model: "Krea 2 Turbo BF16 + Qwen3-VL 4B BF16 + Identity Edit LoRA v1.2",
    purpose: "Identity-preserving edit and touch-up of an approved still. Not from-scratch generation.",
    requiredNodes: [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "LoraLoaderModelOnly",
      "LoadImage",
      "VAEEncode",
      "EmptySD3LatentImage",
      "Krea2EditGroundedEncode",
      "Krea2EditModelPatch",
      "KSampler",
      "VAEDecode",
      "SaveImage"
    ],
    requiredModels: [KREA_MODEL, KREA_CLIP, KREA_VAE, KREA_IDENTITY_EDIT_LORA]
  },
  {
    id: "qwen3-tts-voice-design-1.7b",
    label: "Qwen3-TTS VoiceDesign · 1.7B",
    mediaType: "audio",
    model: "Qwen3-TTS 12Hz 1.7B VoiceDesign",
    purpose: "Standalone local character casting in Create Sound, with native WAV masters and IndexTTS handoff.",
    requiredNodes: [],
    requiredModels: ["Qwen3-TTS-12Hz-1.7B-VoiceDesign"]
  },
  {
    id: "ace-step-1.5-xl-turbo",
    label: "ACE-Step 1.5 XL Turbo",
    mediaType: "audio",
    model: "ACE-Step 1.5 XL Turbo BF16 + Qwen 4B/0.6B",
    purpose: "Project score themes and musical cue stems.",
    requiredNodes: ["DualCLIPLoader", "TextEncodeAceStepAudio1.5", "EmptyAceStep1.5LatentAudio", "VAEDecodeAudio", "SaveAudioMP3"],
    requiredModels: [ACE_MODEL, ACE_CLIP_SMALL, ACE_CLIP_LARGE, ACE_VAE]
  },
  {
    id: "ltx-2.3-native-audio",
    label: "LTX 2.3 Native Shot Audio",
    mediaType: "instruction",
    model: "LTX-2.3 Director FP8",
    purpose: "Diegetic ambience, foley, impacts, and vocal texture generated in sync with the final video shot.",
    requiredNodes: [],
    requiredModels: []
  },
  {
    id: "premiere316-title-card",
    label: "Premiere316 Deterministic Title Card",
    mediaType: "graphic",
    model: "Deterministic SVG compositor",
    purpose: "Exact typography without diffusion-model spelling artifacts.",
    requiredNodes: [],
    requiredModels: []
  }
];

export const ASSET_CATEGORY_LABELS = {
  character: "Characters",
  location: "Locations",
  artifact: "Props & Artifacts",
  atmosphere: "Atmosphere & VFX",
  "guide-frame": "Guide Frames",
  wardrobe: "Wardrobe",
  extra: "Crowds & Creatures",
  voice: "Voices",
  sound: "Sound Design",
  music: "Music",
  graphic: "Graphics"
};

const CATEGORY_LABELS = ASSET_CATEGORY_LABELS;

const CATEGORY_MEDIA_TYPES = {
  character: "image",
  location: "image",
  artifact: "image",
  atmosphere: "image",
  "guide-frame": "image",
  wardrobe: "image",
  extra: "image",
  voice: "audio",
  sound: "instruction",
  music: "audio",
  graphic: "graphic"
};

function promptHeaderSubject(asset) {
  const id = String(asset?.id || "");
  const rawName = String(asset?.name || asset?.id || "Production Asset")
    .replace(/\s+/g, " ")
    .trim();

  // The screenplay's internal role label is "JESUS - The Harrower", but the
  // copyable production prompts should name the subject plainly and
  // consistently for every model/provider.
  if (/jesus-the-harrower/i.test(id) || /^jesus\s*-\s*the harrower$/i.test(rawName)) {
    return "JESUS CHRIST";
  }
  if (/^ward-jesus-/i.test(id)) {
    const garment = rawName.replace(/^jesus\s+/i, "").trim();
    return garment ? `JESUS CHRIST — ${garment}` : "JESUS CHRIST";
  }
  return rawName;
}

function promptHeaderSummary(asset) {
  const category = String(asset?.category || "asset").toLowerCase();
  const variant = String(asset?.variant || "Production Reference")
    .replace(/\s+/g, " ")
    .trim();

  if (category === "character") {
    if (/close[- ]?up/i.test(variant)) return `${variant}: facial identity, expression, and cinematic lighting reference`;
    if (/action|pose/i.test(variant)) return `${variant}: heroic body language, wardrobe, anatomy, and motion reference`;
    return `${variant}: four-view identity, anatomy, costume, and continuity reference`;
  }
  if (category === "location") return `${variant}: cinematic environment, scale, lighting, materials, and continuity`;
  if (category === "artifact") return `${variant}: hero prop design, construction, materials, scale, and continuity`;
  if (category === "wardrobe") return `${variant}: costume construction, materials, fit, damage, and continuity`;
  if (category === "atmosphere") return `${variant}: cinematic VFX, particles, light, transformation, and motion reference`;
  if (category === "guide-frame") return `${variant}: cinematic composition, story state, and shot-continuity guide`;
  if (category === "extra") return `${variant}: crowd or creature design, scale, variation, and continuity`;
  if (category === "voice") return `${variant}: performance, tone, pacing, diction, and vocal continuity`;
  if (category === "sound") return `${variant}: diegetic sound design, dynamics, spatial scale, and texture`;
  if (category === "music") return `${variant}: musical arc, orchestration, tempo, dynamics, and mix direction`;
  if (category === "graphic") return `${variant}: final title card with exact deterministic typography`;
  return `${variant}: production generation direction and continuity reference`;
}

export function assetPromptHeader(asset) {
  const subject = promptHeaderSubject(asset);
  const summary = promptHeaderSummary(asset);
  return `${subject} — ${summary}.`.replace(/\.{2,}$/, ".").toLocaleUpperCase("en-US");
}

export function withAssetPromptHeader(asset, prompt) {
  const nextHeader = assetPromptHeader(asset);
  const previousHeader = String(asset?.promptHeader || "").trim();
  let body = String(prompt || "").replace(/\r\n/g, "\n").trim();
  const firstBreak = body.indexOf("\n");
  const firstLine = (firstBreak >= 0 ? body.slice(0, firstBreak) : body).trim();

  // Idempotently replace a prior managed header instead of stacking another
  // one every time a manifest is refreshed or an enhanced prompt is applied.
  if (firstLine === nextHeader || (previousHeader && firstLine === previousHeader)) {
    body = firstBreak >= 0 ? body.slice(firstBreak + 1).trimStart() : "";
  }
  asset.promptHeader = nextHeader;
  return body ? `${nextHeader}\n\n${body}` : nextHeader;
}

const PRODUCTION_VOICE_DESIGN_PROMPTS = {
  "voice-jesus-the-harrower-voice-design": "A male Mediterranean baritone in his early thirties: warm, grounded, compassionate, and unmistakably authoritative. Subtle Levantine inflection in clear English; open vowels, precise consonants, and calm deliberate pacing. The voice is fully human with a restrained sacred resonance—quiet commands remain immovable, while proclamations expand into supported power without shouting. Emotional center: infinite compassion joined to absolute certainty. Natural breath, intimate dry center, only a faint stone-chamber halo. Never theatrical, elderly, breathy-new-age, cartoonish, or a celebrity imitation.",
  "voice-adam-first-man-freed-voice-design": "An ancient male bass-baritone worn thin by immeasurable waiting: weathered, dust-dry, fragile at the edges, yet carrying deep residual strength. Clear English with a soft ancient Near-Eastern color, elongated open vowels, and slow reverent pacing. Begin in barely voiced recognition, with audible breath and tears, then allow a small supported swell of grateful certainty. Intimate and human, never a generic old-man caricature, booming narrator, demon, or melodramatic sob. Natural close-mic grain with a restrained cavern halo.",
  "voice-guardian-leader-hells-champion-voice-design": "A single male-coded supernatural jailer with an extremely deep, grinding bass. The timbre suggests basalt scraping against cold iron: dry, massive, deliberate, and ancient beyond human age, while every English word remains intelligible. Hard consonants land like decrees; dark vowels move slowly. Baseline emotion is absolute territorial command and hatred, with a barely perceptible fracture of dawning fear. Controlled low power, not screaming. No comedy, death-metal rasp, wet monster noises, robotic processing, or theatrical villain accent.",
  "voice-lowell-bryan-style-chorus-divine-narration-voice-design": "A reverent mixed sacred narration chorus with a warm low male lead supported by blended adult voices. Clear English diction, measured biblical cadence, controlled vibrato, and a gradual arc from breath-soft awe to luminous triumphant authority. The ensemble should feel unified and cinematic rather than crowded: warm bass and alto foundation, restrained tenor brightness, natural choral depth, and no dominant celebrity identity. Sacred and emotionally sincere, never operatic excess, pop choir, gospel riffing, trailer shouting, or synthetic stacking.",
  "voice-eve-voice-design": "An ancient female contralto: physically aged, tender, and emotionally luminous. Warm low register with a fine weathered grain, clear English, soft ancient Near-Eastern color, and slow reverent phrasing. Her first words tremble with disbelief and centuries of grief, then settle into relieved hope and maternal strength. Tears may gently catch the voice without obscuring diction. Human, intimate, and dignified—never frail caricature, modern conversational brightness, breathy fantasy maiden, melodramatic sobbing, or celebrity imitation.",
  "voice-low-voice-voice-design": "One timeless male baritone narrator with warm low resonance, clear English diction, and measured ceremonial pacing. Begin intimate and breath-close, then expand naturally into authoritative sacred proclamation without shouting. The tone carries ancient certainty, reverence, and restrained triumph; vowels are open, consonants deliberate, and pauses meaningful. Keep a clean human center with a very light stone-space bloom. Not Jesus' character voice, not a choir, not a demon, not an elderly whisper, not a modern trailer announcer, and not a celebrity imitation.",
  "voice-trapped-souls-voice-design": "A naturally layered ensemble of exhausted adult human voices—mixed genders and ages—with clear English emerging from centuries of whispered despair. Dry, fragile, breath-worn timbres begin scattered and distant, then gather into urgent astonished hope. Entries should overlap organically rather than move in perfect choir unison; near voices remain intelligible while farther voices create restrained cavern depth. Human prisoners only: no demonic growls, polished choir, electronic doubling, modern crowd chant, hysterical screaming, or added sound effects.",
  "voice-voice-of-hell-voice-design": "A single nonhuman, masculine-coded voice representing the realm of Hell itself: immensely ancient, subterranean, and fully intelligible. A stable deep speaking core carries dark subharmonic weight, stone-cavern resonance, and a faint iron edge on consonants. Emotion is rage fused with irreversible defeat—vast and terrifying, but controlled enough to preserve every word. Slow, heavy phrasing with a hard onset and lingering low resonance. One identity, not a crowd. No cartoon demon, video-game boss, death-metal scream, robotic filter, wet growl, comedy, or celebrity imitation."
};

function trimVoicePrompt(text, limit) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (source.length <= limit) return source;
  const clipped = source.slice(0, Math.max(0, limit - 1));
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "), clipped.lastIndexOf(", "));
  return `${(boundary > limit * 0.65 ? clipped.slice(0, boundary + 1) : clipped).trim()}…`;
}

export function normalizeVoiceDesignPrompt(asset, prompt = asset?.prompt) {
  const original = String(prompt || "").replace(/\r\n/g, "\n").trim();
  if (asset?.category !== "voice") return original;
  const promptLimit = 4_000;
  const polluted = original.length > promptLimit || /AUDIO STYLE BRIDGE|AUTHORITATIVE AUDIO PROMPT/i.test(original);
  if (!polluted) {
    const current = withAssetPromptHeader(asset, original);
    return current.length <= promptLimit ? current : trimVoicePrompt(current, promptLimit);
  }
  if (!asset.voicePromptArchive) asset.voicePromptArchive = original;
  let body = PRODUCTION_VOICE_DESIGN_PROMPTS[asset.id];
  if (!body) {
    const authoritative = original.split(/AUTHORITATIVE AUDIO PROMPT\s*-+/i).pop() || original;
    body = trimVoicePrompt(authoritative.replace(/^.*?VOICE DESIGN[^.]*\.\s*/i, ""), 3_600);
  }
  asset.voiceDesignPlatform = "Qwen3-TTS VoiceDesign";
  asset.voiceDesignLimit = promptLimit;
  const header = assetPromptHeader(asset);
  asset.promptHeader = header;
  asset.prompt = `${header}\n\n${trimVoicePrompt(body, Math.max(0, promptLimit - header.length - 2))}`;
  return asset.prompt;
}

function slugify(value) {
  return String(value || "asset")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "asset";
}

function cleanHeading(value) {
  return String(value || "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+ASSETS?$/i, "")
    .trim();
}

function categoryOf(heading) {
  const text = cleanHeading(heading).toLowerCase();
  if (text.includes("character")) return "character";
  if (text.includes("location")) return "location";
  if (text.includes("artifact") || text.includes("prop")) return "artifact";
  if (text.includes("atmospher") || text.includes("vfx")) return "atmosphere";
  if (text.includes("first") || text.includes("last") || text.includes("frame")) return "guide-frame";
  return "atmosphere";
}

function assetId(category, name, variant = "primary") {
  return `${category}-${slugify(name)}-${slugify(variant)}`;
}

export function assetMediaType(category) {
  return CATEGORY_MEDIA_TYPES[category] || null;
}

export function defaultAssetWorkflow(category, variant, name, id) {
  if (CATEGORY_MEDIA_TYPES[category] === "image") {
    return visualWorkflow(category, variant, name, id);
  }
  if (category === "voice") return "qwen3-tts-voice-design-1.7b";
  if (category === "music") return "ace-step-1.5-xl-turbo";
  if (category === "sound") return "ltx-2.3-native-audio";
  if (category === "graphic") return "premiere316-title-card";
  return "krea2-cinematic-still-fp8";
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

export function createDirectorAsset(input = {}, existingItems = []) {
  const category = String(input.category || "character").trim();
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) throw new Error(`Unknown asset category: ${category}`);
  const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!name) throw new Error("Asset name is required");
  const variant = String(input.variant || "Production Reference").replace(/\s+/g, " ").trim().slice(0, 120) || "Production Reference";
  let id = assetId(category, name, variant);
  const ids = new Set(existingItems.map((item) => item.id));
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${assetId(category, name, variant)}-${suffix}`;
  const requestedWorkflow = String(input.workflowId || "").trim();
  if (requestedWorkflow && !ASSET_WORKFLOWS.some((workflow) => workflow.id === requestedWorkflow)) {
    throw new Error(`Unknown asset workflow: ${requestedWorkflow}`);
  }
  const asset = {
    id,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    name,
    variant,
    mediaType: CATEGORY_MEDIA_TYPES[category],
    prompt: String(input.prompt || "").trim(),
    sourcePrompt: String(input.prompt || "").trim(),
    sampleText: category === "voice" ? String(input.sampleText || "").trim() : undefined,
    sourceSection: "Director-created asset",
    status: "planned",
    reviewState: "director-created",
    workflowId: requestedWorkflow || defaultAssetWorkflow(category, variant, name, id),
    workflowExplicit: Boolean(requestedWorkflow),
    dependencies: stringList(input.dependencies),
    continuity: stringList(input.continuity),
    durationSec: input.durationSec == null || input.durationSec === "" ? undefined : Number(input.durationSec),
    bpm: input.bpm == null || input.bpm === "" ? undefined : Number(input.bpm),
    versions: [],
    activeVersion: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!isIdentityEditWorkflow(asset.workflowId)) {
    asset.prompt = withAssetPromptHeader(asset, asset.prompt);
    applyStyleLockToAsset(asset);
  }
  return asset;
}

export function updateAssetManifestCounts(assets) {
  const items = assets?.items || [];
  assets.counts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  assets.total = items.length;
  assets.generatedAt = new Date().toISOString();
  return assets;
}

function isIdentityEditWorkflow(workflowId) {
  return workflowId === KREA2_IDENTITY_EDIT_WORKFLOW_ID;
}

export function visualEditWorkflow() {
  return KREA2_IDENTITY_EDIT_WORKFLOW_ID;
}

export function visualWorkflow(category, variant, name = "", id = "") {
  if (category === "artifact") return "flux2-klein-9b-prop-fp8";
  if (["character", "wardrobe"].includes(category) && /appearance|primary|identity|reference/i.test(variant)) {
    return "krea2-character-ingredients-fp8";
  }
  return "krea2-cinematic-still-fp8";
}

function identityEditError(message, code = "IDENTITY_EDIT_SOURCE_INVALID") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identityEditSourcePayload(source) {
  const fileBytes = Number(source?.fileBytes);
  return {
    order: Number(source?.order),
    assetId: String(source?.assetId || ""),
    assetVersion: Number(source?.assetVersion),
    type: String(source?.type || ""),
    role: String(source?.role || ""),
    sourceFile: String(source?.sourceFile || "").replace(/\\/g, "/"),
    fileSha256: String(source?.fileSha256 || "").toLowerCase(),
    fileBytes: Number.isSafeInteger(fileBytes) && fileBytes >= 0 ? fileBytes : null,
    generationFingerprint: source?.generationFingerprint || null,
    versionFingerprint: source?.versionFingerprint || null,
    approvalFingerprint: source?.approvalFingerprint || null
  };
}

export function identityEditSourceFingerprint(source) {
  return crypto.createHash("sha256").update(JSON.stringify(identityEditSourcePayload(source))).digest("hex");
}

function identityEditRemoteSegment(value, fallback) {
  const raw = String(value || fallback || "item").trim();
  const readable = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || String(fallback || "item");
  const suffix = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${readable}-${suffix}`;
}

function identityEditUploadLocation(project, targetAsset, source) {
  const extension = path.posix.extname(String(source.sourceFile || "")).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw identityEditError("Krea 2 Identity Edit source must be PNG, JPEG, or WebP", "IDENTITY_EDIT_SOURCE_TYPE_UNSUPPORTED");
  }
  const projectSlug = identityEditRemoteSegment(project?.slug, "project");
  const targetAssetId = identityEditRemoteSegment(targetAsset?.id, "asset");
  const sourceAssetId = identityEditRemoteSegment(source.assetId, "source");
  const sourceVersion = Number(source.assetVersion);
  const subfolder = `premiere316_identity_edit/${projectSlug}/${targetAssetId}/${sourceAssetId}-v${sourceVersion}`;
  const fileName = `${String(source.fileSha256).toLowerCase()}${extension}`;
  return { subfolder, fileName, comfyFile: `${subfolder}/${fileName}` };
}

export function identityEditTargetDimensions(sourceWidth, sourceHeight, {
  maxPixels = KREA2_IDENTITY_EDIT_MAX_PIXELS,
  step = KREA2_IDENTITY_EDIT_DIMENSION_STEP
} = {}) {
  const width = Math.floor(Number(sourceWidth));
  const height = Math.floor(Number(sourceHeight));
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw identityEditError("Krea 2 Identity Edit could not determine the source image dimensions", "IDENTITY_EDIT_SOURCE_DIMENSIONS_MISSING");
  }
  const quantum = Math.max(1, Math.floor(Number(step) || KREA2_IDENTITY_EDIT_DIMENSION_STEP));
  if (width < quantum || height < quantum) {
    throw identityEditError("Krea 2 Identity Edit source is smaller than the runtime's minimum latent dimension", "IDENTITY_EDIT_SOURCE_DIMENSIONS_INVALID");
  }
  const pixelLimit = Math.max(quantum * quantum, Math.floor(Number(maxPixels) || KREA2_IDENTITY_EDIT_MAX_PIXELS));
  let scale = Math.min(1, Math.sqrt(pixelLimit / (width * height)));
  let targetWidth = 0;
  let targetHeight = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    targetWidth = Math.max(quantum, Math.floor((width * scale) / quantum) * quantum);
    targetHeight = Math.max(quantum, Math.floor((height * scale) / quantum) * quantum);
    if (targetWidth * targetHeight <= pixelLimit) break;
    scale *= 0.995;
  }
  if (targetWidth * targetHeight > pixelLimit) {
    throw identityEditError("Krea 2 Identity Edit could not fit the source aspect into its pixel budget", "IDENTITY_EDIT_TARGET_DIMENSIONS_INVALID");
  }
  return { sourceWidth: width, sourceHeight: height, width: targetWidth, height: targetHeight };
}

function identityEditProjectsRoot(project) {
  const override = typeof project?.projectsRoot === "string" ? project.projectsRoot.trim() : "";
  return override || PROJECTS_DIR;
}

function identityEditSourceDiskPath(project, source) {
  const projectsRoot = identityEditProjectsRoot(project);
  const relative = String(source?.sourceFile || "").replace(/\\/g, "/");
  const diskPath = resolveProjectMediaFile(projectsRoot, String(project?.slug || ""), "assets", relative);
  if (!diskPath || !fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    throw identityEditError("Krea 2 Identity Edit source image is missing", "IDENTITY_EDIT_SOURCE_MISSING");
  }
  const assetRoot = path.resolve(projectsRoot, String(project.slug), "media", "assets");
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(assetRoot);
    realFile = fs.realpathSync(diskPath);
  } catch {
    throw identityEditError("Krea 2 Identity Edit source image could not be resolved", "IDENTITY_EDIT_SOURCE_PATH_INVALID");
  }
  const inside = path.relative(realRoot, realFile);
  if (!inside || path.isAbsolute(inside) || inside === ".." || inside.startsWith(`..${path.sep}`)) {
    throw identityEditError("Krea 2 Identity Edit source image escapes the project asset directory", "IDENTITY_EDIT_SOURCE_PATH_INVALID");
  }
  const actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(realFile)).digest("hex");
  if (actualSha256 !== String(source.fileSha256 || "").toLowerCase()) {
    throw identityEditError("Krea 2 Identity Edit source SHA-256 changed", "IDENTITY_EDIT_SOURCE_HASH_MISMATCH");
  }
  return realFile;
}

function identityEditManifestRelative(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^media\/assets\//i, "");
  if (!raw || raw.includes("\0") || path.posix.isAbsolute(raw) || /^[a-z]:/i.test(raw)) return "";
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return "";
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return normalized;
}

function identityEditVersionSourceFile(version) {
  const declared = version?.file || (Array.isArray(version?.files) ? version.files[0] : "") || "";
  return identityEditManifestRelative(declared);
}

function requireIdentityEditSourceProvenance(source) {
  if (
    source.order !== 1
    || !source.assetId
    || !Number.isSafeInteger(source.assetVersion)
    || source.assetVersion < 1
    || source.type !== "image"
    || source.role !== "identity"
    || !identityEditManifestRelative(source.sourceFile)
    || !/^[a-f0-9]{64}$/.test(source.fileSha256)
  ) {
    throw identityEditError("Krea 2 Identity Edit source snapshot is malformed", "IDENTITY_EDIT_SOURCE_INVALID");
  }
  for (const [field, value] of [
    ["generation", source.generationFingerprint],
    ["version", source.versionFingerprint],
    ["approval", source.approvalFingerprint]
  ]) {
    if (!/^[a-f0-9]{64}$/i.test(String(value || ""))) {
      throw identityEditError(`Krea 2 Identity Edit source is missing its approved ${field} fingerprint`, "IDENTITY_EDIT_SOURCE_PROVENANCE_MISSING");
    }
  }
}

function identityEditActiveVersion(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function identityEditSourceAsset(project, source) {
  const sourceAsset = (project?.assets?.items || []).find((item) => String(item?.id || "") === source.assetId);
  if (!sourceAsset) throw identityEditError("Krea 2 Identity Edit source asset is missing", "IDENTITY_EDIT_SOURCE_MISSING");
  if (["deprecated", "deleted", "cancelled", "refused"].includes(String(sourceAsset.status || "").trim().toLowerCase())) {
    throw identityEditError("Krea 2 Identity Edit source asset is no longer available", "IDENTITY_EDIT_SOURCE_MISSING");
  }
  if (identityEditActiveVersion(sourceAsset.activeVersion) !== source.assetVersion) {
    throw identityEditError("Krea 2 Identity Edit source active version changed", "IDENTITY_EDIT_SOURCE_VERSION_CHANGED");
  }
  return sourceAsset;
}

function revalidatePinnedIdentityEditSource(project, recipe) {
  const source = recipe.source;
  const sourceAsset = identityEditSourceAsset(project, source);
  const version = (sourceAsset.versions || []).find((candidate) => Number(candidate?.v) === source.assetVersion);
  if (!version) throw identityEditError("Krea 2 Identity Edit source version is missing", "IDENTITY_EDIT_SOURCE_VERSION_CHANGED");
  const sourceFile = identityEditVersionSourceFile(version);
  if (!sourceFile || sourceFile !== source.sourceFile) {
    throw identityEditError("Krea 2 Identity Edit source version file changed", "IDENTITY_EDIT_SOURCE_VERSION_CHANGED");
  }
  if (String(version.assetFingerprint || "") !== String(source.generationFingerprint || "")) {
    throw identityEditError("Krea 2 Identity Edit source generation fingerprint changed", "IDENTITY_EDIT_SOURCE_FINGERPRINT_MISMATCH");
  }
  if (assetVersionRecordFingerprint(sourceAsset, version) !== source.versionFingerprint) {
    throw identityEditError("Krea 2 Identity Edit source version fingerprint changed", "IDENTITY_EDIT_SOURCE_FINGERPRINT_MISMATCH");
  }
  const manifestHash = normalizedFileHashes(version).find((entry) => identityEditManifestRelative(entry.file) === sourceFile);
  if (manifestHash && (
    manifestHash.sha256 !== source.fileSha256
    || (source.fileBytes != null && Number(manifestHash.bytes) !== source.fileBytes)
  )) {
    throw identityEditError("Krea 2 Identity Edit source manifest hash changed", "IDENTITY_EDIT_SOURCE_HASH_MISMATCH");
  }
  return { sourceAsset, diskPath: identityEditSourceDiskPath(project, source) };
}

function normalizedIdentityEditRecipe(project, targetAsset, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw identityEditError("Krea 2 Identity Edit requires an exact approved source pin");
  }
  if (value.schema !== "premiere316.identity-edit-source.v1") {
    throw identityEditError("Krea 2 Identity Edit source recipe schema changed", "IDENTITY_EDIT_SOURCE_INVALID");
  }
  const source = identityEditSourcePayload(value.source);
  requireIdentityEditSourceProvenance(source);
  const sourceFingerprint = identityEditSourceFingerprint(source);
  if (sourceFingerprint !== value.sourceFingerprint) {
    throw identityEditError("Krea 2 Identity Edit source fingerprint changed", "IDENTITY_EDIT_SOURCE_FINGERPRINT_MISMATCH");
  }
  if (String(value.targetAssetId || "") !== String(targetAsset?.id || "")) {
    throw identityEditError("Krea 2 Identity Edit source pin belongs to another target asset", "IDENTITY_EDIT_TARGET_MISMATCH");
  }
  const dimensions = identityEditTargetDimensions(value.sourceWidth, value.sourceHeight);
  if (
    dimensions.sourceWidth !== Number(value.sourceWidth)
    || dimensions.sourceHeight !== Number(value.sourceHeight)
    || dimensions.width !== Number(value.width)
    || dimensions.height !== Number(value.height)
  ) {
    throw identityEditError("Krea 2 Identity Edit target dimensions changed", "IDENTITY_EDIT_TARGET_DIMENSIONS_INVALID");
  }
  if (Number(value.refBoost) !== 4 || Number(value.refBoostA) !== 1 || value.fitMode !== "fit") {
    throw identityEditError("Krea 2 Identity Edit model patch settings changed", "IDENTITY_EDIT_MODEL_SETTINGS_INVALID");
  }
  const upload = identityEditUploadLocation(project, targetAsset, source);
  if (
    upload.subfolder !== value.comfySubfolder
    || upload.fileName !== value.comfyFileName
    || upload.comfyFile !== value.comfyFile
  ) {
    throw identityEditError("Krea 2 Identity Edit upload destination changed", "IDENTITY_EDIT_UPLOAD_DESTINATION_INVALID");
  }
  return {
    schema: "premiere316.identity-edit-source.v1",
    targetAssetId: String(targetAsset.id),
    source,
    sourceFingerprint,
    ...dimensions,
    comfySubfolder: upload.subfolder,
    comfyFileName: upload.fileName,
    comfyFile: upload.comfyFile,
    refBoost: 4,
    refBoostA: 1,
    fitMode: "fit"
  };
}

export async function prepareIdentityEditSource(project, targetAsset, pin, { probeMediaFn = probeMedia } = {}) {
  if (!targetAsset?.id) throw identityEditError("Krea 2 Identity Edit target asset is required", "IDENTITY_EDIT_TARGET_MISSING");
  const [resolved] = resolveStillsReferences(project, [{
    ...(pin && typeof pin === "object" && !Array.isArray(pin) ? pin : {}),
    role: "identity",
    order: 1,
    type: "image"
  }]);
  const source = identityEditSourcePayload(resolved);
  requireIdentityEditSourceProvenance(source);
  const diskPath = identityEditSourceDiskPath(project, source);
  let media;
  try {
    media = await probeMediaFn(diskPath);
  } catch (error) {
    throw identityEditError(`Krea 2 Identity Edit could not inspect the source image: ${String(error?.message || error)}`, "IDENTITY_EDIT_SOURCE_DIMENSIONS_MISSING");
  }
  const dimensions = identityEditTargetDimensions(media?.video?.width, media?.video?.height);
  const upload = identityEditUploadLocation(project, targetAsset, source);
  const recipe = {
    schema: "premiere316.identity-edit-source.v1",
    targetAssetId: String(targetAsset.id),
    source,
    sourceFingerprint: identityEditSourceFingerprint(source),
    ...dimensions,
    comfySubfolder: upload.subfolder,
    comfyFileName: upload.fileName,
    comfyFile: upload.comfyFile,
    refBoost: 4,
    refBoostA: 1,
    fitMode: "fit"
  };
  return { recipe, diskPath };
}

export function revalidateIdentityEditSource(project, targetAsset, value = targetAsset?.identityEdit) {
  const recipe = normalizedIdentityEditRecipe(project, targetAsset, value);
  const { diskPath } = revalidatePinnedIdentityEditSource(project, recipe);
  return { recipe, diskPath };
}

export function identityEditJobRefs(project, targetAsset, value = targetAsset?.identityEdit) {
  const recipe = normalizedIdentityEditRecipe(project, targetAsset, value);
  const { sourceAsset } = revalidatePinnedIdentityEditSource(project, recipe);
  return {
    identityEditSource: recipe.source,
    identityEditSourceFingerprint: recipe.sourceFingerprint,
    identityEditTargetActiveVersion: identityEditActiveVersion(targetAsset.activeVersion),
    identityEditSourceActiveVersion: identityEditActiveVersion(sourceAsset.activeVersion)
  };
}

export function revalidateIdentityEditJobRefs(project, targetAsset, refs) {
  const expected = identityEditJobRefs(project, targetAsset);
  if (!refs || typeof refs !== "object") {
    throw identityEditError("Identity-edit job is missing its approved source snapshot", "IDENTITY_EDIT_JOB_SOURCE_MISSING");
  }
  for (const field of [
    "identityEditSourceFingerprint",
    "identityEditTargetActiveVersion",
    "identityEditSourceActiveVersion"
  ]) {
    if (refs[field] !== expected[field]) {
      throw identityEditError(`Identity-edit job ${field} changed after queue`, "IDENTITY_EDIT_JOB_SOURCE_CHANGED");
    }
  }
  const queuedSource = identityEditSourcePayload(refs.identityEditSource);
  if (
    identityEditSourceFingerprint(queuedSource) !== expected.identityEditSourceFingerprint
    || JSON.stringify(queuedSource) !== JSON.stringify(expected.identityEditSource)
  ) {
    throw identityEditError("Identity-edit job source snapshot changed after queue", "IDENTITY_EDIT_JOB_SOURCE_CHANGED");
  }
  return expected;
}

function productionGuardrails(category, variant) {
  const common = "Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.";
  if (category === "character" && /appearance|primary|identity/i.test(variant)) {
    return `Create a four-view cinematic character ingredients sheet showing the same person in frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume construction, body proportions, hands, scars, wounds, and carried props across every panel. One face exists only on the front of the head. ${common}`;
  }
  return common;
}

function explicitVisualAssets(markdown) {
  const start = markdown.search(/^#\s+ASSET GENERATION PROMPTS\s*$/mi);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const end = tail.search(/^#\s+LOCATION DESIGN SPECIFICATIONS\s*$/mi);
  const section = end >= 0 ? tail.slice(0, end) : tail;
  const lines = section.split(/\r?\n/);
  const records = [];
  let categoryHeading = "Atmospheric Assets";
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n");
    const promptRe = /\*\*([^*\n]*Prompt[^*\n]*):\*\*\s*```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi;
    let match;
    let found = 0;
    while ((match = promptRe.exec(body))) {
      found += 1;
      const category = categoryOf(current.categoryHeading);
      const variant = match[1].replace(/\s*Prompt\s*$/i, "").trim() || `Variation ${found}`;
      const sourcePrompt = match[2].replace(/\s+/g, " ").trim();
      records.push({
        id: assetId(category, current.name, variant),
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name: current.name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\n${sourcePrompt}`,
        sourcePrompt,
        sourceSection: "Asset Generation Prompts",
        status: "planned",
        reviewState: "explicit-prompt",
        workflowId: visualWorkflow(category, variant, current.name, assetId(category, current.name, variant)),
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    }
    current = null;
  };

  for (const line of lines) {
    const level2 = line.match(/^##\s+(.+)$/);
    if (level2) {
      flush();
      categoryHeading = level2[1];
      continue;
    }
    const level3 = line.match(/^###\s+(.+)$/);
    if (level3) {
      flush();
      current = { name: level3[1].trim(), categoryHeading, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();
  return records;
}

function stableHeading(value) {
  const text = String(value || "").trim();
  const match = text.match(/^((?:CHAR|LOC|PROP|COST|ATM)-\d+)\s*:\s*(.+)$/i);
  return match
    ? { sourceAssetId: match[1].toLowerCase(), name: match[2].trim() }
    : { sourceAssetId: "", name: text };
}

function firstFencedPrompt(body) {
  return String(body || "")
    .match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim() || "";
}

// Some production packages use one top-level heading per asset family instead
// of the older monolithic "ASSET GENERATION PROMPTS" section. Keep this
// parser deterministic so an approved screenplay can become a manifest without
// another language-model pass.
function sectionedVisualAssets(markdown) {
  const sectionMap = [
    [/^CHARACTER ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "character"],
    [/^LOCATION ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "location"],
    [/^ARTIFACT ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "artifact"],
    [/^ATMOSPHERIC ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "atmosphere"],
    [/^FIRST AND LAST FRAME SCENE IMAGES$/i, "guide-frame"]
  ];
  const headings = [...String(markdown || "").matchAll(/^#\s+(.+)$/gm)];
  const records = [];

  for (let index = 0; index < headings.length; index += 1) {
    const category = sectionMap.find(([pattern]) => pattern.test(headings[index][1].trim()))?.[1];
    if (!category) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const lines = markdown.slice(start, end).split(/\r?\n/);
    let currentAsset = null;
    let currentVariant = null;

    const flush = () => {
      if (!currentAsset || !currentVariant) return;
      const sourcePrompt = firstFencedPrompt(currentVariant.body.join("\n"));
      if (!sourcePrompt) return;
      const parsed = stableHeading(currentAsset);
      const rawVariant = currentVariant.name.replace(/\s*Prompt\s*$/i, "").trim();
      const variant = rawVariant || (category === "guide-frame"
        ? (/^FIRST FRAME/i.test(parsed.name) ? "Opening Guide Frame" : "Closing Guide Frame")
        : "Production Reference");
      const id = parsed.sourceAssetId
        ? `${parsed.sourceAssetId}-${slugify(variant)}`
        : assetId(category, parsed.name, variant);
      records.push({
        id,
        sourceAssetId: parsed.sourceAssetId,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name: parsed.name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\n${sourcePrompt}`,
        sourcePrompt,
        sourceSection: headings[index][1].trim(),
        status: "planned",
        reviewState: "explicit-prompt",
        workflowId: visualWorkflow(category, variant, parsed.name, id),
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    };

    for (const line of lines) {
      const level2 = line.match(/^##\s+(.+)$/);
      if (level2) {
        flush();
        currentAsset = level2[1].trim();
        currentVariant = null;
        continue;
      }
      const level3 = line.match(/^###\s+(.+)$/);
      if (level3) {
        flush();
        currentVariant = { name: level3[1].trim(), body: [] };
        continue;
      }
      if (currentVariant) currentVariant.body.push(line);
    }
    flush();
  }
  return records;
}

function stableIdAssets(markdown, items) {
  const sections = [
    ["CHARACTER STABLE IDS", "CHAR", "character", "Identity Ingredients"],
    ["LOCATION STABLE IDS", "LOC", "location", "Production Reference"],
    ["COSTUME STABLE IDS", "COST", "wardrobe", "Identity Ingredients"],
    ["PROP STABLE IDS", "PROP", "artifact", "Production Reference"]
  ];
  const additions = [];
  for (const [heading, prefix, category, variant] of sections) {
    const startMatch = new RegExp(`^##\\s+${heading}\\s*$`, "mi").exec(markdown);
    if (!startMatch) continue;
    const start = startMatch.index + startMatch[0].length;
    const tail = markdown.slice(start);
    const next = tail.search(/^#{1,2}\s+/m);
    const section = next >= 0 ? tail.slice(0, next) : tail;
    const blockPattern = new RegExp(`^(${prefix}-\\d+):\\s*(.+)\\r?\\n([\\s\\S]*?)(?=^${prefix}-\\d+:|(?![\\s\\S]))`, "gmi");
    let match;
    while ((match = blockPattern.exec(section))) {
      const sourceAssetId = match[1].toLowerCase();
      const name = match[2].trim();
      const continuity = match[3].split(/\r?\n/)
        .map((line) => line.replace(/^\s*[├└]──\s*/, "").trim())
        .filter((line) => Boolean(line) && !/^(?:```|---|═+)$/.test(line));
      const existing = items.filter((item) => item.sourceAssetId === sourceAssetId);
      if (existing.length) {
        for (const item of existing) item.continuity = [...new Set([...(item.continuity || []), ...continuity])];
        continue;
      }
      const detail = continuity.join(". ");
      additions.push({
        id: sourceAssetId,
        sourceAssetId,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\nCinematic biblical epic production reference for ${name}. ${detail}`,
        sourcePrompt: detail,
        sourceSection: heading,
        status: "planned",
        reviewState: "continuity-bible",
        workflowId: visualWorkflow(category, variant, name, sourceAssetId),
        dependencies: [],
        continuity,
        versions: [],
        activeVersion: 0
      });
    }
  }
  return additions;
}

function directAudioCueAssets(markdown) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "the production";
  const start = markdown.search(/^##\s+Sound Design Elements\s*$/mi);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const end = tail.search(/^#(?!#)\s+/m);
  const section = end >= 0 ? tail.slice(0, end) : tail;
  const pieces = section.split(/^###\s+/m).slice(1);
  const items = [];
  for (const piece of pieces) {
    const newline = piece.indexOf("\n");
    const heading = (newline >= 0 ? piece.slice(0, newline) : piece).trim();
    const body = newline >= 0 ? piece.slice(newline + 1) : "";
    if (/environmental sounds/i.test(heading) || /action sound effects/i.test(heading)) {
      const variant = /environmental/i.test(heading) ? "Ambience" : "Foley / Impact";
      for (const match of body.matchAll(/^-\s+\*\*([^*]+):\*\*\s*(.+)$/gm)) {
        const name = match[1].trim();
        const direction = match[2].trim();
        items.push({
          id: assetId("sound", name, variant),
          category: "sound",
          categoryLabel: CATEGORY_LABELS.sound,
          name,
          variant,
          mediaType: "instruction",
          prompt: `Synchronized cinematic ${variant.toLowerCase()} for ${title}: ${direction}. Natural spatial perspective, physically plausible acoustics, no modern ambience, no narration, and no unrelated music.`,
          sourceSection: "Sound Design Elements",
          status: "planned",
          reviewState: "explicit-direction",
          workflowId: "ltx-2.3-native-audio",
          dependencies: [],
          versions: [],
          activeVersion: 0
        });
      }
    }
    if (/musical elements/i.test(heading)) {
      let index = 0;
      for (const match of body.matchAll(/^\*\*([^*]+):\*\*\s*(.+)$/gm)) {
        index += 1;
        const name = match[1].trim();
        const direction = match[2].trim();
        items.push({
          id: assetId("music", name, `cue-${index}`),
          category: "music",
          categoryLabel: CATEGORY_LABELS.music,
          name,
          variant: `Score Cue ${index}`,
          mediaType: "audio",
          prompt: `Instrumental cinematic biblical score for ${title}: ${direction}. Reverent ancient-world orchestration, organic dynamics, emotional restraint, no lyrics, no modern pop drums, and designed to join one unified score.`,
          durationSec: 60,
          bpm: /climax/i.test(name) ? 96 : /resolution/i.test(name) ? 64 : 76,
          sourceSection: "Musical Elements and Score Direction",
          status: "planned",
          reviewState: "explicit-direction",
          workflowId: "ace-step-1.5-xl-turbo",
          dependencies: [],
          versions: [],
          activeVersion: 0
        });
      }
    }
  }
  return items;
}

function applyContinuityDependencies(items) {
  const bySource = new Map();
  for (const item of items) {
    if (!item.sourceAssetId) continue;
    const group = bySource.get(item.sourceAssetId) || [];
    group.push(item);
    bySource.set(item.sourceAssetId, group);
  }
  const preferred = (sourceId) => {
    const group = bySource.get(sourceId) || [];
    return group.find((item) => /primary|identity|wide|production reference/i.test(item.variant)) || group[0];
  };
  const characterParts = {
    "char-01": ["cost-01", "prop-01", "prop-02", "prop-07"],
    "char-02": ["cost-02", "prop-03", "prop-04"],
    "char-03": ["cost-03", "prop-05", "prop-06"],
    "char-04": ["cost-04"],
    "char-05": ["cost-04"],
    "char-06": ["cost-04"],
    "char-07": ["cost-05"]
  };
  for (const [characterId, componentIds] of Object.entries(characterParts)) {
    const group = bySource.get(characterId) || [];
    const primary = preferred(characterId);
    const components = componentIds.map(preferred).filter(Boolean).map((item) => item.id);
    for (const item of group) {
      const dependencies = item === primary ? components : [primary?.id, ...components].filter(Boolean);
      item.dependencies = [...new Set([...(item.dependencies || []), ...dependencies])];
    }
  }
  for (const [sourceId, group] of bySource.entries()) {
    if (!sourceId.startsWith("loc-") || group.length < 2) continue;
    const primary = preferred(sourceId);
    for (const item of group) if (item !== primary) item.dependencies = [...new Set([...(item.dependencies || []), primary.id])];
  }
  for (const item of items.filter((entry) => entry.category === "guide-frame")) {
    const sourceIds = /^FIRST FRAME/i.test(item.name) ? ["loc-01", "atm-01"] : ["loc-05", "char-01", "atm-02"];
    item.dependencies = [...new Set([...(item.dependencies || []), ...sourceIds.map(preferred).filter(Boolean).map((entry) => entry.id)])];
  }
  for (const item of items.filter((entry) => entry.category === "voice")) {
    const sourceId = item.name.match(/(CHAR-\d+)/i)?.[1]?.toLowerCase();
    const character = sourceId ? preferred(sourceId) : null;
    if (character) item.dependencies = [...new Set([...(item.dependencies || []), character.id])];
  }
  return items;
}

function voiceAssets(markdown, breakdown) {
  const start = markdown.search(/^#\s+VOICE\s*&\s*AUDIO DIRECTION\s*$/mi);
  const end = start >= 0 ? markdown.slice(start).search(/^##\s+SOUND DESIGN ELEMENTS\s*$/mi) : -1;
  const section = start < 0 ? "" : markdown.slice(start, end >= 0 ? start + end : undefined);
  const pieces = section.split(/^###\s+/m).slice(1);
  const assets = [];
  for (const piece of pieces) {
    const newline = piece.indexOf("\n");
    const name = (newline >= 0 ? piece.slice(0, newline) : piece).trim();
    const body = newline >= 0 ? piece.slice(newline + 1) : "";
    const profile = body.match(/\*\*Voice Profile:\*\*([\s\S]*?)(?:\*\*Key Lines|---|$)/i)?.[1]
      ?.replace(/^\s*[-*]\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim() || "Cinematic performance with a distinct, repeatable vocal identity.";
    const samples = [...body.matchAll(/\*"([\s\S]*?)"\*/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
    assets.push({
      id: assetId("voice", name, "voice-design"),
      category: "voice",
      categoryLabel: CATEGORY_LABELS.voice,
      name,
      variant: "Voice Design",
      mediaType: "audio",
      prompt: profile,
      sampleText: samples[0] || "The light has come, and darkness cannot overcome it.",
      sourceSection: "Voice & Audio Direction",
      status: "planned",
      reviewState: "explicit-direction",
      workflowId: "qwen3-tts-voice-design-1.7b",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }

  const roleDefaults = {
    Eve: ["Ancient compassionate contralto, physically aged yet emotionally luminous, trembling relief becoming steady hope; restrained biblical drama, no caricature.", "He has come. The promise is fulfilled."],
    "Voice of Hell": ["Deep nonhuman resonant voice emerging from stone and cavern, layered but intelligible, immense age, terror beneath defiance; cinematic and restrained.", "You have no power here."],
    "Trapped Souls": ["A diverse ensemble of exhausted adult voices, whispered despair transforming into astonished hope; naturally layered crowd performance.", "The chains are breaking."],
    "Low Voice": ["Warm timeless male baritone, reverent ceremonial delivery, intimate at first and capable of orchestral-scale authority; no imitation of a named living performer.", "The King of Kings has come."],
    Chorus: ["Reverent mixed sacred chorus with warm low soloist, controlled vibrato, clear diction, gradual expansion from breath to triumphant ensemble.", "The King has conquered. Death is defeated."],
    Jesus: ["Mature compassionate Mediterranean baritone with calm authority and restrained divine resonance.", "I am the Living One."],
    Adam: ["Ancient weathered bass, broken by emotion and millennia of waiting, quiet and human.", "The Second Adam... you have come for us."],
    "Guardian Leader": ["Inhuman grinding bass like ancient stone, deliberate and threatening, with fear beginning beneath the command.", "No living thing passes here."]
  };
  for (const role of breakdown?.audio?.dialogue_roles || []) {
    if (assets.some((asset) => asset.name.toLowerCase().includes(String(role).toLowerCase()))) continue;
    const [prompt, sampleText] = roleDefaults[role] || [`Distinct cinematic voice design for ${role}; stable timbre, clear diction, emotionally restrained live-action performance.`, "The hour has come."];
    assets.push({
      id: assetId("voice", role, "voice-design"),
      category: "voice",
      categoryLabel: CATEGORY_LABELS.voice,
      name: role,
      variant: "Voice Design",
      mediaType: "audio",
      prompt,
      sampleText,
      sourceSection: "Screenplay review",
      status: "planned",
      reviewState: "direction-supplemented",
      workflowId: "qwen3-tts-voice-design-1.7b",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }
  return assets;
}

function normalizedName(name) {
  return slugify(String(name || "").split(/\s+-\s+/)[0]);
}

function normalizedReviewId(value) {
  return String(value || "").trim().toLowerCase();
}

function addReviewAssets(items, breakdown) {
  if (!breakdown) return;
  const groups = [
    ["characters", "character"],
    ["locations", "location"],
    ["props_and_artifacts", "artifact"],
    ["wardrobe", "wardrobe"],
    ["creatures_extras_and_crowds", "extra"],
    ["vfx_and_state_assets", "atmosphere"]
  ];
  for (const [key, category] of groups) {
    for (const spec of breakdown[key] || []) {
      // Typography is generated by the deterministic compositor below, never by Krea.
      if (String(spec.asset_id || "").toUpperCase() === "GFX-TITLE-CARD") continue;
      const name = spec.name || spec.asset_id || "Production asset";
      const needle = normalizedName(name);
      const existing = items.find((asset) => asset.category === category && normalizedName(asset.name) === needle);
      const dependencies = [...(spec.prop_ids || []), ...(spec.wardrobe_ids || [])].map(normalizedReviewId);
      const continuity = [
        ...(spec.continuity_requirements || spec.continuity || spec.states || []),
        ...(spec.required_additions || []),
        ...(spec.conflict ? [spec.conflict] : [])
      ];
      if (existing) {
        existing.sourceAssetId = normalizedReviewId(spec.asset_id) || existing.sourceAssetId;
        existing.dependencies = [...new Set([...(existing.dependencies || []), ...dependencies])];
        existing.continuity = [...new Set([...(existing.continuity || []), ...continuity])];
        existing.reviewDetails = spec;
        existing.reviewState = String(spec.status || spec.visual_prompt_status || existing.reviewState || "review-merged");
        continue;
      }
      const detail = Object.entries(spec)
        .filter(([field]) => !["asset_id", "name"].includes(field))
        .map(([field, value]) => `${field.replace(/_/g, " ")}: ${Array.isArray(value) ? value.join("; ") : String(value)}`)
        .join(". ");
      const variant = category === "character" ? "Identity Ingredients" : "Production Reference";
      items.push({
        id: String(spec.asset_id || assetId(category, name, variant)).toLowerCase(),
        sourceAssetId: normalizedReviewId(spec.asset_id),
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\nCinematic biblical epic production asset for ${name}. ${detail}`,
        sourcePrompt: "",
        sourceSection: "Structured screenplay review",
        status: "planned",
        reviewState: String(spec.status || spec.visual_prompt_status || "review-added"),
        workflowId: visualWorkflow(category, variant, name, String(spec.asset_id || "").toLowerCase()),
        dependencies,
        continuity,
        reviewDetails: spec,
        versions: [],
        activeVersion: 0
      });
    }
  }
}

function resolveAssetDependencies(items) {
  const aliases = new Map();
  for (const item of items) {
    aliases.set(normalizedReviewId(item.id), item.id);
    if (item.sourceAssetId) aliases.set(normalizedReviewId(item.sourceAssetId), item.id);
  }
  for (const item of items) {
    item.dependencies = [...new Set((item.dependencies || []).map((dependency) => aliases.get(normalizedReviewId(dependency)) || normalizedReviewId(dependency)).filter(Boolean))];
  }
  return items;
}

function audioCueAssets(breakdown) {
  const items = [];
  const soundGroups = [
    ["environmental_stems", "Ambience"],
    ["action_stems", "Foley / Impact"]
  ];
  for (const [key, variant] of soundGroups) {
    for (const cue of breakdown?.audio?.[key] || []) {
      items.push({
        id: assetId("sound", cue, variant),
        category: "sound",
        categoryLabel: CATEGORY_LABELS.sound,
        name: cue,
        variant,
        mediaType: "instruction",
        prompt: `Synchronized cinematic ${variant.toLowerCase()} for the Harrowing of Hell: ${cue}. Natural spatial perspective, physically plausible acoustics, no modern ambience, no narration, and no unrelated music.`,
        sourceSection: "Sound Design Elements",
        status: "planned",
        reviewState: "ltx-native-audio",
        workflowId: "ltx-2.3-native-audio",
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    }
  }
  for (const [index, cue] of (breakdown?.audio?.score_arc || []).entries()) {
    items.push({
      id: assetId("music", cue, `cue-${index + 1}`),
      category: "music",
      categoryLabel: CATEGORY_LABELS.music,
      name: `Score Cue ${index + 1}`,
      variant: cue,
      mediaType: "audio",
      prompt: `Instrumental cinematic biblical score cue: ${cue}. Reverent ancient-world orchestration, organic dynamics, emotional restraint, no lyrics, no modern pop drums, designed to join a unified ten-minute score.`,
      durationSec: 60,
      bpm: index === 2 ? 96 : index === 4 ? 64 : 76,
      sourceSection: "Musical Elements",
      status: "planned",
      reviewState: "explicit-direction",
      workflowId: "ace-step-1.5-xl-turbo",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }
  return items;
}

function titleAsset(markdown) {
  const sourceTitle = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled Project";
  const normalized = sourceTitle.replace(/HARRROWING/gi, "HARROWING");
  return {
    id: assetId("graphic", normalized, "title-card"),
    category: "graphic",
    categoryLabel: CATEGORY_LABELS.graphic,
    name: "Final Title Card",
    variant: normalized,
    mediaType: "graphic",
    prompt: normalized,
    sourceSection: "Final sequence",
    status: "planned",
    reviewState: sourceTitle === normalized ? "deterministic" : "spelling-normalized-for-output",
    workflowId: "premiere316-title-card",
    dependencies: [],
    versions: [],
    activeVersion: 0
  };
}

function preserveAssetState(next, previous) {
  const oldById = new Map((previous?.items || []).map((item) => [item.id, item]));
  return next.map((item) => {
    const old = oldById.get(item.id);
    if (!old) return item;
    return {
      ...item,
      name: old.name ?? item.name,
      variant: old.variant ?? item.variant,
      category: old.category ?? item.category,
      categoryLabel: old.categoryLabel ?? item.categoryLabel,
      mediaType: old.mediaType ?? item.mediaType,
      prompt: old.prompt ?? item.prompt,
      promptHeader: old.promptHeader ?? item.promptHeader,
      sampleText: old.sampleText ?? item.sampleText,
      sourceSection: old.sourceSection ?? item.sourceSection,
      reviewState: old.reviewState ?? item.reviewState,
      workflowId: old.workflowId ?? item.workflowId,
      dependencies: old.dependencies ?? item.dependencies,
      continuity: old.continuity ?? item.continuity,
      durationSec: old.durationSec ?? item.durationSec,
      bpm: old.bpm ?? item.bpm,
      status: old.status || item.status,
      seed: old.seed ?? item.seed,
      versions: Array.isArray(old.versions) ? old.versions : [],
      activeVersion: Number(old.activeVersion) || 0,
      approval: old.approval || null
    };
  });
}

export function buildAssetPackage(markdown, { productionBreakdown = null, previous = null } = {}) {
  const screenplayHash = crypto.createHash("sha256").update(String(markdown || "").trim()).digest("hex");
  const source = String(markdown || "");
  const items = [...explicitVisualAssets(source), ...sectionedVisualAssets(source)];
  items.push(...stableIdAssets(source, items));
  addReviewAssets(items, productionBreakdown);
  items.push(...voiceAssets(source, productionBreakdown));
  items.push(...audioCueAssets(productionBreakdown));
  items.push(...directAudioCueAssets(source));
  items.push(titleAsset(source));
  const manualItems = (previous?.items || []).filter((item) =>
    item.reviewState === "director-created" ||
    item.generationComposer === true ||
    item.regenerationMode === "prompt-composer" ||
    item.source === "prompt-generation-composer"
  );
  const deletedItems = Array.isArray(previous?.deletedItems) ? previous.deletedItems : [];
  const deletedIds = new Set(deletedItems.map((entry) => entry?.asset?.id || entry?.id).filter(Boolean));
  const unique = [...new Map([...items, ...manualItems].map((item) => [item.id, item])).values()].filter((item) => !deletedIds.has(item.id));
  const deduped = resolveAssetDependencies(applyContinuityDependencies(unique));
  const sameRevision = previous?.screenplayHash === screenplayHash;
  const preserved = preserveAssetState(deduped, sameRevision ? previous : null);
  for (const item of preserved) {
    const promptComposerAsset = item.generationComposer === true || item.regenerationMode === "prompt-composer" || item.source === "prompt-generation-composer";
    if (isIdentityEditWorkflow(item.workflowId)) continue;
    if (!promptComposerAsset) item.prompt = withAssetPromptHeader(item, item.prompt);
    applyStyleLockToAsset(item);
  }
  const counts = preserved.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    screenplayHash,
    counts,
    total: preserved.length,
    items: preserved,
    deletedItems,
    review: productionBreakdown ? {
      status: productionBreakdown.review_status,
      issues: productionBreakdown.missing_and_ambiguous_requirements || [],
      generationOrder: productionBreakdown.recommended_asset_generation_order || [],
      provisionalStoryBeats: productionBreakdown.provisional_story_beats || []
    } : null
  };
}

function enumValues(objectInfo, className, inputName) {
  const entry = objectInfo?.[className]?.input;
  const definition = entry?.required?.[inputName] || entry?.optional?.[inputName];
  if (Array.isArray(definition?.[0])) return definition[0];
  if (Array.isArray(definition?.[1]?.options)) return definition[1].options;
  return [];
}

function workflowReadiness(workflow, objectInfo, { comfyOnline = false } = {}) {
  if (["ltx-2.3-native-audio", "premiere316-title-card"].includes(workflow.id)) {
    return { ready: true, reason: "Built into Premiere316" };
  }
  if (workflow.id === "qwen3-tts-voice-design-1.7b") {
    return {
      ready: false,
      code: "USE_CREATE_SOUND",
      reason: "Use Create Sound → Voice Design. The legacy ComfyUI Qwen generator is disabled so it cannot conflict with the standalone pinned runtime.",
      remediation: "/sound"
    };
  }
  if (!comfyOnline) {
    return {
      ready: false,
      code: "COMFY_OFFLINE",
      reason: `ComfyUI is offline at ${process.env.COMFY_URL || "http://127.0.0.1:8188"}. Start the engine, then retry generation.`,
      remediation: "start-comfy"
    };
  }
  const missingNodes = workflow.requiredNodes.filter((node) => !objectInfo?.[node]);
  if (missingNodes.length) return { ready: false, code: "MISSING_NODES", reason: `Missing nodes: ${missingNodes.join(", ")}` };
  if (isStyleLockWorkflow(workflow.id)) {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(STYLE_FLUX_MODEL) ? null : STYLE_FLUX_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(STYLE_FLUX_CLIP) ? null : STYLE_FLUX_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(STYLE_FLUX_VAE) ? null : STYLE_FLUX_VAE,
      enumValues(objectInfo, "UpscaleModelLoader", "model_name").includes(STYLE_UPSCALER) ? null : STYLE_UPSCALER
    ].filter(Boolean);
    return missing.length
      ? { ready: false, reason: `Style-Lock workflow found; local models missing: ${missing.join(", ")}` }
      : { ready: true, reason: "Style-Lock presets, references, and local FLUX.2 models installed" };
  }
  if (workflow.id.startsWith("krea2")) {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(KREA_MODEL) ? null : KREA_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(KREA_CLIP) ? null : KREA_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(KREA_VAE) ? null : KREA_VAE,
      workflow.id === KREA2_IDENTITY_EDIT_WORKFLOW_ID
        && !enumValues(objectInfo, "LoraLoaderModelOnly", "lora_name").includes(KREA_IDENTITY_EDIT_LORA)
        ? KREA_IDENTITY_EDIT_LORA
        : null
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Missing models: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  if (workflow.id === "flux2-klein-9b-prop-fp8") {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(FLUX_MODEL) ? null : FLUX_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(FLUX_CLIP) ? null : FLUX_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(FLUX_VAE) ? null : FLUX_VAE
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Missing models: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  if (workflow.id === "ace-step-1.5-xl-turbo") {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(ACE_MODEL) ? null : ACE_MODEL,
      enumValues(objectInfo, "DualCLIPLoader", "clip_name1").includes(ACE_CLIP_SMALL) ? null : ACE_CLIP_SMALL,
      enumValues(objectInfo, "DualCLIPLoader", "clip_name2").includes(ACE_CLIP_LARGE) ? null : ACE_CLIP_LARGE,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(ACE_VAE) ? null : ACE_VAE
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Workflow found; weights not installed: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  return { ready: false, reason: "Workflow is not configured" };
}

function gpuState() {
  try {
    const raw = execFileSync("nvidia-smi", ["--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf-8", timeout: 3000 }).trim().split(/\r?\n/)[0];
    const [totalMb, usedMb, freeMb] = raw.split(",").map((value) => Number(value.trim()));
    let processes = "";
    try {
      processes = execFileSync("nvidia-smi", ["--query-compute-apps=process_name", "--format=csv,noheader"], { encoding: "utf-8", timeout: 3000 });
    } catch {}
    return {
      totalGb: Math.round((totalMb / 1024) * 10) / 10,
      usedGb: Math.round((usedMb / 1024) * 10) / 10,
      freeGb: Math.round((freeMb / 1024) * 10) / 10,
      lmStudioGpuResident: /llama-server\.exe/i.test(processes)
    };
  } catch {
    return { totalGb: null, usedGb: null, freeGb: null, lmStudioGpuResident: false };
  }
}

function vramFloor(workflowId) {
  if (isStyleLockWorkflow(workflowId)) return 22;
  if (workflowId.startsWith("krea2")) return 18;
  if (workflowId === "flux2-klein-9b-prop-fp8") return 19;
  if (workflowId === "qwen3-tts-voice-design-1.7b") return 5;
  if (workflowId === "ace-step-1.5-xl-turbo") return 20;
  return 0;
}

export async function getAssetWorkflowCatalog(force = false) {
  let objectInfo = {};
  let comfyOnline = false;
  try {
    objectInfo = await getObjectInfo(force);
    comfyOnline = Boolean(objectInfo && Object.keys(objectInfo).length);
  } catch {
    comfyOnline = false;
    objectInfo = {};
  }
  const gpu = gpuState();
  return ASSET_WORKFLOWS.map((workflow) => {
    const installed = workflowReadiness(workflow, objectInfo, { comfyOnline });
    const minimumFreeVramGb = vramFloor(workflow.id);
    const handoffRequired = Boolean(
      installed.ready &&
      minimumFreeVramGb > 0 &&
      gpu.lmStudioGpuResident &&
      Number.isFinite(gpu.freeGb) &&
      gpu.freeGb < minimumFreeVramGb
    );
    return {
      ...workflow,
      ...installed,
      installed: installed.ready,
      availableNow: installed.ready && !handoffRequired,
      minimumFreeVramGb,
      gpu,
      runtimeWarning: handoffRequired
        ? `GPU handoff required: LM Studio is holding VRAM and only ${gpu.freeGb} GB is free. Unload the screenplay model, then recheck local models before generating this asset.`
        : null
    };
  });
}

function workflowFor(id) {
  const workflow = ASSET_WORKFLOWS.find((candidate) => candidate.id === id);
  if (!workflow) throw new Error(`Unknown asset workflow: ${id}`);
  return workflow;
}

function screenplayHash(project) {
  const markdown = String(project?.screenplay?.markdown || "").trim();
  return markdown ? crypto.createHash("sha256").update(markdown).digest("hex") : null;
}

export function assetGenerationFingerprint(asset) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: asset?.id || null,
    name: asset?.name || "",
    variant: asset?.variant || "",
    category: asset?.category || null,
    mediaType: asset?.mediaType || null,
    prompt: asset?.prompt || "",
    sampleText: asset?.sampleText || "",
    workflowId: asset?.workflowId || null,
    workflowHash: asset?.workflowHash || null,
    seed: asset?.seed ?? null,
    durationSec: asset?.durationSec ?? null,
    bpm: asset?.bpm ?? null,
    ...(isIdentityEditWorkflow(asset?.workflowId) ? { identityEdit: {
      schema: asset?.identityEdit?.schema || null,
      targetAssetId: asset?.identityEdit?.targetAssetId || null,
      source: identityEditSourcePayload(asset?.identityEdit?.source),
      sourceFingerprint: asset?.identityEdit?.sourceFingerprint || null,
      sourceWidth: Number(asset?.identityEdit?.sourceWidth) || null,
      sourceHeight: Number(asset?.identityEdit?.sourceHeight) || null,
      width: Number(asset?.identityEdit?.width) || null,
      height: Number(asset?.identityEdit?.height) || null,
      comfyFile: asset?.identityEdit?.comfyFile || null,
      refBoost: Number(asset?.identityEdit?.refBoost) || null,
      refBoostA: Number(asset?.identityEdit?.refBoostA) || null,
      fitMode: asset?.identityEdit?.fitMode || null
    } } : {})
  })).digest("hex");
}

function activeAssetVersion(asset) {
  return (asset?.versions || []).find((version) => Number(version.v) === Number(asset?.activeVersion)) || null;
}

function normalizedFileHashes(version) {
  if (Array.isArray(version?.fileHashes)) {
    return version.fileHashes
      .map((entry) => ({
        file: String(entry?.file || ""),
        sha256: String(entry?.sha256 || "").toLowerCase(),
        bytes: Number(entry?.bytes) || 0,
        extension: String(entry?.extension || path.extname(String(entry?.file || ""))).toLowerCase()
      }))
      .filter((entry) => entry.file && entry.sha256)
      .sort((left, right) => left.file.localeCompare(right.file));
  }
  if (version?.fileHashes && typeof version.fileHashes === "object") {
    return Object.entries(version.fileHashes)
      .map(([file, sha256]) => ({ file, sha256: String(sha256 || "").toLowerCase(), bytes: 0, extension: path.extname(file).toLowerCase() }))
      .filter((entry) => entry.file && entry.sha256)
      .sort((left, right) => left.file.localeCompare(right.file));
  }
  return [];
}

function safeAssetRelative(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^media\/assets\//i, "")
    .split("/")
    .filter(Boolean);
  if (!normalized.length || normalized.some((part) => part === "." || part === "..")) return "";
  return normalized.join("/");
}

function generatedFileHashes(project, files) {
  return [...new Set((files || []).map(safeAssetRelative).filter(Boolean))]
    .map((file) => {
      const absolute = path.join(mediaDir(project, "assets"), ...file.split("/"));
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Generated asset file is missing: ${file}`);
      const buffer = fs.readFileSync(absolute);
      return {
        file,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        bytes: buffer.byteLength,
        extension: path.extname(file).toLowerCase()
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function assetFileSlug(asset) {
  const raw = String(asset?.fileSlug || asset?.id || "asset").trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "asset";
}

function assetVersionRecordFingerprint(asset, active) {
  return crypto.createHash("sha256").update(JSON.stringify({
    assetId: asset.id,
    version: Number(active.v),
    files: active.files || (active.file ? [active.file] : []),
    workflowId: active.workflowId || asset.workflowId || null,
    workflowHash: active.workflowHash || asset.workflowHash || null,
    model: active.model || null,
    prompt: active.prompt || "",
    seed: active.seed ?? null,
    createdAt: active.createdAt || null,
    generationFingerprint: active.assetFingerprint || null,
    fileHashes: normalizedFileHashes(active),
    ...(active.sourceReference ? {
      sourceReference: identityEditSourcePayload(active.sourceReference),
      sourceReferenceFingerprint: active.sourceReferenceFingerprint || null,
      sourceWidth: Number(active.sourceWidth) || null,
      sourceHeight: Number(active.sourceHeight) || null,
      width: Number(active.width) || null,
      height: Number(active.height) || null
    } : {})
  })).digest("hex");
}

export function assetVersionFingerprint(asset) {
  const active = activeAssetVersion(asset);
  return active ? assetVersionRecordFingerprint(asset, active) : null;
}

export function assetVersionFilesCurrent(project, asset) {
  const active = activeAssetVersion(asset);
  if (!active) return false;
  const expected = normalizedFileHashes(active);
  const names = active.files || (active.file ? [active.file] : []);
  if (!names.length || expected.length !== new Set(names.map((file) => path.basename(String(file)))).size) return false;
  try {
    const actual = generatedFileHashes(project, names);
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function assetHasCurrentGeneratedVersion(project, asset) {
  const active = activeAssetVersion(asset);
  const revision = screenplayHash(project);
  const generationFingerprint = assetGenerationFingerprint(asset);
  return Boolean(
    active &&
    revision &&
    active.assetFingerprint === generationFingerprint &&
    active.screenplayRevision === revision &&
    active.manifestScreenplayHash === project?.assets?.screenplayHash &&
    active.workflowId === asset.workflowId &&
    String(active.workflowHash || "") === String(asset.workflowHash || "") &&
    assetVersionFilesCurrent(project, asset)
  );
}

function restoredAssetStatus(project, asset) {
  if (!assetHasCurrentGeneratedVersion(project, asset)) return "planned";
  return asset.workflowId === "ltx-2.3-native-audio" ? "ready-for-shot" : "generated";
}

export function assetApprovalCurrent(project, asset) {
  if (skipApproval(project)) return Boolean(asset);
  const revision = screenplayHash(project);
  const approval = asset?.approval;
  const active = activeAssetVersion(asset);
  const generationFingerprint = assetGenerationFingerprint(asset);
  return Boolean(
    revision &&
    active &&
    project?.screenplay?.approval?.screenplayRevision === revision &&
    project?.assets?.screenplayHash === revision &&
    active.assetFingerprint === generationFingerprint &&
    active.screenplayRevision === revision &&
    active.manifestScreenplayHash === revision &&
    active.workflowId === asset.workflowId &&
    String(active.workflowHash || "") === String(asset.workflowHash || "") &&
    approval?.status === "approved" &&
    approval?.screenplayRevision === revision &&
    Number(approval?.activeVersion) === Number(asset?.activeVersion) &&
    approval?.generationFingerprint === generationFingerprint &&
    approval?.workflowId === asset.workflowId &&
    String(approval?.workflowHash || "") === String(asset.workflowHash || "") &&
    approval?.versionFingerprint === assetVersionFingerprint(asset) &&
    assetVersionFilesCurrent(project, asset)
  );
}

function seededInt(asset) {
  if (Number.isFinite(Number(asset.seed))) return Math.max(0, Math.floor(Number(asset.seed)));
  return parseInt(crypto.createHash("sha256").update(asset.id).digest("hex").slice(0, 12), 16);
}

function kreaResolution(asset, project) {
  if (asset.workflowId === "krea2-character-ingredients-fp8") return { width: 1024, height: 1024 };
  if (["atmosphere", "wardrobe"].includes(asset.category)) return { width: 768, height: 768 };
  const ratio = (project.settings?.width || 1280) / (project.settings?.height || 720);
  return ratio > 2 ? { width: 1024, height: 432 } : { width: 896, height: 512 };
}

function kreaPrompt(project, asset) {
  const { width, height } = kreaResolution(asset, project);
  const seed = seededInt(asset);
  const prompt = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: KREA_MODEL, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: KREA_CLIP, type: "krea2", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: asset.prompt, clip: ["2", 0] } },
    "4": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["3", 0] } },
    "5": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], denoise: 1 } },
    "8": { class_type: "VAELoader", inputs: { vae_name: KREA_VAE } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["8", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}` } }
  };
  return prompt;
}

function identityEditInstruction(asset) {
  let text = String(asset?.prompt || "").replace(/\r\n/g, "\n").trim();
  const header = String(asset?.promptHeader || "").trim();
  if (header && (text === header || text.startsWith(`${header}\n`))) {
    text = text.slice(header.length).trim();
  }
  const lock = String(STYLE_LOCK_PROMPT || "").trim();
  if (lock && text.includes(lock)) {
    text = text.split(lock).join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (!text) {
    throw identityEditError("Krea 2 Identity Edit requires a non-empty edit instruction", "IDENTITY_EDIT_INSTRUCTION_REQUIRED");
  }
  return text;
}

function kreaIdentityEditPrompt(project, asset) {
  const seed = seededInt(asset);
  const recipe = normalizedIdentityEditRecipe(project, asset, asset.identityEdit);
  const sourceImage = recipe.comfyFile;
  const instruction = identityEditInstruction(asset);
  return {
    "55": { class_type: "UNETLoader", inputs: { unet_name: KREA_MODEL, weight_dtype: "default" } },
    "56": { class_type: "CLIPLoader", inputs: { clip_name: KREA_CLIP, type: "krea2", device: "default" } },
    "57": { class_type: "VAELoader", inputs: { vae_name: KREA_VAE } },
    "71": { class_type: "LoraLoaderModelOnly", inputs: { model: ["55", 0], lora_name: KREA_IDENTITY_EDIT_LORA, strength_model: 1 } },
    "72": { class_type: "LoadImage", inputs: { image: sourceImage } },
    "73": { class_type: "VAEEncode", inputs: { pixels: ["72", 0], vae: ["57", 0] } },
    "82": { class_type: "EmptySD3LatentImage", inputs: { width: recipe.width, height: recipe.height, batch_size: 1 } },
    "84": {
      class_type: "Krea2EditGroundedEncode",
      inputs: { clip: ["56", 0], prompt: instruction, image: ["72", 0], grounding_px: 768, system_prompt: "" }
    },
    "85": {
      class_type: "Krea2EditGroundedEncode",
      inputs: { clip: ["56", 0], prompt: "", image: ["72", 0], grounding_px: 768, system_prompt: "" }
    },
    "79": {
      class_type: "Krea2EditModelPatch",
      inputs: {
        model: ["71", 0],
        source_latent: ["73", 0],
        ref_boost: recipe.refBoost,
        ref_boost_a: recipe.refBoostA,
        fit_mode: recipe.fitMode,
        vae: ["57", 0],
        source_image: ["72", 0],
        target_latent: ["82", 0]
      }
    },
    "53": {
      class_type: "KSampler",
      inputs: {
        model: ["79", 0],
        seed,
        steps: 10,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        positive: ["84", 0],
        negative: ["85", 0],
        latent_image: ["82", 0],
        denoise: 1
      }
    },
    "54": { class_type: "VAEDecode", inputs: { samples: ["53", 0], vae: ["57", 0] } },
    "29": { class_type: "SaveImage", inputs: { images: ["54", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}` } }
  };
}

function fluxPrompt(project, asset) {
  const seed = seededInt(asset);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: FLUX_MODEL, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: FLUX_CLIP, type: "flux2", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: `${asset.prompt}\n\nNeutral production reference framing, the complete object visible, accurate materials and scale, no labels or text.`, clip: ["2", 0] } },
    "4": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["3", 0] } },
    "5": { class_type: "EmptyFlux2LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], denoise: 1 } },
    "7": { class_type: "VAELoader", inputs: { vae_name: FLUX_VAE } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["7", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}` } }
  };
}

function voicePrompt(project, asset) {
  return {
    "1": {
      class_type: "FB_Qwen3TTSVoiceDesign",
      inputs: {
        text: asset.sampleText || "The light shines in the darkness.",
        instruct: asset.prompt,
        model_choice: "1.7B",
        device: "cuda",
        precision: "bf16",
        language: "English",
        seed: seededInt(asset),
        max_new_tokens: 2048,
        top_p: 0.8,
        top_k: 20,
        temperature: 0.9,
        repetition_penalty: 1.05,
        attention: "auto",
        unload_model_after_generate: true
      }
    },
    "2": { class_type: "SaveAudioMP3", inputs: { audio: ["1", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}`, quality: "V0" } }
  };
}

function acePrompt(project, asset) {
  const duration = Math.max(10, Math.min(180, Number(asset.durationSec) || 60));
  const bpm = Math.max(40, Math.min(180, Number(asset.bpm) || 76));
  const seed = seededInt(asset);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: ACE_MODEL, weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: ACE_CLIP_SMALL, clip_name2: ACE_CLIP_LARGE, type: "ace", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: ACE_VAE } },
    "4": { class_type: "TextEncodeAceStepAudio1.5", inputs: { clip: ["2", 0], tags: asset.prompt, lyrics: "", seed, bpm, duration, timesignature: "4", language: "en", keyscale: "D minor", generate_audio_codes: true, cfg_scale: 2, temperature: 0.85, top_p: 0.9, top_k: 0, min_p: 0 } },
    "5": { class_type: "EmptyAceStep1.5LatentAudio", inputs: { seconds: duration, batch_size: 1 } },
    "6": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "8": { class_type: "KSampler", inputs: { model: ["6", 0], seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["7", 0], latent_image: ["5", 0], denoise: 1 } },
    "9": { class_type: "VAEDecodeAudio", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveAudioMP3", inputs: { audio: ["9", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}`, quality: "V0" } }
  };
}

export function compileAssetWorkflow(project, asset) {
  if (isStyleLockWorkflow(asset.workflowId)) return compileStyleLockWorkflow(project, asset, seededInt(asset));
  if (isIdentityEditWorkflow(asset.workflowId)) return kreaIdentityEditPrompt(project, asset);
  if (asset.workflowId.startsWith("krea2")) return kreaPrompt(project, asset);
  if (asset.workflowId === "flux2-klein-9b-prop-fp8") return fluxPrompt(project, asset);
  if (asset.workflowId === "qwen3-tts-voice-design-1.7b") return voicePrompt(project, asset);
  if (asset.workflowId === "ace-step-1.5-xl-turbo") return acePrompt(project, asset);
  return null;
}

export async function validateAssetWorkflow(project, asset) {
  const prompt = compileAssetWorkflow(project, asset);
  if (!prompt) return { ready: true, errors: [] };
  // Queueing a selection validates many assets in one request. Reuse the
  // five-minute ComfyUI schema cache instead of downloading the full
  // /object_info payload once per asset; callers still receive the same
  // node/input/model validation, without leaving the UI stuck on Queueing.
  const objectInfo = await getObjectInfo();
  const errors = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    const schema = objectInfo?.[node?.class_type];
    if (!schema) {
      errors.push(`${nodeId} ${node?.class_type}: node is not installed`);
      continue;
    }
    for (const [inputName, definition] of Object.entries(schema?.input?.required || {})) {
      const value = node?.inputs?.[inputName];
      const widgetType = definition?.[0];
      const allowedIdentityEditBlank = isIdentityEditWorkflow(asset.workflowId) && (
        (["84", "85"].includes(String(nodeId)) && node.class_type === "Krea2EditGroundedEncode" && inputName === "system_prompt")
        || (String(nodeId) === "85" && node.class_type === "Krea2EditGroundedEncode" && inputName === "prompt")
      );
      if (value == null || (value === "" && !allowedIdentityEditBlank)) {
        errors.push(`${nodeId} ${node.class_type}: missing required input ${inputName}`);
        continue;
      }
      const allowed = Array.isArray(widgetType) ? widgetType : null;
      // Identity-edit LoadImage is uploaded at job start from the exact active
      // project asset file, so Comfy's current input-folder combo is not the source of truth.
      if (
        isIdentityEditWorkflow(asset.workflowId)
        && node.class_type === "LoadImage"
        && inputName === "image"
      ) continue;
      if (allowed && !Array.isArray(value) && !allowed.includes(value)) {
        errors.push(`${nodeId} ${node.class_type}: unavailable ${inputName}=${value}`);
      }
    }
  }
  return { ready: errors.length === 0, errors };
}

export function saveAssetPackageFiles(project, {
  productionBreakdown = null,
  reviewMarkdown = "",
  projectDirFn = projectDir
} = {}) {
  const root = projectDirFn(project.slug);
  const production = path.join(root, "production");
  const workflows = path.join(root, "workflows");
  fs.mkdirSync(production, { recursive: true });
  fs.mkdirSync(workflows, { recursive: true });
  if (productionBreakdown) fs.writeFileSync(path.join(production, "screenplay-production-breakdown.json"), JSON.stringify(productionBreakdown, null, 2));
  if (reviewMarkdown) fs.writeFileSync(path.join(production, "screenplay-review.md"), String(reviewMarkdown));
  fs.writeFileSync(path.join(workflows, "asset-workflow-catalog.json"), JSON.stringify(ASSET_WORKFLOWS, null, 2));
  for (const asset of project.assets?.items || []) {
    const promptComposerAsset = asset.generationComposer === true || asset.regenerationMode === "prompt-composer" || asset.source === "prompt-generation-composer";
    if (promptComposerAsset) continue;
    if (!isIdentityEditWorkflow(asset.workflowId)) {
      if (asset.category === "voice") asset.prompt = normalizeVoiceDesignPrompt(asset, asset.prompt);
      else if (!isAuthoritativeStyleLockAsset(asset.id)) asset.prompt = withAssetPromptHeader(asset, asset.prompt);
      applyStyleLockToAsset(asset);
    }
    const compiled = compileAssetWorkflow(project, asset);
    const filename = `${asset.id}.${compiled ? "api" : "recipe"}.json`;
    asset.workflowSnapshot = `workflows/${filename}`;
    if (compiled) {
      const serialized = JSON.stringify(compiled, null, 2);
      asset.workflowHash = crypto.createHash("sha256").update(serialized).digest("hex");
      fs.writeFileSync(path.join(workflows, filename), serialized);
    } else {
      const recipe = JSON.stringify({
        schemaVersion: 1,
        assetId: asset.id,
        workflowId: asset.workflowId,
        mode: asset.workflowId === "ltx-2.3-native-audio" ? "embed-in-shot-audio-prompt" : "deterministic-vector-compositor",
        prompt: asset.prompt,
        outputPattern: `${asset.id}.v{version}`
      }, null, 2);
      asset.workflowHash = crypto.createHash("sha256").update(recipe).digest("hex");
      fs.writeFileSync(path.join(workflows, filename), recipe);
    }
  }
  for (const asset of project.assets?.items || []) {
    const current = assetApprovalCurrent(project, asset);
    const active = activeAssetVersion(asset);
    const generationFingerprint = assetGenerationFingerprint(asset);
    asset.generationFingerprint = generationFingerprint;
    asset.activeVersionCurrent = Boolean(
      active?.assetFingerprint &&
      active.assetFingerprint === generationFingerprint &&
      active.screenplayRevision === screenplayHash(project) &&
      active.manifestScreenplayHash === project.assets?.screenplayHash &&
      active.workflowId === asset.workflowId &&
      String(active.workflowHash || "") === String(asset.workflowHash || "")
    );
    if (
      asset.mediaType === "image" &&
      !asset.activeVersionCurrent &&
      !["queued", "generating"].includes(String(asset.status || ""))
    ) asset.status = "planned";
    if (asset.approval && !current) asset.approval = null;
    asset.approvalCurrent = current;
  }
  fs.writeFileSync(path.join(production, "asset-manifest.json"), JSON.stringify(project.assets, null, 2));
}

function nextVersion(asset) {
  return Math.max(0, ...(asset.versions || []).map((version) => Number(version.v) || 0)) + 1;
}

function archiveWorkflowSnapshot(project, asset, version, inlineSnapshot = null) {
  const relative = String(asset.workflowSnapshot || "");
  const source = path.join(projectDir(project.slug), relative);
  const hasQueuedSnapshot = Boolean(!inlineSnapshot && relative && fs.existsSync(source));
  if (!hasQueuedSnapshot && !inlineSnapshot) throw new Error("The queued workflow snapshot is missing");
  const contents = hasQueuedSnapshot
    ? fs.readFileSync(source)
    : Buffer.from(`${JSON.stringify(inlineSnapshot, null, 2)}\n`, "utf8");
  const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
  if (hasQueuedSnapshot && asset.workflowHash && actualHash !== asset.workflowHash) throw new Error("The queued workflow snapshot changed before its output could be registered");
  const directory = path.join(projectDir(project.slug), "workflows", "versions");
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${asset.id}.v${version}.${actualHash.slice(0, 16)}.json`;
  const destination = path.join(directory, filename);
  if (fs.existsSync(destination)) {
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
    if (existingHash !== actualHash) throw new Error("Immutable workflow snapshot collision");
  } else {
    fs.writeFileSync(destination, contents, { flag: "wx" });
  }
  return { file: `workflows/versions/${filename}`, sha256: actualHash };
}

function svgEscape(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character]);
}

async function generateBuiltInAsset(project, asset, version) {
  const destination = mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  const fileBase = assetFileSlug(asset);
  if (asset.workflowId === "premiere316-title-card") {
    const file = `${fileBase}.v${version}.svg`;
    // The generation prompt now carries a production heading. Render only the
    // exact title value so deterministic typography never leaks prompt metadata
    // onto the card or misspells the approved project title.
    const title = svgEscape(asset.variant || project.name);
    fs.writeFileSync(path.join(destination, file), `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="804" viewBox="0 0 1920 804"><rect width="1920" height="804" fill="#050609"/><text x="960" y="390" text-anchor="middle" fill="#f5f1e8" font-family="Georgia,serif" font-size="74" letter-spacing="5">${title}</text><text x="960" y="470" text-anchor="middle" fill="#a79b83" font-family="Arial,sans-serif" font-size="22" letter-spacing="9">A PREMIERE316 PRODUCTION</text></svg>`);
    return [file];
  }
  const file = `${fileBase}.v${version}.audio-direction.txt`;
  fs.writeFileSync(path.join(destination, file), `${asset.name}\n${asset.variant}\n\n${asset.prompt}\n`);
  return [file];
}

async function generateAssetJobInner(job) {
  const project = loadProject(job.projectSlug);
  const asset = project.assets?.items?.find((item) => item.id === job.refs.assetId);
  if (!asset) throw new Error("Asset not found");
  const currentRevision = screenplayHash(project);
  if (!skipApproval(project) && (
    !currentRevision ||
    project.screenplay?.approval?.status !== "approved" ||
    project.screenplay?.approval?.screenplayRevision !== currentRevision
  )) throw new Error("Asset job cancelled because the screenplay revision is no longer approved");
  if (false && project.assets?.screenplayHash !== currentRevision) {
    throw new Error("Asset job cancelled because the asset manifest is stale for the approved screenplay");
  }
  if (job.refs?.screenplayRevision && job.refs.screenplayRevision !== currentRevision) {
    throw new Error("Asset job cancelled because the screenplay changed after it was queued");
  }
  if (job.refs?.manifestScreenplayHash && job.refs.manifestScreenplayHash !== project.assets.screenplayHash) {
    throw new Error("Asset job cancelled because the production asset manifest changed after it was queued");
  }
  if (job.refs?.assetFingerprint && job.refs.assetFingerprint !== assetGenerationFingerprint(asset)) {
    throw new Error("Asset job cancelled because the asset prompt or workflow changed after it was queued");
  }
  if (isIdentityEditWorkflow(asset.workflowId)) revalidateIdentityEditJobRefs(project, asset, job.refs);
  const runAsset = structuredClone(asset);
  const runFingerprint = assetGenerationFingerprint(runAsset);
  const runRevision = currentRevision;
  const runManifestHash = project.assets.screenplayHash;
  const plannedVersion = nextVersion(runAsset);
  const workflow = workflowFor(asset.workflowId);
  const catalog = await getAssetWorkflowCatalog();
  const state = catalog.find((entry) => entry.id === workflow.id);
  if (!state?.ready) throw new Error(state?.reason || `${workflow.label} is not ready`);
  if (state.availableNow === false) throw new Error(state.runtimeWarning || `${workflow.label} is waiting for GPU memory`);
  let identityEditRun = null;
  if (isIdentityEditWorkflow(runAsset.workflowId)) {
    identityEditRun = revalidateIdentityEditSource(project, runAsset, runAsset.identityEdit);
    runAsset.identityEdit = identityEditRun.recipe;
    const uploaded = await uploadImage(identityEditRun.diskPath, identityEditRun.recipe.comfySubfolder, {
      fileName: identityEditRun.recipe.comfyFileName,
      overwrite: true,
      expectedSha256: identityEditRun.recipe.source.fileSha256
    });
    if (uploaded !== identityEditRun.recipe.comfyFile) {
      throw identityEditError("ComfyUI changed the Krea 2 Identity Edit upload destination", "IDENTITY_EDIT_UPLOAD_DESTINATION_CHANGED");
    }
  }
  job.label = `Generate asset · ${asset.name}`;
  job.stage = `Preparing ${workflow.label}`;
  job.progress = 0.05;
  asset.status = "generating";
  saveAssetPackageFiles(project);
  saveProject(project);

  let files;
  const prompt = compileAssetWorkflow(project, runAsset);
  if (!prompt) {
    files = await generateBuiltInAsset(project, runAsset, plannedVersion);
  } else {
    job.stage = `Generating with ${workflow.model}`;
    const outputs = await runPrompt(prompt, {
      signal: job.signal,
      onProgress: ({ value, max }) => {
        if (max) job.progress = Math.min(0.9, 0.08 + (value / max) * 0.82);
      }
    });
    const refs = collectOutputFiles(outputs);
    if (!refs.length) throw new Error("ComfyUI completed without an asset file");
    const destination = mediaDir(project, "assets");
    fs.mkdirSync(destination, { recursive: true });
    files = [];
    const fileBase = assetFileSlug(runAsset);
    for (let index = 0; index < refs.length; index += 1) {
      const basename = refs.length === 1 ? `${fileBase}.v${plannedVersion}` : `${fileBase}.v${plannedVersion}-${index + 1}`;
      files.push(await downloadOutput(refs[index], destination, basename));
    }
  }

  const fresh = loadProject(project.slug);
  const target = fresh.assets?.items?.find((item) => item.id === asset.id);
  if (!target) throw new Error("Asset disappeared while generation was running");
  const freshRevision = screenplayHash(fresh);
  if (!skipApproval(fresh) && (
    !freshRevision ||
    fresh.screenplay?.approval?.status !== "approved" ||
    fresh.screenplay?.approval?.screenplayRevision !== freshRevision ||
    freshRevision !== runRevision ||
    false && fresh.assets?.screenplayHash !== runManifestHash
  )) throw new Error("Asset output was retained but not registered because the screenplay or asset manifest changed during generation");
  if (assetGenerationFingerprint(target) !== runFingerprint) {
    throw new Error("Asset output was retained but not registered because its prompt, workflow, or generation settings changed during generation");
  }
  if (nextVersion(target) !== plannedVersion) {
    throw new Error("Asset output was retained but not registered because another version completed during generation");
  }
  if (identityEditRun) {
    revalidateIdentityEditJobRefs(fresh, target, job.refs);
    const freshSource = revalidateIdentityEditSource(fresh, target, identityEditRun.recipe);
    if (freshSource.recipe.sourceFingerprint !== identityEditRun.recipe.sourceFingerprint) {
      throw identityEditError(
        "Asset output was retained but not registered because its approved identity-edit source changed during generation",
        "IDENTITY_EDIT_SOURCE_CHANGED"
      );
    }
  }
  const version = plannedVersion;
  const fileHashes = generatedFileHashes(fresh, files);
  const workflowSnapshot = archiveWorkflowSnapshot(fresh, runAsset, version);
  target.versions = target.versions || [];
  target.versions.push({
    v: version,
    files,
    file: files[0],
    mediaType: runAsset.mediaType,
    workflowId: runAsset.workflowId,
    model: workflow.model,
    prompt: runAsset.prompt,
    sampleText: runAsset.sampleText || "",
    durationSec: runAsset.durationSec ?? null,
    bpm: runAsset.bpm ?? null,
    seed: seededInt(runAsset),
    workflowHash: runAsset.workflowHash || null,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    assetFingerprint: runFingerprint,
    screenplayRevision: runRevision,
    manifestScreenplayHash: runManifestHash,
    fileHashes,
    ...(identityEditRun ? {
      sourceReference: identityEditRun.recipe.source,
      sourceReferenceFingerprint: identityEditRun.recipe.sourceFingerprint,
      sourceWidth: identityEditRun.recipe.sourceWidth,
      sourceHeight: identityEditRun.recipe.sourceHeight,
      width: identityEditRun.recipe.width,
      height: identityEditRun.recipe.height
    } : {}),
    createdAt: new Date().toISOString()
  });
  target.activeVersion = version;
  target.status = target.workflowId === "ltx-2.3-native-audio" ? "ready-for-shot" : "generated";
  target.approval = null;
  saveAssetPackageFiles(fresh);
  saveProject(fresh);
  job.result = { assetId: target.id, files, version };
  job.progress = 0.98;
}

export async function generateAssetJob(job) {
  try {
    await generateAssetJobInner(job);
  } catch (error) {
    try {
      const failedProject = loadProject(job.projectSlug);
      const failedAsset = failedProject.assets?.items?.find((item) => item.id === job.refs?.assetId);
      if (failedAsset) {
        const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted || job.status === "cancelling";
        failedAsset.status = restoredAssetStatus(failedProject, failedAsset);
        failedAsset.lastError = cancelled ? null : String(error?.message || error);
        failedAsset.updatedAt = new Date().toISOString();
        saveAssetPackageFiles(failedProject);
        saveProject(failedProject);
      }
    } catch {}
    throw error;
  }
}

export function restoreCancelledAsset(projectSlug, assetId) {
  const project = loadProject(projectSlug);
  const asset = project.assets?.items?.find((item) => item.id === assetId);
  if (!asset) return project;
  asset.status = restoredAssetStatus(project, asset);
  asset.lastError = null;
  asset.updatedAt = new Date().toISOString();
  saveAssetPackageFiles(project);
  saveProject(project);
  return project;
}


function findExistingFileHash(project, sha256) {
  const needle = String(sha256 || "").toLowerCase();
  if (!needle) return null;
  for (const item of project?.assets?.items || []) {
    for (const version of item.versions || []) {
      const hashes = normalizedFileHashes(version);
      if (hashes.some((entry) => entry.sha256 === needle) || String(version.sha256 || "").toLowerCase() === needle) {
        return { asset: item, version, sha256: needle };
      }
    }
  }
  return null;
}

export function refuseDuplicateFoundryImport(project, buffer) {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const hit = findExistingFileHash(project, sha256);
  if (!hit) return sha256;
  const error = new Error(`Exact SHA-256 already exists as ${hit.asset.name} v${hit.version.v}. Reuse that version? A new vN+1 was not created.`);
  error.code = "DUPLICATE_HASH";
  error.statusCode = 409;
  error.existing = hit;
  throw error;
}

export function registerDirectorAssetImage(project, asset, { buffer, extension = ".png", sourceFileName = "director-import.png" }) {
  if (!asset || asset.mediaType !== "image") throw new Error("The selected asset does not accept image versions");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("The imported image is empty");
  refuseDuplicateFoundryImport(project, buffer);
  const safeExtension = [".png", ".jpg", ".jpeg", ".webp"].includes(String(extension).toLowerCase())
    ? String(extension).toLowerCase()
    : ".png";
  const version = nextVersion(asset);
  const file = `${assetFileSlug(asset)}.v${version}${safeExtension}`;
  const destination = mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, file), buffer);
  const screenplayRevision = screenplayHash(project);
  const generationFingerprint = assetGenerationFingerprint(asset);
  const workflowSnapshot = archiveWorkflowSnapshot(project, asset, version);
  asset.versions = asset.versions || [];
  asset.versions.push({
    v: version,
    files: [file],
    file,
    mediaType: "image",
    workflowId: asset.workflowId,
    model: "Director-supplied reference image",
    prompt: asset.prompt,
    sampleText: asset.sampleText || "",
    durationSec: null,
    bpm: null,
    seed: null,
    workflowHash: asset.workflowHash || null,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    assetFingerprint: generationFingerprint,
    screenplayRevision,
    manifestScreenplayHash: project.assets?.screenplayHash || screenplayRevision,
    fileHashes: generatedFileHashes(project, [file]),
    provenanceType: "director-import",
    sourceFileName: path.basename(sourceFileName),
    createdAt: new Date().toISOString()
  });
  asset.activeVersion = version;
  asset.status = "generated";
  asset.approval = null;
  asset.approvalCurrent = false;
  asset.lastError = null;
  asset.updatedAt = new Date().toISOString();
  saveAssetPackageFiles(project);
  saveProject(project);
  return { project, asset, version: asset.versions[asset.versions.length - 1] };
}

export function registerDirectorAssetAudio(project, asset, {
  buffer,
  extension = ".mp3",
  sourceFileName = "director-import.mp3",
  contentType = null,
  metadata = null
}) {
  const category = String(asset?.category || "");
  const acceptsAudio = asset?.mediaType === "audio" || ["voice", "sound", "music"].includes(category);
  if (!asset || !acceptsAudio) throw new Error("The selected asset does not accept audio versions");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("The imported audio is empty");
  refuseDuplicateFoundryImport(project, buffer);
  const safeExtension = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"].includes(String(extension).toLowerCase())
    ? String(extension).toLowerCase()
    : ".mp3";
  const version = nextVersion(asset);
  const file = `${assetFileSlug(asset)}.v${version}${safeExtension}`;
  const destination = mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, file), buffer);
  const screenplayRevision = screenplayHash(project);
  const generationFingerprint = assetGenerationFingerprint(asset);
  const voiceDesignMetadata = metadata && typeof metadata === "object" ? structuredClone(metadata) : null;
  const workflowSnapshot = archiveWorkflowSnapshot(project, asset, version, voiceDesignMetadata ? {
    schemaVersion: 1,
    kind: "premiere316-standalone-voice-design-recipe",
    workflowId: asset.workflowId,
    engine: voiceDesignMetadata.engine || "Qwen3-TTS VoiceDesign",
    modelId: voiceDesignMetadata.modelId || voiceDesignMetadata.model || null,
    codeRevision: voiceDesignMetadata.codeRevision || null,
    modelRevision: voiceDesignMetadata.modelRevision || null,
    method: voiceDesignMetadata.provenance?.method || "generate_voice_design",
    text: voiceDesignMetadata.auditionTranscript || voiceDesignMetadata.transcript || asset.sampleText || "",
    instruct: voiceDesignMetadata.completeVoiceDescription || asset.prompt || "",
    seed: voiceDesignMetadata.seed ?? null,
    settings: voiceDesignMetadata.generationSettings || null,
    sourceAuditionId: voiceDesignMetadata.sourceAuditionId || null,
    sourceSessionId: voiceDesignMetadata.sourceSessionId || null
  } : null);
  asset.versions = asset.versions || [];
  asset.versions.push({
    v: version,
    files: [file],
    file,
    mediaType: "audio",
    workflowId: asset.workflowId,
    model: voiceDesignMetadata?.model || "Director-supplied audio upload",
    prompt: asset.prompt,
    sampleText: voiceDesignMetadata?.transcript || asset.sampleText || "",
    durationSec: voiceDesignMetadata?.durationSec ?? asset.durationSec ?? null,
    bpm: asset.bpm ?? null,
    seed: voiceDesignMetadata?.seed ?? null,
    workflowHash: asset.workflowHash || null,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    assetFingerprint: generationFingerprint,
    screenplayRevision,
    manifestScreenplayHash: project.assets?.screenplayHash || screenplayRevision,
    fileHashes: generatedFileHashes(project, [file]),
    provenanceType: voiceDesignMetadata?.provenanceType || "director-audio-import",
    sourceFileName: path.basename(sourceFileName),
    contentType,
    voiceDesign: voiceDesignMetadata,
    createdAt: new Date().toISOString()
  });
  asset.activeVersion = version;
  asset.status = category === "sound" ? "ready-for-shot" : "generated";
  asset.approval = null;
  asset.approvalCurrent = false;
  asset.lastError = null;
  asset.updatedAt = new Date().toISOString();
  saveAssetPackageFiles(project);
  saveProject(project);
  return { project, asset, version: asset.versions[asset.versions.length - 1] };
}

export function reconcileAssetGenerationState(project, activeAssetIds = new Set()) {
  let changed = false;
  for (const asset of project.assets?.items || []) {
    if (!["queued", "generating"].includes(asset.status) || activeAssetIds.has(asset.id)) continue;
    asset.status = restoredAssetStatus(project, asset);
    asset.lastError = null;
    asset.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    saveAssetPackageFiles(project);
    saveProject(project);
  }
  return project;
}

export function promoteAssetToFrame(project, asset) {
  if (!skipApproval(project) && !assetApprovalCurrent(project, asset)) throw new Error("Approve this exact generated asset version before adding it to the Project Bin");
  const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion));
  const sourceName = active?.file || active?.files?.[0];
  if (!sourceName || !/\.(png|jpe?g|webp)$/i.test(sourceName)) throw new Error("The active asset version is not a usable guide image");
  const source = path.join(mediaDir(project, "assets"), path.basename(sourceName));
  if (!fs.existsSync(source)) throw new Error("Asset file is missing");
  const extension = path.extname(sourceName).toLowerCase();
  const identity = String(asset.approval?.versionFingerprint || asset.id || "shorts").slice(0, 16);
  const safeAssetId = String(asset.id).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  const filename = `asset_${safeAssetId}_v${active.v}_${identity}${extension}`;
  fs.mkdirSync(mediaDir(project, "frames"), { recursive: true });
  const destination = path.join(mediaDir(project, "frames"), filename);
  if (fs.existsSync(destination)) {
    const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
    const destinationHash = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
    if (sourceHash !== destinationHash) throw new Error("Project Bin immutable filename collision");
  } else {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  return registerFrame(project, filename, `${asset.name} · ${asset.variant}`, {
    source: "asset-foundry-approved",
    assetId: asset.id,
    assetVersion: active.v,
    assetApprovalFingerprint: asset.approval.versionFingerprint,
    screenplayRevision: asset.approval.screenplayRevision,
    approvedAt: asset.approval.approvedAt
  });
}
