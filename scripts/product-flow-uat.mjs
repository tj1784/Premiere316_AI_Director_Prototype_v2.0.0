import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "p0-five-touchpoint-product-flow");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const failures = [];
const networkLog = [];

function assertIsolated(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false);
}

const report = { ok: false, defaultNav: [], advancedHiddenByDefault: false, buildCta: false, reviewDefaultOff: false, landedAssets: false, llamaOffline: false, error: null };
await mkdir(artifacts, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-p0-flow-"));
assertIsolated(userDataDir);
let application;
try {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`], env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir } });
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
  report.defaultNav = await page.getByRole("navigation", { name: "Pipeline" }).locator("button").evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
  report.advancedHiddenByDefault = !report.defaultNav.some((label) => /Research|Screenplay|Inventory|Prompt Lab|Stitch/.test(label));
  await page.getByRole("button", { name: "01 Intake" }).click();
  await page.getByText("What are we making?").waitFor();
  report.buildCta = await page.getByRole("button", { name: "Build Movie Plan" }).isVisible();
  report.reviewDefaultOff = !(await page.getByRole("checkbox", { name: /review internal phases/i }).isChecked());
  await page.getByRole("button", { name: "Build Movie Plan" }).click();
  await page.getByRole("button", { name: "Asset Pass" }).waitFor({ timeout: 20000 });
  report.landedAssets = true;
  const body = await page.locator("body").innerText();
  report.llamaOffline = /Llama unavailable|LM Studio/i.test(body);
  report.network = {
    port8188: networkLog.filter((url) => /:8188/.test(url)).length,
    cloud: networkLog.filter((url) => /openai|anthropic|openrouter|api\.x\.ai/i.test(url)).length,
  };
  assert.equal(report.advancedHiddenByDefault, true);
  assert.equal(report.buildCta, true);
  assert.equal(report.reviewDefaultOff, true);
  assert.equal(report.landedAssets, true);
  assert.equal(failures.length, 0, failures.join("\n"));
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.ok = false;
} finally {
  if (application) await application.close().catch(() => {});
}
await writeFile(join(artifacts, "product-flow-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
