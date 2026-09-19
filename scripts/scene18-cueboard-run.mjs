import fs from 'node:fs';
import path from 'node:path';
import {compileScene} from '../src/lib/emotion/compiler.ts';
import {assertSceneConfig} from '../src/lib/emotion/validation.ts';
import {DEFAULT_ADAPTER} from '../src/lib/emotion/constants.ts';
const source='D:/Data/Downloads/Scene_18_The_father_runs(1).json';
const out='D:/Projects/Premiere316_v3/projects/the_prodigal_son/workflows/Cueboard/Scene_18_2026-09-18';
fs.mkdirSync(out,{recursive:true});
const workflow=JSON.parse(fs.readFileSync(source,'utf8'));
const director=workflow.nodes.find(n=>n.type==='LTXDirector');
const timeline=JSON.parse(director.widgets_values[6]);
const catalog=JSON.parse(fs.readFileSync('public/data/emotion_catalog.json','utf8'));
const tracks=[
 ['love','reunion_after_absence',5,'restrained','Recognize the son he feared lost; make certain before moving.','hope','evidence_opening',3,'suppressed','Reach home despite expecting rejection.'],
 ['compassion','practical_support',5,'open','Get to his son before he loses the courage to stay.','shame','public_exposure',5,'suppressed','Remain present despite the urge to hide.'],
 ['love','reunion_after_absence',6,'open','Hold him and establish that he is really here.','shame','public_exposure',5,'restrained','Endure being held without yet believing he belongs.'],
 ['compassion','practical_support',5,'restrained','Support his weight; share his level without demanding he rise.','shame','private_self_judgment',5,'suppressed','Kneel without pulling away from the father supporting him.'],
 ['tenderness','care_after_strain',5,'open','Let him return the embrace without pressure or consolation in words.','love','reunion_after_absence',5,'restrained','Allow himself to hold his father while shame remains.'],
 ['compassion','witness_without_fix',5,'restrained','Hear every word; offer presence without interrupting or correcting.','remorse','confession',5,'restrained','Own the harm plainly; do not bargain for forgiveness.'],
 ['compassion','practical_support',5,'restrained','Turn love into a clear practical instruction while keeping his son close.','shame','private_self_judgment',4,'restrained','Try to remove the dirt he has left; accept his father keeping his hand.'],
 ['tenderness','care_after_strain',4,'restrained','Bring him home at his pace and carry part of the burden.','hope','evidence_opening',3,'restrained','Accept support without sudden recovery or triumphant relief.']
];
const config={schema_version:'1.0.0',catalog_version:catalog.catalog_version,scene_id:'scene18_workflow',character_baselines:{father:{label:'FATHER',voice_reference:null,identity_locked:true},younger:{label:'YOUNGER SON',voice_reference:null,identity_locked:true}},scene_defaults:{allow_narration:false,allow_extra_dialogue:false,allow_nonverbal_vocalizations:false},character_overrides:{},lines:[],adapter:structuredClone(DEFAULT_ADAPTER)};
for(let i=0;i<timeline.segments.length;i++){
 const seg=timeline.segments[i];const spec=tracks[i];
 for(const [character,offset] of [['father',0],['younger',5]]){
  const speaking=(i===5&&character==='younger')||(i===6&&character==='father');
  const spoken=speaking?seg.prompt.match(/DIALOGUE:[^\n]*?"([^"\n]+)"/)[1]:'';
  config.lines.push({line_id:`shot${i+1}_${character}`,character_id:character,spoken_text:spoken,duration_seconds:seg.length/24,overrides:{felt_layers:[{role:'dominant',selection:{emotion_id:spec[offset],variant_id:spec[offset]+'__'+spec[offset+1],intensity:spec[offset+2]},layer_weight:1}],regulation:spec[offset+3],objective:spec[offset+4],relationship_context:'Father and younger son reunited after separation; the son expects judgment and the father offers continuing belonging.',physical_context:'Retain all existing shot action, posture, tears, physical exhaustion and contact. Emotional cues must not reset an action or alter camera, wardrobe or props.',framing:speaking?'close_up':'silent_reaction',cue_budget:{face:0,voice:speaking?2:0,body:0},continuity:{from_line_id:i?`shot${i}_${character}`:null,restart_onset:false}},beats:[],authored_sound_events:[]});
 }
}
assertSceneConfig(config,catalog.catalog_version);
const compiled=compileScene(catalog,config);
fs.writeFileSync(path.join(out,'cueboard-config.json'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(out,'cueboard-compiled.json'),JSON.stringify(compiled,null,2));
console.log(JSON.stringify(compiled.filter(x=>x.spoken_text).map(x=>({id:x.line_id,video:x.video_direction,delivery:x.delivery_direction,warnings:x.warnings})),null,2));

const original=structuredClone(workflow);
for(let i=0;i<timeline.segments.length;i++){
 const seg=timeline.segments[i];
 const directions=compiled.filter(x=>x.line_id.startsWith(`shot${i+1}_`));
 const block=directions.map(x=>{
  const settings=x.performance_json.resolved_settings;
  const label=config.character_baselines[x.character_id].label;
  const layer=settings.felt_layers[0];
  const emotion=catalog.emotions.find(e=>e.id===layer.selection.emotion_id);
  const acting=x.video_direction.replace(/^Hold a close-up\. Keep lower-body action out of the instruction; no forced walking or full-body reframing\. /,'');
  return `${label}: internal ${emotion.label.toLowerCase()}, intensity ${layer.selection.intensity}/7; outwardly ${settings.regulation}.\n${acting}`+(x.spoken_text?`\nVocal delivery (retain the attached character voice reference): ${x.delivery_direction}`:'\nNo spoken words from this character in this shot.');
 }).join('\n\n');
 seg.prompt+='\n\nCUEBOARD PERFORMANCE — acting directions only, never spoken. Preserve the ACTION, NONVERBAL, CAMERA, SCORE, DIALOGUE, CONTINUITY and SOUND above. Retain the already authored weeping and breaths; add no new vocal events.\n'+block;
}
director.widgets_values[6]=JSON.stringify(timeline);
director.widgets_values[7]=timeline.segments.map(s=>s.prompt).join(' | ');
// Preserve the user's timing controls, voice references, models and all other graph fields.
const stripped=structuredClone(workflow);stripped.nodes.find(n=>n.type==='LTXDirector').widgets_values[6]=original.nodes.find(n=>n.type==='LTXDirector').widgets_values[6];stripped.nodes.find(n=>n.type==='LTXDirector').widgets_values[7]=original.nodes.find(n=>n.type==='LTXDirector').widgets_values[7];
if(JSON.stringify(stripped)!==JSON.stringify(original))throw Error('Unexpected non-prompt edit');
const beforeTimeline=JSON.parse(original.nodes.find(n=>n.type==='LTXDirector').widgets_values[6]);
const afterWithoutPrompts=structuredClone(timeline);afterWithoutPrompts.segments.forEach((seg,i)=>seg.prompt=beforeTimeline.segments[i].prompt);
if(JSON.stringify(afterWithoutPrompts)!==JSON.stringify(beforeTimeline))throw Error('Timeline metadata changed');
for(let i=0;i<timeline.segments.length;i++){
 const before=beforeTimeline.segments[i].prompt.match(/^DIALOGUE:.*$/m)?.[0];
 const after=timeline.segments[i].prompt.match(/^DIALOGUE:.*$/m)?.[0];
 if(before!==after)throw Error('Dialogue changed');
}
const backup=path.join(out,'Scene_18_before_cueboard.json');if(!fs.existsSync(backup))fs.copyFileSync(source,backup);
const result=path.join(out,'Scene_18_The_father_runs_Cueboard.json');
fs.writeFileSync(result,JSON.stringify(workflow,null,2)+'\n');
fs.writeFileSync(source,JSON.stringify(workflow,null,2)+'\n');
const report={source,output:result,backup,method:'Agent-authored settings validated and compiled using the installed Cueboard engine; local AI review not run because no writer was loaded.',catalogVersion:catalog.catalog_version,performances:compiled.length,shots:timeline.segments.length,dialoguePreserved:true,nonPromptSettingsPreserved:true,configuredDurationSeconds:director.widgets_values[2],shotsEndSeconds:Math.max(...timeline.segments.map(s=>s.start+s.length))/24,generationRun:false};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
