import crypto from "crypto";
import fs from "fs";
import path from "path";
import { loadProject, saveProject } from "../server/projects.js";
import { projectDir } from "../server/paths.js";

const slug = "harrowing_of_hell";
const project = loadProject(slug);
const root = projectDir(slug);
const packageRoot = path.resolve(
  process.cwd(),
  "workflows",
  "ci-flux2-p316-style-lock",
  "authoritative"
);
const indexPath = path.join(packageRoot, "ASSET_WORKFLOW_INDEX.csv");

const detailLock = `RICH PHOTOREALISTIC LOCATION DETAIL LOCK
---------------------------------------
The generated image must feel like a final live-action cinema plate, not a loose concept sketch. Fill the frame with physically believable environmental detail at foreground, midground, and background depth: chipped stone edges, fractured strata, mineral veins, soot stains, ash drifts, dust settled into cracks, rough tool marks, eroded masonry, scorch halos around heat sources, subtle moisture or polished wear where appropriate, and tiny atmospheric particles catching the light. Preserve coherent perspective, grounded gravity, readable scale relationships, and material continuity across every surface.

Use photorealistic lens behavior: natural 2.39:1 cinematic composition unless the workflow is vertical, deep but controlled atmospheric perspective, realistic depth of field, restrained anamorphic character, high dynamic range, natural motion-free stillness, no over-sharpened CGI sheen, no painterly brush texture, no miniature look, no plastic surfaces, no generic fantasy castle shortcuts. Lighting must be physically motivated by visible practical sources, divine shafts, embers, torches, sky glow, or bounce light; every highlight should have a plausible source and every shadow should wrap naturally around form.

Location richness requirement: the environment should be independently useful as a production reference. Include enough readable architecture, terrain, negative space, texture hierarchy, and weathering to support multiple later shots. Avoid empty backgrounds, flat walls, smooth generic floors, duplicated decorative patterns, random symmetry, collage layouts, title text, labels, captions, borders, watermarks, modern objects, modern lighting rigs, and any graphic design elements. If characters or souls are described by the specific asset prompt, keep them secondary to the location geography and integrate them naturally into the physical space.`;

const sharedContinuity = [
  "LOCATION DETAIL LOCK: rich photorealistic live-action production plate with layered foreground, midground, and background; material-rich surfaces; realistic haze; no captions, labels, borders, or collage layout.",
  "HARROWING WORLD CONTINUITY: desert night/dawn, descent shaft, abyss approach, fortress gate, prison chamber, transformed threshold, and staircase of light share the same grounded basalt, obsidian, iron, bone, ash, smoke, and gold-divine-light material language."
];

const locationSpecificity = {
  "loc-hell-abyss-approach": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
This approach plate must clearly bridge the vertical descent shaft and the later fortress entrance. Keep the descending shaft behind or high off-frame as a memory of the entry wound, then carry the eye forward across a cracked basalt causeway toward the distant Hell Gate silhouette. Add repeated scale cues: broken bridge spans, chain anchor pylons, eroded stair cuts, fissures with dull ember interiors, fallen stone blocks partly buried in ash, and low smoke crawling along the ground. The distant gate should be readable but not yet a close-up; the land itself is the subject.`,
  "loc-hell-fortress": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
Design the fortress city as a vast subterranean cathedral-fortress rather than a single door: layered black-stone terraces, broken flying buttresses, bridge ribs, watchtowers, torch niches, ribbed iron arches, smoke-choked courtyards, and cathedral-scale vertical walls disappearing upward into darkness. The composition should show depth through overlapping structures and receding haze, with tiny architectural details that imply ancient labor, imprisonment, and decay without becoming busy collage.`,
  "loc-inner-chamber-dark": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
This is the unredeemed initial state of the prison yard before divine light breaks in. Make the chamber enormous and legible: a 500-by-400-foot underground floor, forty-eight black pillars, chained alcoves, broken galleries, soot-black walls, iron rings embedded in stone, worn paths from centuries of movement, scattered dust, frayed bindings, and cold blue torch pools that reveal detail without warming the scene. The darkness must contain depth, architecture, and human-scale evidence, not empty blackness.`,
  "loc-inner-chamber-transformed": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
This is the same prison geography after rupture and transformation. Preserve the floor plan and pillars from the dark chamber, but show the threshold changed by divine arrival: broken iron and bone gate fragments, golden light spilling through smoke, ash lifting from the floor, chains slack or shattered, black stone beginning to reveal pale mineral veining, old soot washed by warm illumination, and shadow pockets retreating into the edges. It should feel like a physical set mid-transfiguration, not an abstract glow effect.`,
  "loc-staircase-of-light": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
The staircase must read as a usable location with depth and scale, not only a beam of light. Build luminous steps from white-gold radiance interacting with real stone edges, broken threshold rubble, floating dust, soft cloudlike vapor, distant upper opening, and receding perspective lines that pull upward toward freedom. Keep the base grounded in Hell's shattered stone and the top dissolving into dawn-like heavenly brightness, with believable bloom and exposure rolloff rather than pure white clipping.`
  ,
  "loc-fissure-shaft": `ADDITIONAL LOCATION SPECIFICITY
-------------------------------
The vertical fissure shaft must be readable as the physical connector between the Judean desert surface and the underworld descent. Keep the form cylindrical but naturally broken, with fractured limestone at the top giving way to black obsidian walls, ember veins, dust shelves, heat shimmer, vertical scrape marks, and ancient face-like reliefs pressed shallowly into stone. Emphasize terrifying depth through stacked haze layers, falling particles, diminishing light, and repeated ledges or cracks that vanish into darkness.`
};

function parseQuotedCsvLine(line) {
  const values = [];
  const matcher = /"((?:[^"]|"")*)"(?:,|$)/g;
  let match;
  while ((match = matcher.exec(line)) !== null) values.push(match[1].replace(/""/g, '"'));
  return values;
}

function quoteCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function loadIndex() {
  const lines = fs.readFileSync(indexPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseQuotedCsvLine(lines.shift() || "");
  const rows = lines.map((line) => {
    const values = parseQuotedCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
  return { headers, rows };
}

function saveIndex(headers, rows) {
  const csv = [headers.map(quoteCsv).join(",")];
  for (const row of rows) csv.push(headers.map((header) => quoteCsv(row[header])).join(","));
  fs.writeFileSync(indexPath, `${csv.join("\n")}\n`, "utf8");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function resolvePackageFile(relativePath) {
  const normalized = String(relativePath || "").replaceAll("/", path.sep);
  const resolved = path.resolve(packageRoot, normalized);
  if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside the authoritative package: ${relativePath}`);
  }
  return resolved;
}

function latestRichVersionPrompt(asset) {
  return [...(asset.versions || [])]
    .map((version) => String(version.prompt || ""))
    .filter((prompt) => prompt.length > 1200)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function promptFromWorkflow(file) {
  if (!file || !fs.existsSync(file)) return "";
  const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  const node = workflow["6"];
  return String(node?.inputs?.text || "");
}

function insertDetailLock(prompt) {
  if (prompt.includes("RICH PHOTOREALISTIC LOCATION DETAIL LOCK")) return prompt;
  const pattern = /Photorealistic live-action production reference[^\n]*\n\n/;
  if (pattern.test(prompt)) return prompt.replace(pattern, (match) => `${match}${detailLock}\n\n`);
  return `${detailLock}\n\n${prompt}`;
}

function enrichPrompt(asset, row) {
  const assetId = asset?.id || row.asset_id;
  const candidates = [
    String(asset?.prompt || ""),
    asset ? latestRichVersionPrompt(asset) : "",
    promptFromWorkflow(resolvePackageFile(row.max_workflow_snapshot)),
    promptFromWorkflow(resolvePackageFile(row.native_workflow_snapshot))
  ].map((prompt) => prompt.replace(/\r\n/g, "\n").trim());
  let prompt = candidates.sort((a, b) => b.length - a.length)[0] || "";
  prompt = insertDetailLock(prompt);
  const addition = locationSpecificity[assetId];
  if (addition && !prompt.includes("ADDITIONAL LOCATION SPECIFICITY")) {
    prompt = `${prompt}\n\n${addition}`;
  }
  return prompt.trim();
}

function patchWorkflowPrompt(file, prompt) {
  const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  let touched = false;
  for (const node of Object.values(workflow)) {
    if (node?.class_type === "CLIPTextEncode" && node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, "text")) {
      node.inputs.text = prompt;
      touched = true;
    }
  }
  if (!touched) throw new Error(`No CLIPTextEncode text node found in ${file}`);
  fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

const { headers, rows } = loadIndex();
const rowByAssetId = new Map(rows.map((row) => [row.asset_id, row]));
const assets = project.assets?.items || [];
const assetById = new Map(assets.map((asset) => [asset.id, asset]));
const locationRows = rows.filter((row) => row.category === "location");
const projectLocationAssets = assets.filter((asset) => asset.category === "location");
const locationIds = Array.from(new Set([
  ...projectLocationAssets.map((asset) => asset.id),
  ...locationRows.map((row) => row.asset_id)
]));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "production", "location-prompt-upgrade", timestamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(path.join(root, "project.json"), path.join(backupDir, "project.before.json"));
fs.copyFileSync(indexPath, path.join(backupDir, "ASSET_WORKFLOW_INDEX.before.csv"));

let changed = 0;
const report = [];
for (const id of locationIds) {
  const asset = assetById.get(id) || null;
  const row = rowByAssetId.get(id);
  if (!row) throw new Error(`Location asset is missing from authoritative index: ${id}`);
  const maxFile = resolvePackageFile(row.max_workflow_snapshot);
  const nativeFile = resolvePackageFile(row.native_workflow_snapshot);
  fs.copyFileSync(maxFile, path.join(backupDir, `${id}.max.before.json`));
  fs.copyFileSync(nativeFile, path.join(backupDir, `${id}.native.before.json`));

  const beforeChars = String(asset?.prompt || promptFromWorkflow(maxFile)).length;
  const prompt = enrichPrompt(asset, row);
  if (asset) {
    asset.prompt = prompt;
    asset.continuity = Array.from(new Set([...(asset.continuity || []), ...sharedContinuity]));
    asset.approval = null;
    asset.updatedAt = new Date().toISOString();
  }

  patchWorkflowPrompt(maxFile, prompt);
  patchWorkflowPrompt(nativeFile, prompt);
  const projectMaxFile = path.join(root, row.max_workflow_snapshot.replaceAll("/", path.sep));
  const projectNativeFile = path.join(root, row.native_workflow_snapshot.replaceAll("/", path.sep));
  if (fs.existsSync(projectMaxFile)) patchWorkflowPrompt(projectMaxFile, prompt);
  if (fs.existsSync(projectNativeFile)) patchWorkflowPrompt(projectNativeFile, prompt);
  row.max_workflow_hash = sha256File(maxFile);
  row.native_workflow_hash = sha256File(nativeFile);
  changed += 1;

  report.push({
    id,
    inProject: Boolean(asset),
    beforeChars,
    afterChars: prompt.length,
    maxWorkflowHash: row.max_workflow_hash,
    nativeWorkflowHash: row.native_workflow_hash
  });
}

saveIndex(headers, rows);

const enhancedDir = path.join(root, "production", "prompt-enhancement", "enhanced");
let enhancedSynchronized = 0;
if (fs.existsSync(enhancedDir)) {
  for (const asset of projectLocationAssets) {
    const file = path.join(enhancedDir, `${asset.id}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const enhanced = JSON.parse(fs.readFileSync(file, "utf8"));
      enhanced.prompt = asset.prompt;
      enhanced.promptHeader = asset.promptHeader;
      enhanced.updatedAt = new Date().toISOString();
      fs.writeFileSync(file, `${JSON.stringify(enhanced, null, 2)}\n`, "utf8");
      enhancedSynchronized += 1;
    } catch {
      // Leave malformed enhancement artifacts alone; the project prompt is authoritative.
    }
  }
}

project.assets.generatedAt = new Date().toISOString();
project.updatedAt = new Date().toISOString();
// Import after saving the authoritative index, because the style-lock module
// validates workflow hashes at module-load time.
const { saveAssetPackageFiles } = await import("../server/assets.js");
saveAssetPackageFiles(project);
saveProject(project);

const reportPath = path.join(root, "production", "location-prompt-upgrade-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify({
  upgradedAt: new Date().toISOString(),
  project: slug,
  changed,
  enhancedSynchronized,
  backup: path.relative(root, backupDir).replace(/\\/g, "/"),
  report
}, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({ changed, enhancedSynchronized, backupDir, reportPath, report }, null, 2)}\n`);
