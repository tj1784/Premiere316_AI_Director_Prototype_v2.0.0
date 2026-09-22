import { useId, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Clapperboard,
  LockKeyhole,
  Pencil,
  ScanLine,
} from "lucide-react";
import type { Picture } from "@/lib/studio/types";
import type { ProductionAsset } from "@/lib/production/types";
import type { PerformanceDirection } from "@/lib/performance/types";
import type { ShotContinuity } from "@/lib/studio/shot-continuity";
import {
  BIBLE_FIELDS,
  type BibleField,
  type BibleIndexRow,
  type BibleKind,
} from "@/lib/studio/movie-bible";
import { useStudio } from "@/lib/studio/store";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { openScreenplayScene } from "./workspace-links";
import { CabinetModal } from "./cabinet";
import { ShotContinuityEditor } from "./shot-continuity-editor";
import "./character-scene-panel.css";

type SceneLink = {
  id: string;
  title: string;
  summary: string;
  sources: string[];
  available: boolean;
};
const stateTabs = ["Incoming", "Action", "Outgoing", "Continuity"] as const;
type StateTab = (typeof stateTabs)[number];
const fieldGroups: Record<Exclude<StateTab, "Continuity">, readonly number[]> = {
  Incoming: [0, 5, 7],
  Action: [1, 2, 3, 4, 9, 10],
  Outgoing: [6, 8],
};
const fieldHints: Record<string, string> = {
  "Incoming situation / known facts":
    "What has happened; what this person knows, suspects or misunderstands.",
  "Immediate objective": "A specific task for this participant, including a silent witness.",
  "Partner / obstacle": "Who receives the action and what prevents the objective.",
  "Concealed versus displayed emotion":
    "Keep felt intensity, visible behavior and vocal loudness distinct.",
  "Permitted action / speech / sound":
    "Exact authorized words, physical action and separately allowed vocal sounds.",
  "Incoming physical state": "Fatigue, strength, injury, tears, dirt, costume and held objects.",
  "Outgoing physical state":
    "Track each physical change; emotional release does not imply physical recovery.",
  "Position / support / contact":
    "Location, attention target, gaze, support limb, contact and weight transfer.",
  "Trigger / control / response / residue":
    "Cause, attempted control, visible response, partner effect and earned recovery.",
};

/** Discovery only. Names and shared scene text never establish character membership. */
export function characterSceneLinks(
  picture: Picture,
  characterId: string,
  asset?: ProductionAsset,
): SceneLink[] {
  const linked = new Map<string, Set<string>>();
  const add = (id: string, source: string) => {
    if (!id) return;
    const sources = linked.get(id) ?? new Set<string>();
    sources.add(source);
    linked.set(id, sources);
  };
  asset?.requiredSceneIds.forEach((id) => add(id, `Asset ${asset.id}`));
  asset?.variants.forEach((variant) =>
    variant.requiredSceneIds.forEach((id) => add(id, `Variant ${variant.id}`)),
  );
  picture.visualDevelopment?.characterBibles
    .filter((bible) => bible.characterId === characterId)
    .forEach((bible) => {
      bible.sceneIds.forEach((id) => add(id, `Character Bible ${bible.id}`));
    });
  picture.performance?.beats.forEach((beat) => {
    if (
      beat.dependencies.requiredCharacters.includes(characterId) ||
      picture.performance?.performance[beat.id]?.[characterId]
    ) {
      add(beat.sceneId, `Beat ${beat.id}`);
    }
  });
  picture.performance?.shots.forEach((shot) => {
    if (
      shot.subject.characters.includes(characterId) ||
      shot.subject.approvedReferences?.some((ref) => ref.characterId === characterId)
    ) {
      add(shot.sceneId, `Shot ${shot.shotId}`);
    }
  });
  Object.values(picture.shotContinuity ?? {}).forEach((state) => {
    if (!state.participants.some((participant) => participant.characterId === characterId)) return;
    const shot = picture.shots.find((item) => item.id === state.shotId);
    if (shot) add(shot.sceneId, `Continuity ${state.id}`);
  });
  const scenes = new Map([
    ...picture.scenes.map((scene) => [scene.id, scene] as const),
    ...(picture.performance?.scenes ?? []).map((scene) => [scene.id, scene] as const),
    ...(picture.production?.scenes ?? []).map((scene) => [scene.id, scene] as const),
  ]);
  return Array.from(linked, ([id, sources]) => {
    const scene = scenes.get(id);
    return {
      id,
      title: scene?.slugline ?? id,
      summary: scene?.summary ?? "",
      sources: [...sources],
      available: Boolean(scene),
    };
  });
}

function readableKey(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

/** Structured source records stay readable and complete, including zero and false values. */
function SourceRecord({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="character-scene-muted">Not recorded</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="character-scene-muted">None recorded</span>;
    return (
      <ul className="character-scene-source-list">
        {value.map((item, index) => (
          <li key={index}>
            <SourceRecord value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="character-scene-source-record">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{readableKey(key)}</dt>
          <dd>
            <SourceRecord value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function directionSource(direction: PerformanceDirection | undefined, field: string) {
  if (!direction) return "";
  const join = (parts: Array<string | undefined>) => parts.filter(Boolean).join("\n");
  switch (field) {
    case "Immediate objective":
      return direction.emotionalState?.objective ?? "";
    case "Concealed versus displayed emotion":
      return join([
        direction.emotionalState?.concealed && `Concealed: ${direction.emotionalState.concealed}`,
        direction.emotionalState?.primary && `Primary feeling: ${direction.emotionalState.primary}`,
        direction.emotionalState?.secondary &&
          `Secondary feeling: ${direction.emotionalState.secondary}`,
        direction.face?.microExpression && `Visible response: ${direction.face.microExpression}`,
      ]);
    case "Permitted action / speech / sound":
      return join([
        direction.movement?.gesture && `Gesture: ${direction.movement.gesture}`,
        direction.movement?.envInteraction && `Environment: ${direction.movement.envInteraction}`,
        direction.movement?.otherCharacterInteraction &&
          `Partner action: ${direction.movement.otherCharacterInteraction}`,
        direction.dialogue?.lines?.length
          ? `Authored lines:\n${direction.dialogue.lines.join("\n")}`
          : undefined,
      ]);
    case "Position / support / contact":
      return join([
        direction.movement?.startingPosition && `Start: ${direction.movement.startingPosition}`,
        direction.face?.gazeTarget && `Attention target: ${direction.face.gazeTarget}`,
        direction.relationship?.distanceBetweenCharacters &&
          `Distance: ${direction.relationship.distanceBetweenCharacters}`,
        direction.relationship?.touch && `Contact: ${direction.relationship.touch}`,
        direction.body?.weightDistribution && `Weight: ${direction.body.weightDistribution}`,
      ]);
    default:
      return "";
  }
}

/** Shared with the field editor so editing a displayed source preserves its text and provenance. */
export function participantFieldView(
  picture: Picture,
  recordId: string,
  field: string,
): {
  value: string;
  source: string;
  disposition: BibleField["disposition"] | "source";
  revision: number;
} {
  const authored = picture.movieBible?.records[recordId]?.fields[field];
  // Explicit missing/N/A is a decision, not an invitation to resurrect older direction.
  if (authored) return { ...authored };
  for (const [beatId, people] of Object.entries(picture.performance?.performance ?? {})) {
    for (const [characterId, direction] of Object.entries(people)) {
      if (`performance:${beatId}:${characterId}` !== recordId) continue;
      const value = directionSource(direction, field);
      return {
        value,
        source: value
          ? `Performance direction · ${recordId} · ${direction.sourceType} · updated ${direction.updatedAt}`
          : "",
        disposition: value ? "source" : "missing",
        revision: 0,
      };
    }
  }
  return { value: "", source: "", disposition: "missing", revision: 0 };
}

export function CharacterScenePanel({
  picture,
  record,
  asset,
  onEdit,
}: {
  picture: Picture;
  record: BibleIndexRow;
  asset?: ProductionAsset;
  onEdit: (recordId: string, kind: BibleKind, field: string) => void;
}) {
  const uid = useId();
  const scenes = characterSceneLinks(picture, record.id, asset);
  const [selectedSceneId, setSceneId] = useWorkspaceDraft(`character-scene:${record.id}`, "");
  const scene = scenes.find((item) => item.id === selectedSceneId) ?? scenes[0];
  const [tab, setTab] = useWorkspaceDraft<StateTab>(`character-state-tab:${record.id}`, "Incoming");
  const activeTab = stateTabs.includes(tab) ? tab : "Incoming";
  const beats = (picture.performance?.beats ?? []).filter(
    (beat) =>
      beat.sceneId === scene?.id &&
      (beat.dependencies.requiredCharacters.includes(record.id) ||
        picture.performance?.performance[beat.id]?.[record.id]),
  );
  const [selectedBeatId, setBeatId] = useWorkspaceDraft(
    `character-beat:${record.id}:${scene?.id ?? "none"}`,
    "",
  );
  const beat = beats.find((item) => item.id === selectedBeatId) ?? beats[0];
  const direction = beat ? picture.performance?.performance[beat.id]?.[record.id] : undefined;
  const participantId = direction && beat ? `performance:${beat.id}:${record.id}` : null;
  const participant = participantId ? picture.movieBible?.records[participantId] : undefined;
  const authoredCount = BIBLE_FIELDS.participant.filter((field) => {
    const value = participant?.fields[field];
    return value && value.disposition !== "missing" && value.value.trim();
  }).length;
  const variants = (asset?.variants ?? []).filter((variant) =>
    variant.requiredSceneIds.includes(scene?.id ?? ""),
  );
  const characterBibles = (picture.visualDevelopment?.characterBibles ?? []).filter(
    (bible) => bible.characterId === record.id,
  );
  const wardrobeIds = new Set(characterBibles.flatMap((bible) => bible.wardrobeStateIds));
  const wardrobeStates = (picture.visualDevelopment?.wardrobeStates ?? []).filter(
    (state) => wardrobeIds.has(state.id) || state.ownerId === record.id,
  );
  const individualStates = Object.values(picture.shotContinuity ?? {}).flatMap((state) => {
    const shot = picture.shots.find(
      (item) => item.id === state.shotId && item.sceneId === scene?.id,
    );
    const individual = state.participants.find((item) => item.characterId === record.id);
    return shot && individual ? [{ state, shot, individual }] : [];
  });
  const shots = (picture.performance?.shots ?? []).filter(
    (shot) =>
      shot.sceneId === scene?.id &&
      (shot.subject.characters.includes(record.id) ||
        shot.subject.approvedReferences?.some((ref) => ref.characterId === record.id)),
  );
  const [continuityOpen, setContinuityOpen] = useState(false);
  const openPerformance = () => useStudio.getState().openAdvancedDepartment("performance");
  const openContinuity = (shotId: string) => {
    const state = useStudio.getState();
    const latest = state.pictures.find((item) => item.id === picture.id);
    const source = latest?.shotContinuity?.[shotId];
    if (!latest || !source) return;
    const currentDraft = latest.editorDrafts?.["shot-continuity"] as
      ShotContinuity | null | undefined;
    const savedDraft = latest.editorDrafts?.[`character-continuity-draft:${shotId}`] as
      ShotContinuity | null | undefined;
    const nextDraft = currentDraft?.shotId === shotId ? currentDraft : (savedDraft ?? source);
    state.replaceActive({
      ...latest,
      editorDrafts: {
        ...latest.editorDrafts,
        ...(currentDraft?.shotId
          ? { [`character-continuity-draft:${currentDraft.shotId}`]: structuredClone(currentDraft) }
          : {}),
        "shot-continuity": structuredClone(nextDraft),
      },
    });
    setContinuityOpen(true);
  };
  const changeContinuityOpen = (open: boolean) => {
    if (!open) {
      const store = useStudio.getState();
      const latest = store.pictures.find((item) => item.id === picture.id);
      const draft = latest?.editorDrafts?.["shot-continuity"] as ShotContinuity | null | undefined;
      if (latest && draft?.shotId)
        store.replaceActive({
          ...latest,
          editorDrafts: {
            ...latest.editorDrafts,
            [`character-continuity-draft:${draft.shotId}`]: structuredClone(draft),
          },
        });
    }
    setContinuityOpen(open);
  };

  return (
    <aside
      className="character-scene-panel"
      aria-label={`${record.name} scene state and continuity`}
    >
      <header className="character-scene-panel-head">
        <div className="character-scene-heading">
          <ScanLine size={16} />
          <h2>Scene state</h2>
        </div>
        <span className="character-scene-count">
          {scenes.length} linked {scenes.length === 1 ? "scene" : "scenes"}
        </span>
      </header>
      {scene ? (
        <>
          <div className="character-scene-selection">
            <label className="character-scene-select-label" htmlFor={`${uid}-scene`}>
              Scene
            </label>
            <div className="character-scene-select-wrap">
              <select
                id={`${uid}-scene`}
                value={scene.id}
                onChange={(event) => setSceneId(event.target.value)}
              >
                {scenes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <div className="character-scene-title-row">
              <h3>{scene.title}</h3>
              <button
                className="character-scene-icon-button"
                type="button"
                aria-label={`Open ${scene.title} in screenplay`}
                onClick={() => openScreenplayScene(picture, scene.id)}
              >
                <ArrowUpRight size={16} />
              </button>
            </div>
            {!scene.available && (
              <p className="character-scene-warning">
                The linked scene record is unavailable. Its ID has been preserved.
              </p>
            )}
            {beats.length > 0 && (
              <label className="character-scene-beat-label">
                Beat
                <select
                  aria-label="Character beat"
                  value={beat?.id ?? ""}
                  onChange={(event) => setBeatId(event.target.value)}
                >
                  {beats.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sequence} · {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="character-scene-tabs" role="tablist" aria-label="Character scene details">
            {stateTabs.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`${uid}-${name}`}
                aria-controls={`${uid}-content`}
                aria-selected={activeTab === name}
                tabIndex={activeTab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  const index = stateTabs.indexOf(name);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % stateTabs.length
                      : event.key === "ArrowLeft"
                        ? (index + stateTabs.length - 1) % stateTabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? stateTabs.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setTab(stateTabs[next]);
                  document.getElementById(`${uid}-${stateTabs[next]}`)?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            className="character-scene-scroll"
            role="tabpanel"
            id={`${uid}-content`}
            aria-labelledby={`${uid}-${activeTab}`}
            tabIndex={0}
          >
            {activeTab !== "Continuity" ? (
              <>
                <div className="character-scene-state-meta">
                  <span>
                    {participantId
                      ? `${authoredCount} / 11 Bible fields recorded`
                      : "Participant direction not recorded"}
                  </span>
                  <button type="button" onClick={openPerformance}>
                    Open performance <ArrowUpRight size={12} />
                  </button>
                </div>
                {fieldGroups[activeTab].map((index) => {
                  const field = BIBLE_FIELDS.participant[index];
                  const view = participantFieldView(picture, participantId ?? "", field);
                  const hasValue = Boolean(view.value.trim());
                  const disposition = {
                    "not-applicable": "Not applicable",
                    missing: "Missing",
                    authored: "Authored",
                    source: "Source direction",
                  }[view.disposition];
                  return (
                    <section
                      className="character-scene-field"
                      key={field}
                      data-state={disposition === "Missing" ? "missing" : "recorded"}
                    >
                      <div className="character-scene-field-top">
                        <h4>{field}</h4>
                        {participantId && (
                          <button
                            type="button"
                            className="character-scene-icon-button"
                            aria-label={`Edit ${field}`}
                            onClick={() => onEdit(participantId, "participant", field)}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                      <p className={!hasValue ? "character-scene-muted" : undefined}>
                        {view.value || "Not recorded"}
                      </p>
                      {fieldHints[field] && (
                        <small className="character-scene-field-hint">{fieldHints[field]}</small>
                      )}
                      <div className="character-scene-field-status">
                        <span>{disposition}</span>
                        {view.revision > 0 && <span>Revision {view.revision}</span>}
                        {view.source && <span>Source: {view.source}</span>}
                      </div>
                    </section>
                  );
                })}
                {individualStates.length + shots.length > 0 && (
                  <button
                    type="button"
                    className="character-scene-text-action"
                    onClick={() => setTab("Continuity")}
                  >
                    <ScanLine size={12} />
                    {individualStates.length} individual states · {shots.length} linked shots
                  </button>
                )}
                {!participantId && (
                  <button
                    type="button"
                    className="character-scene-action"
                    onClick={openPerformance}
                  >
                    <Pencil size={14} />
                    Author participant direction
                  </button>
                )}
                {direction && (
                  <details className="character-scene-details">
                    <summary>
                      Full performance direction <ChevronDown size={13} />
                    </summary>
                    <SourceRecord value={direction} />
                  </details>
                )}
                <details className="character-scene-details">
                  <summary>
                    Scene & source links <ChevronDown size={13} />
                  </summary>
                  {scene.summary && <p>{scene.summary}</p>}
                  {beat && (
                    <>
                      <h4>{beat.title}</h4>
                      <p>{beat.summary}</p>
                    </>
                  )}
                  <dl className="character-scene-source-record">
                    <div>
                      <dt>Scene ID</dt>
                      <dd>{scene.id}</dd>
                    </div>
                    {participantId && (
                      <div>
                        <dt>Participant record</dt>
                        <dd>{participantId}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Linked by</dt>
                      <dd>
                        <SourceRecord value={scene.sources} />
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            ) : (
              <>
                <section className="character-scene-locks">
                  <h4>
                    <LockKeyhole size={14} />
                    Continuity locks
                  </h4>
                  {asset?.canonicalSpec.continuityLocks.length ? (
                    <ul>
                      {asset.canonicalSpec.continuityLocks.map((lock, index) => (
                        <li key={index}>{lock}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="character-scene-muted">No character continuity locks recorded.</p>
                  )}
                </section>
                {asset?.canonicalSpec.wardrobe && (
                  <section className="character-scene-field">
                    <h4>Baseline wardrobe</h4>
                    <p>{asset.canonicalSpec.wardrobe}</p>
                    <small>Identity baseline · temporary scene state stays separate</small>
                  </section>
                )}
                <section className="character-scene-group">
                  <h4>Wardrobe & appearance</h4>
                  {!variants.length && !wardrobeStates.length && (
                    <p className="character-scene-muted">
                      No appearance or wardrobe state linked to this scene.
                    </p>
                  )}
                  {variants.map((variant) => (
                    <details key={variant.id} className="character-scene-details">
                      <summary>
                        {variant.name}
                        <ChevronDown size={13} />
                      </summary>
                      <span className="character-scene-count">
                        {variant.stale ? "Stale" : "Recorded variant"}
                      </span>
                      <SourceRecord
                        value={{
                          id: variant.id,
                          sceneIds: variant.requiredSceneIds,
                          specification: variant.specPatch,
                          requirementIds: variant.requirementIds,
                          staleReasons: variant.staleReasons,
                        }}
                      />
                    </details>
                  ))}
                  {wardrobeStates.map((state) => (
                    <details key={state.id} className="character-scene-details">
                      <summary>
                        {state.label}
                        <ChevronDown size={13} />
                      </summary>
                      <p className="character-scene-muted">
                        Character-linked wardrobe record · no scene binding stored
                      </p>
                      <SourceRecord value={state} />
                    </details>
                  ))}
                </section>
                <section className="character-scene-group">
                  <h4>Individual physical continuity</h4>
                  {!individualStates.length && (
                    <p className="character-scene-muted">
                      No shot continuity state recorded for this character in this scene.
                    </p>
                  )}
                  {individualStates.map(({ state, shot, individual }) => (
                    <details key={state.id} className="character-scene-details">
                      <summary>
                        Shot {shot.index} · {shot.type}
                        <ChevronDown size={13} />
                      </summary>
                      <div className="character-scene-state-pair">
                        <div>
                          <span>IN</span>
                          <p>{individual.incoming || "Not recorded"}</p>
                        </div>
                        <div>
                          <span>OUT</span>
                          <p>{individual.outgoing || "Not recorded"}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="character-scene-text-action"
                        onClick={() => openContinuity(shot.id)}
                      >
                        <Pencil size={12} />
                        Edit physical state
                      </button>
                      <SourceRecord
                        value={{
                          ...individual,
                          source: state.source,
                          revision: state.revision,
                          predecessorId: state.predecessorId,
                          completedEvents: state.completedEvents,
                          newEvents: state.newEvents,
                          restartReason: state.restartReason,
                          imageDisposition: state.imageDisposition,
                          inspectionReason: state.inspectionReason,
                        }}
                      />
                    </details>
                  ))}
                </section>
                <section className="character-scene-group">
                  <h4>Shot state & inherited events</h4>
                  {!shots.length && (
                    <p className="character-scene-muted">
                      No performance shots linked to this character in this scene.
                    </p>
                  )}
                  {shots.map((shot) => (
                    <details key={shot.canonicalShotId} className="character-scene-details">
                      <summary>
                        Shot {shot.sequenceOrder} · {shot.framing.shotSize || shot.shotId}
                        <ChevronDown size={13} />
                      </summary>
                      <p className="character-scene-muted">
                        {shot.subject.characters.length > 1
                          ? "Shared shot state. Individual direction remains in its participant record."
                          : "Character-linked shot state."}
                      </p>
                      <SourceRecord
                        value={{
                          shotId: shot.shotId,
                          version: shot.version,
                          status: shot.status,
                          incoming: shot.performanceIn,
                          outgoing: shot.performanceOut,
                          continuity: shot.continuity,
                          subject: shot.subject,
                          authorizedAudio: shot.audio,
                        }}
                      />
                    </details>
                  ))}
                </section>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="character-scene-scroll character-scene-unlinked">
          <Clapperboard size={25} />
          <h3>No linked scene yet</h3>
          <p>
            Scene state appears when this character is linked by an asset, beat, visual Bible or
            continuity record.
          </p>
          <button type="button" className="character-scene-action" onClick={openPerformance}>
            Open performance <ArrowUpRight size={14} />
          </button>
          <section className="character-scene-locks">
            <h4>
              <LockKeyhole size={14} />
              Continuity locks
            </h4>
            {asset?.canonicalSpec.continuityLocks.length ? (
              <ul>
                {asset.canonicalSpec.continuityLocks.map((lock, index) => (
                  <li key={index}>{lock}</li>
                ))}
              </ul>
            ) : (
              <p className="character-scene-muted">No character continuity locks recorded.</p>
            )}
          </section>
        </div>
      )}
      <CabinetModal
        title={`${record.name} · physical continuity`}
        open={continuityOpen}
        onOpenChange={changeContinuityOpen}
      >
        <ShotContinuityEditor />
      </CabinetModal>
    </aside>
  );
}
