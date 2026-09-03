import type {
  HistoricalConfidence,
  IntakeSourceType,
  PictureIntake,
  ScreenplayWorkflow,
  SocialWorldEntry,
} from "./picture-intake.ts";

export type ScreenplayStatus = "DRAFT" | "GENERATING" | "READY_FOR_REVIEW" | "APPROVED";
export type ScreenplayVersionKind = "original-intake" | "draft" | "pass" | "manual" | "restored" | "approved";

export type ScreenplayGenerationSettings = {
  temperature: number;
  topP: number;
  maxTokens: number;
  contextSize: number;
  gpuLayers: number;
  seed: number;
};

export const DEFAULT_SCREENPLAY_SETTINGS: ScreenplayGenerationSettings = {
  temperature: 0.72,
  topP: 0.9,
  maxTokens: 4096,
  contextSize: 32768,
  gpuLayers: 999,
  seed: -1,
};

export type ScreenplayModelRef = {
  id: string;
  servedModelId: string;
  localCatalogModelId: string | null;
  displayName: string;
  checkpoint: string;
  precision: string;
  quantization: string;
  contextLength: number | null;
  sizeBytes: number;
  runtimeAdapter: string;
  status: "ready" | "unavailable" | "needs-validation";
  statusReason: string;
  loadVerifiedAt?: number;
};

export type ScreenplayVersion = {
  id: string;
  label: string;
  kind: ScreenplayVersionKind;
  fountain: string;
  createdAt: number;
  model: ScreenplayModelRef | null;
  workflow: ScreenplayWorkflow;
  pass: number | null;
  sourceVersionId: string | null;
  settings: ScreenplayGenerationSettings | null;
};

export type ScreenplayGenerationState = {
  runId: string;
  startedAt: number;
  activeStep: number;
  totalSteps: number;
  activeLabel: string;
  completedLabels: string[];
  modelId: string;
};

export type PictureScreenplay = {
  schemaVersion: 1;
  workflow: ScreenplayWorkflow;
  selectedModelId: string | null;
  status: ScreenplayStatus;
  versions: ScreenplayVersion[];
  currentVersionId: string | null;
  approvedVersionId: string | null;
  workingFountain: string;
  generation: ScreenplayGenerationState | null;
  lastTelemetry: ScreenplayTelemetry | null;
  updatedAt: number;
};

export type ScreenplayTelemetry = {
  providerId: string;
  provider: string;
  endpoint: string;
  actualLoadedModel: string;
  local: boolean;
  cloudFallback: boolean;
  modelId: string;
  checkpoint: string;
  runtimeAdapter: string;
  loadMs: number | null;
  generationMs: number | null;
  unloadMs: number | null;
  promptTokens: number | null;
  generatedTokens: number | null;
  peakVramBytes: number | null;
  peakSystemRamBytes: number | null;
  resourceMeasurement: "system-total" | "unavailable";
  unloaded: boolean;
  unloadVerification: "verified" | "not-supported" | "failed";
  measuredAt: number;
};

/** Frozen handoff consumed by post-approval Breakdown/Inventory. */
export type ApprovedScreenplayBoundary = {
  schemaVersion: 1;
  pictureId: string;
  screenplayVersionId: string;
  approvedAt: number;
  fountain: string;
  scenes: { id: string; slugline: string; sourceLine: number; screenplayVersionId: string }[];
  provenance: {
    workflow: ScreenplayWorkflow;
    sourceType: IntakeSourceType;
    sourceVersionId: string | null;
    model: ScreenplayModelRef | null;
  };
  historicalContext: {
    confidenceLegend: Record<HistoricalConfidence, string>;
    socialWorld: SocialWorldEntry[];
    sourceReferences: string;
    fidelityRequirements: string;
    adaptationBoundaries: string;
  } | null;
};

export function makePictureScreenplay(workflow: ScreenplayWorkflow, modelId: string | null, now = Date.now()): PictureScreenplay {
  return {
    schemaVersion: 1,
    workflow,
    selectedModelId: modelId,
    status: "DRAFT",
    versions: [],
    currentVersionId: null,
    approvedVersionId: null,
    workingFountain: "",
    generation: null,
    lastTelemetry: null,
    updatedAt: now,
  };
}

export function createOriginalIntakeVersion(
  intake: PictureIntake,
  sourceText: string,
  id: string,
  now = Date.now(),
): ScreenplayVersion {
  return {
    id,
    label: "Original Intake",
    kind: "original-intake",
    fountain: sourceText,
    createdAt: now,
    model: null,
    workflow: intake.workflow,
    pass: null,
    sourceVersionId: null,
    settings: null,
  };
}

export function appendScreenplayVersion(state: PictureScreenplay, version: ScreenplayVersion): PictureScreenplay {
  if (state.versions.some((item) => item.id === version.id)) return state;
  return {
    ...state,
    status: version.kind === "approved" ? "APPROVED" : "READY_FOR_REVIEW",
    versions: [...state.versions, version],
    currentVersionId: version.id,
    approvedVersionId: version.kind === "approved" ? version.id : state.approvedVersionId,
    workingFountain: version.fountain,
    updatedAt: version.createdAt,
  };
}

export function addManualScreenplayVersion(
  state: PictureScreenplay,
  fountain: string,
  id: string,
  now = Date.now(),
): PictureScreenplay {
  const source = state.currentVersionId;
  return appendScreenplayVersion(state, {
    id,
    label: `Manual revision ${state.versions.filter((item) => item.kind === "manual").length + 1}`,
    kind: "manual",
    fountain,
    createdAt: now,
    model: null,
    workflow: state.workflow,
    pass: null,
    sourceVersionId: source,
    settings: null,
  });
}

export function restoreScreenplayVersion(
  state: PictureScreenplay,
  sourceVersionId: string,
  id: string,
  now = Date.now(),
): PictureScreenplay {
  const source = state.versions.find((item) => item.id === sourceVersionId);
  if (!source) return state;
  return appendScreenplayVersion(state, {
    ...source,
    id,
    label: `Restored · ${source.label}`,
    kind: "restored",
    createdAt: now,
    sourceVersionId: source.id,
  });
}

export function approveCurrentScreenplay(state: PictureScreenplay, id: string, now = Date.now()): PictureScreenplay {
  const current = state.versions.find((item) => item.id === state.currentVersionId);
  if (!current || !current.fountain.trim()) return state;
  return appendScreenplayVersion(state, {
    ...current,
    id,
    label: "Approved Screenplay",
    kind: "approved",
    createdAt: now,
    sourceVersionId: current.id,
  });
}

export function screenplayScenes(fountain: string): { slugline: string; line: number }[] {
  return fountain.split(/\r?\n/).reduce<{ slugline: string; line: number }[]>((out, raw, index) => {
    const line = raw.trim();
    if (/^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i.test(line)) out.push({ slugline: line, line: index + 1 });
    return out;
  }, []);
}

export function approvedScreenplayBoundary(
  pictureId: string,
  intake: PictureIntake,
  screenplay: PictureScreenplay,
): ApprovedScreenplayBoundary | null {
  if (!screenplay.approvedVersionId) return null;
  const version = screenplay.versions.find((item) => item.id === screenplay.approvedVersionId);
  if (!version) return null;
  return {
    schemaVersion: 1,
    pictureId,
    screenplayVersionId: version.id,
    approvedAt: version.createdAt,
    fountain: version.fountain,
    scenes: screenplayScenes(version.fountain).map((scene, index) => ({
      id: `${version.id}:scene:${String(index + 1).padStart(3, "0")}`,
      slugline: scene.slugline,
      sourceLine: scene.line,
      screenplayVersionId: version.id,
    })),
    provenance: {
      workflow: version.workflow,
      sourceType: intake.sourceType,
      sourceVersionId: version.sourceVersionId,
      model: version.model,
    },
    historicalContext: intake.sourceType === "biblical-historical" ? {
      confidenceLegend: {
        A: "Explicit source / Scripture",
        B: "Strong historical or social evidence",
        C: "Reasonable historical reconstruction",
        D: "Disputed tradition / interpretation",
      },
      socialWorld: intake.socialWorld.map((entry) => ({ ...entry })),
      sourceReferences: intake.sourcePassages,
      fidelityRequirements: intake.fidelityRequirements,
      adaptationBoundaries: intake.adaptationBoundaries,
    } : null,
  };
}
