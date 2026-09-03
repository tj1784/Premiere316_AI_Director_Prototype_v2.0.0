import type { EngineConfig } from "./engine-config.ts";
import { nativeAdapterCapabilities, runtimeDefaults, type NativeAdapterCapabilities } from "./engine-controls.ts";
import { validateGenerationConfig, type GenerationValidation } from "./generation-validation.ts";
import { engineMemoryMetrics, type EngineMemoryMetrics } from "./memory-metrics.ts";

export type ConfiguredEngine = {
  config: EngineConfig;
  capabilities: NativeAdapterCapabilities | null;
  validation: GenerationValidation;
  memory: EngineMemoryMetrics;
};

/** Joins scanner output to native adapter truth without changing the 58-config mapper. */
export function configureEngine(config: EngineConfig): ConfiguredEngine {
  const capabilities = nativeAdapterCapabilities(config.adapterId, config.base.displayName);
  const validation = validateGenerationConfig(config, capabilities, capabilities ? runtimeDefaults(capabilities) : {});
  return {
    config,
    capabilities,
    validation,
    memory: engineMemoryMetrics({
      installedFamilyFootprintBytes: config.familyFootprintBytes,
      selectedConfigurationFootprintBytes: config.runtimeSizeBytes,
      // The audited worker exposes neither estimation nor measurement yet. File footprint is not relabelled as VRAM.
      estimatedVramBytes: null,
      measuredPeakVramBytes: null,
      estimatedSystemRamBytes: null,
      measuredPeakSystemRamBytes: null,
    }),
  };
}

export function compareConfiguredEngines(configs: readonly EngineConfig[]): ConfiguredEngine[] {
  return configs.map(configureEngine);
}
