import assert from "node:assert/strict";
import test from "node:test";
import { cancelComfyPrompt } from "../server/comfy.js";

test("prompt cancellation prefers ComfyUI's state-agnostic job endpoint", async () => {
  const calls = [];
  const result = await cancelComfyPrompt("prompt-1", {
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(result, { method: "job-cancel" });
  assert.deepEqual(calls.map((call) => call.url), ["http://127.0.0.1:8188/api/jobs/prompt-1/cancel"]);
});

test("legacy cancellation interrupts only the exact running prompt", async () => {
  const calls = [];
  const responses = [
    new Response("not found", { status: 404 }),
    new Response("{}", { status: 200 }),
    new Response(JSON.stringify({ queue_running: [[1, "prompt-2", {}]], queue_pending: [] }), { status: 200 }),
    new Response("{}", { status: 200 })
  ];
  const result = await cancelComfyPrompt("prompt-2", {
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return responses.shift();
    }
  });
  assert.deepEqual(result, { method: "targeted-interrupt" });
  assert.equal(calls.at(-1).url, "http://127.0.0.1:8188/interrupt");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { prompt_id: "prompt-2" });
});

test("legacy fallback never interrupts a foreign running prompt", async () => {
  const calls = [];
  const responses = [
    new Response("not found", { status: 404 }),
    new Response("{}", { status: 200 }),
    new Response(JSON.stringify({ queue_running: [[1, "foreign-prompt", {}]], queue_pending: [] }), { status: 200 })
  ];
  const result = await cancelComfyPrompt("prompt-3", {
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return responses.shift();
    }
  });
  assert.deepEqual(result, { method: "pending-delete" });
  assert.equal(calls.some((call) => call.url.endsWith("/interrupt")), false);
});
