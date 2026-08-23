from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
old = '''    if (node.class_type === "ResizeImageMaskNode" && inputs.scale_method && !scaleOk.has(String(inputs.scale_method))) {
      inputs.scale_method = "lanczos";
    }'''
new = '''    if (node.class_type === "ResizeImageMaskNode") {
      inputs.resize_type = "scale longer dimension";
      inputs.longer_size = 1536;
      inputs.scale_method = "lanczos";
    }'''
if old not in t:
    raise SystemExit('resize block missing')
p.write_text(t.replace(old, new, 1), encoding='utf-8')
print('resized mapping')
