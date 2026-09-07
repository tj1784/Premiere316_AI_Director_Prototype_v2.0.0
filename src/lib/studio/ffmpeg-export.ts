import { hydrateAudioWorkspace } from "../production/audio-types.ts";
import { hydrateVideoWorkspace } from "../production/video-types.ts";
import { shotStarts } from "./prompt-compiler.ts";
import { importedCanonicalFilm } from "./timeline-plan.ts";
import type { Picture } from "./types.ts";

export type ExportPlan = {
  schemaVersion: 1;
  ok: boolean;
  kind: "paper" | "mp4" | "placeholder-montage";
  reason: string;
  fps: number;
  durationSec: number;
  inputs: Array<{ shotId: string; mediaUri: string | null; origin: string; durationSec: number }>;
  ffmpeg: { discovered: boolean; binary: string | null };
};

export function planPictureExport(picture: Picture, ffmpegBinary: string | null = null): ExportPlan {
  const video = hydrateVideoWorkspace(picture.video);
  const audio = hydrateAudioWorkspace(picture.audio);
  const starts = shotStarts(picture);
  const durationSec = starts.at(-1)?.end ?? picture.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const inputs = picture.shots.map((shot) => {
    const canonical = video.takes.find((take) => take.shotId === shot.id && take.canonical);
    return {
      shotId: shot.id,
      mediaUri: canonical?.mediaUri ?? shot.videoUrl ?? null,
      origin: canonical?.origin ?? (shot.videoUrl ? "legacy-url" : shot.stillUrl ? "still-placeholder" : "missing"),
      durationSec: shot.durationSec,
    };
  });
  const imported = inputs.filter((item) => item.origin === "imported" && item.mediaUri);
  const missing = inputs.filter((item) => !item.mediaUri);
  const stillPlaceholders = inputs.filter((item) => item.origin === "still-placeholder");
  if (imported.length && imported.length === picture.shots.length && ffmpegBinary) {
    return { schemaVersion: 1, ok: true, kind: "mp4", reason: "Canonical imported video can be conformed with FFmpeg.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
  }
  if (stillPlaceholders.length && !imported.length) {
    return { schemaVersion: 1, ok: false, kind: "placeholder-montage", reason: "Stills may only be labeled a placeholder/montage export, never native video generation.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: Boolean(ffmpegBinary), binary: ffmpegBinary } };
  }
  if (missing.length && !ffmpegBinary) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: `FFmpeg is not bound. Paper package remains available. ${audio.takes.filter((take) => take.canonical).length} canonical audio take(s).`, fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: false, binary: null } };
  }
  return { schemaVersion: 1, ok: false, kind: "paper", reason: "MP4 export stays fail-closed until FFmpeg is discovered and every shot has canonical imported or native video.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: Boolean(ffmpegBinary), binary: ffmpegBinary } };
}

export function planLiteImportedExport(picture: Picture, ffmpegBinary: string | null = null): ExportPlan {
  const video = hydrateVideoWorkspace(picture.video);
  const canonical = video.takes.filter((take) => take.canonical && take.origin === "imported" && take.mediaUri);
  const durationSec = canonical[0]?.probe?.durationSec ?? 0;
  const inputs = canonical.map((take) => ({ shotId: take.shotId, mediaUri: take.mediaUri, origin: "imported", durationSec: take.probe?.durationSec ?? 0 }));
  if (!ffmpegBinary) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: "FFmpeg/FFprobe is unavailable. Premiere316 will not download it or fake an MP4.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: false, binary: null } };
  }
  if (!canonical.length) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: "Lite MP4 export needs a canonical imported video take.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
  }
  return { schemaVersion: 1, ok: true, kind: "mp4", reason: "Lite export from canonical imported video. Provenance remains imported, not generated.", fps: picture.fps || 24, durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
}

export function planPlusImportedExport(picture: Picture, ffmpegBinary: string | null = null): ExportPlan {
  const film = importedCanonicalFilm(picture);
  const audio = hydrateAudioWorkspace(picture.audio).takes.find((take) => take.canonical && take.origin === "imported" && take.mediaUri);
  const inputs = film.clips.map((clip) => ({ shotId: clip.shotId, mediaUri: clip.mediaUri, origin: "imported", durationSec: clip.durationSec }));
  if (!ffmpegBinary) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: "FFmpeg/FFprobe is unavailable. Premiere316 will not download it or fake an MP4.", fps: picture.fps || 24, durationSec: film.durationSec, inputs, ffmpeg: { discovered: false, binary: null } };
  }
  if (film.clips.length < 2 || film.durationSec < 25) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: "30-second film needs multiple canonical imported clips totaling about 30s.", fps: picture.fps || 24, durationSec: film.durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
  }
  if (!audio) {
    return { schemaVersion: 1, ok: false, kind: "paper", reason: "30-second film requires canonical imported audio. TTS/Music3 remain fail-closed.", fps: picture.fps || 24, durationSec: film.durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
  }
  return { schemaVersion: 1, ok: true, kind: "mp4", reason: "M1-PLUS 30s imported film with audio. Provenance remains imported, not generated.", fps: picture.fps || 24, durationSec: film.durationSec, inputs, ffmpeg: { discovered: true, binary: ffmpegBinary } };
}
