import assert from "node:assert/strict";
import test from "node:test";
import { hydrateVideoDefaults } from "./video-defaults.ts";
import { DEFAULT_ENGINES, type Picture } from "./types.ts";

function picture(video: string): Picture {
  return { selectedEngine: { ...DEFAULT_ENGINES, video } } as Picture;
}

test("new pictures and the previous video default use LTX Director", () => {
  assert.equal(DEFAULT_ENGINES.video, "ltx-director");
  assert.equal(hydrateVideoDefaults(picture("ltx-2")).selectedEngine.video, "ltx-director");
});

test("migration retains another selected engine and never resets later choices", () => {
  assert.equal(hydrateVideoDefaults(picture("minimax-h3")).selectedEngine.video, "minimax-h3");
  const migrated = hydrateVideoDefaults(picture("ltx-2"));
  const selected: Picture = { ...migrated, selectedEngine: { ...migrated.selectedEngine, video: "ltx-2" } };
  assert.strictEqual(hydrateVideoDefaults(selected), selected);
});
