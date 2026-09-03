import { createServerFn } from "@tanstack/react-start";
import { normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import type { PictureIntake } from "./picture-intake.ts";
import type { PictureScreenplay, ScreenplayGenerationSettings } from "./screenplay.ts";
import type { StartScreenplayJobInput } from "./screenplay-jobs.server.ts";

type EndpointQuery = { endpoint?: string | null };
type StartInput = StartScreenplayJobInput & EndpointQuery;
type JobInput = { jobId: string; endpoint?: string | null };

function endpointKey(endpoint?: string | null): string {
  if (!endpoint) return "default";
  const normalized = normalizeLoopbackEndpoint(endpoint);
  if (!normalized) throw new Error("Only a loopback HTTP endpoint is allowed for local screenplay inference.");
  return normalized;
}

async function manager(endpoint?: string | null) {
  const key = endpointKey(endpoint);
  const globalKey = "__premiere316ScreenplayManagers";
  const holder = globalThis as typeof globalThis & { [globalKey]?: Map<string, import("./screenplay-jobs.server.ts").ScreenplayJobManager> };
  holder[globalKey] ??= new Map();
  const existing = holder[globalKey]!.get(key);
  if (existing) return existing;
  const [{ createLMStudioProvider }, { loadCatalog }, { ScreenplayJobManager }] = await Promise.all([
    import("./lmstudio-provider.server.ts"),
    import("./model-scan.server.ts"),
    import("./screenplay-jobs.server.ts"),
  ]);
  const created = new ScreenplayJobManager(createLMStudioProvider(key === "default" ? null : key), () => loadCatalog());
  holder[globalKey]!.set(key, created);
  return created;
}

export const getLocalLLMStatus = createServerFn({ method: "POST" })
  .validator((input: EndpointQuery | undefined) => ({ endpoint: input?.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).status());

export const startScreenplayJob = createServerFn({ method: "POST" })
  .validator((input: StartInput) => ({
    endpoint: input.endpoint ?? null,
    intake: input.intake as PictureIntake,
    screenplay: input.screenplay as PictureScreenplay,
    modelId: String(input.modelId),
    settings: input.settings as Partial<ScreenplayGenerationSettings> | undefined,
    stepId: input.stepId,
    resume: Boolean(input.resume),
  }))
  .handler(async ({ data }) => (await manager(data.endpoint)).start(data));

export const getScreenplayJob = createServerFn({ method: "POST" })
  .validator((input: JobInput) => ({ jobId: String(input.jobId), endpoint: input.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).get(data.jobId));

export const cancelScreenplayJob = createServerFn({ method: "POST" })
  .validator((input: JobInput) => ({ jobId: String(input.jobId), endpoint: input.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).cancel(data.jobId));
