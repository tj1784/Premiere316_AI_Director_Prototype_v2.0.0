import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useStore } from "../store";
import { openAssetAction } from "../contextual-agency";

function openSequenceSlot(intent: any) {
  openAssetAction({
    sourceRoute: "/direct/sequence",
    ...intent
  });
}

function openWorkspaceRoute(path: string) {
  const params = new URLSearchParams(window.location.search);
  window.history.pushState({}, "", `${path}${params.size ? `?${params}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

import {
  activeStoryCut,
  insertAudio,
  insertVideo,
  mediaDuration,
  moveAudioClip,
  moveVideoClip,
  newEditorSequence,
  patchTimelineClip,
  projectMediaUrl,
  removeTimelineClip,
  sequenceDuration,
  splitVideoClip,
  trimVideoClip,
  videoClipAtTime
} from "../sequence-editor-state.js";

type TakeFilter = "active" | "latest" | "all";
type LibraryTab = "video" | "audio";
type TrackName = "V1" | "A1" | "M1";

type ApiFailure = Error & { status?: number; data?: any };

const panel: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  border: "1px solid #273244",
  borderRadius: 7,
  background: "#101721",
  color: "#dce4ef"
};

const button: React.CSSProperties = {
  minHeight: 28,
  padding: "5px 9px",
  border: "1px solid #354359",
  borderRadius: 5,
  background: "#172131",
  color: "#cbd5e2",
  cursor: "pointer",
  font: "inherit"
};

const primaryButton: React.CSSProperties = {
  ...button,
  borderColor: "#7658d5",
  background: "linear-gradient(180deg, #7656dd, #5135aa)",
  color: "white",
  fontWeight: 750
};

const field: React.CSSProperties = {
  width: "100%",
  minHeight: 29,
  boxSizing: "border-box",
  border: "1px solid #344156",
  borderRadius: 5,
  background: "#090e16",
  color: "#dce5f0",
  padding: "5px 7px",
  font: "inherit"
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  color: "#8795a8",
  fontSize: 11
};

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sameSequence(left: any, right: any) {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return left === right; }
}

function timecode(seconds: number, fps: number) {
  const safeFps = Math.max(1, Math.round(finite(fps, 24)));
  const frames = Math.max(0, Math.round(finite(seconds) * safeFps));
  const frame = frames % safeFps;
  const totalSeconds = Math.floor(frames / safeFps);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return [hour, minute, second, frame].map((part) => String(part).padStart(2, "0")).join(":");
}

function seconds(value: unknown) {
  const number = Math.max(0, finite(value));
  return `${number >= 10 ? number.toFixed(1) : number.toFixed(2)}s`;
}

function dbGain(value: unknown) {
  return clamp(Math.pow(10, finite(value) / 20), 0, 1);
}

function sourceUrl(slug: string, relativeFile: string) {
  return projectMediaUrl(slug, relativeFile);
}

async function jsonRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || "Request failed") as ApiFailure;
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function inputOwnsShortcut(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function mediaTitle(item: any) {
  const take = item.takeNumber != null ? `Take ${item.takeNumber}` : item.recordedVersion != null ? `v${item.recordedVersion}` : "";
  return [item.clipName || item.name || item.fileName, take].filter(Boolean).join(" · ");
}

function Waveform({ color = "#35c6bc" }: { color?: string }) {
  return (
    <span className="sequence-edit-waveform" aria-hidden="true" style={{ position: "absolute", inset: 3, display: "flex", alignItems: "center", gap: 1, opacity: .8, overflow: "hidden" }}>
      {Array.from({ length: 48 }, (_, index) => (
        <i key={index} style={{ flex: "1 0 1px", height: `${22 + ((index * 29) % 72)}%`, background: color, borderRadius: 1 }} />
      ))}
    </span>
  );
}

export default function SequenceEditorWorkspace(
  { onOpenAssets }: { onOpenAssets?: () => void } = {}
) {
  const project = useStore((state) => state.project);
  const jobs = useStore((state) => state.jobs);
  const refreshQueue = useStore((state) => state.refreshQueue);
  const slug = String(project?.slug || "");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [documentState, setDocumentState] = useState<any>(null);
  const [library, setLibrary] = useState<any>({ videos: [], audio: [], counts: {} });
  const [sequence, setSequence] = useState<any>(null);
  const [takeFilter, setTakeFilter] = useState<TakeFilter>("active");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("video");
  const [search, setSearch] = useState("");
  const [sceneFilter, setSceneFilter] = useState("");
  const [sourceMediaId, setSourceMediaId] = useState("");
  const [sourceInSec, setSourceInSec] = useState(0);
  const [sourceOutSec, setSourceOutSec] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [playheadSec, setPlayheadSec] = useState(0);
  const [programPlaying, setProgramPlaying] = useState(false);
  const [zoom, setZoom] = useState(54);
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [probing, setProbing] = useState(false);
  const [appendingCut, setAppendingCut] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportJobId, setExportJobId] = useState("");
  const [dragVideoId, setDragVideoId] = useState("");
  const [sourcePlaybackError, setSourcePlaybackError] = useState<{ id: string; message: string } | null>(null);
  const [programPlaybackError, setProgramPlaybackError] = useState<{ id: string; message: string } | null>(null);

  const sequenceRef = useRef<any>(null);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<any>(null);
  const revisionRef = useRef(0);
  const editVersionRef = useRef(0);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const gestureRef = useRef(false);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const sourceAudioRef = useRef<HTMLAudioElement>(null);
  const programVideoRef = useRef<HTMLVideoElement>(null);
  const auxiliaryAudioRefs = useRef(new Map<string, HTMLAudioElement>());
  const audioUploadRef = useRef<HTMLInputElement>(null);
  const mediaRefreshBusyRef = useRef(false);
  const autoProbeAttemptRef = useRef(new Set<string>());

  const replaceLoadedDocument = useCallback((payload: any) => {
    const nextDocument = payload.document || {};
    const nextSequence = nextDocument.sequence || newEditorSequence(payload.project || {});
    setDocumentState(nextDocument);
    setLibrary(payload.library || { videos: [], audio: [], counts: {} });
    setSequence(nextSequence);
    sequenceRef.current = nextSequence;
    revisionRef.current = finite(nextDocument.revision);
    dirtyRef.current = false;
    conflictRef.current = null;
    editVersionRef.current = 0;
    setDirty(false);
    setConflict(null);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedClipId(nextSequence.videoClips?.[0]?.id || nextSequence.audioClips?.[0]?.id || "");
    setPlayheadSec(0);
    const firstMedia = payload.library?.videos?.find((item: any) => item.available && item.isActiveTake)
      || payload.library?.videos?.find((item: any) => item.available)
      || payload.library?.audio?.find((item: any) => item.available);
    setSourceMediaId(firstMedia?.id || "");
  }, []);

  const loadEditor = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setLoadError("");
    try {
      const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor`);
      replaceLoadedDocument(payload);
    } catch (error: any) {
      setLoadError(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  }, [replaceLoadedDocument, slug]);

  const refreshMedia = useCallback(async (quiet = false) => {
    if (!slug || mediaRefreshBusyRef.current) return null;
    mediaRefreshBusyRef.current = true;
    if (!quiet) setRefreshingMedia(true);
    try {
      const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor`);
      // A media refresh deliberately never replaces the edit document or local sequence.
      setLibrary(payload.library || { videos: [], audio: [], counts: {} });
      if (!quiet) setNotice("Media refreshed. Your local edit was preserved.");
      return payload;
    } catch (error: any) {
      if (!quiet) setNotice(`Media refresh failed: ${String(error?.message || error)}`);
      return null;
    } finally {
      mediaRefreshBusyRef.current = false;
      if (!quiet) setRefreshingMedia(false);
    }
  }, [slug]);

  useEffect(() => { void loadEditor(); }, [loadEditor]);

  useEffect(() => {
    if (!slug) return;
    const timer = window.setInterval(() => { void refreshMedia(true); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshMedia, slug]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  const commitTransition = useCallback((historyBase: any, next: any, selectId?: string) => {
    if (!historyBase || !next || sameSequence(historyBase, next)) return;
    setUndoStack((items) => [...items.slice(-59), clone(historyBase)]);
    setRedoStack([]);
    sequenceRef.current = next;
    setSequence(next);
    dirtyRef.current = true;
    setDirty(true);
    editVersionRef.current += 1;
    conflictRef.current = null;
    setConflict(null);
    if (selectId != null) setSelectedClipId(selectId);
  }, []);

  const commit = useCallback((next: any, selectId?: string) => {
    commitTransition(sequenceRef.current, next, selectId);
  }, [commitTransition]);

  const performSave = useCallback(async () => {
    if (!slug || !sequenceRef.current || !dirtyRef.current || conflictRef.current || gestureRef.current) return !dirtyRef.current;
    if (savingPromiseRef.current) return savingPromiseRef.current;
    const snapshot = clone(sequenceRef.current);
    const snapshotVersion = editVersionRef.current;
    const expectedRevision = revisionRef.current;
    const promise = (async () => {
      setSaving(true);
      try {
        const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor/sequence`, {
          method: "PUT",
          body: JSON.stringify({ sequence: snapshot, expectedRevision })
        });
        const savedDocument = payload.document || {};
        revisionRef.current = finite(savedDocument.revision, expectedRevision + 1);
        setDocumentState(savedDocument);
        if (editVersionRef.current === snapshotVersion) {
          const normalized = savedDocument.sequence || snapshot;
          sequenceRef.current = normalized;
          setSequence(normalized);
          dirtyRef.current = false;
          setDirty(false);
        }
        setNotice(`Edit saved · revision ${revisionRef.current}`);
        return true;
      } catch (error: any) {
        if (error?.status === 409) {
          const nextConflict = {
            message: String(error?.message || "The edit changed in another window."),
            current: error?.data?.current
          };
          conflictRef.current = nextConflict;
          setConflict(nextConflict);
        } else {
          setNotice(`Save failed: ${String(error?.message || error)}`);
        }
        return false;
      } finally {
        setSaving(false);
        savingPromiseRef.current = null;
        if (dirtyRef.current && !conflictRef.current && editVersionRef.current !== snapshotVersion) {
          window.setTimeout(() => { void saveRef.current(); }, 80);
        }
      }
    })();
    savingPromiseRef.current = promise;
    return promise;
  }, [slug]);

  saveRef.current = performSave;

  useEffect(() => {
    if (!dirty || conflict || gestureRef.current) return;
    const timer = window.setTimeout(() => { void performSave(); }, 900);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, performSave, sequence]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((items) => {
      if (!items.length || !sequenceRef.current) return items;
      const previous = items[items.length - 1];
      setRedoStack((redo) => [...redo.slice(-59), clone(sequenceRef.current)]);
      sequenceRef.current = previous;
      setSequence(previous);
      dirtyRef.current = true;
      setDirty(true);
      editVersionRef.current += 1;
      setSelectedClipId((selected) => [
        ...(previous.videoClips || []),
        ...(previous.audioClips || [])
      ].some((clip: any) => clip.id === selected) ? selected : "");
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((items) => {
      if (!items.length || !sequenceRef.current) return items;
      const next = items[items.length - 1];
      setUndoStack((undoItems) => [...undoItems.slice(-59), clone(sequenceRef.current)]);
      sequenceRef.current = next;
      setSequence(next);
      dirtyRef.current = true;
      setDirty(true);
      editVersionRef.current += 1;
      return items.slice(0, -1);
    });
  }, []);

  const totalDuration = useMemo(() => sequence ? sequenceDuration(sequence) : 0, [sequence]);
  const fps = Math.max(1, finite(sequence?.fps || project?.settings?.fps, 24));
  const selectedTimelineClip = useMemo(() => [
    ...(sequence?.videoClips || []),
    ...(sequence?.audioClips || [])
  ].find((clip: any) => clip.id === selectedClipId) || null, [selectedClipId, sequence]);
  const selectedIsVideo = Boolean(selectedTimelineClip && selectedTimelineClip.track === "V1");

  const videos = library?.videos || [];
  const audio = library?.audio || [];
  const allMedia = useMemo(() => [...videos, ...audio], [audio, videos]);
  const selectedMedia = allMedia.find((item: any) => item.id === sourceMediaId) || null;
  const selectedMediaIsVideo = selectedMedia?.kind === "video";
  const selectedVideoIsExact = Boolean(
    selectedMediaIsVideo
    && selectedMedia?.available
    && selectedMedia?.metadataStatus === "probed"
    && finite(selectedMedia?.durationSec) > 0
  );
  const selectedAudioIsExact = Boolean(
    selectedMedia?.kind === "audio"
    && selectedMedia?.available
    && selectedMedia?.metadataStatus === "probed"
    && finite(selectedMedia?.durationSec) > 0
  );

  const sceneOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of videos) {
      if (item.sceneId) byId.set(String(item.sceneId), String(item.sceneTitle || item.sceneId));
    }
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const query = search.trim().toLowerCase();
    return videos.filter((item: any) => {
      if (takeFilter === "active" && !item.isActiveTake) return false;
      if (takeFilter === "latest" && !item.isLatestTake) return false;
      if (sceneFilter && String(item.sceneId || "") !== sceneFilter) return false;
      if (query && ![
        item.name, item.fileName, item.clipName, item.sceneTitle, item.segmentId, item.prompt
      ].some((value) => String(value || "").toLowerCase().includes(query))) return false;
      return true;
    }).sort((left: any, right: any) =>
      finite(left.editorialIndex, Number.MAX_SAFE_INTEGER) - finite(right.editorialIndex, Number.MAX_SAFE_INTEGER)
      || finite(right.takeNumber) - finite(left.takeNumber)
      || String(left.name || "").localeCompare(String(right.name || ""))
    );
  }, [sceneFilter, search, takeFilter, videos]);

  const filteredAudio = useMemo(() => {
    const query = search.trim().toLowerCase();
    return audio.filter((item: any) => !query || [item.name, item.fileName, item.source]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [audio, search]);

  useEffect(() => {
    if (!selectedMedia) return;
    const duration = mediaDuration(selectedMedia, selectedMedia.kind === "audio" ? 30 : 5);
    setSourceInSec(0);
    setSourceOutSec(duration);
    setSourceTime(0);
  }, [selectedMedia?.id]);

  const patchProbeResult = useCallback((result: any) => {
    if (!result?.ok || !result.relativeFile) return;
    const probe = result.probe || {};
    const mediaPatch = {
      durationSec: finite(probe.durationSec),
      width: finite(probe.video?.width),
      height: finite(probe.video?.height),
      fps: finite(probe.video?.fps || probe.video?.frameRate),
      hasAudio: Boolean(probe.audio),
      sampleRate: finite(probe.audio?.sample_rate || probe.audio?.sampleRate),
      channels: finite(probe.audio?.channels),
      bytes: result.bytes,
      mtimeMs: result.mtimeMs,
      metadataStatus: "probed"
    };
    setLibrary((current: any) => ({
      ...current,
      videos: (current.videos || []).map((item: any) => item.relativeFile === result.relativeFile ? { ...item, ...mediaPatch } : item),
      audio: (current.audio || []).map((item: any) => item.relativeFile === result.relativeFile ? { ...item, ...mediaPatch } : item)
    }));
  }, []);

  const probeMedia = useCallback(async (media: any) => {
    if (!slug || !media?.relativeFile || !media.available || probing) return;
    setProbing(true);
    try {
      const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor/media/probe`, {
        method: "POST",
        body: JSON.stringify({ files: [media.relativeFile] })
      });
      const result = payload.results?.[0];
      if (!result?.ok) throw new Error(result?.error || "The media could not be probed.");
      patchProbeResult(result);
      if (media.id === sourceMediaId && finite(result.probe?.durationSec) > 0) {
        setSourceOutSec(finite(result.probe.durationSec));
      }
    } catch (error: any) {
      setNotice(`Probe failed: ${String(error?.message || error)}`);
    } finally {
      setProbing(false);
    }
  }, [patchProbeResult, probing, slug, sourceMediaId]);

  useEffect(() => {
    if (!selectedMedia?.id || !selectedMedia.available || selectedMedia.metadataStatus === "probed" || probing) return;
    if (autoProbeAttemptRef.current.has(selectedMedia.id)) return;
    autoProbeAttemptRef.current.add(selectedMedia.id);
    void probeMedia(selectedMedia);
  }, [probing, selectedMedia?.id, selectedMedia?.metadataStatus]);

  const sourceElement = () => selectedMediaIsVideo ? sourceVideoRef.current : sourceAudioRef.current;

  const setMarkIn = () => {
    const current = finite(sourceElement()?.currentTime, sourceTime);
    setSourceInSec(Math.min(current, Math.max(0, sourceOutSec - (1 / fps))));
  };

  const setMarkOut = () => {
    const current = finite(sourceElement()?.currentTime, sourceTime);
    setSourceOutSec(Math.max(sourceInSec + (1 / fps), current));
  };

  const insertSelectedVideo = useCallback((append: boolean) => {
    if (sequenceRef.current?.trackSettings?.V1?.locked) {
      setNotice("Unlock V1 before inserting picture.");
      return;
    }
    if (!sequenceRef.current || !selectedMedia || selectedMedia.kind !== "video" || !selectedVideoIsExact) {
      setNotice("Probe this LTX take before inserting it so the edit uses its exact file duration.");
      return;
    }
    const current = sequenceRef.current;
    let atIndex = current.videoClips.length;
    if (!append) {
      const containing = videoClipAtTime(current, playheadSec);
      if (containing) {
        const index = current.videoClips.findIndex((clip: any) => clip.id === containing.id);
        const local = playheadSec - containing.timelineStartSec;
        const frame = 1 / fps;
        if (local >= frame && local <= containing.durationSec - frame) {
          const split = splitVideoClip(current, containing.id, playheadSec, fps);
          const next = insertVideo(split.sequence, selectedMedia, { sourceInSec, sourceOutSec, atIndex: index + 1 });
          const inserted = next.videoClips[index + 1];
          commit(next, inserted?.id);
          return;
        }
        atIndex = local < containing.durationSec / 2 ? index : index + 1;
      } else {
        atIndex = current.videoClips.findIndex((clip: any) => clip.timelineStartSec >= playheadSec);
        if (atIndex < 0) atIndex = current.videoClips.length;
      }
    }
    const next = insertVideo(current, selectedMedia, { sourceInSec, sourceOutSec, atIndex });
    commit(next, next.videoClips[atIndex]?.id);
  }, [commit, fps, playheadSec, selectedMedia, selectedVideoIsExact, sourceInSec, sourceOutSec]);

  const appendActiveCut = async () => {
    if (!sequenceRef.current || appendingCut) return;
    if (sequenceRef.current.trackSettings?.V1?.locked) {
      setNotice("Unlock V1 before appending the active story cut.");
      return;
    }
    const storyCut = activeStoryCut(videos, sceneFilter ? { sceneId: sceneFilter } : {});
    const playable = storyCut.filter((item: any) => item.available && item.relativeFile);
    if (!playable.length) return setNotice("No playable active LTX takes are available for this scope.");
    setAppendingCut(true);
    try {
      const needsProbe = playable.filter((item: any) => item.metadataStatus !== "probed" || finite(item.durationSec) <= 0);
      const resultByFile = new Map<string, any>();
      for (let index = 0; index < needsProbe.length; index += 120) {
        const batch = needsProbe.slice(index, index + 120);
        const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor/media/probe`, {
          method: "POST",
          body: JSON.stringify({ files: batch.map((item: any) => item.relativeFile) })
        });
        for (const result of payload.results || []) resultByFile.set(result.relativeFile, result);
      }

      const resolved = playable.map((item: any) => {
        if (item.metadataStatus === "probed" && finite(item.durationSec) > 0) return item;
        const result = resultByFile.get(item.relativeFile);
        const durationSec = finite(result?.probe?.durationSec);
        if (!result?.ok || durationSec <= 0) return null;
        return {
          ...item,
          durationSec,
          width: finite(result.probe?.video?.width, item.width),
          height: finite(result.probe?.video?.height, item.height),
          fps: finite(result.probe?.video?.fps || result.probe?.video?.frameRate, item.fps),
          hasAudio: Boolean(result.probe?.audio),
          bytes: result.bytes,
          mtimeMs: result.mtimeMs,
          metadataStatus: "probed"
        };
      });
      const exact = resolved.filter(Boolean);
      const failedItems = playable.filter((_: any, index: number) => !resolved[index]);
      const failed = failedItems.length;
      const failedNames = failedItems.slice(0, 3).map((item: any) => mediaTitle(item)).join(", ");
      const failureDetail = failedNames ? ` (${failedNames}${failed > 3 ? ", …" : ""})` : "";

      if (resultByFile.size) {
        const resolvedByFile = new Map<string, any>(exact.map((item: any) => [item.relativeFile, item]));
        setLibrary((current: any) => ({
          ...current,
          videos: (current.videos || []).map((item: any) => resolvedByFile.has(item.relativeFile)
            ? { ...item, ...resolvedByFile.get(item.relativeFile) }
            : item)
        }));
      }
      if (!exact.length) {
        setNotice(`Active cut was not appended: ${failed} take${failed === 1 ? "" : "s"} failed exact-duration probing${failureDetail}.`);
        return;
      }
      let next = sequenceRef.current;
      let insertedId = "";
      for (const item of exact) {
        next = insertVideo(next, item);
        insertedId = next.videoClips.at(-1)?.id || insertedId;
      }
      commit(next, insertedId);
      setNotice(`Appended ${exact.length} exact-duration active take${exact.length === 1 ? "" : "s"}${failed ? `; ${failed} failed probing and were skipped${failureDetail}` : ""}.`);
    } catch (error: any) {
      setNotice(`Active cut was not appended: ${String(error?.message || error)}`);
    } finally {
      setAppendingCut(false);
    }
  };

  const addSelectedAudio = (track: "A1" | "M1") => {
    if (sequenceRef.current?.trackSettings?.[track]?.locked) {
      setNotice(`Unlock ${track} before placing audio.`);
      return;
    }
    if (!sequenceRef.current || !selectedMedia || selectedMedia.kind !== "audio" || !selectedAudioIsExact) {
      setNotice("Probe this audio file before placing it so the mix uses its exact duration.");
      return;
    }
    if ((sequenceRef.current.audioClips || []).length >= 64) {
      setNotice("This edit already has the maximum 64 positioned A1/M1 clips. Remove one before adding another.");
      return;
    }
    const next = insertAudio(sequenceRef.current, selectedMedia, {
      sourceInSec,
      sourceOutSec,
      timelineStartSec: playheadSec,
      track
    });
    commit(next, next.audioClips.at(-1)?.id);
  };

  const splitSelected = useCallback(() => {
    if (!sequenceRef.current) return;
    const clip = selectedTimelineClip?.track === "V1" ? selectedTimelineClip : videoClipAtTime(sequenceRef.current, playheadSec);
    if (!clip || sequenceRef.current.trackSettings?.V1?.locked) return;
    const result = splitVideoClip(sequenceRef.current, clip.id, playheadSec, fps);
    if (!result.createdClipId) return setNotice("Move the playhead inside a video clip before splitting.");
    commit(result.sequence, result.createdClipId);
  }, [commit, fps, playheadSec, selectedTimelineClip]);

  const deleteSelected = useCallback(() => {
    if (!sequenceRef.current || !selectedTimelineClip) return;
    const track = selectedTimelineClip.track as TrackName;
    if (sequenceRef.current.trackSettings?.[track]?.locked) return;
    commit(removeTimelineClip(sequenceRef.current, selectedTimelineClip.id), "");
  }, [commit, selectedTimelineClip]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (inputOwnsShortcut(event.target)) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void performSave();
      } else if (command && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        splitSelected();
      } else if (event.code === "Space") {
        event.preventDefault();
        setProgramPlaying((playing) => !playing);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [deleteSelected, performSave, redo, splitSelected, undo]);

  const currentProgramClip = useMemo(() => sequence ? videoClipAtTime(sequence, playheadSec) : null, [playheadSec, sequence]);
  const currentProgramUrl = currentProgramClip ? sourceUrl(slug, currentProgramClip.sourceFile) : "";

  const syncAuxiliaryAudio = useCallback((globalTime: number, playing: boolean) => {
    if (!sequenceRef.current) return;
    for (const clip of sequenceRef.current.audioClips || []) {
      const element = auxiliaryAudioRefs.current.get(clip.id);
      if (!element) continue;
      const track = sequenceRef.current.trackSettings?.[clip.track] || {};
      const local = globalTime - finite(clip.timelineStartSec);
      const duration = Math.max(.001, finite(clip.durationSec));
      const active = local >= 0 && local < duration && !clip.muted && !track.muted;
      if (!active) {
        if (!element.paused) element.pause();
        continue;
      }
      const sourceSpan = Math.max(.001, finite(clip.sourceOutSec) - finite(clip.sourceInSec));
      const sourceOffset = clip.loop ? local % sourceSpan : Math.min(local, sourceSpan);
      const expected = finite(clip.sourceInSec) + sourceOffset;
      if (Math.abs(element.currentTime - expected) > .18) {
        try { element.currentTime = expected; } catch {}
      }
      const fadeIn = finite(clip.fadeInSec) > 0 ? clamp(local / finite(clip.fadeInSec), 0, 1) : 1;
      const fadeOut = finite(clip.fadeOutSec) > 0 ? clamp((duration - local) / finite(clip.fadeOutSec), 0, 1) : 1;
      element.volume = clamp(dbGain(finite(clip.volumeDb) + finite(track.volumeDb)) * fadeIn * fadeOut, 0, 1);
      element.muted = false;
      if (playing && element.paused) void element.play().catch(() => {});
      if (!playing && !element.paused) element.pause();
    }
  }, []);

  const seekProgramElement = useCallback((time: number, shouldPlay = programPlaying) => {
    if (!sequenceRef.current) return;
    const clip = videoClipAtTime(sequenceRef.current, time);
    if (!clip) return syncAuxiliaryAudio(time, shouldPlay);
    window.requestAnimationFrame(() => {
      const element = programVideoRef.current;
      if (!element) return;
      const desired = finite(clip.sourceInSec) + clamp(time - finite(clip.timelineStartSec), 0, finite(clip.durationSec));
      if (Math.abs(element.currentTime - desired) > .08) {
        try { element.currentTime = desired; } catch {}
      }
      element.muted = Boolean(clip.muted || sequenceRef.current?.trackSettings?.V1?.muted);
      element.volume = clamp(dbGain(finite(clip.volumeDb) + finite(sequenceRef.current?.trackSettings?.V1?.volumeDb)), 0, 1);
      if (shouldPlay) void element.play().catch(() => setProgramPlaying(false));
      else element.pause();
      syncAuxiliaryAudio(time, shouldPlay);
    });
  }, [programPlaying, syncAuxiliaryAudio]);

  useEffect(() => {
    seekProgramElement(playheadSec, programPlaying);
  }, [currentProgramClip?.id, currentProgramUrl]);

  useEffect(() => {
    if (!programPlaying) {
      programVideoRef.current?.pause();
      syncAuxiliaryAudio(playheadSec, false);
      return;
    }
    seekProgramElement(playheadSec, true);
  }, [programPlaying]);

  useEffect(() => {
    if (!programPlaying || currentProgramClip || totalDuration <= 0 || playheadSec >= totalDuration) return;
    const startedAt = playheadSec;
    const startedWallTime = performance.now();
    let animationFrame = 0;
    const tick = (now: number) => {
      const next = Math.min(totalDuration, startedAt + ((now - startedWallTime) / 1000));
      setPlayheadSec(next);
      syncAuxiliaryAudio(next, next < totalDuration);
      if (next >= totalDuration) {
        setProgramPlaying(false);
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [currentProgramClip?.id, programPlaying, syncAuxiliaryAudio, totalDuration]);

  const setProgramTime = (time: number, shouldPlay = programPlaying) => {
    const next = clamp(time, 0, Math.max(0, totalDuration));
    setPlayheadSec(next);
    seekProgramElement(next, shouldPlay);
  };

  const programTimeUpdate = () => {
    const element = programVideoRef.current;
    const clip = currentProgramClip;
    if (!element || !clip || !programPlaying) return;
    const local = element.currentTime - finite(clip.sourceInSec);
    const globalTime = finite(clip.timelineStartSec) + Math.max(0, local);
    const clipEnd = finite(clip.timelineStartSec) + finite(clip.durationSec);
    if (globalTime >= clipEnd - .025 || element.currentTime >= finite(clip.sourceOutSec) - .025) {
      const nextIndex = sequenceRef.current.videoClips.findIndex((item: any) => item.id === clip.id) + 1;
      const nextClip = sequenceRef.current.videoClips[nextIndex];
      if (nextClip) {
        setProgramTime(nextClip.timelineStartSec, true);
      } else if (totalDuration > clipEnd + (1 / fps)) {
        setProgramTime(Math.min(totalDuration, clipEnd + (0.5 / fps)), true);
      } else {
        setProgramPlaying(false);
        setProgramTime(Math.min(totalDuration, clipEnd), false);
      }
      return;
    }
    setPlayheadSec(globalTime);
    syncAuxiliaryAudio(globalTime, true);
  };

  const beginVideoTrim = (event: React.PointerEvent, clip: any, edge: "start" | "end") => {
    event.preventDefault();
    event.stopPropagation();
    if (!sequenceRef.current || sequenceRef.current.trackSettings?.V1?.locked) return;
    setSelectedClipId(clip.id);
    const base = clone(sequenceRef.current);
    const startX = event.clientX;
    let moved = false;
    gestureRef.current = true;
    const move = (nextEvent: PointerEvent) => {
      const delta = (nextEvent.clientX - startX) / zoom;
      if (Math.abs(delta) < .01) return;
      moved = true;
      const next = trimVideoClip(base, clip.id, edge, delta, fps);
      sequenceRef.current = next;
      setSequence(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      gestureRef.current = false;
      if (moved) commitTransition(base, sequenceRef.current, clip.id);
      else {
        sequenceRef.current = base;
        setSequence(base);
      }
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      gestureRef.current = false;
      sequenceRef.current = base;
      setSequence(base);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const beginAudioMove = (event: React.PointerEvent, clip: any) => {
    event.preventDefault();
    event.stopPropagation();
    if (!sequenceRef.current || sequenceRef.current.trackSettings?.[clip.track]?.locked) return;
    setSelectedClipId(clip.id);
    setPlayheadSec(finite(clip.timelineStartSec));
    const base = clone(sequenceRef.current);
    const startX = event.clientX;
    let moved = false;
    gestureRef.current = true;
    const move = (nextEvent: PointerEvent) => {
      const delta = (nextEvent.clientX - startX) / zoom;
      if (Math.abs(delta) < .01) return;
      moved = true;
      const next = moveAudioClip(base, clip.id, finite(clip.timelineStartSec) + delta);
      sequenceRef.current = next;
      setSequence(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      gestureRef.current = false;
      if (moved) commitTransition(base, sequenceRef.current, clip.id);
      else {
        sequenceRef.current = base;
        setSequence(base);
      }
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      gestureRef.current = false;
      sequenceRef.current = base;
      setSequence(base);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const patchSelectedClip = (patch: any) => {
    if (!sequenceRef.current || !selectedTimelineClip) return;
    if (sequenceRef.current.trackSettings?.[selectedTimelineClip.track]?.locked) {
      setNotice(`Unlock ${selectedTimelineClip.track} before changing this clip.`);
      return;
    }
    commit(patchTimelineClip(sequenceRef.current, selectedTimelineClip.id, patch), selectedTimelineClip.id);
  };

  const patchTrack = (track: TrackName, patch: any) => {
    if (!sequenceRef.current) return;
    const current = sequenceRef.current;
    commit({
      ...current,
      trackSettings: {
        ...current.trackSettings,
        [track]: { ...(current.trackSettings?.[track] || {}), ...patch }
      },
      updatedAt: new Date().toISOString()
    });
  };

  const uploadAudio = async (file: File) => {
    if (!slug) return;
    const body = new FormData();
    body.append("file", file);
    setUploading(true);
    try {
      const importedPayload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor/media/audio`, { method: "POST", body });
      const payload = await refreshMedia(true);
      const imported = importedPayload.imported;
      const media = payload?.library?.audio?.find((item: any) => item.relativeFile === imported?.relativeFile);
      if (media) {
        setLibraryTab("audio");
        setSourceMediaId(media.id);
        openSequenceSlot({
          sourceEntity: { type: "timeline-item", id: "A1", label: media.name || file.name },
          requirement: { relationship: "sequence.audioAtPlayhead", category: "sound", expectedMediaType: "audio", assetId: media.id },
          initialAction: "attach",
          slotState: "unapproved",
          returnFocusId: "sequence-editor-add-a1"
        });
      }
      setNotice(`Imported ${file.name}. Selected in the bin. Place on A1 at playhead or save as a canonical sound asset.`);
    } catch (error: any) {
      setNotice(`Audio import failed: ${String(error?.message || error)}`);
    } finally {
      setUploading(false);
      if (audioUploadRef.current) audioUploadRef.current.value = "";
    }
  };

  const ensureSaved = async () => {
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (dirtyRef.current && !conflictRef.current) await performSave();
    if (savingPromiseRef.current) await savingPromiseRef.current;
    return !dirtyRef.current && !conflictRef.current;
  };

  const exportEdit = async () => {
    if (!sequenceRef.current?.videoClips?.length || exporting) return;
    setExporting(true);
    try {
      if (!await ensureSaved()) throw new Error("Resolve the save conflict before exporting.");
      const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor/export`, {
        method: "POST",
        body: JSON.stringify({ revision: revisionRef.current })
      });
      setExportJobId(payload.job?.id || "");
      setDocumentState(payload.document || documentState);
      setNotice("Export queued. Picture and positioned audio will be conformed into a master.");
      void refreshQueue();
    } catch (error: any) {
      if (error?.status === 409) {
        const nextConflict = { message: String(error.message), current: error.data?.current };
        conflictRef.current = nextConflict;
        setConflict(nextConflict);
      }
      setNotice(`Export failed: ${String(error?.message || error)}`);
    } finally {
      setExporting(false);
    }
  };

  const cancelExport = async () => {
    if (!exportJobId) return;
    try {
      const payload = await jsonRequest(`/api/queue/${encodeURIComponent(exportJobId)}/cancel`, {
        method: "POST",
        body: "{}"
      });
      setNotice(payload.ok ? "Stopping editor export…" : "The export could not be stopped at its current stage.");
      void refreshQueue();
    } catch (error: any) {
      setNotice(`Could not stop export: ${String(error?.message || error)}`);
    }
  };

  const currentExportJob = jobs.find((job: any) => job.id === exportJobId);
  useEffect(() => {
    if (!exportJobId) return;
    const timer = window.setInterval(() => { void refreshQueue(); }, 1_500);
    return () => window.clearInterval(timer);
  }, [exportJobId, refreshQueue]);

  useEffect(() => {
    if (!exportJobId || !currentExportJob) return;
    if (currentExportJob.status === "done") {
      setNotice("Export complete. The new master is ready below.");
      setExportJobId("");
      void (async () => {
        try {
          const payload = await jsonRequest(`/api/projects/${encodeURIComponent(slug)}/editor`);
          setLibrary(payload.library || library);
          setDocumentState((current: any) => ({
            ...current,
            exports: payload.document?.exports || current?.exports || [],
            activeExportVersion: payload.document?.activeExportVersion ?? current?.activeExportVersion
          }));
        } catch {}
      })();
    } else if (currentExportJob.status === "error" || currentExportJob.status === "cancelled") {
      setNotice(`Export ${currentExportJob.status}: ${currentExportJob.error || "No master was created."}`);
      setExportJobId("");
    }
  }, [currentExportJob?.status, exportJobId, slug]);

  const useServerConflictVersion = () => {
    const current = conflictRef.current?.current;
    if (!current?.sequence) return;
    replaceLoadedDocument({ document: current, library, project });
    setNotice(`Loaded server revision ${current.revision}.`);
  };

  const keepLocalConflictVersion = async () => {
    const current = conflictRef.current?.current;
    if (!current) return;
    revisionRef.current = finite(current.revision);
    setDocumentState(current);
    conflictRef.current = null;
    setConflict(null);
    dirtyRef.current = true;
    setDirty(true);
    await performSave();
  };

  const laneWidth = Math.max(1080, totalDuration * zoom + 160);
  const rulerTicks = useMemo(() => {
    const step = zoom >= 80 ? 1 : zoom >= 42 ? 2 : 5;
    const output: number[] = [];
    for (let value = 0; value <= Math.ceil(totalDuration + 2); value += step) output.push(value);
    return output;
  }, [totalDuration, zoom]);

  if (loading) {
    return <main className="sequence-edit-workspace-loading" data-testid="sequence-editor-workspace" style={{ flex: 1, display: "grid", placeItems: "center", background: "#090d14", color: "#93a0b3" }}>Loading full edit room…</main>;
  }

  if (loadError || !sequence) {
    return (
      <main className="sequence-edit-workspace-error" data-testid="sequence-editor-workspace" style={{ flex: 1, display: "grid", placeItems: "center", background: "#090d14", color: "#e69aa5" }}>
        <div className="sequence-edit-error-card" style={{ ...panel, padding: 24, maxWidth: 540 }}>
          <h2>Sequence Editor could not open</h2>
          <p>{loadError || "No edit document was returned."}</p>
          <button className="sequence-edit-retry" style={primaryButton} onClick={() => void loadEditor()}>Retry</button>
        </div>
      </main>
    );
  }

  const trackRow = (track: TrackName, title: string, children: React.ReactNode, testId: string) => {
    const settings = sequence.trackSettings?.[track] || {};
    return (
      <div className={`sequence-edit-track-row sequence-edit-track-${track.toLowerCase()}`} data-testid={testId} style={{ display: "grid", gridTemplateColumns: "128px 1fr", height: track === "V1" ? 72 : 50, borderBottom: "1px solid #1d2734" }}>
        <div className="sequence-edit-track-label" style={{ position: "sticky", left: 0, zIndex: 15, display: "grid", gridTemplateColumns: "32px 1fr 25px 25px", alignItems: "center", gap: 4, padding: "0 7px", background: "#121a25", borderRight: "1px solid #293547" }}>
          <b className="sequence-edit-track-code" style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid #3a485d", borderRadius: 5, color: track === "M1" ? "#c2a4ff" : track === "A1" ? "#72d6cf" : "#efb178" }}>{track}</b>
          <span className="sequence-edit-track-name" style={{ fontSize: 10, fontWeight: 750, color: "#aeb9c8" }}>{title}</span>
          <button className="sequence-edit-track-mute" data-testid={`sequence-editor-${track.toLowerCase()}-mute`} title={`${settings.muted ? "Unmute" : "Mute"} ${track}`} style={{ ...button, minHeight: 24, padding: 0, color: settings.muted ? "#ff9a76" : "#7f8da1" }} onClick={() => patchTrack(track, { muted: !settings.muted })}>M</button>
          <button className="sequence-edit-track-lock" data-testid={`sequence-editor-${track.toLowerCase()}-lock`} title={`${settings.locked ? "Unlock" : "Lock"} ${track}`} style={{ ...button, minHeight: 24, padding: 0, color: settings.locked ? "#d3bd73" : "#7f8da1" }} onClick={() => patchTrack(track, { locked: !settings.locked })}>{settings.locked ? "▣" : "□"}</button>
        </div>
        <div
          className="sequence-edit-track-lane"
          style={{ position: "relative", minWidth: 0, height: "100%", backgroundColor: settings.locked ? "rgba(60,53,33,.16)" : "#090e15", backgroundImage: "linear-gradient(90deg, transparent calc(100% - 1px), rgba(111,126,148,.08) 100%)", backgroundSize: `${zoom}px 100%` }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setProgramTime((event.clientX - rect.left) / zoom, false);
            setProgramPlaying(false);
          }}
          onDragOver={track === "V1" ? (event) => event.preventDefault() : undefined}
          onDrop={track === "V1" ? (event) => {
            event.preventDefault();
            if (!dragVideoId || sequence.trackSettings?.V1?.locked) return;
            commit(moveVideoClip(sequenceRef.current, dragVideoId, sequenceRef.current.videoClips.length), dragVideoId);
            setDragVideoId("");
          } : undefined}
        >
          {children}
          <i className="sequence-edit-playhead" data-testid={`sequence-editor-${track.toLowerCase()}-playhead`} style={{ pointerEvents: "none", position: "absolute", zIndex: 12, top: 0, bottom: 0, left: playheadSec * zoom, width: 1, background: "#31a6ff", boxShadow: "0 0 8px rgba(49,166,255,.5)" }} />
        </div>
      </div>
    );
  };

  return (
    <main
      className="sequence-edit-workspace"
      data-testid="sequence-editor-workspace"
      style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8, display: "grid", gridTemplateRows: "44px 390px 330px minmax(250px, auto)", gap: 8, background: "#090d14", color: "#dce4ef", fontSize: 12 }}
    >
      <header className="sequence-edit-header" style={{ ...panel, display: "flex", alignItems: "center", gap: 9, padding: "0 11px", overflow: "visible" }}>
        <div className="sequence-edit-title" style={{ minWidth: 190 }}><b>{sequence.name}</b><small style={{ display: "block", color: "#78869a", marginTop: 2 }}>{sequence.width}×{sequence.height} · {fps} fps · {timecode(totalDuration, fps)}</small></div>
        <button className="sequence-edit-undo" data-testid="sequence-editor-undo" style={button} disabled={!undoStack.length} onClick={undo}>↶ Undo</button>
        <button className="sequence-edit-redo" data-testid="sequence-editor-redo" style={button} disabled={!redoStack.length} onClick={redo}>↷ Redo</button>
        <button className="sequence-edit-save" data-testid="sequence-editor-save" style={button} disabled={!dirty || saving || Boolean(conflict)} onClick={() => void performSave()}>{saving ? "Saving…" : "Save now"}</button>
        <span className="sequence-edit-save-state" data-testid="sequence-editor-save-state" style={{ color: conflict ? "#ff9c7c" : dirty ? "#e4bd73" : "#66d79a", fontWeight: 700 }}>
          {conflict ? "CONFLICT" : saving ? "SAVING" : dirty ? "UNSAVED" : `SAVED · R${revisionRef.current}`}
        </span>
        <span className="sequence-edit-header-spacer" style={{ flex: 1 }} />
        <span className="sequence-edit-notice" role="status" title={notice} style={{ maxWidth: 440, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8493a7" }}>{notice}</span>
        <button className="sequence-edit-refresh-media" data-testid="sequence-editor-refresh-media" style={button} disabled={refreshingMedia} onClick={() => void refreshMedia(false)}>{refreshingMedia ? "Refreshing…" : "↻ Refresh Media"}</button>
        <button type="button" style={button} onClick={() => openAssetAction({
          sourceRoute: "/direct/sequence",
          sourceEntity: { type: "sequence", id: sequence.id || "sequence", label: sequence.name || "Sequence" },
          requirement: { relationship: "sequence.media", category: "atmosphere", expectedMediaType: "image" },
          initialAction: "generate",
          slotState: "missing"
        })}>Generate missing media</button>
      </header>

      {conflict ? (
        <section className="sequence-edit-conflict" data-testid="sequence-editor-conflict" style={{ position: "fixed", zIndex: 1000, inset: "72px 20px auto", maxWidth: 700, margin: "0 auto", border: "1px solid #9a533e", borderRadius: 8, background: "#2d1917", color: "#f3c1ad", padding: 14, boxShadow: "0 14px 50px rgba(0,0,0,.5)" }}>
          <b>Another editor saved this sequence</b>
          <p style={{ margin: "6px 0 10px" }}>{conflict.message} Choose which version to keep.</p>
          <div className="sequence-edit-conflict-actions" style={{ display: "flex", gap: 7 }}>
            <button className="sequence-edit-conflict-server" data-testid="sequence-editor-conflict-use-server" style={button} onClick={useServerConflictVersion}>Use server version</button>
            <button className="sequence-edit-conflict-local" data-testid="sequence-editor-conflict-keep-local" style={primaryButton} onClick={() => void keepLocalConflictVersion()}>Keep my edit as next revision</button>
          </div>
        </section>
      ) : null}

      <section className="sequence-edit-top" style={{ display: "grid", gridTemplateColumns: "320px minmax(630px, 1fr) 290px", gap: 8, minWidth: 1260, minHeight: 0 }}>
        <aside className="sequence-edit-library" style={{ ...panel, display: "flex", flexDirection: "column" }}>
          <div className="sequence-edit-panel-heading" style={{ height: 39, flex: "0 0 39px", display: "flex", alignItems: "center", gap: 6, padding: "0 9px", borderBottom: "1px solid #293447" }}>
            <b>LTX TAKES + MEDIA</b>
            <span className="sequence-edit-library-counts" data-testid="sequence-editor-library-counts" style={{ marginLeft: "auto", color: "#7f8da1", fontSize: 10 }}>{library.counts?.playableVideos || 0}/{library.counts?.videos || videos.length} video · {library.counts?.playableAudio || 0} audio</span>
          </div>
          <div className="sequence-edit-library-tabs" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, padding: "7px 7px 0" }}>
            <button className="sequence-edit-library-video-tab" data-testid="sequence-editor-library-video-tab" style={{ ...button, borderColor: libraryTab === "video" ? "#8265e6" : "#354359" }} onClick={() => setLibraryTab("video")}>Video takes</button>
            <button className="sequence-edit-library-audio-tab" data-testid="sequence-editor-library-audio-tab" style={{ ...button, borderColor: libraryTab === "audio" ? "#8265e6" : "#354359" }} onClick={() => setLibraryTab("audio")}>Sound + music</button>
          </div>
          <div className="sequence-edit-library-search" style={{ display: "grid", gridTemplateColumns: "1fr 116px", gap: 5, padding: 7 }}>
            <input className="sequence-edit-search-input" data-testid="sequence-editor-library-search" style={field} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media" />
            <select className="sequence-edit-scene-filter" data-testid="sequence-editor-scene-filter" style={field} value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value)}>
              <option value="">All scenes</option>
              {sceneOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </div>
          {libraryTab === "video" ? (
            <>
              <div className="sequence-edit-take-filters" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, padding: "0 7px 7px" }}>
                {(["active", "latest", "all"] as TakeFilter[]).map((filter) => (
                  <button key={filter} className={`sequence-edit-take-filter-${filter}`} data-testid={`sequence-editor-take-filter-${filter}`} style={{ ...button, minHeight: 26, padding: 3, borderColor: takeFilter === filter ? "#e18a48" : "#354359", color: takeFilter === filter ? "#ffc69d" : "#9ba8b8" }} onClick={() => setTakeFilter(filter)}>{filter === "active" ? "Active" : filter === "latest" ? "Latest / segment" : "All takes"}</button>
                ))}
              </div>
              <button className="sequence-edit-append-story-cut" data-testid="sequence-editor-append-active-cut" style={{ ...primaryButton, margin: "0 7px 7px" }} disabled={appendingCut} onClick={() => void appendActiveCut()}>{appendingCut ? "Probing active takes…" : "＋ Append Active Story Cut"}</button>
            </>
          ) : (
            <div className="sequence-edit-audio-import" style={{ display: "flex", gap: 5, padding: "0 7px 7px" }}>
              <input ref={audioUploadRef} className="sequence-edit-audio-file" data-testid="sequence-editor-audio-file" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAudio(file); }} />
              <button className="sequence-edit-audio-upload" data-testid="sequence-editor-audio-upload" style={{ ...primaryButton, width: "100%" }} disabled={uploading} onClick={() => audioUploadRef.current?.click()}>{uploading ? "Importing…" : "↑ Import sound or music"}</button>
              {onOpenAssets ? <button className="sequence-edit-open-assets" style={button} onClick={onOpenAssets}>Assets</button> : null}
            </div>
          )}
          <div className="sequence-edit-library-list" data-testid="sequence-editor-library-list" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 7px 8px", display: "grid", alignContent: "start", gap: 4 }}>
            {(libraryTab === "video" ? filteredVideos : filteredAudio).map((item: any) => {
              const selected = sourceMediaId === item.id;
              return (
                <button
                  key={item.id}
                  className={`sequence-edit-media-item sequence-edit-media-${item.kind}`}
                  data-testid={`sequence-editor-media-${item.id}`}
                  disabled={!item.available}
                  title={item.issue || item.prompt || item.relativeFile}
                  style={{ display: "grid", gridTemplateColumns: "58px minmax(0,1fr) auto", gap: 7, alignItems: "center", minHeight: 48, padding: 5, border: `1px solid ${selected ? "#e58a48" : item.available ? "transparent" : "#59323a"}`, borderRadius: 5, background: selected ? "rgba(172,92,36,.18)" : "#0c121b", color: item.available ? "#d2dbe6" : "#8d6570", textAlign: "left", cursor: item.available ? "pointer" : "not-allowed" }}
                  onClick={() => setSourceMediaId(item.id)}
                >
                  <span className="sequence-edit-media-thumb" style={{ width: 58, height: 35, display: "grid", placeItems: "center", borderRadius: 4, overflow: "hidden", background: item.kind === "video" ? "#05080d" : "#102328", color: "#65d1cb" }}>
                    {item.kind === "video" && item.available ? <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", color: "#8fa5bf", background: "linear-gradient(135deg,#111a27,#05080d)", fontSize: 15 }}>▶</span> : item.kind === "audio" ? "♫" : "!"}
                  </span>
                  <span className="sequence-edit-media-copy" style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>{mediaTitle(item)}</b><small style={{ display: "block", marginTop: 4, color: "#77869a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.kind === "video" ? `${item.sceneTitle || "Unscened"} · Segment ${item.segmentOrder ?? item.segmentId ?? "—"}` : item.source || "project audio"}</small></span>
                  <span className="sequence-edit-media-badges" style={{ display: "grid", justifyItems: "end", gap: 3, fontSize: 8, color: "#8d9bae" }}><em style={{ fontStyle: "normal" }}>{seconds(item.durationSec)}</em>{item.variant && item.variant !== "editorial" ? <b style={{ color: "#78b8ef" }}>{String(item.variant).toUpperCase()}</b> : null}{item.isActiveTake ? <b style={{ color: "#63d395" }}>ACTIVE</b> : null}{item.isLatestTake ? <b style={{ color: "#bd9aff" }}>LATEST</b> : null}{!item.available ? <b style={{ color: "#e38c99" }}>MISSING</b> : null}</span>
                </button>
              );
            })}
            {libraryTab === "video" && !(library?.videos || []).length ? (
              <div className="sequence-edit-library-empty seq-001-empty" data-testid="seq-001-empty" style={{ color: "#748296", textAlign: "center", padding: 12, display: "grid", gap: 7 }}>
                <p style={{ margin: 0 }}>No video takes in this bin.</p>
                <nav aria-label="Empty video library recovery" style={{ display: "grid", gap: 5 }}>
                  <button type="button" style={button} data-testid="seq-001-storyboard" onClick={() => openWorkspaceRoute("/storyboard")}>Open Storyboard</button>
                  <button type="button" style={button} data-testid="seq-001-ltx" onClick={() => openWorkspaceRoute("/direct/ltx")}>Open LTX Director</button>
                  <button type="button" style={button} data-testid="seq-001-generate" onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(sequence?.id || "sequence"), label: sequence?.name || "Sequence" }, requirement: { relationship: "sequence.media", category: "video", expectedMediaType: "video" }, initialAction: "generate", slotState: "missing", returnFocusId: "seq-001-generate" })}>Generate missing takes</button>
                  <button type="button" style={button} data-testid="seq-001-import" onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(sequence?.id || "sequence"), label: sequence?.name || "Sequence" }, requirement: { relationship: "sequence.media", category: "video", expectedMediaType: "video" }, initialAction: "upload", slotState: "missing", returnFocusId: "seq-001-import" })}>Import video</button>
                  <button type="button" style={button} data-testid="seq-001-create-asset" onClick={() => { const selected = useStore.getState().project?.assets?.items?.find((item: any) => item.id === useStore.getState().selectedAssetId); openSequenceSlot({ sourceEntity: { type: "sequence", id: String(sequence?.id || "sequence"), label: sequence?.name || "Sequence" }, requirement: { relationship: "sequence.media", category: "video", expectedMediaType: "video", assetId: selected?.id }, initialAction: "choose", slotState: "missing", returnFocusId: "seq-001-create-asset", prefill: selected ? { name: selected.name, prompt: selected.prompt } : undefined }); }}>Create from selected asset</button>
                </nav>
              </div>
            ) : !(libraryTab === "video" ? filteredVideos : filteredAudio).length ? <p className="sequence-edit-library-empty" style={{ color: "#748296", textAlign: "center", padding: 20 }}>No matching {libraryTab} media.</p> : null}
          </div>
        </aside>

        <section className="sequence-edit-monitors" style={{ ...panel, display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <article className="sequence-edit-source-monitor" style={{ minWidth: 0, display: "flex", flexDirection: "column", borderRight: "1px solid #293447" }}>
            <header className="sequence-edit-monitor-heading" style={{ height: 35, flex: "0 0 35px", display: "flex", alignItems: "center", gap: 7, padding: "0 9px", borderBottom: "1px solid #293447" }}><b>SOURCE</b><small style={{ marginLeft: "auto", color: "#78879a", maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedMedia ? mediaTitle(selectedMedia) : "Select a take or audio file"}</small></header>
            <div className="sequence-edit-monitor-stage" style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", position: "relative", background: "#04070b" }}>
              {!selectedMedia ? <span className="sequence-edit-monitor-empty" style={{ color: "#647286" }}>Select media from the bin.</span> : selectedMediaIsVideo ? (
                <video
                  key={selectedMedia.id}
                  ref={sourceVideoRef}
                  className="sequence-edit-source-video"
                  data-testid="sequence-editor-source-video"
                  src={sourceUrl(slug, selectedMedia.relativeFile)}
                  preload="auto"
                  controls
                  onLoadedMetadata={(event) => {
                    setSourcePlaybackError(null);
                    const duration = finite(event.currentTarget.duration, mediaDuration(selectedMedia));
                    setSourceOutSec((current) => clamp(current || duration, 1 / fps, duration));
                  }}
                  onCanPlay={() => setSourcePlaybackError(null)}
                  onError={() => setSourcePlaybackError({ id: selectedMedia.id, message: "Source media could not be loaded. Refresh Media or select another take." })}
                  onTimeUpdate={(event) => setSourceTime(event.currentTarget.currentTime)}
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "#030508" }}
                />
              ) : (
                <div className="sequence-edit-source-audio-wrap" style={{ width: "88%", display: "grid", gap: 14, textAlign: "center" }}>
                  <span className="sequence-edit-source-audio-icon" style={{ fontSize: 46, color: "#49c8bf" }}>♫</span>
                  <b>{selectedMedia.name || selectedMedia.fileName}</b>
                  <audio key={selectedMedia.id} ref={sourceAudioRef} className="sequence-edit-source-audio" data-testid="sequence-editor-source-audio" src={sourceUrl(slug, selectedMedia.relativeFile)} preload="metadata" controls onTimeUpdate={(event) => setSourceTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { setSourcePlaybackError(null); setSourceOutSec((current) => clamp(current || event.currentTarget.duration, .001, event.currentTarget.duration)); }} onCanPlay={() => setSourcePlaybackError(null)} onError={() => setSourcePlaybackError({ id: selectedMedia.id, message: "Source audio could not be loaded. Refresh Media or select another file." })} style={{ width: "100%" }} />
                </div>
              )}
              {selectedMedia && sourcePlaybackError?.id === selectedMedia.id ? <span className="sequence-edit-source-error" data-testid="sequence-editor-source-error" role="alert" style={{ position: "absolute", inset: "auto 12px 12px", zIndex: 4, padding: "8px 10px", border: "1px solid #813f4a", borderRadius: 5, background: "rgba(50,16,22,.94)", color: "#ffb5bf", textAlign: "center" }}>{sourcePlaybackError.message}</span> : null}
            </div>
            <footer className="sequence-edit-source-controls" style={{ flex: "0 0 71px", padding: 7, display: "grid", gridTemplateRows: "28px 28px", gap: 4, borderTop: "1px solid #293447", background: "#0c121b" }}>
              <div className="sequence-edit-source-marks" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <b style={{ color: "#2fa8ff", fontVariantNumeric: "tabular-nums" }}>{timecode(sourceTime, fps)}</b>
                <span style={{ flex: 1 }} />
                <button className="sequence-edit-mark-in" data-testid="sequence-editor-mark-in" style={button} disabled={!selectedMedia} onClick={setMarkIn}>I · {timecode(sourceInSec, fps)}</button>
                <button className="sequence-edit-mark-out" data-testid="sequence-editor-mark-out" style={button} disabled={!selectedMedia} onClick={setMarkOut}>O · {timecode(sourceOutSec, fps)}</button>
                <button className="sequence-edit-probe" data-testid="sequence-editor-probe-source" style={button} disabled={!selectedMedia || probing} onClick={() => void probeMedia(selectedMedia)}>{probing ? "…" : "Probe"}</button>
              </div>
              <div className="sequence-edit-source-edit-buttons" style={{ display: "flex", gap: 5 }}>
                {selectedMediaIsVideo ? <><button className="sequence-edit-insert-video" data-testid="sequence-editor-insert-video" title={selectedVideoIsExact ? "Insert marked source range at the playhead" : "Waiting for exact-duration probe"} style={{ ...primaryButton, flex: 1 }} disabled={!selectedVideoIsExact || probing} onClick={() => insertSelectedVideo(false)}>{probing && !selectedVideoIsExact ? "Probing take…" : "Insert at playhead"}</button><button className="sequence-edit-append-video" data-testid="sequence-editor-append-video" title={selectedVideoIsExact ? "Append marked source range to V1" : "Waiting for exact-duration probe"} style={{ ...button, flex: 1 }} disabled={!selectedVideoIsExact || probing} onClick={() => insertSelectedVideo(true)}>{probing && !selectedVideoIsExact ? "Probing take…" : "Append to V1"}</button></> : selectedMedia ? <><button className="sequence-edit-add-a1" data-testid="sequence-editor-add-a1" title={selectedAudioIsExact ? "Place marked audio on A1" : "Waiting for exact-duration probe"} style={{ ...primaryButton, flex: 1 }} disabled={!selectedAudioIsExact || probing} onClick={() => addSelectedAudio("A1")}>{probing && !selectedAudioIsExact ? "Probing audio…" : "Add to A1"}</button><button className="sequence-edit-add-m1" data-testid="sequence-editor-add-m1" title={selectedAudioIsExact ? "Place marked audio on M1" : "Waiting for exact-duration probe"} style={{ ...button, flex: 1 }} disabled={!selectedAudioIsExact || probing} onClick={() => addSelectedAudio("M1")}>{probing && !selectedAudioIsExact ? "Probing audio…" : "Add to M1"}</button></> : null}
              </div>
              {selectedMedia ? (
                <div className="seq-source-agency" data-testid="seq-source-agency" style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 0 0" }}>
                  <button type="button" style={button} onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(selectedMedia.clipId || selectedMedia.id), label: mediaTitle(selectedMedia) }, requirement: { relationship: "clip.take", category: "video", expectedMediaType: selectedMediaIsVideo ? "video" : "audio", assetId: selectedMedia.id }, initialAction: "generate", slotState: selectedMedia.available ? "unapproved" : "missing", returnFocusId: "sequence-editor-probe-source" })}>Regenerate this take</button>
                  <button type="button" style={button} onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(selectedMedia.clipId || selectedMedia.id), label: mediaTitle(selectedMedia) }, requirement: { relationship: "clip.take", category: "video", expectedMediaType: selectedMediaIsVideo ? "video" : "audio", assetId: selectedMedia.id }, initialAction: "replace", slotState: "broken", returnFocusId: "sequence-editor-probe-source" })}>Replace source</button>
                  {!selectedMedia.available || selectedMedia.metadataStatus === "failed" || sourcePlaybackError?.id === selectedMedia.id ? (
                    <>
                      <button type="button" style={button} disabled={probing} onClick={() => void probeMedia(selectedMedia)}>Retry one</button>
                      <button type="button" style={button} disabled={probing} onClick={() => { const failed = (libraryTab === "video" ? filteredVideos : filteredAudio).filter((item: any) => !item.available || item.metadataStatus === "failed" || item.metadataStatus !== "probed"); failed.forEach((item: any) => void probeMedia(item)); }}>Retry all</button>
                      <button type="button" style={button} onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(selectedMedia.id), label: mediaTitle(selectedMedia) }, requirement: { relationship: "clip.take", category: "video", expectedMediaType: selectedMediaIsVideo ? "video" : "audio", assetId: selectedMedia.id }, initialAction: "choose", slotState: "broken" })}>Relink</button>
                    </>
                  ) : null}
                  {selectedMedia.kind === "audio" ? (
                    <button type="button" style={button} onClick={() => openSequenceSlot({ sourceEntity: { type: "timeline-item", id: "A1", label: mediaTitle(selectedMedia) }, requirement: { relationship: "library.asset", category: "sound", expectedMediaType: "audio", assetId: selectedMedia.id }, initialAction: "create", slotState: "unapproved" })}>Save as sound asset</button>
                  ) : null}
                </div>
              ) : null}
            </footer>
          </article>

          <article className="sequence-edit-program-monitor" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <header className="sequence-edit-monitor-heading" style={{ height: 35, flex: "0 0 35px", display: "flex", alignItems: "center", padding: "0 9px", borderBottom: "1px solid #293447" }}><b>PROGRAM · STITCHED EDIT</b><small style={{ marginLeft: "auto", color: "#78879a" }}>{sequence.videoClips.length} clips</small></header>
            <div className="sequence-edit-program-stage" style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", position: "relative", background: "#030609" }}>
              {currentProgramClip ? (
                <video
                  key={currentProgramClip.id}
                  ref={programVideoRef}
                  className="sequence-edit-program-video"
                  data-testid="sequence-editor-program-video"
                  src={currentProgramUrl}
                  preload="auto"
                  playsInline
                  onLoadedMetadata={() => { setProgramPlaybackError(null); seekProgramElement(playheadSec, programPlaying); }}
                  onCanPlay={() => setProgramPlaybackError(null)}
                  onError={() => setProgramPlaybackError({ id: currentProgramClip.id, message: "Program media could not be loaded. Refresh Media or choose another take." })}
                  onTimeUpdate={programTimeUpdate}
                  onEnded={programTimeUpdate}
                  style={{ width: "100%", height: "100%", objectFit: "contain", background: "#020407" }}
                />
              ) : <span className="sequence-edit-monitor-empty" style={{ color: "#647286" }}>{sequence.videoClips.length ? "Black picture · audio tail" : "Add LTX takes to V1 to build the program."}</span>}
              {currentProgramClip && programPlaybackError?.id === currentProgramClip.id ? <span className="sequence-edit-program-error" data-testid="sequence-editor-program-error" role="alert" style={{ position: "absolute", inset: "auto 12px 12px", zIndex: 4, padding: "8px 10px", border: "1px solid #813f4a", borderRadius: 5, background: "rgba(50,16,22,.94)", color: "#ffb5bf", textAlign: "center" }}>{programPlaybackError.message}</span> : null}
              {(sequence.audioClips || []).map((clip: any) => (
                <audio key={clip.id} className="sequence-edit-auxiliary-audio" data-testid={`sequence-editor-preview-audio-${clip.id}`} ref={(element) => { if (element) auxiliaryAudioRefs.current.set(clip.id, element); else auxiliaryAudioRefs.current.delete(clip.id); }} src={sourceUrl(slug, clip.sourceFile)} preload="auto" style={{ display: "none" }} />
              ))}
            </div>
            <footer className="sequence-edit-program-controls" style={{ flex: "0 0 71px", padding: 7, display: "grid", gridTemplateRows: "28px 28px", gap: 4, borderTop: "1px solid #293447", background: "#0c121b" }}>
              <div className="sequence-edit-program-transport" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <b style={{ minWidth: 82, color: "#2fa8ff", fontVariantNumeric: "tabular-nums" }}>{timecode(playheadSec, fps)}</b>
                <button className="sequence-edit-program-start" style={button} onClick={() => setProgramTime(0, false)}>│◀</button>
                <button className="sequence-edit-program-step-back" style={button} onClick={() => setProgramTime(playheadSec - (1 / fps), false)}>◀</button>
                <button className="sequence-edit-program-play" data-testid="sequence-editor-program-play" style={primaryButton} disabled={!sequence.videoClips.length} onClick={() => {
                  if (programPlaying) setProgramPlaying(false);
                  else {
                    if (playheadSec >= totalDuration - (1 / fps)) setProgramTime(0, true);
                    setProgramPlaying(true);
                  }
                }}>{programPlaying ? "❚❚" : "▶"}</button>
                <button className="sequence-edit-program-step-forward" style={button} onClick={() => setProgramTime(playheadSec + (1 / fps), false)}>▶</button>
                <span className="sequence-edit-current-program-name" style={{ marginLeft: "auto", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8a98ab" }}>{currentProgramClip?.name || "No picture"}</span>
              </div>
              <input className="sequence-edit-program-scrubber" data-testid="sequence-editor-program-scrubber" type="range" min={0} max={Math.max(.001, totalDuration)} step={1 / fps} value={clamp(playheadSec, 0, Math.max(.001, totalDuration))} onChange={(event) => { setProgramPlaying(false); setProgramTime(Number(event.target.value), false); }} />
            </footer>
          </article>
        </section>

        <aside className="sequence-edit-inspector" data-testid="sequence-editor-inspector" style={{ ...panel, display: "flex", flexDirection: "column" }}>
          <header className="sequence-edit-panel-heading" style={{ height: 39, flex: "0 0 39px", display: "flex", alignItems: "center", padding: "0 10px", borderBottom: "1px solid #293447" }}><b>CLIP INSPECTOR</b><small style={{ marginLeft: "auto", color: "#78879a" }}>{selectedTimelineClip?.track || "No selection"}</small></header>
          {!selectedTimelineClip ? <p className="sequence-edit-inspector-empty" style={{ color: "#758397", padding: 15 }}>Select a timeline clip to trim picture or mix audio.</p> : (
            <div className="sequence-edit-inspector-fields" style={{ padding: 10, overflow: "auto", display: "grid", alignContent: "start", gap: 9 }}>
              <div className="sequence-edit-inspector-name"><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedTimelineClip.name}</b><small style={{ color: "#7d8b9f" }}>{selectedTimelineClip.sourceFile}</small></div>
              {selectedIsVideo ? (
                <>
                  <label className="sequence-edit-field-source-in" style={labelStyle}>Source In (seconds)<input data-testid="sequence-editor-video-source-in" style={field} type="number" min={0} max={selectedTimelineClip.sourceOutSec - (1 / fps)} step={1 / fps} value={selectedTimelineClip.sourceInSec} onChange={(event) => patchSelectedClip({ sourceInSec: clamp(Number(event.target.value), 0, selectedTimelineClip.sourceOutSec - (1 / fps)) })} /></label>
                  <label className="sequence-edit-field-source-out" style={labelStyle}>Source Out (seconds)<input data-testid="sequence-editor-video-source-out" style={field} type="number" min={selectedTimelineClip.sourceInSec + (1 / fps)} max={selectedTimelineClip.sourceDurationSec} step={1 / fps} value={selectedTimelineClip.sourceOutSec} onChange={(event) => patchSelectedClip({ sourceOutSec: clamp(Number(event.target.value), selectedTimelineClip.sourceInSec + (1 / fps), selectedTimelineClip.sourceDurationSec) })} /></label>
                  <label className="sequence-edit-field-video-gain" style={labelStyle}>Embedded sound gain · {finite(selectedTimelineClip.volumeDb).toFixed(1)} dB<input data-testid="sequence-editor-video-gain" type="range" min={-60} max={12} step={.5} value={selectedTimelineClip.volumeDb || 0} onChange={(event) => patchSelectedClip({ volumeDb: Number(event.target.value) })} /></label>
                  <label className="sequence-edit-field-video-mute" style={{ ...labelStyle, display: "flex", alignItems: "center" }}><input data-testid="sequence-editor-video-mute" type="checkbox" checked={Boolean(selectedTimelineClip.muted)} onChange={(event) => patchSelectedClip({ muted: event.target.checked })} /> Mute embedded clip sound</label>
                </>
              ) : (
                <>
                  <label className="sequence-edit-field-audio-track" style={labelStyle}>Track<select data-testid="sequence-editor-audio-track" style={field} value={selectedTimelineClip.track} onChange={(event) => patchSelectedClip({ track: event.target.value === "M1" ? "M1" : "A1" })}><option value="A1">A1 · Sound / dialogue</option><option value="M1">M1 · Music</option></select></label>
                  <label className="sequence-edit-field-audio-start" style={labelStyle}>Timeline start<input data-testid="sequence-editor-audio-start" style={field} type="number" min={0} step={1 / fps} value={selectedTimelineClip.timelineStartSec} onChange={(event) => patchSelectedClip({ timelineStartSec: Math.max(0, Number(event.target.value)) })} /></label>
                  <label className="sequence-edit-field-audio-duration" style={labelStyle}>Timeline duration<input data-testid="sequence-editor-audio-duration" style={field} type="number" min={.001} max={selectedTimelineClip.loop ? 3600 : selectedTimelineClip.sourceOutSec - selectedTimelineClip.sourceInSec} step={.1} value={selectedTimelineClip.durationSec} onChange={(event) => patchSelectedClip({ durationSec: clamp(Number(event.target.value), .001, selectedTimelineClip.loop ? 3600 : selectedTimelineClip.sourceOutSec - selectedTimelineClip.sourceInSec) })} /></label>
                  <label className="sequence-edit-field-audio-gain" style={labelStyle}>Gain · {finite(selectedTimelineClip.volumeDb).toFixed(1)} dB<input data-testid="sequence-editor-audio-gain" type="range" min={-60} max={12} step={.5} value={selectedTimelineClip.volumeDb || 0} onChange={(event) => patchSelectedClip({ volumeDb: Number(event.target.value) })} /></label>
                  <div className="sequence-edit-audio-fades" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                    <label className="sequence-edit-field-fade-in" style={labelStyle}>Fade in<input data-testid="sequence-editor-audio-fade-in" style={field} type="number" min={0} max={selectedTimelineClip.durationSec} step={.1} value={selectedTimelineClip.fadeInSec || 0} onChange={(event) => patchSelectedClip({ fadeInSec: clamp(Number(event.target.value), 0, selectedTimelineClip.durationSec) })} /></label>
                    <label className="sequence-edit-field-fade-out" style={labelStyle}>Fade out<input data-testid="sequence-editor-audio-fade-out" style={field} type="number" min={0} max={selectedTimelineClip.durationSec} step={.1} value={selectedTimelineClip.fadeOutSec || 0} onChange={(event) => patchSelectedClip({ fadeOutSec: clamp(Number(event.target.value), 0, selectedTimelineClip.durationSec) })} /></label>
                  </div>
                  <div className="sequence-edit-audio-toggles" style={{ display: "flex", gap: 14 }}>
                    <label className="sequence-edit-field-audio-mute" style={{ ...labelStyle, display: "flex", alignItems: "center" }}><input data-testid="sequence-editor-audio-mute" type="checkbox" checked={Boolean(selectedTimelineClip.muted)} onChange={(event) => patchSelectedClip({ muted: event.target.checked })} /> Mute</label>
                    <label className="sequence-edit-field-audio-loop" style={{ ...labelStyle, display: "flex", alignItems: "center" }}><input data-testid="sequence-editor-audio-loop" type="checkbox" checked={Boolean(selectedTimelineClip.loop)} onChange={(event) => patchSelectedClip({ loop: event.target.checked })} /> Loop</label>
                  </div>
                </>
              )}
              <dl className="sequence-edit-inspector-facts" style={{ margin: 0, paddingTop: 7, borderTop: "1px solid #293447", display: "grid", gap: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "#7d8b9f" }}>Start</dt><dd style={{ margin: 0 }}>{timecode(selectedTimelineClip.timelineStartSec, fps)}</dd></div><div style={{ display: "flex", justifyContent: "space-between" }}><dt style={{ color: "#7d8b9f" }}>Duration</dt><dd style={{ margin: 0 }}>{seconds(selectedTimelineClip.durationSec)}</dd></div></dl>
              <button type="button" className="sequence-edit-replace-source" data-testid="sequence-editor-replace-source" style={button} onClick={() => openSequenceSlot({ sourceEntity: { type: "sequence", id: String(selectedTimelineClip.id), label: selectedTimelineClip.name || "Timeline clip" }, requirement: { relationship: "clip.source", category: selectedIsVideo ? "video" : "sound", expectedMediaType: selectedIsVideo ? "video" : "audio" }, initialAction: "replace", slotState: "approved", returnFocusId: "sequence-editor-replace-source" })}>Replace source media</button>
              <button className="sequence-edit-delete-inspector" data-testid="sequence-editor-delete-selected" style={{ ...button, borderColor: "#743b49", color: "#ef9ca8" }} onClick={deleteSelected}>Delete from timeline</button>
            </div>
          )}
        </aside>
      </section>

      <section className="sequence-edit-timeline" data-testid="sequence-editor-timeline" style={{ ...panel, minWidth: 1260, display: "flex", flexDirection: "column" }}>
        <div className="sequence-edit-timeline-toolbar" style={{ height: 42, flex: "0 0 42px", display: "flex", alignItems: "center", gap: 6, padding: "0 9px", borderBottom: "1px solid #293447" }}>
          <button className="sequence-edit-tool-select" style={{ ...button, color: "#7fb4ff" }}>➤ Select</button>
          <button className="sequence-edit-tool-split" data-testid="sequence-editor-split" style={button} disabled={!sequence.videoClips.length} onClick={splitSelected}>✂ Split (S)</button>
          <button className="sequence-edit-tool-delete" style={button} disabled={!selectedTimelineClip} onClick={deleteSelected}>⌫ Delete</button>
          <span className="sequence-edit-timeline-status" style={{ color: "#7f8da1" }}>V1 ripples automatically · drag clips to reorder · drag clip edges to trim · drag audio to position</span>
          <span className="sequence-edit-timeline-spacer" style={{ flex: 1 }} />
          <span>−</span><input className="sequence-edit-zoom" data-testid="sequence-editor-timeline-zoom" type="range" min={18} max={130} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>＋</span>
        </div>
        <div className="sequence-edit-timeline-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#080d13" }}>
          <div className="sequence-edit-timeline-canvas" style={{ width: laneWidth + 128, minWidth: "100%" }}>
            <div className="sequence-edit-ruler-row" style={{ display: "grid", gridTemplateColumns: "128px 1fr", height: 35, borderBottom: "1px solid #1d2734" }}>
              <div className="sequence-edit-ruler-label" style={{ position: "sticky", left: 0, zIndex: 15, display: "flex", alignItems: "center", padding: "0 9px", background: "#121a25", borderRight: "1px solid #293547", color: "#8492a5", fontWeight: 750 }}>TIME</div>
              <div className="sequence-edit-ruler-lane" data-testid="sequence-editor-ruler" style={{ position: "relative", background: "#0b1119" }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setProgramPlaying(false); setProgramTime((event.clientX - rect.left) / zoom, false); }}>
                {rulerTicks.map((tick) => <span key={tick} className="sequence-edit-ruler-tick" style={{ position: "absolute", left: tick * zoom, top: 0, bottom: 0, padding: "6px 0 0 4px", borderLeft: "1px solid #2b3748", color: "#748296", fontSize: 9 }}>{timecode(tick, fps)}</span>)}
                <i className="sequence-edit-ruler-playhead" style={{ pointerEvents: "none", position: "absolute", zIndex: 12, top: 0, bottom: 0, left: playheadSec * zoom, width: 1, background: "#31a6ff" }} />
              </div>
            </div>

            {trackRow("V1", "PICTURE + CLIP SOUND", sequence.videoClips.map((clip: any, index: number) => (
              <div
                key={clip.id}
                className="sequence-edit-video-clip"
                data-testid={`sequence-editor-video-clip-${clip.id}`}
                draggable={!sequence.trackSettings?.V1?.locked}
                onDragStart={(event) => { setDragVideoId(clip.id); event.dataTransfer.setData("text/plain", clip.id); event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragVideoId("")}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!dragVideoId || dragVideoId === clip.id || sequence.trackSettings?.V1?.locked) return;
                  const sourceIndex = sequenceRef.current.videoClips.findIndex((item: any) => item.id === dragVideoId);
                  const rect = event.currentTarget.getBoundingClientRect();
                  let targetIndex = index + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
                  if (sourceIndex < targetIndex) targetIndex -= 1;
                  commit(moveVideoClip(sequenceRef.current, dragVideoId, targetIndex), dragVideoId);
                  setDragVideoId("");
                }}
                onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); setProgramPlaying(false); setProgramTime(clip.timelineStartSec, false); }}
                style={{ position: "absolute", zIndex: selectedClipId === clip.id ? 6 : 3, left: clip.timelineStartSec * zoom, top: 5, width: Math.max(30, clip.durationSec * zoom - 2), height: 60, overflow: "hidden", border: `1px solid ${selectedClipId === clip.id ? "#fff" : "#9a6843"}`, borderRadius: 5, background: dragVideoId === clip.id ? "#6a4934" : "linear-gradient(180deg,#59402e,#35271f)", color: "#fff", cursor: sequence.trackSettings?.V1?.locked ? "not-allowed" : "grab", boxShadow: selectedClipId === clip.id ? "0 0 0 1px #e58a48" : "none" }}
              >
                <i className="sequence-edit-video-clip-fill" aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,rgba(229,138,72,.16),transparent 55%)" }} />
                <span className="sequence-edit-video-clip-copy" style={{ position: "relative", zIndex: 2, display: "grid", gap: 4, padding: "9px 11px", textShadow: "0 1px 3px #000", pointerEvents: "none" }}><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>{clip.name}</b><small>{timecode(clip.durationSec, fps)} · {clip.origin?.takeNumber != null ? `Take ${clip.origin.takeNumber}` : "media"}</small></span>
                <i className="sequence-edit-trim-start" data-testid={`sequence-editor-trim-start-${clip.id}`} title="Trim start" onPointerDown={(event) => beginVideoTrim(event, clip, "start")} style={{ position: "absolute", zIndex: 8, left: 0, top: 0, bottom: 0, width: 8, background: selectedClipId === clip.id ? "rgba(255,255,255,.13)" : "transparent", cursor: "ew-resize" }} />
                <i className="sequence-edit-trim-end" data-testid={`sequence-editor-trim-end-${clip.id}`} title="Trim end" onPointerDown={(event) => beginVideoTrim(event, clip, "end")} style={{ position: "absolute", zIndex: 8, right: 0, top: 0, bottom: 0, width: 8, background: selectedClipId === clip.id ? "rgba(255,255,255,.13)" : "transparent", cursor: "ew-resize" }} />
              </div>
            )), "sequence-editor-track-v1")}

            {trackRow("A1", "SOUND / DIALOGUE", sequence.audioClips.filter((clip: any) => clip.track === "A1").map((clip: any) => (
              <div key={clip.id} className="sequence-edit-audio-clip-a1" data-testid={`sequence-editor-audio-clip-${clip.id}`} onPointerDown={(event) => beginAudioMove(event, clip)} style={{ position: "absolute", zIndex: selectedClipId === clip.id ? 6 : 3, left: clip.timelineStartSec * zoom, top: 5, width: Math.max(25, clip.durationSec * zoom), height: 40, border: `1px solid ${selectedClipId === clip.id ? "#fff" : "#187976"}`, borderRadius: 4, overflow: "hidden", background: clip.muted ? "rgba(53,62,70,.7)" : "rgba(15,111,108,.55)", cursor: sequence.trackSettings?.A1?.locked ? "not-allowed" : "grab" }}><Waveform /><span style={{ position: "relative", zIndex: 2, padding: "5px 8px", display: "block", color: "#d9fffb", fontSize: 9, textShadow: "0 1px 2px #000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>{clip.name} · {finite(clip.volumeDb).toFixed(1)} dB</span></div>
            )), "sequence-editor-track-a1")}

            {trackRow("M1", "MUSIC", sequence.audioClips.filter((clip: any) => clip.track === "M1").map((clip: any) => (
              <div key={clip.id} className="sequence-edit-audio-clip-m1" data-testid={`sequence-editor-audio-clip-${clip.id}`} onPointerDown={(event) => beginAudioMove(event, clip)} style={{ position: "absolute", zIndex: selectedClipId === clip.id ? 6 : 3, left: clip.timelineStartSec * zoom, top: 5, width: Math.max(25, clip.durationSec * zoom), height: 40, border: `1px solid ${selectedClipId === clip.id ? "#fff" : "#7755b6"}`, borderRadius: 4, overflow: "hidden", background: clip.muted ? "rgba(53,62,70,.7)" : "rgba(91,56,151,.55)", cursor: sequence.trackSettings?.M1?.locked ? "not-allowed" : "grab" }}><Waveform color="#ac82f2" /><span style={{ position: "relative", zIndex: 2, padding: "5px 8px", display: "block", color: "#eadfff", fontSize: 9, textShadow: "0 1px 2px #000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>{clip.name} · {finite(clip.volumeDb).toFixed(1)} dB{clip.loop ? " · LOOP" : ""}</span></div>
            )), "sequence-editor-track-m1")}
          </div>
        </div>
      </section>

      <section className="sequence-edit-bottom" style={{ display: "grid", gridTemplateColumns: "1fr 430px", minWidth: 1260, gap: 8 }}>
        <article className="sequence-edit-edit-summary" style={{ ...panel, padding: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", alignContent: "start", gap: 9 }}>
          <div className="sequence-edit-summary-card" style={{ border: "1px solid #2d394c", borderRadius: 6, padding: 12, background: "#0c121b" }}><small style={{ color: "#7c8a9e" }}>V1 CUT</small><b style={{ display: "block", marginTop: 7, fontSize: 19 }}>{sequence.videoClips.length}</b><span style={{ color: "#8e9caf" }}>stitched clips</span></div>
          <div className="sequence-edit-summary-card" style={{ border: "1px solid #2d394c", borderRadius: 6, padding: 12, background: "#0c121b" }}><small style={{ color: "#7c8a9e" }}>A1 SOUND</small><b style={{ display: "block", marginTop: 7, fontSize: 19 }}>{sequence.audioClips.filter((clip: any) => clip.track === "A1").length}</b><span style={{ color: "#8e9caf" }}>positioned clips</span></div>
          <div className="sequence-edit-summary-card" style={{ border: "1px solid #2d394c", borderRadius: 6, padding: 12, background: "#0c121b" }}><small style={{ color: "#7c8a9e" }}>M1 MUSIC</small><b style={{ display: "block", marginTop: 7, fontSize: 19 }}>{sequence.audioClips.filter((clip: any) => clip.track === "M1").length}</b><span style={{ color: "#8e9caf" }}>music clips</span></div>
          <div className="sequence-edit-summary-card" style={{ border: "1px solid #2d394c", borderRadius: 6, padding: 12, background: "#0c121b" }}><small style={{ color: "#7c8a9e" }}>PROGRAM</small><b style={{ display: "block", marginTop: 7, fontSize: 19 }}>{timecode(totalDuration, fps)}</b><span style={{ color: "#8e9caf" }}>sequence duration</span></div>
          <div className="sequence-edit-shortcuts" style={{ gridColumn: "1 / -1", borderTop: "1px solid #293447", paddingTop: 11, color: "#8290a3", lineHeight: 1.6 }}>Shortcuts: Space play/pause · S split · Delete remove · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Ctrl/Cmd+S save. V1 always ripples after insert, reorder, trim, split, and delete. A1/M1 remain positioned against the program.</div>
        </article>

        <article className="sequence-edit-export-panel" data-testid="sequence-editor-export" style={{ ...panel, display: "flex", flexDirection: "column" }}>
          <header className="sequence-edit-export-heading" style={{ height: 42, flex: "0 0 42px", display: "flex", alignItems: "center", gap: 7, padding: "0 10px", borderBottom: "1px solid #293447" }}><b>EXPORT MASTERS</b><span style={{ marginLeft: "auto", color: "#7d8b9f" }}>{documentState?.exports?.length || 0} versions</span></header>
          <div className="sequence-edit-export-actions" style={{ display: "flex", alignItems: "center", gap: 7, padding: 9, borderBottom: "1px solid #293447" }}>
            <button className="sequence-edit-export-button" data-testid="sequence-editor-export-button" style={{ ...primaryButton, flex: 1 }} disabled={!sequence.videoClips.length || exporting || Boolean(exportJobId) || Boolean(conflict)} onClick={() => void exportEdit()}>{exporting ? "Saving edit…" : exportJobId ? "Export running…" : "Export stitched MP4"}</button>
            {exportJobId ? <button className="sequence-edit-export-cancel" data-testid="sequence-editor-export-cancel" style={{ ...button, borderColor: "#7d3f49", color: "#ef9ca8" }} disabled={currentExportJob?.status === "cancelling"} onClick={() => void cancelExport()}>{currentExportJob?.status === "cancelling" ? "Stopping…" : "Stop"}</button> : null}
            {currentExportJob ? <span className="sequence-edit-export-progress" data-testid="sequence-editor-export-progress" style={{ minWidth: 84, color: currentExportJob.status === "error" ? "#ec98a4" : "#8eb6ef" }}>{currentExportJob.status} · {Math.round(finite(currentExportJob.progress) * 100)}%</span> : null}
          </div>
          <div className="sequence-edit-export-list" data-testid="sequence-editor-export-list" style={{ flex: 1, minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 6, padding: 9 }}>
            {[...(documentState?.exports || [])].sort((left: any, right: any) => finite(right.v) - finite(left.v)).map((item: any) => (
              <div key={`${item.v}-${item.file}`} className="sequence-edit-export-item" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 7, border: `1px solid ${finite(item.v) === finite(documentState?.activeExportVersion) ? "#604aa4" : "#2b3749"}`, borderRadius: 6, background: "#0b1119", padding: 8 }}>
                <span className="sequence-edit-export-copy" style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>v{item.v} · {item.name || item.file}</b><small style={{ display: "block", marginTop: 4, color: "#7d8b9f" }}>{seconds(item.durationSec)} · R{item.sequenceRevision} · {item.width}×{item.height}</small></span>
                <a className="sequence-edit-export-download" data-testid={`sequence-editor-export-download-${item.v}`} href={sourceUrl(slug, `media/masters/${item.file}`)} download style={{ ...button, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Download</a>
              </div>
            ))}
            {!documentState?.exports?.length ? <p className="sequence-edit-export-empty" style={{ margin: 0, padding: 16, color: "#77869a", textAlign: "center" }}>Save the cut, then export a stitched MP4 with V1 clip sound plus A1/M1 mixing.</p> : null}
          </div>
        </article>
      </section>
    </main>
  );
}
