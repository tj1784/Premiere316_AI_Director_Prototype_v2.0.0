import fs from "fs";
import path from "path";
import { PACKAGE_ROOT, WORKFLOWS_DIR } from "./paths.js";

export const WORKFLOW_ROOT = path.join(
  PACKAGE_ROOT,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows"
);

export const AAA_WORKFLOW_PATH = path.join(WORKFLOW_ROOT, "LTX_2.5_Harrowing_AAA.json");
export const AAA_REL = "HARROWING OF HELL.json";
export const HARROWING_REL = "HARROWING OF HELL.json";
export const AAA_FILE_REL = "LTX_2.5_Harrowing_AAA.json";
export const DIRECTOR_REL = "harrowing_of_hell_LTX2.5_Director.json";

const SEG_DIR = path.join(
  PACKAGE_ROOT,
  "BlokeyUI",
  "ComfyUI",
  "user",
  "default",
  "workflows",
  "Premiere316",
  "Segments"
);

const LORA_SLOTS = [
  { key: "flying", index: 2 },
  { key: "distilled", index: 7 },
  { key: "talkvid", index: 12 },
  { key: "crisp", index: 17 },
  { key: "hardcut", index: 22 }
];

function readGraph(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeGraph(file, graph) {
  fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
}


function resolveWorkflowRel(rel) {
  const raw = String(rel || AAA_REL).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..") || path.isAbsolute(raw) || !raw.toLowerCase().endsWith(".json")) {
    throw new Error("Invalid workflow path");
  }
  const abs = path.resolve(WORKFLOW_ROOT, raw);
  const root = path.resolve(WORKFLOW_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("Workflow path escapes library");
  if (!fs.existsSync(abs)) throw new Error(`Workflow not found: ${raw}`);
  return { rel: path.relative(WORKFLOW_ROOT, abs).replace(/\\/g, "/"), abs };
}

export function listWorkflows(query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const items = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.json$/i.test(entry.name) || entry.name.startsWith(".")) continue;
      const rel = path.relative(WORKFLOW_ROOT, full).replace(/\\/g, "/");
      const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const baseName = entry.name.replace(/\.json$/i, "");
      const name = rel === HARROWING_REL ? "Harrowing of Hell" : rel === AAA_FILE_REL ? "Harrowing AAA" : rel === DIRECTOR_REL ? "Harrowing LTX2.5 Director" : baseName;
      const hay = `${rel} ${name} ${baseName} ${folder} harrowing of hell`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      let bytes = 0;
      try { bytes = fs.statSync(full).size; } catch {}
      const pinned = rel === HARROWING_REL || rel === AAA_FILE_REL || rel === DIRECTOR_REL || folder === "H01_S01_C01_AAA_segments";
      items.push({ rel, name, folder, bytes, active: rel === AAA_REL, pinned });
    }
  }
  walk(WORKFLOW_ROOT);
  const pinRank = (item) => item.rel === HARROWING_REL ? 0 : item.rel === DIRECTOR_REL ? 1 : item.rel === AAA_FILE_REL ? 2 : item.folder === "H01_S01_C01_AAA_segments" ? 3 : 4;
  items.sort((a, b) => pinRank(a) - pinRank(b) || a.rel.localeCompare(b.rel));
  return { root: WORKFLOW_ROOT, count: items.length, items };
}

function nodeById(graph, id) {
  return (graph.nodes || []).find((node) => Number(node.id) === Number(id)) || null;
}

function widget(graph, id, index, fallback = null) {
  const node = nodeById(graph, id);
  const values = node?.widgets_values;
  return Array.isArray(values) && values.length > index ? values[index] : fallback;
}

function setWidget(graph, id, index, value) {
  const node = nodeById(graph, id);
  if (!node || !Array.isArray(node.widgets_values) || node.widgets_values.length <= index) return false;
  node.widgets_values[index] = value;
  return true;
}


function subgraphNodes(graph) {
  const out = [];
  const defs = graph?.definitions?.subgraphs;
  if (!Array.isArray(defs)) return out;
  for (const sub of defs) {
    for (const node of sub.nodes || []) out.push(node);
  }
  return out;
}

function findNode(graph, id) {
  return nodeById(graph, id) || subgraphNodes(graph).find((node) => Number(node.id) === Number(id)) || null;
}

function hellPrompt(graph) {
  const fromAaa = widget(graph, 5317, 1, "");
  if (fromAaa) return String(fromAaa);
  const node = findNode(graph, 376);
  const values = node?.widgets_values;
  return Array.isArray(values) && values[0] ? String(values[0]) : "";
}

function hellSigmas(graph, id) {
  const fromAaa = widget(graph, id, 2, "");
  if (fromAaa) return String(fromAaa);
  const node = findNode(graph, id === 5723 ? 397 : 396);
  const values = node?.widgets_values;
  return Array.isArray(values) && values[0] ? String(values[0]) : "";
}

function lorasFrom(graph) {
  const out = {};
  for (const slot of LORA_SLOTS) {
    out[slot.key] = {
      name: String(widget(graph, 5313, slot.index, "") || ""),
      strength: Number(widget(graph, 5313, slot.index + 1, 0) || 0),
      enabled: Boolean(widget(graph, 5313, slot.index + 4, false))
    };
  }
  return out;
}

function applyLoras(graph, loras) {
  if (!loras || typeof loras !== "object") return;
  for (const slot of LORA_SLOTS) {
    const next = loras[slot.key];
    if (!next) continue;
    if (typeof next.enabled === "boolean") setWidget(graph, 5313, slot.index + 4, next.enabled);
    if (next.strength != null && next.strength !== "") {
      const strength = Number(next.strength);
      setWidget(graph, 5313, slot.index + 1, strength);
      setWidget(graph, 5313, slot.index + 3, strength);
    }
  }
}


function hellDelivery(graph) {
  const wrap = nodeById(graph, 398);
  const w = Array.isArray(wrap?.widgets_values) ? wrap.widgets_values : [];
  const dur = findNode(graph, 362);
  const rate = findNode(graph, 361);
  const seconds = Number(dur?.widgets_values?.[0] ?? w[2] ?? widget(graph, 5036, 0, 13) ?? 13);
  const width = Number(w[3] ?? widget(graph, 5843, 0, 1792) ?? 1792);
  const height = Number(w[4] ?? widget(graph, 5844, 0, 768) ?? 768);
  const fps = Number(rate?.widgets_values?.[0] ?? w[6] ?? widget(graph, 5329, 0, 30) ?? 30);
  return { seconds, width, height, fps };
}

export function readAaaWorkflow(rel) {
  const resolved = resolveWorkflowRel(rel || AAA_REL);
  let graph;
  try {
    graph = readGraph(resolved.abs);
  } catch (error) {
    return {
      rel: resolved.rel,
      file: resolved.abs,
      name: resolved.rel === HARROWING_REL || resolved.rel === AAA_REL ? "Harrowing of Hell" : resolved.rel === AAA_FILE_REL ? "Harrowing AAA" : resolved.rel === DIRECTOR_REL ? "Harrowing LTX2.5 Director" : path.basename(resolved.rel, ".json"),
      folder: resolved.rel.includes("/") ? resolved.rel.slice(0, resolved.rel.lastIndexOf("/")) : "",
      isAaa: resolved.rel === AAA_REL,
      seconds: 0,
      width: 0,
      height: 0,
      fps: 0,
      unet: "",
      clip: "",
      firstFrame: "",
      useFirstFrame: false,
      globalPrompt: "",
      negativePrompt: "",
      sampler: "euler",
      pass1Sigmas: "",
      pass2Sigmas: "",
      pass1Steps: 0,
      pass2Steps: 0,
      loras: {},
      loadError: String(error.message || error)
    };
  }
  const pass1 = hellSigmas(graph, 5723);
  const pass2 = hellSigmas(graph, 5724);
  return {
    rel: resolved.rel,
    file: resolved.abs,
    name: resolved.rel === HARROWING_REL || resolved.rel === AAA_REL ? "Harrowing of Hell" : resolved.rel === AAA_FILE_REL ? "Harrowing AAA" : resolved.rel === DIRECTOR_REL ? "Harrowing LTX2.5 Director" : path.basename(resolved.rel, ".json"),
    folder: resolved.rel.includes("/") ? resolved.rel.slice(0, resolved.rel.lastIndexOf("/")) : "",
    isAaa: resolved.rel === AAA_REL,
    ...hellDelivery(graph),
    unet: String(widget(graph, 5581, 0, "") || ""),
    clip: String(widget(graph, 5582, 0, "") || ""),
    firstFrame: String(widget(graph, 5837, 0, "") || ""),
    useFirstFrame: Boolean(widget(graph, 5836, 0, true)),
    globalPrompt: hellPrompt(graph),
    negativePrompt: String(widget(graph, 5317, 6, "") || ""),
    sampler: String(widget(graph, 5723, 1, "euler") || "euler"),
    pass1Sigmas: pass1,
    pass2Sigmas: pass2,
    pass1Steps: Math.max(0, pass1.split(",").filter((part) => part.trim()).length - 1),
    pass2Steps: Math.max(0, pass2.split(",").filter((part) => part.trim()).length - 1),
    loras: lorasFrom(graph)
  };
}


function setFindWidget(graph, id, index, value) {
  const node = findNode(graph, id);
  if (!node || !Array.isArray(node.widgets_values) || node.widgets_values.length <= index) return false;
  node.widgets_values[index] = value;
  return true;
}

function applyHellDelivery(graph, config) {
  const wrap = nodeById(graph, 398);
  const w = Array.isArray(wrap?.widgets_values) ? wrap.widgets_values : null;
  if (config.width != null && w && w.length > 3) w[3] = Math.max(32, Math.round(Number(config.width) || 0));
  if (config.height != null && w && w.length > 4) w[4] = Math.max(32, Math.round(Number(config.height) || 0));
  if (config.fps != null) {
    const fps = Math.max(1, Number(config.fps) || 24);
    if (w && w.length > 6) w[6] = fps;
    setFindWidget(graph, 361, 0, fps);
  }
  if (config.seconds != null) {
    const seconds = Math.max(1, Math.round(Number(config.seconds) || 8));
    if (w && w.length > 2) w[2] = seconds;
    setFindWidget(graph, 362, 0, seconds);
  }
  if (config.unet && w && w.length > 7) w[7] = String(config.unet);
  if (config.clip && w && w.length > 10) w[10] = String(config.clip);
  if (config.globalPrompt != null && w && w.length > 0) w[0] = String(config.globalPrompt);
}

function applyConfig(graph, config) {
  if (config.width != null) setWidget(graph, 5843, 0, Math.max(32, Math.round(Number(config.width) || 0)));
  if (config.height != null) setWidget(graph, 5844, 0, Math.max(32, Math.round(Number(config.height) || 0)));
  if (config.fps != null) {
    const fps = Math.max(1, Number(config.fps) || 24);
    setWidget(graph, 5329, 0, fps);
    setWidget(graph, 5317, 3, fps);
  }
  if (config.seconds != null) setWidget(graph, 5036, 0, Math.max(1, Math.round(Number(config.seconds) || 8)));
  if (config.unet) {
    setWidget(graph, 5581, 0, String(config.unet));
    setWidget(graph, 5801, 0, String(config.unet));
  }
  if (config.clip) {
    setWidget(graph, 5582, 0, String(config.clip));
    setWidget(graph, 5802, 0, String(config.clip));
  }
  if (config.firstFrame != null) setWidget(graph, 5837, 0, String(config.firstFrame));
  if (typeof config.useFirstFrame === "boolean") setWidget(graph, 5836, 0, config.useFirstFrame);
  if (config.globalPrompt != null) {
    if (!setWidget(graph, 5317, 1, String(config.globalPrompt))) {
      const node = findNode(graph, 376);
      if (node && Array.isArray(node.widgets_values) && node.widgets_values.length) node.widgets_values[0] = String(config.globalPrompt);
    }
  }
  if (config.negativePrompt != null) setWidget(graph, 5317, 6, String(config.negativePrompt));
  if (config.pass1Sigmas != null) {
    setWidget(graph, 5723, 2, String(config.pass1Sigmas));
    setWidget(graph, 5827, 2, String(config.pass1Sigmas));
  }
  if (config.pass2Sigmas != null) {
    setWidget(graph, 5724, 2, String(config.pass2Sigmas));
    setWidget(graph, 5828, 2, String(config.pass2Sigmas));
    setWidget(graph, 5728, 2, String(config.pass2Sigmas));
    setWidget(graph, 5832, 2, String(config.pass2Sigmas));
  }
  applyHellDelivery(graph, config);
  applyLoras(graph, config.loras);
}

export function writeAaaWorkflow(config) {
  const resolved = resolveWorkflowRel((config && config.rel) || AAA_REL);
  const graph = readGraph(resolved.abs);
  applyConfig(graph, config || {});
  writeGraph(resolved.abs, graph);
  let segments = 0;
  if (resolved.rel === AAA_FILE_REL && fs.existsSync(SEG_DIR)) {
    for (const name of fs.readdirSync(SEG_DIR)) {
      if (!/^H01-S01-C01__segment-.*\.json$/i.test(name)) continue;
      const file = path.join(SEG_DIR, name);
      const segment = readGraph(file);
      applyConfig(segment, config || {});
      writeGraph(file, segment);
      segments += 1;
    }
  }
  return { ...readAaaWorkflow(resolved.rel), segmentsUpdated: segments };
}


function findPackageWorkflow(id) {
  const needle = String(id || "").trim().toLowerCase();
  if (!needle) return null;
  const hits = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.(json)$/i.test(entry.name) || entry.name.startsWith(".")) continue;
      const rel = path.relative(WORKFLOWS_DIR, full).replace(/\\/g, "/");
      const hay = `${rel} ${entry.name}`.toLowerCase();
      if (!hay.includes(needle)) continue;
      hits.push({ rel, abs: full, ui: /\.ui\.json$/i.test(entry.name) || /\/ui\//i.test(rel) });
    }
  }
  try { walk(WORKFLOWS_DIR); } catch { return null; }
  hits.sort((a, b) => Number(b.ui) - Number(a.ui) || a.rel.localeCompare(b.rel));
  if (!hits.length) return null;
  return { rel: hits[0].rel, graph: readGraph(hits[0].abs), source: "package" };
}

export function readWorkflowGraph({ rel, id } = {}) {
  const rawRel = String(rel || "").trim();
  const rawId = String(id || "").trim();
  if (rawRel) {
    const resolved = resolveWorkflowRel(rawRel);
    return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library" };
  }
  if (rawId) {
    try {
      const resolved = resolveWorkflowRel(rawId.endsWith(".json") ? rawId : `${rawId}.json`);
      return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library" };
    } catch {}
    const items = listWorkflows().items || [];
    const lower = rawId.toLowerCase();
    const match = items.find((item) => item.rel === rawId || item.rel.toLowerCase() === lower || String(item.name || "").toLowerCase() === lower)
      || items.find((item) => String(item.rel || "").toLowerCase().includes(lower) || String(item.name || "").toLowerCase().includes(lower));
    if (match) {
      const resolved = resolveWorkflowRel(match.rel);
      return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library" };
    }
    const packaged = findPackageWorkflow(rawId);
    if (packaged) return packaged;
  }
  throw new Error("Workflow graph not found");
}
