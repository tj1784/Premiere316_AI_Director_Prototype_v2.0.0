import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "m1-lite-import-export");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const networkLog = [];
const failures = [];

function assertIsolatedUserData(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  const real = REAL_PROFILE.replaceAll("/", "\\").toLowerCase();
  assert.ok(dir, "user-data directory is required");
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false, "refusing the real Premiere316 profile");
  if (real) assert.notEqual(normalized, real, "refusing to launch against %APPDATA%/Premiere316");
}

function run(command, args, timeoutMs = 60_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function resolveFfmpeg() {
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const probeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const found = await run(process.platform === "win32" ? "where" : "which", [name]).catch(() => ({ code: 1, stdout: "" }));
  const ffmpeg = found.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line && existsSync(line)) ?? null;
  const foundProbe = await run(process.platform === "win32" ? "where" : "which", [probeName]).catch(() => ({ code: 1, stdout: "" }));
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
  ffmpeg: null,
  ffprobe: null,
  imported: false,
  canonical: false,
  timeline: false,
  exported: false,
  outputPath: null,
  outputSha256: null,
  network: { port8188: 0, completionPosts: 0, cloudInference: 0 },
  error: null,
};

await mkdir(artifacts, { recursive: true });
const tools = await resolveFfmpeg();
report.ffmpeg = tools.ffmpeg;
report.ffprobe = tools.ffprobe;

if (!tools.ffmpeg || !tools.ffprobe) {
  report.error = "FFmpeg/FFprobe unavailable. M1-LITE export blocked; no download attempted.";
  await writeFile(join(artifacts, "export-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const fixtureDir = await mkdtemp(join(tmpdir(), "p316-m1-fixture-"));
const fixture = join(fixtureDir, "lite.mp4");
const made = await run(tools.ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=black:s=512x288:d=6:r=24", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fixture]);
if (made.code !== 0 || !existsSync(fixture)) {
  report.error = `Could not create fixture: ${made.stderr}`;
  await writeFile(join(artifacts, "export-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-m1-lite-"));
assertIsolatedUserData(userDataDir);

let application;
try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir, PREMIERE316_UAT_IMPORT: fixture },
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

  await selectStage(page, "generate", "10 Generate");
  await page.getByRole("button", { name: "Import video" }).click();
  await page.getByRole("heading", { name: "Review" }).waitFor({ timeout: 45000 });
  report.imported = true;
  await page.getByText(/Video takes/i).waitFor();
  const approve = page.getByLabel("Video takes").getByRole("button", { name: "Approve canonical" });
  await approve.click();
  await page.getByText(/Imported video marked canonical/i).waitFor({ timeout: 15000 });
  report.canonical = true;

  await selectStage(page, "timeline", "12 Stitch");
  await page.getByText(/imported/i).first().waitFor();
  report.timeline = true;

  await selectStage(page, "export", "14 Export");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => (button.textContent ?? "").includes("Export MP4") && !(button).disabled), null, { timeout: 20000 });
  await page.getByRole("button", { name: "Export MP4" }).click();
  await page.getByText(/Last export /i).waitFor({ timeout: 60000 });
  const body = await page.locator("body").innerText();
  const match = body.match(/Last export\s+(\S+)/);
  report.outputPath = match?.[1] ?? null;
  report.exported = Boolean(report.outputPath && existsSync(report.outputPath));
  if (report.outputPath && existsSync(report.outputPath)) {
    report.outputSha256 = createHash("sha256").update(readFileSync(report.outputPath)).digest("hex");
    report.outputBytes = statSync(report.outputPath).size;
  }

  const port8188 = networkLog.filter((entry) => /:8188(\/|$)/.test(entry.url));
  const completionPosts = networkLog.filter((entry) => entry.method === "POST" && /\/v1\/(chat\/)?completions/.test(entry.url));
  const cloud = networkLog.filter((entry) => /api\.x\.ai|openai\.com|anthropic|openrouter|elevenlabs/i.test(entry.url));
  report.network = { port8188: port8188.length, completionPosts: completionPosts.length, cloudInference: cloud.length };
  assert.equal(port8188.length, 0);
  assert.equal(completionPosts.length, 0);
  assert.equal(cloud.length, 0);
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(report.exported, true, "exported MP4 missing");
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}

await writeFile(join(artifacts, "export-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(artifacts, "import-uat.json"), `${JSON.stringify({ imported: report.imported, canonical: report.canonical }, null, 2)}\n`);
await writeFile(join(artifacts, "timeline-uat.json"), `${JSON.stringify({ timeline: report.timeline }, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, error: report.error, imported: report.imported, canonical: report.canonical, exported: report.exported, outputPath: report.outputPath, outputSha256: report.outputSha256 }, null, 2));
if (!report.ok) process.exitCode = 1;
