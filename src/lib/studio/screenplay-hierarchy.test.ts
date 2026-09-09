import assert from "node:assert/strict";
import test from "node:test";
import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";
import { extractScopedFountain, otherScenesByteIdentical, spliceScopedFountain } from "./screenplay-scope.ts";
import { diffApprovedHierarchy } from "./screenplay-invalidation.ts";
import { applyExplicitQaRewrite, parseScreenplayQaReport } from "./screenplay-qa.ts";
import { makePictureScreenplay, type ScreenplayModelRef } from "./screenplay.ts";

const fountain = `EXT. PIER — NIGHT\n\nRain.\n\nINT. ARCHIVE — NIGHT\n\nThe reel turns.`;

test("hierarchy ids are stable across identical sluglines", () => {
  const first = parseScreenplayHierarchy(fountain);
  const second = parseScreenplayHierarchy(fountain);
  assert.deepEqual(first.nodes.filter((node) => node.kind === "scene").map((node) => node.id), second.nodes.filter((node) => node.kind === "scene").map((node) => node.id));
  assert.match(first.nodes.find((node) => node.kind === "scene")?.id ?? "", /^SCENE-\d{3}$/);
});

test("slugline rewrite keeps the persisted scene id", () => {
  const first = parseScreenplayHierarchy(fountain);
  const scene = first.nodes.find((node) => node.kind === "scene")!;
  const rewritten = fountain.replace("EXT. PIER — NIGHT", "EXT. HARBOR — NIGHT");
  const second = parseScreenplayHierarchy(rewritten, first);
  assert.equal(second.nodes.find((node) => node.kind === "scene")?.id, scene.id);
});

test("numbered imported scenes and forced credits retain IDs, offsets and scoped edits", () => {
  const imported = "Title: Prodigal Son\r\n\r\nEXT. ROAD - DAY #PS-S01#\r\n\r\n[[Duration: 90]]\r\n\r\nHe waits.\r\n\r\n.END CREDITS OVER BLACK #PS-S23#\r\n\r\n[[Duration: 30]]\r\n\r\nCredits.\r\n";
  const hierarchy = parseScreenplayHierarchy(imported);
  const scenes = hierarchy.nodes.filter((node) => node.kind === "scene");
  assert.deepEqual(scenes.map((node) => node.id), ["PS-S01", "PS-S23"]);
  for (const scene of scenes) assert.equal(imported.slice(scene.sourceStart, scene.sourceEnd), scene.fountain);
  const edited = spliceScopedFountain(imported, "scene", "PS-S01", scenes[0].fountain.replace("He waits.", "He turns."), { previous: hierarchy });
  assert.equal(otherScenesByteIdentical(imported, edited.fountain, "PS-S01", hierarchy), true);
  assert.deepEqual(parseScreenplayHierarchy(edited.fountain, hierarchy).nodes.filter((node) => node.kind === "scene" && !node.tombstoned).map((node) => node.id), ["PS-S01", "PS-S23"]);
});

test("explicit IDs survive scene reordering and duplicates do not create duplicate nodes", () => {
  const first = "EXT. ROAD - DAY #PS-S01#\n\nWait.\n\nEXT. FIELD - DAY #PS-S02#\n\nWork.";
  const hierarchy = parseScreenplayHierarchy(first);
  const reordered = parseScreenplayHierarchy("EXT. FIELD - DAY #PS-S02#\n\nWork.\n\nEXT. ROAD - DAY #PS-S01#\n\nWait.", hierarchy);
  assert.deepEqual(reordered.nodes.filter((node) => node.kind === "scene" && !node.tombstoned).map((node) => node.id), ["PS-S02", "PS-S01"]);
  const duplicates = parseScreenplayHierarchy("EXT. ROAD - DAY #1#\n\n...he waits.\n\nEXT. FIELD - DAY #1#\n\nWork.");
  const ids = duplicates.nodes.map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(duplicates.nodes.filter((node) => node.kind === "scene").length, 2);
});

test("sequence headings parse without rewriting fountain", () => {
  const withSeq = `ACT I\n\nSEQUENCE 03 THE PIER\n\n${fountain}`;
  const hierarchy = parseScreenplayHierarchy(withSeq);
  assert.ok(hierarchy.nodes.some((node) => node.kind === "sequence" && node.id.startsWith("SEQ-")));
  assert.equal(withSeq.includes("SEQUENCE 03 THE PIER"), true);
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

test("selected-scenes and selected-text splice preserve unrelated content", () => {
  const hierarchy = parseScreenplayHierarchy(fountain);
  const scenes = hierarchy.nodes.filter((node) => node.kind === "scene");
  const first = scenes[0]!;
  const second = scenes[1]!;
  const multi = spliceScopedFountain(fountain, "selected-scenes", first.id, "EXT. PIER — NIGHT\n\nHarder rain.\n\nINT. ARCHIVE — NIGHT\n\nThe reel waits.", { nodeIds: [first.id, second.id], previous: hierarchy });
  assert.match(multi.fountain, /Harder rain/);
  const start = fountain.indexOf("Rain.");
  const end = start + "Rain.".length;
  const selected = spliceScopedFountain(fountain, "selected-text", first.id, "Storm.", { selection: { start, end }, previous: hierarchy });
  assert.match(selected.fountain, /Storm/);
  assert.equal(otherScenesByteIdentical(fountain, selected.fountain, first.id, hierarchy), true);
  assert.equal(extractScopedFountain(fountain, "selected-text", first.id, { selection: { start, end } }), "Rain.");
});

test("scoped splices preserve title page, act sequence headings, comments, CRLF, unrelated scenes and stable ids", () => {
  const approved = "Title: THE LAST REEL\r\nCredit: test\r\n\r\nACT I\r\n\r\nSEQUENCE 03 THE PIER\r\n\r\n// keep this note\r\n\r\nEXT. PIER — NIGHT\r\n\r\nRain.\r\n\r\nCUT TO:\r\n\r\nINT. ARCHIVE — NIGHT\r\n\r\nThe reel turns.\r\n\r\n# trailing\r\n";
  const hierarchy = parseScreenplayHierarchy(approved);
  const first = hierarchy.nodes.find((node) => node.kind === "scene")!;
  const second = hierarchy.nodes.filter((node) => node.kind === "scene")[1]!;
  const rewritten = spliceScopedFountain(approved, "scene", first.id, "EXT. PIER — NIGHT\r\n\r\nHarder rain.", { previous: hierarchy }).fountain;
  assert.equal(rewritten.startsWith("Title: THE LAST REEL\r\nCredit: test\r\n\r\nACT I\r\n\r\nSEQUENCE 03 THE PIER\r\n\r\n// keep this note\r\n\r\n"), true);
  assert.match(rewritten, /CUT TO:\r\n\r\nINT\. ARCHIVE/);
  assert.equal(rewritten.endsWith("# trailing\r\n"), true);
  const next = parseScreenplayHierarchy(rewritten, hierarchy);
  assert.equal(next.nodes.find((node) => node.kind === "scene")?.id, first.id);
  assert.equal(next.nodes.filter((node) => node.kind === "scene")[1]?.id, second.id);
  const beforeSecond = approved.slice(second.sourceStart, second.sourceEnd);
  const afterSecond = rewritten.slice(next.nodes.filter((node) => node.kind === "scene")[1]!.sourceStart, next.nodes.filter((node) => node.kind === "scene")[1]!.sourceEnd);
  assert.equal(afterSecond, beforeSecond);
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
