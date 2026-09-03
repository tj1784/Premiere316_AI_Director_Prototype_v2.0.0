import assert from "node:assert/strict";
import test from "node:test";
import { INTAKE_SOURCE_TYPES, makePictureIntake, sourceMediaType, validatePictureIntake } from "./picture-intake.ts";

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
