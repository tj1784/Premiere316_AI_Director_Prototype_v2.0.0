/**
 * Production pack: bundle the local backend, build the UI as a Node server,
 * then emit Premiere316.exe (dir) and the NSIS installer.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const dirOnly = process.argv.includes("--dir");

function rendererSourceFiles() {
  const files = [];
  const visit = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) visit(full);
      else files.push(full);
    }
  };
  visit(join(ROOT, "src"));
  for (const name of ["package.json", "package-lock.json", "vite.config.ts", "electron-builder.yml"]) {
    files.push(join(ROOT, name));
  }
  return files;
}

function writeBuildIdentity() {
  const hash = createHash("sha256");
  for (const file of rendererSourceFiles()) {
    hash.update(relative(ROOT, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  const rendererSourceHash = hash.digest("hex");
  const buildTimestamp = new Date().toISOString();
  const appVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const buildId = `p316-${buildTimestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}-${rendererSourceHash.slice(0, 12)}`;
  const info = {
    schemaVersion: 1,
    appVersion,
    buildId,
    buildTimestamp,
    rendererSourceHash,
    rendererMode: "PACKAGED DIST",
  };
  writeFileSync(join(ROOT, "desktop", "build-info.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  console.log(`[premiere316] build identity ${buildId}`);
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function bundleBackend() {
  const esbuild = await import("esbuild");
  mkdirSync(join(ROOT, "desktop", "dist"), { recursive: true });
  await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [join(ROOT, "desktop", "backend.mjs")],
    outfile: join(ROOT, "desktop", "dist", "backend.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "info",
    legalComments: "none",
    banner: {
      js: 'import { createRequire as __p316Require } from "node:module"; const require = __p316Require(import.meta.url);',
    },
  });

  const bundledBackend = join(ROOT, "desktop", "dist", "backend.mjs");
  const source = readFileSync(bundledBackend, "utf8");
  const forbiddenLegacyRuntimeMarkers = [
    "D:\\AI\\ComfyUI",
    "127.0.0.1:8188",
    "comfy-engine.log",
    "COMFY_URL",
    "custom_nodes",
    "D:\\Projects\\Flux2",
    "blokey-studio",
    "stills_worker.py",
  ];
  const found = forbiddenLegacyRuntimeMarkers.filter((marker) => source.includes(marker));
  if (found.length) {
    throw new Error(
      `Desktop backend contains legacy graph-engine runtime markers: ${found.join(", ")}. ` +
        "Premiere316 packages standalone engine adapters only.",
    );
  }
}

const wrapper = join(ROOT, "scripts", "with-app-env.mjs");
const viteJs = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const builderBin = join(ROOT, "node_modules", "electron-builder", "cli.js");

writeBuildIdentity();
console.log("[premiere316] bundling desktop backend…");
await bundleBackend();

console.log("[premiere316] building UI for the desktop Node server…");
const rendererOutput = join(ROOT, ".output");
if (existsSync(rendererOutput)) rmSync(rendererOutput, { recursive: true, force: true });
await run(process.execPath, [wrapper, process.execPath, viteJs, "build"], { PREMIERE316_DESKTOP: "1" });

const uiEntry = join(ROOT, ".output", "server", "index.mjs");
if (!existsSync(uiEntry) && !existsSync(join(ROOT, ".output", "server", "index.js"))) {
  throw new Error("Desktop UI build did not produce .output/server. Premiere316.exe needs that entry.");
}

const builderCli = existsSync(builderBin) ? builderBin : require.resolve("electron-builder/cli.js");
const targets = dirOnly ? ["--win", "dir", "--x64"] : ["--win", "--x64"];
console.log(`[premiere316] electron-builder ${targets.join(" ")}…`);
await run(process.execPath, [builderCli, ...targets]);

const packagedResources = join(ROOT, "dist-desktop", "win-unpacked", "resources");
const asarPath = join(packagedResources, "app.asar");
const { listPackage } = require("@electron/asar");
const asarEntries = new Set(listPackage(asarPath, { isPack: false }).map((entry) => entry.replaceAll("\\", "/")));
const requiredAsarEntries = [
  "/desktop/main.mjs",
  "/desktop/preload.cjs",
  "/desktop/authority-review-preload.cjs",
  "/desktop/authority-review.html",
  "/desktop/confirmation-preload.cjs",
  "/desktop/confirmation.html",
  "/desktop/channels.cjs",
  "/desktop/zoom.cjs",
  "/package.json",
];
const missingAsarEntries = requiredAsarEntries.filter((entry) => !asarEntries.has(entry));
const requiredResources = [
  join(packagedResources, "backend.mjs"),
  join(packagedResources, "build-info.json"),
  join(packagedResources, "workers", "flux1_jsonl_worker.py"),
  join(packagedResources, "ui", "server", "index.mjs"),
];
const missingResources = requiredResources.filter((entry) => !existsSync(entry));
if (missingAsarEntries.length || missingResources.length) {
  throw new Error(
    `Packaged runtime audit failed. Missing ASAR: ${missingAsarEntries.join(", ") || "none"}; ` +
      `missing resources: ${missingResources.map((entry) => relative(ROOT, entry)).join(", ") || "none"}`,
  );
}
console.log(`[premiere316] packaged runtime audit passed (${requiredAsarEntries.length} ASAR modules, ${requiredResources.length} resources)`);

const unpacked = join(ROOT, "dist-desktop", "win-unpacked", "Premiere316.exe");
if (existsSync(unpacked)) {
  console.log(`[premiere316] Premiere316.exe → ${unpacked}`);
}
const setup = join(ROOT, "dist-desktop", "Premiere316-Setup.exe");
if (existsSync(setup)) {
  console.log(`[premiere316] installer → ${setup}`);
}
