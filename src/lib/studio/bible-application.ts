import type { Picture, Shot } from "./types.ts";
import { assembledBibleScreenplay, parseBibleResponse, type BibleRun } from "./bible-run.ts";
import { appendScreenplayVersion } from "./screenplay.ts";
import { emptyAudioWorkspace, type SoundCueRecord } from "../production/audio-types.ts";
import { addMissingAsset } from "../production/breakdown.ts";
import { editBibleField, movieBibleIndex } from "./movie-bible.ts";
import {
  buildPerformanceWorkspace,
  insertOrReplaceShot,
  decomposeSceneToBeats,
} from "../performance/domain.ts";
import { migrateLegacyShotToCanonicalShot } from "../performance/legacy-migration.ts";

export function applyBibleScreenplay(picture: Picture, run: BibleRun): Picture {
  if (run.status !== "complete") throw new Error("Complete the package before applying it.");
  const id = `spv:${run.id}`;
  if (picture.screenplay.versions.some((v) => v.id === id)) return picture;
  return {
    ...picture,
    screenplay: appendScreenplayVersion(picture.screenplay, {
      id,
      label: "Complete Bible — working draft",
      kind: "draft",
      fountain: assembledBibleScreenplay(run),
      createdAt: Date.now(),
      model: null,
      workflow: picture.screenplay.workflow,
      pass: null,
      sourceVersionId: picture.screenplay.currentVersionId,
      settings: null,
    }),
  };
}

/** Explicit application after the screenplay's existing approval gate, never machine approval. */
export function applyBiblePlanning(picture: Picture, run: BibleRun): Picture {
  const approved = picture.screenplay.versions.find(
    (v) => v.id === picture.screenplay.approvedVersionId,
  );
  if (run.status !== "complete" || approved?.fountain !== assembledBibleScreenplay(run))
    throw new Error(
      "Approve this exact full screenplay in Screenplay before applying its production plan.",
    );
  if (picture.bibleAppliedPlans?.includes(run.id)) return picture;
  let next = {
    ...picture,
    shots: [...picture.shots],
    audio: { ...(picture.audio ?? emptyAudioWorkspace()), cues: [...(picture.audio?.cues ?? [])] },
  };
  next.performance =
    picture.performance ??
    buildPerformanceWorkspace(
      picture.id,
      {
        pictureId: picture.id,
        screenplayVersionId: approved.id,
        approvedAt: picture.updatedAt,
        sceneIds: picture.scenes.map((scene) => scene.id),
        socialWorld: picture.production?.socialWorld ?? [],
        sourceType: "screenplay",
      },
      picture.scenes,
    );
  if (next.performance.approvedScreenplay.screenplayVersionId !== approved.id)
    throw new Error(
      "Synchronize the performance workspace with this approved screenplay before applying its plan.",
    );
  const usedScenes = new Set<string>();
  for (const planned of run.scenes) {
    const scene = picture.scenes.find((s) => s.slugline === planned.title && !usedScenes.has(s.id));
    if (!scene)
      throw new Error(
        `Approved scene is not synchronized: ${planned.title}. Prepare the approved screenplay scenes first.`,
      );
    usedScenes.add(scene.id);
    const authoredUnit = run.units
      .filter(
        (u) =>
          u.sceneId === planned.id &&
          ["P2", "P4"].includes(u.phase) &&
          ["accepted", "checkpoint"].includes(u.status),
      )
      .at(-1);
    if (authoredUnit) {
      const authored = parseBibleResponse(authoredUnit.candidates.at(-1)!.text);
      for (const [field, value] of [
        ["Narrative purpose", planned.purpose],
        ["Incoming situation", authored.incomingState],
        ["Visual / VFX development", authored.visualDevelopment],
        ["Sound development / intentional silence", authored.soundDevelopment],
        ["Musical development", authored.musicDevelopment],
        ["Outgoing continuity", authored.outgoingState],
      ])
        if (typeof value === "string")
          next.movieBible = editBibleField(
            next,
            scene.id,
            "scene",
            String(field),
            value,
            authoredUnit.id,
          );
    }
    if (picture.shots.some((s) => s.sceneId === scene.id))
      throw new Error(
        `Existing coverage for ${scene.slugline} is preserved. Apply the proposed changes through its shot editor instead of appending duplicate coverage.`,
      );
    const sceneOffset = next.shots.reduce((sum, s) => sum + s.durationSec, 0);
    if (!next.performance.beats.some((beat) => beat.sceneId === scene.id))
      next.performance = {
        ...next.performance,
        beats: [...next.performance.beats, ...decomposeSceneToBeats(scene)],
      };
    const unit = run.units
      .filter(
        (u) =>
          u.sceneId === planned.id &&
          u.phase === "P5" &&
          ["accepted", "checkpoint"].includes(u.status),
      )
      .at(-1);
    if (!unit) throw new Error(`Missing shot/asset/cue plan for ${planned.title}`);
    const plan = parseBibleResponse(unit.candidates.at(-1)!.text);
    const shots = plan.shots as {
      name: string;
      camera: string;
      durationSeconds: number;
      performance: string;
      videoPrompt: string;
      incomingState: string;
      outgoingState: string;
      references: Array<{
        role:
          | "characterReference"
          | "wardrobe"
          | "location"
          | "props"
          | "firstFrame"
          | "lastFrame"
          | "additional";
        sourceId?: string;
        assetName?: string;
      }>;
    }[];
    for (const [i, s] of shots.entries()) {
      const shot: Shot = {
        id: `shot:${run.id}:${planned.id}:${i}`,
        sceneId: scene.id,
        index: next.shots.length + 1,
        type: "authored coverage",
        description: s.performance,
        durationSec: s.durationSeconds,
        camera: s.camera,
        lens: "",
        cameraMove: "",
        emotion: "",
        expression: s.performance,
        t2iPrompt: "",
        i2vPrompt: s.videoPrompt,
        t2voicePrompt: "",
      };
      next.shots.push(shot);
      next.movieBible = editBibleField(
        next,
        shot.id,
        "shot",
        "Complete local video prompt",
        s.videoPrompt,
        unit.id,
      );
      const canonical = migrateLegacyShotToCanonicalShot({
        shotId: shot.id,
        pictureId: picture.id,
        sceneId: scene.id,
        beatId: next.performance.beats.find((beat) => beat.sceneId === scene.id)!.id,
        sequenceOrder: shot.index,
        intendedEngine: picture.selectedEngine.video,
        durationSec: shot.durationSec,
        legacy: shot,
      });
      // Preserve authored editorial duration and performance; do not grant media approval.
      canonical.durationSec = shot.durationSec;
      canonical.subject.actions = [s.performance];
      for (const reference of s.references) {
        let targetId = reference.sourceId;
        let proposedCharacterId: string | undefined;
        if (!targetId && reference.assetName) {
          const proposed = (plan.assets as { name: string; sourceId?: string }[])
            .map((asset, index) => ({ asset, index }))
            .filter((item) => item.asset.name === reference.assetName);
          if (proposed.length !== 1)
            throw new Error(
              `Shot ${s.name}: proposed reference ${reference.assetName} is missing or ambiguous.`,
            );
          if (
            proposed[0].asset.sourceId &&
            !next.production?.assets.some(
              (asset) => asset.id === proposed[0].asset.sourceId && !asset.tombstone,
            )
          )
            throw new Error(
              `Proposed asset ${reference.assetName} names a missing existing source ID.`,
            );
          targetId =
            proposed[0].asset.sourceId || `asset:${run.id}:${planned.id}:${proposed[0].index}`;
          if ((plan.assets as { category?: string }[])[proposed[0].index].category === "character")
            proposedCharacterId = targetId;
        } else if (
          targetId &&
          !movieBibleIndex(next).some(
            (row) =>
              row.id === targetId &&
              [
                "asset",
                "character",
                "location",
                "prop",
                "wardrobe",
                "reference",
                "iteration",
              ].includes(row.kind),
          )
        ) {
          throw new Error(
            `Shot ${s.name}: reference ${targetId} does not resolve to canonical source media or an asset.`,
          );
        }
        if (!targetId) throw new Error(`Shot ${s.name}: missing reference source.`);
        canonical.references[reference.role] = [
          ...new Set([...(canonical.references[reference.role] ?? []), targetId]),
        ];
        if (reference.role === "characterReference") {
          const owner = next.production?.assets.find(
            (asset) =>
              !asset.tombstone &&
              asset.category === "character" &&
              (asset.id === targetId ||
                asset.references.some((ref) => ref.id === targetId) ||
                asset.iterations.some((iteration) => iteration.id === targetId)),
          );
          const characterId =
            owner?.id ??
            next.characters.find((character) => character.id === targetId)?.id ??
            proposedCharacterId;
          if (!characterId)
            throw new Error(
              `Reference ${targetId} does not identify a character. Identity and scene-composition roles cannot be interchanged.`,
            );
          canonical.subject.characters = [
            ...new Set([...canonical.subject.characters, characterId]),
          ];
        }
      }
      next.performance = insertOrReplaceShot(next.performance, canonical);
      next.movieBible = editBibleField(
        next,
        shot.id,
        "shot",
        "Incoming physical state",
        s.incomingState,
        unit.id,
      );
      next.movieBible = editBibleField(
        next,
        shot.id,
        "shot",
        "Outgoing physical state",
        s.outgoingState,
        unit.id,
      );
    }
    for (const [i, c] of (
      plan.cues as {
        kind: string;
        description: string;
        startSeconds: number;
        durationSeconds: number;
        perspective?: string;
        mixPriority?: string;
        instrumentation?: string;
        motif?: SoundCueRecord["motif"];
        vocalPolicy?: string;
        syncLandmarks?: string;
        tailSeconds?: number;
        transition?: string;
        destination?: string;
      }[]
    ).entries()) {
      const kind: SoundCueRecord["kind"] =
        c.kind === "music"
          ? "score"
          : c.kind === "sfx"
            ? "environment"
            : (c.kind as SoundCueRecord["kind"]);
      next.audio.cues.push({
        id: `cue:${run.id}:${planned.id}:${i}`,
        name: c.description.split("\n")[0],
        kind,
        sceneId: scene.id,
        shotId: null,
        startSec: sceneOffset + c.startSeconds,
        durationSec: c.durationSeconds,
        notes: c.description,
        instrumentation: c.instrumentation ?? "",
        motif: c.motif,
        vocalPolicy: c.vocalPolicy,
        syncLandmarks: c.syncLandmarks,
        tailSec: c.tailSeconds,
        transition: c.transition,
        destination: c.destination,
        perspective: c.perspective,
        mixPriority: c.mixPriority,
        revision: 1,
        sourceHash: run.sourceHash,
      });
    }
    const assets = plan.assets as {
      name: string;
      category?: "character" | "location" | "prop" | "wardrobe" | "other";
      imagePrompt: string;
      sourceId?: string;
      missingReferences: string[];
    }[];
    if (assets.length && (!next.production || next.production.screenplayVersionId !== approved.id))
      throw new Error(
        "Prepare the approved screenplay inventory before applying its asset proposals.",
      );
    for (const [i, a] of assets.entries()) {
      // Existing identity is never overwritten by a generated proposal.
      if (a.sourceId && next.production?.assets.some((existing) => existing.id === a.sourceId))
        continue;
      if (a.sourceId)
        throw new Error(
          `Asset ${a.name} names missing source ${a.sourceId}. Correct its source binding instead of duplicating an identity.`,
        );
      const assetId = `asset:${run.id}:${planned.id}:${i}`;
      next.production = addMissingAsset(next.production!, {
        assetId,
        requirementId: `requirement:${assetId}`,
        name: a.name,
        category: a.category ?? "other",
        description: a.imagePrompt,
        sceneIds: [scene.id],
        referenceRequired: a.missingReferences.length > 0,
      });
      next.assetImagePrompts = { ...next.assetImagePrompts, [assetId]: a.imagePrompt };
    }
  }
  return {
    ...next,
    bibleAppliedPlans: [...(picture.bibleAppliedPlans ?? []), run.id],
    updatedAt: Date.now(),
  };
}
