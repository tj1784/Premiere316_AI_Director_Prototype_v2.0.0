import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileEnginePromptPackage } from "../studio/prompt-compiler.ts";
import { makePictureIntake } from "../studio/picture-intake.ts";
import { makePictureScreenplay } from "../studio/screenplay.ts";
import type { Picture, Shot } from "../studio/types.ts";
import { emptyVideoWorkspace } from "./video-types.ts";
import { cancelVideoJob, enqueueVideoJob, failClosedVideoJob, inspectVideoTakeQC, restoreVideoWorkspace, reviewVideoTake, shotVideoReadiness } from "./video-iterations.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  const shot: Shot = {
    id: "shot-1", sceneId: "scene-1", index: 1, type: "closeup", description: "Night hatch.",
    durationSec: 8, camera: "35mm", lens: "50mm", cameraMove: "static", emotion: "quiet", expression: "still",
    t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "",
  };
  return {
    id: "pic-1", title: "Reel", logline: "Night", genre: "Drama", tone: "Low-key", format: "16:9", fps: 24, runtimeMinutes: 8,
    createdAt: 1, updatedAt: 1, stage: "generate", lastOpenedStage: "generate", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "index-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [{ id: "scene-1", act: 1, slugline: "EXT. NIGHT", summary: "Rain", emotionalBeat: "", durationSec: 8 }],
    characters: [], locations: [], props: [], wardrobe: [], vfx: [], shots: [shot], cues: [], voices: [], directorNotes: "",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("Wave 5 video jobs and take review", () => {
  it("queues a video job from a compiled prompt and fail-closes without fabricating media", () => {
    const pkg = compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "video", now: 5 });
    let workspace = enqueueVideoJob(emptyVideoWorkspace(), { pictureId: "pic-1", shotId: "shot-1", promptPackage: pkg, now: 10 });
    assert.equal(workspace.jobs.length, 1);
    assert.equal(workspace.jobs[0].status, "queued");
    workspace = failClosedVideoJob(workspace, workspace.jobs[0].id, "No official native LTX 2.5 worker.", 20);
    assert.equal(workspace.jobs[0].status, "failed");
    assert.equal(workspace.takes[0].status, "FAILED");
    assert.equal(workspace.takes[0].mediaUri, null);
    assert.equal(shotVideoReadiness(workspace, "shot-1"), "FAILED");
  });

  it("rejects canonical approval without durable media and supports reject", () => {
    const pkg = compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "video", now: 5 });
    let workspace = failClosedVideoJob(
      enqueueVideoJob(emptyVideoWorkspace(), { pictureId: "pic-1", shotId: "shot-1", promptPackage: pkg, now: 10 }),
      "videojob:shot-1:10",
      "unavailable",
      20,
    );
    assert.throws(() => reviewVideoTake(workspace, workspace.takes[0].id, "canonical", "no"), /Failed or cancelled/);
    workspace = { ...workspace, takes: [{ ...workspace.takes[0], status: "NEEDS_REVIEW", origin: "fail-closed", mediaSha256: null }] };
    assert.throws(() => reviewVideoTake(workspace, workspace.takes[0].id, "canonical", "no"), /Fail-closed video|durable media/);
    workspace = { ...workspace, takes: [{ ...workspace.takes[0], origin: "imported", mediaSha256: null, probe: null }] };
    assert.throws(() => reviewVideoTake(workspace, workspace.takes[0].id, "canonical", "no"), /durable media/);
    workspace = reviewVideoTake({ ...workspace, takes: [{ ...workspace.takes[0], mediaSha256: "a".repeat(64) }] }, workspace.takes[0].id, "reject", "Wrong motion.");
    assert.equal(workspace.takes[0].status, "REJECTED");
  });

  it("QC fails closed when probe/hash/provenance are missing", () => {
    const qc = inspectVideoTakeQC({ expectedDurationSec: 8, expectedFps: 24, probe: null, mediaSha256: null, provenancePresent: false, authorityFresh: true, tokenUnused: true });
    assert.equal(qc.ok, false);
    assert.ok(qc.checks.some((check) => check.id === "probe" && !check.ok));
  });

  it("restores running jobs to queued without duplicating them", () => {
    const restored = restoreVideoWorkspace({
      schemaVersion: 1,
      jobs: [{ id: "job-1", pictureId: "p", shotId: "s", engineId: "ltx-2", kind: "t2v", status: "running", createdAt: 1, updatedAt: 1, promptPackage: compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "video" }), takeIds: [], error: null, priority: 1 }],
      takes: [],
      schedulerSnapshot: null,
    });
    assert.equal(restored.jobs[0].status, "queued");
  });

  it("cancel leaves cancelled jobs cancelled", () => {
    const pkg = compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "video" });
    const queued = enqueueVideoJob(emptyVideoWorkspace(), { pictureId: "pic-1", shotId: "shot-1", promptPackage: pkg, now: 3 });
    const cancelled = cancelVideoJob(queued, queued.jobs[0].id, 4);
    assert.equal(cancelled.jobs[0].status, "cancelled");
  });
});
