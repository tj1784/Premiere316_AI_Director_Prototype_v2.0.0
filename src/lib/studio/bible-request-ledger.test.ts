import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableBibleRequest } from "./bible-request-ledger.server.ts";
test("durable receipts prevent duplicate execution, payload substitution and unknown replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "p316-ledger-test-"));
  let calls = 0;
  const execute = async () => {
    calls++;
    return { text: "complete", modelId: "fixture", evidenceJson: "{}" };
  };
  try {
    const first = await durableBibleRequest("r1", { text: "a" }, false, execute, root);
    assert.deepEqual(await durableBibleRequest("r1", { text: "a" }, true, execute, root), first);
    assert.equal(calls, 1);
    await assert.rejects(
      durableBibleRequest("r1", { text: "b" }, false, execute, root),
      /different immutable/,
    );
    await assert.rejects(
      durableBibleRequest("unknown", {}, true, execute, root),
      /No durable receipt/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      durableBibleRequest(
        "failed",
        {},
        false,
        async () => {
          throw new Error("controlled failure");
        },
        root,
      ),
      /controlled failure/,
    );
    await assert.rejects(
      durableBibleRequest("failed", {}, false, execute, root),
      /controlled failure/,
    );
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
