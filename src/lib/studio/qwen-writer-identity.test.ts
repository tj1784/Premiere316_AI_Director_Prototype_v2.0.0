import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLocalWriterFamily,
  isLlamaQaCandidate,
  isPinnedExactServedReady,
  isQwenWriterCandidate,
  llamaQaBlockReason,
  qwenWriterBlockReason,
} from "./qwen-writer-identity.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

function model(partial: Partial<ScreenplayModelRef> & Pick<ScreenplayModelRef, "servedModelId" | "displayName">): ScreenplayModelRef {
  return {
    id: `lmstudio:${partial.servedModelId}`,
    localCatalogModelId: null,
    checkpoint: partial.servedModelId,
    precision: "Q4",
    quantization: "Q4",
    contextLength: 8,
    sizeBytes: 1,
    runtimeAdapter: "LM Studio",
    status: "ready",
    statusReason: "ready",
    ...partial,
  };
}

test("discovery may classify Qwen/Llama families without treating family as readiness", () => {
  const qwen = model({ servedModelId: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" });
  const tiny = model({ servedModelId: "qwen2.5-0.5b", displayName: "Qwen2.5 0.5B" });
  const llama = model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" });
  assert.equal(classifyLocalWriterFamily(qwen), "qwen");
  assert.equal(isQwenWriterCandidate(tiny), true);
  assert.equal(isLlamaQaCandidate(llama), true);
  assert.equal(isPinnedExactServedReady(tiny, "qwen2.5-72b-instruct"), false);
});

test("readiness requires equality to the full pinned currently served ID", () => {
  const llama = model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" });
  assert.equal(isPinnedExactServedReady(llama, "llama-3.3-70b-instruct"), true);
  assert.equal(isPinnedExactServedReady(llama, "llama"), false);
  assert.equal(qwenWriterBlockReason(llama, true, "llama"), "The selected model is not the pinned served ID. Family or substring matches are rejected.");
  assert.equal(qwenWriterBlockReason(llama, true, "llama-3.3-70b-instruct"), null);
  assert.match(qwenWriterBlockReason(null, false, "llama-3.3-70b-instruct") ?? "", /LOCAL LLAMA WRITER UNAVAILABLE/);
});

test("stale or unloaded pins cannot generate or doctor", () => {
  const unloaded = model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", status: "unavailable", statusReason: "not loaded" });
  assert.equal(isPinnedExactServedReady(unloaded, "llama-3.3-70b-instruct"), false);
  assert.match(qwenWriterBlockReason(unloaded, true, "llama-3.3-70b-instruct") ?? "", /not currently loaded/);
  assert.match(llamaQaBlockReason(unloaded, "llama-3.3-70b-instruct", true, "llama-3.3-70b-instruct") ?? "", /not currently loaded/);
});

test("story doctor may reuse the same pinned Llama served ID", () => {
  const llama = model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" });
  assert.equal(llamaQaBlockReason(llama, "llama-3.3-70b-instruct", true, "llama-3.3-70b-instruct"), null);
  assert.match(llamaQaBlockReason(llama, "llama-3.3-70b-instruct", true, "llama") ?? "", /not the pinned served ID/);
});
