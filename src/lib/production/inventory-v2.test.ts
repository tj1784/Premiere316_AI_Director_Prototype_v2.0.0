import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProductionBreakdown } from "./breakdown.ts";
import { approveCanonicalSpec, editAsset } from "./index.ts";
import { replaceAssetImage, inventoryCards, approveInventoryAssetSpec, editInventoryAsset, linkAssetReference, mergeInventoryAssets, prepareAssetRecords, splitInventoryAsset } from "./inventory.ts";
import type { AssetReference } from "./types.ts";

function record() {
  return createProductionBreakdown({ pictureId: "pic", versionId: "spv", status: "APPROVED", fountain: "x", scenes: [{ id: "SCENE-001", slugline: "A" }, { id: "SCENE-002", slugline: "B" }], socialWorld: [] }, [
    { id: "req-hero", category: "character", name: "Archivist", description: "Tired archivist", sceneIds: ["SCENE-001"] },
    { id: "req-reel", category: "prop", name: "Film reel", description: "Unlabeled metal reel", sceneIds: ["SCENE-002"], referenceRequired: true },
  ], 10);
}

describe("Inventory 2.0 lineage and preparation", () => {
  it("adds missing scene coverage with a linked requirement and preserves existing media", () => {
    const base = record(), asset = base.assets[0];
    const next = editInventoryAsset(base, asset.id, { additionalSceneIds: ["SCENE-002", "SCENE-002"] }, 30);
    const changed = next.assets.find(a => a.id === asset.id)!;
    assert.deepEqual(changed.requiredSceneIds, ["SCENE-001", "SCENE-002"]);
    assert.deepEqual(changed.iterations, asset.iterations);
    assert.ok(next.requirements.some(r => changed.requirementIds.includes(r.id) && r.sceneIds.includes("SCENE-002")));
    assert.throws(() => editInventoryAsset(base, asset.id, { additionalSceneIds: ["unknown-scene"] }), /belong to this screenplay/);
    const again = editInventoryAsset(next, asset.id, { additionalSceneIds: ["SCENE-002"] }, 31);
    assert.equal(again.requirements.length, next.requirements.length);
  });
  it("edits and approves specs append versions without changing asset ids", () => {
    const base = record();
    const id = base.assets[0]!.id;
    const edited = editInventoryAsset(base, id, { canonicalSpec: { visualDescription: "Precise tired archivist" } }, 11);
    assert.equal(edited.assets[0]!.id, id);
    assert.equal(edited.assets[0]!.specVersions?.length, 1);
    const approved = approveInventoryAssetSpec(edited, id, 12);
    assert.equal(approved.assets[0]!.approvedSpecVersionId, `spec:${id}:11`);
    assert.equal(approved.assets[0]!.readiness, "READY_TO_PREPARE");
  });

  it("freezes approved spec bytes before editing an approved legacy asset", () => {
    const base = record();
    const id = base.assets[0]!.id;
    const approved = approveInventoryAssetSpec(editInventoryAsset(base, id, { canonicalSpec: { visualDescription: "Approved archivist" } }, 20), id, 21);
    const legacyApproved = { ...approved, assets: approved.assets.map((asset) => asset.id === id ? { ...asset, specVersions: [] } : asset) };
    const edited = editInventoryAsset(legacyApproved, id, { canonicalSpec: { visualDescription: "Changed draft" } }, 22);
    const asset = edited.assets.find((item) => item.id === id)!;
    const frozen = asset.specVersions?.find((version) => version.id === `spec:${id}:20`);
    assert.equal(frozen?.approved, true);
    assert.equal(frozen?.spec.visualDescription, "Approved archivist");
    assert.equal(asset.specVersions?.at(-1)?.sourceVersionId, `spec:${id}:20`);
    assert.equal(asset.canonicalApproved, false);
  });

  it("preserves approved spec versions through UI-facing edit and explicit approval", () => {
    const base = record();
    const id = base.assets[0]!.id;
    const firstDraft = editInventoryAsset(base, id, { name: "Archivist", category: "character", canonicalSpec: { visualDescription: "Approved archivist bytes", identity: "Elias with cotton gloves" } }, 30);
    const firstApproved = approveInventoryAssetSpec(firstDraft, id, 31);
    const approvedAsset = firstApproved.assets.find((item) => item.id === id)!;
    const oldApprovedId = approvedAsset.approvedSpecVersionId!;
    const oldApprovedSpec = structuredClone(approvedAsset.specVersions!.find((version) => version.id === oldApprovedId)!.spec);

    const edited = editInventoryAsset(firstApproved, id, { name: "Lead Archivist", category: "prop", canonicalSpec: { visualDescription: "Changed draft bytes", continuityLocks: ["new lock"] } }, 32);
    const editedAsset = edited.assets.find((item) => item.id === id)!;
    const oldVersionAfterEdit = editedAsset.specVersions!.find((version) => version.id === oldApprovedId)!;
    assert.deepEqual(oldVersionAfterEdit.spec, oldApprovedSpec);
    assert.equal(oldVersionAfterEdit.approved, true);
    assert.equal(editedAsset.canonicalApproved, false);
    assert.equal(editedAsset.approvedSpecVersionId, null);
    assert.equal(editedAsset.normalizedKey, "prop:lead archivist");
    assert.equal(editedAsset.specVersions!.at(-1)?.sourceVersionId, oldApprovedId);
    assert.equal(edited.graph?.nodes.some((node) => node.id === `asset:${id}`), true);

    const secondApproved = approveInventoryAssetSpec(edited, id, 33);
    const secondAsset = secondApproved.assets.find((item) => item.id === id)!;
    const newApprovedId = secondAsset.approvedSpecVersionId!;
    assert.notEqual(newApprovedId, oldApprovedId);
    assert.equal(secondAsset.canonicalApproved, true);
    assert.equal(secondAsset.canonicalSpec.visualDescription, "Changed draft bytes");
    assert.deepEqual(secondAsset.specVersions!.find((version) => version.id === oldApprovedId)!.spec, oldApprovedSpec);
    assert.equal(secondAsset.specVersions!.filter((version) => version.approved).length, 2);
    assert.equal(secondAsset.lineage?.some((event) => event.type === "edited"), true);
    assert.equal(secondAsset.lineage?.some((event) => event.type === "approved-spec"), true);
  });

  it("hardens legacy public edit and approval functions against false readiness", () => {
    const base = record();
    const id = base.assets[0]!.id;
    const baseAsset = base.assets.find((item) => item.id === id)!;
    const firstApproved = approveCanonicalSpec(editAsset(base, id, { canonicalSpec: { ...baseAsset.canonicalSpec, visualDescription: "Legacy approved bytes" } }, 40), id, 41);
    const oldApprovedId = firstApproved.assets.find((item) => item.id === id)!.approvedSpecVersionId!;
    const oldApprovedSpec = structuredClone(firstApproved.assets.find((item) => item.id === id)!.specVersions!.find((version) => version.id === oldApprovedId)!.spec);

    const approvedAsset = firstApproved.assets.find((item) => item.id === id)!;
    const edited = editAsset(firstApproved, id, { category: "prop", canonicalSpec: { ...approvedAsset.canonicalSpec, visualDescription: "Legacy changed draft" } }, 42);
    const editedAsset = edited.assets.find((item) => item.id === id)!;
    assert.equal(editedAsset.canonicalApproved, false);
    assert.equal(editedAsset.approvedSpecVersionId, null);
    assert.deepEqual(editedAsset.specVersions!.find((version) => version.id === oldApprovedId)!.spec, oldApprovedSpec);
    assert.equal(editedAsset.specVersions!.at(-1)?.sourceVersionId, oldApprovedId);

    const reapproved = approveCanonicalSpec(edited, id, 43);
    const reapprovedAsset = reapproved.assets.find((item) => item.id === id)!;
    assert.notEqual(reapprovedAsset.approvedSpecVersionId, oldApprovedId);
    assert.equal(reapprovedAsset.canonicalSpec.visualDescription, "Legacy changed draft");
    assert.equal(reapprovedAsset.specVersions!.filter((version) => version.approved).length, 2);
  });

  it("merge preserves target id and tombstones sources", () => {
    const base = record();
    const target = base.assets[0]!.id;
    const source = base.assets[1]!.id;
    const merged = mergeInventoryAssets(base, target, [source], 13);
    assert.equal(merged.assets.find((asset) => asset.id === target)?.aliases.includes("Film reel"), true);
    assert.equal(merged.assets.find((asset) => asset.id === source)?.tombstone, true);
  });

  it("split creates explicit child lineage and does not copy references by default", () => {
    const base = record();
    const source = base.assets[0]!;
    const split = splitInventoryAsset(base, source.id, { newAssetId: "asset:split", name: "Split Archivist", requirementIds: [source.requirementIds[0]!] }, 14);
    assert.equal(split.assets.some((asset) => asset.id === "asset:split"), true);
    assert.deepEqual(split.assets.find((asset) => asset.id === "asset:split")?.references, []);
  });

  it("prepared assets explain blockers and never generate media", () => {
    let current = record();
    const asset = current.assets[1]!;
    const ref: AssetReference = { id: "ref-1", name: "local reel reference", uri: "file://reference/reel.png", mediaType: "image/png", preferred: true, uploadedAt: 15, provenance: { sourceType: "user", screenplayVersionId: "spv", sceneIds: ["SCENE-002"], createdAt: 15 } };
    current = linkAssetReference(current, asset.id, ref, 15);
    current = approveInventoryAssetSpec(editInventoryAsset(current, asset.id, { canonicalSpec: { visualDescription: "Approved reel spec" } }, 16), asset.id, 17);
    const blocked = prepareAssetRecords(current, [], [], 18);
    assert.equal(blocked.preparedAssets?.find((item) => item.assetId === asset.id)?.noGeneration, true);
    assert.match(blocked.preparedAssets?.find((item) => item.assetId === asset.id)?.blockers.join("\n") ?? "", /visual-development bible/);
    const ready = prepareAssetRecords(current, ["visual:approved"], ["cine:approved"], 19);
    const prepared = ready.preparedAssets?.find((item) => item.assetId === asset.id);
    assert.equal(prepared?.status, "READY_TO_PREPARE");
    assert.equal(prepared?.approvedAt, null);
    assert.equal(prepared?.preparedApprovalRootId, null);
    assert.equal(ready.graph?.nodes.some((node) => node.id === `prepared-asset:${prepared?.id}`), true);
  });
});

it("manual upload replaces the displayed image and retains history without generated provenance", () => {
  const base = record(), id = base.assets[0].id;
  const first = replaceAssetImage(base, id, { uri: "data:image/png;base64,old", name: "old.png" }, 40);
  const next = replaceAssetImage(first, id, { uri: "data:image/png;base64,new", name: "new.png" }, 41);
  assert.equal(next.assets[0].iterations.length, 2);
  assert.equal(inventoryCards(next, { category: "all", readiness: "all", query: "" })[0].previewUri, "data:image/png;base64,new");
  assert.equal(next.assets[0].iterations[1].provenance.sourceType, "user");
  assert.equal(next.assets[0].approvedIterationId, null);
});
