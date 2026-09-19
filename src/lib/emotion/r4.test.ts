import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileLine, resolveBeatSettings, resolveLineSettings } from "./compiler.ts";
import { serializePerformance } from "./serializers.ts";
import { CHANNEL_REGIONS } from "./constants.ts";
import { makePerformanceDraft, performanceFraming, sceneTemplate } from "./integration.ts";
import type { Catalog, SceneConfig } from "./types.ts";
import type { Picture } from "../studio/types.ts";
const catalog: Catalog = JSON.parse(
  readFileSync(new URL("../../../public/data/emotion_catalog.json", import.meta.url), "utf8"),
);
const examples: { examples: SceneConfig[] } = JSON.parse(
  readFileSync(new URL("../../data/examples.json", import.meta.url), "utf8"),
);
const fixture = () => structuredClone(examples.examples[0]);

test("R4 catalog preserves unique IDs, all seven authored levels and 32 regions", () => {
  assert.equal(catalog.emotions.length, 81);
  assert.equal(new Set(catalog.emotions.map((e) => e.id)).size, 81);
  assert.equal(new Set(catalog.emotions.map((e) => e.family_id)).size, 10);
  assert.equal(new Set(catalog.emotions.map((e) => e.subfamily_id)).size, 57);
  const variants = catalog.emotions.flatMap((e) => e.variants);
  assert.equal(variants.length, 162);
  assert.equal(new Set(variants.map((v) => v.id)).size, 162);
  for (const emotion of catalog.emotions) {
    assert.deepEqual(
      emotion.levels.map((l) => l.level),
      [1, 2, 3, 4, 5, 6, 7],
    );
    for (const level of emotion.levels) {
      assert.ok(level.felt_state && level.face && level.voice && level.body);
      for (const channel of ["face", "voice", "body"] as const) {
        assert.deepEqual(
          Object.keys(emotion.baseline[channel]).sort(),
          [...CHANNEL_REGIONS[channel]].sort(),
        );
        assert.ok(level.cue_choices[channel].length);
      }
    }
    for (const variant of emotion.variants) {
      assert.deepEqual(
        variant.seven_levels.map((l) => l.level),
        [1, 2, 3, 4, 5, 6, 7],
      );
      assert.ok(variant.seven_levels.every((l) => l.modifier));
    }
  }
});
test("R4 quiet level-seven grief keeps explicit volume and never exports automatic extreme action", () => {
  const scene = fixture();
  const grief = catalog.emotions.find((e) => /grief/i.test(e.label))!;
  scene.lines[0].beats = [];
  scene.lines[0].overrides = {
    felt_layers: [
      {
        role: "dominant",
        selection: { emotion_id: grief.id, variant_id: grief.variants[0].id, intensity: 7 },
        layer_weight: 1,
      },
    ],
    regulation: "suppressed",
    display_allowance: 0.1,
    voice_overrides: {
      loudness: { mode: "replace", instruction: "Keep vocal volume quiet and audible." },
    },
  };
  const out = compileLine(catalog, scene, scene.lines[0]);
  assert.equal(out.performance_json.resolved_settings.felt_layers[0].selection.intensity, 7);
  assert.match(out.delivery_direction, /Keep vocal volume quiet/);
  assert.doesNotMatch(
    out.cinematic!.action,
    /\b(screams?|strikes?|punches|collapses|kneels|tears stream)\b/i,
  );
});
test("R4 generic beat permissions cannot exceed governing line", () => {
  for (const key of [
    "allow_narration",
    "allow_extra_dialogue",
    "allow_nonverbal_vocalizations",
  ] as const) {
    const scene = fixture();
    scene.scene_defaults[key] = false;
    scene.lines[0].overrides[key] = false;
    scene.lines[0].beats = [
      {
        beat_id: "illegal",
        timing: { coordinate: "normalized", start: 0, end: 1 },
        overrides: { [key]: true },
      },
    ];
    assert.throws(
      () => compileLine(catalog, scene, scene.lines[0]),
      /additional properties|cannot escalate/,
    );
    assert.throws(
      () =>
        resolveBeatSettings(
          resolveLineSettings(scene, scene.lines[0]).settings,
          scene.lines[0].beats[0],
        ),
      /cannot escalate/,
    );
  }
});
test("R4 serializers preserve exact Unicode speech once, keep diagnostics out and reject duplicates", () => {
  const scene = fixture();
  const line = scene.lines[0];
  line.spoken_text = "I’ve returned—父亲.\nPlease listen.";
  line.beats = [];
  const out = compileLine(catalog, scene, line);
  for (const profile of ["ltx-prose-1", "h3-ref2va-1"] as const) {
    const result = serializePerformance({
      profile,
      lines: [out],
      speakers: scene.character_baselines,
    });
    assert.equal(result.text.split(line.spoken_text).length - 1, 1);
    assert.doesNotMatch(
      result.text,
      /editorial 0|felt intensity remains level|CUEBOARD|selected_cue_ids/,
    );
    assert.equal(result.fields.non_diegetic_music, "N/A");
    assert.throws(
      () =>
        serializePerformance({
          profile,
          lines: [out],
          speakers: scene.character_baselines,
          basePrompt: line.spoken_text,
        }),
      /duplicate/,
    );
    if (profile.startsWith("h3"))
      assert.ok(result.text.includes(`<d>[English] ${line.spoken_text}</d>`));
  }
});
test("R4 medium/wide shot plan inheritance is explicit and ambiguous coverage does not force camera", () => {
  const p = {
    id: "fixture",
    screenplay: {
      approvedVersionId: "v",
      versions: [{ id: "v", fountain: "INT. ROOM - DAY #s1#\n\nFATHER\nCome home.\n" }],
    },
    characters: [],
    shots: [{ id: "shot", sceneId: "s1", type: "wide" }],
  } as unknown as Picture;
  const config = sceneTemplate(p, "s1", catalog);
  config.scene_defaults.felt_layers = fixture().scene_defaults.felt_layers;
  if (!config.scene_defaults.felt_layers?.length)
    config.scene_defaults.felt_layers = [
      {
        role: "dominant",
        layer_weight: 1,
        selection: {
          emotion_id: catalog.emotions[0].id,
          variant_id: catalog.emotions[0].variants[0].id,
          intensity: 3,
        },
      },
    ];
  for (const size of ["wide", "medium"] as const) {
    p.shots[0].type = size;
    const draft = makePerformanceDraft(p, catalog, config, "fixture");
    assert.equal(draft.compiled[0].performance_json.resolved_settings.framing, size);
    assert.match(draft.compiled[0].resolution_trace.winning_scopes.framing, /Shot plan/);
  }
  p.shots.push({ ...p.shots[0], id: "other", type: "wide" });
  assert.equal(performanceFraming(p, "s1", config.lines[0].line_id).framing, undefined);
  const draft = makePerformanceDraft(p, catalog, config, "fixture");
  assert.doesNotMatch(draft.compiled[0].cinematic!.action, /Hold a close-up/);
  assert.ok(draft.compiled[0].warnings.some((s) => s.includes("ambiguous")));
});

test("R4 keeps existing H3 soundscape and score sections and reports timed-beat limits", () => {
  const scene = fixture(),
    line = scene.lines[0];
  const out = compileLine(catalog, scene, line);
  const result = serializePerformance({
    profile: "h3-ref2va-1",
    lines: [out],
    speakers: scene.character_baselines,
    basePrompt:
      "Begin from <Picture 1>.\n\noverall_soundscape: Approved room tone.\nnon_diegetic_music: Quiet cello.",
  });
  assert.equal(result.fields.overall_soundscape, "Approved room tone.");
  assert.equal(result.fields.non_diegetic_music, "Quiet cello.");
  assert.equal(result.text.split("overall_soundscape:").length, 2);
  assert.ok(result.text.startsWith("Begin from <Picture 1>."));
  if (line.beats.length)
    assert.ok(result.unsupported_controls.some((f) => f.control === "timed_beats"));
});
test("R4 displayed state and regional winning scopes remain independent; empty speech has zero voice budget", () => {
  const scene = fixture(),
    line = scene.lines[0];
  const other = catalog.emotions.find((e) => e.id === "joy") ?? catalog.emotions[1];
  line.overrides.displayed_selection = {
    emotion_id: other.id,
    variant_id: other.variants[0].id,
    intensity: 2,
  };
  line.overrides.regulation = "open";
  scene.scene_defaults.face_overrides = { gaze: { mode: "omit" } };
  line.overrides.face_overrides = { blink: { mode: "omit" } };
  line.beats = [];
  let out = compileLine(catalog, scene, line);
  assert.equal(out.resolution_trace.winning_scopes["face_overrides.gaze"], "scene_default");
  assert.equal(out.resolution_trace.winning_scopes["face_overrides.blink"], "line_override");
  assert.ok(out.performance_json.selected_cue_ids.every((id) => id.startsWith(`${other.id}:`)));
  line.spoken_text = "";
  out = compileLine(catalog, scene, line);
  assert.equal(out.performance_json.resolved_settings.cue_budget.voice, 0);
  assert.equal(out.delivery_direction, "");
  assert.ok(out.performance_json.selected_cue_ids.every((id) => !id.includes(":voice:")));
});
