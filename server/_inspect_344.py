
import json, urllib.request
from pathlib import Path

hell = json.loads(Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\HARROWING OF HELL.json").read_text(encoding="utf-8"))

def walk(nodes, where):
    for n in nodes or []:
        nid = n.get("id")
        if nid in (344, 351, 356, 361, 362, 366, 376, 380, 393, 395, 396, 397, 398) or n.get("type") in (
            "SamplerCustomAdvanced", "EmptyLTXVLatentVideo", "LTXVEmptyLatentAudio",
            "LTXVLatentSampler", "ManualSigmas"
        ):
            print(where, nid, n.get("type"), str(n.get("widgets_values"))[:220])

walk(hell.get("nodes"), "top")
for sub in (hell.get("definitions") or {}).get("subgraphs") or []:
    walk(sub.get("nodes"), "sub")

# latest failed prompt node 344 inputs + neighbors
with urllib.request.urlopen("http://127.0.0.1:8188/history?max_items=3", timeout=15) as r:
    h = json.loads(r.read().decode())
pid, item = next(iter(h.items()))
prompt = None
raw = item.get("prompt")
if isinstance(raw, list):
    for part in raw:
        if isinstance(part, dict) and "344" in part:
            prompt = part
            break
print("---- prompt 344 ----")
if prompt and "344" in prompt:
    print(json.dumps(prompt["344"], indent=2)[:1500])
    for nid in ("356", "366", "361", "362", "351", "380", "395", "397", "396"):
        if nid in prompt:
            print(nid, prompt[nid].get("class_type"), prompt[nid].get("inputs"))
