import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./VoiceDesignWorkspace.css";

export type VoiceDesignWorkspaceProps = {
  slug: string;
  project: any;
  jobs: any[];
  active: boolean;
  onCancelJob: (id: string) => Promise<any> | any;
  onSendToIndexTts?: (voiceId: string) => void;
  onEngineStatusChange?: (status: VoiceDesignEngineSummary) => void;
};

export type VoiceDesignEngineSummary = {
  label: string;
  detail: string;
  status: "ready" | "waiting" | "offline";
};

export type VoiceDescriptionFields = {
  apparentAge: string;
  genderPresentation: string;
  vocalRegister: string;
  vocalWeight: string;
  timbre: string;
  texture: string;
  resonance: string;
  accentCadence: string;
  diction: string;
  baselinePace: string;
  emotionalTemperament: string;
  performanceStyle: string;
  intensity: string;
  historicalCinematicDirection: string;
  exclusions: string;
};

type AdvancedSettings = {
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  create48kCopy: boolean;
};

type VoiceDesignDraft = {
  voiceName: string;
  characterId: string;
  language: string;
  auditionText: string;
  seed: string;
  auditionCount: 1 | 2 | 3;
  description: VoiceDescriptionFields;
  settings: AdvancedSettings;
};

type WorkspaceSnapshot = {
  voiceDesign: any;
  health: any;
  characters: any[];
};

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "starting", "loading", "generating", "cancelling"]);
const READY_AUDITION_STATUSES = new Set(["ready", "done", "completed", "succeeded", "selected", "saved"]);
const FORBIDDEN_AUDIBLE_METADATA = /\[(?:character|style|voice\s*id|pause)(?:[^\]]*)\]/i;

const DESCRIPTION_FIELDS: Array<{
  key: keyof VoiceDescriptionFields;
  label: string;
  placeholder: string;
  wide?: boolean;
  multiline?: boolean;
}> = [
  { key: "apparentAge", label: "Apparent age", placeholder: "Nineteen-year-old; mature forties" },
  { key: "genderPresentation", label: "Gender presentation", placeholder: "Masculine, feminine, androgynous" },
  { key: "vocalRegister", label: "Vocal register", placeholder: "Light baritone leaning tenor" },
  { key: "vocalWeight", label: "Vocal weight", placeholder: "Light, grounded, full-bodied" },
  { key: "timbre", label: "Timbre", placeholder: "Chestnut warmth, bright silver" },
  { key: "texture", label: "Texture", placeholder: "Clean, breathy, lightly weathered" },
  { key: "resonance", label: "Resonance", placeholder: "Warm chest resonance" },
  { key: "accentCadence", label: "Accent / cadence", placeholder: "Neutral accent, unhurried cadence" },
  { key: "diction", label: "Diction", placeholder: "Clear but naturally unpolished" },
  { key: "baselinePace", label: "Baseline pace", placeholder: "Measured, conversational" },
  { key: "emotionalTemperament", label: "Emotional temperament", placeholder: "Confidence masking uncertainty", wide: true },
  { key: "performanceStyle", label: "Performance style", placeholder: "Intimate live-action dramatic performance", wide: true },
  { key: "intensity", label: "Intensity", placeholder: "Restrained, low-to-medium intensity" },
  { key: "historicalCinematicDirection", label: "Historical / cinematic direction", placeholder: "Grounded first-century period drama; natural location sound", wide: true },
  { key: "exclusions", label: "Exclusions", placeholder: "No announcer voice, no theatrical exaggeration, no synthetic or cartoonish delivery", wide: true, multiline: true }
];

const LANGUAGE_OPTIONS = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "German",
  "French",
  "Russian",
  "Portuguese",
  "Spanish",
  "Italian"
];

function emptyDescription(): VoiceDescriptionFields {
  return {
    apparentAge: "",
    genderPresentation: "",
    vocalRegister: "",
    vocalWeight: "",
    timbre: "",
    texture: "",
    resonance: "",
    accentCadence: "",
    diction: "",
    baselinePace: "",
    emotionalTemperament: "",
    performanceStyle: "",
    intensity: "",
    historicalCinematicDirection: "",
    exclusions: ""
  };
}

function defaultDraft(): VoiceDesignDraft {
  return {
    voiceName: "",
    characterId: "",
    language: "English",
    auditionText: "",
    seed: "",
    auditionCount: 3,
    description: emptyDescription(),
    settings: {
      temperature: 0.9,
      topP: 0.95,
      topK: 50,
      repetitionPenalty: 1.05,
      create48kCopy: true
    }
  };
}

function clamp(value: any, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function draftStorageKey(slug: string) {
  return `premiere316.voice-design:v1:${slug || "project"}`;
}

function loadDraft(slug: string): VoiceDesignDraft {
  const fallback = defaultDraft();
  if (typeof window === "undefined") return fallback;
  try {
    const saved = JSON.parse(window.localStorage.getItem(draftStorageKey(slug)) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    const count = Math.trunc(clamp(saved.auditionCount, 1, 3, 3)) as 1 | 2 | 3;
    return {
      ...fallback,
      ...saved,
      voiceName: String(saved.voiceName || ""),
      characterId: String(saved.characterId || ""),
      language: LANGUAGE_OPTIONS.includes(String(saved.language)) ? String(saved.language) : fallback.language,
      auditionText: String(saved.auditionText || ""),
      seed: saved.seed === null || saved.seed === undefined ? "" : String(saved.seed),
      auditionCount: count,
      description: { ...fallback.description, ...(saved.description || {}) },
      settings: {
        ...fallback.settings,
        ...(saved.settings || {}),
        temperature: clamp(saved.settings?.temperature, 0.1, 2, fallback.settings.temperature),
        topP: clamp(saved.settings?.topP, 0.1, 1, fallback.settings.topP),
        topK: Math.trunc(clamp(saved.settings?.topK, 1, 100, fallback.settings.topK)),
        repetitionPenalty: clamp(saved.settings?.repetitionPenalty, 1, 2, fallback.settings.repetitionPenalty),
        create48kCopy: saved.settings?.create48kCopy !== false
      }
    };
  } catch {
    return fallback;
  }
}

function cleanPhrase(value: any) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/[.;,]+$/g, "");
}

/** Compile casting controls into Qwen's non-audible `instruct` argument. */
export function compileVoiceDesignInstruct(fields: VoiceDescriptionFields) {
  const descriptors: string[] = [];
  const age = cleanPhrase(fields.apparentAge);
  const gender = cleanPhrase(fields.genderPresentation);
  if (age && gender) descriptors.push(`${age}, ${gender} voice`);
  else if (age) descriptors.push(`${age} voice`);
  else if (gender) descriptors.push(`${gender} voice`);

  const labeled: Array<[string, any]> = [
    ["vocal register", fields.vocalRegister],
    ["vocal weight", fields.vocalWeight],
    ["timbre", fields.timbre],
    ["texture", fields.texture],
    ["resonance", fields.resonance],
    ["accent and cadence", fields.accentCadence],
    ["diction", fields.diction],
    ["baseline pace", fields.baselinePace],
    ["emotional temperament", fields.emotionalTemperament],
    ["performance style", fields.performanceStyle],
    ["intensity", fields.intensity],
    ["historical and cinematic direction", fields.historicalCinematicDirection]
  ];
  for (const [label, value] of labeled) {
    const phrase = cleanPhrase(value);
    if (phrase) descriptors.push(`${label}: ${phrase}`);
  }

  const exclusions = cleanPhrase(fields.exclusions);
  const body = descriptors.length ? `Design a natural, realistic human voice with ${descriptors.join(", ")}.` : "";
  const avoid = exclusions ? `The performance must follow these exclusions: ${exclusions}.` : "";
  return [body, avoid].filter(Boolean).join(" ");
}

function collection(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function objectValue(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function entityId(value: any) {
  return String(value?.id || value?.auditionId || value?.characterId || value?.assetId || value?.slug || "");
}

function characterName(character: any) {
  return String(character?.name || character?.characterName || character?.title || character?.label || entityId(character) || "Character");
}

function safeMediaUrl(value: any) {
  const url = String(value || "").trim().replace(/\\/g, "/");
  if (!url || /^[a-z]:\//i.test(url)) return "";
  if (/^(?:https?:|blob:|data:)/i.test(url) || url.startsWith("/")) return url;
  return `/${url.replace(/^\.\//, "")}`;
}

function nativeMediaUrl(audition: any) {
  return safeMediaUrl(audition?.nativeMediaUrl || audition?.nativeAudioUrl || audition?.media?.nativeUrl);
}

function productionMediaUrl(audition: any) {
  return safeMediaUrl(audition?.productionMediaUrl || audition?.production48kMediaUrl || audition?.media?.productionUrl || audition?.mediaUrl || audition?.audioUrl);
}

function auditionId(audition: any) {
  return String(audition?.id || audition?.auditionId || audition?.outputId || "");
}

function auditionName(audition: any) {
  const index = Number(audition?.index);
  return String(audition?.name || audition?.voiceName || (Number.isFinite(index) ? `Audition ${index}` : "Voice audition"));
}

function formatDate(value: any) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Just now";
}

function formatDuration(value: any) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(1)} sec` : "Duration pending";
}

function formatBytes(value: any) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function collectAuditions(voiceDesign: any) {
  const byId = new Map<string, any>();
  const sessions = collection(voiceDesign?.sessions || voiceDesign?.batches);
  for (const session of sessions) {
    for (const audition of collection(session?.auditions || session?.outputs)) {
      const id = auditionId(audition);
      if (!id) continue;
      byId.set(id, {
        ...audition,
        sessionId: audition?.sessionId || session?.id,
        jobId: audition?.jobId || session?.jobId,
        createdAt: audition?.createdAt || session?.createdAt,
        characterId: audition?.characterId || session?.characterId,
        voiceName: audition?.voiceName || session?.voiceName,
        language: audition?.language || session?.language,
        auditionText: audition?.auditionText || session?.auditionText
      });
    }
  }
  for (const audition of collection(voiceDesign?.auditions || voiceDesign?.outputs)) {
    const id = auditionId(audition);
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...audition });
  }
  return [...byId.values()].sort((left, right) => {
    const dateOrder = String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""));
    if (dateOrder) return dateOrder;
    return Number(left?.index || 0) - Number(right?.index || 0);
  });
}

function mergeSession(voiceDesign: any, session: any) {
  if (!session || typeof session !== "object") return voiceDesign || {};
  const sessions = collection(voiceDesign?.sessions).filter((item) => String(item?.id || "") !== String(session.id || ""));
  return { ...(voiceDesign || {}), sessions: [session, ...sessions] };
}

function projectCharacters(project: any) {
  const direct = collection(project?.characters || project?.cast);
  const assets = collection(project?.assets?.items || project?.assets).filter((asset) => String(asset?.category || asset?.type || "").toLowerCase() === "character");
  const byId = new Map<string, any>();
  for (const character of [...direct, ...assets]) {
    const id = String(character?.characterId || character?.sourceAssetId || character?.id || character?.slug || "");
    if (id && !byId.has(id)) byId.set(id, { ...character, characterId: id });
  }
  return [...byId.values()];
}

function selectedCharacterId(project: any) {
  return String(project?.activeCharacterId || project?.selectedCharacterId || project?.selectedAssetId || "");
}

function profileValue(character: any, ...keys: string[]) {
  const profile = {
    ...objectValue(character),
    ...objectValue(character?.voice),
    ...objectValue(character?.voiceProfile),
    ...objectValue(character?.voiceDesign)
  };
  for (const key of keys) {
    const value = profile[key];
    if (Array.isArray(value) && value.length) return value.join(", ");
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function extractEngineStatus(value: any) {
  const envelope = objectValue(value);
  const nestedStatus = objectValue(envelope.status);
  const nestedHealth = objectValue(envelope.health);
  return { ...envelope, ...nestedHealth, ...nestedStatus };
}

async function responseJson(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || json.reason || json.message || response.statusText || "Request failed");
  return json;
}

async function requestJson(url: string, method = "GET", body?: any) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return responseJson(response);
}

type AuditionCardProps = {
  audition: any;
  selected: boolean;
  saved: boolean;
  compareMode: boolean;
  comparing: boolean;
  compareDisabled: boolean;
  busy: boolean;
  onCompare: (id: string) => void;
  onRegenerate: (id: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onSelect: (id: string) => Promise<boolean>;
  onSave: (id: string) => Promise<boolean>;
  onSend: (id: string) => Promise<boolean>;
  onOpenFolder: (id: string) => Promise<boolean>;
};

function AuditionCard({
  audition,
  selected,
  saved,
  compareMode,
  comparing,
  compareDisabled,
  busy,
  onCompare,
  onRegenerate,
  onRename,
  onDelete,
  onSelect,
  onSave,
  onSend,
  onOpenFolder
}: AuditionCardProps) {
  const id = auditionId(audition);
  const nativeUrl = nativeMediaUrl(audition);
  const productionUrl = productionMediaUrl(audition);
  const [variant, setVariant] = useState<"native" | "production">(nativeUrl ? "native" : "production");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(auditionName(audition));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = String(audition?.status || (nativeUrl || productionUrl ? "ready" : "queued")).toLowerCase();
  const ready = READY_AUDITION_STATUSES.has(status) || Boolean(nativeUrl || productionUrl);
  const qualityFailed = audition?.quality?.passed === false || audition?.quality?.valid === false;
  const audioUrl = variant === "production" && productionUrl ? productionUrl : nativeUrl || productionUrl;
  const qualityLabel = audition?.quality?.label || audition?.quality?.status || (audition?.quality?.passed === true ? "Validated" : "");
  const transcript = String(audition?.auditionText || audition?.transcript || audition?.text || "").trim();
  const durationSec = Number(audition?.durationSec || audition?.duration);
  const indexTtsDurationEligible = Number.isFinite(durationSec) && durationSec >= 7.95 && durationSec <= 15.05;
  const indexTtsHintId = `index-tts-duration-${id}`;

  useEffect(() => {
    setRenameValue(auditionName(audition));
  }, [audition?.name, audition?.voiceName, audition?.index]);

  useEffect(() => {
    if (variant === "native" && !nativeUrl && productionUrl) setVariant("production");
    if (variant === "production" && !productionUrl && nativeUrl) setVariant("native");
  }, [nativeUrl, productionUrl, variant]);

  async function saveRename() {
    const name = renameValue.trim();
    if (!name) return;
    if (await onRename(id, name)) setRenaming(false);
  }

  async function remove() {
    if (await onDelete(id)) setConfirmDelete(false);
  }

  return (
    <article className={`voice-design-audition-card ${selected ? "selected" : ""} ${comparing ? "comparing" : ""}`} aria-label={auditionName(audition)}>
      <header>
        <span className="voice-design-audition-index">{Number.isFinite(Number(audition?.index)) ? Number(audition.index) : "A"}</span>
        <div>
          {renaming ? (
            <div className="voice-design-rename-row">
              <label className="voice-design-sr-only" htmlFor={`rename-${id}`}>Audition name</label>
              <input
                id={`rename-${id}`}
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveRename();
                  }
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
              <button type="button" className="button secondary" onClick={() => void saveRename()} disabled={busy || !renameValue.trim()}>Save</button>
              <button type="button" className="button ghost" onClick={() => setRenaming(false)} disabled={busy}>Cancel</button>
            </div>
          ) : (
            <>
              <b>{auditionName(audition)}</b>
              <small>{formatDate(audition?.createdAt)} · seed {audition?.seed ?? "random"}</small>
            </>
          )}
        </div>
        <div className="voice-design-audition-badges">
          {selected ? <em className="selected">Character voice</em> : null}
          {saved ? <em className="saved">In library</em> : null}
          <em className={status}>{status}</em>
        </div>
      </header>

      {compareMode ? (
        <label className="voice-design-compare-check">
          <input type="checkbox" checked={comparing} disabled={!comparing && compareDisabled} onChange={() => onCompare(id)} />
          Include in comparison
        </label>
      ) : null}

      {transcript ? <blockquote className="voice-design-audition-transcript"><span>Exact transcript</span>{transcript}</blockquote> : null}

      {audioUrl ? (
        <div className="voice-design-audio-block">
          {nativeUrl && productionUrl && nativeUrl !== productionUrl ? (
            <div className="voice-design-audio-variants" role="group" aria-label="Audio version">
              <button type="button" className={variant === "native" ? "active" : ""} aria-pressed={variant === "native"} onClick={() => setVariant("native")}>Native master</button>
              <button type="button" className={variant === "production" ? "active" : ""} aria-pressed={variant === "production"} onClick={() => setVariant("production")}>48 kHz copy</button>
            </div>
          ) : null}
          <audio key={audioUrl} controls preload="metadata" src={audioUrl}>Your browser cannot play this WAV file.</audio>
        </div>
      ) : (
        <div className={`voice-design-render-state ${status}`}>
          <i aria-hidden="true" />
          <span>{status === "error" || status === "failed" ? audition?.error || "Audition generation failed." : "Waiting for the native WAV…"}</span>
        </div>
      )}

      <dl className="voice-design-audition-facts">
        <div><dt>Duration</dt><dd>{formatDuration(audition?.durationSec || audition?.duration)}</dd></div>
        <div><dt>Native rate</dt><dd>{Number(audition?.nativeSampleRate || audition?.sampleRate) > 0 ? `${Number(audition?.nativeSampleRate || audition?.sampleRate).toLocaleString()} Hz` : "Pending"}</dd></div>
        {qualityLabel ? <div><dt>Quality</dt><dd className={qualityFailed ? "bad" : "good"}>{qualityLabel}</dd></div> : null}
        {audition?.sha256 ? <div title={String(audition.sha256)}><dt>SHA-256</dt><dd>{String(audition.sha256).slice(0, 12)}…</dd></div> : null}
      </dl>

      {qualityFailed ? <p className="voice-design-quality-warning" role="status">Quality validation did not pass. Fix or regenerate this audition before using it as a production voice.</p> : null}
      {ready && !indexTtsDurationEligible ? <p id={indexTtsHintId} className="voice-design-index-hint">IndexTTS requires an 8–15 second audition. Adjust the spoken text and regenerate if this take is outside that range.</p> : null}

      <div className="voice-design-audition-actions">
        <button type="button" className="button secondary" onClick={() => void onRegenerate(id)} disabled={busy}>Regenerate</button>
        <button type="button" className="button secondary" onClick={() => setRenaming(true)} disabled={busy || renaming}>Rename</button>
        <button type="button" className="button secondary" onClick={() => void onSelect(id)} disabled={busy || !ready || qualityFailed || selected}>Select voice</button>
        <button type="button" className="button secondary" onClick={() => void onSave(id)} disabled={busy || !ready || qualityFailed || saved}>Save to library</button>
        <button type="button" className="button primary" onClick={() => void onSend(id)} disabled={busy || !ready || qualityFailed || !indexTtsDurationEligible} aria-describedby={ready && !indexTtsDurationEligible ? indexTtsHintId : undefined}>Send to IndexTTS</button>
        <button type="button" className="button ghost" onClick={() => void onOpenFolder(id)} disabled={busy || !ready}>Open folder</button>
        {!confirmDelete ? (
          <button type="button" className="button ghost voice-design-delete" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</button>
        ) : (
          <span className="voice-design-delete-confirm">
            <b>Delete permanently?</b>
            <button type="button" className="button danger" onClick={() => void remove()} disabled={busy}>Delete</button>
            <button type="button" className="button ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button>
          </span>
        )}
      </div>
    </article>
  );
}

export default function VoiceDesignWorkspace({
  slug,
  project,
  jobs,
  active,
  onCancelJob,
  onSendToIndexTts,
  onEngineStatusChange
}: VoiceDesignWorkspaceProps) {
  const idPrefix = useId().replace(/:/g, "");
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const requestSequence = useRef(0);
  const [draftState, setDraftState] = useState<{ slug: string; draft: VoiceDesignDraft }>(() => ({ slug, draft: loadDraft(slug) }));
  const draft = draftState.slug === slug ? draftState.draft : loadDraft(slug);
  const setDraft = (update: React.SetStateAction<VoiceDesignDraft>) => {
    setDraftState((current) => {
      const currentDraft = current.slug === slug ? current.draft : loadDraft(slug);
      const nextDraft = typeof update === "function"
        ? (update as (value: VoiceDesignDraft) => VoiceDesignDraft)(currentDraft)
        : update;
      return { slug, draft: nextDraft };
    });
  };
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>({ voiceDesign: {}, health: {}, characters: [] });
  const [engineStatus, setEngineStatus] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
  const [lastJob, setLastJob] = useState<any>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    if (draftState.slug === slug) return;
    setDraftState({ slug, draft: loadDraft(slug) });
    setSnapshot({ voiceDesign: {}, health: {}, characters: [] });
    setLastJob(null);
    setPendingActions({});
    setCompareIds([]);
    setLoadError("");
    setFormError("");
    setNotice("");
  }, [slug, draftState.slug]);

  useEffect(() => {
    if (draftState.slug !== slug || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(draftStorageKey(slug), JSON.stringify(draftState.draft));
    } catch {}
  }, [draftState, slug]);

  const patchDraft = <K extends keyof VoiceDesignDraft>(key: K, value: VoiceDesignDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const patchDescription = (key: keyof VoiceDescriptionFields, value: string) => {
    setDraft((current) => ({ ...current, description: { ...current.description, [key]: value } }));
  };

  const patchSetting = <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) => {
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  };

  const refreshWorkspace = useCallback(async (silent = false) => {
    const requestSlug = slug;
    if (slugRef.current !== requestSlug) return;
    const sequence = ++requestSequence.current;
    if (!silent) setLoading(true);
    const projectUrl = `/api/projects/${encodeURIComponent(slug)}/sound/voice-design`;
    const [workspaceResult, statusResult] = await Promise.allSettled([
      requestJson(projectUrl),
      requestJson("/api/sound/qwen-voice-design/status")
    ]);
    if (sequence !== requestSequence.current || slugRef.current !== requestSlug) return;

    const errors: string[] = [];
    if (workspaceResult.status === "fulfilled") {
      const json = workspaceResult.value || {};
      setSnapshot((current) => ({
        voiceDesign: json.voiceDesign || json.sound?.voiceDesign || current.voiceDesign || {},
        health: json.health || current.health || {},
        characters: json.characters === undefined ? current.characters : collection(json.characters)
      }));
    } else {
      errors.push(`Voice workspace: ${String((workspaceResult.reason as any)?.message || workspaceResult.reason)}`);
    }

    if (statusResult.status === "fulfilled") {
      const json = statusResult.value || {};
      setEngineStatus(extractEngineStatus(json));
    } else {
      errors.push(`Engine status: ${String((statusResult.reason as any)?.message || statusResult.reason)}`);
    }
    setLoadError(errors.join(" · "));
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    if (!active) {
      requestSequence.current += 1;
      setLoading(false);
      for (const audio of workspaceRef.current?.querySelectorAll("audio") || []) audio.pause();
      return;
    }
    void refreshWorkspace(false);
    const timer = window.setInterval(() => void refreshWorkspace(true), 4000);
    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
    };
  }, [active, refreshWorkspace]);

  const characters = useMemo(() => {
    const byId = new Map<string, any>();
    for (const character of [...snapshot.characters, ...projectCharacters(project)]) {
      const id = String(character?.characterId || character?.sourceAssetId || character?.id || character?.slug || "");
      if (id && !byId.has(id)) byId.set(id, { ...character, characterId: id });
    }
    return [...byId.values()].sort((left, right) => characterName(left).localeCompare(characterName(right)));
  }, [snapshot.characters, project]);

  useEffect(() => {
    if (draft.characterId || !characters.length) return;
    const activeId = selectedCharacterId(project);
    const active = characters.find((character) => String(character.characterId || "") === activeId);
    if (active) patchDraft("characterId", String(active.characterId));
  }, [characters, draft.characterId, project]);

  const selectedCharacter = characters.find((character) => String(character.characterId || "") === draft.characterId) || null;
  const compiledInstruct = useMemo(() => compileVoiceDesignInstruct(draft.description), [draft.description]);
  const auditions = useMemo(() => collectAuditions(snapshot.voiceDesign), [snapshot.voiceDesign]);
  const auditionIds = useMemo(() => new Set(auditions.map(auditionId)), [auditions]);

  useEffect(() => {
    setCompareIds((current) => current.filter((id) => auditionIds.has(id)).slice(0, 3));
  }, [auditionIds]);

  const projectHealth = objectValue(snapshot.health?.providers?.qwenVoiceDesign || snapshot.health?.qwenVoiceDesign || snapshot.health);
  const rawStatus = extractEngineStatus(engineStatus);
  const health = { ...projectHealth, ...rawStatus };
  const installationState = String(health.installation?.status || health.installStatus || "").toLowerCase();
  const stateLabel = String(health.state || (typeof health.status === "string" ? health.status : "") || (health.loaded ? "loaded" : health.installed ? "unloaded" : "not installed")).toLowerCase();
  const engineInstalled = health.installed === true || health.available === true || health.ready === true || health.loaded === true || installationState === "installed" || ["ready", "loaded", "unloaded", "idle"].includes(stateLabel);
  const engineReady = health.ready === true || health.available === true || health.loaded === true || ["ready", "loaded", "unloaded", "idle"].includes(stateLabel);
  const engineLoaded = health.loaded === true || health.modelLoaded === true || ["ready", "loaded", "idle"].includes(stateLabel);
  const engineBusy = health.busy === true || ["loading", "unloading", "generating", "installing"].includes(stateLabel);
  const engineModelLabel = engineLoaded
    ? "Loaded"
    : engineReady
      ? "Installed · lazy load"
      : engineInstalled
        ? "Installed · model unavailable"
        : "Not installed";
  const engineUnavailableReason = !engineReady && engineInstalled ? String(health.reason || "The pinned model files are unavailable.") : "";
  const engineLabel = String(health.engine || health.engineName || "Qwen3-TTS VoiceDesign");
  const modelId = String(health.modelId || health.model?.id || "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  const precision = String(health.precision || health.dtype || health.model?.precision || "BF16 when supported");
  const attention = String(health.attentionBackend || health.attention || health.model?.attentionBackend || "SDPA / compatible backend");
  const gpuName = String(health.gpu?.name || health.gpuName || health.deviceName || "Local NVIDIA GPU");
  const freeVram = formatBytes(health.gpu?.freeVramBytes || health.gpu?.vramFreeBytes || health.freeVramBytes || health.vramFreeBytes);
  const totalVram = formatBytes(health.gpu?.totalVramBytes || health.gpu?.vramTotalBytes || health.totalVramBytes || health.vramTotalBytes);
  const vramLabel = freeVram ? `${freeVram} free${totalVram ? ` / ${totalVram}` : ""}` : String(health.vram || health.gpu?.vram || "VRAM status pending");

  useEffect(() => {
    if (!active || !onEngineStatusChange) return;
    const status: VoiceDesignEngineSummary["status"] = engineLoaded
      ? "ready"
      : engineInstalled || engineBusy || loading
        ? "waiting"
        : "offline";
    const detail = engineLoaded
      ? `${modelId.split("/").pop()} loaded · ${vramLabel}`
      : engineBusy
        ? `${engineLabel} is ${stateLabel || "busy"}.`
        : loading
          ? "Checking the standalone VoiceDesign engine…"
          : engineInstalled
            ? "Installed and ready for lazy GPU loading."
            : String(health.reason || loadError || "Qwen3-TTS VoiceDesign is not installed.");
    onEngineStatusChange({ label: engineLabel, detail, status });
  }, [active, engineBusy, engineInstalled, engineLabel, engineLoaded, health.reason, loadError, loading, modelId, onEngineStatusChange, stateLabel, vramLabel]);

  const sessions = collection(snapshot.voiceDesign?.sessions || snapshot.voiceDesign?.batches);
  const sessionStatusByJobId = new Map<string, string>();
  for (const session of sessions) {
    const jobId = String(session?.jobId || "");
    if (jobId) sessionStatusByJobId.set(jobId, String(session?.status || ""));
  }
  const knownJobIds = new Set([
    String(lastJob?.id || ""),
    ...sessions.map((session) => String(session?.jobId || "")),
    ...auditions.map((audition) => String(audition?.jobId || ""))
  ].filter(Boolean));
  const relevantJobs = useMemo(() => {
    const provided = Array.isArray(jobs) ? jobs : [];
    const available = lastJob && !provided.some((job) => String(job?.id || "") === String(lastJob.id || "")) ? [lastJob, ...provided] : provided;
    return available.filter((job) => {
      if (job?.projectSlug && String(job.projectSlug) !== slug) return false;
      if (knownJobIds.has(String(job?.id || ""))) return true;
      return /qwen|voice[\s_-]*design|generate[\s_-]*audition/i.test(`${job?.type || ""} ${job?.label || ""}`);
    }).map((job) => {
      const sessionStatus = sessionStatusByJobId.get(String(job?.id || ""));
      return sessionStatus ? { ...job, status: sessionStatus } : job;
    });
  }, [jobs, lastJob, slug, snapshot.voiceDesign, auditions]);
  const activeJobs = relevantJobs.filter((job) => ACTIVE_JOB_STATUSES.has(String(job?.status || "").toLowerCase()));
  const activeJob = activeJobs.find((job) => String(job?.status || "").toLowerCase() === "running") || activeJobs[0] || null;

  const selectedByCharacter = objectValue(snapshot.voiceDesign?.selectedByCharacter);
  const newestSessionSelections: string[] = [];
  const sessionSelectionScopes = new Set<string>();
  for (const session of sessions) {
    const selection = String(session?.selectedAuditionId || "");
    const scope = String(session?.characterId || "__project");
    if (!selection || sessionSelectionScopes.has(scope)) continue;
    sessionSelectionScopes.add(scope);
    newestSessionSelections.push(selection);
  }
  const selectedAuditionIds = new Set([
    String(snapshot.voiceDesign?.selectedAuditionId || ""),
    String(selectedByCharacter[draft.characterId] || ""),
    ...newestSessionSelections,
    ...auditions.filter((audition) => audition?.selected === true || audition?.isSelected === true || audition?.default === true).map(auditionId)
  ].filter(Boolean));

  const seedNumber = draft.seed.trim() === "" ? null : Number(draft.seed);
  const seedValid = seedNumber === null || (Number.isSafeInteger(seedNumber) && seedNumber >= 0 && seedNumber <= 2147483647);
  const audibleMetadataPresent = FORBIDDEN_AUDIBLE_METADATA.test(draft.auditionText);
  const canGenerate = engineReady
    && !engineBusy
    && !activeJobs.length
    && !pendingActions.generate
    && Boolean(draft.voiceName.trim())
    && Boolean(draft.auditionText.trim())
    && Boolean(compiledInstruct)
    && seedValid
    && !audibleMetadataPresent;

  function autofillFromCharacter() {
    if (!selectedCharacter) return;
    const next: VoiceDescriptionFields = {
      apparentAge: profileValue(selectedCharacter, "apparentAge", "ageRange", "age"),
      genderPresentation: profileValue(selectedCharacter, "genderPresentation", "gender"),
      vocalRegister: profileValue(selectedCharacter, "vocalRegister", "register"),
      vocalWeight: profileValue(selectedCharacter, "vocalWeight", "weight"),
      timbre: profileValue(selectedCharacter, "timbre", "tone"),
      texture: profileValue(selectedCharacter, "texture", "vocalTexture"),
      resonance: profileValue(selectedCharacter, "resonance"),
      accentCadence: profileValue(selectedCharacter, "accentCadence", "accent", "cadence"),
      diction: profileValue(selectedCharacter, "diction"),
      baselinePace: profileValue(selectedCharacter, "baselinePace", "pace"),
      emotionalTemperament: profileValue(selectedCharacter, "emotionalTemperament", "temperament", "personality"),
      performanceStyle: profileValue(selectedCharacter, "performanceStyle", "performanceDirection", "voiceDescription", "voicePrompt", "prompt"),
      intensity: profileValue(selectedCharacter, "intensity"),
      historicalCinematicDirection: profileValue(selectedCharacter, "historicalCinematicDirection", "historicalDirection", "cinematicDirection", "period", "era"),
      exclusions: profileValue(selectedCharacter, "exclusions", "voiceExclusions")
    };
    const populated = Object.values(next).filter((value) => String(value || "").trim()).length;
    const sampleText = profileValue(selectedCharacter, "auditionText", "sampleText", "dialogueSample", "sampleDialogue");
    setDraft((current) => ({
      ...current,
      voiceName: `${characterName(selectedCharacter)} — Designed Voice`,
      auditionText: sampleText || current.auditionText,
      description: { ...current.description, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value)) }
    }));
    setFormError("");
    setNotice(populated ? `Autofilled ${populated} voice fields from ${characterName(selectedCharacter)}.` : `${characterName(selectedCharacter)} has no structured voice fields yet; the voice name was filled in.`);
  }

  function markPending(key: string, pending: boolean) {
    setPendingActions((current) => {
      if (pending) return { ...current, [key]: true };
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function engineAction(action: "load" | "unload") {
    const requestSlug = slug;
    const key = `engine:${action}`;
    markPending(key, true);
    setFormError("");
    setNotice("");
    try {
      const json = await requestJson(`/api/sound/qwen-voice-design/${action}`, "POST", {});
      if (slugRef.current !== requestSlug) return;
      setEngineStatus(extractEngineStatus(json));
      setNotice(action === "load" ? "Qwen3-TTS is loading on the managed GPU. Status will refresh automatically." : "Qwen3-TTS was unloaded and its GPU memory was released.");
      await refreshWorkspace(true);
    } catch (error: any) {
      if (slugRef.current === requestSlug) setFormError(String(error.message || error));
    } finally {
      if (slugRef.current === requestSlug) markPending(key, false);
    }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    if (!engineReady) return setFormError(health.reason || "Qwen3-TTS VoiceDesign is not ready.");
    if (!draft.voiceName.trim()) return setFormError("Name the voice before generating auditions.");
    if (!draft.auditionText.trim()) return setFormError("Enter the exact audible words for the audition.");
    if (audibleMetadataPresent) return setFormError("Remove bracketed character, style, voice ID, or pause metadata from the audible audition text.");
    if (!compiledInstruct) return setFormError("Add at least one voice-description field. Direction belongs in the compiled instruct, not the spoken text.");
    if (!seedValid) return setFormError("Seed must be blank or a whole number from 0 to 2,147,483,647.");
    if (activeJobs.length) return setFormError("Wait for or cancel the active Voice Design job before starting another batch.");

    const requestSlug = slug;
    markPending("generate", true);
    try {
      const payload = {
        voiceName: draft.voiceName.trim(),
        characterId: draft.characterId || null,
        projectId: String(project?.id || project?.projectId || requestSlug),
        language: draft.language,
        auditionText: draft.auditionText.trim(),
        instruct: compiledInstruct,
        descriptionFields: draft.description,
        seed: seedNumber,
        auditionCount: draft.auditionCount,
        settings: draft.settings
      };
      const json = await requestJson(`/api/projects/${encodeURIComponent(requestSlug)}/sound/voice-design/auditions`, "POST", payload);
      if (slugRef.current !== requestSlug) return;
      if (json.job) setLastJob(json.job);
      if (json.session) setSnapshot((current) => ({ ...current, voiceDesign: mergeSession(current.voiceDesign, json.session) }));
      setNotice(`Queued ${draft.auditionCount} separate audition${draft.auditionCount === 1 ? "" : "s"}. Only the audition text will be spoken.`);
      await refreshWorkspace(true);
    } catch (error: any) {
      if (slugRef.current === requestSlug) setFormError(String(error.message || error));
    } finally {
      if (slugRef.current === requestSlug) markPending("generate", false);
    }
  }

  async function cancelJob(id: string) {
    if (!id) return;
    const requestSlug = slug;
    const key = `cancel:${id}`;
    markPending(key, true);
    setFormError("");
    try {
      await onCancelJob(id);
      if (slugRef.current !== requestSlug) return;
      setNotice(`Cancellation requested for job ${id}.`);
      await refreshWorkspace(true);
    } catch (error: any) {
      if (slugRef.current === requestSlug) setFormError(String(error.message || error));
    } finally {
      if (slugRef.current === requestSlug) markPending(key, false);
    }
  }

  async function auditionAction(id: string, action: string, method: "POST" | "PATCH" | "DELETE" = "POST", body?: any, success?: string) {
    const requestSlug = slug;
    const key = `${action}:${id}`;
    markPending(key, true);
    setFormError("");
    setNotice("");
    try {
      const suffix = action ? `/${action}` : "";
      const json = await requestJson(
        `/api/projects/${encodeURIComponent(requestSlug)}/sound/voice-design/auditions/${encodeURIComponent(id)}${suffix}`,
        method,
        method === "DELETE" ? undefined : body === undefined ? {} : body
      );
      if (slugRef.current !== requestSlug) return null;
      if (json.job) setLastJob(json.job);
      if (json.session) setSnapshot((current) => ({ ...current, voiceDesign: mergeSession(current.voiceDesign, json.session) }));
      if (success) setNotice(success);
      await refreshWorkspace(true);
      return json;
    } catch (error: any) {
      if (slugRef.current === requestSlug) setFormError(String(error.message || error));
      return null;
    } finally {
      if (slugRef.current === requestSlug) markPending(key, false);
    }
  }

  async function renameAudition(id: string, name: string) {
    return Boolean(await auditionAction(id, "", "PATCH", { name }, `Renamed audition to ${name}.`));
  }

  async function deleteAudition(id: string) {
    setCompareIds((current) => current.filter((candidate) => candidate !== id));
    return Boolean(await auditionAction(id, "", "DELETE", undefined, "Audition deleted."));
  }

  async function sendToIndexTts(id: string) {
    const json = await auditionAction(id, "send-to-index-tts", "POST", {}, "Registered the immutable audition WAV and exact transcript with IndexTTS 2.5.");
    if (!json) return false;
    const voiceId = String(json.voiceId || json.voice?.id || json.voice?.voiceId || json.indexTtsVoice?.id || "");
    if (voiceId && onSendToIndexTts) onSendToIndexTts(voiceId);
    return true;
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : current.length < 3 ? [...current, id] : current);
  }

  const compareAuditions = compareIds.map((id) => auditions.find((audition) => auditionId(audition) === id)).filter(Boolean);
  const projectName = String(project?.title || project?.name || project?.projectName || slug || "Current project");
  const descriptionCount = Object.values(draft.description).filter((value) => cleanPhrase(value)).length;

  return (
    <div ref={workspaceRef} className="voice-design-workspace">
      <section className="voice-design-engine-bar" aria-label="Qwen3-TTS engine status">
        <div className={`voice-design-engine-identity ${engineReady ? engineLoaded ? "ready" : "installed" : "offline"}`}>
          <i aria-hidden="true" />
          <span><b>{engineLabel}</b><small title={modelId}>{modelId}</small></span>
        </div>
        <dl className="voice-design-engine-facts">
          <div><dt>Model</dt><dd title={engineUnavailableReason || undefined}>{engineModelLabel}</dd></div>
          <div><dt>GPU / VRAM</dt><dd title={gpuName}>{vramLabel}</dd></div>
          <div><dt>Runtime</dt><dd>{precision} · {attention}</dd></div>
        </dl>
        <div className="voice-design-engine-actions">
          <button type="button" className="button secondary" onClick={() => void refreshWorkspace(false)} disabled={loading}>{loading ? "Checking…" : "Refresh"}</button>
          {!engineLoaded ? (
            <button type="button" className="button primary" onClick={() => void engineAction("load")} disabled={!engineReady || engineBusy || pendingActions["engine:load"]}>{pendingActions["engine:load"] || stateLabel === "loading" ? "Loading…" : "Load model"}</button>
          ) : (
            <button type="button" className="button secondary" onClick={() => void engineAction("unload")} disabled={engineBusy || activeJobs.length > 0 || pendingActions["engine:unload"]}>{pendingActions["engine:unload"] || stateLabel === "unloading" ? "Releasing…" : "Unload / release GPU"}</button>
          )}
        </div>
      </section>

      <form className="voice-design-grid" onSubmit={generate}>
        <section className="voice-design-panel voice-design-builder-panel">
          <header><div><span>1</span><h2>Cast the voice</h2></div><small>{descriptionCount}/15 fields</small></header>
          <div className="voice-design-panel-scroll">
            <div className="voice-design-context-grid">
              <label htmlFor={`${idPrefix}-project`}>Project
                <select id={`${idPrefix}-project`} value={slug} disabled aria-describedby={`${idPrefix}-project-help`}>
                  <option value={slug}>{projectName}</option>
                </select>
                <small id={`${idPrefix}-project-help`}>Voice assets stay scoped to this production.</small>
              </label>
              <label htmlFor={`${idPrefix}-character`}>Character
                <select id={`${idPrefix}-character`} value={draft.characterId} onChange={(event) => patchDraft("characterId", event.target.value)}>
                  <option value="">Project voice — no character</option>
                  {characters.map((character) => <option key={character.characterId} value={character.characterId}>{characterName(character)}</option>)}
                </select>
              </label>
            </div>

            <div className="voice-design-name-row">
              <label htmlFor={`${idPrefix}-voice-name`}>Voice name
                <input id={`${idPrefix}-voice-name`} value={draft.voiceName} onChange={(event) => patchDraft("voiceName", event.target.value)} placeholder="Jesus — Young Baritone" autoComplete="off" />
              </label>
              <button type="button" className="button secondary" onClick={autofillFromCharacter} disabled={!selectedCharacter}>Autofill from selected character</button>
            </div>

            <div className="voice-design-description-heading">
              <div><h3>Voice-description builder</h3><p>These casting notes compile into Qwen’s non-audible <code>instruct</code> value.</p></div>
              <button type="button" className="button ghost" onClick={() => patchDraft("description", emptyDescription())} disabled={!descriptionCount}>Clear fields</button>
            </div>

            <div className="voice-design-description-fields">
              {DESCRIPTION_FIELDS.map((field) => (
                <label key={field.key} className={field.wide ? "wide" : ""} htmlFor={`${idPrefix}-${field.key}`}>
                  {field.label}
                  {field.multiline ? (
                    <textarea id={`${idPrefix}-${field.key}`} rows={3} value={draft.description[field.key]} onChange={(event) => patchDescription(field.key, event.target.value)} placeholder={field.placeholder} />
                  ) : (
                    <input id={`${idPrefix}-${field.key}`} value={draft.description[field.key]} onChange={(event) => patchDescription(field.key, event.target.value)} placeholder={field.placeholder} autoComplete="off" />
                  )}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="voice-design-panel voice-design-script-panel">
          <header><div><span>2</span><h2>Audition brief</h2></div><small>Text and direction stay separate</small></header>
          <div className="voice-design-script-scroll">
            <div className="voice-design-audition-controls">
              <label htmlFor={`${idPrefix}-language`}>Language
                <select id={`${idPrefix}-language`} value={draft.language} onChange={(event) => patchDraft("language", event.target.value)}>
                  {LANGUAGE_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}
                </select>
              </label>
              <label htmlFor={`${idPrefix}-seed`}>Seed <span>optional</span>
                <input id={`${idPrefix}-seed`} type="number" min="0" max="2147483647" step="1" value={draft.seed} onChange={(event) => patchDraft("seed", event.target.value)} placeholder="Random" inputMode="numeric" />
              </label>
              <fieldset className="voice-design-count-field">
                <legend>Auditions</legend>
                <div>
                  {([1, 2, 3] as const).map((count) => (
                    <button key={count} type="button" className={draft.auditionCount === count ? "active" : ""} aria-pressed={draft.auditionCount === count} onClick={() => patchDraft("auditionCount", count)}>{count}</button>
                  ))}
                </div>
              </fieldset>
            </div>

            <label className="voice-design-audible-text" htmlFor={`${idPrefix}-audition-text`}>
              Audible audition text
              <textarea id={`${idPrefix}-audition-text`} rows={8} value={draft.auditionText} onChange={(event) => patchDraft("auditionText", event.target.value)} placeholder="Enter only the exact words the actor should say…" aria-describedby={`${idPrefix}-audition-help`} />
              <span><small id={`${idPrefix}-audition-help`}>Only this text is spoken. Do not add [Character], [Style], [Voice ID], [pause], or production direction.</small><small>{draft.auditionText.trim().length.toLocaleString()} characters</small></span>
            </label>
            {audibleMetadataPresent ? <div className="voice-design-inline-warning" role="alert">Bracketed production metadata was detected. Remove it so Qwen cannot speak it aloud.</div> : null}

            <section className="voice-design-instruct-preview" aria-labelledby={`${idPrefix}-instruct-title`}>
              <header><div><span>INSTRUCT</span><h3 id={`${idPrefix}-instruct-title`}>Compiled voice direction</h3></div><small>Not spoken</small></header>
              <output aria-live="polite">{compiledInstruct || "Complete the casting fields to build the non-audible voice instruction."}</output>
              <p>Premiere316 sends the audition text to <code>text</code> and this direction to <code>instruct</code> as separate model inputs.</p>
            </section>

            <details className="voice-design-advanced">
              <summary><span><b>Advanced generation settings</b><small>Defaults favor varied, natural auditions</small></span><em>▾</em></summary>
              <div className="voice-design-advanced-grid">
                <label htmlFor={`${idPrefix}-temperature`}>Temperature
                  <input id={`${idPrefix}-temperature`} type="number" min="0.1" max="2" step="0.05" value={draft.settings.temperature} onChange={(event) => patchSetting("temperature", clamp(event.target.value, 0.1, 2, 0.9))} />
                </label>
                <label htmlFor={`${idPrefix}-top-p`}>Top P
                  <input id={`${idPrefix}-top-p`} type="number" min="0.1" max="1" step="0.01" value={draft.settings.topP} onChange={(event) => patchSetting("topP", clamp(event.target.value, 0.1, 1, 0.95))} />
                </label>
                <label htmlFor={`${idPrefix}-top-k`}>Top K
                  <input id={`${idPrefix}-top-k`} type="number" min="1" max="100" step="1" value={draft.settings.topK} onChange={(event) => patchSetting("topK", Math.trunc(clamp(event.target.value, 1, 100, 50)))} />
                </label>
                <label htmlFor={`${idPrefix}-repetition`}>Repetition penalty
                  <input id={`${idPrefix}-repetition`} type="number" min="1" max="2" step="0.01" value={draft.settings.repetitionPenalty} onChange={(event) => patchSetting("repetitionPenalty", clamp(event.target.value, 1, 2, 1.05))} />
                </label>
                <label className="voice-design-production-copy" htmlFor={`${idPrefix}-production-copy`}>
                  <input id={`${idPrefix}-production-copy`} type="checkbox" checked={draft.settings.create48kCopy} onChange={(event) => patchSetting("create48kCopy", event.target.checked)} />
                  <span><b>Create a separate 48 kHz production copy</b><small>The native lossless WAV remains unchanged.</small></span>
                </label>
              </div>
            </details>

            {loadError ? <div className="voice-design-message warning" role="status">{loadError}</div> : null}
            {formError ? <div className="voice-design-message error" role="alert">{formError}</div> : null}
            {notice ? <div className="voice-design-message success" role="status">{notice}</div> : null}
          </div>
          <footer className="voice-design-generate-bar">
            <div><b>{draft.voiceName || "Untitled designed voice"}</b><small>{engineLoaded ? "Model loaded" : engineInstalled ? "Model loads lazily when generation starts" : "Engine unavailable"} · {draft.auditionCount} audition{draft.auditionCount === 1 ? "" : "s"}</small></div>
            <button type="button" className="button danger" onClick={() => activeJob && void cancelJob(String(activeJob.id || ""))} disabled={!activeJob || pendingActions[`cancel:${String(activeJob?.id || "")}`]}>{pendingActions[`cancel:${String(activeJob?.id || "")}`] ? "Cancelling…" : "Cancel"}</button>
            <button type="submit" className="button primary voice-design-generate" disabled={!canGenerate}>{pendingActions.generate ? "Queueing…" : activeJobs.length ? "Generation active" : `Generate ${draft.auditionCount} audition${draft.auditionCount === 1 ? "" : "s"}`}</button>
          </footer>
        </section>

        <section className="voice-design-panel voice-design-results-panel">
          <header>
            <div><span>3</span><h2>Auditions</h2></div>
            <button type="button" className={`voice-design-compare-toggle ${compareMode ? "active" : ""}`} aria-pressed={compareMode} onClick={() => { setCompareMode((value) => !value); setCompareIds([]); }}>Compare auditions{compareMode && compareIds.length ? ` · ${compareIds.length}/3` : ""}</button>
          </header>
          <div className="voice-design-panel-scroll voice-design-results-scroll">
            {relevantJobs.length ? (
              <section className="voice-design-job-list" aria-label="Voice Design generation queue">
                {relevantJobs.slice(0, 4).map((job) => {
                  const status = String(job?.status || "queued").toLowerCase();
                  const progressValue = Number(job?.progressPercent ?? (Number(job?.progress) <= 1 ? Number(job?.progress) * 100 : job?.progress));
                  return (
                    <article key={String(job?.id || `${job?.label}-${status}`)} className={status}>
                      <i aria-hidden="true" />
                      <div><b>{job?.label || "Qwen voice auditions"}</b><small>{job?.stage || status} · {job?.id}</small>{Number.isFinite(progressValue) ? <progress max="100" value={Math.max(0, Math.min(100, progressValue))} aria-label={`${Math.round(progressValue)} percent complete`} /> : null}</div>
                      {ACTIVE_JOB_STATUSES.has(status) ? <button type="button" className="button ghost" onClick={() => void cancelJob(String(job.id || ""))} disabled={pendingActions[`cancel:${String(job.id || "")}`]}>{pendingActions[`cancel:${String(job.id || "")}`] ? "Cancelling…" : "Cancel"}</button> : <em>{status}</em>}
                    </article>
                  );
                })}
              </section>
            ) : null}

            {compareMode ? (
              <section className="voice-design-compare-tray" aria-label="Audition comparison">
                <header><div><b>Side-by-side comparison</b><small>Select two or three finished auditions below.</small></div><button type="button" className="button ghost" onClick={() => setCompareIds([])} disabled={!compareIds.length}>Clear</button></header>
                {compareAuditions.length ? (
                  <div>
                    {compareAuditions.map((audition) => {
                      const url = nativeMediaUrl(audition) || productionMediaUrl(audition);
                      return <article key={auditionId(audition)}><b>{auditionName(audition)}</b><small>seed {audition?.seed ?? "random"}</small>{url ? <audio controls preload="metadata" src={url} /> : <span>Audio pending</span>}</article>;
                    })}
                  </div>
                ) : <p>Turn on an audition’s comparison checkbox to add it here.</p>}
              </section>
            ) : null}

            <div className="voice-design-audition-list">
              {auditions.length ? auditions.map((audition) => {
                const id = auditionId(audition);
                const selected = selectedAuditionIds.has(id);
                const saved = Boolean(audition?.assetId || audition?.libraryAssetId || audition?.savedToLibrary || audition?.saved);
                const busy = Object.keys(pendingActions).some((key) => key.endsWith(`:${id}`));
                return (
                  <AuditionCard
                    key={id}
                    audition={audition}
                    selected={selected}
                    saved={saved}
                    compareMode={compareMode}
                    comparing={compareIds.includes(id)}
                    compareDisabled={compareIds.length >= 3}
                    busy={busy}
                    onCompare={toggleCompare}
                    onRegenerate={async (auditionIdValue) => Boolean(await auditionAction(auditionIdValue, "regenerate", "POST", {}, "Queued a fresh version of this audition."))}
                    onRename={renameAudition}
                    onDelete={deleteAudition}
                    onSelect={async (auditionIdValue) => Boolean(await auditionAction(auditionIdValue, "select", "POST", {}, "Selected as the character’s canonical voice."))}
                    onSave={async (auditionIdValue) => Boolean(await auditionAction(auditionIdValue, "save-to-library", "POST", {}, "Saved this audition as a reusable Voice Library asset."))}
                    onSend={sendToIndexTts}
                    onOpenFolder={async (auditionIdValue) => Boolean(await auditionAction(auditionIdValue, "open-folder", "POST", {}, "Opened the audition’s containing folder."))}
                  />
                );
              }) : (
                <div className="voice-design-empty">
                  <span aria-hidden="true">◖◗</span>
                  <h3>No designed voices yet</h3>
                  <p>Build a voice direction and generate one to three separate auditions. Native WAV masters will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
