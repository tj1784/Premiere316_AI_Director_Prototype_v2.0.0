import type { PictureResearchBible } from "./bible.ts";

export type ResearchRoomStatus = "not-generated" | "draft" | "approved" | "blocked";

export const RESEARCH_ROOM_PRIMARY_CTA = "Build Research Draft";
export const RESEARCH_ROOM_REGENERATE_CTA = "Regenerate";
export const RESEARCH_ROOM_DELTA_CTA = "Delta Research";
export const RESEARCH_SOURCE_MATERIAL_CTA = "Add Source Material";
export const RESEARCH_MANUAL_SUMMARY = "Manual Notes";

export const RESEARCH_EMPTY_SECTIONS = [
  "Source / Canon Ledger",
  "World Overview",
  "Characters",
  "Locations",
  "Visual Identity",
  "Cinematography",
  "Risks",
] as const;

export function researchBibleGenerated(bible: PictureResearchBible | null | undefined): boolean {
  if (!bible) return false;
  if (bible.approvedVersionId) return true;
  if (bible.versions.length > 0) return true;
  if (bible.status === "APPROVED" || bible.status === "IN_REVIEW" || bible.status === "DELTA_PENDING") return true;
  return false;
}

export function researchRoomStatus(
  bible: PictureResearchBible | null | undefined,
  llamaAvailable: boolean | null,
): ResearchRoomStatus {
  if (bible?.status === "APPROVED") return "approved";
  if (researchBibleGenerated(bible)) return "draft";
  if (llamaAvailable === false) return "blocked";
  return "not-generated";
}

export function researchRoomStatusLabel(status: ResearchRoomStatus): string {
  if (status === "approved") return "Approved";
  if (status === "draft") return "Draft ready";
  if (status === "blocked") return "Blocked";
  return "Draft missing";
}

export function researchModelStatusLabel(llamaAvailable: boolean | null): string {
  if (llamaAvailable === true) return "Available";
  if (llamaAvailable === false) return "Unavailable";
  return "Checking";
}

export function researchRoomView(
  bible: PictureResearchBible | null | undefined,
  llamaAvailable: boolean | null,
) {
  const status = researchRoomStatus(bible, llamaAvailable);
  return {
    status,
    statusLabel: researchRoomStatusLabel(status),
    modelStatusLabel: researchModelStatusLabel(llamaAvailable),
    purpose: "Optional inspection and editing of the Research Bible.",
    primaryCta: RESEARCH_ROOM_PRIMARY_CTA,
    regenerateCta: RESEARCH_ROOM_REGENERATE_CTA,
    deltaCta: RESEARCH_ROOM_DELTA_CTA,
    sourceMaterialCta: RESEARCH_SOURCE_MATERIAL_CTA,
    manualSummary: RESEARCH_MANUAL_SUMMARY,
    showEmptyState: !researchBibleGenerated(bible),
    showManualByDefault: false,
    showOffline: llamaAvailable === false,
    showWorksheetFirst: false,
    emptySections: [...RESEARCH_EMPTY_SECTIONS],
    offlineTitle: "Configured AI model unavailable.",
    offlineBody: "Start LM Studio Local API Server and serve a model, then Rescan.",
  };
}

const USER_FACING_MODE_STRINGS = [
  /web-assisted/i,
  /web assisted/i,
  /research mode/i,
  /local research/i,
  /local model research/i,
  /local research room/i,
];

export function userFacingResearchModeStrings(source: string): string[] {
  return USER_FACING_MODE_STRINGS
    .filter((pattern) => pattern.test(source))
    .map((pattern) => String(pattern));
}
