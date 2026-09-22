import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverAstraBinding,
  generateAstraUnit,
  type AstraAdapter,
} from "./astra-adapter.server.ts";
test("configured Astra adapter routes the discovered model at Ultra and rejects downgrades", async () => {
  const calls: unknown[] = [];
  const adapter: AstraAdapter = {
    discover: async () => ({
      available: true,
      reason: "fixture",
      modelId: "fixture-astra",
      provider: "controlled-test",
      supportedEfforts: ["ultra"],
      maxInputCharacters: 1000,
      maxOutputTokens: 200,
    }),
    generate: async (input) => {
      calls.push(input);
      return { text: "complete test candidate", modelId: input.modelId, effort: input.effort };
    },
  };
  assert.equal((await discoverAstraBinding(adapter)).modelId, "fixture-astra");
  const input = { requestId: "r", modelId: "fixture-astra", system: "contract", prompt: "fixture" };
  assert.equal((await generateAstraUnit(input, adapter)).modelId, "fixture-astra");
  assert.equal((calls[0] as { effort: string }).effort, "ultra");
  await assert.rejects(generateAstraUnit({ ...input, modelId: "guess" }, adapter));
  await assert.rejects(
    generateAstraUnit(input, {
      ...adapter,
      generate: async () => ({ text: "draft", modelId: "fixture-astra", effort: "high" }),
    }),
    /different model\/effort/,
  );
  const unavailable = await discoverAstraBinding({
    ...adapter,
    discover: async () => ({ ...(await adapter.discover()), supportedEfforts: ["high"] }),
  });
  assert.equal(unavailable.available, false);
});
