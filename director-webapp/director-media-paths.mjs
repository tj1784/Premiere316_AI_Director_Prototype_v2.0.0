import fs from "node:fs";
import path from "node:path";

function safeMediaFragment(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("\0") || /^[A-Za-z]:\//.test(raw)) return "";
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return "";
  return normalized;
}

export function chapterFolderForClipId(clipId) {
  return String(clipId || "").trim().match(/^(H\d{2}|MV\d{2})-/i)?.[1]?.toUpperCase() || null;
}

export function clipMediaCandidates(file, clipId = "") {
  const normalized = safeMediaFragment(file);
  if (!normalized) return [];
  const chapter = chapterFolderForClipId(clipId);
  if (normalized.startsWith("media/clips/")) {
    const insideClips = normalized.slice("media/clips/".length);
    return chapter && !insideClips.includes("/")
      ? [normalized, `media/clips/${chapter}/${insideClips}`]
      : [normalized];
  }
  if (normalized.startsWith("media/")) return [normalized];
  if (normalized.startsWith("clips/")) return clipMediaCandidates(`media/${normalized}`, clipId);
  if (normalized.includes("/")) return [`media/clips/${normalized}`];
  return chapter
    ? [`media/clips/${chapter}/${normalized}`, `media/clips/${normalized}`]
    : [`media/clips/${normalized}`];
}

export function preferredClipMediaPath(file, clipId = "", projectRoot = "") {
  const candidates = clipMediaCandidates(file, clipId);
  if (!candidates.length || !projectRoot) return candidates[0] || "";
  return candidates.find((relative) => fs.existsSync(projectMediaDiskPath(projectRoot, relative))) || candidates[0];
}

export function directorOutputRelativePath(clipId, fileName) {
  const normalized = safeMediaFragment(fileName);
  if (!normalized) throw new Error("Director output filename is missing or unsafe");
  const base = path.posix.basename(normalized);
  const chapter = chapterFolderForClipId(clipId);
  return chapter ? `media/clips/${chapter}/${base}` : `media/clips/${base}`;
}

export function projectMediaDiskPath(projectRoot, relativeFile) {
  const normalized = safeMediaFragment(relativeFile);
  if (!normalized.startsWith("media/")) throw new Error("Project media path must stay under media/");
  const root = path.resolve(projectRoot);
  const mediaRoot = path.resolve(root, "media");
  const disk = path.resolve(root, ...normalized.split("/"));
  if (!disk.toLowerCase().startsWith(`${mediaRoot}${path.sep}`.toLowerCase())) {
    throw new Error("Project media path escaped the media root");
  }
  return disk;
}

export function directorOutputDiskPath(projectRoot, clipId, fileName) {
  return projectMediaDiskPath(projectRoot, directorOutputRelativePath(clipId, fileName));
}

export function directorOutputDiskCandidates(projectRoot, clipId, fileName) {
  return clipMediaCandidates(path.posix.basename(String(fileName || "")), clipId)
    .map((relative) => projectMediaDiskPath(projectRoot, relative));
}

export function discoverDirectorTakeFiles(clipsRoot, clipId, segmentId) {
  const prefix = `${String(clipId)}_${String(segmentId)}_director_v`.toLowerCase();
  const chapter = chapterFolderForClipId(clipId);
  const locations = [
    ...(chapter ? [{ disk: path.join(clipsRoot, chapter), relativePrefix: `${chapter}/` }] : []),
    { disk: clipsRoot, relativePrefix: "" }
  ];
  const found = [];
  const seen = new Set();
  for (const location of locations) {
    if (!fs.existsSync(location.disk)) continue;
    for (const entry of fs.readdirSync(location.disk, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.startsWith(prefix) || !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(entry.name)) continue;
      const relativeName = `${location.relativePrefix}${entry.name}`;
      const key = relativeName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ name: entry.name, relativeName, file: `media/clips/${relativeName}` });
    }
  }
  return found;
}
