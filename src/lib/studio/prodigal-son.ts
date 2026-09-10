import { appendResearchVersion, emptyResearchContent, makeEmptyResearchBible, type ResearchBibleSections } from "../research/bible.ts";
import { buildDependencyGraph, normalizeRequirements } from "../production/breakdown.ts";
import { buildDependencyGraphV2 } from "../production/dependency-graph.ts";
import { approvedScreenplayInputFromBoundary } from "../production/screenplay-adapter.ts";
import type { CanonicalAssetSpec, ProductionAsset, ProductionBreakdown, ProductionCategory } from "../production/types.ts";
import { makeVisualDevelopmentState } from "../visual-development.ts";
import { makeCinematographyState } from "../cinematography.ts";
import { PRODIGAL_SON_SOURCE } from "./bundled-pictures/prodigal-son/source.ts";
import type { ImportedPicturePackage, ImportedVisualAsset } from "./imported-picture-package.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePreparationForIntake } from "./picture-preparation.ts";
import { appendScreenplayVersion, approvedScreenplayBoundary } from "./screenplay.ts";
import { parseScreenplayHierarchy, type ScreenplayHierarchy, type ScreenplayNode } from "./screenplay-hierarchy.ts";
import { DEFAULT_ENGINES, type Picture } from "./types.ts";

export const PRODIGAL_SON_PICTURE_ID = "pic_prodigal_son_20260909";
export const PRODIGAL_SON_PACKAGE_ID = "prodigal-son-2026-09-09-v1";
export const PRODIGAL_SON_IMPORTED_AT = Date.UTC(2026, 8, 9, 12);
const SCREENPLAY_VERSION_ID = `${PRODIGAL_SON_PICTURE_ID}:user-accepted-import:v1`;
const RESOURCE_ROOT = "/pictures/prodigal-son";
const VISUAL_REFERENCE_FILE = "visual-development-reference.png";
const VISUAL_REFERENCE_URI = `${RESOURCE_ROOT}/${VISUAL_REFERENCE_FILE}`;
const CHARACTER_ASSET_ROOT = `${RESOURCE_ROOT}/character-assets`;
const GENERATED_ASSET_ROOT = `${RESOURCE_ROOT}/generated-assets`;
export const PRODIGAL_SON_VISUAL_REFERENCE_URI = VISUAL_REFERENCE_URI;

const CHARACTER_ASSET_IMAGE_FILES: Record<string, string> = {
  "PS-CHR-JESUS": "PS-CHR-JESUS.png",
  "PS-CHR-FATHER": "PS-CHR-FATHER.png",
  "PS-CHR-ELDER": "PS-CHR-ELDER.png",
  "PS-CHR-YOUNGER": "PS-CHR-YOUNGER.png",
  "PS-CHR-MATTAN": "PS-CHR-MATTAN.png",
  "PS-CHR-HANNAH": "PS-CHR-HANNAH.png",
  "PS-CHR-LEVI": "PS-CHR-LEVI.png",
  "PS-CHR-DAMON": "PS-CHR-DAMON.png",
  "PS-CHR-BREADSELLER": "PS-CHR-BREADSELLER.png",
  "PS-CHR-HOST": "PS-CHR-HOST.png",
  "PS-CHR-FARMER": "PS-CHR-FARMER.png",
  "PS-CHR-SCRIBE": "PS-CHR-SCRIBE.png",
  "PS-CHR-TAXCOLLECTOR": "PS-CHR-TAXCOLLECTOR.png",
  "PS-EXT-LISTENERS": "PS-EXT-LISTENERS.png",
  "PS-EXT-CARRIERS": "PS-EXT-CARRIERS.png",
  "PS-EXT-HOMEWORKERS": "PS-EXT-HOMEWORKERS.png",
  "PS-EXT-NEIGHBORWOMAN": "PS-EXT-NEIGHBORWOMAN.png",
  "PS-EXT-OLDTRAVELER": "PS-EXT-OLDTRAVELER.png",
  "PS-EXT-MARKET": "PS-EXT-MARKET.png",
  "PS-EXT-CHILD": "PS-EXT-CHILD.png",
  "PS-EXT-GUESTS": "PS-EXT-GUESTS.png",
  "PS-EXT-FOREIGNMUS": "PS-EXT-FOREIGNMUS.png",
  "PS-EXT-FAMINEFAMILY": "PS-EXT-FAMINEFAMILY.png",
  "PS-EXT-FARMHOUSE": "PS-EXT-FARMHOUSE.png",
  "PS-EXT-ROADTRADE": "PS-EXT-ROADTRADE.png",
  "PS-EXT-DONKEYDRIVER": "PS-EXT-DONKEYDRIVER.png",
  "PS-EXT-FEAST": "PS-EXT-FEAST.png",
  "PS-EXT-HOMEMUS": "PS-EXT-HOMEMUS.png",
  "PS-EXT-PASSTRAVELER": "PS-EXT-PASSTRAVELER.png",
};

const GENERATED_ASSET_IMAGE_FILES: Record<string, string> = {
  "PS-FOD-CALFMEAT": "PS-FOD-CALFMEAT.png",
  "PS-FOD-FOREIGNBANQUET": "PS-FOD-FOREIGNBANQUET.png",
  "PS-FOD-GRAIN": "PS-FOD-GRAIN.png",
  "PS-FOD-HOMEBREAD": "PS-FOD-HOMEBREAD.png",
  "PS-FOD-HOMEMEALS": "PS-FOD-HOMEMEALS.png",
  "PS-FOD-MARKETBREAD": "PS-FOD-MARKETBREAD.png",
  "PS-FOD-PODS": "PS-FOD-PODS.png",
  "PS-FOD-TRAVEL": "PS-FOD-TRAVEL.png",
  "PS-GFX-CREDITS": "PS-GFX-CREDITS.png",
  "PS-GFX-TITLE": "PS-GFX-TITLE.png",
  "PS-GRM-ELDERPALM": "PS-GRM-ELDERPALM.png",
  "PS-GRM-FATHERDUST": "PS-GRM-FATHERDUST.png",
  "PS-GRM-YOUNGERHOME": "PS-GRM-YOUNGERHOME.png",
  "PS-GRM-YOUNGERHUNGER": "PS-GRM-YOUNGERHUNGER.png",
  "PS-GRM-YOUNGERRESTORE": "PS-GRM-YOUNGERRESTORE.png",
  "PS-INS-BASKETMEMORY": "PS-INS-BASKETMEMORY.png",
  "PS-INS-SUPPERMEMORY": "PS-INS-SUPPERMEMORY.png",
  "PS-PRP-BALANCE": "PS-PRP-BALANCE.png",
  "PS-PRP-BASKETMENDED": "PS-PRP-BASKETMENDED.png",
  "PS-PRP-BASKETSOUND": "PS-PRP-BASKETSOUND.png",
  "PS-PRP-BEDDING": "PS-PRP-BEDDING.png",
  "PS-PRP-BREADCLOTH": "PS-PRP-BREADCLOTH.png",
  "PS-PRP-CISTERNROPE": "PS-PRP-CISTERNROPE.png",
  "PS-PRP-CLOTHDISPLAY": "PS-PRP-CLOTHDISPLAY.png",
  "PS-PRP-COINCLOTH": "PS-PRP-COINCLOTH.png",
  "PS-PRP-COINS": "PS-PRP-COINS.png",
  "PS-PRP-DAMAGEDBASKETS": "PS-PRP-DAMAGEDBASKETS.png",
  "PS-PRP-ELDERBOWL": "PS-PRP-ELDERBOWL.png",
  "PS-PRP-ESTATEDOC": "PS-PRP-ESTATEDOC.png",
  "PS-PRP-FIELDSTONES": "PS-PRP-FIELDSTONES.png",
  "PS-PRP-HOMEWATERJAR": "PS-PRP-HOMEWATERJAR.png",
  "PS-PRP-MARKETSCALE": "PS-PRP-MARKETSCALE.png",
  "PS-PRP-MERCHANTJAR": "PS-PRP-MERCHANTJAR.png",
  "PS-PRP-MONEYPOUCH": "PS-PRP-MONEYPOUCH.png",
  "PS-PRP-PACKTACK": "PS-PRP-PACKTACK.png",
  "PS-PRP-PALMCLOTH": "PS-PRP-PALMCLOTH.png",
  "PS-PRP-PIGFEEDBASKET": "PS-PRP-PIGFEEDBASKET.png",
  "PS-PRP-PIPEDRUMFOREIGN": "PS-PRP-PIPEDRUMFOREIGN.png",
  "PS-PRP-PIPEDRUMHOME": "PS-PRP-PIPEDRUMHOME.png",
  "PS-PRP-REFLECTIONBOWL": "PS-PRP-REFLECTIONBOWL.png",
  "PS-PRP-RESTORATIONSTOOL": "PS-PRP-RESTORATIONSTOOL.png",
  "PS-PRP-RING": "PS-PRP-RING.png",
  "PS-PRP-SERVINGBOWL": "PS-PRP-SERVINGBOWL.png",
  "PS-PRP-SLEDGE": "PS-PRP-SLEDGE.png",
  "PS-PRP-TAVERNWARE": "PS-PRP-TAVERNWARE.png",
  "PS-PRP-TROUGH": "PS-PRP-TROUGH.png",
  "PS-PRP-TWOCUPS": "PS-PRP-TWOCUPS.png",
  "PS-PRP-WALLCORD": "PS-PRP-WALLCORD.png",
  "PS-PRP-WASHBOWL": "PS-PRP-WASHBOWL.png",
  "PS-PRP-WATERSKIN": "PS-PRP-WATERSKIN.png",
  "PS-PRP-WRITING": "PS-PRP-WRITING.png",
  "PS-SET-COOKING": "PS-SET-COOKING.png",
  "PS-SET-FEASTSEATING": "PS-SET-FEASTSEATING.png",
  "PS-SET-FOREIGNMEAL": "PS-SET-FOREIGNMEAL.png",
  "PS-SET-HOMEAWNING": "PS-SET-HOMEAWNING.png",
  "PS-SET-HOMELAMPS": "PS-SET-HOMELAMPS.png",
  "PS-SET-HOMETABLE": "PS-SET-HOMETABLE.png",
  "PS-SET-HOMEVESSELS": "PS-SET-HOMEVESSELS.png",
  "PS-SET-ROOMPEG": "PS-SET-ROOMPEG.png",
  "PS-SET-TOWNSTOCK": "PS-SET-TOWNSTOCK.png",
  "PS-WAR-BESTROBE": "PS-WAR-BESTROBE.png",
  "PS-WAR-BLUE": "PS-WAR-BLUE.png",
  "PS-WAR-ELDER": "PS-WAR-ELDER.png",
  "PS-WAR-FATHER": "PS-WAR-FATHER.png",
  "PS-WAR-FATHERTRAVEL": "PS-WAR-FATHERTRAVEL.png",
  "PS-WAR-FOREIGNKIT": "PS-WAR-FOREIGNKIT.png",
  "PS-WAR-HOMEKIT": "PS-WAR-HOMEKIT.png",
  "PS-WAR-JESUS": "PS-WAR-JESUS.png",
  "PS-WAR-NEWSANDALS": "PS-WAR-NEWSANDALS.png",
  "PS-WAR-OLIVE": "PS-WAR-OLIVE.png",
  "PS-WAR-RUSSET": "PS-WAR-RUSSET.png",
  "PS-WAR-YOUNGERSANDAL": "PS-WAR-YOUNGERSANDAL.png",
  "PS-WAR-YOUNGERTUNIC": "PS-WAR-YOUNGERTUNIC.png",
};

const CATEGORY_MAP: Record<string, ProductionCategory> = {
  Character: "character", "Featured extra": "character", Extras: "character",
  Animal: "creature", Location: "location", "Location state": "location",
  Wardrobe: "wardrobe", "Wardrobe kit": "wardrobe", Grooming: "hair_makeup",
  Prop: "prop", "Prop / dressing": "set_dressing", "Prop kit": "prop",
  "Set dressing": "set_dressing", Food: "prop", "Food / dressing": "set_dressing",
  "Food / prop": "prop", Insert: "other", Graphic: "other",
};

/** Preserve exact Fountain offsets, published IDs, and the explicit credits entry. */
export function prodigalSonHierarchy(): ScreenplayHierarchy {
  const fountain = PRODIGAL_SON_SOURCE.fountain;
  const headings = [...fountain.matchAll(/^.*#(PS-S\d{2})#\s*$/gm)];
  if (headings.length !== PRODIGAL_SON_SOURCE.scenes.length) throw new Error("Imported screenplay headings do not match its timing plan.");
  const nodes: ScreenplayNode[] = [{
    id: "PS-ACT-01", kind: "act", parentId: null, title: "The Prodigal Son",
    fountain, order: 0, sourceStart: 0, sourceEnd: fountain.length,
  }];
  for (const [index, metadata] of PRODIGAL_SON_SOURCE.scenes.entries()) {
    const heading = headings[index];
    if (heading[1] !== metadata.id) throw new Error(`Imported scene order differs at ${metadata.id}.`);
    const sourceStart = heading.index!;
    const sourceEnd = headings[index + 1]?.index ?? fountain.length;
    const sceneText = fountain.slice(sourceStart, sourceEnd);
    const slugline = heading[0].trim();
    nodes.push({ id: metadata.id, kind: "scene", parentId: "PS-ACT-01", title: metadata.title, slugline, fountain: sceneText, order: index, sourceStart, sourceEnd });
    for (const node of parseScreenplayHierarchy(sceneText).nodes) {
      if (node.kind !== "beat" && node.kind !== "dialogue") continue;
      nodes.push({
        ...node, id: `${metadata.id}:${node.kind}:${node.order + 1}`, parentId: metadata.id,
        sourceStart: sourceStart + node.sourceStart, sourceEnd: sourceStart + node.sourceEnd,
      });
    }
  }
  return { schemaVersion: 1, nodes };
}

function importedPackage(): ImportedPicturePackage {
  const sourceAssets = PRODIGAL_SON_SOURCE.assets.map(({ generation_prompt: _generationPrompt, workbook: _workbook, ...asset }) => structuredClone(asset));
  const timingPlan = PRODIGAL_SON_SOURCE.scenes.map(({ workbook: _workbook, ...scene }) => structuredClone(scene));
  const sceneAssetLinks = PRODIGAL_SON_SOURCE.sceneAssetLinks.map(({ workbook: _workbook, ...link }) => structuredClone(link));
  const continuity = PRODIGAL_SON_SOURCE.continuity.map(({ workbook: _workbook, ...rule }) => structuredClone(rule));
  return {
    schemaVersion: 1,
    packageId: PRODIGAL_SON_PACKAGE_ID,
    revision: PRODIGAL_SON_SOURCE.revision,
    importedAt: PRODIGAL_SON_IMPORTED_AT,
    provenance: "Imported without rewriting from the complete screenplay and visual inventory delivered on 9 September 2026. Original source files and SHA-256 checksums are retained. No local model generation or QA telemetry is claimed.",
    screenplayAcceptance: "User accepted the delivered screenplay and explicitly requested adding it and its full inventory as a new picture. This is editorial acceptance of the imported text; visual specifications, media, and backend production approvals remain pending.",
    researchStatus: "completed-source-import-pending-app-review",
    researchNotes: PRODIGAL_SON_SOURCE.researchNotes,
    sourceAssets,
    timingPlan,
    sceneAssetLinks,
    continuity,
    sourceSha256: { ...PRODIGAL_SON_SOURCE.sourceSha256 },
    resources: [
      { label: "Complete package", fileName: "Prodigal_Son_Complete_Package.zip" },
      { label: "Screenplay · Word", fileName: "Prodigal_Son_Complete_Screenplay.docx" },
      { label: "Asset inventory · Excel", fileName: "Prodigal_Son_Visual_Asset_Inventory.xlsx" },
      { label: "Screenplay · Fountain", fileName: "Prodigal_Son.fountain" },
      { label: "Research and adaptation notes", fileName: "Research_and_Adaptation_Notes.md" },
      { label: "Complete inventory · JSON", fileName: "inventory_data.json" },
    ].map((resource) => ({ ...resource, href: `${RESOURCE_ROOT}/${resource.fileName}` })),
  };
}

function researchSection(heading: string): string {
  const sections = PRODIGAL_SON_SOURCE.researchNotes.split(/^## /m);
  return sections.find((section) => section.startsWith(`${heading}\n`))?.trim() ?? "";
}

function importedResearch() {
  const sourceNotes = PRODIGAL_SON_SOURCE.researchNotes;
  const content = emptyResearchContent();
  const sections: Partial<ResearchBibleSections> = {
    sourceCanonLedger: researchSection("The biblical narrative"),
    worldOverview: [researchSection("Inheritance and public shame"), researchSection("An early transfer of property")].join("\n\n"),
    characters: "The father and both sons remain unnamed in Luke. Ages, appearances, supporting characters and private conversations in this screenplay are adaptation choices. See the imported asset identities and research notes.",
    locations: "The Judean home, hillside telling location and foreign-country settings are proposed dramatic locations. Luke does not specify their exact geography. Domestic pigs appear only at the foreign employer's enclosure.",
    storyTheme: "The Suffocating Weight of Resentment versus the Agony of Forgiveness. Both brothers are central; the father loves each equally and expresses that love differently. The elder's answer remains unresolved.",
    audienceContext: "Luke 15:1–3 supplies the surrounding complaint about Jesus receiving sinners. The prologue dramatizes that context; it is not presented as a documented Sermon on the Mount event.",
    visualIdentity: "Intake direction: photorealistic live action, first-century Judean material world, natural performances and natural lighting. Visual development and canonical image approval are still pending.",
    productionDesign: [researchSection("Household objects"), researchSection("Writing materials"), researchSection("Oil lamps")].join("\n\n"),
    costumeProps: [researchSection("Textiles"), researchSection("Animals and food")].join("\n\n"),
    cinematographyResearch: "Not developed in this delivered package. The intake requests 35mm anamorphic, wide landscapes, intimate close-ups and long emotional holds. Detailed camera decisions follow visual development.",
    soundMusicWorld: "The screenplay contains dialogue, practical environmental sounds, differentiated emotional silences and an ending instrumental coda. Detailed sound, score and Qwen voice development remain future department work.",
    risksDisputes: [researchSection("Inheritance and public shame"), researchSection("An early transfer of property")].join("\n\n"),
    aiProductionFeasibility: researchSection("Production sequence"),
    confidenceLedger: "Explicit Scripture is distinguished from material evidence and reasonable reconstruction in the source notes. Names, ages, gifts, wall, private conversations and exact settings are inventions. No automatic stoning, mandatory village expulsion ceremony, or historically mandatory color meanings are asserted.",
  };
  content.sections = { ...content.sections, ...sections };
  content.notes = sourceNotes;
  content.risks = sections.risksDisputes!;
  content.feasibility = sections.aiProductionFeasibility!;
  content.sources = [...sourceNotes.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((match, index) => ({
    id: `PS-RESEARCH-SOURCE-${String(index + 1).padStart(2, "0")}`,
    title: match[1], locator: match[2], quote: "",
    confidence: index < 4 ? "A" as const : "B" as const,
    importedFrom: "Research_and_Adaptation_Notes.md", createdAt: PRODIGAL_SON_IMPORTED_AT,
  }));
  return appendResearchVersion(makeEmptyResearchBible(PRODIGAL_SON_IMPORTED_AT), {
    id: `${PRODIGAL_SON_PACKAGE_ID}:research:v1`, label: "Completed source research · imported for review",
    kind: "draft", scope: "whole-picture", createdAt: PRODIGAL_SON_IMPORTED_AT,
    sourceVersionId: null, content,
  });
}

function assetSpec(source: ImportedVisualAsset): CanonicalAssetSpec {
  const continuity = PRODIGAL_SON_SOURCE.continuity.filter((rule) => {
    const ids: string[] = rule.asset.match(/PS-[A-Z]+-[A-Z0-9]+/g) ?? [];
    return ids.includes(source.id) || !ids.length && rule.scenes.some((sceneId) => source.scenes.includes(sceneId));
  });
  return {
    identity: source.name,
    visualDescription: source.requirement,
    distinguishingFeatures: [], prohibitedFeatures: [], materials: [], setDressing: [],
    visualStyle: "Photorealistic live-action production reference; final visual development pending.",
    period: "First century CE",
    referenceRequirements: [source.reference],
    continuityLocks: [
      source.state, `Required reference deliverables: ${source.reference}`,
      ...(source.parent ? [`Parent identity or environment: ${source.parent}. Preserve its approved identity when developing this state.`] : []),
      ...continuity.map((rule) => `${rule.id} | ${rule.scenes.join(", ")} | State: ${rule.state} | Transition: ${rule.transition} | Constant: ${rule.constant}`),
    ].filter(Boolean),
    negativeRequirements: ["No modern materials or objects; no fantasy or cartoon rendering.", ...(source.category === "Graphic" ? ["Composited editable typography; do not generate lettering inside scenery."] : []), ...(source.category === "Insert" ? ["Reuse the linked approved earlier scene; do not invent a replacement memory scene."] : [])],
  };
}

function characterAssetImageIteration(source: Pick<ImportedVisualAsset, "id" | "name" | "scenes">) {
  const fileName = CHARACTER_ASSET_IMAGE_FILES[source.id];
  if (!fileName) return null;
  return {
    id: `${source.id}:uploaded-character-image:v1`,
    assetId: source.id,
    variantId: null,
    specVersionId: `${source.id}:imported-spec:v1`,
    mediaUri: `${CHARACTER_ASSET_ROOT}/${fileName}`,
    createdAt: PRODIGAL_SON_IMPORTED_AT,
    status: "NEEDS_REVIEW" as const,
    provenance: {
      sourceType: "user" as const,
      screenplayVersionId: SCREENPLAY_VERSION_ID,
      sceneIds: [...source.scenes],
      evidenceNote: "User-supplied character asset image imported for review.",
      createdAt: PRODIGAL_SON_IMPORTED_AT,
    },
    uploadedFileName: fileName,
  };
}

function generatedAssetImageIteration(source: Pick<ImportedVisualAsset, "id" | "name" | "scenes">) {
  const fileName = GENERATED_ASSET_IMAGE_FILES[source.id];
  if (!fileName) return null;
  return {
    id: `${source.id}:comfy-generated-asset:v1`,
    assetId: source.id,
    variantId: null,
    specVersionId: `${source.id}:imported-spec:v1`,
    mediaUri: `${GENERATED_ASSET_ROOT}/${fileName}`,
    createdAt: PRODIGAL_SON_IMPORTED_AT,
    status: "NEEDS_REVIEW" as const,
    provenance: {
      sourceType: "user" as const,
      screenplayVersionId: SCREENPLAY_VERSION_ID,
      sceneIds: [...source.scenes],
      evidenceNote: "ComfyUI-generated asset image imported for review from the user-requested batch.",
      createdAt: PRODIGAL_SON_IMPORTED_AT,
    },
    uploadedFileName: fileName,
  };
}

function importedAssetIterations(source: Pick<ImportedVisualAsset, "id" | "name" | "scenes">) {
  return [characterAssetImageIteration(source), generatedAssetImageIteration(source)].filter((iteration) => iteration !== null);
}

function prodigalSonAssetImagePrompts(): Record<string, string> {
  return Object.fromEntries(PRODIGAL_SON_SOURCE.assets.map((asset) => [asset.id, asset.generation_prompt ?? ""]).filter(([, prompt]) => prompt.trim()));
}

function importedProduction(picture: Picture): ProductionBreakdown {
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay);
  if (!boundary) throw new Error("Imported picture is missing its accepted screenplay snapshot.");
  const input = approvedScreenplayInputFromBoundary(boundary);
  const requirements = normalizeRequirements(PRODIGAL_SON_SOURCE.assets.map((asset) => ({
    id: `${asset.id}:requirement`, category: CATEGORY_MAP[asset.category], name: asset.name,
    description: asset.requirement, sceneIds: [...asset.scenes],
    evidenceNote: `Imported inventory record ${asset.id}; original category: ${asset.category}. Requirements are proposed visual development, with approval pending.`,
    hero: ["PS-CHR-FATHER", "PS-CHR-ELDER", "PS-CHR-YOUNGER"].includes(asset.id),
  })), input);
  const assets: ProductionAsset[] = PRODIGAL_SON_SOURCE.assets.map((source, index) => {
    const requirement = requirements[index];
    const spec = assetSpec(source);
    const provenance = [{ sourceType: "screenplay" as const, screenplayVersionId: SCREENPLAY_VERSION_ID, sceneIds: [...source.scenes], evidenceNote: requirement.evidenceNote, createdAt: PRODIGAL_SON_IMPORTED_AT }];
    return {
      id: source.id, normalizedKey: `${requirement.category}:${requirement.normalizedKey}`, name: source.name,
      aliases: [], category: requirement.category, hero: Boolean(requirement.hero),
      requirementIds: [requirement.id], requiredSceneIds: [...source.scenes], socialWorldIds: [],
      canonicalSpec: spec, canonicalApproved: false, references: [], referenceRequired: false,
      variants: [], iterations: importedAssetIterations(source), approvedIterationId: null, rejectedIterationIds: [],
      specVersions: [{ id: `${source.id}:imported-spec:v1`, assetId: source.id, createdAt: PRODIGAL_SON_IMPORTED_AT, sourceVersionId: null, spec: structuredClone(spec), approved: false, provenance }],
      approvedSpecVersionId: null, aliasesOf: [], tombstone: false, lineage: [], conflicts: [],
      stale: false, staleReasons: [], blockedReasons: [], provenance,
      readiness: "READY_FOR_REVIEW", updatedAt: PRODIGAL_SON_IMPORTED_AT,
    };
  });
  const record: ProductionBreakdown = {
    schemaVersion: 1, pictureId: picture.id, screenplayVersionId: SCREENPLAY_VERSION_ID,
    scenes: input.scenes, socialWorld: input.socialWorld, sourceContext: input.sourceContext,
    requirements, assets, dependencies: [], graph: null, sourceBoundary: null,
    inventoryVersion: 1, approvals: [], auditLog: [], preparedAssets: [],
    productionAuthority: null, queue: [], createdAt: PRODIGAL_SON_IMPORTED_AT, updatedAt: PRODIGAL_SON_IMPORTED_AT,
  };
  record.dependencies = buildDependencyGraph(record);
  for (const source of PRODIGAL_SON_SOURCE.assets) {
    if (source.parent) record.dependencies.push({ fromType: "asset", fromId: source.parent, toType: "asset", toId: source.id, reason: "Imported parent identity or location continuity" });
  }
  record.graph = buildDependencyGraphV2(record, PRODIGAL_SON_IMPORTED_AT);
  for (const source of PRODIGAL_SON_SOURCE.assets) {
    if (source.parent) record.graph.edges.push({ from: `asset:${source.parent}`, to: `asset:${source.id}`, reason: "Imported parent identity or location continuity", dependentFields: ["canonicalSpec", "approvedSpecVersionId"], invalidationMode: "manual-review" });
  }
  return record;
}

export function makeProdigalSonPicture(): Picture {
  const now = PRODIGAL_SON_IMPORTED_AT;
  const theme = "The Suffocating Weight of Resentment versus the Agony of Forgiveness.";
  const intake = {
    ...makePictureIntake(now), sourceType: "biblical-historical" as const, title: "The Prodigal Son",
    concept: "Create a 30-minute photorealistic live-action biblical film adapting Jesus' Parable of the Prodigal Son (Luke 15:11–32). Expand the parable into an emotionally grounded historical narrative faithful to Scripture and first-century Jewish culture.",
    premise: theme,
    logline: "When his younger son returns destitute, a father welcomes him home—and must go outside to reach the faithful son whose years of duty have hardened into resentment.",
    storyNotes: "Both brothers are central. The father loves both equally and expresses that love differently. Show social expectations, consequences and emotional cost through behavior, silence and physical detail.",
    sourcePassages: "Luke 15:1–3 and 11–32", suppliedSourceText: researchSection("The biblical narrative"),
    existingScreenplay: PRODIGAL_SON_SOURCE.fountain,
    materialToPreserve: "The complete user-accepted Fountain and its exact scene IDs, timing plan, dialogue, continuity, open ending and source fidelity.",
    materialMayDramatize: "Names, ages, gifts, wall, private conversations and exact household settings are identified adaptation choices in the imported research notes.",
    fidelityRequirements: "Research before drafting. Preserve the father's love for both sons, the younger's confession, restoration before merit, foreign pig enclosure, and the unresolved invitation to the elder.",
    historicalPeriod: "First century CE; Judean household and an unspecified foreign country",
    culturalSocialWorld: [researchSection("Inheritance and public shame"), researchSection("An early transfer of property")].join("\n\n"),
    adaptationBoundaries: "No automatic stoning for merely requesting inheritance. No mandatory village expulsion ceremony. No pigs on the Jewish family farm. No maize. The elder's accusation about prostitutes remains his allegation. No second inheritance. The elder's final answer stays unresolved.",
    targetRuntimeMinutes: 30, runtimeSource: "manual" as const, genre: "Biblical historical drama",
    tone: "Emotionally grounded, natural, restrained; silence, subtext and visual storytelling",
    aspectRatio: "2.39:1", frameRate: 24,
    productionStyle: "Photorealistic live action, natural light, authentic first-century costumes and architecture, 35mm anamorphic, filmic color, immersive large-scale production.",
    directorNotes: "Observe rather than announce. Wide landscapes, intimate close-ups, long emotional holds. Earn each major emotional beat visually. The older brother is equally important; the father never favors one son over the other.",
    dialogueStyle: "Timeless and biblical, emotionally deep but natural and restrained; distinct rhythms and subtext. No modern phrases, theatrical melodrama, excessive exposition, or unnecessary narration.",
    storyConstraints: "Research → screenplay → production breakdown → visual development → cinematography → prompt development → asset generation. Approved canonical assets before first/last frames; approved frames before video. Every department preserves one coherent vision and character consistency.",
    mustInclude: "The elder's quiet suffering, duty, jealousy and internal conflict; the younger's rebellion and return; earned reunion; equal fatherly love; unresolved final invitation.",
    mustAvoid: "Fantasy, cartoon imagery, modern language, melodrama, excessive dialogue, repetitive score, invented historical certainty, and falsely approved media.",
    workflow: "biblical-7-pass" as const,
  };
  const preparation = makePreparationForIntake(intake, PRODIGAL_SON_PICTURE_ID, now);
  const hierarchy = prodigalSonHierarchy();
  const screenplay = appendScreenplayVersion(preparation.screenplay, {
    id: SCREENPLAY_VERSION_ID, label: "User-accepted imported screenplay · 9 September 2026",
    kind: "approved", fountain: PRODIGAL_SON_SOURCE.fountain, createdAt: now,
    model: null, workflow: intake.workflow, pass: null,
    sourceVersionId: preparation.screenplay.currentVersionId, settings: null,
    logicalRole: "approve", hierarchy,
  });
  const picture: Picture = {
    ...preparation, id: PRODIGAL_SON_PICTURE_ID, title: intake.title, logline: intake.logline,
    genre: intake.genre, tone: intake.tone, format: intake.aspectRatio, fps: intake.frameRate,
    runtimeMinutes: 30, createdAt: now, updatedAt: now, stage: "inventory", lastOpenedStage: "inventory",
    intake, screenplay, screenplayFountain: PRODIGAL_SON_SOURCE.fountain, research: importedResearch(),
    importedPackage: importedPackage(), thumbnailUrl: VISUAL_REFERENCE_URI, selectedEngine: { ...DEFAULT_ENGINES },
    production: null, visualDevelopment: makeVisualDevelopmentState(now), cinematography: makeCinematographyState(now), performance: null,
    acts: [{ number: 1, name: "The Prodigal Son" }],
    scenes: PRODIGAL_SON_SOURCE.scenes.map((scene) => ({ id: scene.id, act: 1, slugline: scene.slugline, summary: scene.action, emotionalBeat: scene.title, durationSec: scene.duration_seconds })),
    characters: [], locations: [], props: [], wardrobe: [], vfx: [], shots: [], cues: [], voices: [],
    directorNotes: intake.directorNotes, usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
  picture.production = importedProduction(picture);
  picture.assetImagePrompts = prodigalSonAssetImagePrompts();
  // An explicit empty workspace prevents legacy hydration from inventing default
  // shots, camera choices, or performance beats before these departments begin.
  picture.performance = {
    schemaVersion: 1, pictureId: picture.id,
    approvedScreenplay: { pictureId: picture.id, screenplayVersionId: SCREENPLAY_VERSION_ID, approvedAt: now, sceneIds: picture.scenes.map((scene) => scene.id), socialWorld: [], sourceType: "user" },
    scenes: picture.scenes.map((scene) => ({ id: scene.id, slugline: scene.slugline, summary: scene.summary, durationSec: scene.durationSec })),
    beats: [], performance: {}, shotVersions: {}, shots: [], queue: {},
    continuityDecisions: [], dependencyGraph: { nodes: [], edges: [] }, lastUpdated: now, updatedAt: now,
  };
  const assets = picture.production.assets;
  picture.characters = assets.filter((asset) => asset.category === "character").map((asset) => ({ id: asset.id, name: asset.name, role: asset.canonicalSpec.identity, age: "", look: asset.canonicalSpec.visualDescription, arc: "", voiceId: "" }));
  const simpleAssets = (category: ProductionCategory) => assets.filter((asset) => asset.category === category).map((asset) => ({ id: asset.id, name: asset.name, description: asset.canonicalSpec.visualDescription }));
  picture.locations = simpleAssets("location");
  picture.props = simpleAssets("prop");
  picture.wardrobe = simpleAssets("wardrobe");
  return picture;
}

/** Keep bundled source packages visible when the app updates an existing library. */
export function mergeBundledPictures(pictures: Picture[], installedIds: readonly string[] = []): { pictures: Picture[]; installedBundledPictureIds: string[] } {
  const installed = new Set(installedIds.filter((id) => typeof id === "string"));
  const exists = pictures.some((picture) => picture.id === PRODIGAL_SON_PICTURE_ID);
  const shouldAdd = !exists;
  installed.add(PRODIGAL_SON_PICTURE_ID);
  return {
    pictures: shouldAdd ? [...pictures, makeProdigalSonPicture()] : pictures,
    installedBundledPictureIds: [...installed],
  };
}

export function hydrateProdigalSonVisualReference(picture: Picture): Picture {
  if (picture.id !== PRODIGAL_SON_PICTURE_ID) return picture;
  const production = picture.production;
  const sourceById = new Map(PRODIGAL_SON_SOURCE.assets.map((asset) => [asset.id, asset]));
  const nextProduction = production ? {
    ...production,
    assets: production.assets.map((asset) => {
      const source = sourceById.get(asset.id);
      const importedIterations = source ? importedAssetIterations(source) : [];
      const importedIds = new Set(importedIterations.map((iteration) => iteration.id));
      const iterations = importedIterations.length
        ? [...importedIterations, ...asset.iterations.filter((iteration) => !importedIds.has(iteration.id))]
        : asset.iterations;
      return {
        ...asset,
        references: asset.references.filter((reference) => reference.uri !== VISUAL_REFERENCE_URI),
        iterations,
      };
    }),
  } : production;
  const nextPicture = {
    ...picture,
    thumbnailUrl: picture.thumbnailUrl || VISUAL_REFERENCE_URI,
    production: nextProduction,
    assetImagePrompts: { ...picture.assetImagePrompts, ...prodigalSonAssetImagePrompts() },
    assetPromptSources: Object.fromEntries(Object.entries(picture.assetPromptSources ?? {}).filter(([, source]) => source.modelId !== "workbook-import")),
  };
  return nextPicture;
}
