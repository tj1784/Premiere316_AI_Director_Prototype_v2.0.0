import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_SCREENPLAY_SETTINGS } from "./screenplay.ts";
import { normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import { CONFIGURED_MODEL_UNAVAILABLE } from "./movie-plan-pipeline.ts";
import { moviePlanStreamResponse } from "./movie-plan-stream.ts";
import { moviePlanResponseFormat } from "./movie-plan-schema.ts";

type GenerateInput = { endpoint?: string | null; stepId: string; system: string; prompt: string; servedModelId: string; thinkingEnabled?: boolean; sceneCount?: number; runtimeSeconds?: number };

export const releaseMoviePlanModel = createServerFn({ method: "POST" })
  .validator((input: { servedModelId: string; endpoint?: string | null }) => input)
  .handler(async ({ data }) => {
    const key = endpointKey(data.endpoint);
    const { createLMStudioProvider } = await import("./lmstudio-provider.server.ts");
    const provider = createLMStudioProvider(key === "default" ? null : key);
    const discovery = await provider.discover();
    if (!discovery.available) throw new Error("Cannot verify writer memory release: local model server is unavailable.");
    if (!discovery.models.some((model) => model.id === data.servedModelId && model.loaded)) return { released: true };
    await provider.load({ servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS });
    await provider.releaseResident("user-explicit");
    if ((await provider.listModels()).some((model) => model.id === data.servedModelId && model.loaded)) throw new Error("Writer model is still loaded. Image generation has not started.");
    return { released: true };
  });

function endpointKey(endpoint?: string | null): string {
  if (!endpoint) return "default";
  const normalized = normalizeLoopbackEndpoint(endpoint);
  if (!normalized) throw new Error("Only a loopback HTTP endpoint is allowed for local movie-plan inference.");
  return normalized;
}

export const moviePlanGenerate = createServerFn({ method: "POST" })
  .validator((input: GenerateInput) => ({
    endpoint: input.endpoint ?? null,
    stepId: String(input.stepId),
    system: String(input.system),
    prompt: String(input.prompt),
    servedModelId: String(input.servedModelId),
    thinkingEnabled: input.thinkingEnabled === true,
    sceneCount: input.sceneCount,
    runtimeSeconds: input.runtimeSeconds,
  }))
  .handler(async ({ data }) => {
    const key = endpointKey(data.endpoint);
    const { createLMStudioProvider } = await import("./lmstudio-provider.server.ts");
    const provider = createLMStudioProvider(key === "default" ? null : key);
    const discovery = await provider.discover();
    if (!discovery.available) throw new Error(discovery.reason || CONFIGURED_MODEL_UNAVAILABLE);
    await provider.load({ servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS });
    return moviePlanStreamResponse(
      (onToken) => provider.generate(
        { runId: "movie-plan", stepId: data.stepId, system: data.system, prompt: data.prompt, thinkingEnabled: data.thinkingEnabled, responseFormat: moviePlanResponseFormat(data.stepId, data.sceneCount, data.runtimeSeconds), onToken },
        { servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS },
      ),
      () => provider.cancel(),
    );
  });
