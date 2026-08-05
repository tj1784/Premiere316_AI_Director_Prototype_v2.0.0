import fs from "fs";
import path from "path";
import { loadProject, saveProject } from "../server/projects.js";
import {
  saveAssetPackageFiles,
  withAssetPromptHeader
} from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const slug = String(process.argv[2] || "harrowing_of_hell").trim();
const root = projectDir(slug);
const projectPath = path.join(root, "project.json");
const manifestPath = path.join(root, "production", "asset-manifest.json");
const enhancedDir = path.join(root, "production", "prompt-enhancement", "enhanced");
const jobsPath = path.join(root, "generation-jobs.json");

if (!fs.existsSync(projectPath)) throw new Error(`Project not found: ${projectPath}`);

if (fs.existsSync(jobsPath)) {
  const persisted = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
  const active = (persisted.jobs || []).filter((job) => ["queued", "running", "cancelling"].includes(String(job.status || "")));
  if (active.length) throw new Error(`Refusing prompt migration while ${active.length} asset generation job(s) are active.`);
}

const project = loadProject(slug);
const assets = project.assets?.items || [];
if (!assets.length) throw new Error(`Project ${slug} has no asset catalog.`);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "production", "prompt-header-migration", timestamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(projectPath, path.join(backupDir, "project.before.json"));
if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, path.join(backupDir, "asset-manifest.before.json"));

const beforePrompts = {};
let changed = 0;
for (const asset of assets) {
  const before = String(asset.prompt || "");
  beforePrompts[asset.id] = before;
  asset.prompt = withAssetPromptHeader(asset, before);
  if (asset.prompt !== before) changed += 1;
  asset.updatedAt = new Date().toISOString();
}
fs.writeFileSync(path.join(backupDir, "current-prompts.before.json"), JSON.stringify(beforePrompts, null, 2));

let enhancedSynchronized = 0;
let enhancedMissing = 0;
let invalidEnhancedFilesRebuilt = 0;
for (const asset of assets) {
  const file = path.join(enhancedDir, `${asset.id}.json`);
  if (!fs.existsSync(file)) {
    enhancedMissing += 1;
    continue;
  }
  let enhanced;
  try {
    enhanced = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Recover a malformed agent output from authoritative project data instead
    // of letting one bad control character abort the full catalog migration.
    enhanced = {
      id: asset.id,
      category: asset.category,
      mediaType: asset.mediaType,
      workflowId: asset.workflowId,
      sourcePrompt: asset.sourcePrompt || "",
      sampleText: asset.sampleText || "",
      notes: "Rebuilt from the authoritative project asset after invalid enhancement JSON was detected."
    };
    invalidEnhancedFilesRebuilt += 1;
  }
  enhanced.id = asset.id;
  enhanced.name = asset.name;
  enhanced.variant = asset.variant;
  enhanced.category = asset.category;
  enhanced.promptHeader = asset.promptHeader;
  // Current project direction is authoritative. This intentionally prevents a
  // stale enhancement file from reverting an asset during a later selected run.
  enhanced.prompt = asset.prompt;
  fs.writeFileSync(file, JSON.stringify(enhanced, null, 2));
  enhancedSynchronized += 1;
}

project.assets.generatedAt = new Date().toISOString();
project.assets.promptHeaderPolicy = {
  version: 1,
  appliedAt: new Date().toISOString(),
  format: "ASSET NAME — SHORT GENERATION SUMMARY.",
  uppercaseHeader: true,
  bodyPreserved: true
};
project.updatedAt = new Date().toISOString();

// Regenerate the manifest and active workflow snapshots once from the
// authoritative project directions. Historical version snapshots are not read
// or written by this migration.
saveAssetPackageFiles(project);
saveProject(project);

const indexLines = [
  `# ${project.name} — Named Asset Prompt Index`,
  "",
  "Every current generation prompt begins with the exact uppercase line shown below. Historical generated-version prompts remain unchanged.",
  ""
];
let lastCategory = "";
for (const asset of [...assets].sort((a, b) => `${a.category}|${a.name}|${a.variant}`.localeCompare(`${b.category}|${b.name}|${b.variant}`))) {
  if (asset.category !== lastCategory) {
    lastCategory = asset.category;
    indexLines.push(`## ${asset.categoryLabel || asset.category}`, "");
  }
  indexLines.push(`- **${asset.promptHeader}**  `, `  \`${asset.id}\``, "");
}
const indexPath = path.join(root, "production", "asset-prompt-index.md");
fs.writeFileSync(indexPath, `${indexLines.join("\n")}\n`, "utf8");

const invalid = assets.filter((asset) => {
  const first = String(asset.prompt || "").split(/\r?\n/, 1)[0];
  return first !== asset.promptHeader || first !== first.toLocaleUpperCase("en-US");
});
if (invalid.length) throw new Error(`Prompt header validation failed for: ${invalid.map((asset) => asset.id).join(", ")}`);

const report = {
  appliedAt: new Date().toISOString(),
  project: slug,
  totalAssets: assets.length,
  promptsChanged: changed,
  enhancedFilesSynchronized: enhancedSynchronized,
  enhancedFilesMissing: enhancedMissing,
  invalidEnhancedFilesRebuilt,
  historicalVersionPromptsChanged: 0,
  index: path.relative(root, indexPath).replace(/\\/g, "/"),
  backup: path.relative(root, backupDir).replace(/\\/g, "/"),
  headers: assets.map((asset) => ({ id: asset.id, header: asset.promptHeader }))
};
const reportPath = path.join(root, "production", "prompt-header-migration-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
