/** Compile Cueboard performance for Scene18's 16 FIRST/LAST timeline segments.
 * Usage: node scripts/run-scene18-segment-cueboard.mjs [input.json] [output-directory]
 * The source workflow is read-only. This does not call a writer or generate media.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compileScene} from '../src/lib/emotion/compiler.ts';
import {assertSceneConfig} from '../src/lib/emotion/validation.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultDirectory = path.join(root, 'projects/the_prodigal_son/workflows/Cueboard/Scene_18_16_segments');
const inputPath = path.resolve(process.argv[2] || path.join(defaultDirectory, 'prompts-repaired.json'));
const outputDirectory = path.resolve(process.argv[3] || defaultDirectory);
const outputPath = path.join(outputDirectory, 'Scene_18_The_father_runs_Segments_Cueboard.json');
assert.notEqual(inputPath.toLowerCase(), outputPath.toLowerCase(), 'Input and output must be separate files');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const sourceBytes = fs.readFileSync(inputPath);
const original = JSON.parse(sourceBytes.toString('utf8').replace(/^\uFEFF/, ''));
const workflow = structuredClone(original);
const directors = workflow.nodes.filter(node => node.type === 'LTXDirector');
assert.equal(directors.length, 1, 'Expected exactly one LTXDirector');
const director = directors[0];
assert.ok(director.properties && director.widgets_values_named, 'Expected saved Director mirrors');
const timeline = JSON.parse(director.widgets_values[6]);
assert.equal(timeline.segments.length, 16, 'This runner requires sixteen existing FIRST/LAST segments');
const frameRate = Number(director.widgets_values_named.frame_rate ?? director.properties.frame_rate);
assert.equal(frameRate, 24, 'Scene18 performance timing requires the authored 24fps timeline');
const catalog = readJson(path.join(root, 'public/data/emotion_catalog.json'));
const priorPath = path.join(root, 'projects/the_prodigal_son/workflows/Cueboard/Scene_18_2026-09-18/cueboard-config.json');
const previousConfig = readJson(priorPath);
assertSceneConfig(previousConfig, catalog.catalog_version);
const previousLines = new Map(previousConfig.lines.map(line => [line.line_id, line]));

const expectedSpeech = {
  '6:FIRST': {character: 'younger', text: 'Father, I have sinned against heaven and before you, and am no longer worthy to be called your son.'},
  '7:FIRST': {character: 'father', text: 'Bring the best robe. A ring for his hand, and sandals.'},
};
const lastObjectives = {
  1: {father: 'Carry the recognition already reached; remain certain of who he sees without repeating the discovery.',
    younger: 'Remain present under the recognition already developing, still expecting rejection rather than inventing relief.'},
  2: {father: 'Continue the one run already in progress and close the remaining distance; do not launch another approach.',
    younger: 'Hold his ground through the final approach despite shame; do not reset the bundle or repeat the first sighting.'},
  3: {father: 'Remain in the embrace already established and attend to the son he is holding; do not meet or seize him again.',
    younger: 'Continue enduring the contact already established without sudden belief that he belongs.'},
  4: {father: 'Keep supporting him at the shared level already reached; do not repeat the descent or demand that he rise.',
    younger: 'Remain supported in the dust without pulling away or repeating the attempt to kneel.'},
  5: {father: 'Receive the embrace already returned and hold without pressure or spoken consolation.',
    younger: 'Keep the embrace he has already returned while shame remains; do not repeat the decision to reach around him.'},
  6: {father: 'Stay with the silence after the completed confession without interruption, correction, or a spoken answer.',
    younger: 'Remain accountable and available after the completed confession; do not repeat it or bargain for forgiveness.'},
  7: {father: 'Carry through the practical instruction already given while keeping his son close; do not repeat the command.',
    younger: 'Try to remove the dirt he has left, then accept his father stopping and keeping his hand; do not repeat the command or restart an earlier action.'},
  8: {father: 'Continue bringing him home at the slow pace already established, bearing his weight to the entrance without a new start.',
    younger: 'Continue accepting support through the final steps without sudden recovery, triumphant relief, or restarting the walk.'},
};
const marker = 'CUEBOARD PERFORMANCE — acting directions only, never spoken.';
const stripCueboard = prompt => String(prompt || '').replace(/\n{1,2}CUEBOARD PERFORMANCE\b[\s\S]*$/u, '').trimEnd();
const basePrompts = timeline.segments.map(segment => stripCueboard(segment.prompt));
const seen = new Set();
const mappedSegments = timeline.segments.map((segment, index) => {
  const match = /SH(\d{3})_(FIRST|LAST)(?:[-_.]|$)/i.exec(segment.imageFile || '');
  assert.ok(match, `Segment ${index + 1} has no recognizable shot/phase filename`);
  const shot = Number(match[1]), phase = match[2].toUpperCase();
  assert.ok(shot >= 1 && shot <= 8, `Unexpected shot ${shot}`);
  const key = `${shot}:${phase}`;
  assert.ok(!seen.has(key), `Duplicate ${key}`);
  seen.add(key);
  assert.equal(shot, Math.floor(index / 2) + 1, 'FIRST/LAST pairs must retain their authored shot order');
  assert.equal(phase, index % 2 ? 'LAST' : 'FIRST', 'Unexpected phase ordering');
  assert.ok(Number.isFinite(segment.length) && segment.length > 0, `Invalid duration for ${key}`);
  assert.ok(basePrompts[index].trim(), `Repair the empty prompt for ${key} before compiling`);
  const dialogueLines = basePrompts[index].match(/^DIALOGUE:[^\r\n]*$/gm) || [];
  assert.equal(dialogueLines.length, 1, `Expected one DIALOGUE line for ${key}`);
  const quotes = [...dialogueLines[0].matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]);
  const speech = expectedSpeech[key];
  assert.deepEqual(quotes, speech ? [speech.text] : [], `Unexpected or changed dialogue in ${key}`);
  if (speech) assert.match(dialogueLines[0], speech.character === 'father' ? /FATHER/ : /YOUNGER SON/);
  return {index, shot, phase, key, dialogue: dialogueLines[0], speech};
});
assert.equal(seen.size, 16);

const config = structuredClone(previousConfig);
config.scene_id = 'scene18_16_segments';
config.lines = [];
config.scene_defaults.allow_narration = false;
config.scene_defaults.allow_extra_dialogue = false;
config.scene_defaults.allow_nonverbal_vocalizations = false;
const previousByCharacter = {father: null, younger: null};
for (const item of mappedSegments) {
  const segment = timeline.segments[item.index];
  for (const character of ['father', 'younger']) {
    const prior = previousLines.get(`shot${item.shot}_${character}`);
    assert.ok(prior, `Missing prior performance for shot${item.shot}_${character}`);
    const speaking = item.speech?.character === character;
    const line = structuredClone(prior);
    line.line_id = `shot${String(item.shot).padStart(2, '0')}_${item.phase.toLowerCase()}_${character}`;
    line.duration_seconds = segment.length / frameRate;
    line.spoken_text = speaking ? item.speech.text : '';
    line.overrides.framing = speaking ? 'close_up' : 'silent_reaction';
    line.overrides.cue_budget = {face: 0, voice: speaking ? 2 : 0, body: 0};
    line.overrides.physical_context = 'Retain all existing segment action, posture, tears, physical exhaustion and contact. Follow the FIRST or LAST portion already authored for this shot. Emotional cues must not restart an action, repeat speech, or alter camera, wardrobe or props.';
    line.overrides.continuity = {from_line_id: previousByCharacter[character], restart_onset: false};
    if (item.phase === 'LAST') line.overrides.objective = lastObjectives[item.shot][character];
    if (item.shot === 7 && item.phase === 'FIRST' && character === 'younger') {
      line.overrides.objective = 'Remain close and listen while his father gives a practical instruction; keep the brushing impulse contained until the command is finished.';
    }
    line.beats = [];
    line.authored_sound_events = [];
    if (speaking && segment.voiceReferenceEnabled && segment.voiceReferenceFile) {
      config.character_baselines[character].voice_reference = segment.voiceReferenceFile;
    }
    config.lines.push(line);
    previousByCharacter[character] = line.line_id;
  }
}
assertSceneConfig(config, catalog.catalog_version);
const compiled = compileScene(catalog, config);
assert.equal(compiled.length, 32);
assert.deepEqual(compiled.filter(line => line.spoken_text).map(line => [line.character_id, line.spoken_text]),
  [['younger', expectedSpeech['6:FIRST'].text], ['father', expectedSpeech['7:FIRST'].text]]);
assert.ok(compiled.every(line => line.sound_events.length === 0), 'Compiler added a sound event');
assert.ok(compiled.filter(line => !line.spoken_text).every(line => !line.delivery_direction), 'Silent phase received vocal direction');
const compiledById = new Map(compiled.map(line => [line.line_id, line]));

function appendPerformance(prompt, item) {
  const lines = ['father', 'younger'].map(character => {
    const id = `shot${String(item.shot).padStart(2, '0')}_${item.phase.toLowerCase()}_${character}`;
    const output = compiledById.get(id);
    const settings = output.performance_json.resolved_settings;
    const selection = settings.felt_layers.find(layer => layer.role === 'dominant').selection;
    const emotion = catalog.emotions.find(entry => entry.id === selection.emotion_id);
    // The workflow already supplies its camera direction. Remove only the
    // compiler's generic close-up lead, retaining the compiled acting intent.
    const acting = output.video_direction.replace(/^Hold a close-up\. Keep lower-body action out of the instruction; no forced walking or full-body reframing\. /, '');
    return `${config.character_baselines[character].label}: internal ${emotion.label.toLowerCase()}, intensity ${selection.intensity}/7; outwardly ${settings.regulation}.\n${acting}` +
      (output.spoken_text ? `\nVocal delivery (retain the attached character voice reference): ${output.delivery_direction}` :
        '\nNo spoken words from this character in this segment.');
  }).join('\n\n');
  return stripCueboard(prompt) + '\n\n' + marker +
    '\nPreserve the ACTION, NONVERBAL, CAMERA, SCORE, DIALOGUE, CONTINUITY and SOUND above. Retain the already authored weeping and breaths; add no new vocal events. Continue this timeline portion without restarting the shot.\n' + lines;
}
for (const item of mappedSegments) {
  const segment = timeline.segments[item.index];
  segment.prompt = appendPerformance(segment.prompt, item);
  assert.equal(appendPerformance(segment.prompt, item), segment.prompt, 'Cueboard application is not idempotent');
  assert.equal(segment.prompt.split(marker).length - 1, 1, 'Duplicate Cueboard block');
  assert.equal(stripCueboard(segment.prompt), basePrompts[item.index], 'Base scene prompt changed');
  assert.deepEqual(segment.prompt.match(/^DIALOGUE:[^\r\n]*$/gm), [item.dialogue], 'Dialogue changed');
}
const serializedTimeline = JSON.stringify(timeline);
const localPrompts = timeline.segments.map(segment => segment.prompt).join(' | ');
director.widgets_values[6] = serializedTimeline;
director.widgets_values[7] = localPrompts;
director.properties.timeline_data = serializedTimeline;
director.properties.local_prompts = localPrompts;
director.widgets_values_named.timeline_data = serializedTimeline;
director.widgets_values_named.local_prompts = localPrompts;

// Exact preservation, including fractional timing, asset paths, voice controls,
// model wiring, references, selection state, UI bindings, and generation toggles.
const originalDirector = original.nodes.find(node => node.id === director.id);
const originalTimeline = JSON.parse(originalDirector.widgets_values[6]);
const timelineWithoutPromptChanges = structuredClone(timeline);
timelineWithoutPromptChanges.segments.forEach((segment, index) => { segment.prompt = originalTimeline.segments[index].prompt; });
assert.deepEqual(timelineWithoutPromptChanges, originalTimeline, 'Non-prompt timeline data changed');
const restored = structuredClone(workflow);
const restoredDirector = restored.nodes.find(node => node.id === director.id);
restoredDirector.widgets_values[6] = originalDirector.widgets_values[6];
restoredDirector.widgets_values[7] = originalDirector.widgets_values[7];
for (const bucket of ['properties', 'widgets_values_named']) {
  for (const key of ['timeline_data', 'local_prompts']) {
    if (Object.hasOwn(originalDirector[bucket], key)) restoredDirector[bucket][key] = originalDirector[bucket][key];
    else delete restoredDirector[bucket][key];
  }
}
assert.deepEqual(restored, original, 'Unexpected workflow edit outside prompt mirrors');
assert.equal(sha256(fs.readFileSync(inputPath)), sha256(sourceBytes), 'Input source changed during compilation');

const warnings = compiled.flatMap(line => line.warnings.map(message => ({line_id: line.line_id, message})));
const report = {
  source: inputPath, sourceSha256: sha256(sourceBytes), output: outputPath,
  method: 'Agent-authored performance settings, validated and compiled with the installed Cueboard engine. No separate local-writer review was run.',
  catalogVersion: catalog.catalog_version, schemaVersion: config.schema_version,
  performances: compiled.length, segments: timeline.segments.length, shots: 8,
  speakingPerformances: compiled.filter(line => line.spoken_text).map(line => line.line_id),
  voiceReferences: Object.fromEntries(Object.entries(config.character_baselines).map(([id, baseline]) => [id, baseline.voice_reference])),
  referencesPreserved: timeline.motionSegments?.length || 0,
  dialoguePreserved: true, nonPromptSettingsPreserved: true, allPromptMirrorsUpdated: true,
  exactlyOneCueboardBlockPerSegment: true, idempotenceVerified: true, inputUnchanged: true,
  configuredDurationSeconds: director.widgets_values[2],
  timelineEndSeconds: Math.max(...timeline.segments.map(segment => segment.start + segment.length)) / frameRate,
  segmentTimingsPreserved: true,
  fractionalTimingsPresent: timeline.segments.some(segment => !Number.isInteger(segment.start) || !Number.isInteger(segment.length)),
  compilerWarningCount: warnings.length,
  compilerWarnings: warnings,
  generationRun: false, localWriterReviewRun: false,
};
fs.mkdirSync(outputDirectory, {recursive: true});
for (const [filename, value] of [
  [path.basename(outputPath), workflow], ['cueboard-config.json', config],
  ['cueboard-compiled.json', compiled], ['verification.json', report],
]) {
  const destination = path.join(outputDirectory, filename);
  assert.notEqual(destination.toLowerCase(), inputPath.toLowerCase(), 'Refusing to overwrite input');
  fs.writeFileSync(destination, JSON.stringify(value, null, 2) + '\n');
}
assert.equal(sha256(fs.readFileSync(inputPath)), sha256(sourceBytes));
console.log(JSON.stringify({...report, compilerWarnings: undefined}, null, 2));
