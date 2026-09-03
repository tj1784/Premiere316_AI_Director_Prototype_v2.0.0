import type { PlacementPlan } from "./residency.ts";

export type ExecutedLora = { id: string; path?: string; fingerprint?: string; weight: number };
export type ExecutedReference = { id: string; fingerprint?: string; strength?: number };

export type GenerationTelemetry = {
  modelLoadMs: number | null;
  inferenceMs: number | null;
  totalMs: number;
  peakVramBytes: number | null;
  peakSystemRamBytes: number | null;
  residentBeforeJob: boolean;
  residentAfterJob: boolean;
};

export type GenerationProvenance = Readonly<{
  schemaVersion: 1;
  assetId: string;
  engineId: string;
  engineName: string;
  runtimeAdapter: string;
  runtimeImplementation: string;
  baseCheckpoint: { id: string; path: string; fingerprint: string | null; fingerprintKind: "full" | "sampled" | null };
  components: ReadonlyArray<{ role: string; id: string; path: string; fingerprint: string | null }>;
  loras: ReadonlyArray<ExecutedLora>;
  prompt: string;
  enhancedPrompt: string | null;
  references: ReadonlyArray<ExecutedReference>;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number;
  scheduler: string;
  timestepData: ReadonlyArray<number> | null;
  precision: string;
  outputFormat: string;
  outputBitDepth: number;
  placementPlan: PlacementPlan | null;
  generatedAt: string;
  applicationVersion: string;
  telemetry: Readonly<GenerationTelemetry>;
}>;

export type ActualExecutionRecord = Omit<GenerationProvenance, "schemaVersion">;

/** Construct provenance only from the adapter's executed-result record, never from pending UI state. */
export function createGenerationProvenance(actual: ActualExecutionRecord): GenerationProvenance {
  if (!actual.engineId || !actual.runtimeAdapter || !actual.baseCheckpoint.path) throw new Error("Incomplete actual execution identity.");
  if (!Number.isInteger(actual.seed) || actual.seed < 0) throw new Error("Actual execution seed is invalid.");
  if (actual.width <= 0 || actual.height <= 0 || actual.steps <= 0) throw new Error("Actual execution dimensions or step count are invalid.");
  return deepFreeze({ schemaVersion: 1 as const, ...clone(actual) });
}

export function telemetryFromWorker(
  result: Partial<GenerationTelemetry>,
  fallbackTotalMs: number,
): GenerationTelemetry {
  return {
    modelLoadMs: finiteOrNull(result.modelLoadMs),
    inferenceMs: finiteOrNull(result.inferenceMs),
    totalMs: finiteOrNull(result.totalMs) ?? Math.max(0, fallbackTotalMs),
    peakVramBytes: finiteOrNull(result.peakVramBytes),
    peakSystemRamBytes: finiteOrNull(result.peakSystemRamBytes),
    residentBeforeJob: result.residentBeforeJob === true,
    residentAfterJob: result.residentAfterJob === true,
  };
}

export function serializeGenerationProvenance(provenance: GenerationProvenance): string {
  return `${JSON.stringify(provenance, null, 2)}\n`;
}

export function provenanceSidecarName(imageFileName: string): string {
  return `${imageFileName.replace(/\.[^.]+$/, "")}.provenance.json`;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
