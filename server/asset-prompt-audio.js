import crypto from "node:crypto";
import path from "node:path";

import { assetApprovalCurrent } from "./assets.js";
import { prepareAudioGenerationRecords } from "./audio-generation.js";
import {
  bindingSha256,
  getAudioWorkflowCatalog,
  normalizeAudioBindings,
  readAudioWorkflowRegistry
} from "./audio-workflows.js";
import {
  GENERATION_COMPOSER_SCHEMA_VERSION,
  stableGenerationFingerprint
} from "./generation-composer.js";
import {
  bindIndexTtsGenerationJob,
  createIndexTtsGeneration,
  indexTtsHealth
} from "./index-tts.js";
import {
  PROMPT_GENERATION_SCHEMA,
  assertPinnedReferencesCurrent,
  buildServerAssetMentionOptions,
  deriveUnresolvedPromptMentions,
  normalizePromptGenerationPayload,
  publicPromptGeneration
} from "./prompt-generation.js";
import { loadProject, saveProject } from "./projects.js";
import {
  bindQwenTtsGenerationJob,
  createQwenTtsGeneration,
  qwenTtsHealth
} from "./qwen-tts.js";
import {
  bindVoiceDesignSessionJob,
  createVoiceDesignSession,
  qwenVoiceDesignHealth
} from "./qwen-voice-design.js";

export const STALE_AUDIO_COMPOSER_WORKFLOW_IDS = Object.freeze([
  "qwen3-tts-voice-design-1.7b",
  "ace-step-1.5-xl-turbo",
  "ltx-2.3-native-audio"
]);

export const STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID = "standalone.qwen3-tts.voice-design-1.7b";
export const STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID = "standalone.index-tts-2.5.dialogue";
export const STANDALONE_QWEN_TTS_DIALOGUE_WORKFLOW_ID = "standalone.qwen3-tts-base-1.7b.dialogue";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const AUDIO_FILE_RE = /\.(wav|wave|mp3|flac|m4a|aac|ogg|opus|aif|aiff|webm)$/i;
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg|bmp|tiff?)$/i;
const VIDEO_FILE_RE = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const MAX_AUDIO_PROMPT_LENGTH = 12_000;
const MAX_CONTEXT_VALUE_LENGTH = 1_200;
const MAX_PROMPT_GENERATIONS = 250;
const DEFAULT_AUDIO_CATALOG_TIMEOUT_MS = 30_000;
const DEFAULT_AUDIO_CATALOG_CACHE_TTL_MS = 10_000;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "cancelling"]);
const AUDIO_PROMPT_CREATE_LOCKS = new Map();
const DEFAULT_AUDIO_CATALOG_PROBE_STATE = { inFlight: null, cache: null };

const CONTEXT_REFERENCE_ROLES = Object.freeze([
  "identity", "wardrobe", "location", "prop", "crowd", "atmosphere", "voice", "audio", "motion", "reference"
]);

const CONTEXT_REFERENCE_POLICY = Object.freeze({
  acceptedMediaTypes: ["image", "video", "audio"],
  acceptedRoles: CONTEXT_REFERENCE_ROLES,
  minimum: 0,
  maximum: 20,
  orderSignificant: true,
  application: "prompt-context-only"
});

const CHARACTER_ASSOCIATION_POLICY = Object.freeze({
  acceptedMediaTypes: ["image"],
  acceptedRoles: ["identity"],
  acceptedCategories: ["character"],
  minimum: 0,
  maximum: 1,
  orderSignificant: false,
  application: "association-only"
});

const DIALOGUE_VOICE_POLICY = Object.freeze({
  acceptedMediaTypes: ["audio"],
  acceptedRoles: ["voice"],
  acceptedCategories: ["voice"],
  minimum: 1,
  maximum: 1,
  orderSignificant: false,
  application: "provider-conditioning"
});

export class AssetPromptAudioError extends Error {
  constructor(message, { status = 400, code = "ASSET_PROMPT_AUDIO_INVALID", errors = null } = {}) {
    super(message);
    this.name = "AssetPromptAudioError";
    this.status = status;
    this.statusCode = status;
    this.code = code;
    if (errors) this.errors = errors;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cleanText(value, maximum = 12_000) {
  return value == null ? "" : String(value).replace(/\r\n/g, "\n").trim().slice(0, maximum);
}

function canonicalMode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return normalized === "voice" ? "voice-design" : normalized;
}

function outputKindForMode(mode) {
  return mode === "voice-design" ? "voice" : mode;
}

export function isAssetPromptAudioRequest(body = {}) {
  return ["audio", "dialogue", "voice-design"].includes(canonicalMode(body.outputMode ?? body.outputKind));
}

function readyHealth(health, fallbackReason) {
  const ready = health?.ready === true;
  return {
    ready,
    availableNow: ready,
    reason: ready ? (health?.reason || "The pinned standalone runtime is ready") : (health?.reason || fallbackReason),
    checkedAt: new Date().toISOString()
  };
}

function healthOrUnavailable(probe, fallbackReason) {
  try {
    return readyHealth(typeof probe === "function" ? probe() : probe, fallbackReason);
  } catch (error) {
    return readyHealth({ ready: false, reason: `${fallbackReason}: ${String(error?.message || error)}` }, fallbackReason);
  }
}

function withDeadline(promise, milliseconds, label) {
  const timeoutMs = Math.max(250, Number(milliseconds) || DEFAULT_AUDIO_CATALOG_TIMEOUT_MS);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function audioCatalogProbeState(options) {
  if (options.audioCatalogProbeState && typeof options.audioCatalogProbeState === "object") {
    return options.audioCatalogProbeState;
  }
  const workflowOptions = options.audioWorkflowOptions;
  const hasCustomWorkflowOptions = workflowOptions && typeof workflowOptions === "object" && Object.keys(workflowOptions).length > 0;
  return !options.getAudioWorkflowCatalogFn && !hasCustomWorkflowOptions
    ? DEFAULT_AUDIO_CATALOG_PROBE_STATE
    : null;
}

async function probeAudioWorkflowCatalog(options) {
  const getCatalog = options.getAudioWorkflowCatalogFn || getAudioWorkflowCatalog;
  const state = audioCatalogProbeState(options);
  if (!state) {
    return withDeadline(
      getCatalog(options.audioWorkflowOptions || {}),
      options.catalogTimeoutMs,
      "Audio Workflow Library readiness probe"
    );
  }

  const nowMs = Date.now();
  if (state.cache?.value && Number(state.cache.expiresAt) > nowMs) return clone(state.cache.value);
  if (!state.inFlight) {
    const rawProbe = Promise.resolve().then(() => getCatalog(options.audioWorkflowOptions || {}));
    state.inFlight = rawProbe;
    const cacheTtlMs = Math.max(0, Number(options.catalogCacheTtlMs ?? DEFAULT_AUDIO_CATALOG_CACHE_TTL_MS));
    rawProbe.then((value) => {
      state.cache = { value: clone(value), expiresAt: Date.now() + cacheTtlMs };
    }, () => {}).finally(() => {
      if (state.inFlight === rawProbe) state.inFlight = null;
    });
  }
  return clone(await withDeadline(
    state.inFlight,
    options.catalogTimeoutMs,
    "Audio Workflow Library readiness probe"
  ));
}

function activeVersion(asset) {
  const versionNumber = Number(asset?.activeVersion || 0);
  return (asset?.versions || []).find((version) => Number(version?.v) === versionNumber) || null;
}

function activeFile(asset, version = activeVersion(asset)) {
  const values = [version?.file, ...(Array.isArray(version?.files) ? version.files : [])]
    .map((value) => String(value || "").trim().replace(/\\/g, "/"))
    .filter(Boolean);
  return values[0] || null;
}

function mediaTypeFor(asset, version, file) {
  const declared = String(version?.mediaType || asset?.mediaType || "").trim().toLowerCase();
  if (declared === "graphic") return "image";
  if (["image", "video", "audio"].includes(declared)) return declared;
  if (AUDIO_FILE_RE.test(file)) return "audio";
  if (IMAGE_FILE_RE.test(file)) return "image";
  if (VIDEO_FILE_RE.test(file)) return "video";
  return null;
}

function providerLinkForAsset(project, asset, version, voice, provider, manifest) {
  const referenceSha256 = String(voice?.referenceSha256 || "").toLowerCase();
  const referenceBytes = Number(voice?.bytes);
  const productionSha256 = String(manifest?.sha256 || "").toLowerCase();
  const productionBytes = Number(manifest?.bytes);
  const directProductionCopy = referenceSha256 === productionSha256 && referenceBytes === productionBytes;

  const design = version?.voiceDesign && typeof version.voiceDesign === "object" ? version.voiceDesign : null;
  if (!design) return directProductionCopy ? "asset-file" : null;
  const nativeSha256 = String(design.sha256 || design.provenance?.outputSha256 || "").toLowerCase();
  const nativeBytes = Number(design.quality?.signal?.bytes ?? design.nativeBytes);
  const designProductionSha256 = String(design.productionSha256 || design.provenance?.productionSha256 || "").toLowerCase();
  const auditionIds = new Set([
    design.sourceAuditionId,
    design.id,
    design.provenance?.auditionId
  ].map((value) => String(value || "")).filter(Boolean));
  const sourceAuditionMatches = Boolean(voice?.sourceAuditionId && auditionIds.has(String(voice.sourceAuditionId)));
  const savedVoice = (project?.sound?.voiceDesign?.savedVoices || []).find((saved) => {
    if (String(saved?.assetId || "") !== String(asset?.id || "")) return false;
    if (saved?.sourceAuditionId && !auditionIds.has(String(saved.sourceAuditionId))) return false;
    if (provider === "indexTts") return String(saved?.indexTtsVoiceId || "") === String(voice?.id || "");
    return String(saved?.qwenTtsVoiceId || saved?.providerVoiceId || "") === String(voice?.id || "");
  });
  const explicitProviderLink = Boolean(savedVoice);
  const designedNativeLink = Boolean(
    (explicitProviderLink || sourceAuditionMatches) &&
    SHA256_RE.test(nativeSha256) && referenceSha256 === nativeSha256 && referenceBytes === nativeBytes &&
    SHA256_RE.test(designProductionSha256) && productionSha256 === designProductionSha256 && Number.isSafeInteger(productionBytes)
  );
  return designedNativeLink ? (explicitProviderLink ? "voice-design-provider-link" : "voice-design-audition-link")
    : directProductionCopy ? "asset-file" : null;
}

function providerVoiceCandidates(project, provider) {
  const assets = new Map((project?.assets?.items || []).map((asset) => [String(asset?.id || ""), asset]));
  return (project?.sound?.voices || [])
    .filter((voice) => {
      const actualProvider = String(voice?.provider || "indexTts");
      if (provider === "indexTts" ? actualProvider !== "indexTts" : actualProvider !== provider) return false;
      const asset = assets.get(String(voice?.assetId || ""));
      const version = activeVersion(asset);
      const file = activeFile(asset, version);
      const manifest = (version?.fileHashes || []).find((entry) => String(entry?.file || "").replace(/\\/g, "/") === file);
      const exactReferenceHash = String(voice?.referenceSha256 || "").toLowerCase();
      const manifestHash = String(manifest?.sha256 || "").toLowerCase();
      const qwenTranscript = cleanText(voice?.referenceTranscript, 12_000);
      const qwenTranscriptHash = String(voice?.referenceTranscriptSha256 || "").toLowerCase();
      const qwenTranscriptCurrent = provider !== "qwenTts" || (
        qwenTranscript && SHA256_RE.test(qwenTranscriptHash) &&
        crypto.createHash("sha256").update(qwenTranscript).digest("hex") === qwenTranscriptHash
      );
      const linkKind = providerLinkForAsset(project, asset, version, voice, provider, manifest);
      return Boolean(
        asset && version && file && mediaTypeFor(asset, version, file) === "audio" &&
        String(asset.category || "").toLowerCase() === "voice" &&
        assetApprovalCurrent(project, asset) &&
        SHA256_RE.test(exactReferenceHash) && SHA256_RE.test(manifestHash) &&
        linkKind &&
        qwenTranscriptCurrent
      );
    })
    .map((voice) => {
      const asset = assets.get(String(voice.assetId));
      const version = activeVersion(asset);
      const file = activeFile(asset, version);
      const manifest = (version?.fileHashes || []).find((entry) => String(entry?.file || "").replace(/\\/g, "/") === file);
      return {
        voiceId: String(voice.id),
        assetId: String(voice.assetId),
        referenceSha256: String(voice.referenceSha256).toLowerCase(),
        referenceBytes: Number(voice.bytes),
        referenceTranscriptSha256: voice.referenceTranscriptSha256 || null,
        sourceAuditionId: voice.sourceAuditionId || null,
        linkKind: providerLinkForAsset(project, asset, version, voice, provider, manifest)
      };
    })
    .sort((left, right) => left.assetId.localeCompare(right.assetId) || left.voiceId.localeCompare(right.voiceId));
}

function linkedProviderVoices(project, provider) {
  const candidates = providerVoiceCandidates(project, provider);
  const counts = candidates.reduce((byAssetId, voice) => {
    byAssetId.set(voice.assetId, (byAssetId.get(voice.assetId) || 0) + 1);
    return byAssetId;
  }, new Map());
  // A provider must have one unambiguous voice for the asset before the
  // catalog advertises it. The composer currently selects an asset, not a
  // provider voice ID, so two eligible links cannot be chosen reproducibly.
  return candidates.filter((voice) => counts.get(voice.assetId) === 1);
}

function durationProperty(profile) {
  const minimum = Number(profile?.duration?.min);
  const maximum = Number(profile?.duration?.max);
  const fallback = Number(profile?.duration?.default);
  const step = Number(profile?.duration?.step);
  const property = { type: "number" };
  if (Number.isFinite(minimum)) property.minimum = minimum;
  if (Number.isFinite(maximum)) property.maximum = maximum;
  if (Number.isFinite(fallback)) property.default = fallback;
  if (Number.isFinite(step) && step > 0) property.multipleOf = step;
  return property;
}

function registryOutputMode(profile) {
  if (String(profile?.category || "").toLowerCase() !== "voice") return "audio";
  const controls = new Set((profile?.capabilities?.boundControls || []).map(String));
  return controls.has("voiceInstruction") ? "voice-design" : "dialogue";
}

function fallbackRegistryProfile(profile, probeError) {
  const outputBindings = Array.isArray(profile?.outputNodeBindings)
    ? Object.fromEntries(profile.outputNodeBindings.map((binding, index) => [`output${index || ""}`, binding]))
    : {};
  const bindings = normalizeAudioBindings({ ...(profile?.bindings || profile?.inputNodeBindings || {}), ...outputBindings });
  const bound = (key) => Boolean(bindings[key]);
  const readinessReason = `Live audio workflow validation failed closed: ${String(probeError?.message || probeError || "unknown readiness error")}`;
  return {
    id: String(profile?.id || ""),
    displayName: String(profile?.displayName || profile?.name || profile?.id || "Audio workflow"),
    category: String(profile?.category || "audio"),
    role: String(profile?.role || "generator"),
    engine: profile?.engine || "comfyui",
    modelFamily: profile?.modelFamily || null,
    description: profile?.description || "Audio Workflow Library generator",
    duration: clone(profile?.supportedDurationRange || profile?.duration || null),
    capabilities: {
      duration: bound("duration") || bound("durationSeconds"),
      lyrics: bound("lyrics") && profile?.lyricsSupport !== false,
      seed: bound("seed") && profile?.seedSupport !== false,
      formats: clone(profile?.outputFormats || profile?.capabilities?.formats || []),
      boundControls: Object.keys(bindings)
    },
    source: {
      relativePath: profile?.originalWorkflowPath || profile?.sourceWorkflowPath || null,
      sha256: String(profile?.sourceWorkflowSha256 || profile?.checksums?.source || "").toLowerCase() || null
    },
    api: {
      relativePath: profile?.appOwnedApiWorkflowPath || profile?.apiWorkflowPath || null,
      sha256: String(profile?.apiWorkflowSha256 || profile?.checksums?.api || "").toLowerCase() || null
    },
    bindingSha256: bindingSha256(bindings),
    readiness: {
      ready: false,
      status: "unavailable",
      label: "Readiness probe unavailable",
      errors: [readinessReason],
      drift: [],
      probeError: String(probeError?.message || probeError || "unknown readiness error")
    }
  };
}

function registryOptionSchema(profile, mode) {
  const properties = { seed: { type: ["integer", "null"], minimum: 0 } };
  const required = [];
  if (profile?.capabilities?.duration) properties.durationSec = durationProperty(profile);
  const formats = [...new Set((profile?.capabilities?.formats || []).map(String).map((value) => value.trim()).filter(Boolean))];
  if (formats.length) properties.outputFormat = { type: "string", enum: formats, default: formats[0] };
  if (mode === "voice-design" || mode === "dialogue") {
    properties.sampleText = { type: "string", minLength: 1, maxLength: 12_000 };
    properties.language = { type: "string", maxLength: 80 };
    required.push("sampleText");
  }
  if (mode === "audio" && String(profile?.category || "").toLowerCase() === "hybrid") {
    properties.category = { type: "string", enum: ["music", "sound-effect", "foley", "ambience"] };
    required.push("category");
  }
  if (profile?.capabilities?.lyrics) properties.lyrics = { type: "string", maxLength: 16_000 };
  return { type: "object", additionalProperties: true, properties, ...(required.length ? { required } : {}) };
}

function composerField(key, property, required) {
  const type = Array.isArray(property?.type) ? property.type.find((value) => value !== "null") : property?.type;
  const field = {
    key,
    type: Array.isArray(property?.enum) ? "select" : type === "number" || type === "integer" ? type : ["sampleText", "lyrics", "style"].includes(key) ? "textarea" : "text",
    label: ({
      sampleText: "sampleText",
      durationSec: "Duration",
      outputFormat: "Output format",
      auditionCount: "Auditions",
      voiceName: "Voice name",
      emotionWeight: "Emotion weight",
      durationFactor: "Duration factor",
      repetitionPenalty: "Repetition penalty",
      maxNewTokens: "Maximum generation tokens"
    })[key] || key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase()),
    required
  };
  if (key === "sampleText") field.label = "Exact dialogue";
  if (Array.isArray(property?.enum)) field.enum = [...property.enum];
  if (property?.minimum !== undefined) field.min = property.minimum;
  if (property?.maximum !== undefined) field.max = property.maximum;
  if (property?.multipleOf !== undefined) field.step = property.multipleOf;
  if (property?.default !== undefined) field.default = property.default;
  if (property?.maxLength !== undefined) field.maxLength = property.maxLength;
  return field;
}

function composerSchema(mode, optionSchema, referencePolicy, linkedVoices = []) {
  const required = new Set(optionSchema?.required || []);
  const fields = Object.entries(optionSchema?.properties || {}).map(([key, property]) => composerField(key, property, required.has(key)));
  const sampleText = fields.find((field) => field.key === "sampleText");
  if (sampleText && mode === "voice-design") {
    sampleText.label = "Audition line";
    sampleText.help = "These exact words are spoken to audition the designed voice.";
  } else if (sampleText && mode === "dialogue") {
    sampleText.label = "Exact dialogue";
    sampleText.help = "These exact words are spoken by the selected provider-linked voice.";
  }
  const primaryPrompt = mode === "voice-design"
    ? { key: "prompt", label: "Voice identity / performance instruction", required: true, maxLength: 4_000, help: "Describe timbre, register, accent, pacing, breath, and performance character." }
    : mode === "dialogue"
      ? { key: "prompt", label: "Performance direction", required: true, maxLength: MAX_AUDIO_PROMPT_LENGTH, help: "Direct delivery here; enter the exact spoken words separately." }
      : { key: "prompt", label: "Sound / music description", required: true, maxLength: MAX_AUDIO_PROMPT_LENGTH };
  const acceptedAssetIds = [...new Set(linkedVoices.map((voice) => String(voice.assetId || "")).filter(Boolean))];
  return {
    schema: "premiere316.asset-prompt-composer-options.v1",
    mode,
    primaryPrompt,
    fields,
    promptField: {
      name: "promptText",
      label: primaryPrompt.label,
      required: true,
      maxLength: mode === "voice-design" ? 4_000 : MAX_AUDIO_PROMPT_LENGTH
    },
    options: clone(optionSchema),
    usesDuration: Boolean(optionSchema?.properties?.durationSec),
    referenceApplication: referencePolicy.application,
    ...(mode === "dialogue" ? {
      speakerReference: {
        required: true,
        label: "Speaker voice",
        help: "Choose one approved exact-version voice asset explicitly linked to this provider. Character names are never guessed as voices.",
        acceptedAssetIds,
        acceptedMediaTypes: ["audio"],
        acceptedCategories: ["voice"],
        acceptedRoles: ["voice"],
        requireApproved: true
      }
    } : {})
  };
}

function registryWorkflow(profile, registryId) {
  const mode = registryOutputMode(profile);
  const optionSchema = registryOptionSchema(profile, mode);
  const referencePolicy = mode === "voice-design" ? CHARACTER_ASSOCIATION_POLICY
    : mode === "dialogue" ? DIALOGUE_VOICE_POLICY
      : CONTEXT_REFERENCE_POLICY;
  const registryReady = profile?.readiness?.ready === true;
  // Text-only registry TTS profiles cannot safely consume a provider voice pin
  // through the generic Comfy bridge. Keep them visible with their exact
  // registry state, but fail closed until a typed reference binding exists.
  const dialogueBridgeReady = mode !== "dialogue";
  const ready = registryReady && dialogueBridgeReady;
  const reason = dialogueBridgeReady
    ? (profile?.readiness?.errors?.join("; ") || profile?.readiness?.label || (ready ? "Ready" : "Audio workflow is unavailable"))
    : "This registry TTS profile has no exact Asset Library provider-voice binding in the prompt composer.";
  return {
    id: String(profile.id),
    label: String(profile.displayName || profile.id),
    name: String(profile.displayName || profile.id),
    purpose: String(profile.description || `${profile.category || "Audio"} generation through the validated Audio Workflow Library.`),
    source: "audio_workflow_registry",
    compiler: "compileAudioWorkflowPrompt",
    createMode: "audio_workflow",
    runtimeKind: "comfy-audio",
    queueType: "generate_audio_workflow",
    outputKinds: [outputKindForMode(mode)],
    supportedOutputModes: [mode],
    mediaType: "audio",
    category: profile.category,
    engine: profile.engine,
    modelFamily: profile.modelFamily,
    creatable: true,
    referencePolicy: clone(referencePolicy),
    referenceMediaTypes: [...referencePolicy.acceptedMediaTypes],
    optionProfile: "audio-workflow",
    optionSchema,
    composerSchema: composerSchema(mode, optionSchema, referencePolicy),
    workflowProvenance: {
      registryId: String(registryId || "premiere316.audio-workflows.v1"),
      profileId: String(profile.id),
      sourceSha256: profile?.source?.sha256 || null,
      apiSha256: profile?.api?.sha256 || null,
      bindingSha256: profile?.bindingSha256 || null
    },
    sourceWorkflowHash: profile?.source?.sha256 || null,
    apiWorkflowHash: profile?.api?.sha256 || null,
    bindingHash: profile?.bindingSha256 || null,
    ready,
    availableNow: ready,
    reason,
    runtimeWarning: ready ? null : reason,
    readiness: {
      ready,
      availableNow: ready,
      reason,
      checkedAt: new Date().toISOString(),
      source: "audio_workflow_registry",
      registry: clone(profile.readiness),
      sourceSha256: profile?.source?.sha256 || null,
      apiSha256: profile?.api?.sha256 || null,
      bindingSha256: profile?.bindingSha256 || null
    },
    execution: { kind: "audio-workflow", profileId: String(profile.id) }
  };
}

function standaloneWorkflow({ id, label, purpose, mode, runtimeKind, queueType, health, referencePolicy, optionSchema, linkedVoices = [] }) {
  const base = readyHealth(health, `${label} is not ready`);
  const needsVoice = mode === "dialogue";
  const ready = base.ready && (!needsVoice || linkedVoices.length > 0);
  const reason = !base.ready
    ? base.reason
    : needsVoice && !linkedVoices.length
      ? `${label} has no explicit provider voice linked to an Asset Library assetId.`
      : base.reason;
  return {
    id,
    label,
    name: label,
    purpose,
    source: "standalone_sound_runtime",
    compiler: runtimeKind,
    createMode: runtimeKind,
    runtimeKind,
    queueType,
    outputKinds: [outputKindForMode(mode)],
    supportedOutputModes: [mode],
    mediaType: "audio",
    creatable: true,
    referencePolicy: clone(referencePolicy),
    referenceMediaTypes: [...referencePolicy.acceptedMediaTypes],
    optionProfile: runtimeKind,
    optionSchema,
    composerSchema: composerSchema(mode, optionSchema, referencePolicy, linkedVoices),
    linkedProviderVoices: clone(linkedVoices),
    ready,
    availableNow: ready,
    reason,
    runtimeWarning: ready ? null : reason,
    readiness: { ...base, ready, availableNow: ready, reason, source: "standalone_sound_runtime" },
    execution: { kind: runtimeKind }
  };
}

export async function getAssetPromptAudioWorkflowCatalog(project, options = {}) {
  let audioCatalog = options.audioCatalog || null;
  if (!audioCatalog) {
    try {
      audioCatalog = await probeAudioWorkflowCatalog(options);
    } catch (probeError) {
      let registry;
      try {
        registry = options.audioRegistry || (options.readAudioWorkflowRegistryFn || readAudioWorkflowRegistry)(options.audioWorkflowOptions || {});
      } catch (registryError) {
        registry = { registryId: "premiere316.audio-workflows.v1", profiles: [] };
        probeError = new Error(`${String(probeError?.message || probeError)}; registry fallback failed: ${String(registryError?.message || registryError)}`);
      }
      audioCatalog = {
        registryId: registry?.registryId || registry?.schema || "premiere316.audio-workflows.v1",
        profiles: (registry?.profiles || [])
          .filter((profile) => String(profile?.role || "generator") !== "prompt-enhancer")
          .map((profile) => fallbackRegistryProfile(profile, probeError))
      };
    }
  }
  const profiles = (audioCatalog?.profiles || []).map((profile) => registryWorkflow(profile, audioCatalog?.registryId));
  const voiceDesignHealth = healthOrUnavailable(options.voiceDesignHealth || (options.qwenVoiceDesignHealthFn || qwenVoiceDesignHealth), "Qwen VoiceDesign readiness probe failed");
  const indexHealth = healthOrUnavailable(options.indexHealth || (options.indexTtsHealthFn || indexTtsHealth), "IndexTTS readiness probe failed");
  const qwenHealth = healthOrUnavailable(options.qwenHealth || (options.qwenTtsHealthFn || qwenTtsHealth), "Qwen Base readiness probe failed");
  const indexVoices = project ? linkedProviderVoices(project, "indexTts") : [];
  const qwenVoices = project ? linkedProviderVoices(project, "qwenTts") : [];
  const indexReferencePolicy = { ...DIALOGUE_VOICE_POLICY, acceptedAssetIds: indexVoices.map((voice) => voice.assetId) };
  const qwenReferencePolicy = { ...DIALOGUE_VOICE_POLICY, acceptedAssetIds: qwenVoices.map((voice) => voice.assetId) };

  const voiceDesignOptions = {
    type: "object",
    additionalProperties: false,
    required: ["sampleText"],
    properties: {
      sampleText: { type: "string", minLength: 1, maxLength: 2_000 },
      voiceName: { type: "string", maxLength: 120 },
      language: { type: "string", maxLength: 80, default: "English" },
      auditionCount: { type: "integer", minimum: 1, maximum: 3, default: 1 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  };
  const indexOptions = {
    type: "object",
    additionalProperties: false,
    required: ["sampleText"],
    properties: {
      sampleText: { type: "string", minLength: 1, maxLength: 12_000 },
      name: { type: "string", maxLength: 120 },
      language: { type: "string", maxLength: 80, default: "en" },
      emotionWeight: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
      durationFactor: { type: "number", minimum: 0.5, maximum: 2, default: 1 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  };
  const qwenOptions = {
    type: "object",
    additionalProperties: false,
    required: ["sampleText"],
    properties: {
      sampleText: { type: "string", minLength: 1, maxLength: 12_000 },
      name: { type: "string", maxLength: 120 },
      language: { type: "string", maxLength: 80, default: "English" },
      topK: { type: "integer", minimum: 1, maximum: 200, default: 20 },
      topP: { type: "number", minimum: 0.05, maximum: 1, default: 0.8 },
      temperature: { type: "number", minimum: 0.05, maximum: 2, default: 0.9 },
      repetitionPenalty: { type: "number", minimum: 0.5, maximum: 2, default: 1.05 },
      maxNewTokens: { type: "integer", minimum: 64, maximum: 16_384, default: 2_048 },
      seed: { type: ["integer", "null"], minimum: 0 }
    }
  };

  profiles.push(
    standaloneWorkflow({
      id: STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID,
      label: "Qwen3-TTS VoiceDesign · Standalone 1.7B",
      purpose: "Design a reusable character voice from a separate voice description and audible audition line.",
      mode: "voice-design",
      runtimeKind: "qwen-voice-design",
      queueType: "generate_qwen_voice_design",
      health: voiceDesignHealth,
      referencePolicy: CHARACTER_ASSOCIATION_POLICY,
      optionSchema: voiceDesignOptions
    }),
    standaloneWorkflow({
      id: STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID,
      label: "IndexTTS 2.5 · Linked Asset Voice",
      purpose: "Generate dialogue with one exact Asset Library voice explicitly linked to an IndexTTS provider voice.",
      mode: "dialogue",
      runtimeKind: "index-tts",
      queueType: "generate_index_tts",
      health: indexHealth,
      referencePolicy: indexReferencePolicy,
      optionSchema: indexOptions,
      linkedVoices: indexVoices
    }),
    standaloneWorkflow({
      id: STANDALONE_QWEN_TTS_DIALOGUE_WORKFLOW_ID,
      label: "Qwen3-TTS Base · Linked Asset Voice",
      purpose: "Generate dialogue with one exact Asset Library voice explicitly linked to an immutable Qwen provider voice and transcript.",
      mode: "dialogue",
      runtimeKind: "qwen-tts",
      queueType: "generate_qwen_tts",
      health: qwenHealth,
      referencePolicy: qwenReferencePolicy,
      optionSchema: qwenOptions,
      linkedVoices: qwenVoices
    })
  );
  return profiles;
}

export function combineAssetPromptWorkflowCatalog(visualWorkflows = [], audioWorkflows = []) {
  const stale = new Set(STALE_AUDIO_COMPOSER_WORKFLOW_IDS);
  const combined = [...visualWorkflows.filter((workflow) => !stale.has(String(workflow?.id))), ...audioWorkflows];
  const seen = new Set();
  return combined.filter((workflow) => {
    const id = String(workflow?.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function referenceError(message, code = "ASSET_PROMPT_REFERENCE_INVALID", status = 400) {
  throw new AssetPromptAudioError(message, { status, code });
}

function valueSnapshot(value, maximum = MAX_CONTEXT_VALUE_LENGTH) {
  return cleanText(value, maximum);
}

function resolvePinnedReferences(project, references, workflow, assertPinsFn) {
  const policy = workflow.referencePolicy || CONTEXT_REFERENCE_POLICY;
  const pins = Array.isArray(references) ? references : [];
  if (pins.length < Number(policy.minimum || 0)) referenceError(`${workflow.label} requires at least ${policy.minimum} Asset Library reference.`, "ASSET_PROMPT_REFERENCE_REQUIRED");
  if (pins.length > Number(policy.maximum ?? Infinity)) referenceError(`${workflow.label} accepts at most ${policy.maximum} Asset Library reference(s).`, "ASSET_PROMPT_TOO_MANY_REFERENCES");
  const byId = new Map((project?.assets?.items || []).map((asset) => [String(asset?.id || ""), asset]));
  const resolved = pins.map((pin, index) => {
    const asset = byId.get(String(pin?.assetId || ""));
    if (!asset) referenceError(`Pinned Asset Library item not found: ${pin?.assetId || "missing"}`, "ASSET_PROMPT_REFERENCE_MISSING", 409);
    const requestedVersion = Number(pin?.assetVersion || 0);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1 || requestedVersion !== Number(asset.activeVersion)) {
      referenceError(`${asset.id}:v${requestedVersion || 0} is not the active Asset Library version.`, "ASSET_PROMPT_REFERENCE_STALE", 409);
    }
    const version = (asset.versions || []).find((candidate) => Number(candidate?.v) === requestedVersion);
    const file = activeFile(asset, version);
    if (!version || !file || file.includes("..") || path.posix.isAbsolute(file) || /^[a-z]:/i.test(file)) {
      referenceError(`${asset.id}:v${requestedVersion} has no safe active file.`, "ASSET_PROMPT_REFERENCE_STALE", 409);
    }
    const mediaType = mediaTypeFor(asset, version, file);
    const role = String(pin?.role || "").trim().toLowerCase();
    const category = String(asset?.category || "").trim().toLowerCase();
    if (!policy.acceptedRoles.includes(role)) referenceError(`${workflow.label} does not accept the ${role || "missing"} reference role.`);
    if (!policy.acceptedMediaTypes.includes(mediaType)) referenceError(`${workflow.label} does not accept ${mediaType || "unknown"} references.`);
    if (Array.isArray(policy.acceptedCategories) && policy.acceptedCategories.length && !policy.acceptedCategories.includes(category)) {
      referenceError(`${workflow.label} does not accept ${category || "uncategorized"} assets for this reference.`);
    }
    if (Array.isArray(policy.acceptedAssetIds) && policy.acceptedAssetIds.length && !policy.acceptedAssetIds.includes(String(asset.id))) {
      referenceError(`${asset.id} is not explicitly linked to the selected workflow provider.`, "ASSET_PROMPT_PROVIDER_VOICE_MISSING");
    }
    const hash = (version.fileHashes || []).find((entry) => String(entry?.file || "").replace(/\\/g, "/") === file);
    if (!hash || !SHA256_RE.test(String(hash.sha256 || "")) || !Number.isSafeInteger(Number(hash.bytes)) || Number(hash.bytes) < 0) {
      referenceError(`${asset.id}:v${requestedVersion} has no exact SHA-256/byte manifest for ${file}.`, "ASSET_PROMPT_REFERENCE_UNVERIFIABLE", 409);
    }
    const metadata = {
      assetName: valueSnapshot(asset.name, 240),
      variant: valueSnapshot(asset.variant, 240),
      category: valueSnapshot(asset.category, 80),
      versionPrompt: valueSnapshot(version.prompt ?? asset.prompt),
      sampleText: valueSnapshot(version.sampleText ?? asset.sampleText),
      model: valueSnapshot(version.model, 240),
      workflowId: valueSnapshot(version.workflowId ?? asset.workflowId, 240)
    };
    const contextSha256 = stableGenerationFingerprint({
      assetId: asset.id,
      assetVersion: requestedVersion,
      file,
      sha256: String(hash.sha256).toLowerCase(),
      bytes: Number(hash.bytes),
      metadata
    });
    return {
      mentionId: String(pin.mentionId || `mention-${index + 1}`),
      display: String(pin.display || "").trim(),
      assetId: asset.id,
      assetVersion: requestedVersion,
      assetVersionId: `${asset.id}:v${requestedVersion}`,
      role,
      order: Number(pin.order || index + 1),
      required: pin.required !== false,
      mediaType,
      file,
      projectMediaPath: `media/assets/${file}`,
      sha256: String(hash.sha256).toLowerCase(),
      bytes: Number(hash.bytes),
      application: policy.application,
      metadata,
      contextSha256,
      provenance: { scope: "project_asset_manifest", projectSlug: project.slug }
    };
  }).sort((left, right) => left.order - right.order || left.assetId.localeCompare(right.assetId));
  assertPinsFn(project, resolved);
  return resolved;
}

function expandPromptContext(promptText, references) {
  if (!references.length) return promptText;
  const lines = references.map((reference) => {
    const metadata = reference.metadata || {};
    const description = metadata.versionPrompt || metadata.sampleText || metadata.variant || metadata.assetName;
    return `- ${reference.display || reference.assetVersionId} [${reference.role}; ${reference.assetVersionId}; context ${reference.contextSha256.slice(0, 12)}]: ${description || metadata.assetName || reference.assetId}`;
  });
  const expanded = `${promptText}\n\nExact Asset Library context (text-only; media files are provenance-pinned and are not binary-conditioned by this workflow):\n${lines.join("\n")}`;
  if (expanded.length > MAX_AUDIO_PROMPT_LENGTH) {
    throw new AssetPromptAudioError(`Prompt plus exact Asset Library context exceeds ${MAX_AUDIO_PROMPT_LENGTH} characters.`, {
      status: 400,
      code: "ASSET_PROMPT_AUDIO_TOO_LONG"
    });
  }
  return expanded;
}

function validateOptionText(options, name, maximum, required = false) {
  const value = cleanText(options?.[name], maximum);
  if (required && !value) throw new AssetPromptAudioError(`${name} is required.`, { code: `ASSET_PROMPT_${name.toUpperCase()}_REQUIRED` });
  return value;
}

function providerVoiceForAsset(project, provider, assetId) {
  const matches = providerVoiceCandidates(project, provider).filter((voice) => voice.assetId === assetId);
  if (!matches.length) {
    throw new AssetPromptAudioError(`The pinned voice asset has no explicit ${provider} provider voice link.`, {
      status: 409,
      code: "ASSET_PROMPT_PROVIDER_VOICE_MISSING"
    });
  }
  if (matches.length > 1) {
    throw new AssetPromptAudioError(`The pinned voice asset maps to more than one ${provider} provider voice; choose or repair an explicit provider link first.`, {
      status: 409,
      code: "ASSET_PROMPT_PROVIDER_VOICE_AMBIGUOUS"
    });
  }
  return matches[0];
}

function normalizedWorkflowProvenance(value) {
  return {
    sourceSha256: String(value?.sourceSha256 || "").toLowerCase(),
    apiSha256: String(value?.apiSha256 || "").toLowerCase(),
    bindingSha256: String(value?.bindingSha256 || "").toLowerCase()
  };
}

function assertPreparedAudioWorkflowProvenance(project, workflow, prepared) {
  if (workflow?.execution?.kind !== "audio-workflow") return;
  if (String(prepared?.profileId || "") !== String(workflow.execution.profileId || "")) {
    throw new AssetPromptAudioError("The Audio Workflow Library profile changed during provider preparation.", {
      status: 409,
      code: "ASSET_PROMPT_WORKFLOW_PROVENANCE_STALE"
    });
  }
  const expected = normalizedWorkflowProvenance(workflow.workflowProvenance);
  if (!Object.values(expected).every((value) => SHA256_RE.test(value))) {
    throw new AssetPromptAudioError("The selected audio workflow has incomplete immutable provenance.", {
      status: 409,
      code: "ASSET_PROMPT_WORKFLOW_PROVENANCE_STALE"
    });
  }
  const generationIds = Array.isArray(prepared?.generationIds) ? prepared.generationIds.map(String) : [];
  const records = generationIds.map((id) => (project?.sound?.audioGenerations || []).find((record) => String(record?.id || "") === id));
  const provenances = records.length && records.every(Boolean)
    ? records.map((record) => normalizedWorkflowProvenance(record.workflow))
    : prepared?.workflowProvenance
      ? [normalizedWorkflowProvenance(prepared.workflowProvenance)]
      : [];
  const current = provenances.length > 0 && provenances.every((actual) =>
    actual.sourceSha256 === expected.sourceSha256 &&
    actual.apiSha256 === expected.apiSha256 &&
    actual.bindingSha256 === expected.bindingSha256
  );
  if (!current) {
    throw new AssetPromptAudioError("The Audio Workflow Library source, API graph, or binding provenance changed during provider preparation. Refresh the workflow catalog and try again.", {
      status: 409,
      code: "ASSET_PROMPT_WORKFLOW_PROVENANCE_STALE"
    });
  }
}

function promptGenerationState(project) {
  const existing = project?.promptGenerations;
  if (existing?.schema === PROMPT_GENERATION_SCHEMA && Array.isArray(existing.items)) return existing;
  return { schema: PROMPT_GENERATION_SCHEMA, items: [] };
}

function screenplayRevision(project) {
  const markdown = String(project?.screenplay?.markdown || "").trim();
  return markdown ? crypto.createHash("sha256").update(markdown).digest("hex") : null;
}

function appendPromptGeneration(project, record) {
  const state = promptGenerationState(project);
  project.promptGenerations = state;
  state.items.push(record);
  if (state.items.length > MAX_PROMPT_GENERATIONS) {
    const active = new Set(["preparing", "queued", "running", "cancelling"]);
    while (state.items.length > MAX_PROMPT_GENERATIONS) {
      const index = state.items.findIndex((item) => !active.has(String(item?.status || "")));
      if (index < 0) break;
      state.items.splice(index, 1);
    }
  }
  return record;
}

function generationById(project, generationId) {
  return promptGenerationState(project).items.find((item) => String(item?.id || "") === String(generationId || "")) || null;
}

async function withAudioPromptCreateLock(projectSlug, operation) {
  const key = String(projectSlug || "");
  const previous = AUDIO_PROMPT_CREATE_LOCKS.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  AUDIO_PROMPT_CREATE_LOCKS.set(key, tail);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (AUDIO_PROMPT_CREATE_LOCKS.get(key) === tail) AUDIO_PROMPT_CREATE_LOCKS.delete(key);
  }
}

function canonicalSpeakerReference(project, value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new AssetPromptAudioError("Choose exactly one exact Asset Library speaker voice.", {
      code: "ASSET_PROMPT_DIALOGUE_VOICE_REQUIRED"
    });
  }
  const assetId = String(value.assetId || "").trim();
  const assetVersion = Number(value.assetVersion);
  if (!assetId || !Number.isInteger(assetVersion) || assetVersion < 1) {
    throw new AssetPromptAudioError("The speaker voice must include an exact assetId and assetVersion.", {
      code: "ASSET_PROMPT_DIALOGUE_VOICE_INVALID"
    });
  }
  const display = buildServerAssetMentionOptions(project?.assets?.items || [])
    .find((option) => option.assetId === assetId)?.handle || `@${assetId}`;
  return {
    mentionId: "speaker-reference",
    display,
    assetId,
    assetVersion,
    role: "voice",
    order: Number.MAX_SAFE_INTEGER,
    required: true,
    notes: "Explicit typed speaker selector"
  };
}

function mergeExplicitSpeakerReference(project, normalized, body, mode) {
  const supplied = body?.speakerReference;
  if (mode !== "dialogue") {
    if (supplied != null) {
      throw new AssetPromptAudioError("speakerReference is accepted only for Dialogue generation.", {
        code: "ASSET_PROMPT_SPEAKER_REFERENCE_UNSUPPORTED"
      });
    }
    return normalized;
  }
  if (supplied == null) return normalized;
  const speaker = canonicalSpeakerReference(project, supplied);
  const references = [...normalized.references];
  const existingIndex = references.findIndex((reference) => String(reference.assetId) === speaker.assetId);
  if (existingIndex >= 0) {
    if (Number(references[existingIndex].assetVersion) !== speaker.assetVersion) {
      throw new AssetPromptAudioError("The @ mention and explicit speaker selector pin different versions of the same voice asset.", {
        code: "ASSET_PROMPT_DIALOGUE_VOICE_CONFLICT"
      });
    }
    references[existingIndex] = { ...references[existingIndex], role: "voice", required: true };
  } else {
    references.push(speaker);
  }
  return { ...normalized, references };
}

function generationRecord(project, { id, workflow, normalized, resolvedReferences, options, fingerprint, backend, status = "preparing" }) {
  const now = new Date().toISOString();
  const outputMode = canonicalMode(normalized.outputKind);
  return {
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    id,
    projectSlug: project.slug,
    outputKind: outputKindForMode(outputMode),
    outputMode,
    workflowId: workflow.id,
    promptText: normalized.promptText,
    options: clone(options),
    request: {
      schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
      outputKind: outputKindForMode(outputMode),
      workflowId: workflow.id,
      promptText: normalized.promptText,
      references: clone(resolvedReferences),
      unresolvedMentions: [],
      options: clone(options)
    },
    resolvedReferences: clone(resolvedReferences),
    fingerprint,
    screenplayRevision: screenplayRevision(project),
    manifestScreenplayHash: project?.assets?.screenplayHash || null,
    backend: clone(backend),
    status,
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now
  };
}

function markPreparationFailure(projectSlug, generationId, backend, error, dependencies) {
  try {
    const project = dependencies.loadProjectFn(projectSlug);
    const generation = generationById(project, generationId);
    if (generation) {
      if (backend) generation.backend = clone(backend);
      generation.status = "failed";
      generation.lastError = `Provider preparation failed: ${String(error?.message || error)}`;
      generation.updatedAt = new Date().toISOString();
    }
    const sound = project.sound || {};
    if (backend?.kind === "audio-workflow") {
      for (const id of backend.generationIds || []) {
        const record = (sound.audioGenerations || []).find((item) => item.id === id);
        if (record && record.status === "queued") {
          record.status = "failed";
          record.error = { code: "ASSET_PROMPT_PREPARATION_FAILED", message: "Asset prompt validation changed before queueing", technical: String(error?.message || error), at: new Date().toISOString() };
        }
      }
    } else if (backend?.kind === "qwen-voice-design") {
      const session = (sound.voiceDesign?.sessions || []).find((item) => item.id === backend.sessionId);
      if (session && session.status === "queued") {
        session.status = "error";
        session.error = String(error?.message || error);
      }
    } else if (backend?.generationId) {
      const record = (sound.generations || []).find((item) => item.id === backend.generationId);
      if (record && record.status === "queued") {
        record.status = "error";
        record.error = String(error?.message || error);
      }
    }
    dependencies.saveProjectFn(project);
  } catch {}
}

function markQueueFailure(projectSlug, generationId, backend, error, dependencies) {
  try {
    const project = dependencies.loadProjectFn(projectSlug);
    const state = promptGenerationState(project);
    const generation = state.items.find((item) => item.id === generationId);
    if (generation) {
      generation.status = "failed";
      generation.lastError = `Queue insertion failed: ${String(error?.message || error)}`;
      generation.updatedAt = new Date().toISOString();
    }
    const sound = project.sound || {};
    if (backend.kind === "audio-workflow") {
      for (const id of backend.generationIds || []) {
        const record = (sound.audioGenerations || []).find((item) => item.id === id);
        if (record && record.status === "queued") {
          record.status = "failed";
          record.error = { code: "QUEUE_INSERTION_FAILED", message: "Audio generation could not be queued", technical: String(error?.message || error), at: new Date().toISOString() };
        }
      }
    } else if (backend.kind === "qwen-voice-design") {
      const session = (sound.voiceDesign?.sessions || []).find((item) => item.id === backend.sessionId);
      if (session && session.status === "queued") {
        session.status = "error";
        session.error = String(error?.message || error);
      }
    } else {
      const record = (sound.generations || []).find((item) => item.id === backend.generationId);
      if (record && record.status === "queued") {
        record.status = "error";
        record.error = String(error?.message || error);
      }
    }
    dependencies.saveProjectFn(project);
  } catch {}
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  loadProjectFn: loadProject,
  saveProjectFn: saveProject,
  assertPinsFn: assertPinnedReferencesCurrent,
  getCatalogFn: getAssetPromptAudioWorkflowCatalog,
  prepareAudioGenerationRecordsFn: prepareAudioGenerationRecords,
  createVoiceDesignSessionFn: createVoiceDesignSession,
  bindVoiceDesignSessionJobFn: bindVoiceDesignSessionJob,
  createIndexTtsGenerationFn: createIndexTtsGeneration,
  bindIndexTtsGenerationJobFn: bindIndexTtsGenerationJob,
  createQwenTtsGenerationFn: createQwenTtsGeneration,
  bindQwenTtsGenerationJobFn: bindQwenTtsGenerationJob,
  cancelJobFn: null
});

export async function createAndEnqueueAssetPromptAudio(projectSlug, body = {}, options = {}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options };
  if (typeof dependencies.enqueueFn !== "function" || typeof dependencies.listJobsFn !== "function") {
    throw new AssetPromptAudioError("Audio prompt queue integration is unavailable.", { status: 503, code: "ASSET_PROMPT_QUEUE_UNAVAILABLE" });
  }
  // Runtime probing may await ComfyUI/local health. The canonical project is
  // deliberately reloaded only after that asynchronous check and inside the
  // per-project critical section so an old snapshot is never saved.
  const catalogProject = dependencies.loadProjectFn(projectSlug);
  const workflows = await dependencies.getCatalogFn(catalogProject, options.catalogOptions || {});

  return withAudioPromptCreateLock(projectSlug, async () => {
    let project = dependencies.loadProjectFn(projectSlug);
    let normalized = normalizePromptGenerationPayload(project, body);
    const mode = canonicalMode(normalized.outputKind);
    if (!["audio", "dialogue", "voice-design"].includes(mode)) {
      throw new AssetPromptAudioError("This request is not an audio composer mode.", { code: "ASSET_PROMPT_MODE_INVALID" });
    }
    const workflow = workflows.find((item) => String(item.id) === String(normalized.workflowId));
    if (!workflow || !workflow.supportedOutputModes?.includes(mode)) {
      throw new AssetPromptAudioError("The selected audio workflow is unknown or incompatible with this output mode.", { code: "ASSET_PROMPT_WORKFLOW_INVALID" });
    }
    if (workflow.ready !== true || workflow.availableNow !== true) {
      throw new AssetPromptAudioError(workflow.runtimeWarning || workflow.reason || "The selected audio workflow is not ready.", {
        status: 409,
        code: "ASSET_PROMPT_WORKFLOW_NOT_READY"
      });
    }
    if (!normalized.promptText) throw new AssetPromptAudioError("Enter a generation prompt.", { code: "ASSET_PROMPT_REQUIRED" });

    // Ordinary references remain governed by @ mention validation. The typed
    // speaker selector is canonicalized separately below so it is authorized
    // without weakening hidden-pin rejection for ordinary references.
    const unresolved = deriveUnresolvedPromptMentions(project, normalized.promptText, normalized.references);
    if (unresolved.length) {
      throw new AssetPromptAudioError(`Resolve or remove: ${unresolved.map((item) => item.display).join(", ")}`, {
        code: "ASSET_PROMPT_UNRESOLVED_MENTIONS",
        errors: unresolved
      });
    }
    normalized = mergeExplicitSpeakerReference(project, normalized, body, mode);
    const resolvedReferences = resolvePinnedReferences(project, normalized.references, workflow, dependencies.assertPinsFn);
    const submittedOptions = normalized.options && typeof normalized.options === "object" ? clone(normalized.options) : {};
    // Dialogue has one authoritative Performance direction: the primary
    // prompt. A hidden/stale style option must never silently override it.
    if (mode === "dialogue") delete submittedOptions.style;

    let selectedProviderVoice = null;
    if (["index-tts", "qwen-tts"].includes(workflow.execution?.kind)) {
      validateOptionText(submittedOptions, "sampleText", 12_000, true);
      if (resolvedReferences.length !== 1 || resolvedReferences[0].role !== "voice" || resolvedReferences[0].mediaType !== "audio") {
        throw new AssetPromptAudioError("Dialogue requires one exact approved audio Asset Library reference with the voice role.", {
          code: "ASSET_PROMPT_DIALOGUE_VOICE_REQUIRED"
        });
      }
      const provider = workflow.execution.kind === "index-tts" ? "indexTts" : "qwenTts";
      selectedProviderVoice = providerVoiceForAsset(project, provider, resolvedReferences[0].assetId);
    }
    if (workflow.execution?.kind === "qwen-voice-design") {
      validateOptionText(submittedOptions, "sampleText", 2_000, true);
      if (normalized.promptText.length > 4_000) throw new AssetPromptAudioError("Voice description must be 4,000 characters or fewer.");
      const characterReference = resolvedReferences[0] || null;
      if (characterReference && characterReference.metadata?.category !== "character") {
        throw new AssetPromptAudioError("VoiceDesign character association requires an exact pinned character asset.", {
          code: "ASSET_PROMPT_CHARACTER_REFERENCE_INVALID"
        });
      }
    }

    const fingerprint = stableGenerationFingerprint({
      schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
      projectSlug,
      workflow: {
        id: workflow.id,
        runtimeKind: workflow.runtimeKind,
        sourceSha256: workflow.workflowProvenance?.sourceSha256 || null,
        apiSha256: workflow.workflowProvenance?.apiSha256 || null,
        bindingSha256: workflow.workflowProvenance?.bindingSha256 || null
      },
      outputKind: outputKindForMode(mode),
      promptText: normalized.promptText,
      options: submittedOptions,
      references: resolvedReferences.map(({ mentionId, provenance, ...reference }) => reference),
      providerVoice: selectedProviderVoice ? {
        providerKind: workflow.execution.kind,
        voiceId: selectedProviderVoice.voiceId,
        assetId: selectedProviderVoice.assetId,
        referenceSha256: selectedProviderVoice.referenceSha256,
        referenceBytes: selectedProviderVoice.referenceBytes,
        referenceTranscriptSha256: selectedProviderVoice.referenceTranscriptSha256
      } : null
    });
    const duplicateJob = dependencies.listJobsFn().find((job) =>
      String(job?.projectSlug || "") === String(projectSlug) &&
      job?.refs?.requestFingerprint === fingerprint &&
      ACTIVE_JOB_STATUSES.has(String(job?.status || ""))
    );
    if (duplicateJob) {
      const existing = generationById(project, duplicateJob.refs?.promptGenerationId);
      if (existing?.fingerprint === fingerprint) {
        return { project, generation: publicPromptGeneration(existing), job: duplicateJob, alreadyQueued: true };
      }
    }

    const generationId = `generation-${crypto.randomUUID()}`;
    const pendingGeneration = generationRecord(project, {
      id: generationId,
      workflow,
      normalized: { ...normalized, outputKind: mode },
      resolvedReferences,
      options: submittedOptions,
      fingerprint,
      backend: { kind: workflow.execution?.kind || "unknown", pending: true },
      status: "preparing"
    });
    appendPromptGeneration(project, pendingGeneration);
    dependencies.saveProjectFn(project);

    let providerRequest;
    let backend;
    let prepared;
    try {
      if (workflow.execution?.kind === "audio-workflow") {
        const providerMode = workflow.supportedOutputModes[0];
        const sampleText = providerMode === "audio" ? "" : validateOptionText(submittedOptions, "sampleText", 12_000, true);
        const expandedPrompt = providerMode === "audio"
          ? expandPromptContext(normalized.promptText, resolvedReferences)
          : normalized.promptText;
        providerRequest = {
          ...clone(submittedOptions),
          profileId: workflow.execution.profileId,
          category: submittedOptions.category || (providerMode === "voice-design" ? "voice-design" : workflow.category),
          name: submittedOptions.name || normalized.promptText.slice(0, 120),
          prompt: expandedPrompt,
          originalPrompt: normalized.promptText,
          ...(sampleText ? { text: sampleText, instruct: normalized.promptText } : {}),
          assetPromptGenerationId: generationId,
          assetPromptReferences: clone(resolvedReferences)
        };
        prepared = await dependencies.prepareAudioGenerationRecordsFn(projectSlug, providerRequest);
        backend = {
          kind: "audio-workflow",
          profileId: prepared.profileId,
          generationIds: clone(prepared.generationIds),
          workflowProvenance: clone(workflow.workflowProvenance)
        };
      } else if (workflow.execution?.kind === "qwen-voice-design") {
        const sampleText = validateOptionText(submittedOptions, "sampleText", 2_000, true);
        const characterReference = resolvedReferences[0] || null;
        const voiceName = validateOptionText(submittedOptions, "voiceName", 120) || characterReference?.metadata?.assetName || "Designed Voice";
        providerRequest = {
          projectId: project.id || project.slug,
          characterId: characterReference?.assetId || null,
          voiceName,
          instruct: normalized.promptText,
          auditionText: sampleText,
          auditionCount: submittedOptions.auditionCount ?? 1,
          language: submittedOptions.language || "English",
          seed: submittedOptions.seed
        };
        const session = await dependencies.createVoiceDesignSessionFn(project, providerRequest);
        backend = { kind: "qwen-voice-design", sessionId: session.id };
      } else if (["index-tts", "qwen-tts"].includes(workflow.execution?.kind)) {
        const sampleText = validateOptionText(submittedOptions, "sampleText", 12_000, true);
        const provider = workflow.execution.kind === "index-tts" ? "indexTts" : "qwenTts";
        const linked = selectedProviderVoice;
        providerRequest = {
          voiceId: linked.voiceId,
          speaker: resolvedReferences[0].metadata.assetName || "Voice",
          voiceName: resolvedReferences[0].metadata.assetName || "Voice",
          name: submittedOptions.name || `${resolvedReferences[0].metadata.assetName || "Voice"} dialogue`,
          text: sampleText,
          style: normalized.promptText,
          language: submittedOptions.language,
          seed: submittedOptions.seed
        };
        if (provider === "indexTts") {
          Object.assign(providerRequest, {
            emotionWeight: submittedOptions.emotionWeight,
            durationFactor: submittedOptions.durationFactor
          });
          prepared = await dependencies.createIndexTtsGenerationFn(projectSlug, providerRequest);
          backend = {
            kind: "index-tts",
            generationId: prepared.generation.id,
            voiceId: linked.voiceId,
            voiceAssetId: linked.assetId,
            referenceSha256: linked.referenceSha256
          };
        } else {
          Object.assign(providerRequest, {
            topK: submittedOptions.topK,
            topP: submittedOptions.topP,
            temperature: submittedOptions.temperature,
            repetitionPenalty: submittedOptions.repetitionPenalty,
            maxNewTokens: submittedOptions.maxNewTokens
          });
          prepared = await dependencies.createQwenTtsGenerationFn(projectSlug, providerRequest);
          backend = {
            kind: "qwen-tts",
            generationId: prepared.generation.id,
            voiceId: linked.voiceId,
            voiceAssetId: linked.assetId,
            referenceSha256: linked.referenceSha256
          };
        }
      } else {
        throw new AssetPromptAudioError("The selected workflow has no audio composer execution adapter.", {
          status: 409,
          code: "ASSET_PROMPT_WORKFLOW_UNSUPPORTED"
        });
      }

      project = dependencies.loadProjectFn(projectSlug);
      assertPreparedAudioWorkflowProvenance(project, workflow, prepared);
      // Provider preparation may await health/model/file work and save its own
      // record. Re-prove the exact approved pins against the newly loaded
      // project before either wrapper or provider job becomes queueable.
      dependencies.assertPinsFn(project, resolvedReferences);
      const stored = generationById(project, generationId);
      if (!stored) throw new Error("Asset prompt generation disappeared during provider preparation");
      stored.backend = clone(backend);
      stored.request.providerRequest = clone(providerRequest);
      stored.status = "queued";
      stored.updatedAt = new Date().toISOString();
      dependencies.saveProjectFn(project);
    } catch (error) {
      markPreparationFailure(projectSlug, generationId, backend, error, dependencies);
      throw error;
    }

    let job;
    try {
      const commonRefs = {
        promptGenerationId: generationId,
        requestFingerprint: fingerprint,
        workflowId: workflow.id,
        outputKind: outputKindForMode(mode)
      };
      if (backend.kind === "audio-workflow") {
        const expectedWorkflow = clone(backend.workflowProvenance);
        job = dependencies.enqueueFn({
          type: "generate_audio_workflow",
          projectSlug,
          profileId: backend.profileId,
          generationIds: backend.generationIds,
          expectedWorkflow,
          label: `Generate audio · ${workflow.label}`,
          refs: { ...commonRefs, profileId: backend.profileId, generationIds: backend.generationIds, expectedWorkflow, promptIds: {} }
        });
      } else if (backend.kind === "qwen-voice-design") {
        job = dependencies.enqueueFn({
          type: "generate_qwen_voice_design",
          projectSlug,
          label: `Voice Design · ${submittedOptions.voiceName || resolvedReferences[0]?.metadata?.assetName || "Designed Voice"}`,
          refs: { ...commonRefs, sessionId: backend.sessionId, characterId: resolvedReferences[0]?.assetId || null }
        });
        dependencies.bindVoiceDesignSessionJobFn(projectSlug, backend.sessionId, job.id);
      } else if (backend.kind === "index-tts") {
        job = dependencies.enqueueFn({
          type: "generate_index_tts",
          projectSlug,
          label: `Generate dialogue · ${workflow.label}`,
          refs: { ...commonRefs, generationId: backend.generationId, voiceId: backend.voiceId }
        });
        dependencies.bindIndexTtsGenerationJobFn(projectSlug, backend.generationId, job.id);
      } else {
        job = dependencies.enqueueFn({
          type: "generate_qwen_tts",
          projectSlug,
          label: `Generate dialogue · ${workflow.label}`,
          refs: { ...commonRefs, generationId: backend.generationId, voiceId: backend.voiceId }
        });
        dependencies.bindQwenTtsGenerationJobFn(projectSlug, backend.generationId, job.id);
      }
      project = dependencies.loadProjectFn(projectSlug);
      const stored = generationById(project, generationId);
      if (stored) {
        stored.jobId = job.id;
        stored.updatedAt = new Date().toISOString();
        dependencies.saveProjectFn(project);
      }
    } catch (error) {
      if (job?.id && typeof dependencies.cancelJobFn === "function") {
        try {
          await dependencies.cancelJobFn(job.id);
        } catch (rollbackError) {
          try { error.rollbackError = String(rollbackError?.message || rollbackError); } catch {}
        }
      }
      markQueueFailure(projectSlug, generationId, backend, error, dependencies);
      throw error;
    }

    project = dependencies.loadProjectFn(projectSlug);
    const stored = generationById(project, generationId) || pendingGeneration;
    return {
      project,
      generation: publicPromptGeneration(stored),
      job,
      alreadyQueued: false
    };
  });
}

export function finalizeAssetPromptAudioGeneration(projectSlug, generationId, outcome = {}, options = {}) {
  if (!projectSlug || !generationId) return null;
  const loadProjectFn = options.loadProjectFn || loadProject;
  const saveProjectFn = options.saveProjectFn || saveProject;
  const project = loadProjectFn(projectSlug);
  const generation = generationById(project, generationId);
  if (!generation) return null;

  const requestedStatus = String(outcome.status || "").toLowerCase();
  const status = requestedStatus === "done" || requestedStatus === "generated"
    ? "generated"
    : requestedStatus === "cancelled"
      ? "cancelled"
      : "failed";

  // A completed provider output is immutable. A late cancellation/failure
  // notification must not downgrade a wrapper that already recorded success.
  if (generation.status === "generated" && status !== "generated") {
    return { project, generation: publicPromptGeneration(generation) };
  }

  const now = new Date().toISOString();
  generation.status = status;
  generation.jobId = String(outcome.jobId || generation.jobId || "") || null;
  generation.updatedAt = now;
  generation.finishedAt = now;
  if (status === "generated") {
    generation.lastError = null;
    generation.result = {
      provider: generation.backend?.kind || null,
      jobId: generation.jobId,
      providerResult: clone(outcome.result ?? null)
    };
  } else {
    generation.lastError = status === "cancelled"
      ? null
      : String(outcome.error?.message || outcome.error || "Audio prompt generation failed");
  }
  saveProjectFn(project);
  return { project, generation: publicPromptGeneration(generation) };
}
