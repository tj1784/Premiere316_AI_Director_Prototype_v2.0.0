import type { Picture } from "./types.ts";
import type { VideoWorkspace } from "../production/video-types.ts";
import { dialogueBudget } from "./creative-preset.ts";
import { selectedEditorialClips } from "./editorial-clips.ts";

export type SpeechReview = {
  id: string;
  mediaSha256: string;
  durationSec: number;
  spans: Array<{ startSec: number; endSec: number }>;
  reason: string;
  at: number;
};

/** Human measured intervals, not inferred silence from a missing transcript. */
export function recordSpeechReview(
  workspace: VideoWorkspace,
  takeId: string,
  spans: SpeechReview["spans"],
  reason: string,
): VideoWorkspace {
  const take = workspace.takes.find((item) => item.id === takeId);
  const duration = take?.probe?.durationSec;
  if (!take?.mediaSha256 || !take.probe?.ok || !duration || !reason.trim())
    throw new Error("Review requires probed media, its hash, and an observed explanation.");
  if (
    spans.some(
      (span) =>
        !Number.isFinite(span.startSec) ||
        !Number.isFinite(span.endSec) ||
        span.startSec < 0 ||
        span.endSec <= span.startSec ||
        span.endSec > duration,
    )
  )
    throw new Error("Speech intervals must be finite, ordered within the actual media duration.");
  const receipt: SpeechReview = {
    id: `speech-review:${crypto.randomUUID()}`,
    mediaSha256: take.mediaSha256,
    durationSec: duration,
    spans: structuredClone(spans),
    reason: reason.trim(),
    at: Date.now(),
  };
  return {
    ...workspace,
    takes: workspace.takes.map((item) =>
      item.id === takeId
        ? { ...item, speechReviews: [...(item.speechReviews ?? []), receipt] }
        : item,
    ),
  };
}

export function measuredSpeechAudit(picture: Picture) {
  let spokenSeconds = 0,
    totalSeconds = 0;
  const missing: string[] = [];
  for (const shot of picture.shots) {
    const selection = selectedEditorialClips(picture, shot);
    if (selection.issues.length) missing.push(shot.id);
    for (const take of selection.takes) {
      const receipt = take?.speechReviews?.at(-1);
      const duration = take?.probe?.durationSec;
      if (
        !take ||
        !duration ||
        !receipt ||
        receipt.mediaSha256 !== take.mediaSha256 ||
        receipt.durationSec !== duration ||
        !Array.isArray(receipt.spans) ||
        receipt.spans.some(
          (span) =>
            !Number.isFinite(span.startSec) ||
            !Number.isFinite(span.endSec) ||
            span.startSec < 0 ||
            span.endSec <= span.startSec ||
            span.endSec > duration,
        )
      ) {
        missing.push(shot.id);
        continue;
      }
      totalSeconds += duration;
      let end = 0;
      for (const span of [...receipt.spans].sort((a, b) => a.startSec - b.startSec)) {
        spokenSeconds += Math.max(0, span.endSec - Math.max(end, span.startSec));
        end = Math.max(end, span.endSec);
      }
    }
  }
  const complete = picture.shots.length > 0 && !missing.length;
  const budget = totalSeconds > 0 ? dialogueBudget(spokenSeconds, totalSeconds) : null;
  const required = picture.creativePreset === "harrowing-v3";
  return {
    required,
    complete,
    missing,
    spokenSeconds,
    totalSeconds,
    budget,
    blocksDelivery: required && (!complete || !budget?.withinCeiling),
    reason: !complete
      ? `Measured speech review missing or stale for ${missing.join(", ") || "the movie"}.`
      : budget?.withinCeiling
        ? `Measured speech ${(100 * budget.ratio).toFixed(2)}%; ${budget.withinTarget ? "within 0–2% target" : "above target but within 5% ceiling"}.`
        : `Measured speech ${(100 * (budget?.ratio ?? 0)).toFixed(2)}% exceeds the Harrowing 5% ceiling.`,
  };
}
