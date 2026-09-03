import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendResearchVersion, makeEmptyResearchBible } from "../research/bible.ts";
import type { ApprovedScreenplayBoundary } from "../studio/screenplay.ts";
import { buildBreakdownSourceBoundary, buildDependencyGraphV2, propagateScopedStaleness, sourceFingerprint, stableHash } from "./dependency-graph.ts";
import { createProductionBreakdown, createResearchAwareProductionBreakdown } from "./breakdown.ts";

const screenplay: ApprovedScreenplayBoundary = {
  schemaVersion: 1,
  pictureId: "pic-a",
  screenplayVersionId: "spv-approved",
  approvedAt: 100,
  fountain: "INT. ROOM - DAY\n\nA lamp waits.",
  scenes: [{ id: "SCENE-001", slugline: "INT. ROOM - DAY", sourceLine: 1, screenplayVersionId: "spv-approved" }],
  provenance: { workflow: "single", sourceType: "concept", sourceVersionId: null, model: null },
  historicalContext: null,
};

function research() {
  const bible = makeEmptyResearchBible(1);
  return appendResearchVersion(bible, { id: "rv-approved", label: "Approved", kind: "approved", scope: "whole-picture", createdAt: 2, sourceVersionId: null, content: { ...bible.content, notes: "Use tungsten practicals.", cinematographyManifesto: { ...bible.content.cinematographyManifesto, thesis: "Tungsten islands" } } });
}

describe("Wave 3 dependency graph", () => {
  it("hashes approved text with normalized line endings and builds immutable boundaries", () => {
    assert.equal(stableHash("a\r\nb"), stableHash("a\nb"));
    const boundary = buildBreakdownSourceBoundary(screenplay, research(), 3);
    assert.ok(!("error" in boundary));
    assert.equal(boundary.fingerprints.filter((fp) => fp.immutableBoundary).length, 3);
  });

  it("links approved research and screenplay into scoped production graph", () => {
    const record = createResearchAwareProductionBreakdown({ screenplay, research: research(), now: 3, drafts: [{ id: "req-lamp", category: "prop", name: "Lamp", description: "Tungsten desk lamp", sceneIds: ["SCENE-001"], confidence: "B", evidenceNote: "research", socialWorldIds: [] }] });
    assert.ok(!("error" in record));
    assert.equal(record.sourceBoundary?.fingerprints.some((fp) => fp.sourceKind === "research"), true);
    assert.equal(record.graph?.nodes.some((node) => node.kind === "research-version"), true);
    assert.equal(record.graph?.edges.some((edge) => edge.reason.includes("approved research")), true);
  });

  it("propagates scoped stale records through requirements, assets, variants, and prepared assets", () => {
    const base = createProductionBreakdown({ pictureId: "pic-a", versionId: "spv", status: "APPROVED", fountain: "INT. A\n\nINT. B", scenes: [{ id: "SCENE-001", slugline: "A" }, { id: "SCENE-002", slugline: "B" }], socialWorld: [] }, [{ id: "req-a", category: "prop", name: "Key", description: "A key", sceneIds: ["SCENE-001"], variantLabel: "brass" }, { id: "req-b", category: "prop", name: "Door", description: "A door", sceneIds: ["SCENE-002"] }], 4);
    const assetId = base.assets.find((asset) => asset.requirementIds.includes("req-a"))!.id;
    const record = { ...base, preparedAssets: [{ id: `prepared:${assetId}`, assetId, variantId: null, specVersionId: "spec:key", visualBibleVersionIds: ["visual:approved"], cinematographyPlanIds: ["cine:approved"], status: "APPROVED_PREPARED" as const, blockers: [], promptIngredients: [], negativeRequirements: [], referenceIds: [], dependencyFingerprints: [], noGeneration: true as const, createdAt: 4, approvedAt: 4 }] };
    const graph = buildDependencyGraphV2(record, 4);
    const stale = propagateScopedStaleness(graph, sourceFingerprint({ sourceKind: "scene", sourceId: "SCENE-001", versionId: "spv", content: "changed", approvedAt: 5, immutableBoundary: true }), ["*"]);
    assert.deepEqual(stale.map((item) => item.recordId), ["req-a", assetId, `variant:req-a`, `prepared:${assetId}`]);
  });
});
