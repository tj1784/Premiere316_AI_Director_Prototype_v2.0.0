import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  History,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  BIBLE_FIELDS,
  bibleSourceReading,
  editBibleField,
  movieBibleIndex,
  pictureBibleFieldView,
  resolveBibleRecord,
  bibleSearchText,
  type BibleIndexRow,
  type BibleKind,
} from "@/lib/studio/movie-bible";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import type { Picture, StageId } from "@/lib/studio/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { openAssetIterations, openScreenplayScene } from "./workspace-links";
import { CharacterVoiceSamples } from "./character-voice-samples";
import { RenderContextEditor } from "./render-context-editor";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { BibleLibrarySearch } from "./bible-library-search";
import { AssetImagePreview } from "./asset-image-preview";
import { characterFieldView } from "@/lib/studio/character-dossier";
import { participantFieldView } from "./character-scene-panel";
import "./movie-bible-workbench.css";

type SourcePassage = { label: string; text: string };
type DetailView =
  "direction" | "tools" | "source" | "history" | "media" | "render" | "settings" | "library";

function bibleImage(picture: Picture, id: string) {
  if (id === picture.id) {
    return picture.thumbnailUrl
      ? { previewUri: picture.thumbnailUrl, mediaUri: picture.thumbnailUrl }
      : null;
  }
  const asset = picture.production?.assets.find((item) => item.id === id && !item.tombstone);
  const iteration =
    asset?.iterations.find((item) => item.id === asset.approvedIterationId) ??
    [...(asset?.iterations ?? [])]
      .reverse()
      .find((item) => item.status !== "REJECTED" && item.mediaUri);
  const reference = asset?.references.find((item) => item.preferred) ?? asset?.references[0];
  const previewUri = iteration?.previewUri ?? reference?.previewUri;
  const mediaUri = iteration?.mediaUri ?? reference?.uri;
  return previewUri || mediaUri ? { previewUri, mediaUri } : null;
}

/** Read the existing source; this view never creates another copy of the record. */
function sourcePassages(
  picture: Picture,
  row: BibleIndexRow,
  sourceReading: ReturnType<typeof bibleSourceReading>,
): SourcePassage[] {
  // Source documents must keep every supplied paragraph and newline intact.
  if (sourceReading?.text.length)
    return [{ label: sourceReading.label, text: sourceReading.text }];
  const passages: SourcePassage[] = [];
  const shownParagraphs = new Set<string>();
  const add = (label: string, text?: string) => {
    if (!text?.trim()) return;
    // Presentation only: exact repeated paragraphs share one reading position.
    // The original fields and their provenance remain unchanged in source details.
    const uniqueParagraphs = text.split(/\r?\n[ \t]*\r?\n/).filter((paragraph) => {
      const key = paragraph.trim();
      if (!key || shownParagraphs.has(key)) return false;
      shownParagraphs.add(key);
      return true;
    });
    if (uniqueParagraphs.length) passages.push({ label, text: uniqueParagraphs.join("\n\n") });
  };
  const asset = picture.production?.assets.find((item) => item.id === row.id && !item.tombstone);
  if (asset) {
    add("Identity", asset.canonicalSpec.identity);
    add("Appearance", asset.canonicalSpec.visualDescription);
    add("Performance", asset.canonicalSpec.performanceNotes);
    add("Continuity", asset.canonicalSpec.continuityLocks.join("\n"));
  } else if (row.kind === "picture") {
    // These are distinct authored inputs. A premise or dialogue style must not
    // masquerade as an unanswered moral question or language policy.
    const intake = picture.intake;
    for (const [label, value] of [
      ["Concept", intake.concept], ["Premise", intake.premise],
      ["Logline", intake.logline], ["Story notes", intake.storyNotes],
      ["Treatment", intake.treatment], ["Existing screenplay", intake.existingScreenplay],
      ["Source material", intake.sourceMaterial], ["Adaptation instructions", intake.adaptationInstructions],
      ["Material to preserve", intake.materialToPreserve], ["Permitted dramatization", intake.materialMayDramatize],
      ["Source passages", intake.sourcePassages], ["Supplied source text", intake.suppliedSourceText],
      ["Fidelity requirements", intake.fidelityRequirements], ["Historical period", intake.historicalPeriod],
      ["Cultural and social world", intake.culturalSocialWorld], ["Adaptation boundaries", intake.adaptationBoundaries],
      ["Production style", intake.productionStyle], ["Director notes", intake.directorNotes],
      ["Dialogue style", intake.dialogueStyle], ["Story constraints", intake.storyConstraints],
      ["Must include", intake.mustInclude], ["Must avoid", intake.mustAvoid],
      ["Moral question", intake.moralQuestion], ["Language", intake.language],
      ["Continuity policy", intake.continuityPolicy], ["Voice policy", intake.voicePolicy],
      ["Score strategy", intake.scoreStrategy], ["Delivery format", intake.deliveryFormat],
      ["Delivery codec", intake.deliveryCodec],
    ] as const) {
      if (value?.trim()) passages.push({ label, text: value });
    }
  } else if (row.kind === "character") {
    const character = picture.characters.find((item) => item.id === row.id);
    add("Role", character?.role);
    add("Age", character?.age);
    add("Appearance", character?.look);
    add("Character arc", character?.arc);
  } else if (row.kind === "scene") {
    const scene = picture.scenes.find((item) => item.id === row.id);
    add("Scene", scene?.summary);
    add("Emotional beat", scene?.emotionalBeat);
  } else if (row.kind === "shot") {
    const shot = picture.shots.find((item) => item.id === row.id);
    add("Action", shot?.description);
    add("Camera", [shot?.camera, shot?.lens, shot?.cameraMove].filter(Boolean).join(" · "));
    add("Performance", [shot?.emotion, shot?.expression].filter(Boolean).join("\n"));
    add("Video prompt", shot?.i2vPrompt);
  } else if (row.kind === "cue") {
    const cue = picture.cues.find((item) => item.id === row.id);
    add("Musical direction", cue?.minimaxPrompt);
    add("Mood", cue?.mood);
    add("Instrumentation", cue?.instruments);
    add("Sound design", cue?.sfx);
  } else if (["location", "prop", "wardrobe"].includes(row.kind)) {
    const source = [...picture.locations, ...picture.props, ...picture.wardrobe].find(
      (item) => item.id === row.id,
    );
    add("Description", source?.description);
    add("Lighting", source?.lighting);
  }
  // Source documents and exact text remain readable, without exposing payload internals.
  if (!passages.length) {
    const source = resolveBibleRecord(picture, row.id);
    if (source && typeof source === "object") {
      const content = source as Record<string, unknown>;
      const readableFields = {
        summary: "Summary",
        description: "Description",
        text: "Text",
        content: "Content",
        fountain: "Screenplay",
        prompt: "Prompt",
        promptText: "Prompt",
        body: "Content",
        instruction: "Instruction",
        sourceText: "Source text",
        value: "Direction",
      };
      for (const [key, label] of Object.entries(readableFields)) {
        if (typeof content[key] === "string") add(label, content[key]);
      }
    }
  }
  return passages;
}

export function MovieBibleEditor({
  kinds,
  title = "Movie Script Bible",
}: { kinds?: BibleKind[]; title?: string } = {}) {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [fieldPage, setFieldPage] = useState(0);
  const [detail, setDetail] = useState<DetailView>("direction");
  const [category, setCategory] = useWorkspaceDraft(`bible-category:${title}`, "all");
  const [selected, setSelected] = useWorkspaceDraft(`bible-record:${title}`, "");
  const [editing, setEditing] = useWorkspaceDraft<string | null>(`bible-edit-field:${title}`, null);
  const [value, setValue] = useWorkspaceDraft(`bible-edit-value:${title}`, "");
  const [reason, setReason] = useWorkspaceDraft(`bible-edit-source:${title}`, "");
  const [na, setNa] = useWorkspaceDraft(`bible-edit-na:${title}`, false);
  const workbenchRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!editing) return;
    workbenchRef.current?.querySelector<HTMLTextAreaElement>(".bible-inline-editor textarea")?.focus({ preventScroll: true });
  }, [editing, selected]);
  if (!picture) return null;

  const allRows = movieBibleIndex(picture);
  const availableRows = allRows.filter(
    (row) => (!kinds || kinds.includes(row.kind as BibleKind)) && row.status !== "deleted",
  );
  const row = availableRows.find((item) => item.id === selected) ?? availableRows[0];
  if (!row)
    return (
      <div className="bible-desk-empty">
        <BookOpen size={24} />
        <p>No records yet.</p>
        <p>Prepare the screenplay inventory to begin the linked Bible.</p>
      </div>
    );

  const fields: readonly string[] = BIBLE_FIELDS[row.kind as BibleKind] ?? [];
  const record = picture.movieBible?.records[row.id];
  const sourceReading = bibleSourceReading(picture, row);
  const fieldViews = new Map(
    fields.map(
      (field) =>
        [
          field,
          record?.fields[field] ??
            (row.kind === "character"
              ? characterFieldView(picture, row.id, field)
              : row.kind === "participant"
                ? participantFieldView(picture, row.id, field)
                : row.kind === "picture"
                  ? pictureBibleFieldView(picture, field)
                  : undefined),
        ] as const,
    ),
  );
  const completedFields = fields.filter((field) => {
    const view = fieldViews.get(field);
    return view?.disposition !== "missing" && Boolean(view?.value.trim());
  });
  const passages = sourcePassages(picture, row, sourceReading).filter(
    (passage) => !completedFields.some((field) => fieldViews.get(field)?.value === passage.text),
  );
  const matching = availableRows.filter(
    (item) =>
      (category === "all" || item.kind === category) &&
      bibleSearchText(item, picture).toLowerCase().includes(query.toLowerCase()),
  );
  const asset = picture.production?.assets.find(
    (item) => item.id === row.id || (row.kind === "participant" && item.id === row.parentId),
  );
  const media =
    asset?.iterations.find((item) => item.id === asset.approvedIterationId) ??
    [...(asset?.iterations ?? [])].reverse().find((item) => item.mediaUri);
  const mediaUri =
    media?.previewUri ??
    media?.mediaUri ??
    asset?.references.find((item) => item.preferred)?.previewUri ??
    asset?.references.find((item) => item.preferred)?.uri;
  const corrections = (picture.movieBible?.corrections ?? [])
    .filter((item) => item.recordId === row.id)
    .slice()
    .reverse();
  const choose = (id: string) => {
    const target = allRows.find((item) => item.id === id && item.status !== "deleted");
    if (!target) {
      toast.error("This source record is no longer available.");
      return;
    }
    if (availableRows.some((item) => item.id === id)) setSelected(id);
    else {
      patch({ workspacePanel: target.kind === "run" ? "run" : null });
      if (target.kind !== "run")
        useStudio.getState().openAdvancedDepartment(target.locator as StageId);
      if (target.kind === "shot") useStudio.getState().selectShot(target.id);
    }
    setEditing(null);
    setSelectedField(null);
    setFieldPage(0);
    setPickerOpen(false);
    setDetail("direction");
  };
  const edit = (field: string) => {
    setDetail("direction");
    setSelectedField(field);
    setEditing(field);
    const current = fieldViews.get(field);
    setValue(current?.value ?? "");
    setReason(current?.source || "User direction");
    setNa(current?.disposition === "not-applicable");
  };
  const saveDirection = () => {
    if (!editing) return;
    try {
      patch({
        movieBible: editBibleField(
          picture,
          row.id,
          row.kind as BibleKind,
          editing,
          value,
          reason,
          na ? "not-applicable" : "authored",
        ),
      });
      setEditing(null);
    } catch (error) {
      toast.error(String(error));
    }
  };
  const openWorkspace = () => {
    patch({ workspacePanel: row.kind === "run" ? "run" : null });
    if (row.kind !== "run") useStudio.getState().openAdvancedDepartment(row.locator as StageId);
    if (row.kind === "shot") useStudio.getState().selectShot(row.id);
  };
  const detailTitle = {
    direction: "Creative direction",
    tools: "Record options",
    source: "Source & relationships",
    history: "Correction history",
    media: "Media & linked scenes",
    render: "Render direction",
    settings: "Picture settings",
    library: "Search all pictures",
  };
  const kindRows = availableRows.filter((item) => item.kind === row.kind);
  const selectedIndex = kindRows.findIndex((item) => item.id === row.id);
  const railStart = Math.max(0, Math.min(selectedIndex - 3, kindRows.length - 7));
  const railRows = kindRows.slice(railStart, railStart + 7);
  const topicRail = kindRows.length === 1 && fields.length > 0;
  const fieldsPerPage = 7;
  const fieldPageCount = Math.max(1, Math.ceil(fields.length / fieldsPerPage));
  const visibleFields = fields.slice(fieldPage * fieldsPerPage, (fieldPage + 1) * fieldsPerPage);
  const focusedField = selectedField && fields.includes(selectedField) ? selectedField : null;
  const focusedIndex = focusedField ? fields.indexOf(focusedField) : -1;
  const focusedView = focusedField ? fieldViews.get(focusedField) : undefined;
  const image = bibleImage(picture, row.id);
  // The imported film thumbnail is a labeled contact sheet. A bundled landscape
  // shows the setting without recycling a character's scene portrait.
  const heroImage =
    row.kind === "picture" && picture.id === "pic_prodigal_son_20260909"
      ? {
          previewUri: "/pictures/prodigal-son/previews/PS-LOC-TERRACE.webp",
          mediaUri: "/pictures/prodigal-son/previews/PS-LOC-TERRACE.webp",
        }
      : image;

  return (
    <section ref={workbenchRef} className="bible-desk bible-workbench" aria-label={title}>
      <header className="bible-desk-heading">
        <button
          className="bible-record-title"
          onClick={() => {
            setPickerOpen((open) => !open);
            setDetail("direction");
          }}
          aria-label={`Choose Bible record. Current: ${row.name}`}
          aria-expanded={pickerOpen}
        >
          <span>{row.kind === "picture" ? "Film direction" : row.name}</span>
          <ChevronDown size={18} />
        </button>
        <div className="bible-desk-actions">
          {(asset || mediaUri || row.kind === "character") && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Media and linked scenes"
              title="Media and linked scenes"
              onClick={() => {
                setPickerOpen(false);
                setDetail(detail === "media" ? "direction" : "media");
              }}
            >
              <Link2 />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bible record options"
            title="Record options"
            onClick={() => {
              setPickerOpen(false);
              setDetail(detail === "tools" ? "direction" : "tools");
            }}
          >
            <MoreHorizontal />
          </Button>
        </div>
      </header>

      <div className="bible-workbench-body" data-picker-open={pickerOpen} data-detail-open={true}>
        {heroImage && (
          <div className="bible-visual-backdrop" aria-hidden="true">
            <AssetImagePreview
              key={`${row.id}:${heroImage.previewUri ?? heroImage.mediaUri}`}
              previewUri={heroImage.previewUri}
              mediaUri={heroImage.mediaUri}
              alt=""
              className="bible-visual-image"
              compact
            />
          </div>
        )}
        {pickerOpen && (
          <aside
            className="bible-workbench-browser"
            id="bible-record-browser"
            aria-label="Find a Bible record"
          >
            <header className="bible-context-heading">
              <div>
                <small>BIBLE INDEX</small>
                <h2>Find a Bible record</h2>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close record browser"
                onClick={() => setPickerOpen(false)}
              >
                <X size={16} />
              </Button>
            </header>
            <div className="bible-picker-controls">
              <Input
                aria-label="Search Bible records"
                placeholder="Character, scene, source…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="Bible record category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="all">All records</option>
                {[...new Set(availableRows.map((item) => item.kind))].map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="bible-record-list">
              {matching.map((item) => (
                <button
                  key={`${item.kind}:${item.id}`}
                  className="bible-record-choice"
                  aria-pressed={item.id === row.id}
                  onClick={() => choose(item.id)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    {category === "all" && <small>{item.kind.replaceAll("-", " ")}</small>}
                  </span>
                  {item.id === row.id && <Check size={16} />}
                </button>
              ))}
              {!matching.length && <p className="cabinet-empty">No matching records.</p>}
            </div>
          </aside>
        )}

        <div
          className="bible-reading-surface bible-record-board"
          tabIndex={0}
          aria-label={`${row.name} direction`}
        >
          <div className="bible-hero-copy">
            <span>{row.kind === "picture" ? "Production Bible" : row.kind.replaceAll("-", " ")}</span>
            <h1>{row.name}</h1>
            {row.kind === "picture" && picture.logline && <p>{picture.logline}</p>}
            <button onClick={() => setDetail("source")}>
              Read source &amp; relationships <ArrowUpRight size={16} />
            </button>
          </div>
        </div>

        <aside className="bible-workbench-context" aria-label={detailTitle[detail]}>
          <header className="bible-context-heading">
            <div>
              <small>{row.kind.replaceAll("-", " ")} · revision {record?.revision ?? row.revision}</small>
              <h2>{detailTitle[detail]}</h2>
            </div>
            <span className="bible-field-count">
              {completedFields.length} of {fields.length} with content
            </span>
          </header>
          <nav className="bible-inspector-tabs" aria-label="Bible record views">
            {(
              [
                ["direction", "Direction"],
                ["source", "Source text"],
                ["history", "History"],
                ["tools", "More"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-current={detail === key ? "page" : undefined}
                onClick={() => setDetail(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="bible-context-content" data-view={detail}>
            {detail === "direction" && (
              <div className="bible-direction-content">
                {focusedField ? (
                  <section className="bible-field-focused" aria-label={focusedField}>
                    <div className="bible-field-navigation">
                      <button onClick={() => { setSelectedField(null); setEditing(null); }}>
                        <ArrowLeft size={15} /> All fields
                      </button>
                      <span>{String(focusedIndex + 1).padStart(2, "0")} / {String(fields.length).padStart(2, "0")}</span>
                    </div>
                    <div className="bible-focused-heading">
                      <div>
                        <small>CREATIVE DIRECTION</small>
                        <h3>{focusedField}</h3>
                        <span>{focusedView?.source || (focusedView?.disposition === "missing" ? "Open field" : "Bible direction")}</span>
                      </div>
                      {editing !== focusedField && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${focusedField}`} title={`Edit ${focusedField}`} onClick={() => edit(focusedField)}>
                          <Pencil size={16} />
                        </Button>
                      )}
                    </div>
                    {editing === focusedField ? (
                      <div className="bible-inline-editor" aria-label={`Edit ${focusedField}`}>
                        <Textarea aria-label={focusedField} rows={7} value={value} onChange={(event) => setValue(event.target.value)} />
                        <label>
                          Source or correction reason
                          <Input aria-label="Source or correction reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                        </label>
                        <label className="bible-inline-check">
                          <input type="checkbox" checked={na} onChange={(event) => setNa(event.target.checked)} />
                          Not applicable (explain above)
                        </label>
                        <div className="bible-inline-actions">
                          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button onClick={saveDirection}>Save direction</Button>
                        </div>
                      </div>
                    ) : focusedView?.value.trim() ? (
                      <p className="bible-field-value">{focusedView.value}</p>
                    ) : (
                      <button className="bible-empty-direction" onClick={() => edit(focusedField)}>
                        <Plus size={18} /> Add {focusedField.toLowerCase()}
                      </button>
                    )}
                    <div className="bible-field-pager">
                      <button disabled={focusedIndex === 0} onClick={() => { setSelectedField(fields[focusedIndex - 1]); setEditing(null); }}>
                        <ArrowLeft size={15} /> Previous field
                      </button>
                      <button disabled={focusedIndex === fields.length - 1} onClick={() => { setSelectedField(fields[focusedIndex + 1]); setEditing(null); }}>
                        Next field <ArrowRight size={15} />
                      </button>
                    </div>
                  </section>
                ) : (
                  <div className="bible-field-overview">
                    <div className="bible-overview-caption">
                      <span>{row.kind === "picture" ? "Film direction from the imported source and Bible edits" : "Record direction and source notes"}</span>
                      <span>{fields.length} topics</span>
                    </div>
                    <div className="bible-field-board">
                      {visibleFields.map((field, index) => {
                        const current = fieldViews.get(field);
                        return (
                          <div className="bible-field-row" key={field}>
                            <button className="bible-field-choice" onClick={() => setSelectedField(field)}>
                              <span className="bible-field-number">{String(fieldPage * fieldsPerPage + index + 1).padStart(2, "0")}</span>
                              <span className="bible-field-summary">
                                <strong>{field}</strong>
                                <span>{current?.value.trim() ? "Open to read complete direction" : "Open to add direction"}</span>
                              </span>
                              <span className="bible-field-origin">{current?.disposition === "source" ? "Source" : current?.disposition === "missing" || !current?.value.trim() ? "Open" : "Bible edit"}</span>
                            </button>
                            <button className="bible-field-edit" aria-label={`Edit ${field}`} title={`Edit ${field}`} onClick={() => edit(field)}><Pencil size={14} /></button>
                          </div>
                        );
                      })}
                    </div>
                    {fieldPageCount > 1 && (
                      <div className="bible-field-pager">
                        <button disabled={fieldPage === 0} onClick={() => setFieldPage(fieldPage - 1)}><ArrowLeft size={15} /> Previous</button>
                        <span>{fieldPage + 1} / {fieldPageCount}</span>
                        <button disabled={fieldPage === fieldPageCount - 1} onClick={() => setFieldPage(fieldPage + 1)}>Next <ArrowRight size={15} /></button>
                      </div>
                    )}
                  </div>
                )}
                {!passages.length && !completedFields.length && !fields.length && (
                  <div className="bible-desk-empty">
                    <BookOpen size={24} />
                    <p>This record is managed in its linked workspace.</p>
                    <Button variant="secondary" onClick={openWorkspace}>
                      Open record <ArrowUpRight />
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!["direction", "source", "history", "media", "tools"].includes(detail) && (
              <button className="bible-context-back" onClick={() => setDetail("tools")}>
                <ChevronDown size={15} /> All record options
              </button>
            )}
            {detail === "tools" && (
              <div className="bible-tool-list">
                <Button variant="ghost" onClick={() => setDetail("direction")}>
                  <BookOpen /> Creative direction
                </Button>
                <Button variant="ghost" onClick={openWorkspace}>
                  <ArrowUpRight /> Open original workspace
                </Button>
                <Button variant="ghost" onClick={() => setDetail("source")}>
                  <FileText /> Source & relationships
                </Button>
                <Button variant="ghost" onClick={() => setDetail("history")}>
                  <History /> Correction history
                </Button>
                {!kinds && (
                  <Button variant="ghost" onClick={() => setDetail("render")}>
                    <Pencil /> Render direction
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDetail("library")}>
                  <Search /> Search all pictures
                </Button>
                <Button variant="ghost" onClick={() => setDetail("settings")}>
                  <Settings2 /> Picture settings
                </Button>
              </div>
            )}
            {detail === "source" && (
              <div className="grid gap-5">
                {!!passages.length && (
                  <div className="bible-source-passages">
                    {passages.map((passage) => (
                      <section className="bible-passage" key={passage.label}>
                        <h3>{passage.label}</h3>
                        <p>{passage.text}</p>
                      </section>
                    ))}
                  </div>
                )}
                <dl className="bible-source-meta">
                  <dt>Record</dt>
                  <dd>{row.id}</dd>
                  {row.kind === "source" && (
                    <>
                      <dt>Source locator</dt>
                      <dd>{sourceReading?.locator || "Not recorded"}</dd>
                      {row.uri && (
                        <>
                          <dt>Original file</dt>
                          <dd>
                            <a href={row.uri} download={sourceReading?.locator || undefined} className="underline underline-offset-2">
                              Open {sourceReading?.locator || row.name}
                            </a>
                          </dd>
                        </>
                      )}
                      {sourceReading?.importedAt !== undefined && (
                        <>
                          <dt>Imported</dt>
                          <dd>{new Date(sourceReading.importedAt).toLocaleString()}</dd>
                        </>
                      )}
                    </>
                  )}
                  <dt>Revision</dt>
                  <dd>{record?.revision ?? row.revision}</dd>
                  <dt>Status</dt>
                  <dd>{row.status}</dd>
                </dl>
                <div className="bible-linked-records">
                  {row.parentId && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCategory("all");
                        choose(row.parentId!);
                      }}
                    >
                      Parent:{" "}
                      {allRows.find((item) => item.id === row.parentId)?.name ?? row.parentId}
                    </Button>
                  )}
                  {row.relations?.map((relation) => (
                    <Button
                      key={`${relation.type}:${relation.targetId}`}
                      variant="ghost"
                      onClick={() => {
                        setCategory("all");
                        choose(relation.targetId);
                      }}
                    >
                      {relation.type}:{" "}
                      {allRows.find((item) => item.id === relation.targetId)?.name ??
                        relation.targetId}
                    </Button>
                  ))}
                </div>
                {!!completedFields.length && (
                  <div className="bible-field-sources">
                    {completedFields.map((field) => (
                      <p key={field}>
                        <strong>{field}</strong>
                        <span>{fieldViews.get(field)?.source || "Source not recorded"}</span>
                      </p>
                    ))}
                  </div>
                )}
                <details>
                  <summary>Technical source data</summary>
                  <pre className="cabinet-source">
                    {JSON.stringify(resolveBibleRecord(picture, row.id), null, 2)}
                  </pre>
                </details>
              </div>
            )}
            {detail === "history" && (
              <div>
                {corrections.map((correction) => (
                  <article key={correction.id} className="bible-correction">
                    <h3>{correction.field}</h3>
                    <small>
                      Revision {correction.after.revision} ·{" "}
                      {new Date(correction.at).toLocaleString()}
                    </small>
                    <dl>
                      <dt>Before</dt>
                      <dd>{correction.before?.value || "Not authored"}</dd>
                      <dt>After</dt>
                      <dd>{correction.after.value || "Not authored"}</dd>
                    </dl>
                    <p>{correction.after.source}</p>
                  </article>
                ))}
                {!corrections.length && <p className="cabinet-empty">No corrections recorded.</p>}
              </div>
            )}
            {detail === "media" && (
              <div className="bible-media-detail">
                {image && (
                  <AssetImagePreview
                    key={`${row.id}:${image.previewUri ?? image.mediaUri}`}
                    previewUri={image.previewUri}
                    mediaUri={image.mediaUri}
                    alt={row.name}
                  />
                )}
                {asset && (
                  <Button
                    variant="secondary"
                    onClick={() => openAssetIterations(picture.id, asset.id)}
                  >
                    Open asset iterations <ArrowUpRight />
                  </Button>
                )}
                {row.kind === "character" && (
                  <CharacterVoiceSamples pictureId={picture.id} characterId={row.id} />
                )}
                {!!asset?.requiredSceneIds.length && (
                  <div className="bible-linked-records">
                    <h3>Linked scenes</h3>
                    {asset.requiredSceneIds.map((id) => (
                      <Button
                        key={id}
                        variant="ghost"
                        onClick={() => openScreenplayScene(picture, id)}
                      >
                        {picture.production?.scenes.find((scene) => scene.id === id)?.slugline ??
                          id}
                        <ArrowUpRight />
                      </Button>
                    ))}
                  </div>
                )}
                {!mediaUri && !asset && row.kind !== "character" && (
                  <p className="cabinet-empty">No media linked to this record yet.</p>
                )}
              </div>
            )}
            {detail === "render" && <RenderContextEditor />}
            {detail === "library" && <BibleLibrarySearch />}
            {detail === "settings" && (
              <label className="grid gap-3">
                Creative preset
                <select
                  className="rounded border border-border bg-inset p-3"
                  value={picture.creativePreset ?? "none"}
                  onChange={(event) =>
                    patch({ creativePreset: event.target.value as "none" | "harrowing-v3" })
                  }
                >
                  <option value="none">General film Bible</option>
                  <option value="harrowing-v3">Harrowing of Hell V3</option>
                </select>
                <span className="text-sm text-muted">
                  Applies to future authoring. Approved work stays protected.
                </span>
              </label>
            )}
          </div>
        </aside>
      </div>
      <div className="bible-filmstrip" aria-label="Bible records">
        <span className="bible-filmstrip-label">
          {topicRail ? "Bible topics" : row.kind.replaceAll("-", " ")}
          <small>
            {topicRail ? `${fields.length} fields` : `${selectedIndex + 1} / ${kindRows.length}`}
          </small>
        </span>
        <div className="bible-filmstrip-track">
          {topicRail ? fields.map((field, index) => (
            <button
              key={field}
              className="bible-filmstrip-topic"
              aria-current={detail === "direction" && focusedField === field ? "true" : undefined}
              onClick={() => { setDetail("direction"); setSelectedField(field); setEditing(null); }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{field}</strong>
              <small>{fieldViews.get(field)?.disposition === "source" ? "Imported source" : fieldViews.get(field)?.value.trim() ? "Bible direction" : "Open field"}</small>
            </button>
          )) : railRows.map((item) => {
            const thumbnail = bibleImage(picture, item.id);
            return (
              <button
                key={item.id}
                className="bible-filmstrip-item"
                aria-current={item.id === row.id ? "true" : undefined}
                onClick={() => choose(item.id)}
              >
                <span className="bible-filmstrip-thumb">
                  {thumbnail && (
                    <AssetImagePreview
                      key={`${item.id}:${thumbnail.previewUri ?? thumbnail.mediaUri}`}
                      previewUri={thumbnail.previewUri}
                      mediaUri={thumbnail.mediaUri}
                      alt=""
                      compact
                    />
                  )}
                </span>
                <span className="bible-filmstrip-name">{item.name}</span>
              </button>
            );
          })}
        </div>
        <button className="bible-filmstrip-all" onClick={() => setPickerOpen((open) => !open)}>
          <Search size={16} /> All records
        </button>
      </div>
    </section>
  );
}
