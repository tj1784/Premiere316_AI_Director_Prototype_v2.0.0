import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
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
import { totalDuration } from "@/lib/studio/prompt-compiler";
import { desktopSaveMany, isDesktopApp } from "@/lib/desktop/client";
import { cn, copyText, formatTimecode, saveReadyFile, uid, type ReadyFile } from "@/lib/utils";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { SOURCE_TYPE_LABELS } from "@/lib/studio/picture-intake";
import type { ScreenplayModelRef } from "@/lib/studio/screenplay";
import { addManualScreenplayVersion, approveCurrentScreenplay, restoreScreenplayVersion } from "@/lib/studio/screenplay";
import type { ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import type { ScreenplayJobSnapshot } from "@/lib/studio/screenplay-jobs.server";
import { beginScreenplayJob, localLLMStatus, readScreenplayJob, stopScreenplayJob } from "@/lib/studio/screenplay-client";
import { ScreenplayWorkspace } from "./screenplay-workspace";
import { InventoryWorkspace } from "@/components/production/inventory-workspace";
import {
  approvedScreenplayInputFromBoundary,
  deterministicFountainExtractor,
  reconcileProductionBreakdown,
  runProductionBreakdown,
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
    case "screenplay":
      return <ScreenplayStage picture={picture} />;
    case "inventory":
      return <InventoryStage picture={picture} />;
    case "performance":
      return <PerformanceStage picture={picture} />;
    case "shots":
      return <ShotsStage picture={picture} />;
    case "prompts":
      return <PromptStage picture={picture} />;
    case "generate":
      return <GenerateStage picture={picture} />;
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
    <div className="stage-pane flex h-full min-h-0 min-w-0 flex-col">
      <header className="shrink-0 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">{kicker}</p>
        <h2 className="mt-1 truncate font-display text-[clamp(1.5rem,3vw,1.875rem)] tracking-tight" title={title}>{title}</h2>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">{children}</div>
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

  const start = async (options: { resume?: boolean; stepId?: ScreenplayStep["id"] } = {}) => {
    const modelId = picture.screenplay.selectedModelId ?? picture.intake.screenplayModelId;
    if (!modelId) {
      toast.error("Select a loaded LM Studio text model in Picture Intake.");
      return;
    }
    try {
      const initial = await beginScreenplayJob({
        intake: picture.intake,
        screenplay: picture.screenplay,
        modelId,
        resume: options.resume,
        stepId: options.stepId,
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
      onTextChange={(workingFountain) => persistScreenplay({ ...picture.screenplay, workingFountain, status: "READY_FOR_REVIEW", updatedAt: Date.now() })}
      onSaveRevision={() => persistScreenplay(addManualScreenplayVersion(picture.screenplay, picture.screenplay.workingFountain, uid("spv")))}
      onGenerate={() => void start()}
      onContinue={() => void start({ resume: true })}
      onRegeneratePass={(stepId) => void start({ stepId })}
      onStop={() => { if (jobId) void stopScreenplayJob(jobId).then((snapshot) => { if (snapshot) { setJob(snapshot); persistScreenplay(snapshot.screenplay); } }); }}
      onRestore={(versionId) => persistScreenplay(restoreScreenplayVersion(picture.screenplay, versionId, uid("spv")))}
      onApprove={() => persistScreenplay(approveCurrentScreenplay(picture.screenplay, uid("spv")))}
      onRescan={() => void scan()}
      onModelChange={(selectedModelId) => {
        const intake = { ...picture.intake, screenplayModelId: selectedModelId, updatedAt: Date.now() };
        persistScreenplay({ ...picture.screenplay, selectedModelId, updatedAt: Date.now() });
        patchActive({ intake });
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
          const production = picture.production
            ? reconcileProductionBreakdown(picture.production, extracted)
            : extracted;
          patchActive({ production });
          toast.success(`Production breakdown ready · ${production.assets.length} assets`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Unable to build production inventory.");
        } finally {
          setBusy(false);
        }
      }}
      onChange={(production) => patchActive({ production })}
    />
  );
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
        <div className="max-w-md"><p className="text-[11px] tracking-wide text-subtle uppercase">04 · Performance direction</p><h2 className="mt-1 font-display text-2xl tracking-tight">Approve the screenplay first</h2><p className="mt-2 text-sm leading-relaxed text-muted">Performance work begins from the immutable approved screenplay, never a working draft.</p></div>
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
        <div className="max-w-md"><p className="text-[11px] tracking-wide text-subtle uppercase">05 · Shot preparation</p><h2 className="mt-1 font-display text-2xl tracking-tight">Performance workspace required</h2><p className="mt-2 text-sm leading-relaxed text-muted">Approve the screenplay, then direct its beats before preparing coverage.</p></div>
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
  return (
    <Pane title="Prompt Lab" kicker="06 · Dialects">
      <p className="mb-4 max-w-xl text-sm text-muted">
        Still dialect {engineById(picture.selectedEngine.image)?.name}. Motion dialect{" "}
        {engineById(picture.selectedEngine.video)?.name}. Each shot is a 10–15s performance.
      </p>
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
  const { busy, animate } = useDirector();
  const selectShot = useStudio((s) => s.selectShot);
  const openStillBay = useStudio((s) => s.openStillBay);
  return (
    <Pane title="Generate" kicker="07 · Plates & performance">
      <p className="mb-4 max-w-xl text-sm text-muted">Stills first, then 10–15s I2V. Caps keep the director honest.</p>
      <div className="generation-grid grid gap-3">
        {picture.shots.map((s) => (
          <article key={s.id} className="overflow-hidden rounded-lg bg-elevated shadow-[var(--shadow-border)]">
            <button type="button" className="block w-full" onClick={() => selectShot(s.id)}>
              <div className="aspect-video bg-inset">
                {s.videoUrl ? (
                  <video src={s.videoUrl} className="size-full object-cover" controls playsInline />
                ) : s.stillUrl ? (
                  <img src={s.stillUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-xs text-subtle">No plate</div>
                )}
              </div>
            </button>
            <div className="p-3">
              <p className="text-[11px] text-subtle">
                {String(s.index).padStart(2, "0")} · {s.durationSec}s · {s.type}
              </p>
              <p className="mt-1 line-clamp-2 text-sm">{s.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy?.startsWith("still")} onClick={() => openStillBay(s.id)}>
                  Still
                </Button>
                <Button size="sm" variant="secondary" disabled={busy?.startsWith("clip")} onClick={() => animate(s.id)}>
                  I2V
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Pane>
  );
}

function StitchStage({ picture }: { picture: Picture }) {
  const selectedShotId = useStudio((s) => s.selectedShotId);
  const shot = picture.shots.find((s) => s.id === selectedShotId) ?? picture.shots[0];
  return (
    <Pane title="Stitch" kicker="08 · Assembly">
      <div className="overflow-hidden rounded-lg bg-inset shadow-[var(--shadow-border)]">
        <div className="aspect-video">
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
  const { busy, score } = useDirector();
  return (
    <Pane title="Score" kicker="09 · Music3 + SFX">
      <p className="mb-4 max-w-xl text-sm text-muted">MiniMax Music3 writes original beds. SFX sit on a sister track.</p>
      <Button disabled={busy === "score"} onClick={score}>
        {busy === "score" ? "Spotting…" : picture.cues.length ? "Rewrite cue sheet" : "Spot the picture"}
      </Button>
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
    <Pane title="Export" kicker="10 · Delivery">
      <dl className="grid max-w-md grid-cols-2 gap-3 text-sm">
        <Stat k="Runtime" v={formatTimecode(dur, picture.fps)} />
        <Stat k="Shots" v={String(picture.shots.length)} />
        <Stat k="Plates" v={String(picture.shots.filter((s) => s.stillUrl).length)} />
        <Stat k="Clips" v={String(picture.shots.filter((s) => s.videoUrl).length)} />
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">
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
  const setStage = useStudio((s) => s.setStage);
  const picture = useActivePicture();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 py-2" aria-label="Pipeline">
      {STAGES.map((s) => {
        const done =
          (s.id === "intake" && Boolean(picture?.intake.title)) ||
          (s.id === "screenplay" && (picture?.screenplay.status === "READY_FOR_REVIEW" || picture?.screenplay.status === "APPROVED")) ||
          (s.id === "inventory" && (picture?.production?.assets.length ?? 0) > 0) ||
          (s.id === "performance" && Object.values(picture?.performance?.performance ?? {}).some((directions) => Object.values(directions).some((direction) => Boolean(direction.approvedAt)))) ||
          (s.id === "shots" && Boolean(picture?.performance?.shots.length) && Object.values(picture?.performance?.queue ?? {}).every((entry) => entry.readiness === "READY_TO_GENERATE")) ||
          (s.id === "prompts" && Boolean(picture?.shots[0]?.t2iPrompt)) ||
          (s.id === "generate" && Boolean(picture?.shots.some((sh) => sh.stillUrl))) ||
          (s.id === "score" && (picture?.cues.length ?? 0) > 0);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setStage(s.id as StageId)}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 rounded-sm px-3 text-xs",
              stage === s.id ? "bg-elevated text-fg" : "text-muted hover:text-fg",
            )}
          >
            <span className="text-[10px] text-subtle">{s.number}</span>
            {s.label}
            {done ? <span className="size-1.5 rounded-full bg-good" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
