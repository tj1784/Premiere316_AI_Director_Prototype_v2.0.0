"""Add Director's shared IC reference-line metadata; dry-run unless --apply.

Scope is the Prodigal Son project and saved ComfyUI workflows plus the two
known native Scene 18 Downloads workflows. CS25 and non-workflow JSONs are
excluded. No reference assets, model choices, prompts, or timings are changed.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "projects/the_prodigal_son/workflows/LTX_frames_attached"
COMFY = Path("D:/AI/ComfyUI/Data/LTX2.5/User/default/workflows/Prodigal_Son_Frames_Attached")
DOWNLOADS = [Path("D:/Data/Downloads") / name for name in (
    "Scene_18_The_father_runs.json", "PS-S18_Unsaved_Workflow_4.json",
)]
STATIC_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def _parse_timeline(value):
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, dict) or not isinstance(parsed.get("segments"), list):
        raise ValueError("Director timeline must contain its segments list")
    return parsed


def _mirrors(node):
    """Find the actual serialized widget rather than assuming its current index."""
    found = []
    for index, value in enumerate(node.get("widgets_values", [])):
        if not isinstance(value, str):
            continue
        try:
            parsed = _parse_timeline(value)
        except (ValueError, TypeError):
            continue
        found.append((index, parsed))
    if len(found) != 1:
        raise ValueError("Director serialized timeline widget is missing or ambiguous")
    index, timeline = found[0]
    for container in ("properties", "widgets_values_named"):
        value = node.get(container, {}).get("timeline_data")
        if value is not None and _parse_timeline(value) != timeline:
            raise ValueError(f"Director {container}.timeline_data differs from its widget; refusing to overwrite")
    return index, timeline


def _without_reference_metadata(timeline):
    result = copy.deepcopy(timeline)
    result.pop("icInputs", None)
    result.pop("icReferenceMode", None)
    for segment in result.get("motionSegments", []):
        segment.pop("inputIndex", None)
    return result


def migrate_timeline(original):
    timeline = copy.deepcopy(original)
    segments = timeline.get("motionSegments", [])
    if not isinstance(segments, list) or any(not isinstance(item, dict) for item in segments):
        raise ValueError("motionSegments must be a list of objects")
    largest_index = 0
    for segment in segments:
        index = segment.get("inputIndex", 0)
        if type(index) is not int or not 0 <= index <= 8:
            raise ValueError("Reference inputIndex must be an integer from 0 through 8")
        segment.setdefault("inputIndex", index)
        largest_index = max(largest_index, index)
    lines = timeline.get("icInputs")
    if lines is None:
        lines = [{"enabled": True} for _ in range(largest_index + 1)]
    else:
        if not isinstance(lines, list) or not 1 <= len(lines) <= 9:
            raise ValueError("icInputs must contain one through nine lines")
        if len(lines) <= largest_index:
            raise ValueError("A motion segment references a missing IC line")
        for line in lines:
            if not isinstance(line, dict):
                raise ValueError("Each IC reference line must be an object")
            if "enabled" in line and type(line["enabled"]) is not bool:
                raise ValueError("IC line enabled must be a Boolean")
            line.setdefault("enabled", True)
    timeline["icInputs"] = lines
    if "icReferenceMode" in timeline:
        if type(timeline["icReferenceMode"]) is not bool:
            raise ValueError("icReferenceMode must be a Boolean")
        reason = "preserved authored reference mode"
    elif not segments:
        timeline["icReferenceMode"] = True
        reason = "empty reference line; existing master mute preserved"
    elif original.get("motionTrackEnabled") is True and all(
        Path(str(segment.get("videoFile", ""))).suffix.lower() in STATIC_EXTENSIONS
        for segment in segments
    ):
        timeline["icReferenceMode"] = True
        reason = "active static-image references use shared Ingredients"
    else:
        timeline["icReferenceMode"] = False
        reason = "legacy or muted motion conditioning preserved"
    if _without_reference_metadata(timeline) != _without_reference_metadata(original):
        raise ValueError("Unexpected non-reference timeline changes")
    return timeline, reason


def _preservation_view(data):
    result = copy.deepcopy(data)
    for node in result.get("nodes", []):
        if node.get("type") != "LTXDirector":
            continue
        index, timeline = _mirrors(node)
        sanitized = _without_reference_metadata(timeline)
        node["widgets_values"][index] = sanitized
        # Missing mirrors may be initialized, but every other property remains.
        for container in ("properties", "widgets_values_named"):
            node.setdefault(container, {})["timeline_data"] = sanitized
    return result


def transform(original):
    if not isinstance(original, dict):
        return None, []
    directors = [n for n in original.get("nodes", []) if n.get("type") == "LTXDirector"]
    if not directors:
        return None, []
    result = copy.deepcopy(original)
    details = []
    for node in result["nodes"]:
        if node.get("type") != "LTXDirector":
            continue
        index, old_timeline = _mirrors(node)
        timeline, reason = migrate_timeline(old_timeline)
        if timeline != old_timeline or any(node.get(container, {}).get("timeline_data") is None
                                           for container in ("properties", "widgets_values_named")):
            serialized = json.dumps(timeline, ensure_ascii=False, separators=(",", ":"))
            node["widgets_values"][index] = serialized
            node.setdefault("properties", {})["timeline_data"] = serialized
            node.setdefault("widgets_values_named", {})["timeline_data"] = serialized
        details.append({
            "nodeId": node["id"], "referenceLines": len(timeline["icInputs"]),
            "referenceMode": timeline["icReferenceMode"],
            "motionSegmentCount": len(timeline.get("motionSegments", [])),
            "masterEnabled": timeline.get("motionTrackEnabled"), "reason": reason,
        })
    if _preservation_view(result) != _preservation_view(original):
        raise ValueError("Migration modified workflow content beyond reference metadata")
    if result == original:
        return None, details
    return result, details


def scoped_paths():
    return sorted(set(PROJECT.rglob("*.json")) | set(COMFY.rglob("*.json")) |
                  {path for path in DOWNLOADS if path.is_file()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="back up and write the reviewed migrations")
    args = parser.parse_args()
    report = {"apply": args.apply, "changed": [], "unchanged": [], "errors": [], "ignored": 0}
    changes = []
    for path in scoped_paths():
        try:
            original_bytes = path.read_bytes()
            original = json.loads(original_bytes.decode("utf-8-sig"))
            if not isinstance(original, dict) or not any(n.get("type") == "LTXDirector" for n in original.get("nodes", [])):
                report["ignored"] += 1
                continue
            migrated, details = transform(original)
            item = {"file": str(path), "directors": details, "beforeSha256": digest(original_bytes)}
            if migrated is None:
                report["unchanged"].append(item)
            else:
                report["changed"].append(item)
                changes.append((path, original_bytes, migrated, item))
        except (OSError, ValueError, TypeError, KeyError) as error:
            report["errors"].append({"file": str(path), "error": str(error)})
    report["changedCount"] = len(changes)
    report["unchangedCount"] = len(report["unchanged"])
    if args.apply and report["errors"]:
        print(json.dumps(report, indent=2))
        raise SystemExit("Migration preflight failed; no workflows were written")
    if args.apply and changes:
        # Check all sources before making even the first change.
        if any(path.read_bytes() != before for path, before, _, _ in changes):
            raise SystemExit("A source changed during preflight; no workflows were written")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup = ROOT / "projects/the_prodigal_son/backups" / f"director-reference-lines-{stamp}"
        backup.mkdir(parents=True, exist_ok=False)
        report["backup"] = str(backup)
        for path, before, _, item in changes:
            name = digest(str(path).encode())[:12] + "-" + path.name
            (backup / name).write_bytes(before)
            item["backupFile"] = name
        manifest = backup / "migration-report.json"
        manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        try:
            for path, before, data, item in changes:
                if path.read_bytes() != before:
                    raise RuntimeError(f"Source changed while applying; refusing to overwrite {path}")
                encoded = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                if json.loads(encoded) != data:
                    raise RuntimeError("Serialized migration did not round-trip")
                temporary = path.with_name(path.name + f".reference-lines-{stamp}.tmp")
                temporary.write_bytes(encoded)
                temporary.replace(path)
                if json.loads(path.read_text(encoding="utf-8")) != data:
                    raise RuntimeError(f"Write verification failed for {path}")
                item["afterSha256"] = digest(path.read_bytes())
                item["applied"] = True
        finally:
            manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
