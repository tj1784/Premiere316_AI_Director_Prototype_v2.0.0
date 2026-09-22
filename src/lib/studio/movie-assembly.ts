import type { Picture } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { resolveShotPacket, shotPacketFreshness } from "./resolved-shot-packet.ts";
import { measuredSpeechAudit } from "./speech-review.ts";
import { selectedEditorialClips } from "./editorial-clips.ts";

export function continuationSourceIssue(picture: Picture, takeId: string) {
  const take = picture.video?.takes.find((item) => item.id === takeId);
  const shot = picture.shots.find((item) => item.id === take?.shotId);
  if (!take || !shot) return "Predecessor take or its source shot is missing.";
  if (shotPacketFreshness(picture, shot, take.jobId, take.id).status !== "current")
    return "Re-review the predecessor against its current sources before binding a continuation.";
  return null;
}

/** Full-length assembly is separate from the preserved 10s/30s demonstration exports. */
export function movieAssemblyPlan(picture: Picture) {
  const issues: string[] = [];
  if (!Number.isFinite(picture.fps) || picture.fps <= 0 || picture.fps > 120)
    issues.push("Delivery frame rate must be greater than zero and at most 120 fps.");
  if (picture.cues.length && !picture.audio?.cues.length)
    issues.push(
      "Legacy sound cues need source-bound timing and reviewed media in Sound & music before final assembly.",
    );
  let durationSec = 0;
  const ratioParts = picture.format.split(":").map(Number);
  const aspect =
    ratioParts.length === 2 && ratioParts.every((n) => Number.isFinite(n) && n > 0)
      ? ratioParts[0] / ratioParts[1]
      : 0;
  if (!aspect || aspect < 0.2 || aspect > 5)
    issues.push(
      "Choose a supported numeric picture aspect ratio before delivery (for example 16:9 or 2.39:1).",
    );
  const width = aspect >= 1 ? 1920 : Math.max(16, Math.round((1920 * aspect) / 2) * 2);
  const height = aspect >= 1 ? Math.max(16, Math.round(1920 / aspect / 2) * 2) : 1920;
  const clips = picture.shots.flatMap((shot) => {
    const packet = resolveShotPacket(picture, shot);
    issues.push(...packet.render.issues);
    const selection = selectedEditorialClips(picture, shot);
    issues.push(...selection.issues);
    const total = selection.takes.reduce((sum, take) => sum + (take?.probe?.durationSec ?? 0), 0);
    if (Math.abs(total - shot.durationSec) > 1 / (picture.fps || 24) + 0.05)
      issues.push(
        `${shot.id}: actual clip sequence duration differs from editorial timing. Resolve the edit explicitly; assembly will not trim or stretch it.`,
      );
    return selection.takes.map((take, clipIndex) => {
      if (!Number.isFinite(take?.probe?.durationSec) || (take?.probe?.durationSec ?? 0) <= 0)
        issues.push(`${shot.id}: valid measured clip duration is required.`);
      if (!take?.probe?.ok || !take.mediaUri || !take.mediaSha256)
        issues.push(`${shot.id}: reviewed, probed video is missing.`);
      if (
        !selection.sequence &&
        take &&
        shotPacketFreshness(picture, shot, take.jobId, take.id).status !== "current"
      )
        issues.push(
          `${shot.id}: review this take against the current source before final assembly.`,
        );
      if (
        !selection.sequence &&
        take &&
        Math.abs((take.probe?.durationSec ?? 0) - shot.durationSec) > 1 / (picture.fps || 24) + 0.05
      )
        issues.push(
          `${shot.id}: actual duration differs from editorial timing. Resolve the edit explicitly; assembly will not trim or stretch it.`,
        );
      const clip = {
        shotId: shot.id,
        clipIndex,
        editorialReviewId: selection.sequence?.id ?? null,
        takeId: take?.id ?? "",
        mediaUri: take?.mediaUri ?? "",
        sha256: take?.mediaSha256 ?? "",
        durationSec: take?.probe?.durationSec ?? 0,
        startSec: durationSec,
        sourcePacket: packet,
      };
      durationSec += clip.durationSec;
      return clip;
    });
  });
  if (!clips.length || clips.length > 500 || durationSec > 14400)
    issues.push("Choose 1–500 reviewed clips totaling at most four hours.");
  const sounds = (picture.audio?.cues ?? []).flatMap((cue) => {
    if (cue.kind === "silence") {
      if (!cue.notes.trim())
        issues.push(`${cue.id}: intentional silence needs an authored reason.`);
      return [];
    }
    // Dialogue must stay in the selected native audiovisual output, never hidden TTS replacement.
    if (cue.kind === "dialogue") return [];
    const take = picture.audio?.takes.find((item) => item.cueId === cue.id && item.canonical);
    if (
      !take?.probe?.ok ||
      !take.mediaUri ||
      !take.mediaSha256 ||
      take.cueFingerprint !== stableHash(cue)
    )
      issues.push(`${cue.id}: current source-bound, reviewed audio is missing.`);
    const seconds = cue.durationSec + (cue.tailSec ?? 0);
    if (
      !Number.isFinite(cue.startSec) ||
      cue.startSec < 0 ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      cue.startSec + seconds > durationSec + 0.05
    )
      issues.push(`${cue.id}: cue/tail falls outside the authored movie timeline.`);
    if (take && Math.abs((take.probe?.durationSec ?? 0) - seconds) > 1)
      issues.push(`${cue.id}: rendered duration does not match the cue and tail.`);
    return [
      {
        cueId: cue.id,
        takeId: take?.id ?? "",
        mediaUri: take?.mediaUri ?? "",
        sha256: take?.mediaSha256 ?? "",
        startSec: cue.startSec,
        durationSec: seconds,
        sourceFingerprint: stableHash(cue),
      },
    ];
  });
  const speech = measuredSpeechAudit(picture);
  if (sounds.length > 1000)
    issues.push("This assembly supports at most 1,000 separately authored audio cues.");
  if (speech.blocksDelivery) issues.push(speech.reason);
  return {
    schemaVersion: 1 as const,
    pictureId: picture.id,
    fps: picture.fps || 24,
    format: picture.format,
    width,
    height,
    durationSec,
    clips,
    sounds,
    speech,
    issues,
    ok: !issues.length,
  };
}
export type MovieAssemblyPlan = ReturnType<typeof movieAssemblyPlan>;
export type MovieAssemblyResult =
  | {
      ok: true;
      id: string;
      outputPath: string;
      manifestPath: string;
      sha256: string;
      durationSec: number;
    }
  | { ok: false; error: string };
export type MovieDelivery = Extract<MovieAssemblyResult, { ok: true }> & {
  createdAt: number;
  plan: MovieAssemblyPlan;
  reviews?: Array<{
    id: string;
    decision: "approve" | "reject";
    reason: string;
    sha256: string;
    at: number;
  }>;
};
export function reviewMovieDelivery(
  picture: Picture,
  id: string,
  decision: "approve" | "reject",
  reason: string,
): Picture {
  const delivery = picture.movieAssemblies?.find((item) => item.id === id);
  if (!delivery || !/^[a-f0-9]{64}$/i.test(delivery.sha256) || !reason.trim())
    throw new Error("A rendered, hashed delivery and observed final review are required.");
  const current = movieAssemblyPlan(picture);
  if (decision === "approve" && (!current.ok || stableHash(current) !== stableHash(delivery.plan)))
    throw new Error(
      "Current sources/takes differ from this delivery. Keep it as history and assemble the current approved selection.",
    );
  return {
    ...picture,
    movieAssemblies: picture.movieAssemblies!.map((item) =>
      item.id === id
        ? {
            ...item,
            reviews: [
              ...(item.reviews ?? []),
              {
                id: `delivery-review:${crypto.randomUUID()}`,
                decision,
                reason: reason.trim(),
                sha256: item.sha256,
                at: Date.now(),
              },
            ],
          }
        : item,
    ),
  };
}
