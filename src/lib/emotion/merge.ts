import type { PerformanceSettings, WinningScope } from "./types.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRegional(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return value.mode === "inherit" || value.mode === "omit" || value.mode === "replace";
}

export function mergeSettings<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const regional = isRegional(value);
    const existing = result[key];
    if (isPlainObject(value) && isPlainObject(existing) && !regional) {
      result[key] = mergeSettings(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function mergeWithTrace(
  base: Record<string, unknown>,
  overlay: PerformanceSettings,
  scope: WinningScope,
  trace: Record<string, WinningScope>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const regional = isRegional(value);
    const existing = result[key];
    if (isPlainObject(value) && isPlainObject(existing) && !regional) {
      result[key] = mergeSettings(existing, value);
    } else {
      result[key] = value;
    }
    trace[key] = scope;
  }
  return result;
}
