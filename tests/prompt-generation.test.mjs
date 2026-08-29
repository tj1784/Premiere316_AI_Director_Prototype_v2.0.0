import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAssetMentionOptions } from "../client/src/asset-prompt.js";
import { ASSET_WORKFLOWS, buildAssetPackage, compileAssetWorkflow, saveAssetPackageFiles } from "../server/assets.js";
import {
  STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
  STORYBOARD_LTX25_GENERATION_WORKFLOW_ID
} from "../server/generation-composer.js";
import { storyboardRuntimeProbeGraphs } from "../server/storyboard-generation.js";
import {
  PROMPT_GENERATION_SCHEMA,
  assertPinnedReferencesCurrent,
  buildServerAssetMentionOptions,
  createAndEnqueuePromptGeneration,
  createPromptGeneration,
  deriveUnresolvedPromptMentions,
  generatePromptAssetJob,
  getPromptGenerationWorkflowCatalog,
  markPromptGenerationFailed,
  normalizePromptGenerationPayload,
  promptComposerAssetProvenanceChanges,
  registerPromptOutput,
  restorePromptGenerationAfterCancellation
} from "../server/prompt-generation.js";

const HASH = "a".repeat(64);
const FIXTURE_PROJECTS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-prompt-generation-projects-"));
test.after(() => fs.rmSync(FIXTURE_PROJECTS_ROOT, { recursive: true, force: true }));

function visualAsset({
  id,
  name,
  variant = "Appearance",
  category = "character",
  mediaType = "image",
  version = 1,
  file = `${id}.v${version}.png`
}) {
  return {
    id,
    name,
    variant,
    category,
    mediaType,
    activeVersion: version,
    versions: [{
      v: version,
      file,
      files: [file],
      mediaType,
      fileHashes: [{ file, sha256: HASH, bytes: 1, extension: path.extname(file) }]
    }]
  };
}

const adam = visualAsset({
  id: "character-adam",
  name: "ADAM - First Man Freed",
  file: "character_adam.v1.png"
});
const eve = visualAsset({
  id: "character-eve",
  name: "EVE - First Woman Freed",
  file: "character_eve.v1.png"
});
const adamWardrobe = visualAsset({
  id: "wardrobe-adam",
  name: "ADAM - Linen Tunic",
  variant: "Primary",
  category: "wardrobe",
  file: "wardrobe_adam.v1.png"
});
const adamVoice = visualAsset({
  id: "voice-adam-a",
  name: "ADAM - Voice Design",
  variant: "Voice Design",
  category: "voice",
  mediaType: "audio",
  file: "voice_adam.v1.wav"
});

function baseProject(assets = []) {
  const items = structuredClone(assets);
  const assetRoot = path.join(FIXTURE_PROJECTS_ROOT, "prompt-generation-test", "media", "assets");
  for (const asset of items) {
    for (const version of asset.versions || []) {
      const files = version.files || (version.file ? [version.file] : []);
      version.fileHashes = files.map((file) => {
        const relative = String(file).replace(/\\/g, "/");
        const contents = Buffer.from(`${asset.id}:v${version.v}:${relative}`, "utf8");
        const diskPath = path.join(assetRoot, ...relative.split("/"));
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, contents);
        return {
          file: relative,
          sha256: crypto.createHash("sha256").update(contents).digest("hex"),
          bytes: contents.byteLength,
          extension: path.extname(relative)
        };
      });
    }
  }
  return {
    slug: "prompt-generation-test",
    name: "Prompt Generation Test",
    projectsRoot: FIXTURE_PROJECTS_ROOT,
    settings: {
      fps: 24,
      width: 1280,
      height: 720,
      skipApproval: true,
      skipScreenplay: true
    },
    screenplay: null,
    assets: {
      schemaVersion: 1,
      screenplayHash: null,
      items,
      deletedItems: [],
      counts: {},
      total: assets.length
    }
  };
}

async function readyCatalog() {
  const objectInfo = new Proxy({}, { get: () => ({}) });
  return getPromptGenerationWorkflowCatalog({
    objectInfo,
    assetWorkflowCatalog: [{
      id: "krea2-cinematic-still-fp8",
      ready: true,
      availableNow: true
    }]
  });
}

function videoBody(prompt = "Adam and Eve sleeping") {
  return {
    schema: "premiere316.asset-prompt.v1",
    outputMode: "video",
    workflowId: STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
    prompt,
    references: [],
    settings: { aspectRatio: "16:9", durationSec: 2 }
  };
}

test("server handle allocation exactly matches client suffix, variant, and number collisions", () => {
  const collidingAssets = [
    visualAsset({ id: "voice-adam-c", name: "ADAM - Default Voice", variant: "Voice Design", category: "voice", mediaType: "audio", file: "voice-c.wav" }),
    adamWardrobe,
    visualAsset({ id: "voice-adam-b", name: "ADAM - Whisper Voice", variant: "Whisper", category: "voice", mediaType: "audio", file: "voice-b.wav" }),
    adam,
    adamVoice
  ];
  const client = buildAssetMentionOptions(collidingAssets).map(({ assetId, handle }) => ({ assetId, handle }));
  const server = buildServerAssetMentionOptions(collidingAssets).map(({ assetId, handle }) => ({ assetId, handle }));
  assert.deepEqual(server, client);
  assert.deepEqual(Object.fromEntries(server.map((item) => [item.assetId, item.handle])), {
    "character-adam": "@Adam",
    "wardrobe-adam": "@Adam_Wardrobe",
    "voice-adam-a": "@Adam_Voice",
    "voice-adam-b": "@Adam_Voice_Whisper",
    "voice-adam-c": "@Adam_Voice_2"
  });
});

test("server resolves canonical, category-suffixed, and file-style mentions from exact submitted pins", () => {
  const project = baseProject([adamVoice, adamWardrobe, eve, adam]);
  const references = [
    { token: "@Adam", assetId: adam.id, assetVersion: 1, role: "identity" },
    { token: "@Adam_Voice", assetId: adamVoice.id, assetVersion: 1, role: "voice" },
    { token: "@Adam_Wardrobe", assetId: adamWardrobe.id, assetVersion: 1, role: "wardrobe" }
  ];
  const unresolved = deriveUnresolvedPromptMentions(
    project,
    "@Adam and @character_Adam.png rest in @Adam_Wardrobe while @Adam_Voice narrates",
    references
  );
  assert.deepEqual(unresolved, []);
});

test("server rejects a forged display token bound to an unrelated asset", () => {
  const project = baseProject([adam, eve]);
  const unresolved = deriveUnresolvedPromptMentions(project, "@Adam dances", [
    { token: "@Adam", assetId: eve.id, assetVersion: 1, role: "identity" }
  ]);
  assert.ok(unresolved.some((item) =>
    item.reason === "reference_display_asset_mismatch" &&
    item.assetId === eve.id &&
    item.resolvedAssetId === adam.id
  ));
  assert.ok(unresolved.some((item) => item.reason === "unbound" && item.display === "@Adam"));
});

test("frontend payload normalization discards client paths and hashes and derives unresolved mentions server-side", () => {
  const project = baseProject([adam, eve]);
  const normalized = normalizePromptGenerationPayload(project, {
    outputMode: "video",
    workflowId: STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
    prompt: "@Adam dancing with @Eve",
    references: [{
      token: "@Adam",
      assetId: adam.id,
      assetVersion: 1,
      role: "character",
      order: 1,
      file: "C:\\forged\\adam.png",
      sha256: "f".repeat(64),
      mediaType: "video",
      approved: true
    }],
    settings: { aspectRatio: "16:9", durationSec: 8 }
  });
  assert.equal(normalized.outputKind, "video");
  assert.deepEqual(normalized.options, { durationSec: 8, fps: 24, width: 768, height: 448 });
  assert.deepEqual(Object.keys(normalized.references[0]).sort(), [
    "assetId", "assetVersion", "display", "mentionId", "notes", "order", "required", "role"
  ]);
  assert.equal(normalized.references[0].display, "@Adam");
  assert.deepEqual(normalized.unresolvedMentions.map((item) => item.display), ["@Eve"]);
});

test("file-style aliases canonicalize to the server handle and hidden pins fail closed", () => {
  const project = baseProject([adam, eve]);
  const alias = normalizePromptGenerationPayload(project, {
    outputMode: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    prompt: "@character_Adam.png sleeping",
    references: [{ token: "@character_Adam.png", assetId: adam.id, assetVersion: 1, role: "identity", order: 1 }],
    settings: { aspectRatio: "16:9" }
  });
  assert.deepEqual(alias.unresolvedMentions, []);
  assert.equal(alias.references[0].display, "@Adam");

  const hidden = normalizePromptGenerationPayload(project, {
    outputMode: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    prompt: "@Adam sleeping",
    references: [
      { token: "@Adam", assetId: adam.id, assetVersion: 1, role: "identity", order: 1 },
      { token: "@Eve", assetId: eve.id, assetVersion: 1, role: "identity", order: 2 }
    ],
    settings: { aspectRatio: "16:9" }
  });
  assert.ok(hidden.unresolvedMentions.some((item) =>
    item.display === "@Eve" && item.reason === "reference_display_not_in_prompt"
  ));
});

test("runtime catalog exposes only compiler-backed image/video adapters as ready", async () => {
  const catalog = await readyCatalog();
  for (const id of [STORYBOARD_KREA_GENERATION_WORKFLOW_ID, STORYBOARD_LTX25_GENERATION_WORKFLOW_ID]) {
    const workflow = catalog.find((item) => item.id === id);
    assert.equal(workflow.ready, true);
    assert.equal(workflow.availableNow, true);
  }
  const voice = catalog.find((item) => item.id === "qwen3-tts-voice-design-1.7b");
  assert.equal(voice.ready, false);
  assert.match(voice.reason, /not connected to the prompt-composer queue/i);
  const recipe = catalog.find((item) => item.id === "ltx-2.3-native-audio");
  assert.equal(recipe.ready, false);
  assert.match(recipe.reason, /recipe-only|no standalone generation compiler/i);
});

test("storyboard probes use the active Krea and LTX model combo identifiers", () => {
  const probes = storyboardRuntimeProbeGraphs();
  const kreaUnet = probes.image.nodes.find((node) => node.type === "UNETLoader");
  const kreaClip = probes.image.nodes.find((node) => node.type === "CLIPLoader");
  const ltxPreset = probes.video.nodes.find((node) => node.type === "DenoLTX23PresetLoader");
  assert.equal(kreaUnet?.widgets_values?.[0], "KREA 2\\krea2_turbo_bf16.safetensors");
  assert.equal(kreaClip?.widgets_values?.[0], "qwen3vl_4b_bf16.safetensors");
  assert.equal(ltxPreset?.widgets_values?.[6], "gemma_3_12B_it_fp8_e4m3fn.safetensors");
  assert.equal(ltxPreset?.widgets_values?.[7], "ltx-2.3_text_projection_bf16.safetensors");
});

test("the stable Krea Asset Foundry IDs compile with accurately labeled BF16 models", () => {
  const workflow = ASSET_WORKFLOWS.find((item) => item.id === "krea2-cinematic-still-fp8");
  assert.equal(workflow?.label, "Krea 2 Cinematic Still · BF16");
  assert.equal(workflow?.model, "Krea 2 Turbo BF16 + Qwen3-VL 4B BF16");
  const compiled = compileAssetWorkflow(baseProject(), {
    id: "test-krea-asset",
    category: "guide-frame",
    variant: "Production Reference",
    prompt: "A safe compile-only test",
    workflowId: "krea2-cinematic-still-fp8",
    seed: 7
  });
  assert.equal(compiled?.["1"]?.inputs?.unet_name, "KREA 2\\krea2_turbo_bf16.safetensors");
  assert.equal(compiled?.["2"]?.inputs?.clip_name, "qwen3vl_4b_bf16.safetensors");
});

test("catalog readiness validates every flattened node and active model combo value", async () => {
  const probes = storyboardRuntimeProbeGraphs();
  assert.ok(probes.video.nodes.some((node) => node.type === "DenoLTXPromptGuide"));
  const allTypes = new Set([...probes.image.nodes, ...probes.video.nodes].map((node) => node.type));
  const objectInfo = Object.fromEntries([...allTypes].map((type) => [type, { input: { required: {}, optional: {} } }]));
  delete objectInfo.DenoLTXPromptGuide;
  const missingCatalog = await getPromptGenerationWorkflowCatalog({
    objectInfo,
    assetWorkflowCatalog: [{ id: "krea2-cinematic-still-fp8", ready: true, availableNow: true }]
  });
  const missingVideo = missingCatalog.find((item) => item.id === STORYBOARD_LTX25_GENERATION_WORKFLOW_ID);
  assert.equal(missingVideo.ready, false);
  assert.match(missingVideo.reason, /DenoLTXPromptGuide/);

  objectInfo.DenoLTXPromptGuide = { input: { required: {}, optional: {} } };
  objectInfo.UNETLoader = {
    input: { required: { unet_name: [["definitely-not-the-required-model.safetensors"]] }, optional: {} }
  };
  const comboCatalog = await getPromptGenerationWorkflowCatalog({
    objectInfo,
    assetWorkflowCatalog: [{ id: "krea2-cinematic-still-fp8", ready: true, availableNow: true }]
  });
  const comboVideo = comboCatalog.find((item) => item.id === STORYBOARD_LTX25_GENERATION_WORKFLOW_ID);
  assert.equal(comboVideo.ready, false);
  assert.match(comboVideo.reason, /model\/combo values|unet_name/i);
});

test("create persists immutable request state and dedupes the full active fingerprint", async () => {
  const catalog = await readyCatalog();
  const project = baseProject();
  let saved = null;
  const created = createPromptGeneration(project, videoBody(), {
    workflows: catalog,
    id: "generation-video-one",
    now: "2026-08-20T12:00:00.000Z",
    saveProjectFn: (next) => { saved = structuredClone(next); }
  });
  assert.equal(created.generation.status, "queued");
  assert.equal(created.generation.outputMode, "video");
  assert.equal(saved.promptGenerations.schema, PROMPT_GENERATION_SCHEMA);
  const stored = saved.promptGenerations.items[0];
  assert.equal(stored.fingerprint, created.generation.fingerprint);
  assert.equal(stored.request.promptText, "Adam and Eve sleeping");
  assert.deepEqual(stored.request.references, []);

  let duplicateSaveCalled = false;
  const duplicateJob = {
    id: "job-existing",
    projectSlug: project.slug,
    type: "generate_prompt_asset",
    status: "queued",
    refs: { generationId: stored.id, requestFingerprint: stored.fingerprint }
  };
  const duplicate = createPromptGeneration(saved, videoBody(), {
    workflows: catalog,
    activeJobs: [duplicateJob],
    saveProjectFn: () => { duplicateSaveCalled = true; }
  });
  assert.equal(duplicate.alreadyQueued, true);
  assert.equal(duplicate.job.id, duplicateJob.id);
  assert.equal(duplicateSaveCalled, false);
});

test("compiler-consumed reference notes change the generation fingerprint", async () => {
  const catalog = await readyCatalog();
  const project = baseProject([adam]);
  const body = (notes) => ({
    outputMode: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    prompt: "@Adam sleeping",
    references: [{ token: "@Adam", assetId: adam.id, assetVersion: 1, role: "identity", order: 1, notes }],
    settings: { aspectRatio: "16:9" }
  });
  const left = createPromptGeneration(project, body("camera-left profile"), {
    workflows: catalog,
    saveProjectFn: () => {},
    assertPinsFn: () => true
  });
  const right = createPromptGeneration(project, body("camera-right profile"), {
    workflows: catalog,
    saveProjectFn: () => {},
    assertPinsFn: () => true
  });
  assert.notEqual(left.generation.fingerprint, right.generation.fingerprint);
  assert.equal(left.generation.references[0].display, "@Adam");
});

test("concurrent identical creates serialize save and enqueue around one canonical generation", async () => {
  const catalog = await readyCatalog();
  let memory = baseProject();
  const jobs = [];
  let saveCount = 0;
  let catalogWaiters = 0;
  let releaseCatalog;
  const catalogBarrier = new Promise((resolve) => { releaseCatalog = resolve; });
  const dependencies = {
    getCatalogFn: async () => {
      catalogWaiters += 1;
      if (catalogWaiters === 2) releaseCatalog();
      await catalogBarrier;
      return catalog;
    },
    loadProjectFn: () => structuredClone(memory),
    saveProjectFn: (project) => {
      saveCount += 1;
      memory = structuredClone(project);
    },
    listJobsFn: () => structuredClone(jobs),
    enqueueFn: (input) => {
      const existing = jobs.find((job) =>
        job.projectSlug === input.projectSlug &&
        job.type === input.type &&
        job.refs.requestFingerprint === input.refs.requestFingerprint &&
        ["queued", "running", "cancelling"].includes(job.status)
      );
      if (existing) return existing;
      const job = { id: `job-${jobs.length + 1}`, status: "queued", ...structuredClone(input) };
      jobs.push(job);
      return job;
    }
  };
  const [first, second] = await Promise.all([
    createAndEnqueuePromptGeneration(memory.slug, videoBody(), dependencies),
    createAndEnqueuePromptGeneration(memory.slug, videoBody(), dependencies)
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(memory.promptGenerations.items.length, 1);
  assert.equal(first.generation.id, second.generation.id);
  assert.equal(first.job.id, second.job.id);
  assert.deepEqual([first.alreadyQueued, second.alreadyQueued].sort(), [false, true]);
  assert.equal(saveCount, 1);
  assert.equal(jobs[0].refs.generationId, memory.promptGenerations.items[0].id);
});

test("create refuses catalog adapters that are honestly unavailable", async () => {
  const catalog = await readyCatalog();
  assert.throws(
    () => createPromptGeneration(baseProject(), {
      outputMode: "voice-design",
      workflowId: "qwen3-tts-voice-design-1.7b",
      prompt: "A weathered but compassionate voice",
      references: [],
      settings: { durationSec: 8 }
    }, { workflows: catalog, saveProjectFn: () => {} }),
    (error) => error.code === "PROMPT_WORKFLOW_NOT_READY" && /not connected/i.test(error.message)
  );
});

test("legacy asset edits may change review metadata but cannot alter composer execution provenance", () => {
  const asset = {
    generationComposer: true,
    regenerationMode: "prompt-composer",
    source: "prompt-generation-composer",
    name: "Original display name",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    prompt: "@Adam sleeping",
    category: "guide-frame",
    seed: 17,
    durationSec: null,
    dependencies: [adam.id]
  };
  assert.deepEqual(promptComposerAssetProvenanceChanges(asset, {
    status: "ready-for-shot",
    continuity: ["Editorially selected"],
    workflowId: asset.workflowId,
    prompt: asset.prompt,
    dependencies: [adam.id]
  }), []);
  assert.deepEqual(promptComposerAssetProvenanceChanges(asset, {
    name: "Renamed output",
    variant: "Different variant",
    workflowId: "arbitrary-unknown",
    category: "character",
    seed: 18,
    durationSec: 8,
    dependencies: [eve.id]
  }), ["name", "variant", "workflowId", "category", "seed", "durationSec", "dependencies"]);
});

test("runtime pin check reports missing, stale-version, and stale-file references", () => {
  const project = baseProject([adam]);
  assert.throws(
    () => assertPinnedReferencesCurrent(project, [{ assetId: "missing", assetVersion: 1 }]),
    (error) => error.code === "PINNED_ASSET_MISSING"
  );
  assert.throws(
    () => assertPinnedReferencesCurrent(project, [{ assetId: adam.id, assetVersion: 2 }]),
    (error) => error.code === "PINNED_ASSET_VERSION_STALE"
  );
  assert.throws(
    () => assertPinnedReferencesCurrent(project, [{ assetId: adam.id, assetVersion: 1 }]),
    (error) => error.code === "PINNED_ASSET_FILE_STALE"
  );
});

test("queue lifecycle helpers restore cancellation and persist failure without losing immutable request state", () => {
  let memory = baseProject();
  memory.promptGenerations = {
    schema: PROMPT_GENERATION_SCHEMA,
    items: [{
      id: "generation-life",
      status: "queued",
      request: { promptText: "immutable" },
      fingerprint: HASH,
      lastError: null
    }]
  };
  const dependencies = {
    loadProjectFn: () => structuredClone(memory),
    saveProjectFn: (project) => { memory = structuredClone(project); }
  };
  restorePromptGenerationAfterCancellation(memory.slug, "generation-life", dependencies);
  assert.equal(memory.promptGenerations.items[0].status, "cancelled");
  assert.equal(memory.promptGenerations.items[0].request.promptText, "immutable");
  memory.promptGenerations.items[0].status = "queued";
  markPromptGenerationFailed(memory.slug, "generation-life", new Error("compiler failed"), dependencies);
  assert.equal(memory.promptGenerations.items[0].status, "failed");
  assert.equal(memory.promptGenerations.items[0].lastError, "compiler failed");
  assert.equal(memory.promptGenerations.items[0].fingerprint, HASH);
});

async function preparedExecution(outputKind, catalog) {
  const project = baseProject(outputKind === "image" ? [adam] : []);
  const body = outputKind === "image"
    ? {
        outputMode: "image",
        workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
        prompt: "@Adam sleeping beside a dying fire",
        references: [{ token: "@Adam", assetId: adam.id, assetVersion: 1, role: "identity", order: 1 }],
        settings: { aspectRatio: "16:9" }
      }
    : videoBody();
  let memory = null;
  const created = createPromptGeneration(project, body, {
    workflows: catalog,
    id: `generation-${outputKind}`,
    saveProjectFn: (next) => { memory = structuredClone(next); },
    assertPinsFn: () => true
  });
  return { created, get memory() { return memory; }, set memory(value) { memory = value; } };
}

for (const outputKind of ["image", "video"]) {
  test(`${outputKind} queue adapter compiles synthetic input and registers output without a real render in tests`, async () => {
    const catalog = await readyCatalog();
    const prepared = await preparedExecution(outputKind, catalog);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `p316-prompt-${outputKind}-`));
    let runCount = 0;
    let compileCount = 0;
    let registered = null;
    const graph = { nodes: [], extra: { premiere316: { outputKind } } };
    const workflowHash = crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex");
    const job = {
      projectSlug: prepared.memory.slug,
      status: "running",
      refs: {
        generationId: prepared.created.generation.id,
        requestFingerprint: prepared.created.generation.fingerprint
      }
    };
    const common = {
      loadProject: () => structuredClone(prepared.memory),
      saveProject: (project) => { prepared.memory = structuredClone(project); },
      getCatalog: async () => catalog,
      assertPins: () => true,
      materializeReferences: () => ({ fileCount: outputKind === "image" ? 0 : 1 }),
      runPrompt: async () => { runCount += 1; return { mocked: true }; },
      collectOutputFiles: () => [{ filename: outputKind === "image" ? "mock.png" : "mock.mp4" }],
      downloadOutput: async (_reference, _destination, stem) => `${stem}${outputKind === "image" ? ".png" : ".mp4"}`,
      trimVideoToFrames: async () => {},
      mediaDir: () => temporary,
      registerOutput: (project, generation, compiled, files) => {
        registered = { project, generation, compiled, files };
        return { asset: { id: `asset-${outputKind}` }, version: 1, files };
      },
      compileImage: async (_project, storyboard, frameId) => {
        compileCount += 1;
        assert.ok(storyboard.frames[frameId]);
        assert.equal(storyboard.frames[frameId].references[0].assetVersionId, `${adam.id}:v1`);
        return { graph, workflowHash, apiPrompt: { mocked: "image" }, settings: { width: 1280, height: 720 } };
      },
      compileVideo: async (_project, storyboard, videoPlanId) => {
        compileCount += 1;
        assert.ok(storyboard.videoPlans[videoPlanId]);
        assert.equal(storyboard.videoPlans[videoPlanId].generationMode, "t2v_with_semantic_references");
        return {
          graph,
          workflowHash,
          apiPrompt: { mocked: "video" },
          settings: { authoredFrames: 48, generationFrames: 49, fps: 24, width: 768, height: 448 }
        };
      }
    };
    try {
      await generatePromptAssetJob(job, common);
      assert.equal(compileCount, 1);
      assert.equal(runCount, 1);
      assert.equal(registered.generation.fingerprint, prepared.created.generation.fingerprint);
      assert.equal(job.result.assetId, `asset-${outputKind}`);
      assert.equal(job.result.requestFingerprint, prepared.created.generation.fingerprint);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
}

test("fingerprint drift after queueing aborts before renderer submission", async () => {
  const catalog = await readyCatalog();
  const prepared = await preparedExecution("video", catalog);
  prepared.memory.promptGenerations.items[0].request.promptText = "mutated after queue";
  let renderCalled = false;
  const job = {
    projectSlug: prepared.memory.slug,
    status: "running",
    refs: {
      generationId: prepared.created.generation.id,
      requestFingerprint: prepared.created.generation.fingerprint
    }
  };
  await assert.rejects(
    generatePromptAssetJob(job, {
      loadProject: () => structuredClone(prepared.memory),
      saveProject: () => {},
      getCatalog: async () => catalog,
      assertPins: () => true,
      runPrompt: async () => { renderCalled = true; return {}; }
    }),
    /request or pinned assets changed after queueing/i
  );
  assert.equal(renderCalled, false);
});

test("job start reloads project after async catalog readiness so concurrent imports are not reverted", async () => {
  const catalog = await readyCatalog();
  const prepared = await preparedExecution("video", catalog);
  const graph = { nodes: [], extra: { premiere316: { outputKind: "video" } } };
  const workflowHash = crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex");
  const job = {
    projectSlug: prepared.memory.slug,
    status: "running",
    refs: {
      generationId: prepared.created.generation.id,
      requestFingerprint: prepared.created.generation.fingerprint
    }
  };
  await assert.rejects(generatePromptAssetJob(job, {
    getCatalog: async () => {
      prepared.memory = { ...prepared.memory, concurrentVoiceImport: { assetId: "voice-adam", version: 3 } };
      return catalog;
    },
    loadProject: () => structuredClone(prepared.memory),
    saveProject: (project) => { prepared.memory = structuredClone(project); },
    assertPins: () => true,
    materializeReferences: () => null,
    compileVideo: async () => ({
      graph,
      workflowHash,
      apiPrompt: { mocked: true },
      settings: { authoredFrames: 48, generationFrames: 49, fps: 24, width: 768, height: 448 }
    }),
    runPrompt: async () => { throw new Error("mock stop after status save"); }
  }), /mock stop after status save/);
  assert.deepEqual(prepared.memory.concurrentVoiceImport, { assetId: "voice-adam", version: 3 });
  assert.equal(prepared.memory.promptGenerations.items[0].status, "running");
});

test("actual manifest saves preserve composer provenance and the same fingerprint appends version 2", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "p316-prompt-register-"));
  const assetDirectory = path.join(temporary, "media", "assets");
  fs.mkdirSync(assetDirectory, { recursive: true });
  const outputFile = "composer-output.v1.png";
  const outputBytes = Buffer.from("immutable-output");
  fs.writeFileSync(path.join(assetDirectory, outputFile), outputBytes);
  const fingerprint = "b".repeat(64);
  const reference = {
    mentionId: "mention-1",
    display: "@Adam",
    assetId: adam.id,
    assetVersion: 1,
    assetVersionId: `${adam.id}:v1`,
    role: "identity",
    order: 1,
    required: true,
    notes: "",
    mediaType: "image",
    file: "character_adam.v1.png",
    projectMediaPath: "media/assets/character_adam.v1.png",
    sha256: HASH,
    bytes: 1,
    provenance: { scope: "project_asset_manifest", projectSlug: "prompt-register" }
  };
  const generation = {
    schemaVersion: 1,
    id: "generation-register",
    projectSlug: "prompt-register",
    outputKind: "image",
    outputMode: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    promptText: "@Adam sleeping beside a dying fire",
    options: { aspectRatio: "16:9", seed: 17 },
    resolvedReferences: [reference],
    fingerprint,
    status: "running",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:01.000Z"
  };
  const project = {
    ...baseProject(),
    slug: "prompt-register",
    promptGenerations: { schema: PROMPT_GENERATION_SCHEMA, items: [structuredClone(generation)] }
  };
  const graph = { nodes: [{ id: 1, type: "MockOutput" }], extra: { premiere316: { model: "Mock Model" } } };
  const compiled = {
    graph,
    workflowHash: crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
    sourceWorkflowHash: "c".repeat(64),
    seed: 17,
    settings: { width: 1280, height: 720 }
  };
  let projectSaveCount = 0;
  try {
    const registered = registerPromptOutput(project, generation, compiled, [outputFile], {
      mediaDirFn: () => assetDirectory,
      projectDirFn: () => temporary,
      saveAssetPackageFilesFn: (savedProject) => saveAssetPackageFiles(savedProject, { projectDirFn: () => temporary }),
      saveProjectFn: () => { projectSaveCount += 1; },
    });
    const asset = registered.asset;
    const version = asset.versions[0];
    assert.equal(asset.status, "generated");
    assert.equal(asset.generationComposer, true);
    assert.equal(asset.regenerationMode, "prompt-composer");
    assert.equal(asset.workflowId, STORYBOARD_KREA_GENERATION_WORKFLOW_ID);
    assert.deepEqual(asset.dependencies, [adam.id]);
    assert.equal(version.generationComposer, true);
    assert.equal(version.regenerationMode, "prompt-composer");
    assert.equal(version.generationFingerprint, fingerprint);
    assert.equal(version.sourceGenerationId, generation.id);
    assert.deepEqual(version.references, [reference]);
    assert.equal(version.fileHashes[0].sha256, crypto.createHash("sha256").update(outputBytes).digest("hex"));
    assert.equal(version.workflowHash, compiled.workflowHash);
    assert.equal(version.sourceWorkflowHash, compiled.sourceWorkflowHash);
    const snapshot = path.join(temporary, ...version.workflowSnapshot.split("/"));
    assert.equal(fs.existsSync(snapshot), true);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex"), version.workflowSnapshotHash);
    assert.equal(registered.generation.result.assetId, asset.id);
    assert.equal(registered.generation.result.generationComposer, true);
    assert.equal(registered.generation.result.regenerationMode, "prompt-composer");
    assert.equal(projectSaveCount, 1);

    const workflowBeforeV2 = asset.workflowId;
    const hashBeforeV2 = asset.workflowHash;
    const promptBeforeV2 = asset.prompt;
    const mediaTypeBeforeV2 = asset.mediaType;
    const outputFileV2 = "composer-output.v2.png";
    fs.writeFileSync(path.join(assetDirectory, outputFileV2), Buffer.from("immutable-output-v2"));
    const registeredV2 = registerPromptOutput(project, generation, compiled, [outputFileV2], {
      mediaDirFn: () => assetDirectory,
      projectDirFn: () => temporary,
      saveAssetPackageFilesFn: (savedProject) => saveAssetPackageFiles(savedProject, { projectDirFn: () => temporary }),
      saveProjectFn: () => { projectSaveCount += 1; }
    });
    assert.equal(registeredV2.version, 2);
    assert.equal(asset.versions.length, 2);
    assert.equal(asset.workflowId, workflowBeforeV2);
    assert.equal(asset.workflowHash, hashBeforeV2);
    assert.equal(asset.prompt, promptBeforeV2);
    assert.equal(asset.mediaType, mediaTypeBeforeV2);
    assert.equal(asset.workflowSnapshot, asset.versions[1].workflowSnapshot);
    assert.equal(projectSaveCount, 2);
    const manifest = JSON.parse(fs.readFileSync(path.join(temporary, "production", "asset-manifest.json"), "utf8"));
    const persisted = manifest.items.find((item) => item.id === asset.id);
    assert.equal(persisted.workflowId, workflowBeforeV2);
    assert.equal(persisted.workflowHash, hashBeforeV2);
    assert.equal(persisted.prompt, promptBeforeV2);
    assert.equal(persisted.mediaType, mediaTypeBeforeV2);
    assert.equal(persisted.versions.length, 2);
    const refreshedManifest = buildAssetPackage("", { previous: project.assets });
    const refreshedOutput = refreshedManifest.items.find((item) => item.id === asset.id);
    assert.ok(refreshedOutput, "screenplay refresh must retain prompt-composer outputs");
    assert.equal(refreshedOutput.workflowId, workflowBeforeV2);
    assert.equal(refreshedOutput.workflowHash, hashBeforeV2);
    assert.equal(refreshedOutput.prompt, promptBeforeV2);
    assert.equal(refreshedOutput.mediaType, mediaTypeBeforeV2);
    assert.equal(refreshedOutput.versions.length, 2);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
