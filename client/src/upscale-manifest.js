export const UPSCALE_ENGINES = Object.freeze({
  SUPIR: "SUPIR",
  REAL_ESRGAN: "Real_ESRGAN",
  NONE: "None",
  FRAME_INTERPOLATION: "Frame_Interpolation"
});

const SUPIR_TERMS = [
  /\bsupir\b/,
  /\bphotoreal/i,
  /\bhyper[- ]?real/i,
  /\brealistic detail/i,
  /\bface(s)?\b/,
  /\bfacial\b/,
  /\bskin\b/,
  /\bfabric\b/,
  /\bhistorical\b/,
  /\bold\b/,
  /\bdegraded\b/,
  /\blow[- ]?quality\b/,
  /\bblurry\b/,
  /\brestore/i
];

const REAL_ESRGAN_TERMS = [
  /\breal[-_ ]?esrgan\b/i,
  /\bfast\b/,
  /\bbulk\b/,
  /\bbatch\b/,
  /\bgameplay\b/,
  /\btext overlay/i,
  /\bui\b/,
  /\binterface\b/,
  /\bgraphic/i,
  /\banime\b/,
  /\bcartoon\b/,
  /\bwithout changing/i,
  /\bpreserve (the )?art style/i,
  /\bdo not hallucinate/i,
  /\bno hallucination/i
];

const UPSCALE_TERMS = [
  /\bupscale\b/,
  /\bupscal/i,
  /\benhance\b/,
  /\bsharpen\b/,
  /\bsharp\b/,
  /\b4k\b/,
  /\buhd\b/,
  /\b2x\b/,
  /\b4x\b/,
  /\bblow it up\b/,
  /\bincrease resolution\b/,
  /\bresolution\b/
];

const DENOISE_TERMS = [
  /\bdenoise\b/,
  /\bde[- ]?noise\b/,
  /\bnoise\b/,
  /\bgrain\b/,
  /\bblocky\b/,
  /\bcompression\b/,
  /\bartifact/i,
  /\blow[- ]?light\b/,
  /\bsensor grain\b/,
  /\bweb video\b/
];

const HEAVY_DENOISE_TERMS = [
  /\bheavy\b/,
  /\bsevere\b/,
  /\bblocky\b/,
  /\bcompression block/i,
  /\bheavily degraded\b/,
  /\bawful\b/,
  /\bterrible\b/
];

const COLOR_TERMS = [
  /\bcolor correct/i,
  /\bcolour correct/i,
  /\bwhite balance\b/,
  /\bexposure\b/,
  /\bcontrast\b/,
  /\bsaturation\b/,
  /\bgrade\b/,
  /\bwashed out\b/
];

const MOTION_TERMS = [
  /\bsmooth motion\b/,
  /\bslow motion\b/,
  /\binterpolat/i,
  /\bfps conversion\b/,
  /\bconvert .*fps\b/,
  /\b\d{2,3}\s*fps\b/
];

function textOf(value) {
  return String(value || "").toLowerCase();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseTargetFps(text) {
  const match = text.match(/\b(24|25|30|48|50|60|72|90|96|100|120)\s*fps\b/i);
  if (match) return Number(match[1]);
  if (/\bslow motion\b|\bsmooth motion\b|\bfps conversion\b|\binterpolat/i.test(text)) return 60;
  return null;
}

function parseUpscaleFactor(text) {
  const explicit = text.match(/\b([23468])\s*x\b|\bx\s*([23468])\b/i);
  if (explicit) return Math.min(4, Number(explicit[1] || explicit[2]));
  if (/\b4k\b|\buhd\b|\b2160p\b/i.test(text)) {
    if (/\b1080p\b|\bfull hd\b/i.test(text)) return 2;
    return 4;
  }
  if (/\b2k\b|\b1440p\b|\bdouble\b|\btwice\b/i.test(text)) return 2;
  if (/\b480p\b|\b360p\b|\b240p\b|\bvhs\b|\bvery low[- ]?res\b|\blow[- ]?res\b/i.test(text)) return 4;
  if (hasAny(text, UPSCALE_TERMS)) return 2;
  return 1;
}

function choosePrimaryEngine(text, upscaleFactor) {
  const wantsUpscale = upscaleFactor > 1 || hasAny(text, UPSCALE_TERMS) || hasAny(text, SUPIR_TERMS) || hasAny(text, REAL_ESRGAN_TERMS);
  if (!wantsUpscale) return UPSCALE_ENGINES.NONE;
  const realHint = hasAny(text, REAL_ESRGAN_TERMS);
  const supirHint = hasAny(text, SUPIR_TERMS);
  if (realHint && !/\bsupir\b|\bphotoreal|\bfacial|\bface(s)?\b|\bskin\b|\brestore/i.test(text)) return UPSCALE_ENGINES.REAL_ESRGAN;
  if (supirHint) return UPSCALE_ENGINES.SUPIR;
  return UPSCALE_ENGINES.REAL_ESRGAN;
}

function denoiseStrength(text) {
  if (!hasAny(text, DENOISE_TERMS)) return 0.0;
  if (hasAny(text, HEAVY_DENOISE_TERMS)) return 0.85;
  if (/\blow[- ]?light\b|\bsensor grain\b|\bgrain\b/i.test(text)) return 0.55;
  return 0.35;
}

function generativeFidelity(text, primaryEngine) {
  if (primaryEngine === UPSCALE_ENGINES.NONE) return 0.0;
  if (primaryEngine === UPSCALE_ENGINES.REAL_ESRGAN) {
    return /\bwithout changing|\bpreserve|\bdo not hallucinate|\bno hallucination/i.test(text) ? 0.1 : 0.2;
  }
  if (/\bwithout changing|\bpreserve|\bfaithful|\bsource texture|\bdo not hallucinate|\bno hallucination/i.test(text)) return 0.35;
  if (/\bincredibly sharp|\bhyper[- ]?real|\bmicro[- ]?detail|\bskin|\bfabric|\bfaces?\b/i.test(text)) return 0.75;
  return 0.6;
}

function safetyTier({ primaryEngine, motionEngine, upscaleFactor, denoise }) {
  if (primaryEngine === UPSCALE_ENGINES.SUPIR || (upscaleFactor === 4 && denoise >= 0.65) || motionEngine === UPSCALE_ENGINES.FRAME_INTERPOLATION && upscaleFactor === 4) {
    return "Extreme_VRAM";
  }
  if (motionEngine === UPSCALE_ENGINES.FRAME_INTERPOLATION || primaryEngine === UPSCALE_ENGINES.REAL_ESRGAN && upscaleFactor >= 2) return "Performance";
  return "Standard";
}

function intentAnalysis({ text, primaryEngine, motionEngine, filters }) {
  if (primaryEngine === UPSCALE_ENGINES.SUPIR && filters.includes("Denoise_Deartifact")) {
    return "Restoration, deartifacting, and photoreal detail recovery for degraded source footage.";
  }
  if (primaryEngine === UPSCALE_ENGINES.SUPIR) return "Photoreal source enhancement with controlled generative detail recovery.";
  if (primaryEngine === UPSCALE_ENGINES.REAL_ESRGAN && motionEngine === UPSCALE_ENGINES.FRAME_INTERPOLATION) {
    return "Fast upscale with motion smoothing while preserving graphic and editorial structure.";
  }
  if (primaryEngine === UPSCALE_ENGINES.REAL_ESRGAN) return "Fast non-generative sharpening and resolution increase for production media.";
  if (motionEngine === UPSCALE_ENGINES.FRAME_INTERPOLATION) return "Frame interpolation requested without spatial upscaling.";
  if (filters.length) return "Preprocessing pass requested without spatial upscaling.";
  return text.trim() ? "Enhancement directive parsed with no upscale engine required." : "No enhancement directive supplied.";
}

export const SOURCE_TAKE_REQUIRED = "Upscale Plan requires one exact approved source take.";

function nonEmpty(value) {
  return String(value == null ? "" : value).trim();
}

function positiveInt(value) {
  const n = typeof value === "number" ? value : Number(String(value == null ? "" : value).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  const n = typeof value === "number" ? value : Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function fileName(value) {
  return nonEmpty(value).split(/[/\\]/).pop().toLowerCase();
}

function fingerprintsOf(record) {
  if (!record || typeof record !== "object") return undefined;
  const fingerprints = {};
  let sha256 = String(record.sha256 || record.sourceSha256 || "").trim().toLowerCase();
  const hashes = Array.isArray(record.fileHashes) ? record.fileHashes : [];
  if (!/^[a-f0-9]{64}$/.test(sha256) && hashes.length) {
    const hashed = hashes.filter((entry) => /^[a-f0-9]{64}$/i.test(String(entry?.sha256 || "")));
    const wanted = fileName(record.file);
    const matched = wanted
      ? hashed.find((entry) => fileName(entry?.file) === wanted)
      : null;
    const pick = matched || (hashed.length === 1 ? hashed[0] : null);
    if (pick) sha256 = String(pick.sha256).trim().toLowerCase();
  }
  if (/^[a-f0-9]{64}$/.test(sha256)) fingerprints.sha256 = sha256;
  const assetFingerprint = String(record.assetFingerprint || record.versionFingerprint || "").trim();
  if (assetFingerprint) fingerprints.assetFingerprint = assetFingerprint;
  if (hashes.length) {
    fingerprints.fileHashes = hashes.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry));
  }
  return Object.keys(fingerprints).length ? fingerprints : undefined;
}

export function normalizeTakeVersion(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const v = positiveInt(value);
    return v ? { kind: "full", v } : null;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    // A range label without frame bounds is not an exact source identity.
    if (/^range[:\s-]*v?\d+$/i.test(text)) return null;
    const full = text.match(/^v?(\d+)$/i);
    if (full) return { kind: "full", v: Number(full[1]) };
    return null;
  }
  if (typeof value !== "object") return null;
  const v = positiveInt(value.v ?? value.version ?? value.assetVersion);
  if (!v) return null;
  const kindRaw = String(value.kind || value.type || "").trim().toLowerCase();
  const hasRangeFrames = value.startFrame != null || value.endFrame != null;
  const kind = kindRaw === "range" || (kindRaw !== "full" && hasRangeFrames) ? "range" : "full";
  const takeVersion = { kind, v };
  if (kind === "range") {
    const startFrame = nonNegativeInt(value.startFrame);
    const endFrame = nonNegativeInt(value.endFrame);
    if (startFrame == null || endFrame == null || endFrame <= startFrame) return null;
    takeVersion.startFrame = startFrame;
    takeVersion.endFrame = endFrame;
  }
  return takeVersion;
}

export function normalizeSourceTake(sourceTake) {
  if (!sourceTake || typeof sourceTake !== "object") return null;
  const projectSlug = nonEmpty(sourceTake.projectSlug);
  const clipId = nonEmpty(sourceTake.clipId);
  const file = nonEmpty(sourceTake.file);
  const takeVersion = normalizeTakeVersion(sourceTake.takeVersion ?? sourceTake.assetVersion ?? sourceTake.v);
  if (!projectSlug || !clipId || !file || !takeVersion) return null;
  const fingerprints = fingerprintsOf(sourceTake.fingerprints) || fingerprintsOf(sourceTake);
  return {
    projectSlug,
    clipId,
    takeVersion,
    file,
    ...(fingerprints ? { fingerprints } : {})
  };
}

function takeIsApproved(clip, take, kind) {
  if (!clip || !take) return false;
  if (take.approved === true) return true;
  if (nonEmpty(take.approvalStatus)?.toLowerCase() === "approved") return true;
  if (nonEmpty(take.approval?.status)?.toLowerCase() === "approved") return true;
  const version = positiveInt(take.v);
  if (version && positiveInt(clip.approvedTakeVersion) === version) return true;
  if (kind === "full") {
    return Boolean(
      version
      && positiveInt(clip.activeVersion) === version
      && (clip.status === "done" || clip.approved === true)
    );
  }
  return Boolean(
    kind === "range"
    && take.active !== false
    && (clip.status === "done" || clip.status === "ranges-ready" || clip.approved === true)
  );
}

function sourceTakeFromRecord(projectSlug, clip, take, kind) {
  if (!clip || !take || !takeIsApproved(clip, take, kind)) return null;
  if (kind === "range" && take.active === false) return null;
  const takeVersion = normalizeTakeVersion(kind === "range"
    ? { kind, v: take.v, startFrame: take.startFrame, endFrame: take.endFrame }
    : { kind, v: take.v });
  if (!takeVersion) return null;
  return normalizeSourceTake({
    projectSlug,
    clipId: clip.id,
    takeVersion,
    file: take.file,
    fingerprints: fingerprintsOf(take)
  });
}

function takeVersionsMatch(left, right) {
  if (!left || !right || left.kind !== right.kind || left.v !== right.v) return false;
  return left.kind !== "range"
    || (left.startFrame === right.startFrame && left.endFrame === right.endFrame);
}

function takeFromClip(clip) {
  if (!clip || typeof clip !== "object") return null;
  const versions = Array.isArray(clip.versions) ? clip.versions : [];
  const activeV = positiveInt(clip.activeVersion);
  const activeFull = activeV
    ? versions.find((version) => (
      positiveInt(version?.v) === activeV
      && nonEmpty(version?.file)
      && takeIsApproved(clip, version, "full")
    ))
    : null;
  if (activeFull) {
    return {
      takeVersion: { kind: "full", v: activeV },
      file: nonEmpty(activeFull.file),
      fingerprints: fingerprintsOf(activeFull)
    };
  }
  const ranges = Array.isArray(clip.rangeVersions) ? clip.rangeVersions : [];
  const activeRange = ranges
    .filter((range) => (
      range
      && range.active !== false
      && nonEmpty(range.file)
      && positiveInt(range.v)
      && takeIsApproved(clip, range, "range")
      && normalizeTakeVersion({
        kind: "range",
        v: range.v,
        startFrame: range.startFrame,
        endFrame: range.endFrame
      })
    ))
    .sort((left, right) => (
      (positiveInt(right.v) || 0) - (positiveInt(left.v) || 0)
      || String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    ))[0];
  if (!activeRange) return null;
  const takeVersion = normalizeTakeVersion({
    kind: "range",
    v: activeRange.v,
    startFrame: activeRange.startFrame,
    endFrame: activeRange.endFrame
  });
  if (!takeVersion) return null;
  return {
    takeVersion,
    file: nonEmpty(activeRange.file),
    fingerprints: fingerprintsOf(activeRange)
  };
}

export function listApprovedSourceTakes(project) {
  const projectSlug = nonEmpty(project?.slug);
  if (!projectSlug) return [];
  const clips = Array.isArray(project?.sequence?.clips) ? project.sequence.clips : [];
  const sourceTakes = [];
  for (const clip of clips) {
    for (const version of Array.isArray(clip?.versions) ? clip.versions : []) {
      const sourceTake = sourceTakeFromRecord(projectSlug, clip, version, "full");
      if (sourceTake) sourceTakes.push(sourceTake);
    }
    for (const range of Array.isArray(clip?.rangeVersions) ? clip.rangeVersions : []) {
      const sourceTake = sourceTakeFromRecord(projectSlug, clip, range, "range");
      if (sourceTake) sourceTakes.push(sourceTake);
    }
  }
  return sourceTakes;
}

export function resolveApprovedSourceTake(project, preferredClipId, preferredTakeVersion) {
  const projectSlug = nonEmpty(project?.slug);
  if (!projectSlug) return null;
  const clips = Array.isArray(project?.sequence?.clips) ? project.sequence.clips : [];
  const wantedId = nonEmpty(preferredClipId);
  if (!wantedId) return null;
  const clip = clips.find((item) => nonEmpty(item?.id) === wantedId) || null;
  if (!clip) return null;
  if (preferredTakeVersion != null) {
    const wantedVersion = normalizeTakeVersion(preferredTakeVersion);
    if (!wantedVersion) return null;
    return listApprovedSourceTakes(project).find((sourceTake) => (
      sourceTake.clipId === wantedId
      && takeVersionsMatch(sourceTake.takeVersion, wantedVersion)
    )) || null;
  }
  const take = takeFromClip(clip);
  if (!take) return null;
  return normalizeSourceTake({
    projectSlug,
    clipId: nonEmpty(clip.id),
    takeVersion: take.takeVersion,
    file: take.file,
    fingerprints: take.fingerprints
  });
}

export function routeUpscaleDirective(directive = "") {
  const text = textOf(directive);
  const upscaleFactor = parseUpscaleFactor(text);
  const targetFps = parseTargetFps(text);
  const motionEngine = hasAny(text, MOTION_TERMS) || targetFps ? UPSCALE_ENGINES.FRAME_INTERPOLATION : UPSCALE_ENGINES.NONE;
  const primaryEngine = choosePrimaryEngine(text, upscaleFactor);
  const denoise = denoiseStrength(text);
  const preprocessFilters = [];
  if (denoise > 0) preprocessFilters.push("Denoise_Deartifact");
  if (hasAny(text, COLOR_TERMS)) preprocessFilters.push("Color_Correction");
  const fidelity = generativeFidelity(text, primaryEngine);
  const hardware = safetyTier({ primaryEngine, motionEngine, upscaleFactor, denoise });
  return {
    pipeline_routing: {
      primary_engine: primaryEngine,
      motion_engine: motionEngine,
      preprocess_filters: preprocessFilters
    },
    parameters: {
      upscale_factor: upscaleFactor,
      denoise_strength: round2(denoise),
      target_fps: targetFps,
      generative_fidelity: round2(fidelity)
    },
    director_metadata: {
      scene_intent_analysis: intentAnalysis({ text: directive, primaryEngine, motionEngine, filters: preprocessFilters }),
      hardware_safety_tier: hardware
    }
  };
}

export function buildUpscaleManifest(directive = "", sourceTake) {
  const identity = normalizeSourceTake(sourceTake);
  if (!identity) throw new Error(SOURCE_TAKE_REQUIRED);
  return {
    source_take: identity,
    ...routeUpscaleDirective(directive)
  };
}
