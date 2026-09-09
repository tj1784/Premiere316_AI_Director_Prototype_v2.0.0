type AssetManifest = { adapterId: string; modelVariant: string; status: string; disabledReason?: string | null };

export function selectAssetEngine<T extends AssetManifest>(selectedId: string, manifests: T[]): T {
  const matching = manifests.filter((item) => item.adapterId === selectedId);
  if (matching.length !== 1) throw new Error(`Selected image engine ${selectedId} does not resolve to one exact local model.`);
  const selected = matching[0];
  if (selected.status !== "READY") throw new Error(`${selected.modelVariant}: ${selected.disabledReason || selected.status}`);
  return selected;
}
