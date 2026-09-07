import { hydrateAudioWorkspace } from "../production/audio-types.ts";
import { hydrateVideoWorkspace } from "../production/video-types.ts";
import { shotStarts } from "./prompt-compiler.ts";
import type { Picture } from "./types.ts";

export type TimelineClip = {
  shotId: string;
  startSec: number;
  endSec: number;
  videoOrigin: string;
  videoUri: string | null;
  audioTakeIds: string[];
  missing: string[];
};

export function buildTimelinePlan(picture: Picture): { durationSec: number; clips: TimelineClip[] } {
  const starts = shotStarts(picture);
  const video = hydrateVideoWorkspace(picture.video);
  const audio = hydrateAudioWorkspace(picture.audio);
  const clips = picture.shots.map((shot) => {
    const span = starts.find((item) => item.id === shot.id);
    const canonical = video.takes.find((take) => take.shotId === shot.id && take.canonical);
    const audioTakeIds = audio.takes.filter((take) => take.canonical && (take.shotId === shot.id || take.lineId)).map((take) => take.id);
    const missing: string[] = [];
    if (!canonical?.mediaUri && !shot.videoUrl) missing.push("video");
    if (!audioTakeIds.length) missing.push("dialogue-or-score");
    return {
      shotId: shot.id,
      startSec: span?.start ?? 0,
      endSec: span?.end ?? shot.durationSec,
      videoOrigin: canonical?.origin ?? (shot.videoUrl ? "legacy-url" : shot.stillUrl ? "still-placeholder" : "missing"),
      videoUri: canonical?.mediaUri ?? shot.videoUrl ?? null,
      audioTakeIds,
      missing,
    };
  });
  return { durationSec: clips.at(-1)?.endSec ?? 0, clips };
}

export function importedCanonicalFilm(picture: Picture): { durationSec: number; clips: Array<{ shotId: string; mediaUri: string; mediaSha256: string; durationSec: number }> } {
  const video = hydrateVideoWorkspace(picture.video);
  const clips = picture.shots.flatMap((shot) => {
    const take = video.takes.find((item) => item.shotId === shot.id && item.canonical && item.origin === "imported" && item.mediaUri && item.mediaSha256);
    if (!take?.mediaUri || !take.mediaSha256) return [];
    return [{ shotId: shot.id, mediaUri: take.mediaUri, mediaSha256: take.mediaSha256, durationSec: take.probe?.durationSec ?? 0 }];
  });
  return { durationSec: clips.reduce((sum, clip) => sum + clip.durationSec, 0), clips };
}
