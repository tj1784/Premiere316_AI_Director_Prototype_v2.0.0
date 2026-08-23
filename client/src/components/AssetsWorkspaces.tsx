import React, { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, audioUrl, useStore } from "../store";
import AssetsWorkspace from "./AssetsWorkspace";
import AssetPromptComposer from "./AssetPromptComposer";
import CharacterAssetsWorkspace from "./CharacterAssetsWorkspace";

const PROMPT_LANES = ["Brief", "Visual", "Voice Design", "Script/TTS", "OST Brief", "SFX", "Compiled"];

function activeAssetFile(asset: any) {
  const version = asset?.versions?.find((item: any) => Number(item.v) === Number(asset.activeVersion));
  return version?.file || version?.files?.[0] || null;
}

function assetPreview(project: any, asset: any) {
  const file = activeAssetFile(asset);
  if (!file) return <span className="asset-generation-placeholder">◇</span>;
  const src = assetUrl(project.slug, file);
  if (/\.(png|jpe?g|webp|gif)$/i.test(file)) return <img src={src} alt="" loading="lazy" decoding="async" />;
  if (/\.(wav|mp3|m4a|ogg|flac)$/i.test(file)) return <audio src={src} controls />;
  if (/\.(mp4|webm|mov|mkv|m4v)$/i.test(file)) return <video src={src} controls muted playsInline preload="metadata" aria-label={`${asset.name} ${asset.variant} video`} />;
  return <span className="asset-generation-placeholder">✓</span>;
}

function compileTargets(asset: any, prompt: string, continuity: string[]) {
  const locks = continuity.length ? `\n\nCONTINUITY LOCKS\n- ${continuity.join("\n- ")}` : "";
  const canonical = `${prompt.trim()}${locks}`.trim();
  return {
    "Krea 2": canonical,
    FLUX: canonical,
    "Qwen-Image": canonical,
    "ComfyUI inputs": JSON.stringify({ workflowId: asset?.workflowId || null, prompt: canonical, seed: asset?.seed ?? null }, null, 2),
    "LTX image-to-video": `${canonical}\n\nAnimate only the selected shot action. Preserve the approved identity, wardrobe, geography, and reference composition.`,
    "Machine package": JSON.stringify({
      schema: "premiere316.prompt-package/v1",
      assetId: asset?.id || null,
      assetType: asset?.category || null,
      canonicalPrompt: prompt.trim(),
      continuityLocks: continuity,
      workflowId: asset?.workflowId || null
    }, null, 2)
  };
}

export function PromptDevelopmentWorkspace({ onSendToGenerate }: { onSendToGenerate: () => void }) {
  const store = useStore();
  const project = store.project!;
  const assets = project.assets?.items || [];
  const assetIdKey = assets.map((asset: any) => asset.id).join("|");
  const selected = assets.find((item: any) => item.id === store.selectedAssetId) || assets[0] || null;
  const [lane, setLane] = useState("Visual");
  const [sceneFilter, setSceneFilter] = useState("SEQ-01|Golgotha|Temple|veil|cross");
  const [prompt, setPrompt] = useState(selected?.prompt || "");
  const [sampleText, setSampleText] = useState(selected?.sampleText || "");
  const [continuityText, setContinuityText] = useState((selected?.continuity || []).join("\n"));
  const [compiledTarget, setCompiledTarget] = useState("Krea 2");
  const [compiledAt, setCompiledAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store.selectedAssetId || !assets.some((asset: any) => asset.id === store.selectedAssetId)) store.setSelectedAsset(assets[0]?.id || null);
  }, [assetIdKey, store.selectedAssetId]);
  useEffect(() => {
    setPrompt(selected?.prompt || "");
    setSampleText(selected?.sampleText || "");
    setContinuityText((selected?.continuity || []).join("\n"));
    if (["voice", "dialogue"].includes(selected?.category)) setLane(selected.category === "voice" ? "Voice Design" : "Script/TTS");
    else if (selected?.category === "music") setLane("OST Brief");
    else if (["sfx", "ambience"].includes(selected?.category)) setLane("SFX");
    else setLane("Visual");
    setCompiledAt(null);
  }, [selected?.id, selected?.updatedAt]);

  const continuity = continuityText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const compiled = useMemo(() => compileTargets(selected, prompt, continuity), [selected?.id, selected?.workflowId, selected?.seed, prompt, continuityText]);
  const categories = useMemo(() => [...new Set(assets.map((item: any) => item.category))], [assets]);
  const visibleAssets = useMemo(() => {
    const needle = sceneFilter.trim();
    if (!needle) return assets;
    const parts = needle.split("|").map((part) => part.trim()).filter(Boolean);
    return assets.filter((asset: any) => {
      const blob = `${asset.id} ${asset.name} ${asset.variant} ${asset.sourceSection || ""} ${asset.prompt || ""}`;
      return parts.some((part) => new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(blob));
    });
  }, [assets, sceneFilter]);

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await store.patchAsset(selected.id, { prompt, sampleText, continuity });
    } finally {
      setSaving(false);
    }
  };

  const compile = async () => {
    await save();
    setCompiledAt(new Date().toISOString());
    setLane("Compiled");
  };

  const sendToGenerate = async () => {
    await save();
    onSendToGenerate();
  };

  return (
    <main className="prompt-development-workspace">
      <header className="workspace-command-bar">
        <div><span className="workspace-eyebrow">CANONICAL PROMPT PACKAGE</span><h1>Prompt Development</h1></div>
        <div className="workspace-command-actions">
          <span className={selected?.approvalCurrent ? "status-chip approved" : "status-chip draft"}>{selected?.approvalCurrent ? "Approved source" : "Draft direction"}</span>
          <button className="button secondary" disabled={!selected || saving} onClick={save}>{saving ? "Saving…" : "Save Draft"}</button>
          <button className="button primary" disabled={!selected || !prompt.trim() || saving} onClick={() => void compile()}>Compile Preview</button>
          <button className="button secondary" disabled={!selected || saving} onClick={() => void sendToGenerate()}>Save &amp; Open Generation →</button>
        </div>
      </header>

      <section className="prompt-development-grid">
        <aside className="prompt-scope-tree premium-panel">
          <header><b>SCOPE</b><small>{visibleAssets.length}/{assets.length} requirements</small></header>
          <label className="prompt-scene-filter" style={{ display: "grid", gap: 4, padding: "0 10px 8px" }}>
            <small>Scene / beat filter</small>
            <input value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value)} placeholder="SEQ-01 or Golgotha" />
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" className="button secondary" onClick={() => setSceneFilter("SEQ-01|Golgotha|Temple|veil|cross")}>SEQ-01</button>
              <button type="button" className="button secondary" onClick={() => setSceneFilter("")}>All</button>
            </span>
          </label>
          <button className="scope-root selected"><span>▣</span><div><b>{project.name}</b><small>Project package</small></div></button>
          {categories.map((category: any) => (
            <section key={category}>
              <h3>{String(category).toUpperCase()}</h3>
              {visibleAssets.filter((item: any) => item.category === category).map((asset: any) => (
                <button key={asset.id} className={selected?.id === asset.id ? "selected" : ""} onClick={() => store.setSelectedAsset(asset.id)}>
                  <span>{asset.approvalCurrent ? "●" : "○"}</span><div><b>{asset.name}</b><small>{asset.variant}</small></div>
                </button>
              ))}
            </section>
          ))}
        </aside>

        <section className="prompt-authoring premium-panel">
          <nav className="prompt-lanes" aria-label="Prompt authoring lanes">
            {PROMPT_LANES.map((item) => <button key={item} className={lane === item ? "active" : ""} onClick={() => setLane(item)}>{item}</button>)}
          </nav>
          {!selected ? <div className="workspace-empty"><h2>No asset requirement selected</h2><p>Build an asset manifest in Asset Library, then return here to author its canonical package.</p></div> : (
            <div className="prompt-editor-scroll">
              <div className="prompt-editor-heading"><div><span>{selected.categoryLabel || selected.category}</span><h2>{selected.name}</h2><p>{selected.variant}</p></div><code>{selected.id}</code></div>
              {lane === "Brief" ? (
                <div className="prompt-section-stack">
                  <details open><summary>Production brief</summary><div><p>{selected.sourceSection || "Derived from the approved screenplay and current asset manifest."}</p><textarea rows={12} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div></details>
                  <details><summary>Source screenplay context</summary><div><pre>{selected.sourcePrompt || "No extracted source passage is attached to this requirement."}</pre></div></details>
                </div>
              ) : lane === "Visual" ? (
                <div className="prompt-section-stack">
                  <details open><summary>Subject and narrative purpose</summary><div><textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div></details>
                  <details open><summary>Continuity locks</summary><div><textarea rows={6} value={continuityText} onChange={(event) => setContinuityText(event.target.value)} placeholder="One locked rule per line" /><div className="continuity-chips">{continuity.map((item) => <span key={item}>🔒 {item}</span>)}</div></div></details>
                  <details><summary>Camera, composition, lighting, and materials</summary><div><p>Keep canonical creative intent in the main prompt. Provider syntax belongs only in the Compiled lane.</p></div></details>
                  <details><summary>Negative constraints and reference bindings</summary><div><p>Reference lineage and negative constraints are compiled from the selected workflow and approved dependencies.</p></div></details>
                </div>
              ) : lane === "Voice Design" || lane === "Script/TTS" ? (
                <div className="prompt-section-stack">
                  <details open><summary>{lane === "Voice Design" ? "Approved voice identity and performance rules" : "Character script and performance direction"}</summary><div><textarea rows={14} value={sampleText} onChange={(event) => setSampleText(event.target.value)} placeholder={lane === "Voice Design" ? "Register, timbre, accent, pacing, breath, imperfections, and forbidden tendencies…" : "Dialogue, pauses, breaths, emphasis, pronunciation, and scene-level performance direction…"} /></div></details>
                  <details open><summary>Canonical creative direction</summary><div><textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div></details>
                </div>
              ) : lane === "OST Brief" || lane === "SFX" ? (
                <div className="prompt-section-stack"><details open><summary>{lane === "OST Brief" ? "Cue purpose, emotional arc, instrumentation, and sync moments" : "Atmosphere, practical sound, perspective, and exclusions"}</summary><div><textarea rows={18} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div></details></div>
              ) : (
                <div className="compiled-output-lane">
                  <div className="compiled-targets">{Object.keys(compiled).map((target) => <button key={target} className={compiledTarget === target ? "active" : ""} onClick={() => setCompiledTarget(target)}>{target}</button>)}</div>
                  <div className="compiled-document"><header><b>{compiledTarget}</b><small>{compiledAt ? `Compiled ${new Date(compiledAt).toLocaleTimeString()}` : "Preview · compile to stamp a package version"}</small></header><pre>{compiled[compiledTarget as keyof typeof compiled]}</pre></div>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="prompt-inspector premium-panel">
          <header><b>INSPECTOR</b><small>Lineage and validation</small></header>
          {selected ? <>
            <section><h3>References</h3><p>{selected.dependencies?.length ? `${selected.dependencies.length} bound dependencies` : "No explicit dependencies"}</p>{(selected.dependencies || []).slice(0, 6).map((item: string) => <code key={item}>{item}</code>)}</section>
            <section><h3>Model target</h3><b>{selected.workflow?.label || selected.workflowId || "Not assigned"}</b><small>{selected.workflow?.model || "Provider chosen at generation time"}</small></section>
            <section><h3>Validation</h3><span className={prompt.trim() ? "validation-good" : "validation-bad"}>{prompt.trim() ? "✓ Canonical intent present" : "! Prompt required"}</span><span className={continuity.length ? "validation-good" : "validation-warning"}>{continuity.length ? `✓ ${continuity.length} continuity locks` : "Continuity not explicitly locked"}</span></section>
            <section><h3>Versioning</h3><dl><div><dt>Active asset</dt><dd>v{selected.activeVersion || 0}</dd></div><div><dt>Screenplay</dt><dd>{String(project.screenplay?.revision || "draft").slice(0, 8)}</dd></div><div><dt>Updated</dt><dd>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : "—"}</dd></div></dl></section>
          </> : null}
        </aside>
      </section>
    </main>
  );
}

const GENERATION_MODES = ["All", "Images", "Character Sheets", "Locations", "Wardrobe", "Props", "Shot Guides", "Voice / TTS", "SFX", "OST Candidates"];

function matchesGenerationMode(asset: any, mode: string) {
  if (mode === "All") return true;
  const category = String(asset.category || "").toLowerCase();
  const mediaType = String(asset.mediaType || "").toLowerCase();
  if (mode === "Images") return mediaType === "image";
  if (mode === "Character Sheets") return category === "character";
  if (mode === "Locations") return category === "location";
  if (mode === "Wardrobe") return category === "wardrobe";
  if (mode === "Props") return category === "prop";
  if (mode === "Shot Guides") return ["shot", "guide", "storyboard"].includes(category);
  if (mode === "Voice / TTS") return ["voice", "dialogue", "tts"].includes(category) || mediaType === "audio";
  if (mode === "SFX") return ["sfx", "ambience"].includes(category);
  if (mode === "OST Candidates") return category === "music";
  return true;
}

export function AssetGenerationWorkspace({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const store = useStore();
  const project = store.project!;
  const assets = project.assets?.items || [];
  const [mode, setMode] = useState("All");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => store.selectedAssetId ? [store.selectedAssetId] : []);
  const [busy, setBusy] = useState(false);
  const selectedAsset = assets.find((item: any) => item.id === store.selectedAssetId) || assets[0] || null;
  const selectedIsPromptOutput = selectedAsset?.source === "prompt-generation-composer" || selectedAsset?.regenerationMode === "prompt-composer";
  const visible = assets.filter((asset: any) => matchesGenerationMode(asset, mode));
  const missing = visible.filter((asset: any) => String(asset.prompt || "").trim() && !["generated", "ready-for-shot"].includes(asset.status) && !["queued", "generating"].includes(asset.status));
  const jobs = store.jobs.filter((job: any) => job.projectSlug === project.slug && job.type === "generate_asset");
  const promptJobs = store.jobs.filter((job: any) =>
    job.projectSlug === project.slug
    && (job.type === "generate_prompt_asset" || Boolean(job.refs?.promptGenerationId))
  );

  useEffect(() => {
    void store.refreshGenerationWorkflows();
  }, [project.slug]);

  const generate = async (ids: string[], regenerate = false) => {
    if (!ids.length || busy) return;
    const promptReadyIds = ids.filter((id) => {
      const asset = assets.find((candidate: any) => candidate.id === id);
      return String(asset?.prompt || "").trim() && asset?.source !== "prompt-generation-composer" && asset?.regenerationMode !== "prompt-composer";
    });
    const voiceOnly = promptReadyIds.length && promptReadyIds.every((id) => assets.find((asset: any) => asset.id === id)?.category === "voice");
    if (voiceOnly) {
      return store.setError("Voice assets generate in Create Sound → Voice Design, not Asset Generation.");
    }
    if (!promptReadyIds.length) {
      const composerOnly = ids.some((id) => {
        const asset = assets.find((candidate: any) => candidate.id === id);
        return asset?.source === "prompt-generation-composer" || asset?.regenerationMode === "prompt-composer";
      });
      return store.setError(composerOnly
        ? "Use the asset-aware prompt composer above to create another exact request."
        : "Author a canonical prompt before sending this requirement to generation.");
    }
    if (promptReadyIds.length !== ids.length) store.setError(`${ids.length - promptReadyIds.length} requirement(s) were not queued. Prompt-composer outputs must be regenerated from the composer above.`);
    setBusy(true);
    try { await store.generateAssets(promptReadyIds, regenerate); }
    finally { setBusy(false); }
  };

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <main className="asset-generation-workspace">
      <header className="workspace-command-bar">
        <div><span className="workspace-eyebrow">REUSABLE PRODUCTION INGREDIENTS</span><h1>Asset Generation</h1></div>
        <div className="workspace-command-actions">
          <select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="Asset generation mode">{GENERATION_MODES.map((item) => <option key={item}>{item}</option>)}</select>
          <button className="button secondary" disabled={!missing.length || busy} onClick={() => generate(missing.map((item: any) => item.id))}>Generate Missing ({missing.length})</button>
          <button className="button primary" disabled={!selectedIds.length || busy} onClick={() => generate(selectedIds)}>{busy ? "Queueing…" : `Generate Selected (${selectedIds.length})`}</button>
        </div>
      </header>
      <section className="asset-prompt-workspace-section">
        <AssetPromptComposer
          project={project}
          workflows={store.generationWorkflows}
          busy={store.promptGenerationBusy}
          onSubmit={store.createPromptGeneration}
          resolveAssetUrl={(file) => assetUrl(project.slug, file)}
          submitLabel="Queue"
          initialOutputMode="video"
        />
        {(store.promptGenerationNotice || promptJobs.length > 0) && (
          <div className="asset-prompt-queue-summary" aria-live="polite">
            <span>{store.promptGenerationNotice || "Prompt generation history"}</span>
            <b>{promptJobs.filter((job: any) => ["queued", "running", "cancelling"].includes(job.status)).length} active</b>
          </div>
        )}
      </section>
      <section className="asset-generation-grid">
        <aside className="generation-requirements premium-panel">
          <header><b>REQUIREMENTS</b><small>{visible.length} in scope</small></header>
          {["Prompt Required", "Prompt Ready", "Queued", "Generating", "Review", "Approved"].map((state) => {
            const count = visible.filter((asset: any) => {
              if (state === "Prompt Required") return !String(asset.prompt || "").trim();
              if (state === "Prompt Ready") return String(asset.prompt || "").trim() && !asset.versions?.length;
              if (state === "Queued") return asset.status === "queued";
              if (state === "Generating") return asset.status === "generating";
              if (state === "Review") return asset.versions?.length && !asset.approvalCurrent;
              return asset.approvalCurrent;
            }).length;
            return <div className="requirement-state" key={state}><span>{state}</span><b>{count}</b></div>;
          })}
          <div className="generation-queue-actions"><button className="button danger" disabled={!jobs.some((job: any) => ["queued", "running"].includes(job.status))} onClick={() => store.stopAssetGeneration()}>Stop active job</button></div>
        </aside>
        <section className="generation-candidates premium-panel">
          <header><div><b>JOBS AND CANDIDATES</b><small>{jobs.filter((job: any) => ["queued", "running"].includes(job.status)).length} active</small></div><button className="button secondary" onClick={() => setSelectedIds(visible.map((item: any) => item.id))}>Select visible</button></header>
          <div className="candidate-grid">
            {visible.map((asset: any) => (
              <article key={asset.id} role="button" tabIndex={0} aria-label={`Inspect ${asset.name}`} className={`${store.selectedAssetId === asset.id ? "active" : ""} ${selectedIds.includes(asset.id) ? "checked" : ""}`} onClick={() => store.setSelectedAsset(asset.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); store.setSelectedAsset(asset.id); } }}>
                <button className="candidate-check" aria-label={`${selectedIds.includes(asset.id) ? "Remove" : "Add"} ${asset.name} ${selectedIds.includes(asset.id) ? "from" : "to"} generation selection`} aria-pressed={selectedIds.includes(asset.id)} onClick={(event) => { event.stopPropagation(); toggle(asset.id); }}>{selectedIds.includes(asset.id) ? "✓" : ""}</button>
                <div className="candidate-preview">{assetPreview(project, asset)}<span className={`candidate-status ${asset.status}`}>{asset.status || "planned"}</span></div>
                <div className="candidate-copy"><b>{asset.name}</b><span>{asset.variant}</span><small>{asset.workflow?.label || asset.workflowId || "Provider not assigned"}</small></div>
              </article>
            ))}
          </div>
        </section>
        <aside className="generation-job-inspector premium-panel">
          <header><b>JOB INSPECTOR</b><small>Prompt and lineage</small></header>
          {selectedAsset ? <>
            <div className="generation-inspector-preview">{assetPreview(project, selectedAsset)}</div>
            <h2>{selectedAsset.name}</h2><p>{selectedAsset.variant}</p>
            <dl><div><dt>Prompt version</dt><dd>{String(selectedAsset.generationFingerprint || "draft").slice(0, 8)}</dd></div><div><dt>Model</dt><dd>{selectedAsset.workflow?.model || "—"}</dd></div><div><dt>Active version</dt><dd>v{selectedAsset.activeVersion || 0}</dd></div><div><dt>Approval</dt><dd>{selectedAsset.approvalCurrent ? "Approved" : "Review required"}</dd></div></dl>
            <details><summary>Canonical prompt</summary><pre>{selectedAsset.prompt || "Prompt required"}</pre></details>
            <div className="inspector-actions"><button className="button secondary" disabled={selectedIsPromptOutput} title={selectedIsPromptOutput ? "Use the asset-aware prompt composer above to create another exact request." : undefined} onClick={() => generate([selectedAsset.id], true)}>{selectedIsPromptOutput ? "Use composer above" : "Generate alternate"}</button><button className="button primary" disabled={!selectedAsset.versions?.length || selectedAsset.approvalCurrent} onClick={() => store.approveAsset(selectedAsset.id)}>Approve candidate</button><button className="button secondary" disabled={!selectedAsset.approvalCurrent || selectedAsset.mediaType !== "image"} onClick={() => store.promoteAsset(selectedAsset.id)}>Add to Project Bin</button><button className="button ghost" onClick={onOpenLibrary}>Open Library</button></div>
          </> : <div className="workspace-empty">Select a requirement to inspect its job.</div>}
        </aside>
      </section>
    </main>
  );
}

export function OstWorkspace() {
  const store = useStore();
  const project = store.project!;
  const score = project.score || {};
  const uploadRef = useRef<HTMLInputElement>(null);
  const versions = score.versions || [];

  return (
    <main className="ost-workspace">
      <header className="workspace-command-bar"><div><span className="workspace-eyebrow">MUSIC BRIEF → SCORE PROTOTYPE</span><h1>Original Soundtrack</h1></div><div className="workspace-command-actions"><span className="status-chip draft">Prototype provider</span><button className="button secondary" onClick={() => { store.saveProject(); }}>Save Music Bible</button><button className="button primary" disabled={!store.health.ffmpeg} onClick={() => store.generateScore()}>Generate Preview Cue</button></div></header>
      <section className="ost-grid">
        <aside className="ost-bible premium-panel"><header><b>MUSIC BIBLE</b><small>Project-wide identity</small></header><label>Cinematic language<textarea rows={8} value={score.prompt || ""} onChange={(event) => store.updateScoreLocal({ prompt: event.target.value })} onBlur={() => store.saveProject()} /></label><label>Genre<select value={score.genre || "Cinematic / Orchestral"} onChange={(event) => store.updateScoreLocal({ genre: event.target.value })}><option>Cinematic / Orchestral</option><option>Ambient</option><option>Choral</option><option>Minimal Piano</option></select></label><label>Mood<select value={score.mood || "Reverent / Epic"} onChange={(event) => store.updateScoreLocal({ mood: event.target.value })}><option>Reverent / Epic</option><option>Dark / Tense</option><option>Hopeful / Uplifting</option><option>Intimate / Reflective</option></select></label><label>Tempo <span>{score.tempo || 96} BPM</span><input type="range" min={40} max={180} value={score.tempo || 96} onChange={(event) => store.updateScoreLocal({ tempo: Number(event.target.value) })} /></label><label className="ost-check"><input type="checkbox" checked={score.instrumentalOnly !== false} onChange={(event) => store.updateScoreLocal({ instrumentalOnly: event.target.checked })} /> Instrumental only</label></aside>
        <section className="ost-cue-editor premium-panel"><header><div><b>CUE EDITOR</b><small>Current project cue</small></div><span className="status-chip draft">{versions.length ? `${versions.length} candidate version${versions.length === 1 ? "" : "s"}` : "Brief ready"}</span></header><div className="ost-timeline-preview"><span>00:00</span><div className="ost-wave">{Array.from({ length: 90 }).map((_, index) => <i key={index} style={{ height: `${18 + ((index * 23) % 72)}%` }} />)}</div><span>{project.sequence?.durationSec ? `${Math.round(project.sequence.durationSec)}s` : "Scene timing"}</span></div><div className="ost-sync-grid"><label>Fade in<input type="number" min={0} step={0.5} value={score.fadeInSec || 0} onChange={(event) => store.updateScoreLocal({ fadeInSec: Number(event.target.value) })} /></label><label>Fade out<input type="number" min={0} step={0.5} value={score.fadeOutSec || 0} onChange={(event) => store.updateScoreLocal({ fadeOutSec: Number(event.target.value) })} /></label><label>Mix level<input type="number" value={score.musicLevelDb || -18} onChange={(event) => store.updateScoreLocal({ musicLevelDb: Number(event.target.value) })} /></label></div><h3>Intensity curve</h3><div className="ost-intensity"><svg viewBox="0 0 600 120" preserveAspectRatio="none"><path d="M0 100 C80 92 120 28 210 46 S360 104 430 62 S520 18 600 12" /></svg></div><div className="ost-editor-actions"><button className="button secondary" onClick={() => uploadRef.current?.click()}>Import Cue</button><button className="button primary" disabled={!store.health.ffmpeg} onClick={() => store.generateScore()}>Generate Preview Cue</button></div><input ref={uploadRef} type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) store.uploadScore(file); event.target.value = ""; }} /></section>
        <aside className="ost-versions premium-panel"><header><b>CUE VERSIONS</b><small>Generated and imported takes</small></header>{versions.length ? versions.slice().reverse().map((version: any) => <article key={version.v} className={Number(score.activeVersion) === Number(version.v) ? "active" : ""}><b>Cue v{version.v}</b><span>{version.source}</span><small>{version.createdAt ? new Date(version.createdAt).toLocaleString() : ""}</small>{version.file ? <audio src={audioUrl(project.slug, version.file)} controls /> : null}</article>) : <div className="workspace-empty"><p>Generate or import a cue to begin version review.</p></div>}<section className="stem-manager"><h3>Stem delivery</h3><span>Full mix preview</span><span>Provider stems are not implemented yet</span></section></aside>
      </section>
    </main>
  );
}

export default function AssetsWorkspaceOutlet({ tab, onNavigate, onOpenEditor }: { tab: string; onNavigate: (path: string) => void; onOpenEditor: () => void }) {
  if (tab === "prompts") return <PromptDevelopmentWorkspace onSendToGenerate={() => onNavigate("/assets/generate")} />;
  if (tab === "generate") return <AssetGenerationWorkspace onOpenLibrary={() => onNavigate("/assets/library")} />;
  if (tab === "characters") return <CharacterAssetsWorkspace onOpenLibrary={() => onNavigate("/assets/library")} />;
  if (tab === "ost") return <OstWorkspace />;
  return <AssetsWorkspace onOpenEditor={onOpenEditor} />;
}
