import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTER_SECTIONS,
  CHARACTER_FIELD_DETAILS,
  applyCharacterFieldEdit,
  characterFieldView,
  type BibleFieldEdit,
} from "./character-dossier.ts";
import { BIBLE_FIELDS, bibleAuthoringContext } from "./movie-bible.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import { DEFAULT_ENGINES, type Picture, type Shot } from "./types.ts";
import { createProductionBreakdown } from "../production/breakdown.ts";
import {
  addPerformanceDirection,
  buildCanonicalShot,
  buildPerformanceWorkspace,
  createBlankContinuityEnvelope,
} from "../performance/domain.ts";
import { emptyVideoWorkspace } from "../production/video-types.ts";
import { recordImportedVideoTake, reviewVideoTake } from "../production/video-iterations.ts";
import { resolveShotPacket, shotPacketFreshness } from "./resolved-shot-packet.ts";

function fixture() {
  const p: Picture = {
    id: "character-dossier-fixture",
    title: "Dossier test",
    logline: "",
    genre: "",
    tone: "",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 1,
    createdAt: 1,
    updatedAt: 1,
    stage: "visual-development",
    lastOpenedStage: "visual-development",
    thumbnailUrl: null,
    intake: makePictureIntake(1),
    screenplay: makePictureScreenplay("single", null, 1),
    selectedEngine: { ...DEFAULT_ENGINES },
    screenplayFountain: "",
    acts: [],
    scenes: [
      {
        id: "scene-market",
        act: 1,
        slugline: "EXT. MARKET — DAY",
        summary: "The seller waits.",
        emotionalBeat: "Refusal",
        durationSec: 5,
      },
      {
        id: "scene-river",
        act: 1,
        slugline: "EXT. RIVER — DAY",
        summary: "Water flows.",
        emotionalBeat: "Quiet",
        durationSec: 5,
      },
    ],
    characters: [],
    locations: [],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [],
    cues: [],
    voices: [],
    directorNotes: "Keep exact source facts.",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    editorDrafts: { "character-dossier-field-draft": "Pending unrelated input" },
  };
  p.production = createProductionBreakdown(
    {
      pictureId: p.id,
      versionId: "source-version",
      status: "APPROVED",
      fountain: "Fixture source",
      scenes: p.scenes,
      socialWorld: [],
    },
    [
      {
        id: "requirement-seller",
        category: "character",
        name: "Bread seller",
        description: "Adult woman with flour on her hands.",
        sceneIds: ["scene-market"],
      },
    ],
    1,
  );
  const asset = p.production.assets[0];
  asset.aliases = ["Stall keeper"];
  asset.canonicalSpec.age = "Adult";
  asset.canonicalSpec.wardrobe = "Unbleached linen apron";
  asset.canonicalSpec.prohibitedFeatures = ["No modern watch"];
  asset.canonicalSpec.negativeRequirements = ["No plastic packaging"];
  p.characters = [
    {
      id: asset.id,
      name: asset.name,
      role: "Witness",
      age: "Adult",
      look: "Established face",
      arc: "No invented private tragedy",
      voiceId: "",
    },
  ];
  p.shots = p.scenes.map((scene, index): Shot => ({
    id: `shot-${index}`,
    sceneId: scene.id,
    index,
    type: "wide",
    description: scene.summary,
    durationSec: 5,
    camera: "locked",
    lens: "35mm",
    cameraMove: "none",
    emotion: "",
    expression: "",
    t2iPrompt: "",
    i2vPrompt: scene.summary,
    t2voicePrompt: "",
  }));
  p.performance = buildPerformanceWorkspace(
    p.id,
    {
      pictureId: p.id,
      screenplayVersionId: "source-version",
      approvedAt: 1,
      sceneIds: p.scenes.map((scene) => scene.id),
      socialWorld: [],
      sourceType: "screenplay",
    },
    p.scenes,
  );
  const beat = p.performance.beats.find((b) => b.sceneId === "scene-market")!;
  p.performance = addPerformanceDirection(p.performance, {
    schemaVersion: 1,
    sourceType: "manual",
    characterId: asset.id,
    beatId: beat.id,
    emotionalState: { objective: "Keep enough bread for the waiting family", concealed: "Concern" },
    face: { gazeTarget: "The empty hand across the stall" },
    body: { fatigue: "Tired from standing", injuriesOrLimitations: ["Sore left wrist"] },
    updatedAt: 1,
  });
  p.performance.shots = p.shots.map((shot, index) =>
    buildCanonicalShot({
      shotId: shot.id,
      pictureId: p.id,
      sceneId: shot.sceneId,
      beatId: p.performance!.beats.find((b) => b.sceneId === shot.sceneId)!.id,
      sequenceOrder: index + 1,
      durationSec: 5,
      framing: {},
      camera: {},
      subject: { characters: index === 0 ? [asset.id] : [] },
      performanceIn: createBlankContinuityEnvelope(),
      performanceOut: createBlankContinuityEnvelope(),
      world: {},
      continuity: {},
      audio: {},
      references: { characterReference: index === 0 ? [asset.id] : [] },
      negatives: [],
      intendedEngine: "ltx-2",
      dependencyState: [],
    }),
  );
  return { p, characterId: asset.id, participantId: `performance:${beat.id}:${asset.id}` };
}

function edit(
  p: Picture,
  recordId: string,
  field: string,
  value: string,
  options: Partial<BibleFieldEdit> = {},
) {
  return applyCharacterFieldEdit(p, {
    recordId,
    kind: "character",
    field,
    value,
    source: "Authored direction · controlled test fixture",
    disposition: "authored",
    baseRevision: p.movieBible?.records[recordId]?.fields[field]?.revision ?? 0,
    ...options,
  });
}

test("all 17 canonical character fields appear exactly once with visible field guidance", () => {
  const exposed = CHARACTER_SECTIONS.flatMap((section) =>
    section.fields.map((index) => BIBLE_FIELDS.character[index]),
  );
  assert.equal(exposed.length, 17);
  assert.equal(new Set(exposed).size, 17, "Duplicated groups must not hide omitted fields");
  assert.deepEqual([...exposed].sort(), [...BIBLE_FIELDS.character].sort());
  for (const field of exposed) {
    assert.ok(CHARACTER_FIELD_DETAILS[field].label.trim(), `${field} needs a readable label`);
    assert.ok(CHARACTER_FIELD_DETAILS[field].hint.trim(), `${field} needs specific guidance`);
  }
  assert.match(CHARACTER_FIELD_DETAILS.Want.label, /super-objective/i);
  assert.match(CHARACTER_FIELD_DETAILS["History / source boundaries"].hint, /not applicable/i);
});

test("inherited source is visible but never presented as authored or approved", () => {
  const { p, characterId } = fixture();
  const before = structuredClone(p);
  const identity = characterFieldView(p, characterId, BIBLE_FIELDS.character[0]);
  assert.equal(identity.disposition, "source");
  assert.match(identity.value, /Bread seller/);
  assert.match(identity.value, /Witness/);
  assert.match(identity.value, /Stall keeper/);
  assert.match(identity.source, /Canonical asset/);
  assert.equal(identity.revision, 0);
  assert.match(characterFieldView(p, characterId, BIBLE_FIELDS.character[1]).value, /flour/);
  assert.match(characterFieldView(p, characterId, BIBLE_FIELDS.character[2]).value, /linen apron/);
  assert.match(
    characterFieldView(p, characterId, BIBLE_FIELDS.character[16]).value,
    /modern watch/,
  );
  assert.match(
    characterFieldView(p, characterId, BIBLE_FIELDS.character[16]).value,
    /plastic packaging/,
  );
  assert.equal(characterFieldView(p, characterId, "Need").disposition, "missing");
  assert.deepEqual(p, before, "Viewing sources must not author fields or alter approvals");

  const legacy = structuredClone(p);
  delete legacy.production;
  const legacyIdentity = characterFieldView(legacy, characterId, BIBLE_FIELDS.character[0]);
  assert.match(legacyIdentity.source, /Character record/);
  assert.equal(legacyIdentity.disposition, "source");
});

test("an explicit missing or authored field takes precedence over inherited source after reload", () => {
  const { p, characterId } = fixture();
  const field = BIBLE_FIELDS.character[1];
  const cleared = edit(p, characterId, field, "", {
    disposition: "missing",
    source: "Source is disputed",
  });
  const restored = JSON.parse(JSON.stringify(cleared)) as Picture;
  assert.deepEqual(characterFieldView(restored, characterId, field), {
    value: "",
    source: "Source is disputed",
    disposition: "missing",
    revision: 1,
  });
  const authored = edit(restored, characterId, field, "Keep the established reference face.");
  assert.equal(
    characterFieldView(authored, characterId, field).value,
    "Keep the established reference face.",
  );
  assert.equal(characterFieldView(authored, characterId, field).disposition, "authored");
  assert.match(
    p.production!.assets[0].canonicalSpec.visualDescription,
    /flour/,
    "A source field correction must not silently overwrite the canonical asset",
  );
});

test("authored values require a source and role-based N/A requires an explicit reason", () => {
  const { p, characterId } = fixture();
  const before = structuredClone(p);
  assert.throws(
    () => edit(p, characterId, "Need", "Become trusting", { source: "  " }),
    /source reference/i,
  );
  assert.throws(
    () => edit(p, characterId, "Need", "", { disposition: "not-applicable" }),
    /scoped reason/i,
  );
  assert.throws(
    () =>
      edit(p, characterId, "Need", "Witness role", {
        source: "",
        disposition: "not-applicable",
      }),
    /source reference/i,
  );
  assert.deepEqual(p, before, "Rejected edits must leave the record and history intact");
  const updated = edit(p, characterId, "Need", "Witness role has no authored transformation.", {
    source: "Script scene 1 · role boundary",
    disposition: "not-applicable",
  });
  const field = characterFieldView(updated, characterId, "Need");
  assert.equal(field.disposition, "not-applicable");
  assert.equal(field.value, "Witness role has no authored transformation.");
  assert.equal(field.source, "Script scene 1 · role boundary");
});

test("field-level conflict protection preserves unrelated concurrent edits, drafts and correction history", () => {
  const { p, characterId } = fixture();
  const first = edit(p, characterId, "Want", "Keep the stall open.");
  const pending: BibleFieldEdit = {
    recordId: characterId,
    kind: "character",
    field: "Want",
    value: "Protect the family's next meal.",
    source: "User direction after source review",
    disposition: "authored",
    baseRevision: 1,
  };
  const concurrent = edit(
    first,
    characterId,
    "Knowledge boundaries",
    "Does not know the stranger's family.",
  );
  const committed = applyCharacterFieldEdit(concurrent, pending);
  assert.equal(
    committed.movieBible!.records[characterId].fields["Knowledge boundaries"].value,
    "Does not know the stranger's family.",
  );
  assert.deepEqual(committed.editorDrafts, p.editorDrafts);
  assert.deepEqual(committed.production, p.production);
  assert.deepEqual(committed.performance, p.performance);
  assert.deepEqual(committed.characters, p.characters);
  assert.deepEqual(committed.screenplay, p.screenplay);
  assert.equal(committed.movieBible!.corrections.length, 3);
  assert.equal(new Set(committed.movieBible!.corrections.map((c) => c.id)).size, 3);
  assert.deepEqual(
    committed.movieBible!.corrections.slice(0, 2),
    concurrent.movieBible!.corrections,
  );
  const correction = committed.movieBible!.corrections.at(-1)!;
  assert.equal(correction.before?.value, "Keep the stall open.");
  assert.equal(correction.after.value, pending.value);
  assert.equal(correction.after.source, pending.source);
  assert.equal(correction.after.revision, 2);
  const beforeStaleAttempt = structuredClone(committed);
  assert.throws(
    () => applyCharacterFieldEdit(committed, pending),
    /field changed while you were editing/i,
  );
  assert.deepEqual(committed, beforeStaleAttempt);
  assert.equal(
    pending.value,
    "Protect the family's next meal.",
    "Conflict must not erase the pending draft",
  );
});

test("character goals, knowledge and dirty participant state reach authoring and stale only their linked take", () => {
  const fixtureData = fixture();
  let p = fixtureData.p;
  const { characterId, participantId } = fixtureData;
  p.video = emptyVideoWorkspace();
  for (const shot of p.shots) {
    p.video = recordImportedVideoTake(p.video, {
      pictureId: p.id,
      shotId: shot.id,
      filename: "controlled-fixture.mp4",
      mediaUri: `fixture-only/${shot.id}.mp4`,
      mediaSha256: "a".repeat(64),
      byteLength: 2048,
      durationSec: 5,
      now: 1,
    });
    p.video = reviewVideoTake(
      p.video,
      p.video.takes.at(-1)!.id,
      "canonical",
      "Synthetic fixture approval; no real footage reviewed.",
      2,
      resolveShotPacket(p, shot).fingerprint,
    );
  }
  const [affected, unrelated] = p.video.takes;
  const mediaBefore = structuredClone(p.video);
  assert.equal(shotPacketFreshness(p, p.shots[0], affected.jobId, affected.id).status, "current");
  const changes = [
    {
      recordId: characterId,
      kind: "character" as const,
      field: "Want",
      value: "Save one loaf for the children.",
    },
    {
      recordId: characterId,
      kind: "character" as const,
      field: "Knowledge boundaries",
      value: "Knows the price, not the stranger's name.",
    },
    {
      recordId: participantId,
      kind: "participant" as const,
      field: "Incoming physical state",
      value: "Apron remains dirty; left wrist remains sore.",
    },
    {
      recordId: participantId,
      kind: "participant" as const,
      field: "Outgoing physical state",
      value: "Dirty apron and sore left wrist persist after the refusal.",
    },
  ];
  for (const change of changes) {
    const previousFingerprint = resolveShotPacket(p, p.shots[0]).fingerprint;
    p = edit(p, change.recordId, change.field, change.value, { kind: change.kind });
    const context = bibleAuthoringContext(p, "scene-market");
    assert.equal(
      context.bible.find((r) => r.recordId === change.recordId)?.fields[change.field].value,
      change.value,
    );
    const packet = resolveShotPacket(p, p.shots[0]);
    assert.equal(
      packet.sourceFields.find((r) => r.recordId === change.recordId)?.fields[change.field].value,
      change.value,
    );
    assert.notEqual(packet.fingerprint, previousFingerprint);
    assert.equal(shotPacketFreshness(p, p.shots[0], affected.jobId, affected.id).status, "stale");
    assert.equal(
      shotPacketFreshness(p, p.shots[1], unrelated.jobId, unrelated.id).status,
      "current",
    );
  }
  p = edit(p, participantId, "Outgoing emotional state", "Calmer after choosing not to argue.", {
    kind: "participant",
  });
  assert.match(
    p.movieBible!.records[participantId].fields["Outgoing physical state"].value,
    /Dirty apron and sore left wrist persist/,
  );
  assert.deepEqual(
    p.video,
    mediaBefore,
    "Authoring corrections must never rewrite or regenerate completed takes",
  );
  const reloaded = JSON.parse(JSON.stringify(p)) as Picture;
  assert.deepEqual(
    resolveShotPacket(reloaded, reloaded.shots[0]),
    resolveShotPacket(p, p.shots[0]),
  );
  assert.equal(
    shotPacketFreshness(reloaded, reloaded.shots[0], affected.jobId, affected.id).status,
    "stale",
  );
  assert.equal(
    shotPacketFreshness(reloaded, reloaded.shots[1], unrelated.jobId, unrelated.id).status,
    "current",
  );
});
