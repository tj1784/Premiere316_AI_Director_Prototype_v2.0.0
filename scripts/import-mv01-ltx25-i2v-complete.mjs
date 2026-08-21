import crypto from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, validateStoryboard } from "../server/storyboard.js";

export const PACKAGE_ID = "mv01_ltx25_i2v_complete_v1";
export const FPS = 24;
export const PACKAGE_DEFINITION = Object.freeze({
  chapterId: "MV01",
  archiveName: "MV01_LTX25_I2V_COMPLETE.zip",
  archiveSha256: "ce46d11738a1b123328bbc106bf1e14f12f4188d7e129d1bcdddfa52d4dc311b",
  archiveBytes: 72705113,
  rootEntry: "MV01_LTX25_I2V_COMPLETE",
  csv: "MV01_FIRST_FRAME_BINDINGS.csv",
  prompts: "MV01_I2V_PROMPTS.md",
  manifest: "MV01_MANIFEST.json",
  sources: "MV01_SOURCE_REFERENCES.md",
  shaManifest: "SHA256_MANIFEST.json",
  videoPlans: "MV01_VIDEO_PLANS_I2V.json",
  readme: "README.md",
  qa: "QA_REPORT.md",
  contactSheet: "MV01_CONTACT_SHEET.jpg",
  expectedClips: 34,
  expectedFrames: 34,
  expectedReferenceBindings: 25,
  filenameSuffix: "mv01-i2v-complete",
  packageDelivery: Object.freeze({ width: 1920, height: 804, aspect: "2.39:1" }),
  canonicalDelivery: Object.freeze({ width: 576, height: 1024, aspect: "9:16 portrait" })
});

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "finalizing"]);
const ALLOWED_PROJECT = "harrowing_of_hell";

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function stableHash(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value), "utf8"));
}

function normalizedRelative(value) {
  const result = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!result || result.includes("\0") || result.startsWith("/") || /^[A-Za-z]:/.test(result)) {
    throw new Error(`Unsafe package path: ${value || "empty"}`);
  }
  if (result.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe package path: ${value}`);
  }
  return result;
}

function safeSourcePath(root, relative) {
  const normalized = normalizedRelative(relative);
  const realRoot = fs.realpathSync(root);
  const candidate = path.resolve(realRoot, ...normalized.split("/"));
  if (!candidate.startsWith(`${realRoot}${path.sep}`) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Package file is missing or unsafe: ${relative}`);
  }
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${realRoot}${path.sep}`)) throw new Error(`Package file escapes its root: ${relative}`);
  return real;
}

function zipEntries(archiveBuffer) {
  const minimum = Math.max(0, archiveBuffer.length - 0xffff - 22);
  let eocd = -1;
  for (let offset = archiveBuffer.length - 22; offset >= minimum; offset -= 1) {
    if (archiveBuffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ZIP end-of-central-directory record was not found");
  const disk = archiveBuffer.readUInt16LE(eocd + 4);
  const directoryDisk = archiveBuffer.readUInt16LE(eocd + 6);
  const diskEntries = archiveBuffer.readUInt16LE(eocd + 8);
  const totalEntries = archiveBuffer.readUInt16LE(eocd + 10);
  const directoryBytes = archiveBuffer.readUInt32LE(eocd + 12);
  const directoryOffset = archiveBuffer.readUInt32LE(eocd + 16);
  if (disk || directoryDisk || diskEntries !== totalEntries || totalEntries === 0xffff || !totalEntries
    || directoryOffset + directoryBytes > eocd) {
    throw new Error("Multi-disk, empty, malformed, or ZIP64 archives are not accepted");
  }
  const entries = [];
  const seen = new Set();
  let cursor = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > archiveBuffer.length || archiveBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Malformed ZIP central directory");
    }
    const flags = archiveBuffer.readUInt16LE(cursor + 8);
    const method = archiveBuffer.readUInt16LE(cursor + 10);
    const compressedBytes = archiveBuffer.readUInt32LE(cursor + 20);
    const uncompressedBytes = archiveBuffer.readUInt32LE(cursor + 24);
    const nameBytes = archiveBuffer.readUInt16LE(cursor + 28);
    const extraBytes = archiveBuffer.readUInt16LE(cursor + 30);
    const commentBytes = archiveBuffer.readUInt16LE(cursor + 32);
    const externalAttributes = archiveBuffer.readUInt32LE(cursor + 38);
    const localOffset = archiveBuffer.readUInt32LE(cursor + 42);
    const rawName = archiveBuffer.subarray(cursor + 46, cursor + 46 + nameBytes).toString("utf8");
    if (rawName.includes("\\")) throw new Error(`ZIP entry uses a backslash path: ${rawName}`);
    const directory = rawName.endsWith("/");
    const name = normalizedRelative(directory ? rawName.slice(0, -1) : rawName);
    const collision = name.toLowerCase();
    if (seen.has(collision)) throw new Error(`ZIP contains a duplicate/case-colliding entry: ${name}`);
    seen.add(collision);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error(`ZIP contains a link or special file: ${name}`);
    if (flags & 1) throw new Error(`Encrypted ZIP entries are not accepted: ${name}`);
    if (!directory && method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    entries.push({ name, rawName, directory, flags, method, compressedBytes, uncompressedBytes, localOffset });
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  if (cursor !== directoryOffset + directoryBytes) throw new Error("ZIP central-directory length mismatch");
  return entries;
}

function extractVerifiedArchive(archivePath) {
  const realArchive = fs.realpathSync(archivePath);
  if (path.basename(realArchive).toLowerCase() !== PACKAGE_DEFINITION.archiveName.toLowerCase()) {
    throw new Error(`Archive basename must be exactly ${PACKAGE_DEFINITION.archiveName}`);
  }
  const stats = fs.statSync(realArchive);
  if (!stats.isFile() || stats.size !== PACKAGE_DEFINITION.archiveBytes) {
    throw new Error(`Unexpected MV01 archive byte size: ${stats.size}`);
  }
  const archiveBuffer = fs.readFileSync(realArchive);
  const archiveSha256 = sha256Buffer(archiveBuffer);
  if (archiveSha256 !== PACKAGE_DEFINITION.archiveSha256) throw new Error(`Unexpected MV01 archive SHA-256: ${archiveSha256}`);
  const entries = zipEntries(archiveBuffer);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-mv01-"));
  try {
    for (const entry of entries) {
      const destination = path.resolve(temporaryRoot, ...entry.name.split("/"));
      if (!destination.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error(`ZIP entry escaped extraction root: ${entry.name}`);
      if (entry.directory) { fs.mkdirSync(destination, { recursive: true }); continue; }
      if (entry.localOffset + 30 > archiveBuffer.length || archiveBuffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
        throw new Error(`Malformed ZIP local header: ${entry.name}`);
      }
      const localFlags = archiveBuffer.readUInt16LE(entry.localOffset + 6);
      const localMethod = archiveBuffer.readUInt16LE(entry.localOffset + 8);
      const localNameBytes = archiveBuffer.readUInt16LE(entry.localOffset + 26);
      const localExtraBytes = archiveBuffer.readUInt16LE(entry.localOffset + 28);
      const localName = archiveBuffer.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameBytes).toString("utf8");
      if (localName !== entry.rawName || localFlags !== entry.flags || localMethod !== entry.method) {
        throw new Error(`ZIP local/central header mismatch: ${entry.name}`);
      }
      const dataOffset = entry.localOffset + 30 + localNameBytes + localExtraBytes;
      const compressed = archiveBuffer.subarray(dataOffset, dataOffset + entry.compressedBytes);
      if (compressed.length !== entry.compressedBytes) throw new Error(`Truncated ZIP entry: ${entry.name}`);
      const content = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
      if (content.length !== entry.uncompressedBytes) throw new Error(`Uncompressed byte mismatch: ${entry.name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, { flag: "wx" });
    }
    const packageRoot = path.resolve(temporaryRoot, PACKAGE_DEFINITION.rootEntry);
    if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) throw new Error("MV01 package root is missing");
    return { archivePath: realArchive, archiveSha256, temporaryRoot, packageRoot, entries };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let index = 0; index <= source.length; index += 1) {
    const char = index === source.length ? "\n" : source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") {
      row.push(cell); cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted cell");
  const headers = rows.shift() || [];
  if (!headers.length || new Set(headers).size !== headers.length) throw new Error("CSV headers are missing or duplicated");
  return rows.map((cells) => {
    if (cells.length !== headers.length) throw new Error(`CSV row has ${cells.length} cells; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

function listValue(value) {
  const values = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error(`List contains a duplicate: ${value}`);
  return values;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("MV01 first-frame package contains a non-PNG image");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (width !== 1920 || height !== 804 || bitDepth !== 8 || colorType !== 2) {
    throw new Error(`MV01 first-frame PNG must be 1920x804 8-bit RGB; received ${width}x${height}, bit depth ${bitDepth}, color type ${colorType}`);
  }
  return { width, height, bitDepth, colorType };
}

function allPackageFiles(packageRoot, prefix = "") {
  const files = [];
  const directory = prefix ? path.join(packageRoot, ...prefix.split("/")) : packageRoot;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...allPackageFiles(packageRoot, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`MV01 package contains a non-regular entry: ${relative}`);
  }
  return files;
}

function verifyFullShaManifest(packageRoot) {
  const manifestFile = safeSourcePath(packageRoot, PACKAGE_DEFINITION.shaManifest);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.algorithm !== "SHA-256" || !Array.isArray(manifest.files)) throw new Error("MV01 SHA manifest has an invalid schema");
  const entries = new Map();
  for (const item of manifest.files) {
    const relative = normalizedRelative(item.path);
    const key = relative.toLowerCase();
    if (entries.has(key) || !/^[0-9a-f]{64}$/i.test(String(item.sha256)) || !Number.isInteger(Number(item.bytes)) || Number(item.bytes) < 0) {
      throw new Error(`MV01 SHA manifest contains an invalid or duplicate entry: ${relative}`);
    }
    const file = safeSourcePath(packageRoot, relative);
    const bytes = fs.statSync(file).size;
    const sha256 = sha256File(file);
    if (bytes !== Number(item.bytes) || sha256 !== String(item.sha256).toLowerCase()) throw new Error(`MV01 SHA manifest mismatch: ${relative}`);
    entries.set(key, { path: relative, sha256, bytes });
  }
  const actual = allPackageFiles(packageRoot).filter((item) => item !== PACKAGE_DEFINITION.shaManifest).map((item) => item.toLowerCase()).sort();
  const declared = [...entries.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error("MV01 SHA manifest does not exactly cover every package file except itself");
  return { manifest, entries, sha256: sha256File(manifestFile) };
}

function parsePromptPackage(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const headings = [...normalized.matchAll(/^##\s+(MV01-S\d{2}-C\d{2})\s+—\s+(segment-mv01-s\d{2}-c\d{2}-\d{2})\s*$/gm)];
  const prompts = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const clipId = headings[index][1];
    const segmentId = headings[index][2];
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end).trim();
    const timeline = body.match(/^- Timeline:\s*(\d+)–(\d+)\s+\(([\d.]+)\s+s at 24 fps\)\s*$/m);
    const firstFrame = body.match(/^- First frame:\s*`([^`]+)`\s*$/m);
    const referencesLine = body.match(/^- Source references:\s*(.+)\s*$/m);
    const beat = body.match(/^- Authored beat:\s*(.+)\s*$/m);
    const prompt = body.match(/^### Authoritative LTX prompt\s*\n+```text\s*\n([\s\S]*?)\n```\s*$/m);
    const treatment = body.match(/^### Frame-generation treatment\s*\n+([\s\S]+)$/m);
    if (!timeline || !firstFrame || !referencesLine || !beat || !prompt || !treatment || prompts.has(clipId)) {
      throw new Error(`MV01 prompt section is missing, malformed, or duplicated: ${clipId}`);
    }
    const references = /^none$/i.test(referencesLine[1].trim())
      ? []
      : [...referencesLine[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    if (!references.length && !/^none$/i.test(referencesLine[1].trim())) throw new Error(`MV01 prompt reference list is malformed: ${clipId}`);
    prompts.set(clipId, {
      clipId,
      segmentId,
      startFrame: Number(timeline[1]),
      endFrame: Number(timeline[2]),
      durationSeconds: Number(timeline[3]),
      firstFrame: normalizedRelative(firstFrame[1]),
      references,
      authoredBeat: beat[1].trim(),
      prompt: prompt[1].trim(),
      treatment: treatment[1].trim()
    });
  }
  if (prompts.size !== PACKAGE_DEFINITION.expectedClips) throw new Error(`MV01 prompts expected 34 sections; received ${prompts.size}`);
  return prompts;
}

function parseSourceReferences(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const heading = normalized.match(/^##\s+([^\s]+\.(?:png|jpe?g|webp))\s*$/m);
  const field = (label) => normalized.match(new RegExp(`^- ${label}:\\s*(.+)\\s*$`, "mi"))?.[1]?.trim() || null;
  if (!heading) throw new Error("MV01 source-reference declaration is missing");
  const versionText = field("Version")?.replace(/`/g, "");
  const versionMatch = versionText?.match(/^([^:]+):v(\d+)$/);
  const hash = field("SHA-256")?.replace(/`/g, "").toLowerCase();
  const packagedCopy = field("Packaged copy")?.replace(/`/g, "");
  const boundClips = String(field("Bound clips") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const requiredText = field("Required");
  if (!versionMatch || !/^[0-9a-f]{64}$/.test(hash || "") || !packagedCopy || !boundClips.length || !/^(?:true|false)$/i.test(requiredText || "")) {
    throw new Error("MV01 source-reference metadata is malformed");
  }
  return {
    filename: heading[1],
    role: field("Role"),
    useMode: field("Use mode"),
    required: /^true$/i.test(requiredText),
    assetId: field("Asset ID")?.replace(/`/g, ""),
    assetVersionId: versionText,
    assetVersion: Number(versionMatch[2]),
    cropGuidance: field("Crop guidance"),
    boundClips,
    packagedCopy: normalizedRelative(packagedCopy),
    sha256: hash
  };
}

function rowTiming(row) {
  const start = Number(row.start_frame);
  const length = Number(row.length_frames);
  const startSeconds = Number(row.start_seconds);
  const durationSeconds = Number(row.duration_seconds);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1 || !Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds)
    || Math.round(startSeconds * FPS) !== start || Math.round(durationSeconds * FPS) !== length) {
    throw new Error(`MV01 CSV timing is invalid: ${row.clip || "unknown clip"}`);
  }
  return { start, length };
}

function expectedFirstFrame(clipId) {
  return `first_frames/${clipId}_SEG01_FIRST.png`;
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of expected) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
}

function loadPackage(archivePath) {
  const extracted = extractVerifiedArchive(archivePath);
  try {
    const shaManifest = verifyFullShaManifest(extracted.packageRoot);
    const csvFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.csv);
    const promptsFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.prompts);
    const manifestFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.manifest);
    const sourcesFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.sources);
    const plansFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.videoPlans);
    const readmeFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.readme);
    const qaFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.qa);
    const contactSheetFile = safeSourcePath(extracted.packageRoot, PACKAGE_DEFINITION.contactSheet);
    const rows = parseCsv(fs.readFileSync(csvFile, "utf8"));
    const prompts = parsePromptPackage(fs.readFileSync(promptsFile, "utf8"));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const source = parseSourceReferences(fs.readFileSync(sourcesFile, "utf8"));
    const plans = JSON.parse(fs.readFileSync(plansFile, "utf8"));
    const readme = fs.readFileSync(readmeFile, "utf8");
    const qa = fs.readFileSync(qaFile, "utf8");
    if (rows.length !== 34 || !Array.isArray(plans) || plans.length !== 34 || !Array.isArray(manifest.segments) || manifest.segments.length !== 34) {
      throw new Error("MV01 package representations are not exactly 34 clips/segments/plans");
    }
    if (!/all 34 MV01 clips and all 34 timed-segment first frames/i.test(readme) || !/Frame canvas:\s*1920x804/i.test(readme)
      || !/Expected segment frames:\s*34/i.test(qa) || !/Present PNGs:\s*34/i.test(qa) || !/Result:\s*PASS/i.test(qa)) {
      throw new Error("MV01 README/QA contract differs from the fixed package counts or delivery");
    }
    if (manifest.chapter?.id !== "MV01" || Number(manifest.chapter?.number) !== 11 || manifest.schemaVersion !== "premiere316.storyboard.v1"
      || Number(manifest.fps) !== FPS || Number(manifest.delivery?.width) !== 1920 || Number(manifest.delivery?.height) !== 804
      || manifest.delivery?.aspect !== "2.39:1" || Number(manifest.sceneCount) !== 4 || Number(manifest.clipCount) !== 34
      || Number(manifest.timedSegmentCount) !== 34 || !Array.isArray(manifest.chapter?.sceneIds) || manifest.chapter.sceneIds.length !== 4) {
      throw new Error("MV01 package manifest has an invalid chapter/count/FPS/delivery contract");
    }
    const clipIds = rows.map((row) => row.clip);
    if (new Set(clipIds).size !== 34 || clipIds.some((clipId) => !/^MV01-S\d{2}-C\d{2}$/.test(clipId))) throw new Error("MV01 CSV clip IDs are missing or duplicated");
    if (new Set(rows.map((row) => row.segment_id)).size !== 34 || new Set(rows.map((row) => row.source_frame_id)).size !== 34
      || new Set(rows.map((row) => row.source_video_plan_id)).size !== 34 || new Set(rows.map((row) => row.first_frame.toLowerCase())).size !== 34) {
      throw new Error("MV01 CSV segment, frame, plan, or first-frame identities are duplicated");
    }
    if (new Set(plans.map((plan) => plan.clipId)).size !== 34 || JSON.stringify(plans.map((plan) => plan.clipId)) !== JSON.stringify(clipIds)) {
      throw new Error("MV01 video-plan order/coverage differs from its CSV");
    }
    const manifestByClip = new Map(manifest.segments.map((item) => [item.clipId, item]));
    if (manifestByClip.size !== 34 || JSON.stringify(manifest.segments.map((item) => item.clipId)) !== JSON.stringify(clipIds)) {
      throw new Error("MV01 manifest order/coverage differs from its CSV");
    }
    const planByClip = new Map(plans.map((plan) => [plan.clipId, plan]));
    const frameManifest = new Map();
    const promptsSeen = new Set();
    let referenceBindings = 0;
    for (const row of rows) {
      exactObjectKeys(row, ["chapter", "scene", "clip", "segment_id", "start_frame", "length_frames", "start_seconds", "duration_seconds", "first_frame", "references", "source_frame_id", "source_video_plan_id"], `MV01 CSV row ${row.clip}`);
      const clipId = row.clip;
      const timing = rowTiming(row);
      const firstFrame = normalizedRelative(row.first_frame);
      const references = listValue(row.references);
      if (row.chapter !== "MV01" || row.scene !== clipId.slice(0, 8) || timing.start !== 0 || firstFrame !== expectedFirstFrame(clipId)
        || row.segment_id !== `segment-${clipId.toLowerCase()}-01` || row.source_frame_id !== `frame-${clipId.toLowerCase()}-first`
        || row.source_video_plan_id !== `video-${clipId.toLowerCase()}`) {
        throw new Error(`MV01 CSV identity/path/timing is noncanonical: ${clipId}`);
      }
      const prompt = prompts.get(clipId);
      if (!prompt || prompt.segmentId !== row.segment_id || prompt.startFrame !== timing.start || prompt.endFrame !== timing.start + timing.length - 1
        || Math.round(prompt.durationSeconds * FPS) !== timing.length || prompt.firstFrame !== firstFrame
        || JSON.stringify(prompt.references) !== JSON.stringify(references) || !prompt.prompt.startsWith(prompt.authoredBeat)
        || !/2\.39:1 landscape/i.test(prompt.treatment)) {
        throw new Error(`MV01 Markdown/CSV prompt representation mismatch: ${clipId}`);
      }
      if (promptsSeen.has(prompt.prompt)) throw new Error(`MV01 prompt is duplicated: ${clipId}`);
      promptsSeen.add(prompt.prompt);
      const manifestSegment = manifestByClip.get(clipId);
      if (!manifestSegment || manifestSegment.chapter !== "MV01" || manifestSegment.sceneId !== row.scene || manifestSegment.segmentId !== row.segment_id
        || Number(manifestSegment.startFrame) !== timing.start || Number(manifestSegment.lengthFrames) !== timing.length
        || manifestSegment.firstFrame !== firstFrame || manifestSegment.sourceFrameId !== row.source_frame_id
        || manifestSegment.sourceVideoPlanId !== row.source_video_plan_id || JSON.stringify(manifestSegment.references || []) !== JSON.stringify(references)) {
        throw new Error(`MV01 JSON manifest/CSV mismatch: ${clipId}`);
      }
      const plan = planByClip.get(clipId);
      const timeline = plan?.timelineData?.segments;
      if (!plan || plan.id !== row.source_video_plan_id || plan.workflowProfileId !== "ltx25-music-video-24gb-distilled-int8"
        || plan.width !== 1920 || plan.height !== 804 || plan.fps !== FPS || plan.requestedFrames !== timing.length || plan.generationFrames !== timing.length + 1
        || JSON.stringify(plan.segmentIds) !== JSON.stringify([row.segment_id]) || plan.localPrompts !== prompt.prompt || plan.globalPrompt !== prompt.prompt
        || plan.timelineData?.global_prompt !== prompt.prompt || plan.segmentLengths !== String(timing.length)
        || plan.timelineData?.normalStartFrame !== 0 || plan.timelineData?.normalDurationFrames !== timing.length
        || !Array.isArray(timeline) || timeline.length !== 1 || timeline[0].id !== row.segment_id || timeline[0].start !== timing.start
        || timeline[0].length !== timing.length || timeline[0].prompt !== prompt.prompt || timeline[0].type !== "image"
        || timeline[0].frameId !== row.source_frame_id || timeline[0].projectMediaPath !== firstFrame
        || plan.packageFirstFramePath !== firstFrame || plan.sourceDelivery?.width !== 576 || plan.sourceDelivery?.height !== 1024
        || plan.sourceDelivery?.aspect !== "9:16 portrait" || plan.deliveryAspect !== "2.39:1" || !plan.packageAdaptation
        || !Array.isArray(plan.timelineData.audioSegments) || !Array.isArray(plan.timelineData.motionSegments)) {
        throw new Error(`MV01 video-plan/CSV/Markdown mismatch: ${clipId}`);
      }
      const sourceImage = safeSourcePath(extracted.packageRoot, firstFrame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const shaEntry = shaManifest.entries.get(firstFrame.toLowerCase());
      const sha256 = sha256Buffer(buffer);
      if (!shaEntry || shaEntry.sha256 !== sha256 || shaEntry.bytes !== buffer.length) throw new Error(`MV01 first-frame SHA mismatch: ${clipId}`);
      frameManifest.set(firstFrame, { ...dimensions, sha256, bytes: buffer.length });
      if (references.length > 1 || (references.length === 1 && references[0] !== source.filename)) throw new Error(`MV01 source-reference binding is invalid: ${clipId}`);
      referenceBindings += references.length;
    }
    const referencedClips = rows.filter((row) => listValue(row.references).length).map((row) => row.clip);
    if (referenceBindings !== 25 || JSON.stringify(referencedClips) !== JSON.stringify(source.boundClips)
      || source.filename !== "char-jesus-close.v3.png" || source.assetId !== "character-jesus-the-harrower-close-up"
      || source.assetVersion !== 3 || source.assetVersionId !== "character-jesus-the-harrower-close-up:v3"
      || source.role !== "identity" || source.useMode !== "identity_conditioning" || source.required !== true
      || source.packagedCopy !== "source_references/char-jesus-close.v3.png") {
      throw new Error("MV01 source-reference declarations differ from the 25 CSV bindings or expected exact asset version");
    }
    const sourceFile = safeSourcePath(extracted.packageRoot, source.packagedCopy);
    const sourceEntry = shaManifest.entries.get(source.packagedCopy.toLowerCase());
    if (!sourceEntry || sha256File(sourceFile) !== source.sha256 || sourceEntry.sha256 !== source.sha256 || sourceEntry.bytes !== fs.statSync(sourceFile).size) {
      throw new Error("MV01 packaged source reference differs from its Markdown/SHA declarations");
    }
    const contactSheetEntry = shaManifest.entries.get(PACKAGE_DEFINITION.contactSheet.toLowerCase());
    if (!contactSheetEntry || contactSheetEntry.sha256 !== sha256File(contactSheetFile)) throw new Error("MV01 contact-sheet hash is not authenticated");
    return {
      ...extracted,
      rows,
      clipIds,
      prompts,
      manifest,
      plans,
      planByClip,
      source,
      frameManifest,
      referenceBindings,
      consumedHashes: {
        csvSha256: sha256File(csvFile),
        promptsSha256: sha256File(promptsFile),
        packageManifestSha256: sha256File(manifestFile),
        sourceReferencesSha256: sha256File(sourcesFile),
        videoPlansSha256: sha256File(plansFile),
        fullShaManifestSha256: shaManifest.sha256,
        readmeSha256: sha256File(readmeFile),
        qaSha256: sha256File(qaFile),
        contactSheetSha256: sha256File(contactSheetFile),
        packagedSourceReferenceSha256: source.sha256,
        exactCoverFileCount: shaManifest.entries.size
      }
    };
  } catch (error) {
    fs.rmSync(extracted.temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function readProject(slug) {
  return JSON.parse(fs.readFileSync(path.join(projectDir(slug), "project.json"), "utf8"));
}

function exactProjectAsset(project, slug, source) {
  const matches = [];
  for (const asset of project.assets?.items || []) {
    for (const version of asset.versions || []) {
      for (const filename of new Set([version.file, ...(version.files || [])].filter(Boolean))) {
        if (filename !== source.filename) continue;
        const disk = path.join(projectDir(slug), "media", "assets", filename);
        if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) throw new Error(`MV01 source reference is missing from project media: ${filename}`);
        const bytes = fs.statSync(disk).size;
        const sha256 = sha256File(disk);
        const declared = (version.fileHashes || []).find((item) => item.file === filename);
        if (declared?.bytes != null && Number(declared.bytes) !== bytes) throw new Error(`Project source-reference byte mismatch: ${filename}`);
        if (declared?.sha256 && String(declared.sha256).toLowerCase() !== sha256) throw new Error(`Project source-reference hash mismatch: ${filename}`);
        matches.push({
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
  if (matches.length !== 1) throw new Error(`MV01 source reference must resolve to exactly one project asset version; received ${matches.length}`);
  const match = matches[0];
  if (match.assetId !== source.assetId || match.assetVersion !== source.assetVersion || match.assetVersionId !== source.assetVersionId || match.sha256 !== source.sha256) {
    throw new Error("MV01 packaged source reference differs from the exact project asset version");
  }
  return match;
}

function sourceReferencesForRow(row, packageData, asset) {
  if (!listValue(row.references).length) return [];
  return [{
    ...asset,
    role: packageData.source.role,
    required: packageData.source.required,
    sourceNotes: packageData.source.cropGuidance,
    sourceRelation: "loaded_for_generated_frame",
    storyboardDeclared: false,
    loadedForGeneratedFrame: true
  }];
}

function frameReferences(frameId, sourceReferences) {
  return sourceReferences.map((reference, index) => ({
    id: `ref-${frameId}-${index + 1}`,
    assetId: reference.assetId,
    assetVersion: reference.assetVersion,
    assetVersionId: reference.assetVersionId,
    sourceAssetFile: reference.sourceAssetFile,
    canonicalFile: reference.sourceAssetFile,
    sourceAssetKey: reference.sourceAssetFile.replace(/\.[^.]+$/, ""),
    resolutionStatus: "resolved_exact_version",
    role: reference.role,
    targetKind: "frame",
    targetId: frameId,
    useMode: "first_frame_source_provenance",
    sourceRelation: reference.sourceRelation,
    storyboardDeclared: false,
    loadedForGeneratedFrame: true,
    required: reference.required,
    order: index + 1,
    cropRegion: "Provenance/display only; never use this semantic source as a temporal guide or direct runtime conditioning input.",
    notes: `MV01 complete-package provenance. ${reference.sourceNotes || ""}`.trim(),
    pinnedActiveAtImport: reference.pinnedActiveAtImport
  }));
}

function receiptReferences(sourceReferences) {
  return sourceReferences.map((reference) => ({
    assetId: reference.assetId,
    assetVersion: reference.assetVersion,
    assetVersionId: reference.assetVersionId,
    sourceAssetFile: reference.sourceAssetFile,
    sha256: reference.sha256,
    bytes: reference.bytes,
    role: reference.role,
    required: reference.required,
    sourceRelation: reference.sourceRelation,
    storyboardDeclared: reference.storyboardDeclared,
    loadedForGeneratedFrame: reference.loadedForGeneratedFrame,
    pinnedActiveAtImport: reference.pinnedActiveAtImport
  }));
}

function targetSets(storyboard, clipIds) {
  const plans = new Set(clipIds.map((clipId) => storyboard.clips?.[clipId]?.videoPlanId).filter(Boolean));
  const segments = new Set([...plans].flatMap((planId) => storyboard.videoPlans?.[planId]?.segmentIds || []));
  return { clips: new Set(clipIds), plans, segments };
}

function nonTargetSnapshot(storyboard, targets) {
  return {
    schemaVersion: storyboard.schemaVersion,
    storyboardId: storyboard.storyboardId,
    projectId: storyboard.projectId,
    title: storyboard.title,
    source: storyboard.source,
    defaults: storyboard.defaults,
    workflowProfile: storyboard.workflowProfile,
    runtimeFrames: storyboard.runtimeFrames,
    imports: Object.fromEntries(Object.entries(storyboard.imports || {}).filter(([id]) => id !== PACKAGE_ID)),
    chapterOrder: storyboard.chapterOrder,
    chapters: storyboard.chapters,
    scenes: storyboard.scenes,
    clips: Object.fromEntries(Object.entries(storyboard.clips || {}).filter(([id]) => !targets.clips.has(id))),
    videoPlans: Object.fromEntries(Object.entries(storyboard.videoPlans || {}).filter(([id]) => !targets.plans.has(id))),
    segments: Object.fromEntries(Object.entries(storyboard.segments || {}).filter(([id]) => !targets.segments.has(id))),
    frames: Object.fromEntries(Object.entries(storyboard.frames || {}).filter(([, frame]) => !targets.clips.has(frame?.ownerId) && !targets.segments.has(frame?.ownerId))),
    referenceBindings: Object.fromEntries(Object.entries(storyboard.referenceBindings || {}).filter(([, binding]) => {
      if (binding?.targetKind !== "frame") return true;
      const frame = storyboard.frames?.[binding.targetId];
      return !targets.clips.has(frame?.ownerId) && !targets.segments.has(frame?.ownerId);
    }))
  };
}

function invariantSnapshot(storyboard, targets) {
  const clips = {};
  for (const clipId of targets.clips) {
    const value = structuredClone(storyboard.clips[clipId]);
    for (const key of ["firstFrameId", "generationMode", "referenceMode", "renderStatus", "renderError", "shotSizeLens"]) delete value[key];
    value.continuityLocks = (value.continuityLocks || []).filter((lock) => !isPortraitCanvasLock(lock));
    clips[clipId] = value;
  }
  const plans = {};
  for (const planId of targets.plans) {
    const value = structuredClone(storyboard.videoPlans[planId]);
    for (const key of ["generationMode", "referenceMode", "workflowProfileId", "globalPrompt", "negativePrompt", "localPrompts", "segmentLengths",
      "guideStrength", "resizeMethod", "width", "height", "fps", "status", "inputHash", "activeGeneratedVersion", "generatedFile",
      "generatedInputPath", "lastError", "activeRenderPromptId", "renderQueuedAt", "firstFramePackage", "sourceDelivery", "deliveryAspect",
      "packageFirstFramePath", "packageAdaptation"]) delete value[key];
    if (value.timelineData) for (const key of ["global_prompt", "normalStartFrame", "normalDurationFrames", "segments"]) delete value.timelineData[key];
    plans[planId] = value;
  }
  const segments = {};
  for (const segmentId of targets.segments) {
    const value = structuredClone(storyboard.segments[segmentId]);
    for (const key of ["prompt", "type", "frameId", "isEndFrame", "status"]) delete value[key];
    segments[segmentId] = value;
  }
  return { clips, plans, segments };
}

function orderedChapterClipIds(storyboard) {
  const chapter = storyboard.chapters?.MV01;
  if (!chapter) throw new Error("Current storyboard chapter MV01 is missing");
  return (chapter.sceneIds || []).flatMap((sceneId) => storyboard.scenes?.[sceneId]?.clipIds || []);
}

function normalizedRuntimePrompt(sourcePrompt) {
  const prompt = String(sourcePrompt || "")
    .replace(/native portrait 9:16 at 576x1024/gi, "native cinematic 2.39:1 landscape at 1920x804")
    .replace(/vertical 9:16\s+wide-to-medium/gi, "cinematic 2.39:1 landscape wide-to-medium")
    .replace(/tall symmetrical 9:16 composition/gi, "wide symmetrical 2.39:1 landscape composition")
    .replace(/locked portrait composition/gi, "locked 2.39:1 landscape composition")
    .replace(/portrait composition/gi, "2.39:1 landscape composition")
    .replace(/\bportrait\b/gi, "close-up");
  if (/(?:576x1024|9:16|\bportrait\b)/i.test(prompt)) {
    throw new Error("MV01 runtime prompt still contains a superseded portrait-canvas instruction");
  }
  return prompt;
}

function isPortraitCanvasLock(lock) {
  return /(?:portrait|576x1024|9:16|landscape\s+1920x804|1920x804.{0,24}2\.39:1)/i.test(String(lock));
}

function runtimeContinuityLock(lock) {
  return isPortraitCanvasLock(lock)
    ? "Landscape 1920x804, 2.39:1"
    : String(lock);
}

function normalizedGlobalPrompt(packagePlan, clip) {
  return [
    `PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — ${clip.id}`,
    "FIRST-FRAME AUTHORITY: Generate only this clip's single selected segment from its supplied first frame. Semantic source references are provenance/display only.",
    "AUTHORIZED PACKAGE DELIVERY: the supplied temporal guide and this plan use 1920x804 landscape (2.39:1). This is the sole runtime canvas.",
    "",
    "PACKAGE AUTHORITATIVE LTX PROMPT",
    normalizedRuntimePrompt(packagePlan.globalPrompt),
    "",
    "CURRENT CANONICAL CONTINUITY LOCKS — PRESERVED; CANVAS LOCK NORMALIZED TO AUTHORIZED DELIVERY",
    ...(clip.continuityLocks || []).map((lock) => `- ${runtimeContinuityLock(lock)}`),
    "",
    "GENERATION CONTRACT: SEGMENTED IMAGE-TO-VIDEO. Begin exactly from the selected 1920x804 first frame, execute only its local prompt, and do not substitute semantic references as temporal guides."
  ].join("\n");
}

function validateStoryboardMapping(storyboard, packageData) {
  const currentOrder = orderedChapterClipIds(storyboard);
  if (JSON.stringify(currentOrder) !== JSON.stringify(packageData.clipIds)) throw new Error("MV01 package/current canonical clip order differs");
  if (JSON.stringify(storyboard.chapters.MV01.sceneIds) !== JSON.stringify(packageData.manifest.chapter.sceneIds)) throw new Error("MV01 package/current scene order differs");
  const contexts = [];
  for (const row of packageData.rows) {
    const clip = storyboard.clips?.[row.clip];
    const plan = clip && storyboard.videoPlans?.[clip.videoPlanId];
    const segmentId = plan?.segmentIds?.[0];
    const segment = storyboard.segments?.[segmentId];
    const packagePlan = packageData.planByClip.get(row.clip);
    const timing = rowTiming(row);
    if (!clip || !plan || !segment || !packagePlan || plan.clipId !== row.clip || plan.id !== row.source_video_plan_id
      || plan.segmentIds.length !== 1 || segment.id !== row.segment_id || segment.startFrame !== timing.start || segment.lengthFrames !== timing.length
      || clip.durationFrames !== timing.length || plan.requestedFrames !== timing.length || plan.generationFrames !== timing.length + 1) {
      throw new Error(`MV01 package/current clip-plan-segment mapping differs: ${row.clip}`);
    }
    if (stableHash(packagePlan.timelineData.audioSegments) !== stableHash(plan.timelineData?.audioSegments || [])
      || stableHash(packagePlan.timelineData.motionSegments) !== stableHash(plan.timelineData?.motionSegments || [])) {
      throw new Error(`MV01 package/current audio or motion timeline differs: ${row.clip}`);
    }
    const globalPrompt = normalizedGlobalPrompt(packagePlan, clip);
    for (const lock of clip.continuityLocks || []) {
      if (!globalPrompt.includes(`- ${runtimeContinuityLock(lock)}`)) throw new Error(`MV01 projected prompt loses a canonical continuity lock: ${row.clip}`);
    }
    const prompt = packageData.prompts.get(row.clip);
    contexts.push({ row, clip, plan, segment, segmentId, packagePlan, prompt, runtimePrompt: normalizedRuntimePrompt(prompt.prompt) });
  }
  return contexts;
}

function activeProjectJobs(slug) {
  const active = [];
  for (const filename of ["generation-jobs.json", "director-generation-jobs.json"]) {
    const file = path.join(projectDir(slug), filename);
    if (!fs.existsSync(file)) continue;
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`Cannot safely parse generation ledger ${file}: ${error.message}`); }
    if (!Array.isArray(ledger.jobs)) throw new Error(`Generation ledger has an unexpected shape: ${file}`);
    for (const job of ledger.jobs) {
      const jobSlug = job.projectSlug || job.refs?.projectSlug || job.refs?.binding?.projectSlug;
      if (ACTIVE_STATUSES.has(job.status) && (!jobSlug || jobSlug === slug)) active.push(`${filename}:${job.id}:${job.status}`);
    }
  }
  return active;
}

function getJsonSync(url) {
  const response = spawnSync("curl.exe", ["--silent", "--show-error", "--fail", "--max-time", "4", url], {
    encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024
  });
  if (response.error || response.status !== 0) {
    throw new Error(`Live queue preflight failed closed for ${url}: ${response.error?.message || response.stderr?.trim() || `curl exit ${response.status}`}`);
  }
  try { return JSON.parse(response.stdout); }
  catch { throw new Error(`Live queue preflight returned invalid JSON: ${url}`); }
}

function liveQueuePreflight() {
  const results = {};
  for (const url of ["http://127.0.0.1:8188/queue", "http://127.0.0.1:8789/api/queue", "http://127.0.0.1:8791/api/queue"]) {
    const queue = getJsonSync(url);
    if (Array.isArray(queue.queue_running) && Array.isArray(queue.queue_pending)) {
      if (queue.queue_running.length || queue.queue_pending.length) {
        throw new Error(`Cannot update MV01 while a ComfyUI queue is busy (${url}: ${queue.queue_running.length} running, ${queue.queue_pending.length} pending)`);
      }
      results[url] = "empty_comfy_queue";
    } else if (Array.isArray(queue.jobs)) {
      const active = queue.jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
      if (active.length) throw new Error(`Cannot update MV01 while an app queue has an active job (${url}): ${active.map((job) => `${job.id}:${job.status}`).join(", ")}`);
      results[url] = "no_active_app_jobs";
    } else throw new Error(`Live queue response has an unexpected shape: ${url}`);
  }
  return results;
}

function frameIdFor(clipId) {
  return `frame-${clipId.toLowerCase()}-first`;
}

function baseNameFor(clipId) {
  return `${clipId}_first`;
}

function nextMediaVersion(mediaDirectory, baseName, existingFrame) {
  let maximum = Math.max(0, ...(existingFrame?.generatedVersions || []).map((item) => Number(item.v) || 0));
  const expression = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.v(\\d+)(?:\\..+)?\\.(?:png|jpe?g|webp)$`, "i");
  if (fs.existsSync(mediaDirectory)) {
    for (const filename of fs.readdirSync(mediaDirectory)) {
      const match = filename.match(expression);
      if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
    }
  }
  return maximum + 1;
}

function packageReceiptMetadata(packageData) {
  return {
    chapterId: "MV01",
    archiveFile: path.basename(packageData.archivePath),
    archiveSha256: packageData.archiveSha256,
    archiveBytes: PACKAGE_DEFINITION.archiveBytes,
    ...packageData.consumedHashes,
    clips: packageData.clipIds.length,
    frames: packageData.rows.length,
    referenceBindings: packageData.referenceBindings,
    packageDelivery: PACKAGE_DEFINITION.packageDelivery,
    canonicalDelivery: PACKAGE_DEFINITION.canonicalDelivery,
    landscapeOverrideRequired: true
  };
}

function verifyImportedState(storyboard, mediaDirectory, receipt, packageData, asset) {
  validateStoryboard(storyboard, ALLOWED_PROJECT);
  if (receipt.packageId !== PACKAGE_ID || receipt.archiveSha256 !== PACKAGE_DEFINITION.archiveSha256
    || receipt.frames?.length !== 34 || receipt.clipIds?.length !== 34 || new Set(receipt.clipIds).size !== 34) {
    throw new Error("MV01 import receipt identity/count/hash is invalid");
  }
  if (receipt.frames.reduce((sum, item) => sum + Number(item.sourceReferenceCount || 0), 0) !== 25) throw new Error("MV01 receipt does not contain 25 exact source-reference bindings");
  if (stableHash(receipt.package) !== stableHash(packageReceiptMetadata(packageData))) throw new Error("MV01 receipt package metadata differs from the fixed archive");
  const targets = targetSets(storyboard, receipt.clipIds);
  if (stableHash(nonTargetSnapshot(storyboard, targets)) !== receipt.nonTargetSnapshotSha256) throw new Error("MV01 import changed non-target storyboard state");
  if (stableHash(invariantSnapshot(storyboard, targets)) !== receipt.targetInvariantSha256) throw new Error("MV01 import changed protected timing/order/audio/motion/history/reference/continuity state");
  const receiptByClip = new Map(receipt.frames.map((item) => [item.clipId, item]));
  for (const row of packageData.rows) {
    const item = receiptByClip.get(row.clip);
    const clip = storyboard.clips[row.clip];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    const segment = storyboard.segments[row.segment_id];
    const frame = storyboard.frames[row.source_frame_id];
    const packagePlan = packageData.planByClip.get(row.clip);
    const prompt = packageData.prompts.get(row.clip);
    const runtimePrompt = normalizedRuntimePrompt(prompt.prompt);
    const packageFrame = packageData.frameManifest.get(row.first_frame);
    if (!item || !clip || !plan || !segment || !frame || item.segmentId !== row.segment_id || item.frameId !== row.source_frame_id
      || item.sourceEntry !== row.first_frame || item.sha256 !== packageFrame.sha256 || item.bytes !== packageFrame.bytes
      || item.sourcePrompt !== prompt.prompt || item.sourcePromptHash !== sha256Buffer(Buffer.from(prompt.prompt, "utf8")) || item.prompt !== runtimePrompt
      || segment.frameId !== frame.id || segment.type !== "image" || segment.prompt !== runtimePrompt || segment.status !== "ready"
      || frame.ownerKind !== "clip" || frame.ownerId !== row.clip || frame.activeGeneratedVersion !== item.version || frame.generatedFile !== item.filename
      || frame.inputHash !== item.sha256 || frame.prompt !== item.prompt) {
      throw new Error(`MV01 imported frame/segment state differs: ${row.clip}`);
    }
    const version = (frame.generatedVersions || []).find((candidate) => Number(candidate.v) === Number(item.version) && candidate.file === item.filename);
    if (!version || version.promptHash !== item.promptHash || version.sourceArchiveSha256 !== receipt.archiveSha256
      || version.sourceEntry !== item.sourceEntry || version.fileHashes?.[0]?.sha256 !== item.sha256 || version.fileHashes?.[0]?.bytes !== item.bytes
      || stableHash((frame.generatedVersions || []).filter((candidate) => candidate !== version)) !== item.priorGeneratedVersionsSha256) {
      throw new Error(`MV01 imported frame history differs: ${row.clip}`);
    }
    const expectedSourceReferences = sourceReferencesForRow(row, packageData, asset);
    const expectedBindings = frameReferences(frame.id, expectedSourceReferences);
    const bindings = Object.values(storyboard.referenceBindings || {}).filter((binding) => binding.targetKind === "frame" && binding.targetId === frame.id).sort((a, b) => a.order - b.order);
    if (stableHash(frame.references || []) !== stableHash(expectedBindings) || stableHash(bindings) !== stableHash(expectedBindings)
      || stableHash(item.sourceReferences) !== stableHash(receiptReferences(expectedSourceReferences))) {
      throw new Error(`MV01 imported exact-version provenance differs: ${row.clip}`);
    }
    const timeline = plan.timelineData?.segments?.[0];
    if (clip.firstFrameId !== frame.id || clip.generationMode !== "i2v_segmented_first_frames" || clip.referenceMode !== "segment_first_frames"
      || plan.generationMode !== "i2v_segmented_first_frames" || plan.referenceMode !== "segment_first_frames"
      || plan.workflowProfileId !== packagePlan.workflowProfileId || plan.width !== 1920 || plan.height !== 804 || plan.fps !== FPS
      || plan.globalPrompt !== normalizedGlobalPrompt(packagePlan, clip) || plan.negativePrompt !== packagePlan.negativePrompt
      || plan.localPrompts !== runtimePrompt || plan.segmentLengths !== String(segment.lengthFrames) || plan.guideStrength !== packagePlan.guideStrength
      || plan.sourceDelivery?.width !== 576 || plan.sourceDelivery?.height !== 1024 || plan.deliveryAspect !== "2.39:1"
      || plan.packageFirstFramePath !== row.first_frame || plan.packageAdaptation !== packagePlan.packageAdaptation
      || plan.timelineData?.global_prompt !== plan.globalPrompt || plan.timelineData?.normalStartFrame !== 0
      || plan.timelineData?.normalDurationFrames !== clip.durationFrames || plan.timelineData?.segments?.length !== 1
      || timeline.id !== segment.id || timeline.start !== segment.startFrame || timeline.length !== segment.lengthFrames || timeline.prompt !== segment.prompt
      || timeline.type !== "image" || timeline.fileName !== item.filename || timeline.storyboardFrameId !== frame.id || timeline.imageFile !== frame.expectedInputPath) {
      throw new Error(`MV01 imported I2V plan/delivery state differs: ${row.clip}`);
    }
    for (const lock of clip.continuityLocks || []) if (!plan.globalPrompt.includes(`- ${runtimeContinuityLock(lock)}`)) throw new Error(`MV01 imported prompt lost a continuity lock: ${row.clip}`);
    if (/(?:576x1024|9:16|\bportrait\b)/i.test(`${plan.globalPrompt}\n${plan.localPrompts}\n${segment.prompt}\n${clip.shotSizeLens}\n${(clip.continuityLocks || []).join("\n")}`)) {
      throw new Error(`MV01 imported runtime prompts retain a superseded portrait-canvas instruction: ${row.clip}`);
    }
    const disk = path.join(mediaDirectory, item.filename);
    if (path.basename(item.filename) !== item.filename || !disk.startsWith(`${mediaDirectory}${path.sep}`) || !fs.existsSync(disk)
      || fs.statSync(disk).size !== item.bytes || sha256File(disk) !== item.sha256) throw new Error(`MV01 imported media verification failed: ${item.filename}`);
  }
  if (receipt.backup) {
    const backup = path.resolve(projectDir(ALLOWED_PROJECT), ...receipt.backup.split("/"));
    const backupRoot = path.join(projectDir(ALLOWED_PROJECT), "production", "backups");
    if (!backup.startsWith(`${backupRoot}${path.sep}`) || !fs.existsSync(backup) || sha256File(backup) !== receipt.sourceStoryboardSha256) {
      throw new Error("MV01 import backup is missing, unsafe, or differs from the source storyboard hash");
    }
  }
  return true;
}

export function defaultArchivePath() {
  return path.join(os.homedir(), "Downloads", PACKAGE_DEFINITION.archiveName);
}

export function inspectMV01Package({ archivePath = defaultArchivePath() } = {}) {
  const packageData = loadPackage(archivePath);
  try {
    return {
      ok: true,
      packageId: PACKAGE_ID,
      chapterId: "MV01",
      archivePath: packageData.archivePath,
      archiveSha256: packageData.archiveSha256,
      archiveBytes: PACKAGE_DEFINITION.archiveBytes,
      clips: packageData.clipIds.length,
      frames: packageData.rows.length,
      uniquePrompts: new Set([...packageData.prompts.values()].map((item) => item.prompt)).size,
      referenceBindings: packageData.referenceBindings,
      exactCoverFileCount: packageData.consumedHashes.exactCoverFileCount,
      packageDelivery: PACKAGE_DEFINITION.packageDelivery,
      canonicalDelivery: PACKAGE_DEFINITION.canonicalDelivery,
      deliveryConflict: true,
      landscapeOverrideRequired: true,
      hashes: packageData.consumedHashes
    };
  } finally {
    fs.rmSync(packageData.temporaryRoot, { recursive: true, force: true });
  }
}

export function importMV01Ltx25I2vComplete({
  archivePath = defaultArchivePath(),
  projectSlug = ALLOWED_PROJECT,
  now = new Date(),
  dryRun = false,
  allowLandscape = false
} = {}) {
  if (!allowLandscape) {
    throw new Error("MV01 package is 1920x804 landscape while the canonical plans are 576x1024 portrait. Verification/apply is blocked unless --allow-landscape (allowLandscape: true) is explicit.");
  }
  if (projectSlug !== ALLOWED_PROJECT) throw new Error(`MV01 package is scoped only to ${ALLOWED_PROJECT}`);
  const packageData = loadPackage(archivePath);
  try {
    const storyboard = loadStoryboard(projectSlug);
    const storyboardFile = storyboardPath(projectSlug);
    const startingStoryboardSha256 = sha256File(storyboardFile);
    const contexts = validateStoryboardMapping(storyboard, packageData);
    const targets = targetSets(storyboard, packageData.clipIds);
    const beforeNonTargetHash = stableHash(nonTargetSnapshot(storyboard, targets));
    const beforeInvariantHash = stableHash(invariantSnapshot(storyboard, targets));
    const project = readProject(projectSlug);
    const asset = exactProjectAsset(project, projectSlug, packageData.source);
    const active = activeProjectJobs(projectSlug);
    if (active.length) throw new Error(`Cannot update MV01 while generation is active: ${active.join(", ")}`);
    for (const { clip, plan } of contexts) {
      if (ACTIVE_STATUSES.has(clip.renderStatus) || ACTIVE_STATUSES.has(plan.status) || plan.activeRenderPromptId) throw new Error(`Cannot update active MV01 plan: ${clip.id}`);
    }
    const livePreflight = liveQueuePreflight();
    const priorReceipt = storyboard.imports?.[PACKAGE_ID];
    if (priorReceipt) {
      if (priorReceipt.archiveSha256 !== packageData.archiveSha256) throw new Error(`${PACKAGE_ID} already exists with a different archive hash`);
      verifyImportedState(storyboard, path.join(projectDir(projectSlug), "media", "storyboard"), priorReceipt, packageData, asset);
      return { dryRun, idempotent: true, storyboard, receipt: priorReceipt, backup: priorReceipt.backup || null };
    }

    const mediaDirectory = path.join(projectDir(projectSlug), "media", "storyboard");
    const prepared = contexts.map((context) => {
      const sourceImage = safeSourcePath(packageData.packageRoot, context.row.first_frame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const sha256 = sha256Buffer(buffer);
      const expected = packageData.frameManifest.get(context.row.first_frame);
      if (!expected || expected.sha256 !== sha256 || expected.bytes !== buffer.length) throw new Error(`MV01 prepared frame hash mismatch: ${context.clip.id}`);
      return {
        ...context,
        sourceImage,
        buffer,
        dimensions,
        sha256,
        frameId: frameIdFor(context.clip.id),
        sourceReferences: sourceReferencesForRow(context.row, packageData, asset)
      };
    });

    let backup = null;
    let preBackupLivePreflight = null;
    if (!dryRun) {
      const activeBeforeBackup = activeProjectJobs(projectSlug);
      if (activeBeforeBackup.length) throw new Error(`MV01 generation became active before backup: ${activeBeforeBackup.join(", ")}`);
      preBackupLivePreflight = liveQueuePreflight();
      if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed before MV01 backup; import aborted");
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      const backupDirectory = path.join(projectDir(projectSlug), "production", "backups");
      fs.mkdirSync(backupDirectory, { recursive: true });
      backup = path.join(backupDirectory, `storyboard.before-mv01-ltx25-i2v-complete.${stamp}.json`);
      fs.copyFileSync(storyboardFile, backup, fs.constants.COPYFILE_EXCL);
      if (sha256File(backup) !== startingStoryboardSha256) {
        try { fs.unlinkSync(backup); } catch {}
        throw new Error("MV01 backup hash differs from the source storyboard");
      }
      fs.mkdirSync(mediaDirectory, { recursive: true });
    }

    const next = structuredClone(storyboard);
    const createdFiles = [];
    let storyboardSaved = false;
    const receipt = {
      packageId: PACKAGE_ID,
      importedAt: now.toISOString(),
      landscapeOverrideAccepted: true,
      sourceStoryboardSha256: startingStoryboardSha256,
      archiveSha256: packageData.archiveSha256,
      archiveHashes: { MV01: packageData.archiveSha256 },
      livePreflight,
      preBackupLivePreflight,
      backup: backup ? path.relative(projectDir(projectSlug), backup).replace(/\\/g, "/") : null,
      nonTargetSnapshotSha256: beforeNonTargetHash,
      targetInvariantSha256: beforeInvariantHash,
      clipIds: [...packageData.clipIds],
      package: packageReceiptMetadata(packageData),
      frames: []
    };
    try {
      for (const item of prepared) {
        const existingFrame = next.frames[item.frameId] || null;
        const frameBase = baseNameFor(item.clip.id);
        const version = nextMediaVersion(mediaDirectory, frameBase, existingFrame);
        const filename = `${frameBase}.v${version}.${PACKAGE_DEFINITION.filenameSuffix}.png`;
        const destination = path.join(mediaDirectory, filename);
        if (!dryRun) { fs.writeFileSync(destination, item.buffer, { flag: "wx" }); createdFiles.push(destination); }
        const promptHash = sha256Buffer(Buffer.from(item.runtimePrompt, "utf8"));
        const sourcePromptHash = sha256Buffer(Buffer.from(item.prompt.prompt, "utf8"));
        const priorVersions = [...(existingFrame?.generatedVersions || [])];
        const versionRecord = {
          v: version,
          files: [filename],
          file: filename,
          mediaType: "image",
          source: PACKAGE_ID,
          sourceArchive: path.basename(packageData.archivePath),
          sourceArchiveSha256: packageData.archiveSha256,
          sourceEntry: item.row.first_frame,
          sourceFileName: path.basename(item.sourceImage),
          prompt: item.runtimePrompt,
          promptHash,
          sourcePrompt: item.prompt.prompt,
          sourcePromptHash,
          width: item.dimensions.width,
          height: item.dimensions.height,
          workflowId: null,
          workflowHash: null,
          provenanceType: "external_package_import_no_embedded_generation_metadata",
          sourceReferenceAssets: item.sourceReferences,
          fileHashes: [{ file: filename, sha256: item.sha256, bytes: item.buffer.length, extension: ".png" }],
          createdAt: now.toISOString()
        };
        const references = frameReferences(item.frameId, item.sourceReferences);
        next.frames[item.frameId] = {
          ...(existingFrame || {}),
          id: item.frameId,
          purpose: "first_frame",
          ownerKind: "clip",
          ownerId: item.clip.id,
          prompt: item.runtimePrompt,
          negativePrompt: item.packagePlan.negativePrompt || "",
          status: "generated",
          expectedInputPath: `Premiere316/${projectSlug}/storyboard/${frameBase}.png`,
          generatedVersions: [...priorVersions, versionRecord],
          activeGeneratedVersion: version,
          generatedFile: filename,
          generatedInputPath: `media/storyboard/${filename}`,
          generatedAssetId: item.frameId,
          generatedAssetVersionId: `${item.frameId}:v${version}`,
          inputHash: item.sha256,
          lastError: null,
          references,
          importProvenance: {
            packageId: PACKAGE_ID,
            archiveSha256: packageData.archiveSha256,
            sourceEntry: item.row.first_frame,
            sourceReferenceAssets: item.sourceReferences
          }
        };
        for (const [bindingId, binding] of Object.entries(next.referenceBindings || {})) {
          if (binding?.targetKind === "frame" && binding.targetId === item.frameId) delete next.referenceBindings[bindingId];
        }
        for (const reference of references) {
          const collision = next.referenceBindings[reference.id];
          if (collision && (collision.targetKind !== "frame" || collision.targetId !== item.frameId)) throw new Error(`MV01 reference-binding ID collides: ${reference.id}`);
          next.referenceBindings[reference.id] = { ...reference };
        }
        const segment = next.segments[item.segmentId];
        segment.prompt = item.runtimePrompt;
        segment.type = "image";
        segment.frameId = item.frameId;
        segment.isEndFrame = false;
        segment.status = "ready";
        receipt.frames.push({
          clipId: item.clip.id,
          segmentId: item.segmentId,
          segmentNumber: 1,
          frameId: item.frameId,
          sourceEntry: item.row.first_frame,
          filename,
          version,
          width: item.dimensions.width,
          height: item.dimensions.height,
          bytes: item.buffer.length,
          sha256: item.sha256,
          prompt: item.runtimePrompt,
          promptHash,
          sourcePrompt: item.prompt.prompt,
          sourcePromptHash,
          startFrame: segment.startFrame,
          lengthFrames: segment.lengthFrames,
          archiveSha256: packageData.archiveSha256,
          sourceReferenceCount: item.sourceReferences.length,
          sourceReferences: receiptReferences(item.sourceReferences),
          priorGeneratedVersions: priorVersions.length,
          priorGeneratedVersionsSha256: stableHash(priorVersions)
        });
      }

      for (const item of prepared) {
        const clip = next.clips[item.clip.id];
        const plan = next.videoPlans[clip.videoPlanId];
        const frame = next.frames[item.frameId];
        clip.firstFrameId = item.frameId;
        clip.generationMode = "i2v_segmented_first_frames";
        clip.referenceMode = "segment_first_frames";
        clip.shotSizeLens = "Landscape 1920x804, 2.39:1";
        clip.continuityLocks = (clip.continuityLocks || []).map(runtimeContinuityLock);
        clip.renderStatus = "not_started";
        delete clip.renderError;
        plan.generationMode = "i2v_segmented_first_frames";
        plan.referenceMode = "segment_first_frames";
        plan.workflowProfileId = item.packagePlan.workflowProfileId;
        plan.globalPrompt = normalizedGlobalPrompt(item.packagePlan, clip);
        plan.negativePrompt = item.packagePlan.negativePrompt;
        plan.localPrompts = item.runtimePrompt;
        plan.segmentLengths = String(item.segment.lengthFrames);
        plan.guideStrength = item.packagePlan.guideStrength;
        plan.resizeMethod = item.packagePlan.resizeMethod;
        plan.width = 1920;
        plan.height = 804;
        plan.fps = FPS;
        plan.sourceDelivery = structuredClone(item.packagePlan.sourceDelivery);
        plan.deliveryAspect = item.packagePlan.deliveryAspect;
        plan.packageFirstFramePath = item.row.first_frame;
        plan.packageAdaptation = item.packagePlan.packageAdaptation;
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
          segments: [{
            id: item.segment.id,
            start: item.segment.startFrame,
            length: item.segment.lengthFrames,
            prompt: item.runtimePrompt,
            type: "image",
            imageFile: frame.expectedInputPath,
            fileName: frame.generatedFile,
            guideStrength: 1,
            isEndFrame: false,
            storyboardFrameId: frame.id
          }],
          motionSegments: Array.isArray(priorTimeline.motionSegments) ? priorTimeline.motionSegments : [],
          audioSegments: Array.isArray(priorTimeline.audioSegments) ? priorTimeline.audioSegments : []
        };
        plan.firstFramePackage = {
          packageId: PACKAGE_ID,
          chapterId: "MV01",
          archiveSha256: packageData.archiveSha256,
          segmentCount: 1,
          renderMode: "independent_segment_i2v",
          packageDelivery: structuredClone(PACKAGE_DEFINITION.packageDelivery),
          canonicalDelivery: structuredClone(PACKAGE_DEFINITION.canonicalDelivery),
          landscapeOverrideAccepted: true,
          sourceReferencesUse: "provenance_display_only"
        };
      }

      next.imports = { ...(next.imports || {}), [PACKAGE_ID]: receipt };
      next.updatedAt = now.toISOString();
      validateStoryboard(next, projectSlug);
      if (stableHash(nonTargetSnapshot(next, targets)) !== beforeNonTargetHash) throw new Error("MV01 import changed storyboard records outside MV01");
      if (stableHash(invariantSnapshot(next, targets)) !== beforeInvariantHash) throw new Error("MV01 import changed protected timing/order/audio/motion/history/reference/continuity state");
      if (dryRun) {
        if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed during MV01 projected-state verification");
        return { dryRun: true, idempotent: false, projected: true, storyboard: next, receipt, backup: null };
      }
      const activeAtCommit = activeProjectJobs(projectSlug);
      if (activeAtCommit.length) throw new Error(`MV01 generation became active before commit: ${activeAtCommit.join(", ")}`);
      liveQueuePreflight();
      if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed on disk during MV01 import; no storyboard update was committed");
      saveStoryboard(projectSlug, next);
      storyboardSaved = true;
      const saved = loadStoryboard(projectSlug);
      verifyImportedState(saved, mediaDirectory, receipt, packageData, asset);
      return { dryRun: false, idempotent: false, storyboard: saved, receipt, backup: receipt.backup };
    } catch (error) {
      const rollbackErrors = [];
      let storyboardRestored = !storyboardSaved;
      if (storyboardSaved) {
        const restore = `${storyboardFile}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
        try {
          fs.copyFileSync(backup, restore, fs.constants.COPYFILE_EXCL);
          fs.renameSync(restore, storyboardFile);
          if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Restored storyboard hash differs from the pre-import source");
          storyboardRestored = true;
        } catch (restoreError) {
          rollbackErrors.push(new Error(`CRITICAL: MV01 storyboard rollback failed; imported media was retained: ${restoreError.message}`));
          try { if (fs.existsSync(restore)) fs.unlinkSync(restore); } catch (cleanupError) { rollbackErrors.push(cleanupError); }
        }
      }
      if (storyboardRestored) {
        for (const file of createdFiles) {
          try { fs.unlinkSync(file); }
          catch (cleanupError) { rollbackErrors.push(new Error(`MV01 rollback could not remove ${file}: ${cleanupError.message}`)); }
        }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "MV01 import failed and rollback was not completely clean");
      throw error;
    }
  } finally {
    fs.rmSync(packageData.temporaryRoot, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modes = ["--inspect-packages-only", "--verify-only", "--apply"].filter((flag) => process.argv.includes(flag));
  if (modes.length !== 1) {
    console.error("Usage: node scripts/import-mv01-ltx25-i2v-complete.mjs (--inspect-packages-only | --verify-only | --apply) [--mv01 <exact-zip>] [--allow-landscape]");
    process.exitCode = 2;
  } else try {
    const archivePath = argument("--mv01") || defaultArchivePath();
    const result = modes[0] === "--inspect-packages-only"
      ? inspectMV01Package({ archivePath })
      : importMV01Ltx25I2vComplete({ archivePath, dryRun: modes[0] === "--verify-only", allowLandscape: process.argv.includes("--allow-landscape") });
    console.log(JSON.stringify({
      ok: true,
      dryRun: Boolean(result.dryRun),
      idempotent: Boolean(result.idempotent),
      backup: result.backup || null,
      clips: result.receipt?.clipIds?.length ?? result.clips,
      frames: result.receipt?.frames?.length ?? result.frames,
      archiveSha256: result.receipt?.archiveSha256 || result.archiveSha256,
      packageDelivery: result.receipt?.package?.packageDelivery || result.packageDelivery,
      canonicalDelivery: result.receipt?.package?.canonicalDelivery || result.canonicalDelivery,
      landscapeOverrideRequired: result.landscapeOverrideRequired ?? true
    }, null, 2));
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
