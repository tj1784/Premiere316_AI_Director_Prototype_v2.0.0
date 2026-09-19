from pathlib import Path
import json,copy,re,hashlib,shutil,zipfile,datetime
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'projects/the_prodigal_son/workflows/LTX_frames_attached'
TEMPLATE=Path('D:/Data/Downloads/Scene_01_Temple_Director_Per_Segment_Voices(1).json')
COMFY=Path('D:/AI/ComfyUI/Data/LTX2.5')
BACKUP=ROOT/'projects/the_prodigal_son/backups/all-scene-ltx-template-20260918'
BACKUP.mkdir(parents=True,exist_ok=True)
template=json.loads(TEMPLATE.read_text(encoding='utf-8-sig'))
def director(d):return next(n for n in d['nodes'] if n['type']=='LTXDirector')
def timeline(d):return json.loads(director(d)['widgets_values'][6])
voice_sources={}; voice_files={'JESUS':'voices/shared/JESUS.flac'}
for folder in (ROOT/'projects/the_prodigal_son/media/assets/voices/biblical-v2').glob('PS-CHR-*-main'):
 speaker=folder.name.removeprefix('PS-CHR-').removesuffix('-main')
 if speaker=='JESUS':continue
 candidates=sorted(folder.glob('iteration-001*.flac'))
 if not candidates:continue
 src=candidates[0];rel=f'prodigal_son/voices/{speaker}-reference.flac';dst=COMFY/'Input'/rel
 dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 assert hashlib.sha256(src.read_bytes()).digest()==hashlib.sha256(dst.read_bytes()).digest()
 voice_files[speaker]=rel;voice_sources[speaker]=str(src)
aliases={'ELDER SON':'ELDER','YOUNGER SON':'YOUNGER','BREAD SELLER':'BREADSELLER'}
def speakers(segment):
 if segment.get('speaker'):return [segment['speaker']]
 m=re.search(r'Performance and dialogue:(.*?)(?:\nOnly|\nContinuity)',segment.get('prompt',''),re.S)
 if not m:return []
 names=re.findall(r'\b([A-Z][A-Z ]+)(?:,[^:\n]+| to [^:\n]+)?:',m[1])
 return list(dict.fromkeys(aliases.get(n.strip(),n.strip()) for n in names))
def write(p,d):
 if p.exists():
  b=BACKUP/(hashlib.sha256(str(p).encode()).hexdigest()[:12]+'-'+p.name)
  if not b.exists():shutil.copy2(p,b)
 p.parent.mkdir(parents=True,exist_ok=True)
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
report=[];outputs=[]
for num in range(1,23):
 paths=[p for p in BASE.glob(f'Scene_{num:02d}_*.json') if not any(s in p.name for s in ('verification','Temple_Dev','Director'))]
 assert len(paths)==1,(num,paths)
 path=paths[0];original=json.loads(path.read_text(encoding='utf-8-sig'))
 scene=copy.deepcopy(template if num==1 else original);oldtimeline=timeline(scene)
 updated=copy.deepcopy(template);target=director(updated);source=director(scene)
 target['title']=source.get('title',path.stem)
 target['widgets_values']=copy.deepcopy(source['widgets_values'])
 target['properties']={**target.get('properties',{}),**copy.deepcopy(source.get('properties',{}))}
 target['widgets_values_named']=copy.deepcopy(source.get('widgets_values_named',{}))
 t=copy.deepcopy(oldtimeline);issues=[];enabled=0
 for i,s in enumerate(t['segments'],1):
  names=speakers(s);s['voiceReferenceEnabled']=False;s['voiceReferenceFile']='';s['speaker']=names[0] if len(names)==1 else ''
  if len(names)==1 and names[0] in voice_files:
   s['voiceReferenceFile']=voice_files[names[0]];s['voiceReferenceEnabled']=True;enabled+=1
  elif names:
   issues.append({'segment':i,'speakers':names,'reason':'Multiple speakers: split or provide dialogue audio before enabling a single voice reference.' if len(names)>1 else 'No matching voice recording.'})
 serialized=json.dumps(t,ensure_ascii=False,separators=(',',':'))
 target['widgets_values'][6]=serialized
 target['properties']['timeline_data']=serialized
 target['widgets_values_named']['timeline_data']=serialized
 saver=next(n for n in updated['nodes'] if n['type']=='VHS_VideoCombine')
 saver['widgets_values']['filename_prefix']='Prodigal_Son/'+path.stem+'/segment'
 note=next(n for n in updated['nodes'] if n.get('title','').startswith('VOICE REFERENCES'))
 note['widgets_values']=['Voice reference Off/On and Choose audio are beside First frame / Last frame. Queue Selected or Queue Segments to use individual voices. Jesus uses the user-selected JESUS.flac. Silent segments are Off.\n\n'+('\n'.join(f"Segment {x['segment']}: {', '.join(x['speakers'])}. {x['reason']}" for x in issues) or 'All identified single-speaker segments have voice references.')]
 # Preserve every shot's original timing, dialogue and frame bindings.
 for before,after in zip(oldtimeline['segments'],t['segments']):
  for k,v in before.items():
   if k not in ('speaker','voiceReferenceFile','voiceReferenceEnabled'):assert after[k]==v,(path,k)
 missing=[]
 for s in t['segments']:
  for key in ('imageFile','lastFrameFile','endImageFile','voiceReferenceFile'):
   if s.get(key) and not (COMFY/'Input'/s[key]).is_file():missing.append(s[key])
 assert not missing,(path,missing)
 assert len(t['segments'])==len(oldtimeline['segments'])
 ids={n['id'] for n in updated['nodes']};linkids={l[0] for l in updated['links']}
 assert len(ids)==len(updated['nodes'])
 for link in updated['links']:assert link[1] in ids and link[3] in ids
 for node in updated['nodes']:
  for inp in node.get('inputs',[]):assert inp.get('link') is None or inp['link'] in linkids
 for dest in [path,COMFY/'User/default/workflows/Prodigal_Son_Frames_Attached'/path.name]:write(dest,updated)
 outputs.append(path)
 if num==1:
  for dest in [BASE/'Scene_01_Temple_Director_Per_Segment_Voices.json',COMFY/'User/default/workflows/Prodigal_Son_Frames_Attached/Scene_01_Temple_Director_Per_Segment_Voices.json',Path('D:/Data/Downloads/Scene_01_Temple_Director_Per_Segment_Voices.json')]:write(dest,updated)
 report.append({'scene':num,'file':path.name,'segments':len(t['segments']),'seconds':max(s['start']+s['length'] for s in t['segments'])/24,'voiceEnabled':enabled,'issues':issues})
summary={'template':str(TEMPLATE),'scenes':report,'voiceSources':voice_sources,'jesusSource':'D:/Media/Generated/ComfyUI-Audio-Gen/JESUS.flac','validation':'Prompts, timing and frame bindings preserved; referenced input files exist; graph links resolve. No generations queued.'}
(BASE/'all-scenes-update-report.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
readme='All 22 scenes updated from the supplied Scene 1 template.\nUse Queue Segments or Queue Selected for per-segment voices.\nMulti-speaker segments are listed in the report and in each workflow note; their voice reference remains Off.\nReload workflows from disk. Restart ComfyUI after current jobs finish if the Director Python update has not been loaded.\n'
zip_path=Path('D:/Data/Downloads/Prodigal_Son_All_22_Scenes_Updated.zip')
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
 for p in outputs:z.write(p,p.name)
 z.write(BASE/'all-scenes-update-report.json','all-scenes-update-report.json');z.writestr('README.txt',readme)
print(json.dumps({'scenes':len(report),'segments':sum(r['segments'] for r in report),'voiceEnabled':sum(r['voiceEnabled'] for r in report),'issues':[{'scene':r['scene'],**i} for r in report for i in r['issues']],'zip':str(zip_path)},indent=2))
