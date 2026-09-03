import { useMemo, useRef, useState } from "react";
import { FileText, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  INTAKE_SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  WORKFLOW_LABELS,
  makePictureIntake,
  makeSocialWorldEntry,
  sourceMediaType,
  validatePictureIntake,
  type IntakeSourceType,
  type PictureIntake,
} from "@/lib/studio/picture-intake";
import { screenplayModelDetail } from "@/lib/studio/screenplay-models";
import type { ScreenplayModelRef } from "@/lib/studio/screenplay";
import type { LocalLLMProviderDiscovery } from "@/lib/studio/local-llm-provider";
import { uid } from "@/lib/utils";

const sourceDescriptions: Record<IntakeSourceType, string> = {
  concept: "Build from an idea, premise, or logline.",
  treatment: "Develop a prose outline into scenes.",
  "existing-screenplay": "Preserve, refine, or rewrite an existing draft.",
  "source-material": "Adapt supplied prose, notes, or public-domain material.",
  "biblical-historical": "Protect source fidelity and the social world.",
};

function FormField({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  return <div><Label>{label}{required ? " · Required" : " · Optional"}</Label><Input className="mt-1.5" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function TextField({ label, value, onChange, required, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; rows?: number }) {
  return <div><Label>{label}{required ? " · Required" : " · Optional"}</Label><Textarea className="mt-1.5" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

export function PictureIntakeForm({
  models,
  provider,
  onCancel,
  onRescan,
  onCreate,
}: {
  models: ScreenplayModelRef[];
  provider: LocalLLMProviderDiscovery | null;
  onCancel: () => void;
  onRescan: () => void;
  onCreate: (intake: PictureIntake) => void | Promise<void>;
}) {
  const [intake, setIntake] = useState(() => makePictureIntake());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => validatePictureIntake(intake), [intake]);
  const readyModels = models.filter((model) => model.status === "ready");
  const patch = <K extends keyof PictureIntake>(key: K, value: PictureIntake[K]) => setIntake((current) => ({ ...current, [key]: value, updatedAt: Date.now() }));

  async function importText(file: File) {
    const mediaType = sourceMediaType(file.name);
    if (!mediaType) return;
    const text = await file.text();
    setIntake((current) => {
      const importedSources = [...current.importedSources, { fileName: file.name, mediaType, importedAt: Date.now(), text }];
      if (current.sourceType === "treatment") return { ...current, treatment: text, importedSources, updatedAt: Date.now() };
      if (current.sourceType === "existing-screenplay") return { ...current, existingScreenplay: text, importedSources, updatedAt: Date.now() };
      if (current.sourceType === "source-material") return { ...current, sourceMaterial: text, importedSources, updatedAt: Date.now() };
      if (current.sourceType === "biblical-historical") return { ...current, suppliedSourceText: text, importedSources, updatedAt: Date.now() };
      return { ...current, storyNotes: text, importedSources, updatedAt: Date.now() };
    });
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-bg px-5 py-3 sm:px-8">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <div className="text-center"><p className="text-[10px] tracking-[0.2em] text-subtle uppercase">01 · Intake</p><p className="font-display text-sm">New Picture</p></div>
        <Button type="submit" form="picture-intake" size="sm" disabled={saving}>{saving ? "Creating…" : "Create Picture"}</Button>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <section>
          <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">Start from</p>
          <h1 className="mt-1 font-display text-[clamp(1.75rem,4vw,2.5rem)] tracking-tight text-balance">What do you already have?</h1>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {INTAKE_SOURCE_TYPES.map((sourceType) => (
              <button key={sourceType} type="button" onClick={() => setIntake((current) => ({ ...current, sourceType, workflow: sourceType === "biblical-historical" ? "biblical-7-pass" : current.workflow === "biblical-7-pass" ? "single" : current.workflow, updatedAt: Date.now() }))} className={`min-h-28 rounded-md p-3 text-left shadow-[var(--shadow-border)] transition-[background-color,box-shadow] duration-150 ${intake.sourceType === sourceType ? "bg-accent text-accent-fg" : "bg-elevated text-fg hover:shadow-[var(--shadow-border-hover)]"}`}>
                <span className="block text-sm leading-snug">{SOURCE_TYPE_LABELS[sourceType]}</span>
                <span className={`mt-2 block text-[11px] leading-relaxed ${intake.sourceType === sourceType ? "text-accent-fg/70" : "text-muted"}`}>{sourceDescriptions[sourceType]}</span>
              </button>
            ))}
          </div>
        </section>

        <form id="picture-intake" className="mt-8 grid gap-8" onSubmit={async (event) => { event.preventDefault(); setSubmitted(true); if (!validation.valid) return; setSaving(true); try { await onCreate(intake); } finally { setSaving(false); } }}>
          <section className="rounded-lg bg-elevated p-5 shadow-[var(--shadow-border)]">
            <div className="grid gap-4">
              {intake.sourceType === "concept" ? <><TextField label="Concept" value={intake.concept} onChange={(value) => patch("concept", value)} /><TextField label="Premise" value={intake.premise} onChange={(value) => patch("premise", value)} required /><TextField label="Logline" value={intake.logline} onChange={(value) => patch("logline", value)} /><TextField label="Story notes" value={intake.storyNotes} onChange={(value) => patch("storyNotes", value)} /></> : null}
              {intake.sourceType === "treatment" ? <TextField label="Treatment / Outline" value={intake.treatment} onChange={(value) => patch("treatment", value)} required rows={12} /> : null}
              {intake.sourceType === "existing-screenplay" ? <><TextField label="Existing screenplay" value={intake.existingScreenplay} onChange={(value) => patch("existingScreenplay", value)} required rows={14} /><div><Label>Approach</Label><div className="mt-2 flex flex-wrap gap-2">{(["use-as-is", "refine", "rewrite"] as const).map((mode) => <Button key={mode} size="sm" variant={intake.existingScreenplayMode === mode ? "primary" : "secondary"} onClick={() => patch("existingScreenplayMode", mode)}>{mode === "use-as-is" ? "Use As-Is" : mode === "refine" ? "Refine" : "Rewrite"}</Button>)}</div></div></> : null}
              {intake.sourceType === "source-material" ? <><TextField label="Source material" value={intake.sourceMaterial} onChange={(value) => patch("sourceMaterial", value)} required rows={12} /><TextField label="Adaptation instructions" value={intake.adaptationInstructions} onChange={(value) => patch("adaptationInstructions", value)} /><TextField label="Material that must be preserved" value={intake.materialToPreserve} onChange={(value) => patch("materialToPreserve", value)} /><TextField label="Material that may be dramatized" value={intake.materialMayDramatize} onChange={(value) => patch("materialMayDramatize", value)} /></> : null}
              {intake.sourceType === "biblical-historical" ? <><TextField label="Source passages / references" value={intake.sourcePassages} onChange={(value) => patch("sourcePassages", value)} /><TextField label="Supplied Scripture / source text" value={intake.suppliedSourceText} onChange={(value) => patch("suppliedSourceText", value)} required rows={12} /><TextField label="Fidelity requirements" value={intake.fidelityRequirements} onChange={(value) => patch("fidelityRequirements", value)} /><div className="grid gap-4 sm:grid-cols-2"><FormField label="Historical period" value={intake.historicalPeriod} onChange={(value) => patch("historicalPeriod", value)} /><FormField label="Cultural / social-world requirements" value={intake.culturalSocialWorld} onChange={(value) => patch("culturalSocialWorld", value)} /></div><TextField label="Adaptation boundaries" value={intake.adaptationBoundaries} onChange={(value) => patch("adaptationBoundaries", value)} /></> : null}
              <div>
                <input ref={fileRef} className="sr-only" type="file" accept=".fountain,.txt,.md,.markdown,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importText(file); event.currentTarget.value = ""; }} />
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><FileText />Import text source</Button>
                {intake.importedSources.map((item) => <p key={`${item.fileName}-${item.importedAt}`} className="mt-2 text-xs text-muted">Preserved original · {item.fileName}</p>)}
              </div>
            </div>
          </section>

          <section>
            <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">Picture settings</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField label="Title" value={intake.title} onChange={(value) => patch("title", value)} required />
              <FormField label="Genre" value={intake.genre} onChange={(value) => patch("genre", value)} />
              <FormField label="Target runtime (minutes)" value={String(intake.targetRuntimeMinutes)} onChange={(value) => patch("targetRuntimeMinutes", Number(value))} required type="number" />
              <FormField label="Audience / rating target" value={intake.audienceRating} onChange={(value) => patch("audienceRating", value)} />
              <FormField label="Tone" value={intake.tone} onChange={(value) => patch("tone", value)} />
              <FormField label="Production style / visual direction" value={intake.productionStyle} onChange={(value) => patch("productionStyle", value)} />
              <div><Label>Aspect ratio · Optional</Label><select className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={intake.aspectRatio} onChange={(event) => patch("aspectRatio", event.target.value)}>{["16:9", "2.39:1", "1.85:1", "4:3", "9:16"].map((value) => <option key={value}>{value}</option>)}</select></div>
              <FormField label="Frame rate" value={String(intake.frameRate)} onChange={(value) => patch("frameRate", Number(value))} type="number" />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><TextField label="Director notes" value={intake.directorNotes} onChange={(value) => patch("directorNotes", value)} /><TextField label="Dialogue style" value={intake.dialogueStyle} onChange={(value) => patch("dialogueStyle", value)} /><TextField label="Story constraints" value={intake.storyConstraints} onChange={(value) => patch("storyConstraints", value)} /><TextField label="Must include" value={intake.mustInclude} onChange={(value) => patch("mustInclude", value)} /><TextField label="Must avoid" value={intake.mustAvoid} onChange={(value) => patch("mustAvoid", value)} /></div>
          </section>

          {intake.sourceType === "biblical-historical" ? <section><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] tracking-[0.2em] text-subtle uppercase">Social world</p><p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">Track the rule and its visible consequence for the writer/director system—not as forced exposition.</p></div><Button variant="secondary" size="sm" onClick={() => patch("socialWorld", [...intake.socialWorld, makeSocialWorldEntry(uid("social"))])}><Plus />Add note</Button></div><div className="mt-4 grid gap-3">{intake.socialWorld.map((entry, index) => <div key={entry.id} className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><div className="flex items-center justify-between"><p className="text-xs text-muted">Social-world note {index + 1}</p><Button variant="ghost" size="icon-sm" aria-label="Remove social-world note" onClick={() => patch("socialWorld", intake.socialWorld.filter((item) => item.id !== entry.id))}><X /></Button></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{([ ["expectedBehavior", "Expected social behavior"], ["violationOrReversal", "Violation / reversal"], ["whoWouldNotice", "Who would notice"], ["visibleReaction", "Visible reaction"], ["socialConsequence", "Social consequence"], ["evidenceNote", "Evidence note"] ] as const).map(([key, label]) => <FormField key={key} label={label} value={entry[key]} onChange={(value) => patch("socialWorld", intake.socialWorld.map((item) => item.id === entry.id ? { ...item, [key]: value } : item))} />)}<div><Label>Historical confidence</Label><select className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={entry.historicalConfidence} onChange={(event) => patch("socialWorld", intake.socialWorld.map((item) => item.id === entry.id ? { ...item, historicalConfidence: event.target.value as "A" | "B" | "C" | "D" } : item))}><option value="A">A · Explicit source / Scripture</option><option value="B">B · Strong evidence</option><option value="C">C · Reasonable reconstruction</option><option value="D">D · Disputed interpretation</option></select></div></div></div>)}</div></section> : null}

          <section className="grid gap-4 rounded-lg bg-elevated p-5 shadow-[var(--shadow-border)] sm:grid-cols-2">
            <div><Label>Screenplay workflow · Required</Label><select className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={intake.workflow} onChange={(event) => patch("workflow", event.target.value as PictureIntake["workflow"])}>{Object.entries(WORKFLOW_LABELS).map(([value, label]) => <option key={value} value={value} disabled={intake.sourceType === "biblical-historical" && value !== "biblical-7-pass"}>{label}</option>)}</select><p className="mt-2 text-xs leading-relaxed text-muted">{intake.workflow === "single" ? "One complete local draft." : intake.workflow === "general-7-pass" ? "Draft, then seven linked craft passes." : "Draft, then seven fidelity-aware historical passes."}</p></div>
            <div><div className="flex items-center justify-between gap-3"><Label>Screenplay model · Select before generation</Label><button type="button" className="text-[11px] text-muted hover:text-fg" onClick={onRescan}>Rescan</button></div><select className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)]" value={intake.screenplayModelId ?? ""} onChange={(event) => patch("screenplayModelId", event.target.value || null)}><option value="">Select loaded local model</option>{models.map((model) => <option key={model.id} value={model.id} disabled={model.status !== "ready"}>{model.displayName}{model.status !== "ready" ? " · Unavailable" : ""}</option>)}</select>{intake.screenplayModelId && models.some((model) => model.id === intake.screenplayModelId) ? <p className="mt-2 text-xs text-muted">{screenplayModelDetail(models.find((model) => model.id === intake.screenplayModelId)!)}</p> : <p className="mt-2 text-xs leading-relaxed text-muted">{provider?.available ? provider.reason : provider?.reason ?? "Checking LM Studio local API…"}</p>}</div>
          </section>

          {submitted && !validation.valid ? <div role="alert" className="rounded-md bg-elevated px-4 py-3 text-sm text-rec shadow-[var(--shadow-border)]">{Object.values(validation.fields)[0]}</div> : null}
          {!readyModels.length && provider ? <p className="text-sm text-muted">Screenplay generation is unavailable until LM Studio’s local API is running with a text model loaded. Your Picture Intake remains available.</p> : null}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Picture"}</Button></div>
        </form>
      </main>
    </div>
  );
}
