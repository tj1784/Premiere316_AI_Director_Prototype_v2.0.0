import { AUDIO_GENERATION_OPTIONS, audioGenerationOption } from "./audio-generation-catalog.ts";

export type VoiceEngineId = "qwen3-tts" | "qwen3-tts-base" | "voxcpm2" | "index-tts";
export type MusicEngineId = "minimax-music3" | "yue2" | "stable-audio-3" | "ace-step-1.5";

export function voiceEngineFromSelection(value: string | null | undefined): VoiceEngineId {
  if (value === "voxcpm" || value === "voxcpm2") return "voxcpm2";
  if (value === "index-tts" || value === "qwen3-tts-base") return value;
  return "qwen3-tts";
}

export function musicEngineFromSelection(value: string | null | undefined): MusicEngineId {
  if (value === "yue2" || value === "stable-audio-3" || value === "ace-step-1.5") return value;
  return "minimax-music3";
}

export function voiceRuntimeBlock(engineId: VoiceEngineId): string {
  return `${audioGenerationOption(engineId)?.name ?? engineId} is selected. Premiere316 has no verified local worker for this engine. Generate speech with its local workflow and import the audio. Direct generation stays fail-closed; no engine is substituted.`;
}

export function musicRuntimeBlock(engineId: MusicEngineId = "minimax-music3"): string {
  return `${audioGenerationOption(engineId)?.name ?? engineId} is selected. Premiere316 has no verified local worker for this engine. Generate with its local workflow and import the audio. Direct generation stays fail-closed; no engine is substituted.`;
}

export function audioEngineStatuses(): Array<{ id: string; role: "preferred-voice" | "alternate-voice" | "score"; status: "fail-closed"; detail: string }> {
  return AUDIO_GENERATION_OPTIONS.map((option) => ({
    id: option.id,
    role: option.slot === "music" ? "score" : option.id === "qwen3-tts" ? "preferred-voice" : "alternate-voice",
    status: "fail-closed",
    detail: option.slot === "music" ? musicRuntimeBlock(option.id as MusicEngineId) : voiceRuntimeBlock(option.id as VoiceEngineId),
  }));
}
