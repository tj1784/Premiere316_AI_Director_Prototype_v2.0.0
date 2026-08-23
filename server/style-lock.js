import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WORKFLOWS_DIR } from "./paths.js";

export const STYLE_FLUX_MODEL = "flux2-dev.safetensors";
export const STYLE_FLUX_CLIP = "mistral_3_small_flux2_fp4_mixed.safetensors";
export const STYLE_FLUX_VAE = "flux2-vae.safetensors";
export const STYLE_UPSCALER = "RealESRGAN_x2plus.pth";

export const STYLE_LOCK_IDS = {
  fourByThree: "ci-flux2-p316-style-only-4x3-max",
  widescreen: "ci-flux2-p316-style-only-16x9-max",
  cinematic: "ci-flux2-p316-style-only-2p39x1-max",
  vertical: "ci-flux2-p316-style-only-2x3-vertical-max",
  jesusOnly: "ci-flux2-jesus-only-character-sheet-4x3-max"
};

export const STYLE_REFERENCE_FILES = [
  "CI_STYLE_REF_01_GLOBAL_GOLDEN_LIGHT_PALETTE.png",
  "CI_STYLE_REF_02_SMOKE_CAVE_EMBER_PALETTE.png",
  "CI_STYLE_REF_03_FILMIC_SKIN_LINEN_TONALITY.png"
];

export const OPTIONAL_STYLE_REFERENCE_FILES = [
  "CI_STYLE_REF_04_IVORY_LINEN_BLOOD_MATERIAL_DETAIL_OPTIONAL.png",
  "CI_STYLE_REF_05_GOLD_VFX_GLOW_OPTIONAL.png",
  "CI_STYLE_REF_06_CHARACTER_SHEET_ART_DIRECTION_OPTIONAL.png"
];

export const STYLE_LOCK_PROMPT = `STYLE-ONLY IMAGE REFERENCE LOCK — Premiere316
Use the ComfyUI image references only for art direction: sacred cinematic realism, warm divine-gold light, dark smoky umber shadows, ember haze, live-action camera language, realistic material physics, detailed texture, and restrained film grain. Do not copy content, identity, wardrobe, wounds, props, locations, crowds, gates, or layout from the references unless this exact row prompt requests them.`;

export const AUDIO_STYLE_BRIDGE_PROMPT = `AUDIO STYLE BRIDGE — Premiere316
Translate the visual design into audio language: sacred cinematic realism, ancient stone resonance, warm harmonic glow, smoky low-frequency pressure, ember crackle, drifting air, natural dynamics, restrained epic scale. Keep the row's dialogue, sound, or music prompt as content source-of-truth.`;

const styleFamily = {
  family: "ci-flux2-p316-style-lock",
  mediaType: "image",
  model: "FLUX.2 Dev · runtime FP8 cast + Mistral 3 Small FLUX.2 FP4",
  requiredNodes: [
    "UNETLoader",
    "CLIPLoader",
    "CLIPTextEncode",
    "FluxGuidance",
    "ReferenceLatent",
    "EmptyFlux2LatentImage",
    "Flux2Scheduler",
    "SamplerCustomAdvanced",
    "VAEDecode",
    "UpscaleModelLoader",
    "ImageUpscaleWithModel",
    "SaveImage"
  ],
  requiredModels: [STYLE_FLUX_MODEL, STYLE_FLUX_CLIP, STYLE_FLUX_VAE, STYLE_UPSCALER],
  activeStyleReferences: STYLE_REFERENCE_FILES,
  optionalStyleReferences: OPTIONAL_STYLE_REFERENCE_FILES,
  outputMode: "native-and-2x"
};

export const STYLE_LOCK_WORKFLOWS = [
  {
    ...styleFamily,
    id: STYLE_LOCK_IDS.cinematic,
    label: "CI FLUX.2 Style-Lock · 2.39:1 MAX",
    aspectRatio: "2.39:1",
    template: "CI_FLUX2_P316_STYLE_ONLY_ASSET_2P39X1_API_2X.json",
    purpose: "Authoritative cinematic production assets using the package's 2.39:1 route."
  },
  {
    ...styleFamily,
    id: STYLE_LOCK_IDS.fourByThree,
    label: "CI FLUX.2 Style-Lock · 4:3 MAX",
    aspectRatio: "4:3",
    template: "CI_FLUX2_P316_STYLE_ONLY_ASSET_4X3_API_2X.json",
    purpose: "General production assets using abstract art-direction references without identity or content transfer."
  },
  {
    ...styleFamily,
    id: STYLE_LOCK_IDS.widescreen,
    label: "CI FLUX.2 Style-Lock · 16:9 MAX",
    aspectRatio: "16:9",
    template: "CI_FLUX2_P316_STYLE_ONLY_ASSET_16X9_API_2X.json",
    purpose: "Guide frames, locations, crowds, and atmosphere/VFX with widescreen cinematic continuity."
  },
  {
    ...styleFamily,
    id: STYLE_LOCK_IDS.vertical,
    label: "CI FLUX.2 Style-Lock · 2:3 Vertical MAX",
    aspectRatio: "2:3",
    template: "CI_FLUX2_P316_STYLE_ONLY_ASSET_2X3_VERTICAL_API_2X.json",
    purpose: "Character, wardrobe, and hero-prop studies using style plates only."
  },
  {
    ...styleFamily,
    id: STYLE_LOCK_IDS.jesusOnly,
    label: "CI FLUX.2 · Jesus Identity Sheet 4:3 MAX",
    aspectRatio: "4:3",
    template: "CI_FLUX2_P316_STYLE_ONLY_ASSET_4X3_API_2X.json",
    purpose: "Jesus primary four-view character sheet using the original identity, layout, and costume references.",
    identityReferences: ["CI_REF_01_LAYOUT.png", "CI_REF_02_FACE.png", "CI_REF_03_COSTUME_BODY.png"]
  }
];

const workflowById = new Map(STYLE_LOCK_WORKFLOWS.map((workflow) => [workflow.id, workflow]));
const packageApiDir = path.join(WORKFLOWS_DIR, "ci-flux2-p316-style-lock", "api");
const authoritativePackageDir = path.join(WORKFLOWS_DIR, "ci-flux2-p316-style-lock", "authoritative");
const authoritativeIndexPath = path.join(authoritativePackageDir, "ASSET_WORKFLOW_INDEX.csv");

function parseQuotedCsvLine(line) {
  const values = [];
  const matcher = /"((?:[^"]|"")*)"(?:,|$)/g;
  let match;
  while ((match = matcher.exec(line)) !== null) values.push(match[1].replace(/""/g, '"'));
  return values;
}

function loadAuthoritativeIndex() {
  if (!fs.existsSync(authoritativeIndexPath)) return new Map();
  const lines = fs.readFileSync(authoritativeIndexPath, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseQuotedCsvLine(lines.shift() || "");
  return new Map(lines.map((line) => {
    const values = parseQuotedCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    return [row.asset_id, row];
  }));
}

const authoritativeByAssetId = loadAuthoritativeIndex();

function addLiveSchemaCompatibility(prompt) {
  for (const node of Object.values(prompt)) {
    if (node?.class_type === "ImageScaleToTotalPixels" && node.inputs?.resolution_steps == null) {
      node.inputs.resolution_steps = 1;
    }
    if (node?.class_type === "UNETLoader" && node.inputs?.unet_name === "flux2_dev_fp8mixed.safetensors") {
      node.inputs.unet_name = STYLE_FLUX_MODEL;
      node.inputs.weight_dtype = "fp8_e4m3fn_fast";
    }
    if (node?.class_type === "CLIPLoader" && node.inputs?.clip_name === "mistral_3_small_flux2_fp8.safetensors") {
      node.inputs.clip_name = STYLE_FLUX_CLIP;
    }
  }
  return prompt;
}

function loadAuthoritativeAssetWorkflow(project, asset) {
  if (String(project?.slug || "") !== "harrowing_of_hell") return null;
  const row = authoritativeByAssetId.get(String(asset?.id || ""));
  // The authoritative index covers the screenplay-derived 97-asset package.
  // Director-created assets intentionally fall back to the selected reusable
  // Style-Lock preset while indexed production assets keep their exact hash.
  if (!row) return null;
  const relative = String(row.max_workflow_snapshot || "").replaceAll("/", path.sep);
  const source = path.resolve(authoritativePackageDir, relative);
  if (!source.startsWith(path.resolve(authoritativePackageDir) + path.sep) || !fs.existsSync(source)) {
    throw new Error(`Authoritative production workflow file is missing: ${row.max_workflow_snapshot}`);
  }
  const contents = fs.readFileSync(source);
  const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
  if (actualHash !== String(row.max_workflow_hash || "").toLowerCase()) {
    throw new Error(`Authoritative workflow hash mismatch for ${asset.id}`);
  }
  return addLiveSchemaCompatibility(JSON.parse(contents.toString("utf-8")));
}

export function isStyleLockWorkflow(workflowId) {
  return workflowById.has(String(workflowId || ""));
}

export function isAuthoritativeStyleLockAsset(assetId) {
  return authoritativeByAssetId.has(String(assetId || ""));
}

export function styleLockWorkflowIdForAsset(asset) {
  const authoritative = authoritativeByAssetId.get(String(asset?.id || ""));
  if (authoritative?.workflow_preset === "4X3") return STYLE_LOCK_IDS.fourByThree;
  if (authoritative?.workflow_preset === "2P39X1") return STYLE_LOCK_IDS.cinematic;
  if (authoritative?.workflow_preset === "2X3_VERTICAL") return STYLE_LOCK_IDS.vertical;
  const id = String(asset?.id || "");
  const category = String(asset?.category || "");
  const name = String(asset?.name || "");
  const variant = String(asset?.variant || "");
  if (
    id === "character-jesus-the-harrower-primary-appearance" ||
    (category === "character" && /jesus/i.test(name) && /primary appearance/i.test(variant))
  ) return STYLE_LOCK_IDS.jesusOnly;
  if (["character", "wardrobe", "artifact"].includes(category)) return STYLE_LOCK_IDS.vertical;
  if (["location", "extra", "atmosphere", "guide-frame"].includes(category)) return STYLE_LOCK_IDS.widescreen;
  if (asset?.mediaType === "image") return STYLE_LOCK_IDS.fourByThree;
  return null;
}

function insertAfterManagedHeader(prompt, block) {
  const body = String(prompt || "").replace(/\r\n/g, "\n").trim();
  if (!body || body.includes(block)) return body || block;
  const separator = body.indexOf("\n\n");
  if (separator < 0) return `${body}\n\n${block}`;
  return `${body.slice(0, separator)}\n\n${block}\n\n${body.slice(separator + 2)}`;
}

export function applyStyleLockToAsset(asset) {
  if (
    asset?.generationComposer === true ||
    asset?.regenerationMode === "prompt-composer" ||
    asset?.source === "prompt-generation-composer"
  ) return asset;
  const workflowId = styleLockWorkflowIdForAsset(asset);
  if (workflowId) {
    const current = String(asset.workflowId || "");
    const keepExplicit = current && !isStyleLockWorkflow(current);
    if (!keepExplicit) asset.workflowId = workflowId;
    // The 97-asset production package already contains the complete,
    // authoritative prompt envelope for every indexed image. Never prepend
    // the older generic style-lock text or add a Jesus-only exception.
    if (authoritativeByAssetId.has(String(asset?.id || ""))) return asset;
    if (workflowId !== STYLE_LOCK_IDS.jesusOnly) {
      asset.prompt = insertAfterManagedHeader(asset.prompt, STYLE_LOCK_PROMPT);
      const continuity = Array.isArray(asset.continuity) ? asset.continuity : [];
      const lock = "STYLE-ONLY REF LOCK: references control lighting, palette, texture, and cinematic art direction only; no content or identity borrowing.";
      if (!continuity.includes(lock)) asset.continuity = [...continuity, lock];
    }
  } else if (["sound", "music"].includes(String(asset?.category || ""))) {
    asset.prompt = insertAfterManagedHeader(asset.prompt, AUDIO_STYLE_BRIDGE_PROMPT);
  }
  return asset;
}

function loadTemplate(workflow) {
  const templatePath = path.join(packageApiDir, workflow.template);
  return JSON.parse(fs.readFileSync(templatePath, "utf-8"));
}

export function compileStyleLockWorkflow(project, asset, seed) {
  const authoritative = loadAuthoritativeAssetWorkflow(project, asset);
  if (authoritative) return authoritative;
  const workflow = workflowById.get(String(asset?.workflowId || ""));
  if (!workflow) return null;
  const prompt = loadTemplate(workflow);
  prompt["12"].inputs.unet_name = STYLE_FLUX_MODEL;
  prompt["12"].inputs.weight_dtype = "fp8_e4m3fn_fast";
  prompt["38"].inputs.clip_name = STYLE_FLUX_CLIP;
  prompt["10"].inputs.vae_name = STYLE_FLUX_VAE;
  prompt["63"].inputs.model_name = STYLE_UPSCALER;
  prompt["6"].inputs.text = String(asset.prompt || "");
  prompt["25"].inputs.noise_seed = seed;

  // ComfyUI 0.29 added a required resolution_steps widget to
  // ImageScaleToTotalPixels. Older exported API templates do not contain it,
  // so every Generate click was rejected before sampling began. Keep the
  // compatibility value here so existing project snapshots and every style-
  // lock aspect-ratio template compile against the installed node schema.
  addLiveSchemaCompatibility(prompt);

  if (workflow.id === STYLE_LOCK_IDS.jesusOnly) {
    prompt["26"].inputs.guidance = 4.0;
    prompt["42"].inputs.image = "CI_REF_01_LAYOUT.png";
    prompt["46"].inputs.image = "CI_REF_02_FACE.png";
    prompt["52"].inputs.image = "CI_REF_03_COSTUME_BODY.png";
  } else if (/^character-jesus-the-harrower-(?:close-up|action-pose)$/.test(String(asset.id || ""))) {
    // The package explicitly permits an identity reference only when the row
    // itself is Jesus. Other assets always retain the abstract style plates.
    prompt["46"].inputs.image = "CI_REF_02_FACE.png";
  }

  const prefix = `premiere316/${project.slug}/assets/${asset.id}`;
  if (prompt["9"]?.inputs) prompt["9"].inputs.filename_prefix = `${prefix}-native`;
  if (prompt["65"]?.inputs) prompt["65"].inputs.filename_prefix = `${prefix}-2x`;
  return prompt;
}
