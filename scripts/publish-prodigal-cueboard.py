"""Publish validated Cueboard outputs to active scene folders with reversible backups."""
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT/'projects/the_prodigal_son'
BATCH = PROJECT/'workflows/Cueboard/All_Scenes_20260918'
FOLDERS = [PROJECT/'workflows/LTX_frames_attached', Path(r'D:\AI\ComfyUI\Data\LTX2.5\User\default\workflows\Prodigal_Son_Frames_Attached')]
digest = lambda data: hashlib.sha256(data).hexdigest()
report = json.loads((BATCH/'batch-verification.json').read_text(encoding='utf-8'))
destinations = {}
scene1 = next(item for item in report['workflows'] if item['sceneId']=='PS-S01')
for item in report['workflows']:
    data = Path(item['outputPath']).read_bytes()
    assert digest(data)==item['outputSha256']
    for source in map(Path,item['sources']):
        assert digest(source.read_bytes())==item['sourceSha256'], f'Workflow edited since compilation: {source}'
        if item['sceneId']!='PS-S01':
            assert any(source.resolve().is_relative_to(folder.resolve()) for folder in FOLDERS)
            destinations[source] = data
scene1_data = Path(scene1['outputPath']).read_bytes()
for folder in FOLDERS:
    for source in folder.glob('Scene_01*.json'):
        workflow = json.loads(source.read_text(encoding='utf-8-sig'))
        if any(node.get('type')=='LTXDirector' for node in workflow.get('nodes',[])):
            destinations[source] = scene1_data
    destinations[folder/'Scene_01_Temple_and_the_Gathering_Varied_Angles.json'] = scene1_data
backups = PROJECT/'backups'/('cueboard-all-active-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
backups.mkdir(parents=True,exist_ok=False)
records=[]
for index,(target,data) in enumerate(destinations.items()):
    assert any(target.resolve().parent==folder.resolve() for folder in FOLDERS)
    before=target.read_bytes() if target.exists() else None
    backup=backups/f'{index:03}-{target.name}'
    if before is not None:
        backup.write_bytes(before)
        assert digest(backup.read_bytes())==digest(before)
    records.append({'file':str(target),'backup':str(backup) if before is not None else None,
                    'beforeSha256':digest(before) if before is not None else None,'afterSha256':digest(data)})
(backups/'publication-plan.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
for record,(target,data) in zip(records,destinations.items()):
    assert (digest(target.read_bytes()) if target.exists() else None)==record['beforeSha256'], f'File changed during backup: {target}'
for target,data in destinations.items():
    temporary=target.with_name(target.name+'.cueboard-new')
    with temporary.open('xb') as stream:stream.write(data)
    temporary.replace(target)
    assert digest(target.read_bytes())==digest(data)
result={'activeWorkflowsUpdated':len(records),'scene1AliasesUpdated':sum(Path(r['file']).name.startswith('Scene_01') for r in records),
        'scenes':22,'variants':25,'backup':str(backups),'files':records,'liveAiReviewRun':False,'generationRun':False}
(BATCH/'publication-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='files'},indent=2))
