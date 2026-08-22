import test from "node:test";
import assert from "node:assert/strict";
import { SCREENPLAY_MODEL, screenplayModelHealth } from "../server/screenplay.js";

test("screenplay health distinguishes installed models from loaded models", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  let state = "not-loaded";
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      data: [{ id: SCREENPLAY_MODEL, state }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const installed = await screenplayModelHealth();
    assert.equal(requestedUrls.at(-1), "http://127.0.0.1:1234/api/v0/models");
    assert.equal(installed.online, true);
    assert.equal(installed.modelInstalled, true);
    assert.equal(installed.modelAvailable, false);

    state = "loaded";
    const loaded = await screenplayModelHealth();
    assert.equal(loaded.online, true);
    assert.equal(loaded.modelInstalled, true);
    assert.equal(loaded.modelAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
