import assert from "node:assert/strict";
import test from "node:test";

import {
  dialogueDirectionsForSegments,
  isH03OrLaterClipId,
  parseDialogueTurns,
  withGlobalDialogueContract
} from "../director-webapp/dialogue-direction.mjs";

test("the H03-and-forward gate leaves H02 unchanged", () => {
  assert.equal(isH03OrLaterClipId("H02-S03-C01"), false);
  assert.equal(isH03OrLaterClipId("H03-S06-C01"), true);
  assert.equal(isH03OrLaterClipId("H10-S34-C02"), true);
});

test("speaker labels become one natural dialogue turn per selected segment", () => {
  const anchor = "Torturer: Say the promise was a lie. Adam: No.";
  assert.deepEqual(parseDialogueTurns(anchor), [
    { speaker: "Torturer", words: "Say the promise was a lie." },
    { speaker: "Adam", words: "No." }
  ]);

  const directions = dialogueDirectionsForSegments(anchor, ["seg01", "seg02", "seg03"]);
  assert.equal(directions.has("seg01"), false);
  assert.equal(directions.get("seg02"), 'The Torturer said, "Say the promise was a lie."');
  assert.equal(directions.get("seg03"), 'Then Adam replied, "No."');
  assert.doesNotMatch([...directions.values()].join("\n"), /Torturer:|Adam:/);
});

test("H03 dialogue is not repeated and no-dialogue anchors stay silent", () => {
  const directions = dialogueDirectionsForSegments(
    "Jesus: Adam. Adam: I remember Your voice.",
    ["seg01", "seg02", "seg03"]
  );
  assert.deepEqual([...directions], [
    ["seg02", 'Jesus said, "Adam."'],
    ["seg03", 'Then Adam replied, "I remember Your voice."']
  ]);
  assert.equal(dialogueDirectionsForSegments("No dialogue; ambient sound falls away.", ["seg01", "seg02", "seg03"]).size, 0);
});

test("the global contract removes legacy clip dialogue and wins over ambient-only prose", () => {
  const prompt = withGlobalDialogueContract([
    "Visual continuity lock.",
    "Silent picture pass. Torturer: Say the promise was a lie. Adam: No.",
    "Only natural ambient sound must be heard at all times."
  ].join("\n"));

  assert.doesNotMatch(prompt, /Torturer:|Adam:|Silent picture pass/);
  assert.match(prompt, /quotation marks anywhere else never authorize speech/);
  assert.match(prompt, /overrides any generic silent-picture or ambient-only wording/);
  assert.equal((prompt.match(/AUDIO \/ DIALOGUE CONTRACT/g) || []).length, 1);
});
