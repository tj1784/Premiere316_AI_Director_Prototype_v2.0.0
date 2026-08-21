import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_STORYBOARD = path.join(
  REPO_ROOT,
  "projects",
  "harrowing_of_hell",
  "production",
  "storyboard.json"
);
const DEFAULT_PACKAGE = "C:\\Users\\Blokey\\Downloads\\Harrowing_T2V_Reference_Package.zip";
const PACKAGE_STORYBOARD_ENTRY =
  "Harrowing_T2V_Reference_Package/prompts/production/storyboard.json";

function parseArgs(argv) {
  const options = {
    storyboard: DEFAULT_STORYBOARD,
    package: DEFAULT_PACKAGE,
    expectedStoryboardSha256: "",
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--storyboard") {
      options.storyboard = path.resolve(argv[++index]);
    } else if (argument === "--package") {
      options.package = path.resolve(argv[++index]);
    } else if (argument === "--expected-storyboard-sha256") {
      options.expectedStoryboardSha256 = String(argv[++index] || "").toUpperCase();
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function readZipText(zipPath, entry) {
  const result = spawnSync("tar", ["-xOf", zipPath, entry], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to read ${entry} from ${zipPath}: ${String(result.stderr || result.error || "tar failed").trim()}`
    );
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
}

function normalizedTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function capturePromptBackup(storyboard) {
  const frames = {};
  for (const [frameId, frame] of Object.entries(storyboard.frames || {})) {
    frames[frameId] = {
      prompt: frame.prompt ?? "",
      negativePrompt: frame.negativePrompt ?? "",
      generatedVersions: (frame.generatedVersions || []).map((version) => ({
        id: version.id ?? null,
        prompt: version.prompt ?? null,
        negativePrompt: version.negativePrompt ?? null,
        promptHash: version.promptHash ?? null
      }))
    };
  }

  const videoPlans = {};
  for (const [planId, plan] of Object.entries(storyboard.videoPlans || {})) {
    videoPlans[planId] = {
      clipId: plan.clipId,
      globalPrompt: plan.globalPrompt ?? "",
      localPrompts: plan.localPrompts ?? "",
      negativePrompt: plan.negativePrompt ?? null,
      timelineData: {
        global_prompt: plan.timelineData?.global_prompt ?? "",
        retake_global_prompt: plan.timelineData?.retake_global_prompt ?? "",
        retakePrompt: plan.timelineData?.retakePrompt ?? "",
        segments: (plan.timelineData?.segments || []).map((segment) => ({
          id: segment.id,
          prompt: segment.prompt ?? ""
        }))
      }
    };
  }

  const segments = {};
  for (const [segmentId, segment] of Object.entries(storyboard.segments || {})) {
    segments[segmentId] = {
      prompt: segment.prompt ?? "",
      type: segment.type ?? null,
      frameId: segment.frameId ?? null,
      startFrame: segment.startFrame,
      lengthFrames: segment.lengthFrames
    };
  }

  return { frames, videoPlans, segments };
}

function migratePrompts(current, source) {
  const migrated = clone(current);
  const currentClipIds = Object.keys(current.clips || {}).sort();
  const sourceClipIds = Object.keys(source.clips || {}).sort();
  assert(currentClipIds.length === 153, `Expected 153 current clips, received ${currentClipIds.length}`);
  assert(sourceClipIds.length === 153, `Expected 153 package clips, received ${sourceClipIds.length}`);
  assert(
    JSON.stringify(currentClipIds) === JSON.stringify(sourceClipIds),
    "Current and package clip ID sets do not match"
  );

  for (const clipId of currentClipIds) {
    const currentClip = migrated.clips[clipId];
    const sourceClip = source.clips[clipId];
    assert(currentClip.videoPlanId === sourceClip.videoPlanId, `Video-plan mapping changed for ${clipId}`);

    const planId = currentClip.videoPlanId;
    const targetPlan = migrated.videoPlans[planId];
    const sourcePlan = source.videoPlans[planId];
    assert(targetPlan && sourcePlan, `Missing video plan for ${clipId}: ${planId}`);
    assert(typeof sourcePlan.globalPrompt === "string" && sourcePlan.globalPrompt.length > 100, `Missing T2V prompt for ${clipId}`);
    assert(sourcePlan.timelineData?.global_prompt === sourcePlan.globalPrompt, `Package global-prompt mirror mismatch for ${clipId}`);

    targetPlan.globalPrompt = sourcePlan.globalPrompt;
    targetPlan.localPrompts = sourcePlan.localPrompts;
    targetPlan.timelineData.global_prompt = sourcePlan.timelineData.global_prompt;

    const sourceTimelineSegments = new Map(
      (sourcePlan.timelineData?.segments || []).map((segment) => [segment.id, segment])
    );
    for (const timelineSegment of targetPlan.timelineData?.segments || []) {
      const replacement = sourceTimelineSegments.get(timelineSegment.id);
      assert(replacement, `Package timeline segment missing: ${timelineSegment.id}`);
      timelineSegment.prompt = replacement.prompt;
    }

    for (const segmentId of targetPlan.segmentIds || []) {
      const targetSegment = migrated.segments[segmentId];
      const sourceSegment = source.segments[segmentId];
      assert(targetSegment && sourceSegment, `Missing segment mapping: ${segmentId}`);
      targetSegment.prompt = sourceSegment.prompt;
    }
  }

  // The replacement prompt for H01-S01-C01 is a genuinely revised 15-second,
  // four-part shot. Align only the timing data required to keep that prompt
  // coherent while retaining the current UI-compatible legacy frame registry.
  const revisedClipId = "H01-S01-C01";
  const revisedPlanId = migrated.clips[revisedClipId].videoPlanId;
  const revisedSourceClip = source.clips[revisedClipId];
  const revisedTargetClip = migrated.clips[revisedClipId];
  for (const field of [
    "durationFrames",
    "decodedFrames",
    "beat",
    "dialogueAnchor",
    "shotSizeLens",
    "cameraMovement",
    "transition",
    "continuityLocks"
  ]) {
    revisedTargetClip[field] = clone(revisedSourceClip[field]);
  }

  // All later clips move by the 24-frame opening revision. Copy only their
  // authoritative timeline starts, leaving every other clip field untouched.
  for (const clipId of currentClipIds) {
    migrated.clips[clipId].timelineStartFrame = source.clips[clipId].timelineStartFrame;
  }
  migrated.runtimeFrames = source.runtimeFrames;

  const revisedSourcePlan = source.videoPlans[revisedPlanId];
  const revisedTargetPlan = migrated.videoPlans[revisedPlanId];
  revisedTargetPlan.segmentIds = clone(revisedSourcePlan.segmentIds);
  revisedTargetPlan.segmentLengths = revisedSourcePlan.segmentLengths;
  revisedTargetPlan.localPrompts = revisedSourcePlan.localPrompts;
  revisedTargetPlan.timelineData.normalDurationFrames = revisedSourcePlan.timelineData.normalDurationFrames;
  revisedTargetPlan.timelineData.segments = clone(revisedSourcePlan.timelineData.segments);
  for (const segmentId of revisedSourcePlan.segmentIds) {
    migrated.segments[segmentId] = clone(source.segments[segmentId]);
  }

  migrated.updatedAt = new Date().toISOString();
  return migrated;
}

function validateMigration(before, migrated, source) {
  const stableCounts = ["chapters", "scenes", "clips", "frames", "videoPlans", "referenceBindings"];
  for (const key of stableCounts) {
    assert(
      Object.keys(before[key] || {}).length === Object.keys(migrated[key] || {}).length,
      `${key} count changed unexpectedly`
    );
  }
  assert(Object.keys(migrated.segments || {}).length === 392, "Expected 392 migrated segments");
  assert(migrated.runtimeFrames === 54792, `Expected runtimeFrames 54792, received ${migrated.runtimeFrames}`);

  let globalMatches = 0;
  let localMatches = 0;
  let timelineMatches = 0;
  let segmentMatches = 0;
  for (const [clipId, clip] of Object.entries(migrated.clips)) {
    const sourceClip = source.clips[clipId];
    const plan = migrated.videoPlans[clip.videoPlanId];
    const sourcePlan = source.videoPlans[sourceClip.videoPlanId];
    if (plan.globalPrompt === sourcePlan.globalPrompt) globalMatches += 1;
    if (plan.localPrompts === sourcePlan.localPrompts) localMatches += 1;
    if (plan.timelineData?.global_prompt === sourcePlan.timelineData?.global_prompt) timelineMatches += 1;

    const targetTimeline = new Map((plan.timelineData?.segments || []).map((segment) => [segment.id, segment]));
    for (const sourceTimelineSegment of sourcePlan.timelineData?.segments || []) {
      const targetTimelineSegment = targetTimeline.get(sourceTimelineSegment.id);
      assert(targetTimelineSegment, `Migrated timeline segment missing: ${sourceTimelineSegment.id}`);
      assert(
        targetTimelineSegment.prompt === sourceTimelineSegment.prompt,
        `Timeline prompt mismatch: ${sourceTimelineSegment.id}`
      );
    }
  }
  for (const [segmentId, sourceSegment] of Object.entries(source.segments || {})) {
    if (migrated.segments[segmentId]?.prompt === sourceSegment.prompt) segmentMatches += 1;
  }

  assert(globalMatches === 153, `Only ${globalMatches}/153 global prompts match`);
  assert(localMatches === 153, `Only ${localMatches}/153 local prompt mirrors match`);
  assert(timelineMatches === 153, `Only ${timelineMatches}/153 timeline global prompts match`);
  assert(segmentMatches === 392, `Only ${segmentMatches}/392 segment prompts match`);

  // The package has no frame-ID mapping. Confirm the 195 current image records
  // and their prompt/provenance payloads remain byte-for-value unchanged.
  assert(
    JSON.stringify(before.frames) === JSON.stringify(migrated.frames),
    "Legacy frame records changed; package T2V prompts must not be pasted into frame prompts"
  );
  assert(
    JSON.stringify(before.referenceBindings) === JSON.stringify(migrated.referenceBindings),
    "Reference binding history changed unexpectedly"
  );

  return { globalMatches, localMatches, timelineMatches, segmentMatches };
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

const options = parseArgs(process.argv.slice(2));
assert(fs.existsSync(options.storyboard), `Storyboard not found: ${options.storyboard}`);
assert(fs.existsSync(options.package), `Package not found: ${options.package}`);

const currentBuffer = fs.readFileSync(options.storyboard);
const currentSha256 = sha256(currentBuffer);
if (options.expectedStoryboardSha256) {
  assert(
    currentSha256 === options.expectedStoryboardSha256,
    `Storyboard changed since audit: expected ${options.expectedStoryboardSha256}, received ${currentSha256}`
  );
}
const packageBuffer = fs.readFileSync(options.package);
const packageSha256 = sha256(packageBuffer);
const packageStoryboardText = readZipText(options.package, PACKAGE_STORYBOARD_ENTRY);
const packageStoryboardSha256 = sha256(Buffer.from(packageStoryboardText, "utf8"));

const current = JSON.parse(currentBuffer.toString("utf8"));
const source = JSON.parse(packageStoryboardText);
assert(current.schemaVersion === "premiere316.storyboard.v1", "Unexpected current storyboard schema");
assert(source.schemaVersion === current.schemaVersion, "Package storyboard schema mismatch");
assert(source.projectId === current.projectId, "Package project mismatch");

const migrated = migratePrompts(current, source);
const matches = validateMigration(current, migrated, source);
const result = {
  dryRun: options.dryRun,
  storyboard: options.storyboard,
  package: options.package,
  currentSha256,
  packageSha256,
  packageStoryboardSha256,
  countsBefore: {
    clips: Object.keys(current.clips).length,
    frames: Object.keys(current.frames).length,
    videoPlans: Object.keys(current.videoPlans).length,
    segments: Object.keys(current.segments).length,
    referenceBindings: Object.keys(current.referenceBindings).length,
    runtimeFrames: current.runtimeFrames
  },
  countsAfter: {
    clips: Object.keys(migrated.clips).length,
    frames: Object.keys(migrated.frames).length,
    videoPlans: Object.keys(migrated.videoPlans).length,
    segments: Object.keys(migrated.segments).length,
    referenceBindings: Object.keys(migrated.referenceBindings).length,
    runtimeFrames: migrated.runtimeFrames
  },
  matches
};

if (options.dryRun) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const migrationRoot = path.join(path.dirname(options.storyboard), "t2v-prompt-migration");
const backupDir = path.join(migrationRoot, normalizedTimestamp());
assert(!fs.existsSync(backupDir), `Backup directory already exists: ${backupDir}`);
fs.mkdirSync(backupDir, { recursive: true });

const fullBackupPath = path.join(backupDir, "storyboard.before.json");
const promptBackupPath = path.join(backupDir, "current-prompts.before.json");
const sourceRecordPath = path.join(backupDir, "source-package.json");
fs.writeFileSync(fullBackupPath, currentBuffer);
assert(sha256(fs.readFileSync(fullBackupPath)) === currentSha256, "Full storyboard backup hash mismatch");

fs.writeFileSync(
  promptBackupPath,
  `${JSON.stringify({
    schema: "premiere316.storyboard-prompts-backup.v1",
    createdAt: new Date().toISOString(),
    storyboard: options.storyboard,
    storyboardSha256: currentSha256,
    prompts: capturePromptBackup(current)
  }, null, 2)}\n`,
  "utf8"
);
fs.writeFileSync(
  sourceRecordPath,
  `${JSON.stringify({
    schema: "premiere316.t2v-prompt-migration-source.v1",
    createdAt: new Date().toISOString(),
    package: options.package,
    packageSha256,
    storyboardEntry: PACKAGE_STORYBOARD_ENTRY,
    storyboardEntrySha256: packageStoryboardSha256,
    clipCount: 153,
    migrationScope: "T2V global/local prompt text plus required H01-S01-C01 15-second timing alignment; legacy frame records and reference bindings preserved"
  }, null, 2)}\n`,
  "utf8"
);

// Recheck the source immediately before the atomic replacement so a concurrent
// Storyboard save cannot be overwritten by this migration.
assert(sha256(fs.readFileSync(options.storyboard)) === currentSha256, "Storyboard changed while backups were being created");
writeJsonAtomic(options.storyboard, migrated);

const written = JSON.parse(fs.readFileSync(options.storyboard, "utf8"));
validateMigration(current, written, source);
result.backupDir = backupDir;
result.fullBackupPath = fullBackupPath;
result.promptBackupPath = promptBackupPath;
result.sourceRecordPath = sourceRecordPath;
result.migratedSha256 = sha256(fs.readFileSync(options.storyboard));
console.log(JSON.stringify(result, null, 2));
