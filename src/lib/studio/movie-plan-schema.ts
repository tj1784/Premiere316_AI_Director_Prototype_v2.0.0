import { RESEARCH_BIBLE_SECTION_KEYS } from "../research/bible.ts";

type Schema = Record<string, unknown>;
const string: Schema = { type: "string" };
const object = (properties: Record<string, Schema>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const rows = (properties: Record<string, Schema>): Schema => ({ type: "array", items: object(properties) });
const strings: Schema = { type: "array", items: string };
const shot = { sceneNumber: { type: "integer" }, description: string, type: string, durationSec: { type: "number" }, camera: string, lens: string, cameraMove: string, emotion: string, expression: string };
const schemas: Record<string, Schema> = {
  research: object({ title: string, sections: object(Object.fromEntries(RESEARCH_BIBLE_SECTION_KEYS.map((key) => [key, string]))), characters: rows({ name: string, role: string, age: string, look: string, arc: string }), locations: rows({ name: string, description: string, lighting: string }), sources: rows({ title: string, locator: string, quote: string }) }),
  screenplay: object({ title: string, fountain: string }),
  screenplayQa: object({ findings: rows({ category: string, severity: { type: "string", enum: ["note", "warning", "blocker"] }, summary: string, recommendation: string, revisionRequired: { type: "boolean" } }) }),
  breakdown: object({ assets: rows({ category: string, name: string, description: string, sceneNumbers: { type: "array", items: { type: "integer" }, minItems: 1 } }) }),
  visualDevelopment: object({ intent: string, palette: strings, motifs: strings }),
  cinematography: object({ thesis: string, lensLanguage: string, lighting: string, movement: string }),
  performance: object({ notes: string, shots: rows(shot) }),
  shots: object({ shots: rows(shot) }),
  promptLab: object({ visualContinuity: string, shots: rows({ shotNumber: { type: "integer" }, videoPrompt: string, imagePrompt: string }) }),
  assetReferences: object({ searches: { ...rows({ assetIds: strings, query: string, reason: string }), maxItems: 4 } }),
  assetReferenceChoice: object({ index: { type: "integer", minimum: -1, maximum: 3 }, reason: string }),
};

/** Grammar-constrained output; malformed/truncated output is still rejected by the consumer. */
export function moviePlanResponseFormat(phase: string, sceneCount?: number, runtimeSeconds?: number, assetIds?: string[], sourceQuotes?: string[]) {
  let schema = schemas[phase];
  if (phase === "assetPrompts") {
    if (!assetIds?.length || assetIds.length > 100 || new Set(assetIds).size !== assetIds.length) throw new Error("Invalid asset prompt targets.");
    // Constrain structure, not prose boundaries. Character quotas can force the
    // decoder to absorb closing JSON into a paragraph or cut a sentence short.
    // Actual image-encoder token validation remains authoritative after generation.
    schema = object({ assets: { ...rows({ assetId: { type: "string", enum: assetIds }, promptParagraphs: { type: "array", minItems: 10, maxItems: 10, items: string }, sourceQuote: sourceQuotes?.length ? { type: "string", enum: sourceQuotes } : string }), minItems: assetIds.length, maxItems: assetIds.length } });
  }
  if (!schema) throw new Error(`Unknown movie-plan generation phase: ${phase}`);
  if (sceneCount !== undefined) {
    if (!Number.isInteger(sceneCount) || sceneCount < 1 || sceneCount > 1000) throw new Error("Invalid screenplay scene count.");
    const sceneNumber = { type: "integer", enum: Array.from({ length: sceneCount }, (_, index) => index + 1) };
    if (phase === "promptLab") schema = object({ visualContinuity: string, shots: { ...rows({ shotNumber: sceneNumber, videoPrompt: string, imagePrompt: string }), minItems: sceneCount, maxItems: sceneCount } });
    if (phase === "breakdown") schema = object({ assets: { ...rows({ category: { type: "string", enum: ["character", "location", "wardrobe", "prop", "vehicle", "creature", "vfx", "voice", "sound", "music"] }, name: { type: "string", maxLength: 100 }, description: { type: "string", maxLength: 320 }, sceneNumbers: { type: "array", items: sceneNumber, minItems: 1, maxItems: sceneCount } }), minItems: 1, maxItems: 60 } });
    if (phase === "performance") schema = object({ notes: string, shots: rows({ ...shot, sceneNumber }) });
    if (phase === "shots") {
      const count = runtimeSeconds && runtimeSeconds > 0 ? Math.max(sceneCount, Math.ceil(runtimeSeconds / 10)) : undefined;
      // Fixed scene assignments prevent a grammatically valid response from
      // spending the entire runtime on the opening and omitting the ending.
      schema = count ? object({ shots: object(Object.fromEntries(Array.from({ length: count }, (_, index) => [
        `shot_${String(index + 1).padStart(2, "0")}`,
        object({ ...shot, sceneNumber: { type: "integer", const: Math.floor(index * sceneCount / count) + 1 }, durationSec: { type: "number", const: runtimeSeconds! / count } }),
      ]))) }) : object({ shots: rows({ ...shot, sceneNumber }) });
    }
  }
  return { type: "json_schema" as const, json_schema: { name: `movie_plan_${phase}`, strict: true, schema } };
}
