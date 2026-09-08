import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_SCREENPLAY_SETTINGS } from "./screenplay.ts";
import { normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import { CONFIGURED_MODEL_UNAVAILABLE } from "./movie-plan-pipeline.ts";

type GenerateInput = { endpoint?: string | null; stepId: string; system: string; prompt: string; servedModelId: string };

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
  }))
  .handler(async ({ data }) => {
    const key = endpointKey(data.endpoint);
    const { createLMStudioProvider } = await import("./lmstudio-provider.server.ts");
    const provider = createLMStudioProvider(key === "default" ? null : key);
    const discovery = await provider.discover();
    if (!discovery.available) throw new Error(discovery.reason || CONFIGURED_MODEL_UNAVAILABLE);
    await provider.load({ servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS });
    const result = await provider.generate(
      { runId: "movie-plan", stepId: data.stepId, system: data.system, prompt: data.prompt },
      { servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS },
    );
    return { text: result.text, servedModelId: data.servedModelId };
  });
