import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  continuityEvidenceIsVerified,
  lastDecodedFrameIndex,
  preflightContinuityPromotion,
  promoteLastFrame,
  takeIsMiniMaxGenerator
} from "../server/continuity.js";

const PNG_STUB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const DECODED_FRAMES = 48;

function hashRecord(file, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    file,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length
  };
}

function writeTake(root, library, file, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const disk = path.join(root, "media", library, ...file.replaceAll("\\", "/").split("/"));
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  fs.writeFileSync(disk, buffer);
  return hashRecord(file, buffer);
}

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
  const takeHash = writeTake(root, "clips", takeFile, "fake-mp4");

  const take = {
    id: "sequence-take-v1",
    v: 1,
    file: takeFile,
    fileHashes: [takeHash],
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
  assert.notEqual(lastDecodedFrameIndex({ video: { nb_frames: "48" } }), 0);
  assert.equal(lastDecodedFrameIndex({ video: { nb_read_frames: 24 } }), 23);
  assert.equal(lastDecodedFrameIndex({ video: { nb_frames: "48", nb_read_frames: "47" } }), 46);
  assert.throws(() => lastDecodedFrameIndex({ video: {} }), ContinuityError);
});

test("carry-forward accepts exact versions from assetVersionId when assetVersion is omitted", () => {
  assert.deepEqual(
    carryForwardReferences([{ assetId: "character-jesus", assetVersionId: "character-jesus:v3", role: "character" }]),
    [{ assetId: "character-jesus", assetVersion: 3, role: "identity" }]
  );
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
    assert.match(result.frame.file, /_[a-f0-9]{64}\.png$/);
    assert.equal(continuityEvidenceIsVerified(fx.project, result.frame, fx.deps.mediaDir), true);
    assert.equal(result.frame.continuityEvidence.sourceTake.sha256, hashRecord(fx.takeFile, "fake-mp4").sha256);
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

test("repeating an identical promotion reuses immutable content and does not append records", async () => {
  const fx = fixture({ takeKind: "rangeVersion" });
  let projectSaves = 0;
  let storyboardSaves = 0;
  fx.deps.saveProject = () => { projectSaves += 1; };
  fx.deps.saveStoryboard = () => { storyboardSaves += 1; };
  try {
    const first = await promoteLastFrame(fx.project, { clipId: "H01-S01-C01", storyboard: fx.storyboard }, fx.deps);
    const firstState = JSON.stringify({ project: fx.project, storyboard: fx.storyboard });
    const second = await promoteLastFrame(fx.project, { clipId: "H01-S01-C01", storyboard: fx.storyboard }, fx.deps);

    assert.equal(second.changed, false);
    assert.equal(second.frame.id, first.frame.id);
    assert.equal(second.frame.file, first.frame.file);
    assert.equal(fx.extracted.length, 1);
    assert.equal(fx.project.frames.length, 1);
    assert.equal(fx.project.sequence.clips[1].guides.filter((guide) => guide.role === "first").length, 1);
    assert.equal(fx.storyboard.frames["frame-h01-s01-c02-first"].generatedVersions.length, 1);
    assert.equal(JSON.stringify({ project: fx.project, storyboard: fx.storyboard }), firstState);
    assert.equal(projectSaves, 1);
    assert.equal(storyboardSaves, 1);
  } finally {
    fx.cleanup();
  }
});

test("verified continuity evidence fails closed after promoted frame bytes are tampered", async () => {
  const fx = fixture({ includeStoryboard: false });
  try {
    const result = await promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps);
    const promotedPath = path.join(fx.root, "media", "frames", result.frame.file);
    fs.writeFileSync(promotedPath, Buffer.from("tampered-frame"));

    assert.equal(continuityEvidenceIsVerified(fx.project, result.frame, fx.deps.mediaDir), false);
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError && error.code === "CONTINUITY_EVIDENCE_CORRUPT"
    );
    assert.equal(fs.readFileSync(promotedPath, "utf8"), "tampered-frame");
    assert.equal(fx.extracted.length, 1);
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

test("clip done/active status alone is not exact take approval", async () => {
  const fx = fixture({ approved: false, takeKind: "version", includeStoryboard: false });
  fx.project.sequence.clips[0].status = "done";
  fx.project.sequence.clips[0].activeVersion = 1;
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

test("read-only preflight exposes one exact approved and hash-verified take without probing or extracting", async () => {
  const fx = fixture({ includeStoryboard: true });
  try {
    const result = await preflightContinuityPromotion(fx.project, {
      clipId: "H01-S01-C01",
      storyboard: fx.storyboard
    }, fx.deps);
    assert.equal(result.eligible, true);
    assert.equal(result.sourceClipId, "H01-S01-C01");
    assert.equal(result.nextClipId, "H01-S01-C02");
    assert.equal(result.candidate.selector, "sequence-take-v1");
    assert.equal(result.candidate.id, "sequence-take-v1");
    assert.equal(result.candidate.kind, "version");
    assert.equal(result.candidate.file, fx.takeFile);
    assert.equal(result.candidate.sha256, hashRecord(fx.takeFile, "fake-mp4").sha256);
    assert.equal(result.candidate.bytes, Buffer.byteLength("fake-mp4"));
    assert.equal(result.candidate.approval.status, "approved");
    assert.equal(result.candidate.approval.takeId, result.candidate.id);
    assert.deepEqual(fx.probed, []);
    assert.deepEqual(fx.extracted, []);
    assert.equal(fx.project.frames.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("read-only preflight returns the fail-closed approval reason and never advertises completion as approval", async () => {
  const fx = fixture({ approved: false, includeStoryboard: false });
  fx.project.sequence.clips[0].status = "done";
  fx.project.sequence.clips[0].activeVersion = 1;
  try {
    const result = await preflightContinuityPromotion(fx.project, { clipId: "H01-S01-C01" }, fx.deps);
    assert.equal(result.eligible, false);
    assert.equal(result.code, "TAKE_NOT_APPROVED");
    assert.match(result.reason, /already-approved take/i);
    assert.equal(result.candidate, null);
    assert.deepEqual(fx.probed, []);
    assert.deepEqual(fx.extracted, []);
  } finally {
    fx.cleanup();
  }
});

test("read-only preflight disables a take whose exact bytes drifted", async () => {
  const fx = fixture({ includeStoryboard: false });
  fs.writeFileSync(path.join(fx.root, "media", "clips", fx.takeFile), Buffer.from("mutated-mp4"));
  try {
    const result = await preflightContinuityPromotion(fx.project, { clipId: "H01-S01-C01" }, fx.deps);
    assert.equal(result.eligible, false);
    assert.equal(result.code, "TAKE_FILE_HASH_MISMATCH");
    assert.match(result.reason, /no longer matches/i);
    assert.equal(result.candidate, null);
    assert.deepEqual(fx.probed, []);
    assert.deepEqual(fx.extracted, []);
  } finally {
    fx.cleanup();
  }
});

test("approved take without an exact SHA-256/byte record is ineligible", async () => {
  const fx = fixture({ includeStoryboard: false });
  delete fx.project.sequence.clips[0].versions[0].fileHashes;
  try {
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError && error.code === "TAKE_PROVENANCE_MISSING"
    );
    assert.equal(fx.probed.length, 0);
    assert.equal(fx.extracted.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("approved take whose disk bytes differ from its exact manifest is ineligible", async () => {
  const fx = fixture({ includeStoryboard: false });
  fs.writeFileSync(path.join(fx.root, "media", "clips", fx.takeFile), Buffer.from("mutated-mp4"));
  try {
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError && error.code === "TAKE_FILE_HASH_MISMATCH"
    );
    assert.equal(fx.probed.length, 0);
    assert.equal(fx.extracted.length, 0);
  } finally {
    fx.cleanup();
  }
});

test("a basename-only hash cannot authorize a different stored take path", async () => {
  const fx = fixture({ includeStoryboard: false });
  const take = fx.project.sequence.clips[0].versions[0];
  take.file = `H01/${fx.takeFile}`;
  take.fileHashes = [hashRecord(fx.takeFile, "fake-mp4")];
  writeTake(fx.root, "clips", take.file, "fake-mp4");
  try {
    await assert.rejects(
      () => promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps),
      (error) => error instanceof ContinuityError && error.code === "TAKE_PROVENANCE_MISSING"
    );
  } finally {
    fx.cleanup();
  }
});

test("extracts last frame of the assembled full take, not the first range piece", async () => {
  const fx = fixture({ takeKind: "version", includeStoryboard: false });
  const firstPiece = "H01-S01-C01_r00000-00024_v01.mp4";
  const lastPiece = "H01-S01-C01_r00024-00048_v02.mp4";
  const assembled = "H01-S01-C01_assembled_v01.mp4";
  const firstHash = writeTake(fx.root, "clips", firstPiece, "first-piece");
  const lastHash = writeTake(fx.root, "clips", lastPiece, "last-piece");
  const assembledHash = writeTake(fx.root, "clips", assembled, "assembled");
  const source = fx.project.sequence.clips[0];
  source.rangeVersions = [
    { id: "range-v1", v: 1, file: firstPiece, fileHashes: [firstHash], startFrame: 0, endFrame: 24, active: true, approved: true, source: "ltx-director" },
    { id: "range-v2", v: 2, file: lastPiece, fileHashes: [lastHash], startFrame: 24, endFrame: 48, active: true, approved: true, source: "ltx-director" }
  ];
  source.versions = [{ id: "assembled-v1", v: 1, file: assembled, fileHashes: [assembledHash], approved: true, source: "assembled-ranges" }];
  source.activeVersion = 1;
  source.status = "done";
  try {
    await promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps);
    assert.equal(fx.extracted.length, 1);
    assert.equal(path.basename(fx.extracted[0].input), assembled);
    assert.equal(fx.extracted[0].index, 47);
    assert.notEqual(fx.extracted[0].index, 0);
  } finally {
    fx.cleanup();
  }
});

test("without a full version, extracts the last active range covering the clip end", async () => {
  const fx = fixture({ takeKind: "rangeVersion", includeStoryboard: false });
  const firstPiece = "H01-S01-C01_r00000-00024_v01.mp4";
  const lastPiece = "H01-S01-C01_r00024-00048_v02.mp4";
  const firstHash = writeTake(fx.root, "clips", firstPiece, "first-piece");
  const lastHash = writeTake(fx.root, "clips", lastPiece, "last-piece");
  const source = fx.project.sequence.clips[0];
  source.rangeVersions = [
    { id: "range-v1", v: 1, file: firstPiece, fileHashes: [firstHash], startFrame: 0, endFrame: 24, active: true, approved: true, source: "ltx-director" },
    { id: "range-v2", v: 2, file: lastPiece, fileHashes: [lastHash], startFrame: 24, endFrame: 48, active: true, approved: true, source: "ltx-director" }
  ];
  source.versions = [];
  source.activeVersion = 0;
  source.status = "ranges-ready";
  try {
    await promoteLastFrame(fx.project, { clipId: "H01-S01-C01" }, fx.deps);
    assert.equal(path.basename(fx.extracted[0].input), lastPiece);
    assert.equal(fx.extracted[0].index, 47);
  } finally {
    fx.cleanup();
  }
});

test("uses the selected storyboard take, not an earlier generated take", async () => {
  const fx = fixture({ approved: false, takeKind: "version" });
  const firstTake = "H01-S01-C01_segment-h01-s01-c01-01_director_v1.mp4";
  const lastTake = "H01-S01-C01_segment-h01-s01-c01-01_director_v2.mp4";
  const firstHash = writeTake(fx.root, "clips", firstTake, "take-v1");
  const lastHash = writeTake(fx.root, "clips", lastTake, "take-v2");
  const source = fx.project.sequence.clips[0];
  source.versions = [];
  source.rangeVersions = [];
  source.activeVersion = 0;
  source.status = "ready";
  const segment = fx.storyboard.segments["segment-h01-s01-c01-01"];
  segment.generatedVersions = [
    { id: "take-v1", v: 1, file: `media/clips/${firstTake}`, fileHashes: [firstHash], source: "ltx-director" },
    { id: "take-v2", v: 2, file: `media/clips/${lastTake}`, fileHashes: [lastHash], source: "ltx-director" }
  ];
  segment.activeTakeId = "take-v2";
  segment.activeGeneratedVersion = 2;
  segment.activeTakeLocked = true;
  try {
    await promoteLastFrame(fx.project, { clipId: "H01-S01-C01", storyboard: fx.storyboard }, fx.deps);
    assert.equal(path.basename(fx.extracted[0].input), lastTake);
    assert.equal(fx.extracted[0].index, 47);
  } finally {
    fx.cleanup();
  }
});

test("promotes a T2V video-plan take from the storyboard library as next first guide", async () => {
  const fx = fixture({ approved: false, takeKind: "version" });
  const t2vFile = "H01-S01-C01.v1.mp4";
  const t2vHash = writeTake(fx.root, "storyboard", t2vFile, "t2v-take");
  const source = fx.project.sequence.clips[0];
  source.versions = [];
  source.rangeVersions = [];
  source.activeVersion = 0;
  source.status = "ready";
  const plan = fx.storyboard.videoPlans["video-h01-s01-c01"];
  plan.generatedVersions = [{
    v: 1,
    file: t2vFile,
    files: [t2vFile],
    generatedInputPath: `media/storyboard/${t2vFile}`,
    mediaType: "video",
    workflowId: "ltx25-t2v",
    source: "ltx-director",
    approved: true,
    fileHashes: [t2vHash]
  }];
  plan.activeGeneratedVersion = 1;
  plan.status = "generated";
  fx.storyboard.clips["H01-S01-C01"].renderStatus = "completed";
  try {
    const result = await promoteLastFrame(fx.project, { clipId: "H01-S01-C01", storyboard: fx.storyboard }, fx.deps);
    assert.equal(path.basename(fx.extracted[0].input), t2vFile);
    assert.equal(fx.extracted[0].index, 47);
    assert.equal(result.frame.source, CONTINUITY_SOURCE);
    assert.equal(result.nextClipId, "H01-S01-C02");
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
  assert.match(block, /app\.get\("\/api\/projects\/:slug\/continuity\/preflight"/);
  assert.match(block, /preflightContinuityPromotion/);
  assert.match(block, /app\.post\("\/api\/projects\/:slug\/continuity\/promote-last-frame"/);
  assert.match(block, /promote-last-frame", requireLocalSameOriginMutation/);
  assert.match(block, /promoteLastFrame/);
  assert.doesNotMatch(block, /minimax/i);

  const canonicalStart = server.indexOf("function canonicalFrameCurrent");
  const canonicalEnd = server.indexOf("function clipRenderFingerprint", canonicalStart);
  const canonical = server.slice(canonicalStart, canonicalEnd);
  assert.match(canonical, /frame\.source === "take-continuity"/);
  assert.match(canonical, /continuityEvidenceIsVerified\(project, frame\)/);
  assert.match(canonical, /assetId: null/);
  assert.match(canonical, /approvalFingerprint: frame\.sha256/);

  const queue = fs.readFileSync(new URL("../server/queue.js", import.meta.url), "utf8");
  const queueStart = queue.indexOf("function currentGuideBindings");
  const queueEnd = queue.indexOf("function renderFingerprint", queueStart);
  const queueBindings = queue.slice(queueStart, queueEnd);
  assert.match(queueBindings, /continuityEvidenceIsVerified\(project, frame\)/);
  assert.match(queueBindings, /assetId: null/);
  assert.match(queueBindings, /approvalFingerprint: frame\.sha256/);

  const action = fs.readFileSync(new URL("../client/src/components/ContinuityAction.tsx", import.meta.url), "utf8");
  assert.match(action, /Use last frame as next first guide/);
  assert.match(action, /continuity\/preflight\?/);
  assert.match(action, /continuity\/promote-last-frame/);
  assert.match(action, /eligiblePreflightResponse\(body, clipId\)/);
  assert.match(action, /takeVersion: preflight\.candidate\?\.selector/);
  assert.match(action, /preflight\.loading \|\| !preflight\.eligible/);
  assert.match(action, /Continuity unavailable/);
  assert.match(action, /\{preflight\.reason\}/);
  assert.match(action, /responseContainsAppliedEvidence\(body\)/);
  assert.match(action, /useStore\.getState\(\)\.project\?\.slug !== projectSlug/);
  assert.match(action, /useStore\.setState\(nextState\)/);
  assert.doesNotMatch(action, /reloadProject\(\)/);
  assert.doesNotMatch(action, /loadStoryboard\(\)/);
  assert.doesNotMatch(action, /minimax/i);

  const board = fs.readFileSync(new URL("../client/src/components/StoryboardWorkspace.tsx", import.meta.url), "utf8");
  assert.match(board, /import ContinuityAction from "\.\/ContinuityAction"/);
  assert.match(board, /<ContinuityAction clipId=\{clip\.id\} \/>/);

  const creative = fs.readFileSync(new URL("../client/src/components/CreativeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(creative, /continuityFrameHasVerifiedEvidence\(frame\)/);
  assert.match(creative, /<ContinuityAction clipId=\{selectedClip\.id\} \/>/);
});
