"""Repair the attached Scene 18 (2), preserving its authored timeline and assets."""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import uuid

ROOT = Path(__file__).resolve().parents[1]
TARGET = Path('D:/Data/Downloads/Scene_18_The_father_runs(2).json')
TEMPLATE = Path('D:/Data/Downloads/Scene_18_The_father_runs.json')
OPTIONS = dict(version=1, distilled=True, tiledDecode=True, unloadVae=False)
ROUTING_ID = 'd7118a16-013c-4d82-9c5c-428ddcab56d6'


def repair(original, template):
    data = copy.deepcopy(original)
    nodes = {node['id']: node for node in data['nodes']}
    source_nodes = {node['id']: node for node in template['nodes']}
    director = nodes[135]
    timeline = json.loads(director['widgets_values'][6])
    assert director['type'] == 'LTXDirector'
    if director.get('properties', {}).get('director_generation_bindings'):
        assert timeline['generationOptions'] == OPTIONS
        return data
    assert not any(n['type'] == 'PrimitiveBoolean' for n in data['nodes'])
    assert nodes[302]['outputs'][0]['links'] == []
    assert [1328, 35, 0, 135, 0, 'MODEL'] in data['links']
    assert 317 not in nodes and 303 not in nodes
    assert all(g['id'] != ROUTING_ID for g in data['definitions']['subgraphs'])

    # Only restore the three promoted scalar ports. Never replace authored stages.
    for node_id, input_name, widget_index in [
        (131, 'distilled_mode', 3), (132, 'distilled_mode', 4), (134, 'tiled_decode', 0)
    ]:
        node = nodes[node_id]
        assert not any(i['name'] == input_name for i in node['inputs'])
        socket = copy.deepcopy(next(i for i in source_nodes[node_id]['inputs'] if i['name'] == input_name))
        assert socket['link'] is None
        node['inputs'].append(socket)
        node['widgets_values'][widget_index] = True
        node['widgets_values_named'][input_name] = True

    # Model selection lives inside a subgraph, with no standalone Boolean control.
    switch = copy.deepcopy(source_nodes[303])
    switch.update(pos=[260, 40], size=[260, 110], order=0,
                  title='Model selection controlled by Director')
    switch['inputs'][0]['link'] = 1
    switch['inputs'][1]['link'] = 2
    switch['outputs'][0]['links'] = [3]
    switch['widgets_values'] = [True]
    switch['widgets_values_named']['switch'] = True
    routing = {
        'id': ROUTING_ID, 'version': 1, 'state': {
            'lastGroupId': 0, 'lastNodeId': 303, 'lastLinkId': 3, 'lastRerouteId': 0
        }, 'revision': 0, 'config': {}, 'name': 'Director model routing',
        'inputNode': {'id': -10, 'bounding': [0, 20, 128, 100]},
        'outputNode': {'id': -20, 'bounding': [620, 40, 128, 80]},
        'inputs': [
            {'id': str(uuid.uuid5(uuid.UUID(ROUTING_ID), name)), 'name': name,
             'type': 'MODEL', 'linkIds': [index + 1], 'pos': [104, 44 + 20 * index]}
            for index, name in enumerate(['dev_model', 'distilled_model'])
        ],
        'outputs': [{'id': str(uuid.uuid5(uuid.UUID(ROUTING_ID), 'model')),
                     'name': 'model', 'type': 'MODEL', 'linkIds': [3], 'pos': [644, 64]}],
        'widgets': [], 'nodes': [switch], 'groups': [],
        'links': [
            {'id': 1, 'origin_id': -10, 'origin_slot': 0, 'target_id': 303, 'target_slot': 0, 'type': 'MODEL'},
            {'id': 2, 'origin_id': -10, 'origin_slot': 1, 'target_id': 303, 'target_slot': 1, 'type': 'MODEL'},
            {'id': 3, 'origin_id': 303, 'origin_slot': 0, 'target_id': -20, 'target_slot': 0, 'type': 'MODEL'},
        ], 'extra': {}
    }
    data['definitions']['subgraphs'].append(routing)
    data['nodes'].append({
        'id': 317, 'type': ROUTING_ID, 'pos': [6058, -500], 'size': [280, 100],
        'flags': {}, 'order': 10, 'mode': 0,
        'inputs': [{'name': 'dev_model', 'type': 'MODEL', 'link': 1329},
                   {'name': 'distilled_model', 'type': 'MODEL', 'link': 1330}],
        'outputs': [{'name': 'model', 'type': 'MODEL', 'links': [1328]}],
        'properties': {'cnr_id': 'comfy-core', 'ver': '0.24.0'}, 'widgets_values': [],
    })
    next(link for link in data['links'] if link[0] == 1328)[1] = 317
    nodes[35]['outputs'][0]['links'].remove(1328)
    nodes[35]['outputs'][0]['links'].append(1329)
    nodes[302]['outputs'][0]['links'].append(1330)
    data['links'].extend([[1329, 35, 0, 317, 0, 'MODEL'], [1330, 302, 0, 317, 1, 'MODEL']])
    data['last_node_id'] = 317
    data['last_link_id'] = 1330

    bindings = copy.deepcopy(source_nodes[135]['properties']['director_generation_bindings'])
    next(b for b in bindings['distilled'] if b['nodeId'] == '303')['nodeId'] = '317:303'
    bindings['ui'] = [b for b in bindings['ui'] if b['nodeId'] != '303']
    director['properties']['director_generation_bindings'] = bindings
    timeline['generationOptions'] = OPTIONS.copy()
    serialized = json.dumps(timeline, ensure_ascii=False, separators=(',', ':'))
    director['widgets_values'][6] = serialized
    director['properties']['timeline_data'] = serialized
    director['widgets_values_named']['timeline_data'] = serialized
    nodes[314]['widgets_values'] = [
        'Use the generation controls on the Director.\n\n'
        'Saved defaults: Unload VAE OFF; Distilled ON; Tiled decode ON.\n'
        'Distilled ON: Dev + distillation LoRA at 1.0, fixed 8/3-step schedules, video/audio CFG 1/1.\n'
        'Distilled OFF: Dev model, 30/8 steps, video/audio CFG 3/7.\n'
        'Tiled ON: video tiles 512px, spatial overlap 64px, temporal 64/8. OFF: standard decode.\n'
        'Unload VAE OFF: no explicit unload after decode; ComfyUI may offload under memory pressure.\n'
        'Model selection is internal to Director model routing. No separate toggle nodes are needed.'
    ]

    old_timeline = json.loads(next(n for n in original['nodes'] if n['id'] == 135)['widgets_values'][6])
    assert {k: v for k, v in timeline.items() if k != 'generationOptions'} == old_timeline
    assert data['definitions']['subgraphs'][:-1] == original['definitions']['subgraphs']
    assert nodes[316] == next(n for n in original['nodes'] if n['id'] == 316)
    assert not any(n['type'] in {'PrimitiveBoolean', 'ComfySwitchNode'} for n in data['nodes'])
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    original = json.loads(TARGET.read_text(encoding='utf-8-sig'))
    template = json.loads(TEMPLATE.read_text(encoding='utf-8-sig'))
    updated = repair(original, template)
    report = {'file': str(TARGET), 'changed': updated != original, 'options': OPTIONS,
              'standaloneToggleNodes': 0, 'preservedMainSegments': 8, 'preservedReferences': 4}
    if args.apply and updated != original:
        backup = ROOT / 'projects/the_prodigal_son/backups' / (
            'scene18-2-director-controls-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True)
        shutil.copy2(TARGET, backup / TARGET.name)
        report['backup'] = str(backup / TARGET.name)
        report['beforeSha256'] = hashlib.sha256(TARGET.read_bytes()).hexdigest()
        temporary = TARGET.with_suffix('.controls.tmp')
        temporary.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(TARGET)
        report['afterSha256'] = hashlib.sha256(TARGET.read_bytes()).hexdigest()
        (backup / 'repair-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        assert json.loads(TARGET.read_text(encoding='utf-8')) == updated
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
