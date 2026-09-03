import type { ProductionBreakdown } from "./types.ts";

export const PRODUCTION_PERSISTENCE_KEY = "premiere316-production-breakdown-v1";

export function serializeProductionBreakdowns(records: ProductionBreakdown[]): string {
  return JSON.stringify({ schemaVersion: 1, records });
}

export function parseProductionBreakdowns(raw: string | null): ProductionBreakdown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: number; records?: unknown };
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) return [];
    const allowedQueueStates = new Set(["PLANNED", "PREFLIGHTED", "READY", "BLOCKED", "WAITING_FOR_REFERENCE"]);
    return parsed.records.map((record) => sanitizeProductionBreakdown(record, allowedQueueStates)).filter((record): record is ProductionBreakdown => Boolean(record));
  } catch {
    return [];
  }
}

export function sanitizeProductionBreakdown(value: unknown, allowedStates = new Set(["PLANNED", "PREFLIGHTED", "READY", "BLOCKED", "WAITING_FOR_REFERENCE"])): ProductionBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProductionBreakdown>;
  if (candidate.schemaVersion !== 1
    || typeof candidate.pictureId !== "string"
    || typeof candidate.screenplayVersionId !== "string"
    || !Array.isArray(candidate.assets)
    || !Array.isArray(candidate.requirements)
    || !Array.isArray(candidate.queue)
    || !Array.isArray(candidate.scenes)
    || !Array.isArray(candidate.dependencies)) return null;
  return {
    ...candidate,
    queue: candidate.queue.filter((item) => allowedStates.has(String(item?.status))),
  } as ProductionBreakdown;
}

export type ProductionPersistence = {
  load: () => ProductionBreakdown[];
  save: (records: ProductionBreakdown[]) => void;
};

export function createLocalStorageProductionPersistence(storage: Pick<Storage, "getItem" | "setItem">): ProductionPersistence {
  return {
    load: () => parseProductionBreakdowns(storage.getItem(PRODUCTION_PERSISTENCE_KEY)),
    save: (records) => storage.setItem(PRODUCTION_PERSISTENCE_KEY, serializeProductionBreakdowns(records)),
  };
}
