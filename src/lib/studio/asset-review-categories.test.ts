import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_CATEGORIES } from "../production/types.ts";
import { ASSET_REVIEW_GROUPS, assetReviewGroup } from "./asset-review-categories.ts";

test("every screenplay asset category has exactly one review group", () => {
  const mapped = ASSET_REVIEW_GROUPS.flatMap((group) => [...group.categories]);
  assert.deepEqual([...mapped].sort(), [...PRODUCTION_CATEGORIES].sort());
  assert.equal(new Set(mapped).size, mapped.length);
});
test("voice and sound stay separate from visual artifacts", () => {
  assert.equal(assetReviewGroup("voice").id, "voice");
  assert.equal(assetReviewGroup("sound").id, "sound");
  for (const category of ["prop", "wardrobe", "vehicle"] as const) assert.equal(assetReviewGroup(category).id, "artifacts");
});
