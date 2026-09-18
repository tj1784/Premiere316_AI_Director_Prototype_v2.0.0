import test from "node:test";
import assert from "node:assert/strict";
import { mergeVoiceRecords, mergePictureVoices } from "./voice-reconciliation.mjs";
test("revision beats wall clock; absent records survive; tombstones cannot be resurrected by stale state", () => {
  const old = { id: "a", revision: 1, updatedAt: 999, status: "APPROVED" },
    deleted = { id: "a", revision: 2, deletedAt: 3, updatedAt: 3 };
  assert.deepEqual(mergeVoiceRecords([deleted], [old]), [deleted]);
  assert.deepEqual(mergeVoiceRecords([old], []), [old]);
  assert.deepEqual(mergeVoiceRecords([old], [deleted]), [deleted]);
});
test("same-revision competing approvals are deterministic conflicts; a new explicit revision resolves them", () => {
  const a = { id: "a", revision: 2, status: "APPROVED" },
    b = { id: "a", revision: 2, status: "REJECTED" };
  const merged = mergeVoiceRecords([a], [b]);
  assert.deepEqual(merged, mergeVoiceRecords([b], [a]));
  assert.equal(merged[0].conflicts.length, 2);
  const reviewed = { id: "a", revision: 3, status: "APPROVED", conflicts: [] };
  assert.deepEqual(mergeVoiceRecords(merged, [reviewed]), [reviewed]);
});
test("physical preview relocation does not invalidate hash-bound identity or lose member warnings", () => {
  const a = {
    id: "a",
    revision: 2,
    memberId: "m1",
    reviewNote: "Warning",
    audio: { sha256: "hash", mediaUri: "/old" },
  };
  const b = { ...a, audio: { ...a.audio, mediaUri: "/new", previewUri: "/preview" } };
  const merged = mergeVoiceRecords([a], [b]);
  assert.equal(merged[0].conflicts, undefined);
  assert.equal(merged[0].memberId, "m1");
  assert.equal(merged[0].reviewNote, "Warning");
});
test("a newer unrelated picture save cannot wipe other character iterations or revive deletion", () => {
  const a = {
    id: "p",
    updatedAt: 1,
    characterVoiceDesigns: {
      profiles: [],
      iterations: [{ id: "i1", revision: 2 }],
      deletedAttachmentIds: ["gone"],
    },
  };
  const b = {
    id: "p",
    updatedAt: 9,
    characterVoiceDesigns: {
      profiles: [],
      iterations: [
        { id: "i2", revision: 1 },
        { id: "gone", revision: 1 },
      ],
    },
  };
  assert.deepEqual(
    mergePictureVoices(a, b).characterVoiceDesigns.iterations.map((/** @type {any} */ i) => i.id),
    ["i1", "i2"],
  );
});
