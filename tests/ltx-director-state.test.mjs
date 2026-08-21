import assert from "node:assert/strict";
import test from "node:test";
import {
  LTX25_PREMIERE316_PROFILE,
  activeTakeOf,
  firstPlayablePreviewIndex,
  isSegmentedI2vWorkspace,
  isVisualGenerationSegment,
  ltx25FramePlan,
  segmentNeighborState,
  segmentedI2vQueueReady,
  semanticConditioningState,
  semanticReferenceState,
  semanticT2vLockedForWorkspace,
  temporalGuideState,
  visibleGenerateOptions
} from "../client/src/ltx-director-state.js";

const image = (id, start, extra = {}) => ({
  id,
  type: "image",
  start,
  length: 25,
  imageFile: `${id}.png`,
  ...extra
});

test("native Director generation accepts only queueable visual segments", () => {
  assert.equal(isVisualGenerationSegment(image("visual", 0)), true);
  assert.equal(isVisualGenerationSegment({ id: "audio", type: "audio", length: 25 }), false);
  assert.equal(isVisualGenerationSegment(image("missing", 0, { missingGuide: true })), false);
  assert.equal(isVisualGenerationSegment({ id: "text", type: "image", length: 25 }), false);
});

test("native Director neighbor controls require immediate approved image guides", () => {
  const workspace = {
    timeline: {
      segments: [
        image("first", 0),
        image("middle", 25),
        image("last", 50, { missingGuide: true })
      ]
    }
  };
  assert.deepEqual(segmentNeighborState(workspace, "middle"), {
    canUsePreviousAsFirstFrame: true,
    canUseNextAsLastFrame: false
  });
});

test("LTX2.5_Premiere316 auto-calculates generation and edit lengths", () => {
  assert.deepEqual(ltx25FramePlan(72, 24), {
    profile: LTX25_PREMIERE316_PROFILE,
    grid: "8n+1",
    requestedFrames: 72,
    generationFrames: 73,
    editFrames: 72,
    trimFrames: 1,
    requestedSeconds: 3,
    generationSeconds: 73 / 24,
    editSeconds: 3
  });
  assert.equal(ltx25FramePlan(73, 24).generationFrames, 73);
  assert.equal(ltx25FramePlan(48, 24).generationFrames, 49);
});

test("temporal guide state keeps first and last roles separate", () => {
  const workspace = {
    timeline: {
      segments: [
        image("previous", 0),
        image("selected", 25, { usePreviousAsFirstFrame: true, useNextAsLastFrame: true }),
        image("next", 50)
      ]
    }
  };
  const guides = temporalGuideState(workspace, "selected");
  assert.equal(guides.first.role, "first");
  assert.equal(guides.first.sourceSegmentId, "previous");
  assert.equal(guides.last.role, "last");
  assert.equal(guides.last.sourceSegmentId, "next");
});

test("semantic references are scoped to the selected frame and grouped by role", () => {
  const state = semanticReferenceState({
    referencesReady: true,
    references: [
      { id: "a", frameId: "frame-a", role: "identity", file: "jesus.png" },
      { id: "a-copy", frameId: "frame-a", role: "identity", file: "jesus.png" },
      { id: "b", frameId: "frame-a", role: "location", file: "abyss.png" },
      { id: "c", frameId: "frame-b", role: "prop", file: "chains.png" }
    ],
    invalidReferences: []
  }, "frame-a");
  assert.equal(state.scope, "selected-frame");
  assert.equal(state.references.length, 2);
  assert.deepEqual(state.roleCounts, [
    { role: "identity", count: 1 },
    { role: "location", count: 1 }
  ]);
  assert.equal(semanticConditioningState({ ok: true }, state).status, "resolved");
  assert.equal(semanticConditioningState({ ok: true, semanticReferences: { injected: true, injectedCount: 2 } }, state).status, "injected");
  assert.deepEqual(
    semanticConditioningState({ ok: true, semanticReferences: { expected: 2, resolved: 2, injected: 2, adapter: "ingredients.safetensors" } }, state),
    { status: "injected", label: "2 compiler-conditioned", count: 2 }
  );
});

test("a reference-free selected frame never inherits another segment's references", () => {
  const state = semanticReferenceState({
    referencesReady: true,
    expectedReferenceCount: 0,
    references: [
      { id: "later", frameId: "frame-later", role: "identity", file: "jesus.png" }
    ],
    semanticReferences: [],
    invalidReferences: []
  }, "frame-selected");
  assert.equal(state.scope, "selected-frame");
  assert.equal(state.source, "frame-bindings");
  assert.deepEqual(state.references, []);
  assert.deepEqual(state.roleCounts, []);
  assert.equal(state.declaredCount, 0);
  assert.equal(state.ready, true);
});

test("a user-managed selected-frame reference reports its scoped declared count", () => {
  const state = semanticReferenceState({
    referencesReady: true,
    expectedReferenceCount: 0,
    references: [
      { id: "selected", frameId: "frame-selected", role: "identity", file: "jesus.png", persistenceOrigin: "user" }
    ],
    semanticReferences: [],
    invalidReferences: []
  }, "frame-selected");
  assert.equal(state.references.length, 1);
  assert.equal(state.declaredCount, 1);
  assert.equal(state.ready, true);
});

test("hybrid Director diagnostics prefer video-plan Ingredients over temporal frame bindings", () => {
  const state = semanticReferenceState({
    referencesReady: true,
    semanticReferencesReady: true,
    references: [
      { id: "frame-guide", frameId: "frame-a", role: "composition", file: "first-frame.png" }
    ],
    semanticReferences: [
      { id: "identity", frameId: null, role: "identity", canonicalFile: "jesus.png" },
      { id: "location", frameId: null, role: "location", canonicalFile: "shaft.png" }
    ],
    expectedReferenceCount: 2,
    invalidReferences: []
  }, "frame-a");
  assert.equal(state.source, "video-plan");
  assert.equal(state.scope, "scene");
  assert.deepEqual(state.references.map((reference) => reference.id), ["identity", "location"]);
  assert.equal(state.declaredCount, 2);
  assert.equal(state.ready, true);
});

test("Harrowing AAA I2V Queue All is ready from first-frame segments without T2V preflight", () => {
  const workspace = {
    premiere: {
      projectSlug: "harrowing_of_hell",
      generationMode: "i2v_segmented_first_frames",
      generateOption: { id: "harrowing_aaa_i2v_segmented", queueMode: "segments" },
      generateOptions: [
        { id: "harrowing_aaa_i2v_segmented", generationMode: "i2v_segmented_first_frames" },
        { id: "t2v_with_semantic_references", generationMode: "t2v_with_semantic_references" }
      ]
    },
    timeline: {
      segments: Array.from({ length: 18 }, (_, index) => ({
        id: `segment-h01-s01-c01-${String(index + 1).padStart(2, "0")}`,
        type: "image",
        start: index * 192,
        length: 192,
        projectMediaPath: `media/storyboard/seg-${index + 1}.png`
      }))
    }
  };
  assert.equal(isSegmentedI2vWorkspace(workspace), true);
  assert.equal(segmentedI2vQueueReady(workspace), true);
  assert.equal(semanticT2vLockedForWorkspace(workspace, "harrowing_of_hell"), true);
  assert.equal(
    visibleGenerateOptions(workspace.premiere.generateOptions, workspace, "harrowing_of_hell")
      .some((option) => option.id === "t2v_with_semantic_references"),
    false
  );
});

test("Preview lands on the first take that exists", () => {
  assert.equal(activeTakeOf({
    activeTakeId: "missing",
    generatedTakes: [{ id: "take-v2", v: 2, file: "media/clips/seg02.mp4" }]
  })?.id, "take-v2");
  const playlist = [
    { segmentId: "s1", url: "" },
    { segmentId: "s2", url: "/media/take.mp4" },
    { segmentId: "s3", url: "" }
  ];
  assert.equal(firstPlayablePreviewIndex(playlist), 1);
  assert.equal(firstPlayablePreviewIndex([{ url: "" }]), 0);
});
