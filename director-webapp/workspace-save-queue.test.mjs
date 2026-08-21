import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceSaveQueue } from "./public/workspace-save-queue.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

test("serializes workspace saves and refuses to restore a stale segment selection", async () => {
  const requests = [];
  const firstResponse = deferred();
  const secondResponse = deferred();
  const responses = [firstResponse, secondResponse];
  const saves = createWorkspaceSaveQueue((snapshot) => {
    requests.push(snapshot);
    return responses[requests.length - 1].promise;
  });

  const workspace = {
    selectedSegmentId: "segment-01",
    timeline: {
      segments: [
        { id: "segment-01", prompt: "prompt 01" },
        { id: "segment-02", prompt: "prompt 02" }
      ]
    }
  };

  saves.markChanged();
  const firstSave = saves.save(workspace);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].selectedSegmentId, "segment-01");

  workspace.selectedSegmentId = "segment-02";
  saves.markChanged();
  const secondSave = saves.save(workspace);
  await Promise.resolve();
  assert.equal(requests.length, 1, "the second PUT must wait for the first PUT");

  firstResponse.resolve({ workspace: { ...requests[0] } });
  const stale = await firstSave;
  assert.equal(stale.current, false);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].selectedSegmentId, "segment-02");
  assert.equal(requests[1].timeline.segments[1].prompt, "prompt 02");

  secondResponse.resolve({ workspace: { ...requests[1] } });
  const current = await secondSave;
  assert.equal(current.current, true);
  assert.equal(current.result.workspace.selectedSegmentId, "segment-02");
});

test("continues with the latest save after an earlier PUT fails", async () => {
  const requests = [];
  const saves = createWorkspaceSaveQueue(async (snapshot) => {
    requests.push(snapshot.selectedSegmentId);
    if (snapshot.selectedSegmentId === "segment-01") throw new Error("old save failed");
    return { workspace: snapshot };
  });

  saves.markChanged();
  const first = saves.save({ selectedSegmentId: "segment-01" });
  saves.markChanged();
  const second = saves.save({ selectedSegmentId: "segment-02" });

  await assert.rejects(first, /old save failed/);
  const result = await second;
  assert.deepEqual(requests, ["segment-01", "segment-02"]);
  assert.equal(result.current, true);
});
