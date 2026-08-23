from pathlib import Path
p = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\server\index.js")
t = p.read_text(encoding="utf-8")
a = 'const { queueHellFromPremiere } = await import("./hell-comfy-push.js");'
b = 'const { queueHellFromPremiere } = await import("./hell-comfy-push.js?t=" + Date.now());'
if a not in t:
    raise SystemExit("import line not found")
p.write_text(t.replace(a, b, 1), encoding="utf-8")
print("index import cache-bust ok")
