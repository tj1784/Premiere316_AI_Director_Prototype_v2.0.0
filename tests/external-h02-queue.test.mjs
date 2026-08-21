import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  H02_EXTERNAL_QUEUE_JOB_ID,
  H02_TIMING_V3_RETRY_PLAN_FILE,
  H02_TIMING_V3_STAGING_ROOT,
  H02_TIMING_V4_STAGING_ROOT,
  isExternalQueueJobId,
  listExternalQueueJobs,
  readExternalH02DialogueCues,
  readExternalH02QueueJob
} from "../server/external-h02-queue.js";

const TIMING_V3_VARIANT = "H02_QWEN_TIMING_V3_TARGETED";
const TIMING_V4_VARIANT = "H02_QWEN_TIMING_V4_WINNER_SELECTION";
const TIMING_V3_PROFILE = "H02_QWEN_COMPLETE_REVIEW_SET_V1";
const TIMING_V3_RETRY_PLAN_SHA = "bbe21a96b0e911122b03266d92bece03b843a0e03f21e6c6fa6deee5f3895585";
const TIMING_V3_AUDIT_SHA = "2f55f13c097ec7d04138c5e3f2aaa2cde5f47504bac83ea2a2c6a596b5edaa86";
const TIMING_V3_SOURCE_LEDGER_SHA = "efb29dce942e95c0392bc97e6200580201ccdd8c9d60430c9d4fc3846c0b3d14";
const TIMING_V3_GENERATION_PLAN_SHA = "f4d13778bfef34a5b6edfaeacbe41fba5826f14331829d294a0b14ebf06cb037";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-queue-"));
  const qa = path.join(root, "QA");
  const manifests = path.join(root, "MANIFESTS");
  const masters = path.join(root, "MASTER_WAV");
  const alternates = path.join(root, "ALTERNATE_TAKES");
  const parents = path.join(qa, "_PARENT_GENERATIONS");
  for (const directory of [qa, manifests, masters, alternates, parents]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return { root, qa, manifests, masters, alternates, parents };
}

function json(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function canonicalJsonSha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)), "utf8")
    .digest("hex");
}

function fileTreeSnapshot(root, relativeTargets) {
  return relativeTargets.map((relativePath) => {
    const target = path.join(root, ...relativePath.split("/"));
    if (!fs.existsSync(target)) return { relativePath, kind: "absent", files: [] };
    const targetStat = fs.statSync(target);
    if (targetStat.isFile()) {
      return {
        relativePath,
        kind: "file",
        files: [{ path: ".", bytes: targetStat.size, sha256: sha256File(target) }]
      };
    }
    const files = [];
    const pending = [target];
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        if (entry.isFile()) {
          const entryStat = fs.statSync(entryPath);
          files.push({
            path: path.relative(target, entryPath).split(path.sep).join("/"),
            bytes: entryStat.size,
            sha256: sha256File(entryPath)
          });
        }
      }
    }
    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return { relativePath, kind: "directory", files };
  });
}

function writeManifest(files) {
  json(path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json"), {
    packageCounts: { cues: 2 },
    rendererTarget: { wrapperSeeds: [42, 43, 44] },
    cues: [
      {
        cueId: "D001",
        segmentId: "H02-S03-C01-SEG02A",
        speaker: "TORTURER",
        exactDialogue: "Forsake the promise.",
        performanceDirection: "Low and judicial.",
        targetVoiceDurationSec: 7,
        targetVideoDurationSec: 8,
        qwenRender: { wrapperSeeds: [42, 43, 44] },
        outputs: { masterFilename: "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav" }
      },
      {
        cueId: "D002",
        segmentId: "H02-S03-C01-SEG02B",
        speaker: "TORTURER",
        exactDialogue: "One word.",
        performanceDirection: "Continue without resetting.",
        targetVoiceDurationSec: 8.5,
        targetVideoDurationSec: 9.5,
        qwenRender: { wrapperSeeds: [42, 43, 44] },
        outputs: { masterFilename: "D002_H02-S03-C01-SEG02B_TORTURER_MASTER.wav" }
      }
    ]
  });
}

function writeValidatedTimingV2(files) {
  const runId = "b".repeat(32);
  const generationPlanSha256 = "a".repeat(64);
  const staging = path.join(files.root, "TIMING_V2_STAGING");
  const stagingTakes = path.join(staging, "AUDITION_TAKES");
  const stagingManifests = path.join(staging, "MANIFESTS");
  const stagingQa = path.join(staging, "QA");
  for (const directory of [stagingTakes, stagingManifests, stagingQa]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const units = {};
  const alignmentItems = {};
  const outputs = {};
  for (const seed of [42, 43, 44]) {
    const parent = `P01:seed-${seed}`;
    units[parent] = { status: "done", cueIds: ["D001", "D002"] };
    alignmentItems[parent] = { status: "pass" };
    for (const cueId of ["D001", "D002"]) {
      const file = path.join(stagingTakes, `${cueId}_seed-${seed}.wav`);
      fs.writeFileSync(file, "timing");
      outputs[`${cueId}:seed-${seed}`] = { status: "done", cueId, seed, file };
    }
  }
  const sourceTimingTextPlanFile = path.join(stagingManifests, "H02_QWEN_TIMING_V2_TEXT_PLAN_SOURCE.json");
  json(sourceTimingTextPlanFile, { variant: "H02_QWEN_TIMING_V2", runId, plan: "exact reviewed timing text" });
  const auditedFfmpegFile = path.join(staging, "audited-ffmpeg.exe");
  writeFile(auditedFfmpegFile, "audited ffmpeg fixture");
  const ledgerFile = path.join(stagingManifests, "H02_QWEN_TIMING_V2_BATCH_STATE.json");
  json(ledgerFile, {
    variant: "H02_QWEN_TIMING_V2",
    outputRoot: staging,
    generationPlanSha256,
    activeRunId: runId,
    units,
    outputs,
    auditionSetValidated: true,
    auditionFileCount: 6
  });
  json(path.join(stagingQa, "H02_QWEN_TIMING_V2_ALIGNMENT_RESULTS.json"), { items: alignmentItems });
  const readyFile = path.join(stagingQa, "READY_FOR_CANONICAL_REVIEW.json");
  json(readyFile, {
    status: "PASS",
    variant: "H02_QWEN_TIMING_V2",
    parentCount: 3,
    takeCount: 6,
    exactAsrPassCount: 3,
    timingQaPassCount: 6,
    canonicalV1Mutated: false,
    runId,
    generationPlanSha256,
    ledgerFile,
    ledgerSha256: sha256File(ledgerFile),
    validatedAt: "2026-08-21T10:00:01Z"
  });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "awaiting_review",
    supervisorPid: 1234,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: staging,
    stagingReady: true,
    exitCode: 0,
    readOnly: true,
    external: true,
    usesComfyUiForSynthesis: false,
    canonicalV1MutationAllowed: false,
    runId,
    updatedAt: "2026-08-21T10:00:02Z",
    message: "awaiting explicit review/promotion"
  });
  return { staging, stagingTakes, stagingManifests, stagingQa, ledgerFile, readyFile, runId };
}

const TIMING_V2_PROMOTION_TARGETS = [
  "ALTERNATE_TAKES",
  "QA/_PARENT_GENERATIONS",
  "VOICE_REFERENCES_USED/DERIVED_TIMING_V2",
  "MANIFESTS/H02_QWEN_BATCH_STATE.json",
  "QA/H02_QWEN_ALIGNMENT_PLAN.json",
  "QA/H02_QWEN_ALIGNMENT_RESULTS.json",
  "MANIFESTS/H02_QWEN_TIMING_V2_SLOW_REFERENCES.json",
  "MANIFESTS/H02_QWEN_TIMING_V2_TEXT_PLAN.json",
  "QA/H02_QWEN_TIMING_V2_SLOW_REF_ASR_PLAN.json",
  "QA/H02_QWEN_TIMING_V2_SLOW_REF_ASR_RESULTS.json",
  "QA/H02_QWEN_TIMING_V2_TARGET_QA.json",
  "QA/H02_QWEN_TIMING_V2_TARGET_QA.csv",
  "QA/H02_QWEN_TIMING_V2_READY_FOR_CANONICAL_REVIEW.json",
  "MANIFESTS/H02_QWEN_TIMING_V2_PROMOTION.json"
];

function writeFile(file, value = "test") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function writePromotionReadyTimingV2(files) {
  const runId = "e".repeat(32);
  const generationPlanSha256 = "f".repeat(64);
  const staging = path.join(files.root, "TIMING_V2_STAGING");
  const stagingParents = path.join(staging, "PARENT_GENERATIONS");
  const stagingTakes = path.join(staging, "AUDITION_TAKES");
  const stagingManifests = path.join(staging, "MANIFESTS");
  const stagingQa = path.join(staging, "QA");
  for (const directory of [stagingParents, stagingTakes, stagingManifests, stagingQa]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const cues = Array.from({ length: 34 }, (_, index) => {
    const cueNumber = index + 1;
    const cueId = `D${String(cueNumber).padStart(3, "0")}`;
    const segmentId = `H02-S03-C${String(Math.ceil(cueNumber / 3)).padStart(2, "0")}-SEG${String(cueNumber).padStart(2, "0")}`;
    return {
      cueId,
      segmentId,
      speaker: cueNumber % 2 ? "ADAM" : "EVE",
      exactDialogue: `Exact authoritative dialogue cue ${cueNumber}.`,
      performanceDirection: "Restrained and grave.",
      targetVoiceDurationSec: 4,
      targetVideoDurationSec: 6,
      qwenRender: { wrapperSeeds: [42, 43, 44] },
      outputs: { masterFilename: `${cueId}_${segmentId}_${cueNumber % 2 ? "ADAM" : "EVE"}_MASTER.wav` }
    };
  });
  json(path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json"), {
    packageCounts: { cues: 34 },
    rendererTarget: { wrapperSeeds: [42, 43, 44] },
    cues
  });

  const pairedGroups = Array.from({ length: 10 }, (_, index) => [
    cues[index * 2].cueId,
    cues[index * 2 + 1].cueId
  ]);
  const singleGroups = cues.slice(20).map((cue) => [cue.cueId]);
  const groups = [...pairedGroups, ...singleGroups];
  assert.equal(groups.length, 24);
  const units = {};
  const outputs = {};
  const alignmentItems = {};
  for (const [groupIndex, cueIds] of groups.entries()) {
    for (const seed of [42, 43, 44]) {
      const key = `P${String(groupIndex + 1).padStart(2, "0")}:seed-${seed}`;
      const parentFile = path.join(stagingParents, `${key.replace(":", "_")}.wav`);
      writeFile(parentFile, `parent ${key}`);
      units[key] = { key, status: "done", cueIds, file: parentFile };
      alignmentItems[key] = { status: "pass" };
      for (const cueId of cueIds) {
        const takeFile = path.join(stagingTakes, `${cueId}_seed-${seed}.wav`);
        writeFile(takeFile, `take ${cueId} ${seed}`);
        outputs[`${cueId}:seed-${seed}`] = { status: "done", cueId, seed, file: takeFile };
      }
    }
  }
  assert.equal(Object.keys(units).length, 72);
  assert.equal(Object.keys(outputs).length, 102);

  const ledgerFile = path.join(stagingManifests, "H02_QWEN_TIMING_V2_BATCH_STATE.json");
  json(ledgerFile, {
    variant: "H02_QWEN_TIMING_V2",
    outputRoot: staging,
    generationPlanSha256,
    activeRunId: runId,
    units,
    outputs,
    auditionSetValidated: true,
    auditionFileCount: 102,
    timingTextPlan: { file: sourceTimingTextPlanFile, sha256: sha256File(sourceTimingTextPlanFile) }
  });
  const alignmentPlanFile = path.join(stagingQa, "H02_QWEN_TIMING_V2_ALIGNMENT_PLAN.json");
  const alignmentFile = path.join(stagingQa, "H02_QWEN_TIMING_V2_ALIGNMENT_RESULTS.json");
  const timingQaJsonFile = path.join(stagingQa, "TIMING_V2_TARGET_QA.json");
  const timingQaCsvFile = path.join(stagingQa, "TIMING_V2_TARGET_QA.csv");
  const slowReferenceManifestFile = path.join(stagingManifests, "TIMING_V2_VOICE_REFERENCE_MANIFEST.json");
  const slowReferenceAsrPlanFile = path.join(stagingQa, "H02_QWEN_TIMING_V2_SLOW_REF_ASR_PLAN.json");
  const slowReferenceAsrFile = path.join(stagingQa, "H02_QWEN_TIMING_V2_SLOW_REF_ASR_RESULTS.json");
  json(alignmentPlanFile, { variant: "H02_QWEN_TIMING_V2", runId, parents: 72 });
  json(alignmentFile, { variant: "H02_QWEN_TIMING_V2", runId, allPassed: true, items: alignmentItems });
  json(timingQaJsonFile, { status: "PASS", runId, takeCount: 102 });
  writeFile(timingQaCsvFile, "cue_id,status\nALL,PASS\n");
  json(slowReferenceManifestFile, {
    variant: "H02_QWEN_TIMING_V2", runId, count: 6,
    ffmpegProvenance: { file: auditedFfmpegFile, sha256: sha256File(auditedFfmpegFile) }
  });
  json(slowReferenceAsrPlanFile, { variant: "H02_QWEN_TIMING_V2", runId, count: 6 });
  json(slowReferenceAsrFile, { variant: "H02_QWEN_TIMING_V2", runId, status: "PASS", count: 6 });

  const readyFile = path.join(stagingQa, "READY_FOR_CANONICAL_REVIEW.json");
  json(readyFile, {
    status: "PASS",
    variant: "H02_QWEN_TIMING_V2",
    parentCount: 72,
    takeCount: 102,
    exactAsrPassCount: 72,
    timingQaPassCount: 102,
    canonicalV1Mutated: false,
    runId,
    generationPlanSha256,
    ledgerFile,
    ledgerSha256: sha256File(ledgerFile),
    validatedAt: "2026-08-21T10:00:01Z"
  });
  const statusFile = path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json");
  json(statusFile, {
    state: "awaiting_review",
    supervisorPid: 1234,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: staging,
    stagingReady: true,
    exitCode: 0,
    readOnly: true,
    external: true,
    usesComfyUiForSynthesis: false,
    canonicalV1MutationAllowed: false,
    runId,
    updatedAt: "2026-08-21T10:00:02Z",
    message: "awaiting explicit review/promotion"
  });

  const cueSheetFile = path.join(files.manifests, "AUTHORITATIVE_PACKAGE", "H02_INDEXTTS25_CUE_SHEET.csv");
  const voiceMappingFile = path.join(files.manifests, "VOICE_MAPPING.csv");
  writeFile(cueSheetFile, "cue_id,dialogue\nD001,Exact authoritative dialogue cue 1.\n");
  writeFile(voiceMappingFile, "speaker,reference\nADAM,ADAM_LOCK.wav\n");

  const canonicalTimingTextPlanFile = path.join(files.manifests, "H02_QWEN_TIMING_V2_TEXT_PLAN.json");
  fs.copyFileSync(sourceTimingTextPlanFile, canonicalTimingTextPlanFile);
  const sourceHashes = {
    status: sha256File(statusFile),
    readyMarker: sha256File(readyFile),
    ledger: sha256File(ledgerFile),
    alignmentPlan: sha256File(alignmentPlanFile),
    alignment: sha256File(alignmentFile),
    timingQaJson: sha256File(timingQaJsonFile),
    timingQaCsv: sha256File(timingQaCsvFile),
    slowReferenceManifest: sha256File(slowReferenceManifestFile),
    slowReferenceAsrPlan: sha256File(slowReferenceAsrPlanFile),
    slowReferenceAsr: sha256File(slowReferenceAsrFile),
    timingTextPlan: sha256File(sourceTimingTextPlanFile),
    cueSheet: sha256File(cueSheetFile),
    voiceMapping: sha256File(voiceMappingFile),
    auditedFfmpeg: sha256File(auditedFfmpegFile)
  };
  const promotionFingerprint = canonicalJsonSha256({ runId, sourceHashes });
  const promotionId = `${runId}-${promotionFingerprint.slice(0, 16)}`;
  const transactionId = `tx-${promotionId}`;

  const canonicalAlternates = path.join(files.root, "ALTERNATE_TAKES");
  const canonicalParents = path.join(files.qa, "_PARENT_GENERATIONS");
  const derivedReferences = path.join(files.root, "VOICE_REFERENCES_USED", "DERIVED_TIMING_V2");
  for (const output of Object.values(outputs)) {
    writeFile(path.join(canonicalAlternates, path.basename(output.file)), `promoted ${path.basename(output.file)}`);
  }
  for (const unit of Object.values(units)) {
    writeFile(path.join(canonicalParents, path.basename(unit.file)), `promoted ${path.basename(unit.file)}`);
  }
  for (let index = 1; index <= 6; index += 1) {
    writeFile(path.join(derivedReferences, `VOICE_${index}_TIMING_V2.wav`), `reference ${index}`);
  }

  const canonicalLedgerFile = path.join(files.manifests, "H02_QWEN_BATCH_STATE.json");
  const canonicalUnits = Object.fromEntries(Object.entries(units).map(([key, unit]) => [key, {
    ...unit,
    file: path.join(canonicalParents, path.basename(unit.file))
  }]));
  const canonicalOutputs = Object.fromEntries(Object.entries(outputs).map(([key, output]) => [key, {
    ...output,
    file: path.join(canonicalAlternates, path.basename(output.file))
  }]));
  json(canonicalLedgerFile, {
    variant: "H02_QWEN_TIMING_V2",
    outputRoot: files.root,
    generationPlanSha256,
    activeRunId: runId,
    cues,
    units: canonicalUnits,
    outputs: canonicalOutputs,
    auditionSetValidated: true,
    auditionFileCount: 102,
    promotion: { runId, promotionId, transactionId, sourceLedgerSha256: sourceHashes.ledger, sourceStagingRoot: staging }
  });
  const canonicalAlignmentPlanFile = path.join(files.qa, "H02_QWEN_ALIGNMENT_PLAN.json");
  const canonicalAlignmentFile = path.join(files.qa, "H02_QWEN_ALIGNMENT_RESULTS.json");
  const canonicalSlowReferenceManifestFile = path.join(files.manifests, "H02_QWEN_TIMING_V2_SLOW_REFERENCES.json");
  const canonicalSlowReferenceAsrPlanFile = path.join(files.qa, "H02_QWEN_TIMING_V2_SLOW_REF_ASR_PLAN.json");
  const canonicalSlowReferenceAsrFile = path.join(files.qa, "H02_QWEN_TIMING_V2_SLOW_REF_ASR_RESULTS.json");
  const canonicalTimingQaJsonFile = path.join(files.qa, "H02_QWEN_TIMING_V2_TARGET_QA.json");
  const canonicalTimingQaCsvFile = path.join(files.qa, "H02_QWEN_TIMING_V2_TARGET_QA.csv");
  const canonicalReadyFile = path.join(files.qa, "H02_QWEN_TIMING_V2_READY_FOR_CANONICAL_REVIEW.json");
  json(canonicalAlignmentPlanFile, { variant: "H02_QWEN_TIMING_V2", runId, parents: 72 });
  json(canonicalAlignmentFile, { variant: "H02_QWEN_TIMING_V2", runId, allPassed: true, items: alignmentItems });
  json(canonicalSlowReferenceManifestFile, { variant: "H02_QWEN_TIMING_V2", runId, count: 6 });
  json(canonicalSlowReferenceAsrPlanFile, { variant: "H02_QWEN_TIMING_V2", runId, count: 6 });
  json(canonicalSlowReferenceAsrFile, { variant: "H02_QWEN_TIMING_V2", runId, status: "PASS", count: 6 });
  json(canonicalTimingQaJsonFile, { status: "PASS", runId, takeCount: 102 });
  writeFile(canonicalTimingQaCsvFile, "cue_id,status\nALL,PASS\n");
  json(canonicalReadyFile, {
    status: "PASS",
    variant: "H02_QWEN_TIMING_V2",
    canonicalPromotionComplete: true,
    runId,
    promotionId,
    transactionId,
    canonicalV1Mutated: false,
    sourceReadyMarkerSha256: sourceHashes.readyMarker,
    ledgerFile: canonicalLedgerFile,
    ledgerSha256: sha256File(canonicalLedgerFile)
  });

  const payloadSnapshot = fileTreeSnapshot(files.root, TIMING_V2_PROMOTION_TARGETS.slice(0, -1));
  const canonicalPayloadSnapshotSha256 = canonicalJsonSha256(payloadSnapshot);
  const semanticVerification = {
    status: "PASS",
    verifierContract: "H02_TIMING_V2_PROMOTION_SEMANTIC_V2",
    ledgerSha256: sha256File(canonicalLedgerFile),
    alignmentPlanSha256: sha256File(canonicalAlignmentPlanFile),
    alignmentSha256: sha256File(canonicalAlignmentFile),
    timingQaJsonSha256: sha256File(canonicalTimingQaJsonFile),
    timingQaCsvSha256: sha256File(canonicalTimingQaCsvFile),
    slowReferenceManifestSha256: sha256File(canonicalSlowReferenceManifestFile),
    slowReferenceAsrPlanSha256: sha256File(canonicalSlowReferenceAsrPlanFile),
    slowReferenceAsrSha256: sha256File(canonicalSlowReferenceAsrFile),
    timingTextPlanSha256: sha256File(canonicalTimingTextPlanFile),
    readyMarkerSha256: sha256File(canonicalReadyFile),
    canonicalPayloadSnapshotSha256,
    takeDerivation: {
      status: "PASS",
      parentsVerified: 72,
      takesVerified: 102,
      targetPeakDbfs: -6,
      pcm24AbsoluteTolerance: 2.5 / (2 ** 23),
      maximumObservedAbsoluteError: 0.000000119209,
      resampler: {
        sampleRate: 48000,
        lowpassFilterWidth: 64,
        rolloff: 0.9475937167399596,
        method: "sinc_interp_kaiser",
        beta: 14.769656459379492
      }
    }
  };
  const backupDirectory = path.join(files.qa, "_TIMING_V2_PROMOTION_BACKUPS", transactionId);
  const journalFile = path.join(backupDirectory, "BACKUP_MANIFEST.json");
  const promotionFile = path.join(files.manifests, "H02_QWEN_TIMING_V2_PROMOTION.json");
  const promotion = {
    schemaVersion: 1,
    artifactType: "H02_QWEN_TIMING_V2_CANONICAL_PROMOTION",
    status: "COMMITTED",
    variant: "H02_QWEN_TIMING_V2",
    runId,
    promotionId,
    transactionId,
    promotionFingerprint,
    sourceStagingRoot: staging,
    authoritativeCueSheetFile: cueSheetFile,
    voiceMappingFile,
    canonicalOutputRoot: files.root,
    backupDirectory,
    backupManifestFile: journalFile,
    sourceHashes,
    canonicalPayloadSnapshotSha256,
    counts: { cues: 34, parents: 72, takes: 102, slowReferences: 6 },
    originalPermanentReferencesPreserved: true,
    slowReferencesAreDerivedConditioningAssets: true,
    mastersTouched: false,
    finalZipTouched: false,
    projectOrServiceMutation: false,
    permanentAndDerivedReferenceProvenance: [
      ["TORTURER", "H02_TORTURER_LOCK"],
      ["ADAM", "H02_ADAM_LOCK"],
      ["EVE", "H02_EVE_LOCK"],
      ["MOSES", "H02_MOSES_LOCK"],
      ["DAVID", "H02_DAVID_LOCK"],
      ["JOHN", "H02_JOHN_LOCK"]
    ].map(([speaker, voiceLock]) => ({ speaker, voiceLock })),
    testMode: false,
    semanticVerification,
    createdAt: "2026-08-21T10:10:01Z"
  };
  json(promotionFile, promotion);
  const afterTargets = fileTreeSnapshot(files.root, TIMING_V2_PROMOTION_TARGETS);
  const journal = {
    schemaVersion: 1,
    artifactType: "H02_QWEN_TIMING_V2_RECOVERABLE_BACKUP",
    status: "COMMITTED",
    variant: "H02_QWEN_TIMING_V2",
    runId,
    promotionId,
    transactionId,
    canonicalOutputRoot: files.root,
    sourceStagingRoot: staging,
    backupDirectory,
    backupManifestFile: journalFile,
    targets: TIMING_V2_PROMOTION_TARGETS,
    beforeTargets: TIMING_V2_PROMOTION_TARGETS.map((relativePath) => ({ relativePath, kind: "absent", files: [] })),
    afterTargets,
    sourceHashes,
    canonicalPayloadSnapshotSha256,
    moves: {
      archivedTargets: [],
      installedTargets: TIMING_V2_PROMOTION_TARGETS,
      rolledBackInstalledTargets: [],
      restoredArchivedTargets: [],
      restoreMovedCurrentTargets: [],
      restoreRestoredOldTargets: [],
      restoreReturnedOldTargets: [],
      restoreReplacedPromotedTargets: []
    },
    pendingMove: null,
    journalSequence: 2,
    stateHistory: [
      { status: "PREPARED", at: "2026-08-21T10:09:58Z" },
      { status: "INSTALLING", at: "2026-08-21T10:09:59Z" },
      { status: "COMMITTED", at: "2026-08-21T10:10:01Z" }
    ],
    semanticVerification,
    committedAt: "2026-08-21T10:10:01Z"
  };
  fs.mkdirSync(backupDirectory, { recursive: true });
  json(journalFile, journal);

  return {
    runId,
    staging,
    ledgerFile,
    readyFile,
    statusFile,
    promotionFile,
    promotion,
    promotionId,
    transactionId,
    journalFile,
    journal,
    canonicalLedgerFile,
    canonicalAlignmentFile,
    canonicalPayloadSnapshotSha256
  };
}

function writeTimingV3Progress(files, { doneRegenerated = 5 } = {}) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-timing-v3-"));
  const parents = path.join(staging, "PARENT_GENERATIONS");
  const takes = path.join(staging, "AUDITION_TAKES");
  const manifests = path.join(staging, "MANIFESTS");
  const qa = path.join(staging, "QA");
  for (const directory of [parents, takes, manifests, qa]) fs.mkdirSync(directory, { recursive: true });
  const runId = "e".repeat(32);
  const units = {};
  const alignmentItems = {};
  for (let index = 0; index < 72; index += 1) {
    const seed = 42 + (index % 3);
    const key = `V3-${String(index + 1).padStart(3, "0")}:seed-${seed}`;
    const reused = index < 28;
    const done = reused || index < 28 + doneRegenerated;
    units[key] = {
      key,
      status: done ? "done" : index === 28 + doneRegenerated ? "generating" : "planned",
      retryAction: reused ? "reuse_v2_parent" : "regenerate_v3_targeted",
      cueIds: index < 3 ? ["D001", "D002"] : [`D${String(index + 1).padStart(3, "0")}`]
    };
    if (done) alignmentItems[key] = { status: "pass" };
  }
  json(path.join(manifests, "H02_QWEN_TIMING_V3_BATCH_STATE.json"), {
    variant: TIMING_V3_VARIANT,
    outputRoot: staging,
    generationPlanSha256: TIMING_V3_GENERATION_PLAN_SHA,
    timingV2MutationAllowed: false,
    units,
    outputs: {}
  });
  json(path.join(qa, "H02_QWEN_TIMING_V3_ALIGNMENT_RESULTS.json"), { items: alignmentItems });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    schemaVersion: 2,
    state: "running",
    variant: TIMING_V3_VARIANT,
    renderer: "standalone Qwen3-TTS Base TIMING_V3 targeted",
    stagingRoot: staging,
    runId,
    supervisorPid: 4321,
    canonicalV1MutationAllowed: false,
    timingV2MutationAllowed: false,
    updatedAt: "2026-08-21T13:00:00Z"
  });
  return { staging, parents, takes, manifests, qa, runId, units };
}

function writeTimingV4Progress(files, { doneRegenerated = 5 } = {}) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-timing-v4-"));
  const parents = path.join(staging, "PARENT_GENERATIONS");
  const takes = path.join(staging, "AUDITION_TAKES");
  const manifests = path.join(staging, "MANIFESTS");
  const qa = path.join(staging, "QA");
  for (const directory of [parents, takes, manifests, qa]) fs.mkdirSync(directory, { recursive: true });
  const runId = "9".repeat(32);
  const units = {};
  for (let index = 0; index < 72; index += 1) {
    const seed = 42 + (index % 3);
    const key = `V4-${String(index + 1).padStart(3, "0")}:seed-${seed}`;
    const reused = index < 57;
    const done = reused || index < 57 + doneRegenerated;
    units[key] = {
      key,
      status: done ? "done" : index === 57 + doneRegenerated ? "generating" : "planned",
      retryAction: reused ? "reuse_v3_parent" : "regenerate_v4_winner",
      cueIds: index < 3 ? ["D001", "D002"] : [`D${String(index + 1).padStart(3, "0")}`]
    };
  }
  json(path.join(manifests, "H02_QWEN_TIMING_V4_BATCH_STATE.json"), {
    variant: TIMING_V4_VARIANT,
    outputRoot: staging,
    timingV2MutationAllowed: false,
    timingV3MutationAllowed: false,
    units,
    outputs: {}
  });
  json(path.join(qa, "H02_QWEN_TIMING_V4_ALIGNMENT_RESULTS.json"), { items: {} });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    schemaVersion: 1,
    state: "running",
    variant: TIMING_V4_VARIANT,
    renderer: "standalone Qwen3-TTS Base V4 winner-selection compute",
    stagingRoot: staging,
    runId,
    supervisorPid: 4321,
    canonicalV1MutationAllowed: false,
    timingV2MutationAllowed: false,
    timingV3MutationAllowed: false,
    targetParentCount: 72,
    targetReuseParentCount: 57,
    targetRetryParentCount: 15,
    targetTakeCount: 102,
    updatedAt: "2026-08-21T15:00:00Z"
  });
  return { staging, parents, takes, manifests, qa, runId, units };
}

function writeValidatedTimingV3(files) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-timing-v3-valid-"));
  const parents = path.join(staging, "PARENT_GENERATIONS");
  const takes = path.join(staging, "AUDITION_TAKES");
  const manifests = path.join(staging, "MANIFESTS");
  const qa = path.join(staging, "QA");
  for (const directory of [parents, takes, manifests, qa]) fs.mkdirSync(directory, { recursive: true });
  const runId = "e".repeat(32);
  const retryPlanFile = path.join(staging, "H02_QWEN_TIMING_V3_TARGETED_RETRY_PLAN.json");
  fs.copyFileSync(H02_TIMING_V3_RETRY_PLAN_FILE, retryPlanFile);
  const retryPlan = JSON.parse(fs.readFileSync(retryPlanFile, "utf8"));
  const retryKeys = retryPlan.regenerateParentKeys.map(String);
  const unitKeys = [
    ...Array.from({ length: 28 }, (_, index) => `REUSE-${String(index + 1).padStart(3, "0")}:seed-${42 + (index % 3)}`),
    ...retryKeys
  ];
  assert.equal(unitKeys.length, 72);
  const units = {};
  const unitsBySeed = new Map([[42, []], [43, []], [44, []]]);
  for (const [index, key] of unitKeys.entries()) {
    const match = key.match(/:seed-(42|43|44)$/);
    const seed = match ? Number(match[1]) : 42 + (index % 3);
    const retryAction = retryKeys.includes(key) ? "regenerate_v3_targeted" : "reuse_v2_parent";
    const nativeSampleRate = 24000;
    const nativeFile = path.join(parents, `${key.replaceAll(":", "_")}.native-${nativeSampleRate}-f32.wav`);
    fs.writeFileSync(nativeFile, `v3-parent-${key}`);
    const nativeSha256 = sha256File(nativeFile);
    units[key] = {
      key,
      status: "done",
      seed,
      speaker: "TORTURER",
      savedVoice: "H02_TORTURER_LOCK",
      paired: false,
      cueIds: [],
      segmentIds: [],
      combinedText: "",
      firstText: "",
      secondText: null,
      generationText: "",
      generationTextSha256: "",
      retryAction,
      exactAsrPass: true,
      nativeFile,
      nativeSha256,
      nativeSampleRate,
      nativeFrames: 24000,
      nativeDurationSec: 1,
      sourceParentSha256: nativeSha256,
      lineage: {
        action: retryAction,
        sourceRunId: "e84197d94f5f469699907158957c7a26",
        sourceLedgerSha256: TIMING_V3_SOURCE_LEDGER_SHA,
        sourceParentSha256: nativeSha256,
        v3GenerationTextSha256: ""
      }
    };
    unitsBySeed.get(seed).push(key);
  }
  for (const seed of [42, 43, 44]) {
    const available = unitsBySeed.get(seed);
    for (let cueIndex = 0; cueIndex < 34; cueIndex += 1) {
      const cueId = `D${String(cueIndex + 1).padStart(3, "0")}`;
      units[available[cueIndex % available.length]].cueIds.push(cueId);
    }
  }
  for (const unit of Object.values(units)) {
    unit.segmentIds = unit.cueIds.map((cueId) => `SEG-${cueId}`);
    unit.paired = unit.cueIds.length === 2;
    const texts = unit.cueIds.map((cueId) => `Dialogue ${cueId}`);
    unit.firstText = texts[0];
    unit.secondText = texts[1] || null;
    unit.combinedText = texts.join(" ");
    unit.generationText = unit.combinedText;
    unit.generationTextSha256 = crypto.createHash("sha256").update(unit.generationText).digest("hex");
    unit.lineage.v3GenerationTextSha256 = unit.generationTextSha256;
    const words = unit.combinedText.toLowerCase().split(/\s+/);
    unit.asrExpectedWords = words;
    unit.asrObservedWords = words;
  }
  const compiledPlanFile = path.join(manifests, "H02_QWEN_TIMING_V3_COMPILED_PLAN.json");
  json(compiledPlanFile, {
    schemaVersion: 3,
    artifactType: "H02_QWEN_TIMING_V3_COMPILED_PLAN",
    variant: TIMING_V3_VARIANT,
    generationPlanSha256: TIMING_V3_GENERATION_PLAN_SHA,
    cues: Array.from({ length: 34 }, (_, index) => {
      const cueId = `D${String(index + 1).padStart(3, "0")}`;
      return {
        cue_id: cueId,
        segment_id: `SEG-${cueId}`,
        speaker: "TORTURER",
        dialogue: `Dialogue ${cueId}`,
        target_duration_sec: 1
      };
    }),
    units: Object.values(units).map((unit) => ({
      key: unit.key,
      seed: unit.seed,
      speaker: unit.speaker,
      savedVoice: unit.savedVoice,
      paired: unit.paired,
      cueIds: unit.cueIds,
      segmentIds: unit.segmentIds,
      combinedText: unit.combinedText,
      firstText: unit.firstText,
      secondText: unit.secondText,
      generationText: unit.generationText,
      generationTextSha256: unit.generationTextSha256,
      retryAction: unit.retryAction
    }))
  });
  const compiledPlanSha256 = sha256File(compiledPlanFile);
  const outputs = {};
  for (const [parentUnit, unit] of Object.entries(units)) {
    for (const cueId of unit.cueIds) {
      const seed = unit.seed;
      const key = `${cueId}:seed-${seed}`;
      const segmentId = `SEG-${cueId}`;
      const speaker = "TORTURER";
      const dialogue = `Dialogue ${cueId}`;
      const file = path.join(takes, `${cueId}_${segmentId}_${speaker}_TAKE_S${seed}.wav`);
      fs.writeFileSync(file, `v3-take-${key}`);
      outputs[key] = {
        status: "done",
        cueId,
        segmentId,
        speaker,
        seed,
        dialogue,
        parentUnit,
        parentFile: unit.nativeFile,
        parentSha256: unit.nativeSha256,
        file,
        sha256: sha256File(file),
        measuredDurationSec: 1,
        sampleRate: 48000,
        channels: 1,
        bitDepth: 24,
        codec: "pcm_s24le",
        limiterUsed: false,
        gainScope: "shared-parent",
        wordErrorCount: 0
      };
    }
  }
  assert.equal(Object.keys(outputs).length, 102);
  const ledgerFile = path.join(manifests, "H02_QWEN_TIMING_V3_BATCH_STATE.json");
  json(ledgerFile, {
    schemaVersion: 3,
    variant: TIMING_V3_VARIANT,
    outputRoot: staging,
    activeRunId: runId,
    currentValidationRunId: runId,
    generationPlanSha256: TIMING_V3_GENERATION_PLAN_SHA,
    compiledPlan: { file: compiledPlanFile, sha256: compiledPlanSha256 },
    canonicalV1MutationAllowed: false,
    timingV2MutationAllowed: false,
    reusedParentCount: 28,
    regeneratedParentCount: 44,
    auditionSetValidated: true,
    auditionFileCount: 102,
    units,
    outputs
  });
  const ledgerSha256 = sha256File(ledgerFile);
  const statusFile = path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json");
  const producerTerminalStatusSha256 = "c".repeat(64);
  const producerTerminalStatusState = "sealing";
  const sealedAt = "2026-08-21T13:00:01Z";
  const planItems = Object.entries(units).map(([key, unit]) => ({
    key,
    audioFile: unit.nativeFile,
    combinedText: unit.combinedText,
    firstText: unit.firstText,
    secondText: unit.secondText
  }));
  const alignmentItems = Object.fromEntries(Object.entries(units).map(([key, unit]) => {
    const words = unit.asrObservedWords.map((word, index) => ({
      word, raw: ` ${word}`, start: index / unit.asrObservedWords.length,
      end: (index + 1) / unit.asrObservedWords.length, probability: 1
    }));
    return [key, {
      key,
      status: "pass",
      audioFile: unit.nativeFile,
      audioSha256: unit.nativeSha256,
      expectedWords: unit.asrExpectedWords,
      observedWords: unit.asrObservedWords,
      wordErrorCount: 0,
      comparisonMethod: "exact-authored-plus-explicit-homophone-orthography-v1",
      asrOrthographyEquivalences: [],
      words
    }];
  }));
  const rawAlignmentPlanFile = path.join(qa, "H02_QWEN_TIMING_V3_ALIGNMENT_PLAN.json");
  const rawAlignmentResultsFile = path.join(qa, "H02_QWEN_TIMING_V3_ALIGNMENT_RESULTS.json");
  json(rawAlignmentPlanFile, { schemaVersion: 1, items: planItems });
  const rawAlignmentPlanSha256 = sha256File(rawAlignmentPlanFile);
  json(rawAlignmentResultsFile, { schemaVersion: 1, planSha256: rawAlignmentPlanSha256, items: alignmentItems });
  const rawAlignmentResultsSha256 = sha256File(rawAlignmentResultsFile);
  const audioSnapshotSha256 = "b".repeat(64);
  const sealId = canonicalJsonSha256({
    variant: TIMING_V3_VARIANT,
    runId,
    ledgerSha256,
    compiledPlanSha256,
    rawPlanSha256: rawAlignmentPlanSha256,
    rawResultsSha256: rawAlignmentResultsSha256,
    audioSnapshotSha256,
    terminalStatusSha256: producerTerminalStatusSha256
  });
  const common = {
    schemaVersion: 3,
    variant: TIMING_V3_VARIANT,
    runId,
    currentValidationRunId: runId,
    generationPlanSha256: TIMING_V3_GENERATION_PLAN_SHA,
    ledgerFile,
    ledgerSha256,
    compiledPlanFile,
    compiledPlanSha256,
    retryPlanSha256: TIMING_V3_RETRY_PLAN_SHA,
    auditSha256: TIMING_V3_AUDIT_SHA,
    sourceV2RunId: "e84197d94f5f469699907158957c7a26",
    sourceV2LedgerSha256: TIMING_V3_SOURCE_LEDGER_SHA,
    sourceRawAlignmentPlanFile: rawAlignmentPlanFile,
    sourceRawAlignmentPlanSha256: rawAlignmentPlanSha256,
    sourceRawAlignmentResultsFile: rawAlignmentResultsFile,
    sourceRawAlignmentResultsSha256: rawAlignmentResultsSha256,
    producerValidationBasisAt: "2026-08-21T13:00:00Z",
    sealedAt,
    terminalStatusFile: statusFile,
    terminalStatusSha256: producerTerminalStatusSha256,
    terminalStatusState: producerTerminalStatusState,
    producerTerminalStatusSha256,
    producerTerminalStatusState,
    sealId,
    audioSnapshotSha256
  };
  const alignmentPlanFile = path.join(qa, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_PLAN.json");
  json(alignmentPlanFile, {
    ...common,
    artifactType: "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_PLAN",
    parentCount: 72,
    items: planItems
  });
  const alignmentPlanSha256 = sha256File(alignmentPlanFile);
  const alignmentFile = path.join(qa, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS.json");
  json(alignmentFile, {
    ...common,
    artifactType: "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS",
    alignmentPlanFile,
    alignmentPlanSha256,
    allPassed: true,
    parentCount: 72,
    passCount: 72,
    failureCount: 0,
    items: alignmentItems
  });
  const alignmentSha256 = sha256File(alignmentFile);
  const targetQaFile = path.join(qa, "H02_QWEN_TIMING_V3_SEALED_TARGET_QA.json");
  const timingRows = Object.entries(outputs).map(([, output]) => ({
    cue_id: output.cueId,
    parent_key: output.parentUnit,
    seed: output.seed,
    target_duration_sec: "1.000",
    measured_duration_sec: "1.000000",
    allowed_error_sec: "1.250000",
    duration_error_sec: "0.000000",
    qa_result: "PASS",
    take_file: output.file,
    take_sha256: output.sha256
  }));
  json(targetQaFile, {
    ...common,
    artifactType: "H02_QWEN_TIMING_V3_SEALED_TARGET_QA",
    status: "PASS",
    passCount: 102,
    failureCount: 0,
    alignmentPlanFile,
    alignmentPlanSha256,
    alignmentResultsFile: alignmentFile,
    alignmentResultsSha256: alignmentSha256,
    takeDerivation: { status: "PASS", parentsVerified: 72, takesVerified: 102 },
    rows: timingRows
  });
  const targetQaSha256 = sha256File(targetQaFile);
  const boundArtifacts = {
    compiledPlanFile,
    compiledPlanSha256,
    alignmentPlanFile,
    alignmentPlanSha256,
    alignmentResultsFile: alignmentFile,
    alignmentResultsSha256: alignmentSha256,
    targetQaFile,
    targetQaSha256
  };
  const promotionFile = path.join(manifests, "H02_QWEN_TIMING_V3_SEALED_PROMOTION_INPUT.json");
  json(promotionFile, {
    ...common,
    artifactType: "H02_QWEN_TIMING_V3_SEALED_PROMOTION_INPUT",
    compatibilityProfile: TIMING_V3_PROFILE,
    status: "PASS",
    ...boundArtifacts,
    counts: { parents: 72, reusedParents: 28, regeneratedParents: 44, takes: 102 },
    parents: Object.entries(units).map(([key, unit]) => ({
      key,
      retryAction: unit.retryAction,
      generationText: unit.generationText,
      generationTextSha256: unit.generationTextSha256,
      file: unit.nativeFile,
      sha256: unit.nativeSha256,
      lineage: unit.lineage
    })),
    takes: Object.entries(outputs).map(([key, output]) => ({ key, ...output }))
  });
  const promotionSha256 = sha256File(promotionFile);
  const transactionId = canonicalJsonSha256({
    sealId,
    alignmentPlanSha256,
    alignmentResultsSha256: alignmentSha256,
    targetQaSha256,
    promotionInputSha256: promotionSha256
  });
  const transactionFile = path.join(qa, "H02_QWEN_TIMING_V3_SEAL_TRANSACTION.json");
  json(transactionFile, {
    schemaVersion: 3,
    artifactType: "H02_QWEN_TIMING_V3_SEAL_TRANSACTION",
    state: "COMMITTED",
    variant: TIMING_V3_VARIANT,
    runId,
    currentValidationRunId: runId,
    sealId,
    transactionId,
    sealedAt,
    producerTerminalStatusFile: statusFile,
    producerTerminalStatusSha256,
    producerTerminalStatusState,
    ledgerFile,
    ledgerSha256,
    audioSnapshotSha256: common.audioSnapshotSha256,
    targets: [
      { file: alignmentPlanFile, sha256: alignmentPlanSha256 },
      { file: alignmentFile, sha256: alignmentSha256 },
      { file: targetQaFile, sha256: targetQaSha256 },
      { file: promotionFile, sha256: promotionSha256 }
    ],
    readyMarkerFile: path.join(qa, "READY_FOR_CANONICAL_REVIEW_V3_SEALED.json")
  });
  const readyFile = path.join(qa, "READY_FOR_CANONICAL_REVIEW_V3_SEALED.json");
  json(readyFile, {
    ...common,
    artifactType: "H02_QWEN_TIMING_V3_SEALED_READY",
    status: "PASS",
    compatibilityProfile: TIMING_V3_PROFILE,
    parentCount: 72,
    reusedParentCount: 28,
    regeneratedParentCount: 44,
    takeCount: 102,
    exactAsrPassCount: 72,
    timingQaPassCount: 102,
    canonicalV1Mutated: false,
    timingV2Mutated: false,
    sealTransactionId: transactionId,
    sealTransactionFile: transactionFile,
    sealTransactionSha256: sha256File(transactionFile),
    ...boundArtifacts,
    promotionInputManifestFile: promotionFile,
    promotionInputManifestSha256: promotionSha256,
    validatedAt: "2026-08-21T13:00:01Z"
  });
  json(statusFile, {
    schemaVersion: 2,
    state: "awaiting_review",
    variant: TIMING_V3_VARIANT,
    runVariant: TIMING_V3_VARIANT,
    renderer: "standalone Qwen3-TTS Base TIMING_V3 targeted",
    stagingRoot: staging,
    stagingReady: true,
    exitCode: 0,
    readOnly: true,
    external: true,
    usesComfyUiForSynthesis: false,
    runId,
    supervisorPid: 4321,
    canonicalV1MutationAllowed: false,
    timingV2MutationAllowed: false,
    retryPlanSha256: TIMING_V3_RETRY_PLAN_SHA,
    auditSha256: TIMING_V3_AUDIT_SHA,
    generationPlanSha256: TIMING_V3_GENERATION_PLAN_SHA,
    producerTerminalStatusSha256,
    producerTerminalStatusState,
    sealedReviewMarkerFile: readyFile,
    sealedReviewMarkerSha256: sha256File(readyFile),
    sealTransactionId: transactionId,
    updatedAt: "2026-08-21T13:00:02Z"
  });
  return {
    staging, parents, takes, manifests, qa, runId, units, outputs,
    retryPlanFile, compiledPlanFile, ledgerFile, ledgerSha256,
    alignmentPlanFile, alignmentFile, targetQaFile, promotionFile, transactionFile, readyFile
  };
}

function rebindTimingV3Fixture(timing) {
  const ledger = JSON.parse(fs.readFileSync(timing.ledgerFile, "utf8"));
  const ledgerSha256 = sha256File(timing.ledgerFile);
  const compiledPlanSha256 = sha256File(timing.compiledPlanFile);
  const plan = JSON.parse(fs.readFileSync(timing.alignmentPlanFile, "utf8"));
  Object.assign(plan, { ledgerSha256, compiledPlanSha256 });
  json(timing.alignmentPlanFile, plan);
  const alignmentPlanSha256 = sha256File(timing.alignmentPlanFile);
  const alignment = JSON.parse(fs.readFileSync(timing.alignmentFile, "utf8"));
  Object.assign(alignment, { ledgerSha256, compiledPlanSha256, alignmentPlanSha256 });
  json(timing.alignmentFile, alignment);
  const alignmentResultsSha256 = sha256File(timing.alignmentFile);
  const targetQa = JSON.parse(fs.readFileSync(timing.targetQaFile, "utf8"));
  Object.assign(targetQa, {
    ledgerSha256,
    compiledPlanSha256,
    alignmentPlanSha256,
    alignmentResultsSha256
  });
  json(timing.targetQaFile, targetQa);
  const targetQaSha256 = sha256File(timing.targetQaFile);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  Object.assign(promotion, {
    ledgerSha256,
    compiledPlanSha256,
    alignmentPlanSha256,
    alignmentResultsSha256,
    targetQaSha256
  });
  json(timing.promotionFile, promotion);
  const promotionInputSha256 = sha256File(timing.promotionFile);
  const transaction = JSON.parse(fs.readFileSync(timing.transactionFile, "utf8"));
  const transactionId = canonicalJsonSha256({
    sealId: promotion.sealId,
    alignmentPlanSha256,
    alignmentResultsSha256,
    targetQaSha256,
    promotionInputSha256
  });
  Object.assign(transaction, {
    ledgerSha256,
    transactionId,
    targets: [
      { file: timing.alignmentPlanFile, sha256: alignmentPlanSha256 },
      { file: timing.alignmentFile, sha256: alignmentResultsSha256 },
      { file: timing.targetQaFile, sha256: targetQaSha256 },
      { file: timing.promotionFile, sha256: promotionInputSha256 }
    ]
  });
  json(timing.transactionFile, transaction);
  const ready = JSON.parse(fs.readFileSync(timing.readyFile, "utf8"));
  Object.assign(ready, {
    ledgerSha256,
    compiledPlanSha256,
    alignmentPlanSha256,
    alignmentResultsSha256,
    targetQaSha256,
    promotionInputManifestSha256: promotionInputSha256,
    sealTransactionId: transactionId,
    sealTransactionSha256: sha256File(timing.transactionFile)
  });
  json(timing.readyFile, ready);
}

function timingV3Options(files, timing) {
  return {
    root: files.root,
    timingV3Root: timing.staging,
    timingV3RetryPlanFile: timing.retryPlanFile,
    isProcessAlive: () => false
  };
}

test("maps the allowlisted live supervisor and ledger into one stable read-only queue job", () => {
  const files = fixture();
  writeManifest(files);
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE.lock"), {
    pid: 1234,
    startedAt: "2026-08-21T09:00:00Z"
  });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "attempting_batch",
    supervisorPid: 1234,
    updatedAt: "2026-08-21T09:03:00Z",
    renderer: "standalone Qwen3-TTS Base",
    doneUnits: 1,
    totalUnits: 3,
    takeFiles: 0,
    finalZip: path.join(files.root, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip")
  });
  json(path.join(files.manifests, "H02_QWEN_BATCH_STATE.json"), {
    createdAt: "2026-08-21T09:00:00Z",
    units: {
      "P01:seed-42": { status: "done", cueIds: ["D001", "D002"] },
      "P01:seed-43": { status: "generating", cueIds: ["D001", "D002"] },
      "P01:seed-44": { status: "planned", cueIds: ["D001", "D002"] }
    }
  });
  fs.writeFileSync(path.join(files.parents, "P01_seed-42.wav"), "test");

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => true });
  assert.equal(job.id, H02_EXTERNAL_QUEUE_JOB_ID);
  assert.equal(job.projectSlug, "harrowing_of_hell");
  assert.equal(job.type, "external_qwen_dialogue_batch");
  assert.equal(job.status, "running");
  assert.equal(job.progress, 1 / 3);
  assert.match(job.stage, /1\/3 Qwen passes/);
  assert.equal(job.refs.readOnly, true);
  assert.equal(job.refs.external, true);
  assert.equal(job.refs.usesComfyUi, false);
  assert.equal(job.refs.batchLedgerFile, path.join(files.manifests, "H02_QWEN_BATCH_STATE.json"));
  assert.equal(job.refs.cueCount, 2);
  assert.equal(job.refs.plannedTakeCount, 6);
  assert.equal(job.result, null);
  assert.equal(listExternalQueueJobs({ root: files.root, isProcessAlive: () => true }).length, 1);
});

test("never presents an orphaned active supervisor state as a cancellable running job", () => {
  const files = fixture();
  writeManifest(files);
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "attempting_batch",
    supervisorPid: 9999,
    doneUnits: 2,
    totalUnits: 3
  });

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.match(job.error, /supervisor is not running/i);
  assert.equal(isExternalQueueJobId(job.id), true);
});

test("requires the validated ZIP before mapping a terminal supervisor state to done", () => {
  const files = fixture();
  writeManifest(files);
  const finalZip = path.join(files.root, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip");
  const untrustedDeclaredZip = path.join(files.qa, "not-the-allowlisted-deliverable.zip");
  fs.writeFileSync(untrustedDeclaredZip, "zip");
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "complete",
    supervisorPid: 1234,
    doneUnits: 3,
    totalUnits: 3,
    finalZip: untrustedDeclaredZip
  });

  const missing = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(missing.status, "error");
  assert.match(missing.error, /validated ZIP is missing/);

  fs.writeFileSync(finalZip, "zip");
  const complete = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(complete.status, "done");
  assert.equal(complete.progress, 1);
  assert.deepEqual(complete.result, { finalZip });
});

test("exposes all authoritative cue text and per-seed progress without mutating outputs", () => {
  const files = fixture();
  writeManifest(files);
  json(path.join(files.manifests, "H02_QWEN_BATCH_STATE.json"), {
    units: {
      "P01:seed-42": { status: "done", cueIds: ["D001", "D002"] },
      "P01:seed-43": { status: "generating", cueIds: ["D001", "D002"] },
      "P01:seed-44": { status: "planned", cueIds: ["D001", "D002"] }
    }
  });
  fs.writeFileSync(path.join(files.masters, "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav"), "wav");

  const cues = readExternalH02DialogueCues({ root: files.root });
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], {
    cueId: "D001",
    segmentId: "H02-S03-C01-SEG02A",
    speaker: "TORTURER",
    exactDialogue: "Forsake the promise.",
    performanceDirection: "Low and judicial.",
    status: "done",
    progress: 1,
    completedTakes: 1,
    generatedTakes: 1,
    stagedTakes: 0,
    expectedTakes: 3,
    failedTakes: 0,
    qaPassedTakes: 0,
    qaFailedTakes: 0,
    targetVoiceDurationSec: 7,
    targetVideoDurationSec: 8,
    readOnly: true,
    output: {
      masterFilename: "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav",
      masterExists: true,
      masterPath: path.join(files.masters, "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav"),
      awaitingReview: false,
      promoted: false,
      promotionId: null
    }
  });
  assert.equal(cues[1].status, "running");
  assert.equal(cues[1].progress, 0.25);
  assert.equal(cues[1].exactDialogue, "One word.");
});

test("TIMING_V2 reads only the exact allowlisted staging ledger, alignment, and takes", () => {
  const files = fixture();
  writeManifest(files);
  const staging = path.join(files.root, "TIMING_V2_STAGING");
  const stagingParents = path.join(staging, "PARENT_GENERATIONS");
  const stagingTakes = path.join(staging, "AUDITION_TAKES");
  const stagingManifests = path.join(staging, "MANIFESTS");
  const stagingQa = path.join(staging, "QA");
  for (const directory of [stagingParents, stagingTakes, stagingManifests, stagingQa]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  // Completed canonical v1 artifacts must not leak into the active timing run.
  json(path.join(files.manifests, "H02_QWEN_BATCH_STATE.json"), {
    units: {
      "P01:seed-42": { status: "done", cueIds: ["D001", "D002"] },
      "P01:seed-43": { status: "done", cueIds: ["D001", "D002"] },
      "P01:seed-44": { status: "done", cueIds: ["D001", "D002"] }
    }
  });
  for (const seed of [42, 43, 44]) fs.writeFileSync(path.join(files.parents, `v1-${seed}.wav`), "v1");
  fs.writeFileSync(path.join(files.masters, "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav"), "v1");
  fs.writeFileSync(path.join(files.root, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip"), "v1");

  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "running",
    supervisorPid: 1234,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: staging,
    doneUnits: 3,
    totalUnits: 3,
    takeFiles: 6
  });
  json(path.join(stagingManifests, "H02_QWEN_TIMING_V2_BATCH_STATE.json"), {
    variant: "H02_QWEN_TIMING_V2",
    units: {
      "P01:seed-42": { status: "done", cueIds: ["D001", "D002"] },
      "P01:seed-43": { status: "generating", cueIds: ["D001", "D002"] },
      "P01:seed-44": { status: "planned", cueIds: ["D001", "D002"] }
    },
    outputs: {}
  });
  json(path.join(stagingQa, "H02_QWEN_TIMING_V2_ALIGNMENT_RESULTS.json"), {
    items: {
      "P01:seed-42": { status: "pass" }
    }
  });
  fs.writeFileSync(path.join(stagingParents, "timing-42.wav"), "timing");

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => true });
  assert.equal(job.status, "running");
  assert.equal(job.refs.variant, "H02_QWEN_TIMING_V2");
  assert.equal(job.refs.doneUnits, 1);
  assert.equal(job.refs.totalUnits, 3);
  assert.equal(job.refs.completedTakes, 0);
  assert.equal(job.refs.completedMasters, 0);
  assert.equal(job.refs.batchLedgerFile, path.join(stagingManifests, "H02_QWEN_TIMING_V2_BATCH_STATE.json"));
  assert.equal(job.refs.alignmentResultsFile, path.join(stagingQa, "H02_QWEN_TIMING_V2_ALIGNMENT_RESULTS.json"));
  assert.equal(job.refs.masterWavDir, null);
  assert.equal(job.result, null);
  assert.match(job.stage, /1\/3 TIMING_V2 parents/);
  assert.match(job.stage, /1\/1 exact word checks/);

  const cues = readExternalH02DialogueCues({ root: files.root });
  assert.equal(cues[0].status, "running");
  assert.equal(cues[0].completedTakes, 0);
  assert.equal(cues[0].generatedTakes, 1);
  assert.equal(cues[0].qaPassedTakes, 1);
  assert.equal(cues[0].output.masterExists, false);
  assert.equal(cues[0].output.masterPath, null);
});

test("validated TIMING_V2 staging remains awaiting review instead of becoming master-complete", () => {
  const files = fixture();
  writeManifest(files);
  writeValidatedTimingV2(files);
  fs.writeFileSync(path.join(files.root, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip"), "old-v1");
  fs.writeFileSync(path.join(files.masters, "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav"), "old-v1");

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.progress, 0.99);
  assert.equal(job.refs.stagingReady, true);
  assert.equal(job.refs.reviewMarkerMatchesLedger, true);
  assert.equal(job.refs.reviewRunIdMatches, true);
  assert.equal(job.refs.reviewGenerationPlanMatches, true);
  assert.equal(job.refs.successfulReviewHandoff, true);
  assert.equal(job.refs.completedTakes, 6);
  assert.equal(job.refs.completedMasters, 0);
  assert.equal(job.result, null);
  assert.equal(job.error, null);
  assert.match(job.stage, /awaiting explicit review/i);

  const cues = readExternalH02DialogueCues({ root: files.root });
  assert.deepEqual(cues.map((cue) => cue.status), ["awaiting_review", "awaiting_review"]);
  assert.deepEqual(cues.map((cue) => cue.progress), [0.99, 0.99]);
  assert.deepEqual(cues.map((cue) => cue.completedTakes), [3, 3]);
  assert.deepEqual(cues.map((cue) => cue.output.masterExists), [false, false]);
});

test("TIMING_V2 rejects a stale PASS marker after the staging ledger bytes change", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeValidatedTimingV2(files);
  const mutated = JSON.parse(fs.readFileSync(timing.ledgerFile, "utf8"));
  mutated.updatedAt = "2026-08-21T10:00:03Z";
  json(timing.ledgerFile, mutated);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
  assert.equal(job.refs.reviewMarkerMatchesLedger, false);
  assert.equal(job.refs.reviewRunIdMatches, true);
  assert.equal(job.refs.reviewGenerationPlanMatches, true);
  assert.equal(job.refs.successfulReviewHandoff, true);
  assert.notEqual(job.refs.currentLedgerSha256, JSON.parse(fs.readFileSync(timing.readyFile, "utf8")).ledgerSha256);
  assert.match(job.error, /stale|does not match/i);
  assert.match(job.stage, /review marker does not match/i);
  assert.deepEqual(readExternalH02DialogueCues({ root: files.root }).map((cue) => cue.status), ["blocked", "blocked"]);
});

test("TIMING_V2 ignores an old PASS marker when a newer supervisor run is blocked", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeValidatedTimingV2(files);
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "blocked",
    supervisorPid: 9999,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: timing.staging,
    exitCode: 1,
    runId: "c".repeat(32),
    updatedAt: "2026-08-21T10:00:05Z",
    message: "TIMING_V2 stopped at a fail-closed generation, exact-ASR, or timing target gate"
  });

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
  assert.equal(job.refs.reviewMarkerMatchesLedger, true);
  assert.equal(job.refs.successfulReviewHandoff, false);
  assert.match(job.error, /stopped at a fail-closed/i);
  assert.doesNotMatch(job.stage, /awaiting explicit review/i);
  assert.deepEqual(readExternalH02DialogueCues({ root: files.root }).map((cue) => cue.status), ["blocked", "blocked"]);
});

test("TIMING_V2 requires the exact awaiting_review supervisor state for a successful handoff", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeValidatedTimingV2(files);
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "blocked",
    supervisorPid: 9999,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: timing.staging,
    stagingReady: true,
    exitCode: 0,
    runId: timing.runId,
    updatedAt: "2026-08-21T10:00:02Z",
    message: "legacy blocked review handoff"
  });

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
  assert.equal(job.refs.reviewMarkerMatchesLedger, true);
  assert.equal(job.refs.successfulReviewHandoff, false);
  assert.match(job.error, /legacy blocked review handoff/i);
  assert.doesNotMatch(job.stage, /awaiting explicit review/i);
});

test("TIMING_V2 requires status, marker, and ledger to share one exact run ID", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeValidatedTimingV2(files);
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "awaiting_review",
    supervisorPid: 9999,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: timing.staging,
    stagingReady: true,
    exitCode: 0,
    runId: "d".repeat(32),
    updatedAt: "2026-08-21T10:00:02Z",
    message: "mismatched current-run handoff"
  });

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
  assert.equal(job.refs.reviewMarkerMatchesLedger, true);
  assert.equal(job.refs.reviewRunIdMatches, false);
  assert.equal(job.refs.reviewGenerationPlanMatches, true);
  assert.equal(job.refs.successfulReviewHandoff, false);
  assert.match(job.error, /stale|does not match/i);
  assert.deepEqual(readExternalH02DialogueCues({ root: files.root }).map((cue) => cue.status), ["blocked", "blocked"]);
});

test("a fully bound COMMITTED TIMING_V2 promotion is shown as promoted, not awaiting review", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "promoted");
  assert.equal(job.progress, 1);
  assert.equal(job.error, null);
  assert.equal(job.refs.promoted, true);
  assert.equal(job.refs.stagingReady, true);
  assert.equal(job.refs.promotionId, promotion.promotionId);
  assert.equal(job.refs.promotionTransactionId, promotion.transactionId);
  assert.equal(job.refs.promotionRunId, promotion.runId);
  assert.equal(job.refs.promotionManifestFile, promotion.promotionFile);
  assert.equal(job.refs.promotionJournalFile, promotion.journalFile);
  assert.equal(job.refs.promotionPayloadSnapshotSha256, promotion.canonicalPayloadSnapshotSha256);
  assert.deepEqual(job.result, {
    promoted: true,
    promotionId: promotion.promotionId,
    transactionId: promotion.transactionId,
    promotionManifestFile: promotion.promotionFile,
    promotionJournalFile: promotion.journalFile,
    canonicalOutputRoot: files.root
  });
  assert.match(job.stage, /TIMING_V2 promoted/i);
  assert.match(job.stage, /semantic verification PASS/i);
  assert.doesNotMatch(job.stage, /awaiting|canonical v1 untouched/i);

  const cues = readExternalH02DialogueCues({ root: files.root });
  assert.equal(cues.length, 34);
  assert.ok(cues.every((cue) => cue.status === "promoted"));
  assert.ok(cues.every((cue) => cue.progress === 0.99));
  assert.ok(cues.every((cue) => cue.output.promoted === true));
  assert.ok(cues.every((cue) => cue.output.awaitingReview === false));
  assert.ok(cues.every((cue) => cue.output.promotionId === promotion.promotionId));
});

test("a stale TIMING_V2 promotion pointer cannot override current review state", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const stale = JSON.parse(fs.readFileSync(promotion.promotionFile, "utf8"));
  stale.sourceHashes.ledger = "0".repeat(64);
  json(promotion.promotionFile, stale);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.promoted, false);
  assert.equal(job.result, null);
  assert.match(job.error, /fingerprint|source ledger hash|stale/i);
  assert.match(job.stage, /promotion blocked/i);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "blocked"));
});

test("promotion requires the exact verified parent-to-take PCM derivation contract", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const pointer = JSON.parse(fs.readFileSync(promotion.promotionFile, "utf8"));
  pointer.semanticVerification.takeDerivation.takesVerified = 101;
  json(promotion.promotionFile, pointer);
  const journal = JSON.parse(fs.readFileSync(promotion.journalFile, "utf8"));
  journal.semanticVerification = pointer.semanticVerification;
  journal.afterTargets = fileTreeSnapshot(files.root, TIMING_V2_PROMOTION_TARGETS);
  json(promotion.journalFile, journal);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.promoted, false);
  assert.equal(job.result, null);
  assert.match(job.error, /PCM derivation evidence/i);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "blocked"));
});

test("PREPARED, INSTALLING, and rolled-back promotion journals never appear promoted", async (t) => {
  for (const journalStatus of ["PREPARED", "INSTALLING", "ROLLED_BACK_AFTER_FAILURE"]) {
    await t.test(journalStatus, () => {
      const files = fixture();
      const promotion = writePromotionReadyTimingV2(files);
      const journal = JSON.parse(fs.readFileSync(promotion.journalFile, "utf8"));
      journal.status = journalStatus;
      json(promotion.journalFile, journal);

      const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
      assert.equal(job.status, "error");
      assert.equal(job.refs.promoted, false);
      assert.equal(job.result, null);
      assert.match(job.error, /same committed transaction/i);
      assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "blocked"));
    });
  }
});

test("mutating a promoted canonical artifact invalidates the committed hash snapshot", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const alignment = JSON.parse(fs.readFileSync(promotion.canonicalAlignmentFile, "utf8"));
  alignment.mutatedAfterCommit = true;
  json(promotion.canonicalAlignmentFile, alignment);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.promoted, false);
  assert.equal(job.result, null);
  assert.match(job.error, /hash snapshot|semantic evidence|payload/i);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "blocked"));
});

test("a committed promotion for a different run cannot override the current staging run", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const pointer = JSON.parse(fs.readFileSync(promotion.promotionFile, "utf8"));
  pointer.runId = "9".repeat(32);
  json(promotion.promotionFile, pointer);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.promoted, false);
  assert.equal(job.result, null);
  assert.match(job.error, /different review run/i);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "blocked"));
});

test("promotion never follows a manifest-supplied journal path outside the exact backup allowlist", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const pointer = JSON.parse(fs.readFileSync(promotion.promotionFile, "utf8"));
  pointer.backupDirectory = path.join(os.tmpdir(), "outside-h02-promotion-journal");
  pointer.backupManifestFile = path.join(pointer.backupDirectory, "BACKUP_MANIFEST.json");
  json(promotion.promotionFile, pointer);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "error");
  assert.equal(job.refs.promoted, false);
  assert.equal(job.result, null);
  assert.match(job.error, /outside the exact transaction allowlist/i);
});

test("a restored promotion returns the read-only queue to current staging awaiting review", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const journal = JSON.parse(fs.readFileSync(promotion.journalFile, "utf8"));
  journal.status = "RESTORED";
  journal.restoredAt = "2026-08-21T10:20:00Z";
  json(promotion.journalFile, journal);
  fs.unlinkSync(promotion.promotionFile);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.progress, 0.99);
  assert.equal(job.error, null);
  assert.equal(job.refs.promoted, false);
  assert.equal(job.refs.promotionManifestFile, null);
  assert.equal(job.result, null);
  assert.match(job.stage, /awaiting explicit review/i);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "awaiting_review"));
});

test("a failed restore rolled back to the exact committed bytes remains promoted", () => {
  const files = fixture();
  const promotion = writePromotionReadyTimingV2(files);
  const journal = JSON.parse(fs.readFileSync(promotion.journalFile, "utf8"));
  journal.restore = {
    status: "ROLLED_BACK_AFTER_FAILURE",
    failedAt: "2026-08-21T10:19:59Z",
    rolledBackAt: "2026-08-21T10:20:00Z"
  };
  journal.stateHistory.push(
    { status: "RESTORING", at: "2026-08-21T10:19:58Z" },
    { status: "RESTORE_ROLLING_BACK", at: "2026-08-21T10:19:59Z" },
    { status: "COMMITTED", at: "2026-08-21T10:20:00Z" }
  );
  journal.journalSequence += 3;
  json(promotion.journalFile, journal);

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => false });
  assert.equal(job.status, "promoted");
  assert.equal(job.error, null);
  assert.equal(job.refs.promotionTransactionId, promotion.transactionId);
  assert.ok(readExternalH02DialogueCues({ root: files.root }).every((cue) => cue.status === "promoted"));
});

test("TIMING_V2 refuses a status-supplied staging path outside the exact allowlist", () => {
  const files = fixture();
  writeManifest(files);
  const untrusted = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-untrusted-timing-"));
  fs.mkdirSync(path.join(untrusted, "MANIFESTS"), { recursive: true });
  json(path.join(untrusted, "MANIFESTS", "H02_QWEN_TIMING_V2_BATCH_STATE.json"), {
    units: { "P01:seed-42": { status: "done", cueIds: ["D001", "D002"] } }
  });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "running",
    supervisorPid: 1234,
    renderer: "standalone Qwen3-TTS Base TIMING_V2",
    stagingRoot: untrusted
  });

  const job = readExternalH02QueueJob({ root: files.root, isProcessAlive: () => true });
  assert.equal(job.status, "error");
  assert.equal(job.refs.doneUnits, 0);
  assert.equal(job.refs.batchLedgerFile, path.join(files.root, "TIMING_V2_STAGING", "MANIFESTS", "H02_QWEN_TIMING_V2_BATCH_STATE.json"));
  assert.match(job.error, /non-allowlisted staging root/i);
});

test("does not invent an external job when the allowlisted status file is absent", () => {
  const files = fixture();
  assert.equal(readExternalH02QueueJob({ root: files.root }), null);
  assert.deepEqual(listExternalQueueJobs({ root: files.root }), []);
});

test("queue and UI contracts keep the external job visible but non-cancellable", () => {
  const queueSource = fs.readFileSync(new URL("../server/queue.js", import.meta.url), "utf8");
  const apiSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const drawerSource = fs.readFileSync(new URL("../client/src/components/GlobalQueueDrawer.tsx", import.meta.url), "utf8");
  const contextStripSource = fs.readFileSync(new URL("../client/src/components/ProjectContextStrip.tsx", import.meta.url), "utf8");
  assert.match(queueSource, /\.\.\.listExternalQueueJobs\(\)/);
  assert.match(queueSource, /isExternalQueueJobId\(id\)\) return false/);
  assert.match(apiSource, /isExternalQueueJobId\(req\.params\.id\)/);
  assert.match(apiSource, /readExternalH02DialogueCues\(\)/);
  assert.match(apiSource, /sound:\s*\{\s*\.\.\.qwenResult\.sound,\s*dialogueCues/s);
  assert.match(drawerSource, /active && !readOnly/);
  assert.match(drawerSource, /value === "awaiting_review" \? "awaiting review"/);
  assert.match(contextStripSource, /job\.status === "awaiting_review"/);
  assert.match(contextStripSource, /`\$\{awaitingReview\} awaiting review`/);
  assert.match(contextStripSource, /blocked \? `\$\{blocked\} blocked`/);
  assert.match(contextStripSource, /promoted \? `\$\{promoted\} promoted`/);
  assert.match(contextStripSource, /job\.status === "promoted"/);
  assert.match(fs.readFileSync(new URL("../client/src/styles.css", import.meta.url), "utf8"), /\.status-chip\.promoted/);
});

test("TIMING_V4 reports the exact allowlisted winner-selection run and truthful lineage counts", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeTimingV4Progress(files, { doneRegenerated: 5 });

  const options = {
    root: files.root,
    timingV4Root: timing.staging,
    isProcessAlive: () => true
  };
  const job = readExternalH02QueueJob(options);
  assert.equal(job.status, "running");
  assert.equal(job.refs.variant, TIMING_V4_VARIANT);
  assert.equal(job.refs.batchLedgerFile, path.join(timing.manifests, "H02_QWEN_TIMING_V4_BATCH_STATE.json"));
  assert.equal(job.refs.alignmentResultsFile, path.join(timing.qa, "H02_QWEN_TIMING_V4_ALIGNMENT_RESULTS.json"));
  assert.equal(job.refs.stagingRoot, timing.staging);
  assert.equal(job.refs.masterWavDir, null);
  assert.equal(job.refs.completedMasters, 0);
  assert.equal(job.refs.doneUnits, 62);
  assert.equal(job.refs.totalUnits, 72);
  assert.deepEqual(job.refs.timingV4Lineage, {
    reused: 57, reusedDone: 57, regenerated: 15, regeneratedDone: 5
  });
  assert.match(job.stage, /62\/72 TIMING_V4 parents \(57\/57 reused · 5\/15 regenerated\)/);
  assert.equal(job.result, null);
  assert.equal(job.refs.canonicalV1MutationAllowed, false);
  assert.equal(job.refs.timingV2MutationAllowed, false);
  assert.equal(job.refs.timingV3MutationAllowed, false);
  assert.ok(readExternalH02DialogueCues(options).every((cue) => cue.status !== "error"));

  const statusFile = path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json");
  const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  status.stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-v4-untrusted-"));
  json(statusFile, status);
  const rejected = readExternalH02QueueJob(options);
  assert.equal(rejected.status, "error");
  assert.equal(rejected.refs.doneUnits, 0);
  assert.match(rejected.stage, /TIMING_V4 blocked · staging root failed the allowlist/);

  status.stagingRoot = timing.staging;
  status.renderer = "standalone Qwen3-TTS Base TIMING_V4 forged renderer";
  json(statusFile, status);
  assert.equal(readExternalH02QueueJob(options).status, "error");

  status.renderer = "standalone Qwen3-TTS Base V4 winner-selection compute";
  status.variant = `${TIMING_V4_VARIANT}_FORGED`;
  json(statusFile, status);
  assert.equal(readExternalH02QueueJob(options).status, "error");
});

test("TIMING_V3 reports exact allowlisted targeted progress and preserves canonical masters", () => {
  const files = fixture();
  writeManifest(files);
  const timing = writeTimingV3Progress(files, { doneRegenerated: 5 });
  fs.writeFileSync(path.join(files.masters, "D001_H02-S03-C01-SEG02A_TORTURER_MASTER.wav"), "old-canonical");
  json(path.join(files.manifests, "H02_QWEN_BATCH_STATE.json"), {
    units: { "old-v2": { status: "done", cueIds: ["D001"] } }
  });

  const job = readExternalH02QueueJob({
    root: files.root,
    timingV3Root: timing.staging,
    isProcessAlive: () => true
  });
  assert.equal(job.status, "running");
  assert.equal(job.refs.variant, TIMING_V3_VARIANT);
  assert.equal(job.refs.batchLedgerFile, path.join(timing.manifests, "H02_QWEN_TIMING_V3_BATCH_STATE.json"));
  assert.equal(job.refs.alignmentResultsFile, path.join(timing.qa, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS.json"));
  assert.equal(job.refs.stagingRoot, timing.staging);
  assert.equal(job.refs.masterWavDir, null);
  assert.equal(job.refs.completedMasters, 0);
  assert.equal(job.refs.doneUnits, 33);
  assert.deepEqual(job.refs.timingV3Lineage, {
    reused: 28, reusedDone: 28, regenerated: 44, regeneratedDone: 5
  });
  assert.match(job.stage, /33\/72 TIMING_V3 parents \(28\/28 reused · 5\/44 regenerated\)/);
  assert.equal(job.result, null);
  assert.equal(job.refs.canonicalV1MutationAllowed, false);
  assert.equal(job.refs.timingV2MutationAllowed, false);
});

test("validated TIMING_V3 becomes awaiting review without impersonating TIMING_V2 promotion", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  json(path.join(files.manifests, "H02_QWEN_TIMING_V2_PROMOTION.json"), {
    status: "COMMITTED", variant: "H02_QWEN_TIMING_V2"
  });

  const options = timingV3Options(files, timing);
  const job = readExternalH02QueueJob(options);
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.progress, 0.99);
  assert.equal(job.refs.variant, TIMING_V3_VARIANT);
  assert.equal(job.refs.stagingReady, true);
  assert.equal(job.refs.promoted, false);
  assert.equal(job.refs.promotionManifestFile, null);
  assert.equal(job.refs.promotionInputManifestFile, timing.promotionFile);
  assert.deepEqual(job.refs.timingV3Lineage, {
    reused: 28, reusedDone: 28, regenerated: 44, regeneratedDone: 44
  });
  assert.match(job.stage, /72\/72 TIMING_V3 parents \(28\/28 reused · 44\/44 regenerated\)/);
  assert.match(job.stage, /awaiting explicit review/);
  assert.equal(job.result, null);

  const cues = readExternalH02DialogueCues(options);
  assert.deepEqual(cues.map((cue) => cue.status), ["awaiting_review", "awaiting_review"]);
  assert.deepEqual(cues.map((cue) => cue.completedTakes), [3, 3]);
  assert.ok(cues.every((cue) => cue.output.promoted === false));
});

test("TIMING_V3 refuses a status-supplied root outside its configured exact allowlist", () => {
  const files = fixture();
  writeManifest(files);
  const allowlisted = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-v3-allowlisted-"));
  const untrusted = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-h02-v3-untrusted-"));
  fs.mkdirSync(path.join(untrusted, "MANIFESTS"), { recursive: true });
  json(path.join(untrusted, "MANIFESTS", "H02_QWEN_TIMING_V3_BATCH_STATE.json"), {
    variant: TIMING_V3_VARIANT,
    units: Object.fromEntries(Array.from({ length: 72 }, (_, index) => [`forged-${index}`, { status: "done" }]))
  });
  json(path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json"), {
    state: "running",
    variant: TIMING_V3_VARIANT,
    renderer: "standalone Qwen3-TTS Base TIMING_V3 targeted",
    stagingRoot: untrusted,
    supervisorPid: 4321,
    runId: "f".repeat(32)
  });

  const job = readExternalH02QueueJob({
    root: files.root,
    timingV3Root: allowlisted,
    isProcessAlive: () => true
  });
  assert.equal(job.status, "error");
  assert.equal(job.refs.doneUnits, 0);
  assert.equal(job.refs.batchLedgerFile, path.join(allowlisted, "MANIFESTS", "H02_QWEN_TIMING_V3_BATCH_STATE.json"));
  assert.match(job.error, /non-allowlisted staging root/i);
  assert.match(job.stage, /TIMING_V3 blocked/);
});

test("TIMING_V3 stale promotion-input bytes invalidate the ready handoff", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  promotion.validatedAt = "mutated-after-marker";
  json(timing.promotionFile, promotion);

  const job = readExternalH02QueueJob({
    root: files.root,
    timingV3Root: timing.staging,
    timingV3RetryPlanFile: timing.retryPlanFile,
    isProcessAlive: () => false
  });
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
  assert.match(job.error, /stale|does not match/i);
  assert.doesNotMatch(job.stage, /awaiting explicit review/i);
});

test("TIMING_V3 rejects a missing take even while every metadata count remains 72/102", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  fs.unlinkSync(Object.values(timing.outputs)[0].file);
  const job = readExternalH02QueueJob(timingV3Options(files, timing));
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
});

test("TIMING_V3 rejects a promotion parent hash forged with a freshly rebound outer marker", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  promotion.parents[0].sha256 = "0".repeat(64);
  json(timing.promotionFile, promotion);
  const ready = JSON.parse(fs.readFileSync(timing.readyFile, "utf8"));
  ready.promotionInputManifestSha256 = sha256File(timing.promotionFile);
  json(timing.readyFile, ready);
  const job = readExternalH02QueueJob(timingV3Options(files, timing));
  assert.equal(job.status, "error");
  assert.equal(job.refs.stagingReady, false);
});

test("TIMING_V3 rejects reordered promotion keys after all outer hashes are rebound", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  promotion.parents.reverse();
  json(timing.promotionFile, promotion);
  const ready = JSON.parse(fs.readFileSync(timing.readyFile, "utf8"));
  ready.promotionInputManifestSha256 = sha256File(timing.promotionFile);
  json(timing.readyFile, ready);
  const job = readExternalH02QueueJob(timingV3Options(files, timing));
  assert.equal(job.status, "error");
});

test("TIMING_V3 rejects a cross-consistent forged retry action absent from the pinned retry plan", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  const firstKey = Object.keys(timing.units)[0];
  const compiled = JSON.parse(fs.readFileSync(timing.compiledPlanFile, "utf8"));
  compiled.units.find((unit) => unit.key === firstKey).retryAction = "regenerate_v3_targeted";
  json(timing.compiledPlanFile, compiled);
  const ledger = JSON.parse(fs.readFileSync(timing.ledgerFile, "utf8"));
  ledger.compiledPlan.sha256 = sha256File(timing.compiledPlanFile);
  ledger.units[firstKey].retryAction = "regenerate_v3_targeted";
  ledger.units[firstKey].lineage.action = "regenerate_v3_targeted";
  json(timing.ledgerFile, ledger);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  promotion.parents.find((row) => row.key === firstKey).retryAction = "regenerate_v3_targeted";
  promotion.parents.find((row) => row.key === firstKey).lineage.action = "regenerate_v3_targeted";
  json(timing.promotionFile, promotion);
  rebindTimingV3Fixture(timing);
  const job = readExternalH02QueueJob(timingV3Options(files, timing));
  assert.equal(job.status, "error");
});

test("TIMING_V3 rejects a take path outside the exact audition directory after full rebinding", () => {
  const files = fixture();
  writeManifest(files);
  const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.packageCounts.cues = 34;
  json(manifestFile, manifest);
  const timing = writeValidatedTimingV3(files);
  const outputKey = Object.keys(timing.outputs)[0];
  const outside = path.join(timing.staging, "outside.wav");
  fs.copyFileSync(timing.outputs[outputKey].file, outside);
  const ledger = JSON.parse(fs.readFileSync(timing.ledgerFile, "utf8"));
  ledger.outputs[outputKey].file = outside;
  ledger.outputs[outputKey].sha256 = sha256File(outside);
  json(timing.ledgerFile, ledger);
  const promotion = JSON.parse(fs.readFileSync(timing.promotionFile, "utf8"));
  promotion.takes.find((row) => row.key === outputKey).file = outside;
  promotion.takes.find((row) => row.key === outputKey).sha256 = sha256File(outside);
  json(timing.promotionFile, promotion);
  rebindTimingV3Fixture(timing);
  const job = readExternalH02QueueJob(timingV3Options(files, timing));
  assert.equal(job.status, "error");
});

test("TIMING_V3 rejects alignment and target-QA semantic forgery despite current file hashes", async (t) => {
  for (const attack of ["alignment-run", "alignment-audio", "target-status", "target-row"]) {
    await t.test(attack, () => {
      const files = fixture();
      writeManifest(files);
      const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      manifest.packageCounts.cues = 34;
      json(manifestFile, manifest);
      const timing = writeValidatedTimingV3(files);
      if (attack.startsWith("alignment")) {
        const alignment = JSON.parse(fs.readFileSync(timing.alignmentFile, "utf8"));
        if (attack === "alignment-run") alignment.runId = "f".repeat(32);
        if (attack === "alignment-audio") alignment.items[Object.keys(alignment.items)[0]].audioSha256 = "0".repeat(64);
        json(timing.alignmentFile, alignment);
      } else {
        const target = JSON.parse(fs.readFileSync(timing.targetQaFile, "utf8"));
        if (attack === "target-status") target.status = "FAIL";
        if (attack === "target-row") target.rows[0].parent_key = "forged-parent";
        json(timing.targetQaFile, target);
      }
      rebindTimingV3Fixture(timing);
      const job = readExternalH02QueueJob(timingV3Options(files, timing));
      assert.equal(job.status, "error");
      assert.equal(job.refs.stagingReady, false);
    });
  }
});

test("TIMING_V3 rejects JavaScript-coercible exit codes and inexact safety booleans", async (t) => {
  const attacks = [
    ["exit-null", "exitCode", null],
    ["exit-false", "exitCode", false],
    ["exit-empty", "exitCode", ""],
    ["readOnly-false", "readOnly", false],
    ["external-false", "external", false],
    ["usesComfy-null", "usesComfyUiForSynthesis", null],
    ["canonical-null", "canonicalV1MutationAllowed", null],
    ["timingV2-null", "timingV2MutationAllowed", null]
  ];
  for (const [name, field, value] of attacks) {
    await t.test(name, () => {
      const files = fixture();
      writeManifest(files);
      const manifestFile = path.join(files.manifests, "H02_QWEN_CUE_MANIFEST.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      manifest.packageCounts.cues = 34;
      json(manifestFile, manifest);
      const timing = writeValidatedTimingV3(files);
      const statusFile = path.join(files.qa, "H02_BACKGROUND_QUEUE_STATUS.json");
      const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
      status[field] = value;
      json(statusFile, status);
      const job = readExternalH02QueueJob(timingV3Options(files, timing));
      assert.equal(job.status, "error");
      assert.equal(job.refs.stagingReady, false);
    });
  }
});

test("production TIMING_V3 staging root is an exact explicit constant", () => {
  assert.equal(
    path.resolve(H02_TIMING_V3_STAGING_ROOT).toLowerCase(),
    path.resolve("C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_v3_run").toLowerCase()
  );
});

test("production TIMING_V4 staging root is an exact explicit constant", () => {
  assert.equal(
    path.resolve(H02_TIMING_V4_STAGING_ROOT).toLowerCase(),
    path.resolve("C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_v4_run").toLowerCase()
  );
});
