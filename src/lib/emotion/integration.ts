import type { Picture } from "../studio/types.ts";
import { parseScreenplayHierarchy } from "../studio/screenplay-hierarchy.ts";
import { stableVoiceJson } from "../studio/voice-reconciliation.mjs";
import { stableHash } from "../production/dependency-graph.ts";
import { DEFAULT_ADAPTER } from "./constants.ts";
import { compileScene } from "./compiler.ts";
import { assertSceneConfig } from "./validation.ts";
import type { Catalog, SceneConfig, CompiledOutput } from "./types.ts";

export type PerformanceDraft = {
  id: string;
  sceneId: string;
  createdAt: number;
  modelId: string;
  source: string;
  config: SceneConfig;
  compiled: CompiledOutput[];
  prompt: string;
};
export type EmotionWorkspace = {
  schemaVersion: 1;
  drafts: PerformanceDraft[];
  applied: Record<string, string>;
  history: Array<{ sceneId: string; draftId: string | null; at: number }>;
};
export const emptyEmotionWorkspace = (): EmotionWorkspace => ({
  schemaVersion: 1,
  drafts: [],
  applied: {},
  history: [],
});
export const cueboardId = (value: string) =>
  "p_" +
  Array.from(new TextEncoder().encode(value), (b) => b.toString(16).padStart(2, "0")).join("");
/** Send story/context metadata, never embedded recordings, image bytes or unrelated job archives. */
export function performanceReviewPicture(picture: Picture): Picture {
  const { version } = approvedPerformanceSource(picture);
  return {
    id: picture.id,
    screenplay: { ...picture.screenplay, versions: [version] },
    characters: picture.characters,
    shots: picture.shots,
    production: picture.production
      ? {
          assets: picture.production.assets.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            tombstone: a.tombstone,
            canonicalSpec: a.canonicalSpec,
            approvedIterationId: a.approvedIterationId,
            iterations: a.iterations.map((i) => ({
              id: i.id,
              mediaSha256: i.mediaSha256,
              status: i.status,
            })),
          })),
        }
      : undefined,
    performance: picture.performance ? { beats: picture.performance.beats } : undefined,
    characterVoiceDesigns: { selections: picture.characterVoiceDesigns?.selections },
  } as Picture;
}
export function approvedPerformanceSource(picture: Picture) {
  const version = picture.screenplay.versions.find(
    (v) => v.id === picture.screenplay.approvedVersionId,
  );
  if (!version) throw new Error("Approve a screenplay before reviewing performance.");
  const hierarchy = parseScreenplayHierarchy(version.fountain, version.hierarchy ?? undefined);
  const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
  const live = (node: (typeof hierarchy.nodes)[number]): boolean => {
    const seen = new Set<string>();
    for (
      let current: typeof node | undefined = node;
      current;
      current = current.parentId ? byId.get(current.parentId) : undefined
    ) {
      if (current.tombstoned || seen.has(current.id)) return false;
      seen.add(current.id);
    }
    return true;
  };
  return { version, hierarchy: { ...hierarchy, nodes: hierarchy.nodes.filter(live) } };
}
export function performanceSourceKey(picture: Picture, sceneId: string) {
  const { version, hierarchy } = approvedPerformanceSource(picture);
  const scene = hierarchy.nodes.find((n) => n.kind === "scene" && n.id === sceneId);
  if (!scene) throw new Error("Scene is no longer in the approved screenplay.");
  // This is a source snapshot, not a security hash. Every relevant source remains reviewable.
  return stableHash({
    version: version.id,
    screenplay: version.fountain,
    scene: scene.fountain,
    liveNodes: hierarchy.nodes.map((n) => [n.id, n.parentId, n.fountain]),
    characters: picture.characters,
    assets: picture.production?.assets.map((a) => ({
      id: a.id,
      canonicalSpec: a.canonicalSpec,
      approvedIterationId: a.approvedIterationId,
      iterations: a.iterations.map((i) => ({ id: i.id, hash: i.mediaSha256, status: i.status })),
    })),
    shots: picture.shots.filter((s) => s.sceneId === sceneId),
    beats: picture.performance?.beats.filter((b) => b.sceneId === sceneId),
    selections: picture.characterVoiceDesigns?.selections,
  });
}
export function sceneTemplate(picture: Picture, sceneId: string, catalog: Catalog): SceneConfig {
  const { hierarchy } = approvedPerformanceSource(picture);
  if (!hierarchy.nodes.some((n) => n.id === sceneId && n.kind === "scene"))
    throw new Error("Unknown scene.");
  const dialogue = hierarchy.nodes.filter((n) => n.kind === "dialogue" && n.parentId === sceneId);
  const baselines: SceneConfig["character_baselines"] = {};
  const lines = dialogue.map((n) => {
    // The screenplay cue is a stable speaker identity until an explicit casting binding is supplied.
    const speaker = cueboardId(n.title);
    baselines[speaker] = { label: n.title, voice_reference: null, identity_locked: true };
    const body = n.fountain.replace(/^[^\r\n]*(?:\r\n|\n|\r)/, "");
    // Fountain parentheticals are stage directions, never spoken dialogue.
    const spoken = body
      .split(/\r\n|\n|\r/)
      .filter((line) => !/^\s*\(.*\)\s*$/.test(line))
      .join("\n");
    return {
      line_id: cueboardId(n.id),
      character_id: speaker,
      spoken_text: spoken,
      duration_seconds: null,
      overrides: {},
      beats: [],
      authored_sound_events: [],
    };
  });
  for (const beat of picture.performance?.beats.filter(
    (b) => b.sceneId === sceneId && b.kind === "reaction",
  ) ?? [])
    for (const id of beat.dependencies.requiredCharacters) {
      const character =
        picture.production?.assets.find((a) => a.id === id && !a.tombstone) ??
        picture.characters.find((c) => c.id === id);
      if (!character) throw new Error("A silent reaction has an unresolved character assignment.");
      const speaker = cueboardId(character.name.toUpperCase());
      baselines[speaker] = { label: character.name, voice_reference: null, identity_locked: true };
      lines.push({
        line_id: cueboardId(`reaction:${beat.id}:${id}`),
        character_id: speaker,
        spoken_text: "",
        duration_seconds: null,
        overrides: {},
        beats: [],
        authored_sound_events: [],
      });
    }
  return {
    schema_version: "1.0.0",
    catalog_version: catalog.catalog_version,
    scene_id: cueboardId(sceneId),
    character_baselines: baselines,
    scene_defaults: {
      allow_narration: false,
      allow_extra_dialogue: false,
      allow_nonverbal_vocalizations: false,
    },
    character_overrides: {},
    lines,
    adapter: structuredClone(DEFAULT_ADAPTER),
  };
}
export function makePerformanceDraft(
  picture: Picture,
  catalog: Catalog,
  proposal: unknown,
  modelId: string,
  now = Date.now(),
): PerformanceDraft {
  assertSceneConfig(proposal, catalog.catalog_version);
  const sceneId = approvedPerformanceSource(picture).hierarchy.nodes.find(
    (n) => n.kind === "scene" && cueboardId(n.id) === proposal.scene_id,
  )?.id;
  if (!sceneId) throw new Error("Unknown source scene.");
  const expected = sceneTemplate(picture, sceneId, catalog);
  const identity = (config: SceneConfig) =>
    config.lines.map((l) => [l.line_id, l.character_id, l.spoken_text, l.duration_seconds]);
  if (
    stableVoiceJson(identity(proposal)) !== stableVoiceJson(identity(expected)) ||
    stableVoiceJson(proposal.character_baselines) !==
      stableVoiceJson(expected.character_baselines) ||
    stableVoiceJson(proposal.adapter) !== stableVoiceJson(expected.adapter)
  )
    throw new Error(
      "A proposal changed locked dialogue, speaker identity, timing, references or adapter.",
    );
  const settings = [
    proposal.scene_defaults,
    ...Object.values(proposal.character_overrides),
    ...proposal.lines.flatMap((l) => [l.overrides, ...l.beats.map((b) => b.overrides)]),
  ];
  if (
    settings.some(
      (s) =>
        s.allow_narration ||
        s.allow_extra_dialogue ||
        s.allow_nonverbal_vocalizations ||
        s.allowed_sound_events?.length,
    ) ||
    proposal.lines.some((l) => l.authored_sound_events.length)
  )
    throw new Error("Additional speech or sound events are not permitted in this production path.");
  const compiled = compileScene(catalog, proposal);
  const prompt = compiled
    .map(
      (l) =>
        `${proposal.character_baselines[l.character_id].label}\nExact dialogue: ${JSON.stringify(l.spoken_text)}\nActing: ${l.video_direction}\nDelivery: ${l.delivery_direction}`,
    )
    .join("\n\n");
  return {
    id: crypto.randomUUID(),
    sceneId,
    createdAt: now,
    modelId,
    source: performanceSourceKey(picture, sceneId),
    config: structuredClone(proposal),
    compiled,
    prompt,
  };
}
export function isPerformanceDraftStale(picture: Picture, draft: PerformanceDraft) {
  try {
    return draft.source !== performanceSourceKey(picture, draft.sceneId);
  } catch {
    return true;
  }
}
export function applyPerformanceDrafts(
  picture: Picture,
  ids: string[],
  now = Date.now(),
): EmotionWorkspace {
  const state = picture.emotionPerformance ?? emptyEmotionWorkspace();
  const applied = { ...state.applied },
    history = [...state.history];
  for (const id of ids) {
    const draft = state.drafts.find((d) => d.id === id);
    if (!draft || isPerformanceDraftStale(picture, draft))
      throw new Error("Review a fresh draft before applying it.");
    applied[draft.sceneId] = id;
    history.push({ sceneId: draft.sceneId, draftId: id, at: now });
  }
  return { ...state, applied, history };
}
export function undoPerformanceDraft(
  picture: Picture,
  sceneId: string,
  now = Date.now(),
): EmotionWorkspace {
  const state = picture.emotionPerformance ?? emptyEmotionWorkspace();
  const applied = { ...state.applied };
  delete applied[sceneId];
  return { ...state, applied, history: [...state.history, { sceneId, draftId: null, at: now }] };
}
