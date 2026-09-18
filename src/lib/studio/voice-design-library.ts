import { MASCULINE_VOICE_WORKFLOW } from "./masculine-voice-workflow.ts";
import { BIBLICAL_VOICE_WORKFLOW } from "./biblical-voice-workflow.ts";

export type VoiceWorkflow = { nodes: Array<{ id: number; type: string; inputs?: Array<{ name: string; link?: number | null; [key: string]: unknown }>; widgets_values?: unknown[]; widgets_values_named?: Record<string, unknown>; [key: string]: unknown }>; [key: string]: unknown };
export type VoiceDesignEnhancer = { nodeId: number; imageNodeId: number; prompt: string; image: string; model: string; baseUrl: string };
export type VoiceDesign = {
  name: string; description: string; referenceText: string; seed: number;
  language: string; topK: number; topP: number; temperature: number;
  repetitionPenalty: number; maxNewTokens: number; format: "wav" | "flac";
  workflow: VoiceWorkflow;
  enhancer?: VoiceDesignEnhancer;
};
export type VoiceDesignAsset = {
  reviewHistory?: Array<{status:string;at:number;revision:number}>;
  id: string; design: VoiceDesign; createdAt: number; updatedAt?: number; revision?: number; deletedAt?: number; reviewedAt?: number; conflicts?: unknown[];
  textKind?: "audition" | "screenplay"; reviewNote?: string; provenance?: { modelId?: string; manifestId?: string; screenplaySha256?: string; sourceProfileId?: string };
  sourcePictureId?: string; status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
  audio?: { mediaUri: string; previewUri?: string; sha256?: string; durationSec?: number; sampleRate?: number; channels?: number; filename: string; referenceText: string; bytes: number; origin: "imported" };
};

const ENGINE_FIELDS = ["model_variant", "device", "voice_preset", "language", "instruct", "top_k", "top_p", "temperature", "repetition_penalty", "max_new_tokens"];
const DESIGN_FIELDS = ["reference_text", "seed", "control_after_generate", "voice_instruction"];
function field(node: VoiceWorkflow["nodes"][number], names: string[], name: string): unknown {
  const named=node.widgets_values_named?.[name], positional=node.widgets_values?.[names.indexOf(name)];
  if(named!==undefined&&positional!==undefined&&JSON.stringify(named)!==JSON.stringify(positional))throw new Error(`Conflicting named and positional ${name}; review both workflow values.`);
  return node.widgets_values_named?.[name] ?? node.widgets_values?.[names.indexOf(name)];
}

function inputSource(workflow: VoiceWorkflow, node: VoiceWorkflow["nodes"][number], name: string) {
  const slot = node.inputs?.findIndex((input) => input.name === name) ?? -1;
  const linkId = node.inputs?.[slot]?.link;
  if (linkId == null) return undefined;
  const link = Array.isArray(workflow.links) ? workflow.links.find((entry: unknown) => Array.isArray(entry) && entry[0] === linkId && entry[3] === node.id && entry[4] === slot) : undefined;
  const source = link && workflow.nodes.find((item) => item.id === link[1]);
  if (!source || link[2] !== 0) throw new Error(`The ${name} connection is missing or unsupported.`);
  return source;
}

function readEnhancer(workflow: VoiceWorkflow, designer: VoiceWorkflow["nodes"][number]): VoiceDesignEnhancer | undefined {
  const enhancer = inputSource(workflow, designer, "voice_instruction");
  if (!enhancer) return undefined;
  if (enhancer.type !== "SulphurPromptEnhancer") throw new Error("The linked voice instruction must come from SulphurPromptEnhancer.");
  const source = inputSource(workflow, enhancer, "image");
  if (source?.type !== "LoadImage") throw new Error("The voice enhancer needs a connected LoadImage node.");
  const fields = ["prompt", "enabled", "model", "base_url"];
  return {
    nodeId: enhancer.id, imageNodeId: source.id,
    prompt: field(enhancer, fields, "prompt") as string,
    image: field(source, ["image", "upload"], "image") as string,
    model: field(enhancer, fields, "model") as string,
    baseUrl: field(enhancer, fields, "base_url") as string,
  };
}

export function validateVoiceGraph(workflow: VoiceWorkflow): void {
  const nodes=workflow.nodes;
  for(const type of ['Qwen3TTSEngineNode','UnifiedVoiceDesignerNode','SaveAudioAdvanced'])if(nodes.filter(n=>n.type===type).length!==1)throw new Error(`Expected exactly one ${type}.`);
  if(new Set(nodes.map(n=>n.id)).size!==nodes.length || nodes.some(n=>!Number.isSafeInteger(n.id))) throw new Error("Duplicate or invalid workflow node ID.");
  if(!Array.isArray(workflow.links)) throw new Error("Workflow links are missing.");
  const links=workflow.links as unknown[][];
  if(new Set(links.map(l=>l[0])).size!==links.length) throw new Error("Duplicate workflow link ID.");
  for(const link of links) {
    if(!Array.isArray(link)||link.length<6)throw new Error("Invalid workflow link.");
    const from=nodes.find(n=>n.id===link[1]), to=nodes.find(n=>n.id===link[3]);
    const output=(from?.outputs as Array<{links?: number[];type?:string}>|undefined)?.[Number(link[2])];
    if(!from||!to||!output||!output.links?.includes(Number(link[0]))||to.inputs?.[Number(link[4])]?.link!==link[0])throw new Error("Workflow link endpoints do not match.");
  }
  for(const node of nodes) for(const input of node.inputs??[]) {
    if(input.link!=null&&!links.some(l=>l[0]===input.link))throw new Error("Missing workflow input connection.");
    const allowed:Record<string,string[]>={Qwen3TTSEngineNode:[],UnifiedVoiceDesignerNode:['TTS_engine','voice_instruction'],SaveAudioAdvanced:['audio'],SulphurPromptEnhancer:['image'],LoadImage:[]};
    if(input.link!=null&&allowed[node.type]&&!allowed[node.type].includes(input.name))throw new Error(`Connected editable input ${input.name} is unsupported; disconnect it before editing/export.`);
  }
  const engine=nodes.find(n=>n.type==='Qwen3TTSEngineNode'), designer=nodes.find(n=>n.type==='UnifiedVoiceDesignerNode'), saver=nodes.find(n=>n.type==='SaveAudioAdvanced');
  if(!engine||!designer||!saver||inputSource(workflow,designer,'TTS_engine')?.id!==engine.id)throw new Error("Engine must connect to the voice designer.");
  let target=saver, seen=new Set<number>();
  while(true) {
    if(seen.has(target.id))throw new Error("Cyclic audio output graph.");seen.add(target.id);
    const slot=target.inputs?.findIndex(i=>i.name==='audio')??-1;
    const link=links.find(l=>l[0]===target.inputs?.[slot]?.link&&l[3]===target.id&&l[4]===slot);
    const source=link&&nodes.find(n=>n.id===link[1]);
    if(!source)throw new Error("Disconnected audio-save graph.");
    if(source.id===designer.id&&link![2]===1)break;
    if(source.type!=='PreviewAudio'||link![2]!==0)throw new Error("Unsupported audio-save path.");
    target=source;
  }
  if([engine,designer,saver,...nodes.filter(n=>n.type==='PreviewAudio'||n.type==='SulphurPromptEnhancer'||n.type==='LoadImage')].some(n=>n.mode!==undefined&&n.mode!==0))throw new Error("Required workflow nodes must be enabled.");
}

/** Reads workflow data only. Notes, URLs, and extra metadata never execute. */
export function importVoiceDesign(value: unknown, name: string): VoiceDesign {
  if (!value || typeof value !== "object" || !Array.isArray((value as VoiceWorkflow).nodes)) throw new Error("Choose a ComfyUI VoiceDesign workflow JSON.");
  const workflow = structuredClone(value) as VoiceWorkflow;
  if (workflow.nodes.some((node) => !node || typeof node.type !== "string")) throw new Error("The workflow contains an invalid node.");
  const engines = workflow.nodes.filter((node) => node.type === "Qwen3TTSEngineNode");
  const designers = workflow.nodes.filter((node) => node.type === "UnifiedVoiceDesignerNode");
  const savers = workflow.nodes.filter((node) => node.type === "SaveAudioAdvanced");
  if (engines.length !== 1 || designers.length !== 1 || savers.length !== 1) throw new Error("Expected one Qwen3TTSEngineNode, UnifiedVoiceDesignerNode, and SaveAudioAdvanced node.");
  validateVoiceGraph(workflow);
  const [engine] = engines, [designer] = designers, [saver] = savers;
  if (field(engine, ENGINE_FIELDS, "model_variant") !== "local:Qwen3-TTS-12Hz-1.7B-VoiceDesign") throw new Error("This component requires the local Qwen3-TTS 1.7B VoiceDesign model.");
  const enhancer = readEnhancer(workflow, designer);
  const design: VoiceDesign = {
    name: name.replace(/\.json$/i, ""), workflow,
    ...(enhancer ? { enhancer } : {}),
    description: field(designer, DESIGN_FIELDS, "voice_instruction") as string,
    referenceText: field(designer, DESIGN_FIELDS, "reference_text") as string,
    seed: field(designer, DESIGN_FIELDS, "seed") as number,
    language: field(engine, ENGINE_FIELDS, "language") as string,
    topK: field(engine, ENGINE_FIELDS, "top_k") as number,
    topP: field(engine, ENGINE_FIELDS, "top_p") as number,
    temperature: field(engine, ENGINE_FIELDS, "temperature") as number,
    repetitionPenalty: field(engine, ENGINE_FIELDS, "repetition_penalty") as number,
    maxNewTokens: field(engine, ENGINE_FIELDS, "max_new_tokens") as number,
    format: field(saver, ["filename_prefix", "format"], "format") as VoiceDesign["format"],
  };
  validateVoiceDesign(design);
  return design;
}

export function validateVoiceDesign(design: VoiceDesign): void {
  validateVoiceGraph(design.workflow);
  const required = [["Name", design.name], ["Spoken reference text", design.referenceText], ["Language", design.language]];
  const designer = design.workflow.nodes.find((node) => node.type === "UnifiedVoiceDesignerNode");
  const linked = designer && readEnhancer(design.workflow, designer);
  if (linked || design.enhancer) {
    if (!linked || !design.enhancer || linked.nodeId !== design.enhancer.nodeId || linked.imageNodeId !== design.enhancer.imageNodeId) throw new Error("Voice enhancer settings must match the connected workflow nodes.");
    required.push(["Casting instructions", design.enhancer.prompt], ["Character image filename", design.enhancer.image]);
  } else required.push(["Voice description", design.description]);
  for (const [label, value] of required) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  }
  if (!Number.isSafeInteger(design.seed) || design.seed < 0) throw new Error("Seed must be a non-negative safe integer.");
  if (!Number.isInteger(design.topK) || design.topK < 1 || design.topK > 100) throw new Error("Top K must be from 1 to 100.");
  if (!Number.isFinite(design.topP) || design.topP <= 0 || design.topP > 1) throw new Error("Top P must be greater than 0 and at most 1.");
  if (!Number.isFinite(design.temperature) || design.temperature <= 0 || design.temperature > 2) throw new Error("Temperature must be greater than 0 and at most 2.");
  if (!Number.isFinite(design.repetitionPenalty) || design.repetitionPenalty < 1 || design.repetitionPenalty > 2) throw new Error("Repetition penalty must be from 1 to 2.");
  if (!Number.isInteger(design.maxNewTokens) || design.maxNewTokens < 1 || design.maxNewTokens > 8192) throw new Error("Token limit must be from 1 to 8192.");
  if (design.format !== "wav" && design.format !== "flac") throw new Error("Choose WAV or FLAC output.");
}

export const MASCULINE_VOICE_DESIGN = importVoiceDesign(MASCULINE_VOICE_WORKFLOW, "Masculine man · young Judean");
export const BIBLICAL_VOICE_DESIGN = importVoiceDesign(BIBLICAL_VOICE_WORKFLOW, "Biblical template · image-guided voice");

/** Update both widget representations while preserving graph links and runtime configuration. */
export function exportVoiceWorkflow(design: VoiceDesign): VoiceWorkflow {
  validateVoiceDesign(design);
  const workflow = structuredClone(design.workflow);
  const patch = (type: string, names: string[], values: Record<string, unknown>, nodeId?: number) => {
    const node = workflow.nodes.find((item) => item.type === type && (nodeId === undefined || item.id === nodeId));
    if (!node) throw new Error(`Workflow is missing ${type}.`);
    node.widgets_values ??= [];
    node.widgets_values_named ??= {};
    for (const [name, value] of Object.entries(values)) {
      node.widgets_values[names.indexOf(name)] = value;
      node.widgets_values_named[name] = value;
    }
  };
  patch("UnifiedVoiceDesignerNode", DESIGN_FIELDS, { reference_text: design.referenceText, seed: design.seed, control_after_generate: "fixed", ...(!design.enhancer ? { voice_instruction: design.description } : {}) });
  if (design.enhancer) {
    patch("SulphurPromptEnhancer", ["prompt"], { prompt: design.enhancer.prompt }, design.enhancer.nodeId);
    patch("LoadImage", ["image", "upload"], { image: design.enhancer.image }, design.enhancer.imageNodeId);
  }
  patch("Qwen3TTSEngineNode", ENGINE_FIELDS, { language: design.language, top_k: design.topK, top_p: design.topP, temperature: design.temperature, repetition_penalty: design.repetitionPenalty, max_new_tokens: design.maxNewTokens });
  patch("SaveAudioAdvanced", ["filename_prefix", "format"], { filename_prefix: voiceDesignFilename(design.name), format: design.format });
  return workflow;
}

export function voiceDesignFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "voice-design";
}

export function createVoiceDesignAsset(design: VoiceDesign, id: string, sourcePictureId: string, audio?: VoiceDesignAsset["audio"], now = Date.now()): VoiceDesignAsset {
  validateVoiceDesign(design);
  if (audio && (audio.referenceText !== design.referenceText || !audio.bytes || !audio.mediaUri.startsWith("data:audio/"))) throw new Error("Audio must include its exact spoken reference text and a playable audio file.");
  return { id, design: structuredClone(design), sourcePictureId, createdAt: now, revision: 1, textKind: "audition", status: audio ? "NEEDS_REVIEW" : "DRAFT", ...(audio ? { audio: structuredClone(audio) } : {}) };
}
