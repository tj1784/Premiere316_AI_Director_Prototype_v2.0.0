import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { desktopSpecialistAudio, isDesktopApp } from "@/lib/desktop/client";
import {
  acceptSpecialistCandidate,
  type SpecialistJob,
  type SpecialistEngine,
} from "@/lib/studio/specialist-audio";
import { hydratePictureAudio } from "@/lib/production/audio-iterations";
import { toast } from "sonner";

export function SpecialistAudioPanel({ picture }: { picture: Picture }) {
  const [jobs, setJobs] = useState<SpecialistJob[]>([]);
  const [configured, setConfigured] = useState<string[]>([]);
  const [cueId, setCueId] = useState("");
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktopApp()), []);
  const cues = hydratePictureAudio(picture).cues.filter(
    (c) => !["dialogue", "silence"].includes(c.kind),
  );
  const selected = cues.find((c) => c.id === cueId);
  async function refresh() {
    const result = await desktopSpecialistAudio({ operation: "status", pictureId: picture.id });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setJobs(result.jobs ?? []);
    setConfigured(result.configured ?? []);
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await desktopSpecialistAudio({ operation: "status", pictureId: picture.id });
      if (!active) return;
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setJobs(result.jobs ?? []);
      setConfigured(result.configured ?? []);
      timer = setTimeout(
        () => void poll().catch((error) => active && setMessage(String(error))),
        (result.jobs ?? []).some((j) => j.status === "running") ? 2000 : 10000,
      );
    }
    if (isDesktopApp()) void poll().catch((error) => active && setMessage(String(error)));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [picture.id]);
  async function configure(engineId: SpecialistEngine) {
    const result = await desktopSpecialistAudio({ operation: "configure", engineId });
    setMessage(result.ok ? (result.note ?? "Configuration saved.") : result.error);
    await refresh();
  }
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-2xl">Specialist audio execution</h2>
      <p className="text-sm text-muted">
        Explicit single-cue jobs only. Exact XL SFT / Small-SFX variants, offline artifacts, no
        dialogue replacement, no automatic rendering or approval. Other GPU workloads are left
        untouched.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["ace-step-1.5-xl-sft", "stable-audio-3-small-sfx"] as const).map((engine) => (
          <Button
            key={engine}
            className="h-auto min-h-11 max-w-full whitespace-normal break-words"
            variant="secondary"
            disabled={!desktop || busy}
            onClick={() => void configure(engine).catch((e) => setMessage(String(e)))}
          >
            Configure {engine}
            {configured.includes(engine) ? " · paths set" : ""}
          </Button>
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        Saved source cue
        <select
          className="min-h-11 rounded border border-border bg-inset p-2"
          value={cueId}
          onChange={(e) => setCueId(e.target.value)}
        >
          <option value="">Select a saved score or sound cue…</option>
          {cues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.kind}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Seed
        <Input
          type="number"
          min={0}
          max={2147483647}
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
        />
      </label>
      <Button
        disabled={!desktop || !selected || busy || jobs.some((j) => j.status === "running")}
        onClick={async () => {
          if (!selected) return;
          setBusy(true);
          try {
            const result = await desktopSpecialistAudio({
              operation: "start",
              pictureId: picture.id,
              cueId: selected.id,
              cueSnapshot: JSON.stringify(selected),
              engineId:
                selected.kind === "score" ? "ace-step-1.5-xl-sft" : "stable-audio-3-small-sfx",
              seed,
            });
            if (!result.ok) throw new Error(result.error);
            setMessage(
              "Owned specialist job started. Output remains a candidate until listening review.",
            );
            await refresh();
          } catch (error) {
            setMessage(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        Generate this cue
      </Button>
      <p role="status" className="text-sm text-muted">
        {message ||
          (!desktop
            ? "Execution is available in the V4 desktop build; browser authoring remains available."
            : "No generation requested.")}
      </p>
      {jobs.map((job) => (
        <article key={job.id} className="grid gap-2 rounded border border-border p-3">
          <p>
            {cues.find((c) => c.id === job.cueId)?.name ?? job.cueId} · {job.status}
          </p>
          <p className="break-all text-xs text-muted">
            {job.request.engineId} · {job.id}
          </p>
          {job.error && <p className="text-sm text-muted">{job.error}</p>}
          {job.status === "running" && (
            <Button
              variant="secondary"
              onClick={async () => {
                await desktopSpecialistAudio({ operation: "cancel", jobId: job.id });
                await refresh();
              }}
            >
              Cancel owned job
            </Button>
          )}
          {job.status === "completed" && (
            <Button
              disabled={picture.audio?.takes.some((t) => t.jobId === job.id)}
              onClick={() => {
                try {
                  const latest = useStudio.getState().pictures.find((p) => p.id === picture.id);
                  if (!latest) return;
                  useStudio
                    .getState()
                    .replaceActive({
                      ...latest,
                      audio: acceptSpecialistCandidate(hydratePictureAudio(latest), latest.id, job),
                    });
                  toast.success("Candidate added to Review. It is not approved.");
                } catch (error) {
                  toast.error(String(error));
                }
              }}
            >
              Add candidate to listening review
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
