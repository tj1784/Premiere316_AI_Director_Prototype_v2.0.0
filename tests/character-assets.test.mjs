import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAssetFile,
  activeAssetVersion,
  buildCharacterBundles,
  characterBundleKey,
  readableCharacterText,
  sourceImportState
} from "../client/src/character-assets.js";
import { resolveProductionRoute } from "../client/src/navigation.js";

function visual(id, name, variant = "Appearance", activeVersion = 1) {
  return {
    id,
    name,
    variant,
    category: "character",
    mediaType: "image",
    activeVersion,
    activeVersionCurrent: true,
    versions: activeVersion ? [{ v: activeVersion, file: `${id}.v${activeVersion}.png` }] : []
  };
}

function related(id, name, category, extra = {}) {
  return {
    id,
    name,
    variant: category === "voice" ? "Voice Design" : "Production Reference",
    category,
    mediaType: category === "voice" ? "audio" : "image",
    activeVersion: 1,
    activeVersionCurrent: true,
    versions: [{ v: 1, file: `${id}.v1.${category === "voice" ? "wav" : "png"}` }],
    ...extra
  };
}

test("character text repairs both common mojibake dash forms before keying", () => {
  const controlSequence = `EVE \u00e2\u0080\u0094 VOICE DESIGN3.wav`;
  const windowsSequence = `EVE \u00e2\u20ac\u201d VOICE DESIGN3.wav`;
  assert.equal(readableCharacterText(controlSequence), "EVE - VOICE DESIGN3.wav");
  assert.equal(readableCharacterText(windowsSequence), "EVE - VOICE DESIGN3.wav");
  assert.equal(characterBundleKey(controlSequence), "eve");
  assert.equal(characterBundleKey("JESUS — The Harrower"), "jesus");
});

test("visual variants collapse into one character while ID prefixes attach differently named wardrobe", () => {
  const assets = [
    visual("character-jesus-the-harrower-primary-appearance", "JESUS - The Harrower", "Primary Appearance", 4),
    visual("character-jesus-the-harrower-close-up", "JESUS - The Harrower", "Close-up", 3),
    visual("character-jesus-the-harrower-action-pose", "JESUS - The Harrower", "Action Pose", 3),
    visual("character-guardian-leader-hells-champion-appearance", "Guardian Leader"),
    visual("character-john-the-baptist-appearance", "John the Baptist"),
    related("ward-jesus-robe", "Jesus white linen robe", "wardrobe"),
    related("ward-jesus-belt", "Leather cord belt", "wardrobe"),
    related("ward-jesus-sandals", "Rough leather sandals", "wardrobe"),
    related("ward-guardian-leader-armor", "Guardian Armor", "wardrobe"),
    related("ward-john-the-baptist", "John Wardrobe", "wardrobe"),
    related("voice-jesus-the-harrower-voice-design", "JESUS - The Harrower", "voice")
  ];
  const bundles = buildCharacterBundles(assets, []);
  const jesus = bundles.find((bundle) => bundle.key === "jesus");
  const guardian = bundles.find((bundle) => bundle.key === "guardian-leader");
  const john = bundles.find((bundle) => bundle.key === "john-the-baptist");

  assert.equal(bundles.length, 3);
  assert.equal(jesus.characterAssets.length, 3);
  assert.deepEqual(jesus.wardrobeAssets.map((asset) => asset.id), ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals"]);
  assert.deepEqual(jesus.voiceAssets.map((asset) => asset.id), ["voice-jesus-the-harrower-voice-design"]);
  assert.deepEqual(guardian.wardrobeAssets.map((asset) => asset.id), ["ward-guardian-leader-armor"]);
  assert.deepEqual(john.wardrobeAssets.map((asset) => asset.id), ["ward-john-the-baptist"]);
});

test("explicit relationship IDs and dependencies outrank coincidental name prefixes", () => {
  const jesus = visual("character-jesus", "Jesus");
  const john = visual("character-john", "John");
  const assets = [
    jesus,
    john,
    related("ward-misattributed-name", "John ceremonial robe", "wardrobe", { characterAssetId: jesus.id }),
    related("voice-misattributed-name", "Jesus narration", "voice", { dependencies: [john.id] })
  ];
  const bundles = buildCharacterBundles(assets, []);
  assert.deepEqual(bundles.find((bundle) => bundle.key === "jesus").wardrobeAssets.map((asset) => asset.id), ["ward-misattributed-name"]);
  assert.deepEqual(bundles.find((bundle) => bundle.key === "john").voiceAssets.map((asset) => asset.id), ["voice-misattributed-name"]);
});

test("multi-character dependency boards remain shared instead of leaking into one bible", () => {
  const jesus = visual("character-jesus", "Jesus");
  const john = visual("character-john-the-baptist", "John the Baptist");
  const jesusWardrobe = related("ward-jesus-robe", "Jesus robe", "wardrobe");
  const johnWardrobe = related("ward-john-the-baptist", "John Wardrobe", "wardrobe");
  const sharedBoard = related("wardrobe-project-continuity-board", "Wardrobe Board", "wardrobe", {
    dependencies: [jesusWardrobe.id, johnWardrobe.id]
  });
  const bundles = buildCharacterBundles([jesus, john, jesusWardrobe, johnWardrobe, sharedBoard], []);
  assert.deepEqual(bundles.find((bundle) => bundle.key === "jesus").wardrobeAssets.map((asset) => asset.id), [jesusWardrobe.id]);
  assert.deepEqual(bundles.find((bundle) => bundle.key === "john-the-baptist").wardrobeAssets.map((asset) => asset.id), [johnWardrobe.id]);
});

test("the longest character prefix wins for overlapping character names", () => {
  const assets = [
    visual("character-john", "John"),
    visual("character-john-the-baptist", "John the Baptist"),
    related("ward-john-the-baptist-hide", "Baptist hide", "wardrobe")
  ];
  const bundles = buildCharacterBundles(assets, []);
  assert.equal(bundles.find((bundle) => bundle.key === "john").wardrobeAssets.length, 0);
  assert.deepEqual(bundles.find((bundle) => bundle.key === "john-the-baptist").wardrobeAssets.map((asset) => asset.id), ["ward-john-the-baptist-hide"]);
});

test("stale active versions are not presented as current character references", () => {
  const stale = {
    ...visual("character-stale", "Stale"),
    activeVersionCurrent: false
  };
  assert.equal(activeAssetVersion(stale), null);
  assert.equal(activeAssetFile(stale), null);
});

test("API-reported exact imports retain hash provenance and attach by existing asset ID", () => {
  const character = visual("character-jesus", "Jesus");
  const voice = related("voice-jesus", "Jesus", "voice");
  const exactSource = {
    id: "audacity_exact",
    fileName: "unrelated recording.wav",
    characterKey: "unrelated",
    suggested: false,
    sha256: "a".repeat(64),
    alreadyImported: true,
    existingAssetId: voice.id,
    existingAssetName: "Jesus Voice",
    existingVersion: 2
  };
  const state = sourceImportState(exactSource);
  assert.deepEqual(state, {
    alreadyImported: true,
    suggested: false,
    existingAssetId: "voice-jesus",
    existingAssetName: "Jesus Voice",
    existingVersion: 2,
    sha256: "a".repeat(64)
  });
  const [bundle] = buildCharacterBundles([character, voice], [exactSource]);
  assert.deepEqual(bundle.recordings.map((source) => source.id), ["audacity_exact"]);
});

test("unsuggested unmatched recordings remain outside all character bibles", () => {
  const character = visual("character-adam", "Adam");
  const sources = [{ id: "no-match", fileName: "Adam.wav", characterKey: "adam", suggested: false }];
  const [bundle] = buildCharacterBundles([character], sources);
  assert.equal(bundle.recordings.length, 0);
});

test("the Character tab is a stable deep link without stealing Asset Library category queries", () => {
  assert.equal(resolveProductionRoute("/assets/characters"), "/assets/characters");
  assert.equal(resolveProductionRoute("/assets/library?category=character"), "/assets/library");
  assert.equal(resolveProductionRoute("/assets?category=character", { assetsTab: "characters" }), "/assets/characters");
});
