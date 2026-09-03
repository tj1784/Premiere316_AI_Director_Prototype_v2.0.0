import {
  runtimeDefaults,
  type EngineControlId,
  type EngineControlValue,
  type NativeAdapterCapabilities,
  type NativeGenerationValues,
  type QualityPresetId,
} from "./engine-controls.ts";

export type GenerationConfigLayer = {
  scope: "project" | "scene" | "shot" | "generation";
  scopeId: string;
  values: NativeGenerationValues;
};

export type ResolvedGenerationConfig = {
  values: NativeGenerationValues;
  sources: Partial<Record<EngineControlId, "engine" | GenerationConfigLayer["scope"]>>;
};

export type SavedEnginePreset = {
  id: string;
  label: string;
  description: string;
  values: NativeGenerationValues;
  userDefined: true;
};

export function diffGenerationValues(base: NativeGenerationValues, desired: NativeGenerationValues): NativeGenerationValues {
  const diff: NativeGenerationValues = {};
  for (const [rawKey, value] of Object.entries(desired)) {
    const key = rawKey as EngineControlId;
    if (!sameValue(base[key], value)) diff[key] = cloneValue(value);
  }
  return diff;
}

export function resolveGenerationConfig(
  engine: NativeGenerationValues,
  layers: GenerationConfigLayer[],
): ResolvedGenerationConfig {
  const values: NativeGenerationValues = {};
  const sources: ResolvedGenerationConfig["sources"] = {};
  for (const [rawKey, value] of Object.entries(engine)) {
    const key = rawKey as EngineControlId;
    values[key] = cloneValue(value);
    sources[key] = "engine";
  }
  for (const layer of layers) {
    for (const [rawKey, value] of Object.entries(layer.values)) {
      const key = rawKey as EngineControlId;
      values[key] = cloneValue(value);
      sources[key] = layer.scope;
    }
  }
  return { values, sources };
}

export function setLayerValue(
  inherited: NativeGenerationValues,
  currentDiff: NativeGenerationValues,
  key: EngineControlId,
  value: EngineControlValue,
): NativeGenerationValues {
  const next = { ...currentDiff, [key]: cloneValue(value) };
  if (sameValue(inherited[key], value)) delete next[key];
  return next;
}

export function resetToProject(layers: GenerationConfigLayer[]): GenerationConfigLayer[] {
  return layers.filter((layer) => layer.scope === "project");
}

export function resetToEngineDefault(): GenerationConfigLayer[] {
  return [];
}

export function saveAsProjectDefault(
  engineDefaults: NativeGenerationValues,
  resolved: NativeGenerationValues,
  projectId: string,
): GenerationConfigLayer {
  return { scope: "project", scopeId: projectId, values: diffGenerationValues(engineDefaults, resolved) };
}

export function applyQualityPreset(
  capabilities: NativeAdapterCapabilities,
  current: NativeGenerationValues,
  presetId: Exclude<QualityPresetId, "custom">,
): NativeGenerationValues {
  const preset = capabilities.presets.find((item) => item.id === presetId);
  if (!preset) return { ...current, qualityPreset: "custom" };
  return { ...current, ...preset.values, qualityPreset: preset.id };
}

export function markCustomWhenPresetValueChanges(
  capabilities: NativeAdapterCapabilities,
  current: NativeGenerationValues,
  key: EngineControlId,
  value: EngineControlValue,
): NativeGenerationValues {
  const next = { ...current, [key]: cloneValue(value) };
  if (key === "qualityPreset") return next;
  const selected = capabilities.presets.find((preset) => preset.id === current.qualityPreset);
  if (selected && key in selected.values && !sameValue(selected.values[key], value)) next.qualityPreset = "custom";
  return next;
}

export function saveEnginePreset(name: string, values: NativeGenerationValues): SavedEnginePreset {
  const id = `user:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset"}`;
  return { id, label: name.trim() || "Untitled preset", description: "User engine preset", values: { ...values, qualityPreset: "custom" }, userDefined: true };
}

export function initialGenerationValues(capabilities: NativeAdapterCapabilities): NativeGenerationValues {
  return applyQualityPreset(capabilities, runtimeDefaults(capabilities), "production");
}

function cloneValue<T>(value: T): T {
  return Array.isArray(value) ? [...value] as T : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => value === b[index])
    : Object.is(a, b);
}
