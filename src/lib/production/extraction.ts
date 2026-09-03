import { assertApprovedScreenplay, createProductionBreakdown } from "./breakdown.ts";
import type { ApprovedScreenplayInput, BreakdownRequirementDraft, ProductionBreakdown } from "./types.ts";

export type BreakdownExtractionRequest = {
  screenplayVersionId: string;
  fountain: string;
  scenes: ApprovedScreenplayInput["scenes"];
  socialWorld: ApprovedScreenplayInput["socialWorld"];
};

export type BreakdownExtractor = {
  extract: (request: BreakdownExtractionRequest) => Promise<BreakdownRequirementDraft[]>;
};

/**
 * Orchestrates extraction without choosing an LLM/provider or generating media.
 * The supplied adapter may be local, manual, imported, or deterministic.
 */
export async function runProductionBreakdown(
  screenplay: ApprovedScreenplayInput,
  extractor: BreakdownExtractor,
  now = Date.now(),
): Promise<ProductionBreakdown> {
  assertApprovedScreenplay(screenplay);
  const drafts = await extractor.extract({
    screenplayVersionId: screenplay.versionId,
    fountain: screenplay.fountain,
    scenes: screenplay.scenes,
    socialWorld: screenplay.socialWorld,
  });
  return createProductionBreakdown(screenplay, drafts, now);
}
