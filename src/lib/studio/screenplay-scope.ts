import { nodeById, parseScreenplayHierarchy, rebuildFountain, type ScreenplayHierarchy, type ScreenplayNode } from "./screenplay-hierarchy.ts";

export const SCREENPLAY_SCOPES = [
  "full",
  "act",
  "sequence",
  "chapter",
  "scene",
  "beat",
  "dialogue",
  "selected-text",
] as const;

export type ScreenplayScope = (typeof SCREENPLAY_SCOPES)[number];

export function defaultScreenplayScope(selectedNode: ScreenplayNode | null): ScreenplayScope {
  if (!selectedNode) return "full";
  if (selectedNode.kind === "beat") return "beat";
  if (selectedNode.kind === "scene") return "scene";
  if (selectedNode.kind === "act") return "act";
  return "full";
}

export function extractScopedFountain(fountain: string, scope: ScreenplayScope, nodeId: string | null): string {
  if (scope === "full" || !nodeId) return fountain;
  const hierarchy = parseScreenplayHierarchy(fountain);
  const node = nodeById(hierarchy, nodeId);
  return node?.fountain ?? fountain;
}

export function spliceScopedFountain(
  fountain: string,
  scope: ScreenplayScope,
  nodeId: string | null,
  replacement: string,
): { fountain: string; hierarchy: ScreenplayHierarchy } {
  const hierarchy = parseScreenplayHierarchy(fountain);
  if (scope === "full" || !nodeId) {
    return { fountain: replacement, hierarchy: parseScreenplayHierarchy(replacement) };
  }
  const node = nodeById(hierarchy, nodeId);
  if (!node) return { fountain, hierarchy };
  node.fountain = replacement.trimEnd();
  if (node.kind === "scene") node.slugline = replacement.split("\n").find((line) => /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i.test(line.trim())) ?? node.slugline;
  return { fountain: rebuildFountain(hierarchy), hierarchy };
}

export function otherScenesByteIdentical(before: string, after: string, changedSceneId: string): boolean {
  const previous = parseScreenplayHierarchy(before).nodes.filter((node) => node.kind === "scene" && node.id !== changedSceneId);
  const next = parseScreenplayHierarchy(after).nodes.filter((node) => node.kind === "scene" && node.id !== changedSceneId);
  if (previous.length !== next.length) return false;
  return previous.every((scene, index) => scene.fountain === next[index]?.fountain);
}
