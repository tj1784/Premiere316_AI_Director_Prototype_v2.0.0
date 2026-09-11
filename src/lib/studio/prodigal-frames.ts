import type { Picture, Shot } from "./types.ts";
import type { CanonicalShotSpec, PerformanceContinuityEnvelope, PerformanceWorkspace } from "../performance/types.ts";
import { buildDependencyGraph, buildQueue } from "../performance/domain.ts";
import { directedReferenceVersions, hydrateGenerateGates, type KeyframeKind, type PromptVersion } from "../production/generate-gates.ts";
import { isVisualAsset } from "./asset-prompt-context.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";
import type { ProdigalFrameManifest, ProdigalFrameShot } from "./prodigal-frame-types.ts";
import { seedCinematographyFromPicture } from "../cinematography.ts";

function envelope(description: string): PerformanceContinuityEnvelope {
  // Full image prompts belong to the camera plan and frame prompt versions.
  // Do not duplicate them as body posture (or invent structured acting values).
  return { visual: {}, performance: {}, story: { chronologyNote: description } };
}

function legacyShot(source: ProdigalFrameShot, index: number): Shot {
  return {
    id: source.id, sceneId: source.scene_id, index, type: source.dialogue_framing === "close_up" ? "closeup" : source.lens_mm <= 28 ? "establishing" : source.lens_mm >= 75 ? "closeup" : "coverage",
    dialogueFraming: source.dialogue_framing, dialogueFramingException: source.dialogue_framing_exception,
    description: source.title, durationSec: source.duration_seconds,
    camera: "35mm anamorphic · 2.39:1", lens: `${source.lens_mm}mm`, cameraMove: source.camera_motion,
    emotion: "restrained, emotionally grounded", expression: "natural performance",
    t2iPrompt: source.first_frame,
    i2vPrompt: `${source.camera_motion}\nFIRST FRAME: ${source.first_frame}\nLAST FRAME: ${source.last_frame}\n${source.continuity_locks.join("\n")}\n${source.dialogue_coverage}`,
    t2voicePrompt: source.dialogue_coverage,
    stillUrl: source.frames.first?.mediaUri,
  };
}

function canonicalShot(source: ProdigalFrameShot, index: number, manifest: ProdigalFrameManifest, picture: Picture): CanonicalShotSpec {
  const first = envelope(`${source.id} — first frame of ${source.title}. See the first-frame prompt and reference image.`);
  const last = envelope(`${source.id} — last frame of ${source.title}. See the last-frame prompt and reference image.`);
  const legacy = legacyShot(source, index);
  return {
    schemaVersion: 1, shotId: source.id, canonicalShotId: source.id, version: 1,
    pictureId: picture.id, sceneId: source.scene_id, beatId: `${source.id}:frame-plan-beat`, sequenceOrder: index,
    durationSec: source.duration_seconds, status: "DRAFT", compilerState: "PLANNED",
    framing: { shotSize: legacy.type, lens: legacy.lens, aspectRatio: manifest.aspectRatio, composition: source.title },
    camera: { movementPath: source.camera_motion, startComposition: source.first_frame, endComposition: source.last_frame },
    subject: { characters: [...source.visible_character_asset_ids], actions: [source.title] },
    performanceIn: first, performanceOut: last,
    world: { location: picture.production?.assets.find((asset) => asset.id === source.location_asset_id)?.name ?? source.location_asset_id },
    continuity: { requiredIn: first, requiredOut: last, hardLocks: [...source.continuity_locks], intentionalDiscontinuities: source.reuse_from_shot || source.source_shot_id ? [`Memory reuses ${source.reuse_from_shot ?? source.source_shot_id}; no new scene state.`] : [] },
    // Coverage prose includes editorial instructions, so it must not become ambience or invented speech.
    // The complete coverage remains available on the beat and legacy shot.
    audio: { dialogue: (source.dialogue_lines ?? []).flatMap((line, index) => {
      const character = picture.characters.find((item) => item.name.split(",")[0].trim().toLocaleLowerCase() === line.character.trim().toLocaleLowerCase());
      return character ? [{ id: `${source.id}:dialogue:${index + 1}`, characterId: character.id, text: line.text, sequence: index + 1 }] : [];
    }) },
    references: { firstFrame: source.frames.first ? [source.frames.first.mediaUri] : [], lastFrame: source.frames.last ? [source.frames.last.mediaUri] : [] },
    negatives: ["No text or watermarks", "No modern materials", "No identity drift"],
    intendedEngine: picture.selectedEngine.video,
    dependencyState: [manifest.screenplayVersionId, source.scene_id],
    lastUpdatedBy: manifest.packageId, createdAt: manifest.createdAt, updatedAt: manifest.createdAt,
  };
}

/** Add this user's shot/frame package to both fresh and saved pictures, without overwriting their work. */
export function hydrateProdigalSonFrames(picture: Picture, manifest = PRODIGAL_SON_FRAMES): Picture {
  if (picture.id !== manifest.pictureId || !manifest.shots.length || manifest.schemaVersion !== 1) return picture;
  // A different approved screenplay needs its own plan. An unapproved working draft can coexist.
  if (picture.screenplay.approvedVersionId !== manifest.screenplayVersionId) return picture;
  if (!picture.performance || picture.performance.pictureId !== picture.id) return picture;
  const prior = picture.frameBundle?.packageId === manifest.packageId ? picture.frameBundle : undefined;
  const processed = new Set(prior?.importedShotIds ?? []);
  const skipped = new Set(prior?.skippedShotIds ?? []);
  const seenIterations = new Set(prior?.importedIterationIds ?? []);
  const seenAssetIterations = new Set(prior?.importedAssetIterationIds ?? []);
  const legacyIds = new Set(picture.shots.map((shot) => shot.id));
  const canonicalIds = new Set(picture.performance.shots.flatMap((shot) => [shot.shotId, shot.canonicalShotId]));
  const validSceneIds = new Set(picture.scenes.map((scene) => scene.id));
  const shots = [...picture.shots];
  const addedShotIds = new Set<string>();
  const performance: PerformanceWorkspace = structuredClone(picture.performance);
  let nextIndex = Math.max(0, ...shots.map((shot) => shot.index), ...performance.shots.map((shot) => shot.sequenceOrder));
  for (const source of manifest.shots) {
    if (!validSceneIds.has(source.scene_id) || source.scene_id === "PS-S23" || skipped.has(source.id)) continue;
    if (processed.has(source.id)) continue;
    // A coincident ID belongs to the user unless a previous package import recorded ownership.
    if (legacyIds.has(source.id) || canonicalIds.has(source.id)) { skipped.add(source.id); continue; }
    const index = ++nextIndex;
    const shot = canonicalShot(source, index, manifest, picture);
    shots.push(legacyShot(source, index));
    performance.shots.push(shot);
    performance.beats.push({ id: shot.beatId, sceneId: source.scene_id, sequence: index, title: source.title, kind: "default", summary: source.title, durationSec: source.duration_seconds, transitionFromPreviousSec: 0, canSplit: false, dialogueText: source.dialogue_coverage, dependencies: { socialWorldIds: [], requiredCharacters: [...source.visible_character_asset_ids] }, createdAt: manifest.createdAt });
    performance.shotVersions[shot.canonicalShotId] = { shotId: shot.shotId, version: 1, schemaVersion: 1, createdAt: manifest.createdAt, dependencies: [...shot.dependencyState] };
    processed.add(source.id); legacyIds.add(source.id); canonicalIds.add(source.id);
    addedShotIds.add(source.id);
  }
  const next: Picture = { ...picture, shots, performance };
  if (addedShotIds.size) {
    const seeded = seedCinematographyFromPicture(next, manifest.createdAt);
    const existing = picture.cinematography;
    next.cinematography = existing ? {
      ...existing,
      shotPlans: [...existing.shotPlans, ...seeded.shotPlans.filter((plan) => addedShotIds.has(plan.shotId) && !existing.shotPlans.some((item) => item.shotId === plan.shotId))],
    } : seeded;
  }
  let gates = hydrateGenerateGates(picture.generateGates, next);
  for (const source of manifest.shots) {
    // A user-deleted shot is never reinserted, nor are iterations attached to a colliding user shot.
    if (!processed.has(source.id) || !legacyIds.has(source.id) || !canonicalIds.has(source.id)) continue;
    let pair = gates.pairs.find((item) => item.shotId === source.id);
    if (!pair) continue;
    if (addedShotIds.has(source.id)) {
      const validAssets = new Set((picture.production?.assets ?? []).filter((asset) => isVisualAsset(asset) && !asset.tombstone && !asset.stale).map((asset) => asset.id));
      const assetRefIds = [...new Set([...source.visible_character_asset_ids, ...(source.visible_animal_asset_ids ?? []), source.location_asset_id])].filter((id) => validAssets.has(id));
      pair = { ...pair, assetRefIds, referenceAuthorization: { source: "user", packageId: manifest.packageId } };
    }
    for (const kind of ["first", "last"] as KeyframeKind[]) {
      const field = kind === "first" ? "firstPromptVersionId" : "lastPromptVersionId";
      const text = kind === "first" ? source.first_frame : source.last_frame;
      if (!pair[field]) {
        const promptId = `${manifest.packageId}:${source.id}:${kind}:prompt:v1`;
        if (!gates.prompts.some((prompt) => prompt.id === promptId)) {
          const prompt: PromptVersion = { id: promptId, gate: "keyframes", shotId: source.id, assetId: null, kind, text, createdAt: manifest.createdAt, assetRefIds: [...pair.assetRefIds], firstFrameId: null, lastFrameId: null };
          gates.prompts.push(prompt);
        }
        pair = { ...pair, [field]: promptId, [kind === "first" ? "firstPrompt" : "lastPrompt"]: text };
      }
      const media = source.frames[kind];
      if (!media || !/^[a-f0-9]{64}$/.test(media.sha256) || !media.mediaUri.startsWith("/pictures/prodigal-son/frames/")) continue;
      const iterationId = `${manifest.packageId}:${source.id}:${kind}:${media.sha256}`;
      if (seenIterations.has(iterationId)) continue;
      const choiceField = kind === "first" ? "firstApprovedId" : "lastApprovedId";
      const hasUserChoice = Boolean(pair[choiceField]) || gates.iterations.some((iteration) => iteration.shotId === source.id && iteration.kind === kind && Boolean(iteration.mediaUri));
      const canonical = !hasUserChoice && !pair.waived && pair.status !== "STALE" && pair.status !== "REJECTED";
      if (!gates.iterations.some((iteration) => iteration.id === iterationId)) gates.iterations.push({ id: iterationId, shotId: source.id, kind, origin: "imported", promptVersionId: pair[field], mediaUri: media.mediaUri, mediaSha256: media.sha256, status: canonical ? "APPROVED" : "NEEDS_REVIEW", canonical, createdAt: manifest.createdAt, failClosedReason: null });
      if (canonical) pair = { ...pair, [choiceField]: iterationId, status: "NEEDS_REVIEW" };
      seenIterations.add(iterationId);
      // Add previews only where the user has no existing frame/still selection.
      const canonicalIndex = performance.shots.findIndex((shot) => shot.shotId === source.id);
      if (canonicalIndex >= 0) {
        const current = performance.shots[canonicalIndex];
        const refsKey = kind === "first" ? "firstFrame" : "lastFrame";
        if (!current.references[refsKey]?.length) performance.shots[canonicalIndex] = { ...current, references: { ...current.references, [refsKey]: [media.mediaUri] } };
      }
      if (kind === "first") {
        const index = shots.findIndex((shot) => shot.id === source.id);
        if (index >= 0 && !shots[index].stillUrl) shots[index] = { ...shots[index], stillUrl: media.mediaUri };
      }
    }
    if (pair.firstApprovedId && pair.lastApprovedId && pair.status === "NEEDS_REVIEW") pair = { ...pair, status: "APPROVED" };
    gates.pairs = gates.pairs.map((item) => item.shotId === source.id ? pair! : item);
  }
  performance.dependencyGraph = buildDependencyGraph(performance);
  // Keep existing queues, which may include manual readiness and engine decisions.
  const newQueue = buildQueue(performance);
  performance.queue = { ...newQueue, ...picture.performance.queue };
  if (next.production && manifest.assetCorrections?.length) {
    next.production = {
      ...next.production,
      assets: next.production.assets.map((asset) => {
        const correction = manifest.assetCorrections?.find((item) => item.assetId === asset.id);
        if (!correction || !/^[a-f0-9]{64}$/.test(correction.media.sha256)) return asset;
        const id = `${manifest.packageId}:asset-correction:${asset.id}:${correction.media.sha256}`;
        if (seenAssetIterations.has(id)) return asset;
        seenAssetIterations.add(id);
        const existing = asset.iterations.find((item) => item.id === id);
        const canSelect = !asset.approvedIterationId || asset.approvedIterationId === `${asset.id}:comfy-generated-asset:v1`;
        const specVersionId = asset.approvedSpecVersionId ?? `${asset.id}:imported-spec:v1`;
        const iteration = existing ?? {
          id, assetId: asset.id, variantId: null, specVersionId, mediaUri: correction.media.mediaUri,
          mediaSha256: correction.media.sha256, width: correction.media.width, height: correction.media.height, byteLength: correction.media.bytes,
          uploadedFileName: `${asset.id} — corrected period reference.png`, createdAt: manifest.createdAt,
          status: canSelect ? "APPROVED" as const : "NEEDS_REVIEW" as const,
          provenance: { sourceType: "user" as const, screenplayVersionId: manifest.screenplayVersionId, sceneIds: [...asset.requiredSceneIds], evidenceNote: `${correction.reason} ${manifest.authorization.note}`, createdAt: manifest.createdAt },
        };
        return { ...asset, iterations: existing ? asset.iterations : [...asset.iterations, iteration],
          ...(canSelect ? { canonicalApproved: true, approvedIterationId: id, approvedSpecVersionId: specVersionId, specVersions: asset.specVersions?.map((version) => version.id === specVersionId ? { ...version, approved: true } : version) } : {}),
        };
      }),
    };
  }
  const phariseeFrame = manifest.shots.find((shot) => shot.id === "PS-S01-SH003")?.frames.first;
  if (next.production && phariseeFrame) next.production = {
    ...next.production,
    assets: next.production.assets.map((asset) => {
      if (asset.id !== "PS-CHR-PHARISEE") return asset;
      const id = `${manifest.packageId}:pharisee-context:${phariseeFrame.sha256}`;
      if (asset.references.some((reference) => reference.id === id)) return asset;
      return { ...asset, references: [...asset.references, { id, name: "Opening continuity: Pharisee beside the speaking scribe", uri: phariseeFrame.mediaUri, mediaType: "image/png" as const, preferred: false, uploadedAt: manifest.createdAt, provenance: { sourceType: "user" as const, screenplayVersionId: manifest.screenplayVersionId, sceneIds: ["PS-S01"], evidenceNote: "Scene context only; retain listener member B as the Pharisee's identity reference.", createdAt: manifest.createdAt } }] };
    }),
  };
  // Corrections above establish the selected media before we seal first-import references.
  gates.pairs = gates.pairs.map((pair) => addedShotIds.has(pair.shotId) ? { ...pair, assetReferenceVersions: directedReferenceVersions(next, pair.assetRefIds) } : pair);
  return {
    ...next, generateGates: gates,
    frameBundle: { packageId: manifest.packageId, revision: manifest.revision, importedShotIds: [...processed], skippedShotIds: [...skipped], importedIterationIds: [...seenIterations], importedAssetIterationIds: [...seenAssetIterations], approvalBypass: { source: "user", scope: "first-last-frame-assets", note: manifest.authorization.note } },
  };
}
