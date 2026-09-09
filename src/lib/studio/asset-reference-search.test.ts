import { test } from "node:test";
import assert from "node:assert/strict";
import { researchAssetReference } from "./asset-reference-search.ts";

test("refines rejected and empty searches without attaching rejected candidates", async () => {
  const queries: string[] = [];
  const feedback: string[] = [];
  const candidate = await researchAssetReference("initial", {
    search: async (query) => { queries.push(query); return queries.length === 2 ? [] : [queries.length === 1 ? "irrelevant" : "artifact"]; },
    choose: async (_, rows) => ({ index: rows[0] === "artifact" ? 0 : -1, reason: "Modern costume, wrong period" }),
    refine: async (_, reason) => { feedback.push(reason); return `refined ${feedback.length}`; },
    progress: () => {},
  });
  assert.equal(candidate, "artifact");
  assert.deepEqual(queries, ["initial", "refined 1", "refined 2"]);
  assert.match(feedback[0], /wrong period/);
  assert.match(feedback[1], /No usable/);
});

test("bounded failures do not silently choose an unsuitable reference", async () => {
  let searches = 0;
  await assert.rejects(researchAssetReference("artifact", {
    search: async () => { searches++; return ["logo"]; },
    choose: async () => ({ index: -1, reason: "Only a logo" }),
    refine: async () => "museum artifact",
    progress: () => {},
  }), /Reference search exhausted.*Only a logo/);
  assert.equal(searches, 3);
});
