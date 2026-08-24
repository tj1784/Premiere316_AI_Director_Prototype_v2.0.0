import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CARRY_FORWARD_ROLES,
  CONTINUITY_GENERATOR,
  CONTINUITY_SOURCE,
  ContinuityError,
  carryForwardReferences,
  lastDecodedFrameIndex,
  promoteLastFrame,
  takeIsMiniMaxGenerator
} from "../server/continuity.js";

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const DECODED_FRAMES = 48;

function references() {
  return [
    { assetId: "character-jesus", assetVersion: 3, role: "identity" },
    { assetId: "wardrobe-jesus", assetVersion: 2, role: "costume" },
    { assetId: "location-garden", assetVersion: 1, role: "location" },
    { assetId: "prop-cup", assetVersion: 1, role: "prop" },
    { assetId: "crowd-soldiers", assetVersion: 1, role: "crowd" },
    { assetId: "vfx-haze", assetVersion: 1, role: "atmosphere" }
  ];
}

function clip(id, extras = {}) {
  return {
    id,
    name: id,
    durationSec: 2,
    status: "done",
    activeVersion: 1,
    versions: [],
    rangeVersions: [],
    guides: [],
    references: [],
    ...extras
  };
}

function storyboardPair() {
  const sourceRefs = references();
  const sourceBindings = Object.fromEntries(sourceRefs.map((binding, index) => {
    const id = `ref-frame-h01-s01-c01-first-${binding.assetId}`;
    return [id, {
      id,
      ...binding,
      role: binding.role,
      targetKind: "frame",
      targetId: "frame-h01-s01-c01-first",
      order: index + 1
    }];
  }));
  return {
    schemaVersion: "premiere316.storyboard.v1",
    projectId: "continuity_fixture",
    chapterOrder: ["H01"],
    chapters: { H01: { id: "H01", sceneIds: ["H01-S01"] } },
    scenes: { "H01-S01": { id: "H01-S01", clipIds: ["H01-S01-C01", "H01-S01-C02"] } },
    clips: {
      "H01-S01-C01": { id: "H01-S01-C01", videoPlanId: "video-h01-s01-c01", firstFrameId: "frame-h01-s01-c01-first" },
      "H01-S01-C02": { id: "H01-S01-C02", videoPlanId: "video-h01-s01-c02", firstFrameId: "frame-h01-s01-c02-first" }
    },
    frames: {
      "frame-h01-s01-c01-first": { id: "frame-h01-s01-c01-first", purpose: "first_frame", references: sourceRefs },
      "frame-h01-s01-c02-first": { id: "frame-h01-s01-c02-first", purpose: "first_frame", references: [] }
    },
    videoPlans: {
      "video-h01-s01-c01": { id: "video-h01-s01-c01", clipId: "H01-S01-C01", segmentIds: ["segment-h01-s01-c01-01"] },
      "video-h01-s01-c02": { id: "video-h01-s01-c02", clipId: "H01-S01-C02", segmentIds: ["segment-h01-s01-c02-01"] }
    },
    segments: {
      "segment-h01-s01-c01-01": { id: "segment-h01-s01-c01-01", generatedVersions: [] },
      "segment-h01-s01-c02-01": { id: "segment-h01-s01-c02-01", generatedVersions: [] }
    },
    referenceBindings: sourceBindings
  };
}

function fixture({ takeSource = "ltx-director", takeKind = "version", approved = true, includeStoryboard = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p316-continuity-"));
  const clipsDir = path.join(root, "media", "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(path.join(root, "media", "frames"), { recursive: true });
  fs.mkdirSync(path.join(root, "media", "storyboard"), { recursive: true });
  const takeFile = "H01-S01-C01_v01.mp4";
  fs.writeFileSync(path.join(clipsDir, takeFile), Buffer.from("fake-mp4"));

  const take = {
    v: 1,
    file: takeFile,
    approved,
    active: true,
    source: takeSource,
    provider: takeSource.includes("minimax") ? "minimax_h3_local" : "ltx_director",
    ...(takeSource.includes("minimax") ? { h3Mode: "first_frame" } : {})
  };
  const source = clip("H01-S01-C01", {
    status: approved ? "done" : "ready",
    references: references(),
    versions: takeKind === "version" ? [take] : [],
    rangeVersions: takeKind === "rangeVersion" ? [take] : []
  });
  const next = clip("H01-S01-C02", {
    status: "ready",
    activeVersion: 0,
    versions: [],
    rangeVersions: []
  });
  const project = {
    slug: "continuity_fixture",
    settings: { fps: 24 },
    frames: [],
    sequence: { clips: [source, next] }
  };
  const extracted = [];
  const probed = [];
  return {
    root,
    project,
    storyboard: includeStoryboard ? storyboardPair() : null,
    takeFile,
    extracted,
    probed,
    deps: {
      mediaDir: (_project, kind) => path.join(root, "media", kind),
      probeMediaExact: async (file) => {
        probed.push(file);
        return { durationSec: 2, video: { nb_frames: String(DECODED_FRAMES), codec_type: "video" } };
      },
      extractVideoFrameExact: async (input, output, index) => {
        extracted.push({ input, output, index });
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, PNG_STUB);
        return output;
      }
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("carry-forward keeps exact identity and wardrobe versions and drops location/prop/crowd/atmosphere", () => {
  const carried = carryForwardReferences(references());
  assert.deepEqual(carried, [
    { assetId: "character-jesus", assetVersion: 3, role: "identity" },
    { assetId: "wardrobe-jesus", assetVersion: 2, role: "wardrobe" }
  ]);
  assert.deepEqual(CARRY_FORWARD_ROLES, ["identity", "wardrobe"]);
  assert.equal(carried.some((item) => ["location", "prop", "crowd", "atmosphere"].includes(item.role)), false);
});

test("MiniMax is never treated as a frame generator", () => {
  assert.equal(takeIsMiniMaxGenerator({ source: "ltx-director" }), false);
  assert.equal(takeIsMiniMaxGenerator({ source: "minimax-h3-full-range-render", provider: "minimax_h3_local" }), true);
  assert.equal(takeIsMiniMaxGenerator({ generator: "MiniMax Hailuo 2.3" }), true);
  assert.equal(takeIsMiniMaxGenerator({ h3Mode: "first_last" }), true);
});

test("last decoded frame is the exact zero-based nb_frames-1 index", () => {
  assert.equal(lastDecodedFrameIndex({ video: { nb_frames: "48" } }), 47);
  assert.throws(() => lastDecodedFrameIndex({ video: {} }), ContinuityError);
});

test("ordered chain promotes an approved take last frame as the next first continuity guide", async () => {
  const fx = fixture({ takeKind: "rangeVersion" });
  try {
    const result = await promoteLastFrame(fx.project, {
      clipId: "H01-S01-C01",
      storyboard: fx.storyboard
    }, fx.deps);

    assert.equal(fx.extracted.length, 1);
    assert.equal(fx.extracted[0].index, 47);
    assert.equal(path.basename(fx.extracted[0].input), fx.takeFile);
    assert.ok(fs.existsSync(path.join(fx.root, "media", "frames", result.frame.file)));

    assert.equal(result.frame.source, CONTINUITY_SOURCE);
    assert.equal(result.frame.generator, CONTINUITY_GENERATOR);
    assert.equal(String(result.frame.source).includes("minimax"), false);
    assert.equal(result.frame.decodedFrameIndex, 47);
    assert.equal(result.nextClipId, "H01-S01-C02");

    const next = fx.project.sequence.clips[1];
    const first = next.guides.find((guide) => guide.role === "first");
    assert.ok(first);
    assert.equal(first.file, result.frame.file);
    assert.equal(first.source, CONTINUITY_SOURCE);
    assert.equal(next.firstFrame.file, result.frame.file);

    const roles = result.bindings.map((binding) => binding.role).sort();
    assert.deepEqual(roles, ["identity", "wardrobe"]);
    assert.equal(result.bindings.find((binding) => binding.assetId === "character-jesus").assetVersion, 3);
    assert.equal(result.bindings.find((binding) => binding.assetId === "wardrobe-jesus").assetVersion, 2);
    assert.equal(result.bindings.some((binding) => ["location", "prop", "crowd", "atmosphere"].includes(binding.role)), false);
    assert.deepEqual(
      next.references.filter((binding) => ["identity", "wardrobe"].includes(binding.role)),
      [
        { assetId: "character-jesus", assetVersion: 3, role: "identity" },
        { assetId: "wardrobe-jesus", assetVersion: 2, role: "wardrobe" }
      ]
    );

    const nextFrame = fx.storyboard.frames["frame-h01-s01-c02-first"];
    assert.equal(nextFrame.generatedFile, result.frame.file);
    assert.equal(nextFrame.generatedVersions[0].source, CONTINUITY_SOURCE);
    assert.equal(nextFrame.generatedVersions[0].generator, CONTINUITY_GENERATOR);
    assert.equal(nextFrame.continuityInput.decodedFrameIndex, 47);
    assert.ok(fs.existsSync(path.join(fx.root, "media", "storyboard", result.frame.file)));
  } finally {
    fx.cleanup();
  }
});

test("explicit nextClipId attaches the extracted frame to that shot", async () => {
  const fx = fixture({ includeStoryboard: false });
  fx.project.sequence.clips.push(clip("H01-S01-C03", { status: "ready", activeVersion: 0, versions: [] }));
  try {
    const result = await promoteLastFrame(fx.project, {
      clipId: "H01-S01-C01",
      nextClipId: "H01-S01-C03"
    }, fx.deps);
    assert.equal(result.nextClipId, "H01-S01-C03");
    assert.equal(fx.project.sequence.clips[2].guides[0].role, "first");
    assert.equal(fx.project.sequence.clips[1].guides.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("refuses MiniMax as the continuity frame generator even when the take is approved", async () => {
  const fx = fixture({ takeSource: "minimax-h3-full-range-render", takeKind: "version" });
  try {
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError
        && error.code === "MINIMAX_NOT_FRAME_GENERATOR"
        && /never the frame generator/i.test(error.message)
    );
    assert.equal(fx.extracted.length, 0);
    assert.equal(fx.project.frames.length, 0);
    assert.equal(fx.project.sequence.clips[1].guides.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("refuses an unapproved take", async () => {
  const fx = fixture({ approved: false, takeKind: "version", includeStoryboard: false });
  fx.project.sequence.clips[0].status = "ready";
  fx.project.sequence.clips[0].activeVersion = 0;
  try {
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError && error.code === "TAKE_NOT_APPROVED"
    );
    assert.equal(fx.extracted.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("continuity route and storyboard control are wired without MiniMax generation", () => {
  const server = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const start = server.indexOf("// BEGIN CONTINUITY ROUTES");
  const end = server.indexOf("// END CONTINUITY ROUTES");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = server.slice(start, end);
  assert.match(block, /app\.post\("\/api\/projects\/:slug\/continuity\/promote-last-frame"/);
  assert.match(block, /promoteLastFrame/);
  assert.doesNotMatch(block, /minimax/i);

  const action = fs.readFileSync(new URL("../client/src/components/ContinuityAction.tsx", import.meta.url), "utf8");
  assert.match(action, /Use last frame as next first guide/);
  assert.match(action, /continuity\/promote-last-frame/);
  assert.doesNotMatch(action, /minimax/i);

  const board = fs.readFileSync(new URL("../client/src/components/StoryboardWorkspace.tsx", import.meta.url), "utf8");
  assert.match(board, /import ContinuityAction from "\.\/ContinuityAction"/);
  assert.match(board, /<ContinuityAction clipId=\{clip\.id\} \/>/);
});
