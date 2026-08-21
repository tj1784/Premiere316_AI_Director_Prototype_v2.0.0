import assert from "node:assert/strict";
import test from "node:test";
import { buildSegmentJobs } from "./workflow-compiler.mjs";
import {
  applyContinuationHandoff,
  continuationTargetForSegment,
  segmentQueueReadiness
} from "./segment-continuity.mjs";

function h02Storyboard({ locked = false } = {}) {
  return {
    clips: { "H02-S03-C01": { id: "H02-S03-C01", videoPlanId: "video-h02" } },
    videoPlans: { "video-h02": { id: "video-h02", segmentIds: ["segment-a", "segment-b"] } },
    segments: {
      "segment-a": {
        id: "segment-a",
        frameId: "frame-a",
        lengthFrames: 144,
        activeTakeId: "take-v1",
        activeGeneratedVersion: 1,
        activeTakeLocked: locked,
        generatedVersions: [{ id: "take-v1", v: 1, comfyPromptId: "prompt-1" }],
        mythicDialoguePass: {
          packageId: "h02_qwen_mythic_dialogue_v1",
          renderId: "H02-S03-C01-SEG01",
          handoffFrameIndex: 144,
          outputHandoff: "expanded_handoffs/H02-S03-C01_SEG01_TAIL_F0144.png"
        }
      },
      "segment-b": { id: "segment-b", frameId: "frame-b", lengthFrames: 192, status: "blocked" }
    },
    frames: {
      "frame-a": { id: "frame-a", status: "generated" },
      "frame-b": {
        id: "frame-b",
        status: "pending_accepted_decoded_tail",
        activeGeneratedVersion: null,
        generatedFile: null,
        generatedVersions: [],
        continuityInput: {
          required: true,
          status: "pending_accepted_decoded_tail",
          previousRenderId: "H02-S03-C01-SEG01",
          expectedSource: "expanded_handoffs/H02-S03-C01_SEG01_TAIL_F0144.png",
          decodedFrameIndex: 144
        }
      }
    }
  };
}

test("segmented mode queues its ready subset while a later continuation guide is pending", () => {
  const timeline = {
    segments: [
      { id: "ready", type: "image", imageFile: "ready.png", storyboardFrameId: "frame-ready" },
      { id: "later", type: "image", missingGuide: true, storyboardFrameId: "frame-later" }
    ]
  };
  const jobs = [{ sourceSegmentId: "ready" }];
  assert.deepEqual(segmentQueueReadiness(timeline, jobs, "segments"), {
    ready: true,
    hasVisualGuide: true,
    missingGuides: ["frame-later"],
    reason: null
  });
  assert.equal(segmentQueueReadiness(timeline, jobs, "selected").ready, true);
  assert.deepEqual(segmentQueueReadiness(timeline, jobs, "timeline"), {
    ready: false,
    hasVisualGuide: true,
    missingGuides: ["frame-later"],
    reason: "timeline_missing_guides"
  });
});

test("resolves and commits the exact H02 N+1 tail into only the immediate next frame", () => {
  const storyboard = h02Storyboard();
  const target = continuationTargetForSegment(storyboard, "H02-S03-C01", "segment-a");
  assert.equal(target.targetFrameId, "frame-b");
  assert.equal(target.decodedFrameIndex, 144);
  assert.equal(target.pending, true);
  const result = applyContinuationHandoff(storyboard, {
    clipId: "H02-S03-C01",
    sourceSegmentId: "segment-a",
    sourcePromptId: "prompt-1",
    sourceTakeId: "take-v1",
    handoff: {
      file: "H02-S03-C01_SEG01_TAIL_F0144.png",
      bytes: 1234,
      sha256: "a".repeat(64),
      sourcePromptId: "prompt-1",
      sourceFrameIndex: 144,
      workflowHash: "b".repeat(64),
      createdAt: "2026-08-21T12:00:00.000Z"
    }
  });
  assert.equal(result.applied, true);
  assert.equal(storyboard.frames["frame-b"].generatedFile, "H02-S03-C01_SEG01_TAIL_F0144.png");
  assert.equal(storyboard.frames["frame-b"].continuityInput.acceptedSourceTakeId, "take-v1");
  assert.equal(storyboard.frames["frame-b"].generatedVersions[0].sourceFrameIndex, 144);
  assert.equal(storyboard.segments["segment-b"].status, "ready");
});

test("does not advance a continuation from a render that is not the active selected take", () => {
  const storyboard = h02Storyboard({ locked: true });
  storyboard.segments["segment-a"].generatedVersions.push({ id: "take-v2", v: 2, comfyPromptId: "prompt-2" });
  const result = applyContinuationHandoff(storyboard, {
    clipId: "H02-S03-C01",
    sourceSegmentId: "segment-a",
    sourcePromptId: "prompt-2",
    sourceTakeId: "take-v2",
    handoff: {
      file: "new-tail.png",
      bytes: 99,
      sha256: "c".repeat(64),
      sourcePromptId: "prompt-2",
      sourceFrameIndex: 144
    }
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "source_take_not_active");
  assert.equal(storyboard.frames["frame-b"].generatedVersions.length, 0);
  assert.equal(storyboard.frames["frame-b"].status, "pending_accepted_decoded_tail");
});

test("supports H04 corrected-pass continuity and its authored decoded-frame floor", () => {
  const storyboard = h02Storyboard();
  const source = storyboard.segments["segment-a"];
  delete source.mythicDialoguePass;
  source.lengthFrames = 41;
  source.correctedPass = {
    packageId: "h04_corrected_visual_dialogue_v1_live_storyboard_patch",
    passId: "H04-S10-C01-P01",
    acceptedTailDestination: "expected_handoffs/H04-S10-C01-P01_NPLUS1.png",
    tailExportDecodedIndex: 41,
    ltxRequiredDecodedFrames: 97
  };
  const frame = storyboard.frames["frame-b"];
  frame.continuityInput = {
    required: true,
    status: "pending_accepted_decoded_tail",
    previousPassId: "H04-S10-C01-P01",
    expectedSource: "expected_handoffs/H04-S10-C01-P01_NPLUS1.png",
    decodedFrameIndex: 41
  };
  assert.equal(continuationTargetForSegment(storyboard, "H02-S03-C01", "segment-a").contractKind, "corrected_pass");

  const workspace = {
    settings: { frameRate: 24, guideStrength: "1.00" },
    timeline: {
      segments: [
        {
          id: "segment-a",
          type: "image",
          start: 0,
          length: 41,
          prompt: "first",
          imageFile: "first.png",
          acceptedTailDestination: source.correctedPass.acceptedTailDestination,
          correctedPass: source.correctedPass
        },
        { id: "segment-b", type: "image", start: 41, length: 48, prompt: "second", missingGuide: true }
      ],
      motionSegments: [],
      audioSegments: []
    }
  };
  const [job] = buildSegmentJobs(workspace);
  assert.equal(job.requestedFrames, 41);
  assert.equal(job.generationFrames, 97);
});
