import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudioAssetAction,
  buildAudioEditPlacement,
  ensureProjectAudioState,
  registerAudioAsset,
  restoreAudioAsset,
  trashAudioAsset
} from "../server/audio-assets.js";

function project() {
  return {
    slug: "audio_asset_fixture",
    sound: {
      schemaVersion: 1,
      voices: [{ id: "voice-old" }],
      generations: [{ id: "generation-old", kind: "index-tts" }],
      legacyKey: { keep: true }
    }
  };
}

test("schema-2 audio state is additive and preserves IndexTTS schema-1 data", () => {
  const value = project();
  const sound = ensureProjectAudioState(value);
  assert.equal(sound.schemaVersion, 2);
  assert.deepEqual(sound.voices, [{ id: "voice-old" }]);
  assert.deepEqual(sound.generations, [{ id: "generation-old", kind: "index-tts" }]);
  assert.deepEqual(sound.audioGenerations, []);
  assert.deepEqual(sound.legacyKey, { keep: true });
  assert.deepEqual(sound.assets, []);
});

test("asset actions preserve immutable provenance and delete to recoverable project trash", () => {
  const value = project();
  const asset = registerAudioAsset(value, {
    id: "asset-1",
    category: "sound effect",
    name: "Door slam",
    media: { path: "media/audio/sound-effects/door.mp3", bytes: 100, durationSec: 1, sha256: "abc", format: "mp3" },
    associations: { sceneId: "scene-1" },
    provenance: { workflow: { profileId: "stable" } }
  });
  applyAudioAssetAction(value, asset.id, "favorite");
  applyAudioAssetAction(value, asset.id, "approve");
  applyAudioAssetAction(value, asset.id, "associate", { sceneId: "scene-2", clipId: "clip-1" });
  assert.equal(asset.favorite, true);
  assert.equal(asset.approved, true);
  assert.equal(asset.associations.sceneId, "scene-2");
  assert.deepEqual(asset.provenance, { workflow: { profileId: "stable" } });

  const placement = buildAudioEditPlacement(asset, { timelineStartSec: 4, fadeInSec: 0.2 });
  assert.equal(placement.source, "media/audio/sound-effects/door.mp3");
  assert.equal(placement.origin.assetId, "asset-1");
  assert.equal(placement.origin.profileId, "stable");

  const trashed = trashAudioAsset(value, asset.id, { moveFile: false, reason: "not selected" });
  assert.match(trashed.media.path, /^media\/trash\/audio\/asset-1\//);
  assert.equal(value.sound.assets.length, 0);
  assert.equal(value.sound.trash.assets.length, 1);
  const restored = restoreAudioAsset(value, asset.id, { moveFile: false });
  assert.equal(restored.media.path, "media/audio/sound-effects/door.mp3");
  assert.equal(value.sound.assets.length, 1);
});

test("asset registration rejects paths outside the category-owned project directory", () => {
  assert.throws(() => registerAudioAsset(project(), {
    category: "music",
    media: { path: "media/audio/sound-effects/wrong.mp3" }
  }), /must be stored below media\/audio\/music/);
});
