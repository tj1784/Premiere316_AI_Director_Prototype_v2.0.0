import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ingestProject, OUTPUT_STABLE_MS } from "../server/comfy-output-ingest.js";

function atom(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function completeMp4(marker = 1) {
  return Buffer.concat([
    atom("ftyp", Buffer.from("isom0000isomiso2avc1mp41", "ascii")),
    atom("moov", Buffer.alloc(32, marker)),
    atom("mdat", Buffer.alloc(2048, marker))
  ]);
}

function placeholderMp4() {
  return Buffer.concat([
    atom("ftyp", Buffer.from("isom0000isomiso2avc1mp41", "ascii")),
    atom("free"),
    atom("mdat")
  ]);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-output-ingest-"));
  const slug = "test_project";
  const clipId = "H03-S06-C03";
  const segmentId = "segment-h03-s06-c03-01";
  const outputRoot = path.join(root, "output");
  const folder = path.join(outputRoot, slug, "director", clipId);
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(folder, { recursive: true });
  const storyboard = {
    segments: { [segmentId]: { id: segmentId, videoPlanId: "plan", generatedVersions: [] } },
    videoPlans: { plan: { timelineData: { segments: [{ id: segmentId }] } } }
  };
  let saves = 0;
  return {
    root, slug, clipId, segmentId, outputRoot, folder, projectRoot, storyboard,
    options(nowMs) {
      return {
        outputRoot,
        projectRoot,
        nowMs,
        stableAgeMs: OUTPUT_STABLE_MS,
        loadStoryboardFn: () => storyboard,
        saveStoryboardFn: () => { saves += 1; }
      };
    },
    saves: () => saves
  };
}

function makeOld(file, nowMs) {
  const seconds = (nowMs - OUTPUT_STABLE_MS - 1000) / 1000;
  fs.utimesSync(file, seconds, seconds);
}

function chapterClipsDir(fx) {
  return path.join(fx.projectRoot, "media", "clips", "H03");
}

test("ingest defers placeholders and recent files, then imports a complete stable MP4 once", () => {
  const fx = fixture();
  const nowMs = Date.now();
  try {
    const source = path.join(fx.folder, "segment_01__00001_.mp4");
    fs.writeFileSync(source, placeholderMp4());
    makeOld(source, nowMs);
    const placeholderBytes = fs.readFileSync(source);

    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 0);
    assert.deepEqual(fs.readFileSync(source), placeholderBytes);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions.length, 0);

    fs.writeFileSync(source, completeMp4(7));
    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 0, "a structurally complete but recent file is still being written");

    makeOld(source, nowMs);
    const completedBytes = fs.readFileSync(source);
    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 1);
    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 0);
    assert.deepEqual(fs.readFileSync(source), completedBytes);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions.length, 1);
    assert.equal(fx.saves(), 1);

    const clips = fs.readdirSync(chapterClipsDir(fx));
    assert.deepEqual(clips, ["H03-S06-C03_segment-h03-s06-c03-01_director_v01.mp4"]);
    assert.deepEqual(fs.readFileSync(path.join(chapterClipsDir(fx), clips[0])), completedBytes);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions[0].file, `media/clips/H03/${clips[0]}`);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("ingest hashes the selected audio payload and suppresses identical same-segment takes", () => {
  const fx = fixture();
  const nowMs = Date.now();
  try {
    const video = path.join(fx.folder, "segment_01__00001_.mp4");
    const audio = path.join(fx.folder, "segment_01__00001_-audio.mp4");
    const videoBytes = completeMp4(2);
    const audioBytes = completeMp4(9);
    fs.writeFileSync(video, videoBytes);
    fs.writeFileSync(audio, audioBytes);
    makeOld(video, nowMs);
    makeOld(audio, nowMs);

    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 1);
    const clipsDir = chapterClipsDir(fx);
    const first = path.join(clipsDir, fs.readdirSync(clipsDir)[0]);
    assert.deepEqual(fs.readFileSync(first), audioBytes, "the selected audio companion is the copied and hashed payload");

    const duplicate = path.join(fx.folder, "segment_01__00002_.mp4");
    fs.writeFileSync(duplicate, audioBytes);
    makeOld(duplicate, nowMs);
    assert.equal(ingestProject(fx.slug, fx.options(nowMs)), 0);
    assert.deepEqual(fs.readdirSync(clipsDir), [path.basename(first)]);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions.length, 1);
    assert.equal(fx.saves(), 1);
    assert.ok(fs.existsSync(video));
    assert.ok(fs.existsSync(audio));
    assert.ok(fs.existsSync(duplicate));

    const ledger = JSON.parse(fs.readFileSync(path.join(fx.projectRoot, "production", "comfy-output-ingest.json"), "utf8"));
    assert.equal(Object.values(ledger.ingested).filter((entry) => entry.duplicate).length, 1);
    assert.ok(Object.values(ledger.ingested).every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
    assert.deepEqual(fs.readdirSync(path.join(fx.projectRoot, "production")).sort(), ["comfy-output-ingest.json"]);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("ingest never publishes bytes when the source changes during its atomic copy", () => {
  const fx = fixture();
  const nowMs = Date.now();
  try {
    const source = path.join(fx.folder, "segment_01__00001_.mp4");
    fs.writeFileSync(source, completeMp4(3));
    makeOld(source, nowMs);
    const options = fx.options(nowMs);
    options.afterTemporaryCopyFn = () => {
      fs.writeFileSync(source, completeMp4(4));
    };

    assert.equal(ingestProject(fx.slug, options), 0);
    assert.deepEqual(fs.readdirSync(chapterClipsDir(fx)), []);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions.length, 0);
    assert.equal(fs.existsSync(path.join(fx.projectRoot, "production", "comfy-output-ingest.json")), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a watcher restart treats already-complete historical outputs as a baseline", () => {
  const fx = fixture();
  const nowMs = Date.now();
  try {
    const source = path.join(fx.folder, "segment_01__00001_.mp4");
    fs.writeFileSync(source, completeMp4(6));
    makeOld(source, nowMs);
    const options = fx.options(nowMs);
    options.notBeforeMs = nowMs - 1000;

    assert.equal(ingestProject(fx.slug, options), 0);
    assert.deepEqual(fs.readdirSync(chapterClipsDir(fx)), []);
    assert.equal(fx.storyboard.segments[fx.segmentId].generatedVersions.length, 0);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("ingest reconciles a completed copy after storyboard persistence was interrupted", () => {
  const fx = fixture();
  const nowMs = Date.now();
  try {
    const source = path.join(fx.folder, "segment_01__00001_.mp4");
    fs.writeFileSync(source, completeMp4(5));
    makeOld(source, nowMs);
    let persisted = structuredClone(fx.storyboard);
    let failSave = true;
    const options = fx.options(nowMs);
    options.loadStoryboardFn = () => structuredClone(persisted);
    options.saveStoryboardFn = (_slug, next) => {
      if (failSave) {
        failSave = false;
        throw new Error("simulated storyboard interruption");
      }
      persisted = structuredClone(next);
    };

    assert.throws(() => ingestProject(fx.slug, options), /simulated storyboard interruption/);
    const clipsDir = chapterClipsDir(fx);
    assert.equal(fs.readdirSync(clipsDir).length, 1, "the atomically published copy survives for recovery");
    assert.equal(persisted.segments[fx.segmentId].generatedVersions.length, 0);

    assert.equal(ingestProject(fx.slug, options), 1, "the existing copy is reconciled instead of duplicated");
    assert.equal(ingestProject(fx.slug, options), 0);
    assert.equal(fs.readdirSync(clipsDir).length, 1);
    assert.equal(persisted.segments[fx.segmentId].generatedVersions.length, 1);
    assert.equal(persisted.videoPlans.plan.timelineData.segments[0].generatedTakes.length, 1);
    assert.equal(persisted.segments[fx.segmentId].activeGeneratedVersion, 1);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
