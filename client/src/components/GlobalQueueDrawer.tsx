import React from "react";
import { useStore } from "../store";
import { openAssetAction, type AssetActionIntent } from "../contextual-agency";

function jobTime(job: any) {
  const value = job.finishedAt || job.startedAt || job.createdAt;
  return value ? new Date(value).toLocaleTimeString() : "—";
}

function jobStatusLabel(status: unknown) {
  const value = String(status || "queued");
  return value === "awaiting_review" ? "awaiting review" : value;
}

function intentFromJob(job: any): AssetActionIntent {
  if (job.intent?.sourceEntity && job.intent?.requirement) return job.intent;
  return {
    sourceRoute: job.refs?.sourceRoute || "/comfy",
    sourceEntity: { type: "sequence", id: String(job.id), label: String(job.label || job.type || "Job") },
    requirement: { relationship: job.refs?.relationship || "comfy.job", category: "atmosphere" },
    initialAction: ["error", "failed"].includes(String(job.status || "").toLowerCase()) ? "generate" : "review",
    slotState: ["error", "failed"].includes(String(job.status || "").toLowerCase()) ? "broken" : "planned",
    returnFocusId: `nav-003-${job.id}`
  };
}

export default function GlobalQueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  if (!open) return null;
  const jobs = [...store.jobs].sort((left: any, right: any) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 50);
  const upstreamRunning = Number(store.health.comfyQueue?.running || 0);
  const upstreamPending = Number(store.health.comfyQueue?.pending || 0);
  const active = jobs.filter((job: any) => ["queued", "running", "cancelling"].includes(job.status));

  return (
    <aside className="global-queue-drawer" aria-label="Global generation queue">
      <header><div><span className="workspace-eyebrow">SHARED RUNTIME</span><h2>Generation Queue</h2></div><button className="icon-button" aria-label="Close generation queue" onClick={onClose}>×</button></header>
      <section className="queue-upstream-summary"><div><b>ComfyUI upstream</b><span>{upstreamRunning} running · {upstreamPending} waiting</span></div><small>Manual ComfyUI jobs appear in this total; Premiere316-owned jobs are itemized below.</small></section>
      <section className="queue-job-list">
        {jobs.length ? jobs.map((job: any) => {
          const isActive = ["queued", "running", "cancelling"].includes(job.status);
          const failed = ["error", "failed"].includes(String(job.status || "").toLowerCase());
          const readOnly = job.refs?.readOnly === true;
          const position = isActive ? active.findIndex((item: any) => item.id === job.id) + 1 : 0;
          const progress = job.progress != null ? `${Math.round(Number(job.progress))}%` : job.stage || jobStatusLabel(job.status);
          return (
            <article key={job.id} className={`queue-job ${job.status}`} data-testid={`nav-003-${job.id}`}>
              <div>
                <span className={`status-chip ${job.status}`}>{jobStatusLabel(job.status)}</span>
                <time>{jobTime(job)}</time>
                {position ? <small data-testid="nav-022-position">#{position} of {active.length} · {progress}</small> : <small data-testid="nav-022-position">{progress}</small>}
              </div>
              <h3>{job.label || job.type}</h3>
              <p>{job.stage || job.error || job.type}</p>
              <small>{job.projectSlug || "Shared service"} · {job.id}{readOnly ? " · externally managed" : ""}</small>
              <div className="queue-job-actions">
                <button type="button" className="button secondary" onClick={() => openAssetAction(intentFromJob(job))}>Reopen slot</button>
                {failed ? <button type="button" className="button secondary" data-testid={`nav-019-${job.id}`} onClick={() => openAssetAction({ ...intentFromJob(job), initialAction: "generate" })}>Retry</button> : null}
                {isActive && !readOnly ? <button className="button danger" disabled={job.status === "cancelling"} onClick={() => void store.cancelJob(job.id)}>{job.status === "cancelling" ? "Stopping…" : "Stop job"}</button> : null}
              </div>
            </article>
          );
        }) : <div className="workspace-empty"><p>No Premiere316 generation jobs in this session.</p></div>}
      </section>
    </aside>
  );
}
