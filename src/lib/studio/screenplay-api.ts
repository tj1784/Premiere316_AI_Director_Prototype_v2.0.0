import { createServerFn } from "@tanstack/react-start";
import { approvedResearchSnapshot, type PictureResearchBible } from "../research/bible.ts";
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
    research: input.research ?? null,
    modelId: String(input.modelId),
    rewriteScope: input.rewriteScope,
    selectedNodeId: input.selectedNodeId ?? null,
    selectedNodeIds: input.selectedNodeIds ?? null,
    selection: input.selection ?? null,
    logicalRole: input.logicalRole,
    releaseAtEnd: Boolean(input.releaseAtEnd),
    settings: input.settings as Partial<ScreenplayGenerationSettings> | undefined,
    stepId: input.stepId,
    resume: Boolean(input.resume),
  }))
  .handler(async ({ data }) => (await manager(data.endpoint)).start(data));

export const getScreenplayJob = createServerFn({ method: "POST" })
  .validator((input: JobInput) => ({ jobId: String(input.jobId), endpoint: input.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).get(data.jobId));

export const runScreenplayQa = createServerFn({ method: "POST" })
  .validator((input: {
    fountain: string;
    modelId: string;
    writerId?: string | null;
    pinnedQaServedId?: string | null;
    endpoint?: string | null;
    secondOpinion?: boolean;
    goal?: string;
    revisionTarget?: string;
    rewriteScope?: import("./screenplay-scope.ts").ScreenplayScope;
    selectedNodeId?: string | null;
    selectedNodeIds?: string[] | null;
    selection?: import("./screenplay-scope.ts").ScreenplaySelection;
    characterState?: string;
    continuityState?: string;
    research?: PictureResearchBible | null;
  }) => {
    const research = input.research ?? null;
    const approvedResearch = approvedResearchSnapshot(research);
    if (research && !approvedResearch) throw new Error("Approve Picture Research before running Story Doctor.");
    return {
      endpoint: input.endpoint ?? null,
      fountain: String(input.fountain ?? ""),
      modelId: String(input.modelId),
      writerId: input.writerId ?? null,
      pinnedQaServedId: input.pinnedQaServedId ?? null,
      secondOpinion: Boolean(input.secondOpinion),
      goal: input.goal ?? "",
      revisionTarget: input.revisionTarget ?? "full",
      rewriteScope: input.rewriteScope,
      selectedNodeId: input.selectedNodeId ?? null,
      selectedNodeIds: input.selectedNodeIds ?? null,
      selection: input.selection ?? null,
      characterState: input.characterState,
      continuityState: input.continuityState,
      approvedResearch,
    };
  })
  .handler(async ({ data }) => (await manager(data.endpoint)).critique(data));

export const releaseScreenplayResident = createServerFn({ method: "POST" })
  .validator((input: EndpointQuery | undefined) => ({ endpoint: input?.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).releaseResident());

export const cancelScreenplayJob = createServerFn({ method: "POST" })
  .validator((input: JobInput) => ({ jobId: String(input.jobId), endpoint: input.endpoint ?? null }))
  .handler(async ({ data }) => (await manager(data.endpoint)).cancel(data.jobId));
