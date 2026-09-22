import test from "node:test";
import assert from "node:assert/strict";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import { DEFAULT_ENGINES, type Picture } from "./types.ts";
import { defaultProductionRouting } from "./production-profiles.ts";
import {
  assembledBibleScreenplay,
  bibleRunPrompt,
  bibleSourceHash,
  completeBibleUnit,
  dispatchBibleUnit,
  nextBibleUnit,
  repairIncompleteAutonomousUnit,
  reviewBibleUnit,
  startBibleRun,
  validateBibleCandidate,
} from "./bible-run.ts";
import {
  bibleAuthoringContext,
  editBibleField,
  movieBibleIndex,
  resolveBibleRecord,
} from "./movie-bible.ts";
import { seedVisualDevelopmentFromPicture } from "../visual-development.ts";
import { seedCinematographyFromPicture } from "../cinematography.ts";
import { resolveRenderContext, saveRenderClause } from "./render-context.ts";
import { applyBibleScreenplay, applyBiblePlanning } from "./bible-application.ts";
import {
  screenSide,
  continuityIssues,
  saveShotContinuity,
  type ShotContinuity,
} from "./shot-continuity.ts";
import { dialogueBudget } from "./creative-preset.ts";
import { resolveShotPacket, shotPacketFreshness } from "./resolved-shot-packet.ts";
import { emptyVideoWorkspace } from "../production/video-types.ts";
import { recordImportedVideoTake, reviewVideoTake } from "../production/video-iterations.ts";
import { importedCanonicalFilm } from "./timeline-plan.ts";
import { acceptSpecialistCandidate, type SpecialistJob } from "./specialist-audio.ts";
import { emptyAudioWorkspace } from "../production/audio-types.ts";
import { reviewAudioTake } from "../production/audio-iterations.ts";
import { recordSpeechReview, measuredSpeechAudit } from "./speech-review.ts";
import { movieAssemblyPlan, reviewMovieDelivery } from "./movie-assembly.ts";
import { approveEditorialClips } from "./editorial-clips.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  return {
    id: "pic",
    title: "A film",
    logline: "",
    genre: "",
    tone: "",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 2,
    createdAt: 1,
    updatedAt: 1,
    stage: "intake",
    lastOpenedStage: "intake",
    thumbnailUrl: null,
    intake,
    screenplay: makePictureScreenplay("single", null, 1),
    selectedEngine: DEFAULT_ENGINES,
    screenplayFountain: "",
    acts: [],
    scenes: [],
    characters: [],
    locations: [],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [],
    cues: [],
    voices: [],
    directorNotes: "",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    productionRouting: defaultProductionRouting(1),
  };
}
const structure = JSON.stringify({
  sourceNote: "User fiction",
  scenes: [
    { title: "INT. ROOM - DAY", purpose: "Recognition" },
    { title: "EXT. ROAD - NIGHT", purpose: "Departure" },
  ],
});
function scene(text: string) {
  return JSON.stringify({
    fountain: text,
    visualDevelopment: "Door opens",
    soundDevelopment: "Quiet hinge",
    musicDevelopment: "Motivated silence",
    incomingState: "Injured and afraid",
    outgoingState: "Injured and resolved",
  });
}
const packet = JSON.stringify({
  shots: [
    {
      name: "Hold",
      camera: "Static wide",
      durationSeconds: 8,
      performance: "The listener waits",
      videoPrompt: "Wide shot; listener waits in silence",
      references: [],
      incomingState: "Standing",
      outgoingState: "Still standing",
    },
  ],
  assets: [],
  cues: [
    {
      kind: "silence",
      description: "Intentional silence during recognition",
      startSeconds: 0,
      durationSeconds: 8,
      source: "scene",
    },
  ],
});
test("guided completion and acceptance cannot dispatch successors", () => {
  const p = picture();
  let r = startBibleRun(p);
  r = dispatchBibleUnit(r, bibleSourceHash(p));
  r = completeBibleUnit(r, r.units[0].id, structure, "test", r.sourceHash);
  assert.equal(r.status, "review");
  assert.equal(r.requests, 1);
  assert.throws(() => dispatchBibleUnit(r, r.sourceHash), /Review/);
  r = reviewBibleUnit(r, r.units[0].id, "accept");
  assert.equal(r.status, "paused");
  assert.equal(r.requests, 1);
  assert.equal(r.units[1].status, "queued");
});
test("autonomous queue covers each scene and never produces a human approval", () => {
  const p = picture();
  p.productionRouting!.executionMode = "autonomous-complete-script";
  let r = startBibleRun(p);
  while (r.status !== "complete") {
    r = dispatchBibleUnit(r, r.sourceHash);
    const u = nextBibleUnit(r)!;
    const output =
      u.phase === "P1"
        ? structure
        : u.phase === "P2"
          ? scene(`${r.scenes.find((s) => s.id === u.sceneId)!.title}\n\nShe chooses to leave.`)
          : u.phase === "P5"
            ? packet
            : JSON.stringify({
                continuityReview: "Two scenes checked; actual media not reviewed",
                findings: [],
              });
    r = completeBibleUnit(r, u.id, output, "fixture", r.sourceHash);
  }
  assert.equal(r.units.length, 6);
  assert.ok(r.units.every((u) => u.status === "checkpoint"));
  assert.match(assembledBibleScreenplay(r), /EXT. ROAD/);
  assert.equal(p.screenplay.approvedVersionId, null);
});
test("cancel and changed snapshot discard late completion", () => {
  let r = startBibleRun(picture());
  r = dispatchBibleUnit(r, r.sourceHash);
  assert.equal(
    completeBibleUnit({ ...r, status: "canceled" }, r.units[0].id, structure, "test", r.sourceHash)
      .status,
    "canceled",
  );
  assert.deepEqual(completeBibleUnit(r, r.units[0].id, structure, "test", "changed"), r);
});
test("pause records in-flight draft without granting continuation", () => {
  const p = picture();
  p.productionRouting!.executionMode = "autonomous-complete-script";
  let r = startBibleRun(p);
  r = dispatchBibleUnit(r, r.sourceHash);
  r = completeBibleUnit({ ...r, status: "paused" }, r.units[0].id, structure, "test", r.sourceHash);
  assert.equal(r.status, "paused");
  assert.equal(r.units[0].status, "checkpoint");
});
test("request bounds and source hash prevent unauthorized dispatch", () => {
  const p = picture();
  const r = startBibleRun(p, { maxRequests: 1 });
  assert.throws(() => dispatchBibleUnit({ ...r, requests: 1 }, r.sourceHash), /budget/);
  assert.throws(() => dispatchBibleUnit(r, "stale"), /Source/);
  assert.equal(bibleSourceHash({ ...p, updatedAt: 55 }), bibleSourceHash(p));
});
test("malformed drafts retained and automatic repair bounded to two", () => {
  const p = picture();
  p.productionRouting!.executionMode = "autonomous-complete-script";
  let r = startBibleRun(p);
  for (let i = 0; i < 3; i++) {
    r = dispatchBibleUnit(r, r.sourceHash);
    r = repairIncompleteAutonomousUnit(
      completeBibleUnit(r, r.units[0].id, "bad JSON", "test", r.sourceHash),
    );
  }
  assert.equal(r.status, "failed");
  assert.equal(r.units[0].candidates.length, 3);
  assert.equal(r.units[0].revisions, 2);
});
test("P5 refuses empty shots, malformed cues, placeholders", () => {
  assert.ok(validateBibleCandidate("P5", '{"shots":[],"assets":[],"cues":[]}').length);
  assert.deepEqual(validateBibleCandidate("P5", packet), []);
  assert.ok(validateBibleCandidate("P2", scene("TODO")).length);
});
test("Bible edits preserve IDs, source history and affect authoring packet", () => {
  let p = picture();
  const old = JSON.stringify(p.screenplay);
  p = {
    ...p,
    movieBible: editBibleField(
      p,
      p.id,
      "picture",
      "Moral question",
      "Can loyalty survive truth?",
      "User",
    ),
  };
  assert.equal(movieBibleIndex(p)[0].id, "pic");
  assert.equal(p.movieBible!.corrections.length, 1);
  assert.match(JSON.stringify(bibleAuthoringContext(p)), /loyalty/);
  assert.equal(JSON.stringify(p.screenplay), old);
  assert.match(bibleRunPrompt(startBibleRun(p), startBibleRun(p).units[0]).prompt, /loyalty/);
  assert.throws(
    () => editBibleField(p, p.id, "picture", "Moral question", "", "User", "not-applicable"),
    /reason/,
  );
});
test("persisted snapshots and configured Astra bindings survive serialization", () => {
  const p = picture();
  const r = startBibleRun(p);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  p.intake.concept = "Changed";
  assert.notEqual(bibleSourceHash(p), r.sourceHash);
});

test("field resolution replaces inherited values and withholds lower-authority proposals", () => {
  let p = picture();
  p.scenes = [
    { id: "s1", act: 1, slugline: "INT. ROOM", summary: "", emotionalBeat: "", durationSec: 10 },
    { id: "s2", act: 1, slugline: "EXT. ROAD", summary: "", emotionalBeat: "", durationSec: 10 },
  ];
  p.renderContext = saveRenderClause(p, {
    field: "lighting",
    value: "daylight",
    scope: "film",
    scopeId: p.id,
    sourceId: "user",
    sourceRevision: "1",
    authority: "user",
  });
  p.renderContext = saveRenderClause(p, {
    field: "lighting",
    value: "candlelight",
    scope: "scene",
    scopeId: "s1",
    sourceId: "user",
    sourceRevision: "2",
    authority: "user",
  });
  assert.equal(
    resolveRenderContext(p, { id: "shot", sceneId: "s1" }).local,
    "lighting: candlelight",
  );
  assert.equal(resolveRenderContext(p, { id: "shot", sceneId: "s1" }).global, "");
  assert.equal(resolveRenderContext(p, { id: "shot", sceneId: "s2" }).global, "lighting: daylight");
  p.renderContext = saveRenderClause(p, {
    field: "lighting",
    value: "neon",
    scope: "scene",
    scopeId: "s2",
    sourceId: "model",
    sourceRevision: "1",
    authority: "proposal",
  });
  assert.equal(resolveRenderContext(p, { id: "shot", sceneId: "s2" }).global, "lighting: daylight");
  assert.equal(resolveRenderContext(p, { id: "shot", sceneId: "s2" }).withheld.length, 1);
});
test("same-scope proposal cannot erase an authoritative render value", () => {
  const p = picture();
  const base = {
    field: "palette" as const,
    scope: "film" as const,
    scopeId: p.id,
    sourceId: "user",
    sourceRevision: "1",
  };
  p.renderContext = saveRenderClause(p, { ...base, value: "silver", authority: "user" });
  p.renderContext = saveRenderClause(p, { ...base, value: "neon", authority: "proposal" });
  assert.equal(resolveRenderContext(p, { id: "", sceneId: "" }).global, "palette: silver");
  assert.equal(p.renderContext.clauses.length, 2);
});

test("approved render authority must resolve to the current approved source revision", () => {
  const p = picture();
  const input = {
    field: "palette" as const,
    value: "silver",
    scope: "film" as const,
    scopeId: p.id,
    sourceId: "missing-source",
    sourceRevision: "1",
    authority: "approved-source" as const,
  };
  assert.throws(() => saveRenderClause(p, input), /not approved/);
  p.screenplay.versions = [
    {
      id: "script-source",
      label: "Approved fixture",
      kind: "draft",
      fountain: "INT. ROOM - NIGHT\nA witness waits.",
      createdAt: 1,
      model: null,
      workflow: p.screenplay.workflow,
      pass: null,
      sourceVersionId: null,
      settings: null,
    },
  ];
  p.screenplay.approvedVersionId = "script-source";
  const row = movieBibleIndex(p).find((r) => r.id === "script-source")!;
  p.renderContext = saveRenderClause(p, {
    ...input,
    sourceId: row.id,
    sourceRevision: row.revision,
  });
  assert.equal(resolveRenderContext(p, { id: "shot", sceneId: "scene" }).global, "palette: silver");
  p.screenplay.approvedVersionId = null;
  const blocked = resolveRenderContext(p, { id: "shot", sceneId: "scene" });
  assert.equal(blocked.global, "");
  assert.match(blocked.issues.join("\n"), /not approved/);
});
test("complete package application is idempotent and cannot forge screenplay approval", () => {
  const p = picture();
  let r = startBibleRun(p);
  r = { ...r, status: "complete", scenes: [], units: [] };
  const applied = applyBibleScreenplay(p, r);
  assert.equal(applied.screenplay.approvedVersionId, null);
  assert.equal(applyBibleScreenplay(applied, r), applied);
  assert.throws(() => applyBiblePlanning(applied, r), /Approve this exact/);
});
test("camera reverse changes screen direction without mutating world positions", () => {
  const person = { x: 1, y: 0, z: 0 };
  assert.equal(screenSide({ x: 0, y: 1, z: 5 }, { x: 0, y: 1, z: 0 }, person), "right");
  assert.equal(screenSide({ x: 0, y: 1, z: -5 }, { x: 0, y: 1, z: 0 }, person), "left");
  assert.equal(person.x, 1);
});
test("approved Bible planning reaches canonical shot preparation without granting render approval", () => {
  const p = picture();
  p.characters = [
    { id: "witness", name: "Witness", role: "lead", age: "", look: "", arc: "", voiceId: "" },
  ];
  const boundPacket = JSON.parse(packet);
  boundPacket.shots[0].references = [{ role: "characterReference", sourceId: "witness" }];
  p.productionRouting!.executionMode = "autonomous-complete-script";
  let run = startBibleRun(p);
  while (run.status !== "complete") {
    run = dispatchBibleUnit(run, run.sourceHash);
    const u = nextBibleUnit(run)!;
    run = completeBibleUnit(
      run,
      u.id,
      u.phase === "P1"
        ? structure
        : u.phase === "P2"
          ? scene(`${run.scenes.find((s) => s.id === u.sceneId)!.title}\n\nShe waits.`)
          : u.phase === "P5"
            ? JSON.stringify(boundPacket)
            : JSON.stringify({ continuityReview: "Fixture only", findings: [] }),
      "fixture",
      run.sourceHash,
    );
  }
  const draft = applyBibleScreenplay(p, run);
  draft.screenplay.approvedVersionId = `spv:${run.id}`;
  draft.scenes = run.scenes.map((s, i) => ({
    id: s.id,
    act: 1,
    index: i + 1,
    slugline: s.title,
    summary: s.purpose,
    emotionalBeat: "",
    durationSec: 8,
  }));
  const applied = applyBiblePlanning(draft, run);
  assert.equal(applied.performance?.shots.length, 2);
  assert.equal(applied.performance?.shots[0].shotId, applied.shots[0].id);
  assert.equal(applied.performance?.shots[0].durationSec, 8);
  assert.equal(applied.performance?.shots[0].status, "DRAFT");
  assert.deepEqual(applied.performance?.shots[0].subject.actions, ["The listener waits"]);
  assert.deepEqual(applied.performance?.shots[0].references.characterReference, ["witness"]);
  assert.deepEqual(applied.performance?.shots[0].subject.characters, ["witness"]);
  assert.equal(
    applied.movieBible?.records[applied.scenes[0].id]?.fields["Musical development"].value,
    "Motivated silence",
  );
  const bad = structuredClone(run);
  const badUnit = bad.units.find((u) => u.phase === "P5")!;
  const badPacket = JSON.parse(badUnit.candidates.at(-1)!.text);
  badPacket.shots[0].references = [{ role: "characterReference", sourceId: "invented" }];
  badUnit.candidates.at(-1)!.text = JSON.stringify(badPacket);
  assert.throws(() => applyBiblePlanning(draft, bad), /does not resolve/);
  assert.equal(applyBiblePlanning(applied, run), applied);
});
test("continuity preserves physical state and catches replay, travel and conflicting source image", () => {
  const p = picture();
  p.characters = [{ id: "c", name: "Witness", role: "", age: "", look: "", arc: "", voiceId: "" }];
  const base: ShotContinuity = {
    id: "state",
    shotId: "s1",
    revision: 1,
    predecessorId: null,
    source: "user",
    cameraPosition: { x: 0, y: 1, z: 5 },
    cameraTarget: { x: 0, y: 1, z: 0 },
    participants: [
      {
        characterId: "c",
        incoming: "injured",
        outgoing: "injured",
        knowledge: "door is locked",
        objective: "wait",
        permittedSound: "none",
        position: { x: 0, y: 0, z: 0 },
        endPosition: { x: 0, y: 0, z: 0 },
        maxSpeed: 1,
        support: "left hand on rail",
        contact: "none",
      },
    ],
    completedEvents: ["door opened"],
    newEvents: [],
    restartReason: "",
    imageDisposition: "uninspected",
    imageHash: "",
    inspectionReason: "",
  };
  p.shotContinuity = { s1: base };
  const next = {
    ...base,
    shotId: "s2",
    predecessorId: "s1",
    newEvents: ["door opened"],
    imageDisposition: "conflict" as const,
    participants: base.participants.map((c) => ({
      ...c,
      incoming: "healed",
      endPosition: { x: 100, y: 0, z: 0 },
    })),
  };
  const issues = continuityIssues(
    p,
    { id: "s2", durationSec: 5 } as Picture["shots"][number],
    next,
  ).join("\n");
  assert.match(issues, /travel/);
  assert.match(issues, /incoming state differs/);
  assert.match(issues, /replayed/);
  assert.match(issues, /Starting image conflicts/);
  const shot = { id: "s1", durationSec: 5, stillUrl: "/canonical.png" } as Picture["shots"][number];
  p.shots = [shot];
  const receipt = {
    id: "inspection:first",
    referenceId: "still:s1",
    mediaUri: "/canonical.png",
    sha256: "a".repeat(64),
    reviewedAt: 1,
    reason: "Observed support and geography",
  };
  const inspected: ShotContinuity = {
    ...base,
    imageDisposition: "consistent",
    imageHash: receipt.sha256,
    inspectionReason: receipt.reason,
    imageInspection: receipt,
  };
  assert.deepEqual(continuityIssues(p, shot, inspected), []);
  p.shotContinuity = saveShotContinuity(p, inspected);
  p.shots = [{ ...shot, stillUrl: "/replacement.png" }];
  assert.match(
    continuityIssues(p, p.shots[0], inspected).join("\n"),
    /Inspected image has changed/,
  );
  p.shotContinuity = saveShotContinuity(p, {
    ...inspected,
    imageInspection: {
      ...receipt,
      id: "inspection:second",
      mediaUri: "/replacement.png",
      reviewedAt: 2,
    },
  });
  assert.deepEqual(
    p.shotContinuity.s1.imageInspectionHistory?.map((item) => item.id),
    ["inspection:first", "inspection:second"],
  );
});
test("Harrowing preset is explicitly scoped and dialogue limits are measured", () => {
  const p = picture();
  assert.equal(bibleAuthoringContext(p).creativePreset, null);
  p.creativePreset = "harrowing-v3";
  assert.equal(bibleAuthoringContext(p).creativePreset?.id, "harrowing-v3");
  assert.equal(dialogueBudget(3, 100).withinTarget, false);
  assert.equal(dialogueBudget(3, 100).withinCeiling, true);
  assert.equal(dialogueBudget(6, 100).withinCeiling, false);
});

test("source-bound video review is scoped, append-only and required again after correction", () => {
  const p = picture();
  p.shots = ["a", "b"].map(
    (id) =>
      ({
        id,
        sceneId: `scene-${id}`,
        durationSec: 5,
        description: id,
        camera: "wide",
        lens: "35mm",
        cameraMove: "hold",
      }) as Picture["shots"][number],
  );
  p.video = emptyVideoWorkspace();
  for (const shot of p.shots) {
    p.video = recordImportedVideoTake(p.video, {
      pictureId: p.id,
      shotId: shot.id,
      filename: "fixture.mp4",
      mediaUri: `fixture/${shot.id}.mp4`,
      mediaSha256: "a".repeat(64),
      byteLength: 2048,
      durationSec: 5,
      now: 1,
    });
    p.video = reviewVideoTake(
      p.video,
      p.video.takes.at(-1)!.id,
      "canonical",
      "Controlled test review, not real footage.",
      2,
      resolveShotPacket(p, shot).fingerprint,
    );
  }
  const before = structuredClone(p.video);
  const first = p.video.takes[0];
  p.creativePreset = "harrowing-v3";
  assert.equal(measuredSpeechAudit(p).blocksDelivery, true);
  p.video = recordSpeechReview(
    p.video,
    first.id,
    [
      { startSec: 0, endSec: 0.3 },
      { startSec: 0.2, endSec: 0.4 },
    ],
    "Controlled fixture, overlapping speech",
  );
  p.video = recordSpeechReview(
    p.video,
    p.video.takes[1].id,
    [],
    "Controlled fixture, confirmed silence",
  );
  assert.equal(measuredSpeechAudit(p).spokenSeconds, 0.4);
  assert.equal(measuredSpeechAudit(p).blocksDelivery, false);
  p.video = recordSpeechReview(
    p.video,
    first.id,
    [{ startSec: 0, endSec: 0.6 }],
    "Controlled fixture, over ceiling",
  );
  assert.equal(measuredSpeechAudit(p).blocksDelivery, true);
  assert.throws(
    () => recordSpeechReview(p.video!, first.id, [{ startSec: 4, endSec: 6 }], "Out of bounds"),
    /intervals/,
  );
  p.video = before;
  delete p.creativePreset;
  const assembly = movieAssemblyPlan(p);
  assert.equal(assembly.ok, true);
  assert.equal(assembly.durationSec, 10);
  const multi = structuredClone(p);
  const original = multi.video!.takes[0];
  original.canonical = false;
  original.status = "NEEDS_REVIEW";
  original.probe!.durationSec = 2;
  const secondClip = { ...structuredClone(original), id: "second-editorial-clip", probe: { ...original.probe!, durationSec: 3 } };
  multi.video!.takes.push(secondClip);
  assert.throws(() => approveEditorialClips(multi, multi.shots[0].id, [original.id], "Observed fixture"), /total/);
  const selected = approveEditorialClips(multi, multi.shots[0].id, [original.id, secondClip.id], "Controlled two-clip edit fixture");
  const multiPlan = movieAssemblyPlan(selected);
  assert.equal(multiPlan.ok, true);
  assert.equal(multiPlan.clips.length, 3);
  assert.equal(multiPlan.durationSec, 10);
  assert.deepEqual(multiPlan.clips.slice(0, 2).map(clip => clip.startSec), [0, 2]);
  assert.equal(selected.video!.takes[0].canonical, false, "Editorial approval must not overwrite single-take canonical selection");
  selected.video!.takes[0].status = "REJECTED";
  assert.equal(movieAssemblyPlan(selected).ok, false);
  p.movieAssemblies = [
    {
      ok: true,
      id: "assembly-fixture",
      createdAt: 1,
      outputPath: "fixture-only",
      manifestPath: "fixture-only",
      sha256: "b".repeat(64),
      durationSec: 10,
      plan: assembly,
    },
  ];
  const reviewedDelivery = reviewMovieDelivery(
    p,
    "assembly-fixture",
    "approve",
    "Controlled fixture only",
  );
  assert.equal(reviewedDelivery.movieAssemblies?.[0].reviews?.[0].decision, "approve");
  assert.equal(importedCanonicalFilm(p).clips.length, 2);
  p.movieBible = editBibleField(
    p,
    "a",
    "shot",
    "Coverage purpose",
    "Observe the handoff",
    "User correction",
  );
  assert.equal(shotPacketFreshness(p, p.shots[0], first.jobId, first.id).status, "stale");
  assert.equal(movieAssemblyPlan(p).ok, false);
  assert.throws(
    () => reviewMovieDelivery(p, "assembly-fixture", "approve", "Stale fixture"),
    /differ from this delivery/,
  );
  assert.equal(
    shotPacketFreshness(p, p.shots[1], p.video.takes[1].jobId, p.video.takes[1].id).status,
    "current",
  );
  assert.deepEqual(
    p.video,
    before,
    "Source corrections must not erase completed media or review history",
  );
  assert.equal(importedCanonicalFilm(p).clips.length, 1);
  p.video = reviewVideoTake(
    p.video,
    first.id,
    "canonical",
    "Rechecked against corrected source in fixture.",
    3,
    resolveShotPacket(p, p.shots[0]).fingerprint,
  );
  assert.equal(p.video.takes[0].sourceReviews?.length, 2);
  assert.equal(importedCanonicalFilm(p).clips.length, 2);
  const saved = JSON.parse(JSON.stringify(p)) as Picture;
  assert.equal(shotPacketFreshness(saved, saved.shots[0], first.jobId, first.id).status, "current");
});

test("registry resolves existing visual and camera records without allocating competing identities", () => {
  const p = picture();
  p.characters = [
    {
      id: "witness",
      name: "Witness",
      role: "Observer",
      age: "",
      look: "Established",
      arc: "",
      voiceId: "",
    },
  ];
  p.visualDevelopment = seedVisualDevelopmentFromPicture(p, 1);
  p.cinematography = seedCinematographyFromPicture(p, 1);
  const original = JSON.stringify(p);
  const sheet = p.visualDevelopment.characterBibles[0];
  const indexed = movieBibleIndex(p);
  assert.equal(indexed.find((r) => r.id === sheet.id)?.kind, "bible");
  assert.equal(resolveBibleRecord(p, sheet.id), sheet);
  assert.ok(indexed.some((r) => r.id === p.cinematography!.manifestoVersions[0].id));
  assert.equal(JSON.stringify(p), original);
  assert.deepEqual(movieBibleIndex(JSON.parse(original)), indexed);
});

test("specialist candidates preserve exact engine provenance and require separate current-cue review", () => {
  const audio = emptyAudioWorkspace();
  audio.cues = [
    {
      id: "cue",
      name: "Quiet strings",
      kind: "score",
      startSec: 0,
      durationSec: 6,
      sceneId: null,
      shotId: null,
      notes: "Wordless, no intelligible lyrics",
      instrumentation: "Strings",
    },
  ];
  const job: SpecialistJob = {
    id: "job",
    pictureId: "pic",
    cueId: "cue",
    cueSnapshot: JSON.stringify(audio.cues[0]),
    status: "completed",
    createdAt: 1,
    error: null,
    request: { engineId: "ace-step-1.5-xl-sft", duration: 6, seed: 1, prompt: "Fixture" },
    output: {
      engineId: "ace-step-1.5-xl-sft",
      mediaUri: "fixture.wav",
      mediaSha256: "b".repeat(64),
      byteLength: 4096,
      provenance: { fixture: true },
      probe: {
        ok: true,
        durationSec: 6,
        sampleRate: 48000,
        channels: 2,
        codec: "pcm_s24le",
        container: "wav",
        byteLength: 4096,
        error: null,
      },
    },
  };
  const result = acceptSpecialistCandidate(audio, "pic", job);
  assert.equal(result.takes[0].origin, "native-generated");
  assert.equal(result.takes[0].engineId, "ace-step-1.5-xl-sft");
  assert.equal(result.takes[0].canonical, false);
  assert.equal(acceptSpecialistCandidate(result, "pic", job), result);
  assert.equal(
    reviewAudioTake(result, result.takes[0].id, "canonical", "Fixture review").takes[0].canonical,
    true,
  );
  result.cues = result.cues.map((c) => ({ ...c, notes: "Changed cue" }));
  assert.throws(() => acceptSpecialistCandidate(result, "pic", job), /Cue changed/);
  assert.throws(
    () => reviewAudioTake(result, result.takes[0].id, "canonical", "Stale"),
    /Cue changed/,
  );
});

test("resolved packets retain exact scoped source values after later canonical edits", () => {
  const p = picture();
  p.characters = [
    {
      id: "witness",
      name: "Witness",
      role: "observer",
      age: "",
      look: "grey linen",
      arc: "",
      voiceId: "",
    },
    { id: "absent", name: "Absent", role: "other scene", age: "", look: "", arc: "", voiceId: "" },
  ];
  const shot = {
    id: "shot",
    sceneId: "scene",
    durationSec: 5,
    description: "Witness waits",
    i2vPrompt: "Witness turns",
    t2voicePrompt: "",
    camera: "wide",
    cameraMove: "hold",
    lens: "35mm",
  } as Picture["shots"][number];
  p.shots = [shot];
  const before = resolveShotPacket(p, shot);
  assert.deepEqual(
    before.sourceRecords.characters.map((c) => c.id),
    ["witness"],
  );
  p.characters[1].look = "unrelated revision";
  assert.equal(resolveShotPacket(p, shot).fingerprint, before.fingerprint);
  p.characters[0].look = "muddy grey linen";
  assert.notEqual(resolveShotPacket(p, shot).fingerprint, before.fingerprint);
  assert.equal(before.sourceRecords.characters[0].look, "grey linen");
});
