import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_MOVIE_PLAN_MODEL, explicitMoviePlanServedId, LLAMA_NOT_SERVED, selectMoviePlanModel } from "./movie-plan-model.ts";

function model(id: string, servedModelId: string, displayName: string) {
  return { id, servedModelId, displayName, status: "ready" };
}

describe("movie plan model selection never silently substitutes", () => {
  it("defaults new pictures to the requested GPT-OSS and preserves explicit picture selections", () => {
    assert.equal(DEFAULT_MOVIE_PLAN_MODEL, "gptoss-120b-uncensored-hauhaucs-aggressive");
    assert.equal(explicitMoviePlanServedId({}), DEFAULT_MOVIE_PLAN_MODEL);
    assert.equal(explicitMoviePlanServedId({ screenplay: { pinnedWriterServedId: DEFAULT_MOVIE_PLAN_MODEL, selectedModelId: "gemma" } }), DEFAULT_MOVIE_PLAN_MODEL);
    assert.equal(explicitMoviePlanServedId({ screenplay: { selectedModelId: "lmstudio:explicit-other-writer" } }), "lmstudio:explicit-other-writer");
  });

  it("never treats a catalog alias or case-insensitive near match as the selected served model", () => {
    const gpt = DEFAULT_MOVIE_PLAN_MODEL;
    assert.equal(selectMoviePlanModel([model(gpt, "gemma", "Gemma")], { providerAvailable: true, explicitServedId: gpt }).allowed, false);
    assert.equal(selectMoviePlanModel([model("lmstudio:" + gpt, gpt, "GPT-OSS")], { providerAvailable: true, explicitServedId: gpt.toUpperCase() }).allowed, false);
  });
  it("Llama served is allowed", () => {
    const selected = selectMoviePlanModel(
      [model("qwen", "qwen2.5-72b-instruct", "Qwen"), model("llama", "llama-3.3-70b-instruct", "Llama 3.3 70B Instruct")],
      { providerAvailable: true },
    );
    assert.equal(selected.allowed, true);
    if (selected.allowed) {
      assert.equal(selected.family, "llama");
      assert.equal(selected.servedModelId, "llama-3.3-70b-instruct");
    }
  });

  it("Qwen served only is blocked unless explicitly selected", () => {
    const blocked = selectMoviePlanModel(
      [model("qwen", "qwen2.5-72b-instruct", "Qwen2.5 72B Instruct")],
      { providerAvailable: true },
    );
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason ?? "", /selected local writer model/i);
    const allowed = selectMoviePlanModel(
      [model("qwen", "qwen2.5-72b-instruct", "Qwen2.5 72B Instruct")],
      { providerAvailable: true, explicitServedId: "qwen2.5-72b-instruct" },
    );
    assert.equal(allowed.allowed, true);
    if (allowed.allowed) assert.equal(allowed.family, "qwen");
  });

  it("DeepSeek served only is blocked even if it is ready[0]", () => {
    const selected = selectMoviePlanModel(
      [model("ds", "deepseek-r1-distill", "DeepSeek")],
      { providerAvailable: true },
    );
    assert.equal(selected.allowed, false);
    assert.equal(selected.servedModelId, null);
  });

  it("an exact explicit language-model pin is honored without a family fallback", () => {
    const selected = selectMoviePlanModel(
      [model("ds", "deepseek-r1-distill", "DeepSeek"), model("llama", "llama-3.3-70b-instruct", "Llama")],
      { providerAvailable: true, explicitServedId: "deepseek-r1-distill" },
    );
    assert.equal(selected.allowed, true);
    if (selected.allowed) assert.equal(selected.servedModelId, "deepseek-r1-distill");
  });

  it("the user-selected GPT-OSS variant requires its exact loaded ID", () => {
    const exact = "gptoss-120b-uncensored-hauhaucs-aggressive";
    const models = [model("lmstudio:" + exact, exact, "GPT-OSS 120B"), model("qwen", "qwen3.6-40b", "Qwen")];
    const explicit = selectMoviePlanModel(models, { providerAvailable: true, explicitServedId: exact });
    assert.equal(explicit.allowed, true);
    if (explicit.allowed) assert.equal(explicit.servedModelId, exact);
    assert.equal(selectMoviePlanModel(models, { providerAvailable: true }).allowed, false);
    assert.equal(selectMoviePlanModel(models, { providerAvailable: true, explicitServedId: "gptoss" }).allowed, false);
    assert.equal(selectMoviePlanModel([{ ...models[0], status: "unavailable" }, models[1]], { providerAvailable: true, explicitServedId: exact }).allowed, false);
    assert.equal(selectMoviePlanModel([models[0], { ...models[0] }], { providerAvailable: true, explicitServedId: exact }).allowed, false);
  });

  it("Qwen as ready[0] is never chosen when Llama is also served", () => {
    const selected = selectMoviePlanModel(
      [model("qwen", "qwen2.5-72b-instruct", "Qwen"), model("llama", "llama-3.3-70b-instruct", "Llama")],
      { providerAvailable: true },
    );
    assert.equal(selected.allowed, true);
    if (selected.allowed) assert.equal(selected.family, "llama");
  });

  it("explicit Qwen catalog id is allowed only when that Qwen is served", () => {
    const allowed = selectMoviePlanModel(
      [model("lmstudio:qwen2.5-72b-instruct", "qwen2.5-72b-instruct", "Qwen")],
      { providerAvailable: true, explicitServedId: "lmstudio:qwen2.5-72b-instruct" },
    );
    assert.equal(allowed.allowed, true);
    const blocked = selectMoviePlanModel(
      [model("llama", "llama-3.3-70b-instruct", "Llama")],
      { providerAvailable: true, explicitServedId: "qwen2.5-72b-instruct" },
    );
    assert.equal(blocked.allowed, false);
  });

  it("client source never uses ready[0] fallback", () => {
    const client = readFileSync(new URL("./movie-plan-client.ts", import.meta.url), "utf8");
    const model = readFileSync(new URL("./movie-plan-model.ts", import.meta.url), "utf8");
    assert.doesNotMatch(client, /ready\[0\]/);
    assert.doesNotMatch(client, /\?\? ready\[0\]/);
    assert.match(client, /selectMoviePlanModel/);
    assert.doesNotMatch(model, /ready\[0\]/);
    const dir = resolve("screenshots/pre-audit-build-movie-plan-blockers");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "model-selection-tests.json"), `${JSON.stringify({
      llamaServedAllowed: true,
      qwenOnlyBlockedUnlessExplicit: true,
      deepSeekBlocked: true,
      ready0FallbackRemoved: true,
      llamaNotServedMessage: LLAMA_NOT_SERVED,
    }, null, 2)}\n`);
  });
});
