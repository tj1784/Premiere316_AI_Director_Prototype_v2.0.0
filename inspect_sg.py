import json
p=r'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Shared Imports\LTX\2.5\ltx25BasicWorkflowT2V_v10.json'
w=json.load(open(p,encoding='utf-8'))
for sg in w['definitions']['subgraphs']:
    print('====', sg.get('id'), sg.get('name'))
    print(' version', sg.get('version'), 'revision', sg.get('revision'))
    extra=sg.get('extra') or {}
    print(' extra', list(extra.keys())[:25])
    if extra:
        print(' extra.sample', {k: extra[k] for k in list(extra)[:8]})
    types=sorted({n.get('type') for n in (sg.get('nodes') or [])})
    print(' inner', types)
print('workflow extra keys', list((w.get('extra') or {}).keys())[:30])
print('workflow version', w.get('version'), 'revision', w.get('revision'))
