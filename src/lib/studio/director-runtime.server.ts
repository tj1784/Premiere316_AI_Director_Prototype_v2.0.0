import { normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import type { DirectorRuntimeStatus } from "./director-runtime.ts";

const REQUIRED_DIRECTOR_NODES = ["LTXDirector", "LTXDirectorGuide", "LTXDirectorCropGuides"];

/** Read-only node discovery. Node availability does not prove model readiness. */
export async function inspectDirectorRuntime(options: {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<DirectorRuntimeStatus> {
  const endpoint = normalizeLoopbackEndpoint(options.endpoint ?? process.env.P316_LTX_DIRECTOR_ENDPOINT ?? "http://127.0.0.1:8190");
  const base = { checkedAt: options.now ?? Date.now(), appRenderingConnected: false as const, workflowModelsVerified: false as const };
  if (!endpoint) return { ...base, status: "OFFLINE", endpoint: null, missingNodes: [], message: "LTX Director requires a local ComfyUI connection." };
  try {
    const request = options.fetchImpl ?? fetch;
    const results = await Promise.allSettled(REQUIRED_DIRECTOR_NODES.map(async (name) => {
      const response = await request(`${endpoint}/object_info/${name}`, { signal: AbortSignal.timeout(4000), redirect: "error" });
      if (!response.ok) throw new Error("Node discovery failed.");
      const info: unknown = await response.json();
      return info !== null && typeof info === "object" && name in info;
    }));
    if (results.some((result) => result.status === "rejected")) throw new Error("ComfyUI is unavailable.");
    const missingNodes = REQUIRED_DIRECTOR_NODES.filter((_, index) => {
      const result = results[index];
      return result.status !== "fulfilled" || !result.value;
    });
    return missingNodes.length
      ? { ...base, status: "NODE_MISSING", endpoint, missingNodes, message: "ComfyUI is running, but the required LTX Director nodes are missing. Install or update WhatDreamsCost-ComfyUI and its LTXVideo dependencies." }
      : { ...base, status: "AVAILABLE_IN_COMFYUI", endpoint, missingNodes, message: "LTX Director is connected. Review your workflow, then approve it to generate video through the API." };
  } catch {
    return { ...base, status: "OFFLINE", endpoint: null, missingNodes: [], message: "LTX Director is not responding. You can review and edit the workflow; approving it in the desktop app will start the installed instance on 8190 before validating and running it." };
  }
}
