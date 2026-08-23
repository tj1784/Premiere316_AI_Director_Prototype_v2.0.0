import crypto from "crypto";
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

const MANIFEST_PATH = path.join(WORKFLOWS_DIR, "manifest.json");

function fileHash(abs) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 12);
  } catch {
    return "";
  }
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { schema: "premiere316.workflows.v1", workflows: [] };
  }
}

function walkJsonFiles(root) {
  const files = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "minimax-h3" || entry.name === "ci-flux2-p316-style-lock" || entry.name === "audio") continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.json$/i.test(entry.name) || entry.name.startsWith(".") || /\.bak$/i.test(entry.name) || /before-/i.test(entry.name)) continue;
      files.push(full);
    }
  }
  walk(root);
  return files;
}

function packagedWorkflows() {
  const manifest = readManifest();
  const listed = Array.isArray(manifest.workflows) ? manifest.workflows : [];
  const items = [];
  const seen = new Set();
  for (const entry of listed) {
    const rel = String(entry.rel || "").replace(/\\/g, "/");
    if (!rel) continue;
    const abs = path.resolve(WORKFLOWS_DIR, rel);
    if (!abs.startsWith(path.resolve(WORKFLOWS_DIR) + path.sep) && abs !== path.resolve(WORKFLOWS_DIR, rel)) continue;
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    items.push({
      rel,
      name: entry.label || path.basename(rel, ".json"),
      folder: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
      bytes: fs.statSync(abs).size,
      hash: fileHash(abs),
      source: "package",
      id: entry.id || rel,
      pinned: true,
      active: false
    });
  }
  for (const abs of walkJsonFiles(WORKFLOWS_DIR)) {
    const rel = path.relative(WORKFLOWS_DIR, abs).replace(/\\/g, "/");
    if (rel === "manifest.json" || seen.has(rel)) continue;
    items.push({
      rel,
      name: path.basename(rel, ".json"),
      folder: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
      bytes: fs.statSync(abs).size,
      hash: fileHash(abs),
      source: "package",
      id: rel,
      pinned: false,
      active: false
    });
  }
  return items;
}

export function listWorkflows(query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const items = [...packagedWorkflows()];
  let missingLibrary = false;
  if (!fs.existsSync(WORKFLOW_ROOT)) {
    missingLibrary = true;
  } else {
    const localFiles = walkJsonFiles(WORKFLOW_ROOT);
    if (!localFiles.length) missingLibrary = true;
    for (const full of localFiles) {
      const rel = path.relative(WORKFLOW_ROOT, full).replace(/\\/g, "/");
      const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const baseName = path.basename(rel, ".json");
      const name = rel === HARROWING_REL ? "Harrowing of Hell" : rel === AAA_FILE_REL ? "Harrowing AAA" : rel === DIRECTOR_REL ? "Harrowing LTX2.5 Director" : baseName;
      items.push({
        rel,
        name,
        folder,
        bytes: fs.statSync(full).size,
        hash: fileHash(full),
        source: "library",
        id: rel,
        pinned: rel === HARROWING_REL || rel === AAA_FILE_REL || rel === DIRECTOR_REL || folder === "H01_S01_C01_AAA_segments",
        active: rel === AAA_REL
      });
    }
  }
  const filtered = needle
    ? items.filter((item) => `${item.rel} ${item.name} ${item.id} ${item.folder}`.toLowerCase().includes(needle))
    : items;
  const pinRank = (item) => item.source === "package" ? 0 : item.rel === HARROWING_REL ? 1 : item.rel === DIRECTOR_REL ? 2 : item.rel === AAA_FILE_REL ? 3 : item.folder === "H01_S01_C01_AAA_segments" ? 4 : 5;
  filtered.sort((a, b) => pinRank(a) - pinRank(b) || a.rel.localeCompare(b.rel));
  return {
    root: WORKFLOW_ROOT,
    packagedRoot: WORKFLOWS_DIR,
    missingLibrary,
    count: filtered.length,
    items: filtered
  };
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


function collectPackageHits(id) {
  const needle = String(id || "").trim().toLowerCase();
  if (!needle) return [];
  const items = packagedWorkflows();
  const exact = items.filter((item) => {
    const rel = String(item.rel || "").toLowerCase();
    const base = path.basename(rel).toLowerCase();
    const stem = base.replace(/\.json$/i, "");
    return rel === needle || rel === `${needle}.json` || base === needle || stem === needle || String(item.id || "").toLowerCase() === needle;
  });
  if (exact.length) return exact;
  return items.filter((item) => `${item.rel} ${item.name} ${item.id}`.toLowerCase().includes(needle));
}

function findPackageWorkflow(id) {
  const hits = collectPackageHits(id);
  if (!hits.length) return null;
  if (hits.length > 1) {
    const error = new Error(`Ambiguous workflow id '${id}'. Matches: ${hits.map((item) => item.rel).join(", ")}`);
    error.code = "WORKFLOW_AMBIGUOUS";
    throw error;
  }
  const abs = path.resolve(WORKFLOWS_DIR, hits[0].rel);
  return { rel: hits[0].rel, graph: readGraph(abs), source: "package", hash: hits[0].hash || fileHash(abs) };
}

export function readWorkflowGraph({ rel, id } = {}) {
  const rawRel = String(rel || "").trim();
  const rawId = String(id || "").trim();
  if (rawRel) {
    const packagedExact = packagedWorkflows().find((item) => item.rel === rawRel.replace(/\\/g, "/"));
    if (packagedExact) {
      const abs = path.resolve(WORKFLOWS_DIR, packagedExact.rel);
      return { rel: packagedExact.rel, graph: readGraph(abs), source: "package", hash: packagedExact.hash || fileHash(abs) };
    }
    const resolved = resolveWorkflowRel(rawRel);
    return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library", hash: fileHash(resolved.abs) };
  }
  if (rawId) {
    try {
      const resolved = resolveWorkflowRel(rawId.endsWith(".json") ? rawId : `${rawId}.json`);
      return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library", hash: fileHash(resolved.abs) };
    } catch {}
    const items = listWorkflows().items || [];
    const lower = rawId.toLowerCase();
    const exact = items.filter((item) => item.rel === rawId || item.rel.toLowerCase() === lower || String(item.id || "").toLowerCase() === lower || String(item.name || "").toLowerCase() === lower);
    if (exact.length > 1) throw new Error(`Ambiguous workflow id '${rawId}'. Matches: ${exact.map((item) => item.rel).join(", ")}`);
    if (exact.length === 1) {
      if (exact[0].source === "package") {
        const abs = path.resolve(WORKFLOWS_DIR, exact[0].rel);
        return { rel: exact[0].rel, graph: readGraph(abs), source: "package", hash: exact[0].hash || fileHash(abs) };
      }
      const resolved = resolveWorkflowRel(exact[0].rel);
      return { rel: resolved.rel, graph: readGraph(resolved.abs), source: "library", hash: fileHash(resolved.abs) };
    }
    const packaged = findPackageWorkflow(rawId);
    if (packaged) return packaged;
  }
  throw new Error("Workflow graph not found");
}
