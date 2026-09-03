export const RESEARCH_CONFIDENCE = ["A", "B", "C", "D"] as const;
export type ResearchConfidence = (typeof RESEARCH_CONFIDENCE)[number];

export const RESEARCH_CONFIDENCE_LEGEND: Record<ResearchConfidence, string> = {
  A: "Explicit source / Scripture",
  B: "Strong historical or social evidence",
  C: "Reasonable historical reconstruction",
  D: "Disputed tradition / interpretation",
};

export function isResearchConfidence(value: unknown): value is ResearchConfidence {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

export function classARequiresLocator(confidence: ResearchConfidence, locator: string): string | null {
  if (confidence === "A" && !locator.trim()) return "Class A claims require a source locator.";
  return null;
}
