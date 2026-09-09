import type { ModelCatalog } from "@/lib/studio/model-catalog.ts";
import type { NativeGenerationValues } from "@/lib/studio/engine-controls.ts";
import type { GenerationProvenance } from "@/lib/studio/generation-provenance.ts";
import type { ImageComponentManifest } from "@/lib/studio/image-component-resolver.server.ts";
import type { ProductionBreakdown } from "@/lib/production/types.ts";

export type CatalogQuery = {
  force?: boolean;
  deep?: boolean;
};

export type PreparedImageOutputProof = {
  mediaUri: string;
  mediaSha256: string;
  sidecarSha256: string;
  width: number;
  height: number;
  byteLength: number;
  mediaBytes: number[];
  sidecarBytes: number[];
  receiptId?: string;
};

export type ProductionAuthoritySealInput = {
  pictureId: string;
  rawCanonical: ProductionBreakdown;
};

export type ProductionAuthoritySealResult = { ok: true; authorityId: string; digest: string; createdAt: number; summary?: unknown } | { ok: false; error: string };

export type ProductionAuthorityStatusInput = { pictureId: string };

export type ProductionAuthorityStatusResult = { ok: true; status: "CURRENT" | "NO_AUTHORITY" | "INVALID"; authorityId: string | null; digest: string | null; createdAt: number | null; summary?: unknown; preparedApprovals?: Array<{ rootId: string; digest: string; preparedAssetId: string; assetId: string; authorityId: string; authorityDigest: string; approvedAt: number }>; canonicalHistory?: unknown[] } | { ok: false; error: string };

export type PreparedApprovalInput = {
  authorityId: string;
  preparedAssetId: string;
};

export type PreparedApprovalResult = { ok: true; rootId: string; approvedAt: number; digest: string } | { ok: false; error: string };

export type PreparedGenerationAuthorizationInput = {
  authorityId: string;
  preparedAssetId: string;
  preparedApprovalRootId: string;
  engineId: string;
  engineName: string;
  values: NativeGenerationValues;
};

export type PreparedGenerationAuthorizationResult =
  | { ok: true; token: string; expiresAt: number; manifest: ImageComponentManifest }
  | { ok: false; error: string; manifest?: ImageComponentManifest };

export type PreparedImageGenerateInput = {
  token: string;
};

export type PreparedImageCanonicalApprovalInput = {
  authorityId: string;
  preparedApprovalRootId: string;
  receiptId: string;
  reason: string;
  iterationId: string;
  findings: { id: string; confirmed: boolean }[];
};

export type PreparedImageCanonicalApprovalResult = { ok: true; decisionId: string; proof: import("@/lib/production/types.ts").BackendCanonicalProof; output: PreparedImageOutputProof } | { ok: false; error: string };

export type PreparedImageCanonicalRejectionInput = Omit<PreparedImageCanonicalApprovalInput, "findings">;
export type PreparedImageCanonicalRejectionResult = { ok: true; decisionId: string; decision: unknown } | { ok: false; error: string };

export type StillExposeResult =
  | { ok: true; url: string; provenance: GenerationProvenance; output: PreparedImageOutputProof; receiptId?: string; receiptDigest?: string; iterationId?: string; continuityFindings?: import("@/lib/production/types.ts").IterationContinuityFinding[] }
  | { ok: false; error: string; manifest?: ImageComponentManifest };

export type ImageGenerationProgress = { pictureId: string; assetId: string; preparedAssetId: string; message: string; at: number };
export type EncodeAssetDraftPromptsInput = { pictureId: string; authorityId: string; engineId: string; prompts: Array<{ preparedAssetId: string; preparedApprovalRootId: string; prompt: string; values: NativeGenerationValues }> };
export type EncodeAssetDraftPromptsResult = { ok: true; promptCount: number; cachedPromptCount: number; encoderReleased: true; textEncoderDevice: "cuda"; encodeMs: number } | { ok: false; error: string };
export type RecoverAssetDraftsInput = { pictureId: string; authorityId: string; rawCanonical: ProductionBreakdown; requests: Array<{ preparedAssetId: string; preparedApprovalRootId: string; engineId: string; prompt: string; referenceUris: string[]; knownIterationIds: string[] }> };
export type RecoverAssetDraftsResult = { ok: true; results: Array<Extract<StillExposeResult, { ok: true }> & { preparedAssetId: string; iterationId: string }>; authority?: { authorityId: string; digest: string; createdAt: number }; approvals?: Array<{ preparedAssetId: string; rootId: string; digest: string; approvedAt: number }> } | { ok: false; error: string };

export type OpenImage = {
  name: string;
  mime: string;
  dataUrl: string;
};

export type SaveTextInput = {
  defaultName: string;
  contents: string;
  mime?: string;
};

export type SaveTextResult = { canceled: true } | { canceled: false; name: string };

export type SaveManyInput = {
  files: { filename: string; contents: string }[];
};

export type SaveManyResult = { canceled: true } | { canceled: false; count: number; folderLabel: string };

export type FolderPickResult = { canceled: true } | { canceled: false; label: string };

export type ImportedVideoProbe = {
  ok: boolean;
  durationSec: number | null;
  fps: number | null;
  frameCount: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  container: string | null;
  hasAudio: boolean;
  byteLength: number;
  error: string | null;
};

export type ImportedVideoResult =
  | { ok: true; canceled: false; origin: "imported"; filename: string; mediaUri: string; mediaSha256: string; byteLength: number; probe: ImportedVideoProbe }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

export type LiteExportInput = {
  mediaUri: string;
  mediaSha256: string;
  durationSec: number;
  fps: number;
  hasAudio: boolean;
};

export type LiteExportResult =
  | { ok: true; origin: "imported"; outputPath: string; outputDir: string; sha256: string; byteLength: number; probe: ImportedVideoProbe; sourceSha256: string; ffmpeg: string; ffprobe: string }
  | { ok: false; error: string };

export type ImportedAudioProbe = {
  ok: boolean;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  container: string | null;
  byteLength: number;
  error: string | null;
};

export type ImportedAudioResult =
  | { ok: true; canceled: false; origin: "imported"; filename: string; mediaUri: string; mediaSha256: string; byteLength: number; probe: ImportedAudioProbe }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

export type PlusExportClip = { mediaUri: string; mediaSha256: string; durationSec: number; shotId?: string };

export type PlusExportInput = {
  videos: PlusExportClip[];
  audioUri: string;
  audioSha256: string;
  fps: number;
};

export type PlusExportResult =
  | { ok: true; origin: "imported"; kind: "m1-plus"; outputPath: string; outputDir: string; sha256: string; byteLength: number; probe: ImportedVideoProbe; durationSec: number; sourceVideos: PlusExportClip[]; sourceAudioSha256: string; ffmpeg: string; ffprobe: string }
  | { ok: false; error: string };

export type SystemStatus = {
  sampledAt: number;
  cpu: {
    utilizationPercent: number;
    logicalCores: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
  };
  gpu: {
    available: boolean;
    name?: string;
    utilizationPercent?: number;
    memoryUsedBytes?: number;
    memoryTotalBytes?: number;
    temperatureC?: number;
    powerWatts?: number;
  };
};

export type DesktopBuildInfo = {
  schemaVersion: 1;
  appVersion: string;
  buildId: string;
  buildTimestamp: string;
  rendererSourceHash: string;
  rendererMode: "DEV SERVER" | "PACKAGED DIST";
  executablePath: string;
  appPath: string;
};

/** Typed desktop bridge. No filesystem, spawn, model-root, free wake, free expose, or benchmark primitive. */
export type Premiere316Desktop = {
  isDesktop: true;
  film: {
    start: (input: import("../studio/native-film.ts").NativeFilmRequest) => Promise<import("../studio/native-film.ts").NativeFilmStatus>;
    status: (jobId: string) => Promise<import("../studio/native-film.ts").NativeFilmStatus>;
    stop: () => Promise<{ ok: boolean }>;
  };
  catalog: {
    get: (query?: CatalogQuery) => Promise<ModelCatalog>;
  };
  stills: {
    unload: () => Promise<{ ok: true; stopped: boolean }>;
  };
  image: {
    searchReferences: (query: string) => Promise<Array<{ title: string; sourceUrl: string; imageUrl: string; description: string }>>;
    importWebReference: (input: { imageUrl: string; sourceUrl: string }) => Promise<{ uri: string; sha256: string; sourceUrl: string; imageUrl: string }>;
    prepareDrafts: (input: ProductionAuthoritySealInput) => Promise<{ ok: true; authority: Extract<ProductionAuthoritySealResult, { ok: true }>; approvals: Array<Extract<PreparedApprovalResult, { ok: true }> & { preparedAssetId: string }> } | { ok: false; error: string }>;
    generateDraft: (input: PreparedGenerationAuthorizationInput & { promptOverride?: string }) => Promise<StillExposeResult>;
    recoverDrafts: (input: RecoverAssetDraftsInput) => Promise<RecoverAssetDraftsResult>;
    encodeDraftPrompts: (input: EncodeAssetDraftPromptsInput) => Promise<EncodeAssetDraftPromptsResult>;
    onProgress: (callback: (progress: ImageGenerationProgress) => void) => () => void;
    manifests: () => Promise<ImageComponentManifest[]>;
    sealAuthority: (input: ProductionAuthoritySealInput) => Promise<ProductionAuthoritySealResult>;
    authorityStatus: (input: ProductionAuthorityStatusInput) => Promise<ProductionAuthorityStatusResult>;
    approvePrepared: (input: PreparedApprovalInput) => Promise<PreparedApprovalResult>;
    authorizePrepared: (input: PreparedGenerationAuthorizationInput) => Promise<PreparedGenerationAuthorizationResult>;
    generatePrepared: (input: PreparedImageGenerateInput) => Promise<StillExposeResult>;
    approveCanonical: (input: PreparedImageCanonicalApprovalInput) => Promise<PreparedImageCanonicalApprovalResult>;
    rejectCanonical: (input: PreparedImageCanonicalRejectionInput) => Promise<PreparedImageCanonicalRejectionResult>;
  };
  dialog: {
    openImages: () => Promise<OpenImage[]>;
    openFolder: () => Promise<FolderPickResult>;
    saveText: (input: SaveTextInput) => Promise<SaveTextResult>;
    saveMany: (input: SaveManyInput) => Promise<SaveManyResult>;
  };
  media: {
    discover: () => Promise<{ ok: boolean; ffmpeg: string | null; ffprobe: string | null; reason: string }>;
    importVideo: () => Promise<ImportedVideoResult>;
    importAudio: () => Promise<ImportedAudioResult>;
    exportLite: (input: LiteExportInput) => Promise<LiteExportResult>;
    exportPlus: (input: PlusExportInput) => Promise<PlusExportResult>;
    openFolder: () => Promise<{ ok: boolean; folder: string; error: string | null; lastExportPath: string | null }>;
  };
  files: {
    fromDrop: (file: File) => Promise<OpenImage | null>;
  };
  credentials: {
    get: (name: string) => Promise<string | null>;
    set: (name: string, value: string) => Promise<void>;
    delete: (name: string) => Promise<void>;
  };
  app: {
    version: () => Promise<string>;
    buildInfo: () => Promise<DesktopBuildInfo>;
    platform: string;
    modelRootLabel: () => Promise<string>;
    systemStatus: () => Promise<SystemStatus>;
  };
  zoom: {
    get: () => Promise<number>;
    set: (factor: number) => Promise<number>;
    onChanged: (callback: (factor: number) => void) => () => void;
  };
};

declare global {
  interface Window {
    premiere316?: Premiere316Desktop;
  }
}

export const DESKTOP_CHANNELS = {
  filmStart: "p316:film:start",
  filmStatus: "p316:film:status",
  filmStop: "p316:film:stop",
  catalogGet: "p316:catalog:get",
  enginesStop: "p316:engines:stop",
  dialogOpenImages: "p316:dialog:openImages",
  dialogOpenFolder: "p316:dialog:openFolder",
  dialogSaveText: "p316:dialog:saveText",
  dialogSaveMany: "p316:dialog:saveMany",
  filesReadImage: "p316:files:readImage",
  credentialsGet: "p316:credentials:get",
  credentialsSet: "p316:credentials:set",
  credentialsDelete: "p316:credentials:delete",
  appVersion: "p316:app:version",
  appBuildInfo: "p316:app:buildInfo",
  imageManifests: "p316:image:manifests",
  imageSearchReferences: "p316:image:searchReferences",
  imageImportWebReference: "p316:image:importWebReference",
  imagePrepareDrafts: "p316:image:prepareDrafts",
  imageGenerateDraft: "p316:image:generateDraft",
  imageRecoverDrafts: "p316:image:recoverDrafts",
  imageEncodeDraftPrompts: "p316:image:encodeDraftPrompts",
  imageProgress: "p316:image:progress",
  imageSealAuthority: "p316:image:sealAuthority",
  imageAuthorityStatus: "p316:image:authorityStatus",
  imageAuthorizePrepared: "p316:image:authorizePrepared",
  imageApprovePrepared: "p316:image:approvePrepared",
  imageGeneratePrepared: "p316:image:generatePrepared",
  imageApproveCanonical: "p316:image:approveCanonical",
  imageRejectCanonical: "p316:image:rejectCanonical",
  appModelRoot: "p316:app:modelRoot",
  appSystemStatus: "p316:app:systemStatus",
  zoomGet: "p316:zoom:get",
  zoomSet: "p316:zoom:set",
  zoomChanged: "p316:zoom:changed",
  mediaDiscover: "p316:media:discover",
  mediaImportVideo: "p316:media:importVideo",
  mediaImportAudio: "p316:media:importAudio",
  mediaExportLite: "p316:media:exportLite",
  mediaExportPlus: "p316:media:exportPlus",
  mediaOpenFolder: "p316:media:openFolder",
} as const;
