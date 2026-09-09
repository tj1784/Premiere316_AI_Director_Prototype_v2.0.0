import { classifyLocalWriterFamily } from "./model-routing.ts";

export const DEFAULT_MOVIE_PLAN_MODEL = "gptoss-120b-uncensored-hauhaucs-aggressive";

export const LLAMA_NOT_SERVED =
  "Configured AI model unavailable. Start LM Studio Local API Server and serve the selected local writer model, then Rescan.";

export type MoviePlanModelCandidate = {
  id: string;
  servedModelId: string;
  displayName?: string;
  status: string;
};

export type MoviePlanModelSelection =
  | { allowed: true; servedModelId: string; displayName: string; family: "llama" | "qwen" | "other"; reason: null }
  | { allowed: false; servedModelId: null; displayName: null; family: "none"; reason: string };

function asCrew(model: MoviePlanModelCandidate) {
  return {
    id: model.id,
    servedModelId: model.servedModelId,
    displayName: model.displayName ?? model.servedModelId,
    status: "ready" as const,
  };
}

export function normalizeMoviePlanModelKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^lmstudio:/, "");
}

export function requireMoviePlanModelId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Select an exact local writer model ID. No substitute is used.");
  const id = normalizeMoviePlanModelKey(value);
  if (!id || id.length > 1000 || /[\u0000-\u001f\u007f]/.test(id)) throw new Error("Select an exact local writer model ID. No substitute is used.");
  return id;
}

function matchesExplicit(model: MoviePlanModelCandidate, explicitId: string): boolean {
  const want = normalizeMoviePlanModelKey(explicitId);
  if (!want) return false;
  return model.servedModelId === want;
}

function allow(model: MoviePlanModelCandidate, family: "llama" | "qwen" | "other"): MoviePlanModelSelection {
  return {
    allowed: true,
    servedModelId: model.servedModelId,
    displayName: model.displayName ?? model.servedModelId,
    family,
    reason: null,
  };
}

function deny(reason = LLAMA_NOT_SERVED): MoviePlanModelSelection {
  return { allowed: false, servedModelId: null, displayName: null, family: "none", reason };
}

export function selectMoviePlanModel(
  ready: MoviePlanModelCandidate[],
  input: {
    providerAvailable: boolean;
    providerReason?: string;
    explicitServedId?: string | null;
  },
): MoviePlanModelSelection {
  if (!input.providerAvailable) {
    return deny(input.providerReason || LLAMA_NOT_SERVED);
  }
  const usable = ready.filter((model) => model.status === "ready");
  const explicitId = input.explicitServedId?.trim() || "";
  if (explicitId) {
    const matches = usable.filter((model) => matchesExplicit(model, explicitId));
    const match = matches.length === 1 ? matches[0] : undefined;
    const family = match ? classifyLocalWriterFamily(asCrew(match)) : "other";
    // Candidates already come from loaded LM Studio language models. An exact,
    // explicit user selection can choose another family without changing defaults.
    if (match) return allow(match, family);
    return deny(`The selected local writer ${normalizeMoviePlanModelKey(explicitId)} is unavailable or ambiguous. No substitute is used.`);
  }
  const llama = usable.find((model) => classifyLocalWriterFamily(asCrew(model)) === "llama");
  if (llama) return allow(llama, "llama");
  return deny();
}

export function explicitMoviePlanServedId(picture: {
  screenplay?: { pinnedWriterServedId?: string | null; selectedModelId?: string | null };
} | null | undefined): string | null {
  return picture?.screenplay?.pinnedWriterServedId?.trim() || picture?.screenplay?.selectedModelId?.trim() || DEFAULT_MOVIE_PLAN_MODEL;
}
