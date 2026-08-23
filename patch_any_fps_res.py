import json, copy
from pathlib import Path

DST = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\LTX_2.5_Harrowing_FPS_RES_LOCK.json")
w = json.loads(DST.read_text(encoding="utf-8"))
nodes = {n["id"]: n for n in w["nodes"]}
links_by_id = {L[0]: L for L in (w.get("links") or [])}
w["last_link_id"] = int(w.get("last_link_id") or 0)
w["last_node_id"] = int(w.get("last_node_id") or 0)

def nid():
    w["last_node_id"] += 1
    return w["last_node_id"]

def lid():
    w["last_link_id"] += 1
    return w["last_link_id"]

def get_input(node, name):
    for inp in node.get("inputs") or []:
        if inp.get("name") == name:
            return inp
    return None

def drop_link(link_id):
    if not link_id:
        return
    L = links_by_id.pop(link_id, None)
    if not L:
        return
    src = nodes.get(L[1])
    if src:
        for o in src.get("outputs") or []:
            if o.get("links") and link_id in o["links"]:
                o["links"] = [x for x in o["links"] if x != link_id]
    w["links"] = [x for x in w["links"] if x[0] != link_id]

def connect(src_id, src_slot, dst_id, input_name, ltype="INT"):
    dst = nodes[dst_id]
    inp = get_input(dst, input_name)
    if inp is None:
        inp = {"name": input_name, "type": ltype, "link": None}
        dst.setdefault("inputs", []).append(inp)
    if inp.get("link") is not None:
        drop_link(inp["link"])
    new_id = lid()
    src = nodes[src_id]
    out = src["outputs"][src_slot]
    if out.get("links") is None:
        out["links"] = []
    out["links"].append(new_id)
    inp["link"] = new_id
    L = [new_id, src_id, src_slot, dst_id, dst["inputs"].index(inp), ltype]
    w["links"].append(L)
    links_by_id[new_id] = L
    return new_id

def clone_int(template_id, new_id, pos, title, value):
    n = copy.deepcopy(nodes[template_id])
    n["id"] = new_id
    n["pos"] = pos
    n["title"] = title
    n["widgets_values"] = [value]
    n["flags"] = {}
    n["mode"] = 0
    n["order"] = 210
    for inp in n.get("inputs") or []:
        inp["link"] = None
    for o in n.get("outputs") or []:
        o["links"] = []
    nodes[new_id] = n
    w["nodes"].append(n)
    return n

def clone_calc(template_id, new_id, pos, expression, title):
    n = copy.deepcopy(nodes[template_id])
    n["id"] = new_id
    n["pos"] = pos
    n["title"] = title
    n["widgets_values"] = [expression]
    n["flags"] = {"collapsed": False}
    n["mode"] = 0
    n["order"] = 211
    for inp in n.get("inputs") or []:
        inp["link"] = None
    for o in n.get("outputs") or []:
        o["links"] = []
    nodes[new_id] = n
    w["nodes"].append(n)
    return n

# live knobs
nodes[5036]["title"] = "Seconds  (any)"
nodes[5329]["title"] = "FPS  (any)"

# Final W/H — user-facing, any integer
base = nodes[5036]["pos"]
fw = nid(); fh = nid()
clone_int(5036, fw, [base[0], base[1] + 90], "Final Width  (any)", 720)
clone_int(5036, fh, [base[0], base[1] + 160], "Final Height  (any)", 480)

# Stage-1 latent = half of final, snap 32, min 64
# 32 * max(2, round(a/64))
sw = nid(); sh = nid()
expr = "32 * max(2, round(a / 64))"
clone_calc(5585, sw, [base[0] + 320, base[1] + 90], expr, "Stage-1 width (half, snap 32)")
clone_calc(5585, sh, [base[0] + 320, base[1] + 160], expr, "Stage-1 height (half, snap 32)")
connect(fw, 0, sw, "variables.a", "INT")
connect(fh, 0, sh, "variables.a", "INT")

# Both empty-video latents use stage-1
connect(sw, 1, 5720, "width", "INT")
connect(sh, 1, 5720, "height", "INT")
connect(sw, 1, 5824, "width", "INT")
connect(sh, 1, 5824, "height", "INT")

# Final ImageScale is the exact user size (not forced 2x)
# drop previous 2x calculators 5840/5841 if present
connect(fw, 0, 5835, "width", "INT")
connect(fh, 0, 5835, "height", "INT")
nodes[5835]["title"] = "Final scale (your width x height)"

# mute old 2x nodes so they don't confuse
for old in (5840, 5841):
    if old in nodes:
        nodes[old]["title"] = "UNUSED (old 2x helper)"
        nodes[old]["mode"] = 4

# 5714 is only for reference-image sizing now
if 5714 in nodes:
    nodes[5714]["title"] = "Ref image size (not video res)"

# update note
if 5842 in nodes:
    nodes[5842]["widgets_values"] = [
        "# Any FPS / any resolution\n\n"
        "Set these four:\n"
        "- **Seconds** — any\n"
        "- **FPS** — any (24, 25, 30, 60…)\n"
        "- **Final Width** — any\n"
        "- **Final Height** — any\n\n"
        "Frames snap to `8n+1`. Stage-1 latent is half your size, snapped to 32 "
        "(LTX + the x2 upscaler). Output is your exact width × height × FPS.\n"
        "Keep 9:16 / 16:9 / 3:2 / whatever. Just type it."
    ]
    nodes[5842]["title"] = "Any FPS / any resolution"

extra = w.setdefault("extra", {})
ws = extra.get("workspace_info")
if isinstance(ws, dict):
    ws["name"] = "LTX 2.5 Harrowing any FPS+RES"
else:
    extra["workspace_info"] = {"name": "LTX 2.5 Harrowing any FPS+RES"}

DST.write_text(json.dumps(w, indent=2), encoding="utf-8")
print("updated", DST)
print("Final W/H nodes", fw, fh, "stage1", sw, sh)
