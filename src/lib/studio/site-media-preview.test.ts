import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { PRODIGAL_SON_PICTURE_ID } from "./prodigal-son.ts";
import { resolveSiteImageUri, resolveSiteStillPreview, type BundledScenePreview } from "./site-media-preview.ts";

const originalStarter = "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH001_START-a9d5f761c6c5.png";
const starterPreview = "/pictures/prodigal-son/previews/bundled/known-shot-one.webp";
const correction = "/pictures/prodigal-son/generated-assets/corrections/PS-LOC-TERRACE-a06450b3d499.png";
const correctedPreview = "/pictures/prodigal-son/previews/bundled/known-terrace-correction.webp";
const frame: BundledScenePreview = {
  source: "public/pictures/prodigal-son/frames/PS-S01/PS-S01-SH001_LAST-7e1a503721cc.png",
  preview: "/pictures/prodigal-son/previews/PS-S01-SH001-LAST.webp",
  scene: "S01", shot: "SH001", endpoint: "last", description: "The same shot at its last frame",
};
const mediaMap = { [originalStarter]: starterPreview, [correction]: correctedPreview };

test("a bundled starter displays only its own recovered bytes, never the other endpoint", () => {
  assert.deepEqual(resolveSiteStillPreview(PRODIGAL_SON_PICTURE_ID, originalStarter, [frame], mediaMap), { uri: starterPreview, kind: "starting image" });
  assert.equal(resolveSiteStillPreview(PRODIGAL_SON_PICTURE_ID, "/pictures/prodigal-son/director/starting-images/PS-S01/PS-S01-SH002_START-missing.png", [frame], mediaMap), null);
  assert.deepEqual(resolveSiteStillPreview(PRODIGAL_SON_PICTURE_ID, `/${frame.source.replace(/^public\//, "")}`, [frame], mediaMap), { uri: frame.preview, kind: "last frame" });
});

test("an approved correction uses only its exact recovered preview; missing bundled originals stay unavailable", () => {
  assert.equal(resolveSiteImageUri(PRODIGAL_SON_PICTURE_ID, correction, mediaMap), correctedPreview);
  assert.equal(resolveSiteImageUri(PRODIGAL_SON_PICTURE_ID, "/pictures/prodigal-son/generated-assets/corrections/another-asset.png", mediaMap), null);
  assert.equal(resolveSiteImageUri(PRODIGAL_SON_PICTURE_ID, "/pictures/prodigal-son/previews/PS-LOC-TERRACE.webp", mediaMap), "/pictures/prodigal-son/previews/PS-LOC-TERRACE.webp");
  assert.equal(resolveSiteImageUri("another-picture", "/pictures/user-image.png", mediaMap), "/pictures/user-image.png");
});

test("recovered original starters and corrected location assets have real exact-match Site previews", () => {
  const mapping = JSON.parse(readFileSync(new URL("../../../public/pictures/prodigal-son/previews/bundled-media-map.json", import.meta.url), "utf8")) as Record<string, string>;
  for (const source of [
    originalStarter,
    correction,
    "/pictures/prodigal-son/generated-assets/corrections/PS-LOC-COURTYARD-e287a6f3ba45.png",
    "/pictures/prodigal-son/generated-assets/corrections/PS-LOC-SUPPER-da9f090536e2.png",
  ]) {
    const preview = resolveSiteImageUri(PRODIGAL_SON_PICTURE_ID, source, mapping);
    assert.match(preview ?? "", /^\/pictures\/prodigal-son\/previews\/bundled\/[a-f0-9]+\.webp$/);
    const bytes = readFileSync(new URL(`../../../public${preview}`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", source);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", source);
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, source);
    assert.ok(statSync(new URL(`../../../public${preview}`, import.meta.url)).size > 100, source);
  }
});
