import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { compileDirectorWorkflow } from './director-compiler.mjs';

// Trimmed ComfyUI 0.34.0 object_info snapshot: only the supplied graph's classes
// and model selections. Tests are deterministic and never contact ComfyUI.
const objectInfo = {"easy seed":{"input":{"required":{"seed":["INT",{"min":0,"max":1125899906842624}]}},"input_order":{"required":["seed"],"hidden":["prompt","extra_pnginfo","my_unique_id"]},"output":["INT"],"output_node":false},"VAELoader":{"input":{"required":{"vae_name":[["LTX\\ltx-2.5-video-vae-bf16.safetensors","LTX\\ltx-2.5-audio-vae-bf16.safetensors"],{}]}},"input_order":{"required":["vae_name"]},"output":["VAE"],"output_node":false},"CLIPLoader":{"input":{"required":{"clip_name":[["LTX\\2.5\\gemma4-12b-with-proj-ltx-2.5-bf16.safetensors"],{}],"type":[["stable_diffusion","stable_cascade","sd3","stable_audio","mochi","ltxv","pixart","cosmos","lumina2","wan","hidream","chroma","ace","omnigen2","qwen_image","hunyuan_image","flux2","ovis","longcat_image","cogvideox","lens","pixeldit","ideogram4","boogu","krea2","joyimage","mage","minimax"],{}]},"optional":{"device":[["default","cpu"],{}]}},"input_order":{"required":["clip_name","type"],"optional":["device"]},"output":["CLIP"],"output_node":false},"VHS_VideoCombine":{"input":{"required":{"images":["IMAGE",{}],"frame_rate":["FLOAT",{"min":1}],"loop_count":["INT",{"min":0,"max":100}],"filename_prefix":["STRING",{}],"format":[["image/gif","image/webp","video/16bit-png","video/8bit-png","video/av1-webm","video/ffmpeg-gif","video/ffv1-mkv","video/h264-mp4","video/h265-mp4","video/nvenc_av1-mp4","video/nvenc_h264-mp4","video/nvenc_hevc-mp4","video/ProRes","video/webm"],{"formats":{"video/h264-mp4":[["pix_fmt",["yuv420p","yuv420p10le"]],["crf","INT",{"default":19,"min":0,"max":100,"step":1}],["save_metadata","BOOLEAN",{"default":true}],["trim_to_audio","BOOLEAN",{"default":false}]]}}],"pingpong":["BOOLEAN",{}],"save_output":["BOOLEAN",{}]},"optional":{"audio":["AUDIO",{}],"meta_batch":["VHS_BatchManager",{}],"vae":["VAE",{}]}},"input_order":{"required":["images","frame_rate","loop_count","filename_prefix","format","pingpong","save_output"],"optional":["audio","meta_batch","vae"],"hidden":["prompt","extra_pnginfo","unique_id"]},"output":["VHS_FILENAMES"],"output_node":true},"UNETLoader":{"input":{"required":{"unet_name":[["LTX\\2.5\\ltx-2.5-22b-dev-transformer-bf16.safetensors"],{}],"weight_dtype":[["default","fp8_e4m3fn","fp8_e4m3fn_fast","fp8_e5m2"],{}]}},"input_order":{"required":["unet_name","weight_dtype"]},"output":["MODEL"],"output_node":false},"LTXDirector":{"input":{"required":{"model":["MODEL",{}],"clip":["CLIP",{}],"start_second":["FLOAT",{"min":0,"max":1000}],"end_second":["FLOAT",{"min":0,"max":1000}],"duration_seconds":["FLOAT",{"min":0.1,"max":1000}],"start_frame":["INT",{"min":0,"max":10000}],"end_frame":["INT",{"min":1,"max":10000}],"duration_frames":["INT",{"min":1,"max":10000}],"timeline_data":["STRING",{}],"local_prompts":["STRING",{}],"segment_lengths":["STRING",{}],"epsilon":["FLOAT",{"min":0.0001,"max":0.99}],"guide_strength":["STRING",{}]},"optional":{"audio_vae":["VAE",{}],"optional_latent":["LATENT",{}],"global_prompt":["STRING",{"forceInput":true}],"use_custom_audio":["BOOLEAN",{}],"use_custom_motion":["BOOLEAN",{}],"inpaint_audio":["BOOLEAN",{}],"frame_rate":["FLOAT",{"min":1,"max":240}],"display_mode":["COMBO",{"options":["frames","seconds"]}],"custom_width":["INT",{"min":0,"max":8192}],"custom_height":["INT",{"min":0,"max":8192}],"resize_method":["COMBO",{"options":["maintain aspect ratio","stretch to fit","pad","pad green","crop"]}],"divisible_by":["INT",{"min":1,"max":256}],"img_compression":["INT",{"min":0,"max":100}],"override_audio":["BOOLEAN",{}]}},"input_order":{"required":["model","clip","start_second","end_second","duration_seconds","start_frame","end_frame","duration_frames","timeline_data","local_prompts","segment_lengths","epsilon","guide_strength"],"optional":["audio_vae","optional_latent","global_prompt","use_custom_audio","use_custom_motion","inpaint_audio","frame_rate","display_mode","custom_width","custom_height","resize_method","divisible_by","img_compression","override_audio"]},"output":["MODEL","CONDITIONING","LATENT","LATENT","GUIDE_DATA","MOTION_GUIDE_DATA","FLOAT","AUDIO"],"output_node":false},"LTXVConcatAVLatent":{"input":{"required":{"video_latent":["LATENT",{}],"audio_latent":["LATENT",{}]}},"input_order":{"required":["video_latent","audio_latent"]},"output":["LATENT"],"output_node":false},"KSamplerSelect":{"input":{"required":{"sampler_name":["COMBO",{"options":["euler","euler_cfg_pp","euler_ancestral","euler_ancestral_cfg_pp","heun","heunpp2","exp_heun_2_x0","exp_heun_2_x0_sde","dpm_2","dpm_2_ancestral","lms","dpm_fast","dpm_adaptive","dpmpp_2s_ancestral","dpmpp_2s_ancestral_cfg_pp","dpmpp_sde","dpmpp_sde_gpu","dpmpp_2m","dpmpp_2m_cfg_pp","dpmpp_2m_sde","dpmpp_2m_sde_gpu","dpmpp_2m_sde_heun","dpmpp_2m_sde_heun_gpu","dpmpp_3m_sde","dpmpp_3m_sde_gpu","ddpm","lcm","ipndm","ipndm_v","deis","res_multistep","res_multistep_cfg_pp","res_multistep_ancestral","res_multistep_ancestral_cfg_pp","gradient_estimation","gradient_estimation_cfg_pp","er_sde","seeds_2","seeds_3","sa_solver","sa_solver_pece","ddim","uni_pc","uni_pc_bh2","legacy_rk","rk","rk_beta","deis_3m_ode","deis_2m_ode","deis_3m","deis_2m","res_6s_ode","res_5s_ode","res_3s_ode","res_2s_ode","res_3m_ode","res_2m_ode","res_6s","res_5s","res_3s","res_2s","res_3m","res_2m"]}]}},"input_order":{"required":["sampler_name"]},"output":["SAMPLER"],"output_node":false},"LTXVLatentUpsampler":{"input":{"required":{"samples":["LATENT",{}],"upscale_model":["LATENT_UPSCALE_MODEL",{}],"vae":["VAE",{}]}},"input_order":{"required":["samples","upscale_model","vae"]},"output":["LATENT"],"output_node":false},"CFGGuider":{"input":{"required":{"model":["MODEL",{}],"positive":["CONDITIONING",{}],"negative":["CONDITIONING",{}],"cfg":["FLOAT",{"min":0,"max":100}]}},"input_order":{"required":["model","positive","negative","cfg"]},"output":["GUIDER"],"output_node":false},"LTXDirectorCropGuides":{"input":{"required":{"positive":["CONDITIONING",{}],"negative":["CONDITIONING",{}],"latent":["LATENT",{}]}},"input_order":{"required":["positive","negative","latent"]},"output":["CONDITIONING","CONDITIONING","LATENT"],"output_node":false},"SamplerCustomAdvanced":{"input":{"required":{"noise":["NOISE",{}],"guider":["GUIDER",{}],"sampler":["SAMPLER",{}],"sigmas":["SIGMAS",{}],"latent_image":["LATENT",{}]}},"input_order":{"required":["noise","guider","sampler","sigmas","latent_image"]},"output":["LATENT","LATENT"],"output_node":false},"RandomNoise":{"input":{"required":{"noise_seed":["INT",{"min":0,"max":18446744073709552000,"control_after_generate":true}]}},"input_order":{"required":["noise_seed"]},"output":["NOISE"],"output_node":false},"LTXVSeparateAVLatent":{"input":{"required":{"av_latent":["LATENT",{}]}},"input_order":{"required":["av_latent"]},"output":["LATENT","LATENT"],"output_node":false},"BasicScheduler":{"input":{"required":{"model":["MODEL",{}],"scheduler":["COMBO",{"options":["simple","sgm_uniform","karras","exponential","ddim_uniform","beta","normal","linear_quadratic","kl_optimal","FlowMatchEulerDiscreteScheduler","bong_tangent","beta57"]}],"steps":["INT",{"min":1,"max":10000}],"denoise":["FLOAT",{"min":0,"max":1}]}},"input_order":{"required":["model","scheduler","steps","denoise"]},"output":["SIGMAS"],"output_node":false},"LTXDirectorGuide":{"input":{"required":{"positive":["CONDITIONING",{}],"negative":["CONDITIONING",{}],"vae":["VAE",{}],"latent":["LATENT",{}],"guide_data":["GUIDE_DATA",{}]},"optional":{"motion_guide_data":["MOTION_GUIDE_DATA",{}],"model":["MODEL",{}],"ic_lora_name":[["None"],{}],"ic_lora_strength":["FLOAT",{"min":-100,"max":100}],"scale_by":["FLOAT",{"min":0.01,"max":8}],"upscale_method":[["nearest-exact","bilinear","area","bicubic","bislerp"],{}],"image_attention_strength":["FLOAT",{"min":0,"max":1}],"crop":[["disabled","center"],{}],"auto_snap_ic_grid":["BOOLEAN",{}],"use_tiled_encode":["BOOLEAN",{}],"tile_size":["INT",{"min":64,"max":512}],"tile_overlap":["INT",{"min":16,"max":256}],"retake_mode":["BOOLEAN",{}]}},"input_order":{"required":["positive","negative","vae","latent","guide_data"],"optional":["motion_guide_data","model","ic_lora_name","ic_lora_strength","scale_by","upscale_method","image_attention_strength","crop","auto_snap_ic_grid","use_tiled_encode","tile_size","tile_overlap","retake_mode"]},"output":["CONDITIONING","CONDITIONING","LATENT","MODEL","FLOAT"],"output_node":false},"LatentUpscaleModelLoader":{"input":{"required":{"model_name":["COMBO",{"options":["LTX\\2.3\\Director\\ltx-2.3-spatial-upscaler-x2-1.1.safetensors","LTX\\2.5\\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors","LTX\\2.5\\ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors","LTX\\ltx-2-spatial-upscaler-x2-1.0.safetensors","ltx-2-spatial-upscaler-x2-1.0.safetensors","ltx-2.3-spatial-upscaler-x2-1.1.safetensors","ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors","ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors"]}]}},"input_order":{"required":["model_name"]},"output":["LATENT_UPSCALE_MODEL"],"output_node":false},"LTXVConditioning":{"input":{"required":{"positive":["CONDITIONING",{}],"negative":["CONDITIONING",{}],"frame_rate":["FLOAT",{"min":0,"max":1000}]}},"input_order":{"required":["positive","negative","frame_rate"]},"output":["CONDITIONING","CONDITIONING"],"output_node":false},"ConditioningZeroOut":{"input":{"required":{"conditioning":["CONDITIONING",{}]}},"input_order":{"required":["conditioning"]},"output":["CONDITIONING"],"output_node":false},"VAEDecode":{"input":{"required":{"samples":["LATENT",{}],"vae":["VAE",{}]}},"input_order":{"required":["samples","vae"]},"output":["IMAGE"],"output_node":false},"LTXVAudioVAEDecode":{"input":{"required":{"samples":["LATENT",{}],"audio_vae":["VAE",{}]}},"input_order":{"required":["samples","audio_vae"]},"output":["AUDIO"],"output_node":false}};

const directory = new URL('../public/pictures/prodigal-son/director/workflows/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
const activeManifest = JSON.parse(readFileSync(new URL('../public/pictures/prodigal-son/director-manifest.json', import.meta.url), 'utf8'));
const activeFiles = activeManifest.scenes.map(scene => scene.workflow.mediaUri.split('/').at(-1));
const original = () => JSON.parse(readFileSync(new URL(files[0], directory), 'utf8'));
function prepared(workflow = original()) {
  // The archive retains an old named-only filename snapshot. The review editor
  // explicitly synchronizes this metadata before the user approves the graph.
  const video = workflow.nodes.find(node => node.type === 'VHS_VideoCombine');
  video.widgets_values_named.filename_prefix = video.widgets_values.filename_prefix;
  return workflow;
}
const allNodes = workflow => [workflow, ...workflow.definitions.subgraphs].flatMap(container => container.nodes);
function setWidget(node, name, index, value) {
  node.widgets_values[index] = value; node.widgets_values_named[name] = value;
}

test('all 22 supplied scenes compile without changing timing, model settings or source graphs', () => {
  assert.equal(activeFiles.length, 22);
  for (const file of activeFiles) {
    const workflow = prepared(JSON.parse(readFileSync(new URL(file, directory), 'utf8')));
    const before = JSON.stringify(workflow);
    const result = compileDirectorWorkflow(workflow, objectInfo);
    assert.deepEqual(result.issues, [], file);
    assert.equal(result.nodeCount, 33);
    assert.equal(JSON.stringify(workflow), before);
    const source = workflow.nodes.find(node => node.type === 'LTXDirector');
    const director = result.prompt[source.id].inputs;
    for (const name of ['timeline_data', 'local_prompts', 'duration_frames', 'duration_seconds', 'custom_width', 'custom_height', 'frame_rate']) {
      assert.deepEqual(director[name], source.widgets_values_named[name], `${file}: ${name}`);
    }
    assert.equal(director.custom_width, 0);
    assert.equal(director.custom_height, 0);
    assert.equal(result.prompt['21'].inputs.steps, 8);
    assert.equal(result.prompt['33'].inputs.steps, 30);
    assert.equal(result.prompt['163'].inputs.crf, 16);
    assert.equal(result.prompt['163'].inputs.pix_fmt, 'yuv420p');
    assert.equal(result.prompt['211'].inputs.type, 'stable_diffusion');
    assert.equal(result.prompt['211'].inputs.device, 'cpu');
  }
});

test('exposed subgraph edits override internal defaults and preserve linked seeds', () => {
  const graph = prepared();
  const wrapper = graph.nodes.find(node => node.id === 131);
  setWidget(wrapper, 'steps', 1, 17);
  setWidget(wrapper, 'sampler_name', 2, 'heun');
  const result = compileDirectorWorkflow(graph, objectInfo);
  assert.deepEqual(result.issues, []);
  assert.equal(result.prompt['21'].inputs.steps, 17);
  assert.equal(result.prompt['20'].inputs.sampler_name, 'heun');
  assert.deepEqual(result.prompt['30'].inputs.noise_seed, ['143', 0]);
});

test('known archive duplicate and conflicting user edits are review issues', () => {
  assert.match(compileDirectorWorkflow(original(), objectInfo).issues.join('\n'), /163 filename_prefix.*disagree/);
  const graph = prepared();
  graph.nodes.find(node => node.id === 131).widgets_values_named.steps = 99;
  assert.match(compileDirectorWorkflow(graph, objectInfo).issues.join('\n'), /131 steps.*disagree/);
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  director.properties.timeline_data = '{}';
  assert.match(compileDirectorWorkflow(graph, objectInfo).issues.join('\n'), /timeline_data.*properties.*disagree/);
});

test('source remains compilable with canonical widgets and no optional named snapshots', () => {
  const graph = prepared();
  for (const node of allNodes(graph)) delete node.widgets_values_named;
  assert.deepEqual(compileDirectorWorkflow(graph, objectInfo).issues, []);
});

test('missing models, node classes, invalid modern COMBOs, scalar types and bounds are reported', () => {
  const graph = prepared();
  setWidget(graph.nodes.find(node => node.id === 36), 'vae_name', 0, 'missing-model.safetensors');
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  setWidget(director, 'resize_method', 18, 'invented');
  setWidget(director, 'custom_width', 16, 9000);
  setWidget(director, 'frame_rate', 14, '24');
  const info = structuredClone(objectInfo);
  delete info.LTXDirectorGuide;
  const issues = compileDirectorWorkflow(graph, info).issues.join('\n');
  assert.match(issues, /vae_name.*unavailable/);
  assert.match(issues, /resize_method.*unavailable/);
  assert.match(issues, /custom_width.*8192/);
  assert.match(issues, /frame_rate.*expected FLOAT/);
  assert.match(issues, /missing ComfyUI node class LTXDirectorGuide/);
});

test('VHS dynamic encoder settings survive and are checked against the selected format', () => {
  const graph = prepared();
  const video = graph.nodes.find(node => node.type === 'VHS_VideoCombine');
  video.widgets_values.crf = 27; video.widgets_values_named.crf = 27;
  assert.equal(compileDirectorWorkflow(graph, objectInfo).prompt['163'].inputs.crf, 27);
  video.widgets_values.pix_fmt = 'invalid'; video.widgets_values_named.pix_fmt = 'invalid';
  assert.match(compileDirectorWorkflow(graph, objectInfo).issues.join('\n'), /pix_fmt.*unavailable/);
});

test('an actual saved video output is required', () => {
  const graph = prepared();
  const video = graph.nodes.find(node => node.type === 'VHS_VideoCombine');
  video.widgets_values.save_output = false; video.widgets_values_named.save_output = false;
  assert.match(compileDirectorWorkflow(graph, objectInfo).issues.join('\n'), /needs a saved video output/);
});

test('exactly one enabled LTXDirector is required', () => {
  const graph = prepared();
  const director = structuredClone(graph.nodes.find(node => node.type === 'LTXDirector'));
  director.id = 9876; director.inputs = []; director.outputs = [];
  graph.nodes.push(director);
  assert.match(compileDirectorWorkflow(graph, objectInfo).issues.join('\n'), /exactly one enabled LTXDirector/);
});

test('invalid timeline edits are reported without restoring defaults', () => {
  const graph = prepared();
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  const timeline = JSON.parse(director.widgets_values_named.timeline_data);
  timeline.segments[0].length = -1;
  const value = JSON.stringify(timeline);
  setWidget(director, 'timeline_data', 6, value);
  director.properties.timeline_data = value;
  const result = compileDirectorWorkflow(graph, objectInfo);
  assert.equal(result.prompt['135'].inputs.timeline_data, value);
  assert.match(result.issues.join('\n'), /positive frame lengths/);
});

test('broken links, sockets, duplicate ids, recursive definitions and bypasses throw', () => {
  let graph = prepared();
  graph.links[0][1] = 999999;
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /missing node or invalid socket/);
  graph = prepared();
  graph.links[0][2] = 999999;
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /missing node or invalid socket/);
  graph = prepared(); graph.nodes.push(structuredClone(graph.nodes[0]));
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /Duplicate or invalid node/);
  graph = prepared(); graph.nodes[0].mode = 4;
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /unsupported muted\/bypassed/);
  graph = prepared();
  const definition = graph.definitions.subgraphs[0];
  definition.nodes.push({ id: 9876, type: definition.id, inputs: [], outputs: [] });
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /Recursive subgraph/);
});

test('missing required inputs and incompatible backend output types cannot pass preflight', () => {
  const graph = prepared();
  const info = structuredClone(objectInfo);
  info.VAELoader.output = ['MODEL'];
  info.LTXDirector.input.required.new_required_input = ['IMAGE', {}];
  const issues = compileDirectorWorkflow(graph, info).issues.join('\n');
  assert.match(issues, /missing required input new_required_input/);
  assert.match(issues, /cannot connect MODEL to VAE/);
});

test('unresolved global prompt and dimension metadata edits cannot silently disappear', () => {
  const graph = prepared();
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  director.properties.global_prompt = 'An independently changed prompt';
  director.properties.custom_width = 1234;
  const issues = compileDirectorWorkflow(graph, objectInfo).issues.join('\n');
  assert.match(issues, /global_prompt.*disagree/);
  assert.match(issues, /custom_width.*disagree/);
});

test('a disconnected Director feeding only the video frame rate is not a media output', () => {
  const graph = prepared();
  const video = graph.nodes.find(node => node.type === 'VHS_VideoCombine');
  const link = graph.links.find(item => item[0] === video.inputs.find(input => input.name === 'images').link);
  const image = { id: 8765, type: 'LoadImage', inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [link[0]] }], widgets_values: ['reference.png'] };
  graph.nodes.push(image); link[1] = image.id; link[2] = 0;
  const info = { ...objectInfo, LoadImage: { input: { required: { image: [['reference.png']] } }, output: ['IMAGE'] } };
  assert.match(compileDirectorWorkflow(graph, info).issues.join('\n'), /needs a saved video output/);
});

test('executable cycles are rejected rather than queued', () => {
  const graph = prepared();
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  const model = director.inputs.find(input => input.name === 'model');
  const link = graph.links.find(item => item[0] === model.link);
  link[1] = director.id; link[2] = 0;
  assert.throws(() => compileDirectorWorkflow(graph, objectInfo), /Cyclic executable graph/);
});

// These dynamic schemas mirror current ComfyUI V3 object_info, not frontend
// socket labels (which are already resolved in a saved workflow).
const switchInfo = {
  input: { required: { switch: ['BOOLEAN', {}] }, optional: {
    on_false: ['COMFY_MATCHTYPE_V3', { template: { template_id: 'switch', allowed_types: '*' } }],
    on_true: ['COMFY_MATCHTYPE_V3', { template: { template_id: 'switch', allowed_types: '*' } }],
  } }, output: ['COMFY_MATCHTYPE_V3'], output_matchtypes: ['switch'],
};
function dynamicSwitchGraph(falseSource = 35, trueSource = 35) {
  const graph = prepared();
  const director = graph.nodes.find(node => node.type === 'LTXDirector');
  const link = graph.links.find(item => item[0] === director.inputs.find(input => input.name === 'model').link);
  link[1] = 9000; link[2] = 0;
  graph.nodes.push({ id: 9000, type: 'ComfySwitchNode', widgets_values: [true],
    inputs: [{ name: 'on_false', link: 9001 }, { name: 'on_true', link: 9002 }],
    outputs: [{ name: 'output', type: 'MODEL', links: [link[0]] }] });
  graph.links.push([9001, falseSource, 0, 9000, 0], [9002, trueSource, 0, 9000, 1]);
  return graph;
}

test('V3 switches infer one type from both branches and the downstream consumer', () => {
  const info = { ...objectInfo, ComfySwitchNode: switchInfo };
  const graph = dynamicSwitchGraph();
  const before = JSON.stringify(graph);
  const result = compileDirectorWorkflow(graph, info);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.prompt['135'].inputs.model, ['9000', 0]);
  assert.equal(JSON.stringify(graph), before);
  assert.match(compileDirectorWorkflow(dynamicSwitchGraph(35, 36), info).issues.join('\n'), /incompatible dynamic match-type connections/);
  assert.match(compileDirectorWorkflow(dynamicSwitchGraph(36, 36), info).issues.join('\n'), /incompatible dynamic match-type connections/);
});

test('V3 match templates enforce allowed types and do not become global wildcards', () => {
  for (const allowed of ['VAE', ['VAE']]) {
    const restricted = structuredClone(switchInfo);
    for (const schema of Object.values(restricted.input.optional)) schema[1].template.allowed_types = allowed;
    assert.match(compileDirectorWorkflow(dynamicSwitchGraph(), { ...objectInfo, ComfySwitchNode: restricted }).issues.join('\n'), /incompatible dynamic match-type connections/);
  }
  const graph = dynamicSwitchGraph();
  const first = graph.nodes.find(node => node.id === 9000);
  first.inputs[0].link = 9003;
  graph.links = graph.links.filter(link => link[0] !== 9001);
  graph.nodes.push({ id: 9010, type: 'ComfySwitchNode', widgets_values: [false],
    inputs: [{ name: 'on_false', link: 9004 }, { name: 'on_true', link: 9005 }],
    outputs: [{ name: 'output', type: 'MODEL', links: [9003] }] });
  graph.links.push([9003, 9010, 0, 9000, 0], [9004, 35, 0, 9010, 0], [9005, 35, 0, 9010, 1]);
  const info = { ...objectInfo, ComfySwitchNode: switchInfo };
  assert.deepEqual(compileDirectorWorkflow(graph, info).issues, []);
  graph.links.find(link => link[0] === 9005)[1] = 36;
  assert.match(compileDirectorWorkflow(graph, info).issues.join('\n'), /incompatible dynamic match-type connections/);
});

const mathInfo = { input: { required: {
  expression: ['STRING', {}], values: ['COMFY_AUTOGROW_V3', { template: {
    input: { required: { value: ['FLOAT,INT,BOOLEAN', {}] } }, names: ['a', 'b', 'c'], min: 1,
  } }],
} }, output: ['FLOAT', 'INT', 'BOOLEAN'] };
function dynamicMathGraph(name = 'values.a', source = 138) {
  const graph = prepared();
  graph.nodes.push({ id: 9100, type: 'ComfyMathExpression', widgets_values: ['3 - 2 * a'],
    inputs: [{ name, link: 9101 }], outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [] }] });
  graph.links.push([9101, source, 0, 9100, 0]);
  return graph;
}

test('V3 autogrow expands dotted inputs and validates required names and union types', () => {
  const info = { ...objectInfo, ComfyMathExpression: mathInfo };
  const result = compileDirectorWorkflow(dynamicMathGraph(), info);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.prompt['9100'].inputs['values.a'], ['138', 0]);
  assert.ok(!('values' in result.prompt['9100'].inputs));
  assert.match(compileDirectorWorkflow(dynamicMathGraph('values.b'), info).issues.join('\n'), /missing required input values.a/);
  assert.match(compileDirectorWorkflow(dynamicMathGraph('values.aa'), info).issues.join('\n'), /unavailable dynamic input name/);
  assert.match(compileDirectorWorkflow(dynamicMathGraph('values.a', 36), info).issues.join('\n'), /cannot connect VAE to FLOAT,INT,BOOLEAN/);
});

test('V3 autogrow prefix templates enforce their first required sockets', () => {
  const info = structuredClone(mathInfo);
  Object.assign(info.input.required.values[1].template, { prefix: 'input', max: 2, min: 1 });
  delete info.input.required.values[1].template.names;
  const schemas = { ...objectInfo, ComfyMathExpression: info };
  assert.deepEqual(compileDirectorWorkflow(dynamicMathGraph('values.input0'), schemas).issues, []);
  assert.match(compileDirectorWorkflow(dynamicMathGraph('values.input1'), schemas).issues.join('\n'), /missing required input values.input0/);
  assert.match(compileDirectorWorkflow(dynamicMathGraph('values.input2'), schemas).issues.join('\n'), /unavailable dynamic input name/);
});

function decodeToggleGraph(convertedFps = false) {
  const graph = prepared();
  const wrapper = graph.nodes.find(node => node.id === 134);
  const definition = graph.definitions.subgraphs.find(item => item.id === wrapper.type);
  if (convertedFps) wrapper.inputs.find(input => input.name === 'fps').widget = { name: 'fps' };
  wrapper.widgets_values = convertedFps ? [24, true] : [true];
  wrapper.widgets_values_named = convertedFps ? { fps: 24, tiled_decode: true } : { tiled_decode: true };
  const slot = definition.inputs.length;
  definition.inputs.push({ name: 'tiled_decode', type: 'BOOLEAN', linkIds: [9201] });
  definition.nodes.push({ id: 9200, type: 'BooleanConsumer', widgets_values: [false],
    inputs: [{ name: 'switch', link: 9201 }], outputs: [] });
  definition.links.push({ id: 9201, origin_id: -10, origin_slot: slot, target_id: 9200, target_slot: 0 });
  return graph;
}

test('Decode plain linked fps does not consume tiled-decode position; converted widgets still do', () => {
  const info = { ...objectInfo, BooleanConsumer: { input: { required: { switch: ['BOOLEAN', {}] } }, output: [] } };
  for (const converted of [false, true]) for (const named of [false, true]) {
    const graph = decodeToggleGraph(converted);
    if (!named) delete graph.nodes.find(node => node.id === 134).widgets_values_named;
    const result = compileDirectorWorkflow(graph, info);
    assert.deepEqual(result.issues, []);
    assert.equal(result.prompt['9200'].inputs.switch, true);
  }
});
