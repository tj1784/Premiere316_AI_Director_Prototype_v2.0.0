"""Validate and append the supplied scene package; never approve or generate media."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scene1_importer', ROOT / 'scripts/import-prodigal-scene1.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
archive = Path(r'C:\Users\teeja\Downloads\Prodigal_Son_Scene_01_3m30_Replacement.zip')
digest, files = module.read_archive(archive)
scene, outputs, documents = module.validate_scene(files, digest)
stage = ROOT / 'projects/the_prodigal_son/imports/scene1-3m30-20260918'
comfy_input = Path(r'D:\AI\ComfyUI\Data\LTX2.5\Input')
destinations = {stage / name: data for name, data in files.items()}
destinations.update({ROOT / module.PUBLIC_PATH / name: data for name, data in outputs.items()})
destinations.update({comfy_input / name.removeprefix('input/'): data for name, data in files.items() if name.startswith('input/')})
for target, data in destinations.items():
    if not any(target.resolve().is_relative_to(base.resolve()) for base in [stage, ROOT/module.PUBLIC_PATH, comfy_input]):
        raise ValueError(f'Unsafe destination: {target}')
    if target.exists() and target.read_bytes() != data:
        raise ValueError(f'Existing asset differs; preserve it and resolve first: {target}')
for target, data in destinations.items():
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with target.open('xb') as stream:
            stream.write(data)
    assert module.digest(target.read_bytes()) == module.digest(data)
payload = {'archiveSha256': digest, 'scene': scene, 'documents': documents,
           'workflowSource': str(stage / 'Scene_01_Temple_and_the_Gathering_Varied_Angles.json')}
(stage/'validated-replacement.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'stage': str(stage), 'sceneSegments': len(scene['segments']),
                  'seconds': scene['generationDurationSeconds'], 'immutableFilesVerified': len(destinations)}, indent=2))
