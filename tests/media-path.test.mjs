import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveProjectMediaFile } from "../server/media-path.js";

test("resolves flat and chapter-grouped project media files", () => {
  const projectsRoot = path.resolve("C:/tmp/premiere316-projects");

  assert.equal(
    resolveProjectMediaFile(projectsRoot, "harrowing_of_hell", "clips", "clip.mp4"),
    path.join(projectsRoot, "harrowing_of_hell", "media", "clips", "clip.mp4")
  );
  assert.equal(
    resolveProjectMediaFile(projectsRoot, "harrowing_of_hell", "clips", "H01/clip.mp4"),
    path.join(projectsRoot, "harrowing_of_hell", "media", "clips", "H01", "clip.mp4")
  );
});

test("rejects unsupported roots and traversal attempts", () => {
  const projectsRoot = path.resolve("C:/tmp/premiere316-projects");
  const rejected = [
    ["harrowing_of_hell", "unknown", "H01/clip.mp4"],
    ["..", "clips", "H01/clip.mp4"],
    ["harrowing_of_hell", "clips", "../clip.mp4"],
    ["harrowing_of_hell", "clips", "H01/../../clip.mp4"],
    ["harrowing_of_hell", "clips", "H01\\clip.mp4"],
    ["harrowing_of_hell", "clips", ""]
  ];

  for (const [slug, kind, file] of rejected) {
    assert.equal(resolveProjectMediaFile(projectsRoot, slug, kind, file), null);
  }
});
