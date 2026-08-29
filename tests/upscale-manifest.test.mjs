import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SOURCE_TAKE_REQUIRED,
  buildUpscaleManifest,
  listApprovedSourceTakes,
  normalizeSourceTake,
  resolveApprovedSourceTake
} from "../client/src/upscale-manifest.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_TAKE = Object.freeze({
  projectSlug: "fixture-project",
  clipId: "clip-opener",
  takeVersion: { kind: "full", v: 2 },
  file: "opener_v02.mp4",
  fingerprints: { sha256: "a".repeat(64) }
});

function assertRouting(manifest, expected) {
  assert.equal(manifest.pipeline_routing.primary_engine, expected.primary);
  assert.equal(manifest.pipeline_routing.motion_engine, expected.motion);
  assert.deepEqual(manifest.pipeline_routing.preprocess_filters, expected.filters);
  assert.equal(manifest.parameters.upscale_factor, expected.upscale);
  assert.equal(manifest.parameters.denoise_strength, expected.denoise);
  if ("fps" in expected) assert.equal(manifest.parameters.target_fps, expected.fps);
  assert.equal(manifest.parameters.generative_fidelity, expected.fidelity);
  assert.equal(manifest.director_metadata.hardware_safety_tier, expected.safety);
}

test("upscale manifest routes degraded restoration to SUPIR with safe 4x cap", () => {
  const manifest = buildUpscaleManifest("Take this blurry old 480p movie clip, clean up the heavy compression blockiness, blow it up to 4K, and make the character faces look incredibly sharp and real.", SOURCE_TAKE);
  assertRouting(manifest, {
    primary: "SUPIR",
    motion: "None",
    filters: ["Denoise_Deartifact"],
    upscale: 4,
    denoise: 0.85,
    fps: null,
    fidelity: 0.75,
    safety: "Extreme_VRAM"
  });
  assert.deepEqual(manifest.source_take, SOURCE_TAKE);
});

test("upscale manifest routes gameplay fps conversion to Real_ESRGAN plus interpolation", () => {
  const manifest = buildUpscaleManifest("Convert this 1080p gameplay footage to a smooth 60fps and sharpen up the text overlays quickly without changing the art style.", SOURCE_TAKE);
  assertRouting(manifest, {
    primary: "Real_ESRGAN",
    motion: "Frame_Interpolation",
    filters: [],
    upscale: 2,
    denoise: 0,
    fps: 60,
    fidelity: 0.1,
    safety: "Performance"
  });
  assert.equal(manifest.source_take.clipId, SOURCE_TAKE.clipId);
  assert.equal(manifest.source_take.file, SOURCE_TAKE.file);
});

test("upscale manifest supports preprocess-only directives", () => {
  const manifest = buildUpscaleManifest("Denoise the low-light grain and color correct the washed out contrast.", SOURCE_TAKE);
  assertRouting(manifest, {
    primary: "None",
    motion: "None",
    filters: ["Denoise_Deartifact", "Color_Correction"],
    upscale: 1,
    denoise: 0.55,
    fidelity: 0,
    safety: "Standard"
  });
});

test("upscale plan refuses to emit without one exact source take", () => {
  assert.throws(() => buildUpscaleManifest("upscale 2x"), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", null), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", {}), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, file: "" }), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, clipId: " " }), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, projectSlug: "" }), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, takeVersion: null }), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, takeVersion: 1.5 }), { message: SOURCE_TAKE_REQUIRED });
  assert.throws(() => buildUpscaleManifest("upscale 2x", { ...SOURCE_TAKE, takeVersion: { kind: "full", v: 0 } }), { message: SOURCE_TAKE_REQUIRED });
});

test("upscale plan binds downloaded JSON to the supplied source take identity", () => {
  const rangeTake = {
    projectSlug: "harrowing_of_hell",
    clipId: "h01-s01-c02",
    takeVersion: { kind: "range", v: 3, startFrame: 0, endFrame: 48 },
    file: "h01_s01_c02_range_v03.mp4"
  };
  const manifest = buildUpscaleManifest("upscale 2x", rangeTake);
  assert.deepEqual(manifest.source_take, normalizeSourceTake(rangeTake));
  assert.equal(manifest.source_take.takeVersion.kind, "range");
  assert.equal(manifest.source_take.takeVersion.v, 3);
  assert.equal(manifest.source_take.takeVersion.startFrame, 0);
  assert.equal(manifest.source_take.takeVersion.endFrame, 48);
  assert.equal("fingerprints" in manifest.source_take, false);
});

test("range source identities require ordered nonnegative integer frame bounds", () => {
  const invalidVersions = [
    { kind: "range", v: 1, startFrame: -1, endFrame: 24 },
    { kind: "range", v: 1, startFrame: 0.5, endFrame: 24 },
    { kind: "range", v: 1, startFrame: 0, endFrame: 24.5 },
    { kind: "range", v: 1, startFrame: 12, endFrame: 12 },
    { kind: "range", v: 1, startFrame: 24, endFrame: 12 },
    { kind: "range", v: 1, startFrame: 0 },
    "range-v1"
  ];
  for (const takeVersion of invalidVersions) {
    const sourceTake = { ...SOURCE_TAKE, takeVersion };
    assert.equal(normalizeSourceTake(sourceTake), null);
    assert.throws(() => buildUpscaleManifest("upscale 2x", sourceTake), { message: SOURCE_TAKE_REQUIRED });
  }
  assert.deepEqual(normalizeSourceTake({
    ...SOURCE_TAKE,
    takeVersion: { kind: "range", v: 2, startFrame: "0", endFrame: "24" }
  })?.takeVersion, { kind: "range", v: 2, startFrame: 0, endFrame: 24 });
});

test("source take versions accept a numeric full v", () => {
  const manifest = buildUpscaleManifest("sharpen", {
    projectSlug: "fixture-project",
    clipId: "clip-opener",
    takeVersion: 4,
    file: "opener_v04.mp4"
  });
  assert.deepEqual(manifest.source_take.takeVersion, { kind: "full", v: 4 });
});

test("source take identity accepts assetVersion and root-level fingerprints", () => {
  const sha256 = "c".repeat(64);
  const manifest = buildUpscaleManifest("sharpen", {
    projectSlug: "fixture-project",
    clipId: "clip-opener",
    assetVersion: 5,
    file: "opener_v05.mp4",
    sha256,
    fileHashes: [{ file: "opener_v05.mp4", sha256 }]
  });
  assert.deepEqual(manifest.source_take.takeVersion, { kind: "full", v: 5 });
  assert.equal(manifest.source_take.fingerprints.sha256, sha256);
  assert.equal(manifest.source_take.fingerprints.fileHashes[0].sha256, sha256);
});

test("resolveApprovedSourceTake picks the clip activeVersion take", () => {
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [{
        id: "clip-opener",
        status: "done",
        activeVersion: 2,
        versions: [
          { v: 1, file: "opener_v01.mp4" },
          { v: 2, file: "opener_v02.mp4", sha256: "b".repeat(64) }
        ],
        rangeVersions: [{ v: 9, file: "opener_range_v09.mp4", active: true, startFrame: 0, endFrame: 24 }]
      }]
    }
  };
  assert.deepEqual(resolveApprovedSourceTake(project, "clip-opener"), {
    projectSlug: "fixture-project",
    clipId: "clip-opener",
    takeVersion: { kind: "full", v: 2 },
    file: "opener_v02.mp4",
    fingerprints: { sha256: "b".repeat(64) }
  });
});

test("resolveApprovedSourceTake uses the active range version for an explicit clip", () => {
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [{
        id: "clip-stairs",
        status: "ranges-ready",
        activeVersion: 0,
        versions: [{ v: 1, file: "" }],
        rangeVersions: [
          { v: 1, file: "stairs_range_v01.mp4", active: false, startFrame: 0, endFrame: 12 },
          { v: 4, file: "stairs_range_v04.mp4", active: true, startFrame: 12, endFrame: 36 }
        ]
      }]
    }
  };
  assert.deepEqual(resolveApprovedSourceTake(project, "clip-stairs"), {
    projectSlug: "fixture-project",
    clipId: "clip-stairs",
    takeVersion: { kind: "range", v: 4, startFrame: 12, endFrame: 36 },
    file: "stairs_range_v04.mp4"
  });
});

test("resolveApprovedSourceTake skips a malformed range and binds the valid active range", () => {
  const sha256 = "d".repeat(64);
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [{
        id: "clip-stairs",
        status: "ranges-ready",
        activeVersion: 0,
        versions: [],
        rangeVersions: [
          { file: "stairs_poison.mp4", active: true, createdAt: "2099-01-01T00:00:00.000Z" },
          { v: 2, file: "stairs_range_v02.mp4", active: true, startFrame: 0, endFrame: 24, fileHashes: [{ file: "stairs_range_v02.mp4", sha256 }] }
        ]
      }]
    }
  };
  assert.deepEqual(resolveApprovedSourceTake(project, "clip-stairs"), {
    projectSlug: "fixture-project",
    clipId: "clip-stairs",
    takeVersion: { kind: "range", v: 2, startFrame: 0, endFrame: 24 },
    file: "stairs_range_v02.mp4",
    fingerprints: { sha256, fileHashes: [{ file: "stairs_range_v02.mp4", sha256 }] }
  });
});

test("Upscale Plan workspace stays a plan: named Upscale Plan, banner, no executor", () => {
  const workspace = fs.readFileSync(path.join(ROOT, "client/src/components/UpscaleWorkspace.tsx"), "utf8");
  assert.match(workspace, /<h1>Upscale Plan<\/h1>/);
  assert.match(workspace, /Execution handoff not connected\./);
  assert.equal(workspace.match(/Execution handoff not connected\./g)?.length, 1);
  assert.match(workspace, /SOURCE_TAKE_REQUIRED/);
  assert.match(workspace, /listApprovedSourceTakes/);
  assert.match(workspace, /Choose an exact approved clip \/ take/);
  assert.match(workspace, /const \[selectedTakeKey, setSelectedTakeKey\] = useState\(""\)/);
  assert.doesNotMatch(workspace, /queueUpscale|runUpscale|executeUpscale|startUpscale/);
  assert.doesNotMatch(workspace, /upscale-manifest\.json/);
  assert.doesNotMatch(workspace, /productionInSequence/);
});

test("approved source take choices expose exact versions and reject unapproved or malformed records", () => {
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [
        {
          id: "clip-a",
          status: "done",
          activeVersion: 2,
          versions: [
            { v: 1, file: "a_v01.mp4", approved: true },
            { v: 2, file: "a_v02.mp4" },
            { v: 3, file: "a_v03.mp4" }
          ],
          rangeVersions: [
            { v: 4, file: "a_range_v04.mp4", active: true, startFrame: 0, endFrame: 24 },
            { v: 5, file: "a_bad_range_v05.mp4", active: true, startFrame: -1, endFrame: 24 }
          ]
        },
        {
          id: "clip-b",
          status: "ready",
          activeVersion: 1,
          versions: [
            { v: 1, file: "b_v01.mp4" },
            { v: 2, file: "b_v02.mp4", approvalStatus: "approved" }
          ],
          rangeVersions: []
        }
      ]
    }
  };

  const choices = listApprovedSourceTakes(project);
  assert.deepEqual(choices.map((take) => [take.clipId, take.takeVersion.kind, take.takeVersion.v]), [
    ["clip-a", "full", 1],
    ["clip-a", "full", 2],
    ["clip-a", "range", 4],
    ["clip-b", "full", 2]
  ]);
  assert.equal(choices.some((take) => take.file === "a_v03.mp4"), false);
  assert.equal(choices.some((take) => take.file === "a_bad_range_v05.mp4"), false);

  assert.deepEqual(resolveApprovedSourceTake(project, "clip-a", { kind: "full", v: 1 }), choices[0]);
  assert.deepEqual(resolveApprovedSourceTake(project, "clip-a", {
    kind: "range",
    v: 4,
    startFrame: 0,
    endFrame: 24
  }), choices[2]);
  assert.equal(resolveApprovedSourceTake(project, "clip-a", { kind: "full", v: 3 }), null);
  assert.equal(resolveApprovedSourceTake(project, "clip-a", { kind: "range", v: 4 }), null);
});

test("resolveApprovedSourceTake returns null when the current clip has no approved take", () => {
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [
        { id: "clip-empty", versions: [], rangeVersions: [] },
        {
          id: "clip-ready",
          activeVersion: 1,
          status: "ready",
          versions: [{ v: 1, file: "ready_v01.mp4" }]
        }
      ]
    }
  };
  assert.equal(resolveApprovedSourceTake(project, "clip-empty"), null);
  assert.equal(resolveApprovedSourceTake(project, "missing"), null);
  assert.equal(resolveApprovedSourceTake(project), null);
  assert.equal(resolveApprovedSourceTake({ slug: "fixture-project", sequence: { clips: [] } }), null);
});

test("resolveApprovedSourceTake accepts explicit take approval without a done clip status", () => {
  const project = {
    slug: "fixture-project",
    sequence: {
      clips: [{
        id: "clip-reviewed",
        status: "ready",
        activeVersion: 3,
        versions: [{ v: 3, file: "reviewed_v03.mp4", approvalStatus: "approved" }],
        rangeVersions: []
      }]
    }
  };
  assert.deepEqual(resolveApprovedSourceTake(project, "clip-reviewed"), {
    projectSlug: "fixture-project",
    clipId: "clip-reviewed",
    takeVersion: { kind: "full", v: 3 },
    file: "reviewed_v03.mp4"
  });
});
