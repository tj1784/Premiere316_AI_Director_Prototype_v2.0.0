import { useState } from "react";
import {
  BIBLE_FIELDS,
  editBibleField,
  movieBibleIndex,
  resolveBibleRecord,
  bibleSearchText,
  type BibleKind,
} from "@/lib/studio/movie-bible";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { toast } from "sonner";
import { RenderContextEditor } from "./render-context-editor";
import type { StageId } from "@/lib/studio/types";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { BibleLibrarySearch } from "./bible-library-search";

export function MovieBibleEditor({
  kinds,
  title = "Movie Script Bible",
}: { kinds?: BibleKind[]; title?: string } = {}) {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useWorkspaceDraft(`bible-record:${title}`, "");
  const [editing, setEditing] = useWorkspaceDraft<string | null>(`bible-edit-field:${title}`, null);
  const [value, setValue] = useWorkspaceDraft(`bible-edit-value:${title}`, "");
  const [reason, setReason] = useWorkspaceDraft(`bible-edit-source:${title}`, "");
  const [na, setNa] = useWorkspaceDraft(`bible-edit-na:${title}`, false);
  if (!picture) return null;
  const allRows = movieBibleIndex(picture);
  const rows = allRows.filter((r) => !kinds || kinds.includes(r.kind as BibleKind));
  const row = allRows.find((r) => r.id === selected) ?? rows[0];
  if (!row)
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-muted">
          No source records yet. Prepare the approved screenplay inventory to author linked sheets
          and states here.
        </p>
      </section>
    );
  const kind = row.kind as BibleKind;
  const fields = BIBLE_FIELDS[kind];
  const record = picture.movieBible?.records[row.id];
  return (
    <div className="grid gap-6">
      {!kinds && <BibleLibrarySearch />}
      <section
        className="rounded-lg border border-border bg-surface p-4"
        aria-label="Movie Script Bible"
      >
        <header className="mb-4">
          <h2 className="text-2xl">{title}</h2>
          <p className="mt-2 text-sm text-muted">
            Source-linked creative direction. Identity, selected media and scene state stay
            separate.
          </p>
        </header>
        {!kinds && (
          <label className="mb-4 grid gap-2 text-sm">
            Picture-specific creative preset
            <select
              className="rounded border border-border bg-inset p-3"
              value={picture.creativePreset ?? "none"}
              onChange={(e) => patch({ creativePreset: e.target.value as "none" | "harrowing-v3" })}
            >
              <option value="none">None — general film Bible</option>
              <option value="harrowing-v3">
                Harrowing of Hell V3 — scoped source and silence rules
              </option>
            </select>
            <span className="text-xs text-muted">
              Applies to future authoring context only. Existing approved work is not rewritten.
            </span>
          </label>
        )}
        <Input
          aria-label="Search Bible records"
          placeholder="Search names, IDs, type or status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)]">
          <div className="max-h-96 overflow-auto" role="list" aria-label="Bible records">
            {rows
              .filter((r) =>
                bibleSearchText(r, picture)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((r) => (
                <button
                  key={`${r.kind}:${r.id}`}
                  className="workspace-nav-link"
                  aria-current={row.id === r.id ? "true" : undefined}
                  onClick={() => {
                    setSelected(r.id);
                    setEditing(null);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block break-words">{r.name}</span>
                    <small className="block text-muted">
                      {r.kind} · {r.status}
                    </small>
                  </span>
                </button>
              ))}
          </div>
          <div className="min-w-0">
            <h3 className="text-xl">{row.name}</h3>
            <p className="my-2 break-all text-xs text-muted">
              {row.id} · revision {record?.revision ?? row.revision}
            </p>
            {row.parentId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected(row.parentId!);
                  setEditing(null);
                }}
              >
                Open parent source
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                patch({ workspacePanel: row.kind === "run" ? "run" : null });
                if (row.kind !== "run")
                  useStudio.getState().openAdvancedDepartment(row.locator as StageId);
                if (row.kind === "shot") useStudio.getState().selectShot(row.id);
              }}
            >
              Open canonical workspace
            </Button>
            {row.uri && (
              <p className="my-2 break-all text-xs text-muted">Canonical media: {row.uri}</p>
            )}
            {row.hash && <p className="my-2 break-all text-xs text-muted">SHA-256: {row.hash}</p>}
            {row.relations?.map((relation) => (
              <Button
                key={`${relation.type}:${relation.targetId}`}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected(relation.targetId);
                  setEditing(null);
                }}
              >
                {relation.type}: {relation.targetId}
              </Button>
            ))}
            <details className="my-3">
              <summary className="cursor-pointer text-sm">
                Exact canonical source / stored snapshot
              </summary>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-inset p-3 text-xs">
                {JSON.stringify(resolveBibleRecord(picture, row.id), null, 2)}
              </pre>
            </details>
            {!fields && (
              <p className="my-2 text-sm text-muted">
                This record remains owned by its canonical workspace. Review, approval and media
                controls stay attached to that source.
              </p>
            )}
            {fields?.map((field) => (
              <div key={field} className="border-t border-border py-3">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-medium">{field}</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(field);
                      setValue(record?.fields[field]?.value ?? "");
                      setReason(record?.fields[field]?.source ?? "User direction");
                      setNa(record?.fields[field]?.disposition === "not-applicable");
                    }}
                  >
                    Edit
                  </Button>
                </div>
                {editing === field ? (
                  <div className="grid gap-2">
                    <Textarea
                      aria-label={field}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                    <Input
                      aria-label="Source or correction reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={na}
                        onChange={(e) => setNa(e.target.checked)}
                      />
                      Not applicable (explain above)
                    </label>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          try {
                            patch({
                              movieBible: editBibleField(
                                picture,
                                row.id,
                                kind,
                                field,
                                value,
                                reason,
                                na ? "not-applicable" : "authored",
                              ),
                            });
                            setEditing(null);
                          } catch (error) {
                            toast.error(String(error));
                          }
                        }}
                      >
                        Save direction
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm text-muted">
                      {record?.fields[field]?.value || "Not yet authored"}
                    </p>
                    {record?.fields[field] && (
                      <p className="mt-1 text-xs text-muted">
                        {record.fields[field].disposition} · {record.fields[field].source}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer py-3">Source correction history</summary>
          {(picture.movieBible?.corrections ?? [])
            .filter((c) => c.recordId === row.id)
            .reverse()
            .map((c) => (
              <div key={c.id} className="border-t border-border py-3 text-sm">
                <p>
                  {c.field} · revision {c.after.revision}
                </p>
                <p className="text-muted whitespace-pre-wrap">
                  {c.before?.value || "Missing"} → {c.after.value}
                </p>
                <p className="text-xs text-muted">{c.after.source}</p>
              </div>
            ))}
        </details>
      </section>
      {!kinds && <RenderContextEditor />}
    </div>
  );
}
