/**
 * Export the replacement Scene 01 as sixteen independent native workflows.
 * Dry-run by default. Source files and existing output files are never replaced.
 * Usage: node scripts/export-prodigal-scene1-segments.mjs source.json output-dir [--apply]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_PACK = 'D:/AI/ComfyUI/Instances/LTX2.5/custom_nodes/WhatDreamsCost-ComfyUI';
const sha = data => createHash('sha256').update(data).digest('hex');
const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
async function directorHelpers(pack) {
  const read = name => fs.readFileSync(path.join(pack, 'js', name), 'utf8');
  const stage1 = dataUrl(read('ltx_stage1_queue.js'));
  const range = dataUrl(read('ltx_decode_range.js'));
  const queue = read('ltx_decode_queue.js').replace('"./ltx_stage1_queue.js"', JSON.stringify(stage1))
    .replace(/(["'])\.\/ltx_decode_range\.js\1/g, JSON.stringify(range));
  return import(dataUrl(queue));
}
function setWidget(node, name, value) {
  const index = Object.keys(node.widgets_values_named ?? {}).indexOf(name);
  if (Array.isArray(node.widgets_values)) {
    assert(index >= 0, `Missing named position for ${name}`);
    node.widgets_values[index] = value;
  } else if (node.widgets_values) node.widgets_values[name] = value;
  node.widgets_values_named = { ...node.widgets_values_named, [name]: value };
  if (node.properties && name in node.properties) node.properties[name] = value;
}

export async function createScene1SegmentExports(workflow, pack = DEFAULT_PACK) {
  const { prepareDecodeRange, getSegmentDialogue } = await directorHelpers(pack);
  const source = structuredClone(workflow);
  const directors = source.nodes.filter(node => node.type === 'LTXDirector');
  assert.equal(directors.length, 1, 'Expected one Director node');
  const director = directors[0];
  for (const [name, value] of Object.entries(director.widgets_values_named)) {
    assert.deepEqual(director.properties[name], value, `Director property disagrees: ${name}`);
    assert.deepEqual(director.widgets_values[Object.keys(director.widgets_values_named).indexOf(name)], value, `Director widget disagrees: ${name}`);
  }
  const timeline = JSON.parse(director.properties.timeline_data);
  const fps = director.properties.frame_rate;
  assert.equal(fps, 24);
  assert.equal(timeline.segments.length, 16);
  assert.equal(timeline.normalStartFrame, 0);
  assert.equal(timeline.normalDurationFrames, 5040);
  assert.deepEqual(timeline.generationOptions, { version: 1, distilled: false, tiledDecode: true, unloadVae: false });
  prepareDecodeRange(timeline, 0, 5040);
  const speeches = timeline.segments.flatMap((segment, index) => getSegmentDialogue(segment) ? [index + 1] : []);
  assert.deepEqual(speeches, [10, 11, 16], 'Expected exactly the Pharisee, Scribe and Jesus passages');
  const files = new Map(), map = [];
  for (const [index, segment] of timeline.segments.entries()) {
    const graph = structuredClone(source);
    const node = graph.nodes.find(node => node.id === director.id);
    const { timeline: scoped } = prepareDecodeRange(timeline, segment.start, segment.length);
    assert.equal(scoped.segments.length, 1);
    assert.deepEqual(scoped.generationOptions, timeline.generationOptions);
    assert.deepEqual(scoped.icInputs, timeline.icInputs);
    assert.equal(scoped.motionSegments.length, 2);
    assert(scoped.motionSegments.every(reference => reference.start === 0 && reference.length === segment.length));
    assert.equal(scoped.segments[0].prompt, segment.prompt);
    assert.equal(scoped.segments[0].imageFile, segment.imageFile);
    assert.equal(scoped.segments[0].voiceReferenceFile, segment.voiceReferenceFile);
    const strengths = String(director.properties.guide_strength ?? '').split(',');
    const values = {
      start_second: 0, end_second: segment.length / fps, duration_seconds: segment.length / fps,
      start_frame: 0, end_frame: segment.length, duration_frames: segment.length,
      timeline_data: JSON.stringify(scoped), local_prompts: segment.prompt,
      segment_lengths: String(segment.length), guide_strength: strengths[index] || '1.00',
    };
    for (const [name, value] of Object.entries(values)) setWidget(node, name, value);
    node.properties = { ...node.properties, ...values };
    const number = String(index + 1).padStart(2, '0');
    const speaker = segment.voiceReferenceEnabled ? segment.speaker : 'AMBIENCE';
    assert(/^[A-Z_]+$/.test(speaker), 'Unsafe speaker filename');
    const name = `Segment_${number}_${speaker}.json`;
    node.title = `Scene 01 / Segment ${number} / ${segment.length / fps} seconds`;
    for (const item of [graph, ...(graph.definitions?.subgraphs ?? [])].flatMap(container => container.nodes)) {
      if (['VHS_VideoCombine', 'SaveVideo'].includes(item.type)) {
        setWidget(item, 'filename_prefix', `Prodigal_Son/Scene_01_Temple_and_the_Gathering/segment_${number}`);
      }
    }
    files.set(name, JSON.stringify(graph, null, 2) + '\n');
    map.push({ segment: index + 1, speaker, duration_seconds: segment.length / fps, duration_frames: segment.length,
      source_start_frame: segment.start, image: segment.imageFile, voice_reference: segment.voiceReferenceFile,
      has_script: Boolean(getSegmentDialogue(segment)), workflow: name });
  }
  assert.deepEqual(workflow, source, 'Source graph was mutated');
  files.set('voice-reference-map.json', JSON.stringify(map, null, 2) + '\n');
  files.set('README.txt', 'Scene 01 replacement: 16 independent segment workflows, 210 seconds (3:30) total at 24 fps.\n'
    + 'These retain the replacement workflow\'s Dev 30/8 settings, tiled decode, resolution, both IC references, starting frames and Cueboard prompts.\n'
    + 'Voice references remain on Director segments 10 (PHARISEE), 11 (SCRIBE), and 16 (JESUS); the other segments have voice reference off.\n'
    + 'Each independent workflow starts at frame zero and includes only its own segment. No render or TTS was queued.\n');
  return { files, report: { segments: 16, frames: 5040, seconds: 210, speakingSegments: speeches,
    perSegmentReferenceLanes: 2, generationOptions: timeline.generationOptions, generationRun: false } };
}

async function main() {
  const args = process.argv.slice(2), positional = args.filter(value => value !== '--apply');
  assert.equal(positional.length, 2, 'Usage: source.json output-dir [--apply]');
  const [input, output] = positional.map(value => path.resolve(value));
  const bytes = fs.readFileSync(input), sourceHash = sha(bytes);
  const { files, report } = await createScene1SegmentExports(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
  if (fs.existsSync(output)) {
    for (const filename of fs.readdirSync(output)) {
      assert(files.has(filename), `Archive the obsolete output folder before exporting: ${filename}`);
      assert.equal(fs.readFileSync(path.join(output, filename), 'utf8'), files.get(filename), `Existing output differs: ${filename}`);
    }
  }
  if (args.includes('--apply')) {
    fs.mkdirSync(output, { recursive: true });
    for (const [filename, value] of files) {
      const target = path.join(output, filename);
      if (!fs.existsSync(target)) fs.writeFileSync(target, value, { flag: 'wx' });
    }
  }
  assert.equal(sha(fs.readFileSync(input)), sourceHash);
  console.log(JSON.stringify({ ...report, source: input, sourceSha256: sourceHash, output, files: files.size, published: args.includes('--apply') }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
