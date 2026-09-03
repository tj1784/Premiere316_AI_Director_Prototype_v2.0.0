import type { AdapterBenchmark } from "./engine-adapter.ts";
import type { NativeGenerationValues } from "./engine-controls.ts";

export const CALIBRATION_PROMPT = "Premiere316 calibration frame: neutral gray studio card, even illumination";
export const CALIBRATION_SEED = 316;
export const CALIBRATION_WIDTH = 512;
export const CALIBRATION_HEIGHT = 512;

export type CalibrationRequest = {
  adapterId: string;
  configurationFingerprint: string;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  values: NativeGenerationValues;
};

export function createCalibrationRequest(adapterId: string, fingerprint: string, values: NativeGenerationValues): CalibrationRequest {
  return {
    adapterId,
    configurationFingerprint: fingerprint,
    prompt: CALIBRATION_PROMPT,
    seed: CALIBRATION_SEED,
    width: CALIBRATION_WIDTH,
    height: CALIBRATION_HEIGHT,
    values: { ...values, prompt: CALIBRATION_PROMPT, seed: CALIBRATION_SEED, randomizeSeed: false, lockSeed: true, width: CALIBRATION_WIDTH, height: CALIBRATION_HEIGHT },
  };
}

export function upsertCalibration(existing: readonly AdapterBenchmark[], result: AdapterBenchmark): AdapterBenchmark[] {
  return [
    ...existing.filter((item) => !(item.adapterId === result.adapterId && item.configurationFingerprint === result.configurationFingerprint)),
    structuredClone(result),
  ];
}

export function calibrationFor(existing: readonly AdapterBenchmark[], adapterId: string, fingerprint: string): AdapterBenchmark | null {
  return existing.find((item) => item.adapterId === adapterId && item.configurationFingerprint === fingerprint) ?? null;
}
