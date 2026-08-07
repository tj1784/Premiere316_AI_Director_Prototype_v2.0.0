import { create } from "zustand";

async function api(path: string, opts: RequestInit = {}) {
  const response = await fetch(path, {
    ...opts,
    headers: opts.body instanceof FormData
      ? opts.headers
      : { "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || response.statusText || "Request failed");
  return json;
}

export function mediaUrl(slug: string, kind: "frames" | "clips" | "audio" | "assets" | "masters", file: string) {
  return `/media/${encodeURIComponent(slug)}/${kind}/${encodeURIComponent(file)}`;
}
export function frameUrl(slug: string, file: string) { return mediaUrl(slug, "frames", file); }
export function clipUrl(slug: string, file: string) { return mediaUrl(slug, "clips", file); }
export function audioUrl(slug: string, file: string) { return mediaUrl(slug, "audio", file); }
export function assetUrl(slug: string, file: string) { return mediaUrl(slug, "assets", file); }
export function masterUrl(slug: string, file: string) { return mediaUrl(slug, "masters", file); }

function currentClip(project: any, clipId: string | null) {
  return project?.sequence?.clips?.find((clip: any) => clip.id === clipId) || null;
}

type Store = {
  project: any | null;
  projects: any[];
  health: any;
  jobs: any[];
  error: string | null;
  selClipId: string | null;
  selectedSegmentIds: string[];
  selectionAnchorId: string | null;
  selFrameFile: string | null;
  selectedGuideId: string | null;
  playheadFrame: number;
  markInFrame: number | null;
  markOutFrame: number | null;
  pxPerSec: number;
  busy: boolean;
  screenplayBusy: boolean;
  assetBusy: boolean;
  gpuHandoffBusy: boolean;
  comfyRestartBusy: boolean;
  premiereRestartBusy: boolean;
  screenplayModelLoadBusy: boolean;
  promptEnhanceBusy: boolean;
  promptEnhance: any | null;
  assetWorkflows: any[];
  lmStudioGpu: any | null;
  h3Diagnostics: any | null;
  h3Busy: boolean;
  h3Mode: "t2v" | "first_frame" | "last_frame" | "first_last" | "reference";
  activeWorkbench: "guide" | "prompt" | "score" | "master";

  setError: (error: string | null) => void;
  setSelClip: (id: string | null) => void;
  setSelFrame: (file: string | null) => void;
  setSelectedGuide: (id: string | null) => void;
  setSelectedSegments: (ids: string[], anchorId?: string | null) => void;
  toggleSegment: (id: string, additive?: boolean) => void;
  selectSegmentRange: (id: string) => void;
  selectAllSegments: () => void;
  setPlayheadFrame: (frame: number) => void;
  setMarkIn: () => void;
  setMarkOut: () => void;
  clearMarks: () => void;
  setPxPerSec: (value: number) => void;
  setWorkbench: (tab: Store["activeWorkbench"]) => void;

  refreshHealth: () => Promise<void>;
  refreshH3Diagnostics: (force?: boolean) => Promise<void>;
  setH3Mode: (mode: Store["h3Mode"]) => void;
  restartComfyUI: () => Promise<void>;
  restartPremiere316: () => Promise<void>;
  loadScreenplayModel: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  openProject: (slug: string) => Promise<void>;
  closeProject: () => void;
  saveProject: () => Promise<void>;
  reloadProject: () => Promise<void>;
  patchLocal: (fn: (project: any) => void) => void;
  patchClip: (clipId: string, body: any) => Promise<void>;
  deleteFrame: (frameId: string) => Promise<void>;
  restoreFrame: (frameId: string) => Promise<void>;
  addClipFromFrame: (frameFile: string) => Promise<void>;
  deleteClip: (clipId: string) => Promise<void>;

  saveScreenplay: (markdown: string, settings?: any) => Promise<void>;
  approveScreenplay: () => Promise<void>;
  generateScreenplay: (body: any) => Promise<void>;
  createScreenplayShotPlan: (body?: any) => Promise<void>;
  buildScreenplayTimeline: (body?: any) => Promise<void>;

  refreshAssetWorkflows: () => Promise<void>;
  handoffLmStudioGpu: () => Promise<void>;
  buildAssets: (body?: any) => Promise<void>;
  createAsset: (body: any) => Promise<any>;
  patchAsset: (assetId: string, body: any) => Promise<void>;
  uploadAssetImage: (assetId: string, file: File) => Promise<any>;
  uploadAssetAudio: (assetId: string, file: File) => Promise<any>;
  deleteAsset: (assetId: string) => Promise<void>;
  approveAsset: (assetId: string) => Promise<void>;
  generateAsset: (assetId: string) => Promise<void>;
  generateAssets: (assetIds?: string[], regenerate?: boolean) => Promise<void>;
  stopAssetGeneration: (assetId?: string) => Promise<void>;
  promoteAsset: (assetId: string) => Promise<void>;
  refreshPromptEnhance: () => Promise<void>;
  enhanceAssetPrompts: (assetIds?: string[], concurrency?: number) => Promise<void>;
  stopPromptEnhance: () => Promise<void>;

  attachGuide: (clipId: string, body: any) => Promise<void>;
  patchGuide: (clipId: string, guideId: string, body: any) => Promise<void>;
  deleteGuide: (clipId: string, guideId: string) => Promise<void>;

  renderSelection: (clipId?: string) => Promise<void>;
  renderH3Selection: (clipId?: string, mode?: Store["h3Mode"]) => Promise<void>;
  renderDirty: (clipId?: string) => Promise<void>;
  renderAll: () => Promise<void>;
  renderAllDirty: () => Promise<void>;
  assembleClip: (clipId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  updateBookendsLocal: (body: any) => void;
  updateScoreLocal: (body: any) => void;
  uploadScore: (file: File) => Promise<void>;
  generateScore: () => Promise<void>;
  buildMaster: () => Promise<void>;
};

export const useStore = create<Store>((set, get) => ({
  project: null,
  projects: [],
  health: { comfy: false, ffmpeg: false, capabilities: {} },
  jobs: [],
  error: null,
  selClipId: null,
  selectedSegmentIds: [],
  selectionAnchorId: null,
  selFrameFile: null,
  selectedGuideId: null,
  playheadFrame: 0,
  markInFrame: null,
  markOutFrame: null,
  pxPerSec: 42,
  busy: false,
  screenplayBusy: false,
  assetBusy: false,
  gpuHandoffBusy: false,
  comfyRestartBusy: false,
  premiereRestartBusy: false,
  screenplayModelLoadBusy: false,
  promptEnhanceBusy: false,
  promptEnhance: null,
  assetWorkflows: [],
  lmStudioGpu: null,
  h3Diagnostics: null,
  h3Busy: false,
  h3Mode: "first_frame",
  activeWorkbench: "guide",

  setError: (error) => set({ error }),
  setSelClip: (id) => {
    const project = get().project;
    const clip = currentClip(project, id);
    set({
      selClipId: id,
      selectedSegmentIds: [],
      selectionAnchorId: null,
      selectedGuideId: clip?.guides?.[0]?.id || null,
      selFrameFile: clip?.firstFrame?.file || get().selFrameFile
    });
  },
  setSelFrame: (file) => set({ selFrameFile: file }),
  setSelectedGuide: (id) => set({ selectedGuideId: id, activeWorkbench: "guide" }),
  setSelectedSegments: (ids, anchorId = null) => set({
    selectedSegmentIds: [...new Set(ids)],
    selectionAnchorId: anchorId ?? ids[ids.length - 1] ?? null,
    activeWorkbench: "prompt"
  }),
  toggleSegment: (id, additive = false) => {
    const selected = get().selectedSegmentIds;
    const next = additive
      ? selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
      : [id];
    set({ selectedSegmentIds: next, selectionAnchorId: id, activeWorkbench: "prompt" });
  },
  selectSegmentRange: (id) => {
    const project = get().project;
    const clip = currentClip(project, get().selClipId);
    if (!clip) return;
    const anchor = get().selectionAnchorId || id;
    const a = clip.segments.findIndex((segment: any) => segment.id === anchor);
    const b = clip.segments.findIndex((segment: any) => segment.id === id);
    if (a < 0 || b < 0) return get().toggleSegment(id, false);
    const [start, end] = a <= b ? [a, b] : [b, a];
    set({
      selectedSegmentIds: clip.segments.slice(start, end + 1).map((segment: any) => segment.id),
      activeWorkbench: "prompt"
    });
  },
  selectAllSegments: () => {
    const clip = currentClip(get().project, get().selClipId);
    if (!clip) return;
    set({
      selectedSegmentIds: clip.segments.map((segment: any) => segment.id),
      selectionAnchorId: clip.segments[0]?.id || null,
      activeWorkbench: "prompt"
    });
  },
  setPlayheadFrame: (frame) => set({ playheadFrame: Math.max(0, Math.round(frame)) }),
  setMarkIn: () => set({ markInFrame: get().playheadFrame }),
  setMarkOut: () => set({ markOutFrame: get().playheadFrame }),
  clearMarks: () => set({ markInFrame: null, markOutFrame: null }),
  setPxPerSec: (value) => set({ pxPerSec: Math.min(120, Math.max(12, value)) }),
  setWorkbench: (tab) => set({ activeWorkbench: tab }),

  refreshHealth: async () => {
    try {
      set({ health: await api("/api/health") });
    } catch {
      set({ health: { comfy: false, ffmpeg: false, capabilities: {} } });
    }
  },
  refreshH3Diagnostics: async (force = false) => {
    try {
      const json = await api(`/api/h3/diagnostics${force ? "?force=1" : ""}`);
      set({ h3Diagnostics: json });
    } catch (error: any) {
      set({
        h3Diagnostics: {
          ready: false,
          fl2vaReady: false,
          ref2vaReady: false,
          actionableErrors: [String(error.message || error)]
        }
      });
    }
  },
  setH3Mode: (mode) => set({ h3Mode: mode }),
  restartComfyUI: async () => {
    if (get().comfyRestartBusy) return;
    set({ comfyRestartBusy: true, error: null });
    try {
      await api("/api/system/comfy/restart", {
        method: "POST",
        body: JSON.stringify({})
      });
      const deadline = Date.now() + 180000;
      let completed = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        let status: any;
        try {
          status = await api("/api/system/comfy/restart/status");
        } catch {
          // A desktop launcher may replace the Premiere316 web process while
          // ComfyUI boots. Keep polling until the local server reconnects.
          continue;
        }
        set({ health: { ...get().health, comfy: Boolean(status.comfy), comfyRestarting: Boolean(status.restarting) } });
        if (status.status === "error") throw new Error(status.error || "Dedicated ComfyUI restart failed");
        if ((status.status === "ready" || status.status === "idle") && status.comfy) {
          completed = true;
          break;
        }
      }
      if (!completed) throw new Error("Dedicated ComfyUI did not reconnect within three minutes.");
    } catch (error: any) {
      set({ error: String(error.message) });
    } finally {
      await get().refreshHealth();
      set({ comfyRestartBusy: false });
    }
  },
  restartPremiere316: async () => {
    if (get().premiereRestartBusy) return;
    set({ premiereRestartBusy: true, error: null });
    try {
      await api("/api/system/premiere/restart", { method: "POST", body: JSON.stringify({}) });
      const deadline = Date.now() + 60000;
      let sawDisconnect = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        try {
          const health = await api("/api/health");
          if (sawDisconnect && health.app === "premiere316") {
            window.location.reload();
            return;
          }
        } catch {
          sawDisconnect = true;
        }
      }
      throw new Error("Premiere316 did not reconnect within one minute.");
    } catch (error: any) {
      set({ error: String(error.message), premiereRestartBusy: false });
    }
  },
  loadScreenplayModel: async () => {
    if (get().screenplayModelLoadBusy) return;
    set({ screenplayModelLoadBusy: true, error: null });
    try {
      await api("/api/lm-studio/load-screenplay-model", {
        method: "POST",
        body: JSON.stringify({})
      });
      const deadline = Date.now() + 180000;
      let ready = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        await get().refreshHealth();
        if (get().health.lmStudio && get().health.screenplayModelAvailable) {
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error("The pinned Qwen screenplay model did not become ready within three minutes.");
    } catch (error: any) {
      set({ error: String(error.message || error) });
    } finally {
      await get().refreshHealth();
      set({ screenplayModelLoadBusy: false });
    }
  },
  refreshProjects: async () => {
    try {
      const json = await api("/api/projects");
      set({ projects: json.projects || [] });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  refreshQueue: async () => {
    try {
      const json = await api("/api/queue");
      const previous = get().jobs;
      const next = json.jobs || [];
      set({ jobs: next });
      const project = get().project;
      if (!project) return;
      const completed = next.some((job: any) => {
        const old = previous.find((item: any) => item.id === job.id);
        return job.projectSlug === project.slug && ["done", "error", "cancelled"].includes(job.status) && old?.status !== job.status;
      });
      if (completed) await get().reloadProject();
    } catch {
      // Queue polling should never interrupt editing.
    }
  },
  createProject: async (name) => {
    set({ busy: true, error: null });
    try {
      const json = await api("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
      set({
        project: json.project,
        selClipId: null,
        selFrameFile: null,
        selectedSegmentIds: [],
        selectedGuideId: null
      });
      await get().refreshProjects();
    } catch (error: any) {
      set({ error: String(error.message) });
    } finally {
      set({ busy: false });
    }
  },
  openProject: async (slug) => {
    set({ busy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(slug)}`);
      const first = json.project?.sequence?.clips?.[0] || null;
      set({
        project: json.project,
        selClipId: first?.id || null,
        selFrameFile: first?.firstFrame?.file || json.project?.frames?.[0]?.file || null,
        selectedSegmentIds: [],
        selectionAnchorId: null,
        selectedGuideId: first?.guides?.[0]?.id || null,
        playheadFrame: 0,
        markInFrame: null,
        markOutFrame: null
      });
    } catch (error: any) {
      set({ error: String(error.message) });
    } finally {
      set({ busy: false });
    }
  },
  closeProject: () => set({
    project: null,
    selClipId: null,
    selFrameFile: null,
    selectedSegmentIds: [],
    selectedGuideId: null
  }),
  saveProject: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}`, {
        method: "PUT",
        body: JSON.stringify({ project })
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  reloadProject: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}`);
      set({ project: json.project });
    } catch {
      // Keep the current local project when refresh fails.
    }
  },
  patchLocal: (fn) => {
    const project = get().project;
    if (!project) return;
    const copy = structuredClone(project);
    fn(copy);
    set({ project: copy });
  },
  patchClip: async (clipId, body) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  deleteFrame: async (frameId) => {
    const project = get().project;
    if (!project) return;
    const frame = project.frames?.find((item: any) => item.id === frameId);
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/frames/${encodeURIComponent(frameId)}`,
        { method: "DELETE" }
      );
      set({
        project: json.project,
        selFrameFile: get().selFrameFile === frame?.file ? null : get().selFrameFile
      });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  restoreFrame: async (frameId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/frames/${encodeURIComponent(frameId)}/restore`,
        { method: "POST", body: JSON.stringify({}) }
      );
      set({ project: json.project, selFrameFile: json.frame?.file || get().selFrameFile });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  addClipFromFrame: async (frameFile) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/clips`, {
        method: "POST",
        body: JSON.stringify({ frameFile })
      });
      set({
        project: json.project,
        selClipId: json.clip?.id || null,
        selFrameFile: frameFile,
        selectedSegmentIds: [],
        selectedGuideId: json.clip?.guides?.[0]?.id || null,
        activeWorkbench: "guide"
      });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  deleteClip: async (clipId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}`,
        { method: "DELETE" }
      );
      const first = json.project?.sequence?.clips?.[0] || null;
      set({
        project: json.project,
        selClipId: get().selClipId === clipId ? first?.id || null : get().selClipId,
        selectedSegmentIds: [],
        selectedGuideId: first?.guides?.[0]?.id || null
      });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },

  saveScreenplay: async (markdown, settings = {}) => {
    const project = get().project;
    if (!project) return;
    set({ screenplayBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/screenplay`, {
        method: "PUT",
        body: JSON.stringify({ markdown, settings, source: "import" })
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ screenplayBusy: false });
    }
  },
  approveScreenplay: async () => {
    const project = get().project;
    if (!project) return;
    set({ screenplayBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/screenplay/approve`, {
        method: "POST",
        body: JSON.stringify({ approvedBy: "Director", expectedRevision: project.screenplay?.revision })
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ screenplayBusy: false });
    }
  },
  generateScreenplay: async (body) => {
    const project = get().project;
    if (!project) return;
    set({ screenplayBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/screenplay/generate`, {
        method: "POST",
        body: JSON.stringify(body || {})
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ screenplayBusy: false });
    }
  },
  createScreenplayShotPlan: async (body = {}) => {
    const project = get().project;
    if (!project) return;
    set({ screenplayBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/screenplay/shot-plan`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ screenplayBusy: false });
    }
  },
  buildScreenplayTimeline: async (body = {}) => {
    const project = get().project;
    if (!project) return;
    set({ screenplayBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/screenplay/build-timeline`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      const firstNew = (json.createdClipIds || [])[0] || json.project?.sequence?.clips?.[0]?.id || null;
      set({
        project: json.project,
        selClipId: firstNew,
        selectedSegmentIds: [],
        selectedGuideId: null,
        activeWorkbench: "prompt"
      });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ screenplayBusy: false });
    }
  },

  refreshAssetWorkflows: async () => {
    try {
      const json = await api("/api/asset-workflows");
      set({ assetWorkflows: json.workflows || [], lmStudioGpu: json.lmStudioGpu || null });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  handoffLmStudioGpu: async () => {
    set({ gpuHandoffBusy: true, error: null });
    try {
      const json = await api("/api/lm-studio/gpu-handoff", {
        method: "POST",
        body: JSON.stringify({
          confirmation: "UNLOAD_QWEN_AND_CANCEL_ACTIVE_GENERATION",
          expectedModel: get().health.screenplayModel,
          confirmCancelGenerating: true
        })
      });
      set({ assetWorkflows: json.workflows || [], lmStudioGpu: json.lmStudioGpu || null });
      await get().refreshHealth();
    } catch (error: any) {
      set({ error: String(error.message) });
      await get().refreshAssetWorkflows();
      throw error;
    } finally {
      set({ gpuHandoffBusy: false });
    }
  },
  buildAssets: async (body = {}) => {
    const project = get().project;
    if (!project) return;
    set({ assetBusy: true, error: null });
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/extract`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      set({ project: json.project, assetWorkflows: json.workflows || get().assetWorkflows });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    } finally {
      set({ assetBusy: false });
    }
  },
  createAsset: async (body) => {
    const project = get().project;
    if (!project) return null;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      set({ project: json.project });
      return json.asset;
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  patchAsset: async (assetId, body) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  uploadAssetImage: async (assetId, file) => {
    const project = get().project;
    if (!project) return null;
    try {
      const form = new FormData();
      form.append("file", file);
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}/import-image`, {
        method: "POST",
        body: form
      });
      set({ project: json.project });
      return json.asset;
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  uploadAssetAudio: async (assetId, file) => {
    const project = get().project;
    if (!project) return null;
    try {
      const form = new FormData();
      form.append("file", file);
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}/import-audio`, {
        method: "POST",
        body: form
      });
      set({ project: json.project });
      return json.asset;
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  deleteAsset: async (assetId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: assetId })
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  approveAsset: async (assetId) => {
    const project = get().project;
    if (!project) return;
    const asset = project.assets?.items?.find((item: any) => item.id === assetId);
    if (!asset) throw new Error("Asset not found");
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}/approve`, {
        method: "POST",
        body: JSON.stringify({ approvedBy: "Director", expectedVersion: asset.activeVersion })
      });
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  generateAsset: async (assetId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}/generate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      set({ project: json.project });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  generateAssets: async (assetIds = [], regenerate = false) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/generate-all`, {
        method: "POST",
        body: JSON.stringify({ assetIds, regenerate })
      });
      set({ project: json.project });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  stopAssetGeneration: async (assetId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/stop-generation`, {
        method: "POST",
        body: JSON.stringify(assetId ? { assetId } : {})
      });
      set({ project: json.project, jobs: json.jobs || get().jobs });
      await get().reloadProject();
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  promoteAsset: async (assetId) => {
    const project = get().project;
    if (!project) return;
    const asset = project.assets?.items?.find((item: any) => item.id === assetId);
    if (!asset) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/${encodeURIComponent(assetId)}/promote`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: asset?.activeVersion,
          expectedFingerprint: asset?.approval?.versionFingerprint
        })
      });
      set({ project: json.project, selFrameFile: json.frame?.file || get().selFrameFile });
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },
  refreshPromptEnhance: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/enhance-prompts`);
      const enhance = json.enhance || null;
      const active = Boolean(enhance?.active || ["queued", "running", "cancelling"].includes(String(enhance?.status || "")));
      set({ promptEnhance: enhance, promptEnhanceBusy: active });
      if (active || enhance?.status === "done") {
        // Reload project so inspector prompts update as agents apply results.
        await get().reloadProject();
      }
    } catch (error: any) {
      // Status polling should not spam the global error banner for transient failures.
      console.warn("prompt enhance status", error?.message || error);
    }
  },
  enhanceAssetPrompts: async (assetIds = [], concurrency) => {
    const project = get().project;
    if (!project) return;
    set({ promptEnhanceBusy: true, error: null });
    try {
      const body: any = {};
      if (Array.isArray(assetIds) && assetIds.length) body.assetIds = assetIds;
      if (concurrency) body.concurrency = concurrency;
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/enhance-prompts`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      set({ promptEnhance: json.enhance || null, promptEnhanceBusy: true });
      await get().refreshPromptEnhance();
    } catch (error: any) {
      set({ error: String(error.message), promptEnhanceBusy: false });
      throw error;
    }
  },
  stopPromptEnhance: async () => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/assets/enhance-prompts/stop`, {
        method: "POST",
        body: JSON.stringify({})
      });
      set({ promptEnhance: json.enhance || null });
      await get().refreshPromptEnhance();
    } catch (error: any) {
      set({ error: String(error.message) });
      throw error;
    }
  },

  attachGuide: async (clipId, body) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}/guides`,
        { method: "POST", body: JSON.stringify(body) }
      );
      set({ project: json.project, selectedGuideId: json.guide?.id || null, activeWorkbench: "guide" });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  patchGuide: async (clipId, guideId, body) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}/guides/${encodeURIComponent(guideId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      set({ project: json.project });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  deleteGuide: async (clipId, guideId) => {
    const project = get().project;
    if (!project) return;
    try {
      const json = await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}/guides/${encodeURIComponent(guideId)}`,
        { method: "DELETE" }
      );
      set({ project: json.project, selectedGuideId: null });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },

  renderSelection: async (clipId) => {
    const project = get().project;
    const id = clipId || get().selClipId;
    if (!project || !id) return;
    await get().saveProject();
    try {
      const body: any = { clipId: id };
      const selected = get().selectedSegmentIds;
      if (selected.length) body.segmentIds = selected;
      else if (get().markInFrame != null && get().markOutFrame != null) {
        body.startFrame = Math.min(get().markInFrame!, get().markOutFrame!);
        body.endFrame = Math.max(get().markInFrame!, get().markOutFrame!);
      }
      await api(`/api/projects/${encodeURIComponent(project.slug)}/render`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  renderH3Selection: async (clipId, mode) => {
    const project = get().project;
    const id = clipId || get().selClipId;
    if (!project || !id) return;
    await get().saveProject();
    set({ h3Busy: true, error: null });
    try {
      const body: any = { clipId: id, mode: mode || get().h3Mode };
      const selected = get().selectedSegmentIds;
      if (selected.length) body.segmentIds = selected;
      else if (get().markInFrame != null && get().markOutFrame != null) {
        body.startFrame = Math.min(get().markInFrame!, get().markOutFrame!);
        body.endFrame = Math.max(get().markInFrame!, get().markOutFrame!);
      }
      const json = await api(`/api/projects/${encodeURIComponent(project.slug)}/render-h3`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (json.diagnostics) set({ h3Diagnostics: json.diagnostics });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message || error) });
      await get().refreshH3Diagnostics(true);
    } finally {
      set({ h3Busy: false });
    }
  },
  renderDirty: async (clipId) => {
    const project = get().project;
    const id = clipId || get().selClipId;
    if (!project || !id) return;
    await get().saveProject();
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/render`, {
        method: "POST",
        body: JSON.stringify({ clipId: id, dirty: true })
      });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  renderAll: async () => {
    const project = get().project;
    if (!project) return;
    await get().saveProject();
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/render`, {
        method: "POST",
        body: JSON.stringify({ all: true })
      });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  renderAllDirty: async () => {
    const project = get().project;
    if (!project) return;
    await get().saveProject();
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/render`, {
        method: "POST",
        body: JSON.stringify({ dirtyAll: true })
      });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  assembleClip: async (clipId) => {
    const project = get().project;
    if (!project) return;
    try {
      await api(
        `/api/projects/${encodeURIComponent(project.slug)}/clips/${encodeURIComponent(clipId)}/assemble`,
        { method: "POST", body: JSON.stringify({}) }
      );
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  cancelJob: async (jobId) => {
    try {
      await api(`/api/queue/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },

  updateBookendsLocal: (body) => get().patchLocal((project) => {
    project.settings = project.settings || {};
    const current = project.settings.bookends || {};
    project.settings.bookends = {
      ...current,
      ...body,
      opening: { ...(current.opening || {}), ...(body.opening || {}) },
      credits: { ...(current.credits || {}), ...(body.credits || {}) }
    };
  }),
  updateScoreLocal: (body) => get().patchLocal((project) => {
    project.score = { ...(project.score || {}), ...body };
  }),
  uploadScore: async (file) => {
    const project = get().project;
    if (!project) return;
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/score/upload`, {
        method: "POST",
        body: form
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Score upload failed");
      set({ project: json.project, activeWorkbench: "score" });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  generateScore: async () => {
    const project = get().project;
    if (!project) return;
    await get().saveProject();
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/score/generate`, {
        method: "POST",
        body: JSON.stringify({ score: get().project?.score })
      });
      await get().refreshQueue();
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  },
  buildMaster: async () => {
    const project = get().project;
    if (!project) return;
    await get().saveProject();
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/master/build`, {
        method: "POST",
        body: JSON.stringify({
          score: get().project?.score,
          bookends: get().project?.settings?.bookends
        })
      });
      await get().refreshQueue();
      set({ activeWorkbench: "master" });
    } catch (error: any) {
      set({ error: String(error.message) });
    }
  }
}));
