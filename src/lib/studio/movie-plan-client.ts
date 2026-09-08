import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { localLLMStatus } from "./screenplay-client.ts";
import { moviePlanGenerate, releaseMoviePlanModel } from "./movie-plan-api.ts";

export async function releaseMoviePlanWriterForImages(servedModelId: string) {
  return releaseMoviePlanModel({ data: { servedModelId, endpoint: endpointCache.get() } });
}
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  executeMoviePlan,
  executeResearchDraft,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import { explicitMoviePlanServedId, selectMoviePlanModel } from "./movie-plan-model.ts";
import type { Picture } from "./types.ts";
import type { InternalPhase } from "./product-flow.ts";
import { readMoviePlanStream, type MoviePlanProgress } from "./movie-plan-stream.ts";

const endpointCache = new BrowserEndpointCache();

async function runtimeFromStatus(picture: Picture, onProgress?: (event: MoviePlanProgress) => void): Promise<MoviePlanRuntime> {
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
    generate: async ({ stepId, system, prompt, sceneCount, runtimeSeconds }) => {
      let text = "";
      const progress = (status: MoviePlanProgress["status"], message?: string) => onProgress?.({ phase: stepId, model: selected.servedModelId, status, text, message });
      progress("generating");
      try {
      const response = await moviePlanGenerate({
        data: {
          endpoint: endpointCache.get(),
          stepId,
          system,
          prompt,
          servedModelId: selected.servedModelId,
          thinkingEnabled: picture.productFlow?.thinkingEnabled === true,
          sceneCount,
          runtimeSeconds,
        },
      });
      const result = await readMoviePlanStream(response, (partial) => { text = partial; progress("generating"); });
      progress("completed");
      return { text: result.text };
      } catch (error) {
        progress("failed", error instanceof Error ? error.message : "Local generation failed.");
        throw error;
      }
    },
  };
}

export async function executeMoviePlanOnServer(picture: Picture, onProgress?: (event: MoviePlanProgress) => void) {
  return executeMoviePlan(picture, { runtime: await runtimeFromStatus(picture, onProgress) });
}

export async function executeResearchDraftOnServer(picture: Picture) {
  return executeResearchDraft(picture, { runtime: await runtimeFromStatus(picture) });
}

export type { InternalPhase };
