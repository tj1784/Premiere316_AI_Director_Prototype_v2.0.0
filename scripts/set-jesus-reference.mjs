import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reviewCharacterVoiceDesign,resolveCharacterVoice} from '../src/lib/studio/character-voice-designs.ts';
const source='D:/Media/Generated/ComfyUI-Audio-Gen/JESUS.flac';
const bytes=await fs.readFile(source), sha256=createHash('sha256').update(bytes).digest('hex');
await fs.mkdir('public/voices/shared',{recursive:true});
await fs.writeFile('public/voices/shared/JESUS.flac',bytes);
const backup='projects/voice-reference-update-20260917';
await fs.mkdir(backup,{recursive:true});
async function exchange(body={operation:'read',value:null}) {
 const r=await fetch('http://127.0.0.1:8080/api/project-storage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json(); if(!r.ok)throw Error(j.error); return JSON.parse(j.value);
}
const state=await exchange();
try { await fs.writeFile(`${backup}/studio-before.json`,JSON.stringify(state,null,2),{flag:'wx'}); } catch(e) {if(e.code!=='EEXIST')throw e;}
const changed=[];
for(let i=0;i<state.state.pictures.length;i++) {
 let p=state.state.pictures[i];
 const characters=(p.production?.assets??[]).filter(a=>a.category==='character'&&!a.tombstone&&/\bjesus\b/i.test(`${a.name} ${a.id}`));
 for(const c of characters) {
  const now=Date.now(),id=`voice-import:${c.id}:${sha256}`;
  p={...p,characterVoiceDesigns:{profiles:[],selectedByCharacter:{},...p.characterVoiceDesigns}};
  const previous=(p.characterVoiceDesigns.iterations??[]).find(v=>v.id===id);
  p.characterVoiceDesigns.iterations=[...(p.characterVoiceDesigns.iterations??[]).filter(v=>v.id!==id),{
   ...previous,id,characterId:c.id,name:'Jesus · selected master recording',description:'User-selected JESUS.flac. Shared Jesus voice identity across projects.',referenceText:'',createdAt:previous?.createdAt??now,status:'NEEDS_REVIEW',reviewedAt:null,
   audio:{mediaUri:'/voices/shared/JESUS.flac',filename:'JESUS.flac',bytes:bytes.length,sha256,origin:'imported',durationSec:191445/24000,sampleRate:24000,channels:1}
  }];
  p=reviewCharacterVoiceDesign(p,id,'APPROVED',now);
  changed.push({pictureId:p.id,characterId:c.id,id});
 }
 state.state.pictures[i]=p;
}
await exchange({operation:'write',value:JSON.stringify(state),knownIds:state.state.pictures.map(p=>p.id)});
const saved=await exchange();
for(const c of changed){
 const p=saved.state.pictures.find(p=>p.id===c.pictureId),v=resolveCharacterVoice(p,c.characterId);
 if(v.voice?.id!==c.id)throw Error(JSON.stringify(v));
 const r=await fetch('http://127.0.0.1:8080'+v.voice.audio.mediaUri);
 if(!r.ok||createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')!==sha256)throw Error('Served audio differs');
}
await fs.writeFile(`${backup}/studio-verification.json`,JSON.stringify({source,sha256,changed},null,2));
console.log(JSON.stringify({sha256,changed}));
