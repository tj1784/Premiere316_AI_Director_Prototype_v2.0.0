import { stableVoiceJson } from "../studio/voice-reconciliation.mjs";
import { exportVoiceReferences } from "../studio/voice-reference.ts";
import { performanceSourceKey, type PerformanceDraft } from "./integration.ts";
import type { Picture } from "../studio/types.ts";

export type ReviewTicket = { generation: number; fingerprint: string };
export function createReviewGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation++;
    },
    begin(fingerprint: string): ReviewTicket {
      return { generation: ++generation, fingerprint };
    },
    matches(ticket: ReviewTicket | null, fingerprint: string) {
      return !!ticket && ticket.generation === generation && ticket.fingerprint === fingerprint;
    },
  };
}

/** Exact deterministic snapshot, not a short collision-prone approval hash. */
export function jointReviewFingerprint(input: {
  picture: Picture;
  draft: PerformanceDraft;
  workflow: string;
  lines: string[];
  bindings: Record<string, string>;
}): string {
  const { picture, draft, workflow, lines, bindings } = input;
  const manifest = exportVoiceReferences(picture);
  return stableVoiceJson({
    pictureId: picture.id,
    draft,
    workflow,
    lines,
    bindings,
    source: performanceSourceKey(picture, draft.sceneId),
    applied: picture.emotionPerformance?.applied[draft.sceneId],
    references: manifest.references,
    issues: manifest.issues,
  });
}
