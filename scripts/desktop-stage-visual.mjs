import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "stage-visual");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");

const IMPLEMENTED_STAGES = [
  { id: "intake", button: "01 Intake", left: "none", right: "none", timeline: false },
  { id: "research", button: "02 Research", left: "none", right: "none", timeline: false },
  { id: "screenplay", button: "03 Screenplay", left: "none", right: "none", timeline: false },
  { id: "inventory", button: "04 Inventory", left: "none", right: "none", timeline: false },
  { id: "visual-development", button: "05 Visual Dev", left: "none", right: "none", timeline: false },
  { id: "cinematography", button: "06 Cinematography", left: "none", right: "none", timeline: false },
  { id: "performance", button: "07 Performance", left: "none", right: "none", timeline: false },
  { id: "shots", button: "08 Shots", left: "none", right: "none", timeline: false },
  { id: "prompts", button: "09 Prompt Lab", left: "none", right: "none", timeline: false },
  { id: "generate", button: "10 Generate", left: "generation", right: "generation", timeline: false },
  { id: "review", button: "11 Review", left: "none", right: "none", timeline: false },
  { id: "timeline", button: "12 Stitch", left: "media", right: "clip", timeline: true },
  { id: "score", button: "13 Score", left: "none", right: "none", timeline: false },
  { id: "export", button: "14 Export", left: "none", right: "none", timeline: false },
];

function assertIsolatedUserData(userDataDir) {
  const normalized = userDataDir.replaceAll("/", "\\").toLowerCase();
  const real = REAL_PROFILE.replaceAll("/", "\\").toLowerCase();
  assert.ok(userDataDir, "user-data directory is required");
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false, "refusing the real Premiere316 profile");
  if (real) assert.notEqual(normalized, real, "refusing to launch against %APPDATA%/Premiere316");
}

async function launch(userDataDir, report) {
  assertIsolatedUserData(userDataDir);
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await application.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launchedUserData = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  return { application, page, launchedUserData };
}

async function setZoom(page, factor) {
  await page.evaluate((value) => window.premiere316?.zoom.set(value), factor);
  await page.waitForTimeout(350);
}

async function openLastReel(page) {
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();
}

async function selectStage(page, stage) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: stage.button, exact: true });
  if (await wideButton.isVisible().catch(() => false)) {
    await wideButton.click();
  } else {
    await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(stage.id);
  }
  await page.waitForFunction((id) => document.querySelector('[data-studio-shell="true"]')?.getAttribute("data-stage") === id, stage.id);
  if (stage.timeline) await page.locator('[data-panel-kind="timeline"]').waitFor();
  await page.waitForTimeout(100);
}

async function visualFacts(page, stage, zoomPercent) {
  return page.evaluate(({ expected, zoom }) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const shell = document.querySelector('[data-studio-shell="true"]');
    const nav = document.querySelector('nav[aria-label="Pipeline"]');
    const activeButton = nav?.querySelector('button[aria-current="step"]');
    const compactSelect = nav?.querySelector('select[aria-label="Pipeline stage"]');
    const activeControl = visible(activeButton) ? activeButton : visible(compactSelect) ? compactSelect : null;
    const activeRect = activeControl?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const visiblePanelKinds = [...document.querySelectorAll("[data-panel-kind]")]
      .filter(visible)
      .map((element) => element.getAttribute("data-panel-kind"));
    const visibleButtons = [...document.querySelectorAll("button")]
      .filter(visible)
      .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim());
    const prohibitedCloudActions = visibleButtons.filter((label) => ["Rewrite", "Animate 10–15s", "Ask", "Spot the picture", "Rewrite cue sheet", "I2V"].includes(label));
    return {
      expectedStage: expected.id,
      actualStage: shell?.getAttribute("data-stage") ?? null,
      leftPanel: shell?.getAttribute("data-left-panel") ?? null,
      rightPanel: shell?.getAttribute("data-right-panel") ?? null,
      timelineVisible: visiblePanelKinds.includes("timeline"),
      visiblePanelKinds,
      activeControlTag: activeControl?.tagName ?? null,
      activeControlVisible: Boolean(activeRect && activeRect.left >= -1 && activeRect.right <= viewportWidth + 1),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth,
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1,
      prohibitedCloudActions,
      zoomPercent: zoom,
    };
  }, { expected: stage, zoom: zoomPercent });
}

function validateFacts(facts, expected) {
  const violations = [];
  if (facts.actualStage !== expected.id) violations.push(`active stage ${facts.actualStage} != ${expected.id}`);
  if (facts.leftPanel !== expected.left) violations.push(`left policy ${facts.leftPanel} != ${expected.left}`);
  if (facts.rightPanel !== expected.right) violations.push(`right policy ${facts.rightPanel} != ${expected.right}`);
  if (facts.timelineVisible !== expected.timeline) violations.push(`timeline visibility ${facts.timelineVisible} != ${expected.timeline}`);
  if (!facts.activeControlVisible) violations.push("active stage control is outside the viewport");
  if (facts.horizontalOverflow) violations.push(`document horizontal overflow ${facts.documentWidth} > ${facts.viewportWidth}`);
  if (facts.prohibitedCloudActions.length) violations.push(`cloud-only actions visible: ${facts.prohibitedCloudActions.join(", ")}`);
  if (expected.id === "generate" && facts.zoomPercent === 100) {
    const generationPanels = facts.visiblePanelKinds.filter((kind) => kind === "generation").length;
    if (generationPanels !== 2) violations.push(`Generate expected two docked generation panels, found ${generationPanels}`);
  }
  if (expected.id === "timeline" && facts.zoomPercent === 100) {
    if (!facts.visiblePanelKinds.includes("media")) violations.push("Stitch media bin is not visible");
    if (!facts.visiblePanelKinds.includes("clip")) violations.push("Stitch clip inspector is not visible");
    if (facts.visiblePanelKinds.includes("generation")) violations.push("Stitch leaked generation chrome");
  }
  if (expected.id !== "generate" && expected.id !== "timeline" && facts.visiblePanelKinds.some((kind) => kind === "generation" || kind === "media" || kind === "clip")) {
    violations.push(`unexpected shell panel on ${expected.id}`);
  }
  return violations;
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

async function captureStages(application, page, zoomPercent, report) {
  for (const stage of IMPLEMENTED_STAGES) {
    await selectStage(page, stage);
    const path = join(artifacts, `${stage.id}-${zoomPercent}.png`);
    const facts = await visualFacts(page, stage, zoomPercent);
    const violations = validateFacts(facts, stage);
    await captureWindow(application, path);
    report.screenshots.push({ stage: stage.id, zoomPercent, path, facts, violations });
    for (const violation of violations) report.violations.push(`${stage.id}@${zoomPercent}: ${violation}`);
  }
}

const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-stage-visual-"));
assertIsolatedUserData(userDataDir);
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

let application;
const report = {
  ok: false,
  executablePath,
  userDataDir,
  launchedUserData: null,
  realProfileUntouched: REAL_PROFILE,
  stages: IMPLEMENTED_STAGES.map((stage) => stage.id),
  screenshots: [],
  violations: [],
  consoleErrors: [],
  pageErrors: [],
  error: null,
};

try {
  const launched = await launch(userDataDir, report);
  application = launched.application;
  const { page } = launched;
  report.launchedUserData = launched.launchedUserData;
  await setZoom(page, 1);
  await openLastReel(page);
  await captureStages(application, page, 100, report);
  await setZoom(page, 1.5);
  await captureStages(application, page, 150, report);
  report.ok = report.screenshots.length === IMPLEMENTED_STAGES.length * 2
    && report.violations.length === 0
    && report.consoleErrors.length === 0
    && report.pageErrors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
} finally {
  if (application) await application.close().catch(() => {});
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
