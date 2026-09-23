import "./writing-workspaces.css";
import "./nonmodal-shell-and-script.css";
import "./screenplay-ps5.css";
import { AssetImagePreview } from "./asset-image-preview";
import {
  replaceScreenplayEditorScene,
  textareaOffsetToSource,
} from "@/lib/studio/screenplay-editor";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Circle,
  GitCompareArrows,
  LoaderCircle,
  ListVideo,
  SlidersHorizontal,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { screenplaySteps, type ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import {
  screenplayScenes,
  type PictureScreenplay,
  type ScreenplayModelRef,
} from "@/lib/studio/screenplay";
import { explicitMoviePlanServedId } from "@/lib/studio/movie-plan-model";
import type { Picture } from "@/lib/studio/types";
import { AssetRunActivity } from "./generated-assets-review";
import { StoryDoctorActivity } from "./story-doctor-activity";
import { storyDoctorRuns } from "@/lib/studio/story-doctor-runs";
import {
  defaultScreenplayScope,
  SCREENPLAY_SCOPES,
  type ScreenplayRewriteTarget,
  type ScreenplayScope,
  type ScreenplaySelection,
} from "@/lib/studio/screenplay-scope.ts";
import { parseScreenplayHierarchy } from "@/lib/studio/screenplay-hierarchy.ts";
import type { ScreenplayJobSnapshot } from "@/lib/studio/screenplay-jobs.server";
import { hydrateProductionRouting } from "@/lib/studio/production-profiles";
import { BIBLE_FIELDS } from "@/lib/studio/movie-bible";
import { applyCharacterFieldEdit, type BibleFieldEdit } from "@/lib/studio/character-dossier";
import { PRODIGAL_SON_PICTURE_ID } from "@/lib/studio/prodigal-son";
import {
  loadBundledMediaMap,
  resolveSiteImageUri,
  type BundledMediaMap,
} from "@/lib/studio/site-media-preview";
import { useStudio } from "@/lib/studio/store";
import { participantFieldView } from "./character-scene-panel";

function statusLabel(status: PictureScreenplay["status"]): string {
  if (status === "READY_FOR_REVIEW") return "Ready for review";
  if (status === "APPROVED") return "Screenplay approved";
  return status === "GENERATING" ? "Generating" : "Draft";
}

function sceneArtwork(picture: Picture, sceneId: string, mediaMap: BundledMediaMap) {
  for (const shot of picture.shots) {
    if (shot.sceneId !== sceneId) continue;
    const uri = resolveSiteImageUri(picture.id, shot.stillUrl, mediaMap);
    if (uri) return uri;
  }
  // The Site also bundles the original first frames. A saved picture may not
  // contain their shot records yet; display an exact scene frame in that case.
  if (picture.id === PRODIGAL_SON_PICTURE_ID && !picture.directorSceneRevisions?.[sceneId]) {
    const prefix = `/pictures/prodigal-son/frames/${sceneId}/`;
    const skippedShots = new Set(picture.frameBundle?.skippedShotIds ?? []);
    const frame = Object.entries(mediaMap).find(([source]) => {
      const shotId = source.slice(prefix.length).split("_FIRST-")[0];
      return source.startsWith(prefix) && source.includes("_FIRST-") && !skippedShots.has(shotId);
    });
    if (frame) return frame[1];
  }
  return null;
}

function sceneRailLabel(slugline: string, index: number): string {
  const location = slugline
    .replace(/^(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s*/i, "")
    .split(/\s+[—–-]\s+/)[0]
    .replace(/\s+/g, " ")
    .trim();
  return location.split(" ").slice(0, 3).join(" ") || `Scene ${index + 1}`;
}

export function ScreenplayWorkspace({
  picture,
  intake,
  screenplay,
  models,
  provider,
  job,
  onTextChange,
  onSaveRevision,
  onGenerate,
  onContinue,
  onRegeneratePass,
  onStop,
  onRestore,
  onApprove,
  onRescan,
  onModelChange,
  onStoryDoctor,
  onApplyQaRevision,
  onApplyQaRecommendations,
  onQaPin,
  onReleaseResident,
  researchApproved,
}: {
  picture: Picture;
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  models: ScreenplayModelRef[];
  provider: LocalLLMProviderDiscovery | null;
  job: ScreenplayJobSnapshot | null;
  onTextChange: (fountain: string) => void;
  onSaveRevision: () => void;
  onGenerate: (target: ScreenplayRewriteTarget) => void;
  onContinue: (target: ScreenplayRewriteTarget) => void;
  onRegeneratePass: (stepId: ScreenplayStep["id"], target: ScreenplayRewriteTarget) => void;
  onStop: () => void;
  onRestore: (versionId: string) => void;
  onApprove: () => void;
  onRescan: () => void;
  onModelChange: (modelId: string | null) => void;
  onStoryDoctor?: (
    modelId: string,
    target: ScreenplayRewriteTarget,
    secondOpinion: boolean,
  ) => void;
  onApplyQaRevision?: (next: PictureScreenplay) => void;
  onApplyQaRecommendations?: (target: ScreenplayRewriteTarget) => void;
  onQaPin?: (servedModelId: string | null) => void;
  onReleaseResident?: () => void;
  researchApproved: boolean;
}) {
  const [compareId, setCompareId] = useWorkspaceDraft<string>("screenplay-compare-version", "");
  const [passId, setPassId] = useWorkspaceDraft<ScreenplayStep["id"]>("screenplay-pass", "pass-1");
  const [qaModelId, setQaModelId] = useState("");
  const [rewriteScope, setRewriteScope] = useWorkspaceDraft<ScreenplayScope>(
    "screenplay-rewrite-scope",
    "scene",
  );
  const [secondOpinion, setSecondOpinion] = useWorkspaceDraft("screenplay-second-opinion", false);
  const [selectedNodeId, setSelectedNodeId] = useWorkspaceDraft<string | null>(
    "screenplay-selected-scene",
    null,
  );
  const [sceneOnly, setSceneOnly] = useWorkspaceDraft(
    "screenplay-scene-view",
    screenplayScenes(screenplay.workingFountain).length > 0,
  );
  const [sceneQuery, setSceneQuery] = useState("");
  const [scenesOpen, setScenesOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useWorkspaceDraft("screenplay-inspector-tab", "context");
  const [editingSceneField, setEditingSceneField] = useState<{
    sceneId: string;
    field: string;
  } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const sceneTrigger = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useWorkspaceDraft<string[]>(
    "screenplay-selected-scenes",
    [],
  );
  const [inspectorOpen, setInspectorOpen] = useWorkspaceDraft("screenplay-context-open", true);
  const [compactInspectorOpen, setCompactInspectorOpen] = useState(false);
  const [failedBackdropUris, setFailedBackdropUris] = useState<string[]>([]);
  const [bundledMediaMap, setBundledMediaMap] = useState<BundledMediaMap>({});
  const [selection, setSelection] = useState<ScreenplaySelection>(null);
  useEffect(() => {
    if (picture.id !== PRODIGAL_SON_PICTURE_ID) return;
    let mounted = true;
    void loadBundledMediaMap().then((map) => {
      if (mounted) setBundledMediaMap(map);
    });
    return () => {
      mounted = false;
    };
  }, [picture.id]);
  const generation = job?.screenplay.generation ?? screenplay.generation;
  const running =
    job?.status === "queued" || job?.status === "running" || screenplay.status === "GENERATING";
  const qaRunning = useSyncExternalStore(
    storyDoctorRuns.subscribe,
    () => storyDoctorRuns.get(picture.id)?.status === "running",
    () => false,
  );
  const stopped = job?.status === "canceled";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const shownText =
    running && job?.partialFountain ? job.partialFountain : screenplay.workingFountain;
  const scenes = useMemo(() => screenplayScenes(shownText), [shownText]);
  const selected =
    models.find(
      (model) =>
        model.servedModelId === explicitMoviePlanServedId(picture)?.replace(/^lmstudio:/, ""),
    ) ?? null;
  const compared = screenplay.versions.find((version) => version.id === compareId) ?? null;
  const steps = screenplaySteps(screenplay.workflow);
  const passSteps = steps.filter((step) => step.pass !== null);
  const writerPin = explicitMoviePlanServedId(picture)?.replace(/^lmstudio:/, "") ?? null;
  const qaPin = screenplay.pinnedQaServedId ?? null;
  const routing = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(writerPin),
  });
  const writerBinding = routing.bindings.find(
    (binding) => binding.role === (screenplay.workingFountain.trim() ? "rewrite" : "writer"),
  );
  const selectedReady = Boolean(
    writerBinding?.callableModelId && ["installed", "loaded"].includes(writerBinding.status),
  );
  const writerBlock = selectedReady
    ? null
    : (writerBinding?.statusReason ?? "Refresh the selected production profile.");
  const generateEnabled = researchApproved && selectedReady && !writerBlock && !qaRunning;
  const generateBlock = !researchApproved
    ? "Approve Picture Research before generating a screenplay."
    : writerBlock;
  const hierarchy = useMemo(
    () => parseScreenplayHierarchy(shownText, screenplay.hierarchy),
    [shownText, screenplay.hierarchy],
  );
  const sceneNodes = hierarchy.nodes.filter((node) => node.kind === "scene" && !node.tombstoned);
  const activeScene = sceneNodes.find((node) => node.id === selectedNodeId) ?? sceneNodes[0];
  const activeArtwork = activeScene ? sceneArtwork(picture, activeScene.id, bundledMediaMap) : null;
  const backdropUri =
    activeArtwork && !failedBackdropUris.includes(activeArtwork) ? activeArtwork : null;
  const editorOffset = sceneOnly && activeScene && !running ? activeScene.sourceStart : 0;
  const editorText =
    sceneOnly && activeScene && !running
      ? shownText.slice(activeScene.sourceStart, activeScene.sourceEnd)
      : shownText;
  const sceneBeats = hierarchy.nodes.filter(
    (node) => node.parentId === activeScene?.id && node.kind === "beat",
  );
  const sceneDialogue = hierarchy.nodes.filter(
    (node) => node.parentId === activeScene?.id && node.kind === "dialogue",
  );
  const sceneHeadingParts = (activeScene?.slugline || activeScene?.title || "")
    .split(/\s+[—–-]\s+/)
    .filter(Boolean);
  const sceneTime = [...sceneHeadingParts]
    .reverse()
    .find((part) =>
      /^(?:DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|CONTINUOUS|LATER)$/i.test(part),
    );
  const sceneLocation = sceneHeadingParts.filter((part) => part !== sceneTime).join(" · ");
  const sceneBibleFields = activeScene
    ? (picture.movieBible?.records[activeScene.id]?.fields ?? {})
    : {};
  const speakingRoles = [...new Set(sceneDialogue.map((line) => line.title))];
  const sceneRecord = activeScene
    ? picture.scenes.find((scene) => scene.id === activeScene.id)
    : undefined;
  const importedScene = activeScene
    ? picture.importedPackage?.timingPlan.find((scene) => scene.id === activeScene.id)
    : undefined;
  const sceneReviewUnit = activeScene
    ? picture.bibleRun?.units.filter((unit) => unit.sceneId === activeScene.id).at(-1)
    : undefined;
  const participantDirections = activeScene
    ? (picture.performance?.beats ?? [])
        .filter((beat) => beat.sceneId === activeScene.id)
        .flatMap((beat) =>
          Object.keys(picture.performance?.performance[beat.id] ?? {}).map((characterId) => ({
            id: `performance:${beat.id}:${characterId}`,
            beatId: beat.id,
            beatTitle: beat.title,
            characterId,
          })),
        )
    : [];
  useEffect(() => {
    if (sceneOnly && editor.current) editor.current.scrollTop = 0;
  }, [selectedNodeId, sceneOnly]);
  const defaultQaModel =
    models.find((model) => model.servedModelId === (qaPin || writerPin)) ?? null;
  const reviewerBinding = routing.bindings.find(
    (binding) => binding.role === (secondOpinion ? "challenger" : "reviewer"),
  );
  const effectiveQaModelId = reviewerBinding?.callableModelId ?? "";
  const qaModel = models.find((model) => model.id === effectiveQaModelId) ?? null;
  const effectiveQaPin = qaPin || writerPin;
  const qaBlock =
    reviewerBinding?.callableModelId && ["installed", "loaded"].includes(reviewerBinding.status)
      ? null
      : (reviewerBinding?.statusReason ?? "Refresh the selected reviewer binding.");
  const rewriteTarget: ScreenplayRewriteTarget = {
    scope: rewriteScope,
    nodeId: selectedNodeId,
    nodeIds: selectedNodeIds.length ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : null,
    selection,
  };
  const qaReport = screenplay.lastQaReport ?? null;
  const applyableIndex =
    qaReport?.findings.findIndex((finding) => Boolean(finding.rewriteSuggested?.trim())) ?? -1;
  const completed = new Set(
    generation?.completedLabels ??
      screenplay.versions.map((version) => (version.label === "Draft 1" ? "Draft" : version.label)),
  );

  const sceneIndex = sceneOnly ? sceneNodes.findIndex((node) => node.id === activeScene?.id) : -1;
  const chooseScene = (id: string) => {
    const scene = sceneNodes.find((node) => node.id === id);
    setSceneOnly(Boolean(scene));
    setSelectedNodeId(scene?.id ?? null);
    setSelectedNodeIds(scene ? [scene.id] : []);
    setSelection(null);
    if (scene) setRewriteScope(defaultScreenplayScope(scene));
  };

  const inspectorContent = (
    <aside
      className="writing-workbench-inspector-content"
      aria-label="Screenplay profile, writing and critique"
    >
      <div className="writing-workbench-tabs" aria-label="Screenplay inspector">
        {[
          ["context", "Scene"],
          ["notes", "Notes"],
          ["continuity", "Continuity"],
          ["tags", "Tags"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={inspectorTab === id}
            onClick={() => setInspectorTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="screenplay-ps5-inspector-tools">
        <span>Scene {activeScene ? String(activeScene.order + 1).padStart(2, "0") : "—"}</span>
        <select
          aria-label="More screenplay tools"
          value={
            ["bible", "source", "writing", "versions"].includes(inspectorTab) ? inspectorTab : ""
          }
          onChange={(event) => setInspectorTab(event.target.value)}
        >
          <option value="">More tools…</option>
          <option value="bible">Scene Bible</option>
          <option value="source">Story source</option>
          <option value="writing">Writing & critique</option>
          <option value="versions">Versions</option>
        </select>
      </div>
      {inspectorTab === "context" && (
        <section className="writing-workbench-context" aria-label="Selected scene context">
          <h3 className="font-display">
            {activeScene?.slugline || activeScene?.title || "Select a scene"}
          </h3>
          <p className="screenplay-ps5-scene-status">
            <span aria-hidden="true" /> {statusLabel(running ? "GENERATING" : screenplay.status)}
          </p>
          {activeScene && (
            <dl className="screenplay-ps5-scene-facts">
              {sceneLocation && (
                <div>
                  <dt>Location</dt>
                  <dd>{sceneLocation}</dd>
                </div>
              )}
              {sceneTime && (
                <div>
                  <dt>Time</dt>
                  <dd>{sceneTime}</dd>
                </div>
              )}
              {speakingRoles.length > 0 && (
                <div>
                  <dt>Characters</dt>
                  <dd>{speakingRoles.join(", ")}</dd>
                </div>
              )}
              {sceneBibleFields[BIBLE_FIELDS.scene[0]]?.value && (
                <div>
                  <dt>Objective</dt>
                  <dd>{sceneBibleFields[BIBLE_FIELDS.scene[0]].value}</dd>
                </div>
              )}
              {(sceneRecord || importedScene) && (
                <div>
                  <dt>Duration</dt>
                  <dd>{sceneRecord?.durationSec ?? importedScene?.duration_seconds} sec</dd>
                </div>
              )}
            </dl>
          )}
          <p className="screenplay-ps5-scene-summary">
            {sceneRecord?.summary ||
              (activeScene
                ? `${sceneBeats.length} beats · ${sceneDialogue.length} dialogue passages`
                : "Choose a scene from the film strip below.")}
          </p>
        </section>
      )}
      {inspectorTab === "notes" && (
        <section className="screenplay-ps5-compact-section" aria-label="Scene notes">
          <h3>Notes</h3>
          <dl className="screenplay-ps5-scene-facts">
            {(
              [
                ["Story", sceneRecord?.summary],
                ["Emotional beat", sceneRecord?.emotionalBeat],
                ["Narrative purpose", sceneBibleFields[BIBLE_FIELDS.scene[0]]?.value],
                ["Emotional change", sceneBibleFields[BIBLE_FIELDS.scene[5]]?.value],
                ["Sound", sceneBibleFields[BIBLE_FIELDS.scene[7]]?.value],
              ] as const
            )
              .filter(([, value]) => value?.trim())
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            className="screenplay-ps5-inline-link"
            onClick={() => setInspectorTab("bible")}
          >
            Open scene Bible to edit notes
          </button>
        </section>
      )}
      {inspectorTab === "continuity" && (
        <section className="screenplay-ps5-compact-section" aria-label="Scene continuity">
          <h3>Continuity</h3>
          <dl className="screenplay-ps5-scene-facts">
            {(
              [
                ["Incoming", sceneBibleFields[BIBLE_FIELDS.scene[1]]?.value],
                ["Geography", sceneBibleFields[BIBLE_FIELDS.scene[2]]?.value],
                ["Entrances / exits", sceneBibleFields[BIBLE_FIELDS.scene[3]]?.value],
                ["Outgoing", sceneBibleFields[BIBLE_FIELDS.scene[9]]?.value],
                ["Source note", importedScene?.continuity],
              ] as const
            )
              .filter(([, value]) => value?.trim())
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <button
            type="button"
            className="screenplay-ps5-inline-link"
            onClick={() => setInspectorTab("bible")}
          >
            Open scene Bible to edit continuity
          </button>
        </section>
      )}
      {inspectorTab === "tags" && (
        <section className="screenplay-ps5-compact-section" aria-label="Scene tags">
          <h3>Tags</h3>
          <p>From this scene’s saved script and timing</p>
          <div className="screenplay-ps5-tags">
            {[sceneLocation, sceneTime, importedScene?.story_time, ...speakingRoles]
              .filter((tag): tag is string => Boolean(tag?.trim()))
              .map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
          </div>
          {!sceneLocation && !sceneTime && !speakingRoles.length && (
            <p>No scene details to show yet.</p>
          )}
        </section>
      )}
      {inspectorTab === "bible" && (
        <section className="screenplay-ps5-bible" aria-label="Linked scene Bible">
          <header>
            <h3>Scene Bible</h3>
            <span>{activeScene ? `Scene ${activeScene.order + 1}` : "No scene selected"}</span>
          </header>
          {activeScene ? (
            <>
              <dl className="screenplay-ps5-scene-facts">
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {sceneRecord?.durationSec ?? importedScene?.duration_seconds ?? "Not timed"}
                    {sceneRecord || importedScene ? " seconds" : ""}
                  </dd>
                </div>
                {importedScene?.story_time && (
                  <div>
                    <dt>Story time</dt>
                    <dd>{importedScene.story_time}</dd>
                  </div>
                )}
                <div>
                  <dt>Script review</dt>
                  <dd>{statusLabel(screenplay.status)}</dd>
                </div>
                <div>
                  <dt>Bible review</dt>
                  <dd>{sceneReviewUnit?.status ?? "No scene review recorded"}</dd>
                </div>
                {sceneRecord?.emotionalBeat && (
                  <div>
                    <dt>Emotional beat</dt>
                    <dd>{sceneRecord.emotionalBeat}</dd>
                  </div>
                )}
              </dl>
              {importedScene && (
                <details className="screenplay-ps5-bible-details">
                  <summary>Imported scene source</summary>
                  <dl>
                    <div>
                      <dt>Action</dt>
                      <dd>{importedScene.action}</dd>
                    </div>
                    <div>
                      <dt>Continuity</dt>
                      <dd>{importedScene.continuity}</dd>
                    </div>
                  </dl>
                </details>
              )}
              <div className="screenplay-ps5-bible-field-heading">
                <h4>Direction</h4>
                <span>
                  {
                    BIBLE_FIELDS.scene.filter((field) => sceneBibleFields[field]?.value.trim())
                      .length
                  }
                  /{BIBLE_FIELDS.scene.length} recorded
                </span>
              </div>
              <div className="screenplay-ps5-bible-fields">
                {BIBLE_FIELDS.scene.map((field) => {
                  const saved = sceneBibleFields[field];
                  const editing =
                    editingSceneField?.sceneId === activeScene.id &&
                    editingSceneField.field === field;
                  return (
                    <article key={field}>
                      <header>
                        <h5>{field}</h5>
                        <button
                          type="button"
                          disabled={!sceneRecord}
                          aria-label={`Edit ${field}`}
                          onClick={() =>
                            setEditingSceneField(
                              editing ? null : { sceneId: activeScene.id, field },
                            )
                          }
                        >
                          {editing ? "Close" : "Edit"}
                        </button>
                      </header>
                      <p>{saved?.value || "Not recorded"}</p>
                      {saved && (
                        <small>
                          {saved.disposition} · revision {saved.revision}
                          {saved.source ? ` · ${saved.source}` : ""}
                        </small>
                      )}
                      {editing && sceneRecord && (
                        <SceneBibleFieldEditor
                          key={`${activeScene.id}:${field}`}
                          picture={picture}
                          sceneId={activeScene.id}
                          field={field}
                          onClose={() => setEditingSceneField(null)}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
              {!sceneRecord && (
                <p className="screenplay-ps5-bible-help">
                  Prepare this screenplay scene in the picture inventory before saving linked Bible
                  direction.
                </p>
              )}
              {participantDirections.length > 0 && (
                <details className="screenplay-ps5-bible-details">
                  <summary>Participant knowledge, objectives and turns</summary>
                  <div className="screenplay-ps5-participant-directions">
                    {participantDirections.map((participant) => {
                      const name =
                        picture.characters.find((person) => person.id === participant.characterId)
                          ?.name ?? participant.characterId;
                      const fields = [
                        BIBLE_FIELDS.participant[0],
                        BIBLE_FIELDS.participant[1],
                        BIBLE_FIELDS.participant[6],
                        BIBLE_FIELDS.participant[8],
                        BIBLE_FIELDS.participant[10],
                      ];
                      return (
                        <article key={participant.id}>
                          <h5>
                            {name} · {participant.beatTitle}
                          </h5>
                          <dl>
                            {fields.map((field) => {
                              const view = participantFieldView(picture, participant.id, field);
                              return view.value.trim() ? (
                                <div key={field}>
                                  <dt>{field}</dt>
                                  <dd>{view.value}</dd>
                                </div>
                              ) : null;
                            })}
                          </dl>
                        </article>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          ) : (
            <p>Select a scene to inspect its linked Bible.</p>
          )}
        </section>
      )}
      {inspectorTab === "source" && (
        <section
          className="writing-workbench-source-context"
          aria-label="Governing source and story direction"
        >
          <p className="text-xs text-muted">
            Saved picture direction ·{" "}
            {researchApproved ? "Research approved" : "Research awaiting approval"}
          </p>
          {(
            [
              ["Premise", intake.premise || intake.concept],
              ["Treatment", intake.treatment],
              ["Story notes", intake.storyNotes],
              ["Source material", intake.sourceMaterial],
              ["Source passages", intake.sourcePassages],
              ["Supplied source text", intake.suppliedSourceText],
              ["Adaptation instructions", intake.adaptationInstructions],
              ["Protected material", intake.materialToPreserve],
              ["Permitted dramatization", intake.materialMayDramatize],
              ["Fidelity requirements", intake.fidelityRequirements],
              ["Adaptation boundaries", intake.adaptationBoundaries],
              ["Story constraints", intake.storyConstraints],
              ["Required inclusions", intake.mustInclude],
              ["Prohibited additions", intake.mustAvoid],
              ["Dialogue direction", intake.dialogueStyle],
              ["Director notes", intake.directorNotes],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="writing-workbench-source-note">
              <h4 className="text-xs text-accent">{label}</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {text || "Not supplied"}
              </p>
            </div>
          ))}
          {intake.importedSources.map((source, index) => (
            <details key={`${source.fileName}-${index}`} className="writing-workbench-source-note">
              <summary>{source.fileName}</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{source.text}</p>
            </details>
          ))}
        </section>
      )}
      <div hidden={inspectorTab !== "writing"}>
        {job || running ? (
          <section
            aria-label="Live screenplay activity"
            className="mb-4 grid gap-2 rounded-md border border-accent bg-inset p-3"
          >
            <p className="text-sm" role="status">
              {job?.activeLabel ?? generation?.activeLabel ?? "Connecting to current generation"} ·{" "}
              {writerPin}
            </p>
            <p className="text-xs text-muted">
              {Math.max(
                0,
                Math.floor(
                  ((running ? now : (job?.updatedAt ?? now)) -
                    (job?.startedAt ?? generation?.startedAt ?? now)) /
                    1000,
                ),
              )}
              s elapsed · {job?.partialFountain.length ?? 0} output characters · Last update{" "}
              {Math.max(0, Math.floor((now - (job?.updatedAt ?? now)) / 1000))}s ago
            </p>
            {job?.reasoning ? (
              <details open>
                <summary className="text-xs">
                  Local model reasoning reported by LM Studio ·{" "}
                  {job.reasoning.length.toLocaleString()} characters
                </summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {job.reasoning}
                </pre>
              </details>
            ) : (
              <p className="text-xs text-muted">
                {running
                  ? "Waiting for model output. Any reasoning supplied by LM Studio will appear here."
                  : "LM Studio did not supply reasoning for this run."}
              </p>
            )}
            {job?.partialFountain ? (
              <details open>
                <summary className="text-xs">Live screenplay output</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {job.partialFountain}
                </pre>
              </details>
            ) : null}
          </section>
        ) : null}
        {generation ? (
          <div className="mt-3">
            <p className="text-xs text-muted">{job?.activeLabel ?? generation.activeLabel}</p>
            <ol className="mt-2 flex flex-wrap gap-2">
              {steps.map((step) => {
                const active = generation.activeLabel === step.label;
                const done = completed.has(step.label);
                return (
                  <li key={step.id} className="flex items-center gap-1 text-[11px] text-muted">
                    {done ? (
                      <Check className="size-3 text-good" />
                    ) : active ? (
                      <LoaderCircle className="size-3 animate-spin text-accent" />
                    ) : (
                      <Circle className="size-2.5 text-subtle" />
                    )}
                    {step.label}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="rec" onClick={onStop}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button
              onClick={() => onGenerate(rewriteTarget)}
              disabled={!generateEnabled}
              title={generateBlock ?? undefined}
            >
              Generate Screenplay
            </Button>
          )}
          {stopped ? (
            <Button
              variant="secondary"
              onClick={() => onContinue(rewriteTarget)}
              disabled={!generateEnabled}
            >
              Continue
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={running || !passSteps.length || !generateEnabled}
            onClick={() => onRegeneratePass(passId, rewriteTarget)}
          >
            <RotateCcw />
            Regenerate Pass
          </Button>
          {passSteps.length ? (
            <select
              aria-label="Pass to regenerate"
              className="h-9 rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]"
              value={passId}
              onChange={(event) => setPassId(event.target.value as ScreenplayStep["id"])}
            >
              {passSteps.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Writer</p>
          <button type="button" onClick={onRescan} className="text-[11px] text-muted hover:text-fg">
            Rescan
          </button>
        </div>
        <p className="mt-3 text-sm">
          {routing.profileId === "astra-ultra" ? "Astra Ultra" : "Local Models"} ·{" "}
          {writerBinding?.label}
        </p>
        <p className="mt-2 text-xs text-muted">
          Bindings and availability are controlled by Production profile above. No silent writer
          substitution.
        </p>
        {generateBlock ? <p className="mt-2 text-xs text-muted">{generateBlock}</p> : null}
        <p className="mt-2 text-xs text-muted">QA is optional and runs only when requested.</p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Scope</p>
        <select
          aria-label="Rewrite scope"
          className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]"
          value={rewriteScope}
          onChange={(event) => setRewriteScope(event.target.value as ScreenplayScope)}
        >
          {SCREENPLAY_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {scope}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Default is the smallest selection (
          {defaultScreenplayScope(hierarchy.nodes.find((node) => node.kind === "scene") ?? null)}
          ). Unrelated IDs stay byte-identical.
        </p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">QA</p>
        <p className="mt-3 text-sm">{reviewerBinding?.label}</p>
        <label className="mt-3 flex items-center gap-2 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={secondOpinion}
            onChange={(event) => setSecondOpinion(event.target.checked)}
          />
          Use the profile challenger (optional)
        </label>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {qaBlock ?? "Critique first. Fountain does not change until you apply a scoped revision."}
        </p>
        {qaRunning ? (
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="rec"
            onClick={() => storyDoctorRuns.stop(picture.id)}
          >
            Stop Story Doctor
          </Button>
        ) : (
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="secondary"
            disabled={Boolean(qaBlock) || running || !effectiveQaModelId}
            onClick={() => onStoryDoctor?.(effectiveQaModelId, rewriteTarget, secondOpinion)}
          >
            Run story doctor
          </Button>
        )}
        {qaReport ? (
          <div className="mt-3 grid gap-2" aria-label="Story Doctor critique">
            {qaReport.findings.map((finding, index) => (
              <article
                key={`${qaReport.id}-${index}`}
                className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"
              >
                <p className="text-[10px] tracking-wide text-subtle uppercase">
                  {finding.category} · {finding.severity}
                </p>
                <p className="mt-1 text-xs leading-relaxed">{finding.summary}</p>
              </article>
            ))}
          </div>
        ) : null}
        <Button
          className="mt-3 w-full h-auto whitespace-normal"
          size="sm"
          disabled={running || qaRunning || !generateEnabled || !qaReport?.findings.length}
          onClick={() =>
            onApplyQaRecommendations?.(
              selectedNodeId || selection
                ? rewriteTarget
                : { scope: "full", nodeId: null, nodeIds: null, selection: null },
            )
          }
        >
          Apply Story Doctor recommendations
        </Button>
        <p className="mt-2 text-xs text-muted">
          The selected writer revises{" "}
          {selectedNodeId || selection ? "the selected scope" : "the screenplay"} using the saved
          findings and saves a new version. Previous versions remain available.
        </p>
        <Button
          className="mt-3 w-full"
          size="sm"
          variant="ghost"
          disabled={running || qaRunning}
          onClick={() => onReleaseResident?.()}
        >
          Release local model
        </Button>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Prompt/cue role:{" "}
          {routing.bindings.find((binding) => binding.role === "prompt-cue")?.label}.
        </p>
        <div className="my-5 border-t border-border" />
      </div>
      <div hidden={inspectorTab !== "versions"}>
        {compared ? (
          <div className="mb-4 grid gap-3 xl:grid-cols-2">
            <section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]">
              <p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">Current</p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                {screenplay.workingFountain}
              </pre>
            </section>
            <section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]">
              <p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">
                {compared.label}
              </p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                {compared.fountain}
              </pre>
            </section>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Versions</p>
          <span className="text-[10px] tabular-nums text-subtle">{screenplay.versions.length}</span>
        </div>
        <ol className="mt-3 grid gap-2">
          {[...screenplay.versions].reverse().map((version) => (
            <li
              key={version.id}
              className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 whitespace-normal break-words text-xs" title={version.label}>
                  {version.label}
                </p>
                {version.id === screenplay.currentVersionId ? (
                  <span className="text-[9px] tracking-wide text-accent uppercase">Current</span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] text-subtle">
                {new Date(version.createdAt).toLocaleString()}
              </p>
              <div className="mt-2 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCompareId(compareId === version.id ? "" : version.id)}
                >
                  <GitCompareArrows />
                  Compare
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={running || version.id === screenplay.currentVersionId}
                  onClick={() => onRestore(version.id)}
                >
                  Restore
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {screenplay.lastTelemetry ? (
          <>
            <div className="my-5 border-t border-border" />
            <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Last run</p>
            <dl className="mt-3 grid gap-2 text-xs">
              <div>
                <dt className="text-subtle">Provider</dt>
                <dd>{screenplay.lastTelemetry.provider}</dd>
              </div>
              <div>
                <dt className="text-subtle">Endpoint</dt>
                <dd className="break-all" title={screenplay.lastTelemetry.endpoint}>
                  {screenplay.lastTelemetry.endpoint.replace("http://127.0.0.1", "localhost")}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">Local</dt>
                <dd>{screenplay.lastTelemetry.local ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-subtle">Cloud fallback</dt>
                <dd>{screenplay.lastTelemetry.cloudFallback ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-subtle">Generation</dt>
                <dd className="tabular-nums">
                  {screenplay.lastTelemetry.generationMs === null
                    ? "Unavailable"
                    : `${(screenplay.lastTelemetry.generationMs / 1000).toFixed(1)}s`}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">Unload</dt>
                <dd>{screenplay.lastTelemetry.unloadVerification}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div
      className="screenplay-workspace cabinet-screenplay writing-workbench writing-workbench-screenplay"
      data-ps5="true"
      data-context-open={inspectorOpen || compactInspectorOpen}
      data-scenes-open={scenesOpen}
      data-compact-inspector-open={compactInspectorOpen}
    >
      <div className="screenplay-ps5-backdrop" aria-hidden="true">
        {backdropUri && (
          <img
            key={backdropUri}
            src={backdropUri}
            alt=""
            onError={() => setFailedBackdropUris((previous) => [...previous, backdropUri])}
          />
        )}
      </div>
      {scenesOpen && (
        <aside
          className="screenplay-scene-list"
          id="screenplay-scene-list"
          aria-label="Screenplay scenes"
        >
          <header className="screenplay-scene-list-header">
            <div>
              <p className="text-xs text-muted">Navigator</p>
              <h3>Scenes · {scenes.length}</h3>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close scenes"
              onClick={() => {
                setScenesOpen(false);
                requestAnimationFrame(() => sceneTrigger.current?.focus());
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="screenplay-scene-list-content">
            <input
              className="w-full rounded border border-border bg-inset px-2 py-2 text-sm"
              aria-label="Find a scene"
              placeholder="Find a scene…"
              value={sceneQuery}
              onChange={(event) => setSceneQuery(event.target.value)}
            />
            <button
              type="button"
              className="workspace-nav-link mt-3"
              aria-pressed={!sceneOnly}
              onClick={() => {
                setSceneOnly(false);
                setSelection(null);
                setScenesOpen(false);
                requestAnimationFrame(() => editor.current?.focus());
              }}
            >
              Full screenplay · {scenes.length} scenes
            </button>
            <ol className="mt-3 grid gap-1">
              {sceneNodes
                .filter((node) =>
                  `${node.title} ${node.slugline}`.toLowerCase().includes(sceneQuery.toLowerCase()),
                )
                .map((scene, index) => (
                  <li key={scene.id}>
                    <button
                      type="button"
                      aria-pressed={
                        selectedNodeIds.includes(scene.id) || selectedNodeId === scene.id
                      }
                      className={`w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-elevated hover:text-fg ${selectedNodeIds.includes(scene.id) || selectedNodeId === scene.id ? "bg-elevated text-fg" : "text-muted"}`}
                      onClick={(event) => {
                        setSceneOnly(true);
                        setSelection(null);
                        if (event.ctrlKey || event.metaKey) {
                          const next = selectedNodeIds.includes(scene.id)
                            ? selectedNodeIds.filter((id) => id !== scene.id)
                            : [...selectedNodeIds, scene.id];
                          setSelectedNodeIds(next);
                          setSelectedNodeId(next[next.length - 1] ?? scene.id);
                          setRewriteScope(
                            next.length > 1 ? "selected-scenes" : defaultScreenplayScope(scene),
                          );
                          return;
                        }
                        setSelectedNodeId(scene.id);
                        setSelectedNodeIds([scene.id]);
                        setScenesOpen(false);
                        setRewriteScope(defaultScreenplayScope(scene));
                        requestAnimationFrame(() => editor.current?.focus());
                      }}
                    >
                      <span className="mr-2 text-xs tabular-nums text-subtle">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {scene.slugline ?? scene.title}
                    </button>
                  </li>
                ))}
            </ol>
            {!scenes.length && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Scene headings appear here as the Fountain draft develops.
              </p>
            )}
          </div>
        </aside>
      )}
      <section className="writing-workbench-manuscript flex min-h-0 min-w-0 flex-col">
        <header className="screenplay-document-header flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="break-words font-display text-xl tracking-tight">
              {sceneOnly && activeScene
                ? activeScene.slugline || activeScene.title
                : "Full screenplay"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {sceneOnly && activeScene
                ? `Scene ${String(activeScene.order + 1).padStart(2, "0")} of ${sceneNodes.length}`
                : `${scenes.length} scenes`}
              {" · "}
              {statusLabel(running ? "GENERATING" : screenplay.status)}
              {!running && " · Saved as you type"}
            </p>
          </div>
          <div className="screenplay-document-actions flex shrink-0 items-center gap-1">
            {sceneOnly && (
              <button
                type="button"
                className="screenplay-ps5-full-script"
                onClick={() => chooseScene("")}
              >
                Full script
              </button>
            )}
            <Button
              ref={sceneTrigger}
              variant="ghost"
              size="icon"
              aria-label="Scenes"
              title={`Scenes · ${scenes.length}`}
              aria-expanded={scenesOpen}
              aria-controls="screenplay-scene-list"
              onClick={() => {
                setCompactInspectorOpen(false);
                setScenesOpen((open) => !open);
              }}
            >
              <ListVideo />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="writing-workbench-desktop-inspector-toggle"
              aria-label={
                inspectorOpen || compactInspectorOpen
                  ? "Hide writing context"
                  : "Show writing context"
              }
              title={
                inspectorOpen || compactInspectorOpen
                  ? "Hide writing context"
                  : "Show writing context"
              }
              onClick={() => {
                setInspectorOpen(!(inspectorOpen || compactInspectorOpen));
                setCompactInspectorOpen(false);
              }}
            >
              {inspectorOpen || compactInspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
            <Button
              ref={inspectorTrigger}
              variant="ghost"
              size="icon"
              className="writing-workbench-compact-inspector-toggle"
              aria-label="Writing & versions"
              title="Writing & versions"
              aria-expanded={compactInspectorOpen}
              aria-controls="screenplay-writing-inspector"
              onClick={() => {
                setScenesOpen(false);
                setCompactInspectorOpen(true);
              }}
            >
              <SlidersHorizontal />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Save revision"
              title="Save revision"
              disabled={running || !screenplay.workingFountain.trim()}
              onClick={onSaveRevision}
            >
              <Save />
            </Button>
            <Button
              variant={screenplay.status === "APPROVED" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Approve screenplay"
              title={
                screenplay.status === "APPROVED" ? "Screenplay approved" : "Approve screenplay"
              }
              disabled={
                running || !screenplay.workingFountain.trim() || screenplay.status === "APPROVED"
              }
              onClick={onApprove}
            >
              <Check />
            </Button>
            {running && (
              <Button
                variant="rec"
                size="icon"
                aria-label="Stop generation"
                title="Stop generation"
                onClick={onStop}
              >
                <Square />
              </Button>
            )}
          </div>
        </header>
        {running && (
          <p className="px-4 pb-2 text-xs text-muted sm:px-6" role="status">
            {job?.activeLabel ?? generation?.activeLabel ?? "Writing screenplay…"}
          </p>
        )}
        {job?.error && (
          <p role="alert" className="px-4 pb-2 text-xs text-rec sm:px-6">
            {job.error}
          </p>
        )}
        <div className="screenplay-editor-surface min-h-0 flex-1 p-4 sm:p-6">
          <StoryDoctorActivity picture={picture} />
          <AssetRunActivity pictureId={picture.id} />
          <Textarea
            ref={editor}
            aria-label="Fountain screenplay"
            className="screenplay min-h-0 resize-none bg-inset font-mono leading-relaxed"
            value={editorText}
            readOnly={running}
            onChange={(event) => {
              const text = event.target.value;
              onTextChange(
                sceneOnly && activeScene
                  ? replaceScreenplayEditorScene(shownText, activeScene, text)
                  : replaceScreenplayEditorScene(
                      shownText,
                      { sourceStart: 0, sourceEnd: shownText.length },
                      text,
                    ),
              );
            }}
            onSelect={(event) => {
              const start = event.currentTarget.selectionStart ?? 0;
              const end = event.currentTarget.selectionEnd ?? 0;
              if (end > start) {
                setSelection({
                  start: textareaOffsetToSource(editorText, start) + editorOffset,
                  end: textareaOffsetToSource(editorText, end) + editorOffset,
                });
                setRewriteScope("selected-text");
              } else {
                setSelection(null);
              }
            }}
            placeholder="Your Fountain screenplay will appear here."
          />
        </div>
      </section>
      {(inspectorOpen || compactInspectorOpen) && (
        <div
          id="screenplay-writing-inspector"
          className="writing-workbench-inspector"
          aria-label="Writing context"
        >
          <div className="screenplay-mobile-inspector-close">
            <Button
              variant="ghost"
              onClick={() => {
                setCompactInspectorOpen(false);
                requestAnimationFrame(() => inspectorTrigger.current?.focus());
              }}
            >
              <ChevronLeft />
              Back to screenplay
            </Button>
          </div>
          {inspectorContent}
        </div>
      )}
      <nav className="screenplay-ps5-scene-rail" aria-label="Screenplay scenes">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous screenplay scene"
          disabled={sceneIndex <= 0}
          onClick={() => chooseScene(sceneNodes[sceneIndex - 1]?.id ?? "")}
        >
          <ChevronLeft size={18} />
        </Button>
        <div className="screenplay-ps5-scene-track">
          {sceneNodes.map((scene, index) => {
            const artwork = sceneArtwork(picture, scene.id, bundledMediaMap);
            return (
              <button
                type="button"
                key={scene.id}
                aria-current={sceneOnly && activeScene?.id === scene.id ? "true" : undefined}
                aria-label={`Scene ${index + 1}: ${scene.slugline || scene.title}`}
                onClick={() => chooseScene(scene.id)}
                title={scene.slugline || scene.title}
              >
                <span className="screenplay-ps5-scene-art">
                  {artwork ? (
                    <AssetImagePreview
                      previewUri={artwork}
                      mediaUri={artwork}
                      alt=""
                      className="screenplay-ps5-scene-image"
                      compact
                    />
                  ) : (
                    <span className="screenplay-ps5-unframed" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  )}
                </span>
                <span>
                  {String(index + 1).padStart(2, "0")} ·{" "}
                  {sceneRailLabel(scene.slugline || scene.title, index)}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next screenplay scene"
          disabled={sceneIndex >= sceneNodes.length - 1}
          onClick={() => chooseScene(sceneNodes[sceneIndex + 1]?.id ?? "")}
        >
          <ChevronRight size={18} />
        </Button>
        {selectedNodeIds.length > 1 && (
          <span className="screenplay-ps5-selected">{selectedNodeIds.length} selected</span>
        )}
      </nav>
    </div>
  );
}

function SceneBibleFieldEditor({
  picture,
  sceneId,
  field,
  onClose,
}: {
  picture: Picture;
  sceneId: string;
  field: string;
  onClose: () => void;
}) {
  const saved = picture.movieBible?.records[sceneId]?.fields[field];
  const initial: BibleFieldEdit = {
    recordId: sceneId,
    kind: "scene",
    field,
    value: saved?.value ?? "",
    source: saved?.source ?? "",
    disposition: saved?.disposition ?? "authored",
    baseRevision: saved?.revision ?? 0,
  };
  const draftKey = `screenplay-scene-bible-draft:${sceneId}:${field}`;
  const [draft, setDraft] = useWorkspaceDraft<BibleFieldEdit | null>(draftKey, null);
  const edit = draft ?? initial;
  const [error, setError] = useState("");
  const change = (patch: Partial<BibleFieldEdit>) => {
    setDraft({ ...edit, ...patch });
    setError("");
  };
  const save = () => {
    try {
      const store = useStudio.getState();
      const latest = store.pictures.find((item) => item.id === picture.id);
      if (!latest || store.activeId !== picture.id)
        throw new Error("The active picture has changed.");
      const updated = applyCharacterFieldEdit(latest, edit);
      store.replaceActive({
        ...updated,
        editorDrafts: { ...updated.editorDrafts, [draftKey]: null },
      });
      toast.success("Scene direction saved to the Bible.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save scene direction.");
    }
  };

  return (
    <div className="screenplay-ps5-bible-editor">
      <label>
        Status
        <select
          value={edit.disposition}
          onChange={(event) =>
            change({ disposition: event.target.value as BibleFieldEdit["disposition"] })
          }
        >
          <option value="authored">Authored direction</option>
          <option value="not-applicable">Not applicable</option>
          <option value="missing">Missing / unresolved</option>
        </select>
      </label>
      <label>
        {edit.disposition === "not-applicable" ? "Scoped reason" : "Direction"}
        <Textarea
          rows={5}
          value={edit.value}
          onChange={(event) => change({ value: event.target.value })}
        />
      </label>
      <label>
        Source or direction note
        <Input
          value={edit.source}
          placeholder="Source record, passage, or authored direction"
          onChange={(event) => change({ source: event.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="screenplay-ps5-bible-editor-actions">
        <Button size="sm" onClick={save}>
          Save direction
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Keep draft
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(initial)}>
          Reset to saved
        </Button>
      </div>
    </div>
  );
}
