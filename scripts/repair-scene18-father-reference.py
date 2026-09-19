"""Repair Father as Scene 18 Ref2 in four named native workflows only.

Dry-run by default. --apply backs up every source before any workflow write.
All three Director timeline mirrors are synchronized; scene content and the
existing Younger reference are preserved exactly. Unexpected Ref2 content
or inconsistent mirrors fail the entire preflight without writing anything.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = Path("D:/AI/ComfyUI/Data/LTX2.5/Input")
FATHER = "3b426be41373-PS-CHR-FATHER.png"
YOUNGER = "10f5bc58f618-PS-CHR-YOUNGER-pig-farm-extreme-destitution.png"
PATHS = (
    ROOT / "projects/the_prodigal_son/workflows/LTX_frames_attached/Scene_18_The_father_runs.json",
    Path("D:/AI/ComfyUI/Data/LTX2.5/User/default/workflows/Prodigal_Son_Frames_Attached/Scene_18_The_father_runs.json"),
    Path("D:/Data/Downloads/Scene_18_The_father_runs.json"),
    Path("D:/Data/Downloads/PS-S18_Unsaved_Workflow_4.json"),
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse_timeline(value):
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, dict) or not isinstance(parsed.get("segments"), list):
        raise ValueError("Director timeline must contain its main segments")
    return parsed


def timeline_mirrors(node):
    found = []
    for index, value in enumerate(node.get("widgets_values", [])):
        if isinstance(value, str):
            try:
                found.append((index, parse_timeline(value)))
            except (ValueError, TypeError):
                pass
    if len(found) != 1:
        raise ValueError("Missing or ambiguous Director timeline widget")
    index, timeline = found[0]
    for container in ("properties", "widgets_values_named"):
        value = node.get(container, {}).get("timeline_data")
        if value is None or parse_timeline(value) != timeline:
            raise ValueError(f"Inconsistent or missing {container}.timeline_data")
    return index, timeline


def uses_asset(segment, filename):
    return any(str(segment.get(key, "")).replace("\\", "/").split("/")[-1] == filename
               for key in ("videoFile", "imageFile", "fileName"))


def protected_timeline(timeline):
    result = copy.deepcopy(timeline)
    result["motionSegments"] = [s for s in result.get("motionSegments", []) if not uses_asset(s, FATHER)]
    lines = result.get("icInputs", [])
    if len(lines) >= 2:
        lines.pop(1)
    for key in ("motionTrackEnabled", "icReferenceMode", "icReferenceLayoutCount"):
        result.pop(key, None)
    return result


def protected_workflow(workflow):
    result = copy.deepcopy(workflow)
    for node in result.get("nodes", []):
        if node.get("type") != "LTXDirector":
            continue
        index, timeline = timeline_mirrors(node)
        protected = protected_timeline(timeline)
        node["widgets_values"][index] = protected
        node["widgets_values"][12] = "<reference-master>"
        for container in ("properties", "widgets_values_named"):
            node[container]["timeline_data"] = protected
            node[container].pop("use_custom_motion", None)
        node["properties"].pop("motionTrackEnabled", None)
    return result


def repair(original, father_size):
    result = copy.deepcopy(original)
    nodes = [node for node in result.get("nodes", []) if node.get("type") == "LTXDirector"]
    if len(nodes) != 1:
        raise ValueError("Expected exactly one native LTXDirector")
    node = nodes[0]
    index, timeline = timeline_mirrors(node)
    # The four known native workflows share this serialized widget schema.
    if index != 6 or len(node["widgets_values"]) != 23 or type(node["widgets_values"][12]) is not bool:
        raise ValueError("Unexpected Director widget schema; cannot safely wire the master")
    before_timeline = copy.deepcopy(timeline)
    if not timeline["segments"]:
        raise ValueError("Missing authored Scene 18 main timeline")
    full_frames = max(segment["start"] + segment["length"] for segment in timeline["segments"])
    if not isinstance(full_frames, int) or full_frames <= 0 or min(s["start"] for s in timeline["segments"]) != 0:
        raise ValueError("Expected positive whole-frame Scene 18 starting at frame 0")
    references = timeline.get("motionSegments", [])
    fathers = [segment for segment in references if uses_asset(segment, FATHER)]
    younger = [segment for segment in references if uses_asset(segment, YOUNGER)]
    if len(younger) != 1 or younger[0].get("inputIndex", 0) != 0:
        raise ValueError("Expected exactly one unchanged Younger reference on Ref1")
    if len(fathers) > 1:
        raise ValueError("Multiple Father references need manual disambiguation")
    for segment in references:
        if segment.get("inputIndex", 0) == 1 and not uses_asset(segment, FATHER):
            raise ValueError("Ref2 already contains another asset; refusing to overwrite it")
    lines = timeline.get("icInputs")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 9:
        raise ValueError("Invalid reference rows")
    if len(lines) > 1 and lines[1].get("label", "") not in ("", "Father") and not fathers:
        raise ValueError("Ref2 is named for another reference; refusing to overwrite it")
    while len(lines) < 2:
        lines.append({"enabled": True, "label": ""})
    lines[1].update(enabled=True, label="Father")
    if fathers:
        father = fathers[0]
        # Preserve every authored field, including both strength controls.
        father.update(inputIndex=1, start=0, length=full_frames)
    else:
        father = {
            "id": "prodigal-scene18-ref2-father", "type": "motion_video",
            "isStaticImage": True, "inputIndex": 1, "start": 0,
            "length": full_frames, "trimStart": 0, "videoDurationFrames": full_frames,
            "videoFile": FATHER, "fileName": FATHER, "videoStrength": 1.0,
            "videoAttentionStrength": 0.65, "resampleMode": "nearest", "fileSize": father_size,
        }
        if any(segment.get("id") == father["id"] for segment in references):
            raise ValueError("Father reference ID is already used by another asset")
        references.append(father)
    timeline["motionSegments"] = references
    timeline["motionTrackEnabled"] = True
    timeline["icReferenceMode"] = True
    if "icReferenceLayoutCount" in timeline:
        timeline["icReferenceLayoutCount"] = max(2, timeline["icReferenceLayoutCount"])
    if protected_timeline(timeline) != protected_timeline(before_timeline):
        raise ValueError("Non-reference timeline content changed")
    if next(s for s in references if uses_asset(s, YOUNGER)) != next(s for s in before_timeline["motionSegments"] if uses_asset(s, YOUNGER)):
        raise ValueError("Younger reference changed")
    serialized = json.dumps(timeline, ensure_ascii=False, separators=(",", ":"))
    node["widgets_values"][index] = serialized
    node["widgets_values"][12] = True
    for container in ("properties", "widgets_values_named"):
        node[container]["timeline_data"] = serialized
        node[container]["use_custom_motion"] = True
    node["properties"]["motionTrackEnabled"] = True
    if protected_workflow(result) != protected_workflow(original):
        raise ValueError("Workflow content outside the reference repair changed")
    return result, {"directorId": node["id"], "fullFrames": full_frames,
                    "mainSegmentsPreserved": len(timeline["segments"]),
                    "fatherAlreadyPresent": bool(fathers), "timelineMirrors": 3}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    father_bytes = (INPUT / FATHER).read_bytes()
    if not father_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Father reference is not a readable PNG")
    report = {"apply": args.apply, "fatherAsset": str(INPUT / FATHER),
              "fatherSha256": digest(father_bytes), "files": [], "errors": []}
    plans = []
    for path in PATHS:
        try:
            before = path.read_bytes()
            original = json.loads(before.decode("utf-8-sig"))
            repaired, details = repair(original, len(father_bytes))
            if repair(repaired, len(father_bytes))[0] != repaired:
                raise ValueError("Repair is not idempotent")
            item = {"path": str(path), **details, "changed": repaired != original,
                    "beforeSha256": digest(before)}
            report["files"].append(item)
            plans.append((path, before, repaired, item))
        except (OSError, ValueError, TypeError, KeyError) as error:
            report["errors"].append({"path": str(path), "error": str(error)})
    report["changedCount"] = sum(item["changed"] for item in report["files"])
    if args.apply and report["errors"]:
        print(json.dumps(report, indent=2))
        raise SystemExit("Preflight failed; no workflows were written")
    if args.apply and report["changedCount"]:
        if any(path.read_bytes() != before for path, before, _, _ in plans):
            raise RuntimeError("Source changed during preflight; no workflows were written")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup = ROOT / "projects/the_prodigal_son/backups" / ("scene18-father-ref2-" + stamp)
        backup.mkdir(parents=True, exist_ok=False)
        report["backup"] = str(backup)
        # Back up all four sources before writing even the first workflow.
        for path, before, _, item in plans:
            backup_file = backup / (digest(str(path).encode())[:12] + "-" + path.name)
            backup_file.write_bytes(before)
            if backup_file.read_bytes() != before:
                raise RuntimeError("Backup verification failed")
            item["backupFile"] = str(backup_file)
        manifest = backup / "repair-report.json"
        manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        try:
            for path, before, repaired, item in plans:
                if not item["changed"]:
                    continue
                if path.read_bytes() != before:
                    raise RuntimeError("Source changed while applying: " + str(path))
                encoded = (json.dumps(repaired, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                temporary = path.with_name(path.name + ".father-ref2-" + stamp + ".tmp")
                temporary.write_bytes(encoded)
                temporary.replace(path)
                stored = json.loads(path.read_text(encoding="utf-8"))
                if stored != repaired or repair(stored, len(father_bytes))[0] != stored:
                    raise RuntimeError("Write verification failed: " + str(path))
                item["afterSha256"] = digest(path.read_bytes())
                item["applied"] = True
        finally:
            manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
