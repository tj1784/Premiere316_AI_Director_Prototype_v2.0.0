import type { VideoEngineId } from "./generation-config.ts";

export function videoRuntimeBlock(engineId: VideoEngineId): string {
  if (engineId === "minimax-h3") {
    return "MiniMax H3 weights may be present locally, but no app-owned official native H3 runtime is wired. Comfy-named checkpoints and port 8188 are not an accepted Generate path. Video generation stays fail-closed.";
  }
  return "LTX 2.5 components may be catalogued, but Premiere316 has no official non-Comfy native LTX 2.5 worker. Comfy-converted transformers are not used. Video generation stays fail-closed.";
}
