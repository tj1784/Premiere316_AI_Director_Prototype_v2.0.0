/**
 * Local backend process. Owns privileged runtime dispatch and image manifests.
 * Talks JSON-lines over stdin/stdout. Renderer never imports this file.
 */
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCatalog } from "../src/lib/studio/model-scan.server.ts";
import { exposeLocalStill, setLocalStillMediaRoot, stopLocalEngine, verifyLocalStillOutput } from "../src/lib/studio/local-still.server.ts";
import { resolveImageComponentManifest, resolveImageComponentManifests } from "../src/lib/studio/image-component-resolver.server.ts";
import { MODEL_ROOT, sanitizeModelCatalog } from "../src/lib/studio/model-catalog.ts";
import { sourceFingerprint } from "../src/lib/production/dependency-graph.ts";
import { createInterface } from "node:readline";

const ALLOWED = new Set([
  "catalog.get",
  "image.manifests",
  "image.proposeProductionAuthority",
  "image.confirmProductionAuthority",
  "image.authorityStatus",
  "image.proposePreparedApproval",
  "image.confirmPreparedApproval",
  "image.proposePrepared",
  "image.confirmPrepared",
  "image.proposeCanonicalApproval",
  "image.proposeCanonicalRejection",
  "image.confirmCanonicalRejection",
  "image.generatePrepared",
  "image.confirmCanonicalApproval",
  "engines.stop",
  "app.modelRoot",
]);
const TOKEN_TTL_MS = 5 * 60_000;
const MAX_PROMPT = 4000;
const MAX_REF_COUNT = 3;
const pendingAuthorityProposals = new Map();
const pendingApprovalProposals = new Map();
const pendingCanonicalProposals = new Map();
const pendingCanonicalRejectionProposals = new Map();
const pendingProposals = new Map();
const pendingPrepared = new Map();
const receipts = new Map();
const productionAuthorities = new Map();
const currentAuthorityByPicture = new Map();
const preparedApprovals = new Map();
const preparedSeals = new Map();
const ledgerIds = new Set();
const canonicalReceiptIds = new Set();
const rejectedReceiptIds = new Set();
const canonicalHistoryByReceipt = new Map();
let receiptMediaRoot = join(process.cwd(), "media");
const ledgerMacKey = Buffer.from(process.env.P316_LEDGER_HMAC_KEY ?? "", "hex");
if (ledgerMacKey.byteLength < 32) {
  throw new Error("Missing Premiere316 backend ledger HMAC key.");
}

function mediaSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(["qualityPreset", "aspectRatio", "width", "height", "steps", "guidance", "seed", "randomizeSeed", "lockSeed", "scheduler", "shift", "precision", "outputFormat", "outputBitDepth"]);
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => allowed.has(key) && ["string", "number", "boolean"].includes(typeof item)));
}

function setReceiptMediaRoot(root) {
  if (root && typeof root === "string") receiptMediaRoot = root;
}

function receiptLedgerPath() {
  return join(receiptMediaRoot, "stills", "security-ledger.v1.jsonl");
}

function ledgerTailPath() {
  return `${receiptLedgerPath()}.tail.json`;
}

function macPayload(payload) {
  return createHmac("sha256", ledgerMacKey).update(stableString(payload)).digest("hex");
}

function timingSafeHexEqual(leftHex, rightHex) {
  const left = Buffer.from(String(leftHex), "hex");
  const right = Buffer.from(String(rightHex), "hex");
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function signedLedgerRecord(kind, id, payload, previous = null) {
  const seq = previous ? previous.seq + 1 : 1;
  const prevMac = previous?.mac ?? null;
  const at = Date.now();
  const macEnvelope = { schemaVersion: 2, seq, prevMac, kind, id, at, payload };
  return { ...macEnvelope, mac: macPayload(macEnvelope) };
}

function validateSignedRecord(entry, previous = null) {
  if (!entry || typeof entry !== "object" || entry.schemaVersion !== 2 || !Number.isInteger(entry.seq) || !entry.kind || !entry.id || !entry.payload || !/^[a-f0-9]{64}$/.test(String(entry.mac ?? ""))) {
    throw new Error("Prepared security ledger contains a malformed record.");
  }
  const expectedSeq = previous ? previous.seq + 1 : 1;
  const expectedPrevMac = previous?.mac ?? null;
  if (entry.seq !== expectedSeq || (entry.prevMac ?? null) !== expectedPrevMac) throw new Error("Prepared security ledger chain order verification failed.");
  const expected = macPayload({ schemaVersion: entry.schemaVersion, seq: entry.seq, prevMac: entry.prevMac ?? null, kind: entry.kind, id: entry.id, at: entry.at, payload: entry.payload });
  if (!timingSafeHexEqual(entry.mac, expected)) throw new Error("Prepared security ledger MAC verification failed.");
  return entry;
}

function signedTailCheckpoint(tail) {
  const checkpoint = { schemaVersion: 1, count: tail?.seq ?? 0, headMac: tail?.mac ?? null, ledgerPath: receiptLedgerPath() };
  return { ...checkpoint, mac: macPayload(checkpoint) };
}

function validateTailCheckpoint(tail) {
  const file = ledgerTailPath();
  if (!existsSync(file)) {
    if (tail) throw new Error("Prepared security ledger tail checkpoint is missing.");
    return;
  }
  const checkpoint = JSON.parse(readFileSync(file, "utf8"));
  const expected = signedTailCheckpoint(tail);
  if (checkpoint.schemaVersion !== expected.schemaVersion || checkpoint.count !== expected.count || checkpoint.headMac !== expected.headMac || checkpoint.ledgerPath !== expected.ledgerPath || !timingSafeHexEqual(checkpoint.mac, expected.mac)) {
    throw new Error("Prepared security ledger tail checkpoint verification failed.");
  }
}

function loadLedger() {
  const file = receiptLedgerPath();
  ledgerIds.clear();
  receipts.clear();
  productionAuthorities.clear();
  currentAuthorityByPicture.clear();
  preparedApprovals.clear();
  preparedSeals.clear();
  canonicalReceiptIds.clear();
  rejectedReceiptIds.clear();
  canonicalHistoryByReceipt.clear();
  if (!existsSync(file)) { validateTailCheckpoint(null); return []; }
  const seen = new Set();
  const entries = [];
  let previous = null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
    const entry = validateSignedRecord(JSON.parse(line), previous);
    if (seen.has(entry.id)) throw new Error("Prepared security ledger contains a duplicate record id.");
    seen.add(entry.id);
    entries.push(entry);
    previous = entry;
  }
  validateTailCheckpoint(previous);
  for (const entry of entries) {
    ledgerIds.add(entry.id);
    if (entry.kind === "productionAuthority") {
      const payload = entry.payload ?? {};
      productionAuthorities.set(entry.id, payload);
      currentAuthorityByPicture.set(payload.pictureId, entry.id);
    }
    if (entry.kind === "preparedApproval") preparedApprovals.set(entry.id, entry.payload);
    if (entry.kind === "preparedSeal") preparedSeals.set(entry.id, entry.payload);
    if (entry.kind === "generationReceipt") receipts.set(entry.id, entry.payload);
    if (entry.kind === "canonicalDecision") { canonicalReceiptIds.add(entry.payload?.receiptId); canonicalHistoryByReceipt.set(entry.payload?.receiptId, [...(canonicalHistoryByReceipt.get(entry.payload?.receiptId) ?? []), { kind: entry.kind, id: entry.id, payload: entry.payload }]); }
    if (entry.kind === "rejectionDecision") { rejectedReceiptIds.add(entry.payload?.receiptId); canonicalHistoryByReceipt.set(entry.payload?.receiptId, [...(canonicalHistoryByReceipt.get(entry.payload?.receiptId) ?? []), { kind: entry.kind, id: entry.id, payload: entry.payload }]); }
  }
  return entries;
}

function appendLedger(kind, id, payload) {
  const entries = loadLedger();
  if (ledgerIds.has(id)) throw new Error("Prepared security ledger duplicate id rejected.");
  if (kind === "canonicalDecision" && canonicalReceiptIds.has(payload?.receiptId)) throw new Error("Generation receipt already has a canonical decision.");
  if (kind === "canonicalDecision" && rejectedReceiptIds.has(payload?.receiptId)) throw new Error("Generation receipt has a signed rejection decision and cannot be canonically approved.");
  if (kind === "rejectionDecision" && canonicalReceiptIds.has(payload?.receiptId)) throw new Error("Generation receipt already has a canonical decision.");
  const file = receiptLedgerPath();
  mkdirSync(dirname(file), { recursive: true });
  const record = signedLedgerRecord(kind, id, payload, entries.at(-1) ?? null);
  atomicRewriteText(file, [...entries.map((entry) => JSON.stringify(entry)), JSON.stringify(record)].join("\n") + "\n");
  atomicRewriteText(ledgerTailPath(), JSON.stringify(signedTailCheckpoint(record)) + "\n");
  ledgerIds.add(id);
  if (kind === "productionAuthority") { productionAuthorities.set(id, payload); currentAuthorityByPicture.set(payload.pictureId, id); }
  if (kind === "preparedApproval") preparedApprovals.set(id, payload);
  if (kind === "preparedSeal") preparedSeals.set(id, payload);
  if (kind === "generationReceipt") receipts.set(id, payload);
  if (kind === "canonicalDecision") { canonicalReceiptIds.add(payload?.receiptId); canonicalHistoryByReceipt.set(payload?.receiptId, [...(canonicalHistoryByReceipt.get(payload?.receiptId) ?? []), { kind, id, payload }]); }
  if (kind === "rejectionDecision") { rejectedReceiptIds.add(payload?.receiptId); canonicalHistoryByReceipt.set(payload?.receiptId, [...(canonicalHistoryByReceipt.get(payload?.receiptId) ?? []), { kind, id, payload }]); }
  return record;
}

function atomicRewriteText(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${Date.now()}-${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  try {
    const dirFd = openSync(dirname(file), "r");
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function loadReceipt(receiptId) {
  if (receipts.has(receiptId)) return receipts.get(receiptId);
  loadLedger();
  return receipts.get(receiptId) ?? null;
}

function sanitizeCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") return catalog;
  return sanitizeModelCatalog(catalog);
}

function boundedId(value, label, pattern = /^[a-zA-Z0-9:._-]{1,220}$/) {
  const text = String(value ?? "");
  if (!pattern.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function stableString(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

function digest(value) {
  return createHash("sha256").update(stableString(value)).digest("hex");
}

function domainDigest(domain, payload) {
  return digest({ domain, schemaVersion: 1, payload });
}

function stableManifestDigest(manifest) {
  return digest({
    schemaVersion: manifest?.schemaVersion,
    adapterId: manifest?.adapterId,
    modelVariant: manifest?.modelVariant,
    status: manifest?.status,
    disabledReason: manifest?.disabledReason,
    runtimeImplementation: manifest?.runtimeImplementation,
    components: (manifest?.components ?? []).map((component) => ({ role: component.role, stableId: component.stableId, opaqueId: component.opaqueId, sizeBytes: component.sizeBytes, fingerprint: component.fingerprint, fingerprintKind: component.fingerprintKind, required: component.required, present: component.present })).sort((a, b) => `${a.role}:${a.stableId}`.localeCompare(`${b.role}:${b.stableId}`)),
    placementPlan: manifest?.placementPlan,
    controls: manifest?.controls,
    licenseNote: manifest?.licenseNote,
  });
}

function expectedPreparedFingerprints(production, asset, prepared) {
  const approvedSpec = Array.isArray(asset.specVersions) ? asset.specVersions.find((version) => version?.id === prepared.specVersionId) : null;
  const references = Array.isArray(asset.references) ? asset.references.filter((reference) => (prepared.referenceIds ?? []).includes(reference.id)).map((reference) => sourceFingerprint({ sourceKind: "asset", sourceId: reference.id, versionId: production.screenplayVersionId ?? null, content: reference, approvedAt: null, immutableBoundary: false })) : [];
  const visual = (prepared.visualBibleVersionIds ?? []).map((id) => sourceFingerprint({ sourceKind: "visual-development", sourceId: id, versionId: id, content: id, approvedAt: null, immutableBoundary: true }));
  const cinematography = (prepared.cinematographyPlanIds ?? []).map((id) => sourceFingerprint({ sourceKind: "cinematography", sourceId: id, versionId: id, content: id, approvedAt: null, immutableBoundary: true }));
  return [
    sourceFingerprint({ sourceKind: "asset", sourceId: asset.id, versionId: prepared.specVersionId ?? null, content: asset.canonicalSpec, approvedAt: approvedSpec?.createdAt ?? asset.updatedAt ?? null, immutableBoundary: Boolean(prepared.specVersionId) }),
    ...references,
    ...visual,
    ...cinematography,
  ];
}

function sameFingerprints(left, right) {
  return stableString((left ?? []).map((item) => `${item.sourceKind}:${item.sourceId}:${item.versionId ?? ""}:${item.hash}`).sort()) ===
    stableString((right ?? []).map((item) => `${item.sourceKind}:${item.sourceId}:${item.versionId ?? ""}:${item.hash}`).sort());
}

function preparedPrompt(prepared, asset) {
  const ingredients = Array.isArray(prepared.promptIngredients) ? prepared.promptIngredients.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
  const prompt = (ingredients.join(". ") || asset?.canonicalSpec?.visualDescription || asset?.name || "").trim().slice(0, MAX_PROMPT);
  if (!prompt) throw new Error("Approved prepared asset has no prompt ingredients.");
  return prompt;
}

function productionAuthorityProjection(raw, pictureId) {
  if (!raw || typeof raw !== "object") throw new Error("Production authority seal requires bounded canonical production data.");
  if (String(raw.pictureId ?? "") !== pictureId) throw new Error("Production authority candidate belongs to a different picture.");
  const sourceBoundary = raw.sourceBoundary ?? null;
  const screenplayVersionId = boundedId(raw.screenplayVersionId, "Screenplay version id");
  const rawAssets = (Array.isArray(raw.assets) ? raw.assets : []).filter((asset) => asset && typeof asset === "object" && !asset.tombstone);
  if (rawAssets.length > 256) throw new Error("Production authority proposal is too large to review safely.");
  const assets = rawAssets.map((asset) => {
    const rawReferences = Array.isArray(asset.references) ? asset.references : [];
    if (rawReferences.length > 16) throw new Error("Production authority proposal has too many references to review safely.");
    return {
    id: boundedId(asset.id, "Asset id"),
    name: String(asset.name ?? "").slice(0, 220),
    category: String(asset.category ?? "other"),
    approvedSpecVersionId: asset.approvedSpecVersionId ?? null,
    canonicalSpec: asset.canonicalSpec ?? {},
    specVersions: (Array.isArray(asset.specVersions) ? asset.specVersions : []).map((version) => ({ id: boundedId(version?.id, "Spec version id"), createdAt: Number(version?.createdAt ?? 0), approvedAt: version?.approvedAt ?? null, sourceVersionId: version?.sourceVersionId ?? null, specDigest: domainDigest("p316.assetSpec.version.v1", version?.spec ?? null), spec: version?.spec ?? null })),
    references: rawReferences.map((reference) => ({ id: boundedId(reference.id, "Reference id"), name: String(reference.name ?? "").slice(0, 220), uri: String(reference.uri ?? "").slice(0, 2000), mediaType: String(reference.mediaType ?? "").slice(0, 100), preferred: Boolean(reference.preferred), uploadedAt: Number(reference.uploadedAt ?? 0), digest: domainDigest("p316.reference.v1", reference) })),
    referenceRequired: Boolean(asset.referenceRequired),
    updatedAt: Number(asset.updatedAt ?? 0),
  };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (!assets.length) throw new Error("Production authority requires at least one active asset.");
  const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
  const preparedCandidates = (Array.isArray(raw.preparedAssets) ? raw.preparedAssets : []).slice(0, 256).map((prepared) => {
    const id = boundedId(prepared?.id, "Prepared asset id", /^prepared:[a-zA-Z0-9:._-]{1,220}$/);
    const asset = byAsset.get(String(prepared?.assetId ?? ""));
    const blockers = [];
    if (!asset) blockers.push("Production asset not found.");
    const specVersionId = prepared?.specVersionId ?? null;
    if (asset && (asset.approvedSpecVersionId ?? null) !== specVersionId) blockers.push("Prepared asset spec version is stale.");
    const referenceIds = (Array.isArray(prepared?.referenceIds) ? prepared.referenceIds : []).map((id) => String(id)).filter(Boolean).sort();
    const visualBibleVersionIds = (Array.isArray(prepared?.visualBibleVersionIds) ? prepared.visualBibleVersionIds : []).map((id) => String(id)).filter(Boolean).sort();
    const cinematographyPlanIds = (Array.isArray(prepared?.cinematographyPlanIds) ? prepared.cinematographyPlanIds : []).map((id) => String(id)).filter(Boolean).sort();
    const normalized = { id, assetId: asset?.id ?? String(prepared?.assetId ?? ""), variantId: prepared?.variantId ?? null, specVersionId, visualBibleVersionIds, cinematographyPlanIds, blockers, promptIngredients: (Array.isArray(prepared?.promptIngredients) ? prepared.promptIngredients : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 24), negativeRequirements: (Array.isArray(prepared?.negativeRequirements) ? prepared.negativeRequirements : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 24), referenceIds, noGeneration: true };
    const dependencyFingerprints = asset ? expectedPreparedFingerprints({ screenplayVersionId, sourceBoundary }, asset, normalized) : [];
    const prompt = asset ? preparedPrompt({ ...normalized, dependencyFingerprints }, asset) : "";
    return { ...normalized, status: blockers.length ? "BLOCKED" : "READY_TO_PREPARE", dependencyFingerprints, prompt, promptDigest: domainDigest("p316.prepared.prompt.v1", { prompt }), assetSpecDigest: domainDigest("p316.assetSpec.v1", asset?.canonicalSpec ?? null), referencesDigest: domainDigest("p316.references.v1", asset?.references ?? []), dependencyFingerprintsDigest: domainDigest("p316.dependencies.v1", dependencyFingerprints) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (preparedCandidates.length > 256) throw new Error("Production authority proposal has too many prepared candidates to review safely.");
  const projection = { schemaVersion: 1, pictureId, screenplayVersionId, sourceBoundary, sourceBoundaryDigest: domainDigest("p316.sourceBoundary.v1", { screenplayVersionId, sourceBoundary }), visualRoots: [...new Set(preparedCandidates.flatMap((item) => item.visualBibleVersionIds ?? []))].sort(), cinematographyRoots: [...new Set(preparedCandidates.flatMap((item) => item.cinematographyPlanIds ?? []))].sort(), assets, preparedCandidates };
  const projectionDigest = domainDigest("p316.productionAuthority.projection.v1", projection);
  const review = { label: "Untrusted project proposal normalized by the backend; sealing grants only this exact bounded authority.", projectionDigest, sealedFields: { pictureBoundary: { pictureId, screenplayVersionId, sourceBoundary, sourceBoundaryDigest: projection.sourceBoundaryDigest }, activeAssets: assets.map((asset) => ({ id: asset.id, name: asset.name, category: asset.category, approvedSpecVersionId: asset.approvedSpecVersionId, canonicalSpec: asset.canonicalSpec, canonicalSpecJson: stableString(asset.canonicalSpec), canonicalSpecDigest: domainDigest("p316.assetSpec.v1", asset.canonicalSpec), specVersions: asset.specVersions, references: asset.references, referenceRequired: asset.referenceRequired })), visualRoots: projection.visualRoots, cinematographyRoots: projection.cinematographyRoots, preparedCandidates: preparedCandidates.map((prepared) => ({ id: prepared.id, assetId: prepared.assetId, status: prepared.status, blockers: prepared.blockers, specVersionId: prepared.specVersionId, prompt: prepared.prompt, promptDigest: prepared.promptDigest, promptIngredients: prepared.promptIngredients, negativeRequirements: prepared.negativeRequirements, referenceIds: prepared.referenceIds, dependencyFingerprints: prepared.dependencyFingerprints, dependencyFingerprintsDigest: prepared.dependencyFingerprintsDigest, assetSpecDigest: prepared.assetSpecDigest, referencesDigest: prepared.referencesDigest, visualBibleVersionIds: prepared.visualBibleVersionIds, cinematographyPlanIds: prepared.cinematographyPlanIds })) }, canonicalProjection: projection };
  const reviewDocument = `${stableString(review)}\n`;
  return { projection, projectionDigest, reviewDocument };
}

function productionAuthorityStatus(params) {
  const pictureId = boundedId(params?.pictureId, "Picture id");
  loadLedger();
  const authorityId = currentAuthorityByPicture.get(pictureId) ?? null;
  const authority = authorityId ? productionAuthorities.get(authorityId) : null;
  if (!authority) return { ok: true, status: "NO_AUTHORITY", authorityId: null, digest: null, createdAt: null, summary: null, preparedApprovals: [], canonicalHistory: [] };
  const currentDigest = domainDigest("p316.productionAuthority.projection.v1", authority.boundedProjection);
  if (currentDigest !== authority.projectionDigest || authority.pictureId !== pictureId) return { ok: true, status: "INVALID", authorityId: null, digest: null, createdAt: null, summary: null, preparedApprovals: [], canonicalHistory: [] };
  const preparedApprovalsStatus = Array.from(preparedApprovals.entries())
    .filter(([, approval]) => approval?.pictureId === pictureId && approval?.authorityId === authorityId && approval?.authorityDigest === authority.projectionDigest)
    .slice(-128)
    .map(([rootId, approval]) => ({ rootId, digest: approval.approvalDigest, preparedAssetId: approval.preparedAssetId, assetId: approval.assetId, authorityId: approval.authorityId, authorityDigest: approval.authorityDigest, approvedAt: approval.approvedAt }));
  const canonicalHistory = Array.from(canonicalHistoryByReceipt.values()).flat()
    .filter((entry) => {
      const payload = entry?.payload ?? {};
      const receipt = receipts.get(payload.receiptId);
      return receipt?.pictureId === pictureId && payload.authorityId === authorityId && receipt.authorityId === authorityId && receipt.authorityDigest === authority.projectionDigest;
    })
    .slice(-128)
    .map((entry) => ({ kind: entry.kind, id: entry.id, decisionId: entry.payload?.decisionId, receiptId: entry.payload?.receiptId, assetId: entry.payload?.assetId, preparedAssetId: entry.payload?.preparedAssetId, iterationId: entry.payload?.iterationId, authorityId: entry.payload?.authorityId, reasonDigest: entry.payload?.reasonDigest, outputDigest: entry.payload?.outputDigest }));
  return { ok: true, status: "CURRENT", authorityId, digest: authority.projectionDigest, createdAt: authority.sealedAt ?? null, summary: authority.summary ?? null, preparedApprovals: preparedApprovalsStatus, canonicalHistory };
}

function proposeProductionAuthority(params) {
  try {
    const pictureId = boundedId(params?.pictureId, "Picture id");
    const { projection, projectionDigest, reviewDocument } = productionAuthorityProjection(params?.rawCanonical ?? params?.production, pictureId);
    const proposalId = `authorityProposal:${randomBytes(16).toString("hex")}`;
    const summary = { pictureId, screenplayVersionId: projection.screenplayVersionId, assetCount: projection.assets.length, preparedCount: projection.preparedCandidates.length, readyCount: projection.preparedCandidates.filter((item) => item.status === "READY_TO_PREPARE").length, digest: projectionDigest, assets: projection.assets.map((asset) => `${asset.id} · ${asset.name}`) };
    pendingAuthorityProposals.set(proposalId, Object.freeze({ pictureId, projection, projectionDigest, reviewDocument, summary }));
    return { ok: true, proposalId, projectionDigest, reviewDocument, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Production authority proposal failed." };
  }
}

function confirmProductionAuthority(params) {
  const proposalId = String(params?.proposalId ?? "");
  const proposal = pendingAuthorityProposals.get(proposalId);
  pendingAuthorityProposals.delete(proposalId);
  if (!proposal) return { ok: false, error: "Production authority proposal is missing or already resolved." };
  if (params?.confirmed !== true) return { ok: false, error: "Production authority seal was canceled by the native confirmation dialog." };
  try {
    loadLedger();
    const previousAuthorityId = currentAuthorityByPicture.get(proposal.pictureId) ?? null;
    const authorityId = `authority:${randomBytes(16).toString("hex")}`;
    const sealedAt = Date.now();
    const payload = { schemaVersion: 1, authorityId, pictureId: proposal.pictureId, parentAuthorityId: previousAuthorityId, supersedesAuthorityId: previousAuthorityId, projectionDigest: proposal.projectionDigest, boundedProjection: proposal.projection, summary: proposal.summary, sealedAt, reason: "inventory-authority-seal" };
    const record = appendLedger("productionAuthority", authorityId, payload);
    return { ok: true, authorityId, digest: proposal.projectionDigest, createdAt: sealedAt, mac: record.mac, summary: proposal.summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Production authority confirmation failed." };
  }
}

function requireCurrentAuthority(authorityId) {
  loadLedger();
  const id = boundedId(authorityId, "Production authority id", /^authority:[a-f0-9]{32}$/);
  const authority = productionAuthorities.get(id);
  if (!authority) throw new Error("Production authority was not found in the backend ledger.");
  if (currentAuthorityByPicture.get(authority.pictureId) !== id) throw new Error("Production authority is stale; explicitly re-seal production authority before continuing.");
  if (domainDigest("p316.productionAuthority.projection.v1", authority.boundedProjection) !== authority.projectionDigest) throw new Error("Production authority projection digest verification failed.");
  return authority;
}

function requireAuthorityPrepared(authority, preparedAssetId, expectedStatus = "READY_TO_PREPARE") {
  const id = boundedId(preparedAssetId, "Prepared asset id", /^prepared:[a-zA-Z0-9:._-]{1,220}$/);
  const prepared = authority.boundedProjection.preparedCandidates.find((item) => item.id === id);
  if (!prepared) throw new Error("Prepared asset record not found in sealed production authority.");
  if (prepared.status !== expectedStatus) throw new Error(expectedStatus === "READY_TO_PREPARE" ? "Prepared asset must be READY_TO_PREPARE before approval." : "Prepared asset is not sealed as ready for generation.");
  if (prepared.blockers?.length) throw new Error("Blocked prepared assets cannot be approved.");
  const asset = authority.boundedProjection.assets.find((item) => item.id === prepared.assetId);
  if (!asset) throw new Error("Production asset not found in sealed production authority.");
  return { prepared, asset };
}

function preparedApprovalDigestFromAuthority({ authority, prepared, asset, approvedAt }) {
  return domainDigest("p316.preparedApproval.v1", { authorityId: authority.authorityId, projectionDigest: authority.projectionDigest, pictureId: authority.pictureId, preparedAssetId: prepared.id, assetId: asset.id, specVersionId: prepared.specVersionId ?? null, canonicalSpecBytesDigest: prepared.assetSpecDigest, referencesDigest: prepared.referencesDigest, visualRoots: prepared.visualBibleVersionIds, cinematographyRoots: prepared.cinematographyPlanIds, promptDigest: prepared.promptDigest, dependencyFingerprintsDigest: prepared.dependencyFingerprintsDigest, approvedAt });
}

function verifyPreparedApprovalCandidate(params) {
  const authority = requireCurrentAuthority(params?.authorityId);
  const { prepared, asset } = requireAuthorityPrepared(authority, params?.preparedAssetId, "READY_TO_PREPARE");
  return { authority, pictureId: authority.pictureId, prepared, asset, expectedFingerprints: prepared.dependencyFingerprints, prompt: prepared.prompt };
}

function proposePreparedApproval(params) {
  try {
    const verified = verifyPreparedApprovalCandidate(params);
    const proposalId = `preparedApprovalProposal:${randomBytes(16).toString("hex")}`;
    const summary = { authorityId: verified.authority.authorityId, authorityDigest: verified.authority.projectionDigest, assetId: verified.asset.id, preparedAssetId: verified.prepared.id, specVersionId: verified.prepared.specVersionId, prompt: verified.prompt.slice(0, 700), dependencyCount: verified.expectedFingerprints.length, referenceIds: verified.prepared.referenceIds ?? [] };
    pendingApprovalProposals.set(proposalId, Object.freeze({ ...verified, summary, proposalDigest: domainDigest("p316.preparedApproval.proposal.v1", { authorityId: verified.authority.authorityId, projectionDigest: verified.authority.projectionDigest, preparedAssetId: verified.prepared.id, assetId: verified.asset.id, promptDigest: verified.prepared.promptDigest, dependencyFingerprintsDigest: verified.prepared.dependencyFingerprintsDigest }) }));
    return { ok: true, proposalId, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Prepared approval proposal failed." };
  }
}

function confirmPreparedApproval(params) {
  const proposalId = String(params?.proposalId ?? "");
  const proposal = pendingApprovalProposals.get(proposalId);
  pendingApprovalProposals.delete(proposalId);
  if (!proposal) return { ok: false, error: "Prepared approval proposal is missing or already resolved." };
  if (params?.confirmed !== true) return { ok: false, error: "Prepared approval was canceled by the native confirmation dialog." };
  try {
    const current = verifyPreparedApprovalCandidate({ authorityId: proposal.authority.authorityId, preparedAssetId: proposal.prepared.id });
    const currentDigest = domainDigest("p316.preparedApproval.proposal.v1", { authorityId: current.authority.authorityId, projectionDigest: current.authority.projectionDigest, preparedAssetId: current.prepared.id, assetId: current.asset.id, promptDigest: current.prepared.promptDigest, dependencyFingerprintsDigest: current.prepared.dependencyFingerprintsDigest });
    if (currentDigest !== proposal.proposalDigest) throw new Error("Prepared approval inputs changed before confirmation.");
    const rootId = `preparedApproval:${randomBytes(16).toString("hex")}`;
    const approvedAt = Date.now();
    const approvalDigest = preparedApprovalDigestFromAuthority({ ...current, approvedAt });
    const payload = { approvalRootId: rootId, authorityId: current.authority.authorityId, authorityDigest: current.authority.projectionDigest, approvedAt, approvalDigest, pictureId: current.pictureId, preparedAssetId: current.prepared.id, assetId: current.asset.id, specVersionId: current.prepared.specVersionId ?? null, promptDigest: current.prepared.promptDigest, dependencyFingerprints: current.expectedFingerprints, dependencyFingerprintsDigest: current.prepared.dependencyFingerprintsDigest, assetSpecDigest: current.prepared.assetSpecDigest, referencesDigest: current.prepared.referencesDigest };
    const record = appendLedger("preparedApproval", rootId, payload);
    return { ok: true, rootId, approvedAt, digest: approvalDigest, authorityId: current.authority.authorityId, mac: record.mac };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Prepared approval confirmation failed." };
  }
}

function verifyPreparedSnapshot(params, manifest) {
  const authority = requireCurrentAuthority(params?.authorityId);
  const preparedAssetId = boundedId(params?.preparedAssetId, "Prepared asset id", /^prepared:[a-zA-Z0-9:._-]{1,220}$/);
  const { prepared, asset } = requireAuthorityPrepared(authority, preparedAssetId, "READY_TO_PREPARE");
  const approvalRootId = boundedId(params?.preparedApprovalRootId, "Prepared approval root id", /^preparedApproval:[a-f0-9]{32}$/);
  loadLedger();
  const approval = preparedApprovals.get(approvalRootId);
  if (!approval) throw new Error("Prepared generation requires a backend-signed prepared approval root.");
  if (approval.authorityId !== authority.authorityId || approval.authorityDigest !== authority.projectionDigest || approval.preparedAssetId !== prepared.id || approval.assetId !== asset.id) throw new Error("Prepared approval ledger root is not bound to the current authority.");
  const references = Array.isArray(params.references) ? params.references.filter((uri) => typeof uri === "string" && uri.startsWith("data:image/") && uri.length < 8 * 1024 * 1024).slice(0, MAX_REF_COUNT) : [];
  if (references.length) throw new Error("Prepared T2I generation does not accept renderer-supplied reference bytes.");
  const adapter = preparedT2iAdapter(String(params.engineId ?? ""));
  if (!adapter) throw new Error("Only FLUX.2 Dev (default T2I) or FLUX.1 prepared generation is enabled.");
  const fixedValues = { ...mediaSettings(params.values), ...adapter.values };
  return {
    authorityId: authority.authorityId,
    authorityDigest: authority.projectionDigest,
    pictureId: authority.pictureId,
    preparedApprovalRootId: approvalRootId,
    preparedApprovalDigest: approval.approvalDigest,
    productionDigest: authority.projectionDigest,
    preparedAssetId,
    assetId: asset.id,
    specVersionId: prepared.specVersionId ?? null,
    dependencyFingerprints: prepared.dependencyFingerprints,
    assetSpec: asset.canonicalSpec,
    referenceRequired: Boolean(asset.referenceRequired),
    referenceIds: prepared.referenceIds ?? [],
    provenanceExpected: true,
    visualBibleVersionIds: prepared.visualBibleVersionIds ?? [],
    cinematographyPlanIds: prepared.cinematographyPlanIds ?? [],
    engineId: adapter.engineId,
    engineName: adapter.engineName,
    selectedBasePath: adapter.selectedBasePath,
    prompt: prepared.prompt,
    references,
    values: fixedValues,
    configDigest: domainDigest("p316.preparedGeneration.config.v1", { engineId: adapter.engineId, selectedBasePath: adapter.selectedBasePath, promptDigest: prepared.promptDigest, values: fixedValues, adapter: adapter.adapter }),
    manifestDigest: stableManifestDigest(manifest),
  };
}

function preparedT2iAdapter(engineId) {
  if (engineId === "flux2") {
    return {
      engineId: "flux2",
      engineName: "FLUX.2 Dev",
      selectedBasePath: "diffusion_models/flux2_dev.safetensors",
      adapter: "flux2/flux2-dev",
      summary: "FLUX.2 Dev · official 50 steps · guidance 4.0 · 512×512 PNG",
      values: { width: 512, height: 512, steps: 50, guidance: 4, scheduler: "flux2-empirical-snr", precision: "BF16", outputFormat: "PNG", outputBitDepth: 8 },
    };
  }
  if (engineId === "flux") {
    return {
      engineId: "flux",
      engineName: "FLUX.1 Dev",
      selectedBasePath: "diffusion_models/flux1-dev.safetensors",
      adapter: "flux/flux1-dev",
      summary: "FLUX.1 Dev · official 20 steps · guidance 3.5 · 512×512 PNG",
      values: { width: 512, height: 512, steps: 20, guidance: 3.5, scheduler: "flux1-official-20-guidance-3.5", precision: "BF16", outputFormat: "PNG", outputBitDepth: 8 },
    };
  }
  return null;
}

function receiptContinuityFindings(job, receiptId) {
  const locks = [...(job.assetSpec?.continuityLocks ?? []), ...(job.assetSpec?.distinguishingFeatures ?? [])].map((value) => String(value ?? "").trim()).filter(Boolean);
  const findings = [];
  if (locks.length) findings.push({ id: `continuity:${receiptId}:approved-locks`, severity: "blocker", message: `Confirm visible approved identity/continuity locks: ${locks.slice(0, 6).join("; ")}`, confirmed: false });
  else findings.push({ id: `continuity:${receiptId}:no-locks`, severity: "warning", message: "No approved identity locks are sealed for this asset; reviewer must confirm visible continuity manually.", confirmed: false });
  if (job.referenceRequired && !(job.referenceIds ?? []).length) findings.push({ id: `continuity:${receiptId}:required-reference`, severity: "blocker", message: "A required reference was missing from the sealed approved asset data.", confirmed: false });
  if (!job.provenanceExpected) findings.push({ id: `continuity:${receiptId}:provenance`, severity: "blocker", message: "Native generation provenance is absent from the receipt.", confirmed: false });
  return findings;
}

function proposalSummary(payload, manifest) {
  return {
    assetId: payload.assetId,
    preparedAssetId: payload.preparedAssetId,
    specVersionId: payload.specVersionId,
    prompt: payload.prompt.slice(0, 700),
    engine: preparedT2iAdapter(payload.engineId)?.summary ?? payload.engineName,
    manifestDigest: payload.manifestDigest,
    dependencyCount: payload.dependencyFingerprints.length,
    componentSummary: (manifest.components ?? []).map((component) => `${component.role}: ${component.stableId}`).slice(0, 8),
  };
}

function proposePrepared(params) {
  const adapter = preparedT2iAdapter(String(params?.engineId ?? "flux2"));
  if (!adapter) {
    const manifest = resolveImageComponentManifest(String(params?.engineId ?? ""), "");
    return { ok: false, error: "Only FLUX.2 Dev (default T2I) or FLUX.1 prepared generation is enabled.", manifest };
  }
  const manifest = resolveImageComponentManifest(adapter.engineId, adapter.selectedBasePath);
  params = { ...(params ?? {}), engineId: adapter.engineId, selectedBasePath: adapter.selectedBasePath, engineName: adapter.engineName };
  let payload;
  try {
    payload = verifyPreparedSnapshot(params, manifest);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Prepared authorization failed.", manifest };
  }
  if (manifest.status !== "READY") return { ok: false, error: manifest.disabledReason ?? "Native image adapter is unavailable.", manifest };
  const proposalId = `proposal:${randomBytes(16).toString("hex")}`;
  pendingProposals.set(proposalId, Object.freeze({ ...payload, manifest, proposalDigest: digest(payload), appBuildIdentity: { packaged: process.env.P316_PACKAGED_APP === "1", buildId: process.env.P316_BUILD_ID ?? "development" } }));
  return { ok: true, proposalId, summary: proposalSummary(payload, manifest), manifest };
}

function confirmPrepared(params) {
  const proposalId = String(params?.proposalId ?? "");
  const proposal = pendingProposals.get(proposalId);
  pendingProposals.delete(proposalId);
  if (!proposal) return { ok: false, error: "Prepared generation proposal is missing or already resolved." };
  if (params?.confirmed !== true) return { ok: false, error: "Prepared generation was canceled by the native confirmation dialog." };
  const manifest = resolveImageComponentManifest(proposal.engineId, proposal.selectedBasePath);
  if (stableManifestDigest(manifest) !== proposal.manifestDigest || manifest.status !== "READY") return { ok: false, error: "Native image manifest changed before confirmation.", manifest };
  const sealId = `seal:${randomBytes(16).toString("hex")}`;
  const seal = { sealId, proposalId, proposalDigest: proposal.proposalDigest, authorityId: proposal.authorityId, authorityDigest: proposal.authorityDigest, pictureId: proposal.pictureId, preparedAssetId: proposal.preparedAssetId, assetId: proposal.assetId, specVersionId: proposal.specVersionId, preparedApprovalRootId: proposal.preparedApprovalRootId, preparedApprovalDigest: proposal.preparedApprovalDigest, manifestDigest: proposal.manifestDigest, productionDigest: proposal.productionDigest, dependencyFingerprints: proposal.dependencyFingerprints, promptDigest: domainDigest("p316.prepared.prompt.v1", { prompt: proposal.prompt }), configDigest: proposal.configDigest, appBuildIdentity: proposal.appBuildIdentity };
  appendLedger("preparedSeal", sealId, seal);
  const token = `w4_${randomBytes(24).toString("hex")}`;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  pendingPrepared.set(token, { ...proposal, sealId, sealDigest: digest(seal), expiresAt, tokenDigest: createHash("sha256").update(token).digest("hex") });
  return { ok: true, token, expiresAt, manifest };
}

async function generatePrepared(params) {
  const token = String(params?.token ?? "");
  const job = pendingPrepared.get(token);
  pendingPrepared.delete(token);
  if (!job) return { ok: false, error: "Prepared generation authorization is missing, expired, or already used." };
  if (Date.now() > job.expiresAt) return { ok: false, error: "Prepared generation authorization expired." };
  const manifest = resolveImageComponentManifest(job.engineId, job.selectedBasePath);
  if (stableManifestDigest(manifest) !== job.manifestDigest || manifest.status !== "READY") {
    return { ok: false, error: "Native image manifest changed before generation.", manifest };
  }
  const result = await exposeLocalStill({
    prompt: job.prompt,
    engineId: job.engineId,
    engineName: job.engineName,
    references: [],
    selectedBasePath: job.selectedBasePath,
    values: job.values,
    assetId: job.assetId,
    pictureId: job.pictureId,
    preparedAssetId: job.preparedAssetId,
  });
  if (!result.ok) return result;
  const receiptId = `receipt:${randomBytes(16).toString("hex")}`;
  const iterationId = `iteration:${job.assetId}:${randomBytes(8).toString("hex")}`;
  const receiptOutput = (({ mediaBytes, sidecarBytes, ...proof }) => proof)(result.output);
  const continuityFindings = receiptContinuityFindings({ ...job, provenanceExpected: Boolean(result.provenance) }, receiptId);
  const receipt = {
    receiptId,
    at: Date.now(),
    tokenDigest: job.tokenDigest,
    sealId: job.sealId,
    sealDigest: job.sealDigest,
    requestDigest: digest({ prompt: job.prompt, values: job.values, assetId: job.assetId, preparedAssetId: job.preparedAssetId, manifestDigest: job.manifestDigest, configDigest: job.configDigest, sealDigest: job.sealDigest }),
    authorityId: job.authorityId,
    authorityDigest: job.authorityDigest,
    pictureId: job.pictureId,
    preparedAssetId: job.preparedAssetId,
    assetId: job.assetId,
    specVersionId: job.specVersionId,
    iterationId,
    preparedApprovalRootId: job.preparedApprovalRootId,
    preparedApprovalDigest: job.preparedApprovalDigest,
    preparedSealDigest: job.sealDigest,
    continuityFindings,
    continuityFindingsDigest: domainDigest("p316.canonical.continuity.v1", continuityFindings),
    manifestDigest: job.manifestDigest,
    productionDigest: job.productionDigest,
    workerIdentityDigest: result.workerIdentityDigest ?? null,
    componentDigest: result.componentDigest ?? null,
    dependencyFingerprints: job.dependencyFingerprints,
    output: receiptOutput,
    outputDigest: domainDigest("p316.canonical.output.v1", receiptOutput),
    provenanceDigest: digest(result.provenance),
  };
  const receiptRecord = appendLedger("generationReceipt", receiptId, receipt);
  return { ...result, receiptId, receiptDigest: domainDigest("p316.generationReceipt.v1", receipt), receiptMac: receiptRecord.mac, iterationId, continuityFindings, output: { ...result.output, receiptId } };
}

function verifyOutput(params) {
  const receiptId = String(params?.receiptId ?? "");
  const receipt = loadReceipt(receiptId);
  if (!receipt) return { ok: false, error: "Generation receipt not found in this desktop session." };
  const expected = receipt.output;
  const verified = verifyLocalStillOutput(expected);
  if (!verified.ok) return verified;
  return { ok: true, output: { ...verified.output, receiptId } };
}

function normalizedFindingConfirmations(params) {
  const list = Array.isArray(params?.findings) ? params.findings : [];
  const seen = new Set();
  return list.map((item) => {
    const id = String(item?.id ?? "");
    if (!id || seen.has(id)) throw new Error("Canonical approval findings are missing or duplicated.");
    seen.add(id);
    return { id, confirmed: item?.confirmed === true };
  });
}

function verifyCanonicalApprovalRequest(params) {
  const reason = String(params?.reason ?? "").trim();
  if (!reason) throw new Error("Canonical approval requires a non-empty reviewer reason.");
  const verified = verifyOutput(params);
  if (!verified.ok) throw new Error(verified.error);
  const receipt = loadReceipt(String(params?.receiptId ?? ""));
  if (!receipt) throw new Error("Generation receipt not found.");
  const authority = requireCurrentAuthority(params?.authorityId ?? receipt.authorityId);
  if (rejectedReceiptIds.has(receipt.receiptId)) throw new Error("Generation receipt has a signed rejection decision and cannot be canonically approved.");
  if (receipt.authorityId !== authority.authorityId || receipt.authorityDigest !== authority.projectionDigest) throw new Error("Canonical approval receipt is not bound to the current production authority.");
  if (receipt.preparedApprovalRootId !== String(params?.preparedApprovalRootId ?? receipt.preparedApprovalRootId)) throw new Error("Canonical approval prepared root does not match the sealed generation receipt.");
  if (receipt.iterationId !== String(params?.iterationId ?? "")) throw new Error("Canonical approval iteration does not match the sealed generation receipt.");
  const expected = receipt.continuityFindings ?? [];
  const confirmations = normalizedFindingConfirmations(params);
  const expectedIds = expected.map((finding) => finding.id).sort();
  const actualIds = confirmations.map((finding) => finding.id).sort();
  if (stableString(expectedIds) !== stableString(actualIds)) throw new Error("Canonical approval findings must exactly match the receipt findings.");
  const byId = new Map(confirmations.map((finding) => [finding.id, finding.confirmed]));
  const continuityFindings = expected.map((finding) => ({ ...finding, confirmed: Boolean(byId.get(finding.id)) }));
  if (continuityFindings.some((finding) => finding.severity === "blocker" && finding.confirmed !== true)) throw new Error("Continuity blockers require explicit native-confirmed acknowledgement.");
  return { reason, verified, receipt, continuityFindings, authority };
}

function canonicalProof(decision, recordMac) {
  return { decisionId: decision.decisionId, authorityId: decision.authorityId, receiptId: decision.receiptId, signedRecordMac: recordMac, generationReceiptDigest: decision.generationReceiptDigest, preparedApprovalRootId: decision.preparedApprovalRootId, preparedApprovalDigest: decision.preparedApprovalDigest, preparedSealDigest: decision.preparedSealDigest, assetId: decision.assetId, preparedAssetId: decision.preparedAssetId, iterationId: decision.iterationId, reasonDigest: decision.reasonDigest, continuityDigest: decision.continuityDigest, outputDigest: decision.outputDigest };
}

function proposeCanonicalApproval(params) {
  try {
    const verified = verifyCanonicalApprovalRequest(params);
    const proposalId = `canonicalProposal:${randomBytes(16).toString("hex")}`;
    const summary = { assetId: verified.receipt.assetId, preparedAssetId: verified.receipt.preparedAssetId, iterationId: verified.receipt.iterationId, receiptId: verified.receipt.receiptId, mediaUri: verified.receipt.output.mediaUri, reason: verified.reason, findings: verified.continuityFindings };
    pendingCanonicalProposals.set(proposalId, Object.freeze({ ...verified, params: { ...params }, proposalDigest: digest({ receiptId: verified.receipt.receiptId, iterationId: verified.receipt.iterationId, reason: verified.reason, continuityFindings: verified.continuityFindings, output: verified.receipt.output }) }));
    return { ok: true, proposalId, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Canonical approval proposal failed." };
  }
}

function verifyCanonicalRejectionRequest(params) {
  const reason = String(params?.reason ?? "").trim();
  if (!reason) throw new Error("Canonical rejection requires a non-empty reviewer reason.");
  const receipt = loadReceipt(String(params?.receiptId ?? ""));
  if (!receipt) throw new Error("Generation receipt not found.");
  const authority = requireCurrentAuthority(params?.authorityId ?? receipt.authorityId);
  if (receipt.authorityId !== authority.authorityId || receipt.authorityDigest !== authority.projectionDigest) throw new Error("Canonical rejection receipt is not bound to the current production authority.");
  if (receipt.preparedApprovalRootId !== String(params?.preparedApprovalRootId ?? "")) throw new Error("Canonical rejection prepared root does not match the sealed generation receipt.");
  if (receipt.iterationId !== String(params?.iterationId ?? "")) throw new Error("Canonical rejection iteration does not match the sealed generation receipt.");
  return { reason, receipt, authority };
}

function canonicalRejectionProposalDigest(verified) {
  return digest({ authorityId: verified.authority.authorityId, authorityDigest: verified.authority.projectionDigest, receiptId: verified.receipt.receiptId, preparedApprovalRootId: verified.receipt.preparedApprovalRootId, iterationId: verified.receipt.iterationId, reason: verified.reason, outputDigest: domainDigest("p316.canonical.output.v1", verified.receipt.output) });
}

function proposeCanonicalRejection(params) {
  try {
    const verified = verifyCanonicalRejectionRequest(params);
    const proposalId = `canonicalRejectionProposal:${randomBytes(16).toString("hex")}`;
    const summary = { authorityId: verified.authority.authorityId, authorityDigest: verified.authority.projectionDigest, assetId: verified.receipt.assetId, preparedAssetId: verified.receipt.preparedAssetId, iterationId: verified.receipt.iterationId, receiptId: verified.receipt.receiptId, reason: verified.reason, mediaUri: verified.receipt.output?.mediaUri ?? "" };
    pendingCanonicalRejectionProposals.set(proposalId, Object.freeze({ ...verified, params: { ...params }, proposalDigest: canonicalRejectionProposalDigest(verified), summary }));
    return { ok: true, proposalId, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Canonical rejection proposal failed." };
  }
}

function confirmCanonicalRejection(params) {
  const proposalId = String(params?.proposalId ?? "");
  const proposal = pendingCanonicalRejectionProposals.get(proposalId);
  pendingCanonicalRejectionProposals.delete(proposalId);
  if (!proposal) return { ok: false, error: "Canonical rejection proposal is missing or already resolved." };
  if (params?.confirmed !== true) return { ok: false, error: "Canonical rejection was canceled by the native confirmation dialog." };
  try {
    const verified = verifyCanonicalRejectionRequest(proposal.params);
    if (canonicalRejectionProposalDigest(verified) !== proposal.proposalDigest) throw new Error("Canonical rejection inputs changed before confirmation.");
    const decisionId = `rejection:${randomBytes(16).toString("hex")}`;
    const decision = { decisionId, authorityId: verified.authority.authorityId, receiptId: verified.receipt.receiptId, generationReceiptDigest: domainDigest("p316.generationReceipt.v1", verified.receipt), assetId: verified.receipt.assetId, preparedAssetId: verified.receipt.preparedAssetId, iterationId: verified.receipt.iterationId, reviewer: "user", reason: verified.reason, reasonDigest: domainDigest("p316.canonical.reason.v1", { reason: verified.reason }), preparedApprovalRootId: verified.receipt.preparedApprovalRootId, preparedApprovalDigest: verified.receipt.preparedApprovalDigest, preparedSealDigest: verified.receipt.preparedSealDigest, outputDigest: domainDigest("p316.canonical.output.v1", verified.receipt.output), productionDigest: verified.receipt.productionDigest };
    const record = appendLedger("rejectionDecision", decisionId, decision);
    return { ok: true, decisionId, decision: { ...decision, signedRecordMac: record.mac } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Canonical rejection confirmation failed." };
  }
}

function confirmCanonicalApproval(params) {
  const proposalId = String(params?.proposalId ?? "");
  const proposal = pendingCanonicalProposals.get(proposalId);
  pendingCanonicalProposals.delete(proposalId);
  if (!proposal) return { ok: false, error: "Canonical approval proposal is missing or already resolved." };
  if (params?.confirmed !== true) return { ok: false, error: "Canonical approval was canceled by the native confirmation dialog." };
  try {
    const verified = verifyCanonicalApprovalRequest(proposal.params);
    const proposalDigest = digest({ receiptId: verified.receipt.receiptId, iterationId: verified.receipt.iterationId, reason: verified.reason, continuityFindings: verified.continuityFindings, output: verified.receipt.output });
    if (proposalDigest !== proposal.proposalDigest) throw new Error("Canonical approval inputs changed before confirmation.");
    const decisionId = `canonical:${randomBytes(16).toString("hex")}`;
    const decision = { decisionId, authorityId: verified.authority.authorityId, receiptId: verified.receipt.receiptId, generationReceiptDigest: domainDigest("p316.generationReceipt.v1", verified.receipt), assetId: verified.receipt.assetId, preparedAssetId: verified.receipt.preparedAssetId, iterationId: verified.receipt.iterationId, reviewer: "user", reason: verified.reason, reasonDigest: domainDigest("p316.canonical.reason.v1", { reason: verified.reason }), continuityFindings: verified.continuityFindings, continuityDigest: domainDigest("p316.canonical.continuity.v1", verified.continuityFindings), outputDigest: domainDigest("p316.canonical.output.v1", verified.receipt.output), preparedApprovalRootId: verified.receipt.preparedApprovalRootId, preparedApprovalDigest: verified.receipt.preparedApprovalDigest, preparedSealDigest: verified.receipt.preparedSealDigest, manifestDigest: verified.receipt.manifestDigest, productionDigest: verified.receipt.productionDigest };
    const record = appendLedger("canonicalDecision", decisionId, decision);
    return { ok: true, decisionId, proof: canonicalProof(decision, record.mac), output: verified.verified.output };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Canonical approval confirmation failed." };
  }
}

async function dispatch(method, params) {
  switch (method) {
    case "catalog.get":
      return sanitizeCatalog(await loadCatalog({ force: Boolean(params?.force), deep: Boolean(params?.deep) }));
    case "image.manifests":
      return resolveImageComponentManifests();
    case "image.proposeProductionAuthority":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return proposeProductionAuthority(params);
    case "image.confirmProductionAuthority":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return confirmProductionAuthority(params);
    case "image.authorityStatus":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return productionAuthorityStatus(params);
    case "image.proposePreparedApproval":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return proposePreparedApproval(params);
    case "image.confirmPreparedApproval":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return confirmPreparedApproval(params);
    case "image.proposePrepared":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return proposePrepared(params);
    case "image.confirmPrepared":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return confirmPrepared(params);
    case "image.generatePrepared":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return generatePrepared(params);
    case "image.proposeCanonicalRejection":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return proposeCanonicalRejection(params);
    case "image.confirmCanonicalRejection":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return confirmCanonicalRejection(params);
    case "image.proposeCanonicalApproval":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return proposeCanonicalApproval(params);
    case "image.confirmCanonicalApproval":
      if (params?.mediaRoot) { setLocalStillMediaRoot(String(params.mediaRoot)); setReceiptMediaRoot(String(params.mediaRoot)); }
      return confirmCanonicalApproval(params);
    case "engines.stop":
      return stopLocalEngine();
    case "app.modelRoot":
      return "Local model vault";
    default:
      throw new Error("Unknown backend method");
  }
}

export const __testing = { setReceiptMediaRoot, loadLedger, appendLedger, validateSignedRecord, signedLedgerRecord, digest, domainDigest, productionAuthorityProjection, proposeProductionAuthority, confirmProductionAuthority, productionAuthorityStatus, verifyPreparedSnapshot, proposePreparedApproval, confirmPreparedApproval, proposeCanonicalApproval, confirmCanonicalApproval, proposeCanonicalRejection, confirmCanonicalRejection };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const id = msg?.id;
    const method = String(msg?.method ?? "");
    try {
      if (!ALLOWED.has(method)) throw new Error("Blocked backend method");
      const result = await dispatch(method, msg.params);
      process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
  }
}
