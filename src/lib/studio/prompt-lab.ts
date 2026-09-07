import { defaultPromptCompilerRouting, type PromptCompilerRouting } from "./model-routing.ts";

export type PromptDraft = {
  id: string;
  family: "llama" | "qwen";
  engineId: string;
  text: string;
  canonicalSpecHash: string;
  createdAt: number;
  logicalRole: "prompt-engineer";
  runtimeActivation: "gated-wave-5";
};

export type PromptLabState = {
  schemaVersion: 1;
  routing: PromptCompilerRouting;
  pinnedCompilerServedId: string | null;
  alternate: "none" | "qwen";
  drafts: PromptDraft[];
  benchmarks: ScreenplayRoleBenchmark[];
};

export type ScreenplayRoleBenchmark = {
  role: "writer" | "qa-critic" | "prompt-engineer";
  family: "llama" | "qwen";
  servedModelId: string;
  quantization: string | null;
  contextLength: number | null;
  requestedContextLength: number | null;
  effectiveContextLength: number | null;
  loadMs: number | null;
  generationMs: number | null;
  promptTokens: number | null;
  generatedTokens: number | null;
  peakVramBytes: number | null;
  peakSystemRamBytes: number | null;
  resourceMeasurement: "system-total" | "unavailable";
  unloadVerification: string;
  scores?: Record<string, number> | null;
  status: "pending" | "recorded";
  measuredAt: number;
};

export function emptyPromptLabState(): PromptLabState {
  return {
    schemaVersion: 1,
    routing: defaultPromptCompilerRouting(),
    pinnedCompilerServedId: null,
    alternate: "none",
    drafts: [],
    benchmarks: [],
  };
}

export function hydratePromptLabState(state: PromptLabState | null | undefined): PromptLabState {
  if (!state || state.schemaVersion !== 1) return emptyPromptLabState();
  return {
    ...emptyPromptLabState(),
    ...state,
    routing: { ...emptyPromptLabState().routing, ...state.routing, executionEnabled: false, executionWave: 5, canonicalSpecAuthoritative: true },
    drafts: state.drafts ?? [],
    benchmarks: state.benchmarks ?? [],
  };
}

export function canonicalSpecHash(spec: unknown): string {
  const text = JSON.stringify(spec);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `spec-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function promptLabRuntimeBlock(): string {
  return "Deterministic Llama-default compiler is available. Canonical specs remain the source of truth. Optional Qwen A/B stays explicit and unrun until a served Qwen compiler is pinned. Prompt Lab does not generate video.";
}
