const MIN_CLIP_SECONDS = 1 / 120;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundTime(value) {
  return Math.round(Math.max(0, finite(value)) * 1_000_000) / 1_000_000;
}

function evenDimension(value, fallback) {
  const rounded = Math.max(2, Math.min(8192, Math.round(finite(value, fallback))));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function makeId(prefix) {
  const token = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${token}`;
}

export function projectMediaUrl(slug, relativeFile) {
  const parts = String(relativeFile || "").replaceAll("\\", "/").split("/").filter(Boolean);
  const mediaIndex = parts.lastIndexOf("media");
  const kindIndex = mediaIndex >= 0 ? mediaIndex + 1 : parts.length - 2;
  const kind = parts[kindIndex];
  const mediaPath = parts.slice(kindIndex + 1);
  if (!kind || !mediaPath.length || mediaPath.some((part) => part === "." || part === "..")) return "";
  return ["", "media", slug, kind, ...mediaPath].map((part) => encodeURIComponent(part)).join("/");
}

export function mediaDuration(media, fallback = 5) {
  const duration = finite(media?.durationSec, fallback);
  return Math.max(MIN_CLIP_SECONDS, duration || fallback);
}

export function rippleVideoClips(clips = []) {
  let cursor = 0;
  return clips.map((clip, index) => {
    const sourceInSec = Math.max(0, finite(clip.sourceInSec));
    const sourceOutSec = Math.max(sourceInSec + MIN_CLIP_SECONDS, finite(clip.sourceOutSec, sourceInSec + finite(clip.durationSec, 1)));
    const durationSec = Math.max(MIN_CLIP_SECONDS, sourceOutSec - sourceInSec);
    const next = {
      ...clip,
      order: index,
      sourceInSec: roundTime(sourceInSec),
      sourceOutSec: roundTime(sourceOutSec),
      durationSec: roundTime(durationSec),
      timelineStartSec: roundTime(cursor)
    };
    cursor += durationSec;
    return next;
  });
}

export function sequenceDuration(sequence) {
  const videos = rippleVideoClips(sequence?.videoClips || []);
  const videoEnd = videos.reduce((end, clip) => Math.max(end, clip.timelineStartSec + clip.durationSec), 0);
  const audioEnd = (sequence?.audioClips || []).reduce((end, clip) => {
    if (clip.muted || sequence?.trackSettings?.[clip.track]?.muted) return end;
    return Math.max(end, finite(clip.timelineStartSec) + Math.max(0, finite(clip.durationSec)));
  }, 0);
  return roundTime(Math.max(videoEnd, audioEnd));
}

export function withRipple(sequence, videoClips) {
  return {
    ...sequence,
    videoClips: rippleVideoClips(videoClips),
    updatedAt: new Date().toISOString()
  };
}

export function insertVideo(sequence, media, options = {}) {
  const duration = mediaDuration(media);
  const sourceInSec = Math.min(duration - MIN_CLIP_SECONDS, Math.max(0, finite(options.sourceInSec)));
  const requestedOut = finite(options.sourceOutSec, duration);
  const sourceOutSec = Math.max(sourceInSec + MIN_CLIP_SECONDS, Math.min(duration, requestedOut));
  const clips = [...(sequence?.videoClips || [])];
  const rawIndex = options.atIndex == null ? clips.length : Math.round(finite(options.atIndex, clips.length));
  const atIndex = Math.max(0, Math.min(clips.length, rawIndex));
  clips.splice(atIndex, 0, {
    id: makeId("editv"),
    mediaId: media.id,
    name: media.name || media.fileName || "Video clip",
    sourceFile: media.relativeFile,
    sourceBytes: media.bytes || null,
    sourceMtimeMs: media.mtimeMs || null,
    sourceSha256: media.sha256 || null,
    sourceDurationSec: duration,
    sourceInSec,
    sourceOutSec,
    durationSec: sourceOutSec - sourceInSec,
    timelineStartSec: 0,
    muted: false,
    volumeDb: 0,
    track: "V1",
    origin: {
      clipId: media.clipId || null,
      sceneId: media.sceneId || null,
      segmentId: media.segmentId || null,
      takeId: media.takeId || null,
      takeNumber: media.takeNumber ?? null,
      source: media.source || "ltx-director"
    }
  });
  return withRipple(sequence, clips);
}

export function insertAudio(sequence, media, options = {}) {
  const sourceDuration = mediaDuration(media, 30);
  const sourceInSec = Math.min(sourceDuration - MIN_CLIP_SECONDS, Math.max(0, finite(options.sourceInSec)));
  const sourceOutSec = Math.max(
    sourceInSec + MIN_CLIP_SECONDS,
    Math.min(sourceDuration, finite(options.sourceOutSec, sourceDuration))
  );
  const track = options.track === "M1" ? "M1" : "A1";
  const clip = {
    id: makeId("edita"),
    mediaId: media.id,
    name: media.name || media.fileName || "Audio clip",
    sourceFile: media.relativeFile,
    sourceBytes: media.bytes || null,
    sourceMtimeMs: media.mtimeMs || null,
    sourceSha256: media.sha256 || null,
    sourceDurationSec: sourceDuration,
    sourceInSec,
    sourceOutSec,
    durationSec: sourceOutSec - sourceInSec,
    timelineStartSec: roundTime(options.timelineStartSec),
    track,
    volumeDb: track === "M1" ? -12 : 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    loop: false,
    muted: false,
    origin: {
      assetId: media.assetId || null,
      source: media.source || "project-audio"
    }
  };
  return {
    ...sequence,
    audioClips: [...(sequence?.audioClips || []), clip],
    updatedAt: new Date().toISOString()
  };
}

export function removeTimelineClip(sequence, clipId) {
  const videoClips = (sequence?.videoClips || []).filter((clip) => clip.id !== clipId);
  const audioClips = (sequence?.audioClips || []).filter((clip) => clip.id !== clipId);
  return {
    ...withRipple(sequence, videoClips),
    audioClips
  };
}

export function moveVideoClip(sequence, clipId, targetIndex) {
  const clips = [...(sequence?.videoClips || [])];
  const sourceIndex = clips.findIndex((clip) => clip.id === clipId);
  if (sourceIndex < 0) return sequence;
  const [clip] = clips.splice(sourceIndex, 1);
  const index = Math.max(0, Math.min(clips.length, Math.round(finite(targetIndex))));
  clips.splice(index, 0, clip);
  return withRipple(sequence, clips);
}

export function splitVideoClip(sequence, clipId, playheadSec, fps = 24) {
  const clips = [...(sequence?.videoClips || [])];
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return { sequence, createdClipId: null };
  const clip = clips[index];
  const frame = 1 / Math.max(1, finite(fps, 24));
  const local = finite(playheadSec) - finite(clip.timelineStartSec);
  if (local < frame || local > finite(clip.durationSec) - frame) return { sequence, createdClipId: null };
  const cutSource = finite(clip.sourceInSec) + local;
  const rightId = makeId("editv");
  const left = {
    ...clip,
    sourceOutSec: roundTime(cutSource),
    durationSec: roundTime(local)
  };
  const right = {
    ...clip,
    id: rightId,
    name: `${clip.name} · B`,
    sourceInSec: roundTime(cutSource),
    durationSec: roundTime(finite(clip.sourceOutSec) - cutSource)
  };
  clips.splice(index, 1, left, right);
  return { sequence: withRipple(sequence, clips), createdClipId: rightId };
}

export function trimVideoClip(sequence, clipId, edge, deltaSec, fps = 24) {
  const frame = 1 / Math.max(1, finite(fps, 24));
  const clips = (sequence?.videoClips || []).map((clip) => {
    if (clip.id !== clipId) return clip;
    const sourceDuration = Math.max(frame, finite(clip.sourceDurationSec, clip.sourceOutSec));
    const sourceIn = finite(clip.sourceInSec);
    const sourceOut = finite(clip.sourceOutSec, sourceDuration);
    if (edge === "start") {
      const nextIn = Math.max(0, Math.min(sourceOut - frame, sourceIn + finite(deltaSec)));
      return { ...clip, sourceInSec: nextIn, durationSec: sourceOut - nextIn };
    }
    const nextOut = Math.max(sourceIn + frame, Math.min(sourceDuration, sourceOut + finite(deltaSec)));
    return { ...clip, sourceOutSec: nextOut, durationSec: nextOut - sourceIn };
  });
  return withRipple(sequence, clips);
}

export function moveAudioClip(sequence, clipId, timelineStartSec) {
  return {
    ...sequence,
    audioClips: (sequence?.audioClips || []).map((clip) => clip.id === clipId
      ? { ...clip, timelineStartSec: roundTime(timelineStartSec) }
      : clip),
    updatedAt: new Date().toISOString()
  };
}

export function patchTimelineClip(sequence, clipId, patch) {
  const videoClips = (sequence?.videoClips || []).map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip);
  const audioClips = (sequence?.audioClips || []).map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip);
  return {
    ...withRipple(sequence, videoClips),
    audioClips,
    updatedAt: new Date().toISOString()
  };
}

export function videoClipAtTime(sequence, seconds) {
  const time = Math.max(0, finite(seconds));
  return rippleVideoClips(sequence?.videoClips || []).find((clip, index, clips) => {
    const end = clip.timelineStartSec + clip.durationSec;
    return time >= clip.timelineStartSec && (time < end || (index === clips.length - 1 && time <= end));
  }) || null;
}

export function activeStoryCut(library = [], scope = {}) {
  const candidates = library.filter((media) => {
    if (media.kind !== "video" || !media.isActiveTake) return false;
    if (scope.sceneId && media.sceneId !== scope.sceneId) return false;
    if (scope.clipId && media.clipId !== scope.clipId) return false;
    return true;
  });
  const perSegment = new Map();
  for (const media of candidates) {
    const key = media.segmentId || media.id;
    const previous = perSegment.get(key);
    if (!previous || finite(media.takeNumber) > finite(previous.takeNumber)) perSegment.set(key, media);
  }
  return [...perSegment.values()].sort((left, right) =>
    finite(left.editorialIndex, Number.MAX_SAFE_INTEGER) - finite(right.editorialIndex, Number.MAX_SAFE_INTEGER)
    || String(left.segmentId || left.id).localeCompare(String(right.segmentId || right.id))
  );
}

export function newEditorSequence(project = {}) {
  return {
    id: "main",
    name: `${project.name || "Untitled"} · Main Edit`,
    fps: Math.min(240, Math.max(1, finite(project.fps || project.settings?.fps, 24))),
    width: evenDimension(project.width || project.settings?.width, 1920),
    height: evenDimension(project.height || project.settings?.height, 1080),
    videoClips: [],
    audioClips: [],
    trackSettings: {
      V1: { muted: false, locked: false, volumeDb: 0 },
      A1: { muted: false, locked: false, volumeDb: 0 },
      M1: { muted: false, locked: false, volumeDb: 0 }
    },
    revision: 0,
    updatedAt: new Date().toISOString()
  };
}
