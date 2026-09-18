import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compileLine, CompileError, indexCatalog, packetText } from "./compiler.ts";
import { mergeSettings } from "./merge.ts";
import type { Catalog, SceneConfig, VoiceRegion } from "./types.ts";

const catalog = JSON.parse(
  readFileSync(new URL("../../../public/data/emotion_catalog.json", import.meta.url), "utf8"),
) as Catalog;
const examples = JSON.parse(
  readFileSync(new URL("../../data/examples.json", import.meta.url), "utf8"),
) as { examples: SceneConfig[] };

function sceneById(id: string) {
  const found = examples.examples.find((scene) => scene.scene_id === id);
  assert.ok(found, id);
  return found;
}

describe("mergeSettings", () => {
  it("replaces arrays instead of concatenating", () => {
    assert.deepEqual(mergeSettings({ layers: [1, 2] }, { layers: [] }), { layers: [] });
  });
  it("inherits omitted keys", () => {
    assert.deepEqual(mergeSettings({ value: 7 }, {}), { value: 7 });
  });
  it("clears with null", () => {
    assert.deepEqual(mergeSettings({ value: 7 }, { value: null }), { value: null });
  });
  it("replaces regional controls as a unit", () => {
    assert.deepEqual(
      mergeSettings(
        { face: { gaze: { mode: "replace", instruction: "Hold gaze" } } },
        { face: { gaze: { mode: "omit" } } },
      ),
      { face: { gaze: { mode: "omit" } } },
    );
  });
});

describe("compileLine contract", () => {
  it("preserves confession dialogue byte-for-byte", () => {
    const scene = sceneById("confession");
    const line = scene.lines[0]!;
    const out = compileLine(catalog, scene, line);
    assert.equal(out.spoken_text, line.spoken_text);
    assert.equal(out.character_id, "younger_son");
    assert.equal(out.sound_events.length, 0);
    assert.ok(out.unsupported_controls.length > 0);
    assert.deepEqual(
      out.performance_json.resolved_beats.map((beat) => beat.beat_id),
      line.beats.map((beat) => beat.beat_id),
    );
    assert.ok(out.performance_json.selected_cue_ids.length > 0);
    assert.ok(!out.spoken_text.includes("sadly"));
  });

  it("keeps a silent reaction empty and omits delivery", () => {
    const scene = sceneById("concealed_fear");
    const line = scene.lines[0]!;
    const out = compileLine(catalog, scene, line);
    assert.equal(out.spoken_text, "");
    assert.equal(out.delivery_direction, "");
    assert.equal(out.sound_events.length, 0);
    assert.match(out.video_direction, /silent|composure|containment|calm/i);
    assert.doesNotMatch(out.video_direction.toLowerCase(), /walk|feet|full-body/);
  });

  it("compiles restrained reunion without inventing speech", () => {
    const scene = sceneById("restrained_reunion");
    const line = scene.lines[0]!;
    const out = compileLine(catalog, scene, line);
    assert.equal(out.spoken_text, "I thought you would be here.");
    assert.ok(out.delivery_direction.length > 0);
    assert.ok(out.video_direction.length > 0);
  });

  it("is deterministic for the same payload", () => {
    const scene = sceneById("confession");
    const a = compileLine(catalog, scene, scene.lines[0]!);
    const b = compileLine(catalog, scene, scene.lines[0]!);
    assert.deepEqual(a.performance_json.selected_cue_ids, b.performance_json.selected_cue_ids);
    assert.equal(a.video_direction, b.video_direction);
  });

  it("rejects a payload with no felt selection", () => {
    const scene = structuredClone(sceneById("restrained_reunion"));
    scene.scene_defaults.felt_layers = [];
    scene.lines[0]!.overrides.felt_layers = [];
    assert.throws(() => compileLine(catalog, scene, scene.lines[0]!), CompileError);
  });

  it("indexes 81 emotions and 162 variants", () => {
    const view = indexCatalog(catalog);
    assert.equal(view.byId.size, 81);
    assert.equal(view.variantOf.size, 162);
  });
});

function editableScene() {
  const scene = structuredClone(sceneById("confession"));
  scene.character_overrides = {};
  scene.lines = [scene.lines[0]!];
  scene.lines[0]!.beats = [];
  scene.lines[0]!.overrides = {
    felt_layers: [
      {
        role: "dominant",
        selection: { emotion_id: "anger", variant_id: "anger__boundary_defense", intensity: 7 },
        layer_weight: 1,
      },
    ],
  };
  return scene;
}

describe("compiler control regressions", () => {
  it("keeps rejected preset prose in diagnostics and out of the copyable packet", () => {
    const scene = structuredClone(sceneById("restrained_reunion"));
    const output = compileLine(catalog, scene, scene.lines[0]!);
    const rejected = "Allow a laugh-colored texture to replace an explanatory sentence.";
    assert.ok(output.warnings.some((warning) => warning.includes(rejected)));
    assert.ok(JSON.stringify(output).includes(rejected));
    const packet = packetText(output);
    assert.ok(!packet.includes(rejected));
    assert.ok(packet.includes(`${output.warnings.length} warning(s)`));
    assert.match(packet, /Review the detailed warnings separately/);
  });

  it("exports every eligible authored voice replacement", () => {
    const replacements: Partial<Record<VoiceRegion, string>> = {
      pitch_register: "Keep pitch centered on the established baseline.",
      pitch_range_contour: "Use a narrow falling contour.",
      tempo_rhythm: "Use an even tempo.",
      stress: "Keep emphasis on the first authorized word.",
      articulation: "Keep consonants crisp.",
      resonance: "Preserve familiar resonance.",
      breath_phrasing: "Use comfortable speech breathing.",
      pauses: "Pause after each complete clause.",
      loudness: "Keep conversational volume.",
      texture: "Keep the texture smooth.",
    };
    for (const [region, instruction] of Object.entries(replacements)) {
      const scene = editableScene();
      const line = scene.lines[0]!;
      line.overrides.voice_overrides = { [region]: { mode: "replace", instruction } };
      const output = compileLine(catalog, scene, line);
      assert.ok(output.delivery_direction.includes(instruction), region);
      assert.ok(
        output.performance_json.selected_cue_ids.some((id) => id.endsWith(`:replace:${region}`)),
        region,
      );
    }
  });

  it("does not resurrect omitted or invisible regions through a modifier", () => {
    const scene = editableScene();
    const line = scene.lines[0]!;
    line.overrides.body_overrides = {
      gait: { mode: "omit" },
      legs_feet: { mode: "omit" },
      hands_fingers: { mode: "omit" },
    };
    const output = compileLine(catalog, scene, line);
    assert.ok(!output.video_direction.includes("Place a palm, a step or a prop"));
    assert.ok(output.warnings.some((warning) => warning.includes("anger__boundary_defense:body")));
    line.overrides.region_filters = { face: [], voice: [], body: [] };
    const excluded = compileLine(catalog, scene, line);
    assert.deepEqual(excluded.performance_json.selected_cue_ids, []);
    assert.ok(!excluded.video_direction.includes("Aim the eyes"));
    assert.ok(!excluded.delivery_direction.includes("Give the limit a complete falling cadence"));
  });

  it("checks secondary regions in complete cues and authored replacements", () => {
    const scene = editableScene();
    const line = scene.lines[0]!;
    line.overrides.face_overrides = {
      gaze: { mode: "replace", instruction: "Look forward while stepping back." },
    };
    const output = compileLine(catalog, scene, line);
    assert.ok(!output.video_direction.includes("Look forward while stepping back"));
    assert.ok(output.warnings.some((warning) => warning.includes("unavailable in close_up")));
    const copy = structuredClone(catalog);
    const anger = copy.emotions.find((emotion) => emotion.id === "anger")!;
    anger.levels[6]!.cue_choices.face[0] = {
      region: "gaze",
      text: "Look forward while tightening the jaw.",
    };
    line.overrides.face_overrides = { jaw_chin: { mode: "omit" } };
    const compound = compileLine(copy, scene, line);
    assert.ok(!compound.video_direction.includes("Look forward while tightening the jaw"));
    line.overrides.voice_overrides = {
      tempo_rhythm: { mode: "replace", instruction: "Speak slowly while walking backward." },
    };
    const walking = compileLine(catalog, scene, line);
    assert.ok(!walking.delivery_direction.includes("Speak slowly while walking backward"));
  });

  it("does not mistake delivery metaphors for hidden body movement", () => {
    const scene = editableScene();
    const line = scene.lines[0]!;
    line.overrides.voice_overrides = {
      pauses: {
        mode: "replace",
        instruction: "Pause between each comic wave; let the last phrase carry weight.",
      },
    };
    const output = compileLine(catalog, scene, line);
    assert.ok(
      output.delivery_direction.includes(
        "Pause between each comic wave; let the last phrase carry weight.",
      ),
    );
  });

  it("withholds preset instructions that replace dialogue and preserves exact Unicode speech", () => {
    const scene = structuredClone(sceneById("restrained_reunion"));
    const line = scene.lines[0]!;
    line.spoken_text = "  I thought—yes, you—would be here. 🥲\n";
    const output = compileLine(catalog, scene, line);
    assert.equal(output.spoken_text, line.spoken_text);
    assert.ok(!output.delivery_direction.includes("replace an explanatory sentence"));
    assert.ok(
      output.warnings.some((warning) => warning.includes("changed, additional, or omitted speech")),
    );
  });

  it("rejects negative beat coordinates and incomplete inherited selections", () => {
    for (const coordinate of ["seconds", "normalized", "text_codepoints"] as const) {
      const scene = editableScene();
      const line = scene.lines[0]!;
      line.beats = [
        { beat_id: "invalid", timing: { coordinate, start: -1, end: 1 }, overrides: {} },
      ];
      assert.throws(() => compileLine(catalog, scene, line), CompileError);
    }
    const scene = editableScene();
    scene.lines[0]!.overrides.displayed_selection = { emotion_id: "calm" } as never;
    assert.throws(() => compileLine(catalog, scene, scene.lines[0]!), CompileError);
  });

  it("derives framing defaults after line and beat overrides", () => {
    const scene = editableScene();
    delete scene.scene_defaults.cue_budget;
    const line = scene.lines[0]!;
    line.overrides.framing = "medium";
    line.beats = [
      {
        beat_id: "audio",
        timing: { coordinate: "normalized", start: 0, end: 1 },
        overrides: { framing: "audio_only" },
      },
    ];
    const output = compileLine(catalog, scene, line);
    assert.deepEqual(output.performance_json.resolved_settings.cue_budget, {
      face: 2,
      voice: 2,
      body: 2,
    });
    assert.deepEqual(output.performance_json.resolved_beats[0]!.resolved_settings.cue_budget, {
      face: 0,
      voice: 3,
      body: 0,
    });
    assert.equal(output.performance_json.resolved_beats[0]!.visual_direction, "");
    line.overrides.cue_budget = { face: 1, voice: 1, body: 1 };
    const explicit = compileLine(catalog, scene, line);
    assert.deepEqual(explicit.performance_json.resolved_beats[0]!.resolved_settings.cue_budget, {
      face: 1,
      voice: 1,
      body: 1,
    });
  });

  it("exports context and mixed internal intent without layering conflicting gestures", () => {
    const scene = editableScene();
    const line = scene.lines[0]!;
    line.overrides.objective = "Protect their dignity.";
    line.overrides.relationship_context = "The listener is a trusted friend.";
    line.overrides.felt_layers!.push({
      role: "secondary",
      selection: { emotion_id: "joy", variant_id: "joy__private_savoring", intensity: 3 },
      layer_weight: 0.2,
    });
    const output = compileLine(catalog, scene, line);
    assert.match(output.video_direction, /Protect their dignity/);
    assert.match(output.delivery_direction, /trusted friend/);
    assert.match(output.video_direction, /Internal secondary feeling: Joy/);
    assert.ok(!output.performance_json.selected_cue_ids.some((id) => id.startsWith("joy:")));
    line.overrides.display_allowance = 0;
    const zero = compileLine(catalog, scene, line);
    assert.match(zero.video_direction, /Outward display allowance: 0 /);
    assert.ok(zero.performance_json.selected_cue_ids.every((id) => id.includes(":voice:")));
  });

  it("keeps replacements within the shared per-channel budget", () => {
    const scene = editableScene();
    const line = scene.lines[0]!;
    line.overrides.cue_budget = { face: 1, voice: 1, body: 0 };
    line.overrides.face_overrides = {
      gaze: { mode: "replace", instruction: "Look steadily forward." },
      jaw_chin: { mode: "replace", instruction: "Release the jaw." },
    };
    const output = compileLine(catalog, scene, line);
    assert.equal(
      output.performance_json.selected_cue_ids.filter((id) => id.includes(":face:")).length,
      1,
    );
    assert.ok(output.warnings.some((warning) => warning.includes("cue budget is full")));
  });
});
