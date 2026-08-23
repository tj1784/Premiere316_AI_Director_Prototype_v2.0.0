import json, sys
from pathlib import Path
p = Path(sys.argv[1])
w = json.loads(p.read_text(encoding="utf-8"))
nodes = {n["id"]: n for n in w["nodes"]}
links = {L[0]: L for L in (w.get("links") or [])}
def incoming(n):
    out = []
    for inp in n.get("inputs") or []:
        lid = inp.get("link")
        if lid is None: continue
        L = links.get(lid)
        if not L: continue
        src = nodes.get(L[1])
        st = src.get("type") if src else "?"
        out.append((inp.get("name"), L[1], st, L[2]))
    return out
keys = ("fps","frame","width","height","length","second","resol","size","latent","audio","overlap","temporal","scale","duration")
print("FILE", p.name, "nodes", len(nodes))
for n in w["nodes"]:
    t = n.get("type") or ""
    title = n.get("title") or ""
    blob = (t + " " + title + " " + json.dumps(n.get("widgets_values"))).lower()
    interesting = any(k in blob for k in keys) or t in ("EmptyLTXVLatentVideo","LTXVEmptyLatentAudio","VHS_VideoCombine","ImageScale","PrimitiveFloat","INTConstant","SimpleCalculatorKJ","DenoLTXSequencer","LTX25AllModesControlsV2","VAEDecodeTiled","CreateVideo","LTXVConditioning")
    if not interesting: continue
    print()
    print("#%s %s | %s" % (n["id"], t, title))
    print("  widgets", json.dumps(n.get("widgets_values"))[:240])
    ins = incoming(n)
    if ins:
        for name, sid, st, slot in ins:
            print("  in %s from #%s %s slot%s" % (name, sid, st, slot))
    else:
        names = [i.get("name") for i in (n.get("inputs") or []) if i.get("link") is None]
        if names: print("  unlinked", names)
