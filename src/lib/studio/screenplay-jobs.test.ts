import assert from "node:assert/strict";
import test from "node:test";
import type { LocalLLMGenerateRequest, LocalLLMGenerateResult, LocalLLMLoadConfig, LocalLLMProvider, LocalLLMProviderDiscovery, LocalLLMServedModel } from "./local-llm-provider.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay, type ScreenplayTelemetry } from "./screenplay.ts";
import { ScreenplayJobManager } from "./screenplay-jobs.server.ts";
import type { ModelCatalog } from "./model-catalog.ts";

import { approvedResearchSnapshot, approveResearchBible, seedResearchBibleFromIntake } from "../research/bible.ts";

const served: LocalLLMServedModel = {
  id: "llama-3.3-70b-instruct",
  displayName: "Llama 3.3 70B Instruct",
  type: "llm",
  loaded: true,
  instanceId: "instance",
  path: null,
  precision: "Q4",
  quantization: "Q4_K_M",
  contextLength: 32768,
  sizeBytes: 10,
};

const emptyCatalog: ModelCatalog = {
  stats: { foldersScanned: 0, filesInspected: 0, logicalModels: 0, standaloneModels: 0, componentModels: 0, loras: 0, unknownUnmapped: 0, totalBytes: 0, scanDurationMs: 0, cacheHits: 0, cacheMisses: 0, root: "D:\\AI\\Models", scannedAt: 1 },
  models: [],
  unmapped: [],
};

const telemetry: ScreenplayTelemetry = {
  providerId: "lm-studio",
  provider: "LM Studio",
  endpoint: "http://127.0.0.1:1234",
  actualLoadedModel: "qwen2.5-72b-instruct",
  local: true,
  cloudFallback: false,
  modelId: "qwen2.5-72b-instruct",
  checkpoint: "qwen2.5-72b-instruct",
  runtimeAdapter: "LM Studio local API",
  loadMs: 1,
  generationMs: 2,
  unloadMs: 1,
  promptTokens: 1,
  generatedTokens: 2,
  peakVramBytes: null,
  peakSystemRamBytes: null,
  resourceMeasurement: "unavailable",
  unloaded: true,
  unloadVerification: "verified",
  measuredAt: 1,
};

class FakeProvider implements LocalLLMProvider {
  readonly id = "lm-studio" as const;
  readonly name = "LM Studio" as const;
  canceled = false;
  blocked = false;
  prompts: string[] = [];
  async discover(): Promise<LocalLLMProviderDiscovery> { return { providerId: this.id, providerName: this.name, endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [served], discoveredAt: 1 }; }
  async listModels() { return [served]; }
  async load(_config: LocalLLMLoadConfig) {}
  async generate(request: LocalLLMGenerateRequest, _config: LocalLLMLoadConfig): Promise<LocalLLMGenerateResult> {
    this.prompts.push(request.prompt);
    request.onToken?.("INT. ROOM — DAY");
    if (this.blocked) {
      await new Promise<void>((resolve, reject) => {
        const timer = setInterval(() => {
          if (!this.canceled) return;
          clearInterval(timer);
          reject(new Error("Screenplay generation stopped."));
        }, 1);
      });
    }
    return { text: "INT. ROOM — DAY\n\nA choice is made.", durationMs: 2, promptTokens: 1, generatedTokens: 2 };
  }
  async cancel() { this.canceled = true; }
  telemetry() { return telemetry; }
  unloads = 0;
  releases: string[] = [];
  async unload() { this.unloads += 1; }
  async releaseResident(boundary: "held-resident" | "user-explicit") { this.releases.push(boundary); }
}

async function settle(manager: ScreenplayJobManager, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const job = manager.get(jobId)!;
    if (!["queued", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("job did not settle");
}

function approvedResearch(intake: ReturnType<typeof makePictureIntake>) {
  const seeded = seedResearchBibleFromIntake(intake, 1);
  const approved = approveResearchBible(seeded, "research-approved", 2);
  if ("error" in approved) throw new Error(approved.error);
  return approved;
}

function input() {
  const intake = { ...makePictureIntake(1), title: "Picture", premise: "A choice.", screenplayModelId: "lmstudio:llama-3.3-70b-instruct" };
  return {
    intake,
    screenplay: { ...makePictureScreenplay("single", "lmstudio:llama-3.3-70b-instruct", 1), pinnedWriterServedId: "llama-3.3-70b-instruct" },
    research: approvedResearch(intake),
    modelId: "lmstudio:llama-3.3-70b-instruct",
  };
}

test("served LM Studio model remains runnable even when the API does not expose a matchable catalog path", async () => {
  const provider = new FakeProvider();
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const status = await manager.status();
  assert.equal(status.models[0]?.status, "ready");
  assert.equal(status.models[0]?.localCatalogModelId, null);
  const started = await manager.start(input());
  const finished = await settle(manager, started.id);
  assert.equal(finished.error, null, finished.error ?? undefined);
  assert.equal(finished.status, "completed");
  assert.equal(finished.screenplay.status, "READY_FOR_REVIEW");
  assert.equal(finished.screenplay.versions.length, 1);
});

test("unapproved research blocks screenplay generation", async () => {
  const manager = new ScreenplayJobManager(new FakeProvider(), () => emptyCatalog);
  const base = input();
  await assert.rejects(manager.start({ ...base, research: seedResearchBibleFromIntake(base.intake, 1) }), /Approve Picture Research/);
});

test("applying recommendations sends critique to the writer and preserves the previous version", async () => {
  const provider = new FakeProvider();
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const base = input();
  base.screenplay.workingFountain = "INT. ROOM - DAY\n\nOriginal scene.";
  const original = base.screenplay.workingFountain;
  const started = await manager.start({ ...base, rewriteScope: "full", revisionInstructions: "Keep the scene but correct the daylight lighting." });
  const done = await settle(manager, started.id);
  assert.equal(done.status, "completed", done.error ?? undefined);
  assert.ok(provider.prompts.some((prompt) => prompt.includes("correct the daylight lighting") && prompt.includes("Original scene.")));
  assert.equal(base.screenplay.workingFountain, original);
  assert.equal(done.screenplay.versions.at(-1)?.label, "Story Doctor revision");
});

test("an exactly selected GPTOSS model runs in the Screenplay department without a Llama fallback", async () => {
  const id = "gptoss-120b-uncensored-hauhaucs-aggressive";
  const provider = new FakeProvider();
  const discover = provider.discover.bind(provider);
  provider.discover = async () => ({ ...await discover(), models: [{ ...served, id, displayName: "GPTOSS 120B" }] });
  let loaded = "";
  provider.load = async (config) => { loaded = config.servedModelId; };
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const base = input();
  const started = await manager.start({ ...base, modelId: `lmstudio:${id}`, screenplay: { ...base.screenplay, selectedModelId: `lmstudio:${id}`, pinnedWriterServedId: id } });
  const finished = await settle(manager, started.id);
  assert.equal(finished.status, "completed", finished.error ?? undefined);
  assert.equal(loaded, id);
  assert.equal(finished.screenplay.pinnedWriterServedId, id);
});

test("family-only or substring pins cannot start generation", async () => {
  const manager = new ScreenplayJobManager(new FakeProvider(), () => emptyCatalog);
  const base = input();
  await assert.rejects(manager.start({ ...base, screenplay: { ...base.screenplay, pinnedWriterServedId: "qwen" } }), /not the pinned served ID|Family names are not accepted/);
});

test("Llama is a valid default writer when exactly pinned and served", async () => {
  const manager = new ScreenplayJobManager(new FakeProvider(), () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const started = await manager.start(input());
  const finished = await settle(manager, started.id);
  assert.equal(finished.status, "completed", finished.error ?? undefined);
});

test("Qwen writer is allowed only with an explicit optional pin", async () => {
  const provider = new FakeProvider();
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" }], discoveredAt: 1 });
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const base = input();
  const started = await manager.start({
    ...base,
    modelId: "lmstudio:qwen2.5-72b-instruct",
    screenplay: { ...base.screenplay, pinnedWriterServedId: "qwen2.5-72b-instruct" },
  });
  const finished = await settle(manager, started.id);
  assert.equal(finished.status, "completed", finished.error ?? undefined);
});

test("Llama writer then QA sequential does not unload between roles", async () => {
  const provider = new FakeProvider();
  let unloads = 0;
  provider.unload = async () => { unloads += 1; };
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const started = await manager.start(input());
  await settle(manager, started.id);
  provider.generate = async () => ({ text: JSON.stringify({ findings: [{ category: "DIALOGUE ISSUE", severity: "note", summary: "Hold the silence.", rewriteSuggested: null, revisionRequired: false }] }), durationMs: 1, promptTokens: 1, generatedTokens: 2 });
  const report = await manager.critique({
    fountain: "INT. ROOM — DAY",
    modelId: "lmstudio:llama-3.3-70b-instruct",
    writerId: "llama-3.3-70b-instruct",
    pinnedQaServedId: "llama-3.3-70b-instruct",
  });
  assert.equal(report.fountainUnchanged, true);
  assert.equal(unloads, 0);
});

test("switching families while resident throws instead of dual-loading", async () => {
  const provider = new FakeProvider();
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const started = await manager.start(input());
  await settle(manager, started.id);
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" }], discoveredAt: 1 });
  await assert.rejects(manager.critique({
    fountain: "INT. ROOM — DAY",
    modelId: "lmstudio:qwen2.5-72b-instruct",
    writerId: "llama-3.3-70b-instruct",
    pinnedQaServedId: "qwen2.5-72b-instruct",
    secondOpinion: true,
  }), /different model family|Release the local model/);
});

test("story doctor critique does not append screenplay versions", async () => {
  const provider = new FakeProvider();
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" }], discoveredAt: 1 });
  provider.generate = async (request) => {
    provider.prompts.push(request.prompt);
    return { text: JSON.stringify({ findings: [{ category: "Dialogue", severity: "note", summary: "Hold the silence.", rewriteSuggested: null }] }), durationMs: 1, promptTokens: 1, generatedTokens: 2 };
  };
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const report = await manager.critique({ fountain: "INT. ROOM — DAY", modelId: "lmstudio:llama-3.3-70b-instruct", writerId: "llama-3.3-70b-instruct", pinnedQaServedId: "llama-3.3-70b-instruct" });
  assert.equal(report.fountainUnchanged, true);
  assert.equal(report.findings[0]?.summary, "Hold the silence.");
});

test("story doctor prompt receives approved Research Bible and no writer hidden context", async () => {
  const provider = new FakeProvider();
  provider.generate = async (request) => {
    provider.prompts.push(request.prompt);
    return { text: JSON.stringify({ findings: [{ category: "Research/fidelity", severity: "note", summary: "Research honored.", rewriteSuggested: null }] }), durationMs: 1, promptTokens: 1, generatedTokens: 2 };
  };
  const intake = { ...makePictureIntake(1), title: "Research Picture", premise: "A tested witness.", sourcePassages: "John 4:9", screenplayModelId: "lmstudio:llama-3.3-70b-instruct" };
  const seeded = seedResearchBibleFromIntake(intake, 1);
  seeded.content.cinematographyManifesto.thesis = "Sodium lamps only";
  seeded.content.notes = "Approved public research note";
  const approved = approveResearchBible(seeded, "research-approved", 2);
  if ("error" in approved) throw new Error(approved.error);
  seeded.content.notes = "Drifted unapproved note";
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  await manager.critique({
    fountain: "INT. ROOM — DAY\n\nA witness waits.",
    modelId: "lmstudio:llama-3.3-70b-instruct",
    writerId: "llama-3.3-70b-instruct",
    pinnedQaServedId: "llama-3.3-70b-instruct",
    approvedResearch: approvedResearchSnapshot(approved),
    goal: "A tested witness holds the scene.",
    characterState: "Witness only",
    continuityState: "The witness begins isolated and ends resolved.",
  });
  const prompt = provider.prompts.at(-1) ?? "";
  assert.match(prompt, /APPROVED RESEARCH BIBLE/);
  assert.match(prompt, /John 4:9/);
  assert.match(prompt, /Sodium lamps only/);
  assert.doesNotMatch(prompt, /Drifted unapproved note/);
  assert.doesNotMatch(prompt, /chain-of-thought/i);
});

test("unavailable provider cannot start generation and no substitute model is used", async () => {
  const provider = new FakeProvider();
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: null, local: true, cloudFallback: false, available: false, reason: "offline", models: [], discoveredAt: 1 });
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  await assert.rejects(manager.start(input()), /not loaded and served/);
});

test("cancel preserves the last saved screenplay state and never advances into media stages", async () => {
  const provider = new FakeProvider();
  provider.blocked = true;
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const started = await manager.start(input());
  await manager.cancel(started.id);
  const finished = await settle(manager, started.id);
  assert.equal(finished.status, "canceled");
  assert.equal(finished.screenplay.versions.length, 0);
  assert.equal(finished.screenplay.status, "DRAFT");
  assert.equal("stage" in finished.screenplay, false);
});

test("releaseAtEnd uses explicit user boundary, clears resident family, then allows explicit family switch", async () => {
  const provider = new FakeProvider();
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const started = await manager.start({ ...input(), releaseAtEnd: true });
  await settle(manager, started.id);
  assert.deepEqual(provider.releases, ["user-explicit"]);
  assert.equal(provider.unloads, 0);

  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" }], discoveredAt: 1 });
  const base = input();
  const qwen = await manager.start({
    ...base,
    modelId: "lmstudio:qwen2.5-72b-instruct",
    screenplay: { ...base.screenplay, selectedModelId: "lmstudio:qwen2.5-72b-instruct", pinnedWriterServedId: "qwen2.5-72b-instruct" },
  });
  const finished = await settle(manager, qwen.id);
  assert.equal(finished.status, "completed", finished.error ?? undefined);
});

test("held-resident boundary does not clear resident family and blocks explicit family switch", async () => {
  const provider = new FakeProvider();
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog, Date.now, () => `id-${Math.random()}`);
  const started = await manager.start(input());
  await settle(manager, started.id);
  assert.deepEqual(provider.releases, ["held-resident"]);
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "qwen2.5-72b-instruct", displayName: "Qwen2.5 72B Instruct" }], discoveredAt: 1 });
  const base = input();
  await assert.rejects(manager.start({
    ...base,
    modelId: "lmstudio:qwen2.5-72b-instruct",
    screenplay: { ...base.screenplay, selectedModelId: "lmstudio:qwen2.5-72b-instruct", pinnedWriterServedId: "qwen2.5-72b-instruct" },
  }), /different model family|Release the local model/);
});
