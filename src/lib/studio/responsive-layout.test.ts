import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dockedPanels, showTimelineForStage, studioLayoutMode } from "./responsive-layout.ts";

describe("responsive studio layout", () => {
  it("keeps the full studio layout at wide widths", () => {
    assert.equal(studioLayoutMode(1920), "wide");
    assert.deepEqual(dockedPanels(1440, { leftCollapsed: false, rightCollapsed: false }), {
      mode: "wide", left: true, right: true,
    });
  });

  it("protects the workspace by moving the inspector to a drawer first", () => {
    assert.deepEqual(dockedPanels(1100, { leftCollapsed: false, rightCollapsed: false }), {
      mode: "compact", left: true, right: false,
    });
  });

  it("moves both optional panels to drawers at narrow widths", () => {
    assert.deepEqual(dockedPanels(900, { leftCollapsed: false, rightCollapsed: false }), {
      mode: "narrow", left: false, right: false,
    });
  });

  it("preserves manually collapsed panel preferences", () => {
    assert.deepEqual(dockedPanels(1600, { leftCollapsed: true, rightCollapsed: true }), {
      mode: "wide", left: false, right: false,
    });
  });

  it("shows the timeline only in the Stitch stage", () => {
    assert.equal(showTimelineForStage("timeline"), true);
    for (const stage of ["intake", "screenplay", "inventory", "performance", "shots", "prompts", "generate", "score", "export"]) {
      assert.equal(showTimelineForStage(stage), false, `${stage} must use the full workspace height`);
    }
  });
});
