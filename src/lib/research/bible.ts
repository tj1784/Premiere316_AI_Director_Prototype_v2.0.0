import { sourceTextForIntake, type PictureIntake } from "../studio/picture-intake.ts";
import { classARequiresLocator, isResearchConfidence, type ResearchConfidence } from "./confidence.ts";

export type ResearchMode = "local-only" | "web-assisted-opt-in";
export type ResearchStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "DELTA_PENDING";
export type ResearchScope = "whole-picture" | "delta";

export type ResearchSource = {
  id: string;
  title: string;
  locator: string;
  quote: string;
  confidence: ResearchConfidence;
  importedFrom: string | null;
  createdAt: number;
};

export type ResearchDispute = {
  id: string;
  sourceIds: string[];
  claim: string;
  createdAt: number;
};

export type ResearchCinematicExpression = {
  blocking: string;
  costumeOrStatusSign: string;
  silenceOrWithholding: string;
  gazeOrSpatialHonor: string;
  prohibitedExposition: string;
};

export type ResearchSocialWorldNote = {
  id: string;
  expectedBehavior: string;
  violationOrReversal: string;
  whoWouldNotice: string;
  visibleReaction: string;
  socialConsequence: string;
  cinematicExpression: ResearchCinematicExpression;
  confidence: ResearchConfidence;
  evidenceNote: string;
  sceneHints: string[];
};

export type CinematographyResearchManifesto = {
  thesis: string;
  lensLanguage: string;
  lighting: string;
  geography: string;
  movement: string;
  texture: string;
  soundWorld: string;
  musicResearch: string;
};

export type ResearchContent = {
  mode: ResearchMode;
  sources: ResearchSource[];
  disputes: ResearchDispute[];
  socialWorldNotes: ResearchSocialWorldNote[];
  cinematographyManifesto: CinematographyResearchManifesto;
  risks: string;
  feasibility: string;
  notes: string;
};

export type ResearchVersion = {
  id: string;
  label: string;
  kind: "draft" | "delta" | "approved";
  scope: ResearchScope;
  createdAt: number;
  sourceVersionId: string | null;
  content: ResearchContent;
};

export type PictureResearchBible = {
  schemaVersion: 1;
  status: ResearchStatus;
  scope: ResearchScope;
  content: ResearchContent;
  versions: ResearchVersion[];
  currentVersionId: string | null;
  approvedVersionId: string | null;
  approvedAt: number | null;
  updatedAt: number;
};

export function emptyCinematicExpression(): ResearchCinematicExpression {
  return {
    blocking: "",
    costumeOrStatusSign: "",
    silenceOrWithholding: "",
    gazeOrSpatialHonor: "",
    prohibitedExposition: "",
  };
}

export function emptyManifesto(): CinematographyResearchManifesto {
  return {
    thesis: "",
    lensLanguage: "",
    lighting: "",
    geography: "",
    movement: "",
    texture: "",
    soundWorld: "",
    musicResearch: "",
  };
}

export function emptyResearchContent(): ResearchContent {
  return {
    mode: "local-only",
    sources: [],
    disputes: [],
    socialWorldNotes: [],
    cinematographyManifesto: emptyManifesto(),
    risks: "",
    feasibility: "",
    notes: "",
  };
}

export function makeEmptyResearchBible(now = Date.now()): PictureResearchBible {
  return {
    schemaVersion: 1,
    status: "DRAFT",
    scope: "whole-picture",
    content: emptyResearchContent(),
    versions: [],
    currentVersionId: null,
    approvedVersionId: null,
    approvedAt: null,
    updatedAt: now,
  };
}

export function cloneResearchContent(content: ResearchContent): ResearchContent {
  return structuredClone(content);
}

export function seedResearchBibleFromIntake(intake: PictureIntake, now = Date.now()): PictureResearchBible {
  const bible = makeEmptyResearchBible(now);
  const sources: ResearchSource[] = [];
  for (const imported of intake.importedSources) {
    sources.push({
      id: `src:import:${imported.fileName}:${imported.importedAt}`,
      title: imported.fileName,
      locator: imported.fileName,
      quote: imported.text.slice(0, 400),
      confidence: "C",
      importedFrom: imported.fileName,
      createdAt: imported.importedAt,
    });
  }
  if (intake.sourcePassages.trim()) {
    sources.push({
      id: `src:passages:${now}`,
      title: "Source passages",
      locator: intake.sourcePassages.split(/\n/)[0]?.slice(0, 120) ?? "",
      quote: intake.sourcePassages.slice(0, 400),
      confidence: intake.sourceType === "biblical-historical" ? "A" : "C",
      importedFrom: null,
      createdAt: now,
    });
  }
  const text = sourceTextForIntake(intake).trim();
  if (text && sources.length === 0) {
    sources.push({
      id: `src:intake:${now}`,
      title: "Picture intake",
      locator: intake.sourceType,
      quote: text.slice(0, 400),
      confidence: "C",
      importedFrom: null,
      createdAt: now,
    });
  }
  const socialWorldNotes = intake.sourceType === "biblical-historical"
    ? intake.socialWorld.map((entry) => ({
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
    }))
    : [];
  bible.content = {
    ...bible.content,
    sources,
    socialWorldNotes,
    cinematographyManifesto: {
      ...emptyManifesto(),
      thesis: intake.productionStyle || intake.directorNotes,
    },
    notes: intake.storyNotes,
  };
  return bible;
}

export function hydratePictureResearch(
  research: PictureResearchBible | null | undefined,
  intake: PictureIntake,
  now = Date.now(),
): PictureResearchBible {
  if (research?.schemaVersion === 1) {
    return {
      ...research,
      content: {
        ...emptyResearchContent(),
        ...research.content,
        mode: research.content?.mode === "web-assisted-opt-in" ? "web-assisted-opt-in" : "local-only",
        sources: Array.isArray(research.content?.sources) ? research.content.sources : [],
        disputes: Array.isArray(research.content?.disputes) ? research.content.disputes : [],
        socialWorldNotes: Array.isArray(research.content?.socialWorldNotes) ? research.content.socialWorldNotes : [],
        cinematographyManifesto: { ...emptyManifesto(), ...research.content?.cinematographyManifesto },
      },
      versions: Array.isArray(research.versions) ? research.versions : [],
    };
  }
  return seedResearchBibleFromIntake(intake, now);
}

export function isResearchApproved(research: PictureResearchBible | null | undefined): boolean {
  return Boolean(research?.approvedVersionId && (research.status === "APPROVED" || research.status === "DELTA_PENDING"));
}

export function researchBlocksScreenplay(research: PictureResearchBible | null | undefined): string | null {
  if (!isResearchApproved(research)) return "Approve Picture Research before generating a screenplay.";
  return null;
}

export function appendResearchVersion(
  bible: PictureResearchBible,
  version: ResearchVersion,
): PictureResearchBible {
  if (bible.versions.some((item) => item.id === version.id)) return bible;
  return {
    ...bible,
    status: version.kind === "approved" ? "APPROVED" : version.kind === "delta" ? "DELTA_PENDING" : "IN_REVIEW",
    scope: version.scope,
    content: cloneResearchContent(version.content),
    versions: [...bible.versions, version],
    currentVersionId: version.id,
    approvedVersionId: version.kind === "approved" ? version.id : bible.approvedVersionId,
    approvedAt: version.kind === "approved" ? version.createdAt : bible.approvedAt,
    updatedAt: version.createdAt,
  };
}

export function saveResearchDraft(
  bible: PictureResearchBible,
  content: ResearchContent,
  id: string,
  now = Date.now(),
): PictureResearchBible | { error: string } {
  const invalid = content.sources
    .map((source) => classARequiresLocator(source.confidence, source.locator))
    .find(Boolean);
  if (invalid) return { error: invalid };
  if (content.mode === "web-assisted-opt-in") {
    /* Mode is persisted as a visible stub only. It must never emit network. */
  }
  return appendResearchVersion(bible, {
    id,
    label: `Research draft ${bible.versions.filter((item) => item.kind === "draft").length + 1}`,
    kind: "draft",
    scope: "whole-picture",
    createdAt: now,
    sourceVersionId: bible.currentVersionId,
    content: cloneResearchContent(content),
  });
}

export function approveResearchBible(
  bible: PictureResearchBible,
  id: string,
  now = Date.now(),
): PictureResearchBible | { error: string } {
  const saved = bible.currentVersionId ? bible : saveResearchDraft(bible, bible.content, `${id}:draft`, now);
  if ("error" in saved) return saved;
  return appendResearchVersion(saved, {
    id,
    label: "Approved Research Bible",
    kind: "approved",
    scope: "whole-picture",
    createdAt: now,
    sourceVersionId: saved.currentVersionId,
    content: cloneResearchContent(saved.content),
  });
}

export function approvedResearchSnapshot(bible: PictureResearchBible): ResearchContent | null {
  if (!bible.approvedVersionId) return null;
  const version = bible.versions.find((item) => item.id === bible.approvedVersionId);
  return version ? cloneResearchContent(version.content) : null;
}
