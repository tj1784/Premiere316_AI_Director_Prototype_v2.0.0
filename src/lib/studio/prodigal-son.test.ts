import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRODIGAL_SON_SOURCE } from "./bundled-pictures/prodigal-son/source.ts";
import { hydrateProdigalSonVisualReference, makeProdigalSonPicture, mergeBundledPictures, PRODIGAL_SON_PICTURE_ID, PRODIGAL_SON_VISUAL_REFERENCE_URI } from "./prodigal-son.ts";
import { approvedScreenplayBoundary } from "./screenplay.ts";
import { sceneNodes } from "./screenplay-hierarchy.ts";
import { migratePicturePreparation } from "./picture-preparation.ts";
import { sanitizeProductionBreakdown } from "../production/persistence.ts";
import { PRODUCTION_CATEGORIES } from "../production/types.ts";
import { isVisualAsset } from "./asset-prompt-context.ts";
import { hydrateVisualDevelopmentState } from "../visual-development.ts";
import { hydrateCinematographyState } from "../cinematography.ts";
import { migratePicturePerformance } from "../performance/persistence.ts";
import { hydrateGenerateGates, generateGateReadiness } from "../production/generate-gates.ts";
import { hydratePromptLabState } from "./prompt-lab.ts";
import { movieReadiness } from "./movie-readiness.ts";

test("the imported picture retains the complete original text, timing plan and inventory associations", () => {
  const picture = makeProdigalSonPicture();
  const bundle = picture.importedPackage!;
  const production = picture.production!;
  const sourceAssetsForPersistence = PRODIGAL_SON_SOURCE.assets.map(({ generation_prompt: _generationPrompt, workbook: _workbook, ...asset }) => asset);
  const sourceScenesForPersistence = PRODIGAL_SON_SOURCE.scenes.map(({ workbook: _workbook, ...scene }) => scene);
  const sourceLinksForPersistence = PRODIGAL_SON_SOURCE.sceneAssetLinks.map(({ workbook: _workbook, ...link }) => link);
  const sourceContinuityForPersistence = PRODIGAL_SON_SOURCE.continuity.map(({ workbook: _workbook, ...rule }) => rule);
  assert.equal(picture.screenplayFountain, PRODIGAL_SON_SOURCE.fountain);
  assert.equal(picture.screenplay.workingFountain, PRODIGAL_SON_SOURCE.fountain);
  assert.equal(picture.screenplay.status, "APPROVED");
  assert.equal(production.assets.length, 129);
  assert.equal(bundle.sceneAssetLinks.length, 539);
  assert.equal(bundle.continuity.length, 29);
  assert.equal(picture.scenes.length, 23);
  assert.equal(picture.scenes.reduce((sum, scene) => sum + scene.durationSec, 0), 1800);
  assert.equal(picture.scenes.slice(0, 22).reduce((sum, scene) => sum + scene.durationSec, 0), 1770);
  assert.equal(picture.scenes[22].id, "PS-S23");
  assert.equal(picture.scenes[22].durationSec, 30);
  assert.deepEqual(bundle.sourceAssets, sourceAssetsForPersistence);
  assert.deepEqual(bundle.sceneAssetLinks, sourceLinksForPersistence);
  assert.deepEqual(bundle.continuity, sourceContinuityForPersistence);
  assert.deepEqual(bundle.timingPlan, sourceScenesForPersistence);
  assert.equal(Object.keys(picture.assetImagePrompts ?? {}).length, 129);
  assert.equal(picture.assetImagePrompts?.["PS-CHR-JESUS"], PRODIGAL_SON_SOURCE.assets.find((asset) => asset.id === "PS-CHR-JESUS")?.generation_prompt);
  const assetIds = new Set(production.assets.map((asset) => asset.id));
  const sceneIds = new Set(picture.scenes.map((scene) => scene.id));
  assert.equal(assetIds.size, 129);
  assert.equal(new Set(bundle.sceneAssetLinks.map((link) => `${link.scene_id}:${link.asset_id}`)).size, 539);
  for (const link of bundle.sceneAssetLinks) {
    assert.ok(assetIds.has(link.asset_id), link.asset_id);
    assert.ok(sceneIds.has(link.scene_id), link.scene_id);
    assert.ok(link.use.trim());
  }
  for (const source of bundle.sourceAssets) {
    const actual = production.assets.find((asset) => asset.id === source.id)!;
    assert.deepEqual(actual.requiredSceneIds, source.scenes);
    assert.equal(actual.canonicalSpec.visualDescription, source.requirement);
    assert.deepEqual(actual.canonicalSpec.referenceRequirements, [source.reference]);
    assert.deepEqual([...bundle.sceneAssetLinks.filter((link) => link.asset_id === source.id).map((link) => link.scene_id)].sort(), [...source.scenes].sort());
    assert.ok(PRODUCTION_CATEGORIES.includes(actual.category));
    if (source.parent) {
      assert.ok(assetIds.has(source.parent));
      assert.ok(production.dependencies.some((edge) => edge.fromId === source.parent && edge.toId === source.id));
    }
  }
});

test("published scene IDs and exact source spans survive native screenplay migration", () => {
  const picture = migratePicturePreparation(makeProdigalSonPicture());
  const hierarchy = picture.screenplay.hierarchy!;
  const scenes = sceneNodes(hierarchy);
  assert.deepEqual(scenes.map((scene) => scene.id), PRODIGAL_SON_SOURCE.scenes.map((scene) => scene.id));
  for (const node of hierarchy.nodes) {
    assert.equal(picture.screenplayFountain.slice(node.sourceStart, node.sourceEnd), node.fountain, node.id);
  }
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay)!;
  assert.equal(boundary.scenes.length, 23);
  assert.deepEqual(boundary.scenes.map((scene) => scene.id), picture.production!.scenes.map((scene) => scene.id));
  for (const scene of boundary.scenes) {
    assert.equal(picture.screenplayFountain.split("\n")[scene.sourceLine - 1].trim(), scene.slugline);
  }
  assert.ok(scenes[21].sourceEnd <= scenes[22].sourceStart);
  assert.ok(!scenes[21].fountain.includes("#PS-S23#"));
});

test("an accepted text import does not invent visual approvals, generated media or runtime usage", () => {
  const picture = makeProdigalSonPicture();
  assert.equal(picture.research!.status, "IN_REVIEW");
  assert.equal(picture.research!.approvedVersionId, null);
  assert.ok(picture.research!.content.sources.length >= 8);
  assert.ok(picture.research!.content.sources.every((source) => source.locator.startsWith("https://") && source.quote === ""));
  assert.equal(picture.screenplay.lastQaReport, null);
  assert.equal(picture.screenplay.lastTelemetry, null);
  assert.equal(picture.screenplay.versions.at(-1)!.model, null);
  assert.equal(picture.sample, undefined);
  assert.equal(picture.thumbnailUrl, PRODIGAL_SON_VISUAL_REFERENCE_URI);
  assert.equal(picture.production!.sourceBoundary, null);
  assert.equal(picture.production!.productionAuthority, null);
  assert.deepEqual(picture.production!.preparedAssets, []);
  assert.deepEqual(picture.production!.queue, []);
  for (const asset of picture.production!.assets) {
    assert.equal(asset.canonicalApproved, false);
    assert.equal(asset.approvedIterationId, null);
    assert.equal(asset.approvedSpecVersionId, null);
    assert.ok(asset.specVersions!.every((spec) => !spec.approved));
    if (asset.category === "character") {
      assert.equal(asset.iterations.length, 1);
      assert.equal(asset.iterations[0].mediaUri, `/pictures/prodigal-son/character-assets/${asset.id}.png`);
      assert.equal(asset.iterations[0].status, "NEEDS_REVIEW");
    } else if (asset.iterations.length) {
      assert.equal(asset.iterations.length, 1);
      assert.equal(asset.iterations[0].mediaUri, `/pictures/prodigal-son/generated-assets/${asset.id}.png`);
      assert.equal(asset.iterations[0].status, "NEEDS_REVIEW");
    } else {
      assert.deepEqual(asset.iterations, []);
    }
    assert.deepEqual(asset.references, []);
    assert.equal(asset.readiness, "READY_FOR_REVIEW");
  }
  for (const asset of picture.production!.assets.filter((asset) => /^PS-(GFX|INS)-/.test(asset.id))) assert.equal(isVisualAsset(asset), false);
  assert.deepEqual(picture.shots, []);
  assert.deepEqual(picture.performance!.beats, []);
  assert.deepEqual(picture.performance!.shots, []);
  assert.deepEqual(picture.voices, []);
  assert.deepEqual(picture.usage, { llm: 0, stills: 0, clips: 0, tts: 0 });
  assert.ok(picture.production!.assets.find((asset) => asset.id === "PS-PRP-RING")!.canonicalSpec.continuityLocks.some((lock) => lock.includes("PS-CONT-07")));
});

test("visual development board backfills only the Prodigal Son thumbnail and is removed from asset references", () => {
  const picture = makeProdigalSonPicture();
  const legacy = {
    ...picture,
    thumbnailUrl: null,
    production: {
      ...picture.production!,
      assets: picture.production!.assets.map((asset) => ({
        ...asset,
        references: [{ id: "bad-board-ref", name: "Do not use as asset reference", uri: PRODIGAL_SON_VISUAL_REFERENCE_URI, mediaType: "image/png", preferred: true, uploadedAt: 1, provenance: { sourceType: "user" as const, screenplayVersionId: picture.production!.screenplayVersionId, sceneIds: asset.requiredSceneIds, createdAt: 1 } }],
      })),
    },
  };
  const hydrated = hydrateProdigalSonVisualReference(legacy);
  assert.equal(hydrated.thumbnailUrl, PRODIGAL_SON_VISUAL_REFERENCE_URI);
  assert.equal(hydrated.production!.assets.length, 129);
  assert.equal(hydrated.production!.assets.every((asset) => !asset.references.some((reference) => reference.uri === PRODIGAL_SON_VISUAL_REFERENCE_URI)), true);
  assert.equal(hydrated.production!.assets.filter((asset) => asset.category === "character" && asset.iterations.some((iteration) => iteration.mediaUri === `/pictures/prodigal-son/character-assets/${asset.id}.png`)).length, 29);
  assert.equal(hydrated.production!.assets.filter((asset) => asset.iterations.some((iteration) => iteration.mediaUri === `/pictures/prodigal-son/generated-assets/${asset.id}.png`)).length, 73);
});

test("native hydration leaves downstream creative work empty and every media gate locked", () => {
  const picture = makeProdigalSonPicture();
  picture.production = sanitizeProductionBreakdown(picture.production);
  picture.performance = migratePicturePerformance(picture);
  picture.visualDevelopment = hydrateVisualDevelopmentState(picture.visualDevelopment, picture);
  picture.cinematography = hydrateCinematographyState(picture.cinematography, picture);
  picture.promptLab = hydratePromptLabState(picture.promptLab);
  picture.generateGates = hydrateGenerateGates(picture.generateGates, picture);
  assert.deepEqual(picture.visualDevelopment.boards, []);
  assert.deepEqual(picture.visualDevelopment.characterBibles, []);
  assert.deepEqual(picture.visualDevelopment.approvals, []);
  assert.deepEqual(picture.cinematography.manifestoVersions, []);
  assert.deepEqual(picture.cinematography.sequenceArcs, []);
  assert.deepEqual(picture.cinematography.shotPlans, []);
  assert.deepEqual(picture.cinematography.qaReports, []);
  assert.deepEqual(picture.performance!.beats, []);
  assert.deepEqual(picture.performance!.shots, []);
  assert.deepEqual(picture.performance!.queue, {});
  assert.deepEqual(picture.promptLab.drafts, []);
  assert.deepEqual(picture.promptLab.benchmarks, []);
  assert.deepEqual(picture.generateGates.pairs, []);
  assert.deepEqual(picture.generateGates.prompts, []);
  assert.deepEqual(picture.generateGates.iterations, []);
  const gates = generateGateReadiness(picture);
  assert.equal(gates[0].required, 125, "Graphics and existing-scene inserts use manual/reuse fulfillment.");
  assert.ok(gates.every((gate) => gate.status === "LOCKED" && gate.approved === 0));
  const readiness = movieReadiness(picture);
  for (const id of ["visual-development", "cinematography", "performance"]) assert.equal(readiness.find((item) => item.id === id)!.status, "placeholder", id);
  assert.equal(readiness.find((item) => item.id === "images")!.status, "placeholder");
  assert.equal(picture.performance!.scenes.at(-1)!.id, "PS-S23");
  assert.equal(picture.performance!.scenes.at(-1)!.durationSec, 30);
  assert.equal(picture.production!.assets.length, 129);
  assert.equal(picture.production!.screenplayVersionId, approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay)!.screenplayVersionId);
});

test("bundle installation is duplicate-free, preserves edits and restores missing bundles across reloads", () => {
  const oldPicture = { ...makeProdigalSonPicture(), id: "existing-user-picture", title: "Existing picture" };
  const first = mergeBundledPictures([oldPicture]);
  assert.equal(first.pictures.length, 2);
  assert.equal(first.pictures[0], oldPicture);
  const again = mergeBundledPictures(first.pictures, first.installedBundledPictureIds);
  assert.equal(again.pictures, first.pictures);
  assert.equal(again.pictures.filter((picture) => picture.id === PRODIGAL_SON_PICTURE_ID).length, 1);
  const edited = { ...first.pictures[1], title: "My edited title", directorNotes: "Keep this user edit" };
  const afterEdit = mergeBundledPictures([oldPicture, edited], []);
  assert.equal(afterEdit.pictures[1], edited);
  const persistedAfterDelete = JSON.parse(JSON.stringify({ ...afterEdit, pictures: [oldPicture] }));
  const afterDelete = mergeBundledPictures(persistedAfterDelete.pictures, persistedAfterDelete.installedBundledPictureIds);
  assert.equal(afterDelete.pictures.length, 2);
  assert.equal(afterDelete.pictures[0].title, "Existing picture");
  assert.equal(afterDelete.pictures.filter((picture) => picture.id === PRODIGAL_SON_PICTURE_ID).length, 1);
  assert.deepEqual(afterDelete.installedBundledPictureIds, [PRODIGAL_SON_PICTURE_ID]);
});

test("each factory result is independent and complete metadata survives serialized persistence", () => {
  const first = makeProdigalSonPicture();
  const second = makeProdigalSonPicture();
  first.production!.assets[0].canonicalSpec.visualDescription = "User changed this";
  first.importedPackage!.sourceAssets[0].name = "Another local edit";
  assert.notEqual(second.production!.assets[0].canonicalSpec.visualDescription, "User changed this");
  assert.equal(second.importedPackage!.sourceAssets[0].name, "Jesus");
  const restored = migratePicturePreparation(JSON.parse(JSON.stringify(second)));
  restored.production = sanitizeProductionBreakdown(restored.production);
  assert.deepEqual(restored.importedPackage, second.importedPackage);
  assert.deepEqual(restored.production!.assets.map((asset) => asset.id), second.production!.assets.map((asset) => asset.id));
  assert.equal(restored.production!.assets.length, 129);
  assert.equal(Object.keys(restored.assetImagePrompts ?? {}).length, 129);
  assert.equal(restored.importedPackage!.sourceAssets.filter((asset) => asset.scene_count !== undefined).length, 129);
  assert.equal(restored.importedPackage!.timingPlan.length, 23);
  assert.equal(restored.importedPackage!.sceneAssetLinks.length, 539);
  assert.equal(restored.importedPackage!.continuity.length, 29);
  assert.ok(JSON.stringify(second).length < 2_250_000, "Text metadata should stay within a reasonable localStorage footprint.");
});

test("all supplied download files exactly match their source SHA-256 and text payloads", () => {
  const picture = makeProdigalSonPicture();
  for (const [fileName, expectedHash] of Object.entries(PRODIGAL_SON_SOURCE.sourceSha256)) {
    const content = readFileSync(new URL(`../../..${RESOURCE_PATH}/${fileName}`, import.meta.url));
    assert.equal(createHash("sha256").update(content).digest("hex"), expectedHash, fileName);
  }
  assert.equal(readFileSync(new URL(`../../..${RESOURCE_PATH}/Prodigal_Son.fountain`, import.meta.url), "utf8"), picture.screenplayFountain);
  assert.ok(picture.importedPackage!.resources.every((resource) => resource.href.startsWith("/pictures/prodigal-son/") && PRODIGAL_SON_SOURCE.sourceSha256[resource.fileName as keyof typeof PRODIGAL_SON_SOURCE.sourceSha256]));
});

const RESOURCE_PATH = "/public/pictures/prodigal-son";
