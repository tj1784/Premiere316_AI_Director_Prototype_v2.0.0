import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const channels = require("./channels.cjs");
const {
  DEFAULT_ZOOM,
  normalizeZoom,
  parseZoomPreferences,
  serializeZoomPreferences,
  stepZoom,
  zoomCommandFromInput,
} = require("./zoom.cjs");

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PRELOAD = join(ROOT, "desktop", "preload.cjs");
const PACKAGED_UI_PORT = 18731;
const DEV_UI_ORIGIN = "http://127.0.0.1:8080";
const MODEL_ROOT = "D:\\AI\\Models";
const CREDENTIAL_NAME = /^[a-z][a-z0-9._-]{0,63}$/;

let mainWindow = null;
let backend = null;
let uiServer = null;
let rpcSeq = 0;
const rpcWait = new Map();
let uiOrigin = DEV_UI_ORIGIN;
let quitting = false;
let interfaceZoom = DEFAULT_ZOOM;
let previousCpuTimes = readCpuTimes();

function readCpuTimes() {
  return cpus().reduce(
    (sum, cpu) => {
      const idle = cpu.times.idle;
      const total = Object.values(cpu.times).reduce((n, value) => n + value, 0);
      return { idle: sum.idle + idle, total: sum.total + total };
    },
    { idle: 0, total: 0 },
  );
}

function readCpuStatus() {
  const current = readCpuTimes();
  const idleDelta = current.idle - previousCpuTimes.idle;
  const totalDelta = current.total - previousCpuTimes.total;
  previousCpuTimes = current;
  const utilizationPercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta))) : 0;
  const memoryTotalBytes = totalmem();
  return {
    utilizationPercent,
    logicalCores: cpus().length,
    memoryUsedBytes: memoryTotalBytes - freemem(),
    memoryTotalBytes,
  };
}

function readGpuStatus() {
  return new Promise((resolve) => {
    const child = spawn(
      "nvidia-smi",
      [
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";
    const finish = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ available: false });
    }, 2500);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => finish({ available: false }));
    child.on("exit", (code) => {
      if (code !== 0) return finish({ available: false });
      const [name, utilization, memoryUsedMiB, memoryTotalMiB, temperatureC, powerWatts] = output
        .trim()
        .split(/\r?\n/, 1)[0]
        ?.split(",")
        .map((value) => value.trim()) ?? [];
      if (!name) return finish({ available: false });
      const MiB = 1024 ** 2;
      finish({
        available: true,
        name,
        utilizationPercent: Number(utilization),
        memoryUsedBytes: Number(memoryUsedMiB) * MiB,
        memoryTotalBytes: Number(memoryTotalMiB) * MiB,
        temperatureC: Number(temperatureC),
        powerWatts: Number(powerWatts),
      });
    });
  });
}

async function readSystemStatus() {
  const [cpu, gpu] = await Promise.all([Promise.resolve(readCpuStatus()), readGpuStatus()]);
  return { sampledAt: Date.now(), cpu, gpu };
}

function isPackaged() {
  return app.isPackaged;
}

function uiPort() {
  return isPackaged() ? PACKAGED_UI_PORT : 8080;
}

function resolveUiOrigin() {
  return `http://127.0.0.1:${uiPort()}`;
}

function nodeAsElectronEnv(extra = {}) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extra };
}

function backendCwd() {
  if (!isPackaged()) return ROOT;
  const temp = "D:\\_Temp\\Premiere316";
  mkdirSync(temp, { recursive: true });
  return temp;
}

function appIcon() {
  const candidates = [
    join(ROOT, "desktop", "icon.ico"),
    join(process.resourcesPath ?? "", "icon.ico"),
  ];
  return candidates.find((file) => file && existsSync(file));
}

function readBuildInfo() {
  const candidates = isPackaged()
    ? [join(process.resourcesPath, "build-info.json")]
    : [join(ROOT, "desktop", "build-info.json")];
  let saved = null;
  for (const file of candidates) {
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
      break;
    } catch {
      /* development builds may not have a generated identity yet */
    }
  }
  return {
    schemaVersion: 1,
    appVersion: String(saved?.appVersion ?? app.getVersion()),
    buildId: String(saved?.buildId ?? "development"),
    buildTimestamp: String(saved?.buildTimestamp ?? "unpackaged"),
    rendererSourceHash: String(saved?.rendererSourceHash ?? "unavailable"),
    rendererMode: isPackaged() ? "PACKAGED DIST" : "DEV SERVER",
    executablePath: process.execPath,
    appPath: app.getAppPath(),
  };
}

function backendEntry() {
  if (isPackaged()) {
    const packed = join(process.resourcesPath, "backend.mjs");
    if (existsSync(packed)) return { file: packed, stripTypes: false };
  }
  return { file: join(ROOT, "desktop", "backend.mjs"), stripTypes: true };
}

function packagedUiEntry() {
  const candidates = [
    join(process.resourcesPath, "ui", "server", "index.mjs"),
    join(process.resourcesPath, "ui", "server", "index.js"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function killTree(child) {
  if (!child || child.killed) return;
  const pid = child.pid;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  if (process.platform === "win32" && pid) {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  }
}

function startBackend() {
  const entry = backendEntry();
  const args = entry.stripTypes ? ["--experimental-strip-types", entry.file] : [entry.file];
  const child = spawn(process.execPath, args, {
    cwd: backendCwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: nodeAsElectronEnv({ PREMIERE316_DESKTOP: "1" }),
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      const pending = rpcWait.get(msg.id);
      if (!pending) return;
      rpcWait.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error || "Backend error"));
    } catch {
      /* ignore non-JSON log lines */
    }
  });
  child.stderr?.on("data", (d) => process.stderr.write(d));
  child.on("exit", (code) => {
    if (backend === child) backend = null;
    for (const [, p] of rpcWait) p.reject(new Error(`Backend exited (${code})`));
    rpcWait.clear();
  });
  backend = child;
}

function callBackend(method, params) {
  if (!backend?.stdin) return Promise.reject(new Error("Desktop backend is not running"));
  const id = ++rpcSeq;
  return new Promise((resolve, reject) => {
    rpcWait.set(id, { resolve, reject });
    backend.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    setTimeout(() => {
      if (rpcWait.has(id)) {
        rpcWait.delete(id);
        reject(new Error("Desktop backend timed out"));
      }
    }, 300_000);
  });
}

function assertTrustedSender(event) {
  const raw = event.senderFrame?.url ?? "";
  let origin = "";
  try {
    origin = new URL(raw).origin;
  } catch {
    origin = "";
  }
  if (origin !== uiOrigin) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
  if (mainWindow && event.sender !== mainWindow.webContents) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}

function isUnderModelRoot(filePath) {
  const normalized = String(filePath || "").replace(/\//g, "\\").toLowerCase();
  const root = MODEL_ROOT.replace(/\//g, "\\").toLowerCase();
  return normalized === root || normalized.startsWith(`${root}\\`);
}

function mimeFromPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function readImageFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  if (isUnderModelRoot(filePath)) {
    throw new Error("Renderer cannot read D:\\AI\\Models directly.");
  }
  const buf = readFileSync(filePath);
  const mime = mimeFromPath(filePath);
  return {
    name: basename(filePath),
    mime,
    dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
  };
}

function credentialsPath() {
  return join(app.getPath("userData"), "credentials.bin.json");
}

function interfacePreferencesPath() {
  return join(app.getPath("userData"), "interface.json");
}

function readInterfaceZoom() {
  try {
    return parseZoomPreferences(readFileSync(interfacePreferencesPath(), "utf8"));
  } catch {
    return DEFAULT_ZOOM;
  }
}

function persistInterfaceZoom(factor) {
  const file = interfacePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeZoomPreferences(factor), "utf8");
}

function applyInterfaceZoom(factor, { persist = true } = {}) {
  interfaceZoom = normalizeZoom(factor);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(interfaceZoom);
    mainWindow.webContents.send(channels.zoomChanged, interfaceZoom);
  }
  if (persist) persistInterfaceZoom(interfaceZoom);
  return interfaceZoom;
}

function runZoomCommand(command) {
  if (command === "reset") return applyInterfaceZoom(DEFAULT_ZOOM);
  return applyInterfaceZoom(stepZoom(interfaceZoom, command === "in" ? 1 : -1));
}

function installApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "View",
      submenu: [
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => runZoomCommand("in") },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => runZoomCommand("out") },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => runZoomCommand("reset") },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function readCredentialStore() {
  try {
    const raw = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    if (raw?.version === 1 && raw.items && typeof raw.items === "object") return raw;
  } catch {
    /* empty */
  }
  return { version: 1, items: {} };
}

function writeCredentialStore(store) {
  mkdirSync(dirname(credentialsPath()), { recursive: true });
  writeFileSync(credentialsPath(), `${JSON.stringify(store)}\n`);
}

function assertCredentialName(name) {
  if (!CREDENTIAL_NAME.test(String(name || ""))) throw new Error("Invalid credential name");
}

function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable on this Windows profile.");
  }
  return safeStorage.encryptString(String(value ?? "")).toString("base64");
}

function decryptSecret(payload) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable on this Windows profile.");
  }
  return safeStorage.decryptString(Buffer.from(String(payload), "base64"));
}

function registerIpc() {
  const wrap = (handler) => (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };
  ipcMain.handle(channels.catalogGet, wrap((_e, query) => callBackend("catalog.get", query ?? {})));
  ipcMain.handle(channels.stillsWake, wrap(() => callBackend("stills.wake")));
  ipcMain.handle(channels.stillsExpose, wrap((_e, input) => callBackend("stills.expose", input)));
  ipcMain.handle(channels.enginesStop, wrap(() => callBackend("engines.stop")));
  ipcMain.handle(channels.enginesBenchmark, wrap((_e, input) => callBackend("engines.benchmark", input)));
  ipcMain.handle(channels.enginesInspect, wrap((_e, input) => callBackend("engines.inspect", input)));
  ipcMain.handle(channels.appVersion, wrap(() => app.getVersion()));
  ipcMain.handle(channels.appBuildInfo, wrap(() => readBuildInfo()));
  ipcMain.handle(channels.appModelRoot, wrap(() => callBackend("app.modelRoot")));
  ipcMain.handle(channels.appSystemStatus, wrap(() => readSystemStatus()));
  ipcMain.handle(channels.zoomGet, wrap(() => interfaceZoom));
  ipcMain.handle(channels.zoomSet, wrap((_e, factor) => applyInterfaceZoom(factor)));
  ipcMain.handle(
    channels.dialogOpenImages,
    wrap(async () => {
      const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: "Reference stills",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (picked.canceled) return [];
      return picked.filePaths.slice(0, 3).map((filePath) => readImageFile(filePath)).filter(Boolean);
    }),
  );
  ipcMain.handle(
    channels.dialogOpenFolder,
    wrap(async () => {
      const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: "Choose folder",
        properties: ["openDirectory"],
      });
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      if (isUnderModelRoot(picked.filePaths[0])) {
        throw new Error("D:\\AI\\Models is not a renderer-selectable folder.");
      }
      return { canceled: false, label: basename(picked.filePaths[0]) };
    }),
  );
  ipcMain.handle(
    channels.dialogSaveText,
    wrap(async (_e, input) => {
      const defaultName = String(input?.defaultName || "untitled.txt").replace(/[/\\]/g, "");
      const picked = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: "Save",
        defaultPath: defaultName,
        filters: [{ name: "File", extensions: [extname(defaultName).replace(".", "") || "txt"] }],
      });
      if (picked.canceled || !picked.filePath) return { canceled: true };
      if (isUnderModelRoot(picked.filePath)) throw new Error("Cannot write into D:\\AI\\Models.");
      writeFileSync(picked.filePath, String(input?.contents ?? ""), "utf8");
      return { canceled: false, name: basename(picked.filePath) };
    }),
  );
  ipcMain.handle(
    channels.dialogSaveMany,
    wrap(async (_e, input) => {
      const files = Array.isArray(input?.files) ? input.files.slice(0, 24) : [];
      const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: "Export folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      const folder = picked.filePaths[0];
      if (isUnderModelRoot(folder)) throw new Error("Cannot write into D:\\AI\\Models.");
      for (const file of files) {
        const name = String(file?.filename || "file.txt").replace(/[/\\]/g, "");
        writeFileSync(join(folder, name), String(file?.contents ?? ""), "utf8");
      }
      return { canceled: false, count: files.length, folderLabel: basename(folder) };
    }),
  );
  ipcMain.handle(
    channels.filesReadImage,
    wrap((_e, filePath) => readImageFile(String(filePath || ""))),
  );
  ipcMain.handle(
    channels.credentialsGet,
    wrap((_e, name) => {
      assertCredentialName(name);
      const store = readCredentialStore();
      const payload = store.items[name];
      if (!payload) return null;
      return decryptSecret(payload);
    }),
  );
  ipcMain.handle(
    channels.credentialsSet,
    wrap((_e, name, value) => {
      assertCredentialName(name);
      const store = readCredentialStore();
      store.items[name] = encryptSecret(value);
      writeCredentialStore(store);
    }),
  );
  ipcMain.handle(
    channels.credentialsDelete,
    wrap((_e, name) => {
      assertCredentialName(name);
      const store = readCredentialStore();
      delete store.items[name];
      writeCredentialStore(store);
    }),
  );
}

function attachWindowGuards(win) {
  win.webContents.on("before-input-event", (event, input) => {
    const command = zoomCommandFromInput(input);
    if (!command) return;
    event.preventDefault();
    runZoomCommand(command);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(uiOrigin)) return { action: "allow" };
    // Production never hands the product off to Chrome/Edge. Dev may open docs.
    if (!isPackaged() && /^https?:\/\//i.test(url) && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(uiOrigin) && !url.startsWith("devtools://")) event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on("will-download", (event) => {
    // Native save dialogs own downloads. Do not bounce to an external browser.
    event.preventDefault();
  });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["file://*"] }, (details, cb) => {
    const blocked = /D:\/AI\/Models/i.test(details.url) || /D:%5CAI%5CModels/i.test(details.url);
    cb({ cancel: blocked });
  });
}

async function waitForUi(origin, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 304) return;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Premiere316 UI server is not running on ${origin}`);
}

function startPackagedUiServer() {
  const entry = packagedUiEntry();
  if (!entry) {
    throw new Error("Packaged UI server is missing. Rebuild with npm run electron:pack.");
  }
  const port = String(uiPort());
  const child = spawn(process.execPath, [entry], {
    cwd: dirname(dirname(entry)),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: nodeAsElectronEnv({
      HOST: "127.0.0.1",
      PORT: port,
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: port,
      PREMIERE316_DESKTOP: "1",
    }),
  });
  child.stdout?.on("data", (d) => process.stdout.write(d));
  child.stderr?.on("data", (d) => process.stderr.write(d));
  child.on("exit", (code) => {
    if (uiServer === child) uiServer = null;
    if (code && code !== 0) {
      console.error(`[premiere316] UI server exited (${code})`);
    }
  });
  uiServer = child;
}

async function verifyRenderer(win) {
  try {
    const info = await win.webContents.executeJavaScript(
      `({ title: document.title, href: location.href, desktop: Boolean(window.premiere316?.isDesktop) })`,
    );
    console.log(`[premiere316] renderer ready ${JSON.stringify(info)}`);
    const artifacts = isPackaged() ? "D:\\_Temp\\Premiere316" : join(ROOT, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    const payload = { ...info, at: Date.now(), packaged: isPackaged(), build: readBuildInfo() };
    writeFileSync(join(artifacts, "desktop-launch.json"), `${JSON.stringify(payload, null, 2)}\n`);
    const image = await win.webContents.capturePage();
    writeFileSync(join(artifacts, "desktop-window.png"), image.toPNG());
  } catch (error) {
    console.error("[premiere316] renderer verify failed:", error);
  }
}

function createWindow() {
  const icon = appIcon();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: "Premiere316",
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    frame: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    fullscreenable: true,
    show: false,
    icon,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      webviewTag: false,
    },
  });
  attachWindowGuards(mainWindow);
  mainWindow.webContents.setZoomFactor(interfaceZoom);
  installApplicationMenu();
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("did-finish-load", () => {
    applyInterfaceZoom(interfaceZoom, { persist: false });
    void verifyRenderer(mainWindow);
  });
  void mainWindow.loadURL(uiOrigin);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function stopSupervised() {
  try {
    await Promise.race([callBackend("engines.stop"), new Promise((r) => setTimeout(r, 4000))]);
  } catch {
    /* backend already gone */
  }
  killTree(backend);
  killTree(uiServer);
  backend = null;
  uiServer = null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId("com.premiere316.desktop");
  Menu.setApplicationMenu(null);
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("ready", async () => {
    uiOrigin = resolveUiOrigin();
    interfaceZoom = readInterfaceZoom();
    registerIpc();
    startBackend();
    try {
      if (isPackaged()) {
        startPackagedUiServer();
      }
      await waitForUi(uiOrigin);
    } catch (error) {
      dialog.showErrorBox("Premiere316", String(error instanceof Error ? error.message : error));
      app.quit();
      return;
    }
    createWindow();
  });

  app.on("window-all-closed", () => {
    if (quitting) return;
    quitting = true;
    void stopSupervised().finally(() => app.exit(0));
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void stopSupervised().finally(() => app.exit(0));
  });
}
