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
  | "READY_FOR_REVIEW"
  | "APPROVED_SPEC"
  | "READY_TO_PREPARE"
  | "APPROVED_PREPARED"
  | "READY_TO_GENERATE"
  | "GENERATED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "BLOCKED";
export type PreparationQueueStatus = "PLANNED" | "PREFLIGHTED" | "READY" | "BLOCKED" | "WAITING_FOR_REFERENCE" | "APPROVED_PREPARED";

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

export type IterationContinuityFinding = {
  id: string;
  severity: "note" | "warning" | "blocker";
  message: string;
  confirmed: boolean;
};

export type BackendCanonicalProof = {
  decisionId: string;
  authorityId?: string;
  receiptId: string;
  signedRecordMac: string;
  generationReceiptDigest: string;
  preparedApprovalRootId: string;
  preparedApprovalDigest: string;
  preparedSealDigest: string;
  assetId: string;
  preparedAssetId: string;
  iterationId: string;
  reasonDigest: string;
  continuityDigest: string;
  outputDigest: string;
};

export type IterationReviewDecision = {
  id: string;
  iterationId: string;
  at: number;
  decision: "needs-review" | "approve" | "reject" | "confirm-continuity";
  reviewer: "user" | "package-uat";
  reason: string;
  continuityFindings: IterationContinuityFinding[];
  dependencyFingerprints: import("./dependency-graph.ts").SourceFingerprint[];
  canonicalProof?: BackendCanonicalProof | null;
};

export type GeneratedIteration = {
  id: string;
  preparedAssetId?: string;
  assetId?: string;
  variantId: string | null;
  specVersionId?: string;
  mediaUri: string;
  mediaSha256?: string;
  sidecarSha256?: string;
  width?: number;
  height?: number;
  byteLength?: number;
  createdAt: number;
  status: "GENERATED" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "STALE";
  provenance: Provenance;
  execution?: import("../studio/generation-provenance.ts").GenerationProvenance | null;
  dependencyFingerprints?: import("./dependency-graph.ts").SourceFingerprint[];
  reviewDecisionIds?: string[];
  reviewDecisions?: IterationReviewDecision[];
  generationReceiptId?: string | null;
  generationReceiptDigest?: string | null;
  receiptContinuityFindings?: IterationContinuityFinding[];
  canonicalProof?: BackendCanonicalProof | null;
};

export type AssetLineageEvent = {
  id: string;
  type: "created" | "edited" | "merged" | "split" | "reference-linked" | "approved-spec" | "prepared" | "approved-prepared" | "iteration-generated" | "iteration-reviewed" | "iteration-approved";
  at: number;
  sourceAssetIds: string[];
  targetAssetIds: string[];
  reason: string;
};

export type AssetConflict = {
  id: string;
  severity: "note" | "warning" | "blocker";
  message: string;
  sourceIds: string[];
  resolved: boolean;
};

export type AssetSpecVersion = {
  id: string;
  assetId: string;
  createdAt: number;
  sourceVersionId: string | null;
  spec: CanonicalAssetSpec;
  approved: boolean;
  provenance: Provenance[];
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
  specVersions?: AssetSpecVersion[];
  approvedSpecVersionId?: string | null;
  aliasesOf?: string[];
  tombstone?: boolean;
  lineage?: AssetLineageEvent[];
  conflicts?: AssetConflict[];
  stale: boolean;
  staleReasons: string[];
  blockedReasons: string[];
  provenance: Provenance[];
  readiness: AssetReadiness;
  updatedAt: number;
};

export type DependencyEdge = {
  fromType: "screenplay-version" | "research-version" | "scene" | "requirement" | "asset" | "variant" | "reference" | "generation-spec" | "prepared-asset" | "iteration";
  fromId: string;
  toType: "scene" | "requirement" | "asset" | "variant" | "reference" | "generation-spec" | "prepared-asset" | "iteration" | "approved-asset";
  toId: string;
  reason?: string;
};

export type PreparedAssetRecord = {
  id: string;
  assetId: string;
  variantId: string | null;
  specVersionId: string | null;
  visualBibleVersionIds: string[];
  cinematographyPlanIds: string[];
  status: "BLOCKED" | "READY_TO_PREPARE" | "APPROVED_PREPARED";
  blockers: string[];
  promptIngredients: string[];
  negativeRequirements: string[];
  referenceIds: string[];
  dependencyFingerprints: import("./dependency-graph.ts").SourceFingerprint[];
  noGeneration: true;
  createdAt: number;
  approvedAt: number | null;
  preparedApprovalRootId?: string | null;
  preparedApprovalDigest?: string | null;
  productionAuthorityId?: string | null;
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
  graph?: import("./dependency-graph.ts").DependencyGraphV2 | null;
  sourceBoundary?: import("./dependency-graph.ts").BreakdownSourceBoundary | null;
  inventoryVersion?: number;
  approvals?: AssetLineageEvent[];
  auditLog?: AssetLineageEvent[];
  preparedAssets?: PreparedAssetRecord[];
  productionAuthority?: { authorityId: string | null; digest: string | null; createdAt: number | null; status: "CURRENT" | "DIRTY_RESEAL_REQUIRED" | "NO_AUTHORITY" | "INVALID" } | null;
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
