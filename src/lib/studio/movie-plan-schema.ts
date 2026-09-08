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
};

/** Grammar-constrained output; malformed/truncated output is still rejected by the consumer. */
export function moviePlanResponseFormat(phase: string, sceneCount?: number, runtimeSeconds?: number) {
  let schema = schemas[phase];
  if (!schema) throw new Error(`Unknown movie-plan generation phase: ${phase}`);
  if (sceneCount !== undefined) {
    if (!Number.isInteger(sceneCount) || sceneCount < 1 || sceneCount > 1000) throw new Error("Invalid screenplay scene count.");
    const sceneNumber = { type: "integer", enum: Array.from({ length: sceneCount }, (_, index) => index + 1) };
    if (phase === "breakdown") schema = object({ assets: rows({ category: string, name: string, description: string, sceneNumbers: { type: "array", items: sceneNumber, minItems: 1 } }) });
    if (phase === "performance") schema = object({ notes: string, shots: rows({ ...shot, sceneNumber }) });
    if (phase === "shots") {
      const count = runtimeSeconds && runtimeSeconds > 0 ? Math.max(sceneCount, Math.ceil(runtimeSeconds / 10)) : undefined;
      schema = object({ shots: { ...rows({ ...shot, sceneNumber, ...(count ? { durationSec: { type: "number", const: runtimeSeconds! / count } } : {}) }), ...(count ? { minItems: count, maxItems: count } : {}) } });
    }
  }
  return { type: "json_schema" as const, json_schema: { name: `movie_plan_${phase}`, strict: true, schema } };
}
