import { CabinetModal } from "./cabinet";
import { PromptPayloadPreview } from "./prompt-payload-preview";
import { EditorialClipEditor } from "./editorial-clip-editor";
import { ImageIterationReview } from "./image-iteration-review";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { EmotionPerformancePanel } from "@/components/performance/emotion-performance-panel";
import { storyDoctorRuns } from "@/lib/studio/story-doctor-runs";
import { exactLocalWriterBlock } from "@/lib/studio/exact-local-writer";
import { explicitMoviePlanServedId } from "@/lib/studio/movie-plan-model";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  SlidersHorizontal,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  buildAllExports,
  buildCueSheet,
  buildEdl,
  buildFountain,
  buildProjectJson,
  buildPromptPack,
  buildShotList,
} from "@/lib/studio/export";
import { engineById } from "@/lib/studio/engines";
import { MODEL_ROOT, type Picture } from "@/lib/studio/types";
import { AdvancedDepartmentsDashboard, AdvancedDepartmentsRail } from "./advanced-departments";
import { MoviePlanActivity } from "./movie-plan-activity";
import { GeneratedAssetsReview } from "./generated-assets-review";
import { NativeFilmPanel } from "./native-film-panel";
import { SpeechReviewPanel } from "./speech-review-panel";
import { MovieAssemblyPanel } from "./movie-assembly-panel";
import { DirectorVideoPanel } from "./director-video-panel";
import { VideoGenerationOptions } from "./video-generation-options";
import { AudioGenerationOptions } from "./audio-generation-options";
import { VoiceDesignWorkspace } from "./voice-design-workspace";
import type { MoviePlanProgress } from "@/lib/studio/movie-plan-stream.ts";
import { isAdvancedDashboard } from "@/lib/studio/advanced-departments.ts";
import {
  DEFAULT_NAV_STEPS,
  allPhaseReviewsOn,
  hydrateProductFlow,
  type InternalPhase,
} from "@/lib/studio/product-flow.ts";
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  MANUAL_FALLBACK_LABEL,
} from "@/lib/studio/movie-plan-pipeline.ts";
import {
  executeResearchDraftOnServer,
  releaseMoviePlanWriterForImages,
} from "@/lib/studio/movie-plan-client.ts";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import { useDirector } from "@/lib/studio/use-director";
import {
  compileEnginePromptPackage,
  compilePicture,
  totalDuration,
} from "@/lib/studio/prompt-compiler";
import {
  desktopApproveCanonicalImage,
  desktopAuthorizePreparedImage,
  desktopExportLite,
  desktopExportPlus,
  desktopGeneratePreparedImage,
  desktopImageManifests,
  desktopImportAudio,
  desktopImportVideo,
  desktopMediaDiscover,
  desktopOpenExportFolder,
  desktopProductionAuthorityStatus,
  desktopRejectCanonicalImage,
  desktopSaveMany,
  isDesktopApp,
} from "@/lib/desktop/client";
import type { ImageComponentManifest } from "@/lib/studio/image-component-resolver.server.ts";
import { runtimeDefaults } from "@/lib/studio/engine-controls.ts";
import { cn, copyText, formatTimecode, saveReadyFile, uid, type ReadyFile } from "@/lib/utils";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { ProductionProfileControls } from "./production-profile-controls";
import { BibleRunWorkspace } from "./bible-run-workspace";
import { SoundCueEditor } from "./sound-cue-editor";
import { ShotContinuityEditor } from "./shot-continuity-editor";
import { MovieBibleEditor } from "./movie-bible-editor";
import { CharacterWorkspace } from "./character-workspace";
import { RenderContextEditor } from "./render-context-editor";
import { VisualDirectionField } from "./visual-direction-field";
import { SOURCE_TYPE_LABELS } from "@/lib/studio/picture-intake";
import type { ScreenplayModelRef } from "@/lib/studio/screenplay";
import {
  addManualScreenplayVersion,
  approveCurrentScreenplay,
  restoreScreenplayVersion,
} from "@/lib/studio/screenplay";
import type { ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import type { ScreenplayJobSnapshot } from "@/lib/studio/screenplay-jobs.server";
import {
  beginScreenplayJob,
  beginScreenplayQa,
  localLLMStatus,
  readScreenplayJob,
  releaseLocalScreenplayModel,
  stopScreenplayJob,
} from "@/lib/studio/screenplay-client";
import { ScreenplayWorkspace } from "./screenplay-workspace";
import { ImportedPackageResources } from "./imported-package-resources";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import {
  hydratePictureResearch,
  isResearchApproved,
  researchBlocksScreenplay,
} from "@/lib/research/bible.ts";
import { qwenWriterBlockReason } from "@/lib/studio/qwen-writer-identity.ts";
import {
  canonicalSpecHash,
  hydratePromptLabState,
  promptLabRuntimeBlock,
} from "@/lib/studio/prompt-lab.ts";
import { videoEngineFromSelection } from "@/lib/studio/generation-config.ts";
import { videoRuntimeBlock } from "@/lib/studio/video-runtime.ts";
import {
  musicEngineFromSelection,
  musicRuntimeBlock,
  voiceEngineFromSelection,
  voiceRuntimeBlock,
} from "@/lib/studio/audio-runtime.ts";
import { movieReadiness } from "@/lib/studio/movie-readiness.ts";
import { guidedNextStage, movieLifecycle } from "@/lib/studio/movie-lifecycle.ts";
import {
  planLiteImportedExport,
  planPictureExport,
  planPlusImportedExport,
} from "@/lib/studio/ffmpeg-export.ts";
import { buildTimelinePlan, importedCanonicalFilm } from "@/lib/studio/timeline-plan.ts";
import { resolveShotPacket, shotPacketFreshness } from "@/lib/studio/resolved-shot-packet";
import {
  nextShotForImport,
  recordImportedVideoTake,
  reviewVideoTake,
  shotVideoReadiness,
} from "@/lib/production/video-iterations.ts";
import {
  failClosedKeyframe,
  generateGateReadiness,
  hydrateGenerateGates,
  savePromptVersion,
  waiveKeyframePair,
} from "@/lib/production/generate-gates.ts";
import { hydrateVideoWorkspace } from "@/lib/production/video-types.ts";
import {
  hydratePictureAudio,
  queueMissingDialogue,
  queueMissingScore,
  recordImportedAudioTake,
  reviewAudioTake,
} from "@/lib/production/audio-iterations.ts";
import { hydrateAudioWorkspace } from "@/lib/production/audio-types.ts";
import {
  DEFAULT_CREW_WRITER_DISPLAY,
  OPTIONAL_CREW_WRITER_DISPLAY,
} from "@/lib/studio/model-routing.ts";
import type { ScreenplayRewriteTarget, ScreenplayScope } from "@/lib/studio/screenplay-scope.ts";
import { isLlamaQaCandidate as isLlamaFamily } from "@/lib/studio/qwen-writer-identity.ts";
import { InventoryWorkspace } from "@/components/production/inventory-workspace";
import { VisualDevelopmentWorkspace } from "@/components/visual-development/visual-development-workspace";
import { hydrateVisualDevelopmentState } from "@/lib/visual-development";
import { CinematographyWorkspace } from "@/components/cinematography/cinematography-workspace";
import { hydrateCinematographyState } from "@/lib/cinematography";
import {
  approvedScreenplayInputFromBoundary,
  createResearchAwareProductionBreakdown,
  deterministicFountainExtractor,
  reconcileProductionBreakdown,
  runProductionBreakdown,
  appendGeneratedIteration,
  approveCanonicalIteration,
  deterministicContinuityFindings,
  reviewGeneratedIteration,
} from "@/lib/production";
import { approvedScreenplayBoundary } from "@/lib/studio/screenplay";
import { PerformanceWorkspaceView } from "@/components/performance/performance-workspace";
import { ShotPreparationWorkspace } from "@/components/performance/shot-workspace";
import { canonicalShotsToLegacy, migratePicturePerformance } from "@/lib/performance/persistence";
import { KeyframeImages } from "./keyframe-images";
import { approveKeyframeIteration } from "@/lib/production/generate-gates";
import { HERMES_MODEL_ID, hydrateProductionRouting } from "@/lib/studio/production-profiles";
import {
  bibleAuthoringContext,
  screenplaySourceContextFingerprint,
} from "@/lib/studio/movie-bible";

export function StageView() {
  const stage = useStage();
  const picture = useActivePicture();
  const uiMode = useStudio((state) => state.uiMode);
  const advancedSurface = useStudio((state) => state.advancedSurface);
  if (!picture) return null;
  if (isAdvancedDashboard(uiMode, advancedSurface)) return <AdvancedDepartmentsDashboard />;
  switch (stage) {
    case "intake":
      return <IntakeStage picture={picture} />;
    case "research":
      return <ResearchStage picture={picture} />;
    case "screenplay":
      return <ScreenplayStage picture={picture} />;
    case "inventory":
      return <InventoryStage picture={picture} />;
    case "visual-development":
      return <VisualDevelopmentStage picture={picture} />;
    case "cinematography":
      return <CinematographyStage picture={picture} />;
    case "performance":
      return <PerformanceStage picture={picture} />;
    case "shots":
      return <ShotsStage picture={picture} />;
    case "prompts":
      return <PromptStage picture={picture} />;
    case "generate":
      return <GenerateStage picture={picture} />;
    case "review":
      return <ReviewStage picture={picture} />;
    case "timeline":
      return <StitchStage picture={picture} />;
    case "score":
      return <ScoreStage picture={picture} />;
    case "export":
      return <ExportStage picture={picture} />;
    default:
      return null;
  }
}

function Pane({ title, kicker, children, tabs }: { title: string; kicker: string; children: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="stage-pane flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <header className="shrink-0 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">{kicker}</p>
        <h2
          className="mt-1 break-words font-display text-[clamp(1.5rem,3vw,1.875rem)] tracking-tight"
          title={title}
        >
          {title}
        </h2>
      </header>
      {tabs ? <div className="shrink-0 px-4 pb-3 sm:px-6">{tabs}</div> : null}
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 sm:px-6">
        {children}
      </div>
    </div>
  );
}

function IntakeStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const replaceActive = useStudio((state) => state.replaceActive);
  const flow = hydrateProductFlow(picture.productFlow);
  const openAdvancedDepartment = useStudio((state) => state.openAdvancedDepartment);
  const [building, setBuilding] = useState(false);
  const [directionBusy, setDirectionBusy] = useState(false);
  const [activity, setActivity] = useState<MoviePlanProgress[]>([]);
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(null);
  const routing = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
    now: picture.updatedAt,
  });
  const patchIntake = <K extends keyof PictureIntake>(key: K, value: PictureIntake[K]) => {
    const intake = {
      ...picture.intake,
      [key]: value,
      ...(key === "targetRuntimeMinutes" ? { runtimeSource: "manual" as const } : {}),
      updatedAt: Date.now(),
    };
    patchActive({
      intake,
      ...(key === "title" ? { title: String(value) } : {}),
      ...(key === "logline" ? { logline: String(value) } : {}),
      ...(key === "genre" ? { genre: String(value) } : {}),
      ...(key === "tone" ? { tone: String(value) } : {}),
      ...(key === "targetRuntimeMinutes" ? { runtimeMinutes: Number(value) } : {}),
      ...(key === "directorNotes" ? { directorNotes: String(value) } : {}),
    });
  };

  async function runGuidedResearch() {
    if (directionBusy) return;
    if (routing.profileId !== "local-models") {
      toast.error(
        "Astra Ultra is selected, but no callable Astra provider is configured. No local fallback was started.",
      );
      return;
    }
    if (routing.executionMode !== "guided") {
      toast.error(
        "Autonomous complete-script orchestration is not implemented yet. No legacy pipeline was started.",
      );
      return;
    }
    setBuilding(true);
    setActivity([]);
    setActivityStartedAt(Date.now());
    const startedAt = Date.now();
    const activeRun = {
      id: uid("production-run"),
      profileId: routing.profileId,
      mode: routing.executionMode,
      profileRevision: routing.profileRevision,
      bindings: routing.bindings.map((binding) => ({ ...binding })),
      startedAt,
      status: "running" as const,
    };
    const runPicture: Picture = {
      ...picture,
      screenplay: {
        ...picture.screenplay,
        selectedModelId: `lmstudio:${HERMES_MODEL_ID}`,
        pinnedWriterServedId: HERMES_MODEL_ID,
        updatedAt: startedAt,
      },
      productFlow: { ...flow, reviewInternalPhases: true, reviewPhases: allPhaseReviewsOn() },
      productionRouting: { ...routing, activeRun, updatedAt: startedAt },
      updatedAt: startedAt,
    };
    replaceActive(runPicture);
    let latestPicture = runPicture;
    try {
      const result = await executeResearchDraftOnServer(
        runPicture,
        (next) => {
          latestPicture = next;
          replaceActive(next);
        },
        (event) =>
          setActivity((current) => [
            ...current.filter((item) => item.phase !== event.phase),
            event,
          ]),
      );
      const failed =
        !result.providerCalled ||
        result.flow.manualFallback ||
        result.flow.steps.some((step) => step.status === "failed");
      replaceActive({
        ...result.picture,
        productionRouting: {
          ...routing,
          activeRun: { ...activeRun, status: failed ? "failed" : "awaiting-review" },
          updatedAt: Date.now(),
        },
      });
      if (failed) {
        toast.error(
          result.flow.steps.find((step) => step.status === "failed")?.message ??
            CONFIGURED_MODEL_UNAVAILABLE,
        );
      } else {
        openAdvancedDepartment("research");
        toast.success("Hermes research draft is ready. The run stopped for your review.");
      }
    } catch (error) {
      replaceActive({
        ...latestPicture,
        productionRouting: {
          ...routing,
          activeRun: { ...activeRun, status: "failed" },
          updatedAt: Date.now(),
        },
      });
      toast.error(error instanceof Error ? error.message : CONFIGURED_MODEL_UNAVAILABLE);
    }
    setBuilding(false);
  }
  return (
    <Pane title="The brief" kicker="01 · Source & intent">
      <div className="intake-cabinet-grid">
        <div>
          <Label htmlFor="movie-idea">What are we making?</Label>
          <Textarea
            id="movie-idea"
            className="mt-1.5 min-h-32 text-base"
            value={picture.intake.concept || picture.intake.premise || picture.intake.logline}
            onChange={(event) => patchIntake("concept", event.target.value)}
            placeholder="2-minute fan-made live-action trailer for Xenogears, cinematic, photoreal…"
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Research comes before writing. For a historical adaptation, include source text or
            links, or request web research and name the source and period.
          </p>
        </div>
        <CabinetModal
          title="Script run"
          trigger={
            <Button className="intake-run-action">
              Create movie script <ArrowUpRight size={16} />
            </Button>
          }
        >
          <BibleRunWorkspace />
        </CabinetModal>
        <CabinetModal
          title="Visual direction"
          trigger={
            <Button className="intake-reference-action" variant="ghost">
              <ImagePlus size={17} /> Visual references
            </Button>
          }
        >
          <VisualDirectionField
            value={picture.intake.visualDirection}
            onChange={(value) => patchIntake("visualDirection", value)}
            disabled={building}
            onBusy={setDirectionBusy}
            writerId={picture.screenplay.pinnedWriterServedId ?? undefined}
          />
        </CabinetModal>

        {routing.profileId === "local-models" && routing.executionMode === "guided" && (
          <Button
            className="h-12 text-base"
            onClick={() => void runGuidedResearch()}
            disabled={
              building ||
              directionBusy ||
              routing.profileId !== "local-models" ||
              routing.executionMode !== "guided"
            }
            title={
              routing.profileId !== "local-models"
                ? "Configure an Astra provider or choose Local Models."
                : routing.executionMode !== "guided"
                  ? "Use Start autonomous complete script above."
                  : undefined
            }
          >
            {building ? "Running Hermes research…" : "Run guided research step"}
          </Button>
        )}
        {activityStartedAt !== null ? (
          <MoviePlanActivity events={activity} startedAt={activityStartedAt} running={building} />
        ) : null}
        {flow.manualFallback || flow.steps.some((step) => step.status === "failed") ? (
          <div
            className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
            data-movie-plan-blocked="true"
          >
            <p className="text-sm">
              {flow.steps.find((step) => step.status === "failed")?.message ??
                CONFIGURED_MODEL_UNAVAILABLE}
            </p>
            <p className="mt-2 text-xs text-muted">{MANUAL_FALLBACK_LABEL}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void localLLMStatus().then(
                    () => toast.message("Rescanned configured model."),
                    () => toast.error(CONFIGURED_MODEL_UNAVAILABLE),
                  )
                }
              >
                Rescan
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => toast.success("Intake draft is already saved on this picture.")}
              >
                Save Intake Draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openAdvancedDepartment("research")}>
                Open Manual Advanced Fallback
              </Button>
            </div>
          </div>
        ) : null}
        {flow.steps.length ? (
          <ul className="grid gap-1 text-sm text-muted">
            {flow.steps.map((step) => (
              <li key={step.id}>
                {step.status === "failed"
                  ? "! failed"
                  : step.status === "waitingForOptionalUserReview"
                    ? "⏸ paused"
                    : step.status === "draftReady"
                      ? "· generated"
                      : step.status}{" "}
                — {step.id}: {step.message}
              </li>
            ))}
          </ul>
        ) : null}
        <CabinetModal
          title="Source details"
          trigger={
            <Button className="intake-details-action" variant="ghost">
              <SlidersHorizontal size={17} /> Story settings
            </Button>
          }
        >
          <div className="mt-4 grid gap-5">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flow.thinkingEnabled === true}
                disabled={building}
                onChange={(event) =>
                  patchActive({ productFlow: { ...flow, thinkingEnabled: event.target.checked } })
                }
              />
              <span>Enable model thinking (slower, supported models only)</span>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flow.qaEnabled === true}
                disabled={building}
                onChange={(event) =>
                  patchActive({ productFlow: { ...flow, qaEnabled: event.target.checked } })
                }
              />
              <span>Run screenplay QA and corrections (slower)</span>
            </label>
            <p className="text-xs text-muted">
              QA reviews source fidelity and character psychology, then material culture and
              continuity, before the inventory is built.
            </p>
            <div>
              <Label htmlFor="intake-source-mode">Source mode</Label>
              <select
                id="intake-source-mode"
                className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]"
                value={picture.intake.sourceType}
                onChange={(event) => {
                  const sourceType = event.target.value as PictureIntake["sourceType"];
                  patchActive({
                    intake: {
                      ...picture.intake,
                      sourceType,
                      workflow:
                        sourceType === "biblical-historical"
                          ? "biblical-7-pass"
                          : picture.intake.workflow === "biblical-7-pass"
                            ? "single"
                            : picture.intake.workflow,
                      updatedAt: Date.now(),
                    },
                  });
                }}
              >
                {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                The original intake and every imported text source remain preserved in version
                history.
              </p>
            </div>
            <Field
              label="Title"
              value={picture.intake.title}
              onChange={(value) => patchIntake("title", value)}
            />
            <div>
              <Label>Logline</Label>
              <Textarea
                className="mt-1.5 min-h-24"
                value={picture.intake.logline}
                onChange={(event) => patchIntake("logline", event.target.value)}
              />
            </div>
            {picture.intake.sourceType === "concept" ? (
              <div>
                <Label>Premise</Label>
                <Textarea
                  className="mt-1.5 min-h-32"
                  value={picture.intake.premise}
                  onChange={(event) => patchIntake("premise", event.target.value)}
                />
              </div>
            ) : null}
            {picture.intake.sourceType === "treatment" ? (
              <div>
                <Label>Treatment / Outline</Label>
                <Textarea
                  className="mt-1.5 min-h-80"
                  value={picture.intake.treatment}
                  onChange={(event) => patchIntake("treatment", event.target.value)}
                />
              </div>
            ) : null}
            {picture.intake.sourceType === "existing-screenplay" ? (
              <div>
                <Label>Existing screenplay</Label>
                <Textarea
                  className="screenplay mt-1.5 min-h-[30rem]"
                  value={picture.intake.existingScreenplay}
                  onChange={(event) => patchIntake("existingScreenplay", event.target.value)}
                />
              </div>
            ) : null}
            {picture.intake.sourceType === "source-material" ? (
              <div>
                <Label>Source material</Label>
                <Textarea
                  className="mt-1.5 min-h-80"
                  value={picture.intake.sourceMaterial}
                  onChange={(event) => patchIntake("sourceMaterial", event.target.value)}
                />
              </div>
            ) : null}
            {picture.intake.sourceType === "biblical-historical" ? (
              <>
                <div>
                  <Label>Source passages / references</Label>
                  <Textarea
                    className="mt-1.5"
                    value={picture.intake.sourcePassages}
                    onChange={(event) => patchIntake("sourcePassages", event.target.value)}
                  />
                </div>
                <div>
                  <Label>Supplied Scripture / source text</Label>
                  <Textarea
                    className="mt-1.5 min-h-80"
                    value={picture.intake.suppliedSourceText}
                    onChange={(event) => patchIntake("suppliedSourceText", event.target.value)}
                  />
                </div>
                <div>
                  <Label>Fidelity requirements</Label>
                  <Textarea
                    className="mt-1.5"
                    value={picture.intake.fidelityRequirements}
                    onChange={(event) => patchIntake("fidelityRequirements", event.target.value)}
                  />
                </div>
              </>
            ) : null}
            {picture.intake.sourceType === "biblical-historical" ? (
              <>
                <Field
                  label="Historical period"
                  value={picture.intake.historicalPeriod}
                  onChange={(value) => patchIntake("historicalPeriod", value)}
                />
                <div>
                  <Label>Cultural and social world</Label>
                  <Textarea
                    className="mt-1.5"
                    value={picture.intake.culturalSocialWorld}
                    onChange={(event) => patchIntake("culturalSocialWorld", event.target.value)}
                  />
                </div>
                <div>
                  <Label>Permitted dramatization</Label>
                  <Textarea
                    className="mt-1.5"
                    value={picture.intake.materialMayDramatize}
                    onChange={(event) => patchIntake("materialMayDramatize", event.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Genre"
                value={picture.intake.genre}
                onChange={(value) => patchIntake("genre", value)}
              />
              <Field
                label="Runtime (min)"
                value={String(picture.intake.targetRuntimeMinutes)}
                onChange={(value) => patchIntake("targetRuntimeMinutes", Number(value) || 1)}
                type="number"
              />
            </div>
            <Field
              label="Tone"
              value={picture.intake.tone}
              onChange={(value) => patchIntake("tone", value)}
            />
            <div>
              <Label>Director notes</Label>
              <Textarea
                className="mt-1.5"
                value={picture.intake.directorNotes}
                onChange={(event) => patchIntake("directorNotes", event.target.value)}
              />
            </div>
          </div>
        </CabinetModal>
      </div>
    </Pane>
  );
}

function offlineDiscovery(reason: string): LocalLLMProviderDiscovery {
  return {
    providerId: "lm-studio",
    providerName: "LM Studio",
    endpoint: null,
    local: true,
    cloudFallback: false,
    available: false,
    reason,
    models: [],
    discoveredAt: Date.now(),
  };
}

function ResearchStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const replaceActive = useStudio((state) => state.replaceActive);
  const [building, setBuilding] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const bible = hydratePictureResearch(picture.research, picture.intake);
  const researchProfile = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
  });
  const researchBinding = researchProfile.bindings.find((binding) => binding.role === "architect");
  // The local served-model check does not describe Astra availability.
  const llamaAvailable = researchProfile.profileId === "astra-ultra"
    ? null
    : Boolean(researchBinding?.callableModelId && ["installed", "loaded"].includes(researchBinding.status));
  const scan = useCallback(async () => {
    toast.info(
      "Refresh availability in the production profile controls above. No alternate model is used.",
    );
  }, []);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>Profile · {researchBinding?.label ?? "unconfigured"}</Button>
      </div>
      {profileOpen && <div className="research-profile-panel" aria-label="Research production profile"><ProductionProfileControls picture={picture} disabled={building} /></div>}
      <div className="min-h-0 flex-1"><ResearchWorkspace
        title={picture.title}
        bible={bible}
        llamaAvailable={llamaAvailable}
        characters={picture.characters}
        locations={picture.locations}
        building={building}
        onRescan={() => void scan()}
        onChange={(research) => patchActive({ research })}
        onBuildDraft={async () => {
          setBuilding(true);
          try {
            let expected = screenplaySourceContextFingerprint(picture);
            const saveCurrent = (next: Picture) => {
              const current = useStudio.getState().pictures.find((item) => item.id === picture.id);
              if (!current || screenplaySourceContextFingerprint(current) !== expected)
                throw new Error(
                  "Research sources or profile changed during generation. Late output was not applied.",
                );
              replaceActive(next);
              expected = screenplaySourceContextFingerprint(next);
            };
            const result = await executeResearchDraftOnServer(picture, saveCurrent);
            saveCurrent(result.picture);
            if (!result.providerCalled) {
              toast.error(
                result.flow.steps.find((step) => step.status === "failed")?.message ??
                  CONFIGURED_MODEL_UNAVAILABLE,
              );
              return;
            }
            toast.success("Research Bible generated.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : CONFIGURED_MODEL_UNAVAILABLE);
          } finally {
            setBuilding(false);
          }
        }}
      /></div>
    </div>
  );
}

function ScreenplayStage({ picture }: { picture: Picture }) {
  const profile = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
  });
  const patchActive = useStudio((state) => state.patchActive);
  const [models, setModels] = useState<ScreenplayModelRef[]>([]);
  const [provider, setProvider] = useState<LocalLLMProviderDiscovery | null>(null);
  const [job, setJob] = useState<ScreenplayJobSnapshot | null>(null);
  const [jobId, setJobId] = useState<string | null>(
    picture.screenplay.status === "GENERATING"
      ? (picture.screenplay.generation?.runId ?? null)
      : null,
  );

  const persistScreenplay = useCallback(
    (screenplay: Picture["screenplay"]) => {
      const state = useStudio.getState(),
        current = state.pictures.find((item) => item.id === picture.id);
      if (current)
        state.replaceActive({
          ...current,
          screenplay,
          screenplayFountain: screenplay.workingFountain,
        });
    },
    [picture.id],
  );

  const scan = useCallback(async () => {
    setProvider(null);
    try {
      const status = await localLLMStatus();
      setProvider(status.provider);
      setModels(status.models);
    } catch (error) {
      setModels([]);
      setProvider(
        offlineDiscovery(
          error instanceof Error ? error.message : "LM Studio local API is unavailable.",
        ),
      );
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const snapshot = await readScreenplayJob(jobId);
        if (disposed) return;
        if (!snapshot) {
          setJobId(null);
          persistScreenplay({
            ...picture.screenplay,
            status: picture.screenplay.approvedVersionId
              ? "APPROVED"
              : picture.screenplay.workingFountain.trim()
                ? "READY_FOR_REVIEW"
                : "DRAFT",
            generation: null,
          });
          toast.message(
            "The previous screenplay job is no longer active. Your saved screenplay is retained.",
          );
          return;
        }
        const current = useStudio.getState().pictures.find((item) => item.id === picture.id);
        if (
          snapshot.sourceContextFingerprint &&
          (!current ||
            screenplaySourceContextFingerprint(current) !== snapshot.sourceContextFingerprint)
        ) {
          void stopScreenplayJob(jobId);
          setJobId(null);
          toast.error(
            "Screenplay sources or profile changed. The obsolete response was not applied; start a revision from current sources.",
          );
          if (current)
            persistScreenplay({
              ...current.screenplay,
              status: current.screenplay.approvedVersionId ? "APPROVED" : "READY_FOR_REVIEW",
              generation: null,
            });
          return;
        }
        setJob(snapshot);
        persistScreenplay(snapshot.screenplay);
        if (snapshot.status === "queued" || snapshot.status === "running")
          timer = setTimeout(() => void poll(), 300);
      } catch (error) {
        if (!disposed) {
          setJob((current) =>
            current
              ? {
                  ...current,
                  status: "failed",
                  error: error instanceof Error ? error.message : String(error),
                }
              : current,
          );
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, persistScreenplay]);

  const start = async (
    options: {
      resume?: boolean;
      stepId?: ScreenplayStep["id"];
      target?: ScreenplayRewriteTarget;
      applyQa?: boolean;
    } = {},
  ) => {
    const research = hydratePictureResearch(picture.research, picture.intake);
    const blockedResearch = researchBlocksScreenplay(research);
    if (blockedResearch) {
      toast.error(blockedResearch);
      return;
    }
    const productionBinding = profile.bindings.find(
      (binding) =>
        binding.role ===
        (options.applyQa || options.stepId || picture.screenplay.workingFountain.trim()
          ? "rewrite"
          : "writer"),
    );
    if (
      !productionBinding?.callableModelId ||
      ["unavailable", "needs-verification", "needs-refresh"].includes(productionBinding.status)
    ) {
      toast.error(
        productionBinding?.statusReason ?? "Refresh the production profile before writing.",
      );
      return;
    }
    const writerId = productionBinding.callableModelId,
      modelId = writerId;
    try {
      const initial = await beginScreenplayJob({
        sourceContextFingerprint: screenplaySourceContextFingerprint(picture),
        productionBinding,
        generationInstructions: JSON.stringify(bibleAuthoringContext(picture)),
        intake: picture.intake,
        screenplay: {
          ...picture.screenplay,
          selectedModelId: modelId,
          pinnedWriterServedId: writerId,
        },
        research,
        modelId,
        revisionInstructions: options.applyQa
          ? JSON.stringify(picture.screenplay.lastQaReport?.findings ?? [])
          : undefined,
        resume: options.resume,
        stepId: options.stepId,
        rewriteScope: options.target?.scope,
        selectedNodeId: options.target?.nodeId ?? null,
        selectedNodeIds: options.target?.nodeIds ?? null,
        selection: options.target?.selection ?? null,
      });
      const current = useStudio.getState().pictures.find((item) => item.id === picture.id);
      if (
        !current ||
        current.screenplay.workingFountain !== picture.screenplay.workingFountain ||
        screenplaySourceContextFingerprint(current) !== screenplaySourceContextFingerprint(picture)
      ) {
        await stopScreenplayJob(initial.id);
        throw new Error(
          "Sources changed while the writing request started. Existing text was preserved.",
        );
      }
      setJob(initial);
      setJobId(initial.id);
      persistScreenplay({
        ...picture.screenplay,
        selectedModelId: modelId,
        status: "GENERATING",
        updatedAt: Date.now(),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to start local screenplay generation.",
      );
      void scan();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto sm:overflow-hidden">
      {picture.importedPackage ? (
        <div className="shrink-0 px-4 pt-3">
          <ImportedPackageResources importedPackage={picture.importedPackage} />
        </div>
      ) : null}
      <div className="min-h-[40rem] flex-1 overflow-hidden sm:min-h-0">
        <ScreenplayWorkspace
          picture={picture}
          intake={picture.intake}
          screenplay={picture.screenplay}
          models={models}
          provider={provider}
          job={job}
          onTextChange={(workingFountain) =>
            persistScreenplay({
              ...picture.screenplay,
              workingFountain,
              status: picture.screenplay.approvedVersionId
                ? picture.screenplay.status
                : "READY_FOR_REVIEW",
              updatedAt: Date.now(),
            })
          }
          onSaveRevision={() =>
            persistScreenplay(
              addManualScreenplayVersion(
                picture.screenplay,
                picture.screenplay.workingFountain,
                uid("spv"),
              ),
            )
          }
          onGenerate={(target) => void start({ target })}
          onContinue={(target) => void start({ resume: true, target })}
          onApplyQaRecommendations={(target) => void start({ target, applyQa: true })}
          onRegeneratePass={(stepId, target) => void start({ stepId, target })}
          researchApproved={isResearchApproved(
            hydratePictureResearch(picture.research, picture.intake),
          )}
          onStop={() => {
            const activeJobId = jobId ?? picture.screenplay.generation?.runId;
            if (!activeJobId) return;
            void stopScreenplayJob(activeJobId)
              .then((snapshot) => {
                setJob(snapshot);
                setJobId(null);
                persistScreenplay(
                  snapshot?.screenplay ?? {
                    ...picture.screenplay,
                    status: picture.screenplay.approvedVersionId ? "APPROVED" : "READY_FOR_REVIEW",
                    generation: null,
                  },
                );
              })
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : "Could not stop generation."),
              );
          }}
          onRestore={(versionId) =>
            persistScreenplay(restoreScreenplayVersion(picture.screenplay, versionId, uid("spv")))
          }
          onApprove={() =>
            persistScreenplay(approveCurrentScreenplay(picture.screenplay, uid("spv")))
          }
          onRescan={() => void scan()}
          onModelChange={(selectedModelId) => {
            const chosen = models.find((model) => model.id === selectedModelId) ?? null;
            const intake = {
              ...picture.intake,
              screenplayModelId: selectedModelId,
              updatedAt: Date.now(),
            };
            persistScreenplay({
              ...picture.screenplay,
              selectedModelId,
              pinnedWriterServedId: chosen?.servedModelId ?? null,
              pinnedQaServedId:
                chosen && isLlamaFamily(chosen)
                  ? (picture.screenplay.pinnedQaServedId ?? chosen.servedModelId)
                  : picture.screenplay.pinnedQaServedId,
              updatedAt: Date.now(),
            });
            patchActive({ intake });
          }}
          onQaPin={(servedModelId) =>
            persistScreenplay({
              ...picture.screenplay,
              pinnedQaServedId: servedModelId,
              updatedAt: Date.now(),
            })
          }
          onReleaseResident={() => {
            void releaseLocalScreenplayModel()
              .then(() =>
                toast.message(
                  "Local model claim released. Premiere316 did not auto-load a replacement.",
                ),
              )
              .catch((error) =>
                toast.error(
                  error instanceof Error ? error.message : "Unable to release local model.",
                ),
              );
          }}
          onApplyQaRevision={(next) => {
            persistScreenplay(next);
            toast.success("Scoped revision appended. Prior approved Fountain is preserved.");
          }}
          onStoryDoctor={(modelId, target, secondOpinion) => {
            const productionBinding = profile.bindings.find(
              (binding) => binding.role === (secondOpinion ? "challenger" : "reviewer"),
            );
            if (
              !productionBinding?.callableModelId ||
              ["unavailable", "needs-verification", "needs-refresh"].includes(
                productionBinding.status,
              )
            ) {
              toast.error(
                productionBinding?.statusReason ??
                  "Refresh the production profile before critique.",
              );
              return;
            }
            const writerPin = explicitMoviePlanServedId(picture)?.replace(/^lmstudio:/, "") ?? null;
            const writer =
              models.find((model) => model.id === picture.screenplay.selectedModelId) ?? null;
            void storyDoctorRuns
              .run(picture.id, modelId.replace(/^lmstudio:/, ""), (progress) =>
                beginScreenplayQa(
                  {
                    productionBinding,
                    generationInstructions: JSON.stringify(bibleAuthoringContext(picture)),
                    fountain: picture.screenplay.workingFountain,
                    modelId,
                    writerId: writerPin ?? picture.screenplay.selectedModelId,
                    pinnedQaServedId: picture.screenplay.pinnedQaServedId ?? writerPin,
                    secondOpinion,
                    goal: picture.intake.logline || picture.intake.premise || picture.title,
                    revisionTarget: target.scope,
                    rewriteScope: target.scope,
                    selectedNodeId: target.nodeId,
                    selectedNodeIds: target.nodeIds,
                    selection: target.selection,
                    characterState: picture.characters.map((item) => item.name).join(", "),
                    directorNotes: picture.intake.directorNotes,
                    research: hydratePictureResearch(picture.research, picture.intake),
                  },
                  progress,
                ),
              )
              .then((report) => {
                const current = useStudio
                  .getState()
                  .pictures.find((item) => item.id === picture.id);
                if (
                  !current ||
                  current.screenplay.workingFountain !== picture.screenplay.workingFountain ||
                  screenplaySourceContextFingerprint(current) !==
                    screenplaySourceContextFingerprint(picture)
                )
                  throw new Error(
                    "Sources changed during critique. The obsolete result was not applied.",
                  );
                persistScreenplay({
                  ...picture.screenplay,
                  lastQaReport: {
                    id: report.id,
                    createdAt: report.createdAt,
                    modelId: report.model.id,
                    servedModelId: report.model.servedModelId,
                    displayName: report.model.displayName,
                    findings: report.findings,
                    fountainUnchanged: true,
                  },
                  updatedAt: Date.now(),
                });
                toast.message(
                  report.findings[0]?.summary ||
                    "Story Doctor critique ready. Fountain was not changed.",
                );
              })
              .catch((error) => {
                if (storyDoctorRuns.get(picture.id)?.status !== "stopped")
                  toast.error(
                    error instanceof Error ? error.message : "Story Doctor failed closed.",
                  );
              });
          }}
        />
      </div>
    </div>
  );
}

function InventoryStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const setGenerateFocus = useStudio((state) => state.setGenerateFocus);
  const [busy, setBusy] = useState(false);
  const [surface, setSurface] = useWorkspaceDraft("asset-workspace-view", "library");
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">PRODUCTION ASSETS</p>
          <h2>Assets & iterations</h2>
        </div>
        <div className="workspace-tabs" aria-label="Asset workspace">
          <button aria-pressed={surface === "library"} onClick={() => setSurface("library")}>
            Library
          </button>
          <button
            aria-pressed={surface === "preparation"}
            onClick={() => setSurface("preparation")}
          >
            Specification & preparation
          </button>
        </div>
      </header>
      {surface === "library" && picture.production ? (
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <GeneratedAssetsReview picture={picture} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <InventoryWorkspace
            boundary={boundary}
            record={picture.production ?? null}
            busy={busy}
            onRunBreakdown={async (approved) => {
              setBusy(true);
              try {
                const extracted = await runProductionBreakdown(
                  approvedScreenplayInputFromBoundary(approved),
                  deterministicFountainExtractor,
                );
                const withResearch = createResearchAwareProductionBreakdown({
                  screenplay: approved,
                  research: hydratePictureResearch(picture.research, picture.intake),
                  drafts: extracted.requirements,
                });
                if ("error" in withResearch) throw new Error(withResearch.error);
                const production = picture.production
                  ? reconcileProductionBreakdown(picture.production, withResearch)
                  : withResearch;
                patchActive({ production });
                toast.success(`Production breakdown ready · ${production.assets.length} assets`);
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Unable to build production inventory.",
                );
              } finally {
                setBusy(false);
              }
            }}
            visualApprovals={
              picture.visualDevelopment?.approvals.map((approval) => approval.id) ?? []
            }
            cinematographyApprovals={
              picture.cinematography?.approvals.map((approval) => approval.id) ?? []
            }
            onChange={(production) => patchActive({ production })}
          />
        </div>
      )}
    </div>
  );
}

function VisualDevelopmentStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft<"sheets" | "visual">(
    "characters-workspace-view",
    "sheets",
  );
  const patchActive = useStudio((state) => state.patchActive);
  const visualDevelopment =
    picture.visualDevelopment ?? hydrateVisualDevelopmentState(null, picture);
  useEffect(() => {
    if (!picture.visualDevelopment) patchActive({ visualDevelopment });
  }, [patchActive, picture.visualDevelopment, visualDevelopment]);
  return surface === "sheets" ? (
    <CharacterWorkspace picture={picture} onVisual={() => setSurface("visual")} />
  ) : (
    <div className="workbench-frame p-4">
      <Button variant="ghost" onClick={() => setSurface("sheets")}>Back to character workspace</Button>
        <VisualDevelopmentWorkspace
          state={visualDevelopment}
          onChange={(visualDevelopment) => patchActive({ visualDevelopment })}
        />
    </div>
  );
}

function CinematographyStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft<"continuity" | "camera" | "sources">(
    "camera-workspace-view",
    "continuity",
  );
  const patchActive = useStudio((state) => state.patchActive);
  const visualDevelopment =
    picture.visualDevelopment ?? hydrateVisualDevelopmentState(null, picture);
  const cinematography = picture.cinematography ?? hydrateCinematographyState(null, picture);
  useEffect(() => {
    if (!picture.visualDevelopment || !picture.cinematography)
      patchActive({ visualDevelopment, cinematography });
  }, [
    patchActive,
    picture.visualDevelopment,
    picture.cinematography,
    visualDevelopment,
    cinematography,
  ]);
  return (
    <div className="workbench-frame">
      <div className="workbench-switcher">
        <Button
          variant={surface === "continuity" ? "primary" : "secondary"}
          onClick={() => setSurface("continuity")}
        >
          Geography & continuity
        </Button>
        <Button
          variant={surface === "camera" ? "primary" : "secondary"}
          onClick={() => setSurface("camera")}
        >
          Cinematography
        </Button>
        <Button variant={surface === "sources" ? "primary" : "secondary"} onClick={() => setSurface("sources")}>Source geography</Button>
      </div>
      <div className="workbench-content">
      {surface === "continuity" ? (
        <ShotContinuityEditor />
      ) : surface === "sources" ? (
          <MovieBibleEditor
            kinds={["scene", "shot", "location"]}
            title="Camera & geography sources"
          />
      ) : (
        <CinematographyWorkspace
          state={cinematography}
          visual={visualDevelopment}
          onChange={(cinematography) => patchActive({ cinematography })}
        />
      )}
      </div>
    </div>
  );
}

function PerformanceStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft<"direction" | "emotion">("performance-surface", "direction");
  const patchActive = useStudio((state) => state.patchActive);
  const setStage = useStudio((state) => state.setStage);
  const workspace = picture.performance ?? migratePicturePerformance(picture);

  useEffect(() => {
    if (!picture.performance && workspace) patchActive({ performance: workspace });
  }, [patchActive, picture.performance, workspace]);

  if (!workspace) {
    return (
      <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center">
        <div className="max-w-md">
          <p className="text-[11px] tracking-wide text-subtle uppercase">
            07 · Performance direction
          </p>
          <h2 className="mt-1 font-display text-2xl tracking-tight">
            Approve the screenplay first
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Performance work begins from the immutable approved screenplay, never a working draft.
          </p>
        </div>
      </div>
    );
  }

  const characters =
    picture.production?.assets
      .filter((asset) => asset.category === "character")
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        detail: asset.canonicalSpec.performanceNotes,
      })) ??
    picture.characters.map((character) => ({
      id: character.id,
      name: character.name,
      detail: character.role,
    }));

  return (
    <div className="workbench-frame">
      <div className="workbench-switcher">
        <Button variant={surface === "direction" ? "primary" : "secondary"} onClick={() => setSurface("direction")}>Performance direction</Button>
        <Button variant={surface === "emotion" ? "primary" : "secondary"} onClick={() => setSurface("emotion")}>Emotion & voice</Button>
      </div>
      <div className="workbench-content">
        {surface === "emotion" ? <EmotionPerformancePanel picture={picture} /> : <PerformanceWorkspaceView
          workspace={workspace}
          characters={characters}
          onChange={(performance) =>
            patchActive({
              performance,
              shots: canonicalShotsToLegacy(performance.shots, picture.shots),
            })
          }
          onOpenShots={() => setStage("shots")}
        />}
      </div>
    </div>
  );
}

function ShotsStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const setStage = useStudio((state) => state.setStage);
  const setGenerateFocus = useStudio((state) => state.setGenerateFocus);
  const workspace = picture.performance ?? migratePicturePerformance(picture);

  useEffect(() => {
    if (!picture.performance && workspace) patchActive({ performance: workspace });
  }, [patchActive, picture.performance, workspace]);

  if (!workspace) {
    return (
      <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center">
        <div className="max-w-md">
          <p className="text-[11px] tracking-wide text-subtle uppercase">08 · Shot preparation</p>
          <h2 className="mt-1 font-display text-2xl tracking-tight">
            Performance workspace required
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Approve the screenplay, then direct its beats before preparing coverage.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setGenerateFocus("keyframes", picture.shots[0]?.id ?? null)}
        >
          Open Generate / First-Last Frames
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ShotPreparationWorkspace
          workspace={workspace}
          frameWorkspace={picture.generateGates}
          assets={picture.production?.assets ?? []}
          onChange={(performance) =>
            patchActive({
              performance,
              shots: canonicalShotsToLegacy(performance.shots, picture.shots),
            })
          }
          onBack={() => setStage("performance")}
          onOpenPromptLab={() => setStage("prompts")}
        />
      </div>
    </div>
  );
}

function PromptStage({ picture }: { picture: Picture }) {
  const setStage = useStudio((s) => s.setStage);
  const patchActive = useStudio((s) => s.patchActive);
  const [surface, setSurface] = useWorkspaceDraft("prompt-workspace-view", "global");
  const [selectedPromptShot, setSelectedPromptShot] = useWorkspaceDraft("prompt-selected-shot", "");
  const activePromptShot = picture.shots.find((shot) => shot.id === selectedPromptShot) ?? picture.shots[0];
  const lab = hydratePromptLabState(picture.promptLab);
  return (
    <Pane title="Prompts & render direction" kicker="FILM / SCENE / SHOT" tabs={<div className="workspace-tabs" aria-label="Prompt workspace">
        {[
          ["global", "Global & inherited look"],
          ["scene", "Scene context"],
          ["local", "Local shot direction"],
          ["execution", "Execution & payload"],
          ["compiler", "Saved prompts"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>
            {label}
          </button>
        ))}
      </div>}>

      <div hidden={surface !== "global"}>
        <RenderContextEditor />
      </div>
      <div hidden={surface !== "scene"}>
        <MovieBibleEditor kinds={["scene", "participant"]} title="Scene prompt context" />
      </div>
      <div hidden={surface !== "local"}>
        <ShotContinuityEditor />
      </div>
      <div hidden={surface !== "execution"}>
        <PromptPayloadPreview picture={picture} />
      </div>
      <div hidden={surface !== "compiler"}>
          <h3 className="mb-3 text-sm font-medium">Batch compiler & saved shot prompts</h3>
          <p className="mb-4 max-w-xl text-sm text-muted">
            Still dialect {engineById(picture.selectedEngine.image)?.name}. Motion dialect{" "}
            {engineById(picture.selectedEngine.video)?.name}. Editorial duration stays separate from
            executable clip limits.
          </p>
          <div className="mb-4 max-w-xl rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Prompt compiler</p>
            <select
              aria-label="Prompt compiler"
              className="mt-3 h-9 w-full rounded-sm bg-inset px-2 text-xs text-fg shadow-[var(--shadow-border)]"
              value="llama"
              onChange={() => patchActive({ promptLab: lab })}
            >
              <option value="llama">
                Deterministic selected-engine serializer · no model call
              </option>
            </select>
            <select
              aria-label="Alternate compiler"
              className="mt-2 h-9 w-full rounded-sm bg-inset px-2 text-xs text-fg shadow-[var(--shadow-border)]"
              value={lab.alternate}
              onChange={(event) =>
                patchActive({
                  promptLab: { ...lab, alternate: event.target.value === "qwen" ? "qwen" : "none" },
                })
              }
            >
              <option value="none">Alternate · None</option>
              <option value="qwen">Alternate · Qwen (explicit A/B only)</option>
            </select>
            <p className="mt-2 text-xs leading-relaxed text-muted">{promptLabRuntimeBlock()}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => {
                const compiled = compilePicture(picture);
                const drafts = compiled.shots.flatMap((shot) => {
                  const still = compileEnginePromptPackage({
                    picture: compiled,
                    shot,
                    target: "still",
                  });
                  const motion = compileEnginePromptPackage({
                    picture: compiled,
                    shot,
                    target: "video",
                  });
                  return [
                    {
                      id: `${shot.id}:still`,
                      family: "llama" as const,
                      engineId: still.engineTarget,
                      text: still.enginePrompt,
                      canonicalSpecHash: canonicalSpecHash(still),
                      createdAt: Date.now(),
                      logicalRole: "prompt-engineer" as const,
                      runtimeActivation: "gated-wave-5" as const,
                    },
                    {
                      id: `${shot.id}:video`,
                      family: "llama" as const,
                      engineId: motion.engineTarget,
                      text: motion.enginePrompt,
                      canonicalSpecHash: canonicalSpecHash(motion),
                      createdAt: Date.now(),
                      logicalRole: "prompt-engineer" as const,
                      runtimeActivation: "gated-wave-5" as const,
                    },
                  ];
                });
                patchActive({ shots: compiled.shots, promptLab: { ...lab, drafts } });
                toast.success(
                  "Deterministic serializer wrote still and motion drafts. No model or media runtime was invoked.",
                );
              }}
            >
              Compile drafts
            </Button>
            <Button
              className="mt-3 ml-2"
              size="sm"
              variant="ghost"
              disabled
              title={promptLabRuntimeBlock()}
            >
              A/B benchmark
            </Button>
          </div>
          <div className="grid gap-3">
            <label className="text-sm text-muted">Shot
              <select aria-label="Saved prompt shot" className="mt-2 block w-full rounded-lg bg-inset p-3 text-fg" value={activePromptShot?.id ?? ""} onChange={(event) => setSelectedPromptShot(event.target.value)}>
                {picture.shots.map((shot) => <option key={shot.id} value={shot.id}>{String(shot.index).padStart(2, "0")} · {shot.description}</option>)}
              </select>
            </label>
            {(activePromptShot ? [activePromptShot] : []).map((s) => (
              <article
                key={s.id}
                className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs text-subtle">
                    {String(s.index).padStart(2, "0")} · {s.type} · {s.durationSec}s
                  </h3>
                  <Badge>{s.emotion}</Badge>
                </div>
                <p className="mt-2 text-sm">{s.description}</p>
                <p className="mt-1 text-xs text-muted">Face: {s.expression}</p>
                <p className="mt-3 text-[11px] text-subtle uppercase">T2I</p>
                <p className="mt-1 text-xs text-muted">{s.t2iPrompt}</p>
                <p className="mt-3 text-[11px] text-subtle uppercase">I2V</p>
                <p className="mt-1 text-xs text-muted">{s.i2vPrompt}</p>
              </article>
            ))}
          </div>

        <Button className="mt-5" variant="secondary" onClick={() => setStage("generate")}>
          Open generate bay
        </Button>
      </div>
    </Pane>
  );
}

function GenerateStage({ picture }: { picture: Picture }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manifests, setManifests] = useState<ImageComponentManifest[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<Awaited<
    ReturnType<typeof desktopProductionAuthorityStatus>
  > | null>(null);
  const setStage = useStudio((state) => state.setStage);
  const replaceActive = useStudio((state) => state.replaceActive);
  const generateGate = useStudio((state) => state.generateGate);
  const generateFilterId = useStudio((state) => state.generateFilterId);
  const setGenerateFocus = useStudio((state) => state.setGenerateFocus);
  const refreshAuthorityStatus = useCallback(async () => {
    if (!isDesktopApp()) return null;
    const status = await desktopProductionAuthorityStatus({ pictureId: picture.id });
    setBackendStatus(status);
    return status;
  }, [picture.id]);
  useEffect(() => {
    void desktopImageManifests()
      .then(setManifests)
      .catch(() => setManifests([]));
    void refreshAuthorityStatus().catch(() =>
      setBackendStatus({ ok: false, error: "Backend authority status unavailable." }),
    );
  }, [refreshAuthorityStatus]);
  const prepared = picture.production?.preparedAssets ?? [];
  const assets = picture.production?.assets ?? [];
  const ready = prepared.filter((item) => item.status === "APPROVED_PREPARED");
  const best =
    manifests.find((item) => item.status === "READY" && item.adapterId === "flux2") ??
    manifests.find((item) => item.status === "READY" && item.adapterId === "flux") ??
    manifests.find((item) => item.adapterId === "flux2") ??
    manifests.find((item) => item.adapterId === "flux") ??
    manifests[0];
  const blockedReason =
    best?.disabledReason ??
    "No complete offline native image adapter is verified on this workstation.";
  const authorityCurrent =
    backendStatus?.ok === true &&
    backendStatus.status === "CURRENT" &&
    backendStatus.authorityId === picture.production?.productionAuthority?.authorityId &&
    backendStatus.digest === picture.production?.productionAuthority?.digest;
  const verifiedRoots = new Map(
    (backendStatus?.ok === true ? (backendStatus.preparedApprovals ?? []) : []).map((root) => [
      root.preparedAssetId,
      root,
    ]),
  );
  const canAuthorizeWithBest = Boolean(
    best && best.status === "READY" && best.controls && picture.production && authorityCurrent,
  );
  const gateReadiness = generateGateReadiness(picture);
  const gateWorkspace = hydrateGenerateGates(picture.generateGates, picture);
  return (
    <Pane title="Generate" kicker="10 · Three-gate cohesion">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="workspace-tabs" role="tablist" aria-label="Generate gates">
          {gateReadiness.map((item) => <button key={item.gate} role="tab" aria-selected={generateGate === item.gate} title={item.reason} onClick={() => setGenerateFocus(item.gate)}>{item.gate === "assets" ? "Assets" : item.gate === "keyframes" ? "First / last frames" : "Video clips"}<span className="ml-2 text-xs opacity-70">{item.approved}/{item.required}</span></button>)}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>Generation settings</Button>
      </div>
      <p className="mb-4 text-sm text-muted">{gateReadiness.find((item) => item.gate === generateGate)?.reason}</p>
      <CabinetModal title="Generation settings & authority" open={settingsOpen} onOpenChange={setSettingsOpen}>
        <VideoGenerationOptions picture={picture} />
        <div className="mt-4 rounded-lg border border-border p-3 text-sm text-muted">{backendStatus?.ok === true ? `Backend authority: ${backendStatus.status.replaceAll("_", " ").toLowerCase()}${authorityCurrent ? " · exact current authority verified" : " · reseal/reconcile required"}` : backendStatus?.ok === false ? `Backend authority unavailable: ${backendStatus.error}` : "Backend authority status pending; generation fails closed."}</div>
      </CabinetModal>
      {generateGate === "assets" ? (
        <div className="mb-6">
          <AudioGenerationOptions picture={picture} />
        </div>
      ) : null}
      {generateGate === "assets" ? (
        <>
          <GeneratedAssetsReview picture={picture} />
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-muted">
              Advanced preparation details
            </summary>
            <div className="mt-3 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
              <section className="grid min-w-0 gap-3" aria-label="Prepared assets">
                {(() => {
                  const plan = hydrateProductFlow(picture.productFlow);
                  const extracted = picture.production?.assets ?? [];
                  const blocked =
                    plan.manualFallback ||
                    plan.steps.some(
                      (step) => step.status === "failed" || step.status === "blocked",
                    ) ||
                    extracted.length === 0;
                  if (blocked) {
                    return (
                      <div
                        className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
                        data-assets-gate-blocked="true"
                      >
                        <p className="font-display text-xl">Movie plan did not complete.</p>
                        <p className="mt-2 text-sm text-muted">Assets were not generated.</p>
                        <p className="mt-2 text-xs text-muted">{MANUAL_FALLBACK_LABEL}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => setStage("intake")}>
                            Retry Build Movie Plan
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => useStudio.getState().enterAdvancedDepartments()}
                          >
                            Open Manual Advanced Fallback
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="grid gap-3" data-extracted-assets="true">
                      {!prepared.length ? (
                        <div className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
                          <p className="text-sm text-muted">
                            The asset descriptions are ready. Review their specifications and
                            prepare them for image generation.
                          </p>
                          <Button className="mt-3" onClick={() => setStage("inventory")}>
                            Prepare asset images
                          </Button>
                        </div>
                      ) : null}
                      {extracted.map((asset) => (
                        <article
                          key={asset.id}
                          className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
                        >
                          <p className="text-[11px] tracking-wide text-subtle uppercase">
                            {asset.category}
                          </p>
                          <h3 className="mt-1 font-display text-xl">{asset.name}</h3>
                          <p className="mt-1 text-sm text-muted">
                            {asset.canonicalSpec.visualDescription}
                          </p>
                        </article>
                      ))}
                    </div>
                  );
                })()}
                {prepared.length
                  ? prepared.map((item) => {
                      const asset = assets.find((candidate) => candidate.id === item.assetId);
                      const prompt =
                        item.promptIngredients.join(". ") ||
                        asset?.canonicalSpec.visualDescription ||
                        asset?.name ||
                        "";
                      const verifiedRoot = verifiedRoots.get(item.id);
                      const rootCurrent = Boolean(
                        verifiedRoot &&
                        verifiedRoot.rootId === item.preparedApprovalRootId &&
                        verifiedRoot.digest === item.preparedApprovalDigest &&
                        verifiedRoot.authorityId ===
                          picture.production?.productionAuthority?.authorityId &&
                        verifiedRoot.authorityDigest ===
                          picture.production?.productionAuthority?.digest,
                      );
                      const blocked = !authorityCurrent
                        ? "Production authority is missing or stale in the backend; explicitly reseal/reconcile in Inventory."
                        : item.status !== "APPROVED_PREPARED"
                          ? item.blockers.join(" ") || "Prepared asset is not approved."
                          : !rootCurrent
                            ? "Prepared approval root is not verified current by the backend ledger."
                            : blockedReason;
                      return (
                        <article
                          key={item.id}
                          className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] tracking-wide text-subtle uppercase">
                                {item.status.replaceAll("_", " ")}
                              </p>
                              <h3
                                className="mt-1 truncate font-display text-xl"
                                title={asset?.name ?? item.assetId}
                              >
                                {asset?.name ?? item.assetId}
                              </h3>
                              <p className="mt-1 line-clamp-2 text-sm text-muted">
                                {prompt || "No prompt ingredients"}
                              </p>
                            </div>
                            <Badge>{asset?.category ?? "asset"}</Badge>
                          </div>
                          <div className="mt-3 rounded-sm bg-inset px-3 py-2 text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">
                            {canAuthorizeWithBest && item.status === "APPROVED_PREPARED"
                              ? "Ready to generate. The writer model will be released to make room for images."
                              : blocked}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={
                                generating === item.id ||
                                item.status !== "APPROVED_PREPARED" ||
                                !rootCurrent ||
                                !asset ||
                                !canAuthorizeWithBest
                              }
                              title={
                                item.status === "APPROVED_PREPARED" &&
                                rootCurrent &&
                                canAuthorizeWithBest
                                  ? "Authorize and generate one immutable iteration for this prepared asset"
                                  : blocked
                              }
                              onClick={async () => {
                                if (!picture.production || !asset || !best?.controls) return;
                                setGenerating(item.id);
                                try {
                                  const latest = await refreshAuthorityStatus();
                                  const latestRoot =
                                    latest?.ok === true
                                      ? (latest.preparedApprovals ?? []).find(
                                          (root) => root.preparedAssetId === item.id,
                                        )
                                      : null;
                                  if (
                                    latest?.ok !== true ||
                                    latest.status !== "CURRENT" ||
                                    latest.authorityId !==
                                      picture.production.productionAuthority?.authorityId ||
                                    latest.digest !==
                                      picture.production.productionAuthority?.digest ||
                                    latestRoot?.rootId !== item.preparedApprovalRootId ||
                                    latestRoot?.digest !== item.preparedApprovalDigest
                                  )
                                    throw new Error(
                                      "Backend authority/prepared root mismatch; reseal or re-approve prepared before generation.",
                                    );
                                  const authorization = await desktopAuthorizePreparedImage({
                                    authorityId:
                                      picture.production.productionAuthority!.authorityId!,
                                    preparedAssetId: item.id,
                                    preparedApprovalRootId: item.preparedApprovalRootId ?? "",
                                    engineId: best.adapterId,
                                    engineName: best.modelVariant,
                                    values: {
                                      ...runtimeDefaults(best.controls),
                                      width: 512,
                                      height: 512,
                                      seed: Date.now() % 2147483647,
                                      precision: "BF16",
                                      outputFormat: "PNG",
                                      outputBitDepth: 8,
                                    },
                                  });
                                  if (!authorization.ok) throw new Error(authorization.error);
                                  if (picture.productFlow?.servedModelId)
                                    await releaseMoviePlanWriterForImages(
                                      picture.productFlow.servedModelId,
                                      picture,
                                    );
                                  const result = await desktopGeneratePreparedImage({
                                    token: authorization.token,
                                  });
                                  if (!result.ok) throw new Error(result.error);
                                  const nextProduction = appendGeneratedIteration(
                                    picture.production,
                                    {
                                      preparedAssetId: item.id,
                                      iterationId:
                                        result.iterationId ?? `iteration:${asset.id}:${Date.now()}`,
                                      output: {
                                        ...result.output,
                                        mediaBytes: new Uint8Array(result.output.mediaBytes),
                                        sidecarBytes: new Uint8Array(result.output.sidecarBytes),
                                      },
                                      provenance: result.provenance,
                                      continuityFindings: result.continuityFindings,
                                      receiptDigest: result.receiptDigest,
                                    },
                                  );
                                  replaceActive({
                                    ...picture,
                                    production: nextProduction,
                                    updatedAt: Date.now(),
                                  });
                                  await refreshAuthorityStatus();
                                  toast.success("Generated image iteration appended for review.");
                                  setStage("review");
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Prepared image generation failed.",
                                  );
                                } finally {
                                  setGenerating(null);
                                }
                              }}
                            >
                              {generating === item.id ? "Generating…" : "Authorize + generate"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setStage("review")}
                            >
                              Review iterations
                            </Button>
                          </div>
                        </article>
                      );
                    })
                  : null}
              </section>
              <aside
                className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
                aria-label="Native adapter manifest"
              >
                <p className="text-[11px] tracking-wide text-subtle uppercase">
                  Exact local adapter
                </p>
                <h3 className="mt-1 font-display text-xl">
                  {best ? best.modelVariant : "Unavailable"}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {best?.status === "READY"
                    ? "Local image model and required components verified."
                    : blockedReason}
                </p>
                <div className="mt-4 grid gap-2">
                  {(best?.components ?? []).slice(0, 7).map((component) => (
                    <div
                      key={component.opaqueId}
                      className="rounded-sm bg-inset px-3 py-2 text-xs shadow-[var(--shadow-border)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted">{component.role}</span>
                        <span className={component.present ? "text-accent" : "text-rec"}>
                          {component.present ? "present" : "missing"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-subtle" title={component.rendererPath}>
                        {component.stableId}
                      </p>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  variant="ghost"
                  onClick={() =>
                    void import("@/lib/desktop/client")
                      .then((api) => api.desktopUnloadEngine())
                      .then(
                        () => toast.success("Local image model released."),
                        (error) =>
                          toast.error(error instanceof Error ? error.message : "Release failed."),
                      )
                  }
                >
                  Release local image model
                </Button>
              </aside>
            </div>
          </details>
        </>
      ) : null}
      {generateGate === "keyframes" ? (
        <section className="grid min-w-0 gap-3" aria-label="First last frames">
          <p className="text-sm text-muted">
            First/Last frames lock video generate until each shot has an approved pair or is waived
            for imported video. Native keyframe generate stays fail-closed; import/waive is allowed.
          </p>
          {(generateFilterId
            ? gateWorkspace.pairs.filter((pair) => pair.shotId === generateFilterId)
            : gateWorkspace.pairs
          ).map((pair) => {
            const shot = picture.shots.find((item) => item.id === pair.shotId);
            return (
              <article
                key={pair.shotId}
                className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
              >
                <p className="text-[11px] tracking-wide text-subtle uppercase">
                  {pair.status}
                  {pair.waived ? " · waived" : ""}
                </p>
                <h3 className="mt-1 font-display text-xl">
                  {shot
                    ? `${String(shot.index).padStart(2, "0")} ${shot.description}`
                    : pair.shotId}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Refs: {pair.assetRefIds.join(", ") || "none"}
                  {pair.staleReasons.length ? ` · ${pair.staleReasons[0]}` : ""}
                </p>
                <KeyframeImages
                  workspace={gateWorkspace}
                  shotId={pair.shotId}
                  onSelect={(iterationId) =>
                    replaceActive({
                      ...picture,
                      generateGates: approveKeyframeIteration(gateWorkspace, iterationId),
                    })
                  }
                />
                <label className="mt-3 block text-[11px] tracking-wide text-subtle uppercase">
                  First frame prompt
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-sm bg-inset p-2 text-sm"
                    defaultValue={pair.firstPrompt}
                    onBlur={(event) =>
                      replaceActive({
                        ...picture,
                        generateGates: savePromptVersion(gateWorkspace, {
                          gate: "keyframes",
                          shotId: pair.shotId,
                          assetId: null,
                          kind: "first",
                          text: event.target.value,
                          assetRefIds: pair.assetRefIds,
                          firstFrameId: pair.firstApprovedId,
                          lastFrameId: pair.lastApprovedId,
                        }),
                      })
                    }
                  />
                </label>
                <label className="mt-3 block text-[11px] tracking-wide text-subtle uppercase">
                  Last frame prompt
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-sm bg-inset p-2 text-sm"
                    defaultValue={pair.lastPrompt}
                    onBlur={(event) =>
                      replaceActive({
                        ...picture,
                        generateGates: savePromptVersion(gateWorkspace, {
                          gate: "keyframes",
                          shotId: pair.shotId,
                          assetId: null,
                          kind: "last",
                          text: event.target.value,
                          assetRefIds: pair.assetRefIds,
                          firstFrameId: pair.firstApprovedId,
                          lastFrameId: pair.lastApprovedId,
                        }),
                      })
                    }
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      replaceActive({
                        ...picture,
                        generateGates: failClosedKeyframe(
                          gateWorkspace,
                          pair.shotId,
                          "first",
                          "Native first-frame generate is fail-closed. Import a still or waive for imported video.",
                        ),
                      });
                      toast.error(
                        "First frame generate fail-closed. No still was labeled as video.",
                      );
                    }}
                  >
                    Generate first frame
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      replaceActive({
                        ...picture,
                        generateGates: failClosedKeyframe(
                          gateWorkspace,
                          pair.shotId,
                          "last",
                          "Native last-frame generate is fail-closed. Import a still or waive for imported video.",
                        ),
                      });
                      toast.error("Last frame generate fail-closed.");
                    }}
                  >
                    Generate last frame
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      replaceActive({
                        ...picture,
                        generateGates: waiveKeyframePair(
                          gateWorkspace,
                          pair.shotId,
                          "Waived for imported video path.",
                        ),
                      });
                      toast.success("Keyframe pair waived. Imported video may proceed.");
                    }}
                  >
                    Waive pair for import
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
      {generateGate === "video" && picture.selectedEngine.video === "ltx-director" ? (
        <DirectorVideoPanel picture={picture} />
      ) : null}
      {generateGate === "video" && picture.selectedEngine.video === "minimax-h3" ? (
        <NativeFilmPanel picture={picture} />
      ) : null}
      {generateGate === "video" ? (
        <section
          className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
          aria-label="Video generation queue"
        >
          <p className="text-[11px] tracking-wide text-subtle uppercase">
            Keyframe-conditioned generation / imports
          </p>
          <h3 className="mt-1 font-display text-xl">
            Motion / {engineById(picture.selectedEngine.video)?.name ?? "video"}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {videoRuntimeBlock(videoEngineFromSelection(picture.selectedEngine.video))}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {picture.selectedEngine.video !== "ltx-director" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled
                title={videoRuntimeBlock(videoEngineFromSelection(picture.selectedEngine.video))}
              >
                In-app video rendering unavailable
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                void (async () => {
                  const latest =
                    useStudio.getState().pictures.find((item) => item.id === picture.id) ?? picture;
                  const shot =
                    nextShotForImport(latest.shots, hydrateVideoWorkspace(latest.video)) ??
                    latest.shots[0];
                  if (!shot) {
                    toast.error("Add a shot before importing video.");
                    return;
                  }
                  const imported = await desktopImportVideo();
                  if (!imported.ok) {
                    if (imported.canceled) return;
                    toast.error(imported.error);
                    return;
                  }
                  const workspace = recordImportedVideoTake(hydrateVideoWorkspace(picture.video), {
                    pictureId: picture.id,
                    shotId: shot.id,
                    filename: imported.filename,
                    mediaUri: imported.mediaUri,
                    mediaSha256: imported.mediaSha256,
                    byteLength: imported.byteLength,
                    durationSec: imported.probe.durationSec ?? 0,
                    fps: imported.probe.fps,
                    width: imported.probe.width,
                    height: imported.probe.height,
                    codec: imported.probe.codec,
                    hasAudio: imported.probe.hasAudio,
                  });
                  replaceActive({ ...picture, video: workspace, updatedAt: Date.now() });
                  toast.success(
                    `Imported ${imported.filename} as ${shot.id}. Provenance is imported, not generated.`,
                  );
                  setStage("review");
                })();
              }}
              disabled={!picture.shots.length}
            >
              Import video
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage("review")}>
              Review takes
            </Button>
          </div>
          <p className="mt-3 text-xs text-subtle">
            Shot readiness:{" "}
            {picture.shots.length
              ? picture.shots
                  .map(
                    (shot) =>
                      `${shot.index}:${shotVideoReadiness(hydrateVideoWorkspace(picture.video), shot.id)}`,
                  )
                  .join(" · ")
              : "no shots"}
          </p>
        </section>
      ) : null}
      {generateGate === "assets" ? (
        <section
          className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
          aria-label="Voice generation queue"
        >
          <p className="text-[11px] tracking-wide text-subtle uppercase">Voice / ADR</p>
          <h3 className="mt-1 font-display text-xl">
            Dialogue / {engineById(picture.selectedEngine.voice)?.name ?? "Qwen3 TTS"}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            {voiceRuntimeBlock(voiceEngineFromSelection(picture.selectedEngine.voice))}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const audio = queueMissingDialogue(picture);
                replaceActive({ ...picture, audio, updatedAt: Date.now() });
                toast.error("Dialogue jobs were queued and fail-closed. No cloud TTS ran.");
                setStage("review");
              }}
            >
              Queue missing dialogue
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStage("score")}>
              Voice design & library
            </Button>
          </div>
        </section>
      ) : null}
      {generateGate === "assets" && ready.length ? (
        <p className="mt-4 text-xs text-subtle">
          {ready.length} prepared asset(s) are product-ready; generation still requires an exact
          READY manifest and one-use authorization.
        </p>
      ) : null}
    </Pane>
  );
}

function ReviewStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft("review-media-surface", "images");
  const [reasons, setReasons] = useWorkspaceDraft<Record<string, string>>("review-reasons", {});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const replaceActive = useStudio((state) => state.replaceActive);
  const setGenerateFocus = useStudio((state) => state.setGenerateFocus);
  return (
    <Pane title="Review & approval" kicker="ITERATION DECISIONS">
      <div className="mb-4">
        <Button size="sm" variant="secondary" onClick={() => setGenerateFocus("video")}>
          Open video jobs
        </Button>
      </div>
      <div className="workspace-tabs mb-4" aria-label="Review media type">
        {[["images", "Images"], ["video", "Video"], ["audio", "Audio"]].map(([id, label]) => <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>{label}</button>)}
      </div>
      <div hidden={surface !== "images"}><ImageIterationReview picture={picture} /></div>
      <section hidden={surface !== "video"} aria-label="Video takes">
        <p className="mb-3 text-[11px] tracking-wide text-subtle uppercase">Video takes</p>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {hydrateVideoWorkspace(picture.video).takes.length ? (
            hydrateVideoWorkspace(picture.video).takes.map((take) => (
              <article
                key={take.id}
                className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-wide text-subtle uppercase">
                      {take.status.replaceAll("_", " ")}
                    </p>
                    <h3 className="break-words font-display text-xl">
                      {take.shotId} · {take.engineId}
                    </h3>
                  </div>
                  <Badge>{take.canonical ? "canonical" : take.kind}</Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {take.failClosedReason ?? take.reviewReason ?? "Queued video take."}
                </p>
                <p className="mt-2 text-xs text-subtle">
                  {take.mediaUri ?? "No durable video media. Stills are not video."}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {picture.shots.find((s) => s.id === take.shotId)
                    ? shotPacketFreshness(
                        picture,
                        picture.shots.find((s) => s.id === take.shotId)!,
                        take.jobId,
                        take.id,
                      ).reason
                    : "Source shot no longer exists."}
                </p>
                <label className="mt-3 grid gap-1 text-sm">
                  Observed video review against current direction
                  <Textarea
                    value={reasons[take.id] ?? ""}
                    onChange={(e) =>
                      setReasons((previous) => ({ ...previous, [take.id]: e.target.value }))
                    }
                  />
                </label>
                <label className="mt-2 flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed[take.id] ?? false}
                    onChange={(e) =>
                      setConfirmed((previous) => ({ ...previous, [take.id]: e.target.checked }))
                    }
                  />
                  I reviewed this exact take against the current source, including speech and
                  continuity.
                </label>
                <SpeechReviewPanel
                  key={`${take.id}:${take.mediaSha256}`}
                  picture={picture}
                  take={take}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      try {
                        replaceActive({
                          ...picture,
                          video: reviewVideoTake(
                            hydrateVideoWorkspace(picture.video),
                            take.id,
                            "reject",
                            "Rejected: no genuine video media.",
                          ),
                        });
                        toast.success("Video take rejected and retained as history.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Reject failed.");
                      }
                    }}
                  >
                    Reject take
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !confirmed[take.id] ||
                      !reasons[take.id]?.trim() ||
                      !picture.shots.some((s) => s.id === take.shotId) ||
                      take.origin !== "imported" ||
                      !take.mediaSha256 ||
                      !take.probe?.ok
                    }
                    title={
                      take.origin === "imported"
                        ? "Approve imported video as canonical. This is not native generation."
                        : "Canonical video approval requires imported probed media or a real native worker."
                    }
                    onClick={() => {
                      try {
                        replaceActive({
                          ...picture,
                          video: reviewVideoTake(
                            hydrateVideoWorkspace(picture.video),
                            take.id,
                            "canonical",
                            reasons[take.id],
                            Date.now(),
                            resolveShotPacket(
                              picture,
                              picture.shots.find((s) => s.id === take.shotId)!,
                            ).fingerprint,
                          ),
                        });
                        toast.success("Imported video marked canonical. Not labeled as generated.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Canonical failed.");
                      }
                    }}
                  >
                    Approve canonical
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <EmptyCard
              title="No video takes"
              body="Prepare scene workflows in Generate, then import rendered clips for review."
            />
          )}
        </div>
      </section>
      <section hidden={surface !== "audio"} aria-label="Audio takes">
        <p className="mb-3 text-[11px] tracking-wide text-subtle uppercase">Audio takes</p>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {hydrateAudioWorkspace(picture.audio).takes.length ? (
            hydrateAudioWorkspace(picture.audio).takes.map((take) => (
              <article
                key={take.id}
                className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-wide text-subtle uppercase">
                      {take.status.replaceAll("_", " ")}
                    </p>
                    <h3 className="break-words font-display text-xl">
                      {take.kind} · {take.engineId}
                    </h3>
                  </div>
                  <Badge>{take.origin}</Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {take.failClosedReason ??
                    take.reviewReason ??
                    take.filename ??
                    "Queued audio take."}
                </p>
                <p className="mt-2 text-xs text-subtle">
                  {take.mediaUri ?? "No durable audio. Silence is not a take."}
                </p>
                {take.mediaUri &&
                  /^(\/api\/project-media\?|media:|https?:)/.test(take.mediaUri) && (
                    <audio
                      controls
                      preload="none"
                      className="mt-3 w-full"
                      src={take.mediaUri}
                      aria-label={`Listen to ${take.filename ?? take.id}`}
                    />
                  )}
                <label className="mt-3 grid gap-1 text-sm">
                  Listening review notes
                  <Textarea
                    value={reasons[take.id] ?? ""}
                    onChange={(e) =>
                      setReasons((previous) => ({ ...previous, [take.id]: e.target.value }))
                    }
                  />
                </label>
                <label className="mt-2 flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed[take.id] ?? false}
                    onChange={(e) =>
                      setConfirmed((previous) => ({ ...previous, [take.id]: e.target.checked }))
                    }
                  />
                  I listened to the exact take and checked cue timing, permitted sounds and vocal
                  policy.
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      try {
                        replaceActive({
                          ...picture,
                          audio: reviewAudioTake(
                            hydrateAudioWorkspace(picture.audio),
                            take.id,
                            "reject",
                            "Rejected audio take.",
                          ),
                        });
                        toast.success("Audio take rejected.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Reject failed.");
                      }
                    }}
                  >
                    Reject take
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      take.canonical ||
                      take.origin === "fail-closed" ||
                      !take.mediaSha256 ||
                      !reasons[take.id]?.trim() ||
                      !confirmed[take.id]
                    }
                    onClick={() => {
                      try {
                        replaceActive({
                          ...picture,
                          audio: reviewAudioTake(
                            hydrateAudioWorkspace(picture.audio),
                            take.id,
                            "canonical",
                            reasons[take.id],
                          ),
                        });
                        toast.success("Audio take marked canonical with its original provenance.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Canonical failed.");
                      }
                    }}
                  >
                    Approve canonical
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <EmptyCard
              title="No audio takes"
              body="Choose your audio tools in Generate, then import recordings or generated audio for review."
            />
          )}
        </div>
      </section>
    </Pane>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg bg-elevated p-5 text-sm text-muted shadow-[var(--shadow-border)]">
      <h3 className="font-display text-xl text-fg">{title}</h3>
      <p className="mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

function StitchStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft("timeline-view", "preview");
  const selectedShotId = useStudio((s) => s.selectedShotId);
  const shot = picture.shots.find((s) => s.id === selectedShotId) ?? picture.shots[0];
  const plan = buildTimelinePlan(picture);
  return (
    <Pane title="Timeline & soundtrack" kicker="MOVIE ASSEMBLY">
      <div className="workspace-tabs mb-4" aria-label="Movie assembly views">
        {[["preview", "Preview"], ["order", "Clip order"], ["readiness", "Coverage"]].map(([id,label]) => <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>{label}</button>)}
      </div>
      <div hidden={surface !== "preview"} className="overflow-hidden rounded-lg bg-inset shadow-[var(--shadow-border)]">
        <div className="grid h-[clamp(12rem,48dvh,32rem)] place-items-center">
          {shot?.videoUrl ? (
            <video src={shot.videoUrl} className="size-full object-contain" controls playsInline />
          ) : shot?.stillUrl ? (
            <img src={shot.stillUrl} alt="" className="size-full object-contain" />
          ) : (
            <div className="grid size-full place-items-center text-sm text-subtle">
              Select a shot
            </div>
          )}
        </div>
      </div>
      <div hidden={surface !== "order"}><EditorialClipEditor picture={picture} /></div>
      <div hidden={surface !== "readiness"}>
      <ol className="grid gap-1">
        {plan.clips.map((clip) => {
          const s = picture.shots.find((item) => item.id === clip.shotId);
          return (
            <li
              key={clip.shotId}
              className="flex items-center justify-between rounded-sm bg-elevated px-3 py-2 text-xs"
            >
              <span>
                {String(s?.index ?? 0).padStart(2, "0")} {s?.description} · {clip.videoOrigin}
              </span>
              <span className="text-subtle">
                {clip.missing.length
                  ? `missing ${clip.missing.join(", ")}`
                  : `${clip.endSec - clip.startSec}s`}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-subtle">
        Shot timeline {plan.durationSec}s. Imported film{" "}
        {importedCanonicalFilm(picture).durationSec.toFixed(1)}s across{" "}
        {importedCanonicalFilm(picture).clips.length} canonical imported clip(s). Origin stays
        imported, never generated.
      </p>
      </div>
    </Pane>
  );
}

function ScoreStage({ picture }: { picture: Picture }) {
  const replaceActive = useStudio((state) => state.replaceActive);
  const setStage = useStudio((state) => state.setStage);
  const [surface, setSurface] = useWorkspaceDraft("sound-workspace-view", "cues");
  const audio = hydratePictureAudio(picture);
  return (
    <Pane title="Sound, voice & music" kicker="AUDIO DEVELOPMENT" tabs={<div className="workspace-tabs" aria-label="Sound workspace">
        {[
          ["cues", "Cue editor"],
          ["voices", "Character voices"],
          ["takes", "Audio takes & imports"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>
            {label}
          </button>
        ))}
      </div>}>

      <div hidden={surface !== "cues"}>
        <SoundCueEditor />
      </div>
      <div hidden={surface !== "voices"}>
        <VoiceDesignWorkspace key={picture.id} picture={picture} />
      </div>
      <div hidden={surface !== "takes"}>
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Plan cues, manage voices, and review imported audio. Choose song, instrumental,
          sound-effect, and speech tools in Generate.
        </p>
        <div
          role="status"
          className="max-w-2xl rounded-md bg-inset px-3 py-2 text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]"
        >
          {musicRuntimeBlock(musicEngineFromSelection(picture.selectedEngine.music))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              replaceActive({
                ...picture,
                audio: queueMissingDialogue(picture),
                updatedAt: Date.now(),
              });
              toast.error("Dialogue queued fail-closed. No cloud TTS.");
            }}
          >
            Queue missing dialogue
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              replaceActive({
                ...picture,
                audio: queueMissingScore(picture),
                updatedAt: Date.now(),
              });
              toast.error(
                "Score cues saved. The selected audio runtime is not connected; no audio was generated.",
              );
            }}
          >
            Queue missing score
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void (async () => {
                const imported = await desktopImportAudio();
                if (!imported.ok) {
                  if (imported.canceled) return;
                  toast.error(imported.error);
                  return;
                }
                const workspace = recordImportedAudioTake(hydratePictureAudio(picture), {
                  pictureId: picture.id,
                  kind: "score",
                  filename: imported.filename,
                  mediaUri: imported.mediaUri,
                  mediaSha256: imported.mediaSha256,
                  byteLength: imported.byteLength,
                  durationSec: imported.probe.durationSec ?? 0,
                  sampleRate: imported.probe.sampleRate,
                  channels: imported.probe.channels,
                  format: imported.probe.codec,
                  cueId: hydratePictureAudio(picture).cues[0]?.id ?? picture.cues[0]?.id ?? null,
                });
                replaceActive({ ...picture, audio: workspace, updatedAt: Date.now() });
                toast.success(
                  `Imported ${imported.filename} as audio. Provenance is imported, not generated.`,
                );
                setStage("review");
              })();
            }}
          >
            Import audio
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStage("review")}>
            Review audio takes
          </Button>
        </div>
        <div className="mt-5 grid gap-3">
          {audio.takes.map((take) => (
            <article key={take.id} className="rounded-lg border border-border bg-surface p-4">
              <h3 className="text-sm">
                {take.kind} ·{" "}
                {take.canonical
                  ? "Selected for assembly"
                  : take.status.toLowerCase().replaceAll("_", " ")}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {take.cueId
                  ? (audio.cues.find((c) => c.id === take.cueId)?.name ?? take.cueId)
                  : (take.shotId ?? "Film-wide take")}
              </p>
              {take.mediaUri ? (
                <audio
                  controls
                  preload="metadata"
                  src={take.mediaUri}
                  className="mt-3 w-full"
                  aria-label={`Audition ${take.kind} take`}
                />
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Media is unavailable. Import a replacement take.
                </p>
              )}
            </article>
          ))}

          {audio.profiles.map((profile) => (
            <article
              key={profile.id}
              className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
            >
              <p className="text-[11px] tracking-wide text-subtle uppercase">Voice bible</p>
              <h3 className="font-display text-xl">{profile.characterName}</h3>
              <p className="mt-1 text-xs text-muted">
                {profile.engineId} · {profile.notes}
              </p>
            </article>
          ))}
          {audio.lines.map((line) => (
            <article
              key={line.id}
              className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
            >
              <p className="text-[11px] tracking-wide text-subtle uppercase">
                Dialogue · {line.targetDurationSec}s
              </p>
              <h3 className="font-display text-xl">{line.characterName}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{line.text}</p>
              <p className="mt-2 text-xs text-subtle">
                {line.emotion} · {line.delivery}
              </p>
            </article>
          ))}
          {(audio.cues.length
            ? audio.cues
            : picture.cues.map((c) => ({
                id: c.id,
                name: c.name,
                notes: c.mood,
                instrumentation: c.instruments,
                kind: "score" as const,
                startSec: c.startSec,
                durationSec: c.durationSec,
                sceneId: null,
                shotId: null,
              }))
          ).map((c) => (
            <article
              key={c.id}
              className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
            >
              <h3 className="font-display text-xl">{c.name}</h3>
              <p className="mt-1 text-xs text-muted">{c.notes}</p>
              <p className="mt-2 text-xs">{c.instrumentation}</p>
            </article>
          ))}
        </div>
      </div>
    </Pane>
  );
}

function ExportStage({ picture }: { picture: Picture }) {
  const [surface, setSurface] = useWorkspaceDraft("delivery-workspace-view", "package");
  const dur = totalDuration(picture);
  const [files, setFiles] = useState<ReadyFile[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [ffmpeg, setFfmpeg] = useState<{
    ok: boolean;
    ffmpeg: string | null;
    ffprobe: string | null;
    reason: string;
  } | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const setStage = useStudio((state) => state.setStage);
  useEffect(() => {
    void desktopMediaDiscover().then(setFfmpeg);
  }, []);
  const readiness = movieReadiness(picture);
  const lifecycle = movieLifecycle(picture);
  const exportPlan = planPictureExport(picture, null);
  const nextStage = guidedNextStage(picture);
  const canonicalImported = hydrateVideoWorkspace(picture.video).takes.find(
    (take) =>
      take.canonical &&
      take.origin === "imported" &&
      take.mediaUri &&
      picture.shots.some(
        (shot) =>
          shot.id === take.shotId &&
          shotPacketFreshness(picture, shot, take.jobId, take.id).status !== "stale",
      ),
  );
  const litePlan = planLiteImportedExport(picture, ffmpeg?.ok ? ffmpeg.ffmpeg : null);
  const plusPlan = planPlusImportedExport(picture, ffmpeg?.ok ? ffmpeg.ffmpeg : null);
  const film = importedCanonicalFilm(picture);
  const canonicalAudio = hydrateAudioWorkspace(picture.audio).takes.find(
    (take) => take.canonical && take.origin === "imported" && take.mediaUri,
  );

  async function pull(file: ReadyFile) {
    setFiles((prev) => {
      prev.filter((f) => f.filename !== file.filename).forEach((f) => URL.revokeObjectURL(f.href));
      return [file, ...prev.filter((f) => f.filename !== file.filename)];
    });
    const result = await saveReadyFile(file);
    if (result === "saved") toast.success(`Saved ${file.filename}`);
    else if (result === "linked")
      toast.message("Use Save in the tray if nothing landed in Downloads.");
  }

  return (
    <Pane title="Delivery" kicker="SCRIPT PACKAGE / FINISHED MOVIE" tabs={<div className="workspace-tabs" aria-label="Delivery workspace">
        {[
          ["package", "Script & production package"],
          ["movie", "Finished movie"],
          ["readiness", "Readiness & other exports"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>
            {label}
          </button>
        ))}
      </div>}>

      <div hidden={surface !== "movie"}>
        <MovieAssemblyPanel key={picture.id} picture={picture} />
      </div>
      <div hidden={surface !== "readiness"}>
        <section
          className="mb-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"
          aria-label="Movie readiness"
        >
          <p className="text-[11px] tracking-wide text-subtle uppercase">Movie readiness</p>
          <h3 className="mt-1 font-display text-xl">Guided finish path</h3>
          <p className="mt-2 text-sm text-muted">{exportPlan.reason}</p>
          <p className="mt-2 text-xs text-subtle">
            {ffmpeg?.reason ?? "Checking local FFmpeg…"} {litePlan.reason} {plusPlan.reason}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="mt-0"
              size="sm"
              variant="secondary"
              onClick={() => setStage(nextStage)}
            >
              Next recommended · {nextStage}
            </Button>
            <Button
              size="sm"
              disabled={!canonicalImported || !ffmpeg?.ok}
              onClick={() => {
                void (async () => {
                  if (
                    !canonicalImported?.mediaUri ||
                    !canonicalImported.mediaSha256 ||
                    !canonicalImported.probe?.durationSec
                  ) {
                    toast.error("Canonical imported video is missing.");
                    return;
                  }
                  const exported = await desktopExportLite({
                    mediaUri: canonicalImported.mediaUri,
                    mediaSha256: canonicalImported.mediaSha256,
                    durationSec: canonicalImported.probe.durationSec,
                    fps: canonicalImported.probe.fps ?? picture.fps ?? 24,
                    hasAudio: canonicalImported.probe.hasAudio,
                  });
                  if (!exported.ok) {
                    toast.error(exported.error);
                    return;
                  }
                  setLastExport(exported.outputPath);
                  toast.success(`Exported imported MP4 ${exported.sha256.slice(0, 12)}…`);
                })();
              }}
            >
              Export MP4
            </Button>
            <Button
              size="sm"
              disabled={!plusPlan.ok}
              onClick={() => {
                void (async () => {
                  if (!canonicalAudio?.mediaUri || !canonicalAudio.mediaSha256) {
                    toast.error("Canonical imported audio is required for the 30-second film.");
                    return;
                  }
                  const exported = await desktopExportPlus({
                    videos: film.clips,
                    audioUri: canonicalAudio.mediaUri,
                    audioSha256: canonicalAudio.mediaSha256,
                    fps: picture.fps || 24,
                  });
                  if (!exported.ok) {
                    toast.error(exported.error);
                    return;
                  }
                  setLastExport(exported.outputPath);
                  toast.success(`Exported 30s imported film ${exported.sha256.slice(0, 12)}…`);
                })();
              }}
            >
              Export 30s film
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void desktopOpenExportFolder().then((result) => {
                  if (!result.ok) toast.error(result.error || "Could not open folder");
                });
              }}
            >
              Open output folder
            </Button>
          </div>
          {lastExport ? (
            <p className="mt-2 truncate text-xs text-subtle" title={lastExport}>
              Last export {lastExport}
            </p>
          ) : null}
          <ul className="mt-4 grid gap-1 sm:grid-cols-2">
            {readiness.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-2 rounded-sm bg-inset px-3 py-2 text-left text-xs shadow-[var(--shadow-border)]"
                  onClick={() => {
                    if (item.id === "images" || item.id === "voice")
                      useStudio.getState().setGenerateFocus("assets");
                    else if (item.id === "video") useStudio.getState().setGenerateFocus("video");
                    else setStage(item.stage);
                  }}
                >
                  <span>
                    <span className="text-subtle uppercase">{item.status}</span> · {item.label}
                    <span className="mt-1 block text-muted">{item.reason}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-subtle">
            {lifecycle.filter((stage) => stage.readiness).length} lifecycle stages tracked.
            Checkpoint/resume uses the existing picture store; jobs re-queue instead of duplicating.
          </p>
        </section>
      </div>
      <section hidden={surface !== "package"} aria-label="Script and production package">
        <h3 className="font-display text-2xl">Your movie script package</h3>
        <p className="mb-6 mt-2 text-sm text-muted">
          Save the complete writing and production handoff, or choose individual files.
        </p>
        <dl className="grid max-w-md grid-cols-2 gap-3 text-sm">
          <Stat k="Runtime" v={formatTimecode(dur, picture.fps)} />
          <Stat k="Shots" v={String(picture.shots.length)} />
          <Stat k="Plates" v={String(picture.shots.filter((s) => s.stillUrl).length)} />
          <Stat k="Clips" v={String(picture.shots.filter((s) => s.videoUrl).length)} />
        </dl>
        <div className="mt-6 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <Button variant="secondary" onClick={() => void pull(buildFountain(picture))}>
            Fountain
          </Button>
          <Button variant="secondary" onClick={() => void pull(buildShotList(picture))}>
            Shot list
          </Button>
          <Button variant="secondary" onClick={() => void pull(buildEdl(picture))}>
            EDL
          </Button>
          <Button variant="secondary" onClick={() => void pull(buildPromptPack(picture))}>
            Prompt pack
          </Button>
          <Button variant="secondary" onClick={() => void pull(buildCueSheet(picture))}>
            Cue sheet
          </Button>
          <Button onClick={() => void pull(buildProjectJson(picture))}>Project JSON</Button>
          <Button
            variant="outline"
            onClick={() => {
              void (async () => {
                const pack = buildAllExports(picture);
                setFiles((prev) => {
                  prev.forEach((f) => URL.revokeObjectURL(f.href));
                  return pack;
                });
                if (isDesktopApp()) {
                  const result = await desktopSaveMany({
                    files: pack.map((f) => ({ filename: f.filename, contents: f.contents })),
                  });
                  if (!result.canceled)
                    toast.success(`Saved ${result.count} files to ${result.folderLabel}`);
                  return;
                }
                toast.success(`${pack.length} files ready. Choose Save for each file.`);
              })();
            }}
          >
            Export complete package
          </Button>
        </div>
        {files.length ? (
          <div className="mt-6 max-w-xl rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
            <p className="text-[11px] tracking-wide text-subtle uppercase">Ready to save</p>
            <ul className="mt-3 grid gap-2">
              {files.map((file) => (
                <li
                  key={file.filename}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-inset px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">{file.filename}</span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-sm bg-accent px-3 text-sm font-light text-accent-fg"
                      onClick={() => {
                        void saveReadyFile(file).then((result) => {
                          if (result === "saved") toast.success(`Saved ${file.filename}`);
                        });
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-sm px-3 text-sm font-light"
                      onClick={async () => {
                        const ok = await copyText(file.contents);
                        if (ok) {
                          setCopied(file.filename);
                          toast.success("Copied.");
                        }
                      }}
                    >
                      {copied === file.filename ? "Copied" : "Copy"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </Pane>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-1.5"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-elevated px-3 py-2">
      <dt className="text-[11px] text-subtle">{k}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{v}</dd>
    </div>
  );
}

export function StageRail() {
  const stage = useStage();
  const setStage = useStudio((state) => state.setStage);
  const uiMode = useStudio((state) => state.uiMode);
  const enterAdvancedDepartments = useStudio((state) => state.enterAdvancedDepartments);
  const generateGate = useStudio((state) => state.generateGate);
  const setGenerateFocus = useStudio((state) => state.setGenerateFocus);
  const defaultIndex = Math.max(
    0,
    DEFAULT_NAV_STEPS.findIndex(
      (step) => step.stage === stage && (step.gate ? generateGate === step.gate : true),
    ),
  );
  const goDefault = (step: (typeof DEFAULT_NAV_STEPS)[number]) => {
    if (step.gate) setGenerateFocus(step.gate);
    else setStage(step.stage);
  };
  return (
    <nav
      className="min-w-0 max-w-full overflow-hidden"
      aria-label="Pipeline"
      data-active-stage={stage}
      data-ui-mode={uiMode}
    >
      {uiMode === "default" ? (
        <div className="flex min-w-0 items-center gap-1 px-2 py-2">
          <div className="hidden min-w-0 flex-1 grid-cols-5 gap-1 xl:grid">
            {DEFAULT_NAV_STEPS.map((item) => {
              const currentDefault =
                item.stage === stage &&
                (item.gate ? generateGate === item.gate : item.stage !== "generate");
              return (
                <button
                  key={item.id}
                  type="button"
                  data-stage-id={item.stage}
                  aria-label={`${item.number} ${item.label}`}
                  aria-current={currentDefault ? "step" : undefined}
                  onClick={() => goDefault(item)}
                  className={cn(
                    "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-sm",
                    currentDefault ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  <span className="shrink-0 text-xs text-subtle">{item.number}</span>
                  <span className="min-w-0 truncate" title={item.label}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 xl:hidden">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous stage"
              disabled={defaultIndex === 0}
              onClick={() => goDefault(DEFAULT_NAV_STEPS[defaultIndex - 1])}
            >
              <ChevronLeft />
            </Button>
            <label className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-3 top-1 text-[9px] tracking-wide text-subtle uppercase">
                Touchpoint {defaultIndex + 1} of 5
              </span>
              <select
                aria-label="Pipeline stage"
                value={DEFAULT_NAV_STEPS[defaultIndex]?.id}
                onChange={(event) => {
                  const step = DEFAULT_NAV_STEPS.find((item) => item.id === event.target.value);
                  if (step) goDefault(step);
                }}
                className="h-11 w-full min-w-0 appearance-none rounded-sm bg-elevated px-3 pb-1 pt-4 text-sm text-fg shadow-[var(--shadow-border)] outline-none"
              >
                {DEFAULT_NAV_STEPS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next stage"
              disabled={defaultIndex === DEFAULT_NAV_STEPS.length - 1}
              onClick={() => goDefault(DEFAULT_NAV_STEPS[defaultIndex + 1])}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => enterAdvancedDepartments()}>
            Advanced Departments
          </Button>
        </div>
      ) : (
        <AdvancedDepartmentsRail />
      )}
    </nav>
  );
}
