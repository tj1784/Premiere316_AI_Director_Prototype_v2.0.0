import type { Picture } from "./types.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import type { ProdigalDirectorManifest, ProdigalDirectorScene } from "./prodigal-director-types.ts";
import { hydrateGenerateGates } from "../production/generate-gates.ts";

/** The package is project data. Its prose never authorizes installs, execution, or approval changes. */
export function prodigalDirectorScene(picture: Picture, sceneId: string): ProdigalDirectorScene | undefined {
  if (picture.id !== PRODIGAL_SON_DIRECTOR.pictureId || picture.screenplay.approvedVersionId !== PRODIGAL_SON_DIRECTOR.screenplayVersionId) return undefined;
  return PRODIGAL_SON_DIRECTOR.scenes.find((scene) => scene.sceneId === sceneId);
}

/** Run after frame hydration for both fresh and saved pictures. */
export function hydrateProdigalSonDirector(picture: Picture, manifest: ProdigalDirectorManifest = PRODIGAL_SON_DIRECTOR): Picture {
  if (manifest.schemaVersion !== 1 || picture.id !== manifest.pictureId || picture.screenplay.approvedVersionId !== manifest.screenplayVersionId || !picture.performance) return picture;
  const previous = picture.directorBundle?.packageId === manifest.packageId ? picture.directorBundle : undefined;
  // A completed revision never reapplies edited prompts, removed candidates or manual choices.
  if (previous?.revision === manifest.revision) return picture;
  const importedShots = new Set(previous?.importedShotIds ?? []);
  const skippedShots = new Set(previous?.skippedShotIds ?? []);
  const importedPrompts = new Set(previous?.importedPromptIds ?? []);
  const importedIterations = new Set(previous?.importedIterationIds ?? []);
  const frameOwned = new Set(picture.frameBundle?.importedShotIds ?? []);
  const shots = [...picture.shots];
  const performance = { ...picture.performance, shots: [...picture.performance.shots] };
  const currentGates = hydrateGenerateGates(picture.generateGates, picture);
  const gates = { ...currentGates, iterations: [...currentGates.iterations], prompts: [...currentGates.prompts] };
  for (const scene of manifest.scenes) for (const segment of scene.segments) {
    const index = shots.findIndex((shot) => shot.id === segment.shotId && shot.sceneId === scene.sceneId);
    const canonical = picture.performance.shots.find((shot) => shot.shotId === segment.shotId);
    // Collisions and user-deleted shots remain untouched, even in a later package revision.
    if (skippedShots.has(segment.shotId)) continue;
    if (index < 0 || !canonical || !frameOwned.has(segment.shotId)) { skippedShots.add(segment.shotId); continue; }
    const shot = shots[index];
    const baseline = PRODIGAL_SON_FRAMES.shots.find((source) => source.id === segment.shotId);
    const originalPrompt = baseline ? `${baseline.camera_motion}\nFIRST FRAME: ${baseline.first_frame}\nLAST FRAME: ${baseline.last_frame}\n${baseline.continuity_locks.join("\n")}\n${baseline.dialogue_coverage}` : undefined;
    const previousPrompt = [...gates.prompts].reverse().find((prompt) => importedPrompts.has(prompt.id) && prompt.shotId === segment.shotId && prompt.kind === "video")?.text;
    const canUpdatePrompt = !shot.i2vPrompt.trim() || shot.i2vPrompt === originalPrompt || (previousPrompt !== undefined && shot.i2vPrompt === previousPrompt);
    const media = segment.startImage;
    if (!/^[a-f0-9]{64}$/.test(media.sha256) || !media.mediaUri.startsWith(`/pictures/prodigal-son/director/starting-images/${scene.sceneId}/${segment.shotId}_START-`)) continue;
    const pair = gates.pairs.find((item) => item.shotId === segment.shotId);
    const iterationId = `${manifest.packageId}:${segment.shotId}:start:${media.sha256}`;
    // A patch to one scene must not create new prompt versions in unchanged scenes.
    if (importedShots.has(segment.shotId) && previousPrompt === segment.prompt && importedIterations.has(iterationId)) continue;
    if (!importedIterations.has(iterationId)) {
      if (!gates.iterations.some((iteration) => iteration.id === iterationId)) gates.iterations.push({
        id: iterationId, shotId: segment.shotId, kind: "first", origin: "imported",
        promptVersionId: pair?.firstPromptVersionId ?? null, mediaUri: media.mediaUri, mediaSha256: media.sha256,
        status: "NEEDS_REVIEW", canonical: false, createdAt: manifest.createdAt, failClosedReason: null,
      });
      importedIterations.add(iterationId);
    }
    // The supplied start guide is available separately; previous first/last approvals are preserved.
    if (canUpdatePrompt) {
      shots[index] = { ...shot, i2vPrompt: segment.prompt };
      if (canonical.legacy && (!canonical.legacy.i2vPrompt || canonical.legacy.i2vPrompt === shot.i2vPrompt || canonical.legacy.i2vPrompt === originalPrompt || canonical.legacy.i2vPrompt === previousPrompt)) {
        const performanceIndex = performance.shots.indexOf(canonical);
        performance.shots[performanceIndex] = { ...canonical, legacy: { ...canonical.legacy, i2vPrompt: segment.prompt } };
      }
      const hasOtherVideoPrompt = gates.prompts.some((prompt) => prompt.shotId === segment.shotId && prompt.kind === "video" && !importedPrompts.has(prompt.id));
      const promptId = `${manifest.packageId}:${manifest.revision}:${segment.shotId}:video`;
      if (!hasOtherVideoPrompt && !importedPrompts.has(promptId)) {
        gates.prompts.push({ id: promptId, gate: "video", shotId: segment.shotId, assetId: null, kind: "video", text: segment.prompt,
          createdAt: manifest.createdAt, assetRefIds: [...(pair?.assetRefIds ?? [])], firstFrameId: iterationId, lastFrameId: null });
        importedPrompts.add(promptId);
      }
    }
    importedShots.add(segment.shotId);
  }
  return { ...picture, shots, performance, generateGates: gates,
    directorBundle: { packageId: manifest.packageId, revision: manifest.revision, importedShotIds: [...importedShots],
      skippedShotIds: [...skippedShots], importedPromptIds: [...importedPrompts], importedIterationIds: [...importedIterations] },
  };
}
