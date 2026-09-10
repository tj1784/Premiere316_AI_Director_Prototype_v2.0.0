import { useRef, useState } from "react";
import { linkAssetReference, replaceAssetImage, type ProductionBreakdown } from "@/lib/production";

export function AssetReferenceUpload({ record, assetId, onChange, disabled = false }: { record: ProductionBreakdown; assetId: string; onChange: (record: ProductionBreakdown) => void; disabled?: boolean }) {
  const latest = useRef(record); latest.current = record;
  const [mode, setMode] = useState<"asset" | "reference">("asset");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function upload(files: File[]) {
    if (disabled || busy || !files.length) return;
    setBusy(true); setError("");
    try {
      if (files.some(f => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 25 * 1024 * 1024)) throw new Error("Use JPG, PNG or WebP, up to 25 MB each.");
      for (const file of (mode === "asset" ? files.slice(0, 1) : files)) {
        const url = URL.createObjectURL(file);
        try {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not read uploaded image.")); img.src = url; });
          const scale = Math.min(1, 720 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
          canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
          const asset = latest.current.assets.find(a => a.id === assetId);
          if (!asset) throw new Error("This asset no longer exists.");
          const now = Date.now();
          const dataUrl = canvas.toDataURL("image/jpeg", .82);
          const next = mode === "asset" ? replaceAssetImage(latest.current, assetId, { uri: dataUrl, name: file.name, width: canvas.width, height: canvas.height }, now) : linkAssetReference(latest.current, assetId, { id: crypto.randomUUID(), name: file.name, uri: dataUrl, mediaType: "image/jpeg", preferred: !asset.references.length, uploadedAt: now, provenance: { sourceType: "user", screenplayVersionId: latest.current.screenplayVersionId, sceneIds: asset.requiredSceneIds, createdAt: now } });
          latest.current = next; onChange(next);
        } finally { URL.revokeObjectURL(url); }
      }
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const asset = record.assets.find(a => a.id === assetId);
  return <div className="grid gap-2" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();e.stopPropagation();void upload(Array.from(e.dataTransfer.files));}}>
    <select aria-label={`Upload purpose for ${asset?.name ?? "asset"}`} className="rounded-md border border-edge bg-inset p-2 text-sm" value={mode} onChange={e => setMode(e.target.value as "asset" | "reference")} disabled={busy}><option value="asset">Replace asset image</option><option value="reference">Add design reference only</option></select>
    <label className="grid min-h-11 cursor-pointer place-items-center rounded-md border border-dashed border-edge bg-inset p-2 text-center text-sm">
      {busy ? "Saving image…" : mode === "asset" ? "Upload replacement image or drop here" : "Upload reference images or drop here"}
      <input aria-label={`Upload image for ${asset?.name ?? "asset"}`} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple={mode === "reference"} disabled={disabled || busy} onChange={e => {void upload(Array.from(e.target.files ?? []));e.currentTarget.value = "";}} />
    </label>
    <p className="text-xs text-muted">{mode === "asset" ? "Replaces the asset image immediately. Previous images stay in history." : "Design reference only; keeps the current asset image."}</p>
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </div>;
}
