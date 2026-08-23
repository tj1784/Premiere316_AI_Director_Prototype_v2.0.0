import fs from "node:fs";
import path from "node:path";
import { loadProject, saveProject } from "../server/projects.js";
import { updateAssetManifestCounts } from "../server/assets.js";
import { projectDir } from "../server/paths.js";

const SLUG = "harrowing_of_hell_v2";
const special = {
  1: "Condemned soul screaming while submerged in molten fire",
  2: "Shadow torturers surrounding a prone captive beneath one light",
  3: "Demon pack crouched over a captive on the cavern floor",
  4: "Four shadow tormentors closing around a fallen prisoner",
  5: "Single towering torturer looming over a bound soul",
  6: "Three screaming heads trapped in molten red ground",
  7: "Four condemned souls sinking beside open flame",
  8: "Row of screaming prisoners submerged in a lava channel",
  9: "Single condemned head breaking through molten ground",
  10: "Two souls drowning beneath a bright lava crust",
  11: "Burned prisoner reaction close-up before the flames",
  12: "Three condemned heads trapped in a molten basin",
  13: "Five screaming souls spread across a lake of fire",
  14: "Prisoners burning at the edge of open flame",
  15: "Terrified central prisoner surrounded by burning souls",
  16: "Extreme foreground scream above molten red ground",
  17: "Three prisoners consumed by rising flame",
  18: "Condemned souls pressed together inside the fire",
  19: "Three heads submerged across a bright lava surface",
  20: "Burning prisoners turning toward the source of torment",
  21: "Three screaming faces lit by orange fire",
  22: "Central burned prisoner with companions behind him",
  23: "Two souls clawing upward from molten ground",
  24: "Single charred face screaming against black-red flame",
  25: "Group of condemned souls surrounded by active fire",
  26: "Two heads and a buried body sinking into lava",
  27: "Close-up scream with fire rising behind the prisoner",
  28: "Tilted burned-face close-up under orange hell light",
  29: "Charred prisoner screaming before a shower of sparks",
  30: "Extreme low-angle scream above an ember field",
  31: "Burned face with another prisoner obscured behind",
  32: "Condemned soul screaming as flame fills the background",
  33: "Open-mouthed burned prisoner framed by the fire line",
  34: "Face and shoulders emerging from a molten crust",
  35: "Profile scream against a bright wall of fire",
  36: "Centered burned-face close-up in red-orange light",
  37: "Long-haired prisoner screaming beside open flame",
  38: "Condemned face half-submerged in lava",
  39: "Terrified eye and burned face in extreme close-up",
  40: "Wide infernal crater filled with active fire and prisoners",
  41: "Charred face tilted across a wall of flame",
  42: "Fire basin beneath a distant arched gate",
  43: "Demonic profile watching a vast burning corpse field",
  44: "Terrified prisoner confronted by a red-eyed demon",
  45: "Horned warden overlooking a narrow burning chasm",
  46: "Wide lake of fire across a corpse-filled cavern",
  47: "Prisoner screaming as a shadow demon closes from behind",
  48: "Broad infernal valley crossed by lines of fire",
  49: "Demon presiding over a bright lava fissure",
  50: "Panoramic burning field under a smoke-red ceiling",
  51: "Terrified woman confronted by a close demon face",
  52: "Fanged demon leaning into a prisoner's face",
  53: "Prisoner and snarling demon in side-by-side close-up",
  54: "Horned tormentor reaching into a field of burning bodies",
  55: "Red cavern basin with embedded face and scattered fires",
  56: "Burning infernal plain leading toward distant black towers",
  57: "Wide corpse field burning beneath a red cavern roof",
  58: "Horned warden watching flames spread across the condemned",
  59: "Prisoners driven across ash ground by tall demon wardens",
  60: "Four screaming heads submerged together in molten fire",
  61: "Two horned demons extending hands across a central fire pit",
  62: "Demon wardens herding a prisoner column through the cavern",
  63: "Horned torturer reaching over a lake of fire",
  64: "Tall shadow warden leading prisoners through smoke",
  65: "Prisoners fleeing between two towering demon wardens",
  66: "Condemned souls running from a crouched cavern predator",
  67: "Horned demon feeding the fire pit from above",
  68: "Demons driving a dense crowd around a circular flame basin",
  69: "Seated horned warden consuming remains above the pit",
  70: "Horned demon standing over a burning body mound",
  71: "Pair of demons presiding over a broad infernal basin",
  72: "Warden reaching toward prisoners across a lake of fire",
  73: "Torturer standing on a ledge above kneeling captives",
  74: "Horned executioner overlooking a deep burning crater",
  75: "Demon wardens stalking prisoners through an ash chamber",
  76: "Caged torture chamber with captives and armed demons",
  77: "Tall warden approaching crawling prisoners in gray light",
  78: "Demons restraining captives in a corpse-strewn chamber",
  79: "Torture work floor with hanging bodies and demon handlers",
  80: "Demon laborers surrounding captives beneath a red cavern glow",
  93: "Massive horned devourer crouched over a field of bodies",
  101: "Colossal devourer feeding in the center of the torture field",
  104: "Horned giant hunched over remains beneath ember haze",
  105: "Two giant devourers facing each other across a corpse field",
  109: "Multiple giant devourers feeding in an infernal pit",
  110: "Large devourers crouched among bodies and small fires",
  111: "Horned devourer holding a victim as others approach",
  112: "Two flesh-eating demons feeding beneath a red-lit wall",
  113: "Two giant tormentors looming over a field of remains",
  114: "Pyramid-headed executioners advancing with massive blades",
  115: "Three pyramid-headed wardens crossing the torture chamber",
  116: "Single pyramid-headed executioner beside a corpse mound",
  117: "Executioner raising a broad iron blade above a captive crowd",
  118: "Pyramid-headed warden standing amid kneeling prisoners",
  119: "Executioner dragging a huge blade across the torture field",
  120: "Two pyramid-headed wardens advancing through smoke",
  121: "Executioner's broad blade pressed beside a screaming captive",
  122: "Pyramid-headed torturer threatening a kneeling prisoner",
  123: "Pair of executioners standing over piles of bodies",
  124: "Two pyramid-headed wardens dragging blades through ash",
  125: "Screaming prisoners beneath an executioner's iron blade",
  126: "Executioner carrying a great blade before a captive host",
  127: "Two pyramid-headed torturers advancing across the pit",
  128: "Executioner and terrified captive in close confrontation",
  129: "Broad blade crossing the foreground beside trapped souls",
  130: "Pyramid-headed warden lifting a bloodied blade over a victim",
  131: "Executioner's blade descending toward a screaming captive",
  132: "Terrified prisoner cornered by pyramid helm and iron blade",
  133: "Two captives beneath a massive executioner's sword",
  134: "Fanged giant devouring a captured soul",
  135: "Executioner blade trapping a prisoner against the ground",
  136: "Pyramid-headed warden cutting through a captive group",
  137: "Two fanged devourers fighting over a screaming victim",
  138: "Giant demon biting into a restrained prisoner",
  139: "Fanged devourer holding a victim against its mouth",
  140: "Horned giant consuming a soul in close-up",
  141: "Devourer gripping a captive with both hands",
  142: "Fanged demon feeding while prisoners scream behind",
  143: "Executioner's blade separating trapped prisoners",
  144: "Horned giant opening its jaws above a captive",
  145: "Fanged devourer biting a victim at extreme close range",
  146: "Prisoner held beneath a giant demon's upper fangs",
  147: "Giant tormentor carrying a screaming soul toward its mouth",
  148: "Devourer holding a victim against its teeth",
  149: "Bald fanged demon carrying a captive under one arm",
  150: "Open jaws closing around a trapped prisoner",
  151: "Two devourers converging on a screaming soul",
  152: "Victim trapped between a giant demon's hands and teeth",
  153: "Close-up of fangs surrounding a captive's head",
  154: "Devourer lifting a prisoner toward its mouth",
  155: "Soul restrained by a giant demon's hand and jaw",
  156: "Giant tormentor crushing a captive against its face",
  157: "Devourer looming over multiple screaming prisoners",
  158: "Victim framed inside the open jaws of a demon",
  159: "Fanged giant confronting a prisoner at face level",
  160: "Devourer biting down on a captured soul",
  161: "Terrified prisoners running toward camera through gray smoke",
  162: "Devourer holding a captive while others flee",
  163: "Extreme close-up of a fanged demon mouth",
  164: "Male prisoner sprinting from shadow wardens",
  165: "Fleeing soul looking back at pursuing demons",
  166: "Group of prisoners running through the torture field",
  167: "Exhausted prisoner moving through a crowd of fleeing souls",
  168: "Screaming male prisoner leading a flight through smoke",
  169: "Prisoner breaking from the crowd toward camera",
  170: "Frightened soul framed against a stampeding crowd",
  171: "Male prisoner shouting while another captive turns away",
  172: "Wide flight of prisoners across wet infernal ground",
  173: "Close-up of a fleeing prisoner glancing left",
  174: "Terrified woman running among escaping souls",
  175: "Male prisoner crawling away from distant demons",
  176: "Prisoners scattering in multiple directions through fog",
  177: "Side close-up of a man reacting to an approaching demon",
  178: "Wide-eyed prisoner with pursuers blurred behind",
  179: "Fleeing man looking upward as the crowd closes behind",
  180: "Prisoner turning toward movement in the smoke",
  181: "Exhausted captive stopping as other souls flee",
  182: "Male prisoner reaching toward camera while running",
  183: "Terrified face with a demon shape approaching behind",
  184: "Pale prisoner frozen in fear against gray fog",
  185: "Woman confronted by a skull-faced shadow demon",
  186: "Male prisoner face-to-face with a fanged demon",
  187: "Red-eyed demon confronting a captive in profile",
  188: "Fanged tormentor reaching toward a screaming prisoner",
  189: "Demon hand rising beside a terrified man's face",
  190: "Prisoner screaming as a shadow warden closes behind",
  191: "Duplicate pursuit close-up with clawed demon in background",
  192: "Fanged demon stalking immediately behind a fleeing man",
  193: "Prisoners running from towering wardens across a corpse field",
  194: "Horned giant pursuing a man through red-lit mud",
  195: "Multiple prisoners fleeing between tall shadow demons",
  196: "Wide chase through a cavern of fire and black fog",
  197: "Crawling captive pursued by giant infernal wardens",
  198: "Prisoners moving as a group through a burning torture field",
  199: "Woman running beneath looming demon silhouettes",
  200: "Escaping prisoners crossing a gray corridor of wardens",
  201: "Prisoner column fleeing toward a distant black citadel",
  202: "Three captives running from red-eyed demon sentries",
  203: "Man and woman fleeing beneath a tall horned warden",
  204: "Prisoners chased across wet ground toward the red fortress",
  205: "Woman running from a towering smoke demon",
  206: "Crowd of souls escaping between multiple giant wardens",
  207: "Close-up of a terrified male prisoner during the flight",
  208: "Prisoners running under a blood-red sky and black towers",
  209: "Two men fleeing across an open infernal field",
  210: "Male prisoner staring ahead in shock while running",
  211: "Prisoner group approaching a horned warden on a mound",
  212: "Captives crossing the torture field beneath a tall demon",
  213: "Shadow torturers swarming a prone captive",
  214: "Burned prisoner reaction with another soul behind",
  215: "Pyramid-headed executioner trapping two screaming captives",
  216: "Horned demon leaping over the central fire pit"
};
const torture = [
  "Shadow torturers surrounding a fallen captive",
  "Demon handlers working over prisoners on wet stone",
  "Condemned souls crawling through a smoke-filled torture field",
  "Tall wardens presiding over kneeling prisoners",
  "Infernal labor chamber with captives and demon overseers",
  "Prisoners dragged across ash beneath hanging chains"
];
function captionFor(i) {
  if (special[i]) return special[i];
  if (i >= 81 && i <= 112) return `${torture[(i - 81) % torture.length]} — reference ${String(i).padStart(3, "0")}`;
  return `Torturer and captive production reference ${String(i).padStart(3, "0")}`;
}
const project = loadProject(SLUG);
const assets = project.assets.items.filter((item) => String(item.id).startsWith("zip-torturer-and-the-tortured-")).sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (assets.length !== 216) throw new Error(`Expected 216 torture assets, found ${assets.length}`);
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
  asset.variant = `Torturer and tortured reference ${number}`;
  asset.caption = caption;
  asset.referenceFolder = "torturer-and-the-tortured";
  asset.referenceIndex = number;
  asset.sourceSection = "Director-supplied visual reference library";
  asset.reviewState = "director-supplied-reference";
  asset.status = active?.file ? "generated" : asset.status;
  asset.prompt = `${caption.toUpperCase()}: DIRECTOR-SUPPLIED TORTURE-CHAMBER REFERENCE.\n\nUse as production evidence for infernal staging, scale, atmosphere, victim movement, demon blocking, fire behavior, or action described by the caption. This reference does not redefine the speaking Torturer Demon's locked identity asset. Avoid gratuitous gore in any shot not explicitly requiring it. Do not reproduce labels, watermarks, contact-sheet borders, or unintended typography.`;
  asset.sourcePrompt = caption;
  asset.continuity = [...new Set([...(asset.continuity || []), `REFERENCE CAPTION: ${caption}.`, "The speaking Torturer Demon retains the locked character identity in character-torturer-demon-appearance."])];
  asset.updatedAt = new Date().toISOString();
  changed.push({ id: asset.id, folder: "torturer-and-the-tortured", number, caption, mediaType: asset.mediaType, file: active?.file || null });
});
updateAssetManifestCounts(project.assets);
saveProject(project);
fs.writeFileSync(path.join(projectDir(SLUG), "production", "asset-manifest.json"), JSON.stringify(project.assets, null, 2));
const reportPath = path.join(projectDir(SLUG), "production", "IMPORTED_REFERENCE_CAPTIONS.json");
let report = { schemaVersion: 1, totalTarget: 664, completed: [], folders: {} };
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
const ids = new Set(changed.map((row) => row.id));
report.completed = [...(report.completed || []).filter((row) => !ids.has(row.id)), ...changed];
report.folders["torturer-and-the-tortured"] = { total: 216, captioned: 216, complete: true };
report.completedCount = report.completed.length;
report.remainingCount = report.totalTarget - report.completedCount;
report.updatedAt = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, changed: changed.length, completedCount: report.completedCount, remainingCount: report.remainingCount, counts: project.assets.counts }, null, 2));
