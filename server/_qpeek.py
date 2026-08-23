
import json, urllib.request
with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as r:
    q = json.loads(r.read().decode())
for kind in ("queue_running", "queue_pending"):
    for entry in q.get(kind) or []:
        if isinstance(entry, list):
            print(kind, entry[0], entry[1])
