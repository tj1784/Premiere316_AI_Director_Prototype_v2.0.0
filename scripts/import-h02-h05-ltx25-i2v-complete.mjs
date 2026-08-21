import crypto from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

import { projectDir } from "../server/paths.js";
import { loadStoryboard, saveStoryboard, storyboardPath, validateStoryboard } from "../server/storyboard.js";
import {
  isH03OrLaterClipId,
  stripLegacyGlobalDialogue,
  withGlobalDialogueContract
} from "../director-webapp/dialogue-direction.mjs";

export const PACKAGE_ID = "h02_h05_ltx25_i2v_complete_v1";
export const FPS = 24;
const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "finalizing"]);

export const PACKAGE_DEFINITIONS = Object.freeze({
  H02: Object.freeze({
    chapterId: "H02",
    archiveName: "H02_LTX25_I2V_COMPLETE.zip",
    archiveSha256: "cbc6f5916827eedf05535a02ad6976410bcf8e120e9af78d97bfe2d63649851c",
    archiveBytes: 84785048,
    rootEntry: "",
    csv: "H02_FIRST_FRAME_BINDINGS.csv",
    prompts: "H02_I2V_PROMPTS.md",
    sources: "H02_SOURCE_REFERENCES.md",
    sourceExtract: "H02_SOURCE_EXTRACT.json",
    expectedClips: 13,
    expectedFrames: 39,
    filenameSuffix: "h02-i2v-complete"
  }),
  H03: Object.freeze({
    chapterId: "H03",
    archiveName: "H03_LTX25_I2V_COMPLETE.zip",
    archiveSha256: "9a42cb0f1919c7a1fddbf4bd0c70252d7044840b86988b16896f7afefd796468",
    archiveBytes: 104880268,
    rootEntry: "H03_final",
    csv: "H03_FIRST_FRAME_BINDINGS.csv",
    prompts: "H03_I2V_PROMPTS.md",
    sources: "H03_SOURCE_REFERENCES.md",
    shaManifest: "MANIFEST_SHA256.txt",
    expectedClips: 16,
    expectedFrames: 48,
    filenameSuffix: "h03-i2v-complete"
  }),
  H04: Object.freeze({
    chapterId: "H04",
    archiveName: "H04_LTX25_I2V_COMPLETE.zip",
    archiveSha256: "b18e82c2c303cd1e638da4882e0fddb76e7c41a1a53b6db161d0f44f87d89d9b",
    archiveBytes: 132431802,
    rootEntry: "work/chapters/H04_LTX25_I2V_COMPLETE",
    csv: "H04_FIRST_FRAME_BINDINGS.csv",
    prompts: "H04_I2V_PROMPTS.md",
    sources: "H04_SOURCE_REFERENCES.md",
    frameShaCsv: "H04_FRAME_SHA256.csv",
    packageManifest: "H04_MANIFEST.json",
    expectedClips: 20,
    expectedFrames: 60,
    filenameSuffix: "h04-i2v-complete"
  }),
  H05: Object.freeze({
    chapterId: "H05",
    archiveName: "H05_LTX25_I2V_COMPLETE.zip",
    archiveSha256: "0da5938dd2a43c73f3e0aa27bf9302a43e28751c8ac38aa4e8574d7da8adedc8",
    archiveBytes: 69514623,
    rootEntry: "H05_LTX25_I2V_COMPLETE",
    csv: "H05_FIRST_FRAME_BINDINGS.csv",
    prompts: "H05_I2V_PROMPTS.md",
    sources: "H05_SOURCE_REFERENCES.md",
    frameShaJson: "SHA256_MANIFEST.json",
    videoPlans: "H05_VIDEO_PLANS_I2V.json",
    expectedClips: 10,
    expectedFrames: 30,
    filenameSuffix: "h05-i2v-complete"
  })
});

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
    throw new Error(`Unsafe archive path: ${value || "empty"}`);
  }
  const parts = result.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe archive path: ${value}`);
  return result;
}

function safeSourcePath(root, relative) {
  const normalized = normalizedRelative(relative);
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, ...normalized.split("/"));
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Package path escapes its root: ${relative}`);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Package file is missing: ${relative}`);
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Package file escapes its root: ${relative}`);
  return real;
}

// The packages are fixed, trusted-by-hash ZIPs. This parser still rejects traversal,
// duplicate/case-colliding entries, encryption, links, special files and unsupported methods.
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
  if (disk || directoryDisk || diskEntries !== totalEntries || totalEntries === 0xffff || directoryOffset + directoryBytes > eocd) {
    throw new Error("Multi-disk or ZIP64 archives are not accepted");
  }
  const entries = [];
  const seen = new Set();
  let cursor = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (archiveBuffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Malformed ZIP central directory");
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
    const collisionKey = name.toLowerCase();
    if (seen.has(collisionKey)) throw new Error(`ZIP contains a duplicate/case-colliding entry: ${name}`);
    seen.add(collisionKey);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error(`ZIP contains a link or special file: ${name}`);
    if (flags & 1) throw new Error(`Encrypted ZIP entries are not accepted: ${name}`);
    if (!directory && method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    entries.push({ name, directory, flags, method, compressedBytes, uncompressedBytes, localOffset });
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  if (cursor !== directoryOffset + directoryBytes) throw new Error("ZIP central-directory length mismatch");
  return entries;
}

function extractVerifiedArchive(archivePath, definition) {
  const realArchive = fs.realpathSync(archivePath);
  if (path.basename(realArchive).toLowerCase() !== definition.archiveName.toLowerCase()) {
    throw new Error(`Archive basename must be exactly ${definition.archiveName}`);
  }
  const stats = fs.statSync(realArchive);
  if (!stats.isFile() || stats.size !== definition.archiveBytes) throw new Error(`Unexpected archive byte size for ${definition.chapterId}: ${stats.size}`);
  const archiveBuffer = fs.readFileSync(realArchive);
  const archiveSha256 = sha256Buffer(archiveBuffer);
  if (archiveSha256 !== definition.archiveSha256) throw new Error(`Unexpected ${definition.chapterId} archive SHA-256: ${archiveSha256}`);
  const entries = zipEntries(archiveBuffer);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `premiere316-${definition.chapterId.toLowerCase()}-`));
  try {
    for (const entry of entries) {
      const destination = path.resolve(temporaryRoot, ...entry.name.split("/"));
      if (!destination.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error(`ZIP entry escaped extraction root: ${entry.name}`);
      if (entry.directory) {
        fs.mkdirSync(destination, { recursive: true });
        continue;
      }
      if (archiveBuffer.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error(`Malformed ZIP local header: ${entry.name}`);
      const localNameBytes = archiveBuffer.readUInt16LE(entry.localOffset + 26);
      const localExtraBytes = archiveBuffer.readUInt16LE(entry.localOffset + 28);
      const dataOffset = entry.localOffset + 30 + localNameBytes + localExtraBytes;
      const compressed = archiveBuffer.subarray(dataOffset, dataOffset + entry.compressedBytes);
      if (compressed.length !== entry.compressedBytes) throw new Error(`Truncated ZIP entry: ${entry.name}`);
      const content = entry.method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
      if (content.length !== entry.uncompressedBytes) throw new Error(`Uncompressed byte mismatch: ${entry.name}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, { flag: "wx" });
    }
    const packageRoot = definition.rootEntry
      ? path.resolve(temporaryRoot, ...definition.rootEntry.split("/"))
      : temporaryRoot;
    if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) throw new Error(`${definition.chapterId} package root is missing`);
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

export function parsePromptPackage(markdown, chapterId) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const headings = [...normalized.matchAll(new RegExp(`^#{2,4}\\s+(${chapterId}-S\\d{2}-C\\d{2})\\b[^\\n]*$`, "gm"))];
  const sharedNegativeHeading = normalized.search(/^## Shared negative prompt\s*$/m);
  const prompts = new Map();
  const clipGlobals = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const clipId = headings[index][1];
    const bodyStart = headings[index].index + headings[index][0].length;
    const nextClipHeading = headings[index + 1]?.index ?? normalized.length;
    const bodyEnd = sharedNegativeHeading >= 0 ? Math.min(nextClipHeading, sharedNegativeHeading) : nextClipHeading;
    const body = normalized.slice(bodyStart, bodyEnd).trim();
    const globalMatch = body.match(/^### Global prompt\s*\n+([\s\S]*?)(?=^### SEG01\b)/m);
    if (globalMatch) clipGlobals.set(clipId, globalMatch[1].trim());
    const segmentHeadings = [...body.matchAll(/^#{3,5}\s+SEG(\d{2})\b[^\n]*$/gm)];
    for (let segmentIndex = 0; segmentIndex < segmentHeadings.length; segmentIndex += 1) {
      const number = Number(segmentHeadings[segmentIndex][1]);
      const start = segmentHeadings[segmentIndex].index + segmentHeadings[segmentIndex][0].length;
      const end = segmentHeadings[segmentIndex + 1]?.index ?? body.length;
      const segmentBody = body.slice(start, end).trim();
      const firstFrame = segmentBody.match(/First frame:\s*`?([^`\r\n]+)`?/i);
      if (!firstFrame) throw new Error(`${clipId} SEG${String(number).padStart(2, "0")} has no first-frame declaration`);
      const prompt = segmentBody.slice(firstFrame.index + firstFrame[0].length).trim();
      const key = `${clipId}:SEG${String(number).padStart(2, "0")}`;
      if (!prompt || prompts.has(key)) throw new Error(`Missing or duplicate package prompt: ${key}`);
      prompts.set(key, { firstFrame: firstFrame[1].trim().replace(/\\/g, "/"), prompt });
    }
  }
  const visualLock = normalized.match(/Global visual lock(?: for every segment)?:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i)?.[1]?.trim()
    || normalized.match(/^## Global visual lock\s*\n+([\s\S]*?)(?=^## )/m)?.[1]?.trim()
    || "";
  const chronologyLock = normalized.match(/Global chronology lock:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i)?.[1]?.trim() || "";
  const negativePrompt = normalized.match(/^## Shared negative prompt\s*\n+([\s\S]+)$/m)?.[1]?.trim() || null;
  return { prompts, clipGlobals, visualLock: [visualLock, chronologyLock].filter(Boolean).join("\n\n"), negativePrompt };
}

function parseSourceReferences(markdown, chapterId) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headings = [...normalized.matchAll(new RegExp(`^#{2,4}\\s+(${chapterId}-S\\d{2}-C\\d{2})\\b[^\\n]*$`, "gm"))];
  const result = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const clipId = headings[index][1];
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end);
    const references = [];
    for (const match of body.matchAll(/^-\s+`(?:assets\/)?([^`/]+\.(?:png|jpe?g|webp))`([^\n]*)$/gmi)) {
      const tail = match[2] || "";
      references.push({
        filename: match[1],
        role: tail.match(/—\s*([^;\n]+)/)?.[1]?.trim() || null,
        required: /\brequired\b/i.test(tail) ? true : /\bsupporting\b/i.test(tail) ? false : null,
        sourceNotes: tail.replace(/^\s*—\s*/, "").trim() || null
      });
    }
    if (references.length) result.set(clipId, references);
  }
  return result;
}

function pngDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("First-frame package contains a non-PNG image");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (width !== 1920 || height !== 804 || bitDepth !== 8 || colorType !== 2) {
    throw new Error(`First-frame PNG must be 1920x804 8-bit RGB; received ${width}x${height}, bit depth ${bitDepth}, color type ${colorType}`);
  }
  return { width, height, bitDepth, colorType };
}

function packageFrameManifest(definition, packageRoot) {
  const result = new Map();
  if (definition.shaManifest) {
    const text = fs.readFileSync(safeSourcePath(packageRoot, definition.shaManifest), "utf8");
    for (const line of text.replace(/\r\n/g, "\n").split("\n").filter(Boolean)) {
      const match = line.match(/^([0-9a-f]{64})\s{2,}(.+)$/i);
      if (!match) throw new Error(`Malformed ${definition.chapterId} SHA manifest line: ${line}`);
      let relative = match[2].replace(/\\/g, "/");
      if (definition.rootEntry && relative.startsWith(`${definition.rootEntry}/`)) relative = relative.slice(definition.rootEntry.length + 1);
      const file = safeSourcePath(packageRoot, relative);
      if (sha256File(file) !== match[1].toLowerCase()) throw new Error(`${definition.chapterId} manifest hash mismatch: ${relative}`);
      if (relative.startsWith("first_frames/")) result.set(relative, { sha256: match[1].toLowerCase(), bytes: fs.statSync(file).size });
    }
  } else if (definition.frameShaCsv) {
    const rows = parseCsv(fs.readFileSync(safeSourcePath(packageRoot, definition.frameShaCsv), "utf8"));
    for (const row of rows) result.set(row.first_frame, { sha256: row.sha256.toLowerCase(), bytes: Number(row.bytes) });
  } else if (definition.frameShaJson) {
    const manifest = JSON.parse(fs.readFileSync(safeSourcePath(packageRoot, definition.frameShaJson), "utf8"));
    for (const [relative, sha256] of Object.entries(manifest)) result.set(relative, { sha256: String(sha256).toLowerCase(), bytes: null });
  }
  return result;
}

function rowSegmentNumber(row) {
  const match = String(row.segment || "").match(/(\d+)/);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(number) || number < 1) throw new Error(`Invalid package segment number: ${row.segment}`);
  return number;
}

function packageRowTiming(row) {
  const start = row.start_frame !== undefined && row.start_frame !== "" ? Number(row.start_frame) : Math.round(Number(row.start_seconds) * FPS);
  const length = row.length_frames !== undefined && row.length_frames !== ""
    ? Number(row.length_frames)
    : Math.round((Number(row.end_seconds) - Number(row.start_seconds)) * FPS);
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1) throw new Error(`Invalid package timing for ${row.clip_id} ${row.segment}`);
  if (row.end_seconds !== undefined && Math.round(Number(row.end_seconds) * FPS) !== start + length) throw new Error(`Package end time/frame mismatch for ${row.clip_id} ${row.segment}`);
  if (row.duration_seconds !== undefined && Math.round(Number(row.duration_seconds) * FPS) !== length) throw new Error(`Package duration mismatch for ${row.clip_id} ${row.segment}`);
  return { start, length };
}

function expectedFirstFrame(clipId, segmentNumber) {
  return `first_frames/${clipId}_SEG${String(segmentNumber).padStart(2, "0")}_FIRST.png`;
}

function loadPackage(definition, archivePath) {
  const extracted = extractVerifiedArchive(archivePath, definition);
  try {
    const csvFile = safeSourcePath(extracted.packageRoot, definition.csv);
    const promptsFile = safeSourcePath(extracted.packageRoot, definition.prompts);
    const sourcesFile = safeSourcePath(extracted.packageRoot, definition.sources);
    const rows = parseCsv(fs.readFileSync(csvFile, "utf8")).map((row) => ({
      ...row,
      clip_id: row.clip_id || row.clip
    }));
    const promptPackage = parsePromptPackage(fs.readFileSync(promptsFile, "utf8"), definition.chapterId);
    const sourceSections = parseSourceReferences(fs.readFileSync(sourcesFile, "utf8"), definition.chapterId);
    const frameManifest = packageFrameManifest(definition, extracted.packageRoot);
    const clipIds = [...new Set(rows.map((row) => row.clip_id))].sort();
    if (rows.length !== definition.expectedFrames || clipIds.length !== definition.expectedClips) {
      throw new Error(`${definition.chapterId} expected ${definition.expectedClips} clips/${definition.expectedFrames} frames; received ${clipIds.length}/${rows.length}`);
    }
    const keys = new Set();
    const framePaths = new Set();
    for (const row of rows) {
      const segmentNumber = rowSegmentNumber(row);
      const key = `${row.clip_id}:SEG${String(segmentNumber).padStart(2, "0")}`;
      if (!row.clip_id.startsWith(`${definition.chapterId}-`) || keys.has(key)) throw new Error(`Unexpected or duplicate package row: ${key}`);
      keys.add(key);
      packageRowTiming(row);
      const expected = expectedFirstFrame(row.clip_id, segmentNumber);
      if (row.first_frame.replace(/\\/g, "/") !== expected) throw new Error(`${key} first-frame path is not canonical: ${row.first_frame}`);
      const declaredPrompt = promptPackage.prompts.get(key);
      if (!declaredPrompt || declaredPrompt.firstFrame !== expected) throw new Error(`${key} CSV/prompt first-frame mismatch`);
      const sourceImage = safeSourcePath(extracted.packageRoot, expected);
      const buffer = fs.readFileSync(sourceImage);
      pngDimensions(buffer);
      const sha256 = sha256Buffer(buffer);
      const manifest = frameManifest.get(expected);
      if (manifest && (manifest.sha256 !== sha256 || (manifest.bytes != null && manifest.bytes !== buffer.length))) throw new Error(`${key} frame manifest mismatch`);
      frameManifest.set(expected, { sha256, bytes: buffer.length });
      framePaths.add(expected);
    }
    if (promptPackage.prompts.size !== rows.length || frameManifest.size !== rows.length || [...frameManifest.keys()].some((key) => !framePaths.has(key))) {
      throw new Error(`${definition.chapterId} prompt/frame manifest does not exactly match its CSV rows`);
    }
    for (const clipId of clipIds) if (!sourceSections.get(clipId)?.length) throw new Error(`${definition.chapterId} source references are missing for ${clipId}`);

    let sourceExtract = null;
    if (definition.sourceExtract) {
      sourceExtract = JSON.parse(fs.readFileSync(safeSourcePath(extracted.packageRoot, definition.sourceExtract), "utf8"));
      if (sourceExtract.chapter !== definition.chapterId || sourceExtract.clips !== clipIds.length || sourceExtract.segments?.length !== rows.length) throw new Error("H02 source extract count mismatch");
      const extractByKey = new Map(sourceExtract.segments.map((item) => [`${item.clip_id}:SEG${String(item.segment).padStart(2, "0")}`, item]));
      for (const row of rows) {
        const number = rowSegmentNumber(row);
        const key = `${row.clip_id}:SEG${String(number).padStart(2, "0")}`;
        const item = extractByKey.get(key);
        const timing = packageRowTiming(row);
        if (!item || Number(item.start_frame) !== timing.start || Number(item.length_frames) !== timing.length || `first_frames/${item.filename}` !== row.first_frame) {
          throw new Error(`H02 source extract differs from CSV: ${key}`);
        }
        const declared = sourceSections.get(row.clip_id).map((reference) => reference.filename);
        if (JSON.stringify(item.refs || []) !== JSON.stringify(declared)) throw new Error(`H02 source extract references differ for ${key}`);
      }
    }

    let h05Plans = null;
    if (definition.packageManifest) {
      const manifest = JSON.parse(fs.readFileSync(safeSourcePath(extracted.packageRoot, definition.packageManifest), "utf8"));
      if (manifest.chapter !== definition.chapterId || Number(manifest.clips) !== clipIds.length || Number(manifest.segments) !== rows.length
        || Number(manifest.fps) !== FPS || Number(manifest.canvas?.width) !== 1920 || Number(manifest.canvas?.height) !== 804) {
        throw new Error(`${definition.chapterId} package manifest differs from its declared clips, frames, FPS, or canvas`);
      }
    }
    if (definition.videoPlans) {
      h05Plans = JSON.parse(fs.readFileSync(safeSourcePath(extracted.packageRoot, definition.videoPlans), "utf8"));
      const plans = Object.values(h05Plans.videoPlans || {});
      if (plans.length !== clipIds.length || new Set(plans.map((plan) => plan.clipId)).size !== clipIds.length) throw new Error("H05 video-plan clip count mismatch");
      const rowsByClip = new Map(clipIds.map((clipId) => [clipId, rows.filter((row) => row.clip_id === clipId).sort((a, b) => rowSegmentNumber(a) - rowSegmentNumber(b))]));
      for (const plan of plans) {
        const clipRows = rowsByClip.get(plan.clipId);
        if (!clipRows || plan.timelineData?.segments?.length !== clipRows.length) throw new Error(`H05 plan segments missing for ${plan.clipId}`);
        if (promptPackage.clipGlobals.get(plan.clipId) !== plan.globalPrompt) throw new Error(`H05 Markdown/JSON global prompt mismatch: ${plan.clipId}`);
        for (let index = 0; index < clipRows.length; index += 1) {
          const row = clipRows[index];
          const number = rowSegmentNumber(row);
          const key = `${row.clip_id}:SEG${String(number).padStart(2, "0")}`;
          const timing = packageRowTiming(row);
          const timeline = plan.timelineData.segments[index];
          const prompt = promptPackage.prompts.get(key);
          if (timeline.id !== plan.segmentIds[index] || timeline.start !== timing.start || timeline.length !== timing.length || timeline.imageFile !== row.first_frame || timeline.prompt !== prompt.prompt) {
            throw new Error(`H05 plan/CSV/prompt mismatch: ${key}`);
          }
          const csvReferences = String(row.references || "").split(";").filter(Boolean);
          const sourceReferences = sourceSections.get(row.clip_id).map((reference) => reference.filename);
          if (JSON.stringify(csvReferences) !== JSON.stringify(sourceReferences)) throw new Error(`H05 CSV/source-reference mismatch: ${key}`);
        }
        if (plan.localPrompts !== plan.timelineData.segments.map((segment) => segment.prompt).join(" | ") || plan.segmentLengths !== plan.timelineData.segments.map((segment) => segment.length).join(",")) {
          throw new Error(`H05 flattened plan fields differ from its timeline: ${plan.clipId}`);
        }
      }
    }
    return {
      definition,
      ...extracted,
      rows,
      clipIds,
      promptPackage,
      sourceSections,
      frameManifest,
      sourceExtract,
      h05Plans,
      consumedHashes: {
        csvSha256: sha256File(csvFile),
        promptsSha256: sha256File(promptsFile),
        sourceReferencesSha256: sha256File(sourcesFile),
        videoPlansSha256: definition.videoPlans ? sha256File(safeSourcePath(extracted.packageRoot, definition.videoPlans)) : null
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

function assetVersionIndex(project, slug, requiredFiles) {
  const index = new Map();
  for (const asset of project.assets?.items || []) {
    for (const version of asset.versions || []) {
      for (const filename of new Set([version.file, ...(version.files || [])].filter(Boolean))) {
        if (!requiredFiles.has(filename)) continue;
        if (index.has(filename)) throw new Error(`Project contains duplicate asset-version filename: ${filename}`);
        const disk = path.join(projectDir(slug), "media", "assets", filename);
        if (!fs.existsSync(disk) || !fs.statSync(disk).isFile()) throw new Error(`Source reference is missing: ${filename}`);
        const bytes = fs.statSync(disk).size;
        const sha256 = sha256File(disk);
        const declared = (version.fileHashes || []).find((item) => item.file === filename);
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
  for (const filename of requiredFiles) if (!index.has(filename)) throw new Error(`Package reference does not resolve to an exact project asset version: ${filename}`);
  return index;
}

function referenceRole(filename) {
  if (/^char-/i.test(filename)) return "identity";
  if (/^loc-/i.test(filename)) return "location";
  if (/^(?:art-|prop-)/i.test(filename)) return "prop";
  if (/^(?:fx-|atmo-)/i.test(filename)) return "atmosphere_vfx";
  if (/^extra-(?:guardians|minions|rescue-demon)/i.test(filename)) return "creature";
  if (/^extra-/i.test(filename)) return "crowd";
  return "reference";
}

function sourceReferencesForClip(packageData, clipId, assets) {
  return packageData.sourceSections.get(clipId).map((declaration) => ({
    ...assets.get(declaration.filename),
    role: declaration.role || referenceRole(declaration.filename),
    required: declaration.required ?? !/^(?:fx-|atmo-)/i.test(declaration.filename),
    sourceNotes: declaration.sourceNotes
  }));
}

function frameReferences(frameId, sourceReferences, chapterId) {
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
    required: reference.required,
    order: index + 1,
    cropRegion: "Provenance/display only; never use this semantic source as a temporal guide or direct runtime conditioning input.",
    notes: `${chapterId} complete-package source provenance. ${reference.sourceNotes || "Exact project asset version used to author the imported first frame."}`,
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
  return segmentNumber === 1
    ? `frame-${clipId.toLowerCase()}-first`
    : `frame-segment-${clipId.toLowerCase()}-${String(segmentNumber).padStart(2, "0")}`;
}

function baseNameFor(clipId, segmentNumber) {
  return `${clipId}_${segmentNumber === 1 ? "first" : `seg${String(segmentNumber).padStart(2, "0")}`}`;
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

export function normalizedGlobalPrompt(packageData, clip, plan) {
  const packageGlobal = packageData.h05Plans
    ? packageData.h05Plans.videoPlans?.[clip.videoPlanId]?.globalPrompt
    : null;
  const usesSegmentDialogue = isH03OrLaterClipId(clip.id);
  const runtimePackageGlobal = usesSegmentDialogue
    ? stripLegacyGlobalDialogue(packageGlobal)
    : packageGlobal;
  let prompt = packageGlobal ? [
    `PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — ${clip.id}`,
    "FIRST-FRAME AUTHORITY: Generate only the selected segment from its own supplied first frame; semantic source references are provenance/display only.",
    "",
    runtimePackageGlobal
  ].join("\n") : [
    `PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — ${clip.id}`,
    "",
    "GENERATION MODE",
    "Generate only the selected authored segment independently from its supplied first frame. Begin exactly from that image, animate only the selected local prompt, and do not execute action from another segment.",
    "",
    "PACKAGE GLOBAL VISUAL / CHRONOLOGY LOCK",
    packageData.promptPackage.visualLock,
    "",
    "CURRENT CONTINUITY LOCKS",
    ...(clip.continuityLocks || []).map((lock) => `- ${lock}`),
    ...(usesSegmentDialogue ? [] : ["", `Silent picture pass. ${clip.dialogueAnchor || "No dialogue."}`]),
    "Hold a stable final composition for editorial assembly."
  ].join("\n");
  prompt = prompt.replace(
    /Create one \d+-second photorealistic live-action biblical-epic render at 24 fps from the approved first-frame guide, framed for a 2\.39:1 master\./,
    "Generate only the currently selected authored segment at 24 fps from its own approved first-frame guide, framed for a 2.39:1 master."
  );
  if (clip.id === "H05-S18-C01") {
    prompt = prompt
      .replace(/Face state: VISIBLE;/g, "Face state: WITHHELD; do not reveal any new or reflected Satan face;")
      .replace(/Jesus wears exact white burial linen[^.]*no crown of thorns\./g, "Jesus is absent from this gate clip; do not introduce Him or any new face.");
    prompt += "\n\nH05-S18-C01 OVERRIDE: Satan's face remains WITHHELD, including reflections and silhouettes. Introduce no new face. Jesus is absent and must not appear. The Gate remains intact. Sword state remains ABSENT.";
  }
  const missingLocks = (clip.continuityLocks || []).filter((lock) => !prompt.toLowerCase().includes(String(lock).toLowerCase()));
  if (missingLocks.length) prompt += `\n\nCURRENT CONTINUITY LOCKS — AUTHORITATIVE\n${missingLocks.map((lock) => `- ${lock}`).join("\n")}`;
  prompt += "\n\nGENERATION CONTRACT: SEGMENTED IMAGE-TO-VIDEO. This queue item is one independent 5–6 second authored segment, never the whole clip. Use only its selected first frame and selected local prompt.";
  if (usesSegmentDialogue) prompt = withGlobalDialogueContract(prompt);
  return prompt;
}

function activeProjectJobs(slug, clipIds) {
  const matches = [];
  for (const filename of ["generation-jobs.json", "director-generation-jobs.json"]) {
    const file = path.join(projectDir(slug), filename);
    if (!fs.existsSync(file)) continue;
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`Cannot safely parse target generation ledger ${file}: ${error.message}`); }
    if (!Array.isArray(ledger.jobs)) throw new Error(`Target generation ledger has an unexpected shape: ${file}`);
    for (const job of ledger.jobs || []) {
      const clipId = job.refs?.clipId || job.refs?.binding?.clipId;
      if (clipIds.has(clipId) && ACTIVE_STATUSES.has(job.status)) matches.push(`${filename}:${job.id}:${job.status}`);
    }
  }
  return matches;
}

function getJsonSync(url) {
  const response = spawnSync("curl.exe", ["--silent", "--show-error", "--fail", "--max-time", "4", url], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (response.error || response.status !== 0) {
    throw new Error(`Live queue preflight failed closed for ${url}: ${response.error?.message || response.stderr?.trim() || `curl exit ${response.status}`}`);
  }
  try { return JSON.parse(response.stdout); }
  catch { throw new Error(`Live queue preflight returned invalid JSON: ${url}`); }
}

function liveQueuePreflight(projectSlug, clipIds) {
  const results = {};
  for (const url of ["http://127.0.0.1:8188/queue", "http://127.0.0.1:8789/api/queue", "http://127.0.0.1:8791/api/queue"]) {
    const queue = getJsonSync(url);
    if (Array.isArray(queue.queue_running) && Array.isArray(queue.queue_pending)) {
      const running = queue.queue_running.length;
      const pending = queue.queue_pending.length;
      if (running || pending) throw new Error(`Cannot update H02-H05 while live ComfyUI queue is busy (${url}: ${running} running, ${pending} pending)`);
      results[url] = "empty_comfy_queue";
      continue;
    }
    if (Array.isArray(queue.jobs)) {
      const active = queue.jobs.filter((job) => {
        const slug = job.projectSlug || job.refs?.projectSlug;
        const clipId = job.refs?.clipId || job.refs?.binding?.clipId;
        return ACTIVE_STATUSES.has(job.status) && (!slug || slug === projectSlug) && (!clipId || clipIds.has(clipId));
      });
      if (active.length) throw new Error(`Cannot update H02-H05 while an app queue has active target jobs (${url}): ${active.map((job) => `${job.id}:${job.status}`).join(", ")}`);
      results[url] = "no_active_target_jobs";
      continue;
    }
    throw new Error(`Live queue response has an unexpected shape: ${url}`);
  }
  return results;
}

function chapterClipIds(storyboard, chapterId) {
  const chapter = storyboard.chapters?.[chapterId];
  if (!chapter) throw new Error(`Storyboard chapter is missing: ${chapterId}`);
  return (chapter.sceneIds || []).flatMap((sceneId) => storyboard.scenes?.[sceneId]?.clipIds || []).sort();
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
    for (const key of ["firstFrameId", "generationMode", "referenceMode", "renderStatus", "renderError"]) delete value[key];
    clips[clipId] = value;
  }
  const plans = {};
  for (const planId of targets.plans) {
    const value = structuredClone(storyboard.videoPlans[planId]);
    for (const key of ["generationMode", "referenceMode", "workflowProfileId", "globalPrompt", "negativePrompt", "localPrompts", "segmentLengths", "guideStrength", "status", "inputHash", "activeGeneratedVersion", "generatedFile", "generatedInputPath", "lastError", "activeRenderPromptId", "renderQueuedAt", "firstFramePackage"]) delete value[key];
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

function validateStoryboardMapping(storyboard, packages) {
  const allClipIds = [];
  const rowsByKey = new Map();
  for (const packageData of packages) {
    const currentChapterClips = chapterClipIds(storyboard, packageData.definition.chapterId);
    if (JSON.stringify(currentChapterClips) !== JSON.stringify(packageData.clipIds)) throw new Error(`${packageData.definition.chapterId} package clips do not exactly match the current storyboard chapter`);
    for (const row of packageData.rows) {
      const clipId = row.clip_id;
      const number = rowSegmentNumber(row);
      const key = `${clipId}:SEG${String(number).padStart(2, "0")}`;
      const clip = storyboard.clips?.[clipId];
      const plan = clip && storyboard.videoPlans?.[clip.videoPlanId];
      const segmentId = plan?.segmentIds?.[number - 1];
      const segment = storyboard.segments?.[segmentId];
      if (!clip || !plan || !segment || plan.clipId !== clipId) throw new Error(`Current storyboard mapping is missing: ${key}`);
      const timing = packageRowTiming(row);
      if (segment.startFrame !== timing.start || segment.lengthFrames !== timing.length) throw new Error(`${segment.id} timing differs from ${packageData.definition.chapterId} package`);
      if (row.source_segment_id && row.source_segment_id !== segment.id) throw new Error(`${key} package segment ID differs from current storyboard: ${row.source_segment_id} != ${segment.id}`);
      rowsByKey.set(key, { packageData, row, clipId, clip, plan, segmentId, segment, number });
    }
    for (const clipId of packageData.clipIds) {
      const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
      const count = packageData.rows.filter((row) => row.clip_id === clipId).length;
      if (count !== plan.segmentIds.length) throw new Error(`${clipId} package/current segment count differs`);
      if (packageData.h05Plans) {
        const packagePlan = packageData.h05Plans.videoPlans?.[plan.id];
        if (!packagePlan || packagePlan.clipId !== clipId || JSON.stringify(packagePlan.segmentIds) !== JSON.stringify(plan.segmentIds)) throw new Error(`${clipId} H05 plan IDs differ from current storyboard`);
      }
    }
    allClipIds.push(...packageData.clipIds);
  }
  const packagePrompts = packages.flatMap((packageData) => [...packageData.promptPackage.prompts.values()].map((entry) => entry.prompt));
  if (new Set(allClipIds).size !== allClipIds.length || rowsByKey.size !== 177 || allClipIds.length !== 59) throw new Error("Combined H02-H05 package target set is not exactly 59 clips / 177 segments");
  if (packagePrompts.length !== 177 || new Set(packagePrompts).size !== 177) throw new Error("Combined H02-H05 package does not contain 177 unique segment prompts");
  return { allClipIds: allClipIds.sort(), rowsByKey };
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
    pinnedActiveAtImport: reference.pinnedActiveAtImport
  }));
}

function verifyImportedState(storyboard, mediaDirectory, receipt, { packages = [], assets = null } = {}) {
  validateStoryboard(storyboard, "harrowing_of_hell");
  if (receipt.packageId !== PACKAGE_ID || receipt.frames?.length !== 177 || receipt.clipIds?.length !== 59) throw new Error("Combined import receipt count or identity is invalid");
  for (const field of ["segmentId", "frameId", "filename"]) {
    if (new Set(receipt.frames.map((item) => item[field])).size !== 177) throw new Error(`Receipt does not contain 177 unique ${field} values`);
  }
  if (new Set(receipt.frames.map((item) => item.prompt)).size !== 177) throw new Error("The 177 imported segment prompts are not unique");
  const targets = targetSets(storyboard, receipt.clipIds);
  if (receipt.nonTargetSnapshotSha256 && stableHash(nonTargetSnapshot(storyboard, targets)) !== receipt.nonTargetSnapshotSha256) throw new Error("Non-target storyboard state differs from the import receipt");
  if (receipt.targetInvariantSha256 && stableHash(invariantSnapshot(storyboard, targets)) !== receipt.targetInvariantSha256) throw new Error("Protected target timing, ordering, continuity, history, or plan-reference state differs from the import receipt");

  const packageByClip = new Map(packages.flatMap((packageData) => packageData.clipIds.map((clipId) => [clipId, packageData])));
  const receiptBySegment = new Map(receipt.frames.map((item) => [item.segmentId, item]));
  for (const item of receipt.frames) {
    const clip = storyboard.clips[item.clipId];
    const plan = clip && storyboard.videoPlans[clip.videoPlanId];
    const segment = storyboard.segments[item.segmentId];
    const frame = storyboard.frames[item.frameId];
    const expectedFrameId = frameIdFor(item.clipId, item.segmentNumber);
    if (!clip || !plan || !segment || !frame || item.frameId !== expectedFrameId || plan.segmentIds[item.segmentNumber - 1] !== item.segmentId) throw new Error(`Imported clip/segment/frame mapping differs: ${item.segmentId}`);
    if (segment.frameId !== frame.id || segment.type !== "image" || segment.prompt !== item.prompt || segment.startFrame !== item.startFrame || segment.lengthFrames !== item.lengthFrames) throw new Error(`Imported segment state differs: ${item.segmentId}`);
    if (frame.ownerId !== (item.segmentNumber === 1 ? item.clipId : item.segmentId) || frame.activeGeneratedVersion !== item.version || frame.generatedFile !== item.filename || frame.inputHash !== item.sha256 || frame.prompt !== item.prompt) throw new Error(`Imported active frame differs: ${item.frameId}`);
    if (path.basename(item.filename) !== item.filename) throw new Error(`Receipt contains an unsafe media filename: ${item.filename}`);
    const version = (frame.generatedVersions || []).find((candidate) => Number(candidate.v) === Number(item.version) && candidate.file === item.filename);
    if (!version || version.prompt !== item.prompt || version.promptHash !== item.promptHash || version.sourceEntry !== item.sourceEntry
      || version.sourceArchiveSha256 !== item.archiveSha256 || version.fileHashes?.length !== 1
      || version.fileHashes[0].file !== item.filename || version.fileHashes[0].bytes !== item.bytes || version.fileHashes[0].sha256 !== item.sha256) {
      throw new Error(`Imported frame history differs: ${item.frameId}`);
    }
    const bindings = Object.values(storyboard.referenceBindings || {})
      .filter((binding) => binding.targetKind === "frame" && binding.targetId === item.frameId)
      .sort((a, b) => a.order - b.order);
    const frameReferenceList = [...(frame.references || [])].sort((a, b) => a.order - b.order);
    if (bindings.length !== item.sourceReferenceCount || frameReferenceList.length !== item.sourceReferenceCount || stableHash(bindings) !== stableHash(frameReferenceList)) throw new Error(`Imported frame/reference-binding mirror differs: ${item.frameId}`);
    const actualReferences = frameReferenceList.map((reference) => ({
      assetId: reference.assetId,
      assetVersion: reference.assetVersion,
      assetVersionId: reference.assetVersionId,
      sourceAssetFile: reference.sourceAssetFile,
      role: reference.role,
      required: reference.required,
      pinnedActiveAtImport: reference.pinnedActiveAtImport
    }));
    const receiptReferenceList = item.sourceReferences.map(({ sha256: _sha256, bytes: _bytes, ...reference }) => reference);
    if (stableHash(actualReferences) !== stableHash(receiptReferenceList)) throw new Error(`Imported exact-version reference set differs: ${item.frameId}`);
    const disk = path.join(mediaDirectory, item.filename);
    if (!disk.startsWith(`${mediaDirectory}${path.sep}`) || !fs.existsSync(disk) || fs.statSync(disk).size !== item.bytes || sha256File(disk) !== item.sha256) throw new Error(`Imported media verification failed: ${item.filename}`);

    const timeline = plan.timelineData?.segments?.find((candidate) => candidate.id === item.segmentId);
    if (!timeline || timeline.start !== segment.startFrame || timeline.length !== segment.lengthFrames || timeline.prompt !== item.prompt || timeline.type !== "image"
      || timeline.fileName !== item.filename || timeline.storyboardFrameId !== item.frameId || timeline.imageFile !== frame.expectedInputPath) throw new Error(`Imported timeline mirror differs: ${item.segmentId}`);

    const packageData = packageByClip.get(item.clipId);
    if (packageData) {
      const key = `${item.clipId}:SEG${String(item.segmentNumber).padStart(2, "0")}`;
      const packagePrompt = packageData.promptPackage.prompts.get(key);
      const packageFrame = packageData.frameManifest.get(item.sourceEntry);
      if (!packagePrompt || packagePrompt.prompt !== item.prompt || packagePrompt.firstFrame !== item.sourceEntry || item.promptHash !== sha256Buffer(Buffer.from(packagePrompt.prompt, "utf8"))
        || !packageFrame || packageFrame.sha256 !== item.sha256 || packageFrame.bytes !== item.bytes || packageData.archiveSha256 !== item.archiveSha256) throw new Error(`Receipt differs from fixed package: ${key}`);
      if (assets) {
        const expectedReferences = receiptReferences(sourceReferencesForClip(packageData, item.clipId, assets));
        if (stableHash(expectedReferences) !== stableHash(item.sourceReferences)) throw new Error(`Receipt references differ from fixed package/project versions: ${key}`);
      }
    }
  }

  for (const clipId of receipt.clipIds) {
    const clip = storyboard.clips[clipId];
    const plan = storyboard.videoPlans[clip.videoPlanId];
    if (clip.firstFrameId !== frameIdFor(clipId, 1) || clip.generationMode !== "i2v_segmented_first_frames" || clip.referenceMode !== "segment_first_frames"
      || plan.generationMode !== "i2v_segmented_first_frames" || plan.referenceMode !== "segment_first_frames" || plan.workflowProfileId !== "ltx-2.5-i2v-segmented-first-frame") throw new Error(`${clipId} is not configured for segmented I2V`);
    const frames = plan.segmentIds.map((segmentId) => receiptBySegment.get(segmentId));
    if (frames.some((item) => !item) || plan.localPrompts !== frames.map((item) => item.prompt).join(" | ") || plan.segmentLengths !== frames.map((item) => String(item.lengthFrames)).join(",")) throw new Error(`${plan.id} flattened segment fields differ`);
    if (plan.timelineData?.segments?.length !== plan.segmentIds.length || plan.timelineData?.global_prompt !== plan.globalPrompt || plan.timelineData?.normalStartFrame !== 0 || plan.timelineData?.normalDurationFrames !== clip.durationFrames) throw new Error(`${plan.id} timeline contract differs`);
    for (const lock of clip.continuityLocks || []) if (!plan.globalPrompt.toLowerCase().includes(String(lock).toLowerCase())) throw new Error(`${plan.id} global prompt lost current continuity lock: ${lock}`);
    if (!/SEGMENTED IMAGE-TO-VIDEO/i.test(plan.globalPrompt) || !/first[- ]frame/i.test(plan.globalPrompt)) throw new Error(`${plan.id} global prompt lacks the segmented I2V/first-frame contract`);
    const packageData = packageByClip.get(clipId);
    if (packageData && plan.globalPrompt !== normalizedGlobalPrompt(packageData, clip, plan)) throw new Error(`${plan.id} global prompt differs from the normalized fixed package`);
  }
  const gatePlan = storyboard.videoPlans[storyboard.clips["H05-S18-C01"].videoPlanId];
  if (!/Face state: WITHHELD/i.test(gatePlan.globalPrompt) || !/Jesus is absent/i.test(gatePlan.globalPrompt) || /Face state: VISIBLE/i.test(gatePlan.globalPrompt)) throw new Error("H05-S18-C01 global correction is not active");
  if (receipt.backup) {
    const backup = path.resolve(projectDir("harrowing_of_hell"), ...receipt.backup.split("/"));
    const backupRoot = path.join(projectDir("harrowing_of_hell"), "production", "backups");
    if (!backup.startsWith(`${backupRoot}${path.sep}`) || !fs.existsSync(backup) || sha256File(backup) !== receipt.sourceStoryboardSha256) throw new Error("Import backup is missing, unsafe, or differs from the source storyboard hash");
  }
  return true;
}

export function defaultArchivePaths() {
  return Object.fromEntries(Object.entries(PACKAGE_DEFINITIONS).map(([chapterId, definition]) => [chapterId, path.join(os.homedir(), "Downloads", definition.archiveName)]));
}

export function inspectH02H05Packages({ archivePaths = defaultArchivePaths() } = {}) {
  const packages = [];
  try {
    for (const [chapterId, definition] of Object.entries(PACKAGE_DEFINITIONS)) packages.push(loadPackage(definition, archivePaths[chapterId]));
    const allPrompts = packages.flatMap((item) => [...item.promptPackage.prompts.values()].map((entry) => entry.prompt));
    if (allPrompts.length !== 177 || new Set(allPrompts).size !== 177) throw new Error("Combined packages do not contain 177 unique segment prompts");
    return {
      ok: true,
      packages: packages.map((item) => ({
        chapterId: item.definition.chapterId,
        archivePath: item.archivePath,
        archiveSha256: item.archiveSha256,
        clips: item.clipIds.length,
        frames: item.rows.length,
        sourceReferences: new Set([...item.sourceSections.values()].flatMap((entries) => entries.map((entry) => entry.filename))).size
      })),
      clips: packages.reduce((sum, item) => sum + item.clipIds.length, 0),
      frames: packages.reduce((sum, item) => sum + item.rows.length, 0)
    };
  } finally {
    for (const item of packages) fs.rmSync(item.temporaryRoot, { recursive: true, force: true });
  }
}

export function importH02H05Ltx25I2vComplete({
  archivePaths = defaultArchivePaths(),
  projectSlug = "harrowing_of_hell",
  now = new Date(),
  dryRun = false
} = {}) {
  if (projectSlug !== "harrowing_of_hell") throw new Error("These packages are scoped only to harrowing_of_hell");
  const packages = [];
  try {
    for (const [chapterId, definition] of Object.entries(PACKAGE_DEFINITIONS)) packages.push(loadPackage(definition, archivePaths[chapterId]));
    const storyboard = loadStoryboard(projectSlug);
    const storyboardFile = storyboardPath(projectSlug);
    const startingStoryboardSha256 = sha256File(storyboardFile);
    const { allClipIds, rowsByKey } = validateStoryboardMapping(storyboard, packages);
    const targets = targetSets(storyboard, allClipIds);
    const beforeNonTargetHash = stableHash(nonTargetSnapshot(storyboard, targets));
    const beforeInvariantHash = stableHash(invariantSnapshot(storyboard, targets));
    const mediaDirectory = path.join(projectDir(projectSlug), "media", "storyboard");

    const priorReceipt = storyboard.imports?.[PACKAGE_ID];
    const archiveHashes = Object.fromEntries(packages.map((item) => [item.definition.chapterId, item.archiveSha256]));
    const project = readProject(projectSlug);
    const requiredAssetFiles = new Set(packages.flatMap((item) => [...item.sourceSections.values()].flatMap((entries) => entries.map((entry) => entry.filename))));
    const assets = assetVersionIndex(project, projectSlug, requiredAssetFiles);
    if (priorReceipt && JSON.stringify(priorReceipt.archiveHashes) === JSON.stringify(archiveHashes)) {
      verifyImportedState(storyboard, mediaDirectory, priorReceipt, { packages, assets });
      return { dryRun, idempotent: true, storyboard, receipt: priorReceipt, backup: priorReceipt.backup || null };
    }
    if (priorReceipt) throw new Error(`${PACKAGE_ID} already exists with different archive hashes`);

    const active = activeProjectJobs(projectSlug, new Set(allClipIds));
    if (active.length) throw new Error(`Cannot update H02-H05 while target generation is active: ${active.join(", ")}`);
    for (const clipId of allClipIds) {
      const clip = storyboard.clips[clipId];
      const plan = storyboard.videoPlans[clip.videoPlanId];
      if (ACTIVE_STATUSES.has(clip.renderStatus) || ACTIVE_STATUSES.has(plan.status) || plan.activeRenderPromptId) throw new Error(`Cannot update active plan: ${clipId}`);
    }
    const livePreflight = liveQueuePreflight(projectSlug, new Set(allClipIds));

    const historical = historicalStoryboard(projectSlug);
    const prepared = [];
    for (const context of rowsByKey.values()) {
      const { packageData, row, clipId, segmentId, segment, number } = context;
      const key = `${clipId}:SEG${String(number).padStart(2, "0")}`;
      const packagePrompt = packageData.promptPackage.prompts.get(key);
      const sourceImage = safeSourcePath(packageData.packageRoot, packagePrompt.firstFrame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const sha256 = sha256Buffer(buffer);
      const expectedHash = packageData.frameManifest.get(packagePrompt.firstFrame);
      if (!expectedHash || expectedHash.sha256 !== sha256 || expectedHash.bytes !== buffer.length) throw new Error(`Prepared frame hash mismatch: ${key}`);
      const frameId = frameIdFor(clipId, number);
      const sourceReferences = sourceReferencesForClip(packageData, clipId, assets);
      prepared.push({ packageData, row, clipId, segmentId, segment, number, key, packagePrompt, sourceImage, buffer, dimensions, sha256, frameId, sourceReferences });
    }

    const dryReceipt = {
      packageId: PACKAGE_ID,
      sourceStoryboardSha256: startingStoryboardSha256,
      archiveHashes,
      livePreflight,
      nonTargetSnapshotSha256: beforeNonTargetHash,
      targetInvariantSha256: beforeInvariantHash,
      clipIds: allClipIds,
      frames: prepared.map((item) => ({
        clipId: item.clipId,
        segmentId: item.segmentId,
        segmentNumber: item.number,
        frameId: item.frameId,
        sourceEntry: item.packagePrompt.firstFrame,
        width: item.dimensions.width,
        height: item.dimensions.height,
        bytes: item.buffer.length,
        sha256: item.sha256,
        prompt: item.packagePrompt.prompt,
        promptHash: sha256Buffer(Buffer.from(item.packagePrompt.prompt, "utf8")),
        startFrame: item.segment.startFrame,
        lengthFrames: item.segment.lengthFrames,
        archiveSha256: item.packageData.archiveSha256,
        sourceReferenceCount: item.sourceReferences.length,
        sourceReferences: receiptReferences(item.sourceReferences)
      }))
    };
    if (dryRun) {
      if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed during read-only verification");
      return { dryRun: true, idempotent: false, storyboard, receipt: dryReceipt, backup: null };
    }

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const productionDirectory = path.join(projectDir(projectSlug), "production");
    const backupDirectory = path.join(productionDirectory, "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `storyboard.before-h02-h05-i2v-complete.${stamp}.json`);
    fs.copyFileSync(storyboardFile, backup, fs.constants.COPYFILE_EXCL);
    fs.mkdirSync(mediaDirectory, { recursive: true });
    const next = structuredClone(storyboard);
    const createdFiles = [];
    let storyboardSaved = false;
    const receipt = {
      ...dryReceipt,
      importedAt: now.toISOString(),
      backup: path.relative(projectDir(projectSlug), backup).replace(/\\/g, "/"),
      packages: packages.map((item) => ({
        chapterId: item.definition.chapterId,
        archiveFile: path.basename(item.archivePath),
        archiveSha256: item.archiveSha256,
        archiveBytes: item.definition.archiveBytes,
        ...item.consumedHashes,
        clips: item.clipIds.length,
        frames: item.rows.length
      })),
      frames: []
    };
    try {
      for (const item of prepared) {
        const { packageData, clipId, segmentId, number, packagePrompt, buffer, dimensions, sha256, frameId, sourceReferences } = item;
        const frameBase = baseNameFor(clipId, number);
        const existingFrame = next.frames[frameId] || historical?.storyboard?.frames?.[frameId] || null;
        const version = nextMediaVersion(mediaDirectory, frameBase, existingFrame);
        const filename = `${frameBase}.v${version}.${packageData.definition.filenameSuffix}.png`;
        const destination = path.join(mediaDirectory, filename);
        fs.writeFileSync(destination, buffer, { flag: "wx" });
        createdFiles.push(destination);
        const promptHash = sha256Buffer(Buffer.from(packagePrompt.prompt, "utf8"));
        const versionRecord = {
          v: version,
          files: [filename],
          file: filename,
          mediaType: "image",
          source: PACKAGE_ID,
          sourceArchive: path.basename(packageData.archivePath),
          sourceArchiveSha256: packageData.archiveSha256,
          sourceEntry: packagePrompt.firstFrame,
          sourceFileName: path.basename(item.sourceImage),
          prompt: packagePrompt.prompt,
          promptHash,
          width: dimensions.width,
          height: dimensions.height,
          workflowId: null,
          workflowHash: null,
          provenanceType: "external_package_import_no_embedded_generation_metadata",
          sourceReferenceAssets: sourceReferences,
          fileHashes: [{ file: filename, sha256, bytes: buffer.length, extension: ".png" }],
          createdAt: now.toISOString()
        };
        const references = frameReferences(frameId, sourceReferences, packageData.definition.chapterId);
        next.frames[frameId] = {
          ...(existingFrame || {}),
          id: frameId,
          purpose: number === 1 ? "first_frame" : "segment_frame",
          ownerKind: number === 1 ? "clip" : "segment",
          ownerId: number === 1 ? clipId : segmentId,
          prompt: packagePrompt.prompt,
          negativePrompt: packageData.promptPackage.negativePrompt || next.videoPlans[next.clips[clipId].videoPlanId].negativePrompt || "",
          status: "generated",
          expectedInputPath: `Premiere316/${projectSlug}/storyboard/${frameBase}.png`,
          generatedVersions: [...(existingFrame?.generatedVersions || []), versionRecord],
          activeGeneratedVersion: version,
          generatedFile: filename,
          generatedInputPath: `media/storyboard/${filename}`,
          generatedAssetId: frameId,
          generatedAssetVersionId: `${frameId}:v${version}`,
          inputHash: sha256,
          lastError: null,
          references,
          importProvenance: { packageId: PACKAGE_ID, archiveSha256: packageData.archiveSha256, sourceEntry: packagePrompt.firstFrame, sourceReferenceAssets: sourceReferences }
        };
        for (const [bindingId, binding] of Object.entries(next.referenceBindings || {})) if (binding?.targetKind === "frame" && binding.targetId === frameId) delete next.referenceBindings[bindingId];
        for (const reference of references) next.referenceBindings[reference.id] = { ...reference };
        const segment = next.segments[segmentId];
        segment.prompt = packagePrompt.prompt;
        segment.type = "image";
        segment.frameId = frameId;
        segment.isEndFrame = false;
        segment.status = "ready";
        receipt.frames.push({
          clipId, segmentId, segmentNumber: number, frameId, sourceEntry: packagePrompt.firstFrame, filename, version,
          width: dimensions.width, height: dimensions.height, bytes: buffer.length, sha256, prompt: packagePrompt.prompt, promptHash,
          startFrame: next.segments[segmentId].startFrame, lengthFrames: next.segments[segmentId].lengthFrames,
          archiveSha256: packageData.archiveSha256,
          sourceReferenceCount: sourceReferences.length,
          sourceReferences: receiptReferences(sourceReferences),
          restoredHistoricalVersions: existingFrame?.generatedVersions?.length || 0
        });
      }

      for (const packageData of packages) {
        for (const clipId of packageData.clipIds) {
          const clip = next.clips[clipId];
          const plan = next.videoPlans[clip.videoPlanId];
          clip.firstFrameId = frameIdFor(clipId, 1);
          clip.generationMode = "i2v_segmented_first_frames";
          clip.referenceMode = "segment_first_frames";
          clip.renderStatus = "not_started";
          delete clip.renderError;
          plan.generationMode = "i2v_segmented_first_frames";
          plan.referenceMode = "segment_first_frames";
          plan.workflowProfileId = "ltx-2.5-i2v-segmented-first-frame";
          plan.globalPrompt = normalizedGlobalPrompt(packageData, clip, plan);
          plan.negativePrompt = packageData.promptPackage.negativePrompt || plan.negativePrompt || "";
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
            chapterId: packageData.definition.chapterId,
            archiveSha256: packageData.archiveSha256,
            segmentCount: plan.segmentIds.length,
            renderMode: "independent_segment_i2v",
            sourceReferencesUse: "provenance_display_only"
          };
        }
      }

      next.imports = { ...(next.imports || {}), [PACKAGE_ID]: receipt };
      next.updatedAt = now.toISOString();
      validateStoryboard(next, projectSlug);
      if (stableHash(nonTargetSnapshot(next, targets)) !== beforeNonTargetHash) throw new Error("Import changed storyboard records outside H02-H05");
      if (stableHash(invariantSnapshot(next, targets)) !== beforeInvariantHash) throw new Error("Import changed protected H02-H05 timing, ordering, continuity, history, or semantic-reference state");
      const activeAtCommit = activeProjectJobs(projectSlug, new Set(allClipIds));
      if (activeAtCommit.length) throw new Error(`Target generation became active before commit: ${activeAtCommit.join(", ")}`);
      liveQueuePreflight(projectSlug, new Set(allClipIds));
      if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed on disk during import; no storyboard update was committed");
      saveStoryboard(projectSlug, next);
      storyboardSaved = true;
      const saved = loadStoryboard(projectSlug);
      verifyImportedState(saved, mediaDirectory, receipt, { packages, assets });
      if (stableHash(nonTargetSnapshot(saved, targets)) !== beforeNonTargetHash || stableHash(invariantSnapshot(saved, targets)) !== beforeInvariantHash) throw new Error("Saved import changed protected storyboard state");
      return { dryRun: false, idempotent: false, storyboard: saved, receipt, backup: receipt.backup };
    } catch (error) {
      const rollbackErrors = [];
      let storyboardRestored = !storyboardSaved;
      if (storyboardSaved) {
        const restore = `${storyboardFile}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
        try {
          fs.copyFileSync(backup, restore, fs.constants.COPYFILE_EXCL);
          fs.renameSync(restore, storyboardFile);
          if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Restored storyboard SHA-256 differs from the pre-import source");
          storyboardRestored = true;
        } catch (restoreError) {
          rollbackErrors.push(new Error(`CRITICAL: storyboard rollback failed; imported media was retained because the storyboard may still reference it: ${restoreError.message}`));
          try { if (fs.existsSync(restore)) fs.unlinkSync(restore); } catch (cleanupError) { rollbackErrors.push(cleanupError); }
        }
      }
      if (storyboardRestored) {
        for (const file of createdFiles) {
          try { fs.unlinkSync(file); }
          catch (cleanupError) { rollbackErrors.push(new Error(`Rollback could not remove created media ${file}: ${cleanupError.message}`)); }
        }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "H02-H05 import failed and rollback was not completely clean");
      throw error;
    }
  } finally {
    for (const item of packages) fs.rmSync(item.temporaryRoot, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archivePaths = defaultArchivePaths();
  for (const chapterId of Object.keys(PACKAGE_DEFINITIONS)) archivePaths[chapterId] = argument(`--${chapterId.toLowerCase()}`) || archivePaths[chapterId];
  const modes = ["--inspect-packages-only", "--verify-only", "--apply"].filter((flag) => process.argv.includes(flag));
  if (modes.length !== 1) {
    console.error("Usage: node scripts/import-h02-h05-ltx25-i2v-complete.mjs (--inspect-packages-only | --verify-only | --apply) [--h02 <exact-zip>] [--h03 <exact-zip>] [--h04 <exact-zip>] [--h05 <exact-zip>]");
    process.exitCode = 2;
  } else try {
    const result = modes[0] === "--inspect-packages-only"
      ? inspectH02H05Packages({ archivePaths })
      : importH02H05Ltx25I2vComplete({ archivePaths, dryRun: modes[0] === "--verify-only" });
    console.log(JSON.stringify({
      ok: true,
      dryRun: Boolean(result.dryRun),
      idempotent: Boolean(result.idempotent),
      backup: result.backup || null,
      clips: result.receipt?.clipIds?.length ?? result.clips,
      frames: result.receipt?.frames?.length ?? result.frames,
      archiveHashes: result.receipt?.archiveHashes || Object.fromEntries(result.packages.map((item) => [item.chapterId, item.archiveSha256]))
    }, null, 2));
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
