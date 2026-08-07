import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  replaceStoryboardTargetReferences,
  storyboardSummary,
  validateStoryboard
} from "../server/storyboard.js";

const project = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/project.json", import.meta.url), "utf8"));
const storyboard = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/production/storyboard.json", import.meta.url), "utf8"));

test("production storyboard package has the verified structure", () => {
  validateStoryboard(storyboard, project.slug);
  const summary = storyboardSummary(storyboard);
  assert.deepEqual({
    chapters: summary.chapters,
    scenes: summary.scenes,
    clips: summary.clips,
    frames: summary.frames,
    segments: summary.segments,
    referenceBindings: summary.referenceBindings,
    effectiveReferences: summary.effectiveReferences,
    runtimeFrames: summary.runtimeFrames
  }, {
    chapters: 10,
    scenes: 34,
    clips: 119,
    frames: 161,
    segments: 357,
    referenceBindings: 734,
    effectiveReferences: 987,
    runtimeFrames: 48960
  });
});

test("every effective image-guide reference pins an exact project asset version", () => {
  const assets = new Map((project.assets?.items || []).map((asset) => [asset.id, asset]));
  let checked = 0;
  for (const frame of Object.values(storyboard.frames)) {
    assert.ok(frame.references.length > 0, `${frame.id} must have effective references`);
    for (const reference of frame.references) {
      const asset = assets.get(reference.assetId);
      assert.ok(asset, `${reference.id} asset must exist`);
      const version = (asset.versions || []).find((item) => Number(item.v) === Number(reference.assetVersion));
      assert.ok(version, `${reference.id} version must exist`);
      assert.ok([version.file, ...(version.files || [])].includes(reference.sourceAssetFile), `${reference.id} filename must belong to the pinned version`);
      checked += 1;
    }
  }
  assert.equal(checked, 987);
});

test("every authored reference binding targets a real frame or segment", () => {
  let frameBindings = 0;
  let segmentBindings = 0;
  for (const binding of Object.values(storyboard.referenceBindings)) {
    if (binding.targetKind === "frame") {
      assert.ok(Object.hasOwn(storyboard.frames, binding.targetId), `${binding.id} frame target must exist`);
      frameBindings += 1;
    } else if (binding.targetKind === "segment") {
      assert.ok(Object.hasOwn(storyboard.segments, binding.targetId), `${binding.id} segment target must exist`);
      assert.equal(binding.authoredTargetKind, "frame");
      assert.match(binding.authoredTargetId, /^frame-segment-/);
      segmentBindings += 1;
    } else {
      assert.fail(`${binding.id} has unsupported target kind ${binding.targetKind}`);
    }
  }
  assert.equal(frameBindings, 725);
  assert.equal(segmentBindings, 9);
});

test("reference replacement is target-scoped, exact-version pinned, and de-duplicated", () => {
  const targetId = "frame-h01-s01-c01-first";
  const originalTargetCount = storyboard.frames[targetId].references.length;
  const authored = storyboard.frames[targetId].references.find((reference) => reference.assetId === "loc-inner-chamber-dark");
  assert.ok(authored, "fixture must contain the authored historical chamber reference");
  const otherTargetId = "frame-h01-s01-c02-first";
  const otherTargetBefore = structuredClone(storyboard.frames[otherTargetId].references);
  const result = replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
    targetId,
    references: [
      {
        id: authored.id,
        assetId: authored.assetId,
        assetVersion: authored.assetVersion,
        role: authored.role,
        cropRegion: authored.cropRegion,
        notes: authored.notes,
        pinnedActiveAtImport: authored.pinnedActiveAtImport
      },
      { assetId: "loc-inner-chamber-dark", assetVersion: 2, role: "style" },
      { assetId: "character-jesus-the-harrower-primary-appearance", assetVersion: 4, role: "identity" }
    ]
  });
  assert.equal(storyboard.frames[targetId].references.length, originalTargetCount, "input storyboard must not be mutated");
  assert.equal(result.references.length, 2, "duplicate asset IDs are collapsed deterministically");
  assert.equal(result.references[0].sourceAssetFile, "loc-chamber-dark.v1.png");
  assert.equal(result.references[0].assetVersionId, "loc-inner-chamber-dark:v1");
  assert.equal(result.references[0].id, authored.id, "unchanged authored binding ID must survive Apply");
  assert.equal(result.references[0].cropRegion, authored.cropRegion);
  assert.equal(result.references[0].notes, authored.notes);
  assert.equal(result.references[0].pinnedActiveAtImport, authored.pinnedActiveAtImport);
  assert.equal(result.storyboard.referenceBindings[authored.id].order, storyboard.referenceBindings[authored.id].order, "authored binding order must survive Apply");
  assert.equal(result.storyboard.frames[targetId].references.length, 2);
  assert.deepEqual(result.storyboard.frames[otherTargetId].references, otherTargetBefore, "unrelated frame references must be preserved");
});

test("reference replacement rejects unknown storyboard targets", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
    targetId: "missing-frame",
    references: []
  }), /target not found/);
});

test("reference replacement rejects prototype-chain target IDs", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
    targetId: "__proto__",
    references: []
  }), /target not found/);
});
