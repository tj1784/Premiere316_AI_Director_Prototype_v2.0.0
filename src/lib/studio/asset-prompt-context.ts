import type { Picture } from "./types.ts";
import type { ProductionAsset } from "../production/types.ts";
import { parseScreenplayHierarchy, sceneNodes } from "./screenplay-hierarchy.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { getGlobalProductionInstructions } from "./production-instructions.ts";
import { ASSET_DEVELOPMENT_CONTRACT } from "./authoring-contract.ts";
import { approvedAssetMedia, assetGenerationReferences } from "../production/asset-canonical-reference.ts";

export type AssetPromptSource = { prompt: string; tokenCount: number; contextHash: string; sceneIds: string[]; sourceQuote: string; modelId: string; generatedAt: number; imageEngineId?: string; tokenizerModel?: string };
export const isVisualAsset = (asset: { category: string; tombstone?: boolean }) => !asset.tombstone && !["voice", "sound", "music", "continuity", "other"].includes(asset.category);

/** Department completion is content-based; canonical image approval happens
 * later and must never prevent creation of the initial canon. */
export function assertAssetDevelopmentReady(picture: Picture): void {
  const visual = picture.visualDevelopment;
  const developedBoard = visual?.boards.some((board) => board.status !== "STALE" && board.intent.trim() && !(board.title === "Picture look bible" && board.intent === (picture.tone || "Editorial visual continuity") && board.palette.join("|") === "wet charcoal|warm practical|salt grey" && board.motifs.join("|") === "faces held past comfort|practical light islands"));
  const authoredRecord = (id: string, approvedVersionId: string | null) => Boolean(approvedVersionId || visual?.versions.some((version) => version.recordId === id));
  const developedBible = visual && (
    visual.characterBibles.some((bible) => bible.status !== "STALE" && bible.facialGeometry.trim() && (authoredRecord(bible.id, bible.approvedVersionId) || bible.facialGeometry !== picture.characters?.find((character) => character.id === bible.characterId)?.look)) ||
    visual.locationBibles.some((bible) => bible.status !== "STALE" && bible.geography.trim() && (authoredRecord(bible.id, bible.approvedVersionId) || bible.geography !== picture.locations?.find((location) => location.id === bible.locationId)?.description)) ||
    visual.propBibles.some((bible) => bible.status !== "STALE" && bible.materials.length && (authoredRecord(bible.id, bible.approvedVersionId) || bible.wearState !== picture.props?.find((prop) => prop.id === bible.propId)?.description)) ||
    visual.wardrobeStates.some((bible) => bible.status !== "STALE" && bible.materials.length && bible.era !== "from intake")
  );
  if (!developedBoard && !developedBible) throw new Error("Complete visual development from the screenplay inventory before writing asset prompts. A default or empty look workspace is not a developed visual direction.");
  const research = picture.research?.content.cinematographyManifesto;
  const researchSeed = [research?.thesis, research?.lensLanguage, research?.lighting, research?.movement, research?.texture].filter(Boolean).join(" · ");
  const developedManifesto = picture.cinematography?.manifestoVersions.some((version) => version.thesis.trim() && ![picture.tone, "Restrained editorial coverage with motivated movement.", researchSeed].includes(version.thesis));
  const developedPlan = picture.cinematography?.shotPlans.some((plan) => plan.status !== "STALE" && plan.lens?.trim() && plan.framing?.trim() && plan.lighting?.trim() && plan.lighting !== "motivated by approved research manifesto");
  if (!developedManifesto && !developedPlan) throw new Error("Develop cinematography from the shared visual direction before writing asset prompts. Record concrete lens, framing and lighting choices.");
}

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
  const stored = picture.screenplay.hierarchy;
  // Imported IDs (including separately timed credits) are authoritative while their
  // exact spans still match. Reparse edits with the previous hierarchy to retain IDs.
  const hierarchy = stored && sceneNodes(stored).length && sceneNodes(stored).every((scene) => screenplay.slice(scene.sourceStart, scene.sourceEnd) === scene.fountain)
    ? stored : parseScreenplayHierarchy(screenplay, stored);
  const scenes = sceneNodes(hierarchy).filter((scene) => asset.requiredSceneIds.includes(scene.id));
  if (!screenplay.trim() || !scenes.length) throw new Error(`${asset.name}: no linked screenplay scene; image generation is blocked.`);
  const missingSceneIds = asset.requiredSceneIds.filter((id) => !scenes.some((scene) => scene.id === id));
  if (missingSceneIds.length) throw new Error(`${asset.name}: linked screenplay scenes are missing (${missingSceneIds.join(", ")}). Reconcile the inventory before writing prompts.`);
  const inventory = picture.production?.assets ?? [];
  const sourceAsset = picture.importedPackage?.sourceAssets.find((item) => item.id === asset.id);
  const parentIds = new Set<string>();
  const collectParents = (id: string) => {
    const importedParent = picture.importedPackage?.sourceAssets.find((item) => item.id === id)?.parent;
    const ids = (picture.production?.dependencies ?? []).filter((edge) => edge.fromType === "asset" && edge.toType === "asset" && edge.toId === id).map((edge) => edge.fromId);
    if (importedParent) ids.push(importedParent);
    for (const parentId of ids) {
      if (parentId === asset.id || parentIds.has(parentId)) continue;
      parentIds.add(parentId);
      collectParents(parentId);
    }
  };
  collectParents(asset.id);
  const describeAsset = (item: ProductionAsset) => {
    const media = approvedAssetMedia(item);
    return {
      id: item.id, name: item.name, category: item.category, specification: item.canonicalSpec,
      linkedSceneIds: item.requiredSceneIds,
      variants: item.variants.filter((variant) => !variant.stale).map(({ id, name, requiredSceneIds, specPatch }) => ({ id, name, requiredSceneIds, specPatch })),
      state: picture.importedPackage?.sourceAssets.find((source) => source.id === item.id)?.state,
      approvedMedia: media ? { assetId: item.id, iterationId: media.id, specVersionId: media.specVersionId ?? item.approvedSpecVersionId ?? null, uri: media.mediaUri } : null,
    };
  };
  const relatedAssets = inventory.filter((item) => !item.tombstone && (item.id === asset.id || parentIds.has(item.id) || item.requiredSceneIds.some((id) => asset.requiredSceneIds.includes(id)))).map(describeAsset);
  const canonicalParents = [...parentIds].map((id) => relatedAssets.find((item) => item.id === id) ?? { id, name: id, approvedMedia: null });
  const context = {
    assetDevelopmentContract: ASSET_DEVELOPMENT_CONTRACT,
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
      adaptationInstructions: picture.intake.adaptationInstructions,
      materialToPreserve: picture.intake.materialToPreserve,
      materialMayDramatize: picture.intake.materialMayDramatize,
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
    research: picture.research ? { status: picture.research.status, versionId: picture.research.currentVersionId, approvedVersionId: picture.research.approvedVersionId, ...picture.research.content } : null,
    relatedAssets,
    canonicalParents,
    asset: { ...describeAsset(asset), attachedReferences: assetGenerationReferences(picture.production, asset),
      provenance: asset.provenance,
      requirements: picture.production?.requirements.filter((item) => asset.requirementIds.includes(item.id)) ?? [],
      ...(sourceAsset ? { importedSpecification: sourceAsset } : {}),
      sceneUses: picture.importedPackage?.sceneAssetLinks.filter((item) => item.asset_id === asset.id) ?? [],
      continuity: picture.importedPackage?.continuity.filter((item) => item.asset === asset.id || parentIds.has(item.asset)) ?? [],
      ...(asset.category === "character" ? { imageContract: CHARACTER_IDENTITY_SHEET_CONTRACT } : {}),
    },
    scenes: scenes.map((scene) => ({ id: scene.id, heading: scene.slugline, text: scene.fountain, durationSeconds: picture.scenes?.find((item) => item.id === scene.id)?.durationSec,
      timing: picture.importedPackage?.timingPlan.find((item) => item.id === scene.id),
    })),
  };
  return { context, hash: stableHash(context) };
}

/** Keep every scene/asset relationship while avoiding a copy of the screenplay
 * and a full design bible for each secondary subject in every model request.
 * Full source data still participates in the freshness hash above. */
export function compactAssetPromptContext(context: ReturnType<typeof assetPromptContext>["context"]) {
  const parentIds = new Set(context.canonicalParents.map((item) => item.id));
  const { screenplay: _wholeScreenplay, scenes, relatedAssets, ...shared } = context;
  const evidenceParagraphs = new Map<string, string>();
  const evidenceOnce = (text: string, path: string) => text.split(/\n\s*\n/).map((paragraph) => {
    const previous = evidenceParagraphs.get(paragraph);
    if (previous && paragraph.length > 100) return `[Same evidence as ${previous}]`;
    evidenceParagraphs.set(paragraph, path);
    return paragraph;
  }).join("\n\n");
  const research = shared.research ? {
    ...shared.research,
    sections: Object.fromEntries(Object.entries(shared.research.sections).map(([key, value]) => [key, evidenceOnce(value, `research.sections.${key}`)])),
    notes: evidenceOnce(shared.research.notes, "research.notes"),
    risks: evidenceOnce(shared.research.risks, "research.risks"),
    feasibility: evidenceOnce(shared.research.feasibility, "research.feasibility"),
  } : null;
  return {
    ...shared,
    research,
    asset: {
      ...shared.asset,
      requirements: shared.asset.requirements.map(({ id, confidence, evidenceNote }) => ({ id, confidence, evidenceNote })),
      ...(shared.asset.importedSpecification ? { importedSpecification: { id: shared.asset.importedSpecification.id, parent: shared.asset.importedSpecification.parent, state: shared.asset.importedSpecification.state, reference: shared.asset.importedSpecification.reference } } : {}),
    },
    screenplay: scenes.map((scene) => scene.text.trimEnd()).join("\n\n"),
    scenes: scenes.map(({ id, heading, durationSeconds }) => ({ id, heading, durationSeconds })),
    relatedAssetColumns: ["id", "name", "category", "appearanceSummary", "stateSummary", "approvedMedia"] as const,
    relatedAssets: relatedAssets.map((related) => {
      // Target and parent specs already have their own authoritative sections.
      if (related.id === context.asset.id || parentIds.has(related.id)) return [related.id, related.name, related.category, related.id === context.asset.id ? "See full targetAsset" : "See full canonicalParents", "", related.approvedMedia];
      const spec = related.specification;
      const appearance = spec.appearance || [spec.age, spec.skin, spec.hair, spec.build, spec.wardrobe].filter(Boolean).join("; ") || spec.visualDescription.split(/(?<=[.!?])\s/)[0];
      return [related.id, related.name, related.category, appearance, related.state?.split(/(?<=[.!?])\s/)[0] ?? related.variants.map((variant) => variant.name).join("; "), related.approvedMedia];
    }),
  };
}

export function requireGroundedAssetPrompt(picture: Picture, asset: ProductionAsset): string {
  const source = picture.assetPromptSources?.[asset.id];
  if (!source || source.contextHash !== assetPromptContext(picture, asset).hash) throw new Error(`${asset.name}: screenplay-based asset prompt is missing or stale. Write asset prompts from the current screenplay before generating images.`);
  const prompt = picture.assetImagePrompts?.[asset.id] ?? source.prompt;
  if (!prompt.trim() || prompt.length > 20000) throw new Error(`${asset.name}: image prompt must contain 1–20000 characters.`);
  return prompt;
}
