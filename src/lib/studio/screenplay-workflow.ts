import type { PictureIntake } from "./picture-intake.ts";
import { buildScreenplayPrompt, normalizeFountainOutput, screenplaySteps, type ScreenplayStep } from "./screenplay-prompts.ts";
import {
  DEFAULT_SCREENPLAY_SETTINGS,
  appendScreenplayVersion,
  type PictureScreenplay,
  type ScreenplayGenerationSettings,
  type ScreenplayModelRef,
  type ScreenplayTelemetry,
  type ScreenplayVersion,
} from "./screenplay.ts";

export type ScreenplayRuntimeConfig = {
  modelId: string;
  servedModelId: string;
  settings: ScreenplayGenerationSettings;
};

export type ScreenplayGenerateRequest = {
  runId: string;
  stepId: ScreenplayStep["id"];
  system: string;
  prompt: string;
};

export type ScreenplayGenerateResult = {
  text: string;
  durationMs: number;
  promptTokens: number | null;
  generatedTokens: number | null;
};

export type ScreenplayRuntimePort = {
  load(config: ScreenplayRuntimeConfig): Promise<void>;
  generate(request: ScreenplayGenerateRequest, config: ScreenplayRuntimeConfig): Promise<ScreenplayGenerateResult>;
  unload(): Promise<void>;
  telemetry(): ScreenplayTelemetry | null;
  cancel?(): Promise<void> | void;
};

export type WorkflowUpdate = {
  state: PictureScreenplay;
  step: ScreenplayStep;
  phase: "starting" | "completed";
};

export type WorkflowRunInput = {
  intake: PictureIntake;
  screenplay: PictureScreenplay;
  model: ScreenplayModelRef;
  runId: string;
  makeVersionId: () => string;
  now?: () => number;
  settings?: Partial<ScreenplayGenerationSettings>;
  stepId?: ScreenplayStep["id"];
  resume?: boolean;
  signal?: AbortSignal;
  onUpdate?: (update: WorkflowUpdate) => void | Promise<void>;
};

export class ScreenplayGenerationCanceled extends Error {
  constructor() {
    super("Screenplay generation stopped.");
    this.name = "ScreenplayGenerationCanceled";
  }
}

export async function runScreenplayWorkflow(runtime: ScreenplayRuntimePort, input: WorkflowRunInput): Promise<PictureScreenplay> {
  if (input.model.status !== "ready") throw new Error(input.model.statusReason || "Selected screenplay model is not runnable.");
  const settings = { ...DEFAULT_SCREENPLAY_SETTINGS, ...input.settings };
  const config: ScreenplayRuntimeConfig = {
    modelId: input.model.id,
    servedModelId: input.model.servedModelId,
    settings,
  };
  const allSteps = screenplaySteps(input.screenplay.workflow);
  const completedLabels = new Set(input.screenplay.versions.map((version) => version.label === "Draft 1" ? "Draft" : version.label));
  const steps = input.stepId
    ? allSteps.filter((step) => step.id === input.stepId)
    : input.resume
      ? allSteps.filter((step) => !completedLabels.has(step.label))
      : allSteps;
  if (!steps.length) throw new Error("No remaining screenplay passes to continue.");
  const now = input.now ?? Date.now;
  let state: PictureScreenplay = {
    ...input.screenplay,
    selectedModelId: input.model.id,
    status: "GENERATING",
    generation: {
      runId: input.runId,
      startedAt: now(),
      activeStep: 0,
      totalSteps: steps.length,
      activeLabel: steps[0]?.label ?? "Draft",
      completedLabels: [],
      modelId: input.model.id,
    },
    updatedAt: now(),
  };
  let previous = state.workingFountain;
  let completed: PictureScreenplay | null = null;
  let primaryError: unknown = null;
  try {
    await runtime.load(config);
    for (let index = 0; index < steps.length; index++) {
      if (input.signal?.aborted) throw new ScreenplayGenerationCanceled();
      const step = steps[index]!;
      state = {
        ...state,
        generation: {
          ...state.generation!,
          activeStep: index,
          activeLabel: step.label,
        },
      };
      await input.onUpdate?.({ state, step, phase: "starting" });
      const prompt = buildScreenplayPrompt({
        intake: input.intake,
        workflow: state.workflow,
        step,
        previousFountain: previous,
      });
      const result = await runtime.generate({
        runId: input.runId,
        stepId: step.id,
        system: prompt.system,
        prompt: prompt.user,
      }, config);
      if (input.signal?.aborted) throw new ScreenplayGenerationCanceled();
      const fountain = normalizeFountainOutput(result.text);
      if (!fountain) throw new Error(`${step.label} returned no screenplay text.`);
      const version: ScreenplayVersion = {
        id: input.makeVersionId(),
        label: step.id === "draft" ? "Draft 1" : step.label,
        kind: step.id === "draft" ? "draft" : "pass",
        fountain,
        createdAt: now(),
        model: input.model,
        workflow: state.workflow,
        pass: step.pass,
        sourceVersionId: state.currentVersionId,
        settings,
      };
      state = appendScreenplayVersion(state, version);
      state = {
        ...state,
        status: "GENERATING",
        generation: {
          ...state.generation!,
          completedLabels: [...state.generation!.completedLabels, step.label],
        },
      };
      previous = fountain;
      await input.onUpdate?.({ state, step, phase: "completed" });
    }
    completed = { ...state, status: "READY_FOR_REVIEW", generation: null, updatedAt: now() };
  } catch (error) {
    primaryError = input.signal?.aborted && !(error instanceof ScreenplayGenerationCanceled)
      ? new ScreenplayGenerationCanceled()
      : error;
    throw primaryError;
  } finally {
    try {
      await runtime.unload();
    } catch (unloadError) {
      if (!primaryError) throw unloadError;
    }
  }
  return { ...completed!, lastTelemetry: runtime.telemetry(), updatedAt: now() };
}
