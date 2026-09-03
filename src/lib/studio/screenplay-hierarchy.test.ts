import assert from "node:assert/strict";
import test from "node:test";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";
import { otherScenesByteIdentical, spliceScopedFountain } from "./screenplay-scope.ts";
import { diffApprovedHierarchy } from "./screenplay-invalidation.ts";
import { applyExplicitQaRewrite, parseScreenplayQaReport } from "./screenplay-qa.ts";
import { makePictureScreenplay, type ScreenplayModelRef } from "./screenplay.ts";

const fountain = `EXT. PIER — NIGHT\n\nRain.\n\nINT. ARCHIVE — NIGHT\n\nThe reel turns.`;

test("hierarchy ids are stable across identical sluglines", () => {
  const first = parseScreenplayHierarchy(fountain);
  const second = parseScreenplayHierarchy(fountain);
  assert.deepEqual(first.nodes.filter((node) => node.kind === "scene").map((node) => node.id), second.nodes.filter((node) => node.kind === "scene").map((node) => node.id));
});

test("scoped scene rewrite leaves other scenes byte-identical", () => {
  const hierarchy = parseScreenplayHierarchy(fountain);
  const scene = hierarchy.nodes.find((node) => node.kind === "scene")!;
  const spliced = spliceScopedFountain(fountain, "scene", scene.id, "EXT. PIER — NIGHT\n\nHarder rain.");
  assert.equal(otherScenesByteIdentical(fountain, spliced.fountain, scene.id), true);
});

test("qa parse failure does not invent fountain", () => {
  const model: ScreenplayModelRef = {
    id: "lmstudio:llama",
    servedModelId: "llama-3.3-70b-instruct",
    localCatalogModelId: null,
    displayName: "Llama",
    checkpoint: "llama",
    precision: "Q6",
    quantization: "Q6",
    contextLength: 8,
    sizeBytes: 1,
    runtimeAdapter: "LM Studio",
    status: "ready",
    statusReason: "ready",
  };
  const parsed = parseScreenplayQaReport("not json", "qa1", 1, model);
  assert.equal("error" in parsed, true);
});

test("explicit qa rewrite is the only path that appends a version", () => {
  const model: ScreenplayModelRef = {
    id: "lmstudio:llama",
    servedModelId: "llama-3.3-70b-instruct",
    localCatalogModelId: null,
    displayName: "Llama",
    checkpoint: "llama",
    precision: "Q6",
    quantization: "Q6",
    contextLength: 8,
    sizeBytes: 1,
    runtimeAdapter: "LM Studio",
    status: "ready",
    statusReason: "ready",
  };
  const report = parseScreenplayQaReport(JSON.stringify({
    findings: [{ category: "Dialogue", severity: "note", summary: "Tighten", rewriteSuggested: "INT. ARCHIVE — NIGHT\n\nA shorter turn." }],
  }), "qa1", 1, model);
  if ("error" in report) throw new Error(report.error);
  const screenplay = { ...makePictureScreenplay("single", "lmstudio:qwen", 1), workingFountain: fountain, currentVersionId: "v0" };
  const applied = applyExplicitQaRewrite(screenplay, report, 0, "full", null, "v1", 2);
  if ("error" in applied) throw new Error(applied.error);
  assert.equal(applied.versions.length, 1);
  assert.match(applied.workingFountain, /shorter turn/);
  const impact = diffApprovedHierarchy(fountain, applied.workingFountain, "v0", "v1");
  assert.ok(impact.changedNodeIds.length >= 1);
});
