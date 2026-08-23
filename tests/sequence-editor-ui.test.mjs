import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../client/src/components/SequenceEditorWorkspace.tsx", import.meta.url), "utf8");

test("the edit room reserves video decoders for Source, Program, and next-clip preload", () => {
  const videoTags = source.match(/<video\b/g) || [];
  assert.equal(videoTags.length, 3, "bin and timeline thumbnails must not mount one video decoder per media item");
  assert.match(source, /data-testid="sequence-editor-source-video"/);
  assert.match(source, /data-testid="sequence-editor-program-video"/);
  assert.match(source, /data-testid="sequence-editor-program-preload"/);
  assert.doesNotMatch(source, /sequence-edit-video-clip-thumb/);
});

test("take filters restore Active, Latest/segment, and All with Active default", () => {
  assert.match(source, /sequence-editor-take-filter-\$\{filter\}/);
  assert.match(source, /Latest \/ segment/);
  assert.match(source, /TAKE_FILTERS/);
  assert.match(source, /DEFAULT_TAKE_FILTER/);
  assert.match(source, /filterTakes/);
});

test("folder drop reports a structured import job instead of a success-only count", () => {
  assert.match(source, /sequence-editor-import-report/);
  assert.match(source, /preflightDroppedFile/);
  assert.match(source, /summarizeImportJob/);
  assert.match(source, /Retry failed/);
  assert.doesNotMatch(source, /skip failed copies; never overwrite/);
});

test("program transport holds the clock while media is not ready", () => {
  assert.match(source, /HAVE_FUTURE_DATA/);
  assert.match(source, /sequence-editor-program-buffering/);
  assert.match(source, /createPreviewGainController/);
});

test("monitor playback failures are visible instead of silently black", () => {
  assert.match(source, /data-testid="sequence-editor-source-error"/);
  assert.match(source, /data-testid="sequence-editor-program-error"/);
  assert.match(source, /projectMediaUrl\(slug, relativeFile\)/);
});
