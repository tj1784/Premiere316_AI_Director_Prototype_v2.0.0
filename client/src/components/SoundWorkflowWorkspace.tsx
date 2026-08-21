import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

export type SoundWorkflowKind = "voice-design" | "music" | "sound-fx";

export type SoundWorkflowSnapshot = {
  profiles: any[];
  assets: any[];
  candidates: any[];
  gpu: any;
  management?: any;
};

type WorkflowDraft = {
  profileId: string;
  name: string;
  prompt: string;
  exactText: string;
  negativePrompt: string;
  lyrics: string;
  language: string;
  genre: string;
  subgenre: string;
  mood: string;
  emotionalArc: string;
  instrumentation: string;
  vocalDescription: string;
  bpm: number;
  meter: string;
  tonalCenter: string;
  durationSec: number;
  introOutro: string;
  loopable: boolean;
  seamlessEnding: boolean;
  seed: number;
  variationCount: number;
  sourceMode: string;
  soundCategory: string;
  sourceObject: string;
  physicalAction: string;
  material: string;
  environment: string;
  perspective: string;
  distance: string;
  intensity: string;
  tailBehavior: string;
  fadeInSec: number;
  fadeOutSec: number;
  inPointSec: number;
  outPointSec: number;
  advanced: Record<string, any>;
};

type PromptProposal = {
  original: string;
  developed: string;
  choice: "original" | "developed";
};

type SoundWorkflowWorkspaceProps = {
  kind: SoundWorkflowKind;
  slug: string;
  snapshot: SoundWorkflowSnapshot;
  loading: boolean;
  loadError: string;
  active: boolean;
  onRefresh: () => void | Promise<void>;
  onProfileChange?: (profile: any | null) => void;
};

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "generating"]);
const COMPLETE_STATUSES = new Set(["done", "completed", "succeeded", "ready", "generated"]);
const SOUND_CATEGORIES = ["Impact", "Foley", "Creature", "Environment", "Ambience", "Weather", "Mechanical", "Supernatural", "Transition", "Loop", "Other"];
const SOURCE_MODES = [
  ["text-sfx", "Text to sound effect"],
  ["text-ambience", "Text to ambience"],
  ["text-foley", "Text to foley"]
];

const TAB_COPY: Record<SoundWorkflowKind, { title: string; eyebrow: string; source: string; direction: string; output: string; empty: string }> = {
  "voice-design": {
    title: "Voice Design",
    eyebrow: "GENERATIVE VOICE IDENTITY",
    source: "Engine & voice library",
    direction: "Identity & audition",
    output: "Voices & queue",
    empty: "Generated voice auditions will appear here."
  },
  music: {
    title: "Music",
    eyebrow: "PROJECT SCORE & MUSIC CUES",
    source: "Engine & source",
    direction: "Composition & direction",
    output: "Cues & queue",
    empty: "Generated music cues will appear here."
  },
  "sound-fx": {
    title: "Sound FX",
    eyebrow: "FOLEY, AMBIENCE & EFFECTS",
    source: "Engine & source",
    direction: "Sound design & timing",
    output: "Takes & queue",
    empty: "Generated sound-effect takes will appear here."
  }
};

function storageKey(slug: string, kind: SoundWorkflowKind) {
  return `premiere316.create-sound.${kind}.${slug}`;
}

function defaultDraft(kind: SoundWorkflowKind): WorkflowDraft {
  return {
    profileId: "",
    name: kind === "voice-design" ? "New Voice" : kind === "music" ? "New Music Cue" : "New Sound Effect",
    prompt: "",
    exactText: "",
    negativePrompt: "",
    lyrics: "",
    language: "English",
    genre: "Cinematic",
    subgenre: "",
    mood: "",
    emotionalArc: "",
    instrumentation: "",
    vocalDescription: "",
    bpm: 96,
    meter: "4/4",
    tonalCenter: "",
    durationSec: kind === "music" ? 30 : kind === "sound-fx" ? 8 : 8,
    introOutro: "",
    loopable: false,
    seamlessEnding: false,
    seed: 42,
    variationCount: 1,
    sourceMode: kind === "sound-fx" ? "text-sfx" : "text",
    soundCategory: "Impact",
    sourceObject: "",
    physicalAction: "",
    material: "",
    environment: "",
    perspective: "",
    distance: "",
    intensity: "",
    tailBehavior: "",
    fadeInSec: 0,
    fadeOutSec: 0,
    inPointSec: 0,
    outPointSec: 0,
    advanced: {}
  };
}

function loadDraft(slug: string, kind: SoundWorkflowKind): WorkflowDraft {
  const fallback = defaultDraft(kind);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(slug, kind)) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    return { ...fallback, ...saved, advanced: saved.advanced && typeof saved.advanced === "object" ? saved.advanced : {} };
  } catch {
    return fallback;
  }
}

function values(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function token(value: any) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addCapabilityTokens(target: Set<string>, value: any, key = "") {
  if (key) target.add(token(key));
  if (typeof value === "string" || typeof value === "number") target.add(token(value));
  else if (Array.isArray(value)) value.forEach((item) => addCapabilityTokens(target, item));
  else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue === true || childValue || childValue === 0) addCapabilityTokens(target, childValue, childKey);
    }
  }
}

function capabilityTokens(profile: any) {
  const result = new Set<string>();
  addCapabilityTokens(result, profile?.capabilities || {});
  addCapabilityTokens(result, profile?.supportedConditioningInputs || profile?.conditioningInputs || []);
  addCapabilityTokens(result, profile?.inputBindings || profile?.inputNodeBindings || profile?.bindings?.inputs || profile?.bindings || {});
  for (const key of ["lyricsSupport", "referenceAudioSupport", "referenceVideoSupport", "seedSupport", "negativePromptSupport", "promptEnhancementSupport"]) {
    if (profile?.[key] === true) result.add(token(key.replace(/Support$/, "")));
  }
  return result;
}

function supports(profile: any, ...aliases: string[]) {
  if (!profile) return false;
  const available = capabilityTokens(profile);
  return aliases.some((alias) => {
    const wanted = token(alias);
    return [...available].some((entry) => entry === wanted || entry.endsWith(wanted) || wanted.endsWith(entry));
  });
}

function inputBindings(profile: any) {
  const explicit = profile?.inputBindings || profile?.inputNodeBindings || profile?.bindings?.inputs;
  const source = explicit || profile?.bindings || {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([key, binding]: [string, any]) => !token(key).startsWith("output") && token(binding?.role) !== "output"));
}

function outputBindings(profile: any) {
  const explicit = profile?.outputBindings || profile?.outputNodeBindings || profile?.outputs || profile?.bindings?.outputs;
  if (Array.isArray(explicit)) return explicit;
  if (explicit && typeof explicit === "object") return Object.values(explicit);
  const validated = profile?.bindings;
  if (!validated || typeof validated !== "object" || Array.isArray(validated)) return [];
  return Object.entries(validated).filter(([key, binding]: [string, any]) => token(key).startsWith("output") || token(binding?.role) === "output").map(([, binding]) => binding);
}

function hasBoundInput(profile: any, ...aliases: string[]) {
  const keys = Object.keys(inputBindings(profile)).map(token);
  return aliases.some((alias) => {
    const wanted = token(alias);
    return keys.some((key) => key === wanted || key.endsWith(wanted) || wanted.endsWith(key));
  });
}

function profileId(profile: any) {
  return String(profile?.profileId || profile?.id || profile?.workflowProfileId || "");
}

export function soundProfileLabel(profile: any) {
  return String(profile?.displayName || profile?.label || profile?.name || profileId(profile) || "Audio workflow");
}

function profileFamily(profile: any) {
  return String(profile?.engine || profile?.engineFamily || profile?.modelFamily || profile?.model || "Local ComfyUI audio");
}

function profileTokens(profile: any) {
  const source = [
    profile?.category,
    ...(Array.isArray(profile?.categories) ? profile.categories : []),
    ...(Array.isArray(profile?.outputKinds) ? profile.outputKinds : []),
    profile?.purpose,
    profileId(profile),
    soundProfileLabel(profile)
  ];
  return new Set(source.map(token).filter(Boolean));
}

function profileMatchesKind(profile: any, kind: SoundWorkflowKind) {
  const tokens = profileTokens(profile);
  const has = (...needles: string[]) => [...tokens].some((entry) => needles.some((needle) => entry === token(needle) || entry.includes(token(needle))));
  if (kind === "voice-design") return has("voice", "tts", "speech") && !has("indextts");
  if (kind === "music") return has("music", "score", "ost") || (has("hybrid") && supports(profile, "music"));
  return has("soundeffect", "sfx", "foley", "ambience") || (has("hybrid") && supports(profile, "soundeffect", "foley", "ambience"));
}

export function soundProfileReady(profile: any) {
  const status = token(profile?.readiness?.status || profile?.status);
  const bindingStatus = token(profile?.bindingStatus || profile?.readiness?.bindingStatus);
  const errors = values(profile?.validationErrors || profile?.readiness?.validationErrors || profile?.readiness?.errors);
  if (profile?.enabled === false || profile?.readiness?.enabled === false || profile?.ready === false || profile?.readiness?.ready === false) return false;
  if (["needsrebinding", "invalid", "missing", "disabled", "blocked", "error"].includes(status)) return false;
  if (["needsrebinding", "invalid", "missing"].includes(bindingStatus)) return false;
  if (errors.length) return false;
  return profile?.ready === true || profile?.readiness?.ready === true || ["ready", "valid", "available"].includes(status);
}

function profileReason(profile: any) {
  const errors = values(profile?.validationErrors || profile?.readiness?.validationErrors || profile?.readiness?.errors).map((item) => typeof item === "string" ? item : item?.message || JSON.stringify(item));
  return String(errors[0] || profile?.reason || profile?.readiness?.reason || profile?.runtimeWarning || (soundProfileReady(profile) ? "Validated and ready" : "Profile has not passed readiness validation"));
}

function durationRange(profile: any) {
  const source = profile?.supportedDurationRange || profile?.durationRange || profile?.duration || profile?.capabilities?.duration || {};
  const min = Number(source?.minSec ?? source?.minimumSec ?? source?.min ?? profile?.minDurationSec);
  const max = Number(source?.maxSec ?? source?.maximumSec ?? source?.max ?? profile?.maxDurationSec);
  return {
    min: Number.isFinite(min) && min > 0 ? min : null,
    max: Number.isFinite(max) && max > 0 ? max : null
  };
}

function outputFormats(profile: any) {
  return values(profile?.outputFormats || profile?.capabilities?.outputFormats || profile?.capabilities?.formats || profile?.outputs)
    .map((item) => typeof item === "string" ? item : String(item?.format || item?.type || item?.mimeType || ""))
    .filter(Boolean);
}

function requirementRows(profile: any, kind: "model" | "node") {
  const source = kind === "model"
    ? profile?.requiredModelFiles || profile?.requiredModels || profile?.requirements?.models || profile?.readiness?.models
    : profile?.requiredCustomNodes || profile?.requiredNodes || profile?.requirements?.nodes || profile?.readiness?.nodes;
  return values(source).map((item) => {
    if (typeof item === "string") return { label: item, ready: true, reason: "" };
    return {
      label: String(item?.label || item?.name || item?.file || item?.path || item?.classType || item?.id || "Requirement"),
      ready: item?.ready !== false && item?.resolved !== false && item?.present !== false && item?.installed !== false && item?.valid !== false,
      reason: String(item?.reason || item?.error || "")
    };
  });
}

function advancedControls(profile: any) {
  const source = profile?.ui?.advancedControls || profile?.advancedControls || profile?.controls || profile?.parameters;
  if (!Array.isArray(source)) return [];
  return source.filter((control) => control && typeof control === "object" && (control.key || control.id || control.name));
}

function assetId(asset: any) {
  return String(asset?.assetId || asset?.id || asset?.generationId || asset?.file || "");
}

function assetProfileId(asset: any) {
  return String(asset?.profileId || asset?.workflowProfileId || asset?.workflow?.profileId || "");
}

function assetMatchesKind(asset: any, kind: SoundWorkflowKind) {
  const categories = [asset?.category, asset?.kind, asset?.assetCategory, asset?.type].map(token);
  if (kind === "voice-design") return categories.some((item) => item.includes("voice") || item.includes("tts"));
  if (kind === "music") return categories.some((item) => item.includes("music") || item.includes("score") || item.includes("ost"));
  return categories.some((item) => item.includes("soundeffect") || item.includes("sfx") || item.includes("foley") || item.includes("ambience"));
}

function mediaUrl(asset: any, slug: string) {
  const direct = String(asset?.mediaUrl || asset?.url || asset?.output?.mediaUrl || asset?.media?.url || "").trim().replace(/\\/g, "/");
  if (direct) return /^(https?:|blob:|data:|\/)/i.test(direct) ? direct : `/${direct}`;
  const file = String(asset?.file || asset?.filename || asset?.nativeFile || asset?.outputFile || "").replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return file ? `/media/${encodeURIComponent(slug)}/audio/${encodeURIComponent(file)}` : "";
}

function assetStatus(asset: any) {
  return String(asset?.status || (mediaUrl(asset, "") ? "ready" : "queued")).toLowerCase();
}

function dateLabel(value: any) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "Just now";
}

function durationLabel(value: any) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(1)} sec` : "Duration pending";
}

async function jsonResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || json.reason || response.statusText || "Request failed");
  return json;
}

function compiledLine(label: string, value: any) {
  const text = String(value ?? "").trim();
  return text ? `${label}: ${text}` : "";
}

function compileCreativePrompt(kind: SoundWorkflowKind, draft: WorkflowDraft, proposal: PromptProposal | null) {
  const sourcePrompt = proposal?.choice === "developed" ? proposal.developed : draft.prompt;
  const lines = [sourcePrompt.trim()];
  if (kind === "voice-design") {
    lines.push(compiledLine("Voice identity", draft.name));
    lines.push(compiledLine("Language", draft.language));
  } else if (kind === "music") {
    lines.push(compiledLine("Genre", [draft.genre, draft.subgenre].filter(Boolean).join(" / ")));
    lines.push(compiledLine("Mood", draft.mood));
    lines.push(compiledLine("Emotional arc", draft.emotionalArc));
    lines.push(compiledLine("Instrumentation", draft.instrumentation));
    lines.push(compiledLine("Vocal description", draft.vocalDescription));
    lines.push(compiledLine("Tempo", draft.bpm ? `${draft.bpm} BPM` : ""));
    lines.push(compiledLine("Meter", draft.meter));
    lines.push(compiledLine("Tonal center", draft.tonalCenter));
    lines.push(compiledLine("Intro / outro behavior", draft.introOutro));
    if (draft.loopable) lines.push("Structure: loopable");
    if (draft.seamlessEnding) lines.push("Ending: seamless");
  } else {
    lines.push(compiledLine("Category", draft.soundCategory));
    lines.push(compiledLine("Source or object", draft.sourceObject));
    lines.push(compiledLine("Physical action", draft.physicalAction));
    lines.push(compiledLine("Material", draft.material));
    lines.push(compiledLine("Environment / acoustic space", draft.environment));
    lines.push(compiledLine("Listener / camera perspective", draft.perspective));
    lines.push(compiledLine("Distance", draft.distance));
    lines.push(compiledLine("Intensity", draft.intensity));
    lines.push(compiledLine("Tail / reverb behavior", draft.tailBehavior));
    lines.push(`Playback intent: ${draft.loopable ? "loop" : "one-shot"}${draft.seamlessEnding ? ", seamless boundary" : ""}`);
  }
  return lines.filter(Boolean).join("\n").trim();
}

function assetAllowedActions(asset: any, profile: any) {
  const source = asset?.allowedActions || asset?.actions || profile?.assetActions || profile?.capabilities?.assetActions;
  if (Array.isArray(source)) return new Set(source.map(token));
  if (source && typeof source === "object") {
    return new Set(Object.entries(source).filter(([, enabled]) => enabled !== false && enabled != null).map(([action]) => token(action)));
  }
  return new Set<string>();
}

function actionSupported(allowed: Set<string>, action: string) {
  const wanted = token(action);
  return [...allowed].some((entry) => entry === wanted || entry.endsWith(wanted) || wanted.endsWith(entry));
}

function AudioWaveform({ src, enabled }: { src: string; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!src || !enabled || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const abort = new AbortController();
    let context: AudioContext | null = null;
    let resize: ResizeObserver | null = null;
    let samples: Float32Array | null = null;

    const draw = () => {
      if (!samples || !canvas.isConnected) return;
      const box = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(box.width * ratio));
      canvas.height = Math.max(1, Math.floor(box.height * ratio));
      const graphics = canvas.getContext("2d");
      if (!graphics) return;
      graphics.setTransform(ratio, 0, 0, ratio, 0, 0);
      graphics.clearRect(0, 0, box.width, box.height);
      graphics.fillStyle = "#080d14";
      graphics.fillRect(0, 0, box.width, box.height);
      graphics.strokeStyle = "#8f68ff";
      graphics.lineWidth = 1;
      graphics.beginPath();
      const middle = box.height / 2;
      const bucket = Math.max(1, Math.floor(samples.length / Math.max(1, box.width)));
      for (let x = 0; x < box.width; x += 1) {
        const start = x * bucket;
        let peak = 0;
        for (let index = start; index < Math.min(samples.length, start + bucket); index += 1) peak = Math.max(peak, Math.abs(samples[index]));
        const height = Math.max(1, peak * (middle - 3));
        graphics.moveTo(x + 0.5, middle - height);
        graphics.lineTo(x + 0.5, middle + height);
      }
      graphics.stroke();
      graphics.strokeStyle = "rgba(150,164,184,.2)";
      graphics.beginPath();
      graphics.moveTo(0, middle + 0.5);
      graphics.lineTo(box.width, middle + 0.5);
      graphics.stroke();
    };

    void (async () => {
      try {
        setError("");
        const response = await fetch(src, { signal: abort.signal });
        if (!response.ok) throw new Error(`Waveform fetch failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        samples = decoded.getChannelData(0);
        draw();
        resize = new ResizeObserver(draw);
        resize.observe(canvas);
      } catch (reason: any) {
        if (!abort.signal.aborted) setError(String(reason?.message || reason));
      }
    })();

    return () => {
      abort.abort();
      resize?.disconnect();
      void context?.close().catch(() => {});
    };
  }, [src, enabled]);

  return <div className="sound-waveform-shell"><canvas ref={canvasRef} aria-label="Decoded audio waveform" />{error ? <small title={error}>Waveform unavailable</small> : null}</div>;
}

function CapabilityMark({ profile, aliases, children }: { profile: any; aliases: string[]; children: React.ReactNode }) {
  const deterministic = hasBoundInput(profile, ...aliases);
  return <span className={deterministic ? "sound-control-binding deterministic" : "sound-control-binding compiled"}>{children} · {deterministic ? "Workflow input" : "Compiled into prompt"}</span>;
}

function workflowCandidateId(candidate: any, index = 0) {
  const sourcePath = String(candidate?.path || candidate?.sourcePath || "").trim();
  if (sourcePath) return `path:${sourcePath.replace(/\\/g, "/").toLowerCase()}`;
  const name = String(candidate?.name || candidate?.id || candidate?.profileId || "").trim().toLowerCase();
  const detail = [candidate?.reason, candidate?.error].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join("\u001f");
  if (name || detail) return `discovery:${name}\u001f${detail}`;
  const checksum = String(candidate?.sha256 || "").trim().toLowerCase();
  return checksum ? `sha256:${checksum}` : `candidate-${index}`;
}

function workflowProfileEnabled(profile: any) {
  return (profile?.readiness?.enabled ?? profile?.enabled) !== false;
}

function WorkflowManagerDrawer({ open, onClose, slug, snapshot, selectedProfile: workspaceProfile, onRefresh }: {
  open: boolean;
  onClose: () => void;
  slug: string;
  snapshot: SoundWorkflowSnapshot;
  selectedProfile: any;
  onRefresh: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [managerProfileId, setManagerProfileId] = useState(() => profileId(workspaceProfile));
  const [candidates, setCandidates] = useState<any[]>(() => Array.isArray(snapshot.candidates) ? snapshot.candidates : []);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [inputBindingsJson, setInputBindingsJson] = useState("{}");
  const [outputBindingsJson, setOutputBindingsJson] = useState("[]");
  const [apiWorkflowPath, setApiWorkflowPath] = useState("");
  const [apiWorkflowJson, setApiWorkflowJson] = useState("");
  const [importId, setImportId] = useState("");
  const [importName, setImportName] = useState("");
  const [importCategory, setImportCategory] = useState("music");
  const [importModelFamily, setImportModelFamily] = useState("");
  const [importInputBindingsJson, setImportInputBindingsJson] = useState("{}");
  const [importOutputBindingsJson, setImportOutputBindingsJson] = useState("[]");
  const importInput = useRef<HTMLInputElement>(null);

  const selectedProfile = snapshot.profiles.find((profile) => profileId(profile) === managerProfileId)
    || snapshot.profiles.find((profile) => profileId(profile) === profileId(workspaceProfile))
    || snapshot.profiles[0]
    || null;
  const selectedProfileEditorKey = selectedProfile ? JSON.stringify({
    id: profileId(selectedProfile),
    name: soundProfileLabel(selectedProfile),
    inputs: inputBindings(selectedProfile),
    outputs: outputBindings(selectedProfile)
  }) : "";
  const selectedCandidate = candidates.find((candidate, index) => workflowCandidateId(candidate, index) === selectedCandidateId) || null;
  const canImport = snapshot.management?.importWorkflow === true || snapshot.management?.import === true;
  const canEnableDisable = snapshot.management?.enableDisable === true;
  const canRename = snapshot.management?.rename === true;
  const canRebind = snapshot.management?.rebind === true;
  const selectedModels = requirementRows(selectedProfile, "model");
  const selectedNodes = requirementRows(selectedProfile, "node");

  useEffect(() => {
    const workspaceId = profileId(workspaceProfile);
    if (open && workspaceId) setManagerProfileId(workspaceId);
  }, [open, profileId(workspaceProfile)]);

  useEffect(() => {
    if (!Array.isArray(snapshot.candidates) || !snapshot.candidates.length) return;
    setCandidates((current) => {
      const merged = new Map<string, any>();
      [...current, ...snapshot.candidates].forEach((candidate, index) => merged.set(workflowCandidateId(candidate, index), candidate));
      return [...merged.values()];
    });
  }, [snapshot.candidates]);

  useEffect(() => {
    if (!selectedProfile) return;
    setRenameValue(soundProfileLabel(selectedProfile));
    setInputBindingsJson(JSON.stringify(inputBindings(selectedProfile), null, 2));
    setOutputBindingsJson(JSON.stringify(outputBindings(selectedProfile), null, 2));
    setApiWorkflowPath("");
    setApiWorkflowJson("");
  }, [managerProfileId, selectedProfileEditorKey]);

  useEffect(() => {
    if (!selectedCandidate) return;
    const sourcePath = String(selectedCandidate.path || selectedCandidate.sourcePath || "");
    const baseName = String(selectedCandidate.name || sourcePath.split(/[\\/]/).pop() || "Audio workflow").replace(/\.json$/i, "");
    setImportId(String(selectedCandidate.id || baseName).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""));
    setImportName(baseName);
    setImportInputBindingsJson("{}");
    setImportOutputBindingsJson("[]");
  }, [selectedCandidateId]);

  if (!open) return null;

  const parseJsonEditor = (value: string, label: string, fallback: any) => {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch (reason: any) {
      throw new Error(`${label} must be valid JSON: ${String(reason?.message || reason)}`);
    }
  };

  const parseInputBindings = (value: string, label: string) => {
    const parsed = parseJsonEditor(value, label, {});
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
    return parsed;
  };

  const parseOutputBindings = (value: string, label: string) => {
    const parsed = parseJsonEditor(value, label, []);
    if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
    return parsed;
  };

  const request = async (action: string, path: string, method: "POST" | "PATCH", body: BodyInit, headers?: HeadersInit) => {
    setBusy(action);
    setMessage("");
    setError("");
    try {
      const response = await fetch(path, { method, body, headers });
      const json = await jsonResponse(response);
      setMessage(json.message || "Workflow registry updated.");
      if (Array.isArray(json.candidates)) {
        setCandidates(json.candidates);
        setSelectedCandidateId((current) => json.candidates.some((candidate: any, index: number) => workflowCandidateId(candidate, index) === current) ? current : "");
      }
      if (json.profile) setManagerProfileId(profileId(json.profile));
      await onRefresh();
      return json;
    } catch (error: any) {
      setError(String(error.message || error));
      return null;
    } finally {
      setBusy("");
    }
  };

  const importManifest = () => ({
    ...(importId.trim() ? { id: importId.trim() } : {}),
    ...(importName.trim() ? { displayName: importName.trim() } : {}),
    category: importCategory,
    ...(importModelFamily.trim() ? { modelFamily: importModelFamily.trim() } : {}),
    inputNodeBindings: parseInputBindings(importInputBindingsJson, "Import input bindings"),
    outputNodeBindings: parseOutputBindings(importOutputBindingsJson, "Import output bindings")
  });

  const importCandidate = async () => {
    if (!selectedCandidate) return;
    try {
      const sourcePath = String(selectedCandidate.path || selectedCandidate.sourcePath || "").trim();
      if (!sourcePath) throw new Error("The selected candidate did not report a source path.");
      await request("import-candidate", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/import`, "POST", JSON.stringify({ sourcePath, ...importManifest() }), { "Content-Type": "application/json" });
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    }
  };

  const rebindSelected = async () => {
    if (!selectedProfile) return;
    try {
      if (apiWorkflowPath.trim() && apiWorkflowJson.trim()) throw new Error("Choose either an API workflow path or pasted API workflow JSON, not both.");
      const payload = {
        inputNodeBindings: parseInputBindings(inputBindingsJson, "Input bindings"),
        outputNodeBindings: parseOutputBindings(outputBindingsJson, "Output bindings"),
        ...(apiWorkflowPath.trim() ? { apiWorkflowPath: apiWorkflowPath.trim() } : {}),
        ...(apiWorkflowJson.trim() ? { apiWorkflow: parseJsonEditor(apiWorkflowJson, "API workflow", {}) } : {})
      };
      await request("rebind", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/${encodeURIComponent(profileId(selectedProfile))}/rebind`, "POST", JSON.stringify(payload), { "Content-Type": "application/json" });
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    }
  };

  return (
    <aside className="sound-workflow-drawer" aria-label="Audio workflow settings">
      <header><div><span className="workspace-eyebrow">AUDIO ADAPTER REGISTRY</span><h2>Workflow Manager</h2></div><button className="icon-button" aria-label="Close workflow manager" onClick={onClose}>×</button></header>
      <div className="sound-workflow-drawer-actions">
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => void request("scan", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/scan`, "POST", JSON.stringify({}), { "Content-Type": "application/json" })}>{busy === "scan" ? "Scanning…" : "Scan local workflows"}</button>
        <button className="button secondary" disabled={Boolean(busy) || !selectedProfile} onClick={() => void request("validate", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/validate`, "POST", JSON.stringify({ profileId: profileId(selectedProfile) }), { "Content-Type": "application/json" })}>{busy === "validate" ? "Validating…" : "Validate selected"}</button>
        <button className="button secondary" disabled={Boolean(busy) || !canImport} title={canImport ? "Import a workflow JSON into the app-owned registry." : "This registry did not advertise workflow import support."} onClick={() => importInput.current?.click()}>Import workflow JSON</button>
        <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          event.target.value = "";
          void (async () => {
            try {
              const manifest = importManifest();
              const form = new FormData();
              form.set("workflowFile", file, file.name);
              for (const [key, value] of Object.entries(manifest)) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
              await request("import-upload", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/import`, "POST", form);
            } catch (reason: any) {
              setError(String(reason?.message || reason));
            }
          })();
        }} />
      </div>
      {message ? <p className="sound-workflow-drawer-message" role="status">{message}</p> : null}
      {error ? <p className="sound-workflow-drawer-message error" role="alert">{error}</p> : null}
      <section className="sound-workflow-profile-list">
        <h3>Registered profiles</h3>
        {snapshot.profiles.map((profile) => <button type="button" key={profileId(profile)} className={selectedProfile && profileId(profile) === profileId(selectedProfile) ? "active" : ""} aria-pressed={selectedProfile && profileId(profile) === profileId(selectedProfile)} onClick={() => setManagerProfileId(profileId(profile))}><i className={soundProfileReady(profile) ? "ready" : "blocked"} /><span><b>{soundProfileLabel(profile)}</b><small>{profileFamily(profile)} · {profileReason(profile)}</small></span></button>)}
      </section>
      {selectedProfile ? <section className="sound-workflow-inspector">
        <h3>Selected profile</h3>
        <dl><div><dt>Profile ID</dt><dd>{profileId(selectedProfile)}</dd></div><div><dt>Source checksum</dt><dd>{selectedProfile.sourceWorkflowSha256 || selectedProfile.workflowSha256 || selectedProfile.source?.sha256 || selectedProfile.sha256 || "Not reported"}</dd></div><div><dt>Source workflow</dt><dd>{selectedProfile.originalWorkflowPath || selectedProfile.sourceWorkflowPath || selectedProfile.source?.relativePath || selectedProfile.sourcePath || "Not reported"}</dd></div><div><dt>App-owned API graph</dt><dd>{selectedProfile.appOwnedApiWorkflowPath || selectedProfile.apiWorkflowPath || selectedProfile.api?.relativePath || "Not reported"}</dd></div></dl>
        <p className="sound-workflow-immutability">The source workflow and its checksum are read-only. Registry edits and rebinding only update app-owned copies.</p>
        {canRename ? <div className="sound-workflow-inline-control"><label>Display name<input value={renameValue} maxLength={120} onChange={(event) => setRenameValue(event.target.value)} /></label><button className="button secondary" type="button" disabled={Boolean(busy) || !renameValue.trim() || renameValue.trim() === soundProfileLabel(selectedProfile)} onClick={() => void request("rename", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/${encodeURIComponent(profileId(selectedProfile))}/name`, "PATCH", JSON.stringify({ displayName: renameValue.trim() }), { "Content-Type": "application/json" })}>{busy === "rename" ? "Saving…" : "Save name"}</button></div> : null}
        {canEnableDisable ? <div className="sound-workflow-inline-control"><div><b>{workflowProfileEnabled(selectedProfile) ? "Profile enabled" : "Profile disabled"}</b><small>Enabling performs live validation; blocked profiles remain disabled.</small></div><button className={`button ${workflowProfileEnabled(selectedProfile) ? "danger" : "secondary"}`} type="button" disabled={Boolean(busy)} onClick={() => void request("enable", `/api/projects/${encodeURIComponent(slug)}/sound/workflows/${encodeURIComponent(profileId(selectedProfile))}/enabled`, "PATCH", JSON.stringify({ enabled: !workflowProfileEnabled(selectedProfile) }), { "Content-Type": "application/json" })}>{busy === "enable" ? "Updating…" : workflowProfileEnabled(selectedProfile) ? "Disable" : "Validate & enable"}</button></div> : null}
        <h3>Required models</h3>
        {selectedModels.length ? selectedModels.map((item) => <p key={item.label} className={item.ready ? "ready" : "blocked"}> {item.ready ? "✓" : "!"} {item.label}{item.reason ? ` · ${item.reason}` : ""}</p>) : <p>No model requirements reported.</p>}
        <h3>Required nodes</h3>
        {selectedNodes.length ? selectedNodes.map((item) => <p key={item.label} className={item.ready ? "ready" : "blocked"}> {item.ready ? "✓" : "!"} {item.label}{item.reason ? ` · ${item.reason}` : ""}</p>) : <p>No custom-node requirements reported.</p>}
        <details><summary>Binding details</summary><pre>{JSON.stringify({ inputs: inputBindings(selectedProfile), outputs: outputBindings(selectedProfile), errors: selectedProfile.validationErrors || selectedProfile.readiness?.validationErrors || selectedProfile.readiness?.errors || [] }, null, 2)}</pre></details>
        {canRebind ? <details className="sound-workflow-rebind"><summary>Rebind app-owned API graph</summary><p>Use node IDs and input names from the app-owned API graph. The original workflow is never rewritten.</p><label>Input bindings · JSON object<textarea rows={8} spellCheck={false} value={inputBindingsJson} onChange={(event) => setInputBindingsJson(event.target.value)} /></label><label>Output bindings · JSON array<textarea rows={6} spellCheck={false} value={outputBindingsJson} onChange={(event) => setOutputBindingsJson(event.target.value)} /></label><label>Optional replacement API workflow path<input value={apiWorkflowPath} onChange={(event) => setApiWorkflowPath(event.target.value)} placeholder="Leave blank to keep the app-owned API graph" /></label><label>Or paste replacement API workflow · JSON<textarea rows={8} spellCheck={false} value={apiWorkflowJson} onChange={(event) => setApiWorkflowJson(event.target.value)} placeholder="Leave blank when using a path or keeping the current graph" /></label><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void rebindSelected()}>{busy === "rebind" ? "Rebinding…" : "Validate & save bindings"}</button></details> : null}
      </section> : null}
      <section className="sound-workflow-candidates"><h3>Discovered candidates · {candidates.length}</h3>{candidates.length ? candidates.map((candidate, index) => {
        const candidateId = workflowCandidateId(candidate, index);
        return <button type="button" key={candidateId} className={candidateId === selectedCandidateId ? "active" : ""} aria-pressed={candidateId === selectedCandidateId} onClick={() => setSelectedCandidateId(candidateId)}><b>{candidate.name || candidate.path || `Candidate ${index + 1}`}</b><small>{candidate.error || candidate.reason || candidate.status || `${candidate.schemaType || "Unknown"} schema · ${candidate.relevant === false ? "not audio-relevant" : "not registered"}`}</small></button>;
      }) : <p>Run a local scan to inspect workflow JSON without changing it.</p>}
        {selectedCandidate ? <dl className="sound-workflow-candidate-details"><div><dt>Path</dt><dd>{selectedCandidate.path || selectedCandidate.sourcePath || "Not reported"}</dd></div><div><dt>SHA-256</dt><dd>{selectedCandidate.sha256 || "Not reported"}</dd></div><div><dt>Schema</dt><dd>{selectedCandidate.schemaType || "Unknown"}</dd></div><div><dt>Audio relevant</dt><dd>{selectedCandidate.relevant === true ? "Yes" : selectedCandidate.relevant === false ? "No" : "Not reported"}</dd></div><div><dt>Node classes</dt><dd>{Array.isArray(selectedCandidate.nodeClasses) && selectedCandidate.nodeClasses.length ? selectedCandidate.nodeClasses.join(", ") : "None reported"}</dd></div>{selectedCandidate.error ? <div><dt>Scan error</dt><dd className="blocked">{selectedCandidate.error}</dd></div> : null}</dl> : null}
        {canImport ? <div className="sound-workflow-import-form"><h3>Copy into app registry</h3><p>Imports are copy-only and always start disabled. The selected source workflow is not edited.</p><div className="sound-workflow-import-grid"><label>Profile ID<input value={importId} onChange={(event) => setImportId(event.target.value)} placeholder="stable-audio-custom" /></label><label>Display name<input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Custom audio workflow" /></label><label>Category<select value={importCategory} onChange={(event) => setImportCategory(event.target.value)}><option value="music">Music</option><option value="sound-effect">Sound FX</option><option value="voice-design">Voice Design</option><option value="hybrid">Hybrid</option></select></label><label>Model family<input value={importModelFamily} onChange={(event) => setImportModelFamily(event.target.value)} placeholder="Optional" /></label></div><details><summary>Import bindings</summary><label>Input bindings · JSON<textarea rows={7} spellCheck={false} value={importInputBindingsJson} onChange={(event) => setImportInputBindingsJson(event.target.value)} /></label><label>Output bindings · JSON<textarea rows={5} spellCheck={false} value={importOutputBindingsJson} onChange={(event) => setImportOutputBindingsJson(event.target.value)} /></label></details><button className="button secondary" type="button" disabled={Boolean(busy) || !selectedCandidate} onClick={() => void importCandidate()}>{busy === "import-candidate" ? "Copying…" : "Import selected candidate"}</button><small>Upload imports use these manifest fields too. Leave the profile ID and display name blank to derive them from the uploaded filename.</small></div> : null}
      </section>
    </aside>
  );
}

export default function SoundWorkflowWorkspace({ kind, slug, snapshot, loading, loadError, active, onRefresh, onProfileChange }: SoundWorkflowWorkspaceProps) {
  const store = useStore();
  const copy = TAB_COPY[kind];
  const [draft, setDraft] = useState<WorkflowDraft>(() => loadDraft(slug, kind));
  const currentDraftScope = `${kind}\u001f${slug}`;
  const [loadedDraftScope, setLoadedDraftScope] = useState(currentDraftScope);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<PromptProposal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [developing, setDeveloping] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [auditionIds, setAuditionIds] = useState<string[]>([]);

  const profiles = useMemo(() => snapshot.profiles.filter((profile) => profileMatchesKind(profile, kind)), [snapshot.profiles, kind]);
  const defaultProfile = profiles.find(soundProfileReady) || profiles[0] || null;
  const selectedProfile = profiles.find((profile) => profileId(profile) === draft.profileId) || defaultProfile;
  const range = durationRange(selectedProfile);
  const controls = advancedControls(selectedProfile);
  const assets = useMemo(() => snapshot.assets.filter((asset) => assetMatchesKind(asset, kind)).sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""))), [snapshot.assets, kind]);
  const selectedProfileId = profileId(selectedProfile);

  useEffect(() => {
    if (loadedDraftScope === currentDraftScope) return;
    setLoadedDraftScope(currentDraftScope);
    setDraft(loadDraft(slug, kind));
    setReferenceFile(null);
    setProposal(null);
    setFormError("");
    setNotice("");
    setAuditionIds([]);
  }, [currentDraftScope, loadedDraftScope, kind, slug]);

  useEffect(() => {
    if (loadedDraftScope !== currentDraftScope) return;
    try { localStorage.setItem(storageKey(slug, kind), JSON.stringify(draft)); } catch {}
  }, [slug, kind, draft, currentDraftScope, loadedDraftScope]);

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((profile) => profileId(profile) === draft.profileId)) setDraft((current) => ({ ...current, profileId: profileId(defaultProfile) }));
  }, [profiles.map(profileId).join("|"), draft.profileId, profileId(defaultProfile)]);

  useEffect(() => {
    if (active) onProfileChange?.(selectedProfile);
  }, [active, selectedProfileId, selectedProfile?.ready, selectedProfile?.status, selectedProfile?.readiness?.status]);

  useEffect(() => {
    if (!selectedProfile || !controls.length) return;
    setDraft((current) => {
      const next = { ...current.advanced };
      let changed = false;
      for (const control of controls) {
        const key = String(control.key || control.id || control.name);
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
          next[key] = control.default ?? control.defaultValue ?? (control.type === "boolean" ? false : "");
          changed = true;
        }
      }
      return changed ? { ...current, advanced: next } : current;
    });
  }, [selectedProfileId, controls.map((control: any) => control.key || control.id || control.name).join("|")]);

  const knownAssetJobIds = new Set(assets.map((asset) => String(asset.jobId || asset.job?.id || "")).filter(Boolean));
  const jobs = store.jobs.filter((job: any) => {
    if (job.projectSlug && job.projectSlug !== slug) return false;
    const jobProfile = String(job.refs?.profileId || job.refs?.workflowProfileId || job.profileId || "");
    const jobCategory = token(job.refs?.category || job.category || "");
    if (knownAssetJobIds.has(String(job.id || ""))) return true;
    if (jobProfile && profiles.some((profile) => profileId(profile) === jobProfile)) return true;
    if (!/sound|audio|music|voice|foley|sfx/i.test(`${job.type || ""} ${job.label || ""}`)) return false;
    if (kind === "voice-design") return /voice|tts/i.test(`${jobCategory} ${job.type || ""} ${job.label || ""}`) && !/index[\s_-]*tts/i.test(`${job.type || ""} ${job.label || ""}`);
    if (kind === "music") return /music|score|ost/i.test(`${jobCategory} ${job.type || ""} ${job.label || ""}`);
    return /sfx|sound[\s_-]*effect|foley|ambience/i.test(`${jobCategory} ${job.type || ""} ${job.label || ""}`);
  });
  const activeJobs = jobs.filter((job: any) => ACTIVE_STATUSES.has(String(job.status || "").toLowerCase()));

  const promptBound = selectedProfile && (hasBoundInput(selectedProfile, "prompt", "text", "tags", "description", "instruct") || supports(selectedProfile, "prompt", "text"));
  const durationSupported = Boolean(range.min || range.max || hasBoundInput(selectedProfile, "duration", "seconds", "durationSec"));
  const requestedDuration = Number(draft.durationSec);
  const durationTooShort = Boolean(range.min && requestedDuration < range.min);
  const durationTooLong = Boolean(range.max && requestedDuration > range.max);
  const segmentedSupported = supports(selectedProfile, "segmented", "segments", "longForm");
  const segmentCount = durationTooLong && range.max ? Math.ceil(requestedDuration / range.max) : 1;
  const hasRequiredText = kind === "voice-design" ? Boolean(draft.prompt.trim() && draft.exactText.trim()) : Boolean(draft.prompt.trim());
  const canGenerate = Boolean(selectedProfile && soundProfileReady(selectedProfile) && promptBound && hasRequiredText && draft.name.trim() && !durationTooShort && (!durationTooLong || segmentedSupported) && !submitting);

  const patch = <K extends keyof WorkflowDraft>(key: K, value: WorkflowDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const compiledPrompt = compileCreativePrompt(kind, draft, proposal);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    if (!selectedProfile) return setFormError("Select a registered audio workflow profile.");
    if (!soundProfileReady(selectedProfile)) return setFormError(profileReason(selectedProfile));
    if (!promptBound) return setFormError("This profile does not advertise a bound prompt input.");
    if (!hasRequiredText) return setFormError(kind === "voice-design" ? "Enter both voice direction and an audition line." : "Enter a generation prompt.");
    if (durationTooShort) return setFormError(`This workflow requires at least ${range.min} seconds.`);
    if (durationTooLong && !segmentedSupported) return setFormError(`This workflow supports at most ${range.max} seconds and does not advertise segmented generation.`);

    const association = {
      projectSlug: slug,
      clipId: store.productionClipId || null,
      clipSource: store.productionClipSource || null,
      playheadFrame: store.playheadFrame ?? null,
      inPointSec: kind === "sound-fx" ? draft.inPointSec : null,
      outPointSec: kind === "sound-fx" ? draft.outPointSec : null,
      fadeInSec: kind === "sound-fx" ? draft.fadeInSec : null,
      fadeOutSec: kind === "sound-fx" ? draft.fadeOutSec : null
    };
    const parameters: Record<string, any> = {
      name: draft.name.trim(),
      title: draft.name.trim(),
      prompt: compiledPrompt,
      originalPrompt: draft.prompt.trim(),
      promptChoice: proposal?.choice || "original",
      association,
      sourceMode: draft.sourceMode,
      advanced: draft.advanced
    };
    if (kind === "voice-design") {
      parameters.text = draft.exactText.trim();
      parameters.instruct = compiledPrompt;
      parameters.language = draft.language;
    }
    if (durationSupported) parameters.durationSec = requestedDuration;
    if (durationTooLong && segmentedSupported && range.max) parameters.segmentPlan = Array.from({ length: segmentCount }, (_, index) => ({ index, durationSec: Math.min(range.max!, Math.max(0, requestedDuration - (index * range.max!))) }));
    if (supports(selectedProfile, "negativePrompt")) parameters.negativePrompt = draft.negativePrompt.trim();
    if (supports(selectedProfile, "lyrics")) parameters.lyrics = draft.lyrics;
    if (supports(selectedProfile, "seed")) parameters.seed = Math.trunc(draft.seed);
    if (supports(selectedProfile, "variationCount", "batchSize", "batch")) parameters.variationCount = Math.max(1, Math.trunc(draft.variationCount));
    if (hasBoundInput(selectedProfile, "bpm", "tempo")) parameters.bpm = draft.bpm;
    if (hasBoundInput(selectedProfile, "meter", "timeSignature")) parameters.meter = draft.meter;
    if (hasBoundInput(selectedProfile, "key", "keyscale", "tonalCenter")) parameters.tonalCenter = draft.tonalCenter;
    if (hasBoundInput(selectedProfile, "loop", "loopable")) parameters.loopable = draft.loopable;
    if (hasBoundInput(selectedProfile, "instrumental", "vocalMode")) parameters.instrumental = !draft.vocalDescription.trim();

    const body = new FormData();
    body.set("profileId", selectedProfileId);
    body.set("category", kind === "voice-design" ? "voice" : kind === "music" ? "music" : "sound_effect");
    body.set("parameters", JSON.stringify(parameters));
    if (referenceFile) body.set("referenceFile", referenceFile, referenceFile.name);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/workflow-generations`, { method: "POST", body });
      const json = await jsonResponse(response);
      const queued = values(json.jobs || json.job).length || 1;
      setNotice(`Queued ${queued} ${copy.title.toLowerCase()} generation${queued === 1 ? "" : "s"} with ${soundProfileLabel(selectedProfile)}.`);
      await store.refreshQueue();
      await onRefresh();
    } catch (error: any) {
      setFormError(String(error.message || error));
    } finally {
      setSubmitting(false);
    }
  }

  async function developPrompt() {
    if (!selectedProfile || !draft.prompt.trim() || developing || !supports(selectedProfile, "promptEnhancement", "developPrompt")) return;
    setDeveloping(true);
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/develop-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selectedProfileId, category: kind === "sound-fx" ? "sound_effect" : kind === "voice-design" ? "voice" : "music", prompt: draft.prompt, parameters: { name: draft.name, sourceMode: draft.sourceMode } })
      });
      const json = await jsonResponse(response);
      const developed = String(json.developedPrompt || json.enhancedPrompt || json.proposal || json.prompt || "").trim();
      if (!developed) throw new Error("The prompt developer returned no proposed text.");
      setProposal({ original: draft.prompt, developed, choice: "original" });
    } catch (error: any) {
      setFormError(String(error.message || error));
    } finally {
      setDeveloping(false);
    }
  }

  async function patchAsset(asset: any, body: any) {
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/assets/${encodeURIComponent(assetId(asset))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      await jsonResponse(response);
      await onRefresh();
    } catch (error: any) {
      setFormError(String(error.message || error));
    }
  }

  async function deleteAsset(asset: any) {
    if (!window.confirm(`Delete “${asset.name || asset.title || "this audio asset"}”? The native source is retained only if the backend marks deletion recoverable.`)) return;
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/assets/${encodeURIComponent(assetId(asset))}`, { method: "DELETE" });
      await jsonResponse(response);
      await onRefresh();
    } catch (error: any) {
      setFormError(String(error.message || error));
    }
  }

  async function runAssetAction(asset: any, action: string, extra: any = {}) {
    setFormError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/assets/${encodeURIComponent(assetId(asset))}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra })
      });
      const json = await jsonResponse(response);
      setNotice(json.message || `${action.replace(/_/g, " ")} completed.`);
      await store.refreshQueue();
      await onRefresh();
    } catch (error: any) {
      setFormError(String(error.message || error));
    }
  }

  function loadAsset(asset: any) {
    setDraft((current) => ({
      ...current,
      profileId: assetProfileId(asset) || current.profileId,
      name: String(asset.name || asset.title || current.name),
      prompt: String(asset.originalPrompt || asset.prompt || current.prompt),
      exactText: String(asset.text || asset.parameters?.text || current.exactText),
      negativePrompt: String(asset.negativePrompt || current.negativePrompt),
      lyrics: String(asset.lyrics || current.lyrics),
      seed: Number.isFinite(Number(asset.seed)) ? Number(asset.seed) : current.seed,
      durationSec: Number.isFinite(Number(asset.durationSec)) ? Number(asset.durationSec) : current.durationSec
    }));
    setProposal(null);
  }

  const selectedModels = requirementRows(selectedProfile, "model");
  const selectedNodes = requirementRows(selectedProfile, "node");
  const referenceAudioSupported = supports(selectedProfile, "referenceAudio", "audioReference");
  const referenceVideoSupported = supports(selectedProfile, "referenceVideo", "videoConditioning");
  const promptEnhancementSupported = supports(selectedProfile, "promptEnhancement", "developPrompt");
  const variationsSupported = supports(selectedProfile, "variationCount", "batchSize", "batch");

  return (
    <>
      <div className="create-sound-grid sound-workflow-grid">
        <section className="create-sound-panel sound-engine-panel">
          <header><div><span>1</span><h2>{copy.source}</h2></div><small>{loading ? "Checking registry…" : `${profiles.length} registered profile${profiles.length === 1 ? "" : "s"}`}</small></header>
          <div className="create-sound-panel-scroll">
            <label>Engine / workflow profile
              <select value={selectedProfileId} disabled={!profiles.length} onChange={(event) => patch("profileId", event.target.value)}>
                {!profiles.length ? <option value="">No registered {copy.title.toLowerCase()} profiles</option> : null}
                {profiles.map((profile) => <option key={profileId(profile)} value={profileId(profile)}>{soundProfileLabel(profile)}{soundProfileReady(profile) ? "" : " — unavailable"}</option>)}
              </select>
            </label>
            <div className={`sound-profile-readiness ${soundProfileReady(selectedProfile) ? "ready" : "blocked"}`}>
              <i /><p><b>{selectedProfile ? soundProfileLabel(selectedProfile) : "No workflow selected"}</b><small>{selectedProfile ? `${profileFamily(selectedProfile)} · ${profileReason(selectedProfile)}` : loadError || "Scan or bind a local workflow to continue."}</small></p>
            </div>
            {selectedProfile ? <div className="sound-profile-facts">
              <div><span>Duration</span><b>{range.min || range.max ? `${range.min ?? 0}–${range.max ?? "∞"} sec` : "Not advertised"}</b></div>
              <div><span>Outputs</span><b>{outputFormats(selectedProfile).join(", ") || "Not advertised"}</b></div>
              <div><span>Models</span><b className={selectedModels.every((item) => item.ready) ? "ready" : "blocked"}>{selectedModels.length ? `${selectedModels.filter((item) => item.ready).length}/${selectedModels.length} ready` : "None reported"}</b></div>
              <div><span>Nodes</span><b className={selectedNodes.every((item) => item.ready) ? "ready" : "blocked"}>{selectedNodes.length ? `${selectedNodes.filter((item) => item.ready).length}/${selectedNodes.length} ready` : "None reported"}</b></div>
            </div> : null}

            {kind === "music" && supports(selectedProfile, "instrumental", "vocalMode") ? <label>Performance mode<select value={draft.vocalDescription.trim() ? "vocal" : "instrumental"} onChange={(event) => patch("vocalDescription", event.target.value === "vocal" ? draft.vocalDescription || "Vocals as directed" : "")}><option value="instrumental">Instrumental</option><option value="vocal">Vocal</option></select></label> : null}
            {kind === "sound-fx" ? <label>Source mode<select value={draft.sourceMode} onChange={(event) => patch("sourceMode", event.target.value)}>{SOURCE_MODES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}{referenceVideoSupported ? <option value="reference-video">Video/reference-conditioned sound</option> : null}</select></label> : null}
            {referenceAudioSupported || referenceVideoSupported ? <label className="sound-reference-upload"><span>Optional {referenceVideoSupported && draft.sourceMode === "reference-video" ? "source video/audio" : "reference audio"}</span><input type="file" accept={referenceVideoSupported && draft.sourceMode === "reference-video" ? "video/*,audio/*" : "audio/*"} onChange={(event) => setReferenceFile(event.target.files?.[0] || null)} /><small>{referenceFile ? referenceFile.name : "No reference selected"}</small></label> : null}

            <section className="sound-project-binding"><h3>Production association</h3><p><b>{store.project?.name || slug}</b><small>{store.productionClipId ? `${store.productionClipId} · ${store.productionClipSource || "active clip"}` : "Project-level asset · no active clip"}</small></p></section>

            <section className="sound-saved-source-list"><header><h3>{kind === "music" ? "Saved music cues" : kind === "voice-design" ? "Saved voices" : "Saved SFX assets"}</h3><span>{assets.length}</span></header>{assets.slice(0, 8).map((asset) => <article key={assetId(asset)}><button type="button" onClick={() => loadAsset(asset)}><b>{asset.name || asset.title || "Audio asset"}</b><small>{durationLabel(asset.durationSec)} · {asset.engine || asset.workflowName || "Local"}</small></button><button type="button" disabled={!actionSupported(assetAllowedActions(asset, selectedProfile), "variation")} title="Duplicate this asset as a variation" onClick={() => void runAssetAction(asset, "variation")}>⧉</button></article>)}{!assets.length ? <p className="create-sound-hint">No saved {copy.title.toLowerCase()} assets yet.</p> : null}</section>
            <button className="button secondary full" type="button" onClick={() => setManagerOpen(true)}>Manage audio workflows</button>
          </div>
        </section>

        <section className="create-sound-panel sound-direction-panel">
          <header><div><span>2</span><h2>{copy.direction}</h2></div><small>Only bound controls are deterministic</small></header>
          <form className="create-sound-form" onSubmit={generate}>
            <div className="create-sound-form-scroll sound-direction-scroll">
              <label>{kind === "music" ? "Cue title" : kind === "voice-design" ? "Voice name" : "Asset name"}<input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></label>
              <label className="create-sound-dialogue-label">{kind === "voice-design" ? "Voice identity / performance direction" : kind === "music" ? "Music prompt" : "Sound description"}<CapabilityMark profile={selectedProfile} aliases={["prompt", "text", "tags", "description", "instruct"]}>Primary conditioning</CapabilityMark>
                <textarea rows={kind === "voice-design" ? 6 : 8} value={draft.prompt} onChange={(event) => { patch("prompt", event.target.value); if (proposal) setProposal(null); }} placeholder={kind === "voice-design" ? "Describe register, timbre, accent, pacing, breath, imperfections, and exclusions…" : kind === "music" ? "Describe the cue, musical purpose, movement, and emotional result…" : "Describe only the sound that should be heard…"} />
                <small>{draft.prompt.trim().length.toLocaleString()} characters</small>
              </label>
              {kind === "voice-design" ? <><label>Audition line<CapabilityMark profile={selectedProfile} aliases={["text", "speechText"]}>Exact workflow text</CapabilityMark><textarea rows={5} value={draft.exactText} onChange={(event) => patch("exactText", event.target.value)} placeholder="Enter the exact words for the voice audition…" /></label><label>Language<CapabilityMark profile={selectedProfile} aliases={["language"]}>Language</CapabilityMark><input value={draft.language} onChange={(event) => patch("language", event.target.value)} /></label></> : null}

              {kind === "music" ? <div className="sound-field-grid">
                <label>Genre<CapabilityMark profile={selectedProfile} aliases={["genre"]}>Genre</CapabilityMark><input value={draft.genre} onChange={(event) => patch("genre", event.target.value)} /></label>
                <label>Subgenre<CapabilityMark profile={selectedProfile} aliases={["subgenre"]}>Subgenre</CapabilityMark><input value={draft.subgenre} onChange={(event) => patch("subgenre", event.target.value)} /></label>
                <label>Mood<CapabilityMark profile={selectedProfile} aliases={["mood"]}>Mood</CapabilityMark><input value={draft.mood} onChange={(event) => patch("mood", event.target.value)} /></label>
                <label>Emotional arc<CapabilityMark profile={selectedProfile} aliases={["emotionalArc"]}>Arc</CapabilityMark><input value={draft.emotionalArc} onChange={(event) => patch("emotionalArc", event.target.value)} /></label>
                <label className="wide">Instrumentation<CapabilityMark profile={selectedProfile} aliases={["instrumentation", "instruments"]}>Instrumentation</CapabilityMark><textarea rows={3} value={draft.instrumentation} onChange={(event) => patch("instrumentation", event.target.value)} /></label>
                <label className="wide">Vocal description<CapabilityMark profile={selectedProfile} aliases={["vocalDescription", "vocalMode"]}>Vocals</CapabilityMark><textarea rows={3} value={draft.vocalDescription} onChange={(event) => patch("vocalDescription", event.target.value)} /></label>
                <label>Tempo / BPM<CapabilityMark profile={selectedProfile} aliases={["bpm", "tempo"]}>Tempo</CapabilityMark><input type="number" min={20} max={300} value={draft.bpm} onChange={(event) => patch("bpm", Number(event.target.value) || 0)} /></label>
                <label>Meter<CapabilityMark profile={selectedProfile} aliases={["meter", "timeSignature"]}>Meter</CapabilityMark><input value={draft.meter} onChange={(event) => patch("meter", event.target.value)} /></label>
                <label>Tonal center / key<CapabilityMark profile={selectedProfile} aliases={["key", "keyscale", "tonalCenter"]}>Key</CapabilityMark><input value={draft.tonalCenter} onChange={(event) => patch("tonalCenter", event.target.value)} /></label>
                <label>Intro / outro behavior<CapabilityMark profile={selectedProfile} aliases={["introOutro"]}>Structure</CapabilityMark><input value={draft.introOutro} onChange={(event) => patch("introOutro", event.target.value)} /></label>
              </div> : null}

              {kind === "sound-fx" ? <div className="sound-field-grid">
                <label>Category<CapabilityMark profile={selectedProfile} aliases={["soundCategory", "category"]}>Category</CapabilityMark><select value={draft.soundCategory} onChange={(event) => patch("soundCategory", event.target.value)}>{SOUND_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Source / object<CapabilityMark profile={selectedProfile} aliases={["sourceObject", "source"]}>Source</CapabilityMark><input value={draft.sourceObject} onChange={(event) => patch("sourceObject", event.target.value)} /></label>
                <label>Physical action<CapabilityMark profile={selectedProfile} aliases={["physicalAction", "action"]}>Action</CapabilityMark><input value={draft.physicalAction} onChange={(event) => patch("physicalAction", event.target.value)} /></label>
                <label>Material<CapabilityMark profile={selectedProfile} aliases={["material"]}>Material</CapabilityMark><input value={draft.material} onChange={(event) => patch("material", event.target.value)} /></label>
                <label>Environment / space<CapabilityMark profile={selectedProfile} aliases={["environment", "acousticSpace"]}>Environment</CapabilityMark><input value={draft.environment} onChange={(event) => patch("environment", event.target.value)} /></label>
                <label>Listener / camera perspective<CapabilityMark profile={selectedProfile} aliases={["perspective", "listenerPerspective"]}>Perspective</CapabilityMark><input value={draft.perspective} onChange={(event) => patch("perspective", event.target.value)} /></label>
                <label>Distance<CapabilityMark profile={selectedProfile} aliases={["distance"]}>Distance</CapabilityMark><input value={draft.distance} onChange={(event) => patch("distance", event.target.value)} /></label>
                <label>Intensity<CapabilityMark profile={selectedProfile} aliases={["intensity"]}>Intensity</CapabilityMark><input value={draft.intensity} onChange={(event) => patch("intensity", event.target.value)} /></label>
                <label className="wide">Tail / reverb behavior<CapabilityMark profile={selectedProfile} aliases={["tailBehavior", "reverb"]}>Tail</CapabilityMark><input value={draft.tailBehavior} onChange={(event) => patch("tailBehavior", event.target.value)} /></label>
              </div> : null}

              {supports(selectedProfile, "lyrics") ? <label>Lyrics<CapabilityMark profile={selectedProfile} aliases={["lyrics"]}>Lyrics</CapabilityMark><textarea rows={6} value={draft.lyrics} onChange={(event) => patch("lyrics", event.target.value)} placeholder="Leave blank for instrumental output." /></label> : null}
              {supports(selectedProfile, "negativePrompt") ? <label>Negative / excluded sounds<CapabilityMark profile={selectedProfile} aliases={["negativePrompt"]}>Negative prompt</CapabilityMark><textarea rows={3} value={draft.negativePrompt} onChange={(event) => patch("negativePrompt", event.target.value)} /></label> : null}

              <div className="sound-field-grid compact">
                {durationSupported ? <label>Duration · native {range.min ?? 0}–{range.max ?? "∞"} sec<input type="number" min={0.1} step={0.1} value={draft.durationSec} onChange={(event) => patch("durationSec", Number(event.target.value) || 0)} /></label> : null}
                {supports(selectedProfile, "seed") ? <label>Seed<input type="number" step={1} value={draft.seed} onChange={(event) => patch("seed", Math.trunc(Number(event.target.value) || 0))} /></label> : null}
                <label>Variations<select disabled={!variationsSupported} value={draft.variationCount} title={variationsSupported ? "" : "This profile does not advertise batch or variation-count support."} onChange={(event) => patch("variationCount", Number(event.target.value) || 1)}>{[1, 2, 3, 4].map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
                <label className="sound-toggle"><input type="checkbox" checked={draft.loopable} onChange={(event) => patch("loopable", event.target.checked)} /><span>{kind === "sound-fx" ? "Loop instead of one-shot" : "Loopable"}<small>{hasBoundInput(selectedProfile, "loop", "loopable") ? "Workflow input" : "Compiled into prompt"}</small></span></label>
                <label className="sound-toggle"><input type="checkbox" checked={draft.seamlessEnding} onChange={(event) => patch("seamlessEnding", event.target.checked)} /><span>Seamless ending<small>{hasBoundInput(selectedProfile, "seamless", "seamlessEnding") ? "Workflow input" : "Compiled into prompt"}</small></span></label>
              </div>

              {kind === "sound-fx" ? <fieldset className="sound-editorial-timing"><legend>Editorial placement · applied during assembly</legend><div className="sound-field-grid compact"><label>In-point (sec)<input type="number" min={0} step={0.01} value={draft.inPointSec} onChange={(event) => patch("inPointSec", Number(event.target.value) || 0)} /></label><label>Out-point (sec)<input type="number" min={0} step={0.01} value={draft.outPointSec} onChange={(event) => patch("outPointSec", Number(event.target.value) || 0)} /></label><label>Fade in (sec)<input type="number" min={0} step={0.01} value={draft.fadeInSec} onChange={(event) => patch("fadeInSec", Number(event.target.value) || 0)} /></label><label>Fade out (sec)<input type="number" min={0} step={0.01} value={draft.fadeOutSec} onChange={(event) => patch("fadeOutSec", Number(event.target.value) || 0)} /></label></div><p>These values are edit metadata. They do not claim model-level frame timing.</p></fieldset> : null}

              {controls.length ? <details className="sound-advanced-controls"><summary>Advanced workflow parameters · {controls.length}</summary><div className="sound-field-grid">{controls.map((control: any) => {
                const key = String(control.key || control.id || control.name);
                const label = String(control.label || control.title || key);
                const current = draft.advanced[key];
                if (Array.isArray(control.options || control.enum)) return <label key={key}>{label}<select value={String(current ?? "")} onChange={(event) => patch("advanced", { ...draft.advanced, [key]: event.target.value })}>{(control.options || control.enum).map((option: any) => <option value={String(option.value ?? option)} key={String(option.value ?? option)}>{String(option.label ?? option)}</option>)}</select></label>;
                if (control.type === "boolean") return <label key={key} className="sound-toggle"><input type="checkbox" checked={Boolean(current)} onChange={(event) => patch("advanced", { ...draft.advanced, [key]: event.target.checked })} /><span>{label}<small>Bound workflow input</small></span></label>;
                return <label key={key}>{label}<input type={control.type === "number" || control.type === "integer" ? "number" : "text"} min={control.min} max={control.max} step={control.step} value={current ?? ""} onChange={(event) => patch("advanced", { ...draft.advanced, [key]: control.type === "number" || control.type === "integer" ? Number(event.target.value) : event.target.value })} /></label>;
              })}</div></details> : null}

              {promptEnhancementSupported ? <section className="sound-prompt-development"><header><div><b>Develop Prompt</b><small>Optional · original remains unchanged</small></div><button className="button secondary" type="button" disabled={!draft.prompt.trim() || developing} onClick={() => void developPrompt()}>{developing ? "Developing…" : "Propose enhancement"}</button></header>{proposal ? <div className="sound-prompt-comparison"><button type="button" className={proposal.choice === "original" ? "active" : ""} onClick={() => setProposal({ ...proposal, choice: "original" })}><b>Original</b><p>{proposal.original}</p></button><button type="button" className={proposal.choice === "developed" ? "active" : ""} onClick={() => setProposal({ ...proposal, choice: "developed" })}><b>Developed proposal</b><p>{proposal.developed}</p></button></div> : null}</section> : <p className="create-sound-hint">Prompt development is unavailable because this profile does not advertise an enhancement binding.</p>}

              {durationTooLong ? <div className={`sound-segment-notice ${segmentedSupported ? "ready" : "blocked"}`}>{segmentedSupported ? `Long-form plan: ${segmentCount} explicit segment${segmentCount === 1 ? "" : "s"}; native maximum ${range.max} sec each.` : `Requested duration exceeds the native ${range.max}-second maximum. Select a segmented-capable profile or reduce duration.`}</div> : null}
              {loadError ? <div className="create-sound-message warning" role="status">Workflow registry: {loadError}</div> : null}
              {formError ? <div className="create-sound-message error" role="alert">{formError}</div> : null}
              {notice ? <div className="create-sound-message success" role="status">{notice}</div> : null}
            </div>
            <footer><div><b>{selectedProfile ? soundProfileLabel(selectedProfile) : "No profile selected"}</b><small>{snapshot.gpu?.owner || snapshot.gpu?.leaseOwner || "GPU owner idle or unreported"}</small></div>{activeJobs[0] ? <button className="button danger" type="button" disabled={activeJobs[0].status === "cancelling"} onClick={() => void store.cancelJob(activeJobs[0].id)}>{activeJobs[0].status === "cancelling" ? "Cancelling…" : "Cancel"}</button> : null}<button className="button primary create-sound-generate" type="submit" disabled={!canGenerate}>{submitting ? "Queueing…" : kind === "music" ? "Generate Music" : kind === "sound-fx" ? "Generate Sound FX" : "Generate Voice Design"}</button></footer>
          </form>
        </section>

        <section className="create-sound-panel sound-output-panel">
          <header><div><span>3</span><h2>{copy.output}</h2></div><small>{activeJobs.length ? `${activeJobs.length} active` : `${assets.length} saved`}</small></header>
          <div className="create-sound-panel-scroll">
            {jobs.length ? <div className="create-sound-queue-list">{jobs.slice(0, 5).map((job: any) => {
              const status = String(job.status || "queued").toLowerCase();
              const rawProgress = Number(job.progressPercent ?? job.progress ?? 0);
              const progress = Math.max(0, Math.min(100, Math.round(rawProgress <= 1 ? rawProgress * 100 : rawProgress)));
              return <article key={job.id} className={`sound-live-job ${status}`}><header><i /><p><b>{job.label || `${copy.title} generation`}</b><small>{job.stage || status} · {job.id}</small></p><span>{status}</span></header><div><i style={{ width: `${progress}%` }} /></div>{job.error ? <details><summary>Technical error</summary><pre>{String(job.error)}</pre></details> : null}</article>;
            })}</div> : null}

            <div className="sound-asset-list">{assets.length ? assets.map((asset, index) => {
              const id = assetId(asset);
              const url = mediaUrl(asset, slug);
              const status = assetStatus(asset);
              const allowed = assetAllowedActions(asset, profiles.find((profile) => profileId(profile) === assetProfileId(asset)) || selectedProfile);
              const auditionIndex = auditionIds.indexOf(id);
              const technicalError = asset.error || asset.technicalError || values(asset.validationErrors).map((item) => item?.message || item).join("\n");
              return <article key={id || index} className={`sound-asset-card ${auditionIndex >= 0 ? "auditioning" : ""}`}>
                <header><span>{auditionIndex >= 0 ? (auditionIndex === 0 ? "A" : "B") : kind === "music" ? "♫" : kind === "voice-design" ? "VO" : "FX"}</span><p><b>{asset.name || asset.title || `${copy.title} take`}</b><small>{dateLabel(asset.createdAt)} · {durationLabel(asset.durationSec || asset.duration)}</small></p><em className={status}>{COMPLETE_STATUSES.has(status) || url ? "ready" : status}</em></header>
                {url ? <><AudioWaveform src={url} enabled={active} /><audio controls preload="metadata" src={url} /></> : <div className="create-sound-rendering"><i /><span>{technicalError || "Waiting for rendered audio…"}</span></div>}
                <dl className="sound-asset-metadata"><div><dt>Engine</dt><dd>{asset.engine || asset.modelFamily || "—"}</dd></div><div><dt>Workflow</dt><dd>{asset.workflowName || asset.profileName || assetProfileId(asset) || "—"}</dd></div><div><dt>Audio</dt><dd>{asset.sampleRate ? `${asset.sampleRate} Hz` : "—"} · {asset.channels || "—"} ch</dd></div><div><dt>Seed</dt><dd>{asset.seed ?? "—"}</dd></div></dl>
                <div className="sound-asset-actions"><button type="button" className={auditionIndex >= 0 ? "active" : ""} onClick={() => setAuditionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 2 ? [current[1], id] : [...current, id])}>A/B</button><button type="button" onClick={() => { const next = window.prompt("Rename audio asset", asset.name || asset.title || ""); if (next?.trim()) void patchAsset(asset, { name: next.trim() }); }}>Rename</button><button type="button" className={asset.favorite ? "active" : ""} onClick={() => void patchAsset(asset, { favorite: !asset.favorite })}>{asset.favorite ? "★" : "☆"}</button>{url ? <a href={url} download>Download</a> : null}<button type="button" className="danger" onClick={() => void deleteAsset(asset)}>Delete</button></div>
                <details className="sound-asset-more"><summary>Production actions</summary><div>{[
                  ["regenerate", "Regenerate"], ["variation", "Create variation"], [kind === "music" ? "save_ost" : "save_library", kind === "music" ? "Save as OST cue" : kind === "voice-design" ? "Save to Voice Library" : "Save to SFX Library"], ["attach_clip", "Attach to active clip"], ["place_playhead", "Place at playhead"], ["send_edit", "Send to Edit"], ["send_master", "Send to Master"], ["open_folder", "Open containing folder"]
                ].map(([action, label]) => <button type="button" key={action} disabled={!actionSupported(allowed, action)} title={actionSupported(allowed, action) ? "" : "This asset/profile did not advertise this action."} onClick={() => void runAssetAction(asset, action, { clipId: store.productionClipId || null, playheadFrame: store.playheadFrame ?? null })}>{label}</button>)}</div></details>
                {technicalError ? <details className="sound-technical-error"><summary>Technical details</summary><pre>{String(technicalError)}</pre></details> : null}
              </article>;
            }) : <div className="create-sound-empty"><span>{kind === "music" ? "♫" : kind === "voice-design" ? "◖◗" : "≋"}</span><h3>No {copy.title.toLowerCase()} assets yet</h3><p>{copy.empty}</p></div>}</div>
          </div>
        </section>
      </div>
      <WorkflowManagerDrawer open={managerOpen} onClose={() => setManagerOpen(false)} slug={slug} snapshot={snapshot} selectedProfile={selectedProfile} onRefresh={onRefresh} />
    </>
  );
}
