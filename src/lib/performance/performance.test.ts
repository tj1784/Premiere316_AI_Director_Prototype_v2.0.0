import assert from "node:assert/strict";
import test from "node:test";
import {
  addPerformanceDirection,
  applyContinuityFlow,
  applyDependencyInvalidation,
  assignDialogueToShots,
  buildCanonicalShot,
  buildPerformanceWorkspace,
  continuityWarnings,
  createBlankContinuityEnvelope,
  decomposeSceneToBeats,
  decomposeScenesToBeats,
  deserializeWorkspace,
  ensureQueueNoRunningState,
  markIntentionalDiscontinuity,
  mergeShots,
  normalizeShotDuration,
  serializeWorkspace,
  setShotDuration,
  splitShot,
  suggestPerformanceWithLocalLLM,
  buildQueue,
} from "./domain.ts";
import { migrateLegacyShotToCanonicalShot } from "./legacy-migration.ts";
import { SHOT_DURATION_POLICY, type ApprovedScreenplayReference, type PerformanceWorkspace, type SceneSeed } from "./types.ts";

function workspaceFixture(): ApprovedScreenplayReference {
  return {
    pictureId: "pic-1",
    screenplayVersionId: "screenplay-1",
    approvedAt: 1,
    sceneIds: ["scene-1", "scene-2"],
    socialWorld: [],
    sourceType: "screenplay",
  };
}

function sceneFixture(): SceneSeed {
  return {
    id: "scene-1",
    slugline: "INT. LAB",
    summary: "A subject hesitates. They glance at the door. Someone leaves.",
    durationSec: 12,
  };
}

function shotFixture(seedId: string, sequence = 1): Parameters<typeof buildCanonicalShot>[0] {
  return {
    shotId: seedId,
    pictureId: "pic-1",
    sceneId: "scene-1",
    beatId: "beat-1",
    sequenceOrder: sequence,
    durationSec: 10,
    framing: {},
    camera: {},
    subject: {
      characters: ["char-1"],
    },
    performanceIn: createBlankContinuityEnvelope(),
    performanceOut: createBlankContinuityEnvelope(),
    world: {},
    continuity: {
      requiredIn: createBlankContinuityEnvelope(),
      requiredOut: createBlankContinuityEnvelope(),
    },
    audio: {},
    references: {
      characterReference: ["ref-1"],
    },
    negatives: [],
    intendedEngine: "ltx-2",
    dependencyState: [],
  };
}

test("decomposes scene text into capped beat chunks", () => {
  const beats = decomposeSceneToBeats(sceneFixture(), { maxBeats: 2, fallbackTargetSec: 18 });
  assert.equal(beats.length, 2);
  assert.equal(beats[0].sceneId, "scene-1");
  assert.equal(beats[1].sceneId, "scene-1");
  assert.ok(beats.every((beat) => beat.durationSec >= SHOT_DURATION_POLICY.minSeconds));
});

test("decomposes multiple scenes into ordered beats", () => {
  const scenes: SceneSeed[] = [
    sceneFixture(),
    { id: "scene-2", slugline: "EXT. STREET", summary: "Rain starts. Footsteps fade. Someone turns." },
  ];
  const beats = decomposeScenesToBeats(scenes, { fallbackTargetSec: 12, maxBeats: 1 });
  assert.equal(beats.length, 2);
  assert.equal(beats[0].sceneId, "scene-1");
  assert.equal(beats[1].sceneId, "scene-2");
});

test("warns on continuity mismatches and allows intentional decisions", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const shotA = buildCanonicalShot({
    ...shotFixture("shot-1", 1),
    performanceOut: {
      visual: {},
      story: {},
      performance: {
        gazeDirection: "left",
      },
    },
    continuity: {
      requiredIn: createBlankContinuityEnvelope(),
      requiredOut: {
        visual: {},
        story: {},
        performance: {
          gazeDirection: "left",
        },
      },
    },
  });
  const shotB = buildCanonicalShot({
    ...shotFixture("shot-2", 2),
    performanceIn: {
      visual: {},
      story: {},
      performance: {
        gazeDirection: "right",
      },
    },
    continuity: {
      requiredIn: {
        visual: {},
        story: {},
        performance: {
          gazeDirection: "right",
        },
      },
      requiredOut: createBlankContinuityEnvelope(),
    },
  });
  const withShots = { ...base, shots: [shotA, shotB], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  const warnings = continuityWarnings(withShots);
  assert.equal(warnings.length, 1);

  const decided = markIntentionalDiscontinuity(withShots, "shot-1", "shot-2", ["gazeDirection"], "Cut for clarity");
  assert.equal(decided.continuityDecisions.length, 1);
  assert.equal(continuityWarnings(decided).length, 0);
});

test("applies performance flow and records direction as continuity source", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const shot = buildCanonicalShot({ ...shotFixture("shot-1", 1), durationSec: 12 });
  let state: PerformanceWorkspace = { ...base, shots: [shot], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  state = addPerformanceDirection(state, {
    schemaVersion: 1,
    sourceType: "manual",
    characterId: "char-1",
    beatId: shot.beatId,
    face: { gazeTarget: "camera" },
    body: { posture: "lean" },
    movement: { speed: "slow" },
    updatedAt: 1,
  });
  const next = applyContinuityFlow(state);
  assert.equal(next.shots.length, 1);
  assert.equal(next.shots[0].performanceOut.performance?.gazeDirection, "camera");
  assert.equal(next.shots[0]?.continuity.requiredOut?.performance.gazeDirection, "camera");
});

test("normalizes shot duration and supports manual retime", () => {
  const normalized = normalizeShotDuration(4);
  assert.equal(normalized, SHOT_DURATION_POLICY.minSeconds);

  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const shot = buildCanonicalShot({ ...shotFixture("shot-1", 1), durationSec: 12 });
  const state = { ...base, shots: [shot], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  const updated = setShotDuration(state, shot.canonicalShotId, 20);
  assert.equal(updated.shots[0].durationSec, SHOT_DURATION_POLICY.targetMaxSeconds);
});

test("splits and merges adjacent shots while preserving continuity bounds", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const first = buildCanonicalShot({ ...shotFixture("shot-1", 1), durationSec: 12 });
  const second = buildCanonicalShot({ ...shotFixture("shot-2", 2), durationSec: 12, shotId: "shot-2" });
  let state: PerformanceWorkspace = { ...base, shots: [first], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  state = splitShot(state, first.canonicalShotId, 4);
  assert.equal(state.shots.length, 2);
  assert.equal(state.shots[0].sequenceOrder, 1);
  assert.equal(state.shots[1].sequenceOrder, 2);

  const merged = mergeShots({ ...state, shots: [...state.shots], dependencyGraph: { nodes: [], edges: [] }, queue: {} }, state.shots[0].canonicalShotId, state.shots[1].canonicalShotId);
  assert.equal(merged.shots.length, 1);
  assert.equal(merged.shots[0].sequenceOrder, 1);
});

test("builds queue readiness and removes running state from compile statuses", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const withoutRef = buildCanonicalShot({
    ...shotFixture("shot-1", 1),
    subject: {
      characters: ["char-1"],
      approvedReferences: [],
    },
  });
  const withRef = buildCanonicalShot({
    ...shotFixture("shot-2", 2),
    shotId: "shot-2",
    subject: {
      characters: ["char-1"],
      approvedReferences: [{ type: "character", characterId: "char-1", approvedIdentityVersion: "v-1" }],
    },
  });
  const state = { ...base, shots: [withRef, withoutRef], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  const queue = buildQueue(state);
  assert.equal(queue[withRef.canonicalShotId].readiness, "READY_TO_COMPILE");
  assert.equal(queue[withoutRef.canonicalShotId].readiness, "WAITING_FOR_REFERENCE");

  const noRun = ensureQueueNoRunningState({
    ...queue,
    [withRef.canonicalShotId]: { ...queue[withRef.canonicalShotId], readiness: "READY_TO_GENERATE", compileState: "COMPILED" },
  });
  assert.equal(noRun[withRef.canonicalShotId].compileState, "READY");
});

test("invalidates shots when dependencies change", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [
    sceneFixture(),
    { id: "scene-2", slugline: "EXT", summary: "A return", durationSec: 11 },
  ]);
  const shot1 = { ...buildCanonicalShot({ ...shotFixture("shot-1", 1), sceneId: "scene-1" }), status: "READY_TO_COMPILE" as const };
  const shot2 = {
    ...buildCanonicalShot({
      ...shotFixture("shot-2", 2),
      shotId: "shot-2",
      sceneId: "scene-2",
      beatId: base.beats[1]?.id ?? "beat-2",
    }),
    status: "READY_TO_COMPILE" as const,
  };
  const withShots = { ...base, shots: [shot1, shot2], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  const next = applyDependencyInvalidation(withShots, { type: "scene-change", sceneId: "scene-1", reason: "scene edited" });
  assert.equal(next.shots[0].status, "STALE");
  assert.equal(next.shots[1].status, "READY_TO_COMPILE");
});

test("allocates dialogue by duration budget and rounds trip", () => {
  const lines = [
    { id: "line-1", characterId: "char-1", text: "Quick small one.", sequence: 1 },
    { id: "line-2", characterId: "char-1", text: "A longer line with three extra words.", sequence: 2 },
    { id: "line-3", characterId: "char-1", text: "Final line.", sequence: 3 },
  ];
  const shots = [
    buildCanonicalShot(shotFixture("shot-1", 1)),
    buildCanonicalShot({ ...shotFixture("shot-2", 2), shotId: "shot-2" }),
  ];
  const allocation = assignDialogueToShots(shots, lines);
  assert.equal(allocation["shot-1"].length > 0 ? 1 : 0, 1);
  assert.equal(allocation["shot-1"].length + allocation["shot-2"].length, 3);
});

test("serializes and deserializes workspace payloads", () => {
  const base = buildPerformanceWorkspace("pic-1", workspaceFixture(), [sceneFixture()]);
  const shot = buildCanonicalShot({ ...shotFixture("shot-1", 1) });
  const state = { ...base, shots: [shot], dependencyGraph: { nodes: [], edges: [] }, queue: {} };
  const round = deserializeWorkspace(serializeWorkspace(state));
  assert.equal(round.schemaVersion, 1);
  assert.equal(round.shots.length, 1);
  assert.equal(round.shots[0].shotId, "shot-1");
});

test("migrates legacy shots into canonical schema", () => {
  const migrated = migrateLegacyShotToCanonicalShot({
    shotId: "legacy-shot-1",
    pictureId: "pic-1",
    sceneId: "scene-1",
    beatId: "beat-1",
    sequenceOrder: 1,
    intendedEngine: "ltx-2",
    legacy: {
      id: "legacy-1",
      type: "insert",
      description: "close framing",
      camera: "close",
      lens: "50mm",
      cameraMove: "dolly",
      emotion: "worried",
      expression: "tight mouth",
      t2iPrompt: "portrait prompt",
      i2vPrompt: "motion prompt",
      stillUrl: "still://legacy",
      videoUrl: "video://legacy",
    },
  });
  assert.equal(migrated.legacy?.type, "insert");
  assert.equal(migrated.shotId, "legacy-shot-1");
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.references.additional?.includes("portrait prompt"), true);
});

test("returns manual suggestion when local LLM is unavailable", async () => {
  const provider = {
    id: "lm-studio" as const,
    name: "LM Studio" as const,
    discover: async () => ({
      providerId: "lm-studio" as const,
      providerName: "LM Studio" as const,
      endpoint: null,
      local: true,
      cloudFallback: false,
      available: false,
      reason: "Unavailable",
      models: [],
      discoveredAt: 1,
    }),
    listModels: async () => [],
    load: async () => undefined,
    generate: async () => ({ text: "{}", durationMs: 0, promptTokens: 0, generatedTokens: 0 }),
    cancel: async () => undefined,
    telemetry: () => null,
    unload: async () => undefined,
  };
  const response = await suggestPerformanceWithLocalLLM(provider as any, {
    sceneSlugline: "INT. ROOM",
    beatText: "A person enters quietly",
    characterId: "char-1",
    beatId: "beat-1",
  });
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.reason, "LM Studio unavailable; keep manual performance editing.");
    assert.equal(response.source, "manual-only");
  }
});

test("reads structured suggestion from local model output", async () => {
  const provider = {
    id: "lm-studio" as const,
    name: "LM Studio" as const,
    discover: async () => ({
      providerId: "lm-studio" as const,
      providerName: "LM Studio" as const,
      endpoint: "http://127.0.0.1:1234",
      local: true,
      cloudFallback: false,
      available: true,
      reason: "ok",
      models: [{ id: "writer", displayName: "Writer", type: "llm", loaded: true, instanceId: null, path: null, precision: null, quantization: null, contextLength: null, sizeBytes: null }],
      discoveredAt: 1,
    }),
    listModels: async () => [],
    load: async () => undefined,
    generate: async () => ({ text: '{"emotionalState":{"primary":"curious"},"face":{"gazeTarget":"left"}}', durationMs: 0, promptTokens: 0, generatedTokens: 0 }),
    cancel: async () => undefined,
    telemetry: () => null,
    unload: async () => undefined,
  };
  const response = await suggestPerformanceWithLocalLLM(provider as any, {
    sceneSlugline: "EXT. HILL",
    beatText: "The car turns",
    characterId: "char-1",
    beatId: "beat-1",
  });
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.source, "lm-studio");
    assert.equal(response.direction.characterId, "char-1");
    assert.equal(response.direction.emotionalState?.primary, "curious");
  }
});
