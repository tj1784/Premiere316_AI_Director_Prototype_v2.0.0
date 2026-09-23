import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fullMovieArgs, createMovieAssemblyService } from "./movie-assembly.mjs";

test("controlled assembly host revalidates persisted sources, recovers deliveries and rejects changed bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "p316-assembly-host-"));
  try {
    const path = join(root, "source.mp4"),
      bytes = Buffer.alloc(2048, 1);
    writeFileSync(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const picture = {
      id: "p",
      fps: 24,
      shots: [{ id: "s", durationSec: 2 }],
      video: {
        takes: [
          {
            id: "t",
            shotId: "s",
            canonical: true,
            status: "CANONICAL",
            mediaUri: path,
            mediaSha256: sha256,
            probe: { ok: true },
          },
        ],
      },
    };
    const plan = {
      width: 160,
      height: 96,
      ok: true,
      pictureId: "p",
      issues: [],
      durationSec: 2,
      clips: [{ shotId: "s", takeId: "t", mediaUri: path, sha256, durationSec: 2 }],
      sounds: [],
    };
    const options = {
      root: join(root, "deliveries"),
      readPicture: () => picture,
      resolveMedia: (p) => p,
      assertPath: () => {},
      resolvePlan: () => plan,
      discoverTools: async () => ({ ok: true, ffmpeg: "encoder", ffprobe: "probe" }),
      run: async (command, args) => {
        if (command === "encoder") {
          writeFileSync(args.at(-1), bytes);
          return { code: 0 };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            format: { duration: 2, size: 2048 },
            streams: [
              { codec_type: "video", width: 160, height: 96, r_frame_rate: "24/1" },
              { codec_type: "audio" },
            ],
          }),
        };
      },
    };
    const service = createMovieAssemblyService(options),
      input = { pictureId: "p", pictureSnapshot: JSON.stringify(picture), plan };
    await assert.rejects(
      service.assemble({ ...input, pictureSnapshot: "{}" }),
      /Saved picture changed/,
    );
    await assert.rejects(
      service.assemble({ ...input, plan: { ...plan, durationSec: 1 } }),
      /differ from current/,
    );
    picture.intake = { deliveryFormat: "MOV", deliveryCodec: "H.264" };
    await assert.rejects(
      service.assemble({ ...input, pictureSnapshot: JSON.stringify(picture) }),
      /Requested delivery format is unsupported/,
    );
    picture.intake = { deliveryFormat: "MP4", deliveryCodec: "ProRes" };
    await assert.rejects(
      service.assemble({ ...input, pictureSnapshot: JSON.stringify(picture) }),
      /Requested video codec is unsupported/,
    );
    delete picture.intake;
    const result = await service.assemble(input);
    assert.equal(result.ok, true);
    const recovered = createMovieAssemblyService(options);
    assert.equal(recovered.history("p").deliveries[0].id, result.id);
    assert.equal(recovered.history("other").deliveries.length, 0);
    assert.equal((await recovered.verify("p", result.id)).ok, true);
    let encoderStarted;
    const started = new Promise((resolve) => {
      encoderStarted = resolve;
    });
    const canceledService = createMovieAssemblyService({
      ...options,
      run: async (command, args, timeout, signal) => {
        if (command !== "encoder") return options.run(command, args);
        encoderStarted();
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      },
    });
    const canceled = canceledService.assemble(input);
    await started;
    assert.equal(canceledService.status("p").phase, "encoding movie");
    assert.equal(canceledService.status("other").busy, false);
    canceledService.cancel("p");
    await assert.rejects(canceled, /canceled/);
    assert.equal(canceledService.status("p").busy, false);
    assert.equal(canceledService.history("p").deliveries.length, 1);
    writeFileSync(result.outputPath, "changed");
    await assert.rejects(recovered.verify("p", result.id), /bytes are missing or changed/);
    writeFileSync(path, "changed");
    await assert.rejects(recovered.assemble(input), /Canonical bytes changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("full movie keeps authored timing, native audio and delayed score instead of the 30-second cap", () => {
  const args = fullMovieArgs({
    clips: [{ path: "movie.mp4", hasAudio: true, durationSec: 120 }],
    sounds: [{ path: "cue.wav", startSec: 40, durationSec: 15 }],
    width: 1920,
    height: 1080,
    fps: 24,
    durationSec: 120,
    output: "out.mp4",
  });
  assert.equal(args[args.indexOf("-t") + 1], "120");
  assert.match(args[args.indexOf("-filter_complex") + 1], /adelay=40000:all=1/);
  assert.match(args[args.indexOf("-filter_complex") + 1], /\[native\]\[s0\]amix/);
  assert.throws(
    () => fullMovieArgs({ clips: [{}], sounds: [], width: 1, height: 1, fps: 24, durationSec: 2 }),
    /dimensions/,
  );
});

test("real FFmpeg assembles two synthetic clips with a timed synthetic audio cue and extracts an exact predecessor frame", async (t) => {
  if (
    spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status !== 0 ||
    spawnSync("ffprobe", ["-version"], { windowsHide: true }).status !== 0
  ) {
    t.skip("Local FFmpeg/FFprobe not installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "p316-assembly-test-"));
  const run = (cmd, args) => {
    const result = spawnSync(cmd, args, { windowsHide: true, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    const a = join(root, "a.mp4"),
      b = join(root, "b.mp4"),
      sound = join(root, "cue.wav"),
      output = join(root, "assembled.mp4");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x96:r=24:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      a,
    ]);
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x96:r=24:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      b,
    ]);
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-ar",
      "48000",
      sound,
    ]);
    run(
      "ffmpeg",
      fullMovieArgs({
        clips: [
          { path: a, hasAudio: false, durationSec: 1 },
          { path: b, hasAudio: false, durationSec: 1 },
        ],
        sounds: [{ path: sound, startSec: 1, durationSec: 0.5 }],
        width: 160,
        height: 96,
        fps: 24,
        durationSec: 2,
        output,
      }),
    );
    const meta = JSON.parse(
      run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", output]),
    );
    assert.ok(Math.abs(Number(meta.format.duration) - 2) < 0.1);
    assert.ok(meta.streams.some((s) => s.codec_type === "video"));
    assert.ok(meta.streams.some((s) => s.codec_type === "audio"));
    assert.ok(readFileSync(output).length > 1024);
    const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
    const p = {
      id: "fixture",
      video: {
        takes: [
          {
            id: "take",
            shotId: "shot",
            canonical: true,
            status: "CANONICAL",
            probe: { ok: true },
            mediaUri: output,
            mediaSha256: digest,
          },
        ],
      },
    };
    const service = createMovieAssemblyService({
      root: join(root, "extraction"),
      readPicture: () => p,
      resolveMedia: (path) => path,
      assertPath: () => {},
      discoverTools: async () => ({ ok: true, ffmpeg: "ffmpeg" }),
      run: async (command, args) => ({ code: 0, stdout: run(command, args) }),
    });
    const frame = await service.continuationFrame("fixture", "take");
    assert.equal(frame.binding.predecessorSha256, digest);
    const framePath = join(
      root,
      "extraction",
      frame.binding.mediaUri.split("/")[3],
      "continuation.png",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(framePath)).digest("hex"),
      frame.binding.sha256,
    );
    p.video.takes[0].canonical = false;
    await assert.rejects(
      service.continuationFrame("fixture", "take"),
      /reviewed canonical predecessor/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
