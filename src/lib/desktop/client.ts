import type { ModelCatalog } from "@/lib/studio/model-catalog.ts";
import type {
  CatalogQuery,
  OpenImage,
  ProductionAuthoritySealInput,
  ProductionAuthoritySealResult,
  ProductionAuthorityStatusInput,
  ProductionAuthorityStatusResult,
  PreparedApprovalInput,
  PreparedApprovalResult,
  PreparedGenerationAuthorizationInput,
  PreparedGenerationAuthorizationResult,
  PreparedImageGenerateInput,
  PreparedImageCanonicalApprovalInput,
  PreparedImageCanonicalApprovalResult,
  PreparedImageCanonicalRejectionInput,
  PreparedImageCanonicalRejectionResult,
  SaveManyInput,
  SaveManyResult,
  SaveTextInput,
  SaveTextResult,
  ImportedVideoResult,
  ImportedAudioResult,
  LiteExportInput,
  LiteExportResult,
  PlusExportInput,
  PlusExportResult,
  StillExposeResult,
  SystemStatus,
  DesktopBuildInfo,
} from "./protocol.ts";
import type { ImageComponentManifest } from "@/lib/studio/image-component-resolver.server.ts";

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.premiere316?.isDesktop === true;
}

export async function desktopCatalog(query: CatalogQuery = {}): Promise<ModelCatalog> {
  if (isDesktopApp()) return window.premiere316!.catalog.get(query);
  const { getModelCatalog } = await import("@/lib/studio/model-registry.ts");
  return getModelCatalog({ data: query });
}

export async function desktopUnloadEngine(): Promise<{ ok: true; stopped: boolean }> {
  if (!isDesktopApp()) return { ok: true, stopped: false };
  return window.premiere316!.stills.unload();
}

export async function desktopImageManifests(): Promise<ImageComponentManifest[]> {
  if (!isDesktopApp()) return [];
  return window.premiere316!.image.manifests();
}

export async function desktopSealProductionAuthority(input: ProductionAuthoritySealInput): Promise<ProductionAuthoritySealResult> {
  if (!isDesktopApp()) return { ok: false, error: "Production authority sealing is available only in the packaged desktop application." };
  return window.premiere316!.image.sealAuthority(input);
}

export async function desktopProductionAuthorityStatus(input: ProductionAuthorityStatusInput): Promise<ProductionAuthorityStatusResult> {
  if (!isDesktopApp()) return { ok: false, error: "Production authority status is available only in the packaged desktop application." };
  return window.premiere316!.image.authorityStatus(input);
}

export async function desktopApprovePreparedImage(input: PreparedApprovalInput): Promise<PreparedApprovalResult> {
  if (!isDesktopApp()) return { ok: false, error: "Prepared approval is available only in the packaged desktop application." };
  return window.premiere316!.image.approvePrepared(input);
}

export async function desktopAuthorizePreparedImage(input: PreparedGenerationAuthorizationInput): Promise<PreparedGenerationAuthorizationResult> {
  if (!isDesktopApp()) return { ok: false, error: "Prepared image authorization is available only in the packaged desktop application." };
  return window.premiere316!.image.authorizePrepared(input);
}

export async function desktopGeneratePreparedImage(input: PreparedImageGenerateInput): Promise<StillExposeResult> {
  if (!isDesktopApp()) return { ok: false, error: "Prepared image generation is available only in the packaged desktop application." };
  return window.premiere316!.image.generatePrepared(input);
}

export async function desktopApproveCanonicalImage(input: PreparedImageCanonicalApprovalInput): Promise<PreparedImageCanonicalApprovalResult> {
  if (!isDesktopApp()) return { ok: false, error: "Prepared image canonical approval is available only in the packaged desktop application." };
  return window.premiere316!.image.approveCanonical(input);
}

export async function desktopRejectCanonicalImage(input: PreparedImageCanonicalRejectionInput): Promise<PreparedImageCanonicalRejectionResult> {
  if (!isDesktopApp()) return { ok: false, error: "Prepared image canonical rejection is available only in the packaged desktop application." };
  return window.premiere316!.image.rejectCanonical(input);
}

export async function desktopOpenImages(): Promise<OpenImage[]> {
  if (!isDesktopApp()) return [];
  return window.premiere316!.dialog.openImages();
}

export async function desktopSaveText(input: SaveTextInput): Promise<SaveTextResult> {
  if (!isDesktopApp()) return { canceled: true };
  return window.premiere316!.dialog.saveText(input);
}

export async function desktopSaveMany(input: SaveManyInput): Promise<SaveManyResult> {
  if (!isDesktopApp()) return { canceled: true };
  return window.premiere316!.dialog.saveMany(input);
}

export async function desktopSystemStatus(): Promise<SystemStatus | null> {
  if (!isDesktopApp()) return null;
  return window.premiere316!.app.systemStatus();
}

export async function desktopBuildInfo(): Promise<DesktopBuildInfo | null> {
  if (!isDesktopApp()) return null;
  return window.premiere316!.app.buildInfo();
}

export async function desktopZoomGet(): Promise<number> {
  if (!isDesktopApp()) return 1;
  return window.premiere316!.zoom.get();
}

export async function desktopZoomSet(factor: number): Promise<number> {
  if (!isDesktopApp()) return 1;
  return window.premiere316!.zoom.set(factor);
}

export function desktopZoomSubscribe(callback: (factor: number) => void): () => void {
  if (!isDesktopApp()) return () => {};
  return window.premiere316!.zoom.onChanged(callback);
}

export async function desktopMediaDiscover(): Promise<{ ok: boolean; ffmpeg: string | null; ffprobe: string | null; reason: string }> {
  if (!isDesktopApp()) return { ok: false, ffmpeg: null, ffprobe: null, reason: "FFmpeg discovery is available only in the packaged desktop application." };
  return window.premiere316!.media.discover();
}

export async function desktopImportVideo(): Promise<ImportedVideoResult> {
  if (!isDesktopApp()) return { ok: false, canceled: false, error: "Video import is available only in the packaged desktop application." };
  return window.premiere316!.media.importVideo();
}

export async function desktopImportAudio(): Promise<ImportedAudioResult> {
  if (!isDesktopApp()) return { ok: false, canceled: false, error: "Audio import is available only in the packaged desktop application." };
  return window.premiere316!.media.importAudio();
}

export async function desktopExportLite(input: LiteExportInput): Promise<LiteExportResult> {
  if (!isDesktopApp()) return { ok: false, error: "MP4 export is available only in the packaged desktop application." };
  return window.premiere316!.media.exportLite(input);
}

export async function desktopExportPlus(input: PlusExportInput): Promise<PlusExportResult> {
  if (!isDesktopApp()) return { ok: false, error: "30-second film export is available only in the packaged desktop application." };
  return window.premiere316!.media.exportPlus(input);
}

export async function desktopOpenExportFolder(): Promise<{ ok: boolean; folder: string; error: string | null; lastExportPath: string | null }> {
  if (!isDesktopApp()) return { ok: false, folder: "", error: "Open folder is available only in the packaged desktop application.", lastExportPath: null };
  return window.premiere316!.media.openFolder();
}
