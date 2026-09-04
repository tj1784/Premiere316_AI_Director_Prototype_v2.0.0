import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { appendGeneratedIteration, approveCanonicalIteration, reviewGeneratedIteration, validatePngSignature } from "./image-iterations.ts";
import { applyPreparedApproval, applyProductionAuthority, approveInventoryAssetSpec, editInventoryAsset, prepareAssetRecords } from "./inventory.ts";
import { createProductionBreakdown } from "./breakdown.ts";
import type { GenerationProvenance } from "../studio/generation-provenance.ts";

function record() {
  const base = createProductionBreakdown({
    pictureId: "pic-wave4",
    versionId: "screenplay-approved",
    status: "APPROVED",
    fountain: "INT. ARCHIVE - NIGHT",
    scenes: [{ id: "scene-1", slugline: "INT. ARCHIVE - NIGHT" }],
    socialWorld: [],
  }, [{ id: "req-1", category: "character", name: "Elias Voss", description: "archivist", sceneIds: ["scene-1"], hero: true }], 1000);
  const assetId = base.assets[0].id;
  const edited = editInventoryAsset(base, assetId, { canonicalSpec: { visualDescription: "Elias with a rain-dark wool coat", continuityLocks: ["wool coat", "silver glasses"], distinguishingFeatures: ["silver glasses"] } }, 1100);
  const approved = approveInventoryAssetSpec(edited, assetId, 1200);
  const preparedReady = prepareAssetRecords(approved, ["visual-approved"], ["cine-approved"], 1300);
  const authorityId = "authority:0123456789abcdef0123456789abcdef";
  const sealed = applyProductionAuthority(preparedReady, { authorityId, digest: "9".repeat(64), createdAt: 1305 });
  const breakdown = applyPreparedApproval(sealed, { preparedAssetId: `prepared:${assetId}`, rootId: "preparedApproval:test", approvedAt: 1310, digest: "a".repeat(64), authorityId });
  return { assetId, preparedId: `prepared:${assetId}`, authorityId, record: breakdown };
}

function provenance(assetId: string): GenerationProvenance {
  return {
    schemaVersion: 1,
    assetId,
    engineId: "flux",
    engineName: "FLUX.1 Dev",
    runtimeAdapter: "flux",
    runtimeImplementation: "black-forest-labs/flux",
    baseCheckpoint: { id: "diffusion_models/flux1-dev.safetensors", path: "diffusion_models/flux1-dev.safetensors", fingerprint: "abc", fingerprintKind: "sampled" },
    components: [],
    loras: [],
    prompt: "Elias Voss in archive rain",
    enhancedPrompt: null,
    references: [],
    width: 512,
    height: 512,
    steps: 20,
    guidance: 3.5,
    seed: 42,
    scheduler: "flux1-official-20-guidance-3.5",
    timestepData: null,
    precision: "BF16",
    outputFormat: "PNG",
    outputBitDepth: 8,
    placementPlan: null,
    generatedAt: new Date(1400).toISOString(),
    applicationVersion: "3.0.2",
    telemetry: { modelLoadMs: null, inferenceMs: null, totalMs: 1000, peakVramBytes: null, peakSystemRamBytes: null, residentBeforeJob: false, residentAfterJob: true },
  };
}

const pngBytes = makePngBytes(512, 512, 320);
const sidecarBytes = (assetId = "asset:character:elias:voss") => new TextEncoder().encode(JSON.stringify(provenance(assetId)));
function outputFor(assetId: string) {
  const proofSidecarBytes = sidecarBytes(assetId);
  return {
    mediaUri: "media://stills/iter-1.abcdef0123456789abcdef01.png",
    mediaSha256: realSha256(pngBytes),
    sidecarSha256: realSha256(proofSidecarBytes),
    width: 512,
    height: 512,
    byteLength: pngBytes.byteLength,
    mediaBytes: pngBytes,
    sidecarBytes: proofSidecarBytes,
    receiptId: "receipt:test",
  };
}
const output = outputFor("asset:character:elias:voss");
const receiptDigest = "c".repeat(64);

function stableString(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    return item;
  });
}

function canonicalDigest(domain: string, payload: unknown): string {
  return createHash("sha256").update(stableString({ domain, schemaVersion: 1, payload })).digest("hex");
}

function canonicalProof(start: ReturnType<typeof record>, reason: string, outputData = output, continuityFindings: Array<{ id: string; severity: "blocker" | "warning"; message: string; confirmed: boolean }> = []) {
  return {
    decisionId: "canonical:0123456789abcdef0123456789abcdef",
    authorityId: start.authorityId,
    receiptId: outputData.receiptId,
    signedRecordMac: "b".repeat(64),
    generationReceiptDigest: receiptDigest,
    preparedApprovalRootId: "preparedApproval:test",
    preparedApprovalDigest: "a".repeat(64),
    preparedSealDigest: "d".repeat(64),
    assetId: start.assetId,
    preparedAssetId: start.preparedId,
    iterationId: "iter-1",
    reasonDigest: canonicalDigest("p316.canonical.reason.v1", { reason }),
    continuityDigest: canonicalDigest("p316.canonical.continuity.v1", continuityFindings),
    outputDigest: canonicalDigest("p316.canonical.output.v1", { mediaUri: outputData.mediaUri, mediaSha256: outputData.mediaSha256, sidecarSha256: outputData.sidecarSha256, width: outputData.width, height: outputData.height, byteLength: outputData.byteLength }),
  };
}

describe("Wave 4 image iterations", () => {
  it("appends generated output only through an approved prepared asset and preserves append-only review", () => {
    const start = record();
    const withIteration = appendGeneratedIteration(start.record, { preparedAssetId: start.preparedId, iterationId: "iter-1", output, provenance: provenance(start.assetId), now: 1400, receiptDigest });
    const asset = withIteration.assets.find((item) => item.id === start.assetId)!;
    assert.equal(asset.iterations.length, 1);
    assert.equal(asset.iterations[0].status, "NEEDS_REVIEW");
    assert.equal(asset.iterations[0].preparedAssetId, start.preparedId);
    assert.equal(asset.iterations[0].mediaSha256, output.mediaSha256);
    assert.equal("mediaBytes" in asset.iterations[0], false);

    const rejected = reviewGeneratedIteration(withIteration, { iterationId: "iter-1", decision: "reject", reviewer: "user", reason: "A/B comparison rejected this draft", now: 1500 });
    assert.equal(rejected.assets.find((item) => item.id === start.assetId)!.iterations[0].status, "REJECTED");
    assert.equal(rejected.assets.find((item) => item.id === start.assetId)!.rejectedIterationIds.includes("iter-1"), true);
  });

  it("blocks stale prepared dependencies and rejected canonical approval", () => {
    const start = record();
    const staleSpec = editInventoryAsset(start.record, start.assetId, { canonicalSpec: { visualDescription: "Changed after preparation" } }, 1350);
    assert.throws(() => appendGeneratedIteration(staleSpec, { preparedAssetId: start.preparedId, iterationId: "iter-stale", output, provenance: provenance(start.assetId), now: 1400, receiptDigest }), /stale|not approved/);

    const withIteration = appendGeneratedIteration(start.record, { preparedAssetId: start.preparedId, iterationId: "iter-1", output, provenance: provenance(start.assetId), now: 1400, receiptDigest });
    const rejected = reviewGeneratedIteration(withIteration, { iterationId: "iter-1", decision: "reject", reviewer: "user", reason: "Not the chosen A/B image", now: 1500 });
    assert.throws(() => approveCanonicalIteration(rejected, { iterationId: "iter-1", reviewer: "user", reason: "try anyway", canonicalProof: canonicalProof(start, "try anyway"), now: 1600 }), /Rejected/);
  });

  it("requires continuity confirmation and durable media proof for canonical approval", () => {
    const start = record();
    const withIteration = appendGeneratedIteration(start.record, { preparedAssetId: start.preparedId, iterationId: "iter-1", output, provenance: provenance(start.assetId), now: 1400, receiptDigest });
    assert.throws(() => reviewGeneratedIteration(withIteration, { iterationId: "iter-1", decision: "approve" as never, reviewer: "user", reason: "renderer direct approval", now: 1450 }), /Direct renderer approval/);
    assert.throws(() => approveCanonicalIteration(withIteration, { iterationId: "iter-1", reviewer: "user", reason: "", canonicalProof: canonicalProof(start, ""), now: 1500 }), /reason|Continuity|verification/);
    assert.throws(() => approveCanonicalIteration(withIteration, { iterationId: "iter-1", reviewer: "user", reason: "Visible match", canonicalProof: { ...canonicalProof(start, "Visible match"), preparedApprovalRootId: "wrong" }, now: 1500 }), /prepared approval root/);
    const approved = approveCanonicalIteration(withIteration, { iterationId: "iter-1", reviewer: "user", reason: "Visible wool coat and silver glasses match the approved locks.", canonicalProof: canonicalProof(start, "Visible wool coat and silver glasses match the approved locks."), now: 1500 });
    const asset = approved.assets.find((item) => item.id === start.assetId)!;
    assert.equal(asset.approvedIterationId, null);
    assert.equal(asset.iterations[0].status, "NEEDS_REVIEW");
    assert.equal(asset.iterations[0].canonicalProof?.decisionId, "canonical:0123456789abcdef0123456789abcdef");
    assert.equal(asset.iterations[0].reviewDecisions?.at(-1)?.decision, "confirm-continuity");
  });

  it("mirrors backend-confirmed continuity acknowledgements without changing receipt finding identity", () => {
    const start = record();
    const stored = [{ id: "continuity:receipt:test:locks", severity: "blocker" as const, message: "Confirm approved locks", confirmed: false }];
    const confirmed = [{ ...stored[0], confirmed: true }];
    const withIteration = appendGeneratedIteration(start.record, { preparedAssetId: start.preparedId, iterationId: "iter-1", output, provenance: provenance(start.assetId), continuityFindings: stored, now: 1400, receiptDigest });
    const reason = "Visible locks were reviewed and confirmed.";
    const approved = approveCanonicalIteration(withIteration, { iterationId: "iter-1", reviewer: "user", reason, canonicalProof: canonicalProof(start, reason, output, confirmed), continuityFindings: confirmed, now: 1500 });
    assert.equal(approved.assets.find((item) => item.id === start.assetId)!.iterations[0].receiptContinuityFindings?.[0].confirmed, true);
    const altered = [{ ...confirmed[0], message: "forged finding" }];
    assert.throws(() => approveCanonicalIteration(withIteration, { iterationId: "iter-1", reviewer: "user", reason, canonicalProof: canonicalProof(start, reason, output, altered), continuityFindings: altered, now: 1500 }), /findings do not match/);
  });

  it("validates PNG signature with a real SHA-256 digest and rejects trivial non-PNG output", () => {
    const bytes = makePngBytes(512, 512, 320);
    const parsed = validatePngSignature(bytes);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok ? parsed.sha256 : "", createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(validatePngSignature(new Uint8Array([1, 2, 3])), { ok: false, error: "PNG output is too small." });
  });

  it("rejects fabricated hashes that are not bound to the PNG and sidecar bytes", () => {
    const start = record();
    assert.throws(() => appendGeneratedIteration(start.record, {
      preparedAssetId: start.preparedId,
      iterationId: "iter-fake-media",
      output: { ...output, mediaSha256: "a".repeat(64) },
      provenance: provenance(start.assetId),
      now: 1400,
      receiptDigest,
    }), /does not match the PNG bytes/);
    assert.throws(() => appendGeneratedIteration(start.record, {
      preparedAssetId: start.preparedId,
      iterationId: "iter-fake-sidecar",
      output: { ...output, sidecarSha256: "b".repeat(64) },
      provenance: provenance(start.assetId),
      now: 1400,
      receiptDigest,
    }), /sidecar SHA-256 does not match/);
    const wrongSidecar = new TextEncoder().encode(JSON.stringify(provenance("asset:wrong")));
    assert.throws(() => appendGeneratedIteration(start.record, {
      preparedAssetId: start.preparedId,
      iterationId: "iter-wrong-sidecar",
      output: { ...output, sidecarBytes: wrongSidecar, sidecarSha256: realSha256(wrongSidecar) },
      provenance: provenance(start.assetId),
      now: 1400,
      receiptDigest,
    }), /sidecar does not match/);
  });
});

function makePngBytes(width: number, height: number, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  for (let i = 24; i < bytes.length; i++) bytes[i] = i % 251;
  return bytes;
}

function realSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
