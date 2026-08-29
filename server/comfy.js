// ComfyUI (BlokeyUI) client: health, object_info cache, graph->API conversion,
// image upload, prompt submission, websocket progress tracking, output download.
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { workflowPath } from "./paths.js";
import { resolveConfiguredComfyUrl } from "./comfy-config.js";

export const COMFY_URL = resolveConfiguredComfyUrl();
process.env.COMFY_URL = COMFY_URL;

let objectInfoCache = null;
let objectInfoAt = 0;

export async function comfyAlive() {
  try {
    const r = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function getComfySystemStats() {
  const response = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ComfyUI system_stats failed: ${response.status}`);
  return response.json();
}

export async function getComfyQueueState() {
  const response = await fetch(`${COMFY_URL}/queue`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`ComfyUI queue failed: ${response.status}`);
  const queue = await response.json();
  return {
    running: Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0,
    pending: Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0,
    raw: queue
  };
}

export async function releaseComfyGpuMemory() {
  const queue = await getComfyQueueState();
  if (queue.running || queue.pending) {
    const error = new Error(`ComfyUI is busy (${queue.running} running, ${queue.pending} pending); GPU memory cannot be released safely`);
    error.code = "COMFY_QUEUE_BUSY";
    error.statusCode = 409;
    error.queue = { running: queue.running, pending: queue.pending };
    throw error;
  }
  const response = await fetch(`${COMFY_URL}/free`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`ComfyUI GPU release failed: ${response.status}`);
  return { released: true, queue: { running: 0, pending: 0 } };
}

export async function getObjectInfo(force = false) {
  if (!force && objectInfoCache && Date.now() - objectInfoAt < 5 * 60_000) return objectInfoCache;
  const r = await fetch(`${COMFY_URL}/object_info`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`ComfyUI object_info failed: ${r.status}`);
  objectInfoCache = await r.json();
  objectInfoAt = Date.now();
  return objectInfoCache;
}

// ---------------------------------------------------------------------------
// Graph (saved workflow JSON) -> API prompt format conversion.
// Widget values are matched to input names using /object_info ordering.
// ---------------------------------------------------------------------------

const VIRTUAL_TYPES = new Set([
  "Note", "MarkdownNote", "Reroute", "PrimitiveNode",
  "Label (rgthree)", "Bookmark (rgthree)", "Fast Groups Bypasser (rgthree)",
  "Fast Bypasser (rgthree)", "Fast Muter (rgthree)", "Node Collector (rgthree)",
  "Mute / Bypass Repeater (rgthree)", "PixaromaNote", "PixaromaLabel",
  "GetNode", "SetNode"
]);

const PIXAROMA_HIDDEN_STATE = Object.freeze({
  PixaromaResolution: { input: "ResolutionState", property: "resolutionState" },
  PixaromaSeed: { input: "SeedState", property: "seedState" }
});

function isWidgetInput(def) {
  // def = [typeOrOptions, config?]
  if (!Array.isArray(def)) return false;
  const [t, cfg] = def;
  if (Array.isArray(t)) return true; // COMBO
  if (cfg && cfg.forceInput) return false;
  return ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(t);
}

export function graphToApi(graph, objectInfo) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = new Map(); // linkId -> {src, srcSlot, dst, dstSlot, type}
  for (const l of graph.links || []) {
    links.set(l[0], { src: l[1], srcSlot: l[2], dst: l[3], dstSlot: l[4], type: l[5] });
  }

  // SetNode/GetNode (KJNodes virtual): key -> upstream [nodeId, slot]
  const setNodeSources = new Map();
  for (const n of graph.nodes) {
    if (n.type === "SetNode") {
      const key = (n.widgets_values || [])[0];
      const inp = (n.inputs || [])[0];
      if (key != null && inp && inp.link != null) setNodeSources.set(String(key), inp.link);
    }
  }

  // Resolve a link to its true upstream [nodeId, outputSlot], skipping virtual nodes
  function resolveLink(linkId, depth = 0) {
    if (linkId == null || depth > 64) return null;
    const l = links.get(linkId);
    if (!l) return null;
    const src = nodes.get(l.src);
    if (!src) return null;
    if (src.type === "Reroute") {
      const inp = (src.inputs || [])[0];
      return inp ? resolveLink(inp.link, depth + 1) : null;
    }
    if (src.type === "GetNode") {
      const key = (src.widgets_values || [])[0];
      const upstream = setNodeSources.get(String(key));
      return upstream != null ? resolveLink(upstream, depth + 1) : null;
    }
    // Bypassed (mode 4) or muted (mode 2): pass through matching-type input
    if (src.mode === 4 || src.mode === 2) {
      const outType = (src.outputs || [])[l.srcSlot]?.type;
      const match = (src.inputs || []).find((i) => i.type === outType && i.link != null);
      if (match) return resolveLink(match.link, depth + 1);
      return null;
    }
    return [String(l.src), l.srcSlot];
  }

  const api = {};
  const warnings = [];

  for (const n of graph.nodes) {
    if (VIRTUAL_TYPES.has(n.type)) continue;
    if (n.mode === 4 || n.mode === 2) continue; // bypassed/muted
    const info = objectInfo[n.type];
    if (!info) {
      warnings.push(`Unknown node class '${n.type}' (id ${n.id}) — skipped`);
      continue;
    }
    const inputsDef = { ...(info.input?.required || {}), ...(info.input?.optional || {}) };
    const inputOrder = [
      ...Object.keys(info.input?.required || {}),
      ...Object.keys(info.input?.optional || {})
    ];
    const linkedByName = new Map();
    for (const inp of n.inputs || []) {
      if (inp.link != null) linkedByName.set(inp.name, inp.link);
    }

    const widgetMap = n.widgets_values && !Array.isArray(n.widgets_values) && typeof n.widgets_values === "object"
      ? n.widgets_values
      : null;
    const wv = Array.isArray(n.widgets_values) ? [...n.widgets_values] : [];
    let wi = 0;
    const apiInputs = {};

    for (const name of inputOrder) {
      const def = inputsDef[name];
      const widget = isWidgetInput(def);
      let widgetVal;
      if (widget) {
        if (widgetMap && Object.prototype.hasOwnProperty.call(widgetMap, name)) {
          widgetVal = widgetMap[name];
        } else {
          widgetVal = wv[wi];
          wi += 1;
          // control_after_generate companion widget consumes an extra slot
          const cfg = Array.isArray(def) ? def[1] : null;
          const isSeed = cfg && (cfg.control_after_generate || name === "seed" || name === "noise_seed");
          if (isSeed && wi < wv.length && ["fixed", "randomize", "increment", "decrement"].includes(wv[wi])) {
            wi += 1;
          }
        }
      }
      if (linkedByName.has(name)) {
        const resolved = resolveLink(linkedByName.get(name));
        if (resolved) {
          apiInputs[name] = resolved;
          continue;
        }
      }
      if (widget && widgetVal !== undefined) {
        apiInputs[name] = widgetVal;
      }
    }

    // Pixaroma stores these values in the UI graph and injects them from its
    // browser extension. Premiere316 compiles prompts server-side, so preserve
    // the same explicit state without materializing unrelated magic inputs.
    const hiddenState = PIXAROMA_HIDDEN_STATE[n.type];
    if (hiddenState) {
      const propertyValue = n.properties?.[hiddenState.property];
      const widgetValue = Array.isArray(n.widgets_values)
        ? n.widgets_values[0]
        : n.widgets_values?.[hiddenState.input] ?? n.widgets_values?.[hiddenState.property];
      const stateValue = propertyValue ?? widgetValue;
      if (stateValue === undefined || stateValue === null || stateValue === "") {
        warnings.push(`${n.type} (id ${n.id}) is missing ${hiddenState.input}`);
      } else {
        apiInputs[hiddenState.input] = typeof stateValue === "string" ? stateValue : JSON.stringify(stateValue);
      }
    }

    // Dynamic nodes such as KJNodes ImageConcatMulti expose only their base
    // sockets in /object_info. Preserve every additional linked graph input
    // (image_3, image_4, ...), otherwise reference images silently disappear
    // from the API payload even though they are visible in the UI workflow.
    for (const [name, linkId] of linkedByName) {
      if (Object.prototype.hasOwnProperty.call(apiInputs, name)) continue;
      const resolved = resolveLink(linkId);
      if (resolved) apiInputs[name] = resolved;
    }
    api[String(n.id)] = { class_type: n.type, inputs: apiInputs };
  }

  // Drop dangling links (to skipped nodes)
  for (const [id, node] of Object.entries(api)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2 && !api[v[0]]) {
        delete node.inputs[k];
      }
    }
  }
  return { prompt: api, warnings };
}

export function loadWorkflowTemplate(name) {
  // Always load from package workflows/ — not process.cwd()
  const p = workflowPath(name);
  if (!fs.existsSync(p)) throw new Error(`Workflow template not found: ${name} (${p})`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ---------------------------------------------------------------------------
// Upload an image file into ComfyUI's input folder
// ---------------------------------------------------------------------------
function comfyUploadRelative(value, { allowEmpty = false, label = "ComfyUI upload path" } = {}) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) {
    if (allowEmpty) return "";
    throw new Error(`${label} is required`);
  }
  if (raw.includes("\0") || path.posix.isAbsolute(raw) || /^[a-z]:/i.test(raw)) {
    throw new Error(`${label} must be a relative path`);
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return parts.join("/");
}

export async function uploadImage(filePath, subfolder = "cineforge", {
  fileName = path.basename(filePath),
  overwrite = true,
  expectedSha256 = null,
  fetchImpl = fetch,
  baseUrl = COMFY_URL
} = {}) {
  const data = fs.readFileSync(filePath);
  const normalizedSubfolder = comfyUploadRelative(subfolder, { allowEmpty: true, label: "ComfyUI upload subfolder" });
  const normalizedFileName = comfyUploadRelative(fileName, { label: "ComfyUI upload filename" });
  if (normalizedFileName.includes("/")) throw new Error("ComfyUI upload filename must be a basename");
  if (expectedSha256) {
    const actualSha256 = crypto.createHash("sha256").update(data).digest("hex");
    if (actualSha256 !== String(expectedSha256).trim().toLowerCase()) {
      throw new Error("ComfyUI upload source SHA-256 changed before upload");
    }
  }
  const form = new FormData();
  form.append("image", new Blob([data]), normalizedFileName);
  form.append("subfolder", normalizedSubfolder);
  form.append("type", "input");
  form.append("overwrite", overwrite ? "true" : "false");
  const r = await fetchImpl(`${baseUrl}/upload/image`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`upload failed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const returnedName = comfyUploadRelative(j.name, { label: "ComfyUI returned upload filename" });
  if (returnedName.includes("/")) throw new Error("ComfyUI returned an invalid upload filename");
  const returnedSubfolder = comfyUploadRelative(j.subfolder, { allowEmpty: true, label: "ComfyUI returned upload subfolder" });
  if (returnedName !== normalizedFileName || returnedSubfolder !== normalizedSubfolder) {
    throw new Error("ComfyUI changed the deterministic upload destination");
  }
  return returnedSubfolder ? `${returnedSubfolder}/${returnedName}` : returnedName;
}

// ---------------------------------------------------------------------------
// Submit + track a prompt. onProgress({value,max,nodeTitle}) called during run.
// Returns history outputs object.
// ---------------------------------------------------------------------------
export function generationCancelledError(message = "Generation stopped by director") {
  const error = new Error(message);
  error.code = "GENERATION_CANCELLED";
  return error;
}

function queuePromptIds(entries) {
  return new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => Array.isArray(entry) ? entry[1] : entry?.prompt_id)
    .filter(Boolean)
    .map(String));
}

export async function cancelComfyPrompt(promptId, { baseUrl = COMFY_URL, fetchImpl = fetch } = {}) {
  const id = String(promptId || "").trim();
  if (!id) throw new Error("A ComfyUI prompt ID is required for cancellation");
  const jobCancel = await fetchImpl(`${baseUrl}/api/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000)
  });
  if (jobCancel.ok) return { method: "job-cancel" };
  if (![404, 405].includes(jobCancel.status)) throw new Error(`ComfyUI job cancellation failed: ${jobCancel.status}`);

  await fetchImpl(`${baseUrl}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete: [id] }),
    signal: AbortSignal.timeout(10_000)
  });
  const queueResponse = await fetchImpl(`${baseUrl}/queue`, { signal: AbortSignal.timeout(10_000) });
  if (!queueResponse.ok) throw new Error(`ComfyUI queue verification failed: ${queueResponse.status}`);
  const queue = await queueResponse.json();
  const runningIds = queuePromptIds(queue?.queue_running);
  const pendingIds = queuePromptIds(queue?.queue_pending);
  if (pendingIds.has(id)) throw new Error("ComfyUI did not remove the queued prompt");
  if (runningIds.has(id)) {
    const interrupt = await fetchImpl(`${baseUrl}/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_id: id }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!interrupt.ok) throw new Error(`ComfyUI targeted interruption failed: ${interrupt.status}`);
    return { method: "targeted-interrupt" };
  }
  return { method: "pending-delete" };
}

export async function runPrompt(promptGraph, { onProgress, onBeat, onSubmitted, onStatus, signal } = {}) {
  if (signal?.aborted) throw generationCancelledError();
  const clientId = crypto.randomUUID();
  const body = JSON.stringify({ prompt: promptGraph, client_id: clientId });
  const ws = new WebSocket(`${COMFY_URL.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
  const wsReady = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  await wsReady;

  const r = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!r.ok) {
    ws.close();
    const txt = await r.text();
    throw new Error(`ComfyUI /prompt rejected: ${r.status} ${txt.slice(0, 2000)}`);
  }
  const { prompt_id } = await r.json();
  if (!prompt_id) {
    ws.close();
    throw new Error("ComfyUI accepted the prompt without returning a prompt_id");
  }
  if (onSubmitted) {
    try { onSubmitted({ promptId: String(prompt_id), clientId }); } catch {}
  }

  const outputs = await new Promise((resolve, reject) => {
    let settled = false;
    let abortHandler = null;
    const finish = (fn, arg) => {
      if (!settled) {
        settled = true;
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        try { ws.close(); } catch {}
        fn(arg);
      }
    };
    abortHandler = async () => {
      try {
        await cancelComfyPrompt(prompt_id);
        finish(reject, generationCancelledError());
      } catch (error) {
        finish(reject, error);
      }
    };
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) return void abortHandler();
    ws.on("message", async (raw, isBinary) => {
      if (onBeat) try { onBeat(); } catch {}
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (onStatus && msg?.data?.prompt_id === prompt_id) {
        try { onStatus({ type: msg.type, data: msg.data }); } catch {}
      }
      if (msg.type === "progress" && onProgress) {
        onProgress({ value: msg.data.value, max: msg.data.max, nodeId: msg.data.node || null, promptId: String(prompt_id) });
      }
      if (msg.type === "executing" && msg.data.prompt_id === prompt_id && msg.data.node === null) {
        // finished — pull history
        try {
          const h = await fetch(`${COMFY_URL}/history/${prompt_id}`).then((x) => x.json());
          finish(resolve, h[prompt_id]?.outputs || {});
        } catch (e) { finish(reject, e); }
      }
      if (msg.type === "execution_error" && msg.data.prompt_id === prompt_id) {
        const detail = msg.data.exception_message || msg.data.exception_type || "Unknown ComfyUI execution error";
        const error = new Error(`ComfyUI execution error in ${msg.data.node_type || "unknown node"} (${msg.data.node_id || "unknown id"}): ${detail}`);
        error.code = "COMFY_EXECUTION_ERROR";
        error.comfy = msg.data;
        error.promptId = String(prompt_id);
        finish(reject, error);
      }
    });
    ws.on("error", (e) => finish(reject, e));
    ws.on("close", async () => {
      if (settled) return;
      // socket dropped — poll history as fallback
      try {
        for (let i = 0; i < 2160; i++) {
          await new Promise((s) => setTimeout(s, 5000));
          const h = await fetch(`${COMFY_URL}/history/${prompt_id}`).then((x) => x.json());
          if (h[prompt_id]?.status?.completed) return finish(resolve, h[prompt_id].outputs || {});
          if (h[prompt_id]?.status?.status_str === "error") return finish(reject, new Error("ComfyUI reported error (see server console)"));
        }
        finish(reject, new Error("Timed out waiting for ComfyUI"));
      } catch (e) { finish(reject, e); }
    });
  });
  return outputs;
}

// Download one output file (image/video/audio) from ComfyUI into destDir.
export async function downloadOutput(fileRef, destDir, destName) {
  const params = new URLSearchParams({
    filename: fileRef.filename,
    subfolder: fileRef.subfolder || "",
    type: fileRef.type || "output"
  });
  const r = await fetch(`${COMFY_URL}/view?${params}`);
  if (!r.ok) throw new Error(`view failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(fileRef.filename) || "";
  const finalName = destName ? destName + ext : fileRef.filename;
  const dest = path.join(destDir, finalName);
  fs.writeFileSync(dest, buf);
  return finalName;
}

// Collect all file refs from a history outputs object.
export function collectOutputFiles(outputs) {
  const files = [];
  for (const nodeOut of Object.values(outputs || {})) {
    for (const key of ["images", "videos", "video", "audio", "gifs"]) {
      const arr = nodeOut[key];
      if (Array.isArray(arr)) {
        for (const f of arr) if (f && f.filename) files.push(f);
      }
    }
  }
  return files;
}
