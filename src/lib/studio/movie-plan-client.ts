import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { localLLMStatus } from "./screenplay-client.ts";
import { moviePlanGenerate } from "./movie-plan-api.ts";
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  executeMoviePlan,
  executeResearchDraft,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import type { Picture } from "./types.ts";
import type { InternalPhase } from "./product-flow.ts";

const endpointCache = new BrowserEndpointCache();

async function runtimeFromStatus(): Promise<MoviePlanRuntime> {
  const status = await localLLMStatus();
  if (status.provider.endpoint) endpointCache.set(status.provider.endpoint);
  const ready = status.models.filter((model) => model.status === "ready");
  const model = ready.find((item) => /llama/i.test(item.servedModelId || item.id)) ?? ready[0] ?? null;
  if (!status.provider.available || !model) {
    return {
      available: false,
      reason: status.provider.available && !model
        ? "Configured AI model unavailable. Start LM Studio Local API Server and serve a model, then Rescan."
        : (status.provider.reason || CONFIGURED_MODEL_UNAVAILABLE),
      servedModelId: null,
      generate: null,
    };
  }
  return {
    available: true,
    reason: "",
    servedModelId: model.servedModelId || model.id,
    displayName: model.displayName,
    generate: async ({ stepId, system, prompt }) => {
      const result = await moviePlanGenerate({
        data: {
          endpoint: endpointCache.get(),
          stepId,
          system,
          prompt,
          servedModelId: model.servedModelId || model.id,
        },
      });
      return { text: result.text };
    },
  };
}

export async function executeMoviePlanOnServer(picture: Picture) {
  return executeMoviePlan(picture, { runtime: await runtimeFromStatus() });
}

export async function executeResearchDraftOnServer(picture: Picture) {
  return executeResearchDraft(picture, { runtime: await runtimeFromStatus() });
}

export type { InternalPhase };
