export const INTAKE_SOURCE_TYPES = [
  "concept",
  "treatment",
  "existing-screenplay",
  "source-material",
  "biblical-historical",
] as const;

export type IntakeSourceType = (typeof INTAKE_SOURCE_TYPES)[number];
export type ExistingScreenplayMode = "use-as-is" | "refine" | "rewrite";
export type ScreenplayWorkflow = "single" | "general-7-pass" | "biblical-7-pass";
export type HistoricalConfidence = "A" | "B" | "C" | "D";

export type ImportedTextSource = {
  fileName: string;
  mediaType: "text/plain" | "text/markdown" | "text/fountain";
  importedAt: number;
  text: string;
};

export type SocialWorldEntry = {
  id: string;
  expectedBehavior: string;
  violationOrReversal: string;
  whoWouldNotice: string;
  visibleReaction: string;
  socialConsequence: string;
  historicalConfidence: HistoricalConfidence;
  evidenceNote: string;
};

export type PictureIntake = {
  schemaVersion: 1;
  sourceType: IntakeSourceType;
  title: string;
  concept: string;
  premise: string;
  logline: string;
  storyNotes: string;
  treatment: string;
  existingScreenplay: string;
  existingScreenplayMode: ExistingScreenplayMode;
  sourceMaterial: string;
  adaptationInstructions: string;
  materialToPreserve: string;
  materialMayDramatize: string;
  sourcePassages: string;
  suppliedSourceText: string;
  fidelityRequirements: string;
  historicalPeriod: string;
  culturalSocialWorld: string;
  adaptationBoundaries: string;
  importedSources: ImportedTextSource[];
  targetRuntimeMinutes: number;
  runtimeSource?: "manual" | "idea";
  genre: string;
  tone: string;
  audienceRating: string;
  aspectRatio: string;
  frameRate: number;
  productionStyle: string;
  directorNotes: string;
  dialogueStyle: string;
  storyConstraints: string;
  mustInclude: string;
  mustAvoid: string;
  workflow: ScreenplayWorkflow;
  screenplayModelId: string | null;
  socialWorld: SocialWorldEntry[];
  createdAt: number;
  updatedAt: number;
};

export type IntakeValidation = {
  valid: boolean;
  fields: Partial<Record<keyof PictureIntake, string>>;
};

export const SOURCE_TYPE_LABELS: Record<IntakeSourceType, string> = {
  concept: "Concept / Logline",
  treatment: "Treatment / Outline",
  "existing-screenplay": "Existing Screenplay",
  "source-material": "Source Material",
  "biblical-historical": "Biblical / Historical Source",
};

export const WORKFLOW_LABELS: Record<ScreenplayWorkflow, string> = {
  single: "Single Draft",
  "general-7-pass": "General 7-Pass",
  "biblical-7-pass": "Biblical / Historical 7-Pass",
};

export function makePictureIntake(now = Date.now()): PictureIntake {
  return {
    schemaVersion: 1,
    sourceType: "concept",
    title: "",
    concept: "",
    premise: "",
    logline: "",
    storyNotes: "",
    treatment: "",
    existingScreenplay: "",
    existingScreenplayMode: "use-as-is",
    sourceMaterial: "",
    adaptationInstructions: "",
    materialToPreserve: "",
    materialMayDramatize: "",
    sourcePassages: "",
    suppliedSourceText: "",
    fidelityRequirements: "",
    historicalPeriod: "",
    culturalSocialWorld: "",
    adaptationBoundaries: "",
    importedSources: [],
    targetRuntimeMinutes: 90,
    genre: "Drama",
    tone: "Cinematic, naturalistic, restrained",
    audienceRating: "",
    aspectRatio: "16:9",
    frameRate: 24,
    productionStyle: "",
    directorNotes: "",
    dialogueStyle: "",
    storyConstraints: "",
    mustInclude: "",
    mustAvoid: "",
    workflow: "single",
    screenplayModelId: null,
    socialWorld: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function sourceTextForIntake(intake: PictureIntake): string {
  switch (intake.sourceType) {
    case "concept":
      return [intake.concept, intake.premise, intake.logline, intake.storyNotes].filter(Boolean).join("\n\n");
    case "treatment":
      return intake.treatment || intake.importedSources.map((item) => item.text).join("\n\n");
    case "existing-screenplay":
      return intake.existingScreenplay || intake.importedSources.map((item) => item.text).join("\n\n");
    case "source-material":
      return intake.sourceMaterial || intake.importedSources.map((item) => item.text).join("\n\n");
    case "biblical-historical":
      return [intake.sourcePassages, intake.suppliedSourceText].filter(Boolean).join("\n\n");
  }
}

export function validatePictureIntake(intake: PictureIntake): IntakeValidation {
  const fields: IntakeValidation["fields"] = {};
  if (!intake.title.trim()) fields.title = "Title is required.";
  if (!sourceTextForIntake(intake).trim()) {
    const key: keyof PictureIntake = intake.sourceType === "concept"
      ? "premise"
      : intake.sourceType === "treatment"
        ? "treatment"
        : intake.sourceType === "existing-screenplay"
          ? "existingScreenplay"
          : intake.sourceType === "source-material"
            ? "sourceMaterial"
            : "suppliedSourceText";
    fields[key] = "Add the story or source material to continue.";
  }
  if (!Number.isFinite(intake.targetRuntimeMinutes) || intake.targetRuntimeMinutes <= 0) {
    fields.targetRuntimeMinutes = "Runtime must be greater than zero.";
  }
  if (!Number.isFinite(intake.frameRate) || intake.frameRate <= 0) fields.frameRate = "Frame rate must be greater than zero.";
  if (intake.sourceType === "biblical-historical" && intake.workflow !== "biblical-7-pass") {
    fields.workflow = "Biblical / Historical projects use the fidelity-aware workflow.";
  }
  return { valid: Object.keys(fields).length === 0, fields };
}

export function sourceMediaType(fileName: string): ImportedTextSource["mediaType"] | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".fountain")) return "text/fountain";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return null;
}

export function makeSocialWorldEntry(id: string): SocialWorldEntry {
  return {
    id,
    expectedBehavior: "",
    violationOrReversal: "",
    whoWouldNotice: "",
    visibleReaction: "",
    socialConsequence: "",
    historicalConfidence: "C",
    evidenceNote: "",
  };
}
