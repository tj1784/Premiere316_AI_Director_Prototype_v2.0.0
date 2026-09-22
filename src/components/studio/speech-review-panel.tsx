import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useStudio } from "@/lib/studio/store";
import { recordSpeechReview } from "@/lib/studio/speech-review";
import type { Picture } from "@/lib/studio/types";
import type { VideoTake } from "@/lib/production/video-types";
import { toast } from "sonner";

export function SpeechReviewPanel({ picture, take }: { picture: Picture; take: VideoTake }) {
  const [intervals, setIntervals] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const replaceActive = useStudio((state) => state.replaceActive);
  return (
    <details className="mt-3 rounded border border-border p-3">
      <summary>Measured speech / silence review</summary>
      {take.mediaUri && /^(?:\/api\/|media:|https?:)/.test(take.mediaUri) && (
        <video className="my-3 max-h-80 w-full" controls preload="metadata" src={take.mediaUri} />
      )}
      <p className="my-2 text-xs text-muted">
        Listen to the actual take. Enter spoken intervals in seconds, one start,end pair per line.
        Overlapping speech is counted once. Leave intervals empty only after confirming there is no
        speech. Wordless singing is not spoken dialogue.
      </p>
      <label className="grid gap-1 text-sm">
        Measured speech intervals
        <Textarea
          value={intervals}
          onChange={(e) => {
            setIntervals(e.target.value);
            setConfirmed(false);
          }}
          placeholder="1.25,2.80"
        />
      </label>
      <label className="mt-2 grid gap-1 text-sm">
        Observed finding
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="my-3 flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I listened to this exact take and measured all spoken intervals, or confirmed no speech.
      </label>
      <Button
        size="sm"
        disabled={!confirmed || !reason.trim() || !take.probe?.ok || !take.mediaSha256}
        onClick={() => {
          try {
            const spans = intervals.trim()
              ? intervals
                  .trim()
                  .split(/\r?\n/)
                  .map((line) => {
                    const parts = line.split(",");
                    if (parts.length !== 2 || parts.some((p) => !p.trim()))
                      throw new Error("Use one start,end pair per line.");
                    return { startSec: Number(parts[0]), endSec: Number(parts[1]) };
                  })
              : [];
            replaceActive({
              ...picture,
              video: recordSpeechReview(picture.video!, take.id, spans, reason),
            });
            setConfirmed(false);
            toast.success("Byte-bound speech review saved; media approval is unchanged.");
          } catch (error) {
            toast.error(String(error));
          }
        }}
      >
        Save measured review
      </Button>
      {take.speechReviews?.length ? (
        <p className="mt-2 text-xs text-muted">
          {take.speechReviews.length} historical review(s). Latest:{" "}
          {take.speechReviews.at(-1)?.reason}
        </p>
      ) : null}
    </details>
  );
}
