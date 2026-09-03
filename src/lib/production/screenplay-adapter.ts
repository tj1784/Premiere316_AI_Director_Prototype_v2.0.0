import type { ApprovedScreenplayBoundary } from "../studio/screenplay.ts";
import type { ApprovedScreenplayInput, SocialWorldMetadata } from "./types.ts";

/** Adapts only the frozen, immutable post-approval screenplay boundary. */
export function approvedScreenplayInputFromBoundary(boundary: ApprovedScreenplayBoundary): ApprovedScreenplayInput {
  const socialWorld: SocialWorldMetadata[] = (boundary.historicalContext?.socialWorld ?? []).map((entry) => ({
    id: entry.id,
    expectedBehavior: entry.expectedBehavior,
    violationOrReversal: entry.violationOrReversal,
    whoWouldNotice: entry.whoWouldNotice,
    visibleReaction: entry.visibleReaction,
    statusHonorImplication: entry.socialConsequence,
    confidence: entry.historicalConfidence,
    evidenceNote: entry.evidenceNote,
    sceneIds: [],
  }));
  return {
    pictureId: boundary.pictureId,
    versionId: boundary.screenplayVersionId,
    status: "APPROVED",
    fountain: boundary.fountain,
    scenes: boundary.scenes.map((scene) => ({ id: scene.id, slugline: scene.slugline })),
    socialWorld,
    sourceContext: {
      workflow: boundary.provenance.workflow,
      sourceType: boundary.provenance.sourceType,
      sourceVersionId: boundary.provenance.sourceVersionId,
      screenplayModelId: boundary.provenance.model?.id ?? null,
      confidenceLegend: boundary.historicalContext?.confidenceLegend ?? {},
      sourceReferences: boundary.historicalContext?.sourceReferences ?? "",
      fidelityRequirements: boundary.historicalContext?.fidelityRequirements ?? "",
      adaptationBoundaries: boundary.historicalContext?.adaptationBoundaries ?? "",
    },
  };
}
