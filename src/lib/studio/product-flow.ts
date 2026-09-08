import type { Picture, StageId } from "./types.ts";

export type ProductTouchpoint = "intake" | "asset-approval" | "keyframe-approval" | "video-approval" | "export";
export type InternalPhase =
  | "research"
  | "screenplay"
  | "screenplayQa"
  | "breakdown"
  | "visualDevelopment"
  | "cinematography"
  | "performance"
  | "shots"
  | "promptLab";

export type DepartmentRunState =
  | "locked"
  | "ready"
  | "running"
  | "draftReady"
  | "approvedByAutomation"
  | "waitingForOptionalUserReview"
  | "needsUserAttention"
  | "failed"
  | "blocked";

export type DefaultNavStep = {
  id: ProductTouchpoint;
  number: string;
  label: string;
  stage: StageId;
  gate: "assets" | "keyframes" | "video" | null;
};

export const DEFAULT_NAV_STEPS: DefaultNavStep[] = [
  { id: "intake", number: "01", label: "Intake", stage: "intake", gate: null },
  { id: "asset-approval", number: "02", label: "Assets", stage: "generate", gate: "assets" },
  { id: "keyframe-approval", number: "03", label: "First / Last", stage: "generate", gate: "keyframes" },
  { id: "video-approval", number: "04", label: "Video Clips", stage: "generate", gate: "video" },
  { id: "export", number: "05", label: "Export", stage: "export", gate: null },
];

export const INTERNAL_PHASES: InternalPhase[] = [
  "research",
  "screenplay",
  "screenplayQa",
  "breakdown",
  "visualDevelopment",
  "cinematography",
  "performance",
  "shots",
  "promptLab",
];

export const PHASE_REVIEW_DEFAULTS: Record<InternalPhase, boolean> = {
  research: false,
  screenplay: false,
  screenplayQa: false,
  breakdown: false,
  visualDevelopment: false,
  cinematography: false,
  performance: false,
  shots: false,
  promptLab: false,
};

export type ProductFlowState = {
  schemaVersion: 1;
  reviewInternalPhases: boolean;
  reviewPhases: Record<InternalPhase, boolean>;
  steps: Array<{ id: InternalPhase; status: DepartmentRunState; message: string }>;
  llamaAvailable: boolean | null;
  nextTouchpoint: ProductTouchpoint;
  lastRunAt: number | null;
};

export function emptyProductFlow(): ProductFlowState {
  return {
    schemaVersion: 1,
    reviewInternalPhases: false,
    reviewPhases: { ...PHASE_REVIEW_DEFAULTS },
    steps: [],
    llamaAvailable: null,
    nextTouchpoint: "intake",
    lastRunAt: null,
  };
}

export function hydrateProductFlow(state: ProductFlowState | null | undefined): ProductFlowState {
  if (!state || state.schemaVersion !== 1) return emptyProductFlow();
  return {
    ...emptyProductFlow(),
    ...state,
    reviewInternalPhases: state.reviewInternalPhases === true,
    reviewPhases: { ...PHASE_REVIEW_DEFAULTS, ...state.reviewPhases },
    steps: Array.isArray(state.steps) ? state.steps : [],
  };
}

export function parseMovieIntent(text: string): {
  title: string;
  concept: string;
  premise: string;
  logline: string;
  targetRuntimeMinutes: number;
  genre: string;
  tone: string;
  productionStyle: string;
} {
  const raw = text.trim();
  const runtime = Number((raw.match(/(\d+)\s*-?\s*minute/i) ?? [])[1] || 0);
  const forMatch = raw.match(/\bfor\s+([^,.]+)/i);
  const title = (forMatch?.[1] ?? raw.split(/[.,]/)[0] ?? "Untitled Picture").trim().slice(0, 80) || "Untitled Picture";
  const live = /photoreal|live-action|real people|real robots|naturalistic/i.test(raw);
  return {
    title,
    concept: raw,
    premise: raw,
    logline: raw,
    targetRuntimeMinutes: runtime > 0 ? runtime : 2,
    genre: /trailer/i.test(raw) ? "Trailer" : /drama/i.test(raw) ? "Drama" : "",
    tone: live ? "Photoreal cinematic, naturalistic, restrained" : "",
    productionStyle: live ? "Live-action photoreal" : "",
  };
}

export function defaultRequiredTouchpoints(): ProductTouchpoint[] {
  return ["intake", "asset-approval", "keyframe-approval", "video-approval", "export"];
}

export function pausedInternalPhase(flow: ProductFlowState): InternalPhase | null {
  if (!flow.reviewInternalPhases) return null;
  for (const phase of INTERNAL_PHASES) {
    if (flow.reviewPhases[phase]) {
      const step = flow.steps.find((item) => item.id === phase);
      if (!step || step.status === "waitingForOptionalUserReview") return phase;
    }
  }
  return null;
}

export function buildMoviePlan(picture: Picture, input: { llamaAvailable: boolean; now?: number }): { picture: Picture; flow: ProductFlowState } {
  const now = input.now ?? Date.now();
  const flow = hydrateProductFlow(picture.productFlow);
  const brief = parseMovieIntent(picture.intake.concept || picture.intake.premise || picture.intake.logline || picture.logline || picture.title);
  const steps: ProductFlowState["steps"] = INTERNAL_PHASES.map((id) => {
    if (!input.llamaAvailable && (id === "research" || id === "screenplay" || id === "screenplayQa")) {
      return { id, status: "failed", message: "Local Llama unavailable. Intake skeleton only. Start LM Studio Local API, then Rescan." };
    }
    if (flow.reviewInternalPhases && flow.reviewPhases[id]) {
      return { id, status: "waitingForOptionalUserReview", message: `Paused for optional ${id} review.` };
    }
    return { id, status: "draftReady", message: `${id} prepared from Intake. Not a verified Llama runtime pass.` };
  });
  const paused = steps.find((item) => item.status === "waitingForOptionalUserReview");
  const nextTouchpoint: ProductTouchpoint = paused ? "intake" : "asset-approval";
  const nextFlow: ProductFlowState = {
    ...flow,
    steps,
    llamaAvailable: input.llamaAvailable,
    nextTouchpoint,
    lastRunAt: now,
  };
  const intake = {
    ...picture.intake,
    title: picture.intake.title || brief.title,
    concept: picture.intake.concept || brief.concept,
    premise: picture.intake.premise || brief.premise,
    logline: picture.intake.logline || brief.logline,
    genre: picture.intake.genre || brief.genre,
    tone: picture.intake.tone || brief.tone,
    productionStyle: picture.intake.productionStyle || brief.productionStyle,
    targetRuntimeMinutes: picture.intake.targetRuntimeMinutes || brief.targetRuntimeMinutes,
    updatedAt: now,
  };
  return {
    picture: {
      ...picture,
      title: !picture.title || picture.title === "Untitled" || picture.title === "Untitled Picture" ? intake.title : picture.title,
      logline: picture.logline || intake.logline,
      genre: picture.genre || intake.genre,
      tone: picture.tone || intake.tone,
      runtimeMinutes: picture.runtimeMinutes || intake.targetRuntimeMinutes,
      intake,
      productFlow: nextFlow,
      updatedAt: now,
    },
    flow: nextFlow,
  };
}

export function requiredTouchpointForStage(stage: StageId, gate: "assets" | "keyframes" | "video" | null): ProductTouchpoint {
  if (stage === "intake") return "intake";
  if (stage === "export") return "export";
  if (stage === "generate" && gate === "keyframes") return "keyframe-approval";
  if (stage === "generate" && gate === "video") return "video-approval";
  if (stage === "generate") return "asset-approval";
  return "intake";
}
