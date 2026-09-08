import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "playwright";
import { livePackagedUatPassed } from "./pre-audit-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "screenshots/final-pre-audit-intake-and-lmstudio");
const mode = process.argv[2] ?? "offline";
assert.ok(["offline", "online", "browser"].includes(mode));
const brief = "2-minute fan-made live-action trailer for Xenogears, cinematic, photoreal, with Fei and Elly escaping a desert battle.";
const report = { ok: false, startedAt: Date.now(), skipped: false, packaged: mode !== "browser", onlineVerified: false, researchGenerated: false, screenplayGenerated: false, qaGenerated: false, assetsExtracted: false, noSilentFallback: false, actualProviderCalls: 0, errors: [] };
const rendererRequests = [];
let application, browser, page;
let progressTimer;
await mkdir(artifacts, { recursive: true });
const save = (name, value) => writeFile(join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`);
const activePicture = () => page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("premiere316-v302-c")).state;
  return state.pictures.find((picture) => picture.id === state.activeId);
});

async function newPicture() {
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: /^New Picture/ }).click();
  await page.getByLabel("What are we making?", { exact: true }).waitFor();
}

async function checkIntake() {
  const pane = page.locator(".stage-pane");
  const details = page.locator('[data-optional-intake="true"]');
  assert.equal(await details.getAttribute("open"), null);
  assert.equal(await pane.locator("textarea:visible").count(), 1);
  assert.equal(await pane.locator('input:visible').count(), 1);
  assert.equal(await pane.getByRole("button", { name: "Build Movie Plan", exact: true }).count(), 1);
  assert.equal(await pane.getByRole("checkbox").isChecked(), false);
  report.defaultOnlyIdeaActionReview = true;
  report.optionalCollapsed = true;
  await page.screenshot({ path: join(artifacts, "intake-default-collapsed.png") });
  await details.locator("summary").click();
  const values = {};
  for (const [source, label] of [["concept", "Premise"], ["treatment", "Treatment / Outline"], ["existing-screenplay", "Existing screenplay"], ["source-material", "Source material"], ["biblical-historical", "Source passages / references"]]) {
    await page.getByLabel("Source mode", { exact: true }).selectOption(source);
    const input = details.locator("label").filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).locator("..").locator("textarea").first();
    await input.fill(`Preserved ${source} source`);
    values[source] = await input.inputValue();
  }
  await page.getByLabel("Source mode", { exact: true }).selectOption("concept");
  const title = details.locator("label").filter({ hasText: /^Title$/ }).locator("..").locator("input");
  await title.fill("Optional title survives");
  await details.locator("summary").click();
  assert.equal(await pane.locator("textarea:visible").count(), 1);
  await page.reload();
  await page.getByLabel("What are we making?", { exact: true }).waitFor();
  assert.equal(await details.getAttribute("open"), null);
  await details.locator("summary").click();
  assert.equal(await title.inputValue(), "Optional title survives");
  const saved = await activePicture();
  for (const [source, key] of [["concept", "premise"], ["treatment", "treatment"], ["existing-screenplay", "existingScreenplay"], ["source-material", "sourceMaterial"], ["biblical-historical", "sourcePassages"]]) assert.equal(saved.intake[key], values[source]);
  for (const label of ["Title", "Logline", "Genre", "Runtime (min)", "Tone", "Director notes"]) assert.ok((await details.innerText()).toLowerCase().includes(label.toLowerCase()), label);
  await page.screenshot({ path: join(artifacts, "intake-optional-expanded.png") });
  report.optionalFieldsPreserved = true;
  // A fresh project proves the movie plan uses only the sentence, not these fixtures.
  await newPicture();
}

try {
  if (mode === "browser") {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  } else {
    const profile = await mkdtemp(join(tmpdir(), `p316-final-${mode}-`));
    assert.ok(!profile.toLowerCase().includes("appdata\\roaming\\premiere316"));
    application = await electron.launch({ executablePath: join(root, "dist-desktop/win-unpacked/Premiere316.exe"), args: [`--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_USER_DATA_DIR: profile } });
    page = await application.firstWindow();
    report.build = JSON.parse(await readFile(join(root, "dist-desktop/win-unpacked/resources/build-info.json"), "utf8"));
    report.packaged = await application.evaluate(({ app }) => app.isPackaged);
  }
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.errors.push(message.text()); });
  page.on("request", (request) => rendererRequests.push({ url: request.url(), method: request.method() }));
  if (mode === "browser") await page.goto(process.argv[3] ?? "http://127.0.0.1:8080");
  await page.getByRole("heading", { name: "Pictures", exact: true }).waitFor();
  await newPicture();
  if (mode !== "online") await checkIntake();
  await page.getByLabel("What are we making?", { exact: true }).fill(brief);
  if (mode === "browser") {
    for (const [name, width, height] of [["desktop", 1280, 800], ["mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.locator(".stage-pane textarea:visible").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(artifacts, `intake-${name}.png`) });
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } else {
    console.log(`${mode}: clicking Build Movie Plan in packaged app`);
    await page.getByRole("button", { name: "Build Movie Plan", exact: true }).click();
    if (mode === "online") {
      await page.waitForFunction(() => (document.querySelector('[data-model-output="true"]')?.textContent?.length ?? 0) > 64, {}, { timeout: 180_000 });
      report.streamVisibleBeforeCompletion = await page.getByRole("button", { name: "Building…", exact: true }).isVisible();
      await page.locator('[data-movie-plan-activity="true"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(artifacts, "live-model-activity.png") });
      progressTimer = setInterval(() => {
        void page.locator('[data-movie-plan-activity="true"]').innerText({ timeout: 1000 }).then((text) => save("live-activity-current.json", { at: Date.now(), text })).catch(() => {});
      }, 5000);
    }
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("premiere316-v302-c");
      if (!raw) return false;
      const state = JSON.parse(raw).state;
      return state.pictures.find((picture) => picture.id === state.activeId)?.productFlow?.lastRunAt;
    }, { }, { timeout: mode === "online" ? 3_600_000 : 30_000 });
    const picture = await activePicture();
    await save(`${mode}-picture.json`, picture);
    report.flow = picture.productFlow;
    report.researchGenerated = picture.research?.versions?.some((version) => version.label === "Generated Research Draft") ?? false;
    report.screenplayGenerated = /(?:INT\.|EXT\.)/.test(picture.screenplay?.workingFountain ?? "");
    report.qaGenerated = Boolean(picture.screenplay?.lastQaReport?.findings?.length);
    report.assetsExtracted = Boolean(picture.production?.assets?.length);
    report.offlineHonest = picture.productFlow.manualFallback === true && picture.productFlow.steps.every((step) => step.status === "failed");
    report.noDraftReady = picture.productFlow.steps.every((step) => step.status !== "draftReady");
    if (mode === "offline") {
      assert.equal(report.offlineHonest, true);
      assert.equal(report.noDraftReady, true);
      assert.equal(report.researchGenerated || report.screenplayGenerated || report.qaGenerated || report.assetsExtracted, false);
      await page.getByRole("button", { name: "02 Assets", exact: true }).click();
      await page.getByText("Movie plan did not complete.", { exact: true }).waitFor();
      report.assetsBlocked = true;
    } else {
      report.onlineVerified = picture.productFlow.executed === true && picture.productFlow.nextTouchpoint === "asset-approval" && picture.productFlow.steps.every((step) => step.status === "draftReady");
      report.noSilentFallback = picture.productFlow.servedModelId === "llama-3.3-70b-instruct";
      report.assetsVisible = await page.locator('body').innerText().then((body) => picture.production?.assets?.some((asset) => body.includes(asset.name)) ?? false);
    }
    await page.screenshot({ path: join(artifacts, `lm-studio-${mode}-result.png`) });
    assert.deepEqual(report.errors, []);
    report.ok = mode === "offline" || (report.onlineVerified && report.researchGenerated && report.screenplayGenerated && report.qaGenerated && report.assetsExtracted && report.assetsVisible);
  }
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: join(artifacts, `${mode}-failure.png`) }).catch(() => {});
} finally {
  clearInterval(progressTimer);
  if (application) await application.close().catch(() => {});
  if (browser) await browser.close();
  report.endedAt = Date.now();
  const observed = (await readFile(join(artifacts, "lm-studio-server.jsonl"), "utf8").catch(() => "")).trim().split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).filter((event) => event.timestamp >= report.startedAt);
  const requests = observed.filter((event) => /Received request: POST to \/v1\/chat\/completions/.test(event.data?.content));
  const urls = rendererRequests.map((request) => request.url);
  const external = urls.filter((url) => /^https?:/.test(url) && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  report.actualProviderCalls = requests.length;
  report.providerModels = [...new Set(requests.map((request) => request.data.content.match(/"model":\s*"([^"]+)"/)?.[1]).filter(Boolean))];
  report.network = { verified: observed.some((event) => /Received request:.*\/.*models/.test(event.data?.content)), port8188: urls.filter((url) => /:8188/.test(url)).length, cloud: external.filter((url) => /openai|anthropic|openrouter|api\.x\.ai/i.test(url)).length, web: external.length, comfy: urls.filter((url) => /comfy/i.test(url)).length, external, scope: "Renderer requests and LM Studio server request logs; not an OS-wide or all-server egress capture" };
  report.functionalPassed = report.ok;
  if (mode !== "browser") report.ok = report.ok && report.network.verified && [report.network.port8188, report.network.cloud, report.network.web, report.network.comfy].every((count) => count === 0);
  if (mode === "online") {
    report.noSilentFallback = report.noSilentFallback && report.providerModels.length === 1 && report.providerModels[0] === "llama-3.3-70b-instruct";
    report.ok = livePackagedUatPassed(report);
    report.greenEligible = report.ok;
  }
  await save(mode === "browser" ? "intake-browser-uat.json" : `lm-studio-${mode}-uat.json`, report);
  await save(`${mode}-renderer-network.json`, rendererRequests);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
