import assert from "node:assert/strict";
import test from "node:test";
import { migratePicturePreparation, type LegacyPicture } from "./picture-preparation.ts";

function lastReel(): LegacyPicture {
  return {
    id: "pic_last_reel",
    title: "The Last Reel",
    logline: "An archive answers back.",
    genre: "Quiet supernatural drama",
    tone: "Restrained",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 2,
    createdAt: 1,
    updatedAt: 2,
    stage: "timeline",
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "index-tts", music: "minimax-music3" },
    screenplayFountain: "INT. ARCHIVE — NIGHT\n\nThe reel turns.",
    acts: [],
    scenes: [],
    characters: [],
    locations: [],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [{ id: "shot", sceneId: "scene", index: 1, type: "wide", description: "Archive", durationSec: 5, camera: "wide", lens: "35mm", cameraMove: "static", emotion: "dread", expression: "still", t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "", stillUrl: "file:///plate.png" }],
    cues: [],
    voices: [],
    directorNotes: "Hold faces.",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    sample: true,
  };
}

test("The Last Reel migrates without changing legacy production assets or last stage", () => {
  const legacy = lastReel();
  const prepared = migratePicturePreparation(legacy, 10);
  assert.equal(prepared.title, "The Last Reel");
  assert.equal(prepared.stage, "timeline");
  assert.equal(prepared.lastOpenedStage, "timeline");
  assert.equal(prepared.shots.length, legacy.shots.length);
  assert.equal(prepared.screenplay.status, "APPROVED");
  assert.equal(prepared.screenplay.workingFountain, legacy.screenplayFountain);
});

test("migration is idempotent and preserves new preparation records", () => {
  const first = migratePicturePreparation(lastReel(), 10);
  const second = migratePicturePreparation(first, 20);
  assert.deepEqual(second.intake, first.intake);
  assert.deepEqual(second.screenplay, first.screenplay);
});

test("migration maps Brief and rejects malformed persisted stages", () => {
  const brief = migratePicturePreparation({ ...lastReel(), stage: "brief" as never }, 10);
  assert.equal(brief.stage, "intake");
  assert.equal(brief.lastOpenedStage, "intake");

  const malformed = migratePicturePreparation({ ...lastReel(), stage: "corrupt" as never, lastOpenedStage: "missing" as never }, 10);
  assert.equal(malformed.stage, "intake");
  assert.equal(malformed.lastOpenedStage, "intake");
});
