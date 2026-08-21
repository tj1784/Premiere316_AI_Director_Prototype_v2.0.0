import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PACKAGE_ROOT, WORKFLOWS_DIR } from "./paths.js";
import { getObjectInfo, graphToApi } from "./comfy.js";

export const AUDIO_WORKFLOW_SCHEMA = "premiere316.audio-workflow-registry.v1";
export const AUDIO_WORKFLOW_ROOT = path.join(WORKFLOWS_DIR, "audio");
export const AUDIO_WORKFLOW_REGISTRY = path.join(AUDIO_WORKFLOW_ROOT, "registry.json");
export const AUDIO_WORKFLOW_API_ROOT = path.join(AUDIO_WORKFLOW_ROOT, "api");
export const AUDIO_WORKFLOW_IMPORT_ROOT = path.join(AUDIO_WORKFLOW_ROOT, "imports");

const DEFAULT_SOURCE_ROOTS = Object.freeze([
  WORKFLOWS_DIR,
  path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "user", "default", "workflows")
]);
const BINDING_KEYS = Object.freeze([
  "prompt", "lyrics", "duration", "seed", "negativePrompt", "referenceAudio", "output",
  "filename", "format", "quality", "bpm", "key", "meter", "instrumentation", "loopable"
]);

function httpError(message, statusCode = 400, code = "AUDIO_WORKFLOW_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

function jsonClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function bindingSha256(bindings) {
  return sha256(canonical(bindings || {}));
}

function safeName(value, fallback = "workflow") {
  return String(value || fallback).trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || fallback;
}

function pathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function realRoot(root) {
  const resolved = path.resolve(root);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

export function resolveContainedPath(value, roots, { mustExist = true, label = "path" } = {}) {
  if (!value || typeof value !== "string") throw httpError(`${label} is required`);
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(PACKAGE_ROOT, value);
  if (mustExist && !fs.existsSync(candidate)) throw httpError(`${label} does not exist: ${value}`, 422, "AUDIO_WORKFLOW_MISSING");
  const checked = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : candidate;
  const allowed = roots.map(realRoot);
  if (!allowed.some((root) => pathInside(checked, root))) {
    throw httpError(`${label} is outside the allowed workflow roots`, 400, "AUDIO_WORKFLOW_PATH_OUTSIDE_ROOT");
  }
  return checked;
}

function packageRelative(file) {
  const relative = path.relative(PACKAGE_ROOT, file);
  return path.isAbsolute(relative) ? file : relative.split(path.sep).join("/");
}

function readJsonAndHash(file) {
  const bytes = fs.readFileSync(file);
  let json;
  try { json = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw httpError(`Invalid JSON in ${file}: ${error.message}`, 422, "AUDIO_WORKFLOW_JSON_INVALID"); }
  return { json, sha256: sha256(bytes), bytes };
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function emptyRegistry() {
  return { schema: AUDIO_WORKFLOW_SCHEMA, version: 1, updatedAt: null, profiles: [] };
}

function registryFile(options = {}) {
  const configured = options.registryPath || AUDIO_WORKFLOW_REGISTRY;
  return resolveContainedPath(configured, [AUDIO_WORKFLOW_ROOT], { mustExist: false, label: "registry path" });
}

export function readAudioWorkflowRegistry(options = {}) {
  const file = registryFile(options);
  if (!fs.existsSync(file)) return { ...emptyRegistry(), registryPath: file };
  const { json } = readJsonAndHash(file);
  if (!json || typeof json !== "object" || !Array.isArray(json.profiles)) {
    throw httpError("Audio workflow registry must contain a profiles array", 422);
  }
  return { ...json, registryPath: file };
}

function writeRegistry(registry, options = {}) {
  const file = registryFile(options);
  const saved = {
    ...registry,
    schema: registry.schema || AUDIO_WORKFLOW_SCHEMA,
    version: Number(registry.version || 1),
    updatedAt: new Date().toISOString(),
    profiles: Array.isArray(registry.profiles) ? registry.profiles : []
  };
  delete saved.registryPath;
  atomicJson(file, saved);
  return saved;
}

function unwrapPrompt(json) {
  const candidate = json?.prompt && typeof json.prompt === "object" ? json.prompt : json;
  if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") return null;
  const entries = Object.entries(candidate);
  if (!entries.length || !entries.every(([, node]) => node && typeof node === "object" && typeof node.class_type === "string")) return null;
  return candidate;
}

function normalizeBinding(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const dot = value.indexOf(".");
    return dot < 0 ? { nodeId: value } : { nodeId: value.slice(0, dot), input: value.slice(dot + 1) };
  }
  if (typeof value !== "object") return null;
  return {
    ...value,
    nodeId: String(value.nodeId ?? value.node ?? value.id ?? ""),
    input: (value.input ?? value.inputName) == null ? undefined : String(value.input ?? value.inputName)
  };
}

export function normalizeAudioBindings(bindings = {}) {
  const source = bindings.inputs && typeof bindings.inputs === "object" ? { ...bindings, ...bindings.inputs } : bindings;
  const normalized = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (key === "inputs") continue;
    const binding = normalizeBinding(value);
    if (binding?.nodeId) normalized[key] = binding;
  }
  return normalized;
}

function declaredInputs(nodeInfo) {
  return {
    ...(nodeInfo?.input?.required || {}),
    ...(nodeInfo?.input?.optional || {}),
    ...(nodeInfo?.input?.hidden || {})
  };
}

function inputDefinition(info, name) {
  const all = declaredInputs(info);
  return all[name] || (name.includes(".") ? all[name.split(".")[0]] : undefined);
}

function scalarTypeValid(value, definition) {
  if (Array.isArray(value) && value.length === 2) return true;
  if (!Array.isArray(definition)) return true;
  const type = definition[0];
  if (Array.isArray(type)) return type.some((allowed) => String(allowed) === String(value));
  if (type === "INT") return Number.isInteger(Number(value));
  if (type === "FLOAT") return Number.isFinite(Number(value));
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (type === "STRING") return typeof value === "string";
  return true;
}

function validatePrompt(prompt, objectInfo, profile) {
  const errors = [];
  const nodes = [];
  const inputs = [];
  const requiredClasses = (profile.requiredCustomNodes || profile.requiredNodes || []).map((item) => typeof item === "string" ? item : item.classType || item.class_type).filter(Boolean);
  for (const classType of requiredClasses) {
    const present = Object.values(prompt).some((node) => node.class_type === classType);
    nodes.push({ classType, present, installed: Boolean(objectInfo?.[classType]) });
    if (!present) errors.push(`Required node class is not in the API workflow: ${classType}`);
    if (!objectInfo?.[classType]) errors.push(`ComfyUI node class is not installed: ${classType}`);
  }
  for (const [nodeId, node] of Object.entries(prompt)) {
    const info = objectInfo?.[node.class_type];
    if (!info) {
      errors.push(`Node ${nodeId} uses unavailable class ${node.class_type}`);
      nodes.push({ nodeId, classType: node.class_type, present: true, installed: false });
      continue;
    }
    nodes.push({ nodeId, classType: node.class_type, present: true, installed: true });
    for (const name of Object.keys(info.input?.required || {})) {
      if (!Object.prototype.hasOwnProperty.call(node.inputs || {}, name)) {
        inputs.push({ nodeId, classType: node.class_type, input: name, valid: false, reason: "required input is absent from the API workflow" });
        errors.push(`Node ${nodeId} (${node.class_type}) input ${name}: required input is absent from the API workflow`);
      }
    }
    for (const [name, value] of Object.entries(node.inputs || {})) {
      const definition = inputDefinition(info, name);
      let valid = Boolean(definition);
      let reason = valid ? null : "input is not declared by object_info";
      if (valid && Array.isArray(value) && value.length === 2) {
        valid = Boolean(prompt[String(value[0])]) && Number.isInteger(Number(value[1]));
        reason = valid ? null : "link target is missing or invalid";
      } else if (valid && !scalarTypeValid(value, definition)) {
        valid = false;
        reason = "value is incompatible with object_info";
      }
      inputs.push({ nodeId, classType: node.class_type, input: name, valid, reason });
      if (!valid) errors.push(`Node ${nodeId} (${node.class_type}) input ${name}: ${reason}`);
    }
  }
  return { errors, nodes, inputs };
}

function validateBindings(prompt, objectInfo, bindings) {
  const errors = [];
  const results = {};
  for (const [key, binding] of Object.entries(bindings)) {
    const node = prompt[binding.nodeId];
    let valid = Boolean(node);
    let reason = valid ? null : `node ${binding.nodeId} is absent`;
    if (valid && binding.input) {
      if (!Object.prototype.hasOwnProperty.call(node.inputs || {}, binding.input)) {
        valid = false;
        reason = `input ${binding.input} is absent from API node ${binding.nodeId}`;
      } else if (!inputDefinition(objectInfo?.[node.class_type], binding.input)) {
        valid = false;
        reason = `input ${binding.input} is absent from object_info for ${node.class_type}`;
      }
    }
    results[key] = { ...binding, valid, reason };
    if (!valid) errors.push(`Binding ${key}: ${reason}`);
  }
  return { errors, results };
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function enumValues(definition) {
  return Array.isArray(definition?.[0]) ? definition[0].map(String) : [];
}

function validateModels(prompt, objectInfo, profile) {
  const errors = [];
  const models = [];
  for (const requirement of profile.requiredModelFiles || profile.requiredModels || []) {
    const required = typeof requirement === "string" ? { name: requirement } : requirement || {};
    const wanted = normalizePathText(required.path || required.name);
    let matches = [];
    if (required.nodeId && required.input) {
      const node = prompt[String(required.nodeId)];
      const actual = node?.inputs?.[required.input];
      const definition = inputDefinition(objectInfo?.[node?.class_type], required.input);
      const selectable = enumValues(definition);
      const selectedMatch = normalizePathText(actual) === wanted || path.posix.basename(normalizePathText(actual)) === path.posix.basename(wanted);
      const enumMatch = selectable.length === 0 || selectable.some((value) => normalizePathText(value) === wanted || path.posix.basename(normalizePathText(value)) === path.posix.basename(wanted));
      if (node && selectedMatch && enumMatch) matches = [{ nodeId: String(required.nodeId), input: required.input, actual }];
    } else {
      for (const [nodeId, node] of Object.entries(prompt)) {
        for (const [input, actual] of Object.entries(node.inputs || {})) {
          if (Array.isArray(actual) || (typeof actual !== "string" && typeof actual !== "number")) continue;
          const actualText = normalizePathText(actual);
          if (actualText !== wanted && path.posix.basename(actualText) !== path.posix.basename(wanted)) continue;
          const definition = inputDefinition(objectInfo?.[node.class_type], input);
          const selectable = enumValues(definition);
          if (selectable.length && !selectable.some((value) => normalizePathText(value) === wanted || path.posix.basename(normalizePathText(value)) === path.posix.basename(wanted))) continue;
          matches.push({ nodeId, input, actual });
        }
      }
    }
    // Canonical registry discovery records carry filesystem presence and live
    // loader resolution. Selector-bearing requirements are additionally
    // checked against the concrete API node/object_info enum above.
    let livePathPresent = null;
    if (required.resolvedPath) {
      try {
        const stat = fs.statSync(required.resolvedPath);
        livePathPresent = stat.isDirectory() || (stat.isFile() && (required.bytes == null || Number(required.bytes) === stat.size));
      } catch { livePathPresent = false; }
    }
    const registryResolved = required.present === true && livePathPresent !== false;
    const present = required.nodeId && required.input
      ? matches.length > 0 && required.present !== false
      : required.present === false ? false : matches.length > 0 || registryResolved;
    const result = { ...required, present, livePathPresent, matches };
    models.push(result);
    if (!present) errors.push(`Required model is unavailable or not selected: ${required.path || required.name || "unnamed model"}`);
  }
  return { errors, models };
}

function expectedHash(profile, singular, plural) {
  return profile[singular] || profile.checksums?.[plural] || null;
}

function deriveCapabilities(profile, bindings) {
  const declared = profile.capabilities || {};
  const bound = (key) => Boolean(bindings[key]);
  return {
    conditioning: bound("prompt"),
    lyrics: bound("lyrics") && profile.lyricsSupport !== false,
    referenceAudio: bound("referenceAudio") && profile.referenceAudioSupport !== false,
    seed: bound("seed") && profile.seedSupport !== false,
    negativePrompt: bound("negativePrompt") && profile.negativePromptSupport !== false,
    duration: bound("duration") || bound("durationSeconds"),
    promptEnhancement: declared.promptEnhancement === true || profile.promptEnhancementSupport?.supported === true,
    promptEnhancementOptional: profile.promptEnhancementSupport?.optional === true,
    promptEnhancerProfileIds: jsonClone(profile.promptEnhancementSupport?.enhancerProfileIds || []),
    formats: Array.isArray(profile.outputFormats) ? [...profile.outputFormats] : Array.isArray(declared.formats) ? [...declared.formats] : Array.isArray(profile.outputs) ? profile.outputs.map((item) => typeof item === "string" ? item : item.format).filter(Boolean) : [],
    variationCount: profile.role !== "prompt-enhancer",
    variations: profile.role !== "prompt-enhancer",
    boundControls: Object.keys(bindings).filter((key) => key !== "output"),
    unsupportedDeclaredControls: BINDING_KEYS.filter((key) => key !== "output" && declared[key] === true && !bound(key))
  };
}

export async function evaluateAudioWorkflowProfile(profile, options = {}) {
  const sourceRoots = options.allowedSourceRoots || DEFAULT_SOURCE_ROOTS;
  const errors = [];
  const drift = [];
  let source = null;
  let api = null;
  let prompt = null;
  try {
    const sourcePath = resolveContainedPath(profile.originalWorkflowPath || profile.sourceWorkflowPath, sourceRoots, { label: "source workflow" });
    const read = readJsonAndHash(sourcePath);
    source = { path: sourcePath, relativePath: packageRelative(sourcePath), sha256: read.sha256 };
    const expected = expectedHash(profile, "sourceWorkflowSha256", "source");
    if (!expected) drift.push("Source workflow checksum is not bound");
    else if (String(expected).toLowerCase() !== read.sha256) drift.push("Source workflow changed since binding");
  } catch (error) { errors.push(error.message); }
  try {
    const apiPath = resolveContainedPath(profile.appOwnedApiWorkflowPath || profile.apiWorkflowPath, [AUDIO_WORKFLOW_API_ROOT], { label: "API workflow" });
    const read = readJsonAndHash(apiPath);
    api = { path: apiPath, relativePath: packageRelative(apiPath), sha256: read.sha256 };
    prompt = unwrapPrompt(read.json);
    if (!prompt) errors.push("API workflow is not a ComfyUI API prompt");
    const expected = expectedHash(profile, "apiWorkflowSha256", "api");
    if (!expected) drift.push("API workflow checksum is not bound");
    else if (String(expected).toLowerCase() !== read.sha256) drift.push("API workflow changed since binding");
  } catch (error) { errors.push(error.message); }
  const outputBindings = Array.isArray(profile.outputNodeBindings)
    ? Object.fromEntries(profile.outputNodeBindings.map((binding, index) => [`output${index || ""}`, binding]))
    : {};
  const bindings = normalizeAudioBindings({ ...(profile.bindings || profile.inputNodeBindings || {}), ...outputBindings });
  const currentBindingHash = bindingSha256(bindings);
  const savedBindingHash = profile.bindingsSha256 || profile.bindingSha256 || profile.checksums?.bindings;
  if (savedBindingHash && String(savedBindingHash).toLowerCase() !== currentBindingHash) drift.push("Manifest bindings changed since validation");
  const objectInfo = options.objectInfo || (options.getObjectInfoFn || getObjectInfo) ? await (async () => options.objectInfo || (options.getObjectInfoFn || getObjectInfo)(Boolean(options.forceObjectInfo)))() : {};
  let nodeValidation = { nodes: [], inputs: [], errors: [] };
  let bindingValidation = { results: {}, errors: [] };
  let modelValidation = { models: [], errors: [] };
  if (prompt) {
    nodeValidation = validatePrompt(prompt, objectInfo || {}, profile);
    bindingValidation = validateBindings(prompt, objectInfo || {}, bindings);
    modelValidation = validateModels(prompt, objectInfo || {}, profile);
    errors.push(...nodeValidation.errors, ...bindingValidation.errors, ...modelValidation.errors);
    if (bindingValidation.errors.length) drift.push("One or more manifest bindings no longer match the API workflow or object_info");
    const role = String(profile.role || "generator").toLowerCase();
    const promptKeys = role === "prompt-enhancer" ? ["originalPrompt", "prompt", "text"] : ["prompt", "text"];
    const promptBindingReady = promptKeys.some((key) => bindingValidation.results[key]?.valid === true);
    const outputBindingReady = Object.entries(bindingValidation.results)
      .some(([key, value]) => key.startsWith("output") && value?.valid === true);
    const roleBindingErrors = [];
    if (!promptBindingReady) roleBindingErrors.push(`${role === "prompt-enhancer" ? "Prompt enhancer" : "Generator"} requires a valid prompt/text input binding`);
    if (!outputBindingReady) roleBindingErrors.push(`${role === "prompt-enhancer" ? "Prompt enhancer" : "Generator"} requires a valid output binding`);
    if (roleBindingErrors.length) {
      errors.push(...roleBindingErrors);
      drift.push("Required role bindings are incomplete");
    }
  }
  for (const error of profile.readiness?.validationErrors || []) errors.push(String(error));
  const enabled = (profile.readiness?.enabled ?? profile.enabled) === true;
  const status = drift.length ? "needs-rebinding" : !enabled ? "disabled" : errors.length ? "unavailable" : "ready";
  return {
    id: String(profile.id || ""),
    displayName: String(profile.displayName || profile.name || profile.id || "Unnamed workflow"),
    category: String(profile.category || "music"),
    categories: jsonClone(profile.categories || (String(profile.category || "").toLowerCase() === "hybrid"
      ? ["music", "sound-effect", "foley", "ambience"]
      : [profile.category || "music"])),
    role: String(profile.role || "generator"),
    enabled,
    engine: profile.engine || "comfyui",
    modelFamily: profile.modelFamily || null,
    description: profile.description || "",
    duration: jsonClone(profile.supportedDurationRange || profile.duration || null),
    capabilities: deriveCapabilities(profile, bindings),
    outputs: jsonClone(profile.outputNodeBindings || profile.outputs || []),
    source: source ? { relativePath: source.relativePath, sha256: source.sha256 } : null,
    api: api ? { relativePath: api.relativePath, sha256: api.sha256 } : null,
    bindings: bindingValidation.results,
    bindingSha256: currentBindingHash,
    readiness: {
      status,
      label: status === "needs-rebinding" ? "Needs Rebinding" : status === "ready" ? "Ready" : status === "disabled" ? "Disabled" : "Unavailable",
      ready: status === "ready",
      drift,
      errors,
      nodes: nodeValidation.nodes,
      inputs: nodeValidation.inputs,
      models: modelValidation.models
    },
    _manifest: jsonClone(profile),
    _prompt: prompt ? jsonClone(prompt) : null
  };
}

export async function listAudioWorkflowProfiles(options = {}) {
  const registry = readAudioWorkflowRegistry(options);
  const entries = options.includePromptEnhancers === true
    ? [...registry.profiles, ...(Array.isArray(registry.promptEnhancers) ? registry.promptEnhancers : [])]
    : registry.profiles;
  if (!entries.length) return [];
  // object_info is one runtime snapshot shared by the whole registry
  // evaluation. Without this, a cold catalog launches one large ComfyUI
  // request per profile before the lower-level cache has resolved.
  const objectInfo = options.objectInfo || await (options.getObjectInfoFn || getObjectInfo)(Boolean(options.forceObjectInfo));
  return Promise.all(entries.map((profile) => evaluateAudioWorkflowProfile(profile, { ...options, objectInfo })));
}

export async function getAudioWorkflowCatalog(options = {}) {
  const registry = readAudioWorkflowRegistry(options);
  const evaluated = await listAudioWorkflowProfiles({ ...options, includePromptEnhancers: true });
  return {
    schemaVersion: registry.schemaVersion || registry.version || 1,
    registryId: registry.registryId || registry.schema || AUDIO_WORKFLOW_SCHEMA,
    validatedAt: registry.validatedAt || null,
    profiles: evaluated.filter((profile) => profile.role !== "prompt-enhancer").map(publicAudioWorkflowProfile),
    promptEnhancers: evaluated.filter((profile) => profile.role === "prompt-enhancer").map(publicAudioWorkflowProfile),
    excludedDiscoveries: jsonClone(registry.excludedDiscoveries || [])
  };
}

export async function getAudioWorkflowProfile(profileId, options = {}) {
  const profiles = await listAudioWorkflowProfiles({ ...options, includePromptEnhancers: true });
  const profile = profiles.find((item) => item.id === String(profileId));
  if (!profile) throw httpError(`Unknown audio workflow profile: ${profileId}`, 404, "AUDIO_WORKFLOW_NOT_FOUND");
  return profile;
}

export function publicAudioWorkflowProfile(evaluated) {
  if (!evaluated) return null;
  const { _manifest, _prompt, ...publicValue } = evaluated;
  return jsonClone(publicValue);
}

function walkJson(root, output) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkJson(candidate, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) output.push(candidate);
  }
}

export function scanAudioWorkflowCandidates(options = {}) {
  const roots = options.roots || DEFAULT_SOURCE_ROOTS;
  const files = [];
  for (const root of roots) walkJson(resolveContainedPath(root, roots, { mustExist: false, label: "scan root" }), files);
  return files.map((file) => {
    try {
      const { json, sha256: checksum } = readJsonAndHash(file);
      const prompt = unwrapPrompt(json);
      const uiNodes = Array.isArray(json?.nodes) ? json.nodes : [];
      const classes = prompt ? Object.values(prompt).map((node) => node.class_type) : uiNodes.map((node) => node.type).filter(Boolean);
      const text = `${path.basename(file)} ${classes.join(" ")}`.toLowerCase();
      const relevant = /(audio|music|tts|voice|sound|foley|ace|stable|minimax|qwen|fish)/.test(text);
      return {
        path: packageRelative(file), sha256: checksum,
        schemaType: prompt ? "api" : uiNodes.length ? "ui" : "unknown",
        nodeClasses: [...new Set(classes)].sort(), relevant, error: null
      };
    } catch (error) {
      return { path: packageRelative(file), sha256: null, schemaType: "invalid", nodeClasses: [], relevant: false, error: error.message };
    }
  }).filter((item) => options.includeAll === true || item.relevant);
}

function mutateProfile(profileId, mutator, options = {}) {
  const registry = readAudioWorkflowRegistry(options);
  const collections = ["profiles", "promptEnhancers"];
  let collection = null;
  let index = -1;
  for (const key of collections) {
    const values = Array.isArray(registry[key]) ? registry[key] : [];
    const found = values.findIndex((profile) => String(profile.id) === String(profileId));
    if (found >= 0) { collection = key; index = found; break; }
  }
  if (!collection) throw httpError(`Unknown audio workflow profile: ${profileId}`, 404, "AUDIO_WORKFLOW_NOT_FOUND");
  const next = mutator(jsonClone(registry[collection][index]));
  registry[collection][index] = next;
  writeRegistry(registry, options);
  return next;
}

export function setAudioWorkflowEnabled(profileId, enabled, options = {}) {
  return mutateProfile(profileId, (profile) => ({
    ...profile,
    ...(profile.readiness ? { readiness: { ...profile.readiness, enabled: enabled === true, status: enabled === true ? "needs-validation" : "disabled" } } : { enabled: enabled === true })
  }), options);
}

export function renameAudioWorkflowProfile(profileId, displayName, options = {}) {
  const name = String(displayName || "").trim();
  if (!name) throw httpError("Workflow display name is required");
  return mutateProfile(profileId, (profile) => ({ ...profile, displayName: name.slice(0, 120) }), options);
}

function apiJsonFromSource(sourceJson, objectInfo, converter) {
  const existing = unwrapPrompt(sourceJson);
  if (existing) return existing;
  if (!Array.isArray(sourceJson?.nodes)) throw httpError("Selected workflow is neither UI graph nor API prompt", 422);
  const converted = converter(sourceJson, objectInfo);
  const prompt = unwrapPrompt(converted);
  if (!prompt) throw httpError("Workflow conversion did not produce an API prompt", 422);
  return prompt;
}

export async function importAudioWorkflow(request, options = {}) {
  const sourceRoots = options.allowedSourceRoots || DEFAULT_SOURCE_ROOTS;
  const externalSource = resolveContainedPath(request?.sourcePath, sourceRoots, { label: "source workflow" });
  const sourceRead = readJsonAndHash(externalSource);
  const id = safeName(request?.id || path.basename(externalSource, path.extname(externalSource)));
  const ownedSource = path.join(AUDIO_WORKFLOW_IMPORT_ROOT, `${id}.source.json`);
  const ownedApi = path.join(AUDIO_WORKFLOW_API_ROOT, `${id}.api.json`);
  resolveContainedPath(ownedSource, [AUDIO_WORKFLOW_IMPORT_ROOT], { mustExist: false, label: "import destination" });
  resolveContainedPath(ownedApi, [AUDIO_WORKFLOW_API_ROOT], { mustExist: false, label: "API destination" });
  const objectInfo = options.objectInfo || await (options.getObjectInfoFn || getObjectInfo)(true);
  const apiPrompt = apiJsonFromSource(sourceRead.json, objectInfo, options.graphToApiFn || graphToApi);
  // Read after the only await so concurrent project-scoped manager requests
  // cannot overwrite a registry mutation completed while object_info loaded.
  const registry = readAudioWorkflowRegistry(options);
  const allProfiles = [...registry.profiles, ...(Array.isArray(registry.promptEnhancers) ? registry.promptEnhancers : [])];
  if (allProfiles.some((profile) => String(profile.id) === id)) throw httpError(`Workflow profile already exists: ${id}`, 409, "AUDIO_WORKFLOW_EXISTS");
  const inputNodeBindings = jsonClone(request?.inputNodeBindings || request?.bindings || {});
  const outputNodeBindings = jsonClone(request?.outputNodeBindings || []);
  if (!inputNodeBindings || Array.isArray(inputNodeBindings) || typeof inputNodeBindings !== "object") {
    throw httpError("inputNodeBindings must be an object", 400, "AUDIO_WORKFLOW_BINDINGS_INVALID");
  }
  if (!Array.isArray(outputNodeBindings)) {
    throw httpError("outputNodeBindings must be an array", 400, "AUDIO_WORKFLOW_BINDINGS_INVALID");
  }
  if (fs.existsSync(ownedSource) || fs.existsSync(ownedApi)) {
    throw httpError(`App-owned workflow files already exist for profile ID: ${id}`, 409, "AUDIO_WORKFLOW_FILE_EXISTS");
  }
  fs.mkdirSync(path.dirname(ownedSource), { recursive: true });
  fs.copyFileSync(externalSource, ownedSource, fs.constants.COPYFILE_EXCL);
  atomicJson(ownedApi, apiPrompt);
  const profile = {
    id,
    displayName: String(request?.displayName || request?.name || path.basename(externalSource, path.extname(externalSource))).trim(),
    category: String(request?.category || "music"),
    engine: "comfyui",
    modelFamily: request?.modelFamily || null,
    originalWorkflowPath: packageRelative(ownedSource),
    originalWorkflowSchema: unwrapPrompt(sourceRead.json) ? "comfyui-prompt-api" : "comfyui-ui",
    sourceWorkflowSha256: sha256(fs.readFileSync(ownedSource)),
    importedFrom: packageRelative(externalSource),
    appOwnedApiWorkflowPath: packageRelative(ownedApi),
    apiWorkflowSchema: "comfyui-prompt-api",
    apiWorkflowSha256: sha256(fs.readFileSync(ownedApi)),
    requiredCustomNodes: jsonClone(request?.requiredCustomNodes || request?.requiredNodes || []),
    requiredModelFiles: jsonClone(request?.requiredModelFiles || request?.requiredModels || []),
    inputNodeBindings,
    outputNodeBindings,
    bindingsSha256: bindingSha256(normalizeAudioBindings({ ...inputNodeBindings, ...Object.fromEntries(outputNodeBindings.map((value, index) => [`output${index || ""}`, value])) })),
    supportedDurationRange: jsonClone(request?.supportedDurationRange || request?.duration || null),
    outputFormats: jsonClone(request?.outputFormats || request?.capabilities?.formats || []),
    readiness: { status: request?.enabled === true ? "needs-validation" : "disabled", enabled: request?.enabled === true, validationErrors: [] }
  };
  registry.profiles.push(profile);
  writeRegistry(registry, options);
  return evaluateAudioWorkflowProfile(profile, { ...options, objectInfo });
}

export async function rebindAudioWorkflowProfile(profileId, request = {}, options = {}) {
  const objectInfo = options.objectInfo || await (options.getObjectInfoFn || getObjectInfo)(true);
  const registry = readAudioWorkflowRegistry(options);
  let collection = "profiles";
  let index = registry.profiles.findIndex((profile) => String(profile.id) === String(profileId));
  if (index < 0 && Array.isArray(registry.promptEnhancers)) {
    collection = "promptEnhancers";
    index = registry.promptEnhancers.findIndex((profile) => String(profile.id) === String(profileId));
  }
  if (index < 0) throw httpError(`Unknown audio workflow profile: ${profileId}`, 404, "AUDIO_WORKFLOW_NOT_FOUND");
  const current = jsonClone(registry[collection][index]);
  const sourcePath = resolveContainedPath(current.originalWorkflowPath || current.sourceWorkflowPath, options.allowedSourceRoots || DEFAULT_SOURCE_ROOTS, { label: "source workflow" });
  const sourceRead = readJsonAndHash(sourcePath);
  const bindings = request.inputNodeBindings || request.bindings || current.inputNodeBindings || current.bindings || {};
  const outputBindings = request.outputNodeBindings || current.outputNodeBindings || [];
  if (!bindings || Array.isArray(bindings) || typeof bindings !== "object") {
    throw httpError("inputNodeBindings must be an object", 400, "AUDIO_WORKFLOW_BINDINGS_INVALID");
  }
  if (!Array.isArray(outputBindings)) {
    throw httpError("outputNodeBindings must be an array", 400, "AUDIO_WORKFLOW_BINDINGS_INVALID");
  }
  const configuredApiPath = current.appOwnedApiWorkflowPath || current.apiWorkflowPath;
  const configuredApiFile = configuredApiPath
    ? resolveContainedPath(configuredApiPath, [AUDIO_WORKFLOW_API_ROOT], { mustExist: false, label: "API workflow" })
    : path.join(AUDIO_WORKFLOW_API_ROOT, `${safeName(current.id)}.api.json`);
  const configuredKey = path.resolve(configuredApiFile).toLowerCase();
  const sharedApiCopy = [...registry.profiles, ...(Array.isArray(registry.promptEnhancers) ? registry.promptEnhancers : [])]
    .some((profile) => String(profile.id) !== String(current.id)
      && path.resolve(PACKAGE_ROOT, profile.appOwnedApiWorkflowPath || profile.apiWorkflowPath || "").toLowerCase() === configuredKey);
  let apiDestination = configuredApiFile;
  if (sharedApiCopy) {
    apiDestination = path.join(AUDIO_WORKFLOW_API_ROOT, `${safeName(current.id)}.api.json`);
    if (path.resolve(apiDestination).toLowerCase() === configuredKey) {
      apiDestination = path.join(AUDIO_WORKFLOW_API_ROOT, `${safeName(current.id)}.rebound.api.json`);
    }
  }
  resolveContainedPath(apiDestination, [AUDIO_WORKFLOW_API_ROOT], { mustExist: false, label: "API workflow destination" });
  let apiPrompt;
  if (request.apiWorkflow) apiPrompt = apiJsonFromSource(request.apiWorkflow, objectInfo, options.graphToApiFn || graphToApi);
  else if (request.apiWorkflowPath) {
    const selected = resolveContainedPath(request.apiWorkflowPath, options.allowedSourceRoots || DEFAULT_SOURCE_ROOTS, { label: "selected API workflow" });
    apiPrompt = apiJsonFromSource(readJsonAndHash(selected).json, objectInfo, options.graphToApiFn || graphToApi);
  } else if (fs.existsSync(configuredApiFile)) apiPrompt = apiJsonFromSource(readJsonAndHash(configuredApiFile).json, objectInfo, options.graphToApiFn || graphToApi);
  else apiPrompt = apiJsonFromSource(sourceRead.json, objectInfo, options.graphToApiFn || graphToApi);
  atomicJson(apiDestination, apiPrompt);
  const next = {
    ...current,
    sourceWorkflowSha256: sourceRead.sha256,
    ...(current.appOwnedApiWorkflowPath ? { appOwnedApiWorkflowPath: packageRelative(apiDestination) } : { apiWorkflowPath: packageRelative(apiDestination) }),
    apiWorkflowSha256: sha256(fs.readFileSync(apiDestination)),
    ...(current.inputNodeBindings ? { inputNodeBindings: jsonClone(bindings) } : { bindings: jsonClone(bindings) }),
    ...(current.outputNodeBindings || request.outputNodeBindings ? { outputNodeBindings: jsonClone(outputBindings) } : {}),
    bindingsSha256: bindingSha256(normalizeAudioBindings({ ...bindings, ...Object.fromEntries(outputBindings.map((value, outputIndex) => [`output${outputIndex || ""}`, value])) })),
    ...(current.readiness ? {
      readiness: {
        ...current.readiness,
        status: "disabled",
        enabled: false,
        validationErrors: []
      }
    } : { enabled: false }),
    reboundAt: new Date().toISOString()
  };
  registry[collection][index] = next;
  writeRegistry(registry, options);
  return evaluateAudioWorkflowProfile(next, { ...options, objectInfo });
}
