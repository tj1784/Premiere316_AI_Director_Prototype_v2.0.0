import { execFileSync } from "node:child_process";
import { freemem, totalmem } from "node:os";
import type {
  LocalLLMGenerateRequest,
  LocalLLMGenerateResult,
  LocalLLMLoadConfig,
  LocalLLMProvider,
  LocalLLMProviderDiscovery,
  LocalLLMServedModel,
} from "./local-llm-provider.ts";
import { LM_STUDIO_ENDPOINT_CANDIDATES } from "./local-llm-provider.ts";
import { discoverCachedLoopbackEndpoint, MemoryEndpointCache, normalizeLoopbackEndpoint, type LocalLLMEndpointCache } from "./local-llm-endpoint.ts";
import type { ScreenplayTelemetry } from "./screenplay.ts";

type FetchLike = typeof fetch;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeModel(raw: unknown, native: boolean): LocalLLMServedModel | null {
  const model = asObject(raw);
  const instances = Array.isArray(model.loaded_instances) ? model.loaded_instances.map(asObject) : [];
  const first = instances[0] ?? {};
  const id = String(model.id ?? model.key ?? model.model ?? "").trim();
  if (!id) return null;
  const type = String(model.type ?? "llm").toLowerCase();
  const quant = asObject(model.quantization);
  return {
    id,
    displayName: String(model.display_name ?? model.displayName ?? model.name ?? id),
    type: type === "llm" ? "llm" : type === "embedding" ? "embedding" : "unknown",
    loaded: native ? instances.length > 0 : true,
    instanceId: first.id ? String(first.id) : null,
    path: model.path ? String(model.path) : null,
    precision: model.precision ? String(model.precision) : null,
    quantization: quant.name ? String(quant.name) : model.quantization ? String(model.quantization) : null,
    contextLength: finiteNumber(first.context_length ?? model.max_context_length ?? model.context_length),
    sizeBytes: finiteNumber(model.size_bytes ?? model.sizeBytes),
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json() as unknown;
  return asObject(data);
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  const error = asObject(data.error);
  return String(error.message ?? data.message ?? fallback);
}

function sampleGpuUsedBytes(): number | null {
  try {
    const raw = execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    const mib = Math.max(...raw.split(/\r?\n/).map(Number).filter(Number.isFinite));
    return Number.isFinite(mib) ? mib * 1024 * 1024 : null;
  } catch {
    return null;
  }
}

export class LMStudioProvider implements LocalLLMProvider {
  readonly id = "lm-studio" as const;
  readonly name = "LM Studio" as const;
  #endpoint: string | null = null;
  #models: LocalLLMServedModel[] = [];
  #activeModel: LocalLLMServedModel | null = null;
  #abort: AbortController | null = null;
  #telemetry: ScreenplayTelemetry | null = null;
  #loadStartedAt = 0;
  #peakVramBytes: number | null = null;
  #peakSystemRamBytes: number | null = null;
  private readonly options: {
    fetch?: FetchLike;
    endpointCache?: LocalLLMEndpointCache;
    candidates?: string[];
    timeoutMs?: number;
    now?: () => number;
    sampleResources?: () => { peakVramBytes: number | null; peakSystemRamBytes: number | null };
  };

  constructor(options: {
      fetch?: FetchLike;
      endpointCache?: LocalLLMEndpointCache;
      candidates?: string[];
      timeoutMs?: number;
      now?: () => number;
      sampleResources?: () => { peakVramBytes: number | null; peakSystemRamBytes: number | null };
    } = {}) {
    this.options = options;
  }

  get fetcher(): FetchLike { return this.options.fetch ?? fetch; }
  get cache(): LocalLLMEndpointCache { return this.options.endpointCache ?? defaultEndpointCache; }
  get now(): () => number { return this.options.now ?? Date.now; }
  sampleResources(): { peakVramBytes: number | null; peakSystemRamBytes: number | null } {
    return this.options.sampleResources?.() ?? {
      peakVramBytes: sampleGpuUsedBytes(),
      peakSystemRamBytes: totalmem() - freemem(),
    };
  }

  async #fetch(path: string, init?: RequestInit): Promise<Response> {
    if (!this.#endpoint) throw new Error("LM Studio local server is unavailable.");
    let response: Response;
    try {
      response = await this.fetcher(`${this.#endpoint}${path}`, init);
    } catch (error) {
      if (init?.signal?.aborted || error instanceof Error && /aborted/i.test(error.message)) throw error;
      this.cache.clear();
      this.#endpoint = null;
      throw error;
    }
    if (!response.ok) {
      const data = await responseJson(response).catch(() => ({}));
      throw new Error(errorMessage(data, `LM Studio request failed (${response.status}).`));
    }
    return response;
  }

  async #probe(endpoint: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 1_500);
    try {
      const response = await this.fetcher(`${endpoint}/v1/models`, { signal: controller.signal });
      if (!response.ok) return false;
      const data = await responseJson(response);
      return Array.isArray(data.data);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async discover(): Promise<LocalLLMProviderDiscovery> {
    if (!this.#endpoint) {
      this.#endpoint = await discoverCachedLoopbackEndpoint({
        cache: this.cache,
        candidates: this.options.candidates ?? [...LM_STUDIO_ENDPOINT_CANDIDATES],
        probe: (endpoint) => this.#probe(endpoint),
      });
    }
    if (!this.#endpoint) {
      this.#models = [];
      return {
        providerId: this.id,
        providerName: this.name,
        endpoint: null,
        local: true,
        cloudFallback: false,
        available: false,
        reason: "LM Studio local server is unavailable. Start its local API and load a text model, then rescan.",
        models: [],
        discoveredAt: this.now(),
      };
    }
    this.#models = await this.listModels();
    return {
      providerId: this.id,
      providerName: this.name,
      endpoint: this.#endpoint,
      local: true,
      cloudFallback: false,
      available: true,
      reason: this.#models.some((model) => model.loaded && model.type === "llm")
        ? "Local API ready."
        : "LM Studio is online, but no text model is loaded.",
      models: this.#models,
      discoveredAt: this.now(),
    };
  }

  async listModels(): Promise<LocalLLMServedModel[]> {
    if (!this.#endpoint) return [];
    try {
      const nativeResponse = await this.#fetch("/api/v1/models");
      const nativeData = await responseJson(nativeResponse);
      const rows = Array.isArray(nativeData.models) ? nativeData.models : Array.isArray(nativeData.data) ? nativeData.data : [];
      return rows.map((item) => normalizeModel(item, true)).filter((item): item is LocalLLMServedModel => Boolean(item));
    } catch {
      if (!this.#endpoint) return [];
      const response = await this.#fetch("/v1/models");
      const data = await responseJson(response);
      const rows = Array.isArray(data.data) ? data.data : [];
      return rows.map((item) => normalizeModel(item, false)).filter((item): item is LocalLLMServedModel => Boolean(item));
    }
  }

  async load(config: LocalLLMLoadConfig): Promise<void> {
    this.#loadStartedAt = this.now();
    const discovery = await this.discover();
    const model = discovery.models.find((item) => item.id === config.servedModelId && item.loaded && item.type === "llm");
    if (!model) throw new Error("The selected model is not currently loaded and served by LM Studio.");
    this.#activeModel = model;
    const resources = this.sampleResources();
    this.#peakVramBytes = resources.peakVramBytes;
    this.#peakSystemRamBytes = resources.peakSystemRamBytes;
    this.#telemetry = {
      providerId: this.id,
      provider: "LM Studio",
      endpoint: this.#endpoint!,
      actualLoadedModel: model.id,
      local: true,
      cloudFallback: false,
      modelId: model.id,
      checkpoint: model.path ?? model.id,
      runtimeAdapter: "LM Studio OpenAI-compatible local API",
      loadMs: this.now() - this.#loadStartedAt,
      generationMs: null,
      unloadMs: null,
      promptTokens: null,
      generatedTokens: null,
      peakVramBytes: this.#peakVramBytes,
      peakSystemRamBytes: this.#peakSystemRamBytes,
      resourceMeasurement: "system-total",
      unloaded: false,
      unloadVerification: "not-supported",
      measuredAt: this.now(),
    };
  }

  async generate(request: LocalLLMGenerateRequest, config: LocalLLMLoadConfig): Promise<LocalLLMGenerateResult> {
    if (!this.#activeModel || this.#activeModel.id !== config.servedModelId) throw new Error("Selected LM Studio model is not loaded for this workflow.");
    const started = this.now();
    const controller = new AbortController();
    this.#abort = controller;
    let text = "";
    let promptTokens: number | null = null;
    let generatedTokens: number | null = null;
    try {
      const response = await this.#fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.servedModelId,
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
        temperature: config.settings.temperature,
        top_p: config.settings.topP,
        max_tokens: config.settings.maxTokens,
        seed: config.settings.seed,
        stream: true,
        stream_options: { include_usage: true },
      }),
      });
      if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        pending += decoder.decode(part.value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const value = line.slice(5).trim();
          if (!value || value === "[DONE]") continue;
          const event = asObject(JSON.parse(value));
          const choices = Array.isArray(event.choices) ? event.choices.map(asObject) : [];
          const delta = asObject(choices[0]?.delta);
          const token = typeof delta.content === "string" ? delta.content : "";
          if (token) {
            text += token;
            request.onToken?.(token);
          }
          const usage = asObject(event.usage);
          promptTokens = finiteNumber(usage.prompt_tokens) ?? promptTokens;
          generatedTokens = finiteNumber(usage.completion_tokens) ?? generatedTokens;
        }
      }
      }
      const durationMs = this.now() - started;
      const resources = this.sampleResources();
      this.#peakVramBytes = Math.max(this.#peakVramBytes ?? 0, resources.peakVramBytes ?? 0) || null;
      this.#peakSystemRamBytes = Math.max(this.#peakSystemRamBytes ?? 0, resources.peakSystemRamBytes ?? 0) || null;
      if (this.#telemetry) {
        this.#telemetry = {
          ...this.#telemetry,
          generationMs: (this.#telemetry.generationMs ?? 0) + durationMs,
          promptTokens: (this.#telemetry.promptTokens ?? 0) + (promptTokens ?? 0) || null,
          generatedTokens: (this.#telemetry.generatedTokens ?? 0) + (generatedTokens ?? 0) || null,
          peakVramBytes: this.#peakVramBytes,
          peakSystemRamBytes: this.#peakSystemRamBytes,
          measuredAt: this.now(),
        };
      }
      return { text, durationMs, promptTokens, generatedTokens };
    } finally {
      if (this.#abort === controller) this.#abort = null;
    }
  }

  async cancel(): Promise<void> {
    this.#abort?.abort(new Error("Screenplay generation stopped."));
    this.#abort = null;
  }

  telemetry(): ScreenplayTelemetry | null {
    return this.#telemetry ? { ...this.#telemetry } : null;
  }

  async unload(): Promise<void> {
    const started = this.now();
    const active = this.#activeModel;
    let verification: ScreenplayTelemetry["unloadVerification"] = "not-supported";
    if (active?.instanceId && this.#endpoint) {
      try {
        await this.#fetch("/api/v1/models/unload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instance_id: active.instanceId }),
        });
        const models = await this.listModels();
        verification = models.some((model) => model.instanceId === active.instanceId) ? "failed" : "verified";
      } catch {
        verification = "failed";
      }
    }
    if (this.#telemetry) {
      this.#telemetry = {
        ...this.#telemetry,
        unloadMs: this.now() - started,
        unloaded: verification === "verified",
        unloadVerification: verification,
        measuredAt: this.now(),
      };
    }
    this.#activeModel = null;
  }
}

const defaultEndpointCache = new MemoryEndpointCache();

export function createLMStudioProvider(preferredEndpoint?: string | null): LMStudioProvider {
  const normalized = preferredEndpoint ? normalizeLoopbackEndpoint(preferredEndpoint) : null;
  if (preferredEndpoint && !normalized) throw new Error("Only a loopback HTTP endpoint is allowed for local screenplay inference.");
  if (normalized && defaultEndpointCache.get() !== normalized) defaultEndpointCache.set(normalized);
  return new LMStudioProvider({
    endpointCache: defaultEndpointCache,
    candidates: normalized
      ? [normalized, ...LM_STUDIO_ENDPOINT_CANDIDATES.filter((endpoint) => endpoint !== normalized)]
      : [...LM_STUDIO_ENDPOINT_CANDIDATES],
  });
}
