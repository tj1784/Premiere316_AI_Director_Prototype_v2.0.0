import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { ENGINES, KIND_LABEL, engineById } from "@/lib/studio/engines";
import { MODEL_ROOT, STAGES, type Picture, type StageId } from "@/lib/studio/types";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import { useDirector } from "@/lib/studio/use-director";
import { compileEnginePromptPackage, compilePicture, totalDuration } from "@/lib/studio/prompt-compiler";
import { desktopApproveCanonicalImage, desktopAuthorizePreparedImage, desktopGeneratePreparedImage, desktopImageManifests, desktopProductionAuthorityStatus, desktopRejectCanonicalImage, desktopSaveMany, isDesktopApp } from "@/lib/desktop/client";
import type { ImageComponentManifest } from "@/lib/studio/image-component-resolver.server.ts";
import { runtimeDefaults } from "@/lib/studio/engine-controls.ts";
import { cn, copyText, formatTimecode, saveReadyFile, uid, type ReadyFile } from "@/lib/utils";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { SOURCE_TYPE_LABELS } from "@/lib/studio/picture-intake";
import type { ScreenplayModelRef } from "@/lib/studio/screenplay";
import { addManualScreenplayVersion, approveCurrentScreenplay, restoreScreenplayVersion } from "@/lib/studio/screenplay";
import type { ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import type { ScreenplayJobSnapshot } from "@/lib/studio/screenplay-jobs.server";
import { beginScreenplayJob, beginScreenplayQa, localLLMStatus, readScreenplayJob, releaseLocalScreenplayModel, stopScreenplayJob } from "@/lib/studio/screenplay-client";
import { ScreenplayWorkspace } from "./screenplay-workspace";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import { hydratePictureResearch, isResearchApproved, researchBlocksScreenplay } from "@/lib/research/bible.ts";
import { qwenWriterBlockReason } from "@/lib/studio/qwen-writer-identity.ts";
import { canonicalSpecHash, hydratePromptLabState, promptLabRuntimeBlock } from "@/lib/studio/prompt-lab.ts";
import { videoEngineFromSelection } from "@/lib/studio/generation-config.ts";
import { videoRuntimeBlock } from "@/lib/studio/video-runtime.ts";
import { enqueueVideoJob, failClosedVideoJob, reviewVideoTake, shotVideoReadiness } from "@/lib/production/video-iterations.ts";
import { hydrateVideoWorkspace } from "@/lib/production/video-types.ts";
import { enqueueSchedulerJob, emptySchedulerSnapshot, recoverSchedulerSnapshot } from "@/lib/studio/cross-media-scheduler.ts";
import { DEFAULT_CREW_WRITER_DISPLAY, OPTIONAL_CREW_WRITER_DISPLAY } from "@/lib/studio/model-routing.ts";
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

export function StageView() {
  const stage = useStage();
  const picture = useActivePicture();
  if (!picture) return null;
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

function Pane({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <div className="stage-pane flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <header className="shrink-0 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">{kicker}</p>
        <h2 className="mt-1 truncate font-display text-[clamp(1.5rem,3vw,1.875rem)] tracking-tight" title={title}>{title}</h2>
      </header>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-4 pb-8 sm:px-6">{children}</div>
    </div>
  );
}

function IntakeStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const patchIntake = <K extends keyof PictureIntake>(key: K, value: PictureIntake[K]) => {
    const intake = { ...picture.intake, [key]: value, updatedAt: Date.now() };
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

  return (
    <Pane title="Picture Intake" kicker="01 · Source & intent">
      <div className="grid max-w-3xl gap-5">
        <div className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
          <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Source mode</p>
          <p className="mt-2 text-sm">{SOURCE_TYPE_LABELS[picture.intake.sourceType]}</p>
          <p className="mt-1 text-xs text-muted">The original intake and every imported text source remain preserved in version history.</p>
        </div>
        <Field label="Title" value={picture.intake.title} onChange={(value) => patchIntake("title", value)} />
        <div>
          <Label>Logline</Label>
          <Textarea className="mt-1.5 min-h-24" value={picture.intake.logline} onChange={(event) => patchIntake("logline", event.target.value)} />
        </div>
        {picture.intake.sourceType === "concept" ? <div><Label>Premise</Label><Textarea className="mt-1.5 min-h-32" value={picture.intake.premise} onChange={(event) => patchIntake("premise", event.target.value)} /></div> : null}
        {picture.intake.sourceType === "treatment" ? <div><Label>Treatment / Outline</Label><Textarea className="mt-1.5 min-h-80" value={picture.intake.treatment} onChange={(event) => patchIntake("treatment", event.target.value)} /></div> : null}
        {picture.intake.sourceType === "existing-screenplay" ? <div><Label>Existing screenplay</Label><Textarea className="screenplay mt-1.5 min-h-[30rem]" value={picture.intake.existingScreenplay} onChange={(event) => patchIntake("existingScreenplay", event.target.value)} /></div> : null}
        {picture.intake.sourceType === "source-material" ? <div><Label>Source material</Label><Textarea className="mt-1.5 min-h-80" value={picture.intake.sourceMaterial} onChange={(event) => patchIntake("sourceMaterial", event.target.value)} /></div> : null}
        {picture.intake.sourceType === "biblical-historical" ? <><div><Label>Source passages / references</Label><Textarea className="mt-1.5" value={picture.intake.sourcePassages} onChange={(event) => patchIntake("sourcePassages", event.target.value)} /></div><div><Label>Supplied Scripture / source text</Label><Textarea className="mt-1.5 min-h-80" value={picture.intake.suppliedSourceText} onChange={(event) => patchIntake("suppliedSourceText", event.target.value)} /></div><div><Label>Fidelity requirements</Label><Textarea className="mt-1.5" value={picture.intake.fidelityRequirements} onChange={(event) => patchIntake("fidelityRequirements", event.target.value)} /></div></> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Genre" value={picture.intake.genre} onChange={(value) => patchIntake("genre", value)} />
          <Field label="Runtime (min)" value={String(picture.intake.targetRuntimeMinutes)} onChange={(value) => patchIntake("targetRuntimeMinutes", Number(value) || 1)} type="number" />
        </div>
        <Field label="Tone" value={picture.intake.tone} onChange={(value) => patchIntake("tone", value)} />
        <div><Label>Director notes</Label><Textarea className="mt-1.5" value={picture.intake.directorNotes} onChange={(event) => patchIntake("directorNotes", event.target.value)} /></div>
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
  const bible = hydratePictureResearch(picture.research, picture.intake);
  return (
    <ResearchWorkspace
      title={picture.title}
      bible={bible}
      onChange={(research) => patchActive({ research })}
    />
  );
}

function ScreenplayStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const [models, setModels] = useState<ScreenplayModelRef[]>([]);
  const [provider, setProvider] = useState<LocalLLMProviderDiscovery | null>(null);
  const [job, setJob] = useState<ScreenplayJobSnapshot | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const persistScreenplay = useCallback((screenplay: Picture["screenplay"]) => {
    patchActive({ screenplay, screenplayFountain: screenplay.workingFountain });
  }, [patchActive]);

  const scan = useCallback(async () => {
    setProvider(null);
    try {
      const status = await localLLMStatus();
      setProvider(status.provider);
      setModels(status.models);
    } catch (error) {
      setModels([]);
      setProvider(offlineDiscovery(error instanceof Error ? error.message : "LM Studio local API is unavailable."));
    }
  }, []);

  useEffect(() => { void scan(); }, [scan]);

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const snapshot = await readScreenplayJob(jobId);
        if (disposed || !snapshot) return;
        setJob(snapshot);
        persistScreenplay(snapshot.screenplay);
        if (snapshot.status === "queued" || snapshot.status === "running") timer = setTimeout(() => void poll(), 300);
      } catch (error) {
        if (!disposed) {
          setJob((current) => current ? { ...current, status: "failed", error: error instanceof Error ? error.message : String(error) } : current);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, persistScreenplay]);

  const start = async (options: { resume?: boolean; stepId?: ScreenplayStep["id"]; target?: ScreenplayRewriteTarget } = {}) => {
    const research = hydratePictureResearch(picture.research, picture.intake);
    const blockedResearch = researchBlocksScreenplay(research);
    if (blockedResearch) {
      toast.error(blockedResearch);
      return;
    }
    const modelId = picture.screenplay.selectedModelId ?? picture.intake.screenplayModelId;
    const selected = models.find((model) => model.id === modelId) ?? null;
    const blockedWriter = qwenWriterBlockReason(selected, Boolean(provider?.available), picture.screenplay.pinnedWriterServedId ?? null);
    if (blockedWriter) {
      toast.error(blockedWriter);
      return;
    }
    if (!modelId) {
      toast.error("Pin the full currently served Llama model ID. Family names are not accepted. Qwen is an optional explicit alternate.");
      return;
    }
    try {
      const initial = await beginScreenplayJob({
        intake: picture.intake,
        screenplay: picture.screenplay,
        research,
        modelId,
        resume: options.resume,
        stepId: options.stepId,
        rewriteScope: options.target?.scope,
        selectedNodeId: options.target?.nodeId ?? null,
        selectedNodeIds: options.target?.nodeIds ?? null,
        selection: options.target?.selection ?? null,
      });
      setJob(initial);
      setJobId(initial.id);
      persistScreenplay({
        ...picture.screenplay,
        selectedModelId: modelId,
        status: "GENERATING",
        updatedAt: Date.now(),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start local screenplay generation.");
      void scan();
    }
  };

  return (
    <ScreenplayWorkspace
      intake={picture.intake}
      screenplay={picture.screenplay}
      models={models}
      provider={provider}
      job={job}
      onTextChange={(workingFountain) => persistScreenplay({ ...picture.screenplay, workingFountain, status: picture.screenplay.approvedVersionId ? picture.screenplay.status : "READY_FOR_REVIEW", updatedAt: Date.now() })}
      onSaveRevision={() => persistScreenplay(addManualScreenplayVersion(picture.screenplay, picture.screenplay.workingFountain, uid("spv")))}
      onGenerate={(target) => void start({ target })}
      onContinue={(target) => void start({ resume: true, target })}
      onRegeneratePass={(stepId, target) => void start({ stepId, target })}
      researchApproved={isResearchApproved(hydratePictureResearch(picture.research, picture.intake))}
      onStop={() => { if (jobId) void stopScreenplayJob(jobId).then((snapshot) => { if (snapshot) { setJob(snapshot); persistScreenplay(snapshot.screenplay); } }); }}
      onRestore={(versionId) => persistScreenplay(restoreScreenplayVersion(picture.screenplay, versionId, uid("spv")))}
      onApprove={() => persistScreenplay(approveCurrentScreenplay(picture.screenplay, uid("spv")))}
      onRescan={() => void scan()}
      onModelChange={(selectedModelId) => {
        const chosen = models.find((model) => model.id === selectedModelId) ?? null;
        const intake = { ...picture.intake, screenplayModelId: selectedModelId, updatedAt: Date.now() };
        persistScreenplay({
          ...picture.screenplay,
          selectedModelId,
          pinnedWriterServedId: chosen?.servedModelId ?? null,
          pinnedQaServedId: chosen && isLlamaFamily(chosen) ? (picture.screenplay.pinnedQaServedId ?? chosen.servedModelId) : picture.screenplay.pinnedQaServedId,
          updatedAt: Date.now(),
        });
        patchActive({ intake });
      }}
      onQaPin={(servedModelId) => persistScreenplay({ ...picture.screenplay, pinnedQaServedId: servedModelId, updatedAt: Date.now() })}
      onReleaseResident={() => {
        void releaseLocalScreenplayModel().then(() => toast.message("Local model claim released. Premiere316 did not auto-load a replacement.")).catch((error) => toast.error(error instanceof Error ? error.message : "Unable to release local model."));
      }}
      onApplyQaRevision={(next) => {
        persistScreenplay(next);
        toast.success("Scoped revision appended. Prior approved Fountain is preserved.");
      }}
      onStoryDoctor={(modelId, target, secondOpinion) => {
        const writerPin = picture.screenplay.pinnedWriterServedId ?? null;
        const writer = models.find((model) => model.id === picture.screenplay.selectedModelId) ?? null;
        void beginScreenplayQa({
          fountain: picture.screenplay.workingFountain,
          modelId,
          writerId: writerPin ?? picture.screenplay.selectedModelId,
          pinnedQaServedId: picture.screenplay.pinnedQaServedId ?? (writer && isLlamaFamily(writer) ? writerPin : null),
          secondOpinion,
          goal: picture.intake.logline || picture.intake.premise || picture.title,
          revisionTarget: target.scope,
          rewriteScope: target.scope,
          selectedNodeId: target.nodeId,
          selectedNodeIds: target.nodeIds,
          selection: target.selection,
          characterState: picture.characters.map((item) => item.name).join(", "),
          research: hydratePictureResearch(picture.research, picture.intake),
        }).then((report) => {
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
          toast.message(report.findings[0]?.summary || "Story Doctor critique ready. Fountain was not changed.");
        }).catch((error) => {
          toast.error(error instanceof Error ? error.message : "Story Doctor failed closed.");
        });
      }}
    />
  );
}

function InventoryStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const [busy, setBusy] = useState(false);
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay);
  return (
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
          toast.error(error instanceof Error ? error.message : "Unable to build production inventory.");
        } finally {
          setBusy(false);
        }
      }}
      visualApprovals={picture.visualDevelopment?.approvals.map((approval) => approval.id) ?? []}
      cinematographyApprovals={picture.cinematography?.approvals.map((approval) => approval.id) ?? []}
      onChange={(production) => patchActive({ production })}
    />
  );
}

function VisualDevelopmentStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const visualDevelopment = picture.visualDevelopment ?? hydrateVisualDevelopmentState(null, picture);
  useEffect(() => {
    if (!picture.visualDevelopment) patchActive({ visualDevelopment });
  }, [patchActive, picture.visualDevelopment, visualDevelopment]);
  return <VisualDevelopmentWorkspace state={visualDevelopment} onChange={(visualDevelopment) => patchActive({ visualDevelopment })} />;
}

function CinematographyStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const visualDevelopment = picture.visualDevelopment ?? hydrateVisualDevelopmentState(null, picture);
  const cinematography = picture.cinematography ?? hydrateCinematographyState(null, picture);
  useEffect(() => {
    if (!picture.visualDevelopment || !picture.cinematography) patchActive({ visualDevelopment, cinematography });
  }, [patchActive, picture.visualDevelopment, picture.cinematography, visualDevelopment, cinematography]);
  return <CinematographyWorkspace state={cinematography} visual={visualDevelopment} onChange={(cinematography) => patchActive({ cinematography })} />;
}

function PerformanceStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const setStage = useStudio((state) => state.setStage);
  const workspace = picture.performance ?? migratePicturePerformance(picture);

  useEffect(() => {
    if (!picture.performance && workspace) patchActive({ performance: workspace });
  }, [patchActive, picture.performance, workspace]);

  if (!workspace) {
    return (
      <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center">
        <div className="max-w-md"><p className="text-[11px] tracking-wide text-subtle uppercase">07 · Performance direction</p><h2 className="mt-1 font-display text-2xl tracking-tight">Approve the screenplay first</h2><p className="mt-2 text-sm leading-relaxed text-muted">Performance work begins from the immutable approved screenplay, never a working draft.</p></div>
      </div>
    );
  }

  const characters = picture.production?.assets.filter((asset) => asset.category === "character").map((asset) => ({ id: asset.id, name: asset.name, detail: asset.canonicalSpec.performanceNotes }))
    ?? picture.characters.map((character) => ({ id: character.id, name: character.name, detail: character.role }));

  return (
    <PerformanceWorkspaceView
      workspace={workspace}
      characters={characters}
      onChange={(performance) => patchActive({ performance, shots: canonicalShotsToLegacy(performance.shots, picture.shots) })}
      onOpenShots={() => setStage("shots")}
    />
  );
}

function ShotsStage({ picture }: { picture: Picture }) {
  const patchActive = useStudio((state) => state.patchActive);
  const setStage = useStudio((state) => state.setStage);
  const workspace = picture.performance ?? migratePicturePerformance(picture);

  useEffect(() => {
    if (!picture.performance && workspace) patchActive({ performance: workspace });
  }, [patchActive, picture.performance, workspace]);

  if (!workspace) {
    return (
      <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center">
        <div className="max-w-md"><p className="text-[11px] tracking-wide text-subtle uppercase">08 · Shot preparation</p><h2 className="mt-1 font-display text-2xl tracking-tight">Performance workspace required</h2><p className="mt-2 text-sm leading-relaxed text-muted">Approve the screenplay, then direct its beats before preparing coverage.</p></div>
      </div>
    );
  }

  return (
    <ShotPreparationWorkspace
      workspace={workspace}
      assets={picture.production?.assets ?? []}
      onChange={(performance) => patchActive({ performance, shots: canonicalShotsToLegacy(performance.shots, picture.shots) })}
      onBack={() => setStage("performance")}
      onOpenPromptLab={() => setStage("prompts")}
    />
  );
}

function PromptStage({ picture }: { picture: Picture }) {
  const setStage = useStudio((s) => s.setStage);
  const patchActive = useStudio((s) => s.patchActive);
  const lab = hydratePromptLabState(picture.promptLab);
  return (
    <Pane title="Prompt Lab" kicker="09 · Dialects">
      <p className="mb-4 max-w-xl text-sm text-muted">
        Still dialect {engineById(picture.selectedEngine.image)?.name}. Motion dialect{" "}
        {engineById(picture.selectedEngine.video)?.name}. Each shot is a 10–15s performance.
      </p>
      <div className="mb-4 max-w-xl rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Prompt compiler</p>
        <select aria-label="Prompt compiler" className="mt-3 h-9 w-full rounded-sm bg-inset px-2 text-xs text-fg shadow-[var(--shadow-border)]" value="llama" onChange={() => patchActive({ promptLab: lab })}>
          <option value="llama">{DEFAULT_CREW_WRITER_DISPLAY} · default</option>
        </select>
        <select aria-label="Alternate compiler" className="mt-2 h-9 w-full rounded-sm bg-inset px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={lab.alternate} onChange={(event) => patchActive({ promptLab: { ...lab, alternate: event.target.value === "qwen" ? "qwen" : "none" } })}>
          <option value="none">Alternate · None</option>
          <option value="qwen">Alternate · Qwen (explicit A/B only)</option>
        </select>
        <p className="mt-2 text-xs leading-relaxed text-muted">{promptLabRuntimeBlock()}</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => {
          const compiled = compilePicture(picture);
          const drafts = compiled.shots.flatMap((shot) => {
            const still = compileEnginePromptPackage({ picture: compiled, shot, target: "still" });
            const motion = compileEnginePromptPackage({ picture: compiled, shot, target: "video" });
            return [
              { id: `${shot.id}:still`, family: "llama" as const, engineId: still.engineTarget, text: still.enginePrompt, canonicalSpecHash: canonicalSpecHash(still), createdAt: Date.now(), logicalRole: "prompt-engineer" as const, runtimeActivation: "gated-wave-5" as const },
              { id: `${shot.id}:video`, family: "llama" as const, engineId: motion.engineTarget, text: motion.enginePrompt, canonicalSpecHash: canonicalSpecHash(motion), createdAt: Date.now(), logicalRole: "prompt-engineer" as const, runtimeActivation: "gated-wave-5" as const },
            ];
          });
          patchActive({ shots: compiled.shots, promptLab: { ...lab, drafts } });
          toast.success("Deterministic Llama-default compiler wrote still and motion drafts. No video runtime was invoked.");
        }}>Compile drafts</Button>
        <Button className="mt-3 ml-2" size="sm" variant="ghost" disabled title={promptLabRuntimeBlock()}>A/B benchmark</Button>
      </div>
      <div className="grid gap-3">
        {picture.shots.map((s) => (
          <article key={s.id} className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]">
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
    </Pane>
  );
}

function GenerateStage({ picture }: { picture: Picture }) {
  const [manifests, setManifests] = useState<ImageComponentManifest[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<Awaited<ReturnType<typeof desktopProductionAuthorityStatus>> | null>(null);
  const setStage = useStudio((state) => state.setStage);
  const replaceActive = useStudio((state) => state.replaceActive);
  const refreshAuthorityStatus = useCallback(async () => {
    if (!isDesktopApp()) return null;
    const status = await desktopProductionAuthorityStatus({ pictureId: picture.id });
    setBackendStatus(status);
    return status;
  }, [picture.id]);
  useEffect(() => {
    void desktopImageManifests().then(setManifests).catch(() => setManifests([]));
    void refreshAuthorityStatus().catch(() => setBackendStatus({ ok: false, error: "Backend authority status unavailable." }));
  }, [refreshAuthorityStatus]);
  const prepared = picture.production?.preparedAssets ?? [];
  const assets = picture.production?.assets ?? [];
  const ready = prepared.filter((item) => item.status === "APPROVED_PREPARED");
  const best = manifests.find((item) => item.status === "READY" && item.adapterId === "flux2") ?? manifests.find((item) => item.adapterId === "flux2") ?? manifests.find((item) => item.status === "READY" && item.adapterId === "flux") ?? manifests.find((item) => item.adapterId === "flux") ?? manifests[0];
  const blockedReason = best?.disabledReason ?? "No complete offline native image adapter is verified on this workstation.";
  const authorityCurrent = backendStatus?.ok === true && backendStatus.status === "CURRENT" && backendStatus.authorityId === picture.production?.productionAuthority?.authorityId && backendStatus.digest === picture.production?.productionAuthority?.digest;
  const verifiedRoots = new Map((backendStatus?.ok === true ? (backendStatus.preparedApprovals ?? []) : []).map((root) => [root.preparedAssetId, root]));
  const canAuthorizeWithBest = Boolean(best && best.status === "READY" && best.controls && picture.production && authorityCurrent);
  return (
    <Pane title="Generate" kicker="10 · Prepared asset generation">
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-muted">Prepared generation is asset-first. FLUX.2 Dev is the default T2I engine when its exact local adapter is READY; FLUX.1 remains a secondary packaged adapter. Select an approved prepared asset, request a one-use desktop authorization, then append immutable iterations.</p>
      <div className="mb-4 rounded-md bg-inset p-3 text-xs text-muted shadow-[var(--shadow-border)]">{backendStatus?.ok === true ? `Backend authority: ${backendStatus.status.replaceAll("_", " ").toLowerCase()}${authorityCurrent ? " · exact current authority verified" : " · reseal/reconcile required"}` : backendStatus?.ok === false ? `Backend authority unavailable: ${backendStatus.error}` : "Backend authority status pending; generation fails closed."}</div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <section className="grid min-w-0 gap-3" aria-label="Prepared assets">
          {prepared.length ? prepared.map((item) => {
            const asset = assets.find((candidate) => candidate.id === item.assetId);
            const prompt = item.promptIngredients.join(". ") || asset?.canonicalSpec.visualDescription || asset?.name || "";
            const verifiedRoot = verifiedRoots.get(item.id);
            const rootCurrent = Boolean(verifiedRoot && verifiedRoot.rootId === item.preparedApprovalRootId && verifiedRoot.digest === item.preparedApprovalDigest && verifiedRoot.authorityId === picture.production?.productionAuthority?.authorityId && verifiedRoot.authorityDigest === picture.production?.productionAuthority?.digest);
            const blocked = !authorityCurrent ? "Production authority is missing or stale in the backend; explicitly reseal/reconcile in Inventory." : item.status !== "APPROVED_PREPARED" ? item.blockers.join(" ") || "Prepared asset is not approved." : !rootCurrent ? "Prepared approval root is not verified current by the backend ledger." : blockedReason;
            return (
              <article key={item.id} className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-wide text-subtle uppercase">{item.status.replaceAll("_", " ")}</p>
                    <h3 className="mt-1 truncate font-display text-xl" title={asset?.name ?? item.assetId}>{asset?.name ?? item.assetId}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{prompt || "No prompt ingredients"}</p>
                  </div>
                  <Badge>{asset?.category ?? "asset"}</Badge>
                </div>
                <div className="mt-3 rounded-sm bg-inset px-3 py-2 text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">
                  {canAuthorizeWithBest && item.status === "APPROVED_PREPARED" ? "Ready for one-use desktop authorization." : blocked}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={generating === item.id || item.status !== "APPROVED_PREPARED" || !rootCurrent || !asset || !canAuthorizeWithBest} title={item.status === "APPROVED_PREPARED" && rootCurrent && canAuthorizeWithBest ? "Authorize and generate one immutable iteration for this prepared asset" : blocked} onClick={async () => {
                    if (!picture.production || !asset || !best?.controls) return;
                    setGenerating(item.id);
                    try {
                      const latest = await refreshAuthorityStatus();
                      const latestRoot = latest?.ok === true ? (latest.preparedApprovals ?? []).find((root) => root.preparedAssetId === item.id) : null;
                      if (latest?.ok !== true || latest.status !== "CURRENT" || latest.authorityId !== picture.production.productionAuthority?.authorityId || latest.digest !== picture.production.productionAuthority?.digest || latestRoot?.rootId !== item.preparedApprovalRootId || latestRoot?.digest !== item.preparedApprovalDigest) throw new Error("Backend authority/prepared root mismatch; reseal or re-approve prepared before generation.");
                      const authorization = await desktopAuthorizePreparedImage({
                        authorityId: picture.production.productionAuthority!.authorityId!,
                        preparedAssetId: item.id,
                        preparedApprovalRootId: item.preparedApprovalRootId ?? "",
                        engineId: best.adapterId,
                        engineName: best.modelVariant,
                        values: { ...runtimeDefaults(best.controls), width: 512, height: 512, seed: Date.now() % 2147483647, precision: "BF16", outputFormat: "PNG", outputBitDepth: 8 },
                      });
                      if (!authorization.ok) throw new Error(authorization.error);
                      const result = await desktopGeneratePreparedImage({ token: authorization.token });
                      if (!result.ok) throw new Error(result.error);
                      const nextProduction = appendGeneratedIteration(picture.production, {
                        preparedAssetId: item.id,
                        iterationId: result.iterationId ?? `iteration:${asset.id}:${Date.now()}`,
                        output: {
                          ...result.output,
                          mediaBytes: new Uint8Array(result.output.mediaBytes),
                          sidecarBytes: new Uint8Array(result.output.sidecarBytes),
                        },
                        provenance: result.provenance,
                        continuityFindings: result.continuityFindings,
                        receiptDigest: result.receiptDigest,
                      });
                      replaceActive({ ...picture, production: nextProduction, updatedAt: Date.now() });
                      await refreshAuthorityStatus();
                      toast.success("Generated image iteration appended for review.");
                      setStage("review");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Prepared image generation failed.");
                    } finally {
                      setGenerating(null);
                    }
                  }}>{generating === item.id ? "Generating…" : "Authorize + generate"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setStage("review")}>Review iterations</Button>
                </div>
              </article>
            );
          }) : <EmptyCard title="No prepared assets" body="Approve asset specs, Visual Development, and Cinematography, then run Prepare Assets from Inventory." />}
        </section>
        <aside className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Native adapter manifest">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Exact local adapter</p>
          <h3 className="mt-1 font-display text-xl">{best ? best.modelVariant : "Unavailable"}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{blockedReason}</p>
          <div className="mt-4 grid gap-2">
            {(best?.components ?? []).slice(0, 7).map((component) => (
              <div key={component.opaqueId} className="rounded-sm bg-inset px-3 py-2 text-xs shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-2"><span className="text-muted">{component.role}</span><span className={component.present ? "text-accent" : "text-rec"}>{component.present ? "present" : "missing"}</span></div>
                <p className="mt-1 truncate text-subtle" title={component.rendererPath}>{component.stableId}</p>
              </div>
            ))}
          </div>
          <Button className="mt-4" variant="ghost" onClick={() => void import("@/lib/desktop/client").then((api) => api.desktopUnloadEngine()).then(() => toast.success("Local image model released."), (error) => toast.error(error instanceof Error ? error.message : "Release failed."))}>Release local image model</Button>
        </aside>
      </div>
      <section className="mt-6 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Video generation queue">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Wave 5 · Video queue</p>
        <h3 className="mt-1 font-display text-xl">Motion / {engineById(picture.selectedEngine.video)?.name ?? "video"}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{videoRuntimeBlock(videoEngineFromSelection(picture.selectedEngine.video))}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => {
            const now = Date.now();
            let workspace = hydrateVideoWorkspace(picture.video);
            let scheduler = recoverSchedulerSnapshot(emptySchedulerSnapshot(), now);
            for (const shot of picture.shots) {
              const pkg = compileEnginePromptPackage({ picture, shot, target: "video", now });
              workspace = enqueueVideoJob(workspace, { pictureId: picture.id, shotId: shot.id, selectedVideoEngine: picture.selectedEngine.video, promptPackage: pkg, now: now + picture.shots.indexOf(shot) });
              const job = workspace.jobs.at(-1);
              if (!job) continue;
              scheduler = enqueueSchedulerJob(scheduler, { id: job.id, kind: "video", pictureId: picture.id, label: shot.description, engineId: job.engineId, priority: 80, createdAt: now, dependsOn: [], vramHintBytes: 0 });
              workspace = failClosedVideoJob(workspace, job.id, videoRuntimeBlock(job.engineId), now + 1 + picture.shots.indexOf(shot));
            }
            replaceActive({ ...picture, video: { ...workspace, schedulerSnapshot: scheduler }, updatedAt: now });
            toast.error("Video jobs were queued and fail-closed. No still was substituted as video.");
            setStage("review");
          }} disabled={!picture.shots.length} title={picture.shots.length ? "Queue every shot and fail closed without invoking Comfy or cloud" : "Add shots first"}>Queue missing video</Button>
          <Button size="sm" variant="ghost" onClick={() => setStage("review")}>Review takes</Button>
        </div>
        <p className="mt-3 text-xs text-subtle">Shot readiness: {picture.shots.length ? picture.shots.map((shot) => `${shot.index}:${shotVideoReadiness(hydrateVideoWorkspace(picture.video), shot.id)}`).join(" · ") : "no shots"}</p>
      </section>
      {ready.length ? <p className="mt-4 text-xs text-subtle">{ready.length} prepared asset(s) are product-ready; generation still requires an exact READY manifest and one-use authorization.</p> : null}
    </Pane>
  );
}

function ReviewStage({ picture }: { picture: Picture }) {
  const production = picture.production;
  const replaceActive = useStudio((state) => state.replaceActive);
  const iterations = production?.assets.flatMap((asset) => asset.iterations.map((iteration) => ({ asset, iteration }))) ?? [];
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [backendStatus, setBackendStatus] = useState<Awaited<ReturnType<typeof desktopProductionAuthorityStatus>> | null>(null);
  const refreshAuthorityStatus = useCallback(async () => {
    if (!isDesktopApp()) return null;
    const status = await desktopProductionAuthorityStatus({ pictureId: picture.id });
    setBackendStatus(status);
    return status;
  }, [picture.id]);
  useEffect(() => { void refreshAuthorityStatus().catch(() => setBackendStatus({ ok: false, error: "Backend authority status unavailable." })); }, [refreshAuthorityStatus]);
  const authorityCurrent = backendStatus?.ok === true && backendStatus.status === "CURRENT" && backendStatus.authorityId === production?.productionAuthority?.authorityId && backendStatus.digest === production?.productionAuthority?.digest;
  const verifiedRoots = new Map((backendStatus?.ok === true ? (backendStatus.preparedApprovals ?? []) : []).map((root) => [root.preparedAssetId, root]));
  const backendCanonicalHistory = backendStatus?.ok === true ? (backendStatus.canonicalHistory ?? []) : [];
  function applyReview(nextProduction: NonNullable<Picture["production"]>) {
    replaceActive({ ...picture, production: nextProduction, updatedAt: Date.now() });
  }
  return (
    <Pane title="Review" kicker="11 · Iteration decisions">
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-muted">A/B review is append-only. Rejections, continuity confirmations, and canonical approvals preserve every generated file and sidecar; no output becomes canonical while dependencies, durable media, or identity confirmations are stale.</p>
      <div className="mb-4 rounded-md bg-inset p-3 text-xs text-muted shadow-[var(--shadow-border)]">{backendStatus?.ok === true ? `Backend authority: ${backendStatus.status.replaceAll("_", " ").toLowerCase()}${authorityCurrent ? " · exact current authority verified" : " · reseal/reconcile required"} · scoped decisions ${backendCanonicalHistory.length}` : backendStatus?.ok === false ? `Backend authority unavailable: ${backendStatus.error}` : "Backend authority status pending; review decisions fail closed."}</div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {iterations.length ? iterations.map(({ asset, iteration }) => {
          const findings = iteration.receiptContinuityFindings?.length ? iteration.receiptContinuityFindings : deterministicContinuityFindings(asset, iteration);
          const reason = reasons[iteration.id] ?? "";
          const allRequiredConfirmed = findings.every((finding) => finding.severity !== "blocker" || confirmed[finding.id]);
          const verifiedRoot = verifiedRoots.get(iteration.preparedAssetId ?? "");
          const rootCurrent = Boolean(verifiedRoot && verifiedRoot.rootId === (production?.preparedAssets ?? []).find((item) => item.id === iteration.preparedAssetId)?.preparedApprovalRootId && verifiedRoot.authorityId === production?.productionAuthority?.authorityId && verifiedRoot.authorityDigest === production?.productionAuthority?.digest);
          const backendDecision = backendCanonicalHistory.find((entry) => typeof entry === "object" && entry && "iterationId" in entry && entry.iterationId === iteration.id) as { kind?: string } | undefined;
          const backendCanonical = backendDecision?.kind === "canonicalDecision";
          const backendRejected = backendDecision?.kind === "rejectionDecision";
          return (
            <article key={iteration.id} className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[11px] tracking-wide text-subtle uppercase">{backendCanonical ? "APPROVED" : backendRejected ? "REJECTED" : iteration.status}</p><h3 className="truncate font-display text-xl">{asset.name}</h3></div>
                <Badge>{backendCanonical ? "canonical" : backendRejected ? "rejected" : "iteration"}</Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="overflow-hidden rounded-md bg-inset shadow-[var(--shadow-border)]">
                  <div className="flex min-h-11 items-center justify-between px-3 py-2 text-xs text-muted"><span>Approved reference/spec</span><span>A</span></div>
                  <div className="p-3 text-xs leading-relaxed text-muted">{asset.canonicalSpec.visualDescription || asset.canonicalSpec.distinguishingFeatures.join(" · ") || "No approved visual description recorded."}</div>
                </div>
                {iteration.mediaUri ? <div className="overflow-hidden rounded-md bg-inset shadow-[var(--shadow-border)]"><div className="flex min-h-11 items-center justify-between px-3 py-2 text-xs text-muted"><span>Generated candidate</span><span>B</span></div><img src={iteration.mediaUri} alt={`Generated iteration for ${asset.name}`} className="aspect-square w-full object-contain" /></div> : null}
              </div>
              <p className="mt-2 truncate text-xs text-muted" title={iteration.mediaUri}>{iteration.mediaUri}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Stat k="Media hash" v={iteration.mediaSha256 ? `${iteration.mediaSha256.slice(0, 10)}…` : "not recorded"} />
                <Stat k="Sidecar" v={iteration.sidecarSha256 ? `${iteration.sidecarSha256.slice(0, 10)}…` : "not recorded"} />
                <Stat k="Size" v={iteration.width && iteration.height ? `${iteration.width} × ${iteration.height}` : "unknown"} />
                <Stat k="Decisions" v={String(iteration.reviewDecisionIds?.length ?? iteration.reviewDecisions?.length ?? 0)} />
              </dl>
              <fieldset className="mt-3 rounded-sm bg-inset p-3 shadow-[var(--shadow-border)]">
                <legend className="text-[11px] tracking-wide text-subtle uppercase">Continuity checklist</legend>
                {findings.length ? findings.map((finding) => (
                  <label key={finding.id} className="mt-2 flex min-h-11 items-start gap-2 text-xs text-muted">
                    <input className="mt-1" type="checkbox" checked={Boolean(confirmed[finding.id])} onChange={(event) => setConfirmed((current) => ({ ...current, [finding.id]: event.target.checked }))} />
                    <span><span className={finding.severity === "blocker" ? "text-rec" : "text-fg"}>{finding.severity}</span> · {finding.message}</span>
                  </label>
                )) : <p className="mt-2 text-xs text-muted">No automated vision claim is made. Enter a visible review reason before approval.</p>}
              </fieldset>
              <div className="mt-3"><Label htmlFor={`reason-${iteration.id}`}>Reviewer reason</Label><Textarea id={`reason-${iteration.id}`} className="mt-1.5 min-h-20" value={reason} onChange={(event) => setReasons((current) => ({ ...current, [iteration.id]: event.target.value }))} placeholder="Describe the visible identity/continuity evidence for this decision." /></div>
              <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!production || !authorityCurrent || !rootCurrent || !iteration.generationReceiptId || !iteration.generationReceiptDigest || backendRejected || backendCanonical || !reason.trim() || !allRequiredConfirmed} title="Verify durable media, then approve this reviewed iteration as canonical" onClick={async () => {
                if (!production) return;
                try {
                  const latest = await refreshAuthorityStatus();
                  const latestRoot = latest?.ok === true ? (latest.preparedApprovals ?? []).find((root) => root.preparedAssetId === iteration.preparedAssetId) : null;
                  const preparedApprovalRootId = (production.preparedAssets ?? []).find((item) => item.id === iteration.preparedAssetId)?.preparedApprovalRootId ?? "";
                  if (latest?.ok !== true || latest.status !== "CURRENT" || latest.authorityId !== production.productionAuthority?.authorityId || latest.digest !== production.productionAuthority?.digest || latestRoot?.rootId !== preparedApprovalRootId) throw new Error("Backend authority/prepared root mismatch; reseal or re-approve before canonical approval.");
                  const confirmedContinuityFindings = findings.map((finding) => ({ ...finding, confirmed: finding.confirmed || Boolean(confirmed[finding.id]) }));
                  const approved = await desktopApproveCanonicalImage({ authorityId: latest.authorityId ?? "", preparedApprovalRootId, receiptId: iteration.generationReceiptId ?? "", iterationId: iteration.id, reason, findings: confirmedContinuityFindings.map(({ id, confirmed }) => ({ id, confirmed })) });
                  if (!approved.ok) throw new Error(approved.error);
                  applyReview(approveCanonicalIteration(production, { iterationId: iteration.id, reviewer: "user", reason, canonicalProof: approved.proof, continuityFindings: confirmedContinuityFindings }));
                  await refreshAuthorityStatus();
                  toast.success("Canonical image iteration approved.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Canonical approval failed.");
                }
              }}>Approve canonical</Button><Button size="sm" variant="outline" disabled={!production || !authorityCurrent || !rootCurrent || backendRejected || backendCanonical || !iteration.generationReceiptId || !reason.trim()} title="Reject this iteration append-only" onClick={async () => {
                if (!production) return;
                try {
                  const latest = await refreshAuthorityStatus();
                  const latestRoot = latest?.ok === true ? (latest.preparedApprovals ?? []).find((root) => root.preparedAssetId === iteration.preparedAssetId) : null;
                  const preparedApprovalRootId = (production.preparedAssets ?? []).find((item) => item.id === iteration.preparedAssetId)?.preparedApprovalRootId ?? "";
                  if (latest?.ok !== true || latest.status !== "CURRENT" || latest.authorityId !== production.productionAuthority?.authorityId || latest.digest !== production.productionAuthority?.digest || latestRoot?.rootId !== preparedApprovalRootId) throw new Error("Backend authority/prepared root mismatch; reseal or re-approve before rejection.");
                  const rejected = await desktopRejectCanonicalImage({ authorityId: latest.authorityId ?? "", preparedApprovalRootId, receiptId: iteration.generationReceiptId ?? "", iterationId: iteration.id, reason });
                  if (!rejected.ok) throw new Error(rejected.error);
                  applyReview(reviewGeneratedIteration(production, { iterationId: iteration.id, decision: "reject", reviewer: "user", reason }));
                  await refreshAuthorityStatus();
                  toast.success("Image iteration rejected.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Reject failed.");
                }
              }}>Reject</Button></div>
            </article>
          );
        }) : <EmptyCard title="No generated iterations" body="Generate from an approved prepared asset after the native adapter gate passes. Imported or shot-only stills do not satisfy Wave 4." />}
      </div>
      <section className="mt-6" aria-label="Video takes">
        <p className="mb-3 text-[11px] tracking-wide text-subtle uppercase">Video takes</p>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {hydrateVideoWorkspace(picture.video).takes.length ? hydrateVideoWorkspace(picture.video).takes.map((take) => (
            <article key={take.id} className="min-w-0 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[11px] tracking-wide text-subtle uppercase">{take.status.replaceAll("_", " ")}</p><h3 className="truncate font-display text-xl">{take.shotId} · {take.engineId}</h3></div>
                <Badge>{take.canonical ? "canonical" : take.kind}</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{take.failClosedReason ?? take.reviewReason ?? "Queued video take."}</p>
              <p className="mt-2 text-xs text-subtle">{take.mediaUri ?? "No durable video media. Stills are not video."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  try {
                    replaceActive({ ...picture, video: reviewVideoTake(hydrateVideoWorkspace(picture.video), take.id, "reject", "Rejected: no genuine video media.") });
                    toast.success("Video take rejected and retained as history.");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Reject failed.");
                  }
                }}>Reject take</Button>
                <Button size="sm" disabled title="Canonical video approval requires durable probed media from an official native worker.">Approve canonical</Button>
              </div>
            </article>
          )) : <EmptyCard title="No video takes" body="Queue missing video from Generate. Wave 5 fail-closes MiniMax H3 and LTX 2.5 until an official non-Comfy native worker exists." />}
        </div>
      </section>
    </Pane>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-lg bg-elevated p-5 text-sm text-muted shadow-[var(--shadow-border)]"><h3 className="font-display text-xl text-fg">{title}</h3><p className="mt-2 leading-relaxed">{body}</p></div>;
}

function StitchStage({ picture }: { picture: Picture }) {
  const selectedShotId = useStudio((s) => s.selectedShotId);
  const shot = picture.shots.find((s) => s.id === selectedShotId) ?? picture.shots[0];
  return (
    <Pane title="Stitch" kicker="12 · Assembly">
      <div className="overflow-hidden rounded-lg bg-inset shadow-[var(--shadow-border)]">
        <div className="grid h-[clamp(12rem,48dvh,32rem)] place-items-center">
          {shot?.videoUrl ? (
            <video src={shot.videoUrl} className="size-full object-contain" controls playsInline />
          ) : shot?.stillUrl ? (
            <img src={shot.stillUrl} alt="" className="size-full object-contain" />
          ) : (
            <div className="grid size-full place-items-center text-sm text-subtle">Select a shot</div>
          )}
        </div>
      </div>
      <ol className="mt-4 grid gap-1">
        {picture.shots.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-sm bg-elevated px-3 py-2 text-xs">
            <span>
              {String(s.index).padStart(2, "0")} {s.description}
            </span>
            <span className="text-subtle">{s.durationSec}s</span>
          </li>
        ))}
      </ol>
    </Pane>
  );
}

function ScoreStage({ picture }: { picture: Picture }) {
  return (
    <Pane title="Score" kicker="13 · Music + SFX">
      <p className="mb-4 max-w-xl text-sm text-muted">Review the saved cue sheet locally. Music generation remains unavailable until a native adapter passes validation.</p>
      <div role="status" className="max-w-xl rounded-md bg-inset px-3 py-2 text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">Local score adapter unavailable · no cloud fallback</div>
      <div className="mt-5 grid gap-3">
        {picture.cues.map((c) => (
          <article key={c.id} className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
            <h3 className="font-display text-xl">{c.name}</h3>
            <p className="mt-1 text-xs text-muted">{c.mood}</p>
            <p className="mt-2 text-xs">{c.instruments}</p>
            <p className="mt-3 text-[11px] text-subtle uppercase">Music3</p>
            <p className="mt-1 text-xs text-muted">{c.minimaxPrompt}</p>
            <p className="mt-3 text-[11px] text-subtle uppercase">SFX</p>
            <p className="mt-1 text-xs text-muted">{c.sfx}</p>
          </article>
        ))}
      </div>
    </Pane>
  );
}

function ExportStage({ picture }: { picture: Picture }) {
  const dur = totalDuration(picture);
  const [files, setFiles] = useState<ReadyFile[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  async function pull(file: ReadyFile) {
    setFiles((prev) => {
      prev.filter((f) => f.filename !== file.filename).forEach((f) => URL.revokeObjectURL(f.href));
      return [file, ...prev.filter((f) => f.filename !== file.filename)];
    });
    const result = await saveReadyFile(file);
    if (result === "saved") toast.success(`Saved ${file.filename}`);
    else if (result === "linked") toast.message("Use Save in the tray if nothing landed in Downloads.");
  }

  return (
    <Pane title="Export" kicker="14 · Delivery">
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
                if (!result.canceled) toast.success(`Saved ${result.count} files to ${result.folderLabel}`);
                return;
              }
              toast.success("Six files ready. Hit Save on each.");
            })();
          }}
        >
          Prepare all
        </Button>
      </div>
      {files.length ? (
        <div className="mt-6 max-w-xl rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Ready to save</p>
          <ul className="mt-3 grid gap-2">
            {files.map((file) => (
              <li key={file.filename} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-inset px-3 py-2">
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
      <p className="mt-6 max-w-lg text-xs text-muted">
        Standalone delivery. No Comfy graph. Local weights remain at {MODEL_ROOT}.
      </p>
    </Pane>
  );
}

function EnginePick() {
  const picture = useActivePicture();
  const setEngines = useStudio((s) => s.setEngines);
  if (!picture) return null;
  const slots = [
    { key: "director" as const, kind: "director" as const },
    { key: "image" as const, kind: "image" as const },
    { key: "video" as const, kind: "video" as const },
    { key: "voice" as const, kind: "voice" as const },
    { key: "music" as const, kind: "music" as const },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {slots.map((slot) => (
        <div key={slot.key}>
          <Label>{KIND_LABEL[slot.kind]}</Label>
          <select
            className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]"
            value={picture.selectedEngine[slot.key]}
            onChange={(e) => setEngines({ [slot.key]: e.target.value })}
          >
            {ENGINES.filter((e) => e.kind === slot.kind && !e.note).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
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
      <Input className="mt-1.5" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
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
  const picture = useActivePicture();
  const currentIndex = Math.max(0, STAGES.findIndex((item) => item.id === stage));
  const current = STAGES[currentIndex];
  const stageDone = (id: StageId) =>
    (id === "intake" && Boolean(picture?.intake.title)) ||
    (id === "research" && Boolean(picture?.research?.approvedVersionId)) ||
    (id === "screenplay" && (picture?.screenplay.status === "READY_FOR_REVIEW" || picture?.screenplay.status === "APPROVED")) ||
    (id === "inventory" && (picture?.production?.assets.length ?? 0) > 0) ||
    (id === "visual-development" && Boolean(picture?.visualDevelopment?.approvals.length)) ||
    (id === "cinematography" && Boolean(picture?.cinematography?.approvals.length)) ||
    (id === "performance" && Object.values(picture?.performance?.performance ?? {}).some((directions) => Object.values(directions).some((direction) => Boolean(direction.approvedAt)))) ||
    (id === "shots" && Boolean(picture?.performance?.shots.length) && Object.values(picture?.performance?.queue ?? {}).every((entry) => entry.readiness === "READY_TO_GENERATE")) ||
    (id === "prompts" && Boolean(picture?.shots[0]?.t2iPrompt)) ||
    (id === "generate" && Boolean(picture?.shots.some((shot) => shot.stillUrl))) ||
    (id === "score" && (picture?.cues.length ?? 0) > 0);

  return (
    <nav className="min-w-0 max-w-full overflow-hidden" aria-label="Pipeline" data-active-stage={stage}>
      <div className="hidden grid-cols-[repeat(13,minmax(0,1fr))] gap-1 px-2 py-2 xl:grid">
        {STAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-stage-id={item.id}
            aria-label={`${item.number} ${item.label}`}
            aria-current={stage === item.id ? "step" : undefined}
            onClick={() => setStage(item.id as StageId)}
            className={cn(
              "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-xs",
              stage === item.id ? "bg-elevated text-fg" : "text-muted hover:text-fg",
            )}
          >
            <span className="shrink-0 text-[10px] text-subtle">{item.number}</span>
            <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
            {stageDone(item.id as StageId) ? <span className="size-1.5 shrink-0 rounded-full bg-good" /> : null}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-2 px-2 py-2 xl:hidden">
        <Button size="icon-sm" variant="ghost" aria-label="Previous stage" disabled={currentIndex === 0} onClick={() => setStage(STAGES[currentIndex - 1].id as StageId)}><ChevronLeft /></Button>
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1 text-[9px] tracking-wide text-subtle uppercase">Stage {currentIndex + 1} of {STAGES.length}</span>
          <select
            aria-label="Pipeline stage"
            value={stage}
            onChange={(event) => setStage(event.target.value as StageId)}
            className="h-11 w-full min-w-0 appearance-none rounded-sm bg-elevated px-3 pb-1 pt-4 text-xs text-fg shadow-[var(--shadow-border)] outline-none focus:shadow-[var(--shadow-border-hover)]"
          >
            {STAGES.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.label}</option>)}
          </select>
        </label>
        <span className="hidden shrink-0 items-center gap-2 text-xs text-muted sm:flex" aria-hidden="true"><span className="text-subtle">{current.number}</span>{current.label}{stageDone(current.id as StageId) ? <span className="size-1.5 rounded-full bg-good" /> : null}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Next stage" disabled={currentIndex === STAGES.length - 1} onClick={() => setStage(STAGES[currentIndex + 1].id as StageId)}><ChevronRight /></Button>
      </div>
    </nav>
  );
}
