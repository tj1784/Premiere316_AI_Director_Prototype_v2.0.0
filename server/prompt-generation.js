import crypto from "crypto";
import fs from "fs";
import path from "path";

import {
  assetApprovalCurrent,
  assetGenerationFingerprint,
  assetVersionFilesCurrent,
  getAssetWorkflowCatalog,
  saveAssetPackageFiles,
  updateAssetManifestCounts
} from "./assets.js";
import {
  collectOutputFiles,
  downloadOutput,
  getObjectInfo,
  runPrompt
} from "./comfy.js";
import {
  GENERATION_COMPOSER_SCHEMA_VERSION,
  GENERATION_OUTPUT_KINDS,
  STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
  STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
  buildSyntheticImageStoryboardInput,
  buildSyntheticVideoPlanInput,
  getGenerationWorkflowCatalog,
  preflightGenerationRequest
} from "./generation-composer.js";
import { projectDir } from "./paths.js";
import {
  loadProject,
  mediaDir,
  saveProject,
  skipApproval,
  skipScreenplay
} from "./projects.js";
import {
  compileStoryboardFramePrompt,
  compileStoryboardVideoPlanPrompt,
  storyboardRuntimeProbeGraphs,
  validateStoryboardRuntimeGraph
} from "./storyboard-generation.js";
import { trimVideoToFrames } from "./ffmpeg.js";

export const PROMPT_GENERATION_SCHEMA = "premiere316.prompt-generations.v1";
export const PROMPT_GENERATION_JOB_TYPE = "generate_prompt_asset";
export const PROMPT_GENERATION_EXECUTABLE_WORKFLOWS = Object.freeze([
  STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
  STORYBOARD_LTX25_GENERATION_WORKFLOW_ID
]);
export const PROMPT_COMPOSER_IMMUTABLE_ASSET_FIELDS = Object.freeze([
  "name",
  "variant",
  "workflowId",
  "prompt",
  "category",
  "seed",
  "durationSec",
  "dependencies",
  "sampleText",
  "bpm"
]);

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "cancelling"]);
const ACTIVE_GENERATION_STATUSES = new Set(["queued", "running", "cancelling"]);
const PROMPT_CREATE_LOCKS = new Map();
const IMAGE_OUTPUT_RE = /\.(png|jpe?g|webp)$/i;
const VIDEO_OUTPUT_RE = /\.(mp4|webm|mov|mkv)$/i;
const MAX_PROMPT_GENERATIONS = 250;
// Keep this allocation contract byte-for-byte compatible with the Asset Prompt
// Composer's friendly handles. The prompt text is presentation; exact asset IDs
// and versions remain the authority, but the server must independently prove
// that each displayed handle names the pinned asset.
const MENTION_CATEGORY_SUFFIXES = Object.freeze({
  character: "Character",
  wardrobe: "Wardrobe",
  location: "Location",
  artifact: "Prop",
  prop: "Prop",
  extra: "Crowd",
  atmosphere: "VFX",
  "guide-frame": "Guide",
  voice: "Voice",
  dialogue: "Dialogue",
  sound: "Sound",
  music: "Music",
  graphic: "Graphic",
  design: "Design",
  video: "Video"
});

const MENTION_CATEGORY_PRIORITY = Object.freeze([
  "character",
  "location",
  "artifact",
  "wardrobe",
  "extra",
  "atmosphere",
  "guide-frame",
  "voice",
  "dialogue",
  "sound",
  "music",
  "graphic",
  "design",
  "video"
]);

const WORKFLOW_RUNTIME_REQUIREMENTS = Object.freeze({
  [STORYBOARD_KREA_GENERATION_WORKFLOW_ID]: {
    baselineAssetWorkflowId: "krea2-cinematic-still-fp8",
    probeKind: "image"
  },
  [STORYBOARD_LTX25_GENERATION_WORKFLOW_ID]: {
    baselineAssetWorkflowId: null,
    probeKind: "video"
  }
});

export class PromptGenerationError extends Error {
  constructor(message, { status = 400, code = "PROMPT_GENERATION_INVALID", errors = null } = {}) {
    super(message);
    this.name = "PromptGenerationError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function promptComposerAssetProvenanceChanges(asset, patch) {
  const composerOutput = asset?.generationComposer === true || asset?.regenerationMode === "prompt-composer" || asset?.source === "prompt-generation-composer";
  if (!composerOutput || !patch || typeof patch !== "object" || Array.isArray(patch)) return [];
  return PROMPT_COMPOSER_IMMUTABLE_ASSET_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(patch, field) &&
    JSON.stringify(patch[field]) !== JSON.stringify(asset?.[field])
  );
}

function normalizedKey(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mentionBoundary(character) {
  return !character || /[\s([{,;:]/.test(character);
}

function mentionCharacter(character, nextCharacter = "") {
  if (/[A-Za-z0-9_-]/.test(character)) return true;
  return character === "." && /[A-Za-z0-9]/.test(nextCharacter);
}

export function parseServerPromptMentions(value) {
  const source = String(value || "");
  const mentions = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "@" || !mentionBoundary(source[index - 1])) continue;
    let end = index + 1;
    while (end < source.length && mentionCharacter(source[end], source[end + 1])) end += 1;
    const display = source.slice(index, end);
    const key = normalizedKey(display);
    if (key) mentions.push({ display, key, start: index, end });
    index = Math.max(index, end - 1);
  }
  return mentions;
}

function basename(value) {
  return String(value || "").replace(/\\/g, "/").split("/").at(-1) || "";
}

function primaryAssetName(asset) {
  const explicit = String(asset?.mentionHandle || asset?.handle || "").trim().replace(/^@/, "");
  if (explicit) return explicit;
  const name = String(asset?.name || "").trim();
  if (name) return name.split(/\s+(?:-|–|—|:)\s+/, 1)[0].trim() || name;
  return String(asset?.id || "asset").replace(/^[a-z]+-/, "").split("-").slice(0, 4).join(" ");
}

function handlePart(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\.(png|jpe?g|webp|gif|svg|mp3|wav|flac|m4a|aac|ogg|mp4|mov|mkv|webm)$/i, "")
    .replace(/[’']/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function activeAssetVersion(asset) {
  return (asset?.versions || []).find((version) => Number(version?.v) === Number(asset?.activeVersion)) || null;
}

function activeAssetFile(asset) {
  const version = activeAssetVersion(asset);
  return String(version?.file || version?.files?.[0] || "").trim() || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function assetMentionAliases(asset) {
  const primary = primaryAssetName(asset);
  const primaryPart = handlePart(primary);
  const category = String(asset?.category || asset?.mediaType || "asset").trim();
  const extension = asset?.mediaType === "audio" ? ".wav" : asset?.mediaType === "video" ? ".mp4" : ".png";
  const aliases = [
    primary,
    primaryPart,
    asset?.name,
    asset?.id,
    `${category}_${primaryPart}`,
    `${category}_${primaryPart}${extension}`,
    `${category}-${primaryPart}`,
    ...(Array.isArray(asset?.aliases) ? asset.aliases : []),
    ...(Array.isArray(asset?.mentionAliases) ? asset.mentionAliases : [])
  ];
  for (const file of [asset?.canonicalFile, asset?.sourceAssetFile, activeAssetFile(asset)]) {
    if (!file) continue;
    aliases.push(basename(file));
    aliases.push(basename(file).replace(/\.v\d+(?:-\d+)?(?=\.)/i, ""));
  }
  return unique(aliases.map(normalizedKey).filter(Boolean));
}

function assetMentionPriority(asset) {
  const categoryIndex = MENTION_CATEGORY_PRIORITY.indexOf(String(asset?.category || ""));
  const categoryScore = categoryIndex < 0 ? MENTION_CATEGORY_PRIORITY.length : categoryIndex;
  const variant = String(asset?.variant || "");
  const primaryVariant = /appearance|primary|identity|production reference/i.test(variant) ? 0 : 1;
  const generated = Number(asset?.activeVersion || 0) > 0 ? 0 : 1;
  return [categoryScore, primaryVariant, generated, String(asset?.id || "")];
}

function compareAssetMentionPriority(left, right) {
  const a = assetMentionPriority(left);
  const b = assetMentionPriority(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return typeof a[index] === "number" ? a[index] - b[index] : String(a[index]).localeCompare(String(b[index]));
  }
  return 0;
}

function genericMentionVariant(value) {
  return /^(primary|appearance|production reference|reference|voice design|default)$/i.test(String(value || "").trim());
}

function mentionCategorySuffix(asset) {
  const category = String(asset?.category || "").toLowerCase();
  return MENTION_CATEGORY_SUFFIXES[category] || handlePart(category || asset?.mediaType || "Asset") || "Asset";
}

export function buildServerAssetMentionOptions(assets = []) {
  const provisional = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.id).map((asset) => {
    const basePart = handlePart(primaryAssetName(asset)) || "Asset";
    return { asset, basePart, baseKey: normalizedKey(basePart) };
  });
  const groups = new Map();
  for (const entry of provisional) {
    if (!groups.has(entry.baseKey)) groups.set(entry.baseKey, []);
    groups.get(entry.baseKey).push(entry);
  }

  const usedHandles = new Set();
  const handleById = new Map();
  for (const entries of groups.values()) {
    entries.sort((left, right) => compareAssetMentionPriority(left.asset, right.asset));
    entries.forEach((entry, index) => {
      let part = entry.basePart;
      if (index > 0) {
        part = `${entry.basePart}_${mentionCategorySuffix(entry.asset)}`;
        if (usedHandles.has(normalizedKey(part)) && !genericMentionVariant(entry.asset?.variant)) {
          part = `${part}_${handlePart(entry.asset.variant)}`;
        }
      }
      let candidate = part;
      let suffix = 2;
      while (usedHandles.has(normalizedKey(candidate))) candidate = `${part}_${suffix++}`;
      usedHandles.add(normalizedKey(candidate));
      handleById.set(entry.asset.id, `@${candidate}`);
    });
  }

  return provisional.map(({ asset }) => {
    const handle = handleById.get(asset.id);
    return {
      assetId: String(asset.id),
      handle,
      handleKey: normalizedKey(handle),
      aliases: unique([normalizedKey(handle), ...assetMentionAliases(asset)])
    };
  }).sort((left, right) => compareAssetMentionPriority(
    provisional.find((entry) => entry.asset.id === left.assetId)?.asset,
    provisional.find((entry) => entry.asset.id === right.assetId)?.asset
  ));
}

function resolveServerMentionToken(token, options) {
  const key = normalizedKey(token);
  if (!key) return { status: "unresolved", candidates: [] };
  const exactHandles = options.filter((option) => option.handleKey === key);
  if (exactHandles.length === 1) return { status: "resolved", option: exactHandles[0], candidates: exactHandles };
  const aliases = options.filter((option) => option.aliases.includes(key));
  if (aliases.length === 1) return { status: "resolved", option: aliases[0], candidates: aliases };
  const candidates = exactHandles.length > 1 ? exactHandles : aliases;
  return candidates.length ? { status: "ambiguous", candidates } : { status: "unresolved", candidates: [] };
}

export function deriveUnresolvedPromptMentions(project, promptText, references = []) {
  const assets = Array.isArray(project?.assets?.items) ? project.assets.items : [];
  const options = buildServerAssetMentionOptions(assets);
  const pins = Array.isArray(references) ? references : [];
  const promptMentions = parseServerPromptMentions(promptText);
  const promptMentionKeys = new Set(promptMentions.map((mention) => mention.key));
  const unresolved = [];
  const seen = new Set();
  const addUnresolved = (display, reason, candidates = [], details = {}) => {
    const key = `${normalizedKey(display)}:${reason}:${details.assetId || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    unresolved.push({
      display,
      reason,
      candidates: candidates.map((candidate) => candidate.assetId).filter(Boolean),
      ...details
    });
  };

  // Never trust the client-provided token-to-asset association. A pin may name
  // only the asset resolved by the server's own deterministic handle catalog.
  for (const reference of pins) {
    const display = String(reference?.display || reference?.token || "").trim();
    if (!display) {
      addUnresolved(String(reference?.assetId || "reference"), "reference_display_missing", [], {
        assetId: String(reference?.assetId || "")
      });
      continue;
    }
    const resolution = resolveServerMentionToken(display, options);
    if (resolution.status !== "resolved") {
      addUnresolved(display, `reference_display_${resolution.status}`, resolution.candidates, {
        assetId: String(reference?.assetId || "")
      });
    } else if (resolution.option.assetId !== String(reference?.assetId || "")) {
      addUnresolved(display, "reference_display_asset_mismatch", resolution.candidates, {
        assetId: String(reference?.assetId || ""),
        resolvedAssetId: resolution.option.assetId
      });
    } else if (!promptMentionKeys.has(normalizedKey(display))) {
      addUnresolved(display, "reference_display_not_in_prompt", resolution.candidates, {
        assetId: String(reference?.assetId || "")
      });
    }
  }

  for (const mention of promptMentions) {
    const resolution = resolveServerMentionToken(mention.display, options);
    if (resolution.status !== "resolved") {
      addUnresolved(mention.display, resolution.status, resolution.candidates);
      continue;
    }
    const bound = pins.some((reference) => String(reference?.assetId || "") === resolution.option.assetId);
    if (!bound) addUnresolved(mention.display, "unbound", [resolution.option]);
  }
  return unresolved;
}

const ASPECT_DIMENSIONS = Object.freeze({
  "16:9": { width: 768, height: 448 },
  "2.39:1": { width: 768, height: 320 },
  "9:16": { width: 448, height: 768 },
  "4:3": { width: 768, height: 576 },
  "3:2": { width: 768, height: 512 },
  "1:1": { width: 768, height: 768 }
});

function canonicalOutputKind(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "voice-design") return "voice";
  return GENERATION_OUTPUT_KINDS.includes(normalized) ? normalized : normalized;
}

function canonicalReference(reference, index) {
  return {
    mentionId: String(reference?.mentionId || `mention-${index + 1}`),
    display: String(reference?.display || reference?.token || "").trim(),
    assetId: String(reference?.assetId || "").trim(),
    assetVersion: reference?.assetVersion,
    role: String(reference?.role || "").trim(),
    order: reference?.order ?? index + 1,
    required: reference?.required !== false,
    notes: typeof reference?.notes === "string" ? reference.notes : ""
  };
}

export function normalizePromptGenerationPayload(project, body = {}) {
  const outputKind = canonicalOutputKind(body.outputKind ?? body.outputMode);
  const promptText = String(body.promptText ?? body.prompt ?? "").trim();
  const submittedReferences = (Array.isArray(body.references) ? body.references : []).map(canonicalReference);
  const sourceOptions = body.options && typeof body.options === "object" && !Array.isArray(body.options)
    ? body.options
    : {};
  const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? body.settings
    : {};
  const options = { ...sourceOptions };

  if (["image", "design"].includes(outputKind) && options.aspectRatio === undefined && settings.aspectRatio !== undefined) {
    options.aspectRatio = String(settings.aspectRatio);
  }
  if (outputKind === "video") {
    const aspectRatio = String(options.aspectRatio ?? settings.aspectRatio ?? "2.39:1");
    const dimensions = ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS["2.39:1"];
    if (options.durationSec === undefined && settings.durationSec !== undefined) options.durationSec = Number(settings.durationSec);
    if (options.fps === undefined) options.fps = Number(project?.settings?.fps) || 24;
    if (options.width === undefined) options.width = dimensions.width;
    if (options.height === undefined) options.height = dimensions.height;
    delete options.aspectRatio;
  }
  if (["voice", "dialogue", "audio"].includes(outputKind) && options.durationSec === undefined && settings.durationSec !== undefined) {
    options.durationSec = Number(settings.durationSec);
  }
  const unresolvedMentions = deriveUnresolvedPromptMentions(project, promptText, submittedReferences);
  const canonicalHandles = new Map(buildServerAssetMentionOptions(project?.assets?.items || []).map((option) => [option.assetId, option.handle]));
  const references = submittedReferences.map((reference) => ({
    ...reference,
    display: canonicalHandles.get(reference.assetId) || reference.display
  }));
  return {
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    outputKind,
    workflowId: String(body.workflowId || "").trim(),
    promptText,
    references,
    unresolvedMentions,
    options
  };
}

function readinessMap(catalog) {
  return Object.fromEntries(catalog.map((workflow) => [workflow.id, {
    ready: workflow.ready,
    availableNow: workflow.availableNow,
    reason: workflow.runtimeWarning || workflow.reason
  }]));
}

function disconnectedPromptWorkflowReason(workflow) {
  if (workflow.id === "qwen3-tts-voice-design-1.7b") {
    return "This standalone voice workflow is not connected to the prompt-composer queue yet. Use Create Sound → Voice Design; Dialogue also requires an explicitly linked provider voice, never a guessed character name.";
  }
  if (["ace-step-1.5-xl-turbo", "ltx-2.3-native-audio"].includes(workflow.id)) {
    return "This audio workflow is not connected to the asset-aware prompt composer yet. Use Create Sound for the current music, dialogue, and sound workflow.";
  }
  return "This curated workflow is not connected to the prompt-composer queue yet; use its existing Asset Generation workspace";
}

export async function getPromptGenerationWorkflowCatalog({
  force = false,
  assetWorkflowCatalog,
  objectInfo
} = {}) {
  let assetCatalog = assetWorkflowCatalog;
  let runtimeInfo = objectInfo;
  if (!assetCatalog) {
    try { assetCatalog = await getAssetWorkflowCatalog(force); } catch { assetCatalog = []; }
  }
  if (!runtimeInfo) {
    try { runtimeInfo = await getObjectInfo(force); } catch { runtimeInfo = null; }
  }
  let probeGraphs = null;
  let probeGraphError = null;
  if (runtimeInfo) {
    try { probeGraphs = storyboardRuntimeProbeGraphs(); } catch (error) { probeGraphError = error; }
  }
  const runtimeReadiness = {};
  for (const workflowId of PROMPT_GENERATION_EXECUTABLE_WORKFLOWS) {
    const requirements = WORKFLOW_RUNTIME_REQUIREMENTS[workflowId];
    const baseline = requirements.baselineAssetWorkflowId
      ? assetCatalog.find((workflow) => workflow.id === requirements.baselineAssetWorkflowId)
      : null;
    const validation = runtimeInfo && probeGraphs
      ? validateStoryboardRuntimeGraph(probeGraphs[requirements.probeKind], runtimeInfo)
      : null;
    const baselineMissing = Boolean(requirements.baselineAssetWorkflowId && !baseline);
    const baselineBlocked = baseline && (baseline.ready === false || baseline.availableNow === false);
    const ready = Boolean(runtimeInfo && validation?.ready && !baselineMissing && !baselineBlocked);
    const reason = !runtimeInfo
      ? "The active ComfyUI schema could not be checked"
      : probeGraphError
        ? `The exact Storyboard execution graph could not be inspected: ${String(probeGraphError.message || probeGraphError)}`
        : validation?.missingClasses?.length
          ? `Active ComfyUI is missing executable Storyboard nodes: ${validation.missingClasses.join(", ")}`
          : validation?.conversionWarnings?.length
            ? `The exact Storyboard graph does not convert cleanly: ${validation.conversionWarnings.join("; ")}`
            : validation?.missingInputs?.length
              ? `The exact Storyboard graph is missing required inputs: ${validation.missingInputs.join(", ")}`
              : validation?.invalidComboValues?.length
                ? `Active ComfyUI does not offer required model/combo values: ${validation.invalidComboValues.join("; ")}`
        : baselineMissing
          ? `Asset Foundry readiness for ${requirements.baselineAssetWorkflowId} could not be checked`
          : baselineBlocked
            ? (baseline.runtimeWarning || baseline.reason || "The required Krea runtime is unavailable")
            : "The exact flattened compiler graph, required inputs, and active model/combo values passed validation";
    runtimeReadiness[workflowId] = {
      ready,
      availableNow: ready,
      reason,
      checkedAt: new Date().toISOString()
    };
  }
  for (const workflow of getGenerationWorkflowCatalog()) {
    if (PROMPT_GENERATION_EXECUTABLE_WORKFLOWS.includes(workflow.id)) continue;
    runtimeReadiness[workflow.id] = {
      ready: false,
      availableNow: false,
      reason: workflow.creatable === false
        ? workflow.blockReason
        : disconnectedPromptWorkflowReason(workflow),
      checkedAt: new Date().toISOString()
    };
  }
  return getGenerationWorkflowCatalog({ readinessByWorkflow: runtimeReadiness });
}

function screenplayRevision(project) {
  const markdown = String(project?.screenplay?.markdown || "").trim();
  return markdown ? crypto.createHash("sha256").update(markdown).digest("hex") : null;
}

function requireProjectApprovalCurrent(project) {
  if (skipApproval(project) || skipScreenplay(project)) return;
  const revision = screenplayRevision(project);
  if (!revision || project?.screenplay?.approval?.status !== "approved" || project.screenplay.approval.screenplayRevision !== revision) {
    throw new PromptGenerationError("Approve the current screenplay revision before creating a prompt generation.", {
      status: 409,
      code: "SCREENPLAY_APPROVAL_STALE"
    });
  }
  if (project?.assets?.screenplayHash !== revision) {
    throw new PromptGenerationError("Refresh the Asset Library from the approved screenplay before using its references.", {
      status: 409,
      code: "ASSET_MANIFEST_STALE"
    });
  }
}

export function assertPinnedReferencesCurrent(project, references) {
  requireProjectApprovalCurrent(project);
  const byId = new Map((project?.assets?.items || []).map((asset) => [asset.id, asset]));
  for (const reference of references || []) {
    const asset = byId.get(reference.assetId);
    if (!asset) {
      throw new PromptGenerationError(`Pinned asset disappeared: ${reference.assetId}`, { status: 409, code: "PINNED_ASSET_MISSING" });
    }
    if (Number(asset.activeVersion) !== Number(reference.assetVersion)) {
      throw new PromptGenerationError(`${reference.assetVersionId || reference.assetId} is stale; ${asset.id}:v${asset.activeVersion || 0} is active.`, {
        status: 409,
        code: "PINNED_ASSET_VERSION_STALE"
      });
    }
    if (!assetVersionFilesCurrent(project, asset)) {
      throw new PromptGenerationError(`${reference.assetVersionId || reference.assetId} no longer matches its exact project file hashes.`, {
        status: 409,
        code: "PINNED_ASSET_FILE_STALE"
      });
    }
    if (!(skipApproval(project) || skipScreenplay(project)) && !assetApprovalCurrent(project, asset)) {
      throw new PromptGenerationError(`${reference.assetVersionId || reference.assetId} is not the currently approved asset version.`, {
        status: 409,
        code: "PINNED_ASSET_APPROVAL_STALE"
      });
    }
  }
  return true;
}

function promptGenerationState(project) {
  const state = project?.promptGenerations;
  if (state?.schema === PROMPT_GENERATION_SCHEMA && Array.isArray(state.items)) return state;
  return { schema: PROMPT_GENERATION_SCHEMA, items: [] };
}

function outputModeForKind(kind) {
  return kind === "voice" ? "voice-design" : kind;
}

export function publicPromptGeneration(generation) {
  if (!generation) return null;
  return clone({
    id: generation.id,
    schemaVersion: generation.schemaVersion,
    outputKind: generation.outputKind,
    outputMode: generation.outputMode,
    workflowId: generation.workflowId,
    promptText: generation.promptText,
    prompt: generation.promptText,
    references: generation.resolvedReferences,
    options: generation.options,
    fingerprint: generation.fingerprint,
    status: generation.status,
    lastError: generation.lastError,
    result: generation.result,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt
  });
}

function generationById(project, generationId) {
  return promptGenerationState(project).items.find((generation) => generation.id === generationId) || null;
}

export function createPromptGeneration(project, body, {
  workflows,
  activeJobs = [],
  id = `generation-${crypto.randomUUID()}`,
  now = new Date().toISOString(),
  saveProjectFn = saveProject,
  assertPinsFn = assertPinnedReferencesCurrent
} = {}) {
  const canonicalRequest = normalizePromptGenerationPayload(project, body);
  const catalog = Array.isArray(workflows) ? workflows : [];
  const selectedWorkflow = catalog.find((workflow) => workflow.id === canonicalRequest.workflowId);
  if (!selectedWorkflow || selectedWorkflow.ready !== true || selectedWorkflow.availableNow === false) {
    throw new PromptGenerationError(
      selectedWorkflow?.runtimeWarning || selectedWorkflow?.reason || "The selected prompt workflow has not passed a current runtime readiness check.",
      { status: 409, code: "PROMPT_WORKFLOW_NOT_READY" }
    );
  }
  const preflight = preflightGenerationRequest(project, canonicalRequest, {
    readinessByWorkflow: readinessMap(catalog)
  });
  if (!preflight.ok) {
    const message = preflight.errors.map((error) => error.message).join(" ");
    const readinessError = preflight.errors.some((error) => ["workflow_not_ready", "workflow_not_available_now", "workflow_not_creatable"].includes(error.code));
    throw new PromptGenerationError(message || "Prompt generation preflight failed", {
      status: readinessError ? 409 : 400,
      code: "PROMPT_GENERATION_PREFLIGHT_FAILED",
      errors: preflight.errors
    });
  }
  if (!PROMPT_GENERATION_EXECUTABLE_WORKFLOWS.includes(preflight.request.workflowId)) {
    throw new PromptGenerationError("The selected workflow is not connected to the prompt-generation queue.", {
      status: 409,
      code: "PROMPT_WORKFLOW_UNSUPPORTED"
    });
  }
  assertPinsFn(project, preflight.resolvedReferences);

  const duplicateJob = activeJobs.find((job) =>
    job.projectSlug === project.slug &&
    job.type === PROMPT_GENERATION_JOB_TYPE &&
    job.refs?.requestFingerprint === preflight.fingerprint &&
    ACTIVE_JOB_STATUSES.has(String(job.status || ""))
  );
  if (duplicateJob) {
    const existing = generationById(project, duplicateJob.refs?.generationId);
    if (existing) return { project, generation: publicPromptGeneration(existing), preflight, job: duplicateJob, alreadyQueued: true };
  }

  const next = clone(project);
  const state = promptGenerationState(next);
  next.promptGenerations = state;
  const generation = {
    schemaVersion: GENERATION_COMPOSER_SCHEMA_VERSION,
    id,
    projectSlug: project.slug,
    outputKind: preflight.request.outputKind,
    outputMode: outputModeForKind(preflight.request.outputKind),
    workflowId: preflight.request.workflowId,
    promptText: preflight.request.promptText,
    options: clone(preflight.request.options),
    request: clone(preflight.request),
    resolvedReferences: clone(preflight.resolvedReferences),
    fingerprint: preflight.fingerprint,
    screenplayRevision: screenplayRevision(project),
    manifestScreenplayHash: project?.assets?.screenplayHash || null,
    status: "queued",
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now
  };
  state.items.push(generation);
  if (state.items.length > MAX_PROMPT_GENERATIONS) {
    const removable = state.items.filter((item) => !ACTIVE_GENERATION_STATUSES.has(item.status));
    while (state.items.length > MAX_PROMPT_GENERATIONS && removable.length) {
      const target = removable.shift();
      state.items.splice(state.items.indexOf(target), 1);
    }
  }
  saveProjectFn(next);
  return { project: next, generation: publicPromptGeneration(generation), preflight, job: null, alreadyQueued: false };
}

async function withPromptCreateLock(projectSlug, operation) {
  const key = String(projectSlug || "");
  const previous = PROMPT_CREATE_LOCKS.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  PROMPT_CREATE_LOCKS.set(key, tail);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (PROMPT_CREATE_LOCKS.get(key) === tail) PROMPT_CREATE_LOCKS.delete(key);
  }
}

export async function createAndEnqueuePromptGeneration(projectSlug, body, {
  getCatalogFn = getPromptGenerationWorkflowCatalog,
  loadProjectFn = loadProject,
  saveProjectFn = saveProject,
  listJobsFn,
  enqueueFn,
  assertPinsFn = assertPinnedReferencesCurrent
} = {}) {
  if (typeof listJobsFn !== "function" || typeof enqueueFn !== "function") {
    throw new PromptGenerationError("Prompt generation queue integration is unavailable.", {
      status: 503,
      code: "PROMPT_QUEUE_UNAVAILABLE"
    });
  }
  const workflows = await getCatalogFn();
  return withPromptCreateLock(projectSlug, () => {
    // Loading happens inside the per-project critical section and after every
    // asynchronous readiness check. Concurrent POSTs therefore see the
    // generation saved by the request immediately ahead of them.
    const project = loadProjectFn(projectSlug);
    const prepared = createPromptGeneration(project, body, {
      workflows,
      activeJobs: listJobsFn(),
      saveProjectFn,
      assertPinsFn
    });
    if (prepared.alreadyQueued) {
      return {
        project: prepared.project,
        generation: prepared.generation,
        job: prepared.job,
        alreadyQueued: true
      };
    }
    const workflow = workflows.find((item) => item.id === prepared.generation.workflowId);
    let job;
    try {
      job = enqueueFn({
        type: PROMPT_GENERATION_JOB_TYPE,
        projectSlug: prepared.project.slug,
        label: `Generate ${prepared.generation.outputMode} · ${workflow?.label || prepared.generation.workflowId}`,
        refs: {
          generationId: prepared.generation.id,
          requestFingerprint: prepared.generation.fingerprint,
          workflowId: prepared.generation.workflowId,
          outputKind: prepared.generation.outputKind,
          screenplayRevision: prepared.project.screenplay?.approval?.screenplayRevision || null,
          manifestScreenplayHash: prepared.project.assets?.screenplayHash || null
        }
      });
    } catch (error) {
      const stored = generationById(prepared.project, prepared.generation.id);
      if (stored) {
        stored.status = "failed";
        stored.lastError = `Queue insertion failed: ${String(error?.message || error)}`;
        stored.updatedAt = new Date().toISOString();
        saveProjectFn(prepared.project);
      }
      throw error;
    }
    if (job?.refs?.generationId !== prepared.generation.id) {
      const canonicalProject = loadProjectFn(projectSlug);
      const canonicalGeneration = generationById(canonicalProject, job?.refs?.generationId);
      if (!canonicalGeneration || canonicalGeneration.fingerprint !== prepared.generation.fingerprint) {
        throw new Error("Prompt queue deduplication returned a job without its canonical generation state");
      }
      return {
        project: canonicalProject,
        generation: publicPromptGeneration(canonicalGeneration),
        job,
        alreadyQueued: true
      };
    }
    return {
      project: prepared.project,
      generation: prepared.generation,
      job,
      alreadyQueued: false
    };
  });
}

function mutateGeneration(slug, generationId, mutate, {
  loadProjectFn = loadProject,
  saveProjectFn = saveProject
} = {}) {
  if (!slug || !generationId) return null;
  const project = loadProjectFn(slug);
  const generation = generationById(project, generationId);
  if (!generation) return null;
  mutate(generation, project);
  generation.updatedAt = new Date().toISOString();
  saveProjectFn(project);
  return { project, generation: publicPromptGeneration(generation) };
}

export function restorePromptGenerationAfterCancellation(slug, generationId, dependencies) {
  return mutateGeneration(slug, generationId, (generation) => {
    if (!ACTIVE_GENERATION_STATUSES.has(generation.status)) return;
    generation.status = "cancelled";
    generation.lastError = null;
  }, dependencies);
}

export function markPromptGenerationFailed(slug, generationId, error, dependencies) {
  return mutateGeneration(slug, generationId, (generation) => {
    generation.status = "failed";
    generation.lastError = String(error?.message || error || "Prompt generation failed");
  }, dependencies);
}

function hashFile(file) {
  const buffer = fs.readFileSync(file);
  return { sha256: crypto.createHash("sha256").update(buffer).digest("hex"), bytes: buffer.byteLength };
}

function assertContained(root, target, label) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(target);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its project-owned root`);
  }
  return absolute;
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function materializePromptReferencePackage(project, referencePackage) {
  if (!referencePackage?.materializationRequired) return null;
  const root = projectDir(project.slug);
  const destinationRoot = assertContained(root, path.join(root, referencePackage.projectRelativeRoot), "Reference package");
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const file of referencePackage.files || []) {
    const source = assertContained(root, path.join(root, String(file.sourceProjectMediaPath || "")), "Reference source");
    const destination = assertContained(destinationRoot, path.join(destinationRoot, String(file.destinationRelativePath || "")), "Reference destination");
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Pinned reference source is missing: ${file.sourceProjectMediaPath}`);
    const sourceHash = hashFile(source);
    if (sourceHash.sha256 !== file.sha256 || sourceHash.bytes !== file.bytes) {
      throw new Error(`Pinned reference changed before package materialization: ${file.sourceProjectMediaPath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
      const destinationHash = hashFile(destination);
      if (destinationHash.sha256 !== file.sha256 || destinationHash.bytes !== file.bytes) {
        throw new Error(`Immutable reference package collision: ${file.destinationRelativePath}`);
      }
      continue;
    }
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      const copied = hashFile(temporary);
      if (copied.sha256 !== file.sha256 || copied.bytes !== file.bytes) throw new Error(`Reference copy verification failed: ${file.destinationRelativePath}`);
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }
  const indexFile = assertContained(destinationRoot, path.join(destinationRoot, referencePackage.indexRelativePath || "asset_index.json"), "Reference index");
  const expectedIndex = JSON.stringify(referencePackage.assetIndex, null, 2);
  if (fs.existsSync(indexFile)) {
    if (fs.readFileSync(indexFile, "utf8") !== expectedIndex) throw new Error("Immutable reference package index collision");
  } else {
    writeJsonAtomic(indexFile, referencePackage.assetIndex);
  }
  return { root: destinationRoot, indexFile, fileCount: (referencePackage.files || []).length };
}

function generatedFileHashes(project, files, mediaDirFn = mediaDir) {
  return [...new Set(files.map((file) => basename(file)).filter(Boolean))]
    .map((file) => {
      const absolute = path.join(mediaDirFn(project, "assets"), file);
      const state = hashFile(absolute);
      return { file, ...state, extension: path.extname(file).toLowerCase() };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function archivePromptWorkflowSnapshot(project, generation, compiled, version, projectDirFn = projectDir) {
  if (!compiled?.graph || typeof compiled.graph !== "object") throw new Error("Compiled prompt generation has no immutable workflow graph");
  const graphHash = crypto.createHash("sha256").update(JSON.stringify(compiled.graph)).digest("hex");
  if (compiled.workflowHash && String(compiled.workflowHash).toLowerCase() !== graphHash) {
    throw new Error("Compiled prompt workflow hash does not match its graph");
  }
  const buffer = Buffer.from(JSON.stringify(compiled.graph, null, 2));
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const relative = `workflows/prompt-generations/${generation.id}.v${version}.${sha256.slice(0, 16)}.json`;
  const root = projectDirFn(project.slug);
  const destination = assertContained(root, path.join(root, ...relative.split("/")), "Prompt workflow snapshot");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    const existing = hashFile(destination);
    if (existing.sha256 !== sha256 || existing.bytes !== buffer.byteLength) throw new Error("Immutable prompt workflow snapshot collision");
  } else {
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, buffer, { flag: "wx" });
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }
  return { file: relative, sha256 };
}

function outputAssetId(fingerprint) {
  return `prompt-generation-${fingerprint.slice(0, 24)}`;
}

function outputAssetName(generation) {
  const compact = generation.promptText.replace(/\s+/g, " ").trim().slice(0, 96);
  return compact || `${generation.outputMode} prompt generation`;
}

function nextAssetVersion(asset) {
  return Math.max(0, ...(asset?.versions || []).map((version) => Number(version?.v) || 0)) + 1;
}

function currentGenerationOrThrow(project, job) {
  const generation = generationById(project, job.refs?.generationId);
  if (!generation) throw new Error(`Prompt generation disappeared: ${job.refs?.generationId || "missing"}`);
  if (generation.fingerprint !== job.refs?.requestFingerprint) throw new Error("Prompt generation request fingerprint changed after queueing");
  return generation;
}

function throwIfCancelled(job) {
  if (!job.signal?.aborted && job.status !== "cancelling") return;
  const error = new Error("Prompt generation stopped by director");
  error.code = "GENERATION_CANCELLED";
  throw error;
}

export function registerPromptOutput(project, generation, compiled, files, {
  mediaDirFn = mediaDir,
  projectDirFn = projectDir,
  saveAssetPackageFilesFn = saveAssetPackageFiles,
  saveProjectFn = saveProject,
  updateAssetManifestCountsFn = updateAssetManifestCounts
} = {}) {
  const state = promptGenerationState(project);
  project.promptGenerations = state;
  const targetGeneration = state.items.find((item) => item.id === generation.id);
  if (!targetGeneration || targetGeneration.fingerprint !== generation.fingerprint) {
    throw new Error("Prompt generation changed before its output could be registered");
  }
  const assetId = outputAssetId(generation.fingerprint);
  project.assets ||= { schemaVersion: 1, counts: {}, total: 0, items: [], deletedItems: [] };
  project.assets.items ||= [];
  let asset = project.assets.items.find((item) => item.id === assetId);
  const mediaType = generation.outputKind === "video" ? "video" : "image";
  const category = generation.outputKind === "design" ? "graphic" : "guide-frame";
  if (!asset) {
    asset = {
      id: assetId,
      category,
      categoryLabel: category === "graphic" ? "Graphics" : "Guide Frames",
      name: outputAssetName(generation),
      variant: `${generation.outputMode === "video" ? "Video" : generation.outputMode === "design" ? "Design" : "Image"} Prompt Generation`,
      mediaType,
      prompt: generation.promptText,
      sourcePrompt: generation.promptText,
      source: "prompt-generation-composer",
      reviewState: "prompt-generation-composer",
      generationComposer: true,
      regenerationMode: "prompt-composer",
      status: "planned",
      workflowId: generation.workflowId,
      workflowHash: compiled.workflowHash,
      seed: compiled.seed ?? compiled.settings?.seed ?? generation.options.seed ?? null,
      durationSec: generation.options.durationSec ?? null,
      dependencies: generation.resolvedReferences.map((reference) => reference.assetId),
      continuity: [],
      versions: [],
      activeVersion: 0,
      approval: null,
      createdAt: generation.createdAt,
      updatedAt: generation.updatedAt
    };
    project.assets.items.push(asset);
  }
  if (
    asset.generationComposer !== true ||
    asset.regenerationMode !== "prompt-composer" ||
    asset.workflowId !== generation.workflowId ||
    asset.prompt !== generation.promptText
  ) {
    throw new Error(`Prompt output asset identity collision: ${assetId}`);
  }
  const version = nextAssetVersion(asset);
  asset.workflowHash = compiled.workflowHash;
  asset.seed = compiled.seed ?? compiled.settings?.seed ?? asset.seed ?? null;
  asset.durationSec = generation.options.durationSec ?? asset.durationSec ?? null;
  asset.updatedAt = new Date().toISOString();
  const assetFingerprint = assetGenerationFingerprint(asset);
  const revision = screenplayRevision(project);
  const fileHashes = generatedFileHashes(project, files, mediaDirFn);
  const workflowSnapshot = archivePromptWorkflowSnapshot(project, generation, compiled, version, projectDirFn);
  asset.workflowSnapshot = workflowSnapshot.file;
  asset.versions.push({
    v: version,
    files,
    file: files[0],
    mediaType,
    workflowId: generation.workflowId,
    workflowHash: compiled.workflowHash,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    sourceWorkflowHash: compiled.sourceWorkflowHash || null,
    model: compiled.graph?.extra?.premiere316?.model || null,
    prompt: generation.promptText,
    seed: asset.seed,
    durationSec: asset.durationSec,
    width: compiled.settings?.width ?? compiled.resolution?.width ?? null,
    height: compiled.settings?.height ?? compiled.resolution?.height ?? null,
    fps: compiled.settings?.fps ?? null,
    authoredFrames: compiled.settings?.authoredFrames ?? null,
    decodedFrames: compiled.settings?.generationFrames ?? null,
    assetFingerprint,
    generationFingerprint: generation.fingerprint,
    sourceGenerationId: generation.id,
    generationComposer: true,
    regenerationMode: "prompt-composer",
    screenplayRevision: revision,
    manifestScreenplayHash: project.assets.screenplayHash || revision,
    references: clone(generation.resolvedReferences),
    fileHashes,
    createdAt: new Date().toISOString()
  });
  asset.activeVersion = version;
  asset.status = "generated";
  asset.approval = null;
  asset.approvalCurrent = false;
  targetGeneration.status = "generated";
  targetGeneration.lastError = null;
  targetGeneration.result = {
    assetId,
    assetVersion: version,
    files,
    mediaType,
    workflowHash: compiled.workflowHash,
    requestFingerprint: generation.fingerprint,
    generationComposer: true,
    regenerationMode: "prompt-composer"
  };
  targetGeneration.updatedAt = new Date().toISOString();
  updateAssetManifestCountsFn(project.assets);
  saveAssetPackageFilesFn(project);
  saveProjectFn(project);
  return { asset, generation: targetGeneration, version, files };
}

const DEFAULT_EXECUTION_DEPENDENCIES = Object.freeze({
  loadProject,
  saveProject,
  getCatalog: getPromptGenerationWorkflowCatalog,
  compileImage: compileStoryboardFramePrompt,
  compileVideo: compileStoryboardVideoPlanPrompt,
  materializeReferences: materializePromptReferencePackage,
  runPrompt,
  collectOutputFiles,
  downloadOutput,
  trimVideoToFrames,
  mediaDir,
  assertPins: assertPinnedReferencesCurrent,
  registerOutput: registerPromptOutput
});

export async function generatePromptAssetJob(job, overrides = {}) {
  const dependencies = { ...DEFAULT_EXECUTION_DEPENDENCIES, ...overrides };
  const catalog = await dependencies.getCatalog();
  let project = dependencies.loadProject(job.projectSlug);
  let generation = currentGenerationOrThrow(project, job);
  if (!ACTIVE_GENERATION_STATUSES.has(generation.status)) throw new Error(`Prompt generation is not queueable from status ${generation.status}`);
  const preflight = preflightGenerationRequest(project, generation.request, { readinessByWorkflow: readinessMap(catalog) });
  if (!preflight.ok) throw new Error(`Prompt generation became invalid after queueing: ${preflight.errors.map((error) => error.message).join(" ")}`);
  if (preflight.fingerprint !== generation.fingerprint) throw new Error("Prompt generation request or pinned assets changed after queueing");
  dependencies.assertPins(project, preflight.resolvedReferences);
  generation.status = "running";
  generation.lastError = null;
  generation.updatedAt = new Date().toISOString();
  dependencies.saveProject(project);

  throwIfCancelled(job);
  let compiled;
  if (generation.workflowId === STORYBOARD_KREA_GENERATION_WORKFLOW_ID) {
    const synthetic = buildSyntheticImageStoryboardInput(project, preflight);
    compiled = await dependencies.compileImage(synthetic.project, synthetic.storyboard, synthetic.frameId);
    job.label = `Generate prompt image · ${outputAssetName(generation)}`;
    job.stage = "Generating reference-conditioned Krea image";
  } else if (generation.workflowId === STORYBOARD_LTX25_GENERATION_WORKFLOW_ID) {
    const synthetic = buildSyntheticVideoPlanInput(project, preflight);
    dependencies.materializeReferences(project, synthetic.referencePackage);
    compiled = await dependencies.compileVideo(synthetic.project, synthetic.storyboard, synthetic.videoPlanId);
    job.label = `Generate prompt video · ${outputAssetName(generation)}`;
    job.stage = "Generating LTX-2.5 semantic-reference video";
  } else {
    throw new Error(`Unsupported prompt-generation execution adapter: ${generation.workflowId}`);
  }
  job.progress = 0.05;
  throwIfCancelled(job);
  const outputs = await dependencies.runPrompt(compiled.apiPrompt, {
    signal: job.signal,
    onProgress: ({ value, max }) => {
      if (max) job.progress = Math.min(0.88, 0.08 + (value / max) * 0.8);
    }
  });
  throwIfCancelled(job);
  const outputRefs = dependencies.collectOutputFiles(outputs);

  project = dependencies.loadProject(job.projectSlug);
  generation = currentGenerationOrThrow(project, job);
  const latestPreflight = preflightGenerationRequest(project, generation.request, { readinessByWorkflow: readinessMap(catalog) });
  if (!latestPreflight.ok || latestPreflight.fingerprint !== generation.fingerprint) {
    throw new Error("Prompt output was retained in ComfyUI but not registered because its request or pinned assets changed during generation");
  }
  dependencies.assertPins(project, latestPreflight.resolvedReferences);
  const assetId = outputAssetId(generation.fingerprint);
  const existingAsset = project.assets?.items?.find((asset) => asset.id === assetId);
  const version = nextAssetVersion(existingAsset);
  const destination = dependencies.mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  let files;
  if (generation.outputKind === "video") {
    const videos = outputRefs.filter((reference) => VIDEO_OUTPUT_RE.test(String(reference?.filename || "")));
    if (videos.length !== 1) throw new Error(`ComfyUI completed with ${videos.length} video files; exactly one is required`);
    const raw = await dependencies.downloadOutput(videos[0], destination, `${assetId}.v${version}.decoded-raw`);
    const final = `${assetId}.v${version}.mp4`;
    job.stage = `Trimming decoded video to ${compiled.settings.authoredFrames} authored frames`;
    job.progress = 0.92;
    await dependencies.trimVideoToFrames(
      path.join(destination, raw),
      path.join(destination, final),
      compiled.settings.authoredFrames,
      compiled.settings.fps
    );
    try { fs.unlinkSync(path.join(destination, raw)); } catch {}
    files = [final];
  } else {
    const images = outputRefs.filter((reference) => IMAGE_OUTPUT_RE.test(String(reference?.filename || "")));
    if (!images.length) throw new Error("ComfyUI completed without an image output");
    files = [];
    for (let index = 0; index < images.length; index += 1) {
      const suffix = images.length === 1 ? "" : `-${index + 1}`;
      files.push(await dependencies.downloadOutput(images[index], destination, `${assetId}.v${version}${suffix}`));
    }
  }
  throwIfCancelled(job);
  const fresh = dependencies.loadProject(job.projectSlug);
  const freshGeneration = currentGenerationOrThrow(fresh, job);
  const freshAsset = fresh.assets?.items?.find((asset) => asset.id === assetId);
  if (nextAssetVersion(freshAsset) !== version) throw new Error("Prompt output was retained but not registered because another version completed first");
  const finalPreflight = preflightGenerationRequest(fresh, freshGeneration.request, { readinessByWorkflow: readinessMap(catalog) });
  if (!finalPreflight.ok || finalPreflight.fingerprint !== freshGeneration.fingerprint) {
    throw new Error("Prompt output was retained but not registered because its immutable request changed");
  }
  dependencies.assertPins(fresh, finalPreflight.resolvedReferences);
  const registered = dependencies.registerOutput(fresh, freshGeneration, compiled, files);
  job.result = {
    generationId: freshGeneration.id,
    assetId: registered.asset.id,
    assetVersion: registered.version,
    files: registered.files,
    requestFingerprint: freshGeneration.fingerprint
  };
  job.progress = 0.98;
}
