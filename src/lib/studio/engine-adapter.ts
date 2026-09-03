/**
 * Modality-neutral native adapter contract. Renderer code consumes definitions;
 * desktop/server code owns the optional runtime implementation.
 */

export type EngineModality = "text" | "image" | "video" | "audio" | "music" | "tool";
export type AdapterAvailability = "available" | "missing-components" | "unsupported" | "needs-validation";

export type AdapterDiscovery = {
  adapterId: string;
  displayName: string;
  modality: EngineModality;
  availability: AdapterAvailability;
  runtimeImplementation: string;
  componentIds: string[];
  warnings: string[];
};

export type AdapterValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type AdapterMemoryEstimate = {
  estimatedVramBytes: number | null;
  estimatedSystemRamBytes: number | null;
  basis: "measured-calibration" | "adapter-estimate" | "unavailable";
  notes: string[];
};

export type AdapterBenchmark = {
  adapterId: string;
  configurationFingerprint: string;
  modelLoadMs: number | null;
  firstGenerationMs: number | null;
  warmGenerationMs: number | null;
  peakVramBytes: number | null;
  peakSystemRamBytes: number | null;
  outputDescription: string;
  errors: string[];
  warnings: string[];
  measuredAt: string;
};

export interface EngineAdapterDefinition<TCapabilities, TConfig, TPreset> {
  readonly id: string;
  readonly modality: EngineModality;
  discover(): Promise<AdapterDiscovery>;
  capabilities(): TCapabilities;
  presets(): readonly TPreset[];
  validateConfig(config: TConfig): AdapterValidation;
  estimateMemory(config: TConfig): AdapterMemoryEstimate;
}

/** Implement only in the trusted desktop/server process, never in a React component. */
export interface EngineAdapterRuntime<TConfig, TRequest, TResult, TTelemetry> {
  load(config: TConfig): Promise<void>;
  generate(request: TRequest, config: TConfig): Promise<TResult>;
  telemetry(): TTelemetry | null;
  benchmark?(config: TConfig): Promise<AdapterBenchmark>;
  unload(): Promise<void>;
}

export class EngineAdapterRegistry {
  readonly #definitions = new Map<string, EngineAdapterDefinition<unknown, unknown, unknown>>();

  register(definition: EngineAdapterDefinition<unknown, unknown, unknown>): void {
    if (this.#definitions.has(definition.id)) throw new Error(`Engine adapter already registered: ${definition.id}`);
    this.#definitions.set(definition.id, definition);
  }

  get(id: string): EngineAdapterDefinition<unknown, unknown, unknown> | null {
    return this.#definitions.get(id) ?? null;
  }

  list(modality?: EngineModality): EngineAdapterDefinition<unknown, unknown, unknown>[] {
    return [...this.#definitions.values()].filter((definition) => !modality || definition.modality === modality);
  }
}
