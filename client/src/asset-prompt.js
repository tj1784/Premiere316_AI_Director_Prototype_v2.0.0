const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const AUDIO_FILE_RE = /\.(mp3|wav|flac|m4a|aac|ogg)$/i;
const VIDEO_FILE_RE = /\.(mp4|mov|mkv|webm|avi|m4v|gif)$/i;

export const OUTPUT_MODES = Object.freeze([
  { id: "image", label: "Image", icon: "▧", usesAspect: true, usesDuration: false, defaultAspectRatio: "16:9", defaultDurationSec: null },
  { id: "video", label: "Video", icon: "▶", usesAspect: true, usesDuration: true, defaultAspectRatio: "16:9", defaultDurationSec: 8 },
  { id: "voice-design", label: "Voice Design", icon: "◖", usesAspect: false, usesDuration: false, defaultAspectRatio: null, defaultDurationSec: null },
  { id: "dialogue", label: "Dialogue", icon: "\u201c\u201d", usesAspect: false, usesDuration: false, defaultAspectRatio: null, defaultDurationSec: null },
  { id: "design", label: "Design", icon: "◇", usesAspect: true, usesDuration: false, defaultAspectRatio: "1:1", defaultDurationSec: null },
  { id: "audio", label: "Audio", icon: "≋", usesAspect: false, usesDuration: false, defaultAspectRatio: null, defaultDurationSec: null }
]);

const OUTPUT_MODE_MAP = new Map(OUTPUT_MODES.flatMap((mode) => [
  [mode.id, mode],
  [mode.label.toLowerCase(), mode]
]));

const CATEGORY_SUFFIXES = Object.freeze({
  character: "Character",
  wardrobe: "Wardrobe",
  location: "Location",
  artifact: "Prop",
  prop: "Prop",
  extra: "Crowd",
  atmosphere: "VFX",
  "guide-frame": "Guide",
  voice: "Voice",
  dialogue: "Dialogue",
  sound: "Sound",
  music: "Music",
  graphic: "Graphic",
  design: "Design",
  video: "Video"
});

const CATEGORY_ROLE = Object.freeze({
  character: "identity",
  wardrobe: "wardrobe",
  location: "location",
  artifact: "prop",
  prop: "prop",
  extra: "crowd",
  atmosphere: "atmosphere",
  "guide-frame": "location",
  graphic: "atmosphere",
  design: "atmosphere",
  voice: "voice",
  dialogue: "voice",
  sound: "audio",
  music: "audio",
  video: "motion"
});

const CATEGORY_PRIORITY = Object.freeze([
  "character",
  "location",
  "artifact",
  "wardrobe",
  "extra",
  "atmosphere",
  "guide-frame",
  "voice",
  "dialogue",
  "sound",
  "music",
  "graphic",
  "design",
  "video"
]);

const MODE_REFERENCE_PRIORITY = Object.freeze({
  image: ["image", "graphic", "video", "audio", "instruction"],
  video: ["image", "video", "audio", "graphic", "instruction"],
  "voice-design": ["audio", "instruction", "image", "video", "graphic"],
  dialogue: ["audio", "instruction", "image", "video", "graphic"],
  design: ["image", "graphic", "video", "audio", "instruction"],
  audio: ["audio", "instruction", "video", "image", "graphic"]
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function basename(value) {
  return String(value || "").replace(/\\/g, "/").split("/").at(-1) || "";
}

function versionFiles(version) {
  return unique([version?.file, ...asArray(version?.files)].map((file) => String(file || "").trim()));
}

function activeVersionOf(asset) {
  const requested = Number(asset?.activeVersion || 0);
  if (!requested) return null;
  return asArray(asset?.versions).find((version) => Number(version?.v) === requested) || null;
}

function activeFileOf(asset) {
  const version = activeVersionOf(asset);
  return versionFiles(version)[0] || null;
}

function previewTypeFor(asset, file) {
  const mediaType = String(asset?.mediaType || "").toLowerCase();
  if (IMAGE_FILE_RE.test(String(file || "")) || mediaType === "image" || mediaType === "graphic") return "image";
  if (AUDIO_FILE_RE.test(String(file || "")) || mediaType === "audio") return "audio";
  if (VIDEO_FILE_RE.test(String(file || "")) || mediaType === "video") return "video";
  return "none";
}

function genericVariant(value) {
  return /^(primary|appearance|production reference|reference|voice design|default)$/i.test(String(value || "").trim());
}

function normalizeOutputMode(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return OUTPUT_MODE_MAP.get(key) || OUTPUT_MODE_MAP.get(String(value || "").trim().toLowerCase()) || null;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function humanizeFieldKey(value) {
  const text = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "Option";
}

const DEFAULT_PRIMARY_PROMPTS = Object.freeze({
  image: { key: "prompt", label: "Direction", required: true },
  video: { key: "prompt", label: "Direction", required: true },
  design: { key: "prompt", label: "Direction", required: true },
  "voice-design": {
    key: "voiceInstruction",
    label: "Voice identity / performance instruction",
    placeholder: "A warm, weathered voice with restrained authority",
    required: true,
    help: "Describe timbre, register, accent, pacing, breath, and performance character."
  },
  dialogue: {
    key: "performanceDirection",
    label: "Performance direction",
    placeholder: "Quiet, urgent, close-mic delivery before dawn",
    required: true,
    help: "Direct the delivery here; enter the exact spoken words separately."
  },
  audio: {
    key: "prompt",
    label: "Sound / music description",
    placeholder: "Footsteps and distant chains echoing through the dungeon",
    required: true
  }
});

const DEFAULT_MODE_FIELDS = Object.freeze({
  "voice-design": [{
    key: "sampleText",
    type: "textarea",
    label: "Audition line (exact words)",
    placeholder: "The light has come, and darkness cannot overcome it.",
    required: true,
    help: "This text is spoken verbatim to audition the designed voice."
  }],
  dialogue: [{
    key: "dialogueText",
    type: "textarea",
    label: "Exact dialogue",
    placeholder: "We leave before dawn.",
    required: true,
    help: "Enter only the words the selected speaker should say."
  }]
});

const REFERENCE_APPLICATION_DESCRIPTIONS = Object.freeze({
  "prompt-context-only": {
    label: "Prompt context only",
    description: "Pinned assets add bounded text context to the audio prompt; their media is not sent as model conditioning."
  },
  "association-only": {
    label: "Character association only",
    description: "The pinned character records who the generated voice belongs to; the character image does not condition the audio."
  },
  "provider-conditioning": {
    label: "Provider voice conditioning",
    description: "The approved voice pin resolves to its explicitly linked provider voice and conditions the dialogue. Character names are never guessed as voices."
  }
});

export function describeReferenceApplication(value) {
  const id = String(value || "").trim();
  if (REFERENCE_APPLICATION_DESCRIPTIONS[id]) return { id, ...REFERENCE_APPLICATION_DESCRIPTIONS[id] };
  if (!id) {
    return {
      id: "",
      label: "Exact version pins",
      description: "Every mention submits its exact asset ID, version, file, and role. The selected workflow determines how those pins are applied."
    };
  }
  return {
    id,
    label: humanizeFieldKey(id),
    description: `This workflow declares reference application as “${id}”. Exact asset IDs, versions, files, and roles remain pinned.`
  };
}

function normalizedField(rawField, optionSpec = {}, requiredKeys = []) {
  const raw = typeof rawField === "string" ? { key: rawField } : (rawField && typeof rawField === "object" ? rawField : {});
  const key = String(raw.key || raw.name || "").trim();
  if (!key) return null;
  const schemaType = Array.isArray(optionSpec?.type) ? optionSpec.type.find((type) => type !== "null") : optionSpec?.type;
  const enumValues = asArray(hasOwn(raw, "enum") ? raw.enum : optionSpec?.enum);
  const type = String(raw.type || (enumValues.length ? "select" : schemaType === "number" || schemaType === "integer" ? "number" : "text"));
  const minimum = hasOwn(raw, "min") ? raw.min : optionSpec?.minimum;
  const maximum = hasOwn(raw, "max") ? raw.max : optionSpec?.maximum;
  const step = hasOwn(raw, "step") ? raw.step : optionSpec?.multipleOf;
  return {
    key,
    type,
    label: String(raw.label || optionSpec?.title || humanizeFieldKey(key)),
    placeholder: String(raw.placeholder || ""),
    required: hasOwn(raw, "required") ? raw.required === true : requiredKeys.includes(key),
    enum: enumValues,
    min: Number.isFinite(Number(minimum)) ? Number(minimum) : undefined,
    max: Number.isFinite(Number(maximum)) ? Number(maximum) : undefined,
    step: Number.isFinite(Number(step)) ? Number(step) : undefined,
    default: hasOwn(raw, "default") ? raw.default : optionSpec?.default,
    help: String(raw.help || optionSpec?.description || ""),
    maxLength: Number.isFinite(Number(raw.maxLength ?? optionSpec?.maxLength)) ? Number(raw.maxLength ?? optionSpec?.maxLength) : undefined
  };
}

export function getWorkflowComposerContract(workflow, outputMode) {
  const mode = normalizeOutputMode(outputMode) || OUTPUT_MODES[0];
  const composerSchema = workflow?.composerSchema && typeof workflow.composerSchema === "object" ? workflow.composerSchema : {};
  const optionSchema = workflow?.optionSchema && typeof workflow.optionSchema === "object" ? workflow.optionSchema : {};
  const properties = optionSchema?.properties && typeof optionSchema.properties === "object" ? optionSchema.properties : {};
  const requiredKeys = asArray(optionSchema?.required).map(String);
  const defaultPrimary = DEFAULT_PRIMARY_PROMPTS[mode.id] || DEFAULT_PRIMARY_PROMPTS.image;
  const primaryRaw = composerSchema?.primaryPrompt && typeof composerSchema.primaryPrompt === "object" ? composerSchema.primaryPrompt : {};
  const primaryPrompt = {
    ...defaultPrimary,
    ...primaryRaw,
    key: String(primaryRaw.key || defaultPrimary.key || "prompt"),
    label: String(primaryRaw.label || defaultPrimary.label || "Direction"),
    placeholder: String(primaryRaw.placeholder || defaultPrimary.placeholder || ""),
    required: hasOwn(primaryRaw, "required") ? primaryRaw.required === true : defaultPrimary.required !== false,
    help: String(primaryRaw.help || defaultPrimary.help || ""),
    maxLength: Number.isFinite(Number(primaryRaw.maxLength)) ? Number(primaryRaw.maxLength) : undefined
  };

  const explicitFields = asArray(composerSchema?.fields);
  const sourceFields = explicitFields.length ? explicitFields : asArray(DEFAULT_MODE_FIELDS[mode.id]);
  const fields = [];
  const fieldIndexes = new Map();
  const addField = (rawField) => {
    const key = String(typeof rawField === "string" ? rawField : rawField?.key || rawField?.name || "").trim();
    const field = normalizedField(rawField, properties[key] || {}, requiredKeys);
    if (!field) return;
    if (fieldIndexes.has(field.key)) {
      const index = fieldIndexes.get(field.key);
      fields[index] = { ...fields[index], ...field };
      return;
    }
    fieldIndexes.set(field.key, fields.length);
    fields.push(field);
  };
  sourceFields.forEach(addField);

  const addOutputSetting = (key, fallback) => {
    if (fieldIndexes.has(key)) return;
    if (!properties[key] && !fallback) return;
    const field = { key, ...fallback };
    const property = properties[key];
    if (property) {
      if (Array.isArray(property.enum)) delete field.enum;
      if (property.minimum !== undefined) delete field.min;
      if (property.maximum !== undefined) delete field.max;
      if (property.multipleOf !== undefined) delete field.step;
      if (property.default !== undefined) delete field.default;
      if (property.title) delete field.label;
      if (property.description) delete field.help;
    }
    addField(field);
  };
  addOutputSetting("aspectRatio", mode.usesAspect ? {
    type: "select",
    label: "Aspect ratio",
    required: true,
    default: mode.defaultAspectRatio
  } : null);
  addOutputSetting("durationSec", mode.usesDuration ? {
    type: "number",
    label: "Duration",
    required: true,
    min: 0.1,
    max: 3600,
    step: 0.1,
    default: mode.defaultDurationSec,
    help: "Seconds"
  } : null);

  let speakerReference = null;
  const rawSpeaker = composerSchema?.speakerReference;
  if ((rawSpeaker && typeof rawSpeaker === "object") || mode.id === "dialogue") {
    const source = rawSpeaker && typeof rawSpeaker === "object" ? rawSpeaker : {};
    speakerReference = {
      required: hasOwn(source, "required") ? source.required === true : true,
      label: String(source.label || "Speaker voice"),
      help: String(source.help || "Choose an approved, exact-version voice asset. Character names are never guessed as voices."),
      acceptedAssetIds: unique(asArray(source.acceptedAssetIds).map(String)),
      restrictToAcceptedAssetIds: hasOwn(source, "acceptedAssetIds"),
      acceptedMediaTypes: unique(asArray(source.acceptedMediaTypes).map((value) => String(value).toLowerCase()).concat("audio")),
      acceptedCategories: unique(asArray(source.acceptedCategories).map((value) => String(value).toLowerCase()).concat("voice")),
      acceptedRoles: unique(asArray(source.acceptedRoles).map(String).concat("voice")),
      requireApproved: source.requireApproved !== false
    };
  }

  const referenceApplication = String(composerSchema?.referenceApplication || workflow?.referencePolicy?.application || "").trim();
  return { primaryPrompt, fields, speakerReference, referenceApplication };
}

export function normalizeMentionKey(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeAssetHandlePart(value) {
  const source = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\.(png|jpe?g|webp|gif|svg|mp3|wav|flac|m4a|aac|ogg|mp4|mov|mkv|webm)$/i, "")
    .replace(/[’']/g, "");
  const words = source.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((word) => {
    if (/^\d+$/.test(word)) return word;
    if (word.length <= 3 && word === word.toUpperCase()) return word[0] + word.slice(1).toLowerCase();
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).join("");
}

export function primaryAssetAlias(asset) {
  const explicit = String(asset?.mentionHandle || asset?.handle || "").trim().replace(/^@/, "");
  if (explicit) return explicit;
  const name = String(asset?.name || "").trim();
  if (name) {
    const primary = name.split(/\s+(?:-|–|—|:)\s+/, 1)[0].trim();
    return primary || name;
  }
  const id = String(asset?.id || "asset").replace(/^[a-z]+-/, "");
  return id.split("-").slice(0, 4).join(" ") || "asset";
}

export function defaultReferenceRole(assetOrCategory) {
  const category = typeof assetOrCategory === "string"
    ? assetOrCategory
    : String(assetOrCategory?.category || "");
  return CATEGORY_ROLE[category] || (assetOrCategory?.mediaType === "audio" ? "audio" : "reference");
}

export function assetAliases(asset) {
  const aliases = [];
  const add = (value) => {
    const normalized = normalizeMentionKey(value);
    if (normalized) aliases.push(normalized);
  };
  const primary = primaryAssetAlias(asset);
  const handlePrimary = normalizeAssetHandlePart(primary);
  const category = String(asset?.category || asset?.mediaType || "asset").trim();
  const fileExtension = asset?.mediaType === "audio" ? ".wav" : asset?.mediaType === "video" ? ".mp4" : ".png";

  add(primary);
  add(handlePrimary);
  add(asset?.name);
  add(asset?.id);
  add(`${category}_${handlePrimary}`);
  add(`${category}_${handlePrimary}${fileExtension}`);
  add(`${category}-${handlePrimary}`);
  for (const alias of [...asArray(asset?.aliases), ...asArray(asset?.mentionAliases)]) add(alias);
  for (const candidate of [asset?.canonicalFile, asset?.sourceAssetFile, activeFileOf(asset)]) {
    if (!candidate) continue;
    add(basename(candidate));
    add(basename(candidate).replace(/\.v\d+(?:-\d+)?(?=\.)/i, ""));
  }
  return unique(aliases);
}

function assetPriority(asset) {
  const categoryIndex = CATEGORY_PRIORITY.indexOf(String(asset?.category || ""));
  const categoryScore = categoryIndex < 0 ? CATEGORY_PRIORITY.length : categoryIndex;
  const variant = String(asset?.variant || "");
  const primaryVariant = /appearance|primary|identity|production reference/i.test(variant) ? 0 : 1;
  const generated = Number(asset?.activeVersion || 0) > 0 ? 0 : 1;
  return [categoryScore, primaryVariant, generated, String(asset?.id || "")];
}

function comparePriority(left, right) {
  const a = assetPriority(left);
  const b = assetPriority(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return typeof a[index] === "number" ? a[index] - b[index] : String(a[index]).localeCompare(String(b[index]));
  }
  return 0;
}

function exactVersionApproved(asset, version) {
  if (asset?.approvalCurrent === true) return true;
  return Boolean(
    asset?.approval?.status === "approved" &&
    Number(asset.approval.activeVersion) === Number(version)
  );
}

function categorySuffix(asset) {
  const category = String(asset?.category || "").toLowerCase();
  return CATEGORY_SUFFIXES[category] || normalizeAssetHandlePart(category || asset?.mediaType || "Asset") || "Asset";
}

export function buildAssetMentionOptions(assets = []) {
  const provisional = asArray(assets).filter((asset) => asset?.id).map((asset) => {
    const basePart = normalizeAssetHandlePart(primaryAssetAlias(asset)) || "Asset";
    return { asset, basePart, baseKey: normalizeMentionKey(basePart) };
  });
  const groups = new Map();
  for (const entry of provisional) {
    if (!groups.has(entry.baseKey)) groups.set(entry.baseKey, []);
    groups.get(entry.baseKey).push(entry);
  }

  const usedHandles = new Set();
  const handleById = new Map();
  for (const entries of groups.values()) {
    entries.sort((left, right) => comparePriority(left.asset, right.asset));
    entries.forEach((entry, index) => {
      let part = entry.basePart;
      if (index > 0) {
        part = `${entry.basePart}_${categorySuffix(entry.asset)}`;
        if (usedHandles.has(normalizeMentionKey(part)) && !genericVariant(entry.asset?.variant)) {
          part = `${part}_${normalizeAssetHandlePart(entry.asset.variant)}`;
        }
      }
      let candidate = part;
      let suffix = 2;
      while (usedHandles.has(normalizeMentionKey(candidate))) candidate = `${part}_${suffix++}`;
      usedHandles.add(normalizeMentionKey(candidate));
      handleById.set(entry.asset.id, `@${candidate}`);
    });
  }

  return provisional.map(({ asset }) => {
    const handle = handleById.get(asset.id);
    const activeVersion = Number(asset.activeVersion || 0);
    const activeVersionRecord = activeVersionOf(asset);
    const activeFile = versionFiles(activeVersionRecord)[0] || null;
    const mediaType = String(asset.mediaType || "").toLowerCase() || previewTypeFor(asset, activeFile);
    return {
      asset,
      assetId: String(asset.id),
      name: String(asset.name || asset.id),
      variant: String(asset.variant || "Production Reference"),
      category: String(asset.category || "asset"),
      categoryLabel: String(asset.categoryLabel || asset.category || "Asset"),
      mediaType,
      handle,
      handleKey: normalizeMentionKey(handle),
      aliases: unique([normalizeMentionKey(handle), ...assetAliases(asset)]),
      activeVersion,
      activeFile,
      previewType: previewTypeFor(asset, activeFile),
      role: defaultReferenceRole(asset),
      approved: exactVersionApproved(asset, activeVersion),
      available: Boolean(activeVersion && activeVersionRecord && activeFile),
      searchText: `${handle} ${asset.name || ""} ${asset.variant || ""} ${asset.categoryLabel || asset.category || ""} ${asset.id}`.toLowerCase()
    };
  }).sort((left, right) => comparePriority(left.asset, right.asset));
}

export function resolveMentionToken(token, options = []) {
  const key = normalizeMentionKey(token);
  if (!key) return { status: "unresolved", token, candidates: [] };
  const exactHandles = options.filter((option) => option.handleKey === key);
  if (exactHandles.length === 1) return { status: "resolved", token, option: exactHandles[0], candidates: exactHandles };
  const aliases = options.filter((option) => option.aliases?.includes(key));
  if (aliases.length === 1) return { status: "resolved", token, option: aliases[0], candidates: aliases };
  if (aliases.length > 1 || exactHandles.length > 1) {
    const candidates = exactHandles.length > 1 ? exactHandles : aliases;
    return { status: "ambiguous", token, candidates };
  }
  return { status: "unresolved", token, candidates: [] };
}

function mentionCharacter(character, nextCharacter = "") {
  if (/[A-Za-z0-9_-]/.test(character)) return true;
  return character === "." && /[A-Za-z0-9]/.test(nextCharacter);
}

function mentionBoundary(character) {
  return !character || /[\s([{,;:]/.test(character);
}

export function parseMentionTokens(text) {
  const source = String(text || "");
  const tokens = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "@" || !mentionBoundary(source[index - 1])) continue;
    let end = index + 1;
    while (end < source.length && mentionCharacter(source[end], source[end + 1])) end += 1;
    const raw = source.slice(index, end);
    tokens.push({
      raw,
      key: normalizeMentionKey(raw),
      query: raw.slice(1),
      start: index,
      end,
      complete: raw.length > 1
    });
    index = Math.max(index, end - 1);
  }
  return tokens;
}

export function mentionQueryAtCaret(text, caret) {
  const source = String(text || "");
  const safeCaret = Math.max(0, Math.min(source.length, Number(caret) || 0));
  let start = safeCaret;
  while (start > 0) {
    const character = source[start - 1];
    if (character === "@") {
      const boundary = source[start - 2];
      if (!mentionBoundary(boundary)) return null;
      return { start: start - 1, end: safeCaret, raw: source.slice(start - 1, safeCaret), query: source.slice(start, safeCaret) };
    }
    if (!/[A-Za-z0-9_.-]/.test(character)) return null;
    start -= 1;
  }
  return null;
}

export function replaceMentionAtCaret(text, caret, handle) {
  const source = String(text || "");
  const match = mentionQueryAtCaret(source, caret);
  const canonical = `@${String(handle || "").replace(/^@+/, "")}`;
  const start = match?.start ?? Math.max(0, Math.min(source.length, Number(caret) || 0));
  const end = match?.end ?? start;
  const before = source.slice(0, start);
  const after = source.slice(end);
  const separator = after && /^[A-Za-z0-9@]/.test(after) ? " " : "";
  const nextText = `${before}${canonical}${separator}${after}`;
  return { text: nextText, caret: before.length + canonical.length + separator.length, start, end: start + canonical.length };
}

export function removeMentionToken(text, token) {
  const key = normalizeMentionKey(token);
  let source = String(text || "");
  const matches = parseMentionTokens(source).filter((item) => item.key === key).reverse();
  for (const match of matches) source = `${source.slice(0, match.start)}${source.slice(match.end)}`;
  return source
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/^ +| +$/gm, "")
    .trim();
}

export function createAssetPin(option, token = option?.handle) {
  if (!option) return null;
  return {
    token: String(token || option.handle),
    tokenKey: normalizeMentionKey(token || option.handle),
    handle: option.handle,
    assetId: option.assetId,
    assetVersion: Number(option.activeVersion || 0),
    role: option.role,
    name: option.name,
    variant: option.variant,
    category: option.category,
    mediaType: option.mediaType,
    file: option.activeFile || null,
    approved: option.approved === true
  };
}

export function reconcileMentionPins(text, existingPins = [], options = []) {
  const tokens = parseMentionTokens(text);
  const previous = new Map(asArray(existingPins).map((pin) => [normalizeMentionKey(pin?.token || pin?.handle), pin]));
  const resolvedPins = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!token.complete) continue;
    const resolution = resolveMentionToken(token.raw, options);
    if (resolution.status !== "resolved" || !resolution.option) continue;
    const prior = previous.get(token.key);
    const pin = prior?.assetId === resolution.option.assetId
      ? {
        ...prior,
        token: token.raw,
        tokenKey: token.key,
        approved: Number(prior.assetVersion) === Number(resolution.option.activeVersion) && resolution.option.approved === true
      }
      : createAssetPin(resolution.option, token.raw);
    const identity = `${pin.assetId}:v${pin.assetVersion}:${pin.role}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    resolvedPins.push(pin);
  }
  return resolvedPins;
}

function workflowText(workflow) {
  return [workflow?.id, workflow?.label, workflow?.name, workflow?.purpose, workflow?.family, workflow?.outputMode, ...asArray(workflow?.tags)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function workflowMediaType(workflow) {
  const explicit = String(workflow?.mediaType || workflow?.outputType || workflow?.kind || "").toLowerCase();
  if (explicit) return explicit;
  const text = workflowText(workflow);
  if (/video|\bt2v\b|\bi2v\b|ltx/.test(text)) return "video";
  if (/audio|voice|tts|dialogue|music|sound|speech/.test(text)) return "audio";
  if (/graphic|title card|svg/.test(text)) return "graphic";
  if (/image|still|flux|krea|design|reference sheet/.test(text)) return "image";
  return "unknown";
}

export function workflowCompatibleWithMode(workflow, outputMode) {
  const mode = normalizeOutputMode(outputMode);
  if (!workflow || !mode) return false;
  const declared = unique([
    ...asArray(workflow.supportedOutputModes),
    ...asArray(workflow.outputModes)
  ].map((value) => normalizeOutputMode(value)?.id));
  if (declared.length) return declared.includes(mode.id);

  const mediaType = workflowMediaType(workflow);
  const text = workflowText(workflow);
  if (mode.id === "image") return mediaType === "image";
  if (mode.id === "video") return mediaType === "video";
  if (mode.id === "voice-design") return mediaType === "audio" && /voice.?design|voice identity|voice clone|qwen.*tts/.test(text);
  if (mode.id === "dialogue") return mediaType === "audio" && /dialogue|tts|speech|talk|voice.?design|qwen.*tts/.test(text);
  if (mode.id === "design") return mediaType === "graphic" || (mediaType === "image" && /design|style|sheet|reference|prop|character|location|title|still|flux|krea/.test(text));
  if (mode.id === "audio") return mediaType === "audio" || (mediaType === "instruction" && /audio|sound|music|foley|ambience/.test(text));
  return false;
}

export function workflowIsReady(workflow) {
  return Boolean(workflow && workflow.ready === true && workflow.availableNow === true);
}

export function filterCompatibleWorkflows(workflows = [], outputMode, { includeUnavailable = true } = {}) {
  return asArray(workflows)
    .filter((workflow) => workflowCompatibleWithMode(workflow, outputMode))
    .filter((workflow) => includeUnavailable || workflowIsReady(workflow))
    .slice()
    .sort((left, right) => {
      const leftReady = workflowIsReady(left) ? 0 : 1;
      const rightReady = workflowIsReady(right) ? 0 : 1;
      return leftReady - rightReady || String(left.label || left.name || left.id).localeCompare(String(right.label || right.name || right.id));
    });
}

function workflowReferenceMedia(workflow) {
  return unique([
    ...asArray(workflow?.referenceMediaTypes),
    ...asArray(workflow?.supportedReferenceMediaTypes),
    ...asArray(workflow?.referencePolicy?.acceptedMediaTypes)
  ].map((value) => String(value || "").toLowerCase()));
}

function workflowReferenceAssetIds(workflow) {
  return unique(asArray(workflow?.referencePolicy?.acceptedAssetIds).map(String));
}

export function filterMentionOptions(options = [], { query = "", outputMode = "image", workflow = null, limit = 12 } = {}) {
  const needle = normalizeMentionKey(query);
  const allowedMedia = workflowReferenceMedia(workflow);
  const acceptedAssetIds = workflowReferenceAssetIds(workflow);
  const restrictToAcceptedAssetIds = hasOwn(workflow?.referencePolicy, "acceptedAssetIds");
  const acceptedCategories = unique(asArray(workflow?.referencePolicy?.acceptedCategories).map((value) => String(value).toLowerCase()));
  const mode = normalizeOutputMode(outputMode)?.id || "image";
  const mediaPriority = MODE_REFERENCE_PRIORITY[mode] || MODE_REFERENCE_PRIORITY.image;
  return asArray(options)
    .filter((option) => !restrictToAcceptedAssetIds || acceptedAssetIds.includes(String(option.assetId)))
    .filter((option) => !acceptedCategories.length || acceptedCategories.includes(String(option.category || "").toLowerCase()))
    .filter((option) => !allowedMedia.length || allowedMedia.includes(option.mediaType) || allowedMedia.includes(option.previewType))
    .map((option) => {
      let matchScore = 0;
      if (needle) {
        if (option.handleKey === needle) matchScore = 140;
        else if (option.handleKey.startsWith(needle)) matchScore = 120;
        else if (option.aliases?.some((alias) => alias === needle)) matchScore = 110;
        else if (option.aliases?.some((alias) => alias.startsWith(needle))) matchScore = 95;
        else if (normalizeMentionKey(option.name).includes(needle)) matchScore = 80;
        else if (normalizeMentionKey(option.variant).includes(needle)) matchScore = 65;
        else if (normalizeMentionKey(option.assetId).includes(needle)) matchScore = 55;
        else return null;
      }
      const mediaIndex = mediaPriority.indexOf(option.mediaType);
      const mediaScore = mediaIndex < 0 ? 0 : (mediaPriority.length - mediaIndex) * 8;
      const contextualScore = (mode === "voice-design" || mode === "dialogue") && option.category === "voice" ? 28
        : mode === "video" && ["character", "location", "wardrobe", "artifact", "atmosphere"].includes(option.category) ? 18
          : mode === "audio" && ["voice", "sound", "music"].includes(option.category) ? 18
            : 0;
      return { option, score: matchScore + mediaScore + contextualScore + (option.available ? 8 : 0) + (option.approved ? 5 : 0) };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || comparePriority(left.option.asset, right.option.asset))
    .slice(0, Math.max(1, Number(limit) || 12))
    .map((entry) => entry.option);
}

export function filterSpeakerReferenceOptions(options = [], workflow = null, outputMode = "dialogue") {
  const policy = getWorkflowComposerContract(workflow, outputMode).speakerReference;
  if (!policy) return [];
  return asArray(options).filter((option) => {
    if (!option?.available) return false;
    if (policy.requireApproved && option.approved !== true) return false;
    if (policy.restrictToAcceptedAssetIds && !policy.acceptedAssetIds.includes(String(option.assetId))) return false;
    if (policy.acceptedMediaTypes.length && !policy.acceptedMediaTypes.includes(String(option.mediaType || option.previewType || "").toLowerCase())) return false;
    if (policy.acceptedCategories.length && !policy.acceptedCategories.includes(String(option.category || "").toLowerCase())) return false;
    if (policy.acceptedRoles.length && !policy.acceptedRoles.includes(String(option.role || ""))) return false;
    return true;
  });
}

function composerInputValue(input, key) {
  if (hasOwn(input?.options, key)) return input.options[key];
  if (key === "aspectRatio" && hasOwn(input, "aspectRatio")) return input.aspectRatio;
  if (key === "durationSec" && hasOwn(input, "durationSec")) return input.durationSec;
  return undefined;
}

function hasComposerInputValue(input, key) {
  if (hasOwn(input?.options, key)) return true;
  if (key === "aspectRatio") return hasOwn(input, "aspectRatio");
  if (key === "durationSec") return hasOwn(input, "durationSec");
  return false;
}

function exactReferencePayload(pin, order) {
  return {
    token: pin.token,
    assetId: pin.assetId,
    assetVersion: Number(pin.assetVersion),
    role: pin.role,
    mediaType: pin.mediaType,
    file: pin.file || null,
    approved: pin.approved === true,
    ...(Number.isFinite(Number(order)) ? { order: Number(order) } : {})
  };
}

export function validateAssetPrompt(input = {}) {
  const mode = normalizeOutputMode(input.outputMode);
  const mentionOptions = input.mentionOptions || buildAssetMentionOptions(input.assets || []);
  const pins = reconcileMentionPins(input.prompt, input.pins, mentionOptions);
  const tokens = parseMentionTokens(input.prompt);
  const errors = [];
  const fieldErrors = {};
  const unresolved = [];
  const ambiguous = [];
  const addError = (message, field = "form") => {
    errors.push(message);
    if (!fieldErrors[field]) fieldErrors[field] = [];
    fieldErrors[field].push(message);
  };

  const workflow = asArray(input.workflows).find((item) => String(item?.id) === String(input.workflowId || "")) || null;
  const contract = getWorkflowComposerContract(workflow, mode?.id || input.outputMode);
  const promptText = String(input.prompt || "").trim();
  if (contract.primaryPrompt.required && !promptText) addError(`Enter ${contract.primaryPrompt.label.toLowerCase()}.`, "prompt");
  if (Number.isFinite(contract.primaryPrompt.maxLength) && promptText.length > contract.primaryPrompt.maxLength) addError(`${contract.primaryPrompt.label} cannot exceed ${contract.primaryPrompt.maxLength} characters.`, "prompt");
  if (!mode) addError("Choose a valid output mode.", "outputMode");

  for (const token of tokens) {
    const resolution = resolveMentionToken(token.raw, mentionOptions);
    if (!token.complete || resolution.status === "unresolved") unresolved.push(token.raw);
    if (resolution.status === "ambiguous") ambiguous.push({ token: token.raw, candidates: resolution.candidates });
    if (resolution.status === "resolved" && !resolution.option.available) {
      addError(`${token.raw} has no active generated file to pin.`, "references");
    }
  }
  if (unresolved.length) addError(`Resolve ${unique(unresolved).join(", ")} before generating.`, "references");
  if (ambiguous.length) addError(`Disambiguate ${unique(ambiguous.map((item) => item.token)).join(", ")} with a category-specific handle.`, "references");
  for (const pin of pins) {
    if (!pin.assetId || !Number(pin.assetVersion)) addError(`${pin.token || pin.handle || "A reference"} is not pinned to an exact asset version.`, "references");
    if (input.requireApprovedReferences === true && pin.approved !== true) addError(`${pin.token || pin.handle || "A reference"} v${pin.assetVersion || "?"} must be approved before generation.`, "references");
  }

  if (!input.workflowId) addError("Select a generation workflow.", "workflowId");
  else if (!workflow) addError("The selected generation workflow is no longer available.", "workflowId");
  else if (mode && !workflowCompatibleWithMode(workflow, mode.id)) addError(`${workflow.label || workflow.id} is not compatible with ${mode.label}.`, "workflowId");
  else if (!workflowIsReady(workflow)) {
    const reason = workflow?.ready !== true
      ? workflow?.reason
      : workflow?.runtimeWarning || workflow?.reason;
    addError(String(reason || `${workflow.label || workflow.id} has not passed a current readiness check.`), "workflowId");
  }

  const referencePolicy = workflow?.referencePolicy && typeof workflow.referencePolicy === "object" ? workflow.referencePolicy : null;
  if (referencePolicy) {
    const minimum = Number(referencePolicy.minimum || 0);
    const maximum = Number.isFinite(Number(referencePolicy.maximum)) ? Number(referencePolicy.maximum) : Infinity;
    const acceptedRoles = asArray(referencePolicy.acceptedRoles).map((value) => String(value));
    const acceptedMedia = asArray(referencePolicy.acceptedMediaTypes).map((value) => String(value));
    const acceptedCategories = asArray(referencePolicy.acceptedCategories).map((value) => String(value).toLowerCase());
    const acceptedAssetIds = unique(asArray(referencePolicy.acceptedAssetIds).map(String));
    const restrictToAcceptedAssetIds = hasOwn(referencePolicy, "acceptedAssetIds");
    const submittedSpeaker = Array.isArray(input.speakerReference) && input.speakerReference.length === 1
      ? input.speakerReference[0]
      : !Array.isArray(input.speakerReference) ? input.speakerReference : null;
    const policyPins = submittedSpeaker?.assetId && !pins.some((pin) => String(pin.assetId) === String(submittedSpeaker.assetId))
      ? [...pins, { ...submittedSpeaker, role: submittedSpeaker.role || "voice", mediaType: submittedSpeaker.mediaType || "audio" }]
      : pins;
    if (policyPins.length < minimum && !contract.speakerReference) addError(`${workflow.label || workflow.id} requires at least ${minimum} Asset Library reference${minimum === 1 ? "" : "s"}.`, "references");
    if (policyPins.length > maximum) addError(`${workflow.label || workflow.id} accepts at most ${maximum} Asset Library reference${maximum === 1 ? "" : "s"}.`, "references");
    for (const pin of policyPins) {
      if (restrictToAcceptedAssetIds && !acceptedAssetIds.includes(String(pin.assetId))) addError(`${pin.token || pin.handle} is not an eligible asset for this workflow.`, "references");
      if (acceptedCategories.length && !acceptedCategories.includes(String(pin.category || "").toLowerCase())) addError(`${pin.token || pin.handle} is not in an accepted asset category for this workflow.`, "references");
      if (acceptedRoles.length && !acceptedRoles.includes(String(pin.role))) addError(`${pin.token || pin.handle} cannot use the ${pin.role} role with this workflow.`, "references");
      if (acceptedMedia.length && !acceptedMedia.includes(String(pin.mediaType))) addError(`${pin.token || pin.handle} is ${pin.mediaType || "an unsupported media type"}; this workflow accepts ${acceptedMedia.join(" or ")} references.`, "references");
    }
  }

  const normalizedOptions = {};
  for (const field of contract.fields) {
    let rawValue = composerInputValue(input, field.key);
    let missing = rawValue == null || (typeof rawValue === "string" && !rawValue.trim());
    if (missing && !hasComposerInputValue(input, field.key) && field.default !== undefined && field.default !== null) {
      rawValue = field.default;
      missing = false;
    }
    if (field.required && missing) {
      addError(`Enter ${field.label.toLowerCase()}.`, field.key);
      continue;
    }
    if (missing) continue;
    let value = rawValue;
    if (field.type === "number" || field.type === "integer") {
      value = Number(rawValue);
      if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
        addError(`${field.label} must be ${field.type === "integer" ? "a whole number" : "a number"}.`, field.key);
        continue;
      }
      if (field.key === "durationSec" && value <= 0) addError(`Enter a positive duration for ${mode?.label || "this workflow"}.`, field.key);
      else if (field.key === "durationSec" && value > 3600) addError("Duration cannot exceed 3600 seconds.", field.key);
      else {
        if (Number.isFinite(field.min) && value < field.min) addError(field.key === "durationSec"
          ? `${workflow?.label || mode?.label || "This workflow"} requires at least ${field.min} second${field.min === 1 ? "" : "s"}.`
          : `${workflow?.label || mode?.label || "This workflow"} requires ${field.label.toLowerCase()} of at least ${field.min}.`, field.key);
        if (Number.isFinite(field.max) && value > field.max) addError(field.key === "durationSec"
          ? `${workflow?.label || mode?.label || "This workflow"} allows at most ${field.max} second${field.max === 1 ? "" : "s"}.`
          : `${workflow?.label || mode?.label || "This workflow"} allows ${field.label.toLowerCase()} of at most ${field.max}.`, field.key);
        if (Number.isFinite(field.step) && field.step > 0) {
          const base = Number.isFinite(field.min) ? field.min : 0;
          const steps = (value - base) / field.step;
          if (Math.abs(steps - Math.round(steps)) > 1e-7) addError(`${field.label} must use increments of ${field.step}.`, field.key);
        }
      }
    } else if (typeof value === "string") {
      value = value.trim();
      if (Number.isFinite(field.maxLength) && value.length > field.maxLength) addError(`${field.label} cannot exceed ${field.maxLength} characters.`, field.key);
    }
    if (field.enum.length) {
      const matchingValue = field.enum.find((candidate) => String(candidate) === String(value));
      if (matchingValue === undefined) addError(`${field.label} must be one of ${field.enum.join(", ")}.`, field.key);
      else value = matchingValue;
    }
    normalizedOptions[field.key] = value;
  }

  const optionProperties = workflow?.optionSchema?.properties && typeof workflow.optionSchema.properties === "object"
    ? workflow.optionSchema.properties
    : {};
  for (const key of Object.keys(optionProperties)) {
    if (hasOwn(normalizedOptions, key) || !hasOwn(input?.options, key)) continue;
    const value = input.options[key];
    if (value !== undefined) normalizedOptions[key] = value;
  }
  if (promptText && contract.primaryPrompt.key && !["prompt", "promptText"].includes(contract.primaryPrompt.key)) {
    normalizedOptions[contract.primaryPrompt.key] = promptText;
  }

  let speakerReference = null;
  const speakerPolicy = contract.speakerReference;
  if (speakerPolicy) {
    const eligibleOptions = filterSpeakerReferenceOptions(mentionOptions, workflow, mode?.id || input.outputMode);
    const eligibleIds = new Set(eligibleOptions.map((option) => String(option.assetId)));
    const explicitSpeaker = Array.isArray(input.speakerReference) ? null : input.speakerReference;
    if (Array.isArray(input.speakerReference) && input.speakerReference.length !== 1) {
      addError("Choose exactly one speaker voice.", "speakerReference");
    }
    const eligiblePinnedSpeakers = pins.filter((pin) => eligibleIds.has(String(pin.assetId)));
    const candidate = explicitSpeaker?.assetId
      ? explicitSpeaker
      : eligiblePinnedSpeakers.length === 1 ? eligiblePinnedSpeakers[0] : null;
    if (!candidate && speakerPolicy.required) {
      addError(eligibleOptions.length
        ? "Choose one approved speaker voice. Character mentions are not voice assignments."
        : "No approved voice asset is eligible for this workflow.", "speakerReference");
    } else if (candidate) {
      const option = mentionOptions.find((item) => String(item.assetId) === String(candidate.assetId));
      if (!option || !eligibleIds.has(String(candidate.assetId))) {
        addError("The selected speaker voice is unavailable, unapproved, or not eligible for this workflow.", "speakerReference");
      } else if (Number(candidate.assetVersion || option.activeVersion) !== Number(option.activeVersion) || (candidate.file && candidate.file !== option.activeFile)) {
        addError(`${option.handle} is not pinned to its current exact asset version.`, "speakerReference");
      } else {
        speakerReference = { ...createAssetPin(option, candidate.token || option.handle), role: "voice" };
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: unique(errors),
    fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([key, values]) => [key, unique(values)])),
    unresolved: unique(unresolved),
    ambiguous,
    tokens,
    pins,
    workflow,
    outputMode: mode,
    composerContract: contract,
    options: normalizedOptions,
    speakerReference
  };
}

export function buildAssetPromptPayload(input = {}) {
  const validation = validateAssetPrompt(input);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(" "));
    error.validation = validation;
    throw error;
  }
  const settings = {};
  if (hasOwn(validation.options, "aspectRatio")) settings.aspectRatio = String(validation.options.aspectRatio).trim();
  if (hasOwn(validation.options, "durationSec")) settings.durationSec = Number(validation.options.durationSec);
  return {
    schema: "premiere316.asset-prompt.v1",
    outputMode: validation.outputMode.id,
    outputLabel: validation.outputMode.label,
    workflowId: validation.workflow.id,
    prompt: String(input.prompt).trim(),
    references: validation.pins.map((pin, order) => exactReferencePayload(pin, order + 1)),
    options: validation.options,
    ...(validation.speakerReference ? { speakerReference: exactReferencePayload(validation.speakerReference) } : {}),
    settings
  };
}
