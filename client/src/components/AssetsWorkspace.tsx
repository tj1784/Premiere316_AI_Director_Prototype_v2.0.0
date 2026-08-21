import React, { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, useStore } from "../store";

const CATEGORY_ORDER = [
  "character",
  "wardrobe",
  "location",
  "artifact",
  "extra",
  "atmosphere",
  "guide-frame",
  "voice",
  "sound",
  "music",
  "graphic"
];

const CATEGORY_ICONS: Record<string, string> = {
  character: "◉",
  wardrobe: "♢",
  location: "⌂",
  artifact: "◆",
  extra: "◌",
  atmosphere: "✦",
  "guide-frame": "▣",
  voice: "◖",
  sound: "≋",
  music: "♫",
  graphic: "T"
};

const CATEGORY_LABELS: Record<string, string> = {
  character: "Characters",
  wardrobe: "Wardrobe",
  location: "Locations",
  artifact: "Props & Artifacts",
  extra: "Crowds & Creatures",
  atmosphere: "Atmosphere & VFX",
  "guide-frame": "Guide Frames",
  voice: "Voices",
  sound: "Sound Design",
  music: "Music",
  graphic: "Graphics"
};

const AUDIO_UPLOAD_CATEGORIES = new Set(["voice", "sound", "music"]);
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/mp4,audio/aac,audio/ogg,application/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg";

function acceptsAudioUpload(asset: any) {
  return Boolean(asset && (asset.mediaType === "audio" || AUDIO_UPLOAD_CATEGORIES.has(String(asset.category || ""))));
}

function AssetEditorDialog({ mode, asset, workflows, busy, onCancel, onSubmit, onUploadImage, onUploadAudio }: {
  mode: "create" | "edit";
  asset?: any;
  workflows: any[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: any) => void;
  onUploadImage?: (file: File) => void;
  onUploadAudio?: (file: File) => void;
}) {
  const [name, setName] = useState(asset?.name || "");
  const [variant, setVariant] = useState(asset?.variant || "Production Reference");
  const [category, setCategory] = useState(asset?.category || "character");
  const [workflowId, setWorkflowId] = useState(asset?.workflowId || "");
  const [prompt, setPrompt] = useState(asset?.prompt || "");
  const [sampleText, setSampleText] = useState(asset?.sampleText || "");
  const [continuity, setContinuity] = useState((asset?.continuity || []).join("\n"));
  const [dependencies, setDependencies] = useState((asset?.dependencies || []).join("\n"));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  return (
    <div className="asset-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form className="asset-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name,
          variant,
          category,
          workflowId: workflowId || undefined,
          prompt,
          sampleText,
          continuity: continuity.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          dependencies: dependencies.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        });
      }}>
        <header>
          <div><p className="eyebrow">ASSET LIBRARY</p><h2 id="asset-editor-title">{mode === "create" ? "Create New Asset" : "Edit Asset Details"}</h2></div>
          <button type="button" className="asset-dialog-close" aria-label="Close asset editor" onClick={onCancel} disabled={busy}>×</button>
        </header>
        <div className="asset-dialog-fields">
          <label><span>Name</span><input data-testid="asset-name" required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Production asset name" autoFocus /></label>
          <label><span>Variant</span><input data-testid="asset-variant" required maxLength={120} value={variant} onChange={(event) => setVariant(event.target.value)} placeholder="Production Reference" /></label>
          <label><span>Category</span><select data-testid="asset-category" value={category} onChange={(event) => { setCategory(event.target.value); if (mode === "create") setWorkflowId(""); }}>{CATEGORY_ORDER.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}</select></label>
          <label><span>Generation Workflow</span><select data-testid="asset-workflow" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}><option value="">Automatic category routing</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.label}{workflow.ready === false ? " — unavailable" : ""}</option>)}</select></label>
          {mode === "edit" && asset?.mediaType === "image" && onUploadImage ? (
            <section className="asset-upload-panel wide">
              <div><span>UPLOAD IMAGE VERSION</span><small>PNG, JPEG, or WebP · imported as a new unapproved version</small></div>
              <input data-testid="asset-image-file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
              <button data-testid="asset-image-upload" type="button" className="primary-action" disabled={busy || !imageFile} onClick={() => { if (imageFile) onUploadImage(imageFile); }}>{busy ? "Uploading…" : "Upload Image"}</button>
            </section>
          ) : null}
          {mode === "edit" && acceptsAudioUpload(asset) && onUploadAudio ? (
            <section className="asset-upload-panel audio wide">
              <div><span>UPLOAD AUDIO VERSION</span><small>MP3, WAV, FLAC, M4A, AAC, or OGG · imported as a playable asset version</small></div>
              <input data-testid="asset-audio-file" type="file" accept={AUDIO_ACCEPT} onChange={(event) => setAudioFile(event.target.files?.[0] || null)} />
              <button data-testid="asset-audio-upload" type="button" className="primary-action" disabled={busy || !audioFile} onClick={() => { if (audioFile) onUploadAudio(audioFile); }}>{busy ? "Uploading…" : "Upload Audio"}</button>
            </section>
          ) : null}
          <label className="wide"><span>Generation Prompt / Direction {category === "voice" ? <small className={prompt.length > 4000 ? "asset-limit-error" : "asset-character-count"}>{prompt.length}/4000 · Qwen VoiceDesign direction</small> : null}</span><textarea data-testid="asset-prompt" rows={8} maxLength={category === "voice" ? 4000 : undefined} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the exact production asset and continuity requirements." /></label>
          {category === "voice" ? <label className="wide"><span>Audition Line</span><textarea rows={3} value={sampleText} onChange={(event) => setSampleText(event.target.value)} /></label> : null}
          <label><span>Continuity Locks <small>one per line</small></span><textarea rows={4} value={continuity} onChange={(event) => setContinuity(event.target.value)} /></label>
          <label><span>Dependencies <small>asset IDs, one per line</small></span><textarea rows={4} value={dependencies} onChange={(event) => setDependencies(event.target.value)} /></label>
        </div>
        <footer>
          <small>{mode === "create" ? "A stable asset ID and workflow snapshot will be created automatically." : "Existing generated versions remain immutable; changed direction requires a fresh generation."}</small>
          <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>Cancel</button>
          <button data-testid="asset-submit" type="submit" className="primary-action" disabled={busy || !name.trim()}>{busy ? "Saving…" : mode === "create" ? "Create Asset" : "Save Details"}</button>
        </footer>
      </form>
    </div>
  );
}

function activeFile(asset: any) {
  if (asset?.activeVersionCurrent === false) return null;
  const version = (asset?.versions || []).find((item: any) => Number(item.v) === Number(asset.activeVersion));
  return version?.file || version?.files?.[0] || null;
}

function assetApproved(project: any, asset: any) {
  if (typeof asset?.approvalCurrent === "boolean") return asset.approvalCurrent;
  const active = (asset?.versions || []).find((version: any) => Number(version.v) === Number(asset.activeVersion));
  return Boolean(
    active?.assetFingerprint &&
    active?.fileHashes?.length &&
    asset?.approval?.status === "approved" &&
    Number(asset.approval.activeVersion) === Number(asset.activeVersion) &&
    asset.approval.generationFingerprint === active.assetFingerprint &&
    asset.approval.workflowId === asset.workflowId &&
    String(asset.approval.workflowHash || "") === String(asset.workflowHash || "") &&
    active.workflowId === asset.workflowId &&
    String(active.workflowHash || "") === String(asset.workflowHash || "") &&
    asset.approval.screenplayRevision === project?.screenplay?.revision
  );
}

function StatusPill({ status }: { status: string }) {
  const state = String(status || "planned").toLowerCase();
  return <span className={`asset-status ${state.replace(/[^a-z0-9]+/g, "-")}`}><i />{state.replace(/-/g, " ")}</span>;
}

function AssetPreview({ project, asset, large = false }: { project: any; asset: any; large?: boolean }) {
  const file = activeFile(asset);
  if (!file) {
    return (
      <div className={`asset-placeholder ${large ? "large" : ""}`}>
        <span>{CATEGORY_ICONS[asset.category] || "◇"}</span>
        <small>{asset.mediaType === "audio" ? "Audio not generated" : asset.mediaType === "instruction" ? "Shot-native cue" : "Awaiting generation"}</small>
      </div>
    );
  }
  const url = assetUrl(project.slug, file);
  if (/\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(file)) {
    return <div className={`asset-audio-preview ${large ? "large" : ""}`}><span>♫</span><audio controls src={url} /></div>;
  }
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) return <img className={`asset-image-preview ${large ? "large" : ""}`} src={url} alt={`${asset.name} ${asset.variant}`} />;
  if (/\.(mp4|webm|mov|mkv|m4v)$/i.test(file)) return <video className={`asset-image-preview ${large ? "large" : ""}`} src={url} controls muted playsInline preload="metadata" aria-label={`${asset.name} ${asset.variant} video`} />;
  return <div className={`asset-placeholder ${large ? "large" : ""}`}><span>✓</span><small>{file}</small></div>;
}

export default function AssetsWorkspace({ onOpenEditor }: { onOpenEditor: () => void }) {
  const store = useStore();
  const project = store.project;
  const assets = project?.assets?.items || [];
  const [category, setCategory] = useState("all");
  const selectedId = store.selectedAssetId;
  const setSelectedId = store.setSelectedAsset;
  const [checked, setChecked] = useState<string[]>([]);
  const [assetSelectionAnchorId, setAssetSelectionAnchorId] = useState<string | null>(null);
  const [confirmGpuHandoff, setConfirmGpuHandoff] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [assetEditor, setAssetEditor] = useState<{ mode: "create" | "edit"; asset?: any } | null>(null);
  const [assetEditorBusy, setAssetEditorBusy] = useState(false);
  const assetImageInput = useRef<HTMLInputElement>(null);
  const assetAudioInput = useRef<HTMLInputElement>(null);
  const assetIdKey = assets.map((asset: any) => asset.id).join("|");
  const selected = assets.find((asset: any) => asset.id === selectedId) || assets[0] || null;
  const [prompt, setPrompt] = useState(selected?.prompt || "");
  const [sampleText, setSampleText] = useState(selected?.sampleText || "");

  useEffect(() => { store.refreshAssetWorkflows(); store.refreshPromptEnhance(); }, []);
  useEffect(() => {
    if (!selectedId || !assets.some((asset: any) => asset.id === selectedId)) setSelectedId(assets[0]?.id || null);
  }, [assetIdKey, selectedId]);
  useEffect(() => {
    setPrompt(selected?.prompt || "");
    setSampleText(selected?.sampleText || "");
  }, [selected?.id, selected?.updatedAt, selected?.promptEnhancedAt, selected?.prompt, selected?.sampleText]);
  useEffect(() => {
    if (!store.promptEnhanceBusy) return;
    const timer = window.setInterval(() => { store.refreshPromptEnhance(); }, 4000);
    return () => window.clearInterval(timer);
  }, [store.promptEnhanceBusy]);

  const categories = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const asset of assets) {
      const entry = map.get(asset.category) || { key: asset.category, label: asset.categoryLabel || asset.category, count: 0 };
      entry.count += 1;
      map.set(asset.category, entry);
    }
    return [...map.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key));
  }, [assets]);

  const visible = category === "all" ? assets : assets.filter((asset: any) => asset.category === category);
  const visibleIds = visible.map((asset: any) => asset.id);
  const allVisibleChecked = Boolean(visibleIds.length && visibleIds.every((id: string) => checked.includes(id)));
  const generated = assets.filter((asset: any) => ["generated", "ready-for-shot"].includes(asset.status)).length;
  const readyWorkflows = store.assetWorkflows.filter((workflow: any) => workflow.ready);
  const availableWorkflows = readyWorkflows.filter((workflow: any) => workflow.availableNow !== false);
  const waitingWorkflows = readyWorkflows.filter((workflow: any) => workflow.availableNow === false);
  const activeAssetJobs = store.jobs.filter((job: any) => job.projectSlug === project.slug && job.type === "generate_asset" && ["queued", "running", "cancelling"].includes(job.status));
  const queued = activeAssetJobs.length;
  const issues = project.assets?.review?.issues || [];
  const selectedWorkflow = selected ? (store.assetWorkflows.find((workflow: any) => workflow.id === selected.workflowId) || selected.workflow) : null;
  const selectedApproved = selected ? assetApproved(project, selected) : false;
  const directionDirty = Boolean(selected && (prompt !== (selected.prompt || "") || sampleText !== (selected.sampleText || "")));
  const selectedInProjectBin = Boolean(selectedApproved && project.frames?.some((frame: any) =>
    frame.assetId === selected?.id &&
    Number(frame.assetVersion) === Number(selected?.activeVersion) &&
    frame.assetApprovalFingerprint === selected?.approval?.versionFingerprint
  ));
  const approved = Boolean(
    project.screenplay?.approval?.status === "approved" &&
    project.screenplay?.approval?.screenplayRevision === project.screenplay?.revision
  );
  const manifestCurrent = approved;
  const gpuHandoffWorkflow = store.assetWorkflows.find((workflow: any) =>
    workflow.ready && workflow.availableNow === false && /GPU handoff required/i.test(String(workflow.runtimeWarning || ""))
  );
  const gpuHandoffRequired = Boolean(manifestCurrent && gpuHandoffWorkflow);
  const selectedGpuHandoff = Boolean(
    selectedWorkflow?.ready &&
    selectedWorkflow?.availableNow === false &&
    /GPU handoff required/i.test(String(selectedWorkflow?.runtimeWarning || ""))
  );
  const checkedGpuBlocked = checked.some((assetId) => {
    const asset = assets.find((item: any) => item.id === assetId);
    const workflow = store.assetWorkflows.find((item: any) => item.id === asset?.workflowId) || asset?.workflow;
    return Boolean(workflow?.ready && workflow?.availableNow === false && /GPU handoff required/i.test(String(workflow?.runtimeWarning || workflow?.reason || "")));
  });
  const selectedJob = selected ? activeAssetJobs.find((job: any) => job.refs?.assetId === selected.id) : null;
  const selectedAcceptsAudioUpload = acceptsAudioUpload(selected);
  const enhance = store.promptEnhance;
  const enhanceActive = Boolean(store.promptEnhanceBusy || enhance?.active || ["queued", "running", "cancelling"].includes(String(enhance?.status || "")));
  const enhanceProgress = enhance?.total
    ? `${Number(enhance.completed || 0)}/${Number(enhance.total)}`
    : null;

  const stopGeneration = async (assetId?: string) => {
    const scope = assetId ? "this asset" : `all ${activeAssetJobs.length} active asset jobs`;
    if (!window.confirm(`Stop ${scope}? The active ComfyUI prompt will be interrupted and queued assets will be removed.`)) return;
    setStopping(true);
    try {
      await store.stopAssetGeneration(assetId);
    } finally {
      setStopping(false);
    }
  };

  const releaseLmStudioGpu = async () => {
    await store.handoffLmStudioGpu();
    setConfirmGpuHandoff(false);
  };

  const toggleChecked = (id: string) => {
    const removing = checked.includes(id);
    setAssetSelectionAnchorId(id);
    setChecked((current) => removing ? current.filter((item) => item !== id) : [...current, id]);
    if (removing && activeAssetJobs.some((job: any) => job.refs?.assetId === id && job.status === "queued")) {
      void store.stopAssetGeneration(id);
    }
  };

  const selectAssetCard = (event: React.MouseEvent<HTMLElement>, id: string) => {
    setSelectedId(id);
    if (event.shiftKey) {
      const anchorIndex = visibleIds.indexOf(assetSelectionAnchorId || id);
      const targetIndex = visibleIds.indexOf(id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const range = visibleIds.slice(start, end + 1);
        setChecked((current) => event.ctrlKey || event.metaKey ? [...new Set([...current, ...range])] : range);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleChecked(id);
      return;
    }
    setAssetSelectionAnchorId(id);
    setChecked([id]);
  };

  const toggleSelectAllVisible = () => {
    setChecked((current) => {
      const visibleSet = new Set(visibleIds);
      if (allVisibleChecked) {
        const queuedVisible = activeAssetJobs
          .filter((job: any) => job.status === "queued" && visibleSet.has(job.refs?.assetId))
          .map((job: any) => job.refs.assetId);
        for (const assetId of new Set(queuedVisible)) void store.stopAssetGeneration(assetId);
        return current.filter((id) => !visibleSet.has(id));
      }
      return [...new Set([...current, ...visibleIds])];
    });
  };

  const chooseCategory = (key: string) => {
    setCategory(key);
    const first = key === "all" ? assets[0] : assets.find((asset: any) => asset.category === key);
    if (first) setSelectedId(first.id);
  };

  const saveSelected = async () => {
    if (!selected) return;
    await store.patchAsset(selected.id, { prompt, sampleText });
  };

  const submitAssetEditor = async (body: any) => {
    if (!assetEditor) return;
    setAssetEditorBusy(true);
    try {
      if (assetEditor.mode === "create") {
        const created = await store.createAsset(body);
        setCategory("all");
        setSelectedId(created?.id || null);
      } else if (assetEditor.asset) {
        await store.patchAsset(assetEditor.asset.id, body);
      }
      setAssetEditor(null);
    } finally {
      setAssetEditorBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const message = `Retire “${selected.name}” from the Asset Library?\n\nIts metadata, workflow snapshots, and generated files will be retained in recoverable project history.`;
    if (!window.confirm(message)) return;
    await store.deleteAsset(selected.id);
    setChecked((current) => current.filter((id) => id !== selected.id));
    setSelectedId(null);
  };

  const uploadAssetImage = async (file: File, assetId = selected?.id) => {
    if (!assetId) return;
    setAssetEditorBusy(true);
    try {
      await store.uploadAssetImage(assetId, file);
      setAssetEditor(null);
    } finally {
      setAssetEditorBusy(false);
      if (assetImageInput.current) assetImageInput.current.value = "";
    }
  };

  const uploadAssetAudio = async (file: File, assetId = selected?.id) => {
    if (!assetId) return;
    setAssetEditorBusy(true);
    try {
      await store.uploadAssetAudio(assetId, file);
      setAssetEditor(null);
    } finally {
      setAssetEditorBusy(false);
      if (assetAudioInput.current) assetAudioInput.current.value = "";
    }
  };

  const runPromptEnhance = async () => {
    if (!manifestCurrent || enhanceActive) return;
    const scope = checked.length
      ? `${checked.length} selected asset${checked.length === 1 ? "" : "s"}`
      : `all ${assets.length} assets`;
    if (!window.confirm(`Enhance prompts for ${scope} with parallel Grok agents?\n\nThis rewrites generation direction from the approved screenplay for Krea 2 Turbo (max detail). Live project prompts update as agents finish.`)) return;
    await store.enhanceAssetPrompts(checked.length ? checked : []);
  };

  if (!assets.length) {
    return (
      <main className="assets-empty-workspace">
        <section className="assets-empty-card premium-panel">
          <div className="assets-empty-orbit"><span>✦</span></div>
          <p className="eyebrow">SCREENPLAY → PRODUCTION</p>
          <h1>Build the Asset Library</h1>
          <p>Premiere316 will turn the saved screenplay into characters, identity sheets, wardrobe, locations, props, VFX references, guide frames, voices, synchronized sound cues, score cues, and a deterministic title card.</p>
          <div className="assets-empty-models">
            <span>Krea 2 BF16</span><span>Flux 2 Klein 9B</span><span>Qwen3-TTS 1.7B</span><span>LTX Native Audio</span>
          </div>
          {!approved && project.screenplay?.markdown ? (
            <button className="primary-action wide asset-approve-action" disabled={store.screenplayBusy} onClick={() => store.approveScreenplay()}>
              {store.screenplayBusy ? "Approving…" : "Approve Screenplay for Asset Generation"}
            </button>
          ) : (
            <button className="primary-action wide" disabled={!project.screenplay?.markdown || store.assetBusy} onClick={() => store.buildAssets({})}>
              {store.assetBusy ? "Reviewing & routing assets…" : "Review Screenplay & Build Assets"}
            </button>
          )}
          {!project.screenplay?.markdown ? <small>Generate or import a screenplay first.</small> : null}
          {!approved && project.screenplay?.markdown ? <small>Review the screenplay first. Approval is tied to this exact revision and is revoked by later edits.</small> : null}
          <button className="secondary-action wide" onClick={() => setAssetEditor({ mode: "create" })}>+ Create Asset Manually</button>
        </section>
        {assetEditor ? <AssetEditorDialog mode={assetEditor.mode} asset={assetEditor.asset} workflows={store.assetWorkflows} busy={assetEditorBusy} onCancel={() => setAssetEditor(null)} onSubmit={submitAssetEditor} onUploadImage={assetEditor.asset ? (file) => uploadAssetImage(file, assetEditor.asset.id) : undefined} onUploadAudio={assetEditor.asset ? (file) => uploadAssetAudio(file, assetEditor.asset.id) : undefined} /> : null}
      </main>
    );
  }

  return (
    <main className="assets-workspace">
      <aside className="asset-library-sidebar">
        <div className="asset-sidebar-heading">
          <span className="asset-foundry-mark">✦</span>
          <div><h2>Asset Library</h2><small>{assets.length} production assets</small></div>
        </div>
        <button className={`asset-category ${category === "all" ? "active" : ""}`} onClick={() => chooseCategory("all")}>
          <span>▦</span><b>All Assets</b><em>{assets.length}</em>
        </button>
        <div className="asset-category-list">
          {categories.map((item) => (
            <button key={item.key} className={`asset-category ${category === item.key ? "active" : ""}`} onClick={() => chooseCategory(item.key)}>
              <span>{CATEGORY_ICONS[item.key] || "◇"}</span><b>{item.label}</b><em>{item.count}</em>
            </button>
          ))}
        </div>
        <div className="asset-sidebar-progress">
          <div><span>Production coverage</span><b>{generated}/{assets.length}</b></div>
          <progress max={assets.length || 1} value={generated} />
          <small>{queued ? `${queued} GPU job${queued === 1 ? "" : "s"} serialized in queue` : "GPU queue idle"}</small>
        </div>
        <div className="asset-workflow-health">
          <h3>Local Model Routing <button onClick={() => store.refreshAssetWorkflows()}>Recheck GPU</button></h3>
          {store.assetWorkflows.map((workflow: any) => (
            <div key={workflow.id} title={workflow.runtimeWarning || workflow.reason}>
              <i className={!workflow.ready ? "blocked" : workflow.availableNow === false ? "waiting" : "ready"} />
              <span>{workflow.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <section className="asset-library-main">
        {!approved ? <div className="asset-approval-lock" role="alert"><span>!</span><div><b>Asset generation paused</b><small>The screenplay changed after its last approval. Return to Screenplay and approve this revision before queueing assets.</small></div></div> : !manifestCurrent ? <div className="asset-approval-lock" role="alert"><span>!</span><div><b>Asset manifest needs a refresh</b><small>This library belongs to an older screenplay revision. Refresh it before queueing any generation.</small></div></div> : (
          <div className="asset-gate-status unlocked" role="status"><span>✓</span><div><b>SCREENPLAY APPROVED · {assets.length} ASSETS UNLOCKED</b><small>This exact screenplay revision and its current production manifest passed the approval gate.</small></div></div>
        )}
        {gpuHandoffRequired ? (
          <div className="asset-gate-status gpu-handoff" role="status" aria-live="polite">
            <span>GPU</span>
            <div>
              <b>{store.lmStudioGpu?.status === "generating" ? "QWEN IS ACTIVELY GENERATING · GPU HANDOFF NEEDED" : "LM STUDIO IS HOLDING THE GPU · HANDOFF NEEDED"}</b>
              <small>Only {gpuHandoffWorkflow?.gpu?.freeGb ?? "a small amount of"} GB is free; Krea needs {gpuHandoffWorkflow?.minimumFreeVramGb ?? 18} GB. This is separate from screenplay approval.</small>
            </div>
            {confirmGpuHandoff ? (
              <div className="asset-handoff-confirm" role="group" aria-label="Confirm LM Studio GPU handoff">
                <strong>{store.lmStudioGpu?.status === "generating" ? "Qwen is generating now. This will cancel that live answer." : "This unloads Qwen until screenplay chat needs it again."}</strong>
                <button className="secondary-action" disabled={store.gpuHandoffBusy} onClick={() => setConfirmGpuHandoff(false)}>Keep Qwen Running</button>
                <button className="danger-action" disabled={store.gpuHandoffBusy} onClick={releaseLmStudioGpu}>{store.gpuHandoffBusy ? "Releasing GPU…" : "Yes — Stop Qwen & Unlock"}</button>
              </div>
            ) : (
              <button className="handoff-action" onClick={() => setConfirmGpuHandoff(true)}>{store.lmStudioGpu?.status === "generating" ? "Stop Qwen & Unlock Generation…" : "Unload Qwen & Unlock Generation…"}</button>
            )}
          </div>
        ) : null}
        <header className="asset-library-toolbar">
          <div>
            <p className="eyebrow">PROJECT ASSETS</p>
            <h1>{category === "all" ? "Complete Production Library" : categories.find((item) => item.key === category)?.label}</h1>
            <small>{visible.length} shown · {readyWorkflows.length}/{store.assetWorkflows.length || project.assets.catalog?.length || 0} installed · {availableWorkflows.length} available now{waitingWorkflows.length ? ` · ${waitingWorkflows.length} waiting for GPU` : ""} · Ctrl/Cmd-click toggles · Shift-click selects a range</small>
          </div>
          <div className="asset-toolbar-actions">
            <button data-testid="new-asset-button" className="primary-action" onClick={() => setAssetEditor({ mode: "create" })}>+ New Asset</button>
            <button
              className="secondary-action"
              disabled={!visible.length}
              onClick={toggleSelectAllVisible}
              title={category === "all" ? "Select every production asset" : `Select every visible ${category} asset`}
            >
              {allVisibleChecked ? `Clear Selection (${visible.length})` : `Select All (${visible.length})`}
            </button>
            <button className="secondary-action" onClick={() => store.buildAssets({})} disabled={store.assetBusy || !approved}>{store.assetBusy ? "Refreshing…" : "Refresh from Screenplay"}</button>
            <button
              className="prompt-enhance-action"
              disabled={!manifestCurrent || enhanceActive || !assets.length}
              title={checked.length ? `Enhance prompts for ${checked.length} selected assets with parallel Grok agents` : "Enhance every asset prompt with parallel Grok agents (Krea 2 Turbo detail)"}
              onClick={runPromptEnhance}
            >
              {enhanceActive
                ? `✦ Enhancing… ${enhanceProgress || ""}`.trim()
                : checked.length
                  ? `✦ Enhance Prompts (${checked.length})`
                  : "✦ Enhance Prompts"}
            </button>
            {enhanceActive ? (
              <button className="stop-generation-action" onClick={() => store.stopPromptEnhance()}>■ Stop Enhance</button>
            ) : null}
            <button className="stop-generation-action" disabled={!queued || stopping} onClick={() => stopGeneration()}>{stopping ? "Stopping…" : queued ? `■ Stop All Generation (${queued})` : "■ Stop Generation · Queue Idle"}</button>
            <button className="primary-action" disabled={queueing || !checked.length || !manifestCurrent || checkedGpuBlocked} onClick={async () => { if (queueing) return; setQueueing(true); try { await store.generateAssets([...new Set(checked)]); } finally { setQueueing(false); } }}>{queueing ? "Queueing Once…" : !approved ? "Approval Required" : !manifestCurrent ? "Refresh Required" : checkedGpuBlocked ? "GPU Handoff Required" : checked.length ? `Queue Selected (${new Set(checked).size})` : "Select Assets"}</button>
          </div>
        </header>

        {activeAssetJobs.length ? (
          <details className="asset-review-banner asset-live-queue" open>
            <summary>
              <span>◫</span>
              <b>Generation Queue · {activeAssetJobs.length} unique asset{activeAssetJobs.length === 1 ? "" : "s"}</b>
              <small>{activeAssetJobs.filter((job: any) => job.status === "running").length} running · {activeAssetJobs.filter((job: any) => job.status === "queued").length} waiting</small>
            </summary>
            <div>
              {activeAssetJobs.map((job: any, index: number) => {
                const queuedAsset = assets.find((asset: any) => asset.id === job.refs?.assetId);
                return (
                  <p key={job.id}>
                    <strong>{index + 1}. {queuedAsset?.name || job.label}</strong>
                    {queuedAsset?.variant ? ` · ${queuedAsset.variant}` : ""}
                    <small> {String(job.status).toUpperCase()}</small>
                    {job.status === "queued" ? <button className="secondary-action" onClick={() => void store.cancelJob(job.id)}>Remove</button> : null}
                  </p>
                );
              })}
            </div>
          </details>
        ) : null}

        {enhance && (enhanceActive || enhance.status === "done" || enhance.status === "error" || enhance.status === "cancelled") ? (
          <div className={`asset-enhance-banner ${enhance.status === "error" ? "error" : enhanceActive ? "running" : "done"}`} role="status" aria-live="polite">
            <span>✦</span>
            <div>
              <b>{enhanceActive ? "GROK AGENTS ENHANCING PROMPTS" : enhance.status === "error" ? "PROMPT ENHANCE FINISHED WITH ERRORS" : enhance.status === "cancelled" ? "PROMPT ENHANCE CANCELLED" : "PROMPT ENHANCE COMPLETE"}</b>
              <small>
                {enhance.message || enhance.stage || "Running parallel Grok agents…"}
                {enhanceProgress ? ` · ${enhanceProgress}` : ""}
                {enhance.failed ? ` · ${enhance.failed} failed` : ""}
                {enhance.concurrency ? ` · concurrency ${enhance.concurrency}` : ""}
              </small>
            </div>
            {enhanceActive ? <progress max={Math.max(1, Number(enhance.total) || 1)} value={Number(enhance.completed) || 0} /> : null}
          </div>
        ) : null}

        {issues.length ? (
          <details className="asset-review-banner">
            <summary><span>i</span><b>Optional production notes · {issues.length} decisions to revisit</b><small>Does not block generation · Review notes</small></summary>
            <div>{issues.slice(0, 8).map((issue: any, index: number) => <p key={issue.id || issue.issue_id || index}>{issue.priority ? <strong>{String(issue.priority).toUpperCase()} · </strong> : null}{issue.summary || issue.issue || issue.description || issue.finding || JSON.stringify(issue)}{issue.required_decision ? <small> Decision: {issue.required_decision}</small> : null}</p>)}</div>
          </details>
        ) : null}

        <div className="asset-grid">
          {visible.map((asset: any, assetIndex: number) => {
            const isSelected = selected?.id === asset.id;
            const isChecked = checked.includes(asset.id);
            const liveWorkflow = store.assetWorkflows.find((workflow: any) => workflow.id === asset.workflowId) || asset.workflow;
            const workflowReady = liveWorkflow?.ready !== false;
            const workflowAvailable = liveWorkflow?.availableNow !== false;
            return (
              <article key={asset.id} role="option" tabIndex={0} className={`asset-card ${isSelected ? "selected" : ""} ${isChecked ? "checked" : ""}`} aria-label={`${asset.name} — ${asset.variant}`} aria-selected={isChecked} onClick={(event) => selectAssetCard(event, asset.id)} onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setSelectedId(asset.id);
                toggleChecked(asset.id);
              }}>
                <div className="asset-card-preview">
                  <AssetPreview project={project} asset={asset} />
                  <span className="asset-check" aria-hidden="true"><span>{isChecked ? "✓" : ""}</span></span>
                  <StatusPill status={asset.status} />
                  {assetApproved(project, asset) ? <span className="asset-approved-badge">✓ APPROVED v{asset.activeVersion}</span> : null}
                  <div className="asset-card-label">
                    <div><span>#{assetIndex + 1}</span><small>{asset.categoryLabel} · {asset.variant}</small></div>
                    <h3>{asset.name}</h3>
                    <code title={asset.id}>{asset.id}</code>
                    <p title={liveWorkflow?.runtimeWarning || liveWorkflow?.reason}><i className={workflowReady && workflowAvailable ? "ready" : workflowReady ? "waiting" : "blocked"} />{liveWorkflow?.label || asset.workflowId}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="asset-inspector">
        {selected ? (
          <>
            <header><div><p className="eyebrow">ASSET INSPECTOR</p><h2>{selected.name}</h2><small>{selected.variant}</small></div><div className="asset-inspector-heading-actions"><StatusPill status={selected.status} /><button data-testid="edit-asset-button" className="secondary-action" onClick={() => setAssetEditor({ mode: "edit", asset: selected })}>Edit</button></div></header>
            <AssetPreview project={project} asset={selected} large />
            <div className="asset-inspector-scroll">
              <section className="asset-provenance">
                <div className="asset-id-row"><span>Asset ID</span><code>{selected.id}</code></div>
                <div><span>Workflow</span><b>{selected.workflow?.label || selected.workflowId}</b></div>
                <div><span>Model</span><b>{selected.workflow?.model || "Project-native"}</b></div>
                <div><span>Snapshot</span><b>{selected.workflowSnapshot || "Built in"}</b></div>
                <div><span>Readiness</span><b className={selectedWorkflow?.ready === false ? "blocked" : selectedWorkflow?.availableNow === false ? "waiting" : "ready"}>{selectedWorkflow?.runtimeWarning || selectedWorkflow?.reason || "Ready"}</b></div>
                <div><span>Asset version approval</span><b className={selectedApproved ? "ready" : "blocked"}>{selectedApproved ? `Approved v${selected.activeVersion}` : selected.versions?.length ? "Review required" : "Generate first"}</b></div>
              </section>
              {selected.sampleText != null ? (
                <label className="asset-field"><span>Audition Line</span><textarea rows={3} value={sampleText} onChange={(event) => setSampleText(event.target.value)} /></label>
              ) : null}
              <label className="asset-field">
                <span>
                  Generation Prompt / Direction
                  {selected.promptEnhancement ? <em className="asset-prompt-badge">Grok enhanced</em> : null}
                  {selected.category === "voice" ? <em className={prompt.length > 4000 ? "asset-limit-error" : "asset-character-count"}>{prompt.length}/4000 · Qwen VoiceDesign</em> : null}
                </span>
                <textarea rows={10} maxLength={selected.category === "voice" ? 4000 : undefined} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
              {!enhanceActive ? (
                <button
                  className="secondary-action asset-enhance-one"
                  disabled={!manifestCurrent}
                  onClick={async () => {
                    if (!selected) return;
                    if (!window.confirm(`Enhance only “${selected.name}” with a Grok agent?`)) return;
                    await store.enhanceAssetPrompts([selected.id]);
                  }}
                >
                  ✦ Enhance This Prompt
                </button>
              ) : null}
              {selected.continuity?.length ? <section className="asset-continuity"><h3>Continuity Locks</h3>{(Array.isArray(selected.continuity) ? selected.continuity : [selected.continuity]).map((line: string, index: number) => <p key={index}>✓ {line}</p>)}</section> : null}
              {selected.dependencies?.length ? <section className="asset-continuity"><h3>Dependencies</h3><p>{selected.dependencies.join(" · ")}</p></section> : null}
              <section className="asset-version-list">
                <h3>Versions <span>{selected.versions?.length || 0}</span></h3>
                {(selected.versions || []).slice().reverse().map((version: any) => <div key={version.v}><b>v{version.v}</b><span>{version.file || version.files?.join(", ")}</span><small>{new Date(version.createdAt).toLocaleString()}</small></div>)}
                {!selected.versions?.length ? <p>No generated versions yet.</p> : null}
              </section>
            </div>
            <footer>
              <button data-testid="delete-asset-button" className="danger-action" disabled={Boolean(selectedJob)} onClick={deleteSelected}>Delete</button>
              {selected.mediaType === "image" ? <button data-testid="upload-asset-image-button" className="secondary-action asset-upload-action" disabled={Boolean(selectedJob) || assetEditorBusy} onClick={() => assetImageInput.current?.click()}>{assetEditorBusy ? "Uploading…" : "↑ Upload Image"}</button> : null}
              {selectedAcceptsAudioUpload ? <button data-testid="upload-asset-audio-button" className="secondary-action asset-upload-action" disabled={Boolean(selectedJob) || assetEditorBusy} onClick={() => assetAudioInput.current?.click()}>{assetEditorBusy ? "Uploading…" : "Upload Audio"}</button> : null}
              {selectedJob ? <button className="stop-generation-action" disabled={stopping} onClick={() => stopGeneration(selected.id)}>{stopping ? "Stopping…" : selectedJob.status === "queued" ? "■ Remove from Queue" : "■ Stop This Asset"}</button> : null}
              <button className="secondary-action" disabled={!directionDirty} onClick={saveSelected}>{directionDirty ? "Save Direction" : "Direction Saved"}</button>
              {selected.versions?.length ? <button className={selectedApproved ? "secondary-action" : "primary-action"} disabled={selectedApproved || selected.activeVersionCurrent === false || !manifestCurrent || directionDirty} title={selected.activeVersionCurrent === false ? "This is a historical version from older direction. Generate a fresh version before approval." : directionDirty ? "Save the direction, then generate and review a fresh version before approval." : undefined} onClick={() => store.approveAsset(selected.id)}>{selected.activeVersionCurrent === false ? "Generate fresh version to approve" : directionDirty ? "Save direction first" : selectedApproved ? `✓ Approved v${selected.activeVersion}` : `Approve v${selected.activeVersion}`}</button> : null}
              {selected.mediaType === "image" && activeFile(selected) ? <button className="secondary-action" disabled={!selectedApproved || selectedInProjectBin} onClick={() => store.promoteAsset(selected.id)}>{selectedInProjectBin ? "✓ In Project Bin" : "Add Approved to Project Bin"}</button> : null}
              <button className="primary-action" title={selectedGpuHandoff ? "The screenplay is approved. Use the GPU handoff banner above to unload Qwen before generating this asset." : undefined} disabled={!manifestCurrent || selectedWorkflow?.ready === false || selectedWorkflow?.availableNow === false || ["queued", "generating"].includes(selected.status)} onClick={async () => { await saveSelected(); await store.generateAsset(selected.id); }}>
                {!approved ? "Approval Required" : !manifestCurrent ? "Refresh Required" : selectedGpuHandoff ? "GPU Busy — Use Handoff Above" : selected.status === "queued" ? "Queued" : selected.status === "generating" ? "Generating…" : selected.versions?.length ? "Generate New Version" : "Generate Asset"}
              </button>
            </footer>
          </>
        ) : <div className="asset-inspector-empty">Select an asset to inspect it.</div>}
      </aside>

      <button className="asset-open-editor" onClick={onOpenEditor}>Open Timeline →</button>
      <input ref={assetImageInput} className="asset-hidden-file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAssetImage(file); }} />
      <input ref={assetAudioInput} className="asset-hidden-file" type="file" accept={AUDIO_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAssetAudio(file); }} />
      {assetEditor ? <AssetEditorDialog mode={assetEditor.mode} asset={assetEditor.asset} workflows={store.assetWorkflows} busy={assetEditorBusy} onCancel={() => setAssetEditor(null)} onSubmit={submitAssetEditor} onUploadImage={assetEditor.asset ? (file) => uploadAssetImage(file, assetEditor.asset.id) : undefined} onUploadAudio={assetEditor.asset ? (file) => uploadAssetAudio(file, assetEditor.asset.id) : undefined} /> : null}
    </main>
  );
}
