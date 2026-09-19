/**
 * Import the user-authored sixteen-part Scene 18 into the existing Picture.
 * Dry-run is the default. Run with --apply only after reviewing the report.
 * node --experimental-strip-types scripts/update-scene18-picture-cueboard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createProjectLibrary } from '../desktop/project-library.mjs';
import { saveDirectorPlan, directorPlanImages, buildDirectorPlanEditor, extractDirectorPlanFromEditor } from '../src/lib/studio/director-scene-authoring.ts';
import { sceneTemplate, makePerformanceDraft, applyPerformanceDrafts, emptyEmotionWorkspace } from '../src/lib/emotion/integration.ts';
import { parseScreenplayHierarchy } from '../src/lib/studio/screenplay-hierarchy.ts';
import { buildDependencyGraph } from '../src/lib/performance/domain.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PICTURE_ID = 'pic_prodigal_son_20260909';
const SCENE_ID = 'PS-S18';
const SLUG = 'the_prodigal_son';
const DEFAULT_ARTIFACT = path.join(ROOT, 'projects', SLUG, 'workflows/Cueboard/Scene_18_16_segments/Scene_18_The_father_runs_Segments_Cueboard.json');
const INPUT_ROOT = 'D:/AI/ComfyUI/Data/LTX2.5/Input';
const OLD_CONFESSION = 'Father, I have sinned against heaven and against you. I am no longer worthy to be called your son.';
const NEW_CONFESSION = 'Father, I have sinned against heaven and before you, and am no longer worthy to be called your son.';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const same = (a, b) => assert.deepEqual(a, b);
const clone = value => structuredClone(value);
function fingerprint(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { sha256: hash(fs.readFileSync(file)), bytes: stat.size, mtimeMs: stat.mtimeMs };
}
function checkUnchanged(snapshots) {
  for (const [file, before] of snapshots) assert.deepEqual(fingerprint(file), before, `Changed externally while preparing update: ${file}`);
}
function localWithin(base, relative) {
  const resolved = path.resolve(base, relative);
  const rel = path.relative(path.resolve(base), resolved);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `Unsafe relative path: ${relative}`);
  return resolved;
}
function nodeValue(node, name, fallback) {
  const index = Object.keys(node.widgets_values_named ?? {}).indexOf(name);
  return index >= 0 && Array.isArray(node.widgets_values) ? node.widgets_values[index] : node.widgets_values_named?.[name] ?? node.properties?.[name] ?? fallback;
}
function sceneSource(text, hierarchy) {
  const parsed = parseScreenplayHierarchy(text, hierarchy);
  const nodes = parsed.nodes.filter(node => node.kind === 'scene' && node.id === SCENE_ID);
  assert.equal(nodes.length, 1, 'Screenplay source must contain exactly one Scene 18');
  return nodes[0];
}
function syncConfession(text, hierarchy) {
  const scene = sceneSource(text, hierarchy);
  const body = text.slice(scene.sourceStart, scene.sourceEnd);
  if (body.includes(NEW_CONFESSION)) return { text, changed: false };
  assert.equal(body.split(OLD_CONFESSION).length - 1, 1, 'Unexpected Scene 18 confession; inspect before replacing');
  return { text: text.slice(0, scene.sourceStart) + body.replace(OLD_CONFESSION, NEW_CONFESSION) + text.slice(scene.sourceEnd), changed: true };
}
function syncScreenplay(picture, revision, now, report) {
  const original = clone(picture.screenplay);
  const approved = original.versions.find(version => version.id === original.approvedVersionId);
  assert(approved, 'An approved screenplay source is required');
  const synced = syncConfession(approved.fountain, approved.hierarchy);
  const next = clone(picture);
  if (synced.changed) {
    const id = `${PICTURE_ID}:${SCENE_ID}:user-workflow:${revision.slice(0, 16)}`;
    const version = { ...clone(approved), id, label: 'Scene 18 · user-supplied workflow dialogue', kind: 'manual', logicalRole: 'manual', model: null,
      fountain: synced.text, sourceVersionId: approved.id, createdAt: now, pass: null, settings: null,
      hierarchy: parseScreenplayHierarchy(synced.text, approved.hierarchy) };
    next.screenplay.versions.push(version);
    next.screenplay.approvedVersionId = id;
    next.screenplay.updatedAt = now;
    if (next.performance?.approvedScreenplay) next.performance.approvedScreenplay = { ...next.performance.approvedScreenplay, screenplayVersionId: id };
    report.dialogueSynchronization = { changed: true, from: OLD_CONFESSION, to: NEW_CONFESSION, oldSourceVersionId: approved.id, sourceVersionId: id,
      provenance: 'Manual import of the user-supplied scene; no AI approval or screenplay generation.' };
  } else report.dialogueSynchronization = { changed: false, sourceVersionId: approved.id };
  const working = syncConfession(original.workingFountain, original.hierarchy);
  if (working.changed) {
    const id = `${PICTURE_ID}:${SCENE_ID}:working-workflow:${revision.slice(0, 16)}`;
    const current = original.versions.find(version => version.id === original.currentVersionId) ?? approved;
    const hierarchy = parseScreenplayHierarchy(working.text, original.hierarchy);
    next.screenplay.versions.push({ ...clone(current), id, label: 'Scene 18 · user-supplied workflow dialogue', kind: 'manual', logicalRole: 'manual', model: null,
      fountain: working.text, sourceVersionId: current.id, createdAt: now, pass: null, settings: null, hierarchy });
    next.screenplay.workingFountain = working.text;
    next.screenplay.hierarchy = hierarchy;
    next.screenplay.currentVersionId = id;
    next.screenplay.updatedAt = now;
  }
  next.screenplayFountain = syncConfession(next.screenplayFountain).text;
  // Historical versions remain byte-for-byte content-equivalent.
  same(next.screenplay.versions.slice(0, original.versions.length), original.versions);
  return next;
}
function resolveFrame(segment, manifest, projectDir, stagedFiles) {
  const file = String(segment.imageFile ?? '');
  assert(file, `Segment ${segment.id} has no attached first-frame file`);
  const source = localWithin(INPUT_ROOT, file);
  assert(fs.existsSync(source), `Attached image is unavailable: ${source}`);
  const bytes = fs.readFileSync(source), digest = hash(bytes);
  const registered = manifest.entries.find(entry => entry.sha256 === digest && fs.existsSync(path.join(projectDir, entry.file)));
  if (registered) {
    assert.equal(hash(fs.readFileSync(path.join(projectDir, registered.file))), digest, `Registered frame changed: ${registered.file}`);
    return { mediaUri: registered.uri, sha256: digest, bytes: bytes.length, source, registeredFile: path.join(projectDir, registered.file) };
  }
  const safe = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_');
  const mediaUri = `/pictures/prodigal-son/director/starting-images/PS-S18/16-segments/${digest.slice(0, 12)}-${safe}`;
  stagedFiles.push({ file: localWithin(path.join(ROOT, 'public'), mediaUri.slice(1)), bytes, digest });
  return { mediaUri, sha256: digest, bytes: bytes.length, source };
}
function checkUntouchedScenes(before, after) {
  same(after.scenes.filter(scene => scene.id !== SCENE_ID), before.scenes.filter(scene => scene.id !== SCENE_ID));
  same(after.shots.filter(shot => shot.sceneId !== SCENE_ID), before.shots.filter(shot => shot.sceneId !== SCENE_ID));
  for (const key of ['shots', 'beats', 'scenes']) same(after.performance[key].filter(item => (key === 'scenes' ? item.id : item.sceneId) !== SCENE_ID), before.performance[key].filter(item => (key === 'scenes' ? item.id : item.sceneId) !== SCENE_ID));
  same(after.production, before.production);
  same(after.characters, before.characters);
  same(after.characterVoiceDesigns, before.characterVoiceDesigns);
  for (const [id, plan] of Object.entries(before.directorScenes ?? {})) if (id !== SCENE_ID) same(after.directorScenes[id], plan);
}

export function prepareScene18Update({ root = ROOT, sourceFile = DEFAULT_ARTIFACT, now = Date.now() } = {}) {
  assert.equal(path.resolve(root), ROOT, 'This bounded importer targets its own project root');
  const projectDir = path.join(ROOT, 'projects', SLUG);
  const stateFile = path.join(ROOT, 'projects/.studio-state.json');
  const manifestFile = path.join(projectDir, 'asset-library.json');
  const sourceBytes = fs.readFileSync(sourceFile), revision = hash(sourceBytes);
  const configFile = path.join(path.dirname(sourceFile), 'cueboard-config.json');
  const compiledFile = path.join(path.dirname(sourceFile), 'cueboard-compiled.json');
  const snapshots = new Map([stateFile, manifestFile, path.join(projectDir, 'picture.json'), sourceFile, configFile, compiledFile].map(file => [file, fingerprint(file)]));
  const state = readJson(stateFile), before = state.state.pictures.find(picture => picture.id === PICTURE_ID);
  assert(before, 'The existing Prodigal Son Picture was not found');
  assert(before.performance, 'The existing canonical performance workspace is required');
  const workflow = JSON.parse(sourceBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const directors = workflow.nodes.filter(node => node.type === 'LTXDirector');
  assert.equal(directors.length, 1);
  const director = directors[0];
  const timeline = JSON.parse(nodeValue(director, 'timeline_data'));
  same(JSON.parse(director.properties.timeline_data), timeline);
  same(JSON.parse(director.widgets_values_named.timeline_data), timeline);
  assert.equal(timeline.segments.length, 16);
  const fps = Number(nodeValue(director, 'frame_rate'));
  assert.equal(fps, 24);
  let cursor = 0;
  for (const segment of timeline.segments) {
    assert.equal(segment.start, cursor, 'Timeline must use contiguous whole-frame boundaries');
    assert(Number.isInteger(segment.length) && segment.length > 0, 'Segment durations must be positive whole frames');
    assert(segment.prompt?.trim(), 'Every segment needs its repaired prompt');
    cursor += segment.length;
  }
  assert.equal(cursor, timeline.normalDurationFrames);
  assert.equal(cursor, Number(nodeValue(director, 'duration_frames')));
  assert.equal(cursor, 3131, 'Expected reviewed full Scene 18 range including its last frame');
  const config = readJson(configFile), compiled = readJson(compiledFile);
  assert.equal(config.lines.length, 32);
  assert.equal(compiled.length, 32);
  const speaking = config.lines.filter(line => line.spoken_text.trim());
  assert.equal(speaking.length, 2);
  assert(speaking.some(line => line.spoken_text === NEW_CONFESSION), 'Cueboard must retain the supplied confession');
  const report = { mode: 'dry-run', pictureId: PICTURE_ID, sceneId: SCENE_ID, sourceFile, sourceSha256: revision, totalFrames: cursor, frameRate: fps, durationSeconds: cursor / fps, frameBindings: [], checks: [] };
  const stagedFiles = [];
  const manifest = readJson(manifestFile);
  const frames = timeline.segments.map(segment => resolveFrame(segment, manifest, projectDir, stagedFiles));
  for (const frame of frames) {
    snapshots.set(frame.source, fingerprint(frame.source));
    if (frame.registeredFile) snapshots.set(frame.registeredFile, fingerprint(frame.registeredFile));
  }
  const templateUri = `/pictures/prodigal-son/director/workflows/Scene_18_The_father_runs_Segments_Cueboard-${revision.slice(0, 12)}.json`;
  stagedFiles.push({ file: localWithin(path.join(ROOT, 'public'), templateUri.slice(1)), bytes: sourceBytes, digest: revision });
  const stage = name => workflow.nodes.find(node => workflow.definitions?.subgraphs?.some(definition => definition.id === node.type && definition.name === name));
  const plan = { schemaVersion: 1, sceneId: SCENE_ID, template: { mediaUri: templateUri, sha256: revision, bytes: sourceBytes.length },
    globalPrompt: timeline.global_prompt ?? '', frameRate: fps, width: Number(nodeValue(director, 'custom_width', 0)), height: Number(nodeValue(director, 'custom_height', 0)),
    baseSteps: Number(nodeValue(stage('Stage #1') ?? {}, 'steps', 30)), refineSteps: Number(nodeValue(stage('Stage #2') ?? {}, 'steps', 8)),
    outputPrefix: `Premiere316/${SCENE_ID}`, segments: timeline.segments.map((segment, index) => {
      const baseId = `${SCENE_ID}-SH${String(Math.floor(index / 2) + 1).padStart(3, '0')}`;
      assert(segment.imageFile.includes(`${baseId}_${index % 2 ? 'LAST' : 'FIRST'}`), 'Segment order does not match its attached frame');
      const shotId = baseId + (index % 2 ? 'B' : '');
      const { mediaUri, sha256 } = frames[index];
      report.frameBindings.push({ segment: index + 1, segmentId: String(segment.id), shotId, mediaUri, sha256 });
      return { segmentId: String(segment.id), shotId, type: 'image', durationFrames: segment.length, prompt: segment.prompt, imageBinding: { mediaUri, sha256 } };
    }) };
  let next = syncScreenplay(before, revision, now, report);
  const previousShots = new Map(before.shots.map(shot => [shot.id, shot]));
  const sceneShots = plan.segments.map((segment, index) => {
    const parentId = segment.shotId.replace(/B$/, '');
    const parent = previousShots.get(parentId);
    assert(parent?.sceneId === SCENE_ID, `Parent shot missing: ${parentId}`);
    const previous = previousShots.get(segment.shotId);
    const shot = { ...clone(previous ?? parent), id: segment.shotId, index: parent.index + (index % 2 ? 0.5 : 0),
      durationSec: segment.durationFrames / fps, i2vPrompt: segment.prompt, stillUrl: segment.imageBinding.mediaUri,
      description: index % 2 ? `${parent.description} · continuation` : parent.description };
    if (!previous) delete shot.videoUrl;
    return shot;
  });
  next.shots = [...next.shots.filter(shot => shot.sceneId !== SCENE_ID), ...sceneShots].sort((a, b) => a.index - b.index);
  next = saveDirectorPlan(next, plan);
  next.updatedAt = now;
  next.directorSceneRevisions = { ...next.directorSceneRevisions, [SCENE_ID]: revision };
  if (next.directorWorkflowDrafts?.[SCENE_ID]) { report.replacedSceneWorkflowDraft = true; delete next.directorWorkflowDrafts[SCENE_ID]; }
  const previousCanonical = new Map(before.performance.shots.map(shot => [shot.shotId, shot]));
  const canonical = sceneShots.map((shot, index) => {
    const old = previousCanonical.get(shot.id), parent = previousCanonical.get(shot.id.replace(/B$/, ''));
    assert(parent, `Canonical parent shot missing: ${shot.id}`);
    const beatId = old?.beatId ?? `${shot.id}:user-workflow:beat`;
    return { ...clone(old ?? parent), shotId: shot.id, canonicalShotId: shot.id, version: (old?.version ?? 0) + 1,
      beatId, sequenceOrder: shot.index, durationSec: shot.durationSec, status: 'DRAFT', compilerState: 'PLANNED',
      references: { ...clone(parent.references), firstFrame: [shot.stillUrl], lastFrame: [] },
      audio: { ...clone(parent.audio), dialogue: [] }, legacy: { ...clone(shot) },
      dependencyState: [...new Set([...(parent.dependencyState ?? []), next.screenplay.approvedVersionId, revision])],
      lastUpdatedBy: 'user-supplied-scene18-workflow', createdAt: old?.createdAt ?? now, updatedAt: now };
  });
  const beats = canonical.map(shot => {
    const old = before.performance.beats.find(beat => beat.id === shot.beatId);
    const parent = before.performance.beats.find(beat => beat.id === previousCanonical.get(shot.shotId.replace(/B$/, '')).beatId);
    assert(parent, `Canonical parent beat missing: ${shot.shotId}`);
    return { ...clone(old ?? parent), id: shot.beatId, sequence: shot.sequenceOrder, title: shot.legacy.description,
      summary: shot.legacy.i2vPrompt, durationSec: shot.durationSec, createdAt: old?.createdAt ?? now };
  });
  next.performance.shots = [...next.performance.shots.filter(shot => shot.sceneId !== SCENE_ID), ...canonical].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  next.performance.beats = [...next.performance.beats.filter(beat => beat.sceneId !== SCENE_ID), ...beats].sort((a, b) => a.sequence - b.sequence);
  next.performance.scenes = next.performance.scenes.map(scene => scene.id === SCENE_ID ? { ...scene, durationSec: cursor / fps } : scene);
  for (const shot of canonical) {
    next.performance.shotVersions[shot.shotId] = { shotId: shot.shotId, version: shot.version, schemaVersion: 1, createdAt: now, dependencies: shot.dependencyState };
    const previous = next.performance.queue[shot.shotId];
    next.performance.queue[shot.shotId] = { ...previous, queueId: previous?.queueId ?? `${shot.shotId}:user-workflow:queue`, shotId: shot.shotId,
      canonicalShotVersion: shot.version, approvedReferences: [], intendedEngine: shot.intendedEngine, dependencyState: shot.dependencyState,
      readiness: 'PLANNED', compileState: 'PLANNED', createdAt: previous?.createdAt ?? now, updatedAt: now };
  }
  const localGraph = buildDependencyGraph({ ...next.performance, scenes: next.performance.scenes.filter(scene => scene.id === SCENE_ID), beats, shots: canonical });
  const existingNodes = new Set(next.performance.dependencyGraph.nodes.map(node => JSON.stringify(node)));
  const existingEdges = new Set(next.performance.dependencyGraph.edges.map(edge => JSON.stringify(edge)));
  next.performance.dependencyGraph.nodes.push(...localGraph.nodes.filter(node => !existingNodes.has(JSON.stringify(node))));
  next.performance.dependencyGraph.edges.push(...localGraph.edges.filter(edge => !existingEdges.has(JSON.stringify(edge))));
  next.performance.updatedAt = now;
  // Preserve gate history. Explicit plan bindings select these supplied images without inventing approvals.
  const proposal = sceneTemplate(next, SCENE_ID, readJson(path.join(ROOT, 'public/data/emotion_catalog.json')));
  for (const line of proposal.lines) {
    const label = proposal.character_baselines[line.character_id].label;
    const matches = config.lines.filter(candidate => config.character_baselines[candidate.character_id].label.toUpperCase() === label.toUpperCase() && candidate.spoken_text === line.spoken_text);
    assert.equal(matches.length, 1, `Cueboard screenplay dialogue mismatch for ${label}: ${line.spoken_text}`);
    line.overrides = clone(matches[0].overrides);
    // The app locks two screenplay dialogue lines; its native draft has no IDs
    // for the thirty silent timeline performances retained in segment prompts.
    if (line.overrides.continuity) line.overrides.continuity.from_line_id = null;
    line.beats = clone(matches[0].beats);
  }
  const catalog = readJson(path.join(ROOT, 'public/data/emotion_catalog.json'));
  const draft = makePerformanceDraft(next, catalog, proposal, 'cueboard-local-compiler:user-supplied-scene18-workflow', now);
  draft.id = `scene18-user-workflow-${revision.slice(0, 24)}`;
  next.emotionPerformance ??= emptyEmotionWorkspace();
  next.emotionPerformance.drafts = [...next.emotionPerformance.drafts.filter(item => item.id !== draft.id), draft];
  next.emotionPerformance = applyPerformanceDrafts(next, [draft.id], now);
  const images = directorPlanImages(next, plan);
  assert.equal(images.issues.length, 0, images.issues.join('\n'));
  const editor = buildDirectorPlanEditor(workflow, plan, { guides: images.guides });
  const rebuilt = extractDirectorPlanFromEditor(plan, editor);
  same(rebuilt.segments, plan.segments);
  const editorDirector = JSON.parse(editor).nodes.find(node => node.type === 'LTXDirector');
  const editorTimeline = JSON.parse(editorDirector.properties.timeline_data);
  same(editorTimeline.motionSegments, timeline.motionSegments);
  same(editorTimeline.icInputs, timeline.icInputs);
  same(editorTimeline.generationOptions, timeline.generationOptions);
  same(editorDirector.properties.director_generation_bindings, director.properties.director_generation_bindings);
  // Image rebinding and plan-owned timing changes must not change graph routing,
  // sampler controls, resolution selectors, model selections or authored seeds.
  const editorGraph = JSON.parse(editor);
  same(editorGraph.links, workflow.links);
  same(editorGraph.definitions, workflow.definitions);
  for (const originalNode of workflow.nodes.filter(node => node.type !== 'LTXDirector' && !['VHS_VideoCombine', 'SaveVideo'].includes(node.type))) {
    const restoredNode = editorGraph.nodes.find(node => node.id === originalNode.id);
    same(restoredNode.widgets_values, originalNode.widgets_values);
  }
  for (let index = 0; index < 16; index++) {
    for (const key of Object.keys(timeline.segments[index]).filter(key => /voice/i.test(key))) same(editorTimeline.segments[index][key], timeline.segments[index][key]);
  }
  checkUntouchedScenes(before, next);
  const updatedState = clone(state);
  updatedState.state.pictures = updatedState.state.pictures.map(picture => picture.id === PICTURE_ID ? next : picture);
  same(updatedState.state.pictures.filter(picture => picture.id !== PICTURE_ID), state.state.pictures.filter(picture => picture.id !== PICTURE_ID));
  report.checks = ['16 native segments with unique shot IDs', '16 frame files verified by SHA256', '4 reference lines and generation controls preserved', 'All segment voice metadata preserved', 'Other scenes, assets, voices and Pictures unchanged', 'Native Cueboard locks the updated two exact dialogue lines', 'Historical screenplay versions retained'];
  report.nativeCueboard = { draftId: draft.id, source: draft.source, lines: draft.compiled.length, dialogue: draft.config.lines.map(line => ({ speaker: draft.config.character_baselines[line.character_id].label, text: line.spoken_text })) };
  report.template = plan.template;
  report.newPictureShots = sceneShots.filter(shot => !previousShots.has(shot.id)).map(shot => shot.id);
  report.stagedFiles = stagedFiles.map(item => ({ file: item.file, bytes: item.bytes.length, sha256: item.digest }));
  checkUnchanged(snapshots);
  return { state: updatedState, beforeState: state, report, stagedFiles, snapshots, stateFile, projectDir, sourceFile };
}

export function applyPreparedUpdate(prepared) {
  checkUnchanged(prepared.snapshots);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(prepared.projectDir, 'backups', `scene18-picture-cueboard-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const copies = [];
  for (const [file, snapshot] of prepared.snapshots) {
    if (!snapshot || ![prepared.stateFile, path.join(prepared.projectDir, 'picture.json'), path.join(prepared.projectDir, 'asset-library.json')].includes(file)) continue;
    const destination = path.join(backupDir, path.basename(file));
    fs.copyFileSync(file, destination);
    assert.equal(hash(fs.readFileSync(destination)), snapshot.sha256);
    copies.push({ source: file, backup: destination, sha256: snapshot.sha256 });
  }
  for (const item of prepared.stagedFiles) {
    if (fs.existsSync(item.file)) assert.equal(hash(fs.readFileSync(item.file)), item.digest, `Content-addressed file collision: ${item.file}`);
    else { fs.mkdirSync(path.dirname(item.file), { recursive: true }); fs.writeFileSync(item.file, item.bytes, { flag: 'wx' }); }
    assert.equal(hash(fs.readFileSync(item.file)), item.digest);
  }
  checkUnchanged(prepared.snapshots);
  const service = createProjectLibrary({ root: ROOT });
  const saved = JSON.parse(service.writeState(JSON.stringify(prepared.state), prepared.beforeState.state.pictures.map(picture => picture.id)));
  const actual = saved.state.pictures.find(picture => picture.id === PICTURE_ID);
  const expected = prepared.state.state.pictures.find(picture => picture.id === PICTURE_ID);
  assert.equal(actual.directorScenes[SCENE_ID].template.sha256, prepared.report.sourceSha256);
  assert.equal(actual.directorScenes[SCENE_ID].segments.length, 16);
  for (const segment of actual.directorScenes[SCENE_ID].segments) {
    const url = new URL(segment.imageBinding.mediaUri, 'http://localhost');
    const file = segment.imageBinding.mediaUri.startsWith('/api/project-media?')
      ? service.mediaFile(url.searchParams.get('project'), url.searchParams.get('file'))
      : localWithin(path.join(ROOT, 'public'), segment.imageBinding.mediaUri.slice(1));
    assert.equal(hash(fs.readFileSync(file)), segment.imageBinding.sha256);
  }
  same(actual.shots.map(shot => [shot.id, shot.i2vPrompt, shot.durationSec]), expected.shots.map(shot => [shot.id, shot.i2vPrompt, shot.durationSec]));
  assert.equal(actual.emotionPerformance.applied[SCENE_ID], prepared.report.nativeCueboard.draftId);
  const report = { ...prepared.report, mode: 'applied', backupDir, backups: copies, appliedAt: Date.now() };
  fs.writeFileSync(path.join(backupDir, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    for (const arg of args) assert(arg === '--apply' || arg === '--dry-run' || arg.startsWith('--source='), `Unknown option: ${arg}`);
    const source = args.find(arg => arg.startsWith('--source='))?.slice('--source='.length);
    const prepared = prepareScene18Update(source ? { sourceFile: path.resolve(source) } : {});
    console.log(JSON.stringify(args.includes('--apply') ? applyPreparedUpdate(prepared) : prepared.report, null, 2));
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}
