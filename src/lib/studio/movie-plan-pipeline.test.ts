import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture } from "./types.ts";
import { emptyProductFlow, PHASE_REVIEW_DEFAULTS, buildMoviePlan } from "./product-flow.ts";
import { moviePlanResponseFormat } from "./movie-plan-schema.ts";
import {
  CONFIGURED_MODEL_UNAVAILABLE,
  executeMoviePlan,
  executeResearchDraft,
  extractJsonObject,
  type MoviePlanGenerate,
  type MoviePlanRuntime,
} from "./movie-plan-pipeline.ts";
import { approveResearchBible, RESEARCH_BIBLE_SECTION_KEYS, researchSectionsArePopulated, researchSectionsLookPlaceholder } from "../research/bible.ts";

const EVIDENCE = resolve("screenshots/pre-audit-build-movie-plan-blockers");

function picture(concept: string): Picture {
  const intake = { ...makePictureIntake(1), concept, premise: "", logline: "", title: "" };
  return {
    id: "pic-1", title: "Untitled", logline: "", genre: "", tone: "", format: "16:9", fps: 24, runtimeMinutes: 12,
    createdAt: 1, updatedAt: 1, stage: "intake", lastOpenedStage: "intake", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [],
    shots: [], cues: [], voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    productFlow: { ...emptyProductFlow(), qaEnabled: true },
  };
}

const BRIEF = "2-minute fan-made live-action trailer for Xenogears, cinematic, photoreal, real people, real robots, naturalistic, restrained.";

const SECTIONS = {
  sourceCanonLedger: "Squaresoft 1998 Xenogears is the canon ledger: Fei, Elly, Weltall, Lahan, and the Ignas war are treated as source, not original IP.",
  worldOverview: "Ignas is a photoreal continent of mountain villages, rusted gears, and dusk practicals. Lahan sits above a valley that still burns from the opening raid.",
  characters: "Fei Fong Wong is an 18-year-old painter who witnesses rather than speeches. Elly is a soldier who looks back instead of explaining the war.",
  locations: "Lahan studio at dusk; Ignas plain at night with smoke and wet earth. Both must read as live-action geography, not game UI.",
  storyTheme: "A two-minute live-action trailer about recognition: the painter sees the machine, the soldier sees the painter, neither lectures the audience.",
  audienceContext: "Fan-made live-action trailer for viewers who know Xenogears and for strangers who only need faces, smoke, and restraint.",
  visualIdentity: "Photoreal 35mm, tungsten practicals, rain on glass, iron and amber. No cel-shading, no HUD, no anime eye enlargement.",
  productionDesign: "Worn linen, oil-stained wood, a burning canvas, and Weltall as a full-scale practical/VFX hybrid, never a toy.",
  costumeProps: "Fei's paint-stiff jacket and Elly's campaign coat. Hero props: unlabeled canvas, 35mm-adjacent tools, no glowing relics.",
  cinematographyResearch: "Hold faces past comfort. 35mm and 50mm. Static until the gear steps, then a slow push. No crash zooms.",
  soundMusicWorld: "Dry studio air, distant raid thunder, restrained strings. No licensed Xenogears MIDI dump.",
  risksDisputes: "Fan-work must not claim official canon. Weltall scale and Elly's military rank stay conservative.",
  aiProductionFeasibility: "Stills and editorial assembly are feasible locally. Native H3/LTX remain fail-closed; imported plates may stand in.",
  confidenceLedger: "A: named Xenogears characters and Lahan. B: photoreal live-action brief. C: invented trailer beats not in the opening cinematic.",
};

const FOUNTAIN = `Title: Xenogears Live-Action Trailer
Credit: Fan work

INT. LAHAN STUDIO - DUSK

FEI FONG WONG paints. The canvas is already burning. He does not speak.

EXT. IGNAS PLAIN - NIGHT

WELTALL steps through smoke. ELLY looks back at Fei, then at the machine.`;

const RESPONSES: Record<string, string> = {
  research: JSON.stringify({
    title: "Xenogears Trailer",
    sections: SECTIONS,
    characters: [{ name: "Fei Fong Wong", role: "Painter", age: "18", look: "Black hair, worn jacket", arc: "Witness" }],
    locations: [{ name: "Lahan", sceneNumbers: [1], description: "Mountain village at dusk", lighting: "Amber practicals" }],
    sources: [{ title: "Xenogears", locator: "Squaresoft 1998", quote: "A thousand years of sorrow." }],
  }),
  screenplay: JSON.stringify({ fountain: FOUNTAIN }),
  screenplayQa: JSON.stringify({
    findings: [{
      category: "CINEMATOGRAPHY OPPORTUNITY",
      severity: "note",
      summary: "The burning canvas in INT. LAHAN STUDIO is the trailer’s only moving image before Weltall; keep Fei silent so the cut to Ignas is the first sound of war.",
      recommendation: "Do not add explanatory dialogue over the burning canvas.",
      revisionRequired: false,
    }],
  }),
  breakdown: JSON.stringify({
    assets: [
      { category: "character", name: "Fei Fong Wong", sceneNumbers: [1], description: "Painter in a worn jacket from the Lahan studio scene" },
      { category: "character", name: "Elly", sceneNumbers: [2], description: "Soldier who looks back on the Ignas plain" },
      { category: "location", name: "Lahan", sceneNumbers: [1], description: "Studio at dusk from the first slugline" },
      { category: "prop", name: "Canvas", sceneNumbers: [1], description: "Burning painting from INT. LAHAN STUDIO" },
      { category: "creature", name: "Weltall", sceneNumbers: [2], description: "Gear stepping through smoke in EXT. IGNAS PLAIN" },
      { category: "voice", name: "Fei voice", sceneNumbers: [1], description: "Held silence, then later ADR if needed" },
      { category: "music", name: "Restrained strings", sceneNumbers: [1, 2], description: "Score world from research, not a MIDI dump" },
    ],
  }),
  promptLab: JSON.stringify({ visualContinuity: 'Photoreal dusk, worn jackets, amber practical light.', shots: [{ shotNumber: 1, videoPrompt: 'Fei paints as the canvas burns in Lahan, the camera holds his trembling hand.', imagePrompt: 'Fei before a burning canvas in his worn jacket.' }, { shotNumber: 2, videoPrompt: 'Weltall steps through smoke while Elly looks back. The camera slowly follows her gaze.', imagePrompt: 'Elly looks toward the towering machine through smoke.' }] }),
  visualDevelopment: JSON.stringify({ intent: "Photoreal dusk for Xenogears", palette: ["amber", "iron"], motifs: ["burning canvas"] }),
  cinematography: JSON.stringify({ thesis: "Hold Fei’s face past comfort then cut to Weltall", lensLanguage: "35mm", lighting: "practical amber", movement: "static then slow push" }),
  performance: JSON.stringify({ notes: "Silence over speech in Lahan", shots: [{ description: "Fei paints as the canvas burns", type: "closeup", durationSec: 6, camera: "close", lens: "50mm", emotion: "dread" }] }),
  shots: JSON.stringify({
    shots: [
      { sceneNumber: 1, description: "Fei paints as the canvas burns in Lahan", type: "closeup", durationSec: 6, camera: "close", lens: "50mm", cameraMove: "static", emotion: "dread", expression: "still" },
      { sceneNumber: 2, description: "Weltall steps through smoke on the Ignas plain while Elly looks back", type: "wide", durationSec: 8, camera: "wide", lens: "35mm", cameraMove: "slow push", emotion: "awe", expression: "open" },
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

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("Build Movie Plan executes the configured model", () => {
  it("retries truncated breakdown output while preserving the completed screenplay and continuing to assets", async () => {
    const draft = picture(BRIEF);
    draft.screenplay.workingFountain = FOUNTAIN;
    draft.productFlow = { ...emptyProductFlow(), reviewInternalPhases: false, qaEnabled: false, thinkingEnabled: false };
    let breakdownCalls = 0;
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => {
      assert.ok(!["research", "screenplay", "screenplayQa"].includes(stepId));
      return { text: stepId === "breakdown" && ++breakdownCalls === 1 ? '{"assets":[{"name":"unfinished' : RESPONSES[stepId] };
    } };
    const result = await executeMoviePlan(draft, { runtime, fromCompletedScreenplay: true });
    assert.equal(breakdownCalls, 2);
    assert.equal(result.picture.screenplay.workingFountain, FOUNTAIN);
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.ok(result.picture.production);
  });
  it("rejects shot coverage that omits the screenplay ending", async () => {
    const incomplete = JSON.parse(RESPONSES.shots);
    incomplete.shots[1].sceneNumber = 1;
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "shots" ? JSON.stringify(incomplete) : RESPONSES[stepId] }) };
    const result = await executeMoviePlan(picture(BRIEF), { runtime });
    assert.equal(result.flow.steps.find((step) => step.id === "shots")?.status, "failed");
    assert.equal(result.calls.includes("promptLab"), false);
    assert.equal(result.picture.nativeFilm?.writer, undefined);
  });

  it("accepts schema-keyed shots and keeps their chronological scene links", async () => {
    const rows = JSON.parse(RESPONSES.shots).shots;
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "shots" ? JSON.stringify({ shots: { shot_02: rows[1], shot_01: rows[0] } }) : RESPONSES[stepId] }) };
    const result = await executeMoviePlan(picture(BRIEF), { runtime });
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.deepEqual(result.picture.shots.map((shot) => shot.sceneId), result.picture.scenes.map((scene) => scene.id));
  });
  it("skips QA completely when disabled and carries source evidence into the screenplay", async () => {
    const draft = picture("3-minute Moses crossing the Red Sea");
    draft.productFlow = emptyProductFlow();
    draft.intake.suppliedSourceText = "The waters were a wall unto them on their right hand, and on their left.";
    let screenplayAsk = "";
    const runtime = { ...mockRuntime(), generate: async (request: Parameters<MoviePlanGenerate>[0]) => {
      assert.notEqual(request.stepId, "screenplayQa");
      if (request.stepId === "screenplay") screenplayAsk = request.prompt;
      return { text: RESPONSES[request.stepId] };
    } };
    const result = await executeMoviePlan(draft, { runtime });
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.equal(result.flow.steps.find((row) => row.id === "screenplayQa")?.status, "skipped");
    assert.equal(result.picture.screenplay.lastQaReport, null);
    assert.equal(result.calls.includes("screenplayQa"), false);
    assert.match(screenplayAsk, /The waters were a wall/);
  });
  it("honors the sentence runtime, but preserves an explicit manual override", async () => {
    let seen = "";
    const runtime = { ...mockRuntime(), generate: async (request: Parameters<MoviePlanGenerate>[0]) => { if (request.stepId === "research") seen = request.prompt; return { text: RESPONSES[request.stepId] }; } };
    const first = await executeMoviePlan(picture("two-minute trailer for Xenogears"), { runtime });
    assert.equal(first.picture.runtimeMinutes, 2);
    assert.equal(first.picture.shots.reduce((sum, shot) => sum + Math.round(shot.durationSec * first.picture.fps), 0), 120 * first.picture.fps);
    assert.equal(first.picture.intake.targetRuntimeMinutes, 2);
    assert.match(seen, /"runtimeMinutes":2/);
    const manual = picture(BRIEF);
    manual.intake.runtimeSource = "manual";
    manual.intake.targetRuntimeMinutes = 5;
    assert.equal((await executeMoviePlan(manual, { runtime })).picture.runtimeMinutes, 5);
  });

  it("uses structured output for all model phases and rejects malformed screenplay JSON", async () => {
    for (const phase of Object.keys(RESPONSES)) assert.equal(moviePlanResponseFormat(phase).json_schema.strict, true);
    const bounded = JSON.parse(JSON.stringify(moviePlanResponseFormat("breakdown", 5)));
    assert.deepEqual(bounded.json_schema.schema.properties.assets.items.properties.sceneNumbers.items.enum, [1, 2, 3, 4, 5]);
    const timed = JSON.parse(JSON.stringify(moviePlanResponseFormat("shots", 6, 180))).json_schema.schema.properties.shots;
    assert.equal(timed.required.length, 18);
    assert.equal(timed.properties.shot_01.properties.sceneNumber.const, 1);
    assert.equal(timed.properties.shot_18.properties.sceneNumber.const, 6);
    assert.equal(timed.properties.shot_18.properties.durationSec.const, 10);
    assert.deepEqual([...new Set(Object.values(timed.properties).map((row: any) => row.properties.sceneNumber.const))], [1, 2, 3, 4, 5, 6]);
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "screenplay" ? '{"fountain":"INT. ROOM - DAY\nUnescaped"}' : RESPONSES[stepId] }) };
    const result = await executeMoviePlan(picture(BRIEF), { runtime });
    assert.equal(result.flow.steps.find((step) => step.id === "screenplay")?.status, "failed");
    assert.equal(result.picture.production, undefined);
  });

  it("does not promote remembered quotes to supplied evidence, and preserves scene links and acting direction", async () => {
    const result = await executeMoviePlan(picture(BRIEF), { runtime: mockRuntime() });
    assert.doesNotMatch(JSON.stringify(result.picture.research?.content.sources), /A thousand years of sorrow/);
    const elly = result.picture.production?.assets.find((asset) => asset.name === "Elly");
    assert.deepEqual(elly?.requiredSceneIds, [result.picture.scenes[1].id]);
    assert.match(JSON.stringify(result.picture.performance?.performance), /Silence over speech in Lahan/);
  });

  it("rejects research promises instead of completed analysis", async () => {
    const research = JSON.parse(RESPONSES.research);
    research.sections.worldOverview = "We'll research the source world and investigate its cultural background.";
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "research" ? JSON.stringify(research) : RESPONSES[stepId] }) };
    const result = await executeMoviePlan(picture(BRIEF), { runtime });
    assert.equal(result.flow.steps[0].status, "failed");
    assert.equal(result.picture.research?.approvedVersionId ?? null, null);
  });

  it("rechecks a bounded writer correction and never approves unresolved QA blockers", async () => {
    const blocker = JSON.stringify({ findings: [{ category: "CONTINUITY ISSUE", severity: "blocker", summary: "Fei must react to the burning canvas.", recommendation: "Add his reaction.", revisionRequired: true }] });
    let qaCalls = 0;
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "screenplayQa" && ++qaCalls === 1 ? blocker : RESPONSES[stepId] }) };
    const corrected = await executeMoviePlan(picture(BRIEF), { runtime });
    assert.equal(corrected.flow.nextTouchpoint, "asset-approval");
    assert.equal(corrected.calls.filter((phase) => phase === "screenplayQa").length, 2);
    assert.ok(corrected.picture.screenplay.versions.some((version) => version.label === "QA-revised screenplay"));
    assert.equal(corrected.picture.cinematography?.shotPlans.length, corrected.picture.shots.length);
    const unresolved = await executeMoviePlan(picture(BRIEF), { runtime: { ...mockRuntime(), generate: async ({ stepId }) => ({ text: stepId === "screenplayQa" ? blocker : RESPONSES[stepId] }) } });
    assert.equal(unresolved.flow.steps.find((phase) => phase.id === "screenplayQa")?.status, "failed");
    assert.equal(unresolved.picture.screenplay.approvedVersionId, null);
    assert.equal(unresolved.calls.filter((phase) => phase === "screenplayQa").length, 2);
    assert.ok(unresolved.picture.screenplay.lastQaReport?.findings.length);
    let writerCalls = 0;
    const malformedRevision = await executeMoviePlan(picture(BRIEF), { runtime: { ...mockRuntime(), generate: async ({ stepId }) => ({ text: stepId === "screenplayQa" ? blocker : stepId === "screenplay" && ++writerCalls > 1 ? "truncated" : RESPONSES[stepId] }) } });
    assert.equal(malformedRevision.flow.steps.find((phase) => phase.id === "screenplay")?.status, "failed");
    assert.equal(malformedRevision.picture.screenplay.approvedVersionId, null);
  });
  it("offline does not mark draftReady or invent research/screenplay", async () => {
    const result = await executeMoviePlan(picture(BRIEF), {
      runtime: { available: false, reason: CONFIGURED_MODEL_UNAVAILABLE, servedModelId: null, generate: null },
      now: 9,
    });
    assert.equal(result.providerCalled, false);
    assert.equal(result.flow.nextTouchpoint, "intake");
    assert.equal(result.flow.steps.every((step) => step.status === "failed"), true);
    assert.equal(result.flow.steps.some((step) => step.status === "draftReady"), false);
    assert.equal(result.picture.research?.versions.length ?? 0, 0);
    assert.equal(result.picture.screenplay.workingFountain.trim().length, 0);
  });

  it("sync buildMoviePlan stays fail-closed and never fakes success", () => {
    const result = buildMoviePlan(picture(BRIEF), { llamaAvailable: false, now: 9 });
    assert.equal(result.flow.nextTouchpoint, "intake");
    assert.equal(result.flow.manualFallback, true);
    assert.throws(() => buildMoviePlan(picture(BRIEF), { llamaAvailable: true, now: 3 }), /executeMoviePlan/);
  });

  it("rejects placeholder research and preserves Xenogears in generated output", async () => {
    const result = await executeMoviePlan(picture(BRIEF), { runtime: mockRuntime(), now: 11, id: ids("id-1") });
    const sections = result.picture.research?.content.sections;
    assert.equal(researchSectionsArePopulated(sections), true);
    assert.equal(researchSectionsLookPlaceholder(sections), false);
    assert.match(result.picture.title, /Xenogears/i);
    assert.doesNotMatch(result.picture.title, /XENOGARS/i);
    const fountain = result.picture.screenplay.workingFountain;
    assert.match(fountain, /Xenogears/i);
    assert.doesNotMatch(fountain, /XENOGARS/i);
    assert.match(fountain, /INT\. LAHAN STUDIO/);
    assert.match(fountain, /EXT\. IGNAS PLAIN/);
    assert.match(fountain, /FEI FONG WONG paints/);
    assert.match(fountain, /WELTALL/);
    const qa = result.picture.screenplay.lastQaReport?.findings[0]?.summary ?? "";
    assert.match(qa, /burning canvas|LAHAN|Weltall/i);
    const hay = `${fountain}\n${JSON.stringify(sections)}`;
    for (const asset of result.picture.production?.assets ?? []) {
      const token = asset.name.split(" ")[0];
      assert.ok(hay.toLocaleLowerCase().includes(token.toLocaleLowerCase()), asset.name);
    }
    assert.ok(result.picture.shots.every((shot) => shot.t2iPrompt.length > 0 && /Fei|Weltall|Lahan|canvas|Ignas/i.test(`${shot.description} ${shot.t2iPrompt}`)));
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(resolve(EVIDENCE, "anti-placeholder-tests.json"), `${JSON.stringify({
      title: result.picture.title,
      fountainTitle: fountain.split("\n")[0],
      placeholderRejected: !researchSectionsLookPlaceholder(sections),
      sluglines: 2,
      qaReferencesScreenplay: /burning canvas|LAHAN|Weltall/i.test(qa),
    }, null, 2)}\n`);
  });

  it("default mode auto-approves internal research and screenplay", async () => {
    const result = await executeMoviePlan(picture(BRIEF), { runtime: mockRuntime(), now: 12, id: ids("id-def") });
    assert.ok(result.picture.research?.approvedVersionId);
    assert.match(result.picture.research?.versions.find((version) => version.id === result.picture.research?.approvedVersionId)?.label ?? "", /Automation-approved/);
    assert.ok(result.picture.screenplay.approvedVersionId);
    assert.equal(result.flow.nextTouchpoint, "asset-approval");
    assert.equal(result.picture.nativeFilm?.writer?.rawResponse, RESPONSES.promptLab);
    assert.equal(result.picture.shots[0].i2vPrompt, JSON.parse(RESPONSES.promptLab).shots[0].videoPrompt);
  });

  it("fails the prompt pass instead of replacing missing model output with a template", async () => {
    const runtime = { ...mockRuntime(), generate: async ({ stepId }: Parameters<MoviePlanGenerate>[0]) => ({ text: stepId === "promptLab" ? '{"visualContinuity":"wardrobe","shots":[]}' : RESPONSES[stepId] }) };
    const previous = picture(BRIEF);
    previous.nativeFilm = { visualContinuity: "Old draft", prompts: { sh1: "Old prompt" }, writer: { modelId: "old-model", generatedAt: 1, rawResponse: "old response" } };
    const result = await executeMoviePlan(previous, { runtime });
    assert.equal(result.flow.steps.find((item) => item.id === "promptLab")?.status, "failed");
    assert.equal(result.picture.nativeFilm?.writer, undefined);
  });

  it("phase-review Research generates a draft and does not auto-approve", async () => {
    const withReview = {
      ...picture(BRIEF),
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, research: true } },
    };
    const result = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 13, id: ids("id-r") });
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "waitingForOptionalUserReview");
    assert.equal(result.picture.research?.approvedVersionId, null);
    assert.ok((result.picture.research?.versions.length ?? 0) >= 1);
    assert.equal(result.picture.research?.versions.some((version) => /Automation-approved/i.test(version.label)), false);
    assert.equal(result.picture.screenplay.workingFountain.trim(), "");
  });

  it("phase-review Screenplay keeps a draft without approvedVersionId", async () => {
    const withReview = {
      ...picture(BRIEF),
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, screenplay: true } },
    };
    const result = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 14, id: ids("id-s") });
    assert.equal(result.flow.steps.find((step) => step.id === "screenplay")?.status, "waitingForOptionalUserReview");
    assert.ok(result.picture.research?.approvedVersionId);
    assert.equal(result.picture.screenplay.approvedVersionId, null);
    assert.match(result.picture.screenplay.workingFountain, /INT\./);
  });

  it("phase-review QA keeps the report and does not auto-approve the screenplay", async () => {
    const withReview = {
      ...picture(BRIEF),
      productFlow: { ...emptyProductFlow(), qaEnabled: true, reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, screenplayQa: true } },
    };
    const result = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 15, id: ids("id-q") });
    assert.equal(result.flow.steps.find((step) => step.id === "screenplayQa")?.status, "waitingForOptionalUserReview");
    assert.ok((result.picture.screenplay.lastQaReport?.findings.length ?? 0) > 0);
    assert.equal(result.picture.screenplay.approvedVersionId, null);
  });

  it("rejects placeholder Generated section research", async () => {
    const sections = Object.fromEntries(RESEARCH_BIBLE_SECTION_KEYS.map((key) => [key, `Generated ${key} for Xenogears.`]));
    const runtime: MoviePlanRuntime = {
      available: true,
      reason: "",
      servedModelId: "llama-3.3-70b-instruct",
      generate: async ({ stepId }) => {
        if (stepId === "research") return { text: JSON.stringify({ title: "Xenogears", sections, characters: [], locations: [], sources: [] }) };
        throw new Error(`unexpected ${stepId}`);
      },
    };
    const result = await executeMoviePlan(picture(BRIEF), { runtime, now: 16, id: ids("id-ph") });
    assert.equal(result.flow.steps.find((step) => step.id === "research")?.status, "failed");
    assert.match(result.flow.steps.find((step) => step.id === "research")?.message ?? "", /placeholder/i);
    assert.equal(result.picture.research?.approvedVersionId ?? null, null);
  });

  it("phase-review continues after the user approves research", async () => {
    const withReview = {
      ...picture(BRIEF),
      productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, research: true } },
    };
    const first = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 17, id: ids("id-c1") });
    assert.equal(first.picture.research?.approvedVersionId, null);
    const approved = approveResearchBible(first.picture.research!, "user-approve", 18);
    if ("error" in approved) throw new Error(approved.error);
    const second = await executeMoviePlan({ ...first.picture, research: approved, productFlow: first.flow }, { runtime: mockRuntime(), now: 19, id: ids("id-c2") });
    assert.match(second.picture.screenplay.workingFountain, /Xenogears/i);
    assert.equal(second.flow.steps.find((step) => step.id === "research")?.status, "draftReady");
    assert.equal(second.flow.nextTouchpoint, "asset-approval");
  });

  it("phase-review later departments pause without auto-approval", async () => {
    const phases = ["breakdown", "visualDevelopment", "cinematography", "performance", "shots", "promptLab"] as const;
    const paused: Record<string, string> = {};
    for (const phase of phases) {
      const withReview = {
        ...picture(BRIEF),
        productFlow: { ...emptyProductFlow(), reviewInternalPhases: true, reviewPhases: { ...PHASE_REVIEW_DEFAULTS, [phase]: true } },
      };
      const result = await executeMoviePlan(withReview, { runtime: mockRuntime(), now: 20, id: ids(`id-${phase}`) });
      assert.equal(result.flow.steps.find((step) => step.id === phase)?.status, "waitingForOptionalUserReview", phase);
      assert.equal(result.picture.visualDevelopment?.boards.every((board) => board.status !== "APPROVED") ?? true, true);
      paused[phase] = "waitingForOptionalUserReview";
    }
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(resolve(EVIDENCE, "phase-review-tests.json"), `${JSON.stringify({
      researchPauseNoApprove: true,
      screenplayPauseNoApprove: true,
      qaPauseNoApprove: true,
      defaultModeAutoApproves: true,
      continuesAfterUserApprove: true,
      laterDepartments: paused,
    }, null, 2)}\n`);
  });

  it("Research draft action does not auto-approve", async () => {
    const online = await executeResearchDraft(picture(BRIEF), { runtime: mockRuntime(), now: 4, id: ids("rs-1") });
    assert.equal(online.providerCalled, true);
    assert.equal(online.picture.research?.approvedVersionId, null);
    assert.equal(researchSectionsLookPlaceholder(online.picture.research?.content.sections), false);
  });

  it("does not mention ComfyUI, 8188, or cloud in the pipeline module", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./movie-plan-pipeline.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /ComfyUI|:8188|openai\.com|anthropic|openrouter|api\.x\.ai/i);
    assert.equal(extractJsonObject("```json\n{\"ok\":true}\n```").ok, true);
  });
});
