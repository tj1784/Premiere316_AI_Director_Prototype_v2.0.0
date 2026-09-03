import { parseJsonLoose, uid } from "../utils.ts";
import type { LocalLLMProvider } from "../studio/local-llm-provider.ts";
import { SHOT_DURATION_POLICY, SPARKY_SCHEMA_VERSION } from "./types.ts";
import type {
  ApprovedScreenplayReference,
  BeatDecompositionOptions,
  BeatKind,
  CanonicalShotSpec,
  ContinuityDecision,
  DependencyChangeEvent,
  DependencyGraph,
  DependencyEdge,
  DialogueAllocation,
  DialogueLine,
  PerformanceContinuityEnvelope,
  PerformanceDirection,
  PerformanceWorkspace,
  QueueState,
  SceneBeat,
  SceneSeed,
  ShotChangeWarning,
  ShotDependencyKind,
  ShotDurationPolicy,
  ShotPreparationQueueEntry,
  ShotReadyState,
  ShotValidationResult,
  ApprovedAssetReference,
} from "./types.ts";

export const MOVEMENT_FIELDS = [
  "gazeDirection",
  "headOrientation",
  "bodyOrientation",
  "posture",
  "handPosition.left",
  "handPosition.right",
  "characterDistanceMeters",
  "facialEmotion",
  "emotionalIntensity",
  "breathing",
  "dialogueCompletion",
] as const;

export type MovementField = (typeof MOVEMENT_FIELDS)[number];

function isFiniteNumber(input: unknown, fallback: number): number {
  return Number.isFinite(Number(input)) && Number(input) > 0 ? Number(input) : fallback;
}

export function normalizeShotDuration(seconds: number, policy: ShotDurationPolicy = SHOT_DURATION_POLICY): number {
  if (!Number.isFinite(seconds)) return policy.targetMinSeconds;
  if (seconds <= policy.minSeconds) return policy.minSeconds;
  if (seconds >= policy.targetMinSeconds && seconds <= policy.targetMaxSeconds) return Math.round(seconds * 10) / 10;
  if (seconds > policy.targetMaxSeconds) return policy.targetMaxSeconds;
  return seconds;
}

export function createBlankContinuityEnvelope(): PerformanceContinuityEnvelope {
  return {
    visual: {},
    performance: {},
    story: {},
  };
}

export function inferBeatKind(text: string): BeatKind {
  const target = text.toLowerCase();
  const checks: Array<{ kind: BeatKind; match: RegExp }> = [
    { kind: "discovery", match: /\b(discover|reveals|learns|discovers|finds|find|uncover)\b/ },
    { kind: "accusation", match: /\b(accuse|accus|blames|charges|confronts|interrogates)\b/ },
    { kind: "hesitation", match: /\b(hesitat|pause|lingers|doubt|uncertain|stops|holds?)\b/ },
    { kind: "pursuit", match: /\b(pursues|chases|follows|runs|tracks|searches)\b/ },
    { kind: "embrace", match: /\b(embrace|clings|holds|reunite|reunites|hug)\b/ },
    { kind: "reaction", match: /\b(shocked|startled|recoils|gasps|frowns|reacts|reactions)\b/ },
    { kind: "revelation", match: /\b(reveal|truth|confess|declares|proclaims|discovers|evidence)\b/ },
    { kind: "transition", match: /\b(transition|cut|dissolve|shift|move to|next|bridge)\b/ },
  ];
  return checks.find((item) => item.match.test(target))?.kind ?? "default";
}

function splitSceneText(summary: string): string[] {
  return summary
    .split(/[.\n;:]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

export function decomposeSceneToBeats(scene: SceneSeed, options: BeatDecompositionOptions = {}): SceneBeat[] {
  const raw = splitSceneText(scene.summary);
  const parts = raw.length > 0 ? raw : [scene.summary.trim() || `${scene.slugline} beat`];
  const maxBeats = options.maxBeats ? Math.max(1, Math.min(options.maxBeats, parts.length)) : Math.min(4, parts.length);
  const selected = parts.slice(0, maxBeats);
  const sceneDuration = isFiniteNumber(
    scene.durationSec ?? options.fallbackTargetSec ?? SHOT_DURATION_POLICY.targetMinSeconds * 2,
    SHOT_DURATION_POLICY.targetMaxSeconds,
  );
  const perBeat = normalizeShotDuration(sceneDuration / selected.length, SHOT_DURATION_POLICY);

  return selected.map((piece, index) => ({
    id: uid("beat"),
    sceneId: scene.id,
    sequence: index + 1,
    title: `${scene.slugline} · ${inferBeatKind(piece)}`,
    kind: inferBeatKind(piece),
    summary: piece,
    durationSec: index === selected.length - 1 ? Math.max(SHOT_DURATION_POLICY.minSeconds, Math.min(sceneDuration - perBeat * index, 20)) : perBeat,
    transitionFromPreviousSec: index === 0 ? 0 : 1,
    canSplit: selected.length > 1,
    dialogueText: "",
    dependencies: {
      socialWorldIds: scene.socialWorldIds ?? [],
      requiredCharacters: [],
    },
    createdAt: Date.now(),
  }));
}

export function decomposeScenesToBeats(scenes: SceneSeed[], options: BeatDecompositionOptions = {}): SceneBeat[] {
  return scenes.flatMap((scene) => decomposeSceneToBeats(scene, options));
}

function mergeContinuity(base: PerformanceContinuityEnvelope, incoming: PerformanceContinuityEnvelope): PerformanceContinuityEnvelope {
  return {
    visual: { ...base.visual, ...incoming.visual },
    story: { ...base.story, ...incoming.story },
    performance: {
      ...base.performance,
      ...incoming.performance,
      handPosition: { ...(base.performance.handPosition ?? {}), ...(incoming.performance.handPosition ?? {}) },
      heldObjects: { ...(base.performance.heldObjects ?? {}), ...(incoming.performance.heldObjects ?? {}) },
      injuries: [...new Set([...(base.performance.injuries ?? []), ...(incoming.performance.injuries ?? [])])],
      environmentalInteraction: [
        ...(base.performance.environmentalInteraction ?? []),
        ...(incoming.performance.environmentalInteraction ?? []),
      ],
    },
  };
}

export function makePerformanceEnvelope(direction: PerformanceDirection): PerformanceContinuityEnvelope {
  return {
    visual: {},
    performance: {
      gazeDirection: direction.face?.gazeTarget,
      headOrientation: direction.body?.headPosition,
      bodyOrientation: direction.body?.posture,
      posture: direction.body?.posture,
      handPosition: {
        left: direction.body?.hands,
        right: direction.body?.arms,
      },
      heldObjects: direction.relationship?.touch ? { touch: direction.relationship.touch } : undefined,
      breathing: direction.body?.breathing,
      facialEmotion: direction.emotionalState?.primary,
      emotionalIntensity: direction.emotionalState?.intensity,
      dialogueCompletion: direction.dialogue ? "started" : undefined,
      characterDistanceMeters: undefined,
      injuries: direction.body?.injuriesOrLimitations,
      environmentalInteraction: direction.movement?.envInteraction ? [direction.movement.envInteraction] : [],
    },
    story: {},
  };
}

export type CanonicalShotInput = Omit<
  CanonicalShotSpec,
  "schemaVersion" | "canonicalShotId" | "version" | "status" | "compilerState" | "createdAt" | "updatedAt"
>;

export function buildCanonicalShot(input: CanonicalShotInput): CanonicalShotSpec {
  const now = Date.now();
  return {
    ...input,
    schemaVersion: SPARKY_SCHEMA_VERSION,
    canonicalShotId: uid("cshot"),
    version: 1,
    status: "DRAFT",
    compilerState: "PLANNED",
    dependencyState: input.dependencyState ?? [],
    durationSec: normalizeShotDuration(input.durationSec),
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateContinuityEnvelope(source: PerformanceContinuityEnvelope): PerformanceContinuityEnvelope {
  return {
    visual: { ...source.visual },
    story: { ...source.story },
    performance: {
      ...source.performance,
      handPosition: { ...(source.performance.handPosition ?? {}) },
      heldObjects: { ...(source.performance.heldObjects ?? {}) },
      injuries: [...(source.performance.injuries ?? [])],
      environmentalInteraction: [...(source.performance.environmentalInteraction ?? [])],
    },
  };
}

export function makeShotFromSeed(
  seed: SceneBeat,
  shot: Omit<CanonicalShotInput, "sceneId" | "beatId" | "sequenceOrder" | "performanceIn" | "performanceOut">,
): CanonicalShotSpec {
  return buildCanonicalShot({
    ...shot,
    ...seed,
    beatId: seed.id,
    sceneId: seed.sceneId,
    sequenceOrder: seed.sequence,
    durationSec: shot.durationSec,
    performanceIn: createBlankContinuityEnvelope(),
    performanceOut: createBlankContinuityEnvelope(),
    framing: shot.framing,
    camera: shot.camera,
    subject: shot.subject,
    world: shot.world,
    continuity: shot.continuity,
    audio: shot.audio,
    references: shot.references,
    negatives: shot.negatives,
    intendedEngine: shot.intendedEngine,
  });
}

export function buildPerformanceWorkspace(
  pictureId: string,
  approvedScreenplay: ApprovedScreenplayReference,
  scenes: SceneSeed[],
): PerformanceWorkspace {
  const beats = decomposeScenesToBeats(scenes);
  return {
    schemaVersion: 1,
    pictureId,
    approvedScreenplay,
    scenes: scenes.map((scene) => ({ ...scene })),
    beats,
    performance: {},
    shotVersions: {},
    shots: [],
    queue: {},
    continuityDecisions: [],
    dependencyGraph: { nodes: [], edges: [] },
    lastUpdated: Date.now(),
    updatedAt: Date.now(),
  };
}

export function cloneWorkspace(state: PerformanceWorkspace): PerformanceWorkspace {
  return {
    ...state,
    scenes: state.scenes.map((scene) => ({ ...scene })),
    beats: state.beats.map((beat) => ({ ...beat, dependencies: { ...beat.dependencies }, createdAt: beat.createdAt })),
    performance: Object.fromEntries(
      Object.entries(state.performance).map(([beatId, item]) => [
        beatId,
        Object.fromEntries(Object.entries(item).map(([characterId, direction]) => [characterId, { ...direction }])),
      ]),
    ),
    shotVersions: { ...state.shotVersions },
    shots: state.shots.map((shot) => ({
      ...shot,
      framing: { ...shot.framing },
      camera: { ...shot.camera },
      performanceIn: duplicateContinuityEnvelope(shot.performanceIn),
      performanceOut: duplicateContinuityEnvelope(shot.performanceOut),
      world: { ...shot.world },
      continuity: {
        ...shot.continuity,
        hardLocks: [...(shot.continuity.hardLocks ?? [])],
        permittedChanges: [...(shot.continuity.permittedChanges ?? [])],
        intentionalDiscontinuities: [...(shot.continuity.intentionalDiscontinuities ?? [])],
      },
      subject: {
        ...shot.subject,
        characters: [...shot.subject.characters],
        actions: [...(shot.subject.actions ?? [])],
        interactions: [...(shot.subject.interactions ?? [])],
        approvedReferences: [...(shot.subject.approvedReferences ?? [])],
        startingPositions: { ...(shot.subject.startingPositions ?? {}) },
        finalPositions: { ...(shot.subject.finalPositions ?? {}) },
      },
      audio: {
        ...shot.audio,
        dialogue: [...(shot.audio.dialogue ?? [])],
        foley: [...(shot.audio.foley ?? [])],
        sfx: [...(shot.audio.sfx ?? [])],
      },
      references: {
        ...shot.references,
        characterReference: [...(shot.references.characterReference ?? [])],
        wardrobe: [...(shot.references.wardrobe ?? [])],
        location: [...(shot.references.location ?? [])],
        props: [...(shot.references.props ?? [])],
        firstFrame: [...(shot.references.firstFrame ?? [])],
        lastFrame: [...(shot.references.lastFrame ?? [])],
        additional: [...(shot.references.additional ?? [])],
      },
      negatives: [...shot.negatives],
      dependencyState: [...shot.dependencyState],
    })),
    queue: Object.fromEntries(Object.entries(state.queue).map(([k, v]) => [k, { ...v }])),
    continuityDecisions: state.continuityDecisions.map((decision) => ({ ...decision, allowedFields: [...decision.allowedFields] })),
    dependencyGraph: { nodes: [...state.dependencyGraph.nodes], edges: [...state.dependencyGraph.edges] },
    lastUpdated: state.lastUpdated,
    updatedAt: state.updatedAt,
  };
}

export function addPerformanceDirection(state: PerformanceWorkspace, direction: PerformanceDirection): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const byBeat = next.performance[direction.beatId] ?? {};
  byBeat[direction.characterId] = direction;
  next.performance[direction.beatId] = byBeat;
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

function ensureSortedShots(shots: CanonicalShotSpec[]): CanonicalShotSpec[] {
  return [...shots].sort((a, b) => {
    if (a.sequenceOrder !== b.sequenceOrder) return a.sequenceOrder - b.sequenceOrder;
    return a.createdAt - b.createdAt;
  });
}

export function insertOrReplaceShot(state: PerformanceWorkspace, shot: CanonicalShotSpec): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const idx = next.shots.findIndex((item) => item.canonicalShotId === shot.canonicalShotId);
  if (idx >= 0) next.shots[idx] = { ...shot, updatedAt: Date.now(), version: next.shots[idx].version + 1 };
  else next.shots.push(shot);
  next.shots = ensureSortedShots(next.shots).map((item) => ({ ...item }));
  next.shotVersions[shot.canonicalShotId] = {
    shotId: shot.shotId,
    version: shot.version,
    schemaVersion: 1,
    createdAt: shot.createdAt,
    dependencies: [...shot.dependencyState],
  };
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function removeShot(state: PerformanceWorkspace, canonicalShotId: string): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  next.shots = next.shots.filter((item) => item.canonicalShotId !== canonicalShotId);
  delete next.shotVersions[canonicalShotId];
  delete next.queue[canonicalShotId];
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function reorderShot(state: PerformanceWorkspace, canonicalShotId: string, newSequence: number): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const sorted = ensureSortedShots(next.shots);
  const current = sorted.findIndex((shot) => shot.canonicalShotId === canonicalShotId);
  if (current < 0 || newSequence < 0 || newSequence >= sorted.length) return state;
  const list = [...sorted];
  const [shot] = list.splice(current, 1);
  list.splice(newSequence, 0, shot);
  next.shots = list.map((item, index) => ({ ...item, sequenceOrder: index + 1, version: item.version + 1 }));
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function splitShot(state: PerformanceWorkspace, canonicalShotId: string, splitAtSec: number): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const idx = next.shots.findIndex((shot) => shot.canonicalShotId === canonicalShotId);
  if (idx < 0) return state;

  const source = next.shots[idx];
  const firstDuration = normalizeShotDuration(splitAtSec);
  const secondDuration = Math.max(SHOT_DURATION_POLICY.minSeconds, source.durationSec - firstDuration);
  if (source.durationSec < SHOT_DURATION_POLICY.minSeconds * 2 || secondDuration < SHOT_DURATION_POLICY.minSeconds) return state;

  const first: CanonicalShotSpec = {
    ...source,
    canonicalShotId: uid("cshot"),
    version: 1,
    durationSec: firstDuration,
    shotId: `${source.shotId}_A`,
    status: "DRAFT",
    compilerState: "PLANNED",
    performanceOut: duplicateContinuityEnvelope(source.performanceOut),
    continuity: {
      ...source.continuity,
      requiredOut: duplicateContinuityEnvelope(source.performanceOut),
    },
    updatedAt: Date.now(),
  };
  const second: CanonicalShotSpec = {
    ...source,
    canonicalShotId: uid("cshot"),
    version: 1,
    shotId: `${source.shotId}_B`,
    durationSec: secondDuration,
    sequenceOrder: source.sequenceOrder + 1,
    performanceIn: duplicateContinuityEnvelope(source.performanceOut),
    performanceOut: duplicateContinuityEnvelope(source.performanceOut),
    continuity: {
      ...source.continuity,
      requiredIn: duplicateContinuityEnvelope(source.performanceOut),
      requiredOut: duplicateContinuityEnvelope(source.performanceOut),
    },
    status: "DRAFT",
    compilerState: "PLANNED",
    updatedAt: Date.now(),
  };
  next.shots.splice(idx, 1, first, second);
  next.shots = next.shots.map((item, index) => ({ ...item, sequenceOrder: index + 1, version: item.version + 1 }));
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function mergeShots(state: PerformanceWorkspace, firstCanonicalShotId: string, secondCanonicalShotId: string): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const a = next.shots.findIndex((shot) => shot.canonicalShotId === firstCanonicalShotId);
  const b = next.shots.findIndex((shot) => shot.canonicalShotId === secondCanonicalShotId);
  if (a < 0 || b < 0 || Math.abs(a - b) !== 1) return state;
  const first = next.shots[Math.min(a, b)];
  const second = next.shots[Math.max(a, b)];
  const merged: CanonicalShotSpec = {
    ...first,
    canonicalShotId: uid("cshot"),
    version: 1,
    shotId: `${first.shotId}_${second.shotId}`,
    durationSec: normalizeShotDuration(first.durationSec + second.durationSec, {
      minSeconds: SHOT_DURATION_POLICY.minSeconds,
      targetMinSeconds: SHOT_DURATION_POLICY.targetMinSeconds,
      targetMaxSeconds: SHOT_DURATION_POLICY.targetMaxSeconds,
    }),
    performanceOut: duplicateContinuityEnvelope(second.performanceOut),
    continuity: {
      ...first.continuity,
      requiredOut: duplicateContinuityEnvelope(second.performanceOut),
      hardLocks: [...new Set([...(first.continuity.hardLocks ?? []), ...(second.continuity.hardLocks ?? [])])],
      permittedChanges: [...(first.continuity.permittedChanges ?? []), ...(second.continuity.permittedChanges ?? [])],
    },
    status: "DRAFT",
    compilerState: "PLANNED",
    dependencyState: [...new Set([...first.dependencyState, ...second.dependencyState])],
    references: {
      ...first.references,
      characterReference: [...new Set([...(first.references.characterReference ?? []), ...(second.references.characterReference ?? [])])],
      location: [...new Set([...(first.references.location ?? []), ...(second.references.location ?? [])])],
      props: [...new Set([... (first.references.props ?? []), ...(second.references.props ?? [])])],
    },
    updatedAt: Date.now(),
  };
  const replaceAt = Math.min(a, b);
  next.shots.splice(replaceAt, 2, merged);
  next.shots = next.shots.map((item, index) => ({ ...item, sequenceOrder: index + 1, version: item.version + 1 }));
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function setShotDuration(state: PerformanceWorkspace, canonicalShotId: string, requestedSeconds: number): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const shot = next.shots.find((item) => item.canonicalShotId === canonicalShotId);
  if (!shot) return state;
  shot.durationSec = normalizeShotDuration(requestedSeconds);
  shot.version += 1;
  shot.updatedAt = Date.now();
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function compareContinuity(
  previousOut: PerformanceContinuityEnvelope,
  nextIn: PerformanceContinuityEnvelope,
): Array<{ field: MovementField; message: string }> {
  const out: Array<{ field: MovementField; message: string }> = [];
  const left = previousOut.performance;
  const right = nextIn.performance;
  const add = (field: MovementField, message: string) => out.push({ field, message });
  if (left.gazeDirection && right.gazeDirection && left.gazeDirection !== right.gazeDirection) {
    add("gazeDirection", `gazeDirection changed from ${left.gazeDirection} to ${right.gazeDirection}`);
  }
  if (left.headOrientation && right.headOrientation && left.headOrientation !== right.headOrientation) {
    add("headOrientation", `headOrientation changed from ${left.headOrientation} to ${right.headOrientation}`);
  }
  if (left.bodyOrientation && right.bodyOrientation && left.bodyOrientation !== right.bodyOrientation) {
    add("bodyOrientation", `bodyOrientation changed from ${left.bodyOrientation} to ${right.bodyOrientation}`);
  }
  const leftLeft = left.handPosition?.left ?? "none";
  const rightLeft = right.handPosition?.left ?? "none";
  if (leftLeft !== rightLeft) add("handPosition.left", `left hand position changed from ${leftLeft} to ${rightLeft}`);
  const leftRight = left.handPosition?.right ?? "none";
  const rightRight = right.handPosition?.right ?? "none";
  if (leftRight !== rightRight) add("handPosition.right", `right hand position changed from ${leftRight} to ${rightRight}`);
  return out;
}

export function continuityWarnings(state: PerformanceWorkspace): ShotChangeWarning[] {
  const shots = ensureSortedShots(state.shots);
  const out: ShotChangeWarning[] = [];
  for (let i = 1; i < shots.length; i++) {
    const from = shots[i - 1];
    const to = shots[i];
    const diffs = compareContinuity(from.performanceOut, to.performanceIn);
    if (diffs.length === 0) continue;
    const allow = new Set<string>();
    for (const decision of state.continuityDecisions) {
      if (decision.fromShotId === from.shotId && decision.toShotId === to.shotId) {
        for (const field of decision.allowedFields) allow.add(field);
      }
    }
    for (const diff of diffs) {
      if (allow.has(diff.field)) continue;
      out.push({
        kind: "continuity",
        shotId: to.shotId,
        message: `shot transition requires correction: ${diff.message}`,
        field: diff.field,
        severity: "warning",
      });
    }
  }
  return out;
}

export function markIntentionalDiscontinuity(
  state: PerformanceWorkspace,
  fromShotId: string,
  toShotId: string,
  fields: MovementField[],
  note: string,
): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  next.continuityDecisions.push({
    id: uid("disc"),
    fromShotId,
    toShotId,
    sceneId: "",
    beatId: "",
    allowedFields: [...fields],
    note,
    intentional: true,
    createdAt: Date.now(),
  });
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function applyContinuityFlow(state: PerformanceWorkspace): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const sorted = ensureSortedShots(next.shots);
  let outgoing: PerformanceContinuityEnvelope | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const shot = sorted[i];
    const beat = next.performance[shot.beatId] ?? {};
    const firstDirection = Object.values(beat)[0];
    if (!outgoing) {
      shot.performanceIn = duplicateContinuityEnvelope(createBlankContinuityEnvelope());
      shot.performanceOut = firstDirection
        ? mergeContinuity(shot.performanceIn, makePerformanceEnvelope(firstDirection))
        : duplicateContinuityEnvelope(createBlankContinuityEnvelope());
    } else {
      shot.performanceIn = duplicateContinuityEnvelope(outgoing);
      shot.performanceOut = firstDirection ? mergeContinuity(shot.performanceIn, makePerformanceEnvelope(firstDirection)) : duplicateContinuityEnvelope(shot.performanceIn);
    }
    shot.continuity.requiredIn = duplicateContinuityEnvelope(shot.performanceIn);
    shot.continuity.requiredOut = duplicateContinuityEnvelope(shot.performanceOut);
    outgoing = shot.performanceOut;
    sorted[i] = shot;
  }
  next.shots = sorted.map((shot, index) => ({ ...shot, sequenceOrder: index + 1 }));
  return next;
}

export function validateShotSpec(shot: CanonicalShotSpec): ShotValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!shot.sceneId.trim()) errors.push("shot.sceneId required");
  if (!shot.beatId.trim()) errors.push("shot.beatId required");
  if (!Number.isFinite(shot.durationSec) || shot.durationSec < SHOT_DURATION_POLICY.minSeconds) errors.push("duration too short");
  if (shot.durationSec > 20) warnings.push("duration may be too long for direct compilation");
  if (shot.subject.characters.length === 0) warnings.push("no subject characters assigned");
  return { valid: errors.length === 0, errors, warnings };
}

export function calculateShotReadiness(state: PerformanceWorkspace, shot: CanonicalShotSpec): ShotReadyState {
  const mismatchWarnings = continuityWarnings(state).filter((item) => item.shotId === shot.shotId);
  if (mismatchWarnings.length > 0) return "CONTINUITY_WARNING";
  if (shot.compilerState === "FAILED") return "BLOCKED";
  if (!shot.performanceIn || !shot.performanceOut || !shot.continuity.requiredIn || !shot.continuity.requiredOut) return "NEEDS_PERFORMANCE";
  if ((shot.subject.approvedReferences ?? []).length === 0) return "WAITING_FOR_REFERENCES";
  if ((shot.subject.approvedReferences ?? []).some((item) => !item.approvedIdentityVersion && !item.approvedSceneVersion && item.type === "character")) {
    return "WAITING_FOR_ASSETS";
  }
  if (shot.status === "BLOCKED") return "BLOCKED";
  if (shot.status === "STALE") return "STALE";
  if (shot.status === "DRAFT") return "READY_TO_COMPILE";
  return "READY_TO_GENERATE";
}

export function buildQueue(state: PerformanceWorkspace): Record<string, ShotPreparationQueueEntry> {
  const queue: Record<string, ShotPreparationQueueEntry> = {};
  for (const shot of state.shots) {
    const readiness = calculateShotReadiness(state, shot);
    queue[shot.canonicalShotId] = {
      queueId: uid("q"),
      shotId: shot.shotId,
      canonicalShotVersion: shot.version,
      approvedReferences: shot.subject.approvedReferences ?? [],
      intendedEngine: shot.intendedEngine,
      dependencyState: [...shot.dependencyState],
      readiness: stateToQueueReady(readiness),
      compileState: readiness === "BLOCKED" ? "BLOCKED" : "READY",
      createdAt: shot.createdAt,
      updatedAt: shot.updatedAt,
    };
  }
  return queue;
}

function stateToQueueReady(state: ShotReadyState): QueueState {
  switch (state) {
    case "READY_TO_GENERATE":
      return "READY_TO_GENERATE";
    case "READY_TO_COMPILE":
      return "READY_TO_COMPILE";
    case "WAITING_FOR_ASSETS":
      return "WAITING_FOR_ASSETS";
    case "WAITING_FOR_REFERENCES":
      return "WAITING_FOR_REFERENCE";
    case "STALE":
      return "STALE";
    case "BLOCKED":
    case "CONTINUITY_WARNING":
    default:
      return "BLOCKED";
  }
}

export function assignDialogueToShots(shots: CanonicalShotSpec[], lines: DialogueLine[]): DialogueAllocation {
  if (!shots.length) return {};
  const quotas = shots.map((shot) => Math.max(4, shot.durationSec * 2));
  const allocations: DialogueAllocation = {};
  for (const shot of shots) allocations[shot.shotId] = [];
  let shotIndex = 0;
  let used = 0;
  for (const line of lines) {
    const words = Math.max(1, Math.ceil(line.text.trim().split(/\s+/).length / 2));
    while (shotIndex < shots.length && used + words > quotas[shotIndex]) {
      shotIndex += 1;
      used = 0;
    }
    if (shotIndex >= shots.length) break;
    allocations[shots[shotIndex].shotId].push(line.id);
    used += words;
  }
  return allocations;
}

export function buildDependencyGraph(state: PerformanceWorkspace): DependencyGraph {
  const nodes: Array<{ kind: ShotDependencyKind; id: string }> = [
    { kind: "screenplay-version", id: state.approvedScreenplay.screenplayVersionId },
    ...state.scenes.map((scene) => ({ kind: "scene" as const, id: scene.id })),
    ...state.beats.map((beat) => ({ kind: "beat" as const, id: beat.id })),
    ...state.shots.map((shot) => ({ kind: "shot" as const, id: shot.canonicalShotId })),
  ];
  const edges: DependencyEdge[] = [];
  for (const shot of state.shots) {
    edges.push({ from: { kind: "beat", id: shot.beatId }, to: { kind: "shot", id: shot.canonicalShotId }, reason: "shot derived from beat" });
    edges.push({ from: { kind: "scene", id: shot.sceneId }, to: { kind: "shot", id: shot.canonicalShotId }, reason: "shot derived from scene" });
    for (const reference of shot.subject.approvedReferences ?? []) {
      if (reference.characterId) {
        edges.push({
          from: { kind: "asset", id: reference.characterId },
          to: { kind: "shot", id: shot.canonicalShotId },
          reason: "character identity dependency",
        });
      }
      if (reference.propVersionId) {
        edges.push({
          from: { kind: "asset", id: reference.propVersionId },
          to: { kind: "shot", id: shot.canonicalShotId },
          reason: "prop variant dependency",
        });
      }
      if (reference.locationVersionId) {
        edges.push({
          from: { kind: "asset", id: reference.locationVersionId },
          to: { kind: "shot", id: shot.canonicalShotId },
          reason: "location version dependency",
        });
      }
      if (reference.wardrobeVariantId) {
        edges.push({
          from: { kind: "asset", id: reference.wardrobeVariantId },
          to: { kind: "shot", id: shot.canonicalShotId },
          reason: "wardrobe variant dependency",
        });
      }
    }
    edges.push({
      from: { kind: "screenplay-version", id: state.approvedScreenplay.screenplayVersionId },
      to: { kind: "shot", id: shot.canonicalShotId },
      reason: "shot depends on approved screenplay version",
    });
  }
  return { nodes, edges };
}

export function applyDependencyInvalidation(state: PerformanceWorkspace, change: DependencyChangeEvent): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  if (change.type === "scene-change") {
    for (const shot of next.shots) {
      if (shot.sceneId === change.sceneId) {
        shot.status = "STALE";
        shot.compilerState = "PLANNED";
      }
    }
  }
  if (change.type === "beat-change" || change.type === "dialogue-change") {
    for (const shot of next.shots) {
      if (shot.beatId === change.beatId) {
        shot.status = "STALE";
        shot.compilerState = "PLANNED";
      }
    }
  }
  if (change.type === "asset-change") {
    for (const shot of next.shots) {
      const refs = shot.subject.approvedReferences ?? [];
      const isHit = refs.some((reference) =>
        [reference.characterId, reference.approvedIdentityVersion, reference.wardrobeVariantId, reference.propVersionId, reference.locationVersionId].includes(
          change.assetId,
        ),
      );
      if (isHit) {
        shot.status = "STALE";
        shot.compilerState = "PLANNED";
      }
    }
  }
  next.dependencyGraph = buildDependencyGraph(next);
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function attachApprovedAssetReferences(state: PerformanceWorkspace, shotId: string, assets: ApprovedAssetReference[]): PerformanceWorkspace {
  const next = cloneWorkspace(state);
  const shot = next.shots.find((item) => item.canonicalShotId === shotId);
  if (!shot) return state;
  shot.subject = {
    ...shot.subject,
    approvedReferences: [...assets],
  };
  shot.updatedAt = Date.now();
  next.queue = buildQueue(next);
  next.lastUpdated = Date.now();
  next.updatedAt = next.lastUpdated;
  return next;
}

export function ensureQueueNoRunningState(queue: Record<string, ShotPreparationQueueEntry>): Record<string, ShotPreparationQueueEntry> {
  const snapshot = Object.fromEntries(
    Object.entries(queue).map(([shotId, entry]) => [
      shotId,
      {
        ...entry,
        approvedReferences: [...entry.approvedReferences],
        dependencyState: [...entry.dependencyState],
      },
    ]),
  );
  for (const [shotId, entry] of Object.entries(snapshot)) {
    if (entry.compileState === "COMPILED" || entry.compileState === "FAILED") {
      entry.compileState = "READY";
      continue;
    }
    if (entry.readiness === "READY_TO_GENERATE") {
      entry.compileState = "READY";
    }
  }
  return snapshot;
}

export function serializeWorkspace(state: PerformanceWorkspace): string {
  return JSON.stringify(state);
}

export function deserializeWorkspace(raw: string): PerformanceWorkspace {
  const parsed = JSON.parse(raw) as PerformanceWorkspace;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported performance schema version ${parsed.schemaVersion}`);
  }
  return parsed;
}

export async function suggestPerformanceWithLocalLLM(
  provider: LocalLLMProvider,
  params: {
    sceneSlugline: string;
    beatText: string;
    characterId: string;
    beatId: string;
  },
): Promise<
  | { ok: false; reason: string; source: "manual-only" }
  | { ok: true; direction: Omit<PerformanceDirection, "updatedAt">; source: LocalLLMProvider["id"] }
> {
  const discovery = await provider.discover();
  if (!discovery.available || discovery.providerId !== "lm-studio") {
    return { ok: false, reason: "LM Studio unavailable; keep manual performance editing.", source: "manual-only" };
  }
  try {
    const response = await provider.generate(
      {
        runId: uid("run"),
        stepId: uid("step"),
        system: "Return compact JSON performance direction payload only.",
        prompt: JSON.stringify({
          scene: params.sceneSlugline,
          beat: params.beatText,
          character: params.characterId,
        }),
      },
      {
        servedModelId: discovery.models[0]?.id ?? "unknown",
        settings: {
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 1024,
          contextSize: 4096,
          gpuLayers: 1,
          seed: -1,
        },
      },
    );
    const parsed = parseJsonLoose<{
      emotionalState?: PerformanceDirection["emotionalState"];
      face?: PerformanceDirection["face"];
      body?: PerformanceDirection["body"];
      movement?: PerformanceDirection["movement"];
      relationship?: PerformanceDirection["relationship"];
      dialogue?: PerformanceDirection["dialogue"];
    }>(response.text);
    return {
      ok: true,
      source: discovery.providerId,
      direction: {
        schemaVersion: 1,
        sourceType: "ai-suggestion",
        characterId: params.characterId,
        beatId: params.beatId,
        emotionalState: parsed.emotionalState,
        face: parsed.face,
        body: parsed.body,
        movement: parsed.movement,
        relationship: parsed.relationship,
        dialogue: parsed.dialogue,
        lockedFields: [],
        blockedChanges: [],
      },
    };
  } catch (error) {
    return { ok: false, reason: "Could not parse LocalLLM suggestion response.", source: "manual-only" };
  }
}
