import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "m1-plus-30s");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const networkLog = [];
const failures = [];

function assertIsolatedUserData(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  const real = REAL_PROFILE.replaceAll("/", "\\").toLowerCase();
  assert.ok(dir);
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false);
  if (real) assert.notEqual(normalized, real);
}

function run(command, args, timeoutMs = 60_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); resolveRun({ code: code ?? 1, stdout, stderr }); });
  });
}

async function resolveFfmpeg() {
  const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const probeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const found = await run(process.platform === "win32" ? "where" : "which", [ffmpegName]).catch(() => ({ stdout: "" }));
  const ffmpeg = found.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line && existsSync(line)) ?? null;
  const foundProbe = await run(process.platform === "win32" ? "where" : "which", [probeName]).catch(() => ({ stdout: "" }));
  const ffprobe = foundProbe.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line && existsSync(line)) ?? null;
  return { ffmpeg, ffprobe };
}

async function selectStage(page, id, buttonName) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: buttonName, exact: true });
  if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
  else await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(id);
}

const report = {
  ok: false,
  importedVideos: 0,
  importedAudio: false,
  canonicalVideo: 0,
  canonicalAudio: false,
  timelineDuration: null,
  exported: false,
  outputPath: null,
  outputSha256: null,
  hasAudio: false,
  durationSec: null,
  network: { port8188: 0, completionPosts: 0, cloudInference: 0 },
  error: null,
};

await mkdir(artifacts, { recursive: true });
const tools = await resolveFfmpeg();
if (!tools.ffmpeg || !tools.ffprobe) {
  report.error = "FFmpeg/FFprobe unavailable.";
  await writeFile(join(artifacts, "export-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const fixtureDir = await mkdtemp(join(tmpdir(), "p316-m1-plus-"));
const videos = ["black", "navy", "gray"].map((color, index) => join(fixtureDir, `clip-${index + 1}.mp4`));
for (const [index, file] of videos.entries()) {
  const color = ["black", "0x102040", "0x333333"][index];
  const made = await run(tools.ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=512x288:d=10:r=24`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", file]);
  if (made.code !== 0 || !existsSync(file)) throw new Error(`clip ${index} failed: ${made.stderr}`);
}
const audio = join(fixtureDir, "score.wav");
const madeAudio = await run(tools.ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-c:a", "pcm_s16le", audio]);
if (madeAudio.code !== 0 || !existsSync(audio)) throw new Error(`audio failed: ${madeAudio.stderr}`);

const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-m1-plus-"));
assertIsolatedUserData(userDataDir);
let application;
try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_DIR: userDataDir,
      PREMIERE316_UAT_IMPORT_VIDEOS: videos.join(";"),
      PREMIERE316_UAT_IMPORT_AUDIO: audio,
    },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("request", (request) => networkLog.push({ method: request.method(), url: request.url() }));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launchedUserData = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  report.userDataDir = launchedUserData;
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();
  const advanced = page.getByRole("button", { name: "Advanced Departments" });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();

  for (let index = 0; index < 3; index += 1) {
    await selectStage(page, "generate", "10 Generate");
    await page.getByRole("button", { name: "Import video" }).click();
    await page.getByRole("heading", { name: "Review" }).waitFor({ timeout: 45000 });
    report.importedVideos += 1;
  }

  await selectStage(page, "review", "11 Review");
  for (let guard = 0; guard < 6; guard += 1) {
    const videoApproves = page.getByLabel("Video takes").getByRole("button", { name: "Approve canonical" });
    const videoCount = await videoApproves.count();
    let clicked = false;
    for (let index = 0; index < videoCount; index += 1) {
      const button = videoApproves.nth(index);
      if (await button.isEnabled()) {
        await button.click();
        report.canonicalVideo += 1;
        clicked = true;
        await page.getByText(/Imported video marked canonical/i).waitFor({ timeout: 8000 }).catch(() => {});
        break;
      }
    }
    if (!clicked) break;
  }

  await selectStage(page, "score", "13 Score");
  await page.getByRole("button", { name: "Import audio" }).click();
  await page.getByRole("heading", { name: "Review" }).waitFor({ timeout: 45000 });
  report.importedAudio = true;
  const audioApprove = page.getByLabel("Audio takes").getByRole("button", { name: "Approve canonical" });
  await audioApprove.click();
  await page.getByText(/Imported audio marked canonical/i).waitFor({ timeout: 15000 });
  report.canonicalAudio = true;

  await selectStage(page, "timeline", "12 Stitch");
  const stitch = await page.locator("body").innerText();
  const durationMatch = stitch.match(/Imported film ([0-9.]+)s/);
  report.timelineDuration = durationMatch ? Number(durationMatch[1]) : null;

  await selectStage(page, "export", "14 Export");
  report.exportPage = (await page.locator("body").innerText()).slice(0, 2500);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes("Export 30s film") && !button.disabled), null, { timeout: 20000 });
  await page.getByRole("button", { name: "Export 30s film" }).click();
  await page.getByText(/Last export /i).waitFor({ timeout: 90000 });
  const body = await page.locator("body").innerText();
  const match = body.match(/Last export\s+(\S+)/);
  report.outputPath = match?.[1] ?? null;
  report.exported = Boolean(report.outputPath && existsSync(report.outputPath));
  if (report.outputPath && existsSync(report.outputPath)) {
    report.outputSha256 = createHash("sha256").update(readFileSync(report.outputPath)).digest("hex");
    report.outputBytes = statSync(report.outputPath).size;
    const probe = await run(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", report.outputPath]);
    await writeFile(join(artifacts, "ffprobe-output.json"), probe.stdout || "{}");
    const parsed = JSON.parse(probe.stdout || "{}");
    report.durationSec = Number(parsed.format?.duration ?? 0);
    report.hasAudio = Array.isArray(parsed.streams) && parsed.streams.some((stream) => stream.codec_type === "audio");
  }

  report.network = {
    port8188: networkLog.filter((entry) => /:8188(\/|$)/.test(entry.url)).length,
    completionPosts: networkLog.filter((entry) => entry.method === "POST" && /\/v1\/(chat\/)?completions/.test(entry.url)).length,
    cloudInference: networkLog.filter((entry) => /api\.x\.ai|openai\.com|anthropic|openrouter|elevenlabs/i.test(entry.url)).length,
  };
  assert.equal(report.network.port8188, 0);
  assert.equal(report.network.completionPosts, 0);
  assert.equal(report.network.cloudInference, 0);
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(report.importedVideos, 3);
  assert.equal(report.canonicalVideo >= 3, true);
  assert.equal(report.importedAudio, true);
  assert.equal(report.canonicalAudio, true);
  assert.equal(report.exported, true);
  assert.equal(report.hasAudio, true);
  assert.ok(report.durationSec && report.durationSec >= 29 && report.durationSec <= 31);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}

await writeFile(join(artifacts, "export-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(artifacts, "video-import-uat.json"), `${JSON.stringify({ importedVideos: report.importedVideos, canonicalVideo: report.canonicalVideo }, null, 2)}\n`);
await writeFile(join(artifacts, "audio-import-uat.json"), `${JSON.stringify({ importedAudio: report.importedAudio, canonicalAudio: report.canonicalAudio }, null, 2)}\n`);
await writeFile(join(artifacts, "timeline-uat.json"), `${JSON.stringify({ timelineDuration: report.timelineDuration }, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, error: report.error, importedVideos: report.importedVideos, canonicalVideo: report.canonicalVideo, importedAudio: report.importedAudio, exported: report.exported, durationSec: report.durationSec, hasAudio: report.hasAudio, outputSha256: report.outputSha256 }, null, 2));
if (!report.ok) process.exitCode = 1;
