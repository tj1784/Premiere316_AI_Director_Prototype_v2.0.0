import { Film, Image as ImageIcon, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";

export function MediaBin() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((state) => state.selectedShotId);
  const selectShot = useStudio((state) => state.selectShot);
  if (!picture) return null;

  return (
    <aside data-panel-kind="media" className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border px-3 py-3">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Media</p>
        <p className="mt-1 text-xs text-muted">{picture.shots.length} prepared shots</p>
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {picture.shots.map((shot) => {
          const selected = shot.id === selectedShotId;
          return (
            <li key={shot.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => selectShot(shot.id)}
                className={cn(
                  "grid min-h-14 w-full min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-sm p-2 text-left",
                  selected ? "bg-elevated shadow-[var(--shadow-border)]" : "text-muted hover:bg-elevated/60 hover:text-fg",
                )}
              >
                <span className="relative grid aspect-video overflow-hidden rounded-sm bg-inset text-subtle">
                  {shot.videoUrl ? <video src={shot.videoUrl} className="size-full object-cover" muted /> : shot.stillUrl ? <img src={shot.stillUrl} alt="" className="size-full object-cover" /> : <Film className="m-auto size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs text-fg">{String(shot.index).padStart(2, "0")} · {shot.type}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-[10px] text-subtle">
                    {shot.videoUrl ? <><Video className="size-3" /> Clip</> : shot.stillUrl ? <><ImageIcon className="size-3" /> Plate</> : "Awaiting media"}
                    <span className="ml-auto tabular-nums">{shot.durationSec}s</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function ClipInspector() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((state) => state.selectedShotId);
  if (!picture) return null;
  const shot = picture.shots.find((item) => item.id === selectedShotId) ?? picture.shots[0];

  return (
    <aside data-panel-kind="clip" className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border px-3 py-3">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Clip inspector</p>
        <h2 className="mt-1 truncate font-display text-lg tracking-tight" title={shot ? `Shot ${String(shot.index).padStart(2, "0")}` : "No shot selected"}>
          {shot ? `Shot ${String(shot.index).padStart(2, "0")}` : "No shot selected"}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shot ? (
          <>
            <div className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge>{shot.type}</Badge>
                <span className="text-xs tabular-nums text-muted">{shot.durationSec}s</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{shot.description}</p>
              <dl className="mt-4 grid gap-2 text-xs">
                <ClipFact label="Plate" value={shot.stillUrl ? "Ready" : "Missing"} />
                <ClipFact label="Clip" value={shot.videoUrl ? "Ready" : "Missing"} />
                <ClipFact label="Camera" value={`${shot.camera} · ${shot.lens}`} />
                <ClipFact label="Movement" value={shot.cameraMove} />
              </dl>
            </div>
            <div className="mt-3 rounded-md bg-inset p-3 text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Local motion</p>
              <p className="mt-2">No verified native motion adapter is connected. Stitch remains review-only; no cloud generation or silent provider fallback is available.</p>
            </div>
          </>
        ) : <p className="text-sm text-muted">Prepare a shot before inspecting clip metadata.</p>}
      </div>
    </aside>
  );
}

function ClipFact({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 items-start justify-between gap-3"><dt className="shrink-0 text-subtle">{label}</dt><dd className="min-w-0 break-words text-right text-muted">{value}</dd></div>;
}
