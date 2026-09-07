import type { EnginePromptPackage } from "../studio/prompt-compiler.ts";
import { videoEngineFromSelection, type VideoEngineId } from "../studio/generation-config.ts";
import type { VideoJob, VideoProbe, VideoTake, VideoTakeQC, VideoWorkspace } from "./video-types.ts";
import { emptyVideoWorkspace } from "./video-types.ts";

export function promptPackageHash(pkg: EnginePromptPackage): string {
  const text = JSON.stringify(pkg);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pkg-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function enqueueVideoJob(workspace: VideoWorkspace, input: {
  pictureId: string;
  shotId: string;
  engineId?: VideoEngineId;
  selectedVideoEngine?: string;
  promptPackage: EnginePromptPackage;
  kind?: VideoJob["kind"];
  priority?: number;
  now?: number;
}): VideoWorkspace {
  const now = input.now ?? Date.now();
  const engineId = input.engineId ?? videoEngineFromSelection(input.selectedVideoEngine ?? input.promptPackage.engineTarget);
  if (workspace.jobs.some((job) => job.id === `videojob:${input.shotId}:${now}`)) throw new Error("Video job id collision.");
  const job: VideoJob = {
    id: `videojob:${input.shotId}:${now}`,
    pictureId: input.pictureId,
    shotId: input.shotId,
    engineId,
    kind: input.kind ?? (input.promptPackage.referenceAssets.length ? "i2v" : "t2v"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    promptPackage: input.promptPackage,
    takeIds: [],
    error: null,
    priority: input.priority ?? 100,
  };
  return { ...workspace, jobs: [...workspace.jobs, job], takes: workspace.takes };
}

export function cancelVideoJob(workspace: VideoWorkspace, jobId: string, now = Date.now()): VideoWorkspace {
  return {
    ...workspace,
    jobs: workspace.jobs.map((job) => job.id === jobId && (job.status === "queued" || job.status === "running")
      ? { ...job, status: "cancelled", updatedAt: now, error: "Cancelled by user." }
      : job),
    takes: workspace.takes.map((take) => take.jobId === jobId && take.status === "QUEUED"
      ? { ...take, status: "CANCELLED", updatedAt: now, failClosedReason: "Job cancelled." }
      : take),
  };
}

export function failClosedVideoJob(workspace: VideoWorkspace, jobId: string, reason: string, now = Date.now()): VideoWorkspace {
  const job = workspace.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error("Video job not found.");
  const takeId = `videotake:${job.shotId}:${now}`;
  const take: VideoTake = {
    id: takeId,
    jobId,
    shotId: job.shotId,
    pictureId: job.pictureId,
    engineId: job.engineId,
    kind: job.kind,
    status: "FAILED",
    createdAt: now,
    updatedAt: now,
    seed: job.promptPackage.seedPolicy.seed,
    promptPackageHash: promptPackageHash(job.promptPackage),
    mediaUri: null,
    mediaSha256: null,
    sidecarSha256: null,
    probe: null,
    qc: inspectVideoTakeQC({ expectedDurationSec: job.promptPackage.durationSec, expectedFps: job.promptPackage.fps, probe: null, mediaSha256: null, provenancePresent: false, authorityFresh: true, tokenUnused: true }),
    failClosedReason: reason,
    reviewReason: null,
    canonical: false,
  };
  return {
    ...workspace,
    jobs: workspace.jobs.map((item) => item.id === jobId ? { ...item, status: "failed", updatedAt: now, error: reason, takeIds: [...item.takeIds, takeId] } : item),
    takes: [...workspace.takes, take],
  };
}

export function inspectVideoTakeQC(input: {
  expectedDurationSec: number;
  expectedFps: number;
  probe: VideoProbe | null;
  mediaSha256: string | null;
  provenancePresent: boolean;
  authorityFresh: boolean;
  tokenUnused: boolean;
}): VideoTakeQC {
  const checks = [
    { id: "probe", ok: Boolean(input.probe?.ok), message: input.probe?.ok ? "Media probe succeeded." : "No valid media probe; video was not produced." },
    { id: "duration", ok: input.probe?.durationSec == null ? false : Math.abs(input.probe.durationSec - input.expectedDurationSec) <= 0.5, message: "Duration must match compiled spec within 0.5s." },
    { id: "fps", ok: input.probe?.fps === input.expectedFps, message: `Expected ${input.expectedFps} fps.` },
    { id: "frames", ok: Boolean(input.probe?.frameCount && input.probe.frameCount > 0), message: "Frame count must be greater than zero." },
    { id: "size", ok: Boolean(input.probe?.byteLength && input.probe.byteLength > 1024), message: "File must be a nonzero video, not a still or empty fixture." },
    { id: "hash", ok: Boolean(input.mediaSha256 && /^[a-f0-9]{64}$/.test(input.mediaSha256)), message: "SHA-256 of durable media is required." },
    { id: "provenance", ok: input.provenancePresent, message: "Video provenance sidecar is required." },
    { id: "authority", ok: input.authorityFresh, message: "Generation authority must be current." },
    { id: "token", ok: input.tokenUnused, message: "Generation token must be one-use." },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

export function reviewVideoTake(workspace: VideoWorkspace, takeId: string, decision: "reject" | "canonical", reason: string, now = Date.now()): VideoWorkspace {
  const take = workspace.takes.find((item) => item.id === takeId);
  if (!take) throw new Error("Video take not found.");
  if (take.status === "FAILED" || take.status === "CANCELLED") throw new Error("Failed or cancelled takes cannot become canonical.");
  if (decision === "canonical" && !take.mediaSha256) throw new Error("Canonical video approval requires durable media.");
  if (decision === "canonical") {
    return {
      ...workspace,
      takes: workspace.takes.map((item) => item.shotId === take.shotId
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

export function shotVideoReadiness(workspace: VideoWorkspace, shotId: string): "MISSING" | "QUEUED" | "FAILED" | "NEEDS_REVIEW" | "CANONICAL" {
  const takes = workspace.takes.filter((take) => take.shotId === shotId);
  if (takes.some((take) => take.canonical && take.status === "CANONICAL")) return "CANONICAL";
  if (takes.some((take) => take.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (workspace.jobs.some((job) => job.shotId === shotId && (job.status === "queued" || job.status === "running"))) return "QUEUED";
  if (takes.some((take) => take.status === "FAILED")) return "FAILED";
  return "MISSING";
}

export function restoreVideoWorkspace(workspace: VideoWorkspace | null | undefined): VideoWorkspace {
  const hydrated = workspace && workspace.schemaVersion === 1 ? workspace : emptyVideoWorkspace();
  return {
    ...hydrated,
    jobs: hydrated.jobs.map((job) => job.status === "running" ? { ...job, status: "queued", error: "Recovered after restart; running job was re-queued instead of duplicated.", updatedAt: job.updatedAt } : job),
  };
}
