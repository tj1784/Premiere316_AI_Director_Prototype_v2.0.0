import assert from "node:assert/strict";
import test from "node:test";
import type { LocalLLMGenerateRequest, LocalLLMGenerateResult, LocalLLMLoadConfig, LocalLLMProvider, LocalLLMProviderDiscovery, LocalLLMServedModel } from "./local-llm-provider.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay, type ScreenplayTelemetry } from "./screenplay.ts";
import { ScreenplayJobManager } from "./screenplay-jobs.server.ts";
import type { ModelCatalog } from "./model-catalog.ts";

import { approveResearchBible, seedResearchBibleFromIntake } from "../research/bible.ts";

const served: LocalLLMServedModel = {
  id: "qwen2.5-72b-instruct",
  displayName: "Qwen2.5 72B Instruct",
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
  async discover(): Promise<LocalLLMProviderDiscovery> { return { providerId: this.id, providerName: this.name, endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [served], discoveredAt: 1 }; }
  async listModels() { return [served]; }
  async load(_config: LocalLLMLoadConfig) {}
  async generate(request: LocalLLMGenerateRequest, _config: LocalLLMLoadConfig): Promise<LocalLLMGenerateResult> {
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
  async unload() {}
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
  const intake = { ...makePictureIntake(1), title: "Picture", premise: "A choice.", screenplayModelId: "lmstudio:qwen2.5-72b-instruct" };
  return {
    intake,
    screenplay: makePictureScreenplay("single", "lmstudio:qwen2.5-72b-instruct", 1),
    research: approvedResearch(intake),
    modelId: "lmstudio:qwen2.5-72b-instruct",
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
  assert.equal(finished.status, "completed");
  assert.equal(finished.screenplay.status, "READY_FOR_REVIEW");
  assert.equal(finished.screenplay.versions.length, 1);
});

test("unapproved research blocks screenplay generation", async () => {
  const manager = new ScreenplayJobManager(new FakeProvider(), () => emptyCatalog);
  const base = input();
  await assert.rejects(manager.start({ ...base, research: seedResearchBibleFromIntake(base.intake, 1) }), /Approve Picture Research/);
});

test("non-Qwen served models are not used as a writer substitute", async () => {
  const provider = new FakeProvider();
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" }], discoveredAt: 1 });
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const base = input();
  await assert.rejects(manager.start({ ...base, modelId: "lmstudio:llama-3.3-70b-instruct" }), /Qwen/);
});

test("story doctor critique does not append screenplay versions", async () => {
  const provider = new FakeProvider();
  provider.discover = async () => ({ providerId: "lm-studio", providerName: "LM Studio", endpoint: "http://127.0.0.1:1234", local: true, cloudFallback: false, available: true, reason: "ready", models: [{ ...served, id: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" }], discoveredAt: 1 });
  provider.generate = async () => ({ text: JSON.stringify({ findings: [{ category: "Dialogue", severity: "note", summary: "Hold the silence.", rewriteSuggested: null }] }), durationMs: 1, promptTokens: 1, generatedTokens: 2 });
  const manager = new ScreenplayJobManager(provider, () => emptyCatalog);
  const report = await manager.critique({ fountain: "INT. ROOM — DAY", modelId: "lmstudio:llama-3.3-70b-instruct", writerId: "lmstudio:qwen2.5-72b-instruct" });
  assert.equal(report.fountainUnchanged, true);
  assert.equal(report.findings[0]?.summary, "Hold the silence.");
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
