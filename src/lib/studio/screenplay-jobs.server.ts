import { exactLocalWriterBlock } from "./exact-local-writer.ts";
import { withProductionInstructions } from "./production-instructions.ts";
import { randomUUID } from "node:crypto";
import type { LocalLLMProvider, LocalLLMProviderDiscovery } from "./local-llm-provider.ts";
import type { ModelCatalog } from "./model-catalog.ts";
import type { PictureIntake } from "./picture-intake.ts";
import type { PictureResearchBible } from "../research/bible.ts";
import { approvedResearchSnapshot, researchBlocksScreenplay } from "../research/bible.ts";
import {
  classifyLocalWriterFamily,
  llamaQaBlockReason,
  qwenWriterBlockReason,
} from "./qwen-writer-identity.ts";
import { refuseAutomaticDualFamily } from "./model-routing.ts";
import {
  parseScreenplayQaReport,
  SECOND_OPINION_SYSTEM,
  STORY_DOCTOR_SYSTEM,
  type ScreenplayQaReport,
} from "./screenplay-qa.ts";
import { extractScopedFountain, type ScreenplayScope } from "./screenplay-scope.ts";
import { buildStoryDoctorUser } from "./screenplay-prompts.ts";
import type { ScreenplayStep } from "./screenplay-prompts.ts";
import {
  DEFAULT_SCREENPLAY_SETTINGS,
  type PictureScreenplay,
  type ScreenplayGenerationSettings,
  type ScreenplayModelRef,
  type ScreenplayTelemetry,
} from "./screenplay.ts";
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
  sourceContextFingerprint?: string;
  id: string;
  status: "queued" | "running" | "completed" | "canceled" | "failed";
  partialFountain: string;
  reasoning?: string;
  startedAt?: number;
  activeLabel: string;
  screenplay: PictureScreenplay;
  telemetry: ScreenplayTelemetry | null;
  error: string | null;
  updatedAt: number;
};

export type StartScreenplayJobInput = {
  sourceContextFingerprint?: string;
  productionBinding?: import("./production-profiles.ts").ProductionModelBinding;
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  research?: PictureResearchBible | null;
  modelId: string;
  settings?: Partial<ScreenplayGenerationSettings>;
  revisionInstructions?: string;
  generationInstructions?: string;
  stepId?: ScreenplayStep["id"];
  resume?: boolean;
  rewriteScope?: ScreenplayScope;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[] | null;
  selection?: import("./screenplay-scope.ts").ScreenplaySelection;
  logicalRole?: import("./model-routing.ts").CrewLogicalRole;
  releaseAtEnd?: boolean;
};

export class ScreenplayJobManager {
  readonly #jobs = new Map<string, ScreenplayJobSnapshot>();
  readonly #canceledJobs = new Set<string>();
  readonly #productionJobs = new Set<string>();
  #productionQa = false;
  #activeJobId: string | null = null;
  #qaActive = false;
  #qaCanceled = false;
  #residentFamily: "llama" | "qwen" | "other" | null = null;
  private readonly provider: LocalLLMProvider;
  private readonly loadCatalog: () => Promise<ModelCatalog> | ModelCatalog;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly productionGenerate: typeof import("./bible-runtime.server.ts").generateBibleUnit;

  constructor(
    provider: LocalLLMProvider,
    loadCatalog: () => Promise<ModelCatalog> | ModelCatalog,
    now: () => number = Date.now,
    id: () => string = randomUUID,
    productionGenerate: typeof import("./bible-runtime.server.ts").generateBibleUnit = async (
      input,
    ) => (await import("./bible-runtime.server.ts")).generateBibleUnit(input),
  ) {
    this.provider = provider;
    this.loadCatalog = loadCatalog;
    this.now = now;
    this.id = id;
    this.productionGenerate = productionGenerate;
  }

  async status(): Promise<LocalLLMStatus> {
    const [provider, catalog] = await Promise.all([this.provider.discover(), this.loadCatalog()]);
    return { provider, models: screenplayModelsFromProvider(catalog, provider) };
  }

  async start(input: StartScreenplayJobInput): Promise<ScreenplayJobSnapshot> {
    if (this.#qaActive)
      throw new Error("Story Doctor is still running. Stop it before starting a rewrite.");
    if (this.#activeJobId) {
      const active = this.#jobs.get(this.#activeJobId);
      if (active?.status === "queued" || active?.status === "running")
        throw new Error("Another screenplay workflow is already running.");
    }
    const status = input.productionBinding ? null : await this.status();
    const blockedResearch = researchBlocksScreenplay(input.research ?? null);
    if (blockedResearch) throw new Error(blockedResearch);
    const approvedResearch = approvedResearchSnapshot(input.research ?? null);
    if (!approvedResearch)
      throw new Error("Approve Picture Research before generating a screenplay.");
    if (input.productionBinding && !["writer", "rewrite"].includes(input.productionBinding.role))
      throw new Error("Screenplay jobs require the declared writer or rewrite role.");
    const binding = input.productionBinding;
    const model: ScreenplayModelRef | undefined = binding
      ? {
          id: binding.callableModelId ?? "unavailable",
          servedModelId: binding.callableModelId ?? "unavailable",
          localCatalogModelId: null,
          displayName: binding.label,
          checkpoint: binding.artifactPath ?? "",
          precision: "",
          quantization: binding.quantization ?? "",
          contextLength: null,
          sizeBytes: 0,
          runtimeAdapter: binding.provider,
          status: "needs-validation",
          statusReason: "Exact identity is checked by the production runtime before each request.",
        }
      : status!.models.find((item) => item.id === input.modelId && item.status === "ready");
    if (!model)
      throw new Error("The selected screenplay model is not loaded and served by LM Studio.");
    const blockedWriter = binding
      ? null
      : exactLocalWriterBlock(
          model,
          status!.provider.available,
          input.screenplay.pinnedWriterServedId,
        );
    if (blockedWriter) throw new Error(blockedWriter);
    const family = classifyLocalWriterFamily(model);
    if (!binding && this.#residentFamily && this.#residentFamily !== family) {
      throw new Error(
        "A different model family is still claimed as resident. Release the local model before switching families. Premiere316 will not dual-load.",
      );
    }
    const jobId = this.id();
    const snapshot: ScreenplayJobSnapshot = {
      sourceContextFingerprint: input.sourceContextFingerprint,
      id: jobId,
      status: "queued",
      partialFountain: "",
      reasoning: "",
      startedAt: this.now(),
      activeLabel: "Preparing local model",
      screenplay: input.screenplay,
      telemetry: null,
      error: null,
      updatedAt: this.now(),
    };
    this.#jobs.set(jobId, snapshot);
    if (binding) this.#productionJobs.add(jobId);
    this.#activeJobId = jobId;
    if (!binding) this.#residentFamily = family;
    void this.#execute(jobId, input, model);
    return { ...snapshot };
  }

  async critique(
    input: {
      productionBinding?: import("./production-profiles.ts").ProductionModelBinding;
      fountain: string;
      modelId: string;
      writerId: string | null;
      pinnedQaServedId?: string | null;
      secondOpinion?: boolean;
      goal?: string;
      revisionTarget?: string;
      rewriteScope?: ScreenplayScope;
      selectedNodeId?: string | null;
      selectedNodeIds?: string[] | null;
      selection?: import("./screenplay-scope.ts").ScreenplaySelection;
      approvedResearch?: import("../research/bible.ts").ResearchContent | null;
      characterState?: string;
      continuityState?: string;
      directorNotes?: string;
      generationInstructions?: string;
    },
    progress?: { onToken?: (text: string) => void; onReasoning?: (text: string) => void },
  ): Promise<ScreenplayQaReport> {
    if (this.#qaActive || this.#activeJobId)
      throw new Error(
        "Another local screenplay operation is running. Stop it before starting Story Doctor.",
      );
    this.#qaActive = true;
    this.#qaCanceled = false;
    this.#productionQa = Boolean(input.productionBinding);
    try {
      if (input.productionBinding) {
        const binding = input.productionBinding;
        if (!["reviewer", "challenger"].includes(binding.role))
          throw new Error("Critique requires the declared reviewer or challenger role.");
        const result = await this.productionGenerate({
          requestId: `critique:${this.id()}`,
          binding,
          system: withProductionInstructions(
            input.secondOpinion ? SECOND_OPINION_SYSTEM : STORY_DOCTOR_SYSTEM,
            input.generationInstructions,
          ),
          prompt:
            buildStoryDoctorUser({
              goal: input.goal ?? "",
              approvedResearch: input.approvedResearch ?? null,
              characterState: input.characterState,
              continuityState: input.continuityState,
              fountain: extractScopedFountain(
                input.fountain,
                input.rewriteScope ?? "full",
                input.selectedNodeId ?? null,
                { nodeIds: input.selectedNodeIds, selection: input.selection },
              ),
              revisionTarget: input.revisionTarget ?? input.rewriteScope ?? "full",
            }) + `\nDirector instructions: ${input.directorNotes ?? ""}`,
        });
        if (this.#qaCanceled) throw new Error("Story Doctor stopped.");
        const model: ScreenplayModelRef = {
          id: result.modelId,
          servedModelId: result.modelId,
          displayName: binding.label,
          localCatalogModelId: null,
          checkpoint: binding.artifactPath ?? "",
          precision: "",
          quantization: binding.quantization ?? "",
          contextLength: null,
          sizeBytes: 0,
          runtimeAdapter: binding.provider,
          status: "ready",
          statusReason: "Validated production-runtime request completed.",
        };
        const parsed = parseScreenplayQaReport(
          result.text,
          this.id(),
          this.now(),
          model,
          input.secondOpinion ? "second-opinion" : "qa-critic",
        );
        if ("error" in parsed) throw new Error(parsed.error);
        progress?.onToken?.(result.text);
        return parsed;
      }
      const status = await this.status();
      const model = status.models.find(
        (item) => item.id === input.modelId && item.status === "ready",
      );
      const blocked = exactLocalWriterBlock(
        model ?? null,
        status.provider.available,
        input.pinnedQaServedId ?? input.writerId,
      );
      if (blocked || !model) throw new Error(blocked ?? "Story Doctor model is not served.");
      const qaFamily = classifyLocalWriterFamily(model);
      const writerFamily =
        input.writerId && input.pinnedQaServedId === input.writerId
          ? qaFamily
          : classifyLocalWriterFamily({
              id: input.writerId ?? "",
              servedModelId: input.writerId ?? "",
              displayName: input.writerId ?? "",
            });
      const dual = refuseAutomaticDualFamily(
        writerFamily === "other" ? "llama" : writerFamily,
        qaFamily === "other" ? "llama" : qaFamily,
        Boolean(input.secondOpinion),
      );
      if (dual) throw new Error(dual);
      if (this.#residentFamily && qaFamily !== "other" && this.#residentFamily !== qaFamily) {
        throw new Error(
          "A different model family is still claimed as resident. Release the local model before switching families.",
        );
      }
      const settings = DEFAULT_SCREENPLAY_SETTINGS;
      await this.provider.load({ servedModelId: model.servedModelId, settings });
      this.#residentFamily =
        qaFamily === "qwen" || qaFamily === "llama" ? qaFamily : this.#residentFamily;
      const scopedFountain = extractScopedFountain(
        input.fountain,
        input.rewriteScope ?? "full",
        input.selectedNodeId ?? null,
        {
          nodeIds: input.selectedNodeIds,
          selection: input.selection,
        },
      );
      if (this.#qaCanceled) throw new Error("Story Doctor stopped.");
      const result = await this.provider.generate(
        {
          runId: this.id(),
          stepId: input.secondOpinion ? "qa-second-opinion" : "qa",
          system: withProductionInstructions(
            input.secondOpinion ? SECOND_OPINION_SYSTEM : STORY_DOCTOR_SYSTEM,
            input.generationInstructions,
          ),
          onToken: progress?.onToken,
          onReasoning: progress?.onReasoning,
          prompt:
            buildStoryDoctorUser({
              goal: input.goal ?? "",
              approvedResearch: input.approvedResearch ?? null,
              characterState: input.characterState,
              continuityState: input.continuityState,
              fountain: scopedFountain,
              revisionTarget: input.revisionTarget ?? input.rewriteScope ?? "full",
            }) +
            `\n\nEXPLICIT PICTURE DIRECTOR INSTRUCTIONS: ${input.directorNotes ?? ""}\nEvaluate against the approved screenplay and these instructions. Do not recommend replacing explicitly chosen costume colors or creative presentation merely because another style is more common.`,
        },
        { servedModelId: model.servedModelId, settings },
      );
      const parsed = parseScreenplayQaReport(
        result.text,
        this.id(),
        this.now(),
        model,
        input.secondOpinion ? "second-opinion" : "qa-critic",
      );
      if ("error" in parsed) throw new Error(parsed.error);
      if (this.#qaCanceled) throw new Error("Story Doctor stopped.");
      return parsed;
    } finally {
      this.#qaActive = false;
      this.#productionQa = false;
    }
  }

  async cancelCritique(): Promise<void> {
    if (this.#qaActive) {
      this.#qaCanceled = true;
      if (!this.#productionQa) await this.provider.cancel();
    }
  }

  async releaseResident(): Promise<void> {
    if (this.provider.releaseResident) await this.provider.releaseResident("user-explicit");
    else await this.provider.unload();
    this.#residentFamily = null;
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
      status: job.screenplay.versions.some((item) => item.kind !== "original-intake")
        ? "READY_FOR_REVIEW"
        : "DRAFT",
      generation: null,
    };
    job.updatedAt = this.now();
    if (!this.#productionJobs.has(jobId)) await this.provider.cancel();
    job.activeLabel = "Stopped";
    return this.get(jobId);
  }

  async #execute(
    jobId: string,
    input: StartScreenplayJobInput,
    model: ScreenplayModelRef,
  ): Promise<void> {
    const job = this.#jobs.get(jobId)!;
    const runtime: ScreenplayRuntimePort = {
      load: (config: ScreenplayRuntimeConfig) =>
        input.productionBinding
          ? Promise.resolve()
          : this.provider.load({ servedModelId: config.servedModelId, settings: config.settings }),
      generate: async (request, config) => {
        job.partialFountain = "";
        job.reasoning = "";
        if (input.productionBinding) {
          if (this.#canceledJobs.has(jobId)) throw new ScreenplayGenerationCanceled();
          const started = this.now();
          const result = await this.productionGenerate({
            requestId: `screenplay:${jobId}:${request.stepId}`,
            binding: input.productionBinding,
            system: request.system,
            prompt: request.prompt,
          });
          model.status = "ready";
          model.statusReason = "Validated production-runtime request completed.";
          if (this.#canceledJobs.has(jobId)) throw new ScreenplayGenerationCanceled();
          job.partialFountain = result.text;
          return {
            text: result.text,
            durationMs: this.now() - started,
            promptTokens: null,
            generatedTokens: null,
          };
        }
        const result = await this.provider.generate(
          {
            ...request,
            thinkingEnabled: false,
            onReasoning: (text) => {
              job.reasoning = ((job.reasoning ?? "") + text).slice(-40000);
              job.updatedAt = this.now();
            },
            onToken: (token) => {
              job.partialFountain += token;
              job.updatedAt = this.now();
            },
          },
          { servedModelId: config.servedModelId, settings: config.settings },
        );
        return result;
      },
      cancel: () => (input.productionBinding ? Promise.resolve() : this.provider.cancel()),
      telemetry: () => (input.productionBinding ? null : this.provider.telemetry()),
      unload: () => (input.productionBinding ? Promise.resolve() : this.provider.unload()),
      release: async (boundary) => {
        if (input.productionBinding) return; // The shared production runtime releases only its own load.
        if (this.provider.releaseResident) await this.provider.releaseResident(boundary);
        else if (boundary === "user-explicit") await this.provider.unload();
        if (boundary === "user-explicit") this.#residentFamily = null;
      },
    };
    job.status = "running";
    job.updatedAt = this.now();
    try {
      const screenplay = await runScreenplayWorkflow(runtime, {
        validateAtDispatch: Boolean(input.productionBinding),
        intake: input.intake,
        screenplay: input.screenplay,
        model,
        runId: jobId,
        settings: input.settings,
        revisionInstructions: input.revisionInstructions,
        generationInstructions: input.generationInstructions,
        stepId: input.stepId,
        resume: input.resume,
        rewriteScope: input.rewriteScope,
        selectedNodeId: input.selectedNodeId,
        selectedNodeIds: input.selectedNodeIds,
        selection: input.selection ?? null,
        logicalRole: input.logicalRole ?? "writer",
        releaseAtEnd: Boolean(input.releaseAtEnd),
        approvedResearch: approvedResearchSnapshot(input.research ?? null),
        makeVersionId: this.id,
        now: this.now,
        onUpdate: ({ state, step, phase }) => {
          job.screenplay = state;
          const label = input.revisionInstructions
            ? "Applying Story Doctor recommendations"
            : step.label;
          job.activeLabel = phase === "starting" ? label : `${label} complete`;
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
      const canceled =
        this.#canceledJobs.has(jobId) ||
        error instanceof ScreenplayGenerationCanceled ||
        /abort|stopp/i.test(error instanceof Error ? error.message : String(error));
      job.status = canceled ? "canceled" : "failed";
      job.activeLabel = canceled ? "Stopped" : "Generation failed";
      job.error = canceled ? null : error instanceof Error ? error.message : String(error);
      job.screenplay = {
        ...job.screenplay,
        status: job.screenplay.versions.some((item) => item.kind !== "original-intake")
          ? "READY_FOR_REVIEW"
          : "DRAFT",
        generation: null,
      };
      job.telemetry = input.productionBinding ? null : this.provider.telemetry();
    } finally {
      job.updatedAt = this.now();
      if (this.#activeJobId === jobId) this.#activeJobId = null;
    }
  }
}
