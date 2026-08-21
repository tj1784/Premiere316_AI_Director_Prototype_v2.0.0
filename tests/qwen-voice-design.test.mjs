import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  QWEN_VOICE_DESIGN_CODE_REVISION,
  QWEN_VOICE_DESIGN_ENGINE,
  QWEN_VOICE_DESIGN_MODEL,
  QWEN_VOICE_DESIGN_MODEL_REVISION,
  __qwenVoiceDesignTest,
  analyzeVoiceDesignWave,
  buildVoiceDesignAssetHook,
  buildVoiceDesignIndexTtsHook,
  compileVoiceDescription,
  createVoiceDesignSession,
  ensureVoiceDesignState,
  normalizeVoiceDesignSettings,
  qwenVoiceDesignHealth,
  queueVoiceDesignRegeneration,
  renameVoiceDesignAudition,
  resolveQwenVoiceDesignPaths,
  safeVoiceDesignProjectFile,
  saveVoiceDesignVoice,
  selectVoiceDesignAudition,
  softDeleteVoiceDesignAudition,
  validateAuditionText,
  validateVoiceDesignSignal,
  voiceDesignMediaUrl
} from "../server/qwen-voice-design.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function writeFloatWave(file, {
  sampleRate = 24_000,
  durationSec = 1.2,
  amplitude = 0.2,
  leadingSec = 0.1,
  trailingSec = 0.1,
  frequency = 220
} = {}) {
  const frames = Math.round(sampleRate * durationSec);
  const dataBytes = frames * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  const leading = Math.round(leadingSec * sampleRate);
  const trailing = Math.round(trailingSec * sampleRate);
  for (let index = 0; index < frames; index += 1) {
    const audible = index >= leading && index < frames - trailing;
    const value = audible ? amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate) : 0;
    buffer.writeFloatLE(value, 44 + index * 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return file;
}

function trustedProvenance() {
  return {
    engine: QWEN_VOICE_DESIGN_ENGINE,
    modelId: QWEN_VOICE_DESIGN_MODEL,
    codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION
  };
}

function writeCompleteModelFixture(modelDir) {
  for (const [, file] of __qwenVoiceDesignTest.requiredModelFiles({ modelDir })) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fixture");
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeHuggingFaceWeightMetadata(modelDir, revision = QWEN_VOICE_DESIGN_MODEL_REVISION) {
  for (const relativeFile of ["model.safetensors", "speech_tokenizer/model.safetensors"]) {
    const weightFile = path.join(modelDir, ...relativeFile.split("/"));
    const metadataFile = path.join(modelDir, ".cache", "huggingface", "download", `${relativeFile}.metadata`);
    fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
    fs.writeFileSync(metadataFile, `${revision}\n${sha256(weightFile)}\n0\n`);
  }
}

function fallbackModelManifest(modelDir) {
  return {
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    localDirectory: modelDir,
    mainWeightsSha256: sha256(path.join(modelDir, "model.safetensors")),
    speechTokenizerWeightsSha256: sha256(path.join(modelDir, "speech_tokenizer", "model.safetensors"))
  };
}

test("runtime paths read the external model directory from the Premiere316 install manifest", (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-paths-"));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = path.join(local, "Premiere316", "Qwen3-TTS-VoiceDesign");
  const externalModel = path.join(local, "external", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  writeCompleteModelFixture(externalModel);
  writeCompleteModelFixture(path.join(root, "models", "Qwen3-TTS-12Hz-1.7B-VoiceDesign"));
  fs.writeFileSync(path.join(root, "premiere316-install.json"), `\uFEFF${JSON.stringify({
    source: { codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION },
    model: { modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION, localDirectory: externalModel }
  })}`);
  const paths = resolveQwenVoiceDesignPaths({ LOCALAPPDATA: local }, "win32");
  assert.equal(paths.root, path.resolve(root));
  assert.equal(paths.modelDir, path.resolve(externalModel));
  assert.equal(paths.attentionImplementation, "sdpa");
  assert.equal(paths.python, path.join(root, ".venv", "Scripts", "python.exe"));
});

test("runtime paths use a root-local fallback only when its Hugging Face revision and manifest weight hashes verify", (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-path-fallback-"));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = path.join(local, "Premiere316", "Qwen3-TTS-VoiceDesign");
  const incompleteManifestModel = path.join(local, "incomplete-external-model");
  const rootLocalModel = path.join(root, "models", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  fs.mkdirSync(incompleteManifestModel, { recursive: true });
  fs.writeFileSync(path.join(incompleteManifestModel, "config.json"), "fixture");
  writeCompleteModelFixture(rootLocalModel);
  writeHuggingFaceWeightMetadata(rootLocalModel);
  fs.writeFileSync(path.join(root, "premiere316-install.json"), JSON.stringify({
    source: { codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION },
    model: { ...fallbackModelManifest(rootLocalModel), localDirectory: incompleteManifestModel }
  }));

  const paths = resolveQwenVoiceDesignPaths({ LOCALAPPDATA: local }, "win32");

  assert.equal(paths.modelDir, path.resolve(rootLocalModel));
  assert.equal(paths.rootLocalFallback?.trusted, true);
});

test("runtime paths reject a root-local fallback with mismatched Hugging Face metadata or manifest weight hashes", (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-path-untrusted-fallback-"));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = path.join(local, "Premiere316", "Qwen3-TTS-VoiceDesign");
  const incompleteManifestModel = path.join(local, "incomplete-external-model");
  const rootLocalModel = path.join(root, "models", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  fs.mkdirSync(incompleteManifestModel, { recursive: true });
  writeCompleteModelFixture(rootLocalModel);
  writeHuggingFaceWeightMetadata(rootLocalModel, "wrong-revision");
  const manifest = {
    source: { codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION },
    model: { ...fallbackModelManifest(rootLocalModel), localDirectory: incompleteManifestModel }
  };
  fs.writeFileSync(path.join(root, "premiere316-install.json"), JSON.stringify(manifest));

  let paths = resolveQwenVoiceDesignPaths({ LOCALAPPDATA: local }, "win32");
  assert.equal(paths.modelDir, path.resolve(incompleteManifestModel));
  assert.equal(paths.rootLocalFallback?.trusted, false);
  assert.ok(paths.rootLocalFallback?.errors.some((entry) => entry.label.includes("Hugging Face metadata revision")));

  writeHuggingFaceWeightMetadata(rootLocalModel);
  manifest.model.mainWeightsSha256 = "0".repeat(64);
  fs.writeFileSync(path.join(root, "premiere316-install.json"), JSON.stringify(manifest));
  paths = resolveQwenVoiceDesignPaths({ LOCALAPPDATA: local }, "win32");
  assert.equal(paths.modelDir, path.resolve(incompleteManifestModel));
  assert.ok(paths.rootLocalFallback?.errors.some((entry) => entry.label.includes("main model weights SHA-256")));
});

test("an explicit incomplete model-directory override remains authoritative and fails closed", (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-path-override-"));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const root = path.join(local, "Premiere316", "Qwen3-TTS-VoiceDesign");
  const missingManifestModel = path.join(local, "missing-manifest-model");
  const explicitIncompleteModel = path.join(local, "explicit-incomplete-model");
  const rootLocalModel = path.join(root, "models", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  fs.mkdirSync(explicitIncompleteModel, { recursive: true });
  fs.writeFileSync(path.join(explicitIncompleteModel, "config.json"), "fixture");
  writeCompleteModelFixture(rootLocalModel);
  fs.writeFileSync(path.join(root, "premiere316-install.json"), JSON.stringify({
    source: { codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION },
    model: {
      modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
      localDirectory: missingManifestModel
    }
  }));

  const env = {
    LOCALAPPDATA: local,
    QWEN3_TTS_VOICE_DESIGN_MODEL_DIR: explicitIncompleteModel
  };
  const paths = resolveQwenVoiceDesignPaths(env, "win32");
  const health = qwenVoiceDesignHealth({ paths, manifest: paths.manifest, env });

  assert.equal(paths.modelDir, path.resolve(explicitIncompleteModel));
  assert.equal(health.ready, false);
  assert.ok(health.missing.some((entry) => entry.label === "model weights" && entry.file.startsWith(path.resolve(explicitIncompleteModel))));
});

test("health fails closed on missing files or revision drift and reports download bytes", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-health-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const modelDir = path.join(temp, "external-model");
  const paths = {
    root: temp,
    manifestFile: path.join(temp, "premiere316-install.json"),
    modelDir,
    python: path.join(temp, ".venv", "Scripts", "python.exe"),
    worker: path.join(ROOT, "scripts", "qwen_voice_design_worker.py"),
    installer: path.join(ROOT, "scripts", "install_qwen_voice_design.ps1"),
    progressFile: path.join(temp, "download-progress.json"),
    idleMs: 10_000,
    attentionImplementation: "sdpa"
  };
  const manifest = {
    source: { codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION },
    model: { modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION, localDirectory: modelDir },
    download: { totalBytes: 5_000 }
  };
  fs.writeFileSync(paths.manifestFile, JSON.stringify(manifest));
  let health = qwenVoiceDesignHealth({ paths, manifest, env: {} });
  assert.equal(health.installed, true);
  assert.equal(health.ready, false);
  assert.ok(health.missing.some((entry) => entry.label === "model weights"));
  for (const [, file] of __qwenVoiceDesignTest.requiredModelFiles(paths)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fixture");
  }
  fs.mkdirSync(path.dirname(paths.python), { recursive: true });
  fs.writeFileSync(paths.python, "fixture");
  health = qwenVoiceDesignHealth({ paths, manifest, env: {} });
  assert.equal(health.ready, true);
  assert.equal(health.precision, "bf16");
  assert.equal(health.attentionImplementation, "sdpa");
  assert.ok(health.download.bytesDownloaded > 0);
  const drifted = qwenVoiceDesignHealth({
    paths,
    manifest: { ...manifest, model: { ...manifest.model, modelRevision: "wrong" } },
    env: {}
  });
  assert.equal(drifted.ready, false);
  assert.equal(drifted.revisionErrors[0].label, "official model revision");
});

test("structured voice fields compile into instruct while audible text rejects control metadata", () => {
  const instruct = compileVoiceDescription({
    apparentAge: "nineteen-year-old",
    genderPresentation: "male",
    vocalRegister: "light baritone leaning tenor",
    timbre: "chestnut warmth",
    diction: "clear but unpolished diction",
    performanceStyle: "intimate live-action drama",
    exclusions: ["announcer delivery", "cartoon quality"]
  });
  assert.match(instruct, /nineteen-year-old male/);
  assert.match(instruct, /light baritone leaning tenor/);
  assert.match(instruct, /Avoid announcer delivery, cartoon quality\./);
  assert.equal(validateAuditionText("Father, I need to speak with you."), "Father, I need to speak with you.");
  assert.throws(() => validateAuditionText("[Character: Jesus] Father."), /audible dialogue/);
  assert.throws(() => validateAuditionText("Wait [pause] for me."), /audible dialogue/);
  assert.deepEqual(normalizeVoiceDesignSettings({ temperature: 99, topP: -1, topK: 0, create48kCopy: false }), {
    temperature: 2,
    topP: 0.05,
    topK: 1,
    repetitionPenalty: 1.05,
    maxNewTokens: 2048,
    create48kCopy: false
  });
});

test("session persistence preserves IndexTTS state and creates 1-3 distinct immutable audition contracts", () => {
  const project = { id: "project-1", slug: "qwen-contract-fixture", sound: { schemaVersion: 1, voices: [{ id: "index-a" }], generations: [{ id: "take-a" }] } };
  const session = createVoiceDesignSession(project, {
    voiceName: "Young Pilgrim",
    characterId: "character-pilgrim",
    language: "en",
    auditionText: "I have chosen my road.",
    descriptionFields: { apparentAge: "nineteen-year-old", vocalRegister: "light baritone" },
    seed: 100,
    auditionCount: 3,
    settings: { create48kCopy: true }
  }, { persist: false });
  assert.equal(project.sound.schemaVersion, 2);
  assert.deepEqual(project.sound.voices, [{ id: "index-a" }]);
  assert.deepEqual(project.sound.generations, [{ id: "take-a" }]);
  assert.equal(session.auditions.length, 3);
  assert.deepEqual(session.auditions.map((entry) => entry.seed), [100, 101, 102]);
  assert.equal(new Set(session.auditions.map((entry) => entry.nativeFile)).size, 3);
  assert.ok(session.auditions.every((entry) => entry.nativeFile.startsWith("production/qwen3-tts/voice-design/")));
  assert.ok(session.auditions.every((entry) => entry.productionMediaUrl?.startsWith("/media/qwen-contract-fixture/audio/voice-design/")));
  assert.equal(session.compiledInstruct.includes(session.auditionText), false);
  assert.equal(ensureVoiceDesignState(project).sessions[0], session);
});

test("native float WAV validation measures clipping and silence and gates content trust on pinned provenance", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-wave-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const clean = writeFloatWave(path.join(temp, "clean.wav"));
  const metrics = analyzeVoiceDesignWave(clean);
  assert.equal(metrics.sampleRate, 24_000);
  assert.equal(metrics.format, "IEEE_FLOAT");
  assert.equal(metrics.bitsPerSample, 32);
  assert.ok(metrics.durationSec > 1);
  const passed = validateVoiceDesignSignal(clean, trustedProvenance());
  assert.equal(passed.passed, true);
  assert.equal(passed.singleSpeaker.status, "trusted-generator-contract");
  const untrusted = validateVoiceDesignSignal(clean, {});
  assert.equal(untrusted.passed, false);
  assert.match(untrusted.failures.join(" "), /provenance/);
  const clipped = writeFloatWave(path.join(temp, "clipped.wav"), { amplitude: 1.2, leadingSec: 0, trailingSec: 0 });
  assert.match(validateVoiceDesignSignal(clipped, trustedProvenance()).failures.join(" "), /clipping/);
  const silent = writeFloatWave(path.join(temp, "silent.wav"), { amplitude: 0 });
  assert.match(validateVoiceDesignSignal(silent, trustedProvenance()).failures.join(" "), /silent/);
});

test("selection, saving, regeneration, hooks, rename, and soft delete retain full provenance", () => {
  const project = { id: "project-hooks", slug: "qwen-hook-fixture" };
  const session = createVoiceDesignSession(project, {
    voiceName: "Pilgrim",
    characterId: "character-pilgrim",
    language: "English",
    auditionText: "I mean to leave at sunrise.",
    instruct: "A youthful, restrained dramatic voice.",
    auditionCount: 1,
    seed: 42
  }, { persist: false });
  const audition = session.auditions[0];
  audition.status = "done";
  audition.nativeSampleRate = 24_000;
  audition.durationSec = 9;
  audition.sha256 = "a".repeat(64);
  audition.quality = { passed: true, signal: { clippingRatio: 0, silenceRatio: 0.1 }, singleSpeaker: { status: "trusted-generator-contract" }, noMusic: { status: "trusted-generator-contract" } };
  audition.provenance = trustedProvenance();
  selectVoiceDesignAudition(project, session.id, audition.id, { persist: false });
  const saved = saveVoiceDesignVoice(project, session.id, audition.id, { persist: false });
  assert.equal(saved.voice.characterId, "character-pilgrim");
  assert.equal(saved.voice.auditionTranscript, session.auditionText);
  assert.equal(saved.voice.completeVoiceDescription, session.compiledInstruct);
  assert.equal(saved.voice.selected, true);
  const assetHook = buildVoiceDesignAssetHook(project, session.id, audition.id);
  assert.equal(assetHook.category, "voice");
  assert.equal(assetHook.sampleText, session.auditionText);
  const indexHook = buildVoiceDesignIndexTtsHook(project, session.id, audition.id);
  assert.equal(indexHook.transcript, session.auditionText);
  assert.equal(indexHook.sourceFile, indexHook.referenceFile);
  assert.equal(indexHook.overwriteSource, false);
  renameVoiceDesignAudition(project, session.id, audition.id, "Lead audition", { persist: false });
  assert.equal(audition.name, "Lead audition");
  const regenerated = queueVoiceDesignRegeneration(project, session.id, audition.id, {}, { persist: false });
  assert.notEqual(regenerated.audition.id, audition.id);
  assert.notEqual(regenerated.audition.nativeFile, audition.nativeFile);
  assert.equal(regenerated.audition.regeneratedFromAuditionId, audition.id);
  softDeleteVoiceDesignAudition(project, session.id, audition.id, { persist: false });
  assert.ok(audition.deletedAt);
  assert.equal(session.selectedAuditionId, null);
});

test("project file and media URL helpers reject traversal and expose only media audio/assets", () => {
  assert.throws(() => safeVoiceDesignProjectFile("fixture", "../outside.wav"), /Invalid|outside|escaped/);
  assert.throws(() => safeVoiceDesignProjectFile("fixture", "media/audio/ok.wav", "production/qwen3-tts/voice-design/"), /outside/);
  assert.match(safeVoiceDesignProjectFile("fixture", "production/qwen3-tts/voice-design/a.wav", "production/qwen3-tts/voice-design/"), /projects[\\/]fixture[\\/]production/);
  assert.equal(voiceDesignMediaUrl("fixture", "production/qwen3-tts/a.wav"), null);
  assert.equal(voiceDesignMediaUrl("fixture", "media/audio/voice-design/a.wav"), "/media/fixture/audio/voice-design/a.wav");
});

test("persistent JSONL worker is lazy, serial, explicit-load aware, and unloadable without model imports", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-worker-"));
  const fakeWorker = path.join(temp, "fake-worker.mjs");
  fs.writeFileSync(fakeWorker, `
    import readline from "node:readline";
    let loaded = false;
    process.stderr.write("fake model diagnostics stay on stderr\\n");
    process.stdout.write(JSON.stringify({ type: "ready", loaded, attentionImplementation: "sdpa" }) + "\\n");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.command === "load") loaded = true;
      if (request.command === "generate") {
        process.stdout.write(JSON.stringify({ type: "progress", id: request.id, stage: "fake", progress: 0.5 }) + "\\n");
      }
      if (request.command === "unload" || request.command === "shutdown") loaded = false;
      process.stdout.write(JSON.stringify({ type: "response", id: request.id, ok: true, result: { loaded, attentionImplementation: "sdpa" } }) + "\\n");
      if (request.command === "shutdown") setImmediate(() => process.exit(0));
    });
  `);
  const paths = {
    root: temp,
    modelDir: path.join(temp, "model"),
    python: process.execPath,
    worker: fakeWorker,
    idleMs: 10_000,
    attentionImplementation: "sdpa"
  };
  const worker = new __qwenVoiceDesignTest.PersistentQwenVoiceDesignWorker(paths);
  t.after(async () => {
    const child = worker.child;
    worker.terminate();
    if (child && child.exitCode == null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  assert.equal(worker.child, null);
  await worker.load();
  assert.equal(worker.loaded, true);
  let progressed = false;
  await worker.request("generate", { text: "hello" }, { onProgress: () => { progressed = true; } });
  assert.equal(progressed, true);
  await worker.shutdown();
  assert.equal(worker.loaded, false);
});

test("a failed initial model load terminates the owned worker so CUDA state and the lease cannot linger", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "p316-qwen-load-failure-"));
  const fakeWorker = path.join(temp, "fake-failed-load.mjs");
  fs.writeFileSync(fakeWorker, `
    import readline from "node:readline";
    process.stdout.write(JSON.stringify({ type: "ready", loaded: false, attentionImplementation: "sdpa" }) + "\\n");
    const lines = readline.createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({ type: "response", id: request.id, ok: false, error: "synthetic load failure" }) + "\\n");
    });
  `);
  const worker = new __qwenVoiceDesignTest.PersistentQwenVoiceDesignWorker({
    root: temp,
    modelDir: path.join(temp, "model"),
    python: process.execPath,
    worker: fakeWorker,
    idleMs: 10_000,
    attentionImplementation: "sdpa"
  });
  t.after(async () => {
    const child = worker.child;
    worker.terminate();
    if (child && child.exitCode == null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await assert.rejects(worker.load(), /synthetic load failure/);
  for (let attempt = 0; attempt < 40 && worker.child; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(worker.child, null);
  assert.equal(worker.loaded, false);
});

test("Python worker and installer pin the official method, BF16/SDPA, RNG isolation, and separate WAV masters", () => {
  const server = fs.readFileSync(path.join(ROOT, "server", "qwen-voice-design.js"), "utf8");
  assert.match(server, /Cancel the active Qwen VoiceDesign generation before repairing its runtime/);
  assert.match(server, /Unloading Qwen VoiceDesign before runtime repair[\s\S]*await unloadQwenVoiceDesign\(\)/);
  const worker = fs.readFileSync(path.join(ROOT, "scripts", "qwen_voice_design_worker.py"), "utf8");
  assert.match(worker, /sys\.stdout = sys\.stderr/);
  assert.match(worker, /Qwen3TTSModel\.from_pretrained/);
  assert.match(worker, /dtype["']?\s*:\s*torch\.bfloat16/);
  assert.match(worker, /attn_implementation/);
  assert.match(worker, /fallback_to_sdpa[\s\S]*MODEL = None[\s\S]*gc\.collect\(\)[\s\S]*torch\.cuda\.empty_cache\(\)[\s\S]*torch\.cuda\.ipc_collect\(\)[\s\S]*attn_implementation["']\] = ["']sdpa["']/);
  assert.match(worker, /MODEL\.generate_voice_design\(/);
  assert.match(worker, /text=text/);
  assert.match(worker, /language=language/);
  assert.match(worker, /instruct=instruct/);
  assert.match(worker, /TORCH\.random\.fork_rng/);
  assert.match(worker, /TORCH\.manual_seed\(seed\)/);
  assert.match(worker, /if MODEL is None:[\s\S]*unload_model\(\)/);
  assert.match(worker, /"FLOAT"/);
  assert.match(worker, /"PCM_24"/);

  const installer = fs.readFileSync(path.join(ROOT, "scripts", "install_qwen_voice_design.ps1"), "utf8");
  assert.match(installer, new RegExp(QWEN_VOICE_DESIGN_CODE_REVISION));
  assert.match(installer, new RegExp(QWEN_VOICE_DESIGN_MODEL_REVISION));
  assert.match(installer, /Qwen\/Qwen3-TTS-12Hz-1\.7B-VoiceDesign/);
  assert.doesNotMatch(installer, /1\.7B-(?:Base|CustomVoice)/);
  assert.match(installer, /Premiere316/);
  assert.match(installer, /attentionImplementation = "sdpa"/);
  assert.match(installer, /qwen_voice_design_constraints\.txt/);
  assert.match(installer, /torch==2\.8\.0\+cu128/);
  assert.match(installer, /minimumFreeBytes/i);
  assert.match(installer, /Get-FileHash[\s\S]*SHA256/);
  assert.match(installer, /mainWeightsSha256/);

  const downloader = fs.readFileSync(path.join(ROOT, "scripts", "download_qwen_voice_design.py"), "utf8");
  assert.match(downloader, /EXPECTED_PAYLOAD_BYTES\s*=\s*4_520_163_832/);
  assert.match(downloader, /MINIMUM_FREE_BYTES\s*=\s*1_073_741_824/);
  assert.match(downloader, /shutil\.disk_usage/);
  assert.match(downloader, /sha256_file/);
  assert.match(downloader, /max_workers=1/);
});
