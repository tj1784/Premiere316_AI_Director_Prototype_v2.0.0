import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARROWING_AAA_I2V_WORKFLOW,
  HARROWING_LTX25_DIRECTOR_GENERATE_OPTION,
  HARROWING_LTX25_DIRECTOR_WORKFLOW,
  LTX25_MUSIC_VIDEO_24GB_60S_WORKFLOW,
  LTX25_PREMIERE316_SEGMENTED_I2V_WORKFLOW,
  isHarrowingLtx25DirectorGenerate
} from "./premiere-api-delegation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");

function resolvePackagedWorkflow(relativePath) {
  const file = path.resolve(PACKAGE_ROOT, relativePath);
  const relative = path.relative(PACKAGE_ROOT, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Director workflow escapes the package root: ${relativePath}`);
  }
  return file;
}

export const HARROWING_AAA_I2V_PACKAGE_FILE = resolvePackagedWorkflow(HARROWING_AAA_I2V_WORKFLOW);
export const HARROWING_LTX25_DIRECTOR_PACKAGE_FILE = resolvePackagedWorkflow(HARROWING_LTX25_DIRECTOR_WORKFLOW);
export const LTX25_PREMIERE316_SEGMENTED_I2V_PACKAGE_FILE = resolvePackagedWorkflow(
  LTX25_PREMIERE316_SEGMENTED_I2V_WORKFLOW
);
export const LTX25_MUSIC_VIDEO_24GB_60S_PACKAGE_FILE = resolvePackagedWorkflow(
  LTX25_MUSIC_VIDEO_24GB_60S_WORKFLOW
);

export function workflowFileWithLocalCompatibility({ configuredFile, localFile, packageFile }) {
  const configured = String(configuredFile || "").trim();
  if (configured) return path.resolve(configured);
  const local = String(localFile || "").trim();
  if (local && fs.existsSync(path.resolve(local))) return path.resolve(local);
  return packageFile;
}

export function directorWorkflowFileForWorkspace(workspace, defaultFile) {
  return isHarrowingLtx25DirectorGenerate(workspace)
    ? HARROWING_LTX25_DIRECTOR_PACKAGE_FILE
    : defaultFile;
}

export function loadDirectorWorkflowSource(workspace, {
  defaultFile,
  defaultGraph,
  defaultText = ""
} = {}) {
  if (!isHarrowingLtx25DirectorGenerate(workspace)) {
    return {
      optionId: null,
      source: "default",
      file: defaultFile,
      text: defaultText,
      graph: defaultGraph,
      sha256: defaultText
        ? crypto.createHash("sha256").update(defaultText).digest("hex")
        : null
    };
  }

  const file = HARROWING_LTX25_DIRECTOR_PACKAGE_FILE;
  if (!fs.existsSync(file)) {
    throw new Error(`Harrowing LTX2.5 Director workflow not found: ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");
  let graph;
  try {
    graph = JSON.parse(text);
  } catch (error) {
    throw new Error(`Harrowing LTX2.5 Director workflow is invalid JSON: ${file}`, { cause: error });
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error(`Harrowing LTX2.5 Director workflow is not a ComfyUI UI graph: ${file}`);
  }
  return {
    optionId: HARROWING_LTX25_DIRECTOR_GENERATE_OPTION.id,
    source: "generate-option",
    file,
    text,
    graph,
    sha256: crypto.createHash("sha256").update(text).digest("hex")
  };
}
