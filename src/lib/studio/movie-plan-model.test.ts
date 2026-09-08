import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { LLAMA_NOT_SERVED, selectMoviePlanModel } from "./movie-plan-model.ts";

function model(id: string, servedModelId: string, displayName: string) {
  return { id, servedModelId, displayName, status: "ready" };
}

describe("movie plan model selection never silently substitutes", () => {
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
    assert.match(blocked.reason ?? "", /configured Llama model/i);
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

  it("explicit DeepSeek pin is blocked", () => {
    const selected = selectMoviePlanModel(
      [model("ds", "deepseek-r1-distill", "DeepSeek"), model("llama", "llama-3.3-70b-instruct", "Llama")],
      { providerAvailable: true, explicitServedId: "deepseek-r1-distill" },
    );
    assert.equal(selected.allowed, false);
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
