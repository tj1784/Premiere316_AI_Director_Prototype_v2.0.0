export type AssetGenerationPhase = "references" | "prompts" | "images";
export type AssetGenerationRun = {
  id: string;
  pictureId: string;
  kind: "prompts" | "regenerate" | "images";
  status: "running" | "completed" | "failed" | "interrupted";
  phase: AssetGenerationPhase;
  startedAt: number;
  phaseStartedAt: number;
  updatedAt: number;
  finishedAt?: number;
  message: string;
  activity: { at: number; phase: AssetGenerationPhase; message: string }[];
  output?: { model: string; text: string; reasoning?: string; updatedAt: number };
  counts?: { assets: number; prompts: number; images: number; references: number };
};

type RunUpdate = Partial<Pick<AssetGenerationRun, "phase" | "message" | "output" | "counts">>;
type RunStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_KEY = "premiere316-asset-generation-runs-v1";

/** The promise belongs to the app session, so its status must outlive a stage component. */
export function createAssetGenerationRuns(getStorage: () => RunStorage | undefined = () => undefined, now = Date.now) {
  const records = new Map<string, AssetGenerationRun>();
  const listeners = new Set<() => void>();
  let loaded = false;
  let sequence = 0;
  let lastStreamNotify = 0;
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    try { getStorage()?.setItem(STORAGE_KEY, JSON.stringify([...records.values()])); }
    catch { /* Storage pressure must not stop generation or its live status. */ }
  };
  const hydrate = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = getStorage()?.getItem(STORAGE_KEY);
      const saved: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved)) return;
      for (const entry of saved) {
        if (!entry || typeof entry.pictureId !== "string" || typeof entry.id !== "string" || !Array.isArray(entry.activity)) continue;
        const record = entry as AssetGenerationRun;
        if (record.status === "running") {
          const message = "The app restarted before this run finished. Saved prompts and images are retained. Start regeneration to continue.";
          records.set(record.pictureId, { ...record, status: "interrupted", message, finishedAt: now(), updatedAt: now(), activity: [...record.activity.slice(-59), { at: now(), phase: record.phase, message }] });
        } else records.set(record.pictureId, record);
      }
    } catch { /* A corrupt status cache does not affect saved picture data. */ }
  };
  const notify = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = undefined;
    lastStreamNotify = now();
    persist();
    for (const listener of listeners) listener();
  };
  const get = (pictureId: string) => { hydrate(); return records.get(pictureId) ?? null; };
  const update = (pictureId: string, runId: string, patch: RunUpdate, stream = false) => {
    const current = get(pictureId);
    if (!current || current.id !== runId || current.status !== "running") return;
    const at = now();
    const phase = patch.phase ?? current.phase;
    const changedMessage = patch.message && (patch.message !== current.message || phase !== current.phase);
    records.set(pictureId, { ...current, ...patch, phase, updatedAt: at,
      phaseStartedAt: phase !== current.phase ? at : current.phaseStartedAt,
      activity: changedMessage ? [...current.activity.slice(-59), { at, phase, message: patch.message! }] : current.activity,
    });
    // Streaming output can arrive token by token. Keep it live without rerendering every asset per token.
    if (stream && at - lastStreamNotify < 250) {
      notifyTimer ??= setTimeout(notify, 250);
    } else notify();
  };
  return {
    get,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start(pictureId: string, kind: AssetGenerationRun["kind"], phase: AssetGenerationPhase, message: string) {
      if (get(pictureId)?.status === "running") return null;
      const at = now();
      const id = `${pictureId}:${at}:${++sequence}`;
      records.set(pictureId, { id, pictureId, kind, status: "running", phase, startedAt: at, phaseStartedAt: at, updatedAt: at, message, activity: [{ at, phase, message }] });
      notify();
      return id;
    },
    update,
    finish(pictureId: string, runId: string, status: "completed" | "failed", message: string) {
      const current = get(pictureId);
      if (!current || current.id !== runId || current.status !== "running") return;
      const at = now();
      records.set(pictureId, { ...current, status, message, updatedAt: at, finishedAt: at, activity: [...current.activity.slice(-59), { at, phase: current.phase, message }] });
      notify();
    },
  };
}

export const assetGenerationRuns = createAssetGenerationRuns(() => typeof window === "undefined" ? undefined : window.localStorage);
