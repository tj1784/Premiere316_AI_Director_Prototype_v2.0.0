import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  realpathSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join, isAbsolute, relative, extname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const SPECIALIST_ENGINES = ["ace-step-1.5-xl-sft", "stable-audio-3-small-sfx"];
export function specialistRequest(cue, engineId, seed = 1) {
  if (!SPECIALIST_ENGINES.includes(engineId))
    throw new Error("Unknown specialist engine; no substitution is allowed.");
  if (!cue || ["dialogue", "silence"].includes(cue.kind))
    throw new Error("Specialists cannot replace dialogue voices or intentional silence.");
  if ((cue.kind === "score") !== (engineId === "ace-step-1.5-xl-sft"))
    throw new Error("Score requires XL SFT; sound effects require Small-SFX.");
  const duration = cue.durationSec + (cue.tailSec ?? 0);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120)
    throw new Error(
      "This adapter supports an explicit cue plus tail of 0–120 seconds. Split longer cues deliberately.",
    );
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("Seed must be an integer from 0 to 2147483647.");
  if (!cue.notes?.trim()) throw new Error("Author the source-bound cue before generation.");
  const { referenceId, ...motif } = cue.motif ?? {};
  if (referenceId && engineId !== "ace-step-1.5-xl-sft")
    throw new Error(
      "Musical reference conditioning requires ACE-Step XL SFT; Small-SFX cannot silently ignore a reference.",
    );
  return {
    engineId,
    seed,
    duration,
    prompt: [
      cue.notes,
      cue.instrumentation && `Instrumentation: ${cue.instrumentation}`,
      cue.perspective && `Perspective: ${cue.perspective}`,
      cue.syncLandmarks && `Timing: ${cue.syncLandmarks}`,
      cue.vocalPolicy && `Vocal policy: ${cue.vocalPolicy}`,
      cue.motif && `Motif specification: ${JSON.stringify(motif)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function createSpecialistAudioService({
  root,
  workerPath,
  readPicture,
  probe,
  assertGpuIdle,
  resolveMedia = (value) => value,
  publicMediaUri = (path) => path,
  spawnProcess = spawn,
}) {
  mkdirSync(root, { recursive: true });
  const configPath = join(root, "runtime-config.json");
  const running = new Map();
  let admission = false;
  function save(job) {
    const target = join(root, `${job.id}.json`),
      tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(job, null, 2));
    renameSync(tmp, target);
    return job;
  }
  function read(id) {
    if (!/^[0-9a-f-]{36}$/.test(id ?? "")) throw new Error("Invalid specialist job ID.");
    const job = JSON.parse(readFileSync(join(root, `${id}.json`), "utf8"));
    if (job.status === "running" && !running.has(id))
      return save({
        ...job,
        status: "interrupted",
        error:
          "Worker is no longer owned by this app session. Retained output is not approved; retry explicitly.",
      });
    return job;
  }
  function config() {
    return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  }
  function configure(value) {
    if (running.size)
      throw new Error(
        "Wait for or cancel the owned audio job before changing runtime configuration.",
      );
    const next = config();
    for (const engine of SPECIALIST_ENGINES)
      if (value[engine]) {
        const item = value[engine];
        for (const key of ["python", "runtimeRoot", "cacheRoot"])
          if (typeof item[key] !== "string" || !isAbsolute(item[key]) || !existsSync(item[key]))
            throw new Error(`${engine}: ${key} must identify an existing absolute local path.`);
        if (
          !statSync(item.python).isFile() ||
          !statSync(item.runtimeRoot).isDirectory() ||
          !statSync(item.cacheRoot).isDirectory()
        )
          throw new Error("Choose the runtime Python executable and two directories.");
        next[engine] = {
          python: realpathSync(item.python),
          runtimeRoot: realpathSync(item.runtimeRoot),
          cacheRoot: realpathSync(item.cacheRoot),
        };
      }
    writeFileSync(configPath, JSON.stringify(next, null, 2));
    return {
      ok: true,
      configured: Object.keys(next),
      note: "Paths configured; package and exact offline artifacts are checked by the worker. No inference has been verified.",
    };
  }
  async function start(input) {
    if (admission || running.size)
      throw new Error("A specialist audio job is already active. Jobs run sequentially.");
    admission = true;
    try {
      const picture = readPicture(input.pictureId);
      const cue = picture?.audio?.cues.find((c) => c.id === input.cueId);
      if (!cue || JSON.stringify(cue) !== input.cueSnapshot)
        throw new Error("Saved cue differs from this request. Save current direction and retry.");
      const request = specialistRequest(cue, input.engineId, input.seed);
      const runtime = config()[request.engineId];
      if (!runtime)
        throw new Error(
          `Configure the installed ${request.engineId} runtime first. No model will be downloaded.`,
        );
      await assertGpuIdle();
      const id = randomUUID(),
        outputDir = join(root, id);
      mkdirSync(outputDir);
      if (cue.motif?.referenceId) {
        const reference = picture.audio.takes.find(
          (t) => t.id === cue.motif.referenceId && t.canonical && t.mediaSha256 && t.mediaUri,
        );
        if (!reference)
          throw new Error(
            `Approved musical reference ${cue.motif.referenceId} is missing. No reference is substituted.`,
          );
        const path = resolveMedia(reference.mediaUri);
        if (statSync(path).size > 512 * 1024 * 1024)
          throw new Error("Musical reference exceeds the supported size.");
        const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
        if (sha256 !== reference.mediaSha256)
          throw new Error(`Musical reference ${reference.id} bytes changed.`);
        const extension = extname(path).toLowerCase();
        if (![".wav", ".flac", ".mp3", ".ogg", ".m4a"].includes(extension))
          throw new Error("Musical reference must use a supported audio file extension.");
        const copy = join(outputDir, `motif-reference${extension}`);
        copyFileSync(path, copy);
        if (createHash("sha256").update(readFileSync(copy)).digest("hex") !== sha256)
          throw new Error("Musical reference copy failed verification.");
        request.referenceAudio = copy;
        request.reference = { takeId: reference.id, sha256 };
      }
      let job = save({
        id,
        pictureId: picture.id,
        cueId: cue.id,
        cueSnapshot: JSON.stringify(cue),
        request,
        status: "running",
        createdAt: Date.now(),
        output: null,
        error: null,
      });
      const child = spawnProcess(runtime.python, [workerPath], {
        cwd: runtime.runtimeRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HF_HOME: runtime.cacheRoot,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
        },
      });
      running.set(id, child);
      let stdout = "",
        stderr = "",
        settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        const cancelled = read(id).status === "cancelled";
        running.delete(id);
        job = save({ ...job, status: cancelled ? "cancelled" : "failed", error: String(error) });
      };
      const timer = setTimeout(
        () => {
          child.kill();
          fail("Specialist job exceeded its 30-minute limit.");
        },
        30 * 60 * 1000,
      );
      child.stdout.on("data", (data) => {
        stdout = (stdout + data).slice(-1024 * 1024);
      });
      child.stderr.on("data", (data) => {
        stderr = (stderr + data).slice(-16000);
      });
      child.on("error", fail);
      child.on("close", async (code) => {
        if (settled) return;
        if (read(id).status === "cancelled") {
          job.status = "cancelled";
          fail("Cancelled by user.");
          return;
        }
        if (code !== 0) {
          fail(stderr || stdout || `Worker exited ${code}`);
          return;
        }
        try {
          const receipt = stdout
            .split(/\r?\n/)
            .filter((line) => line.startsWith("P316_AUDIO_RESULT "))
            .at(-1);
          if (!receipt) throw new Error("Worker produced no output receipt.");
          const result = JSON.parse(receipt.slice("P316_AUDIO_RESULT ".length));
          if (result.engineId !== request.engineId)
            throw new Error("Worker engine does not match the exact requested specialist.");
          const mediaUri = realpathSync(result.path),
            rel = relative(realpathSync(outputDir), mediaUri);
          if (!rel || rel.startsWith("..") || isAbsolute(rel))
            throw new Error("Worker output escaped its owned job directory.");
          const byteLength = statSync(mediaUri).size;
          if (!byteLength || byteLength > 512 * 1024 * 1024)
            throw new Error("Audio output size is invalid.");
          const mediaSha256 = createHash("sha256").update(readFileSync(mediaUri)).digest("hex");
          const inspected = await probe(mediaUri);
          if (!inspected.ok || Math.abs(inspected.durationSec - request.duration) > 1)
            throw new Error(
              "Generated audio failed duration/probe validation. No take was approved.",
            );
          if (read(id).status === "cancelled") {
            job.status = "cancelled";
            fail("Cancelled before output acceptance.");
            return;
          }
          const durable = join(outputDir, "candidate.wav");
          if (mediaUri !== durable) copyFileSync(mediaUri, durable);
          if (createHash("sha256").update(readFileSync(durable)).digest("hex") !== mediaSha256) throw new Error("Durable candidate copy failed verification.");
          settled = true;
          clearTimeout(timer);
          running.delete(id);
          save({
            ...job,
            status: "completed",
            completedAt: Date.now(),
            output: {
              mediaUri: publicMediaUri(durable, id),
              mediaSha256,
              byteLength,
              probe: inspected,
              engineId: request.engineId,
              provenance: result.provenance,
            },
            error: null,
          });
        } catch (error) {
          fail(error);
        }
      });
      child.stdin.on("error", fail);
      child.stdin.end(JSON.stringify({ ...request, runtimeRoot: runtime.runtimeRoot, outputDir }));
      return { ok: true, job };
    } finally {
      admission = false;
    }
  }
  function cancel(id) {
    const job = read(id);
    if (job.status === "running") {
      save({ ...job, status: "cancelled", error: "Cancelled by user." });
      running.get(id)?.kill();
    }
    return { ok: true, job: read(id) };
  }
  function status(pictureId) {
    return {
      ok: true,
      configured: Object.keys(config()),
      jobs: readdirSync(root)
        .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
        .map((name) => read(name.slice(0, -5)))
        .filter((job) => job.pictureId === pictureId),
    };
  }
  return {
    configure,
    start,
    cancel,
    status,
    shutdown: () => {
      for (const id of running.keys()) cancel(id);
    },
  };
}
