/** Native LTX Director graph export. This prepares a workflow; it never queues a render. */
type JsonRecord = Record<string, unknown>;

export type DirectorSegmentEdit = {
  segmentId: string;
  prompt: string;
  imageDataUrl: string;
};

export function prepareDirectorWorkflow(
  source: unknown,
  edits: DirectorSegmentEdit[],
  globalPrompt?: string,
): JsonRecord {
  if (!isRecord(source) || !Array.isArray(source.nodes)) throw new Error("The source is not a ComfyUI workflow.");
  if (!edits.length || new Set(edits.map((edit) => edit.segmentId)).size !== edits.length) throw new Error("The scene must contain distinct Director segments.");
  for (const edit of edits) {
    if (!edit.prompt.trim()) throw new Error("Every Director segment needs a video prompt.");
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(edit.imageDataUrl)) throw new Error("Each starting image must be embedded in the exported workflow.");
  }
  const graph = structuredClone(source);
  const nodes = collectNodes(graph);
  const directors = nodes.filter((node) => node.type === "LTXDirector");
  if (directors.length !== 1) throw new Error("Expected one LTX Director timeline in the scene workflow.");
  const director = directors[0];
  const properties = isRecord(director.properties) ? director.properties : {};
  const widgetValues = Array.isArray(director.widgets_values) ? director.widgets_values : [];
  const originalTimeline = parseTimeline(properties.timeline_data)
    ?? widgetValues.map(parseTimeline).find((item) => item !== null);
  if (!originalTimeline || !Array.isArray(originalTimeline.segments)) throw new Error("The workflow has no readable Director timeline.");
  const originalSegments = originalTimeline.segments.filter(isRecord);
  const changes = new Map(edits.map((edit) => [edit.segmentId, edit]));
  if (originalSegments.length !== edits.length || originalSegments.some((segment) => !changes.has(String(segment.id)))) {
    throw new Error("This workflow's timeline does not match the selected scene.");
  }
  const timeline: JsonRecord = {
    ...originalTimeline,
    ...(globalPrompt === undefined ? {} : { global_prompt: globalPrompt }),
    segments: originalSegments.map((segment) => {
      const edit = changes.get(String(segment.id))!;
      // Director prioritizes imageFile over base64. Clear the former so a stale
      // file in another installation cannot replace the exact embedded image.
      return { ...segment, prompt: edit.prompt, imageFile: "", imageB64: edit.imageDataUrl };
    }),
  };
  const serialized = JSON.stringify(timeline);
  const localPrompts = originalSegments.map((segment) => changes.get(String(segment.id))!.prompt).join(" | ");
  const previousLocal = properties.local_prompts;
  const previousGlobal = properties.global_prompt;
  let timelineWidgets = 0;
  director.widgets_values = widgetValues.map((value) => {
    if (parseTimeline(value)) { timelineWidgets += 1; return serialized; }
    if (typeof previousLocal === "string" && value === previousLocal) return localPrompts;
    if (globalPrompt !== undefined && typeof previousGlobal === "string" && value === previousGlobal) return globalPrompt;
    return value;
  });
  if (timelineWidgets !== 1) throw new Error("The workflow's serialized Director timeline is missing or ambiguous.");
  director.properties = {
    ...properties,
    timeline_data: serialized,
    local_prompts: localPrompts,
    ...(globalPrompt === undefined ? {} : { global_prompt: globalPrompt }),
  };
  if (isRecord(director.widgets_values_named)) {
    director.widgets_values_named = {
      ...director.widgets_values_named,
      timeline_data: serialized,
      local_prompts: localPrompts,
      ...(globalPrompt === undefined ? {} : { global_prompt: globalPrompt }),
    };
  }
  return graph;
}

function collectNodes(graph: JsonRecord): JsonRecord[] {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
  const definitions = isRecord(graph.definitions) ? graph.definitions : null;
  const subgraphs = definitions && Array.isArray(definitions.subgraphs) ? definitions.subgraphs.filter(isRecord) : [];
  return [...nodes, ...subgraphs.flatMap(collectNodes)];
}

function parseTimeline(value: unknown): JsonRecord | null {
  if (typeof value !== "string" || !value.trimStart().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) && Array.isArray(parsed.segments) ? parsed : null;
  } catch { return null; }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
