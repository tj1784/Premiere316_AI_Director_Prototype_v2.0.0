import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { COMFY_URL } from "./comfy.js";
import { PACKAGE_ROOT } from "./paths.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const I2V_TEMPLATE = path.resolve(HERE, "templates", "video_ltx2_5_i2v.json");
export const I2V_REL = "video_ltx2_5_i2v.json";
export const HELL_WORKFLOW = I2V_TEMPLATE;
const WORKSPACE_FILE = path.resolve(HERE, "..", "director-webapp", "state", "workspace.local.json");
const WORKFLOW_ROOT = path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "user", "default", "workflows");
const COMFY_INPUT_ROOT = path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "input");
const DOWNLOADS_I2V = path.join(process.env.USERPROFILE || "", "Downloads", "video_ltx2_5_i2v.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeHellPrompt() {
  return I2V_TEMPLATE;
}

function isI2vRel(rel) {
  const raw = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return !raw || raw === I2V_REL || raw.endsWith("/" + I2V_REL) || raw === "server/templates/" + I2V_REL;
}

function isApiPrompt(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (Array.isArray(obj.nodes) || obj.definitions || obj.links) return false;
  const nodes = Object.values(obj).filter((node) => node && typeof node === "object" && typeof node.class_type === "string");
  return nodes.length > 0 && nodes.length === Object.keys(obj).length;
}

export function resolveQueueTemplate(rel) {
  if (isI2vRel(rel)) {
    if (fs.existsSync(I2V_TEMPLATE)) return { abs: I2V_TEMPLATE, rel: I2V_REL };
    if (fs.existsSync(DOWNLOADS_I2V)) return { abs: DOWNLOADS_I2V, rel: I2V_REL };
    throw new Error("video_ltx2_5_i2v.json template not found");
  }
  const raw = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..") || path.isAbsolute(raw) || !raw.toLowerCase().endsWith(".json")) {
    throw new Error("Invalid workflow path");
  }
  const root = path.resolve(WORKFLOW_ROOT);
  const abs = path.resolve(WORKFLOW_ROOT, raw);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("Workflow path escapes library");
  if (!fs.existsSync(abs)) throw new Error("Workflow not found: " + raw);
  return { abs, rel: path.relative(WORKFLOW_ROOT, abs).replace(/\\/g, "/") };
}

export function hellPromptFromWorkspace(body = {}, workspaceOverride = null) {
  const workspace = workspaceOverride || (fs.existsSync(WORKSPACE_FILE) ? readJson(WORKSPACE_FILE) : {});
  const globalText = String(workspace?.timeline?.global_prompt || "").trim();
  const negativePrompt = String(workspace?.settings?.negativePrompt || "").trim();
  const segs = workspace?.timeline?.segments || [];
  const clipId = String(workspace?.premiere?.clipId || "").trim();
  const wanted = String(body.segmentId || workspace?.selectedSegmentId || "").trim();
  const mode = String(body.mode || "selected");
  const chosen = (mode === "segments" ? segs : [segs.find((s) => String(s.id) === wanted) || segs[0]]).filter(Boolean);
  return chosen.map((segment) => {
    const local = String(segment.prompt || segment.localPrompt || "").trim();
    const baseText = globalText && local && local !== globalText ? `${globalText}\n\n${local}` : (globalText || local);
    const dialogueDirection = String(segment.dialogueDirection || "").trim();
    const text = dialogueDirection
      ? `${baseText}\n\nSEGMENT DIALOGUE DIRECTION\n${dialogueDirection}`
      : baseText;
    const fps = Math.max(1, Number(workspace?.settings?.frameRate) || 24);
    const frames = Math.max(0, Number(segment.length) || Number(segment.durationFrames) || 0);
    const seconds = frames ? frames / fps : (Number(segment.durationSec) || 13);
    const imageFile = String(segment.imageFile || segment.projectMediaPath || "").trim();
    return {
      segment,
      clipId,
      segmentNumber: segs.indexOf(segment) + 1,
      text,
      negativePrompt,
      seconds,
      imageFile,
      projectSlug: String(workspace?.premiere?.projectSlug || "").trim(),
      projectMediaPath: String(segment.projectMediaPath || "").trim(),
      projectMediaBytes: Number(segment.projectMediaBytes) || null,
      projectMediaSha256: String(segment.projectMediaSha256 || "").trim().toLowerCase()
    };
  });
}

function safeOutputPart(value, label) {
  const part = String(value || "").trim();
  if (!part || !/^[A-Za-z0-9._-]+$/.test(part)) throw new Error(`Invalid ${label} for ComfyUI output`);
  return part;
}

export function directorSegmentOutputPrefix(job) {
  const projectSlug = safeOutputPart(job?.projectSlug, "Premiere project slug");
  const clipId = safeOutputPart(job?.clipId, "Premiere clip ID");
  const segmentNumber = Number(job?.segmentNumber);
  if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || segmentNumber > 99) {
    throw new Error("Invalid Premiere segment number for ComfyUI output");
  }
  return `Premiere316/${projectSlug}/director/${clipId}/segment_${String(segmentNumber).padStart(2, "0")}_`;
}

function confinedPath(root, relativeFile, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(relativeFile || ""));
  if (resolved === resolvedRoot || !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`${label} escapes its allowed root`);
  }
  return resolved;
}

/**
 * Stage the approved, versioned Premiere storyboard frame under the stable
 * basename expected by the shared H01 API workflow. ComfyUI validates
 * LoadImage filenames before execution, so all jobs are staged before the
 * first prompt is submitted.
 */
export function stageHellSegmentImage(job, options = {}) {
  const segmentId = String(job?.segment?.id || "unknown segment");
  const imageName = path.basename(String(job?.imageFile || job?.projectMediaPath || "").replace(/\\/g, "/").trim());
  if (!imageName || imageName === ".") {
    throw new Error(`${segmentId} has no first-frame image filename`);
  }

  const packageRoot = path.resolve(options.packageRoot || PACKAGE_ROOT);
  const inputRoot = path.resolve(options.inputRoot || COMFY_INPUT_ROOT);
  const destination = confinedPath(inputRoot, imageName, "ComfyUI input image");
  const projectSlug = String(job?.projectSlug || "").trim();
  const projectMediaPath = String(job?.projectMediaPath || "").trim();

  if (projectMediaPath) {
    if (!projectSlug || path.basename(projectSlug) !== projectSlug) {
      throw new Error(`${segmentId} has an invalid Premiere project binding`);
    }
    const projectRoot = confinedPath(path.join(packageRoot, "projects"), projectSlug, "Premiere project");
    const source = confinedPath(projectRoot, projectMediaPath, "Premiere project media");
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`${segmentId} first-frame source is missing: ${projectMediaPath}`);
    }
    const stat = fs.statSync(source);
    const expectedBytes = Number(job?.projectMediaBytes) || 0;
    if (expectedBytes && stat.size !== expectedBytes) {
      throw new Error(`${segmentId} first-frame source size changed: expected ${expectedBytes}, found ${stat.size}`);
    }
    const expectedSha256 = String(job?.projectMediaSha256 || "").trim().toLowerCase();
    let sha256 = null;
    if (expectedSha256) {
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new Error(`${segmentId} has an invalid first-frame SHA-256 binding`);
      }
      sha256 = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
      if (sha256 !== expectedSha256) {
        throw new Error(`${segmentId} first-frame source hash changed`);
      }
    }
    fs.mkdirSync(inputRoot, { recursive: true });
    fs.copyFileSync(source, destination);
    return { imageName, source, destination, staged: true, bytes: stat.size, sha256 };
  }

  if (fs.existsSync(destination) && fs.statSync(destination).isFile()) {
    return { imageName, source: destination, destination, staged: false };
  }
  throw new Error(`${segmentId} first frame is not staged for ComfyUI: ${imageName}`);
}

export function stageHellSegmentImages(jobs, options = {}) {
  return jobs.map((job) => stageHellSegmentImage(job, options));
}

function nodeByIds(prompt, ids) {
  for (const id of ids) {
    if (prompt[id]) return prompt[id];
  }
  return null;
}

function forceEnhanceOff(prompt) {
  const enhance = nodeByIds(prompt, ["398:383", "383"]);
  if (enhance?.inputs) enhance.inputs.value = false;
  for (const node of Object.values(prompt)) {
    const title = String(node?._meta?.title || "").toLowerCase();
    if (node?.class_type === "PrimitiveBoolean" && /enhanc|prompt.?wrap|use.?generat/.test(title) && node.inputs) {
      node.inputs.value = false;
    }
  }
}

function applySubmitSwaps(prompt, text, options = {}) {
  const seconds = Math.max(1, Math.round(Number(options.seconds) || 13));
  const duration = nodeByIds(prompt, ["398:362", "362"]);
  if (duration?.inputs) duration.inputs.value = seconds;
  const primitive = nodeByIds(prompt, ["398:376", "376"]);
  if (primitive?.inputs) primitive.inputs.value = text;
  const negative = nodeByIds(prompt, ["398:373", "373"]);
  const negativePrompt = String(options.negativePrompt || "").trim();
  if (negative?.inputs && negativePrompt) negative.inputs.text = negativePrompt;
  const image = nodeByIds(prompt, ["395", "398:395"]);
  const imageName = path.basename(String(options.imageFile || "").replace(/\\/g, "/").trim());
  if (image?.inputs && imageName) image.inputs.image = imageName;
  const output = nodeByIds(prompt, ["75"])
    || Object.values(prompt).find((node) => node?.class_type === "SaveVideo");
  const filenamePrefix = String(options.filenamePrefix || "").trim();
  if (output?.inputs && filenamePrefix) output.inputs.filename_prefix = filenamePrefix;
  forceEnhanceOff(prompt);
  return { seconds, imageName: imageName || null, filenamePrefix: filenamePrefix || null, durationId: duration ? (prompt["398:362"] ? "398:362" : "362") : null, promptId: primitive ? (prompt["398:376"] ? "398:376" : "376") : null, negativeId: negative ? (prompt["398:373"] ? "398:373" : "373") : null, imageId: image ? (prompt["395"] ? "395" : "398:395") : null, outputId: output === prompt["75"] ? "75" : null, enhanceId: prompt["398:383"] ? "398:383" : (prompt["383"] ? "383" : null) };
}

export async function compileHellPromptOnly(text, options = {}) {
  const resolved = resolveQueueTemplate(options.workflowRel);
  const raw = readJson(resolved.abs);
  if (!isApiPrompt(raw)) {
    throw new Error("Selected workflow is a Comfy UI graph, not an API export. Select video_ltx2_5_i2v.json (API export) or export that workflow in API format.");
  }
  const prompt = structuredClone(raw);
  const swap = applySubmitSwaps(prompt, text, options);
  return {
    prompt,
    nodeCount: Object.keys(prompt).length,
    warnings: [],
    workflow: resolved.rel,
    templateFile: resolved.abs,
    seconds: swap.seconds,
    filenamePrefix: swap.filenamePrefix,
    enhance: false,
    nodes: { prompt: swap.promptId, negative: swap.negativeId, image: swap.imageId, duration: swap.durationId, output: swap.outputId, enhance: swap.enhanceId }
  };
}

export async function queueHellOn8188(text, options = {}) {
  if (!String(text || "").trim()) throw new Error("No Premiere prompt to push");
  const built = await compileHellPromptOnly(text, options);
  const response = await fetch(`${COMFY_URL.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: built.prompt, client_id: crypto.randomUUID() })
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { error: raw }; }
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `${response.status} ${raw.slice(0, 500)}`);
  return {
    ok: true,
    promptId: body.prompt_id,
    number: body.number,
    nodeCount: built.nodeCount,
    promptChars: text.length,
    workflow: built.workflow,
    seconds: built.seconds,
    filenamePrefix: built.filenamePrefix,
    enhance: false
  };
}

export async function queueHellFromPremiere(body = {}) {
  const workflowRel = String(body.workflowRel || body.workflow || I2V_REL).trim() || I2V_REL;
  const jobs = hellPromptFromWorkspace(body);
  if (!jobs.length) throw new Error("No Harrowing segment to push");
  const staged = stageHellSegmentImages(jobs);
  const accepted = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const filenamePrefix = directorSegmentOutputPrefix(job);
    const queued = await queueHellOn8188(job.text, { seconds: job.seconds, negativePrompt: job.negativePrompt, imageFile: staged[index].imageName, filenamePrefix, workflowRel });
    accepted.push({
      ...queued,
      segmentId: job.segment?.id || null,
      imageName: staged[index].imageName
    });
  }
  return {
    ok: true,
    accepted,
    promptId: accepted[0]?.promptId,
    number: accepted[0]?.number,
    segmentId: accepted[0]?.segmentId,
    workflow: accepted[0]?.workflow || workflowRel,
    requestedFrames: 0,
    generationFrames: 0
  };
}
