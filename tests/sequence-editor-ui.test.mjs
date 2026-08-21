import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../client/src/components/SequenceEditorWorkspace.tsx", import.meta.url), "utf8");

test("the edit room reserves video decoders for Source and Program monitors", () => {
  const videoTags = source.match(/<video\b/g) || [];
  assert.equal(videoTags.length, 2, "bin and timeline thumbnails must not mount one video decoder per media item");
  assert.match(source, /data-testid="sequence-editor-source-video"/);
  assert.match(source, /data-testid="sequence-editor-program-video"/);
  assert.doesNotMatch(source, /sequence-edit-video-clip-thumb/);
});

test("monitor playback failures are visible instead of silently black", () => {
  assert.match(source, /data-testid="sequence-editor-source-error"/);
  assert.match(source, /data-testid="sequence-editor-program-error"/);
  assert.match(source, /projectMediaUrl\(slug, relativeFile\)/);
});
