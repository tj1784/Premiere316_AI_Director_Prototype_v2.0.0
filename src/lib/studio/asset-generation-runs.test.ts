import test from "node:test";
import assert from "node:assert/strict";
import { createAssetGenerationRuns } from "./asset-generation-runs.ts";

test("navigation cannot erase a running generation or start a duplicate", () => {
  const runs = createAssetGenerationRuns();
  const id = runs.start("moses", "regenerate", "references", "Finding references");
  assert.ok(id);
  let notices = 0;
  const unsubscribe = runs.subscribe(() => { notices++; });
  unsubscribe(); // Assets view unmounts while its generation promise continues.
  runs.update("moses", id, { phase: "prompts", message: "Writing Moses 1/15", output: { model: "qwen", text: "A deep maroon robe", updatedAt: Date.now() } });
  assert.equal(notices, 0);
  assert.equal(runs.get("moses")?.status, "running");
  assert.equal(runs.get("moses")?.output?.text, "A deep maroon robe");
  assert.equal(runs.start("moses", "regenerate", "references", "Duplicate"), null);
  const remounted = runs.subscribe(() => { notices++; });
  runs.update("moses", id, { phase: "images", message: "Generating image 1/15" });
  assert.equal(notices, 1);
  assert.equal(runs.get("moses")?.activity.length, 3);
  remounted();
});

test("errors remain visible and late callbacks cannot corrupt a retry or another picture", () => {
  const runs = createAssetGenerationRuns();
  const first = runs.start("moses", "regenerate", "prompts", "Writing")!;
  const other = runs.start("other", "images", "images", "Generating")!;
  runs.finish("moses", first, "failed", "FLUX.2 is unavailable");
  assert.equal(runs.get("moses")?.message, "FLUX.2 is unavailable");
  assert.equal(runs.get("moses")?.status, "failed");
  const retry = runs.start("moses", "regenerate", "prompts", "Retry writing")!;
  assert.notEqual(first, retry);
  runs.update("moses", first, { message: "Stale success" });
  runs.finish("moses", first, "completed", "Stale completion");
  assert.equal(runs.get("moses")?.message, "Retry writing");
  assert.equal(runs.get("other")?.id, other);
  assert.equal(runs.get("other")?.message, "Generating");
});

test("restart retains evidence and reports interrupted work instead of inventing a live run", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const firstSession = createAssetGenerationRuns(() => storage, () => 1000);
  const id = firstSession.start("moses", "regenerate", "prompts", "Writing Moses")!;
  firstSession.update("moses", id, { output: { model: "qwen", text: "Prompt output", updatedAt: 1000 }, counts: { assets: 15, prompts: 3, images: 0, references: 1 } });
  const restarted = createAssetGenerationRuns(() => storage, () => 2000);
  const status = restarted.get("moses");
  assert.equal(status?.status, "interrupted");
  assert.match(status!.message, /app restarted/);
  assert.equal(status?.output?.text, "Prompt output");
  assert.equal(status?.counts?.prompts, 3);
  assert.ok(restarted.start("moses", "regenerate", "references", "Resume"));
});

test("unavailable local storage does not prevent live status or completion", () => {
  const runs = createAssetGenerationRuns(() => { throw new Error("Storage unavailable"); });
  const id = runs.start("moses", "images", "images", "Generating")!;
  runs.finish("moses", id, "completed", "Images ready");
  assert.equal(runs.get("moses")?.status, "completed");
});
