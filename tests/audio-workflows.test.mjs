import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AUDIO_WORKFLOW_ROOT,
  evaluateAudioWorkflowProfile,
  getAudioWorkflowCatalog,
  listAudioWorkflowProfiles,
  readAudioWorkflowRegistry
} from "../server/audio-workflows.js";

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fixture() {
  fs.mkdirSync(AUDIO_WORKFLOW_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(AUDIO_WORKFLOW_ROOT, "test-audio-workflows-"));
  const sourceRoot = path.join(root, "sources");
  const apiRoot = path.join(AUDIO_WORKFLOW_ROOT, "api");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(apiRoot, { recursive: true });
  const suffix = path.basename(root);
  const source = path.join(sourceRoot, "source.json");
  const api = path.join(apiRoot, `${suffix}.api.json`);
  fs.writeFileSync(source, JSON.stringify({ nodes: [{ id: 1, type: "TestAudio" }], links: [] }));
  fs.writeFileSync(api, JSON.stringify({
    "1": { class_type: "TestAudio", inputs: { text: "original", seconds: 2, model: "model.safetensors" } },
    "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0] } }
  }));
  const objectInfo = {
    TestAudio: { input: { required: { text: ["STRING", {}], seconds: ["FLOAT", { min: 1, max: 10 }], model: [["model.safetensors"], {}] } } },
    SaveAudio: { input: { required: { audio: ["AUDIO", {}] } } }
  };
  const profile = {
    id: "test.audio.v1",
    displayName: "Test Audio",
    category: "music",
    role: "generator",
    engine: "Test",
    originalWorkflowPath: source,
    appOwnedApiWorkflowPath: path.relative(path.join(AUDIO_WORKFLOW_ROOT, "..", ".."), api).replaceAll("\\", "/"),
    sourceWorkflowSha256: hash(source).toUpperCase(),
    apiWorkflowSha256: hash(api).toUpperCase(),
    requiredCustomNodes: ["TestAudio", "SaveAudio"],
    requiredModelFiles: [{ name: "model.safetensors", present: true, listedByLiveLoader: true }],
    inputNodeBindings: {
      prompt: { nodeId: "1", inputName: "text", type: "STRING" },
      durationSeconds: { nodeId: "1", inputName: "seconds", type: "FLOAT" }
    },
    outputNodeBindings: [{ nodeId: "2", inputName: "audio", historyOutput: "audio" }],
    supportedDurationRange: { min: 1, max: 10, default: 2 },
    lyricsSupport: false,
    seedSupport: false,
    outputFormats: ["wav"],
    readiness: { enabled: true, status: "ready", validationErrors: [] }
  };
  return {
    root, sourceRoot, source, api, objectInfo, profile,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(api, { force: true });
    }
  };
}

test("canonical registry profile validates every node/input/model and detects source drift", async () => {
  const f = fixture();
  try {
    const ready = await evaluateAudioWorkflowProfile(f.profile, { objectInfo: f.objectInfo, allowedSourceRoots: [f.sourceRoot] });
    assert.equal(ready.readiness.status, "ready");
    assert.equal(ready.readiness.inputs.every((input) => input.valid), true);
    assert.equal(ready.readiness.models[0].present, true);
    assert.equal(ready.bindings.prompt.input, "text");
    assert.equal(ready.capabilities.duration, true);

    fs.writeFileSync(f.source, JSON.stringify({ changed: true }));
    const drifted = await evaluateAudioWorkflowProfile(f.profile, { objectInfo: f.objectInfo, allowedSourceRoots: [f.sourceRoot] });
    assert.equal(drifted.readiness.status, "needs-rebinding");
    assert.match(drifted.readiness.drift.join(" "), /Source workflow changed/);
  } finally { f.cleanup(); }
});

test("catalog keeps generators and prompt enhancers in separate public arrays", async () => {
  const f = fixture();
  try {
    const registryPath = path.join(f.root, "registry.json");
    const enhancer = { ...f.profile, id: "test.enhancer.v1", role: "prompt-enhancer" };
    fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, registryId: "test", profiles: [f.profile], promptEnhancers: [enhancer], excludedDiscoveries: [{ name: "not-a-generator" }] }));
    const raw = readAudioWorkflowRegistry({ registryPath });
    assert.equal(raw.promptEnhancers.length, 1);
    const catalog = await getAudioWorkflowCatalog({ registryPath, objectInfo: f.objectInfo, allowedSourceRoots: [f.sourceRoot] });
    assert.deepEqual(catalog.profiles.map((item) => item.id), ["test.audio.v1"]);
    assert.deepEqual(catalog.promptEnhancers.map((item) => item.id), ["test.enhancer.v1"]);
    assert.equal("_prompt" in catalog.profiles[0], false);
  } finally { f.cleanup(); }
});

test("a cold registry evaluation fetches object_info once for every profile", async () => {
  const f = fixture();
  try {
    const registryPath = path.join(f.root, "registry.json");
    const second = { ...f.profile, id: "test.audio.second" };
    fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, registryId: "test", profiles: [f.profile, second] }));
    let objectInfoCalls = 0;
    const profiles = await listAudioWorkflowProfiles({
      registryPath,
      allowedSourceRoots: [f.sourceRoot],
      getObjectInfoFn: async () => {
        objectInfoCalls += 1;
        await Promise.resolve();
        return f.objectInfo;
      }
    });
    assert.equal(profiles.length, 2);
    assert.equal(objectInfoCalls, 1);
    assert.equal(profiles.every((profile) => profile.readiness.ready), true);
  } finally { f.cleanup(); }
});
