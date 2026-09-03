export const PRODUCTION_CATEGORIES = [
  "character",
  "location",
  "wardrobe",
  "hair_makeup",
  "prop",
  "creature",
  "vehicle",
  "practical_effect",
  "vfx",
  "set_dressing",
  "signage",
  "voice",
  "sound",
  "music",
  "continuity",
  "other",
] as const;

export type ProductionCategory = (typeof PRODUCTION_CATEGORIES)[number];
export type SourceConfidence = "A" | "B" | "C" | "D";
export type AssetReadiness =
  | "NOT_PREPARED"
  | "PREPARING"
  | "READY_TO_GENERATE"
  | "GENERATED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "BLOCKED";
export type PreparationQueueStatus = "PLANNED" | "PREFLIGHTED" | "READY" | "BLOCKED" | "WAITING_FOR_REFERENCE";

export type ApprovedSceneInput = {
  id: string;
  slugline: string;
  summary?: string;
};

export type SocialWorldMetadata = {
  id: string;
  expectedBehavior: string;
  violationOrReversal: string;
  whoWouldNotice: string;
  visibleReaction: string;
  statusHonorImplication: string;
  confidence: SourceConfidence;
  evidenceNote: string;
  sceneIds: string[];
};

export type ApprovedScreenplayInput = {
  pictureId: string;
  versionId: string;
  status: "DRAFT" | "READY_FOR_REVIEW" | "APPROVED";
  fountain: string;
  scenes: ApprovedSceneInput[];
  socialWorld: SocialWorldMetadata[];
  sourceContext?: {
    workflow: string;
    sourceType: string;
    sourceVersionId: string | null;
    screenplayModelId: string | null;
    confidenceLegend: Partial<Record<SourceConfidence, string>>;
    sourceReferences: string;
    fidelityRequirements: string;
    adaptationBoundaries: string;
  };
};

export type Provenance = {
  sourceType: "screenplay" | "historical-source" | "user" | "legacy-migration";
  screenplayVersionId: string;
  sceneIds: string[];
  confidence?: SourceConfidence;
  evidenceNote?: string;
  createdAt: number;
};

export type BreakdownRequirementDraft = {
  id: string;
  category: ProductionCategory;
  name: string;
  description: string;
  sceneIds: string[];
  variantLabel?: string;
  hero?: boolean;
  referenceRequired?: boolean;
  confidence?: SourceConfidence;
  evidenceNote?: string;
  socialWorldIds?: string[];
};

export type BreakdownRequirement = BreakdownRequirementDraft & {
  normalizedKey: string;
  unnecessary: boolean;
  stale: boolean;
  staleReasons: string[];
};

export type CanonicalAssetSpec = {
  identity: string;
  visualDescription: string;
  age?: string;
  appearance?: string;
  facialGeometry?: string;
  build?: string;
  hair?: string;
  skin?: string;
  wardrobe?: string;
  distinguishingFeatures: string[];
  prohibitedFeatures: string[];
  visualStyle?: string;
  period?: string;
  geography?: string;
  architecture?: string;
  materials: string[];
  lighting?: string;
  weather?: string;
  timeOfDay?: string;
  scale?: string;
  setDressing: string[];
  soundCharacter?: string;
  performanceNotes?: string;
  continuityLocks: string[];
  negativeRequirements: string[];
};

export type AssetReference = {
  id: string;
  name: string;
  uri: string;
  mediaType: string;
  preferred: boolean;
  uploadedAt: number;
  provenance: Provenance;
};

export type AssetVariant = {
  id: string;
  name: string;
  requiredSceneIds: string[];
  requirementIds: string[];
  specPatch: Partial<CanonicalAssetSpec>;
  stale: boolean;
  staleReasons: string[];
};

export type GeneratedIteration = {
  id: string;
  variantId: string | null;
  mediaUri: string;
  createdAt: number;
  status: "GENERATED" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
  provenance: Provenance;
};

export type ProductionAsset = {
  id: string;
  normalizedKey: string;
  name: string;
  aliases: string[];
  category: ProductionCategory;
  hero: boolean;
  requirementIds: string[];
  requiredSceneIds: string[];
  socialWorldIds: string[];
  canonicalSpec: CanonicalAssetSpec;
  canonicalApproved: boolean;
  references: AssetReference[];
  referenceRequired: boolean;
  variants: AssetVariant[];
  iterations: GeneratedIteration[];
  approvedIterationId: string | null;
  rejectedIterationIds: string[];
  stale: boolean;
  staleReasons: string[];
  blockedReasons: string[];
  provenance: Provenance[];
  readiness: AssetReadiness;
  updatedAt: number;
};

export type DependencyEdge = {
  fromType: "screenplay-version" | "scene" | "requirement" | "asset" | "variant" | "generation-spec" | "iteration";
  fromId: string;
  toType: "scene" | "requirement" | "asset" | "variant" | "generation-spec" | "iteration" | "approved-asset";
  toId: string;
};

export type PreparationQueueRecord = {
  id: string;
  assetId: string;
  variantId: string | null;
  status: PreparationQueueStatus;
  promptIngredients: string[];
  negativeRequirements: string[];
  referenceIds: string[];
  dependencyIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type ProductionBreakdown = {
  schemaVersion: 1;
  pictureId: string;
  screenplayVersionId: string;
  scenes: ApprovedSceneInput[];
  socialWorld: SocialWorldMetadata[];
  sourceContext?: ApprovedScreenplayInput["sourceContext"];
  requirements: BreakdownRequirement[];
  assets: ProductionAsset[];
  dependencies: DependencyEdge[];
  queue: PreparationQueueRecord[];
  createdAt: number;
  updatedAt: number;
};

export type BreakdownPreflight = {
  total: number;
  byCategory: Record<ProductionCategory, number>;
  byReadiness: Record<AssetReadiness, number>;
  ready: number;
  needReview: number;
  blocked: number;
};
