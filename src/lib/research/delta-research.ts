import { appendResearchVersion, cloneResearchContent, type PictureResearchBible, type ResearchContent } from "./bible.ts";

export function startDeltaResearch(
  bible: PictureResearchBible,
  content: ResearchContent,
  id: string,
  now = Date.now(),
): PictureResearchBible {
  const approved = bible.versions.find((item) => item.id === bible.approvedVersionId);
  return appendResearchVersion(bible, {
    id,
    label: `Delta Research ${bible.versions.filter((item) => item.kind === "delta").length + 1}`,
    kind: "delta",
    scope: "delta",
    createdAt: now,
    sourceVersionId: bible.currentVersionId,
    content: cloneResearchContent({
      ...content,
      notes: approved
        ? [approved.content.notes, content.notes].filter(Boolean).join("\n\n")
        : content.notes,
    }),
  });
}

export function approvedNotesPreserved(bible: PictureResearchBible): boolean {
  const approved = bible.versions.find((item) => item.id === bible.approvedVersionId);
  if (!approved) return true;
  return bible.versions.some((item) => item.id === bible.approvedVersionId && item.content.notes === approved.content.notes);
}
