/**
 * Dev launcher: keep an existing Vite UI if Grok/preview already owns 8080,
 * otherwise start it, then open Premiere316.exe's Electron shell against it.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const UI = "http://127.0.0.1:8080/";

async function uiUp() {
  try {
    const res = await fetch(UI, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status === 304;
  } catch {
    return false;
  }
}

async function waitForUi(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await uiUp()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Premiere316 UI server did not start on 127.0.0.1:8080");
}

function startUi() {
  const viteJs = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const wrapper = join(ROOT, "scripts", "with-app-env.mjs");
  console.log("[premiere316] starting UI server (npm run dev equivalent)…");
  return spawn(process.execPath, [wrapper, process.execPath, viteJs, "dev", "--host", "0.0.0.0", "--port", "8080"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
}

if (!(await uiUp())) {
  const ui = startUi();
  ui.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[premiere316] UI server exited (${code})`);
      process.exit(code);
    }
  });
  try {
    await waitForUi();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const require = createRequire(import.meta.url);
const electron = require("electron");
const child = spawn(electron, [ROOT], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, PREMIERE316_DESKTOP: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
