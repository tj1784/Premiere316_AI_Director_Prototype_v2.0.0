import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeProdigalSonPicture, mergeBundledPictures } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { hydrateProdigalSonDirector, prodigalDirectorScene } from "./prodigal-director.ts";
import { hydrateProdigalSceneReplacements } from "./prodigal-scene-replacement.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";

function picture() { return hydrateProdigalSceneReplacements(hydrateProdigalSonFrames(makeProdigalSonPicture())); }

test("Director adds exact source prompts and candidates to fresh and saved pictures without replacing approved frames", () => {
  const source = picture();
  const imported = hydrateProdigalSonDirector(source);
  assert.equal(imported.shots.length, 152);
  assert.equal(imported.directorBundle!.importedShotIds.length, 149);
  assert.equal(imported.directorBundle!.importedPromptIds.length, 149);
  assert.equal(imported.directorBundle!.importedIterationIds.length, 149);
  assert.equal(imported.directorBundle!.skippedShotIds.length, 0);
  assert.deepEqual(Object.fromEntries(imported.generateGates!.pairs.map((pair) => [pair.shotId, pair])), Object.fromEntries(source.generateGates!.pairs.map((pair) => [pair.shotId, pair])));
  assert.deepEqual(imported.production, source.production);
  for (const scene of PRODIGAL_SON_DIRECTOR.scenes) for (const segment of scene.segments) {
    const shot = imported.shots.find((shot) => shot.id === segment.shotId)!;
    assert.equal(shot.i2vPrompt, segment.prompt);
    assert.equal(shot.durationSec, segment.durationSeconds);
    assert.equal(shot.stillUrl, source.shots.find((prior) => prior.id === shot.id)!.stillUrl);
    const candidate = imported.generateGates!.iterations.find((item) => item.mediaUri === segment.startImage.mediaUri)!;
    assert.equal(candidate.status, "NEEDS_REVIEW");
    assert.equal(candidate.canonical, false);
  }
  assert.equal(hydrateProdigalSonDirector(imported), imported);
  const restored = JSON.parse(JSON.stringify(imported));
  assert.deepEqual(hydrateProdigalSonDirector(restored), restored);
  assert.ok(mergeBundledPictures([]).pictures[0].directorBundle, "First launch includes the source package before persistence runs");
});

test("source update preserves manual prompts, approved choices, removed shots and rejected candidates", () => {
  const source = picture();
  const firstShot = source.shots.find((shot) => shot.sceneId === "PS-S02")!;
  const firstId = firstShot.id;
  const removedId = source.shots.find((shot) => shot.sceneId === "PS-S02" && shot.id !== firstId)!.id;
  firstShot.i2vPrompt = "My edited performance prompt";
  firstShot.durationSec = 17;
  firstShot.stillUrl = "/my-still.png";
  source.shots = source.shots.filter((shot) => shot.id !== removedId);
  source.performance!.shots = source.performance!.shots.filter((shot) => shot.shotId !== removedId);
  const imported = hydrateProdigalSonDirector(source);
  assert.equal(imported.shots.find((shot) => shot.id === firstId)!.i2vPrompt, "My edited performance prompt");
  assert.equal(imported.shots.find((shot) => shot.id === firstId)!.durationSec, 17);
  assert.equal(imported.shots.find((shot) => shot.id === firstId)!.stillUrl, "/my-still.png");
  assert.ok(imported.directorBundle!.skippedShotIds.includes(removedId));
  assert.ok(!imported.generateGates!.prompts.some((prompt) => prompt.shotId === firstId && prompt.kind === "video"));
  const candidate = imported.generateGates!.iterations.find((item) => imported.directorBundle!.importedIterationIds.includes(item.id))!;
  candidate.status = "REJECTED";
  const afterRevision = hydrateProdigalSonDirector(imported, { ...PRODIGAL_SON_DIRECTOR, revision: "test-new-revision" });
  assert.equal(afterRevision.generateGates!.iterations.find((item) => item.id === candidate.id)!.status, "REJECTED");
  assert.equal(afterRevision.shots.find((shot) => shot.id === firstId)!.i2vPrompt, "My edited performance prompt");
  assert.ok(!afterRevision.shots.some((shot) => shot.id === removedId));
});

test("a different approved screenplay or user-owned shot cannot acquire package content", () => {
  const source = picture();
  source.screenplay.approvedVersionId = "my-approved-rewrite";
  assert.equal(hydrateProdigalSonDirector(source), source);
  assert.equal(prodigalDirectorScene(source, "PS-S01"), undefined);
  const colliding = picture();
  const collidingShot = colliding.shots.find((shot) => shot.sceneId === "PS-S02")!;
  colliding.frameBundle!.importedShotIds = colliding.frameBundle!.importedShotIds.filter((id) => id !== collidingShot.id);
  const imported = hydrateProdigalSonDirector(colliding);
  assert.equal(imported.shots.find((shot) => shot.id === collidingShot.id)!.i2vPrompt, collidingShot.i2vPrompt);
  assert.ok(imported.directorBundle!.skippedShotIds.includes(collidingShot.id));
});

test("every supplied graph and image is immutable and matches the approved shot timings", () => {
  let generatedSeconds = 0, storySeconds = 0, segmentCount = 0;
  const verify = (media: { mediaUri: string; sha256: string; bytes: number }) => {
    const bytes = readFileSync(new URL(`../../../public${media.mediaUri}`, import.meta.url));
    assert.equal(bytes.length, media.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), media.sha256);
    return bytes;
  };
  for (const scene of PRODIGAL_SON_DIRECTOR.scenes) {
    const workflow = JSON.parse(verify(scene.workflow).toString("utf8"));
    const director = workflow.nodes.find((node: { type: string }) => node.type === "LTXDirector");
    const timeline = JSON.parse(director.properties.timeline_data);
    assert.equal(timeline.segments.length, scene.segments.length);
    assert.equal(timeline.global_prompt, scene.globalPrompt);
    let endFrame = 0;
    for (const [index, segment] of scene.segments.entries()) {
      const bytes = verify(segment.startImage);
      assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 800);
      assert.equal(segment.prompt, timeline.segments[index].prompt);
      assert.equal(segment.sourceImagePath, timeline.segments[index].imageFile);
      if (!scene.replacement) assert.equal(segment.durationSeconds, PRODIGAL_SON_FRAMES.shots.find((shot) => shot.id === segment.shotId)!.duration_seconds);
      assert.equal(segment.startFrame, endFrame);
      endFrame += segment.durationFrames;
    }
    assert.equal(endFrame / 24, scene.generationDurationSeconds);
    generatedSeconds += scene.generationDurationSeconds;
    storySeconds += scene.storyDurationSeconds;
    segmentCount += scene.segments.length;
  }
  assert.equal(PRODIGAL_SON_DIRECTOR.scenes.length, 22);
  assert.equal(segmentCount, 149); assert.equal(generatedSeconds, 1981); assert.equal(storySeconds, 2005);
  assert.equal(storySeconds + PRODIGAL_SON_DIRECTOR.creditsSeconds, 2035);
  for (const memory of PRODIGAL_SON_DIRECTOR.reusedShots) {
    assert.equal(memory.durationSeconds, 8); assert.equal(memory.sourceIntervalSeconds, null);
    assert.equal(memory.dialogue, "muted");
    assert.ok(PRODIGAL_SON_DIRECTOR.scenes.some((scene) => scene.segments.some((segment) => segment.shotId === memory.sourceShotId)));
    assert.ok(!PRODIGAL_SON_DIRECTOR.scenes.some((scene) => scene.segments.some((segment) => segment.shotId === memory.shotId)));
  }
  for (const document of PRODIGAL_SON_DIRECTOR.documents) verify(document);
});
