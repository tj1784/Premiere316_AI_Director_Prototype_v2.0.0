import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { enterAdvancedDepartments, returnToDefaultMode, selectStudioStage } from "./studio-nav.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "advanced-departments-not-main-workflow");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const failures = [];
const networkLog = [];

function assertIsolated(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false);
}

async function captureWindow(application, path) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const window = windows.find((candidate) => candidate.isVisible()) ?? windows[0];
    if (!window) throw new Error("Premiere316 BrowserWindow was not found");
    const image = await window.webContents.capturePage();
    return image.toPNG().toString("base64");
  });
  await writeFile(path, Buffer.from(png, "base64"));
}

async function setZoom(page, factor) {
  await page.evaluate((value) => window.premiere316?.zoom.set(value), factor);
  await page.waitForTimeout(350);
}

async function overflowFacts(page) {
  return page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1,
    bodyText: document.body?.innerText ?? "",
  }));
}

await mkdir(artifacts, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-adv-ux-"));
assertIsolated(userDataDir);

const report = {
  ok: false,
  defaultNav: [],
  defaultOnlyFive: false,
  advancedDashboardFirst: false,
  researchPrimaryCta: false,
  manualCollapsed: false,
  emptyStateNotWorksheet: false,
  offlineNotManualFirst: false,
  returnToDefault: false,
  overflow100: false,
  overflow150: false,
  network: { port8188: 0, cloud: 0, comfy: 0 },
  error: null,
};

let application;
try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("request", (request) => networkLog.push(request.url()));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();

  await setZoom(page, 1);
  report.defaultNav = await page.getByRole("navigation", { name: "Pipeline" }).locator("button").evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
  report.defaultOnlyFive = report.defaultNav.filter((label) => /Intake|Assets|First \/ Last|Video Clips|Export/.test(label)).length >= 5
    && !report.defaultNav.some((label) => /Research|Screenplay|Inventory|Prompt Lab|Stitch/.test(label));
  await captureWindow(application, join(artifacts, "default-mode.png"));
  const defaultFacts = await overflowFacts(page);
  report.overflow100 = defaultFacts.horizontalOverflow;

  await enterAdvancedDepartments(page);
  await page.locator("[data-advanced-dashboard]").waitFor();
  report.advancedDashboardFirst = true;
  const dashText = await page.locator("[data-advanced-dashboard]").innerText();
  assert.match(dashText, /optional inspection/i);
  assert.match(dashText, /Required in default mode/i);
  assert.doesNotMatch(dashText, /01 Intake[\s\S]*02 Research[\s\S]*03 Screenplay/);
  await captureWindow(application, join(artifacts, "advanced-dashboard.png"));

  await selectStudioStage(page, "research");
  await page.locator("[data-research-room]").waitFor();
  report.researchPrimaryCta = await page.getByRole("button", { name: "Run Local Research Room" }).first().isVisible();
  report.manualCollapsed = await page.locator("details[data-manual-source-entry]:not([open])").isVisible();
  report.emptyStateNotWorksheet = await page.locator("[data-research-empty-state]").isVisible();
  const researchText = await page.locator("[data-research-room]").innerText();
  assert.match(researchText, /Run Local Research Room/);
  assert.doesNotMatch(researchText.split("Advanced: manual source entry")[0] ?? researchText, /Locator \/ citation/);
  report.offlineNotManualFirst = /Local research model unavailable|Research Room|Not generated/i.test(researchText)
    && report.manualCollapsed;
  await captureWindow(application, join(artifacts, "advanced-research-empty.png"));
  await page.locator("details[data-manual-source-entry]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await captureWindow(application, join(artifacts, "advanced-research-manual-collapsed.png"));

  await returnToDefaultMode(page);
  await page.locator('[data-studio-shell="true"][data-ui-mode="default"]').waitFor();
  const afterReturn = await page.getByRole("navigation", { name: "Pipeline" }).locator("button").evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
  report.returnToDefault = afterReturn.some((label) => /Intake|Assets/.test(label)) && !afterReturn.some((label) => /Screenplay|Inventory|Prompt Lab/.test(label));

  await setZoom(page, 1.5);
  await enterAdvancedDepartments(page);
  await page.locator("[data-advanced-dashboard]").waitFor();
  const zoomFacts = await overflowFacts(page);
  report.overflow150 = zoomFacts.horizontalOverflow;

  report.network = {
    port8188: networkLog.filter((url) => /:8188/.test(url)).length,
    cloud: networkLog.filter((url) => /openai|anthropic|openrouter|api\.x\.ai/i.test(url)).length,
    comfy: networkLog.filter((url) => /comfy/i.test(url)).length,
  };
  assert.equal(report.defaultOnlyFive, true);
  assert.equal(report.advancedDashboardFirst, true);
  assert.equal(report.researchPrimaryCta, true);
  assert.equal(report.manualCollapsed, true);
  assert.equal(report.emptyStateNotWorksheet, true);
  assert.equal(report.returnToDefault, true);
  assert.equal(report.overflow100, false);
  assert.equal(report.overflow150, false);
  assert.equal(report.network.port8188, 0);
  assert.equal(report.network.cloud, 0);
  assert.equal(report.network.comfy, 0);
  assert.equal(failures.length, 0, failures.join("\n"));
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}

await writeFile(join(artifacts, "packaged-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
