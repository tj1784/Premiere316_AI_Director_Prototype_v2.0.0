import assert from "node:assert/strict";
import test from "node:test";

import { workspaceGlobalPrompt } from "../director-webapp/premiere-projects.mjs";
import {
  normalizedGlobalPrompt,
  parsePromptPackage
} from "../scripts/import-h02-h05-ltx25-i2v-complete.mjs";

test("segmented I2V keeps prohibitive character locks in the workspace global prompt", () => {
  const prompt = "Practical live-action lock. Jesus remains entirely unseen.";
  assert.equal(workspaceGlobalPrompt(prompt, "i2v_segmented_first_frames"), prompt);
  assert.equal(workspaceGlobalPrompt(prompt, "t2v_with_semantic_references"), "");
});

test("the final H02 segment does not consume the shared negative prompt section", () => {
  const parsed = parsePromptPackage(`# H02 prompts

Global visual lock for every segment: practical live action. Jesus remains unseen.

## H02-S05-C05 — 17 seconds

### SEG03 — 11–17s

First frame: \`first_frames/H02-S05-C05_SEG03_FIRST.png\`

Resolve naturally and hold.

## Shared negative prompt

cartoon, text, malformed anatomy`, "H02");

  assert.equal(parsed.prompts.get("H02-S05-C05:SEG03").prompt, "Resolve naturally and hold.");
  assert.equal(parsed.negativePrompt, "cartoon, text, malformed anatomy");
});

test("H02 keeps its legacy prompt while H03+ removes repeated clip dialogue", () => {
  const packageData = {
    h05Plans: null,
    promptPackage: { visualLock: "Practical live-action visual and chronology lock." }
  };
  const legacyAnchor = "Torturer: Say the promise was a lie. Adam: No.";
  const plan = { id: "plan" };
  const h02 = normalizedGlobalPrompt(packageData, {
    id: "H02-S03-C01",
    continuityLocks: ["Adam remains chained"],
    dialogueAnchor: legacyAnchor
  }, plan);
  const h03 = normalizedGlobalPrompt(packageData, {
    id: "H03-S06-C01",
    continuityLocks: ["Adam remains chained"],
    dialogueAnchor: legacyAnchor
  }, plan);

  assert.match(h02, /Silent picture pass\. Torturer: Say the promise was a lie\. Adam: No\./);
  assert.doesNotMatch(h02, /AUDIO \/ DIALOGUE CONTRACT/);
  assert.doesNotMatch(h03, /Silent picture pass|Say the promise was a lie|Adam: No/);
  assert.match(h03, /AUDIO \/ DIALOGUE CONTRACT/);
  assert.match(h03, /Only words inside quotation marks/);
});

test("H05 package-plan dialogue anchors are removed from the global prompt", () => {
  const clip = {
    id: "H05-S16-C01",
    videoPlanId: "video-h05-s16-c01",
    continuityLocks: ["No Sword"],
    dialogueAnchor: "Jesus: I have endured the judgment."
  };
  const plan = { id: "video-h05-s16-c01" };
  const packageData = {
    h05Plans: {
      videoPlans: {
        [plan.id]: {
          globalPrompt: "Camera plan: slow push. Performance timing reference: Jesus: I have endured the judgment. Actors may use natural speech-shaped facial and body movement when dialogue is indicated, but this is a silent picture pass: generate no intelligible audio, music, sound effects, subtitles, captions or written words. Preserve exact identity."
        }
      }
    },
    promptPackage: { visualLock: "unused" }
  };

  const prompt = normalizedGlobalPrompt(packageData, clip, plan);
  assert.doesNotMatch(prompt, /Performance timing reference|I have endured the judgment|speech-shaped/);
  assert.match(prompt, /Camera plan: slow push\. Preserve exact identity\./);
  assert.match(prompt, /AUDIO \/ DIALOGUE CONTRACT/);
});
