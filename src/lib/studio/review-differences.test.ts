import test from "node:test";
import assert from "node:assert/strict";
import { reviewDifferences } from "./review-differences.ts";
test("review isolates changed dialogue and added cue without claiming unchanged scenes changed", () => {
  const before = {
    scenes: [
      { fountain: "ANA\nStay.", id: "one" },
      { id: "two", fountain: "Silence." },
    ],
    cues: [],
  };
  const after = {
    cues: [{ name: "Footsteps" }],
    scenes: [
      { id: "one", fountain: "ANA\nWait." },
      { fountain: "Silence.", id: "two" },
    ],
  };
  const changes = reviewDifferences(before, after);
  assert.deepEqual(
    changes.map((c) => c.path),
    ["Draft / scenes [1] / fountain", "Draft / cues [1]"],
  );
  assert.equal(changes[0].before, "ANA\nStay.");
  assert.equal(changes[0].after, "ANA\nWait.");
});
test("removed, empty, false and null values remain distinct in review", () => {
  const changes = reviewDifferences(
    { note: "", approved: false, scope: null },
    { note: null, approved: true },
  );
  assert.equal(changes.length, 3);
  assert.equal(changes[2].before, null);
  assert.equal(changes[2].after, undefined);
});
