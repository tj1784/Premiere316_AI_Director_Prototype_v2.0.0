import { test } from "node:test";
import assert from "node:assert/strict";
import { BIBLICAL_VOICE_DESIGN, createVoiceDesignAsset, exportVoiceWorkflow, importVoiceDesign, MASCULINE_VOICE_DESIGN, validateVoiceDesign } from "./voice-design-library.ts";

test("supplied preset preserves the user's exact design and sampling controls", () => {
  const design = MASCULINE_VOICE_DESIGN;
  assert.equal(design.seed, 3160914);
  assert.equal(design.description, "random realistic masculine man in his 20s during 1st century judea deep voice");
  assert.equal(design.referenceText, '"Father, give me the share of the property that will belong to me."');
  assert.equal(design.topK, 38);
  assert.equal(design.topP, 0.44);
  assert.equal(design.temperature, 2);
  assert.equal(design.repetitionPenalty, 1.2);
  assert.equal(design.maxNewTokens, 8192);
  assert.equal(design.format, "flac");
});

test("edited export updates named and positional values without mutating source or runtime wiring", () => {
  const original = structuredClone(MASCULINE_VOICE_DESIGN);
  const edited = { ...original, referenceText: "A different audition.", description: "A low warm voice.", seed: 100, temperature: 0.8, format: "wav" as const };
  const workflow = exportVoiceWorkflow(edited);
  const parsed = importVoiceDesign(workflow, "Round trip");
  for (const key of ["referenceText", "description", "seed", "temperature", "format"] as const) assert.equal(parsed[key], edited[key]);
  const engine = workflow.nodes.find((node) => node.type === "Qwen3TTSEngineNode")!;
  assert.equal(engine.widgets_values?.[7], 0.8);
  assert.equal(engine.widgets_values_named?.runtime_mode, "⚠️ Dedicated Runtime");
  assert.deepEqual(workflow.links, original.workflow.links);
  assert.deepEqual(MASCULINE_VOICE_DESIGN, original);
  const designer = workflow.nodes.find((node) => node.type === "UnifiedVoiceDesignerNode")!;
  assert.equal(designer.widgets_values?.[0], edited.referenceText);
  for (const node of workflow.nodes) delete node.widgets_values_named;
  assert.equal(importVoiceDesign(workflow, "Positional").seed, 100);
});

test("reject malformed workflows and invalid controls instead of silently coercing them", () => {
  for (const workflow of [null, {}, { nodes: [null] }, { nodes: [] }]) assert.throws(() => importVoiceDesign(workflow, "bad"));
  for (const patch of [{ seed: NaN }, { seed: -1 }, { topP: 0 }, { topK: 2.5 }, { description: " " }, { temperature: Infinity }, { maxNewTokens: 8193 }]) {
    assert.throws(() => validateVoiceDesign({ ...MASCULINE_VOICE_DESIGN, ...patch }));
  }
  const wrongModel = structuredClone(MASCULINE_VOICE_DESIGN.workflow);
  wrongModel.nodes.find((node) => node.type === "Qwen3TTSEngineNode")!.widgets_values_named!.model_variant = "remote:other";
  assert.throws(() => importVoiceDesign(wrongModel, "bad"), /Conflicting named and positional/);
});

test("saving snapshots keeps exact reference text and imported provenance, without auto-approval", () => {
  const design = structuredClone(MASCULINE_VOICE_DESIGN);
  const draft = createVoiceDesignAsset(design, "draft-1", "pic-1");
  const audio = { mediaUri: "data:audio/wav;base64,YWJj", filename: "audition.wav", bytes: 3, referenceText: design.referenceText, origin: "imported" as const };
  const asset = createVoiceDesignAsset(design, "sample-1", "pic-1", audio);
  design.referenceText = "Changed after save";
  assert.equal(draft.status, "DRAFT");
  assert.equal(asset.status, "NEEDS_REVIEW");
  assert.equal(asset.audio?.referenceText, asset.design.referenceText);
  assert.notEqual(asset.design.referenceText, design.referenceText);
  assert.equal(asset.audio?.origin, "imported");
  assert.deepEqual(JSON.parse(JSON.stringify(asset)), asset);
  assert.throws(() => createVoiceDesignAsset(design, "bad", "pic-1", audio), /exact spoken/);
});

test("biblical template supports connected instructions and preserves image, model and runtime settings", () => {
  const design = BIBLICAL_VOICE_DESIGN;
  assert.equal(design.description, "");
  assert.equal(design.enhancer?.image, "PS-CHR-YOUNGER.png");
  assert.match(design.referenceText, /For God so loved the world/);
  assert.deepEqual([design.topK, design.topP, design.temperature, design.repetitionPenalty], [100, 1, 1.2, 1]);
  const workflow = exportVoiceWorkflow(design);
  assert.deepEqual(workflow.links, design.workflow.links);
  assert.equal((workflow.links as unknown[]).length, 7);
  for (const node of design.workflow.nodes.filter((item) => item.type !== "SaveAudioAdvanced")) {
    assert.deepEqual(workflow.nodes.find((item) => item.id === node.id), node);
  }
  const engine = workflow.nodes.find((node) => node.type === "Qwen3TTSEngineNode")!;
  assert.equal(engine.widgets_values_named?.use_torch_compile, true);
  assert.equal(engine.widgets_values_named?.use_cuda_graphs, true);
  const asset = createVoiceDesignAsset(design, "biblical", "pic-1");
  assert.deepEqual(JSON.parse(JSON.stringify(asset)), asset);
  assert.equal(asset.status, "DRAFT");
});

test("editing enhancer inputs changes only their widgets and keeps generated instructions separate from spoken text", () => {
  const design = structuredClone(BIBLICAL_VOICE_DESIGN);
  design.enhancer!.prompt = "Create a youthful baritone voice description.";
  design.enhancer!.image = "another-character.png";
  design.referenceText = "Only this text is spoken.";
  const workflow = exportVoiceWorkflow(design);
  const enhancer = workflow.nodes.find((node) => node.id === design.enhancer!.nodeId)!;
  assert.equal(enhancer.widgets_values?.[0], design.enhancer!.prompt);
  assert.equal(enhancer.widgets_values_named?.prompt, design.enhancer!.prompt);
  assert.deepEqual(enhancer.widgets_values?.slice(1), BIBLICAL_VOICE_DESIGN.workflow.nodes.find((node) => node.id === enhancer.id)!.widgets_values?.slice(1));
  const designer = workflow.nodes.find((node) => node.type === "UnifiedVoiceDesignerNode")!;
  assert.equal(designer.widgets_values_named?.voice_instruction, "");
  assert.equal(designer.widgets_values_named?.reference_text, design.referenceText);
  assert.deepEqual(designer.inputs, BIBLICAL_VOICE_DESIGN.workflow.nodes.find((node) => node.id === designer.id)!.inputs);
  assert.equal(importVoiceDesign(workflow, "edited").enhancer?.image, "another-character.png");
  for (const node of workflow.nodes) delete node.widgets_values_named;
  assert.equal(importVoiceDesign(workflow, "positional").enhancer?.prompt, design.enhancer!.prompt);
  assert.equal(BIBLICAL_VOICE_DESIGN.enhancer?.image, "PS-CHR-YOUNGER.png");
});

test("missing enhancer connections or empty casting inputs cannot silently become a manual voice", () => {
  const disconnected = structuredClone(BIBLICAL_VOICE_DESIGN.workflow);
  disconnected.links = (disconnected.links as unknown[][]).filter((link) => link[0] !== 5);
  assert.throws(() => importVoiceDesign(disconnected, "broken"), /connection/);
  const design = structuredClone(BIBLICAL_VOICE_DESIGN);
  delete design.enhancer;
  assert.throws(() => validateVoiceDesign(design), /match/);
  const empty = structuredClone(BIBLICAL_VOICE_DESIGN);
  empty.enhancer!.prompt = " ";
  assert.throws(() => validateVoiceDesign(empty), /Casting instructions/);
});

test("effective workflow rejects duplicate IDs, connected editable controls and wrong preview output",()=>{
 const duplicate=structuredClone(MASCULINE_VOICE_DESIGN.workflow);
 duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
 assert.throws(()=>importVoiceDesign(duplicate,'duplicate'));
 const connected=structuredClone(MASCULINE_VOICE_DESIGN.workflow);
 const engine=connected.nodes.find(n=>n.type==='Qwen3TTSEngineNode')!;
 engine.inputs!.push({name:'seed',type:'INT',link:999});
 assert.throws(()=>importVoiceDesign(connected,'connected'));
 const wrong=structuredClone(MASCULINE_VOICE_DESIGN.workflow);
 const designer=wrong.nodes.find(n=>n.type==='UnifiedVoiceDesignerNode')!;
 const link=(wrong.links as Array<Array<string|number>>).find(l=>l[1]===designer.id)!;link[2]=0;
 assert.throws(()=>importVoiceDesign(wrong,'wrong output'));
});
