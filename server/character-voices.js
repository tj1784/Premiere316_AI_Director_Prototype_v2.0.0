import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_AUDACITY_VOICE_ROOT = "C:\\Users\\Blokey\\Documents\\Audacity";
export const AUDACITY_AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".m4a", ".aac", ".ogg"]);
const sourceHashCache = new Map();

function normalizedWords(value) {
  return String(value || "")
    .replace(/â/g, "—")
    .replace(/â/g, "–")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s+(?:-|–|—)\s+.*$/, "")
    .replace(/^(?:character|voice|wardrobe|ward)[-_ ]+/i, "")
    .replace(/\b(?:voice design|wardrobe|appearance|primary appearance|close[- ]?up|action pose)\b.*$/i, "")
    .replace(/\d+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function characterVoiceKey(value) {
  const words = normalizedWords(value).split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join("-");
}

function sourceId(relativePath, stat) {
  return `audacity_${crypto.createHash("sha256")
    .update(`${relativePath.replace(/\\/g, "/")}\n${stat.size}\n${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function fileSha256(file, stat) {
  const cacheKey = `${file}\n${stat.size}\n${stat.mtimeMs}`;
  const cached = sourceHashCache.get(cacheKey);
  if (cached) return cached;
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      hash.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(handle);
  }
  const digest = hash.digest("hex");
  sourceHashCache.set(cacheKey, digest);
  if (sourceHashCache.size > 1_000) sourceHashCache.delete(sourceHashCache.keys().next().value);
  return digest;
}

function containedFile(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relativePath);
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}${path.sep}`)) return null;
  return absolute;
}

export function listAudacityVoiceSources({
  root = process.env.PREMIERE316_AUDACITY_VOICE_ROOT || DEFAULT_AUDACITY_VOICE_ROOT,
  maxFiles = 500,
  includeHashes = true
} = {}) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    return { root: absoluteRoot, exists: false, sources: [], unsupportedProjects: [] };
  }
  const sources = [];
  const unsupportedProjects = [];
  const pending = [{ folder: absoluteRoot, relative: "", depth: 0 }];
  while (pending.length && sources.length < maxFiles) {
    const current = pending.shift();
    const entries = fs.readdirSync(current.folder, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(current.relative, entry.name);
      const absolute = containedFile(absoluteRoot, relative);
      if (!absolute) continue;
      if (entry.isDirectory()) {
        if (current.depth < 3) pending.push({ folder: absolute, relative, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".aup3") {
        unsupportedProjects.push({ name: entry.name, relativePath: relative.replace(/\\/g, "/") });
        continue;
      }
      if (!AUDACITY_AUDIO_EXTENSIONS.has(extension)) continue;
      const stat = fs.statSync(absolute);
      const id = sourceId(relative, stat);
      sources.push({
        id,
        name: path.basename(entry.name, extension),
        fileName: entry.name,
        relativePath: relative.replace(/\\/g, "/"),
        extension,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        characterKey: characterVoiceKey(entry.name),
        ...(includeHashes ? { sha256: fileSha256(absolute, stat) } : {})
      });
      if (sources.length >= maxFiles) break;
    }
  }
  sources.sort((left, right) => left.characterKey.localeCompare(right.characterKey)
    || right.modifiedAt.localeCompare(left.modifiedAt)
    || left.fileName.localeCompare(right.fileName));
  return { root: absoluteRoot, exists: true, sources, unsupportedProjects };
}

export function resolveAudacityVoiceSource(id, options = {}) {
  const catalog = listAudacityVoiceSources(options);
  const source = catalog.sources.find((entry) => entry.id === String(id || ""));
  if (!source) return null;
  const absolute = containedFile(catalog.root, source.relativePath);
  if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const stat = fs.statSync(absolute);
  if (sourceId(source.relativePath, stat) !== source.id) return null;
  return { ...source, absolute, root: catalog.root };
}

export function characterAssetKey(asset) {
  const name = String(asset?.name || "");
  const category = String(asset?.category || "").toLowerCase();
  if (category === "wardrobe") return characterVoiceKey(name.replace(/\bwardrobe\b/ig, ""));
  return characterVoiceKey(name || asset?.id);
}

export function findCharacterVoiceAsset(project, characterAsset, requestedVoiceAssetId = null) {
  const assets = project?.assets?.items || [];
  if (requestedVoiceAssetId) {
    const requested = assets.find((asset) => asset.id === requestedVoiceAssetId);
    if (!requested || requested.category !== "voice") throw new Error("The selected voice target is not a project voice asset");
    return requested;
  }
  const key = characterAssetKey(characterAsset);
  return assets.find((asset) => asset.category === "voice" && characterAssetKey(asset) === key) || null;
}

function versionHashes(version) {
  if (Array.isArray(version?.fileHashes)) return version.fileHashes;
  if (version?.fileHashes && typeof version.fileHashes === "object") {
    return Object.entries(version.fileHashes).map(([file, value]) => typeof value === "string"
      ? { file, sha256: value }
      : { file, ...(value || {}) });
  }
  return [];
}

export function findImportedVoiceSource(project, source) {
  const expectedHash = String(source?.sha256 || "").toLowerCase();
  if (!expectedHash) return null;
  for (const asset of project?.assets?.items || []) {
    for (const version of asset?.versions || []) {
      const match = versionHashes(version).find((entry) => String(entry?.sha256 || "").toLowerCase() === expectedHash);
      if (match) return { asset, version, file: match.file || version.file || version.files?.[0] || null };
    }
  }
  return null;
}
