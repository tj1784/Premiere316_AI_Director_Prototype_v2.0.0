import { useMemo, useState } from "react";
import { Check, Circle, GitCompareArrows, LoaderCircle, RotateCcw, Save, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import type { PictureIntake } from "@/lib/studio/picture-intake";
import { screenplaySteps, type ScreenplayStep } from "@/lib/studio/screenplay-prompts";
import { screenplayModelDetail } from "@/lib/studio/screenplay-models";
import { screenplayScenes, type PictureScreenplay, type ScreenplayModelRef } from "@/lib/studio/screenplay";
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
}: {
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  models: ScreenplayModelRef[];
  provider: LocalLLMProviderDiscovery | null;
  job: ScreenplayJobSnapshot | null;
  onTextChange: (fountain: string) => void;
  onSaveRevision: () => void;
  onGenerate: () => void;
  onContinue: () => void;
  onRegeneratePass: (stepId: ScreenplayStep["id"]) => void;
  onStop: () => void;
  onRestore: (versionId: string) => void;
  onApprove: () => void;
  onRescan: () => void;
  onModelChange: (modelId: string | null) => void;
}) {
  const [compareId, setCompareId] = useState<string>("");
  const [passId, setPassId] = useState<ScreenplayStep["id"]>("pass-1");
  const generation = job?.screenplay.generation ?? screenplay.generation;
  const running = job?.status === "queued" || job?.status === "running" || screenplay.status === "GENERATING";
  const stopped = job?.status === "canceled";
  const shownText = running && job?.partialFountain ? job.partialFountain : screenplay.workingFountain;
  const scenes = useMemo(() => screenplayScenes(shownText), [shownText]);
  const selected = models.find((model) => model.id === screenplay.selectedModelId) ?? null;
  const compared = screenplay.versions.find((version) => version.id === compareId) ?? null;
  const steps = screenplaySteps(screenplay.workflow);
  const passSteps = steps.filter((step) => step.pass !== null);
  const selectedReady = Boolean(selected && selected.status === "ready" && provider?.available);
  const completed = new Set(generation?.completedLabels ?? screenplay.versions.map((version) => version.label === "Draft 1" ? "Draft" : version.label));

  return (
    <div className="grid h-full min-h-0 min-w-0 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)_minmax(14rem,18rem)]">
      <aside className="hidden min-h-0 overflow-y-auto border-r border-border p-3 lg:block">
        <p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Scenes</p>
        <ol className="mt-3 grid gap-1">
          {scenes.map((scene, index) => <li key={`${scene.line}-${scene.slugline}`}><button type="button" className="w-full rounded-sm px-2 py-2 text-left text-xs text-muted hover:bg-elevated hover:text-fg"><span className="mr-2 text-[10px] tabular-nums text-subtle">{String(index + 1).padStart(2, "0")}</span>{scene.slugline}</button></li>)}
        </ol>
        {!scenes.length ? <p className="mt-3 text-xs leading-relaxed text-muted">Scene headings appear here as the Fountain draft develops.</p> : null}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">02 · Screenplay</p><h2 className="mt-1 font-display text-xl tracking-tight">{intake.title || "Untitled Picture"}</h2></div>
            <div className="flex flex-wrap items-center gap-2"><Badge>{statusLabel(running ? "GENERATING" : screenplay.status)}</Badge>{screenplay.status === "APPROVED" ? <Badge>Canonical</Badge> : null}</div>
          </div>
          {generation ? <div className="mt-3"><p className="text-xs text-muted">{job?.activeLabel ?? generation.activeLabel}</p><ol className="mt-2 flex flex-wrap gap-2">{steps.map((step) => { const active = generation.activeLabel === step.label; const done = completed.has(step.label); return <li key={step.id} className="flex items-center gap-1 text-[11px] text-muted">{done ? <Check className="size-3 text-good" /> : active ? <LoaderCircle className="size-3 animate-spin text-accent" /> : <Circle className="size-2.5 text-subtle" />}{step.label}</li>; })}</ol></div> : null}
          {job?.error ? <p role="alert" className="mt-2 text-xs text-rec">{job.error}</p> : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {compared ? <div className="mb-4 grid gap-3 xl:grid-cols-2"><section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"><p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">Current</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">{screenplay.workingFountain}</pre></section><section className="rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"><p className="mb-2 text-[10px] tracking-wide text-subtle uppercase">{compared.label}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">{compared.fountain}</pre></section></div> : null}
          <Textarea aria-label="Fountain screenplay" className="screenplay min-h-[36rem] resize-y bg-inset font-mono leading-relaxed" value={shownText} readOnly={running} onChange={(event) => onTextChange(event.target.value)} placeholder="Your Fountain screenplay will appear here." />
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <Button variant="rec" onClick={onStop}><Square />Stop</Button> : <Button onClick={onGenerate} disabled={!selectedReady} title={!selectedReady ? provider?.reason : undefined}>Generate Screenplay</Button>}
            {stopped ? <Button variant="secondary" onClick={onContinue} disabled={!selectedReady}>Continue</Button> : null}
            <Button variant="secondary" disabled={running || !screenplay.workingFountain.trim()} onClick={onSaveRevision}><Save />Save Revision</Button>
            <Button variant="secondary" disabled={running || !passSteps.length || !selectedReady} onClick={() => onRegeneratePass(passId)}><RotateCcw />Regenerate Pass</Button>
            {passSteps.length ? <select aria-label="Pass to regenerate" className="h-9 rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={passId} onChange={(event) => setPassId(event.target.value as ScreenplayStep["id"])}>{passSteps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}</select> : null}
            <Button className="ml-auto" disabled={running || !screenplay.workingFountain.trim() || screenplay.status === "APPROVED"} onClick={onApprove}><Check />Approve Screenplay</Button>
          </div>
        </footer>
      </section>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-border p-4 lg:block">
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Local writer</p><button type="button" onClick={onRescan} className="text-[11px] text-muted hover:text-fg">Rescan</button></div>
        <select aria-label="Screenplay model" className="mt-3 h-9 w-full rounded-sm bg-elevated px-2 text-xs text-fg shadow-[var(--shadow-border)]" value={screenplay.selectedModelId ?? ""} onChange={(event) => onModelChange(event.target.value || null)}><option value="">Select loaded local model</option>{models.map((model) => <option key={model.id} value={model.id} disabled={model.status !== "ready"}>{model.displayName}{model.status !== "ready" ? " · Unavailable" : ""}</option>)}</select>
        {selected ? <><p className="mt-3 text-sm">{selected.displayName}</p><p className="mt-1 text-xs leading-relaxed text-muted">{screenplayModelDetail(selected)}</p><p className="mt-2 text-[11px] text-subtle">{selected.statusReason}</p></> : <p className="mt-3 text-xs leading-relaxed text-muted">{provider?.reason ?? "Checking LM Studio local API…"}</p>}
        <div className="my-5 border-t border-border" />
        <div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Versions</p><span className="text-[10px] tabular-nums text-subtle">{screenplay.versions.length}</span></div>
        <ol className="mt-3 grid gap-2">{[...screenplay.versions].reverse().map((version) => <li key={version.id} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs" title={version.label}>{version.label}</p>{version.id === screenplay.currentVersionId ? <span className="text-[9px] tracking-wide text-accent uppercase">Current</span> : null}</div><p className="mt-1 text-[10px] text-subtle">{new Date(version.createdAt).toLocaleString()}</p><div className="mt-2 flex gap-1"><Button size="sm" variant="ghost" onClick={() => setCompareId(compareId === version.id ? "" : version.id)}><GitCompareArrows />Compare</Button><Button size="sm" variant="ghost" disabled={running || version.id === screenplay.currentVersionId} onClick={() => onRestore(version.id)}>Restore</Button></div></li>)}</ol>
        {screenplay.lastTelemetry ? <><div className="my-5 border-t border-border" /><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">Last run</p><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-subtle">Provider</dt><dd>{screenplay.lastTelemetry.provider}</dd></div><div><dt className="text-subtle">Endpoint</dt><dd className="truncate" title={screenplay.lastTelemetry.endpoint}>{screenplay.lastTelemetry.endpoint.replace("http://127.0.0.1", "localhost")}</dd></div><div><dt className="text-subtle">Local</dt><dd>{screenplay.lastTelemetry.local ? "Yes" : "No"}</dd></div><div><dt className="text-subtle">Cloud fallback</dt><dd>{screenplay.lastTelemetry.cloudFallback ? "Yes" : "No"}</dd></div><div><dt className="text-subtle">Generation</dt><dd className="tabular-nums">{screenplay.lastTelemetry.generationMs === null ? "Unavailable" : `${(screenplay.lastTelemetry.generationMs / 1000).toFixed(1)}s`}</dd></div><div><dt className="text-subtle">Unload</dt><dd>{screenplay.lastTelemetry.unloadVerification}</dd></div></dl></> : null}
      </aside>
    </div>
  );
}
