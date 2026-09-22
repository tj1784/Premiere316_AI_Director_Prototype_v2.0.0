import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Picture } from "@/lib/studio/types";
import type { DirectorImageBinding } from "@/lib/studio/director-scene-authoring";

/** A dependent clip uses actual predecessor pixels; no hidden rendering or approval. */
export function ContinuationSource({
  picture,
  disabled,
  onBind,
}: {
  picture: Picture;
  disabled: boolean;
  onBind: (binding: DirectorImageBinding) => void;
}) {
  const [takeId, setTakeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const takes =
    picture.video?.takes.filter(
      (take) => take.canonical && take.status === "CANONICAL" && take.probe?.ok && take.mediaSha256,
    ) ?? [];
  return (
    <details className="min-w-0 text-xs">
      <summary>Continue from a reviewed take</summary>
      <div className="mt-2 grid gap-2">
        <label>
          Predecessor output
          <select
            aria-label="Continuation predecessor take"
            className="min-h-11 w-full rounded border border-border bg-inset"
            value={takeId}
            disabled={disabled || busy}
            onChange={(event) => setTakeId(event.target.value)}
          >
            <option value="">Select exact take</option>
            {takes.map((take) => (
              <option key={take.id} value={take.id}>
                {take.shotId} · {take.filename ?? take.id}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || busy || !takeId}
          onClick={async () => {
            if (!window.premiere316?.media.continuationFrame) {
              setMessage("Extracting a predecessor frame requires the updated V4 desktop build.");
              return;
            }
            setBusy(true);
            try {
              const result = await window.premiere316.media.continuationFrame(picture.id, takeId);
              if (!result.ok) throw new Error(result.error);
              onBind(result.binding);
              setMessage(
                "Exact final frame bound. Inspect it in Camera & continuity and match the predecessor before workflow review. No take was approved.",
              );
            } catch (error) {
              setMessage(String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Extracting final frame…" : "Bind final frame"}
        </Button>
        {!takes.length && (
          <p>No reviewed canonical predecessor exists. Review a real take first.</p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
