"""Attach audited dialogue references without rebuilding any workflow graph."""
from pathlib import Path
import copy
import datetime
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'projects/the_prodigal_son/workflows/LTX_frames_attached'
COMFY = Path('D:/AI/ComfyUI/Data/LTX2.5')
SAVED = COMFY / 'User/default/workflows/Prodigal_Son_Frames_Attached'
DOWNLOADS = Path('D:/Data/Downloads')
STAMP = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
BACKUP = ROOT / f'projects/the_prodigal_son/backups/script-voices-{STAMP}'
VOICE_KEYS = {'speaker', 'voiceReferenceEnabled', 'voiceReferenceFile'}
audit = json.loads((BASE / 'voice-dialogue-audit.json').read_text(encoding='utf-8'))


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


by_prompt = {}
for entry in audit['segments']:
    old = by_prompt.setdefault(entry['promptSha256'], entry)
    assert old['speakers'] == entry['speakers'], entry['file']

voice_files = {
    p.name.removesuffix('-reference.flac'): p.relative_to(COMFY / 'Input').as_posix()
    for p in (COMFY / 'Input/prodigal_son/voices').glob('*-reference.flac')
}
voice_files['JESUS'] = 'voices/shared/JESUS.flac'
assert (COMFY / 'Input/voices/shared/JESUS.flac').read_bytes() == Path(
    'D:/Media/Generated/ComfyUI-Audio-Gen/JESUS.flac').read_bytes()

# A second native Director draft uses first/last-frame markers rather than full shots.
# Its script was reviewed separately; preserve that older 52-second layout exactly.
alternate18 = DOWNLOADS / 'PS-S18_Unsaved_Workflow_4.json'
if alternate18.is_file():
    alternate_data = json.loads(alternate18.read_text(encoding='utf-8-sig'))
    alternate_director = next(n for n in alternate_data['nodes'] if n['type'] == 'LTXDirector')
    alternate_timeline = json.loads(alternate_director['widgets_values'][6])
    assert len(alternate_timeline['segments']) == 16
    for index, segment in enumerate(alternate_timeline['segments'], 1):
        speaker = {11: 'YOUNGER', 13: 'FATHER'}.get(index)
        prompt = segment.get('prompt', '')
        if index == 11:
            assert 'Father, I have sinned against heaven' in prompt
        elif index == 13:
            assert 'Bring the best robe and put it on him.' in prompt
        else:
            assert not prompt or 'no dialogue' in prompt
        by_prompt[digest(prompt)] = {'speakers': [speaker] if speaker else []}


def without_voices(timeline):
    result = copy.deepcopy(timeline)
    for segment in result['segments']:
        for key in VOICE_KEYS:
            segment.pop(key, None)
    return result


def write(path, data):
    original = path.read_bytes()
    BACKUP.mkdir(parents=True, exist_ok=True)
    backup_name = digest(str(path))[:12] + '-' + path.name
    shutil.copy2(path, BACKUP / backup_name)
    output = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    temporary = path.with_name(path.name + '.voice-update.tmp')
    temporary.write_text(output, encoding='utf-8')
    temporary.replace(path)
    assert json.loads(path.read_text(encoding='utf-8')) == data
    return {'file': str(path), 'backup': backup_name,
            'beforeSha256': hashlib.sha256(original).hexdigest(),
            'afterSha256': hashlib.sha256(path.read_bytes()).hexdigest()}


paths = sorted({BASE / entry['file'] for entry in audit['segments']})
paths += [SAVED / p.relative_to(BASE) for p in list(paths)
          if (SAVED / p.relative_to(BASE)).is_file()]
paths += [DOWNLOADS / 'Scene_18_The_father_runs.json']
if alternate18.is_file():
    paths.append(alternate18)
report = {'generatedAt': datetime.datetime.now().isoformat(), 'files': [],
          'modified': [], 'unknownPrompts': [], 'voiceFiles': voice_files,
          'beforeCanonicalCounts': audit['canonicalCounts']}
for path in paths:
    original = json.loads(path.read_text(encoding='utf-8-sig'))
    data = copy.deepcopy(original)
    directors = [n for n in data.get('nodes', []) if n['type'] == 'LTXDirector']
    if not directors:
        continue
    counts = {'singleSpeaker': 0, 'mixedSpeakers': 0, 'noSoloReference': 0}
    issues = []
    for director in directors:
        timeline = json.loads(director['widgets_values'][6])
        before = copy.deepcopy(timeline)
        for index, segment in enumerate(timeline['segments'], 1):
            entry = by_prompt.get(digest(segment.get('prompt', '')))
            if entry is None:
                report['unknownPrompts'].append({'file': str(path), 'segment': index})
                continue
            speakers = entry['speakers']
            segment.update(speaker='', voiceReferenceEnabled=False, voiceReferenceFile='')
            if len(speakers) == 1:
                voice = voice_files[speakers[0]]
                assert (COMFY / 'Input' / voice).is_file(), voice
                segment.update(speaker=speakers[0], voiceReferenceEnabled=True,
                               voiceReferenceFile=voice)
                counts['singleSpeaker'] += 1
            elif len(speakers) > 1:
                counts['mixedSpeakers'] += 1
                issues.append({'segment': index, 'speakers': speakers})
            else:
                counts['noSoloReference'] += 1
        assert without_voices(before) == without_voices(timeline), path
        serialized = json.dumps(timeline, ensure_ascii=False, separators=(',', ':'))
        director['widgets_values'][6] = serialized
        director.setdefault('properties', {})['timeline_data'] = serialized
        director.setdefault('widgets_values_named', {})['timeline_data'] = serialized
    # The old optional global reference would override the Director's speaker.
    # Keep its wiring intact while leaving reference selection to each segment.
    for node in data['nodes']:
        title = node.get('title', '')
        if node['type'] == 'PrimitiveBoolean' and title.startswith('VOICE REFERENCE:'):
            node['widgets_values'][0] = False
        if node['type'] == 'MarkdownNote' and (
                title.startswith('VOICE REFERENCES') or title == 'USING THE VOICE REFERENCE'):
            text = ('Voice references are attached beside First frame / Last frame on each '
                    'Director segment. Use Queue Selected, Queue Segments, or Generate All Stage1 '
                    'for individual voices. Jesus uses the exact shared JESUS.flac master. '
                    'Segments without solo dialogue have voice reference Off. '
                    'The legacy global voice switch, if present, stays Off to preserve each speaker.\n\n')
            text += '\n'.join(f"Segment {i['segment']}: {', '.join(i['speakers'])}. "
                              'Multiple speakers need separate speaker segments; reference remains Off.'
                              for i in issues) or 'All named single-speaker dialogue has a voice reference.'
            node['widgets_values'] = [text]
    # Everything outside the voice fields, old voice switch and reference notes must remain exact.
    normalized = copy.deepcopy(data)
    for new, old in zip(normalized['nodes'], original['nodes']):
        if new['type'] == 'LTXDirector':
            new['widgets_values'][6] = old['widgets_values'][6]
            for key in ('properties', 'widgets_values_named'):
                if key not in old:
                    new.pop(key, None)
                elif 'timeline_data' in old[key]:
                    new[key]['timeline_data'] = old[key]['timeline_data']
                else:
                    new[key].pop('timeline_data', None)
        elif new['type'] == 'PrimitiveBoolean' and new.get('title', '').startswith('VOICE REFERENCE:'):
            new['widgets_values'] = old['widgets_values']
        elif new['type'] == 'MarkdownNote' and (new.get('title', '').startswith('VOICE REFERENCES')
                                                or new.get('title') == 'USING THE VOICE REFERENCE'):
            new['widgets_values'] = old['widgets_values']
    assert normalized == original, path
    if data != original:
        report['modified'].append(write(path, data))
    report['files'].append({'file': str(path), **counts, 'mixedDialogue': issues})

assert not report['unknownPrompts'], report['unknownPrompts']
canonical_names = {entry['file'] for entry in audit['segments'] if entry['canonicalSceneWorkflow']}
canonical_files = [entry for entry in report['files']
                   if Path(entry['file']).parent == BASE and Path(entry['file']).name in canonical_names]
report['canonicalCounts'] = {
    'scenes': len(canonical_files),
    'singleSpeakerReferencesEnabled': sum(entry['singleSpeaker'] for entry in canonical_files),
    'mixedSpeakerSegmentsAwaitingSplit': sum(entry['mixedSpeakers'] for entry in canonical_files),
    'noSoloReferenceRequired': sum(entry['noSoloReference'] for entry in canonical_files),
}
report_path = BASE / 'script-voice-update-report.json'
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
BACKUP.mkdir(parents=True, exist_ok=True)
(BACKUP / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
zip_path = DOWNLOADS / 'Prodigal_Son_All_Scenes_Voice_References.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in paths:
        if path.is_relative_to(BASE):
            archive.write(path, path.relative_to(BASE).as_posix())
        elif path == alternate18:
            archive.write(path, 'Alternate_Scene_18/' + path.name)
    archive.write(report_path, report_path.name)
    archive.write(BASE / 'voice-dialogue-audit.json', 'voice-dialogue-audit.json')
    archive.writestr('README.txt', 'All named single-speaker dialogue references are attached.\n'
                     'Mixed-dialogue segments remain Off until split into speaker segments; see report.\n'
                     'Reload saved workflows to see the updates. No generation has been queued.\n')
print(json.dumps({'checkedFiles': len(report['files']), 'modifiedFiles': len(report['modified']),
                  'canonicalCounts': report['canonicalCounts'], 'backup': str(BACKUP),
                  'zip': str(zip_path)}, indent=2))
