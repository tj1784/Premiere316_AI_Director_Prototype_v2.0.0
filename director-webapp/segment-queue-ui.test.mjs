import test from "node:test";
import assert from "node:assert/strict";

import {
  isVisualGenerationSegment,
  orderedVisualSegments,
  queueRequestBody,
  segmentNeighborState,
  segmentPromptPreview,
  selectTimelineSegment,
  shouldCommitSegmentDrag
} from "./public/segment-queue-ui.mjs";

const workspace = {
  selectedSegmentId: "segment-02",
  timeline: {
    segments: [
      { id: "text", type: "text", start: 0, length: 24, prompt: "Do not change me" },
      { id: "segment-03", type: "image", start: 48, length: 24, imageFile: "03.png" },
      { id: "segment-01", type: "image", start: 0, length: 24, imageFile: "01.png" },
      { id: "missing", type: "image", start: 72, length: 24, missingGuide: true },
      {
        id: "segment-02",
        type: "video",
        start: 24,
        length: 24,
        projectMediaPath: "media/02.mp4",
        usePreviousAsFirstFrame: true,
        useNextAsLastFrame: true
      }
    ]
  }
};

test("orderedVisualSegments returns only queueable visual segments in timeline order", () => {
  assert.deepEqual(orderedVisualSegments(workspace).map((segment) => segment.id), ["segment-01", "segment-02", "segment-03"]);
  assert.equal(isVisualGenerationSegment(workspace.timeline.segments[0]), false);
  assert.equal(isVisualGenerationSegment(workspace.timeline.segments[3]), false);
});

test("segmentNeighborState exposes the exact optional first and last frame neighbors", () => {
  const middle = segmentNeighborState(workspace, "segment-02");
  assert.equal(middle.previous.id, "segment-01");
  assert.equal(middle.next.id, "segment-03");
  assert.equal(middle.canUsePreviousAsFirstFrame, true);
  assert.equal(middle.canUseNextAsLastFrame, true);
  assert.equal(middle.usePreviousAsFirstFrame, true);
  assert.equal(middle.useNextAsLastFrame, true);

  const first = segmentNeighborState(workspace, "segment-01");
  assert.equal(first.previous, null);
  assert.equal(first.canUsePreviousAsFirstFrame, false);
  assert.equal(first.usePreviousAsFirstFrame, false);
  assert.equal(first.next.id, "segment-02");

  const last = segmentNeighborState(workspace, "segment-03");
  assert.equal(last.next.id, "missing");
  assert.equal(last.canUseNextAsLastFrame, false);
  assert.equal(last.useNextAsLastFrame, false);
});

test("neighbor controls do not skip an unusable immediate visual neighbor", () => {
  const blocked = structuredClone(workspace);
  const missing = blocked.timeline.segments.find((segment) => segment.id === "missing");
  missing.start = 36;
  const middle = segmentNeighborState(blocked, "segment-02");
  assert.equal(middle.next.id, "missing");
  assert.equal(middle.canUseNextAsLastFrame, false);
  assert.equal(middle.useNextAsLastFrame, false);

  missing.missingGuide = false;
  missing.type = "video";
  missing.videoFile = "neighbor.mp4";
  const videoNeighbor = segmentNeighborState(blocked, "segment-02");
  assert.equal(videoNeighbor.next.id, "missing");
  assert.equal(videoNeighbor.canUseNextAsLastFrame, false);
});

test("queueRequestBody keeps one-segment tuning and all-segments submission explicit", () => {
  assert.deepEqual(queueRequestBody("selected", workspace, "segment-03"), {
    mode: "selected",
    segmentId: "segment-03"
  });
  assert.deepEqual(queueRequestBody("segments", workspace, "segment-03"), { mode: "segments" });
  assert.deepEqual(queueRequestBody("timeline", workspace), { mode: "timeline" });
});

test("selectTimelineSegment immediately exposes the selected segment's own prompt", () => {
  const selectionWorkspace = structuredClone(workspace);
  selectionWorkspace.timeline.segments.find((segment) => segment.id === "segment-02").prompt = "Prompt two";
  selectionWorkspace.timeline.segments.find((segment) => segment.id === "segment-03").prompt = "Prompt three";
  const segmentTwo = selectTimelineSegment(selectionWorkspace, "segment-02");
  assert.equal(segmentTwo.prompt, "Prompt two");
  assert.equal(selectionWorkspace.selectedSegmentId, "segment-02");
  assert.equal(selectionWorkspace.playheadFrame, 24);

  const segmentThree = selectTimelineSegment(selectionWorkspace, "segment-03");
  assert.equal(selectionWorkspace.selectedSegmentId, "segment-03");
  assert.equal(selectionWorkspace.playheadFrame, 48);
  assert.equal(segmentThree.prompt, "Prompt three");
  assert.equal(selectTimelineSegment(selectionWorkspace, "does-not-exist"), null);
});

test("segmentPromptPreview shows each segment's unique action instead of its shared setup", () => {
  const prompts = [
    "Begin exactly from the supplied frame. Jesus continues an extremely slow upright descent in supernatural near-stasis.",
    "Begin exactly from the supplied frame. Jesus completes one controlled pitch into a straight head-first vertical fall.",
    "Begin exactly from the supplied overhead frame. Camera remains absolutely stationary.",
    "Begin exactly from the empty-shaft frame. Camera launches straight down after the tiny dim ivory-white trace."
  ];
  const previews = prompts.map((prompt) => segmentPromptPreview({ prompt }));
  assert.deepEqual(previews, [
    "Jesus continues an extremely slow upright descent in supernatural near-stasis.",
    "Jesus completes one controlled pitch into a straight head-first vertical fall.",
    "Camera remains absolutely stationary.",
    "Camera launches straight down after the tiny dim ivory-white trace."
  ]);
  assert.equal(new Set(previews).size, 4);
  assert.equal(segmentPromptPreview({ prompt: "A unique one-sentence action." }), "A unique one-sentence action.");
  assert.equal(segmentPromptPreview({ prompt: "Begin exactly from this frame" }), "Begin exactly from this frame");
  assert.equal(segmentPromptPreview({ prompt: "" }), "");
});

test("segment drag commits only real pointer movement and never pointer cancellation", () => {
  assert.equal(shouldCommitSegmentDrag(0), false);
  assert.equal(shouldCommitSegmentDrag(1), true);
  assert.equal(shouldCommitSegmentDrag(-4), true);
  assert.equal(shouldCommitSegmentDrag(3, true), false);
});
