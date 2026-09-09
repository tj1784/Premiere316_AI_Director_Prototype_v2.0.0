import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, it, before } from "node:test";

process.env.P316_LEDGER_HMAC_KEY = "11".repeat(32);
let backend;
let sourceFingerprint;

before(async () => {
  backend = (await import("./backend.mjs")).__testing;
  sourceFingerprint = (await import("../src/lib/production/dependency-graph.ts")).sourceFingerprint;
});

function tempMediaRoot() {
  const root = mkdtempSync(join(tmpdir(), "p316-ledger-"));
  backend.setReceiptMediaRoot(root);
  return root;
}

function ledgerPath(root) {
  return join(root, "stills", "security-ledger.v1.jsonl");
}

describe("Wave 4 chained backend security ledger", () => {
  it("accepts an intact relocated profile but rejects an altered signed checkpoint path", () => {
    const original = tempMediaRoot();
    backend.appendLedger("preparedApproval", "approval:relocation", { approvalDigest: "c".repeat(64) });
    const relocated = tempMediaRoot();
    mkdirSync(join(relocated, "stills"));
    copyFileSync(ledgerPath(original), ledgerPath(relocated));
    copyFileSync(`${ledgerPath(original)}.tail.json`, `${ledgerPath(relocated)}.tail.json`);
    assert.equal(backend.loadLedger().length, 1);
    const checkpoint = JSON.parse(readFileSync(`${ledgerPath(relocated)}.tail.json`, "utf8"));
    checkpoint.ledgerPath = "altered-without-a-valid-signature";
    writeFileSync(`${ledgerPath(relocated)}.tail.json`, JSON.stringify(checkpoint));
    assert.throws(() => backend.loadLedger(), /tail checkpoint/);
  });
  it("rejects valid-record reordering, tail truncation, and timestamp tamper", () => {
    const root = tempMediaRoot();
    backend.appendLedger("preparedApproval", "preparedApproval:a", { approvalDigest: "a".repeat(64) });
    backend.appendLedger("preparedSeal", "seal:b", { sealDigest: "b".repeat(64) });
    assert.equal(backend.loadLedger().length, 2);

    const file = ledgerPath(root);
    const original = readFileSync(file, "utf8").trim().split(/\r?\n/);
    writeFileSync(file, `${original[1]}\n${original[0]}\n`, "utf8");
    assert.throws(() => backend.loadLedger(), /chain order|MAC verification/);

    writeFileSync(file, `${original[0]}\n`, "utf8");
    assert.throws(() => backend.loadLedger(), /tail checkpoint/);

    const tampered = JSON.parse(original[0]);
    tampered.at += 1;
    writeFileSync(file, `${JSON.stringify(tampered)}\n${original[1]}\n`, "utf8");
    assert.throws(() => backend.loadLedger(), /MAC verification/);
  });

  it("rejects duplicate canonical approvals and reject-then-approve for the same generation receipt", () => {
    tempMediaRoot();
    backend.appendLedger("generationReceipt", "receipt:one", { receiptId: "receipt:one" });
    backend.appendLedger("canonicalDecision", "canonical:one", { receiptId: "receipt:one" });
    assert.throws(() => backend.appendLedger("canonicalDecision", "canonical:two", { receiptId: "receipt:one" }), /already has a canonical decision/);
    backend.appendLedger("generationReceipt", "receipt:two", { receiptId: "receipt:two" });
    backend.appendLedger("rejectionDecision", "rejection:one", { receiptId: "receipt:two" });
    assert.throws(() => backend.appendLedger("canonicalDecision", "canonical:after-reject", { receiptId: "receipt:two" }), /rejection decision/);
  });

  it("returns a meaningful untruncated full authority review document", () => {
    tempMediaRoot();
    const fixture = approvalFixture();
    fixture.asset.references = [{ id: "ref-one", name: "reference plate", uri: "media://refs/ref-one.png", mediaType: "image/png", preferred: true, uploadedAt: 10 }];
    fixture.prepared.referenceIds = ["ref-one"];
    const proposed = backend.proposeProductionAuthority({ pictureId: fixture.production.pictureId, rawCanonical: fixture.production });
    assert.equal(proposed.ok, true);
    assert.match(proposed.reviewDocument, /Untrusted project proposal normalized by the backend/);
    assert.match(proposed.reviewDocument, /canonicalProjection/);
    assert.match(proposed.reviewDocument, /activeAssets/);
    assert.match(proposed.reviewDocument, /canonicalSpecJson/);
    assert.match(proposed.reviewDocument, /promptDigest/);
    assert.match(proposed.reviewDocument, /dependencyFingerprintsDigest/);
    assert.match(proposed.reviewDocument, /visualRoots/);
    assert.match(proposed.reviewDocument, /cinematographyRoots/);
    assert.match(proposed.reviewDocument, /ref-one/);
    assert.doesNotMatch(proposed.reviewDocument, /Sample:/);
    assert.equal(proposed.summary.assets.length, 1);
  });

  it("rejects over-bound authority proposals instead of truncating privileged fields", () => {
    tempMediaRoot();
    const fixture = approvalFixture();
    fixture.production.assets = Array.from({ length: 257 }, (_unused, index) => ({ ...fixture.asset, id: `asset-${index}`, approvedSpecVersionId: `spec-${index}`, specVersions: [{ id: `spec-${index}`, createdAt: 10 }] }));
    const proposed = backend.proposeProductionAuthority({ pictureId: fixture.production.pictureId, rawCanonical: fixture.production });
    assert.equal(proposed.ok, false);
    assert.match(proposed.error, /too large/);
  });

  it("requires a prior backend-signed prepared approval root before proposal verification", () => {
    tempMediaRoot();
    const asset = {
      id: "asset-one",
      name: "Asset One",
      tombstone: false,
      updatedAt: 10,
      approvedSpecVersionId: "spec-one",
      canonicalSpec: { visualDescription: "A verified prop", continuityLocks: [], negativeRequirements: [] },
      specVersions: [{ id: "spec-one", createdAt: 10 }],
      references: [],
    };
    const dependencyFingerprints = [sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId: "spec-one", content: asset.canonicalSpec, approvedAt: 10, immutableBoundary: true })];
    const prepared = {
      id: "prepared:asset-one",
      assetId: "asset-one",
      specVersionId: "spec-one",
      status: "APPROVED_PREPARED",
      blockers: [],
      promptIngredients: ["A verified prop"],
      referenceIds: [],
      visualBibleVersionIds: [],
      cinematographyPlanIds: [],
      dependencyFingerprints,
      noGeneration: true,
      createdAt: 10,
      approvedAt: 10,
    };
    const production = { pictureId: "picture-one", screenplayVersionId: "screenplay-one", assets: [asset], preparedAssets: [prepared], graph: { stale: [] } };
    assert.throws(() => backend.verifyPreparedSnapshot({ authorityId: "authority:missing", preparedAssetId: prepared.id, preparedApprovalRootId: "preparedApproval:missing", engineId: "flux", engineName: "flux1-dev", values: {}, references: [] }, { components: [] }), /authority|approval root/);
  });
});

function sealFixture(fixture) {
  const proposed = backend.proposeProductionAuthority({ pictureId: fixture.production.pictureId, rawCanonical: fixture.production });
  assert.equal(proposed.ok, true);
  const sealed = backend.confirmProductionAuthority({ proposalId: proposed.proposalId, confirmed: true });
  assert.equal(sealed.ok, true);
  return sealed;
}

function approvalFixture() {
  const asset = {
    id: "asset-root",
    name: "Root Asset",
    tombstone: false,
    updatedAt: 10,
    approvedSpecVersionId: "spec-root",
    referenceRequired: false,
    canonicalSpec: { visualDescription: "A verified root prop", continuityLocks: ["brass key"], distinguishingFeatures: [], negativeRequirements: [] },
    specVersions: [{ id: "spec-root", createdAt: 10 }],
    references: [],
  };
  const dependencyFingerprints = [sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId: "spec-root", content: asset.canonicalSpec, approvedAt: 10, immutableBoundary: true })];
  const prepared = { id: "prepared:asset-root", assetId: asset.id, specVersionId: "spec-root", status: "READY_TO_PREPARE", blockers: [], promptIngredients: ["A verified root prop"], referenceIds: [], visualBibleVersionIds: [], cinematographyPlanIds: [], dependencyFingerprints, noGeneration: true, createdAt: 10, approvedAt: null, preparedApprovalRootId: null, preparedApprovalDigest: null };
  const production = { pictureId: "picture-root", screenplayVersionId: "screenplay-root", assets: [asset], preparedAssets: [prepared], graph: { stale: [] } };
  return { asset, prepared, production };
}

function preparedRootFixture(reset = true) {
  if (reset) tempMediaRoot();
  const fixture = approvalFixture();
  const authority = sealFixture(fixture);
  const proposal = backend.proposePreparedApproval({ authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id });
  const approval = backend.confirmPreparedApproval({ proposalId: proposal.proposalId, confirmed: true });
  assert.equal(approval.ok, true);
  return { fixture, authority, approval };
}

describe("Prepared GPU prompt batch authorization", () => {
  it("validates the complete authority-bound batch without minting generation seals or tokens", () => {
    const root = preparedRootFixture();
    const input = { pictureId: root.fixture.production.pictureId, authorityId: root.authority.authorityId, engineId: "krea-2", prompts: [{ preparedAssetId: root.fixture.prepared.id, preparedApprovalRootId: root.approval.rootId, prompt: "Exact model-written sheet prompt", values: { width: 1024, height: 1024, seed: 17, steps: 1, guidance: 1 } }] };
    const manifest = { adapterId: "krea-2", modelVariant: "krea2-raw", status: "READY", components: [] };
    const before = backend.loadLedger().length;
    const [job] = backend.verifyDraftPromptBatch(input, manifest);
    assert.equal(job.prompt, input.prompts[0].prompt);
    assert.equal(job.values.width, 1024);
    assert.equal(job.values.height, 1024);
    assert.equal(job.values.steps, 52);
    assert.equal(job.values.guidance, 3.5);
    assert.equal(job.conditioningMode, "text-only");
    assert.deepEqual(job.references, []);
    assert.equal(backend.loadLedger().length, before);
    for (const changed of [{ ...input, pictureId: "wrong-picture" }, { ...input, prompts: [input.prompts[0], input.prompts[0]] }, { ...input, prompts: [{ ...input.prompts[0], preparedApprovalRootId: `preparedApproval:${"0".repeat(32)}` }] }, { ...input, prompts: [{ ...input.prompts[0], values: { width: 1024, height: 512 } }] }]) assert.throws(() => backend.verifyDraftPromptBatch(changed, manifest));
    assert.throws(() => backend.verifyDraftPromptBatch(input, { ...manifest, status: "MISSING_COMPONENT" }), /unavailable/);
    sealFixture(root.fixture);
    assert.throws(() => backend.verifyDraftPromptBatch(input, manifest), /stale/);
  });
  it("keeps sealed research images separate from KREA pixel conditioning", () => {
    const root = recoverableFixture(true);
    const job = backend.verifyPreparedSnapshot({ authorityId: root.authority.authorityId, preparedAssetId: root.fixture.prepared.id, preparedApprovalRootId: root.request.preparedApprovalRootId, engineId: "krea-2", promptOverride: root.request.prompt, values: { width: 1024, height: 1024 } }, { adapterId: "krea-2", modelVariant: "krea2-raw", status: "READY", components: [] });
    assert.deepEqual(job.references, []);
    assert.deepEqual(job.promptReferences, root.request.referenceUris);
    assert.equal(job.conditioningMode, "text-only");
  });
});

function appendReceipt(root, suffix = "one") {
  const receiptId = `receipt:${suffix}`;
  const receipt = {
    receiptId,
    authorityId: root.authority.authorityId,
    authorityDigest: root.authority.digest,
    pictureId: root.fixture.production.pictureId,
    preparedAssetId: root.fixture.prepared.id,
    assetId: root.fixture.asset.id,
    iterationId: `iteration:${root.fixture.asset.id}:${suffix}`,
    preparedApprovalRootId: root.approval.rootId,
    preparedApprovalDigest: root.approval.digest,
    preparedSealDigest: "b".repeat(64),
    productionDigest: root.authority.digest,
    manifestDigest: "c".repeat(64),
    continuityFindings: [],
    output: { mediaUri: `media://stills/${suffix}.png`, mediaSha256: "d".repeat(64), sidecarSha256: "e".repeat(64) },
  };
  backend.appendLedger("generationReceipt", receiptId, receipt);
  return receipt;
}

function recoverableFixture(withReference = false) {
  const mediaRoot = tempMediaRoot();
  const fixture = approvalFixture();
  mkdirSync(join(mediaRoot, "stills"));
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  if (withReference) {
    const bytes = Buffer.from("immutable reference test bytes");
    const name = `reference-${hash(bytes)}.png`;
    writeFileSync(join(mediaRoot, "stills", name), bytes);
    fixture.asset.references = [{ id: "reference-robe", name: "Robe", uri: `media://stills/${name}` }];
    fixture.prepared.referenceIds = ["reference-robe"];
  }
  const authority = sealFixture(fixture);
  const proposal = backend.proposePreparedApproval({ authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id });
  const approval = backend.confirmPreparedApproval({ proposalId: proposal.proposalId, confirmed: true });
  const prompt = "Exact original model-written prompt";
  const seal = { sealId: "seal:recovery", authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id, preparedApprovalRootId: approval.rootId, promptDigest: backend.domainDigest("p316.prepared.prompt.v1", { prompt }) };
  backend.appendLedger("preparedSeal", seal.sealId, seal);
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8); png.write("IHDR", 12); png.writeUInt32BE(512, 16); png.writeUInt32BE(512, 20);
  const provenance = { schemaVersion: 1, assetId: fixture.asset.id, engineId: "flux2", runtimeAdapter: "flux2", prompt, references: fixture.asset.references.map((reference) => ({ id: reference.uri, fingerprint: hash(readFileSync(join(mediaRoot, "stills", reference.uri.split("/").at(-1)))) })) };
  const sidecar = Buffer.from(JSON.stringify(provenance));
  writeFileSync(join(mediaRoot, "stills", "recovered.png"), png);
  writeFileSync(join(mediaRoot, "stills", "recovered.provenance.json"), sidecar);
  const output = { mediaUri: "media://stills/recovered.png", mediaSha256: hash(png), sidecarSha256: hash(sidecar), width: 512, height: 512, byteLength: png.length };
  const receipt = { receiptId: "receipt:original", iterationId: "iteration:original", pictureId: fixture.production.pictureId, authorityId: authority.authorityId, authorityDigest: authority.digest, preparedAssetId: fixture.prepared.id, assetId: fixture.asset.id, specVersionId: fixture.asset.approvedSpecVersionId, preparedApprovalRootId: approval.rootId, preparedApprovalDigest: approval.digest, sealId: seal.sealId, sealDigest: backend.digest(seal), preparedSealDigest: backend.digest(seal), output, outputDigest: backend.domainDigest("p316.canonical.output.v1", output), provenanceDigest: backend.digest(provenance), continuityFindings: [] };
  backend.appendLedger("generationReceipt", receipt.receiptId, receipt);
  const request = { preparedAssetId: fixture.prepared.id, preparedApprovalRootId: approval.rootId, prompt, engineId: "flux2", referenceUris: fixture.asset.references.map((reference) => reference.uri), knownIterationIds: [] };
  return { mediaRoot, fixture, authority, receipt, request, input: { pictureId: fixture.production.pictureId, authorityId: authority.authorityId, rawCanonical: fixture.production, requests: [request] } };
}

describe("Saved image response recovery", () => {
  it("restores hydrated authority proofs only after the current raw inventory matches the sealed projection", () => {
    const f = recoverableFixture();
    f.input.rawCanonical.productionAuthority = { ...f.authority, status: "INVALID" };
    const restored = backend.recoverDrafts(f.input);
    assert.equal(restored.authority.authorityId, f.authority.authorityId);
    assert.equal(restored.approvals[0].rootId, f.request.preparedApprovalRootId);
    const withSavedImage = structuredClone(f.input);
    withSavedImage.rawCanonical.assets[0].updatedAt = 987654;
    withSavedImage.rawCanonical.assets[0].iterations = [{ id: "already-saved-image", status: "NEEDS_REVIEW" }];
    const resumed = backend.recoverDrafts(withSavedImage);
    assert.equal(resumed.authority.authorityId, f.authority.authorityId);
    assert.equal(withSavedImage.rawCanonical.assets[0].updatedAt, 987654);
    assert.equal(withSavedImage.rawCanonical.assets[0].iterations[0].status, "NEEDS_REVIEW");
    const changed = structuredClone(f.input);
    changed.rawCanonical.assets[0].canonicalSpec.visualDescription = "A changed unsealed asset";
    const rejected = backend.recoverDrafts(changed);
    assert.equal(rejected.results.length, 0);
    assert.equal(rejected.authority, undefined);
  });
  it("recovers durable output with the original signed receipt and iteration IDs, without appending ledger records", () => {
    const f = recoverableFixture(true);
    const before = backend.loadLedger().length;
    const result = backend.recoverDrafts(f.input);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].iterationId, f.receipt.iterationId);
    assert.equal(result.results[0].output.receiptId, f.receipt.receiptId);
    assert.equal(result.results[0].receiptDigest, backend.domainDigest("p316.generationReceipt.v1", f.receipt));
    assert.equal(backend.loadLedger().length, before);
    f.request.knownIterationIds = [f.receipt.iterationId];
    assert.equal(backend.recoverDrafts(f.input).results.length, 0);
  });
  it("never accepts a wrong prompt, engine, reference set or changed reference bytes", () => {
    const f = recoverableFixture(true);
    for (const patch of [{ prompt: "different" }, { engineId: "flux" }, { referenceUris: [] }]) {
      const result = backend.recoverDrafts({ ...f.input, requests: [{ ...f.request, ...patch }] });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.results.length, 0);
    }
    writeFileSync(join(f.mediaRoot, "stills", f.request.referenceUris[0].split("/").at(-1)), "changed reference");
    assert.equal(backend.recoverDrafts(f.input).results.length, 0);
  });
  it("rejects another picture, superseded authority, and modified image or provenance files", () => {
    let f = recoverableFixture();
    assert.equal(backend.recoverDrafts({ ...f.input, pictureId: "another-picture" }).ok, false);
    sealFixture(f.fixture);
    assert.match(backend.recoverDrafts(f.input).error, /stale/);
    f = recoverableFixture();
    writeFileSync(join(f.mediaRoot, "stills", "recovered.provenance.json"), "{}");
    assert.match(backend.recoverDrafts(f.input).error, /hash changed/);
    f = recoverableFixture();
    writeFileSync(join(f.mediaRoot, "stills", "recovered.png"), "changed image");
    assert.equal(backend.recoverDrafts(f.input).ok, false);
  });
});

describe("Wave 4 main-owned canonical rejection lifecycle", () => {
  it("requires one-use native-confirmed rejection proposals and appends nothing on cancel/replay", () => {
    const root = preparedRootFixture();
    const receipt = appendReceipt(root, "reject");
    const proposal = backend.proposeCanonicalRejection({ authorityId: root.authority.authorityId, preparedApprovalRootId: root.approval.rootId, receiptId: receipt.receiptId, iterationId: receipt.iterationId, reason: "visible mismatch" });
    assert.equal(proposal.ok, true);
    const canceled = backend.confirmCanonicalRejection({ proposalId: proposal.proposalId, confirmed: false });
    assert.equal(canceled.ok, false);
    assert.equal(backend.productionAuthorityStatus({ pictureId: root.fixture.production.pictureId }).canonicalHistory.length, 0);
    const replayCancel = backend.confirmCanonicalRejection({ proposalId: proposal.proposalId, confirmed: true });
    assert.equal(replayCancel.ok, false);
    const second = backend.proposeCanonicalRejection({ authorityId: root.authority.authorityId, preparedApprovalRootId: root.approval.rootId, receiptId: receipt.receiptId, iterationId: receipt.iterationId, reason: "visible mismatch" });
    const confirmed = backend.confirmCanonicalRejection({ proposalId: second.proposalId, confirmed: true });
    assert.equal(confirmed.ok, true);
    const replayConfirm = backend.confirmCanonicalRejection({ proposalId: second.proposalId, confirmed: true });
    assert.equal(replayConfirm.ok, false);
    assert.equal(backend.productionAuthorityStatus({ pictureId: root.fixture.production.pictureId }).canonicalHistory.length, 1);
  });

  it("rejects forged, cross-root, stale, and reject-then-approve canonical mutations", () => {
    const root = preparedRootFixture();
    const receipt = appendReceipt(root, "guard");
    assert.equal(backend.proposeCanonicalRejection({ authorityId: root.authority.authorityId, preparedApprovalRootId: "preparedApproval:forged", receiptId: receipt.receiptId, iterationId: receipt.iterationId, reason: "bad" }).ok, false);
    assert.equal(backend.confirmCanonicalRejection({ proposalId: "canonicalRejectionProposal:forged", confirmed: true }).ok, false);
    const staleProposal = backend.proposeCanonicalRejection({ authorityId: root.authority.authorityId, preparedApprovalRootId: root.approval.rootId, receiptId: receipt.receiptId, iterationId: receipt.iterationId, reason: "stale later" });
    assert.equal(staleProposal.ok, true);
    sealFixture(root.fixture);
    const stale = backend.confirmCanonicalRejection({ proposalId: staleProposal.proposalId, confirmed: true });
    assert.equal(stale.ok, false);
    assert.match(stale.error, /stale|current|changed/i);

    const current = preparedRootFixture();
    const rejectedReceipt = appendReceipt(current, "after-reject");
    const rejection = backend.proposeCanonicalRejection({ authorityId: current.authority.authorityId, preparedApprovalRootId: current.approval.rootId, receiptId: rejectedReceipt.receiptId, iterationId: rejectedReceipt.iterationId, reason: "not canonical" });
    assert.equal(backend.confirmCanonicalRejection({ proposalId: rejection.proposalId, confirmed: true }).ok, true);
    const approval = backend.proposeCanonicalApproval({ authorityId: current.authority.authorityId, preparedApprovalRootId: current.approval.rootId, receiptId: rejectedReceipt.receiptId, iterationId: rejectedReceipt.iterationId, reason: "approve anyway", findings: [] });
    assert.equal(approval.ok, false);
    assert.match(approval.error, /rejection decision|no such file|durable media/i);
  });
});

describe("Wave 4 backend authority status scoping", () => {
  it("returns only current-picture roots and canonical/rejection history", () => {
    tempMediaRoot();
    const first = preparedRootFixture(false);
    const firstReceipt = appendReceipt(first, "first-picture");
    const firstRejection = backend.proposeCanonicalRejection({ authorityId: first.authority.authorityId, preparedApprovalRootId: first.approval.rootId, receiptId: firstReceipt.receiptId, iterationId: firstReceipt.iterationId, reason: "first only" });
    assert.equal(backend.confirmCanonicalRejection({ proposalId: firstRejection.proposalId, confirmed: true }).ok, true);

    const secondFixture = approvalFixture();
    secondFixture.production.pictureId = "picture-second";
    secondFixture.production.screenplayVersionId = "screenplay-second";
    const secondAuthority = sealFixture(secondFixture);
    const secondApprovalProposal = backend.proposePreparedApproval({ authorityId: secondAuthority.authorityId, preparedAssetId: secondFixture.prepared.id });
    const secondApproval = backend.confirmPreparedApproval({ proposalId: secondApprovalProposal.proposalId, confirmed: true });
    const secondReceipt = appendReceipt({ fixture: secondFixture, authority: secondAuthority, approval: secondApproval }, "second-picture");
    const secondRejection = backend.proposeCanonicalRejection({ authorityId: secondAuthority.authorityId, preparedApprovalRootId: secondApproval.rootId, receiptId: secondReceipt.receiptId, iterationId: secondReceipt.iterationId, reason: "second only" });
    assert.equal(backend.confirmCanonicalRejection({ proposalId: secondRejection.proposalId, confirmed: true }).ok, true);

    const firstStatus = backend.productionAuthorityStatus({ pictureId: first.fixture.production.pictureId });
    const secondStatus = backend.productionAuthorityStatus({ pictureId: secondFixture.production.pictureId });
    assert.equal(firstStatus.ok, true);
    assert.equal(secondStatus.ok, true);
    assert.equal(firstStatus.canonicalHistory.length, 1);
    assert.equal(secondStatus.canonicalHistory.length, 1);
    assert.equal(firstStatus.canonicalHistory[0].receiptId, firstReceipt.receiptId);
    assert.equal(secondStatus.canonicalHistory[0].receiptId, secondReceipt.receiptId);
    assert.equal(firstStatus.preparedApprovals.every((root) => root.authorityId === firstStatus.authorityId), true);
    assert.equal(secondStatus.preparedApprovals.every((root) => root.authorityId === secondStatus.authorityId), true);
  });
});

describe("Wave 4 prepared approval root lifecycle", () => {
  it("cancel creates no root and confirm creates a ledger-bound root", () => {
    tempMediaRoot();
    const fixture = approvalFixture();
    const authority = sealFixture(fixture);
    const proposal = backend.proposePreparedApproval({ authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id });
    assert.equal(proposal.ok, true);
    const canceled = backend.confirmPreparedApproval({ proposalId: proposal.proposalId, confirmed: false });
    assert.equal(canceled.ok, false);
    assert.equal(backend.loadLedger().some((entry) => entry.kind === "preparedApproval"), false);

    const second = backend.proposePreparedApproval({ authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id });
    const confirmed = backend.confirmPreparedApproval({ proposalId: second.proposalId, confirmed: true });
    assert.equal(confirmed.ok, true);
    assert.match(confirmed.rootId, /^preparedApproval:/);
    assert.match(confirmed.digest, /^[a-f0-9]{64}$/);
    assert.equal(backend.loadLedger().some((entry) => entry.kind === "preparedApproval" && entry.id === confirmed.rootId), true);
  });

  it("missing, forged, cross-asset, stale, and replayed roots fail prepared verification", () => {
    tempMediaRoot();
    const fixture = approvalFixture();
    const authority = sealFixture(fixture);
    const proposal = backend.proposePreparedApproval({ authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id });
    const confirmed = backend.confirmPreparedApproval({ proposalId: proposal.proposalId, confirmed: true });
    assert.equal(confirmed.ok, true);
    const params = { authorityId: authority.authorityId, preparedAssetId: fixture.prepared.id, engineId: "flux", engineName: "flux1-dev", values: {}, references: [], preparedApprovalRootId: confirmed.rootId };
    assert.doesNotThrow(() => backend.verifyPreparedSnapshot(params, { components: [] }));
    assert.throws(() => backend.verifyPreparedSnapshot({ ...params, preparedApprovalRootId: undefined }, { components: [] }), /approval root/);
    assert.throws(() => backend.verifyPreparedSnapshot({ ...params, preparedApprovalRootId: "preparedApproval:forged" }, { components: [] }), /approval root/);
    assert.throws(() => backend.verifyPreparedSnapshot({ ...params, preparedAssetId: "prepared:other" }, { components: [] }), /not found|prepared/i);
    const newer = sealFixture(fixture);
    assert.throws(() => backend.verifyPreparedSnapshot({ ...params, authorityId: authority.authorityId }, { components: [] }), /stale/);
    assert.throws(() => backend.verifyPreparedSnapshot({ ...params, authorityId: newer.authorityId }, { components: [] }), /current authority/);
    const replay = backend.confirmPreparedApproval({ proposalId: proposal.proposalId, confirmed: true });
    assert.equal(replay.ok, false);
    assert.match(replay.error, /missing|resolved/);
  });
});
