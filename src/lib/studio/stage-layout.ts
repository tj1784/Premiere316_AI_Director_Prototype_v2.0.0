import type { StageId } from "./types.ts";

export type StageLayoutPolicy = {
  leftPanel: "none" | "stage" | "generation" | "media";
  rightPanel: "none" | "stage" | "generation" | "clip" | "cue";
  bottomPanel: "none" | "timeline";
  headerActions: string[];
  workspaceMode: string;
};

export type ShellLeftKind = "generation" | "media";
export type ShellRightKind = "generation" | "clip";

const CLOSED: StageLayoutPolicy = {
  leftPanel: "none",
  rightPanel: "none",
  bottomPanel: "none",
  headerActions: [],
  workspaceMode: "",
};

const STAGE_LAYOUT: Record<StageId, StageLayoutPolicy> = {
  intake: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "intake" },
  research: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "research" },
  screenplay: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "screenplay" },
  inventory: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "inventory" },
  "visual-development": { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "visual-development" },
  cinematography: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "cinematography" },
  performance: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "performance" },
  shots: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "shots" },
  prompts: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "prompts" },
  generate: { leftPanel: "generation", rightPanel: "generation", bottomPanel: "none", headerActions: [], workspaceMode: "generate" },
  review: { leftPanel: "stage", rightPanel: "stage", bottomPanel: "none", headerActions: [], workspaceMode: "review" },
  timeline: { leftPanel: "media", rightPanel: "clip", bottomPanel: "timeline", headerActions: [], workspaceMode: "stitch" },
  score: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "score" },
  export: { leftPanel: "none", rightPanel: "none", bottomPanel: "none", headerActions: [], workspaceMode: "export" },
};

export function resolveStageLayout(stage: StageId | string): StageLayoutPolicy {
  return STAGE_LAYOUT[stage as StageId] ?? CLOSED;
}

export function shellLeftKind(policy: StageLayoutPolicy): ShellLeftKind | null {
  return policy.leftPanel === "generation" || policy.leftPanel === "media" ? policy.leftPanel : null;
}

export function shellRightKind(policy: StageLayoutPolicy): ShellRightKind | null {
  return policy.rightPanel === "generation" || policy.rightPanel === "clip" ? policy.rightPanel : null;
}

export function showsRewrite(policy: StageLayoutPolicy): boolean {
  return policy.headerActions.includes("Rewrite");
}

export function shellLeftTitle(kind: ShellLeftKind): string {
  return kind === "media" ? "Media" : "Bin";
}

export function shellRightTitle(kind: ShellRightKind): string {
  return kind === "clip" ? "Clip" : "Inspector";
}
