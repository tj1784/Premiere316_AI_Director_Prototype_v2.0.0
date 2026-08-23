
import json, urllib.request
pid = "06c6caa4-b6df-44ac-804e-c4cb65ad5523"
with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as r:
    q = json.loads(r.read().decode())
print("running", len(q.get("queue_running") or []), "pending", len(q.get("queue_pending") or []))
for entry in (q.get("queue_running") or []) + (q.get("queue_pending") or []):
    if isinstance(entry, list):
        print("job", entry[0], entry[1])
with urllib.request.urlopen("http://127.0.0.1:8188/history/" + pid, timeout=10) as r:
    h = json.loads(r.read().decode())
item = h.get(pid)
if not item:
    print("18 no history yet")
else:
    st = item.get("status") or {}
    print("18", st.get("status_str"), st.get("completed"))
    for m in st.get("messages") or []:
        if isinstance(m, list) and m[0] == "execution_error":
            d = m[1] or {}
            print("ERR", d.get("node_id"), d.get("node_type"), d.get("exception_message"))
