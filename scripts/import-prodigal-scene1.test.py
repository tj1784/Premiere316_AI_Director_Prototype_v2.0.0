"""Regression checks for the single-scene import, using the published source data."""
import copy
import importlib.util
import json
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
