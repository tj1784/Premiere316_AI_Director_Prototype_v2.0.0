import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PROJECTS_DIR, projectDir, mediaDir } from "./paths.js";
import {
  DEFAULT_DURATION,
  DEFAULT_FPS,
  DEFAULT_SEGMENT_SEC,
  DEFAULT_INGREDIENTS,
  normalizeSegments,
  framesOf
} from "./timeline.js";
import { normalizeBookends } from "./bookends.js";

function slugify(name) {
  return String(name || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "project";
}

export function normalizeProjectCategory(value) {
  return String(value || "feature").trim().toLowerCase() === "shorts" ? "shorts" : "feature";
}

export function isShortsProject(project) {
  return normalizeProjectCategory(project?.category ?? project?.settings?.category) === "shorts";
}

export function skipApproval(project) {
  return isShortsProject(project) || project?.settings?.skipApproval === true;
}

export function skipScreenplay(project) {
  return isShortsProject(project) || project?.settings?.skipScreenplay === true;
}

const WINDOWS_ATOMIC_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

function waitSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function writeTextAtomic(file, text) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(temp, file);
        break;
      } catch (error) {
        const retryable = process.platform === "win32"
          && WINDOWS_ATOMIC_RENAME_RETRY_CODES.has(String(error?.code || ""))
          && attempt < 8;
        if (!retryable) throw error;
        // Antivirus/indexer handles can briefly prevent MoveFileEx from
        // replacing project.json. Keep the prepared temp file immutable and
        // retry the atomic rename instead of falling back to a partial write.
        waitSync(Math.min(250, 10 * (2 ** attempt)));
      }
    }
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

export function ensureDirs(slug) {
  const root = projectDir(slug);
  for (const d of [
    "",
    "media",
    "media/frames",
    "media/clips",
    "media/audio",
    "media/assets",
    "media/storyboard",
    "media/masters",
    "media/temp",
    "production",
    "workflows"
  ]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  return root;
}

function defaultScore() {
  return {
    enabled: true,
    mode: "generate",
    prompt: "Epic cinematic orchestral score, emotional, reverent, building toward a luminous climax.",
    instrumentalOnly: true,
    genre: "Cinematic / Orchestral",
    mood: "Reverent / Epic",
    tempo: 96,
    musicLevelDb: -18,
    duckUnderDialogue: true,
    fadeInSec: 2,
    fadeOutSec: 3,
    versions: [],
    activeVersion: 0
  };
}

export function emptyProject(name, options = {}) {
  const slug = slugify(name);
  const category = normalizeProjectCategory(options.category);
  const shorts = category === "shorts";
  return {
    schemaVersion: 3,
    slug,
    name: name.trim(),
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      fps: DEFAULT_FPS,
      width: shorts ? 1080 : 1280,
      height: shorts ? 1920 : 720,
      defaultDurationSec: shorts ? 15 : DEFAULT_DURATION,
      segmentSec: DEFAULT_SEGMENT_SEC,
      minDurationSec: shorts ? 8 : 2,
      maxDurationSec: 30,
      skipScreenplay: shorts,
      skipApproval: shorts,
      ingredients: { ...DEFAULT_INGREDIENTS },
      exportPreset: "H.264 (MP4)",
      bookends: normalizeBookends(null, name)
    },
    frames: [],
    trash: { frames: [] },
    sequence: { clips: [] },
    screenplay: null,
    assets: null,
    score: defaultScore(),
    masters: [],
    activeMasterVersion: 0
  };
}

function guideId() {
  return crypto.randomUUID();
}

function migrateClip(clip, project, idx) {
  const fps = project.settings.fps || DEFAULT_FPS;
  const durationSec = Number(clip.durationSec) || project.settings.defaultDurationSec || DEFAULT_DURATION;
  const durationFrames = framesOf(durationSec, fps);
  clip.id = clip.id || crypto.randomUUID();
  clip.idx = idx;
  clip.name = clip.name || `Clip${String(idx + 1).padStart(2, "0")}`;
  clip.startSec = Number(clip.startSec) || 0;
  clip.durationSec = durationFrames / fps;
  clip.globalPrompt = String(clip.globalPrompt || "");
  clip.seed = clip.seed ?? null;
  clip.versions = Array.isArray(clip.versions) ? clip.versions : [];
  clip.rangeVersions = Array.isArray(clip.rangeVersions) ? clip.rangeVersions : [];
  clip.activeVersion = Number(clip.activeVersion) || 0;
  clip.status = clip.status || (clip.versions.length ? "done" : "ready");
  clip.segments = normalizeSegments(
    clip.segments || [],
    clip.durationSec,
    project.settings.segmentSec || DEFAULT_SEGMENT_SEC,
    fps
  );

  const guides = Array.isArray(clip.guides) ? clip.guides : [];
  if (clip.firstFrame?.file && !guides.some((g) => g.role === "first" || Number(g.frame) === 0)) {
    guides.push({
      id: guideId(),
      role: "first",
      frame: 0,
      file: clip.firstFrame.file,
      prompt: "",
      strength: 1,
      seed: null,
      source: "import",
      versions: [],
      activeVersion: 0,
      createdAt: clip.createdAt || project.createdAt
    });
  }
  if (clip.endFrame?.file && !guides.some((g) => g.role === "last")) {
    guides.push({
      id: guideId(),
      role: "last",
      frame: Math.max(0, durationFrames - 1),
      file: clip.endFrame.file,
      prompt: "",
      strength: 1,
      seed: null,
      source: "import",
      versions: [],
      activeVersion: 0,
      createdAt: clip.createdAt || project.createdAt
    });
  }
  clip.guides = guides
    .filter((g) => g && g.file)
    .map((g) => ({
      id: g.id || guideId(),
      role: ["first", "middle", "last"].includes(g.role) ? g.role : "middle",
      frame: Math.min(durationFrames - 1, Math.max(0, Math.round(Number(g.frame) || 0))),
      file: g.file,
      prompt: String(g.prompt || ""),
      strength: Math.min(1, Math.max(0, Number(g.strength ?? 1))),
      seed: g.seed ?? null,
      source: g.source || "import",
      versions: Array.isArray(g.versions) ? g.versions : [],
      activeVersion: Number(g.activeVersion) || 0,
      createdAt: g.createdAt || new Date().toISOString()
    }))
    .sort((a, b) => a.frame - b.frame);

  const first = clip.guides.find((g) => g.role === "first") || clip.guides.find((g) => g.frame === 0);
  const last = [...clip.guides].reverse().find((g) => g.role === "last");
  clip.firstFrame = first ? { file: first.file } : clip.firstFrame || null;
  clip.endFrame = last ? { file: last.file } : clip.endFrame || null;
  return clip;
}

export function migrateProject(project) {
  project.schemaVersion = 3;
  project.category = normalizeProjectCategory(project.category ?? project.settings?.category);
  const previousSettings = project.settings || {};
  const shorts = project.category === "shorts";
  project.settings = {
    fps: DEFAULT_FPS,
    width: shorts ? 1080 : 1280,
    height: shorts ? 1920 : 720,
    defaultDurationSec: shorts ? 15 : DEFAULT_DURATION,
    segmentSec: DEFAULT_SEGMENT_SEC,
    minDurationSec: shorts ? 8 : 2,
    maxDurationSec: 30,
    exportPreset: "H.264 (MP4)",
    skipScreenplay: shorts,
    skipApproval: shorts,
    ...previousSettings,
    ingredients: { ...DEFAULT_INGREDIENTS, ...(previousSettings.ingredients || {}) },
    bookends: normalizeBookends(previousSettings.bookends, project.name)
  };
  if (shorts) {
    project.settings.skipScreenplay = true;
    project.settings.skipApproval = true;
  }
  project.frames = Array.isArray(project.frames) ? project.frames : [];
  project.trash = project.trash && typeof project.trash === "object" ? project.trash : {};
  project.trash.frames = Array.isArray(project.trash.frames) ? project.trash.frames : [];
  project.sequence = project.sequence || { clips: [] };
  project.sequence.clips = Array.isArray(project.sequence.clips) ? project.sequence.clips : [];
  project.sequence.clips = project.sequence.clips.map((clip, idx) => migrateClip(clip, project, idx));
  project.screenplay = project.screenplay && typeof project.screenplay === "object"
    ? project.screenplay
    : null;
  project.assets = project.assets && typeof project.assets === "object"
    ? project.assets
    : null;
  if (project.assets) {
    project.assets.items = Array.isArray(project.assets.items) ? project.assets.items : [];
    project.assets.total = project.assets.items.length;
  }
  project.score = { ...defaultScore(), ...(project.score || {}) };
  project.score.versions = Array.isArray(project.score.versions) ? project.score.versions : [];
  project.masters = Array.isArray(project.masters) ? project.masters : [];
  project.activeMasterVersion = Number(project.activeMasterVersion) || 0;
  recomputeStarts(project);
  return project;
}

export function listProjects() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const p = loadProject(d.name);
        return {
          slug: p.slug,
          name: p.name,
          category: p.category || "feature",
          updatedAt: p.updatedAt,
          clipCount: p.sequence?.clips?.length || 0,
          masterCount: p.masters?.length || 0
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadProject(slug) {
  const p = path.join(projectDir(slug), "project.json");
  if (!fs.existsSync(p)) throw new Error(`Project not found: ${slug}`);
  const source = fs.readFileSync(p, "utf-8");
  const project = migrateProject(JSON.parse(source));
  const next = JSON.stringify(project, null, 2);
  if (next !== source) {
    ensureDirs(project.slug);
    writeTextAtomic(p, next);
  }
  return project;
}

export function saveProject(project) {
  ensureDirs(project.slug);
  migrateProject(project);
  project.updatedAt = new Date().toISOString();
  writeTextAtomic(
    path.join(projectDir(project.slug), "project.json"),
    JSON.stringify(project, null, 2)
  );
  return project;
}

export function createProject(name, options = {}) {
  if (!name?.trim()) throw new Error("name required");
  let slug = slugify(name);
  let n = 1;
  while (fs.existsSync(path.join(projectDir(slug), "project.json"))) {
    slug = `${slugify(name)}_${++n}`;
  }
  const project = emptyProject(name, options);
  project.slug = slug;
  ensureDirs(slug);
  return saveProject(project);
}

export function deleteProject(slug) {
  const root = projectDir(slug);
  if (!fs.existsSync(root)) return;
  fs.rmSync(root, { recursive: true, force: true });
}

export function findClip(project, clipId) {
  return project.sequence?.clips?.find((c) => c.id === clipId) || null;
}

export function findGuide(clip, guideId) {
  return clip.guides?.find((g) => g.id === guideId) || null;
}

export function recomputeStarts(project) {
  let t = 0;
  let frame = 0;
  const fps = project.settings?.fps || DEFAULT_FPS;
  for (const c of project.sequence.clips) {
    c.startSec = t;
    c.startFrame = frame;
    const durationFrames = framesOf(c.durationSec, fps);
    c.durationSec = durationFrames / fps;
    t += c.durationSec;
    frame += durationFrames;
  }
  project.sequence.durationSec = t;
  project.sequence.durationFrames = frame;
  return t;
}

export function makeClip(project, { firstFrameFile, name, durationSec, globalPrompt } = {}) {
  const idx = project.sequence.clips.length;
  const fps = project.settings.fps || DEFAULT_FPS;
  const requestedDuration = Number(durationSec ?? project.settings.defaultDurationSec ?? DEFAULT_DURATION);
  const dur = Math.max(
    Number(project.settings.minDurationSec) || 2,
    Math.min(Number(project.settings.maxDurationSec) || 30, Number.isFinite(requestedDuration) ? requestedDuration : DEFAULT_DURATION)
  );
  const segSec = project.settings.segmentSec ?? DEFAULT_SEGMENT_SEC;
  const segments = normalizeSegments([], dur, segSec, fps);
  const clip = {
    id: crypto.randomUUID(),
    idx,
    name: name || `Clip${String(idx + 1).padStart(2, "0")}`,
    startSec: 0,
    startFrame: 0,
    durationSec: framesOf(dur, fps) / fps,
    firstFrame: firstFrameFile ? { file: firstFrameFile } : null,
    endFrame: null,
    guides: firstFrameFile
      ? [{
          id: guideId(),
          role: "first",
          frame: 0,
          file: firstFrameFile,
          prompt: "",
          strength: 1,
          seed: null,
          source: "import",
          versions: [],
          activeVersion: 0,
          createdAt: new Date().toISOString()
        }]
      : [],
    globalPrompt: globalPrompt || "",
    segments,
    seed: null,
    versions: [],
    rangeVersions: [],
    activeVersion: 0,
    status: "ready"
  };
  project.sequence.clips.push(clip);
  recomputeStarts(project);
  return clip;
}

export function registerFrame(project, filename, displayName, extra = {}) {
  const existing = (project.frames || []).find((f) => f.file === filename);
  if (existing) return existing;
  const entry = {
    id: crypto.randomUUID(),
    file: filename,
    name: displayName || filename,
    importedAt: new Date().toISOString(),
    ...extra
  };
  project.frames = project.frames || [];
  project.frames.push(entry);
  return entry;
}

export function syncGuideAliases(clip, fps = DEFAULT_FPS) {
  const total = framesOf(clip.durationSec, fps);
  clip.guides = (clip.guides || []).sort((a, b) => a.frame - b.frame);
  const first = clip.guides.find((g) => g.role === "first") || clip.guides.find((g) => g.frame === 0);
  const last = [...clip.guides].reverse().find((g) => g.role === "last");
  if (first) {
    first.frame = 0;
    first.role = "first";
    clip.firstFrame = { file: first.file };
  }
  if (last) {
    last.frame = Math.max(0, total - 1);
    last.role = "last";
    clip.endFrame = { file: last.file };
  } else {
    clip.endFrame = null;
  }
}

export { mediaDir };
