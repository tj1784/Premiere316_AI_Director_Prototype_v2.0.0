import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject } from "../server/projects.js";
import { updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";
const special = {
  1: "Mary supported by two mourners after the death of Jesus",
  2: "Jesus spirit-form identity sheet — side, front and face studies",
  3: "Alternate Jesus spirit-form identity sheet with expression studies",
  4: "Jesus descending through black spiritual darkness",
  5: "Winged hooded Accuser grinning in frontal close-up",
  6: "Winged Satan reaching toward camera from black robes",
  7: "Accuser taunting Jesus with embedded subtitle reference",
  8: "Hooded winged Satan portrait with raised clawed hand",
  9: "Accuser smiling beneath black hood and folded wings",
  10: "Hooded Satan gesturing with Golgotha behind him",
  11: "Accuser laughing inside a ruined infernal chamber",
  12: "Satan reaching forward while Jesus approaches behind him",
  13: "Accuser confronting camera with Jesus in the distant corridor",
  14: "Satan taunt composition with embedded subtitle reference",
  15: "Five-view Jesus spirit-form body and wardrobe reference",
  16: "Warm golden close-up portrait of Jesus before descent",
  17: "Hooded winged Satan with predatory grin",
  18: "Symmetrical Accuser portrait framed by black wings",
  19: "Satan taunt composition with text overlay reference",
  20: "Hooded Accuser reaching from a dark ruined chamber",
  21: "Satan gesturing beneath a distant Golgotha cross",
  22: "Accuser smiling with Jesus standing behind him",
  23: "Hooded Satan beside a distant cross in blue-black ruins",
  24: "Accuser motion reference — hooded taunt shot",
  25: "Two chained fallen angels suspended above a blue abyss",
  26: "Duplicate chained fallen-angels confrontation reference",
  27: "Winged Watchers chained to opposing abyss walls",
  28: "Falling spirits between chained fallen angels",
  29: "Two chained Watchers holding an abyssal barrier",
  30: "Fallen angels encircling a spiral pit",
  31: "Three Watchers beneath a cold overhead shaft",
  32: "Fallen angel tribunal gathered in cavern darkness",
  33: "Rank of armored fallen angels across a blue-black chasm",
  34: "Alternate Watcher lineup with a central chained leader",
  35: "Fallen angel council assembled around the abyss",
  36: "Crowded Watcher formation in a narrow vertical cavern",
  37: "Named principal Watchers lineup reference",
  38: "Named fallen-angel ensemble lineup across the lower abyss",
  39: "Winged prisoners gathered around a dark central void",
  40: "Two fallen angels facing each other in chains",
  41: "Armored Watchers crowding an abyssal passage",
  42: "Fallen angel council before a sealed stone gate",
  73: "Horned demons presiding over a mound of condemned bodies",
  74: "Duplicate horned tormentors over a corpse heap",
  75: "Demon warden watching an ember-lit cavern of bodies",
  76: "Horned demon seated above a ruined soul field",
  77: "Horned warden in a cold cavern of the dead",
  78: "Wide infernal valley with watchers and red fortress",
  79: "Horned demon profile above a burning stronghold",
  80: "Dead forest surrounding a field of tormented bodies",
  81: "Empty corpse-lined cavern route beneath cold light",
  82: "Prisoner procession crossing a ruined infernal chamber",
  83: "Horned demon overlooking a vast field of bodies",
  84: "Hunched prisoner facing the red citadel of hell",
  85: "Mass of screaming souls around a crowned demonic figure",
  86: "Hell texture board — faces, hands, caverns and fire basins",
  87: "Tormented faces packed around a central horned warden",
  88: "Hell concept board — tunnels, bodies, fire and faces",
  89: "Hell environment contact sheet — caves, ash and prisoners",
  90: "Hell material board — screaming mouths, bodies and fire",
  91: "Abyss route board — tunnels, face fields and cold caverns",
  92: "Hell close-up board — black water, flesh walls and dead faces",
  93: "Tormented heads surrounding a red-lit tunnel mouth",
  94: "Single screaming head submerged in tar-black ground",
  95: "Duplicate submerged-head torment reference",
  96: "Bone gate opening onto a corpse-filled infernal field",
  97: "Screaming head beside a distant red cavern opening",
  98: "Corpse-lined tunnel leading toward a red infernal light",
  99: "Buried heads and remains across an ash-black floor",
  100: "Decayed screaming face fused into cavern ground",
  101: "Ember-lit wall of trapped faces above the lower fires",
  102: "Charred prisoner portrait with infernal basin behind",
  103: "Collapsed souls beneath a smoking red cavern ceiling",
  104: "Embedded screaming face beside a distant orange fire",
  105: "Pale hollow-eyed demon identity portrait on black",
  106: "Crown-of-thorns close-up of Jesus dying on the cross",
  107: "Three crucified bodies with Jesus under the INRI sign",
  108: "Mary and companions grieving below the Roman crowd"
};
const shade = [
  "Distant smoke-demon procession across a wet abyss floor",
  "Towering shade demons advancing through black fog",
  "Smoke spirits circling inside a lightless cavern",
  "Shadow-demon host emerging beneath storm clouds",
  "Skull-like spirit faces forming in dark vapor",
  "Ragged smoke entities sweeping across broken ground"
];
function captionFor(i) {
  if (special[i]) return special[i];
  if (i >= 43 && i <= 72) return `${shade[(i - 43) % shade.length]} — reference ${String(i).padStart(3, "0")}`;
  return `Mixed Harrowing production visual reference ${String(i).padStart(3, "0")}`;
}
const project = loadProject(SLUG);
const assets = project.assets.items.filter((item) => String(item.id).startsWith("zip-random-")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (assets.length !== 108) throw new Error(`Expected 108 random assets, found ${assets.length}`);
const changed = [];
assets.forEach((asset, index) => {
  const i = index + 1;
  const number = String(i).padStart(3, "0");
  const caption = captionFor(i);
  const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion)) || asset.versions?.[0];
  asset.category = "reference";
  asset.categoryLabel = "References";
  asset.mediaType = active?.mediaType || asset.mediaType || "image";
  asset.name = caption;
  asset.variant = `Mixed imported reference ${number}`;
  asset.caption = caption;
  asset.referenceFolder = "random";
  asset.referenceIndex = number;
  asset.sourceSection = "Director-supplied visual reference library";
  asset.reviewState = "director-supplied-reference";
  asset.status = active?.file ? "generated" : asset.status;
  asset.prompt = `${caption.toUpperCase()}: DIRECTOR-SUPPLIED VISUAL REFERENCE.\n\nUse only for the composition, character identity, atmosphere, scale, lighting, texture, creature behavior, or action described by this caption. Ignore and do not regenerate any embedded subtitles, labels, watermarks, contact-sheet borders, modern skyline elements, or unintended typography. Harrowing v2 continuity remains authoritative: Hades is not Satan; Jesus' descending spirit wears barefoot white linen of light with no crown; the crown belongs only to the crucified corpse; the Great Gulf is not emptied.`;
  asset.sourcePrompt = caption;
  asset.continuity = [...new Set([...(asset.continuity || []), `REFERENCE CAPTION: ${caption}.`])];
  asset.updatedAt = new Date().toISOString();
  changed.push({ id: asset.id, folder: "random", number, caption, mediaType: asset.mediaType, file: active?.file || null });
});
updateAssetManifestCounts(project.assets);
saveProject(project);
fs.writeFileSync(path.join(projectDir(SLUG), "production", "asset-manifest.json"), JSON.stringify(project.assets, null, 2));
const reportPath = path.join(projectDir(SLUG), "production", "IMPORTED_REFERENCE_CAPTIONS.json");
let report = { schemaVersion: 1, totalTarget: 664, completed: [], folders: {} };
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
const ids = new Set(changed.map((row) => row.id));
report.completed = [...(report.completed || []).filter((row) => !ids.has(row.id)), ...changed];
report.folders.random = { total: 108, captioned: 108, complete: true };
report.completedCount = report.completed.length;
report.remainingCount = report.totalTarget - report.completedCount;
report.updatedAt = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, changed: changed.length, completedCount: report.completedCount, remainingCount: report.remainingCount, counts: project.assets.counts }, null, 2));
