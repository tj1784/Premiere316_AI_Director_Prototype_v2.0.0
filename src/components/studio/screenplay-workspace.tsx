import { useEffect, useMemo, useState } from "react";
import { Check, Circle, GitCompareArrows, LoaderCircle, RotateCcw, Save, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { screenplaySteps, type ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import { screenplayModelDetail } from "@/lib/studio/screenplay-models";
import { screenplayScenes, type PictureScreenplay, type ScreenplayModelRef } from "@/lib/studio/screenplay";
import { isLlamaQaCandidate as isLlamaFamily, isPinnedExactServedReady, isQwenWriterCandidate as isQwenFamily, llamaQaBlockReason, qwenWriterBlockReason } from "@/lib/studio/qwen-writer-identity.ts";
import { DEFAULT_CREW_WRITER_DISPLAY, OPTIONAL_CREW_WRITER_DISPLAY } from "@/lib/studio/model-routing.ts";
import { applyExplicitQaRewrite } from "@/lib/studio/screenplay-qa.ts";
import { defaultScreenplayScope, SCREENPLAY_SCOPES, type ScreenplayRewriteTarget, type ScreenplayScope, type ScreenplaySelection } from "@/lib/studio/screenplay-scope.ts";
import { parseScreenplayHierarchy } from "@/lib/studio/screenplay-hierarchy.ts";
import type { ScreenplayJobSnapshot } from "@/lib/studio/screenplay-jobs.server";

function statusLabel(status: PictureScreenplay["status"]): string {
  if (status === "READY_FOR_REVIEW") return "Ready for review";
  if (status === "APPROVED") return "Screenplay approved";
  return status === "GENERATING" ? "Generating" : "Draft";
}

export function ScreenplayWorkspace({
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
  onQaPin,
  onReleaseResident,
  researchApproved,
}: {
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
  onStoryDoctor?: (modelId: string, target: ScreenplayRewriteTarget, secondOpinion: boolean) => void;
  onApplyQaRevision?: (next: PictureScreenplay) => void;
  onQaPin?: (servedModelId: string | null) => void;
  onReleaseResident?: () => void;
  researchApproved: boolean;
}) {
  const [compareId, setCompareId] = useState<string>("");
  const [passId, setPassId] = useState<ScreenplayStep["id"]>("pass-1");
  const [qaModelId, setQaModelId] = useState("");
  const [rewriteScope, setRewriteScope] = useState<ScreenplayScope>("scene");
  const [secondOpinion, setSecondOpinion] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<ScreenplaySelection>(null);
  const generation = job?.screenplay.generation ?? screenplay.generation;
  const running = job?.status === "queued" || job?.status === "running" || screenplay.status === "GENERATING";
  const stopped = job?.status === "canceled";
  const shownText = running && job?.partialFountain ? job.partialFountain : screenplay.workingFountain;
  const scenes = useMemo(() => screenplayScenes(shownText), [shownText]);
  const selected = models.find((model) => model.id === screenplay.selectedModelId) ?? null;
  const compared = screenplay.versions.find((version) => version.id === compareId) ?? null;
  const steps = screenplaySteps(screenplay.workflow);
  const passSteps = steps.filter((step) => step.pass !== null);
  const writerPin = screenplay.pinnedWriterServedId ?? null;
  const qaPin = screenplay.pinnedQaServedId ?? null;
  const selectedReady = Boolean(selected && isPinnedExactServedReady(selected, writerPin) && (isLlamaFamily(selected) || isQwenFamily(selected)) && provider?.available);
  const writerBlock = qwenWriterBlockReason(selected, Boolean(provider?.available), writerPin);
  const generateEnabled = researchApproved && selectedReady && !writerBlock;
  const generateBlock = !researchApproved ? "Approve Picture Research before generating a screenplay." : writerBlock;
  const hierarchy = useMemo(() => parseScreenplayHierarchy(shownText, screenplay.hierarchy), [shownText, screenplay.hierarchy]);
  const defaultQaModel = models.find((model) => model.servedModelId === (qaPin || (selected && isLlamaFamily(selected) && writerPin === selected.servedModelId ? writerPin : null))) ?? null;
  const effectiveQaModelId = qaModelId || defaultQaModel?.id || "";
  const qaModel = models.find((model) => model.id === effectiveQaModelId) ?? null;
  const effectiveQaPin = qaPin || (selected && isLlamaFamily(selected) ? writerPin : null);
  const qaBlock = llamaQaBlockReason(qaModel, writerPin, Boolean(provider?.available), effectiveQaPin, secondOpinion);
  const rewriteTarget: ScreenplayRewriteTarget = {
    scope: rewriteScope,
    nodeId: selectedNodeId,
    nodeIds: selectedNodeIds.length ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : null),
    selection,
  };
  useEffect(() => {
    if (qaPin || !selected || !writerPin || !isLlamaFamily(selected) || selected.servedModelId !== writerPin) return;
    setQaModelId((current) => current || selected.id);
    onQaPin?.(writerPin);
  }, [qaPin, selected, writerPin, onQaPin]);
  const qaReport = screenplay.lastQaReport ?? null;
  const applyableIndex = qaReport?.findings.findIndex((finding) => Boolean(finding.rewriteSuggested?.trim())) ?? -1;
  const completed = new Set(generation?.completedLabels ?? screenplay.versions.map((version) => version.label === "Draft 1" ? "Draft" : version.label));

  return (
    <div className="grid h-full min-h-0 min-w-0 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)_minmax(14rem,18rem)]">
      <aside className="hidden min-h-0 overflow-y-auto border-r border-border p-3 lg:block">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Scenes</p>
        <ol className="mt-3 grid gap-1">
          {hierarchy.nodes.filter((node) => node.kind === "scene").map((scene, index) => <li key={scene.id}><button type="button" aria-pressed={selectedNodeIds.includes(scene.id) || selectedNodeId === scene.id} className={`w-full rounded-sm px-2 py-2 text-left text-xs hover:bg-elevated hover:text-fg ${selectedNodeIds.includes(scene.id) || selectedNodeId === scene.id ? "bg-elevated text-fg" : "text-muted"}`} onClick={(event) => {
            if (event.ctrlKey || event.metaKey) {
              const next = selectedNodeIds.includes(scene.id) ? selectedNodeIds.filter((id) => id !== scene.id) : [...selectedNodeIds, scene.id];
              setSelectedNodeIds(next);
              setSelectedNodeId(next[next.length - 1] ?? scene.id);
              if (next.length > 1) setRewriteScope("selected-scenes");
              else setRewriteScope(defaultScreenplayScope(scene));
              return;
            }
            setSelectedNodeId(scene.id);
            setSelectedNodeIds([scene.id]);
            setRewriteScope(defaultScreenplayScope(scene, selection));
          }}><span className="mr-2 text-[10px] tabular-nums text-subtle">{String(index + 1).padStart(2, "0")}</span>{scene.slugline ?? scene.title}</button></li>)}
        </ol>
        {!scenes.length ? <p className="mt-3 text-xs leading-relaxed text-muted">Scene headings appear here as the Fountain draft develops.</p> : null}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">03 · Screenplay</p><h2 className="mt-1 font-display text-xl tracking-tight">{intake.title || "Untitled Picture"}</h2></div>
            <div className="flex flex-wrap items-center gap-2"><Badge>{statusLabel(running ? "GENERATING" : screenplay.status)}</Badge>{screenplay.status === "APPROVED" ? <Badge>Canonical</Badge> : null}</div>
          </div>
          {generation ? <div className="mt-3"><p className="text-xs text-muted">{job?.activeLabel ?? generation.activeLabel}</p><ol className="mt-2 flex flex-wrap gap-2">{steps.map((step) => { const active = generation.activeLabel === step.label; const done = completed.has(step.label); return <li key={step.id} className="flex items-center gap-1 text-[11px] text-muted">{done ? <Check className="size-3 text-good" /> : active ? <LoaderCircle className="size-3 animate-spin text-accent" /> : <Circle className="size-2.5 text-subtle" />}{step.label}</li>; })}</ol></div> : null}
          {job?.error ? <p role="alert" className="mt-2 text-xs text-rec">{job.error}</p> : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {compared ? <div className="mb-4 grid gap-3 xl:grid-cols-2"><section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"><p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">Current</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">{screenplay.workingFountain}</pre></section><section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"><p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">{compared.label}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">{compared.fountain}</pre></section></div> : null}
          <Textarea aria-label="Fountain screenplay" className="screenplay min-h-[36rem] resize-y bg-inset font-mono leading-relaxed" value={shownText} readOnly={running} onChange={(event) => onTextChange(event.target.value)} onSelect={(event) => {
            const start = event.currentTarget.selectionStart ?? 0;
            const end = event.currentTarget.selectionEnd ?? 0;
            if (end > start) {
              setSelection({ start, end });
              setRewriteScope("selected-text");
            } else {
              setSelection(null);
            }
          }} placeholder="Your Fountain screenplay will appear here." />
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Button variant="rec" onClick={onStop}><Square />Stop</Button> : <Button onClick={() => onGenerate(rewriteTarget)} disabled={!generateEnabled} title={generateBlock ?? undefined}>Generate Screenplay</Button>}
            {stopped ? <Button variant="secondary" onClick={() => onContinue(rewriteTarget)} disabled={!generateEnabled}>Continue</Button> : null}
            <Button variant="secondary" disabled={running || !screenplay.workingFountain.trim()} onClick={onSaveRevision}><Save />Save Revision</Button>
            <Button variant="secondary" disabled={running || !passSteps.length || !generateEnabled} onClick={() => onRegeneratePass(passId, rewriteTarget)}><RotateCcw />Regenerate Pass</Button>
            {passSteps.length ? <select aria-label="Pass to regenerate" className="h-9 rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={passId} onChange={(event) => setPassId(event.target.value as ScreenplayStep["id"])}>{passSteps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}</select> : null}
            <Button className="ml-auto" disabled={running || !screenplay.workingFountain.trim() || screenplay.status === "APPROVED"} onClick={onApprove}><Check />Approve Screenplay</Button>
          </div>
        </footer>
      </section>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-border p-4 lg:block">
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Writer</p><button type="button" onClick={onRescan} className="text-[11px] text-muted hover:text-fg">Rescan</button></div>
        <select aria-label="Writer" className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={screenplay.selectedModelId ?? ""} onChange={(event) => onModelChange(event.target.value || null)}><option value="">Default writer · {DEFAULT_CREW_WRITER_DISPLAY}</option>{models.map((model) => <option key={model.id} value={model.id} disabled={model.status !== "ready" || !(isLlamaFamily(model) || isQwenFamily(model))}>{isLlamaFamily(model) ? `${model.displayName} · Llama default` : isQwenFamily(model) ? `${model.displayName} · Optional Qwen` : model.displayName}</option>)}</select>
        {writerPin ? <p className="mt-2 truncate text-[11px] text-subtle" title={writerPin}>Pinned writer ID: {writerPin}</p> : <p className="mt-2 text-[11px] text-subtle">No writer ID pinned. Premiere316 will not load a model.</p>}
        {selected ? <><p className="mt-3 text-sm">{selected.displayName}</p><p className="mt-1 text-xs leading-relaxed text-muted">{screenplayModelDetail(selected)}</p><p className="mt-2 text-[11px] text-subtle">{generateBlock ?? selected.statusReason}</p></> : <p className="mt-3 text-xs leading-relaxed text-muted">{generateBlock ?? provider?.reason ?? "Checking LM Studio local API…"}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">Workflow: Write → QA → Revise. Same resident Llama may serve both roles sequentially.</p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Scope</p>
        <select aria-label="Rewrite scope" className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={rewriteScope} onChange={(event) => setRewriteScope(event.target.value as ScreenplayScope)}>{SCREENPLAY_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">Default is the smallest selection ({defaultScreenplayScope(hierarchy.nodes.find((node) => node.kind === "scene") ?? null)}). Unrelated IDs stay byte-identical.</p>
        <div className="my-5 border-t border-border" />
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">QA</p>
        <select aria-label="Story Doctor model" className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={effectiveQaModelId} onChange={(event) => {
          const id = event.target.value;
          setQaModelId(id);
          onQaPin?.(models.find((model) => model.id === id)?.servedModelId ?? null);
        }}><option value="">Default QA · {DEFAULT_CREW_WRITER_DISPLAY}</option>{models.map((model) => <option key={model.id} value={model.id} disabled={model.status !== "ready" || !(isLlamaFamily(model) || isQwenFamily(model))}>{isLlamaFamily(model) ? `${model.displayName} · Llama default` : isQwenFamily(model) ? `${model.displayName} · Optional ${OPTIONAL_CREW_WRITER_DISPLAY}` : model.displayName}</option>)}</select>
        {qaPin ? <p className="mt-2 truncate text-[11px] text-subtle" title={qaPin}>Pinned Story Doctor ID: {qaPin}</p> : <p className="mt-2 text-[11px] text-subtle">No Story Doctor ID pinned.</p>}
        <label className="mt-3 flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={secondOpinion} onChange={(event) => setSecondOpinion(event.target.checked)} />Second opinion · Qwen (explicit, never automatic)</label>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{qaBlock ?? "Critique first. Fountain does not change until you apply a scoped revision."}</p>
        <Button className="mt-3 w-full" size="sm" variant="secondary" disabled={Boolean(qaBlock) || running || !effectiveQaModelId} onClick={() => onStoryDoctor?.(effectiveQaModelId, rewriteTarget, secondOpinion)}>Run story doctor</Button>
        {qaReport ? <div className="mt-3 grid gap-2" aria-label="Story Doctor critique">{qaReport.findings.map((finding, index) => <article key={`${qaReport.id}-${index}`} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"><p className="text-[10px] tracking-wide text-subtle uppercase">{finding.category} · {finding.severity}</p><p className="mt-1 text-xs leading-relaxed">{finding.summary}</p></article>)}</div> : null}
        <Button className="mt-3 w-full" size="sm" disabled={running || applyableIndex < 0 || !qaReport || !qaModel} onClick={() => {
          if (!qaReport || !qaModel || applyableIndex < 0) return;
          const applied = applyExplicitQaRewrite(screenplay, {
            id: qaReport.id,
            createdAt: qaReport.createdAt,
            model: qaModel,
            fountainUnchanged: true,
            role: "qa-critic",
            findings: qaReport.findings.map((finding) => ({
              category: finding.category as import("@/lib/studio/screenplay-qa.ts").ScreenplayQaCategory,
              severity: finding.severity === "blocker" || finding.severity === "warning" ? finding.severity : "note" as const,
              summary: finding.summary,
              exactScope: finding.exactScope ?? null,
              recommendation: finding.recommendation ?? null,
              revisionRequired: Boolean(finding.revisionRequired),
              rewriteSuggested: finding.rewriteSuggested,
            })),
          }, applyableIndex, rewriteScope, selectedNodeId, `spv-qa-${Date.now()}`, Date.now(), { nodeIds: rewriteTarget.nodeIds, selection, previous: hierarchy });
          if ("error" in applied) return;
          onApplyQaRevision?.(applied);
        }}>Apply scoped revision</Button>
        <Button className="mt-3 w-full" size="sm" variant="ghost" disabled={running} onClick={() => onReleaseResident?.()}>Release local model</Button>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">Prompt compiler default: {DEFAULT_CREW_WRITER_DISPLAY} (inactive until Prompt Lab / Wave 5).</p>
        <div className="my-5 border-t border-border" />
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Versions</p><span className="text-[10px] tabular-nums text-subtle">{screenplay.versions.length}</span></div>
        <ol className="mt-3 grid gap-2">{[...screenplay.versions].reverse().map((version) => <li key={version.id} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs" title={version.label}>{version.label}</p>{version.id === screenplay.currentVersionId ? <span className="text-[9px] tracking-wide text-accent uppercase">Current</span> : null}</div><p className="mt-1 text-[10px] text-subtle">{new Date(version.createdAt).toLocaleString()}</p><div className="mt-2 flex gap-1"><Button size="sm" variant="ghost" onClick={() => setCompareId(compareId === version.id ? "" : version.id)}><GitCompareArrows />Compare</Button><Button size="sm" variant="ghost" disabled={running || version.id === screenplay.currentVersionId} onClick={() => onRestore(version.id)}>Restore</Button></div></li>)}</ol>
        {screenplay.lastTelemetry ? <><div className="my-5 border-t border-border" /><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Last run</p><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-subtle">Provider</dt><dd>{screenplay.lastTelemetry.provider}</dd></div><div><dt className="text-subtle">Endpoint</dt><dd className="truncate" title={screenplay.lastTelemetry.endpoint}>{screenplay.lastTelemetry.endpoint.replace("http://127.0.0.1", "localhost")}</dd></div><div><dt className="text-subtle">Local</dt><dd>{screenplay.lastTelemetry.local ? "Yes" : "No"}</dd></div><div><dt className="text-subtle">Cloud fallback</dt><dd>{screenplay.lastTelemetry.cloudFallback ? "Yes" : "No"}</dd></div><div><dt className="text-subtle">Generation</dt><dd className="tabular-nums">{screenplay.lastTelemetry.generationMs === null ? "Unavailable" : `${(screenplay.lastTelemetry.generationMs / 1000).toFixed(1)}s`}</dd></div><div><dt className="text-subtle">Unload</dt><dd>{screenplay.lastTelemetry.unloadVerification}</dd></div></dl></> : null}
      </aside>
    </div>
  );
}
