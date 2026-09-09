import test from "node:test";
import assert from "node:assert/strict";
import { assetPromptText } from "./asset-prompt-output.ts";

test("preserves model prose verbatim", () => {
  const paragraphs = Array.from({ length: 10 }, (_, n) => `Natural visual paragraph ${n}.`);
  assert.equal(assetPromptText({ promptParagraphs: paragraphs }), paragraphs.join("\n\n"));
});
test("rejects escaped response structure hidden inside a valid JSON string", () => {
  for (const bad of ['```json {"assetId":"horse"}', '"sourceQuote": "the Egyptians"', 'A horse.\"],\"Another paragraph', 'Visual text\\n        \\"sourceQuote\\"']) {
    const paragraphs = Array(10).fill("Natural visual prose."); paragraphs[5] = bad;
    assert.throws(() => assetPromptText({ promptParagraphs: paragraphs }), /embedded JSON/);
  }
});

test("rejects design-document prose before an image can be queued", () => {
  for (const bad of ['This prompt will drive the generation of a reference.', 'Source Quote: A pillar rises.', 'Built using fluid dynamics simulations and a shader library.', 'High-resolution fluid‑dynamics simulations blend volumetric fire shaders with particle systems.']) {
    assert.throws(() => assetPromptText({ promptParagraphs: Array(10).fill(bad) }), /writing instructions, citations or implementation notes/);
  }
  assert.equal(assetPromptText({ prompt: 'A towering column of orange flame lights the dark shore.' }), 'A towering column of orange flame lights the dark shore.');
  assert.doesNotThrow(() => assetPromptText({ prompt: 'Natural fluid dynamics shape the visible foam and turbulence.' }));
});
