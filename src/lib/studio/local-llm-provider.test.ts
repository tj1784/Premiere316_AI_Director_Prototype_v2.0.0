import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEndpointCache, discoverCachedLoopbackEndpoint, normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import { NativeLlamaProvider } from "./local-llm-provider.ts";
import { LMStudioProvider } from "./lmstudio-provider.server.ts";
import type { ScreenplayTelemetry } from "./screenplay.ts";

const settings = { temperature: 0.7, topP: 0.9, maxTokens: 128, contextSize: 4096, gpuLayers: 0, seed: 1 };
const resources = () => ({ peakVramBytes: null, peakSystemRamBytes: null });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

test("only loopback HTTP endpoints are accepted", () => {
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:1234/v1/models"), "http://127.0.0.1:1234");
  assert.equal(normalizeLoopbackEndpoint("http://localhost:1235"), "http://localhost:1235");
  assert.equal(normalizeLoopbackEndpoint("https://127.0.0.1:1234"), null);
  assert.equal(normalizeLoopbackEndpoint("http://example.com:1234"), null);
});

test("successful endpoint is cached, reused, and invalidated after a failed startup probe", async () => {
  const cache = new MemoryEndpointCache();
  const seen: string[] = [];
  const first = await discoverCachedLoopbackEndpoint({ cache, candidates: ["http://127.0.0.1:1234"], probe: async (endpoint) => { seen.push(endpoint); return true; } });
  assert.equal(first, "http://127.0.0.1:1234");
  assert.equal(cache.get(), first);
  const second = await discoverCachedLoopbackEndpoint({ cache, candidates: ["http://127.0.0.1:1235"], probe: async (endpoint) => { seen.push(endpoint); return endpoint.endsWith(":1234"); } });
  assert.equal(second, first);
  assert.deepEqual(seen, [first, first]);
  const failed = await discoverCachedLoopbackEndpoint({ cache, candidates: [], probe: async () => false });
  assert.equal(failed, null);
  assert.equal(cache.get(), null);
});

test("OpenAI-only LM Studio falls back when native model metadata endpoint is unsupported", async () => {
  let standardGets = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models")) return json({ error: { message: "not found" } }, 404);
    if (url.endsWith("/v1/models")) {
      standardGets++;
      return json({ data: [{ id: "local-writer", object: "model" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const provider = new LMStudioProvider({ fetch: fetcher, endpointCache: new MemoryEndpointCache(), sampleResources: resources });
  const discovery = await provider.discover();
  assert.equal(discovery.available, true);
  assert.equal(discovery.models[0]?.id, "local-writer");
  assert.equal(discovery.models[0]?.loaded, true);
  assert.equal(standardGets, 2, "one startup probe plus one OpenAI model listing");
});

test("offline LM Studio returns an unavailable discovery without throwing or affecting startup", async () => {
  const provider = new LMStudioProvider({ fetch: async () => { throw new TypeError("connection refused"); }, endpointCache: new MemoryEndpointCache(), timeoutMs: 5, sampleResources: resources });
  const discovery = await provider.discover();
  assert.equal(discovery.available, false);
  assert.equal(discovery.cloudFallback, false);
  assert.match(discovery.reason, /Start its local API/);
});

test("optional unload 404 does not invalidate an otherwise healthy endpoint", async () => {
  let standardGets = 0;
  const native = { models: [{ key: "writer", type: "llm", loaded_instances: [{ id: "instance-1", context_length: 4096 }] }] };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models/unload") && init?.method === "POST") return json({ error: { message: "unsupported" } }, 404);
    if (url.endsWith("/api/v1/models")) return json(native);
    if (url.endsWith("/v1/models")) { standardGets++; return json({ data: [{ id: "writer" }] }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  const provider = new LMStudioProvider({ fetch: fetcher, endpointCache: new MemoryEndpointCache(), sampleResources: resources });
  await provider.load({ servedModelId: "writer", settings });
  await provider.unload();
  const after = await provider.discover();
  assert.equal(after.available, true);
  assert.equal(provider.telemetry()?.unloadVerification, "failed");
  assert.equal(standardGets, 1, "endpoint probe is cached even when optional unload is unsupported");
});

test("provider-neutral telemetry supports future local providers without business-type changes", () => {
  const future: ScreenplayTelemetry = {
    providerId: "future-local",
    provider: "Future Local Provider",
    endpoint: "http://127.0.0.1:9000",
    actualLoadedModel: "writer",
    local: true,
    cloudFallback: false,
    modelId: "writer",
    checkpoint: "writer.gguf",
    runtimeAdapter: "future-runtime",
    loadMs: null,
    generationMs: null,
    unloadMs: null,
    promptTokens: null,
    generatedTokens: null,
    peakVramBytes: null,
    peakSystemRamBytes: null,
    resourceMeasurement: "unavailable",
    unloaded: false,
    unloadVerification: "not-supported",
    measuredAt: 1,
  };
  assert.equal(future.providerId, "future-local");
  assert.equal(future.cloudFallback, false);
});

test("NativeLlamaProvider is explicit, inert, and unavailable", async () => {
  const native = new NativeLlamaProvider();
  const discovery = await native.discover();
  assert.equal(discovery.available, false);
  assert.equal(discovery.models.length, 0);
  await assert.rejects(native.load({ servedModelId: "x", settings }), /disabled/);
});
