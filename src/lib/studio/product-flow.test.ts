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

  it("Build Movie Plan fail-closes Llama phases when offline and still lands on asset approval", () => {
    const result = buildMoviePlan(picture("2-minute live-action Xenogears fan trailer"), { llamaAvailable: false, now: 9 });
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "failed");
    assert.match(result.flow.steps.find((step) => step.id === "research")?.message ?? "", /Llama unavailable/);
    assert.match(result.picture.title, /Xenogears/i);
  });

  it("optional review pauses only selected internal phases", () => {
    const base = picture("Xenogears trailer");
    const withReview = {
      ...base,
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, screenplay: true } },
    };
    const result = buildMoviePlan(withReview, { llamaAvailable: true, now: 3 });
    assert.equal(result.flow.steps.find((step) => step.id === "screenplay")?.status, "waitingForOptionalUserReview");
    assert.equal(pausedInternalPhase(result.flow), "screenplay");
    assert.equal(result.flow.nextTouchpoint, "intake");
  });

  it("master phase-review checkbox with no per-phase flags pauses every internal phase", () => {
    const withMaster = {
      ...picture("Xenogears trailer"),
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS } },
    };
    const result = buildMoviePlan(withMaster, { llamaAvailable: true, now: 4 });
    assert.equal(result.flow.reviewPhases.research, true);
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "waitingForOptionalUserReview");
    assert.equal(pausedInternalPhase(result.flow), "research");
    assert.notEqual(result.flow.nextTouchpoint, "asset-approval");
  });
});
