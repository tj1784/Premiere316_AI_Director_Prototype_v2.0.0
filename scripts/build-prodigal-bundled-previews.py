#!/usr/bin/env python3
"""Serve exact V3 Prodigal frame/director/correction imagery as small WebP previews.

The flat mapping keeps original canonical media URIs untouched. A preview name
includes the SHA-256 of its actual V3 PNG bytes; identical source blobs share it.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/lib/studio/bundled-pictures/prodigal-son"
PREVIEW_ROOT = ROOT / "public/pictures/prodigal-son/previews"
PREVIEW_DIR = PREVIEW_ROOT / "bundled"
MAPPING = PREVIEW_ROOT / "bundled-media-map.json"
GIT_REVISION = "FETCH_HEAD"
MAX_EDGE = 1200
QUALITY = 76
SOURCE_URI = re.compile(r'/pictures/prodigal-son/[^"\s]+?\.png')
TREE_LINE = re.compile(r"^\d+ blob ([a-f0-9]{40,64})\s+(\d+)\t(.+)$")
SOURCE_PREFIX = "/pictures/prodigal-son/"
PREVIEW_PREFIX = SOURCE_PREFIX + "previews/bundled/"


def references() -> list[str]:
    paths = (SOURCE / "frames.ts", SOURCE / "director.ts")
    return sorted(set().union(*(set(SOURCE_URI.findall(path.read_text())) for path in paths)))


def git_tree() -> dict[str, tuple[str, int]]:
    output = subprocess.check_output(
        ["git", "ls-tree", "-r", "-l", GIT_REVISION, "public/pictures/prodigal-son"],
        cwd=ROOT,
        text=True,
    )
    return {
        match.group(3): (match.group(1), int(match.group(2)))
        for line in output.splitlines()
        if (match := TREE_LINE.match(line))
    }


def source_blob(batch: subprocess.Popen[bytes], blob_id: str, expected_bytes: int) -> bytes:
    assert batch.stdin and batch.stdout
    batch.stdin.write(blob_id.encode("ascii") + b"\n")
    batch.stdin.flush()
    header = batch.stdout.readline().strip().split()
    if len(header) != 3 or header[0] != blob_id.encode("ascii") or header[1] != b"blob":
        raise RuntimeError(f"Cannot retrieve exact V3 source blob {blob_id}: {header!r}")
    size = int(header[2])
    if size != expected_bytes:
        raise RuntimeError(f"Source blob changed size: {blob_id}")
    data = batch.stdout.read(size)
    if len(data) != size or batch.stdout.read(1) != b"\n":
        raise RuntimeError(f"Incomplete source blob: {blob_id}")
    return data


def make_preview(raw: bytes, destination: Path) -> None:
    with Image.open(io.BytesIO(raw)) as source:
        source.load()
        if source.format != "PNG":
            raise RuntimeError(f"Expected PNG source for {destination.name}")
        transparent = source.mode in ("RGBA", "LA") or "transparency" in source.info
        preview = source.convert("RGBA" if transparent else "RGB")
        preview.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        if preview.width < 1 or preview.height < 1:
            raise RuntimeError(f"Invalid preview dimensions for {destination.name}")
        options = {"format": "WEBP", "quality": QUALITY, "method": 4}
        if source.info.get("icc_profile"):
            options["icc_profile"] = source.info["icc_profile"]
        temporary = destination.with_suffix(".webp.tmp")
        try:
            preview.save(temporary, **options)
            with Image.open(temporary) as check:
                check.load()
                if check.format != "WEBP" or not check.width or not check.height:
                    raise RuntimeError(f"Invalid encoded WebP: {destination.name}")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)


def main() -> None:
    started = time.monotonic()
    uris = references()
    tree = git_tree()
    missing = [uri for uri in uris if "public" + uri not in tree]
    if missing:
        raise RuntimeError(f"V3 tree missing {len(missing)} exact referenced PNGs: {missing[:8]}")
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    unique: dict[str, tuple[str, str, int]] = {}
    for uri in uris:
        blob_id, byte_count = tree["public" + uri]
        unique.setdefault(blob_id, (uri, blob_id, byte_count))
    print(f"Recovering {len(uris)} exact URIs from {len(unique)} unique V3 source blobs", flush=True)
    blob_preview: dict[str, str] = {}
    batch = subprocess.Popen(
        ["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    )
    try:
        for index, (uri, blob_id, byte_count) in enumerate(unique.values(), start=1):
            raw = source_blob(batch, blob_id, byte_count)
            digest = hashlib.sha256(raw).hexdigest()
            suffix = Path(uri).stem.rsplit("-", 1)[-1]
            if suffix != digest[:12]:
                raise RuntimeError(f"Source URI hash mismatch for {uri}: {digest}")
            filename = digest[:24] + ".webp"
            destination = PREVIEW_DIR / filename
            if not destination.is_file() or destination.stat().st_size == 0:
                make_preview(raw, destination)
            blob_preview[blob_id] = PREVIEW_PREFIX + filename
            if index % 25 == 0 or index == len(unique):
                print(f"Converted {index}/{len(unique)} blobs in {time.monotonic()-started:.1f}s", flush=True)
    finally:
        if batch.stdin:
            batch.stdin.close()
        if batch.stdout:
            batch.stdout.close()
        batch.wait()
    mapping = {uri: blob_preview[tree["public" + uri][0]] for uri in uris}
    for uri, served in mapping.items():
        disk = ROOT / "public" / served.lstrip("/")
        if not disk.is_file() or disk.stat().st_size == 0:
            raise RuntimeError(f"Broken mapping {uri} -> {served}")
    temp_mapping = MAPPING.with_suffix(".json.tmp")
    temp_mapping.write_text(json.dumps(mapping, indent=2) + "\n")
    os.replace(temp_mapping, MAPPING)
    previews = list(PREVIEW_DIR.glob("*.webp"))
    bytes_total = sum(path.stat().st_size for path in previews)
    print(
        f"OK: {len(mapping)} mapped URIs, {len(previews)} exact-source previews, "
        f"{bytes_total/1048576:.1f} MiB; mapping={MAPPING.relative_to(ROOT)}; "
        f"elapsed={time.monotonic()-started:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        raise
