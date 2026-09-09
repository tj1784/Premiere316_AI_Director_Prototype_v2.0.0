import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_SCREENPLAY_SETTINGS } from "./screenplay.ts";
import { normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import { CONFIGURED_MODEL_UNAVAILABLE } from "./movie-plan-pipeline.ts";
import { moviePlanStreamResponse } from "./movie-plan-stream.ts";
import { moviePlanResponseFormat } from "./movie-plan-schema.ts";
import { requireMoviePlanModelId } from "./movie-plan-model.ts";
import { ensureExactMoviePlanModel } from "./movie-plan-model-load.ts";

type GenerateInput = { endpoint?: string | null; stepId: string; system: string; prompt: string; servedModelId: string; thinkingEnabled?: boolean; sceneCount?: number; runtimeSeconds?: number; assetIds?: string[]; sourceQuotes?: string[] };

export const ensureMoviePlanModel = createServerFn({ method: "POST" })
  .validator((input: { servedModelId: string; endpoint?: string | null }) => ({ ...input, servedModelId: requireMoviePlanModelId(input.servedModelId) }))
  .handler(async ({ data }) => {
    const key = endpointKey(data.endpoint);
    const { createLMStudioProvider } = await import("./lmstudio-provider.server.ts");
    const provider = createLMStudioProvider(key === "default" ? null : key);
    return ensureExactMoviePlanModel({ servedModelId: data.servedModelId, discover: () => provider.discover(), loadInstalled: async (modelId) => {
      const [{ spawn }, { homedir }, { join }] = await Promise.all([import("node:child_process"), import("node:os"), import("node:path")]);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(join(homedir(), ".lmstudio", "bin", "lms.exe"), ["load", modelId, "--identifier", modelId, "--context-length", "32768", "--gpu", "max", "--yes"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-3000); };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Local writer load failed: ${output}`)));
      });
    }
    });
  });

export const countAssetPromptTokens = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; engineId?: string }) => {
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 20000) throw new Error("Invalid asset prompt.");
    if (input.engineId !== undefined && !["flux2", "krea-2"].includes(input.engineId)) throw new Error("Unsupported asset prompt tokenizer.");
    return input;
  })
  .handler(async ({ data }) => {
    const { countImagePromptTokens, assetTokenizerIdentity } = await import("./flux2-tokenizer.server.ts");
    return { count: await countImagePromptTokens(data.prompt, data.engineId), ...assetTokenizerIdentity(data.engineId) };
  });

export const releaseMoviePlanModel = createServerFn({ method: "POST" })
  .validator((input: { servedModelId: string; endpoint?: string | null }) => ({ ...input, servedModelId: requireMoviePlanModelId(input.servedModelId) }))
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
    servedModelId: requireMoviePlanModelId(input.servedModelId),
    thinkingEnabled: input.thinkingEnabled === true,
    sceneCount: input.sceneCount,
    runtimeSeconds: input.runtimeSeconds,
    assetIds: input.assetIds,
    sourceQuotes: input.sourceQuotes,
  }))
  .handler(async ({ data }) => {
    const key = endpointKey(data.endpoint);
    const { createLMStudioProvider } = await import("./lmstudio-provider.server.ts");
    const provider = createLMStudioProvider(key === "default" ? null : key);
    const discovery = await provider.discover();
    if (!discovery.available) throw new Error(discovery.reason || CONFIGURED_MODEL_UNAVAILABLE);
    await provider.load({ servedModelId: data.servedModelId, settings: DEFAULT_SCREENPLAY_SETTINGS });
    // A full narrative cannot fit the former 4k-token short-answer budget.
    // Output remains bounded; a truncated/untimed draft is rejected by the pipeline.
    const maxTokens = data.stepId === "screenplay"
      ? Math.min(20000, Math.max(8192, Math.ceil((data.runtimeSeconds ?? 120) / 60 * 550)))
      : data.stepId === "research" ? 8192
      : ["breakdown", "shots", "promptLab", "assetPrompts"].includes(data.stepId) ? 12000
      : DEFAULT_SCREENPLAY_SETTINGS.maxTokens;
    const generationSettings = { ...DEFAULT_SCREENPLAY_SETTINGS, maxTokens };
    return moviePlanStreamResponse(
      (onToken, onReasoning) => provider.generate(
        { runId: "movie-plan", stepId: data.stepId, system: data.system, prompt: data.prompt, thinkingEnabled: data.thinkingEnabled, responseFormat: moviePlanResponseFormat(data.stepId, data.sceneCount, data.runtimeSeconds, data.assetIds, data.sourceQuotes), onToken, onReasoning },
        { servedModelId: data.servedModelId, settings: generationSettings },
      ),
      () => provider.cancel(),
    );
  });
