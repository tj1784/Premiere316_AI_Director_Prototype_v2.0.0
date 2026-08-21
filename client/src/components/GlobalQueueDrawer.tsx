import React from "react";
import { useStore } from "../store";

function jobTime(job: any) {
  const value = job.finishedAt || job.startedAt || job.createdAt;
  return value ? new Date(value).toLocaleTimeString() : "—";
}

function jobStatusLabel(status: unknown) {
  const value = String(status || "queued");
  return value === "awaiting_review" ? "awaiting review" : value;
}

export default function GlobalQueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  if (!open) return null;
  const jobs = [...store.jobs].sort((left: any, right: any) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 50);
  const upstreamRunning = Number(store.health.comfyQueue?.running || 0);
  const upstreamPending = Number(store.health.comfyQueue?.pending || 0);

  return (
    <aside className="global-queue-drawer" aria-label="Global generation queue">
      <header><div><span className="workspace-eyebrow">SHARED RUNTIME</span><h2>Generation Queue</h2></div><button className="icon-button" aria-label="Close generation queue" onClick={onClose}>×</button></header>
      <section className="queue-upstream-summary"><div><b>ComfyUI upstream</b><span>{upstreamRunning} running · {upstreamPending} waiting</span></div><small>Manual ComfyUI jobs appear in this total; Premiere316-owned jobs are itemized below.</small></section>
      <section className="queue-job-list">
        {jobs.length ? jobs.map((job: any) => {
          const active = ["queued", "running", "cancelling"].includes(job.status);
          const readOnly = job.refs?.readOnly === true;
          return <article key={job.id} className={`queue-job ${job.status}`}><div><span className={`status-chip ${job.status}`}>{jobStatusLabel(job.status)}</span><time>{jobTime(job)}</time></div><h3>{job.label || job.type}</h3><p>{job.stage || job.error || job.type}</p><small>{job.projectSlug || "Shared service"} · {job.id}{readOnly ? " · externally managed" : ""}</small>{active && !readOnly ? <button className="button danger" disabled={job.status === "cancelling"} onClick={() => void store.cancelJob(job.id)}>{job.status === "cancelling" ? "Stopping…" : "Stop job"}</button> : null}</article>;
        }) : <div className="workspace-empty"><p>No Premiere316 generation jobs in this session.</p></div>}
      </section>
    </aside>
  );
}
