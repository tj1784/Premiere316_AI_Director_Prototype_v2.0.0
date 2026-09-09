import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePictureIntake } from "../studio/picture-intake.ts";
import { makePictureScreenplay } from "../studio/screenplay.ts";
import type { Picture } from "../studio/types.ts";
import { createProductionBreakdown } from "./breakdown.ts";
import {
  approveKeyframeIteration,
  approvedVisualAssetIds,
  cohesionChain,
  compileVideoPromptFromKeyframes,
  compileKeyframePrompt,
  failClosedKeyframe,
  generateGateReadiness,
  hydrateGenerateGates,
  keyframeGateLocked,
  nativeVideoLockedForShot,
  recordImportedKeyframe,
  savePromptVersion,
  staleAfterAssetChange,
  staleAfterKeyframeChange,
  staleAfterVideoPromptChange,
  waiveKeyframePair,
} from "./generate-gates.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  return {
    id: "pic-1", title: "Reel", logline: "Night", genre: "Drama", tone: "Low-key", format: "16:9", fps: 24, runtimeMinutes: 2,
    createdAt: 1, updatedAt: 1, stage: "generate", lastOpenedStage: "generate", thumbnailUrl: null, intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "qwen3-tts", music: "minimax-music3" },
    screenplayFountain: "Title: Reel", acts: [],
    scenes: [{ id: "scene-1", act: 1, slugline: "EXT. NIGHT", summary: "Rain", emotionalBeat: "quiet", durationSec: 8 }],
    characters: [{ id: "ch1", name: "Elias", role: "lead", age: "40", look: "grey", arc: "witness", voiceId: "ara" }],
    locations: [{ id: "loc1", name: "Pier", description: "wet", lighting: "sodium" }],
    props: [], wardrobe: [], vfx: [],
    shots: [{ id: "shot-1", sceneId: "scene-1", index: 1, type: "wide", description: "Pier", durationSec: 8, camera: "35mm", lens: "35mm", cameraMove: "static", emotion: "quiet", expression: "still", t2iPrompt: "rain", i2vPrompt: "", t2voicePrompt: "" }],
    cues: [], voices: [], directorNotes: "", usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("Generate three-gate cohesion", () => {
  it("carries analyzed visual design into both frame prompts without copying board identities", () => {
    const pic = picture();
    pic.intake.visualDirection = { sources: [{ id: "ref", name: "board.jpg" }], boardId: "b", analyzedBoardId: "b", guide: "Warm amber light and tactile linen.", notes: "" };
    for (const kind of ["first", "last"] as const) {
      const prompt = compileKeyframePrompt(pic, pic.shots[0], kind, []);
      assert.match(prompt, /Warm amber light/);
      assert.match(prompt, /Do not copy any depicted person's identity/);
    }
  });
  it("keeps keyframes locked when only asset descriptions exist", () => {
    const pic = picture();
    const readiness = generateGateReadiness(pic);
    assert.equal(readiness[0].status, "LOCKED");
    assert.equal(readiness[0].approved, 0);
    assert.equal(keyframeGateLocked(pic), true);
    assert.equal(nativeVideoLockedForShot(pic, "shot-1"), true);
  });

  it("versions prompts, imports/approves keyframes, and compiles video prompts from approved pair", () => {
    let gates = hydrateGenerateGates(null, picture());
    gates = savePromptVersion(gates, { gate: "keyframes", shotId: "shot-1", assetId: null, kind: "first", text: "IN: Elias on the pier.", assetRefIds: [], firstFrameId: null, lastFrameId: null, now: 10 });
    assert.equal(gates.prompts.at(-1)?.text.includes("Elias"), true);
    gates = recordImportedKeyframe(gates, { shotId: "shot-1", kind: "first", mediaUri: "file://first.png", mediaSha256: "ab".repeat(32), now: 11 });
    gates = recordImportedKeyframe(gates, { shotId: "shot-1", kind: "last", mediaUri: "file://last.png", mediaSha256: "cd".repeat(32), now: 12 });
    gates = approveKeyframeIteration(gates, gates.iterations[0].id);
    gates = approveKeyframeIteration(gates, gates.iterations[1].id);
    assert.equal(gates.pairs[0].status, "APPROVED");
    const pic = { ...picture(), generateGates: gates };
    assert.equal(nativeVideoLockedForShot(pic, "shot-1"), false);
    const prompt = compileVideoPromptFromKeyframes(pic, pic.shots[0], gates.pairs[0]);
    assert.match(prompt.text, /first frame/);
    assert.equal(prompt.firstFrameId, gates.iterations[0].id);
  });

  it("fail-closes generated keyframes and refuses canonical", () => {
    let gates = failClosedKeyframe(hydrateGenerateGates(null, picture()), "shot-1", "first", "No native keyframe worker.", 5);
    assert.throws(() => approveKeyframeIteration(gates, gates.iterations[0].id), /Fail-closed/);
  });

  it("waives a pair so imported video can proceed without native keyframes", () => {
    const gates = waiveKeyframePair(hydrateGenerateGates(null, picture()), "shot-1", "Using imported video path.");
    const pic = { ...picture(), generateGates: gates };
    assert.equal(nativeVideoLockedForShot(pic, "shot-1"), false);
  });

  it("propagates stale state from asset, keyframe, and video prompt changes", () => {
    let gates = hydrateGenerateGates(null, picture());
    gates = { ...gates, pairs: gates.pairs.map((pair) => ({ ...pair, assetRefIds: ["ch1"], status: "APPROVED", firstApprovedId: "a", lastApprovedId: "b" })) };
    gates = staleAfterAssetChange(gates, "ch1");
    assert.equal(gates.pairs[0].status, "STALE");
    gates = staleAfterKeyframeChange(gates, "shot-1");
    assert.ok(gates.pairs[0].staleReasons.some((item) => /Keyframe changed/i.test(item)));
    gates = staleAfterVideoPromptChange(gates, "shot-1");
    assert.ok(gates.pairs[0].staleReasons.some((item) => /Video prompt changed/i.test(item)));
  });

  it("does not auto-start downstream generate before approval", () => {
    const pic = picture();
    assert.equal(nativeVideoLockedForShot(pic, "shot-1"), true);
    const chain = cohesionChain(pic, "shot-1");
    assert.equal(chain.videoTakeId, null);
    assert.equal(chain.firstFrameId, null);
  });

  it("requires actual approved media and seeds only the shot's scene references with canonical versions", () => {
    const pic = picture();
    pic.production = createProductionBreakdown({ pictureId: pic.id, versionId: 'v1', status: 'APPROVED', fountain: 'EXT. PIER - NIGHT\n\nRain.', scenes: [{ id: 'scene-1', slugline: 'EXT. PIER - NIGHT' }, { id: 'scene-2', slugline: 'EXT. FARM - DAY' }], socialWorld: [] }, [
      { id: 'req-1', name: 'Pier', category: 'location', description: 'Wet boards.', sceneIds: ['scene-1'] },
      { id: 'req-2', name: 'Farm', category: 'location', description: 'Stone walls.', sceneIds: ['scene-2'] },
    ], 1);
    for (const asset of pic.production.assets) {
      asset.canonicalApproved = true;
      asset.approvedIterationId = `image:${asset.id}`;
    }
    assert.deepEqual(approvedVisualAssetIds(pic), [], 'A dangling approval ID is not approved media');
    for (const asset of pic.production.assets) asset.iterations.push({ id: asset.approvedIterationId!, variantId: null, mediaUri: `/images/${asset.id}.png`, createdAt: 2, status: 'APPROVED', provenance: asset.provenance[0], specVersionId: 'spec-v1' });
    const sceneAsset = pic.production.assets.find((asset) => asset.requiredSceneIds.includes('scene-1'))!;
    assert.deepEqual(approvedVisualAssetIds(pic, 'scene-1'), [sceneAsset.id]);
    const gates = hydrateGenerateGates(null, pic);
    assert.deepEqual(gates.pairs[0].assetRefIds, [sceneAsset.id]);
    assert.match(gates.pairs[0].firstPrompt, /iteration image:.*spec spec-v1/);
    assert.doesNotMatch(gates.pairs[0].firstPrompt, /Farm/);
    const prompt = compileKeyframePrompt(pic, pic.shots[0], 'first', pic.production.assets.map((asset) => asset.id));
    assert.doesNotMatch(prompt, /Farm/);
    pic.generateGates = savePromptVersion(gates, { gate: 'keyframes', shotId: 'shot-1', assetId: null, kind: 'first', text: gates.pairs[0].firstPrompt, assetRefIds: [sceneAsset.id], firstFrameId: null, lastFrameId: null, now: 3 });
    sceneAsset.iterations[0] = { ...sceneAsset.iterations[0], id: 'replacement-canon' };
    sceneAsset.approvedIterationId = 'replacement-canon';
    assert.equal(hydrateGenerateGates(pic.generateGates, pic).pairs[0].status, 'STALE', 'Same asset ID with a new canonical image invalidates the frame prompt');
    sceneAsset.iterations[0].status = 'STALE';
    assert.deepEqual(approvedVisualAssetIds(pic, 'scene-1'), []);
    assert.equal(keyframeGateLocked(pic), true);
  });

  it("does not unlock video from dangling, stale or mismatched frame approval IDs", () => {
    const pic = picture();
    let gates = hydrateGenerateGates(null, pic);
    gates.pairs[0] = { ...gates.pairs[0], firstApprovedId: 'missing-first', lastApprovedId: 'missing-last', status: 'APPROVED' };
    pic.generateGates = gates;
    assert.equal(nativeVideoLockedForShot(pic, 'shot-1'), true);
    assert.throws(() => compileVideoPromptFromKeyframes(pic, pic.shots[0], gates.pairs[0]), /Approve current first and last frames/);
    gates = waiveKeyframePair(gates, 'shot-1', 'Explicitly using imported video');
    pic.generateGates = gates;
    const waived = compileVideoPromptFromKeyframes(pic, pic.shots[0], gates.pairs[0]);
    assert.match(waived.text, /no frame approval is implied/);
    assert.doesNotMatch(waived.text, /approved first frame missing/);
  });
});
