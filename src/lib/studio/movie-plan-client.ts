import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { localLLMStatus } from "./screenplay-client.ts";
import { moviePlanGenerate } from "./movie-plan-api.ts";
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  executeMoviePlan,
  executeResearchDraft,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import { explicitMoviePlanServedId, selectMoviePlanModel } from "./movie-plan-model.ts";
import type { Picture } from "./types.ts";
import type { InternalPhase } from "./product-flow.ts";

const endpointCache = new BrowserEndpointCache();

async function runtimeFromStatus(picture: Picture): Promise<MoviePlanRuntime> {
  const status = await localLLMStatus();
  if (status.provider.endpoint) endpointCache.set(status.provider.endpoint);
  const ready = status.models.filter((model) => model.status === "ready");
  const selected = selectMoviePlanModel(ready, {
    providerAvailable: Boolean(status.provider.available),
    providerReason: status.provider.reason,
    explicitServedId: explicitMoviePlanServedId(picture),
  });
  if (!selected.allowed) {
    return {
      available: false,
      reason: selected.reason || CONFIGURED_MODEL_UNAVAILABLE,
      servedModelId: null,
      generate: null,
    };
  }
  return {
    available: true,
    reason: "",
    servedModelId: selected.servedModelId,
    displayName: selected.displayName,
    generate: async ({ stepId, system, prompt }) => {
      const result = await moviePlanGenerate({
        data: {
          endpoint: endpointCache.get(),
          stepId,
          system,
          prompt,
          servedModelId: selected.servedModelId,
        },
      });
      return { text: result.text };
    },
  };
}

export async function executeMoviePlanOnServer(picture: Picture) {
  return executeMoviePlan(picture, { runtime: await runtimeFromStatus(picture) });
}

export async function executeResearchDraftOnServer(picture: Picture) {
  return executeResearchDraft(picture, { runtime: await runtimeFromStatus(picture) });
}

export type { InternalPhase };
