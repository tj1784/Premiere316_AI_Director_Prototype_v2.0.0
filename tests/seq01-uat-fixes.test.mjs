import assert from "node:assert/strict";
import test from "node:test";
import { screenplayStats } from "../client/src/screenplay-stats.js";
import { createDeterministicShotPlan } from "../server/screenplay.js";
import { getAssetWorkflowCatalog } from "../server/assets.js";
import { createEmptyStoryboard, validateStoryboard } from "../server/storyboard.js";

test("imported left-aligned screenplays report runtime and dialogue", () => {
  const markdown = `# JESUS: THE VIOLENT DESCENT\n\nTARGET RUNTIME: 30 MINUTES\n\nEXT. GOLGOTHA - DAY\n\nJESUS\n\nIt is finished.\n`;
  const stats = screenplayStats(markdown);
  assert.match(stats.runtime, /30/);
  assert.ok(stats.scenes >= 1);
  assert.ok(stats.dialogue >= 1);
});

test("deterministic shot plan covers Golgotha without an LLM", () => {
  const markdown = `EXT. GOLGOTHA - DAY\n\nDarkness at midday.\n\nJESUS\n\nIt is finished.\n\nINT. TEMPLE - HOLY PLACE - SAME\n\nThe veil rips.`;
  const plan = createDeterministicShotPlan(markdown, { sceneFilter: "Golgotha|Temple", maxShots: 12 });
  assert.ok(plan.shots.length >= 2);
  assert.ok(plan.shots.every((shot) => shot.globalPrompt));
  assert.ok(plan.totalDurationSec > 0);
});

test("empty storyboard validates", () => {
  const board = createEmptyStoryboard("harrowing_of_hell_v2", { title: "Test" });
  const validated = validateStoryboard(board, "harrowing_of_hell_v2");
  assert.equal(validated.projectId, "harrowing_of_hell_v2");
  assert.equal(validated.schemaVersion, "premiere316.storyboard.v1");
});

test("offline Comfy is not reported as missing nodes", async () => {
  const catalog = await getAssetWorkflowCatalog(true);
  const flux = catalog.find((item) => item.id === "ci-flux2-p316-style-only-2x3-vertical-max");
  const voice = catalog.find((item) => item.id === "qwen3-tts-voice-design-1.7b");
  if (flux && !flux.ready) {
    assert.doesNotMatch(String(flux.reason || ""), /^Missing nodes:/);
    assert.match(String(flux.reason || flux.code || ""), /offline|COMFY_OFFLINE|Missing models|Style-Lock/i);
  }
  assert.equal(voice?.ready, false);
  assert.match(String(voice?.reason || ""), /Create Sound/i);
});
