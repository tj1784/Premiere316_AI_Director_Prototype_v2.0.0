import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, storyboardUrl, useStore } from "../store";
import AssetReferencePicker from "./AssetReferencePicker";
import { AudioOffChip, ClipDirectionEditor, SegmentDirectionEditor, openLtxDirector } from "./StoryboardDirection";

function formatTimecode(frames: number, fps: number) {
  const safeFrames = Math.max(0, Math.round(Number(frames) || 0));
  const hours = Math.floor(safeFrames / (fps * 3600));
  const minutes = Math.floor((safeFrames % (fps * 3600)) / (fps * 60));
  const seconds = Math.floor((safeFrames % (fps * 60)) / fps);
  const remainder = safeFrames % fps;
  return [hours, minutes, seconds, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CopyButton({ text, label = "Copy prompt" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="storyboard-copy-button" disabled={!text} onClick={async () => { await copyText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "✓ Copied" : label}</button>;
}

function PromptBlock({ label, title, prompt, rows = 9 }: { label: string; title: string; prompt: string; rows?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="storyboard-prompt-block">
      <header>
        <div><p className="eyebrow">{label}</p><h3>{title}</h3></div>
        <div className="requirement-slot-actions">
          <CopyButton text={prompt} />
          <button type="button" className="storyboard-copy-button" onClick={() => setExpanded((current) => !current)}>{expanded ? "Collapse" : "Expand"}</button>
        </div>
      </header>
      <textarea aria-label={`${title} prompt`} readOnly value={prompt || ""} rows={expanded ? Math.max(rows, 22) : rows} />
    </section>
  );
}

function GlobalPromptEditor({
  clipId,
  label,
  title,
  prompt,
  rows = 12
}: {
  clipId: string;
  label: string;
  title: string;
  prompt: string;
  rows?: number;
}) {
  const store = useStore();
  const [draft, setDraft] = useState(prompt || "");
  const [scope, setScope] = useState<"clip" | "scene" | "chapter" | "project">("clip");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDraft(prompt || "");
  }, [clipId, prompt]);

  const save = async () => {
    const labels = {
      clip: "this clip",
      scene: "this entire scene",
      chapter: "this entire chapter",
      project: "the entire project"
    };
    if ((scope === "chapter" || scope === "project") && !window.confirm("Save this global prompt to " + labels[scope] + "? Local segment prompts stay unchanged.")) {
      return;
    }
    setSaving(true);
    try {
      const result = await store.saveStoryboardGlobalPrompt(clipId, draft, scope);
      setNotice("Saved global to " + (result?.scope || scope) + ": " + (result?.clips || 0) + " clips, " + (result?.segments || 0) + " segments.");
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="storyboard-prompt-block storyboard-global-editor">
      <header><div><p className="eyebrow">{label}</p><h3>{title}</h3></div><CopyButton text={draft} /></header>
      <div className="storyboard-global-scope-row">
        <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} aria-label="Global prompt save scope">
          <option value="clip">This clip (all its segments)</option>
          <option value="scene">This scene (all clips in this S##)</option>
          <option value="chapter">This chapter (all of this H##)</option>
          <option value="project">Entire project</option>
        </select>
        <button type="button" className="storyboard-copy-button" disabled={saving || !clipId} onClick={() => void save()}>{saving ? "Saving…" : "Save global"}</button>
      </div>
      <textarea aria-label={title + " prompt"} value={draft} rows={rows} onChange={(event) => setDraft(event.target.value)} />
      {notice ? <small className="storyboard-global-notice">{notice}</small> : null}
    </section>
  );
}



function versionApproved(asset: any, version: number) {
  return Boolean(asset?.approvalCurrent === true && asset?.approval?.status === "approved" && Number(asset.approval.activeVersion) === Number(version));
}

function ReferenceImage({ projectSlug, binding }: { projectSlug: string; binding: any }) {
  const [failed, setFailed] = useState(false);
  if (!binding?.sourceAssetFile || failed) return <div className="storyboard-reference-placeholder">◇</div>;
  return <img src={assetUrl(projectSlug, binding.sourceAssetFile)} alt="" onError={() => setFailed(true)} />;
}

function ReferenceStrip({ project, references, appliedIds = [] }: { project: any; references: any[]; appliedIds?: string[] }) {
  const assets = project.assets?.items || [];
  return (
    <div className="storyboard-reference-strip">
      {references.map((binding) => {
        const asset = assets.find((item: any) => item.id === binding.assetId);
        const approved = versionApproved(asset, Number(binding.assetVersion));
        return (
          <article className={appliedIds.includes(binding.assetId) ? "storyboard-reference-new" : undefined} key={`${binding.assetId}-${binding.assetVersion}-${binding.order}`} title={`${binding.sourceAssetFile} · ${binding.role}`}>
            <div><ReferenceImage projectSlug={project.slug} binding={binding} /><span className={approved ? "approved" : "review"}>{approved ? "✓" : "!"}</span></div>
            <b>{asset?.name || binding.sourceAssetKey}</b>
            <small>{binding.role} · v{binding.assetVersion}{Number(asset?.activeVersion) !== Number(binding.assetVersion) ? " · historical" : ""}</small>
          </article>
        );
      })}
      {!references.length ? <div className="storyboard-no-references">No visual references assigned.</div> : null}
    </div>
  );
}

function FramePromptPanel({
  project,
  frame,
  label,
  busyLabel,
  notice,
  onAddReferences,
  onPush,
  onDownload,
  onGenerate,
  onReplaceImage,
  onGenerateAll,
  appliedIds = []
}: {
  project: any;
  frame: any;
  label: string;
  busyLabel?: string;
  notice?: string;
  onAddReferences: (frameId: string, label: string) => void;
  onPush: (frameId: string) => void;
  onDownload: (frameId: string) => void;
  onGenerate: (frameId: string) => void;
  onReplaceImage: (frameId: string, file: File) => void;
  onGenerateAll?: () => void;
  appliedIds?: string[];
}) {
  const replacementInput = useRef<HTMLInputElement>(null);
  const references = frame?.references || [];
  const approved = references.filter((binding: any) => {
    const asset = project.assets?.items?.find((item: any) => item.id === binding.assetId);
    return versionApproved(asset, Number(binding.assetVersion));
  }).length;
  const generatedFile = frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file || null;
  const generatedVersion = frame?.generatedAssetVersionId || (frame?.activeGeneratedVersion ? `${frame.id}:v${frame.activeGeneratedVersion}` : null);
  const active = Boolean(busyLabel);
  return (
    <section className="storyboard-frame-panel">
      <header>
        <div><p className="eyebrow">IMAGE GUIDE</p><h2>{label}</h2><small>{frame.expectedInputPath}</small></div>
        <div className="storyboard-frame-actions">
          <span className={approved === references.length && references.length ? "ready" : "blocked"}>{approved}/{references.length} exact versions approved</span>
          <button
            type="button"
            className="secondary-action storyboard-comfy-action"
            data-testid="storyboard-push-to-comfyui"
            data-frame-id={frame.id}
            disabled={active}
            onClick={() => onPush(frame.id)}
          >
            {busyLabel === "Pushing…" ? busyLabel : "Push to ComfyUI"}
          </button>
          <button
            type="button"
            className="secondary-action storyboard-download-action"
            data-testid="storyboard-download-workflow"
            data-frame-id={frame.id}
            disabled={active}
            onClick={() => onDownload(frame.id)}
          >
            {busyLabel === "Downloading…" ? busyLabel : "Download Workflow"}
          </button>
          <button
            type="button"
            className="primary-action storyboard-generate-action"
            data-testid="storyboard-generate-frame"
            data-frame-id={frame.id}
            disabled={active}
            onClick={() => onGenerate(frame.id)}
          >
            {busyLabel === "Queueing…" ? busyLabel : "Generate"}
          </button>
          <button
            type="button"
            className="secondary-action storyboard-replace-image-action"
            data-testid="storyboard-replace-image"
            data-frame-id={frame.id}
            disabled={active}
            onClick={() => replacementInput.current?.click()}
          >
            {busyLabel === "Replacing…" ? busyLabel : generatedFile ? "Replace Image" : "Upload Image"}
          </button>
          <input
            ref={replacementInput}
            className="storyboard-hidden-file"
            data-testid="storyboard-replace-image-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onReplaceImage(frame.id, file);
            }}
          />
          <button type="button" className="primary-action" disabled={active} onClick={() => onAddReferences(frame.id, label)}>＋ Add References</button>
        </div>
      </header>
      <div className="storyboard-frame-status"><span className={["ready_to_generate", "generated"].includes(frame.status) ? "ready" : "waiting"} /><b>{String(frame.status || "not started").replaceAll("_", " ")}</b><small>{frame.purpose === "first_frame" ? "Clip opening composition" : "Additional segment continuity reset"}</small></div>
      {(notice || frame.lastError) ? <div className={`storyboard-frame-notice ${frame.lastError ? "error" : ""}`}>{frame.lastError || notice}{frame.lastError ? <button type="button" className="storyboard-copy-button" onClick={() => onGenerate(frame.id)}>Retry</button> : null}{frame.lastError && onGenerateAll ? <button type="button" className="storyboard-copy-button" onClick={() => onGenerateAll()}>Generate all missing for this clip</button> : null}</div> : null}
      {generatedFile ? (
        <section className="storyboard-generated-guide">
          <img src={storyboardUrl(project.slug, generatedFile)} alt={`${label} generated guide`} />
          <div>
            <p className="eyebrow">GENERATED IMAGE GUIDE</p>
            <b>{generatedFile}</b>
            <small>{generatedVersion || "Storyboard frame output"} · {frame.generationResolution?.width || "?"}×{frame.generationResolution?.height || "?"}</small>
          </div>
        </section>
      ) : null}
      <PromptBlock label="FIRST-FRAME IMAGE GENERATION" title="Positive prompt" prompt={frame.prompt} rows={11} />
      <details className="storyboard-negative-prompt"><summary>Negative / avoid prompt <span>{frame.negativePrompt?.length || 0} characters</span></summary><div><CopyButton text={frame.negativePrompt || ""} /><p>{frame.negativePrompt}</p></div></details>
      <section className="storyboard-reference-section">
        <header><div><p className="eyebrow">EXACT INPUTS</p><h3>{references.length} assigned visual references</h3></div><small>Identity, wardrobe, environment, props, crowd, and VFX are version-pinned.</small></header>
        <ReferenceStrip project={project} references={references} appliedIds={appliedIds} />
      </section>
    </section>
  );
}

function usesSemanticT2V(clip: any, videoPlan: any) {
  return clip?.generationMode === "t2v_with_semantic_references"
    || videoPlan?.generationMode === "t2v_with_semantic_references"
    || !clip?.firstFrameId;
}

function semanticReferenceFiles(clip: any, videoPlan: any, references: any[]) {
  return [...new Set([
    ...(videoPlan?.referenceFiles || []),
    ...(clip?.referenceFiles || []),
    ...(references || []).map((reference: any) => reference.canonicalFile || reference.sourceAssetFile)
  ].map((file) => String(file || "").trim()).filter(Boolean))];
}

function T2VPlanPanel({
  clip,
  videoPlan,
  references,
  busyLabel,
  notice,
  onPush,
  onDownload,
  onGenerate
}: {
  clip: any;
  videoPlan: any;
  references: any[];
  busyLabel?: string;
  notice?: string;
  onPush: (videoPlanId: string) => void;
  onDownload: (videoPlanId: string) => void;
  onGenerate: (videoPlanId: string) => void;
}) {
  const active = Boolean(busyLabel);
  const files = semanticReferenceFiles(clip, videoPlan, references);
  const referenceByFile = new Map(references.map((reference: any) => [
    String(reference.canonicalFile || reference.sourceAssetFile || ""),
    reference
  ]));
  const status = String(videoPlan?.status || clip?.renderStatus || "ready").replaceAll("_", " ");
  return (
    <section className="storyboard-frame-panel storyboard-t2v-plan-panel">
      <header>
        <div>
          <p className="eyebrow">TEXT-TO-VIDEO PLAN</p>
          <h2>LTX-2.5 T2V · semantic references</h2>
          <small>{videoPlan?.id || "Missing video plan"}</small>
        </div>
        <div className="storyboard-frame-actions">
          <span className={videoPlan?.status === "ready" ? "ready" : "blocked"}>{status}</span>
          <button
            type="button"
            className="secondary-action storyboard-comfy-action"
            data-testid="storyboard-push-t2v-to-comfyui"
            data-video-plan-id={videoPlan?.id}
            disabled={active || !videoPlan?.id}
            onClick={() => onPush(videoPlan.id)}
          >
            {busyLabel === "Pushing…" ? busyLabel : "Push T2V Workflow"}
          </button>
          <button
            type="button"
            className="secondary-action storyboard-download-action"
            data-testid="storyboard-download-t2v-workflow"
            data-video-plan-id={videoPlan?.id}
            disabled={active || !videoPlan?.id}
            onClick={() => onDownload(videoPlan.id)}
          >
            {busyLabel === "Downloading…" ? busyLabel : "Download T2V Workflow"}
          </button>
          <button
            type="button"
            className="primary-action storyboard-generate-action"
            data-testid="storyboard-generate-t2v-video"
            data-video-plan-id={videoPlan?.id}
            disabled={active || !videoPlan?.id}
            onClick={() => onGenerate(videoPlan.id)}
          >
            {busyLabel === "Queueing…" ? busyLabel : "Generate T2V Video"}
          </button>
        </div>
      </header>
      <div className="storyboard-frame-status">
        <span className={videoPlan?.status === "ready" ? "ready" : "waiting"} />
        <b>{status}</b>
        <small>Direct T2V · no opening, ending, handoff, or timed image guides</small>
      </div>
      {notice ? <div className="storyboard-frame-notice">{notice}</div> : null}
      <section className="storyboard-reference-section">
        <header>
          <div><p className="eyebrow">SEMANTIC INPUTS</p><h3>{files.length} exact visual reference{files.length === 1 ? "" : "s"}</h3></div>
          <CopyButton text={files.join("\n")} label="Copy reference paths" />
        </header>
        <div className="storyboard-frame-notice">References condition identity and design only. They are never inserted at frame zero or connected as temporal image guides.</div>
        <div className="storyboard-reference-strip">
          {files.map((file, index) => {
            const reference = referenceByFile.get(file) as any;
            return (
              <article key={file} title={reference?.cropRegion || file}>
                <div><div className="storyboard-reference-placeholder">{String(index + 1).padStart(2, "0")}</div><span className="approved">✓</span></div>
                <b>{file}</b>
                <small>{reference?.role || "semantic reference"}{reference?.cropRegion ? ` · ${reference.cropRegion}` : ""}</small>
              </article>
            );
          })}
          {!files.length ? <div className="storyboard-no-references">Pure T2V for this clip · no semantic image references assigned.</div> : null}
        </div>
      </section>
    </section>
  );
}

function fullClipPackage(storyboard: any, clip: any) {
  const frame = storyboard.frames?.[clip.firstFrameId];
  const video = storyboard.videoPlans?.[clip.videoPlanId];
  const isT2V = usesSemanticT2V(clip, video);
  const segments = (video?.segmentIds || []).map((id: string) => storyboard.segments?.[id]).filter(Boolean);
  const sections = [
    `CLIP ${clip.id}`,
    `BEAT\n${clip.beat}`
  ];
  if (!isT2V) {
    sections.push(`FIRST-FRAME PROMPT\n${frame?.prompt || ""}`);
    sections.push(`FIRST-FRAME NEGATIVE\n${frame?.negativePrompt || ""}`);
  }
  sections.push(`${isT2V ? "LTX-2.5 T2V MASTER PROMPT" : "LTX GLOBAL VIDEO PROMPT"}\n${video?.globalPrompt || ""}`);
  for (const segment of segments) {
    sections.push(`SEGMENT ${segment.order} LOCAL VIDEO PROMPT\n${segment.prompt}`);
    if (!isT2V && segment.frameId && segment.frameId !== clip.firstFrameId) {
      const segmentFrame = storyboard.frames?.[segment.frameId];
      sections.push(`SEGMENT ${segment.order} IMAGE PROMPT\n${segmentFrame?.prompt || ""}`);
      sections.push(`SEGMENT ${segment.order} IMAGE NEGATIVE\n${segmentFrame?.negativePrompt || ""}`);
    }
  }
  return sections.join("\n\n============================================================\n\n");
}

export default function StoryboardWorkspace({ onOpenAssets: _onOpenAssets }: { onOpenAssets?: () => void }) {
  const store = useStore();
  const project = store.project;
  const storyboard = store.storyboard;
  const [chapterFilter, setChapterFilter] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [pickerTarget, setPickerTarget] = useState<{ frameId: string; label: string } | null>(null);
  const [appliedReferenceIds, setAppliedReferenceIds] = useState<string[]>([]);
  const goDirectLtx = (clipId: string) => openLtxDirector(store, clipId);

  useEffect(() => { void store.loadStoryboard(); }, [project?.slug]);

  const clipRecords = useMemo(() => {
    if (!storyboard) return [];
    const records: any[] = [];
    let sequenceIndex = 0;
    for (const chapterId of storyboard.chapterOrder || []) {
      const chapter = storyboard.chapters?.[chapterId];
      for (const sceneId of chapter?.sceneIds || []) {
        const scene = storyboard.scenes?.[sceneId];
        for (const clipId of scene?.clipIds || []) {
          const clip = storyboard.clips?.[clipId];
          if (clip) {
            const videoPlan = storyboard.videoPlans?.[clip.videoPlanId];
            records.push({
              clip,
              chapter,
              scene,
              videoPlan,
              exactPrompt: String(videoPlan?.globalPrompt || ""),
              sequenceIndex: ++sequenceIndex
            });
          }
        }
      }
    }
    return records;
  }, [storyboard]);

  const filteredRecords = useMemo(() => clipRecords.filter((record) => {
    if (chapterFilter !== "all" && record.chapter.id !== chapterFilter) return false;
    if (!deferredQuery) return true;
    return `${record.clip.id} ${record.exactPrompt} ${record.clip.beat} ${record.clip.dialogueAnchor} ${record.scene.title} ${record.chapter.title}`.toLowerCase().includes(deferredQuery);
  }), [chapterFilter, clipRecords, deferredQuery]);
  const selectedRecord = clipRecords.find((record) => record.clip.id === store.selectedStoryboardClipId) || clipRecords[0] || null;

  if (store.storyboardBusy && !storyboard) return <main className="storyboard-loading"><span>▦</span><h1>Loading production storyboard…</h1><p>119 clips and their generation packages are being indexed.</p></main>;
  if (!storyboard || !selectedRecord) return <main className="storyboard-loading"><span>!</span><h1>Storyboard package unavailable</h1><p>{store.error || "Import a Premiere316 storyboard package for this project, then try again."}</p><div className="requirement-slot-actions"><button className="primary-action" onClick={() => void store.loadStoryboard()}>Retry</button><button className="secondary-action" onClick={() => void store.buildAssets()}>Build from Screenplay</button><label className="secondary-action">Import package<input className="storyboard-hidden-file" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void (async () => { try { const json = JSON.parse(await file.text()); const response = await fetch(`/api/projects/${encodeURIComponent(project?.slug || "")}/storyboard`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyboard: json.storyboard || json }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `Import package failed (${response.status}).`); await store.loadStoryboard(); } catch (error: any) { window.alert(String(error.message || error)); } })(); }} /></label></div>{store.error ? <details className="storyboard-negative-prompt" open><summary>Inspect error</summary><pre>{store.error}</pre></details> : null}</main>;

  const { clip, chapter, scene, sequenceIndex } = selectedRecord;
  const fps = Number(storyboard.defaults?.fps || project.settings?.fps || 24);
  const firstFrame = storyboard.frames?.[clip.firstFrameId];
  const videoPlan = storyboard.videoPlans?.[clip.videoPlanId];
  const isT2V = usesSemanticT2V(clip, videoPlan);
  const segments = (videoPlan?.segmentIds || []).map((id: string) => storyboard.segments?.[id]).filter(Boolean);
  const additionalFrames = isT2V ? 0 : segments.filter((segment: any) => segment.frameId && segment.frameId !== clip.firstFrameId).length;
  const videoPlanReferences = Object.values(storyboard.referenceBindings || {})
    .filter((binding: any) => binding?.targetKind === "video_plan" && binding?.targetId === videoPlan?.id)
    .sort((left: any, right: any) => Number(left.order || 0) - Number(right.order || 0));
  const t2vPlanCount = Object.values(storyboard.clips || {}).filter((storyboardClip: any) => {
    const plan = storyboard.videoPlans?.[storyboardClip.videoPlanId];
    return usesSemanticT2V(storyboardClip, plan);
  }).length;
  const targetFrame = pickerTarget ? storyboard.frames?.[pickerTarget.frameId] : null;

  return (
    <main className="storyboard-workspace">
      <aside className="storyboard-sidebar">
        <header><div className="storyboard-mark">▦</div><div><p className="eyebrow">PRODUCTION BOARD</p><h2>Storyboard</h2><small>Chapter → scene → 10–20 second clips</small></div></header>
        <section className="storyboard-summary">
          <div><b>{store.storyboardSummary?.clips || clipRecords.length}</b><span>clips</span></div>
          <div><b>{t2vPlanCount || store.storyboardSummary?.frames || Object.keys(storyboard.frames || {}).length}</b><span>{t2vPlanCount ? "T2V plans" : "image prompts"}</span></div>
          <div><b>{formatTimecode(storyboard.runtimeFrames, fps).slice(0, 8)}</b><span>runtime</span></div>
        </section>
        <label className="storyboard-search">Search clips<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Beat, dialogue, ID…" /></label>
        <nav className="storyboard-chapter-list" aria-label="Storyboard chapters">
          <button className={chapterFilter === "all" ? "active" : ""} aria-pressed={chapterFilter === "all"} onClick={() => setChapterFilter("all")}><span>ALL</span><b>Complete Film</b><em>{clipRecords.length}</em></button>
          {(storyboard.chapterOrder || []).map((chapterId: string) => {
            const item = storyboard.chapters[chapterId];
            const count = (item.sceneIds || []).reduce((total: number, sceneId: string) => total + (storyboard.scenes[sceneId]?.clipIds?.length || 0), 0);
            return <button key={chapterId} className={chapterFilter === chapterId ? "active" : ""} aria-pressed={chapterFilter === chapterId} onClick={() => setChapterFilter(chapterId)}><span>{String(item.number).padStart(2, "0")}</span><b>{item.title}</b><em>{count}</em></button>;
          })}
        </nav>
      </aside>

      <section className="storyboard-clip-index">
        <header><div><p className="eyebrow">ZIP T2V PROMPTS</p><h2>{chapterFilter === "all" ? "All chapters" : storyboard.chapters[chapterFilter]?.title}</h2></div><span>{filteredRecords.length} prompts</span></header>
        <div className="storyboard-clip-list">
          {filteredRecords.map((record) => <button key={record.clip.id} className={record.clip.id === clip.id ? "active" : ""} onClick={() => store.setSelectedStoryboardClip(record.clip.id)}><span className="storyboard-clip-number">{String(record.sequenceIndex).padStart(3, "0")}</span><span><small>ZIP PROMPT · {record.clip.id}</small><b>{record.clip.id}.txt</b><p>{record.exactPrompt}</p></span><em>{Math.round(record.clip.durationFrames / fps)}s</em></button>)}
          {!filteredRecords.length ? <div className="storyboard-index-empty">No clips match the current filter.</div> : null}
        </div>
      </section>

      <section className="storyboard-detail">
        <header className="storyboard-detail-header">
          <div><p className="eyebrow">ZIP T2V PROMPT · {clip.id}</p><h1>{clip.id}.txt</h1></div>
          <div className="storyboard-detail-actions">
            <CopyButton text={fullClipPackage(storyboard, clip)} label="Copy full clip package" />
            {!isT2V ? (
              <button
                type="button"
                className="secondary-action"
                data-testid="storyboard-push-all-workflows"
                disabled={store.storyboardBulkWorkflowBusy}
                onClick={() => void store.pushAllStoryboardFrameWorkflowsToComfyUI()}
              >
                {store.storyboardBulkWorkflowBusy ? `Pushing all ${Object.keys(storyboard.frames || {}).length}…` : `Push all ${Object.keys(storyboard.frames || {}).length} workflows`}
              </button>
            ) : null}
            
            <button type="button" className="secondary-action" onClick={() => goDirectLtx(clip.id)}>Open in LTX Director</button>
            {!isT2V ? <button type="button" className="secondary-action" onClick={() => {
              const frameFile = (frame: any) => frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file;
              const missing = [firstFrame].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");
              for (const frame of missing) void store.generateStoryboardFrame(frame.id);
            }}>Generate all missing for this clip</button> : null}
            {store.storyboardBulkWorkflowNotice ? <small className="storyboard-bulk-workflow-notice">{store.storyboardBulkWorkflowNotice}</small> : null}
          </div>
        </header>

        <div className="storyboard-detail-scroll">
          {isT2V ? (
            <section className="storyboard-readiness-banner"><span>✓</span><div><b>T2V PLAN · SEMANTIC REFERENCES ONLY</b><small>This clip generates directly from text. Reference images control identity and design without becoming opening, ending, handoff, or timed video frames.</small></div></section>
          ) : (
            <section className="storyboard-readiness-banner"><span>!</span><div><b>PROMPTS COMPLETE · IMAGE APPROVAL REQUIRED BEFORE VIDEO</b><small>The plan is render-aligned, but exact reference versions and generated image guides must pass Asset Library review before queueing.</small></div></section>
          )}
          <ClipDirectionEditor clip={clip} fps={fps} />

          {isT2V ? (
            <T2VPlanPanel
              clip={clip}
              videoPlan={videoPlan}
              references={videoPlanReferences}
              busyLabel={videoPlan?.id ? store.storyboardVideoPlanActions[videoPlan.id] : undefined}
              notice={videoPlan?.id ? store.storyboardVideoPlanNotices[videoPlan.id] : undefined}
              onPush={(videoPlanId) => void store.pushStoryboardVideoPlanToComfyUI(videoPlanId)}
              onDownload={(videoPlanId) => void store.downloadStoryboardVideoPlanWorkflow(videoPlanId)}
              onGenerate={(videoPlanId) => void store.generateStoryboardVideoPlan(videoPlanId)}
            />
          ) : firstFrame ? (
            <FramePromptPanel
              project={project}
              frame={firstFrame}
              appliedIds={appliedReferenceIds}
              onGenerateAll={() => {
                const frameFile = (frame: any) => frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file;
                const missing = [firstFrame].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");
                for (const frame of missing) void store.generateStoryboardFrame(frame.id);
              }}
              label="First frame"
              busyLabel={store.storyboardFrameActions[firstFrame.id]}
              notice={store.storyboardFrameNotices[firstFrame.id]}
              onPush={(frameId) => void store.pushStoryboardFrameToComfyUI(frameId)}
              onDownload={(frameId) => void store.downloadStoryboardFrameWorkflow(frameId)}
              onGenerate={(frameId) => void store.generateStoryboardFrame(frameId)}
              onReplaceImage={(frameId, file) => void store.replaceStoryboardFrameImage(frameId, file)}
              onAddReferences={(frameId, label) => setPickerTarget({ frameId, label: `${clip.id} · ${label}` })}
            />
          ) : null}

          <section className="storyboard-video-panel">
            <header><div><p className="eyebrow">VIDEO GENERATION</p><h2>{isT2V ? "LTX-2.5 native T2V" : "LTX Director"} · {Math.round(clip.durationFrames / fps)}-second {isT2V ? "direct generation" : "silent picture pass"}</h2></div><div className="storyboard-workflow-chips"><span>24 FPS</span><span>8-frame grid</span><span>{segments.length} segments</span><span>Trim +{clip.trimDecodedFrames} decoded frame</span><span>{isT2V ? String(videoPlan?.audioMode || clip.audioPlan?.mode || "authored audio").replaceAll("_", " ") : <AudioOffChip segment={segments[0]} clipLabel={clip.id} clipId={clip.id} />}</span></div></header>
            <GlobalPromptEditor clipId={clip.id} label={isT2V ? "LTX-2.5 T2V MASTER" : "LTX GLOBAL VIDEO"} title={isT2V ? "Text-to-video generation prompt" : "Global video-generation prompt"} prompt={videoPlan?.globalPrompt || ""} rows={12} />
            <div className="storyboard-segment-heading"><div><p className="eyebrow">PROMPT RELAY</p><h3>{segments.length} contiguous segments{isT2V ? " · text-only timeline" : ` · ${additionalFrames} additional image reset${additionalFrames === 1 ? "" : "s"}`}</h3></div><small>{videoPlan?.segmentLengths || segments.map((segment: any) => segment.lengthFrames).join(",")} frames</small></div>
            <div className="storyboard-segment-list">
              {segments.map((segment: any) => {
                const segmentFrame = segment.frameId ? storyboard.frames?.[segment.frameId] : null;
                const start = segment.startFrame / fps;
                const end = (segment.startFrame + segment.lengthFrames) / fps;
                return (
                  <article key={segment.id} className={`storyboard-segment-card ${segment.type}`}>
                    <header><span>{String(segment.order).padStart(2, "0")}</span><div><b>{start.toFixed(1)}–{end.toFixed(1)} seconds</b><small>{segment.lengthFrames} frames · {isT2V ? "text-only continuation" : segment.type === "image" ? "image-guided" : "text continuation"}</small></div><CopyButton text={segment.prompt} label="Copy local prompt" /><button type="button" className="storyboard-copy-button" onClick={() => goDirectLtx(clip.id)}>Open in LTX Director</button></header>
                    <SegmentDirectionEditor segment={segment} fps={fps} clipId={clip.id} clipLabel={clip.id} />
                    {!isT2V && segmentFrame && segmentFrame.id !== firstFrame?.id ? (
                      <FramePromptPanel
                        project={project}
                        frame={segmentFrame}
                        appliedIds={appliedReferenceIds}
                        onGenerateAll={() => {
                          const frameFile = (frame: any) => frame?.generatedFile || frame?.generatedVersions?.find((version: any) => Number(version.v) === Number(frame?.activeGeneratedVersion))?.file;
                          const missing = [firstFrame].filter((frame: any) => frame && frame.id && !frameFile(frame) && frame.status !== "generated");
                          for (const frame of missing) void store.generateStoryboardFrame(frame.id);
                        }}
                        label={`Additional image · segment ${String(segment.order).padStart(2, "0")}`}
                        busyLabel={store.storyboardFrameActions[segmentFrame.id]}
                        notice={store.storyboardFrameNotices[segmentFrame.id]}
                        onPush={(frameId) => void store.pushStoryboardFrameToComfyUI(frameId)}
                        onDownload={(frameId) => void store.downloadStoryboardFrameWorkflow(frameId)}
                        onGenerate={(frameId) => void store.generateStoryboardFrame(frameId)}
                        onReplaceImage={(frameId, file) => void store.replaceStoryboardFrameImage(frameId, file)}
                        onAddReferences={(frameId, label) => setPickerTarget({ frameId, label: `${clip.id} · ${label}` })}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>

      {pickerTarget && targetFrame ? <AssetReferencePicker key={pickerTarget.frameId} project={project} targetLabel={pickerTarget.label} targetId={pickerTarget.frameId} targetKind="frame" initialReferences={targetFrame.references || []} saving={store.storyboardSaving} onCancel={() => setPickerTarget(null)} onApply={async (references) => { await store.replaceStoryboardReferences("frame", pickerTarget.frameId, references); setAppliedReferenceIds(references.map((item: any) => item.assetId)); }} /> : null}
    </main>
  );
}
