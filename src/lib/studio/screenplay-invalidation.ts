import { parseScreenplayHierarchy } from "./screenplay-hierarchy.ts";

export type ScreenplayImpactRecord = {
  fromVersionId: string;
  toVersionId: string;
  changedNodeIds: string[];
  unchangedNodeIds: string[];
};

export function diffApprovedHierarchy(previousFountain: string, nextFountain: string, fromVersionId: string, toVersionId: string): ScreenplayImpactRecord {
  const previous = parseScreenplayHierarchy(previousFountain);
  const next = parseScreenplayHierarchy(nextFountain);
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextIds = new Set(next.nodes.map((node) => node.id));
  const changedNodeIds: string[] = [];
  const unchangedNodeIds: string[] = [];
  for (const node of next.nodes) {
    const prior = previousById.get(node.id);
    if (!prior || prior.fountain !== node.fountain) changedNodeIds.push(node.id);
    else unchangedNodeIds.push(node.id);
  }
  for (const node of previous.nodes) {
    if (!nextIds.has(node.id)) changedNodeIds.push(node.id);
  }
  return { fromVersionId, toVersionId, changedNodeIds: [...new Set(changedNodeIds)], unchangedNodeIds };
}
