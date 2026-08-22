import test from "node:test";
import assert from "node:assert/strict";
import { patchStoryboardDirectionInMemory, mutateStoryboardStructureInMemory } from "../server/storyboard.js";

function board() {
  return {
    clips: { "H04-S13-C03": { id: "H04-S13-C03", dialogueAnchor: "old", continuityLocks: ["iron"], durationFrames: 240 } },
    segments: { "segment-c03-01": { id: "segment-c03-01", prompt: "old prompt", startFrame: 0, lengthFrames: 48 } }
  };
}

test("STB-001 segment prompt, timing, and locks persist", () => {
  const next = patchStoryboardDirectionInMemory(board(), {
    segmentId: "segment-c03-01",
    prompt: "David looks up",
    dialogueAnchor: "Who is there",
    startSec: 1,
    durationSec: 3,
    continuityLocks: ["collar", "chain"]
  }, 24);
  const segment = next.segments["segment-c03-01"];
  assert.equal(segment.prompt, "David looks up");
  assert.equal(segment.dialogueAnchor, "Who is there");
  assert.equal(segment.startFrame, 24);
  assert.equal(segment.lengthFrames, 72);
  assert.deepEqual(segment.continuityLocks, ["collar", "chain"]);
});

test("STB-001 clip dialogue and locks persist", () => {
  const next = patchStoryboardDirectionInMemory(board(), {
    clipId: "H04-S13-C03",
    dialogueAnchor: "Who is there",
    continuityLocks: ["keep the iron"]
  }, 24);
  assert.equal(next.clips["H04-S13-C03"].dialogueAnchor, "Who is there");
  assert.deepEqual(next.clips["H04-S13-C03"].continuityLocks, ["keep the iron"]);
});


function structuredBoard() {
  return {
    clips: { "H04-S13-C03": { id: "H04-S13-C03", videoPlanId: "plan-c03" } },
    videoPlans: { "plan-c03": { id: "plan-c03", segmentIds: ["segment-c03-01"] } },
    segments: { "segment-c03-01": { id: "segment-c03-01", prompt: "open", order: 1, startFrame: 0, lengthFrames: 48 } },
    referenceBindings: {}
  };
}

test("STB-003 add, duplicate, move, and refuse last delete", () => {
  const board = structuredBoard();
  mutateStoryboardStructureInMemory(board, { action: "add", clipId: "H04-S13-C03" });
  assert.equal(board.videoPlans["plan-c03"].segmentIds.length, 2);
  const added = board.videoPlans["plan-c03"].segmentIds[1];
  mutateStoryboardStructureInMemory(board, { action: "duplicate", clipId: "H04-S13-C03", segmentId: added });
  assert.equal(board.videoPlans["plan-c03"].segmentIds.length, 3);
  mutateStoryboardStructureInMemory(board, { action: "move", clipId: "H04-S13-C03", segmentId: added, toIndex: 0 });
  assert.equal(board.videoPlans["plan-c03"].segmentIds[0], added);
  mutateStoryboardStructureInMemory(board, { action: "delete", clipId: "H04-S13-C03", segmentId: added });
  assert.equal(board.videoPlans["plan-c03"].segmentIds.includes(added), false);
  assert.throws(() => {
    const last = board.videoPlans["plan-c03"].segmentIds[0];
    const lonely = structuredBoard();
    mutateStoryboardStructureInMemory(lonely, { action: "delete", clipId: "H04-S13-C03", segmentId: last });
  }, /at least one segment/);
});
