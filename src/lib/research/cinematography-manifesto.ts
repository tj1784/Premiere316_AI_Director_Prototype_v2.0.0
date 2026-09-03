import type { CinematographyResearchManifesto, PictureResearchBible, ResearchContent } from "./bible.ts";
import { cloneResearchContent, emptyManifesto } from "./bible.ts";

export type ApprovedCinematographyResearchSnapshot = {
  schemaVersion: 1;
  approvedVersionId: string;
  approvedAt: number;
  manifesto: CinematographyResearchManifesto;
};

export function freezeCinematographyResearch(bible: PictureResearchBible): ApprovedCinematographyResearchSnapshot | null {
  if (!bible.approvedVersionId || !bible.approvedAt) return null;
  const version = bible.versions.find((item) => item.id === bible.approvedVersionId);
  if (!version) return null;
  return {
    schemaVersion: 1,
    approvedVersionId: version.id,
    approvedAt: bible.approvedAt,
    manifesto: { ...emptyManifesto(), ...version.content.cinematographyManifesto },
  };
}

export function patchManifesto(content: ResearchContent, patch: Partial<CinematographyResearchManifesto>): ResearchContent {
  const next = cloneResearchContent(content);
  next.cinematographyManifesto = { ...next.cinematographyManifesto, ...patch };
  return next;
}
