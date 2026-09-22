import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validator = spawnSync(process.execPath, [resolve(root, "scripts/generate-cueboard-validator.mjs"), "--check"], { cwd: root, stdio: "inherit" });
if (validator.status !== 0) process.exit(validator.status ?? 1);
const result = spawnSync(
  process.execPath,
  [resolve(root, "scripts/with-app-env.mjs"), "vite", "build"],
  {
    cwd: root,
    env: { ...process.env, PREMIERE316_SITES: "1" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const server = resolve(root, ".output/server");
if (!existsSync(resolve(server, "index.mjs"))) throw new Error("The Sites build did not produce a Worker entrypoint.");
const output = resolve(root, "dist");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(server, resolve(output, "server"), { recursive: true });
cpSync(resolve(root, ".output/public"), resolve(output, "client"), { recursive: true });
writeFileSync(resolve(output, "server/index.js"), 'export { default } from "./index.mjs";\n');
