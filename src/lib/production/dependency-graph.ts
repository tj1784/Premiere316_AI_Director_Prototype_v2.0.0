import type { PictureResearchBible, ResearchContent } from "../research/bible.ts";
import type { ApprovedScreenplayBoundary } from "../studio/screenplay.ts";
import type { ProductionAsset, ProductionBreakdown } from "./types.ts";

export type DependencyNodeKind =
  | "research-version"
  | "screenplay-version"
  | "scene"
  | "requirement"
  | "asset"
  | "variant"
  | "reference"
  | "asset-version"
  | "visual-bible"
  | "character-identity"
  | "wardrobe-state"
  | "location-bible"
  | "prop-bible"
  | "cinematography-manifesto"
  | "sequence-arc"
  | "cinematography-plan"
  | "prepared-asset"
  | "shot"
  | "prompt"
  | "media"
  | "master";

export type SourceFingerprint = {
  sourceKind: "research" | "screenplay" | "scene" | "requirement" | "asset" | "visual-development" | "cinematography";
  sourceId: string;
  versionId: string | null;
  hash: string;
  approvedAt: number | null;
  immutableBoundary: boolean;
};

export type DependencyGraphNode = {
  id: string;
  kind: DependencyNodeKind;
  label: string;
  fingerprint: SourceFingerprint | null;
};

export type DependencyGraphEdge = {
  from: string;
  to: string;
  reason: string;
  dependentFields: string[];
  invalidationMode: "scoped" | "readiness" | "manual-review";
};

export type ScopedStaleness = {
  recordId: string;
  scope: "record" | "scene" | "field" | "reference";
  sourceFingerprint: SourceFingerprint;
  changedFields: string[];
  message: string;
  blocksReadiness: boolean;
};

export type DependencyGraphV2 = {
  schemaVersion: 2;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  stale: ScopedStaleness[];
  generatedAt: number;
};

export type BreakdownSourceBoundary = {
  schemaVersion: 1;
  pictureId: string;
  screenplay: ApprovedScreenplayBoundary;
  research: ResearchContent;
  fingerprints: SourceFingerprint[];
  frozenAt: number;
};

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)]));
  }
  return value;
}

export function stableHash(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\r\n/g, "\n") : JSON.stringify(sortJson(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < (normalized ?? "").length; index++) {
    hash ^= (normalized ?? "").charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function sourceFingerprint(input: Omit<SourceFingerprint, "hash"> & { content: unknown }): SourceFingerprint {
  return {
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    versionId: input.versionId,
    hash: stableHash(input.content),
    approvedAt: input.approvedAt,
    immutableBoundary: input.immutableBoundary,
  };
}

export function buildBreakdownSourceBoundary(screenplay: ApprovedScreenplayBoundary, researchBible: PictureResearchBible, frozenAt = Date.now()): BreakdownSourceBoundary | { error: string } {
  const approvedResearch = researchBible.versions.find((version) => version.id === researchBible.approvedVersionId);
  if (!approvedResearch || researchBible.status !== "APPROVED" && researchBible.status !== "DELTA_PENDING") return { error: "Approve Picture Research before breakdown." };
  if (!screenplay.screenplayVersionId || !screenplay.fountain.trim()) return { error: "Approve Screenplay before breakdown." };
  return {
    schemaVersion: 1,
    pictureId: screenplay.pictureId,
    screenplay,
    research: structuredClone(approvedResearch.content),
    frozenAt,
    fingerprints: [
      sourceFingerprint({ sourceKind: "screenplay", sourceId: screenplay.pictureId, versionId: screenplay.screenplayVersionId, content: screenplay.fountain, approvedAt: screenplay.approvedAt, immutableBoundary: true }),
      sourceFingerprint({ sourceKind: "research", sourceId: screenplay.pictureId, versionId: approvedResearch.id, content: approvedResearch.content, approvedAt: researchBible.approvedAt, immutableBoundary: true }),
      ...screenplay.scenes.map((scene) => sourceFingerprint({ sourceKind: "scene", sourceId: scene.id, versionId: screenplay.screenplayVersionId, content: scene, approvedAt: screenplay.approvedAt, immutableBoundary: true })),
    ],
  };
}

export function buildDependencyGraphV2(record: Pick<ProductionBreakdown, "screenplayVersionId" | "requirements" | "assets" | "scenes"> & { sourceBoundary?: BreakdownSourceBoundary | null; preparedAssets?: ProductionBreakdown["preparedAssets"] }, generatedAt = Date.now()): DependencyGraphV2 {
  const nodes: DependencyGraphNode[] = [];
  const edges: DependencyGraphEdge[] = [];
  const addNode = (node: DependencyGraphNode) => { if (!nodes.some((item) => item.id === node.id)) nodes.push(node); };
  const addEdge = (edge: DependencyGraphEdge) => { if (!edges.some((item) => JSON.stringify(item) === JSON.stringify(edge))) edges.push(edge); };
  const screenplayFp = record.sourceBoundary?.fingerprints.find((fp) => fp.sourceKind === "screenplay") ?? null;
  addNode({ id: `screenplay:${record.screenplayVersionId}`, kind: "screenplay-version", label: "Approved Screenplay", fingerprint: screenplayFp });
  for (const scene of record.scenes) {
    const sceneNode = `scene:${scene.id}`;
    addNode({ id: sceneNode, kind: "scene", label: scene.slugline, fingerprint: record.sourceBoundary?.fingerprints.find((fp) => fp.sourceKind === "scene" && fp.sourceId === scene.id) ?? null });
    addEdge({ from: `screenplay:${record.screenplayVersionId}`, to: sceneNode, reason: "Approved screenplay scene boundary", dependentFields: ["fountain", "slugline"], invalidationMode: "scoped" });
  }
  const researchFp = record.sourceBoundary?.fingerprints.find((fp) => fp.sourceKind === "research") ?? null;
  if (researchFp) addNode({ id: `research:${researchFp.versionId}`, kind: "research-version", label: "Approved Research Bible", fingerprint: researchFp });
  for (const requirement of record.requirements) {
    const reqNode = `requirement:${requirement.id}`;
    addNode({ id: reqNode, kind: "requirement", label: requirement.name, fingerprint: sourceFingerprint({ sourceKind: "requirement", sourceId: requirement.id, versionId: record.screenplayVersionId, content: requirement, approvedAt: null, immutableBoundary: false }) });
    for (const sceneId of requirement.sceneIds) addEdge({ from: `scene:${sceneId}`, to: reqNode, reason: "Requirement extracted from scene", dependentFields: ["name", "description", "sceneIds"], invalidationMode: "scoped" });
    if (researchFp && (requirement.socialWorldIds?.length || requirement.confidence)) addEdge({ from: `research:${researchFp.versionId}`, to: reqNode, reason: "Requirement carries approved research/social-world evidence", dependentFields: ["confidence", "evidenceNote", "socialWorldIds"], invalidationMode: "manual-review" });
  }
  for (const asset of record.assets) appendAssetGraph(asset, record.screenplayVersionId, addNode, addEdge);
  for (const prepared of record.preparedAssets ?? []) {
    const preparedNode = `prepared-asset:${prepared.id}`;
    addNode({ id: preparedNode, kind: "prepared-asset", label: prepared.id, fingerprint: sourceFingerprint({ sourceKind: "asset", sourceId: prepared.id, versionId: prepared.specVersionId, content: prepared, approvedAt: prepared.approvedAt, immutableBoundary: prepared.status === "APPROVED_PREPARED" }) });
    addEdge({ from: `asset:${prepared.assetId}`, to: preparedNode, reason: "Prepared asset derives from approved canonical spec", dependentFields: ["canonicalSpec", "approvedSpecVersionId", "references"], invalidationMode: "readiness" });
    for (const visualId of prepared.visualBibleVersionIds) {
      const visualNode = `visual-bible:${visualId}`;
      addNode({ id: visualNode, kind: "visual-bible", label: visualId, fingerprint: sourceFingerprint({ sourceKind: "visual-development", sourceId: visualId, versionId: visualId, content: visualId, approvedAt: null, immutableBoundary: true }) });
      addEdge({ from: visualNode, to: preparedNode, reason: "Prepared asset uses approved visual bible", dependentFields: ["visualBibleVersionIds"], invalidationMode: "readiness" });
    }
    for (const planId of prepared.cinematographyPlanIds) {
      const planNode = `cinematography-plan:${planId}`;
      addNode({ id: planNode, kind: "cinematography-plan", label: planId, fingerprint: sourceFingerprint({ sourceKind: "cinematography", sourceId: planId, versionId: planId, content: planId, approvedAt: null, immutableBoundary: true }) });
      addEdge({ from: planNode, to: preparedNode, reason: "Prepared asset uses approved cinematography plan", dependentFields: ["cinematographyPlanIds"], invalidationMode: "readiness" });
    }
  }
  return { schemaVersion: 2, nodes, edges, stale: [], generatedAt };
}

function appendAssetGraph(asset: ProductionAsset, versionId: string, addNode: (node: DependencyGraphNode) => void, addEdge: (edge: DependencyGraphEdge) => void) {
  const assetNode = `asset:${asset.id}`;
  addNode({ id: assetNode, kind: "asset", label: asset.name, fingerprint: sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId, content: asset.canonicalSpec, approvedAt: asset.canonicalApproved ? asset.updatedAt : null, immutableBoundary: asset.canonicalApproved }) });
  for (const requirementId of asset.requirementIds) addEdge({ from: `requirement:${requirementId}`, to: assetNode, reason: "Asset satisfies requirement", dependentFields: ["canonicalSpec", "requiredSceneIds"], invalidationMode: "scoped" });
  for (const reference of asset.references) {
    const refNode = `reference:${reference.id}`;
    addNode({ id: refNode, kind: "reference", label: reference.name, fingerprint: sourceFingerprint({ sourceKind: "asset", sourceId: reference.id, versionId, content: reference, approvedAt: null, immutableBoundary: false }) });
    addEdge({ from: assetNode, to: refNode, reason: "Reference attached to asset", dependentFields: ["preferred", "uri", "provenance"], invalidationMode: "readiness" });
  }
  for (const variant of asset.variants) {
    const variantNode = `variant:${variant.id}`;
    addNode({ id: variantNode, kind: "variant", label: variant.name, fingerprint: sourceFingerprint({ sourceKind: "asset", sourceId: variant.id, versionId, content: variant, approvedAt: null, immutableBoundary: false }) });
    addEdge({ from: assetNode, to: variantNode, reason: "Variant narrows canonical asset spec", dependentFields: ["specPatch", "requiredSceneIds"], invalidationMode: "scoped" });
  }
}

export function propagateScopedStaleness(graph: DependencyGraphV2, changed: SourceFingerprint, changedFields: string[]): ScopedStaleness[] {
  const start = graph.nodes.find((node) => node.fingerprint?.sourceKind === changed.sourceKind && node.fingerprint.sourceId === changed.sourceId)?.id
    ?? (changed.sourceKind === "scene" && graph.nodes.some((node) => node.id === `scene:${changed.sourceId}`) ? `scene:${changed.sourceId}` : null)
    ?? (changed.sourceKind === "asset" && graph.nodes.some((node) => node.id === `asset:${changed.sourceId}`) ? `asset:${changed.sourceId}` : null);
  if (!start) return [];
  const stale: ScopedStaleness[] = [];
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const from = queue.shift()!;
    for (const edge of graph.edges.filter((item) => item.from === from)) {
      const relevantFields = changedFields.includes("*") ? ["*"] : changedFields;
      if (relevantFields.length) {
        stale.push({
          recordId: edge.to.replace(/^[^:]+:/, ""),
          scope: (edge.invalidationMode === "readiness" ? "reference" : edge.to.startsWith("scene:") ? "scene" : "record") as ScopedStaleness["scope"],
          sourceFingerprint: changed,
          changedFields: relevantFields,
          message: `${edge.reason}: ${changed.sourceKind} ${changed.sourceId} changed.`,
          blocksReadiness: edge.invalidationMode !== "manual-review",
        });
      }
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return stale.filter((item, index, items) => items.findIndex((other) => other.recordId === item.recordId && other.scope === item.scope && other.message === item.message) === index);
}
