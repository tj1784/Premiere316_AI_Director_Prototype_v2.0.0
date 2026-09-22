import { useEffect, useState } from "react";
import { FolderOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { Input } from "@/components/ui/field";
import type { Picture } from "@/lib/studio/types";
import type { ProjectLibrary } from "@/lib/studio/project-library-client";

export function ProjectFiles({
  picture,
  iconOnly = false,
}: {
  picture: Picture;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<ProjectLibrary | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(48);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    setLibrary(null);
    void fetch(`/api/project-storage?picture=${encodeURIComponent(picture.id)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
          throw new Error(
            "Project files are available in the local Premiere316 app after the picture is saved.",
          );
        setLibrary(await response.json());
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [open, picture.id]);
  const categories = [...new Set(library?.entries.map((e) => e.category) ?? [])].sort();
  const entries =
    library?.entries.filter(
      (e) =>
        (category === "all" || e.category === category) &&
        `${e.name} ${e.category}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          size={iconOnly ? "icon-sm" : "sm"}
          variant="ghost"
          aria-label="Project files"
          title="Project files"
        >
          <FolderOpen className="size-4" />
          {!iconOnly && <span>Project files</span>}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80" />
        <Dialog.Content className="fixed inset-4 z-50 mx-auto flex max-w-5xl flex-col gap-4 overflow-hidden rounded-xl border border-border bg-bg p-4 text-fg sm:inset-8 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-lg">
              {picture.title} · Project files
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="sm" variant="ghost">
                Close
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-muted">
            Assets saved with this picture, grouped by category.
          </Dialog.Description>
          {error ? (
            <p role="alert" className="text-sm text-muted">
              {error}
            </p>
          ) : !library ? (
            <p role="status">Opening project files…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <Search className="size-4 shrink-0" />
                  <Input
                    aria-label="Search project files"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setLimit(48);
                    }}
                    placeholder="Search files"
                  />
                </label>
                <select
                  aria-label="File category"
                  className="min-h-11 max-w-full rounded-md border border-border bg-surface px-3 text-sm text-fg"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setLimit(48);
                  }}
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("-", " ")}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-muted">{entries.length} files</span>
              </div>
              {library.missing.length > 0 ? (
                <p className="text-sm text-muted">
                  {library.missing.length} older references could not be found. Available files are
                  shown below.
                </p>
              ) : null}
              <div className="min-h-0 overflow-y-auto">
                {!entries.length ? (
                  <p className="py-10 text-center text-sm text-muted">
                    {library.entries.length
                      ? "No files match this filter."
                      : "No media yet. Imported and generated assets will appear here when saved."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {entries.slice(0, limit).map((entry) => (
                      <article
                        key={entry.file}
                        className="min-w-0 rounded-lg border border-border bg-surface p-3"
                      >
                        {/\.(png|jpe?g|webp)$/i.test(entry.name) ? (
                          <img
                            loading="lazy"
                            src={entry.uri}
                            alt={entry.name}
                            className="mb-3 aspect-video w-full rounded object-contain"
                          />
                        ) : /\.(wav|mp3|ogg|flac|m4a)$/i.test(entry.name) ? (
                          <audio controls preload="none" src={entry.uri} className="mb-3 w-full" />
                        ) : /\.(mp4|webm|mov)$/i.test(entry.name) ? (
                          <video
                            controls
                            preload="none"
                            src={entry.uri}
                            className="mb-3 aspect-video w-full"
                          />
                        ) : (
                          <FolderOpen className="my-5 size-8 text-muted" />
                        )}
                        <p className="break-all text-sm">{entry.name}</p>
                        <p className="mt-1 text-xs text-muted">
                          {entry.category.replaceAll("-", " ")} ·{" "}
                          {(entry.bytes / 1024 / 1024).toFixed(1)} MB
                        </p>
                        <a
                          className="mt-3 inline-flex min-h-11 items-center text-sm text-accent underline"
                          href={entry.uri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open file
                        </a>
                      </article>
                    ))}
                  </div>
                )}
                {entries.length > limit ? (
                  <Button
                    variant="ghost"
                    className="mt-4 w-full"
                    onClick={() => setLimit(limit + 48)}
                  >
                    Show more files
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
