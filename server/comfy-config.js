import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { PACKAGE_ROOT } from "./paths.js";

export const BUNDLED_COMFY_URL = "http://127.0.0.1:8190";
export const COMFY_SETTINGS_FILE = path.join(PACKAGE_ROOT, "config", "premiere316.local.json");

function isLocalAddress(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function normalizeComfyUrl(value) {
  let candidate = String(value || "").trim();
  if (!candidate) throw new Error("Enter the ComfyUI IP address and port.");
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid ComfyUI address, such as http://127.0.0.1:8188.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("The ComfyUI address must use http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not include a username or password in the ComfyUI address.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Remove query parameters and fragments from the ComfyUI address.");
  }
  if (!parsed.port && (isLocalAddress(parsed.hostname) || isIP(parsed.hostname))) {
    parsed.port = "8188";
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function readSavedComfyUrl(filePath = COMFY_SETTINGS_FILE) {
  if (!fs.existsSync(filePath)) return null;
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return saved?.comfyUrl ? normalizeComfyUrl(saved.comfyUrl) : null;
}

export function resolveConfiguredComfyUrl({ filePath = COMFY_SETTINGS_FILE, env = process.env } = {}) {
  try {
    const saved = readSavedComfyUrl(filePath);
    if (saved) return saved;
  } catch (error) {
    console.warn(`[Premiere316] Ignoring invalid local ComfyUI setting: ${String(error.message || error)}`);
  }
  return normalizeComfyUrl(env.COMFY_URL || BUNDLED_COMFY_URL);
}

export function saveConfiguredComfyUrl(value, filePath = COMFY_SETTINGS_FILE) {
  const comfyUrl = normalizeComfyUrl(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ comfyUrl }, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
  process.env.COMFY_URL = comfyUrl;
  return comfyUrl;
}

export function isBundledComfyUrl(value) {
  try {
    const parsed = new URL(normalizeComfyUrl(value));
    return parsed.protocol === "http:"
      && isLocalAddress(parsed.hostname)
      && parsed.port === "8190"
      && (parsed.pathname === "" || parsed.pathname === "/")
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function managedComfyProfile(value) {
  try {
    const parsed = new URL(normalizeComfyUrl(value));
    if (parsed.protocol !== "http:"
      || !isLocalAddress(parsed.hostname)
      || (parsed.pathname !== "" && parsed.pathname !== "/")
      || parsed.search
      || parsed.hash) return null;
    if (parsed.port === "8188") return "shared";
    if (parsed.port === "8190") return "dedicated";
    return null;
  } catch {
    return null;
  }
}

export function isManagedComfyUrl(value) {
  return Boolean(managedComfyProfile(value));
}
