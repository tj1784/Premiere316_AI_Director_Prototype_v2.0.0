import crypto from "crypto";
import path from "path";

import {
  CLIENT_OWNED_REFERENCE_FIELDS,
  findExactAssetVersion
} from "./asset-reference-resolver.js";

export const GENERATION_COMPOSER_SCHEMA_VERSION = 1;
export const GENERATION_OUTPUT_KINDS = Object.freeze([
  "image",
  "video",
  "voice",
  "dialogue",
  "design",
  "audio"
]);

export const STORYBOARD_KREA_GENERATION_WORKFLOW_ID = "premiere316-storyboard-krea2-reference-subgraphs";
export const STORYBOARD_LTX25_GENERATION_WORKFLOW_ID = "premiere316-storyboard-ltx25-t2v-semantic-reference";

const T2V_GENERATION_MODE = "t2v_with_semantic_references";
const T2V_WORKFLOW_PROFILE = "ltx-2.5-t2v-semantic-reference-resolver";
const SHA256_RE = /^[a-f0-9]{64}$/i;
const MAX_PROMPT_LENGTH = 50_000;
const MAX_NOTE_LENGTH = 2_000;

const ROLE_ALIASES = Object.freeze({
  identity: "identity",
  character: "identity",
  face: "identity",
  actor: "identity",
  wardrobe: "wardrobe",
  costume: "wardrobe",
  clothing: "wardrobe",
  location: "location",
  environment: "location",
  set: "location",
  composition: "location",
  prop: "prop",
  artifact: "prop",
  vehicle: "prop",
  crowd: "crowd",
  crowds: "crowd",
  extra: "crowd",
  extras: "crowd",
  creature: "crowd",
  atmosphere: "atmosphere",
  atmosphere_vfx: "atmosphere",
  vfx: "atmosphere",
  lighting: "atmosphere",
  style: "atmosphere"
});

export const GENERATION_REFERENCE_ROLES = Object.freeze([
  "identity",
  "wardrobe",
  "location",
  "prop",
  "crowd",
  "atmosphere"
]);

const OPTION_SCHEMAS = Object.freeze({
  storyboardImage: {
    type: "object",
    additionalProperties: false,
    properties: {
      aspectRatio: { type: "string", enum: ["16:9", "2.39:1", "2:3", "1:1"] },
      negativePrompt: { type: "string", maxLength: 10_000 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  },
  storyboardVideo: {
    type: "object",
    additionalProperties: false,
    properties: {
      durationSec: { type: "number", minimum: 1, maximum: 180 },
      fps: { type: "integer", minimum: 1, maximum: 60 },
      width: { type: "integer", minimum: 32, multipleOf: 32 },
      height: { type: "integer", minimum: 32, multipleOf: 32 },
      negativePrompt: { type: "string", maxLength: 10_000 },
      seed: { type: ["integer", "null"], minimum: 0 },
      audioMode: { type: "string", enum: ["generated_ambience"] }
    }
  },
  assetImage: {
    type: "object",
    additionalProperties: false,
    properties: { seed: { type: ["integer", "null"], minimum: 0 } }
  },
  voice: {
    type: "object",
    additionalProperties: false,
    properties: {
      sampleText: { type: "string", maxLength: 20_000 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  },
  music: {
    type: "object",
    additionalProperties: false,
    properties: {
      durationSec: { type: "number", minimum: 10, maximum: 180 },
      bpm: { type: "number", minimum: 40, maximum: 180 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  },
  none: { type: "object", additionalProperties: false, properties: {} }
});

const VISUAL_REFERENCE_POLICY_20 = Object.freeze({
  acceptedMediaTypes: ["image"],
  acceptedRoles: GENERATION_REFERENCE_ROLES,
  minimum: 1,
  maximum: 20,
  orderSignificant: true
});

const VISUAL_REFERENCE_POLICY_9 = Object.freeze({
  acceptedMediaTypes: ["image"],
  acceptedRoles: GENERATION_REFERENCE_ROLES,
  minimum: 0,
  maximum: 9,
  orderSignificant: true
});

const NO_PROJECT_REFERENCES = Object.freeze({
  acceptedMediaTypes: [],
  acceptedRoles: [],
  minimum: 0,
  maximum: 0,
  orderSignificant: false
});

function adapter(definition) {
  return {
    adapterRevision: "generation-composer.v1",
    creatable: true,
    readinessSource: "runtime_hook",
    referencePolicy: NO_PROJECT_REFERENCES,
    ...definition
  };
}

function assetImage(id, label, purpose, extra = {}) {
  return adapter({
    id,
    label,
    purpose,
    source: "asset_foundry",
    compiler: "compileAssetWorkflow",
    createMode: "asset_foundry_asset",
    outputKinds: ["image", "design"],
    optionProfile: "assetImage",
    optionSchema: OPTION_SCHEMAS.assetImage,
    ...extra
  });
}

const WORKFLOW_ADAPTERS = [
  adapter({
    id: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    label: "Storyboard Krea 2 · Exact Project References",
    purpose: "Reference-conditioned image or design generation from explicit project asset versions.",
    source: "storyboard",
    compiler: "compileStoryboardFramePrompt",
    createMode: "synthetic_storyboard_frame",
    outputKinds: ["image", "design"],
    optionProfile: "storyboardImage",
    optionSchema: OPTION_SCHEMAS.storyboardImage,
    referencePolicy: VISUAL_REFERENCE_POLICY_20
  }),
  adapter({
    id: STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
    label: "LTX 2.5 T2V · Semantic Project References",
    purpose: "Native text-to-video with explicit, ordered semantic image references and one Prompt Relay segment.",
    source: "storyboard",
    compiler: "compileStoryboardVideoPlanPrompt",
    createMode: "synthetic_storyboard_video_plan",
    outputKinds: ["video"],
    optionProfile: "storyboardVideo",
    optionSchema: OPTION_SCHEMAS.storyboardVideo,
    referencePolicy: VISUAL_REFERENCE_POLICY_9
  }),
  assetImage("ci-flux2-p316-style-only-2p39x1-max", "CI FLUX.2 Style-Lock · 2.39:1 MAX", "Cinematic Asset Foundry images with fixed style-only plates."),
  assetImage("ci-flux2-p316-style-only-4x3-max", "CI FLUX.2 Style-Lock · 4:3 MAX", "General Asset Foundry images with fixed style-only plates."),
  assetImage("ci-flux2-p316-style-only-16x9-max", "CI FLUX.2 Style-Lock · 16:9 MAX", "Widescreen Asset Foundry images with fixed style-only plates."),
  assetImage("ci-flux2-p316-style-only-2x3-vertical-max", "CI FLUX.2 Style-Lock · 2:3 Vertical MAX", "Vertical Asset Foundry images with fixed style-only plates."),
  assetImage("ci-flux2-jesus-only-character-sheet-4x3-max", "CI FLUX.2 · Jesus Identity Sheet 4:3 MAX", "Asset-specific Jesus identity-sheet compiler.", { assetSpecific: true }),
  assetImage("krea2-character-ingredients-fp8", "Krea 2 Character Ingredients · BF16", "Asset Foundry character reference sheets; this existing compiler does not accept arbitrary project references."),
  assetImage("krea2-cinematic-still-fp8", "Krea 2 Cinematic Still · BF16", "Asset Foundry locations, props, VFX references and guide images; no arbitrary project-reference injection."),
  assetImage("flux2-klein-9b-prop-fp8", "Flux 2 Klein 9B · Prop Studio", "Asset Foundry prop and material plates; no arbitrary project-reference injection."),
  adapter({
    id: "qwen3-tts-voice-design-1.7b",
    label: "Qwen3-TTS VoiceDesign · 1.7B",
    purpose: "Voice auditions and spoken dialogue/audio stems.",
    source: "asset_foundry",
    compiler: "compileAssetWorkflow",
    createMode: "asset_foundry_asset",
    outputKinds: ["voice", "dialogue", "audio"],
    optionProfile: "voice",
    optionSchema: OPTION_SCHEMAS.voice
  }),
  adapter({
    id: "ace-step-1.5-xl-turbo",
    label: "ACE-Step 1.5 XL Turbo",
    purpose: "Music and score audio stems.",
    source: "asset_foundry",
    compiler: "compileAssetWorkflow",
    createMode: "asset_foundry_asset",
    outputKinds: ["audio"],
    optionProfile: "music",
    optionSchema: OPTION_SCHEMAS.music
  }),
  adapter({
    id: "ltx-2.3-native-audio",
    label: "LTX 2.3 Native Shot Audio",
    purpose: "A shot-level audio recipe embedded in LTX video, not a standalone Asset Foundry compiler.",
    source: "asset_foundry",
    compiler: null,
    createMode: "recipe_only",
    outputKinds: ["audio"],
    optionProfile: "none",
    optionSchema: OPTION_SCHEMAS.none,
    creatable: false,
    blockReason: "This workflow is recipe-only and has no standalone generation compiler.",
    readinessSource: "built_in_recipe"
  }),
  adapter({
    id: "premiere316-title-card",
    label: "Premiere316 Deterministic Title Card",
    purpose: "Deterministic SVG title cards without diffusion spelling errors.",
    source: "asset_foundry",
    compiler: "compileAssetWorkflow",
    createMode: "asset_foundry_asset",
    outputKinds: ["design", "image"],
    optionProfile: "none",
    optionSchema: OPTION_SCHEMAS.none,
    readinessSource: "built_in"
  })
];

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export const GENERATION_WORKFLOW_ADAPTERS = deepFreeze(WORKFLOW_ADAPTERS);
const WORKFLOW_BY_ID = new Map(GENERATION_WORKFLOW_ADAPTERS.map((item) => [item.id, item]));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalRole(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ROLE_ALIASES[normalized] || null;
}

function readinessEntry(source, workflowId) {
  if (!source) return null;
  if (source instanceof Map) return source.get(workflowId) || null;
  if (Array.isArray(source)) return source.find((item) => item?.id === workflowId || item?.workflowId === workflowId) || null;
  return source[workflowId] || null;
}

function workflowReadiness(item, source) {
  const supplied = readinessEntry(source, item.id);
  if (supplied) {
    const ready = typeof supplied.ready === "boolean" ? supplied.ready : (typeof supplied.installed === "boolean" ? supplied.installed : null);
    const availableNow = typeof supplied.availableNow === "boolean" ? supplied.availableNow : ready;
    return {
      ready,
      availableNow,
      reason: supplied.reason || supplied.runtimeWarning || null,
      checkedAt: supplied.checkedAt || null,
      source: "runtime_hook"
    };
  }
  if (item.readinessSource === "built_in") {
    return { ready: true, availableNow: true, reason: "Built into Premiere316", checkedAt: null, source: "built_in" };
  }
  if (item.readinessSource === "built_in_recipe") {
    return { ready: true, availableNow: false, reason: item.blockReason, checkedAt: null, source: "built_in_recipe" };
  }
  return { ready: null, availableNow: null, reason: "Runtime readiness has not been checked", checkedAt: null, source: "unchecked" };
}

export function getGenerationWorkflowAdapter(workflowId) {
  const item = WORKFLOW_BY_ID.get(String(workflowId || ""));
  return item ? clone(item) : null;
}

export function getGenerationWorkflowCatalog({ readinessByWorkflow } = {}) {
  return GENERATION_WORKFLOW_ADAPTERS.map((item) => {
    const readiness = workflowReadiness(item, readinessByWorkflow);
    const supportedOutputModes = item.outputKinds.map((kind) => kind === "voice" ? "voice-design" : kind);
    return deepFreeze({
      ...clone(item),
      supportedOutputModes,
      referenceMediaTypes: [...item.referencePolicy.acceptedMediaTypes],
      ready: readiness.ready,
      availableNow: readiness.availableNow,
      reason: readiness.reason,
      runtimeWarning: readiness.availableNow === false ? readiness.reason : null,
      readiness
    });
  });
}

function issue(code, pathValue, message, details) {
  return { code, path: pathValue, message, ...(details === undefined ? {} : { details }) };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableGenerationFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function inferredAspectRatio(project) {
  const authored = String(project?.settings?.aspectRatio || "").trim();
  if (["16:9", "2.39:1", "2:3", "1:1"].includes(authored)) return authored;
  const width = Number(project?.settings?.width);
  const height = Number(project?.settings?.height);
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  if (ratio > 2) return "2.39:1";
  if (ratio < 0.8) return "2:3";
  if (ratio < 1.2) return "1:1";
  return "16:9";
}

function validateSeed(raw, errors, pathValue) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!Number.isSafeInteger(raw) || raw < 0) {
    errors.push(issue("invalid_option", pathValue, "seed must be a non-negative safe integer or null"));
    return null;
  }
  return raw;
}

function validateOptions(item, outputKind, rawOptions, project, errors) {
  if (rawOptions === undefined) rawOptions = {};
  if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
    errors.push(issue("invalid_options", "options", "options must be an object"));
    rawOptions = {};
  }
  const allowed = new Set(Object.keys(item.optionSchema.properties));
  for (const key of Object.keys(rawOptions)) {
    if (!allowed.has(key)) errors.push(issue("unknown_option", `options.${key}`, `${key} is not supported by ${item.id}`));
  }

  const stringOption = (key, fallback = "") => {
    if (rawOptions[key] === undefined) return fallback;
    if (typeof rawOptions[key] !== "string") {
      errors.push(issue("invalid_option", `options.${key}`, `${key} must be a string`));
      return fallback;
    }
    return rawOptions[key].trim();
  };
  const numberOption = (key, fallback, minimum, maximum, integer = false) => {
    if (rawOptions[key] === undefined) return fallback;
    const value = rawOptions[key];
    if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum || value > maximum) {
      errors.push(issue("invalid_option", `options.${key}`, `${key} must be ${integer ? "an integer" : "a number"} from ${minimum} to ${maximum}`));
      return fallback;
    }
    return value;
  };

  if (item.optionProfile === "storyboardImage") {
    const aspectRatio = stringOption("aspectRatio", inferredAspectRatio(project));
    if (!["16:9", "2.39:1", "2:3", "1:1"].includes(aspectRatio)) {
      errors.push(issue("invalid_option", "options.aspectRatio", "aspectRatio must be 16:9, 2.39:1, 2:3, or 1:1"));
    }
    const negativePrompt = stringOption("negativePrompt");
    if (negativePrompt.length > 10_000) errors.push(issue("invalid_option", "options.negativePrompt", "negativePrompt is too long"));
    return { aspectRatio, negativePrompt, seed: validateSeed(rawOptions.seed, errors, "options.seed") };
  }
  if (item.optionProfile === "storyboardVideo") {
    const durationSec = numberOption("durationSec", 5, 1, 180);
    const fps = numberOption("fps", Number(project?.settings?.fps) || 24, 1, 60, true);
    const width = numberOption("width", 768, 32, 8192, true);
    const height = numberOption("height", 320, 32, 8192, true);
    if (width % 32 !== 0) errors.push(issue("invalid_option", "options.width", "width must be a multiple of 32"));
    if (height % 32 !== 0) errors.push(issue("invalid_option", "options.height", "height must be a multiple of 32"));
    const authoredFrames = durationSec * fps;
    if (!Number.isInteger(authoredFrames) || authoredFrames < 1 || authoredFrames % 8 !== 0) {
      errors.push(issue("invalid_frame_contract", "options.durationSec", "durationSec × fps must be a positive multiple of 8 authored frames so LTX can generate 8n+1 and trim one decoded frame"));
    }
    const audioMode = stringOption("audioMode", "generated_ambience");
    if (audioMode !== "generated_ambience") errors.push(issue("invalid_option", "options.audioMode", "Only generated_ambience is runnable in the current T2V compiler"));
    const negativePrompt = stringOption("negativePrompt");
    if (negativePrompt.length > 10_000) errors.push(issue("invalid_option", "options.negativePrompt", "negativePrompt is too long"));
    return { durationSec, fps, width, height, negativePrompt, seed: validateSeed(rawOptions.seed, errors, "options.seed"), audioMode };
  }
  if (item.optionProfile === "voice") {
    const sampleText = stringOption("sampleText", outputKind === "dialogue" ? "" : "The light shines in the darkness.");
    if (sampleText.length > 20_000) errors.push(issue("invalid_option", "options.sampleText", "sampleText is too long"));
    if (outputKind === "dialogue" && !sampleText) errors.push(issue("missing_dialogue_text", "options.sampleText", "Dialogue generation requires exact sampleText"));
    return { sampleText, seed: validateSeed(rawOptions.seed, errors, "options.seed") };
  }
  if (item.optionProfile === "music") {
    return {
      durationSec: numberOption("durationSec", 60, 10, 180),
      bpm: numberOption("bpm", 76, 40, 180),
      seed: validateSeed(rawOptions.seed, errors, "options.seed")
    };
  }
  if (item.optionProfile === "assetImage") return { seed: validateSeed(rawOptions.seed, errors, "options.seed") };
  return {};
}

function normalizedManifestFile(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) return null;
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function mediaTypeFromFile(file) {
  const extension = path.posix.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".tif", ".tiff"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"].includes(extension)) return "video";
  if ([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aif", ".aiff"].includes(extension)) return "audio";
  return null;
}

function isStillsPinWorkflow(item) {
  return item?.compiler === "compileStoryboardFramePrompt";
}

function rejectClientOwnedReferenceFields(pin, basePath, errors, rejectFile = false) {
  for (const field of CLIENT_OWNED_REFERENCE_FIELDS) {
    // LTX/video composer tests treat `file` as an ignored client claim.
    // Stills pins reject every client-owned filesystem field, including `file`.
    if (field === "file" && !rejectFile) continue;
    if (Object.hasOwn(pin, field)) {
      errors.push(issue(
        "client_owned_file_rejected",
        `${basePath}.${field}`,
        `Client-supplied ${field} is not accepted; the server resolves the asset file`
      ));
      return true;
    }
  }
  return false;
}

function resolveProjectReferences(project, rawReferences, item, errors, warnings) {
  if (rawReferences === undefined) rawReferences = [];
  if (!Array.isArray(rawReferences)) {
    errors.push(issue("invalid_references", "references", "references must be an array"));
    return [];
  }
  const assets = Array.isArray(project?.assets?.items) ? project.assets.items : [];
  const assetById = new Map(assets.map((asset) => [asset?.id, asset]));
  const seen = new Map();
  const resolved = [];

  rawReferences.forEach((pin, index) => {
    const basePath = `references[${index}]`;
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
      errors.push(issue("invalid_reference", basePath, "Each reference must be an object"));
      return;
    }
    if (rejectClientOwnedReferenceFields(pin, basePath, errors, isStillsPinWorkflow(item))) return;
    const assetId = typeof pin.assetId === "string" ? pin.assetId.trim() : "";
    if (!assetId) {
      errors.push(issue("missing_asset_id", `${basePath}.assetId`, "assetId is required"));
      return;
    }
    if (!Number.isInteger(pin.assetVersion) || pin.assetVersion < 1) {
      errors.push(issue("invalid_asset_version", `${basePath}.assetVersion`, "assetVersion must be a positive integer"));
      return;
    }
    const role = canonicalRole(pin.role);
    if (!role) {
      errors.push(issue("invalid_reference_role", `${basePath}.role`, "role must be an explicit supported semantic role"));
      return;
    }
    if (!item.referencePolicy.acceptedRoles.includes(role)) {
      errors.push(issue("unsupported_reference_role", `${basePath}.role`, `${item.id} does not accept the ${role} reference role`));
      return;
    }
    if (!Number.isInteger(pin.order) || pin.order < 1) {
      errors.push(issue("invalid_reference_order", `${basePath}.order`, "order must be a positive integer"));
      return;
    }
    const duplicateKey = `${assetId}:v${pin.assetVersion}`;
    const prior = seen.get(duplicateKey);
    if (prior) {
      if (prior.role !== role) {
        errors.push(issue("conflicting_duplicate_reference", basePath, `${duplicateKey} is pinned with both ${prior.role} and ${role}`));
      } else {
        warnings.push(issue("duplicate_reference_deduped", basePath, `${duplicateKey} is duplicated and was kept only once`));
      }
      return;
    }
    seen.set(duplicateKey, { role, index });

    const asset = assetById.get(assetId);
    if (!asset) {
      errors.push(issue("missing_asset", `${basePath}.assetId`, `Project asset does not exist: ${assetId}`));
      return;
    }
    const activeVersion = Number(asset.activeVersion);
    if (!Number.isInteger(activeVersion) || activeVersion < 1) {
      errors.push(issue("asset_has_no_active_version", basePath, `Project asset ${assetId} has no active generated version`));
      return;
    }
    if (activeVersion !== pin.assetVersion) {
      errors.push(issue("stale_asset_version", `${basePath}.assetVersion`, `${assetId}:v${pin.assetVersion} is not active; the current version is v${activeVersion}`, { activeVersion }));
      return;
    }
    const version = findExactAssetVersion(asset, pin.assetVersion);
    if (!version) {
      errors.push(issue("missing_asset_version", `${basePath}.assetVersion`, `Project manifest has no ${assetId}:v${pin.assetVersion}`));
      return;
    }
    const files = [...new Set([...(Array.isArray(version.files) ? version.files : []), version.file].map(normalizedManifestFile).filter(Boolean))];
    const file = normalizedManifestFile(version.file) || files[0] || null;
    if (!file || !files.includes(file)) {
      errors.push(issue("missing_active_file", basePath, `${assetId}:v${pin.assetVersion} has no valid active file in the project manifest`));
      return;
    }
    const fileMediaType = mediaTypeFromFile(file);
    const declaredMediaType = String(version.mediaType || asset.mediaType || fileMediaType || "").toLowerCase();
    const mediaType = declaredMediaType === "graphic" && fileMediaType === "image" ? "image" : declaredMediaType;
    if (!fileMediaType || (mediaType !== fileMediaType && !(mediaType === "image" && fileMediaType === "image"))) {
      errors.push(issue("asset_media_mismatch", basePath, `${assetId}:v${pin.assetVersion} media metadata does not match ${file}`));
      return;
    }
    if (!item.referencePolicy.acceptedMediaTypes.includes(mediaType)) {
      errors.push(issue("unsupported_reference_media", basePath, `${item.id} does not accept ${mediaType} project references`));
      return;
    }
    const fileHash = Array.isArray(version.fileHashes)
      ? version.fileHashes.find((entry) => normalizedManifestFile(entry?.file) === file)
      : null;
    const sha256 = String(fileHash?.sha256 || "").toLowerCase();
    const bytes = Number(fileHash?.bytes);
    if (!SHA256_RE.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 0) {
      errors.push(issue("unverifiable_asset_file", basePath, `${assetId}:v${pin.assetVersion} lacks an exact SHA-256/byte manifest for ${file}`));
      return;
    }
    resolved.push({
      mentionId: typeof pin.mentionId === "string" && pin.mentionId.trim() ? pin.mentionId.trim().slice(0, 160) : `mention-${index + 1}`,
      display: typeof pin.display === "string" ? pin.display.trim().slice(0, 300) : "",
      assetId,
      assetVersion: pin.assetVersion,
      assetVersionId: `${assetId}:v${pin.assetVersion}`,
      role,
      order: pin.order,
      required: pin.required !== false,
      notes: typeof pin.notes === "string" ? pin.notes.trim().slice(0, MAX_NOTE_LENGTH) : "",
      mediaType,
      file,
      projectMediaPath: `media/assets/${file}`,
      sha256,
      bytes,
      provenance: { scope: "project_asset_manifest", projectSlug: String(project.slug) }
    });
  });

  const ordered = resolved.sort((left, right) => left.order - right.order || left.assetId.localeCompare(right.assetId));
  const duplicateOrder = ordered.find((entry, index) => index > 0 && ordered[index - 1].order === entry.order);
  if (duplicateOrder) errors.push(issue("duplicate_reference_order", "references", `Reference order ${duplicateOrder.order} is used more than once`));
  if (ordered.length < item.referencePolicy.minimum) {
    errors.push(issue("too_few_references", "references", `${item.id} requires at least ${item.referencePolicy.minimum} project reference${item.referencePolicy.minimum === 1 ? "" : "s"}`));
  }
  if (ordered.length > item.referencePolicy.maximum) {
    errors.push(issue("too_many_references", "references", `${item.id} accepts at most ${item.referencePolicy.maximum} project references`, { maximum: item.referencePolicy.maximum, actual: ordered.length }));
  }
  return ordered;
}

function unresolvedDisplay(value, index) {
  if (typeof value === "string") return value.trim() || `mention ${index + 1}`;
  if (value && typeof value === "object") return String(value.display || value.text || value.mention || `mention ${index + 1}`).trim();
  return `mention ${index + 1}`;
}

export function preflightGenerationRequest(project, request, { readinessByWorkflow } = {}) {
  const errors = [];
  const warnings = [];
  if (!project || typeof project !== "object" || typeof project.slug !== "string" || !project.slug.trim()) {
    errors.push(issue("invalid_project", "project", "A server-loaded project with a slug is required"));
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    request = {};
    errors.push(issue("invalid_request", "request", "Generation request must be an object"));
  }
  if (request.schemaVersion !== undefined && request.schemaVersion !== GENERATION_COMPOSER_SCHEMA_VERSION) {
    errors.push(issue("unsupported_schema_version", "schemaVersion", `Expected schemaVersion ${GENERATION_COMPOSER_SCHEMA_VERSION}`));
  }
  const outputKind = typeof request.outputKind === "string" ? request.outputKind.trim().toLowerCase() : "";
  if (!GENERATION_OUTPUT_KINDS.includes(outputKind)) {
    errors.push(issue("invalid_output_kind", "outputKind", `outputKind must be one of: ${GENERATION_OUTPUT_KINDS.join(", ")}`));
  }
  const workflowId = typeof request.workflowId === "string" ? request.workflowId.trim() : "";
  const workflow = WORKFLOW_BY_ID.get(workflowId) || null;
  if (!workflow) errors.push(issue("unknown_workflow", "workflowId", `Unknown curated generation workflow: ${workflowId || "missing"}`));
  if (workflow && outputKind && !workflow.outputKinds.includes(outputKind)) {
    errors.push(issue("workflow_output_mismatch", "outputKind", `${workflow.id} cannot create ${outputKind}; choose ${workflow.outputKinds.join(" or ")}`));
  }
  if (workflow && !workflow.creatable) {
    errors.push(issue("workflow_not_creatable", "workflowId", workflow.blockReason || `${workflow.id} is not directly creatable`));
  }
  const promptText = typeof request.promptText === "string" ? request.promptText.trim() : "";
  if (!promptText) errors.push(issue("missing_prompt", "promptText", "promptText is required"));
  if (promptText.length > MAX_PROMPT_LENGTH) errors.push(issue("prompt_too_long", "promptText", `promptText must be at most ${MAX_PROMPT_LENGTH} characters`));

  let unresolvedMentions = request.unresolvedMentions ?? [];
  if (!Array.isArray(unresolvedMentions)) {
    errors.push(issue("invalid_unresolved_mentions", "unresolvedMentions", "unresolvedMentions must be an array supplied by the client mention parser"));
    unresolvedMentions = [];
  }
  const unresolvedDisplays = unresolvedMentions.map(unresolvedDisplay);
  if (unresolvedDisplays.length) {
    errors.push(issue("unresolved_mentions", "unresolvedMentions", `Resolve or remove: ${unresolvedDisplays.join(", ")}`, { mentions: unresolvedDisplays }));
  }

  const options = workflow ? validateOptions(workflow, outputKind, request.options, project, errors) : {};
  const resolvedReferences = workflow
    ? resolveProjectReferences(project, request.references, workflow, errors, warnings)
    : [];
  const readiness = workflow ? workflowReadiness(workflow, readinessByWorkflow) : null;
  if (workflow && readiness?.ready === false) {
    errors.push(issue("workflow_not_ready", "workflowId", readiness.reason || `${workflow.id} is not installed in the active runtime`));
  } else if (workflow && readiness?.availableNow === false && workflow.creatable) {
    errors.push(issue("workflow_not_available_now", "workflowId", readiness.reason || `${workflow.id} is not currently available`));
  } else if (workflow && readiness?.ready === null) {
    warnings.push(issue("workflow_readiness_unchecked", "workflowId", `Runtime readiness for ${workflow.id} must be checked before create/queue`));
  }

  const normalizedRequest = {
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    outputKind,
    workflowId,
    promptText,
    references: resolvedReferences,
    unresolvedMentions: unresolvedDisplays,
    options
  };
  const fingerprint = errors.length || !workflow ? null : stableGenerationFingerprint({
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    projectSlug: String(project.slug),
    workflow: { id: workflow.id, adapterRevision: workflow.adapterRevision, compiler: workflow.compiler },
    outputKind,
    promptText,
    options,
    // display and notes are compiler-consumed (reference aliases, source keys,
    // and storyboard bindings), so they are part of the immutable request.
    // mentionId is UI bookkeeping and provenance is server-derived.
    references: resolvedReferences.map(({ mentionId, provenance, ...reference }) => reference)
  });
  return deepFreeze({
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    ok: errors.length === 0,
    errors,
    warnings,
    projectSlug: typeof project?.slug === "string" ? project.slug : null,
    workflow: workflow ? { ...clone(workflow), readiness } : null,
    request: normalizedRequest,
    resolvedReferences,
    fingerprint
  });
}

export function prepareGenerationCreate(project, request, options = {}) {
  const preflight = preflightGenerationRequest(project, request, options);
  if (!preflight.ok) return deepFreeze({ preflight, generation: null });
  const createdAt = options.now instanceof Date
    ? options.now.toISOString()
    : (typeof options.now === "string" && options.now ? new Date(options.now).toISOString() : new Date().toISOString());
  const id = typeof options.id === "string" && options.id.trim()
    ? options.id.trim()
    : `generation-${preflight.fingerprint.slice(0, 20)}`;
  return deepFreeze({
    preflight,
    generation: {
      schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
      id,
      projectSlug: preflight.projectSlug,
      status: "validated",
      createdAt,
      fingerprint: preflight.fingerprint,
      workflowId: preflight.request.workflowId,
      outputKind: preflight.request.outputKind,
      promptText: preflight.request.promptText,
      options: clone(preflight.request.options),
      resolvedReferences: clone(preflight.resolvedReferences)
    }
  });
}

function safePart(value, fallback = "generation") {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
}

function deterministicSeed(preflight) {
  return preflight.request.options.seed ?? parseInt(preflight.fingerprint.slice(0, 12), 16);
}

function assertUsablePreflight(preflight, workflowId, outputKinds) {
  if (!preflight?.ok || !preflight.fingerprint) throw new Error("A successful server-created generation preflight is required");
  if (preflight.request.workflowId !== workflowId) throw new Error(`Preflight workflow must be ${workflowId}`);
  if (!outputKinds.includes(preflight.request.outputKind)) throw new Error(`Preflight output kind must be ${outputKinds.join(" or ")}`);
}

function storyboardReference(reference, targetKind, targetId, canonicalFile = null) {
  const id = `reference-${reference.order}-${safePart(reference.assetId)}`;
  return {
    id,
    assetId: reference.assetId,
    assetVersionId: reference.assetVersionId,
    assetVersion: reference.assetVersion,
    sourceAssetFile: reference.file,
    canonicalFile,
    sourceAssetKey: reference.display || reference.assetId,
    resolutionStatus: "resolved",
    role: reference.role,
    targetKind,
    targetId,
    useMode: targetKind === "video_plan" ? "semantic_reference" : "direct_conditioning",
    required: reference.required,
    order: reference.order,
    cropRegion: null,
    notes: reference.notes || null,
    pinnedActiveAtImport: true,
    persistenceOrigin: "user"
  };
}

export function buildSyntheticImageStoryboardInput(project, preflight) {
  assertUsablePreflight(preflight, STORYBOARD_KREA_GENERATION_WORKFLOW_ID, ["image", "design"]);
  if (String(project?.slug || "") !== preflight.projectSlug) throw new Error("Project slug does not match preflight");
  const suffix = preflight.fingerprint.slice(0, 20);
  const frameId = `frame-composer-${suffix}`;
  const options = preflight.request.options;
  const frameReferences = preflight.resolvedReferences.map((reference) => storyboardReference(reference, "frame", frameId));
  const prompt = `${preflight.request.promptText}\n\nEditorial output aspect ratio: ${options.aspectRatio}.`;
  const frame = {
    id: frameId,
    purpose: preflight.request.outputKind === "design" ? "generation_composer_design" : "generation_composer_image",
    ownerKind: "generation_composer",
    ownerId: preflight.fingerprint,
    prompt,
    negativePrompt: options.negativePrompt,
    seed: deterministicSeed(preflight),
    references: frameReferences,
    expectedInputPath: `Premiere316/${safePart(project.slug)}/generation-composer/${suffix}.png`,
    status: "planned",
    generatedVersions: []
  };
  const storyboard = {
    schemaVersion: "premiere316.storyboard.v1",
    projectId: project.slug,
    defaults: { referencePolicy: "explicit_user_only", maxReferences: 20 },
    chapters: {},
    chapterOrder: [],
    scenes: {},
    frames: { [frameId]: frame },
    clips: {},
    segments: {},
    videoPlans: {},
    referenceBindings: Object.fromEntries(frameReferences.map((reference) => [reference.id, reference]))
  };
  const compilerProject = clone(project);
  compilerProject.settings = { ...(compilerProject.settings || {}) };
  const canvas = {
    "16:9": [1280, 720],
    "2.39:1": [1280, 544],
    "2:3": [832, 1248],
    "1:1": [1024, 1024]
  }[options.aspectRatio];
  [compilerProject.settings.width, compilerProject.settings.height] = canvas;
  return deepFreeze({
    compiler: "compileStoryboardFramePrompt",
    compileArguments: { project: compilerProject, storyboard, frameId },
    project: compilerProject,
    storyboard,
    frameId,
    materializationRequired: false,
    fingerprint: preflight.fingerprint
  });
}

function canonicalFolder(role) {
  return ({ identity: "characters", wardrobe: "wardrobe", location: "locations", prop: "props", crowd: "crowds", atmosphere: "atmosphere" })[role] || "references";
}

export function buildSyntheticVideoPlanInput(project, preflight) {
  assertUsablePreflight(preflight, STORYBOARD_LTX25_GENERATION_WORKFLOW_ID, ["video"]);
  if (String(project?.slug || "") !== preflight.projectSlug) throw new Error("Project slug does not match preflight");
  const suffix = preflight.fingerprint.slice(0, 20);
  const clipId = `clip-composer-${suffix}`;
  const videoPlanId = `video-composer-${suffix}`;
  const segmentId = `segment-composer-${suffix}`;
  const referenceRoot = `production/generation-composer/${suffix}/reference_assets`;
  const options = preflight.request.options;
  const authoredFrames = Math.round(options.durationSec * options.fps);
  const generationFrames = authoredFrames + 1;
  const canonicalByVersion = new Map();
  const packageFiles = preflight.resolvedReferences.map((reference) => {
    const extension = path.posix.extname(reference.file).toLowerCase() || ".png";
    const canonical = `${canonicalFolder(reference.role)}/${String(reference.order).padStart(2, "0")}-${safePart(reference.assetId)}-v${reference.assetVersion}${extension}`;
    canonicalByVersion.set(reference.assetVersionId, canonical);
    return {
      sourceProjectMediaPath: reference.projectMediaPath,
      destinationRelativePath: canonical,
      sha256: reference.sha256,
      bytes: reference.bytes,
      operation: "copy_verified"
    };
  });
  const bindings = preflight.resolvedReferences.map((reference) => storyboardReference(
    reference,
    "video_plan",
    videoPlanId,
    canonicalByVersion.get(reference.assetVersionId)
  ));
  const referenceFiles = bindings.map((binding) => binding.canonicalFile);
  const segment = {
    id: segmentId,
    type: "text",
    startFrame: 0,
    lengthFrames: authoredFrames,
    prompt: preflight.request.promptText,
    isEndFrame: false
  };
  const audioPlan = {
    mode: "generated_ambience",
    dialogueText: "",
    instruction: "Generate synchronized ambience, movement and production sound implied by the prompt; no unscripted dialogue."
  };
  const clip = {
    id: clipId,
    videoPlanId,
    generationMode: T2V_GENERATION_MODE,
    durationFrames: authoredFrames,
    decodedFrames: generationFrames,
    trimDecodedFrames: 1,
    referenceMode: "semantic_reference_resolver",
    referenceRoot,
    referenceFiles,
    referenceCount: referenceFiles.length,
    segmentIds: [segmentId],
    dialogueAnchor: "",
    audioPlan
  };
  const videoPlan = {
    id: videoPlanId,
    clipId,
    generationMode: T2V_GENERATION_MODE,
    workflowProfileId: T2V_WORKFLOW_PROFILE,
    globalPrompt: preflight.request.promptText,
    negativePrompt: options.negativePrompt,
    fps: options.fps,
    width: options.width,
    height: options.height,
    requestedFrames: authoredFrames,
    generationFrames,
    seed: deterministicSeed(preflight),
    referenceMode: "semantic_reference_resolver",
    referenceRoot,
    referenceFiles,
    referenceCount: referenceFiles.length,
    segmentIds: [segmentId],
    timelineData: {
      mainTrackEnabled: true,
      global_prompt: preflight.request.promptText,
      segments: [{ id: segmentId, type: "text", start: 0, length: authoredFrames, prompt: preflight.request.promptText, isEndFrame: false }],
      motionSegments: [],
      audioSegments: []
    },
    audioMode: options.audioMode,
    audioPlan,
    status: "planned"
  };
  const storyboard = {
    schemaVersion: "premiere316.storyboard.v1",
    projectId: project.slug,
    defaults: {
      generationMode: T2V_GENERATION_MODE,
      workflowProfileId: T2V_WORKFLOW_PROFILE,
      fps: options.fps,
      decodedFrameTrim: 1,
      maxReferences: 9,
      referencePolicy: "explicit_user_only",
      referenceRoot
    },
    chapters: {},
    chapterOrder: [],
    scenes: {},
    frames: {},
    clips: { [clipId]: clip },
    segments: { [segmentId]: segment },
    videoPlans: { [videoPlanId]: videoPlan },
    referenceBindings: Object.fromEntries(bindings.map((binding) => [binding.id, binding]))
  };
  const assetIndex = {
    schema: "premiere316.canonical-reference-assets.v1",
    strict: true,
    maxReferences: 9,
    indexedRoot: ".",
    firstFrameGeneration: false,
    assets: preflight.resolvedReferences.map((reference) => ({
      canonical: canonicalByVersion.get(reference.assetVersionId),
      source: reference.file,
      role: reference.role,
      aliases: reference.display ? [reference.display.replace(/^@/, "")] : [],
      assetId: reference.assetId,
      assetVersionId: reference.assetVersionId,
      sha256: reference.sha256,
      bytes: reference.bytes
    }))
  };
  const referencePackage = {
    materializationRequired: true,
    projectRelativeRoot: referenceRoot,
    indexRelativePath: "asset_index.json",
    assetIndex,
    files: packageFiles
  };
  return deepFreeze({
    compiler: "compileStoryboardVideoPlanPrompt",
    compileArgumentsAfterMaterialization: { project: clone(project), storyboard, videoPlanId },
    project: clone(project),
    storyboard,
    videoPlanId,
    clipId,
    segmentId,
    referencePackage,
    materializationRequired: true,
    fingerprint: preflight.fingerprint
  });
}
