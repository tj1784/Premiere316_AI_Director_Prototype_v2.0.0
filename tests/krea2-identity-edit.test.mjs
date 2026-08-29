import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ASSET_WORKFLOWS,
  assetGenerationFingerprint,
  assetVersionFingerprint,
  compileAssetWorkflow,
  createDirectorAsset,
  defaultAssetWorkflow,
  identityEditJobRefs,
  identityEditSourceFingerprint,
  identityEditTargetDimensions,
  prepareIdentityEditSource,
  revalidateIdentityEditJobRefs,
  revalidateIdentityEditSource,
  validateAssetWorkflow,
  visualEditWorkflow,
  visualWorkflow
} from "../server/assets.js";
import { uploadImage } from "../server/comfy.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_EDIT_ID = "krea2-identity-edit-v1-2";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeHarness(t, {
  slug = "identity-project",
  sourceFile = "approved/nested/person.png",
  contents = Buffer.from("approved-person-v1"),
  sourceWidth = 1920,
  sourceHeight = 1080,
  separateTarget = false
} = {}) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-identity-edit-"));
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  const diskPath = path.join(projectsRoot, slug, "media", "assets", ...sourceFile.split("/"));
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  fs.writeFileSync(diskPath, contents);

  const sourceAsset = {
    id: "approved-person",
    name: "Approved Person",
    variant: "Primary Appearance",
    category: "character",
    mediaType: "image",
    prompt: "Approved source direction",
    sampleText: "",
    workflowId: "krea2-character-ingredients-fp8",
    workflowHash: "a".repeat(64),
    seed: 7,
    status: "generated",
    versions: [],
    activeVersion: 1
  };
  const generationFingerprint = assetGenerationFingerprint(sourceAsset);
  sourceAsset.versions.push({
    v: 1,
    file: sourceFile,
    files: [sourceFile],
    mediaType: "image",
    workflowId: sourceAsset.workflowId,
    workflowHash: sourceAsset.workflowHash,
    model: "Krea 2",
    prompt: sourceAsset.prompt,
    seed: sourceAsset.seed,
    assetFingerprint: generationFingerprint,
    fileHashes: [{
      file: sourceFile,
      sha256: sha256(contents),
      bytes: contents.byteLength,
      extension: ".png"
    }],
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  const versionFingerprint = assetVersionFingerprint(sourceAsset);
  sourceAsset.approval = {
    status: "approved",
    activeVersion: 1,
    generationFingerprint,
    versionFingerprint,
    screenplayRevision: "b".repeat(64),
    approvedAt: "2026-08-29T00:01:00.000Z"
  };

  const targetAsset = separateTarget ? {
    id: "person-touch-up",
    name: "Person Touch-up",
    variant: "Production Reference",
    category: "character",
    mediaType: "image",
    prompt: "Relight with warm golden hour sunlight.",
    workflowId: "krea2-cinematic-still-fp8",
    workflowHash: "c".repeat(64),
    status: "planned",
    versions: [],
    activeVersion: 0
  } : sourceAsset;
  const project = {
    slug,
    projectsRoot,
    settings: { skipApproval: false },
    assets: { items: separateTarget ? [sourceAsset, targetAsset] : [targetAsset] }
  };

  return {
    project,
    sourceAsset,
    targetAsset,
    diskPath,
    contents,
    sourceWidth,
    sourceHeight,
    async prepare() {
      const prepared = await prepareIdentityEditSource(
        project,
        targetAsset,
        { assetId: sourceAsset.id, assetVersion: 1 },
        { probeMediaFn: async () => ({ video: { width: sourceWidth, height: sourceHeight } }) }
      );
      targetAsset.identityEdit = prepared.recipe;
      targetAsset.workflowId = IDENTITY_EDIT_ID;
      targetAsset.prompt = "Relight with warm golden hour sunlight.";
      return prepared;
    }
  };
}

test("ASSET_WORKFLOWS and manifest expose Krea 2 Identity Edit v1.2", () => {
  const workflow = ASSET_WORKFLOWS.find((item) => item.id === IDENTITY_EDIT_ID);
  assert.ok(workflow);
  assert.equal(workflow.mediaType, "image");
  assert.match(String(workflow.purpose || ""), /identity-preserving edit/i);
  assert.match(String(workflow.purpose || ""), /not from-scratch/i);
  assert.ok(workflow.requiredModels.some((model) => /krea2_turbo_bf16/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /qwen3vl_4b_bf16/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /qwen_image_vae/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /krea2_identity_edit_v1_2/i.test(model)));
  assert.ok(workflow.requiredNodes.includes("Krea2EditModelPatch"));

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "manifest.json"), "utf8"));
  const entry = (manifest.workflows || []).find((item) => item.id === IDENTITY_EDIT_ID);
  assert.ok(entry);
  assert.equal(entry.rel, "krea2-identity-edit-v1-2.ui.json");
  assert.equal(fs.existsSync(path.join(ROOT, "workflows", entry.rel)), true);
});

test("identity edit is explicit-only and never inferred from a new asset name or variant", () => {
  assert.equal(visualEditWorkflow(), IDENTITY_EDIT_ID);
  assert.notEqual(defaultAssetWorkflow("character", "Identity Edit", "Jesus"), IDENTITY_EDIT_ID);
  assert.notEqual(defaultAssetWorkflow("guide-frame", "Touch-up", "Approved still"), IDENTITY_EDIT_ID);
  assert.equal(visualWorkflow("guide-frame"), "krea2-cinematic-still-fp8");
  assert.equal(visualWorkflow("artifact"), "flux2-klein-9b-prop-fp8");
  assert.equal(visualWorkflow("character", "Primary Appearance"), "krea2-character-ingredients-fp8");

  const explicit = createDirectorAsset({
    category: "character",
    name: "Jesus",
    variant: "Identity Edit",
    workflowId: IDENTITY_EDIT_ID,
    prompt: "Preserve the exact identity."
  });
  assert.equal(explicit.workflowId, IDENTITY_EDIT_ID);
  assert.equal(explicit.workflowExplicit, true);
  assert.equal(explicit.prompt, "Preserve the exact identity.");
});

test("prepare pins an exact approved nested source with content-addressed Comfy provenance", async (t) => {
  const harness = makeHarness(t);
  const { recipe, diskPath } = await harness.prepare();
  assert.equal(diskPath, fs.realpathSync(harness.diskPath));
  assert.equal(recipe.source.assetId, harness.sourceAsset.id);
  assert.equal(recipe.source.assetVersion, 1);
  assert.equal(recipe.source.sourceFile, "approved/nested/person.png");
  assert.equal(recipe.source.fileSha256, sha256(harness.contents));
  assert.equal(recipe.source.fileBytes, harness.contents.byteLength);
  assert.match(recipe.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(recipe.comfyFileName, `${recipe.source.fileSha256}.png`);
  assert.match(recipe.comfySubfolder, /^premiere316_identity_edit\/identity-project-[a-f0-9]{12}\/approved-person-[a-f0-9]{12}\/approved-person-[a-f0-9]{12}-v1$/);
  assert.equal(recipe.comfyFile, `${recipe.comfySubfolder}/${recipe.comfyFileName}`);
});

test("prepare rejects client-controlled paths and a realpath escape", async (t) => {
  const harness = makeHarness(t);
  await assert.rejects(
    prepareIdentityEditSource(
      harness.project,
      harness.targetAsset,
      { assetId: harness.sourceAsset.id, assetVersion: 1, file: "forged.png" },
      { probeMediaFn: async () => ({ video: { width: 1024, height: 1024 } }) }
    ),
    (error) => error?.code === "client_owned_file_rejected"
  );

  const outside = path.join(harness.project.projectsRoot, "outside.png");
  fs.writeFileSync(outside, harness.contents);
  fs.rmSync(harness.diskPath);
  try {
    fs.symlinkSync(outside, harness.diskPath, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
      t.skip("Windows symlink creation is unavailable in this environment");
      return;
    }
    throw error;
  }
  await assert.rejects(
    prepareIdentityEditSource(
      harness.project,
      harness.targetAsset,
      { assetId: harness.sourceAsset.id, assetVersion: 1 },
      { probeMediaFn: async () => ({ video: { width: 1024, height: 1024 } }) }
    ),
    (error) => ["path_escape", "IDENTITY_EDIT_SOURCE_PATH_INVALID"].includes(error?.code)
  );
});

test("worker revalidation survives approval clearing but rejects version, record, and disk drift", async (t) => {
  const harness = makeHarness(t);
  await harness.prepare();
  const refs = identityEditJobRefs(harness.project, harness.targetAsset);
  harness.targetAsset.approval = null;
  assert.doesNotThrow(() => revalidateIdentityEditJobRefs(harness.project, harness.targetAsset, refs));
  assert.equal(revalidateIdentityEditSource(harness.project, harness.targetAsset).diskPath, fs.realpathSync(harness.diskPath));

  fs.writeFileSync(harness.diskPath, "tampered");
  assert.throws(
    () => revalidateIdentityEditSource(harness.project, harness.targetAsset),
    (error) => error?.code === "IDENTITY_EDIT_SOURCE_HASH_MISMATCH"
  );
  fs.writeFileSync(harness.diskPath, harness.contents);
  harness.targetAsset.versions[0].prompt = "mutated historical record";
  assert.throws(
    () => revalidateIdentityEditSource(harness.project, harness.targetAsset),
    (error) => error?.code === "IDENTITY_EDIT_SOURCE_FINGERPRINT_MISMATCH"
  );
});

test("job refs detect target/source active-version changes after queue", async (t) => {
  const harness = makeHarness(t, { separateTarget: true });
  await harness.prepare();
  const refs = identityEditJobRefs(harness.project, harness.targetAsset);
  assert.deepEqual(refs.identityEditSource, harness.targetAsset.identityEdit.source);
  assert.equal(refs.identityEditSourceActiveVersion, 1);
  assert.equal(refs.identityEditTargetActiveVersion, null);
  assert.doesNotThrow(() => revalidateIdentityEditJobRefs(harness.project, harness.targetAsset, refs));

  harness.targetAsset.activeVersion = 2;
  assert.throws(
    () => revalidateIdentityEditJobRefs(harness.project, harness.targetAsset, refs),
    (error) => error?.code === "IDENTITY_EDIT_JOB_SOURCE_CHANGED"
  );
  harness.targetAsset.activeVersion = 0;
  harness.sourceAsset.activeVersion = 2;
  assert.throws(
    () => revalidateIdentityEditJobRefs(harness.project, harness.targetAsset, refs),
    (error) => error?.code === "IDENTITY_EDIT_SOURCE_VERSION_CHANGED"
  );
});

test("target dimensions preserve landscape and portrait aspect at the runtime's 16px quantum", () => {
  assert.deepEqual(identityEditTargetDimensions(1280, 720), {
    sourceWidth: 1280,
    sourceHeight: 720,
    width: 1280,
    height: 720
  });
  for (const [sourceWidth, sourceHeight] of [[1920, 1080], [1080, 1920], [1001, 777]]) {
    const result = identityEditTargetDimensions(sourceWidth, sourceHeight);
    assert.equal(result.width % 16, 0);
    assert.equal(result.height % 16, 0);
    assert.ok(result.width * result.height <= 1024 * 1024);
    assert.ok(Math.abs((result.width / result.height) - (sourceWidth / sourceHeight)) < 0.025);
  }
});

test("compiled identity edit uses exact source, aspect, plain instruction, and Krea ingredients", async (t) => {
  const harness = makeHarness(t);
  const { recipe } = await harness.prepare();
  harness.targetAsset.promptHeader = "APPROVED PERSON — IDENTITY EDIT: FOUR-VIEW REFERENCE.";
  harness.targetAsset.prompt = `${harness.targetAsset.promptHeader}\n\nPreserve the exact facial identity. Relight with warm golden hour.`;
  const compiled = compileAssetWorkflow(harness.project, harness.targetAsset);
  assert.equal(compiled["55"].inputs.unet_name, "KREA 2\\krea2_turbo_bf16.safetensors");
  assert.equal(compiled["56"].inputs.clip_name, "qwen3vl_4b_bf16.safetensors");
  assert.equal(compiled["57"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(compiled["71"].inputs.lora_name, "krea2\\krea2_identity_edit_v1_2.safetensors");
  assert.equal(compiled["72"].inputs.image, recipe.comfyFile);
  assert.deepEqual(
    { width: compiled["82"].inputs.width, height: compiled["82"].inputs.height },
    { width: recipe.width, height: recipe.height }
  );
  assert.equal(compiled["84"].inputs.prompt, "Preserve the exact facial identity. Relight with warm golden hour.");
  assert.equal(compiled["84"].inputs.system_prompt, "");
  assert.equal(compiled["85"].inputs.prompt, "");
  assert.throws(
    () => compileAssetWorkflow(harness.project, { ...harness.targetAsset, prompt: harness.targetAsset.promptHeader }),
    (error) => error?.code === "IDENTITY_EDIT_INSTRUCTION_REQUIRED"
  );
  assert.throws(
    () => compileAssetWorkflow(harness.project, {
      ...harness.targetAsset,
      identityEdit: { ...harness.targetAsset.identityEdit, refBoost: 5 }
    }),
    (error) => error?.code === "IDENTITY_EDIT_MODEL_SETTINGS_INVALID"
  );
});

test("identity provenance participates in generation and version fingerprints without migrating legacy assets", async (t) => {
  const harness = makeHarness(t);
  const { recipe } = await harness.prepare();
  const first = assetGenerationFingerprint(harness.targetAsset);
  const changedSource = { ...recipe.source, fileSha256: "f".repeat(64) };
  const changed = assetGenerationFingerprint({
    ...harness.targetAsset,
    identityEdit: {
      ...recipe,
      source: changedSource,
      sourceFingerprint: identityEditSourceFingerprint(changedSource),
      comfyFile: recipe.comfyFile.replace(recipe.source.fileSha256, changedSource.fileSha256)
    }
  });
  assert.notEqual(changed, first);

  const identityVersionAsset = {
    id: harness.targetAsset.id,
    workflowId: IDENTITY_EDIT_ID,
    activeVersion: 1,
    versions: [{
      ...harness.targetAsset.versions[0],
      sourceReference: recipe.source,
      sourceReferenceFingerprint: recipe.sourceFingerprint,
      sourceWidth: recipe.sourceWidth,
      sourceHeight: recipe.sourceHeight,
      width: recipe.width,
      height: recipe.height
    }]
  };
  const versionFingerprint = assetVersionFingerprint(identityVersionAsset);
  identityVersionAsset.versions[0].sourceReferenceFingerprint = "e".repeat(64);
  assert.notEqual(assetVersionFingerprint(identityVersionAsset), versionFingerprint);

  const legacy = {
    id: "legacy",
    name: "Legacy",
    variant: "Primary",
    category: "character",
    mediaType: "image",
    prompt: "legacy prompt",
    sampleText: "",
    workflowId: "krea2-character-ingredients-fp8",
    workflowHash: "1".repeat(64),
    seed: 3,
    durationSec: null,
    bpm: null
  };
  const legacyExpected = sha256(JSON.stringify({
    id: legacy.id,
    name: legacy.name,
    variant: legacy.variant,
    category: legacy.category,
    mediaType: legacy.mediaType,
    prompt: legacy.prompt,
    sampleText: legacy.sampleText,
    workflowId: legacy.workflowId,
    workflowHash: legacy.workflowHash,
    seed: legacy.seed,
    durationSec: legacy.durationSec,
    bpm: legacy.bpm
  }));
  assert.equal(assetGenerationFingerprint(legacy), legacyExpected);
});

test("uploadImage supports deterministic names, overwrite control, and pre-upload hash verification", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-comfy-upload-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "local-name.png");
  const contents = Buffer.from("content-addressed-image");
  fs.writeFileSync(file, contents);
  const digest = sha256(contents);
  let called = 0;
  const uploaded = await uploadImage(file, "project/asset/source-v1", {
    fileName: `${digest}.png`,
    overwrite: false,
    expectedSha256: digest,
    baseUrl: "http://comfy.test",
    fetchImpl: async (url, options) => {
      called += 1;
      assert.equal(url, "http://comfy.test/upload/image");
      assert.equal(options.body.get("image").name, `${digest}.png`);
      assert.equal(options.body.get("subfolder"), "project/asset/source-v1");
      assert.equal(options.body.get("overwrite"), "false");
      return {
        ok: true,
        json: async () => ({ name: `${digest}.png`, subfolder: "project/asset/source-v1" })
      };
    }
  });
  assert.equal(uploaded, `project/asset/source-v1/${digest}.png`);
  assert.equal(called, 1);
  await assert.rejects(
    uploadImage(file, "project/asset/source-v1", {
      fileName: `${digest}.png`,
      expectedSha256: "0".repeat(64),
      fetchImpl: async () => { throw new Error("must not fetch"); }
    }),
    /SHA-256 changed before upload/
  );
});

test("workflow validation allows only the two intentional Krea blanks", async (t) => {
  const harness = makeHarness(t);
  await harness.prepare();
  const identityGraph = compileAssetWorkflow(harness.project, harness.targetAsset);
  const musicAsset = {
    id: "music",
    category: "music",
    mediaType: "audio",
    prompt: "dark orchestral score",
    workflowId: "ace-step-1.5-xl-turbo",
    durationSec: 10,
    bpm: 90,
    seed: 1
  };
  const musicGraph = compileAssetWorkflow(harness.project, musicAsset);
  const objectInfo = {};
  for (const graph of [identityGraph, musicGraph]) {
    for (const node of Object.values(graph)) {
      objectInfo[node.class_type] ||= { input: { required: {} } };
      for (const name of Object.keys(node.inputs || {})) objectInfo[node.class_type].input.required[name] = ["STRING"];
    }
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => objectInfo });
  t.after(() => { globalThis.fetch = originalFetch; });
  const identityValidation = await validateAssetWorkflow(harness.project, harness.targetAsset);
  assert.deepEqual(identityValidation, { ready: true, errors: [] });
  const musicValidation = await validateAssetWorkflow(harness.project, musicAsset);
  assert.equal(musicValidation.ready, false);
  assert.ok(musicValidation.errors.some((error) => /missing required input lyrics/.test(error)));
});

test("generation lifecycle no longer rewrites immutable provenance after package save", () => {
  const source = fs.readFileSync(path.join(ROOT, "server", "assets.js"), "utf8");
  assert.doesNotMatch(source, /written\.workflowHash\s*=/);
  assert.doesNotMatch(source, /written\.assetFingerprint\s*=/);
  assert.doesNotMatch(source, /runAsset\.sourceImage\s*=/);
});

test("asset routes pin identity sources before mutation and bind them into queued jobs", () => {
  const server = fs.readFileSync(path.join(ROOT, "server/index.js"), "utf8");
  assert.match(server, /prepareIdentityEditSource/);
  assert.match(server, /revalidateIdentityEditSource/);
  assert.match(server, /identityEditRecipeForMutation/);
  assert.match(server, /identityEditSource rejects client-authored provenance fields/);
  assert.match(server, /asset\.identityEdit = identityEditRecipe/);
  assert.match(server, /identityEditJobRefs\(project, asset\)/);
  assert.match(server, /new Identity Edit asset requires an explicit approved source assetId and assetVersion/i);

  const mutationHelper = server.slice(
    server.indexOf("async function identityEditRecipeForMutation"),
    server.indexOf("function canonicalFrameCurrent")
  );
  assert.ok(mutationHelper.indexOf("revalidateIdentityEditSource") < mutationHelper.indexOf("prepareIdentityEditSource"));

  const generateRoute = server.slice(
    server.indexOf('app.post("/api/projects/:slug/assets/:assetId/generate"'),
    server.indexOf('app.post("/api/projects/:slug/assets/generate-all"')
  );
  assert.ok(generateRoute.indexOf("identityEditRecipeForMutation") < generateRoute.indexOf("asset.approval = null"));
  assert.ok(generateRoute.indexOf("saveAssetPackageFiles(project)") < generateRoute.indexOf("identityEditJobRefs(project, asset)"));
});
