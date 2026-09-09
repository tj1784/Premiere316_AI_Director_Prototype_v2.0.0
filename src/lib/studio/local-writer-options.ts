import type { LocalLLMProviderDiscovery } from "./local-llm-provider.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

export type LocalWriterOption = { id: string; displayName: string; loaded: boolean };
export type LocalWriterStatus = { provider: LocalLLMProviderDiscovery; models: ScreenplayModelRef[] };

/** Only the provider's listed IDs are valid load keys. Catalog paths are display metadata. */
export function localWriterOptions(status: LocalWriterStatus | null | undefined): LocalWriterOption[] {
  if (!status?.provider.available) return [];
  const metadata = new Map(status.models.filter((model) => model.servedModelId).map((model) => [model.servedModelId, model]));
  const options = new Map<string, LocalWriterOption>();
  for (const model of status.provider.models) {
    if (model.type !== "llm" || !model.id.trim()) continue;
    const previous = options.get(model.id);
    const exact = metadata.get(model.id);
    const displayName = exact?.displayName.trim() || model.displayName.trim() || model.id;
    if (!previous || model.loaded && !previous.loaded) options.set(model.id, { id: model.id, displayName, loaded: model.loaded });
  }
  return [...options.values()].sort((left, right) => Number(right.loaded) - Number(left.loaded) || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
}
