/** Shared sequence-import media contract. Client and server must agree. */

export const VIDEO_EXTENSIONS = Object.freeze([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"]);
export const AUDIO_EXTENSIONS = Object.freeze([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aif", ".aiff"]);
export const IMAGE_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export const MAX_EDITOR_VIDEO_BYTES = 512 * 1024 * 1024;
export const MAX_EDITOR_AUDIO_BYTES = 128 * 1024 * 1024;

export const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v|avi)$/i;
export const AUDIO_RE = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
export const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

export function extensionOf(name = "") {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index).toLowerCase() : "";
}

export function classifyMediaName(name = "") {
  const extension = extensionOf(name);
  if (VIDEO_EXTENSIONS.includes(extension)) return "video";
  if (AUDIO_EXTENSIONS.includes(extension)) return "audio";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return "unsupported";
}

export function advertisedAcceptList() {
  return [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].join(",");
}

export function preflightDroppedFile(file = {}, limits = {}) {
  const name = String(file.name || file.originalname || file.relativePath || "");
  const kind = classifyMediaName(name);
  const size = Number(file.size || 0);
  const relativePath = String(file.relativePath || file.webkitRelativePath || name);
  const base = {
    name,
    relativePath,
    bytes: size,
    kind,
    extension: extensionOf(name)
  };
  if (kind === "unsupported") {
    return { ...base, status: "unsupported", reason: `${extensionOf(name) || "This file"} is not an advertised sequence media type.` };
  }
  if (kind === "image") {
    return {
      ...base,
      status: "unsupported",
      reason: "Images are not imported into the sequence bin. Use Assets or Storyboard."
    };
  }
  const maxBytes = kind === "video"
    ? Number(limits.videoBytes || MAX_EDITOR_VIDEO_BYTES)
    : Number(limits.audioBytes || MAX_EDITOR_AUDIO_BYTES);
  if (!Number.isFinite(size) || size <= 0) {
    return { ...base, status: "failed", reason: "Zero-byte or unreadable file." };
  }
  if (size > maxBytes) {
    return {
      ...base,
      status: "oversized",
      reason: `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB ${kind} import limit.`
    };
  }
  return { ...base, status: "eligible", reason: "" };
}

export function tallyImportResults(results = []) {
  const tallies = {
    scanned: results.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    duplicate: 0,
    unsupported: 0,
    oversized: 0,
    cancelled: 0
  };
  for (const item of results) {
    const status = String(item?.status || "failed");
    if (status === "imported" || status === "linked") tallies.imported += 1;
    else if (status === "duplicate" || status === "skipped") {
      tallies.skipped += 1;
      if (status === "duplicate") tallies.duplicate += 1;
    } else if (status === "cancelled") tallies.cancelled += 1;
    else {
      tallies.failed += 1;
      if (status === "unsupported") tallies.unsupported += 1;
      if (status === "oversized") tallies.oversized += 1;
    }
  }
  tallies.accounted = tallies.imported + tallies.skipped + tallies.failed + tallies.cancelled;
  return tallies;
}

export function summarizeImportJob(results = []) {
  const tallies = tallyImportResults(results);
  const failures = results.filter((item) => !["imported", "linked", "duplicate", "skipped", "cancelled"].includes(item.status));
  const parts = [
    `${tallies.scanned} scanned`,
    `${tallies.imported} imported`,
    tallies.skipped ? `${tallies.skipped} skipped` : "",
    tallies.failed ? `${tallies.failed} failed` : ""
  ].filter(Boolean);
  return {
    ...tallies,
    failures,
    headline: parts.join(" · "),
    balanced: tallies.scanned === tallies.accounted
  };
}
