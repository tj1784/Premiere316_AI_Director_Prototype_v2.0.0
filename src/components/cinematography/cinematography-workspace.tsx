import { Camera, CheckCircle2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveCinematographyPlan, cinematographyApprovalBlockers, runCinematographyQa, type CinematographyState } from "@/lib/cinematography";
import type { VisualDevelopmentState } from "@/lib/visual-development";

export function CinematographyWorkspace({ state, visual, onChange }: { state: CinematographyState; visual?: VisualDevelopmentState | null; onChange: (state: CinematographyState) => void }) {
  const latestQa = state.qaReports.at(-1) ?? runCinematographyQa(state, visual ?? undefined);
  const approved = state.shotPlans.filter((plan) => plan.status === "APPROVED").length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">06 · Cinematography</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-3xl tracking-tight">Camera manifesto & shot plans</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Derived from approved research, visual bibles, and prepared shots. QA critiques repetition and geography without rewriting.</p></div><Badge>{approved} / {state.shotPlans.length} approved</Badge></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <article className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><Camera className="size-4 text-accent" /><p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">Manifesto</p><p className="mt-2 text-sm leading-relaxed">{state.manifestoVersions[0]?.thesis || "No manifesto draft."}</p><div className="mt-3 flex flex-wrap gap-1">{state.sequenceArcs.map((arc) => <span key={arc.id} className="rounded-sm bg-inset px-2 py-1 text-[11px] text-muted">Act {arc.act}: {arc.lensLanguage}</span>)}</div></article>
          <article className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><p className="text-[11px] tracking-wide text-subtle uppercase">QA</p><p className="mt-1 text-sm">{latestQa.findings.length} findings</p><Button className="mt-3 w-full" variant="secondary" onClick={() => onChange({ ...state, qaReports: [...state.qaReports, runCinematographyQa(state, visual ?? undefined)], updatedAt: Date.now() })}>Run deterministic QA</Button></article>
        </section>
        <section className="mt-5 grid gap-3 xl:grid-cols-2">
          {state.shotPlans.map((plan) => {
            const blockers = cinematographyApprovalBlockers(state, plan.id);
            return <article key={plan.id} className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] tracking-wide text-subtle uppercase">{plan.sceneId} · {plan.shotId}</p><h3 className="mt-1 text-sm">{plan.lens} · {plan.framing}</h3></div><Badge>{plan.status}</Badge></div><dl className="mt-3 grid gap-2 sm:grid-cols-2"><Mini label="Height / movement" value={`${plan.cameraHeight} · ${plan.movement}`} /><Mini label="Focus" value={plan.focus} /><Mini label="Lighting / texture" value={`${plan.lighting} · ${plan.texture}`} /><Mini label="Geography" value={plan.geography} /></dl>{blockers.length ? <p className="mt-3 text-xs text-rec">Resolve blocker QA before approval: {blockers[0].message}</p> : null}<Button className="mt-4" size="sm" variant="secondary" disabled={blockers.length > 0} onClick={() => onChange(approveCinematographyPlan(state, plan.id))}>Approve shot plan</Button></article>;
          })}
        </section>
        <section className="mt-5 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><p className="text-[11px] tracking-wide text-subtle uppercase">QA findings</p>{latestQa.findings.length ? <ul className="mt-3 grid gap-2 text-xs text-muted">{latestQa.findings.map((item) => <li key={item.id} className="rounded-sm bg-inset p-2">{item.severity === "blocker" ? <TriangleAlert className="mr-1 inline size-3 text-rec" /> : <CheckCircle2 className="mr-1 inline size-3 text-accent" />}<span className="text-fg">{item.category}</span> · {item.message} <span className="text-subtle">{item.recommendation}</span></li>)}</ul> : <p className="mt-2 text-xs text-muted">No camera QA blockers.</p>}</section>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-sm bg-inset p-2"><dt className="text-[10px] tracking-wide text-subtle uppercase">{label}</dt><dd className="mt-1 line-clamp-2 text-xs text-muted">{value}</dd></div>; }
