import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, validateStoryboard } from "../server/storyboard.js";

export const PACKAGE_ID = "h01_ltx25_i2v_reference_corrected_v2";
export const EXPECTED_ARCHIVE_SHA256 = "d0a0fe7a1a0ab7a195a9df21015e490aaa477d695f99ad2aec37a0472fd0d049";
export const TARGET_CLIP_IDS = ["H01-S01-C01", "H01-S01-C02", "H01-S02-C01", "H01-S02-C02"];
const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "finalizing"]);
const FPS = 24;
const EXPECTED_PACKAGE_FILES = new Map(Object.entries({
  "H01_I2V_PROMPTS.md": "4245a1a5d08a7bcc13aab936c6e7259bef43a7a3b7eb673d28a24041dace275b",
  "H01_FIRST_FRAME_BINDINGS.csv": "d048ce044a70a04fd0205bc22c66002e134e66db87a76d8459a070740253cfdb",
  "H01_SOURCE_REFERENCES.md": "f6f962a646cc1778fa23f43c542a10f88b4892fde8d0d84194933db068774c29",
  "first_frames/H01-S01-C01_SEG01_FIRST.png": "95520999ae9b2828e255a118e5789803f3ac536d6d4a90876e83e4d7908c91e5",
  "first_frames/H01-S01-C01_SEG02_FIRST.png": "c6eb9e39b9e4ed37d58a2663fcba23901595a822398e070c9d3218fb9ba425ca",
  "first_frames/H01-S01-C01_SEG03_FIRST.png": "3782f61fee8f45d047ec77824224fee4fcd96e38fbfb38aec5a01b2d2df90190",
  "first_frames/H01-S01-C01_SEG04_FIRST.png": "7732d9f38c3f76f197663e29da6367c46453206e05990adb2abb98cb682d5fad",
  "first_frames/H01-S01-C02_SEG01_FIRST.png": "31de9d59d61757d63c60798fa804ccdd18a8a214bf62fc2a56c9d89728141f7e",
  "first_frames/H01-S01-C02_SEG02_FIRST.png": "6149147f024aab590477b748cfe0f3469a6ac1c3e4fde6e8a39e3f7221213af8",
  "first_frames/H01-S01-C02_SEG03_FIRST.png": "8a583bca1d5e6d33a83ec2120066e5943d5dc869a71d0f54c791400a8871c9f8",
  "first_frames/H01-S02-C01_SEG01_FIRST.png": "7454a858b9c8272cf0ae86b00cd2c7e168c6a9b73b93320a04f55a86538133cd",
  "first_frames/H01-S02-C01_SEG02_FIRST.png": "b5500fbd0dd872088cde44db0eb0754dfd438f28b735508c861458b2161ce112",
  "first_frames/H01-S02-C01_SEG03_FIRST.png": "b1b46b2fe2d75e091067bb95cb10afcfdfceff985c33de71e9cf602c56a90b41",
  "first_frames/H01-S02-C02_SEG01_FIRST.png": "adb1459fa3f194a93ecb97ce3e07f695159056e2264956ce2da53a02e7102ef3",
  "first_frames/H01-S02-C02_SEG02_FIRST.png": "faa323ea5caabf68e5d24cd6f1a412a11f320bb5b657d9858df3fed42f0d578e",
  "first_frames/H01-S02-C02_SEG03_FIRST.png": "caac6939993e8d1228f04d94aed15e03453fc782ad6ec3f07082b27c0173313e"
}));

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function safeSourcePath(root, relative) {
  const normalized = String(relative || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe package path: ${relative || "empty"}`);
  }
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, ...normalized.split("/"));
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Package path escapes its root: ${relative}`);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Package file is missing: ${relative}`);
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Package file escapes its root: ${relative}`);
  return real;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",");
    if (cells.length !== headers.length) throw new Error(`Unsupported CSV row: ${line}`);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

function parsePromptPackage(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const visualLock = normalized.match(/Global visual lock for every segment:\s*(.+?)(?=\n\n)/s)?.[1]?.trim();
  const negativePrompt = normalized.match(/## Shared negative prompt\s*\n+([\s\S]+)$/)?.[1]?.trim();
  if (!visualLock || !negativePrompt) throw new Error("Prompt package is missing its global visual lock or shared negative prompt");
  const prompts = new Map();
  const clipExpression = /^## (H01-S\d{2}-C\d{2})[^\n]*\n([\s\S]*?)(?=^## )/gm;
  let clipMatch;
  while ((clipMatch = clipExpression.exec(`${normalized}\n## __END__\n`))) {
    const clipId = clipMatch[1];
    const body = clipMatch[2];
    const segmentExpression = /^### SEG(\d{2})[^\n]*\n+First frame:\s*`([^`]+)`\s*\n+([\s\S]*?)(?=^### )/gm;
    let segmentMatch;
    while ((segmentMatch = segmentExpression.exec(`${body}\n### __END__\n`))) {
      const key = `${clipId}:SEG${segmentMatch[1]}`;
      prompts.set(key, {
        firstFrame: segmentMatch[2].trim().replace(/\\/g, "/"),
        prompt: segmentMatch[3].trim()
      });
    }
  }
  return { visualLock, negativePrompt, prompts };
}

function parseSourceReferences(markdown) {
  const sections = new Map();
  const normalized = markdown.replace(/\r\n/g, "\n");
  const expression = /^## (H01-S\d{2}(?:-C\d{2})?)\s*\n([\s\S]*?)(?=^## )/gm;
  let match;
  while ((match = expression.exec(`${normalized}\n## __END__\n`))) {
    const files = [...match[2].matchAll(/`assets\/([^`]+)`/g)].map((item) => item[1]);
    sections.set(match[1], [...new Set(files)]);
  }
  return sections;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("First-frame package contains a non-PNG image");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (bitDepth !== 8 || colorType !== 2) throw new Error(`First-frame PNG must be 8-bit RGB; received bit depth ${bitDepth}, color type ${colorType}`);
  const aspect = width / height;
  if (aspect < 2.37 || aspect > 2.41) throw new Error(`First-frame PNG aspect ratio ${aspect.toFixed(4)} is outside the approved 2.39:1 tolerance`);
  return { width, height, bitDepth, colorType };
}

function readProject(slug) {
  const file = path.join(projectDir(slug), "project.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assetVersionIndex(project, slug, requiredFiles = null) {
  const index = new Map();
  for (const asset of project.assets?.items || []) {
    for (const version of asset.versions || []) {
      for (const filename of new Set([version.file, ...(version.files || [])].filter(Boolean))) {
        if (requiredFiles && !requiredFiles.has(filename)) continue;
        const declared = (version.fileHashes || []).find((item) => item.file === filename);
        const disk = path.join(projectDir(slug), "media", "assets", filename);
        if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) continue;
        if (index.has(filename)) throw new Error(`Project contains duplicate asset-version filename: ${filename}`);
        const bytes = fs.statSync(disk).size;
        const sha256 = sha256File(disk);
        if (declared?.bytes != null && Number(declared.bytes) !== bytes) throw new Error(`Source reference byte mismatch: ${filename}`);
        if (declared?.sha256 && String(declared.sha256).toLowerCase() !== sha256) throw new Error(`Source reference hash mismatch: ${filename}`);
        index.set(filename, {
          assetId: asset.id,
          assetVersion: Number(version.v),
          assetVersionId: `${asset.id}:v${Number(version.v)}`,
          sourceAssetFile: filename,
          sha256,
          bytes,
          pinnedActiveAtImport: Number(asset.activeVersion) === Number(version.v)
        });
      }
    }
  }
  return index;
}

function sourceReferencesForClip(clipId, sections, assets) {
  const filenames = sections.get(clipId) || sections.get(clipId.slice(0, 7)) || [];
  if (!filenames.length) throw new Error(`Source-reference manifest has no entries for ${clipId}`);
  return filenames.map((filename) => {
    const resolved = assets.get(filename);
    if (!resolved) throw new Error(`Source-reference manifest does not resolve to an exact project version: ${filename}`);
    return resolved;
  });
}

function referenceRole(filename) {
  if (/^char-/i.test(filename)) return "identity";
  if (/^loc-/i.test(filename)) return "location";
  if (/^(?:art-|prop-)/i.test(filename)) return "prop";
  if (/^(?:fx-|atmo-)/i.test(filename)) return "atmosphere_vfx";
  if (/^extra-(?:guardians|minions)/i.test(filename)) return "creature";
  if (/^extra-/i.test(filename)) return "crowd";
  return "reference";
}

function frameReferences(frameId, sourceReferences) {
  return sourceReferences.map((reference, index) => ({
    id: `ref-${frameId}-${index + 1}`,
    assetId: reference.assetId,
    assetVersion: reference.assetVersion,
    assetVersionId: reference.assetVersionId,
    sourceAssetFile: reference.sourceAssetFile,
    sourceAssetKey: reference.sourceAssetFile.replace(/\.[^.]+$/, ""),
    resolutionStatus: "resolved_exact_version",
    role: referenceRole(reference.sourceAssetFile),
    targetKind: "frame",
    targetId: frameId,
    useMode: "first_frame_source_provenance",
    required: !/^(?:fx-|atmo-)/i.test(reference.sourceAssetFile),
    order: index + 1,
    cropRegion: "Use only the relevant subject or design region; never copy labels, borders, or contact-sheet layout.",
    notes: "Exact project asset version declared by the H01 Reference-Corrected V2 first-frame package. The imported first frame is the runtime I2V guide.",
    pinnedActiveAtImport: reference.pinnedActiveAtImport
  }));
}

function historicalStoryboard(projectSlug) {
  const root = path.join(projectDir(projectSlug), "production", "t2v-prompt-migration");
  if (!fs.existsSync(root)) return null;
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "storyboard.before.json"))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .sort();
  if (!candidates.length) return null;
  const value = JSON.parse(fs.readFileSync(candidates.at(-1), "utf8"));
  validateStoryboard(value, projectSlug, { allowLegacyBindingTargets: true });
  return { storyboard: value, file: candidates.at(-1) };
}

function frameIdFor(clipId, segmentNumber) {
  const slug = clipId.toLowerCase();
  return segmentNumber === 1 ? `frame-${slug}-first` : `frame-segment-${slug}-${String(segmentNumber).padStart(2, "0")}`;
}

function baseNameFor(clipId, segmentNumber) {
  return `${clipId}_${segmentNumber === 1 ? "first" : `seg${String(segmentNumber).padStart(2, "0")}`}`;
}

function nextMediaVersion(mediaDirectory, baseName, existingFrame) {
  let maximum = Math.max(0, ...(existingFrame?.generatedVersions || []).map((item) => Number(item.v) || 0));
  const expression = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.v(\\d+)(?:\\..+)?\\.(?:png|jpe?g|webp)$`, "i");
  for (const filename of fs.readdirSync(mediaDirectory)) {
    const match = filename.match(expression);
    if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
  }
  return maximum + 1;
}

function promptHash(prompt) {
  return sha256Buffer(Buffer.from(String(prompt), "utf8"));
}

function correctedContinuityLocks(clip) {
  if (clip.id !== "H01-S01-C01") return [...(clip.continuityLocks || [])];
  const retained = (clip.continuityLocks || []).filter((lock) => !/unarmed|empty hand|no sword/i.test(lock));
  return [
    "During this descent only, Jesus carries exactly one luminous golden sword in his relaxed right hand; the sword remains continuous through all four segments and never duplicates.",
    ...retained
  ];
}

function globalPromptFor({ clip, visualLock }) {
  const locks = (clip.continuityLocks || []).map((lock) => `- ${lock}`).join("\n");
  return [
    `PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — ${clip.id}`,
    "",
    "GENERATION MODE",
    "Generate each authored segment independently from its supplied first frame. The supplied first frame is authoritative for composition, identity, wardrobe, props, geography, lighting, and physical state. Begin exactly from that image, animate only the selected segment prompt, and do not execute actions from any other segment.",
    "",
    "FORMAT",
    `- Clip duration: ${clip.durationFrames / FPS} seconds across authored segments`,
    `- Master frames: ${clip.durationFrames} at ${FPS} fps`,
    "- Master framing: 2.39:1 cinematic widescreen, normalized to the configured 1152×480 delivery canvas",
    "- Render method: one I2V job per segment; preserve the authored segment boundaries",
    "",
    "GLOBAL VISUAL LOCK",
    visualLock,
    "",
    "CONTINUITY LOCKS",
    locks || "- Preserve the supplied first frame exactly.",
    "",
    "PERFORMANCE AND AUDIO",
    `- ${clip.dialogueAnchor || "No dialogue."}`,
    `- ${clip.audioPlan?.instruction || "Generate only grounded ambience and physical sound appropriate to the selected segment."}`,
    "",
    "SEGMENT EXECUTION",
    "Use only the selected segment's local positive motion prompt. Treat source asset names as provenance only; do not reproduce contact-sheet borders, labels, panel layouts, or unrelated subjects. Preserve a stable final composition for editorial assembly."
  ].join("\n");
}

function activeProjectJobs(slug, clipIds) {
  const matches = [];
  for (const filename of ["generation-jobs.json", "director-generation-jobs.json"]) {
    const file = path.join(projectDir(slug), filename);
    if (!fs.existsSync(file)) continue;
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { continue; }
    for (const job of ledger.jobs || []) {
      const clipId = job.refs?.clipId || job.refs?.binding?.clipId;
      if (clipIds.has(clipId) && ACTIVE_STATUSES.has(job.status)) matches.push(`${filename}:${job.id}:${job.status}`);
    }
  }
  return matches;
}

function nonTargetSnapshot(storyboard) {
  const targetClips = new Set(TARGET_CLIP_IDS);
  const targetPlans = new Set(TARGET_CLIP_IDS.map((clipId) => storyboard.clips?.[clipId]?.videoPlanId).filter(Boolean));
  const targetSegments = new Set([...targetPlans].flatMap((planId) => storyboard.videoPlans?.[planId]?.segmentIds || []));
  return {
    schemaVersion: storyboard.schemaVersion,
    storyboardId: storyboard.storyboardId,
    projectId: storyboard.projectId,
    title: storyboard.title,
    source: storyboard.source,
    defaults: storyboard.defaults,
    workflowProfile: storyboard.workflowProfile,
    runtimeFrames: storyboard.runtimeFrames,
    chapterOrder: storyboard.chapterOrder,
    chapters: storyboard.chapters,
    scenes: storyboard.scenes,
    clips: Object.fromEntries(Object.entries(storyboard.clips || {}).filter(([id]) => !targetClips.has(id))),
    videoPlans: Object.fromEntries(Object.entries(storyboard.videoPlans || {}).filter(([id]) => !targetPlans.has(id))),
    segments: Object.fromEntries(Object.entries(storyboard.segments || {}).filter(([id]) => !targetSegments.has(id))),
    frames: Object.fromEntries(Object.entries(storyboard.frames || {}).filter(([, frame]) => !targetClips.has(frame?.ownerId) && !targetSegments.has(frame?.ownerId))),
    referenceBindings: Object.fromEntries(Object.entries(storyboard.referenceBindings || {}).filter(([, binding]) => {
      if (binding?.targetKind !== "frame") return true;
      const frame = storyboard.frames?.[binding.targetId];
      return !targetClips.has(frame?.ownerId) && !targetSegments.has(frame?.ownerId);
    }))
  };
}

function stableHash(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value), "utf8"));
}

function validateRows(storyboard, rows, prompts) {
  if (rows.length !== 13 || prompts.size !== 13) throw new Error(`Expected 13 bindings and prompts; received ${rows.length} bindings and ${prompts.size} prompts`);
  const counts = new Map();
  const seenKeys = new Set();
  for (const row of rows) {
    const clipId = row.clip_id;
    if (!TARGET_CLIP_IDS.includes(clipId)) throw new Error(`Unexpected H01 clip in package: ${clipId}`);
    const clip = storyboard.clips?.[clipId];
    const plan = clip && storyboard.videoPlans?.[clip.videoPlanId];
    const segmentNumber = Number(row.segment);
    const segmentId = plan?.segmentIds?.[segmentNumber - 1];
    const segment = storyboard.segments?.[segmentId];
    if (!clip || !plan || !segment) throw new Error(`Storyboard mapping is missing for ${clipId} SEG${String(segmentNumber).padStart(2, "0")}`);
    const startFrame = Math.round(Number(row.start_seconds) * FPS);
    const endFrame = Math.round(Number(row.end_seconds) * FPS);
    if (segment.startFrame !== startFrame || segment.lengthFrames !== endFrame - startFrame) {
      throw new Error(`${segment.id} timing differs from package: project ${segment.startFrame}+${segment.lengthFrames}, package ${startFrame}+${endFrame - startFrame}`);
    }
    const key = `${clipId}:SEG${String(segmentNumber).padStart(2, "0")}`;
    if (seenKeys.has(key)) throw new Error(`Package repeats binding ${key}`);
    seenKeys.add(key);
    const prompt = prompts.get(key);
    if (!prompt || prompt.firstFrame !== row.first_frame.replace(/\\/g, "/")) throw new Error(`Prompt/frame declaration mismatch for ${key}`);
    counts.set(clipId, (counts.get(clipId) || 0) + 1);
  }
  for (const clipId of TARGET_CLIP_IDS) {
    const expected = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId].segmentIds.length;
    if (counts.get(clipId) !== expected) throw new Error(`${clipId} package segment count ${counts.get(clipId) || 0} does not match project count ${expected}`);
  }
  const expectedKeys = new Set(TARGET_CLIP_IDS.flatMap((clipId) => {
    const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
    return plan.segmentIds.map((_, index) => `${clipId}:SEG${String(index + 1).padStart(2, "0")}`);
  }));
  if (seenKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !seenKeys.has(key)) || [...prompts.keys()].some((key) => !expectedKeys.has(key))) {
    throw new Error("Package binding/prompt keys do not exactly match the 13 H01 storyboard segments");
  }
}

function verifyPackageExtraction(packageRoot) {
  for (const [relative, expectedHash] of EXPECTED_PACKAGE_FILES) {
    const file = safeSourcePath(packageRoot, relative);
    const actualHash = sha256File(file);
    if (actualHash !== expectedHash) throw new Error(`Extracted package entry hash mismatch: ${relative}`);
  }
}

function verifyImportedState(storyboard, mediaDirectory, receipt) {
  validateStoryboard(storyboard, "harrowing_of_hell");
  const swordlessCorrection = storyboard.imports?.h01_s01_c01_swordless_descent_v1 || null;
  const correctedFrameIds = new Set(swordlessCorrection?.frameIds || []);
  for (const item of receipt.frames) {
    const clip = storyboard.clips[item.clipId];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    const segment = storyboard.segments[item.segmentId];
    const frame = storyboard.frames[item.frameId];
    if (!frame || segment.frameId !== frame.id || segment.type !== "image") throw new Error(`Imported frame is not active for ${item.segmentId}`);
    const wasCorrected = correctedFrameIds.has(item.frameId);
    if (!wasCorrected && segment.prompt !== item.prompt) throw new Error(`Imported prompt differs for ${item.segmentId}`);
    if (!wasCorrected && (frame.activeGeneratedVersion !== item.version || frame.generatedFile !== item.filename)) throw new Error(`Imported frame version differs for ${item.frameId}`);
    if (!wasCorrected && (!Array.isArray(frame.references) || frame.references.length !== item.sourceReferenceCount)) throw new Error(`Imported source-reference provenance differs for ${item.frameId}`);
    const originalVersion = (frame.generatedVersions || []).find((version) => Number(version.v) === Number(item.version) && version.file === item.filename);
    if (!originalVersion) throw new Error(`Original package version history is missing for ${item.frameId}`);
    const disk = path.join(mediaDirectory, item.filename);
    if (!fs.existsSync(disk) || fs.statSync(disk).size !== item.bytes || sha256File(disk) !== item.sha256) throw new Error(`Imported media failed verification: ${item.filename}`);
    if (plan.generationMode !== "i2v_segmented_first_frames") throw new Error(`${plan.id} was not converted to segmented I2V`);
  }
  const descent = storyboard.clips["H01-S01-C01"];
  const descentPlan = storyboard.videoPlans[descent.videoPlanId];
  const descentPrompt = `${descentPlan.globalPrompt}\n${descentPlan.localPrompts}\n${descent.continuityLocks.join("\n")}`;
  if (swordlessCorrection) {
    if (!/Jesus is unarmed/i.test(descentPrompt) || !/both wounded hands stay empty/i.test(descentPrompt)) {
      throw new Error("H01-S01-C01 swordless correction is no longer active");
    }
    if (/carries exactly one luminous golden sword|single golden sword|single right-hand sword|body and sword shape/i.test(descentPrompt)) {
      throw new Error("H01-S01-C01 swordless correction contains a stale positive sword direction");
    }
  } else {
    if (/unarmed|empty hand|no sword/i.test(descentPrompt)) throw new Error("H01-S01-C01 still contains stale no-sword continuity");
    if (!/golden sword/i.test(`${descentPlan.globalPrompt}\n${descentPlan.localPrompts}`)) throw new Error("H01-S01-C01 lost the V2 golden-sword continuity");
  }
  return true;
}

export function importH01I2vReferenceCorrectedV2({
  archivePath,
  sourceRoot,
  projectSlug = "harrowing_of_hell",
  now = new Date(),
  dryRun = false
}) {
  if (projectSlug !== "harrowing_of_hell") throw new Error("This package is scoped only to harrowing_of_hell");
  const archiveHash = sha256File(archivePath);
  if (archiveHash !== EXPECTED_ARCHIVE_SHA256) throw new Error(`Unexpected archive SHA-256: ${archiveHash}`);
  const packageRoot = fs.existsSync(path.join(sourceRoot, "final_h01_i2v_v2")) ? path.join(sourceRoot, "final_h01_i2v_v2") : sourceRoot;
  verifyPackageExtraction(packageRoot);
  const promptFile = safeSourcePath(packageRoot, "H01_I2V_PROMPTS.md");
  const csvFile = safeSourcePath(packageRoot, "H01_FIRST_FRAME_BINDINGS.csv");
  const sourceReferenceFile = safeSourcePath(packageRoot, "H01_SOURCE_REFERENCES.md");
  const rows = parseCsv(fs.readFileSync(csvFile, "utf8"));
  const parsedPrompts = parsePromptPackage(fs.readFileSync(promptFile, "utf8"));
  const sourceSections = parseSourceReferences(fs.readFileSync(sourceReferenceFile, "utf8"));
  const storyboard = loadStoryboard(projectSlug);
  const storyboardFile = storyboardPath(projectSlug);
  const startingStoryboardSha256 = sha256File(storyboardFile);
  const beforeNonTargetHash = stableHash(nonTargetSnapshot(storyboard));
  validateRows(storyboard, rows, parsedPrompts.prompts);

  const alreadyImported = storyboard.imports?.[PACKAGE_ID];
  const mediaDirectory = path.join(projectDir(projectSlug), "media", "storyboard");
  if (alreadyImported?.archiveSha256 === archiveHash) {
    verifyImportedState(storyboard, mediaDirectory, alreadyImported);
    return { idempotent: true, storyboard, receipt: alreadyImported, backup: alreadyImported.backup || null };
  }

  const active = activeProjectJobs(projectSlug, new Set(TARGET_CLIP_IDS));
  if (active.length) throw new Error(`Cannot update H01 while generation is active: ${active.join(", ")}`);
  for (const clipId of TARGET_CLIP_IDS) {
    const clip = storyboard.clips[clipId];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    if (ACTIVE_STATUSES.has(clip.renderStatus) || ACTIVE_STATUSES.has(plan.status) || plan.activeRenderPromptId) {
      throw new Error(`Cannot update active H01 plan: ${clipId}`);
    }
  }

  const project = readProject(projectSlug);
  const requiredAssetFiles = new Set([...sourceSections.values()].flat());
  const assets = assetVersionIndex(project, projectSlug, requiredAssetFiles);
  const historical = historicalStoryboard(projectSlug);
  if (dryRun) {
    const frames = rows.map((row) => {
      const segmentNumber = Number(row.segment);
      const key = `${row.clip_id}:SEG${String(segmentNumber).padStart(2, "0")}`;
      const packagePrompt = parsedPrompts.prompts.get(key);
      const sourceImage = safeSourcePath(packageRoot, packagePrompt.firstFrame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const expectedHash = EXPECTED_PACKAGE_FILES.get(packagePrompt.firstFrame);
      const actualHash = sha256Buffer(buffer);
      if (actualHash !== expectedHash) throw new Error(`Unexpected first-frame hash for ${key}`);
      return {
        clipId: row.clip_id,
        segmentNumber,
        frameId: frameIdFor(row.clip_id, segmentNumber),
        width: dimensions.width,
        height: dimensions.height,
        sha256: actualHash,
        sourceReferenceCount: sourceReferencesForClip(row.clip_id, sourceSections, assets).length
      };
    });
    return {
      dryRun: true,
      idempotent: false,
      storyboard,
      backup: null,
      receipt: { archiveSha256: archiveHash, clipIds: [...TARGET_CLIP_IDS], frames }
    };
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const productionDirectory = path.join(projectDir(projectSlug), "production");
  const backupDirectory = path.join(productionDirectory, "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, `storyboard.before-h01-i2v-v2.${stamp}.json`);
  fs.copyFileSync(path.join(productionDirectory, "storyboard.json"), backup, fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(mediaDirectory, { recursive: true });

  const next = structuredClone(storyboard);
  const createdFiles = [];
  let storyboardSaved = false;
  const receipt = {
    packageId: PACKAGE_ID,
    archiveFile: path.basename(archivePath),
    archiveSha256: archiveHash,
    archiveBytes: fs.statSync(archivePath).size,
    promptsSha256: sha256File(promptFile),
    bindingsSha256: sha256File(csvFile),
    sourceReferencesSha256: sha256File(sourceReferenceFile),
    sourceHistoryFile: historical ? path.relative(projectDir(projectSlug), historical.file).replace(/\\/g, "/") : null,
    importedAt: now.toISOString(),
    backup: path.relative(projectDir(projectSlug), backup).replace(/\\/g, "/"),
    fps: FPS,
    clipIds: [...TARGET_CLIP_IDS],
    frames: []
  };

  try {
    for (const row of rows) {
      const clipId = row.clip_id;
      const clip = next.clips[clipId];
      const plan = next.videoPlans[clip.videoPlanId];
      const segmentNumber = Number(row.segment);
      const segmentId = plan.segmentIds[segmentNumber - 1];
      const segment = next.segments[segmentId];
      const key = `${clipId}:SEG${String(segmentNumber).padStart(2, "0")}`;
      const packagePrompt = parsedPrompts.prompts.get(key);
      const sourceImage = safeSourcePath(packageRoot, packagePrompt.firstFrame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const sha256 = sha256Buffer(buffer);
      const frameId = frameIdFor(clipId, segmentNumber);
      const baseName = baseNameFor(clipId, segmentNumber);
      const version = nextMediaVersion(mediaDirectory, baseName, next.frames[frameId]);
      const filename = `${baseName}.v${version}.h01-i2v-v2.png`;
      const destination = path.join(mediaDirectory, filename);
      fs.writeFileSync(destination, buffer, { flag: "wx" });
      createdFiles.push(destination);
      const sourceReferences = sourceReferencesForClip(clipId, sourceSections, assets);
      const versionRecord = {
        v: version,
        files: [filename],
        file: filename,
        mediaType: "image",
        source: PACKAGE_ID,
        sourceArchive: path.basename(archivePath),
        sourceArchiveSha256: archiveHash,
        sourceEntry: packagePrompt.firstFrame,
        sourceFileName: path.basename(sourceImage),
        prompt: packagePrompt.prompt,
        promptHash: promptHash(packagePrompt.prompt),
        width: dimensions.width,
        height: dimensions.height,
        workflowId: null,
        workflowHash: null,
        provenanceType: "external_package_import_no_embedded_generation_metadata",
        sourceReferenceAssets: sourceReferences,
        fileHashes: [{ file: filename, sha256, bytes: buffer.byteLength, extension: ".png" }],
        createdAt: now.toISOString()
      };
      const existingFrame = next.frames[frameId] || historical?.storyboard?.frames?.[frameId] || null;
      const generatedVersions = [...(existingFrame?.generatedVersions || []), versionRecord];
      const references = frameReferences(frameId, sourceReferences);
      const expectedBase = `${clipId}_${segmentNumber === 1 ? "first" : `seg${String(segmentNumber).padStart(2, "0")}`}.png`;
      next.frames[frameId] = {
        ...(existingFrame || {}),
        id: frameId,
        purpose: segmentNumber === 1 ? "first_frame" : "segment_frame",
        ownerKind: segmentNumber === 1 ? "clip" : "segment",
        ownerId: segmentNumber === 1 ? clipId : segmentId,
        prompt: packagePrompt.prompt,
        negativePrompt: parsedPrompts.negativePrompt,
        status: "generated",
        expectedInputPath: `Premiere316/${projectSlug}/storyboard/${expectedBase}`,
        generatedVersions,
        activeGeneratedVersion: version,
        generatedFile: filename,
        generatedInputPath: `media/storyboard/${filename}`,
        generatedAssetId: frameId,
        generatedAssetVersionId: `${frameId}:v${version}`,
        inputHash: sha256,
        lastError: null,
        references,
        importProvenance: {
          packageId: PACKAGE_ID,
          archiveSha256: archiveHash,
          sourceEntry: packagePrompt.firstFrame,
          sourceReferenceAssets: sourceReferences
        }
      };
      for (const [bindingId, binding] of Object.entries(next.referenceBindings || {})) {
        if (binding?.targetKind === "frame" && binding.targetId === frameId) delete next.referenceBindings[bindingId];
      }
      for (const reference of references) next.referenceBindings[reference.id] = { ...reference };
      segment.prompt = packagePrompt.prompt;
      segment.type = "image";
      segment.frameId = frameId;
      segment.isEndFrame = false;
      segment.status = "ready";
      receipt.frames.push({
        clipId,
        segmentId,
        segmentNumber,
        frameId,
        sourceEntry: packagePrompt.firstFrame,
        filename,
        version,
        width: dimensions.width,
        height: dimensions.height,
        bytes: buffer.byteLength,
        sha256,
        prompt: packagePrompt.prompt,
        promptHash: promptHash(packagePrompt.prompt),
        sourceReferenceCount: sourceReferences.length,
        restoredHistoricalVersions: existingFrame?.generatedVersions?.length || 0
      });
    }

    for (const clipId of TARGET_CLIP_IDS) {
      const clip = next.clips[clipId];
      const plan = next.videoPlans[clip.videoPlanId];
      clip.continuityLocks = correctedContinuityLocks(clip);
      clip.firstFrameId = frameIdFor(clipId, 1);
      clip.generationMode = "i2v_segmented_first_frames";
      clip.referenceMode = "segment_first_frames";
      clip.renderStatus = "not_started";
      delete clip.renderError;
      plan.generationMode = "i2v_segmented_first_frames";
      plan.referenceMode = "segment_first_frames";
      plan.workflowProfileId = "ltx-2.5-i2v-segmented-first-frame";
      plan.globalPrompt = globalPromptFor({ clip, visualLock: parsedPrompts.visualLock });
      plan.negativePrompt = parsedPrompts.negativePrompt;
      plan.localPrompts = plan.segmentIds.map((id) => next.segments[id].prompt).join(" | ");
      plan.segmentLengths = plan.segmentIds.map((id) => String(next.segments[id].lengthFrames)).join(",");
      plan.guideStrength = "1.00";
      plan.status = "needs_render";
      plan.inputHash = null;
      plan.activeGeneratedVersion = null;
      plan.generatedFile = null;
      plan.generatedInputPath = null;
      plan.lastError = null;
      delete plan.activeRenderPromptId;
      delete plan.renderQueuedAt;
      const priorTimeline = plan.timelineData || {};
      plan.timelineData = {
        ...priorTimeline,
        global_prompt: plan.globalPrompt,
        normalStartFrame: 0,
        normalDurationFrames: clip.durationFrames,
        segments: plan.segmentIds.map((segmentId) => {
          const segment = next.segments[segmentId];
          const frame = next.frames[segment.frameId];
          return {
            id: segment.id,
            start: segment.startFrame,
            length: segment.lengthFrames,
            prompt: segment.prompt,
            type: "image",
            imageFile: frame.expectedInputPath,
            fileName: frame.generatedFile,
            guideStrength: 1,
            isEndFrame: false,
            storyboardFrameId: frame.id
          };
        }),
        motionSegments: Array.isArray(priorTimeline.motionSegments) ? priorTimeline.motionSegments : [],
        audioSegments: Array.isArray(priorTimeline.audioSegments) ? priorTimeline.audioSegments : []
      };
      plan.firstFramePackage = {
        packageId: PACKAGE_ID,
        archiveSha256: archiveHash,
        segmentCount: plan.segmentIds.length,
        renderMode: "independent_segment_i2v"
      };
    }

    next.imports = { ...(next.imports || {}), [PACKAGE_ID]: receipt };
    next.updatedAt = now.toISOString();
    validateStoryboard(next, projectSlug);
    if (stableHash(nonTargetSnapshot(next)) !== beforeNonTargetHash) throw new Error("Import changed storyboard records outside the four target H01 clips");
    if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed on disk during the H01 import; no changes were committed");
    saveStoryboard(projectSlug, next);
    storyboardSaved = true;
    const saved = loadStoryboard(projectSlug);
    verifyImportedState(saved, mediaDirectory, receipt);
    if (stableHash(nonTargetSnapshot(saved)) !== beforeNonTargetHash) throw new Error("Saved import changed non-target storyboard records");
    return { idempotent: false, storyboard: saved, receipt, backup: receipt.backup };
  } catch (error) {
    if (storyboardSaved) {
      const temporary = `${storyboardFile}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
      try {
        fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temporary, storyboardFile);
      } catch {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      }
    }
    for (const file of createdFiles) {
      try { fs.unlinkSync(file); } catch {}
    }
    throw error;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archivePath = argument("--archive");
  const sourceRoot = argument("--source");
  if (!archivePath || !sourceRoot) {
    console.error("Usage: node scripts/import-h01-i2v-reference-corrected-v2.mjs --archive <zip> --source <extracted-folder>");
    process.exitCode = 2;
  } else {
    const result = importH01I2vReferenceCorrectedV2({ archivePath, sourceRoot, dryRun: process.argv.includes("--verify-only") });
    console.log(JSON.stringify({
      ok: true,
      dryRun: Boolean(result.dryRun),
      idempotent: result.idempotent,
      backup: result.backup,
      clips: result.receipt.clipIds,
      frames: result.receipt.frames.length,
      archiveSha256: result.receipt.archiveSha256
    }, null, 2));
  }
}
