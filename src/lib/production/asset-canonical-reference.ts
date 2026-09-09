import type { AssetReference, GeneratedIteration, ProductionAsset, ProductionBreakdown } from "./types.ts";

/** A spec approval or dangling iteration ID does not establish an approved image. */
export function approvedAssetMedia(asset: ProductionAsset): GeneratedIteration | null {
  if (asset.tombstone || asset.stale || !asset.canonicalApproved || !asset.approvedIterationId) return null;
  const iteration = asset.iterations.find((item) => item.id === asset.approvedIterationId);
  if (!iteration || iteration.status !== "APPROVED" || !iteration.mediaUri?.trim()) return null;
  if (iteration.specVersionId && asset.approvedSpecVersionId && iteration.specVersionId !== asset.approvedSpecVersionId) return null;
  return iteration;
}

export function canonicalParents(record: ProductionBreakdown | null | undefined, assetId: string): Array<{ id: string; asset: ProductionAsset | null; media: GeneratedIteration | null }> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    for (const edge of record?.dependencies ?? []) {
      if (edge.fromType !== "asset" || edge.toType !== "asset" || edge.toId !== id || edge.fromId === assetId || ids.has(edge.fromId)) continue;
      ids.add(edge.fromId);
      visit(edge.fromId);
    }
  };
  visit(assetId);
  return [...ids].map((id) => {
    const asset = record?.assets.find((item) => item.id === id) ?? null;
    return { id, asset, media: asset ? approvedAssetMedia(asset) : null };
  });
}

/** Derive stable parent references before preparation so the worker seals the
 * same canonical image revision used by the prompt and freshness check. */
export function assetGenerationReferences(record: ProductionBreakdown | null | undefined, asset: ProductionAsset): AssetReference[] {
  const references = asset.references.filter((reference) => !reference.id.startsWith("canonical-parent:"));
  for (const parent of canonicalParents(record, asset.id)) {
    if (!parent.media || !parent.asset) continue;
    references.push({
      id: `canonical-parent:${parent.id}`, name: `${parent.asset.name} — approved canonical identity (${parent.media.id})`,
      uri: parent.media.mediaUri, mediaType: "image/png", preferred: false, uploadedAt: parent.media.createdAt,
      provenance: { sourceType: "user", screenplayVersionId: record?.screenplayVersionId ?? "", sceneIds: asset.requiredSceneIds,
        evidenceNote: `Approved canonical asset ${parent.id}; iteration ${parent.media.id}.${parent.media.mediaSha256 ? ` SHA-256: ${parent.media.mediaSha256}` : ""}`,
        createdAt: parent.media.createdAt,
      },
    });
  }
  return references;
}
