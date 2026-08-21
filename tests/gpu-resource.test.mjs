import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireGpuLease,
  gpuLeaseStatus,
  GPU_RESOURCE_OWNERS,
  releaseGpuLease,
  resetGpuLeaseForTests,
  updateGpuLease
} from "../server/gpu-resource-manager.js";

test.beforeEach(() => resetGpuLeaseForTests());
test.afterEach(() => resetGpuLeaseForTests());

test("GPU lease is re-entrant for one engine and rejects a competing local model", () => {
  acquireGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, {
    label: "IndexTTS-2.5",
    jobId: "job_index",
    state: "loading"
  });
  updateGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, { state: "loaded", workerPid: 316 });
  assert.deepEqual(gpuLeaseStatus(), {
    owner: "index-tts",
    label: "IndexTTS-2.5",
    jobId: "job_index",
    workerPid: 316,
    state: "loaded",
    acquiredAt: gpuLeaseStatus().acquiredAt,
    updatedAt: gpuLeaseStatus().updatedAt
  });
  assert.throws(
    () => acquireGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, { label: "Qwen3-TTS VoiceDesign" }),
    (error) => error?.code === "GPU_LEASE_BUSY" && error?.statusCode === 409
  );
  assert.equal(releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN), false);
  assert.equal(releaseGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS), true);
  assert.equal(gpuLeaseStatus(), null);
});

