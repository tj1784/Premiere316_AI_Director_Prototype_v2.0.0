from pathlib import Path
test = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\director-webapp\harrowing-aaa-generate-option.test.mjs")
test.write_text('''import assert from "node:assert/strict";
import test from "node:test";
import {
  generateOptionForMode,
  HARROWING_AAA_I2V_GENERATE_OPTION,
  PREMIERE_GENERATE_OPTIONS
} from "./premiere-api-delegation.mjs";
import { queueReservationSegmentIds } from "./segment-queue.mjs";

test("Harrowing AAA I2V is the Premiere generate option for segmented first-frame jobs", () => {
  const option = generateOptionForMode("i2v_segmented_first_frames");
  assert.equal(option.id, HARROWING_AAA_I2V_GENERATE_OPTION.id);
  assert.equal(option.queueMode, "segments");
  assert.match(option.catalogWorkflow, /02_GENERATE_VIDEO_LTX_2\\.5_Harrowing_AAA\\.json$/);
  assert.match(option.directorWorkflow, /LTX2\\.5_Premiere316\\.json$/);
  assert.ok(PREMIERE_GENERATE_OPTIONS.some((item) => item.id === "harrowing_aaa_i2v_segmented"));
});

test("Queue All reservations are one segment id per authored I2V segment", () => {
  const workspace = {
    timeline: {
      segments: Array.from({ length: 18 }, (_, index) => ({
        id: `segment-h01-s01-c01-${String(index + 1).padStart(2, "0")}`,
        type: "image",
        start: index * 192,
        length: 192
      }))
    }
  };
  const ids = queueReservationSegmentIds("segments", workspace);
  assert.equal(ids.length, 18);
  assert.equal(ids[0], "segment-h01-s01-c01-01");
  assert.equal(ids[17], "segment-h01-s01-c01-18");
});
''', encoding="utf-8")
print("wrote test")
