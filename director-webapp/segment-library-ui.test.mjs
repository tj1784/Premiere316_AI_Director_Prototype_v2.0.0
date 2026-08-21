import test from "node:test";
import assert from "node:assert/strict";
import {
  activeTakeOf,
  firstPlayablePreviewIndex,
  previewPlaylist,
  segmentTakes,
  takePreviewUrl
} from "./public/segment-library-ui.mjs";

test("preview playlist skips empty takes and lands on the first playable clip", () => {
  const workspace = {
    timeline: {
      segments: [
        { id: "s1", type: "image", start: 0, length: 24, generatedTakes: [] },
        { id: "s2", type: "image", start: 24, length: 24, activeTakeId: "take-v2", generatedTakes: [{ id: "take-v2", v: 2, file: "media/clips/seg02.mp4" }] },
        { id: "s3", type: "text", start: 48, length: 24, generatedTakes: [{ id: "take-v1", file: "media/clips/text.mp4" }] }
      ]
    }
  };
  assert.deepEqual(segmentTakes(workspace.timeline.segments[0]), []);
  assert.equal(activeTakeOf(workspace.timeline.segments[1])?.id, "take-v2");
  const playlist = previewPlaylist(workspace, "harrowing_of_hell");
  assert.equal(playlist.length, 2);
  assert.equal(playlist[0].url, "");
  assert.equal(playlist[1].url, takePreviewUrl("harrowing_of_hell", { file: "media/clips/seg02.mp4" }));
  assert.equal(firstPlayablePreviewIndex(playlist), 1);
  assert.equal(firstPlayablePreviewIndex([{ url: "" }]), 0);
});
