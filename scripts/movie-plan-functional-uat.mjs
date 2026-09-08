import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots", "fix-build-movie-plan-functional-execution");
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const failures = [];
const networkLog = [];

function assertIsolated(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false);
}

await mkdir(artifacts, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-movie-plan-"));
assertIsolated(userDataDir);

const report = {
  ok: false,
  offlineHonest: false,
  noDraftReady: false,
  assetsBlocked: false,
  onlineAttempted: false,
  onlineVerified: false,
  status: "FUNCTIONAL_PIPELINE_SOURCE_READY_LM_STUDIO_UAT_BLOCKED",
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
  const intake = page.getByRole("button", { name: "01 Intake" });
  if (await intake.isVisible().catch(() => false)) await intake.click();
  else await page.getByRole("combobox", { name: "Pipeline stage" }).selectOption("intake");
  await page.getByText("What are we making?").waitFor();
  await page.locator("textarea").first().fill("2-minute fan-made live-action trailer for Xenogears, cinematic, photoreal.");
  await page.getByRole("button", { name: "Build Movie Plan" }).click();
  await page.getByText(/Configured AI model unavailable|failed/i).first().waitFor({ timeout: 30000 });
  const body = await page.locator("body").innerText();
  report.offlineHonest = /Configured AI model unavailable|Manual fallback — no AI movie plan has been generated/i.test(body);
  report.noDraftReady = !/Not a verified Llama runtime pass/i.test(body);
  await page.getByRole("button", { name: "02 Assets" }).click();
  await page.getByText("Movie plan did not complete.").waitFor({ timeout: 15000 });
  report.assetsBlocked = true;
  report.network = {
    port8188: networkLog.filter((url) => /:8188/.test(url)).length,
    cloud: networkLog.filter((url) => /openai|anthropic|openrouter|api\.x\.ai/i.test(url)).length,
    comfy: networkLog.filter((url) => /comfy/i.test(url)).length,
  };
  assert.equal(report.offlineHonest, true);
  assert.equal(report.noDraftReady, true);
  assert.equal(report.assetsBlocked, true);
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

await writeFile(join(artifacts, "lm-studio-offline-uat.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(artifacts, "lm-studio-online-uat.json"), `${JSON.stringify({ ok: false, skipped: true, status: report.status }, null, 2)}\n`);
await writeFile(join(artifacts, "no-cloud-no-web-no-comfy-no-8188-proof.json"), `${JSON.stringify({ ok: report.ok, ...report.network }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
