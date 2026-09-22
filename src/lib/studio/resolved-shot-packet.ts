import type { Picture, Shot } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { resolveRenderContext } from "./render-context.ts";
/** Immutable compilation evidence; actual media inspection remains a separate backend check. */
export function resolveShotPacket(picture: Picture, shot: Shot) {
  const canonical = picture.performance?.shots.find(
    (s) => s.shotId === shot.id || s.legacy?.id === shot.id,
  );
  const referenceIds = [
    ...(canonical?.references.characterReference ?? []),
    ...(canonical?.references.location ?? []),
    ...(canonical?.references.wardrobe ?? []),
    ...(canonical?.references.props ?? []),
  ];
  const assets = (picture.production?.assets ?? []).filter(
    (a) =>
      !a.tombstone &&
      (a.requiredSceneIds.includes(shot.sceneId) ||
        referenceIds.includes(a.id) ||
        a.references.some((r) => referenceIds.includes(r.id))),
  );
  const bindings = assets.map((asset) => {
    const iteration = asset.iterations.find((i) => i.id === asset.approvedIterationId);
    return {
      assetId: asset.id,
      identityRevision: stableHash(asset.canonicalSpec),
      role: asset.category,
      selectedIterationId: asset.approvedIterationId ?? null,
      iteration: iteration
        ? {
            id: iteration.id,
            uri: iteration.mediaUri,
            sha256: iteration.mediaSha256 ?? null,
            status: iteration.status,
          }
        : null,
      references: asset.references
        .filter((r) => r.preferred || referenceIds.includes(r.id))
        .map((r) => ({
          id: r.id,
          uri: r.uri,
          mediaType: r.mediaType,
          revision: String(r.uploadedAt),
        })),
      disposition:
        iteration?.mediaSha256 && iteration.status === "APPROVED"
          ? "approved metadata — bytes checked at submission"
          : "missing approved media; only dependent media modes are blocked",
    };
  });
  const sourceIds = new Set([
    picture.id,
    shot.sceneId,
    shot.id,
    ...assets.map((a) => a.id),
    ...(canonical?.subject.characters ?? []),
    ...(picture.shotContinuity?.[shot.id]?.participants.map((p) => p.characterId) ?? []),
  ]);
  const authoredText = `${shot.description} ${shot.i2vPrompt} ${shot.t2voicePrompt}`.toLowerCase();
  for (const character of picture.characters)
    if (character.name.trim() && authoredText.includes(character.name.toLowerCase()))
      sourceIds.add(character.id);
  if (canonical?.beatId)
    for (const characterId of canonical.subject.characters)
      sourceIds.add(`performance:${canonical.beatId}:${characterId}`);
  const fields = Object.values(picture.movieBible?.records ?? {}).filter((r) =>
    sourceIds.has(r.recordId),
  );
  // Compiler/review bookkeeping cannot change the authored source fingerprint.
  const coverage = canonical
    ? {
        shotId: canonical.shotId,
        canonicalShotId: canonical.canonicalShotId,
        sceneId: canonical.sceneId,
        beatId: canonical.beatId,
        durationSec: canonical.durationSec,
        framing: canonical.framing,
        camera: canonical.camera,
        subject: canonical.subject,
        performanceIn: canonical.performanceIn,
        performanceOut: canonical.performanceOut,
        world: canonical.world,
        continuity: canonical.continuity,
        audio: canonical.audio,
        references: canonical.references,
        negatives: canonical.negatives,
        intendedEngine: canonical.intendedEngine,
        legacy: canonical.legacy,
      }
    : {
        camera: shot.camera,
        lens: shot.lens,
        path: shot.cameraMove,
        durationSec: shot.durationSec,
        action: shot.i2vPrompt,
        description: shot.description,
        dialogue: shot.t2voicePrompt,
      };
  const packet = {
    schemaVersion: 1,
    pictureId: picture.id,
    sceneId: shot.sceneId,
    shotId: shot.id,
    screenplayVersionId: picture.screenplay?.approvedVersionId ?? null,
    coverage,
    sourceFields: fields,
    render: resolveRenderContext(picture, shot),
    continuity: picture.shotContinuity?.[shot.id] ?? null,
    references: bindings,
    // Preserve exact source values beside IDs so historical jobs remain intelligible after edits.
    sourceRecords: {
      scene: picture.scenes.find((scene) => scene.id === shot.sceneId) ?? null,
      characters: picture.characters.filter((character) => sourceIds.has(character.id)),
      participantDirection: canonical?.beatId
        ? (picture.performance?.performance[canonical.beatId] ?? null)
        : null,
      assetSpecifications: assets.map((asset) => ({
        id: asset.id,
        specification: asset.canonicalSpec,
        selectedIterationId: asset.approvedIterationId,
      })),
      voiceBindings: picture.voices.filter((voice) =>
        picture.characters.some(
          (character) => sourceIds.has(character.id) && character.voiceId === voice.id,
        ),
      ),
    },
    audio: (picture.audio?.cues ?? []).filter(
      (c) => c.shotId === shot.id || c.sceneId === shot.sceneId,
    ),
    modeEvidence:
      "Mode requirements and actual byte inspection are enforced by the selected runtime; this packet alone grants no approval.",
  };
  return {
    ...structuredClone(packet),
    id: `packet:${shot.id}:${stableHash(packet)}`,
    fingerprint: stableHash(packet),
  };
}
/** A stale take is retained as history, but cannot silently satisfy a current delivery. */
export function shotPacketFreshness(picture: Picture, shot: Shot, jobId: string, takeId?: string) {
  const take = picture.video?.takes.find((t) => t.id === takeId);
  const review = take?.sourceReviews?.at(-1);
  const saved = picture.video?.jobs.find((j) => j.id === jobId)?.promptPackage.sourcePacket;
  if (!saved && !review)
    return {
      status: "legacy-unbound" as const,
      reason: "No source packet was recorded for this media.",
    };
  const current = resolveShotPacket(picture, shot);
  return (
    review
      ? review.mediaSha256 === take?.mediaSha256 && review.sourceFingerprint === current.fingerprint
      : saved?.fingerprint === current.fingerprint
  )
    ? { status: "current" as const, reason: "Source packet matches current direction." }
    : {
        status: "stale" as const,
        reason: `Source changed after ${review?.id ?? saved?.id}; re-review the affected shot before delivery.`,
      };
}
export function scopedBibleDirection(picture: Picture, shot: Shot) {
  const allowed = new Set([
    "Geography / landmarks / route",
    "Entrances / exits",
    "World positions",
    "Starting frame / subject",
    "Camera position / height / axis",
    "Path / timing / focus / endpoint",
    "Coverage purpose",
    "Visibility budget",
    "Contact / support / weight / recipient",
    "Incoming physical state",
    "Outgoing physical state",
    "Completed events",
  ]);
  return [picture.movieBible?.records[shot.sceneId], picture.movieBible?.records[shot.id]]
    .flatMap((record) =>
      Object.entries(record?.fields ?? {})
        .filter(
          ([key, field]) =>
            allowed.has(key) && field.disposition === "authored" && field.value.trim(),
        )
        .map(
          ([key, field]) =>
            `${key === "Completed events" ? "Already completed; do not replay" : key}: ${field.value}`,
        ),
    )
    .join("\n");
}
