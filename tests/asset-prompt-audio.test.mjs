import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  AssetPromptAudioError,
  STALE_AUDIO_COMPOSER_WORKFLOW_IDS,
  STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID,
  STANDALONE_QWEN_TTS_DIALOGUE_WORKFLOW_ID,
  STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID,
  combineAssetPromptWorkflowCatalog,
  createAndEnqueueAssetPromptAudio,
  finalizeAssetPromptAudioGeneration,
  getAssetPromptAudioWorkflowCatalog
} from "../server/asset-prompt-audio.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function asset({ id, name, category, mediaType, file, sha256 = HASH_A, bytes = 12, prompt = "" }) {
  return {
    id,
    name,
    category,
    mediaType,
    activeVersion: 1,
    versions: [{
      v: 1,
      file,
      prompt,
      mediaType,
      fileHashes: [{ file, sha256, bytes }]
    }]
  };
}

function fixtureProject({ indexVoice = true, qwenVoice = false } = {}) {
  const transcript = "We leave before dawn.";
  const items = [
    asset({ id: "character-adam", name: "ADAM - First Man Freed", category: "character", mediaType: "image", file: "adam.png", sha256: HASH_B, prompt: "Adam's exact approved appearance" }),
    asset({ id: "voice-adam", name: "ADAM - Voice", category: "voice", mediaType: "audio", file: "adam.wav", sha256: HASH_A, bytes: 12, prompt: "Adam's exact approved voice" }),
    asset({ id: "location-dungeon", name: "Dungeon", category: "location", mediaType: "image", file: "dungeon.png", sha256: HASH_C, bytes: 30, prompt: "A torchlit stone dungeon" })
  ];
  const voices = [];
  if (indexVoice) voices.push({
    id: "index-adam",
    provider: "indexTts",
    assetId: "voice-adam",
    referenceSha256: HASH_A,
    bytes: 12
  });
  if (qwenVoice) voices.push({
    id: "qwen-adam",
    provider: "qwenTts",
    assetId: "voice-adam",
    referenceSha256: HASH_A,
    bytes: 12,
    referenceTranscript: transcript,
    referenceTranscriptSha256: crypto.createHash("sha256").update(transcript).digest("hex")
  });
  return {
    id: "project-audio-test",
    slug: "audio_test",
    marker: "original",
    settings: { skipApproval: true, skipScreenplay: true, fps: 24 },
    screenplay: { markdown: "" },
    assets: { items },
    sound: { voices, generations: [], audioGenerations: [], voiceDesign: { sessions: [] } },
    promptGenerations: { schema: "premiere316.prompt-generations.v1", items: [] }
  };
}

function registryProfile(overrides = {}) {
  return {
    id: "minimax-music-3",
    displayName: "MiniMax Music 3",
    category: "music",
    engine: "comfyui",
    modelFamily: "MiniMax Music 3",
    description: "Validated local music workflow",
    duration: { min: 0.04, max: 360, step: 0.04, default: 60 },
    capabilities: { duration: true, lyrics: true, formats: ["flac", "mp3"], boundControls: ["prompt", "duration"] },
    source: { relativePath: "workflows/minimax.json", sha256: HASH_A },
    api: { relativePath: "workflows/minimax.api.json", sha256: HASH_B },
    bindingSha256: HASH_C,
    readiness: { ready: true, status: "ready", label: "Ready", errors: [], drift: [] },
    ...overrides
  };
}

async function catalog(project, profiles = []) {
  return getAssetPromptAudioWorkflowCatalog(project, {
    audioCatalog: { registryId: "audio-registry-exact-v7", profiles },
    voiceDesignHealth: { ready: true, reason: "VoiceDesign ready" },
    indexHealth: { ready: true, reason: "IndexTTS ready" },
    qwenHealth: { ready: true, reason: "Qwen Base ready" }
  });
}

function harness(project, workflows, overrides = {}) {
  let store = structuredClone(project);
  const jobs = [];
  const captures = { audio: [], voiceDesign: [], index: [], qwen: [], pins: [] };
  const saveProjectFn = (next) => {
    store = structuredClone(next);
    return store;
  };
  const dependencies = {
    getCatalogFn: async () => workflows,
    loadProjectFn: () => structuredClone(store),
    saveProjectFn,
    listJobsFn: () => structuredClone(jobs),
    assertPinsFn: (_project, pins) => { captures.pins.push(structuredClone(pins)); return true; },
    prepareAudioGenerationRecordsFn: async (_slug, request) => {
      captures.audio.push(structuredClone(request));
      const selected = workflows.find((workflow) => workflow.id === request.profileId);
      return {
        profileId: request.profileId,
        generationIds: ["audio-gen-1"],
        workflowProvenance: structuredClone(selected?.workflowProvenance || null)
      };
    },
    createVoiceDesignSessionFn: async (next, request) => {
      captures.voiceDesign.push(structuredClone(request));
      const session = { id: "voice-design-session-1", status: "queued" };
      next.sound.voiceDesign.sessions.push(session);
      saveProjectFn(next);
      return session;
    },
    bindVoiceDesignSessionJobFn: () => {},
    createIndexTtsGenerationFn: async (_slug, request) => {
      captures.index.push(structuredClone(request));
      return { generation: { id: "index-generation-1" } };
    },
    bindIndexTtsGenerationJobFn: () => {},
    createQwenTtsGenerationFn: async (_slug, request) => {
      captures.qwen.push(structuredClone(request));
      return { generation: { id: "qwen-generation-1" } };
    },
    bindQwenTtsGenerationJobFn: () => {},
    enqueueFn: (request) => {
      const job = { id: `job-${jobs.length + 1}`, status: "queued", ...structuredClone(request) };
      jobs.push(job);
      return structuredClone(job);
    },
    ...overrides
  };
  return { dependencies, captures, jobs, getStore: () => structuredClone(store), setStore: (value) => { store = structuredClone(value); } };
}

test("audio catalog maps exact registry provenance, duration granularity, formats, and removes stale placeholders", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  const music = workflows.find((workflow) => workflow.id === "minimax-music-3");
  assert.equal(music.ready, true);
  assert.equal(music.availableNow, true);
  assert.deepEqual(music.supportedOutputModes, ["audio"]);
  assert.equal(music.queueType, "generate_audio_workflow");
  assert.deepEqual(music.workflowProvenance, {
    registryId: "audio-registry-exact-v7",
    profileId: "minimax-music-3",
    sourceSha256: HASH_A,
    apiSha256: HASH_B,
    bindingSha256: HASH_C
  });
  assert.equal(music.optionSchema.properties.durationSec.multipleOf, 0.04);
  assert.deepEqual(music.optionSchema.properties.outputFormat, { type: "string", enum: ["flac", "mp3"], default: "flac" });
  assert.equal(music.composerSchema.primaryPrompt.label, "Sound / music description");
  assert.ok(music.composerSchema.fields.some((field) => field.key === "durationSec" && field.step === 0.04));
  assert.ok(music.composerSchema.fields.some((field) => field.key === "lyrics"));

  const combined = combineAssetPromptWorkflowCatalog([
    { id: "visual", label: "Visual" },
    ...STALE_AUDIO_COMPOSER_WORKFLOW_IDS.map((id) => ({ id }))
  ], workflows);
  assert.ok(combined.some((workflow) => workflow.id === "visual"));
  assert.ok(combined.some((workflow) => workflow.id === "minimax-music-3"));
  assert.ok(STALE_AUDIO_COMPOSER_WORKFLOW_IDS.every((id) => !combined.some((workflow) => workflow.id === id)));
});

test("audio registry probe failures preserve fail-closed workflow rows instead of blanking the combined catalog", async () => {
  const manifest = {
    id: "music.fallback",
    displayName: "Fallback Music",
    category: "music",
    role: "generator",
    engine: "ComfyUI",
    sourceWorkflowSha256: HASH_A,
    apiWorkflowSha256: HASH_B,
    originalWorkflowPath: "source.json",
    appOwnedApiWorkflowPath: "api.json",
    supportedDurationRange: { min: 1, max: 12, step: 0.25, default: 4 },
    outputFormats: ["wav"],
    inputNodeBindings: {
      prompt: { nodeId: "1", inputName: "text", type: "STRING" },
      durationSeconds: { nodeId: "2", inputName: "seconds", type: "FLOAT" }
    },
    outputNodeBindings: [{ nodeId: "3", inputName: "audio", historyOutput: "audio" }]
  };
  const workflows = await getAssetPromptAudioWorkflowCatalog(fixtureProject(), {
    getAudioWorkflowCatalogFn: async () => { throw new DOMException("blocked", "TimeoutError"); },
    audioRegistry: { registryId: "fallback-registry", profiles: [manifest] },
    voiceDesignHealth: { ready: false, reason: "not installed" },
    indexHealth: { ready: false, reason: "not installed" },
    qwenHealth: { ready: false, reason: "not installed" }
  });
  const row = workflows.find((workflow) => workflow.id === "music.fallback");
  assert.ok(row);
  assert.equal(row.ready, false);
  assert.equal(row.workflowProvenance.registryId, "fallback-registry");
  assert.equal(row.workflowProvenance.sourceSha256, HASH_A);
  assert.equal(row.workflowProvenance.apiSha256, HASH_B);
  assert.equal(row.workflowProvenance.bindingSha256.length, 64);
  assert.match(row.reason, /failed closed.*blocked/i);
  assert.equal(row.optionSchema.properties.durationSec.multipleOf, 0.25);
});

test("concurrent cold catalog requests share one live probe and reuse its short cache", async () => {
  const state = {};
  let calls = 0;
  let resolveProbe;
  const deferred = new Promise((resolve) => { resolveProbe = resolve; });
  const options = {
    audioCatalogProbeState: state,
    getAudioWorkflowCatalogFn: async () => {
      calls += 1;
      return deferred;
    },
    catalogTimeoutMs: 1_000,
    catalogCacheTtlMs: 1_000,
    voiceDesignHealth: { ready: false, reason: "not installed" },
    indexHealth: { ready: false, reason: "not installed" },
    qwenHealth: { ready: false, reason: "not installed" }
  };
  const project = fixtureProject();
  const first = getAssetPromptAudioWorkflowCatalog(project, options);
  const second = getAssetPromptAudioWorkflowCatalog(project, options);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveProbe({ registryId: "shared-cold-probe", profiles: [registryProfile()] });
  const [firstRows, secondRows] = await Promise.all([first, second]);
  assert.equal(firstRows.find((row) => row.id === "minimax-music-3").ready, true);
  assert.equal(secondRows.find((row) => row.id === "minimax-music-3").ready, true);

  const cachedRows = await getAssetPromptAudioWorkflowCatalog(project, options);
  assert.equal(cachedRows.find((row) => row.id === "minimax-music-3").ready, true);
  assert.equal(calls, 1);
});

test("a timed-out cold catalog probe remains shared and populates cache when it eventually resolves", async () => {
  const state = {};
  let calls = 0;
  let resolveProbe;
  const deferred = new Promise((resolve) => { resolveProbe = resolve; });
  const registry = { registryId: "timeout-fallback", profiles: [registryProfile()] };
  const baseOptions = {
    audioCatalogProbeState: state,
    getAudioWorkflowCatalogFn: async () => {
      calls += 1;
      return deferred;
    },
    audioRegistry: registry,
    catalogCacheTtlMs: 1_000,
    voiceDesignHealth: { ready: false, reason: "not installed" },
    indexHealth: { ready: false, reason: "not installed" },
    qwenHealth: { ready: false, reason: "not installed" }
  };
  const project = fixtureProject();
  const timedOutRows = await getAssetPromptAudioWorkflowCatalog(project, { ...baseOptions, catalogTimeoutMs: 250 });
  assert.equal(timedOutRows.find((row) => row.id === "minimax-music-3").ready, false);
  assert.match(timedOutRows.find((row) => row.id === "minimax-music-3").reason, /timed out/i);
  assert.equal(calls, 1);

  const resumed = getAssetPromptAudioWorkflowCatalog(project, { ...baseOptions, catalogTimeoutMs: 1_000 });
  await Promise.resolve();
  assert.equal(calls, 1, "a timeout does not launch a second uncancelled object_info/catalog probe");
  resolveProbe({ registryId: "recovered-live-probe", profiles: [registryProfile()] });
  const recoveredRows = await resumed;
  assert.equal(recoveredRows.find((row) => row.id === "minimax-music-3").ready, true);

  const cachedRows = await getAssetPromptAudioWorkflowCatalog(project, { ...baseOptions, catalogTimeoutMs: 1_000 });
  assert.equal(cachedRows.find((row) => row.id === "minimax-music-3").ready, true);
  assert.equal(calls, 1);
});

test("standalone dialogue readiness and speaker selector require an exact provider-to-asset hash mapping", async () => {
  const linked = fixtureProject();
  const linkedCatalog = await catalog(linked);
  const index = linkedCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(index.ready, true);
  assert.deepEqual(index.referencePolicy.acceptedAssetIds, ["voice-adam"]);
  assert.deepEqual(index.composerSchema.speakerReference.acceptedAssetIds, ["voice-adam"]);
  assert.equal(index.composerSchema.speakerReference.requireApproved, true);
  assert.deepEqual(index.referencePolicy.acceptedCategories, ["voice"]);
  assert.equal(index.composerSchema.fields.find((field) => field.key === "sampleText")?.label, "Exact dialogue");
  assert.equal(index.optionSchema.properties.style, undefined);
  assert.ok(!index.composerSchema.fields.some((field) => field.key === "style"));

  const mismatched = fixtureProject();
  mismatched.sound.voices[0].referenceSha256 = HASH_B;
  const blockedCatalog = await catalog(mismatched);
  const blocked = blockedCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(blocked.ready, false);
  assert.match(blocked.reason, /no explicit provider voice linked/i);

  const unapproved = fixtureProject();
  unapproved.settings.skipApproval = false;
  const unapprovedCatalog = await catalog(unapproved);
  const unavailable = unapprovedCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.availableNow, false);
  assert.deepEqual(unavailable.referencePolicy.acceptedAssetIds, []);

  const wrongCategory = fixtureProject();
  wrongCategory.assets.items.find((item) => item.id === "voice-adam").category = "sound";
  const wrongCategoryCatalog = await catalog(wrongCategory);
  const wrongCategoryRow = wrongCategoryCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(wrongCategoryRow.ready, false);
  assert.equal(wrongCategoryRow.availableNow, false);
  assert.deepEqual(wrongCategoryRow.referencePolicy.acceptedAssetIds, []);

  const ambiguous = fixtureProject();
  ambiguous.sound.voices.push({
    id: "index-adam-duplicate",
    provider: "indexTts",
    assetId: "voice-adam",
    referenceSha256: HASH_A,
    bytes: 12
  });
  const ambiguousCatalog = await catalog(ambiguous);
  const ambiguousRow = ambiguousCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(ambiguousRow.ready, false);
  assert.equal(ambiguousRow.availableNow, false);
  assert.deepEqual(ambiguousRow.referencePolicy.acceptedAssetIds, []);
  assert.deepEqual(ambiguousRow.composerSchema.speakerReference.acceptedAssetIds, []);
});

test("provider linkage accepts a native VoiceDesign reference chained to its active production-copy asset", async () => {
  const project = fixtureProject({ indexVoice: false });
  const voiceAsset = project.assets.items.find((item) => item.id === "voice-adam");
  const version = voiceAsset.versions[0];
  version.fileHashes[0] = { file: "adam.wav", sha256: HASH_B, bytes: 20 };
  version.voiceDesign = {
    id: "qvd_voice_adam",
    sourceAuditionId: "qvd_audition_adam",
    sha256: HASH_A,
    productionSha256: HASH_B,
    quality: { signal: { bytes: 12 } },
    provenance: { auditionId: "qvd_audition_adam", outputSha256: HASH_A, productionSha256: HASH_B }
  };
  project.sound.voices.push({
    id: "index-adam-native",
    provider: "indexTts",
    assetId: "voice-adam",
    sourceAuditionId: "qvd_audition_adam",
    referenceSha256: HASH_A,
    bytes: 12
  });
  project.sound.voiceDesign = {
    savedVoices: [{
      id: "saved-adam",
      assetId: "voice-adam",
      sourceAuditionId: "qvd_audition_adam",
      indexTtsVoiceId: "index-adam-native"
    }],
    sessions: []
  };
  const workflows = await catalog(project);
  const index = workflows.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(index.ready, true);
  assert.deepEqual(index.referencePolicy.acceptedAssetIds, ["voice-adam"]);
  assert.equal(index.linkedProviderVoices[0].referenceSha256, HASH_A);
  assert.equal(index.linkedProviderVoices[0].linkKind, "voice-design-provider-link");
});

test("generic Audio dispatch expands exact text context, persists immutable refs, and uses the existing audio worker", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  const state = harness(project, workflows);
  const result = await createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "Distant chains echo through @Dungeon",
    references: [{ display: "@Dungeon", assetId: "location-dungeon", assetVersion: 1, role: "location", order: 1 }],
    options: { durationSec: 8, lyrics: "No lyrics", outputFormat: "flac" }
  }, state.dependencies);

  assert.equal(result.alreadyQueued, false);
  assert.equal(result.job.type, "generate_audio_workflow");
  assert.deepEqual(result.job.expectedWorkflow, {
    registryId: "audio-registry-exact-v7",
    profileId: "minimax-music-3",
    sourceSha256: HASH_A,
    apiSha256: HASH_B,
    bindingSha256: HASH_C
  });
  assert.deepEqual(result.job.refs.expectedWorkflow, result.job.expectedWorkflow);
  assert.equal(result.job.refs.promptGenerationId, result.generation.id);
  assert.equal(result.generation.references[0].assetVersionId, "location-dungeon:v1");
  assert.equal(result.generation.references[0].sha256, HASH_C);
  assert.match(state.captures.audio[0].prompt, /Exact Asset Library context/);
  assert.match(state.captures.audio[0].prompt, /torchlit stone dungeon/i);
  assert.equal(state.captures.audio[0].assetPromptReferences[0].contextSha256.length, 64);
  const stored = state.getStore().promptGenerations.items.find((item) => item.id === result.generation.id);
  assert.equal(stored.request.references[0].sha256, HASH_C);
  assert.equal(stored.request.providerRequest.assetPromptReferences[0].assetId, "location-dungeon");
  assert.equal(state.captures.pins.length, 2, "pins are checked before and immediately after asynchronous provider preparation");
});

test("pin drift during provider preparation marks the wrapper failed and never enqueues", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  let checks = 0;
  const state = harness(project, workflows, {
    assertPinsFn: () => {
      checks += 1;
      if (checks === 2) throw Object.assign(new Error("Pinned asset version changed"), { code: "PINNED_ASSET_VERSION_STALE" });
      return true;
    }
  });
  state.dependencies.prepareAudioGenerationRecordsFn = async (_slug, request) => {
    const current = state.getStore();
    const provenance = structuredClone(workflows.find((workflow) => workflow.id === request.profileId)?.workflowProvenance);
    current.sound.audioGenerations.push({ id: "audio-gen-stale", status: "queued", request: structuredClone(request), workflow: provenance });
    state.setStore(current);
    return {
      profileId: request.profileId,
      generationIds: ["audio-gen-stale"],
      workflowProvenance: provenance
    };
  };
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "Distant chains echo through @Dungeon",
    references: [{ display: "@Dungeon", assetId: "location-dungeon", assetVersion: 1, role: "location" }],
    options: { durationSec: 4 }
  }, state.dependencies), /Pinned asset version changed/);
  assert.equal(checks, 2);
  assert.equal(state.jobs.length, 0);
  const stored = state.getStore().promptGenerations.items[0];
  assert.equal(stored.status, "failed");
  assert.match(stored.lastError, /Pinned asset version changed/);
  const providerRecord = state.getStore().sound.audioGenerations.find((item) => item.id === "audio-gen-stale");
  assert.equal(providerRecord.status, "failed");
  assert.equal(providerRecord.error.code, "ASSET_PROMPT_PREPARATION_FAILED");
});

test("registry provenance drift during provider preparation fails closed before enqueue", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  const state = harness(project, workflows, {
    prepareAudioGenerationRecordsFn: async (_slug, request) => ({
      profileId: request.profileId,
      generationIds: ["audio-gen-drifted"],
      workflowProvenance: { sourceSha256: HASH_B, apiSha256: HASH_B, bindingSha256: HASH_C }
    })
  });
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "A low drone",
    references: [],
    options: { durationSec: 4 }
  }, state.dependencies), (error) =>
    error instanceof AssetPromptAudioError &&
    error.status === 409 &&
    error.code === "ASSET_PROMPT_WORKFLOW_PROVENANCE_STALE"
  );
  assert.equal(state.jobs.length, 0);
  assert.equal(state.getStore().promptGenerations.items[0].status, "failed");
});

test("stale exact reference versions return HTTP-conflict semantics", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  const state = harness(project, workflows);
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "Chains in @Dungeon",
    references: [{ display: "@Dungeon", assetId: "location-dungeon", assetVersion: 2, role: "location" }],
    options: { durationSec: 4 }
  }, state.dependencies), (error) =>
    error instanceof AssetPromptAudioError && error.status === 409 && error.code === "ASSET_PROMPT_REFERENCE_STALE"
  );
});

test("Dialogue accepts the typed speaker selector without an @ token and resolves only by exact assetId", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project);
  const state = harness(project, workflows);
  const result = await createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "dialogue",
    workflowId: STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID,
    prompt: "Whisper with restrained urgency",
    references: [],
    speakerReference: { assetId: "voice-adam", assetVersion: 1, token: "@AnythingClientClaims" },
    options: { sampleText: "We leave before dawn.", language: "en", style: "THIS MUST NOT OVERRIDE THE PRIMARY PROMPT" }
  }, state.dependencies);

  assert.equal(result.job.type, "generate_index_tts");
  assert.equal(state.captures.index[0].voiceId, "index-adam");
  assert.equal(state.captures.index[0].text, "We leave before dawn.");
  assert.equal(state.captures.index[0].style, "Whisper with restrained urgency");
  assert.equal(result.generation.options.style, undefined);
  assert.equal(result.generation.references.length, 1);
  assert.equal(result.generation.references[0].assetId, "voice-adam");
  assert.equal(result.generation.references[0].application, "provider-conditioning");
});

test("a post-enqueue bind failure cancels the provider job before surfacing the error", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project);
  const cancelled = [];
  const state = harness(project, workflows, {
    bindIndexTtsGenerationJobFn: () => { throw new Error("bind failed after enqueue"); },
    cancelJobFn: (jobId) => {
      cancelled.push(jobId);
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) job.status = "cancelled";
      return true;
    }
  });
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "dialogue",
    workflowId: STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID,
    prompt: "Quiet urgency",
    references: [],
    speakerReference: { assetId: "voice-adam", assetVersion: 1 },
    options: { sampleText: "We leave." }
  }, state.dependencies), /bind failed after enqueue/);
  assert.deepEqual(cancelled, ["job-1"]);
  assert.equal(state.jobs[0].status, "cancelled");
  assert.equal(state.getStore().promptGenerations.items[0].status, "failed");
});

test("Dialogue rejects hidden ordinary pins and provider mappings that only match a name", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project);
  const hidden = harness(project, workflows);
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "dialogue",
    workflowId: STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID,
    prompt: "Speak quietly",
    references: [{ display: "@Adam_Voice", assetId: "voice-adam", assetVersion: 1, role: "voice" }],
    options: { sampleText: "We leave." }
  }, hidden.dependencies), (error) => error instanceof AssetPromptAudioError && error.code === "ASSET_PROMPT_UNRESOLVED_MENTIONS");

  const nameOnly = fixtureProject({ indexVoice: false });
  nameOnly.sound.voices.push({ id: "index-adam", provider: "indexTts", name: "ADAM - Voice", referenceSha256: HASH_A, bytes: 12 });
  const nameOnlyCatalog = await catalog(nameOnly);
  const row = nameOnlyCatalog.find((workflow) => workflow.id === STANDALONE_INDEX_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(row.ready, false);
  assert.deepEqual(row.composerSchema.speakerReference.acceptedAssetIds, []);
});

test("VoiceDesign keeps voice description separate from sampleText and rejects a non-character association", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project);
  const voiceDesign = workflows.find((workflow) => workflow.id === STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID);
  assert.equal(voiceDesign.composerSchema.fields.find((field) => field.key === "sampleText")?.label, "Audition line");
  const state = harness(project, workflows);
  const result = await createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "voice-design",
    workflowId: STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID,
    prompt: "A warm, weathered voice for @Adam",
    references: [{ display: "@Adam", assetId: "character-adam", assetVersion: 1, role: "identity" }],
    options: { sampleText: "The light has come.", voiceName: "Adam" }
  }, state.dependencies);
  assert.equal(result.job.type, "generate_qwen_voice_design");
  assert.equal(state.captures.voiceDesign[0].instruct, "A warm, weathered voice for @Adam");
  assert.equal(state.captures.voiceDesign[0].auditionText, "The light has come.");
  assert.equal(state.captures.voiceDesign[0].characterId, "character-adam");

  const bad = harness(project, workflows);
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "voice-design",
    workflowId: STANDALONE_QWEN_VOICE_DESIGN_WORKFLOW_ID,
    prompt: "A voice for @Dungeon",
    references: [{ display: "@Dungeon", assetId: "location-dungeon", assetVersion: 1, role: "identity" }],
    options: { sampleText: "Listen." }
  }, bad.dependencies), /does not accept location assets/i);
});

test("project is reloaded after async catalog probing and concurrent identical requests create one provider record", async () => {
  const project = fixtureProject();
  const workflows = await catalog(project, [registryProfile()]);
  const state = harness(project, workflows);
  let providerCalls = 0;
  const originalCatalog = state.dependencies.getCatalogFn;
  state.dependencies.getCatalogFn = async (...args) => {
    const current = state.getStore();
    current.marker = "updated-during-readiness";
    state.setStore(current);
    await Promise.resolve();
    return originalCatalog(...args);
  };
  state.dependencies.prepareAudioGenerationRecordsFn = async (_slug, request) => {
    providerCalls += 1;
    await Promise.resolve();
    return {
      profileId: request.profileId,
      generationIds: ["audio-gen-once"],
      workflowProvenance: structuredClone(workflows.find((workflow) => workflow.id === request.profileId)?.workflowProvenance)
    };
  };
  const request = {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "A low ceremonial drone",
    references: [],
    options: { durationSec: 4 }
  };
  const [first, second] = await Promise.all([
    createAndEnqueueAssetPromptAudio(project.slug, request, state.dependencies),
    createAndEnqueueAssetPromptAudio(project.slug, request, state.dependencies)
  ]);
  assert.equal(providerCalls, 1);
  assert.equal(first.alreadyQueued, false);
  assert.equal(second.alreadyQueued, true);
  assert.equal(first.generation.id, second.generation.id);
  assert.equal(state.getStore().marker, "updated-during-readiness");
  assert.equal(state.getStore().promptGenerations.items.length, 1);
});

test("a new preparing wrapper is retained when the prompt-generation history is full of active work", async () => {
  const project = fixtureProject();
  project.promptGenerations.items = Array.from({ length: 250 }, (_value, index) => ({
    id: `active-${index}`,
    status: "queued",
    fingerprint: `fingerprint-${index}`
  }));
  const workflows = await catalog(project, [registryProfile()]);
  const state = harness(project, workflows);
  const result = await createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: "minimax-music-3",
    prompt: "A new active generation",
    references: [],
    options: { durationSec: 4 }
  }, state.dependencies);

  const stored = state.getStore().promptGenerations.items;
  assert.equal(stored.length, 251, "active records may exceed the soft history cap rather than trimming in-flight work");
  assert.ok(stored.some((item) => item.id === result.generation.id));
  assert.equal(stored.find((item) => item.id === result.generation.id).status, "queued");
});

test("strict runtime availability is required even when ready is true", async () => {
  const project = fixtureProject();
  const workflow = (await catalog(project, [registryProfile()])).find((item) => item.id === "minimax-music-3");
  workflow.availableNow = false;
  workflow.runtimeWarning = "GPU is occupied";
  const state = harness(project, [workflow]);
  await assert.rejects(() => createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "audio",
    workflowId: workflow.id,
    prompt: "Rain",
    references: [],
    options: {}
  }, state.dependencies), (error) => error instanceof AssetPromptAudioError && error.code === "ASSET_PROMPT_WORKFLOW_NOT_READY");
  assert.equal(state.captures.audio.length, 0);
});

test("Qwen Base Dialogue dispatches through its existing worker contract", async () => {
  const project = fixtureProject({ indexVoice: false, qwenVoice: true });
  const workflows = await catalog(project);
  const qwen = workflows.find((workflow) => workflow.id === STANDALONE_QWEN_TTS_DIALOGUE_WORKFLOW_ID);
  assert.equal(qwen.ready, true);
  const state = harness(project, workflows);
  const result = await createAndEnqueueAssetPromptAudio(project.slug, {
    outputMode: "dialogue",
    workflowId: STANDALONE_QWEN_TTS_DIALOGUE_WORKFLOW_ID,
    prompt: "Measured and close-mic",
    speakerReference: { assetId: "voice-adam", assetVersion: 1 },
    references: [],
    options: { sampleText: "We leave before dawn.", temperature: 0.7 }
  }, state.dependencies);
  assert.equal(result.job.type, "generate_qwen_tts");
  assert.equal(state.captures.qwen[0].voiceId, "qwen-adam");
  assert.equal(state.captures.qwen[0].temperature, 0.7);
});

test("server route combines catalogs and preserves the visual fallback branch", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /getAssetPromptAudioWorkflowCatalog\(project\)/);
  assert.match(source, /combineAssetPromptWorkflowCatalog\(visualWorkflows, audioWorkflows\)/);
  assert.match(source, /app\.post\("\/api\/projects\/:slug\/prompt-generations", requireLocalSameOriginMutation,/);
  assert.match(source, /isAssetPromptAudioRequest\(body\)/);
  assert.match(source, /createAndEnqueueAssetPromptAudio\(req\.params\.slug/);
  assert.match(source, /cancelJobFn: cancelJob/);
  assert.match(source, /createAndEnqueuePromptGeneration\(req\.params\.slug/);
});

test("provider completion synchronizes the prompt wrapper and cannot be downgraded by a late event", () => {
  let project = fixtureProject();
  project.promptGenerations.items.push({
    id: "prompt-audio-1",
    status: "queued",
    backend: { kind: "comfy-audio", providerGenerationIds: ["audio-gen-1"] },
    result: null,
    lastError: null
  });
  const options = {
    loadProjectFn: () => structuredClone(project),
    saveProjectFn: (next) => { project = structuredClone(next); return project; }
  };

  const completed = finalizeAssetPromptAudioGeneration("audio_test", "prompt-audio-1", {
    status: "generated",
    jobId: "job-provider-1",
    result: { assetIds: ["sound-asset-1"], outputFiles: ["music.mp3"] }
  }, options);
  assert.equal(completed.generation.status, "generated");
  assert.equal(completed.generation.result.provider, "comfy-audio");
  assert.deepEqual(completed.generation.result.providerResult.assetIds, ["sound-asset-1"]);
  const persisted = project.promptGenerations.items[0];
  assert.equal(persisted.jobId, "job-provider-1");
  assert.ok(persisted.finishedAt);

  const lateFailure = finalizeAssetPromptAudioGeneration("audio_test", "prompt-audio-1", {
    status: "failed",
    error: new Error("late worker notification")
  }, options);
  assert.equal(lateFailure.generation.status, "generated");
  assert.equal(lateFailure.generation.lastError, null);
});

test("provider cancellation synchronizes both queued jobs and their prompt wrapper", () => {
  let project = fixtureProject();
  project.promptGenerations.items.push({
    id: "prompt-dialogue-1",
    status: "queued",
    backend: { kind: "index-tts", providerGenerationId: "index-generation-1" }
  });
  const options = {
    loadProjectFn: () => structuredClone(project),
    saveProjectFn: (next) => { project = structuredClone(next); return project; }
  };
  const cancelled = finalizeAssetPromptAudioGeneration("audio_test", "prompt-dialogue-1", {
    status: "cancelled",
    jobId: "job-dialogue-1"
  }, options);
  assert.equal(cancelled.generation.status, "cancelled");
  assert.equal(cancelled.generation.lastError, null);
  assert.equal(project.promptGenerations.items[0].jobId, "job-dialogue-1");
});

test("provider queue success, failure, and cancellation paths all finalize composer wrappers", () => {
  const source = fs.readFileSync(new URL("../server/queue.js", import.meta.url), "utf8");
  assert.match(source, /finalizeAssetPromptAudioGeneration\(next\.projectSlug, next\.refs\.promptGenerationId,[\s\S]*?status: "generated"/);
  assert.match(source, /status: cancelled \? "cancelled" : "failed"/);
  assert.match(source, /finalizeAssetPromptAudioGeneration\(j\.projectSlug, j\.refs\.promptGenerationId,[\s\S]*?status: "cancelled"/);
});
