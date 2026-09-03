import { useState } from "react";
import { ArrowRight, Check, ChevronRight, Copy, LockKeyhole, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  addPerformanceDirection,
  applyContinuityFlow,
  insertOrReplaceShot,
} from "@/lib/performance/domain";
import type {
  PerformanceDirection,
  PerformanceWorkspace,
  SceneBeat,
} from "@/lib/performance/types";
import { cn } from "@/lib/utils";

export type PerformanceCharacterOption = { id: string; name: string; detail?: string };

export function PerformanceWorkspaceView({
  workspace,
  characters,
  onChange,
  onOpenShots,
}: {
  workspace: PerformanceWorkspace;
  characters: PerformanceCharacterOption[];
  onChange: (workspace: PerformanceWorkspace) => void;
  onOpenShots: () => void;
}) {
  const [sceneId, setSceneId] = useState(workspace.scenes[0]?.id ?? "");
  const scene = workspace.scenes.find((item) => item.id === sceneId) ?? workspace.scenes[0];
  const sceneBeats = workspace.beats.filter((beat) => beat.sceneId === scene?.id);
  const [beatId, setBeatId] = useState(sceneBeats[0]?.id ?? workspace.beats[0]?.id ?? "");
  const beat = workspace.beats.find((item) => item.id === beatId) ?? sceneBeats[0] ?? workspace.beats[0];
  const directedCharacterIds = beat ? Object.keys(workspace.performance[beat.id] ?? {}) : [];
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? directedCharacterIds[0] ?? "");
  const activeCharacterId = characters.some((item) => item.id === characterId) || directedCharacterIds.includes(characterId)
    ? characterId
    : characters[0]?.id ?? directedCharacterIds[0] ?? "";
  const direction = beat && activeCharacterId ? workspace.performance[beat.id]?.[activeCharacterId] : undefined;
  const directedBeats = workspace.beats.filter((item) => Object.keys(workspace.performance[item.id] ?? {}).length > 0).length;
  const approvedDirections = Object.values(workspace.performance).flatMap((item) => Object.values(item)).filter((item) => item.approvedAt).length;
  const selectedShot = beat ? workspace.shots.find((shot) => shot.beatId === beat.id) : undefined;

  function chooseScene(nextSceneId: string) {
    setSceneId(nextSceneId);
    const nextBeat = workspace.beats.find((item) => item.sceneId === nextSceneId);
    if (nextBeat) setBeatId(nextBeat.id);
  }

  function saveDirection(nextDirection: PerformanceDirection) {
    onChange(applyContinuityFlow(addPerformanceDirection(workspace, nextDirection)));
  }

  function approvePerformance() {
    if (!activeCharacterId) return;
    let next = workspace;
    const now = Date.now();
    for (const item of workspace.beats) {
      const current = next.performance[item.id]?.[activeCharacterId];
      next = addPerformanceDirection(next, {
        schemaVersion: 1,
        sourceType: current?.sourceType ?? "manual",
        characterId: activeCharacterId,
        beatId: item.id,
        emotionalState: current?.emotionalState ?? { primary: "present", intensity: 0.5 },
        face: current?.face ?? {},
        body: current?.body ?? {},
        movement: current?.movement ?? {},
        relationship: current?.relationship ?? {},
        dialogue: current?.dialogue ?? {},
        lockedFields: current?.lockedFields ?? [],
        blockedChanges: current?.blockedChanges ?? [],
        approvedAt: now,
        updatedAt: now,
      });
    }
    onChange(applyContinuityFlow(next));
  }

  if (!workspace.scenes.length || !workspace.beats.length) {
    return <EmptyPerformance />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">04 · Performance direction</p>
            <h2 className="mt-1 font-display text-3xl tracking-tight">Performance</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">Direct playable behavior beat by beat. Manual controls remain available with LM Studio offline.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!activeCharacterId} onClick={approvePerformance}><Check />Approve performance</Button>
            <Button onClick={onOpenShots}>Prepare shots <ArrowRight /></Button>
          </div>
        </div>
        <dl className="mt-3 flex flex-wrap gap-2">
          <Metric label="Scenes" value={workspace.scenes.length} />
          <Metric label="Directed beats" value={`${directedBeats}/${workspace.beats.length}`} />
          <Metric label="Approved" value={approvedDirections} />
        </dl>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12 lg:overflow-hidden">
        <aside className="border-b border-border p-3 lg:col-span-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <p className="px-2 text-[10px] tracking-wide text-subtle uppercase">Scene → beat</p>
          <div className="mt-2 grid gap-1">
            {workspace.scenes.map((item, sceneIndex) => {
              const active = item.id === scene?.id;
              return (
                <div key={item.id}>
                  <button type="button" className={cn("flex min-h-11 w-full items-center justify-between rounded-sm px-2 text-left text-xs", active ? "bg-elevated text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg")} onClick={() => chooseScene(item.id)}>
                    <span className="min-w-0 truncate"><span className="mr-2 text-subtle">{String(sceneIndex + 1).padStart(2, "0")}</span>{item.slugline}</span>
                    <ChevronRight className="size-3.5 shrink-0" />
                  </button>
                  {active ? (
                    <div className="ml-3 mt-1 grid gap-1 border-l border-border pl-2">
                      {sceneBeats.map((itemBeat) => <BeatButton key={itemBeat.id} beat={itemBeat} active={itemBeat.id === beat?.id} directed={Object.keys(workspace.performance[itemBeat.id] ?? {}).length > 0} onClick={() => setBeatId(itemBeat.id)} />)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 p-4 sm:p-5 lg:col-span-6 lg:overflow-y-auto">
          {beat ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Badge>{beat.kind}</Badge><h3 className="mt-2 font-display text-2xl tracking-tight">{beat.title}</h3><p className="mt-1 text-sm leading-relaxed text-muted">{beat.summary}</p></div>
                <span className="rounded-sm bg-inset px-2 py-1 text-xs tabular-nums text-muted">{beat.durationSec}s</span>
              </div>
              <div className="mt-5">
                <Label htmlFor="performance-character">Performer</Label>
                <select id="performance-character" className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={activeCharacterId} onChange={(event) => setCharacterId(event.target.value)}>
                  {!characters.length ? <option value="">No approved character assigned</option> : null}
                  {characters.map((item) => <option key={item.id} value={item.id}>{item.name}{item.detail ? ` · ${item.detail}` : ""}</option>)}
                  {directedCharacterIds.filter((id) => !characters.some((item) => item.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              {activeCharacterId ? <DirectionEditor key={`${beat.id}:${activeCharacterId}:${direction?.updatedAt ?? 0}`} beat={beat} characterId={activeCharacterId} direction={direction} onSave={saveDirection} /> : <NoCharacter />}
            </>
          ) : null}
        </main>

        <aside className="border-t border-border p-4 lg:col-span-3 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <p className="text-[10px] tracking-wide text-subtle uppercase">Continuity handoff</p>
          {selectedShot ? (
            <div className="mt-3 grid gap-3">
              <ContinuityCard title="IN" state={selectedShot.performanceIn.performance} />
              <div className="flex items-center gap-2 text-[10px] text-subtle"><span className="h-px flex-1 bg-border" />PERFORMANCE<span className="h-px flex-1 bg-border" /></div>
              <ContinuityCard title="OUT" state={selectedShot.performanceOut.performance} />
              <Button variant="secondary" size="sm" onClick={() => onChange(insertOrReplaceShot(workspace, { ...selectedShot, performanceOut: selectedShot.performanceIn, continuity: { ...selectedShot.continuity, requiredOut: selectedShot.performanceIn } }))}><Copy />Copy IN to OUT</Button>
              <Button variant="ghost" size="sm" onClick={() => onChange(applyContinuityFlow(workspace))}><ArrowRight />Propagate downstream</Button>
              <div className="rounded-md bg-elevated p-3 text-xs text-muted shadow-[var(--shadow-border)]"><div className="flex items-center gap-2 text-fg"><LockKeyhole className="size-4 text-accent" />{selectedShot.continuity.hardLocks?.length ?? 0} continuity locks</div><p className="mt-2 leading-relaxed">Fine-grained IN/OUT edits and intentional discontinuities continue in Shot Preparation.</p></div>
            </div>
          ) : <p className="mt-3 text-xs leading-relaxed text-muted">This beat has no prepared shot yet. Open Shot Preparation to add coverage.</p>}
        </aside>
      </div>
    </div>
  );
}

function DirectionEditor({ beat, characterId, direction, onSave }: { beat: SceneBeat; characterId: string; direction?: PerformanceDirection; onSave: (direction: PerformanceDirection) => void }) {
  const [emotion, setEmotion] = useState(direction?.emotionalState?.primary ?? "");
  const [intensity, setIntensity] = useState(String(direction?.emotionalState?.intensity ?? 0.5));
  const [objective, setObjective] = useState(direction?.emotionalState?.objective ?? "");
  const [gaze, setGaze] = useState(direction?.face?.gazeTarget ?? "");
  const [microExpression, setMicroExpression] = useState(direction?.face?.microExpression ?? "");
  const [posture, setPosture] = useState(direction?.body?.posture ?? "");
  const [breathing, setBreathing] = useState(direction?.body?.breathing ?? "");
  const [gesture, setGesture] = useState(direction?.movement?.gesture ?? "");
  const [movement, setMovement] = useState(direction?.movement?.path ?? "");
  const [delivery, setDelivery] = useState(direction?.dialogue?.delivery ?? "");
  const [subtext, setSubtext] = useState(direction?.dialogue?.subtext ?? "");

  function commit(approve = false) {
    const now = Date.now();
    onSave({
      schemaVersion: 1,
      sourceType: direction?.sourceType ?? "manual",
      characterId,
      beatId: beat.id,
      emotionalState: { primary: emotion, intensity: Math.max(0, Math.min(1, Number(intensity) || 0)), objective },
      face: { ...direction?.face, gazeTarget: gaze, microExpression },
      body: { ...direction?.body, posture, breathing },
      movement: { ...direction?.movement, gesture, path: movement },
      relationship: direction?.relationship ?? {},
      dialogue: { ...direction?.dialogue, delivery, subtext },
      lockedFields: direction?.lockedFields ?? [],
      blockedChanges: direction?.blockedChanges ?? [],
      approvedAt: approve ? now : direction?.approvedAt,
      updatedAt: now,
    });
  }

  return (
    <section className="mt-5 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] tracking-wide text-subtle uppercase">Practical direction</p><p className="mt-1 text-sm">Playable, observable choices</p></div>{direction?.approvedAt ? <Badge className="text-good">Approved</Badge> : <Badge>Draft</Badge>}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TextField label="Primary emotion" value={emotion} onChange={setEmotion} placeholder="guarded curiosity" />
        <TextField label="Intensity 0–1" value={intensity} onChange={setIntensity} type="number" />
        <TextField label="Objective" value={objective} onChange={setObjective} placeholder="keep control of the room" />
        <TextField label="Gaze target" value={gaze} onChange={setGaze} placeholder="door, partner, camera" />
        <TextField label="Micro-expression" value={microExpression} onChange={setMicroExpression} placeholder="jaw tightens, eyes soften" />
        <TextField label="Posture" value={posture} onChange={setPosture} placeholder="forward lean, closed shoulders" />
        <TextField label="Breathing" value={breathing} onChange={setBreathing} placeholder="shallow, held, recovering" />
        <TextField label="Gesture" value={gesture} onChange={setGesture} placeholder="thumb rubs ring" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><TextAreaField label="Movement path" value={movement} onChange={setMovement} placeholder="Crosses behind the table, stops short of the door." /><TextAreaField label="Dialogue delivery" value={delivery} onChange={setDelivery} placeholder="Quiet, clipped, avoids the final word." /></div>
      <div className="mt-3"><TextAreaField label="Subtext" value={subtext} onChange={setSubtext} placeholder="What the actor is protecting or withholding." /></div>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => commit(false)}>Save direction</Button><Button onClick={() => commit(true)}><Check />Approve beat</Button></div>
    </section>
  );
}

function BeatButton({ beat, active, directed, onClick }: { beat: SceneBeat; active: boolean; directed: boolean; onClick: () => void }) {
  return <button type="button" className={cn("flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-xs", active ? "bg-inset text-fg" : "text-muted hover:text-fg")} onClick={onClick}><span className={cn("size-1.5 shrink-0 rounded-full", directed ? "bg-good" : "bg-border")} /><span className="min-w-0 flex-1 truncate">{beat.summary}</span><span className="text-[10px] tabular-nums text-subtle">{beat.durationSec}s</span></button>;
}

function TextField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <div><Label>{label}</Label><Input className="mt-1.5" type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div><Label>{label}</Label><Textarea className="mt-1.5 min-h-20" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function ContinuityCard({ title, state }: { title: string; state: { gazeDirection?: string; posture?: string; facialEmotion?: string; breathing?: string } }) {
  const values = [state.gazeDirection && `Gaze ${state.gazeDirection}`, state.posture && `Posture ${state.posture}`, state.facialEmotion && `Emotion ${state.facialEmotion}`, state.breathing && `Breath ${state.breathing}`].filter(Boolean);
  return <div className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]"><p className="text-[10px] tracking-wide text-subtle uppercase">{title}</p>{values.length ? <ul className="mt-2 grid gap-1 text-xs text-muted">{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p className="mt-2 text-xs text-subtle">No carried state</p>}</div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-sm bg-elevated px-2.5 py-1.5 shadow-[var(--shadow-border)]"><dt className="text-[9px] tracking-wide text-subtle uppercase">{label}</dt><dd className="mt-0.5 text-xs tabular-nums">{value}</dd></div>;
}

function NoCharacter() {
  return <div className="mt-5 grid min-h-48 place-items-center rounded-lg bg-inset p-6 text-center shadow-[var(--shadow-border)]"><div><UserRound className="mx-auto size-5 text-subtle" /><p className="mt-2 text-sm">Assign an approved character in Inventory.</p><p className="mt-1 text-xs text-muted">Performance direction needs a stable performer identity.</p></div></div>;
}

function EmptyPerformance() {
  return <div className="grid h-full min-h-64 place-items-center bg-bg p-6 text-center"><div className="max-w-md"><UserRound className="mx-auto size-5 text-accent" /><p className="mt-3 text-[11px] tracking-wide text-subtle uppercase">No approved scene beats</p><h2 className="mt-1 font-display text-2xl tracking-tight">Approve a screenplay first</h2><p className="mt-2 text-sm leading-relaxed text-muted">Performance is derived only from the frozen screenplay boundary.</p></div></div>;
}
