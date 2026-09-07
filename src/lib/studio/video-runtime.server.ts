import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VideoEngineId } from "./generation-config.ts";
import { videoRuntimeBlock } from "./video-runtime.ts";

const MODEL_ROOT = "D:\\AI\\Models";

export type VideoAdapterStatus = {
  engineId: VideoEngineId;
  displayName: string;
  status: "ADAPTER_UNAVAILABLE";
  disabledReason: string;
  presentWeights: string[];
  officialRuntime: false;
};

function present(relative: string): string | null {
  return existsSync(join(MODEL_ROOT, relative)) ? relative : null;
}

export function inspectVideoAdapter(engineId: VideoEngineId): VideoAdapterStatus {
  const presentWeights = engineId === "minimax-h3"
    ? [
      present("diffusion_models\\MiniMax-H3\\minimax_h3_fl2va_bf16.safetensors"),
      present("text_encoders\\MiniMax-H3\\qwen3vl_32b_minimax_h3_bf16.safetensors"),
      present("vae\\MiniMax-H3\\minimax_h3_video_vae_fp16.safetensors"),
    ].filter((item): item is string => Boolean(item))
    : [
      present("diffusion_models\\ltx-2.5-22b-dev.safetensors"),
      present("text_encoders\\gemma4-12b-with-proj-ltx-2.5-bf16.safetensors"),
      present("vae\\ltx-2.5-video-vae-bf16.safetensors"),
    ].filter((item): item is string => Boolean(item));
  return {
    engineId,
    displayName: engineId === "minimax-h3" ? "MiniMax H3" : "LTX 2.5",
    status: "ADAPTER_UNAVAILABLE",
    disabledReason: videoRuntimeBlock(engineId),
    presentWeights,
    officialRuntime: false,
  };
}

export function inspectVideoAdapters(): VideoAdapterStatus[] {
  return [inspectVideoAdapter("ltx-2"), inspectVideoAdapter("minimax-h3")];
}
