"""Keep JSON stdout parseable on legacy Windows cp1252 consoles.

The real converter/MP4 job separately checks licensed font bytes, shaping and glyphs.
This test isolates CLI JSON encoding without needing to download fixture fonts.
"""
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rtl-reference-woff2.py"
spec = importlib.util.spec_from_file_location("rtl_reference_woff2", SCRIPT)
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConverterConsoleEncodingTests(unittest.TestCase):
    def test_all_semitic_probes_round_trip_through_cp1252_stdout(self):
        with tempfile.TemporaryDirectory() as location:
            folder = Path(location)
            source_commit = "06bfe0d62a98375cb09c942fa18e68bd32cff057"
            manifest = {
                "sourceCommit": source_commit,
                "faces": [{"id": face_id} for face_id in converter.SCRIPT_PROBES],
            }
            (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            output = io.BytesIO()
            stream = io.TextIOWrapper(output, encoding="cp1252", errors="strict", write_through=True)

            def stub_convert(_folder, face, sample):
                return {"id": face["id"], "probeText": sample}

            with patch.object(sys, "argv", [str(SCRIPT), str(folder)]), \
                 patch.object(sys, "stdout", stream), \
                 patch.object(converter, "convert_face", side_effect=stub_convert) as invoked:
                converter.main()
                stream.flush()
            raw = output.getvalue()
            self.assertTrue(raw.isascii(), "CLI JSON must be Windows-codepage safe")
            decoded = json.loads(raw.decode("ascii"))
            self.assertEqual(decoded["sourceCommit"], source_commit)
            self.assertEqual(len(decoded["converted"]), 4)
            self.assertEqual(invoked.call_count, 4)
            self.assertEqual(
                {face["id"]: face["probeText"] for face in decoded["converted"]},
                converter.SCRIPT_PROBES,
            )


if __name__ == "__main__":
    unittest.main()
