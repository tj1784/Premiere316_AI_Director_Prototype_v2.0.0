import { classifyLocalWriterFamily } from "./model-routing.ts";

export const LLAMA_NOT_SERVED =
  "Configured AI model unavailable. Start LM Studio Local API Server and serve the configured Llama model, then Rescan.";

export type MoviePlanModelCandidate = {
  id: string;
  servedModelId: string;
  displayName?: string;
  status: string;
};

export type MoviePlanModelSelection =
  | { allowed: true; servedModelId: string; displayName: string; family: "llama" | "qwen"; reason: null }
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
  return (value ?? "").trim().toLowerCase().replace(/^lmstudio:/, "");
}

function matchesExplicit(model: MoviePlanModelCandidate, explicitId: string): boolean {
  const want = normalizeMoviePlanModelKey(explicitId);
  if (!want) return false;
  return normalizeMoviePlanModelKey(model.servedModelId) === want || normalizeMoviePlanModelKey(model.id) === want;
}

function allow(model: MoviePlanModelCandidate, family: "llama" | "qwen"): MoviePlanModelSelection {
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
    const match = usable.find((model) => matchesExplicit(model, explicitId));
    const family = match ? classifyLocalWriterFamily(asCrew(match)) : "other";
    if (match && (family === "llama" || family === "qwen")) return allow(match, family);
    return deny();
  }
  const llama = usable.find((model) => classifyLocalWriterFamily(asCrew(model)) === "llama");
  if (llama) return allow(llama, "llama");
  return deny();
}

export function explicitMoviePlanServedId(picture: {
  screenplay?: { pinnedWriterServedId?: string | null; selectedModelId?: string | null };
} | null | undefined): string | null {
  return picture?.screenplay?.pinnedWriterServedId?.trim() || picture?.screenplay?.selectedModelId?.trim() || null;
}
