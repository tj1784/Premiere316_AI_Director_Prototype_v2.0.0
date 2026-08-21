import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PACKAGE_ROOT, projectDir } from "./paths.js";
import { loadStoryboard, saveStoryboard } from "./storyboard.js";

const COMFY_OUTPUT = path.join(PACKAGE_ROOT, "BlokeyUI", "ComfyUI", "output", "Premiere316");
const INTERVAL_MS = 4000;
export const OUTPUT_STABLE_MS = INTERVAL_MS * 2;
const MIN_MP4_BYTES = 1024;

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function sameSnapshot(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function hasCompleteMp4Structure(file, bytes) {
  const handle = fs.openSync(file, "r");
  let offset = 0;
  let hasFtyp = false;
  let hasMoov = false;
  let hasMedia = false;
  try {
    while (offset + 8 <= bytes) {
      const header = Buffer.allocUnsafe(16);
      const read = fs.readSync(handle, header, 0, Math.min(16, bytes - offset), offset);
      if (read < 8) return false;
      const type = header.toString("ascii", 4, 8);
      let atomBytes = header.readUInt32BE(0);
      let headerBytes = 8;
      if (atomBytes === 1) {
        if (read < 16) return false;
        const extended = header.readBigUInt64BE(8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        atomBytes = Number(extended);
        headerBytes = 16;
      } else if (atomBytes === 0) {
        atomBytes = bytes - offset;
      }
      if (atomBytes < headerBytes || offset + atomBytes > bytes) return false;
      if (type === "ftyp") hasFtyp = true;
      if (type === "moov") hasMoov = true;
      if (type === "mdat" && atomBytes > headerBytes) hasMedia = true;
      offset += atomBytes;
    }
  } finally {
    fs.closeSync(handle);
  }
  return offset === bytes && hasFtyp && hasMoov && hasMedia;
}

export function completedMp4Snapshot(file, {
  nowMs = Date.now(),
  stableAgeMs = OUTPUT_STABLE_MS
} = {}) {
  let before;
  try {
    before = fs.statSync(file);
  } catch {
    return null;
  }
  if (!before.isFile() || before.size < MIN_MP4_BYTES || nowMs - before.mtimeMs < stableAgeMs) return null;
  if (!hasCompleteMp4Structure(file, before.size)) return null;
  const after = fs.statSync(file);
  return sameSnapshot(before, after) ? { size: after.size, mtimeMs: after.mtimeMs } : null;
}

function nextDirectorVersion(clipsDir, clipId, segmentId) {
  const prefix = `${clipId}_${segmentId}_director_v`.toLowerCase();
  let max = 0;
  if (!fs.existsSync(clipsDir)) return 1;
  for (const name of fs.readdirSync(clipsDir)) {
    if (!name.toLowerCase().startsWith(prefix) || !/\.mp4$/i.test(name) || /-audio/i.test(name)) continue;
    const match = name.match(/_director_v(\d+)\./i);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function ledgerPath(slug, projectRoot = projectDir(slug)) {
  return path.join(projectRoot, "production", "comfy-output-ingest.json");
}

function loadLedger(slug, projectRoot) {
  const file = ledgerPath(slug, projectRoot);
  if (!fs.existsSync(file)) return { ingested: {} };
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { ingested: {} }; }
}

function saveLedger(slug, ledger, projectRoot) {
  const file = ledgerPath(slug, projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const latest = loadLedger(slug, projectRoot);
  const merged = {
    ...latest,
    ...ledger,
    ingested: { ...(latest.ingested || {}), ...(ledger.ingested || {}) }
  };
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function matchingDirectorTakes(clipsDir, clipId, segmentId, snapshot, contentSha256, nowMs, stableAgeMs) {
  const prefix = `${clipId}_${segmentId}_director_v`.toLowerCase();
  if (!fs.existsSync(clipsDir)) return { matches: [], pending: false };
  const matches = [];
  let pending = false;
  for (const name of fs.readdirSync(clipsDir)) {
    if (!name.toLowerCase().startsWith(prefix) || !/\.mp4$/i.test(name) || /-audio/i.test(name)) continue;
    const file = path.join(clipsDir, name);
    const stat = fs.statSync(file);
    if (nowMs - stat.mtimeMs < stableAgeMs) pending = true;
    if (stat.size === snapshot.size && sha256File(file) === contentSha256) matches.push(name);
  }
  return { matches, pending: matches.length ? false : pending };
}

function publishExclusiveCopy(source, destination, snapshot, contentSha256, afterTemporaryCopyFn) {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    afterTemporaryCopyFn?.({ source, temporary, destination });
    const sourceAfter = fs.statSync(source);
    const temporaryAfter = fs.statSync(temporary);
    if (
      !sameSnapshot(snapshot, sourceAfter)
      || temporaryAfter.size !== snapshot.size
      || sha256File(source) !== contentSha256
      || sha256File(temporary) !== contentSha256
    ) {
      return false;
    }
    fs.linkSync(temporary, destination);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function takeVersion(name) {
  return Number(String(name || "").match(/_director_v(\d+)\.mp4$/i)?.[1]) || 0;
}

export function chapterFolderForClipId(clipId) {
  const chapter = String(clipId || "").trim().match(/^(H\d{2}|MV\d{2})-/i)?.[1];
  if (!chapter) throw new Error(`Cannot derive chapter folder from clip ID: ${clipId || "missing"}`);
  return chapter.toUpperCase();
}

function takeRelativeFile(clipId, outName) {
  return `media/clips/${chapterFolderForClipId(clipId)}/${outName}`;
}

function takeReferencesFile(take, outName) {
  if (!take || typeof take !== "object") return false;
  const file = String(take.file || "").replace(/\\/g, "/");
  return take.outputFile === outName
    || file === `media/clips/${outName}`
    || file.endsWith(`/media/clips/${outName}`)
    || file.endsWith(`/${outName}`)
    || (Array.isArray(take.files) && take.files.includes(outName));
}

function ensureTakeMetadata(storyboard, {
  clipId,
  segmentId,
  segmentIndex,
  outName,
  version,
  createdAt
}) {
  const seg = storyboard?.segments?.[segmentId];
  if (!seg || !Number.isInteger(version) || version < 1) return false;
  const relativeFile = takeRelativeFile(clipId, outName);
  seg.generatedVersions = Array.isArray(seg.generatedVersions) ? seg.generatedVersions : [];
  let rec = seg.generatedVersions.find((take) => takeReferencesFile(take, outName));
  let changed = false;
  if (!rec) {
    rec = {
      v: version,
      id: `take-v${version}`,
      files: [outName],
      file: relativeFile,
      outputFile: outName,
      previewFile: relativeFile,
      mediaType: "video",
      source: "comfy-8188",
      workflowId: "LTX_2.5_Harrowing_AAA",
      segmentId,
      segmentIndex,
      createdAt
    };
    seg.generatedVersions.push(rec);
    changed = true;
  }
  if (!seg.activeTakeLocked && (seg.activeGeneratedVersion !== version || seg.activeTakeId !== rec.id || seg.status !== "ready")) {
    seg.activeGeneratedVersion = version;
    seg.activeTakeId = rec.id;
    seg.status = "ready";
    changed = true;
  }
  const plan = storyboard.videoPlans?.[seg.videoPlanId];
  const tdSeg = plan?.timelineData?.segments?.find((item) => item?.id === segmentId);
  if (tdSeg) {
    tdSeg.generatedTakes = Array.isArray(tdSeg.generatedTakes) ? tdSeg.generatedTakes : [];
    let timelineRec = tdSeg.generatedTakes.find((take) => takeReferencesFile(take, outName));
    if (!timelineRec) {
      timelineRec = { ...rec };
      tdSeg.generatedTakes.push(timelineRec);
      changed = true;
    }
    if (!seg.activeTakeLocked && (
      tdSeg.activeTakeId !== rec.id
      || tdSeg.activeGeneratedVersion !== version
      || tdSeg.activeTakeFile !== rec.file
    )) {
      tdSeg.activeTakeId = rec.id;
      tdSeg.activeGeneratedVersion = version;
      tdSeg.activeTakeFile = rec.file;
      changed = true;
    }
  }
  return changed;
}

export function ingestProject(slug, {
  outputRoot = COMFY_OUTPUT,
  projectRoot = projectDir(slug),
  loadStoryboardFn = loadStoryboard,
  saveStoryboardFn = saveStoryboard,
  nowMs = Date.now(),
  stableAgeMs = OUTPUT_STABLE_MS,
  notBeforeMs = 0,
  afterTemporaryCopyFn = null
} = {}) {
  const directorRoot = path.join(outputRoot, slug, "director");
  if (!fs.existsSync(directorRoot)) return 0;
  const clipsRoot = path.join(projectRoot, "media", "clips");
  fs.mkdirSync(clipsRoot, { recursive: true });
  const ledger = loadLedger(slug, projectRoot);
  ledger.ingested ||= {};
  let storyboard = null;
  let added = 0;
  let storyboardDirty = false;
  let ledgerDirty = false;

  for (const clipDir of fs.readdirSync(directorRoot, { withFileTypes: true })) {
    if (!clipDir.isDirectory()) continue;
    const clipId = clipDir.name;
    const clipsDir = path.join(clipsRoot, chapterFolderForClipId(clipId));
    fs.mkdirSync(clipsDir, { recursive: true });
    const folder = path.join(directorRoot, clipId);
    for (const name of fs.readdirSync(folder)) {
      if (!/^segment_\d+_/i.test(name) || !/\.mp4$/i.test(name) || /-audio/i.test(name)) continue;
      const match = name.match(/^segment_(\d+)_/i);
      if (!match) continue;
      const n = Number(match[1]);
      const src = path.join(folder, name);
      const audioSrc = path.join(folder, name.replace(/\.mp4$/i, "-audio.mp4"));
      const payloadSrc = fs.existsSync(audioSrc) ? audioSrc : src;
      const snapshot = completedMp4Snapshot(payloadSrc, { nowMs, stableAgeMs });
      if (!snapshot) continue;
      // A server restart must not reinterpret the entire historical Comfy
      // output tree as new project media. Files already complete before this
      // watcher instance started are a baseline; an in-flight file remains
      // eligible because its final write advances mtime beyond this boundary.
      if (Number(notBeforeMs) > 0 && snapshot.mtimeMs < Number(notBeforeMs)) continue;
      const legacyDigest = `${clipId}:${name}:${snapshot.size}`;
      const contentSha256 = sha256File(payloadSrc);
      const afterHash = fs.statSync(payloadSrc);
      if (!sameSnapshot(snapshot, afterHash)) continue;
      const digest = `${clipId}:${name}:sha256:${contentSha256}`;
      if (ledger.ingested[digest] || ledger.ingested[legacyDigest] || ledger.ingested[src]) continue;
      const segmentId = `segment-${clipId.toLowerCase()}-${String(n).padStart(2, "0")}`;
      const existing = matchingDirectorTakes(clipsDir, clipId, segmentId, snapshot, contentSha256, nowMs, stableAgeMs);
      if (existing.matches.length) {
        storyboard ||= loadStoryboardFn(slug);
        const seg = storyboard.segments?.[segmentId];
        const existingName = existing.matches.find((candidate) =>
          seg?.generatedVersions?.some((take) => takeReferencesFile(take, candidate))
        ) || existing.matches.sort((left, right) => takeVersion(left) - takeVersion(right))[0];
        const recovered = ensureTakeMetadata(storyboard, {
          clipId,
          segmentId,
          segmentIndex: n,
          outName: existingName,
          version: takeVersion(existingName),
          createdAt: new Date(nowMs).toISOString()
        });
        storyboardDirty = recovered || storyboardDirty;
        if (recovered) added += 1;
        ledger.ingested[digest] = {
          file: existingName,
          src: name,
          clipId,
          segmentId,
          bytes: snapshot.size,
          sha256: contentSha256,
          duplicate: true,
          at: new Date(nowMs).toISOString()
        };
        ledgerDirty = true;
        continue;
      }
      if (existing.pending) continue;
      const v = nextDirectorVersion(clipsDir, clipId, segmentId);
      const outName = `${clipId}_${segmentId}_director_v${String(v).padStart(2, "0")}.mp4`;
      const dest = path.join(clipsDir, outName);
      if (!publishExclusiveCopy(payloadSrc, dest, snapshot, contentSha256, afterTemporaryCopyFn)) continue;

      storyboard ||= loadStoryboardFn(slug);
      const metadataAdded = ensureTakeMetadata(storyboard, {
        clipId,
        segmentId,
        segmentIndex: n,
        outName,
        version: v,
        createdAt: new Date(nowMs).toISOString()
      });
      storyboardDirty = metadataAdded || storyboardDirty;
      ledger.ingested[digest] = {
        file: outName,
        src: name,
        clipId,
        segmentId,
        bytes: snapshot.size,
        sha256: contentSha256,
        at: new Date(nowMs).toISOString()
      };
      ledgerDirty = true;
      added += 1;
    }
  }
  if (storyboardDirty) {
    saveStoryboardFn(slug, storyboard);
  }
  if (ledgerDirty) {
    saveLedger(slug, ledger, projectRoot);
  }
  if (added) {
    console.log(`[comfy-8188 ingest] ${slug}: +${added} take(s)`);
  }
  return added;
}

export function startComfyOutputIngest() {
  const watcherStartedAt = Date.now();
  const tick = () => {
    try {
      if (!fs.existsSync(COMFY_OUTPUT)) return;
      for (const ent of fs.readdirSync(COMFY_OUTPUT, { withFileTypes: true })) {
        if (ent.isDirectory()) ingestProject(ent.name, { notBeforeMs: watcherStartedAt });
      }
    } catch (error) {
      console.warn(`[comfy-8188 ingest] ${error.message}`);
    }
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  console.log(`  Comfy 8188 ingest → ${COMFY_OUTPUT}`);
}
