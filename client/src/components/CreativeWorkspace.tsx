import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useStore,
  frameUrl,
  clipUrl,
  audioUrl,
  masterUrl
} from "../store";
import { openAssetAction } from "../contextual-agency";
import AssetReferencePicker from "./AssetReferencePicker";

function currentCreativeRoute() {
  const path = String(window.location.pathname || "").toLowerCase();
  if (path.includes("/export")) return "/export";
  if (path.includes("/master")) return "/master";
  if (path.includes("/generate")) return "/generate";
  return "/edit";
}

function openCreativeSlot(intent) {
  openAssetAction({
    sourceRoute: currentCreativeRoute(),
    ...intent
  });
}

function timecode(frame: number, fps: number) {
  const safe = Math.max(0, Math.round(Number(frame) || 0));
  const frames = safe % fps;
  const totalSeconds = Math.floor(safe / fps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

function secondsLabel(value: number) {
  if (!Number.isFinite(value)) return "0.0s";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)}s`;
}

const MASTER_BOOKEND_DURATION_SEC = 30;
const MASTER_OPENING_TITLE = "Premiere316 Productions";

function roleClass(role: string) {
  return role === "first" ? "first" : role === "last" ? "last" : "middle";
}

function roleLetter(role: string) {
  return role === "first" ? "F" : role === "last" ? "L" : "K";
}

function jobStatusLabel(status: string) {
  if (status === "running") return "RUNNING";
  if (status === "queued") return "QUEUED";
  if (status === "cancelling") return "STOPPING";
  if (status === "cancelled") return "STOPPED";
  if (status === "done") return "DONE";
  if (status === "error") return "FAILED";
  return status?.toUpperCase?.() || "UNKNOWN";
}

function h3ResolvedFramesUi(requestedSeconds: number) {
  const rounded = Math.max(5, Math.round(Math.max(0, requestedSeconds) * 24));
  return rounded + ((5 - (rounded % 17) + 17) % 17);
}

function Waveform({ density = 120, variant = "audio" }: { density?: number; variant?: string }) {
  return (
    <div className={`waveform ${variant}`} aria-hidden="true">
      {Array.from({ length: density }).map((_, index) => {
        const height = 20 + ((index * 17 + (index % 11) * 9) % 70);
        return <i key={index} style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}

function EmptyMonitor({ children }: { children: React.ReactNode }) {
  return <div className="monitor-empty"><span>◇</span><p>{children}</p></div>;
}

export default function CreativeWorkspace({ onOpenAssets }: { onOpenAssets: () => void }) {
  const store = useStore();
  const project = store.project!;
  const fps = project.settings?.fps || 24;
  const clips = project.sequence?.clips || [];
  const selectedClip = clips.find((clip: any) => clip.id === store.selClipId) || clips[0] || null;
  const selectedGuide = selectedClip?.guides?.find((guide: any) => guide.id === store.selectedGuideId) || null;
  const activeClipVersion = selectedClip?.versions?.find(
    (version: any) => Number(version.v) === Number(selectedClip.activeVersion)
  );
  const activeMaster = project.masters?.find(
    (version: any) => Number(version.v) === Number(project.activeMasterVersion)
  ) || project.masters?.[project.masters.length - 1] || null;
  const activeScore = project.score?.versions?.find(
    (version: any) => Number(version.v) === Number(project.score.activeVersion)
  ) || null;

  const scoreUploadRef = useRef<HTMLInputElement>(null);
  const shortsFrameRef = useRef<HTMLInputElement>(null);
  const isShorts = project.category === "shorts" || project.settings?.skipApproval === true;
  const programVideoRef = useRef<HTMLVideoElement>(null);
  const masterVideoRef = useRef<HTMLVideoElement>(null);
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | "running" | "done" | "error">("all");
  const [h3ReferencePickerOpen, setH3ReferencePickerOpen] = useState(false);
  const [h3References, setH3References] = useState<any[]>([]);
  const [guideDraft, setGuideDraft] = useState({
    role: "middle",
    frame: 24,
    prompt: "Golden light illuminating ancient temple pillars, cinematic continuity, photorealistic detail.",
    strength: 0.85,
    seed: 987654321
  });

  useEffect(() => {
    if (!selectedClip) return;
    setGuideDraft((draft) => ({
      ...draft,
      frame: Math.max(1, Math.round((selectedClip.durationSec * fps) / 2))
    }));
  }, [selectedClip?.id]);

  useEffect(() => {
    setH3References([]);
    setH3ReferencePickerOpen(false);
  }, [project.slug, selectedClip?.id]);

  const totalDurationSec = useMemo(
    () => clips.reduce((sum: number, clip: any) => sum + Number(clip.durationSec || 0), 0),
    [clips]
  );
  const totalFrames = Math.max(1, Math.round(totalDurationSec * fps));
  const bookends = project.settings?.bookends || {};
  const openingEnabled = bookends.opening?.enabled === true;
  const creditsEnabled = bookends.credits?.enabled === true;
  const creditsText = bookends.credits?.text || `${String(project.name || "Untitled Project").toUpperCase()}\n\nA Premiere316 Production\n\nCreated with Premiere316 AI Director`;
  const plannedBookendDurationSec =
    (openingEnabled ? MASTER_BOOKEND_DURATION_SEC : 0) +
    (creditsEnabled ? MASTER_BOOKEND_DURATION_SEC : 0);
  const plannedMasterFrames = Math.max(0, Math.round((totalDurationSec + plannedBookendDurationSec) * fps));
  const activeMasterBookends = activeMaster?.bookends;
  const activeMasterBookendLabel = activeMaster
    ? activeMasterBookends
      ? [activeMasterBookends.opening?.enabled ? "Opening" : null, activeMasterBookends.credits?.enabled ? "Credits" : null].filter(Boolean).join(" + ") || "None"
      : "Legacy / not recorded"
    : plannedBookendDurationSec
      ? [openingEnabled ? "Opening" : null, creditsEnabled ? "Credits" : null].filter(Boolean).join(" + ")
      : "None";
  const bookendsNeedRebuild = Boolean(activeMaster && (
    !activeMasterBookends ||
    activeMasterBookends.opening?.enabled !== openingEnabled ||
    activeMasterBookends.credits?.enabled !== creditsEnabled ||
    (creditsEnabled && String(activeMasterBookends.credits?.text || "") !== String(creditsText))
  ));
  const laneWidth = Math.max(1050, totalDurationSec * store.pxPerSec + 140);
  const selectedSegments = selectedClip
    ? selectedClip.segments.filter((segment: any) => store.selectedSegmentIds.includes(segment.id))
    : [];
  const selectedStartFrame = selectedSegments.length
    ? Math.min(...selectedSegments.map((segment: any) => segment.startFrame))
    : store.markInFrame;
  const selectedEndFrame = selectedSegments.length
    ? Math.max(...selectedSegments.map((segment: any) => segment.endFrame))
    : store.markOutFrame;
  const requestedFrames = selectedStartFrame != null && selectedEndFrame != null
    ? Math.abs(selectedEndFrame - selectedStartFrame)
    : selectedClip ? Math.round(selectedClip.durationSec * fps) : 0;
  const generationFrames = requestedFrames > 0 ? Math.ceil((requestedFrames - 1) / 8) * 8 + 1 : 0;
  const h3RequestedSeconds = requestedFrames ? requestedFrames / fps : selectedClip ? selectedClip.durationSec : 0;
  const h3GenerationSeconds = Math.min(15, Math.max(4, h3RequestedSeconds || 0));
  const h3ResolvedFrames = h3RequestedSeconds ? h3ResolvedFramesUi(h3GenerationSeconds) : 0;
  const h3RawSeconds = h3ResolvedFrames ? h3ResolvedFrames / 24 : 0;
  const selectedH3Mode = (store.h3Diagnostics?.modes || []).find((mode: any) => mode.id === store.h3Mode);
  const h3ModeNeedsApprovedGuides = ["first_frame", "last_frame", "first_last"].includes(store.h3Mode);
  const h3ModeReady = selectedH3Mode ? Boolean(selectedH3Mode.enabled) : store.h3Mode === "reference" ? Boolean(store.h3Diagnostics?.ref2vaReady) : Boolean(store.h3Diagnostics?.fl2vaReady);
  const h3ReferenceNames = h3References
    .map((reference: any) => (project.assets?.items || []).find((asset: any) => asset.id === reference.assetId)?.name || reference.display || reference.assetId)
    .filter(Boolean);
  const h3ReferenceLabel = h3References.length
    ? `${h3References.length}/12 · ${h3ReferenceNames.slice(0, 3).join(", ")}${h3ReferenceNames.length > 3 ? " +" + (h3ReferenceNames.length - 3) : ""}`
    : "0/12";

  const latestSelectedRange = useMemo(() => {
    if (!selectedClip?.rangeVersions?.length) return null;
    const start = selectedStartFrame ?? 0;
    const end = selectedEndFrame ?? Math.round(selectedClip.durationSec * fps);
    return [...selectedClip.rangeVersions]
      .filter((range: any) => Number(range.startFrame) === Number(start) && Number(range.endFrame) === Number(end))
      .sort((a: any, b: any) => Number(b.v) - Number(a.v))[0] || null;
  }, [selectedClip, selectedStartFrame, selectedEndFrame]);

  const sourceFile = selectedGuide?.file || store.selFrameFile || selectedClip?.firstFrame?.file || null;
  const sourceSrc = sourceFile ? frameUrl(project.slug, sourceFile) : null;
  const programFile = latestSelectedRange?.file || activeClipVersion?.file || null;
  const programSrc = programFile ? clipUrl(project.slug, programFile) : null;
  const masterSrc = activeMaster?.file ? masterUrl(project.slug, activeMaster.file) : null;

  const projectJobs = store.jobs
    .filter((job: any) => job.projectSlug === project.slug)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const filteredJobs = projectJobs.filter((job: any) => {
    if (queueFilter === "all") return true;
    if (queueFilter === "running") return job.status === "running" || job.status === "queued";
    return job.status === queueFilter;
  });
  const runningJobs = projectJobs.filter((job: any) => job.status === "running" || job.status === "queued");

  const tickStep = store.pxPerSec >= 72 ? 1 : store.pxPerSec >= 36 ? 2 : 5;
  const ticks: number[] = [];
  for (let second = 0; second <= Math.ceil(totalDurationSec + 1); second += tickStep) ticks.push(second);

  const filteredFrames = (project.frames || []).filter((frame: any) =>
    !search || String(frame.name).toLowerCase().includes(search.toLowerCase())
  );

  const frameIsApproved = (frameOrFile: any) => {
    const frame = typeof frameOrFile === "string"
      ? (project.frames || []).find((item: any) => item.file === frameOrFile)
      : frameOrFile;
    if (!frame) return false;
    if (isShorts) return Boolean(frame.file);
    if (frame.source !== "asset-foundry-approved" || !frame.assetId) return false;
    const asset = project.assets?.items?.find((item: any) => item.id === frame.assetId);
    const active = asset?.versions?.find((version: any) => Number(version.v) === Number(asset.activeVersion));
    return Boolean(
      asset?.approvalCurrent !== false &&
      active?.assetFingerprint &&
      active?.fileHashes?.length &&
      asset?.approval?.status === "approved" &&
      asset.approval.generationFingerprint === active.assetFingerprint &&
      asset.approval.workflowId === asset.workflowId &&
      String(asset.approval.workflowHash || "") === String(asset.workflowHash || "") &&
      Number(asset.approval.activeVersion) === Number(frame.assetVersion) &&
      Number(asset.activeVersion) === Number(frame.assetVersion) &&
      asset.approval.versionFingerprint === frame.assetApprovalFingerprint &&
      asset.approval.screenplayRevision === project.screenplay?.revision &&
      project.assets?.screenplayHash === project.screenplay?.revision
    );
  };
  const selectedFrameApproved = frameIsApproved(store.selFrameFile);
  const selectedClipGuideFiles = selectedClip ? [...new Set([
    ...(selectedClip.guides || []).map((guide: any) => guide.file),
    selectedClip.firstFrame?.file,
    selectedClip.endFrame?.file
  ].filter(Boolean))] : [];
  const selectedClipHasFirstGuide = Boolean(selectedClip?.guides?.some((guide: any) => guide.role === "first" || Number(guide.frame) === 0));
  const selectedClipGuidesApproved = Boolean(selectedClip && selectedClipHasFirstGuide && selectedClipGuideFiles.length && selectedClipGuideFiles.every((file: any) => frameIsApproved(file)));
  const h3PrimaryIssue = !store.health.comfy
    ? "ComfyUI is offline."
    : !store.h3Diagnostics
      ? "Checking MiniMax H3 video…"
      : !h3ModeReady
        ? (store.h3Diagnostics.actionableErrors?.[0] || selectedH3Mode?.disabledReason || "MiniMax H3 video is not ready.")
        : h3ModeNeedsApprovedGuides && !selectedClipGuidesApproved
          ? "Use approved Assets/Storyboard stills (Krea2 or Klein2) for this H3 video mode."
          : "";
  const h3CanRender = Boolean(selectedClip && store.health.comfy && h3ModeReady && (!h3ModeNeedsApprovedGuides || selectedClipGuidesApproved) && !store.h3Busy);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        const video = programVideoRef.current;
        if (!video) return;
        video.paused ? video.play() : video.pause();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        store.saveProject();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.selectAllSegments();
      }
      if (event.key.toLowerCase() === "i") store.setMarkIn();
      if (event.key.toLowerCase() === "o") store.setMarkOut();
      if (event.key.toLowerCase() === "r" && selectedClip && selectedClipGuidesApproved) store.renderSelection(selectedClip.id);
      if (event.key === "Escape") store.setSelectedSegments([]);
      if (event.key === "ArrowLeft") store.setPlayheadFrame(store.playheadFrame - 1);
      if (event.key === "ArrowRight") store.setPlayheadFrame(store.playheadFrame + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedClip?.id, store.playheadFrame, store.selectedSegmentIds.join("|")]);

  const patchSegmentPrompt = (clipId: string, segmentId: string, prompt: string) => {
    store.patchLocal((next) => {
      const clip = next.sequence.clips.find((item: any) => item.id === clipId);
      const segment = clip?.segments?.find((item: any) => item.id === segmentId);
      if (segment) {
        segment.prompt = prompt;
        segment.dirty = true;
        clip.status = clip.versions?.length ? "dirty" : "ready";
      }
    });
  };

  const queueH3Selection = () => {
    if (!selectedClip) return;
    store.renderH3Selection(selectedClip.id, undefined, { references: h3References, refImageSize: "match" });
  };

  const commitClipSegments = async () => {
    if (!selectedClip) return;
    const latest = store.project?.sequence?.clips?.find((clip: any) => clip.id === selectedClip.id);
    if (latest) await store.patchClip(selectedClip.id, { segments: latest.segments, globalPrompt: latest.globalPrompt });
  };

  const addSegment = async () => {
    if (!selectedClip) return;
    const current = [...selectedClip.segments];
    const total = Math.round(selectedClip.durationSec * fps);
    const count = current.length + 1;
    const base = Math.floor(total / count);
    let cursor = 0;
    const next = Array.from({ length: count }).map((_, index) => {
      const end = index === count - 1 ? total : cursor + base;
      const old = current[index];
      const segment = {
        id: old?.id,
        startFrame: cursor,
        endFrame: end,
        startSec: cursor / fps,
        endSec: end / fps,
        prompt: old?.prompt || "",
        dirty: true
      };
      cursor = end;
      return segment;
    });
    await store.patchClip(selectedClip.id, { segments: next });
  };

  const removeSelectedSegments = async () => {
    if (!selectedClip || !store.selectedSegmentIds.length || selectedClip.segments.length <= 1) return;
    const keep = selectedClip.segments.filter((segment: any) => !store.selectedSegmentIds.includes(segment.id));
    if (!keep.length) return;
    const total = Math.round(selectedClip.durationSec * fps);
    const base = Math.floor(total / keep.length);
    let cursor = 0;
    const next = keep.map((segment: any, index: number) => {
      const end = index === keep.length - 1 ? total : cursor + base;
      const item = { ...segment, startFrame: cursor, endFrame: end, startSec: cursor / fps, endSec: end / fps, dirty: true };
      cursor = end;
      return item;
    });
    store.setSelectedSegments([]);
    await store.patchClip(selectedClip.id, { segments: next });
  };

  const dragState = useRef<any>(null);
  const beginClipResize = (event: React.PointerEvent, clip: any) => {
    event.stopPropagation();
    dragState.current = { clipId: clip.id, startX: event.clientX, startDuration: clip.durationSec };
    const move = (pointer: PointerEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      const delta = (pointer.clientX - drag.startX) / store.pxPerSec;
      const duration = Math.min(30, Math.max(2, Math.round((drag.startDuration + delta) * fps) / fps));
      store.patchLocal((next) => {
        const target = next.sequence.clips.find((item: any) => item.id === drag.clipId);
        if (target) target.durationSec = duration;
        let start = 0;
        for (const item of next.sequence.clips) {
          item.startSec = start;
          start += item.durationSec;
        }
      });
    };
    const up = async () => {
      const drag = dragState.current;
      dragState.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const latest = store.project?.sequence?.clips?.find((item: any) => item.id === drag?.clipId);
      if (latest) await store.patchClip(latest.id, { durationSec: latest.durationSec });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const clickSegment = (event: React.MouseEvent, clip: any, segment: any) => {
    event.stopPropagation();
    if (store.selClipId !== clip.id) {
      store.setSelClip(clip.id);
      store.setSelectedSegments([segment.id], segment.id);
    } else if (event.shiftKey) {
      store.selectSegmentRange(segment.id);
    } else {
      store.toggleSegment(segment.id, event.ctrlKey || event.metaKey);
    }
    store.setPlayheadFrame((clip.startFrame || Math.round(clip.startSec * fps)) + segment.startFrame);
  };

  const selectedClipFrameOffset = selectedClip?.startFrame || Math.round((selectedClip?.startSec || 0) * fps);

  return (
    <main className="editor-workspace">
      <section className="top-workspace">
        <aside className="project-bin premium-panel">
          <div className="panel-title-row">
            <h2>PROJECT BIN</h2>
            <button type="button" className="mini-icon" data-testid="nav-007-bin-fix" title="Fix missing media here" onClick={() => openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Edit" }, requirement: { relationship: "edit.media", category: "atmosphere", expectedMediaType: "image" }, initialAction: "choose", slotState: "missing", returnFocusId: "nav-007-bin-fix" })}>▣</button>
          </div>
          <div className="bin-search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media" />
            <button>☷</button>
          </div>
          <div className="bin-scroll">
            <div className="bin-section-heading"><span>⌄ Clips</span><small>{clips.length} items</small></div>
            <div className="clip-bin-list">
              {clips.map((clip: any) => (
                <button
                  key={clip.id}
                  className={`clip-bin-item ${store.selClipId === clip.id ? "selected" : ""}`}
                  onClick={() => store.setSelClip(clip.id)}
                >
                  <span className="clip-bin-thumb">
                    {clip.firstFrame?.file ? <img src={frameUrl(project.slug, clip.firstFrame.file)} alt="" /> : <i>◇</i>}
                    {clip.status === "dirty" || clip.status === "partial" ? <em>●</em> : null}
                  </span>
                  <span className="clip-bin-copy">
                    <b>{clip.name}</b>
                    <small>{timecode(Math.round(clip.durationSec * fps), fps)}</small>
                  </span>
                  <span className={`clip-state ${clip.status || "ready"}`}>{clip.activeVersion ? `v${clip.activeVersion}` : "—"}</span>
                </button>
              ))}
            </div>

            <div className="bin-section-heading compact"><span>› Media</span><small>{project.frames?.length || 0}</small></div>
            <div className="bin-section-heading compact"><span>› Images / Guides</span><small>{clips.reduce((n: number, c: any) => n + (c.guides?.length || 0), 0)}</small></div>
            <div className="bin-section-heading compact"><span>› Audio</span><small>{project.score?.versions?.length || 0}</small></div>
            <div className="bin-section-heading compact"><span>› Renders</span><small>{clips.reduce((n: number, c: any) => n + (c.versions?.length || 0) + (c.rangeVersions?.length || 0), 0)}</small></div>

            <div className="frame-grid">
              {filteredFrames.slice(-12).map((frame: any) => {
                const approvedFrame = frameIsApproved(frame);
                return (
                  <div key={frame.id} className={`frame-tile ${store.selFrameFile === frame.file ? "selected" : ""} ${approvedFrame ? "approved" : "locked"}`}>
                    <button
                      className="frame-select"
                      onClick={() => store.setSelFrame(frame.file)}
                      onDoubleClick={() => approvedFrame ? store.addClipFromFrame(frame.file) : store.setError("This legacy item is not an approved Asset Library version.")}
                      title={approvedFrame ? `${frame.name} · approved · double-click to add as a clip` : `${frame.name} · locked legacy media`}
                    >
                      <img src={frameUrl(project.slug, frame.file)} alt="" />
                      <span className="frame-provenance">{approvedFrame ? "✓" : "!"}</span>
                    </button>
                    <button
                      className="frame-delete"
                      title="Move this unused media to recoverable project trash"
                      aria-label={`Delete ${frame.name}`}
                      onClick={async () => {
                        if (window.confirm(`Remove “${frame.name}” from this Project Bin?\n\nThe file will be moved to recoverable project trash.`)) await store.deleteFrame(frame.id);
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
            {project.trash?.frames?.length ? (
              <details className="project-trash">
                <summary>Recoverable Trash <span>{project.trash.frames.length}</span></summary>
                <div>
                  {project.trash.frames.slice().reverse().map((frame: any) => (
                    <button key={frame.id} onClick={() => store.restoreFrame(frame.id)} title="Restore this file to the Project Bin; stale or legacy media remains locked until it is a current approved asset version.">
                      <span>↶</span><b>{frame.name || frame.file}</b><small>Restore</small>
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
          <button type="button" className="bin-lock" data-testid="nav-007-bin-lock" title="Fix missing media here" onClick={() => openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Edit" }, requirement: { relationship: "edit.media", category: "atmosphere", expectedMediaType: "image" }, initialAction: "generate", slotState: "missing", returnFocusId: "nav-007-bin-lock" })}><span>▣</span><div><b>Fix missing here</b><small>Generate, upload, or choose for this slot</small></div></button>
        </aside>

        <section className="monitor-workspace premium-panel">
          <div className="source-monitor monitor-panel">
            <div className="monitor-header">
              <span><b>SOURCE</b>{selectedClip ? ` (Clip: ${selectedClip.name})` : ""}</span>
              <small>{selectedGuide ? `${roleLetter(selectedGuide.role)} guide · frame ${selectedGuide.frame}` : "Selected media"}</small>
            </div>
            <div className="monitor-stage">
              {sourceSrc ? <img src={sourceSrc} alt="Selected source" /> : <EmptyMonitor>Select a clip or approved Project Bin image.</EmptyMonitor>}
              {selectedGuide ? <span className={`guide-overlay-badge ${roleClass(selectedGuide.role)}`}>{roleLetter(selectedGuide.role)}</span> : null}
            </div>
            <div className="monitor-transport">
              <b>{timecode(selectedGuide?.frame || 0, fps)}</b>
              <span className="transport-spacer" />
              <button>│◀</button><button>◀</button><button>▶</button><button>▶│</button>
              <span className="transport-spacer" />
              <select><option>Fit</option><option>100%</option><option>50%</option></select>
              <button>⛶</button>
            </div>
          </div>

          <aside className="clip-facts">
            {selectedClip ? (
              <>
                <div className="facts-name">
                  <small>CLIP</small>
                  <b>{selectedClip.name}</b>
                </div>
                <dl>
                  <div><dt>Resolution</dt><dd>{project.settings.width}×{project.settings.height}</dd></div>
                  <div><dt>FPS</dt><dd>{fps}</dd></div>
                  <div><dt>Duration</dt><dd>{timecode(Math.round(selectedClip.durationSec * fps), fps)}</dd></div>
                  <div><dt>Frames</dt><dd>{Math.round(selectedClip.durationSec * fps)}</dd></div>
                </dl>
                <label>Active version</label>
                <select
                  value={selectedClip.activeVersion || 0}
                  onChange={(event) => store.patchClip(selectedClip.id, { activeVersion: Number(event.target.value) })}
                >
                  <option value={0}>No full render</option>
                  {(selectedClip.versions || []).map((version: any) => (
                    <option key={version.v} value={version.v}>v{version.v} · {version.source || "render"}</option>
                  ))}
                </select>
                <div className="facts-status"><span className="good-dot" /> Status <b>{selectedClip.status || "ready"}</b></div>
                <div className="facts-status"><span className="quality-dot" /> Quality <b>{selectedClip.activeVersion ? "Accepted" : "Pending"}</b></div>
                <button className="button secondary full" onClick={() => store.setWorkbench("prompt")}>Clip settings</button>
              </>
            ) : <p className="muted centered">Select a clip from the project bin.</p>}
          </aside>

          <div className="program-monitor monitor-panel">
            <div className="monitor-header">
              <span><b>PROGRAM</b> {latestSelectedRange ? `(Selected range v${latestSelectedRange.v})` : activeClipVersion ? `(Active version v${activeClipVersion.v})` : ""}</span>
              <small>{selectedClip?.name || "Sequence monitor"}</small>
            </div>
            <div className="monitor-stage">
              {programSrc ? (
                <video ref={programVideoRef} key={programSrc} src={programSrc} controls={false} />
              ) : sourceSrc ? (
                <img src={sourceSrc} className="pending-preview" alt="Pending render" />
              ) : (
                <EmptyMonitor>Rendered video appears here.</EmptyMonitor>
              )}
              {!programSrc && sourceSrc ? <span className="pending-render-pill">PENDING RENDER</span> : null}
            </div>
            <div className="monitor-transport">
              <b>{timecode(store.playheadFrame, fps)}</b>
              <span className="transport-spacer" />
              <button onClick={() => { if (programVideoRef.current) programVideoRef.current.currentTime = 0; }}>│◀</button>
              <button onClick={() => programVideoRef.current?.pause()}>◀</button>
              <button className="play-button" onClick={() => programVideoRef.current?.play()}>▶</button>
              <button onClick={() => programVideoRef.current?.pause()}>▶│</button>
              <span className="transport-spacer" />
              <select><option>Fit</option><option>100%</option><option>50%</option></select>
              <button>⛶</button>
            </div>
          </div>
        </section>

        <aside className="render-queue premium-panel">
          <div className="panel-title-row">
            <h2>RENDER QUEUE</h2>
            <button className="mini-icon" onClick={() => store.refreshQueue()}>↻</button>
          </div>
          <div className="queue-tabs">
            {(["all", "running", "done", "error"] as const).map((tab) => (
              <button key={tab} className={queueFilter === tab ? "active" : ""} onClick={() => setQueueFilter(tab)}>
                {tab === "error" ? "Failed" : tab[0].toUpperCase() + tab.slice(1)}
                <em>{tab === "all" ? projectJobs.length : tab === "running" ? runningJobs.length : projectJobs.filter((job: any) => job.status === tab).length}</em>
              </button>
            ))}
          </div>
          <div className="queue-list">
            {!filteredJobs.length ? (
              <div className="queue-empty"><span>✓</span><b>Queue is clear</b><small>Select segments and render when ready.</small></div>
            ) : filteredJobs.slice(0, 8).map((job: any) => (
              <article key={job.id} className={`queue-job ${job.status}`}>
                <div className="queue-job-head">
                  <b>{job.label}</b>
                  <span>{jobStatusLabel(job.status)}</span>
                </div>
                <small>{job.stage || job.type?.replaceAll?.("_", " ")}</small>
                {(job.status === "running" || job.status === "queued") && (
                  <div className="progress-track"><i style={{ width: `${Math.max(4, Math.round((job.progress || 0) * 100))}%` }} /></div>
                )}
                <div className="queue-job-foot">
                  <span>{job.status === "running" ? `${Math.round((job.progress || 0) * 100)}%` : job.status}</span>
                  {(job.status === "queued" || job.status === "running") ? (
                    <button onClick={() => {
                      if (job.status === "running" && !window.confirm("Stop the active ComfyUI generation now? This interrupts the current prompt.")) return;
                      store.cancelJob(job.id);
                    }}>{job.status === "running" ? "Stop" : "Cancel"}</button>
                  ) : null}
                </div>
                {job.error ? <p>{job.error}</p> : null}
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="timeline-workspace premium-panel">
        <div className="timeline-toolbar">
          <div className="tool-group">
            <button className="tool active" title="Selection tool">➤</button>
            <button className="tool" title="Marquee selection">□</button>
            <button className="tool" title="Split at playhead">✂</button>
            <button className="tool" title="Hand tool">✋</button>
            <button className="tool" title="Zoom tool">⌕</button>
          </div>
          <div className="toolbar-divider" />
          <button className="button toolbar-button" onClick={() => store.setMarkIn()}>Mark In <small>{store.markInFrame == null ? "—" : timecode(store.markInFrame, fps)}</small></button>
          <button className="button toolbar-button" onClick={() => store.setMarkOut()}>Mark Out <small>{store.markOutFrame == null ? "—" : timecode(store.markOutFrame, fps)}</small></button>
          <button
            className="button primary render-button"
            disabled={!selectedClip || !store.health.comfy || !selectedClipGuidesApproved}
            onClick={() => selectedClip && store.renderSelection(selectedClip.id)}
          >
            Render Selection <span>⌄</span>
          </button>
          <button className="button secondary" disabled={!selectedClip || !store.health.comfy || !selectedClipGuidesApproved} onClick={() => selectedClip && store.renderDirty(selectedClip.id)}>Render Dirty</button>
          <button
            className="button secondary h3-toolbar-button"
            disabled={!h3CanRender}
            title={h3PrimaryIssue || "Queue MiniMax H3 video"}
            onClick={() => queueH3Selection()}
          >
            H3 Video
          </button>
          <span className="toolbar-spacer" />
          <span className="zoom-label">−</span>
          <input type="range" min={12} max={120} value={store.pxPerSec} onChange={(event) => store.setPxPerSec(Number(event.target.value))} />
          <span className="zoom-label">＋</span>
        </div>

        <div className="timeline-main">
          <div className="timeline-scroll">
            <div className="timeline-canvas" style={{ width: laneWidth + 118 }}>
              <div className="timeline-ruler track-row">
                <div className="track-label ruler-label">TIME</div>
                <div
                  className="track-lane"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    store.setPlayheadFrame(((event.clientX - rect.left) / store.pxPerSec) * fps);
                  }}
                >
                  {ticks.map((second) => (
                    <span key={second} className="timeline-tick" style={{ left: second * store.pxPerSec }}>
                      {timecode(second * fps, fps)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="track-row video-track">
                <div className="track-label"><span className="track-code">V1</span><b>VIDEO / SHOTS</b><i>◉</i><i>▣</i></div>
                <div className="track-lane">
                  {clips.map((clip: any) => (
                    <button
                      key={clip.id}
                      className={`video-clip-block ${store.selClipId === clip.id ? "selected" : ""} ${clip.status || ""}`}
                      style={{ left: clip.startSec * store.pxPerSec, width: Math.max(50, clip.durationSec * store.pxPerSec - 3) }}
                      onClick={(event) => {
                        event.stopPropagation();
                        store.setSelClip(clip.id);
                        store.setPlayheadFrame(clip.startFrame || Math.round(clip.startSec * fps));
                      }}
                    >
                      {clip.firstFrame?.file ? <img src={frameUrl(project.slug, clip.firstFrame.file)} alt="" /> : null}
                      <span><b>{clip.name}</b><small>{secondsLabel(clip.durationSec)}</small></span>
                      {clip.activeVersion ? <em>v{clip.activeVersion}</em> : null}
                      {clip.status === "dirty" || clip.status === "partial" ? <i className="dirty-dot" /> : null}
                      <i className="clip-resize" onPointerDown={(event) => beginClipResize(event, clip)} />
                    </button>
                  ))}
                  <div className="timeline-playhead" style={{ left: (store.playheadFrame / fps) * store.pxPerSec }} />
                </div>
              </div>

              <div className="track-row guide-track">
                <div className="track-label"><span className="track-code">G1</span><b>GUIDE IMAGES</b><i>◉</i><i>▣</i></div>
                <div className="track-lane">
                  {clips.flatMap((clip: any) => (clip.guides || []).map((guide: any) => {
                    const absoluteSecond = clip.startSec + guide.frame / fps;
                    const selected = store.selClipId === clip.id && store.selectedGuideId === guide.id;
                    return (
                      <button
                        key={guide.id}
                        className={`guide-pin ${roleClass(guide.role)} ${selected ? "selected" : ""}`}
                        style={{ left: absoluteSecond * store.pxPerSec - 15 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (store.selClipId !== clip.id) store.setSelClip(clip.id);
                          store.setSelectedGuide(guide.id);
                          store.setPlayheadFrame((clip.startFrame || Math.round(clip.startSec * fps)) + guide.frame);
                        }}
                        title={`${guide.role} guide · frame ${guide.frame}`}
                      >
                        <span>{roleLetter(guide.role)}{guide.role === "middle" ? (clip.guides.filter((g: any) => g.role === "middle").indexOf(guide) + 1) : ""}</span>
                        <img src={frameUrl(project.slug, guide.file)} alt="" />
                      </button>
                    );
                  }))}
                  <div className="timeline-playhead" style={{ left: (store.playheadFrame / fps) * store.pxPerSec }} />
                </div>
              </div>

              <div className="track-row prompt-track">
                <div className="track-label"><span className="track-code">P1</span><b>PROMPT RELAY</b><i>◉</i><i>▣</i></div>
                <div className="track-lane">
                  {clips.flatMap((clip: any) => clip.segments.map((segment: any, index: number) => {
                    const selected = store.selClipId === clip.id && store.selectedSegmentIds.includes(segment.id);
                    const left = (clip.startSec + segment.startFrame / fps) * store.pxPerSec;
                    const width = ((segment.endFrame - segment.startFrame) / fps) * store.pxPerSec;
                    return (
                      <button
                        key={segment.id}
                        className={`prompt-block ${selected ? "selected" : ""} ${segment.dirty !== false ? "dirty" : "clean"}`}
                        style={{ left, width: Math.max(22, width - 2) }}
                        onClick={(event) => clickSegment(event, clip, segment)}
                        title={segment.prompt || "Empty prompt segment"}
                      >
                        <em>{index + 1}</em>
                        <span>{segment.prompt || "Add action prompt…"}</span>
                      </button>
                    );
                  }))}
                  <div className="timeline-playhead" style={{ left: (store.playheadFrame / fps) * store.pxPerSec }} />
                </div>
              </div>

              <div className="track-row audio-track">
                <div className="track-label"><span className="track-code">A1</span><b>GENERATED AUDIO</b><i>◉</i><i>▣</i></div>
                <div className="track-lane audio-lane">
                  {clips.map((clip: any) => (
                    <div key={clip.id} className="audio-clip" style={{ left: clip.startSec * store.pxPerSec, width: Math.max(44, clip.durationSec * store.pxPerSec - 2) }}>
                      <Waveform density={Math.max(25, Math.round(clip.durationSec * 14))} variant="audio" />
                    </div>
                  ))}
                  <div className="timeline-playhead" style={{ left: (store.playheadFrame / fps) * store.pxPerSec }} />
                </div>
              </div>

              <div className="track-row music-track">
                <div className="track-label"><span className="track-code">M1</span><b>MUSIC SCORE</b><i>◉</i><i>▣</i></div>
                <div className="track-lane audio-lane">
                  {project.score?.enabled && totalDurationSec > 0 ? (
                    <div className="audio-clip music" style={{ left: 0, width: totalDurationSec * store.pxPerSec }}>
                      <Waveform density={Math.max(80, Math.round(totalDurationSec * 10))} variant="music" />
                      <span>Project Musical Score {activeScore ? `· v${activeScore.v}` : "· pending"}</span>
                      <i className="automation-line" />
                    </div>
                  ) : null}
                  <div className="timeline-playhead" style={{ left: (store.playheadFrame / fps) * store.pxPerSec }} />
                </div>
              </div>
            </div>
          </div>

          <aside className="timeline-tools">
            <h3>TIMELINE TOOLS</h3>
            <button><span>➤</span> Select</button>
            <button><span>□</span> Marquee Select</button>
            <button><span>✂</span> Split (S)</button>
            <button onClick={addSegment}><span>＋</span> Add Prompt (P)</button>
            <div className="selection-summary">
              <h4>SELECTION</h4>
              <dl>
                <div><dt>Start</dt><dd>{selectedStartFrame == null ? "—" : timecode(selectedStartFrame + selectedClipFrameOffset, fps)}</dd></div>
                <div><dt>End</dt><dd>{selectedEndFrame == null ? "—" : timecode(selectedEndFrame + selectedClipFrameOffset, fps)}</dd></div>
                <div><dt>Duration</dt><dd>{requestedFrames ? timecode(requestedFrames, fps) : "—"}</dd></div>
                <div><dt>Frames</dt><dd>{requestedFrames || 0} requested</dd></div>
                <div><dt>LTX output</dt><dd>{generationFrames || 0} frames</dd></div>
              </dl>
            </div>
            <div className={`h3-mini-panel ${h3ModeReady ? "ready" : "blocked"}`}>
              <div className="h3-mini-heading">
                <h4>MINIMAX H3 VIDEO</h4>
                <button className="mini-icon" title="Recheck MiniMax H3 video models and native nodes" onClick={() => store.refreshH3Diagnostics(true)}>↻</button>
              </div>
              <p>Video render only. First-frame stills come from Assets/Storyboard (Krea2 or Klein2).</p>
              <label>
                Mode
                <select value={store.h3Mode} onChange={(event) => store.setH3Mode(event.target.value as any)}>
                  <option value="t2v">Text to Video</option>
                  <option value="first_frame">Video from first-frame still</option>
                  <option value="last_frame">Video from last-frame still</option>
                  <option value="first_last">Video from first + last stills</option>
                  <option value="reference">Reference to Video</option>
                </select>
              </label>
              <div className="h3-reference-controls">
                <button className="button secondary" type="button" disabled={!selectedClip} onClick={() => setH3ReferencePickerOpen(true)}>Video refs <small>{h3ReferenceLabel}</small></button>
                {h3References.length ? <button className="mini-icon" title="Clear H3 video references" onClick={() => setH3References([])}>×</button> : null}
              </div>
              <dl>
                <div><dt>Backend</dt><dd>{store.h3Diagnostics?.comfyVersion ? `Comfy ${store.h3Diagnostics.comfyVersion}` : "Checking"}</dd></div>
                <div><dt>FL2VA</dt><dd>{store.h3Diagnostics?.fl2vaReady ? "Ready" : "Blocked"}</dd></div>
                <div><dt>Ref2VA</dt><dd>{store.h3Diagnostics?.ref2vaReady ? "Ready" : "Missing/blocked"}</dd></div>
                <div><dt>H3 raw</dt><dd>{h3ResolvedFrames ? `${h3ResolvedFrames}f · ${secondsLabel(h3RawSeconds)}` : "—"}</dd></div>
              </dl>
              {h3PrimaryIssue ? <p>{h3PrimaryIssue}</p> : <p>Ready: raw H3 MP4 is preserved, and an exact timeline copy is conformed after render.</p>}
              <button
                className="button secondary"
                disabled={!h3CanRender}
                onClick={() => queueH3Selection()}
              >
                {store.h3Busy ? "Queueing H3 video…" : "Queue H3 Video"}
              </button>
            </div>
            <div className="timeline-actions">
              <h4>ACTIONS</h4>
              <button className="button primary" disabled={!selectedClip || !store.health.comfy || !selectedClipGuidesApproved} onClick={() => selectedClip && store.renderSelection(selectedClip.id)}>Render Selection</button>
              <button className="button secondary" disabled={!selectedClip || !store.health.comfy || !selectedClipGuidesApproved} onClick={() => selectedClip && store.renderDirty(selectedClip.id)}>Render Dirty</button>
              <button className="button secondary" disabled={!h3CanRender} onClick={() => queueH3Selection()}>Queue H3 Video</button>
              <button className="button secondary" disabled={!selectedClip} onClick={() => selectedClip && store.assembleClip(selectedClip.id)}>Assemble Clip</button>
              <button className="button secondary" disabled={!selectedClip || !selectedFrameApproved} onClick={() => {
                 if (selectedClip && store.selFrameFile) store.attachGuide(selectedClip.id, { frameFile: store.selFrameFile, role: "first", frame: 0 });
              }}>Use Approved as First</button>
            </div>
          </aside>
        </div>

        <div className="timeline-legend">
          <span><i className="legend-box first">F</i> First</span>
          <span><i className="legend-box middle">K</i> Keyframe</span>
          <span><i className="legend-box last">L</i> Last</span>
          <span className="legend-help">Click: Select · Shift+Click: Range · Ctrl/Cmd+Click: Multi-select · I/O: Mark range · R: Render</span>
        </div>
      </section>

      <section className="workbench-grid">
        <article className={`workbench-card premium-panel ${store.activeWorkbench === "guide" ? "active" : ""}`} onClick={() => store.setWorkbench("guide")}>
          <div className="workbench-title"><span>1.</span><h3>GUIDE IMAGE CONTROLS</h3><small>{selectedClip?.guides?.length || 0} guides</small></div>
          {selectedClip ? (
            <div className="guide-control-layout">
              <div className="guide-preview-large">
                {selectedGuide?.file ? <img src={frameUrl(project.slug, selectedGuide.file)} alt="Guide" /> : sourceSrc ? <img src={sourceSrc} alt="Source" /> : <EmptyMonitor>No guide selected</EmptyMonitor>}
                <span className={`guide-role-large ${roleClass(selectedGuide?.role || "first")}`}>{roleLetter(selectedGuide?.role || "first")}</span>
              </div>
              <div className="guide-control-fields">
                <div className="inline-heading"><b>{selectedGuide ? `${selectedGuide.role[0].toUpperCase()}${selectedGuide.role.slice(1)} Guide` : "Create Guide"}</b><button>✎</button></div>
                <dl>
                  <div><dt>Frame</dt><dd>{selectedGuide?.frame ?? 0}</dd></div>
                  <div><dt>Source</dt><dd>{selectedGuide?.source || "Project bin"}</dd></div>
                  <div><dt>Strength</dt><dd>{Number(selectedGuide?.strength ?? guideDraft.strength).toFixed(2)}</dd></div>
                </dl>
                <label>Prompt</label>
                <textarea
                  rows={3}
                  value={selectedGuide?.prompt ?? guideDraft.prompt}
                  onChange={(event) => {
                    if (selectedGuide) {
                      const value = event.target.value;
                      store.patchLocal((next) => {
                        const clip = next.sequence.clips.find((item: any) => item.id === selectedClip.id);
                        const guide = clip?.guides?.find((item: any) => item.id === selectedGuide.id);
                        if (guide) guide.prompt = value;
                      });
                    } else setGuideDraft({ ...guideDraft, prompt: event.target.value });
                  }}
                  onBlur={() => selectedGuide && store.patchGuide(selectedClip.id, selectedGuide.id, { prompt: store.project.sequence.clips.find((item: any) => item.id === selectedClip.id)?.guides.find((item: any) => item.id === selectedGuide.id)?.prompt })}
                />
                <div className="guide-version-strip">
                  {(selectedClip.guides || []).map((guide: any) => (
                    <button key={guide.id} className={store.selectedGuideId === guide.id ? "selected" : ""} onClick={(event) => { event.stopPropagation(); store.setSelectedGuide(guide.id); }}>
                      <img src={frameUrl(project.slug, guide.file)} alt="" />
                      <span className={roleClass(guide.role)}>{roleLetter(guide.role)}</span>
                    </button>
                  ))}
                  <button type="button" className="new-guide" data-testid="edt-001-new-guide" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "generate", slotState: "missing", returnFocusId: "edt-001-new-guide" }); }}>＋<small>Generate guide</small></button>
                </div>
              </div>
            </div>
          ) : <div className="workbench-empty" data-testid="nav-006-empty"><p>Add or select a clip to manage guide images.</p><nav className="nav-006-empty-actions" aria-label="Empty edit slot"><button type="button" className="button primary" data-testid="nav-006-generate" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "generate", slotState: "missing", returnFocusId: "nav-006-generate" }); }}>Generate</button><button type="button" className="button secondary" data-testid="nav-006-upload" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "upload", slotState: "missing", returnFocusId: "nav-006-upload" }); }}>Upload</button><button type="button" className="button secondary" data-testid="nav-006-choose" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "choose", slotState: "missing", returnFocusId: "nav-006-choose" }); }}>Choose existing</button></nav></div>}
          <div className="card-actions">
            <button type="button" className="button secondary" data-testid="edt-001-generate-guide" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "generate", slotState: selectedGuide ? "unapproved" : "missing", returnFocusId: "edt-001-generate-guide" }); }}>Generate guide</button>
            <button type="button" className="button secondary" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "choose", slotState: "missing" }); }}>Choose existing</button>
            <button className="button secondary" disabled={!selectedClip || !selectedFrameApproved} onClick={(event) => { event.stopPropagation(); if (selectedClip && store.selFrameFile) store.attachGuide(selectedClip.id, { frameFile: store.selFrameFile, role: selectedGuide?.role || "middle", frame: selectedGuide?.frame || guideDraft.frame }); }}>Use approved</button>
            <button className="button danger icon-only" disabled={!selectedClip || !selectedGuide} onClick={(event) => { event.stopPropagation(); if (selectedClip && selectedGuide) store.deleteGuide(selectedClip.id, selectedGuide.id); }}>⌫</button>
          </div>
        </article>

        <article className={`workbench-card premium-panel ${store.activeWorkbench === "prompt" ? "active" : ""}`} onClick={() => store.setWorkbench("prompt")}>
          <div className="workbench-title"><span>2.</span><h3>ASSET + PROMPT PLACEMENT</h3><small>{selectedSegments.length ? `${selectedSegments.length} selected` : "Approved guide placement"}</small></div>
          <div className="generation-layout">
            <div className="generation-preview">
              {sourceSrc ? <img src={sourceSrc} alt="Generation reference" /> : <EmptyMonitor>Select a reference image</EmptyMonitor>}
              <span className={`generation-role ${roleClass(guideDraft.role)}`}>{roleLetter(guideDraft.role)}</span>
              {isShorts ? (
                <>
                  <button className="upload-tile" onClick={(event) => { event.stopPropagation(); shortsFrameRef.current?.click(); }} title="Import a still into this shorts project"><span>▣</span>Import still</button>
                  <input ref={shortsFrameRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void store.importFrame(file); event.target.value = ""; }} />
                </>
              ) : (
                <button type="button" className="upload-tile" data-testid="edt-001-create-guide" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "generate", slotState: "missing", returnFocusId: "edt-001-create-guide" }); }} title="Generate or choose a guide for this clip"><span>▣</span>Generate guide</button>
              )}
            </div>
            <div className="generation-fields">
              <div className="field-row">
                <label>Role<select value={guideDraft.role} onChange={(event) => setGuideDraft({ ...guideDraft, role: event.target.value })}><option value="first">First Frame</option><option value="middle">Middle Keyframe</option><option value="last">Last Frame</option></select></label>
                <label>At Frame<input type="number" min={0} value={guideDraft.frame} onChange={(event) => setGuideDraft({ ...guideDraft, frame: Number(event.target.value) })} /></label>
              </div>
              <label>Image prompt<textarea rows={3} value={guideDraft.prompt} onChange={(event) => setGuideDraft({ ...guideDraft, prompt: event.target.value })} /></label>
              <div className="field-row compact-fields">
                <label>Seed<input type="number" value={guideDraft.seed} onChange={(event) => setGuideDraft({ ...guideDraft, seed: Number(event.target.value) })} /></label>
                <label>Strength<div className="range-with-value"><input type="range" min={0} max={1} step={0.01} value={guideDraft.strength} onChange={(event) => setGuideDraft({ ...guideDraft, strength: Number(event.target.value) })} /><span>{guideDraft.strength.toFixed(2)}</span></div></label>
              </div>
              {selectedSegments.length ? (
                <div className="prompt-edit-stack">
                  {selectedSegments.slice(0, 3).map((segment: any, index: number) => (
                    <label key={segment.id}>Segment {index + 1}<textarea rows={2} value={segment.prompt || ""} onChange={(event) => patchSegmentPrompt(selectedClip.id, segment.id, event.target.value)} onBlur={commitClipSegments} /></label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="card-actions right">
            <button className="button secondary" disabled={!selectedClip || !selectedFrameApproved} onClick={(event) => { event.stopPropagation(); if (selectedClip && store.selFrameFile) store.attachGuide(selectedClip.id, { frameFile: store.selFrameFile, ...guideDraft }); }}>Attach approved</button>
            <button type="button" className="button primary" data-testid="nav-007-create" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceEntity: { type: "sequence", id: selectedClip?.id || "edit", label: selectedClip?.name || "Guide" }, requirement: { relationship: "edit.guide", category: "guide-frame", expectedMediaType: "image" }, initialAction: "generate", slotState: "missing", returnFocusId: "nav-007-create" }); }}>Generate here</button>
          </div>
        </article>

        <article className={`workbench-card premium-panel ${store.activeWorkbench === "score" ? "active" : ""}`} onClick={() => store.setWorkbench("score")}>
          <div className="workbench-title"><span>3.</span><h3>MUSIC SCORE PANEL</h3><label className="switch-label">ON<input type="checkbox" checked={project.score?.enabled !== false} onChange={(event) => store.updateScoreLocal({ enabled: event.target.checked })} /><i /></label></div>
          <div className="score-grid">
            <div className="score-left">
              <label>Mode<select value={project.score?.mode || "generate"} onChange={(event) => store.updateScoreLocal({ mode: event.target.value })}><option value="generate">Generate</option><option value="upload">Upload</option><option value="none">None</option></select></label>
              <label>Prompt<textarea rows={3} value={project.score?.prompt || ""} onChange={(event) => store.updateScoreLocal({ prompt: event.target.value })} onBlur={() => store.saveProject()} /></label>
              <label>Duration<input value={timecode(totalFrames, fps)} readOnly /></label>
              <div className="field-row">
                <label>Genre<select value={project.score?.genre || "Cinematic / Orchestral"} onChange={(event) => store.updateScoreLocal({ genre: event.target.value })}><option>Cinematic / Orchestral</option><option>Ambient</option><option>Choral</option><option>Minimal Piano</option></select></label>
                <label>Mood<select value={project.score?.mood || "Reverent / Epic"} onChange={(event) => store.updateScoreLocal({ mood: event.target.value })}><option>Reverent / Epic</option><option>Dark / Tense</option><option>Hopeful / Uplifting</option><option>Intimate / Reflective</option></select></label>
              </div>
            </div>
            <div className="score-right">
              <div className="score-toggle"><span>Instrumental only</span><button className={project.score?.instrumentalOnly !== false ? "on" : ""} onClick={() => store.updateScoreLocal({ instrumentalOnly: project.score?.instrumentalOnly === false })}><i /></button></div>
              <label>Tempo <span>{project.score?.tempo || 96} BPM</span><input type="range" min={50} max={160} value={project.score?.tempo || 96} onChange={(event) => store.updateScoreLocal({ tempo: Number(event.target.value) })} /></label>
              <label>Intensity curve</label>
              <div className="intensity-curve"><svg viewBox="0 0 280 70" preserveAspectRatio="none"><path d="M0 58 C38 50 54 20 89 29 S142 51 176 37 S230 15 280 6" /><circle cx="0" cy="58" r="4" /><circle cx="89" cy="29" r="4" /><circle cx="176" cy="37" r="4" /><circle cx="280" cy="6" r="4" /></svg></div>
              <div className="field-row compact-fields"><label>Fade in<input type="number" min={0} step={0.5} value={project.score?.fadeInSec || 0} onChange={(event) => store.updateScoreLocal({ fadeInSec: Number(event.target.value) })} /></label><label>Fade out<input type="number" min={0} step={0.5} value={project.score?.fadeOutSec || 0} onChange={(event) => store.updateScoreLocal({ fadeOutSec: Number(event.target.value) })} /></label></div>
              <label>Music level <span>{project.score?.musicLevelDb || -18} dB</span><input type="range" min={-36} max={0} value={project.score?.musicLevelDb || -18} onChange={(event) => store.updateScoreLocal({ musicLevelDb: Number(event.target.value) })} /></label>
              <div className="score-toggle"><span>Duck under dialogue</span><button className={project.score?.duckUnderDialogue !== false ? "on" : ""} onClick={() => store.updateScoreLocal({ duckUnderDialogue: project.score?.duckUnderDialogue === false })}><i /></button></div>
            </div>
          </div>
          <div className="score-wave-preview"><Waveform density={120} variant="music" /><span>{activeScore ? `Active score v${activeScore.v} · ${activeScore.source}` : "Score preview appears after generation"}</span></div>
          <div className="card-actions right">
            <button className="button secondary" onClick={(event) => { event.stopPropagation(); scoreUploadRef.current?.click(); }}>Upload Score</button>
            <button className="button primary" disabled={!store.health.ffmpeg || !clips.length} onClick={(event) => { event.stopPropagation(); store.generateScore(); }}>Generate Score</button>
            <button type="button" className="button secondary" data-testid="mst-001-score" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceRoute: "/master", sourceEntity: { type: "master", id: "master", label: "Master score" }, requirement: { relationship: "master.score", category: "music", expectedMediaType: "audio" }, initialAction: activeScore ? "review" : "generate", slotState: activeScore ? "unapproved" : "missing", returnFocusId: "mst-001-score" }); }}>{activeScore ? "Review score" : "Resolve missing score"}</button>
          </div>
          <input ref={scoreUploadRef} type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) store.uploadScore(file); event.target.value = ""; }} />
        </article>

        <article className={`workbench-card premium-panel ${store.activeWorkbench === "master" ? "active" : ""}`} onClick={() => store.setWorkbench("master")}>
          <div className="workbench-title"><span>4.</span><h3>MASTER / EXPORT VIEW</h3><small>{project.masters?.length || 0} versions</small></div>
          <div className="master-preview">
            {masterSrc ? (
              <video ref={masterVideoRef} key={masterSrc} src={masterSrc} controls />
            ) : sourceSrc ? (
              <div className="master-poster"><img src={sourceSrc} alt="Master poster" /><button onClick={(event) => { event.stopPropagation(); store.buildMaster(); }}>▶</button></div>
            ) : <EmptyMonitor>Build a master after rendering clips.</EmptyMonitor>}
          </div>
          <div className="master-time-row"><b>{timecode(0, fps)}</b><span>{activeMaster ? timecode(Math.round(activeMaster.durationSec * fps), fps) : timecode(plannedMasterFrames, fps)}</span></div>
          <div className="master-details">
            <div className="master-bookends">
              <div className="master-bookends-heading"><h4>MASTER BOOKENDS</h4><small>STITCH ONLY · +{plannedBookendDurationSec}s</small></div>
              <label className="bookend-row">
                <input type="checkbox" checked={openingEnabled} onChange={(event) => { store.updateBookendsLocal({ opening: { enabled: event.target.checked } }); store.saveProject(); }} />
                <span><b>30s opening slate</b><code>🔒 {MASTER_OPENING_TITLE}</code></span>
              </label>
              <label className="bookend-row">
                <input type="checkbox" checked={creditsEnabled} onChange={(event) => { store.updateBookendsLocal({ credits: { enabled: event.target.checked } }); store.saveProject(); }} />
                <span><b>30s end credits</b><small>Editable deterministic copy</small></span>
              </label>
              <textarea aria-label="End credits copy" rows={4} value={creditsText} onChange={(event) => store.updateBookendsLocal({ credits: { text: event.target.value } })} onBlur={() => store.saveProject()} />
              <p className={bookendsNeedRebuild ? "bookend-rebuild-notice" : ""}>{bookendsNeedRebuild ? "Current bookends differ from the active export · rebuild to apply." : "Deterministic typography · no AI generation · appended only to Final Master."}</p>
            </div>
            <div><h4>MASTER INFO</h4><dl><div><dt>Resolution</dt><dd>{project.settings.width}×{project.settings.height}</dd></div><div><dt>FPS</dt><dd>{fps}</dd></div><div><dt>Duration</dt><dd>{activeMaster ? timecode(Math.round(activeMaster.durationSec * fps), fps) : timecode(plannedMasterFrames, fps)}</dd></div><div><dt>Bookends</dt><dd>{activeMasterBookendLabel}</dd></div><div><dt>Audio</dt><dd>48 kHz / Stereo</dd></div></dl></div>
            <div><h4>EXPORT PRESET</h4><select><option>H.264 (MP4)</option><option>ProRes 422</option><option>WebM</option></select><div className="master-actions">{activeMaster ? <a className="button secondary export-link" href={masterUrl(project.slug, activeMaster.file)} download>Export Master</a> : null}<button className="button primary" disabled={!store.health.ffmpeg || !clips.length} onClick={(event) => { event.stopPropagation(); store.buildMaster(); }}>{activeMaster ? "Rebuild Final Master" : "Build Final Master"}</button>
              <button type="button" className="button secondary" data-testid="mst-001-resolve" onClick={(event) => { event.stopPropagation(); openCreativeSlot({ sourceRoute: "/master", sourceEntity: { type: "master", id: "master", label: "Master" }, requirement: { relationship: activeScore ? "master.program" : "master.score", category: activeScore ? "video" : "music", expectedMediaType: activeScore ? "video" : "audio" }, initialAction: activeMaster ? "review" : "generate", slotState: activeMaster ? "unapproved" : "missing", returnFocusId: "mst-001-resolve" }); }}>{activeMaster ? "Review master" : "Resolve master"}</button>
              <button type="button" className="button secondary" data-testid="exp-001-blocker" onClick={(event) => { event.stopPropagation(); const relationship = !activeMaster ? "export.master" : !activeScore ? "master.score" : !store.health.comfy ? "export.comfy" : "export.blocker"; openCreativeSlot({ sourceRoute: "/export", sourceEntity: { type: "export-blocker", id: relationship, label: !activeMaster ? "Missing master" : !activeScore ? "Missing score" : !store.health.comfy ? "ComfyUI offline" : "Export ready" }, requirement: { relationship, category: relationship === "master.score" ? "music" : "video", expectedMediaType: relationship === "master.score" ? "audio" : "video" }, initialAction: !store.health.comfy ? "choose" : "generate", slotState: activeMaster && activeScore && store.health.comfy ? "approved" : "missing", returnFocusId: "exp-001-blocker" }); }}>Resolve export blocker</button>
              <button type="button" className="button secondary" data-testid="exp-002-recheck" onClick={(event) => { event.stopPropagation(); const ready = Boolean(activeMaster && activeScore && store.health.comfy); openCreativeSlot({ sourceRoute: "/export", sourceEntity: { type: "export-blocker", id: "export-recheck", label: ready ? "Export ready" : "Recheck blockers" }, requirement: { relationship: ready ? "export.ready" : "export.blocker", category: "video", expectedMediaType: "video" }, initialAction: ready ? "review" : "generate", slotState: ready ? "approved" : "broken", returnFocusId: "exp-002-recheck" }); }}>Recheck blockers</button>
            </div></div>
          </div>
        </article>
      </section>

      <section className="generation-pipeline premium-panel">
        <div className="pipeline-title"><h3>GENERATION WORKFLOW</h3><small>ComfyUI + FFmpeg orchestration</small></div>
        {[
          ["1", "Select / Dirty", "Choose segments to render", selectedSegments.length ? "active" : "done"],
          ["2", "Render Ranges", "Generate selected ranges", runningJobs.some((job: any) => job.type === "render_range") ? "active" : ""],
          ["3", "Assemble Clips", "Build clips from active versions", clips.every((clip: any) => clip.activeVersion) && clips.length ? "done" : ""],
          ["4", "Stitch Sequence", "Create full master", activeMaster ? "done" : ""],
          ["5", "Generate Score", "Match exact master duration", activeScore ? "done" : ""],
          ["6", "Mix & Finalize", "Duck music under dialogue", activeMaster?.scoreVersion ? "done" : ""],
          ["7", "Export", "Final production file", activeMaster ? "active" : ""]
        ].map((step, index, array) => (
          <React.Fragment key={step[0]}>
            <button className={`pipeline-step ${step[3]}`} onClick={() => index < 2 ? store.setWorkbench("prompt") : index < 4 ? store.setWorkbench("master") : store.setWorkbench("score")}>
              <span>{step[0]}</span><div><b>{step[1]}</b><small>{step[2]}</small></div>{step[3] === "done" ? <em>✓</em> : null}
            </button>
            {index < array.length - 1 ? <i className="pipeline-arrow">→</i> : null}
          </React.Fragment>
        ))}
        <aside className="system-status">
          <h4>SYSTEM STATUS</h4>
          <span className={store.health.comfy ? "good" : "bad"}><i /> ComfyUI <b>{store.health.comfy ? (store.health.capabilities?.dedicatedComfyUI ? "Dedicated · 8190" : "Connected") : "Offline"}</b></span>
          <span className={store.h3Diagnostics?.fl2vaReady ? "good" : "bad"}><i /> MiniMax H3 Video <b>{store.h3Diagnostics?.fl2vaReady ? "FL2VA Ready" : store.h3Diagnostics?.comfyVersion ? `Needs 0.30+ · ${store.h3Diagnostics.comfyVersion}` : "Checking"}</b></span>
          <span className={runningJobs.length ? "working" : "good"}><i /> Queue <b>{runningJobs.length ? `${runningJobs.length} Active` : "Idle"}</b></span>
          <span className={store.health.ffmpeg ? "good" : "bad"}><i /> FFmpeg <b>{store.health.ffmpeg ? "Ready" : "Missing"}</b></span>
          <button
            className="system-restart-button"
            type="button"
            disabled={!store.health.capabilities?.dedicatedComfyRestart || store.comfyRestartBusy || store.health.comfyRestarting || Boolean(runningJobs.length)}
            title={runningJobs.length ? "Finish or stop active generation jobs before restarting ComfyUI." : "Safely restart Premiere316's dedicated ComfyUI on port 8190."}
            onClick={(event) => {
              event.stopPropagation();
              if (window.confirm("Restart the dedicated ComfyUI engine on port 8190? The button is safe only while the generation queue is idle.")) store.restartComfyUI();
            }}
          >
            {store.comfyRestartBusy || store.health.comfyRestarting ? "RESTARTING…" : "↻ RESTART COMFYUI"}
          </button>
        </aside>
      </section>
      {h3ReferencePickerOpen ? (
        <AssetReferencePicker
          project={project}
          targetLabel={selectedClip?.name || "MiniMax H3 video"}
          targetId={selectedClip?.id}
          targetKind="h3"
          initialReferences={h3References}
          saving={false}
          maxReferences={12}
          eyebrow="MINIMAX H3 VIDEO REFS"
          title="Condition H3 video with existing stills"
          description={`${selectedClip?.name || "Selected clip"} · pick up to 12 approved stills to condition MiniMax H3 video. First-frame stills come from Assets/Storyboard (Krea2 or Klein2).`}
          sourceRoute="/edit"
          relationship="edit.h3ImageReference"
          emptyCategory="character"
          onCancel={() => setH3ReferencePickerOpen(false)}
          onApply={async (references) => { setH3References(references); }}
        />
      ) : null}
    </main>
  );
}
