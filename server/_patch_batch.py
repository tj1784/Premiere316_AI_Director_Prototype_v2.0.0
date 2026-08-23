from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
needle = '    if (node.class_type === "CLIPLoader" && inputs.clip_name === "gemma4_e2b_it_bf16.safetensors") {'
insert = '''    if (node.class_type === "LTXVEmptyLatentAudio") {
      inputs.batch_size = 1;
    }
    if (node.class_type === "CLIPLoader" && inputs.clip_name === "gemma4_e2b_it_bf16.safetensors") {'''
if 'LTXVEmptyLatentAudio' in t and 'batch_size = 1' in t:
    print('already')
elif needle not in t:
    raise SystemExit('needle missing')
else:
    p.write_text(t.replace(needle, insert, 1), encoding='utf-8')
    print('batch pinned')
