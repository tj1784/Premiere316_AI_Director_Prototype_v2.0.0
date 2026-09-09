import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "./movie-plan-pipeline.ts";

test("valid outer JSON preserves embedded markdown fences inside paragraph strings", () => {
  const expected = { assets: [{ promptParagraphs: ['Model text with ```json\n{"nested":true}\n``` kept inside the paragraph.'], sourceQuote: "Actual scene text." }] };
  assert.deepEqual(extractJsonObject(JSON.stringify(expected)), expected);
});

test("a genuine top-level JSON fence unwraps without interpreting inner string fences", () => {
  const expected = { paragraph: 'A string containing ```json and braces { } plus an escaped "quote".' };
  assert.deepEqual(extractJsonObject(`\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`\n`), expected);
});

test("prose-wrapped JSON uses balanced braces and respects quoted braces and escapes", () => {
  const expected = { assets: [{ paragraph: 'The robe has {woven} borders and a "quote", a slash \\, then }.', nested: { ok: true } }] };
  assert.deepEqual(extractJsonObject(`Here is the result:\n${JSON.stringify(expected)}\nEnd of response; {this is prose}.`), expected);
});

test("malformed JSON cannot recover a nested object or embedded fence as a replacement", () => {
  for (const input of ['{"assets":[{"ok":true}]', '{"broken":, "nested":{"ok":true}}', '```json\n{"broken":, "nested":{"ok":true}}\n```', 'No object here.']) {
    assert.throws(() => extractJsonObject(input));
  }
});

test("non-object JSON roots are rejected rather than extracting nested object members", () => {
  for (const input of ['[{"ok":true}]', '"{\\"ok\\":true}"', 'null', 'true', '42', '```json\n[{"ok":true}]\n```']) {
    assert.throws(() => extractJsonObject(input), /not an object/);
  }
});
