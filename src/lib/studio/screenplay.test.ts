import assert from "node:assert/strict";
import test from "node:test";
import { makePictureIntake, makeSocialWorldEntry } from "./picture-intake.ts";
import {
  addManualScreenplayVersion,
  approveCurrentScreenplay,
  approvedScreenplayBoundary,
  appendScreenplayVersion,
  makePictureScreenplay,
  restoreScreenplayVersion,
  type ScreenplayModelRef,
  type ScreenplayTelemetry,
} from "./screenplay.ts";
import { screenplaySteps } from "./screenplay-prompts.ts";
import { runScreenplayWorkflow, type ScreenplayRuntimePort } from "./screenplay-workflow.ts";

const model: ScreenplayModelRef = {
  id: "lmstudio:writer",
  servedModelId: "writer",
  localCatalogModelId: null,
  displayName: "Writer",
  checkpoint: "writer.gguf",
  precision: "Q4",
  quantization: "Q4_K_M",
  contextLength: 32768,
  sizeBytes: 1,
  runtimeAdapter: "LM Studio",
  status: "ready",
  statusReason: "ready",
};

const telemetry: ScreenplayTelemetry = {
  providerId: "future-provider",
  provider: "Future Local Provider",
  endpoint: "http://127.0.0.1:9999",
  actualLoadedModel: "writer",
  local: true,
  cloudFallback: false,
  modelId: "writer",
  checkpoint: "writer.gguf",
  runtimeAdapter: "future-local",
  loadMs: 1,
  generationMs: 2,
  unloadMs: 1,
  promptTokens: 10,
  generatedTokens: 20,
  peakVramBytes: null,
  peakSystemRamBytes: null,
  resourceMeasurement: "unavailable",
  unloaded: true,
  unloadVerification: "verified",
  measuredAt: 1,
};

function runtime(outputs: string[]): ScreenplayRuntimePort & { prompts: string[]; loads: number; unloads: number } {
  const result = {
    prompts: [] as string[],
    loads: 0,
    unloads: 0,
    async load() { result.loads++; },
    async generate(request: { prompt: string }) {
      result.prompts.push(`${"system" in request ? String(request.system) : ""}\n${request.prompt}`);
      return { text: outputs.shift() ?? "INT. ROOM — DAY\n\nAction.", durationMs: 1, promptTokens: 1, generatedTokens: 2 };
    },
    telemetry: () => telemetry,
    async unload() { result.unloads++; },
  };
  return result;
}

test("single draft loads and unloads once and creates one immutable generated version", async () => {
  const intake = { ...makePictureIntake(1), title: "Still Water", premise: "A diver hears a bell.", screenplayModelId: model.id };
  const port = runtime(["INT. BOAT — NIGHT\n\nMARA listens."]);
  const result = await runScreenplayWorkflow(port, {
    intake,
    screenplay: makePictureScreenplay("single", model.id, 1),
    model,
    runId: "run",
    makeVersionId: () => "v1",
    now: () => 2,
  });
  assert.equal(port.loads, 1);
  assert.equal(port.unloads, 1);
  assert.equal(result.versions.length, 1);
  assert.equal(result.versions[0]?.label, "Draft 1");
  assert.equal(result.status, "READY_FOR_REVIEW");
  assert.equal(result.lastTelemetry?.provider, "Future Local Provider");
});

test("general seven-pass runs draft plus seven sequential passes against the previous version", async () => {
  const intake = { ...makePictureIntake(1), title: "Seven", premise: "A promise returns.", workflow: "general-7-pass" as const, screenplayModelId: model.id };
  const outputs = Array.from({ length: 8 }, (_, index) => `INT. ROOM ${index + 1} — DAY\n\nVersion ${index + 1}.`);
  const port = runtime([...outputs]);
  let n = 0;
  const result = await runScreenplayWorkflow(port, {
    intake,
    screenplay: makePictureScreenplay("general-7-pass", model.id, 1),
    model,
    runId: "run",
    makeVersionId: () => `v${++n}`,
    now: () => n + 2,
  });
  assert.equal(screenplaySteps("general-7-pass").length, 8);
  assert.equal(result.versions.length, 8);
  assert.match(port.prompts[1]!, /CURRENT SCREENPLAY[\s\S]*Version 1/);
  assert.equal(result.versions[7]?.sourceVersionId, "v7");
  assert.equal(port.loads, 1);
  assert.equal(port.unloads, 1);
});

test("biblical workflow preserves confidence categories and cinematic social-world direction", async () => {
  const social = { ...makeSocialWorldEntry("social-1"), expectedBehavior: "An elder receives the first greeting.", visibleReaction: "The room falls silent.", historicalConfidence: "B" as const };
  const intake = {
    ...makePictureIntake(1),
    title: "The Return",
    sourceType: "biblical-historical" as const,
    suppliedSourceText: "Luke 15",
    workflow: "biblical-7-pass" as const,
    screenplayModelId: model.id,
    socialWorld: [social],
  };
  const port = runtime(Array.from({ length: 8 }, (_, index) => `INT. HOUSE ${index} — DAY\n\nThe room falls silent.`));
  let n = 0;
  await runScreenplayWorkflow(port, { intake, screenplay: makePictureScreenplay(intake.workflow, model.id, 1), model, runId: "b", makeVersionId: () => `b${++n}` });
  assert.match(port.prompts[0]!, /A = explicit source\/Scripture/);
  assert.match(port.prompts[0]!, /Never force characters to explain historical symbolism/);
  assert.match(port.prompts[4]!, /Historical confidence: B/);
});

test("manual edits, restore, and approval append versions without destructive overwrite", () => {
  let state = makePictureScreenplay("single", model.id, 1);
  state = appendScreenplayVersion(state, { id: "draft", label: "Draft 1", kind: "draft", fountain: "INT. A — DAY", createdAt: 2, model, workflow: "single", pass: null, sourceVersionId: null, settings: null });
  state = addManualScreenplayVersion(state, "INT. B — NIGHT", "manual", 3);
  state = restoreScreenplayVersion(state, "draft", "restore", 4);
  state = approveCurrentScreenplay(state, "approved", 5);
  assert.deepEqual(state.versions.map((item) => item.id), ["draft", "manual", "restore", "approved"]);
  assert.equal(state.approvedVersionId, "approved");
  assert.equal(state.versions[0]?.fountain, "INT. A — DAY");
});

test("approved boundary exposes only canonical Fountain, stable scene links, and historical metadata", () => {
  const intake = { ...makePictureIntake(1), sourceType: "biblical-historical" as const, sourcePassages: "Luke 15", workflow: "biblical-7-pass" as const };
  let state = makePictureScreenplay(intake.workflow, model.id, 1);
  state = appendScreenplayVersion(state, { id: "v7", label: "Pass 7", kind: "pass", fountain: "INT. HOUSE — DAY\n\nSilence.\n\nEXT. ROAD — DUSK", createdAt: 2, model, workflow: intake.workflow, pass: 7, sourceVersionId: "v6", settings: null });
  state = approveCurrentScreenplay(state, "approved", 3);
  const boundary = approvedScreenplayBoundary("picture", intake, state)!;
  assert.equal(boundary.screenplayVersionId, "approved");
  assert.deepEqual(boundary.scenes.map((scene) => scene.id), ["approved:scene:001", "approved:scene:002"]);
  assert.equal(boundary.historicalContext?.confidenceLegend.C, "Reasonable historical reconstruction");
});

test("canceled generation never creates a partial version and still unloads", async () => {
  const intake = { ...makePictureIntake(1), title: "Stop", premise: "A halted draft.", screenplayModelId: model.id };
  const port = runtime(["INT. PARTIAL — DAY"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runScreenplayWorkflow(port, {
    intake,
    screenplay: makePictureScreenplay("single", model.id, 1),
    model,
    runId: "stop",
    makeVersionId: () => "never",
    signal: controller.signal,
  }), /stopped/);
  assert.equal(port.unloads, 1);
  assert.equal(port.prompts.length, 0);
});

test("unload failure cannot hide the primary generation error", async () => {
  const intake = { ...makePictureIntake(1), title: "Fail", premise: "A failed draft.", screenplayModelId: model.id };
  const port: ScreenplayRuntimePort = {
    async load() {},
    async generate() { throw new Error("generation root cause"); },
    telemetry: () => null,
    async unload() { throw new Error("unload secondary"); },
  };
  await assert.rejects(runScreenplayWorkflow(port, {
    intake,
    screenplay: makePictureScreenplay("single", model.id, 1),
    model,
    runId: "fail",
    makeVersionId: () => "never",
  }), /generation root cause/);
});
