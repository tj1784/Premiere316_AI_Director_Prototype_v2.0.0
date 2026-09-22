export const PRODUCTION_PROFILE_REVISION = 6 as const;

export type ProductionProfileId = "astra-ultra" | "local-models";
export type ProductionExecutionMode = "guided" | "autonomous-complete-script";
export type ProductionRoleId = "architect" | "writer" | "challenger" | "rewrite" | "prompt-cue" | "reviewer";
export type ProductionBindingStatus = "needs-refresh" | "installed" | "loaded" | "unavailable" | "needs-verification";

export type ProductionModelBinding = {
  role: ProductionRoleId;
  label: string;
  provider: "astra" | "lmstudio";
  callableModelId: string | null;
  artifactPath: string | null;
  artifactFileName: string | null;
  quantization: string | null;
  optional: boolean;
  status: ProductionBindingStatus;
  statusReason: string;
};

export type ProductionRunSnapshot = {
  id: string;
  profileId: ProductionProfileId;
  mode: ProductionExecutionMode;
  profileRevision: number;
  bindings: ProductionModelBinding[];
  startedAt: number;
  status: "ready" | "running" | "awaiting-review" | "paused" | "canceled" | "failed" | "complete";
};

export type ProductionRoutingState = {
  schemaVersion: 1;
  profileRevision: typeof PRODUCTION_PROFILE_REVISION;
  profileId: ProductionProfileId;
  executionMode: ProductionExecutionMode;
  bindings: ProductionModelBinding[];
  activeRun: ProductionRunSnapshot | null;
  updatedAt: number;
};

export const HERMES_MODEL_ID = "nousresearch/hermes-4-70b";
export const GAIN_MODEL_ID = "qwen3.8-27b-cold-fusion-gain-v1.1-nm-dau-neo-max-mtp";
export const GPT_OSS_MODEL_ID = "gptoss-120b-uncensored-hauhaucs-aggressive";
export const ARTEMIS_MODEL_ID = "artemis-31b-v1.1";
export const GAIN_REGULAR_FILE = "Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-Q8_0.gguf";
export const GAIN_MTP_FILE = "Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-MTP-Q8_0.gguf";
export const GAIN_REGULAR_PATH = `D:/AI/Models/LMStudio/DavidAU/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-MTP-GGUF/${GAIN_REGULAR_FILE}`;

function localBinding(input: Omit<ProductionModelBinding, "provider" | "status" | "statusReason">): ProductionModelBinding {
  return { ...input, provider: "lmstudio", status: "needs-refresh", statusReason: "Refresh LM Studio availability before execution." };
}

export function localProductionBindings(): ProductionModelBinding[] {
  return [
    localBinding({ role: "architect", label: "Hermes 4 70B", callableModelId: HERMES_MODEL_ID, artifactPath: null, artifactFileName: null, quantization: "Q6_K", optional: false }),
    localBinding({ role: "writer", label: "Hermes 4 70B", callableModelId: HERMES_MODEL_ID, artifactPath: null, artifactFileName: null, quantization: "Q6_K", optional: false }),
    localBinding({ role: "challenger", label: "Artemis 31B v1.1", callableModelId: ARTEMIS_MODEL_ID, artifactPath: null, artifactFileName: null, quantization: null, optional: true }),
    localBinding({ role: "rewrite", label: "Hermes 4 70B", callableModelId: HERMES_MODEL_ID, artifactPath: null, artifactFileName: null, quantization: "Q6_K", optional: false }),
    localBinding({ role: "prompt-cue", label: "GAIN V1.1 — Q8_0 — regular artifact", callableModelId: GAIN_MODEL_ID, artifactPath: GAIN_REGULAR_PATH, artifactFileName: GAIN_REGULAR_FILE, quantization: "Q8_0", optional: false }),
    localBinding({ role: "reviewer", label: "GPT-OSS 120B Uncensored", callableModelId: GPT_OSS_MODEL_ID, artifactPath: null, artifactFileName: null, quantization: "MXFP4", optional: false }),
  ];
}

export function astraProductionBindings(): ProductionModelBinding[] {
  return (["architect", "writer", "challenger", "rewrite", "prompt-cue", "reviewer"] as ProductionRoleId[]).map((role) => ({
    role,
    label: "Astra Ultra",
    provider: "astra",
    callableModelId: null,
    artifactPath: null,
    artifactFileName: null,
    quantization: null,
    optional: false,
    status: "unavailable",
    statusReason: "A callable Astra provider and supported Ultra effort are not configured. No fallback is used.",
  }));
}

export function bindingsForProfile(profileId: ProductionProfileId): ProductionModelBinding[] {
  return profileId === "astra-ultra" ? astraProductionBindings() : localProductionBindings();
}

export function defaultProductionRouting(now = Date.now()): ProductionRoutingState {
  return {
    schemaVersion: 1,
    profileRevision: PRODUCTION_PROFILE_REVISION,
    profileId: "astra-ultra",
    executionMode: "guided",
    bindings: astraProductionBindings(),
    activeRun: null,
    updatedAt: now,
  };
}

export function hydrateProductionRouting(
  state: ProductionRoutingState | null | undefined,
  options: { legacyLocalSelection?: boolean; now?: number } = {},
): ProductionRoutingState {
  if (!state || state.schemaVersion !== 1) {
    const next = defaultProductionRouting(options.now ?? 0);
    if (!options.legacyLocalSelection) return next;
    return { ...next, profileId: "local-models", bindings: localProductionBindings() };
  }
  const profileId: ProductionProfileId = state.profileId === "local-models" ? "local-models" : "astra-ultra";
  const executionMode: ProductionExecutionMode = state.executionMode === "autonomous-complete-script" ? "autonomous-complete-script" : "guided";
  const defaults = bindingsForProfile(profileId);
  const saved = new Map((Array.isArray(state.bindings) ? state.bindings : []).map((binding) => [binding.role, binding]));
  const bindings = defaults.map((binding) => {
    const previous = saved.get(binding.role);
    if (!previous || previous.provider !== binding.provider) return binding;
    return {
      ...binding,
      ...previous,
      role: binding.role,
      callableModelId: binding.callableModelId,
      artifactPath: binding.artifactPath,
      artifactFileName: binding.artifactFileName,
      quantization: binding.quantization,
      optional: binding.optional,
    };
  });
  return {
    schemaVersion: 1,
    profileRevision: PRODUCTION_PROFILE_REVISION,
    profileId,
    executionMode,
    bindings,
    activeRun: state.activeRun ?? null,
    updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : options.now ?? 0,
  };
}

export function selectProductionProfile(state: ProductionRoutingState, profileId: ProductionProfileId, now = Date.now()): ProductionRoutingState {
  if (state.activeRun?.status === "running") throw new Error("Pause or cancel the active run before changing production profile.");
  return { ...state, profileId, bindings: bindingsForProfile(profileId), activeRun: null, updatedAt: now };
}

export function selectProductionExecutionMode(state: ProductionRoutingState, executionMode: ProductionExecutionMode, now = Date.now()): ProductionRoutingState {
  if (state.activeRun?.status === "running") throw new Error("Pause or cancel the active run before changing execution mode.");
  return { ...state, executionMode, activeRun: null, updatedAt: now };
}

export function isRegularGainArtifact(input: { artifactFileName?: string | null; callableModelId?: string | null }): boolean {
  const fileName = input.artifactFileName?.trim().toLowerCase() ?? "";
  if (fileName !== GAIN_REGULAR_FILE.toLowerCase()) return false;
  if (fileName === GAIN_MTP_FILE.toLowerCase() || /(?:^|[-_])mtp(?:[-_.]|$)/i.test(fileName.replace(/neo-q8_0\.gguf$/i, ""))) return false;
  return input.callableModelId === GAIN_MODEL_ID;
}

export function refreshLocalBindingStatuses(
  state: ProductionRoutingState,
  models: Array<{ id: string; loaded: boolean }>,
  providerAvailable: boolean,
  providerReason = "",
): ProductionRoutingState {
  if (state.profileId !== "local-models") return state;
  const discovered = new Map(models.map((model) => [model.id, model]));
  return {
    ...state,
    bindings: state.bindings.map((binding) => {
      if (!providerAvailable) return { ...binding, status: "needs-refresh", statusReason: providerReason || "LM Studio is unavailable; installed models are not treated as missing." };
      const model = binding.callableModelId ? discovered.get(binding.callableModelId) : null;
      if (!model) return { ...binding, status: "unavailable", statusReason: binding.optional ? "Optional model is not present in the current native catalog." : "Required model is not present in the current native catalog." };
      if (binding.role === "prompt-cue" && !isRegularGainArtifact(binding)) return { ...binding, status: "needs-verification", statusReason: "GAIN alias was found, but the mapped artifact is not the approved regular Q8_0 file." };
      return { ...binding, status: model.loaded ? "loaded" : "installed", statusReason: model.loaded ? "Exact callable model is loaded." : "Exact callable model is installed and will require an explicit managed load." };
    }),
  };
}

export const PRODUCTION_ROLE_LABELS: Record<ProductionRoleId, string> = {
  architect: "Source & scene architect",
  writer: "Lead screenplay writer",
  challenger: "Creative challenger",
  rewrite: "Rewrite owner",
  "prompt-cue": "Shot, prompt & cue author",
  reviewer: "Semantic continuity reviewer",
};
