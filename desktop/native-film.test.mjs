import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFilmRequest } from "./native-film.mjs";

const request = () => ({ pictureId: "picture-1", title: "Film", visualContinuity: "Ancient robes", shots: [{ id: "shot-1", seconds: 10, prompt: "People walk across dry ground." }] });
test("direct edits render verbatim while retaining the original model record separately", () => {
  const input = { ...request(), promptEditedAt: 123, writer: { modelId: "qwen", generatedAt: 100, rawResponse: '{"original":"Unedited model output"}' } };
  input.shots[0].prompt = "User's corrected prompt.";
  const normalized = validateFilmRequest(input);
  assert.equal(normalized.promptEditedAt, 123);
  assert.equal(normalized.shots[0].prompt, "User's corrected prompt.");
  assert.equal(normalized.writer.rawResponse, input.writer.rawResponse);
});
test("film requests bind exact picture, prompts and durations while ignoring renderer paths", () => {
  const input = { ...request(), output: "C:/outside", worker: "untrusted.py", seed: -1 };
  const normalized = validateFilmRequest(input);
  assert.equal(normalized.pictureId, "picture-1");
  assert.equal(normalized.shots[0].sourceShotId, "shot-1");
  assert.equal(normalized.shots[0].prompt, input.shots[0].prompt);
  assert.equal(normalized.durationSeconds, 10);
  assert.equal(normalized.output, undefined);
  assert.equal(normalized.worker, undefined);
  assert.equal(normalized.thinking, false);
});
test("rejects duplicate shots, unsupported durations and excessive render requests", () => {
  assert.throws(() => validateFilmRequest({ ...request(), shots: [request().shots[0], request().shots[0]] }), /Duplicate/);
  for (const seconds of [0, 4, 16, NaN, Infinity]) assert.throws(() => validateFilmRequest({ ...request(), shots: [{ ...request().shots[0], seconds }] }), /5–15/);
  assert.throws(() => validateFilmRequest({ ...request(), shots: Array.from({ length: 19 }, (_, i) => ({ ...request().shots[0], id: String(i) })) }), /three minutes/);
});
