import { useState } from "react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock3, Plus } from "lucide-react";
import { PictureCover } from "./picture-cover";
import { Badge } from "@/components/ui/badge";
import { STAGES } from "@/lib/studio/types";
import type { PreparedPicture } from "@/lib/studio/picture-preparation";
import { useStudio } from "@/lib/studio/store";
import { formatRuntimeMinutes } from "@/lib/utils";

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
  const deletePicture = useStudio((state) => state.deletePicture);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = [...pictures]
    .filter(
      (p) =>
        (filter === "all" || (filter === "samples" ? p.sample : !p.sample)) &&
        `${p.title} ${p.logline} ${p.genre}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = [...pictures]
    .filter((p) => !p.sample)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    <section aria-labelledby="pictures-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">
            YOUR PRODUCTION LIBRARY
          </p>
          <h1
            id="pictures-heading"
            className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight text-balance"
          >
            Movie scripts
          </h1>
        </div>
        <Button onClick={onNew}>
          <Plus />
          New movie script
        </Button>
      </div>

      {recent && !query && (
        <section className="home-resume mt-7" aria-label="Resume recent script">
          <div>
            <p className="workspace-eyebrow">CONTINUE WRITING</p>
            <h2 className="mt-2 font-display text-3xl">{recent.title}</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {recent.logline || "Continue developing your movie script."}
            </p>
            <p className="mt-3 text-xs text-muted">
              {preparationLabel(recent)} · {relativeModified(recent.updatedAt)}
            </p>
          </div>
          <Button variant="secondary" onClick={() => onOpen(recent.id)}>
            Resume script →
          </Button>
        </section>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="workspace-tabs" aria-label="Filter movie scripts">
          {[
            ["all", "All scripts"],
            ["projects", "My scripts"],
            ["samples", "Studio samples"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          aria-label="Search movie scripts"
          placeholder="Search scripts, genres or story…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="mt-4 text-xs text-muted" role="status">
        {visible.length} {visible.length === 1 ? "script" : "scripts"}
      </p>
      <ul className="picture-grid mt-4 grid gap-4">
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
              <span className="block font-display text-xl tracking-tight">New movie script</span>
              <span className="mt-1 block max-w-56 text-xs leading-relaxed text-muted">
                Begin with a concept, treatment, screenplay, or source.
              </span>
            </span>
          </button>
        </li>
        {visible.map((picture) => {
          const stage = STAGES.find((item) => item.id === picture.lastOpenedStage) ?? STAGES[0];
          return (
            <li key={picture.id}>
              <button
                type="button"
                onClick={() => onOpen(picture.id)}
                className="group flex min-h-64 w-full flex-col overflow-hidden rounded-lg bg-elevated text-left shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-150 ease-out hover:shadow-[var(--shadow-border-hover)] active:scale-[0.98]"
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-inset">
                  <PictureCover picture={picture} />
                  <span className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                    {picture.sample ? <Badge>Sample</Badge> : <span />}
                    <Badge>
                      {stage?.number} {stage?.label}
                    </Badge>
                  </span>
                </span>
                <span className="flex flex-1 flex-col p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span
                      className="min-w-0 truncate font-display text-lg tracking-tight"
                      title={picture.title}
                    >
                      {picture.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle">
                      {formatRuntimeMinutes(picture.runtimeMinutes)}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                    {picture.logline || "No logline yet."}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-3 pt-4 text-[11px] text-subtle">
                    <span className="truncate">{picture.genre}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Clock3 className="size-3" />
                      {relativeModified(picture.updatedAt)}
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                    {picture.screenplay.status === "APPROVED" ? (
                      <CheckCircle2 className="size-3 text-good" />
                    ) : null}
                    {preparationLabel(picture)}
                  </span>
                </span>
              </button>
              {!picture.sample ? (
                <button
                  type="button"
                  className="mt-2 min-h-11 px-3 text-sm text-rec"
                  aria-label={`Delete picture ${picture.title}`}
                  onClick={() => deletePicture(picture.id)}
                >
                  Delete picture
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!visible.length ? (
        <p className="mt-4 text-sm text-muted">
          No scripts match this view. Start a new movie script or change your search.
        </p>
      ) : null}
    </section>
  );
}
