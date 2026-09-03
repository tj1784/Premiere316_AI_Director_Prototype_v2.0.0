import type { ProductionCategory } from "@/lib/production";

export const PRODUCTION_CATEGORY_LABELS: Record<ProductionCategory, string> = {
  character: "Characters",
  location: "Locations",
  wardrobe: "Wardrobe",
  hair_makeup: "Hair / Makeup",
  prop: "Props",
  creature: "Creatures",
  vehicle: "Vehicles",
  practical_effect: "Practical FX",
  vfx: "VFX",
  set_dressing: "Set Dressing",
  signage: "Signage / Text",
  voice: "Voices",
  sound: "Sound",
  music: "Music",
  continuity: "Continuity",
  other: "Other",
};
