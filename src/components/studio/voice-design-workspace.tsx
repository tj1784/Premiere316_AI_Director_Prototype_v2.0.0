import { inspectVoiceBytes, exportVoiceReferences } from "@/lib/studio/voice-reference";
import { useId, useRef, useState } from "react";
import { Download, Library, Mic2, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { readyTextFile, saveReadyFile, uid } from "@/lib/utils";
import { BIBLICAL_VOICE_DESIGN, createVoiceDesignAsset, exportVoiceWorkflow, importVoiceDesign, MASCULINE_VOICE_DESIGN, validateVoiceDesign, voiceDesignFilename, type VoiceDesign, type VoiceDesignAsset } from "@/lib/studio/voice-design-library";
import { attachVoiceDesignAsset } from "@/lib/studio/character-voice-designs";

const statusLabels = { DRAFT: "Design only", NEEDS_REVIEW: "Awaiting review", APPROVED: "Approved audition", REJECTED: "Rejected audition" };
const selectClass = "h-11 w-full rounded-md bg-inset px-3 text-sm text-fg border border-border";

export function VoiceDesignWorkspace({ picture, characterId, initialDesign }: { picture: Picture; characterId?: string; initialDesign?: VoiceDesign }) {
  const formId = useId();
  const fieldId = (name: string) => characterId ? `${formId}-${name}` : name;
  const assets = useStudio((state) => state.voiceDesignAssets);
  const [targetId, setTargetId] = useState(characterId ?? "");
  const targetCharacterId = characterId ?? targetId;
  const defaultDesign = () => {
    const next = structuredClone(BIBLICAL_VOICE_DESIGN);
    const character = picture.production?.assets.find((asset) => asset.id === targetCharacterId);
    if (character) {
      next.name = `${character.name} · voice design`;
      const reference = character.references.find((item) => item.preferred) ?? character.references[0];
      const filename = reference?.uri.startsWith("data:") ? reference.name : reference?.uri.split("/").pop()?.split("?")[0];
      next.enhancer!.image = filename && /\.(png|jpe?g|webp)$/i.test(filename) ? filename : "";
      next.enhancer!.prompt += `\n\nCHARACTER NOTES\n${character.name}\n${character.canonicalSpec.identity}\n${character.canonicalSpec.visualDescription}`;
    }
    return next;
  };
  const [design, setDesign] = useState<VoiceDesign>(() => structuredClone(initialDesign ?? defaultDesign()));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const workflowInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const patch = (next: Partial<VoiceDesign>) => { setDesign((current) => ({ ...current, ...next })); setError(null); setNotice(null); };
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not save this voice design.");
  const save = (snapshot: VoiceDesign, audio?: VoiceDesignAsset["audio"]) => {
    const asset = createVoiceDesignAsset(snapshot, uid("voice"), picture.id, audio);
    useStudio.setState((state) => {
      const latest = state.pictures.find((item) => item.id === picture.id);
      if (targetCharacterId && !latest) throw new Error("The picture is no longer available.");
      const updated = targetCharacterId ? attachVoiceDesignAsset(latest!, targetCharacterId, asset, uid("voice_iteration")) : undefined;
      return { voiceDesignAssets: [asset, ...state.voiceDesignAssets], ...(updated ? { pictures: state.pictures.map((item) => item.id === updated.id ? updated : item) } : {}) };
    });
    setError(null);
    setNotice(targetCharacterId ? "New iteration attached to the character and saved in the library." : audio ? "Audition added to the library for review." : "Voice design added to the library.");
  };
  const exportWorkflow = async () => {
    try {
      const file = readyTextFile(`${voiceDesignFilename(design.name)}.json`, JSON.stringify(exportVoiceWorkflow(design), null, 2), "application/json");
      try { await saveReadyFile(file); } finally { window.setTimeout(() => URL.revokeObjectURL(file.href), 60_000); }
      setError(null);
    } catch (cause) { report(cause); }
  };
  const importWorkflow = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a workflow JSON smaller than 1 MB.");
      setDesign(importVoiceDesign(JSON.parse(await file.text()), file.name));
      setError(null); setNotice("Workflow loaded. Save the design to keep it in the library.");
    } catch (cause) { report(cause); }
  };
  const importAudio = async (file?: File) => {
    if (!file) return;
    const snapshot = structuredClone(design);
    setBusy(true);
    try {
      validateVoiceDesign(snapshot);
      const extension = file.name.split(".").pop()?.toLowerCase();
      const mime = { wav: "audio/wav", flac: "audio/flac", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4" }[extension ?? ""];
      if (!mime || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("Choose a WAV, FLAC, MP3, OGG, or M4A audition up to 20 MB.");
      const mediaUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The audio file could not be read."));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(new Blob([file], { type: mime }));
      });
      await verifyAudio(mediaUri);
      const metadata = await inspectVoiceBytes(await file.arrayBuffer());
      save(snapshot, { ...metadata, mediaUri, filename: file.name, referenceText: snapshot.referenceText, bytes: file.size, origin: "imported" });
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  };
  const visible = assets.filter((asset) => !asset.deletedAt && (filter === "all" || (filter === "audio" ? Boolean(asset.audio) : asset.status === filter))
    && `${asset.design.name} ${asset.design.description} ${asset.design.enhancer?.image ?? ""} ${asset.design.enhancer?.prompt ?? ""} ${asset.design.referenceText}`.toLowerCase().includes(search.toLowerCase()));

  return <section aria-label="Voice design" className="my-5 grid min-w-0 gap-5 text-fg">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-display text-2xl"><Mic2 className="size-5" aria-hidden="true" />Voice design</h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">Describe a voice, keep its exact audition text, and build a reusable asset library.</p></div>
      <Button variant="outline" onClick={async () => { const f=readyTextFile("voice-references.json",JSON.stringify(exportVoiceReferences(picture),null,2),"application/json"); await saveReadyFile(f); }}>Export approved references</Button>
      <Button variant="outline" onClick={() => workflowInput.current?.click()} disabled={busy}><Upload />Import workflow</Button>
    </div>
    <input ref={workflowInput} type="file" accept=".json,application/json" className="hidden" aria-label="Import voice workflow JSON" onChange={(event) => { void importWorkflow(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={audioInput} type="file" accept=".wav,.flac,.mp3,.ogg,.m4a" className="hidden" aria-label="Import voice audition audio" onChange={(event) => { void importAudio(event.target.files?.[0]); event.target.value = ""; }} />
    <div ref={editor} className="grid min-w-0 gap-4 rounded-lg border border-border bg-elevated p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-medium text-muted">Qwen3-TTS 1.7B VoiceDesign</p><p className="mt-1 text-xs text-subtle">Local model · dedicated runtime · FLAC / WAV output</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { setDesign(defaultDesign()); setError(null); setNotice("Biblical image-guided template loaded."); }}>Load biblical template</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setDesign(structuredClone(MASCULINE_VOICE_DESIGN)); setError(null); setNotice("Supplied masculine voice preset loaded."); }}>Load masculine preset</Button>
        </div>
      </div>
      <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-name")}>Asset name</Label><Input id={fieldId("voice-design-name")} value={design.name} onChange={(event) => patch({ name: event.target.value })} /></div>
      {!characterId && <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-character")}>Attach new iterations to</Label><select id={fieldId("voice-design-character")} className={selectClass} value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Library only</option>{picture.production?.assets.filter((asset) => asset.category === "character" && !asset.tombstone).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {design.enhancer ? <div className="grid content-start gap-2">
          <Label htmlFor={fieldId("voice-design-image")}>Character image filename</Label>
          <Input id={fieldId("voice-design-image")} value={design.enhancer.image} onChange={(event) => patch({ enhancer: { ...design.enhancer!, image: event.target.value } })} />
          <p className="text-xs leading-relaxed text-muted">Image → casting description → voice audition. This image must be available in ComfyUI; the workflow JSON contains its filename, not its pixels.</p>
        </div> : <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-description")}>Voice description</Label><Textarea id={fieldId("voice-design-description")} rows={4} value={design.description} onChange={(event) => patch({ description: event.target.value })} /></div>}
        <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-reference")}>Spoken reference text</Label><Textarea id={fieldId("voice-design-reference")} rows={4} value={design.referenceText} onChange={(event) => patch({ referenceText: event.target.value })} /></div>
      </div>
      {design.enhancer && <details>
        <summary className="min-h-11 cursor-pointer text-sm leading-loose text-muted">Image-guided casting instructions</summary>
        <div className="mt-2 grid min-w-0 gap-2">
          <Label htmlFor={fieldId("voice-design-casting")}>Prompt enhancer instructions</Label>
          <Textarea id={fieldId("voice-design-casting")} rows={8} value={design.enhancer.prompt} onChange={(event) => patch({ enhancer: { ...design.enhancer!, prompt: event.target.value } })} />
          <p className="text-xs leading-relaxed text-muted">The enhancer generates the voice description when you run the workflow. These instructions are separate from the spoken reference text.</p>
          <p className="break-words text-xs text-subtle">SulphurPromptEnhancer · {design.enhancer.model} · {design.enhancer.baseUrl}</p>
        </div>
      </details>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-seed")}>Fixed seed</Label><Input id={fieldId("voice-design-seed")} type="number" min={0} step={1} value={Number.isFinite(design.seed) ? design.seed : ""} onChange={(event) => patch({ seed: event.target.valueAsNumber })} /></div>
        <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-language")}>Language</Label><Input id={fieldId("voice-design-language")} value={design.language} onChange={(event) => patch({ language: event.target.value })} /></div>
        <div className="grid gap-2"><Label htmlFor={fieldId("voice-design-format")}>Output format</Label><select id={fieldId("voice-design-format")} className={selectClass} value={design.format} onChange={(event) => patch({ format: event.target.value as VoiceDesign["format"] })}><option value="flac">FLAC</option><option value="wav">WAV</option></select></div>
      </div>
      <details><summary className="min-h-11 cursor-pointer text-sm leading-loose text-muted">Generation settings</summary><div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([{ key: "topK", label: "Top K", min: 1, max: 100, step: 1 }, { key: "topP", label: "Top P", min: 0.01, max: 1, step: 0.01 }, { key: "temperature", label: "Temperature", min: 0.01, max: 2, step: 0.01 }, { key: "repetitionPenalty", label: "Repetition penalty", min: 1, max: 2, step: 0.01 }, { key: "maxNewTokens", label: "Token limit", min: 1, max: 8192, step: 1 }] as const).map((field) => <div key={field.key} className="grid gap-2"><Label htmlFor={fieldId(`voice-${field.key}`)}>{field.label}</Label><Input id={fieldId(`voice-${field.key}`)} type="number" min={field.min} max={field.max} step={field.step} value={Number.isFinite(design[field.key]) ? design[field.key] : ""} onChange={(event) => patch({ [field.key]: event.target.valueAsNumber })} /></div>)}
      </div></details>
      <p className="text-xs leading-relaxed text-muted">Export this workflow to run in ComfyUI with your installed Qwen model, then import the audition. Direct generation is not connected. Before importing, make sure the reference text matches every spoken word.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => { try { save(design); } catch (cause) { report(cause); } }}><Save />{targetCharacterId ? "Save character iteration" : "Save design to library"}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void exportWorkflow()}><Download />Export workflow</Button>
        <Button variant="outline" disabled={busy} onClick={() => { try { validateVoiceDesign(design); audioInput.current?.click(); } catch (cause) { report(cause); } }}><Upload />{busy ? "Checking audio…" : "Import audition to library"}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-rec">{error}</p>}
      {notice && <p role="status" className="text-sm text-good">{notice}</p>}
    </div>
    {!characterId && <section aria-label="Voice asset library" className="grid min-w-0 gap-4">
      <div><h4 className="flex items-center gap-2 font-display text-xl"><Library className="size-5" aria-hidden="true" />Voice asset library <span className="text-sm text-muted">{assets.length}</span></h4><p className="mt-1 text-xs text-muted">Available across pictures on this device. Each save keeps a separate design or audition.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="Search voice assets" placeholder="Search names, voices, or reference text" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter voice assets" className={selectClass} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All assets</option><option value="DRAFT">Designs only</option><option value="audio">With audio</option><option value="NEEDS_REVIEW">Awaiting review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></div>
      {!visible.length && <p className="rounded-md border border-border p-5 text-sm text-muted">{assets.length ? "No voice assets match your search and filter." : "Your voice template is ready above. Save it here, or import an audition to start listening and reviewing."}</p>}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">{visible.map((asset) => <VoiceAssetCard key={asset.id} asset={asset} onUse={() => { setDesign(structuredClone(asset.design)); setError(null); setNotice(`Loaded ${asset.design.name}. Edits will be saved as a new asset.`); editor.current?.scrollIntoView({ block: "start" }); }} />)}</div>
    </section>}
  </section>;
}

function VoiceAssetCard({ asset, onUse }: { asset: VoiceDesignAsset; onUse: () => void }) {
  const [failed, setFailed] = useState(false);
  const review = (status: VoiceDesignAsset["status"]) => {
    if(status==='APPROVED'&&!asset.audio?.sha256){toast.error('Reimport and verify this legacy audio before approving it.');return;}
    useStudio.setState((state) => ({ voiceDesignAssets: state.voiceDesignAssets.map((entry) => entry.id === asset.id ? { ...entry, status, conflicts: [], reviewHistory: [...(entry.reviewHistory??[]),{status,at:Date.now(),revision:(entry.revision??0)+1}], updatedAt: Date.now(), reviewedAt: Date.now(), revision: (entry.revision ?? 0) + 1 } : entry) }));
    toast.success("Audition review saved.");
  };
  return <article aria-label={asset.design.name} className="grid min-w-0 content-start gap-3 rounded-lg border border-border bg-elevated p-4">
    <div><h5 className="break-words font-medium">{asset.design.name}</h5><p className="mt-1 text-xs text-muted">{statusLabels[asset.status]} · {new Date(asset.createdAt).toLocaleDateString()} · Seed {asset.design.seed}</p></div>
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{asset.design.enhancer ? `Image-guided voice · ${asset.design.enhancer.image}` : asset.design.description}</p>
    <details><summary className="min-h-11 cursor-pointer text-sm leading-loose">Spoken reference text</summary><p className="whitespace-pre-wrap break-words text-sm text-muted">{asset.audio?.referenceText ?? asset.design.referenceText}</p></details>
    {asset.reviewNote&&<p className="text-sm text-accent">{asset.reviewNote}</p>}
    {!!asset.conflicts?.length&&<p role="alert" className="text-sm text-rec">Conflicting saved reviews. Review this audition again.</p>}
    {asset.audio && <><audio controls preload="none" className="h-11 w-full min-w-0" src={asset.audio.previewUri??asset.audio.mediaUri} aria-label={`Listen to ${asset.design.name}`} onError={() => setFailed(true)} onCanPlay={() => setFailed(false)} /><p className="break-words text-xs text-subtle">{asset.textKind??'audition'} · {asset.audio.filename}</p>{failed && <p role="alert" className="text-sm text-rec">This audio could not be played. Its review has not changed.</p>}</>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onUse}>Use design</Button>
      <Button variant="ghost" onClick={()=>{useStudio.setState(state=>({voiceDesignAssets:state.voiceDesignAssets.map(entry=>entry.id===asset.id?{...entry,deletedAt:Date.now(),updatedAt:Date.now(),revision:(entry.revision??0)+1}:entry)}));toast.success('Removed from the library. Existing character attachments and media files are retained.');}}>Remove from library</Button>
      {asset.audio && <a className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-fg hover:bg-inset" href={asset.audio.mediaUri} download={asset.audio.filename}>Download audio</a>}
      {asset.audio && <><Button variant="outline" disabled={failed || asset.status === "APPROVED"} onClick={() => review("APPROVED")}>Approve audition</Button><Button variant="ghost" disabled={asset.status === "REJECTED"} onClick={() => review("REJECTED")}>Reject audition</Button>{asset.status !== "NEEDS_REVIEW" && <Button variant="ghost" onClick={() => review("NEEDS_REVIEW")}>Review again</Button>}</>}
    </div>
  </article>;
}

async function verifyAudio(uri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const finish = (error?: Error) => { clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute("src"); audio.load(); error ? reject(error) : resolve(); };
    const timeout = window.setTimeout(() => finish(new Error("The audio could not be checked. Try a WAV or FLAC file.")), 15_000);
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? undefined : new Error("This file has no valid audio duration."));
    audio.onerror = () => finish(new Error("This file is not playable audio. Try a WAV or FLAC file."));
    audio.preload = "metadata"; audio.src = uri;
  });
}
