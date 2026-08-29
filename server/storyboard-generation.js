import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  collectOutputFiles,
  downloadOutput,
  getObjectInfo,
  graphToApi,
  runPrompt,
  uploadImage
} from "./comfy.js";
import { loadProject, mediaDir } from "./projects.js";
import { trimVideoToFrames } from "./ffmpeg.js";
import { PACKAGE_ROOT, PROJECTS_DIR, projectDir } from "./paths.js";
import { resolveStillsReferences } from "./asset-reference-resolver.js";
import { resolveProjectMediaFile } from "./media-path.js";
import {
  loadStoryboard,
  saveStoryboard
} from "./storyboard.js";

export const STORYBOARD_KREA_WORKFLOW_ID = "premiere316-storyboard-krea2-reference-subgraphs";
export const STORYBOARD_T2V_WORKFLOW_ID = "premiere316-storyboard-ltx25-t2v-semantic-reference";
export const KREA2_CINEMATIC_STILL_WORKFLOW_ID = "krea2-cinematic-still-fp8";
export const KLEIN2_STILLS_WORKFLOW_ID = "flux2-klein-9b-prop-fp8";
const MINIMAX_NAME_RE = /MiniMax/i;
const MINIMAX_AUDIO_NAME_RE = /Music|Audio/i;
const MINIMAX_VISUAL_NAME_RE = /Image|Video|Visual|I2V|FL2VA|Ref2VA|ToImage/i;

const SOURCE_WORKFLOW_NAME = "storyboard-krea2-reference-subgraphs.ui.json";
const SOURCE_WORKFLOW_PATH = path.join(
  PACKAGE_ROOT,
  "workflows",
  SOURCE_WORKFLOW_NAME
);
const T2V_SOURCE_WORKFLOW_NAME = "storyboard-ltx25-t2v-semantic-reference.ui.json";
const T2V_SOURCE_WORKFLOW_PATH = path.join(PACKAGE_ROOT, "workflows", T2V_SOURCE_WORKFLOW_NAME);
const PUSH_WORKFLOW_DIR = path.join(
  PACKAGE_ROOT,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "Storyboard"
);
const COMFY_STORYBOARD_REFERENCE_SUBFOLDER = "premiere316_storyboard_refs";
const REFERENCE_NODE_START_ID = 10000;
const REFERENCE_CONCAT_NODE_ID = 10020;
const REFERENCE_LINK_START_ID = 91000;
const MAX_STORYBOARD_REFERENCES = 20;
const MAX_STORYBOARD_T2V_REFERENCES = 9;
const T2V_GENERATION_MODE = "t2v_with_semantic_references";
const T2V_WORKFLOW_PROFILE = "ltx-2.5-t2v-semantic-reference-resolver";
const T2V_NATIVE_MODE = "LTX-2.5 Native T2V";
// Premiere316LTXMasterControls currently exposes this legacy label as the
// boolean that selects the Ingredients output branch. The compiled prompt
// below replaces every legacy model/CLIP/VAE dependency in that branch with
// the verified LTX-2.5 loaders before it can be submitted.
const T2V_INGREDIENTS_SWITCH_MODE = "LTX-2.3 Ingredients";
const T2V_REFERENCE_CONDITIONING = "ltx-2.5-ingredients-iclora";
const T2V_INGREDIENTS_LORA = "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";
const T2V_CUSTOM_ASPECT = "Custom (multiples of 32)";
const T2V_NO_ADAPTER = "None - no validated LTX-2.5 reference adapter installed";
const VIDEO_FILE_RE = /\.(mp4|webm|mov|mkv)$/i;

const VIRTUAL_NODE_TYPES = new Set([
  "Note",
  "MarkdownNote",
  "Reroute",
  "PrimitiveNode",
  "Label (rgthree)",
  "Bookmark (rgthree)",
  "Fast Groups Bypasser (rgthree)",
  "Fast Bypasser (rgthree)",
  "Fast Muter (rgthree)",
  "Node Collector (rgthree)",
  "Mute / Bypass Repeater (rgthree)",
  "PixaromaNote",
  "PixaromaLabel",
  "GetNode",
  "SetNode"
]);

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function safePart(value, fallback = "storyboard", max = 96) {
  return String(value || fallback)
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || fallback;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function isClearlyMinimaxAudioOnlyClass(classType) {
  const name = String(classType || "");
  if (!MINIMAX_NAME_RE.test(name) || !MINIMAX_AUDIO_NAME_RE.test(name)) return false;
  return !MINIMAX_VISUAL_NAME_RE.test(name);
}

export function isForbiddenMinimaxStillsClass(classType) {
  const name = String(classType || "");
  return MINIMAX_NAME_RE.test(name) && !isClearlyMinimaxAudioOnlyClass(name);
}

function stillsNodeClassType(node) {
  if (!node || typeof node !== "object") return "";
  return String(node.class_type || node.type || node.classType || "");
}

function stillsGraphContainers(source) {
  const containers = [];
  const queue = [source];
  const seen = new Set();
  while (queue.length) {
    const container = queue.shift();
    if (!container || typeof container !== "object" || seen.has(container)) continue;
    seen.add(container);
    containers.push(container);
    for (const subgraph of container.definitions?.subgraphs || []) queue.push(subgraph);
  }
  return containers;
}

function stillsClassEntries(source) {
  if (!source || typeof source !== "object") return [];
  if (Array.isArray(source)) {
    return source.map((node, index) => ({
      id: node?.id ?? index,
      classType: stillsNodeClassType(node)
    }));
  }
  if (Array.isArray(source.nodes) || Array.isArray(source.definitions?.subgraphs)) {
    return stillsGraphContainers(source).flatMap((container) =>
      (container.nodes || []).map((node) => ({
        id: node?.id,
        classType: stillsNodeClassType(node)
      }))
    );
  }
  return Object.entries(source).map(([id, node]) => ({
    id,
    classType: stillsNodeClassType(node)
  }));
}

export function assertStillsApiPromptRejectsMinimax(apiPrompt) {
  const offenders = stillsClassEntries(apiPrompt)
    .filter((entry) => isForbiddenMinimaxStillsClass(entry.classType))
    .map((entry) => `${entry.id}:${entry.classType}`);
  if (offenders.length) {
    throw new Error(
      `Storyboard stills API prompt cannot include MiniMax image class_type: ${offenders.join(", ")}`
    );
  }
  return apiPrompt;
}

export function assertStillsJobCompiledPrompt(compiled) {
  if (!compiled || typeof compiled !== "object") return compiled;
  if (compiled.apiPrompt) assertStillsApiPromptRejectsMinimax(compiled.apiPrompt);
  if (compiled.graph) assertStillsApiPromptRejectsMinimax(compiled.graph);
  if (compiled.executionGraph) assertStillsApiPromptRejectsMinimax(compiled.executionGraph);
  return compiled;
}

function assertKreaStillsCompilation(graph, executionGraph, frame) {
  const meta = graph?.extra?.premiere316 || {};
  const frameId = frame?.id || meta.frameId || "unknown";
  if (meta.workflowId !== STORYBOARD_KREA_WORKFLOW_ID) {
    throw new Error(
      `Storyboard first/last/guide frame ${frameId} must compile through ${STORYBOARD_KREA_WORKFLOW_ID}, received ${meta.workflowId || "missing"}`
    );
  }
  if (meta.type !== "storyboard-image-guide") {
    throw new Error(`Storyboard frame ${frameId} is not a stills image-guide compilation`);
  }
  if (meta.sourceWorkflow !== SOURCE_WORKFLOW_NAME) {
    throw new Error(`Storyboard stills must use ${SOURCE_WORKFLOW_NAME}, not MiniMax H3 templates`);
  }
  assertStillsApiPromptRejectsMinimax(graph);
  assertStillsApiPromptRejectsMinimax(executionGraph);
}

export function assertLtxVideoPlanIsNotStillsGenerator(graph) {
  const meta = graph?.extra?.premiere316 || {};
  if (meta.type === "storyboard-image-guide" || meta.workflowId === STORYBOARD_KREA_WORKFLOW_ID) {
    throw new Error("Storyboard LTX-2.5 T2V cannot be used as a stills or first-frame generator");
  }
  if (meta.temporalGuides?.firstFrame || meta.temporalGuides?.lastFrame || meta.temporalGuides?.timedImages) {
    throw new Error("Storyboard LTX-2.5 T2V cannot generate first-frame or last-frame stills");
  }
  return graph;
}

function sourceWorkflowHash() {
  const buffer = fs.readFileSync(SOURCE_WORKFLOW_PATH);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function loadSourceWorkflowGraph() {
  if (!fs.existsSync(SOURCE_WORKFLOW_PATH)) {
    throw new Error(`Storyboard Krea workflow is missing: ${SOURCE_WORKFLOW_PATH}`);
  }
  const graph = JSON.parse(fs.readFileSync(SOURCE_WORKFLOW_PATH, "utf8"));
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error(`Storyboard Krea workflow is not a ComfyUI UI graph: ${SOURCE_WORKFLOW_PATH}`);
  }
  if (!Array.isArray(graph.definitions?.subgraphs) || !graph.definitions.subgraphs.length) {
    throw new Error(`Storyboard Krea workflow is missing its reference/model subgraphs: ${SOURCE_WORKFLOW_PATH}`);
  }
  // Official first/last/guide stills are Krea2; MiniMax H3 templates must never load here.
  assertStillsApiPromptRejectsMinimax(graph);
  return graph;
}

function t2vSourceWorkflowHash() {
  const buffer = fs.readFileSync(T2V_SOURCE_WORKFLOW_PATH);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function loadT2vSourceWorkflowGraph() {
  if (!fs.existsSync(T2V_SOURCE_WORKFLOW_PATH)) {
    throw new Error(`Storyboard LTX-2.5 T2V workflow is missing: ${T2V_SOURCE_WORKFLOW_PATH}`);
  }
  const graph = JSON.parse(fs.readFileSync(T2V_SOURCE_WORKFLOW_PATH, "utf8"));
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error(`Storyboard LTX-2.5 T2V workflow is not a ComfyUI UI graph: ${T2V_SOURCE_WORKFLOW_PATH}`);
  }
  return graph;
}

function findVideoPlan(storyboard, videoPlanId) {
  const videoPlan = storyboard?.videoPlans?.[videoPlanId];
  if (!videoPlan) throw new Error(`Storyboard video plan not found: ${videoPlanId}`);
  const clip = storyboard?.clips?.[videoPlan.clipId];
  if (!clip) throw new Error(`Storyboard video plan ${videoPlanId} has no owning clip: ${videoPlan.clipId || "missing"}`);
  if (clip.videoPlanId && clip.videoPlanId !== videoPlanId) {
    throw new Error(`Storyboard clip ${clip.id} points to a different video plan: ${clip.videoPlanId}`);
  }
  return { videoPlan, clip };
}

function assertNoTemporalImageFields(value, label) {
  if (!value || typeof value !== "object") return;
  for (const key of [
    "frameId",
    "firstFrameId",
    "lastFrameId",
    "firstFrame",
    "lastFrame",
    "image",
    "imagePath",
    "inputImage",
    "endImage",
    "timedImage",
    "timedImages"
  ]) {
    const candidate = value[key];
    if (candidate !== undefined && candidate !== null && candidate !== "" && candidate !== false) {
      throw new Error(`${label} contains forbidden temporal image field ${key}; true T2V plans must start from text`);
    }
  }
}

function assertTextOnlyT2vPlan(storyboard, videoPlan, clip) {
  const mode = videoPlan.generationMode || clip.generationMode || storyboard.defaults?.generationMode;
  if (mode !== T2V_GENERATION_MODE) {
    throw new Error(`Storyboard video plan ${videoPlan.id} is not true T2V: expected ${T2V_GENERATION_MODE}, received ${mode || "missing"}`);
  }
  if (videoPlan.workflowProfileId !== T2V_WORKFLOW_PROFILE) {
    throw new Error(`Storyboard video plan ${videoPlan.id} uses unsupported workflow profile ${videoPlan.workflowProfileId || "missing"}; expected ${T2V_WORKFLOW_PROFILE}`);
  }
  // Mixed storyboards are valid: another clip may use approved I2V guide
  // frames while this selected plan remains true text-to-video. The checks
  // below reject temporal image fields only on this clip and its segments.
  assertNoTemporalImageFields(clip, `Storyboard clip ${clip.id}`);
  assertNoTemporalImageFields(videoPlan, `Storyboard video plan ${videoPlan.id}`);

  const segmentIds = Array.isArray(videoPlan.segmentIds) ? videoPlan.segmentIds : [];
  for (const segmentId of segmentIds) {
    const segment = storyboard.segments?.[segmentId];
    if (!segment) throw new Error(`Storyboard video plan ${videoPlan.id} references missing text segment ${segmentId}`);
    if (segment.type && segment.type !== "text") {
      throw new Error(`Storyboard segment ${segmentId} has type ${segment.type}; true T2V accepts text segments only`);
    }
    assertNoTemporalImageFields(segment, `Storyboard segment ${segmentId}`);
  }
  for (const segment of videoPlan.timelineData?.segments || []) {
    if (segment?.type && segment.type !== "text") {
      throw new Error(`Storyboard video plan ${videoPlan.id} timeline contains non-text segment type ${segment.type}`);
    }
    assertNoTemporalImageFields(segment, `Storyboard video plan ${videoPlan.id} timeline segment ${segment?.id || "unknown"}`);
  }
}

function normalizeReferenceFile(value) {
  const source = String(value || "").trim().replace(/\\/g, "/");
  if (!source) throw new Error("Storyboard semantic reference filename is empty");
  if (source.includes("\0") || source.startsWith("/") || /^[a-zA-Z]:\//.test(source)) {
    throw new Error(`Storyboard semantic reference must be relative to its declared reference root: ${source}`);
  }
  const normalized = path.posix.normalize(source).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Storyboard semantic reference escapes its declared reference root: ${source}`);
  }
  return normalized;
}

function resolveProjectReferenceRoot(project, storyboard, videoPlan) {
  const declared = String(videoPlan.referenceRoot || storyboard.defaults?.referenceRoot || "reference_assets").trim();
  if (!declared || path.isAbsolute(declared) || /^[a-zA-Z]:[\\/]/.test(declared)) {
    throw new Error(`Storyboard video plan ${videoPlan.id} referenceRoot must be a project-relative folder`);
  }
  const projectRoot = path.resolve(projectDir(project.slug));
  const referenceRoot = path.resolve(projectRoot, declared);
  if (referenceRoot !== projectRoot && !referenceRoot.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Storyboard video plan ${videoPlan.id} referenceRoot escapes the project folder`);
  }
  if (!fs.existsSync(referenceRoot) || !fs.statSync(referenceRoot).isDirectory()) {
    throw new Error(`Storyboard semantic reference root is missing: ${referenceRoot}`);
  }
  return { declared: declared.replace(/\\/g, "/"), absolute: referenceRoot };
}

function loadCanonicalReferenceIndex(referenceRoot, videoPlanId) {
  const indexPath = path.join(referenceRoot, "asset_index.json");
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    throw new Error(`Storyboard video plan ${videoPlanId} requires canonical reference index: ${indexPath}`);
  }
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    throw new Error(`Storyboard canonical reference index is invalid JSON: ${indexPath} (${error.message})`);
  }
  if (!Array.isArray(index.assets)) throw new Error(`Storyboard canonical reference index has no assets array: ${indexPath}`);
  const byCanonical = new Map();
  for (const asset of index.assets) {
    const canonical = normalizeReferenceFile(asset?.canonical);
    if (byCanonical.has(canonical)) throw new Error(`Storyboard canonical reference index repeats ${canonical}`);
    byCanonical.set(canonical, asset);
  }
  return {
    index,
    indexPath,
    indexHash: crypto.createHash("sha256").update(fs.readFileSync(indexPath)).digest("hex"),
    byCanonical
  };
}

function t2vPlanBindings(storyboard, videoPlanId) {
  return Object.values(storyboard.referenceBindings || {})
    .filter((binding) => binding?.targetKind === "video_plan" && binding.targetId === videoPlanId)
    .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.id).localeCompare(String(right.id)));
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = [...left].sort();
  const actual = [...right].sort();
  return expected.every((value, index) => value === actual[index]);
}

function resolveT2vReferences(project, storyboard, videoPlan, clip) {
  const root = resolveProjectReferenceRoot(project, storyboard, videoPlan);
  const canonicalIndex = loadCanonicalReferenceIndex(root.absolute, videoPlan.id);
  const bindings = t2vPlanBindings(storyboard, videoPlan.id);
  const planFiles = (videoPlan.referenceFiles || clip.referenceFiles || []).map(normalizeReferenceFile);
  const bindingFiles = bindings.map((binding) => normalizeReferenceFile(binding.canonicalFile || binding.sourceAssetFile));
  if (planFiles.length && bindingFiles.length && !sameStringSet(planFiles, bindingFiles)) {
    throw new Error(`Storyboard video plan ${videoPlan.id} referenceFiles do not match its video_plan reference bindings`);
  }
  const files = planFiles.length ? planFiles : bindingFiles;
  const declaredReferenceCountValue = videoPlan.referenceCount ?? clip.referenceCount;
  if (declaredReferenceCountValue !== undefined && declaredReferenceCountValue !== null) {
    const declaredReferenceCount = Number(declaredReferenceCountValue);
    if (!Number.isInteger(declaredReferenceCount) || declaredReferenceCount < 0) {
      throw new Error(`Storyboard video plan ${videoPlan.id} has invalid referenceCount ${declaredReferenceCountValue}`);
    }
    if (declaredReferenceCount !== files.length) {
      throw new Error(
        `Storyboard video plan ${videoPlan.id} declares ${declaredReferenceCount} semantic references but resolves ${files.length} reference filenames`
      );
    }
  }
  const maxReferences = Math.min(
    MAX_STORYBOARD_T2V_REFERENCES,
    Math.max(0, Number(storyboard.defaults?.maxReferences) || MAX_STORYBOARD_T2V_REFERENCES),
    Math.max(0, Number(canonicalIndex.index.maxReferences) || MAX_STORYBOARD_T2V_REFERENCES)
  );
  if (files.length > maxReferences) {
    throw new Error(`Storyboard video plan ${videoPlan.id} has ${files.length} semantic references; the canonical resolver supports ${maxReferences}`);
  }
  if (new Set(files).size !== files.length) throw new Error(`Storyboard video plan ${videoPlan.id} repeats a semantic reference filename`);

  const bindingByFile = new Map(bindings.map((binding) => [normalizeReferenceFile(binding.canonicalFile || binding.sourceAssetFile), binding]));
  const references = files.map((canonical, index) => {
    const asset = canonicalIndex.byCanonical.get(canonical);
    if (!asset) throw new Error(`Storyboard video plan ${videoPlan.id} requests unindexed canonical reference: ${canonical}`);
    const absolute = path.resolve(root.absolute, ...canonical.split("/"));
    if (absolute !== root.absolute && !absolute.startsWith(`${root.absolute}${path.sep}`)) {
      throw new Error(`Storyboard semantic reference escapes its declared root: ${canonical}`);
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`Storyboard canonical reference file is missing: ${canonical}`);
    }
    const buffer = fs.readFileSync(absolute);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    if (asset.sha256 && String(asset.sha256).toLowerCase() !== sha256) {
      throw new Error(`Storyboard canonical reference hash mismatch: ${canonical}`);
    }
    if (Number.isFinite(Number(asset.bytes)) && Number(asset.bytes) !== buffer.byteLength) {
      throw new Error(`Storyboard canonical reference byte count mismatch: ${canonical}`);
    }
    const binding = bindingByFile.get(canonical);
    return {
      id: binding?.id || `semantic-reference:${videoPlan.id}:${index + 1}`,
      assetId: binding?.assetId || null,
      canonical,
      role: binding?.role || asset.role || "semantic_reference",
      required: Boolean(binding?.required),
      order: Number(binding?.order) || index + 1,
      useMode: binding?.useMode || "semantic_reference",
      targetKind: binding?.targetKind || "video_plan",
      targetId: binding?.targetId || videoPlan.id,
      cropRegion: binding?.cropRegion || null,
      notes: binding?.notes || null,
      resolverToken: binding?.resolverToken || null,
      sha256,
      bytes: buffer.byteLength
    };
  });
  return {
    root,
    indexPath: canonicalIndex.indexPath,
    indexHash: canonicalIndex.indexHash,
    maxReferences,
    references
  };
}

/**
 * Read-only bridge for consumers that need the exact canonical references for
 * an explicit semantic T2V plan without building or queueing a ComfyUI graph.
 * The underlying resolver validates containment, index membership, hashes and
 * byte counts and does not mutate the project or storyboard objects.
 */
export function resolveStoryboardVideoPlanReferences(project, storyboard, videoPlanId) {
  const { videoPlan, clip } = findVideoPlan(storyboard, videoPlanId);
  const generationMode = videoPlan.generationMode || clip.generationMode || storyboard.defaults?.generationMode;
  if (generationMode !== T2V_GENERATION_MODE) {
    throw new Error(`Storyboard video plan ${videoPlan.id} is not an explicit semantic T2V plan`);
  }
  const state = resolveT2vReferences(project, storyboard, videoPlan, clip);
  return {
    generationMode,
    referenceMode: videoPlan.referenceMode || clip.referenceMode || "semantic_reference_resolver",
    referenceRoot: state.root.declared,
    referenceFiles: state.references.map((reference) => reference.canonical),
    referenceCount: state.references.length,
    expectedReferenceCount: Number(videoPlan.referenceCount ?? clip.referenceCount ?? state.references.length),
    resolvedReferenceCount: state.references.length,
    maxReferences: state.maxReferences,
    referenceIndexHash: state.indexHash,
    references: state.references.map((reference) => ({ ...reference }))
  };
}

function t2vAudioPlan(videoPlan, clip) {
  return videoPlan.audioPlan || clip.audioPlan || {
    mode: videoPlan.audioMode || "generated_ambience",
    dialogueText: clip.dialogueAnchor || "",
    instruction: clip.dialogueAnchor || ""
  };
}

function assertRunnableT2vAudio(videoPlan, clip) {
  const audioPlan = t2vAudioPlan(videoPlan, clip);
  const mode = audioPlan.mode || videoPlan.audioMode || "generated_ambience";
  if (mode === "generated_ambience") return audioPlan;
  if (mode === "custom_dialogue_required") {
    throw new Error(`Storyboard video plan ${videoPlan.id} requires an exact clip-length dialogue track before generation; voice identity references are not dialogue media`);
  }
  if (mode === "custom_track_post_mix") {
    throw new Error(`Storyboard video plan ${videoPlan.id} requires authoritative external audio post-mix support, which is not wired into the T2V workflow yet`);
  }
  throw new Error(`Storyboard video plan ${videoPlan.id} uses unsupported audio mode: ${mode}`);
}

function seedForVideoPlan(videoPlan) {
  const raw = Number(videoPlan.seed);
  if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  return parseInt(crypto.createHash("sha256").update(String(videoPlan.id || "video-plan")).digest("hex").slice(0, 12), 16);
}

function t2vPlanSettings(storyboard, videoPlan, clip) {
  const fps = Number(videoPlan.fps || storyboard.defaults?.fps || 24);
  // The package working canvas is an editorial target, not a safe native
  // diffusion size. Plans without an explicit override use the validated
  // LTX-2.5 latent-x2 preset; portrait/music-video plans keep their authored
  // dimensions.
  const width = Number(videoPlan.width || 768);
  const height = Number(videoPlan.height || 320);
  const authoredFrames = Math.round(Number(videoPlan.requestedFrames || clip.durationFrames));
  const decodedTrim = Math.max(0, Math.round(Number(clip.trimDecodedFrames ?? storyboard.defaults?.decodedFrameTrim ?? 1)));
  const generationFrames = Math.round(Number(videoPlan.generationFrames || clip.decodedFrames || authoredFrames + decodedTrim));
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`Storyboard video plan ${videoPlan.id} has invalid fps`);
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value % 32 === 0)) {
    throw new Error(`Storyboard video plan ${videoPlan.id} dimensions must be positive multiples of 32; received ${width}x${height}`);
  }
  if (!Number.isInteger(authoredFrames) || authoredFrames < 1) throw new Error(`Storyboard video plan ${videoPlan.id} has invalid authored frame count`);
  if (!Number.isInteger(generationFrames) || generationFrames < authoredFrames) {
    throw new Error(`Storyboard video plan ${videoPlan.id} generationFrames must be at least its authored frame count`);
  }
  if (generationFrames - authoredFrames !== decodedTrim) {
    throw new Error(`Storyboard video plan ${videoPlan.id} decoded-frame contract is inconsistent: ${generationFrames} generated, ${authoredFrames} authored, ${decodedTrim} trimmed`);
  }
  return {
    fps,
    width,
    height,
    authoredFrames,
    generationFrames,
    decodedTrim,
    durationSeconds: authoredFrames / fps,
    seed: seedForVideoPlan(videoPlan),
    latentX2: width % 64 === 0 && height % 64 === 0
  };
}

function t2vRelayGlobalPrompt(prompt) {
  const source = String(prompt || "").trim();
  const marker = /(?:^|\n)ACTION TIMELINE\s*\n/i.exec(source);
  if (!marker) return source;

  const sectionStart = marker.index + (source[marker.index] === "\n" ? 1 : 0);
  const afterMarker = sectionStart + marker[0].replace(/^\n/, "").length;
  const remainder = source.slice(afterMarker);
  const nextSection = /\n(?:PERFORMANCE AND AUDIO|CONTINUITY LOCKS|VISUAL EXECUTION)\s*\n/i.exec(remainder);
  const sectionEnd = nextSection ? afterMarker + nextSection.index : source.length;
  const before = source.slice(0, sectionStart).trimEnd();
  const after = source.slice(sectionEnd).trimStart();
  return [
    before,
    "TEMPORAL PROMPT RELAY",
    "The frame-specific actions are supplied separately by the Premiere316 Prompt Relay. Apply each local action only inside its assigned frame range; do not repeat the opening action across the full clip.",
    after
  ].filter(Boolean).join("\n\n").trim();
}

function t2vPromptRelaySchedule(storyboard, videoPlan, clip, settings) {
  const segmentIds = Array.isArray(videoPlan.segmentIds) ? videoPlan.segmentIds : [];
  if (!segmentIds.length) {
    throw new Error(`Storyboard video plan ${videoPlan.id} has no Prompt Relay segments`);
  }

  const segments = segmentIds.map((segmentId, index) => {
    const source = storyboard.segments?.[segmentId];
    if (!source) throw new Error(`Storyboard video plan ${videoPlan.id} references missing Prompt Relay segment ${segmentId}`);
    const start = Number(source.startFrame);
    const length = Number(source.lengthFrames);
    const prompt = String(source.prompt || "").trim();
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1) {
      throw new Error(`Storyboard Prompt Relay segment ${segmentId} has invalid frame bounds`);
    }
    if (!prompt) throw new Error(`Storyboard Prompt Relay segment ${segmentId} has an empty prompt`);
    if (prompt.includes("|")) {
      throw new Error(`Storyboard Prompt Relay segment ${segmentId} contains the reserved | delimiter`);
    }
    return { source, id: segmentId, index, start, length, prompt };
  });

  let cursor = 0;
  for (const segment of segments) {
    if (segment.start !== cursor) {
      throw new Error(
        `Storyboard Prompt Relay segments for ${videoPlan.id} are not contiguous: expected frame ${cursor}, received ${segment.start} (${segment.id})`
      );
    }
    cursor += segment.length;
  }
  if (cursor !== settings.authoredFrames) {
    throw new Error(
      `Storyboard Prompt Relay segments for ${videoPlan.id} cover ${cursor} frames; expected ${settings.authoredFrames}`
    );
  }

  const globalPrompt = t2vRelayGlobalPrompt(videoPlan.globalPrompt);
  if (!globalPrompt) throw new Error(`Storyboard video plan ${videoPlan.id} has no persistent Prompt Relay context`);
  const localPrompts = segments.map((segment) => segment.prompt).join(" | ");
  const segmentLengths = segments.map((segment) => segment.length).join(",");
  const existingTimeline = videoPlan.timelineData && typeof videoPlan.timelineData === "object"
    ? structuredClone(videoPlan.timelineData)
    : {};
  const existingById = new Map((existingTimeline.segments || []).map((segment) => [segment?.id, segment]));
  const timelineData = {
    ...existingTimeline,
    mainTrackEnabled: true,
    global_prompt: globalPrompt,
    retakeMode: false,
    normalStartFrame: 0,
    normalDurationFrames: settings.authoredFrames,
    segments: segments.map((segment) => ({
      ...(existingById.get(segment.id) || {}),
      id: segment.id,
      start: segment.start,
      length: segment.length,
      prompt: segment.prompt,
      type: "text",
      isEndFrame: Boolean(segment.source.isEndFrame)
    })),
    motionSegments: Array.isArray(existingTimeline.motionSegments) ? existingTimeline.motionSegments : [],
    audioSegments: Array.isArray(existingTimeline.audioSegments) ? existingTimeline.audioSegments : []
  };

  return {
    globalPrompt,
    localPrompts,
    segmentLengths,
    timelineData,
    segmentCount: segments.length,
    authoredFrames: settings.authoredFrames,
    segments: segments.map(({ id, start, length, prompt }) => ({ id, start, length, prompt }))
  };
}

function workflowContainers(graph) {
  return [graph, ...(graph.definitions?.subgraphs || [])];
}

function workflowDefinitions(graph) {
  return new Map((graph.definitions?.subgraphs || []).map((definition) => [definition.id, definition]));
}

function findNodeDeep(graph, id) {
  for (const container of workflowContainers(graph)) {
    const node = (container.nodes || []).find((candidate) => Number(candidate.id) === Number(id));
    if (node) return node;
  }
  return null;
}

function findNodesDeep(graph, predicate) {
  return workflowContainers(graph).flatMap((container) => (container.nodes || []).filter(predicate));
}

function setWidgetValueDeep(graph, nodeId, index, value) {
  const node = findNodeDeep(graph, nodeId);
  if (!node) throw new Error(`Required Storyboard workflow node is missing: ${nodeId}`);
  node.widgets_values = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
  node.widgets_values[index] = value;
  return node;
}

function deterministicUuid(value) {
  const hex = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function normalizedContainerLinks(container) {
  return (container.links || []).map((link) => Array.isArray(link)
    ? { id: link[0], origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4], type: link[5] }
    : link);
}

function findFrame(storyboard, frameId) {
  const frame = storyboard?.frames?.[frameId];
  if (!frame) throw new Error(`Storyboard image guide not found: ${frameId}`);
  return frame;
}

function findNode(graph, id) {
  return graph.nodes?.find((node) => Number(node.id) === Number(id)) || null;
}

function removeLink(graph, linkId) {
  if (linkId == null) return;
  graph.links = (graph.links || []).filter((link) => Number(link?.[0]) !== Number(linkId));
  for (const node of graph.nodes || []) {
    for (const output of node.outputs || []) {
      if (Array.isArray(output.links)) {
        output.links = output.links.filter((id) => Number(id) !== Number(linkId));
        if (!output.links.length) output.links = null;
      }
    }
  }
}

function disconnectInput(graph, nodeId, inputName) {
  const node = findNode(graph, nodeId);
  const input = (node?.inputs || []).find((candidate) => candidate.name === inputName);
  if (!input) return;
  removeLink(graph, input.link);
  input.link = null;
}

function setWidgetValue(graph, nodeId, index, value) {
  const node = findNode(graph, nodeId);
  if (!node) throw new Error(`Required Storyboard workflow node is missing: ${nodeId}`);
  node.widgets_values = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
  node.widgets_values[index] = value;
  return node;
}

function storyboardPromptForFrame(frame) {
  const references = (frame.references || [])
    .map((reference) => `${reference.role || "reference"}: ${reference.sourceAssetFile || reference.sourceAssetKey || reference.assetId} (${reference.assetVersionId || `v${reference.assetVersion}`})`)
    .filter(Boolean);
  const sections = [
    "PREMIERE316 STORYBOARD IMAGE GUIDE",
    "",
    String(frame.prompt || "").trim()
  ];
  if (references.length) {
    sections.push(
      "",
      "Exact authored visual references to respect as role-specific context only:",
      references.join("; "),
      "Use these references only for their assigned role. Do not copy contact-sheet borders, labels, lettering, panel layouts, duplicate turnarounds, or unrelated subjects."
    );
  }
  if (frame.negativePrompt) {
    sections.push(
      "",
      "Avoid/negative constraints to translate into clean positive image choices:",
      String(frame.negativePrompt).trim()
    );
  }
  return sections.join("\n").trim();
}

function resolutionForFrame(project, frame) {
  const text = `${frame?.prompt || ""} ${frame?.expectedInputPath || ""}`.toLowerCase();
  if (/(2p39x1|2\.39|2:39|2\.35|anamorphic|cinematic master)/i.test(text)) return { width: 1280, height: 544, ratio: "2.39:1" };
  if (/(2x3|2:3|vertical|portrait)/i.test(text)) return { width: 832, height: 1248, ratio: "2:3" };
  if (/(1x1|1:1|square)/i.test(text)) return { width: 1024, height: 1024, ratio: "1:1" };
  const ratio = (Number(project?.settings?.width) || 1280) / (Number(project?.settings?.height) || 720);
  return ratio > 2 ? { width: 1280, height: 544, ratio: "2.39:1" } : { width: 1280, height: 720, ratio: "16:9" };
}

function seedForFrame(frame) {
  const raw = Number(frame.seed);
  if (Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  return parseInt(crypto.createHash("sha256").update(String(frame.id || "frame")).digest("hex").slice(0, 12), 16);
}

function expectedPrefix(project, frame) {
  const authored = String(frame.expectedInputPath || "").replace(/\.[^.]+$/, "");
  if (authored) return authored.replace(/\\/g, "/");
  return `Premiere316/${project.slug}/storyboard/${safePart(frame.id)}`;
}

function destinationBase(frame) {
  const expected = String(frame.expectedInputPath || "");
  const base = path.basename(expected.replace(/\\/g, "/")).replace(/\.[^.]+$/, "");
  return safePart(base || frame.id, "storyboard-frame", 96);
}

function nextGeneratedVersion(frame) {
  return Math.max(0, ...(frame.generatedVersions || []).map((version) => Number(version.v) || 0)) + 1;
}

function imageBufferMatchesExtension(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ([".jpg", ".jpeg"].includes(extension)) return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export function registerStoryboardFrameReplacement(slug, frameId, {
  buffer,
  extension = ".png",
  sourceFileName = "director-replacement.png"
}) {
  const safeExtension = String(extension || "").toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(safeExtension)) {
    throw new Error("Use a PNG, JPEG, or WebP storyboard image");
  }
  if (!imageBufferMatchesExtension(buffer, safeExtension)) {
    throw new Error(`Uploaded file contents do not match ${safeExtension} image data`);
  }

  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const frame = findFrame(storyboard, frameId);
  const version = nextGeneratedVersion(frame);
  const filename = `${destinationBase(frame)}.v${version}.manual${safeExtension === ".jpeg" ? ".jpg" : safeExtension}`;
  const destination = mediaDir(project, "storyboard");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, filename), buffer, { flag: "wx" });

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const next = structuredClone(storyboard);
  const target = findFrame(next, frameId);
  target.generatedVersions = Array.isArray(target.generatedVersions) ? target.generatedVersions : [];
  target.generatedVersions.push({
    v: version,
    files: [filename],
    file: filename,
    mediaType: "image",
    source: "director_manual_replacement",
    sourceFileName: path.basename(String(sourceFileName || "director-replacement")),
    workflowId: null,
    workflowHash: null,
    fileHashes: [{ file: filename, sha256, bytes: buffer.byteLength, extension: path.extname(filename).toLowerCase() }],
    createdAt: new Date().toISOString()
  });
  target.activeGeneratedVersion = version;
  target.generatedFile = filename;
  target.generatedInputPath = `media/storyboard/${filename}`;
  target.generatedAssetId = target.id;
  target.generatedAssetVersionId = `${target.id}:v${version}`;
  target.status = "generated";
  target.lastError = null;
  target.manualReplacementAt = new Date().toISOString();
  saveStoryboard(slug, next);
  return { storyboard: next, frame: target, file: filename, version, sha256 };
}

export function registerStoryboardHandoffFrame(slug, clipId, {
  buffer,
  extension = ".png",
  sourceClipId,
  sourcePromptId,
  sourceOutputNodeId = "201",
  sourceFrameIndex,
  sourceRunId,
  sourceShotId,
  workflowHash
}) {
  const safeExtension = String(extension || "").toLowerCase() === ".jpeg" ? ".jpg" : String(extension || "").toLowerCase();
  if (![".png", ".jpg", ".webp"].includes(safeExtension)) throw new Error("Storyboard handoff must be PNG, JPEG, or WebP");
  if (!imageBufferMatchesExtension(buffer, safeExtension)) throw new Error(`Handoff file contents do not match ${safeExtension} image data`);
  if (!sourcePromptId) throw new Error("Storyboard handoff requires its source ComfyUI prompt id");

  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[clipId];
  if (!clip?.firstFrameId) throw new Error(`Storyboard music-video clip has no first-frame target: ${clipId}`);
  const frame = findFrame(storyboard, clip.firstFrameId);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const duplicate = (frame.generatedVersions || []).find((version) =>
    version.source === "ltx25_director_music_video_handoff"
    && String(version.sourcePromptId || "") === String(sourcePromptId)
    && String(version.sourceOutputNodeId || "") === String(sourceOutputNodeId)
  );
  if (duplicate) {
    const expected = duplicate.fileHashes?.[0];
    if (expected?.sha256 && String(expected.sha256).toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`Existing storyboard handoff for ${sourcePromptId} has different bytes`);
    }
    return {
      storyboard,
      frame,
      file: duplicate.file,
      projectMediaPath: `media/storyboard/${duplicate.file}`,
      version: duplicate.v,
      sha256,
      idempotent: true
    };
  }

  const version = nextGeneratedVersion(frame);
  const filename = `${destinationBase(frame)}.v${version}.handoff${safeExtension}`;
  const destination = mediaDir(project, "storyboard");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, filename), buffer, { flag: "wx" });

  const next = structuredClone(storyboard);
  const target = findFrame(next, frame.id);
  target.generatedVersions = Array.isArray(target.generatedVersions) ? target.generatedVersions : [];
  target.generatedVersions.push({
    v: version,
    files: [filename],
    file: filename,
    mediaType: "image",
    source: "ltx25_director_music_video_handoff",
    sourceClipId: sourceClipId || null,
    sourcePromptId: String(sourcePromptId),
    sourceOutputNodeId: String(sourceOutputNodeId),
    sourceFrameIndex: Math.max(0, Math.round(Number(sourceFrameIndex) || 0)),
    sourceRunId: sourceRunId || null,
    sourceShotId: sourceShotId || null,
    workflowId: "ltx25-director-music-video",
    workflowHash: workflowHash || null,
    fileHashes: [{ file: filename, sha256, bytes: buffer.byteLength, extension: safeExtension }],
    createdAt: new Date().toISOString()
  });
  target.activeGeneratedVersion = version;
  target.generatedFile = filename;
  target.generatedInputPath = `media/storyboard/${filename}`;
  target.generatedAssetId = target.id;
  target.generatedAssetVersionId = `${target.id}:v${version}`;
  target.status = "generated";
  target.lastError = null;
  target.handoffRegisteredAt = new Date().toISOString();
  saveStoryboard(slug, next);
  return {
    storyboard: next,
    frame: target,
    file: filename,
    projectMediaPath: `media/storyboard/${filename}`,
    version,
    sha256,
    idempotent: false
  };
}

function generatedFileHashes(project, files) {
  return [...new Set((files || []).map((file) => path.basename(String(file || ""))).filter(Boolean))]
    .map((file) => {
      const absolute = path.join(mediaDir(project, "storyboard"), file);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Generated storyboard file is missing: ${file}`);
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

function resolvedFrameReferences(project, frame) {
  if (!Array.isArray(frame.references)) throw new Error(`Storyboard frame ${frame.id} references must be an array`);
  const seenIds = new Set();
  const authored = frame.references.map((reference, index) => {
    const id = typeof reference?.id === "string" ? reference.id.trim() : "";
    if (!id) throw new Error(`Storyboard frame ${frame.id} reference ${index + 1} has no stable ID`);
    if (seenIds.has(id)) throw new Error(`Storyboard frame ${frame.id} repeats reference ID ${id}`);
    seenIds.add(id);
    return {
      reference,
      order: Number(reference?.order) || index + 1
    };
  }).sort((left, right) => left.order - right.order || String(left.reference?.assetId).localeCompare(String(right.reference?.assetId)));
  const snapshots = resolveStillsReferences(project, authored.map(({ reference, order }) => ({
    assetId: reference?.assetId,
    assetVersion: reference?.assetVersion,
    role: reference?.role,
    order,
    type: "image"
  })));
  return snapshots.map((snapshot, index) => {
    const reference = authored[index].reference;
    const checks = [
      ["sourceAssetFile", snapshot.sourceFile],
      ["sourceAssetSha256", snapshot.fileSha256],
      ["sourceAssetBytes", snapshot.fileBytes],
      ["sourceGenerationFingerprint", snapshot.generationFingerprint],
      ["sourceVersionFingerprint", snapshot.versionFingerprint],
      ["sourceApprovalFingerprint", snapshot.approvalFingerprint]
    ];
    for (const [field, actual] of checks) {
      const expected = reference?.[field];
      if (expected != null && String(expected) !== String(actual)) {
        throw new Error(`Storyboard reference ${reference?.id || snapshot.assetId} ${field} drifted from its exact approved asset version`);
      }
    }
    return { reference, snapshot };
  });
}

function storyboardReferenceUpload(project, snapshot) {
  const extension = path.posix.extname(snapshot.sourceFile).toLowerCase() || ".png";
  const subfolder = `${COMFY_STORYBOARD_REFERENCE_SUBFOLDER}/${safePart(project.slug)}/assets/${safePart(snapshot.assetId)}/v${snapshot.assetVersion}`;
  const fileName = `${snapshot.fileSha256}${extension}`;
  return { subfolder, fileName, comfyImage: `${subfolder}/${fileName}` };
}

function storyboardReferenceEntries(project, frame, uploaded = new Map()) {
  return resolvedFrameReferences(project, frame)
    .map(({ reference, snapshot }, index) => {
      const asset = project.assets?.items?.find((item) => item.id === snapshot.assetId);
      const sourcePath = resolveProjectMediaFile(
        typeof project?.projectsRoot === "string" && project.projectsRoot.trim() ? project.projectsRoot : PROJECTS_DIR,
        project.slug,
        "assets",
        snapshot.sourceFile
      );
      const upload = storyboardReferenceUpload(project, snapshot);
      const uploadedImage = uploaded.get(reference.id);
      if (uploadedImage != null && uploadedImage !== upload.comfyImage) {
        throw new Error(`Storyboard reference ${reference.id} does not match its content-addressed ComfyUI destination`);
      }
      return {
        id: reference.id,
        order: snapshot.order || index + 1,
        assetId: snapshot.assetId,
        assetName: asset?.name || reference.sourceAssetKey || snapshot.assetId,
        assetVersion: snapshot.assetVersion,
        assetVersionId: `${snapshot.assetId}:v${snapshot.assetVersion}`,
        role: snapshot.role,
        required: reference.required !== false,
        useMode: reference.useMode || "direct_conditioning",
        sourceAssetFile: snapshot.sourceFile,
        sourceAssetSha256: snapshot.fileSha256,
        sourceAssetBytes: snapshot.fileBytes,
        sourcePath,
        comfySubfolder: upload.subfolder,
        comfyFileName: upload.fileName,
        comfyImage: uploadedImage || upload.comfyImage,
        cropRegion: reference.cropRegion || null,
        notes: reference.notes || null
      };
    })
    .sort((left, right) => left.order - right.order || left.assetId.localeCompare(right.assetId));
}

async function uploadStoryboardReferenceImages(project, frame, uploadCache = new Map()) {
  const uploaded = new Map();
  const entries = storyboardReferenceEntries(project, frame);
  const missing = entries.filter((entry) => !entry.sourcePath || !fs.existsSync(entry.sourcePath) || !fs.statSync(entry.sourcePath).isFile());
  if (missing.length) {
    throw new Error(
      `Storyboard reference files are missing for ${frame.id}: ${missing
        .map((entry) => `${entry.assetVersionId} (${entry.sourceAssetFile})`)
        .join(", ")}`
    );
  }
  for (const entry of entries) {
    const cacheKey = entry.comfyImage;
    let comfyImage = uploadCache.get(cacheKey);
    if (!comfyImage) {
      comfyImage = await uploadImage(entry.sourcePath, entry.comfySubfolder, {
        fileName: entry.comfyFileName,
        expectedSha256: entry.sourceAssetSha256,
        overwrite: true
      });
      uploadCache.set(cacheKey, comfyImage);
    }
    if (comfyImage !== entry.comfyImage) {
      throw new Error(`ComfyUI changed the content-addressed reference name for ${entry.assetVersionId}`);
    }
    uploaded.set(entry.id, comfyImage);
  }
  return uploaded;
}

function outputSlotForNode(node, outputName, fallback = 0) {
  const index = (node?.outputs || []).findIndex((output) => output.name === outputName);
  return index >= 0 ? index : fallback;
}

function inputSlotForNode(node, inputName, fallback = 0) {
  const index = (node?.inputs || []).findIndex((input) => input.name === inputName);
  return index >= 0 ? index : fallback;
}

function linkNodes(graph, fromNodeId, fromSlot, toNodeId, toInputName, type = "IMAGE") {
  const toNode = findNode(graph, toNodeId);
  if (!toNode) return null;
  const input = (toNode.inputs || []).find((candidate) => candidate.name === toInputName);
  if (!input) return null;
  removeLink(graph, input.link);
  const linkId = Math.max(REFERENCE_LINK_START_ID, 1 + Math.max(0, ...(graph.links || []).map((link) => Number(link?.[0]) || 0)));
  const toSlot = inputSlotForNode(toNode, toInputName);
  const link = [linkId, fromNodeId, fromSlot, toNodeId, toSlot, type];
  graph.links = [...(graph.links || []), link];
  graph.last_link_id = Math.max(Number(graph.last_link_id) || 0, linkId);
  input.link = linkId;
  const fromNode = findNode(graph, fromNodeId);
  const output = fromNode?.outputs?.[fromSlot];
  if (output) {
    output.links = Array.isArray(output.links) ? [...output.links, linkId] : [linkId];
  }
  return linkId;
}

function attachReferenceImageNodes(graph, references) {
  if (!references.length) {
    throw new Error("The reference-conditioned Storyboard workflow requires at least one attached visual reference");
  }
  if (references.length > MAX_STORYBOARD_REFERENCES) {
    throw new Error(`Storyboard frame has ${references.length} references; the supplied workflow supports ${MAX_STORYBOARD_REFERENCES}`);
  }

  const definition = (graph.definitions?.subgraphs || []).find((candidate) =>
    (candidate.nodes || []).some((node) =>
      node.type === "ImageConcatMulti" && node.properties?.["premiere316.referenceComposite"]
    )
  );
  if (!definition) throw new Error("Supplied Storyboard workflow is missing its reference attachment subgraph");
  const instance = findNodesDeep(graph, (node) => node.type === definition.id)[0];
  if (!instance) throw new Error("Supplied Storyboard workflow is missing its reference subgraph instance");

  const loadBlueprint = (definition.nodes || []).find((node) => node.type === "LoadImage") || {};
  const concatBlueprint = (definition.nodes || []).find((node) => node.type === "ImageConcatMulti") || {};
  const referenceNodes = [];
  const links = [];
  const inputs = [];

  for (const [index, reference] of references.entries()) {
    const id = REFERENCE_NODE_START_ID + index;
    const imageLinkId = REFERENCE_LINK_START_ID + index * 3;
    const uploadLinkId = imageLinkId + 1;
    const concatLinkId = imageLinkId + 2;
    const inputName = index === 0 ? "image" : `image_${index}`;
    const uploadName = index === 0 ? "upload" : `upload_${index}`;
    const row = index % 5;
    const column = Math.floor(index / 5);
    const node = {
      ...structuredClone(loadBlueprint),
      id,
      type: "LoadImage",
      pos: [-1550 + column * 350, 330 + row * 330],
      size: [315, 314],
      flags: {},
      order: 1000 + index,
      mode: 0,
      inputs: [
        { name: "image", type: "COMBO", link: imageLinkId },
        { name: "upload", type: "IMAGEUPLOAD", link: uploadLinkId }
      ],
      outputs: [
        { name: "IMAGE", type: "IMAGE", links: [concatLinkId], slot_index: 0 },
        { name: "MASK", type: "MASK", links: null, slot_index: 1 }
      ],
      properties: {
        ...(loadBlueprint.properties || {}),
        "Node name for S&R": "LoadImage",
        "premiere316.referenceId": reference.id,
        "premiere316.assetId": reference.assetId,
        "premiere316.assetVersionId": reference.assetVersionId,
        "premiere316.role": reference.role,
        "premiere316.order": index + 1
      },
      widgets_values: [reference.comfyImage, "image"]
    };
    referenceNodes.push({ node, reference });
    inputs.push(
      {
        id: deterministicUuid(`${reference.id}:image`),
        name: inputName,
        type: "COMBO",
        linkIds: [imageLinkId],
        pos: [-1690, 350 + index * 40]
      },
      {
        id: deterministicUuid(`${reference.id}:upload`),
        name: uploadName,
        type: "IMAGEUPLOAD",
        linkIds: [uploadLinkId],
        pos: [-1690, 370 + index * 40]
      }
    );
    links.push(
      { id: imageLinkId, origin_id: -10, origin_slot: index * 2, target_id: id, target_slot: 0, type: "COMBO" },
      { id: uploadLinkId, origin_id: -10, origin_slot: index * 2 + 1, target_id: id, target_slot: 1, type: "IMAGEUPLOAD" },
      { id: concatLinkId, origin_id: id, origin_slot: 0, target_id: REFERENCE_CONCAT_NODE_ID, target_slot: index, type: "IMAGE" }
    );
  }

  const concatInputs = Array.from({ length: MAX_STORYBOARD_REFERENCES }, (_, index) => ({
    name: `image_${index + 1}`,
    type: "IMAGE,MASK",
    link: index < references.length ? REFERENCE_LINK_START_ID + index * 3 + 2 : null
  }));
  const outputLinkId = REFERENCE_LINK_START_ID + MAX_STORYBOARD_REFERENCES * 3;
  const concatNode = {
    ...structuredClone(concatBlueprint),
    id: REFERENCE_CONCAT_NODE_ID,
    type: "ImageConcatMulti",
    pos: [330, 650],
    size: [340, 620],
    flags: {},
    order: 2000,
    mode: 0,
    inputs: concatInputs,
    outputs: [{ name: "output", type: "IMAGE", links: [outputLinkId], slot_index: 0 }],
    properties: {
      ...(concatBlueprint.properties || {}),
      "Node name for S&R": "ImageConcatMulti",
      "premiere316.referenceComposite": true,
      "premiere316.referenceCount": references.length,
      "premiere316.referenceCapacity": MAX_STORYBOARD_REFERENCES
    },
    widgets_values: [MAX_STORYBOARD_REFERENCES, "right", true, null]
  };
  links.push({ id: outputLinkId, origin_id: REFERENCE_CONCAT_NODE_ID, origin_slot: 0, target_id: -20, target_slot: 0, type: "IMAGE" });

  definition.nodes = [...referenceNodes.map(({ node }) => node), concatNode];
  definition.inputs = inputs;
  definition.links = links;
  definition.outputs = [{
    ...(definition.outputs?.[0] || {}),
    id: definition.outputs?.[0]?.id || deterministicUuid(`${definition.id}:output`),
    name: "output",
    type: "IMAGE",
    linkIds: [outputLinkId],
    localized_name: "output",
    pos: [700, 660]
  }];
  definition.inputNode = { ...(definition.inputNode || {}), id: -10, bounding: [-1720, 320, 128, Math.max(120, references.length * 40 + 80)] };
  definition.outputNode = { ...(definition.outputNode || {}), id: -20, bounding: [680, 630, 128, 68] };
  definition.state = {
    ...(definition.state || {}),
    lastNodeId: REFERENCE_CONCAT_NODE_ID,
    lastLinkId: outputLinkId
  };
  definition.revision = Math.max(0, Number(definition.revision) || 0) + 1;

  instance.widgets_values = references.flatMap((reference) => [reference.comfyImage, "image"]);
  instance.properties = {
    ...(instance.properties || {}),
    "premiere316.referenceCount": references.length,
    "premiere316.referenceIds": references.map((reference) => reference.id)
  };
  graph.last_node_id = Math.max(Number(graph.last_node_id) || 0, REFERENCE_CONCAT_NODE_ID);
  graph.last_link_id = Math.max(Number(graph.last_link_id) || 0, outputLinkId);
  return {
    referenceNodes,
    compositeNodes: [concatNode],
    conditioningNodeId: concatNode.id,
    definitionId: definition.id,
    instanceId: instance.id
  };
}

export function flattenStoryboardWorkflowGraph(graph) {
  const definitions = workflowDefinitions(graph);
  const containers = [graph];
  const reachableDefinitions = new Set();
  for (let index = 0; index < containers.length; index += 1) {
    for (const node of containers[index].nodes || []) {
      const definition = definitions.get(node.type);
      if (!definition || reachableDefinitions.has(definition.id)) continue;
      reachableDefinitions.add(definition.id);
      containers.push(definition);
    }
  }
  const instanceTypes = new Set(definitions.keys());
  const ordinaryNodes = [];
  const seenIds = new Set();
  for (const container of containers) {
    for (const node of container.nodes || []) {
      if (instanceTypes.has(node.type)) continue;
      const key = String(node.id);
      if (seenIds.has(key)) throw new Error(`Supplied Storyboard workflow reuses executable node id ${key}`);
      seenIds.add(key);
      const cloned = structuredClone(node);
      for (const input of cloned.inputs || []) input.link = null;
      for (const output of cloned.outputs || []) output.links = null;
      ordinaryNodes.push(cloned);
    }
  }

  const nodeMaps = new Map(containers.map((container) => [container, new Map((container.nodes || []).map((node) => [String(node.id), node]))]));
  const linksByContainer = new Map(containers.map((container) => [container, normalizedContainerLinks(container)]));

  function resolveSource(container, nodeId, slot, stack = []) {
    const node = nodeMaps.get(container)?.get(String(nodeId));
    if (!node) return null;
    const definition = definitions.get(node.type);
    if (!definition) return { nodeId: node.id, slot };
    if (stack.includes(node.type)) throw new Error(`Recursive Storyboard subgraph detected: ${[...stack, node.type].join(" -> ")}`);
    const boundary = linksByContainer.get(definition)?.find((link) =>
      Number(link.target_id) === -20 && Number(link.target_slot) === Number(slot)
    );
    return boundary ? resolveSource(definition, boundary.origin_id, boundary.origin_slot, [...stack, node.type]) : null;
  }

  function resolveTargets(container, nodeId, slot, stack = []) {
    const node = nodeMaps.get(container)?.get(String(nodeId));
    if (!node) return [];
    const definition = definitions.get(node.type);
    if (!definition) return [{ nodeId: node.id, slot }];
    if (stack.includes(node.type)) throw new Error(`Recursive Storyboard subgraph detected: ${[...stack, node.type].join(" -> ")}`);
    return (linksByContainer.get(definition) || [])
      .filter((link) => Number(link.origin_id) === -10 && Number(link.origin_slot) === Number(slot))
      .flatMap((link) => resolveTargets(definition, link.target_id, link.target_slot, [...stack, node.type]));
  }

  const edgeMap = new Map();
  for (const container of containers) {
    for (const link of linksByContainer.get(container) || []) {
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
    nodes: ordinaryNodes,
    links: [],
    last_node_id: Math.max(0, ...ordinaryNodes.map((node) => Number(node.id) || 0)),
    last_link_id: 0,
    extra: structuredClone(graph.extra || {})
  };
  for (const edge of edgeMap.values()) {
    const target = findNode(flat, edge.targetNodeId);
    const inputName = target?.inputs?.[edge.targetSlot]?.name;
    if (!target || !inputName) continue;
    linkNodes(flat, edge.nodeId, edge.slot, edge.targetNodeId, inputName, edge.type);
  }
  return flat;
}

function missingRuntimeClasses(graph, objectInfo) {
  const missing = [];
  for (const node of graph.nodes || []) {
    if (VIRTUAL_NODE_TYPES.has(node.type) || node.mode === 2 || node.mode === 4) continue;
    if (!objectInfo?.[node.type]) missing.push(`${node.type} (node ${node.id})`);
  }
  return missing;
}

function normalizeStoryboardApiPrompt(apiPrompt, seed) {
  for (const promptJoinNode of Object.values(apiPrompt || {}).filter((node) => node.class_type === "StringConcatenate")) {
    promptJoinNode.inputs = { ...promptJoinNode.inputs, delimiter: " " };
  }

  for (const textNode of Object.values(apiPrompt || {}).filter((node) => node.class_type === "TextGenerate")) {
    const safeSeed = Number.isFinite(Number(seed)) ? Math.abs(Math.trunc(Number(seed) % 1_000_000_000)) : 5;
    const inputs = {
      ...textNode.inputs,
      max_length: Math.max(1024, Number(textNode.inputs?.max_length) || 0),
      sampling_mode: "on",
      "sampling_mode.temperature": 1,
      "sampling_mode.top_k": 64,
      "sampling_mode.top_p": 0.95,
      "sampling_mode.min_p": 0.05,
      "sampling_mode.repetition_penalty": 1.05,
      "sampling_mode.seed": safeSeed,
      "sampling_mode.presence_penalty": 0,
      thinking: true,
      use_default_template: true
    };
    for (const staleInput of [
      "temperature",
      "top_k",
      "top_p",
      "min_p",
      "repetition_penalty",
      "seed",
      "presence_penalty"
    ]) {
      delete inputs[staleInput];
    }
    textNode.inputs = inputs;
  }
  return apiPrompt;
}

function validateApiPromptRequiredInputs(apiPrompt, objectInfo) {
  const errors = [];
  for (const [nodeId, node] of Object.entries(apiPrompt || {})) {
    const required = objectInfo?.[node.class_type]?.input?.required || {};
    for (const inputName of Object.keys(required)) {
      const value = node.inputs?.[inputName];
      const isMissing =
        value === undefined ||
        value === null ||
        (Array.isArray(value) && value.length === 0);
      if (isMissing) errors.push(`${nodeId} ${node.class_type}.${inputName}`);
    }
    if (node.class_type === "TextGenerate" && node.inputs?.sampling_mode === "on") {
      for (const childName of ["temperature", "top_k", "top_p", "min_p", "repetition_penalty", "seed"]) {
        const inputName = `sampling_mode.${childName}`;
        if (node.inputs?.[inputName] === undefined || node.inputs?.[inputName] === null) {
          errors.push(`${nodeId} ${node.class_type}.${inputName}`);
        }
      }
    }
  }
  return errors;
}

function validateApiPromptComboValues(apiPrompt, objectInfo) {
  const errors = [];
  for (const [nodeId, node] of Object.entries(apiPrompt || {})) {
    const inputs = {
      ...(objectInfo?.[node.class_type]?.input?.required || {}),
      ...(objectInfo?.[node.class_type]?.input?.optional || {})
    };
    for (const [inputName, definition] of Object.entries(inputs)) {
      const allowed = Array.isArray(definition?.[0]) ? definition[0] : null;
      const value = node.inputs?.[inputName];
      const linked = Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]);
      if (!allowed || value === undefined || value === null || linked) continue;
      const encoded = JSON.stringify(value);
      if (!allowed.some((candidate) => JSON.stringify(candidate) === encoded)) {
        errors.push(`${nodeId} ${node.class_type}.${inputName}=${encoded} (not available in active combo)`);
      }
    }
  }
  return errors;
}

let storyboardRuntimeProbeGraphsCache = null;

export function storyboardRuntimeProbeGraphs() {
  if (!storyboardRuntimeProbeGraphsCache) {
    storyboardRuntimeProbeGraphsCache = {
      image: flattenStoryboardWorkflowGraph(loadSourceWorkflowGraph()),
      video: flattenStoryboardWorkflowGraph(loadT2vSourceWorkflowGraph())
    };
  }
  return storyboardRuntimeProbeGraphsCache;
}

export function validateStoryboardRuntimeGraph(executionGraph, objectInfo, { seed = 5 } = {}) {
  if (!executionGraph || !Array.isArray(executionGraph.nodes)) {
    return {
      ready: false,
      missingClasses: [],
      conversionWarnings: ["The flattened execution graph is unavailable"],
      missingInputs: [],
      invalidComboValues: []
    };
  }
  const missingClasses = missingRuntimeClasses(executionGraph, objectInfo);
  const converted = graphToApi({ nodes: executionGraph.nodes, links: executionGraph.links }, objectInfo);
  normalizeStoryboardApiPrompt(converted.prompt, seed);
  const missingInputs = validateApiPromptRequiredInputs(converted.prompt, objectInfo);
  const invalidComboValues = validateApiPromptComboValues(converted.prompt, objectInfo);
  const conversionWarnings = converted.warnings || [];
  return {
    ready: !missingClasses.length && !conversionWarnings.length && !missingInputs.length && !invalidComboValues.length,
    missingClasses,
    conversionWarnings,
    missingInputs,
    invalidComboValues,
    executableNodeCount: Object.keys(converted.prompt || {}).length
  };
}

export function buildStoryboardFrameWorkflowGraph(project, storyboard, frameId, options = {}) {
  const frame = findFrame(storyboard, frameId);
  const graph = structuredClone(loadSourceWorkflowGraph());
  const prompt = storyboardPromptForFrame(frame);
  const resolution = resolutionForFrame(project, frame);
  const seed = seedForFrame(frame);
  const filenamePrefix = expectedPrefix(project, frame);

  setWidgetValueDeep(graph, 10042, 1, prompt);
  setWidgetValueDeep(graph, 10040, 0, prompt);
  setWidgetValueDeep(graph, 10058, 0, prompt);
  setWidgetValueDeep(graph, 199, 0, filenamePrefix);
  setWidgetValueDeep(graph, 199, 1, "save");
  setWidgetValueDeep(graph, 200, 0, {
    mode: "custom",
    ratio: resolution.ratio,
    w: resolution.width,
    h: resolution.height,
    custom_w: resolution.width,
    custom_h: resolution.height,
    custom_ratio_w: resolution.ratio === "2.39:1" ? 239 : resolution.width,
    custom_ratio_h: resolution.ratio === "2.39:1" ? 100 : resolution.height,
    snap: 32
  });
  const resolutionNode = findNodeDeep(graph, 200);
  if (resolutionNode?.properties) {
    resolutionNode.properties.resolutionState = JSON.stringify(resolutionNode.widgets_values[0]);
  }

  const pixaromaSeedState = {
    seed,
    runSeed: seed,
    mode: "fixed",
    compact: false,
    digits: String(seed).length
  };
  setWidgetValueDeep(graph, 204, 0, pixaromaSeedState);
  const pixaromaSeedNode = findNodeDeep(graph, 204);
  if (pixaromaSeedNode?.properties) {
    pixaromaSeedNode.properties.seedState = JSON.stringify(pixaromaSeedState);
  }

  setWidgetValueDeep(graph, 10053, 0, resolution.width);
  setWidgetValueDeep(graph, 10053, 1, resolution.height);
  setWidgetValueDeep(graph, 10053, 2, 1);
  setWidgetValueDeep(graph, 10056, 0, seed);
  setWidgetValueDeep(graph, 10056, 1, "fixed");
  setWidgetValueDeep(graph, 10054, 0, seed + 1);
  setWidgetValueDeep(graph, 10054, 1, "fixed");

  const mainSubgraphInstance = findNodeDeep(graph, 10063);
  mainSubgraphInstance.widgets_values = [resolution.width, resolution.height, prompt, seed + 1, seed];

  for (const node of findNodesDeep(graph, () => true)) {
    if (node.properties?.pixaromaFrames) {
      node.properties = { ...node.properties, pixaromaFrames: [], pixaromaSelected: 0 };
    }
    if (node.type === "PixaromaShowText") node.widgets_values = [""];
  }

  const references = storyboardReferenceEntries(project, frame, options.uploadedReferences || new Map());
  const referenceGraph = attachReferenceImageNodes(graph, references);

  graph.extra = {
    ...(graph.extra || {}),
    premiere316: {
      type: "storyboard-image-guide",
      workflowId: STORYBOARD_KREA_WORKFLOW_ID,
      projectSlug: project.slug,
      frameId: frame.id,
      promptHash: crypto.createHash("sha256").update(prompt).digest("hex"),
      sourceWorkflow: SOURCE_WORKFLOW_NAME,
      sourceWorkflowHash: sourceWorkflowHash(),
      filenamePrefix,
      resolution,
      seed,
      references: references.map(({ sourcePath, ...reference }) => reference),
      referenceNodeIds: referenceGraph.referenceNodes.map(({ node }) => node.id),
      referenceCompositeNodeIds: referenceGraph.compositeNodes.map((node) => node.id),
      referenceConditioningNodeId: referenceGraph.conditioningNodeId,
      referenceSubgraphDefinitionId: referenceGraph.definitionId,
      referenceSubgraphInstanceId: referenceGraph.instanceId,
      primaryReferenceNodeId:
        (referenceGraph.referenceNodes.find(({ reference }) => reference.required) || referenceGraph.referenceNodes[0])?.node.id || null
    }
  };

  const executionGraph = flattenStoryboardWorkflowGraph(graph);
  assertKreaStillsCompilation(graph, executionGraph, frame);

  return {
    graph,
    executionGraph,
    frame,
    prompt,
    filenamePrefix,
    resolution,
    seed,
    references,
    sourceWorkflowPath: SOURCE_WORKFLOW_PATH,
    sourceWorkflowHash: graph.extra.premiere316.sourceWorkflowHash,
    workflowHash: hashJson(graph)
  };
}

async function buildStoryboardFrameWorkflowWithUploadedReferences(project, storyboard, frameId) {
  const frame = findFrame(storyboard, frameId);
  const uploadedReferences = await uploadStoryboardReferenceImages(project, frame);
  return buildStoryboardFrameWorkflowGraph(project, storyboard, frameId, { uploadedReferences });
}

function writeStoryboardFrameWorkflow(slug, frameId, built) {
  const workflowName = `${safePart(slug)}__${safePart(frameId)}.json`;
  const workflowFile = path.join(PUSH_WORKFLOW_DIR, workflowName);
  writeJsonAtomic(workflowFile, built.graph);
  return { workflowName, workflowFile };
}

export function storyboardFrameGenerationFingerprint(frame, workflowHash) {
  return hashJson({
    frameId: frame.id,
    purpose: frame.purpose,
    ownerKind: frame.ownerKind,
    ownerId: frame.ownerId,
    prompt: frame.prompt || "",
    negativePrompt: frame.negativePrompt || "",
    references: (frame.references || []).map((reference) => ({
      id: reference.id,
      assetId: reference.assetId,
      assetVersion: reference.assetVersion,
      sourceAssetFile: reference.sourceAssetFile,
      sourceAssetSha256: reference.sourceAssetSha256,
      sourceAssetBytes: reference.sourceAssetBytes,
      sourceGenerationFingerprint: reference.sourceGenerationFingerprint,
      sourceVersionFingerprint: reference.sourceVersionFingerprint,
      sourceApprovalFingerprint: reference.sourceApprovalFingerprint,
      role: reference.role,
      cropRegion: reference.cropRegion,
      notes: reference.notes,
      required: reference.required !== false,
      useMode: reference.useMode
    })),
    expectedInputPath: frame.expectedInputPath || null,
    workflowId: STORYBOARD_KREA_WORKFLOW_ID,
    workflowHash
  });
}

export async function compileStoryboardFramePrompt(project, storyboard, frameId) {
  const built = await buildStoryboardFrameWorkflowWithUploadedReferences(project, storyboard, frameId);
  const objectInfo = await getObjectInfo();
  const missing = missingRuntimeClasses(built.executionGraph, objectInfo);
  if (missing.length) {
    throw new Error(`Storyboard Krea workflow is missing ComfyUI node classes: ${missing.join(", ")}`);
  }
  const converted = graphToApi({ nodes: built.executionGraph.nodes, links: built.executionGraph.links }, objectInfo);
  if (converted.warnings?.length) {
    throw new Error(`Storyboard Krea workflow could not compile cleanly: ${converted.warnings.join("; ")}`);
  }
  normalizeStoryboardApiPrompt(converted.prompt, built.seed);
  assertStillsApiPromptRejectsMinimax(converted.prompt);
  const inputErrors = validateApiPromptRequiredInputs(converted.prompt, objectInfo);
  if (inputErrors.length) {
    throw new Error(
      `Storyboard Krea workflow is missing required API inputs after conversion: ${inputErrors.join(", ")}`
    );
  }
  return {
    ...built,
    apiPrompt: converted.prompt
  };
}

export async function pushStoryboardFrameToComfyUI(slug, frameId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = await buildStoryboardFrameWorkflowWithUploadedReferences(project, storyboard, frameId);
  const { workflowName, workflowFile } = writeStoryboardFrameWorkflow(slug, frameId, built);
  return {
    ok: true,
    frameId,
    workflowId: STORYBOARD_KREA_WORKFLOW_ID,
    workflowName,
    workflowFile,
    workflowLibraryFolder: PUSH_WORKFLOW_DIR,
    sourceWorkflowPath: built.sourceWorkflowPath,
    sourceWorkflowHash: built.sourceWorkflowHash,
    workflowHash: built.workflowHash,
    referenceCount: built.references.length,
    filenamePrefix: built.filenamePrefix,
    resolution: built.resolution,
    seed: built.seed
  };
}

export async function pushAllStoryboardFrameWorkflowsToComfyUI(slug) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const allFrames = Object.values(storyboard.frames || {}).sort((left, right) => left.id.localeCompare(right.id));
  const frames = allFrames.filter((frame) => (frame.references || []).length > 0);
  const uploadCache = new Map();
  const workflows = [];
  for (const frame of frames) {
    const uploadedReferences = await uploadStoryboardReferenceImages(project, frame, uploadCache);
    const built = buildStoryboardFrameWorkflowGraph(project, storyboard, frame.id, { uploadedReferences });
    const written = writeStoryboardFrameWorkflow(slug, frame.id, built);
    workflows.push({
      frameId: frame.id,
      workflowName: written.workflowName,
      workflowFile: written.workflowFile,
      workflowHash: built.workflowHash,
      referenceCount: built.references.length,
      filenamePrefix: built.filenamePrefix,
      resolution: built.resolution,
      seed: built.seed
    });
  }
  return {
    ok: true,
    projectSlug: slug,
    workflowId: STORYBOARD_KREA_WORKFLOW_ID,
    workflowCount: workflows.length,
    skippedFrameCount: allFrames.length - frames.length,
    totalFrameCount: allFrames.length,
    uniqueReferenceFilesUploaded: uploadCache.size,
    workflowLibraryFolder: PUSH_WORKFLOW_DIR,
    workflows
  };
}

export async function downloadStoryboardFrameWorkflow(slug, frameId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = await buildStoryboardFrameWorkflowWithUploadedReferences(project, storyboard, frameId);
  return {
    ...built,
    workflowName: `${safePart(slug)}__${safePart(frameId)}.json`
  };
}

export function markStoryboardFrameQueued(slug, frameId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = buildStoryboardFrameWorkflowGraph(project, storyboard, frameId);
  const generationFingerprint = storyboardFrameGenerationFingerprint(built.frame, built.workflowHash);
  const next = structuredClone(storyboard);
  const target = findFrame(next, frameId);
  target.status = "queued";
  target.lastError = null;
  target.generationWorkflowId = STORYBOARD_KREA_WORKFLOW_ID;
  target.generationWorkflowHash = built.workflowHash;
  target.generationFingerprint = generationFingerprint;
  target.generationQueuedAt = new Date().toISOString();
  target.generationSeed = built.seed;
  target.generationResolution = built.resolution;
  saveStoryboard(slug, next);
  return {
    project,
    storyboard: next,
    frame: target,
    workflowHash: built.workflowHash,
    generationFingerprint,
    seed: built.seed,
    resolution: built.resolution,
    filenamePrefix: built.filenamePrefix
  };
}

export function restoreStoryboardFrameAfterCancellation(slug, frameId) {
  if (!slug || !frameId) return null;
  const storyboard = loadStoryboard(slug);
  const next = structuredClone(storyboard);
  const frame = findFrame(next, frameId);
  frame.status = frame.generatedAssetVersionId ? "generated" : "ready_to_generate";
  frame.lastError = null;
  frame.generationQueuedAt = null;
  saveStoryboard(slug, next);
  return next;
}

export async function generateStoryboardFrameJob(job) {
  const project = loadProject(job.projectSlug);
  const storyboard = loadStoryboard(job.projectSlug);
  const compiled = await compileStoryboardFramePrompt(project, storyboard, job.refs.frameId);
  assertStillsJobCompiledPrompt(compiled);
  const fingerprint = storyboardFrameGenerationFingerprint(compiled.frame, compiled.workflowHash);
  if (job.refs?.generationFingerprint && job.refs.generationFingerprint !== fingerprint) {
    throw new Error("Storyboard image job cancelled because the frame prompt, references, or workflow changed after queueing");
  }

  job.label = `Generate storyboard image · ${compiled.frame.ownerId || compiled.frame.id}`;
  job.stage = "Generating Krea 2 storyboard image guide";
  job.progress = 0.04;

  const outputs = await runPrompt(compiled.apiPrompt, {
    signal: job.signal,
    onProgress: ({ value, max }) => {
      if (max) job.progress = Math.min(0.9, 0.08 + (value / max) * 0.82);
    }
  });
  const refs = collectOutputFiles(outputs);
  if (!refs.length) throw new Error("ComfyUI completed without a storyboard image file");

  const fresh = loadStoryboard(job.projectSlug);
  const freshProject = loadProject(job.projectSlug);
  const latest = buildStoryboardFrameWorkflowGraph(freshProject, fresh, job.refs.frameId);
  const latestFingerprint = storyboardFrameGenerationFingerprint(latest.frame, latest.workflowHash);
  if (latestFingerprint !== fingerprint) {
    throw new Error("Storyboard image output was retained but not registered because the frame changed during generation");
  }

  const version = nextGeneratedVersion(latest.frame);
  const destination = mediaDir(freshProject, "storyboard");
  fs.mkdirSync(destination, { recursive: true });
  const files = [];
  for (let index = 0; index < refs.length; index += 1) {
    const suffix = refs.length === 1 ? "" : `-${index + 1}`;
    files.push(await downloadOutput(refs[index], destination, `${destinationBase(latest.frame)}.v${version}${suffix}`));
  }

  const next = structuredClone(fresh);
  const target = findFrame(next, job.refs.frameId);
  target.generatedVersions = Array.isArray(target.generatedVersions) ? target.generatedVersions : [];
  target.generatedVersions.push({
    v: version,
    files,
    file: files[0],
    mediaType: "image",
    workflowId: STORYBOARD_KREA_WORKFLOW_ID,
    workflowHash: latest.workflowHash,
    workflowSource: SOURCE_WORKFLOW_NAME,
    sourceWorkflowHash: latest.sourceWorkflowHash,
    generationFingerprint: fingerprint,
    prompt: latest.prompt,
    promptHash: crypto.createHash("sha256").update(latest.prompt).digest("hex"),
    seed: latest.seed,
    resolution: latest.resolution,
    filenamePrefix: latest.filenamePrefix,
    fileHashes: generatedFileHashes(freshProject, files),
    createdAt: new Date().toISOString()
  });
  target.activeGeneratedVersion = version;
  target.generatedFile = files[0];
  target.generatedInputPath = `media/storyboard/${files[0]}`;
  target.generatedAssetId = target.id;
  target.generatedAssetVersionId = `${target.id}:v${version}`;
  target.inputHash = fingerprint;
  target.status = "generated";
  target.lastError = null;
  target.generationCompletedAt = new Date().toISOString();
  saveStoryboard(job.projectSlug, next);
  job.result = {
    frameId: target.id,
    files,
    version,
    workflowHash: latest.workflowHash,
    generationFingerprint: fingerprint
  };
  job.progress = 0.98;
}

export function markStoryboardFrameGenerationFailed(slug, frameId, error) {
  if (!slug || !frameId) return null;
  const storyboard = loadStoryboard(slug);
  const next = structuredClone(storyboard);
  const frame = findFrame(next, frameId);
  frame.status = frame.generatedAssetVersionId ? "generated" : "ready_to_generate";
  frame.lastError = String(error?.message || error);
  frame.generationFailedAt = new Date().toISOString();
  saveStoryboard(slug, next);
  return next;
}

function t2vFilenamePrefix(project, clip) {
  return `Premiere316/${safePart(project.slug)}/storyboard/${safePart(clip.id)}`;
}

function t2vDestinationBase(clip) {
  return safePart(clip.id, "storyboard-video", 96);
}

function setT2vVideoCombine(graph, { fps, filenamePrefix }) {
  const node = findNode(graph, 5928);
  if (!node) throw new Error("Storyboard LTX-2.5 T2V workflow is missing final video node 5928");
  node.widgets_values = {
    ...(node.widgets_values && !Array.isArray(node.widgets_values) ? node.widgets_values : {}),
    frame_rate: fps,
    loop_count: 0,
    filename_prefix: filenamePrefix,
    format: "video/h264-mp4",
    pix_fmt: "yuv420p",
    crf: 19,
    save_metadata: true,
    trim_to_audio: false,
    pingpong: false,
    save_output: true
  };
}

function setRequiredT2vNodeWidget(graph, nodeId, index, value) {
  const node = setWidgetValue(graph, nodeId, index, value);
  if (!node) throw new Error(`Storyboard LTX-2.5 T2V workflow is missing required node ${nodeId}`);
  return node;
}

function assertT2vGraphContract(graph) {
  for (const nodeId of [5905, 5955, 5956]) {
    const node = findNode(graph, nodeId);
    if (!node || node.widgets_values?.[0] !== false) {
      throw new Error(`Storyboard LTX-2.5 T2V workflow temporal-image control ${nodeId} is not explicitly off`);
    }
  }
  const resolver = findNode(graph, 5902);
  if (!resolver || resolver.type !== "Premiere316AssetResolver") {
    throw new Error("Storyboard LTX-2.5 T2V workflow is missing its canonical semantic-reference resolver");
  }
  const finalVideo = findNode(graph, 5928);
  if (!finalVideo || finalVideo.type !== "VHS_VideoCombine") {
    throw new Error("Storyboard LTX-2.5 T2V workflow is missing its final video output");
  }
  const referenceSheet = findNode(graph, 5915);
  const icLoader = findNode(graph, 5914);
  const icGuide = findNode(graph, 5919);
  if (referenceSheet?.type !== "Premiere316ReferenceSheetBuilder"
    || icLoader?.type !== "LTXICLoRALoaderModelOnly"
    || icGuide?.type !== "LTXAddVideoICLoRAGuide") {
    throw new Error("Storyboard LTX-2.5 T2V workflow is missing its Ingredients IC-LoRA conditioning branch");
  }
}

function requiredApiNode(prompt, id, classType) {
  const node = prompt[String(id)];
  if (!node || node.class_type !== classType) {
    throw new Error(`Storyboard LTX-2.5 T2V compiled prompt is missing ${classType} node ${id}`);
  }
  node.inputs ||= {};
  return node;
}

function enableLtx25IngredientsConditioning(apiPrompt, built) {
  const { settings } = built;
  const model = requiredApiNode(apiPrompt, 5801, "UNETLoader");
  const videoVae = requiredApiNode(apiPrompt, 5800, "VAELoader");
  const audioVae = requiredApiNode(apiPrompt, 5799, "VAELoader");
  const clip = requiredApiNode(apiPrompt, 5802, "CLIPLoader");
  const master = requiredApiNode(apiPrompt, 5900, "Premiere316LTXMasterControls");
  const resolver = requiredApiNode(apiPrompt, 5902, "Premiere316AssetResolver");
  const promptBuilder = requiredApiNode(apiPrompt, 5903, "Premiere316LTXPromptBuilder");
  const nativeNegative = requiredApiNode(apiPrompt, 5812, "DenoLTXPromptGuide");
  const icLoader = requiredApiNode(apiPrompt, 5914, "LTXICLoRALoaderModelOnly");
  const sheet = requiredApiNode(apiPrompt, 5915, "Premiere316ReferenceSheetBuilder");
  const promptGuide = requiredApiNode(apiPrompt, 5916, "DenoLTXPromptGuide");
  const videoLatent = requiredApiNode(apiPrompt, 5917, "EmptyLTXVLatentVideo");
  const audioLatent = requiredApiNode(apiPrompt, 5918, "LTXVEmptyLatentAudio");
  const icGuide = requiredApiNode(apiPrompt, 5919, "LTXAddVideoICLoRAGuide");
  const director = requiredApiNode(apiPrompt, 5960, "LTXDirector");
  const relayConditioning = requiredApiNode(apiPrompt, 5961, "LTXVConditioning");
  const cfgGuider = requiredApiNode(apiPrompt, 5941, "CFGGuider");
  const videoVaeSwitch = requiredApiNode(apiPrompt, 5911, "LazySwitchKJ");
  const audioVaeSwitch = requiredApiNode(apiPrompt, 5912, "LazySwitchKJ");
  const imageSwitch = requiredApiNode(apiPrompt, 5921, "LazySwitchKJ");
  const generatedAudioSwitch = requiredApiNode(apiPrompt, 5922, "LazySwitchKJ");
  const videoDecode = requiredApiNode(apiPrompt, 5948, "LTXVTiledVAEDecode");
  const audioDecode = requiredApiNode(apiPrompt, 5949, "LTXVAudioVAEDecode");
  const finalScale = requiredApiNode(apiPrompt, 5936, "ImageScale");
  const finalVideo = requiredApiNode(apiPrompt, 5928, "VHS_VideoCombine");

  if (!built.references.length) {
    // A package plan that explicitly declares referenceCount=0 is pure native
    // T2V. Keep every lazy branch on the native LTX-2.5 path and prevent the
    // resolver from inferring visual assets merely because their names occur
    // in the authored text prompt.
    master.inputs.reference_mode = T2V_NATIVE_MODE;
    promptBuilder.inputs.reference_mode = T2V_NATIVE_MODE;
    resolver.inputs.max_references = 0;
    resolver.inputs.strict_mode = false;
    resolver.inputs.explicit_references = "";
    videoVaeSwitch.inputs.switch = false;
    audioVaeSwitch.inputs.switch = false;
    imageSwitch.inputs.switch = false;
    generatedAudioSwitch.inputs.switch = false;
    finalScale.inputs.width = settings.width;
    finalScale.inputs.height = settings.height;
    finalVideo.inputs.frame_rate = settings.fps;
    return {
      expected: 0,
      resolved: 0,
      injected: 0,
      adapter: null,
      model: model.inputs.unet_name,
      clip: clip.inputs.clip_name,
      videoVae: videoVae.inputs.vae_name,
      audioVae: audioVae.inputs.vae_name,
      resolverNodeId: "5902",
      sheetNodeId: null,
      guideNodeId: null,
      promptRelayNodeId: "5960",
      segmentCount: built.promptRelay.segmentCount,
      segmentLengths: built.promptRelay.segmentLengths
    };
  }

  // Select the lazy Ingredients output without loading the legacy LTX-2.3
  // preset. Every actual dependency is redirected to the native LTX-2.5
  // transformer, projected Gemma 4 CLIP, and LTX-2.5 AV VAEs.
  master.inputs.reference_mode = T2V_INGREDIENTS_SWITCH_MODE;
  master.inputs.duration_seconds = settings.durationSeconds;
  master.inputs.fps = settings.fps;
  master.inputs.width = settings.width;
  master.inputs.height = settings.height;
  master.inputs.seed = settings.seed;
  promptBuilder.inputs.reference_mode = T2V_INGREDIENTS_SWITCH_MODE;
  promptBuilder.inputs.duration_seconds = settings.durationSeconds;
  promptBuilder.inputs.fps = settings.fps;
  promptBuilder.inputs.width = settings.width;
  promptBuilder.inputs.height = settings.height;

  icLoader.inputs.model = ["5801", 0];
  icLoader.inputs.lora_name = T2V_INGREDIENTS_LORA;
  icLoader.inputs.strength_model = 1.0;
  sheet.inputs.reference_set = ["5902", 1];
  sheet.inputs.width = settings.width;
  sheet.inputs.height = settings.height;
  sheet.inputs.frame_count = settings.generationFrames;
  promptGuide.inputs.clip = ["5802", 0];
  promptGuide.inputs.frame_rate = settings.fps;
  videoLatent.inputs.width = settings.width;
  videoLatent.inputs.height = settings.height;
  videoLatent.inputs.length = settings.generationFrames;
  audioLatent.inputs.audio_vae = ["5799", 0];
  audioLatent.inputs.frames_number = settings.generationFrames;
  audioLatent.inputs.frame_rate = settings.fps;
  icGuide.inputs.vae = ["5800", 0];
  icGuide.inputs.image = ["5915", 1];
  icGuide.inputs.strength = 1.0;
  icGuide.inputs.crop = "center";
  icGuide.inputs.use_tiled_encode = settings.generationFrames > 121;

  // The semantic-reference branch must retain the exact Premiere segment
  // schedule. The previous graph encoded one long string through node 5916,
  // bypassing LTXDirector entirely, so the first authored action dominated the
  // whole clip. Feed the IC-LoRA-patched model and base latent through Director
  // first, then add the static Ingredients guide to its scheduled conditioning.
  director.inputs.model = ["5914", 0];
  director.inputs.clip = ["5802", 0];
  director.inputs.optional_latent = ["5917", 0];
  director.inputs.global_prompt = built.promptRelay.globalPrompt;
  director.inputs.start_second = 0;
  director.inputs.end_second = settings.durationSeconds;
  director.inputs.duration_seconds = settings.durationSeconds;
  director.inputs.start_frame = 0;
  director.inputs.end_frame = settings.authoredFrames;
  director.inputs.duration_frames = settings.authoredFrames;
  director.inputs.timeline_data = JSON.stringify(built.promptRelay.timelineData);
  director.inputs.local_prompts = built.promptRelay.localPrompts;
  director.inputs.segment_lengths = built.promptRelay.segmentLengths;
  director.inputs.epsilon = 0.001;
  director.inputs.guide_strength = "";
  director.inputs.use_custom_audio = false;
  director.inputs.use_custom_motion = false;
  director.inputs.inpaint_audio = false;
  director.inputs.frame_rate = settings.fps;
  director.inputs.custom_width = settings.width;
  director.inputs.custom_height = settings.height;
  relayConditioning.inputs.positive = ["5960", 1];
  relayConditioning.inputs.negative = ["5812", 1];
  relayConditioning.inputs.frame_rate = ["5960", 6];
  icGuide.inputs.positive = ["5961", 0];
  icGuide.inputs.negative = ["5961", 1];
  icGuide.inputs.latent = ["5960", 2];
  cfgGuider.inputs.model = ["5960", 0];
  cfgGuider.inputs.positive = ["5919", 0];
  cfgGuider.inputs.negative = ["5919", 1];
  videoDecode.inputs.vae = ["5800", 0];
  audioDecode.inputs.audio_vae = ["5799", 0];

  // These switches remain lazy. Their true branches now point only to native
  // LTX-2.5 dependencies and the IC-conditioned output.
  videoVaeSwitch.inputs.on_true = ["5800", 0];
  audioVaeSwitch.inputs.on_true = ["5799", 0];
  imageSwitch.inputs.switch = true;
  generatedAudioSwitch.inputs.switch = true;
  finalScale.inputs.width = settings.width;
  finalScale.inputs.height = settings.height;
  finalVideo.inputs.frame_rate = settings.fps;

  // Keep these bindings explicit so future workflow edits cannot silently
  // downgrade the reference path back to prompt-text-only behavior.
  if (icLoader.inputs.model[0] !== "5801"
    || promptGuide.inputs.clip[0] !== "5802"
    || nativeNegative.inputs.clip[0] !== "5802"
    || icGuide.inputs.image[0] !== "5915"
    || sheet.inputs.reference_set[0] !== "5902"
    || director.inputs.model[0] !== "5914"
    || director.inputs.optional_latent[0] !== "5917"
    || icGuide.inputs.positive[0] !== "5961"
    || icGuide.inputs.latent[0] !== "5960"
    || cfgGuider.inputs.model[0] !== "5960") {
    throw new Error("Storyboard semantic references were resolved but not injected into the LTX-2.5 IC-LoRA branch");
  }
  const compiledSegments = String(director.inputs.local_prompts || "").split("|").map((item) => item.trim()).filter(Boolean);
  const compiledLengths = String(director.inputs.segment_lengths || "").split(",").map((item) => Number(item.trim()));
  if (compiledSegments.length !== built.promptRelay.segmentCount
    || compiledLengths.length !== built.promptRelay.segmentCount
    || compiledLengths.some((value) => !Number.isInteger(value) || value < 1)
    || compiledLengths.reduce((sum, value) => sum + value, 0) !== settings.authoredFrames) {
    throw new Error("Storyboard Prompt Relay schedule was lost while compiling the LTX-2.5 IC-LoRA branch");
  }

  return {
    expected: built.references.length,
    resolved: built.references.length,
    injected: built.references.length,
    adapter: T2V_INGREDIENTS_LORA,
    model: model.inputs.unet_name,
    clip: clip.inputs.clip_name,
    videoVae: videoVae.inputs.vae_name,
    audioVae: audioVae.inputs.vae_name,
    resolverNodeId: "5902",
    sheetNodeId: "5915",
    guideNodeId: "5919",
    promptRelayNodeId: "5960",
    segmentCount: built.promptRelay.segmentCount,
    segmentLengths: built.promptRelay.segmentLengths
  };
}

export function buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId, options = {}) {
  const { videoPlan, clip } = findVideoPlan(storyboard, videoPlanId);
  assertTextOnlyT2vPlan(storyboard, videoPlan, clip);
  const audioPlan = options.requireRunnableAudio ? assertRunnableT2vAudio(videoPlan, clip) : t2vAudioPlan(videoPlan, clip);
  const referenceState = resolveT2vReferences(project, storyboard, videoPlan, clip);
  const settings = t2vPlanSettings(storyboard, videoPlan, clip);
  const prompt = String(videoPlan.globalPrompt || "").trim();
  if (!prompt) throw new Error(`Storyboard video plan ${videoPlan.id} has no T2V globalPrompt`);
  const promptRelay = t2vPromptRelaySchedule(storyboard, videoPlan, clip, settings);
  const negativePrompt = String(videoPlan.negativePrompt || "").trim();
  const filenamePrefix = t2vFilenamePrefix(project, clip);
  const explicitReferences = referenceState.references.map((reference) => reference.canonical).join("\n");
  const hasSemanticReferences = referenceState.references.length > 0;
  const graph = structuredClone(loadT2vSourceWorkflowGraph());

  const master = findNode(graph, 5900);
  if (!master) throw new Error("Storyboard LTX-2.5 T2V workflow is missing master controls node 5900");
  master.widgets_values = [
    T2V_NATIVE_MODE,
    settings.durationSeconds,
    settings.fps,
    T2V_CUSTOM_ASPECT,
    settings.width,
    settings.height,
    settings.seed,
    settings.latentX2,
    T2V_NO_ADAPTER
  ];
  master.title = `T2V MASTER — ${settings.width}x${settings.height} · ${settings.fps} fps · ${settings.authoredFrames} authored frames`;

  setRequiredT2vNodeWidget(graph, 5901, 0, prompt);
  const resolver = findNode(graph, 5902);
  if (!resolver) throw new Error("Storyboard LTX-2.5 T2V workflow is missing asset resolver node 5902");
  resolver.widgets_values = [
    prompt,
    referenceState.root.absolute,
    hasSemanticReferences ? referenceState.maxReferences : 0,
    hasSemanticReferences,
    false,
    "asset_index.json",
    explicitReferences
  ];
  resolver.title = hasSemanticReferences
    ? `SEMANTIC REFERENCES — ${referenceState.references.length}/${referenceState.maxReferences} exact canonical files`
    : "PURE NATIVE T2V — no semantic references declared";

  const audioInstruction = String(audioPlan.instruction || audioPlan.dialogueText || clip.dialogueAnchor || "").trim();
  const generatedAudioReady = (audioPlan.mode || videoPlan.audioMode || "generated_ambience") === "generated_ambience";
  const workflowAudioMode = generatedAudioReady ? "Generated Audio" : "Custom Replace";
  const promptBuilder = findNode(graph, 5903);
  if (!promptBuilder) throw new Error("Storyboard LTX-2.5 T2V workflow is missing prompt builder node 5903");
  promptBuilder.widgets_values = [
    prompt,
    "",
    T2V_NATIVE_MODE,
    settings.durationSeconds,
    settings.fps,
    settings.width,
    settings.height,
    workflowAudioMode,
    "",
    audioInstruction,
    audioInstruction,
    "",
    "",
    Boolean(negativePrompt),
    negativePrompt
  ];

  const director = findNode(graph, 5960);
  if (!director || director.type !== "LTXDirector") {
    throw new Error("Storyboard LTX-2.5 T2V workflow is missing LTX Director node 5960");
  }
  const directorTimeline = JSON.stringify(promptRelay.timelineData);
  const directorWidgets = Array.isArray(director.widgets_values) ? [...director.widgets_values] : [];
  directorWidgets[0] = 0;
  directorWidgets[1] = settings.durationSeconds;
  directorWidgets[2] = settings.durationSeconds;
  directorWidgets[3] = 0;
  directorWidgets[4] = settings.authoredFrames;
  directorWidgets[5] = settings.authoredFrames;
  directorWidgets[6] = directorTimeline;
  directorWidgets[7] = promptRelay.localPrompts;
  directorWidgets[8] = promptRelay.segmentLengths;
  directorWidgets[9] = 0.001;
  directorWidgets[10] = "";
  directorWidgets[11] = false;
  directorWidgets[12] = false;
  directorWidgets[13] = false;
  directorWidgets[14] = settings.fps;
  directorWidgets[15] = "seconds";
  directorWidgets[16] = settings.width;
  directorWidgets[17] = settings.height;
  director.widgets_values = directorWidgets;
  director.properties = {
    ...(director.properties || {}),
    global_prompt: promptRelay.globalPrompt,
    local_prompts: promptRelay.localPrompts,
    segment_lengths: promptRelay.segmentLengths,
    timeline_data: directorTimeline,
    epsilon: 0.001,
    start_second: 0,
    end_second: settings.durationSeconds,
    duration_seconds: settings.durationSeconds,
    start_frame: 0,
    end_frame: settings.authoredFrames,
    duration_frames: settings.authoredFrames,
    frame_rate: settings.fps,
    custom_width: settings.width,
    custom_height: settings.height,
    use_custom_audio: false,
    use_custom_motion: false,
    inpaint_audio: false,
    has_serialized_properties: true
  };
  director.title = `LTX DIRECTOR — ${promptRelay.segmentCount} scheduled prompts · ${promptRelay.segmentLengths}`;

  const audioModeControl = setRequiredT2vNodeWidget(graph, 5904, 0, workflowAudioMode);
  if (generatedAudioReady) {
    audioModeControl.title = "AUDIO MODE — Generated Audio";
  } else {
    audioModeControl.title = `AUDIO BLOCKED — ${audioPlan.mode}: install authoritative clip audio before Generate`;
  }
  setRequiredT2vNodeWidget(graph, 5905, 0, false);
  setRequiredT2vNodeWidget(graph, 5955, 0, false);
  setRequiredT2vNodeWidget(graph, 5956, 0, false);
  const customAudioGate = findNode(graph, 5964);
  if (customAudioGate?.type === "LazySwitchKJ") {
    // Keep both inputs structurally valid. LazySwitchKJ evaluates only the
    // branch selected by Premiere316AudioModeControl, so Generated Audio does
    // not open the custom WAV while Custom Replace/Mix can still opt into it.
    customAudioGate.mode = 0;
    const customAudioLoader = findNode(graph, 5923);
    if (customAudioLoader) customAudioLoader.mode = 0;
  } else {
    // Compatibility with older tracked workflows that predate the lazy gate.
    disconnectInput(graph, 5924, "master_custom_track");
    const unusedCustomAudio = findNode(graph, 5923);
    if (unusedCustomAudio) unusedCustomAudio.mode = 4;
  }
  setT2vVideoCombine(graph, { fps: settings.fps, filenamePrefix });
  assertT2vGraphContract(graph);

  const sourceHash = t2vSourceWorkflowHash();
  const referenceHash = hashJson(referenceState.references.map(({ canonical, sha256 }) => ({ canonical, sha256 })));
  graph.extra = {
    ...(graph.extra || {}),
    premiere316: {
      type: "storyboard-t2v-video-plan",
      workflowId: STORYBOARD_T2V_WORKFLOW_ID,
      projectSlug: project.slug,
      clipId: clip.id,
      videoPlanId: videoPlan.id,
      generationMode: T2V_GENERATION_MODE,
      workflowProfileId: T2V_WORKFLOW_PROFILE,
      promptHash: crypto.createHash("sha256").update(prompt).digest("hex"),
      negativePromptHash: crypto.createHash("sha256").update(negativePrompt).digest("hex"),
      sourceWorkflow: T2V_SOURCE_WORKFLOW_NAME,
      sourceWorkflowHash: sourceHash,
      filenamePrefix,
      settings,
      referenceRoot: referenceState.root.declared,
      referenceRootAbsolute: referenceState.root.absolute,
      referenceIndex: path.basename(referenceState.indexPath),
      referenceIndexHash: referenceState.indexHash,
      referenceHash,
      references: referenceState.references,
      semanticReferenceConditioning: hasSemanticReferences ? T2V_REFERENCE_CONDITIONING : "none",
      visualReferenceAdapter: hasSemanticReferences ? T2V_INGREDIENTS_LORA : null,
      visualReferenceRuntimePatch: hasSemanticReferences ? "compiled-api-v1" : null,
      temporalGuides: {
        firstFrame: false,
        lastFrame: false,
        timedImages: false
      },
      promptRelay: {
        nodeId: 5960,
        segmentCount: promptRelay.segmentCount,
        segmentLengths: promptRelay.segmentLengths,
        authoredFrames: promptRelay.authoredFrames,
        globalPromptHash: crypto.createHash("sha256").update(promptRelay.globalPrompt).digest("hex")
      },
      audioMode: audioPlan.mode || videoPlan.audioMode || "generated_ambience",
      audioRunnable: generatedAudioReady,
      audioBlocker: generatedAudioReady ? null : String(audioPlan.instruction || "Authoritative external audio is required")
    }
  };

  const executionGraph = flattenStoryboardWorkflowGraph(graph);
  assertLtxVideoPlanIsNotStillsGenerator(graph);
  return {
    graph,
    executionGraph,
    videoPlan,
    clip,
    prompt,
    negativePrompt,
    filenamePrefix,
    settings,
    promptRelay,
    references: referenceState.references,
    referenceRoot: referenceState.root.absolute,
    referenceIndexHash: referenceState.indexHash,
    referenceHash,
    audioPlan,
    sourceWorkflowPath: T2V_SOURCE_WORKFLOW_PATH,
    sourceWorkflowHash: sourceHash,
    workflowHash: hashJson(graph)
  };
}

function writeStoryboardVideoPlanWorkflow(slug, videoPlanId, built) {
  const workflowName = `${safePart(slug)}__${safePart(videoPlanId)}__t2v.json`;
  const workflowFile = path.join(PUSH_WORKFLOW_DIR, workflowName);
  writeJsonAtomic(workflowFile, built.graph);
  return { workflowName, workflowFile };
}

export function storyboardVideoPlanGenerationFingerprint(videoPlan, clip, built) {
  return hashJson({
    videoPlanId: videoPlan.id,
    clipId: clip.id,
    workflowId: STORYBOARD_T2V_WORKFLOW_ID,
    workflowHash: built.workflowHash,
    sourceWorkflowHash: built.sourceWorkflowHash,
    prompt: built.prompt,
    negativePrompt: built.negativePrompt,
    settings: built.settings,
    referenceIndexHash: built.referenceIndexHash,
    referenceHash: built.referenceHash,
    audioPlan: built.audioPlan
  });
}

export async function compileStoryboardVideoPlanPrompt(project, storyboard, videoPlanId) {
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId, { requireRunnableAudio: true });
  const objectInfo = await getObjectInfo();
  const missing = missingRuntimeClasses(built.executionGraph, objectInfo);
  if (missing.length) {
    throw new Error(`Storyboard LTX-2.5 T2V workflow is not available in the active ComfyUI runtime; missing node classes: ${missing.join(", ")}. Restart only after the render queue is empty.`);
  }
  const converted = graphToApi({ nodes: built.executionGraph.nodes, links: built.executionGraph.links }, objectInfo);
  if (converted.warnings?.length) {
    throw new Error(`Storyboard LTX-2.5 T2V workflow could not compile cleanly: ${converted.warnings.join("; ")}`);
  }
  const referenceConditioning = enableLtx25IngredientsConditioning(converted.prompt, built);
  const inputErrors = validateApiPromptRequiredInputs(converted.prompt, objectInfo);
  if (inputErrors.length) {
    throw new Error(`Storyboard LTX-2.5 T2V workflow is missing required API inputs after conversion: ${inputErrors.join(", ")}`);
  }
  return { ...built, apiPrompt: converted.prompt, referenceConditioning };
}

export async function downloadStoryboardVideoPlanWorkflow(slug, videoPlanId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId);
  return { ...built, workflowName: `${safePart(slug)}__${safePart(videoPlanId)}__t2v.json` };
}

export async function pushStoryboardVideoPlanToComfyUI(slug, videoPlanId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId);
  const written = writeStoryboardVideoPlanWorkflow(slug, videoPlanId, built);
  return {
    ok: true,
    videoPlanId,
    clipId: built.clip.id,
    workflowId: STORYBOARD_T2V_WORKFLOW_ID,
    ...written,
    workflowLibraryFolder: PUSH_WORKFLOW_DIR,
    sourceWorkflowPath: built.sourceWorkflowPath,
    sourceWorkflowHash: built.sourceWorkflowHash,
    workflowHash: built.workflowHash,
    referenceCount: built.references.length,
    filenamePrefix: built.filenamePrefix,
    settings: built.settings
  };
}

export function markStoryboardVideoPlanQueued(slug, videoPlanId) {
  const project = loadProject(slug);
  const storyboard = loadStoryboard(slug);
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId, { requireRunnableAudio: true });
  const generationFingerprint = storyboardVideoPlanGenerationFingerprint(built.videoPlan, built.clip, built);
  const next = structuredClone(storyboard);
  const target = findVideoPlan(next, videoPlanId).videoPlan;
  target.status = "queued";
  target.lastError = null;
  target.generationWorkflowId = STORYBOARD_T2V_WORKFLOW_ID;
  target.generationWorkflowHash = built.workflowHash;
  target.generationFingerprint = generationFingerprint;
  target.generationQueuedAt = new Date().toISOString();
  target.generationSeed = built.settings.seed;
  target.generationSettings = built.settings;
  next.clips[target.clipId].renderStatus = "queued";
  saveStoryboard(slug, next);
  return {
    project,
    storyboard: next,
    videoPlan: target,
    clip: next.clips[target.clipId],
    workflowHash: built.workflowHash,
    generationFingerprint,
    seed: built.settings.seed,
    settings: built.settings,
    filenamePrefix: built.filenamePrefix
  };
}

export function restoreStoryboardVideoPlanAfterCancellation(slug, videoPlanId) {
  if (!slug || !videoPlanId) return null;
  const storyboard = loadStoryboard(slug);
  const next = structuredClone(storyboard);
  const { videoPlan, clip } = findVideoPlan(next, videoPlanId);
  videoPlan.status = videoPlan.generatedVersions?.length ? "generated" : "ready";
  videoPlan.lastError = null;
  videoPlan.generationQueuedAt = null;
  clip.renderStatus = videoPlan.generatedVersions?.length ? "completed" : "not_started";
  saveStoryboard(slug, next);
  return next;
}

export async function generateStoryboardVideoPlanJob(job) {
  const project = loadProject(job.projectSlug);
  const storyboard = loadStoryboard(job.projectSlug);
  const compiled = await compileStoryboardVideoPlanPrompt(project, storyboard, job.refs.videoPlanId);
  const fingerprint = storyboardVideoPlanGenerationFingerprint(compiled.videoPlan, compiled.clip, compiled);
  if (job.refs?.generationFingerprint && job.refs.generationFingerprint !== fingerprint) {
    throw new Error("Storyboard T2V job cancelled because its prompt, semantic references, audio plan, or workflow changed after queueing");
  }

  job.label = `Generate storyboard T2V video · ${compiled.clip.id}`;
  job.stage = "Generating LTX-2.5 text-to-video with Ingredients IC-LoRA references";
  job.progress = 0.04;
  const outputs = await runPrompt(compiled.apiPrompt, {
    signal: job.signal,
    onProgress: ({ value, max }) => {
      if (max) job.progress = Math.min(0.88, 0.08 + (value / max) * 0.8);
    }
  });
  const outputRefs = collectOutputFiles(outputs).filter((ref) => VIDEO_FILE_RE.test(String(ref.filename || "")));
  if (outputRefs.length !== 1) {
    throw new Error(`ComfyUI completed with ${outputRefs.length} video files; exactly one T2V output is required for deterministic registration`);
  }

  const freshProject = loadProject(job.projectSlug);
  const fresh = loadStoryboard(job.projectSlug);
  const latest = buildStoryboardVideoPlanWorkflowGraph(freshProject, fresh, job.refs.videoPlanId, { requireRunnableAudio: true });
  const latestFingerprint = storyboardVideoPlanGenerationFingerprint(latest.videoPlan, latest.clip, latest);
  if (latestFingerprint !== fingerprint) {
    throw new Error("Storyboard T2V output was retained in ComfyUI but not registered because the video plan changed during generation");
  }

  const version = nextGeneratedVersion(latest.videoPlan);
  const destination = mediaDir(freshProject, "storyboard");
  fs.mkdirSync(destination, { recursive: true });
  const base = t2vDestinationBase(latest.clip);
  const rawFile = await downloadOutput(outputRefs[0], destination, `${base}.v${version}.decoded-raw`);
  const finalFile = `${base}.v${version}.mp4`;
  job.stage = `Trimming decoded video to ${latest.settings.authoredFrames} authored frames`;
  job.progress = 0.92;
  await trimVideoToFrames(
    path.join(destination, rawFile),
    path.join(destination, finalFile),
    latest.settings.authoredFrames,
    latest.settings.fps
  );
  try { fs.unlinkSync(path.join(destination, rawFile)); } catch {}

  const next = structuredClone(fresh);
  const { videoPlan: target, clip } = findVideoPlan(next, job.refs.videoPlanId);
  target.generatedVersions = Array.isArray(target.generatedVersions) ? target.generatedVersions : [];
  target.generatedVersions.push({
    v: version,
    files: [finalFile],
    file: finalFile,
    mediaType: "video",
    workflowId: STORYBOARD_T2V_WORKFLOW_ID,
    workflowHash: latest.workflowHash,
    workflowSource: T2V_SOURCE_WORKFLOW_NAME,
    sourceWorkflowHash: latest.sourceWorkflowHash,
    generationFingerprint: fingerprint,
    prompt: latest.prompt,
    promptHash: crypto.createHash("sha256").update(latest.prompt).digest("hex"),
    negativePrompt: latest.negativePrompt,
    seed: latest.settings.seed,
    width: latest.settings.width,
    height: latest.settings.height,
    fps: latest.settings.fps,
    authoredFrames: latest.settings.authoredFrames,
    decodedFrames: latest.settings.generationFrames,
    trimmedDecodedFrames: latest.settings.decodedTrim,
    semanticReferences: latest.references,
    referenceConditioning: compiled.referenceConditioning,
    referenceIndexHash: latest.referenceIndexHash,
    referenceHash: latest.referenceHash,
    filenamePrefix: latest.filenamePrefix,
    fileHashes: generatedFileHashes(freshProject, [finalFile]),
    createdAt: new Date().toISOString()
  });
  target.activeGeneratedVersion = version;
  target.generatedFile = finalFile;
  target.generatedInputPath = `media/storyboard/${finalFile}`;
  target.inputHash = fingerprint;
  target.status = "generated";
  target.lastError = null;
  target.generationCompletedAt = new Date().toISOString();
  clip.renderStatus = "completed";
  clip.generatedVideoPlanVersion = version;
  saveStoryboard(job.projectSlug, next);
  job.result = {
    videoPlanId: target.id,
    clipId: clip.id,
    files: [finalFile],
    version,
    workflowHash: latest.workflowHash,
    generationFingerprint: fingerprint,
    authoredFrames: latest.settings.authoredFrames,
    decodedFrames: latest.settings.generationFrames,
    trimmedDecodedFrames: latest.settings.decodedTrim,
    referenceConditioning: compiled.referenceConditioning
  };
  job.progress = 0.98;
}

export function markStoryboardVideoPlanGenerationFailed(slug, videoPlanId, error) {
  if (!slug || !videoPlanId) return null;
  const storyboard = loadStoryboard(slug);
  const next = structuredClone(storyboard);
  const { videoPlan, clip } = findVideoPlan(next, videoPlanId);
  videoPlan.status = videoPlan.generatedVersions?.length ? "generated" : "ready";
  videoPlan.lastError = String(error?.message || error);
  videoPlan.generationFailedAt = new Date().toISOString();
  clip.renderStatus = videoPlan.generatedVersions?.length ? "completed" : "not_started";
  saveStoryboard(slug, next);
  return next;
}
