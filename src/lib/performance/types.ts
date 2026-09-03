import type { LocalLLMProvider } from "@/lib/studio/local-llm-provider.ts";
import type { SocialWorldMetadata } from "@/lib/production/types.ts";

export const SPARKY_SCHEMA_VERSION = 1 as const;

export const SPARKY_STAGE_ID = "performance" as const;

export const SHOT_KIND = [
  "establishing",
  "coverage",
  "closeup",
  "insert",
  "reaction",
  "detail",
  "default",
] as const;

export type ShotKind = (typeof SHOT_KIND)[number];

export const BEAT_KINDS = [
  "discovery",
  "accusation",
  "hesitation",
  "pursuit",
  "embrace",
  "reaction",
  "revelation",
  "transition",
  "default",
] as const;

export type BeatKind = (typeof BEAT_KINDS)[number];

export type ContinuityTrack = "visual" | "performance" | "story";

export type ShotReadyState =
  | "DRAFT"
  | "NEEDS_PERFORMANCE"
  | "WAITING_FOR_ASSETS"
  | "WAITING_FOR_REFERENCES"
  | "CONTINUITY_WARNING"
  | "READY_TO_COMPILE"
  | "READY_TO_GENERATE"
  | "STALE"
  | "BLOCKED";

export type QueueState = "PLANNED" | "PREFLIGHTED" | "WAITING_FOR_ASSETS" | "WAITING_FOR_REFERENCE" | "READY_TO_COMPILE" | "READY_TO_GENERATE" | "BLOCKED" | "STALE";

export type ShotCompilerState = "DRAFT" | "PLANNED" | "READY_TO_COMPILE" | "COMPILED" | "FAILED" | "BLOCKED";

export type ShotDurationPolicy = {
  minSeconds: number;
  targetMinSeconds: number;
  targetMaxSeconds: number;
};

export const SHOT_DURATION_POLICY: ShotDurationPolicy = {
  minSeconds: 6,
  targetMinSeconds: 10,
  targetMaxSeconds: 15,
};

export type ApprovedScreenplayReference = {
  pictureId: string;
  screenplayVersionId: string;
  approvedAt: number;
  sceneIds: string[];
  socialWorld: SocialWorldMetadata[];
  sourceType: "screenplay" | "historical-source" | "user" | "legacy-migration";
};

export type SceneSeed = {
  id: string;
  slugline: string;
  summary: string;
  durationSec?: number;
  sourceLine?: number;
  socialWorldIds?: string[];
};

export type BeatSeed = Omit<SceneBeat, "id">;

export type SceneBeat = {
  id: string;
  sceneId: string;
  sequence: number;
  title: string;
  kind: BeatKind;
  summary: string;
  durationSec: number;
  transitionFromPreviousSec: number;
  canSplit: boolean;
  dialogueText?: string;
  dependencies: { socialWorldIds: string[]; requiredCharacters: string[] };
  createdAt: number;
};

export type DialogueLine = {
  id: string;
  characterId: string;
  text: string;
  sequence: number;
  pauseMsBefore?: number;
};

export type DialogueAllocation = Record<string, string[]>;

export type PerformanceDirectionFace = {
  eyes?: string;
  gazeTarget?: string;
  blinkBehavior?: string;
  brows?: string;
  jaw?: string;
  mouth?: string;
  microExpression?: string;
  tearsOrSweat?: string;
};

export type PerformanceDirectionBody = {
  posture?: string;
  shoulders?: string;
  headPosition?: string;
  hands?: string;
  arms?: string;
  weightDistribution?: string;
  tension?: string;
  breathing?: string;
  fatigue?: string;
  injuriesOrLimitations?: string[];
};

export type PerformanceDirectionMovement = {
  startingPosition?: string;
  path?: string;
  speed?: string;
  hesitation?: string;
  gesture?: string;
  envInteraction?: string;
  otherCharacterInteraction?: string;
};

export type PerformanceDirectionRelationship = {
  distanceBetweenCharacters?: string;
  dominantSpatialRole?: string;
  eyeContact?: string;
  avoidance?: string;
  touch?: string;
  approaches?: string;
  withdraws?: string;
  fgBgPriority?: string;
};

export type PerformanceDirectionDialogue = {
  lines?: string[];
  speaker?: string;
  delivery?: string;
  pace?: string;
  pauses?: string;
  volume?: string;
  emphasis?: string;
  subtext?: string;
  interruption?: string;
  breathPlacement?: string;
  emotionalTransition?: string;
};

export type PerformanceEmotion = {
  primary?: string;
  secondary?: string;
  intensity?: number;
  concealed?: string;
  objective?: string;
};

export type PerformanceDirection = {
  schemaVersion: 1;
  sourceType: "manual" | "ai-suggestion";
  characterId: string;
  beatId: string;
  emotionalState?: PerformanceEmotion;
  face?: PerformanceDirectionFace;
  body?: PerformanceDirectionBody;
  movement?: PerformanceDirectionMovement;
  relationship?: PerformanceDirectionRelationship;
  dialogue?: PerformanceDirectionDialogue;
  lockedFields?: string[];
  blockedChanges?: string[];
  approvedAt?: number;
  updatedAt: number;
};

export type PerformanceState = {
  gazeDirection?: string;
  headOrientation?: string;
  bodyOrientation?: string;
  posture?: string;
  handPosition?: {
    left?: string;
    right?: string;
  };
  heldObjects?: Record<string, string | null>;
  walkingDirection?: string;
  characterDistanceMeters?: number;
  facialEmotion?: string;
  emotionalIntensity?: number;
  breathing?: string;
  injuries?: string[];
  dirtBloodWetness?: string;
  wardrobeState?: string;
  hairState?: string;
  environmentalInteraction?: string[];
  dialogueCompletion?: "started" | "midline" | "completed";
};

export type PerformanceContinuityEnvelope = {
  visual: {
    identity?: string;
    wardrobe?: string;
    props?: string[];
    wounds?: string[];
    environment?: string;
    lighting?: string;
    timeOfDay?: string;
    weather?: string;
  };
  performance: PerformanceState;
  story: {
    happened?: string[];
    knowledgeState?: string;
    relationships?: string[];
    objectives?: string[];
    chronologyNote?: string;
  };
};

export type ShotContinuitySpec = {
  requiredIn?: PerformanceContinuityEnvelope;
  requiredOut?: PerformanceContinuityEnvelope;
  hardLocks?: string[];
  permittedChanges?: string[];
  intentionalDiscontinuities?: string[];
};

export type ShotFraming = {
  shotSize?: string;
  cameraHeight?: string;
  angle?: string;
  lens?: string;
  composition?: string;
  aspectRatio?: string;
};

export type ShotCamera = {
  style?: "static" | "pan" | "tilt" | "dolly" | "truck" | "crane" | "handheld" | "orbit" | "push" | "pull";
  movementPath?: string;
  movementIntensity?: number;
  startComposition?: string;
  endComposition?: string;
  focusIntent?: string;
};

export type ApprovedAssetReference = {
  type: "character" | "location" | "prop" | "wardrobe";
  characterId?: string;
  approvedIdentityVersion?: string;
  wardrobeVariantId?: string;
  propVersionId?: string;
  locationVersionId?: string;
  referenceUris?: string[];
  approvedSceneVersion?: string;
};

export type ShotSubject = {
  characters: string[];
  actions?: string[];
  interactions?: string[];
  startingPositions?: Record<string, string>;
  finalPositions?: Record<string, string>;
  approvedReferences?: ApprovedAssetReference[];
  approvedSceneVersion?: string;
};

export type ShotWorld = {
  location?: string;
  approvedLocationVersion?: string;
  time?: string;
  weather?: string;
  lighting?: string;
  atmosphere?: string;
  setDressing?: string[];
};

export type ShotAudioIntent = {
  dialogue?: DialogueLine[];
  ambience?: string;
  foley?: string[];
  sfx?: string[];
  musicIntention?: string;
};

export type ShotReferences = {
  characterReference?: string[];
  wardrobe?: string[];
  location?: string[];
  props?: string[];
  firstFrame?: string[];
  lastFrame?: string[];
  additional?: string[];
};

export type CanonicalShotSpec = {
  schemaVersion: 1;
  shotId: string;
  canonicalShotId: string;
  version: number;
  pictureId: string;
  sceneId: string;
  beatId: string;
  sequenceOrder: number;
  durationSec: number;
  status: ShotReadyState;
  compilerState: ShotCompilerState;
  framing: ShotFraming;
  camera: ShotCamera;
  subject: ShotSubject;
  performanceIn: PerformanceContinuityEnvelope;
  performanceOut: PerformanceContinuityEnvelope;
  world: ShotWorld;
  continuity: ShotContinuitySpec;
  audio: ShotAudioIntent;
  references: ShotReferences;
  negatives: string[];
  intendedEngine: string;
  dependencyState: string[];
  legacy?: LegacyShotPayload;
  lastUpdatedBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type LegacyShotPayload = {
  id: string;
  type: string;
  description: string;
  camera: string;
  lens: string;
  cameraMove: string;
  emotion: string;
  expression: string;
  t2iPrompt?: string;
  i2vPrompt?: string;
  stillUrl?: string;
  videoUrl?: string;
};

export type ShotVersionSummary = {
  shotId: string;
  version: number;
  schemaVersion: 1;
  createdAt: number;
  dependencies: string[];
};

export type ShotDependencyKind = "screenplay-version" | "scene" | "beat" | "asset" | "shot" | "queue";

export type DependencyEdge = { from: { kind: ShotDependencyKind; id: string }; to: { kind: ShotDependencyKind; id: string }; reason: string };

export type DependencyGraph = {
  nodes: Array<{ kind: ShotDependencyKind; id: string }>;
  edges: DependencyEdge[];
};

export type ContinuityDecision = {
  id: string;
  fromShotId: string;
  toShotId: string;
  sceneId: string;
  beatId: string;
  allowedFields: string[];
  note: string;
  intentional: true;
  createdAt: number;
};

export type ShotPreparationQueueEntry = {
  queueId: string;
  shotId: string;
  canonicalShotVersion: number;
  approvedReferences: ApprovedAssetReference[];
  intendedEngine: string;
  dependencyState: string[];
  readiness: QueueState;
  compileState: "PLANNED" | "COMPILING" | "COMPILED" | "FAILED" | "READY" | "BLOCKED";
  createdAt: number;
  updatedAt: number;
};

export type Stage2AssetCatalogRef = {
  characterId?: string;
  approvedIdentityVersion?: string;
  wardrobeVariantId?: string;
  propVersionId?: string;
  locationVersionId?: string;
};

export type DependencyChangeEvent =
  | { type: "asset-change"; assetId: string; assetVersionId?: string; reason: string }
  | { type: "scene-change"; sceneId: string; reason: string }
  | { type: "beat-change"; beatId: string; reason: string }
  | { type: "dialogue-change"; beatId: string; reason: string; characterId?: string };

export type ShotChangeWarning = {
  kind: "continuity" | "dependency" | "duration" | "readiness";
  shotId: string;
  message: string;
  field?: string;
  severity: "info" | "warning" | "error";
};

export type PerformanceWorkspace = {
  schemaVersion: 1;
  pictureId: string;
  approvedScreenplay: ApprovedScreenplayReference;
  scenes: SceneSeed[];
  beats: SceneBeat[];
  performance: Record<string, Record<string, PerformanceDirection>>;
  shotVersions: Record<string, ShotVersionSummary>;
  shots: CanonicalShotSpec[];
  queue: Record<string, ShotPreparationQueueEntry>;
  continuityDecisions: ContinuityDecision[];
  dependencyGraph: DependencyGraph;
  lastUpdated: number;
  updatedAt: number;
};

export type PerformanceAiSuggestionResult =
  | { ok: true; suggestion: Omit<PerformanceDirection, "updatedAt">; source: LocalLLMProvider["id"] }
  | { ok: false; reason: string; source: "manual-only" };

export type BeatDecompositionOptions = {
  fallbackTargetSec?: number;
  maxBeats?: number;
};

export type ShotValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};
