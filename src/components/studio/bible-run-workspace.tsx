import { reviewDifferences } from "@/lib/studio/review-differences";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import {
  editBibleCandidate,
  nextBibleUnit,
  parseBibleResponse,
  reviewBibleUnit,
  startBibleRun,
  type BibleRun,
} from "@/lib/studio/bible-run";
import { BibleDraftContent } from "./bible-draft-content";
import { bibleWorkerActive, executeBibleRun } from "@/lib/studio/bible-run-client";
import { readyTextFile, saveReadyFile } from "@/lib/utils";
import { applyBibleScreenplay, applyBiblePlanning } from "@/lib/studio/bible-application";
import { startScopedBibleRevision } from "@/lib/studio/bible-run";
import { useWorkspaceDraft } from "./use-workspace-draft";

export function BibleRunWorkspace() {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [challenger, setChallenger] = useState(false);
  const [budget, setBudget] = useState(100);
  const [selectedId, setSelectedId] = useWorkspaceDraft("run-selected-unit", "");
  const [feedback, setFeedback] = useWorkspaceDraft("run-feedback", "");
  const [compare, setCompare] = useState(false);
  const [drafts, setDrafts] = useWorkspaceDraft<Record<string, string>>("run-candidate-drafts", {});
  const [revisionScene, setRevisionScene] = useState("");
  if (!picture) return null;
  const run = picture.bibleRun;
  const current = run && nextBibleUnit(run);
  const selected = run?.units.find((u) => u.id === selectedId) ?? current ?? run?.units.at(-1);
  const draftKey = `${run?.id ?? ""}:${selected?.id ?? ""}`;
  const edited = drafts[draftKey] ?? null;
  const setEdited = (text: string | null) =>
    setDrafts((previous) => {
      const next = { ...previous };
      if (text === null) delete next[draftKey];
      else next[draftKey] = text;
      return next;
    });
  let readable: Parameters<typeof BibleDraftContent>[0]["value"] = null;
  try {
    readable = parseBibleResponse(edited ?? selected?.candidates.at(-1)?.text ?? "") as Parameters<
      typeof BibleDraftContent
    >[0]["value"];
  } catch {
    /* Invalid candidates remain available in the raw evidence view. */
  }
  let previousReadable: typeof readable = null;
  try {
    previousReadable = parseBibleResponse(
      selected?.candidates.at(-2)?.text ?? "",
    ) as typeof readable;
  } catch {
    /* Raw previous evidence is retained below. */
  }
  const differences =
    previousReadable && readable ? reviewDifferences(previousReadable, readable) : [];
  const differenceText = (value: unknown) =>
    value === undefined
      ? "Not present"
      : typeof value === "string"
        ? value || "(empty)"
        : JSON.stringify(value, null, 2);
  let nextLabel = "";
  let canAccept = false;
  if (run && selected && ["review", "failed", "rejected"].includes(selected.status)) {
    try {
      const accepted = reviewBibleUnit(run, selected.id, "accept");
      canAccept = true;
      const successor = nextBibleUnit(accepted);
      nextLabel =
        successor && !["review", "rejected"].includes(successor.status) ? successor.label : "";
    } catch {
      /* Review remains disabled until the candidate is valid. */
    }
  }
  const update = (next: BibleRun) => patch({ bibleRun: next });
  const review = (decision: "accept" | "reject" | "revise", next = false) => {
    if (!run || !selected) return;
    try {
      const changed = reviewBibleUnit(run, selected.id, decision, feedback);
      update(changed);
      if (next) void executeBibleRun(picture.id, true);
    } catch (error) {
      toast.error(String(error));
    }
  };
  return (
    <section
      className="run-workspace grid gap-4 rounded-lg border border-border bg-surface p-4"
      aria-label="Complete Movie Script run"
    >
      <header>
        <h2 className="text-2xl">Complete Movie Script</h2>
        <p className="mt-2 text-sm text-muted">
          Sources → complete scenes → shots, assets & cues → continuity review. Text authoring only;
          media jobs remain explicit.
        </p>
      </header>
      {!run || ["canceled", "complete"].includes(run.status) ? (
        <div className="grid gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={challenger}
              onChange={(e) => setChallenger(e.target.checked)}
            />
            Include optional creative challenge and revision for each scene
          </label>
          <label className="text-sm">
            Maximum requests
            <Input
              aria-label="Maximum authoring requests"
              type="number"
              min={1}
              max={500}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
          <p className="text-xs text-muted">
            At most two revisions per unit. Local output is capped at 8,192 tokens per request;
            context is never silently truncated. Monetary budgets are not supported by the local
            adapter.
          </p>
          <Button
            onClick={() => {
              try {
                const base = { ...picture, bibleRun: undefined };
                const next = startBibleRun(base, { challenger, maxRequests: budget });
                patch({
                  bibleRun: next,
                  bibleRunHistory: run
                    ? [...(picture.bibleRunHistory ?? []), run]
                    : picture.bibleRunHistory,
                });
                void executeBibleRun(picture.id);
              } catch (error) {
                toast.error(String(error));
              }
            }}
          >
            {picture.productionRouting?.executionMode === "autonomous-complete-script"
              ? "Start autonomous complete script"
              : "Start one guided unit"}
          </Button>
        </div>
      ) : null}
      {run && (
        <>
          {run.status === "complete" && (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer">Targeted scene revision</summary>
              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  Affected scene
                  <select
                    className="block min-h-11 w-full rounded bg-inset p-2"
                    value={revisionScene}
                    onChange={(e) => setRevisionScene(e.target.value)}
                  >
                    <option value="">Choose scene…</option>
                    {run.scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Textarea
                  aria-label="Scoped scene correction"
                  placeholder="Describe the exact correction; other scene drafts remain unchanged."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <Button
                  onClick={() => {
                    try {
                      const next = startScopedBibleRevision(picture, run, revisionScene, feedback);
                      patch({
                        bibleRun: next,
                        bibleRunHistory: [...(picture.bibleRunHistory ?? []), run],
                      });
                      setSelectedId("");
                      void executeBibleRun(picture.id);
                    } catch (error) {
                      toast.error(String(error));
                    }
                  }}
                >
                  Start scoped revision
                </Button>
              </div>
            </details>
          )}
          <div role="status" className="rounded-md bg-elevated p-3 text-sm">
            {run.status === "complete"
              ? "Complete text package — awaiting final review"
              : run.status === "running" && !bibleWorkerActive(run.id)
                ? "Interrupted run — explicit reconciliation required"
                : current?.status === "review"
                  ? "Awaiting your review"
                  : run.status.replaceAll("-", " ")}{" "}
            · {run.units.filter((u) => ["accepted", "checkpoint"].includes(u.status)).length}/
            {run.units.length} units · {run.requests}/{run.maxRequests} requests
            <p className="mt-1 text-xs text-muted">
              {run.profileId} · {run.mode} · snapshot {run.sourceHash}
            </p>
          </div>
          <progress
            className="h-1.5 w-full accent-accent"
            aria-label="Authoring coverage"
            value={run.units.filter((u) => ["accepted", "checkpoint"].includes(u.status)).length}
            max={Math.max(1, run.units.length)}
          />
          {run.failure && (
            <p role="alert" className="whitespace-pre-wrap text-sm text-rec">
              {run.failure}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {run.status === "running" && (
              <Button variant="secondary" onClick={() => update({ ...run, status: "paused" })}>
                Pause after in-flight unit
              </Button>
            )}
            {["paused", "ready", "failed"].includes(run.status) &&
              current?.status !== "review" &&
              current?.status !== "rejected" && (
                <Button onClick={() => void executeBibleRun(picture.id)}>
                  {run.mode === "guided"
                    ? `Run next: ${current?.label ?? "none"}`
                    : "Resume autonomous run"}
                </Button>
              )}
            {run.status === "running" && !bibleWorkerActive(run.id) && (
              <Button onClick={() => void executeBibleRun(picture.id)}>
                Reconcile interrupted request
              </Button>
            )}
            {!["complete", "canceled"].includes(run.status) && (
              <Button
                variant="ghost"
                onClick={() => update({ ...run, status: "canceled", updatedAt: Date.now() })}
              >
                Cancel run
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                void saveReadyFile(
                  readyTextFile(
                    `${picture.title}-bible-package.json`,
                    JSON.stringify(run, null, 2),
                    "application/json",
                  ),
                )
              }
            >
              Export full package
            </Button>
            {run.status === "complete" && (
              <>
                <Button
                  onClick={() => {
                    try {
                      useStudio.getState().replaceActive(applyBibleScreenplay(picture, run));
                      toast.success(
                        "Full screenplay saved as a draft. Existing approval preserved.",
                      );
                    } catch (error) {
                      toast.error(String(error));
                    }
                  }}
                >
                  Apply screenplay as draft
                </Button>
                <Button
                  variant="secondary"
                  disabled={picture.bibleAppliedPlans?.includes(run.id)}
                  onClick={() => {
                    try {
                      useStudio.getState().replaceActive(applyBiblePlanning(picture, run));
                      toast.success(
                        "Shot, asset and cue drafts added to their canonical editors. No media generated or approved.",
                      );
                    } catch (error) {
                      toast.error(String(error));
                    }
                  }}
                >
                  Apply plan after screenplay approval
                </Button>
              </>
            )}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)]">
            <div className="run-coverage-ledger" aria-label="Run coverage ledger">
              {run.units.map((u) => (
                <button
                  className="workspace-nav-link"
                  aria-current={selected?.id === u.id ? "true" : undefined}
                  key={u.id}
                  onClick={() => {
                    setSelectedId(u.id);
                  }}
                >
                  <span>
                    {u.phase} · {u.label}
                    <small className="block">
                      {u.status === "checkpoint"
                        ? "Machine checkpoint — not human approval"
                        : u.status}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <div className="min-w-0">
                <h3 className="text-xl">{selected.label}</h3>
                <p className="my-2 text-xs text-muted">
                  {selected.role} · {selected.candidates.length} saved revisions
                </p>
                {selected.error && (
                  <p role="alert" className="text-sm text-rec">
                    {selected.error}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={selected.candidates.length < 2}
                  onClick={() => setCompare(!compare)}
                >
                  {compare ? "Hide previous revision" : "Compare revisions"}
                </Button>
                {compare && previousReadable && readable && (
                  <details className="my-3 rounded border border-border p-3" open>
                    <summary className="cursor-pointer text-sm">
                      {differences.length} changed fields
                    </summary>
                    <div className="mt-3 grid gap-3">
                      {differences.map((change) => (
                        <section key={change.path} className="border-t border-border pt-3">
                          <h4 className="text-xs text-accent">{change.path}</h4>
                          <div className="mt-2 grid gap-3 lg:grid-cols-2">
                            <div>
                              <p className="text-xs text-muted">Before</p>
                              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">
                                {differenceText(change.before)}
                              </pre>
                            </div>
                            <div>
                              <p className="text-xs text-muted">After</p>
                              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">
                                {differenceText(change.after)}
                              </pre>
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                  </details>
                )}
                <div className={compare ? "grid gap-3 lg:grid-cols-2" : ""}>
                  {compare && (
                    <section className="rounded-md border border-border bg-inset p-4">
                      <h4 className="mb-4 text-sm text-accent">
                        Previous revision · {selected.candidates.length - 1}
                      </h4>
                      {previousReadable ? (
                        <BibleDraftContent value={previousReadable} />
                      ) : (
                        <pre className="whitespace-pre-wrap break-words text-xs">
                          {selected.candidates.at(-2)?.text}
                        </pre>
                      )}
                    </section>
                  )}
                  <div className="rounded-md border border-border bg-inset p-4">
                    <h4 className="mb-4 text-sm text-accent">
                      Current revision · {selected.candidates.length}
                    </h4>
                    {readable ? (
                      <BibleDraftContent
                        value={readable}
                        onChange={
                          edited !== null ? (next) => setEdited(JSON.stringify(next)) : undefined
                        }
                      />
                    ) : (
                      <p className="text-sm text-muted">No complete structured candidate yet.</p>
                    )}
                  </div>
                </div>
                {readable && run.status !== "running" && (
                  <div className="my-3 flex gap-2">
                    {edited === null ? (
                      <Button
                        variant="secondary"
                        onClick={() => setEdited(selected.candidates.at(-1)!.text)}
                      >
                        Edit draft
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => {
                            try {
                              update(editBibleCandidate(run, selected.id, edited));
                              setEdited(null);
                            } catch (error) {
                              toast.error(String(error));
                            }
                          }}
                        >
                          Save new revision
                        </Button>
                        <Button variant="ghost" onClick={() => setEdited(null)}>
                          Discard edit
                        </Button>
                      </>
                    )}
                  </div>
                )}
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted">
                    Raw result & execution evidence
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {selected.candidates.at(-1)?.text}
                    {"\n"}
                    {selected.candidates.at(-1)?.evidenceJson}
                  </pre>
                </details>
                {["review", "failed", "rejected"].includes(selected.status) && (
                  <div className="mt-4 grid gap-3">
                    <Textarea
                      aria-label="Targeted revision feedback"
                      placeholder="Targeted changes for this unit…"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={edited !== null || !canAccept || run.status === "running"}
                        onClick={() => review("accept")}
                      >
                        Accept this draft · stay paused
                      </Button>
                      <Button
                        className="h-auto min-h-11 whitespace-normal text-left"
                        variant="secondary"
                        disabled={edited !== null || !nextLabel || run.status === "running"}
                        onClick={() => review("accept", true)}
                      >
                        Accept & run: {nextLabel || "no next unit"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={edited !== null || run.status === "running"}
                        onClick={() => review("revise")}
                      >
                        Request changes
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={edited !== null || run.status === "running"}
                        onClick={() => review("reject")}
                      >
                        Reject
                      </Button>
                    </div>
                    <p className="text-xs text-muted">
                      Draft acceptance permits authoring context only. Screenplay and media
                      production approval remain in their existing review controls.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
