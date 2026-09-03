import { formatBytes, modelRelativePath, UNKNOWN, type LogicalModel, type ModelCatalog } from "./model-catalog.ts";
import type { LocalLLMProviderDiscovery, LocalLLMServedModel } from "./local-llm-provider.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/").replace(/\.gguf$/, "").replace(/[^a-z0-9]+/g, "");
}

function primaryTextWeight(model: LogicalModel) {
  return model.components.find((component) => component.role === "standalone" && !/mmproj|lora|support|draft|mtp/i.test(component.path));
}

function matchCatalogModel(served: LocalLLMServedModel, catalog: ModelCatalog): LogicalModel | null {
  const candidates = [served.id, served.path ?? "", served.displayName].map(normalizeIdentity).filter(Boolean);
  let best: { score: number; model: LogicalModel } | null = null;
  for (const model of catalog.models) {
    if (model.modality !== "LLM" && model.modality !== "VLM") continue;
    const weight = primaryTextWeight(model);
    const identities = [model.id, model.path, model.displayName, weight?.path ?? ""].map(normalizeIdentity).filter(Boolean);
    let score = 0;
    for (const left of candidates) for (const right of identities) {
      if (left === right) score = Math.max(score, 100);
      else if (left.length > 12 && right.length > 12 && (left.includes(right) || right.includes(left))) score = Math.max(score, Math.min(left.length, right.length));
    }
    if (!best || score > best.score) best = { score, model };
  }
  return best && best.score >= 12 ? best.model : null;
}

function fromServedModel(served: LocalLLMServedModel, catalog: ModelCatalog): ScreenplayModelRef {
  const local = matchCatalogModel(served, catalog);
  const weight = local ? primaryTextWeight(local) : null;
  return {
    id: `lmstudio:${served.id}`,
    servedModelId: served.id,
    localCatalogModelId: local?.id ?? null,
    displayName: served.displayName,
    checkpoint: local
      ? modelRelativePath(weight?.path ?? local.path)
      : served.path
        ? modelRelativePath(served.path)
        : `LM Studio served model · ${served.id}`,
    precision: local?.precision ?? served.precision ?? UNKNOWN,
    quantization: local?.quantization ?? served.quantization ?? UNKNOWN,
    contextLength: served.contextLength ?? (local?.contextLength === UNKNOWN || !local ? null : local.contextLength),
    sizeBytes: local ? weight?.sizeBytes ?? local.sizeBytes : served.sizeBytes ?? 0,
    runtimeAdapter: "LM Studio",
    status: "ready",
    statusReason: local
      ? "Ready · loaded in LM Studio and matched to the local model registry."
      : "Ready · loaded and served by the local LM Studio runtime; catalog path was not exposed by the API.",
    loadVerifiedAt: Date.now(),
  };
}

export function screenplayModelsFromProvider(catalog: ModelCatalog, provider: LocalLLMProviderDiscovery): ScreenplayModelRef[] {
  const ready = provider.available
    ? provider.models.filter((model) => model.loaded && model.type === "llm").map((model) => fromServedModel(model, catalog))
    : [];
  const servedCatalogIds = new Set(ready.map((model) => model.localCatalogModelId).filter(Boolean));
  const unavailable: ScreenplayModelRef[] = catalog.models
    .filter((model) => model.modality === "LLM" && model.role === "standalone" && !servedCatalogIds.has(model.id))
    .map((model) => {
      const weight = primaryTextWeight(model);
      return {
        id: `catalog:${model.id}`,
        servedModelId: "",
        localCatalogModelId: model.id,
        displayName: model.displayName,
        checkpoint: modelRelativePath(weight?.path ?? model.path),
        precision: model.precision,
        quantization: model.quantization,
        contextLength: model.contextLength === UNKNOWN ? null : model.contextLength,
        sizeBytes: weight?.sizeBytes ?? model.sizeBytes,
        runtimeAdapter: "LM Studio",
        status: "unavailable",
        statusReason: provider.available ? "Installed locally, but not loaded and served by LM Studio." : provider.reason,
      };
    });
  return [...ready, ...unavailable].sort((a, b) => {
    if (a.status !== b.status) return a.status === "ready" ? -1 : 1;
    return a.sizeBytes - b.sizeBytes || a.displayName.localeCompare(b.displayName);
  });
}

export function screenplayModelDetail(model: ScreenplayModelRef): string {
  const context = model.contextLength ? `${Math.round(model.contextLength / 1024)}K context` : "context unknown";
  const size = model.sizeBytes ? formatBytes(model.sizeBytes) : "size not exposed";
  return `${model.quantization || model.precision} · ${size} · ${context} · ${model.runtimeAdapter}`;
}
