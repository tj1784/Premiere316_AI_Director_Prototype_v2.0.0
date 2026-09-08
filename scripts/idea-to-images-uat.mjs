import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { _electron as electron } from "playwright";

const artifacts = resolve(process.env.P316_EVIDENCE_DIR || "screenshots/idea-to-generated-assets");
const plan = JSON.parse(await readFile(join(artifacts, "lm-studio-online-uat.json"), "utf8"));
assert.equal(plan.ok, true, "A successful real packaged movie plan is required before image UAT");
const profile = plan.userDataDir;
assert.ok(profile && !profile.toLowerCase().includes("appdata\\roaming\\premiere316"));
const report = { ok: false, startedAt: Date.now(), profile, generated: [], errors: [], network: [], selectedAssets: [] };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(join(artifacts, "generated"), { recursive: true });
let application, page;
const save = (name, data) => writeFile(join(artifacts, name), JSON.stringify(data, null, 2) + "\n");
const picture = () => page.evaluate(() => { const state = JSON.parse(localStorage.getItem("premiere316-v302-c")).state; return state.pictures.find((item) => item.id === state.activeId); });
async function stage(id, name) {
  if (await page.locator('[data-advanced-dashboard="true"]').isVisible()) {
    await page.locator(`[data-department-id="${id}"]`).getByRole("button", { name: /^Open / }).click();
  } else if (id === "generate") {
    const back = page.getByRole("button", { name: "Return to Default Mode", exact: true });
    if (await back.isVisible()) await back.click();
    const assets = page.getByRole("button", { name: "02 Assets", exact: true });
    if (await assets.isVisible()) await assets.click();
    else await page.getByRole("combobox", { name: "Pipeline stage" }).selectOption("asset-approval");
  } else {
  const nav = page.getByRole("navigation", { name: "Pipeline" });
  const button = nav.locator(`button[data-stage-id="${id}"]`);
  if (await button.isVisible()) await button.click();
  else await nav.getByRole("combobox", { name: "Advanced department" }).selectOption(id);
  }
  await page.waitForFunction((id) => document.querySelector('[data-studio-shell="true"]')?.getAttribute("data-stage") === id, id);
}
async function confirm(trigger, label, name) {
  const pending = application.waitForEvent("window", { timeout: 120000 });
  void pending.catch(() => {});
  await trigger();
  const modal = await pending;
  await modal.getByRole("button", { name: label, exact: true }).waitFor();
  await writeFile(join(artifacts, `${name}.txt`), await modal.locator("body").innerText());
  await modal.screenshot({ path: join(artifacts, `${name}.png`) });
  const closed = modal.waitForEvent("close");
  try { await modal.getByRole("button", { name: label, exact: true }).click(); }
  catch (error) { if (!/closed/i.test(error.message)) throw error; }
  await closed;
}
try {
  application = await electron.launch({ executablePath: resolve("dist-desktop/win-unpacked/Premiere316.exe"), args: [`--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_USER_DATA_DIR: profile } });
  report.build = JSON.parse(await readFile("dist-desktop/win-unpacked/resources/build-info.json", "utf8"));
  const runtimeProcess = application.process();
  let runtimeLog = "";
  const log = (chunk) => { runtimeLog += chunk.toString(); void writeFile(join(artifacts, "image-runtime.log"), runtimeLog); };
  runtimeProcess.stdout?.on("data", log); runtimeProcess.stderr?.on("data", log);
  page = await application.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("request", (request) => report.network.push({ url: request.url(), method: request.method() }));
  await page.waitForFunction(() => document.body.innerText.length > 40);
  if (await page.getByRole("heading", { name: "Pictures", exact: true }).isVisible()) {
    const previous = JSON.parse(await readFile(join(artifacts, "online-picture.json"), "utf8"));
    await page.getByRole("button", { name: new RegExp(previous.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  }
  const generatedPlan = await picture();
  assert.equal(generatedPlan.productFlow.nextTouchpoint, "asset-approval");
  assert.equal(generatedPlan.runtimeMinutes, 3);
  const candidates = generatedPlan.production.assets.slice(0, 6).filter((asset) => !asset.referenceRequired && ["character", "location", "prop", "vehicle", "wardrobe"].includes(asset.category));
  const selected = [candidates.find((asset) => asset.category === "character"), candidates.find((asset) => asset.category === "location")].filter(Boolean);
  for (const asset of candidates) if (selected.length < 2 && !selected.includes(asset)) selected.push(asset);
  assert.equal(selected.length, 2, "Need two generated visual asset specifications");
  report.selectedAssets = selected.map(({ id, name, category, canonicalSpec }) => ({ id, name, category, description: canonicalSpec.visualDescription }));
  await save("selected-image-assets.json", report.selectedAssets);
  const advanced = page.getByRole("button", { name: "Advanced Departments", exact: true });
  if (await advanced.isVisible()) await advanced.click();
  await stage("inventory", "04 Inventory");
  for (const asset of selected) {
    await page.getByRole("button").filter({ has: page.getByRole("heading", { name: asset.name, exact: true }) }).click();
    await page.getByRole("dialog").filter({ hasText: "Asset inspector" }).waitFor();
    assert.equal(await page.getByLabel("Asset name", { exact: true }).inputValue(), asset.name);
    assert.ok((await page.getByLabel("Visual / production description").inputValue()).length > 10);
    await page.getByRole("button", { name: /Approve specification/ }).click();
    await page.getByRole("button", { name: "Close inspector" }).click();
  }
  await stage("visual-development", "05 Visual Dev");
  for (const button of await page.getByRole("button", { name: "Approve board", exact: true }).all()) await button.click();
  for (const button of await page.getByRole("button", { name: "Approve identity bible", exact: true }).all()) await button.click();
  await stage("cinematography", "06 Cinematography");
  const qa = page.getByRole("button", { name: "Run deterministic QA", exact: true });
  if (await qa.isVisible()) await qa.click();
  let approvedPlans = 0;
  for (const button of await page.getByRole("button", { name: "Approve shot plan", exact: true }).all()) if (await button.isEnabled()) { await button.click(); approvedPlans++; }
  assert.ok(approvedPlans > 0, "Generated shots must have approvable camera plans");
  await stage("inventory", "04 Inventory");
  await page.getByRole("button", { name: /Prepare queue|Refresh preparation/ }).click();
  await page.getByRole("button", { name: "Evaluate prepared assets", exact: true }).click();
  await confirm(() => page.getByRole("button", { name: "Seal production authority", exact: true }).click(), "Seal exactly reviewed authority", "image-authority");
  await page.getByText(/exact current authority verified/i).waitFor();
  for (const asset of selected) {
    const card = page.getByRole("region", { name: "Prepared assets gate" }).locator("article").filter({ hasText: asset.id });
    await confirm(() => card.getByRole("button", { name: "Approve prepared", exact: true }).click(), "Confirm Prepared Approval", `prepared-${asset.id.replace(/[^a-z0-9]/gi, "-")}`);
    await page.waitForFunction((assetId) => {
      const state = JSON.parse(localStorage.getItem("premiere316-v302-c")).state;
      return state.pictures.find((item) => item.id === state.activeId)?.production?.preparedAssets.find((item) => item.assetId === assetId)?.status === "APPROVED_PREPARED";
    }, asset.id);
  }
  for (let index = 0; index < selected.length; index++) {
    const beforeCount = (await picture()).production.assets.find((asset) => asset.id === selected[index].id).iterations?.length ?? 0;
    await stage("generate", "10 Generate");
    await page.getByRole("heading", { name: /flux2-dev|flux1-dev/ }).waitFor({ timeout: 120000 });
    const card = page.getByRole("region", { name: "Prepared assets", exact: true }).locator("article").filter({ has: page.getByRole("heading", { name: selected[index].name, exact: true }) }).filter({ has: page.getByRole("button", { name: "Authorize + generate", exact: true }) });
    const generateButton = card.getByRole("button", { name: "Authorize + generate", exact: true });
    // Cold component hashing can outlast Playwright's normal click timeout.
    // Wait for the product's verified authority and model readiness first.
    await generateButton.waitFor({ timeout: 180000 });
    const readyDeadline = Date.now() + 180000;
    while (!(await generateButton.isEnabled()) && Date.now() < readyDeadline) await page.waitForTimeout(500);
    assert.ok(await generateButton.isEnabled(), await generateButton.getAttribute("title"));
    await confirm(() => generateButton.click(), "Confirm Generate", `generate-${index + 1}`);
    console.log(`Generating real image for ${selected[index].name}`);
    await page.waitForFunction(({ assetId, beforeCount }) => {
      const state = JSON.parse(localStorage.getItem("premiere316-v302-c")).state;
      return state.pictures.find((item) => item.id === state.activeId)?.production?.assets.find((asset) => asset.id === assetId)?.iterations?.length > beforeCount;
    }, { assetId: selected[index].id, beforeCount }, { timeout: 900000 });
    await page.getByRole("img", { name: /Generated iteration/ }).first().waitFor();
    await page.screenshot({ path: join(artifacts, `generated-review-${index + 1}.png`) });
  }
  const result = await picture();
  await save("image-picture.json", result);
  const mediaDir = join(profile, "media/stills");
  const newMedia = selected.map(({ id }) => result.production.assets.find((asset) => asset.id === id).iterations.filter((iteration) => iteration.createdAt >= report.startedAt).at(-1)?.mediaUri?.split("/").at(-1));
  assert.ok(newMedia.every(Boolean), "Each selected asset must have a new generated iteration from this run");
  for (const name of newMedia) {
    const bytes = await readFile(join(mediaDir, name));
    const sidecarName = name.replace(/\.png$/, ".provenance.json");
    const sidecar = JSON.parse(await readFile(join(mediaDir, sidecarName), "utf8"));
    assert.ok(bytes.length > 10000);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await copyFile(join(mediaDir, name), join(artifacts, "generated", name));
    await copyFile(join(mediaDir, sidecarName), join(artifacts, "generated", sidecarName));
    report.generated.push({ name, bytes: bytes.length, sha256: hash(bytes), provenance: sidecar });
  }
  assert.equal(report.generated.length, 2);
  assert.equal(new Set(report.generated.map((image) => image.sha256)).size, 2);
  assert.deepEqual(report.errors, []);
  assert.equal(report.network.some(({ url }) => /^https?:/.test(url) && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)), false);
  await copyFile(join(profile, "media/stills/security-ledger.v1.jsonl"), join(artifacts, "security-ledger.v1.jsonl"));
  report.ok = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: join(artifacts, "images-failure.png") }).catch(() => {}); await save("images-failure-picture.json", await picture()).catch(() => {}); }
} finally {
  report.endedAt = Date.now();
  if (application) await application.close().catch(() => {});
  await save("images-uat.json", report);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
