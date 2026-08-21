#!/usr/bin/env python3
"""Pinned, resumable VoiceDesign-only Hugging Face downloader for Premiere316."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Any

from huggingface_hub import HfApi, snapshot_download


OFFICIAL_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
OFFICIAL_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
EXPECTED_PAYLOAD_BYTES = 4_520_163_832
MINIMUM_FREE_BYTES = 1_073_741_824
VERIFIED_WEIGHTS = {
    "model.safetensors": (3_833_402_552, "391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522"),
    "speech_tokenizer/model.safetensors": (682_293_092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"),
}


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def atomic_json(file: Path, value: dict[str, Any]) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, file)


def directory_bytes(root: Path) -> int:
    total = 0
    if not root.exists():
        return total
    for folder, _, files in os.walk(root):
        for name in files:
            try:
                total += (Path(folder) / name).stat().st_size
            except OSError:
                pass
    return total


def safe_payload_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if root != candidate and root not in candidate.parents:
        raise RuntimeError(f"Pinned snapshot path escaped the model directory: {relative}")
    return candidate


def payload_bytes_present(root: Path, siblings: list[Any]) -> int:
    total = 0
    for sibling in siblings:
        size = int(getattr(sibling, "size", 0) or 0)
        file = safe_payload_path(root, str(getattr(sibling, "rfilename", "")))
        try:
            if file.is_file() and file.stat().st_size == size:
                total += size
        except OSError:
            pass
    return total


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_payload(root: Path, siblings: list[Any]) -> tuple[int, int]:
    total = 0
    count = 0
    for sibling in siblings:
        relative = str(getattr(sibling, "rfilename", ""))
        expected_size = int(getattr(sibling, "size", 0) or 0)
        file = safe_payload_path(root, relative)
        if not file.is_file():
            raise RuntimeError(f"Pinned snapshot is missing {relative}")
        actual_size = file.stat().st_size
        if actual_size != expected_size:
            raise RuntimeError(f"Pinned snapshot size mismatch for {relative}: {actual_size} != {expected_size}")
        total += actual_size
        count += 1
    if total != EXPECTED_PAYLOAD_BYTES:
        raise RuntimeError(f"Pinned snapshot payload changed: {total} != {EXPECTED_PAYLOAD_BYTES}")
    for relative, (expected_size, expected_hash) in VERIFIED_WEIGHTS.items():
        file = safe_payload_path(root, relative)
        if file.stat().st_size != expected_size:
            raise RuntimeError(f"Pinned weight size mismatch for {relative}")
        actual_hash = sha256_file(file)
        if actual_hash != expected_hash:
            raise RuntimeError(f"Pinned weight SHA-256 mismatch for {relative}")
    incomplete = list(root.rglob("*.incomplete"))
    if incomplete:
        raise RuntimeError(f"Pinned snapshot still has {len(incomplete)} incomplete download file(s)")
    return count, total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--progress-file", required=True)
    parser.add_argument("--model-id", default=OFFICIAL_MODEL)
    parser.add_argument("--revision", default=OFFICIAL_REVISION)
    args = parser.parse_args()
    if args.model_id != OFFICIAL_MODEL or args.revision != OFFICIAL_REVISION:
        raise SystemExit("Refusing to download an unpinned or non-VoiceDesign model")

    model_dir = Path(args.model_dir).resolve()
    progress_file = Path(args.progress_file).resolve()
    model_dir.mkdir(parents=True, exist_ok=True)
    info = HfApi().model_info(args.model_id, revision=args.revision, files_metadata=True)
    siblings = list(info.siblings)
    total_bytes = sum(int(getattr(sibling, "size", 0) or 0) for sibling in siblings)
    if total_bytes != EXPECTED_PAYLOAD_BYTES:
        raise RuntimeError(f"Pinned Hugging Face payload changed: {total_bytes} != {EXPECTED_PAYLOAD_BYTES}")
    present_bytes = payload_bytes_present(model_dir, siblings)
    remaining_bytes = max(0, total_bytes - present_bytes)
    free_before = shutil.disk_usage(model_dir).free
    projected_free = free_before - remaining_bytes
    if projected_free < MINIMUM_FREE_BYTES:
        raise RuntimeError(
            "Refusing the pinned VoiceDesign download because the model volume "
            f"would fall below the 1 GiB safety floor ({free_before} free, "
            f"{remaining_bytes} remaining, {projected_free} projected)"
        )
    stop = threading.Event()

    def report_loop() -> None:
        while not stop.wait(1.0):
            downloaded = payload_bytes_present(model_dir, siblings)
            value = {
                "status": "downloading",
                "stage": "Downloading pinned Qwen VoiceDesign model",
                "bytesDownloaded": downloaded,
                "totalBytes": total_bytes or None,
                "progress": min(0.99, downloaded / total_bytes) if total_bytes else 0.45,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            atomic_json(progress_file, value)
            emit({"type": "progress", **value})

    thread = threading.Thread(target=report_loop, name="qwen-download-progress", daemon=True)
    thread.start()
    try:
        emit({
            "type": "progress",
            "status": "downloading",
            "stage": "Resolving pinned VoiceDesign snapshot",
            "bytesDownloaded": present_bytes,
            "totalBytes": total_bytes or None,
            "progress": 0.4,
        })
        snapshot_download(
            repo_id=args.model_id,
            revision=args.revision,
            local_dir=str(model_dir),
            local_dir_use_symlinks=False,
            max_workers=1,
        )
    finally:
        stop.set()
        thread.join(timeout=2.0)

    payload_file_count, downloaded = verify_payload(model_dir, siblings)
    free_after = shutil.disk_usage(model_dir).free
    if free_after < MINIMUM_FREE_BYTES:
        raise RuntimeError(f"Pinned model verification left only {free_after} bytes free, below the 1 GiB safety floor")
    complete = {
        "status": "downloaded",
        "stage": "Pinned VoiceDesign snapshot downloaded",
        "bytesDownloaded": downloaded,
        "totalBytes": total_bytes or downloaded,
        "progress": 0.9,
        "payloadFileCount": payload_file_count,
        "postDownloadFreeBytes": free_after,
        "minimumFreeBytes": MINIMUM_FREE_BYTES,
        "mainWeightsSha256": VERIFIED_WEIGHTS["model.safetensors"][1],
        "speechTokenizerWeightsSha256": VERIFIED_WEIGHTS["speech_tokenizer/model.safetensors"][1],
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    atomic_json(progress_file, complete)
    emit({"type": "progress", **complete})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
