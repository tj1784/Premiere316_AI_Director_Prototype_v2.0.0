import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
function option(name) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
const planPath = option("--plan");
const framesPath = option("--frames");
if (!planPath || !framesPath) throw new Error("Usage: node scripts/import-prodigal-frames.mjs --plan /path/all_shots.json --frames /path/prodigal_frames [--allow-partial]");
const allowPartial = argv.includes("--allow-partial");
const frameRoot = resolve(framesPath);
const publicRoot = resolve(appRoot, "public/pictures/prodigal-son");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
if (!Array.isArray(plan) || !plan.length) throw new Error("Shot plan must be a nonempty array.");
const scenes = JSON.parse(await readFile(resolve(publicRoot, "scene_metadata.json"), "utf8"));
const narrative = scenes.filter((scene) => scene.id !== "PS-S23");
const sceneIds = new Set(narrative.map((scene) => scene.id));
const ids = new Set();
const totals = new Map();
for (const shot of plan) {
  if (Array.isArray(shot.dialogue_coverage)) {
    shot.dialogue_lines = shot.dialogue_coverage;
    shot.dialogue_coverage = shot.dialogue_coverage.map((line) => typeof line === "string" ? line : `${line.character}: ${line.text}`).join("\n");
  }
  if (!/^PS-S\d{2}-SH\d{3}$/.test(shot.id) || ids.has(shot.id)) throw new Error(`Invalid/duplicate shot ID: ${shot.id}`);
  if (!sceneIds.has(shot.scene_id) || !shot.id.startsWith(`${shot.scene_id}-`)) throw new Error(`Unknown or mismatched scene: ${shot.id}`);
  if (!Number.isFinite(shot.duration_seconds) || shot.duration_seconds <= 0) throw new Error(`Invalid duration: ${shot.id}`);
  for (const field of ["title", "camera_motion", "first_frame", "last_frame"]) if (typeof shot[field] !== "string" || !shot[field].trim()) throw new Error(`Missing ${field}: ${shot.id}`);
  if (typeof shot.dialogue_coverage !== "string") throw new Error(`Invalid dialogue coverage: ${shot.id}`);
  for (const field of ["visible_character_asset_ids", "reference_filenames", "continuity_locks"]) if (!Array.isArray(shot[field])) throw new Error(`Missing ${field}: ${shot.id}`);
  if (!Number.isFinite(shot.lens_mm) || shot.lens_mm <= 0) throw new Error(`Invalid lens: ${shot.id}`);
  ids.add(shot.id); totals.set(shot.scene_id, (totals.get(shot.scene_id) ?? 0) + shot.duration_seconds);
}
for (const scene of narrative) if (totals.get(scene.id) !== scene.duration_seconds) throw new Error(`Scene ${scene.id} duration is ${totals.get(scene.id) ?? 0}; expected ${scene.duration_seconds}.`);
const copies = [];
const shots = [];
const missing = [];
const dimensionWarnings = [];
for (const source of plan) {
  const frames = {};
  for (const kind of ["first", "last"]) {
    const name = `${source.id}_${kind.toUpperCase()}.png`;
    let input = resolve(frameRoot, source.scene_id, name);
    try { await access(input); } catch {
      const reuse = source.reuse_from_shot ?? source.source_shot_id ?? source.memory_reuse?.source_shot_id;
      if (reuse && ids.has(reuse)) input = resolve(frameRoot, reuse.slice(0, 6), `${reuse}_${kind.toUpperCase()}.png`);
    }
    let bytes;
    try { bytes = await readFile(input); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(`${source.id}:${kind}`); continue;
    }
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`Not a PNG: ${input}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height) throw new Error(`Invalid PNG dimensions: ${input}`);
    const hash = sha256(bytes);
    // Each revision owns immutable bytes so older frame selections stay valid.
    const publishedName = `${source.id}_${kind.toUpperCase()}-${hash.slice(0, 12)}.png`;
    frames[kind] = { mediaUri: `/pictures/prodigal-son/frames/${source.scene_id}/${publishedName}`, sha256: hash, bytes: bytes.length, width, height };
    copies.push({ input, target: resolve(publicRoot, "frames", source.scene_id, publishedName), expectedHash: hash });
  }
  if (frames.first && frames.last && (frames.first.width !== frames.last.width || frames.first.height !== frames.last.height)) dimensionWarnings.push({ shotId: source.id, first: [frames.first.width, frames.first.height], last: [frames.last.width, frames.last.height], note: "Original pixels preserved; video preparation must normalize canvas dimensions." });
  shots.push({ ...source, frames });
}
if (missing.length && !allowPartial) throw new Error(`${missing.length} frames are missing. No files were changed. First missing: ${missing.slice(0, 8).join(", ")}. Use --allow-partial only for an incremental import.`);
const assetCorrections = [];
const correctionReasons = {
  "PS-WAR-BESTROBE": "Replace the modern bathrobe details with the user-requested first-century restoration robe.",
  "PS-PRP-RING": "Replace the engraved title lettering with a plain period ring.",
  "PS-WAR-NEWSANDALS": "Replace the modern buckles and soles with plausible first-century leather sandals.",
  "PS-LOC-JOURNEY": "Preserve the selected ridge-fork journey reference while correcting the mislabeled companion terrace location.",
  "PS-LOC-RETURNSHELTER": "Preserve the selected return-route shelter reference while correcting the mislabeled companion roadside cistern location.",
  "PS-LOC-SUPPER": "Use the latest corrected supper-room reference with exactly two clay oil lamps, matching the scene continuity.",
  "PS-LOC-FEAST": "Use the latest corrected afternoon feast courtyard with unlit lamps, matching the homecoming preparation state.",
  "PS-LOC-FAMINE": "Use the latest famine-market reference that retains the stocked market's exact street layout.",
  "PS-LOC-TERRACE": "Restore the selected slumped terrace wall reference; the previous assignment showed the journey fork.",
  "PS-LOC-COURTYARD": "Restore the selected family courtyard reference; the previous assignment showed the cistern view.",
  "PS-LOC-CISTERN": "Use the selected home courtyard cistern reference to match the generated scene geography.",
  "PS-LOC-PEN": "Use the selected Judean home cattle pen reference to preserve its distinction from the foreign pig farm.",
  "PS-LOC-ROADCISTERN": "Restore the selected roadside cistern reference; the previous assignment showed the return-route shelter.",
  "PS-LOC-BANQUET": "Use the selected foreign tavern courtyard reference matching the generated banquet scenes.",
  "PS-LOC-PIGFARM": "Restore the selected foreign pig enclosure reference; the previous assignment showed the home cattle pen.",
};
for (const [assetId, reason] of Object.entries(correctionReasons)) {
  const input = resolve(frameRoot, "asset_corrections", `${assetId}.png`);
  let bytes;
  try { bytes = await readFile(input); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`Not a PNG: ${input}`);
  const hash = sha256(bytes);
  const name = `${assetId}-${hash.slice(0, 12)}.png`;
  assetCorrections.push({ assetId, reason, media: { mediaUri: `/pictures/prodigal-son/generated-assets/corrections/${name}`, sha256: hash, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } });
  copies.push({ input, target: resolve(publicRoot, "generated-assets/corrections", name), expectedHash: hash });
}
const frameCount = shots.reduce((sum, shot) => sum + Object.keys(shot.frames).length, 0);
const revision = sha256(JSON.stringify({ shots, assetCorrections }));
const manifest = {
  schemaVersion: 1,
  packageId: "prodigal-son-first-last-20260911",
  pictureId: "pic_prodigal_son_20260909",
  revision,
  sourceCommit: "5d25b6674b16d93ce809b93ef8749740135ba4f6",
  screenplayVersionId: "pic_prodigal_son_20260909:user-directed-opening:v2",
  aspectRatio: "2.39:1", frameRate: 24,
  storyDurationSeconds: narrative.reduce((sum, scene) => sum + scene.duration_seconds, 0), creditsSeconds: 30,
  createdAt: 1789084800000,
  authorization: { source: "user", scope: "direct-first-last-frame-import", note: "User explicitly requested the first/last frames be added directly to the app and waived approval pauses for this work. Canonical selection records this direction, not an invented visual QA pass." },
  assetCorrections,
  shots,
};
// Validate the whole package before writing. No generated media is fabricated for missing files.
for (const { input, target, expectedHash } of copies) {
  await mkdir(dirname(target), { recursive: true });
  try {
    if (sha256(await readFile(target)) !== expectedHash) throw new Error(`Immutable media path collision: ${target}`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await copyFile(input, target);
  if (sha256(await readFile(target)) !== expectedHash) throw new Error(`Copy verification failed: ${target}`);
}
const json = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(resolve(publicRoot, "first-last-frame-manifest.json"), json);
await writeFile(resolve(appRoot, "src/lib/studio/bundled-pictures/prodigal-son/frames.ts"), `import type { ProdigalFrameManifest } from "../../prodigal-frame-types.ts";\n\n// Generated by scripts/import-prodigal-frames.mjs; source images are SHA-256 verified.\nexport const PRODIGAL_SON_FRAMES: ProdigalFrameManifest = ${JSON.stringify(manifest, null, 2)};\n`);
await writeFile(resolve(publicRoot, "first-last-frame-import-status.json"), `${JSON.stringify({ revision, shots: shots.length, importedFrames: frameCount, assetCorrections: assetCorrections.length, requiredFrames: shots.length * 2, missingFrames: missing, dimensionWarnings, complete: missing.length === 0 }, null, 2)}\n`);
console.log(JSON.stringify({ shots: shots.length, frames: frameCount, assetCorrections: assetCorrections.length, requiredFrames: shots.length * 2, missing: missing.length, dimensionWarnings: dimensionWarnings.length, revision }));
