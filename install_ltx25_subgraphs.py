import json, copy, uuid
from pathlib import Path

src = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Shared Imports\LTX\2.5\ltx25BasicWorkflowT2V_v10.json")
lib = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\subgraphs")
example = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\subgraphs\LTX-2.3 I2V (Blokey edit).json")

w = json.loads(src.read_text(encoding="utf-8"))
ex = json.loads(example.read_text(encoding="utf-8"))
template_node = copy.deepcopy(ex["nodes"][0])

NAMES = {
    "6f4b715b-57d1-40f2-a0c5-e582b57f7b63": "LTX-2.5 Latent Upsampler A",
    "a4f0a96c-34ab-4bc1-a532-a6be4c8d9e8a": "LTX-2.5 Sampler Decode A",
    "8dacbcbf-bec6-4743-a371-ffd0ccaac3b6": "LTX-2.5 Sampler Decode Tiled A",
    "b8ad2f51-a991-4ee3-b5b4-3e65ff2db138": "LTX-2.5 Sampler Decode B",
    "7ff9b43b-55b3-4661-a9b4-4bba94f43567": "LTX-2.5 Sampler Decode C",
    "7b016254-7182-429c-bdb2-fb6ca5cf06b4": "LTX-2.5 Sampler Decode D",
    "891df744-6f5a-4004-b44a-39793a52cdfd": "LTX-2.5 Latent Upsampler B",
    "2d2fc0dd-01bd-478d-812e-42f07e333adc": "LTX-2.5 Sampler Decode Tiled B",
}

written = []
for sg in w["definitions"]["subgraphs"]:
    sid = sg["id"]
    name = NAMES.get(sid, sg.get("name") or f"LTX-2.5 {sid[:8]}")
    sg = copy.deepcopy(sg)
    sg["name"] = name
    node = copy.deepcopy(template_node)
    node["id"] = 1
    node["type"] = sid
    node["title"] = name
    # drop leftover links/widgets from the 2.3 example
    node["inputs"] = []
    node["outputs"] = []
    node["widgets_values"] = []
    out = {
        "id": sid,
        "revision": 0,
        "last_node_id": 1,
        "last_link_id": 0,
        "nodes": [node],
        "links": [],
        "groups": [],
        "definitions": {"subgraphs": [sg]},
        "config": {},
        "extra": {"frontendVersion": (ex.get("extra") or {}).get("frontendVersion")},
        "version": 0.4,
        "name": name,
    }
    dest = lib / f"{name}.json"
    dest.write_text(json.dumps(out, indent=2), encoding="utf-8")
    written.append(dest.name)
    print("wrote", dest.name, "id", sid)

print("done", len(written))
