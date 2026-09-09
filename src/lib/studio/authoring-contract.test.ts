import assert from "node:assert/strict";
import test from "node:test";
import { makePictureIntake } from "./picture-intake.ts";
import { buildScreenplayPrompt, buildStoryDoctorUser, screenplaySteps } from "./screenplay-prompts.ts";
import { seedResearchBibleFromIntake } from "../research/bible.ts";
import { packAuthoringIntake } from "./authoring-contract.ts";

test("editor receives full evidence, adaptation permissions and runtime rather than a synopsis", () => {
  const intake = { ...makePictureIntake(1), title: "The Prodigal Son", sourceType: "biblical-historical" as const, targetRuntimeMinutes: 30,
    materialMayDramatize: "Invent restrained connective dialogue.", materialToPreserve: "Leave the elder's decision open.",
    directorNotes: "The father visibly loves both sons equally.", historicalPeriod: "First-century Judea", mustAvoid: "No narration or maize.",
    suppliedSourceText: "Luke 15:11–32 source text supplied by the user." };
  const research = seedResearchBibleFromIntake(intake, 1).content;
  research.sections.risksDisputes = "Do not imply that a share request automatically leads to stoning.";
  const prompt = buildScreenplayPrompt({ intake, workflow: "single", step: screenplaySteps("single")[0], approvedResearch: research });
  for (const value of [intake.materialMayDramatize, intake.materialToPreserve, intake.directorNotes, intake.mustAvoid, research.sections.risksDisputes]) assert.ok(prompt.user.includes(value));
  assert.match(prompt.system, /complete requested 30-minute film/);
  assert.match(prompt.system, /separate source\/character and material-culture\/continuity/);
  assert.equal(JSON.parse(packAuthoringIntake(intake)).suppliedSourceText, intake.suppliedSourceText);
});

test("a scoped revision preserves its scope and gives critique the approved evidence", () => {
  const intake = makePictureIntake(1);
  const research = seedResearchBibleFromIntake(intake, 1).content;
  research.sections.risksDisputes = "The ending is intentionally unresolved.";
  const prompt = buildScreenplayPrompt({ intake, workflow: "single", step: screenplaySteps("single")[0], previousFountain: "EXT. FIELD - NIGHT #PS-S22#\n\nHe waits.", approvedResearch: research, scopedPack: { scope: "scene", nodeId: "PS-S22", instruction: "Reduce dialogue", polishOnly: true } });
  assert.match(prompt.user, /Return ONLY the rewritten scoped Fountain/);
  assert.match(prompt.user, /Preserve unrelated IDs and content byte-for-byte/);
  const critic = buildStoryDoctorUser({ goal: "Faithful adaptation", approvedResearch: research, fountain: "He waits.", revisionTarget: "PS-S22" });
  assert.ok(critic.includes(research.sections.risksDisputes));
  assert.match(critic, /permitted dramatic invention/);
});
