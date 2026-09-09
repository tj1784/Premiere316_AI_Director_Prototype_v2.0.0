import type { PictureResearchBible } from "../research/bible.ts";
import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { cancelScreenplayJob, getLocalLLMStatus, getScreenplayJob, releaseScreenplayResident, runScreenplayQa, startScreenplayJob } from "./screenplay-api.ts";
import type { StartScreenplayJobInput } from "./screenplay-jobs.server.ts";
import { readMoviePlanStream } from "./movie-plan-stream.ts";
import type { ScreenplayQaReport } from "./screenplay-qa.ts";
import { getGlobalProductionInstructions } from "./production-instructions.ts";
import { prepareVisualDirection } from "./visual-direction-client.ts";

const endpointCache = new BrowserEndpointCache();

export async function localLLMStatus() {
  const result = await getLocalLLMStatus({ data: { endpoint: endpointCache.get() } });
  if (result.provider.endpoint) endpointCache.set(result.provider.endpoint);
  return result;
}

export async function beginScreenplayJob(input: StartScreenplayJobInput) {
  const intake = await prepareVisualDirection(input.intake, input.screenplay.pinnedWriterServedId ?? undefined);
  if (intake !== input.intake) {
    if (input.screenplay.pinnedWriterServedId) {
      const { ensureMoviePlanModel } = await import("./movie-plan-api.ts");
      await ensureMoviePlanModel({ data: { servedModelId: input.screenplay.pinnedWriterServedId, endpoint: endpointCache.get() } });
    }
    const { useStudio } = await import("./store");
    const state = useStudio.getState();
    const active = state.pictures.find(picture => picture.id === state.activeId);
    if (active?.intake.visualDirection?.boardId === intake.visualDirection?.boardId) state.patchActive({ intake });
    input = { ...input, intake };
  }
  return startScreenplayJob({ data: { ...input, generationInstructions: getGlobalProductionInstructions(), endpoint: endpointCache.get() } });
}

export async function readScreenplayJob(jobId: string) {
  return getScreenplayJob({ data: { jobId, endpoint: endpointCache.get() } });
}

export async function stopScreenplayJob(jobId: string) {
  return cancelScreenplayJob({ data: { jobId, endpoint: endpointCache.get() } });
}

export async function beginScreenplayQa(input: {
  fountain: string;
  modelId: string;
  writerId: string | null;
  pinnedQaServedId?: string | null;
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
  directorNotes?: string;
}, progress?: { signal?: AbortSignal; onText?: (text: string) => void; onReasoning?: (text: string) => void }): Promise<ScreenplayQaReport> {
  const response = await runScreenplayQa({ data: { ...input, generationInstructions: getGlobalProductionInstructions(), endpoint: endpointCache.get() }, signal: progress?.signal });
  const result = await readMoviePlanStream(response, progress?.onText, progress?.onReasoning);
  return JSON.parse(result.text) as ScreenplayQaReport;
}

export async function releaseLocalScreenplayModel() {
  return releaseScreenplayResident({ data: { endpoint: endpointCache.get() } });
}
