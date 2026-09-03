export {
  classifyLocalWriterFamily,
  isPinnedExactServedReady,
  isQwenFamily as isQwenWriterCandidate,
  isLlamaFamily as isLlamaQaCandidate,
  canPinWriterId,
  canPinQaId,
  writerBlockReason as qwenWriterBlockReason,
  qaBlockReason as llamaQaBlockReason,
} from "./model-routing.ts";

import { isLlamaFamily, isQwenFamily } from "./model-routing.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

/** @deprecated Discovery-only. Family is never readiness. */
export function isExactServedQwenWriter(model: ScreenplayModelRef | null | undefined): boolean {
  return isQwenFamily(model) && model?.status === "ready";
}

/** @deprecated Discovery-only. Family is never readiness. */
export function isExactServedLlamaQa(model: ScreenplayModelRef | null | undefined): boolean {
  return isLlamaFamily(model) && model?.status === "ready";
}
