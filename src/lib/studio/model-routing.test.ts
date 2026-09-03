import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CREW_WRITER_MODEL_KEY,
  OPTIONAL_CREW_WRITER_MODEL_KEY,
  canPinQaId,
  canPinWriterId,
  classifyLocalWriterFamily,
  isPinnedExactServedReady,
  plannedContextLength,
  qaBlockReason,
  refuseAutomaticDualFamily,
  writerBlockReason,
} from "./model-routing.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

function model(partial: Partial<ScreenplayModelRef> & Pick<ScreenplayModelRef, "servedModelId" | "displayName">): ScreenplayModelRef {
  return {
    id: `lmstudio:${partial.servedModelId}`,
    localCatalogModelId: null,
    checkpoint: partial.servedModelId,
    precision: "Q6",
    quantization: "Q6_K",
    contextLength: 8192,
    sizeBytes: 1,
    runtimeAdapter: "LM Studio",
    status: "ready",
    statusReason: "ready",
    ...partial,
  };
}

test("Llama is the default writer candidate and Qwen is optional, never family-ready", () => {
  const llama = model({ servedModelId: DEFAULT_CREW_WRITER_MODEL_KEY, displayName: "Llama 3.3 70B Instruct" });
  const qwen = model({ servedModelId: OPTIONAL_CREW_WRITER_MODEL_KEY, displayName: "Qwen2.5 72B Instruct" });
  assert.equal(classifyLocalWriterFamily(llama), "llama");
  assert.equal(classifyLocalWriterFamily(qwen), "qwen");
  assert.equal(canPinWriterId(DEFAULT_CREW_WRITER_MODEL_KEY, llama), true);
  assert.equal(canPinWriterId(OPTIONAL_CREW_WRITER_MODEL_KEY, qwen), true);
  assert.equal(isPinnedExactServedReady(llama, "llama"), false);
  assert.equal(writerBlockReason(llama, true, DEFAULT_CREW_WRITER_MODEL_KEY), null);
  assert.match(writerBlockReason(null, false, DEFAULT_CREW_WRITER_MODEL_KEY) ?? "", /LOCAL LLAMA WRITER UNAVAILABLE/);
});

test("same Llama served ID is valid for writer and QA", () => {
  const llama = model({ servedModelId: DEFAULT_CREW_WRITER_MODEL_KEY, displayName: "Llama 3.3 70B Instruct" });
  assert.equal(canPinQaId(DEFAULT_CREW_WRITER_MODEL_KEY, llama, DEFAULT_CREW_WRITER_MODEL_KEY), true);
  assert.equal(qaBlockReason(llama, DEFAULT_CREW_WRITER_MODEL_KEY, true, DEFAULT_CREW_WRITER_MODEL_KEY), null);
});

test("Qwen second opinion is never automatic", () => {
  assert.match(refuseAutomaticDualFamily("llama", "qwen", false) ?? "", /never automatic/);
  assert.equal(refuseAutomaticDualFamily("llama", "qwen", true), null);
});

test("Qwen Story Doctor is blocked until the second-opinion checkbox state is explicit", () => {
  const qwen = model({ servedModelId: OPTIONAL_CREW_WRITER_MODEL_KEY, displayName: "Qwen2.5 72B Instruct" });
  assert.match(
    qaBlockReason(qwen, DEFAULT_CREW_WRITER_MODEL_KEY, true, OPTIONAL_CREW_WRITER_MODEL_KEY, false) ?? "",
    /Qwen second opinion is optional and never automatic/,
  );
  assert.equal(qaBlockReason(qwen, DEFAULT_CREW_WRITER_MODEL_KEY, true, OPTIONAL_CREW_WRITER_MODEL_KEY, true), null);
});

test("context planning never uses catalog max when served context is unknown or larger", () => {
  assert.equal(plannedContextLength(null, 131072).effective, null);
  assert.equal(plannedContextLength(8192, 32768).effective, 8192);
  assert.equal(plannedContextLength(131072, 32768).effective, 8192);
});
