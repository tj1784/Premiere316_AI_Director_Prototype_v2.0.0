import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { saveStoryboard, validateStoryboard } from "../server/storyboard.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = process.argv[2];
const projectSlug = process.argv[3] || "harrowing_of_hell";

if (!sourceFile) {
  console.error("Usage: node scripts/import-storyboard-package.mjs <storyboard.json> [project-slug]");
  process.exit(1);
}

const projectFile = path.join(packageRoot, "projects", projectSlug, "project.json");
if (!fs.existsSync(projectFile)) throw new Error(`Project not found: ${projectFile}`);

const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
const storyboard = validateStoryboard(
  JSON.parse(fs.readFileSync(path.resolve(sourceFile), "utf8")),
  projectSlug,
  { allowLegacyBindingTargets: true }
);
const matchesByFile = new Map();
const DEFAULT_ROLE = {
  character: "identity",
  wardrobe: "wardrobe",
  location: "location",
  artifact: "prop",
  extra: "crowd",
  atmosphere: "atmosphere",
  "guide-frame": "composition",
  graphic: "graphic"
};

for (const asset of project.assets?.items || []) {
  for (const version of asset.versions || []) {
    const files = new Set([version.file, ...(version.files || [])].filter(Boolean));
    for (const file of files) {
      const key = String(file).toLowerCase();
      const matches = matchesByFile.get(key) || [];
      matches.push({ asset, version, file });
      matchesByFile.set(key, matches);
    }
  }
}

const unresolved = [];
for (const binding of Object.values(storyboard.referenceBindings)) {
  const matches = matchesByFile.get(String(binding.sourceAssetFile || "").toLowerCase()) || [];
  if (!matches.length) {
    unresolved.push(`${binding.id}: ${binding.sourceAssetFile}`);
    continue;
  }
  if (matches.length !== 1) {
    unresolved.push(`${binding.id}: ${binding.sourceAssetFile} resolves to ${matches.length} asset versions`);
    continue;
  }
  const match = matches[0];
  if (binding.targetKind === "frame" && !Object.hasOwn(storyboard.frames, binding.targetId)) {
    const segmentId = String(binding.targetId || "").replace(/^frame-segment-/, "segment-");
    if (!Object.hasOwn(storyboard.segments, segmentId)) {
      unresolved.push(`${binding.id}: target ${binding.targetId} is not a frame or segment`);
      continue;
    }
    binding.authoredTargetKind = binding.targetKind;
    binding.authoredTargetId = binding.targetId;
    binding.targetKind = "segment";
    binding.targetId = segmentId;
  }
  binding.assetId = match.asset.id;
  binding.assetVersion = Number(match.version.v);
  binding.assetVersionId = `${match.asset.id}:v${match.version.v}`;
  binding.sourceAssetFile = match.file;
  binding.sourceAssetKey = String(match.file).replace(/\.[^.]+$/, "");
  binding.resolutionStatus = binding.authoredTargetId
    ? "resolved_exact_version_segment_annotation"
    : "resolved_exact_version";
  binding.pinnedActiveAtImport = Number(match.asset.activeVersion) === Number(match.version.v);
}

if (unresolved.length) {
  throw new Error(`Could not resolve ${unresolved.length} storyboard references:\n${unresolved.slice(0, 25).join("\n")}`);
}

const authoredByTargetAndFile = new Map();
for (const binding of Object.values(storyboard.referenceBindings)) {
  authoredByTargetAndFile.set(`${binding.targetId}|${String(binding.sourceAssetFile).toLowerCase()}`, binding);
}
for (const frame of Object.values(storyboard.frames)) {
  const files = [...new Set(String(frame.prompt || "").match(/[a-z0-9][a-z0-9-]*\.v\d+\.(?:png|jpe?g|webp|gif|svg)/gi) || [])];
  frame.references = files.map((file, index) => {
    const matches = matchesByFile.get(file.toLowerCase()) || [];
    if (!matches.length) throw new Error(`Frame ${frame.id} references an unknown asset file: ${file}`);
    if (matches.length !== 1) throw new Error(`Frame ${frame.id} asset file is ambiguous: ${file} resolves to ${matches.length} asset versions`);
    const match = matches[0];
    const authored = authoredByTargetAndFile.get(`${frame.id}|${file.toLowerCase()}`);
    return {
      ...(authored || {}),
      id: authored?.id || `effective-${frame.id}-${index + 1}`,
      assetId: match.asset.id,
      assetVersion: Number(match.version.v),
      assetVersionId: `${match.asset.id}:v${match.version.v}`,
      sourceAssetFile: match.file,
      sourceAssetKey: String(match.file).replace(/\.[^.]+$/, ""),
      resolutionStatus: "resolved_exact_version",
      role: authored?.role || DEFAULT_ROLE[match.asset.category] || "style",
      targetKind: "frame",
      targetId: frame.id,
      useMode: authored?.useMode || "direct_conditioning",
      required: authored?.required !== false,
      order: index + 1,
      cropRegion: authored?.cropRegion || "Use relevant subject/design region only",
      notes: authored?.notes || "Effective image-guide reference derived from the authoritative segment prompt."
    };
  });
}

storyboard.source = {
  ...(storyboard.source || {}),
  importedFrom: path.basename(sourceFile),
  importedAt: new Date().toISOString()
};
storyboard.updatedAt = new Date().toISOString();

saveStoryboard(projectSlug, storyboard);
console.log(JSON.stringify({
  projectSlug,
  chapters: Object.keys(storyboard.chapters).length,
  scenes: Object.keys(storyboard.scenes).length,
  clips: Object.keys(storyboard.clips).length,
  frames: Object.keys(storyboard.frames).length,
  videoPlans: Object.keys(storyboard.videoPlans).length,
  segments: Object.keys(storyboard.segments).length,
  referenceBindings: Object.keys(storyboard.referenceBindings).length,
  effectiveReferences: Object.values(storyboard.frames).reduce((total, frame) => total + frame.references.length, 0)
}, null, 2));
