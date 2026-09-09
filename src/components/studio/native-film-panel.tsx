import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import type { NativeFilmDraft, NativeFilmStatus } from "@/lib/studio/native-film";
import { releaseMoviePlanWriterForImages } from "@/lib/studio/movie-plan-client";
import { nativeVideoLockedForShot, keyframeGateLocked } from "@/lib/production/generate-gates";

export function NativeFilmPanel({ picture }: { picture: Picture }) {
  const [status, setStatus] = useState<NativeFilmStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [testShotId, setTestShotId] = useState(picture.shots[0]?.id ?? "");
  const replaceActive = useStudio((s) => s.replaceActive);
  const draft = picture.nativeFilm ?? { visualContinuity: `Cinematic live-action. ${picture.tone}. ${picture.characters.map((c) => `${c.name}: ${c.look}`).join(". ")}`, prompts: {} };
  const jobId = draft.jobId;
  const busy = starting || status?.running === true;
  const referencesMissing = keyframeGateLocked(picture) || picture.shots.some((shot) => nativeVideoLockedForShot(picture, shot.id));
  const save = (change: Partial<NativeFilmDraft>) => {
    const current = useStudio.getState().pictures.find((p) => p.id === picture.id);
    const editing = Boolean(change.prompts || change.visualContinuity !== undefined);
    if (current) replaceActive({ ...current, nativeFilm: { ...draft, ...current.nativeFilm, ...change, ...(editing ? { promptEditedAt: Date.now(), jobId: undefined } : {}) }, updatedAt: Date.now() });
    if (editing) setStatus(null);
  };
  useEffect(() => {
    if (!jobId || !window.premiere316?.film) return;
    let disposed = false;
    const poll = async () => {
      try { const next = await window.premiere316!.film.status(jobId); if (!disposed) setStatus(next); }
      catch (error) { if (!disposed) setStatus({ ok: false, jobId, stage: "failed", running: false, clips: [], movieUri: null, error: String(error) }); }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [jobId]);
  const promptFor = (id: string, fallback: string) => draft.prompts[id] ?? fallback;
  const duration = picture.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const render = async (test: boolean) => {
    if (!window.premiere316?.film) return toast.error("Open this picture in the updated Premiere316 desktop app.");
    if (referencesMissing) return toast.error("Generate and approve asset references, then first and last frames before rendering video.");
    // This legacy text-only worker must never silently bypass the required
    // image-conditioned production workflow.
    return toast.error("Reference-conditioned video rendering is not connected yet.");

  };
  return <section className="grid gap-4 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Native movie rendering">
    <div><h3 className="font-display text-xl">Video prompts · MiniMax H3</h3><p className="mt-2 text-sm text-muted">{picture.shots.length} shots · {duration} seconds. Video generation requires approved asset references and approved first and last frames. Reference-conditioned rendering is not connected yet.</p></div>
    <p className="text-sm text-muted">{draft.writer ? `Prompts originally written by ${draft.writer.modelId}.${draft.promptEditedAt ? " Edited directly in the app; rendering uses the edited text below." : " You can edit them directly below."}` : "These prompts have no model-authored prompt-pass record. Build Movie Plan in Intake to have the selected model write them."}</p>
    <label className="grid gap-2 text-sm">Appearance and continuity across every shot
      <textarea aria-label="Movie visual continuity" className="min-h-28 w-full rounded-sm bg-inset p-3 text-foreground" value={draft.visualContinuity} disabled={busy} onChange={(event) => save({ visualContinuity: event.target.value })} />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={true} title="Approved reference-conditioned rendering is required" onClick={() => void render(false)}>{starting ? "Starting…" : status?.stage === "interrupted" || status?.stage === "failed" ? "Resume movie render" : `Generate ${duration}-second movie`}</Button>
      <Button variant="secondary" disabled={true} title="Approved reference-conditioned rendering is required" onClick={() => void render(true)}>Generate 5-second test</Button>
      <select aria-label="Test shot" className="rounded-md bg-inset px-3 py-2 text-sm" disabled={busy} value={testShotId} onChange={(event) => setTestShotId(event.target.value)}>{picture.shots.map((shot, index) => <option key={shot.id} value={shot.id}>Test shot {index + 1}: {shot.description}</option>)}</select>
      {busy ? <Button variant="outline" onClick={() => void window.premiere316?.film.stop()}>Stop rendering</Button> : null}
    </div>
    <div role="status" className="rounded-md bg-inset p-3 text-sm">
      {status ? <><p>{status.running ? "Running" : "Stopped"}: {status.stage.replaceAll("_", " ")}{status.shot ? ` · shot ${status.shot}` : ""}{status.step ? ` · step ${status.step}/${status.steps}` : ""}</p><p>{status.clips?.length ?? 0} / {status.totalShots ?? 0} clips playable</p>{status.error ? <p className="text-rec">{status.error}</p> : null}</> : "No render started for this picture."}
    </div>
    {status?.movieUri ? <div><h4 className="mb-2 font-display text-lg">Movie · ready to review</h4><video className="w-full rounded-md" controls preload="metadata" src={status.movieUri} /></div> : null}
    <div className="grid gap-4">
      {picture.shots.map((shot, index) => {
        const clip = status?.clips?.find((item) => item.sourceShotId === shot.id);
        return <article key={shot.id} className="grid gap-2 rounded-md bg-inset p-3">
          <h4 className="font-display text-lg">{String(index + 1).padStart(2, "0")} · {shot.durationSec}s · {shot.description}</h4>
          <label className="grid gap-2 text-sm">Generation prompt<textarea aria-label={`Shot ${index + 1} video prompt`} className="min-h-24 w-full rounded-sm bg-elevated p-3 text-foreground" disabled={busy} value={promptFor(shot.id, shot.i2vPrompt || shot.description)} onChange={(event) => save({ prompts: { ...draft.prompts, [shot.id]: event.target.value } })} /></label>
          {clip ? <><video className="w-full rounded-md" controls preload="metadata" src={clip.mediaUri} /><p className="text-xs text-muted">Native generated video · {clip.seconds}s · awaiting your review</p></> : <p className="text-xs text-muted">No generated clip yet.</p>}
        </article>;
      })}
    </div>
  </section>;
}
