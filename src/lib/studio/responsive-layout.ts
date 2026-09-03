export const RESPONSIVE_BREAKPOINTS = {
  compact: 1024,
  wide: 1280,
} as const;

export type StudioLayoutMode = "narrow" | "compact" | "wide";

export function showTimelineForStage(stage: string): boolean {
  return stage === "timeline";
}

export function studioLayoutMode(width: number): StudioLayoutMode {
  if (width >= RESPONSIVE_BREAKPOINTS.wide) return "wide";
  if (width >= RESPONSIVE_BREAKPOINTS.compact) return "compact";
  return "narrow";
}

export function dockedPanels(
  width: number,
  preferences: { leftCollapsed: boolean; rightCollapsed: boolean },
) {
  const mode = studioLayoutMode(width);
  return {
    mode,
    left: mode !== "narrow" && !preferences.leftCollapsed,
    right: mode === "wide" && !preferences.rightCollapsed,
  };
}
