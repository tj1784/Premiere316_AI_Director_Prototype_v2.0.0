import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const DIRECTOR_COMFY_URL = "http://127.0.0.1:8190";
export const DIRECTOR_PYTHON = "D:\\Dev\\Tools\\Python312\\python.exe";
export const DIRECTOR_INSTANCE = "D:\\AI\\ComfyUI\\Instances\\LTX2.5";
export const DIRECTOR_LAUNCHER = `${DIRECTOR_INSTANCE}\\run_comfyui_instance.py`;
export const DIRECTOR_LAUNCH_ARGS = Object.freeze([
  "-s", DIRECTOR_LAUNCHER,
  "--listen", "127.0.0.1", "--port", "8190", "--disable-auto-launch",
  "--models-directory", "D:\\AI\\Models",
  "--input-directory", "D:\\AI\\ComfyUI\\Data\\LTX2.5\\Input",
  "--user-directory", "D:\\AI\\ComfyUI\\Data\\LTX2.5\\User",
  "--output-directory", "D:\\Media\\Generated\\ComfyUI-LTX2.5",
  "--temp-directory", "D:\\_Temp\\ComfyUI-LTX2.5",
  "--preview-method", "auto",
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function connectionRefused(error) {
  if (!error || typeof error !== "object") return false;
  if (error.code === "ECONNREFUSED") return true;
  if (connectionRefused(error.cause)) return true;
  return Array.isArray(error.errors) && error.errors.length > 0 && error.errors.every(connectionRefused);
}

/** This host is called only by the main-process approved-run action, never on page load. */
export function createDirectorHost({
  fetchImpl = fetch,
  spawnImpl = spawn,
  existsImpl = existsSync,
  logDirectory = path.join(tmpdir(), "Premiere316", "director"),
  mkdirImpl = mkdirSync,
  openLogImpl = openSync,
  closeLogImpl = closeSync,
  now = Date.now,
  waitImpl = delay,
  readinessTimeoutMs = 60_000,
  pollIntervalMs = 500,
} = {}) {
  const timeout = Math.max(1, Math.min(60_000, Number(readinessTimeoutMs) || 60_000));
  const pollInterval = Math.max(1, Math.min(1_000, Number(pollIntervalMs) || 500));
  let starting = null;
  let ownedChild = null;
  let ownedFailure = null;
  let stoppedEpoch = 0;

  const killOwned = () => {
    const child = ownedChild;
    ownedChild = null;
    if (!child || child.exitCode !== null && child.exitCode !== undefined) return;
    try { child.kill(); } catch { /* Shutdown must not target any other process. */ }
  };

  async function healthy(remaining) {
    let response;
    try {
      response = await fetchImpl(`${DIRECTOR_COMFY_URL}/system_stats`, {
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_500, Math.ceil(remaining)))),
      });
    } catch (error) {
      if (connectionRefused(error)) return false;
      throw new Error("Could not verify the local video service. No second service was started.", { cause: error });
    }
    if (!response.ok) throw new Error(`The local video service responded with HTTP ${response.status}. No second service was started.`);
    let stats;
    try { stats = await response.json(); } catch (error) {
      throw new Error("The local video service returned invalid health information.", { cause: error });
    }
    if (typeof stats?.system?.comfyui_version !== "string") throw new Error("Port 8190 is occupied by an unrecognized service.");
    return true;
  }

  async function startOrReuse() {
    const epoch = stoppedEpoch;
    const deadline = now() + timeout;
    const alreadyHealthy = await healthy(timeout);
    if (epoch !== stoppedEpoch) throw new Error("Video service startup was cancelled.");
    if (alreadyHealthy) return;
    if (!existsImpl(DIRECTOR_PYTHON) || !existsImpl(DIRECTOR_LAUNCHER)) {
      throw new Error("The configured LTX Director Python runtime or launcher is missing. Nothing was installed or downloaded.");
    }

    const descriptors = [];
    if (!ownedChild) try {
      mkdirImpl(logDirectory, { recursive: true });
      const stamp = `${now()}-${process.pid}`;
      descriptors.push(openLogImpl(path.join(logDirectory, `director-${stamp}.stdout.log`), "a"));
      descriptors.push(openLogImpl(path.join(logDirectory, `director-${stamp}.stderr.log`), "a"));
      const child = spawnImpl(DIRECTOR_PYTHON, [...DIRECTOR_LAUNCH_ARGS], {
        cwd: DIRECTOR_INSTANCE,
        windowsHide: true,
        shell: false,
        detached: false,
        stdio: ["ignore", descriptors[0], descriptors[1]],
        env: {
          ...process.env,
          HF_HOME: "D:\\_Cache\\HuggingFace",
          PIP_CACHE_DIR: "D:\\_Cache\\Packages\\pip",
          GIT_PYTHON_GIT_EXECUTABLE: "D:\\Dev\\Tools\\Git\\cmd\\git.exe",
        },
      });
      ownedChild = child;
      ownedFailure = null;
      child.once("error", (error) => {
        if (ownedChild !== child) return;
        ownedFailure = new Error(`LTX Director could not start: ${error.message}`, { cause: error });
        if (!child.pid) ownedChild = null;
      });
      child.once("exit", (code, signal) => {
        if (ownedChild !== child) return;
        ownedFailure = new Error(`LTX Director exited before becoming available (${signal || `exit ${code}`}).`);
        ownedChild = null;
      });
    } catch (error) {
      throw new Error(`Could not start the configured video service: ${error.message}`, { cause: error });
    } finally {
      // spawn duplicates these handles for the child; release parent-side handles.
      for (const descriptor of descriptors) {
        try { closeLogImpl(descriptor); } catch { /* No service ownership change. */ }
      }
    }

    try {
      while (now() < deadline) {
        if (epoch !== stoppedEpoch) throw new Error("Video service startup was cancelled.");
        if (ownedFailure) throw ownedFailure;
        if (await healthy(deadline - now())) {
          if (epoch !== stoppedEpoch) throw new Error("Video service startup was cancelled.");
          if (ownedFailure) throw ownedFailure;
          return;
        }
        if (ownedFailure) throw ownedFailure;
        await waitImpl(Math.min(pollInterval, Math.max(1, deadline - now())));
      }
      throw new Error("LTX Director did not become ready within 60 seconds. Review the video service startup logs.");
    } catch (error) {
      killOwned();
      throw error;
    }
  }

  return {
    ensure() {
      if (starting) return starting;
      starting = startOrReuse().finally(() => { starting = null; });
      return starting;
    },
    stop() {
      stoppedEpoch += 1;
      killOwned();
    },
  };
}
