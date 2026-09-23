import { useState } from "react";
import { ImageOff } from "lucide-react";

/** A missing thumbnail retries the original file before offering repair. */
export function AssetImagePreview({
  previewUri,
  mediaUri,
  alt,
  className = "",
  onRepair,
  compact = false,
}: {
  previewUri?: string;
  mediaUri?: string;
  alt: string;
  className?: string;
  onRepair?: () => void;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const uri = [previewUri, mediaUri].find((value) => value && !failed.includes(value));
  if (!uri)
    return (
      <span className={compact ? "grid place-items-center text-muted" : "grid min-h-24 place-items-center gap-2 p-3 text-center text-xs text-muted"}>
        {compact ? <ImageOff size={20} aria-hidden="true" /> : null}
        <span>
          {compact ? <span className="sr-only">Image unavailable; inspect this asset to repair it.</span> : mediaUri || previewUri
            ? "Preview and original image are unavailable."
            : "No image generated or imported."}
        </span>
        {onRepair ? (
          <button
            type="button"
            className="min-h-11 rounded border border-border px-3 text-fg"
            onClick={() => {
              setFailed([]);
              setAttempt((n) => n + 1);
              onRepair();
            }}
          >
            Repair / import image
          </button>
        ) : null}
      </span>
    );
  return (
    <img
      key={`${uri}:${attempt}`}
      src={uri}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed((previous) => [...previous, uri])}
    />
  );
}
