import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dockedPanels, showTimelineForStage, studioLayoutMode } from "./responsive-layout.ts";
import { STAGES } from "./types.ts";

const uncollapsed = { leftCollapsed: false, rightCollapsed: false };

describe("responsive studio layout", () => {
  it("keeps the full studio layout at wide widths", () => {
    assert.equal(studioLayoutMode(1920), "wide");
    assert.deepEqual(dockedPanels(1440, uncollapsed, "generate"), {
      mode: "wide", left: true, right: true,
    });
  });

  it("protects the workspace by moving the inspector to a drawer first", () => {
    assert.deepEqual(dockedPanels(1100, uncollapsed, "generate"), {
      mode: "compact", left: true, right: false,
    });
  });

  it("moves both optional panels to drawers at narrow widths", () => {
    assert.deepEqual(dockedPanels(900, uncollapsed, "generate"), {
      mode: "narrow", left: false, right: false,
    });
  });

  it("preserves manually collapsed panel preferences on generate at wide", () => {
    assert.deepEqual(dockedPanels(1600, { leftCollapsed: true, rightCollapsed: true }, "generate"), {
      mode: "wide", left: false, right: false,
    });
  });

  it("keeps a 13-stage pipeline including research and Wave 3 stages at every zoom width", () => {
    assert.equal(STAGES.length, 13);
    assert.equal(STAGES[1]?.id, "research");
    for (const width of [1440, 1152, 960, 720]) {
      assert.equal(showTimelineForStage("research"), false);
      const layout = dockedPanels(width, uncollapsed, "research");
      assert.equal(layout.left, false);
      assert.equal(layout.right, false);
    }
  });

  it("shows the timeline only in the Stitch stage", () => {
    assert.equal(showTimelineForStage("timeline"), true);
    for (const stage of ["intake", "research", "screenplay", "inventory", "visual-development", "cinematography", "performance", "shots", "prompts", "generate", "score", "export"]) {
      assert.equal(showTimelineForStage(stage), false, `${stage} must use the full workspace height`);
    }
  });

  it("does not dock absent rails on intake or export at 1440 uncollapsed", () => {
    assert.deepEqual(dockedPanels(1440, uncollapsed, "intake"), { mode: "wide", left: false, right: false });
    assert.deepEqual(dockedPanels(1440, uncollapsed, "export"), { mode: "wide", left: false, right: false });
  });

  it("docks generate and stitch rails at 1440 uncollapsed", () => {
    assert.deepEqual(dockedPanels(1440, uncollapsed, "generate"), { mode: "wide", left: true, right: true });
    assert.deepEqual(dockedPanels(1440, uncollapsed, "timeline"), { mode: "wide", left: true, right: true });
  });

  it("does not reserve shell columns for stage-owned or empty workspaces", () => {
    for (const stage of ["research", "screenplay", "inventory", "performance", "shots", "prompts", "score"]) {
      assert.deepEqual(dockedPanels(1440, uncollapsed, stage), { mode: "wide", left: false, right: false }, stage);
    }
  });

  it("ignores collapse preferences when the stage owns no shell rail", () => {
    assert.deepEqual(dockedPanels(1440, { leftCollapsed: false, rightCollapsed: false }, "intake"), {
      mode: "wide", left: false, right: false,
    });
    assert.deepEqual(dockedPanels(1440, { leftCollapsed: true, rightCollapsed: true }, "export"), {
      mode: "wide", left: false, right: false,
    });
  });

  it("documents 100/125/150/200% CSS widths without Electron", () => {
    // Default 1440 window: 100% → 1440, 125% → 1152, 150% → 960, 200% → 720.
    const widths = [
      { width: 1440, mode: "wide" as const },
      { width: 1152, mode: "compact" as const },
      { width: 960, mode: "narrow" as const },
      { width: 720, mode: "narrow" as const },
    ];
    for (const { width, mode } of widths) {
      assert.equal(studioLayoutMode(width), mode, `${width}px`);
      const intake = dockedPanels(width, uncollapsed, "intake");
      assert.equal(intake.left || intake.right, false, `intake ${width}`);
      const generate = dockedPanels(width, uncollapsed, "generate");
      assert.equal(generate.mode, mode);
      assert.equal(generate.left, mode !== "narrow");
      assert.equal(generate.right, mode === "wide");
    }
  });
});
