from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
needle = '  if (prompt["380"]?.inputs && "prompt" in prompt["380"].inputs) prompt["380"].inputs.prompt = text;'
add = needle + '''
  if (prompt["380"]?.inputs && prompt["380"].inputs.sampling_mode == null) {
    prompt["380"].inputs.sampling_mode = "off";
  }'''
if 'sampling_mode = "off"' in t:
    print('already')
elif needle not in t:
    raise SystemExit('needle missing')
else:
    p.write_text(t.replace(needle, add, 1), encoding='utf-8')
    print('sampling off')
