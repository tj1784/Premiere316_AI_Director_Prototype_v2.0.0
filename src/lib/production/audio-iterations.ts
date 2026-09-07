import type { Cue, Picture, VoiceTake } from "../studio/types.ts";
import { musicRuntimeBlock, voiceEngineFromSelection, voiceRuntimeBlock, type VoiceEngineId } from "../studio/audio-runtime.ts";
import type { AudioJob, AudioKind, AudioTake, AudioTakeQC, AudioWorkspace, DialogueLine, SoundCueRecord, VoiceProfile } from "./audio-types.ts";
import { emptyAudioWorkspace } from "./audio-types.ts";

export function inspectAudioTakeQC(input: {
  probe: AudioWorkspace["takes"][number]["probe"];
  mediaSha256: string | null;
  origin: AudioTake["origin"];
}): AudioTakeQC {
  const checks = [
    { id: "exists", ok: Boolean(input.probe?.byteLength && input.probe.byteLength > 0), message: "Audio file must exist and be nonzero." },
    { id: "probe", ok: Boolean(input.probe?.ok), message: input.probe?.ok ? "Audio probe succeeded." : "No valid audio probe; generation did not produce audio." },
    { id: "duration", ok: Boolean(input.probe?.durationSec && input.probe.durationSec > 0), message: "Duration must be greater than zero." },
    { id: "hash", ok: Boolean(input.mediaSha256 && /^[a-f0-9]{64}$/.test(input.mediaSha256)), message: "SHA-256 of durable audio is required." },
    { id: "origin", ok: input.origin === "imported" || Boolean(input.probe?.ok), message: "Fail-closed generated audio cannot satisfy canonical." },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

export function segmentDialogue(picture: Picture, now = Date.now()): DialogueLine[] {
  const fromVoices: DialogueLine[] = picture.voices.map((voice: VoiceTake, index) => ({
    id: `line:${voice.id}`,
    pictureId: picture.id,
    characterId: picture.characters.find((character) => character.name === voice.character)?.id ?? null,
    characterName: voice.character,
    sceneId: picture.scenes[Math.min(index, picture.scenes.length - 1)]?.id ?? null,
    shotId: picture.shots[Math.min(index, picture.shots.length - 1)]?.id ?? null,
    text: voice.text.slice(0, 800),
    targetDurationSec: Math.min(20, Math.max(2, Math.ceil(voice.text.split(/\s+/).length / 2.4))),
    emotion: picture.shots[Math.min(index, picture.shots.length - 1)]?.emotion ?? "restrained",
    delivery: "close-mic, dry room",
    pronunciation: "",
  }));
  if (fromVoices.length) return fromVoices;
  return picture.characters.slice(0, 8).map((character, index) => ({
    id: `line:${character.id}:${now}`,
    pictureId: picture.id,
    characterId: character.id,
    characterName: character.name,
    sceneId: picture.scenes[0]?.id ?? null,
    shotId: picture.shots[0]?.id ?? null,
    text: picture.scenes[index]?.emotionalBeat || character.arc,
    targetDurationSec: 8,
    emotion: "restrained",
    delivery: "natural",
    pronunciation: "",
  }));
}

export function seedVoiceProfiles(picture: Picture): VoiceProfile[] {
  const engineId = voiceEngineFromSelection(picture.selectedEngine.voice);
  return picture.characters.map((character) => ({
    id: `voice:${character.id}`,
    characterId: character.id,
    characterName: character.name,
    engineId,
    notes: character.voiceId ? `Legacy voice id ${character.voiceId}` : "Unassigned local voice.",
  }));
}

export function seedSoundCues(picture: Picture): SoundCueRecord[] {
  return picture.cues.map((cue: Cue) => ({
    id: cue.id,
    name: cue.name,
    kind: "score" as AudioKind,
    startSec: cue.startSec,
    durationSec: cue.durationSec,
    sceneId: null,
    shotId: null,
    notes: `${cue.mood}. ${cue.sfx}`,
    instrumentation: cue.instruments,
  }));
}

export function hydratePictureAudio(picture: Picture): AudioWorkspace {
  const current = picture.audio && picture.audio.schemaVersion === 1 ? picture.audio : emptyAudioWorkspace();
  return {
    schemaVersion: 1,
    lines: current.lines.length ? current.lines : segmentDialogue(picture),
    profiles: current.profiles.length ? current.profiles : seedVoiceProfiles(picture),
    jobs: current.jobs,
    takes: current.takes,
    cues: current.cues.length ? current.cues : seedSoundCues(picture),
  };
}

export function enqueueAudioJob(workspace: AudioWorkspace, input: {
  pictureId: string;
  kind: AudioKind;
  engineId: AudioJob["engineId"];
  lineId?: string | null;
  cueId?: string | null;
  now?: number;
}): AudioWorkspace {
  const now = input.now ?? Date.now();
  const job: AudioJob = {
    id: `audiojob:${input.kind}:${input.lineId ?? input.cueId ?? "batch"}:${now}`,
    pictureId: input.pictureId,
    lineId: input.lineId ?? null,
    cueId: input.cueId ?? null,
    kind: input.kind,
    engineId: input.engineId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    takeIds: [],
    error: null,
  };
  return { ...workspace, jobs: [...workspace.jobs, job] };
}

export function failClosedAudioJob(workspace: AudioWorkspace, jobId: string, reason: string, now = Date.now()): AudioWorkspace {
  const job = workspace.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error("Audio job not found.");
  const take: AudioTake = {
    id: `audiotake:${job.id}`,
    jobId: job.id,
    pictureId: job.pictureId,
    lineId: job.lineId,
    cueId: job.cueId,
    shotId: null,
    sceneId: null,
    characterName: workspace.lines.find((line) => line.id === job.lineId)?.characterName ?? null,
    kind: job.kind,
    origin: "fail-closed",
    engineId: job.engineId,
    status: "FAILED",
    createdAt: now,
    updatedAt: now,
    mediaUri: null,
    mediaSha256: null,
    filename: null,
    probe: null,
    qc: inspectAudioTakeQC({ probe: null, mediaSha256: null, origin: "fail-closed" }),
    failClosedReason: reason,
    reviewReason: null,
    canonical: false,
  };
  return {
    ...workspace,
    jobs: workspace.jobs.map((item) => item.id === jobId ? { ...item, status: "failed", updatedAt: now, error: reason, takeIds: [...item.takeIds, take.id] } : item),
    takes: [...workspace.takes, take],
  };
}

export function queueMissingDialogue(picture: Picture, now = Date.now()): AudioWorkspace {
  let workspace = hydratePictureAudio(picture);
  const engineId = voiceEngineFromSelection(picture.selectedEngine.voice);
  const reason = voiceRuntimeBlock(engineId);
  for (const line of workspace.lines) {
    if (workspace.takes.some((take) => take.lineId === line.id && (take.status === "CANONICAL" || take.origin === "imported"))) continue;
    workspace = enqueueAudioJob(workspace, { pictureId: picture.id, kind: "dialogue", engineId, lineId: line.id, now: now + workspace.jobs.length });
    workspace = failClosedAudioJob(workspace, workspace.jobs[workspace.jobs.length - 1].id, reason, now + workspace.jobs.length);
  }
  return workspace;
}

export function queueMissingScore(picture: Picture, now = Date.now()): AudioWorkspace {
  let workspace = hydratePictureAudio(picture);
  const reason = musicRuntimeBlock();
  for (const cue of workspace.cues) {
    if (workspace.takes.some((take) => take.cueId === cue.id && (take.status === "CANONICAL" || take.origin === "imported"))) continue;
    workspace = enqueueAudioJob(workspace, { pictureId: picture.id, kind: "score", engineId: "minimax-music3", cueId: cue.id, now: now + workspace.jobs.length });
    workspace = failClosedAudioJob(workspace, workspace.jobs[workspace.jobs.length - 1].id, reason, now + workspace.jobs.length);
  }
  return workspace;
}

export function recordImportedAudioTake(workspace: AudioWorkspace, input: {
  pictureId: string;
  kind: AudioKind;
  filename: string;
  mediaUri: string;
  mediaSha256: string;
  byteLength: number;
  durationSec: number;
  sampleRate?: number | null;
  channels?: number | null;
  format?: string | null;
  lineId?: string | null;
  cueId?: string | null;
  shotId?: string | null;
  now?: number;
}): AudioWorkspace {
  if (!/^[a-f0-9]{64}$/.test(input.mediaSha256)) throw new Error("Imported audio requires a SHA-256.");
  if (input.byteLength <= 0) throw new Error("Imported audio must be a nonzero file.");
  const now = input.now ?? Date.now();
  const probe = {
    ok: true,
    durationSec: input.durationSec,
    sampleRate: input.sampleRate ?? null,
    channels: input.channels ?? null,
    format: input.format ?? null,
    byteLength: input.byteLength,
    error: null,
  };
  const take: AudioTake = {
    id: `audiotake:import:${now}`,
    jobId: null,
    pictureId: input.pictureId,
    lineId: input.lineId ?? null,
    cueId: input.cueId ?? null,
    shotId: input.shotId ?? null,
    sceneId: null,
    characterName: workspace.lines.find((line) => line.id === input.lineId)?.characterName ?? null,
    kind: input.kind,
    origin: "imported",
    engineId: "imported",
    status: "NEEDS_REVIEW",
    createdAt: now,
    updatedAt: now,
    mediaUri: input.mediaUri,
    mediaSha256: input.mediaSha256,
    filename: input.filename,
    probe,
    qc: inspectAudioTakeQC({ probe, mediaSha256: input.mediaSha256, origin: "imported" }),
    failClosedReason: null,
    reviewReason: null,
    canonical: false,
  };
  return { ...workspace, takes: [...workspace.takes, take] };
}

export function reviewAudioTake(workspace: AudioWorkspace, takeId: string, decision: "reject" | "canonical", reason: string, now = Date.now()): AudioWorkspace {
  const take = workspace.takes.find((item) => item.id === takeId);
  if (!take) throw new Error("Audio take not found.");
  if (decision === "canonical") {
    if (take.origin !== "imported") throw new Error("Canonical audio approval requires imported durable media until a native TTS/Music runtime exists.");
    if (!take.mediaSha256 || !take.probe?.ok) throw new Error("Canonical audio approval requires probed durable media.");
    return {
      ...workspace,
      takes: workspace.takes.map((item) => bindKey(item) === bindKey(take)
        ? item.id === takeId
          ? { ...item, status: "CANONICAL", canonical: true, reviewReason: reason, updatedAt: now }
          : item.canonical
            ? { ...item, canonical: false, status: item.status === "CANONICAL" ? "NEEDS_REVIEW" : item.status, updatedAt: now }
            : item
        : item),
    };
  }
  return {
    ...workspace,
    takes: workspace.takes.map((item) => item.id === takeId ? { ...item, status: "REJECTED", canonical: false, reviewReason: reason, updatedAt: now } : item),
  };
}

function bindKey(take: AudioTake): string {
  return take.lineId ?? take.cueId ?? take.id;
}

export function restoreAudioWorkspace(workspace: AudioWorkspace | null | undefined): AudioWorkspace {
  const hydrated = workspace && workspace.schemaVersion === 1 ? workspace : emptyAudioWorkspace();
  return {
    ...hydrated,
    jobs: hydrated.jobs.map((job) => job.status === "running"
      ? { ...job, status: "queued" as const, error: "Recovered after restart; running audio job was re-queued instead of duplicated.", updatedAt: job.updatedAt }
      : job),
  };
}
