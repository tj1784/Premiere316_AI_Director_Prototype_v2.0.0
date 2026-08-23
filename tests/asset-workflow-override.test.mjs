import test from "node:test";
import assert from "node:assert/strict";
import { createDirectorAsset } from "../server/assets.js";
import { applyStyleLockToAsset, STYLE_LOCK_IDS } from "../server/style-lock.js";

test("explicit style-lock workflow selection survives automatic style routing", () => {
  const asset = createDirectorAsset({
    category: "guide-frame",
    name: "H01 first guide",
    variant: "Production Reference",
    workflowId: STYLE_LOCK_IDS.fourByThree,
    prompt: "Generate the first guide."
  });

  assert.equal(asset.workflowId, STYLE_LOCK_IDS.fourByThree);
  assert.equal(asset.workflowExplicit, true);

  applyStyleLockToAsset(asset);
  assert.equal(asset.workflowId, STYLE_LOCK_IDS.fourByThree);
});
