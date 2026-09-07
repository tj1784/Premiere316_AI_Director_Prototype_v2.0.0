"""Premiere316 Qwen3-TTS JSONL worker.

Fail-closed Wave 6 adapter. Never contacts the network, never uses Comfy,
and never pretends silence or a fixture WAV is generated speech.
"""
from __future__ import annotations

import json
import os
import sys

PROTOCOL_VERSION = "premiere316.qwen3-tts-jsonl.v1"
REASON = (
    "Qwen3-TTS is the preferred local voice engine, but no app-owned official native "
    "Qwen3-TTS runtime is verified. Cloud TTS is forbidden."
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
        emit({"id": msg_id, "ok": True, "loaded": False, "engine": "qwen3-tts", "workerProtocolVersion": PROTOCOL_VERSION, "officialRuntime": False})
        return
    if method == "release":
        emit({"id": msg_id, "ok": True, "released": True, "loaded": False})
        return
    if method == "generate":
        emit({"id": msg_id, "ok": False, "code": "ADAPTER_UNAVAILABLE", "error": REASON, "engine": "qwen3-tts"})
        return
    emit({"id": msg_id, "ok": False, "code": "UNKNOWN_METHOD", "error": "Unsupported Qwen3-TTS worker method"})


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        handle(json.loads(line))
    except Exception as exc:
        emit({"ok": False, "code": exc.__class__.__name__, "error": str(exc)})
