import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "wave5-closeout");
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

async function launch(dir) {
  assertIsolatedUserData(dir);
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${dir}`],
    env: { ...process.env, ELECTRON_USER_DATA_DIR: dir },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("request", (request) => networkLog.push({ method: request.method(), url: request.url() }));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launchedUserData = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  return { application, page, launchedUserData };
}

async function selectStage(page, id, buttonName) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: buttonName, exact: true });
  if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
  else await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(id);
}

const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-wave5-closeout-"));
assertIsolatedUserData(userDataDir);
await mkdir(artifacts, { recursive: true });

const report = {
  ok: false,
  executablePath,
  userDataDir,
  realProfileUntouched: REAL_PROFILE,
  promptLabCompiled: false,
  generateVideoQueueVisible: false,
  reviewVideoTakesVisible: false,
  ltxFailClosedVisible: false,
  h3FailClosedInPage: false,
  stillNotPresentedAsVideo: true,
  queuedWithoutMedia: false,
  network: { port8188: 0, completionPosts: 0, observed: [] },
  consoleErrors: failures,
  error: null,
};

let application;
try {
  const launched = await launch(userDataDir);
  application = launched.application;
  const { page } = launched;
  report.launchedUserData = launched.launchedUserData;
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();

  await selectStage(page, "prompts", "09 Prompt Lab");
  await page.getByRole("button", { name: "Compile drafts" }).click();
  await page.getByText(/Deterministic Llama-default compiler wrote still and motion drafts/i).waitFor({ timeout: 15000 });
  report.promptLabCompiled = true;

  await selectStage(page, "generate", "10 Generate");
  await page.getByText(/Wave 5 · Video queue/i).waitFor();
  report.generateVideoQueueVisible = true;
  const generateText = await page.locator("body").innerText();
  report.ltxFailClosedVisible = /LTX 2\.5[\s\S]*fail-closed/i.test(generateText) || /Video generation stays fail-closed/i.test(generateText);
  report.h3FailClosedInPage = /MiniMax H3[\s\S]*fail-closed|no app-owned official native H3 runtime/i.test(generateText);
  assert.equal(report.ltxFailClosedVisible, true, "LTX fail-closed copy missing on Generate");
  assert.equal(/Queue missing video/.test(generateText), true, "video queue control missing");
  await page.getByRole("button", { name: "Queue missing video" }).click();
  await page.getByText(/Video jobs were queued and fail-closed/i).waitFor({ timeout: 15000 });

  await selectStage(page, "review", "11 Review");
  await page.getByText(/Video takes/i).waitFor();
  report.reviewVideoTakesVisible = true;
  const reviewText = await page.locator("body").innerText();
  assert.match(reviewText, /No durable video media|FAILED|fail-closed|No genuine video/i);
  assert.doesNotMatch(reviewText, /canonical video approved/i);
  report.queuedWithoutMedia = /No durable video media/.test(reviewText);
  report.stillNotPresentedAsVideo = !/this still is the video take/i.test(reviewText);

  await selectStage(page, "timeline", "12 Stitch");
  await page.getByText("Timeline", { exact: true }).waitFor();

  const port8188 = networkLog.filter((entry) => /:8188(\/|$)/.test(entry.url) || entry.url.includes(":8188/"));
  const completionPosts = networkLog.filter((entry) => entry.method === "POST" && /\/v1\/(chat\/)?completions/.test(entry.url));
  const cloud = networkLog.filter((entry) => /api\.x\.ai|openai\.com|anthropic|openrouter/i.test(entry.url));
  report.network = {
    port8188: port8188.length,
    completionPosts: completionPosts.length,
    cloudInference: cloud.length,
    observed: networkLog.slice(0, 40),
  };
  assert.equal(port8188.length, 0, `port 8188 contacted: ${JSON.stringify(port8188)}`);
  assert.equal(completionPosts.length, 0, `completion POST: ${JSON.stringify(completionPosts)}`);
  assert.equal(cloud.length, 0, `cloud inference: ${JSON.stringify(cloud)}`);
  assert.equal(failures.length, 0, failures.join("\n"));
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}

await writeFile(join(artifacts, "wave5-fail-closed-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, error: report.error, promptLabCompiled: report.promptLabCompiled, generateVideoQueueVisible: report.generateVideoQueueVisible, ltxFailClosedVisible: report.ltxFailClosedVisible, h3FailClosedInPage: report.h3FailClosedInPage, reviewVideoTakesVisible: report.reviewVideoTakesVisible, network: { port8188: report.network.port8188, completionPosts: report.network.completionPosts, cloudInference: report.network.cloudInference } }, null, 2));
if (!report.ok) process.exitCode = 1;
