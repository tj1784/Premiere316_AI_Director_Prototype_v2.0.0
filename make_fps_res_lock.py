import json, copy, uuid
from pathlib import Path

SRC = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\LTX_2.5_Need_First_Frame_Node.json")
DST = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\LTX_2.5_Harrowing_FPS_RES_LOCK.json")

w = json.loads(SRC.read_text(encoding="utf-8"))
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
    out.setdefault("links", [])
    if out["links"] is None:
        out["links"] = []
    out["links"].append(new_id)
    inp["link"] = new_id
    L = [new_id, src_id, src_slot, dst_id, None, ltype]
    # dest slot index
    L[4] = dst["inputs"].index(inp)
    w["links"].append(L)
    links_by_id[new_id] = L
    return new_id

def clone_calc(template_id, new_id, pos, expression):
    n = copy.deepcopy(nodes[template_id])
    n["id"] = new_id
    n["pos"] = pos
    n["flags"] = {"collapsed": False}
    n["widgets_values"] = [expression]
    n["title"] = expression
    n["order"] = 200
    for inp in n.get("inputs") or []:
        inp["link"] = None
    for o in n.get("outputs") or []:
        o["links"] = []
    nodes[new_id] = n
    w["nodes"].append(n)
    return n

# --- identity ---
w["id"] = str(uuid.uuid4())
w["revision"] = 0
extra = w.setdefault("extra", {})
ws = extra.get("workspace_info")
if isinstance(ws, dict):
    ws["name"] = "LTX 2.5 Harrowing FPS+RES lock"
else:
    extra["workspace_info"] = {"name": "LTX 2.5 Harrowing FPS+RES lock"}

# --- titles on the three live knobs ---
nodes[5036]["title"] = "Seconds  (change this)"
nodes[5329]["title"] = "FPS  (change this)"
nodes[5714]["title"] = "RESOLUTION stage-1  (final = 2x this)"

# unused second-graph knobs
if 5805 in nodes:
    nodes[5805]["title"] = "UNUSED Seconds (ignored)"
    nodes[5805]["mode"] = 4
if 5798 in nodes:
    nodes[5798]["title"] = "UNUSED FPS (ignored)"
    nodes[5798]["mode"] = 4
if 5818 in nodes:
    nodes[5818]["title"] = "UNUSED Resolution (ignored)"
    nodes[5818]["mode"] = 4

# --- second graph reads the same knobs ---
# Set_fps_0 from main FPS
connect(5329, 0, 5806, "FLOAT", "FLOAT")
# fps_int_0 calculator from main FPS
connect(5329, 0, 5807, "variables.a", "FLOAT")
# frames_0 = 8n+1 from main Seconds * FPS
connect(5036, 0, 5811, "variables.a", "INT")
connect(5329, 0, 5811, "variables.b", "FLOAT")
# second empty latent uses main resolution
connect(5714, 1, 5824, "width", "INT")
connect(5714, 2, 5824, "height", "INT")

# --- final ImageScale follows 2x resolution ---
wid = nid()
hid = nid()
src_pos = nodes[5714].get("pos") or [0, 0]
clone_calc(5585, wid, [src_pos[0] + 420, src_pos[1]], "a*2")
clone_calc(5585, hid, [src_pos[0] + 420, src_pos[1] + 80], "a*2")
nodes[wid]["title"] = "Final width = 2x"
nodes[hid]["title"] = "Final height = 2x"
connect(5714, 1, wid, "variables.a", "INT")
connect(5714, 2, hid, "variables.a", "INT")
connect(wid, 1, 5835, "width", "INT")
connect(hid, 1, 5835, "height", "INT")
nodes[5835]["title"] = "Final scale (auto 2x res)"

# leftover widgets: keep batch 1
if isinstance(nodes[5721].get("widgets_values"), list) and len(nodes[5721]["widgets_values"]) >= 3:
    nodes[5721]["widgets_values"][-1] = 1
if 5825 in nodes and isinstance(nodes[5825].get("widgets_values"), list) and len(nodes[5825]["widgets_values"]) >= 3:
    nodes[5825]["widgets_values"][-1] = 1

# --- fix tiled decode hang in subgraphs ---
for sg in (w.get("definitions") or {}).get("subgraphs") or []:
    for n in sg.get("nodes") or []:
        if n.get("type") == "VAEDecodeTiled":
            wv = n.get("widgets_values")
            if isinstance(wv, list) and len(wv) >= 4 and wv[3] and wv[3] > 64:
                n["widgets_values"][3] = 8

# --- instruction note ---
note_id = nid()
note = {
    "id": note_id,
    "type": "MarkdownNote",
    "pos": [nodes[5036]["pos"][0] - 40, nodes[5036]["pos"][1] - 260],
    "size": [420, 220],
    "flags": {},
    "order": 0,
    "mode": 0,
    "inputs": [],
    "outputs": [],
    "title": "FPS + Resolution lock",
    "properties": {},
    "widgets_values": [
        "# Change only these three\n\n"
        "- **Seconds**\n"
        "- **FPS**\n"
        "- **RESOLUTION stage-1** (final video is 2x this)\n\n"
        "Frames stay `8n+1`. Audio, sequencers, and VHS all read these knobs.\n"
        "The second graph's Seconds/FPS/Resolution nodes are unused.\n"
        "Tiled decode temporal overlap is 8 (was 4096, which hung)."
    ],
    "color": "#232",
    "bgcolor": "#353",
}
w["nodes"].append(note)
nodes[note_id] = note

DST.write_text(json.dumps(w, indent=2), encoding="utf-8")
print("wrote", DST)
print("nodes", len(w["nodes"]), "links", len(w["links"]), "last_node", w["last_node_id"], "last_link", w["last_link_id"])
