import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INDEX_TTS_EMOTION_LABELS,
  __indexTtsTest,
  emotionVectorFromStyle,
  ensureProjectSound,
  indexTtsHealth,
  normalizeIndexTtsLanguage,
  resolveIndexTtsPaths
} from "../server/index-tts.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("IndexTTS defaults to the standalone LOCALAPPDATA installation and supports an explicit override", () => {
  const defaults = resolveIndexTtsPaths({ LOCALAPPDATA: "C:\\LocalData" }, "win32");
  assert.equal(defaults.root, path.resolve("C:\\LocalData", "Premiere316", "IndexTTS-2.5"));
  assert.equal(defaults.python, path.join(defaults.root, ".venv", "Scripts", "python.exe"));
  assert.equal(defaults.qwenEmotionEnabled, false);

  const overridden = resolveIndexTtsPaths({
    LOCALAPPDATA: "C:\\Ignored",
    INDEXTTS_ROOT: "C:\\Standalone\\IndexTTS",
    INDEXTTS_QWEN_EMOTION: "1"
  }, "win32");
  assert.equal(overridden.root, path.resolve("C:\\Standalone\\IndexTTS"));
  assert.equal(overridden.qwenEmotionEnabled, true);
});

test("IndexTTS health fails closed until code, core weights, tokenizer, and every auxiliary model are present", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-indextts-health-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const paths = {
    root: temp,
    modelDir: path.join(temp, "checkpoints"),
    configFile: path.join(temp, "checkpoints", "config.yaml"),
    python: path.join(temp, ".venv", "Scripts", "python.exe"),
    worker: path.join(ROOT, "scripts", "index_tts_worker.py"),
    qwenEmotionEnabled: false,
    idleMs: 10_000
  };
  const missing = indexTtsHealth({ paths, env: {} });
  assert.equal(missing.ready, false);
  assert.ok(missing.missing.some((entry) => entry.label === "Wav2Vec-BERT weights"));
  assert.ok(missing.missing.some((entry) => entry.label === "multilingual tokenizer"));
  assert.ok(missing.missing.some((entry) => entry.label === "BigVGAN weights"));

  for (const entry of missing.missing) {
    if (entry.label === "worker") continue;
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    fs.writeFileSync(entry.file, entry.label);
  }
  const ready = indexTtsHealth({ paths, env: {} });
  assert.equal(ready.ready, true);
  assert.equal(ready.qwenEmotionEnabled, false);

  const qwenPaths = { ...paths, qwenEmotionEnabled: true };
  const qwenMissing = indexTtsHealth({ paths: qwenPaths, env: {} });
  assert.equal(qwenMissing.ready, false);
  assert.deepEqual(qwenMissing.missing.map((entry) => entry.label), ["Qwen emotion model"]);
  fs.mkdirSync(qwenMissing.missing[0].file, { recursive: true });
  assert.equal(indexTtsHealth({ paths: qwenPaths, env: {} }).ready, true);
});

test("style guidance becomes a bounded, ordered eight-value emotion vector without loading Qwen", () => {
  const calm = emotionVectorFromStyle("observant, quiet, calm, mature, measured");
  const sharp = emotionVectorFromStyle("sharp, critical, annoyed, stern and defiant");
  assert.equal(calm.length, 8);
  assert.deepEqual(INDEX_TTS_EMOTION_LABELS, [
    "happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"
  ]);
  assert.ok(calm[7] > calm[1]);
  assert.ok(sharp[1] > sharp[7]);
  assert.ok(calm.reduce((sum, value) => sum + value, 0) <= 0.8001);
  assert.ok(sharp.reduce((sum, value) => sum + value, 0) <= 0.8001);
});

test("language and reference-duration contracts are strict and LTX-sized", () => {
  assert.equal(normalizeIndexTtsLanguage("auto"), "EN");
  assert.equal(normalizeIndexTtsLanguage("ja"), "JA");
  assert.throws(() => normalizeIndexTtsLanguage("fr"), /EN, ZH, JA, ES, AR/);
  assert.equal(__indexTtsTest.validateReferenceDuration(8), 8);
  assert.equal(__indexTtsTest.validateReferenceDuration(15), 15);
  assert.throws(() => __indexTtsTest.validateReferenceDuration(7.9), /8–15 seconds/);
  assert.throws(() => __indexTtsTest.validateReferenceDuration(15.1), /8–15 seconds/);
});

test("sound state is project-scoped and preserves existing voices and generations", () => {
  const project = {};
  const sound = ensureProjectSound(project);
  sound.voices.push({ id: "voice_a" });
  sound.generations.push({ id: "sound_a" });
  assert.equal(ensureProjectSound(project), sound);
  assert.deepEqual(project.sound.voices, [{ id: "voice_a" }]);
  assert.deepEqual(project.sound.generations, [{ id: "sound_a" }]);
});

test("persistent JSONL client reuses one worker and receives protocol-only JSON from stdout", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-indextts-worker-"));
  const fakeWorker = path.join(temp, "fake-worker.mjs");
  fs.writeFileSync(fakeWorker, `
    import readline from "node:readline";
    process.stderr.write("model diagnostics stay on stderr\\n");
    process.stdout.write(JSON.stringify({ type: "ready", device: "cuda:0" }) + "\\n");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        type: "response",
        id: request.id,
        ok: true,
        result: { emotionVector: [0,0,0,0,0,0,0,0.4], emotionVectorSource: "fake" }
      }) + "\\n");
    });
  `);
  const paths = {
    root: temp,
    modelDir: path.join(temp, "checkpoints"),
    configFile: path.join(temp, "checkpoints", "config.yaml"),
    python: process.execPath,
    worker: fakeWorker,
    qwenEmotionEnabled: false,
    idleMs: 10_000
  };
  const client = new __indexTtsTest.PersistentIndexTtsWorker(paths);
  t.after(async () => {
    const child = client.child;
    client.stop();
    if (child && child.exitCode == null) await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const firstChild = client.start();
  await firstChild;
  const result = await client.request({ text: "hello" });
  assert.equal(result.emotionVectorSource, "fake");
  assert.deepEqual(result.emotionVector, [0, 0, 0, 0, 0, 0, 0, 0.4]);
  assert.equal(client.isRunningFor(paths), true);
});

test("Python bridge pins BF16 and disables CUDA kernels, DeepSpeed, accel, compile, and Qwen by default", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "index_tts_worker.py"), "utf8");
  assert.match(source, /use_bf16=True/);
  assert.match(source, /use_cuda_kernel=False/);
  assert.match(source, /use_deepspeed=False/);
  assert.match(source, /use_accel=False/);
  assert.match(source, /use_torch_compile=False/);
  assert.match(source, /use_qwen_emo=bool\(args\.use_qwen_emo\)/);
  assert.match(source, /duration_factor=duration_factor/);
  assert.match(source, /sys\.stdout = sys\.stderr/);
});
