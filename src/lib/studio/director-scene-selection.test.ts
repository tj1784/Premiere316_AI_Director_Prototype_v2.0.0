import test from "node:test";
import assert from "node:assert/strict";
import { resolveDirectorSceneSelection } from "./director-scene-selection.ts";

const scenes = [{ sceneId: "scene-1" }, { sceneId: "scene-2" }, { sceneId: "scene-22" }];
const shots = [{ id: "shot-1", sceneId: "scene-1" }, { id: "shot-2", sceneId: "scene-2" }, { id: "shot-22", sceneId: "scene-22" }];

test("opening Director from a later shot selects its scene instead of scene 1", () => {
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, [null, "shot-22"], null).sceneId, "scene-22");
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, ["shot-2", "shot-22"], null).sceneId, "scene-2");
});

test("explicit scene selection survives rerenders and reopens until shot focus changes", () => {
  const manual = { pictureId: "picture", sceneId: "scene-22", focusId: "shot-1" };
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, ["shot-1"], manual).sceneId, "scene-22");
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, ["shot-2"], manual).sceneId, "scene-2");
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, [null], manual).sceneId, "scene-22");
});

test("stale picture, shot and removed scene selections cannot open an unrelated workflow", () => {
  const previous = { pictureId: "other-picture", sceneId: "scene-22", focusId: null };
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, ["unknown", "shot-2"], previous).sceneId, "scene-2");
  assert.equal(resolveDirectorSceneSelection("picture", scenes, shots, [null], previous).sceneId, "scene-1");
  assert.equal(resolveDirectorSceneSelection("picture", scenes.slice(0, 2), shots, ["shot-22"], { ...previous, pictureId: "picture" }).sceneId, "scene-1");
  assert.equal(resolveDirectorSceneSelection("picture", [], shots, ["shot-2"], null).sceneId, "");
});
