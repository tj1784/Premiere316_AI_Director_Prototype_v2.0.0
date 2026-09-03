import { CheckCircle2, Clock3, Film, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STAGES } from "@/lib/studio/types";
import type { PreparedPicture } from "@/lib/studio/picture-preparation";

function relativeModified(timestamp: number): string {
  if (!timestamp || timestamp <= 1) return "Studio sample";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Modified today";
  if (days === 1) return "Modified yesterday";
  return `Modified ${days} days ago`;
}

function preparationLabel(picture: PreparedPicture): string {
  if (picture.screenplay.status === "APPROVED") return "Screenplay approved";
  if (picture.screenplay.status === "READY_FOR_REVIEW") return "Ready for review";
  if (picture.screenplay.status === "GENERATING") return "Screenplay generating";
  return "Intake saved";
}

export function PicturesLibrary({
  pictures,
  onNew,
  onOpen,
}: {
  pictures: PreparedPicture[];
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-labelledby="pictures-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">Picture vault</p>
          <h1 id="pictures-heading" className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight text-balance">Pictures</h1>
        </div>
        <p className="hidden text-xs text-subtle sm:block">{pictures.length} {pictures.length === 1 ? "picture" : "pictures"}</p>
      </div>

      <ul className="picture-grid mt-7 grid gap-3">
        <li>
          <button
            type="button"
            onClick={onNew}
            className="group flex min-h-64 w-full flex-col justify-between rounded-lg bg-elevated p-5 text-left shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-150 ease-out hover:shadow-[var(--shadow-border-hover)] active:scale-[0.98]"
          >
            <span className="grid size-11 place-items-center rounded-md bg-accent text-accent-fg">
              <Plus className="size-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-xl tracking-tight">New Picture</span>
              <span className="mt-1 block max-w-56 text-xs leading-relaxed text-muted">Begin with a concept, treatment, screenplay, or source.</span>
            </span>
          </button>
        </li>
        {pictures.map((picture) => {
          const stage = STAGES.find((item) => item.id === picture.lastOpenedStage) ?? STAGES[0];
          return (
            <li key={picture.id}>
              <button
                type="button"
                onClick={() => onOpen(picture.id)}
                className="group flex min-h-64 w-full flex-col overflow-hidden rounded-lg bg-elevated text-left shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-150 ease-out hover:shadow-[var(--shadow-border-hover)] active:scale-[0.98]"
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-inset">
                  {picture.thumbnailUrl ? (
                    <img src={picture.thumbnailUrl} alt="" className="size-full object-cover outline outline-1 -outline-offset-1 outline-white/10" />
                  ) : (
                    <span className="grid size-full place-items-center"><Film className="size-6 text-subtle" aria-hidden="true" /></span>
                  )}
                  <span className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                    {picture.sample ? <Badge>Sample</Badge> : <span />}
                    <Badge>{stage?.number} {stage?.label}</Badge>
                  </span>
                </span>
                <span className="flex flex-1 flex-col p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-display text-lg tracking-tight" title={picture.title}>{picture.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle">{picture.runtimeMinutes} min</span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{picture.logline || "No logline yet."}</span>
                  <span className="mt-auto flex items-center justify-between gap-3 pt-4 text-[11px] text-subtle">
                    <span className="truncate">{picture.genre}</span>
                    <span className="flex shrink-0 items-center gap-1"><Clock3 className="size-3" />{relativeModified(picture.updatedAt)}</span>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                    {picture.screenplay.status === "APPROVED" ? <CheckCircle2 className="size-3 text-good" /> : null}
                    {preparationLabel(picture)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!pictures.length ? <p className="mt-4 text-sm text-muted">Your next picture begins here.</p> : null}
    </section>
  );
}
