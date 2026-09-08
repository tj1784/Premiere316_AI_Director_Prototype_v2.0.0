import { useEffect, useRef, useState } from "react";
import type { MoviePlanProgress } from "@/lib/studio/movie-plan-stream.ts";
import type { InternalPhase } from "@/lib/studio/product-flow.ts";

const PHASES: Record<InternalPhase, { label: string; purpose: string }> = {
  research: { label: "Research Bible", purpose: "Developing the story world, characters, source context, and visual direction from your idea." },
  screenplay: { label: "Screenplay", purpose: "Writing scenes and dialogue from the idea and Research Bible." },
  screenplayQa: { label: "Screenplay QA", purpose: "Reviewing the screenplay in a separate context for continuity, pacing, and source drift." },
  breakdown: { label: "Assets", purpose: "Extracting characters, locations, props, wardrobe, and other production needs." },
  visualDevelopment: { label: "Visual development", purpose: "Developing the palette, motifs, and visual intent." },
  cinematography: { label: "Cinematography", purpose: "Planning camera language, lighting, and movement." },
  performance: { label: "Performance", purpose: "Developing performance and staging notes for the screenplay." },
  shots: { label: "Shots", purpose: "Planning the shots that will carry the story." },
  promptLab: { label: "Prompt preparation", purpose: "Preparing prompts from the generated plan." },
};

export function MoviePlanActivity({ events, startedAt, running }: { events: MoviePlanProgress[]; startedAt: number; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<InternalPhase | "current">("current");
  const [follow, setFollow] = useState(true);
  const output = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running]);
  const latest = events.at(-1);
  const active = selected === "current" ? latest : events.find((event) => event.phase === selected) ?? latest;
  useEffect(() => {
    if (follow && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [active?.text, follow]);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <section className="grid gap-3 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]" aria-label="Live movie plan activity" data-movie-plan-activity="true">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{running ? "Live model activity" : "Last model activity"}</h3>
      <span className="text-xs tabular-nums text-muted">{Math.floor(elapsed / 60)}m {elapsed % 60}s · {active?.text.length ?? 0} characters</span>
    </div>
    <p className="text-xs text-muted" role="status">{active ? `${PHASES[active.phase].label} · ${active.status === "completed" ? "output received" : active.status} · ${active.model}` : running ? "Checking the configured local model…" : "No model output was generated."}</p>
    {active ? <p className="text-sm">{PHASES[active.phase].purpose}</p> : null}
    {events.length > 1 ? <label className="grid gap-1 text-xs text-muted">View phase
      <select className="h-11 rounded-md bg-inset px-3 text-sm text-fg" value={selected} onChange={(event) => setSelected(event.target.value as InternalPhase | "current")}>
        <option value="current">Current phase</option>
        {events.map((event) => <option key={event.phase} value={event.phase}>{PHASES[event.phase].label} · {event.status}</option>)}
      </select>
    </label> : null}
    <p className="text-xs text-muted">Live draft output from the local model. Its format is validated before saving. Story QA runs only when enabled.</p>
    <pre ref={output} className="max-h-72 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset p-3 font-mono text-xs leading-relaxed text-fg" data-model-output="true">{active?.text || (running ? "Waiting for the first output text…" : "No output text.")}</pre>
    <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Follow new output</label>
    {active?.message ? <p role="alert" className="text-sm text-rec">{active.message}</p> : null}
  </section>;
}
