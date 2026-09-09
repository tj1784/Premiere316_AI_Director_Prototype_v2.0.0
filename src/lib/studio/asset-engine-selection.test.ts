import test from "node:test";
import assert from "node:assert/strict";
import { selectAssetEngine } from "./asset-engine-selection.ts";

const flux1 = { adapterId: "flux", modelVariant: "flux1-dev", status: "READY" };
test("a blocked FLUX.2 selection never falls back to available FLUX.1", () => {
  assert.throws(() => selectAssetEngine("flux2", [flux1, { adapterId: "flux2", modelVariant: "flux2-dev", status: "MEMORY_RISK", disabledReason: "Memory limit" }]), /flux2-dev: Memory limit/);
});
test("the selected exact model wins regardless of manifest order", () => {
  const flux2 = { adapterId: "flux2", modelVariant: "flux2-dev", status: "READY" };
  assert.equal(selectAssetEngine("flux2", [flux1, flux2]), flux2);
});
test("missing and ambiguous model selections cannot silently choose a model", () => {
  assert.throws(() => selectAssetEngine("flux2", [flux1]), /one exact/);
  assert.throws(() => selectAssetEngine("flux", [flux1, flux1]), /one exact/);
});
