import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileUp,
  Film,
  Home,
  PenLine,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PictureCover } from "./picture-cover";
import type { PreparedPicture } from "@/lib/studio/picture-preparation";
import { useStudio } from "@/lib/studio/store";
import { formatRuntimeMinutes } from "@/lib/utils";
import { STAGES } from "@/lib/studio/types";
import "./ps5-canvas.css";

const PAGE_SIZE = 6;
const PRODIGAL_AMBIENT_IMAGE = "/pictures/prodigal-son/previews/PS-S18-SH005-FIRST.webp";

function heroArtFor(picture: PreparedPicture | null): string[] {
  if (!picture) return [];
  const savedStill = picture.shots.find((shot) => shot.stillUrl)?.stillUrl;
  const sampleAmbient = picture.id === "pic_prodigal_son_20260909" ? PRODIGAL_AMBIENT_IMAGE : null;
  return [...new Set([sampleAmbient, savedStill, picture.thumbnailUrl].filter((uri): uri is string => Boolean(uri)))];
}

function relativeModified(timestamp: number): string {
  if (!timestamp || timestamp <= 1) return "Studio sample";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  return "Edited " + days + " days ago";
}

export function PicturesLibrary({
  pictures,
  onNew,
  onOpen,
  onImport,
  importing = false,
}: {
  pictures: PreparedPicture[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onImport?: () => void;
  importing?: boolean;
}) {
  const deletePicture = useStudio((state) => state.deletePicture);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [failedHero, setFailedHero] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  const visible = [...pictures]
    .filter(
      (picture) =>
        (filter === "all" || (filter === "samples" ? picture.sample : !picture.sample)) &&
        (picture.title + " " + picture.logline + " " + picture.genre)
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const pagePictures = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const featured =
    pagePictures.find((picture) => picture.id === featuredId) ?? pagePictures[0] ?? null;
  const pendingPicture = pictures.find((picture) => picture.id === pendingDelete) ?? null;
  const heroArt = heroArtFor(featured).find((uri) => !failedHero.includes(uri));
  const hasHeroArt = Boolean(heroArt);

  useEffect(() => {
    if (pendingDelete) keepButton.current?.focus();
  }, [pendingDelete]);

  useEffect(() => {
    if (searchOpen) searchField.current?.focus();
  }, [searchOpen]);

  const keepFilm = () => {
    setPendingDelete(null);
    deleteTrigger.current?.focus();
  };
  const changeFeature = (direction: number) => {
    const index = featured ? visible.findIndex((picture) => picture.id === featured.id) : -1;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= visible.length) return;
    setFeaturedId(visible[nextIndex].id);
    setPage(Math.floor(nextIndex / PAGE_SIZE));
  };
  const openFeaturedWorkspace = (destination: "bible" | "screenplay" | "visual-development") => {
    if (!featured) return;
    onOpen(featured.id);
    if (destination === "bible") useStudio.getState().patchActive({ workspacePanel: "bible" });
    else {
      useStudio.getState().patchActive({ workspacePanel: null });
      useStudio.getState().openAdvancedDepartment(destination);
    }
  };

  return (
    <section
      className="home-library home-cinema"
      aria-labelledby="pictures-heading"
      data-has-art={hasHeroArt}
    >
      {hasHeroArt && heroArt && (
        <img
          className="home-cinema-image"
          src={heroArt}
          alt=""
          aria-hidden="true"
          onError={() => setFailedHero((previous) => [...previous, heroArt])}
        />
      )}
      <div className="home-cinema-vignette" aria-hidden="true" />

      <nav className="home-icon-dock" aria-label="Film workspace">
        <button
          type="button"
          className="home-dock-icon"
          aria-label="Home · show all films"
          title="Show all films"
          aria-current={!searchOpen && !query && filter === "all" ? "page" : undefined}
          onClick={() => {
            setQuery("");
            setFilter("all");
            setPage(0);
            setFeaturedId(null);
            setSearchOpen(false);
          }}
        ><Home aria-hidden="true" /></button>
        <button
          type="button"
          className="home-dock-icon"
          aria-label="Open selected film"
          title="Open selected film"
          disabled={!featured}
          onClick={() => featured && onOpen(featured.id)}
        ><Film aria-hidden="true" /></button>
        <button
          ref={searchTrigger}
          type="button"
          className="home-dock-icon"
          aria-label="Find and filter films"
          title="Find and filter films"
          aria-expanded={searchOpen}
          aria-controls="home-film-finder"
          data-active={searchOpen || Boolean(query) || filter !== "all"}
          onClick={() => setSearchOpen((current) => !current)}
        ><Search aria-hidden="true" /></button>
        <button
          type="button"
          className="home-dock-icon"
          aria-label="Open selected film's Production Bible"
          title="Production Bible"
          disabled={!featured}
          onClick={() => openFeaturedWorkspace("bible")}
        ><BookOpen aria-hidden="true" /></button>
        <button
          type="button"
          className="home-dock-icon"
          aria-label="Open selected film's characters"
          title="Characters"
          disabled={!featured}
          onClick={() => openFeaturedWorkspace("visual-development")}
        ><Users aria-hidden="true" /></button>
        <button
          type="button"
          className="home-dock-icon"
          aria-label="Open selected film's screenplay"
          title="Screenplay"
          disabled={!featured}
          onClick={() => openFeaturedWorkspace("screenplay")}
        ><PenLine aria-hidden="true" /></button>
      </nav>

      {searchOpen && <div
        id="home-film-finder"
        className="home-library-tools"
        role="region"
        aria-label="Find and filter films"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setSearchOpen(false);
            searchTrigger.current?.focus();
          }
        }}
      >
        <label className="home-search">
          <Search className="size-4" aria-hidden="true" />
          <Input
            ref={searchField}
            aria-label="Search movie scripts"
            placeholder="Find a film…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          className="home-filter"
          aria-label="Filter movie scripts"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">All films</option>
          <option value="projects">My films</option>
          <option value="samples">Samples</option>
        </select>
        <span className="home-library-count" aria-live="polite">
          {visible.length} films
        </span>
      </div>}

      <div className="home-library-heading">
        <div className="home-feature-copy">
          <p className="home-library-eyebrow">
            {featured ? (featured.sample ? "Featured film" : "Your film") : "Your picture library"}
          </p>
          <h1 id="pictures-heading">{featured?.title ?? "Your films"}</h1>
          <p className="home-feature-description">
            {featured?.logline ||
              (featured
                ? "Your story is ready to develop."
                : "Start a new film or import a screenplay or source text.")}
          </p>
          {featured && (
            <p className="home-feature-meta">
              <span>{featured.genre || "Genre not set"}</span>
              <span aria-hidden="true">·</span>
              {STAGES.find((stage) => stage.id === (featured.lastOpenedStage ?? featured.stage))
                ?.label ?? "Picture setup"}
              <span aria-hidden="true">·</span>
              {featured.scenes.length ? featured.scenes.length + " scenes" : "No scenes yet"}
              {featured.runtimeMinutes > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  {formatRuntimeMinutes(featured.runtimeMinutes)}
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{featured.sample ? "Sample" : relativeModified(featured.updatedAt)}</span>
            </p>
          )}
          <div className="home-library-actions">
            {featured && (
              <Button className="home-resume" onClick={() => onOpen(featured.id)}>
                <Play aria-hidden="true" />
                Resume
              </Button>
            )}
            <Button
              className="home-create"
              variant="secondary"
              onClick={onNew}
              aria-label="New movie script"
            >
              <Plus aria-hidden="true" />
              New film
            </Button>
            {onImport && (
              <Button
                className="home-import"
                variant="ghost"
                onClick={onImport}
                disabled={importing}
              >
                <FileUp aria-hidden="true" />
                {importing ? "Importing…" : "Import source"}
              </Button>
            )}
          </div>
          {pendingPicture && (
            <div
              id="home-delete-confirm"
              className="home-picture-delete-inline"
              role="group"
              aria-label={"Delete " + pendingPicture.title}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  keepFilm();
                }
              }}
            >
              <p>Delete “{pendingPicture.title}” and its saved work? This cannot be undone.</p>
              <div className="home-delete-actions">
                <Button ref={keepButton} variant="secondary" size="sm" onClick={keepFilm}>
                  Keep film
                </Button>
                <Button
                  variant="rec"
                  size="sm"
                  onClick={() => {
                    setPendingDelete(null);
                    deletePicture(pendingPicture.id);
                  }}
                >
                  Delete film
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="home-film-rail" aria-label="Films">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous films"
          disabled={!featured || visible[0]?.id === featured.id}
          onClick={() => changeFeature(-1)}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <ul className="home-gallery" aria-label="Film artwork">
          {pagePictures.map((picture) => (
            <li key={picture.id} className="home-picture" data-active={featured?.id === picture.id}>
              <button
                type="button"
                className="home-picture-open"
                onClick={() => onOpen(picture.id)}
                onMouseEnter={() => setFeaturedId(picture.id)}
                onFocus={() => setFeaturedId(picture.id)}
                aria-label={"Open " + picture.title}
                aria-current={featured?.id === picture.id ? "true" : undefined}
              >
                <span className="home-picture-art">
                  {picture.thumbnailUrl ? (
                    <PictureCover picture={picture.id === "pic_prodigal_son_20260909"
                      ? { ...picture, thumbnailUrl: PRODIGAL_AMBIENT_IMAGE }
                      : picture} />
                  ) : (
                    <span className="home-picture-missing-art" aria-hidden="true">
                      <Film strokeWidth={1.2} />
                      <small>No image attached</small>
                    </span>
                  )}
                </span>
                <span className="home-picture-title">{picture.title}</span>
              </button>
              <div className="home-picture-footer">
                <span className="home-picture-stage">
                  {STAGES.find((stage) => stage.id === (picture.lastOpenedStage ?? picture.stage))
                    ?.label ?? "Picture setup"}
                </span>
                <button
                  type="button"
                  className="home-picture-resume"
                  onClick={() => onOpen(picture.id)}
                  aria-label={"Resume " + picture.title}
                >
                  <ArrowUpRight aria-hidden="true" />
                </button>
                {!picture.sample && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="home-picture-delete"
                    aria-label={"Delete picture " + picture.title}
                    title="Delete film"
                    aria-expanded={pendingDelete === picture.id}
                    aria-controls="home-delete-confirm"
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget;
                      setFeaturedId(picture.id);
                      setPendingDelete((current) => (current === picture.id ? null : picture.id));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next films"
          disabled={!featured || visible[visible.length - 1]?.id === featured.id}
          onClick={() => changeFeature(1)}
        >
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
      {!visible.length && (query || filter !== "all") && (
        <p className="home-library-empty" role="status">
          No films match. Try another search or filter.
        </p>
      )}
      <span className="home-gallery-paging" aria-live="polite">
        {visible.length ? currentPage + 1 : 0} / {visible.length ? pages : 0}
      </span>
    </section>
  );
}
