/**
 * Local backend process. Owns D:\AI\Models, engine spawn, and stills.
 * Talks JSON-lines over stdin/stdout. Renderer never imports this file.
 */
import { loadCatalog } from "../src/lib/studio/model-scan.server.ts";
import { benchmarkLocalEngine, ensureLocalEngine, exposeLocalStill, inspectLocalEngine, stopLocalEngine } from "../src/lib/studio/local-still.server.ts";
import { MODEL_ROOT, sanitizeModelCatalog } from "../src/lib/studio/model-catalog.ts";
import { createInterface } from "node:readline";

const ALLOWED = new Set(["catalog.get", "stills.expose", "stills.wake", "engines.stop", "engines.benchmark", "engines.inspect", "app.modelRoot"]);

function mediaSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(["qualityPreset", "aspectRatio", "width", "height", "steps", "guidance", "seed", "randomizeSeed", "lockSeed", "scheduler", "shift", "precision", "outputFormat", "outputBitDepth"]);
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => allowed.has(key) && ["string", "number", "boolean"].includes(typeof item)));
}

function toRelativePath(value) {
  if (typeof value !== "string" || !value) return value;
  const normalized = value.replace(/\//g, "\\");
  const root = MODEL_ROOT.replace(/\//g, "\\");
  if (normalized.toLowerCase().startsWith(root.toLowerCase())) {
    return normalized.slice(root.length).replace(/^\\+/, "");
  }
  return value;
}

function sanitizeComponent(component) {
  return {
    ...component,
    path: toRelativePath(component.path),
    paths: Array.isArray(component.paths) ? component.paths.map(toRelativePath) : [],
  };
}

function sanitizeCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") return catalog;
  return sanitizeModelCatalog(catalog);
}

async function dispatch(method, params) {
  switch (method) {
    case "catalog.get":
      return sanitizeCatalog(await loadCatalog({ force: Boolean(params?.force), deep: Boolean(params?.deep) }));
    case "stills.wake":
      return ensureLocalEngine();
    case "engines.stop":
      return stopLocalEngine();
    case "stills.expose":
      return exposeLocalStill({
        prompt: String(params?.prompt ?? ""),
        engineId: String(params?.engineId ?? ""),
        engineName: String(params?.engineName ?? ""),
        references: Array.isArray(params?.references)
          ? params.references.filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, 3)
          : [],
        selectedBasePath: String(params?.selectedBasePath ?? ""),
        values: mediaSettings(params?.values),
      });
    case "engines.benchmark":
      return benchmarkLocalEngine({
        engineId: String(params?.engineId ?? ""),
        engineName: String(params?.engineName ?? ""),
        selectedBasePath: String(params?.selectedBasePath ?? ""),
        values: mediaSettings(params?.values),
      });
    case "engines.inspect":
      return inspectLocalEngine({
        engineId: String(params?.engineId ?? ""),
        engineName: String(params?.engineName ?? ""),
        selectedBasePath: String(params?.selectedBasePath ?? ""),
      });
    case "app.modelRoot":
      return MODEL_ROOT;
    default:
      throw new Error("Unknown backend method");
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    continue;
  }
  const id = msg?.id;
  const method = String(msg?.method ?? "");
  try {
    if (!ALLOWED.has(method)) throw new Error("Blocked backend method");
    const result = await dispatch(method, msg.params);
    process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
  }
}
