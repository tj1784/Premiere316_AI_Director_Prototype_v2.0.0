import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { assetUrl, useStore } from "../store";
import AssetReferencePicker from "./AssetReferencePicker";

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
  return (
    <section className="storyboard-prompt-block">
      <header><div><p className="eyebrow">{label}</p><h3>{title}</h3></div><CopyButton text={prompt} /></header>
      <textarea aria-label={`${title} prompt`} readOnly value={prompt || ""} rows={rows} />
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

function ReferenceStrip({ project, references }: { project: any; references: any[] }) {
  const assets = project.assets?.items || [];
  return (
    <div className="storyboard-reference-strip">
      {references.map((binding) => {
        const asset = assets.find((item: any) => item.id === binding.assetId);
        const approved = versionApproved(asset, Number(binding.assetVersion));
        return (
          <article key={`${binding.assetId}-${binding.assetVersion}-${binding.order}`} title={`${binding.sourceAssetFile} · ${binding.role}`}>
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
  onAddReferences
}: {
  project: any;
  frame: any;
  label: string;
  onAddReferences: (frameId: string, label: string) => void;
}) {
  const references = frame?.references || [];
  const approved = references.filter((binding: any) => {
    const asset = project.assets?.items?.find((item: any) => item.id === binding.assetId);
    return versionApproved(asset, Number(binding.assetVersion));
  }).length;
  return (
    <section className="storyboard-frame-panel">
      <header>
        <div><p className="eyebrow">IMAGE GUIDE</p><h2>{label}</h2><small>{frame.expectedInputPath}</small></div>
        <div className="storyboard-frame-actions"><span className={approved === references.length && references.length ? "ready" : "blocked"}>{approved}/{references.length} exact versions approved</span><button type="button" className="primary-action" onClick={() => onAddReferences(frame.id, label)}>＋ Add References</button></div>
      </header>
      <div className="storyboard-frame-status"><span className={frame.status === "ready_to_generate" ? "ready" : "waiting"} /><b>{String(frame.status || "not started").replaceAll("_", " ")}</b><small>{frame.purpose === "first_frame" ? "Clip opening composition" : "Additional segment continuity reset"}</small></div>
      <PromptBlock label="FIRST-FRAME IMAGE GENERATION" title="Positive prompt" prompt={frame.prompt} rows={11} />
      <details className="storyboard-negative-prompt"><summary>Negative / avoid prompt <span>{frame.negativePrompt?.length || 0} characters</span></summary><div><CopyButton text={frame.negativePrompt || ""} /><p>{frame.negativePrompt}</p></div></details>
      <section className="storyboard-reference-section">
        <header><div><p className="eyebrow">EXACT INPUTS</p><h3>{references.length} assigned visual references</h3></div><small>Identity, wardrobe, environment, props, crowd, and VFX are version-pinned.</small></header>
        <ReferenceStrip project={project} references={references} />
      </section>
    </section>
  );
}

function fullClipPackage(storyboard: any, clip: any) {
  const frame = storyboard.frames?.[clip.firstFrameId];
  const video = storyboard.videoPlans?.[clip.videoPlanId];
  const segments = (video?.segmentIds || []).map((id: string) => storyboard.segments?.[id]).filter(Boolean);
  const sections = [
    `CLIP ${clip.id}`,
    `BEAT\n${clip.beat}`,
    `FIRST-FRAME PROMPT\n${frame?.prompt || ""}`,
    `FIRST-FRAME NEGATIVE\n${frame?.negativePrompt || ""}`,
    `LTX GLOBAL VIDEO PROMPT\n${video?.globalPrompt || ""}`
  ];
  for (const segment of segments) {
    sections.push(`SEGMENT ${segment.order} LOCAL VIDEO PROMPT\n${segment.prompt}`);
    if (segment.frameId && segment.frameId !== clip.firstFrameId) {
      const segmentFrame = storyboard.frames?.[segment.frameId];
      sections.push(`SEGMENT ${segment.order} IMAGE PROMPT\n${segmentFrame?.prompt || ""}`);
      sections.push(`SEGMENT ${segment.order} IMAGE NEGATIVE\n${segmentFrame?.negativePrompt || ""}`);
    }
  }
  return sections.join("\n\n============================================================\n\n");
}

export default function StoryboardWorkspace({ onOpenAssets }: { onOpenAssets: () => void }) {
  const store = useStore();
  const project = store.project;
  const storyboard = store.storyboard;
  const [chapterFilter, setChapterFilter] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [pickerTarget, setPickerTarget] = useState<{ frameId: string; label: string } | null>(null);

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
          if (clip) records.push({ clip, chapter, scene, sequenceIndex: ++sequenceIndex });
        }
      }
    }
    return records;
  }, [storyboard]);

  const filteredRecords = useMemo(() => clipRecords.filter((record) => {
    if (chapterFilter !== "all" && record.chapter.id !== chapterFilter) return false;
    if (!deferredQuery) return true;
    return `${record.clip.id} ${record.clip.beat} ${record.clip.dialogueAnchor} ${record.scene.title} ${record.chapter.title}`.toLowerCase().includes(deferredQuery);
  }), [chapterFilter, clipRecords, deferredQuery]);
  const selectedRecord = clipRecords.find((record) => record.clip.id === store.selectedStoryboardClipId) || clipRecords[0] || null;

  if (store.storyboardBusy && !storyboard) return <main className="storyboard-loading"><span>▦</span><h1>Loading production storyboard…</h1><p>119 clips and their generation packages are being indexed.</p></main>;
  if (!storyboard || !selectedRecord) return <main className="storyboard-loading"><span>!</span><h1>Storyboard package unavailable</h1><p>Import a Premiere316 storyboard package for this project, then try again.</p><button className="primary-action" onClick={() => void store.loadStoryboard()}>Retry</button></main>;

  const { clip, chapter, scene, sequenceIndex } = selectedRecord;
  const fps = Number(storyboard.defaults?.fps || project.settings?.fps || 24);
  const firstFrame = storyboard.frames?.[clip.firstFrameId];
  const videoPlan = storyboard.videoPlans?.[clip.videoPlanId];
  const segments = (videoPlan?.segmentIds || []).map((id: string) => storyboard.segments?.[id]).filter(Boolean);
  const additionalFrames = segments.filter((segment: any) => segment.frameId && segment.frameId !== clip.firstFrameId).length;
  const targetFrame = pickerTarget ? storyboard.frames?.[pickerTarget.frameId] : null;

  return (
    <main className="storyboard-workspace">
      <aside className="storyboard-sidebar">
        <header><div className="storyboard-mark">▦</div><div><p className="eyebrow">PRODUCTION BOARD</p><h2>Storyboard</h2><small>Chapter → scene → 10–20 second clips</small></div></header>
        <section className="storyboard-summary">
          <div><b>{store.storyboardSummary?.clips || clipRecords.length}</b><span>clips</span></div>
          <div><b>{store.storyboardSummary?.frames || Object.keys(storyboard.frames || {}).length}</b><span>image prompts</span></div>
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
        <header><div><p className="eyebrow">SHOT INDEX</p><h2>{chapterFilter === "all" ? "All chapters" : storyboard.chapters[chapterFilter]?.title}</h2></div><span>{filteredRecords.length} clips</span></header>
        <div className="storyboard-clip-list">
          {filteredRecords.map((record) => <button key={record.clip.id} className={record.clip.id === clip.id ? "active" : ""} onClick={() => store.setSelectedStoryboardClip(record.clip.id)}><span className="storyboard-clip-number">{String(record.sequenceIndex).padStart(3, "0")}</span><span><small>{record.chapter.id} · SCENE {String(record.scene.number).padStart(2, "0")}</small><b>{record.scene.title}</b><p>{record.clip.beat}</p></span><em>{Math.round(record.clip.durationFrames / fps)}s</em></button>)}
          {!filteredRecords.length ? <div className="storyboard-index-empty">No clips match the current filter.</div> : null}
        </div>
      </section>

      <section className="storyboard-detail">
        <header className="storyboard-detail-header">
          <div><p className="eyebrow">{chapter.id} · SCENE {String(scene.number).padStart(2, "0")} · CLIP {String(sequenceIndex).padStart(3, "0")}</p><h1>{scene.title}</h1><p>{clip.beat}</p></div>
          <div className="storyboard-detail-actions"><CopyButton text={fullClipPackage(storyboard, clip)} label="Copy full clip package" /><button type="button" className="secondary-action" onClick={onOpenAssets}>Open Asset Foundry</button></div>
        </header>

        <div className="storyboard-detail-scroll">
          <section className="storyboard-readiness-banner"><span>!</span><div><b>PROMPTS COMPLETE · IMAGE APPROVAL REQUIRED BEFORE VIDEO</b><small>The plan is render-aligned, but exact reference versions and generated image guides must pass Asset Foundry review before queueing.</small></div></section>
          <section className="storyboard-shot-metadata">
            <div><span>Timeline</span><b>{formatTimecode(clip.timelineStartFrame, fps)}</b></div>
            <div><span>Duration</span><b>{(clip.durationFrames / fps).toFixed(1)} sec · {clip.durationFrames} frames</b></div>
            <div><span>Shot / lens</span><b>{clip.shotSizeLens}</b></div>
            <div><span>Camera</span><b>{clip.cameraMovement}</b></div>
            <div><span>Transition</span><b>{clip.transition}</b></div>
            <div><span>Dialogue anchor</span><b>{clip.dialogueAnchor}</b></div>
          </section>
          <section className="storyboard-continuity-locks"><header><p className="eyebrow">CONTINUITY LOCKS</p><span>{clip.continuityLocks?.length || 0}</span></header><div>{(clip.continuityLocks || []).map((lock: string, index: number) => <span key={`${lock}-${index}`}>✓ {lock}</span>)}</div></section>

          <FramePromptPanel project={project} frame={firstFrame} label="First frame" onAddReferences={(frameId, label) => setPickerTarget({ frameId, label: `${clip.id} · ${label}` })} />

          <section className="storyboard-video-panel">
            <header><div><p className="eyebrow">VIDEO GENERATION</p><h2>LTX Director · {Math.round(clip.durationFrames / fps)}-second silent picture pass</h2></div><div className="storyboard-workflow-chips"><span>24 FPS</span><span>8-frame grid</span><span>{segments.length} segments</span><span>Trim +{clip.trimDecodedFrames} decoded frame</span><span>Audio off</span></div></header>
            <PromptBlock label="LTX GLOBAL VIDEO" title="Global video-generation prompt" prompt={videoPlan.globalPrompt} rows={12} />
            <div className="storyboard-segment-heading"><div><p className="eyebrow">PROMPT RELAY</p><h3>{segments.length} contiguous segments · {additionalFrames} additional image reset{additionalFrames === 1 ? "" : "s"}</h3></div><small>{videoPlan.segmentLengths} frames</small></div>
            <div className="storyboard-segment-list">
              {segments.map((segment: any) => {
                const segmentFrame = segment.frameId ? storyboard.frames?.[segment.frameId] : null;
                const start = segment.startFrame / fps;
                const end = (segment.startFrame + segment.lengthFrames) / fps;
                return (
                  <article key={segment.id} className={`storyboard-segment-card ${segment.type}`}>
                    <header><span>{String(segment.order).padStart(2, "0")}</span><div><b>{start.toFixed(1)}–{end.toFixed(1)} seconds</b><small>{segment.lengthFrames} frames · {segment.type === "image" ? "image-guided" : "text continuation"}</small></div><CopyButton text={segment.prompt} label="Copy local prompt" /></header>
                    <p>{segment.prompt}</p>
                    {segmentFrame && segmentFrame.id !== firstFrame.id ? <FramePromptPanel project={project} frame={segmentFrame} label={`Additional image · segment ${String(segment.order).padStart(2, "0")}`} onAddReferences={(frameId, label) => setPickerTarget({ frameId, label: `${clip.id} · ${label}` })} /> : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>

      {pickerTarget && targetFrame ? <AssetReferencePicker key={pickerTarget.frameId} project={project} targetLabel={pickerTarget.label} initialReferences={targetFrame.references || []} saving={store.storyboardSaving} onCancel={() => setPickerTarget(null)} onApply={(references) => store.replaceStoryboardReferences("frame", pickerTarget.frameId, references)} /> : null}
    </main>
  );
}
