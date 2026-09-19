/** Read-only verification of the repaired Scene18 workflow and installed queue logic.
 * No workflow migration, server request, model loading, or generation is performed.
 * Run: node scripts/verify-scene18-director-controls.cjs [workflow.json] [API-export.json ...]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const workflowPath = path.resolve(process.argv[2] || 'D:/Data/Downloads/Scene_18_The_father_runs(2).json');
const installed = 'D:/AI/ComfyUI/Instances/LTX2.5/custom_nodes/WhatDreamsCost-ComfyUI';
const migration = path.join(__dirname, 'migrate-director-generation-options.py');
const python = 'D:/Dev/Tools/Python312/python.exe';
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const beforeBytes = fs.readFileSync(workflowPath);
const workflow = JSON.parse(beforeBytes.toString('utf8').replace(/^\uFEFF/, ''));
const director = workflow.nodes.find(node => node.type === 'LTXDirector');
assert.ok(director, 'Missing Director');
const directorId = String(director.id);
const timeline = JSON.parse(director.widgets_values[6]);
const withoutOptions = value => {
  const result = clone(value);
  delete result.generationOptions;
  return result;
};
const timelineFingerprint = sha256(JSON.stringify(withoutOptions(timeline)));

// Reuse the project's boundary resolver, but deliberately never call transform().
const flattenCode = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('migration',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
w=json.load(open(sys.argv[2],encoding='utf-8-sig'))
print(json.dumps(m.flatten(w)))`;
const flattened = JSON.parse(execFileSync(python, ['-c', flattenCode, migration, workflowPath], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}));

// The migration flattener resolves wires only. Read scalar test values from the
// actual saved widgets; do not substitute the expected preset numbers here.
const definitions = new Map(workflow.definitions.subgraphs.map(graph => [graph.id, graph]));
const uiNodes = new Map();
function indexUi(graph, prefix = '') {
  for (const node of graph.nodes) {
    const id = prefix + node.id;
    const definition = definitions.get(node.type);
    if (definition) indexUi(definition, id + ':');
    else uiNodes.set(id, node);
  }
}
indexUi(workflow);
const widgetNames = {
  ComfyMathExpression: ['expression'],
  ManualSigmas: ['sigmas'],
  BasicScheduler: ['scheduler', 'steps', 'denoise'],
  ComfySwitchNode: ['switch'],
  UNETLoader: ['unet_name', 'weight_dtype'],
  LoraLoaderModelOnly: ['lora_name', 'strength_model'],
  VAEDecodeTiled: ['tile_size', 'overlap', 'temporal_size', 'temporal_overlap'],
};
for (const [id, node] of Object.entries(flattened)) {
  const values = uiNodes.get(id)?.widgets_values;
  for (const [index, name] of (widgetNames[node.class_type] || []).entries()) {
    if (!(name in node.inputs) && values?.[index] !== undefined) node.inputs[name] = values[index];
  }
}
// These scheduler widgets are promoted into their outer subgraphs.
for (const [outerId, widgetIndex, innerId] of [[131, 1, '131:21'], [132, 2, '132:33']]) {
  const outer = workflow.nodes.find(node => node.id === outerId);
  assert.ok(outer && Number.isInteger(outer.widgets_values[widgetIndex]), 'Missing promoted steps');
  flattened[innerId].inputs.steps = outer.widgets_values[widgetIndex];
}
const frameRate = Number(director.widgets_values_named?.frame_rate ?? director.properties.frame_rate);
const totalFrames = Number(director.widgets_values[5]);
Object.assign(flattened[directorId].inputs, {
  timeline_data: director.widgets_values[6],
  start_frame: director.widgets_values[3],
  duration_frames: totalFrames,
});

function assertGraph(nodes) {
  const active = new Set(), done = new Set();
  function visit(id) {
    assert.ok(!active.has(id), `Graph cycle at ${id}`);
    if (done.has(id)) return;
    assert.ok(nodes[id], `Missing graph node ${id}`);
    active.add(id);
    for (const [name, value] of Object.entries(nodes[id].inputs || {})) {
      if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[1])) continue;
      assert.ok(nodes[String(value[0])], `Dangling link ${id}.${name} -> ${value[0]}`);
      visit(String(value[0]));
    }
    active.delete(id);
    done.add(id);
  }
  Object.keys(nodes).forEach(visit);
}
function select(nodes, id) {
  const node = nodes[id];
  assert.equal(node.class_type, 'ComfySwitchNode');
  assert.equal(typeof node.inputs.switch, 'boolean');
  const edge = node.inputs[node.inputs.switch ? 'on_true' : 'on_false'];
  assert.ok(Array.isArray(edge) && nodes[edge[0]], `Missing selected branch ${id}`);
  return { id: String(edge[0]), node: nodes[edge[0]], slot: edge[1] };
}
function scalar(nodes, edge) {
  assert.ok(Array.isArray(edge));
  const node = nodes[edge[0]];
  assert.equal(node.class_type, 'ComfyMathExpression');
  const constant = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(node.inputs.expression);
  if (constant) return Number(constant[1]);
  // Evaluate only this supported affine CFG form; never eval workflow text.
  const match = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\*\s*a\s*$/.exec(node.inputs.expression);
  assert.ok(match, `Unsupported CFG expression ${node.inputs.expression}`);
  assert.equal(typeof node.inputs['values.a'], 'boolean');
  return Number(match[1]) - Number(match[2]) * Number(node.inputs['values.a']);
}
function checkPreset(nodes, options, stage) {
  const ids = stage === 1
    ? { sampler: '132:31', switch: '132:311', guider: '132:28', dev: '132:33', distilled: '132:310' }
    : { sampler: '131:19', switch: '131:307', guider: '131:17', dev: '131:21', distilled: '131:306' };
  assert.deepEqual(nodes[ids.sampler].inputs.sigmas, [ids.switch, 0]);
  assert.deepEqual(nodes[ids.sampler].inputs.guider, [ids.guider, 0]);
  const selected = select(nodes, ids.switch);
  assert.equal(selected.id, ids.dev);
  assert.equal(selected.node.class_type, 'BasicScheduler');
  assert.equal(selected.node.inputs.scheduler, 'linear_quadratic');
  assert.equal(selected.node.inputs.denoise, stage === 1 ? 1 : 0.42);
  const steps = selected.node.inputs.steps;
  const expectedSteps = Number.isInteger(options[stage === 1 ? 'stage1Steps' : 'stage2Steps'])
    ? options[stage === 1 ? 'stage1Steps' : 'stage2Steps']
    : (options.distilled ? (stage === 1 ? 8 : 3) : (stage === 1 ? 30 : 8));
  assert.equal(steps, expectedSteps);
  const guider = nodes[ids.guider];
  const cfg = [scalar(nodes, guider.inputs.video_cfg), scalar(nodes, guider.inputs.audio_cfg)];
  assert.deepEqual(cfg, options.distilled ? [1, 1] : [3, 7]);
  return { steps, cfg };
}
function checkModel(nodes, options) {
  const selected = select(nodes, '317:303');
  assert.equal(selected.id, options.distilled ? '302' : '35');
  assert.equal(selected.node.class_type, options.distilled ? 'LoraLoaderModelOnly' : 'UNETLoader');
  assert.match(nodes['35'].inputs.unet_name, /ltx-2\.5-22b-dev-transformer-bf16\.safetensors$/);
  if (options.distilled) {
    assert.deepEqual(selected.node.inputs.model, ['35', 0]);
    assert.equal(selected.node.inputs.lora_name, 'ltx25_turbo_distill_r256.safetensors');
    assert.equal(selected.node.inputs.strength_model, 1);
  }
}
function checkDecode(nodes, options) {
  const selected = select(nodes, '134:313');
  assert.equal(selected.id, options.tiledDecode ? '134:312' : '134:1');
  assert.equal(selected.node.class_type, options.tiledDecode ? 'VAEDecodeTiled' : 'VAEDecode');
  const policies = Object.entries(nodes).filter(([, node]) => node.class_type === 'LTXDirectorVAEPolicy');
  assert.equal(policies.length, 2);
  assert.ok(policies.every(([, node]) => node.inputs.unload_vae === options.unloadVae));
  assert.deepEqual(nodes['134:1'].inputs.vae, nodes['134:312'].inputs.vae);
  for (const [id, input, raw] of [['134:1', 'vae', '36'], ['134:312', 'vae', '36'], ['134:24', 'audio_vae', '8']]) {
    const proxy = nodes[nodes[id].inputs[input][0]];
    assert.equal(proxy.class_type, 'LTXDirectorVAEPolicy');
    assert.deepEqual(proxy.inputs.vae, [raw, 0]);
  }
  assert.deepEqual(nodes['131:109'].inputs.vae, ['36', 0], 'Stage2 encode VAE must remain unwrapped');
  assert.deepEqual(nodes['131:14'].inputs.vae, ['36', 0], 'Upscaler VAE must remain unwrapped');
}
function checkTimeline(value, options) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  assert.equal(sha256(JSON.stringify(withoutOptions(parsed))), timelineFingerprint, 'Prompts/references/timing changed');
  assert.deepEqual(parsed.generationOptions, options);
}
function checkSnapshot(prompt, options) {
  const node = prompt.workflow.nodes.find(node => String(node.id) === directorId);
  for (const value of [node.widgets_values[6], node.properties.timeline_data, node.widgets_values_named.timeline_data]) {
    checkTimeline(value, options);
  }
}

async function main() {
  const load = name => import('data:text/javascript;base64,' + Buffer.from(
    fs.readFileSync(path.join(installed, 'js', name), 'utf8')).toString('base64'));
  const { applyDirectorGenerationOptions } = await load('ltx_director_generation.js');
  const { buildStage1Queue } = await load('ltx_stage1_queue.js');
  const bindings = director.properties.director_generation_bindings;
  assert.equal(bindings.version, 1);
  assert.deepEqual(bindings.distilled.map(item => item.nodeId).sort(),
    ['132:308', '132:309', '132:311', '131:304', '131:305', '131:307', '317:303'].sort());
  assert.deepEqual(bindings.tiledDecode.map(item => item.nodeId), ['134:313']);
  assert.deepEqual(bindings.ui, [
    { nodeId: '131', input: 'distilled_mode', widgetIndex: 3, option: 'distilled' },
    { nodeId: '132', input: 'distilled_mode', widgetIndex: 4, option: 'distilled' },
    { nodeId: '134', input: 'tiled_decode', widgetIndex: 0, option: 'tiledDecode' },
  ]);
  assert.deepEqual(timeline.generationOptions, { version: 1, distilled: true, tiledDecode: true, unloadVae: false });
  assert.ok(!workflow.nodes.some(node => ['PrimitiveBoolean', 'ComfySwitchNode'].includes(node.type)), 'Standalone controls remain');
  assert.equal(timeline.icReferenceMode, true);
  assert.equal(timeline.icInputs.length, 4);
  assert.equal(timeline.motionSegments.length, 4);
  assert.deepEqual(timeline.motionSegments.map(segment => segment.inputIndex), [0, 1, 2, 3]);
  assert.ok(timeline.motionSegments.every(segment => segment.start === 0 && segment.length === totalFrames && segment.videoFile));
  assert.equal(timeline.segments.length, 8);
  assert.equal(frameRate, 24);
  assert.equal(totalFrames, Math.max(...timeline.segments.map(segment => segment.start + segment.length)));
  assertGraph(flattened);
  const rows = [];
  let checkedGraphs = 1;
  for (const distilled of [false, true]) for (const tiledDecode of [false, true]) for (const unloadVae of [false, true]) {
    const options = { version: 1, distilled, tiledDecode, unloadVae };
    const changedTimeline = { ...clone(timeline), generationOptions: options };
    const prompt = { output: clone(flattened), workflow: clone(workflow) };
    prompt.output[directorId].inputs.timeline_data = JSON.stringify(changedTimeline);
    applyDirectorGenerationOptions(prompt);
    const fingerprint = sha256(JSON.stringify(prompt));
    applyDirectorGenerationOptions(prompt);
    assert.equal(sha256(JSON.stringify(prompt)), fingerprint, 'Option application is not idempotent');
    for (const binding of bindings.ui) {
      const node = prompt.workflow.nodes.find(item => String(item.id) === binding.nodeId);
      assert.equal(node.widgets_values[binding.widgetIndex], options[binding.option]);
    }
    checkSnapshot(prompt, options);
    assert.deepEqual(prompt.output[directorId].inputs.model, ['317:303', 0]);
    assert.deepEqual(prompt.output[directorId].inputs.audio_vae, ['8', 0]);
    assert.deepEqual(prompt.output['132:108'].inputs.vae, ['36', 0]);
    checkModel(prompt.output, options);
    const first = checkPreset(prompt.output, options, 1);
    const second = checkPreset(prompt.output, options, 2);
    checkDecode(prompt.output, options);
    assertGraph(prompt.output); checkedGraphs++;
    const runId = randomUUID();
    const result = buildStage1Queue({ prompt, directorId, runId,
      segments: changedTimeline.segments, frameRate, totalFrames, originalTimeline: changedTimeline });
    const stage1 = result.stage1Prompt.output;
    assert.equal(Object.values(stage1).filter(node => node.class_type === 'LTXDirector').length, 1);
    assert.equal(Object.values(stage1).filter(node => node.class_type === 'SamplerCustomAdvanced').length, 1);
    assert.ok(!Object.keys(stage1).some(id => id.startsWith('131:') || id.startsWith('134:')));
    assert.ok(!Object.values(stage1).some(node => node.class_type === 'LTXDirectorVAEPolicy'));
    const save = Object.values(stage1).find(node => node.class_type === 'LTXDirectorSaveStage1');
    assert.ok(save);
    assert.equal(save.inputs.run_id, runId);
    assert.equal(save.inputs.total_frames, totalFrames);
    checkTimeline(save.inputs.timeline_data, options);
    checkSnapshot(result.stage1Prompt, options);
    checkPreset(stage1, options, 1);
    checkModel(stage1, options);
    assertGraph(stage1); checkedGraphs++;
    assert.equal(result.segmentPrompts.length, 8);
    result.segmentPrompts.forEach((job, index) => {
      const nodes = job.output;
      assert.ok(!Object.keys(nodes).some(id => id.startsWith('132:')));
      assert.ok(!Object.values(nodes).some(node => /LTXDirector$|CLIPLoader|TextEncode|LTXDirectorSaveStage1/.test(node.class_type)));
      assert.equal(Object.values(nodes).filter(node => node.class_type === 'SamplerCustomAdvanced').length, 1);
      const entry = Object.entries(nodes).find(([, node]) => node.class_type === 'LTXDirectorLoadStage1Segment');
      assert.ok(entry);
      const [loadId, load] = entry;
      assert.deepEqual(load.inputs, { model: ['317:303', 0], audio_vae: ['8', 0], run_id: runId,
        start_frame: timeline.segments[index].start, duration_frames: timeline.segments[index].length });
      assert.deepEqual(nodes['131:109'].inputs.motion_guide_data, [loadId, 5]);
      assert.deepEqual(nodes['131:109'].inputs.guide_data, [loadId, 4]);
      assert.deepEqual(nodes['131:109'].inputs.model, [loadId, 6]);
      const trim = Object.values(nodes).find(node => node.class_type === 'LTXDirectorTrimStage2');
      assert.ok(trim);
      assert.deepEqual(trim.inputs.trim_data, [loadId, 7]);
      assert.deepEqual(trim.inputs.images, ['134:313', 0]);
      checkSnapshot(job, options);
      checkModel(nodes, options);
      checkPreset(nodes, options, 2);
      checkDecode(nodes, options);
      assertGraph(nodes); checkedGraphs++;
    });
    rows.push({ distilled, tiledDecode, unloadVae, stage1Steps: first.steps, stage2Steps: second.steps,
      videoAudioCfg: first.cfg.join('/'), stage2Jobs: result.segmentPrompts.length });
  }
  const browserExports = [];
  for (const exportPath of process.argv.slice(3)) {
    const bytes = fs.readFileSync(exportPath);
    const nodes = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const actualTimeline = JSON.parse(nodes[directorId].inputs.timeline_data);
    const options = actualTimeline.generationOptions;
    for (const key of ['segments', 'motionSegments', 'icInputs', 'icReferenceMode', 'global_prompt']) {
      assert.deepEqual(actualTimeline[key], timeline[key], `Browser export changed ${key}`);
    }
    assert.equal(nodes[directorId].inputs.start_frame, 0);
    assert.equal(nodes[directorId].inputs.duration_frames, totalFrames);
    checkModel(nodes, options);
    checkPreset(nodes, options, 1);
    checkPreset(nodes, options, 2);
    checkDecode(nodes, options);
    assertGraph(nodes); checkedGraphs++;
    // This pass consumes real graphToPrompt scalar values and addresses, without
    // using any of the flattener's widget hydration above.
    const result = buildStage1Queue({ prompt: { output: nodes, workflow: clone(workflow) },
      directorId, runId: randomUUID(), segments: actualTimeline.segments,
      frameRate, totalFrames, originalTimeline: actualTimeline });
    checkModel(result.stage1Prompt.output, options);
    checkPreset(result.stage1Prompt.output, options, 1);
    assert.ok(!Object.values(result.stage1Prompt.output).some(node => node.class_type === 'LTXDirectorVAEPolicy'));
    assertGraph(result.stage1Prompt.output); checkedGraphs++;
    assert.equal(result.segmentPrompts.length, 8);
    for (const job of result.segmentPrompts) {
      checkModel(job.output, options);
      checkPreset(job.output, options, 2);
      checkDecode(job.output, options);
      assert.ok(!Object.values(job.output).some(node => /LTXDirector$|CLIPLoader|TextEncode/.test(node.class_type)));
      assertGraph(job.output); checkedGraphs++;
    }
    assert.equal(sha256(fs.readFileSync(exportPath)), sha256(bytes));
    browserExports.push({ file: path.resolve(exportPath), sha256: sha256(bytes), options,
      nodes: Object.keys(nodes).length, stage2Jobs: result.segmentPrompts.length });
  }
  assert.equal(sha256(fs.readFileSync(workflowPath)), sha256(beforeBytes), 'Verifier changed workflow file');
  console.log(JSON.stringify({ status: 'PASS', workflow: workflowPath, sha256: sha256(beforeBytes),
    optionCombinations: rows.length, graphsChecked: checkedGraphs, stage2JobsChecked: (rows.length + browserExports.length) * 8,
    referencesPreserved: timeline.motionSegments.length, timelineFrames: totalFrames,
    frameRate, seconds: totalFrames / frameRate, cases: rows, browserExports }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
