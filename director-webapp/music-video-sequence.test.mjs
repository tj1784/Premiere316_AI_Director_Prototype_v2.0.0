import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMusicVideoSequencePlan,
  buildMusicVideoShotJob,
  createMusicVideoSequenceRecord,
  markMusicVideoShotAccepted,
  markMusicVideoShotSaved,
  patchMusicVideoSequencePrompt,
  sequenceHistoryOutputs,
  workspaceFromMusicVideoManifest
} from "./music-video-sequence.mjs";

function workspaceFixture() {
  return {
    source: { sha256: "workflow-sha" },
    settings: {
      frameRate: 24,
      customWidth: 1024,
      customHeight: 576,
      guideStrength: "1.00"
    },
    timeline: {
      global_prompt: "One continuous visual language.",
      segments: Array.from({ length: 6 }, (_, index) => ({
        id: `shot-${index + 1}`,
        start: index * 240,
        length: 240,
        prompt: `Shot ${index + 1}`,
        type: index === 0 ? "image" : "text",
        ...(index === 0 ? { imageFile: "approved-opening.png", guideStrength: 1 } : {})
      })),
      audioSegments: [{
        id: "master-audio",
        type: "audio",
        start: 0,
        length: 5804,
        trimStart: 0,
        audioFile: "Premiere316/project/audio/master.flac",
        projectMediaPath: "media/audio/master.flac"
      }],
      motionSegments: []
    }
  };
}

test("plans contiguous ten-second music-video shots with one approved opening guide", () => {
  const plan = buildMusicVideoSequencePlan(workspaceFixture());
  assert.equal(plan.shots.length, 6);
  assert.equal(plan.requestedFrames, 1440);
  assert.deepEqual(plan.shots.map((shot) => [shot.startFrame, shot.requestedFrames, shot.generationFrames]), [
    [0, 240, 241],
    [240, 240, 241],
    [480, 240, 241],
    [720, 240, 241],
    [960, 240, 241],
    [1200, 240, 241]
  ]);
});

test("rejects a sequential shot outside the five-to-ten-second GPU contract", () => {
  const workspace = workspaceFixture();
  workspace.timeline.segments[2].length = 241;
  workspace.timeline.segments[3].start = 721;
  assert.throws(() => buildMusicVideoSequencePlan(workspace), /must be 5-10s/);
});

test("builds one isolated job with the LTX boundary-frame audio lookahead", () => {
  const workspace = workspaceFixture();
  const plan = buildMusicVideoSequencePlan(workspace);
  const job = buildMusicVideoShotJob(workspace, plan, 1, "run-001-shot-001-boundary.png");
  assert.equal(job.requestedFrames, 240);
  assert.equal(job.generationFrames, 241);
  assert.equal(job.timeline.segments.length, 1);
  assert.equal(job.timeline.segments[0].type, "image");
  assert.equal(job.timeline.segments[0].imageFile, "run-001-shot-001-boundary.png");
  assert.equal(job.timeline.segments[0].prompt, "Shot 2");
  assert.deepEqual(
    job.timeline.audioSegments.map((segment) => [segment.start, segment.length, segment.trimStart]),
    [[0, 241, 240]]
  );
});

test("overlaps sequential audio conditioning by exactly the generated handoff frame", () => {
  const workspace = workspaceFixture();
  workspace.timeline.audioSegments[0].length = 1441;
  const plan = buildMusicVideoSequencePlan(workspace);
  const first = buildMusicVideoShotJob(workspace, plan, 0, "approved-opening.png");
  const second = buildMusicVideoShotJob(workspace, plan, 1, "shot-001-boundary.png");

  assert.deepEqual(
    first.timeline.audioSegments.map((segment) => [segment.start, segment.length, segment.trimStart]),
    [[0, 241, 0]]
  );
  assert.deepEqual(
    second.timeline.audioSegments.map((segment) => [segment.start, segment.length, segment.trimStart]),
    [[0, 241, 240]]
  );
  assert.equal(first.timeline.audioSegments[0].trimStart + first.timeline.audioSegments[0].length - 1, 240);
  assert.equal(second.timeline.audioSegments[0].trimStart, 240);
});

test("pins unique node 94 and node 201 outputs and crops the editorial frame count", () => {
  const prompt = {
    "94": { class_type: "VHS_VideoCombine", inputs: { filename_prefix: "old", trim_to_audio: true } },
    "201": { class_type: "SaveImage", inputs: { filename_prefix: "old" } },
    "206": { class_type: "ImageFromBatch", inputs: { batch_index: 0, length: 1 } },
    "200": { class_type: "ImageFromBatch", inputs: { batch_index: 0, length: 1 } }
  };
  const { prompt: patched, prefixes } = patchMusicVideoSequencePrompt(prompt, "run 001", { index: 2, requestedFrames: 120 });
  assert.equal(patched["94"].inputs.filename_prefix, "director_webapp/music_video/run-001/shot_003");
  assert.equal(patched["94"].inputs.trim_to_audio, false);
  assert.equal(patched["201"].inputs.filename_prefix, "director_webapp/music_video/run-001/handoff/shot_003_boundary");
  assert.equal(patched["206"].inputs.length, 120);
  assert.equal(patched["200"].inputs.batch_index, -1);
  assert.equal(prefixes.video.endsWith("shot_003"), true);
});

test("requires both final video and exact boundary-frame outputs", () => {
  const entry = {
    outputs: {
      "94": { videos: [{ filename: "shot_001.mp4", subfolder: "music", type: "output" }] },
      "201": { images: [{ filename: "shot_001_boundary_00001_.png", subfolder: "music/handoff", type: "output" }] }
    }
  };
  assert.deepEqual(sequenceHistoryOutputs(entry), {
    video: { filename: "shot_001.mp4", subfolder: "music", type: "output" },
    handoff: { filename: "shot_001_boundary_00001_.png", subfolder: "music/handoff", type: "output" }
  });
  assert.throws(() => sequenceHistoryOutputs({ outputs: { "94": entry.outputs["94"] } }), /node 201/);
});

test("persists one parent job while child shots advance sequentially", () => {
  const workspace = workspaceFixture();
  const plan = buildMusicVideoSequencePlan(workspace);
  const initial = createMusicVideoSequenceRecord({
    id: "director_music_test",
    binding: { projectSlug: "project", clipId: "clip", source: "sequence" },
    plan,
    workspace,
    soundtrack: { projectMediaPath: "media/audio/master.flac", sha256: "abc", bytes: 1234 }
  });
  const accepted = markMusicVideoShotAccepted(initial, 0, "prompt-1", { video: "v", handoff: "h" });
  assert.equal(accepted.refs.shots[0].status, "queued");
  assert.equal(accepted.refs.shots[1].status, "pending");
  const saved = markMusicVideoShotSaved(accepted, 0, {
    video: { file: "media/temp/run/shot-1.mp4", sha256: "vsha", bytes: 10 },
    handoff: { file: "media/temp/run/handoff-1.png", sha256: "isha", bytes: 5 }
  });
  assert.equal(saved.refs.shots[0].status, "done");
  assert.equal(saved.refs.currentShotIndex, 0);
  assert.equal(saved.status, "running");
  assert.match(saved.stage, /preparing shot 2/i);
  const secondAccepted = markMusicVideoShotAccepted(saved, 1, "prompt-2", { video: "v2", handoff: "h2" });
  assert.equal(secondAccepted.refs.currentShotIndex, 1);
});

test("flattens a project-owned storyboard block manifest without rewriting its clips", () => {
  const base = workspaceFixture();
  const manifest = {
    id: "into-your-hands",
    projectSlug: "harrowing_of_hell",
    fps: 24,
    width: 576,
    height: 1024,
    totalFrames: 480,
    blocks: [
      {
        id: "block-01",
        clipId: "MV-B01",
        shots: [
          { id: "mv-001", startFrame: 0, length: 240, prompt: "Opening", guideProjectMediaPath: "media/storyboard/mv-opening.png" },
          { id: "mv-002", startFrame: 240, length: 240, prompt: "Continue" }
        ]
      }
    ]
  };
  const result = workspaceFromMusicVideoManifest(base, manifest);
  assert.deepEqual(result.manifest.clipIds, ["MV-B01"]);
  assert.equal(result.timeline.segments[0].type, "image");
  assert.equal(result.timeline.segments[0].projectMediaPath, "media/storyboard/mv-opening.png");
  assert.equal(result.timeline.segments[1].type, "text");
  assert.deepEqual([result.settings.customWidth, result.settings.customHeight], [576, 1024]);
  assert.equal(buildMusicVideoSequencePlan(result).shots.length, 2);
  assert.equal(base.timeline.segments.length, 6);
});

test("accepts the authoritative 242-second portrait edit as 34 sequential 8n+1 jobs", () => {
  const boundaries = [
    [0, 160, 320, 560, 736, 912, 1088, 1240, 1440],
    [1440, 1616, 1848, 2024, 2216, 2440, 2640, 2880],
    [2880, 3024, 3176, 3344, 3520, 3696, 3888, 4032, 4176, 4320],
    [4320, 4456, 4600, 4728, 4912, 5128, 5288, 5424, 5568, 5688, 5808]
  ];
  let shotIndex = 0;
  const manifest = {
    id: "into-your-hands",
    projectSlug: "harrowing_of_hell",
    fps: 24,
    width: 576,
    height: 1024,
    totalFrames: 5808,
    blocks: boundaries.map((values, blockIndex) => ({
      id: `block-${blockIndex + 1}`,
      clipId: `MV-B${blockIndex + 1}`,
      startFrame: values[0],
      endFrame: values.at(-1),
      shots: values.slice(0, -1).map((startFrame, localIndex) => {
        const index = shotIndex++;
        return {
          id: `mv-shot-${String(index + 1).padStart(3, "0")}`,
          startFrame,
          length: values[localIndex + 1] - startFrame,
          prompt: `Shot ${index + 1}`,
          ...(index === 0 ? { guideProjectMediaPath: "media/storyboard/music-opening.png" } : {})
        };
      })
    }))
  };
  const manifestWorkspace = workspaceFromMusicVideoManifest(workspaceFixture(), manifest);
  const plan = buildMusicVideoSequencePlan(manifestWorkspace);
  assert.equal(plan.shots.length, 34);
  assert.equal(plan.requestedFrames, 5808);
  assert.equal(plan.endFrame, 5808);
  assert.deepEqual([plan.width, plan.height], [576, 1024]);
  assert.ok(plan.shots.every((shot) => shot.generationFrames === shot.requestedFrames + 1));
  manifestWorkspace.timeline.audioSegments = [{
    id: "master-audio",
    type: "audio",
    start: 0,
    length: 5809,
    trimStart: 0,
    audioFile: "Premiere316/project/audio/master.flac"
  }];
  const lastJob = buildMusicVideoShotJob(manifestWorkspace, plan, 33, "mv-shot-033-boundary.png");
  assert.deepEqual(
    lastJob.timeline.audioSegments.map((segment) => [segment.start, segment.length, segment.trimStart]),
    [[0, lastJob.generationFrames, 5688]]
  );
});
