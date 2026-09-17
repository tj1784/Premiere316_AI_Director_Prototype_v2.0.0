import type { VideoEngineId } from "./generation-config.ts";

export function videoRuntimeBlock(engineId: VideoEngineId): string {
  if (engineId === "ltx-director") {
    return "Create and edit scene segments above, then approve the reviewed workflows for LTX Director API generation. Import finished videos here for take review.";
  }
  if (engineId === "minimax-h3") {
    return "Keyframe-conditioned H3 generation stays fail-closed. Use Render movie above for local text-to-video, or import an existing clip below.";
  }
  return "LTX 2.5 components may be catalogued, but Premiere316 has no official non-Comfy native LTX 2.5 worker. Comfy-converted transformers are not used. Video generation stays fail-closed.";
}
