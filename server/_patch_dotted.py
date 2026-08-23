from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
t = t.replace('inputs.longer_size = 1536;', 'inputs["resize_type.longer_size"] = 1536;')
p.write_text(t, encoding='utf-8')
print('ok' if 'resize_type.longer_size' in t else 'fail')
