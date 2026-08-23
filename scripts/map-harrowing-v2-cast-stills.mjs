import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadProject, saveProject } from "../server/projects.js";
import { updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";
const CAST_DIR = "imported/20260823T205250Z-cast-map-assets/characters";
const CAST_ABS = path.join(projectDir(SLUG), "media", "assets", CAST_DIR);

const FILES = {
  "001": "001-grok-4b10066d-36d0-41d7-9f04-9053f748fb05.jpg",
  "002": "002-grok-a5566f8c-bfd1-4b73-a1f9-e89a5b23cd48.jpg",
  "004": "004-grok-57533ba0-64e8-44a7-9272-2ac361148656.jpg",
  "005": "005-grok-b853d027-ef06-446f-8dc2-b6166dbe9047.jpg",
  "006": "006-grok-a0eb7f86-1c85-4e36-b4eb-157e738aac3e.jpg",
  "007": "007-grok-36464401-4977-400d-a1c0-07bdb440bd34.jpg",
  "008": "008-grok-b961157f-2a55-4aae-85d7-0c5a7a7e57f5.jpg",
  "009": "009-grok-4c577b22-af2d-4a32-9a8a-37e5c3667f49.jpg",
  "010": "010-grok-c820e2ff-7f50-410d-8bb7-9740d4fab1ea.jpg",
  "011": "011-grok-4ae0b184-d4ce-4ff1-ba06-6cf62e03c90a.jpg",
  "012": "012-grok-e3a72b65-3996-4a2b-9008-6a7ac5a9cd84.jpg",
  "013": "013-grok-37586a6d-95c1-4cad-8176-b6ed68d8b885.jpg",
  "014": "014-grok-c3272db4-d95b-4842-943e-c224465e92b8.jpg",
  "015": "015-grok-7af0d3fe-ec5b-4bfa-b100-63fc5c02efcc.jpg",
  "016": "016-grok-987d72b5-c161-4fd3-847a-ff29e78ce7b9.jpg",
  "017": "017-grok-18d4c8f1-fbc4-4d67-8674-dff992bfca21.jpg",
  "018": "018-grok-500b78c3-6a76-4b47-a093-a41c3f1b0bfb.jpg",
  "019": "019-grok-ce85edce-2322-4f69-858c-ae6b963c0576.jpg",
  "020": "020-grok-bb2a6f26-0caf-4252-8a59-2f3ba0cdb31f.jpg",
  "021": "021-grok-9cfc753c-1215-41d3-b227-30fb7628415f.jpg",
  "022": "022-grok-d3f73064-f28d-4c48-8871-d83ce2b18333.jpg",
  "023": "023-grok-e1e3d078-cdf5-4e2f-bb43-4b98e1f85f4f.jpg",
  "024": "024-grok-c595c5d0-5dd4-4c2a-8f3b-6204b23f098d.jpg",
  "025": "025-grok-9357b0bd-8115-483d-95ab-cb624c30093c.jpg",
  "026": "026-grok-7ffa3f6b-07d1-40b7-af93-917fdbd0c07c.jpg",
  "027": "027-grok-a76c0014-d6e4-4d61-9d03-954442b55405.jpg",
  "028": "028-grok-fa6c5090-6f2d-4b6a-afab-cb9bc659b9dd.jpg",
  "029": "029-grok-a6fe255f-95c0-4a00-ae70-fb52f4f8a921.jpg",
  "030": "030-grok-1b901b15-6279-4f7e-87fc-b8476dbe584e.jpg",
  "031": "031-grok-816ae634-388f-42e2-b1eb-ea67361deab1.jpg",
  "033": "033-grok-ec99edde-aa1e-49b1-939d-b511e5605a48.jpg",
  "034": "034-grok-4341ef45-358d-4a75-b781-4585acd5abe8.jpg",
  "035": "035-grok-68f4a15a-bd89-4d4a-b7c1-573c1bc5ba45.jpg",
  "036": "036-grok-4284e844-2057-451d-83a6-0dc927314282.jpg",
  "037": "037-grok-7f86ff2f-1532-4b63-b784-97b47f75dd95.jpg",
  "038": "038-grok-78c8c04e-e589-4c8a-9673-041e4ea35c7d.jpg",
  "039": "039-grok-f5014e52-0cd5-4998-a998-d179cd909be9.jpg",
  "040": "040-grok-76fa1b70-60a2-4d88-9787-6c8c5a2e7f29.jpg",
  "041": "041-grok-93950dbd-5432-4dfd-9d1e-d8a6d12aa82e.jpg",
  "042": "042-grok-b5dd6d9b-6cc7-4a92-8057-b4620306c20f.jpg",
  "043": "043-grok-2e9599bf-f3af-47b7-9ea8-6421eb56d978.jpg",
  "044": "044-grok-41bc9533-3031-406c-91bf-b921814d0658.jpg",
  "045": "045-grok-ea703a67-4631-40b8-ae7d-c663667601d7.jpg",
  "047": "047-grok-3e67a5aa-cbe0-4a37-897f-c9e8b8e7254e.jpg",
  "048": "048-grok-778d5030-7468-4f1d-a4d4-3b2d5778ceba.jpg",
  "049": "049-grok-9ad7f93e-8af5-40f9-afd2-631ec5bd90b2.jpg",
  "050": "050-grok-d66430c5-16bd-4c26-a56d-45fc8522d2f9.jpg",
  "051": "051-grok-692aaff0-5af3-4c44-8575-45e9c8de0394.jpg",
  JESUS: "JESUS.jpg"
};

const IDENTITIES = {
  "001": { identity: "DAVID", label: "unlabeled sheet", mappedTo: "character-david-freed-king-appearance" },
  "002": { identity: "JOHN THE BAPTIST", label: "unlabeled sheet", mappedTo: "character-john-the-baptist-appearance" },
  "003": { identity: "JESUS CHRIST", label: "JESUS.jpg five-view spirit form", mappedTo: "character-jesus-christ-primary-appearance" },
  "004": { identity: "JESUS CHRIST", label: "close-up portrait", mappedTo: "character-jesus-christ-close-up" },
  "005": { identity: "SATAN", label: "Lord of the Abyss unlabeled", mappedTo: "character-satan-fallen-prince-appearance" },
  "006": { identity: "FALLEN ANGEL OF THE ABYSS", label: "unlabeled sheet", mappedTo: "character-chief-fallen-spirit-appearance" },
  "007": { identity: "ABRAHAM", label: "unlabeled sheet", mappedTo: "character-abraham-patriarch-freed-appearance" },
  "008": { identity: "ADAM", label: "unlabeled sheet", mappedTo: "character-adam-first-man-freed-appearance" },
  "009": { identity: "DAVID", label: "09_DAVID", mappedTo: "character-david-freed-king-appearance" },
  "010": { identity: "ISAIAH", label: "unlabeled sheet", mappedTo: "character-isaiah-freed-prophet-appearance" },
  "011": { identity: "GENERAL DEMON / LEGION SOLDIER", label: "unlabeled sheet", mappedTo: "extra-guardians" },
  "012": { identity: "SATAN", label: "Accuser unlabeled", mappedTo: "character-satan-fallen-prince-appearance" },
  "013": { identity: "SATAN", label: "02_SATAN_Accuser_Form", mappedTo: "character-satan-fallen-prince-appearance" },
  "014": { identity: "CHAIN JAILER", label: "unlabeled sheet", mappedTo: "extra-demon-remnants" },
  "015": { identity: "JOHN THE BAPTIST", label: "labeled sheet", mappedTo: "character-john-the-baptist-appearance" },
  "016": { identity: "EVE", label: "unlabeled sheet", mappedTo: "character-eve-first-woman-freed-appearance" },
  "017": { identity: "PYRAMID HEAD EXECUTIONER", label: "DEMON 01", mappedTo: "extra-demon-remnants" },
  "018": { identity: "JESUS CHRIST", label: "01_JESUS no crown", mappedTo: "character-jesus-christ-action-pose" },
  "019": { identity: "ABYSSAL GIANT / NEPHILIM WARDEN", label: "DEMON 03", mappedTo: "character-guardian-leader-appearance" },
  "020": { identity: "ABYSSAL GIANT / NEPHILIM WARDEN", label: "unlabeled sheet", mappedTo: "character-guardian-leader-appearance" },
  "021": { identity: "EVE", label: "06_EVE", mappedTo: "character-eve-first-woman-freed-appearance" },
  "022": { identity: "ADAM", label: "05_ADAM", mappedTo: "character-adam-first-man-freed-appearance" },
  "023": { identity: "JESUS CHRIST", label: "01_JESUS crown of thorns", mappedTo: "character-jesus-christ-crucified-body" },
  "024": { identity: "SATAN", label: "03_SATAN_Lord_of_the_Abyss", mappedTo: "character-satan-fallen-prince-appearance" },
  "025": { identity: "TORTURER DEMON", label: "DEMON 07", mappedTo: null },
  "026": { identity: "HADES", label: "04_HADES_Warden_of_Death", mappedTo: "character-hades-warden-of-the-dead-appearance" },
  "027": { identity: "SHADOW DARK SPIRIT", label: "DEMON 02", mappedTo: "extra-fallen-spirits" },
  "028": { identity: "FALLEN ANGEL OF THE ABYSS", label: "unlabeled sheet", mappedTo: "character-chief-fallen-spirit-appearance" },
  "029": { identity: "SHADOW DARK SPIRIT", label: "unlabeled sheet", mappedTo: "extra-fallen-spirits" },
  "030": { identity: "TORTURER DEMON", label: "unlabeled sheet", mappedTo: null },
  "031": { identity: "HADES", label: "04_HADES labeled duplicate", mappedTo: "character-hades-warden-of-the-dead-appearance" },
  "033": { identity: "FALLEN ANGEL OF THE ABYSS", label: "DEMON 09", mappedTo: "character-chief-fallen-spirit-appearance" },
  "034": { identity: "RAG AND BONE LEGIONARY", label: "unlabeled sheet", mappedTo: "extra-demon-remnants" },
  "035": { identity: "RAG AND BONE LEGIONARY", label: "DEMON 05", mappedTo: "extra-demon-remnants" },
  "036": { identity: "WEEPING GUARDIAN", label: "DEMON 06", mappedTo: "extra-guardians" },
  "037": { identity: "PYRAMID HEAD EXECUTIONER", label: "unlabeled sheet", mappedTo: "extra-demon-remnants" },
  "038": { identity: "ABRAHAM", label: "07_ABRAHAM", mappedTo: "character-abraham-patriarch-freed-appearance" },
  "039": { identity: "SATAN", label: "03_SATAN labeled duplicate", mappedTo: "character-satan-fallen-prince-appearance" },
  "040": { identity: "CHAIN JAILER", label: "DEMON 04", mappedTo: "extra-demon-remnants" },
  "041": { identity: "JESUS CHRIST", label: "five-view gray studio", mappedTo: "character-jesus-christ-primary-appearance" },
  "042": { identity: "SATAN", label: "02_SATAN_Accuser_Form", mappedTo: "character-satan-fallen-prince-appearance" },
  "043": { identity: "ABRAHAM", label: "unlabeled sheet", mappedTo: "character-abraham-patriarch-freed-appearance" },
  "044": { identity: "HADES", label: "unlabeled sheet", mappedTo: "character-hades-warden-of-the-dead-appearance" },
  "045": { identity: "WEEPING GUARDIAN", label: "unlabeled sheet", mappedTo: "extra-guardians" },
  "047": { identity: "ISAIAH", label: "10_ISAIAH", mappedTo: "character-isaiah-freed-prophet-appearance" },
  "048": { identity: "MOSES", label: "08_MOSES", mappedTo: "character-moses-freed-prophet-appearance" },
  "049": { identity: "GENERAL DEMON / LEGION SOLDIER", label: "unlabeled sheet", mappedTo: "extra-guardians" },
  "050": { identity: "TORTURER DEMON", label: "12_TORTURER_DEMON", mappedTo: null },
  "051": { identity: "GENERAL DEMON / LEGION SOLDIER", label: "DEMON 08", mappedTo: "extra-guardians" }
};

const ATTACH = [
  { assetId: "character-jesus-christ-primary-appearance", fileKey: "JESUS", note: "Director-flagged JESUS.jpg five-view spirit form. No crown. Barefoot white linen of light." },
  { assetId: "character-jesus-christ-close-up", fileKey: "004", note: "Director-flagged 004 close-up. Same face as JESUS.jpg." },
  { assetId: "character-jesus-christ-action-pose", fileKey: "018", note: "01_JESUS_CHRIST labeled sheet, no crown, full-body and expression lock." },
  { assetId: "character-jesus-christ-crucified-body", fileKey: "023", note: "01_JESUS_CHRIST labeled sheet with crown of thorns. Crown stays on the corpse only." },
  { assetId: "character-adam-first-man-freed-appearance", fileKey: "022", note: "05_ADAM labeled sheet." },
  { assetId: "character-eve-first-woman-freed-appearance", fileKey: "021", note: "06_EVE labeled sheet." },
  { assetId: "character-abraham-patriarch-freed-appearance", fileKey: "038", note: "07_ABRAHAM labeled sheet." },
  { assetId: "character-moses-freed-prophet-appearance", fileKey: "048", note: "08_MOSES labeled sheet." },
  { assetId: "character-david-freed-king-appearance", fileKey: "009", note: "09_DAVID labeled sheet." },
  { assetId: "character-isaiah-freed-prophet-appearance", fileKey: "047", note: "10_ISAIAH labeled sheet." },
  { assetId: "character-john-the-baptist-appearance", fileKey: "015", note: "Labeled John the Baptist sheet." },
  { assetId: "character-hades-warden-of-the-dead-appearance", fileKey: "026", note: "04_HADES_Warden_of_Death. Not Satan." },
  { assetId: "character-satan-fallen-prince-appearance", fileKey: "024", note: "03_SATAN_Lord_of_the_Abyss winged form." },
  { assetId: "character-satan-fallen-prince-appearance", fileKey: "042", note: "02_SATAN_Accuser_Form hooded humanoid form." },
  { assetId: "character-guardian-leader-appearance", fileKey: "019", note: "DEMON 03 Abyssal Giant / Nephilim Warden as fortress commander." },
  { assetId: "character-chief-fallen-spirit-appearance", fileKey: "033", note: "DEMON 09 Fallen Angel of the Abyss." },
  { assetId: "extra-guardians", fileKey: "051", note: "DEMON 08 General Demon / Legion Soldier." },
  { assetId: "extra-guardians", fileKey: "036", note: "DEMON 06 Weeping Guardian." },
  { assetId: "extra-demon-remnants", fileKey: "035", note: "DEMON 05 Rag and Bone Legionary." },
  { assetId: "extra-demon-remnants", fileKey: "017", note: "DEMON 01 Pyramid Head Executioner." },
  { assetId: "extra-demon-remnants", fileKey: "040", note: "DEMON 04 Chain Jailer." },
  { assetId: "extra-fallen-spirits", fileKey: "033", note: "DEMON 09 Fallen Angel of the Abyss." },
  { assetId: "extra-fallen-spirits", fileKey: "027", note: "DEMON 02 Shadow Dark Spirit." }
];

function nextVersion(asset) {
  const versions = Array.isArray(asset.versions) ? asset.versions : [];
  return versions.reduce((max, version) => Math.max(max, Number(version.v) || 0), 0) + 1;
}

function hashFile(absPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function pushUnique(list, value) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (value && !next.includes(value)) next.push(value);
  return next;
}

const project = loadProject(SLUG);
const items = project.assets?.items || [];
const byId = new Map(items.map((item) => [item.id, item]));
const now = new Date().toISOString();

const zip003 = byId.get("zip-characters-003-1cc9cd88");
if (zip003?.versions?.[0]) {
  const jesusRel = `${CAST_DIR}/JESUS.jpg`;
  const jesusAbs = path.join(CAST_ABS, "JESUS.jpg");
  const jesusHash = hashFile(jesusAbs);
  zip003.versions[0].file = jesusRel;
  zip003.versions[0].files = [jesusRel];
  zip003.versions[0].sourceZipEntry = "JESUS.jpg";
  zip003.versions[0].fileHashes = [{
    file: jesusRel,
    sha256: jesusHash,
    bytes: fs.statSync(jesusAbs).size,
    extension: ".jpg"
  }];
  zip003.updatedAt = now;
}

const attached = [];
for (const row of ATTACH) {
  const asset = byId.get(row.assetId);
  if (!asset) throw new Error(`Missing library asset ${row.assetId}`);
  const filename = FILES[row.fileKey];
  if (!filename) throw new Error(`Unknown file key ${row.fileKey}`);
  const abs = path.join(CAST_ABS, filename);
  if (!fs.existsSync(abs)) throw new Error(`Missing still ${abs}`);
  const rel = `${CAST_DIR}/${filename}`;
  const already = (asset.versions || []).some((version) => version.file === rel || (version.files || []).includes(rel));
  if (already) {
    attached.push({ assetId: row.assetId, file: filename, skipped: "already attached" });
    continue;
  }
  const version = nextVersion(asset);
  const sha256 = hashFile(abs);
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
    sourceFileName: filename,
    castMapNote: row.note,
    fileHashes: [{
      file: rel,
      sha256,
      bytes: fs.statSync(abs).size,
      extension: ".jpg"
    }],
    createdAt: now
  });
  asset.activeVersion = version;
  asset.status = "generated";
  asset.approval = null;
  asset.approvalCurrent = false;
  asset.lastError = null;
  asset.updatedAt = now;
  asset.continuity = pushUnique(asset.continuity, `CAST MAP ${now.slice(0, 10)}: ${row.note}`);
  asset.continuity = pushUnique(asset.continuity, "Embedded titles and labels are editorial metadata only and must never appear inside generated film frames.");
  attached.push({ assetId: row.assetId, name: asset.name, variant: asset.variant, version, file: filename, note: row.note });
}

const renamed = [];
for (const item of items) {
  const match = String(item.id || "").match(/^zip-characters-(\d{3})-/);
  if (!match) continue;
  const key = match[1];
  const identity = IDENTITIES[key];
  if (!identity) continue;
  item.name = identity.identity;
  item.variant = `${key} ${identity.label}`.slice(0, 120);
  item.continuity = pushUnique(item.continuity, identity.mappedTo
    ? `Mapped onto library asset ${identity.mappedTo}.`
    : "Identified cast still with no dedicated library character slot.");
  item.updatedAt = now;
  renamed.push({ id: item.id, name: item.name, variant: item.variant, mappedTo: identity.mappedTo });
}

updateAssetManifestCounts(project.assets);
saveProject(project);
const manifestPath = path.join(projectDir(SLUG), "production", "asset-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(project.assets, null, 2));

const report = {
  ok: true,
  attachedCount: attached.filter((row) => !row.skipped).length,
  renamedCount: renamed.length,
  unmappedLibrary: [
    "character-mary-mother-of-jesus-appearance",
    "character-john-beloved-disciple-appearance",
    "character-mary-magdalene-appearance",
    "character-the-repentant-thief-appearance",
    "character-the-centurion-appearance",
    "character-michael-the-archangel-appearance",
    "character-enoch-appearance",
    "character-elijah-appearance",
    "character-the-unrepentant-thief-appearance",
    "character-the-wine-sponge-soldier-appearance"
  ],
  attached,
  renamed
};
const reportPath = path.join(projectDir(SLUG), "production", "CAST_STILL_MAP.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
