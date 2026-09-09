import type { ProductionCategory } from "../production/types.ts";

export const ASSET_REVIEW_GROUPS = [
  { id: "characters", label: "Characters", categories: ["character"] },
  { id: "artifacts", label: "Artifacts", categories: ["prop", "wardrobe", "hair_makeup", "vehicle", "set_dressing", "signage"] },
  { id: "locations", label: "Locations", categories: ["location"] },
  { id: "voice", label: "Voice", categories: ["voice"] },
  { id: "creatures", label: "Creatures", categories: ["creature"] },
  { id: "effects", label: "Effects", categories: ["practical_effect", "vfx"] },
  { id: "sound", label: "Sound", categories: ["sound"] },
  { id: "music", label: "Music", categories: ["music"] },
  { id: "other", label: "Other", categories: ["continuity", "other"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; categories: ReadonlyArray<ProductionCategory> }>;

export function assetReviewGroup(category: ProductionCategory) {
  return ASSET_REVIEW_GROUPS.find((group) => (group.categories as readonly string[]).includes(category))!;
}
