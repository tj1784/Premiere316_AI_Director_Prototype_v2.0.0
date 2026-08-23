from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
old = '  if (image?.inputs && options.imageFile) image.inputs.image = String(options.imageFile);'
new = '  const imageName = String(options.imageFile || "").trim();\n  if (image?.inputs && imageName && !/[\\/]/.test(imageName)) image.inputs.image = imageName;'
if '![\\/]/.test(imageName)' in t or '!/[\\/]/.test(imageName)' in t:
    print('already')
elif old not in t:
    raise SystemExit('missing')
else:
    p.write_text(t.replace(old, new, 1), encoding='utf-8')
    print('guarded')
