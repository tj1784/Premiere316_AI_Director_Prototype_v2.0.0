import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { movieAssemblyPlan, reviewMovieDelivery } from "@/lib/studio/movie-assembly";
import { Textarea } from "@/components/ui/field";
import type { Picture } from "@/lib/studio/types";
import { desktopOpenExportFolder } from "@/lib/desktop/client";
import { toast } from "sonner";
import { stableHash } from "@/lib/production/dependency-graph";
import { EditorialClipEditor } from "./editorial-clip-editor";

export function MovieAssemblyPanel({ picture }: { picture: Picture }) {
  const plan = useMemo(() => movieAssemblyPlan(picture), [picture]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmedPlan, setConfirmedPlan] = useState("");
  const [reviewedId, setReviewedId] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const latest = picture.movieAssemblies?.at(-1);
  const planKey = stableHash(plan);
  const confirmed = confirmedPlan === planKey;
  const reviewed = Boolean(latest && reviewedId === latest.id);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await window.premiere316?.media.assemblyStatus?.(picture.id);
        if (active && result?.ok) {
          setRemoteBusy(result.busy);
          setPhase(result.phase);
        }
      } catch (error) {
        if (active) setMessage(String(error));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [picture.id]);
  useEffect(() => {
    let active = true;
    if (window.premiere316?.media.assemblyHistory)
      void window.premiere316.media
        .assemblyHistory(picture.id)
        .then((result) => {
          if (!active || !result.ok) return;
          const state = useStudio.getState(),
            current = state.pictures.find((p) => p.id === picture.id);
          if (!current) return;
          const missing = result.deliveries.filter(
            (item) => !current.movieAssemblies?.some((old) => old.id === item.id),
          );
          if (missing.length)
            state.replaceActive({
              ...current,
              movieAssemblies: [...(current.movieAssemblies ?? []), ...missing].sort(
                (a, b) => a.createdAt - b.createdAt,
              ),
            });
        })
        .catch((error) => {
          if (active) setMessage(String(error));
        });
    return () => {
      active = false;
    };
  }, [picture.id, remoteBusy]);
  return (
    <section
      className="mb-6 grid gap-3 rounded border border-border bg-elevated p-4"
      aria-label="Full movie assembly"
    >
      <h3 className="text-xl">Full movie assembly</h3>
      <EditorialClipEditor picture={picture} />
      <p className="text-sm text-muted">
        {picture.shots.length} editorial shot(s) / {plan.clips.length} executable clip(s) ·{" "}
        {plan.durationSec.toFixed(2)} seconds · {plan.sounds.length} post-production cue(s). Hard
        cuts in authored order; native clip sound is preserved. Cue overlays use authored start/tail
        times and unity gain with a peak limiter. Output is H.264/AAC MP4 at {plan.fps} fps,{" "}
        {plan.width} × {plan.height}, matching the picture's {plan.format} format with letterboxing
        where needed.
      </p>
      {plan.issues.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-rec">
          {plan.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>Resolved timeline and exact take bindings</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(
            {
              clips: plan.clips.map(({ sourcePacket, ...clip }) => ({
                ...clip,
                packetId: sourcePacket.id,
              })),
              sounds: plan.sounds,
              speech: plan.speech,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmedPlan(e.target.checked ? planKey : "")}
        />
        Assemble these selected takes with the stated timing, mix and delivery settings.
      </label>
      <Button
        disabled={busy || remoteBusy || !plan.ok || !confirmed}
        onClick={async () => {
          if (!window.premiere316?.media.assemble) {
            setMessage("Full movie assembly requires the updated V4 desktop build.");
            return;
          }
          setBusy(true);
          setMessage("Verifying canonical files and assembling the full movie…");
          try {
            const result = await window.premiere316.media.assemble({
              pictureId: picture.id,
              pictureSnapshot: JSON.stringify(picture),
              plan,
            });
            if (!result.ok) throw new Error(result.error);
            const state = useStudio.getState(),
              current = state.pictures.find((p) => p.id === picture.id);
            if (current)
              state.replaceActive({
                ...current,
                movieAssemblies: [
                  ...(current.movieAssemblies ?? []),
                  { ...result, createdAt: Date.now(), plan },
                ],
              });
            setMessage(
              "Movie rendered and technically probed. Final viewing/listening approval remains separate.",
            );
            setConfirmedPlan("");
          } catch (error) {
            setMessage(String(error));
            toast.error(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy || remoteBusy ? "Assembling…" : "Render full movie"}
      </Button>
      {(busy || remoteBusy) && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status">{phase ?? "Starting assembly…"}</p>
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await window.premiere316?.media.cancelAssembly?.(picture.id);
              setMessage(
                result?.ok
                  ? "Cancellation requested. Sources and partial-job evidence are retained."
                  : "Unable to cancel assembly.",
              );
            }}
          >
            Cancel assembly
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {latest && (
        <div className="grid gap-2">
          <video
            controls
            preload="metadata"
            className="max-h-96 w-full"
            src={`media://assemblies/${latest.id}/movie.mp4`}
          />
          <p className="break-all text-xs">
            Delivery {latest.id} · SHA-256 {latest.sha256}
          </p>
          <p className="text-xs text-muted">
            Historical delivery; later source changes do not rewrite this movie or its immutable
            manifest.
          </p>
          <Button variant="secondary" onClick={() => void desktopOpenExportFolder()}>
            Open export folder
          </Button>
          <label className="grid gap-1 text-sm">
            Final picture, sound and technical review
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewedId(e.target.checked ? latest.id : "")}
            />
            I watched and listened to the complete exported movie, including transitions, speech,
            score, continuity and ending.
          </label>
          <div className="flex gap-2">
            {(["approve", "reject"] as const).map((decision) => (
              <Button
                key={decision}
                variant="secondary"
                disabled={!reviewed || !reason.trim()}
                onClick={async () => {
                  try {
                    if (!window.premiere316?.media.verifyAssembly)
                      throw new Error(
                        "Use the V4 desktop build to verify the exported bytes before review.",
                      );
                    const verified = await window.premiere316.media.verifyAssembly(
                      picture.id,
                      latest.id,
                    );
                    if (!verified.ok) throw new Error(verified.error);
                    const current = useStudio.getState().pictures.find((p) => p.id === picture.id);
                    if (!current) throw new Error("Picture is no longer available.");
                    useStudio
                      .getState()
                      .replaceActive(reviewMovieDelivery(current, latest.id, decision, reason));
                    setReviewedId("");
                    toast.success(`Final review recorded: ${decision}.`);
                  } catch (error) {
                    toast.error(String(error));
                  }
                }}
              >
                {decision === "approve" ? "Approve final delivery" : "Reject final delivery"}
              </Button>
            ))}
          </div>
          <p className="text-sm">
            Final review: {latest.reviews?.at(-1)?.decision ?? "awaiting user review"}
          </p>
        </div>
      )}
    </section>
  );
}
