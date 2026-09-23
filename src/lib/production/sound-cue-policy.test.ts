import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Picture } from "../studio/types.ts";
import type { SoundCueRecord } from "./audio-types.ts";
import { hasVocalIntent, soundCueSaveError } from "./sound-cue-policy.ts";

const approvedScene = "INT. COURTYARD - NIGHT\n\nFATHER\nCome home.\n";

function picture(fountain = approvedScene): Picture {
  return {
    scenes: [{ id: "scene-1", slugline: "INT. COURTYARD - NIGHT" }],
    shots: [
      { id: "shot-1", sceneId: "scene-1" },
      { id: "shot-2", sceneId: "other-scene" },
    ],
    screenplay: { approvedVersionId: "approved", versions: [{ id: "approved", fountain }] },
    movieBible: { records: {} },
  } as unknown as Picture;
}

function cue(kind: SoundCueRecord["kind"] = "dialogue"): SoundCueRecord {
  return {
    id: "new-cue",
    name: "Father speaks",
    kind,
    sceneId: "scene-1",
    shotId: "shot-1",
    notes: "Use the exact approved line",
    startSec: 0,
    durationSec: 4,
    instrumentation: "",
  };
}

function permit(
  p: Picture,
  recordId = "shot-1",
  name = "Permitted audio",
  value = "Exact approved screenplay dialogue by Father",
  source = "approved screenplay scene-1",
) {
  p.movieBible!.records[recordId] = {
    recordId,
    kind: recordId === "shot-1" ? "shot" : "scene",
    revision: 1,
    fields: {
      [name]: { disposition: "authored", value, source, revision: 1 },
    },
  };
}

describe("source-bound sound cue authoring", () => {
  it("requires a real scene and shot in that scene for new dialogue", () => {
    const p = picture();
    assert.match(soundCueSaveError(p, { ...cue(), sceneId: null, shotId: null })!, /source scene and shot/);
    assert.match(soundCueSaveError(p, { ...cue(), sceneId: "missing" })!, /existing source scene/);
    assert.match(soundCueSaveError(p, { ...cue(), shotId: "missing" })!, /source shot/);
    assert.match(soundCueSaveError(p, { ...cue(), shotId: "shot-2" })!, /selected scene/);
  });

  it("requires an approved screenplay scene with actual dialogue and explicit sourced permission", () => {
    const p = picture();
    p.screenplay.approvedVersionId = null;
    assert.match(soundCueSaveError(p, cue())!, /Approve the source screenplay/);
    p.screenplay.approvedVersionId = "approved";
    p.screenplay.versions[0].fountain = "EXT. MOUNTAIN - NIGHT\n\nFATHER\nCome home.\n";
    assert.match(soundCueSaveError(p, cue())!, /selected scene must appear/);
    p.screenplay.versions[0].fountain = "INT. COURTYARD - NIGHT\n\nFather waits.\n";
    assert.match(soundCueSaveError(p, cue())!, /authored dialogue line/);
    p.screenplay.versions[0].fountain = approvedScene;
    assert.match(soundCueSaveError(p, cue())!, /Author explicit dialogue or vocal permission/);
    permit(p, "shot-1", "Permitted audio", "No dialogue; only wind");
    assert.match(soundCueSaveError(p, cue())!, /Author explicit dialogue or vocal permission/);
    permit(p, "shot-1", "Permitted audio", "Exact screenplay dialogue", "");
    assert.match(soundCueSaveError(p, cue())!, /Author explicit dialogue or vocal permission/);
    permit(p);
    assert.equal(soundCueSaveError(p, cue()), null);
  });

  it("accepts a scoped scene sound permission and scoped music permission for actual vocals", () => {
    const p = picture();
    permit(p, "scene-1", "Sound development / intentional silence", "Father speaks his exact screenplay dialogue");
    assert.equal(soundCueSaveError(p, cue()), null);
    const vocalScore = { ...cue("score"), vocalPolicy: "Wordless choir, no intelligible lyrics" };
    assert.match(soundCueSaveError(p, vocalScore)!, /vocal permission/);
    permit(p, "scene-1", "Musical development", "Wordless choir enters the scene");
    assert.equal(soundCueSaveError(p, vocalScore), null);
  });

  it("leaves Foley/score work and unchanged previously authored vocal bindings editable", () => {
    const p = picture("INT. COURTYARD - NIGHT\n\nThe wind moves the leaves.\n");
    assert.equal(soundCueSaveError(p, cue("foley")), null);
    assert.equal(soundCueSaveError(p, cue("score")), null);
    assert.equal(soundCueSaveError(p, { ...cue("score"), vocalPolicy: "No vocals" }), null);
    const existing = cue();
    assert.equal(soundCueSaveError(p, { ...existing, notes: "Retimed existing authored line" }, existing), null);
    assert.match(soundCueSaveError(p, { ...existing, shotId: "shot-2" }, existing)!, /selected scene/);
    assert.match(soundCueSaveError(p, { ...cue("foley"), kind: "dialogue" }, cue("foley"))!, /authored dialogue line/);
    assert.equal(hasVocalIntent({ ...cue("score"), vocalPolicy: "No vocals" }), false);
    assert.equal(hasVocalIntent({ ...cue("score"), vocalPolicy: "Wordless choir; no lyrics" }), true);
  });
});
