import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createProject,
  deleteProject,
  mediaDir
} from "../server/projects.js";
import {
  EDIT_DOCUMENT_SCHEMA,
  editSequenceFingerprint,
  editorWorkspace,
  loadEditDocument,
  normalizeEditSequence,
  saveEditSequence
} from "../server/sequence-editor.js";

const pureProject = {
  slug: `sequence_editor_pure_${process.pid}`,
  name: "Normalization Film",
  settings: { fps: 24, width: 1920, height: 1080 }
};

function videoClip(overrides = {}) {
  return {
    id: "v1",
    mediaId: "video-source",
    name: "Source video",
    sourceFile: "media/clips/source.mp4",
    sourceDurationSec: 10,
    sourceInSec: 0,
    sourceOutSec: 5,
    durationSec: 5,
    ...overrides
  };
}

function audioClip(overrides = {}) {
  return {
    id: "a1",
    mediaId: "audio-source",
    name: "Source audio",
    sourceFile: "media/audio/source.flac",
    sourceDurationSec: 30,
    sourceInSec: 0,
    sourceOutSec: 10,
    durationSec: 10,
    timelineStartSec: 0,
    ...overrides
  };
}

test("normalizes frame-snapped ripple video, placed audio, dimensions, and track settings", () => {
  const hash = "A".repeat(64);
  const normalized = normalizeEditSequence(pureProject, {
    id: "main",
    name: "  Main Cut  ",
    fps: 24,
    width: 9000,
    height: 1,
    videoClips: [
      videoClip({
        id: "v1",
        sourceInSec: 1.01,
        sourceOutSec: 5.02,
        timelineStartSec: 99,
        volumeDb: 99,
        sourceSha256: hash
      }),
      videoClip({
        id: "v2",
        sourceFile: "media/clips/second.mov",
        sourceDurationSec: 6,
        sourceInSec: 0,
        sourceOutSec: 2.02,
        timelineStartSec: 400
      })
    ],
    audioClips: [
      audioClip({
        id: "a1",
        sourceInSec: 2,
        sourceOutSec: 10,
        durationSec: 20,
        timelineStartSec: 3.01,
        track: "M1",
        volumeDb: -100,
        fadeInSec: 2,
        fadeOutSec: 3
      }),
      audioClip({
        id: "a2",
        sourceFile: "media/assets/dialogue.wav",
        sourceDurationSec: 2,
        sourceOutSec: 2,
        durationSec: 2,
        timelineStartSec: 100,
        track: "not-a-track",
        muted: true
      })
    ],
    trackSettings: {
      V1: { muted: true, locked: true, volumeDb: 99 },
      M1: { volumeDb: -99 }
    }
  });

  assert.equal(normalized.id, "main");
  assert.equal(normalized.name, "Main Cut");
  assert.equal(normalized.width, 8192);
  assert.equal(normalized.height, 2);
  assert.deepEqual(
    normalized.videoClips.map((clip) => ({
      id: clip.id,
      order: clip.order,
      sourceInSec: clip.sourceInSec,
      sourceOutSec: clip.sourceOutSec,
      durationSec: clip.durationSec,
      timelineStartSec: clip.timelineStartSec
    })),
    [
      { id: "v1", order: 0, sourceInSec: 1, sourceOutSec: 5, durationSec: 4, timelineStartSec: 0 },
      { id: "v2", order: 1, sourceInSec: 0, sourceOutSec: 2, durationSec: 2, timelineStartSec: 4 }
    ]
  );
  assert.equal(normalized.videoClips[0].volumeDb, 12);
  assert.equal(normalized.videoClips[0].sourceSha256, hash.toLowerCase());

  assert.equal(normalized.audioClips[0].durationSec, 8);
  assert.equal(normalized.audioClips[0].timelineStartSec, 3);
  assert.equal(normalized.audioClips[0].track, "M1");
  assert.equal(normalized.audioClips[0].volumeDb, -60);
  assert.equal(normalized.audioClips[1].track, "A1");
  assert.equal(normalized.audioClips[1].muted, true);
  assert.equal(normalized.durationSec, 11);

  assert.deepEqual(normalized.trackSettings, {
    V1: { muted: true, locked: true, volumeDb: 12 },
    A1: { muted: false, locked: false, volumeDb: 0 },
    M1: { muted: false, locked: false, volumeDb: -60 }
  });
});

test("produces a stable empty default edit sequence", () => {
  const normalized = normalizeEditSequence(pureProject, {});
  assert.equal(normalized.id, "main");
  assert.equal(normalized.name, "Normalization Film · Main Edit");
  assert.equal(normalized.fps, 24);
  assert.equal(normalized.width, 1920);
  assert.equal(normalized.height, 1080);
  assert.equal(normalized.trackSettings.M1.volumeDb, 0);
  assert.deepEqual(normalized.videoClips, []);
  assert.deepEqual(normalized.audioClips, []);
  assert.equal(normalized.durationSec, 0);
});

test("preserves saved timestamps while keeping content fingerprints timestamp-independent", () => {
  const first = normalizeEditSequence(pureProject, {
    updatedAt: "2026-08-20T10:00:00.000Z",
    videoClips: [videoClip()]
  });
  const second = normalizeEditSequence(pureProject, {
    updatedAt: "2026-08-20T11:00:00.000Z",
    videoClips: [videoClip()]
  });
  assert.equal(first.updatedAt, "2026-08-20T10:00:00.000Z");
  assert.equal(second.updatedAt, "2026-08-20T11:00:00.000Z");
  assert.equal(editSequenceFingerprint(first, 7), editSequenceFingerprint(second, 7));
  assert.notEqual(editSequenceFingerprint(first, 7), editSequenceFingerprint(first, 8));
});

test("normalizes odd output dimensions and omitted clip gains for H.264 export", () => {
  const normalized = normalizeEditSequence(pureProject, {
    width: 1919,
    height: 1079,
    videoClips: [videoClip({ volumeDb: undefined })],
    audioClips: [audioClip({ volumeDb: undefined })]
  });
  assert.equal(normalized.width, 1918);
  assert.equal(normalized.height, 1078);
  assert.equal(normalized.videoClips[0].volumeDb, 0);
  assert.equal(normalized.audioClips[0].volumeDb, 0);
});

test("accepts one recognized chapter folder for video sources and preserves the relative path", () => {
  const normalized = normalizeEditSequence(pureProject, {
    videoClips: [videoClip({ sourceFile: "media/clips/H03/source.mp4" })]
  });
  assert.equal(normalized.videoClips[0].sourceFile, "media/clips/H03/source.mp4");
});

test("rejects duplicate timeline item ids across video and audio tracks", () => {
  assert.throws(
    () => normalizeEditSequence(pureProject, {
      videoClips: [videoClip({ id: "shared" })],
      audioClips: [audioClip({ id: "shared" })]
    }),
    /Duplicate editor item id: shared/
  );
});

test("rejects traversal, unrecognized or deep nesting, wrong roots, and unsupported extensions", () => {
  const invalidVideos = [
    "../source.mp4",
    "media/clips/../project.json",
    "media/clips/nested/source.mp4",
    "media/clips/H03/deep/source.mp4",
    "media/audio/source.mp4",
    "media/clips/source.exe",
    "C:\\Windows\\source.mp4"
  ];
  for (const sourceFile of invalidVideos) {
    assert.throws(
      () => normalizeEditSequence(pureProject, { videoClips: [videoClip({ sourceFile })] }),
      /Editor media path is invalid|Unsupported video source/
    );
  }

  const invalidAudio = [
    "media/clips/source.wav",
    "media/assets/nested/source.wav",
    "media/audio/source.mp4"
  ];
  for (const sourceFile of invalidAudio) {
    assert.throws(
      () => normalizeEditSequence(pureProject, { audioClips: [audioClip({ sourceFile })] }),
      /Editor media path is invalid|Unsupported audio source/
    );
  }
});

test("discovers playable flat and chapter-grouped clips without traversing unrelated folders", (t) => {
  const project = createProject(`Sequence Editor Chapter Test ${randomUUID()}`);
  t.after(() => {
    if (/^sequence_editor_chapter_test_/.test(project.slug)) deleteProject(project.slug);
  });
  const clipsDir = mediaDir(project, "clips");
  fs.mkdirSync(path.join(clipsDir, "H01"), { recursive: true });
  fs.mkdirSync(path.join(clipsDir, "not-a-chapter"), { recursive: true });
  fs.writeFileSync(path.join(clipsDir, "legacy.mp4"), Buffer.alloc(2048, 1));
  fs.writeFileSync(path.join(clipsDir, "H01", "chapter.mp4"), Buffer.alloc(2048, 2));
  fs.writeFileSync(path.join(clipsDir, "not-a-chapter", "ignored.mp4"), Buffer.alloc(2048, 3));

  const workspace = editorWorkspace(project.slug);
  const relativeFiles = workspace.library.videos.map((item) => item.relativeFile).sort();
  assert.deepEqual(relativeFiles, ["media/clips/H01/chapter.mp4", "media/clips/legacy.mp4"]);
  assert.equal(workspace.library.counts.playableVideos, 2);
});

test("validateFiles refuses a missing project media source without creating fixtures", () => {
  assert.throws(
    () => normalizeEditSequence(pureProject, { videoClips: [videoClip()] }, { validateFiles: true }),
    /Video source is missing or incomplete: media\/clips\/source\.mp4/
  );
});

test("save refuses partial payloads and revisionless overwrites", () => {
  assert.throws(
    () => saveEditSequence(pureProject.slug, undefined, 0),
    /complete editor sequence/
  );
  assert.throws(
    () => saveEditSequence(pureProject.slug, { videoClips: [], audioClips: [] }, undefined),
    /expectedRevision is required/
  );
});

test("persists revisions atomically and reports stale-writer conflicts", (t) => {
  const project = createProject(`Sequence Editor Test ${randomUUID()}`);
  t.after(() => {
    if (/^sequence_editor_test_/.test(project.slug)) deleteProject(project.slug);
  });
  assert.match(project.slug, /^sequence_editor_test_/);

  const clipsDir = mediaDir(project, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.writeFileSync(path.join(clipsDir, "source.mp4"), Buffer.alloc(2048, 1));

  const initial = loadEditDocument(project.slug);
  assert.equal(initial.schemaVersion, EDIT_DOCUMENT_SCHEMA);
  assert.equal(initial.projectSlug, project.slug);
  assert.equal(initial.revision, 0);
  assert.equal(initial.sequence.id, "main");

  const firstSave = saveEditSequence(project.slug, {
    ...initial.sequence,
    videoClips: [videoClip({ sourceDurationSec: 4, sourceOutSec: 4, durationSec: 4 })]
  }, initial.revision);
  assert.equal(firstSave.revision, 1);
  assert.equal(firstSave.sequence.durationSec, 4);
  assert.equal(loadEditDocument(project.slug).revision, 1);

  let conflict = null;
  try {
    saveEditSequence(project.slug, firstSave.sequence, 0);
  } catch (error) {
    conflict = error;
  }
  assert.ok(conflict);
  assert.equal(conflict.code, "EDIT_REVISION_CONFLICT");
  assert.equal(conflict.current.revision, 1);
  assert.match(conflict.message, /expected revision 0, current 1/);
  assert.equal(loadEditDocument(project.slug).revision, 1);
});
