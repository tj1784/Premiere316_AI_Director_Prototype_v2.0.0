import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  concatPreparedVideosWithSoundtrack,
  ffmpegAvailable,
  probeMediaExact,
  trimVideoToFrames
} from "../server/ffmpeg.js";

function rate(value) {
  const [numerator, denominator = "1"] = String(value || "0").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

test("conforms LTX video to exact Premiere frames while padding short audio", async (context) => {
  if (!(await ffmpegAvailable())) {
    context.skip("ffmpeg is not available");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p316-director-ffmpeg-"));
  const source = path.join(root, "source.mp4");
  const output = path.join(root, "output.mp4");
  try {
    const fixture = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=24:d=1.041666667",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.4",
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(fixture.status, 0, fixture.stderr);
    await trimVideoToFrames(source, output, 24, 24);
    const info = await probeMediaExact(output);
    assert.equal(Number(info.video?.nb_frames), 24);
    assert.equal(rate(info.video?.avg_frame_rate), 24);
    assert.ok(info.audio);
    assert.ok(Math.abs(Number(info.durationSec) - 1) < 0.1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("conforms the Garden C01 LTX 337-frame decode to 336 Premiere frames", async (context) => {
  if (!(await ffmpegAvailable())) {
    context.skip("ffmpeg is not available");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p316-director-c01-"));
  const source = path.join(root, "c01-ltx.mp4");
  const output = path.join(root, "c01-premiere.mp4");
  try {
    const fixture = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:r=24:d=14.041666667",
      "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=13.6",
      "-map", "0:v:0", "-map", "1:a:0",
      "-frames:v", "337", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "48000", "-ac", "2", source
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(fixture.status, 0, fixture.stderr);
    const sourceInfo = await probeMediaExact(source);
    assert.equal(Number(sourceInfo.video?.nb_frames), 337);
    await trimVideoToFrames(source, output, 336, 24);
    const info = await probeMediaExact(output);
    assert.equal(Number(info.video?.nb_frames), 336);
    assert.equal(rate(info.video?.avg_frame_rate), 24);
    assert.equal(Number(info.audio?.sample_rate), 48000);
    assert.equal(Number(info.audio?.channels), 2);
    assert.ok(Math.abs(Number(info.durationSec) - 14) < 0.1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concatenates exact shot pictures and lays the original soundtrack once", async (context) => {
  if (!(await ffmpegAvailable())) {
    context.skip("ffmpeg is not available");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p316-director-music-concat-"));
  const shotA = path.join(root, "shot-a.mp4");
  const shotB = path.join(root, "shot-b.mp4");
  const soundtrack = path.join(root, "master.flac");
  const output = path.join(root, "music-video.mp4");
  try {
    for (const [file, color] of [[shotA, "navy"], [shotB, "maroon"]]) {
      const fixture = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=24:d=1`,
        "-frames:v", "24", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file
      ], { windowsHide: true, encoding: "utf8" });
      assert.equal(fixture.status, 0, fixture.stderr);
    }
    const audioFixture = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=3",
      "-metadata", "lyrics=Into Your hands",
      "-metadata", "workflow={\"id\":\"music-test\"}",
      "-c:a", "flac", soundtrack
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(audioFixture.status, 0, audioFixture.stderr);

    await concatPreparedVideosWithSoundtrack([shotA, shotB], soundtrack, output, {
      frames: 48,
      fps: 24,
      audioStartFrame: 24
    });
    const info = await probeMediaExact(output);
    assert.equal(Number(info.video?.nb_frames), 48);
    assert.equal(rate(info.video?.avg_frame_rate), 24);
    assert.equal(Number(info.audio?.sample_rate), 48000);
    assert.equal(Number(info.audio?.channels), 2);
    assert.ok(Math.abs(Number(info.durationSec) - 2) < 0.1);
    const metadataProbe = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "format_tags", "-of", "json", output
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(metadataProbe.status, 0, metadataProbe.stderr);
    const tags = JSON.parse(metadataProbe.stdout || "{}").format?.tags || {};
    assert.equal(tags.lyrics, "Into Your hands");
    assert.equal(tags.workflow, "{\"id\":\"music-test\"}");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
