"""Premiere316 MiniMax H3 JSONL worker.

Fail-closed Wave 5 adapter. It never contacts the network, never uses Comfy
graph runtimes, and never pretends a still image is video.
"""
from __future__ import annotations

import json
import os
import sys

PROTOCOL_VERSION = "premiere316.minimax-h3-jsonl.v1"
REASON = (
    "MiniMax H3 weights may be present locally, but no app-owned official native H3 "
    "runtime is wired. Comfy-named checkpoints and port 8188 are not an accepted Generate path."
)

for _key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "HF_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY"]:
    os.environ.pop(_key, None)


def emit(record: dict) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle(msg: dict) -> None:
    msg_id = msg.get("id")
    method = msg.get("method")
    if method == "ping":
        emit({"id": msg_id, "ok": True, "loaded": False, "engine": "minimax-h3", "workerProtocolVersion": PROTOCOL_VERSION, "officialRuntime": False})
        return
    if method == "release":
        emit({"id": msg_id, "ok": True, "released": True, "loaded": False})
        return
    if method == "generate":
        emit({"id": msg_id, "ok": False, "code": "ADAPTER_UNAVAILABLE", "error": REASON, "engine": "minimax-h3"})
        return
    emit({"id": msg_id, "ok": False, "code": "UNKNOWN_METHOD", "error": "Unsupported MiniMax H3 worker method"})


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        handle(json.loads(line))
    except Exception as exc:
        emit({"ok": False, "code": exc.__class__.__name__, "error": str(exc)})
