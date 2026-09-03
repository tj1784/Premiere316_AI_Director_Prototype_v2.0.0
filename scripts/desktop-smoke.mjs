import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots");
const reportPath = resolve(artifacts, "premiere316-desktop-smoke.json");
const screenshotPath = resolve(artifacts, "premiere316-windows-final.png");
const failures = [];
let lmStudioState = null;
let engineState = null;
let originalZoom = 1;

async function launch() {
  const application = await electron.launch({ executablePath });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  return { application, page };
}

async function zoomFactor(application) {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor());
}

async function sendShortcut(application, keyCode, modifiers = ["control"]) {
  await application.evaluate(({ BrowserWindow }, input) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    contents?.sendInputEvent({ type: "keyDown", keyCode: input.keyCode, modifiers: input.modifiers });
    contents?.sendInputEvent({ type: "keyUp", keyCode: input.keyCode, modifiers: input.modifiers });
  }, { keyCode, modifiers });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
}

async function openLastReel(page) {
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.getByText("The Last Reel", { exact: true }).first().waitFor();
}

await mkdir(artifacts, { recursive: true });

let first;
let second;
try {
  first = await launch();
  const { application, page } = first;
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, /PACKAGED_RENDERER_PROBE_316/, "temporary renderer marker is still packaged");
  const buildInfo = await page.evaluate(() => window.premiere316?.app.buildInfo());
  assert.equal(buildInfo?.rendererMode, "PACKAGED DIST");
  assert.equal(buildInfo?.executablePath, executablePath);
  originalZoom = await zoomFactor(application);
  await sendShortcut(application, "0");
  assert.equal(await zoomFactor(application), 1);

  await openLastReel(page);
  await page.getByRole("button", { name: "02 Screenplay" }).click();
  await page.getByText("Local writer", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Checking LM Studio local API"));
  assert.equal(await page.getByText("Timeline", { exact: true }).count(), 0, "timeline must be hidden outside Stitch");
  const modelOptions = await page.getByLabel("Screenplay model").locator("option").evaluateAll((options) => options.map((option) => ({ label: option.textContent, value: option.value, disabled: option.disabled })));
  assert.equal(modelOptions.slice(1).every((option) => option.disabled), true, "LM Studio unexpectedly exposed a served model");
  assert.equal(await page.getByRole("button", { name: "Generate Screenplay" }).isDisabled(), true, "screenplay generation must fail closed while LM Studio is offline");
  lmStudioState = { localCatalogCandidates: modelOptions.length - 1, servedModels: modelOptions.slice(1).filter((option) => !option.disabled).length, generationEnabled: false };
  await page.getByRole("button", { name: "04 Performance" }).click();
  await page.getByRole("heading", { name: "Performance" }).waitFor();
  await page.getByRole("button", { name: "05 Shots" }).click();
  await page.getByRole("heading", { name: "Shots" }).waitFor();
  assert.equal(await page.getByText("Timeline", { exact: true }).count(), 0, "timeline must be hidden from Shots");

  await page.getByRole("button", { name: "07 Generate" }).click();
  await page.getByRole("heading", { name: "Generate" }).waitFor();
  const generateStill = page.getByRole("button", { name: "Generate local still", exact: true }).first();
  if (!(await generateStill.isVisible().catch(() => false))) {
    const openInspector = page.getByRole("button", { name: "Open Inspector", exact: true });
    assert.equal(await openInspector.isVisible(), true, "Generate inspector is neither docked nor reachable");
    await openInspector.click();
  }
  await generateStill.click();
  const stillDialog = page.getByRole("dialog", { name: /Shot 01/ });
  await stillDialog.waitFor();
  await page.waitForFunction(() => {
    const options = [...document.querySelectorAll("#still-engine option")];
    return options.length > 8 || options.some((option) => !option.textContent?.includes("runtime adapter not yet implemented"));
  }, undefined, { timeout: 120_000 });
  const engineOptions = await page.locator("#still-engine option").evaluateAll((options) => options.map((option) => ({ label: option.textContent, disabled: option.disabled })));
  assert.match(engineOptions.map((option) => option.label).join("\n"), /flux1-dev/i);
  assert.match(engineOptions.map((option) => option.label).join("\n"), /flux2_dev/i);
  assert.match(engineOptions.map((option) => option.label).join("\n"), /klein-4b/i);
  assert.match(engineOptions.map((option) => option.label).join("\n"), /klein-9b/i);
  assert.match(await stillDialog.innerText(), /Selected configuration footprint/);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Expose plate");
    return button?.disabled === true;
  });
  const inspectedEngineOptions = await page.locator("#still-engine option").evaluateAll((options) => options.map((option) => ({ label: option.textContent, disabled: option.disabled })));
  const selectedEngineLabel = await page.locator("#still-engine option:checked").textContent();
  const stillDialogText = await stillDialog.innerText();
  engineState = {
    discoveredImageConfigurations: engineOptions.filter((option) => !option.label?.includes("runtime adapter not yet implemented")).length,
    adapterPlaceholders: engineOptions.filter((option) => option.label?.includes("runtime adapter not yet implemented")).length,
    selectableAfterRuntimeInspection: inspectedEngineOptions.filter((option) => !option.disabled).length,
    selectedConfiguration: selectedEngineLabel,
    selectedRuntimeBlocker: stillDialogText.match(/(?:MEMORY RISK|UNSUPPORTED OFFLINE)[\s\S]*?(?=\n(?:Expose plate|Cancel)|$)/)?.[0] ?? "generation disabled",
    generationEnabled: false,
  };
  await stillDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "08 Stitch" }).click();
  await page.getByRole("heading", { name: "Stitch" }).waitFor();
  await page.getByText("Timeline", { exact: true }).waitFor();
  await page.getByRole("button", { name: "05 Shots" }).click();
  await page.getByRole("heading", { name: "Shots" }).waitFor();

  await sendShortcut(application, "0");
  assert.equal(await zoomFactor(application), 1);
  await sendShortcut(application, "=");
  assert.equal(await zoomFactor(application), 1.1);
  await sendShortcut(application, "+", ["control", "shift"]);
  assert.equal(await zoomFactor(application), 1.25);
  await sendShortcut(application, "-");
  const persistedZoom = await zoomFactor(application);
  assert.equal(persistedZoom, 1.1);
  await application.close();
  first = null;

  second = await launch();
  const reopenedZoom = await zoomFactor(second.application);
  assert.equal(reopenedZoom, persistedZoom, "saved zoom did not survive restart");
  await second.page.getByRole("heading", { name: "Shots" }).waitFor();
  assert.match(await second.page.locator("body").innerText(), /Prepared video queue/i);
  await second.page.evaluate((factor) => window.premiere316?.zoom.set(factor), originalZoom);
  await second.page.waitForTimeout(150);
  assert.equal(await zoomFactor(second.application), originalZoom);
  await second.page.screenshot({ path: screenshotPath });

  const report = {
    ok: true,
    executablePath,
    buildInfo,
    zoom: { original: originalZoom, reset: 1, persisted: persistedZoom, reopened: reopenedZoom, restored: originalZoom },
    lmStudio: lmStudioState,
    engines: engineState,
    timeline: { hiddenOutsideStitch: true, visibleInStitch: true },
    persistedStage: "shots",
    consoleErrors: failures,
    screenshotPath,
  };
  assert.deepEqual(failures, []);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await first?.application.close().catch(() => {});
  await second?.application.close().catch(() => {});
}
