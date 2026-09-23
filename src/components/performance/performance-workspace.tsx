import * as Tabs from "@radix-ui/react-tabs";
import { ArrowRight, Check, Copy, LockKeyhole, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { useWorkspaceDraft } from "@/components/studio/use-workspace-draft";
import { addPerformanceDirection, applyContinuityFlow, insertOrReplaceShot } from "@/lib/performance/domain";
import type { PerformanceDirection, PerformanceState, PerformanceWorkspace, SceneBeat } from "@/lib/performance/types";
import "./performance-workbench.css";

export type PerformanceCharacterOption = { id: string; name: string; detail?: string };

export function PerformanceWorkspaceView({ workspace, characters, onChange, onOpenShots }: {
  workspace: PerformanceWorkspace; characters: PerformanceCharacterOption[];
  onChange: (workspace: PerformanceWorkspace) => void; onOpenShots: () => void;
}) {
  const [sceneId, setSceneId] = useWorkspaceDraft("performance-scene", workspace.scenes[0]?.id ?? "");
  const scene = workspace.scenes.find((item) => item.id === sceneId) ?? workspace.scenes[0];
  const sceneBeats = workspace.beats.filter((item) => item.sceneId === scene?.id);
  const [beatId, setBeatId] = useWorkspaceDraft("performance-beat", sceneBeats[0]?.id ?? "");
  const beat = sceneBeats.find((item) => item.id === beatId) ?? sceneBeats[0];
  const directedIds = beat ? Object.keys(workspace.performance[beat.id] ?? {}) : [];
  const [characterId, setCharacterId] = useWorkspaceDraft("performance-character", characters[0]?.id ?? "");
  const activeCharacterId = characters.some((item) => item.id === characterId) || directedIds.includes(characterId) ? characterId : characters[0]?.id ?? directedIds[0] ?? "";
  const direction = beat && activeCharacterId ? workspace.performance[beat.id]?.[activeCharacterId] : undefined;
  const shot = beat ? workspace.shots.find((item) => item.beatId === beat.id) : undefined;
  const directed = sceneBeats.filter((item) => Object.keys(workspace.performance[item.id] ?? {}).length).length;
  const saveDirection = (next: PerformanceDirection) => onChange(applyContinuityFlow(addPerformanceDirection(workspace, next)));

  if (!workspace.scenes.length || !workspace.beats.length) return <div className="pw-empty"><UserRound /><h2>Approve a screenplay to begin direction</h2><p>Scene beats are derived from the approved screenplay. Manual authoring remains available after that boundary is established.</p></div>;

  return <div className="production-workbench">
    <header className="pw-toolbar"><div><span className="pw-eyebrow">Performance</span><h2>Direct the moment</h2></div><div className="pw-toolbar-actions"><Badge>{directed}/{sceneBeats.length} beats directed</Badge><Button size="sm" onClick={onOpenShots}>Prepare shots <ArrowRight /></Button></div></header>
    <div className="pw-scopebar">
      <label><span>Scene</span><select aria-label="Performance scene" value={scene?.id ?? ""} onChange={(event) => setSceneId(event.target.value)}>{workspace.scenes.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.slugline}</option>)}</select></label>
      <label><span>Beat</span><select aria-label="Performance beat" value={beat?.id ?? ""} onChange={(event) => setBeatId(event.target.value)}>{sceneBeats.map((item) => <option key={item.id} value={item.id}>{item.sequence}. {item.title} · {item.durationSec}s</option>)}</select></label>
      <label><span>Performer</span><select aria-label="Performance performer" value={activeCharacterId} onChange={(event) => setCharacterId(event.target.value)}>{!characters.length && !directedIds.length ? <option value="">No linked character</option> : null}{characters.map((item) => <option key={item.id} value={item.id}>{item.name}{item.detail ? ` · ${item.detail}` : ""}</option>)}{directedIds.filter((id) => !characters.some((item) => item.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
    </div>
    <div className="pw-columns">
      <main className="pw-main">
        {beat ? <><section className="pw-context"><div className="pw-panel-heading"><h3>{beat.title}</h3><Badge>{beat.kind} · {beat.durationSec}s</Badge></div><p>{beat.summary || "No beat summary authored."}</p>{beat.dialogueText ? <blockquote>{beat.dialogueText}</blockquote> : <span className="pw-note">Silent beat · no dialogue assigned</span>}</section>{activeCharacterId ? <DirectionEditor key={`${beat.id}:${activeCharacterId}:${direction?.updatedAt ?? 0}`} beat={beat} characterId={activeCharacterId} direction={direction} onSave={saveDirection} /> : <div className="pw-empty"><UserRound /><p>Link a stable character identity in Assets to begin performance direction.</p></div>}</> : <div className="pw-empty"><p>This scene has no beats. Prepare its screenplay breakdown first.</p></div>}
      </main>
      <aside className="pw-inspector"><div className="pw-panel-heading"><h3>Continuity handoff</h3><LockKeyhole size={16} /></div>{shot ? <><ContinuityCard title="Incoming" state={shot.performanceIn.performance} /><ContinuityCard title="Outgoing" state={shot.performanceOut.performance} /><div className="pw-actions"><Button size="sm" variant="secondary" onClick={() => onChange(insertOrReplaceShot(workspace, { ...shot, performanceOut: structuredClone(shot.performanceIn), continuity: { ...shot.continuity, requiredOut: structuredClone(shot.performanceIn) } }))}><Copy />Copy incoming</Button><Button size="sm" variant="ghost" onClick={() => onChange(applyContinuityFlow(workspace))}>Propagate</Button></div><section className="pw-block"><h4>{shot.continuity.hardLocks?.length ?? 0} hard locks</h4>{shot.continuity.hardLocks?.length ? <ul>{shot.continuity.hardLocks.map((lock) => <li key={lock}>{lock}</li>)}</ul> : <p>No explicit continuity locks.</p>}<Button className="mt-3" size="sm" variant="secondary" onClick={onOpenShots}>Edit shot boundaries <ArrowRight /></Button></section></> : <div className="pw-empty"><p>No prepared shot for this beat.</p><Button size="sm" onClick={onOpenShots}>Prepare coverage</Button></div>}<section className="pw-block"><h4>Source authority</h4><p>{direction?.sourceType === "ai-suggestion" ? "AI suggestion · review before approval" : "Manual beat direction"}</p><p>{workspace.approvedScreenplay.screenplayVersionId}</p>{direction?.lockedFields?.length ? <p>Locked: {direction.lockedFields.join(" · ")}</p> : null}{direction?.blockedChanges?.length ? <p>Blocked changes: {direction.blockedChanges.join(" · ")}</p> : null}</section></aside>
    </div>
  </div>;
}

const directionGroups = [
  { id: "emotionalState", label: "Intention", fields: ["primary", "secondary", "concealed", "objective"] },
  { id: "face", label: "Face & gaze", fields: ["eyes", "gazeTarget", "blinkBehavior", "brows", "jaw", "mouth", "microExpression", "tearsOrSweat"] },
  { id: "body", label: "Body & effort", fields: ["posture", "shoulders", "headPosition", "hands", "arms", "weightDistribution", "tension", "breathing", "fatigue", "injuriesOrLimitations"] },
  { id: "movement", label: "Blocking", fields: ["startingPosition", "path", "speed", "hesitation", "gesture", "envInteraction", "otherCharacterInteraction"] },
  { id: "relationship", label: "Partner & contact", fields: ["distanceBetweenCharacters", "dominantSpatialRole", "eyeContact", "avoidance", "touch", "approaches", "withdraws", "fgBgPriority"] },
  { id: "dialogue", label: "Speech", fields: ["lines", "speaker", "delivery", "pace", "pauses", "volume", "emphasis", "subtext", "interruption", "breathPlacement", "emotionalTransition"] },
] as const;

function DirectionEditor({ beat, characterId, direction, onSave }: { beat: SceneBeat; characterId: string; direction?: PerformanceDirection; onSave: (value: PerformanceDirection) => void }) {
  const initial: PerformanceDirection = direction ?? { schemaVersion: 1, sourceType: "manual", characterId, beatId: beat.id, updatedAt: 0 };
  const [draft, setDraft] = useWorkspaceDraft(`direction-draft:${beat.id}:${characterId}:${direction?.updatedAt ?? 0}`, initial);
  const [tab, setTab] = useWorkspaceDraft("direction-field-group", "emotionalState");
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  function change(group: typeof directionGroups[number]["id"], field: string, value: string) {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: field === "lines" || field === "injuriesOrLimitations" ? value.split("\n") : value } }));
  }
  function commit(approve: boolean) {
    const now = Date.now();
    onSave({ ...draft, sourceType: dirty ? "manual" : draft.sourceType, approvedAt: approve ? now : dirty ? undefined : draft.approvedAt, updatedAt: now });
  }
  return <Tabs.Root className="pw-editor" value={tab} onValueChange={setTab}>
    <div className="pw-panel-heading"><h3>Playable direction</h3><Badge>{dirty ? "Unsaved" : direction?.approvedAt ? "Approved" : direction ? "Saved draft" : "Not authored"}</Badge></div>
    <Tabs.List className="pw-tabs" aria-label="Performance field groups">{directionGroups.map((group) => { const values = draft[group.id] as Record<string, unknown> | undefined; const complete = group.fields.filter((field) => { const value = values?.[field]; return Array.isArray(value) ? value.some(Boolean) : Boolean(value); }).length; return <Tabs.Trigger key={group.id} value={group.id}>{group.label}<small>{complete}/{group.fields.length}</small></Tabs.Trigger>; })}</Tabs.List>
    {directionGroups.map((group) => <Tabs.Content className="pw-tab-content" key={group.id} value={group.id}><div className="pw-fields">{group.fields.map((field) => { const value = (draft[group.id] as Record<string, unknown> | undefined)?.[field]; const text = Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""; return <label className="pw-field" key={field}><span>{fieldLabel(field)}{!text.trim() ? <small>Not authored</small> : null}</span><Textarea rows={2} value={text} placeholder="Add authored direction" onChange={(event) => change(group.id, field, event.target.value)} /></label>; })}{group.id === "emotionalState" ? <label className="pw-field"><span>Intensity · 0 to 1</span><Input aria-label="Beat emotion intensity" type="number" min={0} max={1} step={0.05} value={draft.emotionalState?.intensity ?? ""} onChange={(event) => setDraft({ ...draft, emotionalState: { ...draft.emotionalState, intensity: event.target.value === "" ? undefined : Math.min(1, Math.max(0, Number(event.target.value))) } })} /><small>Full emotion hierarchy, felt/display, regulation and regional controls remain in Emotion & delivery.</small></label> : null}</div></Tabs.Content>)}
    <footer className="pw-editor-footer"><span className="pw-note">{dirty ? "Draft retained while switching scenes and tools" : "Changes are scoped to this performer and beat"}</span><div className="pw-actions"><Button variant="secondary" size="sm" onClick={() => commit(false)}>Save direction</Button><Button size="sm" onClick={() => commit(true)}><Check />Approve beat</Button></div></footer>
  </Tabs.Root>;
}

function fieldLabel(value: string) { return ({ fgBgPriority: "Foreground / background priority", envInteraction: "Environment interaction" } as Record<string, string>)[value] ?? value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function ContinuityCard({ title, state }: { title: string; state: PerformanceState }) {
  const fields = Object.entries(state).filter(([, value]) => value !== undefined && value !== "");
  return <section className="pw-block"><h4>{title}</h4>{fields.length ? <dl className="pw-details">{fields.map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{typeof value === "object" ? Array.isArray(value) ? value.join(" · ") : Object.entries(value).map(([part, text]) => `${part}: ${text ?? "none"}`).join(" · ") : String(value)}</dd></div>)}</dl> : <p>No carried state authored.</p>}</section>;
}
