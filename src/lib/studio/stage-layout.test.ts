import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAGES, type StageId } from "./types.ts";
import {
  resolveStageLayout,
  shellLeftKind,
  shellLeftTitle,
  shellRightKind,
  shellRightTitle,
  showsRewrite,
  type StageLayoutPolicy,
} from "./stage-layout.ts";

const EXPECTED: Record<StageId, StageLayoutPolicy> = {
  intake: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "intake" },
  screenplay: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "screenplay" },
  inventory: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "inventory" },
  performance: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "performance" },
  shots: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "shots" },
  prompts: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "prompts" },
  generate: { leftPanel: "generation", rightPanel: "generation", bottomPanel: "none", headerActions: [], workspaceMode: "generate" },
  timeline: { leftPanel: "media", rightPanel: "clip", bottomPanel: "timeline", headerActions: [], workspaceMode: "stitch" },
  score: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "score" },
  export: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "export" },
};

describe("stage layout policy", () => {
  it("matches the implemented StageId table", () => {
    assert.deepEqual(STAGES.map((stage) => stage.id), Object.keys(EXPECTED));
    for (const id of Object.keys(EXPECTED) as StageId[]) {
      assert.deepEqual(resolveStageLayout(id), EXPECTED[id], id);
    }
  });

  it("gives generate exclusive generation rails", () => {
    for (const id of Object.keys(EXPECTED) as StageId[]) {
      const policy = resolveStageLayout(id);
      assert.equal(policy.leftPanel === "generation", id === "generate", id);
      assert.equal(policy.rightPanel === "generation", id === "generate", id);
    }
  });

  it("gives stitch exclusive media, clip, and timeline rails", () => {
    for (const id of Object.keys(EXPECTED) as StageId[]) {
      const policy = resolveStageLayout(id);
      assert.equal(policy.bottomPanel === "timeline", id === "timeline", id);
      assert.equal(policy.leftPanel === "media", id === "timeline", id);
      assert.equal(policy.rightPanel === "clip", id === "timeline", id);
    }
  });

  it("keeps intake, prompts, score, and export empty of shell rails", () => {
    for (const id of ["intake", "prompts", "score", "export"] as const) {
      const policy = resolveStageLayout(id);
      assert.equal(policy.leftPanel, "none");
      assert.equal(policy.rightPanel, "none");
      assert.equal(policy.bottomPanel, "none");
      assert.deepEqual(policy.headerActions, []);
      assert.equal(shellLeftKind(policy), null);
      assert.equal(shellRightKind(policy), null);
    }
  });

  it("keeps screenplay, inventory, performance, and shots as stage-owned workspaces", () => {
    for (const id of ["screenplay", "inventory", "performance", "shots"] as const) {
      const policy = resolveStageLayout(id);
      assert.equal(policy.leftPanel, "stage");
      assert.equal(policy.rightPanel, "stage");
      assert.equal(policy.bottomPanel, "none");
      assert.equal(shellLeftKind(policy), null);
      assert.equal(shellRightKind(policy), null);
    }
  });

  it("fails closed for unknown stages", () => {
    const policy = resolveStageLayout("research");
    assert.deepEqual(policy, {
      leftPanel: "none",
      rightPanel: "none",
      bottomPanel: "none",
      headerActions: [],
      workspaceMode: "",
    });
    assert.equal(shellLeftKind(policy), null);
    assert.equal(shellRightKind(policy), null);
    assert.equal(showsRewrite(policy), false);
  });

  it("keeps global header actions empty for every implemented stage", () => {
    for (const id of Object.keys(EXPECTED) as StageId[]) {
      assert.deepEqual(resolveStageLayout(id).headerActions, [], id);
      assert.equal(showsRewrite(resolveStageLayout(id)), false, id);
    }
  });

  it("maps only mountable shell kinds to drawer titles", () => {
    assert.equal(shellLeftKind(resolveStageLayout("generate")), "generation");
    assert.equal(shellRightKind(resolveStageLayout("generate")), "generation");
    assert.equal(shellLeftKind(resolveStageLayout("timeline")), "media");
    assert.equal(shellRightKind(resolveStageLayout("timeline")), "clip");
    assert.equal(shellLeftTitle("generation"), "Bin");
    assert.equal(shellRightTitle("generation"), "Inspector");
    assert.equal(shellLeftTitle("media"), "Media");
    assert.equal(shellRightTitle("clip"), "Clip");
  });
});
