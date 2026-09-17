import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { useStudio } from "@/lib/studio/store";
import { allCharacterVoiceIterations, attachVoiceDesignAsset, copyCharacterVoiceIteration, deleteCharacterVoiceIteration, reviewCharacterVoiceDesign, selectedCharacterVoice } from "@/lib/studio/character-voice-designs";
import type { VoiceDesign } from "@/lib/studio/voice-design-library";
import type { Picture } from "@/lib/studio/types";
import { uid } from "@/lib/utils";
import { VoiceDesignWorkspace } from "./voice-design-workspace";
import { toast } from "sonner";

const STATUS_LABELS = { DRAFT: "Design only · import an audition to approve", NEEDS_REVIEW: "Awaiting your review", APPROVED: "Approved voice", REJECTED: "Rejected audition" };
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-border bg-inset px-3 text-sm text-fg";

export function CharacterVoiceSamples({ pictureId, characterId, expanded = false }: { pictureId: string; characterId: string; expanded?: boolean }) {
  const picture = useStudio((state) => state.pictures.find((item) => item.id === pictureId));
  const [failedMedia, setFailedMedia] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ key: string; design?: VoiceDesign } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  if (!picture) return null;
  const character = picture.production?.assets.find((asset) => asset.id === characterId && asset.category === "character" && !asset.tombstone);
  if (!character) return null;
  const iterations = allCharacterVoiceIterations(picture).filter((item) => item.characterId === characterId);
  const approved = selectedCharacterVoice(picture, characterId);
  const selected = iterations.find((item) => item.id === selectedId) ?? approved ?? iterations[0];
  const update = (operation: (latest: Picture) => Picture, notice: string) => {
    try {
      const store = useStudio.getState();
      const latest = store.pictures.find((item) => item.id === pictureId);
      if (!latest) throw new Error("The picture is no longer available.");
      store.replaceActive(operation(latest));
      toast.success(notice);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update this voice iteration."); }
  };
  return <section aria-label={`${character.name} voice samples`} className="grid min-w-0 gap-3 border-t border-border pt-4 text-fg">
    <details open={expanded}>
      <summary className="min-h-11 cursor-pointer font-medium">Voice design & iterations · {iterations.length}<span className="mt-1 block text-xs font-normal text-muted">{approved ? `Approved selection: ${approved.name}` : "No approved voice selected"}</span></summary>
      <div className="mt-3 grid min-w-0 gap-4">
        <p className="text-xs leading-relaxed text-muted">Keep every audition on this character profile. Select and approve one voice; approving another replaces the previous selection.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditor({ key: uid("editor") })}>Design a new voice</Button>
          <Button variant="outline" onClick={() => setShowPicker((value) => !value)} aria-expanded={showPicker}>Choose another character’s iteration</Button>
        </div>
        {showPicker && <VoiceIterationPicker pictureId={pictureId} characterId={characterId} onAttached={(id) => { setSelectedId(id); setShowPicker(false); }} />}
        {editor && <div className="min-w-0 rounded-md border border-border p-3">
          <Button variant="ghost" onClick={() => setEditor(null)}>Close voice editor</Button>
          <VoiceDesignWorkspace key={editor.key} picture={picture} characterId={characterId} initialDesign={editor.design} />
        </div>}
        {selected && <div className="grid gap-2 rounded-md bg-elevated p-3">
          <p className="break-words text-sm">Selected for review: <strong>{selected.name}</strong></p>
          <Button disabled={!selected.audio || failedMedia[selected.id] || approved?.id === selected.id} onClick={() => update((latest) => reviewCharacterVoiceDesign(latest, selected.id, "APPROVED"), "This is now the character’s approved voice.")}>Approve selected voice</Button>
          {!selected.audio && <p className="text-xs text-muted">This iteration has no audio yet. Open its design and import an audition first.</p>}
        </div>}
        {!iterations.length && <p className="text-sm text-muted">No voice iterations yet. Design a voice or choose an iteration from another character or the library.</p>}
        {iterations.map((iteration, index) => <article key={iteration.id} aria-label={`Voice iteration ${index + 1}: ${iteration.name}`} className={`grid min-w-0 gap-3 rounded-md border p-3 ${approved?.id === iteration.id ? "border-accent bg-elevated" : "border-border bg-inset"}`}>
          <div><h5 className="break-words font-medium">{index + 1}. {iteration.name}</h5><p className="mt-1 text-xs text-muted">{approved?.id === iteration.id ? "Approved selection for this character" : iteration.status === "APPROVED" ? "Previous approval · not selected" : STATUS_LABELS[iteration.status]}</p></div>
          {iteration.source?.characterId && <p className="text-xs text-muted">Copied from another character’s iteration. This copy has its own review decision.</p>}
          {iteration.audio && <audio controls preload="none" src={iteration.audio.mediaUri} aria-label={`Listen to voice iteration ${index + 1}`} className="h-11 w-full min-w-0" onError={() => setFailedMedia((current) => ({ ...current, [iteration.id]: true }))} onCanPlay={() => setFailedMedia((current) => ({ ...current, [iteration.id]: false }))} />}
          {failedMedia[iteration.id] && <p role="alert" className="text-sm text-rec">This audition could not be played.</p>}
          <details><summary className="min-h-11 cursor-pointer text-sm leading-loose">Voice description & spoken text</summary><p className="whitespace-pre-wrap break-words text-sm text-muted">{iteration.description}</p><blockquote className="mt-3 whitespace-pre-wrap break-words text-sm">{iteration.referenceText}</blockquote></details>
          <div className="flex flex-wrap gap-2">
            <Button variant={selected?.id === iteration.id ? "secondary" : "outline"} aria-pressed={selected?.id === iteration.id} onClick={() => setSelectedId(iteration.id)}>Select iteration {index + 1}</Button>
            {iteration.design && <Button variant="ghost" onClick={() => setEditor({ key: uid("editor"), design: structuredClone(iteration.design) })}>Open design</Button>}
            {iteration.audio && <Button variant="ghost" disabled={iteration.status === "REJECTED"} onClick={() => update((latest) => reviewCharacterVoiceDesign(latest, iteration.id, "REJECTED"), "Voice iteration rejected.")}>Reject</Button>}
            <Button variant="ghost" onClick={() => setPendingDelete(iteration.id)}>Delete iteration {index + 1}</Button>
          </div>
          {pendingDelete === iteration.id && <div className="grid gap-2 rounded-md border border-border p-3"><p className="text-xs text-muted">Delete this iteration from {character.name}? {approved?.id === iteration.id ? "This will clear the character’s approved voice. " : ""}Other characters’ copies remain available.</p><div className="flex flex-wrap gap-2"><Button onClick={() => { update((latest) => deleteCharacterVoiceIteration(latest, iteration.id), "Voice iteration deleted."); setPendingDelete(null); if (selectedId === iteration.id) setSelectedId(null); }}>Confirm delete iteration</Button><Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button></div></div>}
        </article>)}
      </div>
    </details>
  </section>;
}

function VoiceIterationPicker({ pictureId, characterId, onAttached }: { pictureId: string; characterId: string; onAttached: (id: string) => void }) {
  const pictures = useStudio((state) => state.pictures);
  const library = useStudio((state) => state.voiceDesignAssets);
  const sources = pictures.flatMap((picture) => {
    const iterations = allCharacterVoiceIterations(picture);
    return (picture.production?.assets ?? []).filter((asset) => asset.category === "character" && !asset.tombstone && !(picture.id === pictureId && asset.id === characterId))
      .map((asset) => ({ key: `${picture.id}/${asset.id}`, pictureId: picture.id, characterId: asset.id, label: `${asset.name} — ${picture.title}`, iterations: iterations.filter((item) => item.characterId === asset.id) })).filter((source) => source.iterations.length);
  });
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "library");
  const [iterationId, setIterationId] = useState("");
  const [failed, setFailed] = useState(false);
  const source = sources.find((item) => item.key === sourceKey);
  const options = sourceKey === "library" ? library.map((asset) => ({ id: asset.id, name: asset.design.name, referenceText: asset.design.referenceText, audio: asset.audio })) : source?.iterations ?? [];
  const selected = options.find((item) => item.id === iterationId) ?? options[0];
  const attach = () => {
    if (!selected) return;
    try {
      const store = useStudio.getState();
      const latest = store.pictures.find((picture) => picture.id === pictureId);
      if (!latest) throw new Error("The target picture is no longer available.");
      const id = uid("voice_iteration");
      let next: Picture;
      if (sourceKey === "library") {
        const asset = store.voiceDesignAssets.find((item) => item.id === selected.id);
        if (!asset) throw new Error("The library asset is no longer available.");
        next = attachVoiceDesignAsset(latest, characterId, asset, id);
      } else {
        const from = store.pictures.find((picture) => picture.id === source?.pictureId);
        if (!from) throw new Error("The source picture is no longer available.");
        next = copyCharacterVoiceIteration(latest, characterId, from, selected.id, id);
      }
      store.replaceActive(next);
      onAttached(id);
      toast.success("Iteration attached. Review and approve it for this character.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not attach the voice iteration."); }
  };
  return <section aria-label="Choose a voice iteration" className="grid min-w-0 gap-3 rounded-md border border-border bg-elevated p-3">
    <Label>Source character or library<select aria-label="Source character or library" className={selectClass} value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); setIterationId(""); setFailed(false); }}><option value="library">Shared voice library</option>{sources.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Label>
    <Label>Source iteration<select aria-label="Source voice iteration" className={selectClass} value={selected?.id ?? ""} disabled={!options.length} onChange={(event) => { setIterationId(event.target.value); setFailed(false); }}>{!options.length && <option value="">No iterations available</option>}{options.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.name}{item.audio ? " · audio" : " · design only"}</option>)}</select></Label>
    {selected?.audio && <audio key={selected.id} controls preload="none" src={selected.audio.mediaUri} aria-label="Preview source voice iteration" className="h-11 w-full min-w-0" onError={() => setFailed(true)} onCanPlay={() => setFailed(false)} />}
    {selected && <p className="whitespace-pre-wrap break-words text-xs text-muted">{selected.referenceText}</p>}
    {failed && <p className="text-xs text-rec" role="alert">This source audition could not be played.</p>}
    <Button disabled={!selected || failed} onClick={attach}>Attach selected iteration</Button>
  </section>;
}
