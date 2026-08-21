import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  appendBlackTail,
  concatVideoSegments,
  mixTimelineAudio,
  probeMedia
} from "../server/ffmpeg.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function binaryAvailable(binary) {
  const result = spawnSync(binary, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000
  });
  return !result.error && result.status === 0;
}

function run(binary, args, { binaryOutput = false } = {}) {
  const result = spawnSync(binary, args, {
    encoding: binaryOutput ? null : "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000
  });
  const stderr = binaryOutput
    ? result.stderr?.toString("utf8") || ""
    : result.stderr || "";
  if (result.error || result.status !== 0) {
    assert.fail(`${path.basename(binary)} failed (${result.status ?? result.error?.code}): ${stderr.slice(-3000)}`);
  }
  return result.stdout;
}

function createPictureWithEmbeddedAudio(output) {
  run(FFMPEG, [
    "-y",
    "-f", "lavfi", "-i", "color=c=red:s=96x64:r=24:d=0.5",
    "-f", "lavfi", "-i", "color=c=green:s=96x64:r=24:d=0.5",
    "-f", "lavfi", "-i", "color=c=blue:s=96x64:r=24:d=1.0",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2.0",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]",
    "-map", "3:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    output
  ]);
}

function createShortOverlay(output) {
  run(FFMPEG, [
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=880:sample_rate=48000:duration=0.14",
    "-c:a", "pcm_s16le",
    output
  ]);
}

function createPictureWithEarlyEndingAudio(output) {
  run(FFMPEG, [
    "-y",
    "-f", "lavfi", "-i", "color=c=yellow:s=96x64:r=24:d=1.25",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=0.25",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    output
  ]);
}

function averageRgbAt(file, timeSec) {
  const pixels = run(FFMPEG, [
    "-v", "error",
    "-ss", String(timeSec),
    "-i", file,
    "-frames:v", "1",
    "-vf", "scale=2:2",
    "-pix_fmt", "rgb24",
    "-f", "rawvideo",
    "-"
  ], { binaryOutput: true });
  assert.equal(pixels.length, 12, "expected one 2x2 RGB frame");
  const totals = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 3) {
    totals[0] += pixels[index];
    totals[1] += pixels[index + 1];
    totals[2] += pixels[index + 2];
  }
  return totals.map((total) => total / 4);
}

function audioRms(file, startSec, durationSec) {
  const pcm = run(FFMPEG, [
    "-v", "error",
    "-ss", String(startSec),
    "-t", String(durationSec),
    "-i", file,
    "-vn",
    "-ac", "1",
    "-ar", "8000",
    "-c:a", "pcm_f32le",
    "-f", "f32le",
    "-"
  ], { binaryOutput: true });
  assert.ok(pcm.length >= 4, "expected decoded audio samples");
  let sumSquares = 0;
  const samples = Math.floor(pcm.length / 4);
  for (let index = 0; index < samples; index++) {
    const value = pcm.readFloatLE(index * 4);
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples);
}

test("editor FFmpeg pipeline trims picture, preserves or mutes source audio, and mixes a positioned looping fade", async (t) => {
  const missing = [
    [FFMPEG, binaryAvailable(FFMPEG)],
    [FFPROBE, binaryAvailable(FFPROBE)]
  ].filter(([, available]) => !available).map(([binary]) => binary);
  if (missing.length) {
    t.skip(`media runtime unavailable: ${missing.join(", ")}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-editor-ffmpeg-test-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const source = path.join(tempRoot, "source-with-audio.mp4");
  const overlay = path.join(tempRoot, "short-overlay.wav");
  const stitched = path.join(tempRoot, "stitched.mp4");
  const mixed = path.join(tempRoot, "mixed.mp4");
  createPictureWithEmbeddedAudio(source);
  createShortOverlay(overlay);

  await concatVideoSegments([
    {
      file: source,
      startSec: 0.5,
      durationSec: 0.5,
      audioMuted: false,
      audioVolumeDb: 0
    },
    {
      file: source,
      startSec: 1.0,
      durationSec: 0.8,
      audioMuted: true,
      audioVolumeDb: 0
    }
  ], stitched, { width: 96, height: 64, fps: 24 });

  const stitchedInfo = await probeMedia(stitched);
  assert.ok(stitchedInfo.video, "stitched edit should contain video");
  assert.ok(stitchedInfo.audio, "stitched edit should contain conformed source audio");
  assert.ok(Math.abs(stitchedInfo.durationSec - 1.3) < 0.12, `unexpected stitched duration ${stitchedInfo.durationSec}`);

  const [firstRed, firstGreen, firstBlue] = averageRgbAt(stitched, 0.2);
  assert.ok(firstGreen > firstRed + 35 && firstGreen > firstBlue + 35,
    `source-in trim should begin in green section, got rgb(${firstRed}, ${firstGreen}, ${firstBlue})`);
  const [secondRed, secondGreen, secondBlue] = averageRgbAt(stitched, 0.8);
  assert.ok(secondBlue > secondRed + 70 && secondBlue > secondGreen + 70,
    `second source-in trim should begin in blue section, got rgb(${secondRed}, ${secondGreen}, ${secondBlue})`);

  const retainedRms = audioRms(stitched, 0.12, 0.22);
  const mutedRms = audioRms(stitched, 0.61, 0.18);
  assert.ok(retainedRms > 0.025, `embedded source audio was not retained (${retainedRms})`);
  assert.ok(mutedRms < 0.003, `muted source segment is still audible (${mutedRms})`);

  await mixTimelineAudio(stitched, [{
    file: overlay,
    timelineStartSec: 0.75,
    durationSec: 0.4,
    sourceInSec: 0,
    sourceOutSec: 0.14,
    loop: true,
    volumeDb: -3,
    fadeInSec: 0.08,
    fadeOutSec: 0.08
  }], mixed, { durationSec: 1.3 });

  const mixedInfo = await probeMedia(mixed);
  assert.ok(mixedInfo.video, "mixed edit should retain video");
  assert.ok(mixedInfo.audio, "mixed edit should contain final AAC audio");
  assert.equal(mixedInfo.audio.sample_rate, "48000");
  assert.equal(Number(mixedInfo.audio.channels), 2);
  assert.ok(Math.abs(mixedInfo.durationSec - 1.3) < 0.12, `unexpected mixed duration ${mixedInfo.durationSec}`);

  const preOverlayRms = audioRms(mixed, 0.59, 0.10);
  const fadeInRms = audioRms(mixed, 0.76, 0.04);
  const loopedCenterRms = audioRms(mixed, 0.96, 0.10);
  const fadeOutRms = audioRms(mixed, 1.11, 0.035);
  const afterOverlayRms = audioRms(mixed, 1.20, 0.07);
  assert.ok(preOverlayRms < 0.004, `overlay began before its timeline position (${preOverlayRms})`);
  assert.ok(loopedCenterRms > 0.02, `looped overlay tail is not audible (${loopedCenterRms})`);
  assert.ok(fadeInRms < loopedCenterRms * 0.8,
    `fade-in was not measurably below the looped center (${fadeInRms} vs ${loopedCenterRms})`);
  assert.ok(fadeOutRms < loopedCenterRms * 0.8,
    `fade-out was not measurably below the looped center (${fadeOutRms} vs ${loopedCenterRms})`);
  assert.ok(afterOverlayRms < 0.004, `overlay continued past its placed duration (${afterOverlayRms})`);
});

test("source picture keeps its requested duration when embedded audio ends early", async (t) => {
  const missing = [
    [FFMPEG, binaryAvailable(FFMPEG)],
    [FFPROBE, binaryAvailable(FFPROBE)]
  ].filter(([, available]) => !available).map(([binary]) => binary);
  if (missing.length) {
    t.skip(`media runtime unavailable: ${missing.join(", ")}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-editor-short-audio-test-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const source = path.join(tempRoot, "long-picture-short-audio.mp4");
  const output = path.join(tempRoot, "full-picture-selection.mp4");
  createPictureWithEarlyEndingAudio(source);

  const sourceInfo = await probeMedia(source);
  assert.ok(Number(sourceInfo.video?.duration) > 1.15, "fixture picture must outlast its audio");
  assert.ok(Number(sourceInfo.audio?.duration) < 0.4, "fixture audio must end early");

  await concatVideoSegments([{
    file: source,
    startSec: 0.1,
    durationSec: 1.0,
    audioMuted: false,
    audioVolumeDb: 0
  }], output, { width: 96, height: 64, fps: 24 });

  const outputInfo = await probeMedia(output);
  assert.ok(outputInfo.video, "selected range should retain picture");
  assert.ok(outputInfo.audio, "selected range should retain and pad its embedded audio stream");
  assert.ok(Math.abs(outputInfo.durationSec - 1.0) < 0.10,
    `early audio truncated the requested 1s picture range to ${outputInfo.durationSec}s`);
  const [red, green, blue] = averageRgbAt(output, 0.90);
  assert.ok(red > 150 && green > 150 && blue < 80,
    `picture did not survive beyond the source audio tail, got rgb(${red}, ${green}, ${blue})`);
  assert.ok(audioRms(output, 0.04, 0.08) > 0.015, "early embedded audio should remain audible");
  assert.ok(audioRms(output, 0.55, 0.20) < 0.003, "padded portion should be silent");
});

test("black-tail extension supplies silent picture beneath an audio-only timeline tail", async (t) => {
  const missing = [
    [FFMPEG, binaryAvailable(FFMPEG)],
    [FFPROBE, binaryAvailable(FFPROBE)]
  ].filter(([, available]) => !available).map(([binary]) => binary);
  if (missing.length) {
    t.skip(`media runtime unavailable: ${missing.join(", ")}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-editor-black-tail-test-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const source = path.join(tempRoot, "source-with-audio.mp4");
  const picture = path.join(tempRoot, "picture.mp4");
  const extended = path.join(tempRoot, "picture-with-black-tail.mp4");
  const overlay = path.join(tempRoot, "tail-overlay.wav");
  const final = path.join(tempRoot, "audio-tail-master.mp4");
  createPictureWithEmbeddedAudio(source);
  createShortOverlay(overlay);

  await concatVideoSegments([{
    file: source,
    startSec: 0.5,
    durationSec: 0.5,
    audioMuted: false,
    audioVolumeDb: 0
  }], picture, { width: 96, height: 64, fps: 24 });
  await appendBlackTail(picture, extended, 0.5, { width: 96, height: 64, fps: 24 });

  const extendedInfo = await probeMedia(extended);
  assert.ok(extendedInfo.video && extendedInfo.audio, "black tail should include picture and audio streams");
  assert.ok(Math.abs(extendedInfo.durationSec - 1.0) < 0.10,
    `black tail did not extend the picture through the 1s timeline (${extendedInfo.durationSec})`);
  const [tailRed, tailGreen, tailBlue] = averageRgbAt(extended, 0.82);
  assert.ok(tailRed < 20 && tailGreen < 20 && tailBlue < 20,
    `tail picture should be black, got rgb(${tailRed}, ${tailGreen}, ${tailBlue})`);
  assert.ok(audioRms(extended, 0.70, 0.20) < 0.003, "unmixed black tail should contain silence");

  await mixTimelineAudio(extended, [{
    file: overlay,
    timelineStartSec: 0.66,
    durationSec: 0.25,
    sourceInSec: 0,
    sourceOutSec: 0.14,
    loop: true,
    volumeDb: -3,
    fadeInSec: 0,
    fadeOutSec: 0
  }], final, { durationSec: 1.0 });
  const finalInfo = await probeMedia(final);
  assert.ok(Math.abs(finalInfo.durationSec - 1.0) < 0.10, "audio-only tail master should keep the full timeline duration");
  const [finalRed, finalGreen, finalBlue] = averageRgbAt(final, 0.82);
  assert.ok(finalRed < 20 && finalGreen < 20 && finalBlue < 20,
    "mixing audio must not remove the black tail picture");
  assert.ok(audioRms(final, 0.73, 0.12) > 0.02, "positioned audio should play over the black tail");

  const loopFlagWithoutRepeat = path.join(tempRoot, "loop-flag-without-repeat.mp4");
  await mixTimelineAudio(extended, [{
    file: overlay,
    timelineStartSec: 0,
    durationSec: 0.1,
    sourceInSec: 0,
    sourceOutSec: 301,
    loop: true,
    volumeDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0
  }], loopFlagWithoutRepeat, { durationSec: 1.0 });
  assert.equal(fs.existsSync(loopFlagWithoutRepeat), true,
    "a loop flag must not prepare a large source range when the timeline clip does not repeat");

  await assert.rejects(
    mixTimelineAudio(extended, [{
      file: overlay,
      timelineStartSec: 0,
      durationSec: 302,
      sourceInSec: 0,
      sourceOutSec: 301,
      loop: true,
      volumeDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0
    }], path.join(tempRoot, "oversized-loop-region.mp4"), { durationSec: 302 }),
    /Loop regions must be 300 seconds or shorter/
  );

  const controller = new AbortController();
  controller.abort();
  const cancelledOutput = path.join(tempRoot, "cancelled-tail.mp4");
  await assert.rejects(
    appendBlackTail(picture, cancelledOutput, 0.5, {
      width: 96,
      height: 64,
      fps: 24,
      signal: controller.signal
    }),
    (error) => error?.code === "GENERATION_CANCELLED" && /cancelled/i.test(error.message)
  );
  assert.equal(fs.existsSync(cancelledOutput), false, "pre-aborted media work must not create an output");
});
