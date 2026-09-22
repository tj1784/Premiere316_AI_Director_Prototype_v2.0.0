import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { Picture } from "@/lib/studio/types";
import type { ShotContinuity } from "@/lib/studio/shot-continuity";
import { continuityImageOptions } from "@/lib/studio/shot-continuity";

export function ContinuityImageInspector({
  picture,
  draft,
  onChange,
}: {
  picture: Picture;
  draft: ShotContinuity;
  onChange: (draft: ShotContinuity) => void;
}) {
  const options = continuityImageOptions(picture, draft.shotId);
  const [selected, setSelected] = useState(draft.imageInspection?.referenceId ?? "");
  const [reason, setReason] = useState(draft.inspectionReason);
  const [preview, setPreview] = useState("");
  const [digest, setDigest] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const option = options.find((o) => o.id === selected);
  const uri = option?.mediaUri,
    expected = option?.sha256;
  const referenceKey = JSON.stringify([selected, uri, expected]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setPreview("");
    setDigest("");
    setLoaded(false);
    setLoadedKey("");
    setError("");
    if (uri)
      void (async () => {
        const url = new URL(uri, window.location.origin);
        if (url.protocol !== "media:" && url.origin !== window.location.origin)
          throw new Error(
            "This reference needs a registered local preview. Recover/import the canonical media in Assets first.",
          );
        const response = await fetch(url.href, { signal: controller.signal, cache: "no-store" });
        if (!response.ok)
          throw new Error(
            `Reference ${selected} could not be recovered from its canonical URI (${response.status}). Repair this input in Assets; unrelated work remains available.`,
          );
        if (Number(response.headers.get("content-length")) > 32 * 1024 * 1024)
          throw new Error("Reference exceeds the 32 MB inspection limit.");
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024)
          throw new Error("Reference size is invalid for inspection.");
        const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (expected && sha !== expected.toLowerCase())
          throw new Error(
            `Reference ${selected} no longer matches its recorded SHA-256. Correct the media source before continuing.`,
          );
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([bytes], {
            type: response.headers.get("content-type") ?? "application/octet-stream",
          }),
        );
        setPreview(objectUrl);
        setDigest(sha);
        setLoadedKey(JSON.stringify([selected, uri, expected]));
      })().catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, expected, selected]);
  return (
    <fieldset className="grid min-w-0 gap-3 rounded border border-border p-3">
      <legend>Inspect actual starting/reference image</legend>
      <p className="text-xs text-muted">
        Inspect identity, geography, framing, props, wardrobe and support/contact against the
        incoming state. This is a human visual finding, not model-generated certification. It does
        not change the selected generation mode or approve a draft asset.
      </p>
      <label className="grid gap-1 text-sm">
        Canonical image
        <select
          className="min-h-11 min-w-0 rounded border border-border bg-inset p-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select registered image…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {preview && (
        <img
          key={preview}
          src={preview}
          alt="Exact reference bytes under continuity review"
          className="max-h-96 w-full rounded object-contain"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setError("The fetched bytes did not decode as an image. No inspection was recorded.");
          }}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-rec">
          {error}
        </p>
      )}
      {digest && <p className="break-all text-xs text-muted">Viewed-file SHA-256: {digest}</p>}
      <label className="grid gap-1 text-sm">
        Observed comparison
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {(["consistent", "conflict"] as const).map((disposition) => (
          <Button
            key={disposition}
            variant={disposition === "conflict" ? "secondary" : "primary"}
            disabled={!loaded || !digest || !reason.trim() || !uri || loadedKey !== referenceKey}
            onClick={() => {
              if (!loaded || loadedKey !== referenceKey || !digest || !uri || !reason.trim())
                return;
              onChange({
                ...draft,
                imageDisposition: disposition,
                imageHash: digest,
                inspectionReason: reason,
                imageInspection: {
                  disposition,
                  id: `inspection:${crypto.randomUUID()}`,
                  referenceId: selected,
                  mediaUri: uri!,
                  sha256: digest,
                  reviewedAt: Date.now(),
                  reason,
                },
              });
            }}
          >
            {disposition === "consistent"
              ? "Record observed consistency"
              : "Record source-image conflict"}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">
        Saved disposition: {draft.imageDisposition}. Save continuity to persist this finding. A
        source-image conflict blocks compilation until the media is corrected and inspected again.
      </p>
    </fieldset>
  );
}
