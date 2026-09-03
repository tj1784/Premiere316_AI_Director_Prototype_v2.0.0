import { approvedScreenplayBoundary } from "../studio/screenplay.ts";
import type { Picture, Shot } from "../studio/types.ts";
import type { ProductionAsset, ProductionBreakdown } from "../production/types.ts";
import {
  addPerformanceDirection,
  applyContinuityFlow,
  buildCanonicalShot,
  buildDependencyGraph,
  buildPerformanceWorkspace,
  buildQueue,
  cloneWorkspace,
  createBlankContinuityEnvelope,
  ensureQueueNoRunningState,
} from "./domain.ts";
import { migrateLegacyShotToCanonicalShot } from "./legacy-migration.ts";
import type {
  ApprovedAssetReference,
  ApprovedScreenplayReference,
  CanonicalShotSpec,
  PerformanceDirection,
  PerformanceWorkspace,
  SceneSeed,
} from "./types.ts";

function approvedVersion(asset: ProductionAsset): string | null {
  if (asset.approvedIterationId) return asset.approvedIterationId;
  const variant = asset.variants.find((item) => !item.stale);
  if (variant) return variant.id;
  return asset.canonicalApproved || asset.readiness === "APPROVED" ? `${asset.id}:canonical` : null;
}

export function approvedAssetReference(asset: ProductionAsset): ApprovedAssetReference | null {
  const version = approvedVersion(asset);
  if (!version) return null;
  const referenceUris = [
    ...asset.references.filter((item) => item.preferred).map((item) => item.uri),
    ...asset.iterations.filter((item) => item.id === asset.approvedIterationId).map((item) => item.mediaUri),
  ];
  if (asset.category === "character") {
    return { type: "character", characterId: asset.id, approvedIdentityVersion: version, referenceUris };
  }
  if (asset.category === "location") return { type: "location", locationVersionId: version, referenceUris };
  if (asset.category === "prop") return { type: "prop", propVersionId: version, referenceUris };
  if (asset.category === "wardrobe") return { type: "wardrobe", wardrobeVariantId: version, referenceUris };
  return null;
}

export function approvedReferencesForScene(production: ProductionBreakdown | null | undefined, sceneId: string): ApprovedAssetReference[] {
  if (!production) return [];
  return production.assets
    .filter((asset) => asset.requiredSceneIds.length === 0 || asset.requiredSceneIds.includes(sceneId))
    .map(approvedAssetReference)
    .filter((reference): reference is ApprovedAssetReference => reference !== null);
}

function screenplayReference(picture: Picture): ApprovedScreenplayReference | null {
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay);
  if (boundary) {
    return {
      pictureId: picture.id,
      screenplayVersionId: boundary.screenplayVersionId,
      approvedAt: boundary.approvedAt,
      sceneIds: [],
      socialWorld: picture.production?.socialWorld ?? [],
      sourceType: boundary.historicalContext ? "historical-source" : "screenplay",
    };
  }
  if (!picture.shots.length && !picture.performance) return null;
  return {
    pictureId: picture.id,
    screenplayVersionId: picture.screenplay.approvedVersionId ?? `${picture.id}:legacy-screenplay`,
    approvedAt: picture.updatedAt,
    sceneIds: [],
    socialWorld: picture.production?.socialWorld ?? [],
    sourceType: "legacy-migration",
  };
}

function sceneSeeds(picture: Picture): SceneSeed[] {
  if (picture.scenes.length) {
    return picture.scenes.map((scene) => ({
      id: scene.id,
      slugline: scene.slugline,
      summary: scene.summary,
      durationSec: scene.durationSec,
    }));
  }
  const boundary = approvedScreenplayBoundary(picture.id, picture.intake, picture.screenplay);
  const productionScenes = picture.production?.scenes ?? [];
  return (boundary?.scenes ?? productionScenes).map((scene) => {
    const prepared = productionScenes.find((item) => item.id === scene.id);
    return {
      id: scene.id,
      slugline: scene.slugline,
      summary: prepared?.summary ?? scene.slugline,
      sourceLine: "sourceLine" in scene ? scene.sourceLine : undefined,
    };
  });
}

function defaultShot(
  picture: Picture,
  workspace: PerformanceWorkspace,
  beatIndex: number,
): CanonicalShotSpec {
  const beat = workspace.beats[beatIndex];
  const assets = approvedReferencesForScene(picture.production, beat.sceneId);
  const characters = assets.flatMap((item) => item.type === "character" && item.characterId ? [item.characterId] : []);
  const locationAsset = picture.production?.assets.find((asset) => asset.category === "location" && asset.requiredSceneIds.includes(beat.sceneId));
  return buildCanonicalShot({
    shotId: `${picture.id}:shot:${String(beatIndex + 1).padStart(3, "0")}`,
    pictureId: picture.id,
    sceneId: beat.sceneId,
    beatId: beat.id,
    sequenceOrder: beatIndex + 1,
    durationSec: beat.durationSec,
    framing: { shotSize: beatIndex === 0 ? "establishing" : "coverage", lens: beatIndex === 0 ? "35mm" : "50mm" },
    camera: { style: "static", focusIntent: beat.summary },
    subject: { characters, actions: [beat.summary], approvedReferences: assets },
    performanceIn: createBlankContinuityEnvelope(),
    performanceOut: createBlankContinuityEnvelope(),
    world: {
      location: locationAsset?.name,
      approvedLocationVersion: locationAsset ? approvedVersion(locationAsset) ?? undefined : undefined,
    },
    continuity: {
      requiredIn: createBlankContinuityEnvelope(),
      requiredOut: createBlankContinuityEnvelope(),
      hardLocks: [],
      permittedChanges: [],
    },
    audio: { dialogue: [] },
    references: {
      characterReference: assets.flatMap((item) => item.characterId ? [item.characterId] : []),
      location: assets.flatMap((item) => item.locationVersionId ? [item.locationVersionId] : []),
      props: assets.flatMap((item) => item.propVersionId ? [item.propVersionId] : []),
      wardrobe: assets.flatMap((item) => item.wardrobeVariantId ? [item.wardrobeVariantId] : []),
    },
    negatives: [],
    intendedEngine: picture.selectedEngine.video,
    dependencyState: [workspace.approvedScreenplay.screenplayVersionId, beat.id],
  });
}

function migratedLegacyShots(picture: Picture, workspace: PerformanceWorkspace): CanonicalShotSpec[] {
  return picture.shots.map((shot, index) => {
    const beat = workspace.beats.find((item) => item.sceneId === shot.sceneId) ?? workspace.beats[index % Math.max(1, workspace.beats.length)];
    const approvedReferences = approvedReferencesForScene(picture.production, shot.sceneId);
    return migrateLegacyShotToCanonicalShot({
      shotId: shot.id,
      pictureId: picture.id,
      sceneId: shot.sceneId,
      beatId: beat?.id ?? `${shot.sceneId}:legacy-beat`,
      sequenceOrder: shot.index,
      durationSec: shot.durationSec,
      intendedEngine: picture.selectedEngine.video,
      approvedReferences,
      legacy: {
        id: shot.id,
        type: shot.type,
        description: shot.description,
        camera: shot.camera,
        lens: shot.lens,
        cameraMove: shot.cameraMove,
        emotion: shot.emotion,
        expression: shot.expression,
        t2iPrompt: shot.t2iPrompt,
        i2vPrompt: shot.i2vPrompt,
        stillUrl: shot.stillUrl,
        videoUrl: shot.videoUrl,
      },
    });
  });
}

function directionFromLegacy(picture: Picture, shot: CanonicalShotSpec): PerformanceDirection | null {
  if (!shot.legacy) return null;
  const characterId = shot.subject.characters[0] ?? picture.characters[0]?.id;
  if (!characterId) return null;
  return {
    schemaVersion: 1,
    sourceType: "manual",
    characterId,
    beatId: shot.beatId,
    emotionalState: { primary: shot.legacy.emotion },
    face: { microExpression: shot.legacy.expression },
    updatedAt: shot.updatedAt,
  };
}

export function migratePicturePerformance(picture: Picture): PerformanceWorkspace | null {
  const reference = screenplayReference(picture);
  if (!reference) return null;
  if (picture.performance?.schemaVersion === 1 && picture.performance.pictureId === picture.id) {
    const next = cloneWorkspace(picture.performance);
    next.queue = ensureQueueNoRunningState(next.queue);
    if (next.approvedScreenplay.screenplayVersionId !== reference.screenplayVersionId) {
      next.approvedScreenplay = { ...reference, sceneIds: next.scenes.map((scene) => scene.id) };
      next.shots = next.shots.map((shot) => ({ ...shot, status: "STALE", compilerState: "PLANNED" }));
      next.dependencyGraph = buildDependencyGraph(next);
      next.queue = buildQueue(next);
      next.updatedAt = Date.now();
      next.lastUpdated = next.updatedAt;
    }
    return next;
  }

  const scenes = sceneSeeds(picture);
  reference.sceneIds = scenes.map((scene) => scene.id);
  let workspace = buildPerformanceWorkspace(picture.id, reference, scenes);
  workspace.shots = picture.shots.length
    ? migratedLegacyShots(picture, workspace)
    : workspace.beats.map((_, index) => defaultShot(picture, workspace, index));

  for (const shot of workspace.shots) {
    const direction = directionFromLegacy(picture, shot);
    if (direction) workspace = addPerformanceDirection(workspace, direction);
  }
  workspace = applyContinuityFlow(workspace);
  workspace.dependencyGraph = buildDependencyGraph(workspace);
  workspace.queue = buildQueue(workspace);
  return workspace;
}

export function canonicalShotsToLegacy(shots: CanonicalShotSpec[], previous: Shot[]): Shot[] {
  const previousById = new Map(previous.map((shot) => [shot.id, shot]));
  return [...shots]
    .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
    .map((shot, index) => {
      const prior = previousById.get(shot.shotId);
      const dialogue = shot.audio.dialogue?.map((line) => line.text).join(" ") ?? "";
      return {
        id: shot.shotId,
        sceneId: shot.sceneId,
        index: index + 1,
        type: shot.framing.shotSize ?? shot.legacy?.type ?? prior?.type ?? "coverage",
        description: shot.legacy?.description || shot.subject.actions?.join("; ") || prior?.description || "Prepared performance shot",
        durationSec: shot.durationSec,
        camera: shot.framing.composition ?? shot.legacy?.camera ?? prior?.camera ?? "medium",
        lens: shot.framing.lens ?? shot.legacy?.lens ?? prior?.lens ?? "50mm",
        cameraMove: shot.camera.movementPath ?? shot.camera.style ?? shot.legacy?.cameraMove ?? prior?.cameraMove ?? "static",
        emotion: shot.performanceOut.performance.facialEmotion ?? shot.legacy?.emotion ?? prior?.emotion ?? "restrained",
        expression: shot.legacy?.expression ?? prior?.expression ?? "natural",
        t2iPrompt: shot.legacy?.t2iPrompt ?? prior?.t2iPrompt ?? "",
        i2vPrompt: shot.legacy?.i2vPrompt ?? prior?.i2vPrompt ?? "",
        t2voicePrompt: dialogue || prior?.t2voicePrompt || "",
        stillUrl: shot.legacy?.stillUrl ?? prior?.stillUrl,
        videoUrl: shot.legacy?.videoUrl ?? prior?.videoUrl,
      };
    });
}
