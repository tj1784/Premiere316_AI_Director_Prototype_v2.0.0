import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { VisualDirection } from "@/lib/studio/visual-direction";
import { addDirectionFiles, boardImage, composeDirectionBoard } from "@/lib/studio/visual-direction-board";
import { prepareVisualDirection } from "@/lib/studio/visual-direction-client";
import { makePictureIntake } from "@/lib/studio/picture-intake";

export function VisualDirectionField({ value, onChange, disabled = false, onBusy, writerId }: { value?: VisualDirection; onChange: (value: VisualDirection | undefined) => void; disabled?: boolean; onBusy?: (busy: boolean) => void; writerId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [preview, setPreview] = useState("");
  useEffect(() => { let live = true; setPreview(""); if (value?.boardId) void boardImage(value.boardId).then(src => { if(live) setPreview(src); }).catch(e => { if(live) setError(String(e)); }); return () => { live = false; }; }, [value?.boardId]);
  async function add(files: File[]) {
    if (disabled || busy || !files.length) return;
    setBusy(true); onBusy?.(true); setError("");
    try { onChange(await addDirectionFiles(value, files)); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <section aria-label="Visual direction" className="grid gap-3 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
    <h3 className="font-display text-xl">Visual direction</h3>
    <p className="text-sm text-muted">Drop reference images for color, lighting, texture and photographic style. The AI reads one combined board before writing. People and scenes remain defined by your screenplay.</p>
    <div className="rounded-md border border-dashed border-edge p-5 text-center" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled || busy ? "none" : "copy"; }} onDrop={e => { e.preventDefault(); void add(Array.from(e.dataTransfer.files)); }}>
      <input ref={input} aria-label="Upload visual direction images" className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={e => { void add(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
      <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? "Working on visual direction…" : "Drop images here or choose files"}</Button>
      <p className="mt-2 text-xs text-muted">JPG, PNG, WebP · up to 32 images · originals are not cropped</p>
    </div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {preview ? <><button type="button" aria-label="Open visual direction board" onClick={() => dialog.current?.showModal()}><img src={preview} alt="Combined visual direction reference board" className="max-h-96 w-full rounded-md object-contain" /></button><dialog ref={dialog} aria-label="Enlarged visual direction board" className="m-auto max-h-dvh w-full max-w-6xl overflow-auto rounded-lg bg-bg p-4 text-fg backdrop:bg-bg/80"><Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Close reference board</Button><img src={preview} alt="Full combined reference board" className="mt-3 w-full object-contain" /></dialog></> : null}
    {value?.sources.length ? <>
      <Button type="button" variant="secondary" disabled={disabled || busy} onClick={async () => { setBusy(true); onBusy?.(true); setError(""); try { const intake = await prepareVisualDirection({ ...makePictureIntake(), visualDirection: value }, writerId); onChange(intake.visualDirection); } catch(e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);onBusy?.(false);} }}>Analyze visual direction</Button>
      {busy ? <p role="status" className="text-sm">Preparing the reference board or reading its visual design with a local vision model…</p> : null}
      <p className="text-xs text-muted">{value.sources.length} reference images · {value.guide && value.analyzedBoardId === value.boardId ? "Visual design analyzed" : "AI will analyze this board before screenplay creation"}</p>
      <div className="flex flex-wrap gap-2">{value.sources.map(source => <Button key={source.id} type="button" size="sm" variant="ghost" disabled={disabled || busy} aria-label={`Remove ${source.name}`} onClick={async () => { setBusy(true); onBusy?.(true); try { const sources = value.sources.filter(s => s.id !== source.id); onChange(sources.length ? { sources, notes: value.notes, boardId: await composeDirectionBoard(sources) } : undefined); } catch(e) { setError(String(e)); } finally {setBusy(false); onBusy?.(false);} }}>{source.name} ×</Button>)}</div>
      <label className="grid gap-2 text-sm">Visual design notes<textarea aria-label="Visual design notes" className="min-h-24 rounded-md bg-inset p-3" disabled={disabled || busy} value={value.notes} onChange={e => onChange({ ...value, notes: e.target.value, analyzedBoardId: undefined })} placeholder="Which visual qualities should the film follow?" /></label>
      {value.guide ? <details><summary className="text-sm">Observed visual design · {value.analysisModel}</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted">{value.guide}</p></details> : null}
    </> : null}
  </section>;
}
