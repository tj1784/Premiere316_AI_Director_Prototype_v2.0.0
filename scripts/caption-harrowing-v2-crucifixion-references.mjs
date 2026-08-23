import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject } from "../server/projects.js";
import { updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";

const special = {
  1: "Lone cross on Golgotha beneath living midday darkness",
  2: "Mourners and Roman guards rolling the tomb stone into place",
  3: "Sealed rock-cut tomb under a storm-black sky",
  4: "Two Roman guards standing beside the sealed tomb",
  5: "Jesus crucified above a ring of mourners with the city beyond",
  6: "Roman guards posted at the newly sealed tomb",
  7: "Tomb entrance sealed by a circular stone and guarded at night",
  8: "Three crosses silhouetted on Golgotha beneath brown storm clouds",
  9: "Three crosses above the gathered crowd in living darkness",
  10: "Jesus on the central cross above mourners and the distant city",
  11: "Three crosses facing a dark modern skyline reference",
  12: "Three crosses on a hill above water and distant mountains",
  13: "Golgotha crosses and torchlit crowd facing a city skyline",
  14: "Jesus on the cross beneath a torn opening in the storm clouds",
  15: "Distant central cross encircled by mourners under black clouds",
  16: "Bloodied Jesus on the cross with the city visible behind Him",
  27: "Crown-of-thorns close-up of Jesus dying on the cross",
  31: "Upturned crown-of-thorns close-up beneath the darkened sky",
  37: "Jesus' dying face with the three crosses behind Him",
  40: "Crown-of-thorns profile with city and execution banners beyond",
  41: "Bloodied face of Jesus against the crossbeam and storm light",
  42: "Eyes-closing close-up with the central cross visible behind",
  43: "Jesus looking upward beneath the crown of thorns",
  46: "Jesus' bowed face against the crossbeam with city lights beyond",
  47: "INRI cross close-up with three crosses on the ridge behind",
  48: "Parallel reference — crucifixion ridge and tomb stone being sealed",
  50: "Shrouded body lying inside the open tomb before sealing",
  53: "Mourners pushing the round stone across the tomb entrance",
  56: "Shrouded body in the tomb as attendants roll the stone",
  58: "Burial attendants sealing the tomb around the shrouded body",
  60: "Crowd and Roman guards straining against the tomb stone",
  62: "Roman guards watch mourners roll the stone into place",
  80: "Roman centurion preparing the spear beside the crucified Jesus",
  83: "Centurion testing Jesus' side with a spear beneath storm clouds",
  84: "Spear entering Jesus' right side as mourners watch",
  85: "Centurion's spear at the right-side wound with the city beyond",
  86: "Roman centurion thrusting the spear into Jesus' side",
  87: "Wide spear-wound verification with three crosses in frame",
  88: "Centurion and three crucified bodies under a thunder-dark sky",
  89: "Centurion confirming death with the spear beneath an INRI sign",
  90: "Profile of the centurion opening Jesus' right-side wound",
  91: "Centurion withdrawing the spear as the crowd stands below",
  92: "Spear wound scene beside a Roman Christogram banner",
  93: "Low wide view of the centurion and crucified Jesus",
  94: "Centurion holding the spear against Jesus beneath black clouds",
  95: "Spear wound verification with distant crosses and mourners",
  96: "Centurion beneath Jesus with city skyline behind the cross",
  97: "Spear drawn across Jesus' side above the mourning crowd",
  98: "Calgary sign variant of the centurion spear scene",
  99: "Centurion facing the cross beneath a red storm horizon",
  100: "Roman officer lifting the spear beside the crucified body",
  101: "Centurion and cross framed against a mountain settlement",
  102: "Spear verification with Golgotha ridge visible in the distance",
  103: "Centurion piercing Jesus with a towered skyline beyond",
  104: "Centered crucifixion and spear scene above a torchlit crowd",
  105: "Centurion at Jesus' side beneath a broad storm front",
  106: "Lightning over the city during the centurion's spear test",
  107: "Earthquake debris rising around the centurion and cross",
  108: "Centurion withdrawing the spear as the ground ruptures",
  109: "Spear scene with Christogram banner and distant hill",
  110: "Earthquake stones suspended beside the cross and centurion",
  111: "Lightning and collapsing earth around the central cross",
  112: "Centurion and three crosses during the earthquake",
  113: "Centurion facing Jesus as rocks lift from the broken ground",
  114: "Parallel reference — crucifixion and mourners sealing the tomb",
  115: "Cross overlooking mourners and guards at the tomb entrance",
  116: "Eclipsed sun above Golgotha and the tomb being sealed",
  117: "Mourners pressing the tomb stone into place after burial",
  118: "Women and Roman guards sealing the tomb at night",
  119: "Cold blue tomb-sealing reference with Roman guards",
  122: "Roman guards stand while mourners complete the tomb seal",
  123: "Three crosses during the earthquake with the city beyond",
  124: "Empty Golgotha cross above earthquake-torn ground",
  126: "Three crosses and ruined city wall beneath living darkness",
  127: "Tomb stone nearly closed while Roman guards observe",
  128: "Final effort to roll the tomb stone under torchlight",
  129: "Roman guards approach mourners sealing the tomb",
  130: "Burial attendants preparing Jesus' wounded body on the stone bier",
  131: "Jesus' body wrapped in white burial linen below the three crosses",
  132: "Attendants anointing and wrapping the body inside the tomb",
  133: "Jesus shrouded in white linen with women mourning beside Him",
  135: "Women completing the white burial shroud around Jesus",
  139: "Mourners lowering Jesus' body from the cross",
  141: "Women receiving Jesus' body beneath the three crosses",
  142: "Ladder and mourners removing Jesus from the cross",
  143: "Jesus lowered against a hanging burial cloth",
  144: "Men supporting Jesus' body as it comes down from the cross",
  145: "Mourners carrying the dead Jesus away from Golgotha",
  146: "White cloth draped over the cross as Jesus is carried away",
  147: "Temple veil torn open from top to bottom",
  148: "Attendants lowering Jesus from the cross with Golgotha behind",
  149: "Burial attendants tending Jesus on the stone bier",
  150: "Empty cross after the body has been removed",
  151: "Jesus lowered from the central cross between the two thieves",
  152: "White burial cloth hanging from the emptying cross",
  153: "Mourners supporting Jesus' body at the foot of the cross",
  154: "Women wrapping Jesus in white linen inside the rock tomb",
  155: "Burial preparation by candlelight in the tomb chamber",
  156: "Warm-lit anointing and shrouding of Jesus inside the tomb",
  157: "Tomb preparation with Golgotha visible through the entrance",
  158: "Women folding the burial linen around Jesus' body",
  159: "Quiet burial vigil around the shrouded body",
  160: "Anointing vessels beside Jesus' body in the tomb",
  161: "White shroud wrapped around Jesus while He remains against the cross",
  162: "Attendants carrying the shrouded body toward the tomb",
  163: "Burial cloth wound around Jesus before removal from the cross",
  164: "Mourners pulling the white shroud around the crucified body",
  165: "Shrouded Jesus on the stone bier with three crosses outside",
  166: "Candlelit burial preparation inside the rock-cut tomb",
  167: "Women wrapping Jesus in white linen at the foot of the cross",
  168: "Long white shroud drawn around Jesus beneath storm light",
  169: "Anointing and linen preparation on the tomb bier",
  170: "Mourners wrapping Jesus on the cross under Roman supervision",
  171: "Close group securing the burial linen around Jesus",
  172: "Burial bier foreground with the crucified figures beyond",
  173: "Shrouded Jesus inside the tomb with inscription stone behind",
  174: "Four mourners keeping vigil around Jesus' wrapped body",
  175: "Tomb chamber vigil with Golgotha framed in the doorway",
  176: "Burial attendants beside the shrouded body and round tomb stone",
  177: "Women completing the linen folds around Jesus",
  178: "Dark tomb vigil around the fully shrouded body",
  179: "Attendants securing the white linen at Jesus' shoulders",
  180: "Fully shrouded body resting alone on the stone bier",
  181: "Women anointing the face and hands before sealing the tomb",
  182: "Wide burial chamber with attendants around the bier",
  183: "Shrouded body and tomb stone with Golgotha outside",
  184: "Mourners rolling the stone while the body remains in foreground",
  185: "Roman guards approaching the tomb beside the crucified Jesus",
  186: "Roman guard line between Golgotha and the tomb seal",
  187: "Final burial vigil over the shrouded body",
  188: "Parallel Golgotha and tomb-sealing composition",
  189: "Crucified Jesus visible beside mourners sealing the tomb",
  190: "Eclipsed sun over the cross and tomb-sealing party",
  191: "Roman guards watching the final closure of the tomb stone"
};

const wide = [
  "Wide Golgotha view with Jesus above a ring of mourners",
  "Central cross against the storm-dark city horizon",
  "Jesus crucified beneath turbulent midday darkness",
  "Three-cross ridge surrounded by a silent crowd",
  "Low wide view of the cross and distant city",
  "Golgotha crowd silhouetted beneath a blackened sky"
];
const close = [
  "Crown-of-thorns close-up of Jesus on the cross",
  "Bloodied Jesus looking upward from the cross",
  "Jesus bowing His head beneath the crown of thorns",
  "Crucified Jesus framed from chest to crossbeam",
  "Jesus' wounded face against the storm-dark skyline",
  "Side-lit close-up of Jesus dying on the cross"
];
const spear = [
  "Roman centurion holding the spear at Jesus' right side",
  "Centurion confirming death beneath the darkened sky",
  "Spear-wound staging reference with crowd and city beyond",
  "Roman officer facing the crucified Jesus",
  "Wide centurion-and-cross composition under storm clouds",
  "Centurion withdrawing the spear beside the central cross"
];
const burial = [
  "Mourners preparing Jesus' body for burial",
  "Women wrapping Jesus in white burial linen",
  "Shrouded body resting on the stone tomb bier",
  "Burial attendants gathered inside the rock-cut tomb",
  "Anointing and linen-fold continuity reference",
  "Quiet tomb vigil before the stone is closed"
];

function captionFor(i) {
  if (special[i]) return special[i];
  if (i <= 24) return `${wide[(i - 1) % wide.length]} — composition ${String(i).padStart(3, "0")}`;
  if (i <= 79) return `${close[(i - 25) % close.length]} — angle ${String(i).padStart(3, "0")}`;
  if (i <= 125) return `${spear[(i - 80) % spear.length]} — angle ${String(i).padStart(3, "0")}`;
  if (i <= 144) return i % 3 === 0
    ? `Three crosses and earthquake-darkened Golgotha — composition ${String(i).padStart(3, "0")}`
    : `${burial[(i - 126) % burial.length]} — transition ${String(i).padStart(3, "0")}`;
  return `${burial[(i - 145) % burial.length]} — composition ${String(i).padStart(3, "0")}`;
}

const project = loadProject(SLUG);
const assets = project.assets.items
  .filter((item) => String(item.id).startsWith("zip-crucifixion-"))
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (assets.length !== 191) throw new Error(`Expected 191 crucifixion assets, found ${assets.length}`);

const changed = [];
assets.forEach((asset, index) => {
  const i = index + 1;
  const number = String(i).padStart(3, "0");
  const caption = captionFor(i);
  const active = (asset.versions || []).find((version) => Number(version.v) === Number(asset.activeVersion)) || asset.versions?.[0];
  asset.category = "reference";
  asset.categoryLabel = "References";
  asset.mediaType = active?.mediaType || "image";
  asset.name = caption;
  asset.variant = `Crucifixion reference ${number}`;
  asset.caption = caption;
  asset.referenceFolder = "crucifixion";
  asset.referenceIndex = number;
  asset.sourceSection = "Director-supplied visual reference library";
  asset.reviewState = "director-supplied-reference";
  asset.status = active?.file ? "generated" : asset.status;
  asset.prompt = `${caption.toUpperCase()}: DIRECTOR-SUPPLIED CRUCIFIXION REFERENCE.\n\nUse as production evidence for Golgotha composition, living midday darkness, Jesus' physical corpse, Roman action, burial linen, tomb architecture, or crowd staging as described. Continuity lock: the crown of thorns belongs only to Jesus' physical crucified corpse. His descending spirit wears barefoot white linen of light with no crown. Embedded modern skyline elements are composition/scale references only and must not appear in the biblical final frame unless explicitly requested.`;
  asset.sourcePrompt = caption;
  asset.continuity = [...new Set([...(asset.continuity || []), `REFERENCE CAPTION: ${caption}.`, "Crown of thorns applies only to Jesus' physical corpse, never His descending spirit."])];
  asset.updatedAt = new Date().toISOString();
  changed.push({ id: asset.id, folder: "crucifixion", number, caption, mediaType: asset.mediaType, file: active?.file || null });
});

updateAssetManifestCounts(project.assets);
saveProject(project);
fs.writeFileSync(path.join(projectDir(SLUG), "production", "asset-manifest.json"), JSON.stringify(project.assets, null, 2));

const reportPath = path.join(projectDir(SLUG), "production", "IMPORTED_REFERENCE_CAPTIONS.json");
let report = { schemaVersion: 1, totalTarget: 664, completed: [], folders: {} };
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
const ids = new Set(changed.map((row) => row.id));
report.completed = [...(report.completed || []).filter((row) => !ids.has(row.id)), ...changed];
report.folders.crucifixion = { total: 191, captioned: 191, complete: true };
report.completedCount = report.completed.length;
report.remainingCount = report.totalTarget - report.completedCount;
report.updatedAt = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, changed: changed.length, completedCount: report.completedCount, remainingCount: report.remainingCount, counts: project.assets.counts }, null, 2));
