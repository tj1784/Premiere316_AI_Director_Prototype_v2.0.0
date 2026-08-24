import crypto from "crypto";
import fs from "fs";
import path from "path";

import { resolveProjectMediaFile } from "./media-path.js";
import { PROJECTS_DIR } from "./paths.js";

export const CLIENT_OWNED_REFERENCE_FIELDS = Object.freeze([
  "file",
  "sourceAssetFile",
  "comfyFile",
  "disk",
  "path",
  "absolutePath"
]);

const SHA256_RE = /^[a-f0-9]{64}$/i;
const DEAD_ASSET_STATUSES = new Set(["deprecated", "deleted", "cancelled", "refused"]);

const ROLE_ALIASES = Object.freeze({
  identity: "identity",
  character: "identity",
  face: "identity",
  actor: "identity",
  wardrobe: "wardrobe",
  costume: "wardrobe",
  clothing: "wardrobe",
  location: "location",
  environment: "location",
  set: "location",
  composition: "location",
  prop: "prop",
  artifact: "prop",
  vehicle: "prop",
  crowd: "crowd",
  crowds: "crowd",
  extra: "crowd",
  extras: "crowd",
  creature: "crowd",
  atmosphere: "atmosphere",
  atmosphere_vfx: "atmosphere",
  vfx: "atmosphere",
  lighting: "atmosphere",
  style: "atmosphere",
  guide: "guide",
  first_frame: "guide",
  last_frame: "guide"
});

export class StillsReferenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StillsReferenceError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function fail(code, message, details) {
  throw new StillsReferenceError(code, message, details);
}

export function listClientOwnedReferenceFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return CLIENT_OWNED_REFERENCE_FIELDS.filter((field) => Object.hasOwn(value, field));
}

function rejectClientOwnedFields(value, pathValue) {
  const owned = listClientOwnedReferenceFields(value);
  if (!owned.length) return;
  fail(
    "client_owned_file_rejected",
    `Client-supplied ${owned.join(", ")} is not accepted; the server resolves the asset file`,
    { path: pathValue, fields: owned }
  );
}

export function findExactAssetVersion(asset, assetVersion) {
  // Exact pin only: never versions.at(-1), never activeVersion, never newest.
  if (!Number.isInteger(assetVersion) || assetVersion < 1) return null;
  const versions = Array.isArray(asset?.versions) ? asset.versions : [];
  for (const candidate of versions) {
    if (Number(candidate?.v) === assetVersion) return candidate;
  }
  return null;
}

function canonicalStillsRole(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  return ROLE_ALIASES[normalized] || normalized;
}

function stillsType(value) {
  if (value === undefined || value === null || value === "") return "image";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function projectsRootOf(project) {
  const override = typeof project?.projectsRoot === "string" ? project.projectsRoot.trim() : "";
  return override || PROJECTS_DIR;
}

function manifestRelativeFile(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^media\/assets\//i, "");
  if (!raw || raw.includes("\0")) return null;
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) return null;
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return normalized;
}

function versionSourceFile(version) {
  const files = [
    ...(Array.isArray(version?.files) ? version.files : []),
    version?.file
  ].map(manifestRelativeFile).filter(Boolean);
  const preferred = manifestRelativeFile(version?.file) || files[0] || null;
  return preferred && files.includes(preferred) ? preferred : null;
}

function projectSkipsApproval(project) {
  const category = String(project?.category ?? project?.settings?.category ?? "feature").trim().toLowerCase();
  return category === "shorts" || project?.settings?.skipApproval === true;
}

function assetGenerationFingerprint(asset) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: asset?.id || null,
    name: asset?.name || "",
    variant: asset?.variant || "",
    category: asset?.category || null,
    mediaType: asset?.mediaType || null,
    prompt: asset?.prompt || "",
    sampleText: asset?.sampleText || "",
    workflowId: asset?.workflowId || null,
    workflowHash: asset?.workflowHash || null,
    seed: asset?.seed ?? null,
    durationSec: asset?.durationSec ?? null,
    bpm: asset?.bpm ?? null
  })).digest("hex");
}

function fingerprintVersionRecord(asset, version) {
  const fileHashes = Array.isArray(version?.fileHashes)
    ? version.fileHashes.map((entry) => ({
      file: String(entry?.file || ""),
      sha256: String(entry?.sha256 || "").toLowerCase(),
      bytes: Number(entry?.bytes) || 0
    })).sort((left, right) => left.file.localeCompare(right.file))
    : [];
  return crypto.createHash("sha256").update(JSON.stringify({
    assetId: asset.id,
    version: Number(version.v),
    files: version.files || (version.file ? [version.file] : []),
    workflowId: version.workflowId || asset.workflowId || null,
    workflowHash: version.workflowHash || asset.workflowHash || null,
    model: version.model || null,
    prompt: version.prompt || "",
    seed: version.seed ?? null,
    createdAt: version.createdAt || null,
    generationFingerprint: version.assetFingerprint || null,
    fileHashes
  })).digest("hex");
}

function approvalFingerprintOf(asset) {
  const approval = asset?.approval;
  if (!approval || typeof approval !== "object") return null;
  if (typeof approval.fingerprint === "string" && SHA256_RE.test(approval.fingerprint)) {
    return approval.fingerprint.toLowerCase();
  }
  if (typeof approval.approvalFingerprint === "string" && SHA256_RE.test(approval.approvalFingerprint)) {
    return approval.approvalFingerprint.toLowerCase();
  }
  if (typeof approval.versionFingerprint === "string" && SHA256_RE.test(approval.versionFingerprint)) {
    return approval.versionFingerprint.toLowerCase();
  }
  return crypto.createHash("sha256").update(JSON.stringify({
    status: approval.status || null,
    activeVersion: Number(approval.activeVersion) || null,
    screenplayRevision: approval.screenplayRevision || null,
    generationFingerprint: approval.generationFingerprint || null,
    versionFingerprint: approval.versionFingerprint || null,
    approvedAt: approval.approvedAt || null
  })).digest("hex");
}

function exactVersionCurrentlyApproved(project, asset, requestedVersion) {
  // Keep composer tests free of assets.js/Comfy imports. Equivalent fail-closed
  // rule: skipApproval projects may pin the exact existing version; otherwise
  // the exact requested version must be the currently approved version.
  if (!asset) return false;
  if (projectSkipsApproval(project)) return true;
  const approval = asset.approval;
  return Boolean(
    approval &&
    approval.status === "approved" &&
    Number(approval.activeVersion) === Number(requestedVersion)
  );
}

function resolveOneStillsReference(project, pin, index, assetById, seenOrders) {
  const basePath = `references[${index}]`;
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
    fail("invalid_reference", "Each reference must be an object", { path: basePath });
  }
  rejectClientOwnedFields(pin, basePath);

  const assetId = typeof pin.assetId === "string" ? pin.assetId.trim() : "";
  if (!assetId) fail("missing_asset_id", "assetId is required", { path: `${basePath}.assetId` });

  if (!Number.isInteger(pin.assetVersion) || pin.assetVersion < 1) {
    fail(
      "invalid_asset_version",
      "assetVersion must be a positive integer; missing versions are not filled from active or newest",
      { path: `${basePath}.assetVersion` }
    );
  }

  const role = canonicalStillsRole(pin.role);
  if (!role) {
    fail("invalid_reference_role", "role is required", { path: `${basePath}.role` });
  }

  if (!Number.isInteger(pin.order) || pin.order < 1) {
    fail("invalid_reference_order", "order must be a unique positive 1-based integer", { path: `${basePath}.order` });
  }
  if (seenOrders.has(pin.order)) {
    fail("duplicate_reference_order", `Reference order ${pin.order} is used more than once`, {
      path: `${basePath}.order`,
      order: pin.order
    });
  }
  seenOrders.add(pin.order);

  const type = stillsType(pin.type);
  if (type !== "image") {
    fail("unsupported_reference_type", "Stills references must be type image", {
      path: `${basePath}.type`,
      type
    });
  }

  const asset = assetById.get(assetId);
  if (!asset) {
    fail("missing_asset", `Project asset does not exist: ${assetId}`, { path: `${basePath}.assetId`, assetId });
  }
  const status = String(asset.status || "").trim().toLowerCase();
  if (DEAD_ASSET_STATUSES.has(status)) {
    fail("asset_unavailable", `Project asset ${assetId} is ${status}`, { path: basePath, assetId, status });
  }

  const version = findExactAssetVersion(asset, pin.assetVersion);
  if (!version) {
    fail(
      "missing_asset_version",
      `Project manifest has no ${assetId}:v${pin.assetVersion}`,
      { path: `${basePath}.assetVersion`, assetId, assetVersion: pin.assetVersion }
    );
  }

  if (!exactVersionCurrentlyApproved(project, asset, pin.assetVersion)) {
    fail(
      "unapproved_asset_version",
      `${assetId}:v${pin.assetVersion} is not the currently approved version`,
      { path: `${basePath}.assetVersion`, assetId, assetVersion: pin.assetVersion }
    );
  }

  const declaredFile = version?.file || (Array.isArray(version?.files) ? version.files[0] : "") || "";
  if (declaredFile && !manifestRelativeFile(declaredFile)) {
    fail("path_escape", `${assetId}:v${pin.assetVersion} source file is outside the project asset directory`, {
      path: basePath,
      assetId,
      assetVersion: pin.assetVersion
    });
  }
  const relative = versionSourceFile(version);
  if (!relative) {
    fail("missing_source_file", `${assetId}:v${pin.assetVersion} has no safe source file in the project manifest`, {
      path: basePath,
      assetId,
      assetVersion: pin.assetVersion
    });
  }

  const slug = typeof project?.slug === "string" ? project.slug.trim() : "";
  if (!slug) fail("invalid_project", "A server-loaded project with a slug is required", { path: "project" });

  const diskPath = resolveProjectMediaFile(projectsRootOf(project), slug, "assets", relative);
  if (!diskPath) {
    fail("path_escape", `${assetId}:v${pin.assetVersion} source file is outside the project asset directory`, {
      path: basePath,
      assetId,
      assetVersion: pin.assetVersion
    });
  }
  if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    fail("missing_source_file", `${assetId}:v${pin.assetVersion} source file is missing on disk`, {
      path: basePath,
      assetId,
      assetVersion: pin.assetVersion,
      sourceFile: path.posix.basename(relative)
    });
  }

  const buffer = fs.readFileSync(diskPath);
  const fileSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const manifestHash = Array.isArray(version.fileHashes)
    ? version.fileHashes.find((entry) => manifestRelativeFile(entry?.file) === relative)
    : null;
  if (manifestHash) {
    const expected = String(manifestHash.sha256 || "").toLowerCase();
    if (!SHA256_RE.test(expected) || expected !== fileSha256) {
      fail("file_hash_mismatch", `${assetId}:v${pin.assetVersion} disk SHA-256 does not match the manifest`, {
        path: basePath,
        assetId,
        assetVersion: pin.assetVersion
      });
    }
  }

  const generationFingerprint = asset.approval?.generationFingerprint
    || version.assetFingerprint
    || assetGenerationFingerprint(asset)
    || null;
  const versionFingerprint = asset.approval?.versionFingerprint
    || fingerprintVersionRecord(asset, version)
    || null;
  const approvalFingerprint = approvalFingerprintOf(asset);

  return {
    order: pin.order,
    assetId,
    assetVersion: pin.assetVersion,
    type,
    role,
    sourceFile: path.posix.basename(relative),
    fileSha256,
    generationFingerprint,
    versionFingerprint,
    approvalFingerprint
  };
}

export function resolveStillsReferences(project, rawReferences) {
  const references = rawReferences === undefined ? [] : rawReferences;
  if (!Array.isArray(references)) {
    fail("invalid_references", "references must be an array", { path: "references" });
  }
  if (!project || typeof project !== "object" || typeof project.slug !== "string" || !project.slug.trim()) {
    fail("invalid_project", "A server-loaded project with a slug is required", { path: "project" });
  }

  const assets = Array.isArray(project?.assets?.items) ? project.assets.items : [];
  const assetById = new Map(assets.map((asset) => [asset?.id, asset]));
  const seenOrders = new Set();
  const resolved = references.map((pin, index) => resolveOneStillsReference(project, pin, index, assetById, seenOrders));
  resolved.sort((left, right) => left.order - right.order);
  return deepFreeze(resolved);
}

function snapshotEntries(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (snapshot && typeof snapshot === "object") return [snapshot];
  fail("invalid_snapshot", "snapshot must be an object or array of stills snapshots", { path: "snapshot" });
}

function snapshotDrift(field, message, details) {
  fail("snapshot_drift", message, { field, ...details });
}

export function revalidateStillsSnapshot(project, snapshot) {
  const entries = snapshotEntries(snapshot);
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("invalid_snapshot", "Each snapshot entry must be an object", { path: `snapshot[${index}]` });
    }
    rejectClientOwnedFields(entry, `snapshot[${index}]`);
  }

  const pins = entries.map((entry) => ({
    assetId: entry.assetId,
    assetVersion: entry.assetVersion,
    role: entry.role,
    order: entry.order,
    type: entry.type
  }));
  const fresh = resolveStillsReferences(project, pins);
  if (fresh.length !== entries.length) {
    snapshotDrift("length", "Revalidated stills snapshot length changed", {
      expected: entries.length,
      actual: fresh.length
    });
  }

  const byKey = new Map(fresh.map((entry) => [`${entry.assetId}:v${entry.assetVersion}:${entry.order}`, entry]));
  for (const stored of entries) {
    const key = `${stored.assetId}:v${stored.assetVersion}:${stored.order}`;
    const match = byKey.get(key);
    if (!match) {
      snapshotDrift("identity", `Snapshot ${key} is no longer resolvable`, { key });
    }
    if (stored.role !== match.role) {
      snapshotDrift("role", `Snapshot role changed for ${key}`, { key, expected: stored.role, actual: match.role });
    }
    if (stored.order !== match.order) {
      snapshotDrift("order", `Snapshot order changed for ${key}`, { key, expected: stored.order, actual: match.order });
    }
    if (stored.type && match.type && stored.type !== match.type) {
      snapshotDrift("type", `Snapshot type changed for ${key}`, { key, expected: stored.type, actual: match.type });
    }
    if (stored.sourceFile !== match.sourceFile) {
      snapshotDrift("sourceFile", `Snapshot source file changed for ${key}`, {
        key,
        expected: stored.sourceFile,
        actual: match.sourceFile
      });
    }
    if (stored.fileSha256 !== match.fileSha256) {
      snapshotDrift("fileSha256", `Snapshot file hash changed for ${key}`, { key });
    }
    if (stored.generationFingerprint && stored.generationFingerprint !== match.generationFingerprint) {
      snapshotDrift("generationFingerprint", `Snapshot generation fingerprint changed for ${key}`, { key });
    }
    if (stored.versionFingerprint && stored.versionFingerprint !== match.versionFingerprint) {
      snapshotDrift("versionFingerprint", `Snapshot version fingerprint changed for ${key}`, { key });
    }
    if (stored.approvalFingerprint && stored.approvalFingerprint !== match.approvalFingerprint) {
      snapshotDrift("approvalFingerprint", `Snapshot approval fingerprint changed for ${key}`, { key });
    }
  }
  return fresh;
}
