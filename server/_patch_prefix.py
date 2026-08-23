from pathlib import Path
p = Path(r"C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js")
t = p.read_text(encoding="utf-8")
old = """export async function compileHellPromptOnly(text) {
  const graph = readJson(HELL_WORKFLOW);
  const objectInfo = await getObjectInfo(true);
  const flat = flattenWorkflow(graph);
  const converted = graphToApi(flat, objectInfo);
  const fatal = (converted.warnings || []).filter((w) => !/Unknown node class/.test(w));
  if (fatal.length) throw new Error(fatal.join("; "));
  const wrap = (graph.nodes || []).find((n) => Number(n.id) === 398);
  const wv = Array.isArray(wrap?.widgets_values) ? wrap.widgets_values : [];
  const seconds = Number(wv[2]);
  const prompt = converted.prompt;
  if (prompt["362"]?.inputs && Number.isFinite(seconds)) prompt["362"].inputs.value = seconds;
  if (prompt["376"]?.inputs && "value" in prompt["376"].inputs) prompt["376"].inputs.value = text;
  if (prompt["380"]?.inputs && "prompt" in prompt["380"].inputs) prompt["380"].inputs.prompt = text;
  if (prompt["380"]?.inputs && prompt["380"].inputs.sampling_mode == null) {
    prompt["380"].inputs.sampling_mode = "off";
  }
  const clipFallback = "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors";
  const scaleOk = new Set(["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]);
  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs;
    if (!inputs) continue;
    if (node.class_type === "SaveVideo") {
      if (inputs.codec == null) inputs.codec = "auto";
      if (inputs.format == null) inputs.format = "auto";
    }
    if (node.class_type === "LTXVEmptyLatentAudio") {
      inputs.batch_size = 1;
    }
    if (node.class_type === "CLIPLoader" && inputs.clip_name === "gemma4_e2b_it_bf16.safetensors") {
      inputs.clip_name = clipFallback;
    }
    if (node.class_type === "ResizeImageMaskNode") {
      inputs.resize_type = "scale longer dimension";
      inputs["resize_type.longer_size"] = 1536;
      inputs.scale_method = "lanczos";
    }
  }
  return { prompt, nodeCount: Object.keys(prompt).length, warnings: converted.warnings };
}"""
new = """function prefixHellSubgraph(flat, uiGraph) {
  const topIds = new Set((uiGraph.nodes || []).map((node) => String(node.id)));
  const instance = (uiGraph.nodes || []).find((node) =>
    (uiGraph.definitions?.subgraphs || []).some((sub) => sub.id === node.type)
  );
  const prefix = `${instance?.id ?? 398}:`;
  const rename = (id) => {
    const key = String(id);
    return topIds.has(key) ? key : `${prefix}${key}`;
  };
  for (const node of flat.nodes || []) node.id = rename(node.id);
  for (const link of flat.links || []) {
    if (!Array.isArray(link) || link.length < 5) continue;
    link[1] = rename(link[1]);
    link[3] = rename(link[3]);
  }
  return flat;
}

function nodeByIds(prompt, ids) {
  for (const id of ids) {
    if (prompt[id]) return prompt[id];
  }
  return null;
}

export async function compileHellPromptOnly(text) {
  const graph = readJson(HELL_WORKFLOW);
  const objectInfo = await getObjectInfo(true);
  const flat = prefixHellSubgraph(flattenWorkflow(graph), graph);
  const converted = graphToApi(flat, objectInfo);
  const fatal = (converted.warnings || []).filter((w) => !/Unknown node class/.test(w));
  if (fatal.length) throw new Error(fatal.join("; "));
  const wrap = (graph.nodes || []).find((n) => Number(n.id) === 398);
  const wv = Array.isArray(wrap?.widgets_values) ? wrap.widgets_values : [];
  const seconds = Number(wv[2]);
  const prompt = converted.prompt;
  const duration = nodeByIds(prompt, ["398:362", "362"]);
  if (duration?.inputs && Number.isFinite(seconds)) duration.inputs.value = seconds;
  const primitive = nodeByIds(prompt, ["398:376", "376"]);
  if (primitive?.inputs) primitive.inputs.value = text;
  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs;
    if (!inputs) continue;
    if (node.class_type === "SaveVideo") {
      if (inputs.codec == null) inputs.codec = "auto";
      if (inputs.format == null) inputs.format = "auto";
    }
    if (node.class_type === "LTXVEmptyLatentAudio") inputs.batch_size = 1;
  }
  return { prompt, nodeCount: Object.keys(prompt).length, warnings: converted.warnings };
}"""
if old not in t:
    raise SystemExit("compile block missing")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("prefixed")
