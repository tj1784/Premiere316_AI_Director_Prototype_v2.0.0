import assert from "node:assert/strict";
import test from "node:test";
import {
  directorJobConflictsWithQueueRequest,
  queueReservationSegmentIds,
  SegmentQueueReservationConflict,
  SegmentQueueReservations,
  submitCompiledJobsIndividually
} from "./segment-queue.mjs";

function testWorkspace() {
  return {
    selectedSegmentId: "segment-03",
    timeline: {
      segments: [
        { id: "segment-01", type: "image", length: 72 },
        { id: "segment-02", type: "image", length: 72, missingGuide: true },
        { id: "segment-03", type: "video", length: 48 },
        { id: "segment-04", type: "image", length: 168 },
        { id: "audio-01", type: "audio", length: 360 },
        { id: "zero-length", type: "image", length: 0 }
      ]
    }
  };
}

test("derives the complete reservation scope before validation and compilation", () => {
  const workspace = testWorkspace();
  assert.deepEqual(queueReservationSegmentIds("segments", workspace), [
    "segment-01",
    "segment-02",
    "segment-03",
    "segment-04"
  ]);
  assert.deepEqual(queueReservationSegmentIds("selected", workspace), ["segment-03"]);
  assert.deepEqual(queueReservationSegmentIds("selected", workspace, "segment-02"), ["segment-02"]);
  assert.deepEqual(queueReservationSegmentIds("timeline", workspace), ["*"]);
});

test("atomically rejects a duplicate segment reservation while allowing unrelated work", () => {
  const reservations = new SegmentQueueReservations();
  const first = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-01"],
    reservationId: "first-request"
  });

  assert.throws(
    () => reservations.reserve({
      projectSlug: "harrowing",
      clipId: "H01-S01-C01",
      segmentIds: ["segment-01"],
      reservationId: "duplicate-request"
    }),
    (error) => error instanceof SegmentQueueReservationConflict
      && error.status === 409
      && error.segmentId === "segment-01"
      && error.reservationId === "first-request"
  );

  const adjacent = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-02"],
    reservationId: "adjacent-request"
  });
  const otherClip = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C02",
    segmentIds: ["segment-01"],
    reservationId: "other-clip-request"
  });
  assert.equal(reservations.size, 3);

  first.release();
  first.release();
  assert.equal(reservations.size, 2, "release must be idempotent and must not disturb other leases");
  const retry = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-01"],
    reservationId: "retry-request"
  });
  retry.release();
  adjacent.release();
  otherClip.release();
  assert.equal(reservations.size, 0);
});

test("timeline and segment active-job guards are symmetric without blocking unrelated segments", () => {
  const activeSegment = {
    status: "running",
    refs: {
      mode: "selected",
      segmentId: "segment-02",
      binding: { projectSlug: "harrowing", clipId: "H01-S01-C01" }
    }
  };
  const activeTimeline = {
    status: "queued",
    refs: {
      mode: "timeline",
      segmentId: null,
      binding: { projectSlug: "harrowing", clipId: "H01-S01-C01" }
    }
  };
  const base = { projectSlug: "harrowing", clipId: "H01-S01-C01" };

  assert.equal(directorJobConflictsWithQueueRequest(activeSegment, { ...base, mode: "timeline" }), true);
  assert.equal(directorJobConflictsWithQueueRequest(activeTimeline, { ...base, mode: "selected", segmentIds: ["segment-04"] }), true);
  assert.equal(directorJobConflictsWithQueueRequest(activeSegment, { ...base, mode: "selected", segmentIds: ["segment-02"] }), true);
  assert.equal(directorJobConflictsWithQueueRequest(activeSegment, { ...base, mode: "selected", segmentIds: ["segment-04"] }), false);
  assert.equal(directorJobConflictsWithQueueRequest(activeSegment, { ...base, clipId: "H01-S01-C02", mode: "timeline" }), false);
  assert.equal(directorJobConflictsWithQueueRequest({ ...activeSegment, status: "complete" }, { ...base, mode: "timeline" }), false);
});

test("reserves a full segment batch atomically and makes timeline scope exclusive", () => {
  const reservations = new SegmentQueueReservations();
  const scene = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-01", "segment-02", "segment-03", "segment-04"],
    reservationId: "all-segments"
  });
  assert.equal(reservations.size, 4);

  assert.throws(() => reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["new-segment", "segment-03"],
    reservationId: "overlapping-batch"
  }), SegmentQueueReservationConflict);
  assert.equal(reservations.size, 4, "a failed multi-segment acquisition must not reserve its non-conflicting keys");

  assert.throws(() => reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["*"],
    reservationId: "timeline"
  }), SegmentQueueReservationConflict);

  scene.release();
  const timeline = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["*"],
    reservationId: "timeline"
  });
  assert.throws(() => reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-04"],
    reservationId: "selected"
  }), SegmentQueueReservationConflict);
  timeline.release();
  assert.equal(reservations.size, 0);
});

test("concurrent requests cannot both enter validation for the same segment", async () => {
  const reservations = new SegmentQueueReservations();
  let finishFirst;
  const validationGate = new Promise((resolve) => { finishFirst = resolve; });
  let firstEnteredValidation = false;

  async function queueRequest(requestId) {
    const lease = reservations.reserve({
      projectSlug: "harrowing",
      clipId: "H01-S01-C01",
      segmentIds: ["segment-02"],
      reservationId: requestId
    });
    try {
      firstEnteredValidation = true;
      await validationGate;
      return requestId;
    } finally {
      lease.release();
    }
  }

  const first = queueRequest("first");
  await Promise.resolve();
  assert.equal(firstEnteredValidation, true);
  await assert.rejects(queueRequest("second"), SegmentQueueReservationConflict);
  assert.equal(reservations.size, 1);

  finishFirst();
  assert.equal(await first, "first");
  assert.equal(reservations.size, 0);
});

test("submits four compiled segment jobs as four ordered independent prompt calls", async () => {
  const compiled = [1, 2, 3, 4].map((index) => ({
    job: { sourceSegmentId: `segment-0${index}`, requestedFrames: index === 3 ? 48 : 72 },
    built: { prompt: { [index]: { class_type: "TestNode", inputs: {} } } }
  }));
  const calls = [];
  const result = await submitCompiledJobsIndividually(compiled, async (entry, index) => {
    calls.push({ entry, index });
    return { promptId: `prompt-${index + 1}`, segmentId: entry.job.sourceSegmentId };
  });

  assert.equal(result.error, null);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map((call) => call.entry.built.prompt)).size, 4);
  assert.deepEqual(calls.map((call) => call.entry.job.sourceSegmentId), ["segment-01", "segment-02", "segment-03", "segment-04"]);
  assert.deepEqual(result.accepted.map((item) => item.promptId), ["prompt-1", "prompt-2", "prompt-3", "prompt-4"]);
});

test("submits one selected segment as exactly one prompt call", async () => {
  const compiled = [{ job: { sourceSegmentId: "segment-03" }, built: { prompt: { 3: {} } } }];
  let calls = 0;
  const result = await submitCompiledJobsIndividually(compiled, async ({ job }) => {
    calls += 1;
    return { promptId: "prompt-selected", segmentId: job.sourceSegmentId };
  });
  assert.equal(calls, 1);
  assert.equal(result.error, null);
  assert.deepEqual(result.accepted, [{ promptId: "prompt-selected", segmentId: "segment-03" }]);
});

test("reports an exact partial acceptance without combining or retrying jobs", async () => {
  const compiled = [1, 2, 3, 4].map((index) => ({ job: { sourceSegmentId: `segment-0${index}` }, built: { prompt: { [index]: {} } } }));
  const calls = [];
  const result = await submitCompiledJobsIndividually(compiled, async ({ job }) => {
    calls.push(job.sourceSegmentId);
    if (job.sourceSegmentId === "segment-03") throw new Error("submission failed");
    return { promptId: `prompt-${job.sourceSegmentId}`, segmentId: job.sourceSegmentId };
  });
  assert.deepEqual(calls, ["segment-01", "segment-02", "segment-03"]);
  assert.deepEqual(result.accepted.map((item) => item.segmentId), ["segment-01", "segment-02"]);
  assert.match(result.error.message, /submission failed/);
});

test("retains an accepted prompt in the response if local ledger tracking fails afterward", async () => {
  const compiled = [{ job: { sourceSegmentId: "segment-01" }, built: { prompt: { 1: {} } } }];
  const result = await submitCompiledJobsIndividually(
    compiled,
    async () => ({ promptId: "already-on-comfy", segmentId: "segment-01" }),
    async () => { throw new Error("ledger unavailable"); }
  );
  assert.deepEqual(result.accepted, [{ promptId: "already-on-comfy", segmentId: "segment-01" }]);
  assert.match(result.error.message, /ledger unavailable/);
});

test("releases the full reservation after partial acceptance so unaccepted segments can retry", async () => {
  const reservations = new SegmentQueueReservations();
  const segmentIds = ["segment-01", "segment-02", "segment-03", "segment-04"];
  const lease = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds,
    reservationId: "partial-request"
  });
  let submission;
  try {
    const compiled = segmentIds.map((segmentId) => ({ job: { sourceSegmentId: segmentId }, built: { prompt: {} } }));
    submission = await submitCompiledJobsIndividually(compiled, async ({ job }) => {
      if (job.sourceSegmentId === "segment-03") throw new Error("Comfy rejected segment-03");
      return { promptId: `prompt-${job.sourceSegmentId}`, segmentId: job.sourceSegmentId };
    });
  } finally {
    lease.release();
  }

  assert.deepEqual(submission.accepted.map((item) => item.segmentId), ["segment-01", "segment-02"]);
  assert.match(submission.error.message, /segment-03/);
  assert.equal(reservations.size, 0);
  const retry = reservations.reserve({
    projectSlug: "harrowing",
    clipId: "H01-S01-C01",
    segmentIds: ["segment-03"],
    reservationId: "retry-unaccepted"
  });
  retry.release();
});
