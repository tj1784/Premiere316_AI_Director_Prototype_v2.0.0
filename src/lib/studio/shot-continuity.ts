import type { Picture, Shot } from "./types.ts";
import { stableHash } from "../production/dependency-graph.ts";
import { listDirectorImageOptions } from "./director-scene-authoring.ts";
export type WorldPoint = { x: number; y: number; z: number };
export function continuityImageOptions(picture: Picture, shotId: string) {
  const bindings = Object.values(picture.directorScenes ?? {}).flatMap((plan) =>
    plan.segments
      .filter((segment) => segment.shotId === shotId)
      .map((segment) => segment.imageBinding),
  );
  return listDirectorImageOptions(picture).filter(
    (option) =>
      !option.shotId ||
      option.shotId === shotId ||
      bindings.some(
        (binding) =>
          binding?.iterationId === option.iterationId && binding?.mediaUri === option.mediaUri,
      ),
  );
}
export function continuityParticipants(picture: Picture) {
  return [
    ...new Map(
      [
        ...picture.characters.map(({ id, name }) => ({ id, name })),
        ...(picture.production?.assets ?? [])
          .filter((a) => !a.tombstone && a.category === "character")
          .map(({ id, name }) => ({ id, name })),
      ].map((c) => [c.id, c]),
    ).values(),
  ];
}
export type ParticipantContinuity = {
  characterId: string;
  incoming: string;
  outgoing: string;
  knowledge: string;
  objective: string;
  permittedSound: string;
  position: WorldPoint;
  endPosition: WorldPoint;
  maxSpeed: number;
  support: string;
  contact: string;
  supportLimb?: string;
  actionLimb?: string;
  transferReason?: string;
};
export type ShotContinuity = {
  imageInspection?: {
    id: string;
    referenceId: string;
    mediaUri: string;
    sha256: string;
    reviewedAt: number;
    reason: string;
    disposition?: "consistent" | "conflict";
  };
  imageInspectionHistory?: NonNullable<ShotContinuity["imageInspection"]>[];
  id: string;
  shotId: string;
  revision: number;
  predecessorId: string | null;
  source: string;
  cameraPosition: WorldPoint;
  cameraTarget: WorldPoint;
  participants: ParticipantContinuity[];
  completedEvents: string[];
  newEvents: string[];
  restartReason: string;
  imageDisposition: "uninspected" | "consistent" | "conflict";
  imageHash: string;
  inspectionReason: string;
};
export function screenSide(camera: WorldPoint, target: WorldPoint, subject: WorldPoint) {
  const dx = target.x - camera.x,
    dz = target.z - camera.z;
  if (Math.hypot(dx, dz) < 0.001) throw new Error("Camera axis has no horizontal direction.");
  const side = (subject.x - camera.x) * -dz + (subject.z - camera.z) * dx;
  return Math.abs(side) < 0.001 ? "center" : side > 0 ? "right" : "left";
}
export function inspectedReferenceIssue(
  record: ShotContinuity | undefined,
  reference: { mediaUri: string; sha256: string },
) {
  if (!record) return null;
  if (record.imageDisposition !== "consistent")
    return "Inspect and resolve the actual selected reference image before conditioned submission.";
  const receipts = [
    ...(record.imageInspectionHistory ?? []),
    ...(record.imageInspection
      ? [{ ...record.imageInspection, disposition: record.imageDisposition }]
      : []),
  ];
  const receipt = receipts.filter((item) => item.mediaUri === reference.mediaUri).at(-1);
  return receipt?.disposition === "consistent" &&
    receipt.sha256.toLowerCase() === reference.sha256.toLowerCase()
    ? null
    : "Selected conditioning image differs from its byte-bound continuity inspection. Inspect this exact image; no substitute is allowed.";
}
export function continuityIssues(
  picture: Picture,
  shot: Shot,
  record = picture.shotContinuity?.[shot.id],
  selectedReference?: { mediaUri: string; sha256?: string | null },
): string[] {
  if (!record) return [];
  const issues: string[] = [];
  if (
    [...Object.values(record.cameraPosition), ...Object.values(record.cameraTarget)].some(
      (v) => !Number.isFinite(v),
    )
  )
    issues.push("Camera position and target must contain finite coordinates.");
  else if (
    Math.hypot(
      record.cameraTarget.x - record.cameraPosition.x,
      record.cameraTarget.z - record.cameraPosition.z,
    ) < 0.001
  )
    issues.push("Camera axis has no horizontal direction.");
  const prior = record.predecessorId ? picture.shotContinuity?.[record.predecessorId] : undefined;
  if (record.predecessorId && !prior) issues.push("Predecessor continuity record is missing.");
  const seen = new Set([shot.id]);
  let cursor = prior;
  while (cursor) {
    if (seen.has(cursor.shotId)) {
      issues.push("Continuity predecessor cycle.");
      break;
    }
    seen.add(cursor.shotId);
    cursor = cursor.predecessorId ? picture.shotContinuity?.[cursor.predecessorId] : undefined;
  }
  for (const p of record.participants) {
    if (
      p.supportLimb?.trim() &&
      p.supportLimb.trim().toLowerCase() === p.actionLimb?.trim().toLowerCase() &&
      !p.transferReason?.trim()
    )
      issues.push(
        `${p.characterId}: support and gesture use the same limb without a weight-transfer sequence.`,
      );
    if (!continuityParticipants(picture).some((c) => c.id === p.characterId))
      issues.push(`Missing participant ${p.characterId}`);
    if (!p.incoming.trim() || !p.outgoing.trim() || !p.objective.trim())
      issues.push(`${p.characterId}: incoming/outgoing state and task required.`);
    const values = [...Object.values(p.position), ...Object.values(p.endPosition), p.maxSpeed];
    if (values.some((v) => !Number.isFinite(v)) || p.maxSpeed < 0)
      issues.push(`${p.characterId}: invalid travel coordinates/speed.`);
    else if (
      Math.hypot(
        p.endPosition.x - p.position.x,
        p.endPosition.y - p.position.y,
        p.endPosition.z - p.position.z,
      ) >
      shot.durationSec * p.maxSpeed + 0.001
    )
      issues.push(`${p.characterId}: travel exceeds authored duration and maximum speed.`);
    const inherited = prior?.participants.find((c) => c.characterId === p.characterId);
    if (inherited && inherited.outgoing !== p.incoming && !record.restartReason.trim())
      issues.push(
        `${p.characterId}: incoming state differs from predecessor; source correction or explicit transition reason required.`,
      );
  }
  if (
    !record.restartReason.trim() &&
    record.newEvents.some(
      (event) => prior && [...prior.completedEvents, ...prior.newEvents].includes(event),
    )
  )
    issues.push("A completed event is being replayed without an authored restart reason.");
  if (record.imageDisposition === "conflict")
    issues.push(
      "Starting image conflicts with source state. Correct the media source, not just the prose.",
    );
  if (
    record.imageDisposition === "consistent" &&
    (!/^[a-f0-9]{64}$/i.test(record.imageHash) || !record.inspectionReason.trim())
  )
    issues.push("Image inspection needs exact SHA-256 and an observed comparison.");
  if (
    record.imageDisposition === "consistent" &&
    (!record.imageInspection ||
      record.imageInspection.sha256 !== record.imageHash ||
      !record.imageInspection.reason.trim())
  )
    issues.push(
      "Image consistency requires a byte-bound visual inspection receipt, not edited prose.",
    );
  if (record.imageDisposition === "consistent" && record.imageInspection) {
    const receipt = record.imageInspection;
    const reference = selectedReference ?? continuityImageOptions(picture, shot.id).find(
      (option) => option.id === receipt.referenceId,
    );
    if (
      !reference ||
      reference.mediaUri !== receipt.mediaUri ||
      (reference.sha256 && reference.sha256.toLowerCase() !== receipt.sha256.toLowerCase())
    )
      issues.push(
        "Inspected image has changed or is no longer available for this shot. Inspect the current canonical media again.",
      );
  }
  return issues;
}
export function continuityText(picture: Picture, shot: Shot) {
  const r = picture.shotContinuity?.[shot.id];
  if (!r) return "";
  const problems = continuityIssues(picture, shot, r);
  if (problems.length) throw new Error(problems.join("\n"));
  return (
    r.participants
      .map(
        (p) =>
          `${continuityParticipants(picture).find((c) => c.id === p.characterId)?.name ?? p.characterId}: incoming ${p.incoming}; knows ${p.knowledge}; objective ${p.objective}; outgoing ${p.outgoing}; support ${p.support}; contact ${p.contact}; support limb ${p.supportLimb || "not specified"}; gesture limb ${p.actionLimb || "not specified"}; weight transfer ${p.transferReason || "none authored"}; starts screen-${screenSide(r.cameraPosition, r.cameraTarget, p.position)} at ${JSON.stringify(p.position)} metres, ends screen-${screenSide(r.cameraPosition, r.cameraTarget, p.endPosition)} at ${JSON.stringify(p.endPosition)} metres; permitted sound ${p.permittedSound || "none authored"}.`,
      )
      .join("\n") +
    (r.completedEvents.length
      ? `\nAlready completed; do not replay: ${r.completedEvents.join("; ")}.`
      : "")
  );
}
export function saveShotContinuity(picture: Picture, record: ShotContinuity) {
  const shot = picture.shots.find((s) => s.id === record.shotId);
  if (!shot) throw new Error("Shot no longer exists.");
  const prior = picture.shotContinuity?.[record.shotId];
  return {
    ...(picture.shotContinuity ?? {}),
    [record.shotId]: {
      ...record,
      id: prior?.id ?? `continuity:${crypto.randomUUID()}`,
      revision: (prior?.revision ?? 0) + 1,
      imageInspectionHistory: [
        ...new Map(
          [
            ...(prior?.imageInspectionHistory ?? []),
            ...(prior?.imageInspection ? [prior.imageInspection] : []),
            ...(record.imageInspection ? [record.imageInspection] : []),
          ].map((receipt) => [receipt.id, receipt]),
        ).values(),
      ],
    },
  };
}
export function continuityFingerprint(picture: Picture, sceneId: string) {
  return stableHash(
    picture.shots
      .filter((s) => s.sceneId === sceneId)
      .map((s) => picture.shotContinuity?.[s.id] ?? null),
  );
}
