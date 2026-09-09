import { test } from "node:test";
import assert from "node:assert/strict";
import { createStoryDoctorRuns } from "./story-doctor-runs.ts";

test("QA output survives view unsubscribe and stops without accepting a late report", async () => {
  const runs = createStoryDoctorRuns();
  let finish!: () => void;
  let signal!: AbortSignal;
  const pending = runs.run("picture", "gptoss", async (progress) => {
    signal = progress.signal;
    progress.onReasoning("Checking continuity.");
    progress.onText("Partial critique");
    await new Promise<void>((resolve) => { finish = resolve; });
    return "late report";
  });
  const unsub = runs.subscribe(() => {});
  unsub();
  assert.equal(runs.get("picture")?.reasoning, "Checking continuity.");
  assert.equal(runs.get("picture")?.status, "running");
  runs.stop("picture");
  assert.equal(signal.aborted, true);
  finish();
  await assert.rejects(pending, /stopped/);
  assert.equal(runs.get("picture")?.status, "stopped");
});

test("QA distinguishes completed and failed from running", async () => {
  const runs = createStoryDoctorRuns();
  await runs.run("p", "gptoss", async () => "report");
  assert.equal(runs.get("p")?.status, "completed");
  await assert.rejects(runs.run("p", "gptoss", async () => { throw new Error("Disconnected"); }));
  assert.equal(runs.get("p")?.status, "failed");
  assert.equal(runs.get("p")?.error, "Disconnected");
});
