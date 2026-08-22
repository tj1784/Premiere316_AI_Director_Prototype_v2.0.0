import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dialogueCueProgress,
  dialogueCuesForClip,
  dialogueCuesForSegment,
  dialogueCuesFromSound,
  dialogueCueStatus
} from "../dialogue-cues";
import { useStore } from "../store";
import { openAssetAction } from "../contextual-agency";

function openWorkspaceRoute(path) {
  const params = new URLSearchParams(window.location.search);
  window.history.pushState({}, "", `${path}${params.size ? `?${params}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function openLtxSlot(intent) {
  openAssetAction({
    sourceRoute: "/ltx",
    ...intent
  });
}

function openCueWorkspace(path, cue, focusId) {
  const params = new URLSearchParams(window.location.search);
  const cueId = String(cue?.cueId || "").trim();
  if (cueId) params.set("cue", cueId);
  if (focusId) params.set("returnFocusId", focusId);
  const hash = cueId ? `#cue-${encodeURIComponent(cueId)}` : "";
  window.history.pushState({}, "", `${path}${params.size ? `?${params}` : ""}${hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function ltxDialogueCueIntent(cue, initialAction, returnFocusId) {
  const cueId = String(cue?.cueId || "").trim();
  return {
    sourceEntity: {
      type: "segment",
      id: cueId || String(cue?.segmentId || "ltx-cue"),
      label: `${cueId} · ${cue?.speaker || "cue"}`
    },
    requirement: {
      relationship: "ltx.dialogueCue",
      category: "dialogue",
      expectedMediaType: "audio",
      expectedVariant: cueId
    },
    initialAction,
    slotState: dialogueCueStatus(cue) === "ready" ? "unapproved" : "missing",
    returnFocusId,
    prefill: {
      name: cue?.speaker,
      sampleText: cue?.exactDialogue,
      prompt: cue?.performanceDirection
    }
  };
}

function LtxCueActions({ cue, focusPrefix }: { cue: any; focusPrefix: string }) {
  const cueId = String(cue?.cueId || "").trim();
  const focusId = `${focusPrefix}-${cueId}`;
  return (
    <nav className="ltx-001-cue-actions" aria-label={`${cueId} voice actions`} data-testid={`${focusPrefix}-actions-${cueId}`}>
      <button type="button" id={focusId} className="button secondary" onClick={() => openLtxSlot(ltxDialogueCueIntent(cue, "generate", focusId))}>Generate voice</button>
      <button type="button" className="button secondary" onClick={() => openLtxSlot(ltxDialogueCueIntent(cue, "upload", focusId))}>Upload voice</button>
      <button type="button" className="button secondary" onClick={() => openLtxSlot(ltxDialogueCueIntent(cue, "choose", focusId))}>Assign voice</button>
      <button type="button" className="button secondary" onClick={() => openCueWorkspace("/sound", cue, focusId)}>Open Create Sound</button>
      <button type="button" className="button secondary" onClick={() => openCueWorkspace("/assets/characters", cue, focusId)}>Open Character Bible</button>
    </nav>
  );
}

import AssetReferencePicker from "./AssetReferencePicker";
import {
  LTX25_PREMIERE316_PROFILE,
  activeTakeOf,
  firstPlayablePreviewIndex,
  isSegmentedI2vWorkspace,
  isVisualGenerationSegment,
  ltx25FramePlan,
  segmentNeighborState,
  segmentedI2vQueueReady,
  semanticConditioningState,
  semanticReferenceState,
  semanticT2vLockedForWorkspace,
  temporalGuideState,
  visibleGenerateOptions
} from "../ltx-director-state";

async function integrationApi(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/integrations/ltx${path}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || response.statusText || "LTX Director request failed");
  return json;
}

function trackSegments(workspace: any, key: "segments" | "audioSegments" | "motionSegments") {
  return workspace?.timeline?.[key] || [];
}

function durationFrames(workspace: any) {
  const reported = Number(workspace?.stats?.durationFrames) || 0;
  const calculated = Math.max(1, ...["segments", "audioSegments", "motionSegments"].flatMap((key) => trackSegments(workspace, key as any).map((segment: any) => (Number(segment.start) || 0) + (Number(segment.length) || 1))));
  return Math.max(1, reported, calculated);
}

function mediaPreviewUrl(projectSlug: string, segment: any) {
  if (segment?.projectMediaPath) {
    return `/api/integrations/ltx/director/premiere/media/${encodeURIComponent(projectSlug)}?file=${encodeURIComponent(segment.projectMediaPath)}`;
  }
  const file = segment?.imageFile || segment?.videoFile;
  return file ? `/api/integrations/ltx/director/media?file=${encodeURIComponent(file)}` : "";
}

function semanticPreviewUrl(projectSlug: string, reference: any) {
  const supplied = String(reference?.previewUrl || "");
  if (supplied.startsWith("/api/premiere/")) {
    return `/api/integrations/ltx/director${supplied.slice(4)}`;
  }
  if (reference?.file) {
    return `/api/integrations/ltx/director/premiere/media/${encodeURIComponent(projectSlug)}?file=${encodeURIComponent(reference.file)}`;
  }
  return "";
}

function isVideoReference(reference: any) {
  return reference?.type === "video"
    || reference?.mediaType === "video"
    || /\.(mp4|mov|mkv|webm|avi|m4v)(?:$|\?)/i.test(String(reference?.fileName || reference?.file || reference?.videoFile || ""));
}

function ReferenceMedia({ src, reference, alt }: { src: string; reference: any; alt: string }) {
  if (!src) return <span aria-hidden="true">◇</span>;
  return isVideoReference(reference)
    ? <video src={src} muted playsInline preload="metadata" aria-label={alt} />
    : <img src={src} alt={alt} loading="lazy" />;
}


function takePreviewUrl(projectSlug: string, take: any) {
  const file = take?.previewFile || take?.file || take?.generatedInputPath || "";
  return file ? `/api/integrations/ltx/director/premiere/media/${encodeURIComponent(projectSlug)}?file=${encodeURIComponent(file)}` : "";
}

function segmentTakes(segment: any) {
  return Array.isArray(segment?.generatedTakes) ? segment.generatedTakes.filter(Boolean) : [];
}

function previewPlaylist(workspace: any, projectSlug: string) {
  return (workspace?.timeline?.segments || [])
    .filter((segment: any) => [undefined, "image", "video"].includes(segment?.type) && (Number(segment.length) || 0) > 0)
    .slice()
    .sort((left: any, right: any) => (Number(left.start) || 0) - (Number(right.start) || 0))
    .map((segment: any) => {
      const take = activeTakeOf(segment);
      return {
        segmentId: segment.id,
        fileName: segment.fileName || segment.id,
        start: Number(segment.start) || 0,
        length: Math.max(1, Number(segment.length) || 1),
        take,
        url: take ? takePreviewUrl(projectSlug, take) : ""
      };
    });
}

function roleLabel(value: string) {
  return String(value || "semantic reference").replaceAll("_", " ");
}


function AssembledPreviewPlayer({
  playlist,
  fps,
  playheadFrame,
  playing,
  previewIndex,
  onPlayhead,
  onPlayingChange,
  onPreviewIndex,
  onSelectSegment
}: {
  playlist: any[];
  fps: number;
  playheadFrame: number;
  playing: boolean;
  previewIndex: number;
  onPlayhead: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onPreviewIndex: (index: number) => void;
  onSelectSegment: (segmentId: string, frame: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playable = playlist.map((item, index) => ({ ...item, index })).filter((item) => item.url);
  const current = (playlist[previewIndex]?.url ? playlist[previewIndex] : null) || playable[0] || playlist[previewIndex] || null;
  const currentPlayableIndex = playable.findIndex((item) => item.segmentId === current?.segmentId);
  const totalFrames = Math.max(1, ...playlist.map((item) => (Number(item.start) || 0) + (Number(item.length) || 1)));
  const authoredSeconds = Math.max(1, Number(current?.length) || 1) / Math.max(1, fps);
  // LTX writes one extra decode frame; last 2–3 authored frames are often black.
  const playableSeconds = Math.max(1 / Math.max(1, fps), authoredSeconds - (3 / Math.max(1, fps)));

  const advance = () => {
    const nextItem = playable[currentPlayableIndex + 1];
    if (!nextItem) {
      onPlayingChange(false);
      return;
    }
    onPreviewIndex(nextItem.index);
    onPlayhead(nextItem.start);
    onSelectSegment(nextItem.segmentId, nextItem.start);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current?.url) return;
    video.muted = true;
    video.volume = 0;
    if (playing) {
      void video.play().catch(() => onPlayingChange(false));
    } else {
      video.pause();
    }
  }, [playing, current?.url, previewIndex]);

  const seekFromPlayhead = () => {
    const video = videoRef.current;
    if (!video || !current) return;
    const offset = Math.max(0, (Number(playheadFrame) || 0) - (Number(current.start) || 0));
    const seconds = Math.min(playableSeconds - 1 / Math.max(1, fps), offset / Math.max(1, fps));
    if (Math.abs((video.currentTime || 0) - seconds) > 0.05) video.currentTime = seconds;
  };

  useEffect(() => {
    if (!playing) seekFromPlayhead();
  }, [playheadFrame, previewIndex, playing]);

  if (!playlist.length) {
    return <div className="ltx-preview-player empty"><p>No authored segments to preview.</p></div>;
  }

  return (
    <div className="ltx-preview-player">
      <div className="ltx-preview-stage">
        {current?.url ? (
          <video
            ref={videoRef}
            key={current.url}
            src={current.url}
            playsInline
            controls={false}
            muted
            onLoadedMetadata={(event) => { event.currentTarget.muted = true; event.currentTarget.volume = 0; }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime || 0;
              if (time >= playableSeconds) {
                advance();
                return;
              }
              const frame = (Number(current.start) || 0) + Math.round(time * fps);
              onPlayhead(Math.min((Number(current.start) || 0) + (Number(current.length) || 1) - 1, frame));
            }}
            onEnded={advance}
          />
        ) : (
          <div className="ltx-preview-placeholder">
            <b>{current?.fileName || "No active take"}</b>
            <small>This segment has no active take yet. Playback skips it.</small>
          </div>
        )}
      </div>
      <div className="ltx-preview-transport">
        <button type="button" className="button secondary" onClick={() => onPlayingChange(!playing)}>{playing ? "Pause" : "Play"}</button>
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={Math.max(0, Math.min(totalFrames - 1, Number(playheadFrame) || 0))}
          onChange={(event) => {
            const frame = Number(event.target.value) || 0;
            const item = playlist.find((entry) => frame >= (Number(entry.start) || 0) && frame < (Number(entry.start) || 0) + (Number(entry.length) || 1)) || playlist[playlist.length - 1];
            if (item) {
              onPreviewIndex(playlist.indexOf(item));
              onSelectSegment(item.segmentId, frame);
            }
            onPlayhead(frame);
            onPlayingChange(false);
          }}
        />
        <small>{current ? `${current.fileName} · take ${current.take?.id || "none"}` : "No clip"} · {playable.length}/{playlist.length} takes ready</small>
      </div>
    </div>
  );
}

export default function LtxDirectorWorkspace() {
  const project = useStore((state) => state.project)!;
  const productionClipId = useStore((state) => state.productionClipId);
  const jobs = useStore((state) => state.jobs);
  const setSelectedStoryboardClip = useStore((state) => state.setSelectedStoryboardClip);
  const reloadProject = useStore((state) => state.reloadProject);
  const replaceStoryboardReferences = useStore((state) => state.replaceStoryboardReferences);
  const storyboardSaving = useStore((state) => state.storyboardSaving);
  const [workspace, setWorkspace] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [referenceResponse, setReferenceResponse] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [notice, setNotice] = useState("Starting the repository LTX Director service…");
  const [busy, setBusy] = useState<string | null>(null);
  const [sceneChoice, setSceneChoice] = useState(productionClipId || "");
  const [editRevision, setEditRevision] = useState(0);
  const [referenceTab, setReferenceTab] = useState<"inputs" | "library">("inputs");
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [timelinePreview, setTimelinePreview] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [globalPromptScope, setGlobalPromptScope] = useState<"clip" | "scene" | "chapter" | "project">("clip");
  const [workflowPanel, setWorkflowPanel] = useState(true);
  const [aaaWorkflow, setAaaWorkflow] = useState<any>(null);
  const [workflowLibrary, setWorkflowLibrary] = useState<any[]>([]);
  const [workflowQuery, setWorkflowQuery] = useState("");
  const [dialogueCueSound, setDialogueCueSound] = useState<any>(project.sound || {});
  const [dialogueCueError, setDialogueCueError] = useState("");

  const refreshHealth = useCallback(async () => {
    try {
      const result = await integrationApi("/director/health");
      setHealth(result);
    } catch {
      setHealth(null);
    }
  }, []);

  const refreshDiagnostics = useCallback(async (clipId: string, segmentId?: string | null) => {
    if (!clipId) {
      setReferenceResponse(null);
      setPreflight(null);
      setDiagnosticError("");
      return;
    }
    setDiagnosticsBusy(true);
    const preflightQuery = segmentId ? `?segmentId=${encodeURIComponent(segmentId)}` : "";
    const [referencesResult, preflightResult] = await Promise.allSettled([
      integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(clipId)}/references`),
      integrationApi(`/director/preflight${preflightQuery}`)
    ]);
    if (referencesResult.status === "fulfilled") setReferenceResponse(referencesResult.value);
    else setReferenceResponse(null);
    if (preflightResult.status === "fulfilled") setPreflight(preflightResult.value);
    else setPreflight(null);
    const errors = [referencesResult, preflightResult]
      .filter((result) => result.status === "rejected")
      .map((result: any) => String(result.reason?.message || result.reason));
    setDiagnosticError(errors.join(" · "));
    setDiagnosticsBusy(false);
  }, [project.slug]);

  const loadWorkspace = useCallback(async () => {
    const [workspaceResult, projectResult] = await Promise.all([
      integrationApi("/director/workspace"),
      integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}`)
    ]);
    const clips = projectResult.storyboard?.clips || [];
    const sharedClip = useStore.getState().productionClipId;
    const sharedChoice = clips.find((clip: any) => clip.id === sharedClip)?.id || null;
    const currentChoice = workspaceResult.workspace?.premiere?.projectSlug === project.slug
      ? clips.find((clip: any) => clip.id === workspaceResult.workspace?.premiere?.clipId)?.id || null
      : null;
    const preferred = sharedChoice || currentChoice || clips[0]?.id || "";
    const preferredClip = clips.find((clip: any) => clip.id === preferred) || null;
    let nextWorkspace = workspaceResult.workspace;
    let nextOverview = projectResult;
    const boundSame = nextWorkspace?.premiere?.projectSlug === project.slug && nextWorkspace?.premiere?.clipId === preferred;
    const staleBound = Boolean(preferredClip) && boundSame && (
      (preferredClip.planFingerprint && nextWorkspace?.premiere?.planFingerprint && preferredClip.planFingerprint !== nextWorkspace.premiere.planFingerprint)
      || Number(preferredClip.durationFrames) !== Number(nextWorkspace?.stats?.durationFrames)
      || Number(preferredClip.durationFrames) !== Number(nextWorkspace?.timeline?.normalDurationFrames)
    );
    if (preferred && (!boundSame || staleBound)) {
      const loaded = await integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}/load`, {
        method: "POST",
        body: JSON.stringify({ clipId: preferred })
      });
      nextWorkspace = loaded.workspace;
      nextOverview = loaded.overview || projectResult;
    }
    setWorkspace(nextWorkspace);
    setOverview(nextOverview);
    setSceneChoice(preferred);
    setEditRevision(0);
    if (preferred) useStore.getState().setSelectedStoryboardClip(preferred);
    await refreshDiagnostics(preferred, nextWorkspace?.selectedSegmentId);
    setNotice(preferred ? `Loaded ${preferred} from the shared Premiere316 project.` : "This project has no LTX Director scene package yet.");
  }, [project.slug, refreshDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await integrationApi("/start", { method: "POST", body: "{}" });
        if (cancelled) return;
        await loadWorkspace();
        await refreshHealth();
      } catch (error: any) {
        if (!cancelled) setNotice(String(error.message || error));
      } finally {
        if (!cancelled) setBusy(null);
      }
    };
    void boot();
    const timer = window.setInterval(refreshHealth, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [loadWorkspace, refreshHealth]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/sound`);
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || response.statusText || "Dialogue cue plan unavailable");
        if (!active) return;
        setDialogueCueSound({
          ...(json.sound || {}),
          dialogueCues: json.sound?.dialogueCues || json.dialogueCues || []
        });
        setDialogueCueError("");
      } catch (error: any) {
        if (active) setDialogueCueError(String(error?.message || error));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3500);
    return () => { active = false; window.clearInterval(timer); };
  }, [project.slug]);

  const selected = useMemo(() => {
    const all = [
      ...trackSegments(workspace, "segments"),
      ...trackSegments(workspace, "audioSegments"),
      ...trackSegments(workspace, "motionSegments")
    ];
    return all.find((segment: any) => String(segment.id) === String(workspace?.selectedSegmentId)) || all[0] || null;
  }, [workspace]);
  const dialogueCues = useMemo(() => dialogueCuesFromSound(dialogueCueSound), [dialogueCueSound]);
  const clipDialogueCues = useMemo(
    () => dialogueCuesForClip(dialogueCues, workspace?.premiere?.clipId || sceneChoice),
    [dialogueCues, sceneChoice, workspace?.premiere?.clipId]
  );
  const selectedDialogueCues = useMemo(
    () => dialogueCuesForSegment(dialogueCues, selected, workspace?.premiere?.clipId || sceneChoice),
    [dialogueCues, sceneChoice, selected, workspace?.premiere?.clipId]
  );

  useEffect(() => {
    const clipId = workspace?.premiere?.clipId;
    if (!clipId || !selected?.id) return;
    void refreshDiagnostics(clipId, selected.id);
  }, [refreshDiagnostics, selected?.id, workspace?.premiere?.clipId]);
  const total = durationFrames(workspace);
  const fps = Math.max(1, Number(workspace?.settings?.frameRate) || 24);
  const selectedTrack = trackSegments(workspace, "audioSegments").some((item: any) => item.id === selected?.id) ? "Audio" : trackSegments(workspace, "motionSegments").some((item: any) => item.id === selected?.id) ? "IC-LoRA" : "Main";
  const selectedEligible = selectedTrack === "Main" && isVisualGenerationSegment(selected);
  const eligibleSegments = trackSegments(workspace, "segments").filter(isVisualGenerationSegment);
  const queueBusy = jobs.some((job: any) => ["queued", "running", "cancelling"].includes(job.status)) || Number(health?.queue?.running || 0) + Number(health?.queue?.pending || 0) > 0;
  const bindingCurrent = workspace?.premiere?.projectSlug === project.slug && (!productionClipId || workspace?.premiere?.clipId === productionClipId);
  const serviceReady = Boolean(health?.connected);
  const neighbors = segmentNeighborState(workspace, selected?.id);
  const temporalGuides = useMemo(() => temporalGuideState(workspace, selected?.id), [workspace, selected?.id]);
  const semanticReferences = useMemo(
    () => semanticReferenceState(referenceResponse, selected?.storyboardFrameId || null),
    [referenceResponse, selected?.storyboardFrameId]
  );
  const referenceTarget = useMemo(() => {
    if (selected?.storyboardFrameId) {
      return {
        kind: "frame" as const,
        id: String(selected.storyboardFrameId),
        label: `${workspace?.premiere?.clipId || "Storyboard"} · ${selected.id}`
      };
    }
    if (referenceResponse?.videoPlanId) {
      return {
        kind: "video_plan" as const,
        id: String(referenceResponse.videoPlanId),
        label: `${workspace?.premiere?.clipId || "Storyboard"} · video plan`
      };
    }
    return null;
  }, [referenceResponse?.videoPlanId, selected?.id, selected?.storyboardFrameId, workspace?.premiere?.clipId]);
  const editableReferences = useMemo(() => {
    const references = referenceTarget?.kind === "frame"
      ? (referenceResponse?.references || []).filter((reference: any) => String(reference?.frameId || reference?.targetId || "") === referenceTarget.id)
      : referenceResponse?.semanticReferences || [];
    return references.map((reference: any) => ({
      ...reference,
      assetVersion: Number(reference.assetVersion ?? reference.version ?? String(reference.assetVersionId || "").match(/v(\d+)$/)?.[1] ?? 0)
    }));
  }, [referenceResponse, referenceTarget]);
  const conditioning = useMemo(
    () => semanticConditioningState(preflight, semanticReferences),
    [preflight, semanticReferences]
  );
  const framePlan = useMemo(() => ltx25FramePlan(Number(selected?.length) || 1, fps), [selected?.length, fps]);
  const generationMode = String(workspace?.premiere?.generationMode || "");
  const generateOptions = visibleGenerateOptions(workspace?.premiere?.generateOptions || [], workspace, project.slug);
  const selectedGenerateOption = workspace?.premiere?.generateOption || generateOptions[0] || null;
  const generateOptionId = String(workspace?.premiere?.generateOptionId || selectedGenerateOption?.id || "");
  const segmentedI2v = isSegmentedI2vWorkspace(workspace) || semanticT2vLockedForWorkspace(workspace, project.slug);
  const timelineQueueMode = !segmentedI2v && (
    selectedGenerateOption?.queueMode === "timeline"
    || generationMode === "t2v_with_semantic_references"
    || workspace?.settings?.queueMode === "timeline"
  );
  const queueMode: "timeline" | "segments" = timelineQueueMode ? "timeline" : "segments";
  const playlist = useMemo(() => previewPlaylist(workspace, project.slug), [workspace, project.slug]);
  const selectedTakes = segmentTakes(selected);
  const selectedActiveTake = activeTakeOf(selected);
  const activeProfileLabel = String(
    selectedGenerateOption?.label
    || preflight?.generationProfile
    || (timelineQueueMode ? "Premiere Semantic T2V" : "Harrowing of Hell")
  );
  const semanticQueueReady = Boolean(
    referenceResponse
    && preflight?.ok === true
    && semanticReferences.ready
    && semanticReferences.references.length === semanticReferences.declaredCount
  );
  const i2vQueueReady = segmentedI2vQueueReady(workspace);
  const queueReady = queueMode === "segments"
    ? i2vQueueReady
    : semanticQueueReady;

  useEffect(() => {
    if (!timelinePreview) return;
    if (playlist[previewIndex]?.url) return;
    const first = firstPlayablePreviewIndex(playlist);
    if (playlist[first]?.url) setPreviewIndex(first);
  }, [timelinePreview, playlist, previewIndex]);

  const patchWorkspace = (updater: (draft: any) => void) => {
    setWorkspace((current: any) => {
      if (!current) return current;
      const next = structuredClone(current);
      updater(next);
      return next;
    });
    setEditRevision((current) => current + 1);
  };

  const applySelectedReferences = async (references: any[]) => {
    if (!referenceTarget) throw new Error("Select a storyboard segment before editing references");
    const userReferences = references.map((reference) => ({
      ...reference,
      useMode: referenceTarget.kind === "video_plan" ? "semantic_reference" : "direct_conditioning"
    }));
    const clipId = workspace?.premiere?.clipId || "";
    const selectedSegmentId = selected?.id || null;
    await saveWorkspace(true);
    await replaceStoryboardReferences(referenceTarget.kind, referenceTarget.id, userReferences);
    const refreshed = await integrationApi(
      `/director/premiere/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(clipId)}/references/refresh`,
      { method: "POST", body: "{}" }
    );
    setWorkspace((current: any) => current
      ? { ...current, premiere: refreshed.workspace?.premiere || current.premiere }
      : refreshed.workspace);
    setReferenceResponse(refreshed.references || null);
    await refreshDiagnostics(clipId, selectedSegmentId);
    setNotice(`${userReferences.length ? `Saved ${userReferences.length}` : "Removed all"} user-managed reference${userReferences.length === 1 ? "" : "s"} for ${selected?.id || referenceTarget.id}.`);
  };

  const saveWorkspace = async (quiet = false) => {
    if (!workspace) return null;
    const result = await integrationApi("/director/workspace", { method: "PUT", body: JSON.stringify({ workspace }) });
    if (!quiet) setNotice("Director workspace saved.");
    return result.workspace;
  };

  useEffect(() => {
    if (!workspace || !editRevision || busy === "load") return;
    const snapshot = structuredClone(workspace);
    const revision = editRevision;
    const timer = window.setTimeout(async () => {
      try {
        await integrationApi("/director/workspace", { method: "PUT", body: JSON.stringify({ workspace: snapshot }) });
        setNotice((current) => /failed|error/i.test(current) ? current : `Draft autosaved · revision ${revision}`);
      } catch (error: any) {
        setNotice(`Draft autosave failed: ${String(error.message || error)}`);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [editRevision]);

  const loadScene = async (clipId?: string) => {
    const id = String(clipId || sceneChoice || "");
    if (!id) return;
    if (busy && busy !== "load") return;
    setSceneChoice(id);
    setBusy("load");
    try {
      const result = await integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}/load`, {
        method: "POST",
        body: JSON.stringify({ clipId: id })
      });
      setWorkspace(result.workspace);
      setEditRevision(0);
      setOverview(result.overview || overview);
      setSelectedStoryboardClip(id);
      await refreshDiagnostics(id, result.workspace?.selectedSegmentId);
      setNotice(`${id} loaded into LTX Director.`);
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally { setBusy(null); }
  };

  const syncToPremiere = async () => {
    setBusy("sync");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/premiere/sync", { method: "POST", body: "{}" });
      setOverview(result.overview || overview);
      setNotice(`Saved ${result.result?.clipId || workspace?.premiere?.clipId} direction to Premiere316.`);
      await reloadProject();
      await refreshDiagnostics(workspace?.premiere?.clipId || sceneChoice, selected?.id);
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const loadWorkflowLibrary = async () => {
    const response = await fetch("/api/aaa-workflow/library");
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Failed to load workflow library");
    setWorkflowLibrary(json.items || []);
    return json.items || [];
  };

  const loadAaaWorkflow = async (rel?: string) => {
    const query = rel ? `?rel=${encodeURIComponent(rel)}` : "";
    const response = await fetch(`/api/aaa-workflow${query}`);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Failed to load workflow");
    setAaaWorkflow(json.workflow);
    return json.workflow;
  };

  useEffect(() => {
    if (!workflowPanel) return;
    void loadWorkflowLibrary().catch((error) => setNotice(String(error.message || error)));
    void loadAaaWorkflow("HARROWING OF HELL.json").catch((error) => setNotice(String(error.message || error)));
  }, [workflowPanel]);

  const saveAaaWorkflow = async () => {
    if (!aaaWorkflow) return;
    setBusy("workflow");
    try {
      const response = await fetch("/api/aaa-workflow", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(aaaWorkflow)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Failed to save AAA workflow");
      setAaaWorkflow(json.workflow);
      patchWorkspace((draft) => {
        draft.settings = draft.settings || {};
        draft.settings.customWidth = json.workflow.width;
        draft.settings.customHeight = json.workflow.height;
        draft.settings.frameRate = json.workflow.fps;
        draft.settings.negativePrompt = json.workflow.negativePrompt;
        draft.timeline = draft.timeline || {};
        draft.timeline.global_prompt = json.workflow.globalPrompt;
      });
      await saveWorkspace(true);
      setNotice(`AAA workflow saved · ${json.workflow.width}x${json.workflow.height} · ${json.workflow.fps}fps · ${json.workflow.pass1Steps + json.workflow.pass2Steps} steps · ${json.workflow.segmentsUpdated || 0} segment graphs.`);
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setBusy(null);
    }
  };

  const saveGlobalPrompt = async () => {
    if (!workspace?.premiere?.clipId) {
      setNotice("Load a scene before saving the global prompt.");
      return;
    }
    const labels = {
      clip: "this clip",
      scene: "this entire scene",
      chapter: "this entire chapter",
      project: "the entire project"
    };
    if ((globalPromptScope === "chapter" || globalPromptScope === "project") && !window.confirm(`Save this global prompt to ${labels[globalPromptScope]}? Local segment prompts stay unchanged.`)) {
      return;
    }
    setBusy("global");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/premiere/global-prompt", {
        method: "POST",
        body: JSON.stringify({
          scope: globalPromptScope,
          text: workspace.timeline?.global_prompt || ""
        })
      });
      const applied = result.result || {};
      setNotice(`Saved global to ${applied.scope || globalPromptScope}: ${applied.clips || 0} clips, ${applied.segments || 0} segments.`);
      await reloadProject();
    } catch (error: any) {
      setNotice(String(error.message || error));
    } finally {
      setBusy(null);
    }
  };

  const queue = async (mode: "selected" | "segments" | "timeline") => {
    if (!workspace || busy) return;
    setBusy("queue");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/queue", {
        method: "POST",
        body: JSON.stringify(mode === "selected" ? { mode, segmentId: selected?.id } : { mode })
      });
      const accepted = Number(result.accepted?.length || 0);
      const target = mode === "selected"
        ? "I2V segment job"
        : mode === "timeline"
          ? "semantic timeline job"
          : `I2V segment job${accepted === 1 ? "" : "s"} (one prompt per segment)`;
      setNotice(`Queued ${accepted} ${target}. Queue All never submits the full clip as one long job.`);
      await refreshHealth();
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };


  const downloadSegmentWorkflow = async () => {
    if (!workspace || !selected?.id || busy) return;
    setBusy("download");
    try {
      await saveWorkspace(true);
      const response = await fetch("/api/integrations/ltx/director/workflow?segmentId=" + encodeURIComponent(selected.id));
      const blob = await response.blob();
      if (!response.ok) {
        const json = JSON.parse(await blob.text().catch(() => "{}"));
        throw new Error(json.error || response.statusText || "Download failed");
      }
      const disposition = response.headers.get("content-disposition") || "";
      const matched = disposition.match(/filename="?([^";]+)/);
      const name = (matched && matched[1]) || String(workspace.premiere?.clipId || "clip") + "__" + selected.id + ".json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Downloaded " + name + " for fine-tuning.");
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const pushSegmentWorkflow = async () => {
    if (!workspace || !selected?.id || busy) return;
    setBusy("push");
    try {
      await saveWorkspace(true);
      const result = await integrationApi("/director/push-to-comfyui", {
        method: "POST",
        body: JSON.stringify({ segmentId: selected.id })
      });
      setNotice("Pushed " + (result.workflowName || selected.id) + " to ComfyUI. Load it on 8188 to fine-tune.");
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const chooseGenerateOption = async (optionId: string) => {
    if (!optionId || optionId === generateOptionId || busy) return;
    if (optionId === "t2v_with_semantic_references" && semanticT2vLockedForWorkspace(workspace, project.slug)) {
      setNotice("Semantic T2V is locked on Harrowing of Hell. Queue All stays on 8-second first-frame jobs.");
      return;
    }
    setBusy("option");
    try {
      const result = await integrationApi(`/director/premiere/projects/${encodeURIComponent(project.slug)}/generate-option`, {
        method: "POST",
        body: JSON.stringify({ clipId: workspace?.premiere?.clipId || sceneChoice, optionId })
      });
      if (result.workspace) setWorkspace(result.workspace);
      if (result.overview) setOverview(result.overview);
      setNotice(`Generate option: ${result.generateOption?.label || optionId}`);
    } catch (error: any) { setNotice(String(error.message || error)); }
    finally { setBusy(null); }
  };

  const activateTake = async (take: any) => {
    if (!selected?.id || !take || !workspace?.premiere?.clipId) return;
    const takeId = String(take.id || take.v);
    setWorkspace((current: any) => {
      if (!current) return current;
      const next = structuredClone(current);
      const segment = (next.timeline?.segments || []).find((item: any) => String(item.id) === String(selected.id));
      if (segment) {
        segment.activeTakeId = take.id || `take-v${take.v}`;
        segment.activeGeneratedVersion = take.v;
        segment.activeTakeFile = take.previewFile || take.file || null;
      }
      return next;
    });
    try {
      const result = await integrationApi(
        `/director/premiere/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(workspace.premiere.clipId)}/segments/${encodeURIComponent(selected.id)}/takes/activate`,
        { method: "POST", body: JSON.stringify({ takeId }) }
      );
      if (result.workspace) setWorkspace(result.workspace);
      setNotice(`Active take: ${take.id || `v${take.v}`} on ${selected.id}`);
    } catch (error: any) { setNotice(String(error.message || error)); }
  };

  if (!workspace) return <main className="ltx-native-workspace"><div className="ltx-loading premium-panel"><span className="ltx-spinner" /><h1>LTX Director</h1><p>{notice}</p><button className="button secondary" disabled={Boolean(busy)} onClick={() => loadWorkspace()}>{busy ? "Starting…" : "Try again"}</button></div></main>;

  const sceneOptions = overview?.storyboard?.clips || [];
  const firstGuideUrl = temporalGuides.first ? mediaPreviewUrl(project.slug, temporalGuides.first) : "";
  const lastGuideUrl = temporalGuides.last ? mediaPreviewUrl(project.slug, temporalGuides.last) : "";

  return (
    <main className="ltx-native-workspace">
      <header className="ltx-bridge-bar">
        <div className="ltx-scene-context"><label>SCENE<select value={sceneChoice} onChange={(event) => { const id = event.target.value; setSceneChoice(id); if (id) void loadScene(id); }}>{sceneOptions.map((clip: any) => <option key={clip.id} value={clip.id}>{clip.id} · {clip.scene} · {clip.ready ? "ready" : "needs guide"}</option>)}</select></label><button className="button secondary" disabled={!sceneChoice || busy === "load"} onClick={() => void loadScene()}>{busy === "load" ? "Loading…" : sceneChoice === workspace?.premiere?.clipId ? "Reload Scene" : "Load Scene"}</button>
          <button type="button" className="button secondary" disabled={!sceneChoice} onClick={() => {
            if (sceneChoice) setSelectedStoryboardClip(sceneChoice);
            const params = new URLSearchParams(window.location.search);
            if (project?.slug) params.set("project", project.slug);
            window.history.pushState({}, "", `/storyboard${params.size ? `?${params}` : ""}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}>Open Storyboard for this clip</button></div>
        <div className="ltx-service-state"><span className={health?.connected ? "online" : "offline"}><i />LTX {health?.connected ? "Ready" : "Offline"}</span>{!health?.connected ? <small data-testid="ltx-008-offline">LTX or its ComfyUI engine is offline. Generate is paused. Upload, choose, and review stay available.</small> : null}<label className="ltx-generate-option">GENERATE OPTION<select value={generateOptionId} onChange={(event) => void chooseGenerateOption(event.target.value)}>{(generateOptions.length ? generateOptions : [{ id: generateOptionId || "harrowing_aaa_i2v_segmented", label: selectedGenerateOption?.label || "Harrowing of Hell" }]).map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><span className="ltx-profile-chip">{activeProfileLabel}</span><span>{queueMode === "timeline" ? "Semantic timeline" : `${eligibleSegments.length} I2V segment jobs`}</span><span>ComfyUI {health?.comfyUrl?.replace(/^https?:\/\//, "") || "unavailable"}</span><span>{health?.queue?.running || 0} running · {health?.queue?.pending || 0} queued</span></div>
        <div className="ltx-actions"><button type="button" className="button secondary" onClick={() => { const next = !workflowPanel; setWorkflowPanel(next); if (next) { void loadWorkflowLibrary().catch((error) => setNotice(String(error.message || error))); void loadAaaWorkflow(aaaWorkflow?.rel || "HARROWING OF HELL.json").catch((error) => setNotice(String(error.message || error))); } }}>{workflowPanel ? "Hide workflow" : "Workflow"}</button><button className="button secondary" disabled={!bindingCurrent || Boolean(busy)} onClick={syncToPremiere}>{busy === "sync" ? "Saving…" : "Save to Premiere316"}</button>{queueMode === "segments" ? <><button className="button primary" disabled={busy === "queue"} title={!serviceReady ? "LTX Director or its ComfyUI engine is offline." : !bindingCurrent ? "Load the current shared shot before generating." : !i2vQueueReady ? "Load a segmented first-frame I2V scene with approved temporal guides." : !selectedEligible ? "Select a visual main-track segment with an approved temporal guide." : queueBusy ? "Wait for the shared GPU queue to become idle." : "Generate only the selected visual segment with its separate temporal and semantic inputs."} onClick={() => queue("selected")}>{busy === "queue" ? "Queueing…" : "Generate Segment"}</button><button className="button secondary" disabled={!selectedEligible || Boolean(busy) || !bindingCurrent || !serviceReady} onClick={() => void downloadSegmentWorkflow()}>{busy === "download" ? "Downloading…" : "Download Workflow"}</button><button className="button secondary" disabled={busy === "push"} onClick={() => void pushSegmentWorkflow()}>{busy === "push" ? "Pushing…" : "Push to ComfyUI"}</button></> : <button className="button primary" disabled={busy === "queue"} title={!semanticQueueReady ? "Resolve every declared semantic reference and pass compiler preflight before generation." : "Generate the complete semantic T2V timeline through Premiere316."} onClick={() => queue("timeline")}>{busy === "queue" ? "Queueing…" : "Generate Semantic T2V"}</button>}</div>
      </header>

      <section role="status" aria-live="polite" className={`ltx-notice ${/failed|error|busy/i.test(notice) ? "warning" : ""}`}><span>{notice}</span>{!bindingCurrent && productionClipId ? <button onClick={() => { setSceneChoice(productionClipId || ""); }}>Use shared shot {productionClipId}</button> : null}</section>

      {workflowPanel ? <section className="ltx-workflow-panel premium-panel">
        <header>
          <div><span className="workspace-eyebrow">WORKFLOW LIBRARY</span><h2>{(aaaWorkflow?.rel === "HARROWING OF HELL.json" ? "Harrowing of Hell" : aaaWorkflow?.rel === "harrowing_of_hell_LTX2.5_Director.json" ? "Harrowing LTX2.5 Director" : aaaWorkflow?.name) || "Harrowing of Hell"}{aaaWorkflow?.folder ? ` · ${aaaWorkflow.folder}` : ""}</h2></div>
          <button type="button" className="button primary" disabled={Boolean(busy) || !aaaWorkflow} onClick={() => void saveAaaWorkflow()}>{busy === "workflow" ? "Saving…" : "Save workflow"}</button>
        </header>
        <div className="ltx-workflow-shell">
        <aside className="ltx-workflow-library">
          <input className="ltx-workflow-search" type="search" placeholder="Search workflows…" value={workflowQuery} onChange={(event) => setWorkflowQuery(event.target.value)} />
          <div className="ltx-workflow-list">
            {workflowLibrary.filter((item: any) => {
              const label = item.rel === "HARROWING OF HELL.json" ? "Harrowing of Hell" : item.rel === "harrowing_of_hell_LTX2.5_Director.json" ? "Harrowing LTX2.5 Director" : item.rel === "LTX_2.5_Harrowing_AAA.json" ? "Harrowing AAA" : item.name;
              const hay = `${label} ${item.rel} ${item.folder || ""} harrowing of hell`.toLowerCase();
              return !workflowQuery.trim() || hay.includes(workflowQuery.trim().toLowerCase());
            }).sort((a: any, b: any) => {
              const rank = (item: any) => item.rel === "HARROWING OF HELL.json" ? 0 : item.rel === "harrowing_of_hell_LTX2.5_Director.json" ? 1 : item.rel === "LTX_2.5_Harrowing_AAA.json" ? 2 : item.folder === "H01_S01_C01_AAA_segments" ? 3 : 4;
              return rank(a) - rank(b) || String(a.rel).localeCompare(String(b.rel));
            }).map((item: any) => {
              const label = item.rel === "HARROWING OF HELL.json" ? "Harrowing of Hell" : item.rel === "harrowing_of_hell_LTX2.5_Director.json" ? "Harrowing LTX2.5 Director" : item.rel === "LTX_2.5_Harrowing_AAA.json" ? "Harrowing AAA" : item.name;
              const pinned = item.rel === "HARROWING OF HELL.json" || item.rel === "harrowing_of_hell_LTX2.5_Director.json" || item.rel === "LTX_2.5_Harrowing_AAA.json" || item.folder === "H01_S01_C01_AAA_segments";
              return <button type="button" key={item.rel} className={`${item.rel === aaaWorkflow?.rel ? "active" : ""} ${pinned ? "pinned" : ""}`} onClick={() => void loadAaaWorkflow(item.rel).then((wf) => setNotice(`Loaded ${label}`)).catch((error) => setNotice(String(error.message || error)))}><b>{label}</b><small>{pinned ? "PINNED" : item.folder || "root"}{item.folder && item.rel !== "LTX_2.5_Harrowing_AAA.json" ? ` · ${item.folder}` : ""}</small></button>;
            })}
            {!workflowLibrary.length ? <p className="ltx-workflow-empty">No workflows match.</p> : null}
          </div>
        </aside>
        {aaaWorkflow ? <div className="ltx-workflow-grid">
          <label>Width<input type="number" value={aaaWorkflow.width} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, width: Number(event.target.value) }))} /></label>
          <label>Height<input type="number" value={aaaWorkflow.height} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, height: Number(event.target.value) }))} /></label>
          <label>FPS<input type="number" value={aaaWorkflow.fps} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, fps: Number(event.target.value) }))} /></label>
          <label>Seconds<input type="number" value={aaaWorkflow.seconds} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, seconds: Number(event.target.value) }))} /></label>
          <label className="wide">UNET<input value={aaaWorkflow.unet || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, unet: event.target.value }))} /></label>
          <label className="wide">CLIP<input value={aaaWorkflow.clip || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, clip: event.target.value }))} /></label>
          <label className="wide">First frame<input value={aaaWorkflow.firstFrame || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, firstFrame: event.target.value }))} /></label>
          <label className="check"><input type="checkbox" checked={Boolean(aaaWorkflow.useFirstFrame)} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, useFirstFrame: event.target.checked }))} /> Use first frame</label>
          <label className="wide">Pass 1 sigmas ({aaaWorkflow.pass1Steps} steps)<input value={aaaWorkflow.pass1Sigmas || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, pass1Sigmas: event.target.value }))} /></label>
          <label className="wide">Pass 2 sigmas ({aaaWorkflow.pass2Steps} steps)<input value={aaaWorkflow.pass2Sigmas || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, pass2Sigmas: event.target.value }))} /></label>
          <div className="ltx-workflow-loras">{["flying","distilled","talkvid","crisp","hardcut"].map((key) => <label key={key} className="check"><input type="checkbox" checked={Boolean(aaaWorkflow.loras?.[key]?.enabled)} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, loras: { ...current.loras, [key]: { ...current.loras?.[key], enabled: event.target.checked } } }))} /> {key}{aaaWorkflow.loras?.[key]?.strength ? ` ${aaaWorkflow.loras[key].strength}` : ""}</label>)}</div>
          <label className="wide tall">Global prompt<textarea value={aaaWorkflow.globalPrompt || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, globalPrompt: event.target.value }))} /></label>
          <label className="wide tall">Negative<textarea value={aaaWorkflow.negativePrompt || ""} onChange={(event) => setAaaWorkflow((current: any) => ({ ...current, negativePrompt: event.target.value }))} /></label>
        </div> : <p>Loading workflow…</p>}
        </div>
      </section> : null}
      <><section className="ltx-editor-grid">
        <section className="ltx-timeline-panel premium-panel">
          <header><div><span className="workspace-eyebrow">SEGMENT TIMELINE · {activeProfileLabel}</span><h2>{workspace.premiere?.clipId || "Unbound Director workspace"}</h2></div><div className="ltx-timeline-header-meta"><button type="button" className="ltx-timeline-toggle" onClick={() => { setTimelinePreview((value) => { const next = !value; if (next) setPreviewIndex(firstPlayablePreviewIndex(playlist)); return next; }); setPreviewPlaying(false); }}>{timelinePreview ? "Timeline" : "Preview"}</button><b>{(total / fps).toFixed(1)}s</b><small>{total} editorial frames · {fps} fps · {workspace.settings.customWidth}×{workspace.settings.customHeight}</small></div></header>
          {String(workspace?.premiere?.clipId || "").toUpperCase().startsWith("H02-") ? <section className="ltx-dialogue-cue-plan" data-testid="ltx-dialogue-cue-plan" aria-label="Authoritative H02 dialogue cue plan">
            <header><div><span className="workspace-eyebrow">AUTHORITATIVE H02 DIALOGUE PLAN · READ ONLY</span><b>{selectedTrack === "Main" ? selected?.id || "No MAIN selection" : "Select a MAIN segment"}</b></div><span>{clipDialogueCues.length ? `${clipDialogueCues.length} speech cue${clipDialogueCues.length === 1 ? "" : "s"} in clip` : dialogueCueError || "Loading cue plan…"}</span></header>
            {clipDialogueCues.length ? <>
              <div className="ltx-dialogue-cue-strip" aria-label="Dialogue cues in this clip">{clipDialogueCues.map((cue: any) => {
                const associated = selectedDialogueCues.some((selectedCue: any) => selectedCue.cueId === cue.cueId);
                const progress = dialogueCueProgress(cue);
                return <article key={cue.cueId} className={associated ? "associated" : ""} data-testid={`ltx-001-strip-${cue.cueId}`}><b>{cue.cueId}</b><code>{cue.segmentId}</code><span>{cue.speaker}</span><i><em style={{ width: `${Math.round(progress * 100)}%` }} /></i><LtxCueActions cue={cue} focusPrefix="ltx-strip" /></article>;
              })}</div>
              <div className="ltx-dialogue-cue-details">
                {selectedTrack !== "Main" ? <p>Select a MAIN pass to inspect its authored speech association.</p> : selectedDialogueCues.length ? selectedDialogueCues.map((cue: any) => <article key={cue.cueId} data-testid={`ltx-dialogue-cue-detail-${cue.cueId}`}>
                  <header><b>{cue.cueId} · {cue.speaker}</b><code>{cue.segmentId}</code><em className={dialogueCueStatus(cue)}>{dialogueCueStatus(cue)} · {Math.round(dialogueCueProgress(cue) * 100)}%</em></header>
                  <blockquote>{cue.exactDialogue}</blockquote>
                  <p><b>Performance:</b> {cue.performanceDirection || "Use the authoritative cue-specific direction."}</p>
                  <small>{Number(cue.targetVoiceDurationSec) > 0 ? `${Number(cue.targetVoiceDurationSec).toFixed(1)}s voice` : "Voice timing planned"}{Number(cue.targetVideoDurationSec) > 0 ? ` · ${Number(cue.targetVideoDurationSec).toFixed(1)}s video target` : ""}</small>
                  <LtxCueActions cue={cue} focusPrefix="ltx-cue" />
                </article>) : <p>This selected MAIN pass is picture-only. It has no intelligible dialogue cue.</p>}
              </div>
            </> : <p className="ltx-dialogue-cue-empty">{dialogueCueError || "Reading the 34-cue authoritative Qwen plan…"}</p>}
            <footer>Planned cue metadata only. A validated master WAV becomes an LTX AUDIO input only after its file is actually bound.</footer>
          </section> : null}
          {timelinePreview ? <AssembledPreviewPlayer playlist={playlist} fps={fps} playheadFrame={Number(workspace.playheadFrame) || 0} playing={previewPlaying} previewIndex={previewIndex} onPlayhead={(frame) => setWorkspace((current: any) => current ? { ...current, playheadFrame: frame } : current)} onPlayingChange={setPreviewPlaying} onPreviewIndex={setPreviewIndex} onSelectSegment={(segmentId, frame) => setWorkspace((current: any) => current ? { ...current, selectedSegmentId: segmentId, playheadFrame: frame } : current)} /> : <>
          <div className="ltx-ruler">{Array.from({ length: Math.max(2, Math.ceil(total / fps) + 1) }).map((_, index) => <span key={index} style={{ left: `${Math.min(100, (index * fps / total) * 100)}%` }}>{index}s</span>)}</div>
          {([
            ["MAIN", "segments"],
            ["AUDIO", "audioSegments"],
            ["IC-LORA", "motionSegments"]
          ] as const).map(([label, key]) => <div className={`ltx-track ltx-track-${key}`} key={key}><b>{label}</b><div className="ltx-track-lane">{trackSegments(workspace, key).map((segment: any) => <button key={segment.id} className={`${String(segment.id) === String(selected?.id) ? "selected" : ""} ${segment.missingGuide ? "missing" : ""}`} style={{ left: `${((Number(segment.start) || 0) / total) * 100}%`, width: `${Math.max(1.5, ((Number(segment.length) || 1) / total) * 100)}%` }} onClick={() => patchWorkspace((draft) => { draft.selectedSegmentId = segment.id; draft.playheadFrame = Number(segment.start) || 0; })}><span>{segment.fileName || segment.id}</span><small>{((Number(segment.length) || 1) / fps).toFixed(1)}s</small></button>)}</div></div>)}
          <div className="ltx-playhead" style={{ left: `calc(92px + (100% - 104px) * ${Math.max(0, Number(workspace.playheadFrame) || 0) / total})` }} />
          </>}
          <footer><button className="button secondary" disabled={Boolean(busy)} onClick={() => saveWorkspace()}>Save Workspace</button><button className="button secondary" disabled={busy === "queue"} onClick={() => queue(queueMode)}>{queueMode === "timeline" ? "Queue Semantic Timeline" : `Queue All Segments (${eligibleSegments.length})`}</button><span>{workspace.timeline.segments?.length || 0} main · {workspace.timeline.audioSegments?.length || 0} audio · {workspace.timeline.motionSegments?.length || 0} IC-LoRA</span></footer>
        </section>

        <aside className="ltx-reference-panel premium-panel" aria-label="Temporal and semantic reference diagnostics">
          <header><div><b>REFERENCE INPUTS</b><small>{selectedTrack} segment · {referenceTab === "library" ? `${selectedTakes.length} take${selectedTakes.length === 1 ? "" : "s"}` : "roles stay separate"}</small></div><div className="ltx-reference-header-actions"><div className="ltx-panel-tabs" role="tablist" aria-label="Reference panel"><button type="button" role="tab" aria-selected={referenceTab === "inputs"} className={referenceTab === "inputs" ? "active" : ""} onClick={() => setReferenceTab("inputs")}>Inputs</button><button type="button" role="tab" aria-selected={referenceTab === "library"} className={referenceTab === "library" ? "active" : ""} onClick={() => setReferenceTab("library")}>Library</button></div><button type="button" disabled={diagnosticsBusy || !workspace?.premiere?.clipId} onClick={() => refreshDiagnostics(workspace?.premiere?.clipId, selected?.id)}>{diagnosticsBusy ? "Checking…" : "Recheck"}</button></div></header>
          {referenceTab === "library" ? <section className="ltx-reference-group ltx-library-group" aria-labelledby="ltx-library-heading">
            <div className="ltx-reference-heading"><div><span className="workspace-eyebrow">SEGMENT LIBRARY</span><b id="ltx-library-heading">{selected?.id || "No selection"}</b></div><small>{selectedTakes.length} iteration{selectedTakes.length === 1 ? "" : "s"}</small></div>
            <p className="ltx-library-help">Click a take to make it the active segment output. No extra confirm.</p>
            <div className="ltx-library-grid">
              {selectedTakes.map((take: any) => {
                const active = String(take.id) === String(selectedActiveTake?.id || selected?.activeTakeId);
                return <button type="button" key={take.id || take.v} className={`ltx-library-card ${active ? "active" : ""}`} onClick={() => void activateTake(take)}>
                  <div className="ltx-reference-thumb">{takePreviewUrl(project.slug, take) ? <video src={takePreviewUrl(project.slug, take)} muted playsInline preload="metadata" /> : <span aria-hidden="true">◇</span>}</div>
                  <strong>{take.id || `v${take.v}`}</strong>
                  <small>{active ? "ACTIVE" : "Click to activate"}{take.createdAt ? ` · ${new Date(take.createdAt).toLocaleString()}` : ""}</small>
                </button>;
              })}
              {!selectedTakes.length ? <p className="ltx-reference-empty">No generated takes yet for this segment. Queue the segment to create the first iteration.</p> : null}
            </div>
          </section> : null}

          {referenceTab === "inputs" ? <>
          <section className="ltx-reference-group" aria-labelledby="ltx-temporal-heading">
            <div className="ltx-reference-heading"><div><span className="workspace-eyebrow">TEMPORAL GUIDES</span><b id="ltx-temporal-heading">First / last frame control</b></div><small>{Number(Boolean(temporalGuides.first)) + Number(Boolean(temporalGuides.last))} active</small></div>
            <div className="ltx-temporal-grid">
              <article className={`ltx-temporal-card ${temporalGuides.first ? "ready" : "missing"}`}>
                <div className="ltx-reference-card-label"><b>FIRST</b><span>{temporalGuides.first ? "Timed frame 0" : "Missing"}</span></div>
                <div className="ltx-reference-thumb">{temporalGuides.first ? <ReferenceMedia src={firstGuideUrl} reference={temporalGuides.first} alt="First temporal guide" /> : <span aria-hidden="true">◇</span>}</div>
                <strong>{temporalGuides.first?.fileName || "No first temporal source"}</strong>
                <small>{temporalGuides.first ? `${temporalGuides.first.origin} · ${temporalGuides.first.sourceSegmentId}` : "Generation requires a selected visual source."}</small>
                <button type="button" id="ltx-first-guide" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({
                  sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} first guide` },
                  requirement: { relationship: "ltx.temporalGuide.first", category: "guide-frame", expectedMediaType: "image" },
                  initialAction: temporalGuides.first ? "replace" : "generate",
                  slotState: temporalGuides.first ? "approved" : "missing",
                  returnFocusId: "ltx-first-guide"
                })}>{temporalGuides.first ? "Replace first guide" : "Generate first guide"}</button>
                <button type="button" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} first guide` }, requirement: { relationship: "ltx.temporalGuide.first", category: "guide-frame", expectedMediaType: "image" }, initialAction: "upload", slotState: temporalGuides.first ? "unapproved" : "missing", returnFocusId: "ltx-first-guide" })}>Upload first guide</button>
                <button type="button" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} first guide` }, requirement: { relationship: "ltx.temporalGuide.first", category: "guide-frame", expectedMediaType: "image" }, initialAction: "choose", slotState: "missing", returnFocusId: "ltx-first-guide" })}>Choose first guide</button>
              </article>
              <article className={`ltx-temporal-card ${temporalGuides.last ? "ready" : "optional"}`}>
                <div className="ltx-reference-card-label"><b>LAST</b><span>{temporalGuides.last ? `Editorial frame ${framePlan.editFrames - 1}` : "Optional"}</span></div>
                <div className="ltx-reference-thumb">{temporalGuides.last ? <ReferenceMedia src={lastGuideUrl} reference={temporalGuides.last} alt="Last temporal guide" /> : <span aria-hidden="true">◇</span>}</div>
                <strong>{temporalGuides.last?.fileName || "No last temporal guide"}</strong>
                <small>{temporalGuides.last ? `${temporalGuides.last.origin} · ${temporalGuides.last.sourceSegmentId}` : temporalGuides.lastRequested ? "Requested last guide is unavailable." : neighbors.canUseNextAsLastFrame ? "Next approved frame can bind as last guide." : "Last guide needs an accepted next frame or Storyboard still. Generate will not invent a continuation."}</small>
                <button type="button" id="ltx-last-guide" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({
                  sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} last guide` },
                  requirement: { relationship: "ltx.temporalGuide.last", category: "guide-frame", expectedMediaType: "image" },
                  initialAction: temporalGuides.last ? "replace" : "choose",
                  slotState: temporalGuides.last ? "approved" : "missing",
                  returnFocusId: "ltx-last-guide"
                })}>{temporalGuides.last ? "Replace last guide" : "Use as last guide"}</button>
                <button type="button" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} last guide` }, requirement: { relationship: "ltx.temporalGuide.last", category: "guide-frame", expectedMediaType: "image" }, initialAction: "upload", slotState: "missing", returnFocusId: "ltx-last-guide" })}>Upload last guide</button>
                <button type="button" className="button secondary" disabled={!selected?.id} onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || ""), label: `${selected?.id || "segment"} last guide` }, requirement: { relationship: "ltx.temporalGuide.last", category: "guide-frame", expectedMediaType: "image" }, initialAction: "choose", slotState: "missing", returnFocusId: "ltx-last-guide" })}>Choose last guide</button>
                <button type="button" className="button secondary" disabled={!sceneChoice} onClick={() => { if (sceneChoice) setSelectedStoryboardClip(sceneChoice); openWorkspaceRoute("/storyboard"); }}>Open Storyboard for this clip</button>
              </article>
            </div>
          </section>

          <section className="ltx-reference-group ltx-semantic-group" aria-labelledby="ltx-semantic-heading">
            <div className="ltx-reference-heading"><div><span className="workspace-eyebrow">SEMANTIC INGREDIENTS · NOT TIMED</span><b id="ltx-semantic-heading">Identity and design references</b></div><div className="ltx-reference-manage"><small>{semanticReferences.references.length} shown · {semanticReferences.declaredCount} declared</small><button type="button" className="button secondary" disabled={!referenceTarget || storyboardSaving} onClick={() => setReferencePickerOpen(true)}>{editableReferences.length ? "Update / remove" : "Add references"}</button></div></div>
            <div className="ltx-role-counts" aria-label="Semantic reference role counts">{semanticReferences.roleCounts.map(({ role, count }: any) => <span key={role}><b>{count}</b> {roleLabel(role)}</span>)}</div>
            <div className={`ltx-conditioning-state ${conditioning.status}`}><b>{conditioning.label}</b><small>{conditioning.status === "injected" ? "Compiler preflight explicitly reports active conditioning." : conditioning.status === "resolved" ? "Pinned bindings resolve, but this preflight did not explicitly report model injection." : conditioning.status === "blocked" ? "A required binding or compiler preflight is not ready." : "No semantic inputs are assigned to this scope."}</small></div>
            {diagnosticError ? <p className="ltx-diagnostic-error">{diagnosticError}</p> : null}
            {Array.isArray(preflight?.warnings) && preflight.warnings.length ? <ul className="ltx-preflight-warnings" aria-label="Compiler preflight warnings">{preflight.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}</ul> : null}
            <div className="ltx-semantic-cards">
              {semanticReferences.references.map((reference: any) => {
                const src = semanticPreviewUrl(project.slug, reference);
                const name = reference.name || reference.assetId || reference.canonicalFile || reference.file || "Semantic reference";
                return <article key={`${reference.role}:${reference.id || reference.file}`}><div className="ltx-reference-thumb"><ReferenceMedia src={src} reference={reference} alt={`${roleLabel(reference.role)} reference: ${name}`} /></div><div><b>{name}</b><span>{roleLabel(reference.role)}{reference.version ? ` · v${reference.version}` : ""}</span><small>{reference.required ? "required" : "supporting"}{reference.current === false ? " · pinned prior version" : ""}</small>
                  <nav className="ltx-011-ref-actions" aria-label={`${name} reference actions`}>
                    <button type="button" className="button secondary" onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || reference.assetId || name), label: name }, requirement: { relationship: "ltx.reference", category: "artifact", expectedMediaType: "image", assetId: reference.assetId }, initialAction: "choose", returnFocusId: "ltx-semantic-heading" })}>Choose</button>
                    <button type="button" className="button secondary" onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || reference.assetId || name), label: name }, requirement: { relationship: "ltx.reference", category: "artifact", expectedMediaType: "image", assetId: reference.assetId }, initialAction: "replace", slotState: "unapproved", returnFocusId: "ltx-semantic-heading" })}>Replace</button>
                    <button type="button" className="button secondary" onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || reference.assetId || name), label: name }, requirement: { relationship: "ltx.reference", category: "artifact", expectedMediaType: "image" }, initialAction: "upload", slotState: "missing", returnFocusId: "ltx-semantic-heading" })}>Upload</button>
                    <button type="button" className="button secondary" onClick={() => openLtxSlot({ sourceEntity: { type: "guide", id: String(selected?.id || reference.assetId || name), label: name }, requirement: { relationship: "ltx.reference", category: "artifact", expectedMediaType: "image", assetId: reference.assetId }, initialAction: "review", returnFocusId: "ltx-semantic-heading" })}>Review</button>
                  </nav></div></article>;
              })}
              {!semanticReferences.references.length ? <p className="ltx-reference-empty">No semantic role bindings were returned for this {semanticReferences.scope === "selected-frame" ? "frame" : "scene"}.</p> : null}
            </div>
          </section>

          {queueMode === "segments" ? <section className="ltx-frame-plan" aria-labelledby="ltx-frame-plan-heading">
            <div className="ltx-reference-heading"><div><span className="workspace-eyebrow">AUTO LENGTH</span><b id="ltx-frame-plan-heading">{framePlan.profile}</b></div><small>{framePlan.grid} model grid</small></div>
            <dl><div><dt>Requested</dt><dd>{framePlan.requestedFrames} frames · {framePlan.requestedSeconds.toFixed(3)}s</dd></div><div><dt>Model generation</dt><dd>{framePlan.generationFrames} frames · {framePlan.generationSeconds.toFixed(3)}s</dd></div><div><dt>Editorial result</dt><dd>{framePlan.editFrames} frames · {framePlan.editSeconds.toFixed(3)}s</dd></div><div><dt>Automatic trim</dt><dd>{framePlan.trimFrames} padding frame{framePlan.trimFrames === 1 ? "" : "s"}</dd></div></dl>
            <p>Duration edits recalculate automatically. The model receives the next valid 8n+1 length; Premiere316 keeps the authored edit length.</p>
          </section> : null}
          </> : null}
        </aside>
      </section>

      <section className="ltx-prompt-grid">
        <article className="ltx-segment-editor premium-panel"><header><div><span className="workspace-eyebrow">SEGMENT PROMPT</span><h3>{selected?.id || "No selection"}</h3></div><span>{selectedTrack}</span></header>{selected ? <><textarea value={selected.prompt || ""} onChange={(event) => patchWorkspace((draft) => { const all = [...(draft.timeline.segments || []), ...(draft.timeline.audioSegments || []), ...(draft.timeline.motionSegments || [])]; const segment = all.find((item: any) => item.id === selected.id); if (segment) segment.prompt = event.target.value; })} /><div className="ltx-segment-fields"><label>Start (sec)<input type="number" step={0.1} value={((Number(selected.start) || 0) / fps).toFixed(2)} onChange={(event) => patchWorkspace((draft) => { const segment = [...draft.timeline.segments, ...(draft.timeline.audioSegments || []), ...(draft.timeline.motionSegments || [])].find((item: any) => item.id === selected.id); if (segment) segment.start = Math.max(0, Math.round(Number(event.target.value) * fps)); })} /></label><label>Duration (sec)<input type="number" step={0.1} value={((Number(selected.length) || 1) / fps).toFixed(2)} onChange={(event) => patchWorkspace((draft) => { const segment = [...draft.timeline.segments, ...(draft.timeline.audioSegments || []), ...(draft.timeline.motionSegments || [])].find((item: any) => item.id === selected.id); if (segment) segment.length = Math.max(1, Math.round(Number(event.target.value) * fps)); })} /></label><label>Guide strength<input type="number" min={0} max={2} step={0.05} disabled={selectedTrack === "Audio"} value={selected.guideStrength ?? selected.videoStrength ?? 1} onChange={(event) => patchWorkspace((draft) => { const segment = [...draft.timeline.segments, ...(draft.timeline.audioSegments || []), ...(draft.timeline.motionSegments || [])].find((item: any) => item.id === selected.id); if (segment) segment[selectedTrack === "IC-LoRA" ? "videoStrength" : "guideStrength"] = Number(event.target.value); })} /></label></div>{selectedTrack === "Main" ? <div className="ltx-neighbor-locks"><label title={!neighbors.canUsePreviousAsFirstFrame ? "Previous segment has no approved image guide, so Use previous as first frame stays off." : "Bind the previous approved frame as this segment first guide."}><input type="checkbox" disabled={!neighbors.canUsePreviousAsFirstFrame} checked={Boolean(neighbors.canUsePreviousAsFirstFrame && selected.usePreviousAsFirstFrame)} onChange={(event) => patchWorkspace((draft) => { const segment = draft.timeline.segments.find((item: any) => item.id === selected.id); if (segment) segment.usePreviousAsFirstFrame = event.target.checked; })} /> Use previous as first frame</label><label title={!neighbors.canUseNextAsLastFrame ? "Next segment has no approved image guide, so Use next as last frame stays off." : "Bind the next approved frame as this segment last guide."}><input type="checkbox" disabled={!neighbors.canUseNextAsLastFrame} checked={Boolean(neighbors.canUseNextAsLastFrame && selected.useNextAsLastFrame)} onChange={(event) => patchWorkspace((draft) => { const segment = draft.timeline.segments.find((item: any) => item.id === selected.id); if (segment) segment.useNextAsLastFrame = event.target.checked; })} /> Use next as last frame</label></div> : null}</> : null}</article>
        <article className="ltx-global-editor premium-panel"><header><div><span className="workspace-eyebrow">GLOBAL PROMPT</span><h3>Clip / scene / chapter / project</h3></div><span>{String(workspace.timeline.global_prompt || "").length} chars</span></header><div className="ltx-global-scope-row"><select value={globalPromptScope} onChange={(event) => { const next = event.target.value as "clip" | "scene" | "chapter" | "project"; setGlobalPromptScope(next); patchWorkspace((draft) => { draft.settings = draft.settings || {}; draft.settings.globalPromptScope = next; }); }}><option value="clip">This clip (all its segments)</option><option value="scene">This scene (all clips in this S##)</option><option value="chapter">This chapter (all of this H##)</option><option value="project">Entire project</option></select><button type="button" className="button secondary" disabled={Boolean(busy) || !workspace?.premiere?.clipId} onClick={() => saveGlobalPrompt()}>{busy === "global" ? "Saving…" : "Save global"}</button></div><textarea value={workspace.timeline.global_prompt || ""} onChange={(event) => patchWorkspace((draft) => { draft.timeline.global_prompt = event.target.value; })} /><details><summary>Negative prompt and delivery settings</summary><textarea value={workspace.settings.negativePrompt || ""} onChange={(event) => patchWorkspace((draft) => { draft.settings.negativePrompt = event.target.value; })} /></details></article>
      </section></>
      {referencePickerOpen && referenceTarget ? <AssetReferencePicker
        project={project}
        targetLabel={referenceTarget.label}
        initialReferences={editableReferences}
        saving={storyboardSaving}
        onCancel={() => setReferencePickerOpen(false)}
        onApply={applySelectedReferences}
      /> : null}
    </main>
  );
}
