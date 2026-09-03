export const UNKNOWN = "UNKNOWN";

export const MODEL_ROOT = "D:\\AI\\Models";

export type Modality =
  | "LLM"
  | "VLM"
  | "image"
  | "video"
  | "TTS"
  | "music"
  | "audio"
  | "VAE"
  | "text encoder"
  | "vision encoder"
  | "tokenizer"
  | "LoRA"
  | "control/adapter"
  | "support component";

export type ModelRole =
  | "standalone"
  | "transformer"
  | "text_encoder"
  | "vae"
  | "audio_vae"
  | "vision_encoder"
  | "projector"
  | "tokenizer"
  | "lora"
  | "control"
  | "upscaler"
  | "support"
  | "unknown";

export type Precision =
  | "BF16"
  | "FP16"
  | "FP8"
  | "Q8"
  | "Q6"
  | "Q5"
  | "Q4"
  | "Q3"
  | "Q2"
  | "GGUF variant"
  | typeof UNKNOWN;

export type ModelStatus =
  | "Installed"
  | "Component"
  | "Missing dependency"
  | "Unknown"
  | "Ready"
  | "Loaded"
  | "Loading"
  | "RAM warm"
  | "VRAM resident"
  | "Unsupported"
  | "Needs mapping";

export type EvidenceSource =
  | "model config/header"
  | "model_index"
  | "architecture metadata"
  | "tokenizer/config"
  | "directory structure"
  | "local README/model card"
  | "filename";

export type ValidationConfidence = "high" | "medium" | "low";

export type ModelComponent = {
  id: string;
  displayName: string;
  role: ModelRole;
  modality: Modality | typeof UNKNOWN;
  path: string;
  paths: string[];
  sizeBytes: number;
  precision: Precision;
  quantization: string;
  parameterCount: number | typeof UNKNOWN;
  modifiedAt: number;
  evidence: EvidenceSource[];
  confidence: ValidationConfidence;
  sha256?: string;
  sha256Kind?: "full" | "sampled";
};

export type LogicalModel = {
  id: string;
  displayName: string;
  family: string;
  modality: Modality | typeof UNKNOWN;
  role: ModelRole;
  status: ModelStatus;
  independentlyUsable: boolean;
  baseModel: string;
  parameterCount: number | typeof UNKNOWN;
  activeParameterCount: number | typeof UNKNOWN;
  precision: Precision;
  quantization: string;
  sizeBytes: number;
  folderSizeBytes: number;
  modifiedAt: number;
  path: string;
  requiredComponents: string[];
  discoveredSiblings: string[];
  textEncoder?: string;
  vae?: string;
  audioVae?: string;
  projector?: string;
  tokenizer?: string;
  compatibleLoraFamily: string;
  runtimeBackend: string;
  contextLength: number | typeof UNKNOWN;
  license: string;
  sourceMetadata: string;
  confidence: ValidationConfidence;
  components: ModelComponent[];
};

export type CatalogStats = {
  foldersScanned: number;
  filesInspected: number;
  logicalModels: number;
  standaloneModels: number;
  componentModels: number;
  loras: number;
  unknownUnmapped: number;
  totalBytes: number;
  scanDurationMs: number;
  cacheHits: number;
  cacheMisses: number;
  root: string;
  scannedAt: number;
  deepVerify?: boolean;
};

export type ModelCatalog = {
  stats: CatalogStats;
  models: LogicalModel[];
  unmapped: ModelComponent[];
  error?: string;
};

export function modelRelativePath(value: string): string {
  const normalized = String(value || "").replace(/\//g, "\\");
  const root = MODEL_ROOT.replace(/\//g, "\\");
  if (normalized.toLowerCase().startsWith(root.toLowerCase())) {
    return normalized.slice(root.length).replace(/^\\+/, "");
  }
  return value;
}

function sanitizedComponent(component: ModelComponent): ModelComponent {
  return {
    ...component,
    path: modelRelativePath(component.path),
    paths: component.paths.map(modelRelativePath),
  };
}

/** Remove absolute model-root paths before a catalog crosses into a renderer. */
export function sanitizeModelCatalog(catalog: ModelCatalog): ModelCatalog {
  const optionalPath = (value: string | undefined) => value ? modelRelativePath(value) : undefined;
  return {
    ...catalog,
    stats: { ...catalog.stats, root: MODEL_ROOT },
    models: catalog.models.map((model) => ({
      ...model,
      path: modelRelativePath(model.path),
      textEncoder: optionalPath(model.textEncoder),
      vae: optionalPath(model.vae),
      audioVae: optionalPath(model.audioVae),
      projector: optionalPath(model.projector),
      tokenizer: optionalPath(model.tokenizer),
      components: model.components.map(sanitizedComponent),
    })),
    unmapped: catalog.unmapped.map(sanitizedComponent),
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = n >= 100 ? 0 : 1;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export function formatParamCount(n: number | typeof UNKNOWN): string {
  if (n === UNKNOWN || !Number.isFinite(n) || n <= 0) return UNKNOWN;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 100e6 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

export function modalitySummary(model: LogicalModel): string {
  const bits: string[] = [];
  if (model.modality !== UNKNOWN) bits.push(model.modality);
  if (model.audioVae) bits.push("native audio");
  const loraCount = model.components.filter((c) => c.role === "lora").length;
  if (loraCount > 0) bits.push(`${loraCount} LoRA${loraCount === 1 ? "" : "s"}`);
  return bits.join(" + ") || UNKNOWN;
}
