// ComfyUI (BlokeyUI) client: health, object_info cache, graph->API conversion,
// image upload, prompt submission, websocket progress tracking, output download.
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { workflowPath } from "./paths.js";

export const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

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
export async function uploadImage(filePath, subfolder = "cineforge") {
  const data = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("image", new Blob([data]), path.basename(filePath));
  form.append("subfolder", subfolder);
  form.append("type", "input");
  form.append("overwrite", "true");
  const r = await fetch(`${COMFY_URL}/upload/image`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`upload failed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
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

export async function runPrompt(promptGraph, { onProgress, onBeat, signal } = {}) {
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
      // Delete if it is still pending, then interrupt if it is already executing.
      // Premiere316 serializes GPU work, so the active prompt belongs to this job.
      await Promise.allSettled([
        fetch(`${COMFY_URL}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delete: [prompt_id] })
        }),
        fetch(`${COMFY_URL}/interrupt`, { method: "POST" })
      ]);
      finish(reject, generationCancelledError());
    };
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    if (signal?.aborted) return void abortHandler();
    ws.on("message", async (raw, isBinary) => {
      if (onBeat) try { onBeat(); } catch {}
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "progress" && onProgress) {
        onProgress({ value: msg.data.value, max: msg.data.max });
      }
      if (msg.type === "executing" && msg.data.prompt_id === prompt_id && msg.data.node === null) {
        // finished — pull history
        try {
          const h = await fetch(`${COMFY_URL}/history/${prompt_id}`).then((x) => x.json());
          finish(resolve, h[prompt_id]?.outputs || {});
        } catch (e) { finish(reject, e); }
      }
      if (msg.type === "execution_error" && msg.data.prompt_id === prompt_id) {
        finish(reject, new Error(`ComfyUI execution error in ${msg.data.node_type}: ${msg.data.exception_message}`));
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
