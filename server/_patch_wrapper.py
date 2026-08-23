from pathlib import Path
p = Path(r"C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js")
t = p.read_text(encoding="utf-8")
needle = """  const prompt = converted.prompt;
  if (prompt[\"376\"]?.inputs && \"value\" in prompt[\"376\"].inputs) prompt[\"376\"].inputs.value = text;"""
insert = """  const wrap = (graph.nodes || []).find((n) => Number(n.id) === 398);
  const wv = Array.isArray(wrap?.widgets_values) ? wrap.widgets_values : [];
  const seconds = Number(wv[2]);
  const width = Number(wv[3]);
  const height = Number(wv[4]);
  const fps = Number(wv[6]);
  const prompt = converted.prompt;
  if (prompt[\"372\"]?.inputs && Number.isFinite(width)) prompt[\"372\"].inputs.value = width;
  if (prompt[\"360\"]?.inputs && Number.isFinite(height)) prompt[\"360\"].inputs.value = height;
  if (prompt[\"362\"]?.inputs && Number.isFinite(seconds)) prompt[\"362\"].inputs.value = seconds;
  if (prompt[\"361\"]?.inputs && Number.isFinite(fps)) prompt[\"361\"].inputs.value = fps;
  if (prompt[\"376\"]?.inputs && \"value\" in prompt[\"376\"].inputs) prompt[\"376\"].inputs.value = text;"""
if "prompt[\"372\"]?.inputs" in t:
    print("already")
elif needle not in t:
    raise SystemExit("needle missing")
else:
    p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    print("wrapper stamped")
