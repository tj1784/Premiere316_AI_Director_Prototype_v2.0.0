import crypto from "crypto";
import fs from "fs";
import path from "path";
import { loadProject, saveProject } from "./projects.js";
import { projectDir } from "./paths.js";

export const AUDIO_SOUND_SCHEMA_VERSION = 2;
export const AUDIO_ASSET_CATEGORIES = Object.freeze([
  "music", "sound-effect", "foley", "ambience", "voice-design", "dialogue", "voice-reference"
]);

const CATEGORY_ALIASES = Object.freeze({
  music: "music",
  score: "music",
  soundtrack: "music",
  sound: "sound-effect",
  sfx: "sound-effect",
  "sound-fx": "sound-effect",
  sound_effect: "sound-effect",
  sound_effects: "sound-effect",
  "sound-effect": "sound-effect",
  "sound-effects": "sound-effect",
  "sound effect": "sound-effect",
  "sound effects": "sound-effect",
  foley: "foley",
  ambience: "ambience",
  ambient: "ambience",
  atmosphere: "ambience",
  "voice-design": "voice-design",
  voice_design: "voice-design",
  dialogue: "dialogue",
  dialog: "dialogue",
  voice: "dialogue",
  "voice-reference": "voice-reference",
  voice_reference: "voice-reference"
});

const CATEGORY_DIRS = Object.freeze({
  music: "music",
  "sound-effect": "sound-effects",
  foley: "foley",
  ambience: "ambience",
  "voice-design": "voice-design",
  dialogue: "dialogue",
  "voice-reference": "voice-references"
});

function audioError(message, statusCode = 400, code = "AUDIO_ASSET_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function text(value, max = 1000) {
  return value == null ? null : String(value).trim().slice(0, max) || null;
}

function safeRelativePath(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized)) throw audioError("Audio asset path must be project-relative");
  const cleaned = path.posix.normalize(normalized);
  if (cleaned === ".." || cleaned.startsWith("../") || cleaned.includes("/../")) throw audioError("Audio asset path escapes the project");
  if (!cleaned.startsWith("media/")) throw audioError("Audio asset path must be inside project media");
  return cleaned;
}

function projectContained(project, relativePath) {
  const root = path.resolve(projectDir(project.slug));
  const candidate = path.resolve(root, relativePath.split("/").join(path.sep));
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw audioError("Audio path escapes the project");
  return candidate;
}

export function normalizeAudioAssetCategory(value) {
  const key = String(value || "").trim().toLowerCase();
  const category = CATEGORY_ALIASES[key];
  if (!category) throw audioError(`Unknown audio asset category: ${value || "missing"}`);
  return category;
}

export function audioCategoryRelativeDirectory(categoryValue) {
  const category = normalizeAudioAssetCategory(categoryValue);
  return `media/audio/${CATEGORY_DIRS[category]}`;
}

export function audioCategoryDirectory(projectOrSlug, category) {
  const slug = typeof projectOrSlug === "string" ? projectOrSlug : projectOrSlug?.slug;
  if (!slug) throw audioError("Project slug is required");
  return path.join(projectDir(slug), ...audioCategoryRelativeDirectory(category).split("/"));
}

export function ensureProjectAudioState(project) {
  if (!project || typeof project !== "object") throw audioError("Project is required");
  const previous = project.sound && typeof project.sound === "object" ? project.sound : {};
  project.sound = previous;
  // Preserve IndexTTS schema-1 collections and every unknown legacy key.
  project.sound.voices = Array.isArray(previous.voices) ? previous.voices : [];
  // `generations` remains exclusively owned by IndexTTS/Voice Clone. Generic
  // Comfy audio jobs use a separate collection so IndexTTS reconciliation
  // cannot mark Music/SFX work interrupted or render it in the clone UI.
  project.sound.generations = Array.isArray(previous.generations) ? previous.generations : [];
  project.sound.audioGenerations = Array.isArray(previous.audioGenerations) ? previous.audioGenerations : [];
  project.sound.assets = Array.isArray(previous.assets) ? previous.assets : [];
  project.sound.trash = previous.trash && typeof previous.trash === "object" ? previous.trash : {};
  project.sound.trash.assets = Array.isArray(project.sound.trash.assets) ? project.sound.trash.assets : [];
  project.sound.schemaVersion = Math.max(AUDIO_SOUND_SCHEMA_VERSION, Number(previous.schemaVersion || 1));
  return project.sound;
}

function normalizeAssociations(value = {}, projectSlug = null) {
  return {
    projectSlug: text(value.projectSlug || projectSlug, 128),
    chapterId: text(value.chapterId, 128),
    sceneId: text(value.sceneId, 128),
    clipId: text(value.clipId, 128)
  };
}

function normalizeEditorial(value = {}) {
  const out = {};
  for (const key of ["sourceInSec", "sourceOutSec", "timelineStartSec", "targetInSec", "targetOutSec", "fadeInSec", "fadeOutSec"]) {
    const number = finite(value[key]);
    if (number != null) out[key] = Math.max(0, number);
  }
  if (value.track != null) out.track = text(value.track, 16);
  if (value.loop != null) out.loop = value.loop === true;
  if (value.seamless != null) out.seamless = value.seamless === true;
  if (value.notes != null) out.notes = text(value.notes, 4000);
  if (out.sourceOutSec != null && out.sourceInSec != null && out.sourceOutSec < out.sourceInSec) {
    throw audioError("editorial.sourceOutSec must be at or after sourceInSec");
  }
  return out;
}

function normalizeMedia(value = {}) {
  const durationSec = finite(value.durationSec);
  const bytes = finite(value.bytes);
  return {
    path: safeRelativePath(value.path || value.relativePath),
    filename: text(value.filename || (value.path ? path.posix.basename(String(value.path).replace(/\\/g, "/")) : null), 255),
    format: text(value.format || value.container || (value.path ? path.extname(value.path).slice(1) : null), 32)?.toLowerCase() || null,
    mimeType: text(value.mimeType, 128),
    bytes: bytes == null ? null : Math.max(0, Math.trunc(bytes)),
    sha256: value.sha256 ? String(value.sha256).toLowerCase() : null,
    durationSec: durationSec == null ? null : Math.max(0, durationSec),
    sampleRate: finite(value.sampleRate) == null ? null : Math.max(0, Math.trunc(finite(value.sampleRate))),
    channels: finite(value.channels) == null ? null : Math.max(0, Math.trunc(finite(value.channels))),
    codec: text(value.codec, 64),
    native: value.native !== false,
    lossless: value.lossless === true
  };
}

function assertUniqueAssetId(sound, assetId) {
  if (sound.assets.some((asset) => asset.id === assetId) || sound.trash.assets.some((asset) => asset.id === assetId)) {
    throw audioError(`Audio asset ID already exists: ${assetId}`, 409, "AUDIO_ASSET_EXISTS");
  }
}

export function registerAudioAsset(project, input = {}) {
  const sound = ensureProjectAudioState(project);
  const category = normalizeAudioAssetCategory(input.category);
  const id = text(input.id, 160) || `audio_${crypto.randomUUID()}`;
  assertUniqueAssetId(sound, id);
  const media = normalizeMedia(input.media || input);
  if (!media.path) throw audioError("Audio asset media.path is required");
  const expectedRoot = `${audioCategoryRelativeDirectory(category)}/`;
  if (!media.path.startsWith(expectedRoot)) {
    throw audioError(`Audio asset for ${category} must be stored below ${expectedRoot}`);
  }
  const createdAt = input.createdAt || now();
  const record = {
    id,
    kind: "audio",
    category,
    name: text(input.name || input.title || media.filename || category, 180),
    description: text(input.description, 4000),
    favorite: input.favorite === true,
    approved: input.approved === true,
    status: text(input.status, 64) || (input.approved === true ? "approved" : "candidate"),
    parentAssetId: text(input.parentAssetId, 160),
    associations: normalizeAssociations(input.associations, project.slug),
    editorial: normalizeEditorial(input.editorial),
    media,
    provenance: clone(input.provenance || {}),
    generationId: text(input.generationId, 160),
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
  sound.assets.push(record);
  return record;
}

export function getAudioAsset(project, assetId, { includeTrash = false } = {}) {
  const sound = ensureProjectAudioState(project);
  const asset = sound.assets.find((item) => item.id === String(assetId));
  if (asset) return asset;
  if (includeTrash) return sound.trash.assets.find((item) => item.id === String(assetId)) || null;
  return null;
}

export function listAudioAssets(project, filters = {}) {
  const sound = ensureProjectAudioState(project);
  const category = filters.category ? normalizeAudioAssetCategory(filters.category) : null;
  const values = filters.trashed === true ? sound.trash.assets : sound.assets;
  return values.filter((asset) => {
    if (category && asset.category !== category) return false;
    if (filters.favorite != null && asset.favorite !== (filters.favorite === true)) return false;
    if (filters.approved != null && asset.approved !== (filters.approved === true)) return false;
    if (filters.sceneId != null && asset.associations?.sceneId !== String(filters.sceneId)) return false;
    if (filters.clipId != null && asset.associations?.clipId !== String(filters.clipId)) return false;
    return true;
  });
}

export function patchAudioAsset(project, assetId, patch = {}) {
  const asset = getAudioAsset(project, assetId);
  if (!asset) throw audioError(`Audio asset not found: ${assetId}`, 404, "AUDIO_ASSET_NOT_FOUND");
  if (patch.name !== undefined || patch.title !== undefined) asset.name = text(patch.name ?? patch.title, 180) || asset.name;
  if (patch.description !== undefined) asset.description = text(patch.description, 4000);
  if (patch.favorite !== undefined) asset.favorite = patch.favorite === true;
  if (patch.approved !== undefined) {
    asset.approved = patch.approved === true;
    asset.status = asset.approved ? "approved" : asset.status === "approved" ? "candidate" : asset.status;
  }
  if (patch.status !== undefined) asset.status = text(patch.status, 64) || asset.status;
  if (patch.parentAssetId !== undefined) asset.parentAssetId = text(patch.parentAssetId, 160);
  if (patch.associations !== undefined) asset.associations = normalizeAssociations({ ...asset.associations, ...patch.associations }, project.slug);
  if (patch.editorial !== undefined) asset.editorial = normalizeEditorial({ ...asset.editorial, ...patch.editorial });
  asset.updatedAt = now();
  return asset;
}

function uniqueTrashPath(project, asset) {
  const original = asset.media.path;
  const destinationDir = `media/trash/audio/${asset.id}`;
  let filename = path.posix.basename(original);
  let destination = `${destinationDir}/${filename}`;
  let index = 1;
  while (fs.existsSync(projectContained(project, destination))) {
    const extension = path.posix.extname(filename);
    const stem = path.posix.basename(filename, extension);
    destination = `${destinationDir}/${stem}-${index}${extension}`;
    index += 1;
  }
  return destination;
}

export function trashAudioAsset(project, assetId, options = {}) {
  const sound = ensureProjectAudioState(project);
  const index = sound.assets.findIndex((asset) => asset.id === String(assetId));
  if (index < 0) throw audioError(`Audio asset not found: ${assetId}`, 404, "AUDIO_ASSET_NOT_FOUND");
  const asset = sound.assets[index];
  const originalPath = safeRelativePath(asset.media?.path);
  const trashPath = uniqueTrashPath(project, asset);
  if (options.moveFile !== false && originalPath) {
    const source = projectContained(project, originalPath);
    const destination = projectContained(project, trashPath);
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(source, destination);
    }
  }
  sound.assets.splice(index, 1);
  const trashed = {
    ...asset,
    media: { ...asset.media, path: trashPath },
    trash: { originalPath, deletedAt: now(), reason: text(options.reason, 1000) }
  };
  sound.trash.assets.push(trashed);
  return trashed;
}

export function restoreAudioAsset(project, assetId, options = {}) {
  const sound = ensureProjectAudioState(project);
  const index = sound.trash.assets.findIndex((asset) => asset.id === String(assetId));
  if (index < 0) throw audioError(`Trashed audio asset not found: ${assetId}`, 404, "AUDIO_ASSET_NOT_FOUND");
  const asset = sound.trash.assets[index];
  const sourcePath = safeRelativePath(asset.media?.path);
  const originalPath = safeRelativePath(asset.trash?.originalPath);
  if (!originalPath) throw audioError("Trashed audio asset has no restore path", 409);
  if (options.moveFile !== false) {
    const source = projectContained(project, sourcePath);
    const destination = projectContained(project, originalPath);
    if (fs.existsSync(destination)) throw audioError("Restore destination already exists", 409, "AUDIO_ASSET_RESTORE_CONFLICT");
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(source, destination);
    }
  }
  sound.trash.assets.splice(index, 1);
  const restored = { ...asset, media: { ...asset.media, path: originalPath }, updatedAt: now() };
  delete restored.trash;
  sound.assets.push(restored);
  return restored;
}

export function applyAudioAssetAction(project, assetId, action, payload = {}) {
  switch (String(action || "").trim().toLowerCase()) {
    case "favorite": return patchAudioAsset(project, assetId, { favorite: payload.value !== false });
    case "unfavorite": return patchAudioAsset(project, assetId, { favorite: false });
    case "approve": return patchAudioAsset(project, assetId, { approved: payload.value !== false });
    case "unapprove": return patchAudioAsset(project, assetId, { approved: false });
    case "rename": return patchAudioAsset(project, assetId, { name: payload.name });
    case "associate": return patchAudioAsset(project, assetId, { associations: payload.associations || payload });
    case "editorial": return patchAudioAsset(project, assetId, { editorial: payload.editorial || payload });
    case "trash": case "delete": return trashAudioAsset(project, assetId, payload);
    case "restore": return restoreAudioAsset(project, assetId, payload);
    default: throw audioError(`Unknown audio asset action: ${action || "missing"}`);
  }
}

export function buildAudioEditPlacement(asset, overrides = {}) {
  if (!asset?.media?.path) throw audioError("Audio asset has no media path");
  const editorial = normalizeEditorial({ ...(asset.editorial || {}), ...overrides });
  return {
    kind: "audio",
    source: asset.media.path,
    sourceInSec: editorial.sourceInSec || 0,
    sourceOutSec: editorial.sourceOutSec ?? asset.media.durationSec ?? null,
    timelineStartSec: editorial.timelineStartSec ?? editorial.targetInSec ?? 0,
    track: editorial.track || "A1",
    fadeInSec: editorial.fadeInSec || 0,
    fadeOutSec: editorial.fadeOutSec || 0,
    loop: editorial.loop === true,
    origin: {
      assetId: asset.id,
      generationId: asset.generationId || null,
      profileId: asset.provenance?.workflow?.profileId || null,
      sha256: asset.media.sha256 || null,
      sceneId: asset.associations?.sceneId || null,
      clipId: asset.associations?.clipId || null
    }
  };
}

function loadAndMutate(projectSlug, mutator, options = {}) {
  const load = options.loadProjectFn || loadProject;
  const save = options.saveProjectFn || saveProject;
  const project = load(projectSlug);
  const result = mutator(project);
  save(project);
  return result;
}

export function getProjectAudioState(projectSlug, options = {}) {
  const project = (options.loadProjectFn || loadProject)(projectSlug);
  return ensureProjectAudioState(project);
}

export function createProjectAudioAsset(projectSlug, input, options = {}) {
  return loadAndMutate(projectSlug, (project) => registerAudioAsset(project, input), options);
}

export function patchProjectAudioAsset(projectSlug, assetId, patch, options = {}) {
  return loadAndMutate(projectSlug, (project) => patchAudioAsset(project, assetId, patch), options);
}

export function deleteProjectAudioAssetToTrash(projectSlug, assetId, request = {}, options = {}) {
  return loadAndMutate(projectSlug, (project) => trashAudioAsset(project, assetId, request), options);
}

export function restoreProjectAudioAsset(projectSlug, assetId, request = {}, options = {}) {
  return loadAndMutate(projectSlug, (project) => restoreAudioAsset(project, assetId, request), options);
}

export function performProjectAudioAssetAction(projectSlug, assetId, action, payload = {}, options = {}) {
  return loadAndMutate(projectSlug, (project) => applyAudioAssetAction(project, assetId, action, payload), options);
}
