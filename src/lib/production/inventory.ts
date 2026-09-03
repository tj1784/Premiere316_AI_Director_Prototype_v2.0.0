import { calculateReadiness, normalizeAssetName } from "./breakdown.ts";
import { buildDependencyGraphV2, sourceFingerprint } from "./dependency-graph.ts";
import type { AssetReadiness, AssetReference, CanonicalAssetSpec, PreparedAssetRecord, ProductionAsset, ProductionBreakdown, ProductionCategory } from "./types.ts";

export type InventoryFilter = {
  category: "all" | ProductionCategory;
  readiness: "all" | AssetReadiness;
  query: string;
};

export type InventoryCard = {
  id: string;
  name: string;
  category: ProductionCategory;
  readiness: AssetReadiness;
  readinessLabel: string;
  sceneCount: number;
  sceneLabels: string[];
  variantCount: number;
  previewUri: string | null;
  canonicalApproved: boolean;
};

export function readinessLabel(readiness: AssetReadiness): string {
  if (readiness === "NOT_PREPARED") return "MISSING";
  if (readiness === "READY_TO_GENERATE") return "READY TO PREPARE";
  if (readiness === "APPROVED") return "APPROVED PREPARED";
  return readiness.replaceAll("_", " ");
}

export function filterInventoryAssets(record: ProductionBreakdown, filter: InventoryFilter): ProductionAsset[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return record.assets.filter((asset) => {
    if (asset.tombstone) return false;
    if (filter.category !== "all" && asset.category !== filter.category) return false;
    if (filter.readiness !== "all" && asset.readiness !== filter.readiness) return false;
    if (!query) return true;
    return [asset.name, asset.category, asset.canonicalSpec.visualDescription, ...asset.aliases]
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export function inventoryCards(record: ProductionBreakdown, filter: InventoryFilter): InventoryCard[] {
  const sceneMap = new Map(record.scenes.map((scene) => [scene.id, scene.slugline]));
  return filterInventoryAssets(record, filter).map((asset) => {
    const approved = asset.iterations.find((iteration) => iteration.id === asset.approvedIterationId);
    const preferred = asset.references.find((reference) => reference.preferred) ?? asset.references[0];
    return {
      id: asset.id,
      name: asset.name,
      category: asset.category,
      readiness: asset.readiness,
      readinessLabel: readinessLabel(asset.readiness),
      sceneCount: asset.requiredSceneIds.length,
      sceneLabels: asset.requiredSceneIds.map((id) => sceneMap.get(id) ?? id),
      variantCount: asset.variants.length,
      previewUri: approved?.mediaUri ?? preferred?.uri ?? null,
      canonicalApproved: asset.canonicalApproved,
    };
  });
}

function bump(record: ProductionBreakdown): number {
  return (record.inventoryVersion ?? 1) + 1;
}

type LineageType = NonNullable<ProductionAsset["lineage"]>[number]["type"];
function audit(id: string, type: LineageType, at: number, sourceAssetIds: string[], targetAssetIds: string[], reason: string) {
  return { id: `lineage:${type}:${id}:${at}`, type, at, sourceAssetIds, targetAssetIds, reason };
}

export type InventoryAssetPatch = {
  name?: string;
  category?: ProductionCategory;
  canonicalSpec?: Partial<CanonicalAssetSpec>;
  referenceRequired?: boolean;
  hero?: boolean;
  blockedReasons?: string[];
};

export function editInventoryAsset(record: ProductionBreakdown, assetId: string, patch: InventoryAssetPatch, now = Date.now()): ProductionBreakdown {
  const assets = record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const currentVersions = asset.specVersions ?? [];
    const approvedVersionId = asset.approvedSpecVersionId ?? (asset.canonicalApproved ? `spec:${asset.id}:approved:legacy` : null);
    const frozenApproved = approvedVersionId && !currentVersions.some((version) => version.id === approvedVersionId)
      ? [{ id: approvedVersionId, assetId: asset.id, createdAt: asset.updatedAt, sourceVersionId: null, spec: structuredClone(asset.canonicalSpec), approved: true, provenance: asset.provenance }]
      : [];
    const nextSpec = { ...asset.canonicalSpec, ...patch.canonicalSpec };
    const category = patch.category ?? asset.category;
    const name = patch.name?.trim() || asset.name;
    const version = { id: `spec:${asset.id}:${now}`, assetId: asset.id, createdAt: now, sourceVersionId: approvedVersionId, spec: structuredClone(nextSpec), approved: false, provenance: asset.provenance };
    const next = {
      ...asset,
      name,
      category,
      normalizedKey: `${category}:${normalizeAssetName(name, category)}`,
      hero: patch.hero ?? asset.hero,
      blockedReasons: patch.blockedReasons ?? asset.blockedReasons,
      canonicalSpec: nextSpec,
      referenceRequired: patch.referenceRequired ?? asset.referenceRequired,
      canonicalApproved: false,
      approvedSpecVersionId: null,
      specVersions: [...frozenApproved, ...currentVersions, version],
      lineage: [...(asset.lineage ?? []), audit(asset.id, "edited", now, [asset.id], [asset.id], "Asset spec edited")],
      updatedAt: now,
    };
    return { ...next, readiness: calculateReadiness(next) };
  });
  const next = { ...record, assets, inventoryVersion: bump(record), updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function approveInventoryAssetSpec(record: ProductionBreakdown, assetId: string, now = Date.now()): ProductionBreakdown {
  const assets = record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const draft = [...(asset.specVersions ?? [])].reverse().find((version) => !version.approved) ?? { id: `spec:${asset.id}:${now}`, assetId: asset.id, createdAt: now, sourceVersionId: asset.approvedSpecVersionId ?? null, spec: asset.canonicalSpec, approved: false, provenance: asset.provenance };
    const approved = { ...draft, spec: structuredClone(draft.spec), approved: true };
    const versions = [...(asset.specVersions ?? []).filter((version) => version.id !== draft.id), approved];
    const next = { ...asset, canonicalSpec: structuredClone(approved.spec), specVersions: versions, approvedSpecVersionId: approved.id, canonicalApproved: true, lineage: [...(asset.lineage ?? []), audit(asset.id, "approved-spec", now, [asset.id], [asset.id], "Canonical asset spec approved")], updatedAt: now };
    return { ...next, readiness: calculateReadiness(next) };
  });
  const next = { ...record, assets, inventoryVersion: bump(record), approvals: [...(record.approvals ?? []), audit(assetId, "approved-spec", now, [assetId], [assetId], "Approved spec")], updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function mergeInventoryAssets(record: ProductionBreakdown, targetId: string, sourceIds: string[], now = Date.now()): ProductionBreakdown {
  const target = record.assets.find((asset) => asset.id === targetId);
  if (!target) return record;
  const sources = record.assets.filter((asset) => sourceIds.includes(asset.id) && asset.id !== targetId);
  const conflict = sources.some((asset) => asset.canonicalApproved && target.canonicalApproved);
  const assets = record.assets.map((asset) => {
    if (asset.id === targetId) {
      const next = { ...asset, aliases: [...new Set([...asset.aliases, ...sources.map((item) => item.name), ...sources.flatMap((item) => item.aliases)])], requirementIds: [...new Set([...asset.requirementIds, ...sources.flatMap((item) => item.requirementIds)])], requiredSceneIds: [...new Set([...asset.requiredSceneIds, ...sources.flatMap((item) => item.requiredSceneIds)])], socialWorldIds: [...new Set([...asset.socialWorldIds, ...sources.flatMap((item) => item.socialWorldIds)])], references: [...asset.references, ...sources.flatMap((item) => item.references)], variants: [...asset.variants, ...sources.flatMap((item) => item.variants)], provenance: [...asset.provenance, ...sources.flatMap((item) => item.provenance)], conflicts: conflict ? [...(asset.conflicts ?? []), { id: `conflict:merge:${now}`, severity: "warning" as const, message: "Merged assets both had approved identity specs; review merged identity before preparation.", sourceIds: sources.map((item) => item.id), resolved: false }] : (asset.conflicts ?? []), lineage: [...(asset.lineage ?? []), audit(asset.id, "merged", now, sources.map((item) => item.id), [asset.id], "Inventory merge")], updatedAt: now };
      return { ...next, readiness: calculateReadiness(next) };
    }
    if (sourceIds.includes(asset.id)) return { ...asset, tombstone: true, aliasesOf: [targetId], readiness: "STALE" as const, lineage: [...(asset.lineage ?? []), audit(asset.id, "merged", now, [asset.id], [targetId], "Merged into target asset")], updatedAt: now };
    return asset;
  });
  const next = { ...record, assets, inventoryVersion: bump(record), auditLog: [...(record.auditLog ?? []), audit(targetId, "merged", now, sourceIds, [targetId], "Inventory merge")], updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function splitInventoryAsset(record: ProductionBreakdown, assetId: string, split: { newAssetId: string; name: string; requirementIds: string[]; copyReferences?: boolean }, now = Date.now()): ProductionBreakdown {
  const source = record.assets.find((asset) => asset.id === assetId);
  if (!source) return record;
  const moved = new Set(split.requirementIds);
  const child: ProductionAsset = { ...source, id: split.newAssetId, name: split.name.trim() || `${source.name} split`, aliases: [], requirementIds: source.requirementIds.filter((id) => moved.has(id)), references: split.copyReferences ? source.references : [], variants: source.variants.filter((variant) => variant.requirementIds.some((id) => moved.has(id))), lineage: [audit(split.newAssetId, "split", now, [assetId], [split.newAssetId], "Split from source asset")], approvedSpecVersionId: null, canonicalApproved: false, updatedAt: now };
  child.readiness = calculateReadiness(child);
  const assets = record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const base = { ...asset, requirementIds: asset.requirementIds.filter((id) => !moved.has(id)), lineage: [...(asset.lineage ?? []), audit(asset.id, "split", now, [asset.id], [asset.id, split.newAssetId], "Split requirements to new asset")], updatedAt: now };
    return { ...base, readiness: calculateReadiness(base) };
  }).concat(child);
  const next = { ...record, assets, inventoryVersion: bump(record), auditLog: [...(record.auditLog ?? []), audit(assetId, "split", now, [assetId], [split.newAssetId], "Inventory split")], updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function linkAssetReference(record: ProductionBreakdown, assetId: string, reference: AssetReference, now = Date.now()): ProductionBreakdown {
  const assets = record.assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    const refs = reference.preferred ? asset.references.map((item) => ({ ...item, preferred: false })) : asset.references;
    const next = { ...asset, references: [...refs, reference], lineage: [...(asset.lineage ?? []), audit(reference.id, "reference-linked", now, [asset.id], [reference.id], "Reference linked")], updatedAt: now };
    return { ...next, readiness: calculateReadiness(next) };
  });
  const next = { ...record, assets, inventoryVersion: bump(record), updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}

export function prepareAssetRecords(record: ProductionBreakdown, visualBibleVersionIds: string[] = [], cinematographyPlanIds: string[] = [], now = Date.now()): ProductionBreakdown {
  const preparedAssets: PreparedAssetRecord[] = record.assets.filter((asset) => !asset.tombstone).map((asset) => {
    const specVersionId = asset.approvedSpecVersionId ?? null;
    const blockers = [!specVersionId ? "Approve asset spec before preparation." : "", asset.referenceRequired && !asset.references.length ? "Required reference is missing." : "", !visualBibleVersionIds.length ? "Approved visual-development bible is required." : "", !cinematographyPlanIds.length ? "Approved cinematography plan is required." : ""].filter(Boolean);
    return { id: `prepared:${asset.id}`, assetId: asset.id, variantId: null, specVersionId, visualBibleVersionIds, cinematographyPlanIds, status: blockers.length ? "BLOCKED" : "APPROVED_PREPARED", blockers, promptIngredients: [asset.name, asset.canonicalSpec.visualDescription, ...asset.canonicalSpec.continuityLocks].filter(Boolean), negativeRequirements: asset.canonicalSpec.negativeRequirements, referenceIds: asset.references.map((reference) => reference.id), dependencyFingerprints: [sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId: specVersionId, content: asset.canonicalSpec, approvedAt: asset.updatedAt, immutableBoundary: Boolean(specVersionId) })], noGeneration: true, createdAt: now, approvedAt: blockers.length ? null : now };
  });
  const next = { ...record, preparedAssets, inventoryVersion: bump(record), updatedAt: now };
  return { ...next, graph: buildDependencyGraphV2(next, now) };
}
