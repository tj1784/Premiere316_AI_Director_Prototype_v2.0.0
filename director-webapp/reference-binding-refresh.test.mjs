import assert from "node:assert/strict";
import test from "node:test";
import { workspaceWithRefreshedReferenceBinding } from "./premiere-projects.mjs";

function tunedWorkspace() {
  return {
    schema: "premiere316.director-webapp/v1",
    selectedSegmentId: "segment-02",
    playheadFrame: 193,
    settings: { frameRate: 24, customWidth: 1920, customHeight: 816 },
    timeline: {
      global_prompt: "unsynced global direction",
      segments: [
        {
          id: "segment-01",
          prompt: "preserve first prompt",
          start: 0,
          length: 193,
          storyboardFrameId: "frame-01",
          usePreviousAsFirstFrame: false,
          useNextAsLastFrame: true
        },
        {
          id: "segment-02",
          prompt: "unsynced tuned prompt",
          start: 193,
          length: 211,
          storyboardFrameId: "frame-02",
          usePreviousAsFirstFrame: true,
          useNextAsLastFrame: false
        }
      ],
      audioSegments: [],
      motionSegments: []
    },
    premiere: {
      projectSlug: "harrowing_of_hell",
      clipId: "H01-S01-C02",
      source: "storyboard",
      generateOptionId: "harrowing_aaa_i2v_segmented",
      planFingerprint: "old-fingerprint",
      storyboardUpdatedAt: "old-storyboard-time",
      referenceCount: 0,
      expectedReferenceCount: 0,
      semanticReferences: [],
      semanticReferenceRoles: [],
      customServerOwnedField: "keep-me"
    }
  };
}

test("refreshes only the bound reference metadata and preserves unsynced segment tuning", () => {
  const workspace = tunedWorkspace();
  const timelineBefore = structuredClone(workspace.timeline);
  const reference = {
    id: "ref-user-01",
    frameId: "frame-02",
    role: "identity",
    file: "media/assets/char-user.png",
    persistenceOrigin: "user"
  };
  const refreshed = workspaceWithRefreshedReferenceBinding(workspace, {
    projectSlug: "harrowing_of_hell",
    clipId: "H01-S01-C02",
    generationMode: "i2v_segmented_first_frames",
    referenceMode: "explicit_user_segment_references",
    referenceRoot: null,
    referenceIndexHash: "index-hash",
    references: [reference],
    semanticReferences: [],
    referencesReady: true,
    invalidReferences: [],
    planFingerprint: "new-fingerprint",
    storyboardUpdatedAt: "new-storyboard-time"
  });

  assert.deepEqual(refreshed.timeline, timelineBefore);
  assert.equal(refreshed.selectedSegmentId, "segment-02");
  assert.equal(refreshed.playheadFrame, 193);
  assert.equal(refreshed.timeline.segments[1].prompt, "unsynced tuned prompt");
  assert.equal(refreshed.timeline.segments[1].length, 211);
  assert.equal(refreshed.timeline.segments[1].usePreviousAsFirstFrame, true);
  assert.equal(refreshed.timeline.segments[0].useNextAsLastFrame, true);
  assert.equal(refreshed.premiere.customServerOwnedField, "keep-me");
  assert.equal(refreshed.premiere.planFingerprint, "new-fingerprint");
  assert.equal(refreshed.premiere.storyboardUpdatedAt, "new-storyboard-time");
  assert.equal(refreshed.premiere.referenceCount, 1);
  assert.equal(refreshed.premiere.expectedReferenceCount, 1);
  assert.deepEqual(refreshed.premiere.semanticReferences, [reference]);
  assert.deepEqual(refreshed.premiere.semanticReferenceRoles, ["identity"]);
  assert.equal(refreshed.premiere.semanticReferencesReady, true);
  assert.equal(workspace.premiere.planFingerprint, "old-fingerprint", "the caller workspace remains immutable");
});

test("rejects reference metadata for a scene other than the current binding", () => {
  assert.throws(
    () => workspaceWithRefreshedReferenceBinding(tunedWorkspace(), {
      projectSlug: "harrowing_of_hell",
      clipId: "H02-S01-C01",
      references: []
    }),
    /does not match the currently bound/
  );
});
