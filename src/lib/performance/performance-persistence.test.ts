import assert from "node:assert/strict";
import test from "node:test";
import type { Picture } from "../studio/types.ts";
import { canonicalShotsToLegacy, migratePicturePerformance } from "./persistence.ts";

test("migrates Last Reel shots without losing media or timeline metadata", () => {
  const picture = {
    id: "pic_last_reel",
    updatedAt: 10,
    intake: { sourceType: "concept", socialWorld: [] },
    screenplay: {
      status: "APPROVED",
      approvedVersionId: "screenplay-approved",
      versions: [{
        id: "screenplay-approved",
        fountain: "INT. STEENBECK ROOM - NIGHT\n\nElias threads the reel.",
        createdAt: 5,
        workflow: "single",
        sourceVersionId: null,
        model: null,
      }],
    },
    performance: null,
    production: null,
    selectedEngine: { video: "ltx-2" },
    scenes: [{ id: "scene-1", slugline: "INT. STEENBECK ROOM - NIGHT", summary: "Elias threads the reel.", durationSec: 12 }],
    characters: [{ id: "elias", name: "Elias Voss" }],
    shots: [{
      id: "shot-1",
      sceneId: "scene-1",
      index: 1,
      type: "closeup",
      description: "Elias studies the unlabeled reel.",
      durationSec: 12,
      camera: "close",
      lens: "85mm",
      cameraMove: "slow push",
      emotion: "unease",
      expression: "held breath",
      t2iPrompt: "archive closeup",
      i2vPrompt: "slow push toward Elias",
      t2voicePrompt: "",
      stillUrl: "file:///last-reel/still-01.png",
      videoUrl: "file:///last-reel/clip-01.mp4",
    }],
  } as unknown as Picture;

  const workspace = migratePicturePerformance(picture);
  assert.ok(workspace);
  assert.equal(workspace.shots.length, picture.shots.length);
  assert.equal(workspace.shots[0].sequenceOrder, picture.shots[0].index);
  assert.equal(workspace.shots[0].durationSec, picture.shots[0].durationSec);
  assert.equal(workspace.shots[0].legacy?.stillUrl, picture.shots[0].stillUrl);
  assert.equal(workspace.shots[0].legacy?.videoUrl, picture.shots[0].videoUrl);

  const downstream = canonicalShotsToLegacy(workspace.shots, picture.shots);
  assert.equal(downstream[0].stillUrl, picture.shots[0].stillUrl);
  assert.equal(downstream[0].videoUrl, picture.shots[0].videoUrl);
  assert.equal(downstream[0].index, 1);
  assert.equal(downstream[0].durationSec, picture.shots[0].durationSec);
  assert.equal(downstream[0].description, picture.shots[0].description);
});
