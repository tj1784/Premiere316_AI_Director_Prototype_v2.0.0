
import json, urllib.request
pid = "123aaf44-3498-4a86-9e27-9c615dfde2f0"
with urllib.request.urlopen("http://127.0.0.1:8188/history/" + pid, timeout=10) as r:
    h = json.loads(r.read().decode())
item = h.get(pid) or {}
st = item.get("status") or {}
print("status", st.get("status_str"), st.get("completed"))
for m in st.get("messages") or []:
    if not isinstance(m, list):
        continue
    print("msg", m[0])
    if m[0] == "execution_error":
        d = m[1] or {}
        print("node", d.get("node_id"), d.get("node_type"))
        print("ex", d.get("exception_type"))
        print("err", d.get("exception_message"))
