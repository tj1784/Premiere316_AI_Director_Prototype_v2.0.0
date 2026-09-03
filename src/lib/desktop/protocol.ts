import type { ModelCatalog } from "@/lib/studio/model-catalog.ts";
import type { NativeGenerationValues } from "@/lib/studio/engine-controls.ts";
import type { GenerationProvenance } from "@/lib/studio/generation-provenance.ts";
import type { AdapterBenchmark } from "@/lib/studio/engine-adapter.ts";

export type CatalogQuery = {
  force?: boolean;
  deep?: boolean;
};

export type StillExposeInput = {
  prompt: string;
  engineId: string;
  engineName: string;
  references: string[];
  selectedBasePath: string;
  values: NativeGenerationValues;
};

export type StillExposeResult = { ok: true; url: string; provenance: GenerationProvenance } | { ok: false; error: string };

export type EngineBenchmarkInput = Pick<StillExposeInput, "engineId" | "engineName" | "selectedBasePath" | "values">;
export type EngineRuntimeCheckInput = Pick<StillExposeInput, "engineId" | "engineName" | "selectedBasePath">;
export type EngineRuntimeCheckResult = { ok: true; modelName: string } | { ok: false; error: string };

export type EngineWakeResult = { ok: true } | { ok: false; error: string };

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

/** Typed desktop bridge. No filesystem, spawn, or model-root mutation. */
export type Premiere316Desktop = {
  isDesktop: true;
  catalog: {
    get: (query?: CatalogQuery) => Promise<ModelCatalog>;
  };
  stills: {
    expose: (input: StillExposeInput) => Promise<StillExposeResult>;
    wake: () => Promise<EngineWakeResult>;
    unload: () => Promise<{ ok: true; stopped: boolean }>;
    benchmark: (input: EngineBenchmarkInput) => Promise<AdapterBenchmark>;
    inspect: (input: EngineRuntimeCheckInput) => Promise<EngineRuntimeCheckResult>;
  };
  dialog: {
    openImages: () => Promise<OpenImage[]>;
    openFolder: () => Promise<FolderPickResult>;
    saveText: (input: SaveTextInput) => Promise<SaveTextResult>;
    saveMany: (input: SaveManyInput) => Promise<SaveManyResult>;
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
  catalogGet: "p316:catalog:get",
  stillsExpose: "p316:stills:expose",
  stillsWake: "p316:stills:wake",
  enginesStop: "p316:engines:stop",
  enginesBenchmark: "p316:engines:benchmark",
  enginesInspect: "p316:engines:inspect",
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
  appModelRoot: "p316:app:modelRoot",
  appSystemStatus: "p316:app:systemStatus",
  zoomGet: "p316:zoom:get",
  zoomSet: "p316:zoom:set",
  zoomChanged: "p316:zoom:changed",
} as const;
