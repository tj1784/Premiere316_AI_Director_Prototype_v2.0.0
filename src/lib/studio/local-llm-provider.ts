import type { ScreenplayGenerationSettings, ScreenplayTelemetry } from "./screenplay.ts";

export const LM_STUDIO_ENDPOINT = "http://127.0.0.1:1234";
/** Explicitly approved LM Studio loopback ports only. Never include the Vite/dev UI port. */
export const LM_STUDIO_ENDPOINT_CANDIDATES = [
  LM_STUDIO_ENDPOINT,
  "http://127.0.0.1:1235",
] as const;

export type LocalLLMServedModel = {
  id: string;
  displayName: string;
  type: "llm" | "embedding" | "unknown";
  loaded: boolean;
  instanceId: string | null;
  path: string | null;
  precision: string | null;
  quantization: string | null;
  contextLength: number | null;
  sizeBytes: number | null;
};

export type LocalLLMProviderDiscovery = {
  providerId: string;
  providerName: string;
  endpoint: string | null;
  local: true;
  cloudFallback: false;
  available: boolean;
  reason: string;
  models: LocalLLMServedModel[];
  discoveredAt: number;
};

export type LocalLLMLoadConfig = {
  servedModelId: string;
  settings: ScreenplayGenerationSettings;
};

export type LocalLLMGenerateRequest = {
  runId: string;
  stepId: string;
  system: string;
  prompt: string;
  onToken?: (token: string) => void;
};

export type LocalLLMGenerateResult = {
  text: string;
  durationMs: number;
  promptTokens: number | null;
  generatedTokens: number | null;
};

export interface LocalLLMProvider {
  readonly id: string;
  readonly name: string;
  discover(): Promise<LocalLLMProviderDiscovery>;
  listModels(): Promise<LocalLLMServedModel[]>;
  load(config: LocalLLMLoadConfig): Promise<void>;
  generate(request: LocalLLMGenerateRequest, config: LocalLLMLoadConfig): Promise<LocalLLMGenerateResult>;
  cancel(): Promise<void>;
  telemetry(): ScreenplayTelemetry | null;
  unload(): Promise<void>;
}

/** Explicitly present for future native work, but deliberately inert and startup-safe. */
export class NativeLlamaProvider implements LocalLLMProvider {
  readonly id = "native-llama" as const;
  readonly name = "Native llama.cpp" as const;
  async discover(): Promise<LocalLLMProviderDiscovery> {
    return {
      providerId: this.id,
      providerName: this.name,
      endpoint: null,
      local: true,
      cloudFallback: false,
      available: false,
      reason: "Native llama.cpp is disabled in this release. Start the LM Studio local API instead.",
      models: [],
      discoveredAt: Date.now(),
    };
  }
  async listModels(): Promise<LocalLLMServedModel[]> { return []; }
  async load(_config: LocalLLMLoadConfig): Promise<void> { throw new Error("Native llama.cpp is disabled in this release."); }
  async generate(_request: LocalLLMGenerateRequest, _config: LocalLLMLoadConfig): Promise<LocalLLMGenerateResult> { throw new Error("Native llama.cpp is disabled in this release."); }
  async cancel(): Promise<void> {}
  telemetry(): ScreenplayTelemetry | null { return null; }
  async unload(): Promise<void> {}
}
