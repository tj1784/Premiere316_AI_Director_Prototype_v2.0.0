import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  characterAssetKey,
  characterVoiceKey,
  findCharacterVoiceAsset,
  findImportedVoiceSource,
  listAudacityVoiceSources,
  resolveAudacityVoiceSource
} from "../server/character-voices.js";

test("character voice names normalize without guessing numbered takes", () => {
  assert.equal(characterVoiceKey("ADAM - FIRST MAN FREED3.wav"), "adam");
  assert.equal(characterVoiceKey("EVE — VOICE DESIGN2.wav"), "eve");
  assert.equal(characterVoiceKey("EVE â VOICE DESIGN2.wav"), "eve");
  assert.equal(characterVoiceKey("GUARDIAN LEADER - HELL'S CHAMPION.wav"), "guardian-leader");
  assert.equal(characterAssetKey({ category: "wardrobe", name: "Adam Wardrobe" }), "adam");
});

test("Audacity discovery exposes audio, not opaque project databases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-voices-"));
  try {
    fs.writeFileSync(path.join(root, "ADAM - FIRST MAN FREED2.wav"), Buffer.from("RIFF-test"));
    fs.writeFileSync(path.join(root, "ADAM.aup3"), Buffer.from("sqlite"));
    fs.writeFileSync(path.join(root, "notes.txt"), Buffer.from("ignore"));
    const catalog = listAudacityVoiceSources({ root });
    assert.equal(catalog.sources.length, 1);
    assert.equal(catalog.sources[0].characterKey, "adam");
    assert.match(catalog.sources[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(catalog.unsupportedProjects.length, 1);
    assert.equal(resolveAudacityVoiceSource(catalog.sources[0].id, { root })?.fileName, "ADAM - FIRST MAN FREED2.wav");
    assert.equal(resolveAudacityVoiceSource("missing", { root }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exact Audacity hashes resolve to immutable existing versions", () => {
  const source = { sha256: "a".repeat(64) };
  const version = { v: 3, file: "voice-adam.v3.wav", fileHashes: [{ file: "voice-adam.v3.wav", sha256: source.sha256 }] };
  const voice = { id: "voice-adam", category: "voice", name: "Adam", versions: [version] };
  const match = findImportedVoiceSource({ assets: { items: [voice] } }, source);
  assert.equal(match?.asset, voice);
  assert.equal(match?.version, version);
  assert.equal(findImportedVoiceSource({ assets: { items: [voice] } }, { sha256: "b".repeat(64) }), null);
});

test("voice targets are exact project voice assets", () => {
  const character = { id: "character-adam", category: "character", name: "ADAM - First Man Freed" };
  const voice = { id: "voice-adam", category: "voice", name: "ADAM - First Man Freed" };
  const project = { assets: { items: [character, voice, { id: "ward-adam", category: "wardrobe", name: "Adam Wardrobe" }] } };
  assert.equal(findCharacterVoiceAsset(project, character)?.id, voice.id);
  assert.equal(findCharacterVoiceAsset(project, character, voice.id)?.id, voice.id);
  assert.throws(() => findCharacterVoiceAsset(project, character, "ward-adam"), /not a project voice asset/);
});
