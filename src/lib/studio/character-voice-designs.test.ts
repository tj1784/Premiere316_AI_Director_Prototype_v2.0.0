import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { allCharacterVoiceIterations, attachVoiceDesignAsset, characterVoiceDesigns, copyCharacterVoiceIteration, deleteCharacterVoiceIteration, hydrateProdigalCharacterVoices, reviewCharacterVoiceDesign, selectedCharacterVoice, validateCharacterVoiceManifest, type CharacterVoiceDesignManifest } from "./character-voice-designs.ts";
import { BIBLICAL_VOICE_DESIGN, createVoiceDesignAsset } from "./voice-design-library.ts";
import { PRODIGAL_VOICE_DESIGNS } from "./bundled-pictures/prodigal-son/voices.ts";

function fixture(): CharacterVoiceDesignManifest {
  const picture = makeProdigalSonPicture();
  const profile = {
    id: "father:main", characterId: picture.characters[0].id, name: "Father", role: "Father", designPrompt: "A warm, low adult voice with patient pacing.",
    sampleText: "My son has returned.", textKind: "audition" as const, sceneIds: ["PS-S15"],
    sample: { id: "sample:father", mediaUri: "/pictures/prodigal-son/voice-designs/father.wav", sha256: "a".repeat(64), bytes: 240_044, durationSec: 5, sampleRate: 24000, generatedAt: 1789400000000, seed: 312 },
  };
  return { schemaVersion: 1, id: "voice-batch-1", pictureId: picture.id, screenplaySha256: "b44704444023df54cc940ad2a619ecda68ee6b35eec650284ef509da2c6f3b32", modelId: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", profiles: [profile] };
}

test("generated voices attach to existing character sheets pending user review without changing approvals or voice assignments", () => {
  const picture = makeProdigalSonPicture();
  picture.characters[0].voiceId = "user-approved-voice";
  const before = structuredClone(picture);
  const next = hydrateProdigalCharacterVoices(picture, fixture());
  assert.equal(next.characterVoiceDesigns?.profiles.length, 1);
  assert.equal(next.characterVoiceDesigns?.profiles[0].status, "NEEDS_REVIEW");
  assert.equal(next.characterVoiceDesigns?.profiles[0].reviewedAt, null);
  assert.strictEqual(next.production, picture.production);
  assert.strictEqual(next.characters, picture.characters);
  assert.strictEqual(next.audio, picture.audio);
  assert.deepEqual(picture, before);
  assert.equal(next.characters[0].voiceId, "user-approved-voice");
});

test("approval, rejection, and return to review survive JSON persistence and repeated manifest merges", () => {
  let next = hydrateProdigalCharacterVoices(makeProdigalSonPicture(), fixture());
  const id = next.characterVoiceDesigns!.profiles[0].attachmentId;
  next = reviewCharacterVoiceDesign(next, id, "APPROVED", 100);
  const restored = JSON.parse(JSON.stringify(next));
  assert.strictEqual(hydrateProdigalCharacterVoices(restored, fixture()), restored);
  assert.equal(restored.characterVoiceDesigns.profiles[0].status, "APPROVED");
  next = reviewCharacterVoiceDesign(restored, id, "REJECTED", 200);
  assert.equal(hydrateProdigalCharacterVoices(next, fixture()).characterVoiceDesigns!.profiles[0].status, "REJECTED");
  assert.equal(next.characterVoiceDesigns!.profiles[0].reviewedAt, 200);
  next = reviewCharacterVoiceDesign(next, id, "NEEDS_REVIEW", 300);
  assert.equal(next.characterVoiceDesigns!.profiles[0].reviewedAt, null);
  assert.throws(() => reviewCharacterVoiceDesign(next, "missing", "APPROVED"), /not found/);
});

test("new audio versions retain older approvals and multiple people can share one sheet", () => {
  const manifest = fixture();
  let next = hydrateProdigalCharacterVoices(makeProdigalSonPicture(), manifest);
  next = reviewCharacterVoiceDesign(next, next.characterVoiceDesigns!.profiles[0].attachmentId, "APPROVED");
  const revised = structuredClone(manifest);
  revised.profiles[0].sample.sha256 = "b".repeat(64);
  revised.profiles[0].sample.mediaUri = "/pictures/prodigal-son/voice-designs/father-v2.wav";
  revised.profiles.push({ ...structuredClone(revised.profiles[0]), id: "group:member-b", name: "Member B" });
  next = hydrateProdigalCharacterVoices(next, revised);
  assert.deepEqual(next.characterVoiceDesigns!.profiles.map((profile) => profile.status), ["APPROVED", "NEEDS_REVIEW", "NEEDS_REVIEW"]);
  assert.equal(characterVoiceDesigns(next, manifest.profiles[0].characterId).length, 3);
  assert.equal(next.characters.length, makeProdigalSonPicture().characters.length);
});

test("an alias reuses audio bytes but keeps an independent review on its existing sheet", () => {
  const manifest = fixture();
  const picture = makeProdigalSonPicture();
  const source = manifest.profiles[0];
  manifest.profiles.push({ ...structuredClone(source), id: "listeners:member-b", characterId: picture.characters[1].id, name: "Listener B", aliasOf: source.id });
  assert.deepEqual(validateCharacterVoiceManifest(manifest), []);
  const next = hydrateProdigalCharacterVoices(picture, manifest);
  assert.equal(next.characterVoiceDesigns!.profiles.length, 2);
  assert.equal(new Set(next.characterVoiceDesigns!.profiles.map((profile) => profile.sample.mediaUri)).size, 1);
  const reviewed = reviewCharacterVoiceDesign(next, next.characterVoiceDesigns!.profiles[0].attachmentId, "APPROVED");
  assert.equal(reviewed.characterVoiceDesigns!.profiles[1].status, "NEEDS_REVIEW");
});

test("unrelated screenplays, deleted characters and invalid media cannot acquire candidates", () => {
  const manifest = fixture();
  let picture = makeProdigalSonPicture();
  picture.id = "different-picture";
  assert.strictEqual(hydrateProdigalCharacterVoices(picture, manifest), picture);
  picture = makeProdigalSonPicture();
  picture.screenplay.versions.find((version) => version.id === picture.screenplay.approvedVersionId)!.fountain += "\nUser rewrite.";
  assert.strictEqual(hydrateProdigalCharacterVoices(picture, manifest), picture);
  picture = makeProdigalSonPicture();
  picture.production!.assets.find((asset) => asset.id === manifest.profiles[0].characterId)!.tombstone = true;
  assert.strictEqual(hydrateProdigalCharacterVoices(picture, manifest), picture);
  manifest.profiles[0].sample.mediaUri = "file:///C:/unrelated.wav";
  assert.ok(validateCharacterVoiceManifest(manifest).length);
  assert.strictEqual(hydrateProdigalCharacterVoices(makeProdigalSonPicture(), manifest).characterVoiceDesigns, undefined);
});

test("bundled generated samples match durable WAV bytes, SHA-256 and the approved source", () => {
  assert.deepEqual(validateCharacterVoiceManifest(PRODIGAL_VOICE_DESIGNS), []);
  const picture = makeProdigalSonPicture();
  const approved = picture.screenplay.versions.find((version) => version.id === picture.screenplay.approvedVersionId)!;
  assert.equal(createHash("sha256").update(approved.fountain).digest("hex"), PRODIGAL_VOICE_DESIGNS.screenplaySha256);
  for (const profile of PRODIGAL_VOICE_DESIGNS.profiles) {
    const bytes = readFileSync(new URL(`../../../public${profile.sample.mediaUri}`, import.meta.url));
    assert.equal(bytes.length, profile.sample.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), profile.sample.sha256);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  }
  const next = hydrateProdigalCharacterVoices(picture);
  assert.equal(next.characterVoiceDesigns?.profiles.length ?? 0, PRODIGAL_VOICE_DESIGNS.profiles.length);
});

test("approving an imported iteration replaces the character's previous generated selection, independently of other characters", () => {
  let picture = hydrateProdigalCharacterVoices(makeProdigalSonPicture(), fixture());
  const original = allCharacterVoiceIterations(picture)[0];
  picture = reviewCharacterVoiceDesign(picture, original.id, "APPROVED", 10);
  const asset = createVoiceDesignAsset(BIBLICAL_VOICE_DESIGN, "library-1", picture.id, {
    mediaUri: "data:audio/wav;base64,YWJj", filename: "audition.wav", bytes: 3, sha256: createHash('sha256').update('abc').digest('hex'),
    referenceText: BIBLICAL_VOICE_DESIGN.referenceText, origin: "imported",
  });
  picture = attachVoiceDesignAsset(picture, original.characterId, asset, "imported-1");
  const otherId = picture.characters.find((character) => character.id !== original.characterId)!.id;
  picture = attachVoiceDesignAsset(picture, otherId, asset, "other-character");
  picture = reviewCharacterVoiceDesign(picture, "other-character", "APPROVED", 20);
  picture = reviewCharacterVoiceDesign(picture, "imported-1", "APPROVED", 30);
  assert.equal(selectedCharacterVoice(picture, original.characterId)?.id, "imported-1");
  assert.equal(picture.characters.find((character) => character.id === original.characterId)?.voiceId, "imported-1");
  assert.equal(allCharacterVoiceIterations(picture).find((item) => item.id === original.id)?.status, "NEEDS_REVIEW");
  assert.equal(selectedCharacterVoice(picture, otherId)?.id, "other-character");
  assert.equal(allCharacterVoiceIterations(picture).filter((item) => item.characterId === original.characterId && item.status === "APPROVED").length, 1);
  const restored = hydrateProdigalCharacterVoices(JSON.parse(JSON.stringify(picture)), fixture());
  assert.equal(selectedCharacterVoice(restored, original.characterId)?.id, "imported-1");
});

test("deleting a bundled voice is durable and clears its approval without changing shared source audio", () => {
  let picture = hydrateProdigalCharacterVoices(makeProdigalSonPicture(), fixture());
  const original = allCharacterVoiceIterations(picture)[0];
  const otherId = picture.characters.find((character) => character.id !== original.characterId)!.id;
  picture = copyCharacterVoiceIteration(picture, otherId, picture, original.id, "copy-1");
  picture = reviewCharacterVoiceDesign(picture, original.id, "APPROVED");
  picture = deleteCharacterVoiceIteration(picture, original.id);
  assert.equal(selectedCharacterVoice(picture, original.characterId), undefined);
  assert.equal(picture.characters.find((character) => character.id === original.characterId)?.voiceId, "");
  const restored = hydrateProdigalCharacterVoices(JSON.parse(JSON.stringify(picture)), fixture());
  assert.equal(allCharacterVoiceIterations(restored).some((item) => item.id === original.id), false);
  assert.equal(allCharacterVoiceIterations(restored).find((item) => item.id === "copy-1")?.audio?.mediaUri, original.audio?.mediaUri);
  assert.equal(restored.characterVoiceDesigns?.deletedAttachmentIds?.includes(original.id), true);
});

test("cross-character reuse copies exact audio and transcript with independent approval and deletion", () => {
  let source = hydrateProdigalCharacterVoices(makeProdigalSonPicture(), fixture());
  const original = allCharacterVoiceIterations(source)[0];
  source = reviewCharacterVoiceDesign(source, original.id, "APPROVED");
  const before = structuredClone(source);
  let target = structuredClone(source);
  target.id = "another-picture";
  const targetId = target.characters.find((character) => character.id !== original.characterId)!.id;
  target = copyCharacterVoiceIteration(target, targetId, source, original.id, "borrowed-1");
  const copied = allCharacterVoiceIterations(target).find((item) => item.id === "borrowed-1")!;
  assert.equal(copied.status, "NEEDS_REVIEW");
  assert.deepEqual(copied.audio, original.audio);
  assert.equal(copied.referenceText, original.referenceText);
  assert.deepEqual(copied.source, { pictureId: source.id, characterId: original.characterId, iterationId: original.id });
  target = reviewCharacterVoiceDesign(target, copied.id, "APPROVED");
  target = deleteCharacterVoiceIteration(target, copied.id);
  assert.equal(selectedCharacterVoice(target, targetId), undefined);
  assert.deepEqual(source, before);
});

test("a character with no samples can save designs, but design-only drafts cannot be approved", () => {
  const picture = makeProdigalSonPicture();
  const characterId = picture.characters[0].id;
  const asset = createVoiceDesignAsset(BIBLICAL_VOICE_DESIGN, "draft", picture.id);
  const next = attachVoiceDesignAsset(picture, characterId, asset, "draft-iteration");
  assert.equal(allCharacterVoiceIterations(next)[0].status, "DRAFT");
  assert.throws(() => reviewCharacterVoiceDesign(next, "draft-iteration", "APPROVED"), /Import an audio/);
  assert.throws(() => attachVoiceDesignAsset(next, "missing", asset, "bad"), /character profile/);
  assert.throws(() => copyCharacterVoiceIteration(next, characterId, next, "missing", "bad"), /no longer available/);
  assert.equal(allCharacterVoiceIterations(deleteCharacterVoiceIteration(next, "draft-iteration")).length, 0);
});

test("ensemble members keep independent approvals and changed media invalidates selection", () => {
 const manifest=fixture(), first=manifest.profiles[0];
 manifest.profiles=[{...first,id:'member-a',memberLabel:'A'},{...first,id:'member-b',memberLabel:'B',sample:{...first.sample,sha256:'b'.repeat(64)}}];
 let p=hydrateProdigalCharacterVoices(makeProdigalSonPicture(),manifest);
 const [a,b]=allCharacterVoiceIterations(p);
 p=reviewCharacterVoiceDesign(p,a.id,'APPROVED',100);
 p=reviewCharacterVoiceDesign(p,b.id,'APPROVED',101);
 assert.equal(selectedCharacterVoice(p,a.characterId,'member:A')?.id,a.id);
 assert.equal(selectedCharacterVoice(p,b.characterId,'member:B')?.id,b.id);
 assert.equal(selectedCharacterVoice(p,a.characterId),undefined);
 p=JSON.parse(JSON.stringify(p));
 p.characterVoiceDesigns!.profiles[0].sample.sha256='c'.repeat(64);
 assert.equal(selectedCharacterVoice(p,a.characterId,'member:A'),undefined);
 assert.equal(selectedCharacterVoice(p,b.characterId,'member:B')?.id,b.id);
});
