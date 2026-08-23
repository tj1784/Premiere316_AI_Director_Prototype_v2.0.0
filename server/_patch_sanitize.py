from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
needle = '  if (prompt["380"]?.inputs && "prompt" in prompt["380"].inputs) prompt["380"].inputs.prompt = text;'
insert = '''  if (prompt["380"]?.inputs && "prompt" in prompt["380"].inputs) prompt["380"].inputs.prompt = text;
  const clipFallback = "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors";
  const scaleOk = new Set(["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]);
  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs;
    if (!inputs) continue;
    if (node.class_type === "CLIPLoader" && inputs.clip_name === "gemma4_e2b_it_bf16.safetensors") {
      inputs.clip_name = clipFallback;
    }
    if (node.class_type === "ResizeImageMaskNode" && inputs.scale_method && !scaleOk.has(String(inputs.scale_method))) {
      inputs.scale_method = "lanczos";
    }
  }'''
if 'clipFallback' in t:
    print('already sanitized')
elif needle not in t:
    raise SystemExit('needle missing')
else:
    t = t.replace(needle, insert, 1)
    p.write_text(t, encoding='utf-8')
    print('sanitized')
