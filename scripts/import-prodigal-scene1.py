"""Replace only Prodigal Son Scene 01 from the supplied rebuilt archive as data.

Usage: python scripts/import-prodigal-scene1.py path/to/Prodigal_Son_Scene_01_Rebuilt.zip
Validates the whole archive before publishing immutable assets, backs up both
existing manifests, and preserves every other scene. Never executes workflows.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import re
import stat
import struct
import zipfile
from decimal import Decimal
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_PATH = Path("public/pictures/prodigal-son")
GENERATED_PATH = Path("src/lib/studio/bundled-pictures/prodigal-son/director.ts")
WORKFLOW_NAME = "Scene_01_Temple_and_the_Gathering.json"
DOCUMENT_NAMES = (
    "README.txt", "Shot_Timing.csv", "Complete_Opening_Screenplay.md",
    "Image_Generation_Prompts.md", "Validation.txt", "Image_Index.html",
)
VARIED_WORKFLOW_NAME = "Scene_01_Temple_and_the_Gathering_Varied_Angles.json"
VARIED_DOCUMENT_NAMES = (
    "APPLY_TO_PREMIERE316.md", "Image_Index.html", "Image_Manifest.json", "README_INSTALL.txt",
    "Scene_01_Complete_Prompts.md", "Scene_01_Shot_Plan.csv", "Scene_01_Updated_Screenplay.md",
    "Scene_01_Validation.json",
)
LEGACY_IMAGE_PATTERN = r"prodigal_son/opening_rebuilt/0[1-9]_[A-Za-z0-9_]+\.png"
VARIED_IMAGE_PATTERN = r"prodigal_son/(?:opening_rebuilt/0[1-7]_[A-Za-z0-9_]+|opening_varied/S(?:03|07|08|09|11|12|14|15|16)_[A-Za-z0-9_]+)\.png"
SCENE_ID = "PS-S01"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_entry(name: str) -> None:
    if (not name or "\\" in name or PurePosixPath(name).is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))
            or any(c in name for c in (":", "\x00"))):
        raise ValueError(f"Unsafe archive path: {name!r}")


def png_size(data: bytes, expected: tuple[int, int] = (1920, 800)) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Starting image is not a PNG")
    size = struct.unpack(">II", data[16:24])
    if size != expected:
        raise ValueError(f"Unexpected starting-image size: {size}")
    return size


def read_archive(archive: Path) -> tuple[str, dict[str, bytes]]:
    # Bound before reading or decompressing any attacker-controlled archive data.
    if archive.stat().st_size > 128 * 1024**2:
        raise ValueError("Scene archive exceeds the compressed size limit")
    archive_bytes = archive.read_bytes()
    files: dict[str, bytes] = {}
    names: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as bundle:
        entries = bundle.infolist()
        if len(entries) > 32 or sum(entry.file_size for entry in entries) > 128 * 1024**2:
            raise ValueError("Archive exceeds the bounded scene-package size")
        for entry in entries:
            name = entry.filename
            safe_entry(name)
            mode = entry.external_attr >> 16
            if entry.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("Only regular package files are accepted")
            if name.casefold() in names:
                raise ValueError(f"Duplicate archive entry: {name}")
            names.add(name.casefold())
            if entry.flag_bits & 1 or entry.file_size > 32 * 1024**2:
                raise ValueError("Oversized or encrypted archive entry")
            if entry.file_size > max(1, entry.compress_size) * 250:
                raise ValueError("Archive compression ratio exceeds the package limit")
            if not (name in (WORKFLOW_NAME, VARIED_WORKFLOW_NAME, *DOCUMENT_NAMES, *VARIED_DOCUMENT_NAMES) or
                    re.fullmatch(f"input/{LEGACY_IMAGE_PATTERN}", name) or
                    re.fullmatch(f"input/{VARIED_IMAGE_PATTERN}", name)):
                raise ValueError(f"Unrecognized package file: {name}")
            files[name] = bundle.read(entry)
    if WORKFLOW_NAME in files and VARIED_WORKFLOW_NAME in files:
        raise ValueError("The archive mixes two Scene 01 package profiles")
    workflow_name = VARIED_WORKFLOW_NAME if VARIED_WORKFLOW_NAME in files else WORKFLOW_NAME
    document_names = VARIED_DOCUMENT_NAMES if workflow_name == VARIED_WORKFLOW_NAME else DOCUMENT_NAMES
    if not {workflow_name, *document_names}.issubset(files):
        raise ValueError("The rebuilt scene archive is missing required source documents")
    return digest(archive_bytes), files


def validate_scene(files: dict[str, bytes], archive_hash: str) -> tuple[dict, dict[str, bytes], list[dict]]:
    outputs: dict[str, bytes] = {}
    varied = VARIED_WORKFLOW_NAME in files
    if varied and WORKFLOW_NAME in files:
        raise ValueError("The archive mixes two Scene 01 package profiles")
    workflow_name = VARIED_WORKFLOW_NAME if varied else WORKFLOW_NAME
    document_names = VARIED_DOCUMENT_NAMES if varied else DOCUMENT_NAMES
    required_documents = {workflow_name, *document_names}
    if not required_documents.issubset(files):
        raise ValueError("The scene archive is missing required source documents")
    shot_count, frame_count, seconds, image_count = (16, 5040, 210, 16) if varied else (22, 6720, 280, 9)
    image_pattern = VARIED_IMAGE_PATTERN if varied else LEGACY_IMAGE_PATTERN

    def publish(relative: str, data: bytes) -> dict:
        checksum = digest(data)
        stem, suffix = relative.rsplit(".", 1)
        name = f"director/{stem}-{checksum[:12]}.{suffix}"
        outputs[name] = data
        return {"mediaUri": f"/pictures/prodigal-son/{name}", "sha256": checksum, "bytes": len(data)}

    workflow = json.loads(files[workflow_name])
    nodes = [node for node in workflow["nodes"] if node["type"] == "LTXDirector"]
    if len(nodes) != 1:
        raise ValueError("The rebuilt scene must have exactly one Director node")
    node = nodes[0]
    props, named, widgets = node["properties"], node["widgets_values_named"], node["widgets_values"]
    # The supplied node serializes each widget three ways. Refuse stale copies.
    if len(named) != len(widgets) or not isinstance(widgets, list):
        raise ValueError("Director widget copies have different shapes")
    for key, widget in zip(named, widgets):
        if key not in props or props[key] != named[key] or named[key] != widget:
            raise ValueError(f"Director serialized copies disagree: {key}")
    timeline = json.loads(props["timeline_data"])
    global_prompt = props["global_prompt"]
    if not isinstance(global_prompt, str) or not global_prompt.strip() or timeline["global_prompt"] != global_prompt:
        raise ValueError("Global prompt copies disagree")
    if props["frame_rate"] != 24 or timeline.get("normalStartFrame") != 0:
        raise ValueError("Expected a 24 fps scene beginning at frame zero")
    source_segments = timeline["segments"]
    csv_name = "Scene_01_Shot_Plan.csv" if varied else "Shot_Timing.csv"
    rows = list(csv.DictReader(io.StringIO(files[csv_name].decode("utf-8-sig"), newline=None)))
    if len(rows) != shot_count or len(source_segments) != shot_count:
        raise ValueError(f"The scene must contain {shot_count} CSV shots and timeline segments")
    if props["local_prompts"] != " | ".join(segment["prompt"] for segment in source_segments):
        raise ValueError("Serialized local prompts differ from timeline prompts")
    if props["segment_lengths"] != ",".join(str(segment["length"]) for segment in source_segments):
        raise ValueError("Serialized segment lengths differ from the timeline")
    videos = [item for item in workflow["nodes"] if item["type"] == "VHS_VideoCombine"]
    if len(videos) != 1 or videos[0]["widgets_values"] != videos[0]["widgets_values_named"]:
        raise ValueError("Output video settings copies disagree")
    if videos[0]["widgets_values"]["filename_prefix"] != "Prodigal_Son/Scene_01_Temple_and_the_Gathering/segment":
        raise ValueError("Output prefix does not identify the rebuilt scene")
    stage_steps = {}
    for stage_name in ("Stage #1", "Stage #2"):
        definitions = [item for item in workflow["definitions"]["subgraphs"] if item.get("name") == stage_name]
        stages = [item for item in workflow["nodes"] if len(definitions) == 1 and item["type"] == definitions[0]["id"]]
        if len(stages) != 1:
            raise ValueError(f"Expected one supplied sampler stage: {stage_name}")
        stage = stages[0]
        if list(stage["widgets_values_named"].values()) != stage["widgets_values"]:
            raise ValueError(f"Sampler stage widget copies disagree: {stage_name}")
        steps = stage["widgets_values_named"]["steps"]
        if type(steps) is not int or steps < 1:
            raise ValueError(f"Invalid sampler steps: {stage_name}")
        stage_steps[stage_name] = steps
        if varied and stage["widgets_values_named"].get("distilled_mode") is not False:
            raise ValueError(f"The 3:30 package requires Dev mode: {stage_name}")
    settings = {"width": props["custom_width"], "height": props["custom_height"],
                "baseSteps": stage_steps["Stage #1"], "refineSteps": stage_steps["Stage #2"],
                "outputPrefix": videos[0]["widgets_values"]["filename_prefix"]}
    if any(type(settings[key]) is not int or not 0 <= settings[key] <= 8192 for key in ("width", "height")):
        raise ValueError("Invalid source resolution controls")

    image_manifest = {}
    if varied:
        options = timeline.get("generationOptions", {})
        if (options.get("distilled") is not False or options.get("tiledDecode") is not True
                or options.get("unloadVae") is not False or stage_steps != {"Stage #1": 30, "Stage #2": 8}):
            raise ValueError("The 3:30 package requires Dev 30/8, tiled decode on and unload VAE off")
        references = timeline.get("motionSegments", [])
        reference_paths = ["whatdreamscost/1a7cf183faa1-PS-CHR-JESUS.png", "whatdreamscost/87ed7075b0e7-PS-LOC-HILLSIDE.png"]
        if (len(references) != 2 or timeline.get("icReferenceMode") is not True
                or [item.get("videoFile") for item in references] != reference_paths
                or any(item.get("inputIndex") != index or item.get("isStaticImage") is not True
                       or item.get("start") != 0 or item.get("length") != 5040
                       for index, item in enumerate(references))):
            raise ValueError("The 3:30 package must retain its two full-scene IC identity references")
        tiled_nodes = [item for item in workflow["nodes"] if "tiled_decode" in item.get("widgets_values_named", {})]
        if len(tiled_nodes) != 1 or tiled_nodes[0]["widgets_values_named"]["tiled_decode"] is not True:
            raise ValueError("The supplied decoder must use tiled decoding")
        model_switches = [item for item in workflow["nodes"] if item.get("title") == "Dev / Distilled model"]
        if len(model_switches) != 1 or model_switches[0].get("widgets_values_named", {}).get("switch") is not False:
            raise ValueError("The supplied model switch must remain in Dev mode")
        # Notes can contain stale explanatory text; execution widgets may not.
        for container in [workflow, *workflow.get("definitions", {}).get("subgraphs", [])]:
            for item in container["nodes"]:
                if item.get("type") == "MarkdownNote" or not item.get("widgets_values_named"):
                    continue
                values, names = item.get("widgets_values"), item["widgets_values_named"]
                if (isinstance(values, list) and list(names.values()) != values
                        or isinstance(values, dict) and names != values):
                    raise ValueError(f"Execution widget copies disagree: {item['id']}")
        manifest = json.loads(files["Image_Manifest.json"])
        images = manifest.get("images", [])
        if (manifest.get("image_count") != 16 or manifest.get("new_image_count") != 9
                or manifest.get("retained_image_count") != 7 or len(images) != 16):
            raise ValueError("The 3:30 image manifest must identify seven retained and nine new images")
        if len({item.get("path") for item in images}) != 16 or [item.get("segment") for item in images] != list(range(1, 17)):
            raise ValueError("Image manifest paths and segment numbers must be unique and ordered")
        image_manifest = {item["segment"]: item for item in images}
        validation = json.loads(files["Scene_01_Validation.json"])
        if any(validation.get(key) != expected for key, expected in {
            "workflow_filename": workflow_name, "segments": 16, "duration_seconds": 210,
            "frame_rate": 24, "duration_frames": 5040, "retained_dialogue_output_segments": [10, 11, 16],
        }.items()):
            raise ValueError("The validation document disagrees with the 3:30 scene profile")

    segments, titles, image_files, seen_ids = [], [], set(), set()
    end_frame = 0
    for number, (row, segment) in enumerate(zip(rows, source_segments), 1):
        shot_id = f"{SCENE_ID}-SH{number:03}"
        title = row["Shot"] if varied else row["Title"]
        if row["Segment" if varied else "Shot"] != str(number) or not title.strip():
            raise ValueError(f"CSV shot order or title differs: {shot_id}")
        image_path = segment["imageFile"]
        if not re.fullmatch(image_pattern, image_path):
            raise ValueError(f"Unexpected image reference: {shot_id}")
        if (row["Image"] != image_path if varied else row["Reference image"] != PurePosixPath(image_path).name):
            raise ValueError(f"CSV and timeline image references disagree: {shot_id}")
        # imageB64 is an existing ComfyUI image URL, not embedded or remote data.
        image_url = urlsplit(segment["imageB64"])
        if image_url.scheme or image_url.netloc or image_url.path != "/api/view" or parse_qs(image_url.query) != {
            "filename": [PurePosixPath(image_path).name], "type": ["input"],
            "subfolder": [str(PurePosixPath(image_path).parent)],
        }:
            raise ValueError(f"Image URL and image path disagree: {shot_id}")
        length = segment["length"]
        if (type(length) is not int or length <= 0 or segment["start"] != end_frame
                or segment.get("type") != "image" or segment.get("isEndFrame") is not False):
            raise ValueError(f"Invalid or noncontiguous segment timing: {shot_id}")
        expected = (Decimal(end_frame) / 24, Decimal(length) / 24, Decimal(end_frame + length) / 24)
        if varied:
            def timestamp(value: str) -> Decimal:
                if not re.fullmatch(r"\d{2}:[0-5]\d", value):
                    raise ValueError(f"Invalid CSV timestamp: {shot_id}")
                minute, second = value.split(":")
                return Decimal(minute) * 60 + Decimal(second)
            actual = (timestamp(row["Start"]), Decimal(row["Seconds"]), timestamp(row["End"]))
            expected_speaker, expected_voice = {
                10: ("PHARISEE", "prodigal_son/voices/PHARISEE-reference.flac"),
                11: ("SCRIBE", "prodigal_son/voices/SCRIBE-reference.flac"),
                16: ("JESUS", "voices/shared/JESUS.flac"),
            }.get(number, ("", ""))
            if (row["Speaker"] != expected_speaker or row["Voice_reference"] != expected_voice
                    or segment.get("speaker") != expected_speaker or segment.get("voiceReferenceFile") != expected_voice
                    or segment.get("voiceReferenceEnabled") is not bool(expected_voice)):
                raise ValueError(f"Voice identity differs from the supplied shot plan: {shot_id}")
        else:
            actual = tuple(Decimal(row[key]) for key in ("Start seconds", "Duration seconds", "End seconds"))
        if actual != expected:
            raise ValueError(f"CSV timing differs from the timeline: {shot_id}")
        segment_id = segment["id"]
        if not isinstance(segment_id, str) or not segment_id or segment_id in seen_ids:
            raise ValueError("Timeline segment IDs must be nonempty and unique")
        if not isinstance(segment["prompt"], str) or not segment["prompt"].strip():
            raise ValueError(f"Empty shot prompt: {shot_id}")
        entry_name = f"input/{image_path}"
        if entry_name not in files:
            raise ValueError(f"Starting image is missing: {entry_name}")
        data = files[entry_name]
        expected_size = (1942, 809) if varied and "/opening_varied/" in image_path else (1920, 800)
        width, height = png_size(data, expected_size)
        if varied:
            entry = image_manifest[number]
            if any(entry.get(key) != value for key, value in {
                "path": entry_name, "sha256": digest(data), "bytes": len(data), "width": width, "height": height,
            }.items()):
                raise ValueError(f"Image manifest differs from supplied image bytes: {shot_id}")
        image = publish(f"starting-images/{SCENE_ID}/{shot_id}_START.png", data)
        image.update(width=width, height=height)
        segments.append({"shotId": shot_id, "segmentId": segment_id, "startFrame": end_frame,
                         "durationFrames": length, "durationSeconds": length / 24, "prompt": segment["prompt"],
                         "sourceImagePath": image_path, "startImage": image})
        titles.append(title)
        seen_ids.add(segment_id)
        image_files.add(entry_name)
        end_frame += length
    if len(image_files) != image_count or image_files | required_documents != files.keys():
        raise ValueError(f"The archive must contain exactly {image_count} referenced images and source documents")
    if varied and len({item["startImage"]["sha256"] for item in segments}) != 16:
        raise ValueError("The 3:30 package must contain 16 unique starting images")
    if end_frame != frame_count or timeline.get("normalDurationFrames") != end_frame:
        raise ValueError(f"Expected the {frame_count}-frame / {seconds}-second opening")
    expected_timing = {"start_frame": 0, "start_second": 0, "end_frame": end_frame,
                       "duration_frames": end_frame, "end_second": seconds, "duration_seconds": seconds}
    if any(props.get(key) != value for key, value in expected_timing.items()):
        raise ValueError("Serialized scene timing disagrees with the authored opening")
    screenplay = files["Scene_01_Updated_Screenplay.md" if varied else "Complete_Opening_Screenplay.md"].decode("utf-8")
    label, document_folder = ("Scene 01 3m30", "Scene_01_3m30") if varied else ("Scene 01 Rebuilt", "Scene_01_Rebuilt")
    documents = [dict(name=f"{label} / {name}", **publish(f"documents/{document_folder}/{name}", files[name]))
                 for name in document_names]
    scene = {"sceneId": SCENE_ID, "title": "Temple and the Gathering",
             "workflow": publish(f"workflows/{workflow_name}", files[workflow_name]), "frameRate": 24,
             "storyDurationSeconds": float(seconds), "generationDurationSeconds": float(seconds),
             "globalPrompt": global_prompt, "segments": segments,
             "replacement": {"revision": archive_hash, "screenplayMarkdown": screenplay, "shotTitles": titles,
                             "settings": settings}}
    return scene, outputs, documents


def build_manifest(previous: dict, scene: dict, documents: list[dict], archive_hash: str) -> dict:
    manifest = copy.deepcopy(previous)
    old = [item for item in previous["scenes"] if item["sceneId"] == SCENE_ID]
    if len(old) != 1 or len(previous["scenes"]) != 22:
        raise ValueError("Expected the existing 22-scene Director manifest")
    original = old[0]
    already_imported = original.get("replacement", {}).get("revision") == archive_hash
    if already_imported:
        if original != scene:
            raise ValueError("The imported Scene 01 revision was modified; refusing to overwrite it")
        return manifest
    manifest["scenes"] = [scene if item["sceneId"] == SCENE_ID else item for item in manifest["scenes"]]
    for key in ("storyDurationSeconds", "generationDurationSeconds"):
        manifest[key] += scene[key] - original[key]
    for key in ("storyShotCount", "generationSegmentCount"):
        manifest[key] += len(scene["segments"]) - len(original["segments"])
    # The all-scenes sourceArchive remains the parent provenance.
    manifest["revision"] = digest(f"{previous['revision']}:{archive_hash}".encode("ascii"))
    known_documents = {item["mediaUri"] for item in manifest["documents"]}
    manifest["documents"].extend(item for item in documents if item["mediaUri"] not in known_documents)
    if [item for item in manifest["scenes"] if item["sceneId"] != SCENE_ID] != [
            item for item in previous["scenes"] if item["sceneId"] != SCENE_ID]:
        raise ValueError("A scene outside the requested replacement changed")
    return manifest


def import_package(archive: Path, root: Path = ROOT) -> dict:
    root = root.resolve()
    public = root / PUBLIC_PATH
    manifest_path = public / "director-manifest.json"
    generated_path = root / GENERATED_PATH
    original_json, original_ts = manifest_path.read_bytes(), generated_path.read_bytes()
    previous = json.loads(original_json)
    archive_hash, files = read_archive(archive)
    scene, outputs, documents = validate_scene(files, archive_hash)
    manifest = build_manifest(previous, scene, documents, archive_hash)
    backup = root / "artifacts/scene1-rebuilt" / previous["revision"]
    backup_files = {backup / "director-manifest.json": original_json, backup / "director.ts": original_ts}
    # Reject every path escape or immutable collision before writing anything.
    destinations = {public / relative: data for relative, data in outputs.items()}
    if manifest != previous:
        destinations.update(backup_files)
    for target, data in destinations.items():
        if not target.resolve().is_relative_to(root):
            raise ValueError("Destination escapes the project folder")
        if target.exists() and target.read_bytes() != data:
            raise ValueError(f"Immutable file collision: {target}")
    for target, data in destinations.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(data)
    if manifest != previous:
        serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        generated = ('import type { ProdigalDirectorManifest } from "../../prodigal-director-types.ts";\n\n'
                     '// Imported as source data by scripts/import-prodigal-director.py and scripts/import-prodigal-scene1.py; no workflows were executed.\n'
                     f'export const PRODIGAL_SON_DIRECTOR: ProdigalDirectorManifest = {serialized.rstrip()};\n')
        manifest_path.write_bytes(serialized.encode("utf-8"))
        generated_path.write_bytes(generated.encode("utf-8"))
    return {"scene": SCENE_ID, "title": scene["title"], "sceneSegments": len(scene["segments"]),
            "sceneFrames": sum(item["durationFrames"] for item in scene["segments"]), "sceneSeconds": scene["generationDurationSeconds"],
            "uniqueStartingImages": len({item["startImage"]["sha256"] for item in scene["segments"]}),
            "publishedShotImages": len(scene["segments"]), "otherScenesPreserved": len(manifest["scenes"]) - 1,
            "storyShots": manifest["storyShotCount"], "generationSegments": manifest["generationSegmentCount"],
            "storySeconds": manifest["storyDurationSeconds"], "generationSeconds": manifest["generationDurationSeconds"],
            "archiveSha256": archive_hash, "workflowSha256": scene["workflow"]["sha256"],
            "manifestRevision": manifest["revision"], "alreadyImported": manifest == previous,
            "backupDirectory": str(backup) if manifest != previous else None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    print(json.dumps(import_package(parser.parse_args().archive), indent=2))
