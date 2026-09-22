import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { approveEditorialClips } from "@/lib/studio/editorial-clips";
import type { Picture, Shot } from "@/lib/studio/types";
import { SpeechReviewPanel } from "./speech-review-panel";
import { useWorkspaceDraft } from "./use-workspace-draft";

function ShotClips({ picture, shot }: { picture: Picture; shot: Shot }) {
  const sequence = picture.editorialClipSequences?.filter((item) => item.shotId === shot.id).at(-1);
  const [ids, setIds] = useWorkspaceDraft<string[]>(`editorial-clips:${shot.id}`, sequence?.takeIds ?? []);
  const [reason, setReason] = useWorkspaceDraft(`editorial-review:${shot.id}`, "");
  const [viewed, setViewed] = useState(false);
  const [message, setMessage] = useState("");
  const takes =
    picture.video?.takes.filter(
      (item) => item.shotId === shot.id && item.probe?.ok && item.mediaUri,
    ) ?? [];
  const change = (next: string[]) => {
    setIds(next);
    setViewed(false);
  };
  if (!takes.length) return null;
  return (
    <details className="rounded border border-border p-3">
      <summary>
        {shot.id} · {shot.durationSec}s ·{" "}
        {sequence ? "Reviewed clip sequence" : "Single canonical take"}
      </summary>
      <p className="my-2 text-sm text-muted">
        Select clips in playback order. This is an editorial review, not a generated continuation or
        automatic approval. Review geography, seams, native audio and completed actions.
      </p>
      <label className="grid gap-1 text-sm">
        Add a clip
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) change([...ids, event.target.value]);
          }}
          className="max-w-full rounded border border-border bg-panel p-2"
        >
          <option value="">Choose a take…</option>
          {takes
            .filter(
              (take) =>
                !ids.includes(take.id) && ["NEEDS_REVIEW", "CANONICAL"].includes(take.status),
            )
            .map((take) => (
              <option key={take.id} value={take.id}>
                {take.id} · {take.probe?.durationSec}s · {take.status}
              </option>
            ))}
        </select>
      </label>
      <ol className="my-3 grid gap-3">
        {ids.map((id, index) => {
          const take = takes.find((item) => item.id === id);
          return (
            <li key={id} className="min-w-0 rounded border border-border p-2">
              <p className="break-all text-sm">
                Clip {index + 1} · {id} · {take?.probe?.durationSec ?? "missing"}s
              </p>
              {take?.mediaUri && (
                <video
                  controls
                  preload="metadata"
                  src={take.mediaUri}
                  className="my-2 max-h-56 w-full"
                  aria-label={`Editorial clip ${index + 1}`}
                />
              )}
              {take && <SpeechReviewPanel picture={picture} take={take} />}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...ids];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    change(next);
                  }}
                >
                  Move earlier
                </Button>
                <Button onClick={() => change(ids.filter((item) => item !== id))}>
                  Remove from sequence
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <label className="grid gap-1 text-sm">
        Observed continuity and edit review
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-20 rounded border border-border bg-panel p-2"
        />
      </label>
      <label className="my-2 flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={viewed}
          onChange={(event) => setViewed(event.target.checked)}
        />
        I watched and listened to these clips in this order against the current shot direction.
      </label>
      <Button
        disabled={!viewed || !ids.length || !reason.trim()}
        onClick={() => {
          try {
            const state = useStudio.getState();
            const current = state.pictures.find((item) => item.id === picture.id);
            if (!current) return;
            state.replaceActive(approveEditorialClips(current, shot.id, ids, reason));
            setMessage(
              "Editorial sequence saved. Changed sources, rejected takes or changed media invalidate it.",
            );
            setViewed(false);
          } catch (error) {
            setMessage(String(error));
          }
        }}
      >
        Approve editorial clip sequence
      </Button>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </details>
  );
}

export function EditorialClipEditor({ picture }: { picture: Picture }) {
  return (
    <details>
      <summary>Editorial shots → executable clip sequences</summary>
      <div className="mt-3 grid gap-3">
        {picture.shots.map((shot) => (
          <ShotClips key={`${picture.id}:${shot.id}`} picture={picture} shot={shot} />
        ))}
        {!picture.video?.takes.length && (
          <p className="text-sm text-muted">
            Import or generate real takes before reviewing an editorial sequence. Existing
            single-take selections remain unchanged.
          </p>
        )}
      </div>
    </details>
  );
}
