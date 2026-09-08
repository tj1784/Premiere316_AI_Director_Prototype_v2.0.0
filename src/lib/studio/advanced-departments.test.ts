import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture } from "./types.ts";
import { DEFAULT_NAV_STEPS, defaultRequiredTouchpoints, emptyProductFlow, PHASE_REVIEW_DEFAULTS } from "./product-flow.ts";
import {
  ADVANCED_DEPARTMENT_GROUPS,
  ADVANCED_DEPARTMENTS,
  advancedDepartmentCards,
  isAdvancedDashboard,
  isAdvancedDepartmentId,
  numberedStageRailForbidden,
} from "./advanced-departments.ts";

function picture(): Picture {
  const intake = { ...makePictureIntake(1), title: "Xenogears Trailer", concept: "2-minute trailer" };
  return {
    id: "pic-1", title: "Xenogears Trailer", logline: "", genre: "", tone: "", format: "16:9", fps: 24, runtimeMinutes: 2,
    createdAt: 1, updatedAt: 1, stage: "intake", lastOpenedStage: "intake", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "", acts: [], scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [],
    shots: [], cues: [], voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
    productFlow: emptyProductFlow(),
  };
}

describe("advanced departments are optional tools, not the main path", () => {
  it("keeps default mode to five unnumbered-competing touchpoints", () => {
    assert.equal(DEFAULT_NAV_STEPS.length, 5);
    assert.deepEqual(DEFAULT_NAV_STEPS.map((step) => step.id), defaultRequiredTouchpoints());
    assert.deepEqual(DEFAULT_NAV_STEPS.map((step) => step.label), ["Intake", "Assets", "First / Last", "Video Clips", "Export"]);
    assert.equal(DEFAULT_NAV_STEPS.some((step) => step.stage === "research"), false);
  });

  it("groups twelve optional departments and never marks them required", () => {
    assert.equal(ADVANCED_DEPARTMENTS.length, 12);
    assert.equal(ADVANCED_DEPARTMENTS.every((item) => item.requiredInDefault === false), true);
    assert.deepEqual(ADVANCED_DEPARTMENT_GROUPS.map((group) => group.label), [
      "Research & Story",
      "Planning",
      "Production Review",
    ]);
    assert.deepEqual(ADVANCED_DEPARTMENT_GROUPS.flatMap((group) => group.departments), ADVANCED_DEPARTMENTS.map((item) => item.id));
    assert.equal(isAdvancedDepartmentId("research"), true);
    assert.equal(isAdvancedDepartmentId("generate"), false);
  });

  it("opens on a dashboard surface rather than a numbered 14-tab rail", () => {
    assert.equal(isAdvancedDashboard("advanced", "dashboard"), true);
    assert.equal(isAdvancedDashboard("advanced", "research"), false);
    assert.equal(isAdvancedDashboard("default", "dashboard"), false);
    const rail = readFileSync(new URL("../../components/studio/stage-views.tsx", import.meta.url), "utf8");
    const advanced = readFileSync(new URL("../../components/studio/advanced-departments.tsx", import.meta.url), "utf8");
    assert.equal(numberedStageRailForbidden(rail), false);
    assert.equal(numberedStageRailForbidden(advanced), false);
    assert.match(advanced, /Return to Default Mode/);
    assert.match(rail, /AdvancedDepartmentsRail/);
    assert.doesNotMatch(rail, /01–14|Stage \{currentIndex \+ 1\} of \{STAGES\.length\}/);
    assert.doesNotMatch(rail, /grid-cols-\[repeat\(13/);
  });

  it("department cards expose status, controls, and required-in-default No", () => {
    const cards = advancedDepartmentCards(picture());
    const research = cards.find((card) => card.id === "research");
    assert.ok(research);
    assert.equal(research.requiredInDefault, false);
    assert.equal(research.status, "Not generated");
    assert.match(research.controls, /Research Bible/);
    assert.equal(PHASE_REVIEW_DEFAULTS.research, false);
  });

  it("does not introduce ComfyUI, 8188, or cloud fallback in the advanced UX modules", () => {
    const files = [
      readFileSync(new URL("./advanced-departments.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../research/research-room.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../../components/studio/advanced-departments.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../components/research/research-workspace.tsx", import.meta.url), "utf8"),
    ].join("\n");
    assert.doesNotMatch(files, /ComfyUI|:8188|cloud fallback|openai|anthropic|openrouter|api\.x\.ai/i);
  });
});
