/** Pure FFmpeg/import helpers. No network, no downloads, no Comfy. */

export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv"];

export function parseFfprobeJson(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const format = data?.format ?? {};
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") ?? null;
  const audio = streams.find((stream) => stream.codec_type === "audio") ?? null;
  const durationSec = Number(format.duration ?? video?.duration ?? 0);
  const fps = parseFrameRate(video?.r_frame_rate || video?.avg_frame_rate || "");
  const frameCount = Number(video?.nb_frames || 0) || (durationSec && fps ? Math.round(durationSec * fps) : null);
  const byteLength = Number(format.size || 0);
  const ok = Boolean(video && durationSec > 0 && byteLength > 1024);
  return {
    ok,
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
    fps,
    frameCount: frameCount && frameCount > 0 ? frameCount : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    container: format.format_name ?? null,
    hasAudio: Boolean(audio),
    byteLength: Number.isFinite(byteLength) ? byteLength : 0,
    error: ok ? null : "ffprobe did not describe a real video stream.",
  };
}

export function parseFrameRate(value) {
  if (!value || value === "0/0") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const text = String(value);
  if (text.includes("/")) {
    const [num, den] = text.split("/").map(Number);
    if (num > 0 && den > 0) return num / den;
    return null;
  }
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function assertImportableVideo(input) {
  const filePath = String(input?.filePath || "");
  const byteLength = Number(input?.byteLength || 0);
  const ext = String(input?.extension || "").replace(".", "").toLowerCase();
  if (!filePath) throw new Error("Imported video path is required.");
  if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error("Imported video must be mp4/mov/m4v/mkv.");
  if (!(byteLength > 1024)) throw new Error("Imported video must be a real nonzero movie file, not a still fixture.");
  return true;
}

export function liteExportDurationSec(sourceDurationSec) {
  const duration = Number(sourceDurationSec || 0);
  if (!(duration > 0)) throw new Error("Export requires probed duration.");
  return Math.min(10, Math.max(Math.min(duration, 5), Math.min(duration, 10)));
}

export function buildLiteExportArgs(input) {
  const ffmpeg = String(input?.ffmpeg || "ffmpeg");
  const source = String(input?.sourcePath || "");
  const outputTmp = String(input?.outputTmpPath || "");
  const durationSec = liteExportDurationSec(input?.durationSec);
  const fps = Math.max(1, Math.round(Number(input?.fps || 24)));
  if (!source || !outputTmp) throw new Error("Export requires source and temporary output paths.");
  const audio = input?.hasAudio
    ? ["-c:a", "aac", "-ac", "2", "-b:a", "128k"]
    : ["-an"];
  return [
    ffmpeg,
    "-y",
    "-i",
    source,
    "-t",
    durationSec.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    ...audio,
    outputTmp,
  ];
}

export function missingFfmpegResult() {
  return {
    ok: false,
    ffmpeg: null,
    ffprobe: null,
    reason: "FFmpeg/FFprobe is unavailable. Premiere316 will not download it or fake an MP4.",
  };
}

export function provenanceImported() {
  return "imported";
}
