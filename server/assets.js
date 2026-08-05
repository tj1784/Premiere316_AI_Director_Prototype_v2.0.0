import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  collectOutputFiles,
  downloadOutput,
  getObjectInfo,
  runPrompt
} from "./comfy.js";
import { loadProject, mediaDir, registerFrame, saveProject } from "./projects.js";
import { projectDir } from "./paths.js";
import {
  STYLE_FLUX_CLIP,
  STYLE_FLUX_MODEL,
  STYLE_FLUX_VAE,
  STYLE_LOCK_WORKFLOWS,
  STYLE_UPSCALER,
  applyStyleLockToAsset,
  compileStyleLockWorkflow,
  isAuthoritativeStyleLockAsset,
  isStyleLockWorkflow,
  styleLockWorkflowIdForAsset
} from "./style-lock.js";

const KREA_MODEL = "krea2\\krea2_turbo_fp8_scaled.safetensors";
const KREA_CLIP = "qwen3vl_4b_fp8_scaled.safetensors";
const KREA_VAE = "qwen_image_vae.safetensors";
const FLUX_MODEL = "flux2\\flux-2-klein-9b-fp8mixed.safetensors";
const FLUX_CLIP = "qwen_3_8b_fp8mixed.safetensors";
const FLUX_VAE = "flux2-vae.safetensors";
const ACE_MODEL = "acestep\\acestep_v1.5_xl_turbo_bf16.safetensors";
const ACE_CLIP_SMALL = "qwen_0.6b_ace15.safetensors";
const ACE_CLIP_LARGE = "qwen_4b_ace15.safetensors";
const ACE_VAE = "ace_1.5_vae.safetensors";

export const ASSET_WORKFLOWS = [
  ...STYLE_LOCK_WORKFLOWS,
  {
    id: "krea2-character-ingredients-fp8",
    label: "Krea 2 Character Ingredients · FP8",
    mediaType: "image",
    model: "Krea 2 Turbo FP8 + Qwen3-VL 4B FP8",
    purpose: "Identity-locked character reference sheets with face, profile, full-body, costume, hair, and rear-head coverage.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [KREA_MODEL, KREA_CLIP, KREA_VAE]
  },
  {
    id: "krea2-cinematic-still-fp8",
    label: "Krea 2 Cinematic Still · FP8",
    mediaType: "image",
    model: "Krea 2 Turbo FP8 + Qwen3-VL 4B FP8",
    purpose: "Locations, props, VFX references, continuity states, and first/middle/last guide images.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [KREA_MODEL, KREA_CLIP, KREA_VAE]
  },
  {
    id: "flux2-klein-9b-prop-fp8",
    label: "Flux 2 Klein 9B · Prop Studio",
    mediaType: "image",
    model: "Flux 2 Klein 9B FP8 Distilled + Qwen 3 8B FP8",
    purpose: "Clean artifact, weapon, prop, and material reference plates with precise construction details.",
    requiredNodes: ["UNETLoader", "CLIPLoader", "CLIPTextEncode", "EmptyFlux2LatentImage", "KSampler", "VAEDecode", "SaveImage"],
    requiredModels: [FLUX_MODEL, FLUX_CLIP, FLUX_VAE]
  },
  {
    id: "qwen3-tts-voice-design-1.7b",
    label: "Qwen3-TTS VoiceDesign · 1.7B",
    mediaType: "audio",
    model: "Qwen3-TTS 12Hz 1.7B VoiceDesign",
    purpose: "Local character voice auditions and dialogue stems from production voice direction.",
    requiredNodes: ["FB_Qwen3TTSVoiceDesign", "SaveAudioMP3"],
    requiredModels: ["Qwen3-TTS-12Hz-1.7B-VoiceDesign"]
  },
  {
    id: "ace-step-1.5-xl-turbo",
    label: "ACE-Step 1.5 XL Turbo",
    mediaType: "audio",
    model: "ACE-Step 1.5 XL Turbo BF16 + Qwen 4B/0.6B",
    purpose: "Project score themes and musical cue stems.",
    requiredNodes: ["DualCLIPLoader", "TextEncodeAceStepAudio1.5", "EmptyAceStep1.5LatentAudio", "VAEDecodeAudio", "SaveAudioMP3"],
    requiredModels: [ACE_MODEL, ACE_CLIP_SMALL, ACE_CLIP_LARGE, ACE_VAE]
  },
  {
    id: "ltx-2.3-native-audio",
    label: "LTX 2.3 Native Shot Audio",
    mediaType: "instruction",
    model: "LTX-2.3 Director FP8",
    purpose: "Diegetic ambience, foley, impacts, and vocal texture generated in sync with the final video shot.",
    requiredNodes: [],
    requiredModels: []
  },
  {
    id: "premiere316-title-card",
    label: "Premiere316 Deterministic Title Card",
    mediaType: "graphic",
    model: "Deterministic SVG compositor",
    purpose: "Exact typography without diffusion-model spelling artifacts.",
    requiredNodes: [],
    requiredModels: []
  }
];

const CATEGORY_LABELS = {
  character: "Characters",
  location: "Locations",
  artifact: "Props & Artifacts",
  atmosphere: "Atmosphere & VFX",
  "guide-frame": "Guide Frames",
  wardrobe: "Wardrobe",
  extra: "Crowds & Creatures",
  voice: "Voices",
  sound: "Sound Design",
  music: "Music",
  graphic: "Graphics"
};

function promptHeaderSubject(asset) {
  const id = String(asset?.id || "");
  const rawName = String(asset?.name || asset?.id || "Production Asset")
    .replace(/\s+/g, " ")
    .trim();

  // The screenplay's internal role label is "JESUS - The Harrower", but the
  // copyable production prompts should name the subject plainly and
  // consistently for every model/provider.
  if (/jesus-the-harrower/i.test(id) || /^jesus\s*-\s*the harrower$/i.test(rawName)) {
    return "JESUS CHRIST";
  }
  if (/^ward-jesus-/i.test(id)) {
    const garment = rawName.replace(/^jesus\s+/i, "").trim();
    return garment ? `JESUS CHRIST — ${garment}` : "JESUS CHRIST";
  }
  return rawName;
}

function promptHeaderSummary(asset) {
  const category = String(asset?.category || "asset").toLowerCase();
  const variant = String(asset?.variant || "Production Reference")
    .replace(/\s+/g, " ")
    .trim();

  if (category === "character") {
    if (/close[- ]?up/i.test(variant)) return `${variant}: facial identity, expression, and cinematic lighting reference`;
    if (/action|pose/i.test(variant)) return `${variant}: heroic body language, wardrobe, anatomy, and motion reference`;
    return `${variant}: four-view identity, anatomy, costume, and continuity reference`;
  }
  if (category === "location") return `${variant}: cinematic environment, scale, lighting, materials, and continuity`;
  if (category === "artifact") return `${variant}: hero prop design, construction, materials, scale, and continuity`;
  if (category === "wardrobe") return `${variant}: costume construction, materials, fit, damage, and continuity`;
  if (category === "atmosphere") return `${variant}: cinematic VFX, particles, light, transformation, and motion reference`;
  if (category === "guide-frame") return `${variant}: cinematic composition, story state, and shot-continuity guide`;
  if (category === "extra") return `${variant}: crowd or creature design, scale, variation, and continuity`;
  if (category === "voice") return `${variant}: performance, tone, pacing, diction, and vocal continuity`;
  if (category === "sound") return `${variant}: diegetic sound design, dynamics, spatial scale, and texture`;
  if (category === "music") return `${variant}: musical arc, orchestration, tempo, dynamics, and mix direction`;
  if (category === "graphic") return `${variant}: final title card with exact deterministic typography`;
  return `${variant}: production generation direction and continuity reference`;
}

export function assetPromptHeader(asset) {
  const subject = promptHeaderSubject(asset);
  const summary = promptHeaderSummary(asset);
  return `${subject} — ${summary}.`.replace(/\.{2,}$/, ".").toLocaleUpperCase("en-US");
}

export function withAssetPromptHeader(asset, prompt) {
  const nextHeader = assetPromptHeader(asset);
  const previousHeader = String(asset?.promptHeader || "").trim();
  let body = String(prompt || "").replace(/\r\n/g, "\n").trim();
  const firstBreak = body.indexOf("\n");
  const firstLine = (firstBreak >= 0 ? body.slice(0, firstBreak) : body).trim();

  // Idempotently replace a prior managed header instead of stacking another
  // one every time a manifest is refreshed or an enhanced prompt is applied.
  if (firstLine === nextHeader || (previousHeader && firstLine === previousHeader)) {
    body = firstBreak >= 0 ? body.slice(firstBreak + 1).trimStart() : "";
  }
  asset.promptHeader = nextHeader;
  return body ? `${nextHeader}\n\n${body}` : nextHeader;
}

function slugify(value) {
  return String(value || "asset")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "asset";
}

function cleanHeading(value) {
  return String(value || "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+ASSETS?$/i, "")
    .trim();
}

function categoryOf(heading) {
  const text = cleanHeading(heading).toLowerCase();
  if (text.includes("character")) return "character";
  if (text.includes("location")) return "location";
  if (text.includes("artifact") || text.includes("prop")) return "artifact";
  if (text.includes("atmospher") || text.includes("vfx")) return "atmosphere";
  if (text.includes("first") || text.includes("last") || text.includes("frame")) return "guide-frame";
  return "atmosphere";
}

function assetId(category, name, variant = "primary") {
  return `${category}-${slugify(name)}-${slugify(variant)}`;
}

function visualWorkflow(category, variant, name = "", id = "") {
  const styleLockId = styleLockWorkflowIdForAsset({ category, variant, name, id, mediaType: "image" });
  if (styleLockId) return styleLockId;
  if (category === "artifact") return "flux2-klein-9b-prop-fp8";
  if (["character", "wardrobe"].includes(category) && /appearance|primary|identity|reference/i.test(variant)) {
    return "krea2-character-ingredients-fp8";
  }
  return "krea2-cinematic-still-fp8";
}

function productionGuardrails(category, variant) {
  const common = "Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.";
  if (category === "character" && /appearance|primary|identity/i.test(variant)) {
    return `Create a four-view cinematic character ingredients sheet showing the same person in frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume construction, body proportions, hands, scars, wounds, and carried props across every panel. One face exists only on the front of the head. ${common}`;
  }
  return common;
}

function explicitVisualAssets(markdown) {
  const start = markdown.search(/^#\s+ASSET GENERATION PROMPTS\s*$/mi);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const end = tail.search(/^#\s+LOCATION DESIGN SPECIFICATIONS\s*$/mi);
  const section = end >= 0 ? tail.slice(0, end) : tail;
  const lines = section.split(/\r?\n/);
  const records = [];
  let categoryHeading = "Atmospheric Assets";
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n");
    const promptRe = /\*\*([^*\n]*Prompt[^*\n]*):\*\*\s*```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi;
    let match;
    let found = 0;
    while ((match = promptRe.exec(body))) {
      found += 1;
      const category = categoryOf(current.categoryHeading);
      const variant = match[1].replace(/\s*Prompt\s*$/i, "").trim() || `Variation ${found}`;
      const sourcePrompt = match[2].replace(/\s+/g, " ").trim();
      records.push({
        id: assetId(category, current.name, variant),
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name: current.name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\n${sourcePrompt}`,
        sourcePrompt,
        sourceSection: "Asset Generation Prompts",
        status: "planned",
        reviewState: "explicit-prompt",
        workflowId: visualWorkflow(category, variant, current.name, assetId(category, current.name, variant)),
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    }
    current = null;
  };

  for (const line of lines) {
    const level2 = line.match(/^##\s+(.+)$/);
    if (level2) {
      flush();
      categoryHeading = level2[1];
      continue;
    }
    const level3 = line.match(/^###\s+(.+)$/);
    if (level3) {
      flush();
      current = { name: level3[1].trim(), categoryHeading, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();
  return records;
}

function stableHeading(value) {
  const text = String(value || "").trim();
  const match = text.match(/^((?:CHAR|LOC|PROP|COST|ATM)-\d+)\s*:\s*(.+)$/i);
  return match
    ? { sourceAssetId: match[1].toLowerCase(), name: match[2].trim() }
    : { sourceAssetId: "", name: text };
}

function firstFencedPrompt(body) {
  return String(body || "")
    .match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim() || "";
}

// Some production packages use one top-level heading per asset family instead
// of the older monolithic "ASSET GENERATION PROMPTS" section. Keep this
// parser deterministic so an approved screenplay can become a manifest without
// another language-model pass.
function sectionedVisualAssets(markdown) {
  const sectionMap = [
    [/^CHARACTER ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "character"],
    [/^LOCATION ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "location"],
    [/^ARTIFACT ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "artifact"],
    [/^ATMOSPHERIC ASSETS\s*-\s*AI GENERATION PROMPTS$/i, "atmosphere"],
    [/^FIRST AND LAST FRAME SCENE IMAGES$/i, "guide-frame"]
  ];
  const headings = [...String(markdown || "").matchAll(/^#\s+(.+)$/gm)];
  const records = [];

  for (let index = 0; index < headings.length; index += 1) {
    const category = sectionMap.find(([pattern]) => pattern.test(headings[index][1].trim()))?.[1];
    if (!category) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const lines = markdown.slice(start, end).split(/\r?\n/);
    let currentAsset = null;
    let currentVariant = null;

    const flush = () => {
      if (!currentAsset || !currentVariant) return;
      const sourcePrompt = firstFencedPrompt(currentVariant.body.join("\n"));
      if (!sourcePrompt) return;
      const parsed = stableHeading(currentAsset);
      const rawVariant = currentVariant.name.replace(/\s*Prompt\s*$/i, "").trim();
      const variant = rawVariant || (category === "guide-frame"
        ? (/^FIRST FRAME/i.test(parsed.name) ? "Opening Guide Frame" : "Closing Guide Frame")
        : "Production Reference");
      const id = parsed.sourceAssetId
        ? `${parsed.sourceAssetId}-${slugify(variant)}`
        : assetId(category, parsed.name, variant);
      records.push({
        id,
        sourceAssetId: parsed.sourceAssetId,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name: parsed.name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\n${sourcePrompt}`,
        sourcePrompt,
        sourceSection: headings[index][1].trim(),
        status: "planned",
        reviewState: "explicit-prompt",
        workflowId: visualWorkflow(category, variant, parsed.name, id),
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    };

    for (const line of lines) {
      const level2 = line.match(/^##\s+(.+)$/);
      if (level2) {
        flush();
        currentAsset = level2[1].trim();
        currentVariant = null;
        continue;
      }
      const level3 = line.match(/^###\s+(.+)$/);
      if (level3) {
        flush();
        currentVariant = { name: level3[1].trim(), body: [] };
        continue;
      }
      if (currentVariant) currentVariant.body.push(line);
    }
    flush();
  }
  return records;
}

function stableIdAssets(markdown, items) {
  const sections = [
    ["CHARACTER STABLE IDS", "CHAR", "character", "Identity Ingredients"],
    ["LOCATION STABLE IDS", "LOC", "location", "Production Reference"],
    ["COSTUME STABLE IDS", "COST", "wardrobe", "Identity Ingredients"],
    ["PROP STABLE IDS", "PROP", "artifact", "Production Reference"]
  ];
  const additions = [];
  for (const [heading, prefix, category, variant] of sections) {
    const startMatch = new RegExp(`^##\\s+${heading}\\s*$`, "mi").exec(markdown);
    if (!startMatch) continue;
    const start = startMatch.index + startMatch[0].length;
    const tail = markdown.slice(start);
    const next = tail.search(/^#{1,2}\s+/m);
    const section = next >= 0 ? tail.slice(0, next) : tail;
    const blockPattern = new RegExp(`^(${prefix}-\\d+):\\s*(.+)\\r?\\n([\\s\\S]*?)(?=^${prefix}-\\d+:|(?![\\s\\S]))`, "gmi");
    let match;
    while ((match = blockPattern.exec(section))) {
      const sourceAssetId = match[1].toLowerCase();
      const name = match[2].trim();
      const continuity = match[3].split(/\r?\n/)
        .map((line) => line.replace(/^\s*[├└]──\s*/, "").trim())
        .filter((line) => Boolean(line) && !/^(?:```|---|═+)$/.test(line));
      const existing = items.filter((item) => item.sourceAssetId === sourceAssetId);
      if (existing.length) {
        for (const item of existing) item.continuity = [...new Set([...(item.continuity || []), ...continuity])];
        continue;
      }
      const detail = continuity.join(". ");
      additions.push({
        id: sourceAssetId,
        sourceAssetId,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\nCinematic biblical epic production reference for ${name}. ${detail}`,
        sourcePrompt: detail,
        sourceSection: heading,
        status: "planned",
        reviewState: "continuity-bible",
        workflowId: visualWorkflow(category, variant, name, sourceAssetId),
        dependencies: [],
        continuity,
        versions: [],
        activeVersion: 0
      });
    }
  }
  return additions;
}

function directAudioCueAssets(markdown) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "the production";
  const start = markdown.search(/^##\s+Sound Design Elements\s*$/mi);
  if (start < 0) return [];
  const tail = markdown.slice(start);
  const end = tail.search(/^#(?!#)\s+/m);
  const section = end >= 0 ? tail.slice(0, end) : tail;
  const pieces = section.split(/^###\s+/m).slice(1);
  const items = [];
  for (const piece of pieces) {
    const newline = piece.indexOf("\n");
    const heading = (newline >= 0 ? piece.slice(0, newline) : piece).trim();
    const body = newline >= 0 ? piece.slice(newline + 1) : "";
    if (/environmental sounds/i.test(heading) || /action sound effects/i.test(heading)) {
      const variant = /environmental/i.test(heading) ? "Ambience" : "Foley / Impact";
      for (const match of body.matchAll(/^-\s+\*\*([^*]+):\*\*\s*(.+)$/gm)) {
        const name = match[1].trim();
        const direction = match[2].trim();
        items.push({
          id: assetId("sound", name, variant),
          category: "sound",
          categoryLabel: CATEGORY_LABELS.sound,
          name,
          variant,
          mediaType: "instruction",
          prompt: `Synchronized cinematic ${variant.toLowerCase()} for ${title}: ${direction}. Natural spatial perspective, physically plausible acoustics, no modern ambience, no narration, and no unrelated music.`,
          sourceSection: "Sound Design Elements",
          status: "planned",
          reviewState: "explicit-direction",
          workflowId: "ltx-2.3-native-audio",
          dependencies: [],
          versions: [],
          activeVersion: 0
        });
      }
    }
    if (/musical elements/i.test(heading)) {
      let index = 0;
      for (const match of body.matchAll(/^\*\*([^*]+):\*\*\s*(.+)$/gm)) {
        index += 1;
        const name = match[1].trim();
        const direction = match[2].trim();
        items.push({
          id: assetId("music", name, `cue-${index}`),
          category: "music",
          categoryLabel: CATEGORY_LABELS.music,
          name,
          variant: `Score Cue ${index}`,
          mediaType: "audio",
          prompt: `Instrumental cinematic biblical score for ${title}: ${direction}. Reverent ancient-world orchestration, organic dynamics, emotional restraint, no lyrics, no modern pop drums, and designed to join one unified score.`,
          durationSec: 60,
          bpm: /climax/i.test(name) ? 96 : /resolution/i.test(name) ? 64 : 76,
          sourceSection: "Musical Elements and Score Direction",
          status: "planned",
          reviewState: "explicit-direction",
          workflowId: "ace-step-1.5-xl-turbo",
          dependencies: [],
          versions: [],
          activeVersion: 0
        });
      }
    }
  }
  return items;
}

function applyContinuityDependencies(items) {
  const bySource = new Map();
  for (const item of items) {
    if (!item.sourceAssetId) continue;
    const group = bySource.get(item.sourceAssetId) || [];
    group.push(item);
    bySource.set(item.sourceAssetId, group);
  }
  const preferred = (sourceId) => {
    const group = bySource.get(sourceId) || [];
    return group.find((item) => /primary|identity|wide|production reference/i.test(item.variant)) || group[0];
  };
  const characterParts = {
    "char-01": ["cost-01", "prop-01", "prop-02", "prop-07"],
    "char-02": ["cost-02", "prop-03", "prop-04"],
    "char-03": ["cost-03", "prop-05", "prop-06"],
    "char-04": ["cost-04"],
    "char-05": ["cost-04"],
    "char-06": ["cost-04"],
    "char-07": ["cost-05"]
  };
  for (const [characterId, componentIds] of Object.entries(characterParts)) {
    const group = bySource.get(characterId) || [];
    const primary = preferred(characterId);
    const components = componentIds.map(preferred).filter(Boolean).map((item) => item.id);
    for (const item of group) {
      const dependencies = item === primary ? components : [primary?.id, ...components].filter(Boolean);
      item.dependencies = [...new Set([...(item.dependencies || []), ...dependencies])];
    }
  }
  for (const [sourceId, group] of bySource.entries()) {
    if (!sourceId.startsWith("loc-") || group.length < 2) continue;
    const primary = preferred(sourceId);
    for (const item of group) if (item !== primary) item.dependencies = [...new Set([...(item.dependencies || []), primary.id])];
  }
  for (const item of items.filter((entry) => entry.category === "guide-frame")) {
    const sourceIds = /^FIRST FRAME/i.test(item.name) ? ["loc-01", "atm-01"] : ["loc-05", "char-01", "atm-02"];
    item.dependencies = [...new Set([...(item.dependencies || []), ...sourceIds.map(preferred).filter(Boolean).map((entry) => entry.id)])];
  }
  for (const item of items.filter((entry) => entry.category === "voice")) {
    const sourceId = item.name.match(/(CHAR-\d+)/i)?.[1]?.toLowerCase();
    const character = sourceId ? preferred(sourceId) : null;
    if (character) item.dependencies = [...new Set([...(item.dependencies || []), character.id])];
  }
  return items;
}

function voiceAssets(markdown, breakdown) {
  const start = markdown.search(/^#\s+VOICE\s*&\s*AUDIO DIRECTION\s*$/mi);
  const end = start >= 0 ? markdown.slice(start).search(/^##\s+SOUND DESIGN ELEMENTS\s*$/mi) : -1;
  const section = start < 0 ? "" : markdown.slice(start, end >= 0 ? start + end : undefined);
  const pieces = section.split(/^###\s+/m).slice(1);
  const assets = [];
  for (const piece of pieces) {
    const newline = piece.indexOf("\n");
    const name = (newline >= 0 ? piece.slice(0, newline) : piece).trim();
    const body = newline >= 0 ? piece.slice(newline + 1) : "";
    const profile = body.match(/\*\*Voice Profile:\*\*([\s\S]*?)(?:\*\*Key Lines|---|$)/i)?.[1]
      ?.replace(/^\s*[-*]\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim() || "Cinematic performance with a distinct, repeatable vocal identity.";
    const samples = [...body.matchAll(/\*"([\s\S]*?)"\*/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
    assets.push({
      id: assetId("voice", name, "voice-design"),
      category: "voice",
      categoryLabel: CATEGORY_LABELS.voice,
      name,
      variant: "Voice Design",
      mediaType: "audio",
      prompt: profile,
      sampleText: samples[0] || "The light has come, and darkness cannot overcome it.",
      sourceSection: "Voice & Audio Direction",
      status: "planned",
      reviewState: "explicit-direction",
      workflowId: "qwen3-tts-voice-design-1.7b",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }

  const roleDefaults = {
    Eve: ["Ancient compassionate contralto, physically aged yet emotionally luminous, trembling relief becoming steady hope; restrained biblical drama, no caricature.", "He has come. The promise is fulfilled."],
    "Voice of Hell": ["Deep nonhuman resonant voice emerging from stone and cavern, layered but intelligible, immense age, terror beneath defiance; cinematic and restrained.", "You have no power here."],
    "Trapped Souls": ["A diverse ensemble of exhausted adult voices, whispered despair transforming into astonished hope; naturally layered crowd performance.", "The chains are breaking."],
    "Low Voice": ["Warm timeless male baritone, reverent ceremonial delivery, intimate at first and capable of orchestral-scale authority; no imitation of a named living performer.", "The King of Kings has come."],
    Chorus: ["Reverent mixed sacred chorus with warm low soloist, controlled vibrato, clear diction, gradual expansion from breath to triumphant ensemble.", "The King has conquered. Death is defeated."],
    Jesus: ["Mature compassionate Mediterranean baritone with calm authority and restrained divine resonance.", "I am the Living One."],
    Adam: ["Ancient weathered bass, broken by emotion and millennia of waiting, quiet and human.", "The Second Adam... you have come for us."],
    "Guardian Leader": ["Inhuman grinding bass like ancient stone, deliberate and threatening, with fear beginning beneath the command.", "No living thing passes here."]
  };
  for (const role of breakdown?.audio?.dialogue_roles || []) {
    if (assets.some((asset) => asset.name.toLowerCase().includes(String(role).toLowerCase()))) continue;
    const [prompt, sampleText] = roleDefaults[role] || [`Distinct cinematic voice design for ${role}; stable timbre, clear diction, emotionally restrained live-action performance.`, "The hour has come."];
    assets.push({
      id: assetId("voice", role, "voice-design"),
      category: "voice",
      categoryLabel: CATEGORY_LABELS.voice,
      name: role,
      variant: "Voice Design",
      mediaType: "audio",
      prompt,
      sampleText,
      sourceSection: "Screenplay review",
      status: "planned",
      reviewState: "direction-supplemented",
      workflowId: "qwen3-tts-voice-design-1.7b",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }
  return assets;
}

function normalizedName(name) {
  return slugify(String(name || "").split(/\s+-\s+/)[0]);
}

function normalizedReviewId(value) {
  return String(value || "").trim().toLowerCase();
}

function addReviewAssets(items, breakdown) {
  if (!breakdown) return;
  const groups = [
    ["characters", "character"],
    ["locations", "location"],
    ["props_and_artifacts", "artifact"],
    ["wardrobe", "wardrobe"],
    ["creatures_extras_and_crowds", "extra"],
    ["vfx_and_state_assets", "atmosphere"]
  ];
  for (const [key, category] of groups) {
    for (const spec of breakdown[key] || []) {
      // Typography is generated by the deterministic compositor below, never by Krea.
      if (String(spec.asset_id || "").toUpperCase() === "GFX-TITLE-CARD") continue;
      const name = spec.name || spec.asset_id || "Production asset";
      const needle = normalizedName(name);
      const existing = items.find((asset) => asset.category === category && normalizedName(asset.name) === needle);
      const dependencies = [...(spec.prop_ids || []), ...(spec.wardrobe_ids || [])].map(normalizedReviewId);
      const continuity = [
        ...(spec.continuity_requirements || spec.continuity || spec.states || []),
        ...(spec.required_additions || []),
        ...(spec.conflict ? [spec.conflict] : [])
      ];
      if (existing) {
        existing.sourceAssetId = normalizedReviewId(spec.asset_id) || existing.sourceAssetId;
        existing.dependencies = [...new Set([...(existing.dependencies || []), ...dependencies])];
        existing.continuity = [...new Set([...(existing.continuity || []), ...continuity])];
        existing.reviewDetails = spec;
        existing.reviewState = String(spec.status || spec.visual_prompt_status || existing.reviewState || "review-merged");
        continue;
      }
      const detail = Object.entries(spec)
        .filter(([field]) => !["asset_id", "name"].includes(field))
        .map(([field, value]) => `${field.replace(/_/g, " ")}: ${Array.isArray(value) ? value.join("; ") : String(value)}`)
        .join(". ");
      const variant = category === "character" ? "Identity Ingredients" : "Production Reference";
      items.push({
        id: String(spec.asset_id || assetId(category, name, variant)).toLowerCase(),
        sourceAssetId: normalizedReviewId(spec.asset_id),
        category,
        categoryLabel: CATEGORY_LABELS[category],
        name,
        variant,
        mediaType: "image",
        prompt: `${productionGuardrails(category, variant)}\n\nCinematic biblical epic production asset for ${name}. ${detail}`,
        sourcePrompt: "",
        sourceSection: "Structured screenplay review",
        status: "planned",
        reviewState: String(spec.status || spec.visual_prompt_status || "review-added"),
        workflowId: visualWorkflow(category, variant, name, String(spec.asset_id || "").toLowerCase()),
        dependencies,
        continuity,
        reviewDetails: spec,
        versions: [],
        activeVersion: 0
      });
    }
  }
}

function resolveAssetDependencies(items) {
  const aliases = new Map();
  for (const item of items) {
    aliases.set(normalizedReviewId(item.id), item.id);
    if (item.sourceAssetId) aliases.set(normalizedReviewId(item.sourceAssetId), item.id);
  }
  for (const item of items) {
    item.dependencies = [...new Set((item.dependencies || []).map((dependency) => aliases.get(normalizedReviewId(dependency)) || normalizedReviewId(dependency)).filter(Boolean))];
  }
  return items;
}

function audioCueAssets(breakdown) {
  const items = [];
  const soundGroups = [
    ["environmental_stems", "Ambience"],
    ["action_stems", "Foley / Impact"]
  ];
  for (const [key, variant] of soundGroups) {
    for (const cue of breakdown?.audio?.[key] || []) {
      items.push({
        id: assetId("sound", cue, variant),
        category: "sound",
        categoryLabel: CATEGORY_LABELS.sound,
        name: cue,
        variant,
        mediaType: "instruction",
        prompt: `Synchronized cinematic ${variant.toLowerCase()} for the Harrowing of Hell: ${cue}. Natural spatial perspective, physically plausible acoustics, no modern ambience, no narration, and no unrelated music.`,
        sourceSection: "Sound Design Elements",
        status: "planned",
        reviewState: "ltx-native-audio",
        workflowId: "ltx-2.3-native-audio",
        dependencies: [],
        versions: [],
        activeVersion: 0
      });
    }
  }
  for (const [index, cue] of (breakdown?.audio?.score_arc || []).entries()) {
    items.push({
      id: assetId("music", cue, `cue-${index + 1}`),
      category: "music",
      categoryLabel: CATEGORY_LABELS.music,
      name: `Score Cue ${index + 1}`,
      variant: cue,
      mediaType: "audio",
      prompt: `Instrumental cinematic biblical score cue: ${cue}. Reverent ancient-world orchestration, organic dynamics, emotional restraint, no lyrics, no modern pop drums, designed to join a unified ten-minute score.`,
      durationSec: 60,
      bpm: index === 2 ? 96 : index === 4 ? 64 : 76,
      sourceSection: "Musical Elements",
      status: "planned",
      reviewState: "explicit-direction",
      workflowId: "ace-step-1.5-xl-turbo",
      dependencies: [],
      versions: [],
      activeVersion: 0
    });
  }
  return items;
}

function titleAsset(markdown) {
  const sourceTitle = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled Project";
  const normalized = sourceTitle.replace(/HARRROWING/gi, "HARROWING");
  return {
    id: assetId("graphic", normalized, "title-card"),
    category: "graphic",
    categoryLabel: CATEGORY_LABELS.graphic,
    name: "Final Title Card",
    variant: normalized,
    mediaType: "graphic",
    prompt: normalized,
    sourceSection: "Final sequence",
    status: "planned",
    reviewState: sourceTitle === normalized ? "deterministic" : "spelling-normalized-for-output",
    workflowId: "premiere316-title-card",
    dependencies: [],
    versions: [],
    activeVersion: 0
  };
}

function preserveAssetState(next, previous) {
  const oldById = new Map((previous?.items || []).map((item) => [item.id, item]));
  return next.map((item) => {
    const old = oldById.get(item.id);
    if (!old) return item;
    return {
      ...item,
      prompt: old.prompt ?? item.prompt,
      promptHeader: old.promptHeader ?? item.promptHeader,
      sampleText: old.sampleText ?? item.sampleText,
      status: old.status || item.status,
      seed: old.seed ?? item.seed,
      versions: Array.isArray(old.versions) ? old.versions : [],
      activeVersion: Number(old.activeVersion) || 0,
      approval: old.approval || null
    };
  });
}

export function buildAssetPackage(markdown, { productionBreakdown = null, previous = null } = {}) {
  const screenplayHash = crypto.createHash("sha256").update(String(markdown || "").trim()).digest("hex");
  const source = String(markdown || "");
  const items = [...explicitVisualAssets(source), ...sectionedVisualAssets(source)];
  items.push(...stableIdAssets(source, items));
  addReviewAssets(items, productionBreakdown);
  items.push(...voiceAssets(source, productionBreakdown));
  items.push(...audioCueAssets(productionBreakdown));
  items.push(...directAudioCueAssets(source));
  items.push(titleAsset(source));
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const deduped = resolveAssetDependencies(applyContinuityDependencies(unique));
  const sameRevision = previous?.screenplayHash === screenplayHash;
  const preserved = preserveAssetState(deduped, sameRevision ? previous : null);
  for (const item of preserved) {
    item.prompt = withAssetPromptHeader(item, item.prompt);
    applyStyleLockToAsset(item);
  }
  const counts = preserved.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    screenplayHash,
    counts,
    total: preserved.length,
    items: preserved,
    review: productionBreakdown ? {
      status: productionBreakdown.review_status,
      issues: productionBreakdown.missing_and_ambiguous_requirements || [],
      generationOrder: productionBreakdown.recommended_asset_generation_order || [],
      provisionalStoryBeats: productionBreakdown.provisional_story_beats || []
    } : null
  };
}

function enumValues(objectInfo, className, inputName) {
  const entry = objectInfo?.[className]?.input;
  const definition = entry?.required?.[inputName] || entry?.optional?.[inputName];
  if (Array.isArray(definition?.[0])) return definition[0];
  if (Array.isArray(definition?.[1]?.options)) return definition[1].options;
  return [];
}

function workflowReadiness(workflow, objectInfo) {
  if (["ltx-2.3-native-audio", "premiere316-title-card"].includes(workflow.id)) {
    return { ready: true, reason: "Built into Premiere316" };
  }
  const missingNodes = workflow.requiredNodes.filter((node) => !objectInfo?.[node]);
  if (missingNodes.length) return { ready: false, reason: `Missing nodes: ${missingNodes.join(", ")}` };
  if (isStyleLockWorkflow(workflow.id)) {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(STYLE_FLUX_MODEL) ? null : STYLE_FLUX_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(STYLE_FLUX_CLIP) ? null : STYLE_FLUX_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(STYLE_FLUX_VAE) ? null : STYLE_FLUX_VAE,
      enumValues(objectInfo, "UpscaleModelLoader", "model_name").includes(STYLE_UPSCALER) ? null : STYLE_UPSCALER
    ].filter(Boolean);
    return missing.length
      ? { ready: false, reason: `Style-Lock workflow found; local models missing: ${missing.join(", ")}` }
      : { ready: true, reason: "Style-Lock presets, references, and local FLUX.2 models installed" };
  }
  if (workflow.id.startsWith("krea2")) {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(KREA_MODEL) ? null : KREA_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(KREA_CLIP) ? null : KREA_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(KREA_VAE) ? null : KREA_VAE
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Missing models: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  if (workflow.id === "flux2-klein-9b-prop-fp8") {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(FLUX_MODEL) ? null : FLUX_MODEL,
      enumValues(objectInfo, "CLIPLoader", "clip_name").includes(FLUX_CLIP) ? null : FLUX_CLIP,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(FLUX_VAE) ? null : FLUX_VAE
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Missing models: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  if (workflow.id === "qwen3-tts-voice-design-1.7b") {
    const root = "C:\\ComfyUI\\ComfyUI_Shared_Folders\\models\\qwen-tts\\Qwen3-TTS-12Hz-1.7B-VoiceDesign";
    const configFile = path.join(root, "config.json");
    if (!fs.existsSync(path.join(root, "model.safetensors")) || !fs.existsSync(configFile)) {
      return { ready: false, reason: "Qwen3-TTS 1.7B VoiceDesign weights/config are not installed" };
    }
    try {
      const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
      return config?.model_type
        ? { ready: true, reason: "Installed locally with a recognized model_type" }
        : { ready: false, reason: "Qwen VoiceDesign is blocked: config.json has no model_type for the installed loader" };
    } catch {
      return { ready: false, reason: "Qwen VoiceDesign is blocked: config.json is invalid" };
    }
  }
  if (workflow.id === "ace-step-1.5-xl-turbo") {
    const missing = [
      enumValues(objectInfo, "UNETLoader", "unet_name").includes(ACE_MODEL) ? null : ACE_MODEL,
      enumValues(objectInfo, "DualCLIPLoader", "clip_name1").includes(ACE_CLIP_SMALL) ? null : ACE_CLIP_SMALL,
      enumValues(objectInfo, "DualCLIPLoader", "clip_name2").includes(ACE_CLIP_LARGE) ? null : ACE_CLIP_LARGE,
      enumValues(objectInfo, "VAELoader", "vae_name").includes(ACE_VAE) ? null : ACE_VAE
    ].filter(Boolean);
    return missing.length ? { ready: false, reason: `Workflow found; weights not installed: ${missing.join(", ")}` } : { ready: true, reason: "Installed locally" };
  }
  return { ready: false, reason: "Workflow is not configured" };
}

function gpuState() {
  try {
    const raw = execFileSync("nvidia-smi", ["--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"], { encoding: "utf-8", timeout: 3000 }).trim().split(/\r?\n/)[0];
    const [totalMb, usedMb, freeMb] = raw.split(",").map((value) => Number(value.trim()));
    let processes = "";
    try {
      processes = execFileSync("nvidia-smi", ["--query-compute-apps=process_name", "--format=csv,noheader"], { encoding: "utf-8", timeout: 3000 });
    } catch {}
    return {
      totalGb: Math.round((totalMb / 1024) * 10) / 10,
      usedGb: Math.round((usedMb / 1024) * 10) / 10,
      freeGb: Math.round((freeMb / 1024) * 10) / 10,
      lmStudioGpuResident: /llama-server\.exe/i.test(processes)
    };
  } catch {
    return { totalGb: null, usedGb: null, freeGb: null, lmStudioGpuResident: false };
  }
}

function vramFloor(workflowId) {
  if (isStyleLockWorkflow(workflowId)) return 22;
  if (workflowId.startsWith("krea2")) return 18;
  if (workflowId === "flux2-klein-9b-prop-fp8") return 19;
  if (workflowId === "qwen3-tts-voice-design-1.7b") return 5;
  if (workflowId === "ace-step-1.5-xl-turbo") return 20;
  return 0;
}

export async function getAssetWorkflowCatalog(force = false) {
  let objectInfo = {};
  try { objectInfo = await getObjectInfo(force); } catch {}
  const gpu = gpuState();
  return ASSET_WORKFLOWS.map((workflow) => {
    const installed = workflowReadiness(workflow, objectInfo);
    const minimumFreeVramGb = vramFloor(workflow.id);
    const handoffRequired = Boolean(
      installed.ready &&
      minimumFreeVramGb > 0 &&
      gpu.lmStudioGpuResident &&
      Number.isFinite(gpu.freeGb) &&
      gpu.freeGb < minimumFreeVramGb
    );
    return {
      ...workflow,
      ...installed,
      installed: installed.ready,
      availableNow: installed.ready && !handoffRequired,
      minimumFreeVramGb,
      gpu,
      runtimeWarning: handoffRequired
        ? `GPU handoff required: LM Studio is holding VRAM and only ${gpu.freeGb} GB is free. Unload the screenplay model, then recheck local models before generating this asset.`
        : null
    };
  });
}

function workflowFor(id) {
  const workflow = ASSET_WORKFLOWS.find((candidate) => candidate.id === id);
  if (!workflow) throw new Error(`Unknown asset workflow: ${id}`);
  return workflow;
}

function screenplayHash(project) {
  const markdown = String(project?.screenplay?.markdown || "").trim();
  return markdown ? crypto.createHash("sha256").update(markdown).digest("hex") : null;
}

export function assetGenerationFingerprint(asset) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: asset?.id || null,
    name: asset?.name || "",
    variant: asset?.variant || "",
    category: asset?.category || null,
    mediaType: asset?.mediaType || null,
    prompt: asset?.prompt || "",
    sampleText: asset?.sampleText || "",
    workflowId: asset?.workflowId || null,
    workflowHash: asset?.workflowHash || null,
    seed: asset?.seed ?? null,
    durationSec: asset?.durationSec ?? null,
    bpm: asset?.bpm ?? null
  })).digest("hex");
}

function activeAssetVersion(asset) {
  return (asset?.versions || []).find((version) => Number(version.v) === Number(asset?.activeVersion)) || null;
}

function normalizedFileHashes(version) {
  if (Array.isArray(version?.fileHashes)) {
    return version.fileHashes
      .map((entry) => ({
        file: String(entry?.file || ""),
        sha256: String(entry?.sha256 || "").toLowerCase(),
        bytes: Number(entry?.bytes) || 0,
        extension: String(entry?.extension || path.extname(String(entry?.file || ""))).toLowerCase()
      }))
      .filter((entry) => entry.file && entry.sha256)
      .sort((left, right) => left.file.localeCompare(right.file));
  }
  if (version?.fileHashes && typeof version.fileHashes === "object") {
    return Object.entries(version.fileHashes)
      .map(([file, sha256]) => ({ file, sha256: String(sha256 || "").toLowerCase(), bytes: 0, extension: path.extname(file).toLowerCase() }))
      .filter((entry) => entry.file && entry.sha256)
      .sort((left, right) => left.file.localeCompare(right.file));
  }
  return [];
}

function generatedFileHashes(project, files) {
  return [...new Set((files || []).map((file) => path.basename(String(file || ""))).filter(Boolean))]
    .map((file) => {
      const absolute = path.join(mediaDir(project, "assets"), file);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Generated asset file is missing: ${file}`);
      const buffer = fs.readFileSync(absolute);
      return {
        file,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        bytes: buffer.byteLength,
        extension: path.extname(file).toLowerCase()
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function assetVersionFingerprint(asset) {
  const active = activeAssetVersion(asset);
  if (!active) return null;
  return crypto.createHash("sha256").update(JSON.stringify({
    assetId: asset.id,
    version: Number(active.v),
    files: active.files || (active.file ? [active.file] : []),
    workflowId: active.workflowId || asset.workflowId || null,
    workflowHash: active.workflowHash || asset.workflowHash || null,
    model: active.model || null,
    prompt: active.prompt || "",
    seed: active.seed ?? null,
    createdAt: active.createdAt || null,
    generationFingerprint: active.assetFingerprint || null,
    fileHashes: normalizedFileHashes(active)
  })).digest("hex");
}

export function assetVersionFilesCurrent(project, asset) {
  const active = activeAssetVersion(asset);
  if (!active) return false;
  const expected = normalizedFileHashes(active);
  const names = active.files || (active.file ? [active.file] : []);
  if (!names.length || expected.length !== new Set(names.map((file) => path.basename(String(file)))).size) return false;
  try {
    const actual = generatedFileHashes(project, names);
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function assetHasCurrentGeneratedVersion(project, asset) {
  const active = activeAssetVersion(asset);
  const revision = screenplayHash(project);
  const generationFingerprint = assetGenerationFingerprint(asset);
  return Boolean(
    active &&
    revision &&
    active.assetFingerprint === generationFingerprint &&
    active.screenplayRevision === revision &&
    active.manifestScreenplayHash === project?.assets?.screenplayHash &&
    active.workflowId === asset.workflowId &&
    String(active.workflowHash || "") === String(asset.workflowHash || "") &&
    assetVersionFilesCurrent(project, asset)
  );
}

function restoredAssetStatus(project, asset) {
  if (!assetHasCurrentGeneratedVersion(project, asset)) return "planned";
  return asset.workflowId === "ltx-2.3-native-audio" ? "ready-for-shot" : "generated";
}

export function assetApprovalCurrent(project, asset) {
  const revision = screenplayHash(project);
  const approval = asset?.approval;
  const active = activeAssetVersion(asset);
  const generationFingerprint = assetGenerationFingerprint(asset);
  return Boolean(
    revision &&
    active &&
    project?.screenplay?.approval?.screenplayRevision === revision &&
    project?.assets?.screenplayHash === revision &&
    active.assetFingerprint === generationFingerprint &&
    active.screenplayRevision === revision &&
    active.manifestScreenplayHash === revision &&
    active.workflowId === asset.workflowId &&
    String(active.workflowHash || "") === String(asset.workflowHash || "") &&
    approval?.status === "approved" &&
    approval?.screenplayRevision === revision &&
    Number(approval?.activeVersion) === Number(asset?.activeVersion) &&
    approval?.generationFingerprint === generationFingerprint &&
    approval?.workflowId === asset.workflowId &&
    String(approval?.workflowHash || "") === String(asset.workflowHash || "") &&
    approval?.versionFingerprint === assetVersionFingerprint(asset) &&
    assetVersionFilesCurrent(project, asset)
  );
}

function seededInt(asset) {
  if (Number.isFinite(Number(asset.seed))) return Math.max(0, Math.floor(Number(asset.seed)));
  return parseInt(crypto.createHash("sha256").update(asset.id).digest("hex").slice(0, 12), 16);
}

function kreaResolution(asset, project) {
  if (asset.workflowId === "krea2-character-ingredients-fp8") return { width: 1024, height: 1024 };
  if (["atmosphere", "wardrobe"].includes(asset.category)) return { width: 768, height: 768 };
  const ratio = (project.settings?.width || 1280) / (project.settings?.height || 720);
  return ratio > 2 ? { width: 1024, height: 432 } : { width: 896, height: 512 };
}

function kreaPrompt(project, asset) {
  const { width, height } = kreaResolution(asset, project);
  const seed = seededInt(asset);
  const prompt = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: KREA_MODEL, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: KREA_CLIP, type: "krea2", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: asset.prompt, clip: ["2", 0] } },
    "4": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["3", 0] } },
    "5": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], denoise: 1 } },
    "8": { class_type: "VAELoader", inputs: { vae_name: KREA_VAE } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["8", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}` } }
  };
  return prompt;
}

function fluxPrompt(project, asset) {
  const seed = seededInt(asset);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: FLUX_MODEL, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: FLUX_CLIP, type: "flux2", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: `${asset.prompt}\n\nNeutral production reference framing, the complete object visible, accurate materials and scale, no labels or text.`, clip: ["2", 0] } },
    "4": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["3", 0] } },
    "5": { class_type: "EmptyFlux2LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], denoise: 1 } },
    "7": { class_type: "VAELoader", inputs: { vae_name: FLUX_VAE } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["7", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}` } }
  };
}

function voicePrompt(project, asset) {
  return {
    "1": {
      class_type: "FB_Qwen3TTSVoiceDesign",
      inputs: {
        text: asset.sampleText || "The light shines in the darkness.",
        instruct: asset.prompt,
        model_choice: "1.7B",
        device: "cuda",
        precision: "bf16",
        language: "English",
        seed: seededInt(asset),
        max_new_tokens: 2048,
        top_p: 0.8,
        top_k: 20,
        temperature: 0.9,
        repetition_penalty: 1.05,
        attention: "auto",
        unload_model_after_generate: true
      }
    },
    "2": { class_type: "SaveAudioMP3", inputs: { audio: ["1", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}`, quality: "V0" } }
  };
}

function acePrompt(project, asset) {
  const duration = Math.max(10, Math.min(180, Number(asset.durationSec) || 60));
  const bpm = Math.max(40, Math.min(180, Number(asset.bpm) || 76));
  const seed = seededInt(asset);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: ACE_MODEL, weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: ACE_CLIP_SMALL, clip_name2: ACE_CLIP_LARGE, type: "ace", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: ACE_VAE } },
    "4": { class_type: "TextEncodeAceStepAudio1.5", inputs: { clip: ["2", 0], tags: asset.prompt, lyrics: "", seed, bpm, duration, timesignature: "4", language: "en", keyscale: "D minor", generate_audio_codes: true, cfg_scale: 2, temperature: 0.85, top_p: 0.9, top_k: 0, min_p: 0 } },
    "5": { class_type: "EmptyAceStep1.5LatentAudio", inputs: { seconds: duration, batch_size: 1 } },
    "6": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "8": { class_type: "KSampler", inputs: { model: ["6", 0], seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["7", 0], latent_image: ["5", 0], denoise: 1 } },
    "9": { class_type: "VAEDecodeAudio", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveAudioMP3", inputs: { audio: ["9", 0], filename_prefix: `premiere316/${project.slug}/assets/${asset.id}`, quality: "V0" } }
  };
}

export function compileAssetWorkflow(project, asset) {
  if (isStyleLockWorkflow(asset.workflowId)) return compileStyleLockWorkflow(project, asset, seededInt(asset));
  if (asset.workflowId.startsWith("krea2")) return kreaPrompt(project, asset);
  if (asset.workflowId === "flux2-klein-9b-prop-fp8") return fluxPrompt(project, asset);
  if (asset.workflowId === "qwen3-tts-voice-design-1.7b") return voicePrompt(project, asset);
  if (asset.workflowId === "ace-step-1.5-xl-turbo") return acePrompt(project, asset);
  return null;
}

export async function validateAssetWorkflow(project, asset) {
  const prompt = compileAssetWorkflow(project, asset);
  if (!prompt) return { ready: true, errors: [] };
  // Queueing a selection validates many assets in one request. Reuse the
  // five-minute ComfyUI schema cache instead of downloading the full
  // /object_info payload once per asset; callers still receive the same
  // node/input/model validation, without leaving the UI stuck on Queueing.
  const objectInfo = await getObjectInfo();
  const errors = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    const schema = objectInfo?.[node?.class_type];
    if (!schema) {
      errors.push(`${nodeId} ${node?.class_type}: node is not installed`);
      continue;
    }
    for (const [inputName, definition] of Object.entries(schema?.input?.required || {})) {
      const value = node?.inputs?.[inputName];
      if (value == null || value === "") {
        errors.push(`${nodeId} ${node.class_type}: missing required input ${inputName}`);
        continue;
      }
      const allowed = Array.isArray(definition?.[0]) ? definition[0] : null;
      if (allowed && !Array.isArray(value) && !allowed.includes(value)) {
        errors.push(`${nodeId} ${node.class_type}: unavailable ${inputName}=${value}`);
      }
    }
  }
  return { ready: errors.length === 0, errors };
}

export function saveAssetPackageFiles(project, { productionBreakdown = null, reviewMarkdown = "" } = {}) {
  const root = projectDir(project.slug);
  const production = path.join(root, "production");
  const workflows = path.join(root, "workflows");
  fs.mkdirSync(production, { recursive: true });
  fs.mkdirSync(workflows, { recursive: true });
  if (productionBreakdown) fs.writeFileSync(path.join(production, "screenplay-production-breakdown.json"), JSON.stringify(productionBreakdown, null, 2));
  if (reviewMarkdown) fs.writeFileSync(path.join(production, "screenplay-review.md"), String(reviewMarkdown));
  fs.writeFileSync(path.join(workflows, "asset-workflow-catalog.json"), JSON.stringify(ASSET_WORKFLOWS, null, 2));
  for (const asset of project.assets?.items || []) {
    if (!isAuthoritativeStyleLockAsset(asset.id)) asset.prompt = withAssetPromptHeader(asset, asset.prompt);
    applyStyleLockToAsset(asset);
    const compiled = compileAssetWorkflow(project, asset);
    const filename = `${asset.id}.${compiled ? "api" : "recipe"}.json`;
    asset.workflowSnapshot = `workflows/${filename}`;
    if (compiled) {
      const serialized = JSON.stringify(compiled, null, 2);
      asset.workflowHash = crypto.createHash("sha256").update(serialized).digest("hex");
      fs.writeFileSync(path.join(workflows, filename), serialized);
    } else {
      const recipe = JSON.stringify({
        schemaVersion: 1,
        assetId: asset.id,
        workflowId: asset.workflowId,
        mode: asset.workflowId === "ltx-2.3-native-audio" ? "embed-in-shot-audio-prompt" : "deterministic-vector-compositor",
        prompt: asset.prompt,
        outputPattern: `${asset.id}.v{version}`
      }, null, 2);
      asset.workflowHash = crypto.createHash("sha256").update(recipe).digest("hex");
      fs.writeFileSync(path.join(workflows, filename), recipe);
    }
  }
  for (const asset of project.assets?.items || []) {
    const current = assetApprovalCurrent(project, asset);
    const active = activeAssetVersion(asset);
    const generationFingerprint = assetGenerationFingerprint(asset);
    asset.generationFingerprint = generationFingerprint;
    asset.activeVersionCurrent = Boolean(
      active?.assetFingerprint &&
      active.assetFingerprint === generationFingerprint &&
      active.screenplayRevision === screenplayHash(project) &&
      active.manifestScreenplayHash === project.assets?.screenplayHash &&
      active.workflowId === asset.workflowId &&
      String(active.workflowHash || "") === String(asset.workflowHash || "")
    );
    if (
      asset.mediaType === "image" &&
      !asset.activeVersionCurrent &&
      !["queued", "generating"].includes(String(asset.status || ""))
    ) asset.status = "planned";
    if (asset.approval && !current) asset.approval = null;
    asset.approvalCurrent = current;
  }
  fs.writeFileSync(path.join(production, "asset-manifest.json"), JSON.stringify(project.assets, null, 2));
}

function nextVersion(asset) {
  return Math.max(0, ...(asset.versions || []).map((version) => Number(version.v) || 0)) + 1;
}

function archiveWorkflowSnapshot(project, asset, version) {
  const relative = String(asset.workflowSnapshot || "");
  const source = path.join(projectDir(project.slug), relative);
  if (!relative || !fs.existsSync(source)) throw new Error("The queued workflow snapshot is missing");
  const contents = fs.readFileSync(source);
  const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
  if (asset.workflowHash && actualHash !== asset.workflowHash) throw new Error("The queued workflow snapshot changed before its output could be registered");
  const directory = path.join(projectDir(project.slug), "workflows", "versions");
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${asset.id}.v${version}.${actualHash.slice(0, 16)}.json`;
  const destination = path.join(directory, filename);
  if (fs.existsSync(destination)) {
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
    if (existingHash !== actualHash) throw new Error("Immutable workflow snapshot collision");
  } else {
    fs.writeFileSync(destination, contents, { flag: "wx" });
  }
  return { file: `workflows/versions/${filename}`, sha256: actualHash };
}

function svgEscape(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character]);
}

async function generateBuiltInAsset(project, asset, version) {
  const destination = mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  if (asset.workflowId === "premiere316-title-card") {
    const file = `${asset.id}.v${version}.svg`;
    // The generation prompt now carries a production heading. Render only the
    // exact title value so deterministic typography never leaks prompt metadata
    // onto the card or misspells the approved project title.
    const title = svgEscape(asset.variant || project.name);
    fs.writeFileSync(path.join(destination, file), `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="804" viewBox="0 0 1920 804"><rect width="1920" height="804" fill="#050609"/><text x="960" y="390" text-anchor="middle" fill="#f5f1e8" font-family="Georgia,serif" font-size="74" letter-spacing="5">${title}</text><text x="960" y="470" text-anchor="middle" fill="#a79b83" font-family="Arial,sans-serif" font-size="22" letter-spacing="9">A PREMIERE316 PRODUCTION</text></svg>`);
    return [file];
  }
  const file = `${asset.id}.v${version}.audio-direction.txt`;
  fs.writeFileSync(path.join(destination, file), `${asset.name}\n${asset.variant}\n\n${asset.prompt}\n`);
  return [file];
}

async function generateAssetJobInner(job) {
  const project = loadProject(job.projectSlug);
  const asset = project.assets?.items?.find((item) => item.id === job.refs.assetId);
  if (!asset) throw new Error("Asset not found");
  const currentRevision = screenplayHash(project);
  if (
    !currentRevision ||
    project.screenplay?.approval?.status !== "approved" ||
    project.screenplay?.approval?.screenplayRevision !== currentRevision
  ) throw new Error("Asset job cancelled because the screenplay revision is no longer approved");
  if (project.assets?.screenplayHash !== currentRevision) {
    throw new Error("Asset job cancelled because the asset manifest is stale for the approved screenplay");
  }
  if (job.refs?.screenplayRevision && job.refs.screenplayRevision !== currentRevision) {
    throw new Error("Asset job cancelled because the screenplay changed after it was queued");
  }
  if (job.refs?.manifestScreenplayHash && job.refs.manifestScreenplayHash !== project.assets.screenplayHash) {
    throw new Error("Asset job cancelled because the production asset manifest changed after it was queued");
  }
  if (job.refs?.assetFingerprint && job.refs.assetFingerprint !== assetGenerationFingerprint(asset)) {
    throw new Error("Asset job cancelled because the asset prompt or workflow changed after it was queued");
  }
  const runAsset = structuredClone(asset);
  const runFingerprint = assetGenerationFingerprint(runAsset);
  const runRevision = currentRevision;
  const runManifestHash = project.assets.screenplayHash;
  const plannedVersion = nextVersion(runAsset);
  const workflow = workflowFor(asset.workflowId);
  const catalog = await getAssetWorkflowCatalog();
  const state = catalog.find((entry) => entry.id === workflow.id);
  if (!state?.ready) throw new Error(state?.reason || `${workflow.label} is not ready`);
  if (state.availableNow === false) throw new Error(state.runtimeWarning || `${workflow.label} is waiting for GPU memory`);
  job.label = `Generate asset · ${asset.name}`;
  job.stage = `Preparing ${workflow.label}`;
  job.progress = 0.05;
  asset.status = "generating";
  saveAssetPackageFiles(project);
  saveProject(project);

  let files;
  const prompt = compileAssetWorkflow(project, runAsset);
  if (!prompt) {
    files = await generateBuiltInAsset(project, runAsset, plannedVersion);
  } else {
    job.stage = `Generating with ${workflow.model}`;
    const outputs = await runPrompt(prompt, {
      signal: job.signal,
      onProgress: ({ value, max }) => {
        if (max) job.progress = Math.min(0.9, 0.08 + (value / max) * 0.82);
      }
    });
    const refs = collectOutputFiles(outputs);
    if (!refs.length) throw new Error("ComfyUI completed without an asset file");
    const destination = mediaDir(project, "assets");
    fs.mkdirSync(destination, { recursive: true });
    files = [];
    for (let index = 0; index < refs.length; index += 1) {
      const basename = refs.length === 1 ? `${asset.id}.v${plannedVersion}` : `${asset.id}.v${plannedVersion}-${index + 1}`;
      files.push(await downloadOutput(refs[index], destination, basename));
    }
  }

  const fresh = loadProject(project.slug);
  const target = fresh.assets?.items?.find((item) => item.id === asset.id);
  if (!target) throw new Error("Asset disappeared while generation was running");
  const freshRevision = screenplayHash(fresh);
  if (
    !freshRevision ||
    fresh.screenplay?.approval?.status !== "approved" ||
    fresh.screenplay?.approval?.screenplayRevision !== freshRevision ||
    freshRevision !== runRevision ||
    fresh.assets?.screenplayHash !== runManifestHash
  ) throw new Error("Asset output was retained but not registered because the screenplay or asset manifest changed during generation");
  if (assetGenerationFingerprint(target) !== runFingerprint) {
    throw new Error("Asset output was retained but not registered because its prompt, workflow, or generation settings changed during generation");
  }
  if (nextVersion(target) !== plannedVersion) {
    throw new Error("Asset output was retained but not registered because another version completed during generation");
  }
  const version = plannedVersion;
  const fileHashes = generatedFileHashes(fresh, files);
  const workflowSnapshot = archiveWorkflowSnapshot(fresh, runAsset, version);
  target.versions = target.versions || [];
  target.versions.push({
    v: version,
    files,
    file: files[0],
    mediaType: runAsset.mediaType,
    workflowId: runAsset.workflowId,
    model: workflow.model,
    prompt: runAsset.prompt,
    sampleText: runAsset.sampleText || "",
    durationSec: runAsset.durationSec ?? null,
    bpm: runAsset.bpm ?? null,
    seed: seededInt(runAsset),
    workflowHash: runAsset.workflowHash || null,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    assetFingerprint: runFingerprint,
    screenplayRevision: runRevision,
    manifestScreenplayHash: runManifestHash,
    fileHashes,
    createdAt: new Date().toISOString()
  });
  target.activeVersion = version;
  target.status = target.workflowId === "ltx-2.3-native-audio" ? "ready-for-shot" : "generated";
  target.approval = null;
  saveAssetPackageFiles(fresh);
  saveProject(fresh);
  job.result = { assetId: target.id, files, version };
  job.progress = 0.98;
}

export async function generateAssetJob(job) {
  try {
    await generateAssetJobInner(job);
  } catch (error) {
    try {
      const failedProject = loadProject(job.projectSlug);
      const failedAsset = failedProject.assets?.items?.find((item) => item.id === job.refs?.assetId);
      if (failedAsset) {
        const cancelled = error?.code === "GENERATION_CANCELLED" || job.signal?.aborted || job.status === "cancelling";
        failedAsset.status = restoredAssetStatus(failedProject, failedAsset);
        failedAsset.lastError = cancelled ? null : String(error?.message || error);
        failedAsset.updatedAt = new Date().toISOString();
        saveAssetPackageFiles(failedProject);
        saveProject(failedProject);
      }
    } catch {}
    throw error;
  }
}

export function restoreCancelledAsset(projectSlug, assetId) {
  const project = loadProject(projectSlug);
  const asset = project.assets?.items?.find((item) => item.id === assetId);
  if (!asset) return project;
  asset.status = restoredAssetStatus(project, asset);
  asset.lastError = null;
  asset.updatedAt = new Date().toISOString();
  saveAssetPackageFiles(project);
  saveProject(project);
  return project;
}

export function registerDirectorAssetImage(project, asset, { buffer, extension = ".png", sourceFileName = "director-import.png" }) {
  if (!asset || asset.mediaType !== "image") throw new Error("The selected asset does not accept image versions");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("The imported image is empty");
  const safeExtension = [".png", ".jpg", ".jpeg", ".webp"].includes(String(extension).toLowerCase())
    ? String(extension).toLowerCase()
    : ".png";
  const version = nextVersion(asset);
  const file = `${asset.id}.v${version}${safeExtension}`;
  const destination = mediaDir(project, "assets");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, file), buffer);
  const screenplayRevision = screenplayHash(project);
  const generationFingerprint = assetGenerationFingerprint(asset);
  const workflowSnapshot = archiveWorkflowSnapshot(project, asset, version);
  asset.versions = asset.versions || [];
  asset.versions.push({
    v: version,
    files: [file],
    file,
    mediaType: "image",
    workflowId: asset.workflowId,
    model: "Director-supplied reference image",
    prompt: asset.prompt,
    sampleText: asset.sampleText || "",
    durationSec: null,
    bpm: null,
    seed: null,
    workflowHash: asset.workflowHash || null,
    workflowSnapshot: workflowSnapshot.file,
    workflowSnapshotHash: workflowSnapshot.sha256,
    assetFingerprint: generationFingerprint,
    screenplayRevision,
    manifestScreenplayHash: project.assets?.screenplayHash || screenplayRevision,
    fileHashes: generatedFileHashes(project, [file]),
    provenanceType: "director-import",
    sourceFileName: path.basename(sourceFileName),
    createdAt: new Date().toISOString()
  });
  asset.activeVersion = version;
  asset.status = "generated";
  asset.approval = null;
  asset.approvalCurrent = false;
  asset.lastError = null;
  asset.updatedAt = new Date().toISOString();
  saveAssetPackageFiles(project);
  saveProject(project);
  return { project, asset, version: asset.versions[asset.versions.length - 1] };
}

export function reconcileAssetGenerationState(project, activeAssetIds = new Set()) {
  let changed = false;
  for (const asset of project.assets?.items || []) {
    if (!["queued", "generating"].includes(asset.status) || activeAssetIds.has(asset.id)) continue;
    asset.status = restoredAssetStatus(project, asset);
    asset.lastError = null;
    asset.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    saveAssetPackageFiles(project);
    saveProject(project);
  }
  return project;
}

export function promoteAssetToFrame(project, asset) {
  if (!assetApprovalCurrent(project, asset)) throw new Error("Approve this exact generated asset version before adding it to the Project Bin");
  const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion));
  const sourceName = active?.file || active?.files?.[0];
  if (!sourceName || !/\.(png|jpe?g|webp)$/i.test(sourceName)) throw new Error("The active asset version is not a usable guide image");
  const source = path.join(mediaDir(project, "assets"), path.basename(sourceName));
  if (!fs.existsSync(source)) throw new Error("Asset file is missing");
  const extension = path.extname(sourceName).toLowerCase();
  const identity = String(asset.approval.versionFingerprint || "").slice(0, 16);
  const safeAssetId = String(asset.id).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  const filename = `asset_${safeAssetId}_v${active.v}_${identity}${extension}`;
  fs.mkdirSync(mediaDir(project, "frames"), { recursive: true });
  const destination = path.join(mediaDir(project, "frames"), filename);
  if (fs.existsSync(destination)) {
    const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
    const destinationHash = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
    if (sourceHash !== destinationHash) throw new Error("Project Bin immutable filename collision");
  } else {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  return registerFrame(project, filename, `${asset.name} · ${asset.variant}`, {
    source: "asset-foundry-approved",
    assetId: asset.id,
    assetVersion: active.v,
    assetApprovalFingerprint: asset.approval.versionFingerprint,
    screenplayRevision: asset.approval.screenplayRevision,
    approvedAt: asset.approval.approvedAt
  });
}
