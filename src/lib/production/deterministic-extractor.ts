import { normalizeAssetName } from "./breakdown.ts";
import type { BreakdownExtractionRequest, BreakdownExtractor } from "./extraction.ts";
import type { BreakdownRequirementDraft, ProductionCategory } from "./types.ts";

type Detection = {
  category: ProductionCategory;
  name: string;
  description: string;
  sceneIds: string[];
  variantLabel?: string;
  hero?: boolean;
  referenceRequired?: boolean;
};

type Term = { pattern: RegExp; name: string; hero?: boolean };

const TERM_GROUPS: Partial<Record<ProductionCategory, Term[]>> = {
  prop: [
    term("film reel", /\b(?:film\s+)?reel\b/i, true), term("key", /\bkeys?\b/i, true),
    term("sword", /\bswords?\b/i, true), term("cup", /\b(?:cup|chalice|goblet)s?\b/i, true),
    term("letter", /\bletters?\b/i), term("book", /\bbooks?\b/i), term("scroll", /\bscrolls?\b/i),
    term("camera", /\bcameras?\b/i, true), term("phone", /\b(?:phone|telephone)s?\b/i),
    term("ring", /\brings?\b/i, true), term("lantern", /\blanterns?\b/i), term("rope", /\bropes?\b/i),
  ],
  wardrobe: [
    term("robe", /\brobes?\b/i), term("tunic", /\btunics?\b/i), term("cloak", /\bcloaks?\b/i),
    term("coat", /\b(?:coat|peacoat)s?\b/i), term("cardigan", /\bcardigans?\b/i), term("dress", /\bdresses\b/i),
    term("uniform", /\buniforms?\b/i), term("armor", /\barmo(?:u)?r\b/i), term("crown", /\bcrowns?\b/i),
    term("sandals", /\bsandals?\b/i), term("boots", /\bboots?\b/i), term("scarf", /\bscar(?:f|ves)\b/i),
    term("shirt", /\bshirts?\b/i), term("veil", /\bveils?\b/i),
  ],
  hair_makeup: [
    term("beard", /\bbeards?\b/i), term("distinctive hair", /\b(?:hair|hairstyle|braids?)\b/i),
    term("wound makeup", /\b(?:wound|bruise|scar)s?\b/i), term("blood application", /\bblood(?:ied|y)?\b/i),
    term("period makeup", /\bmakeup\b/i),
  ],
  creature: [
    term("horse", /\bhorses?\b/i), term("donkey", /\bdonkeys?\b/i), term("camel", /\bcamels?\b/i),
    term("dog", /\bdogs?\b/i), term("cat", /\bcats?\b/i), term("sheep", /\bsheep\b/i),
    term("lamb", /\blambs?\b/i), term("bird", /\bbirds?\b/i), term("serpent", /\bserpents?\b/i),
  ],
  vehicle: [
    term("car", /\b(?:car|automobile)s?\b/i), term("truck", /\btrucks?\b/i), term("boat", /\b(?:boat|ship)s?\b/i),
    term("cart", /\bcarts?\b/i), term("chariot", /\bchariots?\b/i), term("bicycle", /\b(?:bicycle|bike)s?\b/i),
  ],
  practical_effect: [
    term("practical fire", /\b(?:fire|flames?|torch(?:es)?)\b/i), term("practical smoke", /\bsmoke\b/i),
    term("rain effect", /\brain(?:ing|fall)?\b/i), term("wind effect", /\bwind(?:y)?\b/i),
    term("fog effect", /\b(?:fog|mist)\b/i), term("practical explosion", /\bexplosion\b/i),
  ],
  vfx: [
    term("apparition", /\b(?:apparition|ghost|specter|spirit)s?\b/i), term("vision", /\bvisions?\b/i),
    term("supernatural glow", /\b(?:supernatural|unearthly)\s+(?:glow|light)\b/i),
    term("transformation", /\btransformation\b/i), term("projection effect", /\bproject(?:ed|ion)\b/i),
    term("screen replacement", /\b(?:screen|monitor)\s+(?:image|display|footage)\b/i),
  ],
  set_dressing: [
    term("table", /\btables?\b/i), term("chair", /\bchairs?\b/i), term("altar", /\baltars?\b/i),
    term("bed", /\bbeds?\b/i), term("desk", /\bdesks?\b/i), term("shelves", /\bshel(?:f|ves)\b/i),
    term("film cans", /\bfilm\s+cans?\b/i), term("drapery", /\b(?:curtain|drape)s?\b/i),
  ],
  signage: [
    term("sign", /\bsigns?\b/i), term("inscription", /\binscriptions?\b/i), term("title card", /\btitle\s+cards?\b/i),
    term("placard", /\bplacards?\b/i), term("label", /\blabels?\b/i), term("on-screen lettering", /\b(?:lettering|written text)\b/i),
  ],
  sound: [
    term("thunder", /\bthunder\b/i), term("footsteps", /\bfootsteps?\b/i), term("bell", /\bbells?\b/i),
    term("knock", /\bknocks?\b/i), term("creak", /\bcreaks?\b/i), term("mechanical hum", /\b(?:hum|humming|motor)\b/i),
    term("surf", /\b(?:surf|waves?)\b/i), term("crowd ambience", /\b(?:crowd|murmur)s?\b/i),
  ],
  music: [
    term("song", /\bsongs?\b/i), term("hymn", /\bhymns?\b/i), term("chant", /\bchants?\b/i),
    term("choir", /\bchoirs?\b/i), term("instrumental music", /\b(?:music|melody|score)\b/i),
    term("drum", /\bdrums?\b/i), term("flute", /\bflutes?\b/i),
  ],
  continuity: [
    term("wet continuity", /\b(?:wet|soaked|rain-soaked)\b/i), term("wound continuity", /\b(?:wound|bruise|scar)s?\b/i),
    term("blood continuity", /\bblood(?:ied|y)?\b/i), term("torn continuity", /\b(?:torn|ripped)\b/i),
    term("broken continuity", /\bbroken\b/i), term("dirt continuity", /\b(?:dirty|dusty|muddy)\b/i),
  ],
};

const CHARACTER_EXCLUSIONS = new Set([
  "FADE IN", "FADE OUT", "CUT TO", "DISSOLVE TO", "SMASH CUT TO", "MATCH CUT TO",
  "THE END", "CONTINUED", "END OF ACT", "TITLE", "SUPER",
]);

export const deterministicFountainExtractor: BreakdownExtractor = {
  extract: async (request) => deterministicFountainBreakdown(request),
};

/** Conservative offline baseline. It only emits items supported by visible Fountain text. */
export function deterministicFountainBreakdown(request: BreakdownExtractionRequest): BreakdownRequirementDraft[] {
  const detections = new Map<string, Detection>();
  const blocks = sceneBlocks(request);

  for (const block of blocks) {
    const location = locationFromSlugline(block.slugline);
    if (location) {
      addDetection(detections, "location", location.name, `Screenplay location: ${location.name}.`, block.id, {
        variantLabel: location.state || undefined,
      });
    }

    for (let index = 0; index < block.lines.length; index += 1) {
      const speaker = characterCue(block.lines, index);
      if (!speaker) continue;
      addDetection(detections, "character", speaker, `Dialogue speaker appearing in ${block.slugline}.`, block.id);
      addDetection(detections, "voice", titleCase(`${speaker} voice`), `Dialogue voice required for ${speaker}.`, block.id);
    }

    const body = block.lines.join("\n");
    for (const [category, terms] of Object.entries(TERM_GROUPS) as [ProductionCategory, Term[]][]) {
      for (const item of terms) {
        if (!item.pattern.test(body)) continue;
        addDetection(detections, category, titleCase(item.name), `Detected ${category.replaceAll("_", " ")} requirement in ${block.slugline}.`, block.id, { hero: item.hero });
      }
    }
  }

  return [...detections.entries()].map(([key, item]) => ({
    id: `local:${item.category}:${slug(item.name)}:${stableHash(key)}`,
    category: item.category,
    name: item.name,
    description: item.description,
    sceneIds: item.sceneIds,
    variantLabel: item.variantLabel,
    hero: item.hero,
    referenceRequired: item.referenceRequired,
  }));
}

function sceneBlocks(request: BreakdownExtractionRequest) {
  const lines = request.fountain.split(/\r?\n/);
  const headings = lines.reduce<{ line: number; text: string }[]>((items, raw, line) => {
    const text = raw.trim();
    if (isSceneHeading(text)) items.push({ line, text });
    return items;
  }, []);
  return request.scenes.map((scene, index) => ({
    id: scene.id,
    slugline: scene.slugline,
    lines: lines.slice(headings[index]?.line ?? 0, headings[index + 1]?.line ?? lines.length),
  }));
}

function characterCue(lines: string[], index: number): string | null {
  const raw = lines[index]?.trim() ?? "";
  if (!raw || isSceneHeading(raw) || raw.startsWith("!") || raw.startsWith("#") || raw.startsWith(".")) return null;
  const cue = raw.replace(/^@/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!cue || cue !== cue.toLocaleUpperCase() || cue.length > 48 || CHARACTER_EXCLUSIONS.has(cue) || /(?:TO:|:)\s*$/.test(cue)) return null;
  if (!/^[A-Z0-9][A-Z0-9 .''’-]+$/.test(cue) || cue.split(/\s+/).length > 6) return null;
  let next = index + 1;
  while (next < lines.length && !lines[next].trim()) next += 1;
  if (/^\([^)]*\)$/.test(lines[next]?.trim() ?? "")) next += 1;
  while (next < lines.length && !lines[next].trim()) next += 1;
  const dialogue = lines[next]?.trim() ?? "";
  if (!dialogue || isSceneHeading(dialogue) || dialogue === dialogue.toLocaleUpperCase()) return null;
  return titleCase(cue);
}

function locationFromSlugline(slugline: string): { name: string; state: string } | null {
  const rest = slugline.replace(/^(?:INT\.\/EXT\.|I\/E\.|INT\.|EXT\.)\s*/i, "").trim();
  if (!rest) return null;
  const stateMatch = rest.match(/\s+(?:—|--|-)\s+((?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|CONTINUOUS|LATER|RAIN|STORM|SNOW|FOG)(?:\b.*)?)$/i);
  const name = (stateMatch ? rest.slice(0, stateMatch.index) : rest).trim();
  return name ? { name: titleCase(name), state: stateMatch?.[1]?.trim().toLocaleLowerCase() ?? "" } : null;
}

function addDetection(
  detections: Map<string, Detection>,
  category: ProductionCategory,
  name: string,
  description: string,
  sceneId: string,
  options: Pick<Detection, "variantLabel" | "hero" | "referenceRequired"> = {},
) {
  const normalized = normalizeAssetName(name, category);
  const variant = options.variantLabel?.toLocaleLowerCase() ?? "";
  const key = `${category}:${normalized}:${variant}`;
  const current = detections.get(key);
  if (current) {
    if (!current.sceneIds.includes(sceneId)) current.sceneIds.push(sceneId);
    current.hero ||= options.hero;
    current.referenceRequired ||= options.referenceRequired;
    return;
  }
  detections.set(key, { category, name, description, sceneIds: [sceneId], ...options });
}

function isSceneHeading(value: string) {
  return /^(?:INT\.\/EXT\.|I\/E\.|INT\.|EXT\.)/i.test(value);
}

function term(name: string, pattern: RegExp, hero = false): Term { return { name, pattern, hero }; }
function titleCase(value: string) { return value.toLocaleLowerCase().replace(/(^|[\s-])([a-z])/g, (_, before: string, letter: string) => `${before}${letter.toLocaleUpperCase()}`); }
function slug(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset"; }
function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
