import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { buildEngineConfigs, type EngineConfig } from "@/lib/studio/engine-config";
import { nativeAdapterCapabilities, type EngineControlCapability, type EngineControlId, type EngineControlValue, type NativeGenerationValues } from "@/lib/studio/engine-controls";
import { diffGenerationValues, initialGenerationValues, markCustomWhenPresetValueChanges, resetToEngineDefault, resolveGenerationConfig, saveAsProjectDefault, saveEnginePreset, type GenerationConfigLayer, type SavedEnginePreset } from "@/lib/studio/generation-config";
import { validateGenerationConfig } from "@/lib/studio/generation-validation";
import type { GenerationProvenance } from "@/lib/studio/generation-provenance";
import { engineById, imageEngines } from "@/lib/studio/engines";
import { formatBytes } from "@/lib/studio/model-catalog";
import { desktopCatalog, desktopInspectEngine, desktopOpenImages, desktopUnloadEngine, isDesktopApp } from "@/lib/desktop/client";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { useDirector } from "@/lib/studio/use-director";
import { cn } from "@/lib/utils";

const MAX_REFS = 3;
const RESOLUTIONS = [
  { label: "Preview · 896 × 512", width: 896, height: 512 },
  { label: "HD · 1280 × 720", width: 1280, height: 720 },
  { label: "2K · 1536 × 864", width: 1536, height: 864 },
];
const ASPECTS: Record<string, [number, number]> = {
  "16:9": [1280, 720], "3:2": [1152, 768], "4:3": [1024, 768], "1:1": [1024, 1024], "4:5": [832, 1040], "9:16": [720, 1280],
};
type RefPlate = { id: string; name: string; dataUrl: string };

export function StillBay() {
  const picture = useActivePicture();
  const shotId = useStudio((s) => s.stillBayShotId);
  const closeStillBay = useStudio((s) => s.closeStillBay);
  const setEngines = useStudio((s) => s.setEngines);
  const { busy, exposeStill } = useDirector();
  const [configs, setConfigs] = useState<EngineConfig[]>([]);
  const [engineKey, setEngineKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<RefPlate[]>([]);
  const [values, setValues] = useState<NativeGenerationValues>({});
  const [advanced, setAdvanced] = useState(false);
  const [expert, setExpert] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<SavedEnginePreset[]>([]);
  const [lastExecution, setLastExecution] = useState<GenerationProvenance | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<Record<string, string>>({});
  const shot = picture?.shots.find((s) => s.id === shotId) ?? null;

  useEffect(() => {
    void desktopCatalog({}).then((catalog) => setConfigs(buildEngineConfigs(catalog).filter((config) => config.modality === "image")));
  }, []);

  useEffect(() => {
    if (!picture || !shot) return;
    setPrompt(shot.t2iPrompt || shot.description);
    setRefs([]);
    setLastExecution(null);
    const preferred = picture.selectedEngine.image;
    const match = configs.find((config) => config.adapterId === preferred && config.status === "Ready");
    const firstReady = configs.find((config) => config.status === "Ready");
    setEngineKey(match?.id ?? firstReady?.id ?? preferred);
  }, [shot?.id, picture?.id, configs]);

  const selectedConfig = configs.find((config) => config.id === engineKey);
  const capabilities = selectedConfig ? nativeAdapterCapabilities(selectedConfig.adapterId, selectedConfig.base.displayName) : null;

  useEffect(() => {
    if (!picture || !shot || !selectedConfig || !capabilities) return;
    const defaults = initialGenerationValues(capabilities);
    const project = readValues(projectKey(picture.id, selectedConfig.id));
    const scene = readValues(sceneKey(picture.id, shot.sceneId, selectedConfig.id));
    const shotValues = readValues(shotKey(picture.id, shot.id, selectedConfig.id));
    const layers: GenerationConfigLayer[] = [];
    if (project) layers.push({ scope: "project", scopeId: picture.id, values: project });
    if (scene) layers.push({ scope: "scene", scopeId: shot.sceneId, values: scene });
    if (shotValues) layers.push({ scope: "shot", scopeId: shot.id, values: shotValues });
    setValues(resolveGenerationConfig(defaults, layers).values);
    setSavedPresets(readPresets(selectedConfig.id));
    setRefs([]);
    setLastExecution(null);
  }, [picture?.id, shot?.id, selectedConfig?.id]);

  useEffect(() => {
    const runnable = configs.filter(
      (config): config is EngineConfig & { adapterId: string } => Boolean(config.adapterId) && config.status === "Ready",
    );
    void Promise.all(runnable.map(async (config) => ({
      id: config.id,
      result: await desktopInspectEngine({ engineId: config.adapterId, engineName: config.displayName, selectedBasePath: config.base.path }),
    }))).then((checks) => setRuntimeErrors(Object.fromEntries(checks.filter((check) => !check.result.ok).map((check) => [check.id, check.result.ok ? "" : check.result.error]))));
  }, [configs]);

  const options = useMemo(() => {
    const onBay = configs.map((config) => ({ key: config.id, label: `${config.displayName} · ${formatBytes(config.runtimeSizeBytes)} · ${runtimeErrors[config.id] ? runtimeStatusLabel(runtimeErrors[config.id]) : config.status}`, group: "On bay", disabled: config.status !== "Ready" || Boolean(runtimeErrors[config.id]) }));
    const extra = imageEngines().filter((e) => !configs.some((config) => config.adapterId === e.id)).map((e) => ({ key: e.id, label: e.name, group: "Other dialects", disabled: true }));
    return [...onBay, ...extra];
  }, [configs, runtimeErrors]);

  if (!picture || !shot) return null;
  const exposing = busy === `still:${shot.id}`;
  const validation = selectedConfig ? validateGenerationConfig(selectedConfig, capabilities, { ...values, prompt }) : null;
  const runtimeError = selectedConfig ? runtimeErrors[selectedConfig.id] : undefined;
  const canGenerate = Boolean(selectedConfig && capabilities && !runtimeError && !["MISSING COMPONENT", "INVALID CONFIGURATION", "UNSUPPORTED", "NEEDS VALIDATION"].includes(validation?.state ?? "UNSUPPORTED"));

  function change(id: EngineControlId, value: EngineControlValue) {
    if (capabilities) setValues((current) => markCustomWhenPresetValueChanges(capabilities, current, id, value));
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const loaded: RefPlate[] = [];
    for (const file of [...files].slice(0, MAX_REFS - refs.length)) {
      if (file.type && !file.type.startsWith("image/")) continue;
      loaded.push({ id: `${file.name}-${file.size}`, name: file.name, dataUrl: await readImage(file) });
    }
    setRefs((current) => [...current, ...loaded].slice(0, MAX_REFS));
  }

  async function addNative() {
    const picked = (await desktopOpenImages()).slice(0, MAX_REFS - refs.length);
    setRefs((current) => [...current, ...picked.map((item) => ({ id: `${item.name}-${item.dataUrl.length}`, name: item.name, dataUrl: item.dataUrl }))].slice(0, MAX_REFS));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-bg/70 p-3 sm:place-items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Dismiss still bay" onClick={closeStillBay} />
      <form role="dialog" aria-labelledby="still-bay-title" className="relative z-10 max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-elevated p-5 shadow-[var(--shadow-border)]" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }} onSubmit={async (event) => {
        event.preventDefault();
        if (!selectedConfig?.adapterId || !capabilities || !canGenerate) return;
        const seed = values.randomizeSeed === true && values.lockSeed !== true ? crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff : Number(values.seed ?? 0);
        const executedValues = { ...values, seed, prompt };
        setValues(executedValues);
        setEngines({ image: selectedConfig.adapterId });
        const result = await exposeStill({ shotId: shot.id, engineId: selectedConfig.adapterId, engineName: selectedConfig.displayName ?? engineById(selectedConfig.adapterId)?.name ?? engineKey, prompt, references: refs.map((ref) => ref.dataUrl), selectedBasePath: selectedConfig.base.path, values: executedValues });
        if (result) setLastExecution(result.provenance);
      }}>
        <p className="text-[11px] tracking-wide text-subtle uppercase">Expose plate</p>
        <h2 id="still-bay-title" className="mt-1 font-display text-2xl tracking-tight">Shot {String(shot.index).padStart(2, "0")} · {shot.type}</h2>
        <p className="mt-1 text-sm text-muted">{shot.description}</p>
        <div className="mt-4 grid gap-4">
          <div>
            <Label htmlFor="still-engine">Engine configuration</Label>
            <select id="still-engine" className="mt-1.5 h-11 w-full rounded-md bg-inset px-3 text-sm font-light text-fg shadow-[var(--shadow-border)] outline-none" value={engineKey} onChange={(event) => setEngineKey(event.target.value)}>{options.map((option) => <option key={option.key} value={option.key} disabled={option.disabled}>{option.group === "On bay" ? option.label : `${option.label} · runtime adapter not yet implemented`}</option>)}</select>
            {selectedConfig ? <ComponentSummary config={selectedConfig} /> : null}
          </div>

          {selectedConfig && capabilities ? <>
            <section aria-labelledby="basic-controls" className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]">
              <p id="basic-controls" className="text-[11px] tracking-wide text-subtle uppercase">Basic</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <ControlSelect label="Quality" value={String(values.qualityPreset ?? "production")} onChange={(value) => { const builtIn = capabilities.presets.find((preset) => preset.id === value); const saved = savedPresets.find((preset) => preset.id === value); setValues(builtIn ? { ...values, ...builtIn.values } : saved ? { ...saved.values } : values); }} options={[...capabilities.presets.map((preset) => ({ value: preset.id, label: preset.label })), ...savedPresets.map((preset) => ({ value: preset.id, label: preset.label })), { value: "custom", label: "Custom" }]} />
                <ControlSelect label="Aspect ratio" value={String(values.aspectRatio ?? "16:9")} onChange={(value) => { const dims = ASPECTS[value] ?? ASPECTS["16:9"]; setValues((current) => ({ ...markCustomWhenPresetValueChanges(capabilities, current, "aspectRatio", value), width: dims[0], height: dims[1] })); }} options={Object.keys(ASPECTS).map((value) => ({ value, label: value }))} />
                <ControlSelect label="Resolution" value={`${values.width}x${values.height}`} onChange={(value) => { const selected = RESOLUTIONS.find((item) => `${item.width}x${item.height}` === value); if (selected) setValues((current) => ({ ...current, width: selected.width, height: selected.height, qualityPreset: "custom" })); }} options={[...RESOLUTIONS.map((item) => ({ value: `${item.width}x${item.height}`, label: item.label })), { value: `${values.width}x${values.height}`, label: `Custom · ${values.width} × ${values.height}` }]} />
                <div><Label htmlFor="still-seed">Seed</Label><input id="still-seed" type="number" min={0} max={2147483647} step={1} value={Number(values.seed ?? 0)} disabled={values.randomizeSeed === true && values.lockSeed !== true} onChange={(event) => change("seed", Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md bg-elevated px-3 text-sm text-fg shadow-[var(--shadow-border)] outline-none disabled:text-subtle" /><div className="mt-2 flex gap-3 text-[10px] text-muted"><Toggle label="Random" checked={values.randomizeSeed === true} onChange={(checked) => setValues((current) => ({ ...current, randomizeSeed: checked, lockSeed: checked ? false : current.lockSeed }))} /><Toggle label="Locked" checked={values.lockSeed === true} onChange={(checked) => setValues((current) => ({ ...current, lockSeed: checked, randomizeSeed: checked ? false : current.randomizeSeed }))} /></div></div>
              </div>
              <p className="mt-3 text-[10px] text-subtle">Generate count: 1 · the current native worker returns one image per job.</p>
            </section>
            {capabilities.controls.references.supported ? <ReferenceControl refs={refs} setRefs={setRefs} addFiles={addFiles} addNative={addNative} /> : null}
            <div><Label htmlFor="still-prompt">T2I prompt</Label><Textarea id="still-prompt" className="mt-1.5 min-h-28" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div>

            <Disclosure label="Advanced" open={advanced} setOpen={setAdvanced}>
              <div className="grid gap-2 sm:grid-cols-2"><FixedControl capability={capabilities.controls.steps} /><FixedControl capability={capabilities.controls.guidance} /><FixedControl capability={capabilities.controls.precision} /><Unavailable capability={capabilities.controls.promptUpsampling} /><Unavailable capability={capabilities.controls.loras} /><Unavailable capability={capabilities.controls.referenceStrength} /></div>
              <div className="mt-3 border-t border-border pt-2"><ConfigRow label="Base model" value={selectedConfig.base.displayName} />{selectedConfig.slots.filter((slot) => ["text_encoder", "vae"].includes(slot.role)).map((slot) => <ConfigRow key={slot.role} label={slot.label} value={slot.selected.map((item) => item.displayName).join(" + ") || "Missing"} />)}</div>
              <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Engine preset name" placeholder="Preset name" value={presetName} onChange={(event) => setPresetName(event.target.value)} className="h-9 min-w-40 flex-1 rounded-md bg-inset px-3 text-xs text-fg shadow-[var(--shadow-border)] outline-none" /><Button type="button" variant="ghost" onClick={() => { const preset = saveEnginePreset(presetName, values); const next = [...savedPresets.filter((item) => item.id !== preset.id), preset]; setSavedPresets(next); writePresets(selectedConfig.id, next); setPresetName(""); }}>Save engine preset</Button></div>
            </Disclosure>

            <Disclosure label="Expert" open={expert} setOpen={setExpert}>
              <div className="grid gap-2 sm:grid-cols-2"><FixedControl capability={capabilities.controls.scheduler} /><FixedControl capability={capabilities.controls.runtimeImplementation} /><FixedControl capability={capabilities.controls.textEncoderPlacement} /><FixedControl capability={capabilities.controls.vaePlacement} />{["attentionBackend", "vaeTiling", "cpuOffload", "promptEmbeddingCache", "referenceEmbeddingCache", "pinInVram", "residencyTimeout"].map((id) => <Unavailable key={id} capability={capabilities.controls[id as EngineControlId]} />)}<FixedControl capability={capabilities.controls.keepResident} /></div>
              <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => setValues(resolveGenerationConfig(initialGenerationValues(capabilities), resetToEngineDefault()).values)}>Reset to engine default</Button><Button type="button" variant="ghost" onClick={() => { const defaults = initialGenerationValues(capabilities); const project = readValues(projectKey(picture.id, selectedConfig.id)); setValues(resolveGenerationConfig(defaults, project ? [{ scope: "project", scopeId: picture.id, values: project }] : []).values); }}>Reset to project</Button><Button type="button" variant="ghost" onClick={() => { const defaults = initialGenerationValues(capabilities); const layer = saveAsProjectDefault(defaults, values, picture.id); localStorage.setItem(projectKey(picture.id, selectedConfig.id), JSON.stringify(layer.values)); }}>Save as project default</Button><Button type="button" variant="ghost" onClick={() => { const defaults = initialGenerationValues(capabilities); const project = readValues(projectKey(picture.id, selectedConfig.id)); const inherited = resolveGenerationConfig(defaults, project ? [{ scope: "project", scopeId: picture.id, values: project }] : []).values; localStorage.setItem(sceneKey(picture.id, shot.sceneId, selectedConfig.id), JSON.stringify(diffGenerationValues(inherited, values))); }}>Save as scene override</Button><Button type="button" variant="ghost" onClick={() => { const defaults = initialGenerationValues(capabilities); const project = readValues(projectKey(picture.id, selectedConfig.id)); const scene = readValues(sceneKey(picture.id, shot.sceneId, selectedConfig.id)); const layers: GenerationConfigLayer[] = []; if (project) layers.push({ scope: "project", scopeId: picture.id, values: project }); if (scene) layers.push({ scope: "scene", scopeId: shot.sceneId, values: scene }); const inherited = resolveGenerationConfig(defaults, layers).values; localStorage.setItem(shotKey(picture.id, shot.id, selectedConfig.id), JSON.stringify(diffGenerationValues(inherited, values))); }}>Save as shot override</Button>{capabilities.controls.unload.supported ? <Button type="button" variant="ghost" onClick={() => void desktopUnloadEngine()}>Unload</Button> : null}</div>
            </Disclosure>
          </> : null}

          {validation ? <div className={cn("rounded-sm px-3 py-2 text-[11px] shadow-[var(--shadow-border)]", validation.state === "READY" ? "text-accent" : validation.errors.length ? "text-rec" : "text-muted")}><p>{validation.state}</p>{[...validation.errors, ...validation.warnings].map((message) => <p key={message} className="mt-0.5 text-subtle">{message}</p>)}</div> : null}
          {runtimeError ? <div className="rounded-sm px-3 py-2 text-[11px] text-rec shadow-[var(--shadow-border)]"><p>{runtimeError.startsWith("MEMORY RISK") ? "MEMORY RISK" : "UNSUPPORTED OFFLINE"}</p><p className="mt-0.5 text-subtle">{runtimeError}</p></div> : null}
          {lastExecution ? <ExecutionPanel provenance={lastExecution} /> : null}
        </div>
        <div className="mt-4 flex gap-2"><Button type="submit" disabled={exposing || !prompt.trim() || !canGenerate}>{exposing ? "Exposing…" : lastExecution ? "Expose another" : "Expose plate"}</Button><Button type="button" variant="ghost" onClick={closeStillBay}>{lastExecution ? "Done" : "Cancel"}</Button></div>
      </form>
    </div>
  );
}

function ComponentSummary({ config }: { config: EngineConfig }) {
  return <div className="mt-2 rounded-sm bg-inset px-3 py-2 shadow-[var(--shadow-border)]"><ConfigRow label="Base" value={`${config.base.displayName} · ${formatBytes(config.base.sizeBytes)}`} />{config.slots.filter((slot) => slot.required || slot.selected.length > 0).map((slot) => <ConfigRow key={slot.role} label={slot.label} value={slot.selected.length ? slot.selected.map((item) => item.displayName).join(" + ") : "Missing"} />)}<div className="mt-1 border-t border-border pt-1.5"><ConfigRow label="Selected configuration footprint" value={formatBytes(config.runtimeSizeBytes)} /></div></div>;
}

function Disclosure({ label, open, setOpen, children }: { label: string; open: boolean; setOpen: (open: boolean) => void; children: React.ReactNode }) {
  return <section className="rounded-md bg-inset shadow-[var(--shadow-border)]"><button type="button" className="flex h-11 w-full items-center justify-between px-3 text-left text-[11px] tracking-wide text-subtle uppercase" onClick={() => setOpen(!open)} aria-expanded={open}>{label}<ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} /></button>{open ? <div className="border-t border-border p-3">{children}</div> : null}</section>;
}

function FixedControl({ capability }: { capability: EngineControlCapability }) {
  if (!capability.supported) return <Unavailable capability={capability} />;
  return <div className="rounded-sm bg-elevated px-2 py-2 shadow-[var(--shadow-border)]" title={capability.help}><p className="text-[10px] text-muted">{capability.label}</p><p className="mt-0.5 text-xs text-fg">{formatControlValue(capability.runtimeDefault)}</p>{capability.fixed ? <p className="mt-0.5 text-[10px] text-subtle">Fixed by native adapter</p> : null}</div>;
}

function Unavailable({ capability }: { capability: EngineControlCapability }) {
  return <div className="rounded-sm bg-elevated px-2 py-2 opacity-70 shadow-[var(--shadow-border)]" title={capability.disabledReason ?? capability.help}><p className="text-[10px] text-muted">{capability.label}</p><p className="mt-0.5 text-[10px] text-subtle">Not exposed · native adapter support absent</p></div>;
}

function ReferenceControl({ refs, setRefs, addFiles, addNative }: { refs: RefPlate[]; setRefs: React.Dispatch<React.SetStateAction<RefPlate[]>>; addFiles: (files: FileList | null) => Promise<void>; addNative: () => Promise<void> }) {
  return <div><Label>Reference images · up to {MAX_REFS}</Label><div className="mt-1.5 flex flex-wrap gap-2">{refs.map((ref) => <div key={ref.id} className="relative size-16 overflow-hidden rounded-sm bg-inset shadow-[var(--shadow-border)]"><img src={ref.dataUrl} alt="" className="size-full object-cover" /><button type="button" className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-sm bg-bg/80 text-[10px] text-fg" onClick={() => setRefs((current) => current.filter((item) => item.id !== ref.id))} aria-label={`Remove ${ref.name}`}>×</button></div>)}{refs.length < MAX_REFS ? isDesktopApp() ? <button type="button" className="grid size-16 place-items-center rounded-sm bg-inset text-[11px] text-muted shadow-[var(--shadow-border)] hover:text-fg" onClick={() => void addNative()}>Add</button> : <label className="grid size-16 cursor-pointer place-items-center rounded-sm bg-inset text-[11px] text-muted shadow-[var(--shadow-border)] hover:text-fg">Add<input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label> : null}</div><p className="mt-1 text-[10px] text-subtle">Native FLUX.2 sequence conditioning. No unimplemented weighting or edit-strength control is shown.</p></div>;
}

function ExecutionPanel({ provenance }: { provenance: GenerationProvenance }) {
  const t = provenance.telemetry;
  return <section className="rounded-md bg-inset p-3 shadow-[var(--shadow-border)]"><p className="text-[11px] tracking-wide text-subtle uppercase">Actual execution</p><div className="mt-2 grid gap-x-6 sm:grid-cols-2"><ConfigRow label="Engine" value={provenance.engineName} /><ConfigRow label="Checkpoint" value={provenance.baseCheckpoint.path.split(/[\\/]/).pop() ?? provenance.baseCheckpoint.id} /><ConfigRow label="Precision" value={provenance.precision} /><ConfigRow label="Resolution" value={`${provenance.width} × ${provenance.height}`} /><ConfigRow label="Steps" value={String(provenance.steps)} /><ConfigRow label="Guidance" value={String(provenance.guidance)} /><ConfigRow label="Seed" value={String(provenance.seed)} /><ConfigRow label="Scheduler" value={provenance.scheduler} /><ConfigRow label="Model state" value={t.residentAfterJob ? "VRAM resident" : "Not resident"} /><ConfigRow label="Model load" value={t.modelLoadMs === null ? "Not reported" : formatMs(t.modelLoadMs)} /><ConfigRow label="Inference" value={t.inferenceMs === null ? "Not reported" : formatMs(t.inferenceMs)} /><ConfigRow label="Total" value={formatMs(t.totalMs)} /><ConfigRow label="Peak VRAM" value={t.peakVramBytes === null ? "Not reported" : formatBytes(t.peakVramBytes)} /><ConfigRow label="Peak system RAM" value={t.peakSystemRamBytes === null ? "Not reported" : formatBytes(t.peakSystemRamBytes)} /></div></section>;
}

function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const unique = options.filter((option, index) => options.findIndex((other) => other.value === option.value) === index);
  return <div><Label>{label}</Label><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-md bg-elevated px-3 text-sm text-fg shadow-[var(--shadow-border)] outline-none">{unique.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center gap-1.5"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>; }
function ConfigRow({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3 py-0.5 text-[10px]"><span className="shrink-0 text-muted">{label}</span><span className="min-w-0 text-right text-subtle">{value}</span></div>; }
function formatControlValue(value: EngineControlValue | undefined): string { if (Array.isArray(value)) return value.join(", ") || "None"; if (typeof value === "boolean") return value ? "On" : "Off"; return value === undefined ? "Not reported" : String(value); }
function formatMs(ms: number): string { return `${(ms / 1000).toFixed(2)} s`; }
function projectKey(projectId: string, configId: string): string { return `p316:project-engine:${projectId}:${configId}`; }
function sceneKey(projectId: string, sceneId: string, configId: string): string { return `p316:scene-engine:${projectId}:${sceneId}:${configId}`; }
function shotKey(projectId: string, shotId: string, configId: string): string { return `p316:shot-engine:${projectId}:${shotId}:${configId}`; }
function presetKey(configId: string): string { return `p316:engine-presets:${configId}`; }
function readValues(key: string): NativeGenerationValues | null { try { return JSON.parse(localStorage.getItem(key) ?? "null") as NativeGenerationValues | null; } catch { return null; } }
function readPresets(configId: string): SavedEnginePreset[] { try { const value = JSON.parse(localStorage.getItem(presetKey(configId)) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function writePresets(configId: string, presets: SavedEnginePreset[]) { localStorage.setItem(presetKey(configId), JSON.stringify(presets)); }
function runtimeStatusLabel(error: string): string { return error.startsWith("MEMORY RISK") ? "Memory risk" : "Unavailable offline"; }

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read reference"));
    reader.onload = () => { const raw = String(reader.result ?? ""); const img = new Image(); img.onload = () => { const scale = Math.min(1, 1280 / Math.max(img.width, img.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale)); const ctx = canvas.getContext("2d"); if (!ctx) return resolve(raw); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL("image/jpeg", 0.86)); }; img.onerror = () => resolve(raw); img.src = raw; };
    reader.readAsDataURL(file);
  });
}
