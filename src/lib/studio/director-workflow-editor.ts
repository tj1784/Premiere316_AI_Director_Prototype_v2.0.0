import type { ProdigalDirectorScene } from "./prodigal-director-types.ts";
import type { DirectorImageGuide } from "./director-image-guides.ts";

type RecordValue = Record<string, unknown>;
type Patch = { path: string[]; value?: unknown; remove?: true };
export type DirectorWorkflowDraft = { sourceRevision: string; draftJson: string; updatedAt: number };
export const DIRECTOR_IMAGE_REF_PREFIX = "premiere316-image://";
export const DIRECTOR_DRAFT_LIMIT = 500_000;

const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const imageRef = (sha256: string) => `${DIRECTOR_IMAGE_REF_PREFIX}${sha256}`;
function nodes(graph: RecordValue): RecordValue[] {
  const own = Array.isArray(graph.nodes) ? graph.nodes.filter(record) : [];
  const subgraphs = record(graph.definitions) && Array.isArray(graph.definitions.subgraphs) ? graph.definitions.subgraphs.filter(record) : [];
  return [...own, ...subgraphs.flatMap(nodes)];
}
function parseGraph(json: string): RecordValue {
  let graph: unknown;
  try { graph = JSON.parse(json); } catch { throw new Error("Workflow JSON is incomplete or invalid. Fix it before validating or exporting."); }
  if (!record(graph) || !Array.isArray(graph.nodes)) throw new Error("The workflow must contain a nodes array.");
  return graph;
}
function timelineOf(node: RecordValue): RecordValue {
  const properties = record(node.properties) ? node.properties : {};
  const timeline: unknown = typeof properties.timeline_data === "string" ? JSON.parse(properties.timeline_data) : properties.timeline_data;
  if (!record(timeline) || !Array.isArray(timeline.segments)) throw new Error("The Director timeline is missing or invalid.");
  return timeline;
}
function setDirectorTimeline(node: RecordValue, timeline: RecordValue) {
  const properties = record(node.properties) ? node.properties : {};
  const previousTimeline = properties.timeline_data;
  const previousLocal = properties.local_prompts;
  const serialized = JSON.stringify(timeline);
  const segments = (timeline.segments as unknown[]).filter(record);
  const local = segments.map((segment) => segment.prompt).join(" | ");
  node.properties = { ...properties, timeline_data: serialized, local_prompts: local, global_prompt: timeline.global_prompt };
  if (Array.isArray(node.widgets_values)) node.widgets_values = node.widgets_values.map((value) => value === previousTimeline ? serialized : value === previousLocal ? local : value);
  if (record(node.widgets_values_named)) node.widgets_values_named = { ...node.widgets_values_named, timeline_data: serialized, local_prompts: local, global_prompt: timeline.global_prompt };
}

/** Full editable graph, with stable image references instead of encoded image payloads. */
export function createDirectorEditorJson(source: unknown, scene: ProdigalDirectorScene, prompts: Record<string, string>, guides?: Record<string, DirectorImageGuide>): string {
  const graph = parseGraph(JSON.stringify(source));
  // Comfy's positional widgets are authoritative; old named snapshots can be stale.
  for (const node of nodes(graph)) if (record(node.widgets_values_named) && Array.isArray(node.widgets_values)) {
    const values = node.widgets_values;
    node.widgets_values_named = Object.fromEntries(Object.keys(node.widgets_values_named).map((key, index) => [key, index < values.length ? values[index] : node.widgets_values_named && (node.widgets_values_named as RecordValue)[key]]));
  } else if (record(node.widgets_values_named) && record(node.widgets_values)) node.widgets_values_named = { ...node.widgets_values_named, ...node.widgets_values };
  const directors = nodes(graph).filter((node) => node.type === "LTXDirector");
  if (directors.length !== 1) throw new Error("Expected one Director node in the scene.");
  const director = directors[0];
  const timeline = timelineOf(director);
  const segments = (timeline.segments as unknown[]).filter(record);
  if (segments.length !== scene.segments.length) throw new Error("The source timeline does not match this scene.");
  timeline.segments = segments.map((segment) => {
    const sourceSegment = scene.segments.find((item) => item.segmentId === segment.id);
    if (!sourceSegment) throw new Error("The source timeline contains an unknown segment.");
    const guide = guides ? guides[sourceSegment.segmentId] : sourceSegment.startImage;
    if (!guide) throw new Error(`${sourceSegment.shotId}: no existing starting image is attached.`);
    return { ...segment, prompt: prompts[sourceSegment.shotId] ?? sourceSegment.prompt, imageFile: "", imageB64: imageRef(guide.sha256) };
  });
  setDirectorTimeline(director, timeline);
  return JSON.stringify(graph, null, 2);
}

/** A changed image selection reuses the existing media while retaining workflow and prompt edits. */
export function rebindDirectorEditorImages(json: string, baselineJson: string, guides: Record<string, DirectorImageGuide>): string {
  const graph = parseGraph(normalizeDirectorEditorJson(json, baselineJson));
  const director = nodes(graph).find((node) => node.type === "LTXDirector");
  if (!director) throw new Error("The Director node is missing.");
  const timeline = timelineOf(director);
  timeline.segments = (timeline.segments as unknown[]).map((segment) => {
    if (!record(segment) || !guides[String(segment.id)]) return segment;
    const { imgObj: _imageObject, ...rest } = segment;
    return { ...rest, imageFile: "", imageB64: imageRef(guides[String(segment.id)].sha256) };
  });
  setDirectorTimeline(director, timeline);
  return JSON.stringify(graph, null, 2);
}

/** Mirror an edited setting to equivalent serialized copies; ambiguous edits require a correction. */
export function normalizeDirectorEditorJson(draftJson: string, baselineJson: string): string {
  const graph = parseGraph(draftJson), baseline = parseGraph(baselineJson);
  const baselineNodes = nodes(baseline);
  for (const node of nodes(graph)) {
    const old = baselineNodes.find((item) => item.id === node.id && item.type === node.type);
    if (!old || !record(old.widgets_values_named)) continue;
    const oldNamed = old.widgets_values_named;
    const named = record(node.widgets_values_named) ? node.widgets_values_named : null;
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : null;
    const objectValues = record(node.widgets_values) ? node.widgets_values : null;
    const oldValues = Array.isArray(old.widgets_values) ? old.widgets_values : [];
    const props = record(node.properties) ? node.properties : null;
    const oldProps = record(old.properties) ? old.properties : {};
    for (const [index, key] of Object.keys(oldNamed).entries()) {
      const fields: Array<{ object: RecordValue | unknown[]; key: string | number; value: unknown }> = [];
      if (named && key in named) fields.push({ object: named, key, value: named[key] });
      if (values && index < oldValues.length && equal(oldValues[index], oldNamed[key])) fields.push({ object: values, key: index, value: values[index] });
      if (objectValues && record(old.widgets_values) && key in old.widgets_values && equal(old.widgets_values[key], oldNamed[key])) fields.push({ object: objectValues, key, value: objectValues[key] });
      if (props && key in oldProps && equal(oldProps[key], oldNamed[key])) fields.push({ object: props, key, value: props[key] });
      const changed = fields.filter((field) => !equal(field.value, oldNamed[key]));
      if (!changed.length) continue;
      if (changed.some((field) => !equal(field.value, changed[0].value))) throw new Error(`Node ${String(node.id)} has conflicting copies of ${key}. Use the same value in each edited copy.`);
      for (const field of fields) (field.object as RecordValue)[String(field.key)] = changed[0].value;
    }
    if (node.type === "LTXDirector") {
      const oldTimeline = timelineOf(old), timeline = timelineOf(node);
      const properties = record(node.properties) ? node.properties : {};
      const propertyGlobalChanged = !equal(properties.global_prompt, oldTimeline.global_prompt);
      const timelineGlobalChanged = !equal(timeline.global_prompt, oldTimeline.global_prompt);
      if (propertyGlobalChanged && timelineGlobalChanged && !equal(properties.global_prompt, timeline.global_prompt)) throw new Error("The Director global prompt has conflicting copies. Use the same direction in its timeline and properties.");
      if (propertyGlobalChanged && !timelineGlobalChanged) timeline.global_prompt = properties.global_prompt;
      const oldLocal = (oldTimeline.segments as unknown[]).filter(record).map((segment) => segment.prompt).join(" | ");
      const local = (timeline.segments as unknown[]).filter(record).map((segment) => segment.prompt).join(" | ");
      if (properties.local_prompts !== oldLocal && properties.local_prompts !== local) throw new Error("Edit segment prompts in timeline_data or the scene prompt controls so each prompt stays attached to its segment.");
      setDirectorTimeline(node, timeline);
    }
  }
  return JSON.stringify(graph, null, 2);
}

export function updateDirectorEditorPrompt(json: string, baselineJson: string, segmentId: string | null, text: string): string {
  const graph = parseGraph(normalizeDirectorEditorJson(json, baselineJson));
  const director = nodes(graph).find((node) => node.type === "LTXDirector");
  if (!director) throw new Error("The Director node is missing.");
  const timeline = timelineOf(director);
  if (segmentId === null) timeline.global_prompt = text;
  else timeline.segments = (timeline.segments as unknown[]).map((segment) => record(segment) && segment.id === segmentId ? { ...segment, prompt: text } : segment);
  setDirectorTimeline(director, timeline);
  return JSON.stringify(graph, null, 2);
}

export function directorEditorPrompts(json: string): { globalPrompt: string; segments: Record<string, string> } {
  const director = nodes(parseGraph(json)).find((node) => node.type === "LTXDirector");
  if (!director) throw new Error("The Director node is missing.");
  const timeline = timelineOf(director);
  return { globalPrompt: String(timeline.global_prompt ?? ""), segments: Object.fromEntries((timeline.segments as unknown[]).filter(record).map((segment) => [String(segment.id), String(segment.prompt ?? "")])) };
}

/** Restore only verified source images; unknown references and pasted payloads fail closed. */
export function restoreDirectorEditorImages(draftJson: string, baselineJson: string, images: Record<string, string>): string {
  const graph = parseGraph(normalizeDirectorEditorJson(draftJson, baselineJson));
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (value.startsWith("data:image/")) throw new Error("Keep image references in the editor; use the supplied verified starting images.");
      if (value.startsWith(DIRECTOR_IMAGE_REF_PREFIX)) {
        const sha = value.slice(DIRECTOR_IMAGE_REF_PREFIX.length);
        if (!/^[a-f0-9]{64}$/.test(sha) || !images[sha] || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(images[sha])) throw new Error("A starting-image reference is missing or changed. Reload the source workflow.");
        return images[sha];
      }
      if (value.trimStart().startsWith("{")) {
        try { return JSON.stringify(replace(JSON.parse(value))); } catch (error) {
          if (error instanceof SyntaxError) return value;
          throw error;
        }
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  return JSON.stringify(replace(graph));
}

export function encodeDirectorDraft(baselineJson: string, draftJson: string): string {
  const patches: Patch[] = [];
  const visit = (before: unknown, after: unknown, path: string[]) => {
    if (equal(before, after)) return;
    if (record(before) && record(after)) {
      for (const key of Object.keys(before)) if (!(key in after)) patches.push({ path: [...path, key], remove: true });
      for (const [key, value] of Object.entries(after)) visit(before[key], value, [...path, key]);
    } else if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      after.forEach((value, index) => visit(before[index], value, [...path, String(index)]));
    } else patches.push({ path, value: after });
  };
  visit(parseGraph(baselineJson), parseGraph(draftJson), []);
  const json = JSON.stringify({ schemaVersion: 1, patches });
  if (json.length > DIRECTOR_DRAFT_LIMIT) throw new Error("This workflow edit is too large to save in the picture. Export it before switching scenes.");
  if (json.includes("data:image/")) throw new Error("Encoded images cannot be saved in a workflow draft.");
  return json;
}

export function decodeDirectorDraft(baselineJson: string, stored: string): string {
  const graph = parseGraph(baselineJson);
  const document: unknown = JSON.parse(stored);
  if (!record(document) || document.schemaVersion !== 1 || !Array.isArray(document.patches) || stored.length > DIRECTOR_DRAFT_LIMIT) throw new Error("The saved workflow draft is invalid.");
  for (const patch of document.patches) {
    if (!record(patch) || !Array.isArray(patch.path) || !patch.path.length || patch.path.some((key) => typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))) throw new Error("The saved workflow draft contains an invalid path.");
    let parent: unknown = graph;
    for (const key of patch.path.slice(0, -1)) {
      if ((!record(parent) && !Array.isArray(parent)) || !Object.hasOwn(parent, key)) throw new Error("The saved workflow draft no longer matches its source.");
      parent = (parent as RecordValue)[key];
    }
    if (!record(parent) && !Array.isArray(parent)) throw new Error("The saved workflow draft no longer matches its source.");
    const key = patch.path.at(-1)!;
    if (patch.remove === true) delete (parent as RecordValue)[key];
    else (parent as RecordValue)[key] = patch.value;
  }
  return JSON.stringify(graph, null, 2);
}
