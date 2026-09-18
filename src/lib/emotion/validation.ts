import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../data/emotion-node-config.schema.json" with { type: "json" };
import type { PerformanceSettings, SceneConfig } from "./types.ts";

// Use the development pack's canonical schema. Validation never coerces,
// defaults, removes fields, or changes the author's dialogue.
const validateShape = new Ajv2020({
  allErrors: true,
  strict: false,
  ownProperties: true,
}).compile<SceneConfig>(schema);

export function assertSceneConfig(
  value: unknown,
  catalogVersion: string,
): asserts value is SceneConfig {
  if (!validateShape(value)) {
    const details = (validateShape.errors ?? []).slice(0, 5).map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "is invalid"}`;
    });
    throw new Error(`Invalid scene: ${details.join("; ")}.`);
  }

  const scene = value;
  if (scene.catalog_version !== catalogVersion) {
    throw new Error(
      `Unsupported catalog version '${scene.catalog_version}'; expected '${catalogVersion}'.`,
    );
  }

  const characters = new Set(Object.keys(scene.character_baselines));
  for (const id of Object.keys(scene.character_overrides)) {
    if (!characters.has(id)) {
      throw new Error(`Character override '${id}' has no character baseline.`);
    }
  }

  const lineIds = new Set<string>();
  for (const line of scene.lines) {
    if (lineIds.has(line.line_id)) {
      throw new Error(`Duplicate line ID '${line.line_id}'.`);
    }
    lineIds.add(line.line_id);
    if (!characters.has(line.character_id)) {
      throw new Error(`Line '${line.line_id}' references unknown character '${line.character_id}'.`);
    }
    const beatIds = new Set<string>();
    for (const beat of line.beats) {
      if (beatIds.has(beat.beat_id)) {
        throw new Error(`Line '${line.line_id}' has duplicate beat ID '${beat.beat_id}'.`);
      }
      beatIds.add(beat.beat_id);
    }
  }

  const checkContinuity = (settings: PerformanceSettings, context: string) => {
    const source = settings.continuity?.from_line_id;
    if (source != null && !lineIds.has(source)) {
      throw new Error(`${context} references unknown continuity line '${source}'.`);
    }
  };
  checkContinuity(scene.scene_defaults, "Scene defaults");
  for (const [id, settings] of Object.entries(scene.character_overrides)) {
    checkContinuity(settings, `Character '${id}'`);
  }
  for (const line of scene.lines) {
    checkContinuity(line.overrides, `Line '${line.line_id}'`);
    for (const beat of line.beats) {
      checkContinuity(beat.overrides, `Beat '${beat.beat_id}'`);
    }
  }
}
