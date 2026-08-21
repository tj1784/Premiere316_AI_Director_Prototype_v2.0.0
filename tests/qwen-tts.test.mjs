import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PersistentQwenTtsWorker,
  __qwenTtsTest,
  normalizeQwenTtsLanguage,
  qwenTtsHealth,
  resolveQwenTtsPaths
} from "../server/qwen-tts.js";
import {
  acquireGpuLease,
  GPU_RESOURCE_OWNERS,
  gpuLeaseStatus,
  resetGpuLeaseForTests
} from "../server/gpu-resource-manager.js";
import {
  prepareStandaloneQwenTtsRuntime,
  qwenTtsMinimumFreeVramBytes
} from "../server/queue.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("QwenTTS defaults to the exact standalone Premiere316 runtime and app-owned Base model", () => {
  const paths = resolveQwenTtsPaths({ LOCALAPPDATA: "C:\\LocalData" }, "win32");
  assert.equal(paths.runtimeRoot, path.resolve("C:\\LocalData", "Premiere316", "Qwen3-TTS-VoiceDesign"));
  assert.equal(paths.python, path.join(paths.runtimeRoot, ".venv", "Scripts", "python.exe"));
  assert.equal(paths.modelDir, path.resolve("C:\\LocalData", "Premiere316", "Qwen3-TTS", "models", "Qwen3-TTS-12Hz-1.7B-Base"));
  assert.equal(paths.worker, path.join(ROOT, "scripts", "qwen_tts_worker.py"));
  assert.equal(paths.attentionImplementation, "sdpa");
});

test("QwenTTS health fails closed for missing, non-Base, or ComfyUI-backed artifacts", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-tts-health-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const paths = {
    runtimeRoot: path.join(temp, "runtime"),
    installRoot: path.join(temp, "install"),
    sourceRoot: path.join(temp, "source"),
    modelDir: path.join(temp, "models", "base"),
    python: path.join(temp, "runtime", "python.exe"),
    worker: path.join(ROOT, "scripts", "qwen_tts_worker.py"),
    device: "cuda:0",
    attentionImplementation: "sdpa",
    idleMs: 10_000
  };
  const missing = qwenTtsHealth({ paths, env: {} });
  assert.equal(missing.ready, false);
  assert.ok(missing.missing.some((entry) => entry.label === "Base model weights"));
  assert.ok(missing.missing.some((entry) => entry.label === "text merges"));
  for (const entry of missing.missing) {
    if (entry.label === "Premiere316 Qwen worker") continue;
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    fs.writeFileSync(entry.file, entry.label === "Base model config" ? JSON.stringify({ tts_model_type: "voice_design" }) : entry.label);
  }
  assert.equal(qwenTtsHealth({ paths, env: {} }).ready, false);
  const incomplete = qwenTtsHealth({ paths, env: {} });
  assert.ok(incomplete.missing.some((entry) => entry.label === "Base model weights" && entry.issue === "incomplete" && entry.minBytes >= 3_800_000_000));
  assert.ok(incomplete.missing.some((entry) => entry.label === "speech tokenizer weights" && entry.issue === "incomplete" && entry.minBytes >= 650_000_000));
  fs.writeFileSync(path.join(paths.modelDir, "config.json"), JSON.stringify({ tts_model_type: "base" }));
  const requiredSizes = new Map(qwenTtsHealth({ paths, env: {} }).missing.map((entry) => [path.resolve(entry.file), entry.minBytes]));
  const ready = qwenTtsHealth({
    paths,
    env: {},
    fileSize: (file) => requiredSizes.get(path.resolve(file)) || fs.statSync(file).size
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.usesComfyUi, false);

  const comfyPaths = { ...paths, modelDir: path.join(temp, "ComfyUI", "models", "qwen") };
  assert.equal(qwenTtsHealth({ paths: comfyPaths, env: {} }).ready, false);
  assert.ok(qwenTtsHealth({ paths: comfyPaths, env: {} }).missing.some((entry) => entry.label === "standalone non-ComfyUI runtime"));
});

test("Qwen output rollback removes an unregistered media master and recovers its native provenance", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-rollback-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const outputRoot = path.join(temp, "media", "audio");
  const nativeRoot = path.join(temp, "production", "qwen3-tts", "voice-clone");
  const recoveryRoot = path.join(temp, "production", "qwen3-tts", "recovered");
  const destination = path.join(outputRoot, "unregistered.wav");
  const nativeFile = path.join(nativeRoot, "take.native.wav");
  const recoveryFile = path.join(recoveryRoot, "take.native.wav");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(nativeRoot, { recursive: true });
  fs.writeFileSync(destination, "new production master");
  fs.writeFileSync(nativeFile, "native provenance master");

  const rollback = __qwenTtsTest.rollbackFinalizedOutput({
    outputRoot,
    destination,
    nativeRoot,
    nativeFile,
    recoveryRoot,
    recoveryFile
  });
  assert.equal(rollback.removedDestination, true);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(nativeFile), false);
  assert.equal(rollback.recoveredNativeFile, recoveryFile);
  assert.equal(fs.readFileSync(recoveryFile, "utf8"), "native provenance master");

  const outside = path.join(temp, "do-not-delete.wav");
  fs.writeFileSync(outside, "owned by someone else");
  assert.throws(() => __qwenTtsTest.rollbackFinalizedOutput({
    outputRoot,
    destination: outside,
    nativeRoot,
    nativeFile: recoveryFile,
    recoveryRoot,
    recoveryFile: path.join(recoveryRoot, "second.wav")
  }), /outside media\/audio/);
  assert.equal(fs.readFileSync(outside, "utf8"), "owned by someone else");
});

test("QwenTTS language aliases and 8–15 second reference contract are strict", () => {
  assert.equal(normalizeQwenTtsLanguage("EN"), "English");
  assert.equal(normalizeQwenTtsLanguage("auto"), "Auto");
  assert.equal(normalizeQwenTtsLanguage("Spanish"), "Spanish");
  assert.throws(() => normalizeQwenTtsLanguage("Arabic"), /Unsupported Qwen3-TTS language/);
  assert.equal(__qwenTtsTest.validateReferenceDuration(8), 8);
  assert.equal(__qwenTtsTest.validateReferenceDuration(15), 15);
  assert.throws(() => __qwenTtsTest.validateReferenceDuration(7.9), /8–15 seconds/);
  assert.throws(() => __qwenTtsTest.validateReferenceDuration(15.1), /8–15 seconds/);
});

test("Python worker uses exact-transcript ICL and exactly one continuous clone call", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "qwen_tts_worker.py"), "utf8");
  const calls = source.match(/MODEL\.generate_voice_clone\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(source, /ref_text=reference_transcript/);
  assert.match(source, /x_vector_only_mode=False/);
  assert.match(source, /non_streaming_mode=True/);
  assert.match(source, /len\(wavs\) != 1/);
  assert.doesNotMatch(source, /def\s+(?:chunk|split|stitch)|NP\.concatenate|numpy\.concatenate/i);
});

test("Premiere routes Qwen through its own provider, queue, and unload endpoint while retaining IndexTTS", () => {
  const server = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
  const queue = fs.readFileSync(path.join(ROOT, "server", "queue.js"), "utf8");
  assert.match(server, /\/api\/sound\/qwen-tts\/health/);
  assert.match(server, /\/api\/sound\/qwen-tts\/unload/);
  assert.match(server, /\/api\/projects\/:slug\/sound\/qwen-tts\/generations/);
  assert.match(server, /referenceTranscript:\s*req\.body\?\.referenceTranscript\s*\|\|\s*req\.body\?\.refText/);
  assert.match(server, /\/api\/projects\/:slug\/sound\/index-tts\/generations/);
  assert.match(queue, /next\.type === "generate_qwen_tts"/);
  assert.match(queue, /prepareStandaloneQwenTtsRuntime/);
});

test("persistent standalone Qwen worker speaks JSONL without loading a real model", async (t) => {
  resetGpuLeaseForTests();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-worker-"));
  const fakeWorker = path.join(temp, "fake-qwen-worker.mjs");
  fs.writeFileSync(fakeWorker, `
    import readline from "node:readline";
    process.stderr.write("diagnostics remain on stderr\\n");
    process.stdout.write(JSON.stringify({ type: "ready", attentionImplementation: "sdpa" }) + "\\n");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        type: "response", id: request.id, ok: true,
        result: { loaded: true, oneContinuousGeneration: true, attentionImplementation: "sdpa" }
      }) + "\\n");
      if (request.command === "shutdown") process.exit(0);
    });
  `);
  const paths = {
    runtimeRoot: temp,
    installRoot: temp,
    sourceRoot: temp,
    modelDir: path.join(temp, "model"),
    python: process.execPath,
    worker: fakeWorker,
    device: "cuda:0",
    attentionImplementation: "sdpa",
    idleMs: 10_000
  };
  fs.mkdirSync(paths.modelDir, { recursive: true });
  const worker = new PersistentQwenTtsWorker(paths);
  t.after(async () => {
    const child = worker.child;
    worker.terminate();
    if (child && child.exitCode == null) await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    resetGpuLeaseForTests();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const result = await worker.request("generate", { text: "one piece" });
  assert.equal(result.oneContinuousGeneration, true);
  assert.equal(worker.loaded, true);
  assert.equal(gpuLeaseStatus()?.owner, GPU_RESOURCE_OWNERS.QWEN_TTS);
});

test("deliberately stopping a Qwen worker rejects every pending request as cancelled", async (t) => {
  resetGpuLeaseForTests();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-worker-stop-"));
  const fakeWorker = path.join(temp, "hanging-qwen-worker.mjs");
  fs.writeFileSync(fakeWorker, `
    import readline from "node:readline";
    process.stdout.write(JSON.stringify({ type: "ready", attentionImplementation: "sdpa" }) + "\\n");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", () => {});
  `);
  const paths = {
    runtimeRoot: temp,
    installRoot: temp,
    sourceRoot: temp,
    modelDir: path.join(temp, "model"),
    python: process.execPath,
    worker: fakeWorker,
    device: "cuda:0",
    attentionImplementation: "sdpa",
    idleMs: 10_000
  };
  fs.mkdirSync(paths.modelDir, { recursive: true });
  const worker = new PersistentQwenTtsWorker(paths);
  t.after(async () => {
    const child = worker.child;
    worker.terminate();
    if (child && child.exitCode == null) await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    resetGpuLeaseForTests();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const pending = worker.request("generate", { text: "wait forever" });
  const rejected = assert.rejects(pending, (error) => error?.code === "GENERATION_CANCELLED");
  const deadline = Date.now() + 3_000;
  while (!worker.pending.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.pending.size, 1);
  worker.terminate();
  await rejected;
  assert.equal(worker.pending.size, 0);
});

test("standalone Qwen GPU preparation refuses an active ComfyUI lease without calling ComfyUI", async (t) => {
  resetGpuLeaseForTests();
  t.after(() => resetGpuLeaseForTests());
  acquireGpuLease(GPU_RESOURCE_OWNERS.COMFYUI, { label: "ComfyUI", jobId: "active", state: "generating" });
  let queriedMemory = false;
  await assert.rejects(
    prepareStandaloneQwenTtsRuntime({ queryGpuMemory: async () => { queriedMemory = true; return { freeBytes: 64 * 1024 ** 3 }; } }),
    (error) => error?.code === "GPU_LEASE_BUSY" && /will not call ComfyUI or port 8188/.test(error.message)
  );
  assert.equal(queriedMemory, false);
  assert.equal(gpuLeaseStatus()?.owner, GPU_RESOURCE_OWNERS.COMFYUI);
});

test("resident-idle Comfy lease is cleared locally only after nvidia-smi-equivalent VRAM evidence", async (t) => {
  resetGpuLeaseForTests();
  t.after(() => resetGpuLeaseForTests());
  acquireGpuLease(GPU_RESOURCE_OWNERS.COMFYUI, { label: "ComfyUI", jobId: null, state: "resident-idle" });
  const sevenGib = 7 * 1024 ** 3;
  const result = await prepareStandaloneQwenTtsRuntime({
    env: { QWEN_TTS_MIN_FREE_VRAM_GIB: "6" },
    queryGpuMemory: async () => ({ source: "test-nvidia-smi", freeBytes: sevenGib, totalBytes: 24 * 1024 ** 3 })
  });
  assert.equal(result.usesComfyUi, false);
  assert.equal(result.minimumFreeVramBytes, 6 * 1024 ** 3);
  assert.equal(gpuLeaseStatus()?.owner, GPU_RESOURCE_OWNERS.QWEN_TTS);
  assert.equal(gpuLeaseStatus()?.state, "reserved-for-load");
});

test("standalone Qwen load fails closed below the configurable free-VRAM threshold", async (t) => {
  resetGpuLeaseForTests();
  t.after(() => resetGpuLeaseForTests());
  assert.equal(qwenTtsMinimumFreeVramBytes({ QWEN_TTS_MIN_FREE_VRAM_GIB: "10.5" }), Math.trunc(10.5 * 1024 ** 3));
  await assert.rejects(
    prepareStandaloneQwenTtsRuntime({
      env: { QWEN_TTS_MIN_FREE_VRAM_GIB: "8" },
      queryGpuMemory: async () => ({ source: "test-nvidia-smi", freeBytes: 7 * 1024 ** 3, totalBytes: 24 * 1024 ** 3 })
    }),
    (error) => error?.code === "GPU_VRAM_LOW" && /requires 8\.0 GiB free VRAM/.test(error.message)
  );
  assert.equal(gpuLeaseStatus(), null);
});
