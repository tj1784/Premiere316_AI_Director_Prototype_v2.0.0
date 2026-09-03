export type EngineMemoryMetrics = {
  installedFamilyFootprintBytes: number;
  selectedConfigurationFootprintBytes: number;
  estimatedVramBytes: number | null;
  measuredPeakVramBytes: number | null;
  estimatedSystemRamBytes: number | null;
  measuredPeakSystemRamBytes: number | null;
};

export const MEMORY_LABELS: Record<keyof EngineMemoryMetrics, string> = {
  installedFamilyFootprintBytes: "Installed family footprint",
  selectedConfigurationFootprintBytes: "Selected configuration footprint",
  estimatedVramBytes: "Estimated VRAM",
  measuredPeakVramBytes: "Measured peak VRAM",
  estimatedSystemRamBytes: "Estimated system RAM",
  measuredPeakSystemRamBytes: "Measured peak system RAM",
};

export function engineMemoryMetrics(input: EngineMemoryMetrics): EngineMemoryMetrics {
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`${key} must be a non-negative byte count or null.`);
  }
  return { ...input };
}

export function measuredMemoryAvailable(metrics: EngineMemoryMetrics): boolean {
  return metrics.measuredPeakVramBytes !== null || metrics.measuredPeakSystemRamBytes !== null;
}
