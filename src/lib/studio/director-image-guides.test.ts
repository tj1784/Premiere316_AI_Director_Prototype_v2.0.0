import test from "node:test";
import assert from "node:assert/strict";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { hydrateProdigalSonDirector } from "./prodigal-director.ts";
import { hydrateProdigalSceneReplacements } from "./prodigal-scene-replacement.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { resolveDirectorSceneImages } from "./director-image-guides.ts";
import { createDirectorEditorJson, rebindDirectorEditorImages, updateDirectorEditorPrompt, directorEditorPrompts } from "./director-workflow-editor.ts";
import { readFileSync } from "node:fs";

const scene = PRODIGAL_SON_DIRECTOR.scenes[1];
const fixture = () => hydrateProdigalSonDirector(hydrateProdigalSceneReplacements(hydrateProdigalSonFrames(makeProdigalSonPicture())));

test("the existing approved first frame wins without creating or modifying assets", () => {
  const picture = fixture(), before = JSON.stringify(picture);
  const result = resolveDirectorSceneImages(picture, scene);
  assert.deepEqual(result.issues, []);
  for (const segment of scene.segments) {
    const pair = picture.generateGates!.pairs.find((item) => item.shotId === segment.shotId)!;
    const approved = picture.generateGates!.iterations.find((item) => item.id === pair.firstApprovedId)!;
    assert.equal(result.guides[segment.segmentId].mediaUri, approved.mediaUri);
    assert.equal(result.guides[segment.segmentId].sha256, approved.mediaSha256);
    assert.equal(result.guides[segment.segmentId].label, "Existing approved first frame");
  }
  assert.equal(JSON.stringify(picture), before);
});

test("registered starting images are reused when no first frame is approved, missing or rejected guides block", () => {
  const picture = fixture();
  const first = scene.segments[0], pair = picture.generateGates!.pairs.find((item) => item.shotId === first.shotId)!;
  pair.firstApprovedId = null;
  assert.equal(resolveDirectorSceneImages(picture, scene).guides[first.segmentId].sha256, first.startImage.sha256);
  picture.generateGates!.iterations = picture.generateGates!.iterations.filter((item) => item.shotId !== first.shotId);
  picture.shots.find((shot) => shot.id === first.shotId)!.stillUrl = undefined;
  assert.equal(resolveDirectorSceneImages(picture, scene).guides[first.segmentId], undefined);
  assert.match(resolveDirectorSceneImages(picture, scene).issues[0], /attach or select/);
});

test("changing an existing selected asset invalidates the scene key and rebinds guides without losing prompts", () => {
  const picture = fixture(), first = scene.segments[0];
  const prior = resolveDirectorSceneImages(picture, scene);
  const source = JSON.parse(readFileSync(new URL(`../../../public${scene.workflow.mediaUri}`, import.meta.url), "utf8"));
  const baseline = createDirectorEditorJson(source, scene, {}, prior.guides);
  const edited = updateDirectorEditorPrompt(baseline, baseline, first.segmentId, "Keep my user-directed camera movement");
  const pair = picture.generateGates!.pairs.find((item) => item.shotId === first.shotId)!;
  const selected = picture.generateGates!.iterations.find((item) => item.id === pair.firstApprovedId)!;
  picture.generateGates!.iterations.push({ ...selected, id: "new-approval", mediaUri: "media://existing-asset.png", mediaSha256: "a".repeat(64) });
  pair.firstApprovedId = "new-approval";
  const next = resolveDirectorSceneImages(picture, scene);
  assert.notEqual(next.key, prior.key);
  const rebound = rebindDirectorEditorImages(edited, baseline, next.guides);
  assert.ok(rebound.includes(`premiere316-image://${"a".repeat(64)}`));
  assert.ok(!rebound.includes(`premiere316-image://${prior.guides[first.segmentId].sha256}`));
  assert.equal(directorEditorPrompts(rebound).segments[first.segmentId], "Keep my user-directed camera movement");
});
