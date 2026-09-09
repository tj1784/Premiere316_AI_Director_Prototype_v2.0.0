import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseProductionBreakdowns } from "./persistence.ts";

const root = process.cwd();

describe("Wave 4 backend authority status UI fail-closed contract", () => {
  it("marks forged persisted CURRENT authority hints invalid until backend reconciliation", () => {
    const forged = {
      schemaVersion: 1,
      pictureId: "picture-forged",
      screenplayVersionId: "screenplay-forged",
      scenes: [],
      socialWorld: [],
      requirements: [],
      dependencies: [],
      assets: [{ id: "asset-forged", iterations: [{ id: "iteration-forged", canonicalProof: { decisionId: "canonical:forged" } }], specVersions: [] }],
      preparedAssets: [{ id: "prepared:asset-forged", assetId: "asset-forged", status: "APPROVED_PREPARED", blockers: [], preparedApprovalRootId: "preparedApproval:forged", preparedApprovalDigest: "a".repeat(64), productionAuthorityId: "authority:0123456789abcdef0123456789abcdef" }],
      productionAuthority: { authorityId: "authority:0123456789abcdef0123456789abcdef", digest: "b".repeat(64), createdAt: 1, status: "CURRENT" },
      queue: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const [restored] = parseProductionBreakdowns(JSON.stringify({ schemaVersion: 1, records: [forged] }));
    assert.equal(restored.productionAuthority?.status, "INVALID");
    assert.equal(restored.preparedAssets?.[0]?.status, "APPROVED_PREPARED");
  });

  it("privileged production controls are gated by freshly fetched backend status, not local hints", () => {
    const stageViews = readFileSync(join(root, "src/components/studio/stage-views.tsx"), "utf8");
    const preparedPanel = readFileSync(join(root, "src/components/production/prepared-assets-panel.tsx"), "utf8");
    assert.match(stageViews, /desktopProductionAuthorityStatus/);
    assert.match(stageViews, /refreshAuthorityStatus[\s\S]*desktopProductionAuthorityStatus/);
    assert.match(stageViews, /Backend authority\/prepared root mismatch/);
    assert.match(stageViews, /disabled=\{generating === item\.id \|\| item\.status !== "APPROVED_PREPARED" \|\| !rootCurrent/);
    assert.doesNotMatch(stageViews, /disabled=\{!production \|\| production\.productionAuthority\?\.status !== "CURRENT"/);
    assert.match(preparedPanel, /desktopProductionAuthorityStatus/);
    assert.match(preparedPanel, /disabled=\{sealing \|\| Boolean\(approving\) \|\| item\.status !== "READY_TO_PREPARE" \|\| !backendCurrent\}/);
  });
});
