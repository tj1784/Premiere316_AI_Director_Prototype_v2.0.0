import assert from "node:assert/strict";
import { test } from "node:test";
import { moviePlanStreamResponse, readMoviePlanStream } from "./movie-plan-stream.ts";

test("live output reaches the reader before model generation completes", async () => {
  let finish!: () => void;
  let sawText!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const firstText = new Promise<void>((resolve) => { sawText = resolve; });
  const output: string[] = [];
  const response = moviePlanStreamResponse(async (emit) => {
    emit("Fei ");
    await held;
    emit("and Elly.");
    return { text: "Fei and Elly." };
  }, async () => {});
  let completed = false;
  const result = readMoviePlanStream(response, (text) => { output.push(text); sawText(); }).then((value) => { completed = true; return value; });
  await firstText;
  assert.equal(completed, false);
  assert.equal(output[0], "Fei ");
  finish();
  assert.deepEqual(await result, { text: "Fei and Elly." });
});

test("provider failures retain streamed output but reject the draft", async () => {
  const partial: string[] = [];
  const response = moviePlanStreamResponse(async (emit) => {
    emit("Partial draft");
    throw new Error("Model disconnected");
  }, async () => {});
  await assert.rejects(readMoviePlanStream(response, (text) => partial.push(text)), /Model disconnected/);
  assert.deepEqual(partial, ["Partial draft"]);
});

test("truncated streams cannot become completed drafts", async () => {
  const response = new Response('{"type":"token","text":"unfinished"}\n');
  await assert.rejects(readMoviePlanStream(response), /ended before completion/);
});

test("UTF-8 and JSON frames survive arbitrary transport chunk boundaries", async () => {
  const encoded = new TextEncoder().encode('{"type":"token","text":"Fei → エリィ"}\n{"type":"done","text":"Fei → エリィ"}\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.deepEqual(await readMoviePlanStream(new Response(body)), { text: "Fei → エリィ" });
});

test("canceling the output stream cancels the provider", async () => {
  let release!: () => void;
  let canceled = false;
  const response = moviePlanStreamResponse(async () => { await new Promise<void>((resolve) => { release = resolve; }); return { text: "" }; }, async () => { canceled = true; });
  await response.body!.cancel();
  assert.equal(canceled, true);
  release();
});
