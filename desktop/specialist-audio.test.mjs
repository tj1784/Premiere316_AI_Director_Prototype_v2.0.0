import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createSpecialistAudioService, specialistRequest } from "./specialist-audio.mjs";

const cue = {
  id: "cue",
  kind: "score",
  notes: "Original quiet string motif",
  durationSec: 5,
  tailSec: 1,
};
test("specialist variants never replace each other, dialogue or silence; duration is not clamped", () => {
  assert.equal(specialistRequest(cue, "ace-step-1.5-xl-sft").duration, 6);
  assert.throws(() => specialistRequest(cue, "ace-step-1.5"), /Unknown/);
  assert.throws(() => specialistRequest(cue, "stable-audio-3-small-sfx"), /Score requires/);
  assert.throws(() => specialistRequest({ ...cue, kind: "sfx", motif: { referenceId: "approved-music" } }, "stable-audio-3-small-sfx"), /cannot silently ignore/);
  assert.throws(
    () => specialistRequest({ ...cue, kind: "dialogue" }, "ace-step-1.5-xl-sft"),
    /cannot replace/,
  );
  assert.throws(
    () => specialistRequest({ ...cue, durationSec: 121 }, "ace-step-1.5-xl-sft"),
    /0–120/,
  );
});
test("owned specialist completion records durable evidence and restart-safe history without approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "p316-specialist-test-"));
  try {
    let child, request;
    const opts = {
      root,
      workerPath: "fixture.py",
      readPicture: () => ({ id: "picture", audio: { cues: [cue] } }),
      assertGpuIdle: async () => {},
      probe: async () => ({ ok: true, durationSec: 6, sampleRate: 48000, channels: 2 }),
      spawnProcess: () => {
        child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        child.kill = () => {};
        child.stdin.on("data", (data) => {
          request = JSON.parse(data.toString());
        });
        return child;
      },
    };
    const service = createSpecialistAudioService(opts);
    service.configure({
      "ace-step-1.5-xl-sft": { python: process.execPath, runtimeRoot: root, cacheRoot: root },
    });
    const input = {
      pictureId: "picture",
      cueId: "cue",
      cueSnapshot: JSON.stringify(cue),
      engineId: "ace-step-1.5-xl-sft",
      seed: 2,
    };
    await assert.rejects(service.start({ ...input, cueSnapshot: "{}" }), /Saved cue differs/);
    const { job } = await service.start(input);
    await assert.rejects(service.start(input), /already active/);
    const path = join(request.outputDir, "candidate.wav");
    writeFileSync(path, Buffer.alloc(4096, 1));
    child.stdout.write(
      "P316_AUDIO_RESULT " +
        JSON.stringify({ engineId: input.engineId, path, provenance: { fixture: true } }) +
        "\n",
    );
    child.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    const saved = service.status("picture").jobs[0];
    assert.equal(saved.status, "completed");
    assert.match(saved.output.mediaSha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.canonical, undefined);
    assert.equal(createSpecialistAudioService(opts).status("picture").jobs[0].status, "completed");
    const second = await service.start(input);
    service.cancel(second.job.id);
    child.emit("close", 0);
    assert.equal(
      service.status("picture").jobs.find((j) => j.id === second.job.id).status,
      "cancelled",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
