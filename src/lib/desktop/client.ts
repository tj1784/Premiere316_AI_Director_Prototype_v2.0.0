import type { ModelCatalog } from "@/lib/studio/model-catalog.ts";
import type {
  CatalogQuery,
  EngineBenchmarkInput,
  EngineRuntimeCheckInput,
  EngineRuntimeCheckResult,
  EngineWakeResult,
  OpenImage,
  SaveManyInput,
  SaveManyResult,
  SaveTextInput,
  SaveTextResult,
  StillExposeInput,
  StillExposeResult,
  SystemStatus,
  DesktopBuildInfo,
} from "./protocol.ts";
import type { AdapterBenchmark } from "@/lib/studio/engine-adapter.ts";

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.premiere316?.isDesktop === true;
}

export async function desktopCatalog(query: CatalogQuery = {}): Promise<ModelCatalog> {
  if (isDesktopApp()) return window.premiere316!.catalog.get(query);
  const { getModelCatalog } = await import("@/lib/studio/model-registry.ts");
  return getModelCatalog({ data: query });
}

export async function desktopWakeEngine(): Promise<EngineWakeResult> {
  if (isDesktopApp()) return window.premiere316!.stills.wake();
  const { wakeLocalEngine } = await import("@/lib/ai/director.ts");
  return wakeLocalEngine();
}

export async function desktopExposeStill(input: StillExposeInput): Promise<StillExposeResult> {
  if (isDesktopApp()) return window.premiere316!.stills.expose(input);
  const { generateStill } = await import("@/lib/ai/director.ts");
  return generateStill({ data: input });
}

export async function desktopUnloadEngine(): Promise<{ ok: true; stopped: boolean }> {
  if (!isDesktopApp()) return { ok: true, stopped: false };
  return window.premiere316!.stills.unload();
}

export async function desktopBenchmarkEngine(input: EngineBenchmarkInput): Promise<AdapterBenchmark> {
  if (isDesktopApp()) return window.premiere316!.stills.benchmark(input);
  throw new Error("Native engine calibration is available in the standalone desktop application.");
}

export async function desktopInspectEngine(input: EngineRuntimeCheckInput): Promise<EngineRuntimeCheckResult> {
  if (!isDesktopApp()) {
    return { ok: false, error: "Native engine inspection is available only in the standalone desktop application." };
  }
  return window.premiere316!.stills.inspect(input);
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
