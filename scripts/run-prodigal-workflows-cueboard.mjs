/**
 * Compile conservative, agent-authored Cueboard performance directions into
 * staged Prodigal Son LTX workflows. This never calls a writer, approves a
 * screenplay/performance draft, changes active files, or queues generation.
 * Usage: node --experimental-strip-types scripts/run-prodigal-workflows-cueboard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compileScene } from '../src/lib/emotion/compiler.ts';
import { assertSceneConfig } from '../src/lib/emotion/validation.ts';
import { DEFAULT_ADAPTER } from '../src/lib/emotion/constants.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.resolve(ROOT, 'projects/the_prodigal_son/workflows/Cueboard/All_Scenes_20260918');
const NEW_SCENE1 = path.resolve(ROOT, 'projects/the_prodigal_son/imports/scene1-3m30-20260918/Scene_01_Temple_and_the_Gathering_Varied_Angles.json');
const ROOTS = [path.resolve(ROOT, 'projects/the_prodigal_son/workflows/LTX_frames_attached'), 'D:/AI/ComfyUI/Data/LTX2.5/User/default/workflows/Prodigal_Son_Frames_Attached'];
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = readJson(path.join(ROOT, 'public/data/emotion_catalog.json'));
const MARKER = 'CUEBOARD PERFORMANCE — acting directions only, never spoken.';
const strip = s => String(s ?? '').replace(/\n{1,2}CUEBOARD PERFORMANCE\b[\s\S]*$/u, '').trimEnd();
const clone = structuredClone;
const canonicalLabel = s => ({ELDER:'ELDER SON',YOUNGER:'YOUNGER SON'}[s.trim().toUpperCase()] ?? s.trim().toUpperCase());
const actorId = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const LABELS = ['YOUNG LISTENER','YOUNGER SON','ELDER SON','BREAD SELLER','PHARISEE','SCRIBE','JESUS','FATHER','YOUNGER','ELDER','MATTAN','HANNAH','LEVI','DAMON','FARMER','HOST'];
const labelSource = LABELS.join('|');
const aliasPatterns = [
  ['YOUNGER SON', /\byounger(?: son)?\b/i], ['ELDER SON', /\belder(?: son)?\b/i], ['FATHER', /\bfather\b/i],
  ['YOUNG LISTENER', /\byoung listener\b|YL-01/i], ['JESUS', /\bJesus\b/i], ['PHARISEE', /\bPharisee\b/i], ['SCRIBE', /\bscribe\b/i],
  ['MATTAN', /\bMattan\b/i], ['HANNAH', /\bHannah\b/i], ['LEVI', /\bLevi\b/i], ['DAMON', /\bDamon\b/i],
  ['BREAD SELLER', /\bbread seller\b/i], ['FARMER', /\bfarmer\b/i], ['HOST', /\bhost\b/i],
];
const selection = (emotion, variant, intensity, regulation, objective) => ({emotion, variant, intensity, regulation, objective});
const neutral = selection('neutral', 'task_ready', 2, 'restrained', 'Carry out the practical action already specified, with no added emotional display.');
const listener = selection('interest', 'interpersonal_engagement', 2, 'restrained', 'Receive the person in front of you and allow the existing listening beat to unfold without anticipating later events.');
const characterDefault = {
  JESUS: selection('compassion','witness_without_fix',3,'restrained','Receive the gathered people with patient attention; invite them into the story without sermonizing, hostility or a new gesture.'),
  'YOUNG LISTENER': selection('interest','interpersonal_engagement',3,'restrained','Let attention gradually settle on the actual gathering; remain the distinct hillside listener, never either brother in the parable.'),
  PHARISEE: selection('indignation','personal_unfairness',3,'restrained','Let the authored objection expose discomfort with the welcome offered here; keep the response contained and specific.'),
  SCRIBE: selection('contempt','moral_devaluation',3,'restrained','Hold the judgment already present in the exact words while maintaining the quiet social restraint of this exchange.'),
  MATTAN: selection('neutral','task_ready',2,'restrained','Attend to the household task already underway; do not add a reaction, speech or new action.'),
  HANNAH: selection('compassion','practical_support',3,'restrained','Express care through the practical household action already written, with no invented consolation.'),
  LEVI: selection('trust','earned_cooperation',2,'restrained','Attend to the established task and the person addressing you; let existing silence remain sufficient.'),
  DAMON: selection('interest','interpersonal_engagement',3,'restrained','Respond to the immediate social exchange as written; do not add a concealed scheme or extra reassurance.'),
  HOST: selection('neutral','task_ready',2,'restrained','Maintain the practical exchange already written without adding cruelty, warmth or further demands.'),
  'BREAD SELLER': selection('sympathy','familiar_persons_hardship',3,'restrained','Offer the quiet refusal already written without changing the food available or adding promises.'),
  FARMER: neutral,
};
// Scene-level interpretations are authored here; segment-specific source anchors
// and explicit existing action take priority. Face/body cue budgets remain zero.
const SCENE = {
  2: {'ELDER SON':selection('determination','sustained_task',3,'restrained','Attend to the shared work and help your brother complete this immediate task.'),'YOUNGER SON':selection('boredom','restless_understimulation',3,'restrained','Stay with the work while the world beyond it continues to draw your attention.')},
  3: {FATHER:selection('love','reunion_after_absence',4,'open','Welcome each son with equal, individual affection; care for the person directly before you.'),'ELDER SON':selection('love','everyday_familiar_bond',3,'restrained','Receive your father’s attention without making a display of your effort.'),'YOUNGER SON':selection('delight','thoughtful_gift',3,'open','Enjoy being welcomed and the gift already offered without adding rivalry.')},
  4: {FATHER:selection('emotional_hurt','important_rejection',4,'restrained','Stay available to your son as the request hurts; keep the attempt at connection open.'),'ELDER SON':selection('anger','boundary_defense',4,'restrained','Protect your father without turning the exchange into a threat.'),'YOUNGER SON':selection('determination','principled_commitment',4,'restrained','Make the authored request and hold to it while its cost to your family remains present.')},
  5: {'ELDER SON':selection('worry','protective_concern',3,'restrained','Offer practical care without pretending to agree with the decision to leave.'),'YOUNGER SON':selection('vulnerability','asking_for_support',3,'restrained','Seek your brother’s company while guarding the independence you have claimed.')},
  6: {FATHER:selection('sadness','private_absence',3,'restrained','Complete the division carefully while remaining present to both sons.'),'ELDER SON':selection('determination','sustained_task',3,'restrained','Continue the household work left to you without turning this task into an accusation.'),'YOUNGER SON':selection('anticipation','eager_arrival',3,'restrained','Prepare for departure through the specific practical actions already written.')},
  7: {FATHER:selection('grief','reminder_wave',4,'restrained','Let your son leave while keeping the possibility of contact open.'),'ELDER SON':selection('worry','protective_concern',3,'suppressed','Contain your disagreement and remain beside your father.'),'YOUNGER SON':selection('anticipation','mixed_stakes',3,'restrained','Leave with your chosen resolve while allowing the cost of separation to remain underneath.')},
  8: {'YOUNGER SON':selection('excitement','imminent_adventure',3,'restrained','Take in the wider world at the pace of the journey; let distance from home register without a new reaction.')},
  9: {'YOUNGER SON':selection('hope','evidence_opening',3,'restrained','Find a place among these people and allow the authored welcome to matter.')},
  10: {'YOUNGER SON':selection('hope','chosen_persistence',3,'restrained','Keep the social welcome alive through the exact action written while noticing when the company thins.')},
  11: {FATHER:selection('compassion','practical_support',3,'restrained','Offer your elder son company and rest without making him earn your attention.'),'ELDER SON':selection('exhaustion','obligation_remains',3,'restrained','Accept only the rest already written while the work and worry continue to occupy you.')},
  12: {'YOUNGER SON':selection('anxiety','waiting_for_news',3,'restrained','Try to preserve food, lodging and belonging as your remaining money runs out.')},
  13: {'YOUNGER SON':selection('vulnerability','asking_for_support',4,'restrained','Seek the exact work or food already written while containing shame and physical weakness.')},
  14: {FATHER:selection('compassion','practical_support',3,'restrained','Care for the injured hand and the burden beneath the work without offering a new speech.'),'ELDER SON':selection('resentment','unequal_burden',3,'restrained','Complete the task while the accumulated burden strains your restraint; honor any apology already written.')},
  15: {'YOUNGER SON':selection('remorse','confession',4,'restrained','Recognize your responsibility plainly; let the written confession become an intention to return rather than a bargain.')},
  16: {FATHER:selection('tenderness','care_after_strain',3,'restrained','Recognize your son’s work and offer care without demanding that he abandon his task.'),'ELDER SON':selection('exhaustion','obligation_remains',3,'restrained','Receive the offered care while finding it difficult to let the unfinished work rest.')},
  17: {'YOUNGER SON':selection('hope','chosen_persistence',3,'restrained','Continue toward home through the present fatigue without assuming welcome or relief in advance.')},
  19: {FATHER:selection('joy','shared_good_news',4,'restrained','Make your son’s return tangible through the practical welcome already written.'),'YOUNGER SON':selection('vulnerability','asking_for_support',3,'restrained','Receive the care one moment at a time without sudden physical recovery or effortless belonging.')},
  20: {'ELDER SON':selection('emotional_hurt','unnoticed_slight',4,'restrained','Let the good news reach you before the sense of exclusion closes around it; do not skip the authored relief.')},
  21: {FATHER:selection('compassion','witness_without_fix',4,'restrained','Hear your elder son’s injury without defending yourself; keep the invitation to belong open.'),'ELDER SON':selection('resentment','unacknowledged_injury',4,'restrained','Ask to be seen for the care and work you have given; let hurt remain audible beneath the accusation.')},
  22: {FATHER:selection('hope','chosen_persistence',3,'restrained','Keep the invitation available without deciding the other person’s answer.'),'ELDER SON':selection('vulnerability','chosen_disclosure',3,'restrained','Remain with the unresolved invitation and the effort you witness; do not supply an answer or a final reconciliation.'),'YOUNGER SON':selection('exhaustion','after_sustained_effort',3,'restrained','Maintain the physical fragility already written while staying available to the uncertain family moment.')},
};
const scene18Prior = readJson(path.join(ROOT, 'projects/the_prodigal_son/workflows/Cueboard/Scene_18_16_segments/cueboard-config.json'));

/** Exact source dialogue only. No screenplay inference or invented speaker. */
function dialogue(prompt) {
  const exact = [...prompt.matchAll(new RegExp(`^(${labelSource}) says exactly:\\s*(.+)$`, 'gm'))];
  if (exact.length) return exact.map(m => {
    const raw = m[2].trim();
    assert(raw.startsWith('"') && raw.endsWith('"'), 'Malformed says-exactly quote');
    // The package represents inner dialogue with literal backslashes. Preserve
    // the words while removing only this quote-escaping presentation layer.
    return {speaker:canonicalLabel(m[1]),text:raw.slice(1,-1).replace(/\\+"/g,'"'),source:m[0]};
  });
  const section = prompt.match(/^(?:Performance and dialogue|DIALOGUE|SCRIPT):\s*([^\n]*)/mi)?.[1] ?? '';
  if (!section || /^(?:No (?:scripted |new intelligible |intelligible )?(?:dialogue|words)|None|Silence)\b/i.test(section)) return [];
  const speakerPattern = new RegExp(`\\b(${labelSource})(?:,[^:\\n]{0,100})?:\\s*`, 'g');
  const labels = [...section.matchAll(speakerPattern)];
  const quotes = [...section.matchAll(/[“"]([^”"\n]+)[”"]/g)];
  if (quotes.length) return quotes.flatMap(q => {
    const speaker = labels.filter(l => l.index < q.index).at(-1);
    return speaker ? [{speaker:canonicalLabel(speaker[1]),text:q[1],source:q[0]}] : [];
  });
  if (labels.length === 1) {
    const label = labels[0];
    const text = section.slice(label.index + label[0].length).split(/\s+Covers\b/)[0].trim();
    return text ? [{speaker:canonicalLabel(label[1]),text,source:section}] : [];
  }
  assert.equal(labels.length, 0, 'Ambiguous unquoted dialogue needs an explicit parser case');
  return [];
}
function sourceContext(base) {
  return [base.split('\n\n')[0],base.match(/^End state:[^\n]*/mi)?.[0] ?? '']
    .join('\n').replace(/[“"](?:\\.|[^”"\n])*[”"]/g, '');
}
const scene1Cast = [
  ['YOUNG LISTENER'],['YOUNG LISTENER'],['YOUNG LISTENER'],['YOUNG LISTENER'],['YOUNG LISTENER'],
  ['JESUS','YOUNG LISTENER','PHARISEE','SCRIBE'],['JESUS','VISIBLE LISTENERS'],['VISIBLE LISTENERS'],
  ['PHARISEE','SCRIBE'],['PHARISEE','SCRIBE'],['SCRIBE','PHARISEE'],['JESUS','VISIBLE LISTENERS'],
  ['YOUNG LISTENER'],['JESUS'],['JESUS','YOUNG LISTENER','PHARISEE','SCRIBE'],['JESUS'],
];
function actors(base, scene, speech, index) {
  // Explicitly reviewed replacement cast: names in a parable, an offscreen
  // eyeline or an identity reminder do not create another on-camera actor.
  if (scene === 1) return [...new Set([...speech.map(s=>s.speaker), ...scene1Cast[index]])];
  // Retain the two established performances in the previous reviewed Scene18
  // Cueboard pass, including its FIRST/LAST continuation phases.
  if (scene === 18) return ['FATHER','YOUNGER SON'];
  const context = sourceContext(base);
  const result = new Set(speech.map(s => s.speaker));
  for (const [name,re] of aliasPatterns) {
    const visible = context.split(/(?<=[.!?])\s+/).some(sentence => {
      const match=sentence.match(re); if(!match)return false;
      const tail=sentence.slice(match.index+match[0].length);
      // Do not cast the absent owner of a prop, a remembered person, or an
      // explicitly offscreen person merely because their name is mentioned.
      if (/^[’']s\s+(?:bread|cloth|mantle|gift|memory|pouch|waterskin|absence|arrival|return|voice|confession|command|call)/i.test(tail))return false;
      if (/\b(?:offscreen|out of (?:view|frame)|absent|no (?:visible )?|memory of|remember|flashback|apparition)\b/i.test(sentence) && !/\b(?:stands?|sits?|seated|kneels?|walks?|holds?|faces?|looks?|watches?|receives?|turns?|reaches?|embraces?)\b/i.test(tail.slice(0,55)))return false;
      return true;
    });
    if(visible)result.add(name);
  }
  if (!result.size) result.add(/listeners|worshippers|gathering/i.test(context) ? 'VISIBLE LISTENERS' : 'VISIBLE PARTICIPANTS');
  return [...result];
}
function interpretation(scene, index, actor, base) {
  if (scene === 1 && actor === 'YOUNG LISTENER' && index < 5)
    return index < 2 ? selection('boredom','restless_understimulation',2,'restrained','Remain outwardly composed while attention drifts toward the life outside; retain only the small breath and glance already written.')
      : selection('anticipation','eager_arrival',3,'restrained','Attend to the street and leave through the exact coin and walking actions already written, each performed once.');
  if (scene === 4 && index < 2) return actor === 'FATHER'
    ? selection('amusement','affectionate_shared_joke',3,'restrained','Share the warmth of the supper and the joke as written; do not anticipate the coming request.')
    : selection('contentment','companionable_presence',2,'restrained','Stay in the ordinary family supper before the request changes it.');
  if (scene === 10 && actor === 'YOUNGER SON' && index === 5) return selection('loneliness','alone_after_contact',3,'restrained','Remain with the emptied room and the distant company without adding a new search, speech or collapse.');
  if (scene === 12 && actor === 'YOUNGER SON' && index === 2) return selection('nostalgia','private_irretrievable',3,'restrained','Let the familiar gift briefly carry its association with home before the practical choice already written.');
  if (scene === 14 && actor === 'ELDER SON' && index >= 3) return selection('remorse','repair_followthrough',3,'restrained','Own the harshness through the apology and repair already written; accept the quiet response without seeking further reassurance.');
  if (scene === 20 && actor === 'ELDER SON' && index === 1) return selection('relief','danger_averted',3,'restrained','First receive the fact that your brother is alive; allow only the brief relief already authored before the later hurt.');
  if (scene === 20 && actor === 'ELDER SON' && index === 0) return selection('exhaustion','obligation_remains',3,'restrained','Gather the bowl and mantle and attend to the music approaching from home, before you have heard the news.');
  if (scene === 21 && actor === 'ELDER SON' && index >= 8) return selection('emotional_hurt','important_rejection',3,'restrained','Allow the sight of your brother’s fragility to complicate the grievance without resolving it or deciding to enter.');
  return SCENE[scene]?.[actor] ?? characterDefault[actor] ?? (/listen|watch|attend/i.test(base) ? listener : neutral);
}
function framing(base, hasSpeech) {
  if (!hasSpeech) return 'silent_reaction';
  if (/medium|waist.up/i.test(base.split('\n\n')[0]) && !/close.up/i.test(base.split('\n\n')[0])) return 'medium';
  return 'close_up';
}
function compileWorkflow(input, scene) {
  const workflow = clone(input), director = workflow.nodes.find(n=>n.type==='LTXDirector');
  assert(director, 'Missing LTXDirector');
  const oldDirector = input.nodes.find(n=>n.id===director.id);
  const originalTimeline = JSON.parse(director.widgets_values[6]);
  assert.deepEqual(JSON.parse(director.properties.timeline_data), originalTimeline, 'Timeline property disagrees');
  if (director.widgets_values_named) assert.deepEqual(JSON.parse(director.widgets_values_named.timeline_data), originalTimeline, 'Named timeline disagrees');
  const timeline = clone(originalTimeline), fps = Number(director.properties.frame_rate ?? director.widgets_values_named?.frame_rate ?? 24);
  const config = {schema_version:'1.0.0',catalog_version:catalog.catalog_version,scene_id:`prodigal_scene_${String(scene).padStart(2,'0')}`,character_baselines:{},scene_defaults:{allow_narration:false,allow_extra_dialogue:false,allow_nonverbal_vocalizations:false},character_overrides:{},lines:[],adapter:clone(DEFAULT_ADAPTER)};
  const prior = new Map(), records = [], warnings = [];
  for (const [index, segment] of timeline.segments.entries()) {
    assert(Number.isFinite(segment.length) && segment.length>0 && Number.isFinite(segment.start), 'Invalid timing');
    const base=strip(segment.prompt); assert(base, `Segment ${index+1} has an empty prompt`);
    const speech=dialogue(base), cast=actors(base,scene,speech,index), lineIds=[];
    const distinct = [...new Set(speech.map(s=>s.speaker))];
    if (distinct.length > 1) warnings.push({segment:index+1,type:'multiple-scripted-speakers',speakers:distinct,message:'Original multi-speaker dialogue and existing voice routing retained; this compiler does not invent per-speaker Stage 3 routing.'});
    if (speech.length && !segment.voiceReferenceEnabled) warnings.push({segment:index+1,type:'speech-without-enabled-voice-reference',speakers:distinct});
    for (const actor of cast) {
      const id=actorId(actor), lineId=`segment_${String(index+1).padStart(2,'0')}_${id}`;
      const spoken=speech.filter(s=>s.speaker===actor).map(s=>s.text).join('\n');
      const reference=spoken && distinct.length===1 && segment.voiceReferenceEnabled ? segment.voiceReferenceFile || null : null;
      config.character_baselines[id] ??= {label:actor,voice_reference:reference,identity_locked:true};
      if(reference){assert(!config.character_baselines[id].voice_reference || config.character_baselines[id].voice_reference===reference,`Conflicting voice files for ${actor}`);config.character_baselines[id].voice_reference=reference;}
      const spec=interpretation(scene,index,actor,base);
      let overrides={felt_layers:[{role:'dominant',selection:{emotion_id:spec.emotion,variant_id:`${spec.emotion}__${spec.variant}`,intensity:spec.intensity},layer_weight:1}],regulation:spec.regulation,objective:spec.objective,relationship_context:'Use only the relationships and circumstances established in this exact segment; do not anticipate later reconciliation, separation or a story being told.',physical_context:'Retain the exact authored actions, posture, physical strain, breathing, contact and existing sounds. No new movement, cue, camera change or sound event. Apply this character direction only when that person is actually visible or explicitly assigned speech; offscreen characters stay offscreen.',framing:framing(base,!!spoken),cue_budget:{face:0,voice:spoken?2:0,body:0},continuity:{from_line_id:prior.get(id) ?? null,restart_onset:false}};
      if(scene===18 && ['FATHER','YOUNGER SON'].includes(actor)) {
        const shot=timeline.segments.length===16 ? Math.floor(index/2)+1 : index+1;
        const phase=timeline.segments.length===16 && index%2 ? 'last' : 'first';
        const source=scene18Prior.lines.find(l=>l.line_id===`shot${String(shot).padStart(2,'0')}_${phase}_${actor==='FATHER'?'father':'younger'}`);
        if(source){overrides={...clone(source.overrides),framing:framing(base,!!spoken),cue_budget:{face:0,voice:spoken?2:0,body:0},continuity:{from_line_id:prior.get(id)??null,restart_onset:false}};}
      }
      config.lines.push({line_id:lineId,character_id:id,spoken_text:spoken,duration_seconds:segment.length/fps,overrides,beats:[],authored_sound_events:[]});
      prior.set(id,lineId);lineIds.push(lineId);
    }
    records.push({index:index+1,segmentId:segment.id,start:segment.start,length:segment.length,base,speech,actors:cast,lineIds});
  }
  assertSceneConfig(config,catalog.catalog_version);
  const compiled=compileScene(catalog,config), byId=new Map(compiled.map(l=>[l.line_id,l]));
  assert(compiled.every(l=>l.sound_events.length===0),'Added sound event');
  assert(compiled.filter(l=>!l.spoken_text).every(l=>!l.delivery_direction),'Silent performance gained vocal direction');
  const append=(base,record)=>base+'\n\n'+MARKER+'\nPreserve all source action, camera, dialogue, continuity, music and environmental sound exactly. Play only the present timeline portion; do not restart or repeat an action or line. These directions add no speech, chant, breath or other sound event.\n'+record.lineIds.map(id=>{
    const output=byId.get(id), settings=output.performance_json.resolved_settings;
    const dominant=settings.felt_layers.find(l=>l.role==='dominant').selection;
    const emotion=catalog.emotions.find(e=>e.id===dominant.emotion_id).label.toLowerCase();
    // The source already owns the camera and physical blocking. Cueboard's
    // generic framing lead is redundant and must not override that source.
    const acting=output.video_direction.replace(/^[\s\S]*?(?=Director objective \()/,'');
    return `${config.character_baselines[output.character_id].label}: internal ${emotion}, intensity ${dominant.intensity}/7; outwardly ${settings.regulation}.\n${acting}`+(output.spoken_text?`\nVocal delivery for only the exact words already assigned above (retain existing voice routing): ${output.delivery_direction}`:'\nNo new spoken words from this character in this segment.');
  }).join('\n\n');
  for(const record of records){const segment=timeline.segments[record.index-1];segment.prompt=append(record.base,record);assert.equal(append(strip(segment.prompt),record),segment.prompt,'Non-idempotent block');assert.equal(strip(segment.prompt),record.base);assert.equal(segment.prompt.split(MARKER).length-1,1);}
  const start=Number(originalTimeline.normalStartFrame??director.properties.start_frame??0), duration=Number(originalTimeline.normalDurationFrames??director.properties.duration_frames);
  const allIndices=originalTimeline.segments.map((_,i)=>i),selectedIndices=allIndices.filter(i=>originalTimeline.segments[i].start<start+duration&&originalTimeline.segments[i].start+originalTimeline.segments[i].length>start);
  const oldPrompts=director.widgets_values[7],joinBefore=indices=>indices.map(i=>originalTimeline.segments[i].prompt).join(' | ');
  const indices=oldPrompts===joinBefore(allIndices)?allIndices:oldPrompts===joinBefore(selectedIndices)?selectedIndices:null;
  assert(indices, 'Local prompt mirror is not the full or marked-range segment sequence');
  const timelineJson=JSON.stringify(timeline), localPrompts=indices.map(i=>timeline.segments[i].prompt).join(' | ');
  director.widgets_values[6]=timelineJson;director.widgets_values[7]=localPrompts;
  for(const bucket of ['properties','widgets_values_named'])if(director[bucket]){director[bucket].timeline_data=timelineJson;director[bucket].local_prompts=localPrompts;}
  const noPromptChanges=clone(timeline);noPromptChanges.segments.forEach((s,i)=>{s.prompt=originalTimeline.segments[i].prompt;});assert.deepEqual(noPromptChanges,originalTimeline,'Non-prompt timeline mutation');
  const restored=clone(workflow),restoredDirector=restored.nodes.find(n=>n.id===director.id);restoredDirector.widgets_values[6]=oldDirector.widgets_values[6];restoredDirector.widgets_values[7]=oldDirector.widgets_values[7];for(const bucket of ['properties','widgets_values_named'])if(oldDirector[bucket]){for(const key of ['timeline_data','local_prompts'])restoredDirector[bucket][key]=oldDirector[bucket][key];}assert.deepEqual(restored,input,'Non-prompt workflow mutation');
  for(const r of records)assert.deepEqual(dialogue(strip(timeline.segments[r.index-1].prompt)),r.speech,'Dialogue changed');
  const compilerWarnings=compiled.flatMap(l=>l.warnings.map(message=>({lineId:l.line_id,message})));
  return {workflow,config,compiled,records:records.map(({base,...r})=>r),report:{sceneId:`PS-S${String(scene).padStart(2,'0')}`,segments:timeline.segments.length,performances:compiled.length,speakingPerformances:compiled.filter(l=>l.spoken_text).length,silentPerformances:compiled.filter(l=>!l.spoken_text).length,sourceTimings:timeline.segments.map(s=>({id:s.id,start:s.start,length:s.length})),frameRate:fps,timelineDurationSeconds:Math.max(...timeline.segments.map(s=>s.start+s.length))/fps,markedRange:{startFrame:start,durationFrames:duration},dialoguePreserved:true,nonPromptSettingsPreserved:true,allPromptMirrorsUpdated:true,markedPromptScopePreserved:true,idempotenceVerified:true,compilerWarningCount:compilerWarnings.length,compilerWarnings,sourceWarnings:warnings}};
}

fs.mkdirSync(OUT,{recursive:true});
const groups=new Map();
const add=p=>{const bytes=fs.readFileSync(p),sha=hash(bytes),json=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(!json.nodes?.some(n=>n.type==='LTXDirector'))return;const record=groups.get(sha)??{sourceSha256:sha,sources:[],json,scene:Number(path.basename(p).match(/^Scene_(\d+)/)[1])};record.sources.push(path.resolve(p));groups.set(sha,record);};
assert(fs.existsSync(NEW_SCENE1),'Staged replacement Scene1 is missing');add(NEW_SCENE1);
for(const directory of ROOTS)for(const filename of fs.readdirSync(directory).filter(n=>/^Scene_(?!01)\d\d_.*\.json$/.test(n)).sort())add(path.join(directory,filename));
const results=[];
for(const [sourceSha256,group] of groups){
  const result=compileWorkflow(group.json,group.scene);
  const stem=path.basename(group.sources[0],'.json')+'-'+sourceSha256.slice(0,12),directory=path.join(OUT,stem);fs.mkdirSync(directory,{recursive:true});
  const outputPath=path.join(directory,`${stem}_Cueboard.json`),output=JSON.stringify(result.workflow,null,2)+'\n';
  const report={...result.report,method:'Agent-authored performance interpretations validated and compiled with the installed Cueboard engine; not a live local-writer AI review.',sourceSha256,sources:group.sources,outputPath,outputSha256:hash(output),localWriterReviewRun:false,screenplayApproved:false,performanceApprovalChanged:false,generationRun:false};
  for(const [name,value]of[[path.basename(outputPath),result.workflow],['cueboard-config.json',result.config],['cueboard-compiled.json',result.compiled],['segment-performance-map.json',result.records],['verification.json',report]])fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
  for(const source of group.sources)assert.equal(hash(fs.readFileSync(source)),sourceSha256,'Source file changed');
  assert.equal(hash(fs.readFileSync(outputPath)),report.outputSha256);
  results.push(report);console.log(JSON.stringify({scene:report.sceneId,segments:report.segments,performances:report.performances,sourceFiles:group.sources.length,outputPath}));
}
const summary={createdAt:new Date().toISOString(),method:'Installed Cueboard compiler with agent-authored settings; no local writer inference.',uniqueWorkflowVariants:results.length,sourceFiles:results.reduce((n,r)=>n+r.sources.length,0),sceneCount:new Set(results.map(r=>r.sceneId)).size,segments:results.reduce((n,r)=>n+r.segments,0),performances:results.reduce((n,r)=>n+r.performances,0),speakingPerformances:results.reduce((n,r)=>n+r.speakingPerformances,0),sourceWarnings:results.reduce((n,r)=>n+r.sourceWarnings.length,0),allInputsUnchanged:true,activeFilesUpdated:false,screenplayApprovalChanged:false,localWriterReviewRun:false,generationRun:false,workflows:results};
fs.writeFileSync(path.join(OUT,'batch-verification.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,workflows:undefined},null,2));
