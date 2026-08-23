from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
needle = '    if (node.class_type === "LTXVEmptyLatentAudio") {'
insert = '''    if (node.class_type === "SaveVideo") {
      if (inputs.codec == null) inputs.codec = "auto";
      if (inputs.format == null) inputs.format = "auto";
    }
    if (node.class_type === "LTXVEmptyLatentAudio") {'''
if 'class_type === "SaveVideo"' in t:
    print('already')
elif needle not in t:
    raise SystemExit('needle missing')
else:
    p.write_text(t.replace(needle, insert, 1), encoding='utf-8')
    print('codec defaulted')
