import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_PROJECT_ROOT = path.join(REPO_ROOT, "projects", "harrowing_of_hell");
const DEFAULT_PACKAGE = path.join(os.homedir(), "Downloads", "Harrowing_T2V_Reference_Package.zip");
const PACKAGE_ROOT = "Harrowing_T2V_Reference_Package";
const PACKAGE_ENTRIES = {
  storyboard: `${PACKAGE_ROOT}/prompts/production/storyboard.json`,
  project: `${PACKAGE_ROOT}/prompts/project.json`,
  jobs: `${PACKAGE_ROOT}/prompts/generation-jobs.json`,
  assetIndex: `${PACKAGE_ROOT}/reference_assets/asset_index.json`,
  resolverConfig: `${PACKAGE_ROOT}/reference_assets/resolver_config.json`,
  qa: `${PACKAGE_ROOT}/QA_REPORT.json`,
  manifest: `${PACKAGE_ROOT}/PACKAGE_MANIFEST.sha256`,
  referenceRoot: `${PACKAGE_ROOT}/reference_assets`
};
const EXPECTED_PACKAGE_SHA256 = "F2DD0115AD914640A1B2F076CF8B01DE69287A6C3F132149BBD7CC1E5669A6C2";
const EXPECTED_STORYBOARD_SHA256 = "84C9F3B4C84451802A4C0EB33E8B4FB1CD40E78C7A2720CBE8B3098223A5921A";
const REQUIRED_SOUNDTRACK = {
  relativePath: "media/audio/into-your-hands-passion-ltx-48k-stereo-242s.v1.flac",
  bytes: 27089476,
  sha256: "AC5FE759636AFD9674D4D26464FCA28B934A1802735A17A424FC75026932B932"
};
const T2V_SETTING_KEYS = [
  "ingredients",
  "videoGenerationMode",
  "firstFrameGeneration",
  "lastFrameGeneration",
  "referenceRoot",
  "maxReferencesPerClip",
  "referenceResolver"
];
const ACTIVE_JOB_STATUSES = new Set(["queued", "pending", "running", "processing"]);

function parseArgs(argv) {
  const options = {
    projectRoot: DEFAULT_PROJECT_ROOT,
    package: DEFAULT_PACKAGE,
    expectedPackageSha256: EXPECTED_PACKAGE_SHA256,
    expectedStoryboardSha256: "",
    expectedProjectSha256: "",
    expectedJobsSha256: "",
    dryRun: false,
    restore: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--project-root") options.projectRoot = path.resolve(argv[++index]);
    else if (argument === "--package") options.package = path.resolve(argv[++index]);
    else if (argument === "--expected-package-sha256") options.expectedPackageSha256 = String(argv[++index] || "").toUpperCase();
    else if (argument === "--expected-storyboard-sha256") options.expectedStoryboardSha256 = String(argv[++index] || "").toUpperCase();
    else if (argument === "--expected-project-sha256") options.expectedProjectSha256 = String(argv[++index] || "").toUpperCase();
    else if (argument === "--expected-jobs-sha256") options.expectedJobsSha256 = String(argv[++index] || "").toUpperCase();
    else if (argument === "--restore") options.restore = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizedTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function runTar(args, { encoding = null, maxBuffer = 512 * 1024 * 1024 } = {}) {
  const result = spawnSync("tar", args, { encoding, maxBuffer, windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${String(result.stderr || result.error || "unknown error").trim()}`);
  }
  return result.stdout;
}

function readZipBuffer(zipPath, entry) {
  return runTar(["-xOf", zipPath, entry]);
}

function readZipJson(zipPath, entry) {
  return JSON.parse(readZipBuffer(zipPath, entry).toString("utf8"));
}

function listZipEntries(zipPath) {
  return runTar(["-tf", zipPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseShaManifest(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/i);
    if (match) entries.set(match[2].replace(/\\/g, "/"), match[1].toUpperCase());
  }
  return entries;
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else {
        assert(entry.isFile(), `Reference package contains a non-file entry: ${fullPath}`);
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function portableRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function safeTarget(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...String(relativePath).split("/"));
  assert(target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`), `Unsafe relative path: ${relativePath}`);
  return target;
}

function atomicWrite(filePath, buffer) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function countValues(map, field) {
  const counts = {};
  for (const value of Object.values(map || {})) {
    const key = value?.[field] == null ? "missing" : String(value[field]);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function validatePackageStoryboard(storyboard, assetIndex) {
  assert(storyboard.schemaVersion === "premiere316.storyboard.v1", "Unexpected package storyboard schema");
  assert(storyboard.projectId === "harrowing_of_hell", "Unexpected package storyboard project");
  for (const key of ["chapters", "scenes", "clips", "frames", "videoPlans", "segments", "referenceBindings"]) {
    assert(storyboard[key] && typeof storyboard[key] === "object" && !Array.isArray(storyboard[key]), `Invalid storyboard ${key} map`);
  }
  assert(Object.keys(storyboard.clips).length === 153, "Package must contain 153 clips");
  assert(Object.keys(storyboard.frames).length === 0, "Package frame registry must be empty for T2V");
  assert(Object.keys(storyboard.videoPlans).length === 153, "Package must contain 153 video plans");
  assert(Object.keys(storyboard.segments).length === 392, "Package must contain 392 segments");
  assert(Object.keys(storyboard.referenceBindings).length === 678, "Package must contain 678 semantic bindings");
  assert(storyboard.runtimeFrames === 54792, "Unexpected package runtime frame count");
  assert(storyboard.workflowProfile?.id === "ltx-2.5-t2v-semantic-reference-resolver", "Package does not select the T2V workflow");
  assert(storyboard.defaults?.firstFrameGeneration === false, "Package first-frame generation must be disabled");
  assert(storyboard.defaults?.lastFrameGeneration === false, "Package last-frame generation must be disabled");
  assert(storyboard.defaults?.timedImageSegments === false, "Package timed image segments must be disabled");

  const canonicalAssets = new Set(assetIndex.assets.map((asset) => asset.canonical));
  const bindingsByPlan = new Map();
  for (const binding of Object.values(storyboard.referenceBindings)) {
    assert(binding.targetKind === "video_plan", `Non-T2V binding target: ${binding.id}`);
    assert(binding.useMode === "semantic_reference", `Non-semantic binding: ${binding.id}`);
    assert(storyboard.videoPlans[binding.targetId], `Binding target missing: ${binding.id}`);
    assert(canonicalAssets.has(binding.canonicalFile), `Binding asset missing from index: ${binding.canonicalFile}`);
    const group = bindingsByPlan.get(binding.targetId) || [];
    group.push(binding);
    bindingsByPlan.set(binding.targetId, group);
  }

  for (const [clipId, clip] of Object.entries(storyboard.clips)) {
    assert(!Object.hasOwn(clip, "firstFrameId"), `T2V clip retains firstFrameId: ${clipId}`);
    assert(clip.generationMode === "t2v_with_semantic_references", `Clip is not T2V: ${clipId}`);
    const plan = storyboard.videoPlans[clip.videoPlanId];
    assert(plan?.clipId === clipId, `Clip/video-plan mapping mismatch: ${clipId}`);
    assert(plan.workflowProfileId === storyboard.workflowProfile.id, `Wrong workflow profile: ${clipId}`);
    assert(plan.generationMode === "t2v_with_semantic_references", `Plan is not T2V: ${clipId}`);
    assert(plan.referenceMode === "semantic_reference_resolver", `Plan resolver mode mismatch: ${clipId}`);
    assert(plan.referenceRoot === "reference_assets", `Plan reference root mismatch: ${clipId}`);
    assert(plan.status === "ready", `Plan is not ready: ${clipId}`);
    assert(!Object.hasOwn(plan, "guideStrength"), `Plan retains guide strength: ${clipId}`);
    assert(Array.isArray(plan.referenceFiles) && plan.referenceFiles.length <= 9, `Reference cap exceeded: ${clipId}`);
    assert(plan.referenceCount === plan.referenceFiles.length, `Reference count mismatch: ${clipId}`);
    assert(plan.timelineData?.global_prompt === plan.globalPrompt, `Global prompt mirror mismatch: ${clipId}`);
    assert((plan.timelineData?.segments || []).length === plan.segmentIds.length, `Timeline segment count mismatch: ${clipId}`);
    assert(clip.decodedFrames === clip.durationFrames + 1, `Decoded frame contract mismatch: ${clipId}`);
    assert(clip.trimDecodedFrames === 1, `Trim contract mismatch: ${clipId}`);

    let cursor = 0;
    for (const segmentId of plan.segmentIds) {
      const segment = storyboard.segments[segmentId];
      assert(segment?.videoPlanId === plan.id, `Segment plan mapping mismatch: ${segmentId}`);
      assert(segment.type === "text", `Non-text segment remains: ${segmentId}`);
      assert(segment.status === "ready", `Segment is not ready: ${segmentId}`);
      assert(!Object.hasOwn(segment, "frameId"), `Segment retains frameId: ${segmentId}`);
      assert(!Object.hasOwn(segment, "handoffNodeId"), `Segment retains handoff node: ${segmentId}`);
      assert(!Object.hasOwn(segment, "projectMediaPath"), `Segment retains project media path: ${segmentId}`);
      assert(segment.startFrame === cursor, `Segment timing gap: ${segmentId}`);
      cursor += segment.lengthFrames;
    }
    assert(cursor === clip.durationFrames, `Segment duration mismatch: ${clipId}`);

    const orderedBindings = (bindingsByPlan.get(plan.id) || []).sort((a, b) => a.order - b.order);
    assert(
      JSON.stringify(orderedBindings.map((binding) => binding.canonicalFile)) === JSON.stringify(plan.referenceFiles),
      `Plan/binding reference mismatch: ${clipId}`
    );
  }

  return {
    clips: Object.keys(storyboard.clips).length,
    frames: Object.keys(storyboard.frames).length,
    videoPlans: Object.keys(storyboard.videoPlans).length,
    segments: Object.keys(storyboard.segments).length,
    referenceBindings: Object.keys(storyboard.referenceBindings).length,
    audioModes: countValues(storyboard.videoPlans, "audioMode")
  };
}

function validatePackageAssets(sourceRoot, assetIndex, manifest) {
  assert(assetIndex.schema === "premiere316.canonical-reference-assets.v1", "Unexpected asset-index schema");
  assert(assetIndex.assets.length === 88, `Expected 88 indexed assets, received ${assetIndex.assets.length}`);
  assert((assetIndex.missingSources || []).length === 0, "Asset index reports missing sources");
  const sourceFiles = walkFiles(sourceRoot);
  assert(sourceFiles.length === 90, `Expected 90 reference package files, received ${sourceFiles.length}`);
  const records = [];
  for (const sourceFile of sourceFiles) {
    const relativePath = portableRelative(sourceRoot, sourceFile);
    const fileSha256 = sha256File(sourceFile);
    const manifestKey = `reference_assets/${relativePath}`;
    assert(manifest.get(manifestKey) === fileSha256, `Package manifest mismatch: ${manifestKey}`);
    records.push({ relativePath, bytes: fs.statSync(sourceFile).size, sha256: fileSha256, sourceFile });
  }
  const recordsByPath = new Map(records.map((record) => [record.relativePath, record]));
  for (const asset of assetIndex.assets) {
    const record = recordsByPath.get(asset.canonical);
    assert(record, `Indexed canonical asset is absent: ${asset.canonical}`);
    assert(record.bytes === asset.bytes, `Indexed size mismatch: ${asset.canonical}`);
    assert(record.sha256 === asset.sha256.toUpperCase(), `Indexed hash mismatch: ${asset.canonical}`);
  }
  return records;
}

function verifyProjectMerge(before, after, packageProject) {
  for (const key of Object.keys(before)) {
    if (key === "settings" || key === "updatedAt") continue;
    assert(JSON.stringify(before[key]) === JSON.stringify(after[key]), `Project field changed unexpectedly: ${key}`);
  }
  for (const key of Object.keys(before.settings || {})) {
    if (T2V_SETTING_KEYS.includes(key)) continue;
    assert(JSON.stringify(before.settings[key]) === JSON.stringify(after.settings[key]), `Project setting changed unexpectedly: ${key}`);
  }
  for (const key of T2V_SETTING_KEYS) {
    assert(JSON.stringify(after.settings[key]) === JSON.stringify(packageProject.settings[key]), `T2V setting mismatch: ${key}`);
  }
  assert(JSON.stringify(before.assets) === JSON.stringify(after.assets), "User project asset catalog changed unexpectedly");
}

function collisionPlan(records, targetRoot) {
  const create = [];
  const equal = [];
  const different = [];
  for (const record of records) {
    const target = safeTarget(targetRoot, record.relativePath);
    if (!fs.existsSync(target)) create.push(record);
    else if (!fs.statSync(target).isFile()) different.push({ relativePath: record.relativePath, reason: "target is not a regular file" });
    else {
      const targetSha256 = sha256File(target);
      if (targetSha256 === record.sha256) equal.push(record);
      else different.push({ relativePath: record.relativePath, packageSha256: record.sha256, targetSha256 });
    }
  }
  return { create, equal, different };
}

function removeCreatedFiles(created, targetRoot) {
  for (const record of [...created].reverse()) {
    const target = safeTarget(targetRoot, record.relativePath);
    if (fs.existsSync(target) && fs.statSync(target).isFile() && sha256File(target) === record.sha256) fs.unlinkSync(target);
  }
  if (!fs.existsSync(targetRoot)) return;
  const directories = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
    }
    directories.push(directory);
  };
  visit(targetRoot);
  for (const directory of directories) {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
}

function restoreMigration(backupDir) {
  const resultPath = path.join(backupDir, "migration-result.json");
  assert(fs.existsSync(resultPath), `Migration result not found: ${resultPath}`);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const projectRoot = path.resolve(result.projectRoot);
  const files = {
    storyboard: path.join(projectRoot, "production", "storyboard.json"),
    project: path.join(projectRoot, "project.json"),
    jobs: path.join(projectRoot, "generation-jobs.json")
  };
  for (const [key, filePath] of Object.entries(files)) {
    assert(fs.existsSync(filePath), `Current ${key} file is missing: ${filePath}`);
    assert(sha256File(filePath) === result.afterHashes[key], `Refusing restore because ${key} changed after migration`);
  }
  const targetRoot = path.join(projectRoot, "reference_assets");
  for (const record of result.createdReferenceFiles || []) {
    const target = safeTarget(targetRoot, record.relativePath);
    assert(fs.existsSync(target), `Created reference asset is missing: ${record.relativePath}`);
    assert(sha256File(target) === record.sha256, `Refusing restore because a reference asset changed: ${record.relativePath}`);
  }

  atomicWrite(files.project, fs.readFileSync(path.join(backupDir, "project.before.json")));
  atomicWrite(files.storyboard, fs.readFileSync(path.join(backupDir, "storyboard.before.json")));
  atomicWrite(files.jobs, fs.readFileSync(path.join(backupDir, "generation-jobs.before.json")));
  removeCreatedFiles(result.createdReferenceFiles || [], targetRoot);
  const restored = {
    restoredAt: new Date().toISOString(),
    backupDir,
    projectRoot,
    restoredHashes: {
      project: sha256File(files.project),
      storyboard: sha256File(files.storyboard),
      jobs: sha256File(files.jobs)
    },
    removedReferenceFiles: (result.createdReferenceFiles || []).length
  };
  fs.writeFileSync(path.join(backupDir, "restore-result.json"), jsonBuffer(restored));
  console.log(JSON.stringify(restored, null, 2));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.restore) {
    assert(!options.dryRun, "--dry-run cannot be combined with --restore");
    restoreMigration(options.restore);
    return;
  }

  const projectRoot = path.resolve(options.projectRoot);
  const files = {
    storyboard: path.join(projectRoot, "production", "storyboard.json"),
    project: path.join(projectRoot, "project.json"),
    jobs: path.join(projectRoot, "generation-jobs.json")
  };
  for (const [key, filePath] of Object.entries(files)) assert(fs.existsSync(filePath), `Current ${key} file not found: ${filePath}`);
  assert(fs.existsSync(options.package), `Package not found: ${options.package}`);

  const beforeBuffers = Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, fs.readFileSync(filePath)]));
  const beforeHashes = Object.fromEntries(Object.entries(beforeBuffers).map(([key, buffer]) => [key, sha256(buffer)]));
  if (options.expectedStoryboardSha256) assert(beforeHashes.storyboard === options.expectedStoryboardSha256, `Storyboard changed since preflight: ${beforeHashes.storyboard}`);
  if (options.expectedProjectSha256) assert(beforeHashes.project === options.expectedProjectSha256, `Project changed since preflight: ${beforeHashes.project}`);
  if (options.expectedJobsSha256) assert(beforeHashes.jobs === options.expectedJobsSha256, `Jobs changed since preflight: ${beforeHashes.jobs}`);

  const packageSha256 = sha256File(options.package);
  if (options.expectedPackageSha256) assert(packageSha256 === options.expectedPackageSha256, `Package hash mismatch: ${packageSha256}`);
  const packageBuffers = {
    storyboard: readZipBuffer(options.package, PACKAGE_ENTRIES.storyboard),
    project: readZipBuffer(options.package, PACKAGE_ENTRIES.project),
    jobs: readZipBuffer(options.package, PACKAGE_ENTRIES.jobs)
  };
  const packageHashes = Object.fromEntries(Object.entries(packageBuffers).map(([key, buffer]) => [key, sha256(buffer)]));
  assert(packageHashes.storyboard === EXPECTED_STORYBOARD_SHA256, `Package storyboard hash mismatch: ${packageHashes.storyboard}`);

  const current = {
    storyboard: JSON.parse(beforeBuffers.storyboard.toString("utf8")),
    project: JSON.parse(beforeBuffers.project.toString("utf8")),
    jobs: JSON.parse(beforeBuffers.jobs.toString("utf8"))
  };
  const source = {
    storyboard: JSON.parse(packageBuffers.storyboard.toString("utf8")),
    project: JSON.parse(packageBuffers.project.toString("utf8")),
    jobs: JSON.parse(packageBuffers.jobs.toString("utf8")),
    assetIndex: readZipJson(options.package, PACKAGE_ENTRIES.assetIndex),
    resolverConfig: readZipJson(options.package, PACKAGE_ENTRIES.resolverConfig),
    qa: readZipJson(options.package, PACKAGE_ENTRIES.qa)
  };
  assert(source.qa.passed === true && source.qa.summary?.failedChecks === 0, "Package QA report is not passing");
  assert(source.jobs.jobs?.length === 0, "Package generation-job queue is not empty");
  assert(source.project.slug === current.project.slug, "Package/current project mismatch");
  assert(source.project.settings?.referenceRoot === "reference_assets", "Package project reference root mismatch");
  assert(source.resolverConfig.temporalInsertion === false && source.resolverConfig.insertAtFrameZero === false, "Package resolver permits temporal insertion");
  const activeJobs = (current.jobs.jobs || []).filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  assert(activeJobs.length === 0, `Refusing migration while ${activeJobs.length} project jobs are active`);

  const soundtrack = path.join(projectRoot, ...REQUIRED_SOUNDTRACK.relativePath.split("/"));
  assert(fs.existsSync(soundtrack), `Required soundtrack is missing: ${soundtrack}`);
  assert(fs.statSync(soundtrack).size === REQUIRED_SOUNDTRACK.bytes, "Required soundtrack size mismatch");
  assert(sha256File(soundtrack) === REQUIRED_SOUNDTRACK.sha256, "Required soundtrack hash mismatch");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-t2v-package-"));
  let records;
  try {
    const listedEntries = listZipEntries(options.package);
    const assetEntries = listedEntries.filter((entry) => entry === `${PACKAGE_ENTRIES.referenceRoot}/` || entry.startsWith(`${PACKAGE_ENTRIES.referenceRoot}/`));
    assert(assetEntries.length >= 91, "Reference-assets package subtree is incomplete");
    for (const entry of assetEntries) {
      const relative = entry.slice(PACKAGE_ENTRIES.referenceRoot.length).replace(/^\//, "");
      assert(!relative.split("/").includes("..") && !path.posix.isAbsolute(relative), `Unsafe ZIP entry: ${entry}`);
    }
    runTar(["-xf", options.package, "-C", tempRoot, PACKAGE_ENTRIES.referenceRoot]);
    const extractedRoot = path.join(tempRoot, ...PACKAGE_ENTRIES.referenceRoot.split("/"));
    assert(fs.existsSync(extractedRoot), "Reference-assets subtree was not extracted");
    const manifest = parseShaManifest(readZipBuffer(options.package, PACKAGE_ENTRIES.manifest).toString("utf8"));
    records = validatePackageAssets(extractedRoot, source.assetIndex, manifest);
    validatePackageStoryboard(source.storyboard, source.assetIndex);

    const targetRoot = path.join(projectRoot, "reference_assets");
    const collisions = collisionPlan(records, targetRoot);
    const plan = {
      dryRun: options.dryRun,
      package: options.package,
      packageSha256,
      packageHashes,
      projectRoot,
      targetReferenceRoot: targetRoot,
      beforeHashes,
      currentState: {
        frames: Object.keys(current.storyboard.frames || {}).length,
        firstFrameClips: Object.values(current.storyboard.clips || {}).filter((clip) => Object.hasOwn(clip, "firstFrameId")).length,
        imageSegments: Object.values(current.storyboard.segments || {}).filter((segment) => segment.type === "image").length,
        referenceBindings: Object.keys(current.storyboard.referenceBindings || {}).length,
        legacyFrameSegmentReferenceBindings: Object.values(current.storyboard.referenceBindings || {})
          .filter((binding) => binding.targetKind === "frame" || binding.targetKind === "segment").length,
        semanticVideoPlanReferenceBindings: Object.values(current.storyboard.referenceBindings || {})
          .filter((binding) => binding.targetKind === "video_plan" && binding.useMode === "semantic_reference").length,
        imageGenerationJobs: (current.jobs.jobs || []).filter((job) => job.type === "generate_storyboard_frame").length,
        activeJobs: activeJobs.length
      },
      nextState: validatePackageStoryboard(source.storyboard, source.assetIndex),
      referenceAssets: {
        packageFiles: records.length,
        create: collisions.create.length,
        alreadyEqual: collisions.equal.length,
        different: collisions.different
      },
      soundtrack: { path: soundtrack, bytes: REQUIRED_SOUNDTRACK.bytes, sha256: REQUIRED_SOUNDTRACK.sha256 }
    };
    assert(collisions.different.length === 0, `Reference-asset collisions detected: ${JSON.stringify(collisions.different)}`);
    if (options.dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    const now = new Date();
    const migratedProject = structuredClone(current.project);
    migratedProject.settings = { ...(current.project.settings || {}) };
    for (const key of T2V_SETTING_KEYS) migratedProject.settings[key] = structuredClone(source.project.settings[key]);
    migratedProject.updatedAt = now.toISOString();
    verifyProjectMerge(current.project, migratedProject, source.project);
    const migratedJobs = structuredClone(source.jobs);
    migratedJobs.updatedAt = now.toISOString();
    migratedJobs.migrationNote = "Legacy storyboard image-generation job history was backed up; active Harrowing plans are T2V with semantic references.";
    const afterBuffers = {
      project: jsonBuffer(migratedProject),
      storyboard: packageBuffers.storyboard,
      jobs: jsonBuffer(migratedJobs)
    };

    const backupDir = path.join(projectRoot, "backups", "t2v-full-migration", normalizedTimestamp(now));
    assert(!fs.existsSync(backupDir), `Backup directory already exists: ${backupDir}`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, "project.before.json"), beforeBuffers.project);
    fs.writeFileSync(path.join(backupDir, "storyboard.before.json"), beforeBuffers.storyboard);
    fs.writeFileSync(path.join(backupDir, "generation-jobs.before.json"), beforeBuffers.jobs);
    const sourceRecord = {
      schema: "premiere316.full-t2v-migration-source.v1",
      createdAt: now.toISOString(),
      ...plan,
      backupDir,
      migrationScope: "Replace the active storyboard with the package T2V structure, merge only T2V project settings, archive and clear legacy image-generation jobs, and install canonical reference_assets without overwriting different files."
    };
    fs.writeFileSync(path.join(backupDir, "source-package.json"), jsonBuffer(sourceRecord));
    for (const [key, backupName] of Object.entries({ project: "project.before.json", storyboard: "storyboard.before.json", jobs: "generation-jobs.before.json" })) {
      assert(sha256File(path.join(backupDir, backupName)) === beforeHashes[key], `Backup hash mismatch: ${backupName}`);
    }

    const created = [];
    try {
      for (const record of collisions.create) {
        const target = safeTarget(targetRoot, record.relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(record.sourceFile, target, fs.constants.COPYFILE_EXCL);
        assert(sha256File(target) === record.sha256, `Copied reference hash mismatch: ${record.relativePath}`);
        created.push({ relativePath: record.relativePath, bytes: record.bytes, sha256: record.sha256 });
      }
      for (const [key, filePath] of Object.entries(files)) {
        assert(sha256File(filePath) === beforeHashes[key], `${key} changed while backups/assets were prepared`);
      }
      atomicWrite(files.project, afterBuffers.project);
      atomicWrite(files.storyboard, afterBuffers.storyboard);
      atomicWrite(files.jobs, afterBuffers.jobs);

      const writtenProject = JSON.parse(fs.readFileSync(files.project, "utf8"));
      const writtenStoryboard = JSON.parse(fs.readFileSync(files.storyboard, "utf8"));
      const writtenJobs = JSON.parse(fs.readFileSync(files.jobs, "utf8"));
      verifyProjectMerge(current.project, writtenProject, source.project);
      validatePackageStoryboard(writtenStoryboard, source.assetIndex);
      assert((writtenJobs.jobs || []).length === 0, "Written active generation-job list is not empty");
      assert(sha256File(files.storyboard) === packageHashes.storyboard, "Written storyboard is not byte-identical to the package source");
      for (const record of records) assert(sha256File(safeTarget(targetRoot, record.relativePath)) === record.sha256, `Installed reference hash mismatch: ${record.relativePath}`);

      const result = {
        schema: "premiere316.full-t2v-migration-result.v1",
        completedAt: new Date().toISOString(),
        package: options.package,
        packageSha256,
        projectRoot,
        backupDir,
        beforeHashes,
        afterHashes: {
          project: sha256File(files.project),
          storyboard: sha256File(files.storyboard),
          jobs: sha256File(files.jobs)
        },
        createdReferenceFiles: created,
        preexistingEqualReferenceFiles: collisions.equal.map(({ relativePath, bytes, sha256: hash }) => ({ relativePath, bytes, sha256: hash })),
        currentState: plan.currentState,
        nextState: plan.nextState,
        projectAssetCatalogPreserved: JSON.stringify(current.project.assets) === JSON.stringify(writtenProject.assets),
        restoreCommand: `node "${fileURLToPath(import.meta.url)}" --restore "${backupDir}"`
      };
      fs.writeFileSync(path.join(backupDir, "migration-result.json"), jsonBuffer(result));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      try { atomicWrite(files.project, beforeBuffers.project); } catch {}
      try { atomicWrite(files.storyboard, beforeBuffers.storyboard); } catch {}
      try { atomicWrite(files.jobs, beforeBuffers.jobs); } catch {}
      try { removeCreatedFiles(created, targetRoot); } catch {}
      fs.writeFileSync(path.join(backupDir, "migration-failed.json"), jsonBuffer({ failedAt: new Date().toISOString(), error: String(error?.stack || error) }));
      throw error;
    }
  } finally {
    const resolvedTemp = path.resolve(tempRoot);
    assert(resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep), `Refusing to remove non-temp directory: ${resolvedTemp}`);
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

main();
