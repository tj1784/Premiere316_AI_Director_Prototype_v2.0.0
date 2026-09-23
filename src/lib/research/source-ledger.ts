import { classARequiresLocator, isResearchConfidence, RESEARCH_CONFIDENCE_LEGEND, type ResearchConfidence } from "./confidence.ts";
import type { PictureResearchBible, ResearchContent, ResearchDispute, ResearchSource } from "./bible.ts";

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

const LEGACY_AUTO_CLAIM = "Multiple class A claims are present and must be harmonized without deleting sources.";

export type ResearchDisputeInput = {
  claim: string;
  sourceAId: string;
  sourceAExcerpt: string;
  sourceBId: string;
  sourceBExcerpt: string;
};

export type RecordedResearchDispute = ResearchDispute & {
  evidence: [{ sourceId: string; excerpt: string }, { sourceId: string; excerpt: string }];
  resolution?: { note: string; resolvedAt: number };
};

function legacyAutoDispute(dispute: ResearchDispute): boolean {
  return dispute.id.startsWith("dispute:class-a:") && dispute.claim === LEGACY_AUTO_CLAIM;
}

/** Source count or confidence alone never proves that two sources conflict. */
export function disputesForSources(_sources: ResearchSource[], existing: ResearchDispute[], _now: number): ResearchDispute[] {
  return existing.filter((dispute) => !legacyAutoDispute(dispute));
}

export function recordedResearchDisputes(content: ResearchContent): RecordedResearchDispute[] {
  return content.disputes.filter((dispute): dispute is RecordedResearchDispute => {
    if (legacyAutoDispute(dispute)) return false;
    const evidence = (dispute as Partial<RecordedResearchDispute>).evidence;
    return dispute.sourceIds.length === 2 && dispute.sourceIds[0] !== dispute.sourceIds[1]
      && Array.isArray(evidence) && evidence.length === 2
      && evidence.every((item, index) => item?.sourceId === dispute.sourceIds[index] && Boolean(item.excerpt?.trim()));
  });
}

/** Older user notes remain readable without treating them as evidenced conflicts. */
export function unverifiedResearchDisputeNotes(content: ResearchContent): ResearchDispute[] {
  const recordedIds = new Set(recordedResearchDisputes(content).map((dispute) => dispute.id));
  return content.disputes.filter((dispute) => !legacyAutoDispute(dispute) && !recordedIds.has(dispute.id));
}

export function recordResearchDispute(
  content: ResearchContent,
  input: ResearchDisputeInput,
  now: number,
): { content: ResearchContent } | { error: string } {
  const claim = input.claim.trim();
  const sourceAExcerpt = input.sourceAExcerpt.trim();
  const sourceBExcerpt = input.sourceBExcerpt.trim();
  const sourceA = content.sources.find((source) => source.id === input.sourceAId);
  const sourceB = content.sources.find((source) => source.id === input.sourceBId);
  if (!claim) return { error: "Name the specific claim on which these sources disagree." };
  if (!sourceA || !sourceB || sourceA.id === sourceB.id) return { error: "Select two different sources for this claim." };
  if (!sourceAExcerpt || !sourceBExcerpt || sourceAExcerpt === sourceBExcerpt) return { error: "Enter different evidence excerpts from the two sources." };
  if (!sourceA.quote.includes(sourceAExcerpt) || !sourceB.quote.includes(sourceBExcerpt)) {
    return { error: "Each evidence excerpt must occur in its selected source text." };
  }
  const sourceIds: [string, string] = [sourceA.id, sourceB.id];
  const evidence: RecordedResearchDispute["evidence"] = [
    { sourceId: sourceA.id, excerpt: sourceAExcerpt },
    { sourceId: sourceB.id, excerpt: sourceBExcerpt },
  ];
  const disputes = disputesForSources(content.sources, content.disputes, now);
  if (disputes.some((dispute) => dispute.claim === claim && sourceIds.every((id) => dispute.sourceIds.includes(id)))) {
    return { error: "This claim is already recorded for the selected sources." };
  }
  const dispute: RecordedResearchDispute = {
    id: `dispute:claim:${now}:${disputes.length}`,
    sourceIds,
    claim,
    evidence,
    createdAt: now,
  };
  return { content: { ...content, disputes: [...disputes, dispute] } };
}

export function resolveResearchDispute(
  content: ResearchContent,
  disputeId: string,
  note: string,
  now: number,
): { content: ResearchContent } | { error: string } {
  const resolution = note.trim();
  if (!resolution) return { error: "Record how this specific disagreement was handled." };
  const dispute = recordedResearchDisputes(content).find((item) => item.id === disputeId);
  if (!dispute) return { error: "No evidenced disagreement exists for this record." };
  if (dispute.resolution) return { error: "This disagreement already has a recorded resolution." };
  return {
    content: {
      ...content,
      disputes: content.disputes.map((item) => item.id === disputeId
        ? { ...dispute, resolution: { note: resolution, resolvedAt: now } }
        : item),
    },
  };
}

export function classifyResearchSource(
  content: ResearchContent,
  sourceId: string,
  confidence: ResearchConfidence,
): { content: ResearchContent } | { error: string } {
  const source = content.sources.find((item) => item.id === sourceId);
  if (!source) return { error: "Source is no longer available." };
  if (!isResearchConfidence(confidence)) return { error: "Select a valid evidence class." };
  const locatorError = classARequiresLocator(confidence, source.locator);
  if (locatorError) return { error: locatorError };
  return { content: { ...content, sources: content.sources.map((item) => item.id === sourceId ? { ...item, confidence } : item) } };
}

export function harmonizeDispute(bible: PictureResearchBible, disputeId: string, note: string, now: number): PictureResearchBible {
  const result = resolveResearchDispute(bible.content, disputeId, note, now);
  if ("error" in result) return bible;
  return {
    ...bible,
    content: result.content,
    updatedAt: now,
  };
}

export function confidenceLabel(confidence: ResearchConfidence): string {
  return `${confidence} · ${RESEARCH_CONFIDENCE_LEGEND[confidence]}`;
}
