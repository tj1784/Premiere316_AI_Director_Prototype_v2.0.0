import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDirectorAsset,
  registerDirectorAssetAudio
} from "../server/assets.js";
import {
  GPU_RESOURCE_OWNERS,
  acquireGpuLease,
  gpuLeaseStatus,
  releaseGpuLease,
  resetGpuLeaseForTests,
  updateGpuLease
} from "../server/gpu-resource-manager.js";
import {
  registerIndexTtsVoiceReferenceFromFile,
  validateIndexTtsVoiceReferenceFromFile
} from "../server/index-tts.js";
import { projectDir } from "../server/paths.js";
import { createProject, deleteProject, loadProject, saveProject } from "../server/projects.js";
import { cancelJob, enqueue, listJobs } from "../server/queue.js";
import {
  QWEN_VOICE_DESIGN_CODE_REVISION,
  QWEN_VOICE_DESIGN_ENGINE,
  QWEN_VOICE_DESIGN_MODEL,
  QWEN_VOICE_DESIGN_MODEL_REVISION,
  buildVoiceDesignAssetHook,
  buildVoiceDesignIndexTtsHook,
  createVoiceDesignSession,
  qwenVoiceDesignHealth,
  saveVoiceDesignVoice,
  selectVoiceDesignAudition,
  validateVoiceDesignSignal
} from "../server/qwen-voice-design.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
const QUEUE_SOURCE = fs.readFileSync(path.join(ROOT, "server", "queue.js"), "utf8");

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source contract start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source contract end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeFloatWave(file, {
  sampleRate = 24_000,
  durationSec = 9,
  amplitude = 0.18,
  leadingSec = 0.1,
  trailingSec = 0.1,
  frequency = 196
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
  const leadingFrames = Math.round(sampleRate * leadingSec);
  const trailingFrames = Math.round(sampleRate * trailingSec);
  for (let frame = 0; frame < frames; frame += 1) {
    const audible = frame >= leadingFrames && frame < frames - trailingFrames;
    const value = audible ? amplitude * Math.sin(2 * Math.PI * frequency * frame / sampleRate) : 0;
    buffer.writeFloatLE(value, 44 + frame * 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return buffer;
}

function trustedProvenance() {
  return {
    kind: "synthetic-designed-voice",
    engine: QWEN_VOICE_DESIGN_ENGINE,
    modelId: QWEN_VOICE_DESIGN_MODEL,
    codeRevision: QWEN_VOICE_DESIGN_CODE_REVISION,
    modelRevision: QWEN_VOICE_DESIGN_MODEL_REVISION,
    precision: "bf16",
    attentionImplementation: "sdpa",
    method: "generate_voice_design",
    textContract: "audible-dialogue-only",
    instructionContract: "compiled-natural-language-instruct"
  };
}

async function waitForJob(jobId, acceptedStatuses, timeoutMs = 3_000) {
  const accepted = new Set(Array.isArray(acceptedStatuses) ? acceptedStatuses : [acceptedStatuses]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = listJobs().find((entry) => entry.id === jobId);
    if (job && accepted.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const latest = listJobs().find((entry) => entry.id === jobId) || null;
  assert.fail(`Job ${jobId} did not reach ${[...accepted].join("/")}; latest=${JSON.stringify(latest)}`);
}

test("VoiceDesign HTTP routes expose status, lifecycle, generation, actions, and native WAV without booting a second server", () => {
  assert.match(SERVER_SOURCE, /app\.get\("\/api\/sound\/qwen-voice-design\/status",/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/sound\/qwen-voice-design\/install", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/sound\/qwen-voice-design\/load", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/sound\/qwen-voice-design\/unload", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.get\("\/api\/projects\/:slug\/sound\/voice-design",/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/projects\/:slug\/sound\/voice-design\/auditions", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.get\("\/api\/projects\/:slug\/sound\/voice-design\/auditions\/:auditionId\/native",/);
  assert.match(SERVER_SOURCE, /app\.patch\("\/api\/projects\/:slug\/sound\/voice-design\/auditions\/:auditionId", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.delete\("\/api\/projects\/:slug\/sound\/voice-design\/auditions\/:auditionId", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/projects\/:slug\/sound\/voice-design\/auditions\/:auditionId\/:action", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/queue\/:id\/cancel", requireLocalSameOriginMutation,[\s\S]{0,180}cancelJob\(req\.params\.id\)/);

  const status = sourceSection(
    SERVER_SOURCE,
    "async function qwenVoiceDesignStatusPayload()",
    "app.get(\"/api/sound/qwen-voice-design/status\""
  );
  assert.match(status, /state: installing \? "installing"/);
  assert.match(status, /health\.busy \? "generating"/);
  assert.match(status, /health\.loaded \? "loaded"/);
  assert.match(status, /health\.ready \? "unloaded" : "not-ready"/);
  assert.match(status, /installation,/);
  assert.match(status, /lease: gpuLeaseStatus\(\)/);

  const nativeRoute = sourceSection(
    SERVER_SOURCE,
    "app.get(\"/api/projects/:slug/sound/voice-design/auditions/:auditionId/native\"",
    "app.patch(\"/api/projects/:slug/sound/voice-design/auditions/:auditionId\""
  );
  assert.match(nativeRoute, /voiceDesignAuditionContext\(req\.params\.slug, req\.params\.auditionId\)/);
  assert.match(nativeRoute, /safeVoiceDesignProjectFile\(project\.slug, audition\.nativeFile, "production\/qwen3-tts\/voice-design\/"\)/);
  assert.match(nativeRoute, /res\.type\("audio\/wav"\)/);
  assert.match(nativeRoute, /res\.setHeader\("Cache-Control", "private, no-cache"\)/);
  assert.match(nativeRoute, /res\.sendFile\(file\)/);

  const actions = sourceSection(
    SERVER_SOURCE,
    "app.post(\"/api/projects/:slug/sound/voice-design/auditions/:auditionId/:action\"",
    "app.get(\"/api/projects/:slug/sound/index-tts/voices/:voiceId/reference\""
  );
  for (const action of ["regenerate", "select", "save-to-library", "send-to-index-tts", "open-folder"]) {
    assert.match(actions, new RegExp(`action === "${action}"`));
  }
  assert.match(actions, /const activeSessionJob = listJobs\(\)\.find/);
  assert.match(actions, /Wait for or cancel the active Voice Design session before regenerating/);
  assert.match(actions, /sourceFile: hook\.sourceFile,/);
  assert.match(actions, /transcript: hook\.transcript,/);
  assert.match(actions, /sourceAuditionId: hook\.sourceAuditionId,/);
  assert.match(actions, /sha256: hook\.referenceSha256,/);
  assert.match(actions, /singleSpeaker: hook\.singleSpeakerValidation === "trusted-generator-contract"/);
  assert.match(actions, /musicDetected: hook\.noMusicValidation === "trusted-generator-contract" \? false : null/);
  const indexHandoff = sourceSection(actions, 'if (action === "send-to-index-tts")', 'if (action === "open-folder")');
  const preflightPosition = indexHandoff.indexOf("await validateIndexTtsVoiceReferenceFromFile(project.slug, handoff)");
  const selectionPosition = indexHandoff.indexOf("selectVoiceDesignAudition(project.slug, session.id, audition.id)");
  const libraryPosition = indexHandoff.indexOf("await saveVoiceDesignAuditionToAssetLibrary(project.slug, session.id, audition.id)");
  const registrationPosition = indexHandoff.indexOf("await registerIndexTtsVoiceReferenceFromFile(project.slug");
  assert.ok(preflightPosition >= 0, "IndexTTS handoff preflight is missing");
  assert.ok(preflightPosition < selectionPosition, "IndexTTS preflight must run before selection mutation");
  assert.ok(preflightPosition < libraryPosition, "IndexTTS preflight must run before Asset Library mutation");
  assert.ok(libraryPosition < registrationPosition, "IndexTTS registration must run after the Asset Library supplies assetId");
  assert.match(indexHandoff, /\.\.\.handoff,\s+assetId: library\.asset\.id/);

  const health = qwenVoiceDesignHealth();
  for (const field of ["installed", "ready", "loaded", "busy", "workerPid", "precision", "attentionImplementation", "codeRevision", "modelRevision", "download"]) {
    assert.ok(Object.hasOwn(health, field), `health is missing ${field}`);
  }
  assert.ok(Object.hasOwn(health.download, "bytesDownloaded"));
  assert.ok(Object.hasOwn(health.download, "totalBytes"));
});

test("queue wires Qwen install/generation dedupe, cancellation, dispatch, and peer-unload hooks", async (t) => {
  const health = qwenVoiceDesignHealth();
  if (!health.ready) {
    t.skip("Pinned runtime is not ready, so the installer queue executable check is skipped to guarantee this test never downloads a model");
  } else {
    const first = enqueue({
      type: "install_qwen_voice_design",
      label: "Contract-only ready-install dispatch",
      refs: { force: false }
    });
    assert.equal(first.status, "running");
    assert.equal(first.progress, 1);
    assert.match(first.stage, /already ready/i);
    assert.equal(first.result?.repaired, false);

    const duplicate = enqueue({
      type: "install_qwen_voice_design",
      label: "Must dedupe",
      refs: { force: false }
    });
    assert.equal(duplicate.id, first.id);

    const queueProject = createProject(`Qwen Queue Contract ${crypto.randomUUID()}`);
    t.after(() => deleteProject(queueProject.slug));
    const queueSession = createVoiceDesignSession(queueProject, {
      voiceName: "Queued Contract Voice",
      auditionText: "This queued audition must be cancelled before any model is loaded.",
      instruct: "A clear adult speaking voice.",
      auditionCount: 1,
      seed: 316,
      settings: { create48kCopy: false }
    });
    const generation = enqueue({
      type: "generate_qwen_voice_design",
      projectSlug: queueProject.slug,
      label: "Contract-only queued generation",
      refs: { sessionId: queueSession.id }
    });
    const duplicateGeneration = enqueue({
      type: "generate_qwen_voice_design",
      projectSlug: queueProject.slug,
      label: "Must dedupe by session",
      refs: { sessionId: queueSession.id }
    });
    assert.equal(generation.status, "queued");
    assert.equal(duplicateGeneration.id, generation.id);
    assert.equal(cancelJob(generation.id), true);
    assert.equal(listJobs().find((entry) => entry.id === generation.id)?.status, "cancelled");
    const cancelledSession = loadProject(queueProject.slug).sound.voiceDesign.sessions.find((entry) => entry.id === queueSession.id);
    assert.equal(cancelledSession.status, "cancelled");

    assert.equal(cancelJob(first.id), true);
    const cancelled = await waitForJob(first.id, "cancelled");
    assert.equal(cancelled.error, null);
    assert.equal(cancelled.stage, "Stopped");
  }

  const cancellable = sourceSection(QUEUE_SOURCE, "const LOCAL_CANCELLABLE_JOB_TYPES", "function persistJobLedger");
  assert.match(cancellable, /"generate_qwen_voice_design"/);
  assert.match(cancellable, /"install_qwen_voice_design"/);

  const enqueueSource = sourceSection(QUEUE_SOURCE, "export function enqueue(job)", "export function cancelJob(id)");
  assert.match(enqueueSource, /job\?\.type === "install_qwen_voice_design"/);
  assert.match(enqueueSource, /candidate\.type === "install_qwen_voice_design"/);
  assert.match(enqueueSource, /job\?\.type === "generate_qwen_voice_design" && job\?\.projectSlug && job\?\.refs\?\.sessionId/);
  assert.match(enqueueSource, /candidate\.refs\?\.sessionId === job\.refs\.sessionId/);

  const cancelSource = sourceSection(QUEUE_SOURCE, "export function cancelJob(id)", "export function cancelAssetJobs");
  assert.match(cancelSource, /cancelVoiceDesignSession\(j\.projectSlug, j\.refs\?\.sessionId\)/);
  assert.match(cancelSource, /cancelQwenVoiceDesignInstall\(\)/);
  assert.match(cancelSource, /cancelQwenVoiceDesignWorker\(\)/);
  assert.match(cancelSource, /activeAbortController\?\.abort\(\)/);

  const pumpSource = sourceSection(QUEUE_SOURCE, "async function pump()", "async function unloadLocalGpuOwner(owner)");
  assert.match(pumpSource, /prepareLocalGpuRuntime\(GPU_RESOURCE_OWNERS\.QWEN_VOICE_DESIGN, \{ job: next \}\)/);
  assert.match(pumpSource, /generateVoiceDesignJob\(next\)/);
  assert.match(pumpSource, /installQwenVoiceDesignJob\(next, \{ force: next\.refs\?\.force === true \}\)/);

  const unloadSource = sourceSection(QUEUE_SOURCE, "async function unloadLocalGpuOwner(owner)", "export async function prepareStandaloneQwenTtsRuntime");
  assert.match(unloadSource, /owner === GPU_RESOURCE_OWNERS\.INDEX_TTS/);
  assert.match(unloadSource, /unloadIndexTtsModel\(\{ timeoutMs: 10_000 \}\)/);
  assert.match(unloadSource, /owner === GPU_RESOURCE_OWNERS\.QWEN_VOICE_DESIGN/);
  assert.match(unloadSource, /unloadQwenVoiceDesign\(\{ timeoutMs: 15_000 \}\)/);

  const localGpuSource = sourceSection(QUEUE_SOURCE, "export async function prepareLocalGpuRuntime(owner", "async function prepareGpuForComfy(job)");
  assert.match(localGpuSource, /existing\.owner !== owner && existing\.owner !== GPU_RESOURCE_OWNERS\.COMFYUI/);
  assert.match(localGpuSource, /await unloadLocalGpuOwner\(existing\.owner\)/);
  assert.match(localGpuSource, /await releaseComfyGpuMemory\(\)/);
  assert.match(localGpuSource, /releaseGpuLease\(GPU_RESOURCE_OWNERS\.COMFYUI\)/);
  assert.match(localGpuSource, /sharedGpu\.comfyAvailable/);
  assert.match(localGpuSource, /comfyLeaseHasActiveWork\(\)/);

  const comfySource = sourceSection(QUEUE_SOURCE, "async function prepareGpuForComfy(job)", "async function waitForSharedGpu(job)");
  assert.match(comfySource, /await unloadLocalGpuOwner\(existing\.owner\)/);
  assert.match(comfySource, /acquireGpuLease\(GPU_RESOURCE_OWNERS\.COMFYUI/);
});

test("GPU lease manager enforces exclusive IndexTTS and VoiceDesign ownership", (t) => {
  resetGpuLeaseForTests();
  t.after(resetGpuLeaseForTests);

  const indexLease = acquireGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS, {
    label: "IndexTTS contract fixture",
    workerPid: 101,
    state: "loaded"
  });
  assert.equal(indexLease.owner, GPU_RESOURCE_OWNERS.INDEX_TTS);
  assert.throws(
    () => acquireGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN),
    (error) => error?.code === "GPU_LEASE_BUSY" && error?.statusCode === 409 && error?.lease?.owner === GPU_RESOURCE_OWNERS.INDEX_TTS
  );
  assert.equal(releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN), false);
  assert.equal(releaseGpuLease(GPU_RESOURCE_OWNERS.INDEX_TTS), true);

  acquireGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
    label: "Qwen VoiceDesign contract fixture",
    workerPid: 202,
    state: "loaded"
  });
  const updated = updateGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN, {
    jobId: "job-contract",
    state: "generating"
  });
  assert.equal(updated.workerPid, 202);
  assert.equal(updated.jobId, "job-contract");
  assert.equal(updated.state, "generating");
  assert.deepEqual(gpuLeaseStatus(), updated);
  assert.equal(releaseGpuLease(GPU_RESOURCE_OWNERS.QWEN_VOICE_DESIGN), true);
  assert.equal(gpuLeaseStatus(), null);
});

test("Asset Library and IndexTTS handoffs preserve the exact transcript and never overwrite the Qwen master", async (t) => {
  const exactTranscript = "Father, forgive them; they do not know what they are doing.";
  const project = createProject(`Qwen VoiceDesign Contract ${crypto.randomUUID()}`);
  t.after(() => deleteProject(project.slug));

  const session = createVoiceDesignSession(project, {
    projectId: project.slug,
    characterId: "character-contract",
    voiceName: "Contract Witness",
    language: "English",
    auditionText: exactTranscript,
    instruct: "A restrained adult dramatic voice with clear diction and a warm low register.",
    seed: 316,
    auditionCount: 1,
    settings: { create48kCopy: false }
  }, { persist: false });
  const audition = session.auditions[0];
  const sourceFile = path.join(projectDir(project.slug), ...audition.nativeFile.split("/"));
  const sourceBuffer = writeFloatWave(sourceFile);
  const sourceHash = sha256(sourceBuffer);
  const provenance = trustedProvenance();
  const quality = validateVoiceDesignSignal(sourceFile, provenance);
  assert.equal(quality.passed, true);

  audition.status = "done";
  audition.nativeSampleRate = 24_000;
  audition.durationSec = quality.signal.durationSec;
  audition.bytes = sourceBuffer.byteLength;
  audition.sha256 = sourceHash;
  audition.quality = quality;
  audition.provenance = provenance;
  audition.finishedAt = new Date().toISOString();
  session.status = "done";
  session.finishedAt = audition.finishedAt;
  selectVoiceDesignAudition(project, session.id, audition.id, { persist: false });
  const saved = saveVoiceDesignVoice(project, session.id, audition.id, { persist: false });
  assert.equal(saved.voice.auditionTranscript, exactTranscript);
  saveProject(project);

  const assetHook = buildVoiceDesignAssetHook(project.slug, session.id, audition.id);
  const indexHook = buildVoiceDesignIndexTtsHook(project.slug, session.id, audition.id);
  assert.equal(assetHook.sampleText, exactTranscript);
  assert.equal(assetHook.metadata.auditionTranscript, exactTranscript);
  assert.equal(assetHook.sourceFile, sourceFile);
  assert.equal(indexHook.transcript, exactTranscript);
  assert.equal(indexHook.sourceFile, sourceFile);
  assert.equal(indexHook.referenceFile, sourceFile);
  assert.equal(indexHook.referenceSha256, sourceHash);
  assert.equal(indexHook.copyRequired, true);
  assert.equal(indexHook.overwriteSource, false);

  const validation = {
    valid: indexHook.quality?.passed === true,
    clipping: Number(indexHook.signalValidation?.clippingRatio) > 0.005 || Number(indexHook.signalValidation?.peak) > 1.0001,
    excessiveSilence: Number(indexHook.signalValidation?.silenceRatio) > 0.8 || Number(indexHook.signalValidation?.leadingSilenceSec) > 2 || Number(indexHook.signalValidation?.trailingSilenceSec) > 2,
    singleSpeaker: indexHook.singleSpeakerValidation === "trusted-generator-contract",
    musicDetected: indexHook.noMusicValidation === "trusted-generator-contract" ? false : null
  };
  const preflightInput = {
    sourceFile: indexHook.sourceFile,
    transcript: indexHook.transcript,
    speaker: indexHook.speaker,
    name: indexHook.voiceName,
    characterId: indexHook.characterId,
    sourceAuditionId: indexHook.sourceAuditionId,
    sourceEngine: "Qwen3-TTS VoiceDesign",
    sha256: indexHook.referenceSha256,
    provenance: indexHook.provenance,
    validation
  };
  const projectFile = path.join(projectDir(project.slug), "project.json");
  const projectBeforePreflight = fs.readFileSync(projectFile);
  const referencesDirectory = path.join(projectDir(project.slug), "production", "index-tts", "references");
  assert.equal(fs.existsSync(referencesDirectory), false);
  const preflight = await validateIndexTtsVoiceReferenceFromFile(project.slug, preflightInput);
  assert.equal(preflight.valid, true);
  assert.equal(preflight.transcript, exactTranscript);
  assert.equal(preflight.sha256, sourceHash);
  assert.equal(preflight.durationSec, 9);
  assert.equal(preflight.sampleRate, 24_000);
  assert.equal(preflight.sourceFile, sourceFile);
  assert.deepEqual(fs.readFileSync(projectFile), projectBeforePreflight);
  assert.equal(fs.existsSync(referencesDirectory), false);
  assert.equal(sha256(fs.readFileSync(sourceFile)), sourceHash);

  const asset = createDirectorAsset({
    category: "voice",
    name: assetHook.voiceName,
    variant: "Voice Design",
    prompt: assetHook.prompt,
    sampleText: assetHook.sampleText,
    workflowId: "qwen3-tts-voice-design-1.7b"
  }, []);
  project.assets = {
    schemaVersion: 1,
    screenplayHash: null,
    counts: { voice: 1 },
    total: 1,
    items: [asset],
    deletedItems: []
  };
  const assetResult = registerDirectorAssetAudio(project, asset, {
    buffer: fs.readFileSync(assetHook.sourceFile),
    extension: ".wav",
    sourceFileName: assetHook.sourceFileName,
    contentType: assetHook.contentType,
    metadata: {
      ...assetHook.metadata,
      assetId: asset.id,
      model: assetHook.metadata.modelId,
      transcript: assetHook.metadata.auditionTranscript,
      provenanceType: "synthetic-designed-voice"
    }
  });
  assert.equal(assetResult.version.sampleText, exactTranscript);
  assert.equal(assetResult.version.model, QWEN_VOICE_DESIGN_MODEL);
  assert.equal(assetResult.version.provenanceType, "synthetic-designed-voice");
  assert.equal(assetResult.version.voiceDesign.transcript, exactTranscript);
  assert.equal(assetResult.version.voiceDesign.auditionTranscript, exactTranscript);
  assert.equal(assetResult.version.voiceDesign.sourceAuditionId, audition.id);
  assert.equal(assetResult.version.voiceDesign.codeRevision, QWEN_VOICE_DESIGN_CODE_REVISION);
  assert.equal(assetResult.version.voiceDesign.modelRevision, QWEN_VOICE_DESIGN_MODEL_REVISION);
  assert.equal(sha256(fs.readFileSync(sourceFile)), sourceHash);

  const indexInput = {
    ...preflightInput,
    assetId: asset.id,
  };
  const registered = await registerIndexTtsVoiceReferenceFromFile(project.slug, indexInput);
  assert.equal(registered.voice.referenceTranscript, exactTranscript);
  assert.equal(registered.voice.sourceAuditionId, audition.id);
  assert.equal(registered.voice.assetId, asset.id);
  assert.equal(registered.voice.referenceSha256, sourceHash);
  assert.notEqual(path.resolve(projectDir(project.slug), registered.voice.referenceFile), sourceFile);

  const referenceFile = path.resolve(projectDir(project.slug), registered.voice.referenceFile);
  const transcriptFile = path.resolve(projectDir(project.slug), registered.voice.referenceTranscriptFile);
  assert.equal(sha256(fs.readFileSync(referenceFile)), sourceHash);
  assert.equal(fs.readFileSync(transcriptFile, "utf8"), `${exactTranscript}\n`);
  assert.equal(sha256(fs.readFileSync(sourceFile)), sourceHash);

  const beforeRepeat = loadProject(project.slug);
  const repeated = await registerIndexTtsVoiceReferenceFromFile(project.slug, indexInput);
  const afterRepeat = loadProject(project.slug);
  assert.equal(repeated.voice.id, registered.voice.id);
  assert.equal(afterRepeat.sound.voices.length, beforeRepeat.sound.voices.length);
  assert.equal(sha256(fs.readFileSync(referenceFile)), sourceHash);
  assert.equal(fs.readFileSync(transcriptFile, "utf8"), `${exactTranscript}\n`);

  await assert.rejects(
    registerIndexTtsVoiceReferenceFromFile(project.slug, {
      ...indexInput,
      transcript: "A different transcript must never replace the exact source words."
    }),
    /Immutable IndexTTS transcript collision/
  );
  assert.equal(sha256(fs.readFileSync(sourceFile)), sourceHash);
  assert.equal(sha256(fs.readFileSync(referenceFile)), sourceHash);
  assert.equal(fs.readFileSync(transcriptFile, "utf8"), `${exactTranscript}\n`);

  const librarySource = sourceSection(
    SERVER_SOURCE,
    "async function saveVoiceDesignAuditionToAssetLibrary",
    "function publicVoiceDesignSession"
  );
  assert.match(librarySource, /version\?\.voiceDesign\?\.sourceAuditionId === auditionId/);
  assert.match(librarySource, /version\?\.voiceDesign\?\.sha256 === hook\.metadata\?\.sha256/);
  assert.match(librarySource, /registerDirectorAssetAudio\(project, asset,/);
  assert.match(librarySource, /transcript: hook\.metadata\?\.auditionTranscript/);
  assert.match(librarySource, /provenanceType: "synthetic-designed-voice"/);
});

test("IndexTTS preflight rejects an invalid reference before selection or Asset Library mutation", async (t) => {
  const project = createProject(`Qwen Transaction Contract ${crypto.randomUUID()}`);
  t.after(() => deleteProject(project.slug));
  const session = createVoiceDesignSession(project, {
    projectId: project.slug,
    characterId: "character-transaction-contract",
    voiceName: "Uncommitted Contract Voice",
    language: "English",
    auditionText: "This reference is intentionally too short for IndexTTS.",
    instruct: "A clean adult dramatic voice.",
    seed: 317,
    auditionCount: 1,
    settings: { create48kCopy: false }
  }, { persist: false });
  const audition = session.auditions[0];
  const sourceFile = path.join(projectDir(project.slug), ...audition.nativeFile.split("/"));
  const sourceBuffer = writeFloatWave(sourceFile, { durationSec: 1 });
  const sourceHash = sha256(sourceBuffer);
  const provenance = trustedProvenance();
  const quality = validateVoiceDesignSignal(sourceFile, provenance);
  assert.equal(quality.passed, true);
  audition.status = "done";
  audition.nativeSampleRate = 24_000;
  audition.durationSec = quality.signal.durationSec;
  audition.bytes = sourceBuffer.byteLength;
  audition.sha256 = sourceHash;
  audition.quality = quality;
  audition.provenance = provenance;
  audition.finishedAt = new Date().toISOString();
  session.status = "done";
  session.finishedAt = audition.finishedAt;
  saveProject(project);

  const hook = buildVoiceDesignIndexTtsHook(project.slug, session.id, audition.id);
  const signal = hook.signalValidation || {};
  const projectFile = path.join(projectDir(project.slug), "project.json");
  const projectBeforePreflight = fs.readFileSync(projectFile);
  const referencesDirectory = path.join(projectDir(project.slug), "production", "index-tts", "references");
  await assert.rejects(
    validateIndexTtsVoiceReferenceFromFile(project.slug, {
      sourceFile: hook.sourceFile,
      transcript: hook.transcript,
      speaker: hook.speaker,
      name: hook.voiceName,
      characterId: hook.characterId,
      sourceAuditionId: hook.sourceAuditionId,
      sourceEngine: "Qwen3-TTS VoiceDesign",
      sha256: hook.referenceSha256,
      provenance: hook.provenance,
      validation: {
        valid: hook.quality?.passed === true,
        clipping: Number(signal.clippingRatio) > 0.005 || Number(signal.peak) > 1.0001,
        excessiveSilence: Number(signal.silenceRatio) > 0.8 || Number(signal.leadingSilenceSec) > 2 || Number(signal.trailingSilenceSec) > 2,
        singleSpeaker: hook.singleSpeakerValidation === "trusted-generator-contract",
        musicDetected: hook.noMusicValidation === "trusted-generator-contract" ? false : null
      }
    }),
    /Reference audio must be 8.+15 seconds long/
  );

  assert.deepEqual(fs.readFileSync(projectFile), projectBeforePreflight);
  assert.equal(fs.existsSync(referencesDirectory), false);
  assert.equal(sha256(fs.readFileSync(sourceFile)), sourceHash);

  const corruptFile = path.join(path.dirname(sourceFile), "corrupt-contract-reference.wav");
  const corruptBuffer = Buffer.alloc(128, 0x5a);
  fs.writeFileSync(corruptFile, corruptBuffer);
  await assert.rejects(
    validateIndexTtsVoiceReferenceFromFile(project.slug, {
      sourceFile: corruptFile,
      transcript: "The probe must reject this corrupt reference before any project mutation.",
      sha256: sha256(corruptBuffer),
      validation: {
        valid: true,
        clipping: false,
        excessiveSilence: false,
        singleSpeaker: true,
        musicDetected: false
      }
    }),
    /ffprobe exited|readable audio stream/i
  );
  assert.deepEqual(fs.readFileSync(projectFile), projectBeforePreflight);
  assert.equal(fs.existsSync(referencesDirectory), false);
  assert.deepEqual(fs.readFileSync(corruptFile), corruptBuffer);

  const after = loadProject(project.slug);
  const state = after.sound.voiceDesign;
  const afterSession = state.sessions.find((entry) => entry.id === session.id);
  const afterAudition = afterSession.auditions.find((entry) => entry.id === audition.id);
  assert.equal(afterSession.selectedAuditionId, null);
  assert.equal(afterAudition.selected, false);
  assert.deepEqual(state.savedVoices, []);
  assert.deepEqual(state.defaultByCharacter, {});
  assert.equal(after.assets, null);
  assert.deepEqual(after.sound.voices, []);
});
