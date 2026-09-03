import type { ScreenplayModelRef } from "./screenplay.ts";

function haystack(model: Pick<ScreenplayModelRef, "servedModelId" | "displayName" | "id">): string {
  return `${model.id} ${model.servedModelId} ${model.displayName}`.toLowerCase();
}

export type LocalWriterFamily = "qwen" | "llama" | "other";

/** Discovery-only classification. Never sufficient for readiness or a completion request. */
export function classifyLocalWriterFamily(model: Pick<ScreenplayModelRef, "servedModelId" | "displayName" | "id"> | null | undefined): LocalWriterFamily {
  if (!model) return "other";
  const text = haystack(model);
  if (/tts|image|qwen3-vl|qwen2\.5-vl/.test(text)) return "other";
  if (/\bqwen/.test(text)) return "qwen";
  if (/\bllama\b/.test(text)) return "llama";
  return "other";
}

export function isQwenWriterCandidate(model: ScreenplayModelRef | null | undefined): boolean {
  return classifyLocalWriterFamily(model) === "qwen";
}

export function isLlamaQaCandidate(model: ScreenplayModelRef | null | undefined): boolean {
  return classifyLocalWriterFamily(model) === "llama";
}

export function isPinnedExactServedReady(model: ScreenplayModelRef | null | undefined, pinnedServedId: string | null | undefined): boolean {
  if (!model || model.status !== "ready" || !model.servedModelId.trim() || !pinnedServedId?.trim()) return false;
  return model.servedModelId === pinnedServedId;
}

export function canPinWriterId(servedModelId: string, model: ScreenplayModelRef | null | undefined): boolean {
  return Boolean(servedModelId.trim() && model && model.servedModelId === servedModelId && isQwenWriterCandidate(model) && model.status === "ready");
}

export function canPinQaId(servedModelId: string, model: ScreenplayModelRef | null | undefined, writerPin: string | null): boolean {
  return Boolean(servedModelId.trim() && model && model.servedModelId === servedModelId && isLlamaQaCandidate(model) && model.status === "ready" && servedModelId !== writerPin);
}

/** @deprecated Use isPinnedExactServedReady with an operator pin. Kept as candidate alias for discovery labels. */
export function isExactServedQwenWriter(model: ScreenplayModelRef | null | undefined): boolean {
  return isQwenWriterCandidate(model) && model?.status === "ready";
}

/** @deprecated Use isPinnedExactServedReady with an operator pin. */
export function isExactServedLlamaQa(model: ScreenplayModelRef | null | undefined): boolean {
  return isLlamaQaCandidate(model) && model?.status === "ready";
}

export function qwenWriterBlockReason(
  model: ScreenplayModelRef | null | undefined,
  providerAvailable: boolean,
  pinnedServedId?: string | null,
): string | null {
  if (!providerAvailable) return "LM Studio local API is offline. Screenplay generation stays disabled.";
  if (!pinnedServedId?.trim()) return "Pin the full currently served Qwen model ID. Family names are not accepted.";
  if (!model) return "Select the pinned currently served Qwen model. No substitute is used.";
  if (model.servedModelId !== pinnedServedId) return "The selected model is not the pinned served ID. Family or substring matches are rejected.";
  if (classifyLocalWriterFamily(model) !== "qwen") return "Screenplay generation requires a pinned Qwen served ID. Other loaded models are not used.";
  if (model.status !== "ready") return "The pinned Qwen served ID is not currently loaded. Premiere316 will not auto-load it.";
  return null;
}

export function llamaQaBlockReason(
  model: ScreenplayModelRef | null | undefined,
  writerPin: string | null,
  providerAvailable: boolean,
  pinnedQaServedId?: string | null,
): string | null {
  if (!providerAvailable) return "LM Studio local API is offline. Story Doctor stays disabled.";
  if (!pinnedQaServedId?.trim()) return "Pin the full currently served Llama model ID as Story Doctor.";
  if (!model) return "Select the pinned currently served Llama model as Story Doctor.";
  if (model.servedModelId !== pinnedQaServedId) return "The selected Story Doctor is not the pinned served ID. Family or substring matches are rejected.";
  if (classifyLocalWriterFamily(model) !== "llama") return "Story Doctor requires a pinned Llama served ID. Native llama.cpp is not used.";
  if (model.status !== "ready") return "The pinned Llama served ID is not currently loaded. Premiere316 will not auto-load it.";
  if (writerPin && pinnedQaServedId === writerPin) return "Story Doctor must be a separate served Llama identity from the writer.";
  return null;
}
