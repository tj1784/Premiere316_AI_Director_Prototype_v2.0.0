import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { enterAdvancedDepartments, returnToDefaultMode, selectStudioStage } from "./studio-nav.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "remove-research-mode-options-entirely");
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

async function overflowFacts(page) {
  return page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1,
    bodyText: document.body?.innerText ?? "",
  }));
}

await mkdir(artifacts, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-no-research-mode-"));
assertIsolated(userDataDir);

const report = {
  ok: false,
  defaultFive: false,
  advancedDashboard: false,
  noModePanel: false,
  noWebAssisted: false,
  noLocalOption: false,
  noDropdown: false,
  primaryCta: null,
  manualCollapsed: false,
  overflow: false,
  consoleErrors: 0,
  network: { port8188: 0, cloud: 0, comfy: 0, web: 0 },
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

  const defaultNav = await page.getByRole("navigation", { name: "Pipeline" }).locator("button").evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
  report.defaultFive = defaultNav.filter((label) => /Intake|Assets|First \/ Last|Video Clips|Export/.test(label)).length >= 5
    && !defaultNav.some((label) => /Research|Screenplay|Inventory|Prompt Lab|Stitch/.test(label));

  await enterAdvancedDepartments(page);
  await page.locator("[data-advanced-dashboard]").waitFor();
  report.advancedDashboard = true;

  await selectStudioStage(page, "research");
  await page.locator("[data-research-room]").waitFor();
  const research = page.locator("[data-research-room]");
  const researchText = await research.innerText();
  report.noModePanel = (await page.locator('[data-research-room][data-research-mode-panel="false"]').count()) === 1
    && !/(^|\n)\s*MODE\s*(\n|$)/.test(researchText);
  report.noWebAssisted = !/web-assisted|web assisted/i.test(researchText);
  report.noLocalOption = !/Local Research|Local only|Local \/ user-provided|Local model research/i.test(researchText);
  report.noDropdown = (await page.getByRole("combobox", { name: "Research mode" }).count()) === 0
    && (await research.getByLabel("Research mode").count()) === 0;
  report.primaryCta = await page.getByRole("button", { name: "Build Research Draft" }).first().isVisible() ? "Build Research Draft" : null;
  report.manualCollapsed = await page.locator("details[data-manual-source-entry]:not([open])").isVisible();
  const facts = await overflowFacts(page);
  report.overflow = facts.horizontalOverflow;
  report.consoleErrors = failures.length;
  assert.match(researchText, /Build Research Draft/);
  assert.match(researchText, /Manual Notes/);
  assert.doesNotMatch(researchText, /Web-assisted|Research mode|Local Research Room|Local only/i);
  await captureWindow(application, join(artifacts, "research-after.png"));

  await returnToDefaultMode(page);
  await page.locator('[data-studio-shell="true"][data-ui-mode="default"]').waitFor();

  const remote = networkLog.filter((url) => /^https?:/i.test(url) && !/localhost|127\.0\.0\.1/i.test(url));
  report.network = {
    port8188: networkLog.filter((url) => /:8188/.test(url)).length,
    cloud: networkLog.filter((url) => /openai|anthropic|openrouter|api\.x\.ai/i.test(url)).length,
    comfy: networkLog.filter((url) => /comfy/i.test(url)).length,
    web: remote.filter((url) => /openai|anthropic|openrouter|api\.x\.ai|elevenlabs/i.test(url)).length,
    remoteUrls: remote,
  };
  assert.equal(report.defaultFive, true);
  assert.equal(report.advancedDashboard, true);
  assert.equal(report.noModePanel, true);
  assert.equal(report.noWebAssisted, true);
  assert.equal(report.noLocalOption, true);
  assert.equal(report.noDropdown, true);
  assert.equal(report.primaryCta, "Build Research Draft");
  assert.equal(report.manualCollapsed, true);
  assert.equal(report.overflow, false);
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

const cloudProof = {
  ok: report.ok && report.network.port8188 === 0 && report.network.cloud === 0 && report.network.comfy === 0,
  port8188: report.network.port8188,
  cloud: report.network.cloud,
  comfy: report.network.comfy,
  webNonLoopback: report.network.web,
};

await writeFile(join(artifacts, "packaged-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(artifacts, "no-cloud-no-web-no-comfy-no-8188-proof.json"), `${JSON.stringify(cloudProof, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
