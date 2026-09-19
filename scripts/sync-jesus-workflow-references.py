from pathlib import Path
import json,hashlib,shutil,datetime,re
import soundfile as sf
root=Path(__file__).resolve().parents[1]
source=Path('D:/Media/Generated/ComfyUI-Audio-Gen/JESUS.flac')
blob=source.read_bytes(); sha=hashlib.sha256(blob).hexdigest(); info=sf.info(source)
backup=root/'projects/voice-reference-update-20260917/files'; backup.mkdir(parents=True,exist_ok=True)
changed=[]; copies=[]
def save(p,data):
 old=p.read_bytes()
 if old==data:return
 b=backup/(hashlib.sha256(str(p).encode()).hexdigest()[:16]+'-'+p.name)
 if not b.exists():b.write_bytes(old)
 p.write_bytes(data);changed.append(str(p))
def copy(p):
 p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():save(p,blob)
 else:p.write_bytes(blob)
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
 copies.append(str(p))
for p in (root/'projects').glob('*/project.json'):
 d=json.loads(p.read_text(encoding='utf-8-sig'))
 assets=(d.get('assets') or {}).get('items',[])
 jesus=[a for a in assets if a.get('category') in ('character','voice') and re.search(r'\bjesus\b',a.get('name',''),re.I)]
 voices=(d.get('sound') or {}).get('voices',[])
 existing=[v for v in voices if re.search(r'\bjesus\b',v.get('speaker','')+' '+v.get('name',''),re.I)]
 if not jesus and not existing and p.parent.name!='the_prodigal_son':continue
 dest=p.parent/'media/assets/voices/shared/JESUS.flac';copy(dest)
 sound=d.setdefault('sound',{'schemaVersion':1,'voices':[],'generations':[]})
 if not existing:
  v={'id':'voice_jesus_'+sha[:16],'speaker':'JESUS','name':'Jesus','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  sound.setdefault('voices',[]).append(v);existing=[v]
 for v in existing:
  v.update(referenceFile='media/assets/voices/shared/JESUS.flac',referenceSha256=sha,sourceFileName='JESUS.flac',contentType='audio/flac',bytes=len(blob),durationSec=info.duration,sampleRate=info.samplerate,channels=info.channels,updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 save(p,(json.dumps(d,ensure_ascii=False,indent=2)+'\n').encode())
input_roots=list(Path('D:/AI/ComfyUI/Data').glob('*/Input'))
for inp in input_roots:copy(inp/'voices/shared/JESUS.flac')
def replace(x):
 if isinstance(x,dict):return {k:replace(v) for k,v in x.items()}
 if isinstance(x,list):return [replace(v) for v in x]
 if isinstance(x,str):
  if x.lstrip().startswith(('{','[')):
   try:
    d=json.loads(x);u=replace(d)
    return json.dumps(u,ensure_ascii=False) if u!=d else x
   except (ValueError,TypeError):pass
  if re.search(r'jesus',x,re.I) and re.search(r'\.(wav|flac|mp3)(?: \[input\])?$',x,re.I) and '\n' not in x and len(x)<400:
   return 'voices/shared/JESUS.flac'
 return x
paths=list((root/'projects').glob('*/workflows/**/*.json'))
paths+=list(Path('D:/AI/ComfyUI/Data').glob('*/User/default/workflows/**/*.json'))
paths+=list(Path('D:/Data/Downloads').glob('Scene_01*.json'))
for p in paths:
 try:d=json.loads(p.read_text(encoding='utf-8-sig'))
 except (ValueError,OSError):continue
 updated=replace(d)
 if updated!=d:save(p,(json.dumps(updated,ensure_ascii=False,indent=2)+'\n').encode())
report={'source':str(source),'sha256':sha,'durationSec':info.duration,'copies':copies,'updatedFiles':changed,'note':'Existing rendered dialogue and historical backups were not regenerated.'}
(backup.parent/'workflow-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
