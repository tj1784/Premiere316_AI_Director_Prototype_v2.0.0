import assert from "node:assert/strict";
import test from "node:test";
import { scopePremiere316ReferenceState } from "./premiere316-reference-scope.mjs";

function segmentedWorkspace() {
  return {
    selectedSegmentId: "segment-b",
    timeline: {
      segments: [
        { id: "segment-a", storyboardFrameId: "frame-a" },
        { id: "segment-b", storyboardFrameId: "frame-b" }
      ]
    },
    premiere: {
      generationMode: "i2v_segmented_first_frames"
    }
  };
}

function sceneState() {
  return {
    references: [
      { id: "ref-a", frameId: "frame-a", required: true },
      { id: "ref-b", frameId: "frame-b", required: true }
    ],
    invalidReferences: [
      { id: "broken-a", frameId: "frame-a", required: true, reason: "missing" }
    ],
    referencesReady: false
  };
}

test("selected segmented I2V scopes references and failures to the selected frame", () => {
  const scoped = scopePremiere316ReferenceState(segmentedWorkspace(), sceneState(), { mode: "selected" });
  assert.equal(scoped.selectedScope, true);
  assert.equal(scoped.segmentId, "segment-b");
  assert.equal(scoped.frameId, "frame-b");
  assert.deepEqual(scoped.semanticReferences.map((item) => item.id), ["ref-b"]);
  assert.deepEqual(scoped.invalidReferences, []);
  assert.equal(scoped.expectedCount, 1);
  assert.equal(scoped.referencesReady, true);
});

test("an explicit segmentId scopes preflight even without an explicit selected mode", () => {
  const scoped = scopePremiere316ReferenceState(segmentedWorkspace(), sceneState(), { segmentId: "segment-a" });
  assert.deepEqual(scoped.semanticReferences.map((item) => item.id), ["ref-a"]);
  assert.deepEqual(scoped.invalidReferences.map((item) => item.id), ["broken-a"]);
  assert.equal(scoped.referencesReady, false);
});

test("Queue All retains the complete scene reference state", () => {
  const scoped = scopePremiere316ReferenceState(segmentedWorkspace(), sceneState(), { mode: "segments" });
  assert.equal(scoped.selectedScope, false);
  assert.deepEqual(scoped.semanticReferences.map((item) => item.id), ["ref-a", "ref-b"]);
  assert.deepEqual(scoped.invalidReferences.map((item) => item.id), ["broken-a"]);
  assert.equal(scoped.expectedCount, 2);
  assert.equal(scoped.referencesReady, false);
});

test("selected scope rejects an unknown segment rather than falling back to the scene", () => {
  assert.throws(
    () => scopePremiere316ReferenceState(segmentedWorkspace(), sceneState(), { mode: "selected", segmentId: "missing" }),
    /segment was not found: missing/
  );
});

test("non-I2V semantic plans retain plan-wide reference semantics", () => {
  const workspace = {
    premiere: { generationMode: "t2v_with_semantic_references", expectedReferenceCount: 1 }
  };
  const state = {
    semanticReferences: [{ id: "plan-ref" }],
    expectedReferenceCount: 1,
    semanticReferencesReady: true,
    invalidReferences: []
  };
  const scoped = scopePremiere316ReferenceState(workspace, state, { mode: "selected", segmentId: "irrelevant" });
  assert.equal(scoped.selectedScope, false);
  assert.deepEqual(scoped.semanticReferences, [{ id: "plan-ref" }]);
  assert.equal(scoped.expectedCount, 1);
  assert.equal(scoped.referencesReady, true);
});
