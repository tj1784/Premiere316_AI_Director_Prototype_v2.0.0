import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const preload = readFileSync(join(root, "desktop", "preload.cjs"), "utf8");
const main = readFileSync(join(root, "desktop", "main.mjs"), "utf8");
const backend = readFileSync(join(root, "desktop", "backend.mjs"), "utf8");
const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
const lock = readFileSync(join(root, "DESKTOP.md"), "utf8");

describe("desktop security boundary", () => {
  it("preload does not expose fs, spawn, or a generic path API", () => {
    assert.match(preload, /contextBridge\.exposeInMainWorld/);
    assert.doesNotMatch(preload, /require\(["']fs["']\)/);
    assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*fs/);
    assert.doesNotMatch(preload, /readFileSync/);
    assert.doesNotMatch(preload, /spawn\(/);
  });
  it("sandboxed preload does not require local modules", () => {
    assert.doesNotMatch(preload, /require\(["']\.\/channels/);
    assert.match(preload, /p316:catalog:get/);
  });
  it("renderer never receives a generic models filesystem API", () => {
    assert.doesNotMatch(preload, /modelsRootWrite/);
    assert.doesNotMatch(preload, /readdir/);
    assert.doesNotMatch(preload, /unlink/);
    assert.doesNotMatch(preload, /D:\\\\AI\\\\Models/);
  });
  it("Electron window is sandboxed without nodeIntegration", () => {
    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /sandbox:\s*true/);
    assert.match(main, /webviewTag:\s*false/);
    assert.match(main, /frame:\s*true/);
    assert.match(main, /minimizable:\s*true/);
  });
  it("production does not open an external browser for the product", () => {
    assert.match(main, /isPackaged\(\)/);
    assert.match(main, /return \{ action: "deny" \}/);
    assert.doesNotMatch(main, /shell\.openExternal\(uiOrigin/);
  });
  it("backend owns model scan and engine spawn and sanitizes paths", () => {
    assert.match(backend, /loadCatalog/);
    assert.match(backend, /exposeLocalStill/);
    assert.match(backend, /stopLocalEngine/);
    assert.match(backend, /ALLOWED/);
    assert.match(backend, /sanitizeCatalog/);
    assert.match(backend, /toRelativePath/);
  });
  it("IPC is origin-checked and credentials use safeStorage", () => {
    assert.match(main, /assertTrustedSender/);
    assert.match(main, /Rejected IPC from an untrusted renderer/);
    assert.match(main, /safeStorage/);
    assert.match(main, /showSaveDialog/);
    assert.match(main, /taskkill/);
    assert.match(preload, /p316:app:systemStatus/);
    assert.match(preload, /p316:app:buildInfo/);
    assert.match(main, /rendererMode: isPackaged\(\) \? "PACKAGED DIST" : "DEV SERVER"/);
    assert.match(main, /nvidia-smi/);
    assert.match(preload, /p316:zoom:get/);
    assert.match(preload, /p316:zoom:set/);
    assert.match(main, /setZoomFactor/);
    assert.match(main, /before-input-event/);
  });
  it("Windows executable is Premiere316.exe with an icon and installer", () => {
    assert.match(builder, /executableName:\s*Premiere316/);
    assert.match(builder, /productName:\s*Premiere316/);
    assert.match(builder, /createDesktopShortcut:\s*true/);
    assert.match(builder, /icon:\s*desktop\/icon\.ico/);
    assert.equal(existsSync(join(root, "desktop", "icon.ico")), true);
  });
  it("packages every local Electron runtime dependency and audits the output", () => {
    for (const file of ["main.mjs", "preload.cjs", "channels.cjs", "zoom.cjs"]) {
      assert.equal(existsSync(join(root, "desktop", file)), true);
      assert.equal(builder.includes(`desktop/${file}`), true);
    }
    assert.match(main, /require\("\.\/channels\.cjs"\)/);
    assert.match(main, /require\("\.\/zoom\.cjs"\)/);
    const pack = readFileSync(join(root, "desktop", "pack.mjs"), "utf8");
    assert.match(pack, /packaged runtime audit passed/);
    assert.match(pack, /\/desktop\/zoom\.cjs/);
    assert.match(pack, /ui", "server", "index\.mjs/);
  });
  it("desktop application override is locked", () => {
    assert.match(lock, /standalone Windows desktop application/);
    assert.match(lock, /Premiere316\.exe/);
    assert.match(lock, /contextIsolation: true/);
  });
});
