import { makePictureIntake, sourceTextForIntake, type PictureIntake } from "./picture-intake.ts";
import {
  createOriginalIntakeVersion,
  hydrateScreenplayCrew,
  makePictureScreenplay,
  type PictureScreenplay,
  type ScreenplayVersion,
} from "./screenplay.ts";
import type { Picture, StageId } from "./types.ts";

export type PicturePreparation = {
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  lastOpenedStage: StageId;
  thumbnailUrl: string | null;
};

export type PreparedPicture = Picture & PicturePreparation;
export type LegacyPicture = Omit<Picture, keyof PicturePreparation> & Partial<PicturePreparation>;

const VALID_STAGES = new Set<StageId>(["intake", "research", "screenplay", "inventory", "visual-development", "cinematography", "performance", "shots", "prompts", "generate", "review", "timeline", "score", "export"]);

function migratedStage(value: unknown, fallback: StageId): StageId {
  if (value === "brief") return "intake";
  return typeof value === "string" && VALID_STAGES.has(value as StageId) ? value as StageId : fallback;
}

function legacyIntake(picture: LegacyPicture, now: number): PictureIntake {
  return {
    ...makePictureIntake(picture.createdAt || now),
    title: picture.title,
    premise: picture.logline,
    logline: picture.logline,
    targetRuntimeMinutes: picture.runtimeMinutes,
    genre: picture.genre,
    tone: picture.tone,
    aspectRatio: picture.format,
    frameRate: picture.fps,
    directorNotes: picture.directorNotes,
    updatedAt: picture.updatedAt || now,
  };
}

function legacyScreenplay(picture: LegacyPicture, intake: PictureIntake, now: number): PictureScreenplay {
  const state = makePictureScreenplay(intake.workflow, intake.screenplayModelId, picture.updatedAt || now);
  const original = createOriginalIntakeVersion(intake, sourceTextForIntake(intake), `${picture.id}:intake:v1`, picture.createdAt || now);
  if (!picture.screenplayFountain.trim()) return { ...state, versions: [original], currentVersionId: original.id };
  const legacy: ScreenplayVersion = {
    id: `${picture.id}:legacy-screenplay:v1`,
    label: picture.sample ? "Approved Screenplay" : "Imported Screenplay",
    kind: picture.sample ? "approved" : "manual",
    fountain: picture.screenplayFountain,
    createdAt: picture.updatedAt || now,
    model: null,
    workflow: intake.workflow,
    pass: null,
    sourceVersionId: original.id,
    settings: null,
  };
  return {
    ...state,
    status: picture.sample ? "APPROVED" : "READY_FOR_REVIEW",
    versions: [original, legacy],
    currentVersionId: legacy.id,
    approvedVersionId: picture.sample ? legacy.id : null,
    workingFountain: legacy.fountain,
  };
}

export function migratePicturePreparation(
  picture: LegacyPicture,
  now = Date.now(),
): PreparedPicture {
  const intake = picture.intake?.schemaVersion === 1 ? picture.intake : legacyIntake(picture, now);
  const screenplay = hydrateScreenplayCrew(picture.screenplay?.schemaVersion === 1 ? picture.screenplay : legacyScreenplay(picture, intake, now));
  const stage = migratedStage(picture.stage, "intake");
  const lastOpenedStage = migratedStage(picture.lastOpenedStage, stage);
  return {
    ...picture,
    stage,
    intake,
    screenplay,
    screenplayFountain: screenplay.workingFountain || picture.screenplayFountain,
    lastOpenedStage,
    thumbnailUrl: picture.thumbnailUrl ?? picture.shots.find((shot) => shot.stillUrl)?.stillUrl ?? null,
  };
}

export function makePreparationForIntake(intake: PictureIntake, pictureId: string, now = Date.now()): PicturePreparation {
  const original = createOriginalIntakeVersion(intake, sourceTextForIntake(intake), `${pictureId}:intake:${now}`, now);
  return {
    intake: { ...intake, updatedAt: now },
    screenplay: {
      ...makePictureScreenplay(intake.workflow, intake.screenplayModelId, now),
      versions: [original],
      currentVersionId: original.id,
    },
    lastOpenedStage: "research",
    thumbnailUrl: null,
  };
}
