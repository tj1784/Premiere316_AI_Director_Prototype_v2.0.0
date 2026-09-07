import { movieReadiness, type ReadinessItem } from "./movie-readiness.ts";
import { STAGES, type Picture, type StageId } from "./types.ts";

export type LifecycleStage = {
  id: StageId;
  number: string;
  label: string;
  requiredInputs: string[];
  outputs: string[];
  ownerRole: string;
  readiness: ReadinessItem | null;
  nextRecommendedAction: string;
};

const ROLES: Partial<Record<StageId, string>> = {
  intake: "p316-captain",
  research: "research-director",
  screenplay: "llama-screenwriter",
  inventory: "script-supervisor",
  "visual-development": "visual-development-director",
  cinematography: "cinematography-director",
  performance: "performance-director",
  shots: "shot-director",
  prompts: "llama-prompt-engineer",
  generate: "video-production-assistant",
  review: "final-qa",
  timeline: "editor",
  score: "composer",
  export: "mastering-export-engineer",
};

const INPUTS: Partial<Record<StageId, string[]>> = {
  intake: ["concept"],
  research: ["intake"],
  screenplay: ["approved research"],
  inventory: ["screenplay"],
  "visual-development": ["inventory"],
  cinematography: ["visual development"],
  performance: ["cinematography"],
  shots: ["performance"],
  prompts: ["shots", "canonical specs"],
  generate: ["compiled prompts", "prepared assets or import"],
  review: ["generated or imported takes"],
  timeline: ["canonical takes"],
  score: ["cue sheet", "dialogue lines"],
  export: ["timeline plan", "canonical media or paper package"],
};

const OUTPUTS: Partial<Record<StageId, string[]>> = {
  intake: ["picture record"],
  research: ["approved bible"],
  screenplay: ["Fountain", "approved screenplay"],
  inventory: ["characters", "locations"],
  generate: ["image iterations", "video takes"],
  review: ["reject/canonical decisions"],
  timeline: ["assembly order"],
  score: ["voice/sound/score takes"],
  export: ["paper package", "optional MP4"],
};

export function movieLifecycle(picture: Picture): LifecycleStage[] {
  const readiness = movieReadiness(picture);
  return STAGES.map((stage) => {
    const item = readiness.find((entry) => entry.stage === stage.id) ?? null;
    return {
      id: stage.id,
      number: stage.number,
      label: stage.label,
      requiredInputs: INPUTS[stage.id] ?? [],
      outputs: OUTPUTS[stage.id] ?? [],
      ownerRole: ROLES[stage.id] ?? "p316-captain",
      readiness: item,
      nextRecommendedAction: item?.nextAction ?? "Open this stage.",
    };
  });
}

export function guidedNextStage(picture: Picture): StageId {
  const next = movieReadiness(picture).find((item) => item.status === "blocked") ?? movieReadiness(picture).find((item) => item.status === "fail-closed");
  return next?.stage ?? "export";
}
