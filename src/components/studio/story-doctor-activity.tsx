import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { storyDoctorRuns } from "@/lib/studio/story-doctor-runs";
import type { Picture } from "@/lib/studio/types";

export function StoryDoctorActivity({ picture }: { picture: Picture }) {
  const run = useSyncExternalStore(storyDoctorRuns.subscribe, () => storyDoctorRuns.get(picture.id), () => null);
  const [now, setNow] = useState(Date.now);
  const section = useRef<HTMLElement>(null);
  const running = run?.status === "running";
  const report = picture.screenplay.lastQaReport;
  useEffect(() => {
    if (!running) return;
    section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!run && !report) return null;
  const status = run?.status ?? "completed";
  const labels = { running: "Running", completed: "Completed", stopped: "Stopped", failed: "Failed" };
  const elapsed = run ? Math.max(0, Math.floor(((running ? now : run.updatedAt) - run.startedAt) / 1000)) : null;
  return <section ref={section} aria-label="Story Doctor activity" className="mb-4 grid gap-3 rounded-md border border-accent bg-inset p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold" role="status">Story Doctor — {labels[status]}</h3>{running ? <Button variant="rec" onClick={() => storyDoctorRuns.stop(picture.id)}>Stop Story Doctor</Button> : null}</div>
    <p className="break-all text-xs text-muted">{run?.model ?? report?.servedModelId}{elapsed !== null ? ` · ${elapsed}s elapsed` : ""}{running ? ` · Last activity ${Math.max(0, Math.floor((now - run.updatedAt) / 1000))}s ago` : ""}</p>
    {status === "completed" ? <p className="text-sm">Review complete{report ? ` · ${report.findings.length} findings saved at ${new Date(report.createdAt).toLocaleTimeString()}` : ""}. Your screenplay has not been rewritten.</p> : null}
    {status === "stopped" ? <p className="text-sm">Review stopped. Partial output is shown below; it has not been saved as a completed critique.</p> : null}
    {run?.error ? <p role="alert" className="text-sm text-rec">{run.error}</p> : null}
    {run ? <>
      <details open><summary className="text-sm">Local model reasoning · {run.reasoning.length.toLocaleString()} characters</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-elevated p-3 text-xs">{run.reasoning || (running ? "Waiting for reasoning reported by LM Studio…" : "No reasoning stream was returned for this run.")}</pre></details>
      <details open><summary className="text-sm">Live critique output · {run.text.length.toLocaleString()} characters</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-elevated p-3 text-xs">{run.text || (running ? "Waiting for critique output…" : "No critique output was returned.")}</pre></details>
    </> : <p className="text-xs text-muted">The earlier run did not save a reasoning stream. New reviews show it live here when LM Studio supplies it.</p>}
    {status === "completed" && report ? <div className="grid gap-2">{report.findings.map((finding, index) => <article key={index} className="rounded-md bg-elevated p-3 text-sm"><p className="font-medium">{finding.category} · {finding.severity}</p><p className="mt-1">{finding.summary}</p>{finding.recommendation ? <p className="mt-1 text-muted">{finding.recommendation}</p> : null}</article>)}</div> : null}
  </section>;
}
