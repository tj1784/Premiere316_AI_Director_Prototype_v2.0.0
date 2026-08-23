import json
p=r'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Shared Imports\LTX\2.5\ltx25BasicWorkflowT2V_v10.json'
w=json.load(open(p,encoding='utf-8'))
nv=(w.get('extra') or {}).get('node_versions')
print(type(nv), len(nv) if hasattr(nv,'__len__') else None)
if isinstance(nv, dict):
    for k,v in list(nv.items())[:40]:
        print(k, '=>', v)
    print('--- uuid keys ---')
    for k,v in nv.items():
        if '6f4b715b' in k or 'a4f0a96c' in k or '8dacbcbf' in k or 'b8ad2f51' in k or 'comfy-core' in str(v).lower() or '0.20.1' in str(v):
            print(k, '=>', v)
elif isinstance(nv, list):
    print(nv[:20])
else:
    print(nv)
