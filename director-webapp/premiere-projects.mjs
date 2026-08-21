import crypto from "crypto";
import fs from "fs";
import path from "path";
import { findClip, listProjects, loadProject, mediaDir, saveProject, skipApproval } from "../server/projects.js";
import { assetApprovalCurrent } from "../server/assets.js";
import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, storyboardSummary } from "../server/storyboard.js";
import {
  canonicalSemanticReferenceRole,
  generateOptionForMode,
  generateOptionsForContext,
  HARROWING_AAA_I2V_GENERATE_OPTION,
  LTX25_PREMIERE316_PROFILE,
  PREMIERE_GENERATE_OPTIONS,
  semanticT2vLockedForContext,
  SEMANTIC_T2V_GENERATION_MODE
} from "./premiere-api-delegation.mjs";
import { applyContinuationHandoff } from "./segment-continuity.mjs";
import { applyHarrowingGenLock } from "./workflow-compiler.mjs";
import {
  dialogueDirectionsForSegments,
  isH03OrLaterClipId,
  withGlobalDialogueContract
} from "./dialogue-direction.mjs";
import {
  clipMediaCandidates,
  discoverDirectorTakeFiles,
  preferredClipMediaPath
} from "./director-media-paths.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const VIDEO_RE = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const AUDIO_RE = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const EXPLICIT_SEMANTIC_T2V = "t2v_with_semantic_references";

function assertProjectSlug(slug) {
  const value = String(slug || "");
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(value)) throw new Error("Invalid project slug");
  if (!fs.existsSync(path.join(projectDir(value), "project.json"))) throw new Error(`Project not found: ${value}`);
  return value;
}


function namedCharacterInPrompt(value) {
  return /\b(jesus|christ|yeshua|messiah|savior|saviour)\b/i.test(String(value || ""));
}

function generalizeGlobalPrompt(value) {
  const text = String(value || "");
  if (!namedCharacterInPrompt(text)) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => !namedCharacterInPrompt(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function workspaceGlobalPrompt(value, generationMode) {
  return generationMode === "i2v_segmented_first_frames"
    ? String(value || "").trim()
    : generalizeGlobalPrompt(value);
}

function clone(value) {
  return structuredClone(value);
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function safeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function resolveProjectMedia(slug, relativeFile) {
  slug = assertProjectSlug(slug);
  const relative = safeRelative(relativeFile);
  if (!relative.startsWith("media/")) throw new Error("Project media path must be under media/");
  const root = path.resolve(projectDir(slug));
  if (!fs.existsSync(path.join(root, "project.json"))) throw new Error(`Project not found: ${slug}`);
  const mediaRoot = path.resolve(root, "media");
  const resolved = path.resolve(root, relative);
  const rootPrefix = `${mediaRoot}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(rootPrefix)) throw new Error("Project media path escaped the media root");
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`Project media not found: ${relative}`);
  const realRoot = fs.realpathSync.native(mediaRoot).toLowerCase();
  const realResolved = fs.realpathSync.native(resolved).toLowerCase();
  if (!realResolved.startsWith(`${realRoot}${path.sep}`.toLowerCase())) throw new Error("Project media path escaped through a filesystem link");
  return resolved;
}

function isStrictlyWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveProjectReferenceMedia(slug, referenceFile) {
  slug = assertProjectSlug(slug);
  const storyboard = readStoryboardMaybe(slug);
  if (!storyboard) throw new Error(`Project storyboard not found: ${slug}`);
  const declaredRoot = String(storyboard.defaults?.referenceRoot || "reference_assets").trim().replace(/\\/g, "/");
  if (!declaredRoot || declaredRoot.startsWith("/") || /^[a-zA-Z]:\//.test(declaredRoot)) {
    throw new Error("Project reference root must be project-relative");
  }
  const normalizedRoot = path.posix.normalize(declaredRoot).replace(/^\.\//, "").replace(/\/$/, "");
  if (normalizedRoot === ".." || normalizedRoot.startsWith("../")) {
    throw new Error("Project reference root escaped the project folder");
  }

  let supplied = String(referenceFile || "").trim().replace(/\\/g, "/");
  if (!supplied || supplied.includes("\0") || supplied.startsWith("/") || /^[a-zA-Z]:\//.test(supplied)) {
    throw new Error("Project reference path must be relative");
  }
  if (supplied.startsWith(`${normalizedRoot}/`)) supplied = supplied.slice(normalizedRoot.length + 1);
  const canonical = path.posix.normalize(supplied).replace(/^\.\//, "");
  if (!canonical || canonical === "." || canonical === ".." || canonical.startsWith("../")) {
    throw new Error("Project reference path escaped the reference root");
  }

  const projectRoot = path.resolve(projectDir(slug));
  const referenceRoot = path.resolve(projectRoot, ...normalizedRoot.split("/"));
  if (!isStrictlyWithin(projectRoot, referenceRoot)) throw new Error("Project reference root escaped the project folder");
  if (!fs.existsSync(referenceRoot) || !fs.statSync(referenceRoot).isDirectory()) {
    throw new Error(`Project reference root not found: ${normalizedRoot}`);
  }
  const resolved = path.resolve(referenceRoot, ...canonical.split("/"));
  if (!isStrictlyWithin(referenceRoot, resolved)) throw new Error("Project reference path escaped the reference root");
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Project reference not found: ${canonical}`);
  }

  const realProjectRoot = fs.realpathSync.native(projectRoot);
  const realReferenceRoot = fs.realpathSync.native(referenceRoot);
  const realResolved = fs.realpathSync.native(resolved);
  if (!isStrictlyWithin(realProjectRoot, realReferenceRoot)) {
    throw new Error("Project reference root escaped through a filesystem link");
  }
  if (!isStrictlyWithin(realReferenceRoot, realResolved)) {
    throw new Error("Project reference path escaped through a filesystem link");
  }
  return realResolved;
}

function versionFiles(version) {
  const values = [version?.file, ...(Array.isArray(version?.files) ? version.files : [])].filter(Boolean);
  return [...new Set(values.map(String))];
}

function activeVersion(asset) {
  const versions = Array.isArray(asset?.versions) ? asset.versions : [];
  const selected = Number(asset?.activeVersion);
  if (!Number.isFinite(selected) || selected <= 0) return null;
  return versions.find((version) => Number(version.v) === selected) || null;
}

function projectMediaExists(slug, relative) {
  try { return Boolean(resolveProjectMedia(slug, relative)); } catch { return false; }
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const fileHashCache = new Map();

function cachedFileSha256(file, stat = fs.statSync(file)) {
  const key = `${fs.realpathSync.native(file)}|${stat.size}|${stat.mtimeMs}`;
  if (!fileHashCache.has(key)) fileHashCache.set(key, fileSha256(file));
  return fileHashCache.get(key);
}

function resolvedFrameMedia(slug, frame) {
  const versions = Array.isArray(frame?.generatedVersions) ? frame.generatedVersions : [];
  const active = versions.find((version) => Number(version.v) === Number(frame?.activeGeneratedVersion));
  if (!active) return null;
  const sourceFile = active.file || versionFiles(active)[0];
  if (!sourceFile) return null;
  const relative = safeRelative(sourceFile).startsWith("media/") ? safeRelative(sourceFile) : `media/storyboard/${safeRelative(sourceFile)}`;
  let disk;
  try { disk = resolveProjectMedia(slug, relative); } catch { return null; }
  const stat = fs.statSync(disk);
  const expectedHash = (active.fileHashes || []).find((item) => path.basename(item.file || "") === path.basename(sourceFile)) || active.fileHashes?.[0];
  if (expectedHash?.bytes && Number(expectedHash.bytes) !== stat.size) return null;
  if (expectedHash?.sha256 && String(expectedHash.sha256).toLowerCase() !== cachedFileSha256(disk, stat).toLowerCase()) return null;
  return {
    relative,
    disk,
    version: active,
    bytes: stat.size,
    sha256: expectedHash?.sha256 || cachedFileSha256(disk, stat)
  };
}

function approvedMedia(project) {
  const results = [];
  const allowAll = skipApproval(project);
  for (const asset of project.assets?.items || []) {
    const approvalCurrent = assetApprovalCurrent(project, asset);
    const approvedVersionNumber = approvalCurrent || allowAll
      ? Number(asset.activeVersion)
      : asset?.approval?.status === "approved"
        ? Number(asset.approval.activeVersion)
        : 0;
    if (!approvedVersionNumber) continue;
    const version = (asset.versions || []).find((item) => Number(item.v) === approvedVersionNumber);
    if (!version) continue;
    for (const file of versionFiles(version)) {
      const relative = safeRelative(file).startsWith("media/") ? safeRelative(file) : `media/assets/${safeRelative(file)}`;
      if (!projectMediaExists(project.slug, relative)) continue;
      results.push({
        id: `${asset.id}:v${version?.v || asset.activeVersion || 1}:${path.basename(file)}`,
        assetId: asset.id,
        name: asset.name || asset.id,
        category: asset.categoryLabel || asset.category || "Asset",
        mediaType: asset.mediaType || (VIDEO_RE.test(file) ? "video" : AUDIO_RE.test(file) ? "audio" : "image"),
        version: Number(version?.v || asset.activeVersion || 1),
        file: relative,
        prompt: String(asset.prompt || ""),
        approved: true,
        current: Boolean(approvalCurrent && Number(version.v) === Number(asset.activeVersion))
      });
    }
  }
  for (const frame of project.frames || []) {
    const sourceAsset = (project.assets?.items || []).find((asset) => asset.id === frame.assetId);
    const promotedApprovalCurrent = Boolean(
      frame.source === "asset-foundry-approved"
      && sourceAsset
      && assetApprovalCurrent(project, sourceAsset)
      && Number(frame.assetVersion) === Number(sourceAsset.activeVersion)
      && String(frame.assetApprovalFingerprint || "") === String(sourceAsset.approval?.versionFingerprint || "")
    );
    const approved = allowAll || promotedApprovalCurrent || frame.approval?.status === "approved";
    if (!approved || !frame.file) continue;
    const relative = safeRelative(frame.file).startsWith("media/") ? safeRelative(frame.file) : `media/frames/${safeRelative(frame.file)}`;
    if (!projectMediaExists(project.slug, relative)) continue;
    results.push({
      id: `frame:${frame.id || path.basename(frame.file)}`,
      assetId: frame.id || null,
      name: frame.name || path.basename(frame.file),
      category: "Project frame",
      mediaType: "image",
      version: Number(frame.activeVersion || 1),
      file: relative,
      prompt: String(frame.prompt || ""),
      approved: true,
      current: true
    });
  }
  return results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function projectLibraryMedia(project) {
  const results = [];
  for (const asset of project.assets?.items || []) {
    const version = activeVersion(asset);
    for (const file of versionFiles(version)) {
      const relative = safeRelative(file).startsWith("media/") ? safeRelative(file) : `media/assets/${safeRelative(file)}`;
      if (!projectMediaExists(project.slug, relative)) continue;
      results.push({
        id: `library:${asset.id}:v${version?.v || asset.activeVersion || 1}:${path.basename(file)}`,
        assetId: asset.id,
        name: asset.name || asset.id,
        category: asset.categoryLabel || asset.category || "Asset",
        mediaType: asset.mediaType || mediaKind(relative),
        version: Number(version?.v || asset.activeVersion || 1),
        file: relative,
        prompt: String(asset.prompt || ""),
        approved: asset.approval?.status === "approved",
        current: asset.activeVersionCurrent !== false,
        status: asset.status || "unknown"
      });
    }
  }
  return results.sort((a, b) => Number(b.approved) - Number(a.approved) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function readStoryboardMaybe(slug) {
  return fs.existsSync(storyboardPath(slug)) ? loadStoryboard(slug) : null;
}

function normalizeSemanticReferenceFile(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function planSemanticReferenceMetadata(storyboard, clip, plan) {
  const generationMode = plan?.generationMode || clip?.generationMode || storyboard?.defaults?.generationMode || null;
  const referenceFiles = Array.isArray(plan?.referenceFiles)
    ? plan.referenceFiles.map(normalizeSemanticReferenceFile).filter(Boolean)
    : Array.isArray(clip?.referenceFiles)
      ? clip.referenceFiles.map(normalizeSemanticReferenceFile).filter(Boolean)
      : [];
  const bindings = Object.values(storyboard?.referenceBindings || {})
    .filter((binding) => binding?.targetKind === "video_plan" && binding.targetId === plan?.id);
  const bindingFiles = bindings
    .map((binding) => normalizeSemanticReferenceFile(binding.canonicalFile || binding.sourceAssetFile))
    .filter(Boolean);
  const expectedCount = Number(plan?.referenceCount ?? clip?.referenceCount ?? referenceFiles.length);
  const dropped = Array.isArray(plan?.droppedReferenceFiles) ? plan.droppedReferenceFiles : [];
  const expected = [...referenceFiles].sort();
  const actual = [...bindingFiles].sort();
  const bindingsMatch = expected.length === actual.length && expected.every((file, index) => file === actual[index]);
  return {
    generationMode,
    referenceMode: plan?.referenceMode || clip?.referenceMode || "semantic_reference_resolver",
    referenceRoot: String(plan?.referenceRoot || storyboard?.defaults?.referenceRoot || "reference_assets").replace(/\\/g, "/"),
    referenceFiles,
    referenceCount: referenceFiles.length,
    declarationsReady: Number.isInteger(expectedCount)
      && expectedCount >= 0
      && expectedCount === referenceFiles.length
      && bindings.length === referenceFiles.length
      && bindingsMatch
      && dropped.length === 0
  };
}

function semanticT2vMetadata(storyboard, clip, plan) {
  const metadata = planSemanticReferenceMetadata(storyboard, clip, plan);
  return metadata.generationMode === EXPLICIT_SEMANTIC_T2V ? metadata : null;
}

function canonicalReferenceIndex(slug) {
  const indexFile = resolveProjectReferenceMedia(slug, "asset_index.json");
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch (error) {
    throw new Error(`Storyboard canonical reference index is invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(index.assets)) throw new Error("Storyboard canonical reference index has no assets array");
  const assets = new Map();
  for (const asset of index.assets) {
    const canonical = normalizeSemanticReferenceFile(asset?.canonical);
    if (!canonical) throw new Error("Storyboard canonical reference index contains an empty filename");
    if (assets.has(canonical)) throw new Error(`Storyboard canonical reference index repeats ${canonical}`);
    assets.set(canonical, asset);
  }
  return {
    assets,
    maxReferences: Math.max(0, Number(index.maxReferences) || LTX25_PREMIERE316_PROFILE.maxSemanticReferences),
    sha256: fileSha256(indexFile)
  };
}


function resolveUserManagedAssetBinding(project, binding, { frameId = null, targetKind, targetId, indexPosition = 0 } = {}) {
  const asset = (project.assets?.items || []).find((item) => item.id === binding.assetId);
  const versionNumber = Number(binding.assetVersion || String(binding.assetVersionId || "").split(":v").at(-1) || 0);
  const version = (asset?.versions || []).find((item) => Number(item.v) === versionNumber);
  if (!asset || !version) throw new Error(`User-managed reference ${binding.id || binding.assetId || indexPosition + 1} has no pinned Asset Foundry version`);
  const exactVersionFiles = versionFiles(version);
  const sourceFile = binding.sourceAssetFile || version?.file || exactVersionFiles[0];
  if (!sourceFile) throw new Error(`User-managed reference ${binding.id || asset.id} has no image file`);
  if (binding.sourceAssetFile && !exactVersionFiles.some((file) => path.basename(file).toLowerCase() === path.basename(sourceFile).toLowerCase())) {
    throw new Error(`User-managed reference ${binding.id || asset.id} is not part of its pinned Asset Foundry version`);
  }
  const relative = safeRelative(sourceFile).startsWith("media/") ? safeRelative(sourceFile) : `media/assets/${safeRelative(sourceFile)}`;
  const disk = resolveProjectMedia(project.slug, relative);
  const stat = fs.statSync(disk);
  const expectedFile = (version.fileHashes || []).find((item) => path.basename(item.file || "").toLowerCase() === path.basename(sourceFile).toLowerCase()) || version.fileHashes?.[0];
  const sha256 = cachedFileSha256(disk, stat);
  if (expectedFile?.bytes && Number(expectedFile.bytes) !== stat.size) throw new Error(`User-managed reference ${binding.id || asset.id} has changed size`);
  if (expectedFile?.sha256 && String(expectedFile.sha256).toLowerCase() !== sha256.toLowerCase()) throw new Error(`User-managed reference ${binding.id || asset.id} has changed content`);
  const declaredRole = String(binding.role || "reference");
  const role = canonicalSemanticReferenceRole(declaredRole);
  if (!role) throw new Error(`User-managed reference ${binding.id || asset.id} has unsupported role ${declaredRole}`);
  return {
    id: binding.id || `user-reference:${targetId}:${indexPosition + 1}`,
    assetId: asset.id,
    frameId,
    targetKind,
    targetId,
    name: asset.name || binding.sourceAssetKey || path.basename(sourceFile),
    category: asset.categoryLabel || asset.category || declaredRole,
    role,
    declaredRole,
    required: binding.required !== false,
    useMode: binding.useMode || (targetKind === "video_plan" ? "semantic_reference" : "direct_conditioning"),
    order: Number(binding.order) || indexPosition + 1,
    version: versionNumber || Number(version.v) || 1,
    assetVersion: versionNumber || Number(version.v) || 1,
    current: Number(asset.activeVersion) === (versionNumber || Number(version.v)),
    approved: asset.approval?.status === "approved" && Number(asset.approval?.activeVersion || asset.activeVersion) === (versionNumber || Number(version.v)),
    verified: true,
    mediaType: asset.mediaType || mediaKind(relative),
    file: relative,
    projectMediaPath: relative,
    canonicalFile: binding.canonicalFile || sourceFile,
    sha256,
    bytes: stat.size,
    notes: binding.notes || "",
    cropRegion: binding.cropRegion || "",
    persistenceOrigin: "user"
  };
}

function resolvePlanSemanticReferences(project, storyboard, clip, plan) {
  const metadata = planSemanticReferenceMetadata(storyboard, clip, plan);
  const expectedReferenceCount = Number(plan?.referenceCount ?? clip?.referenceCount ?? metadata.referenceFiles.length);
  if (!Number.isInteger(expectedReferenceCount) || expectedReferenceCount < 0) {
    throw new Error(`Storyboard video plan ${plan.id} has invalid semantic referenceCount ${String(plan?.referenceCount ?? clip?.referenceCount)}`);
  }
  if (!metadata.declarationsReady) {
    throw new Error(
      `Storyboard video plan ${plan.id} semantic declarations disagree: `
      + `${metadata.referenceFiles.length} files, ${expectedReferenceCount} expected, or its video_plan bindings do not match`
    );
  }
  if (metadata.referenceFiles.length > LTX25_PREMIERE316_PROFILE.maxSemanticReferences) {
    throw new Error(
      `Storyboard video plan ${plan.id} declares ${metadata.referenceFiles.length} semantic references; `
      + `${LTX25_PREMIERE316_PROFILE.id} supports ${LTX25_PREMIERE316_PROFILE.maxSemanticReferences}`
    );
  }
  if (!metadata.referenceFiles.length) {
    return {
      ...metadata,
      expectedReferenceCount,
      resolvedReferenceCount: 0,
      maxReferences: LTX25_PREMIERE316_PROFILE.maxSemanticReferences,
      referenceIndexHash: null,
      references: []
    };
  }

  const bindings = Object.values(storyboard?.referenceBindings || {})
    .filter((binding) => binding?.targetKind === "video_plan" && binding.targetId === plan.id);
  const userManaged = bindings.length === metadata.referenceFiles.length
    && bindings.every((binding) => binding?.persistenceOrigin === "user");
  if (userManaged) {
    const references = bindings
      .slice()
      .sort((left, right) => (Number(left?.order) || 0) - (Number(right?.order) || 0) || String(left?.id || "").localeCompare(String(right?.id || "")))
      .map((binding, indexPosition) => resolveUserManagedAssetBinding(project, binding, {
        targetKind: "video_plan",
        targetId: plan.id,
        indexPosition
      }));
    return {
      ...metadata,
      expectedReferenceCount,
      resolvedReferenceCount: references.length,
      maxReferences: LTX25_PREMIERE316_PROFILE.maxSemanticReferences,
      referenceIndexHash: null,
      references
    };
  }

  const index = canonicalReferenceIndex(project.slug);
  const maxReferences = Math.min(index.maxReferences, LTX25_PREMIERE316_PROFILE.maxSemanticReferences);
  if (metadata.referenceFiles.length > maxReferences) {
    throw new Error(`Storyboard video plan ${plan.id} exceeds the canonical ${maxReferences}-reference limit`);
  }
  const bindingByFile = new Map(bindings.map((binding) => [
    normalizeSemanticReferenceFile(binding.canonicalFile || binding.sourceAssetFile),
    binding
  ]));
  const references = metadata.referenceFiles.map((canonical, indexPosition) => {
    const indexed = index.assets.get(canonical);
    if (!indexed) throw new Error(`Storyboard video plan ${plan.id} requests unindexed semantic reference ${canonical}`);
    const binding = bindingByFile.get(canonical);
    if (!binding) throw new Error(`Storyboard video plan ${plan.id} has no video_plan binding for ${canonical}`);
    const declaredRole = String(binding.role || indexed.role || "");
    const role = canonicalSemanticReferenceRole(declaredRole);
    if (!role) throw new Error(`Storyboard semantic reference ${canonical} has unsupported role ${declaredRole || "missing"}`);
    const disk = resolveProjectReferenceMedia(project.slug, canonical);
    const stat = fs.statSync(disk);
    const sha256 = cachedFileSha256(disk, stat);
    if (indexed.sha256 && String(indexed.sha256).toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`Storyboard canonical reference hash mismatch: ${canonical}`);
    }
    if (Number.isFinite(Number(indexed.bytes)) && Number(indexed.bytes) !== stat.size) {
      throw new Error(`Storyboard canonical reference byte count mismatch: ${canonical}`);
    }
    return {
      id: binding.id || `semantic-reference:${plan.id}:${indexPosition + 1}`,
      assetId: binding.assetId || null,
      frameId: null,
      targetKind: "video_plan",
      targetId: plan.id,
      name: binding.assetId || path.basename(canonical),
      category: declaredRole || role,
      role,
      declaredRole,
      required: binding.required !== false,
      useMode: binding.useMode || "semantic_reference",
      order: Number(binding.order) || indexPosition + 1,
      version: null,
      current: true,
      approved: true,
      verified: true,
      mediaType: "image",
      file: path.posix.join(metadata.referenceRoot, canonical),
      previewUrl: `/api/premiere/references/${encodeURIComponent(project.slug)}?file=${encodeURIComponent(canonical)}`,
      canonicalFile: canonical,
      referenceRoot: metadata.referenceRoot,
      sha256,
      bytes: stat.size,
      notes: binding.notes || "",
      cropRegion: binding.cropRegion || "",
      resolverToken: binding.resolverToken || ""
    };
  });
  return {
    ...metadata,
    expectedReferenceCount,
    resolvedReferenceCount: references.length,
    maxReferences,
    referenceIndexHash: index.sha256,
    references
  };
}

function orderedStoryboardClips(storyboard) {
  if (!storyboard) return [];
  const results = [];
  for (const chapterId of storyboard.chapterOrder || []) {
    const chapter = storyboard.chapters?.[chapterId];
    if (!chapter) continue;
    for (const sceneId of chapter.sceneIds || []) {
      const scene = storyboard.scenes?.[sceneId];
      if (!scene) continue;
      for (const clipId of scene.clipIds || []) {
        const clip = storyboard.clips?.[clipId];
        if (!clip) continue;
        const plan = storyboard.videoPlans?.[clip.videoPlanId];
        const segments = (plan?.segmentIds || []).map((id) => storyboard.segments?.[id]).filter(Boolean);
        const frameIds = [clip.firstFrameId, ...segments.map((segment) => segment.frameId)].filter(Boolean);
        const uniqueFrameIds = [...new Set(frameIds)];
        const frames = uniqueFrameIds.map((id) => storyboard.frames?.[id]).filter(Boolean);
        const generatedFrames = frames.filter((frame) => resolvedFrameMedia(storyboard.projectId, frame));
        const semantic = semanticT2vMetadata(storyboard, clip, plan);
        results.push({
          id: clip.id,
          sceneId,
          videoPlanId: clip.videoPlanId,
          chapter: chapter.title,
          chapterNumber: chapter.number,
          scene: scene.title,
          sceneNumber: scene.number,
          order: clip.order,
          beat: clip.beat,
          durationFrames: clip.durationFrames,
          durationSeconds: clip.durationFrames / Math.max(1, Number(storyboard.defaults?.fps) || 24),
          renderStatus: clip.renderStatus || "not_started",
          renderVersions: Array.isArray(plan?.generatedVersions) ? plan.generatedVersions.length : 0,
          frameCount: frames.length,
          generatedFrameCount: generatedFrames.length,
          generationMode: semantic?.generationMode || plan?.generationMode || clip.generationMode || null,
          referenceMode: semantic?.referenceMode || plan?.referenceMode || clip.referenceMode || null,
          referenceCount: semantic?.referenceCount ?? Number(plan?.referenceCount || clip.referenceCount || 0),
          planFingerprint: storyboardPlanFingerprintValue(storyboard, clip.id),
          ready: semantic
            ? semantic.declarationsReady
            : uniqueFrameIds.length > 0 && frames.length === uniqueFrameIds.length && generatedFrames.length === uniqueFrameIds.length
        });
      }
    }
  }
  return results;
}

function scanGeneratedVideos(project, storyboard) {
  const metadata = new Map();
  for (const clip of project.sequence?.clips || []) {
    for (const version of clip.versions || []) {
      if (!version.file) continue;
      metadata.set(takeMediaPath(version.file, { slug: project.slug, clipId: clip.id }), { clipId: clip.id, clipName: clip.name, source: version.source || "clip", version: version.v });
    }
    for (const version of clip.rangeVersions || []) {
      if (!version.file) continue;
      metadata.set(takeMediaPath(version.file, { slug: project.slug, clipId: clip.id }), { clipId: clip.id, clipName: clip.name, source: "range", version: version.v });
    }
  }
  for (const plan of Object.values(storyboard?.videoPlans || {})) {
    for (const version of plan.generatedVersions || []) {
      const file = safeRelative(version.file || version.outputPath);
      if (!file) continue;
      const relative = file.startsWith("media/") ? file : `media/storyboard/${file}`;
      const clip = storyboard.clips?.[plan.clipId];
      metadata.set(relative, { clipId: plan.clipId, clipName: clip?.beat || plan.clipId, source: version.source || "director", version: version.v });
    }
  }
  const found = [];
  for (const [relative, details] of metadata.entries()) {
    if (!VIDEO_RE.test(relative)) continue;
    let disk;
    try { disk = resolveProjectMedia(project.slug, relative); } catch { continue; }
    const stat = fs.statSync(disk);
    found.push({ id: relative, file: relative, name: path.basename(relative), bytes: stat.size, updatedAt: stat.mtime.toISOString(), ...details });
  }
  return found
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readJobFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value.jobs) ? value.jobs : [];
  } catch {
    return [];
  }
}

function directorJobFile(slug) {
  return path.join(projectDir(slug), "director-generation-jobs.json");
}

function readProjectJobs(slug) {
  const combined = [
    ...readJobFile(path.join(projectDir(slug), "generation-jobs.json")),
    ...readJobFile(directorJobFile(slug))
  ];
  const byId = new Map(combined.map((job) => [job.id, job]));
  return [...byId.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 250);
}

export function projectJobs(slug) {
  return readProjectJobs(assertProjectSlug(slug));
}

export function upsertProjectJob(slug, job) {
  slug = assertProjectSlug(slug);
  loadProject(slug);
  const file = directorJobFile(slug);
  let ledger = { updatedAt: null, jobs: [] };
  if (fs.existsSync(file)) {
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  ledger.jobs = Array.isArray(ledger.jobs) ? ledger.jobs : [];
  const index = ledger.jobs.findIndex((candidate) => candidate.id === job.id);
  const serializable = clone(job);
  if (index >= 0) ledger.jobs[index] = { ...ledger.jobs[index], ...serializable };
  else ledger.jobs.push(serializable);
  ledger.jobs = ledger.jobs.slice(-250);
  ledger.updatedAt = new Date().toISOString();
  atomicJson(file, ledger);
  return serializable;
}

export function projectCatalog() {
  return listProjects().map((entry) => {
    const storyboard = readStoryboardMaybe(entry.slug);
    return {
      ...entry,
      hasStoryboard: Boolean(storyboard),
      storyboardClipCount: storyboard ? Object.keys(storyboard.clips || {}).length : 0,
      storyboardFrameCount: storyboard ? Object.keys(storyboard.frames || {}).length : 0
    };
  });
}

export function projectOverview(slug) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  const scenes = orderedStoryboardClips(storyboard);
  return {
    project: {
      slug: project.slug,
      name: project.name,
      category: project.category || "feature",
      updatedAt: project.updatedAt,
      settings: clone(project.settings || {}),
      sequenceClipCount: project.sequence?.clips?.length || 0
    },
    storyboard: storyboard ? {
      title: storyboard.title,
      updatedAt: storyboard.updatedAt,
      summary: storyboardSummary(storyboard),
      defaults: clone(storyboard.defaults || {}),
      clips: scenes,
      generatedFrames: Object.values(storyboard.frames || {})
        .map((frame) => ({ frame, resolved: resolvedFrameMedia(slug, frame) }))
        .filter((item) => item.resolved)
        .map(({ frame, resolved }) => ({ id: frame.id, ownerId: frame.ownerId, purpose: frame.purpose, status: frame.status, file: resolved.relative, prompt: frame.prompt, activeGeneratedVersion: frame.activeGeneratedVersion }))
    } : null,
    approvedMedia: approvedMedia(project),
    projectLibrary: projectLibraryMedia(project),
    generatedVideos: scanGeneratedVideos(project, storyboard),
    jobs: readProjectJobs(slug)
  };
}

export function sceneReferenceMedia(slug, clipId) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  const clip = storyboard?.clips?.[clipId];
  const plan = clip ? storyboard.videoPlans?.[clip.videoPlanId] : null;
  if (!clip || !plan) throw new Error(`Storyboard clip not found: ${clipId}`);
  const semantic = planSemanticReferenceMetadata(storyboard, clip, plan);
  let semanticState;
  try {
    semanticState = resolvePlanSemanticReferences(project, storyboard, clip, plan);
  } catch (error) {
    semanticState = {
      ...semantic,
      expectedReferenceCount: Number(plan.referenceCount ?? clip.referenceCount ?? semantic.referenceFiles.length) || 0,
      resolvedReferenceCount: 0,
      maxReferences: LTX25_PREMIERE316_PROFILE.maxSemanticReferences,
      referenceIndexHash: null,
      references: [],
      error: String(error.message || error)
    };
  }
  if (semantic.generationMode === EXPLICIT_SEMANTIC_T2V) {
    const invalidReferences = semanticState.error ? [{
      id: `semantic-reference-error:${plan.id}`,
      assetId: null,
      targetKind: "video_plan",
      targetId: plan.id,
      role: "semantic_reference",
      required: true,
      reason: semanticState.error
    }] : [];
    return {
      projectSlug: slug,
      clipId,
      videoPlanId: plan.id,
      storyboardUpdatedAt: storyboard.updatedAt,
      planFingerprint: storyboardPlanFingerprintValue(storyboard, clip.id),
      frameIds: [],
      generationMode: semantic.generationMode,
      referenceMode: semantic.referenceMode,
      referenceRoot: semantic.referenceRoot,
      referenceFiles: semantic.referenceFiles,
      referenceCount: semanticState.references.length,
      expectedReferenceCount: semanticState.expectedReferenceCount,
      resolvedReferenceCount: semanticState.references.length,
      maxReferences: semanticState.maxReferences,
      referenceIndexHash: semanticState.referenceIndexHash,
      references: semanticState.references,
      semanticReferences: semanticState.references,
      semanticReferenceRoles: semanticState.references.map((reference) => reference.role),
      semanticReferencesReady: !semanticState.error
        && semanticState.references.length === semanticState.expectedReferenceCount,
      invalidReferences,
      referencesReady: invalidReferences.length === 0
        && semanticState.references.length === semanticState.expectedReferenceCount
    };
  }
  const frameIds = [...new Set([clip.firstFrameId, ...(plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId)].filter(Boolean))];
  const assets = new Map((project.assets?.items || []).map((asset) => [asset.id, asset]));
  const references = [];
  const invalidReferences = [];
  const seen = new Set();
  for (const frameId of frameIds) {
    const frame = storyboard.frames?.[frameId];
    const bindings = Array.isArray(frame?.references)
      ? frame.references
      : Object.values(storyboard.referenceBindings || {}).filter((reference) => reference.targetId === frameId);
    for (const reference of bindings) {
      if (!reference?.id || seen.has(reference.id)) continue;
      seen.add(reference.id);
      const asset = assets.get(reference.assetId);
      const versionNumber = Number(reference.assetVersion || String(reference.assetVersionId || "").split(":v").at(-1) || 0);
      const version = (asset?.versions || []).find((item) => Number(item.v) === versionNumber);
      const invalidBase = { id: reference.id, assetId: reference.assetId, frameId, role: reference.role || "reference", required: Boolean(reference.required), version: versionNumber || null };
      if (!asset || !version) {
        invalidReferences.push({ ...invalidBase, reason: !asset ? "asset_missing" : "pinned_version_missing" });
        continue;
      }
      const exactVersionFiles = versionFiles(version);
      const sourceFile = reference.sourceAssetFile || version?.file || versionFiles(version)[0];
      if (!sourceFile) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_missing" });
        continue;
      }
      if (reference.sourceAssetFile && !exactVersionFiles.some((file) => path.basename(file).toLowerCase() === path.basename(sourceFile).toLowerCase())) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_not_in_version", file: reference.sourceAssetFile });
        continue;
      }
      const relative = safeRelative(sourceFile).startsWith("media/") ? safeRelative(sourceFile) : `media/assets/${safeRelative(sourceFile)}`;
      let disk;
      try { disk = resolveProjectMedia(slug, relative); }
      catch { invalidReferences.push({ ...invalidBase, reason: "pinned_file_unavailable", file: relative }); continue; }
      const stat = fs.statSync(disk);
      const expectedFile = (version.fileHashes || []).find((item) => path.basename(item.file || "").toLowerCase() === path.basename(sourceFile).toLowerCase()) || version.fileHashes?.[0];
      if (expectedFile?.bytes && Number(expectedFile.bytes) !== stat.size) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_size_mismatch", file: relative });
        continue;
      }
      if (expectedFile?.sha256 && String(expectedFile.sha256).toLowerCase() !== cachedFileSha256(disk, stat).toLowerCase()) {
        invalidReferences.push({ ...invalidBase, reason: "pinned_file_hash_mismatch", file: relative });
        continue;
      }
      references.push({
        id: reference.id,
        assetId: reference.assetId,
        frameId,
        name: asset?.name || reference.sourceAssetKey || path.basename(sourceFile),
        category: asset?.categoryLabel || asset?.category || reference.role || "Reference",
        role: reference.role || "reference",
        canonicalRole: canonicalSemanticReferenceRole(reference.role),
        required: Boolean(reference.required),
        useMode: reference.useMode || "reference",
        order: Number(reference.order) || 0,
        version: versionNumber || Number(version?.v) || 1,
        current: Number(asset?.activeVersion) === (versionNumber || Number(version?.v)),
        approved: asset?.approval?.status === "approved" && Number(asset.approval?.activeVersion || asset.activeVersion) === (versionNumber || Number(version?.v)),
        mediaType: asset?.mediaType || mediaKind(relative),
        file: relative,
        notes: reference.notes || "",
        cropRegion: reference.cropRegion || "",
        persistenceOrigin: reference.persistenceOrigin || null
      });
    }
  }
  references.sort((a, b) => a.frameId.localeCompare(b.frameId) || a.order - b.order || a.name.localeCompare(b.name));
  if (semanticState.error) {
    invalidReferences.push({
      id: `semantic-reference-error:${plan.id}`,
      assetId: null,
      frameId: null,
      targetKind: "video_plan",
      targetId: plan.id,
      role: "semantic_reference",
      required: semantic.generationMode !== LTX25_PREMIERE316_PROFILE.generationMode,
      reason: semanticState.error
    });
  }
  const semanticReferencesReady = !semanticState.error
    && semanticState.references.length === semanticState.expectedReferenceCount;
  const requiredInvalid = invalidReferences.filter((reference) => {
    if (reference.required !== true) return false;
    if (semantic.generationMode === LTX25_PREMIERE316_PROFILE.generationMode
      && reference.role === "semantic_reference") {
      return false;
    }
    return true;
  });
  return {
    projectSlug: slug,
    clipId,
    videoPlanId: plan.id,
    storyboardUpdatedAt: storyboard.updatedAt,
    planFingerprint: storyboardPlanFingerprintValue(storyboard, clip.id),
    frameIds,
    generationMode: semantic.generationMode,
    referenceMode: semantic.referenceMode,
    referenceRoot: semantic.referenceRoot,
    referenceFiles: semantic.referenceFiles,
    referenceCount: references.length,
    expectedReferenceCount: references.length,
    resolvedReferenceCount: references.length,
    maxReferences: semanticState.maxReferences,
    referenceIndexHash: semanticState.referenceIndexHash,
    references,
    semanticReferences: semanticState.references,
    semanticReferenceRoles: semanticState.references.map((reference) => reference.role),
    semanticReferencesReady,
    invalidReferences,
    referencesReady: requiredInvalid.length === 0
  };
}

export function workspaceWithRefreshedReferenceBinding(currentWorkspace, referenceState) {
  const binding = currentWorkspace?.premiere;
  if (binding?.source !== "storyboard" || !binding?.projectSlug || !binding?.clipId) {
    throw new Error("Load a Premiere storyboard scene before refreshing its references");
  }
  if (String(binding.projectSlug) !== String(referenceState?.projectSlug)
    || String(binding.clipId) !== String(referenceState?.clipId)) {
    throw new Error("Reference refresh target does not match the currently bound Premiere storyboard scene");
  }

  const next = clone(currentWorkspace);
  const segmentedI2v = referenceState.generationMode === "i2v_segmented_first_frames";
  const semanticReferences = clone(segmentedI2v
    ? (referenceState.references || [])
    : (referenceState.semanticReferences || []));
  const invalidReferences = Array.isArray(referenceState.invalidReferences)
    ? referenceState.invalidReferences
    : [];
  const referenceFiles = segmentedI2v
    ? semanticReferences.map((reference) => reference.file).filter(Boolean)
    : clone(referenceState.referenceFiles || []);
  const referenceCount = segmentedI2v
    ? semanticReferences.length
    : Number(referenceState.referenceCount ?? semanticReferences.length);
  const expectedReferenceCount = segmentedI2v
    ? semanticReferences.length
    : Number(referenceState.expectedReferenceCount ?? referenceCount);
  const semanticReferencesReady = segmentedI2v
    ? Boolean(referenceState.referencesReady)
    : Boolean(referenceState.semanticReferencesReady);

  next.premiere = {
    ...next.premiere,
    generationMode: referenceState.generationMode || next.premiere.generationMode,
    referenceMode: referenceState.referenceMode ?? null,
    referenceRoot: referenceState.referenceRoot ?? null,
    referenceFiles,
    referenceCount,
    expectedReferenceCount,
    semanticReferences,
    semanticReferenceRoles: semanticReferences.map((reference) => reference.role),
    semanticReferencesReady,
    semanticReferenceError: invalidReferences.length
      ? invalidReferences.map((reference) => reference.reason || reference.id).filter(Boolean).join("; ") || "Reference validation failed"
      : null,
    referenceIndexHash: referenceState.referenceIndexHash ?? null,
    storyboardUpdatedAt: referenceState.storyboardUpdatedAt,
    planFingerprint: referenceState.planFingerprint
  };
  return next;
}

function storyboardWorkspace(baseWorkspace, project, storyboard, clipId) {
  const clip = storyboard.clips?.[clipId];
  if (!clip) throw new Error(`Storyboard clip not found: ${clipId}`);
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) throw new Error(`Storyboard video plan not found: ${clip.videoPlanId}`);
  const semantic = semanticT2vMetadata(storyboard, clip, plan);
  const planSemantic = planSemanticReferenceMetadata(storyboard, clip, plan);
  const generationMode = plan.generationMode || clip.generationMode || storyboard.defaults?.generationMode || null;
  const explicitFrameReferenceState = generationMode === "i2v_segmented_first_frames"
    ? sceneReferenceMedia(project.slug, clipId)
    : null;
  let resolvedPlanSemantic = null;
  let planSemanticError = null;
  if (generationMode === LTX25_PREMIERE316_PROFILE.generationMode) {
    try { resolvedPlanSemantic = resolvePlanSemanticReferences(project, storyboard, clip, plan); }
    catch (error) { planSemanticError = String(error.message || error); }
  }
  const fps = Math.max(1, Number(storyboard.defaults?.fps) || Number(project.settings?.fps) || 24);
  const timeline = clone(plan.timelineData || {});
  const segmentDialogueDirections = isH03OrLaterClipId(clip.id)
    ? dialogueDirectionsForSegments(clip.dialogueAnchor, plan.segmentIds || [])
    : new Map();
  const storedGlobalPrompt = plan.globalPrompt || timeline.global_prompt || "";
  timeline.global_prompt = isH03OrLaterClipId(clip.id)
    ? withGlobalDialogueContract(storedGlobalPrompt)
    : workspaceGlobalPrompt(storedGlobalPrompt, generationMode);
  timeline.segments = (plan.segmentIds || []).map((segmentId) => {
    const planned = storyboard.segments?.[segmentId];
    if (!planned) return null;
    const current = (timeline.segments || []).find((segment) => segment.id === segmentId) || {};
    const frame = planned.frameId ? storyboard.frames?.[planned.frameId] : null;
    const generated = resolvedFrameMedia(project.slug, frame);
    const segment = {
      ...current,
      id: planned.id,
      start: Number(planned.startFrame) || 0,
      length: Math.max(1, Number(planned.lengthFrames) || 1),
      prompt: String(planned.prompt || current.prompt || ""),
      global_prompt: String(planned.global_prompt || current.global_prompt || ""),
      type: String(planned.type || current.type || (planned.frameId ? "image" : "text")),
      isEndFrame: Boolean(planned.isEndFrame),
      storyboardFrameId: planned.frameId || null,
      missingGuide: Boolean(planned.frameId && !generated)
    };
    if (planned.mythicDialoguePass) segment.mythicDialoguePass = clone(planned.mythicDialoguePass);
    else delete segment.mythicDialoguePass;
    if (planned.correctedPass) segment.correctedPass = clone(planned.correctedPass);
    else delete segment.correctedPass;
    const dialogueDirection = segmentDialogueDirections.get(planned.id);
    if (dialogueDirection) segment.dialogueDirection = dialogueDirection;
    else delete segment.dialogueDirection;
    if (generated) {
      segment.projectMediaPath = generated.relative;
      segment.projectMediaBytes = generated.bytes;
      segment.projectMediaSha256 = generated.sha256;
      segment.fileName = path.basename(generated.relative);
      segment.imageFile = current.imageFile || frame.expectedInputPath || null;
      segment.guideStrength = Number(current.guideStrength ?? plan.guideStrength ?? 1);
    } else {
      delete segment.imageFile;
      delete segment.imageB64;
    }
    const takes = ensureActiveTake(planned, { slug: project.slug, clipId });
    const activeTake = activeTakeFromList(takes, planned.activeTakeId, planned.activeGeneratedVersion);
    segment.generatedTakes = takes;
    segment.activeTakeId = planned.activeTakeId || activeTake?.id || null;
    segment.activeGeneratedVersion = planned.activeGeneratedVersion || activeTake?.v || null;
    segment.activeTakeLocked = Boolean(planned.activeTakeLocked);
    if (activeTake?.file) {
      segment.activeTakeFile = takeMediaPath(activeTake.file, { slug: project.slug, clipId });
    }
    segment.useNextAsLastFrame = false;
    return segment;
  }).filter(Boolean);
  timeline.motionSegments = Array.isArray(timeline.motionSegments) ? timeline.motionSegments : [];
  timeline.audioSegments = Array.isArray(timeline.audioSegments) ? timeline.audioSegments : [];
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = Number(clip.durationFrames) || timeline.segments.reduce((max, segment) => Math.max(max, segment.start + segment.length), 1);
  const selected = timeline.segments.find((segment) => segment.type === "image") || timeline.segments[0] || null;
  const next = clone(baseWorkspace);
  next.timeline = timeline;
  next.selectedSegmentId = selected?.id || null;
  next.playheadFrame = Number(selected?.start) || 0;
  next.settings.frameRate = fps;
  next.settings.customWidth = Math.max(32, Number(storyboard.defaults?.workingWidth) || Number(project.settings?.width) || next.settings.customWidth);
  next.settings.customHeight = Math.max(32, Number(storyboard.defaults?.workingHeight) || Number(project.settings?.height) || next.settings.customHeight);
  next.settings.queueMode = generationMode === "i2v_segmented_first_frames" ? "segments" : "timeline";
  if (generationMode === LTX25_PREMIERE316_PROFILE.generationMode) {
    next.settings.generationProfile = LTX25_PREMIERE316_PROFILE.id;
    next.settings.lengthModel = LTX25_PREMIERE316_PROFILE.lengthModel;
  }
  next.settings.outputPrefix = `Premiere316/${project.slug}/director/${clip.id}`;
  next.stats = {
    durationFrames: timeline.normalDurationFrames,
    durationSeconds: timeline.normalDurationFrames / fps
  };
  const firstNegative = (plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId).filter(Boolean).map((id) => storyboard.frames?.[id]?.negativePrompt).find(Boolean);
  if (firstNegative) next.settings.negativePrompt = firstNegative;
  next.premiere = {
    projectSlug: project.slug,
    projectName: project.name,
    source: "storyboard",
    clipId: clip.id,
    sceneId: clip.sceneId,
    videoPlanId: clip.videoPlanId,
    generationMode,
    generateOptionId: generateOptionForMode(generationMode, plan.generateOptionId || clip.generateOptionId || storyboard.defaults?.generateOptionId, { projectSlug: project.slug, generationMode }).id,
    generateOption: generateOptionForMode(generationMode, plan.generateOptionId || clip.generateOptionId || storyboard.defaults?.generateOptionId, { projectSlug: project.slug, generationMode }),
    generateOptions: generateOptionsForContext({ projectSlug: project.slug, generationMode }),
    ...(explicitFrameReferenceState ? {
      referenceMode: "explicit_user_segment_references",
      referenceFiles: explicitFrameReferenceState.references.map((reference) => reference.file),
      referenceCount: explicitFrameReferenceState.references.length,
      expectedReferenceCount: explicitFrameReferenceState.references.length,
      semanticReferences: explicitFrameReferenceState.references,
      semanticReferenceRoles: explicitFrameReferenceState.references.map((reference) => reference.role),
      semanticReferencesReady: explicitFrameReferenceState.referencesReady,
      semanticReferenceError: explicitFrameReferenceState.invalidReferences?.length
        ? explicitFrameReferenceState.invalidReferences.map((reference) => reference.reason || reference.id).join("; ")
        : null
    } : {}),
    ...(generationMode === LTX25_PREMIERE316_PROFILE.generationMode ? {
      workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
      lengthModel: LTX25_PREMIERE316_PROFILE.lengthModel,
      semanticConditioning: LTX25_PREMIERE316_PROFILE.semanticConditioning,
      referenceMode: planSemantic.referenceMode,
      referenceRoot: planSemantic.referenceRoot,
      referenceFiles: planSemantic.referenceFiles,
      referenceCount: planSemantic.referenceCount,
      expectedReferenceCount: planSemantic.referenceCount,
      semanticReferences: resolvedPlanSemantic?.references || [],
      semanticReferenceRoles: (resolvedPlanSemantic?.references || []).map((reference) => reference.role),
      semanticReferencesReady: Boolean(resolvedPlanSemantic)
        && resolvedPlanSemantic.references.length === resolvedPlanSemantic.expectedReferenceCount,
      semanticReferenceError: planSemanticError
    } : {}),
    storyboardUpdatedAt: storyboard.updatedAt,
    planFingerprint: storyboardPlanFingerprintValue(storyboard, clip.id),
    ...(semantic ? {
      generationMode: semantic.generationMode,
      referenceMode: semantic.referenceMode,
      referenceRoot: semantic.referenceRoot,
      referenceFiles: semantic.referenceFiles,
      referenceCount: semantic.referenceCount,
      expectedReferenceCount: semantic.referenceCount
    } : {}),
    loadedAt: new Date().toISOString()
  };
  applyHarrowingGenLock(next);
  return next;
}

function sequenceWorkspace(baseWorkspace, project, clipId) {
  const clip = findClip(project, clipId);
  if (!clip) throw new Error(`Project sequence clip not found: ${clipId}`);
  const fps = Math.max(1, Number(project.settings?.fps) || 24);
  const total = Math.max(1, Math.round(Number(clip.durationSec || 1) * fps));
  const guides = [...(clip.guides || [])].sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0));
  const mediaSegments = guides.map((guide, index) => {
    const start = Math.max(0, Number(guide.frame) || 0);
    const nextStart = index + 1 < guides.length ? Math.max(start + 1, Number(guides[index + 1].frame) || total) : total;
    const relative = safeRelative(guide.file).startsWith("media/") ? safeRelative(guide.file) : `media/frames/${safeRelative(guide.file)}`;
    const exists = projectMediaExists(project.slug, relative);
    return {
      id: guide.id,
      start,
      length: Math.max(1, nextStart - start),
      prompt: String(guide.prompt || ""),
      type: exists ? "image" : "text",
      projectMediaPath: exists ? relative : undefined,
      fileName: path.basename(guide.file || "Guide"),
      guideStrength: Number(guide.strength ?? 1),
      missingGuide: !exists
    };
  });
  const promptSegments = (clip.segments || []).map((segment) => ({
    id: segment.id,
    start: Number(segment.startFrame) || 0,
    length: Math.max(1, Number(segment.endFrame) - Number(segment.startFrame)),
    prompt: String(segment.prompt || ""),
    type: "text"
  }));
  const next = clone(baseWorkspace);
  next.timeline = {
    ...next.timeline,
    global_prompt: String(clip.globalPrompt || ""),
    segments: [...mediaSegments, ...promptSegments].sort((a, b) => a.start - b.start),
    motionSegments: [],
    audioSegments: [],
    normalStartFrame: 0,
    normalDurationFrames: total
  };
  next.selectedSegmentId = mediaSegments[0]?.id || promptSegments[0]?.id || null;
  next.playheadFrame = 0;
  next.settings.frameRate = fps;
  next.settings.customWidth = Number(project.settings?.width) || next.settings.customWidth;
  next.settings.customHeight = Number(project.settings?.height) || next.settings.customHeight;
  next.settings.outputPrefix = `Premiere316/${project.slug}/director/${clip.id}`;
  next.stats = { durationFrames: total, durationSeconds: total / fps };
  next.premiere = { projectSlug: project.slug, projectName: project.name, source: "sequence", clipId: clip.id, loadedAt: new Date().toISOString() };
  return next;
}

export function workspaceForProjectClip(baseWorkspace, slug, clipId) {
  slug = assertProjectSlug(slug);
  const project = loadProject(slug);
  const storyboard = readStoryboardMaybe(slug);
  if (storyboard?.clips?.[clipId]) return storyboardWorkspace(baseWorkspace, project, storyboard, clipId);
  return sequenceWorkspace(baseWorkspace, project, clipId);
}

export function boundStoryboardWorkspaceIsStale(workspace) {
  const binding = workspace?.premiere;
  if (!binding || binding.source !== "storyboard" || !binding.projectSlug || !binding.clipId) return false;
  try {
    return storyboardPlanFingerprint(binding.projectSlug, binding.clipId) !== binding.planFingerprint;
  } catch {
    return false;
  }
}

export function refreshBoundWorkspaceFromStoryboard(workspace) {
  const binding = workspace?.premiere;
  if (!binding || binding.source !== "storyboard" || !binding.projectSlug || !binding.clipId) {
    return { workspace, refreshed: false };
  }
  if (!boundStoryboardWorkspaceIsStale(workspace)) {
    return { workspace, refreshed: false };
  }
  return {
    workspace: workspaceForProjectClip(workspace, binding.projectSlug, binding.clipId),
    refreshed: true
  };
}


export function chapterKeyFromClipId(clipId) {
  const match = String(clipId || "").toUpperCase().match(/^(H\d+|MV\d+)/);
  return match ? match[1] : "";
}

export function clipMatchesGlobalScope(clip, boundClip, scope) {
  if (!clip || !boundClip) return false;
  if (scope === "project") return true;
  if (scope === "clip") return String(clip.id) === String(boundClip.id);
  if (scope === "scene") return Boolean(boundClip.sceneId) && String(clip.sceneId || "") === String(boundClip.sceneId);
  if (scope === "chapter") {
    const a = chapterKeyFromClipId(clip.id);
    const b = chapterKeyFromClipId(boundClip.id);
    return Boolean(a && b && a === b);
  }
  return String(clip.id) === String(boundClip.id);
}

export function applyGlobalPromptToScope(slug, clipId, text, scope = "clip") {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  const bound = storyboard.clips?.[clipId];
  if (!bound) throw new Error(`Unknown clip ${clipId}`);
  const normalized = String(text || "");
  const scopeKey = ["clip", "scene", "chapter", "project"].includes(String(scope)) ? String(scope) : "clip";
  let clips = 0;
  let plans = 0;
  let segments = 0;
  for (const clip of Object.values(storyboard.clips || {})) {
    if (!clipMatchesGlobalScope(clip, bound, scopeKey)) continue;
    clips += 1;
    const plan = storyboard.videoPlans?.[clip.videoPlanId];
    if (!plan) continue;
    plan.globalPrompt = normalized;
    plan.global_prompt = normalized;
    if (plan.timelineData && typeof plan.timelineData === "object") {
      plan.timelineData.global_prompt = normalized;
    }
    plans += 1;
    for (const segmentId of plan.segmentIds || []) {
      const segment = storyboard.segments?.[segmentId];
      if (!segment) continue;
      segment.global_prompt = normalized;
      segment.globalPrompt = normalized;
      segments += 1;
    }
  }
  if (scopeKey === "project") {
    storyboard.defaults = storyboard.defaults || {};
    storyboard.defaults.globalPrompt = normalized;
    storyboard.defaults.global_prompt = normalized;
  }
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return {
    projectSlug: slug,
    clipId,
    scope: scopeKey,
    textChars: normalized.length,
    clips,
    plans,
    segments,
    updatedAt: storyboard.updatedAt
  };
}

export function syncWorkspaceToPremiere(workspace) {
  const binding = workspace?.premiere;
  if (!binding?.projectSlug || !binding?.clipId) throw new Error("Load a Premiere project scene before saving to Premiere");
  if (binding.source === "storyboard") {
    assertProjectSlug(binding.projectSlug);
    const storyboard = loadStoryboard(binding.projectSlug);
    if (binding.planFingerprint && storyboardPlanFingerprintValue(storyboard, binding.clipId) !== binding.planFingerprint) {
      const error = new Error("This storyboard changed in Premiere after it was loaded. Reload the scene before publishing Director edits.");
      error.code = "STALE_STORYBOARD";
      throw error;
    }
    const clip = storyboard.clips?.[binding.clipId];
    const plan = clip ? storyboard.videoPlans?.[clip.videoPlanId] : null;
    if (!clip || !plan) throw new Error("The bound Premiere storyboard scene no longer exists");
    const previousPlanFingerprint = storyboardPlanFingerprintValue(storyboard, clip.id);
    const owned = new Set(plan.segmentIds || []);
    const timelineById = new Map((workspace.timeline?.segments || []).map((segment) => [segment.id, segment]));
    for (const segmentId of owned) {
      const target = storyboard.segments?.[segmentId];
      const incoming = timelineById.get(segmentId);
      if (!target || !incoming) continue;
      target.prompt = String(incoming.prompt || "");
      target.startFrame = Math.max(0, Math.round(Number(incoming.start) || 0));
      target.lengthFrames = Math.max(1, Math.round(Number(incoming.length) || 1));
    }
    const ordered = Array.from(owned).map((id) => storyboard.segments?.[id]).filter(Boolean).sort((a, b) => a.startFrame - b.startFrame);
    let cursor = 0;
    for (const segment of ordered) {
      if (segment.startFrame !== cursor) throw new Error(`Storyboard timing must remain contiguous: ${segment.id} starts at ${segment.startFrame}, expected ${cursor}`);
      cursor += segment.lengthFrames;
    }
    if (cursor !== Number(clip.durationFrames)) throw new Error(`Storyboard duration is locked to ${clip.durationFrames} frames; Director segments currently total ${cursor}. Keep the scene duration unchanged.`);
    plan.globalPrompt = String(workspace.timeline?.global_prompt || "");
    plan.guideStrength = String(workspace.settings?.guideStrength || plan.guideStrength || "1.00");
    plan.resizeMethod = String(workspace.settings?.resizeMethod || plan.resizeMethod || "maintain aspect ratio");
    plan.localPrompts = (plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.prompt || "").join(" | ");
    plan.segmentLengths = (plan.segmentIds || []).map((id) => Math.max(1, Number(storyboard.segments?.[id]?.lengthFrames) || 1)).join(",");
    plan.timelineData = clone(workspace.timeline);
    plan.timelineData.segments = (plan.timelineData.segments || []).filter((segment) => owned.has(segment.id));
    for (const segment of plan.timelineData.segments || []) {
      delete segment.projectMediaPath;
      delete segment.projectMediaBytes;
      delete segment.projectMediaSha256;
      delete segment.missingGuide;
      delete segment.storyboardFrameId;
    }
    const nextPlanFingerprint = storyboardPlanFingerprintValue(storyboard, clip.id);
    if (nextPlanFingerprint !== previousPlanFingerprint) {
      clip.renderStatus = "not_started";
      clip.renderError = null;
      plan.status = "needs_render";
      plan.activeGeneratedVersion = null;
      plan.generatedFile = null;
      plan.generatedInputPath = null;
      plan.lastError = null;
      plan.renderStaleAt = new Date().toISOString();
    }
    plan.inputHash = nextPlanFingerprint;
    storyboard.updatedAt = new Date().toISOString();
    saveStoryboard(binding.projectSlug, storyboard);
    return { projectSlug: binding.projectSlug, clipId: clip.id, videoPlanId: plan.id, updatedAt: storyboard.updatedAt, changed: nextPlanFingerprint !== previousPlanFingerprint, planFingerprint: nextPlanFingerprint };
  }
  assertProjectSlug(binding.projectSlug);
  const project = loadProject(binding.projectSlug);
  const clip = findClip(project, binding.clipId);
  if (!clip) throw new Error("The bound Premiere sequence clip no longer exists");
  clip.globalPrompt = String(workspace.timeline?.global_prompt || "");
  const incoming = new Map((workspace.timeline?.segments || []).map((segment) => [segment.id, segment]));
  for (const segment of clip.segments || []) {
    const value = incoming.get(segment.id);
    if (!value) continue;
    segment.prompt = String(value.prompt || "");
    segment.startFrame = Math.max(0, Math.round(Number(value.start) || 0));
    segment.endFrame = segment.startFrame + Math.max(1, Math.round(Number(value.length) || 1));
  }
  saveProject(project);
  return { projectSlug: binding.projectSlug, clipId: clip.id, updatedAt: project.updatedAt };
}

export function markDirectorRender(slug, binding, update) {
  if (binding?.source !== "storyboard") return null;
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[binding.clipId];
  if (!clip) return null;
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) return null;
  if (update.expectedFingerprint && storyboardPlanFingerprintValue(storyboard, clip.id) !== update.expectedFingerprint) {
    const error = new Error("The Premiere scene changed before render registration");
    error.code = "STALE_RENDER";
    throw error;
  }
  const promptDoesNotOwnAttempt = update.promptId && plan.activeRenderPromptId !== update.promptId;
  if (update.status === "done" && update.version && promptDoesNotOwnAttempt) {
    const error = new Error("A newer Director render owns this Premiere scene; this completed output was not registered");
    error.code = "STALE_RENDER";
    throw error;
  }
  if (["error", "stale"].includes(update.status) && promptDoesNotOwnAttempt) return clip;
  if (update.status === "queued") {
    plan.activeRenderPromptId = update.promptId || null;
    plan.status = "queued";
  }
  if (update.status === "stale") {
    clip.renderStatus = "not_started";
    plan.status = "needs_render";
    plan.activeRenderPromptId = null;
  } else {
    if (!(update.status === "partial" && plan.activeRenderPromptId)) {
      clip.renderStatus = update.status === "done" ? "completed" : update.status === "error" ? "failed" : update.status;
    }
    if (update.status === "error") plan.activeRenderPromptId = null;
  }
  if (update.error !== undefined) {
    clip.renderError = update.error;
    plan.lastError = update.error;
  }
  if (update.version) {
    clip.renderError = null;
    plan.generatedVersions = Array.isArray(plan.generatedVersions) ? plan.generatedVersions : [];
    const duplicate = plan.generatedVersions.find((version) => String(version.comfyPromptId || version.promptId || "") === String(update.version.comfyPromptId || update.version.promptId || ""));
    const committedVersion = duplicate || update.version;
    if (!duplicate) {
      if (plan.generatedVersions.some((version) => Number(version.v) === Number(update.version.v))) throw new Error(`Storyboard render version v${update.version.v} already exists`);
      plan.generatedVersions.push(update.version);
    }
    if (update.status === "done") {
      plan.activeGeneratedVersion = committedVersion.v;
      plan.generatedFile = path.basename(committedVersion.file);
      plan.generatedInputPath = committedVersion.file;
      plan.status = "rendered";
    }
    const committedTake = recordSegmentTake(storyboard, committedVersion, update.status, clip.id);
    if (update.continuityHandoff && committedTake) {
      update.continuityHandoff.commitResult = applyContinuationHandoff(storyboard, {
        clipId: clip.id,
        sourceSegmentId: committedVersion.segmentId,
        sourcePromptId: committedVersion.comfyPromptId || committedVersion.promptId,
        sourceTakeId: committedTake.id,
        handoff: update.continuityHandoff
      });
    }
    if (update.status === "done" && (!update.promptId || plan.activeRenderPromptId === update.promptId)) {
      plan.activeRenderPromptId = null;
    }
    plan.lastError = null;
    plan.generationCompletedAt = committedVersion.createdAt;
  }
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return clip;
}

export function nextStoryboardRenderVersion(slug, clipId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[clipId];
  const versions = storyboard.videoPlans?.[clip?.videoPlanId]?.generatedVersions || [];
  return Math.max(0, ...versions.map((version) => Number(version.v) || 0)) + 1;
}

async function streamedFileSha256(file) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function registeredRenderResult(slug, record, relativeFile, versionNumber, clipId = "") {
  const candidates = clipMediaCandidates(relativeFile, clipId);
  let lastError = new Error("registered file path is missing or unsafe");
  for (const relative of candidates) {
    try {
      const disk = resolveProjectMedia(slug, relative);
    const stat = fs.statSync(disk);
    if (!stat.isFile() || !stat.size) throw new Error("registered file is empty");
    const expected = (record?.fileHashes || []).find((item) =>
      path.basename(String(item.file || "")).toLowerCase() === path.basename(disk).toLowerCase()
    ) || record?.fileHashes?.[0] || null;
    if (expected?.bytes && Number(expected.bytes) !== stat.size) {
      throw new Error(`registered file has ${stat.size} bytes; expected ${expected.bytes}`);
    }
    const sha256 = await streamedFileSha256(disk);
    if (expected?.sha256 && String(expected.sha256).toLowerCase() !== sha256.toLowerCase()) {
      throw new Error("registered file checksum does not match its Premiere provenance record");
    }
      return { version: versionNumber, file: relative, disk, bytes: stat.size, sha256, valid: true, record };
    } catch (error) {
      lastError = error;
    }
  }
  return { version: versionNumber, file: candidates[0] || "", disk: null, valid: false, error: String(lastError.message || lastError), record };
}

export async function findDirectorRenderByPrompt(slug, binding, promptId) {
  slug = assertProjectSlug(slug);
  const expected = String(promptId || "");
  if (!expected || !binding?.clipId) return null;
  if (binding.source === "storyboard") {
    const storyboard = loadStoryboard(slug);
    const clip = storyboard.clips?.[binding.clipId];
    const plan = storyboard.videoPlans?.[clip?.videoPlanId];
    const version = (plan?.generatedVersions || []).find((item) => String(item.comfyPromptId || item.promptId || "") === expected);
    return version
      ? await registeredRenderResult(slug, version, version.file || version.generatedInputPath || version.outputFile, Number(version.v) || 1, binding.clipId)
      : null;
  }
  const project = loadProject(slug);
  const clip = findClip(project, binding.clipId);
  const version = (clip?.versions || []).find((item) => String(item.promptId || item.comfyPromptId || "") === expected);
  return version
    ? await registeredRenderResult(slug, version, version.file || version.outputFile || "", Number(version.v) || 1, binding.clipId)
    : null;
}

export function storyboardPlanFingerprintValue(storyboard, clipId) {
  const clip = storyboard.clips?.[clipId];
  const plan = storyboard.videoPlans?.[clip?.videoPlanId];
  if (!clip || !plan) throw new Error(`Storyboard clip not found: ${clipId}`);
  const frameIds = [...new Set([
    clip.firstFrameId,
    ...(plan.segmentIds || []).map((id) => storyboard.segments?.[id]?.frameId)
  ].filter(Boolean))];
  const payload = {
    referencePolicy: storyboard.defaults?.visualReferencePersistence || null,
    clip: {
      id: clip.id,
      durationFrames: clip.durationFrames,
      firstFrameId: clip.firstFrameId,
      videoPlanId: clip.videoPlanId,
      referenceFiles: clip.referenceFiles || [],
      referenceCount: Number(clip.referenceCount) || 0
    },
    plan: {
      id: plan.id,
      globalPrompt: plan.globalPrompt,
      guideStrength: plan.guideStrength,
      resizeMethod: plan.resizeMethod,
      segmentIds: plan.segmentIds,
      localPrompts: plan.localPrompts,
      segmentLengths: plan.segmentLengths,
      timelineData: plan.timelineData,
      referenceFiles: plan.referenceFiles || [],
      referenceCount: Number(plan.referenceCount) || 0
    },
    segments: (plan.segmentIds || []).map((id) => storyboard.segments?.[id]),
    frames: frameIds.map((id) => {
      const frame = storyboard.frames?.[id];
      const active = frame ? (frame.generatedVersions || []).find((version) => Number(version.v) === Number(frame.activeGeneratedVersion)) : null;
      return frame ? {
        id,
        activeGeneratedVersion: frame.activeGeneratedVersion,
        generatedFile: frame.generatedFile,
        inputHash: frame.inputHash,
        generationFingerprint: frame.generationFingerprint,
        activeFileHashes: active?.fileHashes || [],
        references: frame.references || []
      } : null;
    }),
    referenceBindings: Object.values(storyboard.referenceBindings || {})
      .filter((binding) => binding?.targetId === plan.id || frameIds.includes(binding?.targetId) || (plan.segmentIds || []).includes(binding?.targetId))
      .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function storyboardPlanFingerprint(slug, clipId) {
  slug = assertProjectSlug(slug);
  return storyboardPlanFingerprintValue(loadStoryboard(slug), clipId);
}

export function mediaKind(relative) {
  if (IMAGE_RE.test(relative)) return "image";
  if (VIDEO_RE.test(relative)) return "video";
  if (AUDIO_RE.test(relative)) return "audio";
  return "file";
}

function takeMediaPath(file, context = {}) {
  return preferredClipMediaPath(file, context.clipId, context.slug ? projectDir(context.slug) : "");
}

function discoverDiskSegmentTakes(slug, clipId, segmentId) {
  if (!slug || !clipId || !segmentId) return [];
  const clipsDir = path.join(projectDir(slug), "media", "clips");
  if (!fs.existsSync(clipsDir)) return [];
  return discoverDirectorTakeFiles(clipsDir, clipId, segmentId)
    .map(({ name, file }) => {
      const match = name.match(/_director_v(\d+)\./i);
      const token = match?.[1] || "";
      const number = Number(token) || 0;
      return {
        id: token ? `take-v${token}` : `take-${path.basename(name, path.extname(name))}`,
        v: number || null,
        file,
        previewFile: file,
        source: "disk"
      };
    })
    .sort((left, right) => (Number(left.v) || 0) - (Number(right.v) || 0) || String(left.id).localeCompare(String(right.id)));
}

function normalizeSegmentTakes(segment, context = {}) {
  const versions = Array.isArray(segment?.generatedVersions) ? segment.generatedVersions.filter(Boolean) : [];
  const takes = versions.map((version, index) => {
    const number = Number(version.v) || index + 1;
    return {
      ...version,
      id: version.id || `take-v${number}`,
      v: number,
      file: version.file || version.generatedInputPath || version.outputFile || null,
      previewFile: takeMediaPath(version.file || version.generatedInputPath || version.outputFile || "", context)
    };
  });
  const knownFiles = new Set(takes.map((take) => path.basename(String(take.previewFile || take.file || "")).toLowerCase()).filter(Boolean));
  const knownIds = new Set(takes.map((take) => String(take.id)));
  for (const disk of discoverDiskSegmentTakes(context.slug, context.clipId, segment?.id || context.segmentId)) {
    const base = path.basename(disk.file).toLowerCase();
    if (knownFiles.has(base)) continue;
    let id = disk.id;
    if (knownIds.has(id)) id = `take-file-${path.basename(disk.file, path.extname(disk.file))}`;
    takes.push({ ...disk, id });
    knownFiles.add(base);
    knownIds.add(id);
  }
  return takes.sort((left, right) => (Number(left.v) || 0) - (Number(right.v) || 0) || String(left.id).localeCompare(String(right.id)));
}

function ensureActiveTake(segment, context = {}) {
  const takes = normalizeSegmentTakes(segment, context);
  if (!takes.length) return takes;
  if (takes.length === 1) {
    segment.activeTakeId = takes[0].id;
    segment.activeGeneratedVersion = takes[0].v;
    return takes;
  }
  if (!segment.activeTakeId && !segment.activeGeneratedVersion) {
    const last = takes[takes.length - 1];
    segment.activeTakeId = last.id;
    segment.activeGeneratedVersion = last.v;
  }
  return takes;
}

function activeTakeFromList(takes, activeTakeId = null, activeVersion = null) {
  if (!takes.length) return null;
  return takes.find((take) => String(take.id) === String(activeTakeId))
    || takes.find((take) => Number(take.v) === Number(activeVersion))
    || takes[takes.length - 1];
}

function recordSegmentTake(storyboard, version, status, clipId = "") {
  const segmentId = String(version?.segmentId || "");
  const segment = storyboard?.segments?.[segmentId];
  if (!segment || !version) return null;
  segment.generatedVersions = Array.isArray(segment.generatedVersions) ? segment.generatedVersions : [];
  const promptKey = String(version.comfyPromptId || version.promptId || "");
  const duplicate = segment.generatedVersions.find((item) => String(item.comfyPromptId || item.promptId || "") === promptKey && promptKey);
  const nextV = duplicate
    ? Number(duplicate.v)
    : Math.max(0, ...segment.generatedVersions.map((item) => Number(item.v) || 0)) + 1;
  const take = {
    ...version,
    id: duplicate?.id || `take-v${nextV}`,
    v: nextV,
    file: takeMediaPath(version.file || version.generatedInputPath || version.outputFile || "", { slug: storyboard.projectId, clipId })
  };
  if (!duplicate) segment.generatedVersions.push(take);
  else Object.assign(duplicate, take);
  const takesNow = normalizeSegmentTakes(segment, { slug: storyboard.projectId, segmentId });
  const locked = Boolean(segment.activeTakeLocked);
  if (takesNow.length === 1 || (["done", "partial"].includes(String(status || "")) && !locked)) {
    segment.activeGeneratedVersion = take.v;
    segment.activeTakeId = take.id;
  }
  return take;
}

export function listSegmentTakes(slug, clipId, segmentId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard.clips?.[clipId]) throw new Error(`Storyboard clip not found: ${clipId}`);
  const segment = storyboard.segments?.[segmentId];
  if (!segment) throw new Error(`Storyboard segment not found: ${segmentId}`);
  const takes = ensureActiveTake(segment, { slug, clipId, segmentId });
  const active = activeTakeFromList(takes, segment.activeTakeId, segment.activeGeneratedVersion);
  return {
    projectSlug: slug,
    clipId,
    segmentId,
    takes,
    activeTakeId: active?.id || null,
    activeGeneratedVersion: active?.v || null,
    activeTakeLocked: Boolean(segment.activeTakeLocked)
  };
}

export function activateSegmentTake(slug, clipId, segmentId, takeId) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard.clips?.[clipId]) throw new Error(`Storyboard clip not found: ${clipId}`);
  const segment = storyboard.segments?.[segmentId];
  if (!segment) throw new Error(`Storyboard segment not found: ${segmentId}`);
  const takes = normalizeSegmentTakes(segment, { slug, clipId, segmentId });
  const take = takes.find((item) => String(item.id) === String(takeId) || String(item.v) === String(takeId));
  if (!take) throw new Error(`Take not found: ${takeId}`);
  segment.generatedVersions = Array.isArray(segment.generatedVersions) ? segment.generatedVersions : [];
  if (!segment.generatedVersions.some((item) => String(item.id) === String(take.id) || path.basename(String(item.file || item.generatedInputPath || "")).toLowerCase() === path.basename(String(take.file || "")).toLowerCase())) {
    segment.generatedVersions.push({
      id: take.id,
      v: take.v,
      file: take.file,
      generatedInputPath: take.file,
      source: take.source || "disk"
    });
  }
  segment.activeTakeId = take.id;
  segment.activeGeneratedVersion = take.v;
  segment.activeTakeLocked = true;
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return {
    projectSlug: slug,
    clipId,
    segmentId,
    takes: normalizeSegmentTakes(segment, { slug, clipId, segmentId }),
    activeTakeId: take.id,
    activeGeneratedVersion: take.v,
    activeTake: take,
    activeTakeLocked: true
  };
}



export function setSegmentTakeLock(slug, clipId, segmentId, locked) {
  slug = assertProjectSlug(slug);
  const storyboard = loadStoryboard(slug);
  if (!storyboard.clips?.[clipId]) throw new Error(`Storyboard clip not found: ${clipId}`);
  const segment = storyboard.segments?.[segmentId];
  if (!segment) throw new Error(`Storyboard segment not found: ${segmentId}`);
  segment.activeTakeLocked = Boolean(locked);
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  const takes = ensureActiveTake(segment, { slug, clipId, segmentId });
  const active = activeTakeFromList(takes, segment.activeTakeId, segment.activeGeneratedVersion);
  return {
    projectSlug: slug,
    clipId,
    segmentId,
    takes,
    activeTakeId: active?.id || null,
    activeGeneratedVersion: active?.v || null,
    activeTakeLocked: Boolean(segment.activeTakeLocked)
  };
}

export function setClipGenerateOption(slug, clipId, optionId) {
  slug = assertProjectSlug(slug);
  const option = generateOptionForMode(null, optionId);
  if (!option || option.id !== optionId) throw new Error(`Unknown generate option: ${optionId}`);
  const storyboard = loadStoryboard(slug);
  const clip = storyboard.clips?.[clipId];
  if (!clip) throw new Error(`Storyboard clip not found: ${clipId}`);
  const plan = storyboard.videoPlans?.[clip.videoPlanId];
  if (!plan) throw new Error(`Storyboard video plan not found: ${clip.videoPlanId}`);
  const currentMode = plan.generationMode || clip.generationMode || storyboard.defaults?.generationMode || null;
  if (option.generationMode === SEMANTIC_T2V_GENERATION_MODE
    && semanticT2vLockedForContext({ projectSlug: slug, generationMode: currentMode })) {
    throw new Error("Semantic T2V is locked on Harrowing AAA I2V. Queue All stays on segmented first-frame I2V.");
  }
  clip.generateOptionId = option.id;
  plan.generateOptionId = option.id;
  if (option.generationMode) {
    clip.generationMode = option.generationMode;
    plan.generationMode = option.generationMode;
  }
  if (!semanticT2vLockedForContext({ projectSlug: slug, generationMode: currentMode })) {
    storyboard.defaults = { ...(storyboard.defaults || {}), generateOptionId: option.id };
  }
  storyboard.updatedAt = new Date().toISOString();
  saveStoryboard(slug, storyboard);
  return { projectSlug: slug, clipId, generateOption: option };
}

export { PREMIERE_GENERATE_OPTIONS, HARROWING_AAA_I2V_GENERATE_OPTION, generateOptionForMode };
