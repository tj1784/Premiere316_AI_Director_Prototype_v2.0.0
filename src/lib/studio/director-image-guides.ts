import type { Picture } from "./types.ts";
import type { ProdigalDirectorScene } from "./prodigal-director-types.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";

export type DirectorImageGuide = { mediaUri: string; sha256: string; bytes?: number; label: string; iterationId?: string };
export type DirectorSceneImages = { guides: Record<string, DirectorImageGuide>; issues: string[]; key: string };

/** Resolve media already attached to this shot. Never import, generate, duplicate or approve an image. */
export function resolveDirectorSceneImages(picture: Picture, scene: ProdigalDirectorScene): DirectorSceneImages {
  const guides: Record<string, DirectorImageGuide> = {}, issues: string[] = [];
  for (const segment of scene.segments) {
    const shot = picture.shots.find((item) => item.id === segment.shotId && item.sceneId === scene.sceneId);
    if (!shot) { issues.push(`${segment.shotId}: the shot is unavailable.`); continue; }
    const pair = picture.generateGates?.pairs.find((item) => item.shotId === shot.id);
    const iterations = picture.generateGates?.iterations.filter((item) => item.shotId === shot.id && item.kind === "first" && item.status !== "REJECTED" && item.origin !== "fail-closed" && !!item.mediaUri && /^[a-f0-9]{64}$/i.test(item.mediaSha256 ?? "")) ?? [];
    const approved = iterations.find((item) => item.id === pair?.firstApprovedId && item.status === "APPROVED");
    const registered = iterations.find((item) => item.mediaSha256 === segment.startImage.sha256);
    const selected = approved ?? registered;
    if (selected) {
      guides[segment.segmentId] = { mediaUri: selected.mediaUri!, sha256: selected.mediaSha256!.toLowerCase(), iterationId: selected.id, label: approved ? "Existing approved first frame" : "Existing attached starting image" };
      continue;
    }
    // A known still URI can provide a verified existing guide without adding an iteration.
    const known = [segment.startImage, PRODIGAL_SON_FRAMES.shots.find((item) => item.id === shot.id)?.frames.first].find((item) => item?.mediaUri === shot.stillUrl);
    const rejectedStill = picture.generateGates?.iterations.some((item) => item.shotId === shot.id && item.mediaUri === known?.mediaUri && item.status === "REJECTED");
    if (known && !rejectedStill) guides[segment.segmentId] = { ...known, label: "Existing shot still" };
    else issues.push(`${segment.shotId}: attach or select a first-frame image with a verified file hash.`);
  }
  const key = scene.segments.map((segment) => { const guide = guides[segment.segmentId]; return `${segment.segmentId}:${guide?.sha256 ?? "missing"}:${guide?.mediaUri ?? ""}:${guide?.iterationId ?? ""}`; }).join("|");
  return { guides, issues, key };
}
