import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture } from "./types.ts";
import {
  DEFAULT_NAV_STEPS,
  PHASE_REVIEW_DEFAULTS,
  buildMoviePlan,
  defaultRequiredTouchpoints,
  emptyProductFlow,
  parseMovieIntent,
  pausedInternalPhase,
} from "./product-flow.ts";

function picture(concept: string): Picture {
  const intake = { ...makePictureIntake(1), concept, premise: "", logline: "", title: "" };
  return {
    id: "pic-1", title: "Untitled", logline: "", genre: "", tone: "", format: "16:9", fps: 24, runtimeMinutes: 12,
    createdAt: 1, updatedAt: 1, stage: "intake", lastOpenedStage: "intake", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [],
    shots: [], cues: [], voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("five-touchpoint product flow", () => {
  it("default nav has only five required touchpoints", () => {
    assert.equal(DEFAULT_NAV_STEPS.length, 5);
    assert.deepEqual(DEFAULT_NAV_STEPS.map((step) => step.id), defaultRequiredTouchpoints());
    assert.deepEqual(DEFAULT_NAV_STEPS.map((step) => step.label), ["Intake", "Assets", "First / Last", "Video Clips", "Export"]);
  });

  it("parses a one-sentence Xenogears trailer brief", () => {
    const parsed = parseMovieIntent("2-minute fan-made live-action trailer for Xenogears, cinematic, photoreal, real people, real robots, naturalistic, restrained.");
    assert.equal(parsed.targetRuntimeMinutes, 2);
    assert.match(parsed.title, /Xenogears/i);
    assert.match(parsed.tone, /Photoreal/);
    assert.equal(parsed.genre, "Trailer");
  });

  it("phase-review checkboxes default off and do not pause automation", () => {
    const flow = emptyProductFlow();
    assert.equal(flow.reviewInternalPhases, false);
    assert.equal(Object.values(PHASE_REVIEW_DEFAULTS).every((value) => value === false), true);
    assert.equal(pausedInternalPhase(flow), null);
  });

  it("Build Movie Plan fail-closes when the configured model is offline and does not land on Assets as ready", () => {
    const result = buildMoviePlan(picture("2-minute live-action Xenogears fan trailer"), { llamaAvailable: false, now: 9 });
    assert.equal(result.flow.nextTouchpoint, "intake");
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "failed");
    assert.equal(result.flow.steps.every((step) => step.status === "failed"), true);
    assert.equal(result.flow.steps.some((step) => step.status === "draftReady"), false);
    assert.match(result.flow.steps.find((step) => step.id === "research")?.message ?? "", /Configured AI model unavailable/);
    assert.match(result.picture.title, /Xenogears/i);
  });

  it("refuses to fake a successful plan without executeMoviePlan", () => {
    assert.throws(
      () => buildMoviePlan(picture("Xenogears trailer"), { llamaAvailable: true, now: 3 }),
      /executeMoviePlan/,
    );
  });
});
