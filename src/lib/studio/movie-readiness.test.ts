import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture } from "./types.ts";
import { movieLifecycle } from "./movie-lifecycle.ts";
import { movieReadiness, nextReadinessAction } from "./movie-readiness.ts";
import { planPictureExport } from "./ffmpeg-export.ts";
import { buildTimelinePlan } from "./timeline-plan.ts";
import { emptyVideoWorkspace } from "../production/video-types.ts";
import { recordImportedVideoTake, reviewVideoTake } from "../production/video-iterations.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  return {
    id: "pic-1", title: "Reel", logline: "Night", genre: "Drama", tone: "Low-key", format: "16:9", fps: 24, runtimeMinutes: 2,
    createdAt: 1, updatedAt: 1, stage: "export", lastOpenedStage: "export", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "Title: Reel", acts: [], scenes: [{ id: "scene-1", act: 1, slugline: "EXT. NIGHT", summary: "Rain", emotionalBeat: "quiet", durationSec: 8 }],
    characters: [{ id: "ch1", name: "Elias", role: "lead", age: "40", look: "grey", arc: "witness", voiceId: "ara" }],
    locations: [], props: [], wardrobe: [], vfx: [],
    shots: [{ id: "shot-1", sceneId: "scene-1", index: 1, type: "wide", description: "Pier", durationSec: 8, camera: "35mm", lens: "35mm", cameraMove: "static", emotion: "quiet", expression: "still", t2iPrompt: "rain", i2vPrompt: "", t2voicePrompt: "" }],
    cues: [{ id: "cue-1", name: "Bed", startSec: 0, durationSec: 8, mood: "night", instruments: "pad", minimaxPrompt: "pad", sfx: "rain" }],
    voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("Wave 7-8 readiness, import, export, lifecycle", () => {
  it("builds a clickable readiness list and lifecycle without claiming native video", () => {
    const items = movieReadiness(picture());
    assert.equal(items.length, 16);
    assert.equal(items.find((item) => item.id === "video")?.status, "blocked");
    assert.ok(nextReadinessAction(picture()));
    assert.equal(movieLifecycle(picture()).length, 14);
  });

  it("plans paper export when FFmpeg and canonical video are missing", () => {
    const plan = planPictureExport(picture(), null);
    assert.equal(plan.ok, false);
    assert.equal(plan.kind, "paper");
    assert.match(plan.reason, /FFmpeg/);
  });

  it("labels still-only export as placeholder montage, never native video", () => {
    const stills = picture();
    stills.shots[0].stillUrl = "file://still.png";
    const plan = planPictureExport(stills, "ffmpeg");
    assert.equal(plan.kind, "placeholder-montage");
    assert.match(plan.reason, /placeholder\/montage/);
  });

  it("imports probed video and allows canonical without calling it generated", () => {
    let workspace = recordImportedVideoTake(emptyVideoWorkspace(), {
      pictureId: "pic-1", shotId: "shot-1", filename: "pier.mp4", mediaUri: "file://pier.mp4",
      mediaSha256: "cd".repeat(32), byteLength: 2_000_000, durationSec: 8, fps: 24, now: 9,
    });
    assert.equal(workspace.takes[0].origin, "imported");
    workspace = reviewVideoTake(workspace, workspace.takes[0].id, "canonical", "Imported pier take.");
    assert.equal(workspace.takes[0].canonical, true);
    const pic = { ...picture(), video: workspace };
    const timeline = buildTimelinePlan(pic);
    assert.equal(timeline.clips[0].videoOrigin, "imported");
    const plan = planPictureExport(pic, "C:/ffmpeg.exe");
    assert.equal(plan.ok, true);
    assert.equal(plan.kind, "mp4");
  });
});
