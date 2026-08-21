import assert from "node:assert/strict";
import test from "node:test";

import {
  sequenceClipChapterFolder,
  sequenceClipStoredFile
} from "../server/queue.js";

test("derives normalized H and MV chapter folders from stable clip identity fields", () => {
  assert.equal(sequenceClipChapterFolder({ chapterId: "h01" }), "H01");
  assert.equal(sequenceClipChapterFolder({ sceneId: "H02-S03" }), "H02");
  assert.equal(sequenceClipChapterFolder({ id: "H03-S04-C02" }), "H03");
  assert.equal(sequenceClipChapterFolder({ name: "Chapter MV01 - opening" }), "MV01");
  assert.equal(sequenceClipChapterFolder({ id: "notH03ish" }), null);
  assert.equal(sequenceClipChapterFolder({ name: "Untitled clip" }), null);
});

test("stores future generated clip files beneath their chapter while preserving legacy flat clips", () => {
  assert.equal(
    sequenceClipStoredFile({ id: "H03-S04-C02" }, "render_v01.mp4"),
    "H03/render_v01.mp4"
  );
  assert.equal(
    sequenceClipStoredFile({ name: "Untitled clip" }, "render_v01.mp4"),
    "render_v01.mp4"
  );
});
