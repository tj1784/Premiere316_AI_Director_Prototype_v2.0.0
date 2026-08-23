
import json, urllib.request
with urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5) as r:
    q = json.loads(r.read().decode())
print("running", len(q.get("queue_running") or []), "pending", len(q.get("queue_pending") or []))
with urllib.request.urlopen("http://127.0.0.1:8188/history?max_items=15", timeout=15) as r:
    h = json.loads(r.read().decode())
print("history", len(h))
rows = []
for pid, item in h.items():
    st = item.get("status") or {}
    num = None
    prompt = item.get("prompt")
    if isinstance(prompt, list) and prompt:
        num = prompt[0]
    err = None
    for m in st.get("messages") or []:
        if isinstance(m, list) and m[0] == "execution_error":
            d = m[1] or {}
            err = f"{d.get('node_id')} {d.get('node_type')}: {d.get('exception_message')}"
    rows.append((num, pid[:8], st.get("status_str"), st.get("completed"), err))
rows.sort(key=lambda x: (x[0] is None, -(x[0] or 0)))
for row in rows[:15]:
    print(row)
