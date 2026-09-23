import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Film, ZoomIn, ZoomOut } from "lucide-react";
import { hydrateAudioWorkspace, type SoundCueRecord } from "@/lib/production/audio-types.ts";
import { shotStarts, totalDuration } from "@/lib/studio/prompt-compiler";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { buildTimelinePlan } from "@/lib/studio/timeline-plan.ts";
import { loadBundledMediaMap, resolveSiteStillPreview, type BundledMediaMap } from "@/lib/studio/site-media-preview.ts";
import { PRODIGAL_SON_PICTURE_ID } from "@/lib/studio/prodigal-son.ts";
import type { Shot } from "@/lib/studio/types.ts";
import { formatTimecode } from "@/lib/utils";

const SCALES = [124, 158, 198] as const;

export function Timeline() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((state) => state.selectedShotId);
  const selectShot = useStudio((state) => state.selectShot);
  const [scale, setScale] = useState(1);
  const [mediaMap, setMediaMap] = useState<BundledMediaMap>({});
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picture?.id !== PRODIGAL_SON_PICTURE_ID) { setMediaMap({}); return; }
    let active = true;
    void loadBundledMediaMap().then((mapping) => { if (active) setMediaMap(mapping); });
    return () => { active = false; };
  }, [picture?.id]);

  useEffect(() => {
    const strip = scroller.current;
    const active = strip?.querySelector<HTMLElement>(".timeline-track-column[data-selected='true']");
    if (strip && active) strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2, behavior: "smooth" });
  }, [selectedShotId, scale, picture?.id]);

  if (!picture) return null;
  const starts = shotStarts(picture);
  const audio = hydrateAudioWorkspace(picture.audio);
  const plan = buildTimelinePlan(picture);
  const selectedIndex = Math.max(0, picture.shots.findIndex((shot) => shot.id === selectedShotId));
  const currentTime = starts[selectedIndex]?.start ?? 0;

  return (
    <div data-panel-kind="timeline" className="timeline-tracks" style={{ "--timeline-shot-width": `${SCALES[scale]}px` } as CSSProperties}>
      <div className="timeline-tracks-toolbar">
        <div><strong>Timeline</strong><span>{picture.shots.length} shots · {picture.fps} fps</span></div>
        <time>{formatTimecode(currentTime, picture.fps)} <span>/ {formatTimecode(totalDuration(picture), picture.fps)}</span></time>
        <div className="timeline-scale" aria-label="Track scale">
          <button type="button" onClick={() => setScale(Math.max(0, scale - 1))} disabled={scale === 0} aria-label="Zoom out" title="Zoom out"><ZoomOut size={16} /></button>
          <span>{scale + 1}×</span>
          <button type="button" onClick={() => setScale(Math.min(SCALES.length - 1, scale + 1))} disabled={scale === SCALES.length - 1} aria-label="Zoom in" title="Zoom in"><ZoomIn size={16} /></button>
        </div>
      </div>
      <div className="timeline-tracks-body">
        <div className="timeline-track-labels" aria-hidden="true">
          <div className="timeline-track-ruler-label">Time</div>
          <div className="timeline-track-video-label">V1 <span>Picture</span></div>
          <div>A1 <span>Dialogue</span></div>
          <div>A2 <span>Effects</span></div>
          <div>A3 <span>Ambience</span></div>
          <div>M1 <span>Score</span></div>
        </div>
        <div className="timeline-track-scroll" ref={scroller} aria-label="Movie timeline, scroll horizontally for more shots">
          <div className="timeline-track-columns">
            {picture.shots.map((shot, index) => {
              const span = starts[index];
              const clip = plan.clips[index];
              const preview = resolveSiteStillPreview(picture.id, shot.stillUrl, [], mediaMap);
              const cues = audio.cues.filter((cue) => matchesShot(cue, shot, span.start, span.end));
              const legacyScore = picture.cues.filter((cue) => overlaps(cue.startSec, cue.durationSec, span.start, span.end));
              const dialogue = audio.lines.filter((line) => line.shotId === shot.id);
              const effects = cues.filter((cue) => ["foley", "impact", "creature", "environment", "transition"].includes(cue.kind));
              const ambience = cues.filter((cue) => cue.kind === "ambience" || cue.kind === "room-tone");
              const score = cues.filter((cue) => cue.kind === "score");
              const dialogueCues = cues.filter((cue) => cue.kind === "dialogue");
              return (
                <div className="timeline-track-column" data-selected={index === selectedIndex} key={shot.id}>
                  <div className="timeline-track-ruler" title={`Shot ${shot.index} begins ${formatTimecode(span.start, picture.fps)}`}>{formatTimecode(span.start, picture.fps)}</div>
                  <button type="button" className="timeline-track-video" aria-current={index === selectedIndex ? "true" : undefined} onClick={() => selectShot(shot.id)} aria-label={`Select shot ${String(shot.index).padStart(2, "0")}: ${shot.description}`}>
                    {preview ? <img src={preview.uri} alt="" loading="lazy" /> : <Film size={18} aria-hidden="true" />}
                    <span><strong>{String(shot.index).padStart(2, "0")} · {shot.type}</strong><small>{shot.durationSec}s · {clip?.videoUri ? "Video" : "Still"}</small></span>
                  </button>
                  <TimelineAudioCell kind="dialogue" label="Dialogue" names={[...dialogue.map((line) => line.characterName), ...dialogueCues.map((cue) => cue.name)]} />
                  <TimelineAudioCell kind="effects" label="Effects" names={effects.map((cue) => cue.name)} />
                  <TimelineAudioCell kind="ambience" label="Ambience" names={ambience.map((cue) => cue.name)} />
                  <TimelineAudioCell kind="score" label="Score" names={[...score.map((cue) => cue.name), ...legacyScore.map((cue) => cue.name)]} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function overlaps(start: number, duration: number, shotStart: number, shotEnd: number) {
  return start < shotEnd && start + duration > shotStart;
}

function matchesShot(cue: SoundCueRecord, shot: Shot, start: number, end: number) {
  return cue.shotId === shot.id || (!cue.shotId && (!cue.sceneId || cue.sceneId === shot.sceneId) && overlaps(cue.startSec, cue.durationSec, start, end));
}

function TimelineAudioCell({ kind, label, names }: { kind: string; label: string; names: string[] }) {
  const unique = [...new Set(names.filter(Boolean))];
  return <div className={`timeline-audio-cell timeline-audio-${kind}`} title={unique.length ? `${label}: ${unique.join(", ")}` : `${label}: no authored cue`}>
    {unique.length ? <span>{unique[0]}{unique.length > 1 ? ` +${unique.length - 1}` : ""}</span> : <span className="timeline-audio-empty">—</span>}
  </div>;
}
