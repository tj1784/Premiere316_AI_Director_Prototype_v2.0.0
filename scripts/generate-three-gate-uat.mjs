import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "generate-three-gate-cohesion");
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

async function selectStage(page, id, buttonName) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: buttonName, exact: true });
  if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
  else await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(id);
}

const report = { ok: false, assets: false, keyframes: false, video: false, waived: false, importVisible: false, queueLocked: false, deepLinks: false, network: { port8188: 0, completionPosts: 0 }, error: null };
await mkdir(artifacts, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-gates-"));
assertIsolatedUserData(userDataDir);
let application;
try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("request", (request) => networkLog.push({ method: request.method(), url: request.url() }));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launched = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launched);
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();

  await selectStage(page, "inventory", "04 Inventory");
  await page.getByRole("button", { name: "Open Generate / Assets" }).click();
  await page.getByRole("button", { name: "Asset Pass" }).waitFor();
  report.assets = true;
  report.deepLinks = true;

  await selectStage(page, "shots", "08 Shots");
  await page.getByRole("button", { name: "Open Generate / First-Last Frames" }).click();
  await page.getByText(/First\/Last frames lock video generate/i).waitFor();
  report.keyframes = true;
  await page.getByRole("button", { name: "Waive pair for import" }).first().click();
  await page.getByText(/Keyframe pair waived/i).waitFor();
  report.waived = true;

  await selectStage(page, "review", "11 Review");
  await page.getByRole("button", { name: "Open Generate / Video Clips" }).click();
  await page.getByText(/Wave 5 · Video queue/i).waitFor();
  report.video = true;
  await page.getByRole("button", { name: "Import video" }).waitFor();
  report.importVisible = true;
  report.queueLocked = await page.getByRole("button", { name: "Queue missing video" }).isEnabled();

  await selectStage(page, "export", "14 Export");
  await page.getByRole("button", { name: /IMPORTED · Video|BLOCKED · Video|READY · Video|Video/i }).first().click().catch(() => {});

  report.network.port8188 = networkLog.filter((entry) => /:8188(\/|$)/.test(entry.url)).length;
  report.network.completionPosts = networkLog.filter((entry) => entry.method === "POST" && /\/v1\/(chat\/)?completions/.test(entry.url)).length;
  assert.equal(report.network.port8188, 0);
  assert.equal(report.network.completionPosts, 0);
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(report.assets && report.keyframes && report.video && report.importVisible, true);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}
await writeFile(join(artifacts, "generate-assets-uat.json"), `${JSON.stringify({ assets: report.assets }, null, 2)}\n`);
await writeFile(join(artifacts, "generate-keyframes-uat.json"), `${JSON.stringify({ keyframes: report.keyframes, waived: report.waived }, null, 2)}\n`);
await writeFile(join(artifacts, "generate-video-uat.json"), `${JSON.stringify({ video: report.video, importVisible: report.importVisible, nativeQueueEnabled: report.queueLocked }, null, 2)}\n`);
await writeFile(join(artifacts, "stale-invalidation-uat.json"), `${JSON.stringify({ unitTests: "src/lib/production/generate-gates.test.ts" }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
