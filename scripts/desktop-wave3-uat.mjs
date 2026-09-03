import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "wave3-uat");
const reportPath = resolve(artifacts, "report.json");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const pngPath = resolve(artifacts, "reference.png");
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/az3p9kAAAAASUVORK5CYII=";

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function assertIsolatedUserData(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  const real = REAL_PROFILE.replaceAll("/", "\\").toLowerCase();
  assert.ok(dir, "user-data directory is required");
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false, "refusing the real Premiere316 profile");
  if (real) assert.notEqual(normalized, real, "refusing to launch against %APPDATA%/Premiere316");
}
async function launch(userDataDir, report) {
  assertIsolatedUserData(userDataDir);
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`], env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => report.network.push({ method: request.method(), url: request.url() }));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const launchedUserData = await app.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  return { app, page, launchedUserData };
}
async function capture(app, name) {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible()) ?? BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("No visible Premiere316 window");
    return (await win.webContents.capturePage()).toPNG().toString("base64");
  });
  const path = join(artifacts, `${name}.png`);
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}
async function selectStage(page, name, value) {
  const nav = page.getByRole("navigation", { name: "Pipeline" });
  const button = nav.getByRole("button", { name, exact: true });
  if (await button.isVisible().catch(() => false)) await button.click();
  else await nav.getByRole("combobox", { name: "Pipeline stage" }).selectOption(value);
  await page.waitForFunction((stage) => document.querySelector('[data-studio-shell="true"]')?.getAttribute("data-stage") === stage, value);
}
async function openLastReel(page) {
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();
}
async function storeSnapshot(page) {
  return page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem("premiere316-v302-c") || "{}");
    const state = parsed.state ?? parsed;
    const active = state.pictures?.find((picture) => picture.id === state.activeId) ?? state.pictures?.find((picture) => picture.id === "pic_last_reel") ?? null;
    return { activeId: state.activeId, active };
  });
}
function versionHashes(screenplay) {
  return (screenplay?.versions ?? []).map((version) => ({ id: version.id, kind: version.kind, hash: sha(version.fountain ?? "") }));
}

await mkdir(artifacts, { recursive: true });
await writeFile(pngPath, Buffer.from(ONE_PIXEL_PNG, "base64"));
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-wave3-uat-"));
assertIsolatedUserData(userDataDir);

const report = { ok: false, executablePath, userDataDir, launchedUserData: null, screenshots: [], assertions: {}, consoleErrors: [], pageErrors: [], network: [], error: null };
let app;
try {
  const launched = await launch(userDataDir, report);
  app = launched.app;
  const page = launched.page;
  report.launchedUserData = launched.launchedUserData;
  const buildInfo = await page.evaluate(() => window.premiere316?.app.buildInfo());
  report.buildInfo = buildInfo;
  assert.equal(buildInfo?.rendererMode, "PACKAGED DIST");

  await openLastReel(page);
  const before = await storeSnapshot(page);
  const protectedVersionHashes = versionHashes(before.active.screenplay);
  report.assertions.lastReelApprovedBefore = before.active.screenplay.status === "APPROVED" && Boolean(before.active.screenplay.approvedVersionId);
  assert.equal(report.assertions.lastReelApprovedBefore, true, "The Last Reel must migrate with an approved screenplay");

  await selectStage(page, "02 Research", "research");
  const approveResearch = page.getByRole("button", { name: "Approve research" });
  if (await approveResearch.isVisible().catch(() => false)) await approveResearch.click();
  await page.getByText("Research approved", { exact: true }).first().waitFor();
  report.screenshots.push(await capture(app, "01-research-approved"));

  await selectStage(page, "04 Inventory", "inventory");
  await page.getByRole("button", { name: "Run production breakdown" }).click();
  await page.getByText("Breakdown preflight", { exact: true }).waitFor();
  report.screenshots.push(await capture(app, "02-breakdown"));

  let snap = await storeSnapshot(page);
  const record = snap.active.production;
  assert.ok(record?.assets?.length > 1, "deterministic breakdown should create multiple assets");
  const asset = record.assets.find((item) => item.category === "prop") ?? record.assets[0];
  report.assertions.researchAwareBreakdown = Boolean(record.sourceBoundary?.fingerprints?.some((fp) => fp.sourceKind === "research") && record.graph?.nodes?.some((node) => node.kind === "research-version") && record.assets.some((item) => item.provenance?.length));

  await page.locator("button").filter({ hasText: asset.name }).first().click();
  await page.getByRole("dialog").filter({ hasText: "Asset inspector" }).waitFor();
  const originalDescription = asset.canonicalSpec.visualDescription;
  await page.getByLabel("Asset name").fill(`${asset.name} verified`);
  await page.getByLabel("Visual / production description").fill(`${originalDescription} Verified amber reference tag.`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: /Approve specification/ }).click();
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(pngPath);
  await page.waitForTimeout(400);
  report.screenshots.push(await capture(app, "03-inventory-edit-approve-reference"));

  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Add asset" }).first().click();
  await page.getByRole("dialog", { name: /Add missing asset/ }).waitFor();
  await page.getByLabel("Asset name").fill("Wave 3 duplicate slate");
  await page.getByLabel("Canonical description").fill("Engine-neutral duplicate slate used to prove merge and split lineage.");
  await page.locator('fieldset input[type="checkbox"]').first().check();
  await page.getByRole("dialog", { name: /Add missing asset/ }).getByRole("button", { name: "Add asset" }).click();
  await page.waitForTimeout(500);
  await page.getByText("Wave 3 duplicate slate", { exact: true }).first().click();
  await page.getByRole("dialog").filter({ hasText: "Asset inspector" }).waitFor();
  const mergeSelect = page.locator('section:has-text("Merge duplicate") select').first();
  if (await mergeSelect.isVisible().catch(() => false)) {
    const optionCount = await mergeSelect.locator("option").count();
    if (optionCount > 1) {
      await mergeSelect.selectOption({ index: 1 });
      await page.getByRole("button", { name: /Merge/ }).click();
      report.assertions.mergeUsedVisibleControl = true;
    }
  }
  await page.waitForTimeout(300);
  const splitSelect = page.locator('section:has-text("Split asset") select').first();
  if (await splitSelect.isVisible().catch(() => false)) {
    const optionCount = await splitSelect.locator("option").count();
    if (optionCount > 1) {
      await splitSelect.selectOption({ index: 1 });
      await page.getByPlaceholder("New asset name").fill("Wave 3 split child");
      await page.getByRole("button", { name: /Split/ }).click();
      report.assertions.splitUsedVisibleControl = true;
    }
  }
  report.screenshots.push(await capture(app, "04-merge-split-history"));
  const closeInspector = page.getByRole("button", { name: "Close inspector" });
  if (await closeInspector.isVisible().catch(() => false)) await closeInspector.click();

  await selectStage(page, "05 Visual Dev", "visual-development");
  const boardButtons = await page.getByRole("button", { name: "Approve board" }).all();
  for (const button of boardButtons.slice(0, 2)) await button.click();
  const bibleButtons = await page.getByRole("button", { name: "Approve identity bible" }).all();
  for (const button of bibleButtons.slice(0, 2)) await button.click();
  await page.getByText(/approved/).first().waitFor();
  report.screenshots.push(await capture(app, "05-visual-approvals"));

  await selectStage(page, "06 Cinematography", "cinematography");
  await page.getByRole("button", { name: "Run deterministic QA" }).click();
  const shotPlanButtons = await page.getByRole("button", { name: "Approve shot plan" }).all();
  let clickedPlans = 0;
  for (const button of shotPlanButtons) {
    if (clickedPlans >= 2) break;
    if (await button.isEnabled().catch(() => false)) { await button.click(); clickedPlans++; }
  }
  report.assertions.cinematographyApprovalsViaUi = clickedPlans;
  report.screenshots.push(await capture(app, "06-cinematography-qa-approval"));

  await selectStage(page, "04 Inventory", "inventory");
  await page.getByRole("button", { name: "Evaluate prepared assets" }).click();
  await page.getByText("Prepared assets gate", { exact: true }).waitFor();
  report.screenshots.push(await capture(app, "07-prepared-assets"));

  snap = await storeSnapshot(page);
  const after = snap.active;
  const prod = after.production;
  const visual = after.visualDevelopment;
  const cine = after.cinematography;
  const approvedPrepared = (prod.preparedAssets ?? []).filter((item) => item.status === "APPROVED_PREPARED");
  const unapprovedPrepared = approvedPrepared.filter((item) => !prod.assets.find((asset) => asset.id === item.assetId)?.approvedSpecVersionId);
  report.inventorySummary = prod.assets.map((item) => ({ id: item.id, name: item.name, tombstone: Boolean(item.tombstone), canonicalApproved: item.canonicalApproved, approvedSpecVersionId: item.approvedSpecVersionId ?? null, specVersions: (item.specVersions ?? []).map((version) => ({ id: version.id, approved: version.approved })), references: item.references?.length ?? 0, lineage: item.lineage?.map((event) => event.type) ?? [] }));
  report.assertions.inventoryHistory = prod.assets.some((item) => (item.specVersions ?? []).length > 0 && item.approvedSpecVersionId);
  report.assertions.referenceAttached = prod.assets.some((item) => item.references?.length > 0);
  report.assertions.visualApprovals = visual.approvals.length;
  report.assertions.cinematographyApprovedPlans = cine.shotPlans.filter((plan) => plan.status === "APPROVED").length;
  report.assertions.preparedAssets = (prod.preparedAssets ?? []).length;
  report.assertions.approvedPrepared = approvedPrepared.length;
  report.assertions.falseReadinessImpossible = unapprovedPrepared.length === 0;
  report.assertions.priorApprovedVersionsRetrievable = protectedVersionHashes.every((beforeVersion) => after.screenplay.versions.some((version) => version.id === beforeVersion.id && sha(version.fountain ?? "") === beforeVersion.hash));
  report.assertions.lastReelIdsPreserved = after.id === before.active.id && after.scenes.map((s) => s.id).join("|") === before.active.scenes.map((s) => s.id).join("|");
  report.assertions.noModelOrMediaNetwork = !report.network.some((entry) => /\/v1\/(chat\/)?completions|\/api\/v1\/models\/(load|unload)|:8080\//.test(entry.url));
  assert.equal(report.assertions.inventoryHistory, true, "Inventory approved spec history was not preserved");
  assert.equal(report.assertions.referenceAttached, true, "Reference upload did not persist");
  assert.ok(report.assertions.visualApprovals > 0, "Visual Development approval path did not run");
  assert.ok(report.assertions.cinematographyApprovedPlans > 0, "Cinematography approval path did not run");
  assert.ok(report.assertions.preparedAssets > 0, "Prepared assets were not evaluated");
  assert.equal(report.assertions.falseReadinessImpossible, true, "Prepared readiness included an unapproved spec");
  assert.equal(report.assertions.priorApprovedVersionsRetrievable, true, "Prior approved screenplay versions were not retrievable");
  assert.equal(report.assertions.lastReelIdsPreserved, true, "The Last Reel protected IDs changed");
  assert.equal(report.assertions.noModelOrMediaNetwork, true, "UAT attempted model/media lifecycle or inference network");
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
