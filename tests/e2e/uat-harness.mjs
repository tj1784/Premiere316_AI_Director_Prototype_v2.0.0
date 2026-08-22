import test from "node:test";
import assert from "node:assert/strict";
import { CASES } from "./browser-harness.mjs";

test("old mock-store file is not a P0 pass", () => {
  assert.equal(CASES.length, 6);
  assert.equal(process.env.PREMIERE316_UAT_BROWSER, undefined);
});
