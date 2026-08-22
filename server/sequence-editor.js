import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadProject,
  mediaDir,
  saveProject
} from "./projects.js";
import { projectDir } from "./paths.js";
import {
  appendBlackTail,
  concatVideoSegments,
  mixTimelineAudio,
  probeMedia
} from "./ffmpeg.js";

export const EDIT_DOCUMENT_SCHEMA = "premiere316.edit.v1";
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;
const AUDIO_RE = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
const MIN_PLAYABLE_BYTES = 1024;
const MAX_VIDEO_ITEMS = 2000;
const MAX_AUDIO_ITEMS = 64;
const MAX_DURATION_SEC = 24 * 60 * 60;
const MAX_FPS = 240;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function cleanText(value, fallback, max = 240) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, max) || String(fallback || "Untitled");
}

function cleanId(value, prefix) {
  const source = String(value || "").trim();
  if (source && /^[a-zA-Z0-9_.:-]{1,180}$/.test(source)) return source;
  return `${prefix}_${crypto.randomUUID()}`;
}

function safeRelative(value) {
  const normalized = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Editor media path is invalid");
  }
  return normalized;
}

function sourcePath(slug, relativeFile, kind) {
  const relative = safeRelative(relativeFile);
  const allowed = kind === "video"
    ? (/^media\/clips\/(?:(?:H|MV)\d{2}\/)?[^/]+$/i.test(relative) || /^media\/video\/[^/]+$/i.test(relative)) && VIDEO_RE.test(relative)
    : /^media\/(audio|assets)\/[^/]+$/i.test(relative) && AUDIO_RE.test(relative);
  if (!allowed) throw new Error(`Unsupported ${kind} source: ${relative}`);
  const root = path.resolve(projectDir(slug));
  const disk = path.resolve(root, ...relative.split("/"));
  if (disk !== root && !disk.startsWith(`${root}${path.sep}`)) throw new Error("Editor media escaped the project root");
  return { relative, disk };
}

function statMaybe(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function editDocumentPath(slug) {
  return path.join(projectDir(slug), "production", "edit-sequence.json");
}

function mediaCachePath(slug) {
  return path.join(projectDir(slug), "production", "edit-media-cache.json");
}

function defaultTrackSettings() {
  return {
    V1: { muted: false, locked: false, volumeDb: 0 },
    A1: { muted: false, locked: false, volumeDb: 0 },
    M1: { muted: false, locked: false, volumeDb: 0 }
  };
}

function evenDimension(value, fallback) {
  const rounded = Math.max(2, Math.min(8192, Math.round(finite(value, fallback))));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function normalizeOrigin(value, kind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  const textFields = kind === "video"
    ? ["clipId", "sceneId", "segmentId", "takeId", "source"]
    : ["assetId", "source"];
  for (const field of textFields) {
    const text = String(value[field] || "").trim().slice(0, 240);
    if (text) output[field] = text;
  }
  if (kind === "video" && value.takeNumber != null && Number.isFinite(Number(value.takeNumber))) {
    output.takeNumber = Math.max(0, Math.round(Number(value.takeNumber)));
  }
  return Object.keys(output).length ? output : null;
}

function validatePinnedStat(item, stat, relative, kind, validateFiles) {
  if (!validateFiles || !stat) return;
  if (item?.sourceBytes != null && Number(item.sourceBytes) !== Number(stat.size)) {
    throw new Error(`${kind} source changed since it was added to the edit: ${relative}`);
  }
  if (item?.sourceMtimeMs != null && Math.abs(Math.round(Number(item.sourceMtimeMs)) - Math.round(stat.mtimeMs)) > 1) {
    throw new Error(`${kind} source changed since it was added to the edit: ${relative}`);
  }
}

function defaultSequence(project) {
  return {
    id: "main",
    name: `${project.name} · Main Edit`,
    fps: Math.min(MAX_FPS, Math.max(1, finite(project.settings?.fps, 24))),
    width: evenDimension(project.settings?.width, 1920),
    height: evenDimension(project.settings?.height, 1080),
    videoClips: [],
    audioClips: [],
    trackSettings: defaultTrackSettings(),
    updatedAt: new Date().toISOString()
  };
}

function emptyDocument(project) {
  return {
    schemaVersion: EDIT_DOCUMENT_SCHEMA,
    projectSlug: project.slug,
    revision: 0,
    updatedAt: new Date().toISOString(),
    sequence: defaultSequence(project),
    imports: [],
    exports: [],
    activeExportVersion: 0
  };
}

function normalizeTrackSettings(value) {
  const defaults = defaultTrackSettings();
  for (const track of Object.keys(defaults)) {
    const source = value?.[track] || {};
    const defaultVolumeDb = defaults[track].volumeDb;
    defaults[track] = {
      muted: source.muted === true,
      locked: source.locked === true,
      volumeDb: clamp(finite(source.volumeDb, defaultVolumeDb), -60, 12)
    };
  }
  return defaults;
}

export function normalizeEditSequence(project, value, { validateFiles = false } = {}) {
  const fps = Math.min(MAX_FPS, Math.max(1, finite(value?.fps, project.settings?.fps || 24)));
  const snap = (seconds) => Math.round(clamp(seconds, 0, MAX_DURATION_SEC) * fps) / fps;
  const seen = new Set();
  let cursor = 0;
  const requestedVideos = Array.isArray(value?.videoClips) ? value.videoClips : [];
  const requestedAudio = Array.isArray(value?.audioClips) ? value.audioClips : [];
  if (requestedVideos.length > MAX_VIDEO_ITEMS) throw new Error(`An edit can contain at most ${MAX_VIDEO_ITEMS} video clips`);
  if (requestedAudio.length > MAX_AUDIO_ITEMS) throw new Error(`An edit can contain at most ${MAX_AUDIO_ITEMS} positioned audio clips`);
  const videoClips = requestedVideos.map((item, index) => {
    const id = cleanId(item?.id, "editv");
    if (seen.has(id)) throw new Error(`Duplicate editor item id: ${id}`);
    seen.add(id);
    const source = sourcePath(project.slug, item?.sourceFile, "video");
    const stat = statMaybe(source.disk);
    if (validateFiles && (!stat || stat.size < MIN_PLAYABLE_BYTES)) throw new Error(`Video source is missing or incomplete: ${source.relative}`);
    validatePinnedStat(item, stat, source.relative, "Video", validateFiles);
    const sourceDurationSec = clamp(item?.sourceDurationSec || item?.sourceOutSec || item?.durationSec, 1 / fps, MAX_DURATION_SEC);
    const sourceInSec = Math.min(sourceDurationSec - (1 / fps), snap(item?.sourceInSec));
    const sourceOutSec = Math.max(sourceInSec + (1 / fps), Math.min(sourceDurationSec, snap(item?.sourceOutSec || sourceDurationSec)));
    const durationSec = sourceOutSec - sourceInSec;
    const clip = {
      id,
      mediaId: cleanText(item?.mediaId, `video:${path.basename(source.relative)}`, 300),
      name: cleanText(item?.name, path.parse(source.relative).name),
      sourceFile: source.relative,
      sourceBytes: finite(item?.sourceBytes) || stat?.size || null,
      sourceMtimeMs: finite(item?.sourceMtimeMs) || (stat ? Math.round(stat.mtimeMs) : null),
      sourceSha256: /^[a-f0-9]{64}$/i.test(String(item?.sourceSha256 || "")) ? String(item.sourceSha256).toLowerCase() : null,
      sourceDurationSec,
      sourceInSec,
      sourceOutSec,
      durationSec,
      timelineStartSec: cursor,
      order: index,
      muted: item?.muted === true,
      volumeDb: clamp(finite(item?.volumeDb, 0), -60, 12),
      track: "V1",
      origin: normalizeOrigin(item?.origin, "video")
    };
    cursor += durationSec;
    return clip;
  });

  const audioClips = requestedAudio.map((item) => {
    const id = cleanId(item?.id, "edita");
    if (seen.has(id)) throw new Error(`Duplicate editor item id: ${id}`);
    seen.add(id);
    const source = sourcePath(project.slug, item?.sourceFile, "audio");
    const stat = statMaybe(source.disk);
    if (validateFiles && (!stat || stat.size < 64)) throw new Error(`Audio source is missing or incomplete: ${source.relative}`);
    validatePinnedStat(item, stat, source.relative, "Audio", validateFiles);
    const sourceDurationSec = clamp(item?.sourceDurationSec || item?.sourceOutSec || item?.durationSec, 0.001, MAX_DURATION_SEC);
    const sourceInSec = clamp(item?.sourceInSec, 0, Math.max(0, sourceDurationSec - 0.001));
    const sourceOutSec = Math.max(sourceInSec + 0.001, Math.min(sourceDurationSec, finite(item?.sourceOutSec, sourceDurationSec)));
    const requestedDuration = clamp(item?.durationSec || (sourceOutSec - sourceInSec), 0.001, MAX_DURATION_SEC);
    return {
      id,
      mediaId: cleanText(item?.mediaId, `audio:${path.basename(source.relative)}`, 300),
      name: cleanText(item?.name, path.parse(source.relative).name),
      sourceFile: source.relative,
      sourceBytes: finite(item?.sourceBytes) || stat?.size || null,
      sourceMtimeMs: finite(item?.sourceMtimeMs) || (stat ? Math.round(stat.mtimeMs) : null),
      sourceSha256: /^[a-f0-9]{64}$/i.test(String(item?.sourceSha256 || "")) ? String(item.sourceSha256).toLowerCase() : null,
      sourceDurationSec,
      sourceInSec,
      sourceOutSec,
      durationSec: Math.min(requestedDuration, item?.loop === true ? MAX_DURATION_SEC : sourceOutSec - sourceInSec),
      timelineStartSec: snap(item?.timelineStartSec),
      track: item?.track === "M1" ? "M1" : "A1",
      volumeDb: clamp(finite(item?.volumeDb, 0), -60, 12),
      fadeInSec: clamp(item?.fadeInSec, 0, requestedDuration),
      fadeOutSec: clamp(item?.fadeOutSec, 0, requestedDuration),
      loop: item?.loop === true,
      muted: item?.muted === true,
      origin: normalizeOrigin(item?.origin, "audio")
    };
  });

  const trackSettings = normalizeTrackSettings(value?.trackSettings);
  return {
    id: cleanId(value?.id || "main", "sequence"),
    name: cleanText(value?.name, `${project.name} · Main Edit`),
    fps,
    width: evenDimension(value?.width, project.settings?.width || 1920),
    height: evenDimension(value?.height, project.settings?.height || 1080),
    videoClips,
    audioClips,
    trackSettings,
    durationSec: Math.max(
      cursor,
      ...audioClips.filter((clip) => !clip.muted && !trackSettings[clip.track]?.muted).map((clip) => clip.timelineStartSec + clip.durationSec),
      0
    ),
    updatedAt: Number.isFinite(Date.parse(String(value?.updatedAt || "")))
      ? new Date(value.updatedAt).toISOString()
      : null
  };
}

export function loadEditDocument(slug) {
  const project = loadProject(slug);
  const file = editDocumentPath(project.slug);
  if (!fs.existsSync(file)) return emptyDocument(project);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...emptyDocument(project),
    ...parsed,
    schemaVersion: EDIT_DOCUMENT_SCHEMA,
    projectSlug: project.slug,
    revision: Math.max(0, Math.round(finite(parsed.revision))),
    sequence: normalizeEditSequence(project, parsed.sequence),
    imports: Array.isArray(parsed.imports) ? parsed.imports : [],
    exports: Array.isArray(parsed.exports) ? parsed.exports : [],
    activeExportVersion: Math.max(0, Math.round(finite(parsed.activeExportVersion)))
  };
}

export function saveEditSequence(slug, sequence, expectedRevision) {
  if (!sequence || typeof sequence !== "object" || !Array.isArray(sequence.videoClips) || !Array.isArray(sequence.audioClips)) {
    throw new Error("A complete editor sequence with videoClips and audioClips is required");
  }
  if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) {
    throw new Error("expectedRevision is required to protect the edit from accidental overwrite");
  }
  const project = loadProject(slug);
  const current = loadEditDocument(project.slug);
  if (Number(expectedRevision) !== Number(current.revision)) {
    const error = new Error(`This edit changed in another tab (expected revision ${expectedRevision}, current ${current.revision}). Reload before saving.`);
    error.code = "EDIT_REVISION_CONFLICT";
    error.current = current;
    throw error;
  }
  const updatedAt = new Date().toISOString();
  const normalized = normalizeEditSequence(project, sequence, { validateFiles: true });
  normalized.updatedAt = updatedAt;
  const next = {
    ...current,
    revision: current.revision + 1,
    updatedAt,
    sequence: normalized
  };
  writeJsonAtomic(editDocumentPath(project.slug), next);
  return next;
}

function readStoryboard(slug) {
  const file = path.join(projectDir(slug), "production", "storyboard.json");
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function generatedFile(version) {
  const value = version?.file || version?.previewFile || version?.generatedInputPath || version?.outputFile || version?.files?.[0];
  if (!value) return null;
  const relative = safeRelative(value);
  if (relative.startsWith("media/")) return relative;
  return /^(?:H|MV)\d{2}\/[^/]+$/i.test(relative)
    ? `media/clips/${relative}`
    : `media/clips/${path.basename(relative)}`;
}

function clipFilesOnDisk(clipsDir) {
  if (!fs.existsSync(clipsDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(clipsDir, { withFileTypes: true })) {
    if (entry.isFile() && VIDEO_RE.test(entry.name)) {
      files.push(entry.name);
      continue;
    }
    if (!entry.isDirectory() || !/^(?:H|MV)\d{2}$/i.test(entry.name)) continue;
    const chapterDir = path.join(clipsDir, entry.name);
    for (const chapterEntry of fs.readdirSync(chapterDir, { withFileTypes: true })) {
      if (chapterEntry.isFile() && VIDEO_RE.test(chapterEntry.name)) {
        files.push(`${entry.name}/${chapterEntry.name}`);
      }
    }
  }
  return files;
}

function shaFromVersion(version, relative) {
  const target = path.basename(relative).toLowerCase();
  const record = (version?.fileHashes || []).find((entry) => path.basename(String(entry?.file || "")).toLowerCase() === target);
  return /^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")) ? String(record.sha256).toLowerCase() : null;
}

function takeNumber(relative) {
  const match = path.basename(relative).match(/_director_v(\d+)/i);
  return match ? Number(match[1]) : null;
}

function fileVariant(relative) {
  const name = path.basename(relative).toLowerCase();
  if (name.includes(".video-only.")) return "video-only";
  if (/-audio\.[a-z0-9]+$/.test(name)) return "audio-mux";
  return "editorial";
}

function versionDuration(version) {
  return finite(version?.mediaInfo?.durationSec)
    || finite(version?.mediaInfo?.video?.duration)
    || 0;
}

function mediaId(kind, relative) {
  return `${kind}:${crypto.createHash("sha1").update(relative).digest("hex").slice(0, 20)}`;
}

function cachedMedia(cache, relative, stat) {
  const item = cache?.files?.[relative];
  if (!item || Number(item.bytes) !== Number(stat?.size) || Number(item.mtimeMs) !== Math.round(Number(stat?.mtimeMs))) return null;
  return item.probe || null;
}

function readMediaCache(slug) {
  try {
    const parsed = JSON.parse(fs.readFileSync(mediaCachePath(slug), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { files: {} };
  } catch {
    return { schemaVersion: 1, files: {} };
  }
}

function videoLibrary(project, storyboard, mediaCache, document) {
  const records = new Map();
  const fps = Math.max(1, finite(storyboard?.defaults?.fps, project.settings?.fps || 24));
  const segmentEntries = Object.entries(storyboard?.segments || {});
  for (const [segmentId, segment] of segmentEntries) {
    const clipId = String(segment?.videoPlanId || "").replace(/^video-/i, "").toUpperCase()
      || String(segmentId).replace(/^segment-/i, "").replace(/-\d+$/i, "").toUpperCase();
    const clip = storyboard?.clips?.[clipId] || null;
    const scene = storyboard?.scenes?.[clip?.sceneId] || null;
    const versions = Array.isArray(segment?.generatedVersions) ? segment.generatedVersions : [];
    const active = versions.find((version) => String(version?.id || "") === String(segment?.activeTakeId || ""))
      || versions.find((version) => Number(version?.v) === Number(segment?.activeGeneratedVersion));
    const activeFile = active ? generatedFile(active) : null;
    for (const version of versions) {
      const relative = generatedFile(version);
      if (!relative || !VIDEO_RE.test(relative)) continue;
      const existing = records.get(relative) || {};
      records.set(relative, {
        ...existing,
        relativeFile: relative,
        clipId: clip?.id || clipId || null,
        clipName: clip?.beat || clip?.id || clipId || "LTX clip",
        sceneId: clip?.sceneId || null,
        sceneTitle: scene?.title || clip?.sceneId || "Unassigned scene",
        chapterId: scene?.chapterId || null,
        segmentId,
        segmentOrder: finite(segment?.order),
        editorialIndex: finite(clip?.timelineStartFrame) + finite(segment?.startFrame),
        takeId: version?.id || null,
        recordedVersion: finite(version?.v) || null,
        takeNumber: takeNumber(relative),
        durationSec: versionDuration(version),
        fps: finite(version?.fps, fps),
        width: finite(version?.width || version?.mediaInfo?.video?.width) || null,
        height: finite(version?.height || version?.mediaInfo?.video?.height) || null,
        hasAudio: version?.mediaInfo?.audio ? true : version?.mediaInfo ? false : null,
        source: version?.source || "ltx-director",
        workflowId: version?.workflowId || null,
        sha256: shaFromVersion(version, relative),
        createdAt: version?.createdAt || null,
        isActiveTake: relative === activeFile,
        activeTakeLocked: segment?.activeTakeLocked === true,
        prompt: String(segment?.prompt || "").trim().slice(0, 500)
      });
    }
  }

  for (const clip of project.sequence?.clips || []) {
    for (const version of [...(clip.versions || []), ...(clip.rangeVersions || [])]) {
      if (!version?.file) continue;
      const relative = generatedFile(version);
      if (!relative || !VIDEO_RE.test(relative)) continue;
      if (!records.has(relative)) records.set(relative, {
        relativeFile: relative,
        clipId: clip.id,
        clipName: clip.name,
        sceneId: null,
        sceneTitle: "Premiere316 renders",
        segmentId: null,
        segmentOrder: 0,
        editorialIndex: finite(clip.startSec) * fps,
        takeId: null,
        recordedVersion: finite(version.v) || null,
        takeNumber: finite(version.v) || null,
        durationSec: finite(version.durationSec, clip.durationSec),
        fps,
        width: project.settings?.width,
        height: project.settings?.height,
        hasAudio: null,
        source: version.source || "premiere316",
        createdAt: version.createdAt || null,
        isActiveTake: Number(version.v) === Number(clip.activeVersion),
        activeTakeLocked: false
      });
    }
  }

  const clipsDir = mediaDir(project, "clips");
  if (fs.existsSync(clipsDir)) {
    for (const clipFile of clipFilesOnDisk(clipsDir)) {
      const name = path.basename(clipFile);
      const relative = `media/clips/${clipFile.replaceAll("\\", "/")}`;
      if (!records.has(relative)) {
        const match = name.match(/^(.+?)_(segment-.+?)_director_v(\d+)/i);
        const segment = match ? storyboard?.segments?.[match[2]] : null;
        const clipId = match?.[1] || null;
        const clip = clipId ? storyboard?.clips?.[clipId.toUpperCase()] : null;
        const scene = clip ? storyboard?.scenes?.[clip.sceneId] : null;
        records.set(relative, {
          relativeFile: relative,
          clipId: clip?.id || clipId,
          clipName: clip?.beat || clip?.id || clipId || path.parse(name).name,
          sceneId: clip?.sceneId || null,
          sceneTitle: scene?.title || clip?.sceneId || "Unregistered media",
          chapterId: scene?.chapterId || null,
          segmentId: segment?.id || match?.[2] || null,
          segmentOrder: finite(segment?.order),
          editorialIndex: finite(clip?.timelineStartFrame, Number.MAX_SAFE_INTEGER / 2) + finite(segment?.startFrame),
          takeId: null,
          recordedVersion: null,
          takeNumber: takeNumber(relative),
          durationSec: 0,
          fps,
          width: null,
          height: null,
          hasAudio: null,
          source: "disk",
          createdAt: null,
          isActiveTake: false,
          activeTakeLocked: false
        });
      }
    }
  }

  for (const entry of document?.imports || []) {
    const relative = String(entry?.relativeFile || "").replaceAll("\\", "/");
    if (!relative || !VIDEO_RE.test(relative) || records.has(relative)) continue;
    records.set(relative, {
      relativeFile: relative,
      clipId: null,
      clipName: entry.name || path.parse(relative).name,
      sceneId: null,
      sceneTitle: "Imported media",
      segmentId: null,
      segmentOrder: 0,
      editorialIndex: Number.MAX_SAFE_INTEGER / 2,
      takeId: null,
      recordedVersion: null,
      takeNumber: null,
      durationSec: finite(entry.durationSec || entry.mediaInfo?.durationSec),
      fps,
      width: null,
      height: null,
      hasAudio: Boolean(entry.mediaInfo?.audio),
      source: entry.source || "sequence-editor-import",
      createdAt: entry.createdAt || null,
      isActiveTake: false,
      activeTakeLocked: false
    });
  }

  const items = [...records.values()].map((record) => {

    let disk = null;
    try { disk = sourcePath(project.slug, record.relativeFile, "video").disk; } catch {}
    const stat = disk ? statMaybe(disk) : null;
    const cached = stat ? cachedMedia(mediaCache, record.relativeFile, stat) : null;
    const durationSec = finite(cached?.durationSec) || finite(record.durationSec);
    const width = finite(cached?.video?.width) || finite(record.width) || null;
    const height = finite(cached?.video?.height) || finite(record.height) || null;
    const hasAudio = cached ? Boolean(cached.audio) : record.hasAudio;
    const available = Boolean(stat && stat.size >= MIN_PLAYABLE_BYTES);
    const variant = fileVariant(record.relativeFile);
    return {
      id: mediaId("video", record.relativeFile),
      kind: "video",
      name: `${record.clipId || "Video"}${record.segmentId ? ` · ${record.segmentId.replace(/^segment-/i, "S")}` : ""}${record.takeNumber != null ? ` · Take ${record.takeNumber}` : ""}`,
      fileName: path.basename(record.relativeFile),
      ...record,
      variant,
      durationSec,
      width,
      height,
      hasAudio,
      bytes: stat?.size || null,
      mtimeMs: stat ? Math.round(stat.mtimeMs) : null,
      createdAt: record.createdAt || (stat ? stat.mtime.toISOString() : null),
      available,
      issue: !stat ? "File missing" : stat.size < MIN_PLAYABLE_BYTES ? "Incomplete output" : null,
      metadataStatus: cached ? "probed" : durationSec > 0 ? "recorded" : "unprobed"
    };
  });

  const latestBySegment = new Map();
  for (const item of items.filter((entry) => entry.available && entry.variant === "editorial")) {
    const key = item.segmentId || item.id;
    const previous = latestBySegment.get(key);
    if (!previous || finite(item.takeNumber) > finite(previous.takeNumber)) latestBySegment.set(key, item);
  }
  for (const item of items) item.isLatestTake = latestBySegment.get(item.segmentId || item.id)?.id === item.id;
  return items.sort((left, right) =>
    finite(left.editorialIndex, Number.MAX_SAFE_INTEGER) - finite(right.editorialIndex, Number.MAX_SAFE_INTEGER)
    || String(left.segmentId || "").localeCompare(String(right.segmentId || ""))
    || finite(right.takeNumber) - finite(left.takeNumber)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  );
}

function audioVersionMetadata(project) {
  const byFile = new Map();
  for (const version of project.score?.versions || []) {
    if (version?.file) byFile.set(`media/audio/${path.basename(version.file)}`, { ...version, source: version.source || "score" });
  }
  for (const asset of project.assets?.items || []) {
    for (const version of asset.versions || []) {
      const files = [version.file, version.outputFile, ...(version.files || [])].filter(Boolean);
      for (const file of files) {
        if (!AUDIO_RE.test(file)) continue;
        const relative = String(file).replaceAll("\\", "/").startsWith("media/")
          ? String(file).replaceAll("\\", "/")
          : `media/assets/${path.basename(file)}`;
        byFile.set(relative, { ...version, assetId: asset.id, name: asset.name || version.name, source: version.source || "asset-foundry" });
      }
    }
  }
  return byFile;
}

function audioLibrary(project, document, mediaCache) {
  const metadata = audioVersionMetadata(project);
  for (const entry of document.imports || []) {
    if (entry?.relativeFile) metadata.set(entry.relativeFile, entry);
  }
  const found = new Set(metadata.keys());
  for (const kind of ["audio", "assets"]) {
    const dir = mediaDir(project, kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (AUDIO_RE.test(name)) found.add(`media/${kind}/${name}`);
    }
  }
  return [...found].map((relative) => {
    const meta = metadata.get(relative) || {};
    let disk = null;
    try { disk = sourcePath(project.slug, relative, "audio").disk; } catch {}
    const stat = disk ? statMaybe(disk) : null;
    const cached = stat ? cachedMedia(mediaCache, relative, stat) : null;
    return {
      id: mediaId("audio", relative),
      kind: "audio",
      name: cleanText(meta.name, path.parse(relative).name),
      fileName: path.basename(relative),
      relativeFile: relative,
      durationSec: finite(cached?.durationSec) || finite(meta.durationSec || meta.mediaInfo?.durationSec),
      sampleRate: cached?.audio?.sample_rate ? Number(cached.audio.sample_rate) : finite(meta.mediaInfo?.audio?.sample_rate) || null,
      channels: cached?.audio?.channels ? Number(cached.audio.channels) : finite(meta.mediaInfo?.audio?.channels) || null,
      bytes: stat?.size || null,
      mtimeMs: stat ? Math.round(stat.mtimeMs) : null,
      source: meta.source || "project-audio",
      assetId: meta.assetId || null,
      createdAt: meta.createdAt || (stat ? stat.mtime.toISOString() : null),
      available: Boolean(stat && stat.size >= 64),
      issue: !stat ? "File missing" : stat.size < 64 ? "Incomplete audio" : null,
      metadataStatus: cached ? "probed" : finite(meta.durationSec) ? "recorded" : "unprobed"
    };
  }).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")) || left.name.localeCompare(right.name));
}

export function editorWorkspace(slug) {
  const project = loadProject(slug);
  const document = loadEditDocument(project.slug);
  const storyboard = readStoryboard(project.slug);
  const mediaCache = readMediaCache(project.slug);
  const videos = videoLibrary(project, storyboard, mediaCache, document);
  const audio = audioLibrary(project, document, mediaCache);
  return {
    project: {
      slug: project.slug,
      name: project.name,
      settings: project.settings,
      category: project.category
    },
    document,
    library: {
      videos,
      audio,
      counts: {
        videos: videos.length,
        playableVideos: videos.filter((item) => item.available).length,
        activeTakes: videos.filter((item) => item.isActiveTake && item.available).length,
        missingVideos: videos.filter((item) => !item.available).length,
        audio: audio.length,
        playableAudio: audio.filter((item) => item.available).length
      }
    }
  };
}

async function mapConcurrent(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function probeEditorMedia(slug, files) {
  const project = loadProject(slug);
  const requested = [...new Set((Array.isArray(files) ? files : []).map((file) => safeRelative(file)))].slice(0, 120);
  const cache = readMediaCache(project.slug);
  cache.schemaVersion = 1;
  cache.files = cache.files || {};
  const results = await mapConcurrent(requested, 3, async (relative) => {
    const kind = VIDEO_RE.test(relative) ? "video" : "audio";
    const source = sourcePath(project.slug, relative, kind);
    const stat = statMaybe(source.disk);
    if (!stat || stat.size < (kind === "video" ? MIN_PLAYABLE_BYTES : 64)) {
      return { relativeFile: relative, ok: false, error: !stat ? "File missing" : "File is incomplete" };
    }
    const cached = cache.files[relative];
    let probe = cached && Number(cached.bytes) === Number(stat.size) && Number(cached.mtimeMs) === Math.round(stat.mtimeMs)
      ? cached.probe
      : null;
    if (!probe) probe = await probeMedia(source.disk);
    cache.files[relative] = { bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs), probe, probedAt: new Date().toISOString() };
    return { relativeFile: relative, ok: true, bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs), probe };
  });
  cache.updatedAt = new Date().toISOString();
  writeJsonAtomic(mediaCachePath(project.slug), cache);
  return results;
}

export async function importEditorAudio(slug, file) {
  const project = loadProject(slug);
  if (!file?.buffer?.length) throw new Error("Audio file required");
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  if (!AUDIO_RE.test(extension)) throw new Error("Use WAV, MP3, M4A, AAC, FLAC, OGG, OPUS, AIF, or AIFF audio");
  const base = path.basename(String(file.originalname || `audio${extension}`), extension)
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "audio";
  const name = `edit_${Date.now()}_${base}${extension}`;
  const disk = path.join(mediaDir(project, "audio"), name);
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  fs.writeFileSync(disk, file.buffer);
  let probe;
  try {
    probe = await probeMedia(disk);
    if (!probe.audio) throw new Error("No audio stream found");
  } catch (error) {
    try { fs.unlinkSync(disk); } catch {}
    throw new Error(`Audio import failed: ${String(error.message || error)}`);
  }
  const relativeFile = `media/audio/${name}`;
  const stat = fs.statSync(disk);
  const document = loadEditDocument(project.slug);
  document.imports = [...(document.imports || []), {
    id: mediaId("audio", relativeFile),
    name: path.basename(String(file.originalname || name)),
    relativeFile,
    bytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    durationSec: probe.durationSec,
    mediaInfo: probe,
    source: "sequence-editor-import",
    createdAt: new Date().toISOString()
  }];
  document.updatedAt = new Date().toISOString();
  writeJsonAtomic(editDocumentPath(project.slug), document);
  const cache = readMediaCache(project.slug);
  cache.files = cache.files || {};
  cache.files[relativeFile] = { bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs), probe, probedAt: new Date().toISOString() };
  cache.updatedAt = new Date().toISOString();
  writeJsonAtomic(mediaCachePath(project.slug), cache);
  return { relativeFile, probe, bytes: stat.size };
}


export async function importEditorVideo(slug, file) {
  const project = loadProject(slug);
  if (!file?.buffer?.length) throw new Error("Video file required");
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  if (!VIDEO_RE.test(extension)) throw new Error("Use MP4, WEBM, MOV, MKV, or M4V video");
  const base = path.basename(String(file.originalname || `video${extension}`), extension)
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "video";
  const name = `edit_${Date.now()}_${base}${extension}`;
  const disk = path.join(mediaDir(project, "video"), name);
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  if (fs.existsSync(disk)) throw new Error("Refusing to overwrite an existing video file");
  fs.writeFileSync(disk, file.buffer);
  let probe;
  try {
    probe = await probeMedia(disk);
    if (!probe.video) throw new Error("No video stream found");
  } catch (error) {
    try { fs.unlinkSync(disk); } catch {}
    throw new Error(`Video import failed: ${String(error.message || error)}`);
  }
  const relativeFile = `media/video/${name}`;
  const stat = fs.statSync(disk);
  const document = loadEditDocument(project.slug);
  document.imports = [...(document.imports || []), {
    id: mediaId("video", relativeFile),
    name: path.basename(String(file.originalname || name)),
    relativeFile,
    bytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    durationSec: probe.durationSec,
    mediaInfo: probe,
    source: "sequence-editor-import",
    createdAt: new Date().toISOString()
  }];
  document.updatedAt = new Date().toISOString();
  writeJsonAtomic(editDocumentPath(project.slug), document);
  const cache = readMediaCache(project.slug);
  cache.files = cache.files || {};
  cache.files[relativeFile] = { bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs), probe, probedAt: new Date().toISOString() };
  cache.updatedAt = new Date().toISOString();
  writeJsonAtomic(mediaCachePath(project.slug), cache);
  return { relativeFile, probe, bytes: stat.size };
}

function nextVersion(items = []) {
  return Math.max(0, ...items.map((item) => finite(item?.v))) + 1;
}

export function editSequenceFingerprint(sequence, revision) {
  const { updatedAt: _updatedAt, ...content } = sequence || {};
  return crypto.createHash("sha256")
    .update(JSON.stringify({ schemaVersion: EDIT_DOCUMENT_SCHEMA, revision: Number(revision) || 0, sequence: content }))
    .digest("hex");
}

function cancelledError() {
  const error = new Error("Editor export cancelled");
  error.code = "GENERATION_CANCELLED";
  return error;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelledError();
}

function sha256File(file, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
    const onAbort = () => stream.destroy(cancelledError());
    signal?.addEventListener?.("abort", onAbort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", (error) => {
      cleanup();
      reject(signal?.aborted ? cancelledError() : error);
    });
    stream.once("end", () => {
      cleanup();
      resolve(hash.digest("hex"));
    });
  });
}

async function validateExportSources(project, sequence, signal) {
  const requested = new Map();
  for (const [kind, clips] of [["video", sequence.videoClips], ["audio", sequence.audioClips]]) {
    for (const clip of clips) {
      const key = `${kind}:${clip.sourceFile}`;
      const existing = requested.get(key) || { kind, relativeFile: clip.sourceFile, sourceOutSec: 0, hashes: new Set() };
      existing.sourceOutSec = Math.max(existing.sourceOutSec, finite(clip.sourceOutSec));
      if (clip.sourceSha256) existing.hashes.add(String(clip.sourceSha256).toLowerCase());
      requested.set(key, existing);
    }
  }
  await mapConcurrent([...requested.values()], 3, async (entry) => {
    throwIfCancelled(signal);
    if (entry.hashes.size > 1) throw new Error(`Conflicting source fingerprints: ${entry.relativeFile}`);
    const source = sourcePath(project.slug, entry.relativeFile, entry.kind);
    const probe = await probeMedia(source.disk, { signal });
    const stream = entry.kind === "video" ? probe.video : probe.audio;
    if (!stream) throw new Error(`${entry.kind === "video" ? "Video" : "Audio"} stream missing: ${entry.relativeFile}`);
    const actualDuration = finite(stream.duration) || finite(probe.durationSec);
    const tolerance = entry.kind === "video" ? Math.max(0.05, 1 / sequence.fps) : 0.05;
    if (!(actualDuration > 0) || entry.sourceOutSec > actualDuration + tolerance) {
      throw new Error(`${entry.relativeFile} is ${actualDuration.toFixed(3)}s but the edit requests media through ${entry.sourceOutSec.toFixed(3)}s`);
    }
    const expectedHash = [...entry.hashes][0];
    if (expectedHash) {
      const actualHash = await sha256File(source.disk, signal);
      if (actualHash !== expectedHash) throw new Error(`Source fingerprint changed since it was added to the edit: ${entry.relativeFile}`);
    }
  });
}

export async function buildEditMasterJob(job) {
  const project = loadProject(job.projectSlug);
  const current = loadEditDocument(project.slug);
  const requested = job.sequenceSnapshot || job.refs?.sequence || current.sequence;
  const sequence = normalizeEditSequence(project, requested, { validateFiles: true });
  if (!sequence.videoClips.length) throw new Error("Add at least one video clip to the edit before exporting");
  const revision = Number(job.refs?.revision ?? current.revision);
  const fingerprint = editSequenceFingerprint(sequence, revision);
  const exportVersion = nextVersion(current.exports || []);
  const stem = `${project.slug}_edit_v${String(exportVersion).padStart(2, "0")}`;
  const pictureBase = path.join(mediaDir(project, "masters"), `${stem}_picture.mp4`);
  const pictureExtended = path.join(mediaDir(project, "masters"), `${stem}_picture_extended.mp4`);
  const final = path.join(mediaDir(project, "masters"), `${stem}.mp4`);
  const trackSettings = sequence.trackSettings || defaultTrackSettings();
  job.label = `Export edit · ${sequence.name}`;
  let picture = pictureBase;
  let committed = false;
  let previousEditDocument = null;
  let editDocumentCommitted = false;
  try {
    job.stage = "Checking source media";
    job.progress = 0.02;
    await validateExportSources(project, sequence, job.signal);
    throwIfCancelled(job.signal);

    job.stage = "Conforming picture and embedded sound";
    await concatVideoSegments(sequence.videoClips.map((clip) => ({
      file: sourcePath(project.slug, clip.sourceFile, "video").disk,
      startSec: clip.sourceInSec,
      durationSec: clip.durationSec,
      audioMuted: clip.muted || trackSettings.V1?.muted,
      audioVolumeDb: finite(clip.volumeDb) + finite(trackSettings.V1?.volumeDb)
    })), pictureBase, {
      width: sequence.width,
      height: sequence.height,
      fps: sequence.fps,
      signal: job.signal
    }, (progress) => { job.progress = 0.05 + progress * 0.5; });

    const pictureDuration = sequence.videoClips.reduce((sum, clip) => sum + finite(clip.durationSec), 0);
    const exportDuration = Math.max(pictureDuration, finite(sequence.durationSec));
    const tailDuration = exportDuration - pictureDuration;
    if (tailDuration >= 1 / sequence.fps) {
      job.stage = "Extending picture for the audio tail";
      job.progress = 0.58;
      await appendBlackTail(pictureBase, pictureExtended, tailDuration, {
        width: sequence.width,
        height: sequence.height,
        fps: sequence.fps,
        signal: job.signal
      });
      try { fs.unlinkSync(pictureBase); } catch {}
      picture = pictureExtended;
    }

    const overlays = sequence.audioClips
      .filter((clip) => !clip.muted && !trackSettings[clip.track]?.muted)
      .map((clip) => ({
        ...clip,
        file: sourcePath(project.slug, clip.sourceFile, "audio").disk,
        volumeDb: finite(clip.volumeDb) + finite(trackSettings[clip.track]?.volumeDb)
      }));
    if (overlays.length) {
      job.stage = "Mixing sound effects and music";
      job.progress = 0.66;
      await mixTimelineAudio(picture, overlays, final, {
        durationSec: exportDuration,
        baseAudioMuted: false,
        baseVolumeDb: 0,
        signal: job.signal
      });
      try { fs.unlinkSync(picture); } catch {}
    } else {
      throwIfCancelled(job.signal);
      try { if (fs.existsSync(final)) fs.unlinkSync(final); } catch {}
      fs.renameSync(picture, final);
    }

    job.stage = "Verifying export";
    job.progress = 0.9;
    const info = await probeMedia(final, { signal: job.signal });
    if (!info.video) throw new Error("Export contains no video stream");
    const finalHash = await sha256File(final, job.signal);
    throwIfCancelled(job.signal);
    const completed = loadEditDocument(project.slug);
    previousEditDocument = JSON.parse(JSON.stringify(completed));
    const exportRecord = {
      v: exportVersion,
      file: path.basename(final),
      name: stem,
      source: "sequence-editor",
      sequenceId: sequence.id,
      sequenceRevision: revision,
      sequenceFingerprint: fingerprint,
      createdAt: new Date().toISOString(),
      durationSec: info.durationSec,
      width: Number(info.video.width) || sequence.width,
      height: Number(info.video.height) || sequence.height,
      fps: sequence.fps,
      hasAudio: Boolean(info.audio),
      sha256: finalHash,
      bytes: fs.statSync(final).size,
      mediaInfo: info
    };
    completed.exports = [...(completed.exports || []), exportRecord];
    completed.activeExportVersion = exportVersion;
    completed.updatedAt = new Date().toISOString();
    throwIfCancelled(job.signal);
    writeJsonAtomic(editDocumentPath(project.slug), completed);
    editDocumentCommitted = true;

    const freshProject = loadProject(project.slug);
    const masterVersion = nextVersion(freshProject.masters || []);
    freshProject.masters = [...(freshProject.masters || []), {
      ...exportRecord,
      v: masterVersion,
      editorExportVersion: exportVersion
    }];
    freshProject.activeMasterVersion = masterVersion;
    saveProject(freshProject);
    committed = true;
    job.result = { file: path.basename(final), version: exportVersion, masterVersion, sequenceRevision: revision };
    job.progress = 0.98;
  } catch (error) {
    if (!committed && editDocumentCommitted && previousEditDocument) {
      try { writeJsonAtomic(editDocumentPath(project.slug), previousEditDocument); } catch {}
    }
    for (const file of [pictureBase, pictureExtended]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
    if (!committed) {
      try { if (fs.existsSync(final)) fs.unlinkSync(final); } catch {}
    }
    throw error;
  }
}
