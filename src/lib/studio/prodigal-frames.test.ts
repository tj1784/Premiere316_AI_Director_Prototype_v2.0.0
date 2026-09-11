import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeProdigalSonPicture, hydrateProdigalSonOpeningRevision } from "./prodigal-son.ts";
import { hydrateProdigalSonFrames } from "./prodigal-frames.ts";
import { PRODIGAL_SON_FRAMES } from "./bundled-pictures/prodigal-son/frames.ts";
import type { ProdigalFrameManifest } from "./prodigal-frame-types.ts";
import { generateGateReadiness, nativeVideoLockedForShot } from "../production/generate-gates.ts";

function fixture(): ProdigalFrameManifest {
  return { ...PRODIGAL_SON_FRAMES, revision: "test", assetCorrections: [], shots: [{
    id: "PS-S01-SH001", scene_id: "PS-S01", title: "Opening", duration_seconds: 10, lens_mm: 24,
    camera_motion: "Slow push", first_frame: "Beginning under olive shade.", last_frame: "End under the same olive shade.",
    visible_character_asset_ids: ["PS-CHR-JESUS"], location_asset_id: "PS-LOC-HILLSIDE", reference_filenames: [], continuity_locks: ["One continuous shot"], dialogue_coverage: "No dialogue.",
    frames: {
      first: { mediaUri: "/pictures/prodigal-son/frames/PS-S01/PS-S01-SH001_FIRST-aaaaaaaaaaaa.png", sha256: "a".repeat(64), bytes: 100, width: 2390, height: 1000 },
      last: { mediaUri: "/pictures/prodigal-son/frames/PS-S01/PS-S01-SH001_LAST-bbbbbbbbbbbb.png", sha256: "b".repeat(64), bytes: 100, width: 2390, height: 1000 },
    },
  }] };
}

test("direct frame import populates both shot workspaces and actual frame choices without approving asset inventory", () => {
  const source = makeProdigalSonPicture();
  const imported = hydrateProdigalSonFrames(source, fixture());
  assert.equal(source.shots.length, 0);
  assert.equal(imported.shots.length, 1);
  assert.equal(imported.performance!.shots.length, 1);
  assert.equal(imported.cinematography!.shotPlans.length, 1);
  assert.equal(imported.performance!.shots[0].audio.ambience, undefined);
  assert.equal(imported.generateGates!.iterations.length, 2);
  assert.equal(imported.generateGates!.pairs[0].firstPrompt, fixture().shots[0].first_frame);
  assert.equal(imported.generateGates!.pairs[0].status, "APPROVED");
  assert.equal(nativeVideoLockedForShot(imported, imported.shots[0].id), false);
  assert.equal(imported.production!.assets.filter((asset) => asset.canonicalApproved).length, 0);
  assert.match(generateGateReadiness(imported)[0].reason, /waived by the user/);
  assert.deepEqual(hydrateProdigalSonFrames(imported, fixture()), imported);
});

test("dialogue framing and deliberate exceptions survive the direct import", () => {
  const manifest = fixture();
  manifest.shots[0].lens_mm = 50;
  manifest.shots[0].dialogue_framing = "close_up";
  manifest.shots[0].dialogue_lines = [{ character: "Jesus", text: "A man had two sons." }];
  const imported = hydrateProdigalSonFrames(makeProdigalSonPicture(), manifest);
  assert.equal(imported.shots[0].type, "closeup");
  assert.match(imported.cinematography!.shotPlans[0].focus, /sharp eyes, mouth/);
  assert.deepEqual(imported.performance!.shots[0].audio.dialogue?.map(({ characterId, text }) => ({ characterId, text })), [{ characterId: "PS-CHR-JESUS", text: "A man had two sons." }]);
});

test("direct import retains valid cast, animal and location references without inventing asset approvals", () => {
  const manifest = fixture();
  manifest.shots[0].visible_character_asset_ids.push("PS-CHR-JESUS", "invalid-asset");
  manifest.shots[0].visible_animal_asset_ids = ["PS-ANM-PACKDONKEY"];
  const imported = hydrateProdigalSonFrames(makeProdigalSonPicture(), manifest);
  const pair = imported.generateGates!.pairs[0];
  assert.deepEqual(pair.assetRefIds, ["PS-CHR-JESUS", "PS-ANM-PACKDONKEY", "PS-LOC-HILLSIDE"]);
  assert.equal(Object.keys(pair.assetReferenceVersions!).length, 3);
  const identity = imported.production!.assets.find((asset) => asset.id === "PS-CHR-JESUS")!.iterations[0];
  assert.ok(pair.assetReferenceVersions!["PS-CHR-JESUS"].startsWith(`${identity.id}|`));
  assert.ok(pair.assetReferenceVersions!["PS-CHR-JESUS"].endsWith(identity.mediaUri));
  assert.deepEqual(imported.generateGates!.prompts[0].assetRefIds, pair.assetRefIds);
  assert.equal(imported.production!.assets.filter((asset) => asset.canonicalApproved).length, 0);
  assert.equal(nativeVideoLockedForShot(imported, manifest.shots[0].id), false);
  const reloaded = hydrateProdigalSonFrames(JSON.parse(JSON.stringify(imported)), manifest);
  assert.equal(nativeVideoLockedForShot(reloaded, manifest.shots[0].id), false);
  reloaded.generateGates!.pairs[0].assetRefIds = ["PS-LOC-HILLSIDE"];
  reloaded.generateGates!.pairs[0].assetReferenceVersions = { "PS-LOC-HILLSIDE": pair.assetReferenceVersions!["PS-LOC-HILLSIDE"] };
  const edited = hydrateProdigalSonFrames(reloaded, manifest);
  assert.deepEqual(edited.generateGates!.pairs[0].assetRefIds, ["PS-LOC-HILLSIDE"]);
});

test("directed references still detect a changed selected image and require package-scoped user direction", () => {
  const imported = hydrateProdigalSonFrames(makeProdigalSonPicture(), fixture());
  const withoutDirection = structuredClone(imported);
  delete withoutDirection.generateGates!.pairs[0].referenceAuthorization;
  assert.equal(nativeVideoLockedForShot(withoutDirection, fixture().shots[0].id), true);
  const jesus = imported.production!.assets.find((asset) => asset.id === "PS-CHR-JESUS")!;
  const revised = { ...jesus.iterations[0], id: "new-selected-identity", status: "APPROVED" as const, mediaUri: "/new-selected-identity.png" };
  jesus.iterations.push(revised); jesus.canonicalApproved = true; jesus.approvedIterationId = revised.id;
  assert.equal(nativeVideoLockedForShot(imported, fixture().shots[0].id), true);
});

test("reload preserves user shot edits, alternate frame choices, rejections and removed shots", () => {
  const imported = hydrateProdigalSonFrames(makeProdigalSonPicture(), fixture());
  imported.shots[0].description = "My edited shot";
  imported.shots[0].stillUrl = "/my-own-still.png";
  imported.performance!.shots[0].camera.movementPath = "My camera move";
  imported.generateGates!.iterations[0].status = "REJECTED";
  imported.generateGates!.iterations[0].canonical = false;
  imported.generateGates!.pairs[0].firstApprovedId = "my-choice";
  imported.generateGates!.pairs[0].firstPrompt = "My prompt";
  const reloaded = hydrateProdigalSonFrames(JSON.parse(JSON.stringify(imported)), fixture());
  assert.equal(reloaded.shots[0].description, "My edited shot");
  assert.equal(reloaded.shots[0].stillUrl, "/my-own-still.png");
  assert.equal(reloaded.performance!.shots[0].camera.movementPath, "My camera move");
  assert.equal(reloaded.generateGates!.iterations[0].status, "REJECTED");
  assert.equal(reloaded.generateGates!.pairs[0].firstApprovedId, "my-choice");
  assert.equal(reloaded.generateGates!.pairs[0].firstPrompt, "My prompt");
  reloaded.shots = []; reloaded.performance!.shots = [];
  const afterRemoval = hydrateProdigalSonFrames(reloaded, fixture());
  assert.equal(afterRemoval.shots.length, 0);
  assert.equal(afterRemoval.performance!.shots.length, 0);
});

test("same-ID user shots are not hijacked and separately approved scripts are not overwritten", () => {
  const source = makeProdigalSonPicture();
  source.shots.push({ id: "PS-S01-SH001", sceneId: "PS-S01", index: 1, type: "coverage", description: "User-created", durationSec: 13, camera: "user", lens: "50mm", cameraMove: "static", emotion: "", expression: "", t2iPrompt: "", i2vPrompt: "", t2voicePrompt: "" });
  const imported = hydrateProdigalSonFrames(source, fixture());
  assert.deepEqual(imported.shots, source.shots);
  assert.equal(imported.generateGates!.iterations.length, 0);
  assert.deepEqual(imported.frameBundle!.skippedShotIds, ["PS-S01-SH001"]);
  source.screenplay.approvedVersionId = "my-rewrite";
  assert.equal(hydrateProdigalSonFrames(source, fixture()), source);
});

test("incremental files appear without duplicating the plan or claiming missing frames", () => {
  const partial = fixture(); delete partial.shots[0].frames.last;
  const first = hydrateProdigalSonFrames(makeProdigalSonPicture(), partial);
  assert.equal(first.generateGates!.iterations.length, 1);
  assert.equal(nativeVideoLockedForShot(first, "PS-S01-SH001"), true);
  const complete = hydrateProdigalSonFrames(first, fixture());
  assert.equal(complete.shots.length, 1);
  assert.equal(complete.generateGates!.iterations.length, 2);
  assert.equal(nativeVideoLockedForShot(complete, "PS-S01-SH001"), false);
});

test("a corrected frame revision preserves the selected prior image and adds distinct immutable media", () => {
  const first = hydrateProdigalSonFrames(makeProdigalSonPicture(), fixture());
  const original = first.generateGates!.iterations.find((item) => item.kind === "first")!;
  const updated = fixture();
  updated.revision = "corrected";
  updated.shots[0].frames.first = { ...updated.shots[0].frames.first!, sha256: "c".repeat(64), mediaUri: "/pictures/prodigal-son/frames/PS-S01/PS-S01-SH001_FIRST-cccccccccccc.png" };
  const corrected = hydrateProdigalSonFrames(first, updated);
  assert.equal(corrected.generateGates!.pairs[0].firstApprovedId, original.id);
  assert.deepEqual(corrected.generateGates!.iterations.find((item) => item.id === original.id), original);
  const added = corrected.generateGates!.iterations.find((item) => item.mediaSha256 === "c".repeat(64))!;
  assert.equal(added.mediaUri, updated.shots[0].frames.first.mediaUri);
  assert.notEqual(added.mediaUri, original.mediaUri);
  assert.equal(added.canonical, false);
  assert.equal(corrected.shots[0].stillUrl, original.mediaUri);
});

test("opening migration preserves its original approved version and an unrelated working draft", () => {
  const source = makeProdigalSonPicture();
  const oldId = `${source.id}:user-accepted-import:v1`;
  const approved = source.screenplay.versions.find((version) => version.id === source.screenplay.approvedVersionId)!;
  const original = approved.fountain.replace("A SCRIBE and a PHARISEE remain standing at the edge. Neither man will quite meet the tax collector's eyes.", "A SCRIBE remains standing at the edge. Neither will quite meet the other's eyes.").replace("(low, to the Pharisee)", "(low, to his companion)");
  source.screenplay.versions = [{ ...approved, id: oldId, fountain: original }];
  source.screenplay.approvedVersionId = oldId; source.screenplay.currentVersionId = "my-draft";
  source.screenplay.workingFountain = "My unapproved working draft";
  source.screenplayFountain = original;
  const migrated = hydrateProdigalSonOpeningRevision(source);
  assert.equal(migrated.screenplay.versions.find((version) => version.id === oldId)!.fountain, original);
  assert.equal(migrated.screenplay.workingFountain, "My unapproved working draft");
  assert.equal(migrated.screenplay.currentVersionId, "my-draft");
  assert.match(migrated.screenplayFountain, /A SCRIBE and a PHARISEE/);
  assert.equal(migrated.screenplay.approvedVersionId, fixture().screenplayVersionId);
});

test("every bundled media record names real unchanged bytes and narrative scene totals remain exact", () => {
  const sceneSeconds = new Map<string, number>();
  const ids = new Set<string>();
  for (const shot of PRODIGAL_SON_FRAMES.shots) {
    assert.ok(!ids.has(shot.id), shot.id); ids.add(shot.id);
    assert.notEqual(shot.scene_id, "PS-S23");
    sceneSeconds.set(shot.scene_id, (sceneSeconds.get(shot.scene_id) ?? 0) + shot.duration_seconds);
    for (const media of Object.values(shot.frames)) {
      assert.ok(media.mediaUri.endsWith(`-${media.sha256.slice(0, 12)}.png`));
      const bytes = readFileSync(new URL(`../../..${media.mediaUri.replace("/pictures/", "/public/pictures/")}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), media.sha256);
      assert.equal(bytes.readUInt32BE(16), media.width); assert.equal(bytes.readUInt32BE(20), media.height);
    }
  }
  if (PRODIGAL_SON_FRAMES.shots.length) {
    for (const scene of makeProdigalSonPicture().scenes.filter((scene) => scene.id !== "PS-S23")) assert.equal(sceneSeconds.get(scene.id), scene.durationSec, scene.id);
    assert.equal([...sceneSeconds.values()].reduce((a, b) => a + b, 0), 1770);
  }
});
