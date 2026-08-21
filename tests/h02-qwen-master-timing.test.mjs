import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  H02_SPEECH_HANDLE_POLICY,
  resolveH02SpeechTiming
} from "../scripts/import-h02-qwen-masters.mjs";

const RATE = 48_000;
const REPO = path.resolve(import.meta.dirname, "..");

function normalTiming(overrides = {}) {
  return resolveH02SpeechTiming({
    cueId: "D001",
    cueTargetVoiceDurationSec: 7,
    cueTargetVideoDurationSec: 8,
    manifestTargetVoiceDurationSec: 7,
    segmentStartFrame: 144,
    segmentLengthFrames: 192,
    timelineLengthFrames: 1008,
    wavSampleFrames: 7 * RATE,
    wavSampleRate: RATE,
    ...overrides
  });
}

test("normal H02 speech uses an 11-frame lead and 13-frame picture tail without padding the WAV", () => {
  const timing = normalTiming();
  assert.deepEqual(H02_SPEECH_HANDLE_POLICY, {
    fps: 24,
    leadFrames: 11,
    normalTailFrames: 13,
    d032TailFrames: 61,
    handlesArePictureTimelineOnly: true,
    masterWavContainsHandles: false
  });
  assert.equal(timing.audioStartFrame, 155);
  assert.equal(timing.audioFrames, 168);
  assert.equal(timing.audioEndFrame, 323);
  assert.equal(timing.segmentEndFrame, 336);
  assert.equal(timing.leadDurationSec, 11 / 24);
  assert.equal(timing.minimumTailDurationSec, 13 / 24);
  assert.equal(timing.actualTailFrames, 13);
  assert.equal(timing.masterVoiceDurationSec, 7);
  assert.equal(timing.videoTargetFrames, 192);
  assert.equal(timing.masterWavContainsHandles, false);
});

test("a shorter voice master remains voice-only and simply leaves more picture-tail silence", () => {
  const timing = normalTiming({ wavSampleFrames: 6.75 * RATE });
  assert.equal(timing.audioFrames, 162);
  assert.equal(timing.masterVoiceDurationSec, 6.75);
  assert.equal(timing.actualTailFrames, 19);
  assert.equal(timing.audioFrames + timing.leadFrames + timing.actualTailFrames, timing.videoTargetFrames);
});

test("D032 preserves its authored longer true-silence tail", () => {
  const timing = resolveH02SpeechTiming({
    cueId: "D032",
    cueTargetVoiceDurationSec: 2,
    cueTargetVideoDurationSec: 5,
    manifestTargetVoiceDurationSec: 2,
    segmentStartFrame: 0,
    segmentLengthFrames: 120,
    timelineLengthFrames: 384,
    wavSampleFrames: 2 * RATE,
    wavSampleRate: RATE
  });
  assert.equal(timing.audioStartFrame, 11);
  assert.equal(timing.audioFrames, 48);
  assert.equal(timing.audioEndFrame, 59);
  assert.equal(timing.minimumTailFrames, 61);
  assert.equal(timing.actualTailFrames, 61);
  assert.equal(timing.minimumTailDurationSec, 61 / 24);
});

test("all 34 imported H02 speech passes satisfy the exact handle and segment-bound policy", () => {
  const project = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "harrowing_of_hell", "project.json"), "utf8"));
  const storyboard = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "harrowing_of_hell", "production", "storyboard.json"), "utf8"));
  const cues = (project.sound?.dialogueCues || []).filter((cue) => cue.sourcePackageId === "h02_qwen_mythic_dialogue_v1");
  assert.equal(cues.length, 34);
  const seen = new Set();
  for (const cue of cues) {
    const clip = storyboard.clips?.[cue.clipId];
    const plan = clip && storyboard.videoPlans?.[clip.videoPlanId];
    const matches = (plan?.timelineData?.segments || []).filter((segment) => segment.audioCue?.cueId === cue.cueId);
    assert.equal(matches.length, 1, `${cue.cueId} exact authored segment binding`);
    const segment = matches[0];
    const timing = resolveH02SpeechTiming({
      cueId: cue.cueId,
      cueTargetVoiceDurationSec: cue.targetVoiceDurationSec,
      cueTargetVideoDurationSec: cue.targetVideoDurationSec,
      manifestTargetVoiceDurationSec: cue.targetVoiceDurationSec,
      segmentStartFrame: segment.start,
      segmentLengthFrames: segment.length,
      timelineLengthFrames: plan.timelineData.normalDurationFrames,
      wavSampleFrames: cue.targetVoiceDurationSec * RATE,
      wavSampleRate: RATE
    });
    assert.equal(timing.audioStartFrame, segment.start + 11, `${cue.cueId} lead`);
    assert.equal(timing.minimumTailFrames, cue.cueId === "D032" ? 61 : 13, `${cue.cueId} tail`);
    seen.add(cue.cueId);
  }
  assert.equal(seen.size, 34);
});

test("promotion fails closed when the manifest voice target drifts", () => {
  assert.throws(
    () => normalTiming({ manifestTargetVoiceDurationSec: 7.5 }),
    /render-manifest voice target differs/
  );
});

test("promotion fails closed when the video target and authored segment bounds drift", () => {
  assert.throws(
    () => normalTiming({ segmentLengthFrames: 191 }),
    /video target .* differs from its authored segment/
  );
  assert.throws(
    () => normalTiming({ segmentStartFrame: 900 }),
    /authored segment exceeds its timeline bounds/
  );
});

test("promotion rejects even one sample beyond the cue voice target", () => {
  assert.throws(
    () => normalTiming({ wavSampleFrames: 7 * RATE + 1 }),
    /master voice is longer than its 7\.000 s authoritative voice target/
  );
});

test("normal cues and D032 must retain their distinct authored handle topology", () => {
  assert.throws(
    () => normalTiming({
      cueTargetVoiceDurationSec: 6.5,
      manifestTargetVoiceDurationSec: 6.5,
      wavSampleFrames: 6.5 * RATE
    }),
    /violates the normal speech handle topology/
  );
  assert.throws(
    () => resolveH02SpeechTiming({
      cueId: "D032",
      cueTargetVoiceDurationSec: 2,
      cueTargetVideoDurationSec: 4.5,
      manifestTargetVoiceDurationSec: 2,
      segmentStartFrame: 0,
      segmentLengthFrames: 108,
      timelineLengthFrames: 384,
      wavSampleFrames: 2 * RATE,
      wavSampleRate: RATE
    }),
    /violates the D032 true-silence handle topology/
  );
});
