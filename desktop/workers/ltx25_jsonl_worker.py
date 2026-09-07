"""Premiere316 LTX 2.5 JSONL worker.

Fail-closed Wave 5 adapter. It never contacts the network, never uses Comfy
graph runtimes, and never pretends a still image is video.
"""
from __future__ import annotations

import json
import os
import sys

PROTOCOL_VERSION = "premiere316.ltx25-jsonl.v1"
REASON = (
    "LTX 2.5 components may be catalogued, but Premiere316 has no official non-Comfy "
    "native LTX 2.5 worker. Comfy-converted transformers are not used."
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
        emit({"id": msg_id, "ok": True, "loaded": False, "engine": "ltx-2", "workerProtocolVersion": PROTOCOL_VERSION, "officialRuntime": False})
        return
    if method == "release":
        emit({"id": msg_id, "ok": True, "released": True, "loaded": False})
        return
    if method == "generate":
        emit({"id": msg_id, "ok": False, "code": "ADAPTER_UNAVAILABLE", "error": REASON, "engine": "ltx-2"})
        return
    emit({"id": msg_id, "ok": False, "code": "UNKNOWN_METHOD", "error": "Unsupported LTX 2.5 worker method"})


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        handle(json.loads(line))
    except Exception as exc:
        emit({"ok": False, "code": exc.__class__.__name__, "error": str(exc)})
