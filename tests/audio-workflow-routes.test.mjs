import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUDIO_WORKFLOW_API_ROOT,
  AUDIO_WORKFLOW_IMPORT_ROOT,
  AUDIO_WORKFLOW_ROOT,
  getAudioWorkflowProfile,
  importAudioWorkflow,
  rebindAudioWorkflowProfile,
  renameAudioWorkflowProfile,
  setAudioWorkflowEnabled
} from "../server/audio-workflows.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source contract start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source contract end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("Workflow Manager routes advertise and invoke copy-only import, enable, rename, and rebind contracts", () => {
  for (const imported of [
    "importAudioWorkflow", "setAudioWorkflowEnabled", "renameAudioWorkflowProfile", "rebindAudioWorkflowProfile"
  ]) assert.match(SERVER_SOURCE, new RegExp(`\\b${imported}\\b`));
  assert.match(SERVER_SOURCE, /promptEnhancement: false/);

  assert.match(SERVER_SOURCE, /app\.post\("\/api\/projects\/:slug\/sound\/workflows\/import", requireLocalSameOriginMutation, receiveWorkflowJson,/);
  assert.match(SERVER_SOURCE, /app\.patch\("\/api\/projects\/:slug\/sound\/workflows\/:profileId\/enabled", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.patch\("\/api\/projects\/:slug\/sound\/workflows\/:profileId\/name", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/projects\/:slug\/sound\/workflows\/:profileId\/rebind", requireLocalSameOriginMutation,/);
  assert.match(SERVER_SOURCE, /app\.post\("\/api\/projects\/:slug\/sound\/workflows\/scan", requireLocalSameOriginMutation, receiveWorkflowJson,/);

  const catalogRoute = sourceSection(
    SERVER_SOURCE,
    "app.get(\"/api/projects/:slug/sound/workflows\"",
    "app.post(\"/api/projects/:slug/sound/workflows/scan\""
  );
  for (const capability of ["importWorkflow: true", "enableDisable: true", "rename: true", "rebind: true", "copyOnlyImport: true", "sourceWorkflowsImmutable: true"]) {
    assert.match(catalogRoute, new RegExp(capability));
  }

  const importHelpers = sourceSection(
    SERVER_SOURCE,
    "function receiveWorkflowJson(req, res, next)",
    "app.get(\"/api/projects/:slug/sound/workflows\""
  );
  assert.match(importHelpers, /enabled: false/);
  assert.match(importHelpers, /path\.join\(AUDIO_WORKFLOW_IMPORT_ROOT, "\.staging"\)/);
  assert.match(importHelpers, /importAudioWorkflow\(audioWorkflowImportPayload\(req, selectedSource\)\)/);
  assert.match(importHelpers, /fs\.unlinkSync\(stagedSource\)/);

  const enabledRoute = sourceSection(
    SERVER_SOURCE,
    "app.patch(\"/api/projects/:slug/sound/workflows/:profileId/enabled\"",
    "app.patch(\"/api/projects/:slug/sound/workflows/:profileId/name\""
  );
  assert.match(enabledRoute, /typeof req\.body\?\.enabled !== "boolean"/);
  assert.match(enabledRoute, /getAudioWorkflowProfile\(req\.params\.profileId, \{ forceObjectInfo: true \}\)/);
  assert.match(enabledRoute, /validationErrors\.length \|\| drift\.length/);
  assert.match(enabledRoute, /setAudioWorkflowEnabled\(req\.params\.profileId, enabled\)/);
  assert.match(enabledRoute, /setAudioWorkflowEnabled\(req\.params\.profileId, false\)/);

  const rebindRoute = sourceSection(
    SERVER_SOURCE,
    "app.post(\"/api/projects/:slug/sound/workflows/:profileId/rebind\"",
    "app.post(\n  \"/api/projects/:slug/sound/workflow-generations\""
  );
  assert.match(rebindRoute, /rebindAudioWorkflowProfile\(req\.params\.profileId/);
  assert.match(rebindRoute, /inputNodeBindings: body\.inputNodeBindings \?\? body\.bindings/);
  assert.match(rebindRoute, /outputNodeBindings: body\.outputNodeBindings/);
  assert.match(rebindRoute, /sourceWorkflowMutated: false/);
  assert.doesNotMatch(rebindRoute, /originalWorkflowPath\s*:/);
});

test("management primitives copy and rebind app-owned files without changing the selected source workflow", async (t) => {
  fs.mkdirSync(AUDIO_WORKFLOW_ROOT, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(AUDIO_WORKFLOW_ROOT, "test-workflow-management-"));
  const registryPath = path.join(fixtureRoot, "registry.json");
  const sourcePath = path.join(fixtureRoot, "selected-original.json");
  const id = `test-managed-${crypto.randomUUID()}`;
  const ownedSource = path.join(AUDIO_WORKFLOW_IMPORT_ROOT, `${id}.source.json`);
  const ownedApi = path.join(AUDIO_WORKFLOW_API_ROOT, `${id}.api.json`);
  let reboundApi = null;
  t.after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(ownedSource, { force: true });
    fs.rmSync(ownedApi, { force: true });
    if (reboundApi) fs.rmSync(reboundApi, { force: true });
  });

  const originalPrompt = {
    "1": { class_type: "ManagedAudio", inputs: { text: "original source text", seconds: 2 } },
    "2": { class_type: "ManagedSaveAudio", inputs: { audio: ["1", 0] } }
  };
  fs.writeFileSync(sourcePath, JSON.stringify(originalPrompt, null, 2));
  const originalBytes = fs.readFileSync(sourcePath);
  const originalSha256 = fileHash(sourcePath);
  const objectInfo = {
    ManagedAudio: { input: { required: { text: ["STRING", {}], seconds: ["FLOAT", { min: 1, max: 10 }] } } },
    ManagedSaveAudio: { input: { required: { audio: ["AUDIO", {}] } } }
  };
  const workflowOptions = { registryPath, objectInfo, allowedSourceRoots: [fixtureRoot, AUDIO_WORKFLOW_ROOT] };

  const imported = await importAudioWorkflow({
    id,
    displayName: "Managed Original",
    sourcePath,
    category: "music",
    enabled: false,
    requiredCustomNodes: ["ManagedAudio", "ManagedSaveAudio"],
    inputNodeBindings: {
      prompt: { nodeId: "1", inputName: "text", type: "STRING" },
      durationSeconds: { nodeId: "1", inputName: "seconds", type: "FLOAT" }
    },
    outputNodeBindings: [{ nodeId: "2", inputName: "audio", historyOutput: "audio" }],
    supportedDurationRange: { min: 1, max: 10, default: 2 },
    outputFormats: ["wav"]
  }, workflowOptions);

  assert.equal(imported.readiness.status, "disabled");
  assert.equal(fs.existsSync(ownedSource), true);
  assert.equal(fs.existsSync(ownedApi), true);
  assert.notEqual(path.resolve(ownedSource), path.resolve(sourcePath));
  assert.equal(fileHash(sourcePath), originalSha256);
  assert.deepEqual(fs.readFileSync(sourcePath), originalBytes);

  renameAudioWorkflowProfile(id, "Managed Renamed", { registryPath });
  setAudioWorkflowEnabled(id, true, { registryPath });
  const enabled = await getAudioWorkflowProfile(id, workflowOptions);
  assert.equal(enabled.displayName, "Managed Renamed");
  assert.equal(enabled.readiness.status, "ready");

  // Simulate canonical registry aliases such as the Music/SFX/Hybrid Stable
  // profiles, which intentionally begin by sharing one immutable API copy.
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  registry.profiles.push({
    ...structuredClone(registry.profiles[0]),
    id: `${id}-alias`,
    displayName: "Managed Shared Alias",
    readiness: { ...registry.profiles[0].readiness, enabled: false, status: "disabled" }
  });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  const sharedApiBefore = fs.readFileSync(ownedApi);

  const reboundPrompt = structuredClone(originalPrompt);
  reboundPrompt["1"].inputs.text = "app-owned rebound text";
  const rebound = await rebindAudioWorkflowProfile(id, {
    apiWorkflow: reboundPrompt,
    inputNodeBindings: {
      prompt: { nodeId: "1", inputName: "text", type: "STRING" },
      durationSeconds: { nodeId: "1", inputName: "seconds", type: "FLOAT" }
    },
    outputNodeBindings: [{ nodeId: "2", inputName: "audio", historyOutput: "audio" }]
  }, workflowOptions);

  assert.equal(rebound.readiness.status, "disabled");
  assert.equal(rebound.enabled, false);
  reboundApi = path.resolve(ROOT, rebound._manifest.appOwnedApiWorkflowPath);
  assert.notEqual(reboundApi, ownedApi);
  assert.equal(JSON.parse(fs.readFileSync(reboundApi, "utf8"))["1"].inputs.text, "app-owned rebound text");
  assert.deepEqual(fs.readFileSync(ownedApi), sharedApiBefore);
  assert.equal(JSON.parse(fs.readFileSync(ownedSource, "utf8"))["1"].inputs.text, "original source text");
  assert.equal(fileHash(sourcePath), originalSha256);
  assert.deepEqual(fs.readFileSync(sourcePath), originalBytes);

  setAudioWorkflowEnabled(id, true, { registryPath });
  const reenabled = await getAudioWorkflowProfile(id, workflowOptions);
  assert.equal(reenabled.readiness.status, "ready");
});
