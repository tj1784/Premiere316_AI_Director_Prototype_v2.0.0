import type { StageId } from "./types.ts";
import { resolveStageLayout, shellLeftKind, shellRightKind } from "./stage-layout.ts";

export const RESPONSIVE_BREAKPOINTS = {
  compact: 1024,
  wide: 1280,
} as const;

export type StudioLayoutMode = "narrow" | "compact" | "wide";

export function showTimelineForStage(stage: string): boolean {
  return resolveStageLayout(stage).bottomPanel === "timeline";
}

export function studioLayoutMode(width: number): StudioLayoutMode {
  if (width >= RESPONSIVE_BREAKPOINTS.wide) return "wide";
  if (width >= RESPONSIVE_BREAKPOINTS.compact) return "compact";
  return "narrow";
}

export function dockedPanels(
  width: number,
  preferences: { leftCollapsed: boolean; rightCollapsed: boolean },
  stage: StageId | string,
) {
  const mode = studioLayoutMode(width);
  const policy = resolveStageLayout(stage);
  const ownsLeft = shellLeftKind(policy) !== null;
  const ownsRight = shellRightKind(policy) !== null;
  return {
    mode,
    left: mode !== "narrow" && !preferences.leftCollapsed && ownsLeft,
    right: mode === "wide" && !preferences.rightCollapsed && ownsRight,
  };
}
