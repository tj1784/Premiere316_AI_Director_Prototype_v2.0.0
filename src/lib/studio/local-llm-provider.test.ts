import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEndpointCache, discoverCachedLoopbackEndpoint, normalizeLoopbackEndpoint } from "./local-llm-endpoint.ts";
import { NativeLlamaProvider } from "./local-llm-provider.ts";
import { LMStudioProvider } from "./lmstudio-provider.server.ts";
import type { ScreenplayTelemetry } from "./screenplay.ts";
import { moviePlanResponseFormat } from "./movie-plan-schema.ts";

test("movie-plan JSON schema reaches the actual streaming completion request", async () => {
  let body: Record<string, unknown> = {};
  const provider = new LMStudioProvider({ endpointCache: new MemoryEndpointCache(), sampleResources: () => ({ peakVramBytes: null, peakSystemRamBytes: null }), fetch: async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/v1/models')) return json({ models: [{ key: 'writer', type: 'llm', loaded_instances: [{ id: 'instance-1' }] }] });
    if (url.endsWith('/v1/models')) return json({ data: [{ id: 'writer' }] });
    if (url.endsWith('/v1/chat/completions')) { body = JSON.parse(String(init?.body)); return new Response('data: {"model":"writer","choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n'); }
    throw new Error(url);
  } });
  const responseFormat = moviePlanResponseFormat('screenplay');
  await provider.load({ servedModelId: 'writer', settings });
  await provider.generate({ runId: 'r', stepId: 'screenplay', system: 's', prompt: 'p', responseFormat, thinkingEnabled: false }, { servedModelId: 'writer', settings });
  assert.deepEqual(body.response_format, responseFormat);
  assert.equal(body.stream, true);
  assert.equal(body.reasoning_effort, "none");
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

const settings = { temperature: 0.7, topP: 0.9, maxTokens: 128, contextSize: 4096, gpuLayers: 0, seed: 1 };
const resources = () => ({ peakVramBytes: null, peakSystemRamBytes: null });

test("GPT-OSS completion stays pinned and rejects Gemma or unidentified output before exposing text", async () => {
  const writer = "gptoss-120b-uncensored-hauhaucs-aggressive";
  for (const returnedModel of [writer, "gpt-instance", "gemma", undefined]) {
    let postedModel = "";
    let delivered = "";
    let reasoning = "";
    let requestSignal: AbortSignal | null | undefined;
    const provider = new LMStudioProvider({ endpointCache: new MemoryEndpointCache(), sampleResources: resources, fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models")) return json({ models: [{ key: "gemma", type: "llm", loaded_instances: [{ id: "gemma-instance" }] }, { key: writer, type: "llm", loaded_instances: [{ id: "gpt-instance" }] }] });
      if (url.endsWith("/v1/models")) return json({ data: [{ id: "gemma" }, { id: writer }] });
      if (url.endsWith("/v1/chat/completions")) {
        postedModel = JSON.parse(String(init?.body)).model;
        requestSignal = init?.signal;
        return new Response(`data: ${JSON.stringify({ model: returnedModel, choices: [{ delta: { reasoning_content: "local reasoning", content: "model output" } }] })}\n\ndata: [DONE]\n\n`);
      }
      throw new Error(url);
    } });
    await provider.load({ servedModelId: writer, settings });
    const generation = provider.generate({ runId: "r", stepId: "assetPrompts", system: "s", prompt: "p", onToken: (text) => { delivered += text; }, onReasoning: (text) => { reasoning += text; } }, { servedModelId: writer, settings });
    if (returnedModel === writer || returnedModel === "gpt-instance") {
      assert.equal((await generation).text, "model output");
      assert.equal(reasoning, "local reasoning");
    } else {
      await assert.rejects(generation, /response was rejected/);
      assert.equal(delivered, "");
      assert.equal(reasoning, "");
      assert.equal(requestSignal?.aborted, true);
    }
    assert.equal(postedModel, writer);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

test("only loopback HTTP endpoints are accepted", () => {
  assert.equal(normalizeLoopbackEndpoint("http://127.0.0.1:1234/v1/models"), "http://127.0.0.1:1234");
  assert.equal(normalizeLoopbackEndpoint("http://localhost:1235"), "http://localhost:1235");
  assert.equal(normalizeLoopbackEndpoint("https://127.0.0.1:1234"), null);
  assert.equal(normalizeLoopbackEndpoint("http://example.com:1234"), null);
});

test("dev UI port 8080 is never an approved LM Studio candidate", async () => {
  const { isApprovedLmStudioEndpoint } = await import("./local-llm-endpoint.ts");
  const { LM_STUDIO_ENDPOINT_CANDIDATES } = await import("./local-llm-provider.ts");
  assert.equal(isApprovedLmStudioEndpoint("http://127.0.0.1:8080"), false);
  assert.equal((LM_STUDIO_ENDPOINT_CANDIDATES as readonly string[]).includes("http://127.0.0.1:8080"), false);
  const cache = new MemoryEndpointCache("http://127.0.0.1:8080");
  const seen: string[] = [];
  const found = await discoverCachedLoopbackEndpoint({
    cache,
    candidates: ["http://127.0.0.1:8080", "http://127.0.0.1:1234"],
    probe: async (endpoint) => {
      seen.push(endpoint);
      return endpoint.endsWith(":1234");
    },
  });
  assert.equal(found, "http://127.0.0.1:1234");
  assert.equal(seen.includes("http://127.0.0.1:8080"), false);
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

test("OpenAI-only LM Studio listing never marks rows loaded or ready", async () => {
  let standardGets = 0;
  let completions = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models")) return json({ error: { message: "not found" } }, 404);
    if (url.endsWith("/v1/models")) {
      standardGets++;
      return json({ data: [{ id: "local-writer", object: "model" }] });
    }
    if (url.endsWith("/v1/chat/completions")) {
      completions++;
      return json({ choices: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const provider = new LMStudioProvider({ fetch: fetcher, endpointCache: new MemoryEndpointCache(), sampleResources: resources });
  const discovery = await provider.discover();
  assert.equal(discovery.available, true);
  assert.equal(discovery.models[0]?.id, "local-writer");
  assert.equal(discovery.models[0]?.loaded, false);
  await assert.rejects(provider.load({ servedModelId: "local-writer", settings }), /native model status is unavailable|will not auto-load/);
  await assert.rejects(provider.generate({ runId: "r", stepId: "draft", system: "s", prompt: "p" }, { servedModelId: "local-writer", settings }), /will not auto-load|native model status/);
  assert.equal(completions, 0);
  assert.ok(standardGets >= 1);
});

test("offline LM Studio returns an unavailable discovery without throwing or affecting startup", async () => {
  const provider = new LMStudioProvider({ fetch: async () => { throw new TypeError("connection refused"); }, endpointCache: new MemoryEndpointCache(), timeoutMs: 5, sampleResources: resources });
  const discovery = await provider.discover();
  assert.equal(discovery.available, false);
  assert.equal(discovery.cloudFallback, false);
  assert.match(discovery.reason, /Start its local API/);
});

test("completion POST is refused unless native listing still shows the exact served ID loaded", async () => {
  let completions = 0;
  let loaded = true;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models")) {
      return json({ models: [{ key: "qwen2.5-72b-instruct", type: "llm", loaded_instances: loaded ? [{ id: "instance-1", context_length: 4096 }] : [] }] });
    }
    if (url.endsWith("/v1/models")) return json({ data: [{ id: "qwen2.5-72b-instruct" }] });
    if (url.endsWith("/v1/chat/completions")) {
      completions++;
      return json({ choices: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const provider = new LMStudioProvider({ fetch: fetcher, endpointCache: new MemoryEndpointCache(), sampleResources: resources });
  await provider.load({ servedModelId: "qwen2.5-72b-instruct", settings });
  loaded = false;
  await assert.rejects(provider.generate({ runId: "r", stepId: "draft", system: "s", prompt: "p" }, { servedModelId: "qwen2.5-72b-instruct", settings }), /not currently loaded/);
  assert.equal(completions, 0);
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
  assert.equal(provider.telemetry()?.unloadVerification, "held-resident");
  await provider.releaseResident("user-explicit");
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
