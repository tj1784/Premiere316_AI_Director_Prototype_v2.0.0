import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { enterAdvancedDepartments, selectStudioStage } from "./studio-nav.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(root, "dist-desktop/win-unpacked/Premiere316.exe");
const artifacts = resolve(root, "screenshots/remove-research-mode-options-entirely");
const userDataDir = await mkdtemp(join(tmpdir(), "premiere316-research-before-"));
const application = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${userDataDir}`],
  env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
});
try {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 40);
  const back = page.getByRole("button", { name: "Back to pictures" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("heading", { name: "Pictures" }).waitFor();
  await page.getByRole("button", { name: /The Last Reel/ }).click();
  await page.locator('[data-studio-shell="true"]').waitFor();
  await enterAdvancedDepartments(page);
  await selectStudioStage(page, "research");
  await page.locator("[data-research-room]").waitFor();
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const window = windows.find((candidate) => candidate.isVisible()) ?? windows[0];
    const image = await window.webContents.capturePage();
    return image.toPNG().toString("base64");
  });
  await writeFile(join(artifacts, "research-before.png"), Buffer.from(png, "base64"));
  console.log("wrote research-before.png");
} finally {
  await application.close().catch(() => {});
}
