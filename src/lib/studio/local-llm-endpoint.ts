import { LM_STUDIO_ENDPOINT } from "./local-llm-provider.ts";

export const LOCAL_LLM_ENDPOINT_STORAGE_KEY = "premiere316-local-llm-endpoint-v1";

export interface LocalLLMEndpointCache {
  get(): string | null;
  set(endpoint: string): void;
  clear(): void;
}

export class MemoryEndpointCache implements LocalLLMEndpointCache {
  private value: string | null;
  constructor(value: string | null = null) { this.value = value; }
  get(): string | null { return this.value; }
  set(endpoint: string): void { this.value = endpoint; }
  clear(): void { this.value = null; }
}

export class BrowserEndpointCache implements LocalLLMEndpointCache {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LOCAL_LLM_ENDPOINT_STORAGE_KEY);
  }
  set(endpoint: string): void {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_LLM_ENDPOINT_STORAGE_KEY, endpoint);
  }
  clear(): void {
    if (typeof window !== "undefined") window.localStorage.removeItem(LOCAL_LLM_ENDPOINT_STORAGE_KEY);
  }
}

export function normalizeLoopbackEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function discoverCachedLoopbackEndpoint(input: {
  cache: LocalLLMEndpointCache;
  candidates?: string[];
  probe: (endpoint: string) => Promise<boolean>;
}): Promise<string | null> {
  const cached = input.cache.get();
  const candidates = [cached, ...(input.candidates ?? [LM_STUDIO_ENDPOINT])]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLoopbackEndpoint)
    .filter((value): value is string => Boolean(value));
  for (const endpoint of [...new Set(candidates)]) {
    if (await input.probe(endpoint)) {
      input.cache.set(endpoint);
      return endpoint;
    }
  }
  input.cache.clear();
  return null;
}
