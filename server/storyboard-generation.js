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
import { PACKAGE_ROOT } from "./paths.js";
import {
  loadStoryboard,
  saveStoryboard
} from "./storyboard.js";

export const STORYBOARD_KREA_WORKFLOW_ID = "premiere316-storyboard-krea2-reference-subgraphs";

const SOURCE_WORKFLOW_NAME = "storyboard-krea2-reference-subgraphs.ui.json";
const SOURCE_WORKFLOW_PATH = path.join(
  PACKAGE_ROOT,
  "workflows",
  SOURCE_WORKFLOW_NAME
);
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
  return graph;
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

function assetVersionForReference(project, reference) {
  const asset = project.assets?.items?.find((item) => item.id === reference.assetId);
  const version = asset?.versions?.find((item) => Number(item.v) === Number(reference.assetVersion));
  return { asset, version };
}

function storyboardReferenceSourcePath(project, reference) {
  const file = path.basename(String(reference?.sourceAssetFile || ""));
  if (!file) return null;
  const direct = path.join(mediaDir(project, "assets"), file);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  return null;
}

function storyboardReferenceSubfolder(project) {
  return `${COMFY_STORYBOARD_REFERENCE_SUBFOLDER}/${safePart(project.slug)}/assets`;
}

function storyboardReferenceEntries(project, frame, uploaded = new Map()) {
  return (frame.references || [])
    .map((reference, index) => {
      const { asset, version } = assetVersionForReference(project, reference);
      const sourceFile = path.basename(String(reference.sourceAssetFile || version?.file || ""));
      const sourcePath = storyboardReferenceSourcePath(project, { ...reference, sourceAssetFile: sourceFile });
      const subfolder = storyboardReferenceSubfolder(project);
      const fallbackComfyImage = sourceFile ? `${subfolder}/${sourceFile}` : null;
      return {
        id: reference.id,
        order: Number(reference.order) || index + 1,
        assetId: reference.assetId,
        assetName: asset?.name || reference.sourceAssetKey || reference.assetId,
        assetVersion: Number(reference.assetVersion) || 1,
        assetVersionId: reference.assetVersionId || `${reference.assetId}:v${reference.assetVersion || 1}`,
        role: reference.role || "reference",
        required: reference.required !== false,
        useMode: reference.useMode || "direct_conditioning",
        sourceAssetFile: sourceFile,
        sourcePath,
        comfyImage: uploaded.get(reference.id) || fallbackComfyImage,
        cropRegion: reference.cropRegion || null,
        notes: reference.notes || null
      };
    })
    .filter((entry) => entry.sourceAssetFile && entry.comfyImage)
    .sort((left, right) => left.order - right.order || left.assetId.localeCompare(right.assetId));
}

async function uploadStoryboardReferenceImages(project, frame, uploadCache = new Map()) {
  const uploaded = new Map();
  const entries = storyboardReferenceEntries(project, frame);
  const missing = entries.filter((entry) => !entry.sourcePath);
  if (missing.length) {
    throw new Error(
      `Storyboard reference files are missing for ${frame.id}: ${missing
        .map((entry) => `${entry.assetVersionId} (${entry.sourceAssetFile})`)
        .join(", ")}`
    );
  }
  const subfolder = storyboardReferenceSubfolder(project);
  for (const entry of entries) {
    const cacheKey = path.resolve(entry.sourcePath).toLowerCase();
    let comfyImage = uploadCache.get(cacheKey);
    if (!comfyImage) {
      comfyImage = await uploadImage(entry.sourcePath, subfolder);
      uploadCache.set(cacheKey, comfyImage);
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
  const containers = workflowContainers(graph);
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
  const frames = Object.values(storyboard.frames || {}).sort((left, right) => left.id.localeCompare(right.id));
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
