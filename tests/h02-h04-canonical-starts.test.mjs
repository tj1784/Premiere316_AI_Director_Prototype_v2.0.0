import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveSegmentStartImage } from "../director-webapp/director-media-paths.mjs";

const root = path.resolve(import.meta.dirname, "..", "projects", "harrowing_of_hell");
const storyboard = JSON.parse(fs.readFileSync(path.join(root, "production", "storyboard.json"), "utf8"));

test("every H02-H04 first segment is bound to canonical_start_frames", () => {
  for (const chapterId of ["H02", "H03", "H04"]) {
    for (const sceneId of storyboard.chapters[chapterId].sceneIds) {
      for (const clipId of storyboard.scenes[sceneId].clipIds) {
        const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
        const first = storyboard.segments[plan.segmentIds[0]];
        const frame = storyboard.frames[first.frameId];
        const active = (frame.generatedVersions || []).find((version) => version.v === frame.activeGeneratedVersion);
        const rel = String(active?.file || frame.generatedInputPath || "").replaceAll("\\", "/");
        assert.match(rel, /canonical_start_frames\//, clipId);
        assert.equal(fs.existsSync(path.join(root, ...rel.split("/"))), true, rel);
        const resolved = resolveSegmentStartImage(root, clipId, 1);
        assert.equal(resolved.source, "canonical");
        assert.equal(resolved.relative, rel);
      }
    }
  }
});

test("every H02-H04 segment has an on-disk starting image", () => {
  let count = 0;
  for (const chapterId of ["H02", "H03", "H04"]) {
    for (const sceneId of storyboard.chapters[chapterId].sceneIds) {
      for (const clipId of storyboard.scenes[sceneId].clipIds) {
        const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
        plan.segmentIds.forEach((segmentId, index) => {
          const start = resolveSegmentStartImage(root, clipId, index + 1);
          assert.ok(start, `${clipId} seg ${index + 1}`);
          assert.equal(fs.existsSync(start.disk), true, start.relative);
          count += 1;
        });
      }
    }
  }
  assert.equal(count, 178);
});
