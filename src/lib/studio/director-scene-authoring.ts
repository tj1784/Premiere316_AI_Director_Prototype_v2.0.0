import type { Picture, Shot } from "./types.ts";
import type { DirectorImageGuide, DirectorSceneImages } from "./director-image-guides.ts";
import { resolveDirectorSceneImages } from "./director-image-guides.ts";
import { prodigalDirectorScene } from "./prodigal-director.ts";
import { PRODIGAL_SON_DIRECTOR } from "./bundled-pictures/prodigal-son/director.ts";
import { DIRECTOR_IMAGE_REF_PREFIX } from "./director-workflow-editor.ts";

export type DirectorImageBinding = { iterationId?: string; assetId?: string; mediaUri: string; sha256: string };
export type DirectorSceneSegment = { segmentId: string; shotId: string; type: "image" | "text"; durationFrames: number; prompt: string; imageBinding?: DirectorImageBinding };
export type DirectorScenePlan = {
  schemaVersion: 1; sceneId: string; template: { mediaUri: string; sha256: string; bytes: number };
  globalPrompt: string; frameRate: number; width: number; height: number; baseSteps: number; refineSteps: number;
  outputPrefix?: string;
  segments: DirectorSceneSegment[];
};
export type DirectorImageOption = { id: string; label: string; mediaUri: string; sha256?: string; iterationId?: string; assetId?: string; shotId?: string; bytes?: number };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const template = () => ({ ...PRODIGAL_SON_DIRECTOR.scenes[0].workflow });

/** Stored plans are user-owned; a baseline never writes over them. */
export function directorPlanForScene(picture: Picture, sceneId: string): DirectorScenePlan {
  if (picture.directorScenes?.[sceneId]) return structuredClone(picture.directorScenes[sceneId]);
  if (!picture.scenes.some(scene => scene.id === sceneId)) throw new Error("Select an existing scene.");
  const bundled = prodigalDirectorScene(picture, sceneId);
  const shots = picture.shots.filter(shot => shot.sceneId === sceneId).sort((a, b) => a.index - b.index);
  return {
    schemaVersion: 1, sceneId, template: { ...(bundled?.workflow ?? template()) }, globalPrompt: bundled?.globalPrompt ?? "",
    frameRate: 24, width: 1120, height: 480, baseSteps: 30, refineSteps: 8,
    segments: bundled ? bundled.segments.filter(segment => shots.some(shot => shot.id === segment.shotId)).map(segment => ({
      segmentId: segment.segmentId, shotId: segment.shotId, type: "image", durationFrames: segment.durationFrames,
      prompt: shots.find(shot => shot.id === segment.shotId)?.i2vPrompt ?? segment.prompt,
    })) : shots.map(shot => ({ segmentId: `director-${shot.id}`, shotId: shot.id, type: "image", durationFrames: Math.max(1, Math.round(shot.durationSec * 24)), prompt: shot.i2vPrompt })),
  };
}

export function createDirectorScene(picture: Picture, input: { sceneId: string; title: string }, now = Date.now()): Picture {
  const sceneId = input.sceneId.trim(), title = input.title.trim();
  if (!sceneId || sceneId.length > 200 || !title || title.length > 500) throw new Error("A scene needs an ID and title.");
  if (picture.scenes.some(scene => scene.id === sceneId) || picture.directorScenes?.[sceneId]) throw new Error("That scene ID already exists.");
  const next = { ...picture, updatedAt: now, scenes: [...picture.scenes, { id: sceneId, act: picture.scenes.at(-1)?.act ?? 1, slugline: title, summary: "", emotionalBeat: "", durationSec: 0 }] };
  return { ...next, directorScenes: { ...picture.directorScenes, [sceneId]: directorPlanForScene(next, sceneId) } };
}

function validatePlan(plan: DirectorScenePlan) {
  if (plan.schemaVersion !== 1 || !plan.sceneId || !Array.isArray(plan.segments)) throw new Error("Invalid Director scene plan.");
  if (plan.outputPrefix !== undefined && (!plan.outputPrefix || plan.outputPrefix.length > 500 || /[\\:\x00]/.test(plan.outputPrefix) || plan.outputPrefix.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("The output prefix must name a relative folder inside the video output directory.");
  for (const [name, value, min, max] of [["Frame rate", plan.frameRate, 1, 240], ["Width", plan.width, 0, 8192], ["Height", plan.height, 0, 8192], ["Base steps", plan.baseSteps, 1, 10000], ["Refine steps", plan.refineSteps, 1, 10000]] as const) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  const ids = new Set<string>(), shots = new Set<string>();
  for (const segment of plan.segments) {
    if (!segment.segmentId || !segment.shotId || ids.has(segment.segmentId) || shots.has(segment.shotId)) throw new Error("Director segments need unique segment and shot IDs.");
    if (!["image", "text"].includes(segment.type) || !Number.isInteger(segment.durationFrames) || segment.durationFrames < Math.ceil(plan.frameRate * 0.1) || segment.durationFrames > 10000 || typeof segment.prompt !== "string") throw new Error("Each segment needs a type, prompt and a whole-frame duration of at least 0.1 seconds and at most 10000 frames.");
    ids.add(segment.segmentId); shots.add(segment.shotId);
  }
}

export function saveDirectorPlan(picture: Picture, plan: DirectorScenePlan): Picture {
  validatePlan(plan);
  if (!picture.scenes.some(scene => scene.id === plan.sceneId)) throw new Error("Create the scene before saving its Director plan.");
  for (const segment of plan.segments) if (picture.shots.some(shot => shot.id === segment.shotId && shot.sceneId !== plan.sceneId)) throw new Error("A segment cannot take a shot ID from another scene.");
  const updates = new Map(plan.segments.map(segment => [segment.shotId, segment]));
  const shots = picture.shots.map(shot => {
    const segment = updates.get(shot.id);
    return segment ? { ...shot, i2vPrompt: segment.prompt, durationSec: segment.durationFrames / plan.frameRate } : shot;
  });
  let index = Math.max(0, ...shots.map(shot => shot.index));
  for (const segment of plan.segments) if (!shots.some(shot => shot.id === segment.shotId)) shots.push({
    id: segment.shotId, sceneId: plan.sceneId, index: ++index, type: segment.type === "text" ? "prompt" : "coverage",
    description: segment.prompt, durationSec: segment.durationFrames / plan.frameRate, camera: "", lens: "", cameraMove: "", emotion: "", expression: "",
    t2iPrompt: "", i2vPrompt: segment.prompt, t2voicePrompt: "",
  } satisfies Shot);
  return { ...picture, updatedAt: Date.now(), shots, directorScenes: { ...picture.directorScenes, [plan.sceneId]: structuredClone(plan) },
    scenes: picture.scenes.map(scene => scene.id === plan.sceneId ? { ...scene, durationSec: plan.segments.reduce((sum, segment) => sum + segment.durationFrames, 0) / plan.frameRate } : scene),
    performance: picture.performance ? { ...picture.performance, shots: picture.performance.shots.map(shot => {
      const segment = updates.get(shot.shotId);
      return segment && shot.legacy ? { ...shot, legacy: { ...shot.legacy, i2vPrompt: segment.prompt } } : shot;
    }) } : picture.performance,
  };
}

/** Existing media only; selecting an option never creates another iteration. */
export function listDirectorImageOptions(picture: Picture): DirectorImageOption[] {
  const options: DirectorImageOption[] = [];
  for (const item of picture.generateGates?.iterations ?? []) if (item.kind === "first" && item.status !== "REJECTED" && item.origin !== "fail-closed" && item.mediaUri) {
    options.push({ id: item.id, iterationId: item.id, shotId: item.shotId, mediaUri: item.mediaUri, sha256: hash(item.mediaSha256) ? item.mediaSha256.toLowerCase() : undefined, label: `${item.shotId} · ${item.status === "APPROVED" ? "Approved first frame" : "First frame"}` });
  }
  for (const asset of picture.production?.assets ?? []) if (!asset.tombstone) for (const item of asset.iterations) if (item.status !== "REJECTED" && item.mediaUri && !/\.(?:mp4|webm|mov|mkv|avi|wav|mp3|flac|ogg|m4a)(?:[?#]|$)/i.test(item.mediaUri)) {
    options.push({ id: item.id, iterationId: item.id, assetId: asset.id, mediaUri: item.mediaUri, sha256: hash(item.mediaSha256) ? item.mediaSha256.toLowerCase() : undefined, bytes: item.byteLength, label: `${asset.name} · ${item.status === "APPROVED" ? "Approved image" : "Image iteration"}` });
  }
  for (const shot of picture.shots) if (shot.stillUrl && !options.some(option => option.mediaUri === shot.stillUrl)) options.push({ id: `still:${shot.id}`, shotId: shot.id, mediaUri: shot.stillUrl, label: `${shot.id} · Existing still` });
  return options;
}

export function directorPlanImages(picture: Picture, plan: DirectorScenePlan): DirectorSceneImages {
  const guides: Record<string, DirectorImageGuide> = {}, issues: string[] = [];
  const options = listDirectorImageOptions(picture);
  const bundled = prodigalDirectorScene(picture, plan.sceneId);
  const fallback = bundled ? resolveDirectorSceneImages(picture, bundled).guides : {};
  for (const segment of plan.segments) {
    if (segment.type === "text") continue;
    const binding = segment.imageBinding;
    if (binding) {
      const selected = binding.iterationId ? options.find(option => option.iterationId === binding.iterationId && (!binding.assetId || option.assetId === binding.assetId)) : undefined;
      if (binding.iterationId && (!selected || selected.mediaUri !== binding.mediaUri || selected.sha256 && selected.sha256 !== binding.sha256.toLowerCase())) {
        issues.push(`${segment.shotId}: the selected image iteration is unavailable or changed.`); continue;
      }
      if (!binding.mediaUri || !hash(binding.sha256)) { issues.push(`${segment.shotId}: verify the selected image file first.`); continue; }
      guides[segment.segmentId] = { ...binding, sha256: binding.sha256.toLowerCase(), label: selected?.label ?? "Selected existing image" };
      continue;
    }
    const pair = picture.generateGates?.pairs.find(pair => pair.shotId === segment.shotId);
    const approved = options.find(option => option.iterationId === pair?.firstApprovedId && picture.generateGates?.iterations.some(item => item.id === option.iterationId && item.status === "APPROVED"));
    if (approved?.sha256) guides[segment.segmentId] = { ...approved, sha256: approved.sha256, label: "Existing approved first frame" };
    else if (fallback[segment.segmentId]) guides[segment.segmentId] = fallback[segment.segmentId];
    else issues.push(`${segment.shotId}: choose an existing image for this segment.`);
  }
  return { guides, issues, key: JSON.stringify(plan.segments.map(segment => [segment.segmentId, guides[segment.segmentId]?.sha256, guides[segment.segmentId]?.mediaUri, guides[segment.segmentId]?.iterationId])) };
}

type GraphNode = { id: string | number; type: string; properties?: Record<string, unknown>; widgets_values?: unknown[] | Record<string, unknown>; widgets_values_named?: Record<string, unknown>; [key: string]: unknown };
type Graph = { nodes: GraphNode[]; definitions?: { subgraphs?: Array<Graph & { id: string; name?: string }> }; [key: string]: unknown };
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 100) || "scene";
function setNodeWidget(node: GraphNode, name: string, value: unknown) {
  const index = Object.keys(node.widgets_values_named ?? {}).indexOf(name);
  if (Array.isArray(node.widgets_values)) { if (index >= 0 && index < node.widgets_values.length) node.widgets_values[index] = value; }
  else if (node.widgets_values) node.widgets_values[name] = value;
  node.widgets_values_named = { ...node.widgets_values_named, [name]: value };
  if (node.properties && name in node.properties) node.properties[name] = value;
}
/** Build a full native graph while keeping generation controls reviewable in the plan. */
export function buildDirectorPlanEditor(source: unknown, plan: DirectorScenePlan, options: { segmentId?: string; guides?: Record<string, DirectorImageGuide> } = {}): string {
  validatePlan(plan);
  const graph = structuredClone(source) as Graph;
  if (!Array.isArray(graph?.nodes)) throw new Error("The Director template has no nodes.");
  const all = [graph, ...(graph.definitions?.subgraphs ?? [])].flatMap(container => container.nodes);
  for (const node of all) if (node.widgets_values_named && node.widgets_values) {
    if (Array.isArray(node.widgets_values)) {
      const values = node.widgets_values;
      node.widgets_values_named = Object.fromEntries(Object.keys(node.widgets_values_named).map((key, index) => [key, index < values.length ? values[index] : node.widgets_values_named![key]]));
    } else node.widgets_values_named = { ...node.widgets_values_named, ...node.widgets_values };
  }
  const directors = all.filter(node => node.type === "LTXDirector");
  if (directors.length !== 1) throw new Error("The template must contain exactly one LTX Director.");
  const director = directors[0];
  const previous = JSON.parse(String(director.properties?.timeline_data ?? "{}"));
  const selected = options.segmentId ? plan.segments.filter(segment => segment.segmentId === options.segmentId) : plan.segments;
  if (options.segmentId && !selected.length) throw new Error("The selected segment no longer exists.");
  let frame = 0;
  const segments = selected.map(segment => {
    const start = frame; frame += segment.durationFrames;
    if (segment.type === "text") return { id: segment.segmentId, type: "text", start, length: segment.durationFrames, prompt: segment.prompt };
    const guide = options.guides?.[segment.segmentId] ?? segment.imageBinding;
    const oldVisual = (previous.segments ?? []).filter((item: { type: string }) => item.type !== "text");
    const oldIndex = oldVisual.findIndex((item: { id: string }) => item.id === segment.segmentId);
    const oldSegment = oldVisual[oldIndex];
    const oldStrength = String(director.widgets_values_named?.guide_strength ?? "").split(",")[oldIndex];
    return { ...oldSegment, id: segment.segmentId, type: "image", start, length: segment.durationFrames, prompt: segment.prompt, guideStrength: oldSegment?.guideStrength ?? (oldStrength ? Number(oldStrength) : 1), imageFile: "", imageB64: guide && hash(guide.sha256) ? `${DIRECTOR_IMAGE_REF_PREFIX}${guide.sha256.toLowerCase()}` : "", isEndFrame: false };
  });
  const duration = Math.max(1, frame);
  const timeline = { ...previous, mainTrackEnabled: true, global_prompt: plan.globalPrompt, retakeMode: false, normalStartFrame: 0, normalDurationFrames: duration, segments, audioSegments: previous.audioSegments ?? [], motionSegments: previous.motionSegments ?? [] };
  const values: Record<string, unknown> = { start_second: 0, end_second: duration / plan.frameRate, duration_seconds: duration / plan.frameRate, start_frame: 0, end_frame: duration, duration_frames: duration,
    timeline_data: JSON.stringify(timeline), local_prompts: selected.map(segment => segment.prompt).join(" | "), segment_lengths: selected.map(segment => segment.durationFrames).join(","),
    guide_strength: segments.filter(segment => segment.type === "image").map(segment => Number.isFinite(Number(segment.guideStrength)) ? Number(segment.guideStrength).toFixed(2) : "1.00").join(","), global_prompt: plan.globalPrompt, frame_rate: plan.frameRate,
    custom_width: plan.width, custom_height: plan.height };
  for (const [name, value] of Object.entries(values)) setNodeWidget(director, name, value);
  director.properties = { ...director.properties, ...values };
  for (const node of graph.nodes) {
    const definition = graph.definitions?.subgraphs?.find(definition => definition.id === node.type);
    if (definition?.name === "Stage #1") setNodeWidget(node, "steps", plan.baseSteps);
    if (definition?.name === "Stage #2") setNodeWidget(node, "steps", plan.refineSteps);
    if (node.widgets_values_named && "frame_rate" in node.widgets_values_named) setNodeWidget(node, "frame_rate", plan.frameRate);
  }
  const prefix = plan.outputPrefix ?? `Premiere316/${safeName(plan.sceneId)}`;
  const previousPrefix = (graph.premiere316DirectorPlan as { outputPrefix?: string } | undefined)?.outputPrefix;
  for (const node of all) if (["VHS_VideoCombine", "SaveVideo"].includes(node.type) && (!previousPrefix || node.widgets_values_named?.filename_prefix === previousPrefix)) setNodeWidget(node, "filename_prefix", prefix);
  graph.premiere316DirectorPlan = { sceneId: plan.sceneId, outputPrefix: prefix };
  return JSON.stringify(graph, null, 2);
}

function editorGraph(json: string): { graph: Graph; director: GraphNode; timeline: Record<string, any> } {
  const graph = JSON.parse(json) as Graph;
  const nodes = [graph, ...(graph.definitions?.subgraphs ?? [])].flatMap(container => container.nodes);
  const directors = nodes.filter(node => node.type === "LTXDirector");
  if (directors.length !== 1) throw new Error("The workflow must contain one Director node.");
  const director = directors[0];
  return { graph, director, timeline: JSON.parse(String(director.properties?.timeline_data ?? "{}")) };
}

/** Scope the edited graph, including custom nodes/settings, without rebuilding it from defaults. */
export function scopeDirectorPlanEditor(editorJson: string, segmentId: string): string {
  const { graph, director, timeline } = editorGraph(editorJson);
  const source = timeline.segments?.find((segment: { id: string }) => String(segment.id) === segmentId);
  if (!source) throw new Error("Select a segment to generate.");
  const start = Number(source.start), duration = Number(source.length), fps = Number(director.widgets_values_named?.frame_rate ?? director.properties?.frame_rate);
  if (!Number.isInteger(start) || !Number.isInteger(duration) || duration < 1 || !Number.isFinite(fps) || fps <= 0) throw new Error("The selected segment timing is invalid.");
  const visual = timeline.segments.filter((segment: { type: string }) => segment.type !== "text");
  const strength = String(director.widgets_values_named?.guide_strength ?? "1.00").split(",")[visual.findIndex((segment: { id: string }) => segment.id === source.id)] ?? "1.00";
  const clip = (items: Array<Record<string, any>> = []) => items.flatMap(item => {
    const left = Math.max(start, Number(item.start)), right = Math.min(start + duration, Number(item.start) + Number(item.length));
    return right > left ? [{ ...item, start: left - start, length: right - left, ...(item.trimStart !== undefined ? { trimStart: Number(item.trimStart) + left - Number(item.start) } : {}) }] : [];
  });
  const segments = [{ ...source, start: 0 }, ...clip(timeline.segments.filter((segment: { type: string; id: string }) => segment.type === "text" && segment.id !== source.id))];
  const scoped = { ...timeline, normalStartFrame: 0, normalDurationFrames: duration, retakeMode: false, segments, audioSegments: clip(timeline.audioSegments), motionSegments: clip(timeline.motionSegments) };
  const values = { start_second: 0, end_second: duration / fps, duration_seconds: duration / fps, start_frame: 0, end_frame: duration, duration_frames: duration, timeline_data: JSON.stringify(scoped), local_prompts: segments.map(segment => segment.prompt).join(" | "), segment_lengths: segments.map(segment => segment.length).join(","), guide_strength: strength };
  for (const [name, value] of Object.entries(values)) setNodeWidget(director, name, value);
  director.properties = { ...director.properties, ...values };
  for (const node of [graph, ...(graph.definitions?.subgraphs ?? [])].flatMap(container => container.nodes)) if (["VHS_VideoCombine", "SaveVideo"].includes(node.type)) {
    const prefix = String(node.widgets_values_named?.filename_prefix ?? "Premiere316").replace(/\/+$/, "");
    const suffix = `/segment-${safeName(segmentId)}`;
    setNodeWidget(node, "filename_prefix", prefix.endsWith(suffix) ? prefix : `${prefix}${suffix}`);
  }
  return JSON.stringify(graph, null, 2);
}

/** Capture edits to plan-owned fields before another UI control changes them. */
export function extractDirectorPlanFromEditor(plan: DirectorScenePlan, editorJson: string): DirectorScenePlan {
  const { graph, director, timeline } = editorGraph(editorJson);
  const value = (node: GraphNode, name: string) => {
    const index = Object.keys(node.widgets_values_named ?? {}).indexOf(name);
    return Array.isArray(node.widgets_values) && index >= 0 ? node.widgets_values[index] : node.widgets_values_named?.[name] ?? node.properties?.[name];
  };
  const stage = (name: string) => graph.nodes.find(node => graph.definitions?.subgraphs?.some(definition => definition.id === node.type && definition.name === name));
  const first = stage("Stage #1"), second = stage("Stage #2");
  const next: DirectorScenePlan = { ...plan, globalPrompt: String(timeline.global_prompt ?? ""), frameRate: Number(value(director, "frame_rate")), width: Number(value(director, "custom_width")), height: Number(value(director, "custom_height")), baseSteps: first ? Number(value(first, "steps")) : plan.baseSteps, refineSteps: second ? Number(value(second, "steps")) : plan.refineSteps,
    segments: (timeline.segments ?? []).map((segment: Record<string, any>) => {
      const previous = plan.segments.find(item => item.segmentId === String(segment.id));
      return { ...previous, segmentId: String(segment.id), shotId: previous?.shotId ?? `${plan.sceneId}-${segment.id}`, type: segment.type ?? "image", durationFrames: Number(segment.length), prompt: String(segment.prompt ?? "") };
    }),
  };
  validatePlan(next);
  return next;
}
