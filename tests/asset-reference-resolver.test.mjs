import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
  STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
  preflightGenerationRequest
} from "../server/generation-composer.js";
import {
  findExactAssetVersion,
  resolveStillsReferences,
  revalidateStillsSnapshot
} from "../server/asset-reference-resolver.js";

function writeAssetFile(assetDir, fileName, contents) {
  const relative = String(fileName).replace(/\\/g, "/");
  const abs = path.join(assetDir, ...relative.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const buffer = Buffer.from(contents);
  fs.writeFileSync(abs, buffer);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function makeHarness() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stills-resolver-"));
  const slug = "stills_test";
  const assetDir = path.join(projectsRoot, slug, "media", "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  return {
    projectsRoot,
    slug,
    assetDir,
    close() {
      fs.rmSync(projectsRoot, { recursive: true, force: true });
    }
  };
}

function versionRecord(v, file, extra = {}) {
  return { v, file, files: [file], mediaType: "image", ...extra };
}

function projectWithAssets(harness, items, settings = {}) {
  return {
    slug: harness.slug,
    projectsRoot: harness.projectsRoot,
    settings: { skipApproval: true, skipScreenplay: true, ...settings },
    assets: { items }
  };
}

function pin(assetId, order, extra = {}) {
  return { assetId, assetVersion: 1, role: "identity", order, ...extra };
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("client file, comfyFile, and sourceAssetFile pins are rejected", () => {
  const harness = makeHarness();
  try {
    const file = "character-adam.v1.png";
    writeAssetFile(harness.assetDir, file, "adam-v1");
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, file)]
    }]);
    const required = pin("character-adam", 1);

    assertCode(() => resolveStillsReferences(project, [{ ...required, file: "forged.png" }]), "client_owned_file_rejected");
    assertCode(() => resolveStillsReferences(project, [{ ...required, comfyFile: "forged.png" }]), "client_owned_file_rejected");
    assertCode(() => resolveStillsReferences(project, [{ ...required, sourceAssetFile: "forged.png" }]), "client_owned_file_rejected");
    assertCode(() => resolveStillsReferences(project, [{ ...required, disk: "C:/forged.png" }]), "client_owned_file_rejected");
    assertCode(() => resolveStillsReferences(project, [{ ...required, path: "../escape.png" }]), "client_owned_file_rejected");
    assertCode(() => resolveStillsReferences(project, [{ ...required, absolutePath: "C:/forged.png" }]), "client_owned_file_rejected");
  } finally {
    harness.close();
  }
});

test("missing version is a hard failure with no newest or activeVersion fallback", () => {
  const harness = makeHarness();
  try {
    writeAssetFile(harness.assetDir, "adam.v1.png", "v1");
    writeAssetFile(harness.assetDir, "adam.v3.png", "v3");
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 3,
      versions: [versionRecord(1, "adam.v1.png"), versionRecord(3, "adam.v3.png")]
    }]);

    assert.equal(findExactAssetVersion(project.assets.items[0], 2), null);
    assert.equal(findExactAssetVersion(project.assets.items[0], 9), null);
    assert.equal(findExactAssetVersion(project.assets.items[0], 3)?.file, "adam.v3.png");
    assert.equal(findExactAssetVersion(project.assets.items[0], 1)?.file, "adam.v1.png");

    assertCode(
      () => resolveStillsReferences(project, [pin("character-adam", 1, { assetVersion: 2 })]),
      "missing_asset_version"
    );
    assertCode(
      () => resolveStillsReferences(project, [pin("character-adam", 1, { assetVersion: 9 })]),
      "missing_asset_version"
    );
    assertCode(
      () => resolveStillsReferences(project, [{ assetId: "character-adam", role: "identity", order: 1 }]),
      "invalid_asset_version"
    );

    const exact = resolveStillsReferences(project, [pin("character-adam", 1, { assetVersion: 1 })]);
    assert.equal(exact[0].assetVersion, 1);
    assert.equal(exact[0].sourceFile, "adam.v1.png");
    assert.notEqual(exact[0].sourceFile, "adam.v3.png");
  } finally {
    harness.close();
  }
});

test("unapproved versions are rejected even when the exact file exists", () => {
  const harness = makeHarness();
  try {
    writeAssetFile(harness.assetDir, "adam.v1.png", "v1");
    writeAssetFile(harness.assetDir, "adam.v2.png", "v2");
    const items = [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "adam.v1.png")]
    }];
    const unapproved = projectWithAssets(harness, items, { skipApproval: false });
    assertCode(
      () => resolveStillsReferences(unapproved, [pin("character-adam", 1)]),
      "unapproved_asset_version"
    );

    const approvedExact = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "adam.v1.png")],
      approval: { status: "approved", activeVersion: 1 }
    }], { skipApproval: false });
    assert.equal(resolveStillsReferences(approvedExact, [pin("character-adam", 1)])[0].assetVersion, 1);

    const approvedOther = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 2,
      versions: [versionRecord(1, "adam.v1.png"), versionRecord(2, "adam.v2.png")],
      approval: { status: "approved", activeVersion: 2 }
    }], { skipApproval: false });
    assertCode(
      () => resolveStillsReferences(approvedOther, [pin("character-adam", 1, { assetVersion: 1 })]),
      "unapproved_asset_version"
    );

    const approvalDriftedFromActive = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 2,
      versions: [versionRecord(1, "adam.v1.png"), versionRecord(2, "adam.v2.png")],
      approval: { status: "approved", activeVersion: 1 }
    }], { skipApproval: false });
    assertCode(
      () => resolveStillsReferences(approvalDriftedFromActive, [pin("character-adam", 1, { assetVersion: 1 })]),
      "unapproved_asset_version"
    );
  } finally {
    harness.close();
  }
});

test("explicit 1-based order is preserved and is not sorted by filename", () => {
  const harness = makeHarness();
  try {
    writeAssetFile(harness.assetDir, "zzz-last-name.png", "zzz");
    writeAssetFile(harness.assetDir, "aaa-first-name.png", "aaa");
    const project = projectWithAssets(harness, [
      { id: "character-zeta", activeVersion: 1, versions: [versionRecord(1, "zzz-last-name.png")] },
      { id: "character-alpha", activeVersion: 1, versions: [versionRecord(1, "aaa-first-name.png")] }
    ]);
    const snapshots = resolveStillsReferences(project, [
      pin("character-alpha", 2),
      pin("character-zeta", 1)
    ]);
    assert.deepEqual(snapshots.map((entry) => entry.assetId), ["character-zeta", "character-alpha"]);
    assert.deepEqual(snapshots.map((entry) => entry.order), [1, 2]);
    assert.deepEqual(snapshots.map((entry) => entry.sourceFile), ["zzz-last-name.png", "aaa-first-name.png"]);
    assertCode(
      () => resolveStillsReferences(project, [pin("character-zeta", 1), pin("character-alpha", 1)]),
      "duplicate_reference_order"
    );
  } finally {
    harness.close();
  }
});

test("resolved stills snapshots are immutable, hashed from disk, and revalidate until provenance drifts", () => {
  const harness = makeHarness();
  try {
    const sha = writeAssetFile(harness.assetDir, "adam.v1.png", "adam-bytes");
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "adam.v1.png")],
      approval: {
        status: "approved",
        activeVersion: 1,
        generationFingerprint: "g".repeat(64),
        versionFingerprint: "v".repeat(64)
      }
    }]);
    const snapshots = resolveStillsReferences(project, [pin("character-adam", 1)]);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].type, "image");
    assert.equal(snapshots[0].sourceFile, "adam.v1.png");
    assert.equal(snapshots[0].fileSha256, sha);
    assert.equal(snapshots[0].generationFingerprint, "g".repeat(64));
    assert.equal(snapshots[0].versionFingerprint, "v".repeat(64));
    assert.equal(Object.isFrozen(snapshots), true);
    assert.equal(Object.isFrozen(snapshots[0]), true);
    assert.throws(() => { snapshots[0].sourceFile = "changed.png"; }, TypeError);

    const again = revalidateStillsSnapshot(project, snapshots);
    assert.equal(again[0].fileSha256, sha);

    fs.writeFileSync(path.join(harness.assetDir, "adam.v1.png"), "tampered");
    assertCode(() => revalidateStillsSnapshot(project, snapshots), "snapshot_drift");

    writeAssetFile(harness.assetDir, "adam.v1.png", "adam-bytes");
    const revoked = structuredClone(project.assets.items);
    for (const item of revoked) item.approval = { status: "revoked", activeVersion: 1 };
    const unapproved = projectWithAssets(harness, revoked, { skipApproval: false });
    assertCode(() => revalidateStillsSnapshot(unapproved, snapshots), "unapproved_asset_version");
  } finally {
    harness.close();
  }
});

test("subfolder source files keep relative provenance and stay inside media/assets", () => {
  const harness = makeHarness();
  try {
    const sha = writeAssetFile(harness.assetDir, "imported/adam.v1.png", "imported-adam");
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "imported/adam.v1.png")]
    }]);
    const snapshots = resolveStillsReferences(project, [pin("character-adam", 1)]);
    assert.equal(snapshots[0].sourceFile, "imported/adam.v1.png");
    assert.equal(snapshots[0].fileSha256, sha);
  } finally {
    harness.close();
  }
});

test("manifest SHA-256 that does not match disk fails closed", () => {
  const harness = makeHarness();
  try {
    writeAssetFile(harness.assetDir, "adam.v1.png", "adam-bytes");
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "adam.v1.png", {
        fileHashes: [{ file: "adam.v1.png", sha256: "0".repeat(64), bytes: 10 }]
      })]
    }]);
    assertCode(() => resolveStillsReferences(project, [pin("character-adam", 1)]), "file_hash_mismatch");
  } finally {
    harness.close();
  }
});

test("path-escape source files and missing disks fail closed", () => {
  const harness = makeHarness();
  try {
    const project = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "../../escape.png")]
    }]);
    assertCode(() => resolveStillsReferences(project, [pin("character-adam", 1)]), "path_escape");

    const missing = projectWithAssets(harness, [{
      id: "character-adam",
      activeVersion: 1,
      versions: [versionRecord(1, "no-such.png")]
    }]);
    assertCode(() => resolveStillsReferences(missing, [pin("character-adam", 1)]), "missing_source_file");
  } finally {
    harness.close();
  }
});

test("generation-composer rejects client-owned path fields without using versions.at(-1)", () => {
  const project = {
    slug: "composer_test",
    settings: { fps: 24, width: 768, height: 320 },
    assets: {
      items: [{
        id: "character-adam",
        name: "Adam",
        status: "generated",
        mediaType: "image",
        activeVersion: 1,
        versions: [{
          v: 1,
          file: "character-adam.v1.png",
          files: ["character-adam.v1.png"],
          mediaType: "image",
          fileHashes: [{ file: "character-adam.v1.png", sha256: "a".repeat(64), bytes: 1000 }]
        }]
      }]
    }
  };
  const request = (extra) => ({
    schemaVersion: 1,
    outputKind: "video",
    workflowId: STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
    promptText: "Adam walks",
    references: [{ assetId: "character-adam", assetVersion: 1, role: "identity", order: 1, ...extra }],
    unresolvedMentions: [],
    options: { durationSec: 5, fps: 24, width: 768, height: 320 }
  });

  const comfy = preflightGenerationRequest(project, request({ comfyFile: "forged.png" }));
  assert.equal(comfy.ok, false);
  assert.ok(comfy.errors.some((error) => error.code === "client_owned_file_rejected"));

  const source = preflightGenerationRequest(project, request({ sourceAssetFile: "forged.png" }));
  assert.equal(source.ok, false);
  assert.ok(source.errors.some((error) => error.code === "client_owned_file_rejected"));

  const missing = preflightGenerationRequest(project, request({ assetVersion: 9 }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.code === "stale_asset_version" || error.code === "missing_asset_version"));
  assert.equal(missing.resolvedReferences.some((reference) => reference.assetVersion === 1), false);

  const activeMissing = {
    ...project,
    assets: {
      items: [{
        ...project.assets.items[0],
        activeVersion: 9,
        versions: project.assets.items[0].versions
      }]
    }
  };
  const noFallback = preflightGenerationRequest(activeMissing, request({ assetVersion: 9 }));
  assert.equal(noFallback.ok, false);
  assert.ok(noFallback.errors.some((error) => error.code === "missing_asset_version"));
  assert.equal(noFallback.resolvedReferences.some((reference) => reference.assetVersion === 1), false);

  const stillsFile = preflightGenerationRequest(project, {
    schemaVersion: 1,
    outputKind: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    promptText: "Adam still",
    references: [{ assetId: "character-adam", assetVersion: 1, role: "identity", order: 1, file: "forged.png" }],
    unresolvedMentions: [],
    options: { aspectRatio: "16:9" }
  });
  assert.equal(stillsFile.ok, false);
  assert.ok(stillsFile.errors.some((error) => error.code === "client_owned_file_rejected"));
});
