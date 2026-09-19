"""Attach the user's selected Younger Son sheet as Ref1 in native Scene18 workflows."""
import copy
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("reference_migration", Path(__file__).with_name("migrate-director-reference-lines.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
REFERENCE = "10f5bc58f618-PS-CHR-YOUNGER-pig-farm-extreme-destitution.png"
SOURCE = Path("D:/AI/ComfyUI/Data/LTX2.5/Input") / REFERENCE
PATHS = [migration.PROJECT / "Scene_18_The_father_runs.json",
         migration.COMFY / "Scene_18_The_father_runs.json", *migration.DOWNLOADS]

def main():
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)
    changes = []
    for path in PATHS:
        before = path.read_bytes()
        original = json.loads(before.decode("utf-8-sig"))
        result = copy.deepcopy(original)
        node = next(n for n in result["nodes"] if n.get("type") == "LTXDirector")
        index, timeline = migration._mirrors(node)
        old_timeline = copy.deepcopy(timeline)
        existing = timeline.get("motionSegments", [])
        if existing:
            if any(s.get("videoFile") == REFERENCE and s.get("inputIndex", 0) == 0 for s in existing):
                print(f"Already attached: {path.name}")
                continue
            raise ValueError(f"Ref1 already contains authored media; refusing to replace it: {path}")
        duration = max(int(s.get("start", 0)) + int(s.get("length", 1)) for s in timeline["segments"])
        timeline.update(icReferenceMode=True, motionTrackEnabled=True)
        timeline["icInputs"][0].update(enabled=True, label="Younger Son, exhausted and destitute, worn tunic")
        timeline["motionSegments"] = [{
            "id": "prodigal-scene18-ref1-younger", "type": "motion_video", "isStaticImage": True,
            "inputIndex": 0, "start": 0, "length": duration, "trimStart": 0,
            "videoDurationFrames": duration, "videoFile": REFERENCE, "fileName": REFERENCE,
            "videoStrength": 1.0, "videoAttentionStrength": 0.65, "resampleMode": "nearest",
            "fileSize": SOURCE.stat().st_size,
        }]
        # Verify every authored shot, voice, generation option and range is unchanged.
        for key, value in old_timeline.items():
            if key not in {"icReferenceMode", "icInputs", "motionSegments", "motionTrackEnabled"}:
                assert timeline[key] == value, key
        serialized = json.dumps(timeline, ensure_ascii=False, separators=(",", ":"))
        node["widgets_values"][index] = serialized
        assert len(node["widgets_values"]) == 23 and isinstance(node["widgets_values"][12], bool)
        node["widgets_values"][12] = True  # Current native LTXDirector use_custom_motion widget.
        node["widgets_values_named"].update(timeline_data=serialized, use_custom_motion=True)
        node["properties"].update(timeline_data=serialized, motionTrackEnabled=True, use_custom_motion=True)
        changes.append((path, before, result, duration))
    if not changes:
        return
    backup = ROOT / "projects/the_prodigal_son/backups" / ("scene18-ref1-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    backup.mkdir(parents=True, exist_ok=False)
    for path, before, _, _ in changes:
        (backup / (hashlib.sha256(str(path).encode()).hexdigest()[:12] + "-" + path.name)).write_bytes(before)
    for path, before, result, duration in changes:
        if path.read_bytes() != before:
            raise RuntimeError(f"Workflow changed during attachment: {path}")
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert json.loads(path.read_text(encoding="utf-8")) == result
        print(f"Attached Ref1 for {duration} frames: {path}")
    print(f"Backup: {backup}")

if __name__ == "__main__":
    main()
