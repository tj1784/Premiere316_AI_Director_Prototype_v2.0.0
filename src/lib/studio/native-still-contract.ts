import type { NativeAdapterCapabilities, NativeGenerationValues } from "./engine-controls.ts";

export type NativeStillWorkerRequest = {
  method: "generate";
  prompt: string;
  out: string;
  width: number;
  height: number;
  seed: number;
};

export type NativeStillWorkerResult = {
  ok: boolean;
  error?: string;
  url?: string;
  engine?: string;
  model?: string;
  seed?: number;
};

export type ExecutedNativeStillSettings = {
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: number;
  scheduler: string;
  precision: string;
  outputFormat: string;
  outputBitDepth: number;
};

/** Allow-list serialization prevents renderer-only or unsupported controls reaching Python. */
export function toNativeStillWorkerRequest(input: {
  capabilities: NativeAdapterCapabilities;
  values: NativeGenerationValues;
  prompt: string;
  engineId: string;
  engineName: string;
  out: string;
  referencePaths: string[];
}): NativeStillWorkerRequest {
  const { capabilities, values } = input;
  return {
    method: "generate",
    prompt: input.prompt.trim(),
    out: input.out,
    width: capabilities.adapterId === "flux" || capabilities.adapterId === "flux2" ? 512 : integer(values.width, capabilities.controls.width.runtimeDefault),
    height: capabilities.adapterId === "flux" || capabilities.adapterId === "flux2" ? 512 : integer(values.height, capabilities.controls.height.runtimeDefault),
    seed: integer(values.seed, capabilities.controls.seed.runtimeDefault),
  };
}

/** Current worker reports seed/model identity; fixed settings come from its audited adapter schema. */
export function executedNativeStillSettings(
  capabilities: NativeAdapterCapabilities,
  request: NativeStillWorkerRequest,
  result: NativeStillWorkerResult,
): ExecutedNativeStillSettings {
  if (!result.ok) throw new Error(result.error || "Native still execution failed.");
  return {
    width: request.width,
    height: request.height,
    steps: requiredNumber(capabilities.controls.steps.runtimeDefault, "steps"),
    guidance: requiredNumber(capabilities.controls.guidance.runtimeDefault, "guidance"),
    seed: integer(result.seed, request.seed),
    scheduler: requiredString(capabilities.controls.scheduler.runtimeDefault, "scheduler"),
    precision: requiredString(capabilities.controls.precision.runtimeDefault, "precision"),
    outputFormat: requiredString(capabilities.controls.outputFormat.runtimeDefault, "output format"),
    outputBitDepth: requiredNumber(capabilities.controls.outputBitDepth.runtimeDefault, "output bit depth"),
  };
}

function integer(value: unknown, fallback: unknown): number {
  const resolved = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  if (typeof resolved !== "number" || !Number.isInteger(resolved)) throw new Error("Native worker setting must be an integer.");
  return resolved;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Adapter has no audited ${label}.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Adapter has no audited ${label}.`);
  return value;
}
