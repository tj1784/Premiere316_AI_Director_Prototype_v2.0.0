import { createProductionBreakdown } from "./breakdown.ts";
import type { BreakdownRequirementDraft, ProductionBreakdown } from "./types.ts";

export type LegacyPicture = {
  id: string;
  title: string;
  screenplayFountain: string;
  updatedAt: number;
  scenes: { id: string; slugline: string; summary?: string }[];
  characters: { id: string; name: string; role?: string; age?: string; look?: string; voiceId?: string }[];
  locations: { id: string; name: string; description: string; lighting?: string }[];
  props: { id: string; name: string; description: string }[];
  wardrobe: { id: string; name: string; description: string }[];
  vfx: { id: string; name: string; description: string }[];
  voices: { id: string; character: string; text: string }[];
  cues: { id: string; name: string; mood: string; instruments: string; sfx: string }[];
};

export function migrateLegacyPictureToProduction(picture: LegacyPicture, now = Date.now()): ProductionBreakdown {
  const sceneIds = picture.scenes.map((scene) => scene.id);
  if (!sceneIds.length) throw new Error("Legacy picture needs scenes before production migration.");
  const requirement = (
    id: string,
    category: BreakdownRequirementDraft["category"],
    name: string,
    description: string,
    extra: Partial<BreakdownRequirementDraft> = {},
  ): BreakdownRequirementDraft => ({ id: `legacy:${id}`, category, name, description, sceneIds, ...extra });
  const drafts: BreakdownRequirementDraft[] = [
    ...picture.characters.map((item) => requirement(item.id, "character", item.name, [item.role, item.age, item.look].filter(Boolean).join(" · "))),
    ...picture.locations.map((item) => requirement(item.id, "location", item.name, [item.description, item.lighting].filter(Boolean).join(" · "))),
    ...picture.props.map((item) => requirement(item.id, "prop", item.name, item.description)),
    ...picture.wardrobe.map((item) => requirement(item.id, "wardrobe", item.name, item.description)),
    ...picture.vfx.map((item) => requirement(item.id, "vfx", item.name, item.description)),
    ...picture.voices.map((item) => requirement(item.id, "voice", item.character, item.text)),
    ...picture.cues.flatMap((item) => [
      requirement(`${item.id}:music`, "music", item.name, `${item.mood} · ${item.instruments}`),
      requirement(`${item.id}:sound`, "sound", `${item.name} sound`, item.sfx),
    ]),
  ];
  const versionId = `legacy-approved:${picture.id}:${picture.updatedAt}`;
  const record = createProductionBreakdown({
    pictureId: picture.id,
    versionId,
    status: "APPROVED",
    fountain: picture.screenplayFountain || `Title: ${picture.title}\n\n${picture.scenes.map((scene) => scene.slugline).join("\n\n")}`,
    scenes: picture.scenes,
    socialWorld: [],
  }, drafts, now);
  return {
    ...record,
    assets: record.assets.map((asset) => ({
      ...asset,
      provenance: asset.provenance.map((entry) => ({ ...entry, sourceType: "legacy-migration" as const })),
    })),
  };
}
