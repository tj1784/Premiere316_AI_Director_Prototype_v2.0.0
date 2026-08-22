import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dialogueCueComplete, dialogueCueProgress, dialogueCuesFromSound, dialogueCueStatus } from "../dialogue-cues";
import { useStore } from "../store";
import { actionsForSlotState, openAssetAction } from "../contextual-agency";
import SoundWorkflowWorkspace, {
  SoundWorkflowKind,
  SoundWorkflowSnapshot,
  soundProfileLabel,
  soundProfileReady
} from "./SoundWorkflowWorkspace";
import VoiceDesignWorkspace, { type VoiceDesignEngineSummary } from "./VoiceDesignWorkspace";
import emotionPresets from "../data/emotion-presets.json";
import "./CreateSoundWorkspace.css";

type SoundTab = "voice-design" | "voice-clone" | "music" | "sound-fx";
type TtsProvider = "qwenTts" | "indexTts";

const TTS_PROVIDERS: Record<TtsProvider, {
  label: string;
  shortLabel: string;
  description: string;
  generationPath: (slug: string) => string;
}> = {
  qwenTts: {
    label: "Qwen3-TTS",
    shortLabel: "QwenTTS",
    description: "Primary standalone voice-cloning model",
    generationPath: (slug) => `/api/projects/${encodeURIComponent(slug)}/sound/qwen-tts/generations`
  },
  indexTts: {
    label: "IndexTTS-2.5",
    shortLabel: "IndexTTS",
    description: "Standalone fallback voice-cloning model",
    generationPath: (slug) => `/api/projects/${encodeURIComponent(slug)}/sound/index-tts/generations`
  }
};

const TTS_LANGUAGES: Record<TtsProvider, Array<{ value: string; label: string }>> = {
  qwenTts: [
    { value: "AUTO", label: "Auto detect" },
    { value: "EN", label: "English" },
    { value: "ZH", label: "Chinese" },
    { value: "JA", label: "Japanese" },
    { value: "KO", label: "Korean" },
    { value: "DE", label: "German" },
    { value: "FR", label: "French" },
    { value: "RU", label: "Russian" },
    { value: "PT", label: "Portuguese" },
    { value: "ES", label: "Spanish" },
    { value: "IT", label: "Italian" }
  ],
  indexTts: [
    { value: "EN", label: "English" },
    { value: "ZH", label: "Chinese" },
    { value: "JA", label: "Japanese" },
    { value: "ES", label: "Spanish" },
    { value: "AR", label: "Arabic" }
  ]
};

const SOUND_TABS: Array<{ id: SoundTab; label: string; description: string }> = [
  { id: "voice-design", label: "Voice Design", description: "Design a new voice identity with Qwen3-TTS" },
  { id: "voice-clone", label: "Voice Clone", description: "Clone a recorded voice with QwenTTS or IndexTTS" },
  { id: "music", label: "Music", description: "Create project score and music cues" },
  { id: "sound-fx", label: "Sound FX", description: "Create effects, foley, and ambience" }
];

const EMPTY_WORKFLOW_SNAPSHOT: SoundWorkflowSnapshot = {
  profiles: [],
  assets: [],
  candidates: [],
  gpu: null,
  management: null
};

type SoundDraft = {
  provider: TtsProvider;
  voiceMode: "saved" | "new";
  voiceId: string;
  speaker: string;
  name: string;
  referenceTranscript: string;
  text: string;
  style: string;
  language: string;
  emotionWeight: number;
  durationFactor: number;
  seed: number;
  emotionPreset: string;
  emotionVector: number[] | null;
};

type SoundSnapshot = {
  sound: any;
  health: any;
};

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "cancelling"]);
const COMPLETE_JOB_STATUSES = new Set(["done", "completed", "succeeded"]);
const DEFAULT_DRAFT: SoundDraft = {
  provider: "qwenTts",
  voiceMode: "new",
  voiceId: "",
  speaker: "Narrator",
  name: "",
  referenceTranscript: "",
  text: "",
  style: "",
  language: "EN",
  emotionWeight: 0.8,
  durationFactor: 1,
  seed: 42,
  emotionPreset: "",
  emotionVector: null
};

const EMOTION_PRESET_NAMES = Object.keys(emotionPresets as Record<string, { type?: string; values?: number[]; description?: string }>).sort();

function applyEmotionPreset(name: string): Pick<SoundDraft, "emotionPreset" | "emotionVector" | "style" | "emotionWeight"> {
  const preset = (emotionPresets as Record<string, { type?: string; values?: number[]; description?: string }>)[name];
  if (!preset) return { emotionPreset: "", emotionVector: null, style: "", emotionWeight: 0.8 };
  if (preset.type === "vector" && Array.isArray(preset.values)) {
    const vector = preset.values.slice(0, 8).map((value) => Math.max(0, Math.min(1.15, Number(value) || 0)));
    while (vector.length < 8) vector.push(0);
    const peak = Math.max(...vector, 0);
    return {
      emotionPreset: name,
      emotionVector: vector,
      style: name.replace(/^vec_/, "").replace(/_/g, " "),
      emotionWeight: Math.max(0.45, Math.min(0.85, 0.45 + peak * 0.35))
    };
  }
  return {
    emotionPreset: name,
    emotionVector: null,
    style: String(preset.description || name),
    emotionWeight: 0.62
  };
}

function draftStorageKey(slug: string) {
  return `premiere316.create-sound.${slug}`;
}

function tabStorageKey(slug: string) {
  return `premiere316.create-sound.active-tab.${slug || "project"}`;
}

function loadActiveTab(slug: string): SoundTab {
  if (typeof window === "undefined") return "voice-design";
  try {
    const saved = window.localStorage.getItem(tabStorageKey(slug));
    return SOUND_TABS.some((tab) => tab.id === saved) ? saved as SoundTab : "voice-design";
  } catch {
    return "voice-design";
  }
}

function loadDraft(slug: string): SoundDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(draftStorageKey(slug)) || "null");
    if (!saved || typeof saved !== "object") return DEFAULT_DRAFT;
    const provider: TtsProvider = saved.provider === "indexTts" ? "indexTts" : "qwenTts";
    const language = TTS_LANGUAGES[provider].some((option) => option.value === String(saved.language || "").toUpperCase())
      ? String(saved.language).toUpperCase()
      : DEFAULT_DRAFT.language;
    return {
      ...DEFAULT_DRAFT,
      ...saved,
      provider,
      language,
      voiceMode: saved.voiceMode === "new" ? "new" : "saved",
      emotionWeight: Number.isFinite(Number(saved.emotionWeight)) ? Number(saved.emotionWeight) : DEFAULT_DRAFT.emotionWeight,
      durationFactor: Number.isFinite(Number(saved.durationFactor)) ? Number(saved.durationFactor) : DEFAULT_DRAFT.durationFactor,
      seed: Number.isFinite(Number(saved.seed)) ? Math.trunc(Number(saved.seed)) : DEFAULT_DRAFT.seed
    };
  } catch {
    return DEFAULT_DRAFT;
  }
}

function collection(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function voiceId(voice: any) {
  return String(voice?.id || voice?.voiceId || voice?.slug || "");
}

function voiceName(voice: any) {
  return String(voice?.name || voice?.speaker || voice?.label || voiceId(voice) || "Saved voice");
}

function voiceProvider(voice: any): TtsProvider {
  const provider = String(voice?.provider || voice?.providerId || voice?.engine || "").toLowerCase();
  if (provider.includes("qwen") || voiceId(voice).startsWith("qwen_voice_")) return "qwenTts";
  return "indexTts";
}

function voiceReferenceTranscript(voice: any) {
  return String(voice?.referenceTranscript || voice?.refText || voice?.transcript || "").trim();
}


function estimateSpeechSeconds(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words * 0.42 * 10) / 10);
}

function openSoundSlot(intent) {
  openAssetAction({
    sourceRoute: "/sound",
    ...intent
  });
}

function isWavReference(file: File | null) {
  if (!file) return false;
  return file.name.trim().toLowerCase().endsWith(".wav");
}

function generationId(generation: any) {
  return String(generation?.id || generation?.generationId || generation?.jobId || generation?.file || generation?.filename || "");
}

function generationJobId(generation: any) {
  return String(generation?.jobId || generation?.job?.id || "");
}

function generationRetryFingerprint(generation: any) {
  return [
    String(generation?.provider || generation?.engine || ""),
    String(generation?.voiceId || ""),
    String(generation?.speaker || "").trim().toUpperCase(),
    String(generation?.text || "").replace(/\s+/g, " ").trim(),
    String(generation?.seed ?? "")
  ].join("\u001f");
}

function normalizeMediaUrl(value: any) {
  const url = String(value || "").trim().replace(/\\/g, "/");
  if (!url) return "";
  if (/^(https?:|blob:|data:)/i.test(url) || url.startsWith("/")) return url;
  return `/${url}`;
}

function audioUrl(item: any, slug: string, reference = false) {
  const direct = normalizeMediaUrl(
    item?.mediaUrl
    || item?.media?.url
    || (reference ? item?.referenceMediaUrl || item?.referenceUrl : item?.audioUrl)
  );
  if (direct) return direct;
  const file = String(
    item?.file
    || item?.filename
    || item?.outputFile
    || item?.media?.file
    || (reference ? item?.referenceFile : "")
    || ""
  ).replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return file ? `/media/${encodeURIComponent(slug)}/audio/${encodeURIComponent(file)}` : "";
}

function formatDate(value: any) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Just now";
}

function formatDuration(value: any) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(1)} sec` : "Duration pending";
}

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const timeout = window.setTimeout(() => finish(new Error("The reference audio could not be inspected.")), 12000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
    const finish = (error?: Error) => {
      const duration = audio.duration;
      cleanup();
      if (error) reject(error);
      else if (!Number.isFinite(duration) || duration <= 0) reject(new Error("The reference audio has no readable duration."));
      else resolve(duration);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error("Use a readable WAV, MP3, FLAC, M4A, or OGG reference."));
    audio.src = url;
  });
}

async function responseJson(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || json.reason || response.statusText || "Request failed");
  return json;
}

export default function CreateSoundWorkspace() {
  const store = useStore();
  const slug = String(store.project?.slug || "");
  const [tabState, setTabState] = useState<{ slug: string; tab: SoundTab }>(() => ({ slug, tab: loadActiveTab(slug) }));
  const [draftState, setDraftState] = useState<{ slug: string; draft: SoundDraft }>(() => ({ slug, draft: loadDraft(slug) }));
  const [snapshot, setSnapshot] = useState<SoundSnapshot>({ sound: null, health: null });
  const [workflowSnapshot, setWorkflowSnapshot] = useState<SoundWorkflowSnapshot>(EMPTY_WORKFLOW_SNAPSHOT);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowLoadError, setWorkflowLoadError] = useState("");
  const [activeWorkflowProfile, setActiveWorkflowProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceDuration, setReferenceDuration] = useState<number | null>(null);
  const [referenceChecking, setReferenceChecking] = useState(false);
  const [lastJob, setLastJob] = useState<any>(null);
  const [voiceDesignCommandStatus, setVoiceDesignCommandStatus] = useState<VoiceDesignEngineSummary>({
    label: "Qwen3-TTS VoiceDesign",
    detail: "Checking the standalone VoiceDesign engine…",
    status: "waiting"
  });
  const requestSequence = useRef(0);
  const workflowRequestSequence = useRef(0);
  const fileSequence = useRef(0);
  const tabRefs = useRef<Partial<Record<SoundTab, HTMLButtonElement | null>>>({});
  const activeTab = tabState.slug === slug ? tabState.tab : loadActiveTab(slug);
  const draft = draftState.slug === slug ? draftState.draft : loadDraft(slug);

  const setDraft = (update: React.SetStateAction<SoundDraft>) => {
    setDraftState((current) => {
      const currentDraft = current.slug === slug ? current.draft : loadDraft(slug);
      const nextDraft = typeof update === "function"
        ? (update as (value: SoundDraft) => SoundDraft)(currentDraft)
        : update;
      return { slug, draft: nextDraft };
    });
  };

  const selectTab = (tab: SoundTab, focus = false) => {
    setActiveWorkflowProfile(null);
    setTabState({ slug, tab });
    if (focus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => tabRefs.current[tab]?.focus());
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: SoundTab) => {
    const currentIndex = SOUND_TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % SOUND_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + SOUND_TABS.length) % SOUND_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SOUND_TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(SOUND_TABS[nextIndex].id, true);
  };

  const patchDraft = <K extends keyof SoundDraft>(key: K, value: SoundDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const selectProvider = (provider: TtsProvider) => {
    const incompatibleReference = provider === "qwenTts" && Boolean(referenceFile) && !isWavReference(referenceFile);
    setFormError(incompatibleReference ? "QwenTTS accepts WAV reference audio only. Choose a WAV file to continue." : "");
    setNotice("");
    if (incompatibleReference) {
      fileSequence.current += 1;
      setReferenceFile(null);
      setReferenceDuration(null);
      setReferenceChecking(false);
    }
    setDraft((current) => ({
      ...current,
      provider,
      language: TTS_LANGUAGES[provider].some((option) => option.value === current.language) ? current.language : "EN",
      voiceId: current.voiceId && voiceProvider(voices.find((voice) => voiceId(voice) === current.voiceId)) === provider
        ? current.voiceId
        : ""
    }));
  };

  useEffect(() => {
    if (draftState.slug === slug) return;
    setDraftState({ slug, draft: loadDraft(slug) });
    setSnapshot({ sound: null, health: null });
    setReferenceFile(null);
    setReferenceDuration(null);
    setReferenceChecking(false);
    setLastJob(null);
    setFormError("");
    setNotice("");
    setLoadError("");
    fileSequence.current += 1;
  }, [draftState.slug, slug]);

  useEffect(() => {
    if (draftState.slug !== slug) return;
    try {
      localStorage.setItem(draftStorageKey(slug), JSON.stringify(draftState.draft));
    } catch {}
  }, [draftState, slug]);

  useEffect(() => {
    if (tabState.slug !== slug) setTabState({ slug, tab: loadActiveTab(slug) });
  }, [slug, tabState.slug]);

  useEffect(() => {
    if (tabState.slug !== slug) return;
    try {
      window.localStorage.setItem(tabStorageKey(slug), tabState.tab);
    } catch {}
  }, [slug, tabState]);

  const refreshSound = useCallback(async (silent = false) => {
    const requestId = ++requestSequence.current;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound`);
      const json = await responseJson(response);
      if (requestId !== requestSequence.current) return;
      let health = json.health || {};
      if (!health?.providers?.qwenTts && !health?.qwenTts) {
        try {
          const qwenResponse = await fetch("/api/sound/qwen-tts/health");
          const qwenJson = await responseJson(qwenResponse);
          health = {
            ...health,
            providers: {
              ...(health.providers || {}),
              qwenTts: qwenJson.health || qwenJson.status || qwenJson
            }
          };
        } catch {}
      }
      if (requestId !== requestSequence.current) return;
      setSnapshot({
        sound: {
          ...(json.sound || {}),
          dialogueCues: json.sound?.dialogueCues || json.dialogueCues || []
        },
        health
      });
      setLoadError("");
    } catch (error: any) {
      if (requestId !== requestSequence.current) return;
      setLoadError(String(error.message || error));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [slug]);

  const refreshWorkflows = useCallback(async (silent = false) => {
    const requestId = ++workflowRequestSequence.current;
    if (!silent) setWorkflowLoading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/workflows`);
      const json = await responseJson(response);
      if (requestId !== workflowRequestSequence.current) return;
      const registry = json.registry && typeof json.registry === "object" ? json.registry : json;
      setWorkflowSnapshot({
        profiles: collection(registry.profiles || json.profiles),
        assets: collection(json.assets || registry.assets || json.sound?.assets),
        candidates: collection(registry.candidates || json.candidates),
        gpu: json.gpu || registry.gpu || null,
        management: json.management || registry.management || json.capabilities?.management || null
      });
      setWorkflowLoadError("");
    } catch (error: any) {
      if (requestId !== workflowRequestSequence.current) return;
      setWorkflowLoadError(String(error.message || error));
    } finally {
      if (requestId === workflowRequestSequence.current) setWorkflowLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refreshSound(false);
    const timer = window.setInterval(() => void refreshSound(true), 3500);
    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
      fileSequence.current += 1;
    };
  }, [refreshSound]);

  useEffect(() => {
    if (activeTab !== "music" && activeTab !== "sound-fx") return;
    void refreshWorkflows(false);
    const timer = window.setInterval(() => void refreshWorkflows(true), 4500);
    return () => {
      window.clearInterval(timer);
      workflowRequestSequence.current += 1;
    };
  }, [activeTab, refreshWorkflows]);

  const sound = snapshot.sound || {};
  const voices = useMemo(() => collection(sound.voices || sound.voiceLibrary), [sound.voices, sound.voiceLibrary]);
  const providerVoices = useMemo(() => voices.filter((voice) => voiceProvider(voice) === draft.provider), [voices, draft.provider]);
  const generations = useMemo(() => {
    const values = collection(sound.generations || sound.outputs);
    const completedAt = new Map<string, string>();
    for (const generation of values) {
      const status = String(generation?.status || generation?.job?.status || "").toLowerCase();
      if (!COMPLETE_JOB_STATUSES.has(status) && !generation?.file && !generation?.mediaUrl) continue;
      const fingerprint = generationRetryFingerprint(generation);
      const createdAt = String(generation?.createdAt || "");
      if (createdAt > String(completedAt.get(fingerprint) || "")) completedAt.set(fingerprint, createdAt);
    }
    return values
      .filter((generation) => {
        const status = String(generation?.status || generation?.job?.status || "").toLowerCase();
        if (COMPLETE_JOB_STATUSES.has(status) || generation?.file || generation?.mediaUrl) return true;
        const completed = completedAt.get(generationRetryFingerprint(generation));
        return !completed || completed <= String(generation?.createdAt || "");
      })
      .sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")));
  }, [sound.generations, sound.outputs]);
  const dialogueCues = useMemo(() => dialogueCuesFromSound(sound), [sound]);
  const completedDialogueCueCount = useMemo(
    () => dialogueCues.filter((cue: any) => dialogueCueComplete(cue)).length,
    [dialogueCues]
  );
  const selectedVoice = providerVoices.find((voice) => voiceId(voice) === draft.voiceId) || null;

  const providerDefinition = TTS_PROVIDERS[draft.provider];
  const healthForProvider = (providerId: TtsProvider) => store.health?.providers?.[providerId]
    || snapshot.health?.providers?.[providerId]
    || snapshot.health?.[providerId]
    || (providerId === "indexTts" ? snapshot.health : null)
    || {};
  const provider = healthForProvider(draft.provider);
  const providerReady = provider?.ready === true;
  const providerInstalled = provider?.installed === true;
  const providerLabel = String(provider?.engine || providerDefinition.label);

  const knownJobIds = new Set([
    String(lastJob?.id || ""),
    ...generations.map(generationJobId)
  ].filter(Boolean));
  const ttsJobs = useMemo(() => {
    const availableJobs = lastJob && !store.jobs.some((job: any) => String(job.id || "") === String(lastJob.id || ""))
      ? [lastJob, ...store.jobs]
      : store.jobs;
    return availableJobs.filter((job: any) => {
    if (job.projectSlug && job.projectSlug !== slug) return false;
    if (knownJobIds.has(String(job.id || ""))) return true;
    return /(?:qwen[\s_-]*tts|index[\s_-]*tts|create[\s_-]*sound|generate[\s_-]*sound)/i.test(`${job.type || ""} ${job.label || ""}`);
    });
  }, [store.jobs, slug, lastJob, generations]);
  const activeJobs = ttsJobs.filter((job: any) => ACTIVE_JOB_STATUSES.has(String(job.status || "").toLowerCase()));

  const referenceDurationValid = referenceDuration !== null && referenceDuration >= 7.97 && referenceDuration <= 15.03;
  const referenceTranscriptReady = draft.provider !== "qwenTts" || Boolean(draft.referenceTranscript.trim());
  const voiceReady = draft.voiceMode === "saved"
    ? Boolean(draft.voiceId)
    : Boolean(referenceFile && referenceDurationValid && draft.name.trim() && referenceTranscriptReady);
  const canGenerate = providerReady && voiceReady && Boolean(draft.speaker.trim()) && Boolean(draft.text.trim()) && !submitting;

  async function selectReference(file: File | null) {
    const checkId = ++fileSequence.current;
    const qwenReference = draft.provider === "qwenTts";
    const qwenFileInvalid = qwenReference && Boolean(file) && !isWavReference(file);
    setReferenceFile(qwenFileInvalid ? null : file);
    setReferenceDuration(null);
    setFormError(qwenFileInvalid ? "QwenTTS accepts WAV reference audio only. Convert or choose a WAV file." : "");
    setDraft((current) => ({ ...current, referenceTranscript: "" }));
    if (!file || qwenFileInvalid) return;
    setReferenceChecking(true);
    try {
      const duration = await readAudioDuration(file);
      if (checkId !== fileSequence.current) return;
      setReferenceDuration(duration);
      if (duration < 7.97 || duration > 15.03) {
        setFormError(`Reference audio must be 8–15 seconds. This file is ${duration.toFixed(1)} seconds.`);
      }
    } catch (error: any) {
      if (checkId === fileSequence.current) {
        setFormError(qwenReference ? "Use a readable WAV reference with clear single-speaker speech." : String(error.message || error));
      }
    } finally {
      if (checkId === fileSequence.current) setReferenceChecking(false);
    }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    if (!providerReady) return setFormError(provider?.reason || `${providerDefinition.label} is not ready.`);
    if (!draft.text.trim()) return setFormError("Enter the dialogue or narration to generate.");
    if (!draft.speaker.trim()) return setFormError("Name the speaker for this take.");
    if (draft.voiceMode === "saved" && !draft.voiceId) return setFormError("Select a saved voice.");
    if (draft.voiceMode === "new" && (!referenceFile || !referenceDurationValid)) return setFormError("Upload an 8–15 second reference recording.");
    if (draft.voiceMode === "new" && draft.provider === "qwenTts" && !isWavReference(referenceFile)) {
      return setFormError("QwenTTS accepts WAV reference audio only.");
    }
    if (draft.voiceMode === "new" && !draft.name.trim()) return setFormError("Name the new cloned voice.");
    if (draft.voiceMode === "new" && draft.provider === "qwenTts" && !draft.referenceTranscript.trim()) {
      return setFormError("Enter the exact words spoken in the QwenTTS reference recording.");
    }

    const body = new FormData();
    if (draft.voiceMode === "saved") body.set("voiceId", draft.voiceId);
    if (draft.voiceMode === "new" && referenceFile) body.set("referenceAudio", referenceFile, referenceFile.name);
    if (draft.provider === "qwenTts" && draft.voiceMode === "new") body.set("referenceTranscript", draft.referenceTranscript.trim());
    body.set("speaker", draft.speaker.trim());
    body.set("name", draft.voiceMode === "new" ? draft.name.trim() : voiceName(selectedVoice));
    body.set("text", draft.text.trim());
    body.set("style", draft.style.trim());
    body.set("language", draft.language || "EN");
    if (draft.provider === "indexTts") {
      body.set("emotionWeight", String(draft.emotionWeight));
      body.set("durationFactor", String(draft.durationFactor));
      if (draft.emotionVector?.length) body.set("emotionVector", JSON.stringify(draft.emotionVector));
    }
    body.set("seed", String(Math.trunc(draft.seed)));

    setSubmitting(true);
    try {
      const response = await fetch(providerDefinition.generationPath(slug), {
        method: "POST",
        body
      });
      const json = await responseJson(response);
      if (json.job) setLastJob(json.job);
      setSnapshot((current) => {
        const nextSound = { ...(current.sound || {}) };
        if (json.voice) {
          const existingVoices = collection(nextSound.voices).filter((voice) => voiceId(voice) !== voiceId(json.voice));
          nextSound.voices = [json.voice, ...existingVoices];
        }
        if (json.generation) {
          const existingGenerations = collection(nextSound.generations).filter((item) => generationId(item) !== generationId(json.generation));
          nextSound.generations = [json.generation, ...existingGenerations];
        }
        return { ...current, sound: nextSound };
      });
      setNotice(`Queued one continuous generation for ${json.generation?.name || draft.speaker.trim()} with ${providerLabel}. No splitting or stitching will be used.`);
      await store.refreshQueue();
      await refreshSound(true);
    } catch (error: any) {
      setFormError(String(error.message || error));
    } finally {
      setSubmitting(false);
    }
  }


  async function generateCueNow(cue) {
    setFormError("");
    setNotice("");
    const qwen = healthForProvider("qwenTts");
    if (qwen?.ready !== true) {
      setFormError(qwen?.reason || "Qwen TTS is not ready. Generate this cue now will not fall back to IndexTTS or Voice Design.");
      return;
    }
    const speaker = String(cue?.speaker || "VO").trim() || "VO";
    const cueId = String(cue?.cueId || "").trim();
    const body = new FormData();
    body.set("text", String(cue?.exactDialogue || "").trim());
    body.set("speaker", speaker);
    body.set("style", String(cue?.performanceDirection || "").trim());
    body.set("name", `${cueId} · ${speaker}`);
    body.set("provider", "qwenTts");
    body.set("cueId", cueId);
    body.set("segmentId", String(cue?.segmentId || "").trim());
    body.set("attachToCue", "1");
    body.set("language", draft.language || "EN");
    body.set("seed", String(Math.trunc(draft.seed)));
    if (draft.provider === "qwenTts" && draft.voiceMode === "saved" && draft.voiceId) {
      body.set("voiceId", draft.voiceId);
    }
    setSubmitting(true);
    try {
      const response = await fetch(TTS_PROVIDERS.qwenTts.generationPath(slug), { method: "POST", body });
      const json = await responseJson(response);
      if (json.job) setLastJob(json.job);
      setSnapshot((current) => {
        const nextSound = { ...(current.sound || {}) };
        if (json.voice) {
          const existingVoices = collection(nextSound.voices).filter((voice) => voiceId(voice) !== voiceId(json.voice));
          nextSound.voices = [json.voice, ...existingVoices];
        }
        if (json.generation) {
          const existingGenerations = collection(nextSound.generations).filter((item) => generationId(item) !== generationId(json.generation));
          nextSound.generations = [json.generation, ...existingGenerations];
        }
        return { ...current, sound: nextSound };
      });
      setNotice(`Queued QwenTTS for ${cueId}. Take will pin to this cue.`);
      await store.refreshQueue();
      await refreshSound(true);
    } catch (error: any) {
      setFormError(String(error.message || error));
    } finally {
      setSubmitting(false);
    }
  }

  function generationStatus(generation: any) {
    const jobId = generationJobId(generation);
    const job = ttsJobs.find((candidate: any) => String(candidate.id || "") === jobId);
    return String(job?.status || generation?.status || (audioUrl(generation, slug) ? "done" : "queued")).toLowerCase();
  }

  async function cancelSoundJob(id: string) {
    const response = await fetch(`/api/queue/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    await responseJson(response);
    await store.refreshQueue();
  }

  function useDesignedVoice(id: string) {
    if (!id) return;
    setDraft((current) => ({ ...current, provider: "indexTts", voiceMode: "saved", voiceId: id }));
    setNotice("Designed voice registered with IndexTTS and selected for cloning.");
    selectTab("voice-clone", true);
    void refreshSound(true);
  }

  const commandProfileReady = activeWorkflowProfile ? soundProfileReady(activeWorkflowProfile) : false;
  const commandSummary = activeTab === "voice-design"
    ? {
      ...voiceDesignCommandStatus,
      refresh: null as null | (() => void)
    }
    : activeTab === "voice-clone"
      ? {
        label: providerLabel,
        detail: providerReady ? "Ready on local GPU" : provider?.reason || (providerInstalled ? "Installed, not ready" : "Not installed"),
        status: providerReady ? "ready" : providerInstalled ? "waiting" : "offline",
        refresh: () => void refreshSound(false)
      }
      : {
        label: activeWorkflowProfile ? soundProfileLabel(activeWorkflowProfile) : `${activeTab === "music" ? "Music" : "Sound FX"} workflow`,
        detail: workflowLoading ? "Checking the local audio workflow registry…" : activeWorkflowProfile ? (commandProfileReady ? "Validated and ready" : activeWorkflowProfile?.reason || activeWorkflowProfile?.readiness?.reason || "Needs validation or rebinding") : workflowLoadError || "No compatible workflow profile is registered.",
        status: workflowLoading ? "waiting" : commandProfileReady ? "ready" : "offline",
        refresh: () => void refreshWorkflows(false)
      };

  return (
    <main className="create-sound-workspace">
      <header className="workspace-command-bar create-sound-command-bar">
        <div>
          <span className="workspace-eyebrow">LOCAL AUDIO PRODUCTION · QWEN PRIMARY</span>
          <h1>Create Sound</h1>
        </div>
        <div className="create-sound-engine-summary" title={commandSummary.detail}>
          <i className={commandSummary.status} />
          <span><b>{commandSummary.label}</b><small>{commandSummary.detail}</small></span>
          {commandSummary.refresh ? <button className="button secondary" onClick={commandSummary.refresh} disabled={activeTab === "voice-clone" ? loading : workflowLoading}>{activeTab === "voice-clone" ? loading ? "Checking…" : "Refresh" : workflowLoading ? "Checking…" : "Refresh"}</button> : null}
        </div>
      </header>

      <nav className="create-sound-subtabs" role="tablist" aria-label="Create Sound workspaces" aria-orientation="horizontal">
        {SOUND_TABS.map((tab) => <button
          key={tab.id}
          ref={(element) => { tabRefs.current[tab.id] = element; }}
          id={`create-sound-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`create-sound-panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className={activeTab === tab.id ? "active" : ""}
          title={tab.description}
          onClick={() => selectTab(tab.id)}
          onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
        ><b>{tab.label}</b><small>{tab.description}</small></button>)}
      </nav>

      <section
        id="create-sound-panel-voice-design"
        className="create-sound-tab-surface"
        role="tabpanel"
        aria-labelledby="create-sound-tab-voice-design"
        hidden={activeTab !== "voice-design"}
      >
        <VoiceDesignWorkspace
          slug={slug}
          project={store.project}
          jobs={store.jobs}
          active={activeTab === "voice-design"}
          onCancelJob={cancelSoundJob}
          onSendToIndexTts={useDesignedVoice}
          onEngineStatusChange={setVoiceDesignCommandStatus}
        />
      </section>

      <section
        id="create-sound-panel-voice-clone"
        className="create-sound-tab-surface"
        role="tabpanel"
        aria-labelledby="create-sound-tab-voice-clone"
        hidden={activeTab !== "voice-clone"}
      >
      <div className="create-sound-grid">
        <section className="create-sound-panel create-sound-voice-panel">
          <header><div><span>1</span><h2>Voice source</h2></div><small>Reference audio stays local</small></header>
          <div className="create-sound-panel-scroll">
            <div className="create-sound-provider-switch" role="group" aria-label="Text-to-speech provider">
              {(["qwenTts", "indexTts"] as TtsProvider[]).map((providerId) => {
                const definition = TTS_PROVIDERS[providerId];
                const health = healthForProvider(providerId);
                const ready = health?.ready === true;
                const installed = health?.installed === true;
                return (
                  <button
                    key={providerId}
                    type="button"
                    className={draft.provider === providerId ? "active" : ""}
                    aria-pressed={draft.provider === providerId}
                    onClick={() => selectProvider(providerId)}
                  >
                    <i className={ready ? "ready" : installed ? "waiting" : "offline"} />
                    <span><b>{definition.shortLabel}</b><small>{definition.description}</small></span>
                  </button>
                );
              })}
            </div>

            <div className="create-sound-mode-switch" aria-label="Voice source mode">
              <button type="button" className={draft.voiceMode === "saved" ? "active" : ""} aria-pressed={draft.voiceMode === "saved"} onClick={() => patchDraft("voiceMode", "saved")}>Saved voice</button>
              <button type="button" className={draft.voiceMode === "new" ? "active" : ""} aria-pressed={draft.voiceMode === "new"} onClick={() => patchDraft("voiceMode", "new")}>New clone</button>
            </div>

            {draft.voiceMode === "saved" ? (
              <div className="create-sound-source-card">
                <label>Saved voice
                  <select value={draft.voiceId} onChange={(event) => patchDraft("voiceId", event.target.value)}>
                    <option value="">Select a voice…</option>
                    {providerVoices.map((voice) => <option key={voiceId(voice)} value={voiceId(voice)}>{voiceName(voice)}</option>)}
                  </select>
                </label>
                {selectedVoice ? (
                  <div className="create-sound-selected-voice">
                    <div><span>VOICE</span><p><b>{voiceName(selectedVoice)}</b><small>{selectedVoice.speaker || selectedVoice.language || "Saved reference"}</small></p></div>
                    {audioUrl(selectedVoice, slug, true) ? <audio controls preload="metadata" src={audioUrl(selectedVoice, slug, true)} /> : <small>Reference preview is not available.</small>}
                  </div>
                ) : providerVoices.length ? <p className="create-sound-hint">Choose an immutable {providerDefinition.shortLabel} reference for this take.</p> : <p className="create-sound-hint warning">No {providerDefinition.shortLabel} voices yet. Create the first clone from an 8–15 second recording.</p>}
              </div>
            ) : (
              <div className="create-sound-source-card">
                <label>Voice name
                  <input value={draft.name} onChange={(event) => patchDraft("name", event.target.value)} placeholder="Father — Low Voice" />
                </label>
                <label
                  className={`create-sound-upload create-sound-drop-target ${referenceDurationValid ? "valid" : formError && referenceFile ? "invalid" : ""}`}
                  data-testid="create-sound-reference-drop"
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const file = event.dataTransfer.files?.[0] || null;
                    if (!file) return;
                    if (draft.provider === "qwenTts" && !isWavReference(file)) {
                      setFormError("QwenTTS accepts WAV reference audio only. Convert or choose a WAV file.");
                      return;
                    }
                    void selectReference(file);
                    openSoundSlot({
                      sourceEntity: { type: "timeline-item", id: draft.speaker || "voice-source", label: draft.name || "Voice source" },
                      requirement: { relationship: "cue.referenceAudio", category: "voice", expectedMediaType: "audio" },
                      initialAction: "upload",
                      slotState: "missing",
                      returnFocusId: "create-sound-reference-drop"
                    });
                  }}
                >
                  <input
                    key={draft.provider}
                    type="file"
                    accept={draft.provider === "qwenTts" ? "audio/wav,audio/x-wav,.wav" : "audio/*,.wav,.mp3,.flac,.m4a,.ogg"}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] || null;
                      if (draft.provider === "qwenTts" && file && !isWavReference(file)) event.currentTarget.value = "";
                      void selectReference(file);
                    }}
                  />
                  <span>↥</span>
                  <b>{referenceFile?.name || "Drop or choose reference audio"}</b>
                  <small>{referenceChecking ? "Inspecting recording…" : referenceDuration !== null ? `${referenceDuration.toFixed(1)} seconds · ${referenceDurationValid ? "ready" : "outside 8–15 sec"}` : draft.provider === "qwenTts" ? "WAV required · exactly 8–15 seconds · drop a WAV here" : "WAV preferred · exactly 8–15 seconds · drop audio here"}</small>
                </label>
                {draft.provider === "qwenTts" ? (
                  <label className="create-sound-reference-transcript">Exact reference transcript
                    <textarea
                      rows={4}
                      value={draft.referenceTranscript}
                      onChange={(event) => patchDraft("referenceTranscript", event.target.value)}
                      placeholder="Type exactly what is spoken in the reference audio…"
                      required
                    />
                    <small>Required by QwenTTS for the closest voice match. Do not put performance directions here.</small>
                  </label>
                ) : null}
                <p className="create-sound-hint">Use clean, single-speaker speech without music, room echo, or overlapping dialogue.</p>
              </div>
            )}

            <label>Speaker / character
              <input value={draft.speaker} onChange={(event) => patchDraft("speaker", event.target.value)} placeholder="FATHER" />
            </label>

            <div className={`create-sound-provider-card ${providerReady ? "ready" : "offline"}`}>
              <span>{providerReady ? "✓" : "!"}</span>
              <p><b>{providerReady ? `${providerDefinition.shortLabel} standalone engine ready` : `${providerLabel} is offline`}</b><small>{providerReady ? "One continuous generation will run locally without ComfyUI." : `${provider?.reason || `Start ${providerDefinition.label} before generating.`} Upload, assign existing, edit, and review stay available. Qwen remains the default.`}</small></p>
            </div>
            {!providerReady ? (
              <div className="create-sound-offline-recovery" role="status" data-testid="create-sound-offline-recovery">
                <p><b>Generate is paused</b><small>The unavailable component is {providerLabel}. IndexTTS is not substituted.</small></p>
                <div>
                  <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: draft.speaker || "voice", label: draft.speaker || "Voice" }, requirement: { relationship: "cue.dialogueAudio", category: "voice", expectedMediaType: "audio" }, initialAction: "upload", slotState: "missing" })}>Upload</button>
                  <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: draft.speaker || "voice", label: draft.speaker || "Voice" }, requirement: { relationship: "cue.dialogueAudio", category: "voice", expectedMediaType: "audio" }, initialAction: "choose", slotState: "missing" })}>Assign existing</button>
                  <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: draft.speaker || "voice", label: draft.speaker || "Voice" }, requirement: { relationship: "cue.dialogueAudio", category: "voice", expectedMediaType: "audio" }, initialAction: "edit" })}>Edit</button>
                  <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: draft.speaker || "voice", label: draft.speaker || "Voice" }, requirement: { relationship: "cue.dialogueAudio", category: "voice", expectedMediaType: "audio" }, initialAction: "review" })}>Review</button>
                  <button type="button" className="button secondary" onClick={() => void store.refreshHealth?.()}>Reconnect {providerDefinition.shortLabel}</button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="create-sound-panel create-sound-performance-panel">
          <header><div><span>2</span><h2>Dialogue & performance</h2></div><small>One generation · no splitting</small></header>
          <form className="create-sound-form" onSubmit={generate}>
            <div className="create-sound-form-scroll">
              <label className="create-sound-dialogue-label">Dialogue or narration
                <textarea rows={12} value={draft.text} onChange={(event) => patchDraft("text", event.target.value)} placeholder="Enter the exact words to speak…" />
                <small>{draft.text.trim().length.toLocaleString()} characters · ~{estimateSpeechSeconds(draft.text)}s spoken (estimate, not guaranteed)</small>
              </label>
              <label>Emotion preset
                <select value={draft.emotionPreset} onChange={(event) => setDraft((current) => ({ ...current, ...applyEmotionPreset(event.target.value) }))}>
                  <option value="">None</option>
                  {EMOTION_PRESET_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <small>{draft.emotionPreset ? `${(emotionPresets as Record<string, { type?: string }>)[draft.emotionPreset]?.type || "preset"} · 609-pack` : "Optional IndexTTS vector / Qwen performance note"}</small>
              </label>
              <label>{draft.provider === "qwenTts" ? "Editorial performance note" : "Performance direction"}
                <textarea
                  rows={5}
                  value={draft.style}
                  onChange={(event) => patchDraft("style", event.target.value)}
                  placeholder={draft.provider === "qwenTts" ? "Optional production note saved with the take…" : "Observant, quiet, calm; mature adult male voice; slow and measured."}
                />
                {draft.provider === "qwenTts" ? <small className="create-sound-field-note">Editorial metadata only. QwenTTS follows the reference WAV’s voice and prosody; this note does not steer synthesis.</small> : null}
              </label>
              <div className="create-sound-control-grid">
                <label>Language
                  <select value={draft.language} onChange={(event) => patchDraft("language", event.target.value)}>
                    {TTS_LANGUAGES[draft.provider].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>Seed
                  <input type="number" step="1" value={draft.seed} onChange={(event) => patchDraft("seed", Math.trunc(Number(event.target.value) || 0))} />
                </label>
                {draft.provider === "indexTts" ? <>
                  <label className="create-sound-range">Emotion weight · {draft.emotionWeight.toFixed(2)}
                    <input type="range" min="0" max="1" step="0.05" value={draft.emotionWeight} onChange={(event) => patchDraft("emotionWeight", Number(event.target.value))} />
                    <small>Subtle</small><small>Expressive</small>
                  </label>
                  <label className="create-sound-range">Speed / duration · {draft.durationFactor.toFixed(2)}×
                    <input type="range" min="0.5" max="2" step="0.05" value={draft.durationFactor} onChange={(event) => patchDraft("durationFactor", Number(event.target.value))} />
                    <small>Faster</small><small>Slower</small>
                  </label>
                </> : <div className="create-sound-qwen-prosody-note" role="note"><b>Reference prosody</b><small>QwenTTS clones timing and expression from the WAV. Emotion-weight and speed controls are available only with IndexTTS.</small></div>}
              </div>
              {loadError ? <div className="create-sound-message warning" role="status">Sound library: {loadError}</div> : null}
              {formError ? <div className="create-sound-message error" role="alert">{formError}</div> : null}
              {notice ? <div className="create-sound-message success" role="status">{notice}</div> : null}
            </div>
            <footer>
              <div><b>{draft.voiceMode === "saved" ? voiceName(selectedVoice) : draft.name || "New clone"}</b><small>{draft.language} · seed {draft.seed} · {draft.provider === "qwenTts" ? "reference prosody" : `${draft.durationFactor.toFixed(2)}× duration`} · ~{estimateSpeechSeconds(draft.text)}s estimate</small></div>
              <button className="button primary create-sound-generate" type="submit" disabled={!canGenerate}>{submitting ? "Queueing…" : activeJobs.length ? "Queue another full take" : "Generate one take"}</button>
            </footer>
          </form>
        </section>

        <section className="create-sound-panel create-sound-output-panel">
          <header><div><span>3</span><h2>Takes & queue</h2></div><small>{dialogueCues.length ? `${completedDialogueCueCount}/${dialogueCues.length} cues ready` : activeJobs.length ? `${activeJobs.length} active` : `${generations.length} saved`}</small></header>
          <div className="create-sound-panel-scroll">
            {dialogueCues.length ? <section className="create-sound-dialogue-cue-queue" data-testid="create-sound-dialogue-cue-queue" aria-label="H02 authoritative dialogue cue queue">
              <header>
                <div><span>H02</span><p><b>Authoritative dialogue cue queue</b><small>{dialogueCues.length} exact speech-conditioned passes · QwenTTS</small></p></div>
                <strong>{completedDialogueCueCount}/{dialogueCues.length}</strong>
              </header>
              <div className="create-sound-dialogue-cue-list">
                {dialogueCues.map((cue: any) => {
                  const status = dialogueCueStatus(cue);
                  const progress = dialogueCueProgress(cue);
                  const target = Number(cue.targetVoiceDurationSec) > 0 ? `${Number(cue.targetVoiceDurationSec).toFixed(1)}s voice` : "timing planned";
                  return <article key={cue.cueId} className={`create-sound-dialogue-cue ${status}`} data-testid={`create-sound-dialogue-cue-${cue.cueId}`}>
                    <header><b>{cue.cueId}</b><code>{cue.segmentId}</code><span>{cue.speaker}</span><em>{status}</em>
                      <button type="button" id={`cue-${cue.cueId}`} className="button secondary" data-testid="snd-002-generate-cue" disabled={submitting} onClick={() => void generateCueNow(cue)}>Generate this cue now</button>
                      <button type="button" id={`cue-link-${cue.cueId}`} className="button secondary" data-testid={`create-sound-cue-link-${cue.cueId}`} onClick={() => openSoundSlot({
                        sourceEntity: { type: "timeline-item", id: String(cue.segmentId || cue.cueId), label: `${cue.cueId} · ${cue.speaker}` },
                        requirement: { relationship: "cue.dialogueAudio", category: "dialogue", expectedMediaType: "audio" },
                        initialAction: status === "complete" ? "review" : "generate",
                        slotState: status === "complete" ? "unapproved" : "missing",
                        returnFocusId: `cue-link-${cue.cueId}`
                      })}>Open cue</button>
                    </header>
                    <blockquote>{cue.exactDialogue}</blockquote>
                    <p>{cue.performanceDirection || "Use the authoritative cue-specific performance direction."}</p>
                    <div className="create-sound-dialogue-cue-progress" aria-label={`${cue.cueId} ${Math.round(progress * 100)} percent complete`}><i style={{ width: `${Math.round(progress * 100)}%` }} /><small>{target} · {Math.round(progress * 100)}%</small></div>
                  </article>;
                })}
              </div>
            </section> : null}
            {ttsJobs.length ? (
              <div className="create-sound-queue-list">
                {ttsJobs.slice(0, 4).map((job: any) => {
                  const status = String(job.status || "queued").toLowerCase();
                  return <article key={job.id} className={`create-sound-queue-item ${status}`}><i /><p><b>{job.label || `${providerDefinition.shortLabel} voice generation`}</b><small>{job.stage || status} · {job.id}</small></p><span>{status}</span></article>;
                })}
              </div>
            ) : null}

            <div className="create-sound-take-list">
              {generations.length ? generations.map((generation) => {
                const status = generationStatus(generation);
                const mediaUrl = audioUrl(generation, slug);
                const finished = COMPLETE_JOB_STATUSES.has(status) || status === "done" || Boolean(mediaUrl);
                return (
                  <article key={generationId(generation)} className="create-sound-take">
                    <header><span>{String(generation?.speaker || generation?.name || "VO").slice(0, 2).toUpperCase()}</span><p><b>{generation?.name || generation?.speaker || "Voice take"}</b><small>{formatDate(generation?.createdAt)} · {formatDuration(generation?.durationSec || generation?.duration)}</small></p><em className={status}>{finished ? "ready" : status}</em></header>
                    {generation?.text ? <blockquote>{generation.text}</blockquote> : null}
                    {mediaUrl ? <audio controls preload="metadata" src={mediaUrl} /> : <div className="create-sound-rendering"><i /><span>{status === "error" ? generation?.error || "Generation failed" : "Waiting for rendered audio…"}</span></div>}
                    {finished ? (
                      <nav className="snd-take-actions" aria-label={`${generation?.name || "Voice take"} next actions`} data-testid="snd-take-actions">
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "character", id: String(generation?.characterId || generation?.speaker || generationId(generation)), label: String(generation?.speaker || generation?.name || "Character") }, requirement: { relationship: "character.voice", category: "voice", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", slotState: "unapproved", returnFocusId: `snd-take-${generationId(generation)}-character` })}>Add to Character Bible</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "segment", id: String(generation?.segmentId || generationId(generation)), label: String(generation?.name || "Storyboard segment") }, requirement: { relationship: "segment.dialogueAudio", category: "dialogue", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", returnFocusId: `snd-take-${generationId(generation)}-storyboard` })}>Attach to Storyboard segment</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "segment", id: String(generation?.segmentId || generationId(generation)), label: String(generation?.name || "LTX cue") }, requirement: { relationship: "segment.dialogueAudio", category: "dialogue", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", returnFocusId: `snd-take-${generationId(generation)}-ltx` })}>Attach to LTX dialogue cue</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: "A1", label: "A1 at playhead" }, requirement: { relationship: "sequence.audioAtPlayhead", category: "dialogue", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", returnFocusId: `snd-take-${generationId(generation)}-a1` })}>Place on A1</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: "M1", label: "M1 at playhead" }, requirement: { relationship: "sequence.audioAtPlayhead", category: "music", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", returnFocusId: `snd-take-${generationId(generation)}-m1` })}>Place on M1</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "character", id: String(generation?.characterId || generation?.speaker || generationId(generation)), label: String(generation?.speaker || generation?.name || "Character") }, requirement: { relationship: "character.voice", category: "voice", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "attach", slotState: "unapproved", returnFocusId: `snd-take-${generationId(generation)}-register` })}>Register in Character Bible</button>
                        <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: String(generation?.assetId || generationId(generation)), label: String(generation?.name || "Voice take") }, requirement: { relationship: "library.asset", category: "voice", expectedMediaType: "audio", assetId: generation?.assetId }, initialAction: "review", slotState: "unapproved", returnFocusId: `snd-take-${generationId(generation)}-review` })}>Review and approve</button>
                      </nav>
                    ) : null}
                  </article>
                );
              }) : <div className="create-sound-empty" data-testid="nav-006-empty"><span aria-hidden="true">o</span><h3>No takes yet</h3><p>Generated WAV files will appear here and remain available to Premiere316.</p><nav className="nav-006-empty-actions" aria-label="Empty sound slot">{actionsForSlotState("missing").map((action) => <button key={action} type="button" className="button secondary" data-testid={`nav-006-${action}`} onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: "sound-empty", label: "Create Sound" }, requirement: { relationship: "cue.dialogueAudio", category: "dialogue", expectedMediaType: "audio" }, initialAction: action, slotState: "missing", returnFocusId: `nav-006-${action}` })}>{action[0].toUpperCase() + action.slice(1)}</button>)}</nav></div>}
            </div>
          </div>
        </section>
      </div>
      </section>

      {(["music", "sound-fx"] as SoundWorkflowKind[]).map((kind) => <section
        key={kind}
        id={`create-sound-panel-${kind}`}
        className="create-sound-tab-surface"
        role="tabpanel"
        aria-labelledby={`create-sound-tab-${kind}`}
        hidden={activeTab !== kind}
      >
        <div className="snd-workflow-placement" data-testid={`snd-${kind}-placement`}>
          <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: "A1", label: "A1 at playhead" }, requirement: { relationship: "sequence.audioAtPlayhead", category: kind === "music" ? "music" : "sound", expectedMediaType: "audio" }, initialAction: "attach" })}>Add to A1 at playhead</button>
          <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "timeline-item", id: "M1", label: "M1 at playhead" }, requirement: { relationship: "sequence.audioAtPlayhead", category: "music", expectedMediaType: "audio" }, initialAction: "attach" })}>Add to M1 at playhead</button>
          <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "clip", id: "active-clip", label: "Active clip" }, requirement: { relationship: "clip.audio", category: kind === "music" ? "music" : "sound", expectedMediaType: "audio" }, initialAction: "attach" })}>Attach to active clip</button>
          <button type="button" className="button secondary" onClick={() => openSoundSlot({ sourceEntity: { type: "master", id: "master", label: "Master" }, requirement: { relationship: "master.score", category: kind === "music" ? "music" : "sound", expectedMediaType: "audio" }, initialAction: "attach" })}>Send to Master</button>
        </div>
        <SoundWorkflowWorkspace
          kind={kind}
          slug={slug}
          snapshot={workflowSnapshot}
          loading={workflowLoading}
          loadError={workflowLoadError}
          active={activeTab === kind}
          onRefresh={() => refreshWorkflows(false)}
          onProfileChange={setActiveWorkflowProfile}
        />
      </section>)}
    </main>
  );
}
