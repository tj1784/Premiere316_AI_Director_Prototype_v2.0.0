import type { AssetReadiness, ProductionAsset, ProductionBreakdown, ProductionCategory } from "./types.ts";

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
  return readiness.replaceAll("_", " ");
}

export function filterInventoryAssets(record: ProductionBreakdown, filter: InventoryFilter): ProductionAsset[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return record.assets.filter((asset) => {
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
