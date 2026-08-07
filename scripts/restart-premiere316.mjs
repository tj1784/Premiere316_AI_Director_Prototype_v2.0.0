import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const oldPid = Number(process.argv[2]);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eventLog = path.join(appRoot, "premiere316-restart.log");
const append = (message) => fs.appendFileSync(eventLog, `${new Date().toISOString()} ${message}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

append(`handoff started from PID ${oldPid}`);
for (let attempt = 0; attempt < 160; attempt += 1) {
  try {
    process.kill(oldPid, 0);
    await delay(250);
  } catch {
    break;
  }
}

const stdout = fs.openSync(path.join(appRoot, "premiere316-server.stdout.log"), "a");
const stderr = fs.openSync(path.join(appRoot, "premiere316-server.stderr.log"), "a");
const server = spawn(process.execPath, [path.join(appRoot, "server", "index.js")], {
  cwd: appRoot,
  detached: true,
  windowsHide: true,
  env: { ...process.env, PORT: "8789", COMFY_URL: process.env.COMFY_URL || "http://127.0.0.1:8190" },
  stdio: ["ignore", stdout, stderr]
});
server.unref();
append(`replacement spawned as PID ${server.pid}`);
