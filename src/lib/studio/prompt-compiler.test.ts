import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileEnginePromptPackage, compilePicture } from "./prompt-compiler.ts";
import { makeSamplePicture } from "./sample.ts";
import { validateEnginePromptPackage } from "./generation-validation.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import type { Picture, Shot } from "./types.ts";

function picture(): Picture {
  const intake = makePictureIntake(1);
  const shot: Shot = {
    id: "shot-1",
    sceneId: "scene-1",
    index: 1,
    type: "closeup",
    description: "Mara watches the rain-dark hatch.",
    durationSec: 8,
    camera: "35mm",
    lens: "50mm",
    cameraMove: "slow push",
    emotion: "restraint",
    expression: "wet eyes, still mouth",
    t2iPrompt: "",
    i2vPrompt: "",
    t2voicePrompt: "",
  };
  return {
    id: "pic-1",
    title: "The Last Reel",
    logline: "An editor returns a film canister at night.",
    genre: "Drama",
    tone: "Low-key, wet, archival",
    format: "16:9",
    fps: 24,
    runtimeMinutes: 12,
    createdAt: 1,
    updatedAt: 1,
    stage: "prompts",
    lastOpenedStage: "prompts",
    thumbnailUrl: null,
    intake,
    screenplay: makePictureScreenplay(intake.workflow, null, 1),
    selectedEngine: { director: "dramatron", image: "flux2", video: "ltx-2", voice: "index-tts", music: "minimax-music3" },
    screenplayFountain: "",
    acts: [],
    scenes: [{ id: "scene-1", act: 1, slugline: "EXT. ARCHIVE – NIGHT", summary: "Rain on the hatch.", emotionalBeat: "She almost speaks.", durationSec: 8 }],
    characters: [{ id: "ch-mara", name: "Mara", role: "editor", age: "30s", look: "wet wool, tired eyes", arc: "precision", voiceId: "" }],
    locations: [{ id: "loc-1", name: "Coastal archive", description: "Brutalist concrete beside black water" }],
    props: [],
    wardrobe: [],
    vfx: [],
    shots: [shot],
    cues: [],
    voices: [],
    directorNotes: "",
    usage: { llm: 0, stills: 0, clips: 0, tts: 0 },
  };
}

describe("Wave 5 prompt compiler", () => {
  it("compiles Creative Intent into a structured engine prompt package", () => {
    const pkg = compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "video", now: 10 });
    assert.equal(pkg.schemaVersion, 1);
    assert.equal(pkg.compiler, "deterministic-llama-default");
    assert.equal(pkg.engineTarget, "ltx-2.5");
    assert.match(pkg.enginePrompt, /LTX-2|text-to-video|image-to-video/i);
    assert.match(pkg.negativePrompt, /morphing faces/);
    assert.ok(pkg.cameraTimeline.includes("slow push"));
    assert.ok(pkg.continuityLocks.includes("restraint"));
    assert.equal(pkg.fps, 24);
    assert.equal(pkg.durationSec, 8);
    assert.equal(pkg.provenance.pictureId, "pic-1");
    const validation = validateEnginePromptPackage(pkg);
    assert.equal(validation.ok, true);
  });

  it("keeps still compilation on the selected image dialect and does not fabricate video", () => {
    const pkg = compileEnginePromptPackage({ picture: picture(), shot: picture().shots[0], target: "still" });
    assert.equal(pkg.engineTarget, "flux2-dev");
    assert.match(pkg.enginePrompt, /FLUX/);
    assert.equal(pkg.resolution.width, 512);
  });

  it("compilePicture fills t2i and i2v without claiming a runtime ran", () => {
    const next = compilePicture(picture());
    assert.ok(next.shots[0].t2iPrompt.includes("Mara") || next.shots[0].t2iPrompt.includes("rain"));
    assert.ok(next.shots[0].i2vPrompt.length > 20);
  });

  it("does not crash when screenplay is not yet hydrated", () => {
    const pic = picture();
    Reflect.deleteProperty(pic, "screenplay");
    const pkg = compileEnginePromptPackage({ picture: pic, shot: pic.shots[0], target: "still" });
    assert.equal(pkg.provenance.screenplayVersionId, null);
  });

  it("hydrates The Last Reel sample without reading currentVersionId of undefined", () => {
    const sample = makeSamplePicture();
    assert.ok(sample.screenplay.currentVersionId);
    assert.equal(sample.title, "The Last Reel");
  });
});
