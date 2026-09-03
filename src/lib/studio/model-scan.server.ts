import { createHash } from "node:crypto";
import { mkdirSync, openSync, readSync, closeSync, readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { MODEL_ROOT, type CatalogStats, type ModelCatalog } from "./model-catalog.ts";
import {
  catalogCounts,
  classifyWeight,
  groupLogicalModels,
  isMetadataName,
  isWeightName,
  shouldSkipDirName,
  type HeaderEvidence,
  type IndexedWeight,
  type SidecarEvidence,
} from "./model-classify.ts";

const CACHE_VERSION = 1;
const HEADER_CAP = 4 * 1024 * 1024;
const JSON_CAP = 2 * 1024 * 1024;
const README_CAP = 64 * 1024;

export type ScanOptions = {
  force?: boolean;
  deep?: boolean;
  root?: string;
  cachePath?: string;
};

type FileCacheEntry = {
  size: number;
  mtimeMs: number;
  fingerprint: string;
  header?: HeaderEvidence;
  sha256?: string;
  sha256Kind?: "full" | "sampled";
};

type CacheFile = {
  version: number;
  root: string;
  files: Record<string, FileCacheEntry>;
};

function defaultCachePath() {
  return join(process.cwd(), "artifacts", "model-catalog-cache.json");
}

function fastFingerprint(size: number, mtimeMs: number, name: string): string {
  return `${size}:${Math.round(mtimeMs)}:${name}`;
}

function readCache(path: string): CacheFile {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed?.version !== CACHE_VERSION || !parsed.files) {
      return { version: CACHE_VERSION, root: MODEL_ROOT, files: {} };
    }
    return parsed;
  } catch {
    return { version: CACHE_VERSION, root: MODEL_ROOT, files: {} };
  }
}

function writeCache(path: string, cache: CacheFile) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}

function readPrefix(path: string, max: number): Buffer | null {
  let fd: number | undefined;
  try {
    const st = statSync(path);
    const n = Math.min(max, st.size);
    if (n <= 0) return Buffer.alloc(0);
    fd = openSync(path, "r");
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, 0);
    return buf;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseSafetensorsHeader(buf: Buffer): HeaderEvidence | undefined {
  if (buf.length < 8) return undefined;
  const len = Number(buf.readBigUInt64LE(0));
  if (!Number.isFinite(len) || len <= 2 || len > 16_000_000) return undefined;
  if (buf.length < 8 + Math.min(len, buf.length - 8)) {
    /* header may be truncated */
  }
  const slice = buf.subarray(8, Math.min(buf.length, 8 + len));
  try {
    const json = JSON.parse(slice.toString("utf8")) as Record<string, unknown>;
    const meta = (json.__metadata__ ?? {}) as Record<string, unknown>;
    const tensorKeys = Object.keys(json).filter((k) => k !== "__metadata__");
    const dtypes = new Set<string>();
    let params = 0;
    for (const key of tensorKeys) {
      const t = json[key] as { dtype?: string; shape?: number[] } | undefined;
      if (t?.dtype) dtypes.add(String(t.dtype));
      if (Array.isArray(t?.shape)) {
        params += t.shape.reduce((n, d) => n * Math.max(1, d), 1);
      }
    }
    return {
      architecture: String(meta.format ?? meta.ss_base_model_name ?? meta.modelspec_architecture ?? "") || undefined,
      name: String(meta.ss_output_name ?? meta.modelspec_title ?? "") || undefined,
      dtypes: [...dtypes],
      parameterCount: params > 0 ? params : undefined,
      license: String(meta.modelspec_license ?? "") || undefined,
      tensorKeys: tensorKeys.slice(0, 80),
    };
  } catch {
    return undefined;
  }
}

type GGUFReader = { buf: Buffer; off: number };

function u32(r: GGUFReader): number {
  const v = r.buf.readUInt32LE(r.off);
  r.off += 4;
  return v;
}
function u64(r: GGUFReader): number {
  const v = Number(r.buf.readBigUInt64LE(r.off));
  r.off += 8;
  return v;
}
function ggufString(r: GGUFReader): string {
  const n = u64(r);
  if (n < 0 || n > 1_000_000 || r.off + n > r.buf.length) {
    r.off = Math.min(r.buf.length, r.off + Math.max(0, n));
    return "";
  }
  const s = r.buf.subarray(r.off, r.off + n).toString("utf8");
  r.off += n;
  return s;
}

function ggufValue(r: GGUFReader, type: number): unknown {
  switch (type) {
    case 0:
      return r.buf.readUInt8(r.off++);
    case 1:
      return r.buf.readInt8(r.off++);
    case 2: {
      const v = r.buf.readUInt16LE(r.off);
      r.off += 2;
      return v;
    }
    case 3: {
      const v = r.buf.readInt16LE(r.off);
      r.off += 2;
      return v;
    }
    case 4:
      return u32(r);
    case 5: {
      const v = r.buf.readInt32LE(r.off);
      r.off += 4;
      return v;
    }
    case 6: {
      const v = r.buf.readFloatLE(r.off);
      r.off += 4;
      return v;
    }
    case 7:
      return r.buf.readUInt8(r.off++) !== 0;
    case 8:
      return ggufString(r);
    case 9: {
      const itemType = u32(r);
      const count = u64(r);
      const cap = Math.min(count, 32);
      const arr: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const val = ggufValue(r, itemType);
        if (i < cap) arr.push(val);
      }
      return arr;
    }
    case 10:
      return u64(r);
    case 11: {
      const v = Number(r.buf.readBigInt64LE(r.off));
      r.off += 8;
      return v;
    }
    case 12: {
      const v = r.buf.readDoubleLE(r.off);
      r.off += 8;
      return v;
    }
    default:
      return undefined;
  }
}

function parseGgufHeader(buf: Buffer): HeaderEvidence | undefined {
  if (buf.length < 24 || buf.subarray(0, 4).toString("utf8") !== "GGUF") return undefined;
  const r: GGUFReader = { buf, off: 4 };
  try {
    const version = u32(r);
    if (version < 1 || version > 4) return undefined;
    u64(r); // tensor count
    const kvCount = u64(r);
    const kv: Record<string, unknown> = {};
    const maxKv = Math.min(kvCount, 256);
    for (let i = 0; i < kvCount; i++) {
      if (r.off + 8 >= r.buf.length) break;
      const key = ggufString(r);
      const type = u32(r);
      const value = ggufValue(r, type);
      if (i < maxKv && key) kv[key] = value;
    }
    const arch = String(kv["general.architecture"] ?? "");
    const ctxKey = arch ? `${arch}.context_length` : "";
    const fileType = kv["general.file_type"];
    return {
      architecture: arch || undefined,
      name: String(kv["general.name"] ?? "") || undefined,
      parameterCount: typeof kv["general.parameter_count"] === "number" ? (kv["general.parameter_count"] as number) : undefined,
      contextLength: ctxKey && typeof kv[ctxKey] === "number" ? (kv[ctxKey] as number) : undefined,
      license: String(kv["general.license"] ?? "") || undefined,
      quantization: fileType !== undefined ? `GGUF file_type=${fileType}` : undefined,
    };
  } catch {
    return undefined;
  }
}

function parseJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const st = statSync(path);
    if (st.size <= 0 || st.size > JSON_CAP) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readTextCap(path: string, cap: number): string | undefined {
  try {
    const st = statSync(path);
    if (st.size <= 0) return undefined;
    const buf = readPrefix(path, Math.min(cap, st.size));
    return buf ? buf.toString("utf8") : undefined;
  } catch {
    return undefined;
  }
}

function headerFor(path: string, ext: string): HeaderEvidence | undefined {
  const buf = readPrefix(path, HEADER_CAP);
  if (!buf || buf.length === 0) return undefined;
  if (ext === ".safetensors") return parseSafetensorsHeader(buf);
  if (ext === ".gguf") return parseGgufHeader(buf);
  return undefined;
}

function sha256File(path: string, size: number): { sha256: string; kind: "full" | "sampled" } | undefined {
  const FULL_LIMIT = 512 * 1024 * 1024;
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const hash = createHash("sha256");
    if (size <= FULL_LIMIT) {
      const chunk = Buffer.alloc(1024 * 1024);
      let pos = 0;
      while (pos < size) {
        const n = readSync(fd, chunk, 0, Math.min(chunk.length, size - pos), pos);
        if (n <= 0) break;
        hash.update(chunk.subarray(0, n));
        pos += n;
      }
      return { sha256: hash.digest("hex"), kind: "full" };
    }
    const window = 32 * 1024 * 1024;
    const first = Buffer.alloc(Math.min(window, size));
    readSync(fd, first, 0, first.length, 0);
    hash.update(first);
    hash.update(Buffer.from(String(size)));
    return { sha256: hash.digest("hex"), kind: "sampled" };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

type Walked = {
  folders: number;
  files: number;
  weights: { path: string; size: number; mtimeMs: number; name: string; relativePath: string; topFolder: string; dir: string; ext: string }[];
  metaByDir: Map<string, SidecarEvidence>;
};

function topFolderOf(rel: string): string {
  const i = rel.split(/[\\/]/).find((s) => s);
  return i ?? "";
}

function walkRoot(root: string): Walked {
  const out: Walked = { folders: 0, files: 0, weights: [], metaByDir: new Map() };
  const visit = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    out.folders += 1;
    const sidecar: SidecarEvidence = {};
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDirName(ent.name)) continue;
        visit(full);
        continue;
      }
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      out.files += 1;
      if (ent.name.toLowerCase().startsWith("put_")) continue;
      if (isWeightName(ent.name)) {
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.size <= 0) continue;
        const rel = relative(root, full);
        out.weights.push({
          path: full,
          size: st.size,
          mtimeMs: st.mtimeMs,
          name: ent.name,
          relativePath: rel,
          topFolder: topFolderOf(rel),
          dir,
          ext: extname(ent.name).toLowerCase(),
        });
        continue;
      }
      if (!isMetadataName(ent.name)) continue;
      const lower = ent.name.toLowerCase();
      if (lower === "config.json" || lower === "generation_config.json") {
        sidecar.config = { ...sidecar.config, ...parseJsonObject(full) };
      } else if (lower === "model_index.json") {
        sidecar.modelIndex = parseJsonObject(full);
      } else if (lower.startsWith("tokenizer") || lower === "tokenizer_config.json") {
        sidecar.tokenizer = { ...sidecar.tokenizer, ...parseJsonObject(full) };
      } else if (lower.startsWith("readme")) {
        sidecar.readme = readTextCap(full, README_CAP);
      } else if (lower.startsWith("license")) {
        sidecar.licenseText = readTextCap(full, README_CAP);
      }
    }
    if (sidecar.config || sidecar.modelIndex || sidecar.tokenizer || sidecar.readme || sidecar.licenseText) {
      out.metaByDir.set(dir, sidecar);
    }
  };
  visit(root);
  return out;
}

function configHeader(sidecar?: SidecarEvidence): HeaderEvidence | undefined {
  if (!sidecar?.config) return undefined;
  const c = sidecar.config;
  const architectures = c.architectures;
  const arch = Array.isArray(architectures) ? String(architectures[0] ?? "") : String(c.model_type ?? "");
  const ctx = c.max_position_embeddings ?? c.max_seq_len ?? c.n_positions;
  const params = c.num_parameters ?? c.n_params;
  return {
    architecture: arch || undefined,
    modelType: String(c.model_type ?? "") || undefined,
    name: String(c._name_or_path ?? c.model_name ?? "") || undefined,
    contextLength: typeof ctx === "number" ? ctx : undefined,
    parameterCount: typeof params === "number" ? params : undefined,
    dtypes: c.torch_dtype ? [String(c.torch_dtype)] : undefined,
    license: String(c.license ?? "") || undefined,
  };
}

export function loadCatalog(opts: ScanOptions = {}): ModelCatalog {
  const started = Date.now();
  const root = opts.root ?? MODEL_ROOT;
  const cachePath = opts.cachePath ?? defaultCachePath();
  const cache = opts.force ? { version: CACHE_VERSION, root, files: {} } : readCache(cachePath);

  if (!existsSync(root)) {
    const stats: CatalogStats = {
      foldersScanned: 0,
      filesInspected: 0,
      logicalModels: 0,
      standaloneModels: 0,
      componentModels: 0,
      loras: 0,
      unknownUnmapped: 0,
      totalBytes: 0,
      scanDurationMs: Date.now() - started,
      cacheHits: 0,
      cacheMisses: 0,
      root,
      scannedAt: Date.now(),
      deepVerify: Boolean(opts.deep),
    };
    return { stats, models: [], unmapped: [], error: `Model root not found: ${root}` };
  }

  const walked = walkRoot(root);
  let cacheHits = 0;
  let cacheMisses = 0;
  const nextFiles: Record<string, FileCacheEntry> = {};
  const weights: IndexedWeight[] = [];

  for (const w of walked.weights) {
    const fp = fastFingerprint(w.size, w.mtimeMs, w.name);
    const prev = cache.files[w.path];
    let header = prev && prev.fingerprint === fp ? prev.header : undefined;
    let sha256 = prev && prev.fingerprint === fp ? prev.sha256 : undefined;
    let sha256Kind = prev && prev.fingerprint === fp ? prev.sha256Kind : undefined;
    if (header) cacheHits += 1;
    else {
      cacheMisses += 1;
      header = headerFor(w.path, w.ext);
    }
    if (opts.deep && !sha256) {
      const hashed = sha256File(w.path, w.size);
      if (hashed) {
        sha256 = hashed.sha256;
        sha256Kind = hashed.kind;
      }
    }
    const sidecar = walked.metaByDir.get(w.dir);
    const fromConfig = configHeader(sidecar);
    if (fromConfig) {
      header = {
        ...fromConfig,
        ...header,
        architecture: header?.architecture || fromConfig.architecture,
        modelType: header?.modelType || fromConfig.modelType,
        name: header?.name || fromConfig.name,
        contextLength: header?.contextLength || fromConfig.contextLength,
        parameterCount: header?.parameterCount || fromConfig.parameterCount,
        license: header?.license || fromConfig.license,
        dtypes: header?.dtypes?.length ? header.dtypes : fromConfig.dtypes,
      };
    }
    nextFiles[w.path] = { size: w.size, mtimeMs: w.mtimeMs, fingerprint: fp, header, sha256, sha256Kind };
    weights.push({
      path: w.path,
      relativePath: w.relativePath,
      name: w.name,
      dir: w.dir,
      topFolder: w.topFolder,
      size: w.size,
      mtimeMs: w.mtimeMs,
      ext: w.ext,
      header,
      sidecar,
    });
  }

  const classified = weights.map(classifyWeight);
  const { models, unmapped } = groupLogicalModels(classified);
  if (opts.deep) {
    for (const model of models) {
      for (const c of model.components) {
        const cached = nextFiles[c.path];
        if (cached?.sha256) {
          c.sha256 = cached.sha256;
          c.sha256Kind = cached.sha256Kind;
        }
      }
    }
  }

  const counts = catalogCounts(models, unmapped);
  const totalBytes = weights.reduce((n, w) => n + w.size, 0);
  const stats: CatalogStats = {
    foldersScanned: walked.folders,
    filesInspected: walked.files,
    logicalModels: models.length,
    standaloneModels: counts.standalone,
    componentModels: counts.componentModels,
    loras: counts.loras,
    unknownUnmapped: counts.unknownUnmapped,
    totalBytes,
    scanDurationMs: Date.now() - started,
    cacheHits,
    cacheMisses,
    root,
    scannedAt: Date.now(),
    deepVerify: Boolean(opts.deep),
  };

  try {
    writeCache(cachePath, { version: CACHE_VERSION, root, files: nextFiles });
  } catch {
    /* cache is optional; never mutate model files */
  }

  return { stats, models, unmapped };
}
