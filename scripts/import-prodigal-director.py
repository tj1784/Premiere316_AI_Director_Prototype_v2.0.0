"""Validate and import the supplied Director package as data, without running workflows.

Usage: python scripts/import-prodigal-director.py path/to/package.zip
All paths are constructed from validated IDs. Archive entries are never extracted
to a caller-supplied path, and original selected frame images are never replaced.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import stat
import struct
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = ROOT / "public/pictures/prodigal-son"
PACKAGE_ID = "prodigal-son-director-20260914"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_entry(name: str) -> None:
    path = PurePosixPath(name)
    if (not name or "\\" in name or path.is_absolute() or
            any(part in ("", ".", "..") for part in name.split("/")) or
            any(c in name for c in (":", "\x00"))):
        raise ValueError(f"Unsafe archive path: {name!r}")


def png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Starting image is not a PNG")
    size = struct.unpack(">II", data[16:24])
    if size != (1920, 800):
        raise ValueError(f"Unexpected starting-image size: {size}")
    return size


def read_package(archive: Path) -> tuple[dict, dict[str, bytes]]:
    """Finish structural and source-plan validation before returning any output."""
    baseline = json.loads((PUBLIC_ROOT / "first-last-frame-manifest.json").read_text(encoding="utf-8"))
    known_shots = {shot["id"]: shot for shot in baseline["shots"]}
    files: dict[str, bytes] = {}
    outputs: dict[str, bytes] = {}
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) > 400 or sum(entry.file_size for entry in entries) > 512 * 1024**2:
            raise ValueError("Archive exceeds the bounded scene-package size")
        for entry in entries:
            safe_entry(entry.filename)
            if stat.S_ISLNK(entry.external_attr >> 16) or entry.is_dir():
                raise ValueError("Only regular package files are accepted")
            if entry.filename.casefold() in {name.casefold() for name in files}:
                raise ValueError(f"Duplicate archive entry: {entry.filename}")
            if entry.file_size > 32 * 1024**2 or entry.flag_bits & 1:
                raise ValueError("Oversized or encrypted archive entry")
            if entry.file_size > max(1, entry.compress_size) * 250:
                raise ValueError("Archive compression ratio exceeds the package limit")
            if not (entry.filename in ("README.txt", "Editing_Notes.txt", "Scene_Index.csv") or
                    re.fullmatch(r"workflows/Scene_\d{2}_[A-Za-z0-9_]+\.json", entry.filename) or
                    re.fullmatch(r"input/prodigal_son/PS-S\d{2}/PS-S\d{2}-SH\d{3}_START\.png", entry.filename)):
                raise ValueError(f"Unrecognized package file: {entry.filename}")
            files[entry.filename] = bundle.read(entry)

    def publish(relative: str, data: bytes) -> dict:
        checksum = digest(data)
        stem, suffix = relative.rsplit(".", 1)
        name = f"director/{stem}-{checksum[:12]}.{suffix}"
        outputs[name] = data
        return {"mediaUri": f"/pictures/prodigal-son/{name}", "sha256": checksum, "bytes": len(data)}

    index = list(csv.DictReader(io.StringIO(files["Scene_Index.csv"].decode("utf-8-sig"))))
    if len(index) != 22 or {row["Scene"] for row in index} != {f"PS-S{i:02}" for i in range(1, 23)}:
        raise ValueError("Scene index must contain each of the 22 narrative scenes once")
    scenes, used_shots, used_files = [], set(), {"README.txt", "Editing_Notes.txt", "Scene_Index.csv"}
    for row in sorted(index, key=lambda value: value["Scene"]):
        scene_id = row["Scene"]
        workflow_name = f"workflows/{row['Workflow']}"
        safe_entry(workflow_name)
        if not re.fullmatch(rf"workflows/Scene_{scene_id[-2:]}_[A-Za-z0-9_]+\.json", workflow_name):
            raise ValueError(f"Workflow scene mismatch: {workflow_name}")
        workflow = json.loads(files[workflow_name])
        nodes = [node for node in workflow["nodes"] if node["type"] == "LTXDirector"]
        if len(nodes) != 1:
            raise ValueError("Each scene must have exactly one Director node")
        properties = nodes[0]["properties"]
        timeline = json.loads(properties["timeline_data"])
        if properties["frame_rate"] != 24:
            raise ValueError("Expected the approved 24 fps scene timing")
        global_prompt = properties["global_prompt"]
        if not isinstance(global_prompt, str) or timeline["global_prompt"] != global_prompt:
            raise ValueError("Inconsistent scene prompt")
        segments, end_frame = [], 0
        for segment in timeline["segments"]:
            image_path = segment["imageFile"]
            match = re.fullmatch(rf"prodigal_son/{scene_id}/({scene_id}-SH\d{{3}})_START\.png", image_path)
            if not match or segment.get("type") != "image" or segment.get("isEndFrame") is not False:
                raise ValueError("Expected a matching starting-image segment")
            shot_id = match[1]
            source = known_shots.get(shot_id)
            if not source or shot_id in used_shots or source.get("reuse_from_shot"):
                raise ValueError(f"Unknown, repeated or reused generation shot: {shot_id}")
            length = segment["length"]
            if (not isinstance(length, int) or length <= 0 or segment["start"] != end_frame or
                    length / 24 != source["duration_seconds"]):
                raise ValueError(f"Timing differs from the approved shot plan: {shot_id}")
            if not isinstance(segment["prompt"], str) or not segment["prompt"].strip():
                raise ValueError(f"Empty segment prompt: {shot_id}")
            entry_name = f"input/{image_path}"
            data = files[entry_name]
            width, height = png_size(data)
            image = publish(f"starting-images/{scene_id}/{shot_id}_START.png", data)
            image.update(width=width, height=height)
            segments.append({"shotId": shot_id, "segmentId": segment["id"], "startFrame": end_frame,
                             "durationFrames": length, "durationSeconds": length / 24, "prompt": segment["prompt"],
                             "sourceImagePath": image_path, "startImage": image})
            end_frame += length
            used_shots.add(shot_id)
            used_files.add(entry_name)
        story_shots = [shot for shot in known_shots.values() if shot["scene_id"] == scene_id]
        if (len(segments) != int(row["Generation segments"]) or end_frame / 24 != float(row["Generation seconds"]) or
                len(story_shots) != int(row["Story shots"]) or
                sum(shot["duration_seconds"] for shot in story_shots) != float(row["Story seconds"])):
            raise ValueError(f"Scene index totals do not match its graph and shot plan: {scene_id}")
        scenes.append({"sceneId": scene_id, "title": row["Title"], "workflow": publish(workflow_name, files[workflow_name]),
                       "frameRate": 24, "storyDurationSeconds": float(row["Story seconds"]),
                       "generationDurationSeconds": end_frame / 24, "globalPrompt": global_prompt, "segments": segments})
        used_files.add(workflow_name)
    if used_files != set(files):
        raise ValueError("The archive contains unreferenced scene assets")
    reuse = []
    for shot in known_shots.values():
        if shot["id"] in used_shots:
            continue
        source_id = shot.get("reuse_from_shot")
        if shot["scene_id"] != "PS-S15" or source_id not in used_shots or shot["duration_seconds"] != 8:
            raise ValueError(f"Missing narrative shot: {shot['id']}")
        reuse.append({"shotId": shot["id"], "sceneId": shot["scene_id"], "sourceShotId": source_id,
                      "durationSeconds": 8, "sourceIntervalSeconds": None, "dialogue": "muted", "action": shot["reuse_action"]})
    if len(reuse) != 3 or len(used_shots) != 131:
        raise ValueError("The approved package must contain 131 generated segments and three memory inserts")
    documents = [dict(name=name, **publish(f"documents/{name}", files[name])) for name in ("README.txt", "Editing_Notes.txt", "Scene_Index.csv")]
    manifest = {
        "schemaVersion": 1, "packageId": PACKAGE_ID, "pictureId": baseline["pictureId"],
        "screenplayVersionId": baseline["screenplayVersionId"], "revision": digest(archive.read_bytes()),
        "createdAt": 1789387200000, "sourceArchive": {"name": archive.name, "sha256": digest(archive.read_bytes())},
        "storyDurationSeconds": sum(scene["storyDurationSeconds"] for scene in scenes),
        "generationDurationSeconds": sum(scene["generationDurationSeconds"] for scene in scenes),
        "creditsSeconds": 30, "storyShotCount": len(known_shots), "generationSegmentCount": len(used_shots),
        "documents": documents, "scenes": scenes, "reusedShots": reuse,
    }
    return manifest, outputs


def import_package(archive: Path) -> dict:
    manifest, outputs = read_package(archive)
    root = PUBLIC_ROOT.resolve()
    # Validate every existing destination before writing any package media.
    for relative, data in outputs.items():
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError("Destination escapes the picture folder")
        if target.exists() and digest(target.read_bytes()) != digest(data):
            raise ValueError(f"Immutable file collision: {target.name}")
    for relative, data in outputs.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(data)
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (root / "director-manifest.json").write_text(serialized, encoding="utf-8")
    (ROOT / "src/lib/studio/bundled-pictures/prodigal-son/director.ts").write_text(
        'import type { ProdigalDirectorManifest } from "../../prodigal-director-types.ts";\n\n'
        '// Imported as source data by scripts/import-prodigal-director.py; no workflows were executed.\n'
        f'export const PRODIGAL_SON_DIRECTOR: ProdigalDirectorManifest = {serialized.rstrip()};\n', encoding="utf-8")
    return {"scenes": len(manifest["scenes"]), "segments": manifest["generationSegmentCount"],
            "startingImages": manifest["generationSegmentCount"], "memoryInserts": len(manifest["reusedShots"]),
            "storySeconds": manifest["storyDurationSeconds"], "generationSeconds": manifest["generationDurationSeconds"],
            "revision": manifest["revision"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    print(json.dumps(import_package(parser.parse_args().archive)))
