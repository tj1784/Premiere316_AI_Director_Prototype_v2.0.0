import type { Picture } from "./types.ts";
import type { ProductionAsset } from "../production/types.ts";
import { parseScreenplayHierarchy, sceneNodes } from "./screenplay-hierarchy.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { getGlobalProductionInstructions } from "./production-instructions.ts";

export type AssetPromptSource = { prompt: string; tokenCount: number; contextHash: string; sceneIds: string[]; sourceQuote: string; modelId: string; generatedAt: number; imageEngineId?: string; tokenizerModel?: string };
export const isVisualAsset = (asset: { category: string; tombstone?: boolean }) => !asset.tombstone && !["voice", "sound", "music", "continuity", "other"].includes(asset.category);

export const CHARACTER_IDENTITY_SHEET_CONTRACT = {
  kind: "character-identity-sheet",
  version: 3,
  purpose: "A photorealistic character reference sheet collage that makes one character's face, identity and costume clearly reviewable.",
  layout: "A wide landscape character turnaround sheet in TWO ROWS, following the supplied layout example. The upper row occupies roughly two thirds of the height and contains FIVE evenly spaced full-body views of the SAME individual: front, left three-quarter, true side profile, right three-quarter and rear. Show every figure from the top of the head to the soles of the feet at consistent scale. The lower row is a separate clearly aligned strip of FIVE large head-and-shoulders facial close-ups: front, both three-quarter angles and both profiles. Faces must be clearly readable. Ten views total; not a four-quadrant collage or one dramatic scene.",
  background: "Plain neutral grey background in every panel, with consistent soft, clear, even illumination and readable facial detail.",
  pose: "Relaxed neutral posture, arms comfortably near the body, unobscured face and calm readable expression. Keep costume and any necessary identity props visible without covering the face.",
  continuity: "Keep the same age, facial geometry, skin, eyes, hair, beard, build, garment cut, fabric, colors, patterns and wear across all views. Preserve the film's cinematic realism and faithful wardrobe/material palette. This identity presentation replaces scene action, scenic backgrounds and dramatic scene lighting; do not stage a hero scene, fire behind the head, raised arms or crowds.",
  referenceRoles: "A costume reference guides garment construction, fabric, colors and pattern only. An illustration or cartoon garment reference must not turn the face or rendering into a cartoon or supply a different person's age or identity. Use a reference for facial identity only when its stated role explicitly identifies it as a portrait reference. The screenplay, character bible and explicit user corrections remain the identity authority.",
} as const;

export function assertCharacterSheetPrompt(prompt: string): void {
  // Model prose commonly uses non-breaking or typographic hyphens.
  const normalized = prompt.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-");
  const required = [
    ["plain grey background", /\b(?:grey|gray)\b/i],
    ["character turnaround sheet", /\b(?:collage|sheet)\b/i],
    ["large face close-up", /\bclose[\s-]?ups?\b/i],
    ["profile view", /\bprofiles?\b/i],
    ["full-body view", /\bfull[\s-]?body\b/i],
    ["rear view", /\b(?:rear|back)\b/i],
    ["upper turnaround row", /\b(?:upper|top|first)\b/i],
    ["lower facial close-up row", /\b(?:lower|bottom|second)\b/i],
  ] as const;
  const missing = required.filter(([, pattern]) => !pattern.test(normalized)).map(([label]) => label);
  if (missing.length) throw new Error(`Character-sheet prompt omitted: ${missing.join(", ")}. Follow the two-row turnaround and facial close-up contract.`);
}

export function assetPromptContext(picture: Picture, asset: ProductionAsset) {
  const screenplay = picture.screenplay.workingFountain;
  const scenes = sceneNodes(parseScreenplayHierarchy(screenplay)).filter((scene) => asset.requiredSceneIds.includes(scene.id));
  if (!screenplay.trim() || !scenes.length) throw new Error(`${asset.name}: no linked screenplay scene; image generation is blocked.`);
  const context = {
    ...(asset.category !== "character" ? { renderProseContractVersion: 2 } : {}),
    ...(asset.category === "vfx" ? { effectsReferenceContractVersion: 1 } : {}),
    globalProductionInstructions: getGlobalProductionInstructions(),
    ...(picture.intake.visualDirection ? { visualDirection: picture.intake.visualDirection } : {}),
    screenplayVersion: picture.screenplay.currentVersionId,
    screenplay,
    sourceReferences: picture.intake.sourcePassages,
    suppliedSourceText: picture.intake.suppliedSourceText,
    brief: picture.intake.concept,
    fidelity: picture.intake.fidelityRequirements,
    productionInstructions: {
      directorNotes: picture.intake.directorNotes,
      historicalPeriod: picture.intake.historicalPeriod,
      culturalSocialWorld: picture.intake.culturalSocialWorld,
      storyConstraints: picture.intake.storyConstraints,
      mustInclude: picture.intake.mustInclude,
      mustAvoid: picture.intake.mustAvoid,
      adaptationBoundaries: picture.intake.adaptationBoundaries,
    },
    sharedVisualContinuity: picture.nativeFilm?.visualContinuity ?? "",
    ...(picture.selectedEngine?.image === "krea-2" ? { rendererContract: { version: 1, model: "KREA 2 RAW", tokenizer: "Qwen/Qwen3-VL-4B-Instruct", input: "text-only", referenceUse: "References support written costume/design descriptions and user review. This renderer does not directly condition on reference images. Describe relevant design details explicitly in self-contained natural language." } } : {}),
    cinematography: {
      manifesto: picture.cinematography?.manifestoVersions.at(-1)?.thesis ?? "",
      shots: picture.cinematography?.shotPlans.filter((plan) => asset.requiredSceneIds.includes(plan.sceneId)).map(({ status, approvedVersionId, sourceFingerprints, ...plan }) => plan) ?? [],
    },
    visualDevelopment: {
      boards: picture.visualDevelopment?.boards.map(({ title, intent, palette, motifs }) => ({ title, intent, palette, motifs })) ?? [],
      characters: picture.visualDevelopment?.characterBibles.map(({ name, facialGeometry, skinHairBuild, invariants, prohibitedDrift }) => ({ name, facialGeometry, skinHairBuild, invariants, prohibitedDrift })) ?? [],
      wardrobe: picture.visualDevelopment?.wardrobeStates.map(({ label, era, materials, wearState, continuityVariants }) => ({ label, era, materials, wearState, continuityVariants })) ?? [],
    },
    research: picture.research?.content.sections ?? null,
    asset: { id: asset.id, name: asset.name, category: asset.category, specification: asset.canonicalSpec, attachedReferences: asset.references,
      ...(asset.category === "character" ? { imageContract: CHARACTER_IDENTITY_SHEET_CONTRACT } : {}),
    },
    scenes: scenes.map((scene) => ({ id: scene.id, heading: scene.slugline, text: scene.fountain })),
  };
  return { context, hash: stableHash(context) };
}

export function requireGroundedAssetPrompt(picture: Picture, asset: ProductionAsset): string {
  const source = picture.assetPromptSources?.[asset.id];
  if (!source || source.contextHash !== assetPromptContext(picture, asset).hash) throw new Error(`${asset.name}: screenplay-based asset prompt is missing or stale. Write asset prompts from the current screenplay before generating images.`);
  const prompt = picture.assetImagePrompts?.[asset.id] ?? source.prompt;
  if (!prompt.trim() || prompt.length > 20000) throw new Error(`${asset.name}: image prompt must contain 1–20000 characters.`);
  return prompt;
}
