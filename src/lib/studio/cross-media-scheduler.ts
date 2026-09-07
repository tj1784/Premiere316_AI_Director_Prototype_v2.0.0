export type SchedulerJobKind = "llm" | "image" | "video" | "audio";
export type SchedulerJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type SchedulerJob = {
  id: string;
  kind: SchedulerJobKind;
  pictureId: string;
  label: string;
  engineId: string;
  priority: number;
  createdAt: number;
  updatedAt: number;
  status: SchedulerJobStatus;
  dependsOn: string[];
  error: string | null;
  vramHintBytes: number;
};

export type SchedulerSnapshot = {
  schemaVersion: 1;
  jobs: SchedulerJob[];
  protectedProcessNames: string[];
  lastRecoveredAt: number | null;
};

export const PROTECTED_PROCESS_NAMES = ["LM Studio", "lms.exe", "python.exe"] as const;

export function emptySchedulerSnapshot(): SchedulerSnapshot {
  return { schemaVersion: 1, jobs: [], protectedProcessNames: [...PROTECTED_PROCESS_NAMES], lastRecoveredAt: null };
}

export function enqueueSchedulerJob(snapshot: SchedulerSnapshot, job: Omit<SchedulerJob, "status" | "updatedAt" | "error">): SchedulerSnapshot {
  if (snapshot.jobs.some((item) => item.id === job.id)) throw new Error("Scheduler job id already exists.");
  const next: SchedulerJob = { ...job, status: "queued", updatedAt: job.createdAt, error: null };
  return { ...snapshot, jobs: [...snapshot.jobs, next] };
}

export function schedulerQueueOrder(snapshot: SchedulerSnapshot): SchedulerJob[] {
  const completed = new Set(snapshot.jobs.filter((job) => job.status === "completed").map((job) => job.id));
  return snapshot.jobs
    .filter((job) => job.status === "queued")
    .filter((job) => job.dependsOn.every((id) => completed.has(id)))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

export function startNextSchedulerJob(snapshot: SchedulerSnapshot, now = Date.now()): SchedulerSnapshot {
  if (snapshot.jobs.some((job) => job.status === "running")) return snapshot;
  const next = schedulerQueueOrder(snapshot)[0];
  if (!next) return snapshot;
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => job.id === next.id ? { ...job, status: "running", updatedAt: now } : job),
  };
}

export function completeSchedulerJob(snapshot: SchedulerSnapshot, jobId: string, ok: boolean, error: string | null, now = Date.now()): SchedulerSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => job.id === jobId && job.status === "running"
      ? { ...job, status: ok ? "completed" : "failed", error, updatedAt: now }
      : job),
  };
}

export function cancelSchedulerJob(snapshot: SchedulerSnapshot, jobId: string, now = Date.now()): SchedulerSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => job.id === jobId && job.status !== "completed"
      ? { ...job, status: "cancelled", error: "Cancelled by user.", updatedAt: now }
      : job),
  };
}

export function recoverSchedulerSnapshot(snapshot: SchedulerSnapshot | null | undefined, now = Date.now()): SchedulerSnapshot {
  const base = snapshot && snapshot.schemaVersion === 1 ? snapshot : emptySchedulerSnapshot();
  return {
    ...base,
    protectedProcessNames: [...PROTECTED_PROCESS_NAMES],
    lastRecoveredAt: now,
    jobs: base.jobs.map((job) => job.status === "running"
      ? { ...job, status: "queued", error: "Recovered after restart without duplicate execution.", updatedAt: now }
      : job),
  };
}

export function schedulerMustNotKill(processName: string): boolean {
  const value = processName.toLowerCase();
  return PROTECTED_PROCESS_NAMES.some((name) => value.includes(name.toLowerCase())) || value.includes("comfy") || value.includes("8188");
}
