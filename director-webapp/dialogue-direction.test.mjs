import assert from "node:assert/strict";
import test from "node:test";

import {
  dialogueDirectionsForSegments,
  GLOBAL_DIALOGUE_CONTRACT_HEADER,
  parseDialogueTurns,
  stripLegacyGlobalDialogue,
  withGlobalDialogueContract
} from "./dialogue-direction.mjs";

test("turns become natural quoted dialogue once across independent segments", () => {
  const anchor = "Torturer: Say the promise was a lie. Adam: No.";
  assert.deepEqual(parseDialogueTurns(anchor), [
    { speaker: "Torturer", words: "Say the promise was a lie." },
    { speaker: "Adam", words: "No." }
  ]);

  const directions = dialogueDirectionsForSegments(anchor, ["seg01", "seg02", "seg03"]);
  assert.deepEqual(Object.fromEntries(directions), {
    seg02: "The Torturer said, \"Say the promise was a lie.\"",
    seg03: "Then Adam replied, \"No.\""
  });
  assert.equal([...directions.values()].join(" "), "The Torturer said, \"Say the promise was a lie.\" Then Adam replied, \"No.\"");
});

test("one turn is assigned to SEG02 and no-dialogue anchors assign nothing", () => {
  assert.deepEqual(Object.fromEntries(dialogueDirectionsForSegments(
    "Jesus: Enough.",
    ["seg01", "seg02", "seg03"]
  )), { seg02: "Jesus said, \"Enough.\"" });
  assert.equal(dialogueDirectionsForSegments("No dialogue; ambient sound falls away.", ["seg01", "seg02", "seg03"]).size, 0);
  assert.equal(dialogueDirectionsForSegments("No new dialogue; soft Home chorus.", ["seg01", "seg02", "seg03"]).size, 0);
});

test("three turns are used once in SEG01, SEG02, and SEG03", () => {
  const directions = dialogueDirectionsForSegments(
    "Adam: Home? Jesus: Home. Souls: Home.",
    ["seg01", "seg02", "seg03"]
  );
  assert.deepEqual(Object.fromEntries(directions), {
    seg01: "Adam said, \"Home?\"",
    seg02: "Then Jesus replied, \"Home.\"",
    seg03: "Then the Souls replied, \"Home.\""
  });
});

test("legacy whole-clip dialogue is removed before the global contract is appended", () => {
  const legacy = [
    "VISUAL LOCK",
    "Silent picture pass. Torturer: Say the promise was a lie. Adam: No.",
    "Hold the final frame."
  ].join("\n");
  const stripped = stripLegacyGlobalDialogue(legacy);
  assert.equal(stripped, "VISUAL LOCK\nHold the final frame.");

  const contracted = withGlobalDialogueContract(legacy);
  assert.match(contracted, new RegExp(GLOBAL_DIALOGUE_CONTRACT_HEADER));
  assert.doesNotMatch(contracted, /Say the promise was a lie|Adam: No/);
  assert.match(contracted, /Only words inside quotation marks/);
  assert.equal((withGlobalDialogueContract(contracted).match(/AUDIO \/ DIALOGUE CONTRACT/g) || []).length, 1);
});

test("package-plan performance timing anchors are removed without deleting visual direction", () => {
  const legacy = "Camera plan: slow push. Performance timing reference: Jesus: Enough. Actors may use natural speech-shaped facial and body movement when dialogue is indicated, but this is a silent picture pass: generate no intelligible audio, music, sound effects, subtitles, captions or written words. Preserve exact identity.";
  const stripped = stripLegacyGlobalDialogue(legacy);
  assert.equal(stripped, "Camera plan: slow push. Preserve exact identity.");
});
