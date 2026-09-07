import type { MusicEngineId, VoiceEngineId } from "../studio/audio-runtime.ts";

export type AudioTakeStatus = "QUEUED" | "RUNNING" | "FAILED" | "NEEDS_REVIEW" | "REJECTED" | "CANONICAL" | "CANCELLED";
export type AudioKind = "dialogue" | "foley" | "ambience" | "room-tone" | "impact" | "creature" | "environment" | "transition" | "score" | "silence";
export type AudioOrigin = "fail-closed" | "imported";

export type AudioProbe = {
  ok: boolean;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  format: string | null;
  byteLength: number;
  error: string | null;
};

export type AudioTakeQC = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; message: string }>;
};

export type DialogueLine = {
  id: string;
  pictureId: string;
  characterId: string | null;
  characterName: string;
  sceneId: string | null;
  shotId: string | null;
  text: string;
  targetDurationSec: number;
  emotion: string;
  delivery: string;
  pronunciation: string;
};

export type VoiceProfile = {
  id: string;
  characterId: string | null;
  characterName: string;
  engineId: VoiceEngineId;
  notes: string;
};

export type AudioTake = {
  id: string;
  jobId: string | null;
  pictureId: string;
  lineId: string | null;
  cueId: string | null;
  shotId: string | null;
  sceneId: string | null;
  characterName: string | null;
  kind: AudioKind;
  origin: AudioOrigin;
  engineId: VoiceEngineId | MusicEngineId | "imported";
  status: AudioTakeStatus;
  createdAt: number;
  updatedAt: number;
  mediaUri: string | null;
  mediaSha256: string | null;
  filename: string | null;
  probe: AudioProbe | null;
  qc: AudioTakeQC | null;
  failClosedReason: string | null;
  reviewReason: string | null;
  canonical: boolean;
};

export type AudioJob = {
  id: string;
  pictureId: string;
  lineId: string | null;
  cueId: string | null;
  kind: AudioKind;
  engineId: VoiceEngineId | MusicEngineId;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  takeIds: string[];
  error: string | null;
};

export type SoundCueRecord = {
  id: string;
  name: string;
  kind: AudioKind;
  startSec: number;
  durationSec: number;
  sceneId: string | null;
  shotId: string | null;
  notes: string;
  instrumentation: string;
};

export type AudioWorkspace = {
  schemaVersion: 1;
  lines: DialogueLine[];
  profiles: VoiceProfile[];
  jobs: AudioJob[];
  takes: AudioTake[];
  cues: SoundCueRecord[];
};

export function emptyAudioWorkspace(): AudioWorkspace {
  return { schemaVersion: 1, lines: [], profiles: [], jobs: [], takes: [], cues: [] };
}

export function hydrateAudioWorkspace(state: AudioWorkspace | null | undefined): AudioWorkspace {
  if (!state || state.schemaVersion !== 1) return emptyAudioWorkspace();
  return {
    schemaVersion: 1,
    lines: Array.isArray(state.lines) ? state.lines : [],
    profiles: Array.isArray(state.profiles) ? state.profiles : [],
    jobs: Array.isArray(state.jobs) ? state.jobs : [],
    takes: Array.isArray(state.takes) ? state.takes : [],
    cues: Array.isArray(state.cues) ? state.cues : [],
  };
}
