import { useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GenerateGateWorkspace, KeyframeIteration } from "@/lib/production/generate-gates";

export function KeyframeImages({ workspace, shotId, firstUri, lastUri, onSelect }: { workspace?: GenerateGateWorkspace | null; shotId: string; firstUri?: string; lastUri?: string; onSelect?: (iterationId: string) => void }) {
  const images = workspace?.iterations.filter((item) => item.shotId === shotId && item.mediaUri && item.origin !== "fail-closed") ?? [];
  if (!images.length && !firstUri && !lastUri) return null;
  return <div className="my-4 grid min-w-0 gap-4 sm:grid-cols-2" aria-label={`${shotId} first and last frames`}>
    <FrameImage key={`${shotId}:first`} label="First frame" iterations={images.filter((item) => item.kind === "first")} fallbackUri={firstUri} onSelect={onSelect} />
    <FrameImage key={`${shotId}:last`} label="Last frame" iterations={images.filter((item) => item.kind === "last")} fallbackUri={lastUri} onSelect={onSelect} />
  </div>;
}

function FrameImage({ label, iterations, fallbackUri, onSelect }: { label: string; iterations: KeyframeIteration[]; fallbackUri?: string; onSelect?: (iterationId: string) => void }) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const preferred = iterations.find((item) => item.canonical) ?? [...iterations].reverse().find((item) => item.status !== "REJECTED") ?? iterations.at(-1);
  const selected = iterations.find((item) => item.id === previewId) ?? preferred;
  const uri = selected?.mediaUri ?? fallbackUri;
  return <figure className="min-w-0">
    <figcaption className="mb-2 flex items-center justify-between gap-2 text-xs text-muted"><span>{label}</span>{selected?.canonical ? <span>Selected</span> : null}</figcaption>
    {uri && uri !== failedUri ? <a href={uri} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-inset" aria-label={`Open ${label.toLowerCase()} at full size`}>
      <img src={uri} alt={label} loading="lazy" decoding="async" className="w-full object-contain" style={{ aspectRatio: "2.39 / 1" }} onError={() => setFailedUri(uri)} />
    </a> : <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg bg-inset p-4 text-xs text-muted"><ImageOff className="size-4" />{uri ? "Frame file unavailable" : "Frame not imported yet"}</div>}
    {iterations.length > 1 ? <select className="mt-2 min-h-11 w-full rounded-md bg-inset px-3 text-xs text-fg" aria-label={`View ${label.toLowerCase()} iteration`} value={selected?.id ?? ""} onChange={(event) => setPreviewId(event.target.value)}>{iterations.map((item, index) => <option key={item.id} value={item.id}>Iteration {index + 1}{item.canonical ? " · selected" : ""}{item.status === "REJECTED" ? " · rejected" : ""}</option>)}</select> : null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {uri ? <a href={uri} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted hover:text-fg"><ExternalLink className="size-3.5" />Open full size</a> : null}
      {selected && !selected.canonical && selected.status !== "REJECTED" && onSelect ? <Button size="sm" variant="secondary" onClick={() => onSelect(selected.id)}>Use this frame</Button> : null}
    </div>
  </figure>;
}
