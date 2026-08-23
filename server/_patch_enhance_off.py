from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
old = '  const token = nodeByIds(prompt, ["398:380", "380"]);\n  if (token?.inputs) token.inputs.thinking = "off";'
new = '''  const enhance = nodeByIds(prompt, ["398:383", "383"]);
  if (enhance?.inputs) enhance.inputs.value = false;
  const token = nodeByIds(prompt, ["398:380", "380"]);
  if (token?.inputs) token.inputs.thinking = false;'''
if 'enhance.inputs.value = false' in t:
    print('already')
elif old not in t:
    raise SystemExit('missing')
else:
    p.write_text(t.replace(old, new, 1), encoding='utf-8')
    print('ok')
