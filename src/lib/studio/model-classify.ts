import {
  UNKNOWN,
  type EvidenceSource,
  type LogicalModel,
  type Modality,
  type ModelComponent,
  type ModelRole,
  type ModelStatus,
  type Precision,
  type ValidationConfidence,
} from "./model-catalog.ts";

export type HeaderEvidence = {
  architecture?: string;
  name?: string;
  modelType?: string;
  dtypes?: string[];
  parameterCount?: number;
  activeParameterCount?: number;
  contextLength?: number;
  license?: string;
  quantization?: string;
  tensorKeys?: string[];
};

export type SidecarEvidence = {
  config?: Record<string, unknown>;
  modelIndex?: Record<string, unknown>;
  tokenizer?: Record<string, unknown>;
  readme?: string;
  licenseText?: string;
};

export type IndexedWeight = {
  path: string;
  relativePath: string;
  name: string;
  dir: string;
  topFolder: string;
  size: number;
  mtimeMs: number;
  ext: string;
  header?: HeaderEvidence;
  sidecar?: SidecarEvidence;
};

export type ClassifiedWeight = IndexedWeight & {
  family: string;
  role: ModelRole;
  modality: Modality | typeof UNKNOWN;
  precision: Precision;
  quantization: string;
  parameterCount: number | typeof UNKNOWN;
  contextLength: number | typeof UNKNOWN;
  license: string;
  evidence: EvidenceSource[];
  confidence: ValidationConfidence;
  shardKey: string;
  independentlyUsable: boolean;
};

const SKIP_DIR_NAMES = new Set(
  [
    ".cache",
    "duplicates",
    "_quarantine",
    "_not_models",
    "_hf_staging",
    "workflows",
    "fonts",
    "luts",
    "references",
    "node_modules",
    "__macosx",
    ".git",
  ].map((s) => s.toLowerCase()),
);

export function shouldSkipDirName(name: string): boolean {
  const n = name.toLowerCase();
  if (SKIP_DIR_NAMES.has(n)) return true;
  if (n.startsWith(".")) return true;
  return false;
}

export function isWeightName(name: string): boolean {
  return /\.(safetensors|gguf|ckpt|pt|pth|bin|onnx)$/i.test(name);
}

export function isMetadataName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("put_")) return false;
  if (n === "desktop.ini" || n === "cachedir.tag" || n === ".gitignore") return false;
  if (n.endsWith(".crdownload") || n.endsWith(".incomplete") || n.endsWith(".lock")) return false;
  if (/^(config|model_index|generation_config|preprocessor_config|tokenizer_config)\.json$/i.test(n)) {
    return true;
  }
  if (/^(readme|license)/i.test(n)) return true;
  if (/^(tokenizer|processor)/i.test(n)) return true;
  if (/\.(json|ya?ml)$/i.test(n) && !/workflow/i.test(n)) return true;
  return false;
}

export function shardGroupKey(fileName: string): string {
  return fileName
    .replace(/-\d{5}-of-\d{5}/i, "")
    .replace(/-\d{2}-of-\d{2}/i, "")
    .replace(/\.part\d+/i, "")
    .replace(/-(\d{5})\.gguf$/i, ".gguf")
    .toLowerCase();
}

function groupingKey(weight: IndexedWeight): string {
  if (/-\d{5}-of-\d{5}/i.test(weight.name) || /-\d{2}-of-\d{2}/i.test(weight.name)) {
    return `shard:${weight.dir.toLowerCase()}::${shardGroupKey(weight.name)}`;
  }
  return `file:${weight.size}::${weight.name.toLowerCase()}`;
}

type FamilyRule = {
  family: string;
  test: (rel: string, name: string, top: string) => boolean;
};

const FAMILY_RULES: FamilyRule[] = [
  {
    family: "FLUX.2 Klein",
    test: (rel, name) => /flux[.\s_\-\\/]*2[.\s_\-\\/]*klein|fluxklein|klein9b|klein4b|klein_9b|klein_4b/i.test(rel + name),
  },
  {
    family: "FLUX.2",
    test: (rel, name) => /flux[.\s_\-\\/]*2(?![.\s_\-\\/]*klein)|flux2(?!klein)/i.test(rel + " " + name) && !/klein/i.test(rel + name),
  },
  {
    family: "FLUX.1",
    test: (rel, name) => /flux[.\s_\-\\/]*1|flux1-dev|flux1_dev|\bflux1\b/i.test(rel + " " + name),
  },
  {
    family: "Krea 2",
    test: (rel, name, top) => /krea[.\s_\-\\/]*2|krealism/i.test(rel + name) || /^krea 2$/i.test(top),
  },
  {
    family: "LTX 2.5",
    test: (rel, name) => /ltx[.\s_\-\\/]*2\.?5|ltx25/i.test(rel + name),
  },
  {
    family: "LTX 2.3",
    test: (rel, name) => /ltx[.\s_\-\\/]*2\.?3|ltx23|(^|[^a-z])sulphur/i.test(rel + name),
  },
  {
    family: "LTX-2",
    test: (rel, name) => /ltx[.\s_\-\\/]*2(?!\.?[35])/i.test(rel + name),
  },
  {
    family: "MiniMax H3",
    test: (rel, name) => /minimax[.\s_\-\\/]*h3|minimax_h3|mini-?max-?h3/i.test(rel + name),
  },
  {
    family: "MiniMax Music3",
    test: (rel, name) => /music3|minimax_music/i.test(rel + name),
  },
  {
    family: "Qwen Image",
    test: (rel, name) => /qwen[.\s_-]*image/i.test(rel + name),
  },
  {
    family: "Qwen3 TTS",
    test: (rel, name, top) => /qwen3[.\s_-]*tts|qwen-tts/i.test(rel + name) || /^tts$/i.test(top) && /qwen3/i.test(rel),
  },
  {
    family: "Qwen3-VL",
    test: (rel, name) => /qwen3[.\s_-]*vl|qwen3vl/i.test(rel + name),
  },
  {
    family: "Hunyuan3D",
    test: (rel, name) => /hunyuan3d|hy3d/i.test(rel + name),
  },
  {
    family: "SeedVR2",
    test: (rel, name, top) => /seedvr2/i.test(rel + name) || /^seedvr2$/i.test(top),
  },
  {
    family: "VibeVoice",
    test: (rel, name, top) => /vibevoice/i.test(rel + name) || /^vibevoice$/i.test(top),
  },
  {
    family: "IndexTTS",
    test: (rel, name, top) => /indextts|index-tts/i.test(rel + name) || /^indextts$/i.test(top),
  },
  {
    family: "SAM 3",
    test: (rel, name, top) => /\bsam3\b/i.test(rel + name) || /^sam3$/i.test(top),
  },
  {
    family: "SAM",
    test: (rel, name, top) => /\bsam_/i.test(name) || /^sams$/i.test(top),
  },
];

const DIR_ROLE: Record<string, ModelRole> = {
  loras: "lora",
  text_encoders: "text_encoder",
  clip: "text_encoder",
  clip_vision: "vision_encoder",
  vae: "vae",
  vae_approx: "vae",
  embeddings: "support",
  controlnet: "control",
  ipadapter: "control",
  pulid: "control",
  photomaker: "control",
  style_models: "control",
  model_patches: "control",
  upscale_models: "upscaler",
  latent_upscale_models: "upscaler",
  audio_encoders: "support",
  insightface: "support",
  facerestore_models: "support",
  ultralytics: "support",
  sams: "support",
  sam2: "support",
  sam3: "support",
  annotators: "support",
  detection: "support",
  rembg: "support",
  rife: "support",
  depthanything: "support",
  videodepthanything: "support",
  frame_interpolation: "support",
  nsfw_detector: "support",
  yolo: "support",
  diffusion_models: "transformer",
  unet: "transformer",
  checkpoints: "transformer",
  llm: "standalone",
  lmstudio: "standalone",
  ollama: "standalone",
  tts: "standalone",
  vibevoice: "standalone",
  seedvr2: "standalone",
};

export function familyFromPath(relativePath: string, name: string, topFolder: string): { family: string; source: EvidenceSource } {
  const rel = relativePath.replace(/\//g, "\\");
  for (const rule of FAMILY_RULES) {
    if (rule.test(rel, name, topFolder)) {
      const fromDir = new RegExp(rule.family.replace(/[.\s]/g, "[.\\s_-]*"), "i").test(topFolder) ||
        rel.toLowerCase().includes(rule.family.toLowerCase().replace(/\s+/g, ""));
      return { family: rule.family, source: fromDir ? "directory structure" : "filename" };
    }
  }
  const segs = rel.split(/[\\/]/).filter(Boolean);
  if (segs.length >= 3 && /^(lmstudio|llm|tts)$/i.test(topFolder)) {
    const folder = segs[segs.length - 2] ?? "";
    if (folder && !/^(gguf|models|blobs|manifests)$/i.test(folder)) {
      return { family: folder, source: "directory structure" };
    }
  }
  return { family: UNKNOWN, source: "filename" };
}

export function roleFromDirectory(topFolder: string): ModelRole | null {
  return DIR_ROLE[topFolder.toLowerCase()] ?? null;
}

export function precisionFromEvidence(fileName: string, header?: HeaderEvidence): { precision: Precision; quantization: string; source: EvidenceSource } {
  const dtypes = (header?.dtypes ?? []).map((d) => d.toUpperCase());
  if (dtypes.some((d) => d.includes("BF16") || d === "BFLOAT16")) {
    return { precision: "BF16", quantization: header?.quantization || "BF16", source: "model config/header" };
  }
  if (dtypes.some((d) => d === "F16" || d === "FP16" || d === "FLOAT16")) {
    return { precision: "FP16", quantization: header?.quantization || "FP16", source: "model config/header" };
  }
  if (dtypes.some((d) => /F8|FP8|E4M3|E5M2/i.test(d))) {
    return { precision: "FP8", quantization: header?.quantization || "FP8", source: "model config/header" };
  }
  const q = (header?.quantization || "").toUpperCase();
  if (q) {
    const mapped = mapQuantToken(q);
    if (mapped !== UNKNOWN) {
      return { precision: mapped, quantization: header?.quantization || q, source: "model config/header" };
    }
  }
  const n = fileName.toLowerCase();
  if (/\bq8_0\b|\bq8_1\b|\bq8_k\b/.test(n)) return { precision: "Q8", quantization: quantToken(n) || "Q8", source: "filename" };
  if (/\bq6_k\b|\bq6/.test(n)) return { precision: "Q6", quantization: quantToken(n) || "Q6", source: "filename" };
  if (/\bq5_/.test(n)) return { precision: "Q5", quantization: quantToken(n) || "Q5", source: "filename" };
  if (/\bq4_/.test(n)) return { precision: "Q4", quantization: quantToken(n) || "Q4", source: "filename" };
  if (/\bq3_/.test(n)) return { precision: "Q3", quantization: quantToken(n) || "Q3", source: "filename" };
  if (/\bq2_/.test(n)) return { precision: "Q2", quantization: quantToken(n) || "Q2", source: "filename" };
  if (/\bbf16\b/.test(n)) return { precision: "BF16", quantization: "BF16", source: "filename" };
  if (/\bfp16\b/.test(n)) return { precision: "FP16", quantization: "FP16", source: "filename" };
  if (/\bfp8|nvfp4|int8/.test(n)) {
    if (/nvfp4/.test(n)) return { precision: "FP8", quantization: "NVFP4", source: "filename" };
    if (/int8/.test(n)) return { precision: "FP8", quantization: "INT8", source: "filename" };
    return { precision: "FP8", quantization: "FP8", source: "filename" };
  }
  if (n.endsWith(".gguf")) return { precision: "GGUF variant", quantization: UNKNOWN, source: "filename" };
  return { precision: UNKNOWN, quantization: UNKNOWN, source: "filename" };
}

function quantToken(name: string): string {
  const m = name.match(/q[2-8]_[kKmM0-9_]+/i);
  return m ? m[0].toUpperCase() : "";
}

function mapQuantToken(q: string): Precision {
  if (/Q8/.test(q)) return "Q8";
  if (/Q6/.test(q)) return "Q6";
  if (/Q5/.test(q)) return "Q5";
  if (/Q4/.test(q)) return "Q4";
  if (/Q3/.test(q)) return "Q3";
  if (/Q2/.test(q)) return "Q2";
  if (/BF16/.test(q)) return "BF16";
  if (/FP16|F16/.test(q)) return "FP16";
  if (/FP8|F8/.test(q)) return "FP8";
  return UNKNOWN;
}

export function refineRole(weight: IndexedWeight, dirRole: ModelRole | null): { role: ModelRole; evidence: EvidenceSource[] } {
  const evidence: EvidenceSource[] = [];
  const name = weight.name.toLowerCase();
  const keys = (weight.header?.tensorKeys ?? []).join(" ").toLowerCase();
  const arch = (weight.header?.architecture || weight.header?.modelType || "").toLowerCase();
  let role: ModelRole = dirRole ?? "unknown";
  if (dirRole) evidence.push("directory structure");

  if (dirRole === "standalone" && /[\\/]speech_tokenizer[\\/]/i.test(weight.relativePath)) {
    evidence.push("directory structure");
    return { role: "tokenizer", evidence };
  }
  if (dirRole === "standalone" && /(^|[._-])vae([._-]|$)/i.test(name)) {
    evidence.push("filename");
    return { role: "vae", evidence };
  }

  if (dirRole === "transformer" || dirRole === "standalone") {
    if (/[._-]lora[._-]|_lora\.|lora$/i.test(name) && !/transformer/i.test(name)) {
      evidence.push("filename");
      return { role: "lora", evidence };
    }
    if (/mmproj/i.test(name)) {
      evidence.push("filename");
      return { role: "projector", evidence };
    }
    return { role: dirRole, evidence };
  }

  if (/mmproj/i.test(name) || /vision.projection|mm_projector/i.test(keys)) {
    evidence.push(keys ? "model config/header" : "filename");
    return { role: "projector", evidence };
  }
  if (/audio.?vae|dav\.safetensors|_audio_vae/i.test(name) || /audio_vae/i.test(keys)) {
    evidence.push(/audio/i.test(keys) ? "model config/header" : "filename");
    return { role: "audio_vae", evidence };
  }
  if (/\bvae\b|autoencoder|_ae\.safetensors|^ae\.safetensors/i.test(name) && role !== "transformer") {
    evidence.push("filename");
    return { role: "vae", evidence };
  }
  if (/text.?encod|clip_l|t5xxl|umt5|gemma4.*proj/i.test(name) && role !== "transformer") {
    evidence.push("filename");
    return { role: "text_encoder", evidence };
  }
  if (/lora|ic-lora|_lora_/i.test(name) && role === "unknown") {
    evidence.push("filename");
    return { role: "lora", evidence };
  }
  if (/upscale|esrgan|realesrgan|hat_|nomos|siax/i.test(name) && (role === "unknown" || role === "transformer")) {
    evidence.push("filename");
    return { role: "upscaler", evidence };
  }
  if (arch.includes("vae") && role !== "transformer") {
    evidence.push("architecture metadata");
    return { role: "vae", evidence };
  }
  return { role, evidence };
}

export function refineModality(weight: IndexedWeight, role: ModelRole, family: string): { modality: Modality | typeof UNKNOWN; evidence: EvidenceSource[] } {
  const evidence: EvidenceSource[] = [];
  const arch = (weight.header?.architecture || weight.header?.modelType || "").toLowerCase();
  const name = (weight.relativePath + " " + weight.name).toLowerCase();
  const cfg = weight.sidecar?.config ?? {};
  const cfgType = String(cfg.model_type ?? cfg.architectures ?? "").toLowerCase();

  if (role === "lora") return { modality: "LoRA", evidence: ["directory structure"] };
  if (role === "vae" || role === "audio_vae") return { modality: role === "audio_vae" ? "audio" : "VAE", evidence };
  if (role === "text_encoder") return { modality: "text encoder", evidence };
  if (role === "vision_encoder" || role === "projector") return { modality: "vision encoder", evidence };
  if (role === "tokenizer") return { modality: "tokenizer", evidence };
  if (role === "control") return { modality: "control/adapter", evidence };
  if (role === "upscaler" || role === "support") return { modality: "support component", evidence };

  if (/llava|qwen.?vl|internvl|minicpm-v|vision/i.test(arch + cfgType)) {
    evidence.push("architecture metadata");
    return { modality: "VLM", evidence };
  }
  if (/llama|qwen3(?!\s*vl)|mistral|gemma(?!4-12b-with-proj)|phi|gpt/i.test(arch + cfgType) && weight.topFolder.toLowerCase() !== "text_encoders") {
    if (/lmstudio|llm|ollama/i.test(weight.topFolder)) {
      evidence.push("architecture metadata", "directory structure");
      return { modality: "LLM", evidence };
    }
  }
  if (/tts|vibevoice|indextts|fish.?speech|sovits/i.test(arch + cfgType + name)) {
    evidence.push(arch ? "architecture metadata" : "filename");
    return { modality: "TTS", evidence };
  }
  if (/music|dit.*audio|stable.?audio/i.test(arch + name) || family === "MiniMax Music3") {
    evidence.push(family === "MiniMax Music3" ? "directory structure" : "filename");
    return { modality: "music", evidence };
  }
  if (/ltx|hunyuan.?video|wan.?2|minimax.?h3|i2v|fl2v|ref2v/i.test(arch + name) || /LTX|MiniMax H3|SeedVR2/.test(family)) {
    evidence.push("filename");
    return { modality: "video", evidence };
  }
  if (/flux|krea|sdxl|stable.?diff|qwen.?image|hunyuan3d/i.test(arch + name) || /FLUX|Krea|Qwen Image|Hunyuan3D/.test(family)) {
    evidence.push("filename");
    return { modality: "image", evidence };
  }
  if (/lmstudio|llm|ollama/i.test(weight.topFolder)) {
    evidence.push("directory structure");
    return { modality: /vl|vision|llava/i.test(name) ? "VLM" : "LLM", evidence };
  }
  if (/tts|vibevoice/i.test(weight.topFolder)) {
    evidence.push("directory structure");
    return { modality: "TTS", evidence };
  }
  if (role === "transformer" && /diffusion_models|unet|checkpoints/i.test(weight.topFolder)) {
    evidence.push("directory structure");
    return { modality: UNKNOWN, evidence };
  }
  return { modality: UNKNOWN, evidence };
}

export function classifyWeight(weight: IndexedWeight): ClassifiedWeight {
  const evidence = new Set<EvidenceSource>();
  const { family, source: familySource } = familyFromPath(weight.relativePath, weight.name, weight.topFolder);
  evidence.add(familySource);
  if (weight.header?.architecture) evidence.add("model config/header");
  if (weight.sidecar?.modelIndex) evidence.add("model_index");
  if (weight.sidecar?.config) evidence.add("architecture metadata");
  if (weight.sidecar?.tokenizer) evidence.add("tokenizer/config");
  if (weight.sidecar?.readme) evidence.add("local README/model card");

  const dirRole = roleFromDirectory(weight.topFolder);
  const { role, evidence: roleEv } = refineRole(weight, dirRole);
  for (const e of roleEv) evidence.add(e);

  const { modality, evidence: modEv } = refineModality(weight, role, family);
  for (const e of modEv) evidence.add(e);

  const prec = precisionFromEvidence(weight.name, weight.header);
  evidence.add(prec.source);

  const parameterCount =
    weight.header?.parameterCount && weight.header.parameterCount > 0
      ? weight.header.parameterCount
      : UNKNOWN;
  if (parameterCount !== UNKNOWN) evidence.add("model config/header");

  const contextLength =
    weight.header?.contextLength && weight.header.contextLength > 0
      ? weight.header.contextLength
      : typeof weight.sidecar?.config?.max_position_embeddings === "number"
        ? (weight.sidecar.config.max_position_embeddings as number)
        : UNKNOWN;
  if (contextLength !== UNKNOWN) evidence.add(weight.header?.contextLength ? "model config/header" : "tokenizer/config");

  const license =
    weight.header?.license ||
    (weight.sidecar?.licenseText ? clipLicense(weight.sidecar.licenseText) : "") ||
    UNKNOWN;

  const independentlyUsable =
    role === "standalone" ||
    role === "transformer" ||
    (role === "unknown" && modality === "LLM") ||
    (role === "unknown" && modality === "VLM") ||
    (role === "unknown" && modality === "TTS") ||
    (role === "unknown" && modality === "music");

  const sources = [...evidence];
  const confidence: ValidationConfidence = sources.includes("model config/header") || sources.includes("architecture metadata") || sources.includes("model_index")
    ? "high"
    : sources.includes("directory structure") || sources.includes("tokenizer/config")
      ? "medium"
      : "low";

  return {
    ...weight,
    family,
    role,
    modality,
    precision: prec.precision,
    quantization: prec.quantization,
    parameterCount,
    contextLength,
    license,
    evidence: sources,
    confidence,
    shardKey: groupingKey(weight),
    independentlyUsable,
  };
}

function clipLicense(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  if (!line) return UNKNOWN;
  return line.slice(0, 120);
}

const REQUIRED: Record<string, string[]> = {
  "LTX 2.5": ["transformer", "text_encoder", "vae"],
  "LTX 2.3": ["transformer", "text_encoder", "vae"],
  "LTX-2": ["transformer", "text_encoder", "vae"],
  "MiniMax H3": ["transformer", "text_encoder", "vae"],
  "FLUX.2": ["transformer"],
  "FLUX.1": ["transformer"],
  "FLUX.2 Klein": ["transformer"],
  "Krea 2": ["transformer"],
  "Qwen Image": ["transformer"],
  "MiniMax Music3": ["transformer"],
};

function displayNameFor(family: string, files: ClassifiedWeight[]): string {
  if (family !== UNKNOWN) return family;
  const first = files[0];
  if (!first) return UNKNOWN;
  const cfgName = first.header?.name?.trim();
  if (cfgName) return cfgName;
  return first.name.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|onnx)$/i, "");
}

function componentOf(file: ClassifiedWeight, extraPaths: string[] = []): ModelComponent {
  return {
    id: file.path,
    displayName: file.header?.name || file.name.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|onnx)$/i, ""),
    role: file.role,
    modality: file.modality,
    path: file.path,
    paths: [file.path, ...extraPaths.filter((p) => p !== file.path)],
    sizeBytes: file.size,
    precision: file.precision,
    quantization: file.quantization,
    parameterCount: file.parameterCount,
    modifiedAt: file.mtimeMs,
    evidence: file.evidence,
    confidence: file.confidence,
  };
}

function pickPath(files: ClassifiedWeight[], role: ModelRole): string | undefined {
  return files.find((f) => f.role === role)?.path;
}

function majority<T extends string>(items: T[], fallback: T): T {
  if (items.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best = items[0];
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

function bestPrecision(files: ClassifiedWeight[]): Precision {
  const order: Precision[] = ["BF16", "FP16", "FP8", "Q8", "Q6", "Q5", "Q4", "Q3", "Q2", "GGUF variant", UNKNOWN];
  const set = new Set(files.map((f) => f.precision));
  return order.find((p) => set.has(p)) ?? UNKNOWN;
}

export function groupLogicalModels(weights: ClassifiedWeight[]): { models: LogicalModel[]; unmapped: ModelComponent[] } {
  const shards = new Map<string, ClassifiedWeight[]>();
  for (const w of weights) {
    const list = shards.get(w.shardKey) ?? [];
    list.push(w);
    shards.set(w.shardKey, list);
  }
  const merged: ClassifiedWeight[] = [];
  for (const group of shards.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const primary = [...group].sort((a, b) => b.size - a.size)[0];
    const sameBytes = group.every((g) => g.size === primary.size && g.name.toLowerCase() === primary.name.toLowerCase());
    merged.push({
      ...primary,
      size: sameBytes ? primary.size : group.reduce((n, g) => n + g.size, 0),
      path: primary.path,
    });
  }

  const buckets = new Map<string, ClassifiedWeight[]>();
  const unmapped: ModelComponent[] = [];
  for (const w of merged) {
    if (w.family !== UNKNOWN) {
      const list = buckets.get(w.family) ?? [];
      list.push(w);
      buckets.set(w.family, list);
      continue;
    }
    if (w.independentlyUsable) {
      const key = `file:${w.path}`;
      buckets.set(key, [w]);
    } else {
      unmapped.push(componentOf(w));
    }
  }

  const models: LogicalModel[] = [];
  for (const [key, files] of buckets) {
    const family = files[0]?.family ?? UNKNOWN;
    const components = files.map((f) => componentOf(f));
    const transformers = files.filter((f) => f.role === "transformer" || f.role === "standalone");
    const independentlyUsable = transformers.length > 0 || files.some((f) => f.independentlyUsable && f.role !== "lora");
    if (!independentlyUsable) {
      unmapped.push(...files.map((f) => componentOf(f)));
      continue;
    }
    const required = family !== UNKNOWN ? REQUIRED[family] ?? [] : ["transformer"];
    const presentRoles = new Set(files.map((f) => f.role));
    if (independentlyUsable && transformers.length > 0) presentRoles.add("transformer");

    const missing = required.filter((r) => {
      if (r === "transformer") return transformers.length === 0 && !files.some((f) => f.independentlyUsable);
      return !presentRoles.has(r as ModelRole);
    });

    const modality = majority(
      files.filter((f) => f.independentlyUsable).map((f) => f.modality),
      files[0]?.modality ?? UNKNOWN,
    );

    let status: ModelStatus;
    if (!independentlyUsable) status = "Component";
    else if (modality === UNKNOWN) status = "Needs mapping";
    else if (missing.length > 0) status = "Missing dependency";
    else status = "Ready";

    const sizeBytes = files.reduce((n, f) => n + f.size, 0);
    const displayName = key.startsWith("file:") ? displayNameFor(UNKNOWN, files) : displayNameFor(family, files);

    models.push({
      id: key.startsWith("file:") ? key.slice(5) : `family:${family}`,
      displayName,
      family: family,
      modality,
      role: independentlyUsable ? (transformers[0]?.role ?? "standalone") : files[0]?.role ?? "unknown",
      status,
      independentlyUsable,
      baseModel: family,
      parameterCount: files.find((f) => f.parameterCount !== UNKNOWN)?.parameterCount ?? UNKNOWN,
      activeParameterCount: files.find((f) => f.header?.activeParameterCount)?.header?.activeParameterCount ?? UNKNOWN,
      precision: bestPrecision(independentlyUsable ? transformers.length ? transformers : files : files),
      quantization: (transformers[0] ?? files[0])?.quantization ?? UNKNOWN,
      sizeBytes,
      folderSizeBytes: sizeBytes,
      modifiedAt: Math.max(...files.map((f) => f.mtimeMs)),
      path: (transformers[0] ?? files[0]).path,
      requiredComponents: required,
      discoveredSiblings: files.filter((f) => !f.independentlyUsable).map((f) => f.role),
      textEncoder: pickPath(files, "text_encoder"),
      vae: pickPath(files, "vae"),
      audioVae: pickPath(files, "audio_vae"),
      projector: pickPath(files, "projector"),
      tokenizer: pickPath(files, "tokenizer"),
      compatibleLoraFamily: files.some((f) => f.role === "lora") ? family : family !== UNKNOWN ? family : UNKNOWN,
      runtimeBackend: runtimeFor(modality, files[0]?.ext ?? ""),
      contextLength: files.find((f) => f.contextLength !== UNKNOWN)?.contextLength ?? UNKNOWN,
      license: files.find((f) => f.license !== UNKNOWN)?.license ?? UNKNOWN,
      sourceMetadata: files[0]?.header?.architecture || files[0]?.header?.modelType || UNKNOWN,
      confidence: files.some((f) => f.confidence === "high") ? "high" : files.some((f) => f.confidence === "medium") ? "medium" : "low",
      components,
    });
  }

  models.sort((a, b) => {
    const rank = (s: ModelStatus) => (s === "Ready" ? 0 : s === "Missing dependency" ? 1 : s === "Component" ? 2 : 3);
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return a.displayName.localeCompare(b.displayName);
  });

  return { models, unmapped };
}

function runtimeFor(modality: Modality | typeof UNKNOWN, ext: string): string {
  if (ext === ".gguf") return "llama.cpp / GGUF";
  if (modality === "LLM" || modality === "VLM") return "UNKNOWN";
  if (modality === "TTS") return "UNKNOWN";
  if (modality === "image" || modality === "video" || modality === "music") return "diffusion (local)";
  return UNKNOWN;
}

export function catalogCounts(models: LogicalModel[], unmapped: ModelComponent[]) {
  const standalone = models.filter((m) => m.independentlyUsable).length;
  const componentModels = models.filter((m) => !m.independentlyUsable).length + unmapped.length;
  const loras = models.reduce((n, m) => n + m.components.filter((c) => c.role === "lora").length, 0) +
    unmapped.filter((c) => c.role === "lora").length;
  const unknownUnmapped = unmapped.length + models.filter((m) => m.status === "Needs mapping" || m.family === UNKNOWN).length;
  return { standalone, componentModels, loras, unknownUnmapped };
}
