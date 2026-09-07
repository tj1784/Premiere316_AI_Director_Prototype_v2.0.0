import type { EnginePromptPackage } from "./prompt-compiler.ts";
import type { VideoProbe } from "../production/video-types.ts";

export type VideoProvenance = {
  schemaVersion: 1;
  assetId: string;
  shotId: string;
  engineId: string;
  runtimeAdapter: string;
  runtimeImplementation: "unavailable";
  prompt: string;
  negativePrompt: string;
  durationSec: number;
  fps: number;
  seed: number | null;
  compiledAt: number;
  generatedAt: number;
  probe: VideoProbe | null;
  failClosedReason: string;
};

export function createFailClosedVideoProvenance(input: {
  shotId: string;
  pkg: EnginePromptPackage;
  reason: string;
  now?: number;
}): VideoProvenance {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: 1,
    assetId: input.shotId,
    shotId: input.shotId,
    engineId: input.pkg.engineTarget,
    runtimeAdapter: input.pkg.engineTarget,
    runtimeImplementation: "unavailable",
    prompt: input.pkg.enginePrompt,
    negativePrompt: input.pkg.negativePrompt,
    durationSec: input.pkg.durationSec,
    fps: input.pkg.fps,
    seed: input.pkg.seedPolicy.seed,
    compiledAt: input.pkg.provenance.compiledAt,
    generatedAt: now,
    probe: null,
    failClosedReason: input.reason,
  };
}
