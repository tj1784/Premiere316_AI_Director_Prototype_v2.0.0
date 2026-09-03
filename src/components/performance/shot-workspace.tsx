import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  GitMerge,
  ListChecks,
  Plus,
  Scissors,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  buildCanonicalShot,
  buildDependencyGraph,
  buildQueue,
  calculateShotReadiness,
  cloneWorkspace,
  continuityWarnings,
  insertOrReplaceShot,
  markIntentionalDiscontinuity,
  mergeShots,
  removeShot,
  reorderShot,
  splitShot,
  type MovementField,
} from "@/lib/performance/domain";
import { approvedAssetReference } from "@/lib/performance/persistence";
import type {
  ApprovedAssetReference,
  CanonicalShotSpec,
  PerformanceContinuityEnvelope,
  PerformanceState,
  PerformanceWorkspace,
  ShotChangeWarning,
} from "@/lib/performance/types";
import type { ProductionAsset } from "@/lib/production/types";
import { cn, uid } from "@/lib/utils";

export function ShotPreparationWorkspace({
  workspace,
  assets,
  onChange,
  onBack,
  onOpenPromptLab,
}: {
  workspace: PerformanceWorkspace;
  assets: ProductionAsset[];
  onChange: (workspace: PerformanceWorkspace) => void;
  onBack: () => void;
  onOpenPromptLab: () => void;
}) {
  const sortedShots = [...workspace.shots].sort((left, right) => left.sequenceOrder - right.sequenceOrder);
  const [selectedId, setSelectedId] = useState(sortedShots[0]?.canonicalShotId ?? "");
  const selected = sortedShots.find((shot) => shot.canonicalShotId === selectedId) ?? sortedShots[0];
  const selectedIndex = selected ? sortedShots.findIndex((shot) => shot.canonicalShotId === selected.canonicalShotId) : -1;
  const warnings = continuityWarnings(workspace);
  const readyCount = Object.values(workspace.queue).filter((entry) => entry.readiness === "READY_TO_GENERATE").length;

  useEffect(() => {
    if (selected && selected.canonicalShotId !== selectedId) setSelectedId(selected.canonicalShotId);
  }, [selected, selectedId]);

  function commit(next: PerformanceWorkspace, preferredId?: string) {
    onChange(next);
    if (preferredId) setSelectedId(preferredId);
  }

  function addShot() {
    const base = selected ?? sortedShots[sortedShots.length - 1];
    const beat = workspace.beats.find((item) => item.id === base?.beatId) ?? workspace.beats[0];
    const created = buildCanonicalShot({
      shotId: uid("shot"),
      pictureId: workspace.pictureId,
      sceneId: base?.sceneId ?? beat?.sceneId ?? workspace.scenes[0]?.id ?? "scene",
      beatId: base?.beatId ?? beat?.id ?? "beat",
      sequenceOrder: (base?.sequenceOrder ?? sortedShots.length) + 1,
      durationSec: base?.durationSec ?? 10,
      framing: { ...(base?.framing ?? { shotSize: "coverage", lens: "50mm" }) },
      camera: { ...(base?.camera ?? { style: "static" }) },
      subject: {
        characters: [...(base?.subject.characters ?? [])],
        actions: ["New coverage"],
        approvedReferences: [...(base?.subject.approvedReferences ?? [])],
      },
      performanceIn: copyEnvelope(base?.performanceOut ?? blankEnvelope()),
      performanceOut: copyEnvelope(base?.performanceOut ?? blankEnvelope()),
      world: { ...(base?.world ?? {}) },
      continuity: {
        requiredIn: copyEnvelope(base?.performanceOut ?? blankEnvelope()),
        requiredOut: copyEnvelope(base?.performanceOut ?? blankEnvelope()),
        hardLocks: [...(base?.continuity.hardLocks ?? [])],
        permittedChanges: [],
      },
      audio: { dialogue: [] },
      references: { ...(base?.references ?? {}) },
      negatives: [...(base?.negatives ?? [])],
      intendedEngine: base?.intendedEngine ?? "ltx-2",
      dependencyState: [workspace.approvedScreenplay.screenplayVersionId, beat?.id ?? "beat"],
    });
    commit(insertOrReplaceShot(workspace, created), created.canonicalShotId);
  }

  function usePrevious(warning: ShotChangeWarning) {
    const targetIndex = sortedShots.findIndex((shot) => shot.shotId === warning.shotId);
    if (targetIndex < 1) return;
    const previous = sortedShots[targetIndex - 1];
    const target = sortedShots[targetIndex];
    const next = cloneWorkspace(workspace);
    const editable = next.shots.find((shot) => shot.canonicalShotId === target.canonicalShotId);
    if (!editable) return;
    editable.performanceIn = copyEnvelope(previous.performanceOut);
    editable.continuity.requiredIn = copyEnvelope(previous.performanceOut);
    editable.status = "DRAFT";
    editable.version += 1;
    editable.updatedAt = Date.now();
    next.queue = buildQueue(next);
    next.updatedAt = editable.updatedAt;
    next.lastUpdated = editable.updatedAt;
    commit(next, editable.canonicalShotId);
  }

  function acceptIntentional(warning: ShotChangeWarning) {
    const targetIndex = sortedShots.findIndex((shot) => shot.shotId === warning.shotId);
    if (targetIndex < 1 || !warning.field) return;
    const previous = sortedShots[targetIndex - 1];
    const target = sortedShots[targetIndex];
    commit(markIntentionalDiscontinuity(workspace, previous.shotId, target.shotId, [warning.field as MovementField], "Accepted in Shot Preparation"), target.canonicalShotId);
  }

  function propagateOut() {
    if (!selected) return;
    const next = cloneWorkspace(workspace);
    for (const shot of next.shots) {
      if (shot.sequenceOrder <= selected.sequenceOrder) continue;
      shot.performanceIn = copyEnvelope(selected.performanceOut);
      shot.continuity.requiredIn = copyEnvelope(selected.performanceOut);
      shot.status = "DRAFT";
      shot.updatedAt = Date.now();
    }
    next.dependencyGraph = buildDependencyGraph(next);
    next.queue = buildQueue(next);
    next.updatedAt = Date.now();
    next.lastUpdated = next.updatedAt;
    commit(next, selected.canonicalShotId);
  }

  function approveShot() {
    if (!selected) return;
    const readiness = calculateShotReadiness(workspace, selected);
    if (readiness !== "READY_TO_COMPILE" && readiness !== "READY_TO_GENERATE") return;
    commit(insertOrReplaceShot(workspace, { ...selected, status: "READY_TO_COMPILE", compilerState: "READY_TO_COMPILE", updatedAt: Date.now() }), selected.canonicalShotId);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><p className="text-[11px] tracking-wide text-subtle uppercase">08 · Shot preparation</p><h2 className="mt-1 font-display text-3xl tracking-tight">Shots</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Lock coverage, continuity, approved references, and readiness before generation. No media is generated here.</p></div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 xl:w-auto"><Button className="w-full" variant="ghost" onClick={onBack}><ArrowLeft />Performance</Button><Button className="w-full" variant="secondary" onClick={addShot}><Plus />Add shot</Button><Button className="w-full" onClick={onOpenPromptLab}>Prompt Lab <ArrowRight /></Button></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><StatusMetric label="Shots" value={sortedShots.length} /><StatusMetric label="Warnings" value={warnings.length} tone={warnings.length ? "warning" : "normal"} /><StatusMetric label="Ready" value={`${readyCount}/${sortedShots.length}`} /></div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-12 xl:overflow-hidden">
        <aside className="border-b border-border p-3 xl:col-span-3 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <p className="px-2 text-[10px] tracking-wide text-subtle uppercase">Scene → beat → shot</p>
          <div className="mt-2 grid gap-1">
            {sortedShots.map((shot, index) => {
              const scene = workspace.scenes.find((item) => item.id === shot.sceneId);
              const beat = workspace.beats.find((item) => item.id === shot.beatId);
              const warning = warnings.some((item) => item.shotId === shot.shotId);
              const queue = workspace.queue[shot.canonicalShotId];
              return (
                <button key={shot.canonicalShotId} type="button" className={cn("min-h-14 rounded-sm px-3 py-2 text-left", selected?.canonicalShotId === shot.canonicalShotId ? "bg-elevated shadow-[var(--shadow-border)]" : "hover:bg-elevated/60")} onClick={() => setSelectedId(shot.canonicalShotId)}>
                  <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-subtle">{String(index + 1).padStart(2, "0")} · {scene?.slugline ?? shot.sceneId}</span>{warning ? <AlertTriangle className="size-3.5 text-accent" /> : <span className={cn("size-1.5 rounded-full", queue?.readiness === "READY_TO_GENERATE" ? "bg-good" : "bg-border")} />}</div>
                  <p className="mt-1 truncate text-xs">{beat?.summary ?? shot.subject.actions?.[0] ?? "Prepared shot"}</p>
                  <p className="mt-1 text-[10px] text-muted">{shot.framing.shotSize ?? "coverage"} · {shot.durationSec}s · {formatState(queue?.readiness ?? shot.status)}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 p-4 sm:p-5 xl:col-span-6 xl:overflow-y-auto">
          {selected ? (
            <>
              <ShotToolbar
                shot={selected}
                index={selectedIndex}
                count={sortedShots.length}
                canMerge={selectedIndex >= 0 && selectedIndex < sortedShots.length - 1}
                onMove={(offset) => commit(reorderShot(workspace, selected.canonicalShotId, selectedIndex + offset), selected.canonicalShotId)}
                onSplit={() => commit(splitShot(workspace, selected.canonicalShotId, selected.durationSec / 2))}
                onMerge={() => commit(mergeShots(workspace, selected.canonicalShotId, sortedShots[selectedIndex + 1].canonicalShotId))}
                onRemove={() => commit(removeShot(workspace, selected.canonicalShotId), sortedShots[selectedIndex + 1]?.canonicalShotId ?? sortedShots[selectedIndex - 1]?.canonicalShotId)}
              />
              <ShotInspector key={`${selected.canonicalShotId}:${selected.version}`} shot={selected} assets={assets} readiness={calculateShotReadiness(workspace, selected)} onSave={(shot) => commit(insertOrReplaceShot(workspace, shot), shot.canonicalShotId)} onApprove={approveShot} onPropagate={propagateOut} />
            </>
          ) : <EmptyShots onAdd={addShot} />}
        </main>

        <aside className="border-t border-border p-4 xl:col-span-3 xl:overflow-y-auto xl:border-l xl:border-t-0">
          <section><div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-wide text-subtle uppercase">Continuity warnings</p><Badge>{warnings.length}</Badge></div>{warnings.length ? <div className="mt-3 grid gap-2">{warnings.map((warning, index) => <WarningCard key={`${warning.shotId}:${warning.field}:${index}`} warning={warning} onUsePrevious={() => usePrevious(warning)} onAccept={() => acceptIntentional(warning)} onEdit={() => { const target = sortedShots.find((shot) => shot.shotId === warning.shotId); if (target) setSelectedId(target.canonicalShotId); }} />)}</div> : <div className="mt-3 rounded-md bg-elevated p-3 text-xs text-muted shadow-[var(--shadow-border)]"><Check className="mb-2 size-4 text-good" />Adjacent IN/OUT states agree.</div>}</section>
          <section className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><p className="text-[10px] tracking-wide text-subtle uppercase">Prepared video queue</p><ListChecks className="size-4 text-subtle" /></div><div className="mt-3 grid gap-2">{sortedShots.map((shot) => { const entry = workspace.queue[shot.canonicalShotId]; return <div key={shot.canonicalShotId} className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between gap-2"><span className="text-xs">Shot {String(shot.sequenceOrder).padStart(2, "0")}</span><Badge className={entry?.readiness === "READY_TO_GENERATE" ? "text-good" : undefined}>{formatState(entry?.readiness ?? "PLANNED")}</Badge></div><p className="mt-1 text-[10px] text-subtle">{entry?.approvedReferences.length ?? 0} refs · {shot.intendedEngine} · v{shot.version}</p></div>; })}</div></section>
        </aside>
      </div>
    </div>
  );
}

function ShotInspector({ shot, assets, readiness, onSave, onApprove, onPropagate }: { shot: CanonicalShotSpec; assets: ProductionAsset[]; readiness: ReturnType<typeof calculateShotReadiness>; onSave: (shot: CanonicalShotSpec) => void; onApprove: () => void; onPropagate: () => void }) {
  const [draft, setDraft] = useState(shot);
  const approvedAssets = assets.map((asset) => ({ asset, reference: approvedAssetReference(asset) })).filter((item): item is { asset: ProductionAsset; reference: ApprovedAssetReference } => item.reference !== null);
  const actionText = draft.subject.actions?.join("; ") ?? "";
  const dialogueText = draft.audio.dialogue?.map((line) => line.text).join("\n") ?? "";

  function updateState(side: "performanceIn" | "performanceOut", patch: Partial<PerformanceState>) {
    setDraft((current) => ({ ...current, [side]: { ...current[side], performance: { ...current[side].performance, ...patch } }, status: "DRAFT", compilerState: "PLANNED" }));
  }

  function toggleAsset(reference: ApprovedAssetReference) {
    const key = referenceKey(reference);
    const existing = draft.subject.approvedReferences ?? [];
    const active = existing.some((item) => referenceKey(item) === key);
    setDraft((current) => ({ ...current, subject: { ...current.subject, approvedReferences: active ? existing.filter((item) => referenceKey(item) !== key) : [...existing, reference] }, status: "DRAFT", compilerState: "PLANNED" }));
  }

  function save() {
    const dialogue = dialogueText.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text, index) => ({ id: draft.audio.dialogue?.[index]?.id ?? uid("dialogue"), characterId: draft.subject.characters[0] ?? "unassigned", text, sequence: index + 1 }));
    onSave({
      ...draft,
      subject: { ...draft.subject, actions: actionText.split(";").map((item) => item.trim()).filter(Boolean) },
      audio: { ...draft.audio, dialogue },
      continuity: { ...draft.continuity, requiredIn: copyEnvelope(draft.performanceIn), requiredOut: copyEnvelope(draft.performanceOut) },
      updatedAt: Date.now(),
    });
  }

  return (
    <div className="mt-4 grid gap-4">
      <section className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] tracking-wide text-subtle uppercase">Camera plan</p><h3 className="mt-1 font-display text-xl">Shot {String(shot.sequenceOrder).padStart(2, "0")}</h3></div><Badge className={readiness === "READY_TO_GENERATE" ? "text-good" : readiness === "CONTINUITY_WARNING" ? "text-accent" : undefined}>{formatState(readiness)}</Badge></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SelectField label="Framing" value={draft.framing.shotSize ?? "coverage"} options={["establishing", "coverage", "closeup", "insert", "reaction", "detail"]} onChange={(value) => setDraft({ ...draft, framing: { ...draft.framing, shotSize: value } })} />
          <TextField label="Lens" value={draft.framing.lens ?? ""} onChange={(value) => setDraft({ ...draft, framing: { ...draft.framing, lens: value } })} placeholder="35mm" />
          <SelectField label="Camera" value={draft.camera.style ?? "static"} options={["static", "pan", "tilt", "dolly", "truck", "crane", "handheld", "orbit", "push", "pull"]} onChange={(value) => setDraft({ ...draft, camera: { ...draft.camera, style: value as CanonicalShotSpec["camera"]["style"] } })} />
          <TextField label="Movement path" value={draft.camera.movementPath ?? ""} onChange={(value) => setDraft({ ...draft, camera: { ...draft.camera, movementPath: value } })} placeholder="slow push toward subject" />
          <TextField label="Composition" value={draft.framing.composition ?? ""} onChange={(value) => setDraft({ ...draft, framing: { ...draft.framing, composition: value } })} placeholder="profile two-shot" />
          <TextField label="Duration seconds" value={String(draft.durationSec)} type="number" onChange={(value) => setDraft({ ...draft, durationSec: Number(value) || 6 })} />
        </div>
        <div className="mt-3"><Label>Action</Label><Textarea className="mt-1.5 min-h-20" value={actionText} onChange={(event) => setDraft({ ...draft, subject: { ...draft.subject, actions: event.target.value.split(";") } })} placeholder="Separate beats with semicolons" /></div>
        <div className="mt-3"><Label>Dialogue</Label><Textarea className="mt-1.5 min-h-20" value={dialogueText} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, dialogue: event.target.value.split(/\r?\n/).map((text, index) => ({ id: draft.audio.dialogue?.[index]?.id ?? `draft-${index}`, characterId: draft.subject.characters[0] ?? "unassigned", text, sequence: index + 1 })) } })} placeholder="One line per dialogue cue" /></div>
      </section>

      <section className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] tracking-wide text-subtle uppercase">Continuity state</p><p className="mt-1 text-sm">Edit the carried state at both boundaries</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, performanceOut: copyEnvelope(draft.performanceIn) })}><Copy />IN → OUT</Button><Button size="sm" variant="ghost" onClick={onPropagate}>Propagate</Button></div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><ContinuityEditor label="IN" state={draft.performanceIn.performance} onChange={(patch) => updateState("performanceIn", patch)} /><ContinuityEditor label="OUT" state={draft.performanceOut.performance} onChange={(patch) => updateState("performanceOut", patch)} /></div>
        <div className="mt-4"><TextField label="Hard locks · comma separated" value={draft.continuity.hardLocks?.join(", ") ?? ""} onChange={(value) => setDraft({ ...draft, continuity: { ...draft.continuity, hardLocks: value.split(",").map((item) => item.trim()).filter(Boolean) } })} placeholder="wardrobe, held object, screen direction" /></div>
      </section>

      <section className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
        <div><p className="text-[10px] tracking-wide text-subtle uppercase">Approved references</p><p className="mt-1 text-sm">Stable Inventory identities and versions</p></div>
        {approvedAssets.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{approvedAssets.map(({ asset, reference }) => { const active = (draft.subject.approvedReferences ?? []).some((item) => referenceKey(item) === referenceKey(reference)); return <label key={`${asset.id}:${referenceKey(reference)}`} className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-xs shadow-[var(--shadow-border)]", active ? "bg-inset text-fg" : "text-muted")}><input type="checkbox" checked={active} onChange={() => toggleAsset(reference)} /><span className="min-w-0"><span className="block truncate">{asset.name}</span><span className="mt-0.5 block text-[10px] text-subtle">{asset.category.replaceAll("_", " ")} · {referenceKey(reference)}</span></span></label>; })}</div> : <p className="mt-3 text-xs text-muted">Approve character, location, prop, or wardrobe assets in Inventory to attach stable versions.</p>}
      </section>

      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={save}>Save shot</Button><Button disabled={readiness !== "READY_TO_COMPILE" && readiness !== "READY_TO_GENERATE"} onClick={onApprove}><Check />Approve shot</Button></div>
    </div>
  );
}

function ShotToolbar({ shot, index, count, canMerge, onMove, onSplit, onMerge, onRemove }: { shot: CanonicalShotSpec; index: number; count: number; canMerge: boolean; onMove: (offset: number) => void; onSplit: () => void; onMerge: () => void; onRemove: () => void }) {
  return <div className="flex flex-wrap items-center gap-2"><Button size="icon-sm" variant="secondary" disabled={index <= 0} aria-label="Move shot up" onClick={() => onMove(-1)}><ArrowUp /></Button><Button size="icon-sm" variant="secondary" disabled={index < 0 || index >= count - 1} aria-label="Move shot down" onClick={() => onMove(1)}><ArrowDown /></Button><Button size="sm" variant="secondary" disabled={shot.durationSec < 12} onClick={onSplit}><Scissors />Split</Button><Button size="sm" variant="secondary" disabled={!canMerge} onClick={onMerge}><GitMerge />Merge next</Button><Button className="ml-auto" size="icon-sm" variant="ghost" aria-label="Remove shot" onClick={onRemove}><Trash2 /></Button></div>;
}

function ContinuityEditor({ label, state, onChange }: { label: string; state: PerformanceState; onChange: (patch: Partial<PerformanceState>) => void }) {
  return <div className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]"><p className="text-[10px] tracking-wide text-subtle uppercase">{label}</p><div className="mt-3 grid gap-2"><CompactField label="Gaze" value={state.gazeDirection ?? ""} onChange={(value) => onChange({ gazeDirection: value })} /><CompactField label="Head" value={state.headOrientation ?? ""} onChange={(value) => onChange({ headOrientation: value })} /><CompactField label="Body" value={state.bodyOrientation ?? ""} onChange={(value) => onChange({ bodyOrientation: value })} /><CompactField label="Posture" value={state.posture ?? ""} onChange={(value) => onChange({ posture: value })} /><CompactField label="Emotion" value={state.facialEmotion ?? ""} onChange={(value) => onChange({ facialEmotion: value })} /><CompactField label="Left hand" value={state.handPosition?.left ?? ""} onChange={(value) => onChange({ handPosition: { ...state.handPosition, left: value } })} /><CompactField label="Right hand" value={state.handPosition?.right ?? ""} onChange={(value) => onChange({ handPosition: { ...state.handPosition, right: value } })} /></div></div>;
}

function CompactField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid grid-cols-3 items-center gap-2 text-[10px] text-subtle"><span>{label}</span><Input className="col-span-2 h-9" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <div><Label>{label}</Label><Input className="mt-1.5" type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><select className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
}

function WarningCard({ warning, onUsePrevious, onAccept, onEdit }: { warning: ShotChangeWarning; onUsePrevious: () => void; onAccept: () => void; onEdit: () => void }) {
  return <article className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" /><div className="min-w-0"><p className="text-xs">{warning.field ? formatState(warning.field) : "Continuity change"}</p><p className="mt-1 text-[10px] leading-relaxed text-muted">{warning.message}</p></div></div><div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="secondary" onClick={onUsePrevious}>Use previous</Button><Button size="sm" variant="ghost" onClick={onAccept}>Accept intentional</Button><Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button></div></article>;
}

function EmptyShots({ onAdd }: { onAdd: () => void }) {
  return <div className="grid min-h-64 place-items-center rounded-lg bg-inset p-6 text-center shadow-[var(--shadow-border)]"><div><ListChecks className="mx-auto size-5 text-subtle" /><p className="mt-2 text-sm">No prepared shots.</p><Button className="mt-4" onClick={onAdd}><Plus />Add first shot</Button></div></div>;
}

function StatusMetric({ label, value, tone = "normal" }: { label: string; value: string | number; tone?: "normal" | "warning" }) {
  return <div className="rounded-sm bg-elevated px-2.5 py-1.5 shadow-[var(--shadow-border)]"><span className="text-[9px] tracking-wide text-subtle uppercase">{label}</span><span className={cn("ml-2 text-xs tabular-nums", tone === "warning" && "text-accent")}>{value}</span></div>;
}

function blankEnvelope(): PerformanceContinuityEnvelope {
  return { visual: {}, performance: {}, story: {} };
}

function copyEnvelope(envelope: PerformanceContinuityEnvelope): PerformanceContinuityEnvelope {
  return { visual: { ...envelope.visual, props: [...(envelope.visual.props ?? [])], wounds: [...(envelope.visual.wounds ?? [])] }, performance: { ...envelope.performance, handPosition: { ...(envelope.performance.handPosition ?? {}) }, heldObjects: { ...(envelope.performance.heldObjects ?? {}) }, injuries: [...(envelope.performance.injuries ?? [])], environmentalInteraction: [...(envelope.performance.environmentalInteraction ?? [])] }, story: { ...envelope.story, happened: [...(envelope.story.happened ?? [])], relationships: [...(envelope.story.relationships ?? [])], objectives: [...(envelope.story.objectives ?? [])] } };
}

function referenceKey(reference: ApprovedAssetReference): string {
  return reference.approvedIdentityVersion ?? reference.locationVersionId ?? reference.propVersionId ?? reference.wardrobeVariantId ?? reference.characterId ?? reference.type;
}

function formatState(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}
