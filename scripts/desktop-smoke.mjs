import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots");
const reportPath = resolve(artifacts, "premiere316-desktop-smoke.json");
const screenshotPath = resolve(artifacts, "premiere316-windows-final.png");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const failures = [];
const networkLog = [];
let lmStudioState = null;
let engineState = null;
let originalZoom = 1;
let userDataDir = "";

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
  page.on("request", (request) => {
    networkLog.push({ method: request.method(), url: request.url() });
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launchedUserData = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  return { application, page, launchedUserData };
}

async function selectStage(page, id, buttonName) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: buttonName, exact: true });
  if (await wideButton.isVisible().catch(() => false)) {
    await wideButton.click();
  } else {
    await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(id);
  }
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

userDataDir = await mkdtemp(join(tmpdir(), "premiere316-wave2-smoke-"));
assertIsolatedUserData(userDataDir);
await mkdir(artifacts, { recursive: true });

let first;
let second;
try {
  first = await launch(userDataDir);
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
  await selectStage(page, "research", "02 Research");
  await page.getByText("Picture Research", { exact: false }).first().waitFor();
  await page.getByText("Draft", { exact: true }).first().waitFor();
  await page.getByText("Local only", { exact: true }).first().waitFor();
  await selectStage(page, "screenplay", "03 Screenplay");
  await page.waitForFunction(() => document.querySelector('[data-studio-shell="true"]')?.getAttribute('data-stage') === 'screenplay');
  await page.getByRole("button", { name: "Generate Screenplay" }).waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Checking LM Studio local API"));
  assert.equal(await page.getByText("Timeline", { exact: true }).count(), 0, "timeline must be hidden outside Stitch");
  await page.getByText("Approve Picture Research before generating a screenplay.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Generate Screenplay" }).isDisabled(), true, "unapproved research must block screenplay generation");
  await selectStage(page, "research", "02 Research");
  await page.getByRole("button", { name: "Approve research" }).click();
  await page.getByText("Research approved", { exact: true }).first().waitFor();
  await selectStage(page, "screenplay", "03 Screenplay");
  await page.waitForFunction(() => document.querySelector('[data-studio-shell="true"]')?.getAttribute('data-stage') === 'screenplay');
  await page.getByRole("button", { name: "Generate Screenplay" }).waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Checking LM Studio local API"));
  const generate = page.getByRole("button", { name: "Generate Screenplay" });
  assert.equal(await generate.isDisabled(), true, "generation must stay disabled after research approval without a reachable pinned Llama ID");
  assert.match(await generate.getAttribute("title") ?? "", /LM Studio local API is offline|Pin the full currently served Llama model ID/);
  await page.getByText("No writer ID pinned. Premiere316 will not load a model.").waitFor();
  await page.getByText("No Story Doctor ID pinned.").waitFor();
  assert.equal(await page.getByLabel("Writer").locator("option").first().textContent(), "Default writer · Llama 3.3 70B Instruct");
  assert.equal(await page.getByLabel("Story Doctor model").locator("option").first().textContent(), "Default QA · Llama 3.3 70B Instruct");
  await page.getByText(/LM Studio local API is offline\. Story Doctor stays disabled\./).waitFor();
  assert.equal(await page.getByRole("button", { name: "Run story doctor" }).isDisabled(), true, "Story Doctor must fail closed while LM Studio is offline");
  assert.equal(await page.getByRole("button", { name: "Apply scoped revision" }).isDisabled(), true, "scoped apply must stay disabled without a critique");
  const modelOptions = await page.getByLabel("Writer").locator("option").evaluateAll((options) => options.map((option) => ({ label: option.textContent, value: option.value, disabled: option.disabled })));
  const qaOptions = await page.getByLabel("Story Doctor model").locator("option").evaluateAll((options) => options.map((option) => ({ label: option.textContent, value: option.value, disabled: option.disabled })));
  assert.equal(modelOptions.slice(1).every((option) => option.disabled), true, "LM Studio unexpectedly exposed a served writer model");
  assert.equal(qaOptions.slice(1).every((option) => option.disabled), true, "LM Studio unexpectedly exposed a served QA model");
  const qwenSecondOpinionVisible = await page.getByLabel(/Second opinion · Qwen/).isVisible();
  assert.equal(qwenSecondOpinionVisible, true, "explicit Qwen second-opinion gate must be visible but never automatic");
  lmStudioState = {
    localCatalogCandidates: modelOptions.length - 1,
    servedModels: modelOptions.slice(1).filter((option) => !option.disabled).length,
    generationEnabled: false,
    loopbackOnly: true,
    researchGate: "approve-then-pin",
    writerPinUi: "Default writer · Llama 3.3 70B Instruct",
    doctorPinUi: "Default QA · Llama 3.3 70B Instruct",
    qwenSecondOpinionExplicit: qwenSecondOpinionVisible,
    critiqueFirst: true,
    scopedApplyEnabled: false,
  };
  await selectStage(page, "performance", "07 Performance");
  await page.getByRole("heading", { name: "Performance" }).waitFor();
  await selectStage(page, "shots", "08 Shots");
  await page.getByRole("heading", { name: "Shots" }).waitFor();
  assert.equal(await page.getByText("Timeline", { exact: true }).count(), 0, "timeline must be hidden from Shots");

  await selectStage(page, "generate", "10 Generate");
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
  await selectStage(page, "timeline", "11 Stitch");
  await page.getByRole("heading", { name: "Stitch" }).waitFor();
  await page.getByText("Timeline", { exact: true }).waitFor();
  await selectStage(page, "shots", "08 Shots");
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

  second = await launch(userDataDir);
  const reopenedZoom = await zoomFactor(second.application);
  assert.equal(reopenedZoom, persistedZoom, "saved zoom did not survive restart");
  await second.page.getByRole("heading", { name: "Shots" }).waitFor();
  assert.match(await second.page.locator("body").innerText(), /Prepared video queue/i);
  await second.page.evaluate((factor) => window.premiere316?.zoom.set(factor), originalZoom);
  await second.page.waitForTimeout(150);
  assert.equal(await zoomFactor(second.application), originalZoom);
  await second.page.screenshot({ path: screenshotPath });

  const forbidden8080 = networkLog.filter((entry) => /:(8080)(\/|$)/.test(entry.url) || entry.url.includes(":8080/"));
  const completionPosts = networkLog.filter((entry) => entry.method === "POST" && /\/v1\/(chat\/)?completions/.test(entry.url));
  assert.equal(forbidden8080.length, 0, `renderer probed forbidden :8080 endpoints: ${JSON.stringify(forbidden8080)}`);
  assert.equal(completionPosts.length, 0, `completion POST issued while native loaded state is unknown: ${JSON.stringify(completionPosts)}`);

  const report = {
    ok: true,
    executablePath,
    userDataDir,
    launchedUserData: second.launchedUserData,
    realProfileUntouched: REAL_PROFILE,
    buildInfo,
    zoom: { original: originalZoom, reset: 1, persisted: persistedZoom, reopened: reopenedZoom, restored: originalZoom },
    lmStudio: lmStudioState,
    engines: engineState,
    timeline: { hiddenOutsideStitch: true, visibleInStitch: true },
    persistedStage: "shots",
    network: { probed8080: forbidden8080.length, completionPosts: completionPosts.length, observed: networkLog.length },
    consoleErrors: failures,
    screenshotPath,
  };
  assert.deepEqual(failures, []);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await first?.application.close().catch(() => {});
  await second?.application.close().catch(() => {});
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
