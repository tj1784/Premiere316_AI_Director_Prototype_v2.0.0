import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePictureIntake } from "../studio/picture-intake.ts";
import { makePictureScreenplay } from "../studio/screenplay.ts";
import type { Picture } from "../studio/types.ts";
import { emptyAudioWorkspace } from "./audio-types.ts";
import { failClosedAudioJob, hydratePictureAudio, queueMissingDialogue, queueMissingScore, recordImportedAudioTake, restoreAudioWorkspace, reviewAudioTake } from "./audio-iterations.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  return {
    id: "pic-1", title: "Reel", logline: "Night", genre: "Drama", tone: "Low-key", format: "16:9", fps: 24, runtimeMinutes: 8,
    createdAt: 1, updatedAt: 1, stage: "score", lastOpenedStage: "score", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [{ id: "scene-1", act: 1, slugline: "EXT. NIGHT", summary: "Rain", emotionalBeat: "quiet", durationSec: 8 }],
    characters: [{ id: "ch1", name: "Elias", role: "lead", age: "40", look: "grey", arc: "witness", voiceId: "ara" }],
    locations: [], props: [], wardrobe: [], vfx: [], shots: [{ id: "shot-1", sceneId: "scene-1", index: 1, type: "closeup", description: "Hatch", durationSec: 8, camera: "35mm", lens: "50mm", cameraMove: "static", emotion: "quiet", expression: "still", t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "" }],
    cues: [{ id: "cue-1", name: "Archive bed", startSec: 0, durationSec: 23, mood: "wet night", instruments: "low strings", minimaxPrompt: "low strings", sfx: "rain" }],
    voices: [{ id: "vo1", character: "Elias", text: "No leader. No slate.", voiceId: "ara" }],
    directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("Wave 6 audio architecture", () => {
  it("segments dialogue and fail-closes Qwen3-TTS without fabricating audio", () => {
    const workspace = queueMissingDialogue(picture(), 10);
    assert.ok(workspace.lines.length >= 1);
    assert.equal(workspace.takes[0].origin, "fail-closed");
    assert.equal(workspace.takes[0].mediaUri, null);
    assert.match(workspace.takes[0].failClosedReason ?? "", /Qwen3-TTS|fail-closed/i);
  });

  it("fail-closes Music3 score jobs", () => {
    const workspace = queueMissingScore(picture(), 20);
    assert.equal(workspace.takes.some((take) => take.kind === "score" && take.origin === "fail-closed"), true);
  });

  it("allows imported audio to become canonical and rejects fail-closed canonical", () => {
    let workspace = queueMissingDialogue(picture(), 10);
    assert.throws(() => reviewAudioTake(workspace, workspace.takes[0].id, "canonical", "no"), /imported durable media/);
    workspace = recordImportedAudioTake(emptyAudioWorkspace(), {
      pictureId: "pic-1", kind: "dialogue", filename: "elias.wav", mediaUri: "file://elias.wav",
      mediaSha256: "ab".repeat(32), byteLength: 48000, durationSec: 4, format: "wav", now: 30,
    });
    workspace = reviewAudioTake(workspace, workspace.takes[0].id, "canonical", "Imported line accepted.");
    assert.equal(workspace.takes[0].status, "CANONICAL");
    workspace = reviewAudioTake(workspace, workspace.takes[0].id, "reject", "Wrong take.");
    assert.equal(workspace.takes[0].status, "REJECTED");
  });

  it("restores running audio jobs without duplication", () => {
    const restored = restoreAudioWorkspace({
      schemaVersion: 1, lines: [], profiles: [], cues: [], takes: [],
      jobs: [{ id: "j1", pictureId: "p", lineId: null, cueId: null, kind: "dialogue", engineId: "qwen3-tts", status: "running", createdAt: 1, updatedAt: 1, takeIds: [], error: null }],
    });
    assert.equal(restored.jobs[0].status, "queued");
  });

  it("hydrates voice bible and cues from the picture", () => {
    const workspace = hydratePictureAudio(picture());
    assert.equal(workspace.profiles[0].characterName, "Elias");
    assert.equal(workspace.cues[0].name, "Archive bed");
  });
});
