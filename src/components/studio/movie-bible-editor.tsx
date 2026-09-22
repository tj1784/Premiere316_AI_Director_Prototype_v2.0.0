import { openAssetIterations, openScreenplayScene } from "./workspace-links";
import { CharacterVoiceSamples } from "./character-voice-samples";
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
  const [category, setCategory] = useWorkspaceDraft(`bible-category:${title}`, "all");
  const [fieldGroup, setFieldGroup] = useWorkspaceDraft(`bible-field-group:${title}`, "all");
  const [selected, setSelected] = useWorkspaceDraft(`bible-record:${title}`, "");
  const [editing, setEditing] = useWorkspaceDraft<string | null>(`bible-edit-field:${title}`, null);
  const [value, setValue] = useWorkspaceDraft(`bible-edit-value:${title}`, "");
  const [reason, setReason] = useWorkspaceDraft(`bible-edit-source:${title}`, "");
  const [na, setNa] = useWorkspaceDraft(`bible-edit-na:${title}`, false);
  if (!picture) return null;
  const allRows = movieBibleIndex(picture);
  const availableRows = allRows.filter(
    (r) => (!kinds || kinds.includes(r.kind as BibleKind)) && r.status !== "deleted",
  );
  const rows = availableRows.filter((r) => category === "all" || r.kind === category);
  const row =
    allRows.find((r) => r.id === selected && (category === "all" || r.kind === category)) ??
    rows[0] ??
    availableRows[0];
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
  const asset = picture.production?.assets.find(
    (a) => a.id === row.id || (row.kind === "participant" && a.id === row.parentId),
  );
  const media =
    asset?.iterations.find((i) => i.id === asset.approvedIterationId) ??
    [...(asset?.iterations ?? [])].reverse().find((i) => i.mediaUri);
  const mediaUri =
    media?.previewUri ?? media?.mediaUri ?? asset?.references.find((r) => r.preferred)?.uri;
  const groups =
    kind === "character"
      ? [
          { id: "identity", label: "Identity & appearance", fields: fields?.slice(0, 4) ?? [] },
          { id: "inner", label: "Motivation & relationships", fields: fields?.slice(4, 11) ?? [] },
          { id: "performance", label: "Performance & voice", fields: fields?.slice(11) ?? [] },
        ]
      : kind === "location"
        ? [
            { id: "geography", label: "Geography & space", fields: fields?.slice(0, 4) ?? [] },
            {
              id: "atmosphere",
              label: "Light, sound & boundaries",
              fields: fields?.slice(4) ?? [],
            },
          ]
        : kind === "participant"
          ? [
              {
                id: "intention",
                label: "Objective & permissions",
                fields: fields?.slice(0, 5) ?? [],
              },
              { id: "state", label: "Incoming & outgoing state", fields: fields?.slice(5) ?? [] },
            ]
          : [{ id: "direction", label: "Creative direction", fields: fields ?? [] }];
  const displayedFields =
    fieldGroup === "all" ? fields : (groups.find((g) => g.id === fieldGroup)?.fields ?? fields);
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
        <div className="workspace-tabs mb-4" aria-label="Bible record categories">
          <button
            aria-pressed={category === "all"}
            onClick={() => {
              setCategory("all");
              setFieldGroup("all");
            }}
          >
            All
          </button>
          {[...new Set(availableRows.map((r) => r.kind))].map((kind) => (
            <button
              key={kind}
              aria-pressed={category === kind}
              onClick={() => {
                setCategory(kind);
                setSelected("");
                setEditing(null);
                setFieldGroup("all");
              }}
            >
              {(
                {
                  character: "Characters",
                  participant: "Scene states",
                  location: "Locations",
                  prop: "Props",
                  wardrobe: "Wardrobe",
                } as Record<string, string>
              )[kind] ?? kind.replaceAll("-", " ")}
            </button>
          ))}
        </div>
        <Input
          aria-label="Search Bible records"
          placeholder="Search names, IDs, type or status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="bible-sheet-layout mt-4">
          <div className="bible-record-list" role="list" aria-label="Bible records">
            {rows
              .filter((r) =>
                bibleSearchText(r, picture).toLowerCase().includes(query.toLowerCase()),
              )
              .map((r) => (
                <button
                  key={`${r.kind}:${r.id}`}
                  className="workspace-nav-link"
                  aria-current={row.id === r.id ? "true" : undefined}
                  onClick={() => {
                    setSelected(r.id);
                    setEditing(null);
                    setFieldGroup("all");
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
                  setCategory("all");
                  setFieldGroup("all");
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

            {row.hash && <p className="my-2 break-all text-xs text-muted">SHA-256: {row.hash}</p>}
            {row.relations?.map((relation) => (
              <Button
                key={`${relation.type}:${relation.targetId}`}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCategory("all");
                  setFieldGroup("all");
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
            <div className="workspace-tabs my-4" aria-label="Direction sections">
              <button aria-pressed={fieldGroup === "all"} onClick={() => setFieldGroup("all")}>
                All direction
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  aria-pressed={fieldGroup === group.id}
                  onClick={() => setFieldGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </div>
            {displayedFields?.map((field) => (
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
          <aside className="bible-media-inspector" aria-label="Linked media and scene context">
            <p className="workspace-eyebrow">MEDIA & CONTEXT</p>
            {mediaUri ? (
              <figure className="mt-4">
                <img
                  src={mediaUri}
                  alt={row.name}
                  className="aspect-square w-full rounded bg-inset object-contain"
                />
                <figcaption className="mt-2 text-xs text-muted">
                  {asset?.approvedIterationId && asset.approvedIterationId === media?.id
                    ? "Approved image"
                    : "Preview · awaiting approval"}
                </figcaption>
              </figure>
            ) : (
              <p className="mt-4 text-sm text-muted">No selected image for this record.</p>
            )}
            {kind === "character" && (
              <div className="mt-5">
                <CharacterVoiceSamples pictureId={picture.id} characterId={row.id} />
              </div>
            )}
            {asset && (
              <Button
                className="mt-4 w-full"
                variant="secondary"
                onClick={() => openAssetIterations(picture.id, asset.id)}
              >
                Open asset iterations
              </Button>
            )}
            <h4 className="mt-6 text-sm">Linked scenes</h4>
            <ul className="mt-2 space-y-2 text-xs text-muted">
              {(asset?.requiredSceneIds ?? []).map((id) => (
                <li key={id}>
                  <button
                    className="min-h-11 text-left hover:text-accent"
                    onClick={() => openScreenplayScene(picture, id)}
                  >
                    {picture.production?.scenes.find((s) => s.id === id)?.slugline ?? id}
                  </button>
                </li>
              ))}
            </ul>
            {!asset?.requiredSceneIds.length && (
              <p className="mt-2 text-xs text-muted">No linked scenes recorded.</p>
            )}
            <p className="mt-6 text-xs text-muted">
              {row.status} · revision {record?.revision ?? row.revision}
            </p>
            {row.uri && (
              <details className="mt-4 text-xs">
                <summary>Media location</summary>
                <p className="mt-2 break-all text-muted">{row.uri}</p>
              </details>
            )}
          </aside>
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
