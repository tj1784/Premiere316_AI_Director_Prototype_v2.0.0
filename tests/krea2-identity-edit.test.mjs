import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ASSET_WORKFLOWS,
  compileAssetWorkflow,
  createDirectorAsset,
  defaultAssetWorkflow,
  visualEditWorkflow,
  visualWorkflow
} from "../server/assets.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_EDIT_ID = "krea2-identity-edit-v1-2";

test("ASSET_WORKFLOWS contains krea2-identity-edit-v1-2", () => {
  const workflow = ASSET_WORKFLOWS.find((item) => item.id === IDENTITY_EDIT_ID);
  assert.ok(workflow);
  assert.equal(workflow.mediaType, "image");
  assert.match(String(workflow.purpose || ""), /identity-preserving edit/i);
  assert.match(String(workflow.purpose || ""), /not from-scratch/i);
  assert.ok(workflow.requiredModels.some((model) => /krea2_turbo_bf16/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /qwen3vl_4b_bf16/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /qwen_image_vae/i.test(model)));
  assert.ok(workflow.requiredModels.some((model) => /krea2_identity_edit_v1_2/i.test(model)));
  assert.ok(workflow.requiredNodes.includes("Krea2EditModelPatch"));
  assert.ok(workflow.requiredNodes.includes("LoraLoaderModelOnly"));
  assert.ok(!workflow.requiredNodes.some((node) => /minimax/i.test(node)));
});

test("no MiniMax image workflow ids in ASSET_WORKFLOWS", () => {
  const imageWorkflows = ASSET_WORKFLOWS.filter((workflow) => workflow.mediaType === "image");
  assert.ok(imageWorkflows.length > 0);
  for (const workflow of imageWorkflows) {
    assert.doesNotMatch(String(workflow.id), /minimax/i);
    assert.doesNotMatch(String(workflow.model || ""), /minimax/i);
  }
});

test("visualWorkflow(\"guide-frame\") is krea2-cinematic-still-fp8", () => {
  assert.equal(visualWorkflow("guide-frame"), "krea2-cinematic-still-fp8");
  assert.notEqual(visualWorkflow("guide-frame"), IDENTITY_EDIT_ID);
  assert.equal(visualWorkflow("guide-frame", "Touch-up", "First Frame"), "krea2-cinematic-still-fp8");
  assert.equal(visualWorkflow("guide-frame", "Opening Guide Frame", "First Frame"), "krea2-cinematic-still-fp8");
  assert.equal(defaultAssetWorkflow("guide-frame", "Opening Guide Frame", "First Frame"), "krea2-cinematic-still-fp8");
});

test("visualWorkflow(\"artifact\") is flux2-klein-9b-prop-fp8", () => {
  assert.equal(visualWorkflow("artifact"), "flux2-klein-9b-prop-fp8");
});

test("character and wardrobe identity sheets stay on Krea2 ingredients", () => {
  assert.equal(visualWorkflow("character", "Primary Appearance"), "krea2-character-ingredients-fp8");
  assert.equal(visualWorkflow("wardrobe", "Identity Ingredients"), "krea2-character-ingredients-fp8");
});

test("identity-edit is opt-in for approved-asset touch-ups", () => {
  assert.equal(visualEditWorkflow(), IDENTITY_EDIT_ID);
  assert.equal(defaultAssetWorkflow("character", "Identity Edit", "Jesus"), IDENTITY_EDIT_ID);
  assert.equal(defaultAssetWorkflow("guide-frame", "Touch-up", "Approved still"), IDENTITY_EDIT_ID);
  assert.notEqual(defaultAssetWorkflow("guide-frame", "Opening Guide Frame"), IDENTITY_EDIT_ID);
  assert.equal(defaultAssetWorkflow("voice", "Identity Edit", "Jesus"), "qwen3-tts-voice-design-1.7b");
  assert.equal(defaultAssetWorkflow("music", "Touch-up", "Theme"), "ace-step-1.5-xl-turbo");
});

test("manifest lists krea2-identity-edit-v1-2", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows", "manifest.json"), "utf8"));
  const entry = (manifest.workflows || []).find((item) => item.id === IDENTITY_EDIT_ID);
  assert.ok(entry);
  assert.equal(entry.rel, "krea2-identity-edit-v1-2.ui.json");
  assert.equal(entry.label, "Krea 2 Identity Edit v1.2");
  assert.equal(fs.existsSync(path.join(ROOT, "workflows", entry.rel)), true);
});

test("compileAssetWorkflow identity-edit uses Krea2 turbo, Qwen3-VL, VAE, and identity-edit LoRA", () => {
  const compiled = compileAssetWorkflow({ slug: "test-project" }, {
    id: "character-jesus-touch-up",
    prompt: "Preserve the exact facial identity. Relight with warm golden hour.",
    workflowId: IDENTITY_EDIT_ID,
    sourceImage: "approved-jesus.v1.png",
    seed: 11
  });
  assert.equal(compiled?.["55"]?.class_type, "UNETLoader");
  assert.equal(compiled?.["55"]?.inputs?.unet_name, "KREA 2\\krea2_turbo_bf16.safetensors");
  assert.equal(compiled?.["56"]?.inputs?.clip_name, "qwen3vl_4b_bf16.safetensors");
  assert.equal(compiled?.["56"]?.inputs?.type, "krea2");
  assert.equal(compiled?.["57"]?.inputs?.vae_name, "qwen_image_vae.safetensors");
  assert.equal(compiled?.["71"]?.class_type, "LoraLoaderModelOnly");
  assert.equal(compiled?.["71"]?.inputs?.lora_name, "krea2\\krea2_identity_edit_v1_2.safetensors");
  assert.equal(compiled?.["72"]?.class_type, "LoadImage");
  assert.equal(compiled?.["72"]?.inputs?.image, "approved-jesus.v1.png");
  assert.equal(compiled?.["84"]?.class_type, "Krea2EditGroundedEncode");
  assert.equal(compiled?.["84"]?.inputs?.prompt, "Preserve the exact facial identity. Relight with warm golden hour.");
  assert.equal(compiled?.["85"]?.inputs?.prompt, "");
  assert.equal(compiled?.["79"]?.class_type, "Krea2EditModelPatch");
  assert.ok(!JSON.stringify(compiled).toLowerCase().includes("minimax"));

  const uploaded = compileAssetWorkflow({ slug: "test-project" }, {
    id: "character-jesus-touch-up",
    prompt: "Preserve the exact facial identity. Relight with warm golden hour.",
    workflowId: IDENTITY_EDIT_ID,
    sourceImage: "premiere316_identity_edit/approved-jesus.v1.png",
    seed: 11
  });
  assert.equal(uploaded?.["72"]?.inputs?.image, "premiere316_identity_edit/approved-jesus.v1.png");
});

test("first-frame generation compiles cinematic still, not identity-edit", () => {
  const frame = createDirectorAsset({
    category: "guide-frame",
    name: "Opening Guide Frame",
    variant: "First Frame",
    prompt: "Generate the opening still."
  });
  assert.equal(frame.workflowId, "krea2-cinematic-still-fp8");
  const compiled = compileAssetWorkflow({ slug: "test-project", settings: { width: 1280, height: 720 } }, frame);
  assert.equal(compiled?.["3"]?.class_type, "CLIPTextEncode");
  assert.ok(!Object.values(compiled).some((node) => /Krea2Edit|LoadImage|LoraLoader/i.test(node.class_type)));
  assert.ok(!JSON.stringify(compiled).toLowerCase().includes("minimax"));
  assert.ok(!JSON.stringify(compiled).toLowerCase().includes("krea2_identity_edit"));
});

test("identity-edit keeps the plain-English instruction and skips four-view headers", () => {
  const asset = createDirectorAsset({
    category: "character",
    name: "Jesus",
    variant: "Identity Edit",
    prompt: "Preserve the exact facial identity. Relight with warm golden hour."
  });
  assert.equal(asset.workflowId, IDENTITY_EDIT_ID);
  assert.equal(asset.prompt, "Preserve the exact facial identity. Relight with warm golden hour.");
  assert.doesNotMatch(asset.prompt, /STYLE-ONLY IMAGE REFERENCE LOCK/i);
  assert.doesNotMatch(asset.prompt, /four-view/i);
  const compiled = compileAssetWorkflow({ slug: "test-project" }, {
    ...asset,
    sourceImage: "premiere316_identity_edit/approved-jesus.v1.png",
    promptHeader: "JESUS — IDENTITY EDIT: FOUR-VIEW IDENTITY, ANATOMY, COSTUME, AND CONTINUITY REFERENCE.",
    prompt: "JESUS — IDENTITY EDIT: FOUR-VIEW IDENTITY, ANATOMY, COSTUME, AND CONTINUITY REFERENCE.\n\nPreserve the exact facial identity. Relight with warm golden hour."
  });
  assert.equal(compiled?.["84"]?.inputs?.prompt, "Preserve the exact facial identity. Relight with warm golden hour.");
  assert.equal(compiled?.["72"]?.inputs?.image, "premiere316_identity_edit/approved-jesus.v1.png");
});
