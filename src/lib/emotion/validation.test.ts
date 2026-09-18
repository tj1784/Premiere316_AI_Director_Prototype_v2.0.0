import assert from "node:assert/strict";
import { describe, it } from "node:test";
import examples from "../../data/examples.json" with { type: "json" };
import { assertSceneConfig } from "./validation.ts";
import type { SceneConfig } from "./types.ts";

const catalogVersion = examples.examples[0]!.catalog_version;
const valid = () => {
  const scene: unknown = structuredClone(examples.examples[0]);
  assertSceneConfig(scene, catalogVersion);
  return scene;
};

describe("scene validation", () => {
  it("accepts shipped scenes without changing words or adding defaults", () => {
    for (const scene of examples.examples) {
      const before = JSON.stringify(scene);
      assertSceneConfig(scene, catalogVersion);
      assert.equal(JSON.stringify(scene), before);
    }
  });

  it("rejects incomplete structures before editor access", () => {
    for (const scene of [null, [], {}, { scene_id: "bad_import", lines: [{ line_id: "bad_line" }] }]) {
      assert.throws(() => assertSceneConfig(scene, catalogVersion), /Invalid scene/);
    }
  });

  it("rejects unsupported schema and catalog versions", () => {
    const scene = valid();
    scene.schema_version = "999";
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /Invalid scene/);
    scene.schema_version = "1.0.0";
    scene.catalog_version = "999";
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /Unsupported catalog version/);
  });

  it("rejects invalid controls and extra fields instead of dropping them", () => {
    const scene = valid();
    scene.lines[0]!.overrides.display_allowance = 2;
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /Invalid scene/);
    scene.lines[0]!.overrides = { surprise_field: true } as unknown as SceneConfig["scene_defaults"];
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /additional properties/);
  });

  it("rejects duplicate line and beat IDs", () => {
    const scene = valid();
    scene.lines.push(structuredClone(scene.lines[0]!));
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /Duplicate line ID/);
    scene.lines.pop();
    scene.lines[0]!.beats.push(structuredClone(scene.lines[0]!.beats[0]!));
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /duplicate beat ID/);
  });

  it("rejects missing character and continuity references", () => {
    const scene = valid();
    scene.lines[0]!.character_id = "missing_character";
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /unknown character/);
    scene.lines[0]!.character_id = Object.keys(scene.character_baselines)[0]!;
    scene.character_overrides.missing_character = {};
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /has no character baseline/);
    delete scene.character_overrides.missing_character;
    scene.lines[0]!.overrides.continuity = { from_line_id: "missing_line", restart_onset: false };
    assert.throws(() => assertSceneConfig(scene, catalogVersion), /unknown continuity line/);
  });

  it("rejects negative, fractional text, and out-of-range normalized beat coordinates", () => {
    const scene = valid();
    for (const timing of [
      { coordinate: "seconds", start: -2, end: 1 },
      { coordinate: "normalized", start: -1, end: 0.5 },
      { coordinate: "normalized", start: 0, end: 1.1 },
      { coordinate: "text_codepoints", start: 0.5, end: 1 },
    ]) {
      scene.lines[0]!.beats[0]!.timing = timing as SceneConfig["lines"][number]["beats"][number]["timing"];
      assert.throws(() => assertSceneConfig(scene, catalogVersion), /Invalid scene/);
    }
  });
});
