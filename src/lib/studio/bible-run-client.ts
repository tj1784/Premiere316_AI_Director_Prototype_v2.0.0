import { useStudio } from "./store";
import { generateBibleText } from "./bible-api";
import {
  bibleRunPrompt,
  bibleSourceHash,
  completeBibleUnit,
  dispatchBibleUnit,
  nextBibleUnit,
  repairIncompleteAutonomousUnit,
  type BibleRun,
} from "./bible-run";

const workers = new Set<string>();
export function bibleWorkerActive(id: string) {
  return workers.has(id);
}
export async function executeBibleRun(pictureId: string, oneUnit = false) {
  const getPicture = () => useStudio.getState().pictures.find((p) => p.id === pictureId);
  const initial = getPicture()?.bibleRun;
  if (!initial || workers.has(initial.id)) return;
  const runId = initial.id;
  const write = (run: BibleRun) => {
    const picture = getPicture();
    if (picture?.bibleRun?.id !== runId || picture.bibleRun.status === "canceled") return;
    useStudio.getState().replaceActive({
      ...picture,
      bibleRun: run,
      ...(run.status === "complete" && picture.productionRouting
        ? {
            productionRouting: { ...picture.productionRouting, executionMode: "guided" as const },
          }
        : {}),
      updatedAt: Date.now(),
    });
  };
  workers.add(runId);
  try {
    do {
      const picture = getPicture();
      if (!picture || picture.bibleRun?.id !== runId || picture.bibleRun.status === "canceled")
        return;
      let run = picture.bibleRun;
      const reconcileOnly = run.status === "running" || nextBibleUnit(run)?.status === "running";
      if (bibleSourceHash(picture) !== run.sourceHash)
        throw new Error(
          "Source/profile changed. This snapshot is stale; its results will not be applied.",
        );
      // Explicit recovery reconciles the same request ID, never silently retries it.
      if (!reconcileOnly) run = dispatchBibleUnit(run, bibleSourceHash(picture));
      const unit = nextBibleUnit(run);
      if (!unit) return;
      write(run);
      const binding = run.bindings.find((b) => b.role === unit.role);
      if (!binding?.callableModelId)
        throw new Error(
          `No callable binding for ${unit.role}. Configure ${run.profileId}; no fallback was used.`,
        );
      const payload = bibleRunPrompt(run, unit);
      const result = await generateBibleText({
        data: {
          requestId: `${run.id}:${unit.id}:${unit.attempts}`,
          binding,
          reconcileOnly,
          ...payload,
        },
      });
      const current = getPicture();
      if (current?.bibleRun?.id !== runId || current.bibleRun.status === "canceled") return;
      if (bibleSourceHash(current) !== run.sourceHash)
        throw new Error("Source changed during inference. Late output cannot advance this run.");
      const next = repairIncompleteAutonomousUnit(
        completeBibleUnit(
          current.bibleRun,
          unit.id,
          result.text,
          result.modelId,
          run.sourceHash,
          result.evidenceJson,
        ),
      );
      write(next);
      if (oneUnit || next.mode === "guided" || next.status !== "ready") return;
    } while (true);
  } catch (error) {
    const run = getPicture()?.bibleRun;
    if (run?.id === runId && run.status !== "canceled")
      write({
        ...run,
        status: "failed",
        failure: error instanceof Error ? error.message : String(error),
        units: run.units.map((u) => (u.status === "running" ? { ...u, status: "failed" } : u)),
      });
  } finally {
    workers.delete(runId);
  }
}
