import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("importer", Path(__file__).with_name("import-prodigal-director.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ArchiveSafetyTests(unittest.TestCase):
    def test_rejects_paths_that_escape_or_change_meaning_on_windows(self):
        for path in ("../outside.png", "/absolute.png", "input/../escape.png", "C:/temp/a.png", "a\\b.png", "a\x00b", "a//b.png"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                importer.safe_entry(path)

    def test_rejects_non_png_or_unexpected_geometry(self):
        with self.assertRaises(ValueError):
            importer.png_size(b"not an image")
        data = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + (16).to_bytes(4, "big") * 2 + b"\x00" * 9
        with self.assertRaises(ValueError):
            importer.png_size(data)


if __name__ == "__main__":
    unittest.main()
