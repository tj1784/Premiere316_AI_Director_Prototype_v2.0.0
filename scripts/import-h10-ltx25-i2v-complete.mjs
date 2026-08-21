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
  stripLegacyGlobalDialogue,
  withGlobalDialogueContract
} from "../director-webapp/dialogue-direction.mjs";

export const PACKAGE_ID = "h10_ltx25_i2v_complete_v1";
export const FPS = 24;
const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling", "finalizing"]);

export const PACKAGE_DEFINITION = Object.freeze({
  chapterId: "H10",
  archiveName: "H10_LTX25_I2V_COMPLETE.zip",
  archiveSha256: "739a1228124b1654e3387acb21f595d08f6f334fefdf0091c5b95c5f6135da51",
  archiveBytes: 114976804,
  rootEntry: "H10_LTX25_I2V_COMPLETE",
  checksumManifest: "SHA256SUMS.txt",
  bindings: "metadata/bindings.json",
  frameManifest: "metadata/frames_manifest.json",
  prompts: "metadata/prompts.json",
  storyboard: "metadata/storyboard_h10.json",
  videoPlans: "metadata/video_plans_all_image.json",
  expectedEntries: 58,
  expectedClips: 11,
  expectedFrames: 33,
  expectedReferenceBindings: 189,
  expectedSourceAssets: 16,
  filenameSuffix: "h10-i2v-complete"
});

// One entry lets the established atomic transaction/invariant machinery
// enforce the same rules without broadening the import target.
export const PACKAGE_DEFINITIONS = Object.freeze({ H10: PACKAGE_DEFINITION });
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

function parsePromptPackage(markdown, chapterId) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const headings = [...normalized.matchAll(new RegExp(`^#{2,4}\\s+(${chapterId}-S\\d{2}-C\\d{2})\\b[^\\n]*$`, "gm"))];
  const prompts = new Map();
  const clipGlobals = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const clipId = headings[index][1];
    const bodyStart = headings[index].index + headings[index][0].length;
    const bodyEnd = headings[index + 1]?.index ?? normalized.length;
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

function parseSourceReferences(markdown, chapterId, referenceSchema) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headings = [...normalized.matchAll(new RegExp(`^#{2,4}\\s+(${chapterId}-S\\d{2}-C\\d{2})\\b[^\\n]*$`, "gm"))];
  const result = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const clipId = headings[index][1];
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end);
    const byFilename = new Map();
    let section = referenceSchema === "storyboard_generation_union" ? null : "loaded_for_generated_frame";
    for (const line of body.split("\n")) {
      if (/^#{3,6}\s+Storyboard-declared sources\s*$/i.test(line)) { section = "storyboard_declared"; continue; }
      if (/^#{3,6}\s+Sources loaded for generated segment frames\s*$/i.test(line)) { section = "loaded_for_generated_frame"; continue; }
      const match = line.match(/^-\s+`(?:assets\/)?([^`/]+\.(?:png|jpe?g|webp))`([^\n]*)$/i);
      if (!match) continue;
      if (!section) throw new Error(`${chapterId} source-reference bullet appears outside a declared relation section: ${clipId}`);
      const filename = match[1];
      const tail = match[2] || "";
      const current = byFilename.get(filename) || {
        filename,
        role: null,
        required: null,
        sourceNotes: null,
        storyboardDeclared: false,
        loadedForGeneratedFrame: false,
        storyboardOrder: null,
        generationOrder: null
      };
      if (section === "storyboard_declared") {
        current.storyboardDeclared = true;
        current.storyboardOrder ??= [...byFilename.values()].filter((item) => item.storyboardDeclared).length + 1;
      } else {
        current.loadedForGeneratedFrame = true;
        current.generationOrder ??= [...byFilename.values()].filter((item) => item.loadedForGeneratedFrame).length + 1;
      }
      const role = tail.match(/—\s*([^;\n]+)/)?.[1]?.trim() || null;
      const required = /\brequired\b/i.test(tail) ? true : /\bsupporting\b/i.test(tail) ? false : null;
      const sourceNotes = tail.replace(/^\s*—\s*/, "").trim() || null;
      if (role) current.role = role;
      if (required != null) current.required = required;
      if (sourceNotes) current.sourceNotes = sourceNotes;
      byFilename.set(filename, current);
    }
    const references = [...byFilename.values()].map((item) => ({
      ...item,
      sourceRelation: item.storyboardDeclared && item.loadedForGeneratedFrame
        ? "storyboard_declared_and_loaded_for_generated_frame"
        : item.storyboardDeclared ? "storyboard_declared" : "loaded_for_generated_frame"
    }));
    if (references.length) result.set(clipId, references);
  }
  return result;
}

function csvReferenceList(value) {
  const values = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error(`CSV reference list contains a duplicate: ${value}`);
  return values;
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
    const declaredFiles = new Set();
    for (const line of text.replace(/\r\n/g, "\n").split("\n").filter(Boolean)) {
      const match = line.match(/^([0-9a-f]{64})\s{2,}(.+)$/i);
      if (!match) throw new Error(`Malformed ${definition.chapterId} SHA manifest line: ${line}`);
      let relative = match[2].replace(/\\/g, "/");
      if (definition.rootEntry && relative.startsWith(`${definition.rootEntry}/`)) relative = relative.slice(definition.rootEntry.length + 1);
      relative = normalizedRelative(relative);
      if (declaredFiles.has(relative.toLowerCase())) throw new Error(`${definition.chapterId} full manifest contains a duplicate/case-colliding path: ${relative}`);
      declaredFiles.add(relative.toLowerCase());
      const file = safeSourcePath(packageRoot, relative);
      if (sha256File(file) !== match[1].toLowerCase()) throw new Error(`${definition.chapterId} manifest hash mismatch: ${relative}`);
      if (relative.startsWith("first_frames/")) result.set(relative, { sha256: match[1].toLowerCase(), bytes: fs.statSync(file).size });
    }
    const actualFiles = [];
    const visit = (directory, prefix = "") => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
        else if (entry.isFile() && relative !== definition.shaManifest) actualFiles.push(relative.toLowerCase());
        else if (!entry.isFile()) throw new Error(`${definition.chapterId} extracted package contains a non-regular entry: ${relative}`);
      }
    };
    visit(packageRoot);
    actualFiles.sort();
    const declaredSorted = [...declaredFiles].sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(declaredSorted)) throw new Error(`${definition.chapterId} full SHA manifest does not exactly cover every package file except itself`);
  }
  if (definition.frameShaCsv) {
    const rows = parseCsv(fs.readFileSync(safeSourcePath(packageRoot, definition.frameShaCsv), "utf8"));
    for (const row of rows) {
      const relative = row.first_frame || `first_frames/${row.filename}`;
      const entry = { sha256: row.sha256.toLowerCase(), bytes: Number(row.bytes) };
      const existing = result.get(relative);
      if (existing && (existing.sha256 !== entry.sha256 || existing.bytes !== entry.bytes)) throw new Error(`${definition.chapterId} frame CSV differs from its full manifest: ${relative}`);
      result.set(relative, entry);
    }
  }
  if (definition.frameShaJson) {
    const manifest = JSON.parse(fs.readFileSync(safeSourcePath(packageRoot, definition.frameShaJson), "utf8"));
    for (const [relative, sha256] of Object.entries(manifest)) {
      const normalized = normalizedRelative(relative);
      const entry = { sha256: String(sha256).toLowerCase(), bytes: fs.statSync(safeSourcePath(packageRoot, normalized)).size };
      const existing = result.get(normalized);
      if (existing && (existing.sha256 !== entry.sha256 || existing.bytes !== entry.bytes)) throw new Error(`${definition.chapterId} frame JSON differs from another package manifest: ${normalized}`);
      result.set(normalized, entry);
    }
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

function referenceDeclarationsForRow(definition, row, sourceSections) {
  const declarations = sourceSections.get(row.clip_id) || [];
  const byFilename = new Map(declarations.map((item) => [item.filename, item]));
  if (definition.referenceSchema === "storyboard_generation_union") {
    const storyboardFiles = csvReferenceList(row.storyboard_references);
    const generationFiles = csvReferenceList(row.generation_references);
    const markdownStoryboard = declarations.filter((item) => item.storyboardDeclared).sort((a, b) => a.storyboardOrder - b.storyboardOrder).map((item) => item.filename);
    const markdownGeneration = declarations.filter((item) => item.loadedForGeneratedFrame).sort((a, b) => a.generationOrder - b.generationOrder).map((item) => item.filename);
    if (JSON.stringify(storyboardFiles) !== JSON.stringify(markdownStoryboard)) throw new Error(`${row.clip_id} storyboard CSV/source-reference section mismatch`);
    if (JSON.stringify(generationFiles) !== JSON.stringify(markdownGeneration)) throw new Error(`${row.clip_id} generation CSV/source-reference section mismatch`);
    return [...storyboardFiles, ...generationFiles.filter((filename) => !storyboardFiles.includes(filename))].map((filename) => {
      const declaration = byFilename.get(filename);
      if (!declaration) throw new Error(`${row.clip_id} source reference has no package declaration: ${filename}`);
      return declaration;
    });
  }
  const csvFiles = csvReferenceList(row.references);
  const markdownFiles = declarations.map((item) => item.filename);
  if (JSON.stringify(csvFiles) !== JSON.stringify(markdownFiles)) throw new Error(`${row.clip_id} CSV/source-reference mismatch`);
  return csvFiles.map((filename) => byFilename.get(filename));
}

function readJsonPackageFile(packageRoot, relative) {
  const file = safeSourcePath(packageRoot, relative);
  try {
    return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    throw new Error("Cannot parse package JSON " + relative + ": " + error.message);
  }
}

function packageChecksumManifest(packageRoot, definition, entries) {
  const manifestFile = safeSourcePath(packageRoot, definition.checksumManifest);
  const manifest = new Map();
  for (const line of fs.readFileSync(manifestFile, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error("Malformed " + definition.checksumManifest + " line: " + line);
    const relative = normalizedRelative(match[2]);
    const key = relative.toLowerCase();
    if (manifest.has(key)) throw new Error("Checksum manifest contains a duplicate/case collision: " + relative);
    manifest.set(key, { relative, sha256: match[1] });
  }
  const prefix = definition.rootEntry + "/";
  const packageFiles = entries.filter((entry) => !entry.directory).map((entry) => {
    if (!entry.name.startsWith(prefix)) throw new Error("ZIP entry is outside the fixed package root: " + entry.name);
    return entry.name.slice(prefix.length);
  });
  const expected = packageFiles.filter((relative) => relative !== definition.checksumManifest);
  if (manifest.size !== expected.length || packageFiles.length !== definition.expectedEntries) {
    throw new Error(definition.chapterId + " checksum/entry count differs: manifest " + manifest.size + ", files " + packageFiles.length);
  }
  for (const relative of expected) {
    const declared = manifest.get(relative.toLowerCase());
    if (!declared || declared.relative !== relative) throw new Error("Checksum manifest does not name the exact archive entry: " + relative);
    const actual = sha256File(safeSourcePath(packageRoot, relative));
    if (actual !== declared.sha256) throw new Error("Checksum mismatch: " + relative);
  }
  for (const item of manifest.values()) if (!expected.includes(item.relative)) throw new Error("Checksum manifest names an absent entry: " + item.relative);
  return { manifestFile, manifest };
}

function exactKeySet(value, expected, label) {
  const actual = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(label + " key set differs from the fixed package target");
}

function loadPackage(definition, archivePath) {
  const extracted = extractVerifiedArchive(archivePath, definition);
  try {
    if (extracted.entries.length !== definition.expectedEntries) {
      throw new Error(definition.chapterId + " expected " + definition.expectedEntries + " ZIP entries; received " + extracted.entries.length);
    }
    const totalUncompressed = extracted.entries.reduce((sum, entry) => sum + entry.uncompressedBytes, 0);
    if (totalUncompressed !== 115715428) throw new Error("Unexpected H10 uncompressed byte total: " + totalUncompressed);
    for (const entry of extracted.entries) {
      if (!entry.directory && entry.compressedBytes > 0 && entry.uncompressedBytes / entry.compressedBytes > 20) {
        throw new Error("Unexpected H10 ZIP expansion ratio: " + entry.name);
      }
    }

    const checksum = packageChecksumManifest(extracted.packageRoot, definition, extracted.entries);
    const bindingsSource = readJsonPackageFile(extracted.packageRoot, definition.bindings);
    const framesSource = readJsonPackageFile(extracted.packageRoot, definition.frameManifest);
    const promptsSource = readJsonPackageFile(extracted.packageRoot, definition.prompts);
    const storyboardSource = readJsonPackageFile(extracted.packageRoot, definition.storyboard);
    const plansSource = readJsonPackageFile(extracted.packageRoot, definition.videoPlans);
    const bindings = bindingsSource.value;
    const frameRecords = framesSource.value;
    const prompts = promptsSource.value;
    const packageStoryboard = storyboardSource.value;
    const imagePlans = plansSource.value;

    if (packageStoryboard.projectId !== "harrowing_of_hell" || packageStoryboard.chapter?.id !== "H10") {
      throw new Error("H10 metadata is scoped to a different project/chapter");
    }
    if (!Array.isArray(frameRecords) || frameRecords.length !== definition.expectedFrames) {
      throw new Error("H10 frame manifest must contain exactly " + definition.expectedFrames + " rows");
    }
    const clipIds = Object.values(packageStoryboard.clips || {}).sort((a, b) => Number(a.order) - Number(b.order)).map((clip) => clip.id);
    if (clipIds.length !== definition.expectedClips || new Set(clipIds).size !== definition.expectedClips
      || clipIds.some((clipId) => !/^H10-S(?:31|32|33|34)-C\d{2}$/.test(clipId))) {
      throw new Error("H10 package does not contain exactly the 11 canonical H10 clips");
    }
    exactKeySet(bindings, clipIds, "H10 bindings");
    exactKeySet(prompts, clipIds, "H10 prompts");
    exactKeySet(imagePlans, clipIds.map((clipId) => packageStoryboard.clips[clipId].videoPlanId), "H10 all-image plans");

    const frameManifest = new Map();
    for (const record of frameRecords) {
      const clipId = String(record.clipId || "");
      const number = Number(record.timedSegment);
      const expectedFile = "frames/" + clipId + "_seg" + String(number).padStart(2, "0") + ".png";
      if (!clipIds.includes(clipId) || !Number.isInteger(number) || number < 1 || number > 3
        || record.file !== expectedFile || Number(record.width) !== 1920 || Number(record.height) !== 804
        || !/^[a-f0-9]{64}$/.test(record.sha256 || "") || frameManifest.has(expectedFile)) {
        throw new Error("Invalid or duplicate H10 frame-manifest row: " + JSON.stringify(record));
      }
      const file = safeSourcePath(extracted.packageRoot, expectedFile);
      const buffer = fs.readFileSync(file);
      const dimensions = pngDimensions(buffer);
      if (dimensions.width !== 1920 || dimensions.height !== 804
        || buffer.readUInt8(24) !== 8 || buffer.readUInt8(25) !== 2 || buffer.readUInt8(28) !== 0) {
        throw new Error(expectedFile + " is not an exact 1920x804 RGB8 non-interlaced PNG");
      }
      const sha256 = sha256Buffer(buffer);
      if (sha256 !== record.sha256 || checksum.manifest.get(expectedFile.toLowerCase())?.sha256 !== sha256) {
        throw new Error("H10 frame manifest/checksum mismatch: " + expectedFile);
      }
      frameManifest.set(expectedFile, { sha256, bytes: buffer.length });
    }

    const promptPackage = { prompts: new Map(), clipGlobals: new Map(), visualLock: "", negativePrompt: null };
    const rows = [];
    const sourceSections = new Map();
    const uniquePrompts = new Set();
    const sourceAssetFiles = new Set();
    let referenceBindingCount = 0;
    const negativePrompts = new Set();

    for (const clipId of clipIds) {
      const packageClip = packageStoryboard.clips[clipId];
      const planId = packageClip.videoPlanId;
      const plan = imagePlans[planId];
      const promptRecord = prompts[clipId];
      const binding = bindings[clipId];
      const expectedFirstFrameId = "frame-" + clipId.toLowerCase() + "-first";
      if (!plan || plan.id !== planId || plan.clipId !== clipId || binding.firstFrameId !== expectedFirstFrameId
        || !Array.isArray(plan.segmentIds) || plan.segmentIds.length !== 3
        || !Array.isArray(plan.timelineData?.segments) || plan.timelineData.segments.length !== 3
        || !Array.isArray(promptRecord?.timedSegmentPrompts) || promptRecord.timedSegmentPrompts.length !== 3
        || !Array.isArray(binding.generatedGuides) || binding.generatedGuides.length !== 3
        || !Array.isArray(binding.references) || !binding.references.length) {
        throw new Error(clipId + " package coverage/identity is incomplete");
      }
      if (plan.workflowProfileId !== "ltx-director-i2v-2.3-22b-distilled-1.1"
        || plan.status !== "ready_with_all_segment_guides" || plan.guideCoverage?.complete !== true
        || Number(plan.guideCoverage?.actualImageGuides) !== 3 || Number(plan.guideCoverage?.timedSegments) !== 3) {
        throw new Error(clipId + " all-image plan readiness contract differs");
      }
      promptPackage.clipGlobals.set(clipId, plan.globalPrompt);
      negativePrompts.add(String(promptRecord.negativePrompt || ""));

      const referenceDeclarations = [];
      const seenReferences = new Set();
      for (let index = 0; index < binding.references.length; index += 1) {
        const reference = binding.references[index];
        const filename = normalizedRelative(reference.sourceAssetFile);
        if (filename.includes("/") || seenReferences.has(filename) || Number(reference.order) !== index + 1
          || reference.targetKind !== "frame" || reference.targetId !== expectedFirstFrameId
          || reference.useMode !== "direct_conditioning" || reference.resolutionStatus !== "resolved_exact_version"
          || reference.assetVersionId !== reference.assetId + ":v" + Number(reference.assetVersion)) {
          throw new Error(clipId + " has an invalid/duplicate source-reference declaration: " + filename);
        }
        seenReferences.add(filename);
        sourceAssetFiles.add(filename);
        const packageSource = safeSourcePath(extracted.packageRoot, "source_refs/" + filename);
        const packageSourceSha256 = sha256File(packageSource);
        if (checksum.manifest.get(("source_refs/" + filename).toLowerCase())?.sha256 !== packageSourceSha256) {
          throw new Error(clipId + " source-reference checksum differs: " + filename);
        }
        referenceDeclarations.push({
          filename,
          role: reference.role || referenceRole(filename),
          required: Boolean(reference.required),
          sourceNotes: [reference.cropRegion, reference.notes].filter(Boolean).join(" "),
          sourceRelation: "loaded_for_generated_frame",
          storyboardDeclared: false,
          loadedForGeneratedFrame: true,
          packageSourceSha256,
          packageSourceBytes: fs.statSync(packageSource).size,
          packagePinnedActiveAtImport: Boolean(reference.pinnedActiveAtImport)
        });
      }
      sourceSections.set(clipId, referenceDeclarations);
      referenceBindingCount += referenceDeclarations.length * 3;

      for (let number = 1; number <= 3; number += 1) {
        const segmentId = plan.segmentIds[number - 1];
        const timeline = plan.timelineData.segments[number - 1];
        const timedPrompt = promptRecord.timedSegmentPrompts[number - 1];
        const firstFrame = "frames/" + clipId + "_seg" + String(number).padStart(2, "0") + ".png";
        if (timeline.id !== segmentId || timedPrompt.segment !== number || timedPrompt.segmentId !== segmentId
          || timeline.start < 0 || timeline.length < 1 || timeline.type !== "image"
          || timeline.imageFile !== firstFrame || timedPrompt.image !== firstFrame
          || binding.generatedGuides[number - 1] !== firstFrame || timeline.prompt !== timedPrompt.prompt
          || !frameManifest.has(firstFrame)) {
          throw new Error(clipId + " SEG" + String(number).padStart(2, "0") + " mapping differs across package metadata");
        }
        const key = clipId + ":SEG" + String(number).padStart(2, "0");
        if (!timedPrompt.prompt || uniquePrompts.has(timedPrompt.prompt) || promptPackage.prompts.has(key)) {
          throw new Error("Missing or duplicate H10 segment prompt: " + key);
        }
        uniquePrompts.add(timedPrompt.prompt);
        promptPackage.prompts.set(key, { firstFrame, prompt: timedPrompt.prompt, packagePrompt: timedPrompt.prompt });
        rows.push({
          clip_id: clipId,
          segment: "SEG" + String(number).padStart(2, "0"),
          source_segment_id: segmentId,
          first_frame: firstFrame,
          start_frame: timeline.start,
          length_frames: timeline.length,
          referenceDeclarations
        });
      }
      if (plan.localPrompts !== plan.timelineData.segments.map((segment) => segment.prompt).join(" | ")
        || plan.segmentLengths !== plan.timelineData.segments.map((segment) => String(segment.length)).join(",")) {
        throw new Error(clipId + " flattened package plan differs from its timeline");
      }
    }

    if (rows.length !== definition.expectedFrames || promptPackage.prompts.size !== definition.expectedFrames
      || uniquePrompts.size !== definition.expectedFrames || frameManifest.size !== definition.expectedFrames
      || referenceBindingCount !== definition.expectedReferenceBindings || sourceAssetFiles.size !== definition.expectedSourceAssets) {
      throw new Error("H10 fixed totals differ: clips=" + clipIds.length + ", frames=" + rows.length + ", refs=" + referenceBindingCount + ", sources=" + sourceAssetFiles.size);
    }
    if (negativePrompts.size !== 1) throw new Error("H10 package negative prompts are not identical");
    promptPackage.negativePrompt = [...negativePrompts][0];

    const expectedFrameFiles = new Set(rows.map((row) => row.first_frame));
    if ([...frameManifest.keys()].some((file) => !expectedFrameFiles.has(file))
      || new Set(rows.map((row) => row.source_segment_id)).size !== definition.expectedFrames
      || new Set(rows.map((row) => frameManifest.get(row.first_frame).sha256)).size !== definition.expectedFrames) {
      throw new Error("H10 prompt/frame/segment manifests are not a one-to-one mapping");
    }

    return {
      definition,
      ...extracted,
      rows,
      clipIds,
      promptPackage,
      sourceSections,
      frameManifest,
      sourceExtract: null,
      packagePlans: { clips: clipIds.map((clipId) => packageStoryboard.clips[clipId]), videoPlans: imagePlans },
      packageStoryboard,
      referenceBindingCount,
      sourceAssetFiles,
      consumedHashes: {
        checksumManifestSha256: sha256File(checksum.manifestFile),
        bindingsSha256: sha256File(bindingsSource.file),
        frameManifestSha256: sha256File(framesSource.file),
        promptsSha256: sha256File(promptsSource.file),
        storyboardExtractSha256: sha256File(storyboardSource.file),
        videoPlansSha256: sha256File(plansSource.file)
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

function sourceReferencesForRow(row, assets) {
  return row.referenceDeclarations.map((declaration) => {
    const asset = assets.get(declaration.filename);
    if (!asset || (declaration.packageSourceSha256 && asset.sha256 !== declaration.packageSourceSha256)
      || (declaration.packageSourceBytes != null && asset.bytes !== declaration.packageSourceBytes)) {
      throw new Error(`Bundled H10 source reference differs from the exact project asset version: ${declaration.filename}`);
    }
    if (declaration.packagePinnedActiveAtImport != null
      && asset.pinnedActiveAtImport !== declaration.packagePinnedActiveAtImport) {
      throw new Error(`H10 source-reference active-version flag drifted: ${declaration.filename}`);
    }
    return {
      ...asset,
      role: declaration.role || referenceRole(declaration.filename),
      required: declaration.required ?? !/^(?:fx-|atmo-)/i.test(declaration.filename),
      sourceNotes: declaration.sourceNotes,
      sourceRelation: declaration.sourceRelation,
      storyboardDeclared: declaration.storyboardDeclared,
      loadedForGeneratedFrame: declaration.loadedForGeneratedFrame
    };
  });
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
    useMode: reference.loadedForGeneratedFrame ? "first_frame_source_provenance" : "storyboard_declared_context_provenance",
    sourceRelation: reference.sourceRelation,
    storyboardDeclared: reference.storyboardDeclared,
    loadedForGeneratedFrame: reference.loadedForGeneratedFrame,
    required: reference.required,
    order: index + 1,
    cropRegion: "Provenance/display only; never use this semantic source as a temporal guide or direct runtime conditioning input.",
    notes: `${chapterId} complete-package provenance (${reference.sourceRelation}). ${reference.storyboardDeclared && !reference.loadedForGeneratedFrame
      ? "Storyboard-declared semantic context only; the package does not claim this asset was loaded for generation."
      : reference.loadedForGeneratedFrame && !reference.storyboardDeclared
        ? "Loaded for the generated segment frame; not declared by the storyboard source list."
        : "Storyboard-declared and loaded for the generated segment frame."} ${reference.sourceNotes || ""}`.trim(),
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
  const packageGlobal = stripLegacyGlobalDialogue(packageData.packagePlans?.videoPlans?.[clip.videoPlanId]?.globalPrompt || "");
  let prompt;
  if (clip.id === "H10-S34-C01" || clip.id === "H10-S34-C02") {
    prompt = [
      "PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — " + clip.id,
      "FIRST-FRAME AUTHORITY: Generate only the selected segment from its own supplied first frame; semantic source references are provenance/display only.",
      "",
      "GENERATION MODE",
      "Generate only the selected authored segment independently from its supplied first frame. Begin exactly from that image, animate only the selected local prompt, and do not execute action from another segment.",
      "",
      "CURRENT CANONICAL STORY",
      "- Beat: " + clip.beat,
      "- Camera: " + clip.shotSizeLens + "; " + clip.cameraMovement,
      "- Transition: " + clip.transition,
      "",
      "CURRENT CONTINUITY LOCKS — AUTHORITATIVE",
      ...(clip.continuityLocks || []).map((lock) => "- " + lock),
      "",
      clip.id === "H10-S34-C01"
        ? "No Jesus or Jesus-derived identity, anatomy, wardrobe, wound, face, weapon, key, or silhouette may appear."
        : "The stone never moves. Show no person behind it and no resurrection reveal. At 16.5 seconds cut to perfectly uniform clean black and hold through 18.0 seconds. Generate no title card, lettering, logo, mark, caption, or visible symbol.",
      "",
      "GENERATION CONTRACT: SEGMENTED IMAGE-TO-VIDEO. This queue item is one independent 6-second authored segment, never the whole clip. Use only its selected first frame and selected local prompt."
    ].join("\n");
  } else {
    prompt = [
      "PREMIERE316 LTX-2.5 SEGMENTED IMAGE-TO-VIDEO — " + clip.id,
      "FIRST-FRAME AUTHORITY: Generate only the selected segment from its own supplied first frame; semantic source references are provenance/display only.",
      "",
      packageGlobal
    ].join("\n");
    prompt = prompt.replace(
      /Create one \d+-second photorealistic live-action biblical-epic render at 24 fps from the approved first-frame guide, framed for a 2\.39:1 master\./gi,
      "Generate only the currently selected authored segment at 24 fps from its own approved first-frame guide, framed for a 2.39:1 master."
    );
    prompt = prompt.replace(
      /Local segment prompts define interval-specific action; maintain compatible continuity between them because prompt influence blends across boundaries\./gi,
      "The selected local segment prompt alone defines this queue item's interval-specific action. Preserve incoming visual state, but do not execute or blend action from adjacent segments."
    );
    prompt = prompt.replace(
      /Animate each timed interval from its assigned segment first-frame PNG\./gi,
      "Animate only the currently selected timed interval from its own assigned segment first-frame PNG."
    );
    prompt = prompt.replace(/The complete visual beat is:/gi, "Whole-clip editorial context only; execute it only where the selected local segment prompt explicitly calls for it:");
    prompt = prompt.replace(/\bFull beat:/gi, "Whole-clip editorial context only; execute it only where the selected local segment prompt explicitly calls for it:");
    const missingLocks = (clip.continuityLocks || []).filter((lock) => !prompt.toLowerCase().includes(String(lock).toLowerCase()));
    if (missingLocks.length) prompt += "\n\nCURRENT CONTINUITY LOCKS — AUTHORITATIVE\n" + missingLocks.map((lock) => "- " + lock).join("\n");
    if (clip.id === "H10-S33-C02") {
      prompt += "\n\nSPECIFIC PROP PRECEDENCE: The supplied guide and the specific golden-keys lock permit the golden keys when visible. Treat the generic empty-hands illumination lock as a no-sword/no-weapon constraint; never erase the authored keys or turn them into a blade.";
    }
    prompt += "\n\nGENERATION CONTRACT: SEGMENTED IMAGE-TO-VIDEO. This queue item is one independent 5–6 second authored segment, never the whole clip. Use only its selected first frame and selected local prompt.";
  }
  return withGlobalDialogueContract(prompt);
}
function activeProjectJobs(slug, _clipIds) {
  const matches = [];
  for (const filename of ["generation-jobs.json", "director-generation-jobs.json"]) {
    const file = path.join(projectDir(slug), filename);
    if (!fs.existsSync(file)) continue;
    let ledger;
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`Cannot safely parse target generation ledger ${file}: ${error.message}`); }
    if (!Array.isArray(ledger.jobs)) throw new Error(`Target generation ledger has an unexpected shape: ${file}`);
    for (const job of ledger.jobs || []) {
      const jobSlug = job.projectSlug || job.refs?.projectSlug || job.refs?.binding?.projectSlug;
      if (ACTIVE_STATUSES.has(job.status) && (!jobSlug || jobSlug === slug)) matches.push(`${filename}:${job.id}:${job.status}`);
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

function liveQueuePreflight(projectSlug, _clipIds) {
  const results = {};
  for (const url of ["http://127.0.0.1:8188/queue", "http://127.0.0.1:8789/api/queue", "http://127.0.0.1:8791/api/queue"]) {
    const queue = getJsonSync(url);
    if (Array.isArray(queue.queue_running) && Array.isArray(queue.queue_pending)) {
      const running = queue.queue_running.length;
      const pending = queue.queue_pending.length;
      if (running || pending) throw new Error(`Cannot update H10 while live ComfyUI queue is busy (${url}: ${running} running, ${pending} pending)`);
      results[url] = "empty_comfy_queue";
      continue;
    }
    if (Array.isArray(queue.jobs)) {
      const active = queue.jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
      if (active.length) throw new Error(`Cannot update H10 while an app queue has any active job (${url}): ${active.map((job) => `${job.id}:${job.status}`).join(", ")}`);
      results[url] = "no_active_app_jobs";
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

function orderedChapterClipIds(storyboard, chapterId) {
  const chapter = storyboard.chapters?.[chapterId];
  if (!chapter) throw new Error(`Storyboard chapter is missing: ${chapterId}`);
  return (chapter.sceneIds || []).flatMap((sceneId) => storyboard.scenes?.[sceneId]?.clipIds || []);
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
    for (const key of ["firstFrameId", "generationMode", "referenceMode", "renderStatus", "renderError"]) delete value[key];
    clips[clipId] = value;
  }
  const plans = {};
  for (const planId of targets.plans) {
    const value = structuredClone(storyboard.videoPlans[planId]);
    for (const key of ["generationMode", "referenceMode", "workflowProfileId", "globalPrompt", "localPrompts", "segmentLengths", "guideStrength", "status", "inputHash", "activeGeneratedVersion", "generatedFile", "generatedInputPath", "lastError", "activeRenderPromptId", "renderQueuedAt", "firstFramePackage"]) delete value[key];
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
    const packageClipOrder = packageData.packagePlans.clips.map((clip) => clip.id);
    const currentClipOrder = orderedChapterClipIds(storyboard, packageData.definition.chapterId);
    if (JSON.stringify(packageClipOrder) !== JSON.stringify(currentClipOrder)) throw new Error(`${packageData.definition.chapterId} package/current clip ordering differs`);
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
      const declaredPrompt = packageData.promptPackage.prompts.get(key);
      if (!declaredPrompt) throw new Error(`Fixed package prompt is missing: ${key}`);
      const preserveCanonicalPrompt = clipId === "H10-S34-C02";
      if (preserveCanonicalPrompt) {
        if ((number >= 2 && !/black and title|final title fade/i.test(declaredPrompt.prompt))
          || /black and title|title fade/i.test(segment.prompt)
          || !/sealed|stone does not move|uniform clean black/i.test(segment.prompt)) {
          throw new Error(`${key} no longer matches the audited stale-package/corrected-canonical ending contract`);
        }
      }
      const packagePrompt = preserveCanonicalPrompt
        ? { ...declaredPrompt, prompt: segment.prompt, packagePrompt: declaredPrompt.prompt, promptSource: "canonical_corrected_h10_s34_c02" }
        : { ...declaredPrompt, packagePrompt: declaredPrompt.prompt, promptSource: "fixed_h10_package" };
      rowsByKey.set(key, { packageData, row, clipId, clip, plan, segmentId, segment, number, packagePrompt });
    }
    for (const clipId of packageData.clipIds) {
      const plan = storyboard.videoPlans[storyboard.clips[clipId].videoPlanId];
      const clip = storyboard.clips[clipId];
      const packageClip = packageData.packagePlans.clips.find((item) => item.id === clipId);
      const count = packageData.rows.filter((row) => row.clip_id === clipId).length;
      if (count !== plan.segmentIds.length) throw new Error(`${clipId} package/current segment count differs`);
      if (packageData.packagePlans) {
        const packagePlan = packageData.packagePlans.videoPlans?.[plan.id];
        if (!packagePlan || packagePlan.clipId !== clipId || JSON.stringify(packagePlan.segmentIds) !== JSON.stringify(plan.segmentIds)) throw new Error(`${clipId} package plan IDs differ from current storyboard`);
        if (!packageClip || Number(packageClip.timelineStartFrame) + FPS !== Number(clip.timelineStartFrame)) throw new Error(`${clipId} package absolute start does not have the audited -24-frame offset from canonical current timing`);
        if (Number(packageClip.durationFrames) !== Number(clip.durationFrames) || Number(packagePlan.timelineData?.normalDurationFrames) !== Number(clip.durationFrames)) throw new Error(`${clipId} package/current duration differs`);
      }
      const projectedGlobal = normalizedGlobalPrompt(packageData, clip, plan);
      if (!/SEGMENTED IMAGE-TO-VIDEO/i.test(projectedGlobal) || !/first[- ]frame/i.test(projectedGlobal)
        || /Create one \d+-second/i.test(projectedGlobal) || /prompt influence blends across boundaries/i.test(projectedGlobal)
        || /Animate each timed interval/i.test(projectedGlobal) || /\bFull beat:/i.test(projectedGlobal)) {
        throw new Error(`${clipId} projected global prompt violates the independent segmented-I2V contract`);
      }
      for (const lock of clip.continuityLocks || []) if (!projectedGlobal.toLowerCase().includes(String(lock).toLowerCase())) throw new Error(`${clipId} projected global prompt loses a canonical continuity lock: ${lock}`);
    }
    allClipIds.push(...packageData.clipIds);
  }
  const packagePrompts = packages.flatMap((packageData) => [...packageData.promptPackage.prompts.values()].map((entry) => entry.prompt));
  const effectivePrompts = [...rowsByKey.values()].map((context) => context.packagePrompt.prompt);
  if (new Set(allClipIds).size !== allClipIds.length || rowsByKey.size !== 33 || allClipIds.length !== 11) throw new Error("H10 package target set is not exactly 11 clips / 33 segments");
  if (packagePrompts.length !== 33 || new Set(packagePrompts).size !== 33
    || effectivePrompts.length !== 33 || new Set(effectivePrompts).size !== 33) {
    throw new Error("H10 package/effective projection does not contain 33 unique segment prompts");
  }
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
    sourceRelation: reference.sourceRelation,
    storyboardDeclared: reference.storyboardDeclared,
    loadedForGeneratedFrame: reference.loadedForGeneratedFrame,
    pinnedActiveAtImport: reference.pinnedActiveAtImport
  }));
}

function verifyImportedState(storyboard, mediaDirectory, receipt, { packages = [], assets = null } = {}) {
  validateStoryboard(storyboard, "harrowing_of_hell");
  if (receipt.packageId !== PACKAGE_ID || receipt.frames?.length !== 33 || receipt.clipIds?.length !== 11) throw new Error("H10 import receipt count or identity is invalid");
  if (new Set(receipt.clipIds).size !== 11 || receipt.frames.reduce((sum, item) => sum + Number(item.sourceReferenceCount || 0), 0) !== 189) {
    throw new Error("H10 import receipt clip/provenance-binding totals are invalid");
  }
  for (const field of ["segmentId", "frameId", "filename"]) {
    if (new Set(receipt.frames.map((item) => item[field])).size !== 33) throw new Error(`Receipt does not contain 33 unique ${field} values`);
  }
  if (new Set(receipt.frames.map((item) => item.prompt)).size !== 33) throw new Error("The 33 imported segment prompts are not unique");
  const targets = targetSets(storyboard, receipt.clipIds);
  if (receipt.nonTargetSnapshotSha256 && stableHash(nonTargetSnapshot(storyboard, targets)) !== receipt.nonTargetSnapshotSha256) throw new Error("Non-target storyboard state differs from the import receipt");
  if (receipt.targetInvariantSha256 && stableHash(invariantSnapshot(storyboard, targets)) !== receipt.targetInvariantSha256) throw new Error("Protected target timing, ordering, continuity, history, or plan-reference state differs from the import receipt");

  const packageByClip = new Map(packages.flatMap((packageData) => packageData.clipIds.map((clipId) => [clipId, packageData])));
  if (packages.length) {
    const expectedArchiveHashes = Object.fromEntries(packages.map((item) => [item.definition.chapterId, item.archiveSha256]));
    if (stableHash(receipt.archiveHashes) !== stableHash(expectedArchiveHashes)) throw new Error("Receipt archive hash differs from the fixed H10 package");
    const receiptPackages = new Map((receipt.packages || []).map((item) => [item.chapterId, item]));
    for (const packageData of packages) {
      const actual = receiptPackages.get(packageData.definition.chapterId);
      const expected = {
        chapterId: packageData.definition.chapterId,
        archiveFile: path.basename(packageData.archivePath),
        archiveSha256: packageData.archiveSha256,
        archiveBytes: packageData.definition.archiveBytes,
        ...packageData.consumedHashes,
        clips: packageData.clipIds.length,
        frames: packageData.rows.length
      };
      if (!actual || stableHash(actual) !== stableHash(expected)) throw new Error(`${packageData.definition.chapterId} receipt package metadata/hashes differ from the fixed archive`);
      const actualCount = receipt.frames.filter((item) => packageByClip.get(item.clipId) === packageData).reduce((sum, item) => sum + item.sourceReferenceCount, 0);
      if (actualCount !== packageData.definition.expectedReferenceBindings) throw new Error(`${packageData.definition.chapterId} receipt provenance-binding count differs from the fixed package`);
    }
  }
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
    if (!version || version.prompt !== item.prompt || version.promptHash !== item.promptHash
      || version.packagePrompt !== item.packagePrompt || version.packagePromptHash !== item.packagePromptHash
      || version.promptSource !== item.promptSource || version.sourceEntry !== item.sourceEntry
      || version.sourceArchiveSha256 !== item.archiveSha256 || version.fileHashes?.length !== 1
      || version.fileHashes[0].file !== item.filename || version.fileHashes[0].bytes !== item.bytes || version.fileHashes[0].sha256 !== item.sha256) {
      throw new Error(`Imported frame history differs: ${item.frameId}`);
    }
    const bindings = Object.values(storyboard.referenceBindings || {})
      .filter((binding) => binding.targetKind === "frame" && binding.targetId === item.frameId)
      .sort((a, b) => a.order - b.order);
    const frameReferenceList = [...(frame.references || [])].sort((a, b) => a.order - b.order);
    if (bindings.length !== item.sourceReferenceCount || frameReferenceList.length !== item.sourceReferenceCount || stableHash(bindings) !== stableHash(frameReferenceList)) throw new Error(`Imported frame/reference-binding mirror differs: ${item.frameId}`);
    const packageData = packageByClip.get(item.clipId);
    const packageRow = packageData?.rows.find((row) => row.clip_id === item.clipId && rowSegmentNumber(row) === item.segmentNumber) || null;
    let expectedSourceReferences = null;
    if (packageData && assets) {
      if (!packageRow) throw new Error(`Fixed package row is missing during imported-state verification: ${item.clipId}:SEG${String(item.segmentNumber).padStart(2, "0")}`);
      expectedSourceReferences = sourceReferencesForRow(packageRow, assets);
      const exactExpectedBindings = frameReferences(item.frameId, expectedSourceReferences, packageData.definition.chapterId).sort((a, b) => a.order - b.order);
      if (stableHash(frameReferenceList) !== stableHash(exactExpectedBindings) || stableHash(bindings) !== stableHash(exactExpectedBindings)) {
        throw new Error(`Imported full provenance-only frame reference contract differs from the fixed package: ${item.frameId}`);
      }
    }
    const actualReferences = frameReferenceList.map((reference) => ({
      assetId: reference.assetId,
      assetVersion: reference.assetVersion,
      assetVersionId: reference.assetVersionId,
      sourceAssetFile: reference.sourceAssetFile,
      role: reference.role,
      required: reference.required,
      sourceRelation: reference.sourceRelation,
      storyboardDeclared: reference.storyboardDeclared,
      loadedForGeneratedFrame: reference.loadedForGeneratedFrame,
      pinnedActiveAtImport: reference.pinnedActiveAtImport
    }));
    const receiptReferenceList = item.sourceReferences.map(({ sha256: _sha256, bytes: _bytes, ...reference }) => reference);
    if (stableHash(actualReferences) !== stableHash(receiptReferenceList)) throw new Error(`Imported exact-version reference set differs: ${item.frameId}`);
    const disk = path.join(mediaDirectory, item.filename);
    if (!disk.startsWith(`${mediaDirectory}${path.sep}`) || !fs.existsSync(disk) || fs.statSync(disk).size !== item.bytes || sha256File(disk) !== item.sha256) throw new Error(`Imported media verification failed: ${item.filename}`);

    const timeline = plan.timelineData?.segments?.find((candidate) => candidate.id === item.segmentId);
    if (!timeline || timeline.start !== segment.startFrame || timeline.length !== segment.lengthFrames || timeline.prompt !== item.prompt || timeline.type !== "image"
      || timeline.fileName !== item.filename || timeline.storyboardFrameId !== item.frameId || timeline.imageFile !== frame.expectedInputPath) throw new Error(`Imported timeline mirror differs: ${item.segmentId}`);

    if (packageData) {
      const key = `${item.clipId}:SEG${String(item.segmentNumber).padStart(2, "0")}`;
      const packagePrompt = packageData.promptPackage.prompts.get(key);
      const packageFrame = packageData.frameManifest.get(item.sourceEntry);
      const canonicalOverride = item.clipId === "H10-S34-C02";
      const expectedPrompt = canonicalOverride ? storyboard.segments[item.segmentId].prompt : packagePrompt?.prompt;
      const expectedSource = canonicalOverride ? "canonical_corrected_h10_s34_c02" : "fixed_h10_package";
      if (!packagePrompt || expectedPrompt !== item.prompt || packagePrompt.prompt !== item.packagePrompt
        || item.promptSource !== expectedSource || packagePrompt.firstFrame !== item.sourceEntry
        || item.promptHash !== sha256Buffer(Buffer.from(item.prompt, "utf8"))
        || item.packagePromptHash !== sha256Buffer(Buffer.from(packagePrompt.prompt, "utf8"))
        || !packageFrame || packageFrame.sha256 !== item.sha256 || packageFrame.bytes !== item.bytes || packageData.archiveSha256 !== item.archiveSha256) throw new Error(`Receipt differs from fixed package: ${key}`);
      if (canonicalOverride && (/black and title|title fade/i.test(item.prompt) || !/sealed|stone does not move|uniform clean black/i.test(item.prompt))) {
        throw new Error(`Corrected canonical sealed-tomb prompt was not preserved: ${key}`);
      }
      if (assets) {
        const expectedReferences = receiptReferences(expectedSourceReferences);
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
    if (/Create one \d+-second/i.test(plan.globalPrompt) || /prompt influence blends across boundaries/i.test(plan.globalPrompt)
      || /Animate each timed interval/i.test(plan.globalPrompt) || /\bFull beat:/i.test(plan.globalPrompt)) throw new Error(`${plan.id} global prompt retains contradictory whole-clip/cross-segment generation language`);
    const packageData = packageByClip.get(clipId);
    if (packageData && plan.globalPrompt !== normalizedGlobalPrompt(packageData, clip, plan)) throw new Error(`${plan.id} global prompt differs from the normalized fixed package`);
  }
  const h10Relations = {};
  let inactivePins = 0;
  for (const item of receipt.frames) {
    for (const reference of item.sourceReferences) {
      h10Relations[reference.sourceRelation] = (h10Relations[reference.sourceRelation] || 0) + 1;
      if (!reference.pinnedActiveAtImport) inactivePins += 1;
    }
  }
  if (JSON.stringify(h10Relations) !== JSON.stringify({ loaded_for_generated_frame: 189 }) || inactivePins !== 6) {
    throw new Error("H10 receipt source-relation/title-card version-pin counts differ from the audited package contract");
  }
  if (receipt.backup) {
    const backup = path.resolve(projectDir("harrowing_of_hell"), ...receipt.backup.split("/"));
    const backupRoot = path.join(projectDir("harrowing_of_hell"), "production", "backups");
    if (!backup.startsWith(`${backupRoot}${path.sep}`) || !fs.existsSync(backup) || sha256File(backup) !== receipt.sourceStoryboardSha256) throw new Error("Import backup is missing, unsafe, or differs from the source storyboard hash");
  }
  return true;
}

export function defaultArchivePath() {
  return path.join(os.homedir(), "Downloads", PACKAGE_DEFINITION.archiveName);
}

export function inspectH10Package({ archivePath = defaultArchivePath() } = {}) {
  const packages = [];
  try {
    packages.push(loadPackage(PACKAGE_DEFINITION, archivePath));
    const allPrompts = packages.flatMap((item) => [...item.promptPackage.prompts.values()].map((entry) => entry.prompt));
    if (allPrompts.length !== 33 || new Set(allPrompts).size !== 33) throw new Error("H10 package does not contain 33 unique segment prompts");
    return {
      ok: true,
      packages: packages.map((item) => ({
        chapterId: item.definition.chapterId,
        archivePath: item.archivePath,
        archiveSha256: item.archiveSha256,
        clips: item.clipIds.length,
        frames: item.rows.length,
        referenceBindings: item.referenceBindingCount,
        referenceRelations: Object.fromEntries(Object.entries(item.rows.flatMap((row) => row.referenceDeclarations).reduce((counts, reference) => {
          counts[reference.sourceRelation] = (counts[reference.sourceRelation] || 0) + 1;
          return counts;
        }, {}))),
        sourceReferences: new Set([...item.sourceSections.values()].flatMap((entries) => entries.map((entry) => entry.filename))).size
      })),
      clips: packages.reduce((sum, item) => sum + item.clipIds.length, 0),
      frames: packages.reduce((sum, item) => sum + item.rows.length, 0),
      referenceBindings: packages.reduce((sum, item) => sum + item.referenceBindingCount, 0)
    };
  } finally {
    for (const item of packages) fs.rmSync(item.temporaryRoot, { recursive: true, force: true });
  }
}

export function importH10Ltx25I2vComplete({
  archivePath = defaultArchivePath(),
  projectSlug = "harrowing_of_hell",
  now = new Date(),
  dryRun = true
} = {}) {
  if (projectSlug !== "harrowing_of_hell") throw new Error("The H10 package is scoped only to harrowing_of_hell");
  const packages = [];
  try {
    packages.push(loadPackage(PACKAGE_DEFINITION, archivePath));
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
    const requiredAssetFiles = new Set(packages.flatMap((item) => item.rows.flatMap((row) => row.referenceDeclarations.map((entry) => entry.filename))));
    const assets = assetVersionIndex(project, projectSlug, requiredAssetFiles);
    if (priorReceipt && JSON.stringify(priorReceipt.archiveHashes) === JSON.stringify(archiveHashes)) {
      verifyImportedState(storyboard, mediaDirectory, priorReceipt, { packages, assets });
      return { dryRun, idempotent: true, storyboard, receipt: priorReceipt, backup: priorReceipt.backup || null };
    }
    if (priorReceipt) throw new Error(`${PACKAGE_ID} already exists with different archive hashes`);

    const active = activeProjectJobs(projectSlug, new Set(allClipIds));
    if (active.length) throw new Error(`Cannot update H10 while target generation is active: ${active.join(", ")}`);
    for (const clipId of allClipIds) {
      const clip = storyboard.clips[clipId];
      const plan = storyboard.videoPlans[clip.videoPlanId];
      if (ACTIVE_STATUSES.has(clip.renderStatus) || ACTIVE_STATUSES.has(plan.status) || plan.activeRenderPromptId) throw new Error(`Cannot update active plan: ${clipId}`);
    }
    const livePreflight = liveQueuePreflight(projectSlug, new Set(allClipIds));

    const historical = historicalStoryboard(projectSlug);
    const prepared = [];
    for (const context of rowsByKey.values()) {
      const { packageData, row, clipId, segmentId, segment, number, packagePrompt } = context;
      const key = `${clipId}:SEG${String(number).padStart(2, "0")}`;
      const sourceImage = safeSourcePath(packageData.packageRoot, packagePrompt.firstFrame);
      const buffer = fs.readFileSync(sourceImage);
      const dimensions = pngDimensions(buffer);
      const sha256 = sha256Buffer(buffer);
      const expectedHash = packageData.frameManifest.get(packagePrompt.firstFrame);
      if (!expectedHash || expectedHash.sha256 !== sha256 || expectedHash.bytes !== buffer.length) throw new Error(`Prepared frame hash mismatch: ${key}`);
      const frameId = frameIdFor(clipId, number);
      const sourceReferences = sourceReferencesForRow(row, assets);
      prepared.push({ packageData, row, clipId, segmentId, segment, number, key, packagePrompt, sourceImage, buffer, dimensions, sha256, frameId, sourceReferences });
    }

    const baseReceipt = {
      packageId: PACKAGE_ID,
      sourceStoryboardSha256: startingStoryboardSha256,
      archiveHashes,
      livePreflight,
      nonTargetSnapshotSha256: beforeNonTargetHash,
      targetInvariantSha256: beforeInvariantHash,
      clipIds: allClipIds,
      frames: []
    };
    let backup = null;
    let preBackupLivePreflight = null;
    if (!dryRun) {
      const activeBeforeBackup = activeProjectJobs(projectSlug, new Set(allClipIds));
      if (activeBeforeBackup.length) throw new Error(`Target generation became active before backup: ${activeBeforeBackup.join(", ")}`);
      preBackupLivePreflight = liveQueuePreflight(projectSlug, new Set(allClipIds));
      if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed before backup; import aborted without writing project media");
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      const productionDirectory = path.join(projectDir(projectSlug), "production");
      const backupDirectory = path.join(productionDirectory, "backups");
      fs.mkdirSync(backupDirectory, { recursive: true });
      backup = path.join(backupDirectory, `storyboard.before-h10-i2v-complete.${stamp}.json`);
      fs.copyFileSync(storyboardFile, backup, fs.constants.COPYFILE_EXCL);
      if (sha256File(backup) !== startingStoryboardSha256) {
        try { fs.unlinkSync(backup); }
        catch (cleanupError) { throw new AggregateError([cleanupError], `Backup SHA-256 differs and the invalid backup could not be removed: ${backup}`); }
        throw new Error("Backup SHA-256 differs from the pre-import storyboard; import aborted before writing media");
      }
      fs.mkdirSync(mediaDirectory, { recursive: true });
    }
    const next = structuredClone(storyboard);
    const createdFiles = [];
    let storyboardSaved = false;
    const receipt = {
      ...baseReceipt,
      importedAt: now.toISOString(),
      preBackupLivePreflight,
      backup: backup ? path.relative(projectDir(projectSlug), backup).replace(/\\/g, "/") : null,
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
        if (!dryRun) {
          fs.writeFileSync(destination, buffer, { flag: "wx" });
          createdFiles.push(destination);
        }
        const promptHash = sha256Buffer(Buffer.from(packagePrompt.prompt, "utf8"));
        const packagePromptHash = sha256Buffer(Buffer.from(packagePrompt.packagePrompt || packagePrompt.prompt, "utf8"));
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
          packagePrompt: packagePrompt.packagePrompt || packagePrompt.prompt,
          packagePromptHash,
          promptSource: packagePrompt.promptSource || "fixed_h10_package",
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
          packagePrompt: packagePrompt.packagePrompt || packagePrompt.prompt, packagePromptHash,
          promptSource: packagePrompt.promptSource || "fixed_h10_package",
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
      if (stableHash(nonTargetSnapshot(next, targets)) !== beforeNonTargetHash) throw new Error("Import changed storyboard records outside H10");
      if (stableHash(invariantSnapshot(next, targets)) !== beforeInvariantHash) throw new Error("Import changed protected H10 timing, ordering, continuity, history, or semantic-reference state");
      if (dryRun) {
        if (sha256File(storyboardFile) !== startingStoryboardSha256) throw new Error("Storyboard changed during read-only projected-state verification");
        return { dryRun: true, idempotent: false, projected: true, storyboard: next, receipt, backup: null };
      }
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
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "H10 import failed and rollback was not completely clean");
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
  const archivePath = argument("--h10") || defaultArchivePath();
  const modes = ["--inspect-packages-only", "--verify-only", "--apply"].filter((flag) => process.argv.includes(flag));
  if (modes.length !== 1) {
    console.error("Usage: node scripts/import-h10-ltx25-i2v-complete.mjs (--inspect-packages-only | --verify-only | --apply) [--h10 <exact-zip>]");
    process.exitCode = 2;
  } else try {
    const result = modes[0] === "--inspect-packages-only"
      ? inspectH10Package({ archivePath })
      : importH10Ltx25I2vComplete({ archivePath, dryRun: modes[0] === "--verify-only" });
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
