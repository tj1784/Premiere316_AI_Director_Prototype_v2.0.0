import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject } from "../server/projects.js";
import { updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";

const captions = {
  demons: [
    "Distant shadow-demon procession crossing a wet abyss floor",
    "Drifting smoke demons gathering in a lightless cavern",
    "Towering shadow spirits advancing through black fog",
    "Wind-torn demon silhouettes charging through abyssal mist",
    "Encircling smoke entities forming a predatory ring",
    "Tall ragged shadow demons emerging from a cavern mouth",
    "Procession of hooded smoke spirits beside a reflective path",
    "Backlit demon columns beneath a storm-dark vault",
    "Two dominant shadow wardens leading distant spirits",
    "Scattered smoke demons materializing across broken ground",
    "Glowing-eyed ash demon face forming from darkness",
    "Ragged shadow attackers sweeping across the cavern floor",
    "Hunched and towering demons closing around the camera",
    "Three snarling smoke-demon faces in close formation",
    "Single massive shadow entity rising behind lesser spirits",
    "Horned smoke-demon face emerging in extreme close-up",
    "Twin twisting shadow spirits crossing the abyss floor",
    "Backlit demon host advancing through dense black fog",
    "Featureless hooded spirits crowding the foreground",
    "Ring of smoke demons gathering inside a cavern",
    "Two towering shade demons framing a distant host",
    "Broad horned demon face concealed in storm smoke",
    "Shadow spirits converging beneath a cold shaft of light",
    "Skull-like smoke faces hovering in the darkness",
    "Predatory demon face resolving from a cloud bank",
    "Large shade leading a procession through jagged rock",
    "Exploding black spirit cloud above the abyss floor",
    "Spectral skull demon carried on streaming smoke",
    "Solitary black entity expanding against a gray void",
    "Glowing-eyed skeletal demon face in close-up",
    "Wing-shaped shadow mass descending through darkness",
    "Ancient bark-skinned demon face emerging from smoke",
    "Cluster of horned demon faces packed into black fog",
    "Central smoke predator flanked by lesser faces",
    "Winged shadow form folding around trapped spirits",
    "Half-seen demon face concealed inside rolling smoke",
    "Three hollow-eyed spirit faces floating in fog",
    "Long procession of smoke demons approaching camera",
    "Wall of demonic smoke figures under brown-black storm light",
    "Massive horned demon portrait with ember-dark eyes",
    "Ragged spirit pack prowling across the abyss floor",
    "Towering shade forming above a distant demon host",
    "Multiple demon faces woven into a single smoke body",
    "Crowned horned smoke demon in frontal close-up",
    "Dense cluster of watchful eyes and demon faces",
    "Skull-faced shadow demon streaming into darkness",
    "Winged demon silhouettes surrounding a central void",
    "Armored ash demon barely visible through black vapor"
  ],
  "fallen-angels-the-abyss": [
    "Chained fallen angels embedded along the walls of the lower abyss",
    "Winged prisoners suspended in chains above a blue-black chasm",
    "Fallen angel tribunal surrounding a violet abyssal light",
    "Crowd of chained Watchers assembled in cavern darkness",
    "Ranks of winged prisoners lining a bottomless blue shaft",
    "Colossal fallen angels chained on opposing cliff walls",
    "Named Watchers lineup beneath ruined black wings",
    "Chained fallen angels confronting one another in the abyss",
    "Bald winged prisoners overlooking a cold vertical chasm",
    "Fallen angel council gathered before a sealed stone gate",
    "Dense host of chained Watchers filling the lower cavern",
    "Named fallen angels arrayed across a cold blue abyss",
    "Principal Watchers lineup with restrained wings and chains",
    "Circle of fallen angels gathered in low cavern light",
    "Winged prisoners massed around an abyssal opening",
    "Two chained Watchers facing each other across darkness",
    "Broad formation of fallen angels seated in judgment",
    "Armored Watchers crowding a narrow abyssal causeway",
    "Falling spirits descending between chained cliff prisoners",
    "Fallen angels surrounding a spiral pit in the lower abyss",
    "Three chained Watchers beneath a cold overhead shaft",
    "Opposing fallen angels holding a heavy chain barrier",
    "Blue-white abyssal storm opening between dark cliff walls",
    "Three principal fallen angels chained above the chasm"
  ],
  hell: [
    "Hell environment contact sheet — faces, lava fissures and grasping hands",
    "Tormented faces rising from an ember-lit cavern mass",
    "Hell texture contact sheet — mouths, ash, tunnels and fire basins",
    "Abyss environment contact sheet — faces, chains and frozen blue caverns",
    "Hell material study — embedded faces, ash walls and cold-blue ice",
    "Torment contact sheet — screaming faces, fire pits and grasping crowds",
    "Circular pit and embedded-face environment study",
    "Hell close-up study — charred faces, lava and cavern silhouettes",
    "Numbered hell shot board — tunnels, faces, fire and chained ground",
    "Tormented-face contact sheet with roots, hands and tunnel mouths",
    "Ember-lit flesh wall and screaming-face texture board",
    "Abyss route contact sheet — fire basins, spiral pit and blue cavern",
    "Mass of screaming souls surrounding a crowned demonic figure",
    "Hunched prisoner overlooking the red citadel of hell",
    "Hell texture mosaic — roots, bodies, maws and ember caverns",
    "Hell landscape board — faces, black water and distant red fortress",
    "Wide cavern of buried faces under sparse ember light",
    "Procession of prisoners crossing a corpse-strewn infernal chamber",
    "Horned demon presiding over a vast field of tormented bodies",
    "Empty corpse-lined cavern path beneath cold overhead light",
    "Hell environment contact sheet — tunnels, bodies and fire terraces",
    "Hell concept board — cave mouths, prisoners and burning citadel",
    "Cluster of screaming faces fused into a black cavern wall",
    "Vertical lineup of imprisoned and mutilated souls",
    "Hell shot board — circular tunnels, face fields and dead forests",
    "Hell concept sheet — black water, red caverns and frozen wasteland",
    "Tormented souls surrounding a red-lit tunnel mouth",
    "Single screaming head submerged in tar-black ground",
    "Abyssal route board — black tunnels, fires and tangled bodies",
    "Bone gate opening onto a field of bodies and distant spires",
    "Hell close-up board — grasping hands, faces and storm caverns",
    "Charred demon prisoner standing before a distant red fire",
    "Corpse-lined tunnel leading toward a red infernal opening",
    "Buried heads and human remains across an ash-black floor",
    "Collapsed souls beneath a smoking red cavern ceiling",
    "Screaming head embedded beside a glowing tunnel entrance",
    "Decayed screaming face fused into the cavern ground",
    "Horned tormentors standing above a heap of prisoners",
    "Horned demon guarding a mound of bodies in gray cavern light",
    "Seated horned warden overlooking a corpse field",
    "Ember-lit chasm packed with bodies and watching faces",
    "Bone archway rising from a cold field of the dead",
    "Embedded screaming face beside a distant orange fire",
    "Demon wardens watching a dim infernal basin",
    "Dead forest surrounding a broad field of ruined bodies",
    "Horned demon profile above a distant red stronghold",
    "Lone figure facing the red fortress across a corpse-filled valley",
    "Wide infernal valley with horned watchers and a burning citadel"
  ],
  hellfire: [
    "Demons watching souls fall into a vertical lake of fire",
    "Horned warden presiding over a burning pit of the condemned",
    "Screaming souls submerged to the neck in molten fire",
    "Extreme close-up of a terrified face under red hellfire",
    "Pyramid-headed executioner standing among kneeling prisoners",
    "Torturers driving prisoners across a burning corpse field",
    "Radiant holy figure confronting an executioner in the fire chamber",
    "Opening composition — pyramid-headed tormentor among prisoners",
    "Hellfire motion reference — executioner and prisoners opening beat",
    "Screaming burned prisoner lit by open flames",
    "Two condemned souls sinking into molten red ground",
    "Hellfire motion reference — molten-soul close-up",
    "Hellfire motion reference — burning cavern passage",
    "Hellfire motion reference — prisoner reaction beat",
    "Hellfire motion reference — executioner patrol beat",
    "Hellfire motion reference — fire-chamber crowd beat",
    "Wide lake of fire spreading across a deep cavern",
    "Hellfire motion reference — wide burning-pit movement",
    "Three screaming heads trapped in molten fire",
    "Hellfire motion reference — submerged souls movement",
    "Hellfire motion reference — falling-prisoner shot",
    "Hellfire motion reference — demon warden shot",
    "Hellfire motion reference — lava-surface passage",
    "Hellfire motion reference — condemned crowd passage",
    "Chained bodies hanging above a wall of flame",
    "Horned demon standing over a burning mound of bodies",
    "Hellfire motion reference — hanging-prisoner passage",
    "Hellfire motion reference — horned warden passage",
    "Hellfire motion reference — final molten cavern shot"
  ]
};

const prefixByFolder = {
  demons: "zip-demons-",
  "fallen-angels-the-abyss": "zip-fallen-angels-the-abyss-",
  hell: "zip-hell-",
  hellfire: "zip-hellfire-"
};

function addUnique(list, value) {
  return [...new Set([...(Array.isArray(list) ? list : []), value].filter(Boolean))];
}

const project = loadProject(SLUG);
const changed = [];
for (const [folder, list] of Object.entries(captions)) {
  const prefix = prefixByFolder[folder];
  const assets = project.assets.items
    .filter((item) => String(item.id).startsWith(prefix))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (assets.length !== list.length) throw new Error(`${folder}: expected ${list.length} assets, found ${assets.length}`);
  assets.forEach((asset, index) => {
    const number = String(index + 1).padStart(3, "0");
    const caption = list[index];
    const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion)) || asset.versions?.[0];
    asset.category = "reference";
    asset.categoryLabel = "References";
    asset.mediaType = active?.mediaType || asset.mediaType || "image";
    asset.name = caption;
    asset.variant = `${folder.replaceAll("-", " ")} reference ${number}`;
    asset.caption = caption;
    asset.referenceFolder = folder;
    asset.referenceIndex = number;
    asset.sourceSection = "Director-supplied visual reference library";
    asset.reviewState = "director-supplied-reference";
    asset.status = active?.file ? "generated" : asset.status;
    asset.prompt = `${caption.toUpperCase()}: DIRECTOR-SUPPLIED VISUAL REFERENCE.\n\nUse this image or motion clip as production evidence for composition, atmosphere, scale, lighting, texture, creature behavior, environment construction, or action staging as described by the caption. Do not reproduce contact-sheet borders, embedded labels, watermarks, modern elements, or unintended typography in final film frames. Preserve Harrowing v2 continuity: Hades is not Satan; Jesus' spirit wears barefoot white linen of light without a crown; the crown remains only on the crucified corpse; the Great Gulf is not emptied.`;
    asset.sourcePrompt = caption;
    asset.continuity = addUnique(asset.continuity, `REFERENCE CAPTION: ${caption}.`);
    asset.updatedAt = new Date().toISOString();
    changed.push({ id: asset.id, folder, number, caption, mediaType: asset.mediaType, file: active?.file || null });
  });
}

updateAssetManifestCounts(project.assets);
saveProject(project);
fs.writeFileSync(path.join(projectDir(SLUG), "production", "asset-manifest.json"), JSON.stringify(project.assets, null, 2));

const reportPath = path.join(projectDir(SLUG), "production", "IMPORTED_REFERENCE_CAPTIONS.json");
let report = { schemaVersion: 1, totalTarget: 664, completed: [], folders: {} };
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
const ids = new Set(changed.map((row) => row.id));
report.completed = [...(report.completed || []).filter((row) => !ids.has(row.id)), ...changed];
for (const folder of Object.keys(captions)) report.folders[folder] = { total: captions[folder].length, captioned: captions[folder].length, complete: true };
report.completedCount = report.completed.length;
report.remainingCount = report.totalTarget - report.completedCount;
report.updatedAt = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, changed: changed.length, completedCount: report.completedCount, remainingCount: report.remainingCount, counts: project.assets.counts }, null, 2));
