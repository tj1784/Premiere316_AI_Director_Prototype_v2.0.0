"""Regression checks for the single-scene import, using the published source data."""
import copy
import csv
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("scene1_importer", Path(__file__).with_name("import-prodigal-scene1.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class SceneReplacementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        public = importer.ROOT / "public"
        cls.manifest = json.loads((importer.ROOT / importer.PUBLIC_PATH / "director-manifest.json").read_text(encoding="utf-8"))
        cls.scene = next(scene for scene in cls.manifest["scenes"] if scene["sceneId"] == "PS-S01")
        cls.archive_hash = cls.scene["replacement"]["revision"]
        cls.files = {importer.WORKFLOW_NAME: (public / cls.scene["workflow"]["mediaUri"].lstrip("/")).read_bytes()}
        for segment in cls.scene["segments"]:
            cls.files[f"input/{segment['sourceImagePath']}"] = (public / segment["startImage"]["mediaUri"].lstrip("/")).read_bytes()
        for document in cls.manifest["documents"]:
            if document["name"].startswith("Scene 01 Rebuilt / "):
                name = document["name"].split(" / ", 1)[1]
                cls.files[name] = (public / document["mediaUri"].lstrip("/")).read_bytes()

    def test_source_workflow_images_and_all_serialized_copies_validate(self):
        scene, outputs, _ = importer.validate_scene(self.files, self.archive_hash)
        self.assertEqual(scene, self.scene)
        self.assertEqual(len(scene["segments"]), 22)
        self.assertEqual(sum(item["durationFrames"] for item in scene["segments"]), 6720)
        self.assertEqual(len({item["startImage"]["sha256"] for item in scene["segments"]}), 9)
        workflow_key = scene["workflow"]["mediaUri"].removeprefix("/pictures/prodigal-son/")
        self.assertEqual(outputs[workflow_key], self.files[importer.WORKFLOW_NAME])
        self.assertEqual(scene["replacement"]["settings"], {
            "width": 0, "height": 0, "baseSteps": 30, "refineSteps": 8,
            "outputPrefix": "Prodigal_Son/Scene_01_Temple_and_the_Gathering/segment",
        })

    def test_rejects_csv_timing_disagreeing_with_workflow(self):
        files = dict(self.files)
        files["Shot_Timing.csv"] = files["Shot_Timing.csv"].replace(b"0.0,10.0,10.0", b"0.0,11.0,11.0", 1)
        with self.assertRaisesRegex(ValueError, "CSV timing differs"):
            importer.validate_scene(files, self.archive_hash)

    def test_rejects_a_stale_serialized_timeline_copy(self):
        files = dict(self.files)
        workflow = json.loads(files[importer.WORKFLOW_NAME])
        node = next(item for item in workflow["nodes"] if item["type"] == "LTXDirector")
        node["widgets_values_named"]["timeline_data"] = "{}"
        files[importer.WORKFLOW_NAME] = json.dumps(workflow).encode()
        with self.assertRaisesRegex(ValueError, "serialized copies disagree: timeline_data"):
            importer.validate_scene(files, self.archive_hash)

    def test_rejects_missing_reference_and_wrong_image_geometry(self):
        path = "input/" + self.scene["segments"][0]["sourceImagePath"]
        files = dict(self.files)
        del files[path]
        with self.assertRaisesRegex(ValueError, "Starting image is missing"):
            importer.validate_scene(files, self.archive_hash)
        files[path] = self.files[path][:16] + (10).to_bytes(4, "big") + self.files[path][20:]
        with self.assertRaisesRegex(ValueError, "Unexpected starting-image size"):
            importer.validate_scene(files, self.archive_hash)

    def test_preserves_other_scenes_parent_provenance_and_reimports_without_revision_churn(self):
        scene, _, documents = importer.validate_scene(self.files, self.archive_hash)
        previous = copy.deepcopy(self.manifest)
        old = previous["scenes"][0]
        old.pop("replacement")
        old["segments"] = old["segments"][:4]
        old["storyDurationSeconds"] = old["generationDurationSeconds"] = 45.0
        previous["storyShotCount"] -= 18
        previous["generationSegmentCount"] -= 18
        previous["storyDurationSeconds"] -= 235
        previous["generationDurationSeconds"] -= 235
        previous["documents"] = previous["documents"][:3]
        result = importer.build_manifest(previous, scene, documents, self.archive_hash)
        self.assertEqual(result["scenes"][1:], previous["scenes"][1:])
        self.assertEqual(result["sourceArchive"], previous["sourceArchive"])
        self.assertEqual(result["reusedShots"], previous["reusedShots"])
        self.assertEqual((result["storyShotCount"], result["generationSegmentCount"]), (152, 149))
        self.assertEqual((result["storyDurationSeconds"], result["generationDurationSeconds"]), (2005.0, 1981.0))
        self.assertEqual(importer.build_manifest(result, scene, documents, self.archive_hash), result)

    def test_unsafe_archive_names_and_duplicate_entries_are_rejected_before_publication(self):
        for path in ("../outside", "C:/outside", "/absolute", "a\\b", "a//b", "a/./b", "a\x00b"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                importer.safe_entry(path)
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("README.txt", b"one")
                bundle.writestr("readme.txt", b"two")
            with self.assertRaisesRegex(ValueError, "Duplicate archive entry"):
                importer.read_archive(archive)


class VariedSceneReplacementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Small in-memory package exercises validation without depending on Downloads.
        filenames = ["opening_rebuilt/01_Temple_Assembly", "opening_rebuilt/02_Youth_Temple", "opening_varied/S03_Exit_Perspective",
                     "opening_rebuilt/03_Youth_Coin_Gateway", "opening_rebuilt/04_Youth_Leaves", "opening_rebuilt/05_Hillside_Assembly_Seated",
                     "opening_varied/S07_Welcome_Group", "opening_varied/S08_Audience_Group", "opening_varied/S09_Leaders_Establishing",
                     "opening_rebuilt/06_Leaders_Close", "opening_varied/S11_Scribe_Oblique", "opening_varied/S12_Seated_Jesus_Past_Leaders",
                     "opening_rebuilt/07_Youth_Listening", "opening_varied/S14_Seated_Jesus_Rise_Start", "opening_varied/S15_Audience_Reverse",
                     "opening_varied/S16_Jesus_Storyteller_Medium"]
        lengths = [360, 240, 288, 360, 288, 360, 288, 288, 288, 216, 336, 288, 240, 336, 336, 528]
        files = {name: b"Source document" for name in importer.VARIED_DOCUMENT_NAMES}
        segments, images, rows, start = [], [], [], 0
        timestamp = lambda frame: f"{frame // 24 // 60:02}:{frame // 24 % 60:02}"
        for number, (filename, length) in enumerate(zip(filenames, lengths), 1):
            path = f"prodigal_son/{filename}.png"
            size = (1942, 809) if "opening_varied/" in filename else (1920, 800)
            data = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", *size) + bytes([number]) * 9
            files[f"input/{path}"] = data
            images.append({"segment": number, "path": f"input/{path}", "sha256": importer.digest(data), "bytes": len(data), "width": size[0], "height": size[1]})
            speaker, voice = {10: ("PHARISEE", "prodigal_son/voices/PHARISEE-reference.flac"),
                              11: ("SCRIBE", "prodigal_son/voices/SCRIBE-reference.flac"),
                              16: ("JESUS", "voices/shared/JESUS.flac")}.get(number, ("", ""))
            segments.append({"id": f"segment-{number}", "start": start, "length": length, "type": "image", "isEndFrame": False,
                             "imageFile": path, "imageB64": f"/api/view?filename={Path(path).name}&type=input&subfolder={str(Path(path).parent).replace(chr(92), '/')}",
                             "prompt": f"Shot {number} camera and action.", "speaker": speaker, "voiceReferenceFile": voice, "voiceReferenceEnabled": bool(voice)})
            rows.append([number, timestamp(start), timestamp(start + length), length // 24, f"Shot {number}", "Medium", path, speaker, voice, number])
            start += length
        timeline = {"segments": segments, "normalStartFrame": 0, "normalDurationFrames": 5040, "global_prompt": "Temple and hillside gathering.",
                    "generationOptions": {"distilled": False, "tiledDecode": True, "unloadVae": False}, "icReferenceMode": True,
                    "motionSegments": [{"videoFile": name, "inputIndex": index, "isStaticImage": True, "start": 0, "length": 5040} for index, name in enumerate([
                        "whatdreamscost/1a7cf183faa1-PS-CHR-JESUS.png", "whatdreamscost/87ed7075b0e7-PS-LOC-HILLSIDE.png"])]}
        values = {"start_second": 0, "end_second": 210, "duration_seconds": 210, "start_frame": 0, "end_frame": 5040, "duration_frames": 5040,
                  "timeline_data": json.dumps(timeline), "local_prompts": " | ".join(s["prompt"] for s in segments), "segment_lengths": ",".join(map(str, lengths)),
                  "global_prompt": timeline["global_prompt"], "frame_rate": 24, "custom_width": 0, "custom_height": 0}
        def node(node_id, kind, named, **extra):
            return {"id": node_id, "type": kind, "widgets_values_named": named, "widgets_values": list(named.values()), **extra}
        output = {"filename_prefix": "Prodigal_Son/Scene_01_Temple_and_the_Gathering/segment"}
        workflow = {"nodes": [node(1, "LTXDirector", values, properties=copy.deepcopy(values)),
                              node(2, "stage1", {"steps": 30, "distilled_mode": False}), node(3, "stage2", {"steps": 8, "distilled_mode": False}),
                              node(4, "decoder", {"tiled_decode": True}), node(5, "ComfySwitchNode", {"switch": False}, title="Dev / Distilled model"),
                              {"id": 6, "type": "VHS_VideoCombine", "widgets_values": output, "widgets_values_named": dict(output)}],
                    "definitions": {"subgraphs": [{"id": "stage1", "name": "Stage #1", "nodes": []}, {"id": "stage2", "name": "Stage #2", "nodes": []}]}}
        files[importer.VARIED_WORKFLOW_NAME] = json.dumps(workflow).encode()
        files["Image_Manifest.json"] = json.dumps({"images": images, "image_count": 16, "new_image_count": 9, "retained_image_count": 7}).encode()
        files["Scene_01_Validation.json"] = json.dumps({"workflow_filename": importer.VARIED_WORKFLOW_NAME, "segments": 16, "duration_seconds": 210,
                                                     "frame_rate": 24, "duration_frames": 5040, "retained_dialogue_output_segments": [10, 11, 16]}).encode()
        table = io.StringIO(newline="")
        writer = csv.writer(table)
        writer.writerow(["Segment", "Start", "End", "Seconds", "Shot", "Angle", "Image", "Speaker", "Voice_reference", "Source_segment"])
        writer.writerows(rows)
        files["Scene_01_Shot_Plan.csv"] = table.getvalue().encode()
        cls.files = files

    def patch_timeline(self, files, mutation):
        workflow = json.loads(files[importer.VARIED_WORKFLOW_NAME])
        node = workflow["nodes"][0]
        timeline = json.loads(node["properties"]["timeline_data"])
        mutation(timeline)
        value = json.dumps(timeline)
        node["properties"]["timeline_data"] = node["widgets_values_named"]["timeline_data"] = value
        node["widgets_values"][list(node["widgets_values_named"]).index("timeline_data")] = value
        files[importer.VARIED_WORKFLOW_NAME] = json.dumps(workflow).encode()

    def test_new_profile_accepts_exact_timing_dimensions_and_preserves_workflow_bytes(self):
        scene, outputs, documents = importer.validate_scene(self.files, "a" * 64)
        self.assertEqual((len(scene["segments"]), scene["generationDurationSeconds"]), (16, 210))
        self.assertEqual(sum(s["durationFrames"] for s in scene["segments"]), 5040)
        self.assertEqual(len(documents), 8)
        self.assertEqual({(s["startImage"]["width"], s["startImage"]["height"]) for s in scene["segments"]}, {(1920, 800), (1942, 809)})
        self.assertEqual(outputs[scene["workflow"]["mediaUri"].removeprefix("/pictures/prodigal-son/")], self.files[importer.VARIED_WORKFLOW_NAME])
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "replacement.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, data in self.files.items():
                    bundle.writestr(name, data)
            _, extracted = importer.read_archive(archive)
            self.assertEqual(extracted, self.files)

    def test_rejects_image_hash_mismatch_or_resizing(self):
        path = "input/prodigal_son/opening_varied/S03_Exit_Perspective.png"
        files = dict(self.files)
        files[path] = files[path][:-1] + b"z"
        with self.assertRaisesRegex(ValueError, "Image manifest differs"):
            importer.validate_scene(files, "a" * 64)
        files[path] = files[path][:16] + struct.pack(">II", 1920, 800) + files[path][24:]
        with self.assertRaisesRegex(ValueError, "Unexpected starting-image size"):
            importer.validate_scene(files, "a" * 64)

    def test_rejects_voice_swap_and_reference_swap(self):
        for mutation, message in [
            (lambda t: t["segments"][15].update(voiceReferenceFile="prodigal_son/voices/FATHER-reference.flac"), "Voice identity differs"),
            (lambda t: t["motionSegments"][0].update(videoFile="unrelated.png"), "IC identity references"),
        ]:
            files = dict(self.files)
            self.patch_timeline(files, mutation)
            with self.assertRaisesRegex(ValueError, message):
                importer.validate_scene(files, "a" * 64)

    def test_rejects_changed_generation_controls_and_stale_execution_copy(self):
        files = dict(self.files)
        self.patch_timeline(files, lambda t: t["generationOptions"].update(distilled=True))
        with self.assertRaisesRegex(ValueError, "Dev 30/8"):
            importer.validate_scene(files, "a" * 64)
        files = dict(self.files)
        workflow = json.loads(files[importer.VARIED_WORKFLOW_NAME])
        workflow["nodes"][3]["widgets_values"] = [False]
        files[importer.VARIED_WORKFLOW_NAME] = json.dumps(workflow).encode()
        with self.assertRaisesRegex(ValueError, "Execution widget copies disagree"):
            importer.validate_scene(files, "a" * 64)

    def test_rejects_extra_files_and_mixed_profiles(self):
        files = {**self.files, "README.txt": b"A legacy document must not leak into this profile"}
        with self.assertRaisesRegex(ValueError, "exactly 16"):
            importer.validate_scene(files, "a" * 64)
        files[importer.WORKFLOW_NAME] = b"{}"
        with self.assertRaisesRegex(ValueError, "mixes two"):
            importer.validate_scene(files, "a" * 64)

    def test_rejects_csv_duration_and_manifest_duplicate(self):
        files = dict(self.files)
        files["Scene_01_Shot_Plan.csv"] = files["Scene_01_Shot_Plan.csv"].replace(b"00:00,00:15,15", b"00:00,00:15,16", 1)
        with self.assertRaisesRegex(ValueError, "CSV timing differs"):
            importer.validate_scene(files, "a" * 64)
        files = dict(self.files)
        manifest = json.loads(files["Image_Manifest.json"])
        manifest["images"][1]["path"] = manifest["images"][0]["path"]
        files["Image_Manifest.json"] = json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError, "unique and ordered"):
            importer.validate_scene(files, "a" * 64)


if __name__ == "__main__":
    unittest.main()
