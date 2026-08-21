import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  dialogueCueComplete,
  dialogueCueProgress,
  dialogueCuesForClip,
  dialogueCuesForSegment,
  dialogueCuesFromSound
} from "../client/src/dialogue-cues.js";

const cues = dialogueCuesFromSound({
  dialogueCues: [
    {
      cueId: "D002",
      segmentId: "H02-S03-C01-SEG02B",
      speaker: "TORTURER",
      exactDialogue: "Second continuation.",
      performanceDirection: "Continue the same breath.",
      completedTakes: 2,
      expectedTakes: 3
    },
    {
      cueId: "D001",
      segmentId: "H02-S03-C01-SEG02A",
      speaker: "TORTURER",
      dialogue: "First continuation.",
      direction: "Low and judicial.",
      progress: 25
    },
    {
      cueId: "D003",
      segmentId: "H02-S03-C01-SEG03A",
      speaker: "ADAM",
      text: "Adam answers.",
      status: "done"
    },
    {
      cueId: "D005",
      segmentId: "H02-S03-C02-SEG01",
      speaker: "TORTURER",
      exactDialogue: "Another clip."
    }
  ]
});

test("authoritative dialogue cue normalization retains exact text and story order", () => {
  assert.deepEqual(cues.map((cue) => cue.cueId), ["D001", "D002", "D003", "D005"]);
  assert.equal(cues[0].exactDialogue, "First continuation.");
  assert.equal(cues[0].performanceDirection, "Low and judicial.");
  assert.equal(dialogueCueProgress(cues[0]), 0.25);
  assert.equal(dialogueCueProgress(cues[1]), 2 / 3);
  assert.equal(dialogueCueProgress(cues[2]), 1);
  assert.equal(dialogueCueComplete(cues[2]), true);
  assert.equal(dialogueCueComplete(cues[1]), false);
});

test("canonical promotion remains distinct from a selected master", () => {
  const promoted = { status: "promoted", progress: 0.99 };
  assert.equal(dialogueCueProgress(promoted), 0.99);
  assert.equal(dialogueCueComplete(promoted), false);
});

test("legacy unsuffixed MAIN placeholders expose authored A/B continuations", () => {
  const selected = dialogueCuesForSegment(cues, { id: "segment-h02-s03-c01-02" }, "H02-S03-C01");
  assert.deepEqual(selected.map((cue) => cue.cueId), ["D001", "D002"]);
});

test("expanded MAIN segments select only their exact authored cue", () => {
  const selected = dialogueCuesForSegment(cues, { id: "segment-h02-s03-c01-seg02a" }, "H02-S03-C01");
  assert.deepEqual(selected.map((cue) => cue.cueId), ["D001"]);
  assert.deepEqual(dialogueCuesForClip(cues, "H02-S03-C01").map((cue) => cue.cueId), ["D001", "D002", "D003"]);
});

test("Create Sound and Direct render the cue plan without creating fake audio segments", () => {
  const createSound = fs.readFileSync(fileURLToPath(new URL("../client/src/components/CreateSoundWorkspace.tsx", import.meta.url)), "utf8");
  const director = fs.readFileSync(fileURLToPath(new URL("../client/src/components/LtxDirectorWorkspace.tsx", import.meta.url)), "utf8");
  assert.match(createSound, /Authoritative dialogue cue queue/);
  assert.match(createSound, /cue\.exactDialogue/);
  assert.match(createSound, /cue\.performanceDirection/);
  assert.match(director, /AUTHORITATIVE H02 DIALOGUE PLAN · READ ONLY/);
  assert.match(director, /Planned cue metadata only/);
  assert.doesNotMatch(director, /audioSegments\.push\([^)]*dialogue/i);
});
