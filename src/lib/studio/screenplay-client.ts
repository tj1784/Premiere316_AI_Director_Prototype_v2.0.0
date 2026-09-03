import { BrowserEndpointCache } from "./local-llm-endpoint.ts";
import { cancelScreenplayJob, getLocalLLMStatus, getScreenplayJob, runScreenplayQa, startScreenplayJob } from "./screenplay-api.ts";
import type { StartScreenplayJobInput } from "./screenplay-jobs.server.ts";

const endpointCache = new BrowserEndpointCache();

export async function localLLMStatus() {
  const result = await getLocalLLMStatus({ data: { endpoint: endpointCache.get() } });
  if (result.provider.endpoint) endpointCache.set(result.provider.endpoint);
  return result;
}

export async function beginScreenplayJob(input: StartScreenplayJobInput) {
  return startScreenplayJob({ data: { ...input, endpoint: endpointCache.get() } });
}

export async function readScreenplayJob(jobId: string) {
  return getScreenplayJob({ data: { jobId, endpoint: endpointCache.get() } });
}

export async function stopScreenplayJob(jobId: string) {
  return cancelScreenplayJob({ data: { jobId, endpoint: endpointCache.get() } });
}

export async function beginScreenplayQa(input: { fountain: string; modelId: string; writerId: string | null; pinnedQaServedId?: string | null }) {
  return runScreenplayQa({ data: { ...input, endpoint: endpointCache.get() } });
}
