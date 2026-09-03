import type { PictureIntake } from "../studio/picture-intake.ts";
import type { ResearchSocialWorldNote } from "./bible.ts";
import { emptyCinematicExpression } from "./bible.ts";
import { isResearchConfidence } from "./confidence.ts";

export function seedSocialWorldNotes(intake: PictureIntake): ResearchSocialWorldNote[] {
  if (intake.sourceType !== "biblical-historical") return [];
  return intake.socialWorld.map((entry) => ({
    id: `sw:${entry.id}`,
    expectedBehavior: entry.expectedBehavior,
    violationOrReversal: entry.violationOrReversal,
    whoWouldNotice: entry.whoWouldNotice,
    visibleReaction: entry.visibleReaction,
    socialConsequence: entry.socialConsequence,
    cinematicExpression: emptyCinematicExpression(),
    confidence: isResearchConfidence(entry.historicalConfidence) ? entry.historicalConfidence : "C",
    evidenceNote: entry.evidenceNote,
    sceneHints: [],
  }));
}

export function packSocialWorldForWriter(notes: ResearchSocialWorldNote[]): string {
  if (!notes.length) return "";
  return notes.map((note, index) => [
    `${index + 1}. Expected behavior: ${note.expectedBehavior}`,
    `Violation / reversal: ${note.violationOrReversal}`,
    `Who would notice: ${note.whoWouldNotice}`,
    `Visible reaction: ${note.visibleReaction}`,
    `Social consequence: ${note.socialConsequence}`,
    `Cinematic expression — blocking: ${note.cinematicExpression.blocking}`,
    `Costume / status sign: ${note.cinematicExpression.costumeOrStatusSign}`,
    `Silence / withholding: ${note.cinematicExpression.silenceOrWithholding}`,
    `Gaze / spatial honor: ${note.cinematicExpression.gazeOrSpatialHonor}`,
    `Prohibited exposition: ${note.cinematicExpression.prohibitedExposition}`,
    `Confidence: ${note.confidence}`,
    `Evidence: ${note.evidenceNote}`,
  ].join("\n")).join("\n\n");
}
