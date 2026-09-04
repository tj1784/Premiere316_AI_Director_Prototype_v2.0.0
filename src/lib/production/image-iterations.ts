import { buildDependencyGraphV2, sourceFingerprint, type SourceFingerprint } from "./dependency-graph.ts";
import { buildDependencyGraph, calculateReadiness } from "./breakdown.ts";
import type { BackendCanonicalProof, GeneratedIteration, IterationContinuityFinding, IterationReviewDecision, PreparedAssetRecord, ProductionAsset, ProductionBreakdown } from "./types.ts";
import type { GenerationProvenance } from "../studio/generation-provenance.ts";

export type ValidatedImageOutput = {
  mediaUri: string;
  /** Real SHA-256 of the durable PNG bytes. */
  mediaSha256: string;
  /** Real SHA-256 of the serialized provenance sidecar bytes. */
  sidecarSha256: string;
  width: number;
  height: number;
  byteLength: number;
  /** Verification bytes are not persisted; they bind append approval to actual media evidence. */
  mediaBytes: Uint8Array;
  /** Verification bytes are not persisted; they bind sidecar hashes to actual sidecar evidence. */
  sidecarBytes: Uint8Array;
  receiptId?: string;
};

export type AppendGeneratedIterationInput = {
  preparedAssetId: string;
  iterationId: string;
  output: ValidatedImageOutput;
  provenance: GenerationProvenance;
  now?: number;
  continuityFindings?: IterationContinuityFinding[];
  receiptDigest?: string;
};

export type ReviewIterationInput = {
  iterationId: string;
  decision: "reject" | "confirm-continuity" | "needs-review";
  reviewer: "user" | "package-uat";
  reason: string;
  continuityFindings?: IterationContinuityFinding[];
  now?: number;
};

export type ApproveCanonicalIterationInput = {
  iterationId: string;
  reviewer: "user" | "package-uat";
  reason: string;
  canonicalProof: BackendCanonicalProof;
  /** Backend-confirmed acknowledgements used only to mirror the signed decision in local UI state. */
  continuityFindings?: IterationContinuityFinding[];
  now?: number;
};

export function appendGeneratedIteration(record: ProductionBreakdown, input: AppendGeneratedIterationInput): ProductionBreakdown {
  const now = input.now ?? Date.now();
  const prepared = requirePrepared(record, input.preparedAssetId);
  const asset = requireAsset(record, prepared.assetId);
  assertPreparedCurrent(record, asset, prepared);
  if (asset.iterations.some((iteration) => iteration.id === input.iterationId)) throw new Error("Generated iteration id already exists.");
  if (input.provenance.assetId !== asset.id) throw new Error("Generation provenance belongs to a different asset.");
  if (input.provenance.engineId !== input.provenance.runtimeAdapter) throw new Error("Generation provenance adapter identity is inconsistent.");
  const verified = assertValidOutput(input.output);
  assertSidecarMatchesProvenance(input.output.sidecarBytes, input.provenance);

  const iteration: GeneratedIteration = {
    id: input.iterationId,
    preparedAssetId: prepared.id,
    assetId: asset.id,
    variantId: prepared.variantId,
    specVersionId: prepared.specVersionId ?? "",
    mediaUri: input.output.mediaUri,
    mediaSha256: verified.mediaSha256,
    sidecarSha256: verified.sidecarSha256,
    width: verified.width,
    height: verified.height,
    byteLength: verified.byteLength,
    createdAt: now,
    status: "NEEDS_REVIEW",
    provenance: asset.provenance[0] ?? { sourceType: "user", screenplayVersionId: record.screenplayVersionId, sceneIds: [], createdAt: now },
    execution: input.provenance,
    dependencyFingerprints: cloneFingerprints(prepared.dependencyFingerprints),
    reviewDecisionIds: [],
    generationReceiptId: input.output.receiptId ?? null,
    generationReceiptDigest: input.receiptDigest ?? null,
    receiptContinuityFindings: input.continuityFindings ?? [],
  };

  return replaceAsset(record, asset.id, (current) => ({
    ...current,
    iterations: [...current.iterations, iteration],
    updatedAt: now,
  }), now);
}

export function reviewGeneratedIteration(record: ProductionBreakdown, input: ReviewIterationInput): ProductionBreakdown {
  const now = input.now ?? Date.now();
  const located = locateIteration(record, input.iterationId);
  if (!located) throw new Error("Generated iteration not found.");
  if (String(input.decision) === "approve") throw new Error("Direct renderer approval is not allowed; use backend canonical proof.");
  if (!input.reason.trim()) throw new Error("Review decision requires an explicit reason.");
  const continuityFindings = input.continuityFindings ?? deterministicContinuityFindings(located.asset, located.iteration);
  const decisionId = reviewDecisionId(input.iterationId, input.decision, now);
  const decision: IterationReviewDecision = {
    id: decisionId,
    iterationId: input.iterationId,
    at: now,
    decision: input.decision,
    reviewer: input.reviewer,
    reason: input.reason.trim(),
    continuityFindings,
    dependencyFingerprints: cloneFingerprints(located.iteration.dependencyFingerprints ?? []),
  };
  return replaceAsset(record, located.asset.id, (asset) => ({
    ...asset,
    rejectedIterationIds: input.decision === "reject" ? [...new Set([...asset.rejectedIterationIds, input.iterationId])] : asset.rejectedIterationIds,
    iterations: asset.iterations.map((iteration) => iteration.id === input.iterationId
      ? {
          ...iteration,
          status: input.decision === "reject" ? "REJECTED" : input.decision === "needs-review" ? "NEEDS_REVIEW" : iteration.status,
          reviewDecisionIds: [...(iteration.reviewDecisionIds ?? []), decision.id],
          reviewDecisions: [...(iteration.reviewDecisions ?? []), decision],
        }
      : iteration),
    updatedAt: now,
  }), now);
}

export function approveCanonicalIteration(record: ProductionBreakdown, input: ApproveCanonicalIterationInput): ProductionBreakdown {
  // UI-only display of a backend-signed decision. This browser helper never grants canonical authority.
  const now = input.now ?? Date.now();
  const located = locateIteration(record, input.iterationId);
  if (!located) throw new Error("Generated iteration not found.");
  const proof = input.canonicalProof;
  if (!proof || typeof proof !== "object") throw new Error("Canonical approval requires a structured backend canonical proof.");
  if (proof.iterationId !== input.iterationId || proof.assetId !== located.asset.id || proof.preparedAssetId !== (located.iteration.preparedAssetId ?? "") || proof.receiptId !== (located.iteration.generationReceiptId ?? "") || proof.authorityId !== record.productionAuthority?.authorityId) throw new Error("Canonical approval proof is not bound to this iteration authority.");
  for (const value of [proof.decisionId, proof.signedRecordMac, proof.generationReceiptDigest, proof.preparedApprovalRootId, proof.preparedApprovalDigest, proof.preparedSealDigest, proof.reasonDigest, proof.continuityDigest, proof.outputDigest]) {
    if (typeof value !== "string" || !value.trim()) throw new Error("Canonical approval proof is incomplete.");
  }
  if (!/^canonical:[a-f0-9]{32}$/.test(proof.decisionId)) throw new Error("Canonical approval proof decision id is invalid.");
  if (!/^[a-f0-9]{64}$/.test(proof.signedRecordMac)) throw new Error("Canonical approval proof signed MAC is invalid.");
  const prepared = requirePrepared(record, located.iteration.preparedAssetId ?? "");
  assertPreparedCurrent(record, located.asset, prepared);
  assertStoredOutputProof(located.iteration);
  if (prepared.preparedApprovalRootId !== proof.preparedApprovalRootId || prepared.preparedApprovalDigest !== proof.preparedApprovalDigest || prepared.productionAuthorityId !== proof.authorityId) throw new Error("Canonical approval proof is not bound to the prepared approval root.");
  if (located.asset.rejectedIterationIds.includes(input.iterationId) || located.iteration.status === "REJECTED") throw new Error("Rejected iterations cannot be canonically approved.");
  if (!input.reason.trim()) throw new Error("Canonical approval requires an explicit continuity reason.");
  const storedContinuityFindings = located.iteration.receiptContinuityFindings ?? [];
  const continuityFindings = input.continuityFindings ?? storedContinuityFindings;
  const findingShape = (items: IterationContinuityFinding[]) => items.map(({ id, severity, message }) => ({ id, severity, message }));
  if (canonicalDigest("p316.canonical.finding-shape.v1", findingShape(continuityFindings)) !== canonicalDigest("p316.canonical.finding-shape.v1", findingShape(storedContinuityFindings))) throw new Error("Canonical approval findings do not match the stored receipt findings.");
  const outputDigest = canonicalDigest("p316.canonical.output.v1", { mediaUri: located.iteration.mediaUri, mediaSha256: located.iteration.mediaSha256, sidecarSha256: located.iteration.sidecarSha256, width: located.iteration.width, height: located.iteration.height, byteLength: located.iteration.byteLength });
  if (proof.outputDigest !== outputDigest) throw new Error("Canonical approval proof output digest does not match the stored iteration.");
  if (proof.reasonDigest !== canonicalDigest("p316.canonical.reason.v1", { reason: input.reason.trim() })) throw new Error("Canonical approval proof reason digest does not match the review reason.");
  if (proof.continuityDigest !== canonicalDigest("p316.canonical.continuity.v1", continuityFindings)) throw new Error("Canonical approval proof continuity digest does not match the receipt findings.");
  if (located.iteration.generationReceiptDigest !== proof.generationReceiptDigest) throw new Error("Canonical approval proof receipt digest does not match the stored backend receipt.");
  const decision: IterationReviewDecision = { id: proof.decisionId, iterationId: input.iterationId, at: now, decision: "confirm-continuity", reviewer: input.reviewer, reason: input.reason.trim(), continuityFindings, dependencyFingerprints: cloneFingerprints(located.iteration.dependencyFingerprints ?? []), canonicalProof: proof };
  return replaceAsset(record, located.asset.id, (asset) => ({
    ...asset,
    approvedIterationId: asset.approvedIterationId,
    iterations: asset.iterations.map((iteration) => iteration.id === input.iterationId ? { ...iteration, receiptContinuityFindings: continuityFindings, canonicalProof: proof, reviewDecisionIds: [...(iteration.reviewDecisionIds ?? []), decision.id], reviewDecisions: [...(iteration.reviewDecisions ?? []), decision] } : iteration),
    updatedAt: now,
  }), now);
}

export function deterministicContinuityFindings(asset: ProductionAsset, iteration: GeneratedIteration): IterationContinuityFinding[] {
  const findings: IterationContinuityFinding[] = [];
  const locks = [...asset.canonicalSpec.continuityLocks, ...asset.canonicalSpec.distinguishingFeatures].map((value) => value.trim()).filter(Boolean);
  if (!locks.length) {
    findings.push({ id: `continuity:${iteration.id}:locks`, severity: "warning", message: "No approved identity locks are available; reviewer must confirm visible continuity manually.", confirmed: false });
  }
  if (asset.referenceRequired && !asset.references.length) {
    findings.push({ id: `continuity:${iteration.id}:reference`, severity: "blocker", message: "Required reference is missing for this asset.", confirmed: false });
  }
  if (!iteration.execution) {
    findings.push({ id: `continuity:${iteration.id}:provenance`, severity: "blocker", message: "No native execution provenance is attached.", confirmed: false });
  }
  return findings;
}

export function validatePngSignature(bytes: Uint8Array): { ok: true; width: number; height: number; sha256: string; byteLength: number } | { ok: false; error: string } {
  if (bytes.byteLength < 33) return { ok: false, error: "PNG output is too small." };
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((value, index) => bytes[index] === value)) return { ok: false, error: "Output is not a PNG file." };
  const type = String.fromCharCode(...bytes.slice(12, 16));
  if (type !== "IHDR") return { ok: false, error: "PNG IHDR chunk is missing." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 16 || height < 16) return { ok: false, error: "PNG dimensions are invalid." };
  const sha256 = sha256Hex(bytes);
  return { ok: true, width, height, sha256, byteLength: bytes.byteLength };
}

function assertValidOutput(output: ValidatedImageOutput): Pick<ValidatedImageOutput, "mediaUri" | "mediaSha256" | "sidecarSha256" | "width" | "height" | "byteLength"> {
  if (!/^media:\/\/stills\/[a-zA-Z0-9._-]+\.png$/.test(output.mediaUri) || /%|:.*:|\.\./.test(output.mediaUri.replace("media://stills/", ""))) throw new Error("Generated media must use durable media://stills storage.");
  const media = validatePngSignature(output.mediaBytes);
  if (!media.ok) throw new Error(media.error);
  const sidecarSha256 = sha256Hex(output.sidecarBytes);
  if (output.mediaSha256 !== media.sha256) throw new Error("Generated media SHA-256 does not match the PNG bytes.");
  if (output.sidecarSha256 !== sidecarSha256) throw new Error("Generation provenance sidecar SHA-256 does not match the sidecar bytes.");
  if (output.width !== media.width || output.height !== media.height || output.byteLength !== media.byteLength) throw new Error("Generated media dimensions or byte length do not match the PNG bytes.");
  if (media.width < 16 || media.height < 16 || media.byteLength < 256) throw new Error("Generated media output is invalid or trivial.");
  return { mediaUri: output.mediaUri, mediaSha256: media.sha256, sidecarSha256, width: media.width, height: media.height, byteLength: media.byteLength };
}

function assertStoredOutputProof(iteration: GeneratedIteration): void {
  if (!/^media:\/\/stills\/[a-zA-Z0-9._-]+\.png$/.test(iteration.mediaUri) || /%|:.*:|\.\./.test(iteration.mediaUri.replace("media://stills/", ""))) throw new Error("Generated media must use durable media://stills storage.");
  if (!/^[a-f0-9]{64}$/.test(iteration.mediaSha256 ?? "")) throw new Error("Generated media SHA-256 is missing or invalid.");
  if (!/^[a-f0-9]{64}$/.test(iteration.sidecarSha256 ?? "")) throw new Error("Generation provenance sidecar SHA-256 is missing or invalid.");
  if ((iteration.width ?? 0) < 16 || (iteration.height ?? 0) < 16 || (iteration.byteLength ?? 0) < 256) throw new Error("Generated media output is invalid or trivial.");
}

function assertSidecarMatchesProvenance(sidecarBytes: Uint8Array, provenance: GenerationProvenance): void {
  let parsed: Partial<GenerationProvenance>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(sidecarBytes)) as Partial<GenerationProvenance>;
  } catch {
    throw new Error("Generation provenance sidecar is not valid JSON.");
  }
  if (parsed.schemaVersion !== provenance.schemaVersion || parsed.assetId !== provenance.assetId || parsed.engineId !== provenance.engineId || parsed.runtimeAdapter !== provenance.runtimeAdapter || parsed.prompt !== provenance.prompt) {
    throw new Error("Generation provenance sidecar does not match the execution provenance.");
  }
  if (parsed.baseCheckpoint?.id !== provenance.baseCheckpoint.id || parsed.baseCheckpoint?.fingerprint !== provenance.baseCheckpoint.fingerprint) {
    throw new Error("Generation provenance sidecar does not match the checkpoint identity.");
  }
}

function requirePrepared(record: ProductionBreakdown, preparedAssetId: string): PreparedAssetRecord {
  const prepared = (record.preparedAssets ?? []).find((item) => item.id === preparedAssetId);
  if (!prepared) throw new Error("Prepared asset record not found.");
  if (prepared.status !== "APPROVED_PREPARED") throw new Error("Prepared asset is not approved for generation.");
  if (!prepared.preparedApprovalRootId || !prepared.preparedApprovalDigest || !prepared.approvedAt) throw new Error("Prepared asset is missing backend approval root.");
  return prepared;
}

function requireAsset(record: ProductionBreakdown, assetId: string): ProductionAsset {
  const asset = record.assets.find((item) => item.id === assetId && !item.tombstone);
  if (!asset) throw new Error("Production asset not found.");
  return asset;
}

function assertPreparedCurrent(record: ProductionBreakdown, asset: ProductionAsset, prepared: PreparedAssetRecord): void {
  if (prepared.assetId !== asset.id) throw new Error("Prepared asset points at a different asset.");
  if ((asset.approvedSpecVersionId ?? null) !== (prepared.specVersionId ?? null)) throw new Error("Prepared asset spec version is stale.");
  const approvedSpec = (asset.specVersions ?? []).find((version) => version.id === prepared.specVersionId);
  const expected = [
    sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId: prepared.specVersionId, content: asset.canonicalSpec, approvedAt: approvedSpec?.createdAt ?? asset.updatedAt, immutableBoundary: Boolean(prepared.specVersionId) }),
    ...asset.references.filter((reference) => (prepared.referenceIds ?? []).includes(reference.id)).map((reference) => sourceFingerprint({ sourceKind: "asset", sourceId: reference.id, versionId: record.screenplayVersionId ?? null, content: reference, approvedAt: null, immutableBoundary: false })),
    ...(prepared.visualBibleVersionIds ?? []).map((id) => sourceFingerprint({ sourceKind: "visual-development", sourceId: id, versionId: id, content: id, approvedAt: null, immutableBoundary: true })),
    ...(prepared.cinematographyPlanIds ?? []).map((id) => sourceFingerprint({ sourceKind: "cinematography", sourceId: id, versionId: id, content: id, approvedAt: null, immutableBoundary: true })),
  ];
  if (!sameFingerprints(expected, prepared.dependencyFingerprints)) throw new Error("Prepared asset dependency fingerprints are stale.");
  if (record.graph?.stale?.some((node) => node.recordId === prepared.id || node.recordId === asset.id)) throw new Error("Prepared asset dependency graph is stale.");
}

function sameFingerprints(left: SourceFingerprint[], right: SourceFingerprint[]): boolean {
  return JSON.stringify(left.map(fingerprintKey).sort()) === JSON.stringify(right.map(fingerprintKey).sort());
}

function fingerprintKey(item: SourceFingerprint): string {
  return `${item.sourceKind}:${item.sourceId}:${item.versionId ?? ""}:${item.hash}`;
}

function cloneFingerprints(items: SourceFingerprint[]): SourceFingerprint[] {
  return items.map((item) => ({ ...item }));
}

function locateIteration(record: ProductionBreakdown, iterationId: string): { asset: ProductionAsset; iteration: GeneratedIteration } | null {
  for (const asset of record.assets) {
    const iteration = asset.iterations.find((item) => item.id === iterationId);
    if (iteration) return { asset, iteration };
  }
  return null;
}

function replaceAsset(record: ProductionBreakdown, assetId: string, fn: (asset: ProductionAsset) => ProductionAsset, now: number): ProductionBreakdown {
  const assets = record.assets.map((asset) => asset.id === assetId ? withReadiness(fn(asset)) : asset);
  const next = { ...record, assets, inventoryVersion: (record.inventoryVersion ?? 1) + 1, updatedAt: now };
  return { ...next, dependencies: buildDependencyEdges(next), graph: buildDependencyGraphV2(next, now) };
}

function withReadiness(asset: ProductionAsset): ProductionAsset {
  return { ...asset, readiness: calculateReadiness(asset) };
}

function buildDependencyEdges(record: ProductionBreakdown) {
  return buildDependencyGraph(record);
}

function reviewDecisionId(iterationId: string, decision: string, now: number): string {
  return `review:${iterationId}:${decision}:${now}`;
}

function canonicalDigest(domain: string, payload: unknown): string {
  return sha256Hex(new TextEncoder().encode(stableString({ domain, schemaVersion: 1, payload })));
}

function stableString(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    return item;
  });
}

function sha256Hex(bytes: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < data.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}
