import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture } from "./types.ts";
import { emptyProductFlow, PHASE_REVIEW_DEFAULTS, buildMoviePlan } from "./product-flow.ts";
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  executeMoviePlan,
  executeResearchDraft,
  extractJsonObject,
  failClosedMoviePlan,
  type MoviePlanGenerate,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import { RESEARCH_BIBLE_SECTION_KEYS, researchSectionsArePopulated } from "../research/bible.ts";

function picture(concept: string): Picture {
  const intake = { ...makePictureIntake(1), concept, premise: "", logline: "", title: "" };
  return {
    id: "pic-1", title: "Untitled", logline: "", genre: "", tone: "", format: "16:9", fps: 24, runtimeMinutes: 12,
    createdAt: 1, updatedAt: 1, stage: "intake", lastOpenedStage: "intake", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [],
    shots: [], cues: [], voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    productFlow: emptyProductFlow(),
  };
}

function sections() {
  return Object.fromEntries(RESEARCH_BIBLE_SECTION_KEYS.map((key) => [key, `Generated ${key} for Xenogears. Fei and Elly. Weltall. Ignas. Canon from the game. Photoreal live action.`]));
}

const RESPONSES: Record<string, string> = {
  research: JSON.stringify({
    title: "Xenogears Trailer",
    sections: sections(),
    characters: [{ name: "Fei Fong Wong", role: "Painter", age: "18", look: "Black hair, worn jacket", arc: "Witness" }],
    locations: [{ name: "Lahan", description: "Mountain village at dusk", lighting: "Amber practicals" }],
    sources: [{ title: "Xenogears", locator: "Squaresoft 1998", quote: "A thousand years of sorrow." }],
  }),
  screenplay: JSON.stringify({
    fountain: "Title: XENOGARS\n\nINT. LAHAN STUDIO - DUSK\n\nFEI paints. The canvas is already burning.\n\nEXT. IGNAS PLAIN - NIGHT\n\nWELTALL steps through smoke. ELLY looks back.",
  }),
  screenplayQa: JSON.stringify({
    findings: [{ category: "CHARACTER DRIFT", severity: "note", summary: "Fei remains a witness, not a speechmaker.", recommendation: "Keep silence.", revisionRequired: false }],
  }),
  breakdown: JSON.stringify({
    assets: [
      { category: "character", name: "Fei Fong Wong", description: "Painter in a worn jacket" },
      { category: "character", name: "Elly", description: "Soldier looking back" },
      { category: "location", name: "Lahan", description: "Mountain village" },
      { category: "prop", name: "Canvas", description: "Burning painting" },
      { category: "creature", name: "Weltall", description: "Gear in smoke" },
      { category: "voice", name: "Fei voice", description: "Quiet" },
      { category: "music", name: "Score", description: "Restrained strings" },
    ],
  }),
  visualDevelopment: JSON.stringify({ intent: "Photoreal dusk", palette: ["amber", "iron"], motifs: ["burning canvas"] }),
  cinematography: JSON.stringify({ thesis: "Hold faces past comfort", lensLanguage: "35mm", lighting: "practical amber", movement: "static then slow push" }),
  performance: JSON.stringify({ notes: "Silence over speech", shots: [{ description: "Fei paints", type: "closeup", durationSec: 6, camera: "close", lens: "50mm", emotion: "dread" }] }),
  shots: JSON.stringify({
    shots: [
      { description: "Fei paints as the canvas burns", type: "closeup", durationSec: 6, camera: "close", lens: "50mm", cameraMove: "static", emotion: "dread", expression: "still" },
      { description: "Weltall in smoke", type: "wide", durationSec: 8, camera: "wide", lens: "35mm", cameraMove: "slow push", emotion: "awe", expression: "open" },
    ],
  }),
};

function mockRuntime(): MoviePlanRuntime {
  const generate: MoviePlanGenerate = async ({ stepId }) => {
    const text = RESPONSES[stepId];
    if (!text) throw new Error(`unexpected step ${stepId}`);
    return { text };
  };
  return { available: true, reason: "", servedModelId: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", generate };
}

describe("Build Movie Plan executes the configured model", () => {
  it("offline does not mark draftReady or invent research/screenplay", async () => {
    const result = await executeMoviePlan(picture("2-minute live-action Xenogears fan trailer"), {
      runtime: { available: false, reason: CONFIGURED_MODEL_UNAVAILABLE, servedModelId: null, generate: null },
      now: 9,
    });
    assert.equal(result.providerCalled, false);
    assert.equal(result.flow.nextTouchpoint, "intake");
    assert.equal(result.flow.steps.every((step) => step.status === "failed"), true);
    assert.equal(result.flow.steps.some((step) => step.status === "draftReady"), false);
    assert.equal(result.picture.research?.versions.length ?? 0, 0);
    assert.equal(result.picture.screenplay.workingFountain.trim().length, 0);
    assert.equal(result.picture.production?.assets.length ?? 0, 0);
    assert.match(result.flow.steps[0]?.message ?? "", /Configured AI model unavailable/);
  });

  it("sync buildMoviePlan stays fail-closed and never fakes success", () => {
    const result = buildMoviePlan(picture("2-minute live-action Xenogears fan trailer"), { llamaAvailable: false, now: 9 });
    assert.equal(result.flow.nextTouchpoint, "intake");
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "failed");
    assert.equal(result.flow.manualFallback, true);
    assert.throws(() => buildMoviePlan(picture("Xenogears"), { llamaAvailable: true, now: 3 }), /executeMoviePlan/);
  });

  it("available runtime generates research, screenplay, QA, and assets", async () => {
    const result = await executeMoviePlan(picture("2-minute live-action Xenogears fan trailer"), { runtime: mockRuntime(), now: 11, id: () => "id-1" });
    assert.equal(result.providerCalled, true);
    assert.deepEqual(result.calls, ["research", "screenplay", "screenplayQa", "breakdown", "visualDevelopment", "cinematography", "performance", "shots", "promptLab"]);
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.equal(researchSectionsArePopulated(result.picture.research?.content.sections), true);
    assert.match(result.picture.screenplay.workingFountain, /INT\. LAHAN/);
    assert.ok((result.picture.screenplay.lastQaReport?.findings.length ?? 0) > 0);
    assert.ok((result.picture.production?.assets.length ?? 0) >= 3);
    assert.ok(result.picture.shots.length >= 2);
    assert.ok(result.picture.shots.every((shot) => shot.t2iPrompt.length > 0));
    const dir = resolve("screenshots/fix-build-movie-plan-functional-execution");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "research-output-sample.json"), `${JSON.stringify(result.picture.research?.content.sections, null, 2)}\n`);
    writeFileSync(resolve(dir, "screenplay-output-sample.json"), `${JSON.stringify({ fountain: result.picture.screenplay.workingFountain }, null, 2)}\n`);
    writeFileSync(resolve(dir, "asset-gate-after-build.json"), `${JSON.stringify({ assets: result.picture.production?.assets.map((asset) => ({ id: asset.id, name: asset.name, category: asset.category })) }, null, 2)}\n`);
    writeFileSync(resolve(dir, "build-movie-plan-success.json"), `${JSON.stringify({ calls: result.calls, next: result.flow.nextTouchpoint, servedModelId: result.flow.servedModelId }, null, 2)}\n`);
  });

  it("Research draft action calls the provider and does not succeed when unavailable", async () => {
    const online = await executeResearchDraft(picture("Xenogears"), { runtime: mockRuntime(), now: 4, id: () => "rs-1" });
    assert.equal(online.providerCalled, true);
    assert.equal(researchSectionsArePopulated(online.picture.research?.content.sections), true);
    const offline = await executeResearchDraft(picture("Xenogears"), {
      runtime: { available: false, reason: CONFIGURED_MODEL_UNAVAILABLE, servedModelId: null, generate: null },
      now: 5,
    });
    assert.equal(offline.providerCalled, false);
    assert.equal(offline.picture.research?.versions.length ?? 0, 0);
  });

  it("optional review pauses after a real generated phase", async () => {
    const base = picture("Xenogears trailer");
    const withReview = {
      ...base,
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, screenplay: true } },
    };
    const result = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 6, id: () => "id-2" });
    assert.equal(result.flow.steps.find((step) => step.id === "screenplay")?.status, "waitingForOptionalUserReview");
    assert.ok(result.picture.research?.approvedVersionId);
    assert.match(result.picture.screenplay.workingFountain, /INT\./);
  });

  it("does not mention ComfyUI, 8188, or cloud in the pipeline module", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./movie-plan-pipeline.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /ComfyUI|:8188|openai\.com|anthropic|openrouter|api\.x\.ai/i);
    assert.equal(extractJsonObject("```json\n{\"ok\":true}\n```").ok, true);
  });
});
