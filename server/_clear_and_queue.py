
import json, urllib.request

def post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read().decode()

print("interrupt", post("http://127.0.0.1:8188/interrupt", {}))
print("clear", post("http://127.0.0.1:8188/queue", {"clear": True}))
with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as r:
    q = json.loads(r.read().decode())
print("after", len(q.get("queue_running") or []), len(q.get("queue_pending") or []))
