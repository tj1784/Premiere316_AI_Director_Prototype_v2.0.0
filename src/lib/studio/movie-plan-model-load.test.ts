import assert from "node:assert/strict";
import test from "node:test";
import { ensureExactMoviePlanModel } from "./movie-plan-model-load.ts";
import { DEFAULT_MOVIE_PLAN_MODEL } from "./movie-plan-model.ts";
import type { LocalLLMProviderDiscovery, LocalLLMServedModel } from "./local-llm-provider.ts";

function model(id: string, loaded: boolean): LocalLLMServedModel {
  return { id, loaded, displayName: id, type: "llm", instanceId: loaded ? `${id}-instance` : null, path: null, precision: null, quantization: null, contextLength: 32768, sizeBytes: null };
}
function discovery(models: LocalLLMServedModel[]): LocalLLMProviderDiscovery {
  return { providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "", models, discoveredAt: 1 };
}

test("ensure loads the exact GPT-OSS key even when Gemma is already resident", async () => {
  const calls: string[] = [];
  const result = await ensureExactMoviePlanModel({ servedModelId: `lmstudio:${DEFAULT_MOVIE_PLAN_MODEL}`, discover: async () => discovery([model("gemma", true), model(DEFAULT_MOVIE_PLAN_MODEL, calls.length > 0)]), loadInstalled: async (id) => { calls.push(id); } });
  assert.deepEqual(calls, [DEFAULT_MOVIE_PLAN_MODEL]);
  assert.deepEqual(result, { loaded: true, servedModelId: DEFAULT_MOVIE_PLAN_MODEL });
});

test("ensure refuses a successful load command when only Gemma became resident", async () => {
  let calls = 0;
  await assert.rejects(ensureExactMoviePlanModel({ servedModelId: DEFAULT_MOVIE_PLAN_MODEL, discover: async () => discovery([model("gemma", true), model(DEFAULT_MOVIE_PLAN_MODEL, false)]), loadInstalled: async () => { calls++; } }), /not verified.*No substitute/);
  assert.equal(calls, 1);
});

test("ensure rejects unavailable or ambiguous selected installation without loading another model", async () => {
  const calls: string[] = [];
  for (const models of [[model("gemma", true)], [model(DEFAULT_MOVIE_PLAN_MODEL, false), model(DEFAULT_MOVIE_PLAN_MODEL, false)]]) {
    await assert.rejects(ensureExactMoviePlanModel({ servedModelId: DEFAULT_MOVIE_PLAN_MODEL, discover: async () => discovery(models), loadInstalled: async (id) => { calls.push(id); } }), /not uniquely installed.*No substitute/);
  }
  assert.deepEqual(calls, []);
});

test("ensure reuses only the exact selected resident model", async () => {
  const result = await ensureExactMoviePlanModel({ servedModelId: DEFAULT_MOVIE_PLAN_MODEL, discover: async () => discovery([model("gemma", true), model(DEFAULT_MOVIE_PLAN_MODEL, true)]), loadInstalled: async () => { assert.fail("resident selected writer should not be loaded again"); } });
  assert.equal(result.servedModelId, DEFAULT_MOVIE_PLAN_MODEL);
});
