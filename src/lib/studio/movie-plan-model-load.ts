import type { LocalLLMProviderDiscovery } from "./local-llm-provider.ts";
import { requireMoviePlanModelId } from "./movie-plan-model.ts";

/** A load is successful only when native discovery confirms this exact writer. */
export async function ensureExactMoviePlanModel(input: {
  servedModelId: string;
  discover: () => Promise<LocalLLMProviderDiscovery>;
  loadInstalled: (modelId: string) => Promise<void>;
}): Promise<{ loaded: true; servedModelId: string }> {
  const servedModelId = requireMoviePlanModelId(input.servedModelId);
  const discovery = await input.discover();
  if (!discovery.available) throw new Error(discovery.reason || "The local writer server is unavailable. No substitute is used.");
  const installed = discovery.models.filter((model) => model.id === servedModelId && model.type === "llm");
  if (installed.length !== 1) throw new Error(`The selected local writer ${servedModelId} is not uniquely installed in LM Studio. No substitute is used.`);
  if (!installed[0].loaded) {
    await input.loadInstalled(servedModelId);
    const after = await input.discover();
    const loaded = after.models.filter((model) => model.id === servedModelId && model.type === "llm" && model.loaded);
    if (!after.available || loaded.length !== 1) throw new Error(`Loading the selected local writer ${servedModelId} was not verified. No substitute is used.`);
  }
  return { loaded: true, servedModelId };
}
