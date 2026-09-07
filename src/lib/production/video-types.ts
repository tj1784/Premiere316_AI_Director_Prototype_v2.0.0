import type { EnginePromptPackage } from "../studio/prompt-compiler.ts";
import type { VideoEngineId } from "../studio/generation-config.ts";

export type VideoTakeStatus = "QUEUED" | "RUNNING" | "FAILED" | "NEEDS_REVIEW" | "REJECTED" | "CANONICAL" | "CANCELLED";

export type VideoJobKind = "t2v" | "i2v" | "imported";
export type VideoOrigin = "fail-closed" | "imported" | "native-generated";

export type VideoProbe = {
  ok: boolean;
  durationSec: number | null;
  fps: number | null;
  frameCount: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  hasAudio: boolean;
  byteLength: number;
  error: string | null;
};

export type VideoTakeQC = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; message: string }>;
};

export type VideoTake = {
  id: string;
  jobId: string;
  shotId: string;
  pictureId: string;
  engineId: VideoEngineId;
  kind: VideoJobKind;
  origin?: VideoOrigin;
  filename?: string | null;
  status: VideoTakeStatus;
  createdAt: number;
  updatedAt: number;
  seed: number | null;
  promptPackageHash: string;
  mediaUri: string | null;
  mediaSha256: string | null;
  sidecarSha256: string | null;
  probe: VideoProbe | null;
  qc: VideoTakeQC | null;
  failClosedReason: string | null;
  reviewReason: string | null;
  canonical: boolean;
};

export type VideoJob = {
  id: string;
  pictureId: string;
  shotId: string;
  engineId: VideoEngineId;
  kind: VideoJobKind;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  promptPackage: EnginePromptPackage;
  takeIds: string[];
  error: string | null;
  priority: number;
};

export type VideoWorkspace = {
  schemaVersion: 1;
  jobs: VideoJob[];
  takes: VideoTake[];
  schedulerSnapshot: unknown;
};

export function emptyVideoWorkspace(): VideoWorkspace {
  return { schemaVersion: 1, jobs: [], takes: [], schedulerSnapshot: null };
}

export function hydrateVideoWorkspace(state: VideoWorkspace | null | undefined): VideoWorkspace {
  if (!state || state.schemaVersion !== 1) return emptyVideoWorkspace();
  return {
    schemaVersion: 1,
    jobs: Array.isArray(state.jobs) ? state.jobs : [],
    takes: Array.isArray(state.takes) ? state.takes.map((take) => ({ ...take, origin: take.origin ?? (take.mediaUri ? "imported" : "fail-closed") })) : [],
    schedulerSnapshot: state.schedulerSnapshot ?? null,
  };
}
