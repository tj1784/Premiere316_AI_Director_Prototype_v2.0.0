import fs from "fs";
import path from "path";
import { ASSET_WORKFLOWS, saveAssetPackageFiles, withAssetPromptHeader } from "../server/assets.js";
import { loadProject, saveProject } from "../server/projects.js";
import { projectDir } from "../server/paths.js";
import { applyStyleLockToAsset } from "../server/style-lock.js";

const slug = process.argv[2] || "harrowing_of_hell";
const project = loadProject(slug);
const root = projectDir(slug);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "production", "style-lock-migration", stamp);
fs.mkdirSync(backupDir, { recursive: true });

for (const relative of ["project.json", path.join("production", "asset-manifest.json")]) {
  const source = path.join(root, relative);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backupDir, path.basename(relative)));
}

const changes = [];
for (const asset of project.assets?.items || []) {
  const beforeWorkflow = asset.workflowId;
  const beforePrompt = String(asset.prompt || "");
  asset.prompt = withAssetPromptHeader(asset, beforePrompt);
  applyStyleLockToAsset(asset);
  const changed = beforeWorkflow !== asset.workflowId || beforePrompt !== asset.prompt;
  if (changed) {
    asset.approval = null;
    asset.approvalCurrent = false;
    asset.promptEnhancement = [asset.promptEnhancement, "CI FLUX2 Premiere316 Style-Lock package"]
      .filter(Boolean)
      .join(" · ");
    asset.promptEnhancedAt = new Date().toISOString();
    asset.updatedAt = asset.promptEnhancedAt;
    changes.push({ id: asset.id, category: asset.category, from: beforeWorkflow, to: asset.workflowId });
  }
}

project.assets.catalog = ASSET_WORKFLOWS;
project.assets.generatedAt = new Date().toISOString();
project.assets.styleLock = {
  package: "CI_FLUX2_P316_StyleLock_Asset_Workflow_Package",
  appliedAt: new Date().toISOString(),
  activeReferences: [
    "CI_STYLE_REF_01_GLOBAL_GOLDEN_LIGHT_PALETTE.png",
    "CI_STYLE_REF_02_SMOKE_CAVE_EMBER_PALETTE.png",
    "CI_STYLE_REF_03_FILMIC_SKIN_LINEN_TONALITY.png"
  ],
  optionalReferencesBypassed: [
    "CI_STYLE_REF_04_IVORY_LINEN_BLOOD_MATERIAL_DETAIL_OPTIONAL.png",
    "CI_STYLE_REF_05_GOLD_VFX_GLOW_OPTIONAL.png",
    "CI_STYLE_REF_06_CHARACTER_SHEET_ART_DIRECTION_OPTIONAL.png"
  ],
  rule: "Style references control art direction only. Original Jesus references are restricted to exact Jesus character assets."
};

saveAssetPackageFiles(project);
saveProject(project);

const counts = changes.reduce((acc, change) => {
  acc[change.to] = (acc[change.to] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  ok: true,
  project: slug,
  assets: project.assets?.items?.length || 0,
  changed: changes.length,
  workflowCounts: counts,
  backupDir
}, null, 2));
