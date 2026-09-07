import type { EngineConfig } from "./engine-config.ts";
import type { EngineControlCapability, EngineControlId, NativeAdapterCapabilities, NativeGenerationValues } from "./engine-controls.ts";
import type { EngineSpecificVideoSettings } from "./generation-config.ts";
import type { EnginePromptPackage } from "./prompt-compiler.ts";

export type GenerationReadiness = "READY" | "READY WITH WARNING" | "MISSING COMPONENT" | "INVALID CONFIGURATION" | "UNSUPPORTED" | "MEMORY RISK" | "NEEDS VALIDATION";

export type GenerationValidation = {
  state: GenerationReadiness;
  errors: string[];
  warnings: string[];
};

export function validateGenerationConfig(
  engine: EngineConfig,
  capabilities: NativeAdapterCapabilities | null,
  values: NativeGenerationValues,
  options: { estimatedPeakVramBytes?: number | null; availableVramBytes?: number | null } = {},
): GenerationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (engine.missing.length > 0) {
    return { state: "MISSING COMPONENT", errors: engine.missing.map((label) => `Missing ${label}.`), warnings };
  }
  if (!engine.adapterId || !capabilities) {
    return { state: "UNSUPPORTED", errors: ["Runtime adapter not yet implemented."], warnings };
  }
  if (engine.status !== "Ready") errors.push(`Engine is ${engine.status.toLowerCase()}.`);
  for (const [rawKey, value] of Object.entries(values)) {
    const key = rawKey as EngineControlId;
    const capability = capabilities.controls[key];
    if (!capability) {
      errors.push(`${key} is not declared by ${capabilities.modelVariant}.`);
      continue;
    }
    validateValue(capability, value, errors);
  }
  const width = numeric(values.width);
  const height = numeric(values.height);
  if (width !== null && width % 16 !== 0) errors.push("Width must be a multiple of 16.");
  if (height !== null && height % 16 !== 0) errors.push("Height must be a multiple of 16.");
  if (values.randomizeSeed === true && values.lockSeed === true) errors.push("Random seed and Lock seed cannot both be enabled.");
  if (Array.isArray(values.references) && values.references.length > 0 && !capabilities.controls.references.supported) {
    errors.push("Reference images are not supported by this native adapter.");
  }
  const estimated = options.estimatedPeakVramBytes;
  const available = options.availableVramBytes;
  if (estimated != null && available != null && estimated > available) {
    warnings.push("Estimated peak VRAM exceeds currently available VRAM; validate the placement plan locally.");
    if (errors.length === 0) return { state: "MEMORY RISK", errors, warnings };
  }
  if (errors.length > 0) return { state: "INVALID CONFIGURATION", errors, warnings };
  if (engine.base.sha256Kind === "sampled") warnings.push("Model fingerprint is sampled rather than a full-file SHA-256.");
  if (!engine.base.sha256) warnings.push("Model fingerprint has not been verified.");
  return { state: warnings.length > 0 ? "READY WITH WARNING" : "READY", errors, warnings };
}

function validateValue(capability: EngineControlCapability, value: unknown, errors: string[]) {
  if (!capability.supported) {
    errors.push(`${capability.label} is not supported by the native adapter.`);
    return;
  }
  if (!capability.perGenerationOverride && capability.runtimeDefault !== undefined && !sameValue(value, capability.runtimeDefault)) {
    errors.push(`${capability.label} is fixed at ${String(capability.runtimeDefault)} by the native adapter.`);
    return;
  }
  if (capability.kind === "number" || capability.kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${capability.label} must be a number.`);
      return;
    }
    if (capability.kind === "integer" && !Number.isInteger(value)) errors.push(`${capability.label} must be an integer.`);
    if (capability.minimum !== undefined && value < capability.minimum) errors.push(`${capability.label} must be at least ${capability.minimum}.`);
    if (capability.maximum !== undefined && value > capability.maximum) errors.push(`${capability.label} must be at most ${capability.maximum}.`);
    if (capability.step && capability.minimum !== undefined && Math.abs((value - capability.minimum) / capability.step - Math.round((value - capability.minimum) / capability.step)) > 1e-9) {
      errors.push(`${capability.label} must use increments of ${capability.step}.`);
    }
  }
  if (capability.allowedValues?.length && !capability.allowedValues.some((item) => sameValue(item.value, value))) {
    errors.push(`${capability.label} must be one of the adapter's allowed values.`);
  }
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => value === b[index])
    : Object.is(a, b);
}

export type EnginePromptValidation = {
  ok: boolean;
  warnings: string[];
  blockers: string[];
};

export function validateEnginePromptPackage(pkg: EnginePromptPackage): EnginePromptValidation {
  const warnings = [...pkg.validationWarnings];
  const blockers: string[] = [];
  if (!pkg.enginePrompt.trim()) blockers.push("Compiled engine prompt is empty.");
  if (!pkg.shotSummary.trim()) blockers.push("Shot summary is missing.");
  if (pkg.durationSec < 1 || pkg.durationSec > 15) blockers.push("Duration must be between 1 and 15 seconds.");
  if (![24, 25, 30].includes(pkg.fps)) blockers.push("FPS must be 24, 25, or 30.");
  if (pkg.resolution.width < 256 || pkg.resolution.height < 256) blockers.push("Resolution is below the minimum native draft size.");
  if ((pkg.engineTarget === "minimax-h3" || pkg.engineTarget === "ltx-2.5") && !pkg.actionTimeline.trim()) {
    warnings.push("Action timeline is thin; motion may be under-specified.");
  }
  return { ok: blockers.length === 0, warnings, blockers };
}

export function validateVideoSettings(settings: EngineSpecificVideoSettings): EnginePromptValidation {
  const warnings: string[] = [];
  const blockers: string[] = [];
  if (settings.durationSec < 1 || settings.durationSec > 15) blockers.push("Video duration must be 1–15 seconds.");
  if (settings.fps !== 24) warnings.push("Wave 5 native draft assumes 24 fps.");
  if (settings.motionIntensity < 0 || settings.motionIntensity > 1) blockers.push("Motion intensity must be 0–1.");
  return { ok: blockers.length === 0, warnings, blockers };
}
