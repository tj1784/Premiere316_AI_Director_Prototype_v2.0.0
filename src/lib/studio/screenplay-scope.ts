import {
  applySourceReplacements,
  extractDialogue,
  nodeById,
  parseScreenplayHierarchy,
  type ScreenplayHierarchy,
  type ScreenplayNode,
} from "./screenplay-hierarchy.ts";

export const SCREENPLAY_SCOPES = [
  "full",
  "act",
  "sequence-chapter",
  "scene",
  "selected-scenes",
  "beat",
  "dialogue-only",
  "selected-text",
  "polish-only",
] as const;

export type ScreenplayScope = (typeof SCREENPLAY_SCOPES)[number];

export type ScreenplaySelection = { start: number; end: number } | null;

export type ScreenplayRewriteTarget = {
  scope: ScreenplayScope;
  nodeId: string | null;
  nodeIds: string[] | null;
  selection: ScreenplaySelection;
};

export function normalizeScreenplayScope(scope: string | null | undefined): ScreenplayScope {
  if (scope === "sequence" || scope === "chapter") return "sequence-chapter";
  if (scope === "dialogue") return "dialogue-only";
  if (scope === "selected-text" || scope === "polish-only" || scope === "selected-scenes") return scope;
  if ((SCREENPLAY_SCOPES as readonly string[]).includes(scope ?? "")) return scope as ScreenplayScope;
  return "scene";
}

export function defaultScreenplayScope(selectedNode: ScreenplayNode | null, selection?: ScreenplaySelection, selectedCount = 0): ScreenplayScope {
  if (selection && selection.end > selection.start) return "selected-text";
  if (selectedCount > 1) return "selected-scenes";
  if (!selectedNode) return "full";
  if (selectedNode.kind === "dialogue") return "dialogue-only";
  if (selectedNode.kind === "beat") return "beat";
  if (selectedNode.kind === "scene") return "scene";
  if (selectedNode.kind === "sequence" || selectedNode.kind === "chapter") return "sequence-chapter";
  if (selectedNode.kind === "act") return "act";
  return "full";
}

function orderedNodesBySpan(nodes: ScreenplayNode[]): ScreenplayNode[] {
  return [...nodes].filter((node) => !node.tombstoned).sort((left, right) => left.sourceStart - right.sourceStart);
}

function childrenScenes(hierarchy: ScreenplayHierarchy, node: ScreenplayNode): ScreenplayNode[] {
  if (node.kind === "scene" || node.kind === "beat" || node.kind === "dialogue") return [node];
  if (node.kind === "act") {
    return orderedNodesBySpan(hierarchy.nodes.filter((item) => item.kind === "scene" && !item.tombstoned && (item.parentId === node.id || hierarchy.nodes.find((seq) => seq.id === item.parentId)?.parentId === node.id)));
  }
  return orderedNodesBySpan(hierarchy.nodes.filter((item) => item.kind === "scene" && !item.tombstoned && item.parentId === node.id));
}

function nodesForScope(hierarchy: ScreenplayHierarchy, scope: ScreenplayScope, nodeId: string | null, nodeIds?: string[] | null): ScreenplayNode[] {
  if (scope === "full" || (!nodeId && !nodeIds?.length)) return orderedNodesBySpan(hierarchy.nodes.filter((node) => node.kind === "scene"));
  if (scope === "selected-scenes") {
    const ids = nodeIds?.length ? nodeIds : nodeId ? [nodeId] : [];
    return orderedNodesBySpan(ids.map((id) => nodeById(hierarchy, id)).filter((node): node is ScreenplayNode => Boolean(node)));
  }
  const node = nodeById(hierarchy, nodeId);
  if (!node) return [];
  if (scope === "act" || scope === "sequence-chapter") return [node];
  if (scope === "polish-only") return childrenScenes(hierarchy, node)[0] ? [childrenScenes(hierarchy, node)[0]!] : [];
  return [node];
}

export function extractScopedFountain(
  fountain: string,
  scope: ScreenplayScope,
  nodeId: string | null,
  options: { nodeIds?: string[] | null; selection?: ScreenplaySelection; previous?: ScreenplayHierarchy | null } = {},
): string {
  const normalized = normalizeScreenplayScope(scope);
  if (normalized === "full" || !nodeId && !options.nodeIds?.length && normalized !== "selected-text") return fountain;
  if (normalized === "selected-text" && options.selection) return fountain.slice(options.selection.start, options.selection.end);
  const hierarchy = parseScreenplayHierarchy(fountain, options.previous);
  if (normalized === "dialogue-only") {
    const node = nodeById(hierarchy, nodeId) ?? nodesForScope(hierarchy, "scene", nodeId)[0];
    return extractDialogue(node?.fountain ?? fountain);
  }
  const nodes = nodesForScope(hierarchy, normalized, nodeId, options.nodeIds);
  if (!nodes.length) return fountain;
  return nodes.map((node) => fountain.slice(node.sourceStart, node.sourceEnd)).join("\n\n");
}

function splitReplacementForNodes(replacement: string, count: number): string[] {
  if (count <= 1) return [replacement];
  const parts = replacement.split(/\n{2,}(?=(?:INT\.|EXT\.|INT\.\/EXT\.|I\/E\.))/i);
  if (parts.length >= count) return parts.slice(0, count);
  return [replacement, ...Array.from({ length: count - 1 }, () => "")];
}

function withOriginalTrailingBoundary(original: string, replacement: string): string {
  const trailing = original.match(/(?:\r\n|\n|\r)+$/)?.[0] ?? "";
  if (!trailing || /(?:\r\n|\n|\r)$/.test(replacement)) return replacement;
  return `${replacement}${trailing}`;
}

export function spliceScopedFountain(
  fountain: string,
  scope: ScreenplayScope,
  nodeId: string | null,
  replacement: string,
  options: { nodeIds?: string[] | null; selection?: ScreenplaySelection; previous?: ScreenplayHierarchy | null } = {},
): { fountain: string; hierarchy: ScreenplayHierarchy } {
  const normalized = normalizeScreenplayScope(scope);
  if (normalized === "full" || (!nodeId && normalized !== "selected-text" && normalized !== "selected-scenes")) {
    return { fountain: replacement, hierarchy: parseScreenplayHierarchy(replacement, options.previous) };
  }
  if (normalized === "selected-text" && options.selection) {
    const start = Math.max(0, Math.min(options.selection.start, fountain.length));
    const end = Math.max(start, Math.min(options.selection.end, fountain.length));
    const next = applySourceReplacements(fountain, [{ start, end, replacement }]);
    return { fountain: next, hierarchy: parseScreenplayHierarchy(next, options.previous) };
  }
  const hierarchy = parseScreenplayHierarchy(fountain, options.previous);
  if (normalized === "dialogue-only") {
    const host = nodeById(hierarchy, nodeId);
    const dialogueNodes = orderedNodesBySpan(hierarchy.nodes.filter((node) => node.kind === "dialogue" && !node.tombstoned && (!host || node.parentId === (host.kind === "dialogue" ? host.parentId : host.id))));
    const spans = dialogueNodes.length
      ? dialogueNodes.map((node) => ({ start: node.sourceStart, end: node.sourceEnd, replacement }))
      : host ? [{ start: host.sourceStart, end: host.sourceEnd, replacement }] : [];
    const next = applySourceReplacements(fountain, spans);
    return { fountain: next, hierarchy: parseScreenplayHierarchy(next, hierarchy) };
  }
  const nodes = nodesForScope(hierarchy, normalized, nodeId, options.nodeIds);
  if (!nodes.length) return { fountain, hierarchy };
  const parts = splitReplacementForNodes(replacement, nodes.length);
  const spans = nodes.map((node, index) => ({
    start: node.sourceStart,
    end: node.sourceEnd,
    replacement: withOriginalTrailingBoundary(fountain.slice(node.sourceStart, node.sourceEnd), parts[index] ?? node.fountain),
  }));
  const next = applySourceReplacements(fountain, spans);
  return { fountain: next, hierarchy: parseScreenplayHierarchy(next, hierarchy) };
}

export function otherScenesByteIdentical(before: string, after: string, changedSceneId: string, previous?: ScreenplayHierarchy | null): boolean {
  const priorHierarchy = parseScreenplayHierarchy(before, previous);
  const nextHierarchy = parseScreenplayHierarchy(after, priorHierarchy);
  const prior = priorHierarchy.nodes.filter((node) => node.kind === "scene" && node.id !== changedSceneId && !node.tombstoned);
  const next = nextHierarchy.nodes.filter((node) => node.kind === "scene" && node.id !== changedSceneId && !node.tombstoned);
  if (prior.length !== next.length) return false;
  return prior.every((scene, index) => scene.id === next[index]?.id && before.slice(scene.sourceStart, scene.sourceEnd) === after.slice(next[index]!.sourceStart, next[index]!.sourceEnd));
}
