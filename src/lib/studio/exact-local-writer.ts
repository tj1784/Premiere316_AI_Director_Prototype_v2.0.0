import type { CrewModelRef } from "./model-routing.ts";

/** Candidates come from local language-model discovery; exact identity controls routing. */
export function exactLocalWriterBlock(model: CrewModelRef | null | undefined, available: boolean, selectedId: string | null | undefined): string | null {
  if (!available) return "LM Studio is unavailable. The selected model will not be replaced.";
  if (!selectedId) return "Choose a local text model.";
  if (!model || model.servedModelId !== selectedId) return `The selected model is not the pinned served ID ${selectedId}. No substitute is used.`;
  if (model.status !== "ready") return `Load ${selectedId} before using this department's generation controls.`;
  return null;
}
