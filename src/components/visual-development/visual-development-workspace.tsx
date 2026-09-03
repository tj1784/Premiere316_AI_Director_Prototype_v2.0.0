import { Palette, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveVisualRecord, checkVisualDrift, type VisualDevelopmentState } from "@/lib/visual-development";

export function VisualDevelopmentWorkspace({ state, onChange }: { state: VisualDevelopmentState; onChange: (state: VisualDevelopmentState) => void }) {
  const approvals = state.approvals.length;
  const drift = checkVisualDrift(state);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">05 · Visual development</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-3xl tracking-tight">Bibles, boards, continuity</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Engine-neutral art direction. Text specs and local/user references only; no generated placeholder imagery.</p></div><Badge>{approvals} approved</Badge></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <section className="grid gap-3 lg:grid-cols-3">
          {state.boards.map((board) => <article key={board.id} className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><Palette className="size-4 text-accent" /><p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">Look board</p><h3 className="mt-1 text-base">{board.title}</h3><p className="mt-2 text-xs leading-relaxed text-muted">{board.intent}</p><div className="mt-3 flex flex-wrap gap-1">{board.palette.map((item) => <span key={item} className="rounded-sm bg-inset px-2 py-1 text-[11px] text-muted">{item}</span>)}</div><Button className="mt-4" size="sm" variant="secondary" onClick={() => onChange(approveVisualRecord(state, "board", board.id))}>Approve board</Button></article>)}
          <SummaryCard icon={<ShieldCheck className="size-4 text-accent" />} label="Identity bibles" count={state.characterBibles.length} detail="Facial geometry, expression matrix, posture, wardrobe states and prohibited drift." />
          <SummaryCard icon={<Sparkles className="size-4 text-accent" />} label="Design variants" count={state.locationBibles.length + state.wardrobeStates.length + state.propBibles.length} detail="Locations, wardrobe, props, materials, wear state, motif links and provenance." />
        </section>
        <section className="mt-5 grid gap-3 xl:grid-cols-2">
          {state.characterBibles.map((bible) => <article key={bible.id} className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><h3 className="text-sm">{bible.name}</h3><Badge>{bible.status}</Badge></div><p className="mt-2 text-xs leading-relaxed text-muted">{bible.facialGeometry}</p><dl className="mt-3 grid gap-2 sm:grid-cols-2"><Mini label="Invariants" value={bible.invariants.join(" · ") || "needs review"} /><Mini label="Expression" value={Object.values(bible.expressionMatrix).join(" · ")} /><Mini label="Prohibited drift" value={bible.prohibitedDrift.join(" · ")} /><Mini label="Scenes" value={`${bible.sceneIds.length} linked`} /></dl><Button className="mt-4" size="sm" variant="secondary" onClick={() => onChange(approveVisualRecord(state, "character", bible.id))}>Approve identity bible</Button></article>)}
        </section>
        <section className="mt-5 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><p className="text-[11px] tracking-wide text-subtle uppercase">Deterministic drift checks</p>{drift.length ? <ul className="mt-3 grid gap-2 text-xs text-muted">{drift.map((item) => <li key={item.id} className="rounded-sm bg-inset p-2"><span className="text-fg">{item.severity}</span> · {item.message}</li>)}</ul> : <p className="mt-2 text-xs text-muted">No visual drift blockers.</p>}</section>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, count, detail }: { icon: React.ReactNode; label: string; count: number; detail: string }) { return <article className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">{icon}<p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">{label}</p><p className="mt-1 font-display text-2xl tabular-nums">{count}</p><p className="mt-2 text-xs leading-relaxed text-muted">{detail}</p></article>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-sm bg-inset p-2"><dt className="text-[10px] tracking-wide text-subtle uppercase">{label}</dt><dd className="mt-1 line-clamp-2 text-xs text-muted">{value}</dd></div>; }
