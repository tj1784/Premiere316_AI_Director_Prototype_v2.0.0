export type CrewModelRef = {
  id: string;
  servedModelId: string;
  displayName: string;
  status: "ready" | "unavailable" | "needs-validation";
};

export const DEFAULT_CREW_WRITER_MODEL_KEY = "llama-3.3-70b-instruct";
export const DEFAULT_CREW_WRITER_DISPLAY = "Llama 3.3 70B Instruct";
export const OPTIONAL_CREW_WRITER_MODEL_KEY = "qwen2.5-72b-instruct";
export const OPTIONAL_CREW_WRITER_DISPLAY = "Qwen2.5 72B Instruct";
export const DEFAULT_CREW_QUANT = "Q6_K";
export const SAFE_PLANNING_CONTEXT_CAP = 8192;
export const CATALOG_LLAMA_MAX_CONTEXT = 131072;

export type CrewLogicalRole = "writer" | "qa-critic" | "prompt-engineer";
export type CrewFamily = "llama" | "qwen";
export type CrewUnloadPolicy = "explicit-stage-or-workflow-boundary";

export type CrewRoleBinding = {
  role: CrewLogicalRole;
  family: CrewFamily;
  preferredModelKey: string;
  pinnedServedId: string | null;
  executionEnabled: boolean;
  sameResidentAllowed: boolean;
};

export type MovieCrewRoutingProfile = {
  schemaVersion: 1;
  defaultFamily: "llama";
  optionalFamily: "qwen";
  writer: CrewRoleBinding;
  qa: CrewRoleBinding;
  promptEngineer: CrewRoleBinding;
  flags: {
    neverAutoLoad: true;
    neverAutoStartServer: true;
    neverDualLoad: true;
    neverAutoRunBoth: true;
    sequentialReuse: true;
    physicalUnload: CrewUnloadPolicy;
  };
};

export type PromptCompilerRouting = {
  defaultFamily: "llama";
  optionalFamily: "qwen";
  preferredModelKey: string;
  optionalModelKey: string;
  executionWave: 5;
  canonicalSpecAuthoritative: true;
  executionEnabled: false;
};

function haystack(model: Pick<CrewModelRef, "servedModelId" | "displayName" | "id">): string {
  return `${model.id} ${model.servedModelId} ${model.displayName}`.toLowerCase();
}

export function classifyLocalWriterFamily(model: Pick<CrewModelRef, "servedModelId" | "displayName" | "id"> | null | undefined): CrewFamily | "other" {
  if (!model) return "other";
  const text = haystack(model);
  if (/tts|image|qwen3-vl|qwen2\.5-vl/.test(text)) return "other";
  if (/\bllama\b/.test(text)) return "llama";
  if (/\bqwen/.test(text)) return "qwen";
  return "other";
}

export function defaultMovieCrewProfile(): MovieCrewRoutingProfile {
  return {
    schemaVersion: 1,
    defaultFamily: "llama",
    optionalFamily: "qwen",
    writer: {
      role: "writer",
      family: "llama",
      preferredModelKey: DEFAULT_CREW_WRITER_MODEL_KEY,
      pinnedServedId: null,
      executionEnabled: true,
      sameResidentAllowed: true,
    },
    qa: {
      role: "qa-critic",
      family: "llama",
      preferredModelKey: DEFAULT_CREW_WRITER_MODEL_KEY,
      pinnedServedId: null,
      executionEnabled: true,
      sameResidentAllowed: true,
    },
    promptEngineer: {
      role: "prompt-engineer",
      family: "llama",
      preferredModelKey: DEFAULT_CREW_WRITER_MODEL_KEY,
      pinnedServedId: null,
      executionEnabled: false,
      sameResidentAllowed: true,
    },
    flags: {
      neverAutoLoad: true,
      neverAutoStartServer: true,
      neverDualLoad: true,
      neverAutoRunBoth: true,
      sequentialReuse: true,
      physicalUnload: "explicit-stage-or-workflow-boundary",
    },
  };
}

export function defaultPromptCompilerRouting(): PromptCompilerRouting {
  return {
    defaultFamily: "llama",
    optionalFamily: "qwen",
    preferredModelKey: DEFAULT_CREW_WRITER_MODEL_KEY,
    optionalModelKey: OPTIONAL_CREW_WRITER_MODEL_KEY,
    executionWave: 5,
    canonicalSpecAuthoritative: true,
    executionEnabled: false,
  };
}

export function hydrateMovieCrewProfile(profile: MovieCrewRoutingProfile | null | undefined): MovieCrewRoutingProfile {
  const fallback = defaultMovieCrewProfile();
  if (!profile || profile.schemaVersion !== 1) return fallback;
  return {
    ...fallback,
    ...profile,
    writer: { ...fallback.writer, ...profile.writer, role: "writer" },
    qa: { ...fallback.qa, ...profile.qa, role: "qa-critic", sameResidentAllowed: true },
    promptEngineer: { ...fallback.promptEngineer, ...profile.promptEngineer, role: "prompt-engineer", executionEnabled: false },
    flags: fallback.flags,
  };
}

export function isPinnedExactServedReady(model: CrewModelRef | null | undefined, pinnedServedId: string | null | undefined): boolean {
  if (!model || model.status !== "ready" || !model.servedModelId.trim() || !pinnedServedId?.trim()) return false;
  return model.servedModelId === pinnedServedId;
}

export function isLlamaFamily(model: CrewModelRef | null | undefined): boolean {
  return classifyLocalWriterFamily(model) === "llama";
}

export function isQwenFamily(model: CrewModelRef | null | undefined): boolean {
  return classifyLocalWriterFamily(model) === "qwen";
}

export function isAllowedCrewFamily(model: CrewModelRef | null | undefined): boolean {
  const family = classifyLocalWriterFamily(model);
  return family === "llama" || family === "qwen";
}

export function canPinWriterId(servedModelId: string, model: CrewModelRef | null | undefined): boolean {
  return Boolean(servedModelId.trim() && model && model.servedModelId === servedModelId && isAllowedCrewFamily(model) && model.status === "ready");
}

export function canPinQaId(servedModelId: string, model: CrewModelRef | null | undefined, _writerPin: string | null): boolean {
  return Boolean(servedModelId.trim() && model && model.servedModelId === servedModelId && isAllowedCrewFamily(model) && model.status === "ready");
}

export function canPinCompilerId(servedModelId: string, model: CrewModelRef | null | undefined): boolean {
  return canPinWriterId(servedModelId, model);
}

export function refuseAutomaticDualFamily(writerFamily: CrewFamily | "other", qaFamily: CrewFamily | "other", secondOpinionExplicit: boolean): string | null {
  if (writerFamily === "other" || qaFamily === "other") return null;
  if (writerFamily !== qaFamily && !secondOpinionExplicit) {
    return "Qwen second opinion is optional and never automatic. Run Llama QA first, then explicitly request Qwen.";
  }
  return null;
}

export function plannedContextLength(servedContextLength: number | null | undefined, requested: number | null | undefined): { requested: number | null; effective: number | null; reason: string | null } {
  if (!servedContextLength || servedContextLength <= 0) {
    return { requested: requested ?? null, effective: null, reason: "Native served context length is unknown. Generation stays disabled rather than guessing catalog max." };
  }
  const want = Math.min(requested ?? SAFE_PLANNING_CONTEXT_CAP, SAFE_PLANNING_CONTEXT_CAP, servedContextLength);
  return { requested: requested ?? SAFE_PLANNING_CONTEXT_CAP, effective: want, reason: null };
}

export function writerBlockReason(
  model: CrewModelRef | null | undefined,
  providerAvailable: boolean,
  pinnedServedId?: string | null,
): string | null {
  if (!providerAvailable) return "LOCAL LLAMA WRITER UNAVAILABLE. LM Studio local API is offline. Screenplay generation stays disabled.";
  if (!pinnedServedId?.trim()) return "Pin the full currently served Llama model ID (default writer). Family names are not accepted. Qwen is an optional explicit alternate.";
  if (!model) return "Select the pinned currently served writer ID. No substitute is used.";
  if (model.servedModelId !== pinnedServedId) return "The selected model is not the pinned served ID. Family or substring matches are rejected.";
  if (!isAllowedCrewFamily(model)) return "Screenplay generation requires a pinned Llama (default) or explicitly selected Qwen served ID.";
  if (model.status !== "ready") return "The pinned writer served ID is not currently loaded. Premiere316 will not auto-load it.";
  return null;
}

export function qaBlockReason(
  model: CrewModelRef | null | undefined,
  writerPin: string | null,
  providerAvailable: boolean,
  pinnedQaServedId?: string | null,
  secondOpinionExplicit = false,
): string | null {
  if (!providerAvailable) return "LOCAL LLAMA WRITER UNAVAILABLE. LM Studio local API is offline. Story Doctor stays disabled.";
  if (!pinnedQaServedId?.trim()) return "Pin the full currently served Llama model ID as Story Doctor. The same resident Llama as the writer is valid.";
  if (!model) return "Select the pinned currently served Story Doctor ID.";
  if (model.servedModelId !== pinnedQaServedId) return "The selected Story Doctor is not the pinned served ID. Family or substring matches are rejected.";
  if (!isAllowedCrewFamily(model)) return "Story Doctor requires a pinned Llama (default) or explicitly selected Qwen served ID. Native llama.cpp is not used.";
  if (model.status !== "ready") return "The pinned Story Doctor served ID is not currently loaded. Premiere316 will not auto-load it.";
  const writerFamily = writerPin && model.servedModelId === writerPin ? classifyLocalWriterFamily(model) : "other";
  if (writerPin && pinnedQaServedId !== writerPin) {
    const qaFamily = classifyLocalWriterFamily(model);
    const dual = refuseAutomaticDualFamily(writerFamily === "other" ? "llama" : writerFamily, qaFamily, secondOpinionExplicit);
    if (dual && qaFamily === "qwen" && !secondOpinionExplicit) return dual;
  }
  return null;
}

export function compilerBlockReason(executionEnabled: boolean): string {
  if (!executionEnabled) return "Prompt compiler stays inactive until Prompt Lab / Wave 5. Canonical specs are the source of truth; prompt text is a versioned derivative.";
  return "Prompt compiler runtime is gated. Premiere316 will not invent unsupported engine syntax or generate media.";
}

export const MOVIE_CREW_AGENT_IDS = [
  "movie-screenwriter",
  "movie-screenplay-qa",
  "movie-prompt-engineer",
  "movie-screenwriter-qwen",
  "movie-screenplay-qa-qwen",
  "movie-prompt-engineer-qwen",
] as const;

export type MovieCrewAgentId = (typeof MOVIE_CREW_AGENT_IDS)[number];
