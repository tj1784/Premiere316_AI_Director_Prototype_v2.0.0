
import json, urllib.request
pid = "fac74b86-0b66-4771-9801-160656b899e7"
with urllib.request.urlopen("http://127.0.0.1:8188/history/" + pid, timeout=10) as r:
    h = json.loads(r.read().decode())
item = h[pid]
prompt = None
raw = item.get("prompt")
if isinstance(raw, list):
    for part in raw:
        if isinstance(part, dict) and any(isinstance(v, dict) and v.get("class_type") for v in part.values()):
            prompt = part
            break
print("node_count", len(prompt))
print("keys", sorted(prompt)[:40], "...", len(prompt))
# class types
from collections import Counter
c = Counter(n.get("class_type") for n in prompt.values())
print("classes", c.most_common(20))
# any 398
for k, n in prompt.items():
    if "398" in str(k) or (n.get("class_type") or "").startswith("6e39"):
        print("HIT", k, n.get("class_type"), str(n.get("inputs"))[:200])
# thinking / sampling
for k, n in prompt.items():
    inp = n.get("inputs") or {}
    if "sampling_mode" in inp or "thinking" in inp:
        print("TOKENNODE", k, n.get("class_type"), {x: inp.get(x) for x in ("sampling_mode", "thinking", "max_length")})
