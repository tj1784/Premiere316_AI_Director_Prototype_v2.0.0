/** Scoped active-picture replacement. Dry-run by default; preserves screenplay approval. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProjectLibrary } from '../desktop/project-library.mjs';
import { applyExplicitProdigalSceneReplacement } from '../src/lib/studio/prodigal-scene-replacement.ts';
import { directorPlanImages, buildDirectorPlanEditor } from '../src/lib/studio/director-scene-authoring.ts';
import { parseScreenplayHierarchy } from '../src/lib/studio/screenplay-hierarchy.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = path.join(root, 'projects/the_prodigal_son');
const stage = path.join(project, 'imports/scene1-3m30-20260918');
const stateFile = path.join(root, 'projects/.studio-state.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = data => createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
for (const arg of args) assert(arg === '--apply' || arg.startsWith('--cueboard='), `Unknown argument ${arg}`);
const sourceData = read(path.join(stage, 'validated-replacement.json'));
const scene = structuredClone(sourceData.scene);
const cueboardPath = args.find(arg => arg.startsWith('--cueboard='))?.slice('--cueboard='.length);
const workflowBytes = fs.readFileSync(cueboardPath || sourceData.workflowSource);
const workflow = JSON.parse(workflowBytes);
const director = workflow.nodes.find(node => node.type === 'LTXDirector');
const timeline = JSON.parse(director.properties.timeline_data);
const packageWorkflow = read(sourceData.workflowSource);
const packageDirector = packageWorkflow.nodes.find(node => node.type === 'LTXDirector');
const packageTimeline = JSON.parse(packageDirector.properties.timeline_data);
const withoutPrompts = structuredClone(timeline);
withoutPrompts.segments.forEach((segment, index) => { segment.prompt = packageTimeline.segments[index].prompt; });
assert.deepEqual(withoutPrompts, packageTimeline, 'Cueboard changed non-prompt timeline fields');
assert.equal(timeline.segments.length, 16);
assert.equal(timeline.normalDurationFrames, 5040);
assert.deepEqual(timeline.generationOptions, { version: 1, distilled: false, tiledDecode: true, unloadVae: false });
scene.segments.forEach((segment, index) => { segment.prompt = timeline.segments[index].prompt; });
const workflowDigest = hash(workflowBytes);
scene.workflow = { mediaUri: `/pictures/prodigal-son/director/workflows/Scene_01_Temple_and_the_Gathering_3m30-${workflowDigest.slice(0, 12)}.json`, sha256: workflowDigest, bytes: workflowBytes.length };
const initialBytes = fs.readFileSync(stateFile);
const state = JSON.parse(initialBytes);
const before = state.state.pictures.find(picture => picture.id === 'pic_prodigal_son_20260909');
assert(before, 'Active Prodigal Son picture missing');
const now = Date.now();
const manifest = { ...read(path.join(root, 'public/pictures/prodigal-son/director-manifest.json')),
  packageId: 'prodigal-son-scene01-3m30-20260918', pictureId: before.id, createdAt: now,
  screenplayVersionId: before.screenplay.approvedVersionId, scenes: [scene] };
let next = applyExplicitProdigalSceneReplacement(before, scene, manifest);
const alreadyApplied = next === before;
const normalizeShots = items => items.filter(item => item.sceneId !== 'PS-S01').map(({ index, ...rest }) => rest);
const normalizeCanonical = items => items.filter(item => item.sceneId !== 'PS-S01').map(({ sequenceOrder, ...rest }) => rest);
const normalizeBeats = items => items.filter(item => item.sceneId !== 'PS-S01').map(({ sequence, ...rest }) => rest);
function checkPreserved(actual, original) {
  assert.deepEqual(actual.characters, original.characters);
  assert.deepEqual(actual.characterVoiceDesigns, original.characterVoiceDesigns);
  assert.deepEqual(actual.production, original.production);
  assert.deepEqual(actual.scenes.filter(s => s.id !== 'PS-S01'), original.scenes.filter(s => s.id !== 'PS-S01'));
  assert.deepEqual(normalizeShots(actual.shots), normalizeShots(original.shots));
  assert.deepEqual(normalizeCanonical(actual.performance.shots), normalizeCanonical(original.performance.shots));
  assert.deepEqual(normalizeBeats(actual.performance.beats), normalizeBeats(original.performance.beats));
  assert.equal(actual.screenplay.approvedVersionId, original.screenplay.approvedVersionId);
  for (const [id, plan] of Object.entries(original.directorScenes || {})) if (id !== 'PS-S01') assert.deepEqual(actual.directorScenes[id], plan);
  for (const version of original.screenplay.versions) assert.deepEqual(actual.screenplay.versions.find(v => v.id === version.id), version);
  const suffix = fountain => { const node = parseScreenplayHierarchy(fountain).nodes.find(n => n.id === 'PS-S02' && n.kind === 'scene'); assert(node); return fountain.slice(node.sourceStart); };
  assert.equal(suffix(actual.screenplay.workingFountain), suffix(original.screenplay.workingFountain));
  assert.equal(suffix(actual.screenplayFountain), suffix(original.screenplayFountain));
}
checkPreserved(next, before);
assert.equal(next.shots.filter(s => s.sceneId === 'PS-S01').length, 16);
assert.equal(next.scenes.find(s => s.id === 'PS-S01').durationSec, 210);
const plan = next.directorScenes['PS-S01'];
assert.equal(plan.template.sha256, workflowDigest, 'This archive revision is already imported with a different Cueboard output; do not relabel or overwrite later edits');
assert.deepEqual(plan.segments.map(s => s.prompt), timeline.segments.map(s => s.prompt));
assert.equal(plan.segments.reduce((sum, segment) => sum + segment.durationFrames, 0), 5040);
for (const prompt of before.generateGates?.prompts ?? []) assert.deepEqual(next.generateGates.prompts.find(p => p.id === prompt.id), prompt);
for (const iteration of before.generateGates?.iterations ?? []) {
  const retained = next.generateGates.iterations.find(i => i.id === iteration.id);
  assert(retained, `Earlier image iteration was removed: ${iteration.id}`);
  const restored = { ...retained, canonical: iteration.canonical, status: iteration.status };
  assert.deepEqual(restored, iteration, 'Historical image metadata changed');
}
assert.deepEqual(next.emotionPerformance?.drafts, before.emotionPerformance?.drafts);
assert.deepEqual(next.emotionPerformance?.history.slice(0, before.emotionPerformance?.history.length ?? 0), before.emotionPerformance?.history ?? []);
assert.deepEqual(next.video?.takes.map(t => t.id), before.video?.takes.map(t => t.id));
assert.deepEqual(next.cinematography?.shotPlans.map(p => p.id), before.cinematography?.shotPlans.map(p => p.id));
const images = directorPlanImages(next, plan);
assert.deepEqual(images.issues, []);
const editor = JSON.parse(buildDirectorPlanEditor(workflow, plan, { guides: images.guides }));
const rebuilt = JSON.parse(editor.nodes.find(n => n.type === 'LTXDirector').properties.timeline_data);
assert.deepEqual(rebuilt.generationOptions, timeline.generationOptions);
assert.deepEqual(rebuilt.motionSegments, timeline.motionSegments);
for (let index = 0; index < 16; index++) for (const [key, value] of Object.entries(timeline.segments[index]).filter(([key]) => /voice/i.test(key))) assert.deepEqual(rebuilt.segments[index][key], value);
assert.deepEqual(editor.links, workflow.links);
assert.deepEqual(editor.definitions, workflow.definitions);
for (const node of workflow.nodes.filter(node => node.type !== 'LTXDirector' && node.type !== 'VHS_VideoCombine')) assert.deepEqual(editor.nodes.find(n => n.id === node.id).widgets_values, node.widgets_values);
const newIterations = next.generateGates.iterations.filter(iteration => plan.segments.some(segment => segment.imageBinding?.iterationId === iteration.id));
assert.equal(newIterations.length, 16);
assert(newIterations.every(iteration => iteration.status === 'NEEDS_REVIEW' && iteration.canonical === false));
assert.equal(next.emotionPerformance?.applied?.['PS-S01'], undefined);
const report = { mode: args.includes('--apply') ? 'apply' : 'dry-run', alreadyApplied,
  pictureId: before.id, sceneId: 'PS-S01', durationSeconds: 210, frames: 5040, segments: 16,
  archiveSha256: sourceData.archiveSha256, workflowSha256: workflowDigest,
  screenplayVersionId: next.screenplay.currentVersionId, screenplayStatus: next.screenplay.status,
  approvedVersionPreserved: next.screenplay.approvedVersionId, allOtherScenesPreserved: true,
  voicesAndCharactersPreserved: true, newImageApprovals: 0, timelineGenerationOptions: timeline.generationOptions,
  liveAiReviewRun: false, mediaGenerated: false, template: plan.template };
if (args.includes('--apply') && !alreadyApplied) {
  const backup = path.join(project, 'backups', `scene1-3m30-apply-${new Date(now).toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const file of [stateFile, path.join(project, 'picture.json'), path.join(project, 'asset-library.json')]) fs.copyFileSync(file, path.join(backup, path.basename(file)));
  const publicWorkflow = path.join(root, 'public', scene.workflow.mediaUri.slice(1));
  if (fs.existsSync(publicWorkflow)) assert.equal(hash(fs.readFileSync(publicWorkflow)), workflowDigest);
  else fs.writeFileSync(publicWorkflow, workflowBytes, { flag: 'wx' });
  assert.equal(hash(fs.readFileSync(stateFile)), hash(initialBytes), 'Project changed during import preparation');
  state.state.pictures = state.state.pictures.map(picture => picture.id === next.id ? next : picture);
  const library = createProjectLibrary({ root });
  const saved = JSON.parse(library.writeState(JSON.stringify(state), state.state.pictures.map(picture => picture.id)));
  const actual = saved.state.pictures.find(p => p.id === next.id);
  checkPreserved(actual, before);
  assert.deepEqual(actual.characterVoiceDesigns, before.characterVoiceDesigns);
  assert.deepEqual(saved.state.voiceDesignAssets, state.state.voiceDesignAssets);
  for (const other of state.state.pictures.filter(p => p.id !== next.id)) assert.deepEqual(saved.state.pictures.find(p => p.id === other.id), other);
  assert.equal(actual.directorScenes['PS-S01'].segments.length, 16);
  for (const segment of actual.directorScenes['PS-S01'].segments) {
    const url = new URL(segment.imageBinding.mediaUri, 'http://localhost');
    const file = segment.imageBinding.mediaUri.startsWith('/api/project-media?') ? library.mediaFile(url.searchParams.get('project'), url.searchParams.get('file')) : path.join(root, 'public', segment.imageBinding.mediaUri.slice(1));
    assert.equal(hash(fs.readFileSync(file)), segment.imageBinding.sha256);
  }
  assert.equal(applyExplicitProdigalSceneReplacement(actual, scene, manifest), actual, 'Replacement re-applies on reload');
  const reload = JSON.parse(library.readState(null)).state.pictures.find(p => p.id === next.id);
  assert.deepEqual(reload, actual);
  assert.deepEqual(read(path.join(project, 'picture.json')), actual);
  report.backup = backup;
  report.reloadVerified = true;
  report.registeredImageUris = actual.directorScenes['PS-S01'].segments.map(s => s.imageBinding.mediaUri);
  fs.writeFileSync(path.join(backup, 'verification.json'), JSON.stringify(report, null, 2));
}
fs.writeFileSync(path.join(stage, `${report.mode}-verification.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
