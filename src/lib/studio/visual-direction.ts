export type VisualDirection = {
  sources: { id: string; name: string }[];
  boardId: string;
  notes: string;
  guide?: string;
  analyzedBoardId?: string;
  analysisModel?: string;
};

export const VISUAL_DIRECTION_ROLE = "VISUAL DESIGN ONLY: Use the reference board for palette, lighting, contrast, material texture, photographic treatment and framing. Do not copy any depicted person's identity, face, costume verbatim, pose, setting, composition or story event. The current screenplay and its character specifications control identity, period, wardrobe and events. Translate the visual treatment into new screenplay-specific images. Character reference sheets retain their neutral grey background, clear even lighting and required turnaround layout.";

export function visualDirectionText(value?: VisualDirection): string {
  if (!value?.sources.length) return "";
  if (!value.guide || value.analyzedBoardId !== value.boardId) throw new Error("Visual direction board needs analysis before generation. Return to Intake and analyze the reference board.");
  return `${VISUAL_DIRECTION_ROLE}\nObserved visual design: ${value.guide}\nUser visual direction: ${value.notes}`;
}
