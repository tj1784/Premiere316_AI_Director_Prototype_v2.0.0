export type VoiceEngineId = "qwen3-tts" | "voxcpm2" | "index-tts";
export type MusicEngineId = "minimax-music3";

export function voiceEngineFromSelection(value: string | null | undefined): VoiceEngineId {
  if (value === "voxcpm" || value === "voxcpm2") return "voxcpm2";
  if (value === "index-tts") return "index-tts";
  return "qwen3-tts";
}

export function voiceRuntimeBlock(engineId: VoiceEngineId): string {
  if (engineId === "voxcpm2") {
    return "VoxCPM2 may exist as local weights, but Premiere316 has no app-owned official VoxCPM2 runtime. Cloud TTS, ElevenLabs, OpenAI audio, and IndexTTS substitution are forbidden. Voice generation stays fail-closed.";
  }
  if (engineId === "index-tts") {
    return "IndexTTS is catalogued only. It is not an accepted Wave 6 Generate path and is never a silent substitute for Qwen3-TTS. Voice generation stays fail-closed.";
  }
  return "Qwen3-TTS is the preferred local voice engine, but no app-owned official native Qwen3-TTS worker is verified. No cloud TTS fallback. Voice generation stays fail-closed.";
}

export function musicRuntimeBlock(_engineId: MusicEngineId = "minimax-music3"): string {
  return "MiniMax Music3 is not a verified local Premiere316 runtime. Score generation stays fail-closed. Import or write cue metadata instead. No cloud music fallback.";
}

export function audioEngineStatuses(): Array<{ id: string; role: "preferred-voice" | "alternate-voice" | "score"; status: "fail-closed"; detail: string }> {
  return [
    { id: "qwen3-tts", role: "preferred-voice", status: "fail-closed", detail: voiceRuntimeBlock("qwen3-tts") },
    { id: "voxcpm2", role: "alternate-voice", status: "fail-closed", detail: voiceRuntimeBlock("voxcpm2") },
    { id: "minimax-music3", role: "score", status: "fail-closed", detail: musicRuntimeBlock() },
  ];
}
