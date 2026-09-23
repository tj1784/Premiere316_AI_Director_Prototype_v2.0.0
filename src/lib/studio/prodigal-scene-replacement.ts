import type { Picture, Shot } from "./types.ts";
import type { CanonicalShotSpec, DependencyGraph, PerformanceContinuityEnvelope, PerformanceWorkspace } from "../performance/types.ts";
import { buildDependencyGraph } from "../performance/domain.ts";
import { emptyGenerateGates, type GenerateGateWorkspace } from "../production/generate-gates.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";
import type { ProdigalDirectorManifest, ProdigalDirectorScene } from "./prodigal-director-types.ts";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";
import { undoPerformanceDraft } from "../emotion/integration.ts";

const withoutKeys = <T>(values: Record<string, T>, ids: Set<string>): Record<string, T> => Object.fromEntries(Object.entries(values).filter(([id]) => !ids.has(id)));
const envelope = (text: string): PerformanceContinuityEnvelope => ({ visual: {}, performance: {}, story: { chronologyNote: text } });
const sceneSlugline = (source: ProdigalDirectorScene): string => source.replacement!.screenplayMarkdown.match(/^## ((?:EXT\.|INT\.)[^\r\n]+)$/m)?.[1] ?? source.title;

type HistoricalMedia = { mediaUri: string; sha256: string; bytes?: number; width?: number; height?: number };
type FrameCorrection = { oldStart: HistoricalMedia; oldFirst?: HistoricalMedia; oldLast?: HistoricalMedia;
  oldAction?: string; oldFirstProse?: string; oldLastProse?: string };
// Exact prior bundled hashes guard a one-time correction of the seven affected shots.
// Custom media and manually removed shots are never recreated or replaced.
const correctedBundledShots: Record<string, FrameCorrection> = {
  "PS-S01-SH014": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH014_START-8480bcbd0a31.png",
      "sha256": "8480bcbd0a31b04f087f61f36fa7578e39860646fc963cdb3f6f5c96eb941e8b",
      "bytes": 2308537,
      "width": 1920,
      "height": 800
    },
    "oldAction": "Continue Jesus in the same standing close-up and eyeline. Warmth enters his voice as he describes the shepherd carrying the sheep. A slight softening around his eyes carries the feeling. Keep gestures below the close-up, his face clear and his shoulders relaxed."
  },
  "PS-S01-SH016": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH016_START-8480bcbd0a31.png",
      "sha256": "8480bcbd0a31b04f087f61f36fa7578e39860646fc963cdb3f6f5c96eb941e8b",
      "bytes": 2308537,
      "width": 1920,
      "height": 800
    },
    "oldAction": "Jesus returns his steady gaze toward the leaders, his voice clear and compassionate. Allow a pause before the comparison. His expression remains inviting, his head balanced naturally over his shoulders. Hold the intimate standing view while the listeners remain quiet behind him."
  },
  "PS-S01-SH019": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH019_START-8480bcbd0a31.png",
      "sha256": "8480bcbd0a31b04f087f61f36fa7578e39860646fc963cdb3f6f5c96eb941e8b",
      "bytes": 2308537,
      "width": 1920,
      "height": 800
    },
    "oldAction": "Keep Jesus in the same standing position and afternoon light. His voice grows warmer. The woman’s quoted words remain in his own storytelling voice. He makes one small, natural nod and settles again, breathing gently between phrases."
  },
  "PS-S01-SH020": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH020_START-8480bcbd0a31.png",
      "sha256": "8480bcbd0a31b04f087f61f36fa7578e39860646fc963cdb3f6f5c96eb941e8b",
      "bytes": 2308537,
      "width": 1920,
      "height": 800
    },
    "oldAction": "Hold the compassionate close-up. Jesus lets the final words land gently, then closes his mouth. His eyes include the people seated nearest him and the critics beyond. A quiet breath completes the thought; the camera stays composed."
  },
  "PS-S01-SH022": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH022_START-8480bcbd0a31.png",
      "sha256": "8480bcbd0a31b04f087f61f36fa7578e39860646fc963cdb3f6f5c96eb941e8b",
      "bytes": 2308537,
      "width": 1920,
      "height": 800
    },
    "oldAction": "Jesus remains standing in a slightly more intimate close-up. He draws a quiet breath and begins the next story, including the younger son’s request in his own storytelling voice. He completes the final sentence and rests in silence. End with his face steady for the cut to the family farm. The two brothers belong to the story now being introduced; YOUNG LISTENER remains an audience member."
  },
  "PS-S15-SH001": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S15/PS-S15-SH001_START-96b1fa9291a5.png",
      "sha256": "96b1fa9291a591a901a4e59c22847b416a2dc8e42fbb08f2a7b9c6b667dee5e3",
      "bytes": 2599803,
      "width": 1920,
      "height": 800
    },
    "oldFirst": {
      "mediaUri": "/pictures/prodigal-son/frames/PS-S15/PS-S15-SH001_FIRST-8918810bba7e.png",
      "sha256": "8918810bba7e4aa34310e25076909fffe33c87586eb04c0925eaa2a4cf131f47",
      "bytes": 2672830,
      "width": 1935,
      "height": 812
    },
    "oldLast": {
      "mediaUri": "/pictures/prodigal-son/frames/PS-S15/PS-S15-SH001_LAST-fd46bd7f1cfb.png",
      "sha256": "fd46bd7f1cfb0f3beff50723327fb152d0c5b31bfeca5d678faa1ecf42cb961d",
      "bytes": 2578095,
      "width": 1935,
      "height": 812
    },
    "oldFirstProse": "Daytime inside the foreign pig enclosure: the younger staggers under a large basket of dry feed pods, sweat catching dust on his neck. Several ordinary domestic pigs crowd the rough trough. His worn narrow-blue-bordered mantle hangs on a peg inside the left lean-to; he works in his plain tunic and original worn sandals. His personal bedding and repaired waterskin are stowed under that lean-to. One instantaneous photographic frame from a continuous photorealistic live-action first-century eastern Mediterranean film; 2.39:1 anamorphic composition, natural restrained film color and texture, physically plausible anatomy and lighting. No collage, text, captions, labels, modern items, or fantasy.",
    "oldLastProse": "The younger has emptied the feed basket into the same trough, holding it tipped and nearly empty. A domestic pig shoulders past his lower leg; he recoils slightly but steadies himself to continue. The blue-bordered mantle remains visibly on the lean-to peg, personal bundle beneath it. One instantaneous photographic frame from a continuous photorealistic live-action first-century eastern Mediterranean film; 2.39:1 anamorphic composition, natural restrained film color and texture, physically plausible anatomy and lighting. No collage, text, captions, labels, modern items, or fantasy."
  },
  "PS-S22-SH001": {
    "oldStart": {
      "mediaUri": "/pictures/prodigal-son/director/starting-images/PS-S22/PS-S22-SH001_START-9df5b0f3c7b2.png",
      "sha256": "9df5b0f3c7b29e6241e9884971bc5c9eaedca7af7d24f71492d52236683047b1",
      "bytes": 2232297,
      "width": 1920,
      "height": 800
    },
    "oldFirst": {
      "mediaUri": "/pictures/prodigal-son/frames/PS-S22/PS-S22-SH001_FIRST-7a716440014e.png",
      "sha256": "7a716440014e4b52f887a9397f7a93dc81699a9b337d9b1d7df57446ef3522f3",
      "bytes": 2291569,
      "width": 1933,
      "height": 813
    },
    "oldLast": {
      "mediaUri": "/pictures/prodigal-son/frames/PS-S22/PS-S22-SH001_LAST-a9f5ff7a4243.png",
      "sha256": "a9f5ff7a42439650e6dba5213054d41db0648c6caf46506421d58a7d0659d001",
      "bytes": 2208105,
      "width": 1933,
      "height": 813
    },
    "oldFirstProse": "One instantaneous photographic endpoint from a single continuous live-action shot; no montage, split panel, internal cut, caption, lettering, watermark or interface. 2.39:1 anamorphic composition, 35mm film texture, 24 fps production, natural first-century Judean light and restrained realistic performance. Match the supplied user-selected character and location drafts, never their sheet layouts or labels. Preserve each canonical face, reference hair color and hairstyle, age, build and wardrobe construction; only apply the explicitly specified story state. These references are selected drafts, not recorded approvals. Night at same threshold, elder and dusty father outside in near foreground, clear doorway between them. Younger inside raises his eyes from table and sees elder for first time. His hands rest near the two cups; best robe, right-hand ring and new sandals remain, thin neck and exhaustion plainly visible. Original empty bowl stays beside threshold.",
    "oldLastProse": "One instantaneous photographic endpoint from a single continuous live-action shot; no montage, split panel, internal cut, caption, lettering, watermark or interface. 2.39:1 anamorphic composition, 35mm film texture, 24 fps production, natural first-century Judean light and restrained realistic performance. Match the supplied user-selected character and location drafts, never their sheet layouts or labels. Preserve each canonical face, reference hair color and hairstyle, age, build and wardrobe construction; only apply the explicitly specified story state. These references are selected drafts, not recorded approvals. Same uninterrupted view. Younger has begun to stand but is only partly upright, one hand gripping table edge for support, making NO beckoning gesture. Elder sees the struggle; fingers visibly loosen around olive mantle without dropping it. Father stands beside elder close enough to touch, leaving doorway entirely clear. Neither elder nor father has entered."
  }
};


/** Apply an explicitly supplied scene replacement once. Reloads never overwrite subsequent edits. */
export function hydrateProdigalSceneReplacements(picture: Picture, manifest: ProdigalDirectorManifest = PRODIGAL_SON_DIRECTOR): Picture {
  if (manifest.schemaVersion !== 1 || picture.id !== manifest.pictureId || picture.screenplay.approvedVersionId !== manifest.screenplayVersionId
    || !picture.performance || picture.performance.pictureId !== picture.id) return picture;
  let next = picture;
  for (const source of manifest.scenes) {
    if (!source.replacement?.revision || next.directorSceneRevisions?.[source.sceneId] === source.replacement.revision) continue;
    if (!next.scenes.some((scene) => scene.id === source.sceneId) || !validReplacement(next, source)) continue;
    next = replaceScene(next, source, manifest);
  }
  return correctBundledShotMedia(next, manifest);
}

/** Update only shots still showing the exact former bundled frames. Leave custom choices intact. */
function correctBundledShotMedia(picture: Picture, manifest: ProdigalDirectorManifest): Picture {
  if (!picture.performance || !picture.generateGates) return picture;
  const shots = [...picture.shots], performance = structuredClone(picture.performance);
  const gates = structuredClone(picture.generateGates);
  const directorScenes = picture.directorScenes ? structuredClone(picture.directorScenes) : undefined;
  const amendedProse: Array<{ old: string; updated: string }> = [];
  let changed = false;
  for (const [shotId, former] of Object.entries(correctedBundledShots)) {
    const sceneId = shotId.slice(0, 6);
    const directorScene = manifest.scenes.find((scene) => scene.sceneId === sceneId);
    const segment = directorScene?.segments.find((entry) => entry.shotId === shotId);
    const frame = PRODIGAL_SON_FRAMES.shots.find((entry) => entry.id === shotId);
    const shotIndex = shots.findIndex((shot) => shot.id === shotId && shot.sceneId === sceneId);
    const canonicalIndex = performance.shots.findIndex((shot) => shot.shotId === shotId && shot.sceneId === sceneId);
    if (!segment || shotIndex < 0 || canonicalIndex < 0) continue;
    if (sceneId === "PS-S01" && picture.directorSceneRevisions?.[sceneId] !== directorScene?.replacement?.revision) continue;
    const oldFirst = former.oldFirst ?? former.oldStart;
    const newFirst = frame?.frames.first ?? segment.startImage;
    const oldSelected = gates.pairs.find((pair) => pair.shotId === shotId)?.firstApprovedId;
    const selectedIteration = oldSelected ? gates.iterations.find((iteration) => iteration.id === oldSelected) : undefined;
    const hasCustomChoice = oldSelected && (!selectedIteration || selectedIteration.origin !== "imported" || selectedIteration.mediaSha256 !== oldFirst.sha256);
    const canonical = performance.shots[canonicalIndex];
    if (hasCustomChoice || shots[shotIndex].stillUrl !== oldFirst.mediaUri
      || canonical.references.firstFrame?.[0] !== oldFirst.mediaUri) continue;
    changed = true;
    const newAction = former.oldAction
      ? segment.prompt.split(" Begin from the supplied image. ")[1]?.split("\n\nPreserve the supplied")[0]
      : null;
    const replaceProse = (value: string): string => {
      if (former.oldAction && newAction && value.includes(former.oldAction)) return value.replace(former.oldAction, newAction);
      if (!frame || !former.oldFirstProse || !former.oldLastProse) return value;
      const oldIntro = former.oldFirstProse.split(" One instantaneous photographic frame")[0];
      const newIntro = frame.first_frame.split(" One instantaneous photographic frame")[0];
      const oldEnd = former.oldLastProse.split(" One instantaneous photographic frame")[0];
      const newEnd = frame.last_frame.split(" One instantaneous photographic frame")[0];
      return value.replace(oldIntro, newIntro).replace(oldEnd, newEnd);
    };
    if (former.oldAction && newAction) amendedProse.push({ old: former.oldAction, updated: newAction });
    const priorShot = shots[shotIndex];
    shots[shotIndex] = { ...priorShot, stillUrl: newFirst.mediaUri, i2vPrompt: replaceProse(priorShot.i2vPrompt) };
    const newLast = frame?.frames.last, oldLast = former.oldLast;
    const canCorrectLast = Boolean(newLast && oldLast && canonical.references.lastFrame?.[0] === oldLast.mediaUri
      && (!gates.pairs.find((pair) => pair.shotId === shotId)?.lastApprovedId || gates.iterations.some((iteration) =>
        iteration.id === gates.pairs.find((pair) => pair.shotId === shotId)?.lastApprovedId
        && iteration.origin === "imported" && iteration.mediaSha256 === oldLast.sha256)));
    performance.shots[canonicalIndex] = { ...canonical,
      camera: { ...canonical.camera,
        ...(frame && former.oldFirstProse && canonical.camera.startComposition === former.oldFirstProse ? { startComposition: frame.first_frame } : {}),
        ...(canCorrectLast && frame && former.oldLastProse && canonical.camera.endComposition === former.oldLastProse ? { endComposition: frame.last_frame } : {}),
      },
      references: { ...canonical.references, firstFrame: [newFirst.mediaUri],
        ...(canCorrectLast && newLast ? { lastFrame: [newLast.mediaUri] } : {}) },
      ...(canonical.legacy ? { legacy: { ...canonical.legacy,
        ...(canonical.legacy.stillUrl === oldFirst.mediaUri ? { stillUrl: newFirst.mediaUri } : {}),
        i2vPrompt: replaceProse(canonical.legacy.i2vPrompt ?? ""),
      } } : {}),
    };
    performance.beats = performance.beats.map((beat) => beat.sceneId === sceneId && beat.id === canonical.beatId
      ? { ...beat, summary: replaceProse(beat.summary) } : beat);
    const firstId = sceneId === "PS-S01"
      ? `${manifest.packageId}:${shotId}:start:${newFirst.sha256}`
      : `${PRODIGAL_SON_FRAMES.packageId}:${shotId}:first:${newFirst.sha256}`;
    const makeIteration = (kind: "first" | "last", newMedia: typeof newFirst, oldMedia: HistoricalMedia, id: string) => {
      const existing = gates.iterations.find((iteration) => iteration.id === id);
      const oldIteration = gates.iterations.find((iteration) => iteration.shotId === shotId && iteration.kind === kind
        && iteration.mediaSha256 === oldMedia.sha256 && iteration.origin === "imported");
      if (oldIteration?.canonical) { oldIteration.canonical = false; oldIteration.status = "STALE"; }
      if (!existing) gates.iterations.push({ id, shotId, kind, origin: "imported", promptVersionId: oldIteration?.promptVersionId ?? null,
        mediaUri: newMedia.mediaUri, mediaSha256: newMedia.sha256,
        status: oldIteration?.status === "STALE" ? "APPROVED" : "NEEDS_REVIEW", canonical: oldIteration?.status === "STALE",
        createdAt: manifest.createdAt, failClosedReason: null });
      const pairIndex = gates.pairs.findIndex((pair) => pair.shotId === shotId);
      if (pairIndex >= 0 && gates.pairs[pairIndex][kind === "first" ? "firstApprovedId" : "lastApprovedId"] === oldIteration?.id)
        gates.pairs[pairIndex] = { ...gates.pairs[pairIndex], [kind === "first" ? "firstApprovedId" : "lastApprovedId"]: id };
      return id;
    };
    makeIteration("first", newFirst, oldFirst, firstId);
    if (canCorrectLast && newLast && oldLast) makeIteration("last", newLast, oldLast,
      `${PRODIGAL_SON_FRAMES.packageId}:${shotId}:last:${newLast.sha256}`);
    const pairIndex = gates.pairs.findIndex((pair) => pair.shotId === shotId);
    if (pairIndex >= 0 && frame && former.oldFirstProse) {
      const pair = gates.pairs[pairIndex];
      const updatedFirstPrompt = pair.firstPrompt === former.oldFirstProse ? frame.first_frame : pair.firstPrompt;
      const updatedLastPrompt = canCorrectLast && former.oldLastProse && pair.lastPrompt === former.oldLastProse ? frame.last_frame : pair.lastPrompt;
      gates.pairs[pairIndex] = { ...pair, firstPrompt: updatedFirstPrompt, lastPrompt: updatedLastPrompt };
    }
    const planSegment = directorScenes?.[sceneId]?.segments.find((entry) => entry.shotId === shotId);
    if (planSegment?.imageBinding?.sha256 === former.oldStart.sha256
      && planSegment.imageBinding.mediaUri === former.oldStart.mediaUri) {
      planSegment.imageBinding = { ...planSegment.imageBinding,
        iterationId: `${manifest.packageId}:${shotId}:start:${segment.startImage.sha256}`,
        mediaUri: segment.startImage.mediaUri, sha256: segment.startImage.sha256 };
      planSegment.prompt = replaceProse(planSegment.prompt);
    }
  }
  if (!changed) return picture;
  const working = amendedProse.reduce((text, part) => text.replace(part.old, part.updated), picture.screenplay.workingFountain);
  const sourceFountain = amendedProse.reduce((text, part) => text.replace(part.old, part.updated), picture.screenplayFountain);
  let screenplay = picture.screenplay;
  if (working !== screenplay.workingFountain) {
    const id = `${picture.id}:PS-S01:shot-media:v42`;
    const hierarchy = parseScreenplayHierarchy(working, screenplay.hierarchy);
    const current = screenplay.versions.find((version) => version.id === screenplay.currentVersionId);
    const version = { id, label: "PS-S01 · close-view camera correction", kind: "manual" as const,
      fountain: working, createdAt: Date.now(), model: null, workflow: screenplay.workflow,
      pass: null, sourceVersionId: current?.id ?? null, settings: null, logicalRole: "manual" as const, hierarchy };
    screenplay = { ...screenplay,
      versions: screenplay.versions.some((item) => item.id === id) ? screenplay.versions : [...screenplay.versions, version],
      workingFountain: working, currentVersionId: id, hierarchy, status: "READY_FOR_REVIEW", updatedAt: version.createdAt };
  }
  return { ...picture, shots, performance, generateGates: gates, ...(directorScenes ? { directorScenes } : {}),
    screenplay, screenplayFountain: sourceFountain };
}

/** User-requested import into the active picture; automatic hydration keeps its version guard. */
export function applyExplicitProdigalSceneReplacement(picture: Picture, source: ProdigalDirectorScene, manifest: ProdigalDirectorManifest): Picture {
  if (manifest.schemaVersion !== 1 || picture.id !== manifest.pictureId || source.sceneId !== "PS-S01"
    || !picture.performance || picture.performance.pictureId !== picture.id
    || !picture.scenes.some((scene) => scene.id === source.sceneId) || !source.replacement?.revision) {
    throw new Error("The explicit replacement must target Scene 01 of the matching active Prodigal Son picture.");
  }
  if (picture.directorSceneRevisions?.[source.sceneId] === source.replacement.revision) return picture;
  if (!validReplacement(picture, source)) throw new Error("The scene replacement has invalid or conflicting shots, timing, prompts or media.");
  if (parseScreenplayHierarchy(picture.screenplay.workingFountain).nodes.filter((node) => node.kind === "scene" && node.id === source.sceneId).length !== 1) {
    throw new Error("Scene 01 must occur exactly once in the working screenplay before replacing it.");
  }
  return replaceScene(picture, source, manifest);
}

function validReplacement(picture: Picture, source: ProdigalDirectorScene): boolean {
  const replacement = source.replacement;
  if (!replacement || !replacement.revision.trim() || !replacement.screenplayMarkdown.trim()
    || source.frameRate !== 24 || !Number.isFinite(source.storyDurationSeconds) || source.storyDurationSeconds <= 0
    || !Number.isFinite(source.generationDurationSeconds) || source.generationDurationSeconds <= 0
    || !Array.isArray(source.segments) || !Array.isArray(replacement.shotTitles)
    || !source.title.trim() || !/^[a-f0-9]{64}$/i.test(source.workflow.sha256)
    || !source.workflow.mediaUri.startsWith("/pictures/prodigal-son/director/")
    || !Number.isSafeInteger(source.workflow.bytes) || source.workflow.bytes <= 0) return false;
  const settings = replacement.settings;
  if (!settings || ![settings.width, settings.height].every((value) => Number.isInteger(value) && value >= 0 && value <= 8192)
    || ![settings.baseSteps, settings.refineSteps].every((value) => Number.isInteger(value) && value > 0 && value <= 10000)
    || !settings.outputPrefix || /[\\:\x00]/.test(settings.outputPrefix)
    || settings.outputPrefix.split("/").some((part) => !part || part === "." || part === "..")) return false;
  const ids = new Set(source.segments.map((segment) => segment.shotId));
  if (!ids.size || ids.size !== source.segments.length || replacement.shotTitles.length !== ids.size
    || replacement.shotTitles.some((title) => !title.trim())
    || new Set(source.segments.map((segment) => segment.segmentId)).size !== ids.size) return false;
  if (picture.shots.some((shot) => ids.has(shot.id) && shot.sceneId !== source.sceneId)
    || picture.performance!.shots.some((shot) => (ids.has(shot.shotId) || ids.has(shot.canonicalShotId)) && shot.sceneId !== source.sceneId)) return false;
  let end = 0;
  for (const segment of source.segments) {
    if (!segment.shotId.trim() || !segment.segmentId.trim() || segment.startFrame !== end || !Number.isSafeInteger(segment.durationFrames) || segment.durationFrames <= 0
      || segment.durationSeconds !== segment.durationFrames / source.frameRate || !segment.prompt.trim()
      || !/^[a-f0-9]{64}$/i.test(segment.startImage.sha256) || !segment.startImage.mediaUri.startsWith("/pictures/prodigal-son/director/")) return false;
    end += segment.durationFrames;
    if (!Number.isSafeInteger(end)) return false;
  }
  return end / source.frameRate === source.generationDurationSeconds;
}

function replaceScene(picture: Picture, source: ProdigalDirectorScene, manifest: ProdigalDirectorManifest): Picture {
  const sceneId = source.sceneId, replacement = source.replacement!, now = manifest.createdAt;
  const previous = picture.performance!;
  const oldShots = picture.shots.filter((shot) => shot.sceneId === sceneId);
  const oldCanonical = previous.shots.filter((shot) => shot.sceneId === sceneId);
  const shotIds = new Set([...oldShots.map((shot) => shot.id), ...oldCanonical.flatMap((shot) => [shot.shotId, shot.canonicalShotId]), ...source.segments.map((segment) => segment.shotId)]);
  const beatIds = new Set([...previous.beats.filter((beat) => beat.sceneId === sceneId).map((beat) => beat.id), ...oldCanonical.map((shot) => shot.beatId)]);
  const sceneOrder = picture.scenes.findIndex((scene) => scene.id === sceneId);
  const followingScenes = new Set(picture.scenes.slice(sceneOrder + 1).map((scene) => scene.id));
  const indexStart = oldShots.length ? Math.min(...oldShots.map((shot) => shot.index))
    : Math.min(...picture.shots.filter((shot) => followingScenes.has(shot.sceneId)).map((shot) => shot.index), Math.max(0, ...picture.shots.map((shot) => shot.index)) + 1);
  const delta = source.segments.length - oldShots.length;
  const shiftIndex = (index: number, otherSceneId: string) => followingScenes.has(otherSceneId) ? index + delta : index;
  const newShots: Shot[] = source.segments.map((segment, offset) => ({
    id: segment.shotId, sceneId, index: indexStart + offset, type: "coverage", description: replacement.shotTitles[offset],
    durationSec: segment.durationSeconds, camera: "", lens: "", cameraMove: "", emotion: "", expression: "",
    t2iPrompt: "", i2vPrompt: segment.prompt, t2voicePrompt: "", stillUrl: segment.startImage.mediaUri,
  }));
  const newCanonical: CanonicalShotSpec[] = newShots.map((shot) => {
    const state = envelope(shot.description);
    return {
      schemaVersion: 1, shotId: shot.id, canonicalShotId: shot.id, version: (oldCanonical.find((item) => item.shotId === shot.id)?.version ?? 0) + 1,
      pictureId: picture.id, sceneId, beatId: `${shot.id}:director:${replacement.revision}:beat`, sequenceOrder: shot.index,
      durationSec: shot.durationSec, status: "DRAFT", compilerState: "PLANNED", framing: { composition: shot.description, aspectRatio: picture.format },
      camera: {}, subject: { characters: [], actions: [shot.description] }, performanceIn: state, performanceOut: envelope(shot.description),
      world: {}, continuity: { requiredIn: state, requiredOut: envelope(shot.description) }, audio: {}, references: { firstFrame: [shot.stillUrl!] },
      negatives: [], intendedEngine: picture.selectedEngine.video, dependencyState: [manifest.screenplayVersionId, sceneId, replacement.revision],
      legacy: { ...shot }, lastUpdatedBy: manifest.packageId, createdAt: now, updatedAt: now,
    };
  });
  const shots = [...picture.shots.filter((shot) => shot.sceneId !== sceneId).map((shot) => {
    const index = shiftIndex(shot.index, shot.sceneId);
    return index === shot.index ? shot : { ...shot, index };
  }), ...newShots].sort((a, b) => a.index - b.index);
  const performance: PerformanceWorkspace = {
    ...previous,
    scenes: previous.scenes.map((scene) => scene.id === sceneId ? { ...scene, slugline: sceneSlugline(source), summary: source.title, durationSec: source.storyDurationSeconds } : scene),
    shots: [...previous.shots.filter((shot) => shot.sceneId !== sceneId).map((shot) => {
      const sequenceOrder = shiftIndex(shot.sequenceOrder, shot.sceneId);
      return sequenceOrder === shot.sequenceOrder ? shot : { ...shot, sequenceOrder };
    }), ...newCanonical].sort((a, b) => a.sequenceOrder - b.sequenceOrder),
    beats: [...previous.beats.filter((beat) => beat.sceneId !== sceneId).map((beat) => {
      const sequence = shiftIndex(beat.sequence, beat.sceneId);
      return sequence === beat.sequence ? beat : { ...beat, sequence };
    }), ...newCanonical.map((shot) => ({ id: shot.beatId, sceneId, sequence: shot.sequenceOrder, title: shot.legacy!.description, kind: "default" as const,
      summary: source.segments.find((segment) => segment.shotId === shot.shotId)!.prompt, durationSec: shot.durationSec, transitionFromPreviousSec: 0,
      canSplit: false, dependencies: { socialWorldIds: [], requiredCharacters: [] }, createdAt: now }))].sort((a, b) => a.sequence - b.sequence),
    performance: withoutKeys(previous.performance, beatIds),
    shotVersions: { ...Object.fromEntries(Object.entries(previous.shotVersions).filter(([id, value]) => !shotIds.has(id) && !shotIds.has(value.shotId))),
      ...Object.fromEntries(newCanonical.map((shot) => [shot.canonicalShotId, { shotId: shot.shotId, version: shot.version, schemaVersion: 1 as const, createdAt: now, dependencies: [...shot.dependencyState] }])) },
    queue: { ...Object.fromEntries(Object.entries(previous.queue).filter(([id, value]) => !shotIds.has(id) && !shotIds.has(value.shotId))),
      ...Object.fromEntries(newCanonical.map((shot) => [shot.canonicalShotId, { queueId: `${shot.shotId}:director:${replacement.revision}:queue`, shotId: shot.shotId,
        canonicalShotVersion: shot.version, approvedReferences: [], intendedEngine: shot.intendedEngine, dependencyState: [...shot.dependencyState],
        readiness: "PLANNED" as const, compileState: "PLANNED" as const, createdAt: now, updatedAt: now }])) },
    continuityDecisions: previous.continuityDecisions.filter((item) => item.sceneId !== sceneId && !shotIds.has(item.fromShotId) && !shotIds.has(item.toShotId) && !beatIds.has(item.beatId)),
  };
  // Rebuild only this scene's graph; retain manually authored dependencies elsewhere.
  const localGraph = buildDependencyGraph({ ...performance, scenes: performance.scenes.filter((scene) => scene.id === sceneId), beats: performance.beats.filter((beat) => beat.sceneId === sceneId), shots: newCanonical });
  const affected = (node: DependencyGraph["nodes"][number]) => node.kind === "shot" && shotIds.has(node.id) || node.kind === "beat" && beatIds.has(node.id) || node.kind === "queue" && Object.values(previous.queue).some((item) => item.queueId === node.id && shotIds.has(item.shotId));
  const retainedNodes = previous.dependencyGraph.nodes.filter((node) => !affected(node));
  const existingNodes = new Set(retainedNodes.map((node) => `${node.kind}:${node.id}`));
  performance.dependencyGraph = { nodes: [...retainedNodes, ...localGraph.nodes.filter((node) => !existingNodes.has(`${node.kind}:${node.id}`))],
    edges: [...previous.dependencyGraph.edges.filter((edge) => !affected(edge.from) && !affected(edge.to)), ...localGraph.edges] };
  const priorGates = picture.generateGates ?? emptyGenerateGates();
  const gates: GenerateGateWorkspace = { ...priorGates, pairs: priorGates.pairs.filter((pair) => !shotIds.has(pair.shotId)),
    prompts: [...priorGates.prompts], iterations: priorGates.iterations.map((iteration) => shotIds.has(iteration.shotId) && (iteration.canonical || iteration.status === "APPROVED")
      ? { ...iteration, canonical: false, status: "STALE" as const } : iteration) };
  const iterationIds = new Map(source.segments.map((segment) => {
    const base = `${manifest.packageId}:${segment.shotId}:start:${segment.startImage.sha256}`;
    // A later revision may reuse identical media without replacing the prior review record.
    return [segment.shotId, priorGates.iterations.some((item) => item.id === base) ? `${base}:${replacement.revision}` : base];
  }));
  for (const segment of source.segments) {
    const firstPromptId = `${manifest.packageId}:${replacement.revision}:${segment.shotId}:first:prompt`;
    const videoPromptId = `${manifest.packageId}:${replacement.revision}:${segment.shotId}:video`;
    const iterationId = iterationIds.get(segment.shotId)!;
    const firstPrompt = `Use the supplied starting image for ${segment.shotId}.`;
    gates.pairs.push({ shotId: segment.shotId, firstPrompt, lastPrompt: "", firstPromptVersionId: firstPromptId, lastPromptVersionId: null,
      firstApprovedId: null, lastApprovedId: null, status: "NEEDS_REVIEW", staleReasons: [], assetRefIds: [], waived: false });
    gates.prompts.push({ id: firstPromptId, gate: "keyframes", shotId: segment.shotId, assetId: null, kind: "first", text: firstPrompt, createdAt: now, assetRefIds: [], firstFrameId: null, lastFrameId: null },
      { id: videoPromptId, gate: "video", shotId: segment.shotId, assetId: null, kind: "video", text: segment.prompt, createdAt: now, assetRefIds: [], firstFrameId: iterationId, lastFrameId: null });
    gates.iterations.push({ id: iterationId, shotId: segment.shotId, kind: "first", origin: "imported", promptVersionId: firstPromptId,
      mediaUri: segment.startImage.mediaUri, mediaSha256: segment.startImage.sha256, status: "NEEDS_REVIEW", canonical: false, createdAt: now, failClosedReason: null });
  }
  const next: Picture = {
    ...picture, shots, performance, generateGates: gates, updatedAt: now,
    scenes: picture.scenes.map((scene) => scene.id === sceneId ? { ...scene, slugline: sceneSlugline(source), summary: source.title, emotionalBeat: source.title, durationSec: source.storyDurationSeconds } : scene),
    directorSceneRevisions: { ...picture.directorSceneRevisions, [sceneId]: replacement.revision },
    directorScenes: { ...picture.directorScenes, [sceneId]: {
      schemaVersion: 1, sceneId, template: { ...source.workflow }, globalPrompt: source.globalPrompt, frameRate: source.frameRate,
      width: replacement.settings.width, height: replacement.settings.height, baseSteps: replacement.settings.baseSteps,
      refineSteps: replacement.settings.refineSteps, outputPrefix: replacement.settings.outputPrefix,
      segments: source.segments.map((segment) => ({ segmentId: segment.segmentId, shotId: segment.shotId, type: "image" as const,
        durationFrames: segment.durationFrames, prompt: segment.prompt, imageBinding: {
          iterationId: iterationIds.get(segment.shotId)!,
          mediaUri: segment.startImage.mediaUri, sha256: segment.startImage.sha256,
        } })),
    } },
    ...(picture.directorWorkflowDrafts ? { directorWorkflowDrafts: withoutKeys(picture.directorWorkflowDrafts, new Set([sceneId])) } : {}),
    ...(picture.emotionPerformance?.applied[sceneId] ? { emotionPerformance: undoPerformanceDraft(picture, sceneId, now) } : {}),
    ...(picture.frameBundle ? { frameBundle: { ...picture.frameBundle,
      importedShotIds: [...new Set([...picture.frameBundle.importedShotIds, ...source.segments.map((segment) => segment.shotId)])],
      skippedShotIds: picture.frameBundle.skippedShotIds.filter((id) => !shotIds.has(id)) } } : {}),
    directorBundle: { packageId: manifest.packageId, revision: picture.directorBundle?.revision ?? "",
      importedShotIds: [...new Set([...(picture.directorBundle?.importedShotIds ?? []).filter((id) => !shotIds.has(id)), ...source.segments.map((segment) => segment.shotId)])],
      skippedShotIds: (picture.directorBundle?.skippedShotIds ?? []).filter((id) => !shotIds.has(id)),
      importedPromptIds: [...new Set([...(picture.directorBundle?.importedPromptIds ?? []), ...source.segments.map((segment) => `${manifest.packageId}:${replacement.revision}:${segment.shotId}:video`)])],
      importedIterationIds: [...new Set([...(picture.directorBundle?.importedIterationIds ?? []), ...iterationIds.values()])] },
    ...(picture.video ? { video: { ...picture.video, takes: picture.video.takes.map((take) => shotIds.has(take.shotId) && (take.canonical || take.status === "CANONICAL")
      ? { ...take, canonical: false, status: "NEEDS_REVIEW" as const, reviewReason: "This scene was replaced. Review this earlier take against the new shot before using it." } : take) } } : {}),
    ...(picture.cinematography ? { cinematography: { ...picture.cinematography, shotPlans: picture.cinematography.shotPlans.map((plan) => plan.sceneId === sceneId || shotIds.has(plan.shotId) ? { ...plan, status: "STALE" as const, approvedVersionId: null } : plan) } } : {}),
  };
  return applyScreenplayReplacement(next, source, now);
}

/** Preserve source wording while changing only Markdown markup to Fountain notation. */
function replacementFountain(source: ProdigalDirectorScene): string {
  const markdown = source.replacement!.screenplayMarkdown.replace(/\r\n?/g, "\n");
  const heading = sceneSlugline(source);
  const lines = markdown.split("\n").map((line) => {
    if (/^#{1,6} /.test(line)) return `[[${line.replace(/^#{1,6} /, "")}]]`;
    if (/^\d+[–-]\d+ seconds/.test(line) || /^\d+ shots/.test(line)) return `[[${line}]]`;
    return line.replace(/\*\*([^*]+)\*\*/g, "$1");
  });
  const body = lines.join("\n").replace(/\n([A-Z][A-Z ]+)\n\n(?=\S)/g, "\n$1\n");
  return `${/^(?:EXT\.|INT\.)/.test(heading) ? heading : `.${heading}`} #${source.sceneId}#\n[[Duration: ${source.storyDurationSeconds} | Title: ${source.title}]]\n\n${body.trim()}\n\n`;
}

function spliceScene(fountain: string, sceneId: string, replacement: string): string | null {
  const hierarchy = parseScreenplayHierarchy(fountain);
  const matches = hierarchy.nodes.filter((node) => node.kind === "scene" && node.id === sceneId);
  if (matches.length !== 1) return null;
  const scene = matches[0];
  const eol = fountain.includes("\r\n") ? "\r\n" : "\n";
  return fountain.slice(0, scene.sourceStart) + replacement.replace(/\n/g, eol) + fountain.slice(scene.sourceEnd);
}

function applyScreenplayReplacement(picture: Picture, source: ProdigalDirectorScene, now: number): Picture {
  const replacement = replacementFountain(source);
  const working = spliceScene(picture.screenplay.workingFountain, source.sceneId, replacement);
  const current = picture.screenplay.versions.find((version) => version.id === picture.screenplay.currentVersionId);
  const approved = picture.screenplay.versions.find((version) => version.id === picture.screenplay.approvedVersionId);
  const versionFountain = working ?? (approved ? spliceScene(approved.fountain, source.sceneId, replacement) : null);
  if (!versionFountain) return picture;
  const id = `${picture.id}:${source.sceneId}:replacement:${source.replacement!.revision}`;
  const hierarchy = parseScreenplayHierarchy(versionFountain, picture.screenplay.hierarchy);
  const version = { id, label: `${source.sceneId} · ${source.title}`, kind: "manual" as const, fountain: versionFountain, createdAt: now,
    model: null, workflow: picture.screenplay.workflow, pass: null, sourceVersionId: current?.id ?? approved?.id ?? null, settings: null,
    logicalRole: "manual" as const, hierarchy };
  return { ...picture, screenplayFountain: spliceScene(picture.screenplayFountain, source.sceneId, replacement) ?? picture.screenplayFountain,
    screenplay: { ...picture.screenplay, versions: picture.screenplay.versions.some((item) => item.id === id) ? picture.screenplay.versions : [...picture.screenplay.versions, version],
      ...(working ? { workingFountain: working, currentVersionId: id, hierarchy, status: "READY_FOR_REVIEW" as const, updatedAt: now } : {}) } };
}
