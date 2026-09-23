import assert from "node:assert/strict";
import test from "node:test";
import { INTAKE_SOURCE_TYPES, makePictureIntake, sourceMediaType, validatePictureIntake } from "./picture-intake.ts";
import { packAuthoringIntake } from "./authoring-contract.ts";
import { makePreparationForIntake } from "./picture-preparation.ts";

test("all five intake source modes remain available", () => {
  assert.deepEqual(INTAKE_SOURCE_TYPES, ["concept", "treatment", "existing-screenplay", "source-material", "biblical-historical"]);
});

test("intake can be saved offline while generation still requires a runtime model", () => {
  const empty = makePictureIntake(1);
  const invalid = validatePictureIntake(empty);
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.fields).sort(), ["premise", "title"]);
  const valid = validatePictureIntake({ ...empty, title: "A Picture", premise: "A choice costs a family everything." });
  assert.equal(valid.valid, true);
});

test("biblical intake requires the fidelity-aware workflow", () => {
  const intake = {
    ...makePictureIntake(1),
    title: "The Lost Coin",
    sourceType: "biblical-historical" as const,
    suppliedSourceText: "Luke 15:8–10",
    screenplayModelId: "lmstudio:test",
  };
  assert.equal(validatePictureIntake(intake).fields.workflow, "Biblical / Historical projects use the fidelity-aware workflow.");
  assert.equal(validatePictureIntake({ ...intake, workflow: "biblical-7-pass" }).valid, true);
});

test("plain text, Fountain, and Markdown imports are supported without accepting arbitrary files", () => {
  assert.equal(sourceMediaType("draft.fountain"), "text/fountain");
  assert.equal(sourceMediaType("outline.md"), "text/markdown");
  assert.equal(sourceMediaType("notes.txt"), "text/plain");
  assert.equal(sourceMediaType("screenplay.pdf"), null);
});

test("the optional film contract survives picture intake and reaches the authoring brief", () => {
  const blank = makePictureIntake(1);
  assert.equal("moralQuestion" in blank, false);
  const intake = {
    ...blank,
    title: "The Return",
    premise: "A family waits.",
    moralQuestion: "Can resentment and mercy share a home?",
    language: "Aramaic with English subtitles",
    deliveryFormat: "MP4",
    deliveryCodec: "H.264",
    continuityPolicy: "Keep the father in the same robe through supper.",
    voicePolicy: "One performer per character.",
    scoreStrategy: "Only diegetic music at the feast.",
  };
  assert.equal(validatePictureIntake(intake).valid, true);
  const stored = makePreparationForIntake(intake, "the-return", 2).intake;
  const brief = JSON.parse(packAuthoringIntake(stored, false));
  for (const key of ["moralQuestion", "language", "deliveryFormat", "deliveryCodec", "continuityPolicy", "voicePolicy", "scoreStrategy"] as const) {
    assert.equal(stored[key], intake[key]);
    assert.equal(brief[key], intake[key]);
  }
});
