import type { ScreenplayModelRef } from "./screenplay.ts";

function haystack(model: Pick<ScreenplayModelRef, "servedModelId" | "displayName" | "id">): string {
  return `${model.id} ${model.servedModelId} ${model.displayName}`.toLowerCase();
}

export function isExactServedQwenWriter(model: ScreenplayModelRef | null | undefined): boolean {
  if (!model || model.status !== "ready" || !model.servedModelId.trim()) return false;
  const text = haystack(model);
  if (/tts|image|qwen3-vl|qwen2\.5-vl/.test(text)) return false;
  return /\bqwen/.test(text);
}

export function isExactServedLlamaQa(model: ScreenplayModelRef | null | undefined): boolean {
  if (!model || model.status !== "ready" || !model.servedModelId.trim()) return false;
  const text = haystack(model);
  return /\bllama\b/.test(text);
}

export function qwenWriterBlockReason(model: ScreenplayModelRef | null | undefined, providerAvailable: boolean): string | null {
  if (!providerAvailable) return "LM Studio local API is offline. Screenplay generation stays disabled.";
  if (!model) return "Select an exact currently served Qwen model. No substitute is used.";
  if (!isExactServedQwenWriter(model)) return "Screenplay generation requires an exact currently served Qwen model. Other loaded models are not used.";
  return null;
}

export function llamaQaBlockReason(model: ScreenplayModelRef | null | undefined, writerId: string | null, providerAvailable: boolean): string | null {
  if (!providerAvailable) return "LM Studio local API is offline. Story Doctor stays disabled.";
  if (!model) return "Select an exact currently served Llama model as Story Doctor.";
  if (!isExactServedLlamaQa(model)) return "Story Doctor requires an exact currently served Llama model. Native llama.cpp is not used.";
  if (writerId && model.id === writerId) return "Story Doctor must be a separate served Llama identity unless an explicit override is set.";
  return null;
}
