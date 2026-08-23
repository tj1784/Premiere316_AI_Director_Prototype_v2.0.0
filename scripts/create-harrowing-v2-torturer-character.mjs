import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadProject, saveProject } from "../server/projects.js";
import { createDirectorAsset, updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";
const CAST_DIR = "imported/20260823T205250Z-cast-map-assets/characters";
const CAST_ABS = path.join(projectDir(SLUG), "media", "assets", CAST_DIR);

const STILLS = [
  {
    file: "050-grok-d66430c5-16bd-4c26-a56d-45fc8522d2f9.jpg",
    note: "12_TORTURER_DEMON labeled identity sheet. Active lock."
  },
  {
    file: "025-grok-9357b0bd-8115-483d-95ab-cb624c30093c.jpg",
    note: "DEMON 07 - TORTURER DEMON labeled sheet. Same face and costume."
  },
  {
    file: "030-grok-1b901b15-6279-4f7e-87fc-b8476dbe584e.jpg",
    note: "Unlabeled torturer duplicate sheet."
  }
];

const PROMPT = `TORTURER DEMON — APPEARANCE: FOUR-VIEW IDENTITY, ANATOMY, COSTUME, AND CONTINUITY REFERENCE.

Create a four-view cinematic character ingredients sheet showing the same person in frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume construction, body proportions, hands, scars, wounds, and carried props across every panel. One face exists only on the front of the head. Photorealistic live-action production reference, physically coherent lighting, exact anatomy, clean hands, consistent scale and materials, no captions, no logos, no watermarks, no borders, and no written or graphical elements.

Photorealistic live-action biblical-epic production reference for the Torturer Demon of Hades, a speaking pit-worker who raises a hooked instrument over a bound soul in the Upper Vault. He is a gaunt, elderly male infernal humanoid of medium height, wasted and wiry rather than gigantic. The skull is long and bony, with a receding hairline, wet stringy gray-black hair hanging in thin strands, pointed elf-like ears, and a cruel, knowing smile that can become a cackle. The skin is gray-ash, deeply wrinkled, scarred, and glazed as if permanently damp. Eyes are small, pale, and gleeful. The same face must remain locked in every panel.

Costume is a ragged, layered dark-gray and brown prison-keeper robe, torn at the hems, soaked and stained, with hanging chains across the chest and a chain harness across the back. The garment is not plate armor and not royal. Bare or wrapped lower legs, rough dark boots. Hands are long-fingered, veined, and stained. He may carry a hooked iron instrument, but the hook is a prop, not part of the body.

This character is not Hades, not Satan, not the Guardian Leader, and not a rank-and-file legion soldier. He is a specialist of cruelty in the vault. When holy light strikes him, the manifested body burns to ash; until that moment the identity remains this exact gaunt, pointed-eared, chain-draped torturer.

Panel one is a frontal three-quarter portrait from the upper chest. Panel two is a full-body standing view. Panel three is a precise side profile. Panel four is the rear head and upper torso, showing only hair, ears from behind, and the back chain harness — never a rear face.

Lighting is cold stone-vault key with restrained ember fill. Palette is ash, wet rag, tarnished iron, and dried blood. Photoreal skin, fabric, and chain physics. No text, logos, watermarks, borders, or captions.`;

const project = loadProject(SLUG);
const existing = project.assets.items.find((item) => item.id === "character-torturer-demon-appearance")
  || project.assets.items.find((item) => item.category === "character" && /^TORTURER DEMON$/i.test(item.name) && !String(item.id).startsWith("zip-"));

const asset = existing || createDirectorAsset({
  category: "character",
  name: "TORTURER DEMON",
  variant: "Appearance",
  workflowId: "ci-flux2-p316-style-only-4x3-max",
  prompt: PROMPT,
  continuity: [
    "Gaunt pointed-eared vault specialist; not Hades, not Satan, not the Guardian Leader.",
    "Ragged chain-draped robe, wet stringy hair, cruel smile, hooked instrument.",
    "Manifested body burns to ash in the Upper Vault light-blast; spirit is hurled down, form is gone.",
    "Embedded titles and labels are editorial metadata only and must never appear inside generated film frames."
  ]
}, project.assets.items);

if (!existing) {
  asset.sourceAssetId = "char-torturer";
  project.assets.items.push(asset);
}

const now = new Date().toISOString();
const attached = [];
for (const still of STILLS) {
  const abs = path.join(CAST_ABS, still.file);
  if (!fs.existsSync(abs)) throw new Error(`Missing still ${abs}`);
  const rel = `${CAST_DIR}/${still.file}`;
  if ((asset.versions || []).some((version) => version.file === rel)) {
    attached.push({ file: still.file, skipped: "already attached" });
    continue;
  }
  const version = (asset.versions || []).reduce((max, item) => Math.max(max, Number(item.v) || 0), 0) + 1;
  asset.versions = asset.versions || [];
  asset.versions.push({
    v: version,
    files: [rel],
    file: rel,
    mediaType: "image",
    workflowId: "external-user-supplied",
    model: "user-supplied-cast-map",
    prompt: asset.prompt,
    provenanceType: "cast-map-attach",
    sourceFileName: still.file,
    castMapNote: still.note,
    fileHashes: [{
      file: rel,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"),
      bytes: fs.statSync(abs).size,
      extension: ".jpg"
    }],
    createdAt: now
  });
  attached.push({ file: still.file, version, note: still.note });
}

const labeled = asset.versions.find((version) => String(version.sourceFileName || "").startsWith("050-"));
asset.activeVersion = labeled?.v || asset.versions[asset.versions.length - 1].v;
asset.status = "generated";
asset.approval = null;
asset.approvalCurrent = false;
asset.updatedAt = now;

for (const zipId of ["zip-characters-025-3dac86d0", "zip-characters-030-1e0c7828", "zip-characters-050-c50e70e1"]) {
  const zip = project.assets.items.find((item) => item.id === zipId);
  if (!zip) continue;
  zip.continuity = Array.from(new Set([...(zip.continuity || []).filter((line) => !String(line).includes("no dedicated library")), `Mapped onto library asset ${asset.id}.`]));
  zip.updatedAt = now;
}

updateAssetManifestCounts(project.assets);
saveProject(project);
fs.writeFileSync(path.join(projectDir(SLUG), "production", "asset-manifest.json"), JSON.stringify(project.assets, null, 2));

const reportPath = path.join(projectDir(SLUG), "production", "CAST_STILL_MAP.json");
let report = {};
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
report.torturer = {
  created: !existing,
  id: asset.id,
  name: asset.name,
  variant: asset.variant,
  activeVersion: asset.activeVersion,
  attached
};
report.unmappedLibrary = (report.unmappedLibrary || []).filter((id) => id !== asset.id);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  created: !existing,
  id: asset.id,
  status: asset.status,
  activeVersion: asset.activeVersion,
  versions: asset.versions.map((version) => ({ v: version.v, file: version.file })),
  attached
}, null, 2));
