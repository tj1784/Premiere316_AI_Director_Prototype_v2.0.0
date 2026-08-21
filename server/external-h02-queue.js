import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const H02_EXTERNAL_QUEUE_JOB_ID = "external_h02_qwen_dialogue";
export const H02_EXTERNAL_PROJECT_SLUG = "harrowing_of_hell";
export const H02_EXTERNAL_OUTPUT_ROOT = "C:\\Users\\Blokey\\Documents\\Audacity\\Harrowing_H02_Cloned_Dialogue";
export const H02_TIMING_V3_STAGING_ROOT = "C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_v3_run";
export const H02_TIMING_V3_RETRY_PLAN_FILE = "C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_v3_plan\\H02_QWEN_TIMING_V3_TARGETED_RETRY_PLAN.json";
export const H02_TIMING_V4_STAGING_ROOT = "C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_v4_run";
const H02_TIMING_V2_SOURCE_TEXT_PLAN_FILE = "C:\\Users\\Blokey\\Documents\\ChatGPT\\Premiere316\\staging\\h02_qwen_timing_text_plan\\H02_QWEN_TIMING_TEXT_PLAN.json";
const H02_TIMING_V2_AUDITED_FFMPEG_FILE = "C:\\Users\\Blokey\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe";
const H02_TIMING_V2_VARIANT = "H02_QWEN_TIMING_V2";
const H02_TIMING_V3_VARIANT = "H02_QWEN_TIMING_V3_TARGETED";
const H02_TIMING_V4_VARIANT = "H02_QWEN_TIMING_V4_WINNER_SELECTION";
const H02_TIMING_V4_RENDERER = "standalone Qwen3-TTS Base V4 winner-selection compute";
const H02_TIMING_V3_COMPATIBILITY_PROFILE = "H02_QWEN_COMPLETE_REVIEW_SET_V1";
const H02_TIMING_V3_SOURCE_RUN_ID = "e84197d94f5f469699907158957c7a26";
const H02_TIMING_V3_RETRY_PLAN_SHA256 = "bbe21a96b0e911122b03266d92bece03b843a0e03f21e6c6fa6deee5f3895585";
const H02_TIMING_V3_AUDIT_SHA256 = "2f55f13c097ec7d04138c5e3f2aaa2cde5f47504bac83ea2a2c6a596b5edaa86";
const H02_TIMING_V3_SOURCE_LEDGER_SHA256 = "efb29dce942e95c0392bc97e6200580201ccdd8c9d60430c9d4fc3846c0b3d14";
const H02_TIMING_V3_GENERATION_PLAN_SHA256 = "f4d13778bfef34a5b6edfaeacbe41fba5826f14331829d294a0b14ebf06cb037";
const H02_TIMING_V2_PROMOTION_ARTIFACT = "H02_QWEN_TIMING_V2_CANONICAL_PROMOTION";
const H02_TIMING_V2_BACKUP_ARTIFACT = "H02_QWEN_TIMING_V2_RECOVERABLE_BACKUP";
const H02_TIMING_V2_SEMANTIC_CONTRACT = "H02_TIMING_V2_PROMOTION_SEMANTIC_V2";
const H02_TIMING_V2_RESAMPLER_CONTRACT = Object.freeze({
  sampleRate: 48000,
  lowpassFilterWidth: 64,
  rolloff: 0.9475937167399596,
  method: "sinc_interp_kaiser",
  beta: 14.769656459379492
});
const H02_TIMING_V2_VOICE_LOCKS = Object.freeze({
  TORTURER: "H02_TORTURER_LOCK",
  ADAM: "H02_ADAM_LOCK",
  EVE: "H02_EVE_LOCK",
  MOSES: "H02_MOSES_LOCK",
  DAVID: "H02_DAVID_LOCK",
  JOHN: "H02_JOHN_LOCK"
});
const H02_TIMING_V2_PROMOTION_TARGETS = Object.freeze([
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
]);
const H02_TIMING_V2_PAYLOAD_TARGETS = Object.freeze(H02_TIMING_V2_PROMOTION_TARGETS.slice(0, -1));
const H02_TIMING_V2_SOURCE_HASH_KEYS = Object.freeze([
  "status",
  "readyMarker",
  "ledger",
  "alignmentPlan",
  "alignment",
  "timingQaJson",
  "timingQaCsv",
  "slowReferenceManifest",
  "slowReferenceAsrPlan",
  "slowReferenceAsr",
  "timingTextPlan",
  "cueSheet",
  "voiceMapping",
  "auditedFfmpeg"
]);
const H02_TIMING_V2_JOURNAL_MOVE_KEYS = Object.freeze([
  "archivedTargets",
  "installedTargets",
  "rolledBackInstalledTargets",
  "restoredArchivedTargets",
  "restoreMovedCurrentTargets",
  "restoreRestoredOldTargets",
  "restoreReturnedOldTargets",
  "restoreReplacedPromotedTargets"
]);

const TERMINAL_DONE_STATES = new Set(["complete", "completed", "done", "validated"]);
const TERMINAL_ERROR_STATES = new Set(["blocked", "error", "failed"]);
const TERMINAL_CANCELLED_STATES = new Set(["cancelled", "canceled", "stopped"]);
const QUEUED_STATES = new Set([
  "queued",
  "retry_wait",
  "sleeping",
  "waiting",
  "waiting_for_other_job"
]);

function pathsFor(
  root,
  timingV3Root = H02_TIMING_V3_STAGING_ROOT,
  timingV3RetryPlanFile = H02_TIMING_V3_RETRY_PLAN_FILE,
  timingV4Root = H02_TIMING_V4_STAGING_ROOT
) {
  const timingV2Root = path.join(root, "TIMING_V2_STAGING");
  return {
    root,
    statusFile: path.join(root, "QA", "H02_BACKGROUND_QUEUE_STATUS.json"),
    lockFile: path.join(root, "QA", "H02_BACKGROUND_QUEUE.lock"),
    parentGenerationDir: path.join(root, "QA", "_PARENT_GENERATIONS"),
    alternateTakesDir: path.join(root, "ALTERNATE_TAKES"),
    masterWavDir: path.join(root, "MASTER_WAV"),
    cueManifestFile: path.join(root, "MANIFESTS", "H02_QWEN_CUE_MANIFEST.json"),
    batchLedgerFile: path.join(root, "MANIFESTS", "H02_QWEN_BATCH_STATE.json"),
    alignmentResultsFile: path.join(root, "QA", "H02_QWEN_ALIGNMENT_RESULTS.json"),
    timingV2Root,
    timingV2ParentGenerationDir: path.join(timingV2Root, "PARENT_GENERATIONS"),
    timingV2AlternateTakesDir: path.join(timingV2Root, "AUDITION_TAKES"),
    timingV2BatchLedgerFile: path.join(timingV2Root, "MANIFESTS", "H02_QWEN_TIMING_V2_BATCH_STATE.json"),
    timingV2AlignmentPlanFile: path.join(timingV2Root, "QA", "H02_QWEN_TIMING_V2_ALIGNMENT_PLAN.json"),
    timingV2AlignmentResultsFile: path.join(timingV2Root, "QA", "H02_QWEN_TIMING_V2_ALIGNMENT_RESULTS.json"),
    timingV2ReadyForReviewFile: path.join(timingV2Root, "QA", "READY_FOR_CANONICAL_REVIEW.json"),
    timingV2TimingQaJsonFile: path.join(timingV2Root, "QA", "TIMING_V2_TARGET_QA.json"),
    timingV2TimingQaCsvFile: path.join(timingV2Root, "QA", "TIMING_V2_TARGET_QA.csv"),
    timingV2SlowReferenceManifestFile: path.join(timingV2Root, "MANIFESTS", "TIMING_V2_VOICE_REFERENCE_MANIFEST.json"),
    timingV2SlowReferenceAsrPlanFile: path.join(timingV2Root, "QA", "H02_QWEN_TIMING_V2_SLOW_REF_ASR_PLAN.json"),
    timingV2SlowReferenceAsrFile: path.join(timingV2Root, "QA", "H02_QWEN_TIMING_V2_SLOW_REF_ASR_RESULTS.json"),
    timingV3Root: path.resolve(timingV3Root),
    timingV3ParentGenerationDir: path.join(timingV3Root, "PARENT_GENERATIONS"),
    timingV3AlternateTakesDir: path.join(timingV3Root, "AUDITION_TAKES"),
    timingV3BatchLedgerFile: path.join(timingV3Root, "MANIFESTS", "H02_QWEN_TIMING_V3_BATCH_STATE.json"),
    timingV3CompiledPlanFile: path.join(timingV3Root, "MANIFESTS", "H02_QWEN_TIMING_V3_COMPILED_PLAN.json"),
    timingV3RawAlignmentPlanFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_ALIGNMENT_PLAN.json"),
    timingV3RawAlignmentResultsFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_ALIGNMENT_RESULTS.json"),
    timingV3RetryPlanFile: path.resolve(timingV3RetryPlanFile),
    timingV3AlignmentPlanFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_PLAN.json"),
    timingV3AlignmentResultsFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS.json"),
    timingV3ReadyForReviewFile: path.join(timingV3Root, "QA", "READY_FOR_CANONICAL_REVIEW_V3_SEALED.json"),
    timingV3PromotionInputFile: path.join(timingV3Root, "MANIFESTS", "H02_QWEN_TIMING_V3_SEALED_PROMOTION_INPUT.json"),
    timingV3TargetQaFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_SEALED_TARGET_QA.json"),
    timingV3SealTransactionFile: path.join(timingV3Root, "QA", "H02_QWEN_TIMING_V3_SEAL_TRANSACTION.json"),
    timingV4Root: path.resolve(timingV4Root),
    timingV4ParentGenerationDir: path.join(timingV4Root, "PARENT_GENERATIONS"),
    timingV4AlternateTakesDir: path.join(timingV4Root, "AUDITION_TAKES"),
    timingV4BatchLedgerFile: path.join(timingV4Root, "MANIFESTS", "H02_QWEN_TIMING_V4_BATCH_STATE.json"),
    timingV4CompiledPlanFile: path.join(timingV4Root, "MANIFESTS", "H02_QWEN_TIMING_V4_COMPILED_PLAN.json"),
    timingV4AlignmentResultsFile: path.join(timingV4Root, "QA", "H02_QWEN_TIMING_V4_ALIGNMENT_RESULTS.json"),
    authoritativeCueSheetFile: path.join(root, "MANIFESTS", "AUTHORITATIVE_PACKAGE", "H02_INDEXTTS25_CUE_SHEET.csv"),
    voiceMappingFile: path.join(root, "MANIFESTS", "VOICE_MAPPING.csv"),
    promotionManifestFile: path.join(root, "MANIFESTS", "H02_QWEN_TIMING_V2_PROMOTION.json"),
    promotionBackupRoot: path.join(root, "QA", "_TIMING_V2_PROMOTION_BACKUPS"),
    canonicalLedgerFile: path.join(root, "MANIFESTS", "H02_QWEN_BATCH_STATE.json"),
    canonicalAlignmentPlanFile: path.join(root, "QA", "H02_QWEN_ALIGNMENT_PLAN.json"),
    canonicalAlignmentFile: path.join(root, "QA", "H02_QWEN_ALIGNMENT_RESULTS.json"),
    canonicalSlowReferenceManifestFile: path.join(root, "MANIFESTS", "H02_QWEN_TIMING_V2_SLOW_REFERENCES.json"),
    canonicalTimingTextPlanFile: path.join(root, "MANIFESTS", "H02_QWEN_TIMING_V2_TEXT_PLAN.json"),
    canonicalSlowReferenceAsrPlanFile: path.join(root, "QA", "H02_QWEN_TIMING_V2_SLOW_REF_ASR_PLAN.json"),
    canonicalSlowReferenceAsrFile: path.join(root, "QA", "H02_QWEN_TIMING_V2_SLOW_REF_ASR_RESULTS.json"),
    canonicalTimingQaJsonFile: path.join(root, "QA", "H02_QWEN_TIMING_V2_TARGET_QA.json"),
    canonicalTimingQaCsvFile: path.join(root, "QA", "H02_QWEN_TIMING_V2_TARGET_QA.csv"),
    canonicalReadyForReviewFile: path.join(root, "QA", "H02_QWEN_TIMING_V2_READY_FOR_CANONICAL_REVIEW.json")
  };
}

function sameResolvedPath(left, right) {
  if (!left || !right) return false;
  try {
    return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
  } catch {
    return false;
  }
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

function exactJsonEqual(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function safeIdentifier(value) {
  const result = String(value || "");
  return /^[a-z0-9][a-z0-9._-]{0,191}$/i.test(result) && result !== "." && result !== ".."
    ? result
    : null;
}

function timingDeclaration(status, files) {
  const declarations = [status?.variant, status?.renderer, status?.runVariant]
    .map((value) => String(value || ""));
  const declaresTimingV4 = declarations.some((value) => /timing[_\s-]*v4/i.test(value));
  const declaresTimingV3 = declarations.some((value) => /timing[_\s-]*v3/i.test(value));
  const declaresTimingV2 = declarations.some((value) => /timing[_\s-]*v2/i.test(value));
  const declaresUnknownTiming = declarations.some((value) => /timing[_\s-]*v\d+/i.test(value))
    && !declaresTimingV2 && !declaresTimingV3 && !declaresTimingV4;
  if (declaresTimingV4) {
    return {
      timing: true,
      timingV2: false,
      timingV3: false,
      timingV4: true,
      variant: H02_TIMING_V4_VARIANT,
      label: "TIMING_V4",
      invalid: status?.variant !== H02_TIMING_V4_VARIANT
        || status?.renderer !== H02_TIMING_V4_RENDERER
        || !sameResolvedPath(status?.stagingRoot, files.timingV4Root)
    };
  }
  if (declaresTimingV3) {
    return {
      timing: true,
      timingV2: false,
      timingV3: true,
      timingV4: false,
      variant: H02_TIMING_V3_VARIANT,
      label: "TIMING_V3",
      invalid: !sameResolvedPath(status?.stagingRoot, files.timingV3Root)
    };
  }
  if (declaresTimingV2) {
    return {
      timing: true,
      timingV2: true,
      timingV3: false,
      timingV4: false,
      variant: H02_TIMING_V2_VARIANT,
      label: "TIMING_V2",
      invalid: !sameResolvedPath(status?.stagingRoot, files.timingV2Root)
    };
  }
  if (declaresUnknownTiming) {
    return { timing: true, timingV2: false, timingV3: false, timingV4: false, variant: null, label: "TIMING", invalid: true };
  }
  return { timing: false, timingV2: false, timingV3: false, timingV4: false, variant: null, label: null, invalid: false };
}

function activeRunFiles(status, files) {
  const declaration = timingDeclaration(status, files);
  if (!declaration.timing) {
    return {
      ...declaration,
      statusFile: files.statusFile,
      parentGenerationDir: files.parentGenerationDir,
      alternateTakesDir: files.alternateTakesDir,
      batchLedgerFile: files.batchLedgerFile,
      alignmentResultsFile: files.alignmentResultsFile,
      readyForReviewFile: null,
      stagingRoot: null
    };
  }
  if (declaration.timingV4) {
    return {
      ...declaration,
      statusFile: files.statusFile,
      parentGenerationDir: files.timingV4ParentGenerationDir,
      alternateTakesDir: files.timingV4AlternateTakesDir,
      batchLedgerFile: files.timingV4BatchLedgerFile,
      compiledPlanFile: files.timingV4CompiledPlanFile,
      alignmentResultsFile: files.timingV4AlignmentResultsFile,
      readyForReviewFile: null,
      stagingRoot: files.timingV4Root
    };
  }
  if (declaration.timingV3) {
    return {
      ...declaration,
      statusFile: files.statusFile,
      parentGenerationDir: files.timingV3ParentGenerationDir,
      alternateTakesDir: files.timingV3AlternateTakesDir,
      batchLedgerFile: files.timingV3BatchLedgerFile,
      compiledPlanFile: files.timingV3CompiledPlanFile,
      rawAlignmentPlanFile: files.timingV3RawAlignmentPlanFile,
      rawAlignmentResultsFile: files.timingV3RawAlignmentResultsFile,
      retryPlanFile: files.timingV3RetryPlanFile,
      alignmentPlanFile: files.timingV3AlignmentPlanFile,
      alignmentResultsFile: files.timingV3AlignmentResultsFile,
      readyForReviewFile: files.timingV3ReadyForReviewFile,
      promotionInputFile: files.timingV3PromotionInputFile,
      targetQaFile: files.timingV3TargetQaFile,
      sealTransactionFile: files.timingV3SealTransactionFile,
      stagingRoot: files.timingV3Root
    };
  }
  return {
    ...declaration,
    statusFile: files.statusFile,
    parentGenerationDir: files.timingV2ParentGenerationDir,
    alternateTakesDir: files.timingV2AlternateTakesDir,
    batchLedgerFile: files.timingV2BatchLedgerFile,
    alignmentResultsFile: files.timingV2AlignmentResultsFile,
    readyForReviewFile: files.timingV2ReadyForReviewFile,
    stagingRoot: files.timingV2Root
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readOptionalJson(file) {
  try {
    return fs.existsSync(file) ? readJson(file) : null;
  } catch {
    return null;
  }
}

function sha256File(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

// Review/admission decisions must never reuse a digest from an earlier poll.
// The general queue UI may cache immutable-looking media for display, but the
// TIMING_V3 trust boundary hashes every current byte at least once per gate.
function sha256FileUncached(file) {
  return sha256File(file);
}

function timestampMs(value) {
  const milliseconds = Date.parse(String(value || ""));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function fileTreeSnapshot(root, relativeTargets) {
  const trustedRoot = exactUnlinkedPath(root, "directory");
  if (!trustedRoot) throw new Error(`Promotion snapshot root contains a link/reparse point: ${root}`);
  const rows = [];
  for (const relative of relativeTargets) {
    const target = path.join(root, ...String(relative).split("/"));
    let targetStat;
    try {
      targetStat = fs.lstatSync(target);
    } catch (error) {
      if (error?.code === "ENOENT") {
        rows.push({ relativePath: relative, kind: "absent", files: [] });
        continue;
      }
      throw error;
    }
    if (targetStat.isSymbolicLink()) throw new Error(`Promotion target is a symbolic link: ${relative}`);
    if (targetStat.isFile()) {
      if (!exactUnlinkedPath(target, "file")) throw new Error(`Promotion target contains a reparse hop: ${relative}`);
      rows.push({
        relativePath: relative,
        kind: "file",
        files: [{ path: ".", bytes: targetStat.size, sha256: sha256File(target) }]
      });
      continue;
    }
    if (!targetStat.isDirectory()) throw new Error(`Unsupported promotion target type: ${relative}`);
    if (!exactUnlinkedPath(target, "directory")) throw new Error(`Promotion target contains a reparse hop: ${relative}`);
    const files = [];
    const pending = [target];
    while (pending.length) {
      const directory = pending.pop();
      if (!exactUnlinkedPath(directory, "directory")) throw new Error(`Promotion tree contains a reparse directory: ${directory}`);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const entryStat = fs.lstatSync(entryPath);
        if (entryStat.isSymbolicLink()) throw new Error(`Promotion target contains a symbolic link: ${entryPath}`);
        if (entryStat.isDirectory()) {
          if (!exactUnlinkedPath(entryPath, "directory")) throw new Error(`Promotion tree contains a reparse directory: ${entryPath}`);
          pending.push(entryPath);
          continue;
        }
        if (!entryStat.isFile()) throw new Error(`Unsupported promotion target entry: ${entryPath}`);
        if (!exactUnlinkedPath(entryPath, "file")) throw new Error(`Promotion tree contains a reparse file: ${entryPath}`);
        files.push({
          path: path.relative(target, entryPath).split(path.sep).join("/"),
          bytes: entryStat.size,
          sha256: sha256File(entryPath)
        });
      }
    }
    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    rows.push({ relativePath: relative, kind: "directory", files });
  }
  return rows;
}

function countWavFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.wav$/i.test(entry.name)).length;
  } catch {
    return 0;
  }
}

function wavFileNames(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.wav$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function processIsAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function normalizedState(value) {
  return String(value || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function numericCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function unitValues(ledger) {
  return ledger?.units && typeof ledger.units === "object"
    ? Object.entries(ledger.units).map(([key, unit]) => ({ ...unit, key: unit?.key || key }))
    : [];
}

function unitCounts(ledger) {
  const units = unitValues(ledger);
  return {
    total: units.length,
    done: units.filter((unit) => normalizedState(unit?.status) === "done").length,
    failed: units.filter((unit) => TERMINAL_ERROR_STATES.has(normalizedState(unit?.status))).length,
    generating: units.filter((unit) => ["generating", "running"].includes(normalizedState(unit?.status))).length
  };
}

function timingV3LineageCounts(ledger) {
  const units = unitValues(ledger);
  const reused = units.filter((unit) => unit?.retryAction === "reuse_v2_parent");
  const regenerated = units.filter((unit) => unit?.retryAction === "regenerate_v3_targeted");
  return {
    reused: reused.length,
    reusedDone: reused.filter((unit) => normalizedState(unit?.status) === "done").length,
    regenerated: regenerated.length,
    regeneratedDone: regenerated.filter((unit) => normalizedState(unit?.status) === "done").length
  };
}

function timingV4LineageCounts(ledger) {
  const units = unitValues(ledger);
  const reused = units.filter((unit) => unit?.retryAction === "reuse_v3_parent");
  const regenerated = units.filter((unit) => unit?.retryAction === "regenerate_v4_winner");
  return {
    reused: reused.length,
    reusedDone: reused.filter((unit) => normalizedState(unit?.status) === "done").length,
    regenerated: regenerated.length,
    regeneratedDone: regenerated.filter((unit) => normalizedState(unit?.status) === "done").length
  };
}

function outputValues(ledger) {
  return ledger?.outputs && typeof ledger.outputs === "object"
    ? Object.values(ledger.outputs)
    : [];
}

function completedOutputCount(ledger, allowlistedDirectory = null) {
  const allowlistedNames = allowlistedDirectory
    ? new Set(wavFileNames(allowlistedDirectory).map((name) => name.toLowerCase()))
    : null;
  return outputValues(ledger)
    .filter((output) => normalizedState(output?.status) === "done")
    .filter((output) => !allowlistedNames
      || allowlistedNames.has(path.basename(String(output?.file || "")).toLowerCase()))
    .length;
}

function alignmentCounts(alignment) {
  const items = alignment?.items && typeof alignment.items === "object"
    ? Object.values(alignment.items)
    : [];
  return {
    total: items.length,
    passed: items.filter((item) => normalizedState(item?.status) === "pass").length,
    failed: items.filter((item) => normalizedState(item?.status) === "fail").length
  };
}

function exactDirectFile(directory, candidate, expectedName = null) {
  if (!directory || !candidate) return null;
  try {
    const resolvedDirectory = path.resolve(directory);
    const resolvedCandidate = path.resolve(String(candidate));
    if (path.dirname(resolvedCandidate).toLowerCase() !== resolvedDirectory.toLowerCase()) return null;
    if (expectedName && path.basename(resolvedCandidate) !== expectedName) return null;
    const directoryStat = fs.lstatSync(resolvedDirectory);
    const candidateStat = fs.lstatSync(resolvedCandidate);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return null;
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) return null;
    const realDirectory = fs.realpathSync.native(resolvedDirectory);
    const realCandidate = fs.realpathSync.native(resolvedCandidate);
    if (path.dirname(realCandidate).toLowerCase() !== realDirectory.toLowerCase()) return null;
    return resolvedCandidate;
  } catch {
    return null;
  }
}

function exactUnlinkedPath(candidate, expectedKind) {
  if (!candidate) return null;
  try {
    const resolved = path.resolve(String(candidate));
    const parsed = path.parse(resolved);
    let cursor = parsed.root;
    const remainder = path.relative(parsed.root, resolved);
    for (const component of remainder.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      if (fs.lstatSync(cursor).isSymbolicLink()) return null;
    }
    const stat = fs.lstatSync(resolved);
    if (expectedKind === "file" && !stat.isFile()) return null;
    if (expectedKind === "directory" && !stat.isDirectory()) return null;
    const real = fs.realpathSync.native(resolved);
    if (path.resolve(real).toLowerCase() !== resolved.toLowerCase()) return null;
    return resolved;
  } catch {
    return null;
  }
}

function exactTimingV3Topology(run) {
  try {
    const stagingRoot = exactUnlinkedPath(run.stagingRoot, "directory");
    if (!stagingRoot) return false;
    const manifests = exactUnlinkedPath(path.join(stagingRoot, "MANIFESTS"), "directory");
    const qa = exactUnlinkedPath(path.join(stagingRoot, "QA"), "directory");
    const parents = exactUnlinkedPath(run.parentGenerationDir, "directory");
    const takes = exactUnlinkedPath(run.alternateTakesDir, "directory");
    if (!manifests || !qa || !parents || !takes) return false;
    if (
      !sameResolvedPath(manifests, path.join(stagingRoot, "MANIFESTS"))
      || !sameResolvedPath(qa, path.join(stagingRoot, "QA"))
      || !sameResolvedPath(parents, path.join(stagingRoot, "PARENT_GENERATIONS"))
      || !sameResolvedPath(takes, path.join(stagingRoot, "AUDITION_TAKES"))
    ) return false;
    const exactArtifacts = [
      [run.batchLedgerFile, manifests, "H02_QWEN_TIMING_V3_BATCH_STATE.json"],
      [run.compiledPlanFile, manifests, "H02_QWEN_TIMING_V3_COMPILED_PLAN.json"],
      [run.promotionInputFile, manifests, "H02_QWEN_TIMING_V3_SEALED_PROMOTION_INPUT.json"],
      [run.alignmentPlanFile, qa, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_PLAN.json"],
      [run.rawAlignmentPlanFile, qa, "H02_QWEN_TIMING_V3_ALIGNMENT_PLAN.json"],
      [run.rawAlignmentResultsFile, qa, "H02_QWEN_TIMING_V3_ALIGNMENT_RESULTS.json"],
      [run.alignmentResultsFile, qa, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS.json"],
      [run.targetQaFile, qa, "H02_QWEN_TIMING_V3_SEALED_TARGET_QA.json"],
      [run.sealTransactionFile, qa, "H02_QWEN_TIMING_V3_SEAL_TRANSACTION.json"],
      [run.readyForReviewFile, qa, "READY_FOR_CANONICAL_REVIEW_V3_SEALED.json"]
    ];
    if (run.statusFile) {
      const statusParent = exactUnlinkedPath(path.dirname(run.statusFile), "directory");
      if (
        !statusParent
        || !exactUnlinkedPath(run.statusFile, "file")
        || !exactDirectFile(statusParent, run.statusFile, "H02_BACKGROUND_QUEUE_STATUS.json")
      ) return false;
    }
    for (const [file, directory, name] of exactArtifacts) {
      if (!exactUnlinkedPath(file, "file") || !exactDirectFile(directory, file, name)) return false;
    }
    const retryParent = path.dirname(path.resolve(run.retryPlanFile));
    if (
      !exactUnlinkedPath(retryParent, "directory")
      || !exactUnlinkedPath(run.retryPlanFile, "file")
      || !exactDirectFile(retryParent, run.retryPlanFile, "H02_QWEN_TIMING_V3_TARGETED_RETRY_PLAN.json")
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function exactHash(value, expected) {
  const left = String(value || "").toLowerCase();
  const right = String(expected || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(left) && left === right;
}

const H02_ASR_COMPARISON_METHOD = "exact-authored-plus-explicit-homophone-orthography-v1";
const H02_ASR_ORTHOGRAPHY_RULES = Object.freeze([
  { rule: "forsake_vs_for_sake", left: ["forsake"], right: ["for", "sake"] },
  { rule: "son_vs_sun", left: ["son"], right: ["sun"] }
]);

function compareH02WordSequences(authoredValue, observedValue) {
  const authored = Array.isArray(authoredValue) ? authoredValue.map(String) : [];
  const observed = Array.isArray(observedValue) ? observedValue.map(String) : [];
  const memo = new Map();
  const solve = (ai, oi) => {
    const memoKey = `${ai}:${oi}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    if (ai === authored.length && oi === observed.length) return [];
    if (ai >= authored.length || oi >= observed.length) return null;
    if (authored[ai] === observed[oi]) {
      const tail = solve(ai + 1, oi + 1);
      if (tail) return tail;
    }
    for (const rule of H02_ASR_ORTHOGRAPHY_RULES) {
      for (const [left, right] of [[rule.left, rule.right], [rule.right, rule.left]]) {
        if (
          exactJsonEqual(authored.slice(ai, ai + left.length), left)
          && exactJsonEqual(observed.slice(oi, oi + right.length), right)
        ) {
          const tail = solve(ai + left.length, oi + right.length);
          if (tail) {
            return [{
              rule: rule.rule,
              authoredWords: left,
              asrWords: right,
              authoredStart: ai,
              authoredEnd: ai + left.length,
              asrStart: oi,
              asrEnd: oi + right.length
            }, ...tail];
          }
        }
      }
    }
    memo.set(memoKey, null);
    return null;
  };
  const equivalences = solve(0, 0);
  return equivalences === null ? null : equivalences;
}

function exactFiniteWordRows(rows, observedWords) {
  if (!Array.isArray(rows) || rows.length !== observedWords.length) return false;
  let priorStart = -1;
  let priorEnd = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      String(row?.word || "") !== observedWords[index]
      || !Number.isFinite(row?.start) || !Number.isFinite(row?.end)
      || row.start < 0 || row.end < row.start
      || row.start < priorStart || row.end < priorEnd
      || (row?.probability != null && (!Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1))
    ) return false;
    priorStart = row.start;
    priorEnd = row.end;
  }
  return true;
}

function exactOrderedKeys(rows, expectedKeys) {
  if (!Array.isArray(rows) || rows.length !== expectedKeys.length) return false;
  const keys = rows.map((row) => String(row?.key || ""));
  return new Set(keys).size === keys.length && exactJsonEqual(keys, expectedKeys);
}

function exactDirectoryFiles(directory, expectedPaths) {
  try {
    const actual = fs.readdirSync(directory, { withFileTypes: true });
    if (actual.some((entry) => !entry.isFile() || entry.isSymbolicLink())) return false;
    const actualPaths = actual.map((entry) => path.resolve(directory, entry.name).toLowerCase()).sort();
    const expected = expectedPaths.map((entry) => path.resolve(entry).toLowerCase()).sort();
    return exactJsonEqual(actualPaths, expected);
  } catch {
    return false;
  }
}

function validateTimingV3ArtifactGraph({
  status,
  run,
  ledger,
  readyForReview,
  promotionInput,
  compiledPlan,
  retryPlan,
  rawAlignmentPlan,
  rawAlignmentResults,
  alignmentPlan,
  alignment,
  targetQa,
  sealTransaction,
  currentLedgerSha256
}) {
  try {
    if (!exactTimingV3Topology(run)) return false;
    const currentHashes = new Map();
    const trustedSha256File = (file) => {
      const key = path.resolve(String(file)).toLowerCase();
      if (!currentHashes.has(key)) currentHashes.set(key, sha256FileUncached(file));
      return currentHashes.get(key);
    };
    const runId = String(status?.runId || "");
    const generationPlanSha = String(ledger?.generationPlanSha256 || "").toLowerCase();
    const compiledPlanSha = trustedSha256File(run.compiledPlanFile);
    const rawAlignmentPlanSha = trustedSha256File(run.rawAlignmentPlanFile);
    const rawAlignmentResultsSha = trustedSha256File(run.rawAlignmentResultsFile);
    const alignmentPlanSha = trustedSha256File(run.alignmentPlanFile);
    const alignmentSha = trustedSha256File(run.alignmentResultsFile);
    const targetQaSha = trustedSha256File(run.targetQaFile);
    const promotionSha = trustedSha256File(run.promotionInputFile);
    const transactionSha = trustedSha256File(run.sealTransactionFile);
    if (
      !/^[a-f0-9]{32}$/.test(runId)
      || !exactHash(generationPlanSha, H02_TIMING_V3_GENERATION_PLAN_SHA256)
      || !exactHash(trustedSha256File(run.retryPlanFile), H02_TIMING_V3_RETRY_PLAN_SHA256)
      || retryPlan?.artifactType !== "H02_QWEN_TIMING_V3_TARGETED_RETRY_PLAN"
      || retryPlan?.variant !== H02_TIMING_V3_VARIANT
      || !Array.isArray(retryPlan?.regenerateParentKeys)
      || retryPlan.regenerateParentKeys.length !== 44
      || new Set(retryPlan.regenerateParentKeys).size !== 44
      || compiledPlan?.artifactType !== "H02_QWEN_TIMING_V3_COMPILED_PLAN"
      || compiledPlan?.variant !== H02_TIMING_V3_VARIANT
      || !exactHash(compiledPlan?.generationPlanSha256, generationPlanSha)
      || !exactHash(ledger?.compiledPlan?.sha256, compiledPlanSha)
      || !sameResolvedPath(ledger?.compiledPlan?.file, run.compiledPlanFile)
      || !Array.isArray(compiledPlan?.units)
      || compiledPlan.units.length !== 72
      || !Array.isArray(compiledPlan?.cues)
      || compiledPlan.cues.length !== 34
    ) return false;
    if (
      rawAlignmentPlan?.schemaVersion !== 1
      || rawAlignmentResults?.schemaVersion !== 1
      || !exactHash(rawAlignmentResults?.planSha256, rawAlignmentPlanSha)
      || !Array.isArray(rawAlignmentPlan?.items)
      || !rawAlignmentResults?.items || typeof rawAlignmentResults.items !== "object"
    ) return false;

    const unitEntries = Object.entries(ledger?.units || {});
    const outputEntries = Object.entries(ledger?.outputs || {});
    const unitKeys = unitEntries.map(([key]) => key);
    const outputKeys = outputEntries.map(([key]) => key);
    const compiledKeys = compiledPlan.units.map((unit) => String(unit?.key || ""));
    if (
      unitEntries.length !== 72
      || outputEntries.length !== 102
      || new Set(unitKeys).size !== 72
      || new Set(outputKeys).size !== 102
      || !exactJsonEqual(unitKeys, compiledKeys)
      || !exactOrderedKeys(promotionInput?.parents, unitKeys)
      || !exactOrderedKeys(promotionInput?.takes, outputKeys)
    ) return false;

    const compiledByKey = new Map(compiledPlan.units.map((unit) => [String(unit?.key || ""), unit]));
    const cuesById = new Map(compiledPlan.cues.map((cue) => [String(cue?.cue_id || ""), cue]));
    if (cuesById.size !== 34) return false;
    const retryKeys = new Set(retryPlan.regenerateParentKeys.map(String));
    const expectedRetryKeys = unitKeys.filter((key) => retryKeys.has(key));
    if (expectedRetryKeys.length !== 44 || !exactJsonEqual(expectedRetryKeys, retryPlan.regenerateParentKeys.map(String))) return false;
    const promotionParents = new Map(promotionInput.parents.map((row) => [String(row.key), row]));
    const promotionTakes = new Map(promotionInput.takes.map((row) => [String(row.key), row]));
    const parentPaths = [];
    let reused = 0;
    let regenerated = 0;
    for (const [key, unit] of unitEntries) {
      const compiled = compiledByKey.get(key);
      const promoted = promotionParents.get(key);
      const expectedAction = retryKeys.has(key) ? "regenerate_v3_targeted" : "reuse_v2_parent";
      const expectedName = `${key.replaceAll(":", "_")}.native-${unit?.nativeSampleRate}-f32.wav`;
      const parentFile = exactDirectFile(run.parentGenerationDir, unit?.nativeFile, expectedName);
      const lineage = unit?.lineage;
      if (
        !compiled || !promoted || !parentFile
        || unit?.key !== key
        || unit?.status !== "done"
        || unit?.exactAsrPass !== true
        || unit?.retryAction !== expectedAction
        || compiled?.retryAction !== expectedAction
        || !exactJsonEqual(unit?.cueIds, compiled?.cueIds)
        || !Number.isInteger(unit?.seed) || unit.seed !== compiled?.seed
        || unit?.speaker !== compiled?.speaker
        || unit?.combinedText !== compiled?.combinedText
        || unit?.generationText !== compiled?.generationText
        || !exactHash(unit?.generationTextSha256, compiled?.generationTextSha256)
        || !exactHash(unit?.nativeSha256, trustedSha256File(parentFile))
        || !lineage || lineage?.action !== expectedAction
        || lineage?.sourceRunId !== H02_TIMING_V3_SOURCE_RUN_ID
        || !exactHash(lineage?.sourceLedgerSha256, H02_TIMING_V3_SOURCE_LEDGER_SHA256)
        || !exactHash(lineage?.sourceParentSha256, unit?.sourceParentSha256)
        || !exactHash(lineage?.v3GenerationTextSha256, unit?.generationTextSha256)
        || promoted?.retryAction !== expectedAction
        || promoted?.seed !== unit?.seed
        || promoted?.speaker !== unit?.speaker
        || !exactJsonEqual(promoted?.cueIds, unit?.cueIds)
        || promoted?.generationText !== unit?.generationText
        || !exactHash(promoted?.generationTextSha256, unit?.generationTextSha256)
        || !sameResolvedPath(promoted?.file, parentFile)
        || !exactHash(promoted?.sha256, unit?.nativeSha256)
        || promoted?.sampleRate !== unit?.nativeSampleRate
        || promoted?.frames !== unit?.nativeFrames
        || promoted?.durationSec !== unit?.nativeDurationSec
        || promoted?.exactAsrPass !== true
        || !exactJsonEqual(promoted?.lineage, lineage)
      ) return false;
      if (expectedAction === "reuse_v2_parent") {
        reused += 1;
        if (!exactHash(unit?.nativeSha256, unit?.sourceParentSha256)) return false;
      } else {
        regenerated += 1;
      }
      parentPaths.push(parentFile);
    }
    if (reused !== 28 || regenerated !== 44 || !exactDirectoryFiles(run.parentGenerationDir, parentPaths)) return false;

    const takePaths = [];
    for (const [key, take] of outputEntries) {
      const promoted = promotionTakes.get(key);
      const parent = ledger.units?.[take?.parentUnit];
      const expectedKey = `${take?.cueId}:seed-${take?.seed}`;
      const expectedName = `${take?.cueId}_${take?.segmentId}_${take?.speaker}_TAKE_S${take?.seed}.wav`;
      const takeFile = exactDirectFile(run.alternateTakesDir, take?.file, expectedName);
      if (
        key !== expectedKey || !promoted || !parent || !takeFile
        || take?.status !== "done"
        || !Array.isArray(parent?.cueIds) || !parent.cueIds.includes(take?.cueId)
        || !Number.isInteger(take?.seed) || parent?.seed !== take.seed
        || !sameResolvedPath(take?.parentFile, parent?.nativeFile)
        || !exactHash(take?.parentSha256, parent?.nativeSha256)
        || !exactHash(take?.sha256, trustedSha256File(takeFile))
        || take?.sampleRate !== 48000 || take?.channels !== 1
        || take?.bitDepth !== 24 || take?.codec !== "pcm_s24le"
        || take?.limiterUsed !== false || take?.wordErrorCount !== 0
        || promoted?.cueId !== take?.cueId || promoted?.segmentId !== take?.segmentId
        || promoted?.speaker !== take?.speaker || promoted?.seed !== take?.seed
        || promoted?.dialogue !== take?.dialogue || promoted?.parentUnit !== take?.parentUnit
        || !exactHash(promoted?.parentSha256, take?.parentSha256)
        || !sameResolvedPath(promoted?.file, takeFile)
        || !exactHash(promoted?.sha256, take?.sha256)
        || promoted?.measuredDurationSec !== take?.measuredDurationSec
        || promoted?.sampleRate !== take?.sampleRate || promoted?.channels !== take?.channels
        || promoted?.bitDepth !== take?.bitDepth || promoted?.codec !== take?.codec
        || promoted?.limiterUsed !== take?.limiterUsed || promoted?.gainScope !== take?.gainScope
        || promoted?.wordErrorCount !== take?.wordErrorCount
      ) return false;
      takePaths.push(takeFile);
    }
    if (!exactDirectoryFiles(run.alternateTakesDir, takePaths)) return false;

    const expectedSealId = String(promotionInput?.sealId || "");
    const commonArtifactContract = (artifact, artifactType) => Boolean(
      artifact?.schemaVersion === 3
      && artifact?.artifactType === artifactType
      && artifact?.variant === H02_TIMING_V3_VARIANT
      && String(artifact?.runId || "") === runId
      && String(artifact?.currentValidationRunId || "") === runId
      && sameResolvedPath(artifact?.ledgerFile, run.batchLedgerFile)
      && exactHash(artifact?.ledgerSha256, currentLedgerSha256)
      && exactHash(artifact?.generationPlanSha256, generationPlanSha)
      && /^[A-Fa-f0-9]{64}$/.test(String(artifact?.sealId || ""))
      && String(artifact?.sealId || "") === expectedSealId
      && artifact?.sealedAt === promotionInput?.sealedAt
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(artifact?.sealedAt || ""))
      && artifact?.producerValidationBasisAt === promotionInput?.producerValidationBasisAt
      && exactHash(artifact?.audioSnapshotSha256, promotionInput?.audioSnapshotSha256)
      && sameResolvedPath(artifact?.terminalStatusFile, run.statusFile)
      && exactHash(artifact?.terminalStatusSha256, status?.producerTerminalStatusSha256)
      && artifact?.terminalStatusState === status?.producerTerminalStatusState
      && exactHash(artifact?.producerTerminalStatusSha256, status?.producerTerminalStatusSha256)
      && artifact?.producerTerminalStatusState === status?.producerTerminalStatusState
      && sameResolvedPath(artifact?.sourceRawAlignmentPlanFile, run.rawAlignmentPlanFile)
      && exactHash(artifact?.sourceRawAlignmentPlanSha256, rawAlignmentPlanSha)
      && sameResolvedPath(artifact?.sourceRawAlignmentResultsFile, run.rawAlignmentResultsFile)
      && exactHash(artifact?.sourceRawAlignmentResultsSha256, rawAlignmentResultsSha)
    );
    if (
      !commonArtifactContract(alignmentPlan, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_PLAN")
      || alignmentPlan?.parentCount !== 72
      || !exactOrderedKeys(alignmentPlan?.items, unitKeys)
      || !exactJsonEqual(alignmentPlan?.items, rawAlignmentPlan?.items)
      || !commonArtifactContract(alignment, "H02_QWEN_TIMING_V3_SEALED_ALIGNMENT_RESULTS")
      || !sameResolvedPath(alignment?.alignmentPlanFile, run.alignmentPlanFile)
      || !exactHash(alignment?.alignmentPlanSha256, alignmentPlanSha)
      || alignment?.allPassed !== true || alignment?.parentCount !== 72
      || alignment?.passCount !== 72 || alignment?.failureCount !== 0
      || !alignment?.items || typeof alignment.items !== "object"
      || !exactJsonEqual(Object.keys(alignment.items), unitKeys)
      || !exactJsonEqual(alignment.items, rawAlignmentResults.items)
    ) return false;
    const planItems = new Map(alignmentPlan.items.map((item) => [String(item.key), item]));
    for (const [key, unit] of unitEntries) {
      const planItem = planItems.get(key);
      const result = alignment.items[key];
      const expectedWords = Array.isArray(result?.expectedWords) ? result.expectedWords.map(String) : [];
      const observedWords = Array.isArray(result?.observedWords) ? result.observedWords.map(String) : [];
      const equivalences = compareH02WordSequences(expectedWords, observedWords);
      if (
        !planItem || !result
        || !sameResolvedPath(planItem?.audioFile, unit?.nativeFile)
        || planItem?.combinedText !== unit?.combinedText
        || planItem?.firstText !== unit?.firstText
        || planItem?.secondText !== unit?.secondText
        || result?.status !== "pass"
        || result?.wordErrorCount !== 0
        || !sameResolvedPath(result?.audioFile, unit?.nativeFile)
        || !exactHash(result?.audioSha256, unit?.nativeSha256)
        || !exactJsonEqual(result?.expectedWords, unit?.asrExpectedWords)
        || !exactJsonEqual(result?.observedWords, unit?.asrObservedWords)
        || result?.comparisonMethod !== H02_ASR_COMPARISON_METHOD
        || equivalences === null
        || !exactJsonEqual(result?.asrOrthographyEquivalences, equivalences)
        || !exactFiniteWordRows(result?.words, observedWords)
      ) return false;
    }

    if (
      !commonArtifactContract(targetQa, "H02_QWEN_TIMING_V3_SEALED_TARGET_QA")
      || targetQa?.status !== "PASS"
      || targetQa?.passCount !== 102 || targetQa?.failureCount !== 0
      || !sameResolvedPath(targetQa?.alignmentPlanFile, run.alignmentPlanFile)
      || !exactHash(targetQa?.alignmentPlanSha256, alignmentPlanSha)
      || !sameResolvedPath(targetQa?.alignmentResultsFile, run.alignmentResultsFile)
      || !exactHash(targetQa?.alignmentResultsSha256, alignmentSha)
      || targetQa?.takeDerivation?.status !== "PASS"
      || targetQa?.takeDerivation?.parentsVerified !== 72
      || targetQa?.takeDerivation?.takesVerified !== 102
      || !Array.isArray(targetQa?.rows) || targetQa.rows.length !== 102
    ) return false;
    const qaKeys = targetQa.rows.map((row) => `${row?.cue_id}:seed-${row?.seed}`);
    if (new Set(qaKeys).size !== 102 || !exactJsonEqual(qaKeys, outputKeys)) return false;
    const qaRowKeys = [
      "allowed_error_sec", "cue_id", "duration_error_sec", "measured_duration_sec",
      "parent_key", "qa_result", "seed", "take_file", "take_sha256", "target_duration_sec"
    ];
    for (const row of targetQa.rows) {
      const key = `${row?.cue_id}:seed-${row?.seed}`;
      const take = ledger.outputs[key];
      const cue = cuesById.get(String(row?.cue_id || ""));
      const measured = take?.measuredDurationSec;
      const target = cue?.target_duration_sec;
      const allowed = Number.isFinite(target) ? Math.max(1.25, target * 0.20) : NaN;
      const error = Number.isFinite(measured) && Number.isFinite(target) ? Math.abs(measured - target) : NaN;
      if (
        !take || !cue
        || !exactJsonEqual(Object.keys(row).sort(), qaRowKeys)
        || !Number.isInteger(row?.seed) || row.seed !== take.seed
        || row?.parent_key !== take?.parentUnit || row?.qa_result !== "PASS"
        || !Number.isFinite(measured) || measured <= 0
        || !Number.isFinite(target) || target <= 0
        || row?.target_duration_sec !== target.toFixed(3)
        || row?.measured_duration_sec !== measured.toFixed(6)
        || row?.allowed_error_sec !== allowed.toFixed(6)
        || row?.duration_error_sec !== error.toFixed(6)
        || error > allowed + 1e-9
        || !sameResolvedPath(row?.take_file, take?.file)
        || !exactHash(row?.take_sha256, take?.sha256)
      ) return false;
    }

    const boundArtifacts = (artifact) => Boolean(
      sameResolvedPath(artifact?.compiledPlanFile, run.compiledPlanFile)
      && exactHash(artifact?.compiledPlanSha256, compiledPlanSha)
      && sameResolvedPath(artifact?.alignmentPlanFile, run.alignmentPlanFile)
      && exactHash(artifact?.alignmentPlanSha256, alignmentPlanSha)
      && sameResolvedPath(artifact?.alignmentResultsFile, run.alignmentResultsFile)
      && exactHash(artifact?.alignmentResultsSha256, alignmentSha)
      && sameResolvedPath(artifact?.targetQaFile, run.targetQaFile)
      && exactHash(artifact?.targetQaSha256, targetQaSha)
    );
    const expectedTransactionTargets = [
      { file: path.resolve(run.alignmentPlanFile), sha256: alignmentPlanSha },
      { file: path.resolve(run.alignmentResultsFile), sha256: alignmentSha },
      { file: path.resolve(run.targetQaFile), sha256: targetQaSha },
      { file: path.resolve(run.promotionInputFile), sha256: promotionSha }
    ];
    const transactionTargets = Array.isArray(sealTransaction?.targets)
      ? sealTransaction.targets.map((target) => ({
        file: path.resolve(String(target?.file || "")),
        sha256: String(target?.sha256 || "").toLowerCase()
      }))
      : null;
    const recomputedSealId = canonicalJsonSha256({
      variant: H02_TIMING_V3_VARIANT,
      runId,
      ledgerSha256: promotionInput?.ledgerSha256,
      compiledPlanSha256: promotionInput?.compiledPlanSha256,
      rawPlanSha256: promotionInput?.sourceRawAlignmentPlanSha256,
      rawResultsSha256: promotionInput?.sourceRawAlignmentResultsSha256,
      audioSnapshotSha256: promotionInput?.audioSnapshotSha256,
      terminalStatusSha256: promotionInput?.terminalStatusSha256
    });
    return Boolean(
      promotionInput?.artifactType === "H02_QWEN_TIMING_V3_SEALED_PROMOTION_INPUT"
      && promotionInput?.schemaVersion === 3
      && promotionInput?.compatibilityProfile === H02_TIMING_V3_COMPATIBILITY_PROFILE
      && promotionInput?.variant === H02_TIMING_V3_VARIANT
      && promotionInput?.status === "PASS"
      && exactHash(promotionInput?.sealId, recomputedSealId)
      && String(promotionInput?.runId || "") === runId
      && String(promotionInput?.currentValidationRunId || "") === runId
      && sameResolvedPath(promotionInput?.ledgerFile, run.batchLedgerFile)
      && exactHash(promotionInput?.ledgerSha256, currentLedgerSha256)
      && exactHash(promotionInput?.sourceV2LedgerSha256, H02_TIMING_V3_SOURCE_LEDGER_SHA256)
      && exactHash(promotionInput?.retryPlanSha256, H02_TIMING_V3_RETRY_PLAN_SHA256)
      && exactHash(promotionInput?.auditSha256, H02_TIMING_V3_AUDIT_SHA256)
      && exactHash(promotionInput?.generationPlanSha256, generationPlanSha)
      && boundArtifacts(promotionInput)
      && Number.isInteger(promotionInput?.counts?.parents) && promotionInput.counts.parents === 72
      && Number.isInteger(promotionInput?.counts?.reusedParents) && promotionInput.counts.reusedParents === 28
      && Number.isInteger(promotionInput?.counts?.regeneratedParents) && promotionInput.counts.regeneratedParents === 44
      && Number.isInteger(promotionInput?.counts?.takes) && promotionInput.counts.takes === 102
      && sealTransaction?.schemaVersion === 3
      && sealTransaction?.artifactType === "H02_QWEN_TIMING_V3_SEAL_TRANSACTION"
      && sealTransaction?.state === "COMMITTED"
      && sealTransaction?.variant === H02_TIMING_V3_VARIANT
      && String(sealTransaction?.runId || "") === runId
      && String(sealTransaction?.currentValidationRunId || "") === runId
      && String(sealTransaction?.sealId || "") === String(promotionInput?.sealId || "")
      && /^[A-Fa-f0-9]{64}$/.test(String(sealTransaction?.transactionId || ""))
      && exactHash(sealTransaction?.transactionId, canonicalJsonSha256({
        sealId: expectedSealId,
        alignmentPlanSha256: alignmentPlanSha,
        alignmentResultsSha256: alignmentSha,
        targetQaSha256: targetQaSha,
        promotionInputSha256: promotionSha
      }))
      && sameResolvedPath(sealTransaction?.ledgerFile, run.batchLedgerFile)
      && exactHash(sealTransaction?.ledgerSha256, currentLedgerSha256)
      && exactHash(sealTransaction?.audioSnapshotSha256, promotionInput?.audioSnapshotSha256)
      && sealTransaction?.sealedAt === promotionInput?.sealedAt
      && sameResolvedPath(sealTransaction?.producerTerminalStatusFile, run.statusFile)
      && exactHash(sealTransaction?.producerTerminalStatusSha256, status?.producerTerminalStatusSha256)
      && sealTransaction?.producerTerminalStatusState === status?.producerTerminalStatusState
      && sameResolvedPath(sealTransaction?.readyMarkerFile, run.readyForReviewFile)
      && transactionTargets !== null
      && exactJsonEqual(transactionTargets, expectedTransactionTargets)
      && readyForReview?.artifactType === "H02_QWEN_TIMING_V3_SEALED_READY"
      && readyForReview?.schemaVersion === 3
      && readyForReview?.status === "PASS"
      && readyForReview?.variant === H02_TIMING_V3_VARIANT
      && readyForReview?.compatibilityProfile === H02_TIMING_V3_COMPATIBILITY_PROFILE
      && String(readyForReview?.runId || "") === runId
      && String(readyForReview?.currentValidationRunId || "") === runId
      && String(readyForReview?.sealId || "") === String(sealTransaction?.sealId || "")
      && String(readyForReview?.sealTransactionId || "") === String(sealTransaction?.transactionId || "")
      && sameResolvedPath(readyForReview?.sealTransactionFile, run.sealTransactionFile)
      && exactHash(readyForReview?.sealTransactionSha256, transactionSha)
      && sameResolvedPath(readyForReview?.ledgerFile, run.batchLedgerFile)
      && exactHash(readyForReview?.ledgerSha256, currentLedgerSha256)
      && exactHash(readyForReview?.generationPlanSha256, generationPlanSha)
      && boundArtifacts(readyForReview)
      && sameResolvedPath(readyForReview?.promotionInputManifestFile, run.promotionInputFile)
      && exactHash(readyForReview?.promotionInputManifestSha256, promotionSha)
      && sameResolvedPath(status?.sealedReviewMarkerFile, run.readyForReviewFile)
      && exactHash(status?.sealedReviewMarkerSha256, trustedSha256File(run.readyForReviewFile))
      && String(status?.sealTransactionId || "") === String(sealTransaction?.transactionId || "")
      && readyForReview?.parentCount === 72
      && readyForReview?.reusedParentCount === 28
      && readyForReview?.regeneratedParentCount === 44
      && readyForReview?.takeCount === 102
      && readyForReview?.exactAsrPassCount === 72
      && readyForReview?.timingQaPassCount === 102
      && readyForReview?.canonicalV1Mutated === false
      && readyForReview?.timingV2Mutated === false
    );
  } catch {
    return false;
  }
}

function timingReviewGate({
  status,
  run,
  ledger,
  ledgerCounts,
  alignmentSummary,
  completedTakes,
  plannedTakeCount,
  readyForReview,
  promotionInput,
  compiledPlan,
  retryPlan,
  rawAlignmentPlan,
  rawAlignmentResults,
  alignmentPlan,
  alignment,
  targetQa,
  sealTransaction
}) {
  if (!run.timing || run.invalid) {
    return {
      validated: false,
      staleMarker: false,
      markerMatchesLedger: false,
      runIdMatches: false,
      generationPlanMatches: false,
      successfulHandoff: false,
      currentLedgerSha256: null
    };
  }
  const externalState = normalizedState(status?.state);
  const currentLedgerSha256 = run.timingV3
    ? sha256FileUncached(run.batchLedgerFile)
    : sha256File(run.batchLedgerFile);
  const declaredLedgerSha256 = String(readyForReview?.ledgerSha256 || "").toLowerCase();
  const markerMatchesLedger = Boolean(
    currentLedgerSha256
    && /^[a-f0-9]{64}$/.test(declaredLedgerSha256)
    && declaredLedgerSha256 === currentLedgerSha256
  );
  const markerValidatedAt = timestampMs(readyForReview?.validatedAt);
  const statusUpdatedAt = timestampMs(status?.updatedAt);
  const statusRunId = String(status?.runId || "");
  const runIdMatches = Boolean(
    /^[a-f0-9]{32}$/.test(statusRunId)
    && String(readyForReview?.runId || "") === statusRunId
    && String(ledger?.activeRunId || "") === statusRunId
  );
  const ledgerGenerationPlanSha256 = String(ledger?.generationPlanSha256 || "").toLowerCase();
  const generationPlanMatches = Boolean(
    /^[a-f0-9]{64}$/.test(ledgerGenerationPlanSha256)
    && String(readyForReview?.generationPlanSha256 || "").toLowerCase() === ledgerGenerationPlanSha256
  );
  const successfulHandoff = Boolean(
    externalState === "awaiting_review"
    && status?.stagingReady === true
    && Number.isInteger(status?.exitCode)
    && status.exitCode === 0
    && status?.readOnly === true
    && status?.external === true
    && status?.usesComfyUiForSynthesis === false
    && status?.canonicalV1MutationAllowed === false
    && (!run.timingV3 || status?.timingV2MutationAllowed === false)
    && runIdMatches
    && markerValidatedAt != null
    && statusUpdatedAt != null
    && statusUpdatedAt >= markerValidatedAt
  );
  const markerBindingsValid = Boolean(
    normalizedState(readyForReview?.status) === "pass"
    && String(readyForReview?.variant || "") === run.variant
    && readyForReview?.canonicalV1Mutated === false
    && sameResolvedPath(readyForReview?.ledgerFile, run.batchLedgerFile)
    && String(ledger?.variant || "") === run.variant
    && sameResolvedPath(ledger?.outputRoot, run.stagingRoot)
    && generationPlanMatches
    && markerMatchesLedger
  );
  const timingV3BindingsValid = !run.timingV3 || Boolean(
    status?.variant === H02_TIMING_V3_VARIANT
    && status?.canonicalV1MutationAllowed === false
    && status?.timingV2MutationAllowed === false
    && exactHash(status?.retryPlanSha256, H02_TIMING_V3_RETRY_PLAN_SHA256)
    && exactHash(status?.auditSha256, H02_TIMING_V3_AUDIT_SHA256)
    && exactHash(status?.generationPlanSha256, H02_TIMING_V3_GENERATION_PLAN_SHA256)
    && ledger?.canonicalV1MutationAllowed === false
    && ledger?.timingV2MutationAllowed === false
    && Number.isInteger(ledger?.reusedParentCount) && ledger.reusedParentCount === 28
    && Number.isInteger(ledger?.regeneratedParentCount) && ledger.regeneratedParentCount === 44
    && validateTimingV3ArtifactGraph({
      status,
      run,
      ledger,
      readyForReview,
      promotionInput,
      compiledPlan,
      retryPlan,
      rawAlignmentPlan,
      rawAlignmentResults,
      alignmentPlan,
      alignment,
      targetQa,
      sealTransaction,
      currentLedgerSha256
    })
  );
  const markerCountsValid = Boolean(
    ledgerCounts.total > 0
    && ledgerCounts.done === ledgerCounts.total
    && alignmentSummary.total === ledgerCounts.total
    && alignmentSummary.passed === alignmentSummary.total
    && alignmentSummary.failed === 0
    && completedTakes === plannedTakeCount
    && ledger?.auditionSetValidated === true
    && numericCount(ledger?.auditionFileCount) === plannedTakeCount
    && Number.isInteger(readyForReview?.parentCount) && readyForReview.parentCount === ledgerCounts.total
    && Number.isInteger(readyForReview?.takeCount) && readyForReview.takeCount === plannedTakeCount
    && Number.isInteger(readyForReview?.exactAsrPassCount) && readyForReview.exactAsrPassCount === alignmentSummary.passed
    && Number.isInteger(readyForReview?.timingQaPassCount) && readyForReview.timingQaPassCount === plannedTakeCount
  );
  const validated = markerBindingsValid && timingV3BindingsValid && markerCountsValid && successfulHandoff;
  return {
    validated,
    staleMarker: normalizedState(readyForReview?.status) === "pass" && !validated,
    markerMatchesLedger,
    runIdMatches,
    generationPlanMatches,
    successfulHandoff,
    currentLedgerSha256
  };
}

function timingPromotionGate({ files, status, run, ledger, readyForReview, reviewGate }) {
  if (!run.timingV2 || run.timingV3 || run.invalid || !fs.existsSync(files.promotionManifestFile)) {
    return { present: false, validated: false, error: null };
  }
  try {
    if (!reviewGate.validated) {
      throw new Error("Canonical promotion cannot be bound to the current validated TIMING_V2 review run.");
    }
    const promotion = readJson(files.promotionManifestFile);
    const runId = String(promotion?.runId || "");
    const promotionId = safeIdentifier(promotion?.promotionId);
    const transactionId = safeIdentifier(promotion?.transactionId);
    if (
      promotion?.schemaVersion !== 1
      || promotion?.artifactType !== H02_TIMING_V2_PROMOTION_ARTIFACT
      || promotion?.status !== "COMMITTED"
      || promotion?.variant !== H02_TIMING_V2_VARIANT
      || !/^[a-f0-9]{32}$/.test(runId)
      || !promotionId
      || !transactionId
    ) {
      throw new Error("Canonical TIMING_V2 promotion pointer is not a committed schema-v1 transaction.");
    }
    if (
      runId !== String(status?.runId || "")
      || runId !== String(readyForReview?.runId || "")
      || runId !== String(ledger?.activeRunId || "")
    ) {
      throw new Error("Canonical TIMING_V2 promotion belongs to a different review run.");
    }
    if (
      !sameResolvedPath(promotion?.sourceStagingRoot, run.stagingRoot)
      || !sameResolvedPath(promotion?.authoritativeCueSheetFile, files.authoritativeCueSheetFile)
      || !sameResolvedPath(promotion?.voiceMappingFile, files.voiceMappingFile)
      || !sameResolvedPath(promotion?.canonicalOutputRoot, files.root)
    ) {
      throw new Error("Canonical TIMING_V2 promotion roots do not match the exact allowlist.");
    }

    const sourceHashes = promotion?.sourceHashes;
    if (
      !sourceHashes
      || typeof sourceHashes !== "object"
      || !exactJsonEqual(Object.keys(sourceHashes).sort(), [...H02_TIMING_V2_SOURCE_HASH_KEYS].sort())
      || H02_TIMING_V2_SOURCE_HASH_KEYS.some((key) => !/^[a-f0-9]{64}$/i.test(String(sourceHashes[key] || "")))
    ) {
      throw new Error("Canonical TIMING_V2 promotion source-hash contract changed.");
    }
    const promotionFingerprint = canonicalJsonSha256({ runId, sourceHashes });
    if (
      String(promotion?.promotionFingerprint || "").toLowerCase() !== promotionFingerprint
      || promotionId !== `${runId}-${promotionFingerprint.slice(0, 16)}`
      || String(sourceHashes.ledger).toLowerCase() !== String(reviewGate.currentLedgerSha256 || "").toLowerCase()
    ) {
      throw new Error("Canonical TIMING_V2 promotion fingerprint or source ledger hash is stale.");
    }

    const sourceFileBindings = {
      status: files.statusFile,
      readyMarker: run.readyForReviewFile,
      ledger: run.batchLedgerFile,
      alignmentPlan: files.timingV2AlignmentPlanFile,
      alignment: run.alignmentResultsFile,
      timingQaJson: files.timingV2TimingQaJsonFile,
      timingQaCsv: files.timingV2TimingQaCsvFile,
      slowReferenceManifest: files.timingV2SlowReferenceManifestFile,
      slowReferenceAsrPlan: files.timingV2SlowReferenceAsrPlanFile,
      slowReferenceAsr: files.timingV2SlowReferenceAsrFile,
      cueSheet: files.authoritativeCueSheetFile,
      voiceMapping: files.voiceMappingFile
    };
    const slowReferenceManifest = readJson(files.timingV2SlowReferenceManifestFile);
    const sourceTimingTextPlan = String(ledger?.timingTextPlan?.file || "");
    const sourceFfmpeg = String(slowReferenceManifest?.ffmpegProvenance?.file || "");
    const productionRoot = sameResolvedPath(files.root, H02_EXTERNAL_OUTPUT_ROOT);
    if (
      !exactUnlinkedPath(sourceTimingTextPlan, "file")
      || !exactUnlinkedPath(sourceFfmpeg, "file")
      || (productionRoot && !sameResolvedPath(sourceTimingTextPlan, H02_TIMING_V2_SOURCE_TEXT_PLAN_FILE))
      || (productionRoot && !sameResolvedPath(sourceFfmpeg, H02_TIMING_V2_AUDITED_FFMPEG_FILE))
      || !exactHash(ledger?.timingTextPlan?.sha256, sourceHashes.timingTextPlan)
      || !exactHash(slowReferenceManifest?.ffmpegProvenance?.sha256, sourceHashes.auditedFfmpeg)
    ) {
      throw new Error("Canonical TIMING_V2 timing-text or FFmpeg source binding changed.");
    }
    sourceFileBindings.timingTextPlan = sourceTimingTextPlan;
    sourceFileBindings.auditedFfmpeg = sourceFfmpeg;
    for (const [key, file] of Object.entries(sourceFileBindings)) {
      if (String(sourceHashes[key]).toLowerCase() !== String(sha256File(file) || "").toLowerCase()) {
        throw new Error(`Canonical TIMING_V2 promotion source changed: ${key}.`);
      }
    }

    const expectedBackupDirectory = path.join(files.promotionBackupRoot, transactionId);
    const expectedBackupManifest = path.join(expectedBackupDirectory, "BACKUP_MANIFEST.json");
    if (
      !sameResolvedPath(promotion?.backupDirectory, expectedBackupDirectory)
      || !sameResolvedPath(promotion?.backupManifestFile, expectedBackupManifest)
    ) {
      throw new Error("Canonical TIMING_V2 promotion journal path is outside the exact transaction allowlist.");
    }
    const journal = readJson(expectedBackupManifest);
    if (
      journal?.schemaVersion !== 1
      || journal?.artifactType !== H02_TIMING_V2_BACKUP_ARTIFACT
      || journal?.status !== "COMMITTED"
      || journal?.variant !== H02_TIMING_V2_VARIANT
      || String(journal?.runId || "") !== runId
      || String(journal?.promotionId || "") !== promotionId
      || String(journal?.transactionId || "") !== transactionId
      || !sameResolvedPath(journal?.canonicalOutputRoot, files.root)
      || !sameResolvedPath(journal?.sourceStagingRoot, run.stagingRoot)
      || !sameResolvedPath(journal?.backupDirectory, expectedBackupDirectory)
      || !exactJsonEqual(journal?.sourceHashes, sourceHashes)
    ) {
      throw new Error("Promotion pointer and journal do not describe the same committed transaction.");
    }
    if (!exactJsonEqual(journal?.targets, H02_TIMING_V2_PROMOTION_TARGETS)) {
      throw new Error("Committed promotion journal target contract changed.");
    }
    const beforeTargets = Array.isArray(journal?.beforeTargets) ? journal.beforeTargets : [];
    const afterTargets = Array.isArray(journal?.afterTargets) ? journal.afterTargets : [];
    if (
      !exactJsonEqual(beforeTargets.map((row) => row?.relativePath), H02_TIMING_V2_PROMOTION_TARGETS)
      || !exactJsonEqual(afterTargets.map((row) => row?.relativePath), H02_TIMING_V2_PROMOTION_TARGETS)
    ) {
      throw new Error("Committed promotion journal snapshot target set changed.");
    }
    const journalMoves = journal?.moves;
    const stateHistory = Array.isArray(journal?.stateHistory) ? journal.stateHistory : [];
    const allowedTargets = new Set(H02_TIMING_V2_PROMOTION_TARGETS);
    if (
      !journalMoves
      || typeof journalMoves !== "object"
      || !exactJsonEqual(Object.keys(journalMoves).sort(), [...H02_TIMING_V2_JOURNAL_MOVE_KEYS].sort())
      || H02_TIMING_V2_JOURNAL_MOVE_KEYS.some((key) => !Array.isArray(journalMoves[key]))
      || H02_TIMING_V2_JOURNAL_MOVE_KEYS.some((key) => journalMoves[key].some((relative) => !allowedTargets.has(relative)))
      || journal?.pendingMove !== null
      || !Number.isInteger(journal?.journalSequence)
      || journal.journalSequence < 1
      || normalizedState(stateHistory.at(0)?.status) !== "prepared"
      || !stateHistory.some((entry) => normalizedState(entry?.status) === "installing")
      || normalizedState(stateHistory.at(-1)?.status) !== "committed"
    ) {
      throw new Error("Committed promotion journal transition/move contract changed.");
    }
    const currentSnapshot = fileTreeSnapshot(files.root, H02_TIMING_V2_PROMOTION_TARGETS);
    if (!exactJsonEqual(currentSnapshot, afterTargets)) {
      throw new Error("Canonical TIMING_V2 promotion files no longer match the committed hash snapshot.");
    }
    const payloadSnapshot = currentSnapshot.filter((row) => row.relativePath !== "MANIFESTS/H02_QWEN_TIMING_V2_PROMOTION.json");
    const payloadSnapshotSha256 = canonicalJsonSha256(payloadSnapshot);
    if (
      String(promotion?.canonicalPayloadSnapshotSha256 || "").toLowerCase() !== payloadSnapshotSha256
      || String(journal?.canonicalPayloadSnapshotSha256 || "").toLowerCase() !== payloadSnapshotSha256
    ) {
      throw new Error("Canonical TIMING_V2 payload snapshot identity changed.");
    }

    const semantic = promotion?.semanticVerification;
    if (
      !semantic
      || typeof semantic !== "object"
      || semantic?.status !== "PASS"
      || semantic?.verifierContract !== H02_TIMING_V2_SEMANTIC_CONTRACT
      || String(semantic?.canonicalPayloadSnapshotSha256 || "").toLowerCase() !== payloadSnapshotSha256
      || !exactJsonEqual(journal?.semanticVerification, semantic)
    ) {
      throw new Error("Committed TIMING_V2 semantic verification marker is missing or stale.");
    }
    const derivation = semantic?.takeDerivation;
    const pcm24AbsoluteTolerance = 2.5 / (2 ** 23);
    if (
      derivation?.status !== "PASS"
      || derivation?.parentsVerified !== 72
      || derivation?.takesVerified !== 102
      || derivation?.targetPeakDbfs !== -6
      || derivation?.pcm24AbsoluteTolerance !== pcm24AbsoluteTolerance
      || !Number.isFinite(derivation?.maximumObservedAbsoluteError)
      || derivation.maximumObservedAbsoluteError < 0
      || derivation.maximumObservedAbsoluteError > pcm24AbsoluteTolerance
      || !exactJsonEqual(derivation?.resampler, H02_TIMING_V2_RESAMPLER_CONTRACT)
    ) {
      throw new Error("Committed TIMING_V2 parent/take PCM derivation evidence is missing or changed.");
    }
    const semanticFileBindings = {
      ledgerSha256: files.canonicalLedgerFile,
      alignmentPlanSha256: files.canonicalAlignmentPlanFile,
      alignmentSha256: files.canonicalAlignmentFile,
      timingQaJsonSha256: files.canonicalTimingQaJsonFile,
      timingQaCsvSha256: files.canonicalTimingQaCsvFile,
      slowReferenceManifestSha256: files.canonicalSlowReferenceManifestFile,
      slowReferenceAsrPlanSha256: files.canonicalSlowReferenceAsrPlanFile,
      slowReferenceAsrSha256: files.canonicalSlowReferenceAsrFile,
      timingTextPlanSha256: files.canonicalTimingTextPlanFile,
      readyMarkerSha256: files.canonicalReadyForReviewFile
    };
    for (const [key, file] of Object.entries(semanticFileBindings)) {
      if (String(semantic[key] || "").toLowerCase() !== String(sha256File(file) || "").toLowerCase()) {
        throw new Error(`Canonical TIMING_V2 semantic evidence changed: ${key}.`);
      }
    }
    if (String(semantic.timingTextPlanSha256).toLowerCase() !== String(sourceHashes.timingTextPlan).toLowerCase()) {
      throw new Error("Canonical timing-text plan differs from the reviewed source plan.");
    }

    const counts = promotion?.counts || {};
    const voiceProvenance = Array.isArray(promotion?.permanentAndDerivedReferenceProvenance)
      ? promotion.permanentAndDerivedReferenceProvenance
      : [];
    const voiceLocks = Object.fromEntries(voiceProvenance.map((row) => [String(row?.speaker || ""), String(row?.voiceLock || "")]));
    if (
      counts.cues !== 34
      || counts.parents !== 72
      || counts.takes !== 102
      || counts.slowReferences !== 6
      || promotion?.originalPermanentReferencesPreserved !== true
      || promotion?.slowReferencesAreDerivedConditioningAssets !== true
      || promotion?.mastersTouched !== false
      || promotion?.finalZipTouched !== false
      || promotion?.projectOrServiceMutation !== false
      || promotion?.testMode !== false
      || voiceProvenance.length !== 6
      || !exactJsonEqual(voiceLocks, H02_TIMING_V2_VOICE_LOCKS)
    ) {
      throw new Error("Canonical TIMING_V2 promotion counts or preservation guarantees changed.");
    }

    const canonicalLedger = readJson(files.canonicalLedgerFile);
    const canonicalAlignment = readJson(files.canonicalAlignmentFile);
    const canonicalReady = readJson(files.canonicalReadyForReviewFile);
    const ledgerPromotion = canonicalLedger?.promotion || {};
    if (
      canonicalLedger?.variant !== H02_TIMING_V2_VARIANT
      || !sameResolvedPath(canonicalLedger?.outputRoot, files.root)
      || String(canonicalLedger?.activeRunId || "") !== runId
      || !Array.isArray(canonicalLedger?.cues)
      || canonicalLedger.cues.length !== 34
      || Object.keys(canonicalLedger?.units || {}).length !== 72
      || Object.keys(canonicalLedger?.outputs || {}).length !== 102
      || String(ledgerPromotion?.runId || "") !== runId
      || String(ledgerPromotion?.promotionId || "") !== promotionId
      || String(ledgerPromotion?.transactionId || "") !== transactionId
      || String(ledgerPromotion?.sourceLedgerSha256 || "").toLowerCase() !== String(sourceHashes.ledger).toLowerCase()
      || !sameResolvedPath(ledgerPromotion?.sourceStagingRoot, run.stagingRoot)
      || canonicalAlignment?.allPassed !== true
      || Object.keys(canonicalAlignment?.items || {}).length !== 72
      || canonicalReady?.canonicalPromotionComplete !== true
      || String(canonicalReady?.runId || "") !== runId
      || String(canonicalReady?.promotionId || "") !== promotionId
      || String(canonicalReady?.transactionId || "") !== transactionId
      || String(canonicalReady?.ledgerSha256 || "").toLowerCase() !== String(semantic.ledgerSha256).toLowerCase()
      || String(canonicalReady?.sourceReadyMarkerSha256 || "").toLowerCase() !== String(sourceHashes.readyMarker).toLowerCase()
      || !sameResolvedPath(canonicalReady?.ledgerFile, files.canonicalLedgerFile)
    ) {
      throw new Error("Canonical TIMING_V2 semantic identity no longer matches the committed promotion.");
    }

    return {
      present: true,
      validated: true,
      error: null,
      promotion,
      journal,
      semantic,
      promotionId,
      transactionId,
      runId,
      payloadSnapshotSha256,
      journalFile: expectedBackupManifest
    };
  } catch (error) {
    return {
      present: true,
      validated: false,
      error: String(error?.message || error)
    };
  }
}

function jobStatus(externalState, supervisorAlive, finalZipExists) {
  if (TERMINAL_DONE_STATES.has(externalState)) return finalZipExists ? "done" : "error";
  if (TERMINAL_ERROR_STATES.has(externalState)) return "error";
  if (TERMINAL_CANCELLED_STATES.has(externalState)) return "cancelled";
  if (!supervisorAlive) return "error";
  if (QUEUED_STATES.has(externalState)) return "queued";
  return "running";
}

function errorMessage(externalState, status, supervisorAlive, finalZipExists, ledgerCounts) {
  if (TERMINAL_DONE_STATES.has(externalState) && !finalZipExists) {
    return "H02 renderer reported completion, but the validated ZIP is missing.";
  }
  if (TERMINAL_ERROR_STATES.has(externalState)) {
    return String(status?.error || status?.message || `H02 Qwen supervisor reported ${externalState}.`);
  }
  if (!supervisorAlive && !TERMINAL_CANCELLED_STATES.has(externalState)) {
    return `H02 Qwen supervisor is not running (last state: ${externalState}).`;
  }
  if (ledgerCounts.failed > 0) {
    return `${ledgerCounts.failed} H02 Qwen generation pass${ledgerCounts.failed === 1 ? "" : "es"} failed.`;
  }
  return null;
}

function safeIso(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function isExternalQueueJobId(id) {
  return String(id || "") === H02_EXTERNAL_QUEUE_JOB_ID;
}

/**
 * Read the one explicitly allowlisted external renderer. This adapter is read-only:
 * it never starts, stops, or writes to the Qwen supervisor or its output tree.
 */
export function readExternalH02QueueJob({
  root = H02_EXTERNAL_OUTPUT_ROOT,
  timingV3Root = H02_TIMING_V3_STAGING_ROOT,
  timingV3RetryPlanFile = H02_TIMING_V3_RETRY_PLAN_FILE,
  timingV4Root = H02_TIMING_V4_STAGING_ROOT,
  isProcessAlive = processIsAlive
} = {}) {
  const files = pathsFor(root, timingV3Root, timingV3RetryPlanFile, timingV4Root);
  if (!fs.existsSync(files.statusFile)) return null;

  let status;
  try {
    status = readJson(files.statusFile);
  } catch (error) {
    return {
      id: H02_EXTERNAL_QUEUE_JOB_ID,
      projectSlug: H02_EXTERNAL_PROJECT_SLUG,
      type: "external_qwen_dialogue_batch",
      label: "H02 Qwen dialogue · 34 cues / 102 takes",
      status: "error",
      progress: 0,
      stage: "External H02 status file is unreadable",
      error: String(error?.message || error),
      refs: {
        readOnly: true,
        external: true,
        usesComfyUi: false,
        statusFile: files.statusFile,
        batchLedgerFile: files.batchLedgerFile,
        alignmentResultsFile: files.alignmentResultsFile,
        cueManifestFile: files.cueManifestFile,
        outputRoot: files.root,
        cueCount: 34,
        plannedTakeCount: 102
      },
      result: null,
      createdAt: null,
      finishedAt: null
    };
  }

  const run = activeRunFiles(status, files);
  const lock = readOptionalJson(files.lockFile);
  const manifest = readOptionalJson(files.cueManifestFile);
  const ledger = run.invalid ? null : readOptionalJson(run.batchLedgerFile);
  const ledgerCounts = unitCounts(ledger);
  const v3Lineage = timingV3LineageCounts(ledger);
  const v4Lineage = timingV4LineageCounts(ledger);
  const compiledPlan = (run.timingV3 || run.timingV4) && !run.invalid ? readOptionalJson(run.compiledPlanFile) : null;
  const retryPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.retryPlanFile) : null;
  const rawAlignmentPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.rawAlignmentPlanFile) : null;
  const rawAlignmentResults = run.timingV3 && !run.invalid ? readOptionalJson(run.rawAlignmentResultsFile) : null;
  const alignmentPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.alignmentPlanFile) : null;
  const alignment = run.invalid ? null : readOptionalJson(run.alignmentResultsFile);
  const promotionInput = run.timingV3 && !run.invalid ? readOptionalJson(run.promotionInputFile) : null;
  const targetQa = run.timingV3 && !run.invalid ? readOptionalJson(run.targetQaFile) : null;
  const sealTransaction = run.timingV3 && !run.invalid ? readOptionalJson(run.sealTransactionFile) : null;
  const alignmentSummary = alignmentCounts(alignment);
  const cueCount = numericCount(manifest?.packageCounts?.cues, Array.isArray(manifest?.cues) ? manifest.cues.length : 34) || 34;
  const seeds = Array.isArray(manifest?.rendererTarget?.wrapperSeeds)
    ? manifest.rendererTarget.wrapperSeeds.length
    : 3;
  const plannedTakeCount = cueCount * Math.max(1, seeds);
  const parentGenerationFiles = run.invalid ? 0 : countWavFiles(run.parentGenerationDir);
  const alternateTakeFiles = run.invalid ? 0 : countWavFiles(run.alternateTakesDir);
  const masterFiles = run.timing ? 0 : countWavFiles(files.masterWavDir);
  const trackedOutputCount = completedOutputCount(ledger, run.timing ? run.alternateTakesDir : null);
  const doneUnits = run.timing
    ? ledgerCounts.done
    : Math.max(numericCount(status?.doneUnits), ledgerCounts.done, parentGenerationFiles);
  const totalUnits = run.timing
    ? ledgerCounts.total || Math.max(numericCount(status?.totalUnits), 1)
    : Math.max(numericCount(status?.totalUnits), ledgerCounts.total, 1);
  const completedTakes = run.timing
    ? trackedOutputCount
    : Math.max(numericCount(status?.takeFiles), alternateTakeFiles);
  const externalState = normalizedState(status?.state);
  // Do not follow a path supplied by status JSON. The adapter may read only this
  // exact allowlisted deliverable beneath the allowlisted H02 output root.
  const finalZip = path.join(root, "H02_QWEN_CLONED_DIALOGUE_VALIDATED.zip");
  const finalZipExists = fs.existsSync(finalZip);
  const readyForReview = run.readyForReviewFile ? readOptionalJson(run.readyForReviewFile) : null;
  const reviewGate = timingReviewGate({
    status,
    run,
    ledger,
    ledgerCounts,
    alignmentSummary,
    completedTakes,
    plannedTakeCount,
    readyForReview,
    promotionInput,
    compiledPlan,
    retryPlan,
    rawAlignmentPlan,
    rawAlignmentResults,
    alignmentPlan,
    alignment,
    targetQa,
    sealTransaction
  });
  const promotionGate = timingPromotionGate({
    files,
    status,
    run,
    ledger,
    readyForReview,
    reviewGate
  });
  const timingStagingValidated = reviewGate.validated;
  const timingPromoted = promotionGate.validated;
  const promotionInvalid = promotionGate.present && !timingPromoted;
  const staleReviewMarker = reviewGate.staleMarker;
  const reviewMarkerMatchesLedger = reviewGate.markerMatchesLedger;
  const successfulReviewHandoff = reviewGate.successfulHandoff;
  const currentLedgerSha256 = reviewGate.currentLedgerSha256;
  const supervisorPid = numericCount(status?.supervisorPid || lock?.pid);
  const supervisorAlive = isProcessAlive(supervisorPid);
  const mappedStatus = run.invalid
    ? "error"
    : timingPromoted
      ? "promoted"
    : promotionInvalid
      ? "error"
    : timingStagingValidated
      ? "awaiting_review"
      : run.timing && externalState === "awaiting_review"
        ? "error"
      : run.timing && TERMINAL_DONE_STATES.has(externalState)
      ? "error"
      : jobStatus(externalState, supervisorAlive, finalZipExists);
  const error = run.invalid
    ? `${run.label || "TIMING"} status declared an invalid variant, renderer, or non-allowlisted staging root; expected ${run.timingV4 ? files.timingV4Root : run.timingV3 ? files.timingV3Root : files.timingV2Root}.`
    : timingPromoted
      ? null
    : promotionInvalid
      ? promotionGate.error
    : timingStagingValidated
      ? null
      : staleReviewMarker && TERMINAL_ERROR_STATES.has(externalState) && !successfulReviewHandoff
        ? String(status?.error || status?.message || `${run.label} review marker was superseded by the current ${externalState} run.`)
        : staleReviewMarker
          ? `${run.label} review marker is stale or does not match the current staging ledger and validation evidence.`
      : run.timing && TERMINAL_DONE_STATES.has(externalState)
        ? `${run.label} is a review-only staging run and cannot be reported as a completed master package.`
        : errorMessage(externalState, status, supervisorAlive, finalZipExists, ledgerCounts);
  const timingProgress = timingPromoted
    ? 1
    : timingStagingValidated
    ? 0.99
    : Math.max(0, Math.min(0.98,
      (doneUnits / totalUnits) * 0.69
      + (alignmentSummary.total ? alignmentSummary.passed / alignmentSummary.total : 0) * 0.2
      + (completedTakes / plannedTakeCount) * 0.09
    ));
  const progress = mappedStatus === "done" || mappedStatus === "promoted"
    ? 1
    : run.timing
      ? timingProgress
      : Math.max(0, Math.min(0.99, doneUnits / totalUnits));
  const timingParentStage = run.timingV4
    ? `${Math.min(doneUnits, totalUnits)}/${totalUnits} TIMING_V4 parents (${v4Lineage.reusedDone}/${v4Lineage.reused || numericCount(status?.targetReuseParentCount, 57)} reused · ${v4Lineage.regeneratedDone}/${v4Lineage.regenerated || numericCount(status?.targetRetryParentCount, 15)} regenerated)`
    : run.timingV3
      ? `${Math.min(doneUnits, totalUnits)}/${totalUnits} TIMING_V3 parents (${v3Lineage.reusedDone}/28 reused · ${v3Lineage.regeneratedDone}/44 regenerated)`
      : `${Math.min(doneUnits, totalUnits)}/${totalUnits} TIMING_V2 parents`;
  const stage = run.invalid
    ? `${run.label || "TIMING"} blocked · staging root failed the allowlist`
    : timingPromoted
      ? "TIMING_V2 promoted · 72/72 canonical parents · 102/102 canonical takes · semantic verification PASS"
    : promotionInvalid
      ? `TIMING_V2 promotion blocked · ${promotionGate.error}`
    : timingStagingValidated
      ? `${timingParentStage} · ${alignmentSummary.passed}/${alignmentSummary.total} exact word checks · ${completedTakes}/${plannedTakeCount} staged takes · awaiting explicit review`
      : staleReviewMarker && successfulReviewHandoff
        ? `${run.label} blocked · review marker does not match the current staging ledger`
      : run.timing && mappedStatus === "error" && alignmentSummary.failed > 0
        ? `${run.label} blocked after ${timingParentStage} · ${alignmentSummary.failed}/${alignmentSummary.total} strict word checks failed · ${Math.min(completedTakes, plannedTakeCount)}/${plannedTakeCount} staged takes`
        : run.timing
          ? `${timingParentStage} · ${alignmentSummary.passed}/${alignmentSummary.total} exact word checks · ${Math.min(completedTakes, plannedTakeCount)}/${plannedTakeCount} staged takes`
          : mappedStatus === "done"
            ? `${cueCount}/${cueCount} masters · validated package ready`
            : mappedStatus === "error" && alignmentSummary.failed > 0
              ? `Blocked after ${Math.min(doneUnits, totalUnits)}/${totalUnits} Qwen passes · ${alignmentSummary.failed}/${alignmentSummary.total} strict word checks failed · ${Math.min(masterFiles, cueCount)}/${cueCount} masters`
              : `${Math.min(doneUnits, totalUnits)}/${totalUnits} Qwen passes · ${Math.min(completedTakes, plannedTakeCount)}/${plannedTakeCount} takes · ${Math.min(masterFiles, cueCount)}/${cueCount} masters`;

  return {
    id: H02_EXTERNAL_QUEUE_JOB_ID,
    projectSlug: H02_EXTERNAL_PROJECT_SLUG,
    type: "external_qwen_dialogue_batch",
    label: `H02 Qwen${run.timing ? ` ${run.label}` : ""} dialogue · ${cueCount} cues / ${plannedTakeCount} takes`,
    status: mappedStatus,
    progress,
    stage,
    error,
    refs: {
      readOnly: true,
      external: true,
      usesComfyUi: false,
      renderer: String(status?.renderer || ledger?.engine || "standalone Qwen3-TTS Base"),
      variant: run.timing ? run.variant : null,
      externalState,
      supervisorPid,
      supervisorAlive,
      statusFile: files.statusFile,
      batchLedgerFile: run.batchLedgerFile,
      compiledPlanFile: run.timingV3 || run.timingV4 ? run.compiledPlanFile : null,
      retryPlanFile: run.timingV3 ? run.retryPlanFile : null,
      alignmentPlanFile: run.timingV3 ? run.alignmentPlanFile : null,
      alignmentResultsFile: run.alignmentResultsFile,
      targetQaFile: run.timingV3 ? run.targetQaFile : null,
      cueManifestFile: files.cueManifestFile,
      parentGenerationDir: run.parentGenerationDir,
      alternateTakesDir: run.alternateTakesDir,
      masterWavDir: run.timing ? null : files.masterWavDir,
      outputRoot: files.root,
      stagingRoot: run.stagingRoot,
      readyForReviewFile: run.readyForReviewFile,
      promotionInputManifestFile: run.timingV3 ? run.promotionInputFile : null,
      stagingReady: timingStagingValidated,
      reviewMarkerMatchesLedger,
      reviewRunIdMatches: reviewGate.runIdMatches,
      reviewGenerationPlanMatches: reviewGate.generationPlanMatches,
      successfulReviewHandoff,
      currentLedgerSha256,
      promoted: timingPromoted,
      promotionManifestFile: promotionGate.present ? files.promotionManifestFile : null,
      promotionJournalFile: promotionGate.journalFile || null,
      promotionId: promotionGate.promotionId || null,
      promotionTransactionId: promotionGate.transactionId || null,
      promotionRunId: promotionGate.runId || null,
      promotionPayloadSnapshotSha256: promotionGate.payloadSnapshotSha256 || null,
      promotionSemanticVerification: promotionGate.semantic || null,
      canonicalV1MutationAllowed: run.timing ? false : null,
      timingV2MutationAllowed: run.timingV3 || run.timingV4 ? false : null,
      timingV3MutationAllowed: run.timingV4 ? false : null,
      cueCount,
      plannedTakeCount,
      doneUnits,
      totalUnits,
      completedTakes,
      completedMasters: masterFiles,
      alignmentChecks: alignmentSummary,
      timingV3Lineage: run.timingV3 ? v3Lineage : null,
      timingV4Lineage: run.timingV4 ? v4Lineage : null
    },
    result: timingPromoted
      ? {
          promoted: true,
          promotionId: promotionGate.promotionId,
          transactionId: promotionGate.transactionId,
          promotionManifestFile: files.promotionManifestFile,
          promotionJournalFile: promotionGate.journalFile,
          canonicalOutputRoot: files.root
        }
      : !run.timing && finalZipExists
        ? { finalZip }
        : null,
    createdAt: safeIso(lock?.startedAt || status?.startedAt || ledger?.createdAt),
    finishedAt: mappedStatus === "promoted"
      ? safeIso(
          promotionGate.semantic?.verifiedAt
          || promotionGate.journal?.committedAt
          || promotionGate.promotion?.committedAt
          || promotionGate.promotion?.createdAt
          || status?.updatedAt
        )
      : ["done", "error", "cancelled"].includes(mappedStatus)
      ? safeIso(status?.updatedAt || ledger?.updatedAt)
      : null
  };
}

export function listExternalQueueJobs(options) {
  const job = readExternalH02QueueJob(options);
  return job ? [job] : [];
}

export function readExternalH02DialogueCues({
  root = H02_EXTERNAL_OUTPUT_ROOT,
  timingV3Root = H02_TIMING_V3_STAGING_ROOT,
  timingV3RetryPlanFile = H02_TIMING_V3_RETRY_PLAN_FILE,
  timingV4Root = H02_TIMING_V4_STAGING_ROOT
} = {}) {
  const files = pathsFor(root, timingV3Root, timingV3RetryPlanFile, timingV4Root);
  const manifest = readOptionalJson(files.cueManifestFile);
  if (!Array.isArray(manifest?.cues)) return [];

  const status = readOptionalJson(files.statusFile);
  const run = activeRunFiles(status, files);
  const ledger = run.invalid ? null : readOptionalJson(run.batchLedgerFile);
  const units = unitValues(ledger);
  const outputs = outputValues(ledger);
  const compiledPlan = (run.timingV3 || run.timingV4) && !run.invalid ? readOptionalJson(run.compiledPlanFile) : null;
  const retryPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.retryPlanFile) : null;
  const rawAlignmentPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.rawAlignmentPlanFile) : null;
  const rawAlignmentResults = run.timingV3 && !run.invalid ? readOptionalJson(run.rawAlignmentResultsFile) : null;
  const alignmentPlan = run.timingV3 && !run.invalid ? readOptionalJson(run.alignmentPlanFile) : null;
  const alignment = run.invalid ? null : readOptionalJson(run.alignmentResultsFile);
  const promotionInput = run.timingV3 && !run.invalid ? readOptionalJson(run.promotionInputFile) : null;
  const targetQa = run.timingV3 && !run.invalid ? readOptionalJson(run.targetQaFile) : null;
  const sealTransaction = run.timingV3 && !run.invalid ? readOptionalJson(run.sealTransactionFile) : null;
  const alignmentItems = alignment?.items && typeof alignment.items === "object" ? alignment.items : {};
  const ledgerCounts = unitCounts(ledger);
  const alignmentSummary = alignmentCounts(alignment);
  const cueCount = numericCount(manifest?.packageCounts?.cues, manifest.cues.length) || manifest.cues.length;
  const seedCount = Array.isArray(manifest?.rendererTarget?.wrapperSeeds)
    ? manifest.rendererTarget.wrapperSeeds.length
    : 3;
  const plannedTakeCount = cueCount * Math.max(1, seedCount);
  const completedTimingTakes = run.timing && !run.invalid
    ? completedOutputCount(ledger, run.alternateTakesDir)
    : 0;
  const readyForReview = run.readyForReviewFile ? readOptionalJson(run.readyForReviewFile) : null;
  const reviewGate = timingReviewGate({
    status,
    run,
    ledger,
    ledgerCounts,
    alignmentSummary,
    completedTakes: completedTimingTakes,
    plannedTakeCount,
    readyForReview,
    promotionInput,
    compiledPlan,
    retryPlan,
    rawAlignmentPlan,
    rawAlignmentResults,
    alignmentPlan,
    alignment,
    targetQa,
    sealTransaction
  });
  const promotionGate = timingPromotionGate({
    files,
    status,
    run,
    ledger,
    readyForReview,
    reviewGate
  });
  const masterNames = new Set(run.timing ? [] : wavFileNames(files.masterWavDir).map((name) => name.toLowerCase()));
  const stagedTakeNames = new Set(run.timing && !run.invalid
    ? wavFileNames(run.alternateTakesDir).map((name) => name.toLowerCase())
    : []);

  return manifest.cues.map((cue) => {
    const cueId = String(cue?.cueId || "");
    const cueUnits = units.filter((unit) => Array.isArray(unit?.cueIds) && unit.cueIds.map(String).includes(cueId));
    const expectedTakes = Array.isArray(cue?.qwenRender?.wrapperSeeds) ? cue.qwenRender.wrapperSeeds.length : 3;
    const generatedTakes = cueUnits.filter((unit) => normalizedState(unit?.status) === "done").length;
    const cueOutputs = outputs.filter((output) => String(output?.cueId || "") === cueId);
    const stagedTakes = run.timing
      ? cueOutputs.filter((output) => normalizedState(output?.status) === "done"
        && stagedTakeNames.has(path.basename(String(output?.file || "")).toLowerCase())).length
      : 0;
    const completedTakes = run.timing ? stagedTakes : generatedTakes;
    const failedTakes = cueUnits.filter((unit) => TERMINAL_ERROR_STATES.has(normalizedState(unit?.status))).length;
    const qaPassedTakes = cueUnits.filter((unit) => normalizedState(alignmentItems[unit?.key]?.status) === "pass").length;
    const qaFailedTakes = cueUnits.filter((unit) => normalizedState(alignmentItems[unit?.key]?.status) === "fail").length;
    const generating = cueUnits.some((unit) => ["generating", "running"].includes(normalizedState(unit?.status)));
    const masterFilename = String(cue?.outputs?.masterFilename || "");
    const masterExists = !run.timing && Boolean(masterFilename) && masterNames.has(masterFilename.toLowerCase());
    const awaitingReview = reviewGate.validated
      && stagedTakes === expectedTakes
      && qaPassedTakes === expectedTakes
      && failedTakes === 0
      && qaFailedTakes === 0;
    const promoted = promotionGate.validated && awaitingReview;
    const promotionBlocked = promotionGate.present && !promotionGate.validated;
    const reviewSuperseded = run.timing
      && reviewGate.staleMarker
      && (normalizedState(status?.state) === "awaiting_review"
        || TERMINAL_ERROR_STATES.has(normalizedState(status?.state)));
    const cueStatus = run.invalid
      ? "error"
      : masterExists
      ? "done"
      : promoted
        ? "promoted"
      : promotionBlocked
        ? "blocked"
      : reviewSuperseded
        ? "blocked"
      : awaitingReview
        ? "awaiting_review"
      : failedTakes > 0 || qaFailedTakes > 0
        ? "error"
        : generating || generatedTakes > 0 || stagedTakes > 0
          ? "running"
          : "queued";

    return {
      cueId,
      segmentId: String(cue?.segmentId || ""),
      speaker: String(cue?.speaker || cue?.character || ""),
      exactDialogue: String(cue?.exactDialogue || ""),
      performanceDirection: String(cue?.performanceDirection || ""),
      status: cueStatus,
      // Raw seed renders are only the first stage. Keep unfinished cues below
      // 100% until a selected, validated master actually exists.
      progress: masterExists
        ? 1
        : run.timing
          ? promoted || awaitingReview
            ? 0.99
            : Math.max(0, Math.min(0.98,
              (generatedTakes / Math.max(1, expectedTakes)) * 0.59
              + (qaPassedTakes / Math.max(1, expectedTakes)) * 0.2
              + (stagedTakes / Math.max(1, expectedTakes)) * 0.19
            ))
          : Math.max(0, Math.min(0.9,
            (completedTakes / Math.max(1, expectedTakes)) * 0.75
            + (qaPassedTakes / Math.max(1, expectedTakes)) * 0.15
          )),
      completedTakes,
      generatedTakes,
      stagedTakes,
      expectedTakes,
      failedTakes,
      qaPassedTakes,
      qaFailedTakes,
      targetVoiceDurationSec: Number(cue?.targetVoiceDurationSec) || null,
      targetVideoDurationSec: Number(cue?.targetVideoDurationSec) || null,
      readOnly: true,
      output: {
        masterFilename,
        masterExists,
        masterPath: masterFilename && !run.timing ? path.join(files.masterWavDir, masterFilename) : null,
        awaitingReview: awaitingReview && !promoted,
        promoted,
        promotionId: promoted ? promotionGate.promotionId : null
      }
    };
  });
}
