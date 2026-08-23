from pathlib import Path
p = Path(r'C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js')
t = p.read_text(encoding='utf-8')
old = '    if (node.class_type === "LTXVEmptyLatentAudio") inputs.batch_size = 1;\n  }\n  return { prompt, nodeCount: Object.keys(prompt).length, warnings: converted.warnings };\n}'
new = '''    if (node.class_type === "LTXVEmptyLatentAudio") inputs.batch_size = 1;
  }
  for (const id of Object.keys(prompt)) {
    if (prompt[id]?.class_type === "TextGenerateLTX2Prompt") delete prompt[id];
  }
  const sw = nodeByIds(prompt, ["398:382", "382"]);
  if (sw?.inputs) {
    sw.inputs.on_true = ["398:376", 0];
    sw.inputs.on_false = ["398:376", 0];
  }
  return { prompt, nodeCount: Object.keys(prompt).length, warnings: converted.warnings };
}'''
if 'TextGenerateLTX2Prompt") delete' in t or "delete prompt[id]" in t:
    print('already')
elif old not in t:
    raise SystemExit('missing')
else:
    p.write_text(t.replace(old, new, 1), encoding='utf-8')
    print('stripped')
