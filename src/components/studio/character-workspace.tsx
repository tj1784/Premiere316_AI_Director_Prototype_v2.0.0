import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FileText,
  History,
  Pencil,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Picture } from "@/lib/studio/types";
import { BIBLE_FIELDS, movieBibleIndex, type BibleKind } from "@/lib/studio/movie-bible";
import {
  applyCharacterFieldEdit,
  CHARACTER_FIELD_DETAILS,
  CHARACTER_SECTIONS,
  characterFieldView,
  type BibleFieldEdit,
} from "@/lib/studio/character-dossier";
import { useStudio } from "@/lib/studio/store";
import { CabinetModal } from "./cabinet";
import { MovieBibleEditor } from "./movie-bible-editor";
import { CharacterMediaPanel } from "./character-media-panel";
import { CharacterScenePanel, participantFieldView } from "./character-scene-panel";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";

const fieldLabel = (field: string) => CHARACTER_FIELD_DETAILS[field]?.label ?? field;
const statusLabel = (status: string) =>
  ({
    source: "Source · review",
    missing: "Missing",
    authored: "Direction",
    "not-applicable": "Not applicable",
  })[status] ?? status;

export function CharacterWorkspace({
  picture,
  onVisual,
}: {
  picture: Picture;
  onVisual: () => void;
}) {
  const [selected, setSelected] = useWorkspaceDraft("bible-record:Characters & world", "");
  const [sectionId, setSectionId] = useWorkspaceDraft("character-dossier-section", "identity");
  const [worldKind, setWorldKind] = useWorkspaceDraft<
    "character" | "location" | "prop" | "wardrobe"
  >("character-dossier-world", "character");
  const [compactPane, setCompactPane] = useState("dossier");
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<"source" | "history" | "coverage" | null>(null);
  const [editing, setEditing] = useState<{
    recordId: string;
    kind: BibleKind;
    field: string;
  } | null>(null);
  const rows = movieBibleIndex(picture).filter(
    (row) => row.kind === "character" && row.status !== "deleted",
  );
  const participantOwner = Object.entries(picture.performance?.performance ?? {})
    .flatMap(([beatId, people]) =>
      Object.keys(people).map((characterId) => ({
        id: `performance:${beatId}:${characterId}`,
        characterId,
      })),
    )
    .find((item) => item.id === selected)?.characterId;
  const row = rows.find((r) => r.id === (participantOwner ?? selected)) ?? rows[0];
  const asset = picture.production?.assets.find((a) => a.id === row?.id && !a.tombstone);
  const legacy = picture.characters.find((c) => c.id === row?.id);
  const visual = picture.visualDevelopment?.characterBibles.find((c) => c.characterId === row?.id);
  const section = CHARACTER_SECTIONS.find((s) => s.id === sectionId) ?? CHARACTER_SECTIONS[0];
  const fields = BIBLE_FIELDS.character.map((field) => ({
    field,
    ...characterFieldView(picture, row?.id ?? "", field),
  }));
  const missing = fields.filter((f) => f.disposition === "missing" || !f.value.trim()).length;
  const participantIds = new Set(
    Object.entries(picture.performance?.performance ?? {}).flatMap(([beatId, people]) =>
      row && people[row.id] ? [`performance:${beatId}:${row.id}`] : [],
    ),
  );
  const corrections = (picture.movieBible?.corrections ?? [])
    .filter((c) => c.recordId === row?.id || participantIds.has(c.recordId))
    .slice()
    .reverse();
  const filtered = rows.filter((r) =>
    [r.name, ...(r.aliases ?? [])].some((v) =>
      v.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  );
  const index = rows.findIndex((r) => r.id === row?.id);
  const choose = (id: string) => {
    setSelected(id);
    setPicker(false);
    setQuery("");
    setEditing(null);
  };
  const onEdit = (recordId: string, kind: BibleKind, field: string) =>
    setEditing({ recordId, kind, field });
  return (
    <div className="character-workspace" data-compact-pane={compactPane}>
      <header className="character-workspace-heading">
        <div className="character-heading-main">
          <div className="character-eyebrow">
            <Users size={13} />
            <select
              aria-label="Character and world records"
              value={worldKind}
              onChange={(e) => setWorldKind(e.target.value as typeof worldKind)}
            >
              <option value="character">Characters</option>
              <option value="location">Locations</option>
              <option value="prop">Props</option>
              <option value="wardrobe">Wardrobe</option>
            </select>
            <span>
              {worldKind === "character" ? `${rows.length} in this picture` : "World records"}
            </span>
          </div>
          {worldKind === "character" && (
            <div className="character-title-row">
              <button
                className="character-title-button"
                onClick={() => setPicker(true)}
                disabled={!rows.length}
                aria-label={`Choose character, current ${row?.name ?? "none"}`}
              >
                <h1>{row?.name ?? "Character workspace"}</h1>
                <ChevronDown size={19} />
              </button>
              <div className="character-stepper">
                <button
                  aria-label="Previous character"
                  disabled={index <= 0}
                  onClick={() => choose(rows[index - 1].id)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {rows.length ? index + 1 : 0}
                  <i>/</i>
                  {rows.length}
                </span>
                <button
                  aria-label="Next character"
                  disabled={index < 0 || index >= rows.length - 1}
                  onClick={() => choose(rows[index + 1].id)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="character-heading-actions">
          {worldKind === "character" && row && (
            <button className="character-coverage-pill" onClick={() => setDetail("coverage")}>
              <span
                className={missing ? "character-status-dot incomplete" : "character-status-dot"}
              />
              {missing ? `${missing} fields need direction` : "All fields recorded"}
              <ChevronDown size={13} />
            </button>
          )}
          {worldKind === "character" && (
            <>
              <button
                className="character-tool"
                title="Source dossier"
                aria-label="Source dossier"
                onClick={() => setDetail("source")}
                disabled={!row}
              >
                <FileText size={18} />
              </button>
              <button
                className="character-tool"
                title="Character revision history"
                aria-label="Character revision history"
                onClick={() => setDetail("history")}
                disabled={!row}
              >
                <History size={18} />
              </button>
            </>
          )}
          <button className="character-quiet-action" onClick={onVisual}>
            Visual development
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>
      {worldKind !== "character" ? (
        <div className="character-world-records">
          <MovieBibleEditor
            key={worldKind}
            kinds={[worldKind]}
            title={`${worldKind[0].toUpperCase()}${worldKind.slice(1)} records`}
          />
        </div>
      ) : !row ? (
        <div className="character-zero">
          <Users size={32} />
          <h2>No characters linked yet</h2>
          <p>Prepare or import the screenplay inventory to begin the character sheets.</p>
          <Button onClick={() => useStudio.getState().openAdvancedDepartment("inventory")}>
            Open asset inventory
            <ArrowUpRight size={15} />
          </Button>
        </div>
      ) : (
        <>
          <div className="character-compact-tabs" role="group" aria-label="Character panels">
            {[
              ["media", "References & voice"],
              ["dossier", "Character sheet"],
              ["scene", "Scene state"],
            ].map(([id, label]) => (
              <button key={id} aria-pressed={compactPane === id} onClick={() => setCompactPane(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="character-workspace-grid">
            <aside className="character-reference-column">
              <CharacterMediaPanel key={row.id} picture={picture} record={row} asset={asset} />
            </aside>
            <section
              className="character-dossier-column"
              aria-label={`${row.name} character sheet`}
            >
              <Tabs.Root
                value={section.id}
                onValueChange={setSectionId}
                className="character-sections"
              >
                <Tabs.List aria-label="Character sheet sections" className="character-section-tabs">
                  {CHARACTER_SECTIONS.map((item) => {
                    const count = item.fields.filter(
                      (n) => fields[n].disposition !== "missing" && fields[n].value.trim(),
                    ).length;
                    return (
                      <Tabs.Trigger key={item.id} value={item.id}>
                        {item.title}
                        <span aria-label={`${count} of ${item.fields.length} fields recorded`}>
                          {count}/{item.fields.length}
                        </span>
                      </Tabs.Trigger>
                    );
                  })}
                </Tabs.List>
                {CHARACTER_SECTIONS.map((item) => (
                  <Tabs.Content key={item.id} value={item.id} className="character-section-body">
                    <div className="character-section-intro">
                      <p>{item.subtitle}</p>
                      <span>Character sheet</span>
                    </div>
                    <div className="character-field-grid">
                      {item.fields.map((n) => {
                        const field = fields[n];
                        const meta = CHARACTER_FIELD_DETAILS[field.field];
                        const empty = !field.value.trim() || field.disposition === "missing";
                        return (
                          <article
                            key={field.field}
                            className={`character-field ${empty ? "is-missing" : "has-value"}`}
                          >
                            <header>
                              <h2>{meta.label}</h2>
                              <button
                                aria-label={`Edit ${meta.label}`}
                                title={`Edit ${meta.label}`}
                                onClick={() => onEdit(row.id, "character", field.field)}
                              >
                                <Pencil size={14} />
                              </button>
                            </header>
                            {empty ? (
                              <>
                                {field.value.trim() && (
                                  <p className="character-field-value">{field.value}</p>
                                )}
                                <p className="character-field-hint">{meta.hint}</p>
                                <button
                                  className="character-add-field"
                                  onClick={() => onEdit(row.id, "character", field.field)}
                                >
                                  <CircleDashed size={13} />
                                  Add direction or mark N/A
                                </button>
                              </>
                            ) : (
                              <p className="character-field-value">{field.value}</p>
                            )}
                            <footer>
                              <span
                                className={`character-field-status status-${field.disposition}`}
                              >
                                {empty ? (
                                  <CircleDashed size={11} />
                                ) : field.disposition === "not-applicable" ? (
                                  <X size={11} />
                                ) : (
                                  <Check size={11} />
                                )}{" "}
                                {statusLabel(field.disposition)}
                              </span>
                              {field.source && (
                                <span className="character-field-source">{field.source}</span>
                              )}
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                    {item.id === "performance" &&
                      (asset?.canonicalSpec.performanceNotes || legacy?.arc) && (
                        <div className="character-original-direction">
                          <span>Existing source direction</span>
                          {asset?.canonicalSpec.performanceNotes && (
                            <p>{asset.canonicalSpec.performanceNotes}</p>
                          )}
                          {legacy?.arc && (
                            <p>
                              <strong>Character arc</strong> · {legacy.arc}
                            </p>
                          )}
                          <button onClick={() => setDetail("source")}>
                            View source & identity constraints
                            <ArrowUpRight size={13} />
                          </button>
                        </div>
                      )}
                    {item.id === "identity" && visual && (
                      <div className="character-original-direction">
                        <span>
                          Visual identity · {visual.status.toLowerCase().replaceAll("_", " ")}
                        </span>
                        {visual.invariants.length > 0 && <p>{visual.invariants.join("\n")}</p>}
                        <button onClick={() => setDetail("source")}>
                          Expression matrix, posture & drift rules
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                  </Tabs.Content>
                ))}
              </Tabs.Root>
              <footer className="character-dossier-footer">
                <span>
                  <BookOpen size={13} /> Bible-linked direction
                </span>
                <button onClick={() => setDetail("source")}>
                  Sources & identity details
                  <ArrowUpRight size={13} />
                </button>
              </footer>
            </section>
            <aside className="character-state-column">
              <CharacterScenePanel
                key={row.id}
                picture={picture}
                record={row}
                asset={asset}
                onEdit={onEdit}
              />
            </aside>
          </div>
        </>
      )}
      <CabinetModal title="Cast of this picture" open={picker} onOpenChange={setPicker}>
        <div className="character-picker-search">
          <Search size={17} />
          <Input
            aria-label="Find a character"
            placeholder="Search characters or aliases…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="character-cast-grid">
          {filtered.map((character, i) => (
            <button
              key={character.id}
              aria-current={character.id === row?.id ? "true" : undefined}
              onClick={() => choose(character.id)}
            >
              <span className="character-cast-monogram" aria-hidden="true">
                {character.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{character.name}</strong>
                <small>
                  {character.aliases?.length
                    ? character.aliases.join(" · ")
                    : `Character ${rows.indexOf(character) + 1}`}
                </small>
              </span>
              {character.id === row?.id ? <Check size={16} /> : <ArrowUpRight size={15} />}
            </button>
          ))}
          {!filtered.length && <p>No character matches this search.</p>}
        </div>
      </CabinetModal>
      <CabinetModal
        title={
          detail === "source"
            ? `${row?.name ?? "Character"} · source dossier`
            : detail === "history"
              ? "Character revision history"
              : "Character field coverage"
        }
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        {detail === "source" && (
          <div className="character-source-dossier">
            <p className="character-modal-intro">
              Original records and their recorded status. Character direction is saved separately
              with its source and revision.
            </p>
            {asset && (
              <>
                <h3>
                  Canonical identity ·{" "}
                  {asset.canonicalApproved
                    ? "approved specification"
                    : "specification needs review"}
                </h3>
                <RecordDetails value={asset.canonicalSpec} />
                <h3>Aliases & provenance</h3>
                <RecordDetails
                  value={{
                    id: asset.id,
                    aliases: asset.aliases,
                    provenance: asset.provenance,
                    approvedSpecVersionId: asset.approvedSpecVersionId,
                    stale: asset.stale,
                    staleReasons: asset.staleReasons,
                    blockedReasons: asset.blockedReasons,
                  }}
                />
              </>
            )}
            {legacy && (
              <>
                <h3>Character source record</h3>
                <RecordDetails value={legacy} />
              </>
            )}
            {visual && (
              <>
                <h3>Visual identity Bible</h3>
                <RecordDetails value={visual} />
              </>
            )}
            {!asset && !legacy && !visual && <p>No source record is available.</p>}
          </div>
        )}
        {detail === "history" && (
          <div className="character-revision-list">
            {!corrections.length && <p>No character-field corrections recorded yet.</p>}
            {corrections.map((c) => (
              <article key={c.id}>
                <header>
                  <h3>{fieldLabel(c.field)}</h3>
                  <small>
                    {new Date(c.at).toLocaleString()} · revision {c.after.revision}
                  </small>
                </header>
                {c.recordId !== row?.id && <small>Scene participant · {c.recordId}</small>}
                <p>{c.after.value || "Explicitly missing"}</p>
                <small>
                  {statusLabel(c.after.disposition)} · {c.after.source || "Source not recorded"}
                </small>
                {c.before && (
                  <details>
                    <summary>Previous value</summary>
                    <p>{c.before.value || "Missing"}</p>
                    <small>{c.before.source}</small>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
        {detail === "coverage" && (
          <div className="character-coverage-list">
            <p className="character-modal-intro">
              All 17 character field groups are available. Recorded text is not proof of
              completeness or media approval; source-derived values still need review.
            </p>
            {fields.map((f) => (
              <button
                key={f.field}
                onClick={() => {
                  setDetail(null);
                  if (row) onEdit(row.id, "character", f.field);
                }}
              >
                <span>
                  <strong>{fieldLabel(f.field)}</strong>
                  <small>{CHARACTER_FIELD_DETAILS[f.field].hint}</small>
                </span>
                <span className={`character-field-status status-${f.disposition}`}>
                  {statusLabel(f.disposition)}
                  <Pencil size={12} />
                </span>
              </button>
            ))}
          </div>
        )}
      </CabinetModal>
      {editing && (
        <CharacterFieldEditor
          key={`${editing.recordId}:${editing.field}`}
          picture={picture}
          {...editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RecordDetails({ value }: { value: unknown }) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return <span className="character-source-empty">Not recorded</span>;
  if (Array.isArray(value))
    return (
      <div className="character-source-array">
        {value.map((v, i) => (
          <RecordDetails key={i} value={v} />
        ))}
      </div>
    );
  if (typeof value !== "object") return <p>{String(value)}</p>;
  return (
    <dl className="character-source-fields">
      {Object.entries(value).map(([key, v]) => (
        <div key={key}>
          <dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dt>
          <dd>
            <RecordDetails value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CharacterFieldEditor({
  picture,
  recordId,
  kind,
  field,
  onClose,
}: {
  picture: Picture;
  recordId: string;
  kind: BibleKind;
  field: string;
  onClose: () => void;
}) {
  const existing = picture.movieBible?.records[recordId]?.fields[field];
  const inherited =
    kind === "character"
      ? characterFieldView(picture, recordId, field)
      : kind === "participant"
        ? participantFieldView(picture, recordId, field)
        : undefined;
  const initial: BibleFieldEdit = {
    recordId,
    kind,
    field,
    value: existing?.value ?? inherited?.value ?? "",
    source: existing?.source ?? inherited?.source ?? "",
    disposition: existing?.disposition ?? "authored",
    baseRevision: existing?.revision ?? 0,
  };
  const [draft, setDraft] = useWorkspaceDraft<BibleFieldEdit | null>(
    `character-field-draft:${recordId}:${field}`,
    null,
  );
  const edit = draft ?? initial;
  const [error, setError] = useState("");
  const change = (patch: Partial<BibleFieldEdit>) => {
    setDraft({ ...edit, ...patch });
    setError("");
  };
  const save = () => {
    try {
      const store = useStudio.getState();
      const latest = store.pictures.find((p) => p.id === picture.id);
      if (!latest || store.activeId !== picture.id)
        throw new Error("The active picture has changed.");
      const updated = applyCharacterFieldEdit(latest, edit);
      store.replaceActive({
        ...updated,
        editorDrafts: {
          ...updated.editorDrafts,
          [`character-field-draft:${recordId}:${field}`]: null,
        },
      });
      toast.success("Direction saved to the Bible.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this direction.");
    }
  };
  return (
    <CabinetModal title={fieldLabel(field)} open onOpenChange={(open) => !open && onClose()}>
      <div className="character-edit-form">
        {CHARACTER_FIELD_DETAILS[field] && (
          <p className="character-modal-intro">{CHARACTER_FIELD_DETAILS[field].hint}</p>
        )}
        <label>
          Disposition
          <select
            aria-label="Field disposition"
            value={edit.disposition}
            onChange={(e) =>
              change({ disposition: e.target.value as BibleFieldEdit["disposition"] })
            }
          >
            <option value="authored">Authored direction</option>
            <option value="not-applicable">Not applicable · role reason required</option>
            <option value="missing">Missing / unresolved</option>
          </select>
        </label>
        <label>
          {edit.disposition === "not-applicable" ? "Role-specific reason" : "Direction"}
          <Textarea
            aria-label={
              edit.disposition === "not-applicable" ? "Role-specific reason" : "Direction"
            }
            rows={8}
            value={edit.value}
            onChange={(e) => change({ value: e.target.value })}
          />
        </label>
        <label>
          Source or direction note
          <Input
            aria-label="Source or direction note"
            placeholder="Source record, passage, or your authored direction…"
            value={edit.source}
            onChange={(e) => change({ source: e.target.value })}
          />
        </label>
        <p className="character-edit-note">
          Closing keeps this draft. Saving records a correction; original source and approved media
          remain independently reviewable.
        </p>
        {error && (
          <p role="alert" className="character-edit-error">
            {error}
          </p>
        )}
        <footer>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(null);
              setError("");
            }}
          >
            Reset to saved value
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Keep draft & close
          </Button>
          <Button onClick={save}>
            <Check size={15} />
            Save direction
          </Button>
        </footer>
      </div>
    </CabinetModal>
  );
}
