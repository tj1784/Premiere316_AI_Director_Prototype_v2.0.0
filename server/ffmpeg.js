import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { BOOKEND_DURATION_SEC, BOOKEND_OPENING_TITLE } from "./bookends.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function run(bin, args, { cwd, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

export async function ffmpegAvailable() {
  try {
    await run(FFMPEG, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function probeMedia(file) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_frames,sample_rate,channels",
    "-of", "json",
    file
  ]);
  const data = JSON.parse(stdout || "{}");
  const durationSec = Number(data.format?.duration || 0);
  const video = (data.streams || []).find((s) => s.codec_type === "video") || null;
  const audio = (data.streams || []).find((s) => s.codec_type === "audio") || null;
  return { durationSec, video, audio, streams: data.streams || [] };
}

export async function trimVideoToFrames(input, output, frames, fps) {
  const info = await probeMedia(input);
  const args = ["-y", "-i", input];
  args.push("-map", "0:v:0", "-map", "0:a?");
  args.push(
    "-frames:v", String(Math.max(1, Math.round(frames))),
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p"
  );
  if (info.audio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  args.push("-movflags", "+faststart", output);
  await run(FFMPEG, args);
  return output;
}

async function normalizeVideo(input, output, {
  width,
  height,
  fps,
  startSec = 0,
  durationSec = null
}) {
  const info = await probeMedia(input);
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p`;
  const args = ["-y"];
  if (Number(startSec) > 0) args.push("-ss", Number(startSec).toFixed(6));
  if (Number(durationSec) > 0) args.push("-t", Number(durationSec).toFixed(6));
  args.push("-i", input);
  if (!info.audio) {
    const silenceDuration = Number(durationSec) > 0
      ? Number(durationSec)
      : Math.max(0.001, Number(info.durationSec) - Number(startSec || 0));
    args.push(
      "-f", "lavfi",
      "-t", silenceDuration.toFixed(6),
      "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"
    );
  }
  args.push("-map", "0:v:0", "-map", info.audio ? "0:a:0" : "1:a:0");
  args.push(
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    output
  );
  await run(FFMPEG, args);
  return output;
}

export async function concatVideos(inputs, output, settings, onProgress) {
  if (!inputs.length) throw new Error("No videos available to assemble");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-concat-"));
  try {
    const normalized = [];
    for (let i = 0; i < inputs.length; i++) {
      const target = path.join(tempRoot, `part_${String(i).padStart(3, "0")}.mp4`);
      await normalizeVideo(inputs[i], target, settings);
      normalized.push(target);
      if (onProgress) onProgress((i + 1) / (inputs.length + 1));
    }
    const listFile = path.join(tempRoot, "concat.txt");
    fs.writeFileSync(
      listFile,
      normalized.map((f) => `file '${String(f).replaceAll("'", "'\\''")}'`).join("\n")
    );
    await run(FFMPEG, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      "-movflags", "+faststart",
      output
    ]);
    if (onProgress) onProgress(1);
    return output;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Concatenate media that has already been normalized to identical H.264/AAC
 * settings. Master bookends use the same encoding parameters as the stitched
 * core, so this preserves the core film without a second video encode.
 */
export async function finalizeMasterMedia(input, output, expectedDurationSec) {
  const info = await probeMedia(input);
  const duration = Math.max(1 / 120, Number(expectedDurationSec) || Number(info.video?.duration) || Number(info.durationSec) || 1);
  const videoStart = Number(info.video?.start_time) || 0;
  const durationText = duration.toFixed(6);
  const args = [
    "-y",
    "-itsoffset", (-videoStart).toFixed(6),
    "-i", input
  ];
  if (info.audio) args.push("-i", input);
  args.push("-map", "0:v:0");
  if (info.audio) args.push("-map", "1:a:0");
  args.push("-c:v", "copy");
  if (info.audio) {
    args.push(
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-af:a", `atrim=0:${durationText},asetpts=PTS-STARTPTS`
    );
  } else {
    args.push("-an");
  }
  args.push(
    "-t", durationText,
    "-avoid_negative_ts", "disabled",
    "-movflags", "+faststart",
    output
  );
  await run(FFMPEG, args);
  return output;
}

export async function concatPreparedVideos(inputs, output, expectedDurationSec = null) {
  if (!inputs.length) throw new Error("No prepared videos available to assemble");
  for (const input of inputs) {
    if (!input || !fs.existsSync(input)) throw new Error(`Prepared video missing: ${input || "unknown"}`);
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-prepared-concat-"));
  try {
    const listFile = path.join(tempRoot, "concat.txt");
    const joinedFile = path.join(tempRoot, "joined.mp4");
    fs.writeFileSync(
      listFile,
      inputs.map((file) => `file '${String(file).replaceAll("'", "'\\''")}'`).join("\n")
    );
    await run(FFMPEG, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      "-movflags", "+faststart",
      joinedFile
    ]);
    let duration = Number(expectedDurationSec);
    if (!(duration > 0)) {
      const inputInfo = await Promise.all(inputs.map((input) => probeMedia(input)));
      duration = inputInfo.reduce((sum, info) =>
        sum + (Number(info.video?.duration) || Number(info.durationSec) || 0), 0);
    }
    return await finalizeMasterMedia(joinedFile, output, duration);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Assemble exact frame ranges from one or more source videos. This is used
 * when a newly rendered selection must replace only part of an accepted clip.
 */
export async function concatVideoSegments(segments, output, settings, onProgress) {
  if (!segments.length) throw new Error("No video segments available to assemble");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p316-segments-"));
  try {
    const normalized = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment?.file || !fs.existsSync(segment.file)) {
        throw new Error(`Video source missing: ${segment?.file || "unknown"}`);
      }
      const target = path.join(tempRoot, `part_${String(i).padStart(3, "0")}.mp4`);
      await normalizeVideo(segment.file, target, {
        ...settings,
        startSec: Math.max(0, Number(segment.startSec) || 0),
        durationSec: Math.max(1 / Number(settings.fps || 24), Number(segment.durationSec) || 0)
      });
      normalized.push(target);
      if (onProgress) onProgress((i + 1) / (segments.length + 1));
    }
    const listFile = path.join(tempRoot, "concat.txt");
    fs.writeFileSync(
      listFile,
      normalized.map((f) => `file '${String(f).replaceAll("'", "'\\''")}'`).join("\n")
    );
    await run(FFMPEG, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      "-movflags", "+faststart",
      output
    ]);
    if (onProgress) onProgress(1);
    return output;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function bookendFontFile(kind = "opening") {
  const windowsFonts = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
  const cinematic = [
    path.join(windowsFonts, "georgia.ttf"),
    path.join(windowsFonts, "segoeui.ttf"),
    path.join(windowsFonts, "arial.ttf")
  ];
  const readable = [
    path.join(windowsFonts, "segoeui.ttf"),
    path.join(windowsFonts, "arial.ttf"),
    path.join(windowsFonts, "georgia.ttf")
  ];
  const candidates = [
    process.env.PREMIERE316_BOOKEND_FONT,
    ...(kind === "credits" ? readable : cinematic),
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function wrapBookendText(value, maxCharacters) {
  const limit = Math.max(16, Math.round(maxCharacters));
  const wrapped = [];
  for (const sourceLine of String(value || "").split("\n")) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      wrapped.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const codepoints = Array.from(word);
      const chunks = [];
      for (let index = 0; index < codepoints.length; index += limit) {
        chunks.push(codepoints.slice(index, index + limit).join(""));
      }
      for (const chunk of chunks) {
        const candidate = line ? `${line} ${chunk}` : chunk;
        if (Array.from(candidate).length <= limit) {
          line = candidate;
        } else {
          if (line) wrapped.push(line);
          line = chunk;
        }
      }
    }
    if (line) wrapped.push(line);
  }
  return wrapped.join("\n");
}

/**
 * Render a deterministic, frame-accurate master slate. Text is passed through
 * a UTF-8 text file with drawtext expansion disabled, preventing both spelling
 * drift and FFmpeg filter injection from punctuation in editable credits.
 */
export async function renderMasterBookend({
  kind,
  output,
  text = "",
  width = 1280,
  height = 720,
  fps = 24
}) {
  if (kind !== "opening" && kind !== "credits") throw new Error(`Unknown master bookend kind: ${kind}`);
  const targetWidth = Math.max(2, Math.round(Number(width) || 1280));
  const targetHeight = Math.max(2, Math.round(Number(height) || 720));
  const targetFps = Math.max(1, Number(fps) || 24);
  const frameCount = Math.max(1, Math.round(BOOKEND_DURATION_SEC * targetFps));
  const fontSize = kind === "opening"
    ? Math.max(28, Math.round(targetHeight * 0.075))
    : Math.max(22, Math.round(targetHeight * 0.048));
  const rawText = String(text || "").trim() || "A Premiere316 Production";
  const maxCreditCharacters = Math.max(24, Math.floor((targetWidth * 0.86) / (fontSize * 0.62)));
  const displayText = kind === "opening"
    ? BOOKEND_OPENING_TITLE
    : wrapBookendText(rawText, maxCreditCharacters);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `p316-${kind}-`));
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const sourceFont = bookendFontFile(kind);
    let fontSetting = "font=serif";
    if (sourceFont) {
      fs.copyFileSync(sourceFont, path.join(tempRoot, "bookend-font.ttf"));
      fontSetting = "fontfile=bookend-font.ttf";
    }
    const drawTextFilters = [];
    if (kind === "opening") {
      fs.writeFileSync(path.join(tempRoot, "bookend-copy.txt"), displayText, "utf8");
      drawTextFilters.push(`drawtext=${fontSetting}:textfile=bookend-copy.txt:expansion=none:fontcolor=0xF4E7C7:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`);
    } else {
      const lines = displayText.split("\n");
      const lineAdvance = Math.max(fontSize + 8, Math.round(fontSize * 1.6));
      const blockHeight = Math.max(lineAdvance, lines.length * lineAdvance);
      lines.forEach((line, index) => {
        if (!line) return;
        const filename = `credit-line-${String(index).padStart(3, "0")}.txt`;
        fs.writeFileSync(path.join(tempRoot, filename), line, "utf8");
        drawTextFilters.push(`drawtext=${fontSetting}:textfile=${filename}:expansion=none:fontcolor=0xF1E7D2:fontsize=${fontSize}:x=(w-text_w)/2:y=h+${index * lineAdvance}-(h+${blockHeight})*t/${BOOKEND_DURATION_SEC}`);
      });
    }
    const fadeOutStart = BOOKEND_DURATION_SEC - 1;
    const filter = `vignette=PI/5,${drawTextFilters.join(",")},fade=t=in:st=0:d=1,fade=t=out:st=${fadeOutStart}:d=1,format=yuv420p`;
    const background = kind === "opening" ? "0x080B12" : "0x05070D";
    await run(FFMPEG, [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${background}:s=${targetWidth}x${targetHeight}:r=${targetFps}:d=${BOOKEND_DURATION_SEC}`,
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-vf", filter,
      "-frames:v", String(frameCount),
      "-t", String(BOOKEND_DURATION_SEC),
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-shortest",
      "-movflags", "+faststart",
      "-metadata", `comment=Premiere316 deterministic ${kind} bookend`,
      output
    ], { cwd: tempRoot });
    return output;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function generatePrototypeGuide({
  referenceFile,
  output,
  width = 1280,
  height = 720,
  role = "middle"
}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const roleFilters = {
    first: "eq=contrast=1.06:saturation=1.08:brightness=0.015",
    middle: "eq=contrast=1.09:saturation=1.12:brightness=0.02",
    last: "eq=contrast=1.08:saturation=0.98:brightness=-0.01"
  };
  if (referenceFile && fs.existsSync(referenceFile)) {
    await run(FFMPEG, [
      "-y",
      "-i", referenceFile,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${roleFilters[role] || roleFilters.middle},unsharp=5:5:0.35:5:5:0,vignette=PI/5`,
      "-frames:v", "1",
      output
    ]);
  } else {
    const color = role === "last" ? "0x17172b" : role === "first" ? "0x10233a" : "0x241640";
    await run(FFMPEG, [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${color}:s=${width}x${height}:d=1`,
      "-vf", "vignette=PI/4",
      "-frames:v", "1",
      output
    ]);
  }
  return output;
}

function scoreFrequencies(mood = "") {
  const text = String(mood).toLowerCase();
  if (text.includes("dark") || text.includes("tense")) return [55, 65.41, 98, 130.81];
  if (text.includes("hope") || text.includes("uplift")) return [110, 138.59, 164.81, 220];
  return [82.41, 123.47, 164.81, 246.94];
}

export async function generatePrototypeScore({
  output,
  durationSec,
  mood,
  tempo = 96,
  fadeInSec = 2,
  fadeOutSec = 3
}) {
  const duration = Math.max(1, Number(durationSec) || 1);
  const frequencies = scoreFrequencies(mood);
  const args = ["-y"];
  for (const frequency of frequencies) {
    args.push(
      "-f", "lavfi",
      "-i", `sine=frequency=${frequency}:duration=${duration}:sample_rate=48000`
    );
  }
  const fadeOutStart = Math.max(0, duration - Math.max(0, Number(fadeOutSec) || 0));
  const pulse = Math.max(0.04, Math.min(0.4, Number(tempo || 96) / 600));
  const chains = frequencies.map((_, i) =>
    `[${i}:a]volume=${0.035 + i * 0.009},lowpass=f=${650 + i * 180},tremolo=f=${pulse}:d=0.22[a${i}]`
  );
  const labels = frequencies.map((_, i) => `[a${i}]`).join("");
  const filter = `${chains.join(";")};${labels}amix=inputs=${frequencies.length}:normalize=0,aecho=0.8:0.88:1200:0.22,afade=t=in:st=0:d=${Math.max(0, fadeInSec)},afade=t=out:st=${fadeOutStart}:d=${Math.max(0, fadeOutSec)},alimiter=limit=0.8[out]`;
  args.push(
    "-filter_complex", filter,
    "-map", "[out]",
    "-c:a", "pcm_s16le",
    output
  );
  await run(FFMPEG, args);
  return output;
}

export async function mixScore(videoFile, scoreFile, output, {
  musicLevelDb = -18,
  fadeInSec = 2,
  fadeOutSec = 3,
  duckUnderDialogue = true
} = {}) {
  const videoInfo = await probeMedia(videoFile);
  const duration = videoInfo.durationSec || 1;
  const fadeOutStart = Math.max(0, duration - Math.max(0, Number(fadeOutSec) || 0));
  const volume = Math.pow(10, Number(musicLevelDb || -18) / 20);
  const musicPrep = `[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${volume},afade=t=in:st=0:d=${Math.max(0, fadeInSec)},afade=t=out:st=${fadeOutStart}:d=${Math.max(0, fadeOutSec)}[music]`;
  let mix;
  if (duckUnderDialogue && videoInfo.audio) {
    mix = `${musicPrep};[music][0:a]sidechaincompress=threshold=0.035:ratio=8:attack=25:release=450[ducked];[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
  } else if (videoInfo.audio) {
    mix = `${musicPrep};[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
  } else {
    mix = `${musicPrep};[music]anull[aout]`;
  }
  await run(FFMPEG, [
    "-y",
    "-i", videoFile,
    "-stream_loop", "-1",
    "-i", scoreFile,
    "-filter_complex", mix,
    "-map", "0:v:0",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    output
  ]);
  return output;
}
