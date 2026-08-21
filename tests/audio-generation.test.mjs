import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  compileAudioWorkflowPrompt,
  markAudioGenerationCancelled,
  markAudioGenerationFailed,
  normalizeAudioGenerationRequest,
  prepareAudioGenerationRecords,
  runAudioGenerationJob
} from "../server/audio-generation.js";
import { gpuLeaseStatus, resetGpuLeaseForTests } from "../server/gpu-resource-manager.js";
import { projectDir } from "../server/paths.js";

function evaluatedProfile() {
  return {
    id: "music.test.v1",
    displayName: "Test Music",
    category: "music",
    role: "generator",
    engine: "Test Engine",
    modelFamily: "Test Model",
    source: { sha256: "source-hash" },
    api: { sha256: "api-hash" },
    bindingSha256: "binding-hash",
    duration: { min: 1, max: 20 },
    readiness: { ready: true, status: "ready", label: "Ready" },
    _manifest: {
      category: "music",
      inputNodeBindings: {
        prompt: { nodeId: "1", inputName: "text", type: "STRING" },
        durationSeconds: { nodeId: "1", inputName: "seconds", type: "FLOAT" },
        seed: { nodeId: "1", inputName: "seed", type: "INT" }
      },
      outputNodeBindings: [{ nodeId: "2", inputName: "audio", historyOutput: "audio" }]
    },
    _prompt: {
      "1": { class_type: "TestAudio", inputs: { text: "native", seconds: 2, seed: 1, sampler: "native-untouched" } },
      "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0] } }
    }
  };
}

function inMemoryProject(slug) {
  let current = { slug, sound: { schemaVersion: 1, voices: [{ id: "legacy-voice" }], generations: [] } };
  return {
    load: () => structuredClone(current),
    save: (project) => { current = structuredClone(project); return project; },
    read: () => structuredClone(current)
  };
}

test("compiler folds rich unsupported controls into text and overrides only manifest-bound inputs", () => {
  const profile = evaluatedProfile();
  const result = compileAudioWorkflowPrompt(profile, {
    profileId: profile.id,
    category: "music",
    prompt: "A tense chase cue",
    genre: "orchestral",
    bpm: 132,
    instrumentation: ["strings", "brass"],
    durationSec: 8,
    seed: 42
  });
  assert.match(result.compiledPrompt, /Tempo BPM: 132/);
  assert.match(result.compiledPrompt, /Instrumentation: strings, brass/);
  assert.equal(result.prompt["1"].inputs.seconds, 8);
  assert.equal(result.prompt["1"].inputs.seed, 42);
  assert.equal(result.prompt["1"].inputs.sampler, "native-untouched");
  assert.deepEqual(result.overrides.map((item) => item.input).sort(), ["seconds", "seed", "text"]);
});

test("duration above a workflow maximum requires explicit segmentation instead of clamping", () => {
  assert.throws(() => compileAudioWorkflowPrompt(evaluatedProfile(), {
    profileId: "music.test.v1", category: "music", prompt: "long cue", durationSec: 25
  }), (error) => error.code === "AUDIO_SEGMENTATION_REQUIRED" && error.segments.length === 2);
});

test("UI FormData JSON envelope normalizes sound_effect, generation fields, and association without false overrides", () => {
  const normalized = normalizeAudioGenerationRequest({
    profileId: "sound.test", category: "sound_effect",
    parameters: {
      name: "Door", prompt: "compiled door slam", originalPrompt: "door slam", durationSec: 3, sourceMode: "text-foley",
      seed: 77, variationCount: 2, association: { sceneId: "scene-9", clipId: "clip-2", fadeInSec: 0.1 },
      advanced: { outputQuality: "V0" }
    }
  }, { category: "sound effect", duration: null });
  assert.equal(normalized.category, "foley");
  assert.equal(normalized.prompt, "compiled door slam");
  assert.equal(normalized.originalPrompt, "door slam");
  assert.equal(normalized.name, "Door");
  assert.equal(normalized.durationSec, 3);
  assert.equal(normalized.seed, 77);
  assert.equal(normalized.variationCount, 2);
  assert.equal(normalized.associations.sceneId, "scene-9");
  assert.equal(normalized.editorial.fadeInSec, 0.1);
  assert.deepEqual(normalized.parameters, { outputQuality: "V0" });
});

test("injected Comfy lifecycle persists prompt/progress/native output metadata and asset registration", async () => {
  resetGpuLeaseForTests();
  const slug = `audio_generation_fixture_${Date.now()}`;
  const store = inMemoryProject(slug);
  const profile = evaluatedProfile();
  const options = {
    loadProjectFn: store.load,
    saveProjectFn: store.save,
    getProfileFn: async () => profile,
    runPromptFn: async (prompt, callbacks) => {
      assert.equal(prompt["1"].inputs.sampler, "native-untouched");
      callbacks.onSubmitted({ promptId: "prompt-real-1" });
      callbacks.onProgress({ value: 1, max: 2, nodeId: "1", promptId: "prompt-real-1" });
      return { "2": { audio: [{ filename: "native.mp3", subfolder: "", type: "output" }] } };
    },
    downloadOutputFn: async (ref, destinationDir, destinationStem) => {
      fs.mkdirSync(destinationDir, { recursive: true });
      const name = `${destinationStem}${path.extname(ref.filename)}`;
      fs.writeFileSync(path.join(destinationDir, name), Buffer.from("native-audio-bytes"));
      return name;
    },
    probeMediaFn: async () => ({ durationSec: 4.25, audio: { sample_rate: "48000", channels: 2, codec_name: "mp3" } }),
    progressPersistIntervalMs: 0
  };
  try {
    const job = await prepareAudioGenerationRecords(slug, {
      profileId: profile.id, category: "music", name: "Cue", prompt: "cinematic cue", durationSec: 4, seed: 9,
      associations: { sceneId: "scene-7" }
    }, options);
    const result = await runAudioGenerationJob(job, options);
    assert.equal(result.results.length, 1);
    const project = store.read();
    assert.deepEqual(project.sound.voices, [{ id: "legacy-voice" }]);
    assert.deepEqual(project.sound.generations, []);
    const generation = project.sound.audioGenerations[0];
    assert.equal(generation.status, "completed");
    assert.equal(generation.promptId, "prompt-real-1");
    assert.equal(generation.assetIds.length, 1);
    const asset = project.sound.assets[0];
    assert.match(asset.media.path, /^media\/audio\/music\//);
    assert.equal(asset.media.bytes, 18);
    assert.equal(asset.media.native, true);
    assert.equal(asset.media.durationSec, 4.25);
    assert.equal(asset.associations.sceneId, "scene-7");
    assert.equal(asset.provenance.comfy.promptId, "prompt-real-1");
    assert.equal(gpuLeaseStatus(), null);
  } finally {
    resetGpuLeaseForTests();
    fs.rmSync(projectDir(slug), { recursive: true, force: true });
  }
});

test("execution rejects current registry provenance drift before compile or Comfy submission", async () => {
  resetGpuLeaseForTests();
  const slug = `audio_generation_profile_drift_${Date.now()}`;
  const store = inMemoryProject(slug);
  const queuedProfile = evaluatedProfile();
  const currentProfile = structuredClone(queuedProfile);
  currentProfile.source.sha256 = "source-hash-changed";
  let profileLoads = 0;
  let submitted = false;
  const options = {
    loadProjectFn: store.load,
    saveProjectFn: store.save,
    getProfileFn: async () => profileLoads++ === 0 ? queuedProfile : currentProfile,
    runPromptFn: async () => { submitted = true; throw new Error("must not submit"); }
  };

  const job = await prepareAudioGenerationRecords(slug, {
    profileId: queuedProfile.id,
    category: "music",
    prompt: "immutable cue",
    durationSec: 2
  }, options);
  assert.deepEqual(job.expectedWorkflow, {
    profileId: queuedProfile.id,
    sourceSha256: "source-hash",
    apiSha256: "api-hash",
    bindingSha256: "binding-hash"
  });
  await assert.rejects(runAudioGenerationJob(job, options), (error) =>
    error.code === "AUDIO_WORKFLOW_PROVENANCE_STALE" && error.statusCode === 409
  );
  assert.equal(submitted, false);
  assert.equal(store.read().sound.audioGenerations[0].status, "queued");
  assert.equal(store.read().sound.audioGenerations[0].workflow.sourceSha256, "source-hash");
  assert.equal(gpuLeaseStatus(), null);

  options.getProfileFn = async () => {
    throw Object.assign(new Error("profile removed"), { statusCode: 404, code: "AUDIO_WORKFLOW_NOT_FOUND" });
  };
  await assert.rejects(runAudioGenerationJob(job, options), (error) =>
    error.code === "AUDIO_WORKFLOW_PROVENANCE_STALE" && error.statusCode === 409
  );
  assert.equal(submitted, false);
});

test("execution rejects any queued generation record whose workflow snapshot drifted", async () => {
  resetGpuLeaseForTests();
  const slug = `audio_generation_record_drift_${Date.now()}`;
  const store = inMemoryProject(slug);
  const profile = evaluatedProfile();
  let submitted = false;
  const options = {
    loadProjectFn: store.load,
    saveProjectFn: store.save,
    getProfileFn: async () => profile,
    runPromptFn: async () => { submitted = true; throw new Error("must not submit"); }
  };
  const job = await prepareAudioGenerationRecords(slug, {
    profileId: profile.id,
    category: "music",
    prompt: "two immutable variations",
    durationSec: 2,
    variationCount: 2
  }, options);
  const project = store.read();
  project.sound.audioGenerations[1].workflow.bindingSha256 = "binding-hash-changed";
  store.save(project);

  await assert.rejects(runAudioGenerationJob(job, options), (error) =>
    error.code === "AUDIO_WORKFLOW_PROVENANCE_STALE" &&
    error.statusCode === 409 &&
    error.generationId === job.generationIds[1]
  );
  assert.equal(submitted, false);
  assert.deepEqual(store.read().sound.audioGenerations.map((generation) => generation.status), ["queued", "queued"]);
  assert.equal(gpuLeaseStatus(), null);
});

test("jobs without top-level provenance use record snapshots while truly legacy records remain compatible", async () => {
  resetGpuLeaseForTests();
  const slug = `audio_generation_legacy_provenance_${Date.now()}`;
  const store = inMemoryProject(slug);
  const queuedProfile = evaluatedProfile();
  const changedProfile = structuredClone(queuedProfile);
  changedProfile.api.sha256 = "api-hash-changed";
  let profileLoads = 0;
  let submitted = false;
  const options = {
    loadProjectFn: store.load,
    saveProjectFn: store.save,
    getProfileFn: async () => profileLoads++ === 0 ? queuedProfile : changedProfile,
    runPromptFn: async () => { submitted = true; throw Object.assign(new Error("legacy reached runner"), { code: "LEGACY_RUNNER_REACHED" }); }
  };
  const job = await prepareAudioGenerationRecords(slug, {
    profileId: queuedProfile.id,
    category: "music",
    prompt: "legacy cue",
    durationSec: 2,
    variationCount: 2
  }, options);
  delete job.expectedWorkflow;

  await assert.rejects(runAudioGenerationJob(job, options), (error) =>
    error.code === "AUDIO_WORKFLOW_PROVENANCE_STALE" && error.statusCode === 409
  );
  assert.equal(submitted, false, "stored generation provenance protects older Create Sound queue envelopes");

  options.getProfileFn = async () => queuedProfile;
  const mixedProject = store.read();
  delete mixedProject.sound.audioGenerations[0].workflow;
  store.save(mixedProject);
  await assert.rejects(runAudioGenerationJob(job, options), (error) =>
    error.code === "AUDIO_WORKFLOW_PROVENANCE_STALE" && error.generationId === job.generationIds[0]
  );
  assert.equal(submitted, false, "one incomplete record cannot disable protection for the other queued variations");

  const legacyProject = store.read();
  for (const generation of legacyProject.sound.audioGenerations) {
    delete generation.workflow;
    generation.status = "queued";
    generation.error = null;
  }
  store.save(legacyProject);
  await assert.rejects(runAudioGenerationJob(job, options), (error) => error.code === "LEGACY_RUNNER_REACHED");
  assert.equal(submitted, true, "records created before workflow snapshots retain their former execution behavior");
  assert.equal(gpuLeaseStatus(), null);
});

test("Comfy completion without audio output persists failure and never reports mock success", async () => {
  resetGpuLeaseForTests();
  const slug = `audio_generation_failure_${Date.now()}`;
  const store = inMemoryProject(slug);
  const profile = evaluatedProfile();
  const options = {
    loadProjectFn: store.load,
    saveProjectFn: store.save,
    getProfileFn: async () => profile,
    runPromptFn: async (_prompt, callbacks) => { callbacks.onSubmitted({ promptId: "prompt-empty" }); return {}; }
  };
  const job = await prepareAudioGenerationRecords(slug, { profileId: profile.id, category: "music", prompt: "cue", durationSec: 2 }, options);
  await assert.rejects(runAudioGenerationJob(job, options), (error) => error.code === "AUDIO_OUTPUT_MISSING");
  const generation = store.read().sound.audioGenerations[0];
  assert.equal(generation.status, "failed");
  assert.equal(generation.error.code, "AUDIO_OUTPUT_MISSING");
  assert.equal(gpuLeaseStatus(), null);
});

test("failure and cancellation preserve completed variations while transitioning queued and running siblings", () => {
  const slug = `audio_generation_terminal_guard_${Date.now()}`;
  let current = {
    slug,
    sound: {
      schemaVersion: 2,
      voices: [],
      generations: [],
      audioGenerations: [
        { id: "variation-completed", status: "completed", completedAt: "2026-08-20T12:00:00.000Z", assetIds: ["asset-1"], error: null },
        { id: "variation-queued", status: "queued", error: null },
        { id: "variation-running", status: "running", promptId: "prompt-running", error: null }
      ]
    }
  };
  const options = {
    loadProjectFn: () => structuredClone(current),
    saveProjectFn: (project) => { current = structuredClone(project); return project; }
  };
  const completedBefore = structuredClone(current.sound.audioGenerations[0]);

  markAudioGenerationFailed(slug, "variation-completed", Object.assign(new Error("late queue failure"), { code: "LATE_FAILURE" }), options);
  markAudioGenerationCancelled(slug, "variation-completed", options);
  markAudioGenerationFailed(slug, "variation-queued", Object.assign(new Error("provider failed"), { code: "PROVIDER_FAILED" }), options);
  markAudioGenerationCancelled(slug, "variation-running", options);

  const [completed, queued, running] = current.sound.audioGenerations;
  assert.deepEqual(completed, completedBefore);
  assert.equal(queued.status, "failed");
  assert.equal(queued.error.code, "PROVIDER_FAILED");
  assert.ok(queued.failedAt);
  assert.equal(running.status, "cancelled");
  assert.equal(running.error.code, "GENERATION_CANCELLED");
  assert.ok(running.cancelledAt);
});
