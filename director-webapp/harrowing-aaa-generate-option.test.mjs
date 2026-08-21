import assert from "node:assert/strict";
import test from "node:test";
import {
  generateOptionForMode,
  generateOptionsForContext,
  HARROWING_AAA_I2V_GENERATE_OPTION,
  PREMIERE_GENERATE_OPTIONS,
  semanticT2vLockedForContext
} from "./premiere-api-delegation.mjs";
import { setClipGenerateOption } from "./premiere-projects.mjs";
import { queueReservationSegmentIds } from "./segment-queue.mjs";

test("Harrowing AAA I2V is the Premiere generate option for segmented first-frame jobs", () => {
  const option = generateOptionForMode("i2v_segmented_first_frames");
  assert.equal(option.id, HARROWING_AAA_I2V_GENERATE_OPTION.id);
  assert.equal(option.queueMode, "segments");
  assert.match(option.catalogWorkflow, /LTX_2\.5_Harrowing_AAA\.json$/);
  assert.doesNotMatch(option.catalogWorkflow, /Premiere316\/02_GENERATE/);
  assert.match(option.directorWorkflow, /LTX2\.5_Premiere316\.json$/);
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

test("Harrowing AAA I2V hides Semantic T2V so Queue All cannot become one 144s job", () => {
  assert.equal(semanticT2vLockedForContext({
    projectSlug: "harrowing_of_hell",
    generationMode: "i2v_segmented_first_frames"
  }), true);
  assert.equal(semanticT2vLockedForContext({
    projectSlug: "david",
    generationMode: "i2v_segmented_first_frames"
  }), false);
  const options = generateOptionsForContext({
    projectSlug: "harrowing_of_hell",
    generationMode: "i2v_segmented_first_frames"
  });
  assert.equal(options.some((option) => option.id === "t2v_with_semantic_references"), false);
  assert.ok(options.some((option) => option.id === HARROWING_AAA_I2V_GENERATE_OPTION.id));
  const hijack = generateOptionForMode(
    "i2v_segmented_first_frames",
    "t2v_with_semantic_references",
    { projectSlug: "harrowing_of_hell" }
  );
  assert.equal(hijack.id, HARROWING_AAA_I2V_GENERATE_OPTION.id);
  assert.equal(hijack.queueMode, "segments");
});

test("setClipGenerateOption refuses Semantic T2V on H01 AAA I2V", () => {
  assert.throws(
    () => setClipGenerateOption("harrowing_of_hell", "H01-S01-C01", "t2v_with_semantic_references"),
    /Semantic T2V is locked on Harrowing AAA I2V/
  );
});

