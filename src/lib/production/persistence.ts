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
    const allowedQueueStates = new Set(["PLANNED", "PREFLIGHTED", "READY", "BLOCKED", "WAITING_FOR_REFERENCE", "APPROVED_PREPARED"]);
    return parsed.records.map((record) => sanitizeProductionBreakdown(record, allowedQueueStates)).filter((record): record is ProductionBreakdown => Boolean(record));
  } catch {
    return [];
  }
}

export function sanitizeProductionBreakdown(value: unknown, allowedStates = new Set(["PLANNED", "PREFLIGHTED", "READY", "BLOCKED", "WAITING_FOR_REFERENCE", "APPROVED_PREPARED"])): ProductionBreakdown | null {
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
    graph: candidate.graph ?? null,
    sourceBoundary: candidate.sourceBoundary ?? null,
    inventoryVersion: Number.isFinite(candidate.inventoryVersion) ? candidate.inventoryVersion : 1,
    approvals: Array.isArray(candidate.approvals) ? candidate.approvals : [],
    auditLog: Array.isArray(candidate.auditLog) ? candidate.auditLog : [],
    preparedAssets: Array.isArray(candidate.preparedAssets) ? candidate.preparedAssets : [],
    assets: candidate.assets.map((asset) => ({
      ...asset,
      specVersions: Array.isArray(asset.specVersions) ? asset.specVersions : [],
      approvedSpecVersionId: asset.approvedSpecVersionId ?? null,
      aliasesOf: Array.isArray(asset.aliasesOf) ? asset.aliasesOf : [],
      tombstone: Boolean(asset.tombstone),
      lineage: Array.isArray(asset.lineage) ? asset.lineage : [],
      conflicts: Array.isArray(asset.conflicts) ? asset.conflicts : [],
    })),
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
