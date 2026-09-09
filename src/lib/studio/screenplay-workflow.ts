import { withProductionInstructions } from "./production-instructions.ts";
import { screenplayOutputBudget } from "./authoring-contract.ts";
import type { PictureIntake } from "./picture-intake.ts";
import type { ResearchContent } from "../research/bible.ts";
import { extractScopedFountain, spliceScopedFountain, type ScreenplayScope, type ScreenplaySelection } from "./screenplay-scope.ts";
import { parseScreenplayHierarchy, previousAndNextSceneSummaries } from "./screenplay-hierarchy.ts";
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
  release?(boundary: "held-resident" | "user-explicit"): Promise<void>;
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
  revisionInstructions?: string;
  generationInstructions?: string;
  stepId?: ScreenplayStep["id"];
  resume?: boolean;
  rewriteScope?: ScreenplayScope;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[] | null;
  selection?: ScreenplaySelection;
  approvedResearch?: ResearchContent | null;
  logicalRole?: import("./model-routing.ts").CrewLogicalRole;
  releaseAtEnd?: boolean;
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
  const settings = { ...DEFAULT_SCREENPLAY_SETTINGS,
    ...(!input.rewriteScope || input.rewriteScope === "full" ? { maxTokens: screenplayOutputBudget(input.intake.targetRuntimeMinutes) } : {}),
    ...input.settings };
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
      const hierarchy = parseScreenplayHierarchy(previous || input.screenplay.workingFountain, state.hierarchy ?? input.screenplay.hierarchy);
      const scopedPrevious = input.rewriteScope && input.rewriteScope !== "full"
        ? extractScopedFountain(previous || input.screenplay.workingFountain, input.rewriteScope, input.selectedNodeId ?? null, {
          nodeIds: input.selectedNodeIds,
          selection: input.selection,
          previous: state.hierarchy ?? input.screenplay.hierarchy,
        })
        : previous;
      const neighbors = input.selectedNodeId ? previousAndNextSceneSummaries(hierarchy, input.selectedNodeId) : { previous: "", next: "" };
      const prompt = buildScreenplayPrompt({
        intake: input.intake,
        workflow: state.workflow,
        step,
        previousFountain: scopedPrevious,
        approvedResearch: input.approvedResearch ?? null,
        scopedPack: {
          scope: input.rewriteScope ?? "full",
          nodeId: input.selectedNodeId ?? null,
          previousSceneSummary: neighbors.previous,
          nextSceneSummary: neighbors.next,
          polishOnly: input.rewriteScope === "polish-only",
        },
      });
      const result = await runtime.generate({
        runId: input.runId,
        stepId: step.id,
        system: withProductionInstructions(prompt.system, input.generationInstructions),
        prompt: input.revisionInstructions ? `${prompt.user}\n\nUSER-REQUESTED STORY DOCTOR REVISION\nApply the following critique recommendations to the supplied scope. Preserve story facts, character identities, cinematography choices and all unaffected wording. Return the complete revised scope as Fountain, with actual line breaks, without commentary or JSON. Do not replace the screenplay with a summary.\n${input.revisionInstructions}` : prompt.user,
      }, config);
      if (input.signal?.aborted) throw new ScreenplayGenerationCanceled();
      const generated = normalizeFountainOutput(result.text);
      if (!generated) throw new Error(`${step.label} returned no screenplay text.`);
      const previousHierarchy = state.hierarchy ?? input.screenplay.hierarchy;
      const spliced = input.rewriteScope && input.rewriteScope !== "full"
        ? spliceScopedFountain(previous || input.screenplay.workingFountain, input.rewriteScope, input.selectedNodeId ?? null, generated, {
          nodeIds: input.selectedNodeIds,
          selection: input.selection,
          previous: previousHierarchy,
        })
        : { fountain: generated, hierarchy: parseScreenplayHierarchy(generated, previousHierarchy) };
      const version: ScreenplayVersion = {
        id: input.makeVersionId(),
        label: input.revisionInstructions ? "Story Doctor revision" : step.id === "draft" ? "Draft 1" : step.label,
        kind: step.id === "draft" ? "draft" : "pass",
        fountain: spliced.fountain,
        createdAt: now(),
        model: input.model,
        workflow: state.workflow,
        pass: step.pass,
        sourceVersionId: state.currentVersionId,
        settings,
        scope: input.rewriteScope ?? "full",
        nodeIds: input.selectedNodeIds ?? (input.selectedNodeId ? [input.selectedNodeId] : null),
        selection: input.selection ?? null,
        logicalRole: input.logicalRole ?? "writer",
        hierarchy: spliced.hierarchy,
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
      previous = spliced.fountain;
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
      if (input.releaseAtEnd) {
        if (runtime.release) await runtime.release("user-explicit");
        else await runtime.unload();
      } else if (runtime.release) {
        await runtime.release("held-resident");
      }
    } catch (unloadError) {
      if (!primaryError) throw unloadError;
    }
  }
  return { ...completed!, lastTelemetry: runtime.telemetry(), updatedAt: now() };
}
