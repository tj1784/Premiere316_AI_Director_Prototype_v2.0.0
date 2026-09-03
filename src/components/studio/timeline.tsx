import { totalDuration, shotStarts } from "@/lib/studio/prompt-compiler";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { cn, formatTimecode } from "@/lib/utils";

export function Timeline() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((s) => s.selectedShotId);
  const selectShot = useStudio((s) => s.selectShot);
  if (!picture) return null;
  const total = Math.max(totalDuration(picture), 1);
  const starts = shotStarts(picture);
  return (
    <div data-panel-kind="timeline" className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Timeline</p>
        <p className="text-[11px] text-muted tabular-nums">
          {formatTimecode(total, picture.fps)} · {picture.fps}fps
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto px-3 pb-3">
        <div className="timeline-grid min-w-[720px] rounded-md bg-inset p-2">
          <Track label="V1">
            {picture.shots.map((s) => {
              const span = starts.find((x) => x.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectShot(s.id)}
                  style={{ width: `${(s.durationSec / total) * 100}%` }}
                  className={cn(
                    "relative h-14 overflow-hidden rounded-sm bg-elevated text-left shadow-[var(--shadow-border)]",
                    selectedShotId === s.id && "ring-1 ring-accent/50",
                  )}
                >
                  {s.stillUrl ? (
                    <img src={s.stillUrl} alt="" className="absolute inset-0 size-full object-cover opacity-50" />
                  ) : null}
                  <span className="relative z-10 block truncate px-2 pt-1.5 text-[10px] text-fg">
                    {String(s.index).padStart(2, "0")} {s.type}
                  </span>
                  <span className="relative z-10 block px-2 text-[10px] text-muted tabular-nums">{s.durationSec}s</span>
                  <span className="sr-only">
                    {s.description} from {formatTimecode(span?.start ?? 0)}
                  </span>
                </button>
              );
            })}
          </Track>
          <Track label="A1">
            {picture.voices.map((v) => (
              <div key={v.id} className="h-9 min-w-16 flex-1 rounded-sm bg-elevated/80 px-2 py-1.5">
                <p className="truncate text-[10px] text-muted">{v.character}</p>
              </div>
            ))}
          </Track>
          <Track label="M1">
            {picture.cues.map((c) => (
              <div
                key={c.id}
                style={{ width: `${(c.durationSec / total) * 100}%` }}
                className="h-9 rounded-sm bg-elevated px-2 py-1.5 shadow-[var(--shadow-border)]"
              >
                <p className="truncate text-[11px]">{c.name}</p>
              </div>
            ))}
          </Track>
        </div>
      </div>
    </div>
  );
}

function Track({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-1">
      <span className="w-8 shrink-0 pt-1 text-[10px] text-subtle">{label}</span>
      <div className="flex min-w-0 flex-1">{children}</div>
    </div>
  );
}
