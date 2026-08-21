import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  EXPLICIT_USER_REFERENCES_ONLY,
  enforceExplicitUserReferencePolicy,
  validateStoryboard
} from "../server/storyboard.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.join(repoRoot, "projects", "harrowing_of_hell");
const projectFile = path.join(projectRoot, "project.json");
const storyboardFile = path.join(projectRoot, "production", "storyboard.json");
const backupRoot = path.join(projectRoot, "backups", "visual-reference-cleanup");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function jsonSha(value) {
  return sha256(JSON.stringify(value));
}

function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, value);
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.renameSync(temporary, file);
        return;
      } catch (error) {
        lastError = error;
        if (!["EACCES", "EEXIST", "EPERM"].includes(error?.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    // Windows can transiently refuse replacement while another process has the
    // JSON open. Fall back to a verified same-volume copy after bounded retries.
    fs.copyFileSync(temporary, file);
    if (!fs.readFileSync(file).equals(fs.readFileSync(temporary))) throw lastError || new Error(`Unable to verify ${file}`);
    fs.unlinkSync(temporary);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function activeReferenceCounts(storyboard) {
  return {
    bindings: Object.keys(storyboard.referenceBindings || {}).length,
    frameReferences: Object.values(storyboard.frames || {}).reduce((total, frame) => total + (frame?.references?.length || 0), 0),
    clipReferenceFiles: Object.values(storyboard.clips || {}).reduce((total, clip) => total + (clip?.referenceFiles?.length || 0), 0),
    planReferenceFiles: Object.values(storyboard.videoPlans || {}).reduce((total, plan) => total + (plan?.referenceFiles?.length || 0), 0),
    segmentReferenceFiles: Object.values(storyboard.segments || {}).reduce((total, segment) => total + (segment?.referenceFiles?.length || 0), 0),
    timelineReferenceFiles: Object.values(storyboard.videoPlans || {}).reduce(
      (total, plan) => total + (plan?.timelineData?.segments || []).reduce((subtotal, segment) => subtotal + (segment?.referenceFiles?.length || 0), 0),
      0
    )
  };
}

function immutableProjection(storyboard) {
  return {
    prompts: {
      clips: Object.fromEntries(Object.entries(storyboard.clips || {}).map(([id, clip]) => [id, {
        beat: clip.beat,
        dialogueAnchor: clip.dialogueAnchor,
        continuityLocks: clip.continuityLocks
      }])),
      frames: Object.fromEntries(Object.entries(storyboard.frames || {}).map(([id, frame]) => [id, {
        prompt: frame.prompt,
        negativePrompt: frame.negativePrompt
      }])),
      segments: Object.fromEntries(Object.entries(storyboard.segments || {}).map(([id, segment]) => [id, { prompt: segment.prompt }])),
      plans: Object.fromEntries(Object.entries(storyboard.videoPlans || {}).map(([id, plan]) => [id, {
        globalPrompt: plan.globalPrompt,
        localPrompts: plan.localPrompts,
        negativePrompt: plan.negativePrompt
      }]))
    },
    temporalGuides: {
      clips: Object.fromEntries(Object.entries(storyboard.clips || {}).map(([id, clip]) => [id, {
        firstFrameId: clip.firstFrameId,
        lastFrameId: clip.lastFrameId
      }])),
      frames: Object.fromEntries(Object.entries(storyboard.frames || {}).map(([id, frame]) => [id, {
        id: frame.id,
        ownerId: frame.ownerId,
        purpose: frame.purpose,
        file: frame.file,
        generatedFile: frame.generatedFile,
        expectedInputPath: frame.expectedInputPath,
        activeGeneratedVersion: frame.activeGeneratedVersion,
        generatedVersions: frame.generatedVersions
      }])),
      segments: Object.fromEntries(Object.entries(storyboard.segments || {}).map(([id, segment]) => [id, {
        id: segment.id,
        frameId: segment.frameId,
        imageFile: segment.imageFile,
        videoFile: segment.videoFile,
        projectMediaPath: segment.projectMediaPath,
        startFrame: segment.startFrame,
        lengthFrames: segment.lengthFrames,
        usePreviousAsFirstFrame: segment.usePreviousAsFirstFrame,
        useNextAsLastFrame: segment.useNextAsLastFrame,
        generatedTakes: segment.generatedTakes
      }])),
      plans: Object.fromEntries(Object.entries(storyboard.videoPlans || {}).map(([id, plan]) => [id, {
        firstFramePackage: plan.firstFramePackage,
        segmentIds: plan.segmentIds
      }]))
    },
    voiceAndAudio: {
      clips: Object.fromEntries(Object.entries(storyboard.clips || {}).map(([id, clip]) => [id, {
        voiceReferences: clip.voiceReferences,
        audioPlan: clip.audioPlan
      }])),
      plans: Object.fromEntries(Object.entries(storyboard.videoPlans || {}).map(([id, plan]) => [id, {
        voiceReferences: plan.voiceReferences,
        audioPlan: plan.audioPlan,
        audioMode: plan.audioMode
      }])),
      segments: Object.fromEntries(Object.entries(storyboard.segments || {}).map(([id, segment]) => [id, {
        voiceReferences: segment.voiceReferences,
        audioPlan: segment.audioPlan
      }]))
    }
  };
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveBackupDirectory(backupDirectory) {
  const resolved = path.resolve(backupDirectory);
  const allowed = `${path.resolve(backupRoot)}${path.sep}`.toLowerCase();
  if (!`${resolved}${path.sep}`.toLowerCase().startsWith(allowed)) throw new Error("Backup must be inside the Harrowing visual-reference-cleanup backup root");
  return resolved;
}

function finalizeBackup(backupDirectory) {
  const resolved = resolveBackupDirectory(backupDirectory);
  const projectBeforeFile = path.join(resolved, "project.before.json");
  const storyboardBeforeFile = path.join(resolved, "storyboard.before.json");
  if (!fs.existsSync(projectBeforeFile) || !fs.existsSync(storyboardBeforeFile)) throw new Error("Backup is incomplete");
  const projectBeforeBytes = fs.readFileSync(projectBeforeFile);
  const storyboardBeforeBytes = fs.readFileSync(storyboardBeforeFile);
  const projectAfterBytes = fs.readFileSync(projectFile);
  const storyboardAfterBytes = fs.readFileSync(storyboardFile);
  const storyboardBefore = JSON.parse(storyboardBeforeBytes);
  const storyboardAfter = JSON.parse(storyboardAfterBytes);
  const cleanupProjection = enforceExplicitUserReferencePolicy(storyboardBefore);
  validateStoryboard(storyboardAfter, "harrowing_of_hell");
  const beforeProtected = immutableProjection(storyboardBefore);
  const cleanupProtected = immutableProjection(cleanupProjection);
  const afterProtected = immutableProjection(storyboardAfter);
  const protectedHashesBefore = {
    prompts: jsonSha(beforeProtected.prompts),
    temporalGuides: jsonSha(beforeProtected.temporalGuides),
    voiceAndAudio: jsonSha(beforeProtected.voiceAndAudio)
  };
  const protectedHashesAfter = {
    prompts: jsonSha(afterProtected.prompts),
    temporalGuides: jsonSha(afterProtected.temporalGuides),
    voiceAndAudio: jsonSha(afterProtected.voiceAndAudio)
  };
  const protectedHashesCleanupProjection = {
    prompts: jsonSha(cleanupProtected.prompts),
    temporalGuides: jsonSha(cleanupProtected.temporalGuides),
    voiceAndAudio: jsonSha(cleanupProtected.voiceAndAudio)
  };
  assertEqualJson(protectedHashesCleanupProjection, protectedHashesBefore, "Cleanup projection changes protected prompts, temporal guides, or voice/audio fields");
  if (protectedHashesAfter.temporalGuides !== protectedHashesBefore.temporalGuides || protectedHashesAfter.voiceAndAudio !== protectedHashesBefore.voiceAndAudio) {
    throw new Error(`Current temporal-guide or voice/audio data differs from the pre-cleanup backup: ${JSON.stringify({ protectedHashesBefore, protectedHashesAfter })}`);
  }
  const afterCounts = activeReferenceCounts(storyboardAfter);
  if (Object.values(afterCounts).some((count) => count !== 0)) throw new Error(`Active references remain after cleanup: ${JSON.stringify(afterCounts)}`);
  if (storyboardAfter.defaults?.visualReferencePersistence !== EXPLICIT_USER_REFERENCES_ONLY) throw new Error("Storyboard persistence policy is missing");
  const projectAfter = JSON.parse(projectAfterBytes);
  if (projectAfter.settings?.visualReferencePersistence !== EXPLICIT_USER_REFERENCES_ONLY) throw new Error("Project persistence policy is missing");
  const manifest = {
    operation: "visual-reference-cleanup",
    finalizedAt: new Date().toISOString(),
    backupDirectory: resolved,
    policy: EXPLICIT_USER_REFERENCES_ONLY,
    beforeHashes: { project: sha256(projectBeforeBytes), storyboard: sha256(storyboardBeforeBytes) },
    afterHashes: { project: sha256(projectAfterBytes), storyboard: sha256(storyboardAfterBytes) },
    beforeCounts: activeReferenceCounts(storyboardBefore),
    afterCounts,
    protectedHashesBefore,
    protectedHashesCleanupProjection,
    protectedHashesAfter,
    currentProtectedMatchesBackup: {
      prompts: protectedHashesAfter.prompts === protectedHashesBefore.prompts,
      temporalGuides: protectedHashesAfter.temporalGuides === protectedHashesBefore.temporalGuides,
      voiceAndAudio: protectedHashesAfter.voiceAndAudio === protectedHashesBefore.voiceAndAudio
    },
    chapters: Object.keys(storyboardAfter.chapters || {}).length,
    scenes: Object.keys(storyboardAfter.scenes || {}).length,
    clips: Object.keys(storyboardAfter.clips || {}).length,
    segments: Object.keys(storyboardAfter.segments || {}).length
  };
  atomicWrite(path.join(resolved, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2)));
  console.log(JSON.stringify(manifest, null, 2));
}

function assertEqualJson(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify({ expected, actual })}`);
}

function restore(backupDirectory) {
  const resolved = resolveBackupDirectory(backupDirectory);
  const projectBefore = path.join(resolved, "project.before.json");
  const storyboardBefore = path.join(resolved, "storyboard.before.json");
  if (!fs.existsSync(projectBefore) || !fs.existsSync(storyboardBefore)) throw new Error("Restore backup is incomplete");
  atomicWrite(projectFile, fs.readFileSync(projectBefore));
  atomicWrite(storyboardFile, fs.readFileSync(storyboardBefore));
  console.log(JSON.stringify({ restored: true, backupDirectory: resolved }, null, 2));
}

const restoreArg = process.argv.find((argument) => argument.startsWith("--restore="));
if (restoreArg) {
  restore(restoreArg.slice("--restore=".length));
  process.exit(0);
}

const finalizeArg = process.argv.find((argument) => argument.startsWith("--finalize-backup="));
if (finalizeArg) {
  finalizeBackup(finalizeArg.slice("--finalize-backup=".length));
  process.exit(0);
}

const apply = process.argv.includes("--apply");
const projectBeforeBytes = fs.readFileSync(projectFile);
const storyboardBeforeBytes = fs.readFileSync(storyboardFile);
const beforeHashes = {
  project: sha256(projectBeforeBytes),
  storyboard: sha256(storyboardBeforeBytes)
};
const project = JSON.parse(projectBeforeBytes);
const storyboard = JSON.parse(storyboardBeforeBytes);
const immutableBefore = immutableProjection(storyboard);
const immutableHashesBefore = {
  prompts: jsonSha(immutableBefore.prompts),
  temporalGuides: jsonSha(immutableBefore.temporalGuides),
  voiceAndAudio: jsonSha(immutableBefore.voiceAndAudio)
};

project.settings ||= {};
project.settings.visualReferencePersistence = EXPLICIT_USER_REFERENCES_ONLY;
project.updatedAt = new Date().toISOString();
let nextStoryboard = enforceExplicitUserReferencePolicy(storyboard);
nextStoryboard.updatedAt = new Date().toISOString();
validateStoryboard(nextStoryboard, "harrowing_of_hell");

const immutableAfter = immutableProjection(nextStoryboard);
const immutableHashesAfter = {
  prompts: jsonSha(immutableAfter.prompts),
  temporalGuides: jsonSha(immutableAfter.temporalGuides),
  voiceAndAudio: jsonSha(immutableAfter.voiceAndAudio)
};
if (JSON.stringify(immutableHashesAfter) !== JSON.stringify(immutableHashesBefore)) {
  throw new Error(`Protected prompts, temporal guides, or voice/audio fields changed: ${JSON.stringify({ immutableHashesBefore, immutableHashesAfter })}`);
}

const projectAfterBytes = Buffer.from(JSON.stringify(project, null, 2));
const storyboardAfterBytes = Buffer.from(JSON.stringify(nextStoryboard, null, 2));
const report = {
  apply,
  policy: EXPLICIT_USER_REFERENCES_ONLY,
  beforeHashes,
  afterHashes: {
    project: sha256(projectAfterBytes),
    storyboard: sha256(storyboardAfterBytes)
  },
  beforeCounts: activeReferenceCounts(storyboard),
  afterCounts: activeReferenceCounts(nextStoryboard),
  protectedHashes: immutableHashesAfter,
  chapters: Object.keys(nextStoryboard.chapters || {}).length,
  scenes: Object.keys(nextStoryboard.scenes || {}).length,
  clips: Object.keys(nextStoryboard.clips || {}).length,
  segments: Object.keys(nextStoryboard.segments || {}).length
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  console.log("Dry run only. Re-run with --apply to back up and write the cleanup.");
  process.exit(0);
}

const backupDirectory = path.join(backupRoot, timestampName());
fs.mkdirSync(backupDirectory, { recursive: true });
fs.writeFileSync(path.join(backupDirectory, "project.before.json"), projectBeforeBytes);
fs.writeFileSync(path.join(backupDirectory, "storyboard.before.json"), storyboardBeforeBytes);

const currentHashes = {
  project: sha256(fs.readFileSync(projectFile)),
  storyboard: sha256(fs.readFileSync(storyboardFile))
};
if (currentHashes.project !== beforeHashes.project || currentHashes.storyboard !== beforeHashes.storyboard) {
  throw new Error(`Project changed during cleanup preparation; nothing was written. Expected ${JSON.stringify(beforeHashes)}, found ${JSON.stringify(currentHashes)}`);
}

atomicWrite(projectFile, projectAfterBytes);
atomicWrite(storyboardFile, storyboardAfterBytes);
const written = {
  project: sha256(fs.readFileSync(projectFile)),
  storyboard: sha256(fs.readFileSync(storyboardFile))
};
if (written.project !== report.afterHashes.project || written.storyboard !== report.afterHashes.storyboard) {
  throw new Error(`Post-write hash verification failed: ${JSON.stringify({ expected: report.afterHashes, written })}`);
}
fs.writeFileSync(path.join(backupDirectory, "manifest.json"), JSON.stringify({ ...report, backupDirectory, written }, null, 2));
console.log(JSON.stringify({ ...report, backupDirectory, written }, null, 2));
