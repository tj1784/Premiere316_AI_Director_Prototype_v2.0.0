import type { Picture, Shot } from "./types.ts";
import type { CanonicalShotSpec, DependencyGraph, PerformanceContinuityEnvelope, PerformanceWorkspace } from "../performance/types.ts";
import { buildDependencyGraph } from "../performance/domain.ts";
import { emptyGenerateGates, type GenerateGateWorkspace } from "../production/generate-gates.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import type { ProdigalDirectorManifest, ProdigalDirectorScene } from "./prodigal-director-types.ts";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";

const withoutKeys = <T>(values: Record<string, T>, ids: Set<string>): Record<string, T> => Object.fromEntries(Object.entries(values).filter(([id]) => !ids.has(id)));
const envelope = (text: string): PerformanceContinuityEnvelope => ({ visual: {}, performance: {}, story: { chronologyNote: text } });
const sceneSlugline = (source: ProdigalDirectorScene): string => source.replacement!.screenplayMarkdown.match(/^## (EXT\.[^\r\n]+)$/m)?.[1] ?? source.title;

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
  return next;
}

function validReplacement(picture: Picture, source: ProdigalDirectorScene): boolean {
  const ids = new Set(source.segments.map((segment) => segment.shotId));
  if (!ids.size || ids.size !== source.segments.length || source.replacement!.shotTitles.length !== ids.size) return false;
  if (picture.shots.some((shot) => ids.has(shot.id) && shot.sceneId !== source.sceneId)
    || picture.performance!.shots.some((shot) => (ids.has(shot.shotId) || ids.has(shot.canonicalShotId)) && shot.sceneId !== source.sceneId)) return false;
  let end = 0;
  for (const segment of source.segments) {
    if (segment.startFrame !== end || !Number.isInteger(segment.durationFrames) || segment.durationFrames <= 0
      || segment.durationSeconds !== segment.durationFrames / source.frameRate || !segment.prompt.trim()
      || !/^[a-f0-9]{64}$/i.test(segment.startImage.sha256) || !segment.startImage.mediaUri.startsWith("/pictures/prodigal-son/director/")) return false;
    end += segment.durationFrames;
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
    prompts: priorGates.prompts.filter((prompt) => !prompt.shotId || !shotIds.has(prompt.shotId)), iterations: priorGates.iterations.filter((iteration) => !shotIds.has(iteration.shotId)) };
  for (const segment of source.segments) {
    const firstPromptId = `${manifest.packageId}:${replacement.revision}:${segment.shotId}:first:prompt`;
    const videoPromptId = `${manifest.packageId}:${replacement.revision}:${segment.shotId}:video`;
    const iterationId = `${manifest.packageId}:${segment.shotId}:start:${segment.startImage.sha256}`;
    const firstPrompt = `Use the supplied starting image for ${segment.shotId}.`;
    gates.pairs.push({ shotId: segment.shotId, firstPrompt, lastPrompt: "", firstPromptVersionId: firstPromptId, lastPromptVersionId: null,
      firstApprovedId: null, lastApprovedId: null, status: "NEEDS_REVIEW", staleReasons: [], assetRefIds: [], waived: false });
    gates.prompts.push({ id: firstPromptId, gate: "keyframes", shotId: segment.shotId, assetId: null, kind: "first", text: firstPrompt, createdAt: now, assetRefIds: [], firstFrameId: null, lastFrameId: null },
      { id: videoPromptId, gate: "video", shotId: segment.shotId, assetId: null, kind: "video", text: segment.prompt, createdAt: now, assetRefIds: [], firstFrameId: iterationId, lastFrameId: null });
    gates.iterations.push({ id: iterationId, shotId: segment.shotId, kind: "first", origin: "imported", promptVersionId: firstPromptId,
      mediaUri: segment.startImage.mediaUri, mediaSha256: segment.startImage.sha256, status: "NEEDS_REVIEW", canonical: false, createdAt: now, failClosedReason: null });
  }
  const next: Picture = {
    ...picture, shots, performance, generateGates: gates,
    scenes: picture.scenes.map((scene) => scene.id === sceneId ? { ...scene, slugline: sceneSlugline(source), summary: source.title, emotionalBeat: source.title, durationSec: source.storyDurationSeconds } : scene),
    directorSceneRevisions: { ...picture.directorSceneRevisions, [sceneId]: replacement.revision },
    directorScenes: { ...picture.directorScenes, [sceneId]: {
      schemaVersion: 1, sceneId, template: { ...source.workflow }, globalPrompt: source.globalPrompt, frameRate: source.frameRate,
      width: replacement.settings.width, height: replacement.settings.height, baseSteps: replacement.settings.baseSteps,
      refineSteps: replacement.settings.refineSteps, outputPrefix: replacement.settings.outputPrefix,
      segments: source.segments.map((segment) => ({ segmentId: segment.segmentId, shotId: segment.shotId, type: "image" as const,
        durationFrames: segment.durationFrames, prompt: segment.prompt, imageBinding: {
          iterationId: `${manifest.packageId}:${segment.shotId}:start:${segment.startImage.sha256}`,
          mediaUri: segment.startImage.mediaUri, sha256: segment.startImage.sha256,
        } })),
    } },
    ...(picture.directorWorkflowDrafts ? { directorWorkflowDrafts: withoutKeys(picture.directorWorkflowDrafts, new Set([sceneId])) } : {}),
    ...(picture.frameBundle ? { frameBundle: { ...picture.frameBundle,
      importedShotIds: [...new Set([...picture.frameBundle.importedShotIds, ...source.segments.map((segment) => segment.shotId)])],
      skippedShotIds: picture.frameBundle.skippedShotIds.filter((id) => !shotIds.has(id)) } } : {}),
    directorBundle: { packageId: manifest.packageId, revision: picture.directorBundle?.revision ?? "",
      importedShotIds: [...new Set([...(picture.directorBundle?.importedShotIds ?? []).filter((id) => !shotIds.has(id)), ...source.segments.map((segment) => segment.shotId)])],
      skippedShotIds: (picture.directorBundle?.skippedShotIds ?? []).filter((id) => !shotIds.has(id)),
      importedPromptIds: [...new Set([...(picture.directorBundle?.importedPromptIds ?? []), ...gates.prompts.filter((prompt) => prompt.kind === "video" && prompt.shotId && shotIds.has(prompt.shotId)).map((prompt) => prompt.id)])],
      importedIterationIds: [...new Set([...(picture.directorBundle?.importedIterationIds ?? []), ...gates.iterations.filter((iteration) => shotIds.has(iteration.shotId)).map((iteration) => iteration.id)])] },
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
