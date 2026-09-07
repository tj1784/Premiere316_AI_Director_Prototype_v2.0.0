import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelSchedulerJob,
  completeSchedulerJob,
  emptySchedulerSnapshot,
  enqueueSchedulerJob,
  recoverSchedulerSnapshot,
  schedulerMustNotKill,
  schedulerQueueOrder,
  startNextSchedulerJob,
} from "./cross-media-scheduler.ts";

describe("Wave 5 cross-media scheduler", () => {
  it("orders ready jobs by priority without starting a second running job", () => {
    let snap = emptySchedulerSnapshot();
    snap = enqueueSchedulerJob(snap, { id: "a", kind: "video", pictureId: "p", label: "low", engineId: "ltx-2", priority: 1, createdAt: 1, dependsOn: [], vramHintBytes: 1 });
    snap = enqueueSchedulerJob(snap, { id: "b", kind: "video", pictureId: "p", label: "high", engineId: "ltx-2", priority: 50, createdAt: 2, dependsOn: [], vramHintBytes: 1 });
    assert.equal(schedulerQueueOrder(snap)[0].id, "b");
    snap = startNextSchedulerJob(snap, 3);
    const again = startNextSchedulerJob(snap, 4);
    assert.equal(again.jobs.filter((job) => job.status === "running").length, 1);
    snap = completeSchedulerJob(again, "b", false, "ADAPTER_UNAVAILABLE", 5);
    assert.equal(snap.jobs.find((job) => job.id === "b")?.status, "failed");
  });

  it("honors dependencies, cancel, and restart recovery without duplicate running work", () => {
    let snap = enqueueSchedulerJob(emptySchedulerSnapshot(), { id: "parent", kind: "image", pictureId: "p", label: "still", engineId: "flux2", priority: 10, createdAt: 1, dependsOn: [], vramHintBytes: 1 });
    snap = enqueueSchedulerJob(snap, { id: "child", kind: "video", pictureId: "p", label: "motion", engineId: "ltx-2", priority: 99, createdAt: 2, dependsOn: ["parent"], vramHintBytes: 1 });
    assert.equal(schedulerQueueOrder(snap)[0].id, "parent");
    snap = startNextSchedulerJob(snap, 3);
    snap = completeSchedulerJob(snap, "parent", true, null, 4);
    assert.equal(schedulerQueueOrder(snap)[0].id, "child");
    snap = startNextSchedulerJob(snap, 5);
    const recovered = recoverSchedulerSnapshot(snap, 6);
    assert.equal(recovered.jobs.find((job) => job.id === "child")?.status, "queued");
    const cancelled = cancelSchedulerJob(recovered, "child", 7);
    assert.equal(cancelled.jobs.find((job) => job.id === "child")?.status, "cancelled");
  });

  it("refuses to target operator-owned LM Studio or Comfy processes", () => {
    assert.equal(schedulerMustNotKill("LM Studio"), true);
    assert.equal(schedulerMustNotKill("python.exe"), true);
    assert.equal(schedulerMustNotKill("ComfyUI"), true);
    assert.equal(schedulerMustNotKill("Premiere316.exe"), false);
  });
});
