import crypto from "crypto";
import fs from "fs";
import path from "path";
import { collectOutputFiles, downloadOutput, runPrompt } from "./comfy.js";
import { probeMedia } from "./ffmpeg.js";
import { acquireGpuLease, gpuLeaseStatus, GPU_RESOURCE_OWNERS, releaseGpuLease, updateGpuLease } from "./gpu-resource-manager.js";
import { loadProject, saveProject } from "./projects.js";
import { projectDir } from "./paths.js";
import {
  audioCategoryDirectory,
  audioCategoryRelativeDirectory,
  ensureProjectAudioState,
  normalizeAudioAssetCategory,
  registerAudioAsset
} from "./audio-assets.js";
import { getAudioWorkflowProfile } from "./audio-workflows.js";

const AUDIO_EXTENSIONS = new Set([".wav", ".wave", ".mp3", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".webm"]);
const MAX_VARIATIONS = 16;

function generationError(message, statusCode = 400, code = "AUDIO_GENERATION_INVALID", extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value, max = 12000) {
  return value == null ? "" : String(value).trim().slice(0, max);
}

function normalizedWorkflowProvenance(value) {
  return {
    profileId: cleanText(value?.profileId, 200),
    sourceSha256: cleanText(value?.sourceSha256 ?? value?.source?.sha256, 128).toLowerCase(),
    apiSha256: cleanText(value?.apiSha256 ?? value?.api?.sha256, 128).toLowerCase(),
    bindingSha256: cleanText(value?.bindingSha256, 128).toLowerCase()
  };
}

function completeWorkflowProvenance(value) {
  const normalized = normalizedWorkflowProvenance(value);
  return Object.values(normalized).every(Boolean) ? normalized : null;
}

function sameWorkflowProvenance(left, right) {
  return left?.profileId === right?.profileId &&
    left?.sourceSha256 === right?.sourceSha256 &&
    left?.apiSha256 === right?.apiSha256 &&
    left?.bindingSha256 === right?.bindingSha256;
}

function staleWorkflowError(message, expected, actual, generationId = null) {
  return generationError(message, 409, "AUDIO_WORKFLOW_PROVENANCE_STALE", {
    expectedWorkflow: clone(expected),
    actualWorkflow: clone(actual),
    ...(generationId ? { generationId: String(generationId) } : {})
  });
}

function expectedWorkflowForJob(job, generationRecords) {
  const submitted = job?.expectedWorkflow ?? job?.workflowProvenance ?? job?.refs?.expectedWorkflow;
  if (submitted != null) {
    const expected = completeWorkflowProvenance(submitted);
    if (!expected) {
      throw staleWorkflowError("Audio job is missing complete immutable workflow provenance.", submitted, null);
    }
    return expected;
  }

  // Existing Create Sound jobs did not carry workflow provenance at the job
  // level. Protect them using the immutable workflow snapshot already stored
  // on every generation record. Truly legacy records without that snapshot
  // retain their previous behavior for backwards compatibility.
  const provenances = generationRecords.map((record) => completeWorkflowProvenance(record?.workflow));
  const provenCount = provenances.filter(Boolean).length;
  if (provenCount === 0) return null;
  if (provenCount !== provenances.length) {
    const index = provenances.findIndex((value) => !value);
    throw staleWorkflowError(
      "Queued audio generation records contain incomplete workflow provenance.",
      provenances.find(Boolean),
      generationRecords[index]?.workflow || null,
      generationRecords[index]?.id
    );
  }
  const expected = provenances[0];
  const mismatch = provenances.find((actual) => !sameWorkflowProvenance(actual, expected));
  if (mismatch) {
    throw staleWorkflowError("Queued audio generation records do not share one immutable workflow provenance.", expected, mismatch);
  }
  return expected;
}

function assertWorkflowExecutionCurrent(profile, generationRecords, expectedWorkflow) {
  if (!expectedWorkflow) return;
  const currentProfile = completeWorkflowProvenance({
    profileId: profile?.id,
    sourceSha256: profile?.source?.sha256 || profile?._manifest?.sourceWorkflowSha256,
    apiSha256: profile?.api?.sha256 || profile?._manifest?.apiWorkflowSha256,
    bindingSha256: profile?.bindingSha256 || profile?._manifest?.bindingsSha256
  });
  if (!currentProfile || !sameWorkflowProvenance(currentProfile, expectedWorkflow)) {
    throw staleWorkflowError("The Audio Workflow Library changed after this job was queued.", expectedWorkflow, currentProfile);
  }
  for (const record of generationRecords) {
    const actual = completeWorkflowProvenance(record?.workflow);
    if (!actual || !sameWorkflowProvenance(actual, expectedWorkflow)) {
      throw staleWorkflowError(
        `Audio generation ${record?.id || "unknown"} no longer matches the queued workflow provenance.`,
        expectedWorkflow,
        actual,
        record?.id
      );
    }
  }
}

function listText(value) {
  return Array.isArray(value) ? value.map((item) => cleanText(item, 500)).filter(Boolean).join(", ") : cleanText(value, 2000);
}

function safeStem(value) {
  return cleanText(value || "audio", 120).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "audio";
}

function canonicalCategory(value, profileCategory) {
  const requested = cleanText(value || profileCategory).toLowerCase();
  if (["sound effect", "sound fx", "sound_effect", "sound_effects", "sfx"].includes(requested)) return "sound-effect";
  if (requested === "voice") return "voice-design";
  if (requested === "hybrid") throw generationError("A hybrid workflow requires an explicit music, sound-effect, foley, ambience, or voice-design category");
  return normalizeAudioAssetCategory(requested);
}

function rawBindings(profile) {
  const manifest = profile?._manifest || profile || {};
  const inputs = manifest.inputNodeBindings || manifest.bindings?.inputs || manifest.bindings || {};
  const out = {};
  for (const [semantic, binding] of Object.entries(inputs)) {
    if (!binding) continue;
    if (typeof binding === "string") {
      const dot = binding.indexOf(".");
      out[semantic] = dot < 0 ? { nodeId: binding } : { nodeId: binding.slice(0, dot), input: binding.slice(dot + 1) };
    } else {
      out[semantic] = { ...binding, nodeId: String(binding.nodeId ?? binding.node ?? ""), input: String(binding.input ?? binding.inputName ?? "") };
    }
  }
  return out;
}

function semanticBinding(bindings, ...names) {
  for (const name of names) if (bindings[name]) return { semantic: name, binding: bindings[name] };
  return null;
}

function errorForRange(duration, range) {
  const min = finite(range?.min);
  const max = finite(range?.max);
  if (duration == null) return;
  if (min != null && duration < min) {
    throw generationError(`Duration ${duration}s is below this workflow's ${min}s minimum`, 422, "AUDIO_DURATION_BELOW_MINIMUM", { minimumSec: min });
  }
  if (max != null && duration > max) {
    const segments = planAudioSegments(duration, max);
    throw generationError(
      `Duration ${duration}s exceeds this workflow's ${max}s maximum; segmented generation must be explicitly requested and assembled`,
      422,
      "AUDIO_SEGMENTATION_REQUIRED",
      { maximumSec: max, requestedDurationSec: duration, segments }
    );
  }
}

export function planAudioSegments(durationValue, maximumValue) {
  const durationSec = finite(durationValue);
  const maximumSec = finite(maximumValue);
  if (!(durationSec > 0) || !(maximumSec > 0)) throw generationError("Positive duration and maximum are required for segmentation");
  const count = Math.ceil(durationSec / maximumSec);
  return Array.from({ length: count }, (_, index) => ({
    index,
    startSec: index * maximumSec,
    durationSec: Math.min(maximumSec, durationSec - index * maximumSec)
  }));
}

export function normalizeAudioGenerationRequest(request = {}, profile = null) {
  const envelope = request.parameters && typeof request.parameters === "object" && !Array.isArray(request.parameters)
    ? request.parameters
    : {};
  const merged = { ...clone(envelope), ...clone(request) };
  let category = canonicalCategory(merged.category, profile?.category || profile?._manifest?.category);
  if (category === "sound-effect") {
    const sourceMode = cleanText(merged.sourceMode).toLowerCase();
    if (sourceMode.includes("foley")) category = "foley";
    else if (sourceMode.includes("ambience") || sourceMode.includes("ambient")) category = "ambience";
  }
  const envelopeStyle = ["prompt", "originalPrompt", "name", "title", "association", "advanced", "text", "instruct"]
    .some((key) => Object.prototype.hasOwnProperty.call(envelope, key));
  const variationCount = Math.trunc(finite(merged.variationCount ?? merged.variations, 1));
  if (variationCount < 1 || variationCount > MAX_VARIATIONS) throw generationError(`variationCount must be between 1 and ${MAX_VARIATIONS}`);
  const prompt = cleanText(category === "voice-design"
    ? merged.text || merged.prompt
    : merged.prompt || merged.text, 12000);
  if (!prompt) throw generationError("An audio prompt is required");
  const durationSec = finite(merged.durationSec ?? merged.durationSeconds);
  const range = profile?.duration || profile?._manifest?.supportedDurationRange || null;
  errorForRange(durationSec, range);
  const baseSeed = finite(merged.seed, Math.floor(Math.random() * 0x7fffffff));
  const associations = clone(request.associations || request.association || envelope.association || {});
  const parameters = clone(request.boundParameters || request.advanced || envelope.advanced || (envelopeStyle ? {} : envelope));
  const associationEditorial = {
    sourceInSec: associations.inPointSec,
    sourceOutSec: associations.outPointSec,
    fadeInSec: associations.fadeInSec,
    fadeOutSec: associations.fadeOutSec,
    timelineStartSec: associations.timelineStartSec
  };
  return {
    ...merged,
    profileId: cleanText(merged.profileId, 200),
    category,
    name: cleanText(merged.name || merged.title || prompt.slice(0, 72), 180),
    prompt,
    originalPrompt: cleanText(merged.originalPrompt || prompt, 12000),
    lyrics: cleanText(merged.lyrics, 16000),
    negativePrompt: cleanText(merged.negativePrompt, 8000),
    voiceInstruction: cleanText(merged.voiceInstruction || merged.instruct || (category === "voice-design" ? merged.prompt : ""), 8000),
    key: merged.key ?? merged.tonalCenter,
    tailReverb: merged.tailReverb ?? merged.tailBehavior,
    durationSec,
    seed: Math.trunc(baseSeed),
    variationCount,
    associations,
    editorial: clone(request.editorial || envelope.editorial || associationEditorial),
    parentAssetId: merged.parentAssetId || null,
    parameters
  };
}

const MUSIC_FIELDS = Object.freeze([
  ["genre", "Genre"], ["subgenre", "Subgenre"], ["mood", "Mood"], ["emotionalArc", "Emotional arc"],
  ["instrumentation", "Instrumentation"], ["vocalDescription", "Vocal character"], ["bpm", "Tempo BPM"],
  ["meter", "Meter"], ["key", "Key"], ["introOutro", "Structure / intro-outro"]
]);
const SOUND_FIELDS = Object.freeze([
  ["soundCategory", "Sound category"], ["sourceObject", "Source object"], ["physicalAction", "Physical action"],
  ["material", "Material"], ["environment", "Environment"], ["perspective", "Perspective"],
  ["distance", "Distance"], ["intensity", "Intensity"], ["tailReverb", "Tail / reverb"]
]);

export function compileAudioDirection(request = {}, profile = null) {
  const normalized = normalizeAudioGenerationRequest(request, profile);
  const bindings = rawBindings(profile);
  const lines = [normalized.prompt];
  const foldedFields = [];
  const directFields = [];
  const candidates = normalized.category === "music" ? MUSIC_FIELDS : SOUND_FIELDS;
  for (const [field, label] of candidates) {
    const value = listText(normalized[field]);
    if (!value) continue;
    if (bindings[field]) directFields.push(field);
    else {
      lines.push(`${label}: ${value}.`);
      foldedFields.push(field);
    }
  }
  for (const [field, label] of [["loopable", "Loopable"], ["seamlessEnding", "Seamless ending"], ["oneShot", "One-shot"]]) {
    if (normalized[field] == null) continue;
    if (bindings[field]) directFields.push(field);
    else {
      lines.push(`${label}: ${normalized[field] === true ? "yes" : "no"}.`);
      foldedFields.push(field);
    }
  }
  if (normalized.lyrics && !bindings.lyrics) {
    lines.push(`Lyric / vocal content: ${normalized.lyrics}`);
    foldedFields.push("lyrics");
  }
  if (normalized.negativePrompt && !bindings.negativePrompt) {
    lines.push(`Avoid: ${normalized.negativePrompt}`);
    foldedFields.push("negativePrompt");
  }
  if (normalized.voiceInstruction && !bindings.voiceInstruction) {
    lines.push(`Voice design instruction: ${cleanText(normalized.voiceInstruction, 8000)}`);
    foldedFields.push("voiceInstruction");
  }
  return { normalized, compiledPrompt: lines.filter(Boolean).join("\n"), foldedFields, directFields };
}

function coerceBoundValue(value, binding) {
  const type = String(binding.type || "").toUpperCase();
  if (type === "INT") {
    const number = finite(value);
    if (number == null) throw generationError(`Binding ${binding.nodeId}.${binding.input} requires an integer`);
    return Math.trunc(number);
  }
  if (type === "FLOAT") {
    const number = finite(value);
    if (number == null) throw generationError(`Binding ${binding.nodeId}.${binding.input} requires a number`);
    return number;
  }
  if (type === "BOOLEAN") return value === true || value === "true" || value === 1;
  return String(value);
}

function overrideBoundInput(prompt, semantic, binding, value, overrides) {
  const node = prompt[String(binding.nodeId)];
  if (!node) throw generationError(`Manifest binding ${semantic} targets missing node ${binding.nodeId}`, 409, "AUDIO_WORKFLOW_NEEDS_REBINDING");
  const input = binding.input || binding.inputName;
  if (!input || !Object.prototype.hasOwnProperty.call(node.inputs || {}, input)) {
    throw generationError(`Manifest binding ${semantic} targets missing input ${binding.nodeId}.${input || "?"}`, 409, "AUDIO_WORKFLOW_NEEDS_REBINDING");
  }
  node.inputs[input] = coerceBoundValue(value, { ...binding, input });
  overrides.push({ semantic, nodeId: String(binding.nodeId), input, value: clone(node.inputs[input]) });
}

export function compileAudioWorkflowPrompt(profile, request = {}, options = {}) {
  const readiness = profile?.readiness || profile?._manifest?.readiness;
  if (!options.allowUnready && readiness?.ready === false) {
    throw generationError(`Audio workflow ${profile?.id || "unknown"} is ${readiness.label || readiness.status || "not ready"}`, 409, "AUDIO_WORKFLOW_NOT_READY", { readiness });
  }
  if (!options.allowUnready && readiness?.status && !["ready"].includes(String(readiness.status).toLowerCase())) {
    throw generationError(`Audio workflow ${profile?.id || "unknown"} is ${readiness.status}`, 409, "AUDIO_WORKFLOW_NOT_READY", { readiness });
  }
  const prompt = clone(options.apiPrompt || profile?._prompt);
  if (!prompt || typeof prompt !== "object") throw generationError("Audio workflow has no validated API prompt", 409, "AUDIO_WORKFLOW_NEEDS_REBINDING");
  const direction = compileAudioDirection(request, profile);
  const normalized = direction.normalized;
  const bindings = rawBindings(profile);
  const overrides = [];
  const formats = profile?.capabilities?.formats || profile?._manifest?.outputFormats || [];
  if (normalized.outputFormat && Array.isArray(formats) && formats.length
    && !formats.some((format) => String(format).toLowerCase() === String(normalized.outputFormat).toLowerCase())) {
    throw generationError(`Output format '${normalized.outputFormat}' is not supported by this workflow`, 422, "AUDIO_OUTPUT_FORMAT_UNSUPPORTED", { supportedFormats: formats });
  }
  if (normalized.referenceAudio && !bindings.referenceAudio) {
    throw generationError("This workflow does not expose a reference-audio binding", 422, "AUDIO_REFERENCE_UNSUPPORTED");
  }
  const promptTarget = semanticBinding(bindings, "prompt", "text", "originalPrompt");
  if (!promptTarget) throw generationError("Audio workflow has no prompt/text binding", 409, "AUDIO_WORKFLOW_NEEDS_REBINDING");
  overrideBoundInput(prompt, promptTarget.semantic, promptTarget.binding, direction.compiledPrompt, overrides);
  const semanticValues = {
    lyrics: normalized.lyrics,
    durationSeconds: normalized.durationSec,
    duration: normalized.durationSec,
    seed: normalized.seed,
    negativePrompt: normalized.negativePrompt,
    referenceAudio: normalized.comfyReferenceAudio || normalized.referenceAudio,
    bpm: normalized.bpm,
    meter: normalized.meter,
    key: normalized.key,
    language: normalized.language,
    voiceInstruction: normalized.voiceInstruction,
    outputFormat: normalized.outputFormat,
    outputQuality: normalized.outputQuality,
    tiledDecode: normalized.tiledDecode
  };
  for (const semantic of [
    "genre", "subgenre", "mood", "emotionalArc", "instrumentation", "vocalDescription", "introOutro",
    "soundCategory", "sourceObject", "physicalAction", "material", "environment", "perspective", "distance",
    "intensity", "tailReverb", "loopable", "seamlessEnding", "oneShot", "instrumental", "vocalMode"
  ]) semanticValues[semantic] = normalized[semantic];
  for (const [semantic, value] of Object.entries(semanticValues)) {
    if (value == null || value === "" || !bindings[semantic]) continue;
    if (semantic === "referenceAudio" && typeof value === "object") {
      throw generationError("referenceAudio must be resolved to a ComfyUI input name before compilation", 422, "AUDIO_REFERENCE_UPLOAD_REQUIRED");
    }
    overrideBoundInput(prompt, semantic, bindings[semantic], value, overrides);
  }
  for (const [semantic, value] of Object.entries(normalized.parameters || {})) {
    if (!bindings[semantic]) throw generationError(`Advanced parameter '${semantic}' has no manifest binding`, 422, "AUDIO_PARAMETER_NOT_BOUND");
    overrideBoundInput(prompt, semantic, bindings[semantic], value, overrides);
  }
  return {
    prompt,
    normalized,
    compiledPrompt: direction.compiledPrompt,
    foldedFields: direction.foldedFields,
    overrides,
    workflow: {
      profileId: profile.id,
      sourceSha256: profile.source?.sha256 || profile._manifest?.sourceWorkflowSha256 || null,
      apiSha256: profile.api?.sha256 || profile._manifest?.apiWorkflowSha256 || null,
      bindingSha256: profile.bindingSha256 || profile._manifest?.bindingsSha256 || null
    }
  };
}

function persistence(options = {}) {
  return { load: options.loadProjectFn || loadProject, save: options.saveProjectFn || saveProject };
}

function updateGeneration(projectSlug, generationId, patch, options = {}) {
  const { load, save } = persistence(options);
  const project = load(projectSlug);
  const sound = ensureProjectAudioState(project);
  const record = sound.audioGenerations.find((item) => item.id === generationId);
  if (!record) throw generationError(`Audio generation record not found: ${generationId}`, 404, "AUDIO_GENERATION_NOT_FOUND");
  if (options.preserveCompleted === true && record.status === "completed") return record;
  Object.assign(record, clone(patch), { updatedAt: now() });
  save(project);
  return record;
}

export async function prepareAudioGenerationRecords(projectSlug, request = {}, options = {}) {
  if (!projectSlug) throw generationError("Project slug is required");
  if (!request.profileId) throw generationError("profileId is required");
  const getProfile = options.getProfileFn || getAudioWorkflowProfile;
  const profile = await getProfile(request.profileId, options.workflowOptions || {});
  if (profile.role && profile.role !== "generator") throw generationError("Prompt enhancer profiles cannot be submitted as audio generators");
  if (!profile.readiness?.ready) throw generationError(`Audio workflow is ${profile.readiness?.label || "not ready"}`, 409, "AUDIO_WORKFLOW_NOT_READY", { readiness: profile.readiness });
  const normalized = normalizeAudioGenerationRequest(request, profile);
  const { load, save } = persistence(options);
  const project = load(projectSlug);
  const sound = ensureProjectAudioState(project);
  const createdAt = now();
  const records = Array.from({ length: normalized.variationCount }, (_, index) => ({
    id: `audio_gen_${crypto.randomUUID()}`,
    kind: "audio-workflow",
    profileId: profile.id,
    category: normalized.category,
    name: normalized.variationCount > 1 ? `${normalized.name} — Variation ${index + 1}` : normalized.name,
    variationIndex: index,
    variationCount: normalized.variationCount,
    status: "queued",
    progress: { value: 0, max: 1, ratio: 0, nodeId: null },
    promptId: null,
    request: { ...clone(normalized), seed: normalized.seed + index, variationCount: 1 },
    compiledPrompt: null,
    workflow: {
      profileId: profile.id,
      sourceSha256: profile.source?.sha256 || null,
      apiSha256: profile.api?.sha256 || null,
      bindingSha256: profile.bindingSha256 || null
    },
    outputs: [],
    assetIds: [],
    error: null,
    createdAt,
    updatedAt: createdAt
  }));
  sound.audioGenerations.push(...records);
  save(project);
  return {
    id: `audio_job_${crypto.randomUUID()}`,
    type: "audio-generation",
    projectSlug,
    profileId: profile.id,
    generationIds: records.map((record) => record.id),
    expectedWorkflow: clone(records[0]?.workflow),
    createdAt,
    request: clone(normalized)
  };
}

function redactTechnicalText(value) {
  return cleanText(value, 16000)
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]")
    .replace(/(api[_-]?key|token|secret)(\s*[:=]\s*)["']?[^\s,"';}]+/gi, "$1$2[redacted]")
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}

export function serializeAudioGenerationError(error) {
  return {
    code: String(error?.code || "AUDIO_GENERATION_FAILED"),
    message: error?.code === "GENERATION_CANCELLED" ? "Audio generation was cancelled" : "Audio generation failed",
    technical: redactTechnicalText(error?.stack || error?.message || String(error)),
    promptId: error?.promptId ? String(error.promptId) : null,
    at: now()
  };
}

function outputReferences(outputs, profile) {
  const manifest = profile?._manifest || profile || {};
  const bindings = manifest.outputNodeBindings || manifest.outputs || [];
  const selected = [];
  for (const binding of bindings) {
    const nodeOutput = outputs?.[String(binding.nodeId)];
    const field = binding.historyOutput || "audio";
    const values = nodeOutput?.[field];
    if (Array.isArray(values)) for (const ref of values) if (ref?.filename) selected.push(ref);
  }
  const fallback = selected.length ? selected : collectOutputFiles(outputs);
  const seen = new Set();
  return fallback.filter((ref) => {
    const extension = path.extname(String(ref.filename || "")).toLowerCase();
    const key = `${ref.type || "output"}:${ref.subfolder || ""}:${ref.filename || ""}`;
    if (!AUDIO_EXTENSIONS.has(extension) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mediaMetadata(file, probe, bytes, checksum) {
  const extension = path.extname(file).slice(1).toLowerCase();
  const codec = probe.audio?.codec_name || null;
  return {
    path: file,
    filename: path.posix.basename(file),
    format: extension,
    bytes,
    sha256: checksum,
    durationSec: Number(probe.durationSec),
    sampleRate: probe.audio?.sample_rate ? Number(probe.audio.sample_rate) : null,
    channels: probe.audio?.channels ? Number(probe.audio.channels) : null,
    codec,
    native: true,
    lossless: ["wav", "wave", "flac"].includes(extension)
  };
}

async function downloadAndRegister(projectSlug, generation, profile, outputs, options = {}) {
  const refs = outputReferences(outputs, profile);
  if (!refs.length) throw generationError("ComfyUI completed without returning an audio output", 502, "AUDIO_OUTPUT_MISSING");
  const download = options.downloadOutputFn || downloadOutput;
  const probe = options.probeMediaFn || probeMedia;
  const results = [];
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    const destinationDir = audioCategoryDirectory(projectSlug, generation.category);
    const destinationStem = `${safeStem(generation.name)}-${generation.id.slice(-12)}${refs.length > 1 ? `-${index + 1}` : ""}`;
    const downloadedName = await download(ref, destinationDir, destinationStem);
    const absolute = path.join(destinationDir, downloadedName);
    let valid = false;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size <= 0) throw generationError("Downloaded ComfyUI audio output is empty", 502, "AUDIO_OUTPUT_EMPTY");
      const details = await probe(absolute, { signal: options.signal });
      if (!details?.audio || !(Number(details.durationSec) > 0)) throw generationError("Downloaded output is not valid non-empty audio", 502, "AUDIO_OUTPUT_INVALID");
      const checksum = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      const relative = `${audioCategoryRelativeDirectory(generation.category)}/${downloadedName}`;
      const media = mediaMetadata(relative, details, stat.size, checksum);
      valid = true;
      results.push({ ref: clone(ref), media });
    } finally {
      // The original ComfyUI output remains untouched. Remove only an exact,
      // newly downloaded project copy when it fails validation.
      if (!valid) try { if (fs.existsSync(absolute)) fs.unlinkSync(absolute); } catch {}
    }
  }
  return results;
}

async function runOne(projectSlug, generationId, profile, expectedWorkflow, options = {}) {
  const { load, save } = persistence(options);
  let project = load(projectSlug);
  let generation = ensureProjectAudioState(project).audioGenerations.find((item) => item.id === generationId);
  if (!generation) throw generationError(`Audio generation record not found: ${generationId}`, 404, "AUDIO_GENERATION_NOT_FOUND");
  assertWorkflowExecutionCurrent(profile, [generation], expectedWorkflow);
  const compiled = compileAudioWorkflowPrompt(profile, generation.request);
  updateGeneration(projectSlug, generationId, { status: "running", startedAt: now(), compiledPrompt: compiled.compiledPrompt, workflow: compiled.workflow, error: null }, options);
  let lastProgressSave = 0;
  const runner = options.runPromptFn || runPrompt;
  let promptId = null;
  const runnerOptions = {
    signal: options.signal,
    onSubmitted: ({ promptId: id }) => {
      promptId = String(id);
      updateGeneration(projectSlug, generationId, { promptId, comfy: { promptId } }, options);
      options.onSubmitted?.({ generationId, promptId });
    },
    onProgress: (progress) => {
      const value = finite(progress?.value, 0);
      const max = Math.max(1, finite(progress?.max, 1));
      const payload = { value, max, ratio: Math.max(0, Math.min(1, value / max)), nodeId: progress?.nodeId || null };
      const time = Date.now();
      if (time - lastProgressSave >= (options.progressPersistIntervalMs ?? 250)) {
        lastProgressSave = time;
        updateGeneration(projectSlug, generationId, { progress: payload, promptId: promptId || progress?.promptId || null }, options);
      }
      options.onProgress?.({ generationId, promptId: promptId || progress?.promptId || null, ...payload });
    },
    onStatus: (status) => options.onStatus?.({ generationId, promptId, ...status })
  };
  const runnerResult = await runner(compiled.prompt, runnerOptions);
  const outputs = runnerResult?.outputs && typeof runnerResult.outputs === "object" ? runnerResult.outputs : runnerResult;
  if (runnerResult?.promptId && !promptId) promptId = String(runnerResult.promptId);
  const downloaded = await downloadAndRegister(projectSlug, generation, profile, outputs, options);
  project = load(projectSlug);
  const sound = ensureProjectAudioState(project);
  generation = sound.audioGenerations.find((item) => item.id === generationId);
  const assets = downloaded.map(({ ref, media }, index) => registerAudioAsset(project, {
    category: generation.category,
    name: downloaded.length > 1 ? `${generation.name} — Output ${index + 1}` : generation.name,
    parentAssetId: generation.request.parentAssetId,
    generationId,
    associations: generation.request.associations,
    editorial: generation.request.editorial,
    media,
    provenance: {
      kind: "comfyui-audio-generation",
      engine: profile.engine,
      modelFamily: profile.modelFamily,
      workflow: generation.workflow,
      prompt: { original: generation.request.originalPrompt || generation.request.prompt, compiled: generation.compiledPrompt, foldedFields: compiled.foldedFields },
      parameters: { seed: generation.request.seed, durationSec: generation.request.durationSec, overrides: compiled.overrides },
      comfy: { promptId, outputRef: ref },
      createdAt: now()
    }
  }));
  Object.assign(generation, {
    status: "completed",
    promptId,
    progress: { value: 1, max: 1, ratio: 1, nodeId: null },
    outputs: downloaded.map((item) => ({ ref: item.ref, media: item.media })),
    assetIds: assets.map((asset) => asset.id),
    completedAt: now(),
    updatedAt: now(),
    error: null
  });
  save(project);
  options.onComplete?.({ generation: clone(generation), assets: clone(assets) });
  return { generation, assets };
}

export async function runAudioGenerationJob(job, options = {}) {
  if (!job?.projectSlug || !Array.isArray(job.generationIds) || !job.generationIds.length) {
    throw generationError("Audio generation job requires projectSlug and generationIds");
  }
  const project = (options.loadProjectFn || loadProject)(job.projectSlug);
  const generationRecords = job.generationIds.map((generationId) =>
    ensureProjectAudioState(project).audioGenerations.find((item) => String(item?.id || "") === String(generationId))
  );
  const missingGenerationId = job.generationIds.find((_generationId, index) => !generationRecords[index]);
  if (missingGenerationId) {
    throw generationError(`Audio generation record not found: ${missingGenerationId}`, 404, "AUDIO_GENERATION_NOT_FOUND");
  }
  const expectedWorkflow = expectedWorkflowForJob(job, generationRecords);
  const getProfile = options.getProfileFn || getAudioWorkflowProfile;
  let profile;
  try {
    profile = await getProfile(job.profileId, options.workflowOptions || {});
  } catch (error) {
    if (expectedWorkflow && (error?.statusCode === 404 || error?.code === "AUDIO_WORKFLOW_NOT_FOUND")) {
      throw staleWorkflowError("The queued Audio Workflow Library profile no longer exists.", expectedWorkflow, null);
    }
    throw error;
  }
  assertWorkflowExecutionCurrent(profile, generationRecords, expectedWorkflow);
  if (!profile.readiness?.ready) throw generationError(`Audio workflow is ${profile.readiness?.label || "not ready"}`, 409, "AUDIO_WORKFLOW_NOT_READY");
  const leaseOwner = GPU_RESOURCE_OWNERS.COMFYUI;
  const manageLease = options.manageGpuLease !== false;
  const previousLease = manageLease ? gpuLeaseStatus() : null;
  if (manageLease && previousLease?.owner === leaseOwner && previousLease.jobId && previousLease.jobId !== job.id
    && !["resident-idle", "idle"].includes(String(previousLease.state || "").toLowerCase())) {
    throw generationError(`GPU is already running ComfyUI job ${previousLease.jobId}`, 409, "GPU_LEASE_BUSY", { lease: previousLease });
  }
  if (manageLease) acquireGpuLease(leaseOwner, { label: `ComfyUI audio: ${profile.displayName}`, jobId: job.id, state: "starting" });
  const results = [];
  try {
    if (manageLease) updateGpuLease(leaseOwner, { jobId: job.id, state: "running" });
    for (const generationId of job.generationIds) {
      if (options.signal?.aborted) throw generationError("Audio generation was cancelled", 499, "GENERATION_CANCELLED");
      try {
        results.push(await runOne(job.projectSlug, generationId, profile, expectedWorkflow, options));
      } catch (error) {
        updateGeneration(job.projectSlug, generationId, {
          status: error?.code === "GENERATION_CANCELLED" ? "cancelled" : "failed",
          failedAt: now(),
          error: serializeAudioGenerationError(error)
        }, options);
        throw error;
      }
    }
    return { jobId: job.id, projectSlug: job.projectSlug, profileId: profile.id, results };
  } finally {
    if (manageLease) {
      if (previousLease?.owner === leaseOwner) updateGpuLease(leaseOwner, previousLease);
      else releaseGpuLease(leaseOwner);
    }
  }
}

export async function generateAudio(projectSlug, request, options = {}) {
  const job = await prepareAudioGenerationRecords(projectSlug, request, options);
  return runAudioGenerationJob(job, options);
}

export function markAudioGenerationCancelled(projectSlug, generationId, options = {}) {
  return updateGeneration(projectSlug, generationId, {
    status: "cancelled",
    cancelledAt: now(),
    error: { code: "GENERATION_CANCELLED", message: "Audio generation was cancelled", technical: null, at: now() }
  }, { ...options, preserveCompleted: true });
}

export function markAudioGenerationFailed(projectSlug, generationId, error, options = {}) {
  return updateGeneration(projectSlug, generationId, {
    status: "failed",
    failedAt: now(),
    error: serializeAudioGenerationError(error)
  }, { ...options, preserveCompleted: true });
}
