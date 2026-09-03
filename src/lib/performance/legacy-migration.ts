import { SHOT_DURATION_POLICY } from "./types.ts";
import type {
  ApprovedAssetReference,
  CanonicalShotSpec,
  LegacyShotPayload,
} from "./types.ts";
import { buildCanonicalShot, createBlankContinuityEnvelope, normalizeShotDuration } from "./domain.ts";

export type LegacyShotSeed = {
  shotId: string;
  pictureId: string;
  sceneId: string;
  beatId: string;
  sequenceOrder: number;
  intendedEngine: string;
  durationSec?: number;
  approvedReferences?: ApprovedAssetReference[];
  legacy: LegacyShotPayload;
};

export function migrateLegacyShotToCanonicalShot(seed: LegacyShotSeed): CanonicalShotSpec {
  const durationSec = normalizeShotDuration(seed.durationSec ?? SHOT_DURATION_POLICY.targetMinSeconds, SHOT_DURATION_POLICY);
  return buildCanonicalShot({
    shotId: seed.shotId,
    pictureId: seed.pictureId,
    sceneId: seed.sceneId,
    beatId: seed.beatId,
    sequenceOrder: seed.sequenceOrder,
    durationSec,
    framing: {
      shotSize: seed.legacy.type,
      lens: seed.legacy.lens,
      composition: seed.legacy.camera,
    },
    camera: {
      movementPath: seed.legacy.cameraMove,
    },
    subject: {
      characters: [],
      actions: [seed.legacy.emotion],
      interactions: [seed.legacy.expression],
      approvedReferences: seed.approvedReferences,
    },
    performanceIn: createBlankContinuityEnvelope(),
    performanceOut: createBlankContinuityEnvelope(),
    world: {
      atmosphere: seed.legacy.description,
    },
    continuity: {
      requiredIn: createBlankContinuityEnvelope(),
      requiredOut: createBlankContinuityEnvelope(),
    },
    audio: {
      dialogue: [],
    },
    references: {
      additional: [seed.legacy.t2iPrompt, seed.legacy.i2vPrompt].filter((entry): entry is string => typeof entry === "string"),
    },
    negatives: [],
    intendedEngine: seed.intendedEngine,
    dependencyState: [],
    legacy: seed.legacy,
  });
}
