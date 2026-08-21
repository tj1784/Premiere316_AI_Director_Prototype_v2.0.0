import crypto from "node:crypto";

const CLIP_WILDCARD = "*";

function requiredId(value, label) {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required for a Director queue reservation`);
  return id;
}

function reservationKey(projectSlug, clipId, segmentId) {
  return JSON.stringify([projectSlug, clipId, segmentId]);
}

function uniqueSegmentIds(segmentIds) {
  const values = typeof segmentIds === "string"
    ? [segmentIds]
    : Array.from(segmentIds || []);
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

export class SegmentQueueReservationConflict extends Error {
  constructor({ projectSlug, clipId, segmentId, reservationId }) {
    const scope = segmentId === CLIP_WILDCARD ? `clip ${clipId}` : `segment ${segmentId}`;
    super(`A Director queue request already owns ${scope}`);
    this.name = "SegmentQueueReservationConflict";
    this.status = 409;
    this.projectSlug = projectSlug;
    this.clipId = clipId;
    this.segmentId = segmentId;
    this.reservationId = reservationId;
  }
}

export class SegmentQueueReservations {
  #entries = new Map();

  reserve({ projectSlug, clipId, segmentIds, reservationId = crypto.randomUUID() }) {
    projectSlug = requiredId(projectSlug, "projectSlug");
    clipId = requiredId(clipId, "clipId");
    const requested = uniqueSegmentIds(segmentIds);
    if (!requested.length) requested.push(CLIP_WILDCARD);
    const wildcardRequested = requested.includes(CLIP_WILDCARD);
    if (wildcardRequested) requested.splice(0, requested.length, CLIP_WILDCARD);
    const conflicts = [];
    for (const entry of this.#entries.values()) {
      if (entry.projectSlug !== projectSlug || entry.clipId !== clipId) continue;
      if (wildcardRequested || entry.segmentId === CLIP_WILDCARD || requested.includes(entry.segmentId)) conflicts.push(entry);
    }
    if (conflicts.length) throw new SegmentQueueReservationConflict(conflicts[0]);

    const id = String(reservationId);
    const entries = requested.map((segmentId) => ({ reservationId: id, projectSlug, clipId, segmentId }));
    for (const entry of entries) this.#entries.set(reservationKey(projectSlug, clipId, entry.segmentId), entry);
    let released = false;
    return {
      id,
      projectSlug,
      clipId,
      segmentIds: entries.map((entry) => entry.segmentId),
      release: () => {
        if (released) return;
        released = true;
        for (const entry of entries) {
          const key = reservationKey(projectSlug, clipId, entry.segmentId);
          if (this.#entries.get(key)?.reservationId === id) this.#entries.delete(key);
        }
      }
    };
  }

  get size() {
    return this.#entries.size;
  }
}

export function queueReservationSegmentIds(mode, workspace, selectedSegmentId = null) {
  if (mode === "timeline") return [CLIP_WILDCARD];
  if (mode === "selected") {
    const selected = String(selectedSegmentId ?? workspace?.selectedSegmentId ?? "").trim();
    return selected ? [selected] : [CLIP_WILDCARD];
  }
  if (mode !== "segments") return [CLIP_WILDCARD];
  return uniqueSegmentIds((workspace?.timeline?.segments || [])
    .filter((segment) => [undefined, "image", "video"].includes(segment?.type))
    .filter((segment) => (Number(segment.length) || 0) > 0)
    .map((segment) => segment.id));
}

export function directorJobConflictsWithQueueRequest(job, {
  projectSlug,
  clipId,
  mode,
  segmentIds = []
}) {
  if (!["queued", "running"].includes(job?.status)) return false;
  if (job?.refs?.binding?.projectSlug !== projectSlug || job?.refs?.binding?.clipId !== clipId) return false;
  if (mode === "timeline" || job?.refs?.mode === "timeline") return true;
  const requested = new Set(uniqueSegmentIds(segmentIds));
  return requested.size > 0 && requested.has(String(job?.refs?.segmentId || ""));
}

/**
 * Submit already-compiled Director jobs one at a time. Keeping this loop outside
 * the HTTP route makes the one-segment/one-Comfy-prompt contract testable
 * without starting either the Director server or ComfyUI.
 */
export async function submitCompiledJobsIndividually(compiledJobs, submitOne, onAccepted = null) {
  if (!Array.isArray(compiledJobs)) throw new TypeError("compiledJobs must be an array");
  if (typeof submitOne !== "function") throw new TypeError("submitOne must be a function");
  if (onAccepted !== null && typeof onAccepted !== "function") throw new TypeError("onAccepted must be a function or null");
  const accepted = [];
  for (let index = 0; index < compiledJobs.length; index += 1) {
    try {
      const item = await submitOne(compiledJobs[index], index);
      accepted.push(item);
      if (onAccepted) await onAccepted(item, compiledJobs[index], index);
    } catch (error) {
      return { accepted, error };
    }
  }
  return { accepted, error: null };
}
