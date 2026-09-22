import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ArrowUpRight, ChevronLeft, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PictureCover } from "./picture-cover";
import type { PreparedPicture } from "@/lib/studio/picture-preparation";
import { useStudio } from "@/lib/studio/store";
import { formatRuntimeMinutes } from "@/lib/utils";

const PAGE_SIZE = 3;

function relativeModified(timestamp: number): string {
  if (!timestamp || timestamp <= 1) return "Studio sample";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  return `Edited ${days} days ago`;
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
  const [page, setPage] = useState(0);
  const visible = [...pictures]
    .filter(
      (picture) =>
        (filter === "all" || (filter === "samples" ? picture.sample : !picture.sample)) &&
        `${picture.title} ${picture.logline} ${picture.genre}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);

  return (
    <section className="home-library" aria-labelledby="pictures-heading">
      <div className="home-library-heading">
        <h1 id="pictures-heading">Your films<span className="home-library-count">{pictures.length}</span></h1>
        <Button className="home-create" size="icon" onClick={onNew} aria-label="New movie script" title="New movie script">
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <div className="home-library-tools">
        <label className="home-search">
          <Search className="size-4" aria-hidden="true" />
          <Input
            aria-label="Search movie scripts"
            placeholder="Find a film…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          />
        </label>
        <select
          className="home-filter"
          aria-label="Filter movie scripts"
          value={filter}
          onChange={(event) => { setFilter(event.target.value); setPage(0); }}
        >
          <option value="all">All films</option>
          <option value="projects">My films</option>
          <option value="samples">Samples</option>
        </select>
      </div>

      <ul className="home-gallery">
        {visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((picture) => (
          <li key={picture.id} className="home-picture">
            <button
              type="button"
              className="home-picture-open"
              onClick={() => onOpen(picture.id)}
              aria-label={`Open ${picture.title}`}
            >
              <span className="home-picture-art">
                <PictureCover picture={picture} />
                <span className="home-picture-enter" aria-hidden="true"><ArrowUpRight /></span>
              </span>
              <span className="home-picture-copy">
                <span className="home-picture-title">{picture.title}</span>
                {picture.logline && <span className="home-picture-logline">{picture.logline}</span>}
              </span>
            </button>
            <div className="home-picture-footer">
              <span className="home-picture-meta">
                <span>{picture.sample ? "Sample" : relativeModified(picture.updatedAt)}</span>
                {picture.runtimeMinutes > 0 && <span>{formatRuntimeMinutes(picture.runtimeMinutes)}</span>}
              </span>
              {!picture.sample && (
                <AlertDialog.Root>
                  <AlertDialog.Trigger asChild>
                    <Button variant="ghost" size="icon" className="home-picture-delete" aria-label={`Delete picture ${picture.title}`} title="Delete film">
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="cabinet-overlay" />
                    <AlertDialog.Content className="home-delete-dialog">
                      <AlertDialog.Title>Delete “{picture.title}”?</AlertDialog.Title>
                      <AlertDialog.Description>
                        This removes the film and its saved work from your library. This cannot be undone.
                      </AlertDialog.Description>
                      <div className="home-delete-actions">
                        <AlertDialog.Cancel asChild><Button variant="secondary">Keep film</Button></AlertDialog.Cancel>
                        <AlertDialog.Action asChild><Button variant="rec" onClick={() => deletePicture(picture.id)}>Delete film</Button></AlertDialog.Action>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!visible.length && (
        <p className="home-library-empty" role="status">
          {query || filter !== "all" ? "No films match. Try another search or filter." : "Your next film starts here. Use + to begin."}
        </p>
      )}
      {pages > 1 && (
        <div className="home-gallery-paging" aria-label="Film gallery pages">
          <Button variant="ghost" size="icon" aria-label="Previous films" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
          <span aria-live="polite">{currentPage + 1} / {pages}</span>
          <Button variant="ghost" size="icon" aria-label="Next films" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
        </div>
      )}
    </section>
  );
}
