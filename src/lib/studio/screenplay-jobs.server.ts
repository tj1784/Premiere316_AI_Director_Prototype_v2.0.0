import { randomUUID } from "node:crypto";
import type { LocalLLMProvider, LocalLLMProviderDiscovery } from "./local-llm-provider.ts";
import type { ModelCatalog } from "./model-catalog.ts";
import type { PictureIntake } from "./picture-intake.ts";
import type { ScreenplayStep } from "./screenplay-prompts.ts";
import type { PictureScreenplay, ScreenplayGenerationSettings, ScreenplayModelRef, ScreenplayTelemetry } from "./screenplay.ts";
import { screenplayModelsFromProvider } from "./screenplay-models.ts";
import {
  runScreenplayWorkflow,
  ScreenplayGenerationCanceled,
  type ScreenplayRuntimeConfig,
  type ScreenplayRuntimePort,
} from "./screenplay-workflow.ts";

export type LocalLLMStatus = {
  provider: LocalLLMProviderDiscovery;
  models: ScreenplayModelRef[];
};

export type ScreenplayJobSnapshot = {
  id: string;
  status: "queued" | "running" | "completed" | "canceled" | "failed";
  partialFountain: string;
  activeLabel: string;
  screenplay: PictureScreenplay;
  telemetry: ScreenplayTelemetry | null;
  error: string | null;
  updatedAt: number;
};

export type StartScreenplayJobInput = {
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  modelId: string;
  settings?: Partial<ScreenplayGenerationSettings>;
  stepId?: ScreenplayStep["id"];
  resume?: boolean;
};

export class ScreenplayJobManager {
  readonly #jobs = new Map<string, ScreenplayJobSnapshot>();
  readonly #canceledJobs = new Set<string>();
  #activeJobId: string | null = null;
  private readonly provider: LocalLLMProvider;
  private readonly loadCatalog: () => Promise<ModelCatalog> | ModelCatalog;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    provider: LocalLLMProvider,
    loadCatalog: () => Promise<ModelCatalog> | ModelCatalog,
    now: () => number = Date.now,
    id: () => string = randomUUID,
  ) {
    this.provider = provider;
    this.loadCatalog = loadCatalog;
    this.now = now;
    this.id = id;
  }

  async status(): Promise<LocalLLMStatus> {
    const [provider, catalog] = await Promise.all([this.provider.discover(), this.loadCatalog()]);
    return { provider, models: screenplayModelsFromProvider(catalog, provider) };
  }

  async start(input: StartScreenplayJobInput): Promise<ScreenplayJobSnapshot> {
    if (this.#activeJobId) {
      const active = this.#jobs.get(this.#activeJobId);
      if (active?.status === "queued" || active?.status === "running") throw new Error("Another screenplay workflow is already running.");
    }
    const status = await this.status();
    const model = status.models.find((item) => item.id === input.modelId && item.status === "ready");
    if (!model) throw new Error("The selected screenplay model is not loaded and served by LM Studio.");
    const jobId = this.id();
    const snapshot: ScreenplayJobSnapshot = {
      id: jobId,
      status: "queued",
      partialFountain: "",
      activeLabel: "Preparing local model",
      screenplay: input.screenplay,
      telemetry: null,
      error: null,
      updatedAt: this.now(),
    };
    this.#jobs.set(jobId, snapshot);
    this.#activeJobId = jobId;
    void this.#execute(jobId, input, model);
    return { ...snapshot };
  }

  get(jobId: string): ScreenplayJobSnapshot | null {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async cancel(jobId: string): Promise<ScreenplayJobSnapshot | null> {
    const job = this.#jobs.get(jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) return this.get(jobId);
    job.status = "canceled";
    this.#canceledJobs.add(jobId);
    job.activeLabel = "Stopping";
    job.screenplay = {
      ...job.screenplay,
      status: job.screenplay.versions.some((item) => item.kind !== "original-intake") ? "READY_FOR_REVIEW" : "DRAFT",
      generation: null,
    };
    job.updatedAt = this.now();
    await this.provider.cancel();
    return this.get(jobId);
  }

  async #execute(jobId: string, input: StartScreenplayJobInput, model: ScreenplayModelRef): Promise<void> {
    const job = this.#jobs.get(jobId)!;
    const runtime: ScreenplayRuntimePort = {
      load: (config: ScreenplayRuntimeConfig) => this.provider.load({ servedModelId: config.servedModelId, settings: config.settings }),
      generate: async (request, config) => {
        job.partialFountain = "";
        const result = await this.provider.generate({
          ...request,
          onToken: (token) => {
            job.partialFountain += token;
            job.updatedAt = this.now();
          },
        }, { servedModelId: config.servedModelId, settings: config.settings });
        return result;
      },
      cancel: () => this.provider.cancel(),
      telemetry: () => this.provider.telemetry(),
      unload: () => this.provider.unload(),
    };
    job.status = "running";
    job.updatedAt = this.now();
    try {
      const screenplay = await runScreenplayWorkflow(runtime, {
        intake: input.intake,
        screenplay: input.screenplay,
        model,
        runId: jobId,
        settings: input.settings,
        stepId: input.stepId,
        resume: input.resume,
        makeVersionId: this.id,
        now: this.now,
        onUpdate: ({ state, step, phase }) => {
          job.screenplay = state;
          job.activeLabel = phase === "starting" ? step.label : `${step.label} complete`;
          if (phase === "completed") job.partialFountain = state.workingFountain;
          job.updatedAt = this.now();
        },
      });
      if (!this.#canceledJobs.has(jobId)) {
        job.status = "completed";
        job.activeLabel = "Ready for review";
      }
      job.screenplay = screenplay;
      job.telemetry = screenplay.lastTelemetry;
    } catch (error) {
      const canceled = this.#canceledJobs.has(jobId) || error instanceof ScreenplayGenerationCanceled || /abort|stopp/i.test(error instanceof Error ? error.message : String(error));
      job.status = canceled ? "canceled" : "failed";
      job.activeLabel = canceled ? "Stopped" : "Generation failed";
      job.error = canceled ? null : error instanceof Error ? error.message : String(error);
      job.screenplay = {
        ...job.screenplay,
        status: job.screenplay.versions.some((item) => item.kind !== "original-intake") ? "READY_FOR_REVIEW" : "DRAFT",
        generation: null,
      };
      job.telemetry = this.provider.telemetry();
    } finally {
      job.updatedAt = this.now();
      if (this.#activeJobId === jobId) this.#activeJobId = null;
    }
  }
}
