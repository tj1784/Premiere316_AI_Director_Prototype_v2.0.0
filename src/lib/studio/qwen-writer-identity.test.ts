import assert from "node:assert/strict";
import test from "node:test";
import { isExactServedLlamaQa, isExactServedQwenWriter, llamaQaBlockReason, qwenWriterBlockReason } from "./qwen-writer-identity.ts";
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

test("only served Qwen ids count as the writer", () => {
  assert.equal(isExactServedQwenWriter(model({ servedModelId: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" })), true);
  assert.equal(isExactServedQwenWriter(model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" })), false);
  assert.equal(isExactServedQwenWriter(model({ servedModelId: "qwen3-tts", displayName: "Qwen3 TTS" })), false);
  assert.equal(qwenWriterBlockReason(null, false), "LM Studio local API is offline. Screenplay generation stays disabled.");
});

test("story doctor requires a separate served Llama id", () => {
  const writer = model({ servedModelId: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" });
  const llama = model({ servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" });
  assert.equal(isExactServedLlamaQa(llama), true);
  assert.equal(isExactServedLlamaQa(writer), false);
  assert.match(llamaQaBlockReason(writer, writer.id, true) ?? "", /Llama/);
  assert.equal(llamaQaBlockReason(llama, writer.id, true), null);
});
