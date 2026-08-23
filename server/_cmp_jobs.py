
import json, urllib.request

def load(pid):
    with urllib.request.urlopen("http://127.0.0.1:8188/history/" + pid, timeout=10) as r:
        h = json.loads(r.read().decode())
    item = h.get(pid) or {}
    prompt = item.get("prompt")
    graph = None
    if isinstance(prompt, list):
        for part in prompt:
            if isinstance(part, dict) and any(isinstance(v, dict) and v.get("class_type") for v in part.values()):
                graph = part
                break
    st = item.get("status") or {}
    print("====", pid[:8], st.get("status_str"), "completed", st.get("completed"))
    if not graph:
        print("no graph")
        return
    for nid in ("380", "376", "393", "387", "75", "366"):
        node = graph.get(nid)
        if not node:
            continue
        inp = dict(node.get("inputs") or {})
        if "prompt" in inp and isinstance(inp["prompt"], str):
            inp["prompt"] = f"<{len(inp['prompt'])} chars>"
        if "value" in inp and isinstance(inp["value"], str) and len(inp["value"]) > 80:
            inp["value"] = f"<{len(inp['value'])} chars>"
        print(nid, node.get("class_type"), inp)

# latest history
with urllib.request.urlopen("http://127.0.0.1:8188/history?max_items=8", timeout=15) as r:
    h = json.loads(r.read().decode())
rows = []
for pid, item in h.items():
    num = None
    prompt = item.get("prompt")
    if isinstance(prompt, list) and prompt:
        num = prompt[0]
    rows.append((num, pid, (item.get("status") or {}).get("status_str")))
rows.sort(key=lambda x: (x[0] is None, -(x[0] or 0)))
print("recent", rows[:8])
for num, pid, status in rows[:6]:
    load(pid)
