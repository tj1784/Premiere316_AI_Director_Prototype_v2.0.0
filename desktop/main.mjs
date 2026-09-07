import { app, BrowserWindow, Menu, dialog, ipcMain, protocol as electronProtocol, safeStorage, session, shell } from "electron";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { cpus, freemem, totalmem } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertImportableAudio, assertImportableVideo, assertPlusExportReady, buildLiteExportArgs, buildPlusExportArgs, concatListContents, missingFfmpegResult, parseFfprobeAudioJson, parseFfprobeJson, plusExportDurationSec, timelineDurationSec } from "./ffmpeg-tool.mjs";

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
const AUTHORITY_REVIEW_PRELOAD = join(ROOT, "desktop", "authority-review-preload.cjs");
const AUTHORITY_REVIEW_HTML = join(ROOT, "desktop", "authority-review.html");
const CONFIRMATION_PRELOAD = join(ROOT, "desktop", "confirmation-preload.cjs");
const CONFIRMATION_HTML = join(ROOT, "desktop", "confirmation.html");
const PACKAGED_UI_PORT = 18731;
const DEV_UI_ORIGIN = "http://127.0.0.1:8080";
const MODEL_ROOT = "D:\\AI\\Models";
const EXTERNAL_RUNTIME_ROOTS = ["D:\\Projects\\flux", "D:\\Projects\\Flux2", "D:\\_Cache\\HuggingFace", "D:\\Dev\\Tools\\Python312"];
const CREDENTIAL_NAME = /^[a-z][a-z0-9._-]{0,63}$/;

let mainWindow = null;
let backend = null;
let uiServer = null;
let rpcSeq = 0;
const rpcWait = new Map();
let uiOrigin = DEV_UI_ORIGIN;
let quitting = false;
let interfaceZoom = DEFAULT_ZOOM;
let lastExportDir = "";
let lastExportPath = "";
let uatVideoQueue = null;
let previousCpuTimes = readCpuTimes();
const authorityReviewModals = new Map();
const confirmationModals = new Map();

electronProtocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

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

function ledgerKeyPath() {
  return join(app.getPath("userData"), "ledger-key.bin");
}

function readLedgerHmacKey() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable on this Windows profile.");
  const file = ledgerKeyPath();
  try {
    const encrypted = readFileSync(file);
    const hex = safeStorage.decryptString(encrypted).trim();
    if (/^[a-f0-9]{64}$/i.test(hex)) return hex.toLowerCase();
  } catch {
    /* create below */
  }
  const hex = randomBytes(32).toString("hex");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(hex));
  return hex;
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
  const build = readBuildInfo();
  const args = entry.stripTypes ? ["--experimental-strip-types", entry.file] : [entry.file];
  const child = spawn(process.execPath, args, {
    cwd: backendCwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: nodeAsElectronEnv({ PREMIERE316_DESKTOP: "1", P316_PACKAGED_APP: isPackaged() ? "1" : "0", P316_RESOURCES_PATH: process.resourcesPath ?? ROOT, P316_BUILD_ID: build.buildId, P316_LEDGER_HMAC_KEY: readLedgerHmacKey() }),
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

function imageMediaRoot() {
  return join(app.getPath("userData"), "media");
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function spawnCapture(command, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function resolveOnPath(exe) {
  return new Promise((resolveBin) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = spawn(cmd, [exe], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => resolveBin(null));
    child.on("exit", () => {
      const line = out.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
      resolveBin(line && existsSync(line) ? line : null);
    });
  });
}

async function discoverFfmpegTools() {
  const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const ffmpeg = (process.env.P316_FFMPEG_BINARY && existsSync(process.env.P316_FFMPEG_BINARY) ? process.env.P316_FFMPEG_BINARY : null) || await resolveOnPath(ffmpegName);
  const ffprobe = (process.env.P316_FFPROBE_BINARY && existsSync(process.env.P316_FFPROBE_BINARY) ? process.env.P316_FFPROBE_BINARY : null) || await resolveOnPath(ffprobeName);
  if (!ffmpeg || !ffprobe) return missingFfmpegResult();
  return { ok: true, ffmpeg, ffprobe, reason: "Local FFmpeg/FFprobe discovered on PATH." };
}

function takeUatVideoPath() {
  if (!uatVideoQueue) {
    const listed = process.env.PREMIERE316_UAT_IMPORT_VIDEOS || process.env.PREMIERE316_UAT_IMPORT || "";
    uatVideoQueue = listed.split(/[;|]/).map((item) => item.trim()).filter((item) => item && existsSync(item));
  }
  return uatVideoQueue.shift() || "";
}

async function importVideoFromDisk() {
  const uat = takeUatVideoPath();
  let source = "";
  if (uat) {
    source = uat;
  } else {
    const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "Import video",
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "mkv"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    source = picked.filePaths[0];
  }
  if (isUnderModelRoot(source) || isUnderProtectedRuntimeRoot(source)) {
    throw new Error("Cannot import from model, runtime, or cache roots.");
  }
  const info = statSync(source);
  assertImportableVideo({ filePath: source, byteLength: info.size, extension: extname(source) });
  const tools = await discoverFfmpegTools();
  if (!tools.ok) return { ok: false, canceled: false, error: tools.reason };
  const probed = await spawnCapture(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", source]);
  if (probed.code !== 0) return { ok: false, canceled: false, error: probed.stderr || "ffprobe failed." };
  const probe = parseFfprobeJson(probed.stdout);
  if (!probe.ok) return { ok: false, canceled: false, error: probe.error || "Imported file is not a real video." };
  const sha = hashFile(source);
  const destDir = join(app.getPath("userData"), "imported");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `${sha.slice(0, 16)}${extname(source).toLowerCase() || ".mp4"}`);
  copyFileSync(source, dest);
  const destHash = hashFile(dest);
  if (destHash !== sha) throw new Error("Imported copy hash mismatch.");
  return {
    ok: true,
    canceled: false,
    origin: "imported",
    filename: basename(source),
    mediaUri: dest,
    mediaSha256: destHash,
    byteLength: statSync(dest).size,
    probe,
  };
}

async function exportLiteMp4(input) {
  const tools = await discoverFfmpegTools();
  if (!tools.ok) return { ok: false, error: tools.reason };
  const source = String(input?.mediaUri || "");
  if (!source || !existsSync(source)) return { ok: false, error: "Canonical imported media is missing on disk." };
  if (isUnderModelRoot(source) || isUnderProtectedRuntimeRoot(source)) throw new Error("Cannot export from model, runtime, or cache roots.");
  const userData = app.getPath("userData");
  if (!isUnderRoot(source, userData)) throw new Error("Export source must be inside the app profile imported store.");
  const outDir = join(userData, "exports");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const finalPath = join(outDir, `m1-lite-${stamp}.mp4`);
  const tmpPath = join(outDir, `m1-lite-${stamp}.tmp.mp4`);
  const args = buildLiteExportArgs({
    ffmpeg: tools.ffmpeg,
    sourcePath: source,
    outputTmpPath: tmpPath,
    durationSec: input?.durationSec,
    fps: input?.fps,
    hasAudio: input?.hasAudio === true,
  });
  try {
    const ran = await spawnCapture(args[0], args.slice(1), 120_000);
    if (ran.code !== 0 || !existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* none */ }
      return { ok: false, error: ran.stderr || "FFmpeg export failed." };
    }
    renameSync(tmpPath, finalPath);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* none */ }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const outHash = hashFile(finalPath);
  const outProbeRaw = await spawnCapture(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", finalPath]);
  const outProbe = parseFfprobeJson(outProbeRaw.stdout || "{}");
  lastExportDir = outDir;
  lastExportPath = finalPath;
  return {
    ok: true,
    origin: "imported",
    outputPath: finalPath,
    outputDir: outDir,
    sha256: outHash,
    byteLength: statSync(finalPath).size,
    probe: outProbe,
    sourceSha256: String(input?.mediaSha256 || ""),
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
  };
}

async function importAudioFromDisk() {
  const uat = process.env.PREMIERE316_UAT_IMPORT_AUDIO;
  let source = "";
  if (uat && existsSync(uat)) {
    source = uat;
  } else {
    const picked = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "Import audio",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    source = picked.filePaths[0];
  }
  if (isUnderModelRoot(source) || isUnderProtectedRuntimeRoot(source)) {
    throw new Error("Cannot import from model, runtime, or cache roots.");
  }
  const info = statSync(source);
  assertImportableAudio({ filePath: source, byteLength: info.size, extension: extname(source) });
  const tools = await discoverFfmpegTools();
  if (!tools.ok) return { ok: false, canceled: false, error: tools.reason };
  const probed = await spawnCapture(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", source]);
  if (probed.code !== 0) return { ok: false, canceled: false, error: probed.stderr || "ffprobe failed." };
  const probe = parseFfprobeAudioJson(probed.stdout);
  if (!probe.ok) return { ok: false, canceled: false, error: probe.error || "Imported file is not real audio." };
  const sha = hashFile(source);
  const destDir = join(app.getPath("userData"), "imported-audio");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `${sha.slice(0, 16)}${extname(source).toLowerCase() || ".wav"}`);
  copyFileSync(source, dest);
  const destHash = hashFile(dest);
  if (destHash !== sha) throw new Error("Imported audio copy hash mismatch.");
  return {
    ok: true,
    canceled: false,
    origin: "imported",
    filename: basename(source),
    mediaUri: dest,
    mediaSha256: destHash,
    byteLength: statSync(dest).size,
    probe,
  };
}

async function exportPlusMp4(input) {
  const tools = await discoverFfmpegTools();
  if (!tools.ok) return { ok: false, error: tools.reason };
  const videos = Array.isArray(input?.videos) ? input.videos : [];
  const audioPath = String(input?.audioUri || "");
  const userData = app.getPath("userData");
  try {
    assertPlusExportReady({ videos, audioPath });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  for (const clip of videos) {
    const source = String(clip?.mediaUri || "");
    if (!source || !existsSync(source)) return { ok: false, error: "Canonical imported video is missing on disk." };
    if (isUnderModelRoot(source) || isUnderProtectedRuntimeRoot(source) || !isUnderRoot(source, userData)) {
      throw new Error("Export source must be inside the app profile imported store.");
    }
  }
  if (!existsSync(audioPath) || !isUnderRoot(audioPath, userData)) return { ok: false, error: "Canonical imported audio is missing on disk." };
  const durationSec = plusExportDurationSec(timelineDurationSec(videos));
  const outDir = join(userData, "exports");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const finalPath = join(outDir, `m1-plus-${stamp}.mp4`);
  const tmpPath = join(outDir, `m1-plus-${stamp}.tmp.mp4`);
  const listPath = join(outDir, `m1-plus-${stamp}.concat.txt`);
  writeFileSync(listPath, concatListContents(videos.map((clip) => clip.mediaUri)), "utf8");
  const args = buildPlusExportArgs({
    ffmpeg: tools.ffmpeg,
    videos,
    audioPath,
    concatListPath: listPath,
    outputTmpPath: tmpPath,
    durationSec,
    fps: input?.fps || 24,
  });
  try {
    const ran = await spawnCapture(args[0], args.slice(1), 180_000);
    if (ran.code !== 0 || !existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* none */ }
      return { ok: false, error: ran.stderr || "FFmpeg 30s export failed." };
    }
    renameSync(tmpPath, finalPath);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* none */ }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const outHash = hashFile(finalPath);
  const outProbeRaw = await spawnCapture(tools.ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", finalPath]);
  const outProbe = parseFfprobeJson(outProbeRaw.stdout || "{}");
  lastExportDir = outDir;
  lastExportPath = finalPath;
  return {
    ok: true,
    origin: "imported",
    kind: "m1-plus",
    outputPath: finalPath,
    outputDir: outDir,
    sha256: outHash,
    byteLength: statSync(finalPath).size,
    probe: outProbe,
    durationSec,
    sourceVideos: videos.map((clip) => ({ mediaUri: clip.mediaUri, mediaSha256: clip.mediaSha256, durationSec: clip.durationSec })),
    sourceAudioSha256: String(input?.audioSha256 || ""),
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
  };
}

function withMediaRoot(params = {}) {
  return { ...(params && typeof params === "object" ? params : {}), mediaRoot: imageMediaRoot() };
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

function isUnderRoot(filePath, rootPath) {
  try {
    const realFile = realpathSync(filePath).replace(/\//g, "\\").toLowerCase();
    const realRoot = realpathSync(rootPath).replace(/\//g, "\\").toLowerCase();
    return realFile === realRoot || realFile.startsWith(`${realRoot}\\`);
  } catch {
    const normalized = String(filePath || "").replace(/\//g, "\\").toLowerCase();
    const root = String(rootPath || "").replace(/\//g, "\\").toLowerCase();
    return normalized === root || normalized.startsWith(`${root}\\`);
  }
}

function isUnderModelRoot(filePath) {
  return isUnderRoot(filePath, MODEL_ROOT);
}

function isUnderProtectedRuntimeRoot(filePath) {
  return EXTERNAL_RUNTIME_ROOTS.some((root) => isUnderRoot(filePath, root));
}

function mimeFromPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error("Unsupported reference image extension.");
}

function looksLikeImage(buf, mime) {
  if (mime === "image/png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 4;
  if (mime === "image/gif") return buf.slice(0, 3).toString("ascii") === "GIF";
  if (mime === "image/webp") return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  return false;
}

function readImageFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  if (isUnderModelRoot(filePath) || isUnderProtectedRuntimeRoot(filePath)) {
    throw new Error("Renderer cannot read local model, runtime, or cache roots directly.");
  }
  const buf = readFileSync(filePath);
  if (buf.byteLength > 12 * 1024 * 1024) throw new Error("Reference image is too large.");
  const mime = mimeFromPath(filePath);
  if (!looksLikeImage(buf, mime)) throw new Error("Reference file is not a supported image.");
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

function registerMediaProtocol() {
  electronProtocol.registerFileProtocol("media", (request, callback) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "stills") throw new Error("Unsupported media host.");
      const rawPath = url.pathname.replace(/^\/+/, "");
      if (/%2e|%2f|%5c|:/i.test(rawPath)) throw new Error("Encoded traversal is not allowed.");
      const name = decodeURIComponent(rawPath);
      if (!/^[a-zA-Z0-9._-]+\.png$/.test(name) || name.startsWith(".")) throw new Error("Invalid media path.");
      const root = resolve(imageMediaRoot(), "stills");
      const rootReal = realpathSync(root);
      const file = resolve(rootReal, name);
      const real = realpathSync(file);
      const rel = relative(rootReal, real);
      if (rel.startsWith("..") || rel === "" || /[/\\]/.test(rel)) throw new Error("Media path escapes the durable media root.");
      callback({ path: real });
    } catch {
      callback({ error: -6 });
    }
  });
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

function assertAuthorityReviewSender(event, nonce) {
  const state = authorityReviewModals.get(String(nonce ?? ""));
  if (!state || event.sender !== state.webContents) throw new Error("Rejected authority review IPC from an untrusted renderer.");
  return state;
}

function assertConfirmationSender(event, nonce) {
  const state = confirmationModals.get(String(nonce ?? ""));
  if (!state || event.sender !== state.webContents) throw new Error("Rejected confirmation IPC from an untrusted renderer.");
  return state;
}

async function showAuthorityReviewModal(reviewDocument) {
  const nonce = randomBytes(24).toString("hex");
  const modalPartition = `authority-review-${nonce}`;
  return new Promise((resolveModal) => {
    const parent = mainWindow ?? undefined;
    const modal = new BrowserWindow({
      width: 920,
      height: 720,
      minWidth: 390,
      title: "Seal production authority",
      parent,
      modal: Boolean(parent),
      show: false,
      webPreferences: { preload: AUTHORITY_REVIEW_PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, partition: modalPartition },
    });
    const cleanup = (confirmed) => {
      if (!authorityReviewModals.has(nonce)) return;
      authorityReviewModals.delete(nonce);
      resolveModal(Boolean(confirmed));
      if (!modal.isDestroyed()) modal.close();
    };
    authorityReviewModals.set(nonce, { webContents: modal.webContents, reviewDocument, resolve: cleanup, partition: modalPartition });
    modal.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    modal.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file://")) event.preventDefault(); });
    const modalSession = session.fromPartition(modalPartition);
    if (modal.webContents.session !== modalSession || modalSession === session.defaultSession) throw new Error("Authority review modal failed to isolate its Electron session.");
    modalSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    modalSession.setPermissionCheckHandler(() => false);
    modalSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
    modal.once("closed", () => cleanup(false));
    modal.once("ready-to-show", () => modal.show());
    modal.loadFile(AUTHORITY_REVIEW_HTML, { query: { nonce } }).catch(() => cleanup(false));
  });
}

async function showMainOwnedConfirmation({ title, message, summary, confirmLabel, intent = "confirm" }) {
  const nonce = randomBytes(24).toString("hex");
  const modalPartition = `confirmation-${nonce}`;
  const frozenSummary = Object.freeze({
    title: String(title ?? "Confirm action"),
    message: String(message ?? "Confirm this action?"),
    confirmLabel: String(confirmLabel ?? "Confirm"),
    intent: String(intent ?? "confirm"),
    lines: Object.freeze((Array.isArray(summary) ? summary : []).map((line) => Object.freeze({
      label: String(line?.label ?? "Detail"),
      value: String(line?.value ?? ""),
    }))),
  });
  return new Promise((resolveModal) => {
    const parent = mainWindow ?? undefined;
    const modal = new BrowserWindow({
      width: 640,
      height: 560,
      minWidth: 390,
      minHeight: 420,
      title: frozenSummary.title,
      parent,
      modal: Boolean(parent),
      show: false,
      webPreferences: { preload: CONFIRMATION_PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, partition: modalPartition },
    });
    const cleanup = (confirmed) => {
      if (!confirmationModals.has(nonce)) return;
      confirmationModals.delete(nonce);
      resolveModal(Boolean(confirmed));
      if (!modal.isDestroyed()) modal.close();
    };
    confirmationModals.set(nonce, { webContents: modal.webContents, summary: frozenSummary, resolve: cleanup, partition: modalPartition });
    modal.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    modal.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file://")) event.preventDefault(); });
    const modalSession = session.fromPartition(modalPartition);
    if (modal.webContents.session !== modalSession || modalSession === session.defaultSession) throw new Error("Confirmation modal failed to isolate its Electron session.");
    modalSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    modalSession.setPermissionCheckHandler(() => false);
    modalSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
    modal.once("closed", () => cleanup(false));
    modal.once("ready-to-show", () => modal.show());
    modal.loadFile(CONFIRMATION_HTML, { query: { nonce } }).catch(() => cleanup(false));
  });
}

function registerIpc() {
  const wrap = (handler) => (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };
  ipcMain.handle("p316:authorityReview:get", (event, input) => {
    const state = assertAuthorityReviewSender(event, input?.nonce);
    return { reviewDocument: state.reviewDocument };
  });
  ipcMain.handle("p316:authorityReview:resolve", (event, input) => {
    const state = assertAuthorityReviewSender(event, input?.nonce);
    state.resolve(input?.confirmed === true);
    return { ok: true };
  });
  ipcMain.handle("p316:confirmation:get", (event, input) => {
    const state = assertConfirmationSender(event, input?.nonce);
    return { summary: state.summary };
  });
  ipcMain.handle("p316:confirmation:resolve", (event, input) => {
    const state = assertConfirmationSender(event, input?.nonce);
    state.resolve(input?.confirmed === true);
    return { ok: true };
  });
  ipcMain.handle(channels.catalogGet, wrap((_e, query) => callBackend("catalog.get", query ?? {})));
  ipcMain.handle(channels.imageAuthorityStatus, wrap((_e, input) => callBackend("image.authorityStatus", withMediaRoot(input))));
  ipcMain.handle(channels.imageSealAuthority, wrap(async (_e, input) => {
    const proposal = await callBackend("image.proposeProductionAuthority", withMediaRoot(input));
    if (!proposal?.ok) return proposal;
    const confirmed = await showAuthorityReviewModal(String(proposal.reviewDocument ?? ""));
    return callBackend("image.confirmProductionAuthority", withMediaRoot({ proposalId: proposal.proposalId, confirmed }));
  }));
  ipcMain.handle(channels.imageApprovePrepared, wrap(async (_e, input) => {
    const proposal = await callBackend("image.proposePreparedApproval", withMediaRoot(input));
    if (!proposal?.ok) return proposal;
    const summary = proposal.summary ?? {};
    const confirmed = await showMainOwnedConfirmation({
      title: "Confirm prepared asset approval",
      message: "Approve this prepared asset root for generation?",
      confirmLabel: "Confirm Prepared Approval",
      intent: "prepared-approval",
      summary: [
        { label: "Authority", value: summary.authorityId ?? "missing" },
        { label: "Authority digest", value: summary.authorityDigest ?? "missing" },
        { label: "Asset", value: summary.assetId ?? "unknown" },
        { label: "Prepared asset", value: summary.preparedAssetId ?? "unknown" },
        { label: "Spec", value: summary.specVersionId ?? "unknown" },
        { label: "Prompt", value: summary.prompt ?? "" },
        { label: "Dependencies", value: summary.dependencyCount ?? 0 },
        { label: "References", value: (summary.referenceIds ?? []).join(", ") || "none" },
      ],
    });
    return callBackend("image.confirmPreparedApproval", withMediaRoot({ proposalId: proposal.proposalId, confirmed }));
  }));
  ipcMain.handle(channels.imageAuthorizePrepared, wrap(async (_e, input) => {
    const proposal = await callBackend("image.proposePrepared", withMediaRoot(input));
    if (!proposal?.ok) return proposal;
    const summary = proposal.summary ?? {};
    const confirmed = await showMainOwnedConfirmation({
      title: "Confirm prepared image generation",
      message: "Create one sealed FLUX.1 image generation token?",
      confirmLabel: "Confirm Generate",
      intent: "prepared-generation",
      summary: [
        { label: "Asset", value: summary.assetId ?? "unknown" },
        { label: "Spec", value: summary.specVersionId ?? "unknown" },
        { label: "Engine", value: summary.engine ?? "FLUX.1" },
        { label: "Prompt", value: summary.prompt ?? "" },
        { label: "Manifest", value: summary.manifestDigest ?? "" },
        { label: "Dependencies", value: summary.dependencyCount ?? 0 },
      ],
    });
    return callBackend("image.confirmPrepared", withMediaRoot({ proposalId: proposal.proposalId, confirmed }));
  }));
  ipcMain.handle(channels.imageGeneratePrepared, wrap((_e, input) => callBackend("image.generatePrepared", withMediaRoot(input))));
  ipcMain.handle(channels.imageRejectCanonical, wrap(async (_e, input) => {
    const proposal = await callBackend("image.proposeCanonicalRejection", withMediaRoot(input));
    if (!proposal?.ok) return proposal;
    const summary = proposal.summary ?? {};
    const confirmed = await showMainOwnedConfirmation({
      title: "Confirm canonical image rejection",
      message: "Append a signed rejection decision for this generated image?",
      confirmLabel: "Confirm Canonical Rejection",
      intent: "canonical-rejection",
      summary: [
        { label: "Authority", value: summary.authorityId ?? "missing" },
        { label: "Authority digest", value: summary.authorityDigest ?? "missing" },
        { label: "Asset", value: summary.assetId ?? "unknown" },
        { label: "Prepared asset", value: summary.preparedAssetId ?? "unknown" },
        { label: "Iteration", value: summary.iterationId ?? "missing" },
        { label: "Receipt", value: summary.receiptId ?? "missing" },
        { label: "Reason", value: String(summary.reason ?? "").trim() },
      ],
    });
    return callBackend("image.confirmCanonicalRejection", withMediaRoot({ proposalId: proposal.proposalId, confirmed }));
  }));
  ipcMain.handle(channels.imageApproveCanonical, wrap(async (_e, input) => {
    const proposal = await callBackend("image.proposeCanonicalApproval", withMediaRoot(input));
    if (!proposal?.ok) return proposal;
    const summary = proposal.summary ?? {};
    const confirmed = await showMainOwnedConfirmation({
      title: "Confirm canonical image approval",
      message: "Approve this generated PNG as the canonical asset image?",
      confirmLabel: "Confirm Canonical Approval",
      intent: "canonical-approval",
      summary: [
        { label: "Asset", value: summary.assetId ?? "unknown" },
        { label: "Prepared asset", value: summary.preparedAssetId ?? "unknown" },
        { label: "Iteration", value: summary.iterationId ?? "missing" },
        { label: "Receipt", value: summary.receiptId ?? "missing" },
        { label: "Media", value: summary.mediaUri ?? "missing" },
        { label: "Reason", value: String(summary.reason ?? "").trim() },
        { label: "Findings", value: (summary.findings ?? []).map((finding) => `${finding.severity}:${finding.id}`).join(", ") },
      ],
    });
    return callBackend("image.confirmCanonicalApproval", withMediaRoot({ proposalId: proposal.proposalId, confirmed }));
  }));
  ipcMain.handle(channels.enginesStop, wrap(() => callBackend("engines.stop")));

  ipcMain.handle(channels.imageManifests, wrap(() => callBackend("image.manifests", {})));
  ipcMain.handle(channels.appVersion, wrap(() => app.getVersion()));
  ipcMain.handle(channels.appBuildInfo, wrap(() => readBuildInfo()));
  ipcMain.handle(channels.appModelRoot, wrap(() => callBackend("app.modelRoot")));
  ipcMain.handle(channels.appSystemStatus, wrap(() => readSystemStatus()));
  ipcMain.handle(channels.zoomGet, wrap(() => interfaceZoom));
  ipcMain.handle(channels.zoomSet, wrap((_e, factor) => applyInterfaceZoom(factor)));
  ipcMain.handle(channels.mediaDiscover, wrap(() => discoverFfmpegTools()));
  ipcMain.handle(channels.mediaImportVideo, wrap(() => importVideoFromDisk()));
  ipcMain.handle(channels.mediaImportAudio, wrap(() => importAudioFromDisk()));
  ipcMain.handle(channels.mediaExportLite, wrap((_e, input) => exportLiteMp4(input)));
  ipcMain.handle(channels.mediaExportPlus, wrap((_e, input) => exportPlusMp4(input)));
  ipcMain.handle(channels.mediaOpenFolder, wrap(async () => {
    const folder = lastExportDir || join(app.getPath("userData"), "exports");
    if (isUnderModelRoot(folder) || isUnderProtectedRuntimeRoot(folder)) throw new Error("Refusing to open a protected root.");
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const result = await shell.openPath(folder);
    return { ok: !result, folder, error: result || null, lastExportPath: lastExportPath || null };
  }));
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
      if (isUnderModelRoot(picked.filePaths[0]) || isUnderProtectedRuntimeRoot(picked.filePaths[0])) {
        throw new Error("Local model, runtime, and cache roots are not renderer-selectable folders.");
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
      if (isUnderModelRoot(picked.filePath) || isUnderProtectedRuntimeRoot(picked.filePath)) throw new Error("Cannot write into model, runtime, or cache roots.");
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
      if (isUnderModelRoot(folder) || isUnderProtectedRuntimeRoot(folder)) throw new Error("Cannot write into model, runtime, or cache roots.");
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
    registerMediaProtocol();
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
