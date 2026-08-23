import assert from "node:assert/strict";
import test from "node:test";

import {
  activeStoryCut,
  insertAudio,
  insertVideo,
  moveAudioClip,
  moveVideoClip,
  newEditorSequence,
  nextVideoClip,
  patchTimelineClip,
  projectMediaUrl,
  replaceVideoClipMedia,
  removeTimelineClip,
  sequenceDuration,
  splitVideoClip,
  trimVideoClip,
  videoClipAtTime
} from "../client/src/sequence-editor-state.js";

test("builds encoded media URLs without flattening chapter folders", () => {
  assert.equal(
    projectMediaUrl("harrowing of hell", "media/clips/H03/scene take.mp4"),
    "/media/harrowing%20of%20hell/clips/H03/scene%20take.mp4"
  );
  assert.equal(projectMediaUrl("film", "media/clips/legacy.mp4"), "/media/film/clips/legacy.mp4");
  assert.equal(projectMediaUrl("film", "media/clips/H03/../secret.mp4"), "");
});

function videoMedia(id, durationSec, extra = {}) {
  return {
    id,
    kind: "video",
    name: id,
    relativeFile: `media/clips/${id}.mp4`,
    durationSec,
    bytes: 2048,
    mtimeMs: 1234,
    ...extra
  };
}

function audioMedia(id, durationSec, extra = {}) {
  return {
    id,
    kind: "audio",
    name: id,
    relativeFile: `media/audio/${id}.wav`,
    durationSec,
    bytes: 512,
    mtimeMs: 5678,
    ...extra
  };
}

function editorSequence() {
  return newEditorSequence({
    name: "Unit Film",
    settings: { fps: 24, width: 1920, height: 1080 }
  });
}

test("inserts and reorders video clips while rippling V1 timing", () => {
  const empty = editorSequence();
  const withA = insertVideo(empty, videoMedia("A", 8, {
    clipId: "H01-S01-C01",
    sceneId: "H01-S01",
    segmentId: "segment-a",
    takeId: "take-v2",
    takeNumber: 2
  }));
  const withC = insertVideo(withA, videoMedia("C", 2));
  const inserted = insertVideo(withC, videoMedia("B", 4), { atIndex: 1 });

  assert.notStrictEqual(inserted, withC);
  assert.deepEqual(inserted.videoClips.map((clip) => clip.name), ["A", "B", "C"]);
  assert.deepEqual(inserted.videoClips.map((clip) => clip.order), [0, 1, 2]);
  assert.deepEqual(inserted.videoClips.map((clip) => clip.timelineStartSec), [0, 8, 12]);
  assert.equal(inserted.videoClips[0].sourceFile, "media/clips/A.mp4");
  assert.deepEqual(inserted.videoClips[0].origin, {
    clipId: "H01-S01-C01",
    sceneId: "H01-S01",
    segmentId: "segment-a",
    takeId: "take-v2",
    takeNumber: 2,
    source: "ltx-director"
  });

  const cId = inserted.videoClips[2].id;
  const reordered = moveVideoClip(inserted, cId, 0);
  assert.deepEqual(reordered.videoClips.map((clip) => clip.name), ["C", "A", "B"]);
  assert.deepEqual(reordered.videoClips.map((clip) => clip.order), [0, 1, 2]);
  assert.deepEqual(reordered.videoClips.map((clip) => clip.timelineStartSec), [0, 2, 10]);
});

test("trimming either edge ripples every following video clip", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("A", 8));
  sequence = insertVideo(sequence, videoMedia("B", 4));
  const firstId = sequence.videoClips[0].id;

  sequence = trimVideoClip(sequence, firstId, "end", -2, 24);
  assert.equal(sequence.videoClips[0].sourceOutSec, 6);
  assert.equal(sequence.videoClips[0].durationSec, 6);
  assert.equal(sequence.videoClips[1].timelineStartSec, 6);

  sequence = trimVideoClip(sequence, firstId, "start", 1, 24);
  assert.equal(sequence.videoClips[0].sourceInSec, 1);
  assert.equal(sequence.videoClips[0].sourceOutSec, 6);
  assert.equal(sequence.videoClips[0].durationSec, 5);
  assert.equal(sequence.videoClips[1].timelineStartSec, 5);

  sequence = trimVideoClip(sequence, firstId, "end", 99, 24);
  assert.equal(sequence.videoClips[0].sourceOutSec, 8);
  assert.equal(sequence.videoClips[0].durationSec, 7);
  assert.equal(sequence.videoClips[1].timelineStartSec, 7);
});

test("splits a source range without changing the downstream cut duration", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("A", 8));
  sequence = insertVideo(sequence, videoMedia("B", 4));
  const firstId = sequence.videoClips[0].id;

  const split = splitVideoClip(sequence, firstId, 3.25, 24);
  assert.ok(split.createdClipId);
  assert.deepEqual(split.sequence.videoClips.map((clip) => clip.name), ["A", "A · B", "B"]);
  assert.deepEqual(split.sequence.videoClips.map((clip) => clip.timelineStartSec), [0, 3.25, 8]);
  assert.deepEqual(
    split.sequence.videoClips.slice(0, 2).map((clip) => [clip.sourceInSec, clip.sourceOutSec, clip.durationSec]),
    [[0, 3.25, 3.25], [3.25, 8, 4.75]]
  );
  assert.equal(sequenceDuration(split.sequence), 12);

  const rejected = splitVideoClip(split.sequence, firstId, 0, 24);
  assert.equal(rejected.createdClipId, null);
  assert.strictEqual(rejected.sequence, split.sequence);
});

test("deleting a clip closes the video gap and can independently remove audio", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("A", 3));
  sequence = insertVideo(sequence, videoMedia("B", 5));
  sequence = insertAudio(sequence, audioMedia("music", 10), { track: "M1", timelineStartSec: 1 });
  const firstVideoId = sequence.videoClips[0].id;
  const audioId = sequence.audioClips[0].id;

  sequence = removeTimelineClip(sequence, firstVideoId);
  assert.deepEqual(sequence.videoClips.map((clip) => clip.name), ["B"]);
  assert.equal(sequence.videoClips[0].timelineStartSec, 0);
  assert.equal(sequence.videoClips[0].order, 0);
  assert.equal(sequence.audioClips.length, 1);

  sequence = removeTimelineClip(sequence, audioId);
  assert.equal(sequence.audioClips.length, 0);
  assert.equal(sequenceDuration(sequence), 5);
});

test("places and patches dialogue and music independently of the ripple video track", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("picture", 8));
  sequence = insertAudio(sequence, audioMedia("score", 20), {
    track: "M1",
    timelineStartSec: 2.3456789
  });
  sequence = insertAudio(sequence, audioMedia("dialogue", 4), {
    track: "A1",
    timelineStartSec: 30
  });

  const music = sequence.audioClips[0];
  const dialogue = sequence.audioClips[1];
  assert.equal(music.track, "M1");
  assert.equal(music.volumeDb, -12);
  assert.equal(music.timelineStartSec, 2.345679);
  assert.equal(dialogue.track, "A1");
  assert.equal(dialogue.volumeDb, 0);

  sequence = moveAudioClip(sequence, music.id, -5);
  sequence = patchTimelineClip(sequence, music.id, { volumeDb: -7, fadeInSec: 1.5, fadeOutSec: 2 });
  sequence = patchTimelineClip(sequence, dialogue.id, { muted: true });
  assert.deepEqual(
    sequence.audioClips.map((clip) => ({ id: clip.id, start: clip.timelineStartSec, muted: clip.muted })),
    [
      { id: music.id, start: 0, muted: false },
      { id: dialogue.id, start: 30, muted: true }
    ]
  );
  assert.equal(sequence.audioClips[0].volumeDb, -7);
  assert.equal(sequence.audioClips[0].fadeInSec, 1.5);
  assert.equal(sequence.audioClips[0].fadeOutSec, 2);
  assert.equal(sequenceDuration(sequence), 20);
});

test("builds an editorially ordered active-take cut for the requested scope", () => {
  const library = [
    { id: "s1-t2", kind: "video", isActiveTake: true, clipId: "C1", sceneId: "S1", segmentId: "seg-1", takeNumber: 2, editorialIndex: 100 },
    { id: "s1-t4", kind: "video", isActiveTake: true, clipId: "C1", sceneId: "S1", segmentId: "seg-1", takeNumber: 4, editorialIndex: 100 },
    { id: "s1-t5-inactive", kind: "video", isActiveTake: false, clipId: "C1", sceneId: "S1", segmentId: "seg-1", takeNumber: 5, editorialIndex: 100 },
    { id: "s2-t1", kind: "video", isActiveTake: true, clipId: "C1", sceneId: "S1", segmentId: "seg-2", takeNumber: 1, editorialIndex: 50 },
    { id: "other-clip", kind: "video", isActiveTake: true, clipId: "C2", sceneId: "S1", segmentId: "seg-3", takeNumber: 1, editorialIndex: 1 },
    { id: "audio", kind: "audio", isActiveTake: true, clipId: "C1", sceneId: "S1", segmentId: "seg-a", takeNumber: 1, editorialIndex: 0 }
  ];

  const cut = activeStoryCut(library, { sceneId: "S1", clipId: "C1" });
  assert.deepEqual(cut.map((item) => item.id), ["s2-t1", "s1-t4"]);
});

test("resolves the active playback clip at cut boundaries", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("A", 3));
  sequence = insertVideo(sequence, videoMedia("B", 2));

  assert.equal(videoClipAtTime(sequence, 0)?.name, "A");
  assert.equal(videoClipAtTime(sequence, 2.999)?.name, "A");
  assert.equal(videoClipAtTime(sequence, 3)?.name, "B");
  assert.equal(videoClipAtTime(sequence, 5)?.name, "B");
  assert.equal(videoClipAtTime(sequence, 5.001), null);
  assert.equal(nextVideoClip(sequence, 0)?.name, "B");
  assert.equal(nextVideoClip(sequence, 3), null);
});

test("replaces a timeline clip with a take while preserving in-range trims", () => {
  let sequence = insertVideo(editorSequence(), videoMedia("A", 8));
  sequence = patchTimelineClip(sequence, sequence.videoClips[0].id, { sourceInSec: 1, sourceOutSec: 4 });
  const next = replaceVideoClipMedia(sequence, sequence.videoClips[0].id, videoMedia("Take2", 8, { takeNumber: 2, takeId: "t2" }));
  assert.equal(next.videoClips[0].sourceFile, "media/clips/Take2.mp4");
  assert.equal(next.videoClips[0].sourceInSec, 1);
  assert.equal(next.videoClips[0].sourceOutSec, 4);
  assert.equal(next.videoClips[0].origin.takeNumber, 2);
});
