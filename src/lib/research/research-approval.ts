import { approveResearchBible, isResearchApproved, type PictureResearchBible } from "./bible.ts";

export function canApproveResearch(bible: PictureResearchBible): string | null {
  if (!bible.content.sources.length && !bible.content.notes.trim() && !bible.content.cinematographyManifesto.thesis.trim()) {
    return "Add at least one source or research note before approval.";
  }
  return null;
}

export function approveResearchOrError(bible: PictureResearchBible, id: string, now = Date.now()) {
  const blocked = canApproveResearch(bible);
  if (blocked) return { error: blocked } as const;
  return approveResearchBible(bible, id, now);
}

export { isResearchApproved };
