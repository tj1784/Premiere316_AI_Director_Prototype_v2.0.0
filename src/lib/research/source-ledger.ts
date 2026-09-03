import { classARequiresLocator, RESEARCH_CONFIDENCE_LEGEND, type ResearchConfidence } from "./confidence.ts";
import type { PictureResearchBible, ResearchDispute, ResearchSource } from "./bible.ts";

export { RESEARCH_CONFIDENCE_LEGEND };

export function addResearchSource(
  sources: ResearchSource[],
  source: ResearchSource,
): { sources: ResearchSource[] } | { error: string } {
  const locatorError = classARequiresLocator(source.confidence, source.locator);
  if (locatorError) return { error: locatorError };
  if (sources.some((item) => item.id === source.id)) return { sources };
  return { sources: [...sources, source] };
}

export function disputesForSources(sources: ResearchSource[], existing: ResearchDispute[], now: number): ResearchDispute[] {
  const classA = sources.filter((source) => source.confidence === "A");
  if (classA.length < 2) return existing;
  const id = `dispute:class-a:${classA.map((source) => source.id).sort().join("+")}`;
  if (existing.some((item) => item.id === id)) return existing;
  return [
    ...existing,
    {
      id,
      sourceIds: classA.map((source) => source.id),
      claim: "Multiple class A claims are present and must be harmonized without deleting sources.",
      createdAt: now,
    },
  ];
}

export function harmonizeDispute(bible: PictureResearchBible, disputeId: string, note: string, now: number): PictureResearchBible {
  const dispute = bible.content.disputes.find((item) => item.id === disputeId);
  if (!dispute) return bible;
  return {
    ...bible,
    content: {
      ...bible.content,
      notes: [bible.content.notes, `Harmonization ${disputeId}: ${note}`].filter(Boolean).join("\n\n"),
    },
    updatedAt: now,
  };
}

export function confidenceLabel(confidence: ResearchConfidence): string {
  return `${confidence} · ${RESEARCH_CONFIDENCE_LEGEND[confidence]}`;
}
