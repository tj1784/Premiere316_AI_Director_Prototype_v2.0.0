import assert from "node:assert/strict";
import test from "node:test";
import { makePictureIntake, makeSocialWorldEntry } from "../studio/picture-intake.ts";
import { packSocialWorldForWriter, seedSocialWorldNotes } from "./social-world.ts";

test("social-world notes seed only for biblical-historical intake", () => {
  const concept = seedSocialWorldNotes(makePictureIntake(1));
  assert.equal(concept.length, 0);
  const biblical = seedSocialWorldNotes({
    ...makePictureIntake(1),
    sourceType: "biblical-historical",
    socialWorld: [{ ...makeSocialWorldEntry("sw1"), expectedBehavior: "An elder is greeted first." }],
  });
  assert.equal(biblical.length, 1);
  assert.equal(biblical[0]?.cinematicExpression.prohibitedExposition, "");
  assert.match(packSocialWorldForWriter(biblical), /elder is greeted first/);
});
