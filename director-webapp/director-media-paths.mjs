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

const STORYBOARD_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

export function canonicalStartRelativePath(clipId, segmentIndex = 1) {
  const clip = String(clipId || "").trim().toUpperCase();
  if (!/^H0[2-4]-S\d+-C\d+$/.test(clip)) return "";
  const index = Math.max(1, Number(segmentIndex) || 1);
  if (index === 1) return `media/storyboard/canonical_start_frames/${clip}_CANONICAL_START.png`;
  const nn = String(index).padStart(2, "0");
  return `media/storyboard/canonical_start_frames/${clip}_SEG${nn}_CANONICAL_START.png`;
}

function startImageVersion(name) {
  const match = String(name || "").match(/\.v(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

function isSegmentLibraryName(name, clipId, segmentIndex) {
  const base = String(name || "");
  const clip = String(clipId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const index = Math.max(1, Number(segmentIndex) || 1);
  const nn = String(index).padStart(2, "0");
  if (index === 1) {
    return new RegExp(`^${clip}_first\\b`, "i").test(base) || new RegExp(`^${clip}_CANONICAL_START\\b`, "i").test(base);
  }
  return new RegExp(`^${clip}(?:_seg0?${index}|-SEG0?${index})\\b`, "i").test(base);
}

export function resolveSegmentStartImage(projectRoot, clipId, segmentIndex = 1) {
  const root = path.resolve(String(projectRoot || ""));
  const index = Math.max(1, Number(segmentIndex) || 1);
  const clip = String(clipId || "").trim().toUpperCase();
  if (!root || !clip) return null;

  const tryRelative = (relative, source) => {
    const normalized = safeMediaFragment(relative);
    if (!normalized.startsWith("media/")) return null;
    const disk = path.resolve(root, ...normalized.split("/"));
    if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) return null;
    return { relative: normalized, disk, fileName: path.basename(normalized), source };
  };

  const specificCanonical = tryRelative(canonicalStartRelativePath(clip, index), "canonical");
  if (specificCanonical) return specificCanonical;

  const storyboardDir = path.join(root, "media", "storyboard");
  if (fs.existsSync(storyboardDir)) {
    const matches = fs.readdirSync(storyboardDir)
      .filter((name) => STORYBOARD_IMAGE_RE.test(name) && isSegmentLibraryName(name, clip, index) && !/contact_sheet/i.test(name))
      .sort((left, right) => startImageVersion(right) - startImageVersion(left) || left.localeCompare(right));
    if (matches[0]) {
      const library = tryRelative(`media/storyboard/${matches[0]}`, "library");
      if (library) return library;
    }
  }

  if (index > 1) {
    const clipCanonical = tryRelative(canonicalStartRelativePath(clip, 1), "canonical-fallback");
    if (clipCanonical) return clipCanonical;
  }
  return null;
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
