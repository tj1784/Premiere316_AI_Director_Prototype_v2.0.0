"""Premiere316 MiniMax Music3 JSONL worker.

Fail-closed Wave 6 score adapter. Never contacts the network or Comfy.
"""
from __future__ import annotations

import json
import os
import sys

PROTOCOL_VERSION = "premiere316.music3-jsonl.v1"
REASON = (
    "MiniMax Music3 is not a verified local Premiere316 runtime. Score generation "
    "stays fail-closed. Import or write cue metadata instead."
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
        emit({"id": msg_id, "ok": True, "loaded": False, "engine": "minimax-music3", "workerProtocolVersion": PROTOCOL_VERSION, "officialRuntime": False})
        return
    if method == "release":
        emit({"id": msg_id, "ok": True, "released": True, "loaded": False})
        return
    if method == "generate":
        emit({"id": msg_id, "ok": False, "code": "ADAPTER_UNAVAILABLE", "error": REASON, "engine": "minimax-music3"})
        return
    emit({"id": msg_id, "ok": False, "code": "UNKNOWN_METHOD", "error": "Unsupported Music3 worker method"})


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        handle(json.loads(line))
    except Exception as exc:
        emit({"ok": False, "code": exc.__class__.__name__, "error": str(exc)})
