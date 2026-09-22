import type { Picture, Shot } from "./types.ts";
import { resolveShotPacket } from "./resolved-shot-packet.ts";

export type EditorialClipSequence = {
  id: string;
  shotId: string;
  takeIds: string[];
  mediaHashes: string[];
  sourceFingerprint: string;
  reason: string;
  at: number;
};

/** Explicit editorial approval, separate from choosing a single canonical alternative. */
export function approveEditorialClips(
  picture: Picture,
  shotId: string,
  takeIds: string[],
  reason: string,
): Picture {
  const shot = picture.shots.find((item) => item.id === shotId);
  if (
    !shot ||
    !reason.trim() ||
    !takeIds.length ||
    takeIds.length > 100 ||
    new Set(takeIds).size !== takeIds.length
  )
    throw new Error(
      "Choose 1–100 distinct clips in order and record an observed editorial review.",
    );
  const takes = takeIds.map((id) =>
    picture.video?.takes.find((item) => item.id === id && item.shotId === shotId),
  );
  if (
    takes.some(
      (take) =>
        !take?.probe?.ok ||
        !take.mediaUri ||
        !take.mediaSha256 ||
        !["NEEDS_REVIEW", "CANONICAL"].includes(take.status),
    )
  )
    throw new Error(
      "Every clip must be a probed, playable, non-rejected take for this editorial shot.",
    );
  const duration = takes.reduce((sum, take) => sum + (take?.probe?.durationSec ?? 0), 0);
  if (Math.abs(duration - shot.durationSec) > 1 / (picture.fps || 24) + 0.05)
    throw new Error(
      `Selected clips total ${duration.toFixed(2)}s; editorial shot is ${shot.durationSec}s. Resolve the edit first; no implicit trim/stretch.`,
    );
  const receipt: EditorialClipSequence = {
    id: `editorial-clips:${crypto.randomUUID()}`,
    shotId,
    takeIds: [...takeIds],
    mediaHashes: takes.map((take) => take!.mediaSha256!),
    sourceFingerprint: resolveShotPacket(picture, shot).fingerprint,
    reason: reason.trim(),
    at: Date.now(),
  };
  return {
    ...picture,
    editorialClipSequences: [...(picture.editorialClipSequences ?? []), receipt],
    updatedAt: Date.now(),
  };
}

export function selectedEditorialClips(picture: Picture, shot: Shot) {
  const sequence = picture.editorialClipSequences?.filter((item) => item.shotId === shot.id).at(-1);
  if (!sequence)
    return {
      sequence: null,
      takes: [picture.video?.takes.find((item) => item.shotId === shot.id && item.canonical)],
      issues: [] as string[],
    };
  const issues: string[] = [];
  const takes = sequence.takeIds.map((id) =>
    picture.video?.takes.find((item) => item.id === id && item.shotId === shot.id),
  );
  if (sequence.sourceFingerprint !== resolveShotPacket(picture, shot).fingerprint)
    issues.push(
      `${shot.id}: editorial clip sequence is stale; review the current sources and clips.`,
    );
  if (
    !takes.length ||
    new Set(sequence.takeIds).size !== takes.length ||
    takes.some(
      (take, index) =>
        !take?.probe?.ok ||
        take.mediaSha256 !== sequence.mediaHashes[index] ||
        !["NEEDS_REVIEW", "CANONICAL"].includes(take.status),
    )
  )
    issues.push(`${shot.id}: a selected editorial clip is missing, changed or rejected.`);
  return { sequence, takes, issues };
}
