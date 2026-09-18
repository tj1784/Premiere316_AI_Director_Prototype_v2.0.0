import { parseScreenplayHierarchy } from "../studio/screenplay-hierarchy.ts";
import { approvedPerformanceSource } from "./integration.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sceneTemplate,
  makePerformanceDraft,
  applyPerformanceDrafts,
  isPerformanceDraftStale,
  undoPerformanceDraft,
  performanceReviewPicture,
  performanceSourceKey,
} from "./integration.ts";
import { mapJointPerformanceRequest, jointCapability } from "./joint-generation.ts";
import type { Picture } from "../studio/types.ts";
import type { Catalog } from "./types.ts";
import type { VoiceReferenceManifest } from "../studio/voice-reference.ts";
const catalog = JSON.parse(
  readFileSync(new URL("../../../public/data/emotion_catalog.json", import.meta.url), "utf8"),
) as Catalog;
const screenplay =
  "INT. ROOM - DAY #s1#\n\nA still room.\n\nFATHER\nCome home—now.\n\nSON\nI can’t.\n";
const picture = () =>
  ({
    id: "p",
    screenplay: { approvedVersionId: "v", versions: [{ id: "v", fountain: screenplay }] },
    characters: [],
    shots: [],
  }) as unknown as Picture;
function proposal(p = picture()) {
  const config = sceneTemplate(p, "s1", catalog);
  config.scene_defaults.felt_layers = [
    {
      role: "dominant",
      selection: {
        emotion_id: catalog.emotions[0].id,
        variant_id: catalog.emotions[0].variants[0].id,
        intensity: 3,
      },
      layer_weight: 1,
    },
  ];
  return config;
}
test("dialogue and distinct speakers survive compilation; locked edits and unknown IDs fail closed", () => {
  const p = picture(),
    config = proposal(p),
    draft = makePerformanceDraft(p, catalog, config, "fixture");
  assert.deepEqual(
    draft.compiled.map((l) => [l.character_id, l.spoken_text]),
    config.lines.map((l) => [l.character_id, l.spoken_text]),
  );
  const altered = structuredClone(config);
  altered.lines[0].spoken_text += " narration";
  assert.throws(() => makePerformanceDraft(p, catalog, altered, "fixture"), /locked/);
  const invalid = structuredClone(config);
  invalid.scene_defaults.felt_layers![0].selection.variant_id = "invented";
  assert.throws(() => makePerformanceDraft(p, catalog, invalid, "fixture"));
});
test("versions apply explicitly, can be restored/unapplied, and become stale without altering story or camera", () => {
  const p = picture(),
    before = JSON.stringify(p),
    a = makePerformanceDraft(p, catalog, proposal(p), "fixture", 1),
    b = makePerformanceDraft(p, catalog, proposal(p), "fixture", 2);
  p.emotionPerformance = { schemaVersion: 1, drafts: [a, b], applied: {}, history: [] };
  p.emotionPerformance = applyPerformanceDrafts(p, [b.id]);
  p.emotionPerformance = applyPerformanceDrafts(p, [a.id]);
  assert.equal(p.emotionPerformance.applied.s1, a.id);
  p.emotionPerformance = undoPerformanceDraft(p, "s1");
  assert.equal(p.emotionPerformance.history.length, 3);
  assert.equal(p.emotionPerformance.drafts.length, 2);
  const { emotionPerformance, ...unchanged } = p;
  assert.equal(JSON.stringify(unchanged), before);
  p.screenplay.versions[0].fountain += "\nAn event changes.";
  assert.equal(isPerformanceDraftStale(p, a), true);
  assert.throws(() => applyPerformanceDrafts(p, [a.id]), /fresh/);
});
test("H3 mapping uses actual zero-based V3 autogrow sockets, exact dialogue, no audition text or settings changes", () => {
  const p = picture(),
    draft = makePerformanceDraft(p, catalog, proposal(p), "fixture");
  const sha = "a".repeat(64);
  const manifest = {
    schemaVersion: 1,
    kind: "identity_reference",
    pictureId: "p",
    exportedAt: 1,
    issues: [],
    references: draft.compiled.map((l, i) => ({
      binding: `c${i}`,
      characterId: `c${i}`,
      iterationId: `i${i}`,
      approvalRevision: 2,
      reference: {
        id: `i${i}`,
        characterId: `c${i}`,
        status: "APPROVED",
        revision: 2,
        referenceText: "AUDITION MUST NOT LEAK",
        audio: { sha256: sha, durationSec: 5 },
      },
    })),
  } as unknown as VoiceReferenceManifest;
  const workflow = {
    ref: { class_type: "MiniMaxH3ReferenceToVideo", inputs: { prompt: "old", width: 768 } },
    a0: { class_type: "LoadAudio", inputs: { audio: "first.wav" } },
    a1: { class_type: "LoadAudio", inputs: { audio: "second.wav" } },
    i0: { class_type: "LoadImage", inputs: { image: "first.png" } },
    i1: { class_type: "LoadImage", inputs: { image: "second.png" } },
    sampler: { class_type: "KSampler", inputs: { seed: 42, steps: 12 } },
  };
  const input = {
    mode: "h3-ref2va" as const,
    workflow,
    conditioningNodeId: "ref",
    draft,
    lineIds: draft.compiled.map((l) => l.line_id),
    manifest,
    references: draft.compiled.map((l, i) => ({
      speaker: l.character_id,
      binding: `c${i}`,
      imageNodeId: `i${i}`,
      audioNodeId: `a${i}`,
      imageSha256: sha,
      audioSha256: sha,
    })),
    basePrompt: "Keep camera, wardrobe and props.",
  };
  const mapped = mapJointPerformanceRequest(input);
  assert.deepEqual(mapped.workflow.ref.inputs["ref_audios.ref_audio_0"], ["a0", 0]);
  assert.deepEqual(mapped.workflow.ref.inputs["ref_audios.ref_audio_1"], ["a1", 0]);
  assert.deepEqual(mapped.workflow.sampler, workflow.sampler);
  assert.deepEqual(
    mapped.dialogue.map((l) => l.text),
    draft.compiled.map((l) => l.spoken_text),
  );
  assert.doesNotMatch(JSON.stringify(mapped.workflow), /AUDITION MUST NOT LEAK|TTS/);
  assert.equal(workflow.ref.inputs.prompt, "old");
  assert.throws(() => mapJointPerformanceRequest({ ...input, mode: "h3-fl2va" }), /cannot/);
  assert.equal(jointCapability("ltx-supplied-audio").supported, false);
  manifest.references[0].reference.audio!.durationSec = 49;
  assert.throws(() => mapJointPerformanceRequest(input), /15 seconds/);
});

test("AI context projection preserves source fingerprint and configured writer", () => {
  const p = picture();
  p.screenplay.selectedModelId = "explicit-writer";
  const projected = performanceReviewPicture(p);
  assert.equal(projected.screenplay.selectedModelId, "explicit-writer");
  assert.equal(performanceSourceKey(projected, "s1"), performanceSourceKey(p, "s1"));
});

test("removed dialogue and scenes cannot return through retained hierarchy tombstones", () => {
  const p = picture(),
    old = proposal(p),
    before = makePerformanceDraft(p, catalog, old, "fixture");
  const version = p.screenplay.versions[0];
  version.hierarchy = parseScreenplayHierarchy(
    version.fountain + "\nEXT. GARDEN - DAY #s2#\n\nSON\nGone.\n",
  );
  version.fountain = version.fountain.replace("\n\nSON\nI can’t.\n", "\n");
  const source = approvedPerformanceSource(p);
  assert.ok(source.hierarchy.nodes.every((n) => !n.tombstoned));
  assert.deepEqual(
    sceneTemplate(p, "s1", catalog).lines.map((l) => l.spoken_text),
    ["Come home—now.\n"],
  );
  assert.throws(() => sceneTemplate(p, "s2", catalog), /Unknown scene/);
  assert.throws(() => makePerformanceDraft(p, catalog, old, "fixture"), /locked/);
  assert.equal(isPerformanceDraftStale(p, before), true);
});
